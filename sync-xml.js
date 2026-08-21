#!/usr/bin/env node
/**
 * KidsRide — XML → Supabase sync script
 *
 * Логіка залишку:
 *   1. Постачальник є в наявності → stock = MIN_STOCK (за замовч. 5)
 *   2. Постачальник НЕ має → перевіряємо таблицю ostatok (власний склад):
 *        • є в ostatok з quantity > 0 → stock = ostatok.quantity, active = true
 *        • немає в ostatok            → stock = 0, active = false
 *
 * Логіка цін:
 *   supplier_price = ціна з XML (зберігається завжди)
 *   price          = round(supplier_price * (1 - discount%) / 100) * 100
 *   old_price      = round(supplier_price * 1.3 / 100) * 100
 *   discount%      = береться з таблиці settings (key='discount_pct')
 *
 * Логіка пошуку існуючого товару (пріоритет):
 *   1. supplier_id — числовий id з атрибуту <offer id="..."> в XML
 *   2. sku         — артикул (vendorCode/article), якщо supplier_id немає
 *
 * Категорії:
 *   Парсяться з <catalog> секції XML → вставляються в таблицю categories.
 *   category_id кожного офферу береться з <categoryId> → зберігається в products.
 */

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL || 'https://gwslintdrtnvbfjvivbb.supabase.co',
  supabaseKey: process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3c2xpbnRkcnRudmJmanZpdmJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNTU4MTUsImV4cCI6MjA5NzczMTgxNX0.2hhyX_PMrXpBa_Q5DW7KiUjf4Jy9nnBStto47_SVF7k',
  xmlUrl:      process.env.XML_URL      || 'https://raw.githubusercontent.com/vitbadeychyk/product-feed-pipeline/cb030df7b703d5a48189ecf7faa412c74c14dd55/data/raw/supplier_feed.xml',

  minStock:    5,     // скільки показувати на сайті, якщо постачальник дає 1+ шт
  batchSize:   50,    // скільки нових товарів вставляти за один POST
  photoMax:    10,    // максимум фото на товар
  onlyUpdate:  false, // true — лише оновлювати наявні, не додавати нові
};

// ── ЗАЛЕЖНОСТІ ────────────────────────────────────────────────────────────────
let DOMParser;
try {
  ({ DOMParser } = require('@xmldom/xmldom'));
} catch {
  console.error('❌  npm install @xmldom/xmldom');
  process.exit(1);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function log(msg)  { console.log('[' + new Date().toISOString().slice(11,19) + '] ' + msg); }
function warn(msg) { console.warn('[' + new Date().toISOString().slice(11,19) + '] ⚠  ' + msg); }
function err(msg)  { console.error('[' + new Date().toISOString().slice(11,19) + '] ❌  ' + msg); }

function xmlText(node, tag) {
  const el = node.getElementsByTagName(tag)[0];
  return el ? (el.textContent || '').trim() : '';
}
function xmlAll(node, tag) {
  return Array.from(node.getElementsByTagName(tag) || []);
}

// ── CATEGORIES PARSER ─────────────────────────────────────────────────────────
/**
 * Парсить секцію <catalog> → <categories> → <category id="77">Електромобілі</category>
 * Повертає масив { id: Number, name: String }
 */
function parseCategories(doc) {
  const cats = [];
  const catNodes = Array.from(doc.getElementsByTagName('category') || []);
  for (const node of catNodes) {
    const id = parseInt(node.getAttribute('id') || '', 10);
    const name = (node.textContent || '').trim();
    if (id && name) {
      cats.push({ id, name });
    }
  }
  // Дедублікація по id
  const seen = new Set();
  return cats.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// ── XML PARSER ────────────────────────────────────────────────────────────────
function guessCategory(name) {
  const n = String(name || '').toLowerCase();
  if (/велосипед|bike/.test(n))                     return 'bike';
  if (/мотоцикл|motorcycle|moto\b/.test(n))         return 'moto';
  if (/квадроцикл|atv|quad/.test(n))                return 'quad';
  if (/трактор|tractor/.test(n))                    return 'tractor';
  if (/джип|jeep|внедорожник|позашляховик/.test(n)) return 'jeep';
  if (/машин|car|авто/.test(n))                     return 'car';
  if (/самокат|scooter/.test(n))                    return 'scooter';
  if (/каталка|толокар|walker/.test(n))             return 'walker';
  if (/вантаж|truck/.test(n))                       return 'truck';
  if (/баггі|buggy/.test(n))                        return 'buggy';
  return null; // не вгадуємо — залишаємо без категорії
}
function guessImgType(c) {
  const m = { bike:'bike',moto:'moto',quad:'quad',tractor:'tractor',jeep:'jeep',
              car:'car',scooter:'scooter',walker:'walker',truck:'truck',buggy:'buggy' };
  return m[c] || null; // null якщо категорія невідома
}
function guessVoltage(name, vals) {
  const m = ((name || '') + ' ' + vals.join(' ')).match(/\b(6|12|24|36|48)\s*[Vв]\b/i);
  return m ? m[1] + 'V' : null;
}
function guessModelCode(sku) {
  const m = String(sku || '').match(/(\d{3,5})/);
  return m ? m[1] : '';
}

function parseOffer(node) {
  const name = xmlText(node, 'name_ua') || xmlText(node, 'name');
  if (!name) return null;

  const supplier_id = (node.getAttribute('id') || '').trim() || null;
  const sku = (xmlText(node, 'vendorCode') || xmlText(node, 'article') ||
               ('item-' + (supplier_id || Date.now()))).trim();

  const priceRaw    = xmlText(node, 'price');
  const oldPriceRaw = xmlText(node, 'price_old') || xmlText(node, 'oldprice') || xmlText(node, 'price_promo');
  const stockRaw    = xmlText(node, 'quantity_in_stock') || xmlText(node, 'stock_quantity') || xmlText(node, 'quantity');
  const availRaw    = xmlText(node, 'available') || (node.getAttribute('available') || '');
  const vendor      = xmlText(node, 'vendor');
  const desc        = xmlText(node, 'description_ua') || xmlText(node, 'description');

  // category_id з XML (<categoryId>77</categoryId>)
  const categoryIdRaw = xmlText(node, 'categoryId') || xmlText(node, 'category_id');
  const category_id_xml = categoryIdRaw ? (parseInt(categoryIdRaw, 10) || null) : null;

  const images = [];
  for (const tag of ['image', 'picture'])
    for (const el of xmlAll(node, tag)) {
      const src = (el.textContent || '').trim();
      if (src) images.push(src);
    }

  const params = {};
  const features = [];
  for (const p of xmlAll(node, 'param')) {
    const pname = (p.getAttribute('name') || '').trim();
    const ukVal = p.getElementsByTagName('value')[0];
    const pval  = (ukVal ? ukVal.textContent : p.textContent || '').trim();
    if (pname && pval) { params[pname] = pval; features.push(pname + ': ' + pval); }
  }

  const category       = guessCategory(name);
  const supplierStock  = parseInt(stockRaw, 10) || 0;
  const supplierActive = !/false|нет|ні|^0$/i.test(availRaw.trim()) || supplierStock > 0;
  const supplierPrice  = parseFloat(String(priceRaw).replace(',', '.')) || 0;

  return {
    supplier_id,
    sku,
    name,
    brand:          vendor || params['Бренд'] || params['Виробник'] || params['Производитель'] || null,
    supplier_price: supplierPrice,
    // price та old_price будуть перераховані в applyDiscount()
    price:          supplierPrice,
    old_price:      oldPriceRaw ? (parseFloat(String(oldPriceRaw).replace(',', '.')) || null) : null,
    category,
    img_type:       guessImgType(category),
    voltage:        guessVoltage(name, Object.values(params)),
    age_range:      params['Вік'] || params['Возраст'] || null,
    color:          params['Колір'] || params['Цвет'] || null,
    model_code:     guessModelCode(sku),
    preorder_days:  0,
    badge:          '',
    features:       features.slice(0, 30),
    images:         [...new Set(images)].slice(0, CONFIG.photoMax),
    description:    desc || null,
    stock:          supplierStock,
    active:         supplierActive,
    _supplierStock:    supplierStock,
    _supplierActive:   supplierActive,
    _categoryId_xml:   category_id_xml,  // внутрішнє поле, видаляємо перед вставкою
  };
}

function parseXml(xmlStr) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, 'text/xml');
  const parseErr = doc.getElementsByTagName('parsererror')[0];
  if (parseErr) throw new Error('Невалідний XML: ' + (parseErr.textContent || '').slice(0, 200));

  // Парсимо категорії окремо
  const categories = parseCategories(doc);
  log(`Знайдено категорій у XML: ${categories.length}`);

  let nodes = Array.from(doc.getElementsByTagName('offer'));
  if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('item'));
  if (!nodes.length) throw new Error('У XML не знайдено жодного <offer> або <item>');

  log(`Знайдено вузлів у XML: ${nodes.length}`);
  const products = nodes.map(parseOffer).filter(Boolean);
  log(`Валідних товарів після парсингу: ${products.length}`);
  return { products, categories };
}

// ── DISCOUNT / PRICE ──────────────────────────────────────────────────────────
/**
 * Завантажити параметри знижок з таблиці settings.
 * Читає ті самі ключі що зберігає адмінка:
 *   sell_discount_pct    — знижка від РРЦ для ціни продажу (що бачить покупець)
 *   old_price_markup_pct — надбавка до ціни продажу для "старої ціни"
 *   supplier_discount_pct — знижка постачальника (тільки для інформації, не змінює price)
 *
 * Повертає { sellDisc, oldMarkup } (0 якщо не знайдено).
 */
async function loadDiscount() {
  try {
    const data = await sbFetch(
      'settings?select=key,value&key=in.(sell_discount_pct,old_price_markup_pct,supplier_discount_pct)'
    );
    const byKey = {};
    (data || []).forEach(r => { byKey[r.key] = parseFloat(r.value); });

    const sellDisc  = isNaN(byKey['sell_discount_pct'])    ? 0 : byKey['sell_discount_pct'];
    const oldMarkup = isNaN(byKey['old_price_markup_pct']) ? 30 : byKey['old_price_markup_pct'];
    const suppDisc  = isNaN(byKey['supplier_discount_pct'])? 0 : byKey['supplier_discount_pct'];

    log(`Знижки з settings: продаж=${sellDisc}%  стара ціна надбавка=${oldMarkup}%  постачальник=${suppDisc}%`);
    return { sellDisc, oldMarkup };
  } catch (e) {
    warn('Таблиця settings не знайдена → знижки 0%. Виконай SUPABASE_ADD_SUPPLIER_PRICE.sql');
    return { sellDisc: 0, oldMarkup: 30 };
  }
}

/**
 * Перерахувати price та old_price для кожного товару.
 *
 * Та сама формула що використовує адмінка:
 *   price     = max(100, ROUND(supplier_price × (1 − sellDisc/100) / 100) × 100)
 *   old_price = ROUND(price × (1 + oldMarkup/100) / 100) × 100
 *
 * Якщо supplier_price = 0 (не передається в XML) — ціни не чіпаємо.
 */
function applyDiscount(products, { sellDisc, oldMarkup }) {
  if (sellDisc === 0 && oldMarkup === 0) {
    log('Знижки 0% → ціни записуються як є з XML');
    return;
  }
  let applied = 0;
  for (const p of products) {
    if (p.supplier_price > 0) {
      const calculatedPrice = p.supplier_price * (1 - sellDisc / 100);
      p.price     = Math.max(100, Math.round(calculatedPrice / 100) * 100);
      p.old_price = Math.round(p.price * (1 + oldMarkup / 100) / 100) * 100;
      applied++;
    }
  }
  log(`Ціни перераховано для ${applied} товарів (продаж −${sellDisc}%  стара +${oldMarkup}%)`);
}

// ── STOCK RESOLVER ────────────────────────────────────────────────────────────
function resolveStock(products, ostatokMap) {
  let fromSupplier = 0, fromOstatok = 0, outOfStock = 0;

  for (const p of products) {
    if (p._supplierActive && p._supplierStock >= 1) {
      p.stock  = CONFIG.minStock;
      p.active = true;
      fromSupplier++;
    } else {
      const own = ostatokMap.get(p.sku.trim());
      const myQty = own ? Number(own.qty) || 0 : 0;
      if (myQty > 0) {
        p.stock  = myQty;
        p.active = true;
        // Коли постачальник не має товару, на сайті працює власний склад:
        // беремо з ostatok не тільки залишок, а й обидві його ціни.
        if (Number(own.sell_price) > 0) p.price = Number(own.sell_price);
        if (Number(own.old_price) > 0) p.old_price = Number(own.old_price);
        fromOstatok++;
      } else {
        p.stock  = 0;
        p.active = false;
        outOfStock++;
      }
    }
    delete p._supplierStock;
    delete p._supplierActive;
  }

  log(`Залишки: постачальник=${fromSupplier}  власний склад=${fromOstatok}  немає=${outOfStock}`);
}

// ── SUPABASE API ──────────────────────────────────────────────────────────────
async function sbFetch(path, options = {}) {
  const url  = CONFIG.supabaseUrl + '/rest/v1/' + path;
  const hdrs = {
    'apikey':        CONFIG.supabaseKey,
    'Authorization': 'Bearer ' + CONFIG.supabaseKey,
    'Content-Type':  'application/json',
    ...(options.headers || {}),
  };
  const res  = await fetch(url, { ...options, headers: hdrs });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function columnExists(table, column) {
  try {
    await sbFetch(`${table}?select=${column}&limit=1`);
    return true;
  } catch (e) {
    if (e.message.includes('42703') || e.message.includes('does not exist')) return false;
    throw e;
  }
}

async function tableExists(table) {
  try {
    await sbFetch(`${table}?select=id&limit=1`);
    return true;
  } catch (e) {
    if (e.message.includes('42P01') || e.message.includes('PGRST205') ||
        e.message.includes('does not exist') || e.message.includes('404')) return false;
    throw e;
  }
}

async function loadOstatok() {
  const map  = new Map();
  const PAGE = 1000;
  let from   = 0;

  while (true) {
    const data = await sbFetch('ostatok?select=sku,quantity,sell_price,old_price,images,active,description,description2,short_desc', {
      headers: { 'Range': `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items', 'Prefer': 'count=none' },
    });
    if (!data || !data.length) break;
    data.forEach(row => {
      if (!row.sku) return;
      const qty = parseInt(row.quantity, 10) || 0;
      const existing = map.get(row.sku.trim());
        map.set(row.sku.trim(), {
          qty:        (existing ? existing.qty : 0) + qty,
          sell_price: row.sell_price  != null ? row.sell_price  : (existing ? existing.sell_price  : null),
          old_price:  row.old_price   != null ? row.old_price   : (existing ? existing.old_price   : null),
          images:     Array.isArray(row.images) && row.images.length ? row.images : (existing ? existing.images : null),
          description: row.description || (existing ? existing.description : null),
          description2: row.description2 || (existing ? existing.description2 : null),
          short_desc: row.short_desc || (existing ? existing.short_desc : null),
          active:     row.active !== false,
        });
    });
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

async function loadExistingProducts(hasSupplierIdCol) {
  const PAGE   = 1000;
  let from     = 0;
  const supplierIdMap = new Map();
  const skuMap        = new Map();
  const fields = hasSupplierIdCol ? 'id,sku,supplier_id' : 'id,sku';

  while (true) {
    const data = await sbFetch(`products?select=${fields}`, {
      headers: { 'Range': `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items', 'Prefer': 'count=none' },
    });
    if (!data || !data.length) break;
    data.forEach(p => {
      if (hasSupplierIdCol && p.supplier_id) supplierIdMap.set(String(p.supplier_id).trim(), p.id);
      if (p.sku) skuMap.set(p.sku.trim(), p.id);
    });
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { supplierIdMap, skuMap };
}

function findExistingId(product, supplierIdMap, skuMap) {
  if (product.supplier_id) {
    const id = supplierIdMap.get(String(product.supplier_id));
    if (id !== undefined) return id;
  }
  return skuMap.get(product.sku);
}

async function insertBatch(items) {
  await sbFetch('products', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify(items),
  });
}

async function patchProduct(rowId, data) {
  await sbFetch(`products?id=eq.${rowId}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify(data),
  });
}

// ── CATEGORIES UPSERT ─────────────────────────────────────────────────────────
/**
 * Вставити або оновити категорії в таблиці categories.
 * Використовує ON CONFLICT DO NOTHING — не чіпаємо active якщо вже є.
 */
async function upsertCategories(cats) {
  if (!cats.length) return;
  const BATCH = 50;
  let upserted = 0;
  for (let i = 0; i < cats.length; i += BATCH) {
    const batch = cats.slice(i, i + BATCH);
    try {
      await sbFetch('categories', {
        method: 'POST',
        // merge-duplicates: оновлює name якщо id вже є, не чіпає active
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(batch.map(c => ({ id: c.id, name: c.name }))),
      });
      upserted += batch.length;
    } catch (e) {
      warn(`Upsert categories batch ${i}: ${e.message}`);
    }
  }
  log(`Категорії: ${upserted}/${cats.length} upserted`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  log('=== KidsRide XML → Supabase sync ===');
  log(`XML URL: ${CONFIG.xmlUrl}`);

  // 1) Завантажити XML
  log('Завантажую XML...');
  let xmlRaw;
  try {
    const res = await fetch(CONFIG.xmlUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    xmlRaw = await res.text();
    log(`Отримано ${Math.round(xmlRaw.length / 1024)} КБ`);
  } catch (e) { err('XML: ' + e.message); process.exit(1); }

  // 2) Парсинг (тепер повертає { products, categories })
  log('Парсинг XML...');
  let products, categories;
  try {
    ({ products, categories } = parseXml(xmlRaw));
  } catch (e) { err('Парсинг: ' + e.message); process.exit(1); }
  if (!products.length) { warn('Жодного товару.'); process.exit(0); }

  // 3) Паралельно: перевірка колонок + завантаження ostatok + завантаження знижок
  log('Перевіряю Supabase...');
  let hasSupplierIdCol, hasSupplierPriceCol, hasCategoryIdCol, hasCategoriesTable, ostatokMap, discountSettings;
  try {
    const [hasSid, hasSPrice, hasCatId, hasCatTable, hasOstatokTable, discount] = await Promise.all([
      columnExists('products', 'supplier_id'),
      columnExists('products', 'supplier_price'),
      columnExists('products', 'category_id'),
      tableExists('categories'),
      tableExists('ostatok'),
      loadDiscount(),
    ]);
    hasSupplierIdCol    = hasSid;
    hasSupplierPriceCol = hasSPrice;
    hasCategoryIdCol    = hasCatId;
    hasCategoriesTable  = hasCatTable;
    discountSettings    = discount;

    if (!hasSid)    warn('supplier_id колонки немає → пошук по sku. Виконай SUPABASE_ADD_SUPPLIER_ID.sql');
    else            log('supplier_id ✓');

    if (!hasSPrice) warn('supplier_price колонки немає → ціни записуються як є. Виконай SUPABASE_ADD_SUPPLIER_PRICE.sql');
    else            log('supplier_price ✓');

    if (!hasCategoryIdCol) warn('category_id колонки немає → категорії не записуються. Виконай SUPABASE_CATEGORIES.sql');
    else                   log('category_id ✓');

    if (!hasCategoriesTable) warn('Таблиця categories не знайдена → виконай SUPABASE_CATEGORIES.sql');
    else                     log('categories table ✓');

    if (!hasOstatokTable) {
      warn('Таблиця ostatok не знайдена → власний склад не враховується');
      ostatokMap = new Map();
    } else {
      ostatokMap = await loadOstatok();
      log(`ostatok: ${ostatokMap.size} артикулів на власному складі`);
    }
  } catch (e) { err('Supabase check: ' + e.message); process.exit(1); }

  // 4) Upsert категорій в Supabase (якщо таблиця є)
  if (hasCategoriesTable && categories.length) {
    log(`Upsert ${categories.length} категорій...`);
    await upsertCategories(categories);
  }

  // 5) Побудувати Map: categoryId (number) → існування в базі категорій
  //    Потрібно для того, щоб не писати неіснуючий FK
  let validCategoryIds = new Set();
  if (hasCategoriesTable) {
    try {
      const catRows = await sbFetch('categories?select=id');
      (catRows || []).forEach(r => validCategoryIds.add(r.id));
    } catch (e) {
      warn('Не вдалось завантажити categories: ' + e.message);
    }
  }

  // 6) Перерахувати ціни виходячи зі знижок з таблиці settings
  applyDiscount(products, discountSettings);

  // 7) Застосувати логіку залишків
  log('Визначаю залишки...');
  resolveStock(products, ostatokMap);

  // Якщо артикул є у постачальника, products повністю формується з XML.
  // Дані ostatok не повинні підміняти його ціни, фото чи описи.

  // 8) Прибрати колонки яких немає в базі + застосувати category_id
  products.forEach(p => {
    // Перенести _categoryId_xml → category_id (тільки якщо колонка є і id існує в базі)
    const xmlCatId = p._categoryId_xml;
    delete p._categoryId_xml;
    if (hasCategoryIdCol && xmlCatId && validCategoryIds.has(xmlCatId)) {
      p.category_id = xmlCatId;
    } else if (hasCategoryIdCol) {
      p.category_id = null;
    }

    if (!hasSupplierIdCol)    delete p.supplier_id;
    if (!hasSupplierPriceCol) delete p.supplier_price;
    if (!hasCategoryIdCol)    delete p.category_id;
  });

  // 9) Завантажити існуючі products
  log('Завантажую існуючі товари з бази...');
  let supplierIdMap, skuMap;
  try {
    ({ supplierIdMap, skuMap } = await loadExistingProducts(hasSupplierIdCol));
    log(`У базі: ${skuMap.size} товарів`);
  } catch (e) { err('loadExisting: ' + e.message); process.exit(1); }

  // 10) Розділити на нові / існуючі
  const newItems      = [];
  const existingItems = [];
  for (const p of products) {
    const rowId = findExistingId(p, supplierIdMap, skuMap);
    if (rowId !== undefined) existingItems.push({ rowId, product: p });
    else if (!CONFIG.onlyUpdate) newItems.push(p);
  }
  log(`Нових: ${newItems.length} | Оновлення: ${existingItems.length}` +
      (CONFIG.onlyUpdate ? ' [onlyUpdate=true]' : ''));

  let added = 0, updated = 0, failed = 0;

  // 11a) INSERT нових батчами
  if (newItems.length > 0) {
    log(`INSERT ${newItems.length} нових товарів...`);
    for (let i = 0; i < newItems.length; i += CONFIG.batchSize) {
      const batch = newItems.slice(i, i + CONFIG.batchSize);
      try { await insertBatch(batch); added += batch.length; }
      catch (e) { failed += batch.length; warn(`INSERT ${i}: ${e.message}`); }
      process.stdout.write(`\r  INSERT: ${Math.min(i + CONFIG.batchSize, newItems.length)}/${newItems.length}  `);
    }
    process.stdout.write('\n');
  }

  // 11b) PATCH існуючих (15 паралельно)
  if (existingItems.length > 0) {
    log(`PATCH ${existingItems.length} існуючих товарів...`);
    const CON = 15;
    for (let i = 0; i < existingItems.length; i += CON) {
      const chunk = existingItems.slice(i, i + CON);
      const res = await Promise.allSettled(
        chunk.map(({ rowId, product }) => patchProduct(rowId, product))
      );
      res.forEach((r, idx) => {
        if (r.status === 'fulfilled') updated++;
        else {
          failed++;
          if (failed <= 5) warn(`PATCH [${chunk[idx].product.supplier_id || chunk[idx].product.sku}]: ${r.reason?.message}`);
        }
      });
      process.stdout.write(`\r  PATCH:  ${Math.min(i + CON, existingItems.length)}/${existingItems.length}  `);
    }
    process.stdout.write('\n');
  }

  // 12b) Re-activate products that are in ostatok (qty>0, active) but were NOT in XML
    //      (i.e. supplier stopped carrying them, but we have our own stock)
    log('Перевіряю власний склад для товарів поза XML...');
    let reactivated = 0;
    try {
      for (const [sku, osRow] of ostatokMap.entries()) {
        if (osRow.qty <= 0 || osRow.active === false) continue;
        const dbId = skuMap.get(sku);
        if (dbId === undefined) continue;  // немає в products взагалі — пропускаємо
        // Check if this SKU was processed in the main sync (exists in products array)
        const wasInXml = products.some(p => p.sku && p.sku.trim() === sku);
        if (wasInXml) continue;  // вже оброблено в головному циклі
        // Product exists in DB but was NOT in XML → re-activate from ostatok
        const patch = {
          active: true,
          stock:  osRow.qty,
        };
        if (osRow.sell_price) patch.price    = osRow.sell_price;
        if (osRow.old_price)  patch.old_price = osRow.old_price;
        if (Array.isArray(osRow.images) && osRow.images.length) patch.images = osRow.images;
        try {
          await patchProduct(dbId, patch);
          reactivated++;
        } catch (e) {
          warn('Re-activate [' + sku + ']: ' + e.message);
        }
      }
      if (reactivated > 0) log('Реактивовано з власного складу (поза XML): ' + reactivated + ' шт');
    } catch (e) {
      warn('Re-activate step: ' + e.message);
    }

    // 12) Підсумок
  log('='.repeat(40));
  log(`✅ Готово!`);
  log(`   Категорій з XML:  ${categories.length}`);
  log(`   Знижка продажу:  ${discountSettings.sellDisc}%`);
  log(`   Надбавка ст.ц.:  ${discountSettings.oldMarkup}%`);
  log(`   Мін. залишок:    ${CONFIG.minStock} шт`);
  log(`   Додано нових:    ${added}`);
  log(`   Оновлено:        ${updated}`);
  if (failed) warn(`   Помилок:         ${failed}`);
  log(`   Реактивовано (склад): ${reactivated}`);
  log(`   Всього в XML:    ${products.length}`);
  log('='.repeat(40));
}

main().catch(e => { err('Критична: ' + e.message); process.exit(1); });
