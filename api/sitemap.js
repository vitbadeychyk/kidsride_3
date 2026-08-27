// Vercel Serverless Function: динамічний sitemap.xml
// URL структура:
//   /                                    → головна
//   /catalog.html                        → каталог (загальний)
//   /:main_slug                          → головна категорія (elektromobili, koliasky...)
//   /:main_slug/:cat_slug                → підкатегорія (dytiachyi-transport/bihovely)
//   /product/:slug                       → сторінка товару

const SITE = 'https://www.kidsride.com.ua';

const STATIC_URLS = [
  { loc: SITE + '/',             changefreq: 'daily',  priority: '1.0' },
  { loc: SITE + '/catalog.html', changefreq: 'daily',  priority: '0.9' },
];

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function supaFetch(supaUrl, supaKey, path) {
  const PAGE = 1000;
  let all = [], offset = 0;
  while (true) {
    const r = await fetch(supaUrl + '/rest/v1/' + path, {
      headers: {
        apikey:        supaKey,
        Authorization: 'Bearer ' + supaKey,
        Range:         `${offset}-${offset + PAGE - 1}`,
        'Range-Unit':  'items',
      },
    });
    if (!r.ok) break;
    const page = await r.json();
    if (!Array.isArray(page) || !page.length) break;
    all = all.concat(page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export default async function handler(req, res) {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;

  let mainCatUrls  = [];
  let categoryUrls = [];
  let productUrls  = [];

  if (supaUrl && supaKey) {
    // ── Головні категорії ──────────────────────────────────────────────────
    let mainCatMap = new Map(); // id → slug
    try {
      const mainCats = await supaFetch(
        supaUrl, supaKey,
        'main_categories?select=id,slug,updated_at&active=eq.true&order=id.asc'
      );
      for (const c of mainCats) {
        if (!c.slug) continue;
        mainCatMap.set(c.id, c.slug);
        mainCatUrls.push({
          loc:        SITE + '/' + c.slug,
          lastmod:    c.updated_at ? c.updated_at.substring(0, 10) : '',
          changefreq: 'weekly',
          priority:   '0.85',
        });
      }
    } catch (_) {}

    // ── Підкатегорії — вкладені URL /:main_slug/:cat_slug ─────────────────
    try {
      const cats = await supaFetch(
        supaUrl, supaKey,
        'categories?select=id,slug,main_category_id,updated_at&active=eq.true&order=id.asc'
      );
      for (const c of cats) {
        if (!c.slug) continue;
        const mainSlug = mainCatMap.get(c.main_category_id);
        const loc = mainSlug
          ? SITE + '/' + mainSlug + '/' + c.slug
          : SITE + '/' + c.slug;
        categoryUrls.push({
          loc,
          lastmod:    c.updated_at ? c.updated_at.substring(0, 10) : '',
          changefreq: 'weekly',
          priority:   '0.80',
        });
      }
    } catch (_) {}

    // ── Товари ─────────────────────────────────────────────────────────────
    // Sitemap має містити кожен активний товар із валідним slug.
    // Не використовуємо view products_sitemap: у ньому була додаткова умова
    // щодо довжини description (>= 400 символів), через яку короткі описи
    // виключалися з індексації, хоча сторінка товару існує.
    try {
      const products = await supaFetch(
        supaUrl, supaKey,
        'products?select=id,slug,updated_at&active=eq.true&slug=not.is.null&order=id.asc'
      );
      for (const p of products) {
        if (!String(p.slug || '').trim()) continue;
        productUrls.push({
          loc:        SITE + '/product/' + p.slug,
          lastmod:    p.updated_at ? p.updated_at.substring(0, 10) : '',
          changefreq: 'weekly',
          priority:   '0.70',
        });
      }
    } catch (_) {}
  }

  const allUrls = [...STATIC_URLS, ...mainCatUrls, ...categoryUrls, ...productUrls];

  const entries = allUrls.map(u => {
    const lastmod = u.lastmod
      ? `\n    <lastmod>${escXml(u.lastmod)}</lastmod>`
      : '';
    return `  <url>\n    <loc>${escXml(u.loc)}</loc>${lastmod}\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`;
  }).join('\n');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries + '\n</urlset>';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(xml);
}
