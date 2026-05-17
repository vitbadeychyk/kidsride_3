-- ═══════════════════════════════════════════════════════════════════════════
-- KIDSRIDE: Міграція — батьківські категорії (ієрархія двох рівнів)
-- Виконайте цей скрипт у Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ── КРОК 1: Додати колонку parent_id ────────────────────────────────────────
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS parent_id INTEGER;

-- ── КРОК 2: Додати зовнішній ключ (якщо RLS дозволяє) ──────────────────────
-- Якщо виникне помилка — пропустіть цей рядок, parent_id все одно працюватиме
ALTER TABLE categories
  ADD CONSTRAINT IF NOT EXISTS fk_categories_parent
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;

-- ── КРОК 3: Вставити головні (батьківські) категорії ────────────────────────
-- ID 9001, 9002 — спеціальні ID, що не конфліктують з XML-синхронізацією
-- (XML зазвичай генерує ID < 9000)
INSERT INTO categories (id, name, active, parent_id) VALUES
  (9001, 'Дитячий транспорт', true, NULL),
  (9002, 'Електромобілі',     true, NULL)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      active = EXCLUDED.active,
      parent_id = NULL;

-- ── КРОК 4: Призначити підкатегорії ─────────────────────────────────────────
-- ВАЖЛИВО: Перевірте реальні назви через SELECT id, name FROM categories ORDER BY name;
-- Потім розкоментуйте та виконайте відповідні рядки нижче.

-- === Підкатегорії "Дитячий транспорт" (parent_id = 9001) ===
-- Велосипеди, самокати, біговели, каталки, ходунки, санки, скейти тощо

-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%велосипед%' AND id < 9000;
-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%самокат%'   AND id < 9000;
-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%біговел%'   AND id < 9000;
-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%каталка%'   AND id < 9000;
-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%толокар%'   AND id < 9000;
-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%ходунк%'    AND id < 9000;
-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%санк%'      AND id < 9000;
-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%скейт%'     AND id < 9000;
-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%ролик%'     AND id < 9000;
-- UPDATE categories SET parent_id = 9001 WHERE name ILIKE '%гойдалк%'   AND id < 9000;

-- === Підкатегорії "Електромобілі" (parent_id = 9002) ===
-- Електромобілі, джипи, квадроцикли, мотоцикли, трактори, вантажівки, баггі

-- UPDATE categories SET parent_id = 9002 WHERE name ILIKE '%електромобіл%' AND id < 9000;
-- UPDATE categories SET parent_id = 9002 WHERE name ILIKE '%джип%'          AND id < 9000;
-- UPDATE categories SET parent_id = 9002 WHERE name ILIKE '%квадроцикл%'    AND id < 9000;
-- UPDATE categories SET parent_id = 9002 WHERE name ILIKE '%мотоцикл%'      AND id < 9000;
-- UPDATE categories SET parent_id = 9002 WHERE name ILIKE '%трактор%'       AND id < 9000;
-- UPDATE categories SET parent_id = 9002 WHERE name ILIKE '%вантаж%'        AND id < 9000;
-- UPDATE categories SET parent_id = 9002 WHERE name ILIKE '%баггі%'         AND id < 9000;
-- UPDATE categories SET parent_id = 9002 WHERE name ILIKE '%машин%'         AND id < 9000;

-- ── КРОК 5: Перевірити результат ────────────────────────────────────────────
SELECT
  c.id,
  c.name,
  c.active,
  c.parent_id,
  p.name AS parent_name
FROM categories c
LEFT JOIN categories p ON p.id = c.parent_id
ORDER BY
  COALESCE(c.parent_id, c.id),
  c.parent_id IS NULL DESC,
  c.name;
