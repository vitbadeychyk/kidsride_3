// Vercel Serverless Function: Instagram feed proxy
// Потрібна змінна середовища INSTAGRAM_TOKEN (Instagram Graph API access token)
// Отримати токен: https://developers.facebook.com/docs/instagram-basic-display-api

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // Кеш на 10 хвилин
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=60');

  const token = process.env.INSTAGRAM_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, error: 'INSTAGRAM_TOKEN not configured', data: [] });
  }

  const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
  const url = `https://graph.instagram.com/me/media?fields=${fields}&limit=${limit}&access_token=${token}`;

  try {
    const igRes = await fetch(url);
    const json = await igRes.json();

    if (json.error) {
      return res.status(400).json({ ok: false, error: json.error.message, data: [] });
    }

    // Фільтруємо — лише IMAGE та VIDEO (не CAROUSEL_ALBUM без медіа)
    const posts = (json.data || []).filter(p =>
      (p.media_type === 'IMAGE' || p.media_type === 'VIDEO' || p.media_type === 'CAROUSEL_ALBUM')
      && (p.media_url || p.thumbnail_url)
    );

    return res.status(200).json({ ok: true, data: posts });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, data: [] });
  }
}
