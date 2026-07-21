// Vercel Serverless Function: Google Merchant Center / Shopping feed
// URL: /merchant-feed.xml  (rewrite налаштований у vercel.json)

const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://gwslintdrtnvbfjvivbb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY
  || process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3c2xpbnRkcnRudmJmanZpdmJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNTU4MTUsImV4cCI6MjA5NzczMTgxNX0.2hhyX_PMrXpBa_Q5DW7KiUjf4Jy9nnBStto47_SVF7k';

const SITE = 'https://www.kidsride.com.ua';
const DEFAULT_CATEGORY = 'Іграшки та ігри > Транспортні засоби';

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchAllProducts() {
  const PAGE = 1000;
  let all = [];
  let offset = 0;

  while (true) {
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/products' +
      '?select=id,name,description,price,old_price,stock,preorder_days,image_url,photos,brand,sku,article,slug,google_category' +
      '&active=eq.true' +
      '&order=id.asc',
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + SUPABASE_KEY,
          Range: offset + '-' + (offset + PAGE - 1),
          'Range-Unit': 'items',
        },
      }
    );

    if (!r.ok) {
      const text = await r.text().catch(function () { return ''; });
      throw new Error('Supabase ' + r.status + ': ' + text.slice(0, 200));
    }

    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all = all.concat(page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return all;
}

function buildItem(p) {
  const inStock = (Number(p.stock) > 0) || (Number(p.preorder_days) > 0);
  const availability = inStock ? 'in stock' : 'out of stock';

  const price = Number(p.price) || 0;
  const oldPrice = Number(p.old_price) || 0;
  const hasDiscount = oldPrice > price && oldPrice > 0;

  const productUrl = p.slug
    ? SITE + '/product/' + escXml(p.slug)
    : SITE + '/product.html?id=' + escXml(String(p.id));

  const imageUrl = p.image_url
    || (Array.isArray(p.photos) && p.photos[0])
    || '';

  const extraPhotos = Array.isArray(p.photos)
    ? p.photos.filter(function (u) { return u && u !== imageUrl; }).slice(0, 9)
    : [];

  const title = escXml((p.name || '').trim().slice(0, 150));

  const rawDesc = String(p.description || p.name || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const description = escXml(rawDesc.slice(0, 5000));

  const brand = escXml(p.brand || 'KidsRide');
  const mpn = escXml(p.sku || p.article || String(p.id));
  const gcat = escXml(p.google_category || DEFAULT_CATEGORY);

  const displayPrice = hasDiscount
    ? oldPrice.toFixed(2) + ' UAH'
    : price.toFixed(2) + ' UAH';

  const salePrice = hasDiscount
    ? '    <g:sale_price>' + price.toFixed(2) + ' UAH</g:sale_price>\n'
    : '';

  const imageLine = imageUrl
    ? '    <g:image_link>' + escXml(imageUrl) + '</g:image_link>\n'
    : '';

  const extraLines = extraPhotos
    .map(function (u) {
      return '    <g:additional_image_link>' + escXml(u) + '</g:additional_image_link>';
    })
    .join('\n');

  return (
    '  <item>\n' +
    '    <g:id>' + escXml(String(p.id)) + '</g:id>\n' +
    '    <g:title>' + title + '</g:title>\n' +
    '    <g:description>' + description + '</g:description>\n' +
    '    <g:link>' + productUrl + '</g:link>\n' +
    imageLine +
    (extraLines ? extraLines + '\n' : '') +
    '    <g:availability>' + availability + '</g:availability>\n' +
    '    <g:price>' + displayPrice + '</g:price>\n' +
    salePrice +
    '    <g:brand>' + brand + '</g:brand>\n' +
    '    <g:mpn>' + mpn + '</g:mpn>\n' +
    '    <g:condition>new</g:condition>\n' +
    '    <g:google_product_category>' + gcat + '</g:google_product_category>\n' +
    '    <g:shipping>\n' +
    '      <g:country>UA</g:country>\n' +
    '      <g:service>Нова Пошта</g:service>\n' +
    '      <g:price>0 UAH</g:price>\n' +
    '    </g:shipping>\n' +
    '  </item>'
  );
}

export default async function handler(req, res) {
  try {
    const products = await fetchAllProducts();
    const items = products.map(buildItem).join('\n');
    const now = new Date().toUTCString();

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
      '<channel>\n' +
      '  <title>KidsRide — дитячий транспорт</title>\n' +
      '  <link>' + SITE + '</link>\n' +
      '  <description>Електромобілі, самокати, велосипеди для дітей</description>\n' +
      '  <lastBuildDate>' + now + '</lastBuildDate>\n' +
      items + '\n' +
      '</channel>\n' +
      '</rss>';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.status(200).send(xml);

  } catch (err) {
    // Повертаємо порожній валідний XML (а не HTML-помилку Vercel)
    // щоб Google не відкидав як "непідтримуваний формат"
    const emptyXml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
      '<channel>\n' +
      '  <title>KidsRide</title>\n' +
      '  <link>' + SITE + '</link>\n' +
      '  <description>Тимчасова помилка: ' + escXml(err.message) + '</description>\n' +
      '</channel>\n' +
      '</rss>';

    console.error('[merchant-feed] ERROR:', err.message);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(emptyXml);
  }
}
