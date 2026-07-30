// Vercel Serverless Function: SSR для вкладених URL категорій
//
// Підтримує два типи URL:
//   /dytiachyi-transport              → main_category (головна)
//   /dytiachyi-transport/bihovely     → subcategory (підкатегорія)
//
// Що робить:
//  1. Парсить mainSlug і catSlug з URL
//  2. Завантажує дані з Supabase
//  3. Вставляє правильні <title>, <meta>, canonical, Schema.org у catalog.html
//  4. Передає __KR_CAT_ID__ / __KR_MAIN_CAT_ID__ для JS

import fs   from 'fs';
import path from 'path';

const SITE = 'https://www.kidsride.com.ua';

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildBreadcrumbs(items) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type':    'ListItem',
      position:   i + 1,
      name:       item.name,
      item:       item.url,
    })),
  });
}

function buildCollectionSchema(name, desc, url) {
  return JSON.stringify({
    '@context':   'https://schema.org',
    '@type':      'CollectionPage',
    name:         name + ' — KidsRide',
    description:  desc,
    url,
  });
}

export default async function handler(req, res) {
  const mainSlug = (req.query.main_slug || '').trim().toLowerCase();
  const catSlug  = (req.query.cat_slug  || '').trim().toLowerCase();
  const supaUrl  = process.env.SUPABASE_URL;
  const supaKey  = process.env.SUPABASE_ANON_KEY;

  if (!mainSlug || !supaUrl || !supaKey) {
    return res.redirect(302, '/catalog.html');
  }

  const headers = { apikey: supaKey, Authorization: 'Bearer ' + supaKey };

  // ── 1. Завантажуємо main_category по slug ────────────────────────────────
  let mainCat = null;
  try {
    const r = await fetch(
      supaUrl + '/rest/v1/main_categories?select=id,name,slug&slug=eq.' +
        encodeURIComponent(mainSlug) + '&active=eq.true&limit=1',
      { headers }
    );
    if (r.ok) {
      const arr = await r.json();
      if (arr && arr[0]) mainCat = arr[0];
    }
  } catch (_) {}

  // Якщо main_category не знайдено — 404 → каталог
  if (!mainCat) {
    return res.redirect(302, '/catalog.html');
  }

  // ── 2. Якщо є catSlug — шукаємо підкатегорію ────────────────────────────
  let subCat = null;
  if (catSlug) {
    try {
      const r = await fetch(
        supaUrl + '/rest/v1/categories?select=id,name,slug,main_category_id&slug=eq.' +
          encodeURIComponent(catSlug) +
          '&main_category_id=eq.' + mainCat.id +
          '&active=eq.true&limit=1',
        { headers }
      );
      if (r.ok) {
        const arr = await r.json();
        if (arr && arr[0]) subCat = arr[0];
      }
    } catch (_) {}

    // catSlug передано але не знайдено → redirect на головну категорію
    if (!subCat) {
      return res.redirect(301, '/' + mainSlug);
    }
  }

  // ── 3. Читаємо catalog.html ──────────────────────────────────────────────
  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'catalog.html'), 'utf8');
  } catch (_) {
    return res.redirect(302, '/catalog.html');
  }

  // ── 4. SEO дані залежно від типу сторінки ────────────────────────────────
  const isSubPage = !!subCat;
  const pageName  = isSubPage ? subCat.name  : mainCat.name;
  const pageUrl   = isSubPage
    ? SITE + '/' + mainCat.slug + '/' + subCat.slug
    : SITE + '/' + mainCat.slug;

  const title   = escHtml(pageName + ' — KidsRide | Купити в Україні');
  const desc    = escHtml('Купити ' + pageName.toLowerCase() +
    ' в інтернет-магазині KidsRide. Великий вибір, гарантія 12 міс., доставка Новою Поштою по всій Україні.');
  const img     = escHtml(SITE + '/opengraph.jpg');
  const pageUrlE = escHtml(pageUrl);

  // Breadcrumbs
  const breadcrumbs = [
    { name: 'Головна', url: SITE + '/' },
    { name: 'Каталог', url: SITE + '/catalog.html' },
    { name: mainCat.name, url: SITE + '/' + mainCat.slug },
  ];
  if (isSubPage) breadcrumbs.push({ name: subCat.name, url: pageUrl });

  // JS змінні для catalog.html
  const catData = isSubPage
    ? `window.__KR_CAT_ID__=${subCat.id};window.__KR_MAIN_CAT_ID__=${mainCat.id};`
    : `window.__KR_MAIN_CAT_ID__=${mainCat.id};`;

  // ── 5. Замінюємо meta теги ───────────────────────────────────────────────
  html = html
    .replace(/<title>[^<]*<\/title>/,                                    `<title>${title}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*"/,           `$1${desc}"`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*"/,          `$1${title}"`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*"/,    `$1${desc}"`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*"/,            `$1${pageUrlE}"`)
    .replace(/(<meta\s+property="og:image"\s+content=")[^"]*"/,          `$1${img}"`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*"/,         `$1${title}"`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*"/,   `$1${desc}"`)
    .replace(/(<link\s+rel="canonical"[^>]+href=")[^"]*"/,               `$1${pageUrlE}"`);

  // ── 6. Вставляємо Schema.org + catData перед </head> ────────────────────
  const schemas =
    `<script>${catData}</script>\n` +
    `<script type="application/ld+json">${buildBreadcrumbs(breadcrumbs)}</script>\n` +
    `<script type="application/ld+json">${buildCollectionSchema(pageName, 'Купити ' + pageName.toLowerCase() + ' в KidsRide', pageUrl)}</script>\n`;

  html = html.replace('</head>', schemas + '</head>');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=300, stale-while-revalidate=600');
  res.status(200).send(html);
}
