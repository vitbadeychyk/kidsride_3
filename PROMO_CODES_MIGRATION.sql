-- ============================================================
--  KidsRide — Таблиця промокодів
--  Виконай цей SQL у Supabase → SQL Editor
-- ============================================================

-- 1. Створення таблиці
CREATE TABLE IF NOT EXISTS promo_codes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text        UNIQUE NOT NULL,              -- Промокод (напр. KIDSFREE)
  name             text        NOT NULL,                     -- Назва / опис промокоду
  type             text        NOT NULL DEFAULT 'discount',  -- 'discount' або 'free_delivery'
  discount_percent numeric     DEFAULT 0,                    -- Відсоток знижки (0 для free_delivery)
  start_date       date        NOT NULL,                     -- Дата початку дії (включно)
  end_date         date        NOT NULL,                     -- Дата завершення дії (включно)
  status           text        NOT NULL DEFAULT 'active',    -- 'active' або 'inactive'
  usage_limit      int         DEFAULT NULL,                 -- Ліміт використань (NULL = необмежено)
  usage_count      int         NOT NULL DEFAULT 0,           -- Лічильник використань
  created_at       timestamptz DEFAULT now()
);

-- 2. Індекс для швидкого пошуку по коду
CREATE INDEX IF NOT EXISTS promo_codes_code_idx ON promo_codes (code);

-- 3. RLS (Row Level Security)
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

-- Публічне читання — checkout може перевіряти промокоди без авторизації
DROP POLICY IF EXISTS "public_read_promo" ON promo_codes;
CREATE POLICY "public_read_promo"
  ON promo_codes FOR SELECT
  USING (true);

-- Тільки авторизовані адміни можуть створювати, оновлювати та видаляти
DROP POLICY IF EXISTS "admin_write_promo" ON promo_codes;
CREATE POLICY "admin_write_promo"
  ON promo_codes FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 4. Тестовий промокод для перевірки (можеш видалити потім)
INSERT INTO promo_codes (code, name, type, discount_percent, start_date, end_date, status)
VALUES
  ('KIDSFREE',  'Безкоштовна доставка для підписників', 'free_delivery', 0,  '2025-01-01', '2026-12-31', 'active'),
  ('SALE10',    'Знижка 10% на весь кошик',             'discount',      10, '2025-01-01', '2026-12-31', 'active')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
--  Перевірка: виконай SELECT щоб переконатись
--  SELECT * FROM promo_codes;
-- ============================================================
