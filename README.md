-- ============================================================
--  KidsRide — Додавання колонок промокоду до таблиці orders
--  Виконай цей SQL у Supabase → SQL Editor
--  (якщо таблиця orders вже існує — виконай саме цей файл)
-- ============================================================

-- Додаємо колонки (IF NOT EXISTS — безпечно, якщо вже є)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS promo_code      text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS promo_type      text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT NULL;

-- Індекс для швидкого пошуку продажів по конкретному промокоду
CREATE INDEX IF NOT EXISTS orders_promo_code_idx ON public.orders (promo_code)
  WHERE promo_code IS NOT NULL;

-- ============================================================
--  Перевірка: SELECT promo_code, promo_type, discount_amount
--  FROM orders WHERE promo_code IS NOT NULL;
-- ============================================================
