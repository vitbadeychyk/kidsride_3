// Vercel Serverless Function: SSR-каталог для SEO
// /catalog.html переписується сюди через vercel.json. Сервер одразу додає
// природні HTML-посилання на активні товари, а весь інтерактивний каталог
// продовжує працювати у браузері як і раніше.

import fs from 'fs';
import path from 'path';

const SITE = 'https://www.kidsride.com.ua';
const PAGE_SIZE = 1000;
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
    // Start the SEO query in parallel, but do not make the first response byte
    // wait for all products. The category grid is part of the first streamed
    // chunk; product links are inserted into the second chunk when ready.
    const productsPromise = fetchAllActiveProducts(supaUrl, supaKey)
      .then(value => ({ status: 'fulfilled', value }))
      .catch(reason => ({ status: 'rejected', reason }));
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
    diagnostics.htmlLength = html.length;

    const seoMarkerIndex = html.indexOf(SEO_MARKER);
    const canStream = seoMarkerIndex >= 0 &&
      typeof res.write === 'function' && typeof res.end === 'function';

    if (canStream) {
      // Headers must be sent before write(). Product diagnostics are finalized
      // in logs; the response header intentionally reports the first chunk's
      // state because the product query is still running at this point.
      res.setHeader('X-Catalog-SSR-Products', 'pending');
      res.setHeader('X-Catalog-SSR-Main-Categories', String(diagnostics.mainCategories));
      res.setHeader('X-Catalog-SSR-Marker', String(diagnostics.markerFound));
      res.setHeader('X-Catalog-SSR-HTML-Length', String(diagnostics.htmlLength));
      res.setHeader('X-Catalog-SSR-Product-Links', 'pending');
      res.setHeader('X-Catalog-SSR-Streaming', 'categories-first');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.statusCode = 200;

      // Everything before SEO_PRODUCT_LINKS includes the complete SSR
      // category grid and its Storage image URLs, so the browser can paint it
      // without waiting for products/ostatok.
      res.write(html.slice(0, seoMarkerIndex));

      const productsResult = await productsPromise;
      let seoLinks = '';
      if (productsResult.status === 'fulfilled') {
        const products = productsResult.value;
        seoLinks = buildSeoProductLinks(products);
        diagnostics.products = products.length;
        diagnostics.productLinks = (seoLinks.match(/<a\b[^>]*href="[^"]*\/product\//gi) || []).length;
      } else {
        // Не ламаємо каталог, якщо Supabase тимчасово недоступний:
        // клієнтський код все одно спробує завантажити товари у браузері.
        console.error('[catalog SSR] products fetch failed:', productsResult.reason?.message || productsResult.reason);
      }
      diagnostics.htmlLength = html.length - SEO_MARKER.length + seoLinks.length;
      console.error('[catalog SSR] diagnostics:', JSON.stringify(diagnostics));
      res.end(seoLinks + html.slice(seoMarkerIndex + SEO_MARKER.length));
      return;
    }

    // Non-streaming fallback for local adapters that do not expose write/end.
    const productsResult = await productsPromise;
    if (productsResult.status === 'fulfilled') {
      const products = productsResult.value;
      const seoLinks = buildSeoProductLinks(products);
      diagnostics.products = products.length;
      diagnostics.productLinks = (seoLinks.match(/<a\b[^>]*href="[^"]*\/product\//gi) || []).length;
      html = html.replace(SEO_MARKER, seoLinks);
    } else {
      console.error('[catalog SSR] products fetch failed:', productsResult.reason?.message || productsResult.reason);
      html = html.replace(SEO_MARKER, '');
    }
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