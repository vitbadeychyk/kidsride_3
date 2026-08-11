const MAX_ATTEMPTS = 20;
const TELEGRAM_ATTEMPTS = 3;
const TELEGRAM_TIMEOUT_MS = 8000;

function requiredConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!supabaseKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!telegramToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!telegramChatId) missing.push('TELEGRAM_CHAT_ID');
  if (missing.length) {
    throw new Error(`Відсутні змінні середовища: ${missing.join(', ')}`);
  }

  return { supabaseUrl, supabaseKey, telegramToken, telegramChatId };
}

async function supabaseRequest(path, options = {}) {
  const { supabaseUrl, supabaseKey } = requiredConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Supabase ${response.status}: ${body.slice(0, 300) || 'невідома помилка'}`,
    );
  }

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[<>&"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
  }[char]));
}

function money(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('uk-UA')} ₴`;
}

function formatOrderMessage(order, items) {
  const deliveryLabel = {
    warehouse: 'Відділення НП',
    postomat: 'Поштомат НП',
    address: 'Адресна доставка',
  }[order.delivery_type] || order.delivery_type || '—';

  const customerName = [order.customer_first_name, order.customer_last_name]
    .filter(Boolean)
    .join(' ') || '—';
  const lines = [
    '🛍 <b>НОВЕ ЗАМОВЛЕННЯ</b>',
    `<b>#${esc(order.order_number || order.id)}</b>`,
    '',
    `👤 <b>${esc(customerName)}</b>`,
    `📞 <a href="tel:${esc(order.customer_phone)}">${esc(order.customer_phone)}</a>`,
  ];

  if (order.customer_email) lines.push(`📧 ${esc(order.customer_email)}`);
  lines.push('');
  lines.push(`🚚 <b>Доставка:</b> ${esc(deliveryLabel)}`);
  if (order.delivery_city) lines.push(`📍 ${esc(order.delivery_city)}`);
  if (order.delivery_warehouse) lines.push(`🏪 ${esc(order.delivery_warehouse)}`);
  if (order.delivery_address) lines.push(`🏠 ${esc(order.delivery_address)}`);
  lines.push('');
  lines.push(`💳 <b>Оплата:</b> ${esc(order.payment_method_label || order.payment_method || '—')}`);

  if (Array.isArray(items) && items.length) {
    lines.push('');
    lines.push(`🧾 <b>Товари (${items.length}):</b>`);
    items.slice(0, 20).forEach((item, index) => {
      const quantity = Number(item.quantity || 1);
      const price = Number(item.price || 0);
      const sku = item.sku ? ` [${esc(item.sku)}]` : '';
      lines.push(
        `  ${index + 1}. ${esc(item.product_name || 'товар')}${sku} × ${quantity} — ${money(price * quantity)}`,
      );
    });
  }

  lines.push('');
  if (order.promo_code && Number(order.discount_amount) > 0) {
    lines.push(`💰 <b>Сума:</b> <s>${money(order.subtotal)}</s> → ${money(order.total)}`);
    lines.push(
      `🎁 <b>Промокод:</b> <code>${esc(order.promo_code)}</code> — знижка <b>${money(order.discount_amount)}</b>`,
    );
  } else {
    lines.push(`💰 <b>Сума:</b> ${money(order.total)}`);
  }

  if (order.comment) {
    lines.push('');
    lines.push(`💬 ${esc(order.comment)}`);
  }

  lines.push('');
  lines.push(
    `🕒 ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', hour12: false })} (Київ)`,
  );
  return lines.join('\n');
}

export async function sendTelegram(text) {
  const { telegramToken, telegramChatId } = requiredConfig();
  let lastError = 'Telegram не відповів';

  for (let attempt = 1; attempt <= TELEGRAM_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${telegramToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
          signal: controller.signal,
        },
      );
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok === true) return body;
      lastError = body.description || `HTTP ${response.status}`;
    } catch (error) {
      lastError = error?.name === 'AbortError' ? 'Тайм-аут Telegram' : error.message;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < TELEGRAM_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw new Error(lastError);
}

async function getQueueRow(orderId) {
  const rows = await supabaseRequest(
    `order_notification_queue?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`,
  );
  return Array.isArray(rows) ? rows[0] : rows;
}

async function ensureQueueRow(orderId) {
  const existing = await getQueueRow(orderId);
  if (existing) return existing;

  const rows = await supabaseRequest('order_notification_queue?on_conflict=order_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify([{
      order_id: orderId,
      status: 'pending',
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
    }]),
  });
  return (Array.isArray(rows) && rows[0]) || getQueueRow(orderId);
}

async function claimQueueRow(row, force) {
  if (!row || row.status === 'sent' || row.status === 'processing') return null;
  if (!force && row.next_attempt_at && new Date(row.next_attempt_at) > new Date()) {
    return null;
  }

  const nextAttempt = Number(row.attempts || 0) + 1;
  const rows = await supabaseRequest(
    `order_notification_queue?id=eq.${encodeURIComponent(row.id)}&status=in.(pending,failed)`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'processing',
        attempts: nextAttempt,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return Array.isArray(rows) ? rows[0] : rows;
}

async function markSent(queueId) {
  await supabaseRequest(`order_notification_queue?id=eq.${encodeURIComponent(queueId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'sent',
      sent_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function markFailed(queueId, attempts, error) {
  const delayMinutes = Math.min(60, Math.max(5, 5 * 2 ** Math.min(attempts - 1, 3)));
  await supabaseRequest(`order_notification_queue?id=eq.${encodeURIComponent(queueId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'failed',
      last_error: String(error).slice(0, 500),
      next_attempt_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function processOrderNotification(orderId, { force = false } = {}) {
  if (!orderId) throw new Error('Не передано orderId');
  const queue = await ensureQueueRow(orderId);
  if (!queue) throw new Error('Не вдалося створити чергу сповіщень');
  if (queue.status === 'sent') return { sent: true, queued: true, duplicate: true };

  const claimed = await claimQueueRow(queue, force);
  if (!claimed) {
    return { sent: false, queued: true, inProgress: queue.status === 'processing' };
  }

  try {
    const orders = await supabaseRequest(
      `orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`,
    );
    const order = Array.isArray(orders) ? orders[0] : orders;
    if (!order) throw new Error('Замовлення не знайдено');

    const items = await supabaseRequest(
      `order_items?order_id=eq.${encodeURIComponent(orderId)}&select=*&order=created_at.asc`,
    );
    await sendTelegram(formatOrderMessage(order, Array.isArray(items) ? items : []));
    await markSent(claimed.id);
    return { sent: true, queued: true };
  } catch (error) {
    await markFailed(claimed.id, Number(claimed.attempts || 1), error.message);
    throw error;
  }
}

export async function retryPendingNotifications() {
  const now = encodeURIComponent(new Date().toISOString());
  const stale = encodeURIComponent(new Date(Date.now() - 15 * 60 * 1000).toISOString());
  await supabaseRequest(
    `order_notification_queue?status=eq.processing&updated_at=lt.${stale}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'pending',
        next_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
  );
  const rows = await supabaseRequest(
    `order_notification_queue?status=in.(pending,failed)&next_attempt_at=lte.${now}&attempts=lt.${MAX_ATTEMPTS}&select=order_id&order=created_at.asc&limit=20`,
  );
  const result = { checked: Array.isArray(rows) ? rows.length : 0, sent: 0, failed: 0 };

  for (const row of Array.isArray(rows) ? rows : []) {
    try {
      const outcome = await processOrderNotification(row.order_id);
      if (outcome.sent) result.sent += 1;
    } catch (error) {
      result.failed += 1;
      console.error('[order-notification] retry failed', {
        orderId: row.order_id,
        error: error.message,
      });
    }
  }
  return result;
}

// Vercel treats every JavaScript file directly inside /api as a possible
// function. Keep this shared module non-callable as a public endpoint.
export default async function handler(_req, res) {
  return res.status(404).json({ ok: false, error: 'Not found' });
}