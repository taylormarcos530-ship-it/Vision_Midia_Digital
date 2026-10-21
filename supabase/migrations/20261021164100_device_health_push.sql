-- Vision Mídia Digital: durable, company-scoped device health push queue.
-- Isolated preparation. Apply only after reviewing the Edge Function and Cron authorization.
create table if not exists public.device_health_push_state (
  device_id uuid primary key references public.devices(id) on delete cascade,
  company_id uuid not null,
  connected boolean not null,
  active_error_key text,
  outdated_apk_key text,
  initialized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.device_health_push_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  device_id uuid not null references public.devices(id) on delete cascade,
  kind text not null check (kind in ('offline','online','failure','recovered','update')),
  incident_key text not null,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  sent integer not null default 0,
  failed integer not null default 0,
  last_error text,
  unique (device_id, kind, incident_key)
);
create index if not exists device_health_push_pending_idx
  on public.device_health_push_outbox (created_at)
  where completed_at is null;

alter table public.device_health_push_state enable row level security;
alter table public.device_health_push_outbox enable row level security;
revoke all on table public.device_health_push_state from public, anon, authenticated;
revoke all on table public.device_health_push_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.device_health_push_state to service_role;
grant select, insert, update, delete on table public.device_health_push_outbox to service_role;

-- Atomic claim prevents overlapping Cron invocations from sending the same row concurrently.
create or replace function public.claim_device_health_pushes(p_limit integer default 25)
returns setof public.device_health_push_outbox
language sql
security invoker
set search_path = ''
as $$
  with pending as (
    select q.id
    from public.device_health_push_outbox q
    where q.completed_at is null
      and q.attempts < 3
      and (q.last_attempt_at is null or q.last_attempt_at < now() - interval '3 minutes')
    order by q.created_at, q.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 50)
  )
  update public.device_health_push_outbox q
     set attempts = q.attempts + 1,
         last_attempt_at = now()
  from pending
  where q.id = pending.id
  returning q.*;
$$;
revoke all on function public.claim_device_health_pushes(integer) from public, anon, authenticated;
grant execute on function public.claim_device_health_pushes(integer) to service_role;

-- Reuse the existing server-only subscription-alert token. No key or token is sent to the PWA.
create or replace function private.dispatch_device_health_pushes()
returns bigint language plpgsql security definer set search_path = ''
as $$
declare request_id bigint;
begin
  select net.http_post(
    url := 'https://fpadgedrgcxrrqflzhjt.supabase.co/functions/v1/device-health-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id
  from private.subscription_alert_config
  where id = 1;
  return request_id;
end;
$$;
revoke all on function private.dispatch_device_health_pushes() from public, anon, authenticated;

-- Detection latency ~3-6 min for a heartbeat silence threshold of 3 minutes.
select cron.schedule(
  'vision-device-health-pushes',
  '*/3 * * * *',
  'select private.dispatch_device_health_pushes();'
);
