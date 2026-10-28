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

-- Recipient explicitly selected: the Vision Master account operated through Academia Life.
-- Seed disabled for QA safety; enabling after a real-device test is a separate, reviewed action.
-- Requires matching slug/name AND verified active platform-admin identity.
insert into private.vision_commercial_alert_recipients(company_id, user_id, enabled)
select c.id, c.owner_user_id, false
from public.companies c
join public.platform_admins pa on pa.user_id = c.owner_user_id
where c.slug = 'visiontek-group-9c77be'
  and c.name = 'Academia Life'
  and pa.status = 'active'
  and pa.role in ('admin','super_admin')
on conflict (company_id) do nothing;

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
      join public.platform_admins pa on pa.user_id = r.user_id
      where r.enabled = true and co.owner_user_id = r.user_id
        and pa.status = 'active' and pa.role in ('admin','super_admin')
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

-- Advertiser-facing email: separate opt-in and outbox, never send to a partner
-- or to a different advertiser. Default is disabled until delivery QA passes.
create table if not exists private.vision_commercial_client_alert_config (
  id integer primary key check (id=1),
  enabled boolean not null default false
);
insert into private.vision_commercial_client_alert_config(id,enabled)
values (1,false) on conflict (id) do nothing;

create table if not exists private.vision_commercial_client_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.vision_commercial_campaigns(id) on delete cascade,
  advertiser_id uuid not null references public.vision_advertisers(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
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
  unique (campaign_id, advertiser_id, end_date)
);
create index if not exists vision_commercial_client_alert_queue_idx
  on private.vision_commercial_client_alert_deliveries(status, next_attempt_at);
alter table private.vision_commercial_client_alert_config enable row level security;
alter table private.vision_commercial_client_alert_deliveries enable row level security;
revoke all on private.vision_commercial_client_alert_config,
              private.vision_commercial_client_alert_deliveries
  from public, anon, authenticated;

create or replace function private.enqueue_vision_commercial_client_alerts()
returns integer language plpgsql security definer set search_path = '' as $$
declare added integer := 0; today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not exists (
    select 1 from private.vision_commercial_client_alert_config
    where id=1 and enabled=true
  ) then return 0; end if;

  with candidates as (
    select c.id campaign_id, c.name campaign_name, c.end_date,
           a.id advertiser_id, a.user_id, lower(trim(a.email)) recipient_email,
           a.name advertiser_name
    from public.vision_commercial_campaigns c
    join public.vision_advertisers a on a.id = c.advertiser_id
    join auth.users u on u.id = a.user_id
    where c.archived_at is null
      and a.archived_at is null and a.status = 'active'
      and c.status in ('active','paused')
      and c.end_date between today_sp-7 and today_sp
      and u.email_confirmed_at is not null
      and lower(trim(a.email)) = lower(trim(u.email))
      and a.email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ), inserted as (
    insert into private.vision_commercial_client_alert_deliveries
      (campaign_id, advertiser_id, recipient_user_id, recipient_email, end_date, title, message)
    select campaign_id, advertiser_id, user_id, recipient_email, end_date,
      left('Vision Mídia Digital • prazo do seu anúncio',120),
      left('Olá, ' || advertiser_name || '! A campanha ' || campaign_name ||
        case when end_date=today_sp then ' vence hoje, ' else ' venceu em ' end ||
        to_char(end_date,'DD/MM/YYYY') ||
        '. Entre em contato com a Vision Mídia Digital para renovar sua divulgação.',500)
    from candidates
    on conflict (campaign_id,advertiser_id,end_date) do nothing
    returning id
  ) select count(*) into added from inserted;
  return added;
end;
$$;
revoke all on function private.enqueue_vision_commercial_client_alerts()
  from public,anon,authenticated;

create or replace function public.claim_vision_commercial_client_alerts()
returns table(id uuid, recipient_email text, title text, message text)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_vision_commercial_client_alerts();

  update private.vision_commercial_client_alert_deliveries d
  set status='cancelled'
  where d.status in ('pending','processing') and
   (not exists (
     select 1 from private.vision_commercial_client_alert_config
     where id=1 and enabled=true
   ) or not exists (
     select 1 from public.vision_commercial_campaigns c
     join public.vision_advertisers a on a.id=c.advertiser_id
     join auth.users u on u.id=a.user_id
     where c.id=d.campaign_id and c.end_date=d.end_date
       and c.archived_at is null and a.archived_at is null
       and c.status in ('active','paused') and a.status='active'
       and a.id=d.advertiser_id and a.user_id=d.recipient_user_id
       and lower(trim(a.email))=d.recipient_email
       and lower(trim(u.email))=d.recipient_email
       and u.email_confirmed_at is not null
   ));

  return query with candidates as (
    select d.id
    from private.vision_commercial_client_alert_deliveries d
    where d.attempts<3 and d.next_attempt_at<=now()
      and (d.status='pending'
        or (d.status='processing' and d.claimed_at<now()-interval '10 minutes'))
    order by d.next_attempt_at,d.id for update skip locked limit 25
  ), claimed as (
    update private.vision_commercial_client_alert_deliveries d
    set status='processing', claimed_at=now(), attempts=d.attempts+1
    from candidates c where d.id=c.id returning d.*
  )
  select c.id,c.recipient_email,c.title,c.message from claimed c;
end;
$$;
revoke all on function public.claim_vision_commercial_client_alerts()
  from public,anon,authenticated;
grant execute on function public.claim_vision_commercial_client_alerts() to service_role;

create or replace function public.finish_vision_commercial_client_alert(
  p_id uuid, p_result jsonb, p_retry boolean default false
) returns void language sql security definer set search_path = '' as $$
  update private.vision_commercial_client_alert_deliveries
  set result=p_result,
      status=case when p_retry and attempts<3 then 'pending'
                  when p_retry then 'failed' else 'completed' end,
      next_attempt_at=now()+interval '1 hour'
  where id=p_id and status='processing';
$$;
revoke all on function public.finish_vision_commercial_client_alert(uuid,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.finish_vision_commercial_client_alert(uuid,jsonb,boolean)
  to service_role;
