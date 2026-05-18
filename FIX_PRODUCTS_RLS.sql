-- ============================================================================
-- KidsRide — Виправлення RLS для таблиці products (ОНОВЛЕНА ВЕРСІЯ)
-- ============================================================================
-- Запустіть у Supabase → SQL Editor → Run
-- Після виконання поверніться в адмінку → Товари → "Спробувати знову"
-- ============================================================================

-- Крок 1: Видалити ВСІ існуючі RLS-правила для products
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM   pg_policies
    WHERE  schemaname = 'public' AND tablename = 'products'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON products', pol.policyname);
  END LOOP;
END $$;

-- Крок 2: Увімкнути RLS (якщо ще не увімкнено)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Крок 3: Дозволити ВСІМ читати товари (публічний каталог + адмінка)
CREATE POLICY allow_read_products
  ON products
  FOR SELECT
  USING (true);

-- Крок 4: Дозволити авторизованим користувачам (адміну) редагувати товари
CREATE POLICY allow_write_products
  ON products
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Крок 5: Перевірка — покаже активні правила
SELECT
  policyname,
  cmd,
  roles,
  qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'products';
