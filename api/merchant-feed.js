// Vercel Serverless Function: Google Merchant Center / Shopping feed
// URL: /merchant-feed.xml  (rewrite налаштований у vercel.json)
// Формат: Google Shopping XML (RSS 2.0 + g: namespace)
// Кешується Vercel 1 годину

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gwslintdrtnvbfjvivbb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY
  || process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3c2xpbnRkcnRudmJmanZpdmJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNTU4MTUsImV4cCI6MjA5NzczMTgxNX0.2hhyX_PMrXpBa_Q5DW7KiUjf4Jy9nnBStto47_SVF7k';

const SITE = 'https://www.kidsride.com.ua';

// Google Product Category для дитячих іграшок/транспорту
// https://www.google.com/basepages/producttype/taxonomy-with-ids.uk-UA.txt
const DEFAULT_GOOGLE_CATEGORY = 'Іграшки та ігри > Транспортні засоби > Електромобілі та інші іграшкові транспортні засоби';

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Читає всі рядки з Supabase з пагінацією (ліміт 1000 на запит)
async function supaFetch(path) {
  const PAGE = 1000;
  let all = [], offset = 0;
  while (true) {
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      headers: {
        apikey:        SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        Range:         `${offset}-${offset + PAGE - 1}`,
        'Range-Unit':  'items',
      },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Supabase ${r.status}: ${text.slice(0, 200)}`);
    }
    const page = await r.json();
    if (!Array.isArray(page) || !page.length) break;
    all = all.concat(page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function buildItem(p) {
  // Визначаємо доступність
  const inStock  = p.stock > 0 || p.preorder_days > 0;
  const availability = inStock ? 'in stock' : 'out of stock';

  // Ціна
  const price    = Number(p.price) || 0;
  const oldPrice = Number(p.old_price) || 0;

  // URL товару: /product/:slug або /product.html?id=...
  const productUrl = p.slug
    ? `${SITE}/product/${escXml(p.slug)}`
    : `${SITE}/product.html?id=${escXml(p.id)}`;

  // Головне фото
  const imageUrl = p.image_url || (Array.isArray(p.photos) && p.photos[0]) || '';

  // Додаткові фото (до 10 штук, без головного)
  let extraPhotos = [];
  if (Array.isArray(p.photos)) {
    extraPhotos = p.photos
      .filter(u => u && u !== imageUrl)
      .slice(0, 9);
  }

  // Назва — обрізаємо до 150 символів (ліміт Google)
  const title = escXml((p.name || '').trim().slice(0, 150));

  // Опис — прибираємо HTML-теги, обрізаємо до 5000 символів
  const rawDesc = String(p.description || p.name || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const description = escXml(rawDesc.slice(0, 5000));

  // Бренд
  const brand = escXml(p.brand || 'KidsRide');

  // Артикул (sku)
  const mpn = escXml(p.sku || p.article || p.id);

  // Google product category
  const gcat = escXml(p.google_category || DEFAULT_GOOGLE_CATEGORY);

  let xml = `
  <item>
    <g:id>${escXml(String(p.id))}</g:id>
    <g:title>${title}</g:title>
    <g:description>${description}</g:description>
    <g:link>${productUrl}</g:link>`;

  if (imageUrl) {
    xml += `
    <g:image_link>${escXml(imageUrl)}</g:image_link>`;
  }

  extraPhotos.forEach(u => {
    xml += `
    <g:additional_image_link>${escXml(u)}</g:additional_image_link>`;
  });

  xml += `
    <g:availability>${availability}</g:availability>
    <g:price>${price.toFixed(2)} UAH</g:price>`;

  if (oldPrice > price) {
    xml += `
    <g:sale_price>${price.toFixed(2)} UAH</g:sale_price>
    <g:price>${oldPrice.toFixed(2)} UAH</g:price>`;
    // Виправлення: якщо є sale_price, g:price має бути СТАРОЮ ціною
    // Але вище ми вже написали g:price=price.toFixed — замінимо:
  }

  xml += `
    <g:brand>${brand}</g:brand>
    <g:mpn>${mpn}</g:mpn>
    <g:condition>new</g:condition>
    <g:google_product_category>${gcat}</g:google_product_category>
    <g:shipping>
      <g:country>UA</g:country>
      <g:service>Нова Пошта</g:service>
      <g:price>0 UAH</g:price>
    </g:shipping>
  </item>`;

  return xml;
}

// Повторний build item без помилки дублювання g:price
function buildItemClean(p) {
  const inStock      = p.stock > 0 || p.preorder_days > 0;
  const availability = inStock ? 'in stock' : 'out of stock';
  const price        = Number(p.price) || 0;
  const oldPrice     = Number(p.old_price) || 0;
  const hasDiscount  = oldPrice > price && oldPrice > 0;

  const productUrl = p.slug
    ? `${SITE}/product/${escXml(p.slug)}`
    : `${SITE}/product.html?id=${escXml(p.id)}`;

  const imageUrl = p.image_url
    || (Array.isArray(p.photos) && p.photos[0])
    || '';

  let extraPhotos = [];
  if (Array.isArray(p.photos)) {
    extraPhotos = p.photos
      .filter(u => u && u !== imageUrl)
      .slice(0, 9);
  }

  const title       = escXml((p.name || '').trim().slice(0, 150));
  const rawDesc     = String(p.description || p.name || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const description = escXml(rawDesc.slice(0, 5000));
  const brand       = escXml(p.brand || 'KidsRide');
  const mpn         = escXml(p.sku || p.article || String(p.id));
  const gcat        = escXml(p.google_category || DEFAULT_GOOGLE_CATEGORY);

  // g:price завжди = фактична ціна для покупки
  // якщо є стара ціна → додаємо g:sale_price (і g:price = старій)
  const displayPrice = hasDiscount
    ? `${oldPrice.toFixed(2)} UAH`
    : `${price.toFixed(2)} UAH`;
  const salePrice = hasDiscount
    ? `<g:sale_price>${price.toFixed(2)} UAH</g:sale_price>`
    : '';

  const extraImgs = extraPhotos
    .map(u => `    <g:additional_image_link>${escXml(u)}</g:additional_image_link>`)
    .join('\n');

  return `
  <item>
    <g:id>${escXml(String(p.id))}</g:id>
    <g:title>${title}</g:title>
    <g:description>${description}</g:description>
    <g:link>${productUrl}</g:link>
${imageUrl ? `    <g:image_link>${escXml(imageUrl)}</g:image_link>` : ''}
${extraImgs}
    <g:availability>${availability}</g:availability>
    <g:price>${displayPrice}</g:price>
${salePrice}
    <g:brand>${brand}</g:brand>
    <g:mpn>${mpn}</g:mpn>
    <g:condition>new</g:condition>
    <g:google_product_category>${gcat}</g:google_product_category>
    <g:shipping>
      <g:country>UA</g:country>
      <g:service>Нова Пошта</g:service>
      <g:price>0 UAH</g:price>
    </g:shipping>
  </item>`;
}

export default async function handler(req, res) {
  try {
    // Вибираємо лише активні товари з потрібними полями
    const products = await supaFetch(
      'products?' +
      'select=id,name,description,price,old_price,stock,preorder_days,image_url,photos,brand,sku,article,slug,google_category' +
      '&active=eq.true' +
      '&order=id.asc'
    );

    const items = products.map(buildItemClean).join('');

    const now  = new Date().toUTCString();
    const xml  =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n` +
      `<channel>\n` +
      `  <title>KidsRide — дитячий транспорт</title>\n` +
      `  <link>${SITE}</link>\n` +
      `  <description>Каталог товарів KidsRide: електромобілі, самокати, велосипеди</description>\n` +
      `  <lastBuildDate>${now}</lastBuildDate>\n` +
      items +
      `\n</channel>\n` +
      `</rss>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.status(200).send(xml);

  } catch (err) {
    // Якщо Supabase недоступний — повертаємо порожній валідний фід
    // (а не HTML-помилку) щоб Google не лаяв непідтримуваний формат
    const emptyXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n` +
      `<channel>\n` +
      `  <title>KidsRide</title>\n` +
      `  <link>${SITE}</link>\n` +
      `  <description>Error: ${escXml(err.message)}</description>\n` +
      `</channel>\n` +
      `</rss>`;

    console.error('[merchant-feed] ERROR:', err.message);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(emptyXml); // 200, щоб Google отримав XML, а не HTML помилки Vercel
  }
}
