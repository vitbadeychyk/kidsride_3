-- ══════════════════════════════════════════════════════════════
-- KidsRide — Додає поле category_id у таблицю ostatok
-- Запусти один раз у Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS category_id integer REFERENCES categories(id) ON DELETE SET NULL;

-- Індекс для швидкого пошуку за підкатегорією
CREATE INDEX IF NOT EXISTS ostatok_category_id_idx
  ON ostatok (category_id)
  WHERE category_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- Перевірка:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'ostatok' ORDER BY ordinal_position;
-- ══════════════════════════════════════════════════════════════
