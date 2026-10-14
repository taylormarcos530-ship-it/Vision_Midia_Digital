-- Real linked staging Auth identities; SQL/RLS verification with no passwords or HTTP tokens.
-- Target exclusively: jmiuitrrhtaeyrpuyohk
-- Explicit transaction and rollback, never persist a simulated block or ad.
begin;
set local statement_timeout='15s';
do $guard$ begin
 if to_regclass('private.vision_staging_guard') is null or not exists (
  select 1 from private.vision_staging_guard where project_ref='jmiuitrrhtaeyrpuyohk'
 ) then raise exception 'staging_only_guard_rejected'; end if;
 if (select count(*) from public.vision_advertisers where name in
  ('Anunciante A - Homologacao','Anunciante B - Homologacao') and status='active' and archived_at is null)<>2
 then raise exception 'both_staging_advertisers_required'; end if;
end $guard$;

select set_config('request.jwt.claim.sub',(select user_id::text from public.vision_advertisers where name='Anunciante A - Homologacao'),true);
set local role authenticated;
do $test_a$ declare d jsonb;begin
 select public.vision_advertiser_portal() into d;
 if d->'advertiser'->>'name'<>'Anunciante A - Homologacao'
 then raise exception 'A portal ownership failed'; end if;
 if (select count(*) from public.vision_advertisers)<>1
 then raise exception 'A sees another advertiser via RLS'; end if;
 if (select count(*) from public.vision_commercial_campaigns)<>1
 then raise exception 'A campaign isolation failure'; end if;
 if jsonb_array_length(d->'campaigns')<>1
    or d->'campaigns'->0->>'name'<>'HOMOLOGACAO A - Campanha ilustrativa (NAO VEICULAR)'
    or d->'campaigns'->0->>'status'<>'draft'
 then raise exception 'A portal returned incorrect campaign';end if;
 if jsonb_array_length(d->'daily')<>0 or jsonb_array_length(d->'targets')<>0
 then raise exception 'A received fictitious playback or TV records';end if;
end $test_a$;
reset role;

select set_config('request.jwt.claim.sub',(select user_id::text from public.vision_advertisers where name='Anunciante B - Homologacao'),true);
set local role authenticated;
do $test_b$ declare d jsonb;begin
 select public.vision_advertiser_portal() into d;
 if d->'advertiser'->>'name'<>'Anunciante B - Homologacao'
 then raise exception 'B portal ownership failed'; end if;
 if (select count(*) from public.vision_advertisers)<>1
 then raise exception 'B sees another advertiser via RLS'; end if;
 if (select count(*) from public.vision_commercial_campaigns)<>1
 then raise exception 'B campaign isolation failure'; end if;
 if jsonb_array_length(d->'campaigns')<>1
    or d->'campaigns'->0->>'name'<>'HOMOLOGACAO B - Campanha ilustrativa (NAO VEICULAR)'
    or d->'campaigns'->0->>'status'<>'draft'
 then raise exception 'B portal returned incorrect campaign';end if;
 if jsonb_array_length(d->'daily')<>0 or jsonb_array_length(d->'targets')<>0
 then raise exception 'B received fictitious playback or TV records';end if;
end $test_b$;
reset role;

update public.vision_advertisers
 set status='disabled',archived_at=now()
 where name='Anunciante A - Homologacao';

select set_config('request.jwt.claim.sub',(select user_id::text from public.vision_advertisers where name='Anunciante A - Homologacao'),true);
set local role authenticated;
do $disabled$ declare denied boolean:=false;begin
 begin perform public.vision_advertiser_portal();
 exception when sqlstate '42501' then denied:=true;
 end;
 if not denied then raise exception 'archived advertiser still can access portal';end if;
 if (select count(*) from public.vision_advertisers)<>0
 then raise exception 'archived advertiser sees rows';end if;
end $disabled$;
reset role;
rollback;
select 'PASS: A/B isolated, archive denied and rolled back' as result,
 (select count(*) from public.vision_advertisers where status='active' and archived_at is null) active_after_rollback,
 (select count(*) from auth.users) users_unchanged;
