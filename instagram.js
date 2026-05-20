// Vercel Serverless Function: приймає заявку "Купити в 1 клік" та звичайні замовлення
// Зберігає в Supabase (таблиця leads) і шле повідомлення в Telegram

export default async function handler(req, res) {
  // CORS (на випадок якщо викликається не з того ж origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { phone, name, productId, productName, productPrice, productBrand, source, comment, items } = body;

    // Валідація номера: лишаємо тільки цифри/+, перевіряємо довжину
    const phoneClean = String(phone || '').replace(/[^\d+]/g, '');
    if (!phoneClean || phoneClean.replace(/\+/g, '').length < 7) {
      return res.status(400).json({ ok: false, error: 'Невірний номер телефону' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TG_CHAT  = process.env.TELEGRAM_CHAT_ID;

    const lead = {
      phone:         phoneClean.slice(0, 30),
      name:          name ? String(name).slice(0, 100) : null,
      product_id:    productId ? String(productId).slice(0, 100) : null,
      product_name:  productName ? String(productName).slice(0, 200) : null,
      product_price: (productPrice != null && !isNaN(Number(productPrice))) ? Number(productPrice) : null,
      product_brand: productBrand ? String(productBrand).slice(0, 100) : null,
      source:        source ? String(source).slice(0, 50) : 'quick_order',
      status:        'new',
      comment:       comment ? String(comment).slice(0, 1000) : null,
      items:         Array.isArray(items) ? items.slice(0, 50) : null
    };

    // 1) Зберегти в Supabase
    let saved = false, saveError = null;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(lead)
        });
        if (r.ok) saved = true;
        else saveError = await r.text();
      } catch (e) { saveError = e.message; }
    } else {
      saveError = 'SUPABASE_URL / SUPABASE_KEY не задані';
    }

    // 2) Telegram
    let sent = false, tgError = null;
    if (TG_TOKEN && TG_CHAT) {
      const text = formatTelegram(lead);
      try {
        const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TG_CHAT,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          })
        });
        if (r.ok) sent = true;
        else tgError = await r.text();
      } catch (e) { tgError = e.message; }
    } else {
      tgError = 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не задані';
    }

    // Якщо обидва канали впали — повідомляємо помилку
    if (!saved && !sent) {
      return res.status(500).json({ ok: false, error: 'Не вдалось обробити заявку', saveError, tgError });
    }

    return res.status(200).json({ ok: true, saved, sent });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

function formatTelegram(l) {
  const sourceLabel = {
    quick_order: '⚡ Купити в 1 клік',
    product_page: '📄 Сторінка товару',
    catalog: '🛒 З каталогу',
    checkout: '🧾 Оформлення замовлення',
    cart: '🛍 Кошик'
  }[l.source] || l.source;

  const lines = [
    '🔔 <b>НОВА ЗАЯВКА</b>',
    `<i>${esc(sourceLabel)}</i>`,
    ''
  ];
  lines.push(`📞 <b>Телефон:</b> <code>${esc(l.phone)}</code>`);
  if (l.name) lines.push(`👤 <b>Ім'я:</b> ${esc(l.name)}`);

  if (l.product_name) {
    lines.push('');
    lines.push(`🛒 <b>Товар:</b> ${esc(l.product_name)}`);
    if (l.product_brand) lines.push(`🏷 <b>Бренд:</b> ${esc(l.product_brand)}`);
    if (l.product_price) lines.push(`💰 <b>Ціна:</b> ${Number(l.product_price).toLocaleString('uk-UA')} ₴`);
    if (l.product_id) lines.push(`🔖 <b>ID:</b> <code>${esc(l.product_id)}</code>`);
  }

  if (Array.isArray(l.items) && l.items.length) {
    lines.push('');
    lines.push(`🧾 <b>Товари (${l.items.length}):</b>`);
    let total = 0;
    l.items.slice(0, 20).forEach((it, i) => {
      const qty = Number(it.qty || it.quantity || 1);
      const price = Number(it.price || 0);
      total += qty * price;
      lines.push(`  ${i + 1}. ${esc(it.name || it.title || 'товар')} × ${qty} = ${(qty * price).toLocaleString('uk-UA')} ₴`);
    });
    if (total) lines.push(`<b>Разом:</b> ${total.toLocaleString('uk-UA')} ₴`);
  }

  if (l.comment) {
    lines.push('');
    lines.push(`💬 <b>Коментар:</b> ${esc(l.comment)}`);
  }

  lines.push('');
  const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', hour12: false });
  lines.push(`🕒 ${esc(time)} (Київ)`);

  return lines.join('\n');
}
