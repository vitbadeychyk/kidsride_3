// Vercel Serverless Function: SSR-lite handler для SEO-friendly product URLs
// Підтримує два формати URL:
//   /product/:slug                        — старий формат
//   /:main_slug/:cat_slug/:product_slug   — новий SEO-формат (3 сегменти)

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

function buildSchema(product, pageUrl, desc, catName, catUrl, reviews = []) {
  const inStock = (typeof product.stock === 'number' ? product.stock > 0 : true) && product.active !== false;
  const imgList = Array.isArray(product.images) && product.images.length
    ? product.images.filter(Boolean)
    : [SITE + '/opengraph.jpg'];

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
    sku: (product.sku || String(product.id || '')).replace(/\s+/g, ''),
    mpn: (product.sku || String(product.id || '')).replace(/\s+/g, ''),
    image: imgList,
    url: pageUrl,
    category: catName,
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

  if ((!slug && !productId) || !supaUrl || !supaKey) {
    return res.redirect(302, '/catalog.html');
  }

  const headers = { apikey: supaKey, Authorization: 'Bearer ' + supaKey };

  // ── 1. Завантажуємо товар за slug ────────────────────────────────────────
  let product = null;
  try {
    const select = 'id,name,description,description2,short_desc,price,old_price,images,category,brand,slug,sku,stock,active,updated_at';
    const bySlug = slug
      ? supaUrl + '/rest/v1/products?select=' + select + '&slug=eq.' + encodeURIComponent(slug) + '&limit=1'
      : null;
    const fallbackId = productId || (/^(?:\d+|[0-9a-f]{8,}(?:-[0-9a-f-]+)?)$/i.test(slug) ? slug : '');
    const byId = fallbackId
      ? supaUrl + '/rest/v1/products?select=' + select + '&id=eq.' + encodeURIComponent(fallbackId) + '&limit=1'
      : null;
    const urls = [bySlug, byId].filter(Boolean);
    for (const url of urls) {
      const r = await fetch(url, { headers });
      if (!r.ok) continue;
      const arr = await r.json();
      if (arr && arr[0]) { product = arr[0]; break; }
    }
    // Власний склад має окрему таблицю ostatok і синтетичний ID os_<id>.
    // Без цього clean URL складського товару помилково повертав користувача
    // назад у catalog.html.
    if (!product) {
      const osId = productId.match(/^os_(\d+)$/i) || slug.match(/^os_(\d+)$/i);
      if (osId || slug) {
        const osSelect = 'id,sku,color,quantity,sell_price,old_price,images,category_id,description,description2,short_desc,active';
        const osUrl = supaUrl + '/rest/v1/ostatok?select=' + osSelect +
          (osId
            ? '&id=eq.' + encodeURIComponent(osId[1])
            : '&quantity=gt.0&active=eq.true&limit=1000');
        const osRes = await fetch(osUrl, { headers });
        if (osRes.ok) {
          const rows = await osRes.json();
          const slugKey = String(slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
          const os = (rows || []).find(row => {
            if (osId) return String(row.id) === String(osId[1]);
            const skuKey = String(row.sku || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
            return skuKey && (slugKey.includes(skuKey) || skuKey.includes(slugKey));
          });
          if (os) {
            product = {
              id: 'os_' + os.id,
              sku: os.sku,
              name: os.sku,
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
              // Для SEO canonical використовуємо slug із запиту (назва/артикул),
              // а не технічний ідентифікатор os_<id>.
              slug: slug || ('os_' + os.id)
            };
          }
        }
      }
    }
  } catch (_) {}

  if (!product) {
    // Slug не знайдено — перенаправляємо на каталог (щоб не показувати кешований не той товар)
    return res.redirect(302, '/catalog.html');
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

  // ── 4. Визначаємо canonical URL ──────────────────────────────────────────
  // Пріоритет: 3-сегментний URL > /product/:slug
  let pageUrl;
  if (mainSlug && catSlug && product.slug) {
    pageUrl = SITE + '/' + mainSlug + '/' + catSlug + '/' + product.slug;
  } else {
    pageUrl = SITE + '/product/' + product.slug;
  }

  // ── 5. Зчитуємо шаблон product.html ─────────────────────────────────────
  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'product.html'), 'utf8');
  } catch (_) {
    return res.redirect(302, '/product.html?id=' + encodeURIComponent(product.id));
  }

  const title    = escHtml(product.name) + ' — KidsRide';
  const rawDesc  = product.short_desc || product.description2 || product.description ||
    'Купити ' + product.name + ' в KidsRide. Гарантія 12 міс., доставка Новою Поштою.';
  const desc     = escHtml(rawDesc.substring(0, 160));
  const img      = escHtml((Array.isArray(product.images) && product.images[0]) || SITE + '/opengraph.jpg');
  const priceStr = product.price ? String(Math.round(Number(product.price))) : '';
  const pageUrlE = escHtml(pageUrl);

  // ── 6. Вставляємо meta теги ──────────────────────────────────────────────
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

  // ── 7. Вставляємо Schema.org + window vars ───────────────────────────────
  html = html.replace(
    '</head>',
    `<script>window.__KR_PRODUCT_ID__="${product.id}";window.__KR_CAT_NAME__=${JSON.stringify(catName||"")};window.__KR_CAT_URL__=${JSON.stringify(catUrl||"")};</script>\n` +
    buildSchema(product, pageUrl, rawDesc, catName, catUrl, reviews) + '\n' +
    '</head>'
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=60');
  res.status(200).send(html);
}
