// Vercel Serverless Function: отримує фото-пости з Instagram
// Токен зберігається у Supabase (settings → instagram_token), автоматично оновлюється cron job.

const CACHE_DURATION = 30 * 60 * 1000; // 30 хвилин (було 10)
let cache = null;
let cacheTime = 0;

async function getToken() {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supaUrl && supaKey) {
    try {
      const r = await fetch(
        supaUrl + '/rest/v1/settings?select=value&key=eq.instagram_token',
        { headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey } }
      );
      if (r.ok) {
        const rows = await r.json();
        if (rows && rows[0] && rows[0].value) return rows[0].value;
      }
    } catch (e) {
      console.error('Supabase read error:', e.message);
    }
  }

  // Резерв — пряма змінна середовища
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

  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    res.setHeader('Cache-Control', 'public, max-age=1800');
    return res.status(200).json({ ok: true, data: cache });
  }

  const TOKEN = await getToken();
  if (!TOKEN) {
    console.error('No Instagram token found');
    return res.status(500).json({ ok: false, error: 'Instagram token не знайдено' });
  }

  try {
    // limit=12 замість 50 — показуємо лише 8, беремо 12 з запасом на відео/рілси
    const fields = 'id,media_type,media_url,thumbnail_url,permalink,caption';
    const url = 'https://graph.instagram.com/v22.0/me/media?fields=' + fields + '&limit=12&access_token=' + TOKEN;

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

    res.setHeader('Cache-Control', 'public, max-age=1800');
    return res.status(200).json({ ok: true, data: posts });
  } catch (e) {
    console.error('Instagram fetch error:', e);
    return res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
}
