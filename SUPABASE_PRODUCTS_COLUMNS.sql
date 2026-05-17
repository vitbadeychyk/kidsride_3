-- ============================================================================
-- KidsRide — додає у таблицю `products` колонки, яких бракує сторінці товару.
-- Запустіть один раз у Supabase → SQL Editor.
--
-- ❗ Ключова колонка тут — `color`. Без неї весь запит до /products падає з 400
--   ("column products.color does not exist"), і блок "В інших кольорах:"
--   на сторінці товару не зʼявляється.
--
-- Інші колонки потрібні блоку "Характеристики" та для видачі коректного складу
-- товару у адмінці. Усі поля створюються "м'яко" (IF NOT EXISTS), тож якщо
-- частина з них уже існує — нічого не зламається.
-- ============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS color          text,
  ADD COLUMN IF NOT EXISTS age            text,        -- напр. "3-8 років"
  ADD COLUMN IF NOT EXISTS weight         text,        -- "12 кг"
  ADD COLUMN IF NOT EXISTS max_load       text,        -- "30 кг"
  ADD COLUMN IF NOT EXISTS motor          text,        -- "2 × 35 Вт"
  ADD COLUMN IF NOT EXISTS battery        text,        -- "12 В / 7 Аг"
  ADD COLUMN IF NOT EXISTS speed          text,        -- "5 км/год"
  ADD COLUMN IF NOT EXISTS warranty       text,        -- "12 міс."
  ADD COLUMN IF NOT EXISTS assembly_time  text,        -- "20 хв"
  ADD COLUMN IF NOT EXISTS short_desc     text,        -- короткий опис під назвою
  ADD COLUMN IF NOT EXISTS subcategory    text;        -- підкатегорія, напр. "Джипи"

-- Індекс по color прискорить групування варіантів за моделлю+кольором.
CREATE INDEX IF NOT EXISTS products_color_idx
  ON products (color)
  WHERE color IS NOT NULL;

-- ── Перевірка: що тепер є у таблиці ────────────────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'products'
-- ORDER BY ordinal_position;

-- ── Заповнити color у вже існуючих товарів можна так (приклад): ────────────
-- UPDATE products SET color='Чорний'  WHERE sku='M 4259EBLR-1';
-- UPDATE products SET color='Червоний' WHERE sku='M 4259EBLR-2';
-- UPDATE products SET color='Білий'    WHERE sku='M 4259EBLR-3';
