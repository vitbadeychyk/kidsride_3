// Vercel Serverless Function: одноразова генерація SEO-slug для всіх товарів
// Виклик (тільки з адмін токеном): GET /api/generate-slugs?token=YOUR_SECRET
//
// Після виконання — можете видалити цей файл або залишити для майбутніх товарів.

function slugify(str) {
  const UA = {
    'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ie',
    'ж':'zh','з':'z','и':'y','і':'i','ї':'i','й':'i','к':'k','л':'l',
    'м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
    'ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'',
    'ю':'iu','я':'ia','ё':'e','ъ':'','ы':'y','э':'e',
  };
  return str
    .toLowerCase()
    .split('')
    .map(c => (UA[c] !== undefined ? UA[c] : c))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

async function makeUniqueSlug(base, existingSlugs) {
  if (!existingSlugs.has(base)) return base;
  let i = 2;
  while (existingSlugs.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export default async function handler(req, res) {
  const supaUrl = process.env.SUPABASE_URL;
  const supaWriteKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const adminToken = process.env.ADMIN_GENERATE_SLUGS_TOKEN;

  // Захист: потрібен токен
  if (adminToken && req.query.token !== adminToken) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  if (!supaUrl || !supaWriteKey) {
    return res.status(500).json({ ok: false, error: 'Missing SUPABASE env vars' });
  }

  // Отримуємо всі товари
  const r = await fetch(
    supaUrl + '/rest/v1/products?select=id,name,slug&order=created_at.asc',
    { headers: { apikey: supaWriteKey, Authorization: 'Bearer ' + supaWriteKey } }
  );
  if (!r.ok) {
    return res.status(500).json({ ok: false, error: 'Failed to fetch products' });
  }
  const products = await r.json();

  // Збираємо вже існуючі slugs
  const existingSlugs = new Set(products.map(p => p.slug).filter(Boolean));

  let updated = 0;
  let skipped = 0;
  const results = [];

  for (const p of products) {
    if (p.slug) { skipped++; continue; } // вже є slug — пропускаємо

    const base = slugify(p.name || p.id);
    const slug = await makeUniqueSlug(base, existingSlugs);
    existingSlugs.add(slug);

    const upd = await fetch(
      supaUrl + '/rest/v1/products?id=eq.' + encodeURIComponent(p.id),
      {
        method: 'PATCH',
        headers: {
          apikey: supaWriteKey,
          Authorization: 'Bearer ' + supaWriteKey,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ slug }),
      }
    );

    if (upd.ok) {
      updated++;
      results.push({ id: p.id, name: p.name, slug });
    }
  }

  return res.status(200).json({
    ok: true,
    total: products.length,
    updated,
    skipped,
    results,
  });
}
