-- ══════════════════════════════════════════════════════════════
-- KidsRide — Налаштування Supabase Storage для завантаження фото
-- Запусти один раз у Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Створити публічний бакет product-images (якщо ще не існує)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Дозволити аутентифікованим (адмін) завантажувати файли
CREATE POLICY IF NOT EXISTS "Authenticated users can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images');

-- 3. Дозволити читати всім (щоб фото відображались на сайті)
CREATE POLICY IF NOT EXISTS "Public read access"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'product-images');

-- 4. Дозволити адміну видаляти фото
CREATE POLICY IF NOT EXISTS "Authenticated users can delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images');

-- ══════════════════════════════════════════════════════════════
-- Якщо SQL Editor видає помилку "policy already exists" — ігноруй,
-- це означає, що права вже налаштовані коректно.
-- ══════════════════════════════════════════════════════════════
