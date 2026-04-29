-- ============================================================================
-- KidsRide — таблиці orders та order_items для прийому замовлень з checkout.html
-- Виконати у Supabase: SQL Editor → New query → вставити → Run
-- ----------------------------------------------------------------------------
-- Якщо ваші таблиці вже існують з іншими колонками — порівняйте і додайте
-- бракуючі через ALTER TABLE ... ADD COLUMN ... .
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── ORDERS ────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id                          uuid        primary key default gen_random_uuid(),
  order_number                text        not null,
  customer_first_name         text        not null default '',
  customer_last_name          text        not null default '',
  customer_phone              text        not null default '',
  customer_email              text,
  delivery_type               text        not null default 'warehouse',
  delivery_city               text        not null default '',
  delivery_city_ref           text        not null default '',
  delivery_warehouse          text        not null default '',
  delivery_warehouse_number   text        not null default '',
  delivery_address            text        not null default '',
  payment_method              text        not null default 'fop',
  payment_method_label        text        not null default '',
  comment                     text        not null default '',
  subtotal                    numeric     not null default 0,
  total                       numeric     not null default 0,
  items_count                 integer     not null default 0,
  status                      text        not null default 'Новий',
  ttn                         text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz          default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx     on public.orders (status);
create index if not exists orders_phone_idx      on public.orders (customer_phone);

-- ── ORDER_ITEMS ───────────────────────────────────────────────────────────
create table if not exists public.order_items (
  id              uuid        primary key default gen_random_uuid(),
  order_id        uuid        not null references public.orders(id) on delete cascade,
  product_id      text        not null default '',
  product_name    text        not null default '',
  product_brand   text        not null default '',
  product_image   text        not null default '',
  color           text        not null default '',
  price           numeric     not null default 0,
  quantity        integer     not null default 1,
  subtotal        numeric     not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- ── Авто-оновлення updated_at ─────────────────────────────────────────────
create or replace function public.orders_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.orders_set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- Дозволити будь-кому (включно з анонімними покупцями) СТВОРЮВАТИ замовлення
drop policy if exists "orders_insert_anyone"      on public.orders;
create policy "orders_insert_anyone" on public.orders
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "order_items_insert_anyone" on public.order_items;
create policy "order_items_insert_anyone" on public.order_items
  for insert
  to anon, authenticated
  with check (true);

-- Читання та редагування — лише для авторизованих (адмін-панель)
drop policy if exists "orders_select_auth"        on public.orders;
create policy "orders_select_auth" on public.orders
  for select
  to authenticated
  using (true);

drop policy if exists "orders_update_auth"        on public.orders;
create policy "orders_update_auth" on public.orders
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "order_items_select_auth"   on public.order_items;
create policy "order_items_select_auth" on public.order_items
  for select
  to authenticated
  using (true);
