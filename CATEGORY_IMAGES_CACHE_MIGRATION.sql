-- KidsRide — довгий browser cache для 9 cache-busted WebP категорій
-- Запустіть один раз у Supabase → SQL Editor.
--
-- Ці URL мають версіоновані імена, тому річний immutable-кеш не застаріє
-- після заміни файлу: для нової версії використовується новий object name.

UPDATE storage.objects
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{cacheControl}',
  -- Supabase Storage додає `public,` до цього metadata value у відповіді.
  to_jsonb('max-age=31536000, immutable'::text),
  true
)
WHERE bucket_id = 'category-images'
  AND name IN (
    'main/elektromobili-600.webp',
    'main/dytiachyi-transport-600.webp',
    'main/tovary-dlia-divchatok-600.webp',
    'main/mebli-600.webp',
    'main/tovary-dlia-nemovliat-600.webp',
    'main/aktyvnyi-vidpochynok-600.webp',
    'main/baseiny-600.webp',
    'main/koliasky-600.webp',
    'main/hadkhodzhennia-za-tyzhden-600.webp'
  );

-- Перевірка: кожен рядок має повернути cacheControl зі значенням вище.
SELECT name, metadata->>'cacheControl' AS cache_control
FROM storage.objects
WHERE bucket_id = 'category-images'
  AND name IN (
    'main/elektromobili-600.webp',
    'main/dytiachyi-transport-600.webp',
    'main/tovary-dlia-divchatok-600.webp',
    'main/mebli-600.webp',
    'main/tovary-dlia-nemovliat-600.webp',
    'main/aktyvnyi-vidpochynok-600.webp',
    'main/baseiny-600.webp',
    'main/koliasky-600.webp',
    'main/hadkhodzhennia-za-tyzhden-600.webp'
  )
ORDER BY name;