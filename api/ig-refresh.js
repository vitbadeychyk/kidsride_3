// Vercel Serverless Function (Cron Job): оновлює Instagram Long-Lived Token
// Запускається автоматично раз на 30 днів через vercel.json → crons
// Зберігає оновлений токен у Supabase (таблиця settings, ключ instagram_token)
//
// Необхідні змінні середовища у Vercel:
//   INSTAGRAM_ACCESS_TOKEN  — початковий довгостроковий токен (отриманий вручну)
//   SUPABASE_URL            — URL вашого Supabase проекту
//   SUPABASE_SERVICE_ROLE_KEY або SUPABASE_ANON_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  // Отримуємо поточний токен: спочатку з Supabase, потім з env
  let currentToken = null;

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/settings?select=value&key=eq.instagram_token`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await r.json();
      if (rows && rows[0] && rows[0].value) {
        currentToken = rows[0].value;
      }
    } catch (e) {
      console.error('Supabase read error:', e.message);
    }
  }

  if (!currentToken) {
    currentToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  }

  if (!currentToken) {
    return res.status(500).json({ ok: false, error: 'Немає токену для оновлення' });
  }

  // Оновлюємо токен через Instagram API
  try {
    const igUrl = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`;
    const igRes = await fetch(igUrl);
    const igJson = await igRes.json();

    if (!igRes.ok || igJson.error || !igJson.access_token) {
      const errMsg = igJson.error ? igJson.error.message : 'Instagram refresh error';
      console.error('Instagram refresh failed:', errMsg);
      return res.status(502).json({ ok: false, error: errMsg });
    }

    const newToken = igJson.access_token;
    const expiresIn = igJson.expires_in; // seconds (~5184000 = 60 днів)

    // Зберігаємо новий токен у Supabase
    let saved = false;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        // Upsert: оновити якщо існує, вставити якщо ні
        const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ key: 'instagram_token', value: newToken }),
        });
        saved = upsertRes.ok;
        if (!saved) {
          console.error('Supabase upsert failed:', await upsertRes.text());
        }
      } catch (e) {
        console.error('Supabase write error:', e.message);
      }
    }

    const expiresInDays = Math.floor((expiresIn || 0) / 86400);
    console.log(`Instagram token refreshed. Expires in ${expiresInDays} days. Saved to Supabase: ${saved}`);

    return res.status(200).json({
      ok: true,
      saved,
      expires_in_days: expiresInDays,
    });
  } catch (e) {
    console.error('Refresh error:', e);
    return res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
}
