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

function buildSchema(product, pageUrl, desc, catName, catUrl) {
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
    sku: product.sku || String(product.id || ''),
    mpn: product.sku || String(product.id || ''),
    image: imgList,
    url: pageUrl,
    category: catName,
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
  const mainSlug = (req.query.main_slug || '').trim().toLowerCase();
  const catSlug  = (req.query.cat_slug  || '').trim().toLowerCase();
  const supaUrl  = process.env.SUPABASE_URL;
  const supaKey  = process.env.SUPABASE_ANON_KEY;

  if (!slug || !supaUrl || !supaKey) {
    return res.redirect(302, '/catalog.html');
  }

  const headers = { apikey: supaKey, Authorization: 'Bearer ' + supaKey };

  // ── 1. Завантажуємо товар за slug ────────────────────────────────────────
  let product = null;
  try {
    const r = await fetch(
      supaUrl +
        '/rest/v1/products?select=id,name,description,short_desc,price,old_price,images,category,brand,slug,sku,stock,active,updated_at&slug=eq.' +
        encodeURIComponent(slug) + '&limit=1',
      { headers }
    );
    if (r.ok) {
      const arr = await r.json();
      product = arr && arr[0] ? arr[0] : null;
    }
  } catch (_) {}

  if (!product) {
    // Fallback: product.html без SEO (JS завантажить за ID)
    let fallbackHtml;
    try { fallbackHtml = fs.readFileSync(path.join(process.cwd(), 'product.html'), 'utf8'); } catch (_) {}
    if (fallbackHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(fallbackHtml);
    }
    return res.redirect(302, '/catalog.html');
  }

  // ── 2. Завантажуємо категорії для хлібних крихт ──────────────────────────
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

  // ── 3. Визначаємо canonical URL ──────────────────────────────────────────
  // Пріоритет: 3-сегментний URL > /product/:slug
  let pageUrl;
  if (mainSlug && catSlug && product.slug) {
    pageUrl = SITE + '/' + mainSlug + '/' + catSlug + '/' + product.slug;
  } else {
    pageUrl = SITE + '/product/' + product.slug;
  }

  // ── 4. Зчитуємо шаблон product.html ─────────────────────────────────────
  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'product.html'), 'utf8');
  } catch (_) {
    return res.redirect(302, '/product.html?id=' + encodeURIComponent(product.id));
  }

  const title    = escHtml(product.name) + ' — KidsRide';
  const rawDesc  = product.short_desc || product.description ||
    'Купити ' + product.name + ' в KidsRide. Гарантія 12 міс., доставка Новою Поштою.';
  const desc     = escHtml(rawDesc.substring(0, 160));
  const img      = escHtml((Array.isArray(product.images) && product.images[0]) || SITE + '/opengraph.jpg');
  const priceStr = product.price ? String(Math.round(Number(product.price))) : '';
  const pageUrlE = escHtml(pageUrl);

  // ── 5. Вставляємо meta теги ──────────────────────────────────────────────
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

  // ── 6. Вставляємо Schema.org + window vars ───────────────────────────────
  html = html.replace(
    '</head>',
    `<script>window.__KR_PRODUCT_ID__="${product.id}";</script>\n` +
    buildSchema(product, pageUrl, rawDesc.substring(0, 300), catName, catUrl) + '\n' +
    '</head>'
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=60');
  res.status(200).send(html);
}
