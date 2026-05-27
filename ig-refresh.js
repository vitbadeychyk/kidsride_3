// Vercel Serverless Function: SSR-lite handler для SEO-friendly product URLs
// Маршрут: /product/:slug → цей файл (через vercel.json rewrite)
//
// Що робить:
//  1. Знаходить товар у Supabase за slug
//  2. Читає product.html і вставляє правильні <title>, <meta>, OG теги
//  3. Вставляє повну Schema.org розмітку (Product + BreadcrumbList) у HEAD
//  4. Вставляє window.__KR_PRODUCT_ID__ щоб JS не робив зайвий запит
//  5. Повертає готовий HTML — Google бачить правильний контент БЕЗ JS

import fs from 'fs';
import path from 'path';

const SITE = 'https://www.kidsride.com.ua';

const CAT_LABELS = {
  jeep: 'Дитячі джипи',
  quad: 'Квадроцикли',
  moto: 'Мотоцикли',
  car: 'Дитячі машинки',
  tractor: 'Трактори',
  walker: 'Каталки-толокари',
  truck: 'Вантажівки',
  buggy: 'Баггі',
};

const CAT_URLS = {
  jeep: '/dityachi-dzhypy',
  quad: '/dityachi-kvadratsykly',
  moto: '/dityachi-motosykly',
  car: '/dityachi-mashynky',
  tractor: '/dityachi-traktory',
  walker: '/kataly-tolokary',
  truck: '/dityachi-vantazhivky',
  buggy: '/dityachi-bahhi',
};

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

function buildSchema(product, pageUrl, desc) {
  const catName = CAT_LABELS[product.category] || 'Електромобілі';
  const catUrl = SITE + (CAT_URLS[product.category] || '/catalog.html');
  const inStock = (typeof product.stock === 'number' ? product.stock > 0 : true) && product.active !== false;
  const imgList = Array.isArray(product.images) && product.images.length
    ? product.images.filter(Boolean)
    : [SITE + '/opengraph.jpg'];

  // priceValidUntil — 1 рік вперед
  const pvu = new Date();
  pvu.setFullYear(pvu.getFullYear() + 1);
  const priceValidUntil = pvu.toISOString().substring(0, 10);

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': pageUrl + '#product',
    'name': product.name || '',
    'description': desc,
    'brand': { '@type': 'Brand', 'name': product.brand || 'KidsRide' },
    'sku': product.sku || String(product.id || ''),
    'mpn': product.sku || String(product.id || ''),
    'image': imgList,
    'url': pageUrl,
    'category': catName,
    'offers': {
      '@type': 'Offer',
      '@id': pageUrl + '#offer',
      'url': pageUrl,
      'priceCurrency': 'UAH',
      'price': String(Math.round(Number(product.price || 0))),
      'priceValidUntil': priceValidUntil,
      'availability': inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      'itemCondition': 'https://schema.org/NewCondition',
      'seller': {
        '@type': 'Organization',
        'name': 'KidsRide',
        'url': SITE,
      },
    },
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      {
        '@type': 'ListItem',
        'position': 1,
        'name': 'Головна',
        'item': SITE + '/',
      },
      {
        '@type': 'ListItem',
        'position': 2,
        'name': catName,
        'item': catUrl,
      },
      {
        '@type': 'ListItem',
        'position': 3,
        'name': product.name || '',
        'item': pageUrl,
      },
    ],
  };

  return (
    `<script type="application/ld+json" id="schema-product">${escJson(JSON.stringify(productSchema))}</script>\n` +
    `<script type="application/ld+json" id="schema-breadcrumb">${escJson(JSON.stringify(breadcrumbSchema))}</script>`
  );
}

export default async function handler(req, res) {
  const slug = (req.query.slug || '').trim().toLowerCase();
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;

  if (!slug || !supaUrl || !supaKey) {
    return res.redirect(302, '/catalog.html');
  }

  // Знаходимо товар за slug (розширений select — для schema.org)
  let product = null;
  try {
    const r = await fetch(
      supaUrl +
        '/rest/v1/products?select=id,name,description,short_desc,price,old_price,images,category,brand,slug,sku,stock,active,updated_at&slug=eq.' +
        encodeURIComponent(slug) +
        '&limit=1',
      { headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey } }
    );
    if (r.ok) {
      const arr = await r.json();
      product = arr && arr[0] ? arr[0] : null;
    }
  } catch (_) {}

  if (!product) {
    // Slug ще не заповнений у БД — подаємо product.html, JS завантажить за ID
    let fallbackHtml;
    try { fallbackHtml = fs.readFileSync(path.join(process.cwd(), 'product.html'), 'utf8'); } catch (_) {}
    if (fallbackHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(fallbackHtml);
    }
    return res.redirect(302, '/catalog.html');
  }

  // Зчитуємо шаблон product.html
  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'product.html'), 'utf8');
  } catch (_) {
    return res.redirect(302, '/product.html?id=' + encodeURIComponent(product.id));
  }

  const pageUrl = SITE + '/product/' + product.slug;
  const title = escHtml(product.name) + ' — KidsRide';
  const rawDesc =
    product.short_desc ||
    product.description ||
    'Купити ' + product.name + ' в KidsRide. Гарантія 12 міс., доставка Новою Поштою.';
  const desc = escHtml(rawDesc.substring(0, 160));
  const img = escHtml(
    (Array.isArray(product.images) && product.images[0]) || SITE + '/opengraph.jpg'
  );
  const priceStr = product.price ? String(Math.round(Number(product.price))) : '';

  // Вставляємо правильні meta теги
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[^"]*"/,
      `$1${desc}"`
    )
    .replace(/(<meta[^>]+id="og-title"[^>]+content=")[^"]*"/, `$1${title}"`)
    .replace(/(<meta[^>]+id="og-description"[^>]+content=")[^"]*"/, `$1${desc}"`)
    .replace(/(<meta[^>]+id="og-image"[^>]+content=")[^"]*"/, `$1${img}"`)
    .replace(/(<meta[^>]+id="og-url"[^>]+content=")[^"]*"/, `$1${escHtml(pageUrl)}"`)
    .replace(/(<link[^>]+id="seo-canonical"[^>]+href=")[^"]*"/, `$1${escHtml(pageUrl)}"`)
    .replace(/(<meta[^>]+id="tw-title"[^>]+content=")[^"]*"/, `$1${title}"`)
    .replace(/(<meta[^>]+id="tw-description"[^>]+content=")[^"]*"/, `$1${desc}"`)
    .replace(/(<meta[^>]+id="tw-image"[^>]+content=")[^"]*"/, `$1${img}"`)
    .replace(/(<meta[^>]+id="og-price"[^>]+content=")[^"]*"/, `$1${priceStr}"`);

  // Вставляємо product ID щоб JS не робив lookup по slug
  // + Schema.org JSON-LD безпосередньо в HEAD для Googlebot
  html = html.replace(
    '</head>',
    `<script>window.__KR_PRODUCT_ID__="${product.id}";</script>\n` +
    buildSchema(product, pageUrl, rawDesc.substring(0, 300)) + '\n' +
    '</head>'
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=60');
  res.status(200).send(html);
}
