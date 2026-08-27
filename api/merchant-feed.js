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
  var all = [];
  var offset = 0;

  while (true) {
    var r = await fetch(
      SUPABASE_URL + '/rest/v1/products' +
      '?select=id,name,description,price,old_price,stock,preorder_days,images,brand,slug,sku,active' +
      '&active=eq.true' +
      '&price=gt.0' +
      '&slug=not.is.null' +
      '&slug=neq.' +
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
      var text = await r.text().catch(function () { return ''; });
      throw new Error('Supabase ' + r.status + ': ' + text.slice(0, 300));
    }

    var page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all = all.concat(page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return all;
}

function buildItem(p) {
  var inStock = (Number(p.stock) > 0) || (Number(p.preorder_days) > 0);
  var availability = inStock ? 'in stock' : 'out of stock';

  var price = Number(p.price) || 0;
  var oldPrice = Number(p.old_price) || 0;
  var hasDiscount = oldPrice > price && oldPrice > 0;

  var productUrl = escXml(SITE + '/product/' + encodeURIComponent(String(p.slug).trim()));

  // Колонка images — масив URL фотографій
  var imgList = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  var mainImage = imgList[0] || '';
  var extraImages = imgList.slice(1, 10); // до 9 додаткових

  var title = escXml((p.name || '').trim().slice(0, 150));

  var rawDesc = String(p.description || p.name || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  var description = escXml(rawDesc.slice(0, 5000));

  var brand = escXml(p.brand || 'KidsRide');
  var mpn = escXml(p.sku || String(p.id));

  var displayPrice = hasDiscount
    ? oldPrice.toFixed(2) + ' UAH'
    : price.toFixed(2) + ' UAH';

  var lines = [];
  lines.push('  <item>');
  lines.push('    <g:id>' + escXml(String(p.id)) + '</g:id>');
  lines.push('    <g:title>' + title + '</g:title>');
  lines.push('    <g:description>' + description + '</g:description>');
  lines.push('    <g:link>' + productUrl + '</g:link>');

  if (mainImage) {
    lines.push('    <g:image_link>' + escXml(mainImage) + '</g:image_link>');
  }

  for (var i = 0; i < extraImages.length; i++) {
    lines.push('    <g:additional_image_link>' + escXml(extraImages[i]) + '</g:additional_image_link>');
  }

  lines.push('    <g:availability>' + availability + '</g:availability>');
  lines.push('    <g:price>' + displayPrice + '</g:price>');

  if (hasDiscount) {
    lines.push('    <g:sale_price>' + price.toFixed(2) + ' UAH</g:sale_price>');
  }

  lines.push('    <g:brand>' + brand + '</g:brand>');
  lines.push('    <g:mpn>' + mpn + '</g:mpn>');
  lines.push('    <g:condition>new</g:condition>');
  lines.push('    <g:google_product_category>' + escXml(DEFAULT_CATEGORY) + '</g:google_product_category>');
  lines.push('    <g:shipping>');
  lines.push('      <g:country>UA</g:country>');
  lines.push('      <g:service>Нова Пошта</g:service>');
  lines.push('      <g:price>0 UAH</g:price>');
  lines.push('    </g:shipping>');
  lines.push('  </item>');

  return lines.join('\n');
}

export default async function handler(req, res) {
  try {
    var products = await fetchAllProducts();
    // Передаємо лише активні товари з ціною та непорожнім slug.
    products = products.filter(function (p) {
      return p.active === true
        && Number(p.price) > 0
        && String(p.slug || '').trim() !== '';
    });
    var items = products.map(buildItem).join('\n');
    var now = new Date().toUTCString();

    var xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
      '<channel>',
      '  <title>KidsRide — дитячий транспорт</title>',
      '  <link>' + SITE + '</link>',
      '  <description>Електромобілі, самокати, велосипеди для дітей</description>',
      '  <lastBuildDate>' + now + '</lastBuildDate>',
      items,
      '</channel>',
      '</rss>',
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.status(200).send(xml);

  } catch (err) {
    // Повертаємо 503, щоб Google повторив завантаження після тимчасової помилки.
    var emptyXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
      '<channel>',
      '  <title>KidsRide</title>',
      '  <link>' + SITE + '</link>',
      '  <description>Тимчасова помилка: ' + escXml(err.message) + '</description>',
      '</channel>',
      '</rss>',
    ].join('\n');

    console.error('[merchant-feed] ERROR:', err.message);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).send(emptyXml);
  }
}
