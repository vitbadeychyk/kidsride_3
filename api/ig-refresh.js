// Vercel Cron Function: оновлює Instagram Long-Lived Token
  // Запускається 1-го числа кожного місяця о 09:00 UTC (vercel.json → crons)
  // Зберігає новий токен у Supabase (таблиця settings, ключ instagram_token)

  const SUPA_URL = 'https://xczrzdbikkycgpnvolib.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjenJ6ZGJpa2t5Y2dwbnZvbGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjUyMTgsImV4cCI6MjA5MjkwMTIxOH0.2ClxkizpRUdaJaHndjsH4RIb_lnIJ_imrTRYBNhTqkQ';

  export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // Читаємо поточний токен із Supabase
    let currentToken = null;
    try {
      const r = await fetch(
        SUPA_URL + '/rest/v1/settings?select=value&key=eq.instagram_token',
        { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY } }
      );
      const rows = await r.json();
      if (rows && rows[0] && rows[0].value) currentToken = rows[0].value;
    } catch (e) {
      console.error('Supabase read error:', e.message);
    }

    // Резерв — змінна середовища
    if (!currentToken) currentToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!currentToken) {
      return res.status(500).json({ ok: false, error: 'Немає токену для оновлення' });
    }

    // Оновлюємо токен через Instagram API
    try {
      const igUrl = 'https://graph.instagram.com/v22.0/refresh_access_token?grant_type=ig_refresh_token&access_token=' + currentToken;
      const igRes = await fetch(igUrl);
      const igJson = await igRes.json();

      if (!igRes.ok || igJson.error || !igJson.access_token) {
        const errMsg = igJson.error ? igJson.error.message : 'Instagram refresh error';
        console.error('Instagram refresh failed:', errMsg);
        return res.status(502).json({ ok: false, error: errMsg });
      }

      const newToken = igJson.access_token;
      const expiresIn = igJson.expires_in;

      // Зберігаємо оновлений токен у Supabase (upsert)
      const upsertRes = await fetch(SUPA_URL + '/rest/v1/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPA_KEY,
          Authorization: 'Bearer ' + SUPA_KEY,
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ key: 'instagram_token', value: newToken }),
      });
      const saved = upsertRes.ok;
      if (!saved) console.error('Supabase upsert failed:', await upsertRes.text());

      const days = Math.floor((expiresIn || 0) / 86400);
      console.log('Token refreshed. Expires in', days, 'days. Saved:', saved);
      return res.status(200).json({ ok: true, saved, expires_in_days: days });
    } catch (e) {
      console.error('Refresh error:', e);
      return res.status(500).json({ ok: false, error: e.message || 'Server error' });
    }
  }
  