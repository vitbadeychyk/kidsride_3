-- ══════════════════════════════════════════════════════════════════════════
-- FIX_ORDER_NUMBERS.sql — унікальні короткі номери замовлень через DB sequence
-- Виконати один раз у Supabase SQL Editor
-- Результат: KR-32, KR-33, KR-34 ... (автоматично, гарантовано унікально)
-- ══════════════════════════════════════════════════════════════════════════

-- 1) Прибираємо старий UNIQUE constraint якщо є (з попередньої міграції)
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_number_unique;

-- 2) Створюємо sequence, починаючи від поточного максимального числового номера + 1.
--    Так нові KR-N не перетинаються з вже існуючими KR-260728 тощо.
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

SELECT setval(
  'order_number_seq',
  COALESCE(
    (SELECT MAX(CAST(REGEXP_REPLACE(order_number, '[^0-9]', '', 'g') AS BIGINT))
     FROM public.orders
     WHERE order_number ~ '^KR-[0-9]+$'),
    0
  )
);

-- 3) Функція-тригер: завжди перезаписує order_number при INSERT
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.order_number := 'KR-' || nextval('order_number_seq')::TEXT;
  RETURN NEW;
END;
$$;

-- 4) Тригер на таблиці orders
DROP TRIGGER IF EXISTS trg_set_order_number ON public.orders;
CREATE TRIGGER trg_set_order_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_order_number();

-- Готово. Тепер кожне нове замовлення отримає номер KR-N де N = попередній + 1.
