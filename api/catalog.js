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

// Small deploy-time bootstrap for the landing screen. This is deliberately
// limited to the nine main category tiles; it is not product/catalog data.
// The live query below still refreshes the category hierarchy after the first
// response chunk, so changes in the database are picked up without making the
// first mobile paint depend on Supabase.
const BOOTSTRAP_MAIN_CATEGORIES = [
  ['Електромобілі', 'elektromobili', 'main/elektromobili-600.webp', 1],
  ['Дитячий транспорт', 'dytiachyi-transport', 'main/dytiachyi-transport-600.webp', 2],
  ['Товари для дівчаток', 'tovary-dlia-divchatok', 'main/tovary-dlia-divchatok-600.webp', 3],
  ['Меблі', 'mebli', 'main/mebli-600.webp', 4],
  ['Товари для немовлят', 'tovary-dlia-nemovliat', 'main/tovary-dlia-nemovliat-600.webp', 5],
  ['Активний відпочинок', 'aktyvnyi-vidpochynok', 'main/aktyvnyi-vidpochynok-600.webp', 6],
  ['Басейни', 'baseiny', 'main/baseiny-600.webp', 7],
  ['Коляски', 'koliasky', 'main/koliasky-600.webp', 8],
  ['Надходження за тиждень', 'hadkhodzhennia-za-tyzhden', 'main/hadkhodzhennia-za-tyzhden-600.webp', 9],
].map(([name, slug, image, sort_order], index) => ({
  // Negative IDs cannot collide with database IDs. Tiles with these IDs use
  // their slug for navigation until the live category list is available.
  id: -(index + 1),
  name,
  slug,
  image_url: 'https://gwslintdrtnvbfjvivbb.supabase.co/storage/v1/object/public/category-images/' + image,
  sort_order,
}));

let mainCategoriesCache = BOOTSTRAP_MAIN_CATEGORIES;

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
  if (markerIndex < 0) {
    return { src: imageUrl, srcset: '', sizes: '', preloadSrc: imageUrl };
  }

  const renderBase =
    imageUrl.slice(0, markerIndex) +
    '/storage/v1/render/image/public/' +
    imageUrl.slice(markerIndex + marker.length);
  const widths = [320, 480, 600];
  const toRenderUrl = width =>
    renderBase + '?width=' + width + '&height=' + width +
    '&resize=cover&format=webp&quality=85';
  const srcset = widths.map(width => toRenderUrl(width) + ' ' + width + 'w').join(', ');

  return {
    // Keep the original, cache-busted URL as the fallback/source of truth.
    src: imageUrl,
    srcset,
    sizes: '(min-width: 1280px) 18vw, (min-width: 768px) 30vw, 48vw',
    preloadSrc: toRenderUrl(480),
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

  return categories
    .map(category => {
      const id = Number(category.id);
      if (!Number.isFinite(id)) return '';

      const name = String(category.name || 'Категорія').trim();
      const slug = String(category.slug || '').trim();
      const imageUrl = String(category.image_url || '').trim();
      const sortOrder = category.sort_order == null ? '' : String(category.sort_order);
      // The first category image is the expected mobile LCP candidate.
      // Below-the-fold tiles remain lazy so they do not compete with it.
      const isLcpImage = Boolean(imageUrl) && eagerImages === 0;
      let media;

      if (imageUrl) {
        const loading = isLcpImage ? 'eager' : 'lazy';
        eagerImages += 1;
        const fetchPriority = isLcpImage ? ' fetchpriority="high"' : '';
        const image = getCategoryImageAttrs(imageUrl);
        media =
          '<img class="mob-cat-tile-img" src="' + escHtml(imageUrl) +
          '" alt="' + escHtml(name) + '" loading="' + loading +
          '" decoding="async"' + fetchPriority +
          (image.srcset ? ' srcset="' + escHtml(image.srcset) +
            '" sizes="' + escHtml(image.sizes) : '') + '">';
      } else {
        media = '<div class="mob-cat-tile-icon">' + escHtml(category.icon || '') + '</div>';
      }

       const clickAction = id > 0
         ? '_mobNavShowSub(' + id + ')'
         : "_mobNavShowSubBySlug('" + escHtml(slug) + "')";
       return [
        '<div class="mob-cat-tile" data-ssr-main-category="true"',
        ' data-main-category-id="' + id + '"',
        ' data-main-category-name="' + escHtml(name) + '"',
        ' data-main-category-slug="' + escHtml(slug) + '"',
        ' data-main-category-image-url="' + escHtml(imageUrl) + '"',
        ' data-main-category-sort-order="' + escHtml(sortOrder) + '"',
        ' onclick="' + clickAction + '">',
        media,
        '<div class="mob-cat-tile-grad"></div>',
        '<div class="mob-cat-tile-name">' + escHtml(name) + '</div>',
        '</div>',
      ].join('');
    })
    .filter(Boolean)
    .join('\n');
}

function buildCategoryPreload(categories) {
  const first = categories.find(category => String(category.image_url || '').trim());
  if (!first) return '';
  const image = getCategoryImageAttrs(String(first.image_url).trim());
  return '<link rel="preload" as="image" href="' + escHtml(image.preloadSrc) +
    '" fetchpriority="high"' +
    (image.srcset ? ' imagesrcset="' + escHtml(image.srcset) +
      '" imagesizes="' + escHtml(image.sizes) + '"' : '') + '>';
}

export default async function handler(req, res) {
  // Set this before any streaming starts. The explicit /catalog.html and
  // /api/catalog rules in vercel.json keep this public SSR response cacheable.
  res.setHeader('Cache-Control', CATALOG_CACHE_CONTROL);
  // Keep the browser revalidation policy above, while making the intended
  // Vercel edge policy explicit even if another route rule is later added.
  res.setHeader('Vercel-CDN-Cache-Control',
    'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');

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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
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

  // Bootstrap the nine-tile landing screen from deploy-time cached data.
  // Supabase is intentionally not awaited before this HTML is written.
  diagnostics.mainCategories = mainCategoriesCache.length;
  html = html.replace(MAIN_CATEGORIES_MARKER, buildMainCategoryTiles(mainCategoriesCache));
  const preload = buildCategoryPreload(mainCategoriesCache);
  if (preload) html = html.replace('</head>', preload + '</head>');

  if (supaUrl && supaKey) {
    const seoIndex = html.indexOf(SEO_MARKER);
    const canStream = seoIndex >= 0 && typeof res.write === 'function' && typeof res.end === 'function';
    if (canStream) {
      // Headers must be complete before write(). Product totals are marked as
      // streamed because they are intentionally resolved after the first
      // paint-priority chunk has reached the browser.
      diagnostics.htmlLength = html.length;
      res.setHeader('X-Catalog-SSR-Products', 'streamed');
      res.setHeader('X-Catalog-SSR-Main-Categories', String(diagnostics.mainCategories));
      res.setHeader('X-Catalog-SSR-Marker', String(diagnostics.markerFound));
      res.setHeader('X-Catalog-SSR-HTML-Length', String(diagnostics.htmlLength));
      res.setHeader('X-Catalog-SSR-Product-Links', 'streamed');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      res.write(html.slice(0, seoIndex));

      // Refresh both SEO/category data only after the first HTML chunk is out.
      // The product links remain in the response; they are simply not on the
      // critical path for the category landing screen.
      const [categoriesResult, productsResult] = await Promise.allSettled([
        fetchActiveMainCategories(supaUrl, supaKey),
        fetchActiveProductLinks(supaUrl, supaKey),
      ]);
      if (categoriesResult.status === 'fulfilled' && categoriesResult.value.length) {
        mainCategoriesCache = categoriesResult.value;
      } else if (categoriesResult.status === 'rejected') {
        console.error('[catalog SSR] main_categories refresh failed:', categoriesResult.reason?.message || categoriesResult.reason);
      }
      let productLinks = '';
      if (productsResult.status === 'fulfilled') {
        const products = productsResult.value;
        productLinks = buildProductLinks(products);
        diagnostics.products = products.length;
        diagnostics.productLinks = products.filter(product => String(product.slug || '').trim()).length;
      } else {
        console.error('[catalog SSR] products fetch failed:', productsResult.reason?.message || productsResult.reason);
      }
      console.error('[catalog SSR] diagnostics:', JSON.stringify(diagnostics));
      res.write(productLinks);
      res.end(html.slice(seoIndex + SEO_MARKER.length));
      return;
    }

    // Test/local response objects may not support streaming. Preserve the
    // same SEO output with a safe non-streaming fallback.
    const [categoriesResult, productsResult] = await Promise.allSettled([
      fetchActiveMainCategories(supaUrl, supaKey),
      fetchActiveProductLinks(supaUrl, supaKey),
    ]);
    if (categoriesResult.status === 'fulfilled' && categoriesResult.value.length) {
      mainCategoriesCache = categoriesResult.value;
    }
    if (productsResult.status === 'fulfilled') {
      const products = productsResult.value;
      diagnostics.products = products.length;
      diagnostics.productLinks = products.filter(product => String(product.slug || '').trim()).length;
      html = html.replace(SEO_MARKER, buildProductLinks(products));
    } else {
      html = html.replace(SEO_MARKER, '');
    }
    diagnostics.htmlLength = html.length;
  } else {
    html = html.replace(SEO_MARKER, '');
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