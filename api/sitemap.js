// Vercel Serverless Function: генерує динамічний sitemap.xml з усіма товарами
// Потрібні env vars у Vercel: SUPABASE_URL, SUPABASE_ANON_KEY
// Після додавання — видаліть статичний sitemap.xml з репозиторію

const SITE = 'https://www.kidsride.com.ua';

const STATIC_URLS = [
  { loc: SITE + '/',                              changefreq: 'daily',   priority: '1.0' },
  { loc: SITE + '/catalog.html',                  changefreq: 'daily',   priority: '0.9' },
  { loc: SITE + '/catalog.html?cat=jeep',         changefreq: 'weekly',  priority: '0.8' },
  { loc: SITE + '/catalog.html?cat=quad',         changefreq: 'weekly',  priority: '0.8' },
  { loc: SITE + '/catalog.html?cat=moto',         changefreq: 'weekly',  priority: '0.8' },
  { loc: SITE + '/catalog.html?cat=car',          changefreq: 'weekly',  priority: '0.8' },
  { loc: SITE + '/catalog.html?cat=tractor',      changefreq: 'weekly',  priority: '0.8' },
  { loc: SITE + '/catalog.html?cat=walker',       changefreq: 'weekly',  priority: '0.7' },
  { loc: SITE + '/catalog.html?cat=truck',        changefreq: 'weekly',  priority: '0.7' },
  { loc: SITE + '/catalog.html?cat=buggy',        changefreq: 'weekly',  priority: '0.7' },
  { loc: SITE + '/calculator.html',               changefreq: 'monthly', priority: '0.6' },
  { loc: SITE + '/compare.html',                  changefreq: 'monthly', priority: '0.5' },
];

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default async function handler(req, res) {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;

  let productUrls = [];

  if (supaUrl && supaKey) {
    try {
      const r = await fetch(
        supaUrl + '/rest/v1/products?select=id,name,updated_at&active=eq.true&order=created_at.desc',
        {
          headers: {
            apikey: supaKey,
            Authorization: 'Bearer ' + supaKey,
          },
        }
      );
      if (r.ok) {
        const products = await r.json();
        productUrls = products.map((p) => ({
          loc: SITE + '/product.html?id=' + encodeURIComponent(p.id),
          lastmod: p.updated_at ? p.updated_at.substring(0, 10) : '',
          changefreq: 'weekly',
          priority: '0.7',
        }));
      }
    } catch (_) {
      // Fallback на статичні URL при помилці Supabase
    }
  }

  const allUrls = [...STATIC_URLS, ...productUrls];

  const urlEntries = allUrls
    .map((u) => {
      const lastmod = u.lastmod ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : '';
      return `  <url>
    <loc>${escapeXml(u.loc)}</loc>${lastmod}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(xml);
}
