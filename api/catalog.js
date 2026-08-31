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

function getCategoryImageAttrs(imageUrl) {
  const marker = '/storage/v1/object/public/';
  const markerIndex = imageUrl.indexOf(marker);
  if (markerIndex < 0) return { src: imageUrl, srcset: '', sizes: '' };

  const renderBase =
    imageUrl.slice(0, markerIndex) +
    '/storage/v1/render/image/public/' +
    imageUrl.slice(markerIndex + marker.length);
  const widths = [320, 480, 600];
  const srcset = widths.map(width =>
    renderBase + '?width=' + width + '&height=' + width +
    '&resize=cover&format=webp&quality=90 ' + width + 'w'
  ).join(', ');

  return {
    // Keep the original, cache-busted URL as the fallback/source of truth.
    src: imageUrl,
    srcset,
    sizes: '(min-width: 1280px) 18vw, (min-width: 768px) 30vw, 48vw',
  };
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

async function fetchActiveProductLinks(supaUrl, supaKey) {
  const pageSize = 1000;
  const baseQuery =
    '/rest/v1/products?select=id,name,slug&active=eq.true&slug=not.is.null' +
    '&order=created_at.desc';
  const getPage = async offset => {
    const response = await fetch(
      supaUrl + baseQuery + '&limit=' + pageSize + '&offset=' + offset,
      {
        headers: {
          apikey: supaKey,
          Authorization: 'Bearer ' + supaKey,
          Prefer: 'count=exact',
        },
      }
    );

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error('Supabase ' + response.status + ': ' + message.slice(0, 240));
    }

    const rows = await response.json();
    return {
      rows: Array.isArray(rows) ? rows : [],
      total: Number(response.headers.get('content-range')?.split('/')[1]),
    };
  };

  const first = await getPage(0);
  const total = Number.isFinite(first.total) ? first.total : first.rows.length;
  const offsets = [];
  for (let offset = pageSize; offset < total; offset += pageSize) {
    offsets.push(offset);
  }
  const rest = await Promise.all(offsets.map(getPage));
  return [first, ...rest].flatMap(page => page.rows);
}

function buildProductLinks(products) {
  const seen = new Set();
  const links = products
    .map(product => {
      const slug = String(product.slug || '').trim();
      if (!slug || seen.has(slug)) return '';
      seen.add(slug);
      return '<a href="/product/' + encodeURIComponent(slug) + '">' +
        escHtml(product.name || slug) + '</a>';
    })
    .filter(Boolean)
    .join('');

  if (!links) return '';

  // Keep these links available to crawlers without rendering a second
  // product catalogue for visitors. The catalogue itself remains client-side.
  return '<nav aria-label="Товари каталогу" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">' +
    links + '</nav>';
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
        const image = getCategoryImageAttrs(imageUrl);
        media =
          '<img class="mob-cat-tile-img" src="' + escHtml(imageUrl) +
          '" alt="' + escHtml(name) + '" loading="' + loading +
          '" decoding="async"' + fetchPriority +
          (image.srcset ? '" srcset="' + escHtml(image.srcset) +
            '" sizes="' + escHtml(image.sizes) : '') + '">';
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
    // Категорії та SEO-посилання не залежать одне від одного. Запускаємо
    // обидва запити паралельно, щоб один не додавався до TTFB іншого.
    const [categoriesResult, productsResult] = await Promise.allSettled([
      fetchActiveMainCategories(supaUrl, supaKey),
      fetchActiveProductLinks(supaUrl, supaKey),
    ]);

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

    if (productsResult.status === 'fulfilled') {
      const products = productsResult.value;
      const productLinks = buildProductLinks(products);
      diagnostics.products = products.length;
      diagnostics.productLinks = products.filter(product => String(product.slug || '').trim()).length;
      html = html.replace(SEO_MARKER, productLinks);
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