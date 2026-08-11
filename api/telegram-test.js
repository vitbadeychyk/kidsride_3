import { sendTelegram } from './order-notification-lib.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    await sendTelegram('✅ KidsRide — тестове повідомлення. Telegram підключено на сервері!');
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[telegram-test] failed', { error: error.message });
    return res.status(502).json({ ok: false, error: error.message });
  }
}