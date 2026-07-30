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

-- Також виправляємо унікальність номерів замовлень:
-- Тепер клієнт сам генерує унікальний номер (KR-YYMMDD-XXXXX),
-- але для надійності додаємо UNIQUE constraint (якщо ще немає).
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_number_unique;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_number_unique UNIQUE (order_number);
