-- ══════════════════════════════════════════════════════════════════════════
-- FIX_TG_RLS.sql — виправлення RLS для Telegram-сповіщень про замовлення
-- Виконати один раз у Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

-- Telegram більше НЕ відправляється з checkout.html.
-- Токен і Chat ID читає тільки серверна функція /api/order-notification.
-- Не відкривайте settings_notifications анонімному браузеру.

-- Видаляємо стару політику, яка відкривала токен анонімному браузеру.
alter table public.settings_notifications enable row level security;
DROP POLICY IF EXISTS "settings_notifications_select_anon" ON public.settings_notifications;

-- ВАЖЛИВО: якщо ви вже виконували попередню версію цього файлу і отримали
-- помилку "duplicate key value violates unique constraint orders_order_number_unique"
-- при оформленні замовлення — виконайте цей рядок щоб прибрати constraint:
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_number_unique;
-- Номери замовлень тепер унікальні самі по собі (KR-YYMMDD-XXXXX суфікс мс-timestamp),
-- тому додатковий DB constraint не потрібен.
