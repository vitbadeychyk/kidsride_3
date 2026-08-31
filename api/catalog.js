// Vercel Serverless Function: SSR-каталог для SEO
// /catalog.html переписується сюди через vercel.json. Сервер одразу додає
// природні HTML-посилання на активні товари, а весь інтерактивний каталог
// продовжує працювати у браузері як і раніше.

import fs from 'fs';
import path from 'path';

const SITE = 'https://www.kidsride.com.ua';
const SEO_MARKER = '<!-- SEO_PRODUCT_LINKS -->';
const MAIN_CATEGORIES_MARKER = '<!-- SSR_MAIN_CATEGORIES -->';
// Browser revalidates on navigation, while Vercel's CDN serves the SSR
// response for five minutes and refreshes it in the background afterwards.
const CATALOG_CACHE_CONTROL =
  'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';

function escHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchActiveMainCategories(supaUrl, supaKey) {
  const query =
    '/rest/v1/main_categories?select=id,name,slug,image_url,sort_order&active=eq.true&order=sort_order.asc,name.asc';
  const response = await fetch(supaUrl + query, {
    headers: {
      apikey: supaKey,
      Authorization: 'Bearer ' + supaKey,
    },
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error('Supabase ' + response.status + ': ' + message.slice(0, 240));
  }

  const categories = await response.json();
  return Array.isArray(categories) ? categories : [];
}

function buildMainCategoryTiles(categories) {
  let eagerImages = 0;
  let lcpImageMarked = false;

  return categories
    .map(category => {
      const id = Number(category.id);
      if (!Number.isFinite(id)) return '';

      const name = String(category.name || 'Категорія').trim();
      const slug = String(category.slug || '').trim();
      const imageUrl = String(category.image_url || '').trim();
      const sortOrder = category.sort_order == null ? '' : String(category.sort_order);
      const isLcpImage =
        !lcpImageMarked && name === 'Електромобілі' && Boolean(imageUrl);
      if (isLcpImage) lcpImageMarked = true;
      let media;

      if (imageUrl) {
        const loading = eagerImages < 2 ? 'eager' : 'lazy';
        eagerImages += 1;
        const fetchPriority = isLcpImage ? ' fetchpriority="high"' : '';
        media =
          '<img class="mob-cat-tile-img" src="' + escHtml(imageUrl) +
          '" alt="' + escHtml(name) + '" loading="' + loading +
          '" decoding="async"' + fetchPriority + '>';
      } else {
        media = '<div class="mob-cat-tile-icon">' + escHtml(category.icon || '') + '</div>';
      }

      return [
        '<div class="mob-cat-tile" data-ssr-main-category="true"',
        ' data-main-category-id="' + id + '"',
        ' data-main-category-name="' + escHtml(name) + '"',
        ' data-main-category-slug="' + escHtml(slug) + '"',
        ' data-main-category-image-url="' + escHtml(imageUrl) + '"',
        ' data-main-category-sort-order="' + escHtml(sortOrder) + '"',
        ' onclick="_mobNavShowSub(' + id + ')">',
        media,
        '<div class="mob-cat-tile-grad"></div>',
        '<div class="mob-cat-tile-name">' + escHtml(name) + '</div>',
        '</div>',
      ].join('');
    })
    .filter(Boolean)
    .join('\n');
}

export default async function handler(req, res) {
  // Set this before any streaming starts. The explicit /catalog.html and
  // /api/catalog rules in vercel.json keep the generic HTML no-store rule
  // from disabling CDN caching for this SSR endpoint.
  res.setHeader('Cache-Control', CATALOG_CACHE_CONTROL);

  let html;
  try {
    // catalog.html is the public URL handled by vercel.json. Keep the SSR
    // template under a different filename so Vercel cannot serve it directly
    // before applying the rewrite to this function.
    html = fs.readFileSync(path.join(process.cwd(), 'catalog-template.html'), 'utf8');
  } catch (_) {
    return res.status(500).send('Catalog template not found');
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  const diagnostics = {
    products: 0,
    mainCategories: 0,
    markerFound: html.includes(SEO_MARKER),
    mainCategoriesMarkerFound: html.includes(MAIN_CATEGORIES_MARKER),
    htmlLength: html.length,
    productLinks: 0,
    supabaseConfigured: Boolean(supaUrl && supaKey),
  };
  const searchQuery = (() => {
    try {
      return new URL(req.url || '', SITE).searchParams.get('search')?.trim() || '';
    } catch (_) {
      return String(req.query?.search || '').trim();
    }
  })();

  // Search requests go straight to the interactive catalog. Do not stream
  // the category landing page or the large SEO product list first — both are
  // useful for the plain catalog route, but they cause a visible detour when
  // the user has explicitly searched for an article/SKU.
  if (searchQuery) {
    html = html
      .replace(MAIN_CATEGORIES_MARKER, '')
      .replace(SEO_MARKER, '');
    diagnostics.mainCategories = 0;
    diagnostics.productLinks = 0;
    diagnostics.htmlLength = html.length;
    res.setHeader('X-Catalog-SSR-Products', 'skipped-search');
    res.setHeader('X-Catalog-SSR-Main-Categories', 'skipped-search');
    res.setHeader('X-Catalog-SSR-Marker', String(diagnostics.markerFound));
    res.setHeader('X-Catalog-SSR-HTML-Length', String(diagnostics.htmlLength));
    res.setHeader('X-Catalog-SSR-Product-Links', 'skipped-search');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  }

  if (supaUrl && supaKey) {
    // На стартовій сторінці каталогу потрібні лише 9 основних категорій.
    // Не завантажуємо весь список товарів і не показуємо SEO-блок
    // «Товари каталогу» під картками.
    const categoriesResult = await Promise.allSettled([
      fetchActiveMainCategories(supaUrl, supaKey),
    ]).then(results => results[0]);

    if (categoriesResult.status === 'fulfilled') {
      const categories = categoriesResult.value;
      const tiles = buildMainCategoryTiles(categories);
      diagnostics.mainCategories = categories.length;
      html = html.replace(MAIN_CATEGORIES_MARKER, tiles);
    } else {
      // Без SSR-категорій клієнтський код завантажить їх як раніше.
      console.error('[catalog SSR] main_categories fetch failed:', categoriesResult.reason?.message || categoriesResult.reason);
      html = html.replace(MAIN_CATEGORIES_MARKER, '');
    }
    html = html.replace(SEO_MARKER, '');
    diagnostics.htmlLength = html.length;
  } else {
    html = html.replace(SEO_MARKER, '');
    html = html.replace(MAIN_CATEGORIES_MARKER, '');
    diagnostics.htmlLength = html.length;
  }

  console.error('[catalog SSR] diagnostics:', JSON.stringify(diagnostics));
  res.setHeader('X-Catalog-SSR-Products', String(diagnostics.products));
  res.setHeader('X-Catalog-SSR-Main-Categories', String(diagnostics.mainCategories));
  res.setHeader('X-Catalog-SSR-Marker', String(diagnostics.markerFound));
  res.setHeader('X-Catalog-SSR-HTML-Length', String(diagnostics.htmlLength));
  res.setHeader('X-Catalog-SSR-Product-Links', String(diagnostics.productLinks));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}