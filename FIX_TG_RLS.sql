-- ══════════════════════════════════════════════════════════════════════════
-- FIX_TG_RLS.sql — закриття витоку Telegram-токена з браузера
-- Виконати один раз у Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════

-- Раніше checkout читав tg_token/tg_chat через anon API. Це небезпечно:
-- токен бота був доступний кожному відвідувачу сайту. Тепер checkout ходить
-- тільки до /api/order-notification, а токен зберігається у Vercel env.
DROP POLICY IF EXISTS "settings_notifications_select_anon"
  ON public.settings_notifications;

-- Черга та тригер створюються у SUPABASE_ORDERS.sql. Цей файл залишений
-- окремо для безпечного оновлення вже існуючих інсталяцій.
create table if not exists public.order_notification_queue (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade unique,
  status           text not null default 'pending',
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists order_notification_queue_retry_idx
  on public.order_notification_queue (status, next_attempt_at);

alter table public.order_notification_queue enable row level security;

update public.settings_notifications
set tg_token = null,
    tg_chat = null
where id = 1;

create or replace function public.enqueue_order_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.order_notification_queue (order_id)
  values (new.id)
  on conflict (order_id) do nothing;
  return new;
end;
$$;

drop trigger if exists orders_enqueue_notification on public.orders;
create trigger orders_enqueue_notification
  after insert on public.orders
  for each row execute function public.enqueue_order_notification();

insert into public.order_notification_queue (order_id)
select o.id
from public.orders o
left join public.order_notification_queue q on q.order_id = o.id
where q.id is null
on conflict (order_id) do nothing;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_number_unique;
