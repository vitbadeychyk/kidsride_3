// Vercel Serverless Function: отримує фото-пости з Instagram
// Зберігає: api/instagram.js у вашому проекті
//
// Необхідні змінні середовища у Vercel:
//   INSTAGRAM_ACCESS_TOKEN    — початковий довгостроковий токен (отриманий вручну)
//   SUPABASE_URL              — URL вашого Supabase проекту
//   SUPABASE_SERVICE_ROLE_KEY або SUPABASE_ANON_KEY
//
// Токен автоматично оновлюється кожні 30 днів через api/ig-refresh.js (cron job).
// Оновлений токен зберігається в Supabase (таблиця settings, ключ instagram_token).

const CACHE_DURATION = 10 * 60 * 1000; // 10 хвилин кеш
let cache = null;
let cacheTime = 0;

async function getToken() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  // Спочатку шукаємо оновлений токен у Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/settings?select=value&key=eq.instagram_token`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await r.json();
      if (rows && rows[0] && rows[0].value) {
        return rows[0].value;
      }
    } catch (e) {
      console.error('Supabase token read error:', e.message);
    }
  }

  // Резервний варіант — токен зі змінної середовища
  return process.env.INSTAGRAM_ACCESS_TOKEN || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Повернути кеш якщо свіжий
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(200).json({ ok: true, data: cache });
  }

  const TOKEN = await getToken();
  if (!TOKEN) {
    return res.status(500).json({ ok: false, error: 'INSTAGRAM_ACCESS_TOKEN не задано' });
  }

  try {
    // limit=50: беремо більше постів, бо частина — відео/рілси і буде відфільтрована
    const fields = 'id,media_type,media_url,thumbnail_url,permalink,caption';
    const url = `https://graph.instagram.com/me/media?fields=${fields}&limit=50&access_token=${TOKEN}`;

    const r = await fetch(url);
    const json = await r.json();

    if (!r.ok || json.error) {
      const errMsg = json.error ? json.error.message : 'Instagram API error';
      console.error('Instagram API error:', errMsg);
      return res.status(502).json({ ok: false, error: errMsg });
    }

    // Фільтруємо: тільки фото та каруселі (без відео та рілсів)
    const posts = (json.data || []).filter(p =>
      p.media_type === 'IMAGE' || p.media_type === 'CAROUSEL_ALBUM'
    );

    cache = posts;
    cacheTime = Date.now();

    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(200).json({ ok: true, data: posts });
  } catch (e) {
    console.error('Instagram fetch error:', e);
    return res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
}
