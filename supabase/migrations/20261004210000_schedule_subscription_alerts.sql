create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists private.subscription_alert_config (
  id integer primary key check (id=1),
  token text not null default encode(extensions.gen_random_bytes(32),'hex')
);
insert into private.subscription_alert_config(id) values(1) on conflict do nothing;
create table if not exists private.subscription_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  source_company_id uuid not null references public.companies(id) on delete cascade,
  recipient_company_id uuid not null references public.companies(id) on delete cascade,
  due_at timestamptz not null,
  phase text not null check(phase in ('soon','due')),
  title text not null,
  message text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  result jsonb,
  unique(source_company_id,recipient_company_id,due_at,phase)
);
revoke all on private.subscription_alert_config, private.subscription_alert_deliveries from public, anon, authenticated;

create or replace function public.verify_subscription_alert_token(p_token text)
returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from private.subscription_alert_config where id=1 and token=p_token);
$$;
revoke all on function public.verify_subscription_alert_token(text) from public,anon,authenticated;
grant execute on function public.verify_subscription_alert_token(text) to service_role;

create or replace function private.enqueue_subscription_alerts()
returns integer language plpgsql security definer set search_path='' as $$
declare source record; recipient record; due_date date; local_today date; stage text; title_text text; message_text text; delivery_id uuid; added integer:=0;
begin
 for source in
  select c.id,c.name,coalesce(nullif(c.timezone,''),'America/Sao_Paulo') tz,
   case when s.status='trialing' then s.trial_ends_at else s.current_period_end end due_at
  from public.company_subscriptions s join public.companies c on c.id=s.company_id
  where s.status in ('active','trialing','past_due')
 loop
  if source.due_at is null then continue; end if;
  due_date:=(source.due_at at time zone source.tz)::date;
  local_today:=(now() at time zone source.tz)::date;
  if due_date>local_today+3 or due_date<local_today-7 then continue; end if;
  stage:=case when due_date<=local_today then 'due' else 'soon' end;
  title_text:=left(source.name||case when due_date<local_today then ': assinatura vencida' when due_date=local_today then ': vence hoje' else ': vencimento próximo' end,120);
  message_text:='O plano '||case when due_date<local_today then 'venceu' else 'vence' end||' em '||to_char(due_date,'DD/MM/YYYY')||'. Entre em contato com o suporte para renovar.';
  for recipient in
   select source.id id union select c.id from public.companies c join public.platform_admins a on a.user_id=c.owner_user_id where a.status='active' and a.role in ('admin','super_admin')
  loop
   delivery_id:=null;
   insert into private.subscription_alert_deliveries(source_company_id,recipient_company_id,due_at,phase,title,message)
    values(source.id,recipient.id,source.due_at,stage,title_text,message_text)
    on conflict do nothing returning id into delivery_id;
   if delivery_id is not null then
    insert into public.company_notifications(company_id,title,message) values(recipient.id,title_text,message_text);
    added:=added+1;
   end if;
  end loop;
 end loop;
 return added;
end;
$$;
revoke all on function private.enqueue_subscription_alerts() from public,anon,authenticated;

create or replace function public.claim_subscription_alerts()
returns table(id uuid,company_id uuid,title text,message text)
language plpgsql security definer set search_path='' as $$
begin
 perform private.enqueue_subscription_alerts();
 -- Cancel queued notices after renewal or account cancellation.
 update private.subscription_alert_deliveries d set status='cancelled'
 where d.status in ('pending','processing') and not exists (
  select 1 from public.company_subscriptions s where s.company_id=d.source_company_id and s.status in ('active','trialing','past_due')
   and (case when s.status='trialing' then s.trial_ends_at else s.current_period_end end)=d.due_at);
 return query with candidates as (
  select d.id from private.subscription_alert_deliveries d
  where d.attempts<3 and d.next_attempt_at<=now() and (d.status='pending' or (d.status='processing' and d.claimed_at<now()-interval '10 minutes'))
  order by d.next_attempt_at,d.id for update skip locked limit 30
 ), claimed as (
  update private.subscription_alert_deliveries d set status='processing',claimed_at=now(),attempts=d.attempts+1
  from candidates c where d.id=c.id returning d.*
 ) select c.id,c.recipient_company_id,c.title,c.message from claimed c;
end;
$$;
revoke all on function public.claim_subscription_alerts() from public,anon,authenticated;
grant execute on function public.claim_subscription_alerts() to service_role;

create or replace function public.finish_subscription_alert(p_id uuid,p_result jsonb,p_retry boolean default false)
returns void language sql security definer set search_path='' as $$
 update private.subscription_alert_deliveries set result=p_result,
 status=case when p_retry and attempts<3 then 'pending' when p_retry then 'failed' else 'completed' end,
 next_attempt_at=now()+interval '1 hour'
 where id=p_id and status='processing';
$$;
revoke all on function public.finish_subscription_alert(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.finish_subscription_alert(uuid,jsonb,boolean) to service_role;

create or replace function private.dispatch_subscription_alerts()
returns bigint language plpgsql security definer set search_path='' as $$
declare request_id bigint;
begin
 perform private.enqueue_subscription_alerts();
 select net.http_post(
  url:='https://fpadgedrgcxrrqflzhjt.supabase.co/functions/v1/subscription-alerts',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
  body:='{}'::jsonb, timeout_milliseconds:=10000
 ) into request_id from private.subscription_alert_config where id=1;
 return request_id;
end;
$$;
revoke all on function private.dispatch_subscription_alerts() from public,anon,authenticated;
select cron.schedule('vision-subscription-alerts','*/15 * * * *','select private.dispatch_subscription_alerts();');
