-- Міграція: додаємо gtm_id до таблиці settings_seo
-- Виконати один раз у Supabase SQL Editor

ALTER TABLE settings_seo ADD COLUMN IF NOT EXISTS gtm_id text DEFAULT '';

-- Перевірка:
-- SELECT id, gtm_id, ga_id, fb_pixel FROM settings_seo WHERE id = 1;
