// Vercel Serverless Function: отримує фото-пости з Instagram
// Зберігає: api/instagram.js у вашому проекті
//
// Налаштування:
// 1. Додайте INSTAGRAM_ACCESS_TOKEN у Vercel → Settings → Environment Variables
// 2. Оновіть index.html (замініть рядок IG_API як описано нижче)

const CACHE_DURATION = 10 * 60 * 1000; // 10 хвилин кеш
let cache = null;
let cacheTime = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!TOKEN) {
    return res.status(500).json({ ok: false, error: 'INSTAGRAM_ACCESS_TOKEN не задано' });
  }

  // Повернути кеш якщо свіжий
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(200).json({ ok: true, data: cache });
  }

  try {
    const fields = 'id,media_type,media_url,thumbnail_url,permalink,caption';
    const url = `https://graph.instagram.com/me/media?fields=${fields}&limit=20&access_token=${TOKEN}`;

    const r = await fetch(url);
    const json = await r.json();

    if (!r.ok || json.error) {
      const errMsg = json.error ? json.error.message : 'Instagram API error';
      console.error('Instagram API error:', errMsg);
      return res.status(502).json({ ok: false, error: errMsg });
    }

    // Фільтруємо: тільки фото та каруселі (без відео)
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
