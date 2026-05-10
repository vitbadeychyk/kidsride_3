-- ═══════════════════════════════════════════════════════════════════════════
-- KIDSRIDE: Міграція — окрема таблиця main_categories
-- Виконайте цей скрипт у Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ── КРОК 1: Створити таблицю main_categories ────────────────────────────────
CREATE TABLE IF NOT EXISTS main_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  active     BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── КРОК 2: Додати колонку main_category_id до categories ───────────────────
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS main_category_id INTEGER
  REFERENCES main_categories(id) ON DELETE SET NULL;

-- ── КРОК 3: RLS — дозволити анонімне читання main_categories ────────────────
ALTER TABLE main_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "allow_anon_read_main_categories"
  ON main_categories FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "allow_all_for_service"
  ON main_categories FOR ALL USING (true);

-- ── КРОК 4: Приклад початкових категорій (відредагуйте під свій бізнес) ─────
-- Ці категорії ви бачитимете в адмін-панелі та зможете призначати підкатегорії
INSERT INTO main_categories (name, active, sort_order) VALUES
  ('Дитячий транспорт', true, 1),
  ('Електромобілі',     true, 2)
ON CONFLICT DO NOTHING;

-- ── КРОК 5: Перевірити результат ────────────────────────────────────────────
SELECT mc.id AS main_id, mc.name AS main_name,
       c.id  AS cat_id,  c.name  AS cat_name
FROM main_categories mc
LEFT JOIN categories c ON c.main_category_id = mc.id
ORDER BY mc.sort_order, mc.name, c.name;
