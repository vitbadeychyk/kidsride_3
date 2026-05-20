// Vercel Serverless Function: отримує фото-пости з Instagram
  // Автоматично оновлює токен через api/ig-refresh.js (cron: 1-го числа щомісяця)
  //
  // Токен зберігається у Supabase (таблиця settings, ключ instagram_token).
  // Як резерв — змінна середовища INSTAGRAM_ACCESS_TOKEN у Vercel.

  const CACHE_DURATION = 10 * 60 * 1000; // 10 хвилин
  let cache = null;
  let cacheTime = 0;

  // Supabase anon key вже публічний (є у frontend HTML) — безпечно використовувати тут
  const SUPA_URL = 'https://xczrzdbikkycgpnvolib.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjenJ6ZGJpa2t5Y2dwbnZvbGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjUyMTgsImV4cCI6MjA5MjkwMTIxOH0.2ClxkizpRUdaJaHndjsH4RIb_lnIJ_imrTRYBNhTqkQ';

  async function getToken() {
    // 1. Читаємо токен із Supabase (там завжди найсвіжіша версія)
    try {
      const r = await fetch(
        SUPA_URL + '/rest/v1/settings?select=value&key=eq.instagram_token',
        { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows && rows[0] && rows[0].value) return rows[0].value;
      }
    } catch (e) {
      console.error('Supabase read error:', e.message);
    }

    // 2. Резерв — змінна середовища Vercel
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

    // Повертаємо кеш якщо свіжий
    if (cache && Date.now() - cacheTime < CACHE_DURATION) {
      res.setHeader('Cache-Control', 'public, max-age=600');
      return res.status(200).json({ ok: true, data: cache });
    }

    const TOKEN = await getToken();
    if (!TOKEN) {
      console.error('No Instagram token found');
      return res.status(500).json({ ok: false, error: 'Instagram token не знайдено' });
    }

    try {
      // limit=50: беремо більше, бо частина — відео/рілси і буде відфільтрована
      const fields = 'id,media_type,media_url,thumbnail_url,permalink,caption';
      const url = 'https://graph.instagram.com/v22.0/me/media?fields=' + fields + '&limit=50&access_token=' + TOKEN;

      const r = await fetch(url);
      const json = await r.json();

      if (!r.ok || json.error) {
        const errMsg = json.error ? json.error.message : 'Instagram API error';
        console.error('Instagram API error:', errMsg);
        return res.status(502).json({ ok: false, error: errMsg });
      }

      // Тільки фото та каруселі — відео та рілси пропускаємо
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
  