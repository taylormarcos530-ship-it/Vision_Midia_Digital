-- H O M O L O G A C A O  O N L Y
-- Adds exactly two visual draft campaigns to the *isolated* test project.
-- NO device targets, NO commercial media, NO playback logs, NO live ads.
-- Target project: jmiuitrrhtaeyrpuyohk (never reuse outside staging).
begin;
set local statement_timeout='20s';
do $seed$
declare
  start_day date:=(now() at time zone 'America/Sao_Paulo')::date;
  campaign_a constant text:='HOMOLOGACAO A - Campanha ilustrativa (NAO VEICULAR)';
  campaign_b constant text:='HOMOLOGACAO B - Campanha ilustrativa (NAO VEICULAR)';
begin
  if to_regclass('private.vision_staging_guard') is null then
    raise exception 'staging_only_guard_rejected';
  end if;
  if not exists (
    select 1 from private.vision_staging_guard
    where project_ref='jmiuitrrhtaeyrpuyohk'
  ) then raise exception 'staging_only_guard_rejected'; end if;

  perform pg_catalog.pg_advisory_xact_lock(20261014,41601);
  if (select count(*) from public.vision_advertisers
      where name in ('Anunciante A - Homologacao','Anunciante B - Homologacao')
        and status='active' and archived_at is null)<>2
  then raise exception 'expected_two_active_test_advertisers'; end if;

  -- No commercial delivery can be triggered by a visual draft.
  if exists(select 1 from public.devices)
     or exists(select 1 from public.vision_commercial_targets)
     or exists(select 1 from public.playback_logs)
  then raise exception 'staging_not_empty_for_safe_campaign_seed'; end if;

  if exists(
    select 1 from public.vision_commercial_campaigns c
      join public.vision_advertisers a on a.id=c.advertiser_id
    where c.name in (campaign_a,campaign_b)
      and (c.status<>'draft' or c.current_revision_id is not null)
  ) then raise exception 'existing_visual_campaign_not_safe'; end if;

  insert into public.vision_commercial_campaigns(advertiser_id,name,start_date,end_date,status)
    select a.id,campaign_a,start_day,start_day+30,'draft'
    from public.vision_advertisers a
    where a.name='Anunciante A - Homologacao' and a.status='active' and a.archived_at is null
      and not exists(select 1 from public.vision_commercial_campaigns c where c.advertiser_id=a.id and c.name=campaign_a);

  insert into public.vision_commercial_campaigns(advertiser_id,name,start_date,end_date,status)
    select a.id,campaign_b,start_day,start_day+30,'draft'
    from public.vision_advertisers a
    where a.name='Anunciante B - Homologacao' and a.status='active' and a.archived_at is null
      and not exists(select 1 from public.vision_commercial_campaigns c where c.advertiser_id=a.id and c.name=campaign_b);

  if (select count(*) from public.vision_commercial_campaigns c
       join public.vision_advertisers a on a.id=c.advertiser_id
       where (a.name='Anunciante A - Homologacao' and c.name=campaign_a)
          or (a.name='Anunciante B - Homologacao' and c.name=campaign_b))<>2
  then raise exception 'staging_visual_campaigns_incomplete'; end if;

  if exists(select 1 from public.vision_commercial_campaigns
       where status<>'draft' or current_revision_id is not null)
     or exists(select 1 from public.vision_commercial_revisions)
     or exists(select 1 from public.vision_commercial_targets)
     or exists(select 1 from public.vision_commercial_daily)
  then raise exception 'unexpected_ad_delivery_state'; end if;
end $seed$;
commit;

select a.name as test_advertiser,c.name as illustration,c.status,
       c.current_revision_id is null as no_media,
       (select count(*) from public.vision_commercial_targets) as tv_links,
       (select count(*) from public.vision_commercial_daily) as recorded_exposures
from public.vision_commercial_campaigns c
join public.vision_advertisers a on a.id=c.advertiser_id
where c.name like 'HOMOLOGACAO % - Campanha ilustrativa (NAO VEICULAR)'
order by a.name;
