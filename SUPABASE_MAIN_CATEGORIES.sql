-- ============================================================================
-- KidsRide — таблиця page_views для реальної аналітики в адмінці
-- Виконати у Supabase: SQL Editor → New query → вставити → Run
-- ----------------------------------------------------------------------------
-- shared.js при завантаженні кожної сторінки робить INSERT сюди.
-- Адмінка читає та агрегує ці дані для панелей Dashboard / Аналітика.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.page_views (
  id           uuid        primary key default gen_random_uuid(),
  path         text        not null default '/',
  referrer     text,
  source       text        not null default 'direct',  -- direct/google/instagram/facebook/...
  device       text        not null default 'desktop', -- mobile/tablet/desktop
  visitor_id   text        not null default '',
  session_id   text        not null default '',
  ua           text,
  created_at   timestamptz not null default now()
);

create index if not exists page_views_created_idx    on public.page_views (created_at desc);
create index if not exists page_views_visitor_idx    on public.page_views (visitor_id);
create index if not exists page_views_session_idx    on public.page_views (session_id);
create index if not exists page_views_path_idx       on public.page_views (path);
create index if not exists page_views_source_idx     on public.page_views (source);

-- ── Row-Level Security ────────────────────────────────────────────────────
alter table public.page_views enable row level security;

-- Будь-який гість може ЗАПИСАТИ візит (анонімний трекінг)
drop policy if exists "page_views_insert_anyone" on public.page_views;
create policy "page_views_insert_anyone" on public.page_views
  for insert
  to anon, authenticated
  with check (true);

-- Читання — лише авторизовані (адмінка)
drop policy if exists "page_views_select_auth" on public.page_views;
create policy "page_views_select_auth" on public.page_views
  for select
  to authenticated
  using (true);
