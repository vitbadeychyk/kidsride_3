// Vercel Serverless Function: надійна доставка Telegram-сповіщень про замовлення.
//
// POST { order_id } — відправити одне замовлення одразу після оформлення.
// GET              — повторити pending/failed сповіщення (викликається Vercel Cron).
//
// Telegram credentials are intentionally read only on the server. The old
// checkout implementation read them in the buyer's browser and then started a
// request immediately before redirecting to the thank-you page.

const DEFAULT_SUPABASE_URL = 'https://gwslintdrtnvbfjvivbb.supabase.co';
const MAX_ATTEMPTS = 10;
const REQUEST_TIMEOUT_MS = 8000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET' && !isCronAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const orderIds = req.method === 'POST'
      ? [readOrderId(req)]
      : await getPendingOrderIds();

    const ids = orderIds.filter(Boolean).slice(0, 20);
    if (!ids.length) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    const results = [];
    for (const orderId of ids) {
      results.push(await processOrder(orderId));
    }

    const failed = results.filter(result => !result.ok);
    // A POST remains successful from the buyer's perspective even if Telegram
    // is temporarily unavailable: the order is already saved and Cron retries.
    return res.status(failed.length && req.method === 'POST' ? 202 : 200).json({
      ok: failed.length === 0 || req.method === 'POST',
      processed: results.length,
      sent: results.filter(result => result.sent).length,
      queued: results.filter(result => result.queued).length,
      failed: failed.length,
      results: req.method === 'POST' ? results : undefined
    });
  } catch (error) {
    console.error('[order-notification] handler failed:', error);
    return res.status(500).json({ ok: false, error: safeError(error) });
  }
}

function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.authorization === `Bearer ${secret}`;
}

function readOrderId(req) {
  const body = typeof req.body === 'string'
    ? JSON.parse(req.body || '{}')
    : (req.body || {});
  const orderId = String(body.order_id || body.orderId || '').trim();
  if (!/^[0-9a-f-]{20,64}$/i.test(orderId)) {
    throw new Error('Невірний ідентифікатор замовлення');
  }
  return orderId;
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('На сервері не задано SUPABASE_SERVICE_ROLE_KEY або SUPABASE_ANON_KEY');
  return { url: url.replace(/\/$/, ''), key };
}

function supabaseHeaders(prefer) {
  const { key } = supabaseConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function supabaseRequest(path, options = {}) {
  const { url } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(options.prefer),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase ${response.status}: ${message.slice(0, 300)}`);
  }
  return response;
}

async function getPendingOrderIds() {
  let response;
  try {
    response = await supabaseRequest(
      'orders?select=id,telegram_status,telegram_attempts,telegram_next_attempt_at,updated_at&order=created_at.asc&limit=50'
    );
  } catch (error) {
    if (isMissingNotificationSchema(error)) {
      console.error('[order-notification] migration required: FIX_ORDER_TELEGRAM.sql');
      return [];
    }
    throw error;
  }
  const orders = await response.json();
  const now = Date.now();
  return (Array.isArray(orders) ? orders : [])
    .filter(order => {
      const status = order.telegram_status || 'pending';
      const attempts = Number(order.telegram_attempts || 0);
      const nextAttempt = order.telegram_next_attempt_at
        ? Date.parse(order.telegram_next_attempt_at)
        : 0;
      const staleSending = status === 'sending'
        && order.updated_at
        && now - Date.parse(order.updated_at) > 2 * 60 * 1000;
      return (status === 'pending' || status === 'failed' || staleSending)
        && attempts < MAX_ATTEMPTS
        && (!nextAttempt || nextAttempt <= now);
    })
    .map(order => order.id);
}

async function processOrder(orderId) {
  const orderResponse = await supabaseRequest(
    `orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`
  );
  const orderRows = await orderResponse.json();
  const order = Array.isArray(orderRows) ? orderRows[0] : orderRows;
  if (!order) return { orderId, ok: false, error: 'Замовлення не знайдено' };

  const currentStatus = order.telegram_status || 'pending';
  if (currentStatus === 'sent') return { orderId, ok: true, sent: true, alreadySent: true };
  const staleSending = currentStatus === 'sending'
    && order.updated_at
    && Date.now() - Date.parse(order.updated_at) > 2 * 60 * 1000;
  if (currentStatus === 'sending' && !staleSending) {
    return { orderId, ok: true, queued: true };
  }

  const attempt = Number(order.telegram_attempts || 0) + 1;
  let claimed;
  try {
    claimed = await claimOrder(orderId, attempt, staleSending);
  } catch (error) {
    if (!isMissingNotificationSchema(error)) throw error;
    // Temporary compatibility for a deployment made before the migration.
    // Once FIX_ORDER_TELEGRAM.sql is applied, all delivery becomes durable.
    console.error('[order-notification] sending without durable status; apply FIX_ORDER_TELEGRAM.sql');
    return processLegacyOrder(orderId, order);
  }
  if (!claimed) {
    return { orderId, ok: true, queued: true, alreadyClaimed: true };
  }

  try {
    await updateOrderState(orderId, {
    telegram_status: 'sending',
      telegram_attempts: attempt,
      telegram_last_error: null
    });
    const itemsResponse = await supabaseRequest(
      `order_items?order_id=eq.${encodeURIComponent(orderId)}&select=*`
    );
    const items = await itemsResponse.json();
    const config = await getTelegramConfig();
    if (!config.enabled) {
      await updateOrderState(orderId, {
        telegram_status: 'skipped',
        telegram_last_error: 'Сповіщення про нові замовлення вимкнено в налаштуваннях'
      });
      return { orderId, ok: true, queued: false, skipped: true };
    }

    const text = formatTelegram(order, Array.isArray(items) ? items : []);
    await sendTelegramWithRetry(config.token, config.chat, text);
    await updateOrderState(orderId, {
      telegram_status: 'sent',
      telegram_sent_at: new Date().toISOString(),
      telegram_last_error: null,
      telegram_next_attempt_at: null
    });
    return { orderId, ok: true, sent: true };
  } catch (error) {
    const message = safeError(error);
    const canRetry = attempt < MAX_ATTEMPTS;
    await updateOrderState(orderId, {
      telegram_status: canRetry ? 'failed' : 'dead',
      telegram_last_error: message.slice(0, 1000),
      telegram_next_attempt_at: canRetry
        ? new Date(Date.now() + retryDelayMs(attempt)).toISOString()
        : null
    }).catch(updateError => {
      console.error('[order-notification] could not save failure state:', updateError);
    });
    console.error(`[order-notification] order ${orderId} attempt ${attempt} failed:`, message);
    return { orderId, ok: false, queued: canRetry, error: message };
  }
}

async function processLegacyOrder(orderId, order) {
  const itemsResponse = await supabaseRequest(
    `order_items?order_id=eq.${encodeURIComponent(orderId)}&select=*`
  );
  const items = await itemsResponse.json();
  const config = await getTelegramConfig();
  if (!config.enabled) {
    return { orderId, ok: true, skipped: true, untracked: true };
  }
  await sendTelegramWithRetry(config.token, config.chat, formatTelegram(order, Array.isArray(items) ? items : []));
  return { orderId, ok: true, sent: true, untracked: true };
}

async function updateOrderState(orderId, patch) {
  await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    prefer: 'return=minimal'
  });
}

async function claimOrder(orderId, attempt, staleSending) {
  const statusFilter = staleSending
    ? `telegram_status=eq.sending&updated_at=lt.${encodeURIComponent(new Date(Date.now() - 2 * 60 * 1000).toISOString())}`
    : 'telegram_status=in.(pending,failed)';
  const response = await supabaseRequest(
    `orders?id=eq.${encodeURIComponent(orderId)}&${statusFilter}&telegram_attempts=lt.${MAX_ATTEMPTS}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        telegram_status: 'sending',
        telegram_attempts: attempt,
        telegram_last_error: null
      }),
      prefer: 'return=representation'
    }
  );
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows.length > 0 : Boolean(rows && rows.id);
}

function isMissingNotificationSchema(error) {
  const message = safeError(error);
  return message.includes('42703')
    || message.includes('telegram_status')
    || message.includes('telegram_attempts');
}

async function getTelegramConfig() {
  const envToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const envChat = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (envToken && envChat) {
    return { token: envToken, chat: envChat, enabled: true };
  }

  const response = await supabaseRequest(
    'settings_notifications?id=eq.1&select=tg_token,tg_chat,tg_new_order&limit=1'
  );
  const rows = await response.json();
  const config = Array.isArray(rows) ? rows[0] : rows;
  if (!config || !config.tg_token || !config.tg_chat) {
    throw new Error('Не задано Telegram Bot Token або Chat ID');
  }
  return {
    token: String(config.tg_token).trim(),
    chat: String(config.tg_chat).trim(),
    enabled: config.tg_new_order !== false
  };
}

async function sendTelegramWithRetry(token, chat, text) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchWithTimeout(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chat,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          })
        },
        REQUEST_TIMEOUT_MS
      );
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok !== false) return payload;
      lastError = new Error(`Telegram ${response.status}: ${payload.description || 'помилка API'}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await wait(250 * attempt);
  }
  throw lastError || new Error('Telegram не відповів');
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function retryDelayMs(attempt) {
  return Math.min(60 * 60 * 1000, Math.max(60 * 1000, 2 ** attempt * 60 * 1000));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeError(error) {
  return String(error && error.message ? error.message : error || 'Невідома помилка');
}

function escapeTelegram(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function money(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('uk-UA')} ₴`;
}

function formatTelegram(order, items) {
  const deliveryLabel = {
    warehouse: 'Відділення НП',
    postomat: 'Поштомат НП',
    address: 'Адресна доставка'
  }[order.delivery_type] || order.delivery_type || '—';

  const lines = [
    '🛍 <b>НОВЕ ЗАМОВЛЕННЯ</b>',
    `<b>#${escapeTelegram(order.order_number || order.id)}</b>`,
    '',
    `👤 <b>${escapeTelegram(`${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || '—')}</b>`,
    `📞 <a href="tel:${escapeTelegram(order.customer_phone || '')}">${escapeTelegram(order.customer_phone || '—')}</a>`
  ];
  if (order.customer_email) lines.push(`📧 ${escapeTelegram(order.customer_email)}`);

  lines.push('', `🚚 <b>Доставка:</b> ${escapeTelegram(deliveryLabel)}`);
  if (order.delivery_city) lines.push(`📍 ${escapeTelegram(order.delivery_city)}`);
  if (order.delivery_warehouse) lines.push(`🏪 ${escapeTelegram(order.delivery_warehouse)}`);
  if (order.delivery_address) lines.push(`🏠 ${escapeTelegram(order.delivery_address)}`);

  lines.push('', `💳 <b>Оплата:</b> ${escapeTelegram(order.payment_method_label || order.payment_method || '—')}`);
  if (items.length) {
    lines.push('', `🧾 <b>Товари (${items.length}):</b>`);
    items.slice(0, 20).forEach((item, index) => {
      const quantity = Number(item.quantity || 1);
      const sku = item.sku ? ` [${escapeTelegram(item.sku)}]` : '';
      lines.push(`  ${index + 1}. ${escapeTelegram(item.product_name || 'товар')}${sku} × ${quantity} — ${money(Number(item.price || 0) * quantity)}`);
    });
  }

  lines.push('');
  if (order.promo_code && Number(order.discount_amount) > 0) {
    lines.push(`💰 <b>Сума:</b> <s>${money(order.subtotal)}</s> → ${money(order.total)}`);
    lines.push(`🎁 <b>Промокод:</b> <code>${escapeTelegram(order.promo_code)}</code> — знижка <b>${money(order.discount_amount)}</b>`);
  } else {
    lines.push(`💰 <b>Сума:</b> ${money(order.total)}`);
  }
  if (order.comment) lines.push('', `💬 ${escapeTelegram(order.comment)}`);
  lines.push('', `🕒 ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', hour12: false })} (Київ)`);
  return lines.join('\n');
}