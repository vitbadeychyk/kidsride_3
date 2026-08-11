import { processOrderNotification } from './order-notification-lib.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const result = await processOrderNotification(body.orderId, { force: true });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[order-notification] immediate send failed', {
      error: error.message,
    });
    return res.status(502).json({
      ok: false,
      queued: true,
      error: 'Замовлення збережено, Telegram спробуємо доставити повторно',
    });
  }
}