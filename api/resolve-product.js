// Vercel Serverless Function: SSR-lite handler для SEO-friendly product URLs
// Маршрут: /product/:slug → цей файл (через vercel.json rewrite)
//
// Що робить:
//  1. Знаходить товар у Supabase за slug
//  2. Читає product.html і вставляє правильні <title>, <meta>, OG теги
//  3. Вставляє window.__KR_PRODUCT_ID__ щоб JS не робив зайвий запит
//  4. Повертає готовий HTML — Google бачить правильний контент БЕЗ JS

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

export default async function handler(req, res) {
  const slug = (req.query.slug || '').trim().toLowerCase();
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;

  if (!slug || !supaUrl || !supaKey) {
    return res.redirect(302, '/catalog.html');
  }

  // Знаходимо товар за slug
  let product = null;
  try {
    const r = await fetch(
      supaUrl +
        '/rest/v1/products?select=id,name,short_desc,price,old_price,images,category,brand,slug&slug=eq.' +
        encodeURIComponent(slug) +
        '&active=eq.true&limit=1',
      { headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey } }
    );
    if (r.ok) {
      const arr = await r.json();
      product = arr && arr[0] ? arr[0] : null;
    }
  } catch (_) {}

  if (!product) {
    // Slug ще не заповнений у БД — подаємо product.html, JS завантажить з sessionStorage або за ?id=
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
  const desc = escHtml(
    product.short_desc ||
      'Купити ' + product.name + ' в KidsRide. Гарантія 12 міс., доставка Новою Поштою.'
  );
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
  html = html.replace(
    '</head>',
    `<script>window.__KR_PRODUCT_ID__="${product.id}";</script>\n</head>`
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=60');
  res.status(200).send(html);
}
