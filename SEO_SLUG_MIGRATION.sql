-- ============================================================================
-- KidsRide — додає колонку slug для SEO-friendly product URLs
-- Виконати ОДИН раз у Supabase: SQL Editor → New query → Run
-- Після цього запустити /api/generate-slugs щоб заповнити slug для всіх товарів
-- ============================================================================

-- 1. Додаємо колонку slug (унікальна, nullable — поки не згенеровані)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- 2. Унікальний індекс (дозволяє NULL — кілька товарів можуть ще не мати slug)
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_unique_idx
  ON public.products (slug)
  WHERE slug IS NOT NULL;

-- 3. Індекс для швидкого пошуку за slug (api/resolve-product.js)
CREATE INDEX IF NOT EXISTS products_slug_lookup_idx
  ON public.products (slug)
  WHERE slug IS NOT NULL AND active = true;

-- ============================================================================
-- Після виконання цього SQL:
-- 1. Задеплойте api/generate-slugs.js і api/resolve-product.js на Vercel
-- 2. Відкрийте: https://www.kidsride.com.ua/api/generate-slugs?token=YOUR_TOKEN
--    (або без token якщо не встановили ADMIN_GENERATE_SLUGS_TOKEN)
-- 3. Slugs будуть заповнені для всіх товарів
-- 4. Перевірте: https://www.kidsride.com.ua/product/назва-вашого-товару
-- ============================================================================
