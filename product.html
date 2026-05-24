-- ══════════════════════════════════════════════════════════════
-- KidsRide — Міграція таблиці ostatok
-- Додає нові поля: sell_price, old_price, images, active
--
-- Запусти один раз у Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Ціна продажу (що показується покупцю)
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS sell_price numeric(10,2) DEFAULT NULL;

-- 2. Стара ціна / РРЦ (перекреслена ціна)
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS old_price numeric(10,2) DEFAULT NULL;

-- 3. Масив URL фото (до 15 посилань)
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS images text[] DEFAULT NULL;

-- 4. Статус: чи показувати товар на сайті (за замовч. true)
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- ══════════════════════════════════════════════════════════════
-- Перевірка — має показати всі нові поля:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'ostatok' ORDER BY ordinal_position;
-- ══════════════════════════════════════════════════════════════
