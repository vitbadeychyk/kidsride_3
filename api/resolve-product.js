// Vercel Serverless Function: SSR-lite handler для SEO-friendly product URLs
// Підтримує два формати вхідних URL:
//   /product/:slug                        — канонічний формат
//   /:main_slug/:cat_slug/:product_slug   — legacy SEO-формат (3 сегменти)
// Обидва формати повертають canonical /product/:slug.

import fs from 'fs';
import path from 'path';

const SITE = 'https://www.kidsride.com.ua';

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escJson(s) {
  return String(s || '').replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

const CATEGORY_LABELS = {
  jeep: 'Джипи',
  quad: 'Квадроцикли',
  moto: 'Мотоцикли',
  car: 'Машини',
  tractor: 'Трактори',
  walker: 'Каталки-толокари',
  truck: 'Вантажівки',
  buggy: 'Баггі',
};

const CATEGORY_URLS = {
  jeep: '/dityachi-dzhypy',
  quad: '/dityachi-kvadratsykly',
  moto: '/dityachi-motosykly',
  car: '/dityachi-mashynky',
  tractor: '/dityachi-traktory',
  walker: '/kataly-tolokary',
  truck: '/dityachi-vantazhivky',
  buggy: '/dityachi-bahhi',
};

const SPEC_ICONS = {
  sku: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  brand: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>',
  cat: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  color: '<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20"/>',
  age: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 0 0 7.75"/>',
  warranty: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  voltage: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  motor: '<circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>',
  battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><line x1="22" y1="11" x2="22" y2="13"/><line x1="7" y1="12" x2="11" y2="12"/>',
  speed: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  max_load: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
};

function safeUrl(value, fallback = '') {
  const url = String(value || '').trim();
  return /^(?:https?:\/\/|\/)/i.test(url) ? url : fallback;
}

// Опис у БД може містити базове форматування. Відкидаємо небезпечні теги й
// атрибути, щоб SSR не перетворив поле адмінки на виконуваний HTML.
function safeRichText(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const withoutDangerous = source
    .replace(/<\s*(script|style|iframe|object|embed|form|svg)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\1/gi, '');
  const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'a']);
  return withoutDangerous
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (full, rawTag, attrs) => {
      const tag = String(rawTag).toLowerCase();
      if (!allowed.has(tag)) return '';
      if (full[1] === '/') return `</${tag}>`;
      if (tag === 'br') return '<br>';
      if (tag === 'a') {
        const href = String(attrs || '').match(/\bhref\s*=\s*(['"])(.*?)\1/i);
        const hrefValue = href && /^(?:https?:\/\/|\/|#)/i.test(href[2]) ? escHtml(href[2]) : '';
        return hrefValue ? `<a href="${hrefValue}" rel="nofollow noopener">` : '<span>';
      }
      return `<${tag}>`;
    })
    .replace(/\r?\n/g, '<br>');
}

function formatPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? Math.round(n).toLocaleString('uk-UA').replace(/\u00a0/g, ' ')
    : '';
}

function stockState(product) {
  const stock = product.stock == null ? null : Number(product.stock);
  const inStock = (stock === null || stock > 0) && product.active !== false;
  if (inStock) {
    const suffix = stock === 1
      ? ' <span class="stock-last">остання модель</span>'
      : '';
    return {
      inStock,
      html: `<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg> В наявності${suffix}`,
      mobile: stock === 1 ? 'В наявності (остання модель)' : 'В наявності',
    };
  }
  const preorderDays = Number(product.preorder_days || 0);
  if (preorderDays > 0) {
    return {
      inStock: false,
      html: `<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg> Під замовлення`,
      mobile: `Під замовлення`,
    };
  }
  return {
    inStock: false,
    html: '<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg> Немає в наявності',
    mobile: 'Немає в наявності',
  };
}

function renderGallery(product) {
  const images = Array.isArray(product.images)
    ? product.images.map(image => safeUrl(image)).filter(Boolean)
    : [];
  const mainImage = images[0] || SITE + '/opengraph.jpg';
  const alt = escHtml(product.name || 'Товар KidsRide');
  const badge = product.badge
    ? `<span class="gallery-badge">${escHtml(product.badge)}</span>`
    : '';
  const thumbs = images.map((image, index) => `
        <div class="thumb${index === 0 ? ' active' : ''}" data-ssr-image="${escHtml(image)}">
          <img src="${escHtml(image)}" alt="${alt}" loading="${index === 0 ? 'eager' : 'lazy'}">
        </div>`).join('');
  return `<!-- SSR_GALLERY_START -->
      <div class="gallery-main" id="mainGallery" onclick="openZoom()">
        ${badge}
        <div class="gallery-share">
          <button class="g-share-btn" type="button" title="Копіювати посилання" onclick="copyProductLink(this)"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07.07l1.71-1.71"/></svg></button>
        </div>
        <div style="position:absolute;inset:0;overflow:hidden;display:flex;align-items:center;justify-content:center">
          <img id="mainProductImg" src="${escHtml(mainImage)}" alt="${alt}" width="720" height="540" fetchpriority="high" style="display:block;width:100%;height:100%;object-fit:contain;min-width:0;min-height:0">
        </div>
      </div>
      <div class="gallery-thumbs">${thumbs}</div>
      <!-- SSR_GALLERY_END -->`;
}

async function fetchAttributeSpecs(supaUrl, headers, productId) {
  if (!productId || /^os_/i.test(String(productId))) return [];
  try {
    const url = supaUrl + '/rest/v1/product_attribute_values?select=value,product_attributes(code,name,unit,data_type)&product_id=eq.' + encodeURIComponent(productId);
    const response = await fetch(url, { headers });
    if (!response.ok) return [];
    const rows = await response.json();
    return (Array.isArray(rows) ? rows : []).map(row => {
      const meta = row.product_attributes || {};
      if (!meta.code || row.value == null || String(row.value).trim() === '') return null;
      const value = ['remote_control', 'bluetooth', 'mp3', 'mp4', 'lights', 'shocks', 'leather_seat'].includes(meta.code)
        ? 'Так'
        : String(row.value) + (meta.unit ? ' ' + meta.unit : '');
      return { key: meta.code, label: meta.name || meta.code, val: value };
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function renderSpecs(product, categoryName, attrSpecs = []) {
  const specs = [
    ['sku', 'Артикул', product.sku],
    ['brand', 'Бренд', product.brand],
    ['cat', 'Категорія', categoryName],
    ['color', 'Колір', product.color],
    ['age', 'Вік', product.age_range || product.age],
    ['voltage', 'Напруга', product.voltage],
    ['motor', 'Двигун', product.motor],
    ['battery', 'Акумулятор', product.battery],
    ['speed', 'Швидкість', product.speed],
    ['max_load', 'Максимальне навантаження', product.max_load],
    ['weight', 'Вага', product.weight],
    ['warranty', 'Гарантія', product.warranty],
    ['assembly_time', 'Час складання', product.assembly_time],
  ].filter(([, , value]) => value !== null && value !== undefined && String(value).trim() !== '');
  const allSpecs = [...specs.map(([key, label, val]) => ({ key, label, val })), ...attrSpecs];
  if (!allSpecs.length) {
    return '<div class="specs-empty">Характеристики поки не заповнені.</div>';
  }
  return `<div class="specs-grid">${allSpecs.map(spec => `
    <div class="spec-card">
      <div class="spec-icon"><svg viewBox="0 0 24 24">${SPEC_ICONS[spec.key] || SPEC_ICONS.warranty}</svg></div>
      <div><div class="spec-label">${escHtml(spec.label)}</div><div class="spec-value">${escHtml(spec.val)}</div></div>
    </div>`).join('')}</div>`;
}

function renderProductContent(product, categoryName, categoryUrl, reviews, attrSpecs) {
  const stock = stockState(product);
  const price = formatPrice(product.price);
  const oldPrice = formatPrice(product.old_price);
  const description = [product.short_desc, product.description2, product.description]
    .filter(value => value && String(value).trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .map(value => safeRichText(value))
    .filter(Boolean)
    .join('<br>');
  const descriptionHtml = description || '<p class="desc-text" style="color:var(--text-muted)">Опис товару ще не додано.</p>';
  const priceHtml = price ? `${price} грн` : 'Ціна уточнюється';
  const oldPriceHtml = oldPrice && Number(product.old_price) > Number(product.price)
    ? `<div class="price-hint">РРЦ: <strong>${oldPrice} грн</strong></div><div class="price-savings"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>Ви економите: <strong>${formatPrice(Number(product.old_price) - Number(product.price))} грн</strong></div>`
    : '<div class="price-hint" style="display:none"></div><div class="price-savings" style="display:none"></div>';
  const installment = price ? `від ${formatPrice(Math.ceil(Number(product.price) / 4))} грн` : '';
  const categoryCrumb = categoryName
    ? `<a href="${escHtml(categoryUrl || '/catalog.html')}" class="breadcrumb-cat" id="breadcrumbCat">${escHtml(categoryName)}</a>`
    : '<a href="/catalog.html" class="breadcrumb-cat" id="breadcrumbCat">Каталог</a>';
  const productCrumb = `<span class="breadcrumb-cur">${escHtml(product.name || '')}</span>`;
  return {
    gallery: renderGallery(product),
    breadcrumb: `<div class="breadcrumb">
  <a href="/">Головна</a><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
  <a href="/catalog.html">Каталог</a><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
  ${categoryCrumb}<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>${productCrumb}
</div>`,
    info: `<div class="product-meta">
        <span class="meta-brand">${escHtml(product.brand || '')}</span><span class="meta-sep">·</span>
        <span class="meta-sku">${product.sku ? 'Арт: ' + escHtml(product.sku) : ''}</span><span class="meta-sep">·</span>
        <span class="meta-stock ${stock.inStock ? 'stock-in' : 'stock-out'}">${stock.html}</span>
      </div>
      <h1 class="product-title">${escHtml(product.name || '')}</h1>
      <div class="rating-row" id="ratingRow" style="display:none"><div class="stars" id="ratingStars"></div><span class="rating-num">0.0</span><a href="#reviews" class="rating-count">0 відгуків</a></div>
      <div class="price-block">
        <div class="price-sale-label" style="display:${oldPrice && Number(product.old_price) > Number(product.price) ? '' : 'none'}">Акційна ціна</div>
        <div class="price-row"><span class="price-main">${priceHtml}</span></div>
        ${oldPriceHtml}
        <div class="installment"><svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg><div class="installment-text">Оплата частинами від ПриватБанк: <span>${installment}</span> × 4 платежі</div></div>
      </div>`,
    description: `<div id="productDescription">${descriptionHtml}</div>${product.features ? `<div class="desc-features" id="productFeatures">${safeRichText(product.features)}</div>` : '<div class="desc-features" id="productFeatures" style="display:none"></div>'}`,
    specs: renderSpecs(product, categoryName, attrSpecs),
    mobile: `<div class="mbb-price">${priceHtml}</div><div class="mbb-stock" style="font-size:11px;color:var(--text-muted)">${stock.mobile}</div>`,
  };
}

function buildSchema(product, pageUrl, desc, catName, catUrl, reviews = []) {
  const inStock = (typeof product.stock === 'number' ? product.stock > 0 : true) && product.active !== false;
  const imgList = Array.isArray(product.images) && product.images.length
    ? product.images.map(image => safeUrl(image)).filter(Boolean)
    : [SITE + '/opengraph.jpg'];
  const schemaSku = String(product.sku || product.id || '').replace(/\s+/g, '');
  const schemaCategory = String(catName || '');

  const pvu = new Date();
  pvu.setFullYear(pvu.getFullYear() + 1);
  const priceValidUntil = pvu.toISOString().substring(0, 10);

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': pageUrl + '#product',
    name: product.name || '',
    description: desc,
    brand: { '@type': 'Brand', name: product.brand || 'KidsRide' },
    sku: schemaSku,
    mpn: schemaSku,
    image: imgList,
    url: pageUrl,
    category: schemaCategory,
    ...(reviews.length > 0 ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: String(
          (reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length).toFixed(1)
        ),
        reviewCount: String(reviews.length),
        bestRating: '5',
        worstRating: '1',
      },
      review: reviews.slice(0, 5).map(r => ({
        '@type': 'Review',
        author: { '@type': 'Person', name: r.author_name || 'Покупець' },
        reviewRating: {
          '@type': 'Rating',
          ratingValue: String(r.rating || 5),
          bestRating: '5',
          worstRating: '1',
        },
        reviewBody: r.text || '',
        datePublished: r.created_at ? r.created_at.substring(0, 10) : '',
      })),
    } : {}),
    offers: {
      '@type': 'Offer',
      '@id': pageUrl + '#offer',
      url: pageUrl,
      priceCurrency: 'UAH',
      price: String(Math.round(Number(product.price || 0))),
      priceValidUntil,
      availability: inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'KidsRide', url: SITE },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
  
        shippingDestination: {
          '@type': 'DefinedRegion',
          addressCountry: 'UA',
        },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: {
            '@type': 'QuantitativeValue',
            minValue: 1,
            maxValue: 2,
            unitCode: 'DAY',
          },
          transitTime: {
            '@type': 'QuantitativeValue',
            minValue: 1,
            maxValue: 3,
            unitCode: 'DAY',
          },
        },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'UA',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 14,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/OriginalShippingFees',
      },
    },
  };

  const breadcrumbItems = [
    { '@type': 'ListItem', position: 1, name: 'Головна', item: SITE + '/' },
  ];
  if (catUrl && catName) {
    breadcrumbItems.push({ '@type': 'ListItem', position: 2, name: catName, item: SITE + catUrl });
  }
  breadcrumbItems.push({ '@type': 'ListItem', position: breadcrumbItems.length + 1, name: product.name || '', item: pageUrl });

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems,
  };

  return (
    `<script type="application/ld+json" id="schema-product">${escJson(JSON.stringify(productSchema))}</script>\n` +
    `<script type="application/ld+json" id="schema-breadcrumb">${escJson(JSON.stringify(breadcrumbSchema))}</script>`
  );
}

export default async function handler(req, res) {
  const slug     = (req.query.slug      || '').trim().toLowerCase();
  const productId = (req.query.id       || '').trim();
  const mainSlug = (req.query.main_slug || '').trim().toLowerCase();
  const catSlug  = (req.query.cat_slug  || '').trim().toLowerCase();
  const supaUrl  = process.env.SUPABASE_URL;
  const supaKey  = process.env.SUPABASE_ANON_KEY;

  if (!slug && !productId) {
    return res.status(404).send('Product not found');
  }
  if (!supaUrl || !supaKey) {
    return res.status(500).send('Product service is not configured');
  }

  const headers = { apikey: supaKey, Authorization: 'Bearer ' + supaKey };

  // ── 1. Завантажуємо товар за slug ────────────────────────────────────────
  let product = null;
  try {
    const selects = [
      'id,name,description,description2,short_desc,features,price,old_price,images,category,category_id,brand,slug,sku,stock,active,badge,color,voltage,age_range,age,motor,battery,speed,max_load,weight,warranty,assembly_time,preorder_days,updated_at',
      'id,name,description,description2,short_desc,features,price,old_price,images,category,category_id,brand,slug,sku,stock,active,badge,color,voltage,age_range,age,motor,battery,speed,max_load,weight,warranty,assembly_time,updated_at',
      'id,name,description,description2,short_desc,features,price,old_price,images,category,brand,slug,sku,stock,active,updated_at',
      'id,name,description,description2,short_desc,price,old_price,images,category,brand,slug,sku,stock,active',
    ];
    const fallbackId = productId || (/^(?:\d+|[0-9a-f]{8,}(?:-[0-9a-f-]+)?)$/i.test(slug) ? slug : '');
    for (const select of selects) {
      const urls = [
        slug ? supaUrl + '/rest/v1/products?select=' + select + '&slug=eq.' + encodeURIComponent(slug) + '&limit=1' : null,
        fallbackId ? supaUrl + '/rest/v1/products?select=' + select + '&id=eq.' + encodeURIComponent(fallbackId) + '&limit=1' : null,
      ].filter(Boolean);
      for (const url of urls) {
        const r = await fetch(url, { headers });
        if (r.status === 400) continue;
        if (!r.ok) break;
        const arr = await r.json();
        if (arr && arr[0]) { product = arr[0]; break; }
        break;
      }
      if (product) break;
    }
    // Власний склад має окрему таблицю ostatok і синтетичний ID os_<id>.
    // Без цього clean URL складського товару помилково повертав користувача
    // назад у catalog.html.
    if (!product) {
      const osId = productId.match(/^os_(\d+)$/i) || slug.match(/^os_(\d+)$/i);
      if (osId || slug) {
        const osSelect = 'id,slug,sku,name,color,quantity,sell_price,old_price,images,category_id,description,description2,short_desc,active';
        const osUrl = supaUrl + '/rest/v1/ostatok?select=' + osSelect +
          (osId
            ? '&id=eq.' + encodeURIComponent(osId[1])
            : '&slug=eq.' + encodeURIComponent(slug) + '&quantity=gt.0&active=eq.true&limit=1');
        let osRes = await fetch(osUrl, { headers });
        // Підтримуємо старі посилання os_<id>, якщо міграція slug ще не запущена.
        // Для clean URL fallback навмисно немає: пошук по SKU або частині slug
        // може повернути іншу позицію.
        if (osRes.status === 400 && osId) {
          const fallbackUrl = supaUrl + '/rest/v1/ostatok?select=id,sku,color,quantity,sell_price,old_price,images,category_id,description,description2,short_desc,active' +
            '&id=eq.' + encodeURIComponent(osId[1]) + '&active=eq.true';
          osRes = await fetch(fallbackUrl, { headers });
        }
        if (osRes.ok) {
          const rows = await osRes.json();
          const os = (rows || []).find(row =>
            osId
              ? String(row.id) === String(osId[1])
              : String(row.slug || '').trim().toLowerCase() === slug
          );
          if (os) {
            product = {
              id: 'os_' + os.id,
              sku: os.sku,
              name: os.name || os.sku,
              color: os.color || null,
              brand: '',
              price: Number(os.sell_price) || 0,
              old_price: os.old_price || null,
              stock: Number(os.quantity) || 0,
              images: Array.isArray(os.images) ? os.images : [],
              category: null,
              category_id: os.category_id || null,
              description: os.description || os.short_desc || null,
              description2: os.description2 || null,
              short_desc: os.short_desc || os.description2 || null,
              active: os.active !== false,
              // Для SEO canonical використовуємо саме запитаний slug,
              // а не SKU або технічний ідентифікатор os_<id>.
              slug: slug || ('os_' + os.id)
            };
          }
        }
      }
    }
  } catch (_) {}

  if (!product || product.active !== true) {
    // Не показуємо неіснуючі або неактивні товари через clean URL.
    return res.status(404).send('Product not found');
  }
  // Якщо постачальник не має залишку, беремо зі складу тільки наявність для SSR.
  // Якщо SKU вже знайдений у products, ціни постачальника не підміняємо
  // складськими цінами — навіть коли товар є на власному складі.
  if (product.sku && !/^os_/i.test(String(product.id || '')) && Number(product.stock || 0) <= 0) {
    try {
      const stockRes = await fetch(
        supaUrl + '/rest/v1/ostatok?select=sku,quantity,sell_price,old_price,active&quantity=gt.0&limit=1000',
        { headers }
      );
      if (stockRes.ok) {
        const stockRows = await stockRes.json();
        const skuKey = String(product.sku).toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, '');
        const stockRow = (stockRows || []).find(row => {
          if (row.active === false) return false;
          const rowKey = String(row.sku || '').toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, '');
          return rowKey === skuKey;
        });
        if (stockRow) {
          product.stock = Number(stockRow.quantity) || 0;
          if (product.stock > 0) product.active = true;
        }
      }
    } catch (_) {}
  }
  // ── 2. Завантажуємо відгуки для aggregateRating + review ───────────────
  let reviews = [];
  try {
    const r = await fetch(
      supaUrl + '/rest/v1/reviews?select=author_name,rating,text,created_at&product_id=eq.' +
        encodeURIComponent(product.id) + '&approved=eq.true&order=created_at.desc&limit=10',
      { headers }
    );
    if (r.ok) reviews = (await r.json()) || [];
  } catch (_) {}

  // ── 3. Завантажуємо категорії для хлібних крихт ──────────────────────────
  let catName = '';
  let catUrl  = '';

  // Якщо передані slugs з URL — беремо дані з Supabase (динамічно)
  if (mainSlug && catSlug) {
    try {
      // Завантажуємо main_category та subcategory паралельно
      const [mainRes, subRes] = await Promise.all([
        fetch(supaUrl + '/rest/v1/main_categories?select=id,name,slug&slug=eq.' + encodeURIComponent(mainSlug) + '&limit=1', { headers }),
        fetch(supaUrl + '/rest/v1/categories?select=id,name,slug&slug=eq.' + encodeURIComponent(catSlug) + '&limit=1', { headers }),
      ]);
      const mainArr = mainRes.ok ? await mainRes.json() : [];
      const subArr  = subRes.ok  ? await subRes.json()  : [];
      const mainCat = mainArr && mainArr[0];
      const subCat  = subArr  && subArr[0];

      if (subCat) {
        catName = subCat.name;
        catUrl  = '/' + mainSlug + '/' + catSlug;
      } else if (mainCat) {
        catName = mainCat.name;
        catUrl  = '/' + mainSlug;
      }
    } catch (_) {}
  } else if (mainSlug) {
    try {
      const r = await fetch(supaUrl + '/rest/v1/main_categories?select=id,name,slug&slug=eq.' + encodeURIComponent(mainSlug) + '&limit=1', { headers });
      if (r.ok) {
        const arr = await r.json();
        if (arr && arr[0]) { catName = arr[0].name; catUrl = '/' + mainSlug; }
      }
    } catch (_) {}
  }
  // Для старого /product/:slug URL категорія може бути доступна лише через
  // category_id або короткий код у products. У будь-якому разі SSR має
  // показати її одразу, а не чекати клієнтського JavaScript.
  if (!catName && product.category_id) {
    try {
      const r = await fetch(
        supaUrl + '/rest/v1/categories?select=id,name,slug&id=eq.' +
          encodeURIComponent(product.category_id) + '&limit=1',
        { headers }
      );
      if (r.ok) {
        const arr = await r.json();
        if (arr && arr[0]) {
          catName = arr[0].name || '';
          catUrl = arr[0].slug ? '/' + arr[0].slug : '/catalog.html';
        }
      }
    } catch (_) {}
  }
  if (!catName && product.category) {
    const categoryKey = String(product.category).toLowerCase();
    catName = CATEGORY_LABELS[categoryKey] || String(product.category);
    catUrl = CATEGORY_URLS[categoryKey] || '/catalog.html';
  }

  // ── 4. Визначаємо canonical URL ──────────────────────────────────────────
  // mainSlug/catSlug потрібні лише для breadcrumbs. Canonical завжди
  // використовує єдиний формат /product/{slug}.
  const pageUrl = SITE + '/product/' + encodeURIComponent(
    product.slug || slug || ('id-' + product.id)
  );

  // ── 5. Зчитуємо шаблон product.html ─────────────────────────────────────
  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'product.html'), 'utf8');
  } catch (_) {
    return res.redirect(302, '/product.html?id=' + encodeURIComponent(product.id));
  }

  const title    = escHtml(product.name || 'Товар') + ' — KidsRide';
  const rawDesc  = product.short_desc || product.description2 || product.description ||
    (product.name ? 'Купити ' + product.name + ' в KidsRide. Гарантія 12 міс., доставка Новою Поштою.' : 'Товар KidsRide.');
  const desc     = escHtml(rawDesc.substring(0, 160));
  const img      = escHtml(safeUrl((Array.isArray(product.images) && product.images[0]), SITE + '/opengraph.jpg'));
  const priceStr = product.price ? String(Math.round(Number(product.price))) : '';
  const schemaDesc = String(rawDesc).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const attrSpecs = await fetchAttributeSpecs(supaUrl, headers, product.id);
  const rendered = renderProductContent(product, catName, catUrl, reviews, attrSpecs);

  // ── 6. Вставляємо товар у видимий HTML ─────────────────────────────────
  // Шаблон більше не містить жодного товару за замовчуванням: цей блок
  // замінює всі SSR-маркери реальними даними до відправлення відповіді.
  html = html
    .replace(/<!-- SSR_GALLERY_START -->[\s\S]*?<!-- SSR_GALLERY_END -->/, rendered.gallery)
    .replace(/<!-- BREADCRUMB -->[\s\S]*?<\/div>\s*<!-- Кнопка/, rendered.breadcrumb + '\n<!-- Кнопка')
    .replace(/<!-- PRODUCT INFO -->\s*<div class="product-info">[\s\S]*?<!-- COLOR/, '<!-- PRODUCT INFO -->\n    <div class="product-info">\n      ' + rendered.info + '\n\n      <!-- COLOR')
    .replace(/<div id="productDescription"><\/div>\s*<div class="desc-features" id="productFeatures"[^>]*><\/div>/, rendered.description)
    .replace(/<table class="specs-table" id="productSpecsTable">[\s\S]*?<\/table>/, rendered.specs)
    .replace(/<div class="mbb-price"><\/div>\s*<div class="mbb-stock"[^>]*><\/div>/, rendered.mobile);

  const pageUrlE = escHtml(pageUrl);

  // ── 7. Вставляємо meta теги ──────────────────────────────────────────────
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*"/,       `$1${desc}"`)
    .replace(/(<meta[^>]+id="og-title"[^>]+content=")[^"]*"/,         `$1${title}"`)
    .replace(/(<meta[^>]+id="og-description"[^>]+content=")[^"]*"/,   `$1${desc}"`)
    .replace(/(<meta[^>]+id="og-image"[^>]+content=")[^"]*"/,         `$1${img}"`)
    .replace(/(<meta[^>]+id="og-url"[^>]+content=")[^"]*"/,           `$1${pageUrlE}"`)
    .replace(/(<link[^>]+id="seo-canonical"[^>]+href=")[^"]*"/,       `$1${pageUrlE}"`)
    .replace(/(<meta[^>]+id="tw-title"[^>]+content=")[^"]*"/,         `$1${title}"`)
    .replace(/(<meta[^>]+id="tw-description"[^>]+content=")[^"]*"/,   `$1${desc}"`)
    .replace(/(<meta[^>]+id="tw-image"[^>]+content=")[^"]*"/,         `$1${img}"`)
    .replace(/(<meta[^>]+id="og-price"[^>]+content=")[^"]*"/,         `$1${priceStr}"`);

  // ── 8. Вставляємо Schema.org + window vars ───────────────────────────────
  html = html.replace(
    '</head>',
    `<script>window.__KR_PRODUCT_ID__=${escJson(JSON.stringify(String(product.id)))};window.__KR_PRODUCT_SLUG__=${escJson(JSON.stringify(String(product.slug || slug || "")))};window.__KR_CAT_NAME__=${escJson(JSON.stringify(catName || ""))};window.__KR_CAT_URL__=${escJson(JSON.stringify(catUrl || ""))};</script>\n` +
    buildSchema(product, pageUrl, schemaDesc, catName, catUrl, reviews) + '\n' +
    '</head>'
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=60');
  res.status(200).send(html);
}
