// Vercel Serverless Function: SSR-каталог для SEO
// /catalog.html переписується сюди через vercel.json. Сервер одразу додає
// природні HTML-посилання на активні товари, а весь інтерактивний каталог
// продовжує працювати у браузері як і раніше.

import fs from 'fs';
import path from 'path';

const SITE = 'https://www.kidsride.com.ua';
const PAGE_SIZE = 1000;

function escHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchAllActiveProducts(supaUrl, supaKey) {
  const all = [];
  let offset = 0;

  while (true) {
    const query =
      '/rest/v1/products?select=id,name,sku,slug&active=eq.true&slug=not.is.null&order=id.asc';
    const response = await fetch(supaUrl + query, {
      headers: {
        apikey: supaKey,
        Authorization: 'Bearer ' + supaKey,
        Range: offset + '-' + (offset + PAGE_SIZE - 1),
        'Range-Unit': 'items',
      },
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error('Supabase ' + response.status + ': ' + message.slice(0, 240));
    }

    const page = await response.json();
    if (!Array.isArray(page) || !page.length) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += page.length;
  }

  return all;
}

function buildSeoProductLinks(products) {
  const items = products
    .filter(product => String(product.slug || '').trim())
    .map(product => {
      const slug = String(product.slug).trim();
      const name = String(product.name || product.sku || 'Товар KidsRide').trim();
      const href = SITE + '/product/' + encodeURIComponent(slug);
      return '      <li><a href="' + escHtml(href) + '">' + escHtml(name) + '</a></li>';
    })
    .join('\n');

  if (!items) return '';

  return `
<section id="seoProductLinks" class="seo-product-links" aria-labelledby="seoProductLinksTitle">
  <h2 id="seoProductLinksTitle">Товари каталогу</h2>
  <p>Активні товари KidsRide</p>
  <ul>
${items}
  </ul>
</section>
`;
}

export default async function handler(req, res) {
  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'catalog.html'), 'utf8');
  } catch (_) {
    return res.status(500).send('Catalog template not found');
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

  if (supaUrl && supaKey) {
    try {
      const products = await fetchAllActiveProducts(supaUrl, supaKey);
      html = html.replace('<!-- SEO_PRODUCT_LINKS -->', buildSeoProductLinks(products));
    } catch (error) {
      // Не ламаємо каталог, якщо Supabase тимчасово недоступний:
      // клієнтський код все одно спробує завантажити товари у браузері.
      console.error('[catalog SSR] products fetch failed:', error.message);
      html = html.replace('<!-- SEO_PRODUCT_LINKS -->', '');
    }
  } else {
    html = html.replace('<!-- SEO_PRODUCT_LINKS -->', '');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
}