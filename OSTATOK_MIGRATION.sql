-- ══════════════════════════════════════════════════════════════
-- KidsRide — Міграція таблиці ostatok
-- Додає нові поля: slug, sell_price, old_price, images, active
--
-- Запусти один раз у Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Власний SEO-slug. SSR шукає записи ostatok тільки за точним slug.
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS slug text DEFAULT NULL;

-- Старим записам даємо безпечний технічний slug, щоб вони не залежали
-- від fuzzy-пошуку за SKU. За потреби його можна змінити в адмінці.
UPDATE ostatok
SET slug = 'os-' || id::text
WHERE slug IS NULL OR btrim(slug) = '';

CREATE UNIQUE INDEX IF NOT EXISTS ostatok_slug_unique_idx
  ON ostatok (slug)
  WHERE slug IS NOT NULL AND btrim(slug) <> '';

-- 2. Ціна продажу (що показується покупцю)
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS sell_price numeric(10,2) DEFAULT NULL;

-- 3. Стара ціна / РРЦ (перекреслена ціна)
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS old_price numeric(10,2) DEFAULT NULL;

-- 4. Масив URL фото (до 15 посилань)
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS images text[] DEFAULT NULL;

-- 5. Статус: чи показувати товар на сайті (за замовч. true)
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- 6. Опис товару та короткий опис для власних позицій.
-- Вони дублюються у products під час збереження, щоб товар однаково
-- відображався і як звичайний товар, і як синтетичний товар зі складу.
ALTER TABLE ostatok
  ADD COLUMN IF NOT EXISTS name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS description text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS description2 text DEFAULT NULL;

-- ══════════════════════════════════════════════════════════════
-- Перевірка — має показати всі нові поля:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'ostatok' ORDER BY ordinal_position;
-- ══════════════════════════════════════════════════════════════
