-- STAGING ONLY: all synthetic Auth users, ads, devices and impressions ROLLBACK.
-- Never run on production. Target: jmiuitrrhtaeyrpuyohk only.
begin;
do $staging_guard$ begin
 if not exists(select 1 from private.vision_staging_guard where project_ref='jmiuitrrhtaeyrpuyohk') then
  raise exception 'staging_only_guard_rejected';
 end if;
end $staging_guard$;
set local statement_timeout='20s';
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001101','isolated-a@vision-staging.test'),('00000000-0000-4000-8000-000000001102','isolated-b@vision-staging.test');
insert into public.vision_advertisers(id,user_id,name,email) values
 ('00000000-0000-4000-8000-000000001201','00000000-0000-4000-8000-000000001101','Anunciante A Fictício','isolated-a@vision-staging.test'),
 ('00000000-0000-4000-8000-000000001202','00000000-0000-4000-8000-000000001102','Anunciante B Fictício','isolated-b@vision-staging.test');
insert into public.companies(id,name) values ('00000000-0000-4000-8000-000000001601','Estabelecimento de bancada');
insert into public.devices(id,company_id,name,last_seen_at) values ('00000000-0000-4000-8000-000000001501','00000000-0000-4000-8000-000000001601','TV A fictícia',now()),('00000000-0000-4000-8000-000000001502','00000000-0000-4000-8000-000000001601','TV B fictícia',now());
insert into public.vision_commercial_campaigns(id,advertiser_id,name,start_date,end_date,status) values
 ('00000000-0000-4000-8000-000000001301','00000000-0000-4000-8000-000000001201','Campanha A','2026-10-01','2026-12-31','active'),
 ('00000000-0000-4000-8000-000000001302','00000000-0000-4000-8000-000000001202','Campanha B','2026-10-01','2026-12-31','active');
insert into public.vision_commercial_revisions(id,campaign_id,source_media_id,source_storage_path,source_updated_at,name,media_type,storage_path,duration_seconds,checksum) values
 ('00000000-0000-4000-8000-000000001401','00000000-0000-4000-8000-000000001301','00000000-0000-4000-8000-000000001401','staging/a.webp',now(),'Mídia A','image','commercial-ads/staging-a.webp',10,'fixture-a'),
 ('00000000-0000-4000-8000-000000001402','00000000-0000-4000-8000-000000001302','00000000-0000-4000-8000-000000001402','staging/b.webp',now(),'Mídia B','image','commercial-ads/staging-b.webp',10,'fixture-b');
update public.vision_commercial_campaigns set current_revision_id='00000000-0000-4000-8000-000000001401' where id='00000000-0000-4000-8000-000000001301';
update public.vision_commercial_campaigns set current_revision_id='00000000-0000-4000-8000-000000001402' where id='00000000-0000-4000-8000-000000001302';
insert into public.vision_commercial_targets(campaign_id,device_id,point_name,device_name) values
 ('00000000-0000-4000-8000-000000001301','00000000-0000-4000-8000-000000001501','Ponto A','TV A'),('00000000-0000-4000-8000-000000001302','00000000-0000-4000-8000-000000001502','Ponto B','TV B');
insert into public.vision_commercial_daily(campaign_id,revision_id,device_id,day,attempt_count,completed_count) values
 ('00000000-0000-4000-8000-000000001301','00000000-0000-4000-8000-000000001401','00000000-0000-4000-8000-000000001501','2026-10-13',3,2),
 ('00000000-0000-4000-8000-000000001302','00000000-0000-4000-8000-000000001402','00000000-0000-4000-8000-000000001502','2026-10-13',7,5);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
do $test_a$ declare response jsonb; begin
 select public.vision_advertiser_portal() into response;
 if response->'advertiser'->>'id'<>'00000000-0000-4000-8000-000000001201' then raise exception 'A identity mismatched';end if;
 if jsonb_array_length(response->'campaigns')<>1 or response->'campaigns'->0->>'id'<>'00000000-0000-4000-8000-000000001301' then raise exception 'A campaign isolation failed';end if;
 if jsonb_array_length(response->'daily')<>1 or (response->'daily'->0->>'completed_count')::int<>2 then raise exception 'A impression isolation failed';end if;
 if (select count(*) from public.vision_advertisers)<>1 or (select count(*) from public.vision_commercial_campaigns)<>1 then raise exception 'A RLS table visibility failed';end if;
end $test_a$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001102',true);
do $test_b$ declare response jsonb; begin
 select public.vision_advertiser_portal() into response;
 if response->'advertiser'->>'id'<>'00000000-0000-4000-8000-000000001202' then raise exception 'B identity mismatched';end if;
 if jsonb_array_length(response->'campaigns')<>1 or response->'campaigns'->0->>'id'<>'00000000-0000-4000-8000-000000001302' then raise exception 'B campaign isolation failed';end if;
 if jsonb_array_length(response->'daily')<>1 or (response->'daily'->0->>'completed_count')::int<>5 then raise exception 'B impression isolation failed';end if;
 if (select count(*) from public.vision_commercial_revisions)<>1 then raise exception 'B revisions isolation failed';end if;
end $test_b$;
reset role;
update public.vision_advertisers set status='disabled',archived_at=now() where id='00000000-0000-4000-8000-000000001201';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001101',true);
do $test_blocked$ declare rejected boolean:=false; begin
 begin perform public.vision_advertiser_portal();exception when sqlstate '42501' then rejected:=true; end;
 if not rejected then raise exception 'Disabled advertiser still accessed portal';end if;
 if (select count(*) from public.vision_advertisers)>0 then raise exception 'Disabled advertiser still sees data';end if;
end $test_blocked$;
reset role;
set local role anon;
do $test_anonymous$ declare rejected boolean:=false; begin
 begin perform public.vision_advertiser_portal();exception when sqlstate '42501' then rejected:=true; end;
 if not rejected then raise exception 'Anonymous portal call unexpectedly allowed';end if;
end $test_anonymous$;
reset role;
rollback;
select 'PASS: A/B isolated, disabled account blocked, anonymous denied; rollback executed' as staging_test_result,
 (select count(*) from public.vision_advertisers) as remaining_advertisers,
 (select count(*) from auth.users where email like '%@vision-staging.test') as remaining_fixture_users;
