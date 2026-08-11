// Vercel Serverless Function: динамічний sitemap.xml з усіма товарами
// Використовує clean product URLs (/product/:slug) якщо slug є
// Пагінація по 1000 рядків — обходить обмеження Supabase за замовчуванням

const SITE = 'https://www.kidsride.com.ua';

const STATIC_URLS = [
  { loc: SITE + '/',                              changefreq: 'daily',   priority: '1.0' },
  { loc: SITE + '/catalog.html',                  changefreq: 'daily',   priority: '0.9' },
  { loc: SITE + '/dityachi-dzhypy',               changefreq: 'weekly',  priority: '0.85' },
  { loc: SITE + '/dityachi-kvadratsykly',         changefreq: 'weekly',  priority: '0.85' },
  { loc: SITE + '/dityachi-motosykly',            changefreq: 'weekly',  priority: '0.85' },
  { loc: SITE + '/dityachi-mashynky',             changefreq: 'weekly',  priority: '0.85' },
  { loc: SITE + '/dityachi-traktory',             changefreq: 'weekly',  priority: '0.80' },
  { loc: SITE + '/kataly-tolokary',               changefreq: 'weekly',  priority: '0.75' },
  { loc: SITE + '/dityachi-vantazhivky',          changefreq: 'weekly',  priority: '0.75' },
  { loc: SITE + '/dityachi-bahhi',                changefreq: 'weekly',  priority: '0.75' },
  { loc: SITE + '/calculator.html',               changefreq: 'monthly', priority: '0.60' },
  { loc: SITE + '/compare.html',                  changefreq: 'monthly', priority: '0.50' },
];

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Завантажує ВСІ активні товари через пагінацію (Supabase limit=1000 за замовч.)
async function fetchAllProducts(supaUrl, supaKey) {
  const PAGE = 1000;
  let all = [];
  let offset = 0;

  while (true) {
    const r = await fetch(
      supaUrl + '/rest/v1/products?select=id,slug,updated_at&active=eq.true&order=id.asc',
      {
        headers: {
          apikey: supaKey,
          Authorization: 'Bearer ' + supaKey,
          // Запитуємо діапазон [offset, offset+PAGE-1]
          Range: `${offset}-${offset + PAGE - 1}`,
          'Range-Unit': 'items',
        },
      }
    );

    if (!r.ok) break;

    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;

    all = all.concat(page);

    // Якщо отримали менше ніж PAGE — це остання сторінка
    if (page.length < PAGE) break;

    offset += PAGE;
  }

  return all;
}

export default async function handler(req, res) {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;

  let productUrls = [];

  if (supaUrl && supaKey) {
    try {
      const products = await fetchAllProducts(supaUrl, supaKey);
      productUrls = products.map(p => ({
        loc: SITE + (p.slug ? '/product/' + p.slug : '/product.html?id=' + encodeURIComponent(p.id)),
        lastmod: p.updated_at ? p.updated_at.substring(0, 10) : '',
        changefreq: 'weekly',
        priority: '0.70',
      }));
    } catch (_) {}
  }

  const allUrls = [...STATIC_URLS, ...productUrls];

  const urlEntries = allUrls
    .map(u => {
      const lastmod = u.lastmod ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : '';
      return `  <url>\n    <loc>${escapeXml(u.loc)}</loc>${lastmod}\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(xml);
}
