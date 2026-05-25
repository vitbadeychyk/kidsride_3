-- ============================================================================
-- KidsRide — автоматична генерація slug при додаванні товару
-- Виконати у Supabase: SQL Editor → New query → Run
--
-- Що робить:
--  1. transliterate_ua() — транслітерація українського тексту в latin slug
--  2. make_unique_slug()  — гарантує унікальність slug (додає -2, -3 якщо є дублі)
--  3. products_auto_slug() — тригер-функція: спрацьовує BEFORE INSERT
--
-- Після цього кожен новий товар автоматично отримує slug.
-- Для старих товарів без slug — запустіть /api/generate-slugs (одноразово).
-- ============================================================================

-- ── 1. Функція транслітерації ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transliterate_ua(str TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT
AS $$
DECLARE
  result TEXT;
BEGIN
  result := lower(trim(str));

  -- Спочатку багатосимвольні замінники (порядок важливий!)
  result := replace(result, 'щ',  'shch');
  result := replace(result, 'ж',  'zh');
  result := replace(result, 'х',  'kh');
  result := replace(result, 'ц',  'ts');
  result := replace(result, 'ч',  'ch');
  result := replace(result, 'ш',  'sh');
  result := replace(result, 'є',  'ie');
  result := replace(result, 'ю',  'iu');
  result := replace(result, 'я',  'ia');

  -- Односимвольні
  result := replace(result, 'а', 'a');
  result := replace(result, 'б', 'b');
  result := replace(result, 'в', 'v');
  result := replace(result, 'г', 'h');
  result := replace(result, 'ґ', 'g');
  result := replace(result, 'д', 'd');
  result := replace(result, 'е', 'e');
  result := replace(result, 'з', 'z');
  result := replace(result, 'и', 'y');
  result := replace(result, 'і', 'i');
  result := replace(result, 'ї', 'i');
  result := replace(result, 'й', 'i');
  result := replace(result, 'к', 'k');
  result := replace(result, 'л', 'l');
  result := replace(result, 'м', 'm');
  result := replace(result, 'н', 'n');
  result := replace(result, 'о', 'o');
  result := replace(result, 'п', 'p');
  result := replace(result, 'р', 'r');
  result := replace(result, 'с', 's');
  result := replace(result, 'т', 't');
  result := replace(result, 'у', 'u');
  result := replace(result, 'ф', 'f');
  result := replace(result, 'ь', '');

  -- Замінюємо все що не a-z0-9 на дефіс
  result := regexp_replace(result, '[^a-z0-9]+', '-', 'g');
  -- Прибираємо дефіси на початку і в кінці
  result := trim(both '-' from result);
  -- Обмежуємо довжину (80 символів)
  result := left(result, 80);
  -- Прибираємо хвостовий дефіс після обрізання
  result := trim(trailing '-' from result);

  RETURN result;
END;
$$;

-- ── 2. Функція унікальності slug ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.make_unique_product_slug(
  base_slug TEXT,
  exclude_id UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  candidate TEXT := base_slug;
  counter   INT  := 2;
BEGIN
  LOOP
    -- Перевіряємо чи slug вже зайнятий (крім поточного товару при UPDATE)
    IF exclude_id IS NOT NULL THEN
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.products
        WHERE slug = candidate AND id != exclude_id
      );
    ELSE
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.products
        WHERE slug = candidate
      );
    END IF;

    candidate := base_slug || '-' || counter;
    counter   := counter + 1;

    -- Захист від нескінченного циклу
    IF counter > 999 THEN
      candidate := base_slug || '-' || floor(extract(epoch from now()))::bigint;
      EXIT;
    END IF;
  END LOOP;

  RETURN candidate;
END;
$$;

-- ── 3. Тригер-функція ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.products_auto_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  base_slug TEXT;
BEGIN
  -- Генеруємо slug тільки якщо він порожній або не заданий
  IF NEW.slug IS NULL OR trim(NEW.slug) = '' THEN
    base_slug := public.transliterate_ua(COALESCE(NEW.name, NEW.id::TEXT, 'product'));

    -- Якщо після транслітерації нічого не залишилось — використовуємо id
    IF base_slug = '' OR base_slug IS NULL THEN
      base_slug := 'product-' || left(NEW.id::TEXT, 8);
    END IF;

    NEW.slug := public.make_unique_product_slug(base_slug, NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. Прив'язуємо тригер до таблиці products ────────────────────────────
DROP TRIGGER IF EXISTS products_auto_slug_trigger ON public.products;

CREATE TRIGGER products_auto_slug_trigger
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_auto_slug();

-- ── 5. Заповнити slug для вже існуючих товарів без slug ───────────────────
-- (Опціонально: якщо не хочете запускати /api/generate-slugs через браузер)
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, name FROM public.products
    WHERE slug IS NULL OR trim(slug) = ''
    ORDER BY created_at ASC
  LOOP
    UPDATE public.products
    SET slug = public.make_unique_product_slug(
      public.transliterate_ua(COALESCE(rec.name, rec.id::TEXT, 'product')),
      rec.id
    )
    WHERE id = rec.id;
  END LOOP;
END;
$$;

-- ── Перевірка результату ──────────────────────────────────────────────────
-- SELECT id, name, slug FROM public.products ORDER BY created_at DESC LIMIT 20;
