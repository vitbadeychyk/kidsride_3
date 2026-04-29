-- ============================================================================
-- KidsRide — таблиця reviews для реальних відгуків покупців.
-- Запустити один раз у Supabase → SQL Editor.
--
-- Після цього:
--   • product.html буде завантажувати відгуки тільки з цієї таблиці
--     (старі hardcoded "Олена Савченко" та "Андрій Коваленко" прибрані).
--   • Кнопка "Написати відгук" зберігатиме новий відгук у цю таблицю.
--   • Адмінка → Відгуки тягне записи звідси, можна видаляти/публікувати.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.reviews (
  id           uuid          primary key default gen_random_uuid(),
  product_id   uuid          not null references public.products(id) on delete cascade,
  author_name  text          not null,
  city         text          not null default '',
  rating       smallint      not null check (rating between 1 and 5),
  text         text          not null,
  approved     boolean       not null default true,   -- true = одразу видно на сайті
  color_label  text,                                  -- "Колір: Білий" (для картки)
  created_at   timestamptz   not null default now()
);

create index if not exists reviews_product_idx
  on public.reviews (product_id, approved, created_at desc);

-- ── RLS: дозволяємо анонімам читати ТІЛЬКИ approved=true і додавати нові ────
alter table public.reviews enable row level security;

drop policy if exists reviews_read_approved on public.reviews;
create policy reviews_read_approved
  on public.reviews
  for select
  using (approved = true);

drop policy if exists reviews_insert_anon on public.reviews;
create policy reviews_insert_anon
  on public.reviews
  for insert
  with check (true);

-- ── Адмінка повинна мати змогу видаляти/правити. Якщо у вас є окрема роль
--    "service_role" (Supabase service key) — вона ігнорує RLS і так працює.
--    Якщо адмінка користується anon-ключем (як зараз) — додаємо політики:
drop policy if exists reviews_update_anon on public.reviews;
create policy reviews_update_anon
  on public.reviews
  for update
  using (true)
  with check (true);

drop policy if exists reviews_delete_anon on public.reviews;
create policy reviews_delete_anon
  on public.reviews
  for delete
  using (true);

-- ── Перевірка: ─────────────────────────────────────────────────────────────
-- SELECT * FROM public.reviews ORDER BY created_at DESC LIMIT 20;
