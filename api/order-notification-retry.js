import { retryPendingNotifications } from './order-notification-lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const result = await retryPendingNotifications();
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[order-notification] retry worker failed', { error: error.message });
    return res.status(500).json({ ok: false, error: 'Retry worker failed' });
  }
}