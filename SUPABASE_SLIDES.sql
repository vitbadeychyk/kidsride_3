-- ============================================================================
-- KidsRide — таблиця слайдів каруселі для синхронізації між пристроями
-- Виконати ОДИН раз у Supabase: SQL Editor → New query → вставити → Run
-- ============================================================================

create table if not exists public.slides (
  id          text        primary key,
  title       text        not null default '',
  link        text        not null default '',
  enabled     boolean     not null default true,
  image       text        not null default '',
  bg          text        not null default 'linear-gradient(135deg,#1B2A4A,#2d4270)',
  sort_order  integer     not null default 0,
  updated_at  timestamptz          default now()
);

-- Авто-оновлення updated_at
create or replace function public.slides_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists slides_set_updated_at on public.slides;
create trigger slides_set_updated_at
  before update on public.slides
  for each row execute function public.slides_set_updated_at();

-- Row-Level Security
alter table public.slides enable row level security;

-- Публічне читання (відвідувачі сайту бачать слайди)
drop policy if exists "slides_select_public" on public.slides;
create policy "slides_select_public" on public.slides
  for select using (true);

-- Запис лише для авторизованих користувачів (адмінів)
drop policy if exists "slides_write_authenticated" on public.slides;
create policy "slides_write_authenticated" on public.slides
  for all
  to authenticated
  using (true)
  with check (true);
