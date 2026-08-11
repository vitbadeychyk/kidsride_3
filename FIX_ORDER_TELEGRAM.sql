-- KidsRide — серверна черга Telegram-сповіщень про замовлення
-- Виконати один раз у Supabase SQL Editor.
--
-- Важливо: токен бота більше не читається checkout.html. Функція
-- /api/order-notification читає його на сервері з TELEGRAM_* env або
-- з settings_notifications через серверний ключ.

alter table public.orders
  add column if not exists telegram_status text not null default 'pending',
  add column if not exists telegram_attempts integer not null default 0,
  add column if not exists telegram_last_error text,
  add column if not exists telegram_sent_at timestamptz,
  add column if not exists telegram_next_attempt_at timestamptz;

create index if not exists orders_telegram_retry_idx
  on public.orders (telegram_status, telegram_next_attempt_at, created_at);

-- Замовлення, створені до цієї міграції, не мають отримувати старі дублікати:
-- їхній фактичний стан доставки невідомий, тому вважаємо їх уже обробленими.
-- Для конкретного замовлення, яке треба надіслати повторно, можна вручну
-- встановити telegram_status = 'pending' після міграції.
update public.orders
set telegram_status = 'sent'
where telegram_status = 'pending';