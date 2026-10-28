-- Isolated proposal. NOT applied to production.
-- Reuses the existing subscription-alerts scheduler secret, Inbox and Web Push.
-- IMPORTANT: No recipient is enabled by this migration. Activate only after verifying
-- that the company/user pair is the intended Vision administrator (not a partner).

create table if not exists private.vision_commercial_alert_recipients (
  company_id uuid primary key references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists private.vision_commercial_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.vision_commercial_campaigns(id) on delete cascade,
  recipient_company_id uuid not null references public.companies(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  end_date date not null,
  title text not null,
  message text not null,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed','cancelled')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  result jsonb,
  created_at timestamptz not null default now(),
  unique (campaign_id, recipient_company_id, end_date)
);

create index if not exists vision_commercial_alert_queue_idx
  on private.vision_commercial_alert_deliveries (status, next_attempt_at);

alter table private.vision_commercial_alert_recipients enable row level security;
alter table private.vision_commercial_alert_deliveries enable row level security;
revoke all on private.vision_commercial_alert_recipients,
              private.vision_commercial_alert_deliveries from public, anon, authenticated;

create or replace function private.enqueue_vision_commercial_alerts()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  campaign_row record;
  recipient_row record;
  inserted_id uuid;
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
  title_text text;
  body_text text;
  total integer := 0;
begin
  for campaign_row in
    select c.id, c.name, c.end_date, a.name as advertiser_name
    from public.vision_commercial_campaigns c
    join public.vision_advertisers a on a.id = c.advertiser_id
    where c.archived_at is null
      and a.archived_at is null
      and c.status in ('active','paused')
      and c.end_date between today_sp - 7 and today_sp
  loop
    title_text := left(
      (case when campaign_row.end_date = today_sp then 'Campanha vence hoje • '
            else 'Campanha vencida • ' end) || campaign_row.advertiser_name, 120);
    body_text := left(
      'Anunciante: ' || campaign_row.advertiser_name ||
      '. Campanha: ' || campaign_row.name ||
      (case when campaign_row.end_date = today_sp then '. Vence hoje, '
            else '. Venceu em ' end) ||
      to_char(campaign_row.end_date, 'DD/MM/YYYY') ||
      '. Verifique a renovação.',
      500
    );

    for recipient_row in
      select r.company_id, r.user_id
      from private.vision_commercial_alert_recipients r
      join public.companies co on co.id = r.company_id
      where r.enabled = true and co.owner_user_id = r.user_id
    loop
      inserted_id := null;
      insert into private.vision_commercial_alert_deliveries
        (campaign_id, recipient_company_id, recipient_user_id, end_date, title, message)
      values
        (campaign_row.id, recipient_row.company_id, recipient_row.user_id,
         campaign_row.end_date, title_text, body_text)
      on conflict do nothing returning id into inserted_id;

      if inserted_id is not null then
        insert into public.company_notifications(company_id, title, message)
        values (recipient_row.company_id, title_text, body_text);
        total := total + 1;
      end if;
    end loop;
  end loop;
  return total;
end;
$$;
revoke all on function private.enqueue_vision_commercial_alerts() from public, anon, authenticated;

create or replace function public.claim_vision_commercial_alerts()
returns table(id uuid, company_id uuid, user_id uuid, title text, message text)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_vision_commercial_alerts();

  -- Do not send a stale push after the advertiser renews or the recipient is disabled.
  update private.vision_commercial_alert_deliveries d set status = 'cancelled'
  where d.status in ('pending','processing') and (
    not exists (
      select 1 from public.vision_commercial_campaigns c
      where c.id = d.campaign_id and c.end_date = d.end_date
        and c.archived_at is null and c.status in ('active','paused')
    ) or not exists (
      select 1 from private.vision_commercial_alert_recipients r
      where r.company_id = d.recipient_company_id
        and r.user_id = d.recipient_user_id and r.enabled = true
    )
  );

  return query with queued as (
    select d.id from private.vision_commercial_alert_deliveries d
    where d.attempts < 3 and d.next_attempt_at <= now()
      and (d.status = 'pending'
        or (d.status = 'processing' and d.claimed_at < now() - interval '10 minutes'))
    order by d.next_attempt_at, d.id
    for update skip locked limit 25
  ), claimed as (
    update private.vision_commercial_alert_deliveries d
      set status = 'processing', claimed_at = now(), attempts = d.attempts + 1
    from queued q where d.id = q.id returning d.*
  )
  select c.id, c.recipient_company_id, c.recipient_user_id, c.title, c.message
  from claimed c;
end;
$$;
revoke all on function public.claim_vision_commercial_alerts() from public, anon, authenticated;
grant execute on function public.claim_vision_commercial_alerts() to service_role;

create or replace function public.finish_vision_commercial_alert(
  p_id uuid, p_result jsonb, p_retry boolean default false
) returns void language sql security definer set search_path = '' as $$
  update private.vision_commercial_alert_deliveries
  set result = p_result,
      status = case when p_retry and attempts < 3 then 'pending'
                    when p_retry then 'failed' else 'completed' end,
      next_attempt_at = now() + interval '1 hour'
  where id = p_id and status = 'processing';
$$;
revoke all on function public.finish_vision_commercial_alert(uuid,jsonb,boolean)
  from public, anon, authenticated;
grant execute on function public.finish_vision_commercial_alert(uuid,jsonb,boolean)
  to service_role;

-- Existing internal token is verified by public.verify_subscription_alert_token().
-- No secret is added to the browser or hardcoded in this migration.
create or replace function private.dispatch_vision_commercial_alerts()
returns bigint language plpgsql security definer set search_path = '' as $$
declare request_id bigint;
begin
  select net.http_post(
    url := 'https://fpadgedrgcxrrqflzhjt.supabase.co/functions/v1/commercial-expiry-alerts',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || token),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id
  from private.subscription_alert_config where id = 1;
  return request_id;
end;
$$;
revoke all on function private.dispatch_vision_commercial_alerts()
  from public, anon, authenticated;

-- Supabase pg_cron uses UTC by default: 12:05 UTC = 09:05 São Paulo.
-- Confirm project cron.timezone before applying. No TV/Player code is touched.
select cron.schedule(
  'vision-commercial-expiry-alerts',
  '5 12 * * *',
  'select private.dispatch_vision_commercial_alerts();'
);
