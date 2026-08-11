-- ══════════════════════════════════════════════════════════════════════════
-- FIX_TG_RLS.sql — виправлення RLS для Telegram-сповіщень про замовлення
-- Виконати один раз у Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

-- Дозволяємо анонімному клієнту (checkout.html в браузері покупця) читати
-- ТІЛЬКИ рядок id=1 з таблиці settings_notifications.
-- Це потрібно щоб checkout.html міг отримати tg_token і tg_chat для
-- відправки Telegram-сповіщення після оформлення замовлення.

-- Якщо ця політика вже існує — DROP+CREATE оновить її без помилок.
DROP POLICY IF EXISTS "settings_notifications_select_anon" ON public.settings_notifications;

CREATE POLICY "settings_notifications_select_anon"
  ON public.settings_notifications
  FOR SELECT
  TO anon, authenticated
  USING (id = 1);

-- ВАЖЛИВО: якщо ви вже виконували попередню версію цього файлу і отримали
-- помилку "duplicate key value violates unique constraint orders_order_number_unique"
-- при оформленні замовлення — виконайте цей рядок щоб прибрати constraint:
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_number_unique;
-- Номери замовлень тепер унікальні самі по собі (KR-YYMMDD-XXXXX суфікс мс-timestamp),
-- тому додатковий DB constraint не потрібен.
