-- ═══════════════════════════════════════════════════════════════════════════
-- KIDSRIDE: Міграція — image_url для категорій (мобільна навігація)
-- Виконайте цей скрипт у Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ── КРОК 1: Додати image_url до головних категорій (main_categories) ────────
ALTER TABLE main_categories
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ── КРОК 2: Додати image_url до підкатегорій (categories) ───────────────────
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ── КРОК 3: Перевірити результат ─────────────────────────────────────────────
SELECT id, name, image_url FROM main_categories ORDER BY sort_order, name;
SELECT id, name, main_category_id, image_url FROM categories ORDER BY name;
