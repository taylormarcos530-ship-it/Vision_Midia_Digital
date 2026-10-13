-- REVIEWABLE INSTALL SCRIPT. Not applied remotely. Run only on isolated staging first.
-- Additive: no changes to operational tables, existing policies, playlists or Auth triggers.
begin;
create table public.vision_advertisers (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete restrict,
 name text not null check(length(trim(name)) between 2 and 140), email text not null,
 status text not null default 'active' check(status in ('active','disabled')), created_at timestamptz not null default now()
);
create table public.vision_commercial_campaigns (
 id uuid primary key default gen_random_uuid(), advertiser_id uuid not null references public.vision_advertisers(id) on delete restrict,
 name text not null check(length(trim(name)) between 2 and 140), start_date date not null, end_date date not null,
 status text not null default 'draft' check(status in ('draft','active','paused')), current_revision_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(end_date>=start_date)
);
create table public.vision_commercial_revisions (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.vision_commercial_campaigns(id) on delete restrict,
 source_media_id uuid not null, source_storage_path text not null, source_updated_at timestamptz not null, name text not null, media_type text not null check(media_type in ('image','video')),
 storage_path text not null unique, duration_seconds numeric not null check(duration_seconds>0 and duration_seconds<=3600),
 size_bytes bigint, checksum text not null, width int,height int, created_at timestamptz not null default now(), unique(id,campaign_id)
);
alter table public.vision_commercial_campaigns add constraint commercial_current_revision_fk foreign key(current_revision_id,id) references public.vision_commercial_revisions(id,campaign_id);
create table public.vision_commercial_targets (
 campaign_id uuid not null references public.vision_commercial_campaigns(id) on delete restrict, device_id uuid not null,
 point_name text not null, device_name text not null, active boolean not null default true,
 delivery_status text not null default 'pending_player_check', delivery_checked_at timestamptz,
 created_at timestamptz not null default now(), primary key(campaign_id,device_id)
);
create table public.vision_commercial_daily (
 campaign_id uuid not null, revision_id uuid not null, device_id uuid not null, day date not null,
 attempt_count bigint not null, completed_count bigint not null, last_completed_at timestamptz, updated_at timestamptz not null default now(),
 primary key(revision_id,device_id,day), foreign key(revision_id,campaign_id) references public.vision_commercial_revisions(id,campaign_id) on delete restrict,
 check(completed_count>=0 and attempt_count>=completed_count)
);
create index commercial_campaign_advertiser_idx on public.vision_commercial_campaigns(advertiser_id);
create index commercial_target_device_idx on public.vision_commercial_targets(device_id,campaign_id);
create index commercial_revision_campaign_idx on public.vision_commercial_revisions(campaign_id);
create index commercial_daily_campaign_idx on public.vision_commercial_daily(campaign_id,day);

create function private.vision_advertiser_id() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.vision_advertisers where user_id=(select auth.uid()) and status='active'
$$;
revoke all on function private.vision_advertiser_id() from public,anon;
grant execute on function private.vision_advertiser_id() to authenticated,service_role;

create function private.vision_advertiser_account_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.company_members where user_id=new.user_id) or exists(select 1 from public.platform_admins where user_id=new.user_id) then raise exception 'separate_advertiser_account'; end if;
 if tg_op='UPDATE' and new.user_id<>old.user_id then raise exception 'immutable_advertiser_identity'; end if;
 return new;
end $$;
create trigger commercial_account_guard before insert or update on public.vision_advertisers for each row execute function private.vision_advertiser_account_guard();

-- Prevent an advertiser identity from being assigned to operational roles later.
-- Existing point owners and Master accounts are unaffected. This script is staging-only.
create function private.vision_reject_advertiser_role() returns trigger language plpgsql security definer set search_path='' as $$
declare candidate uuid;
begin
 candidate:=nullif(to_jsonb(new)->>tg_argv[0],'')::uuid;
 if candidate is not null and exists(select 1 from public.vision_advertisers a where a.user_id=candidate) then
  raise exception 'separate_advertiser_account' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.vision_reject_advertiser_role() from public,anon,authenticated;
create trigger commercial_guard_company_member before insert or update of user_id on public.company_members
 for each row execute function private.vision_reject_advertiser_role('user_id');
create trigger commercial_guard_platform_admin before insert or update of user_id on public.platform_admins
 for each row execute function private.vision_reject_advertiser_role('user_id');
create trigger commercial_guard_company_owner before insert or update of owner_user_id on public.companies
 for each row execute function private.vision_reject_advertiser_role('owner_user_id');

create function private.vision_revision_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'immutable_revision';end$$;
create trigger commercial_revision_immutable before update or delete on public.vision_commercial_revisions for each row execute function private.vision_revision_immutable();
revoke all on function private.vision_advertiser_account_guard(),private.vision_revision_immutable() from public,anon,authenticated;

alter table public.vision_advertisers enable row level security;
alter table public.vision_commercial_campaigns enable row level security;
alter table public.vision_commercial_revisions enable row level security;
alter table public.vision_commercial_targets enable row level security;
alter table public.vision_commercial_daily enable row level security;
revoke all on public.vision_advertisers,public.vision_commercial_campaigns,public.vision_commercial_revisions,public.vision_commercial_targets,public.vision_commercial_daily from public,anon,authenticated;
grant select on public.vision_advertisers,public.vision_commercial_campaigns,public.vision_commercial_revisions,public.vision_commercial_targets,public.vision_commercial_daily to authenticated;
grant all on public.vision_advertisers,public.vision_commercial_campaigns,public.vision_commercial_revisions,public.vision_commercial_targets,public.vision_commercial_daily to service_role;
create policy advertiser_self on public.vision_advertisers for select to authenticated using(id=(select private.vision_advertiser_id()));
create policy commercial_self on public.vision_commercial_campaigns for select to authenticated using(advertiser_id=(select private.vision_advertiser_id()));
create policy commercial_revision_self on public.vision_commercial_revisions for select to authenticated using(exists(select 1 from public.vision_commercial_campaigns c where c.id=campaign_id and c.advertiser_id=(select private.vision_advertiser_id())));
create policy commercial_target_self on public.vision_commercial_targets for select to authenticated using(exists(select 1 from public.vision_commercial_campaigns c where c.id=campaign_id and c.advertiser_id=(select private.vision_advertiser_id())));
create policy commercial_daily_self on public.vision_commercial_daily for select to authenticated using(exists(select 1 from public.vision_commercial_campaigns c where c.id=campaign_id and c.advertiser_id=(select private.vision_advertiser_id())));
create policy commercial_thumbnail_self on storage.objects for select to authenticated using(bucket_id='vision-media' and exists(select 1 from public.vision_commercial_revisions r join public.vision_commercial_campaigns c on c.id=r.campaign_id where r.storage_path=storage.objects.name and c.advertiser_id=(select private.vision_advertiser_id())));

-- Invoked only by the already authenticated Master backend with its service role.
create function private.vision_require_master(p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_actor is null or not exists(select 1 from public.platform_admins where user_id=p_actor and status='active' and role in ('super_admin','admin')) then raise exception 'master_forbidden' using errcode='42501'; end if;
end$$;
revoke all on function private.vision_require_master(uuid) from public,anon,authenticated;

create function public.vision_commercial_save_campaign(p_actor uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; aid uuid; rid uuid; asset public.media_assets; prev public.vision_commercial_revisions; target uuid; n int; snapshot_path text; snapshot_used boolean:=false;
begin
 perform private.vision_require_master(p_actor);
 perform pg_catalog.pg_advisory_xact_lock(7162026); -- Serialize commercial saves, never operational playlists.
 aid:=(p_data->>'advertiser_id')::uuid;cid:=nullif(p_data->>'id','')::uuid;
 if not exists(select 1 from public.vision_advertisers where id=aid) then raise exception 'advertiser_not_found'; end if;
 if jsonb_typeof(p_data->'device_ids') is distinct from 'array' or jsonb_array_length(p_data->'device_ids') not between 1 and 100 then raise exception 'select_1_to_100_devices';end if;
 if cid is null then
 insert into public.vision_commercial_campaigns(advertiser_id,name,start_date,end_date,status) values(aid,trim(p_data->>'name'),(p_data->>'start_date')::date,(p_data->>'end_date')::date,coalesce(p_data->>'status','draft')) returning id into cid;
 else
 perform 1 from public.vision_commercial_campaigns where id=cid and advertiser_id=aid for update;
 if not found then raise exception 'campaign_not_found';end if;
 update public.vision_commercial_campaigns set name=trim(p_data->>'name'),start_date=(p_data->>'start_date')::date,end_date=(p_data->>'end_date')::date,status=coalesce(p_data->>'status','draft'),updated_at=now() where id=cid;
 end if;
 select * into asset from public.media_assets where id=(p_data->>'media_id')::uuid and processing_status='ready' and media_type in ('image','video') and storage_path is not null;
 if not found then raise exception 'ready_image_or_video_required';end if;
 select r.* into prev from public.vision_commercial_revisions r join public.vision_commercial_campaigns c on c.current_revision_id=r.id where c.id=cid;
 if prev.id is null or prev.source_media_id<>asset.id or prev.checksum<>coalesce(asset.checksum_sha256,'') or prev.source_storage_path<>asset.storage_path or prev.source_updated_at is distinct from asset.updated_at then
 snapshot_path:=nullif(p_data->>'commercial_copy_path','');
 -- The commercial revision must point to its own immutable, already copied Storage object.
 -- No operational media is moved, overwritten, locked or deleted.
 if snapshot_path is null or snapshot_path !~ '^commercial-ads/[a-f0-9-]{36}([.][a-z0-9]{2,5})?
   or snapshot_path=asset.storage_path
   or not exists(select 1 from storage.objects where bucket_id='vision-media' and name=snapshot_path)
 then raise exception 'commercial_snapshot_required';end if;
 insert into public.vision_commercial_revisions(campaign_id,source_media_id,source_storage_path,source_updated_at,name,media_type,storage_path,duration_seconds,size_bytes,checksum,width,height) values(cid,asset.id,asset.storage_path,asset.updated_at,asset.name,asset.media_type,snapshot_path,coalesce(asset.duration_seconds,10),asset.size_bytes,coalesce(asset.checksum_sha256,''),asset.width,asset.height) returning id into rid;
 snapshot_used:=true;
 update public.vision_commercial_campaigns set current_revision_id=rid where id=cid;
 end if;
 update public.vision_commercial_targets set active=false,delivery_status='pending_player_check',delivery_checked_at=null where campaign_id=cid;
 for target in select distinct value::uuid from jsonb_array_elements_text(p_data->'device_ids') loop
 if p_data->>'status'='active' and (select count(*) from public.vision_commercial_targets t join public.vision_commercial_campaigns c on c.id=t.campaign_id where t.device_id=target and t.active and c.id<>cid and c.status='active' and c.start_date<=(p_data->>'end_date')::date and c.end_date>=(p_data->>'start_date')::date)>=20 then raise exception 'commercial_device_capacity_20';end if;
 insert into public.vision_commercial_targets(campaign_id,device_id,point_name,device_name) select cid,d.id,c.name,d.name from public.devices d join public.companies c on c.id=d.company_id where d.id=target and d.retired_at is null
 on conflict(campaign_id,device_id) do update set active=true;
 get diagnostics n=row_count;if n=0 then raise exception 'device_unavailable';end if;
 end loop;
 return jsonb_build_object('id',cid,'snapshot_used',snapshot_used);
end$$;
revoke all on function public.vision_commercial_save_campaign(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.vision_commercial_save_campaign(uuid,jsonb) to service_role;

-- No trigger on playback_logs: consolidation failure cannot reject a normal playback batch.
-- Existing raw logs are not deleted. Reconcile every recorded commercial day for this TV,
-- so a rollup outage cannot silently discard older or delayed offline events. Idempotent.
create function public.vision_commercial_refresh_daily(p_device uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 -- TVs with no commercial targets never need to scan playback history.
 if not exists(select 1 from public.vision_commercial_targets where device_id=p_device) then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_device::text,716));
 with touched as (
 select distinct l.media_id,(l.started_at at time zone 'America/Sao_Paulo')::date as day
 from public.playback_logs l join public.vision_commercial_revisions r on r.id=l.media_id
 where l.device_id=p_device
 ), totals as (
 select r.campaign_id,r.id revision_id,l.device_id,t.day,count(*) attempt_count,
 count(*) filter(where l.completed and l.ended_at>=l.started_at) completed_count,
 max(l.ended_at) filter(where l.completed and l.ended_at>=l.started_at) last_completed_at
 from touched t join public.playback_logs l on l.media_id=t.media_id and l.device_id=p_device and (l.started_at at time zone 'America/Sao_Paulo')::date=t.day
 join public.vision_commercial_revisions r on r.id=l.media_id
 join public.vision_commercial_targets target on target.campaign_id=r.campaign_id and target.device_id=l.device_id
 where l.started_at<=now()+interval '5 minutes' and (l.ended_at is null or l.ended_at<=now()+interval '5 minutes')
 group by r.campaign_id,r.id,l.device_id,t.day
 )
 insert into public.vision_commercial_daily(campaign_id,revision_id,device_id,day,attempt_count,completed_count,last_completed_at)
 select campaign_id,revision_id,device_id,day,attempt_count,completed_count,last_completed_at from totals
 on conflict(revision_id,device_id,day) do update set attempt_count=excluded.attempt_count,completed_count=excluded.completed_count,last_completed_at=excluded.last_completed_at,updated_at=now()
 where vision_commercial_daily.attempt_count is distinct from excluded.attempt_count or vision_commercial_daily.completed_count is distinct from excluded.completed_count or vision_commercial_daily.last_completed_at is distinct from excluded.last_completed_at;
end$$;
revoke all on function public.vision_commercial_refresh_daily(uuid) from public,anon,authenticated;
grant execute on function public.vision_commercial_refresh_daily(uuid) to service_role;

create function public.vision_commercial_manifest(p_device uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
 select r.*,c.start_date,c.end_date from public.vision_commercial_targets t
 join public.vision_commercial_campaigns c on c.id=t.campaign_id
 join public.vision_advertisers a on a.id=c.advertiser_id
 join public.vision_commercial_revisions r on r.id=c.current_revision_id
 where t.device_id=p_device and t.active and c.status='active' and a.status='active'
 and (now() at time zone 'America/Sao_Paulo')::date between c.start_date and c.end_date
 order by c.created_at,c.id limit 20
 ) x
$$;
revoke all on function public.vision_commercial_manifest(uuid) from public,anon,authenticated;
grant execute on function public.vision_commercial_manifest(uuid) to service_role;

-- One narrowly projected read API. Never returns device secrets, settings or company membership.
create function private.vision_portal_data(p_advertiser uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'advertiser',(select jsonb_build_object('id',id,'name',name,'email',email,'status',status) from public.vision_advertisers where id=p_advertiser),
 'server_time',now(), 'today',(now() at time zone 'America/Sao_Paulo')::date,
 'campaigns',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.vision_commercial_campaigns c where c.advertiser_id=p_advertiser),'[]'::jsonb),
 'revisions',coalesce((select jsonb_agg(to_jsonb(r)) from public.vision_commercial_revisions r join public.vision_commercial_campaigns c on c.id=r.campaign_id where c.advertiser_id=p_advertiser),'[]'::jsonb),
 'targets',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('online',coalesce(d.last_seen_at between now()-interval '90 seconds' and now()+interval '5 seconds',false) and d.retired_at is null,'last_seen_at',d.last_seen_at)) from public.vision_commercial_targets t join public.vision_commercial_campaigns c on c.id=t.campaign_id left join public.devices d on d.id=t.device_id where c.advertiser_id=p_advertiser),'[]'::jsonb),
 'daily',coalesce((select jsonb_agg(to_jsonb(s) order by s.day desc) from public.vision_commercial_daily s join public.vision_commercial_campaigns c on c.id=s.campaign_id where c.advertiser_id=p_advertiser),'[]'::jsonb)
 )
$$;
revoke all on function private.vision_portal_data(uuid) from public,anon,authenticated;
create function public.vision_advertiser_portal() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare aid uuid;begin
 aid:=private.vision_advertiser_id();if aid is null then raise exception 'advertiser_unavailable' using errcode='42501';end if;
 return private.vision_portal_data(aid);
end$$;
revoke all on function public.vision_advertiser_portal() from public,anon;
grant execute on function public.vision_advertiser_portal() to authenticated;
create function public.vision_commercial_master_report(p_actor uuid,p_advertiser uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform private.vision_require_master(p_actor);return private.vision_portal_data(p_advertiser);end$$;
revoke all on function public.vision_commercial_master_report(uuid,uuid) from public,anon,authenticated;
grant execute on function public.vision_commercial_master_report(uuid,uuid) to service_role;
create function public.vision_commercial_event_labels(p_device uuid,p_ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name)),'[]'::jsonb)
 from public.vision_commercial_revisions r join public.vision_commercial_targets t on t.campaign_id=r.campaign_id and t.device_id=p_device where r.id=any(p_ids)
$$;
revoke all on function public.vision_commercial_event_labels(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.vision_commercial_event_labels(uuid,uuid[]) to service_role;
create function public.vision_commercial_delivery(p_device uuid,p_status text) returns void language sql security definer set search_path='' as $$
 update public.vision_commercial_targets set delivery_status=p_status,delivery_checked_at=now() where device_id=p_device and active
$$;
revoke all on function public.vision_commercial_delivery(uuid,text) from public,anon,authenticated;
grant execute on function public.vision_commercial_delivery(uuid,text) to service_role;
commit;

   or snapshot_path=asset.storage_path
   or not exists(select 1 from storage.objects where bucket_id='vision-media' and name=snapshot_path)
 then raise exception 'commercial_snapshot_required';end if;
 insert into public.vision_commercial_revisions(campaign_id,source_media_id,source_storage_path,source_updated_at,name,media_type,storage_path,duration_seconds,size_bytes,checksum,width,height) values(cid,asset.id,asset.storage_path,asset.updated_at,asset.name,asset.media_type,snapshot_path,coalesce(asset.duration_seconds,10),asset.size_bytes,coalesce(asset.checksum_sha256,''),asset.width,asset.height) returning id into rid;
 snapshot_used:=true;
 update public.vision_commercial_campaigns set current_revision_id=rid where id=cid;
 end if;
 update public.vision_commercial_targets set active=false,delivery_status='pending_player_check',delivery_checked_at=null where campaign_id=cid;
 for target in select distinct value::uuid from jsonb_array_elements_text(p_data->'device_ids') loop
 if p_data->>'status'='active' and (select count(*) from public.vision_commercial_targets t join public.vision_commercial_campaigns c on c.id=t.campaign_id where t.device_id=target and t.active and c.id<>cid and c.status='active' and c.start_date<=(p_data->>'end_date')::date and c.end_date>=(p_data->>'start_date')::date)>=20 then raise exception 'commercial_device_capacity_20';end if;
 insert into public.vision_commercial_targets(campaign_id,device_id,point_name,device_name) select cid,d.id,c.name,d.name from public.devices d join public.companies c on c.id=d.company_id where d.id=target and d.retired_at is null
 on conflict(campaign_id,device_id) do update set active=true;
 get diagnostics n=row_count;if n=0 then raise exception 'device_unavailable';end if;
 end loop;
 return jsonb_build_object('id',cid,'snapshot_used',snapshot_used);
end$$;
revoke all on function public.vision_commercial_save_campaign(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.vision_commercial_save_campaign(uuid,jsonb) to service_role;

-- No trigger on playback_logs: consolidation failure cannot reject a normal playback batch.
-- Existing raw logs are not deleted. Reconcile every recorded commercial day for this TV,
-- so a rollup outage cannot silently discard older or delayed offline events. Idempotent.
create function public.vision_commercial_refresh_daily(p_device uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 -- TVs with no commercial targets never need to scan playback history.
 if not exists(select 1 from public.vision_commercial_targets where device_id=p_device) then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_device::text,716));
 with touched as (
 select distinct l.media_id,(l.started_at at time zone 'America/Sao_Paulo')::date as day
 from public.playback_logs l join public.vision_commercial_revisions r on r.id=l.media_id
 where l.device_id=p_device
 ), totals as (
 select r.campaign_id,r.id revision_id,l.device_id,t.day,count(*) attempt_count,
 count(*) filter(where l.completed and l.ended_at>=l.started_at) completed_count,
 max(l.ended_at) filter(where l.completed and l.ended_at>=l.started_at) last_completed_at
 from touched t join public.playback_logs l on l.media_id=t.media_id and l.device_id=p_device and (l.started_at at time zone 'America/Sao_Paulo')::date=t.day
 join public.vision_commercial_revisions r on r.id=l.media_id
 join public.vision_commercial_targets target on target.campaign_id=r.campaign_id and target.device_id=l.device_id
 where l.started_at<=now()+interval '5 minutes' and (l.ended_at is null or l.ended_at<=now()+interval '5 minutes')
 group by r.campaign_id,r.id,l.device_id,t.day
 )
 insert into public.vision_commercial_daily(campaign_id,revision_id,device_id,day,attempt_count,completed_count,last_completed_at)
 select campaign_id,revision_id,device_id,day,attempt_count,completed_count,last_completed_at from totals
 on conflict(revision_id,device_id,day) do update set attempt_count=excluded.attempt_count,completed_count=excluded.completed_count,last_completed_at=excluded.last_completed_at,updated_at=now()
 where vision_commercial_daily.attempt_count is distinct from excluded.attempt_count or vision_commercial_daily.completed_count is distinct from excluded.completed_count or vision_commercial_daily.last_completed_at is distinct from excluded.last_completed_at;
end$$;
revoke all on function public.vision_commercial_refresh_daily(uuid) from public,anon,authenticated;
grant execute on function public.vision_commercial_refresh_daily(uuid) to service_role;

create function public.vision_commercial_manifest(p_device uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
 select r.*,c.start_date,c.end_date from public.vision_commercial_targets t
 join public.vision_commercial_campaigns c on c.id=t.campaign_id
 join public.vision_advertisers a on a.id=c.advertiser_id
 join public.vision_commercial_revisions r on r.id=c.current_revision_id
 where t.device_id=p_device and t.active and c.status='active' and a.status='active'
 and (now() at time zone 'America/Sao_Paulo')::date between c.start_date and c.end_date
 order by c.created_at,c.id limit 20
 ) x
$$;
revoke all on function public.vision_commercial_manifest(uuid) from public,anon,authenticated;
grant execute on function public.vision_commercial_manifest(uuid) to service_role;

-- One narrowly projected read API. Never returns device secrets, settings or company membership.
create function private.vision_portal_data(p_advertiser uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'advertiser',(select jsonb_build_object('id',id,'name',name,'email',email,'status',status) from public.vision_advertisers where id=p_advertiser),
 'server_time',now(), 'today',(now() at time zone 'America/Sao_Paulo')::date,
 'campaigns',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.vision_commercial_campaigns c where c.advertiser_id=p_advertiser),'[]'::jsonb),
 'revisions',coalesce((select jsonb_agg(to_jsonb(r)) from public.vision_commercial_revisions r join public.vision_commercial_campaigns c on c.id=r.campaign_id where c.advertiser_id=p_advertiser),'[]'::jsonb),
 'targets',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('online',coalesce(d.last_seen_at between now()-interval '90 seconds' and now()+interval '5 seconds',false) and d.retired_at is null,'last_seen_at',d.last_seen_at)) from public.vision_commercial_targets t join public.vision_commercial_campaigns c on c.id=t.campaign_id left join public.devices d on d.id=t.device_id where c.advertiser_id=p_advertiser),'[]'::jsonb),
 'daily',coalesce((select jsonb_agg(to_jsonb(s) order by s.day desc) from public.vision_commercial_daily s join public.vision_commercial_campaigns c on c.id=s.campaign_id where c.advertiser_id=p_advertiser),'[]'::jsonb)
 )
$$;
revoke all on function private.vision_portal_data(uuid) from public,anon,authenticated;
create function public.vision_advertiser_portal() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare aid uuid;begin
 aid:=private.vision_advertiser_id();if aid is null then raise exception 'advertiser_unavailable' using errcode='42501';end if;
 return private.vision_portal_data(aid);
end$$;
revoke all on function public.vision_advertiser_portal() from public,anon;
grant execute on function public.vision_advertiser_portal() to authenticated;
create function public.vision_commercial_master_report(p_actor uuid,p_advertiser uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform private.vision_require_master(p_actor);return private.vision_portal_data(p_advertiser);end$$;
revoke all on function public.vision_commercial_master_report(uuid,uuid) from public,anon,authenticated;
grant execute on function public.vision_commercial_master_report(uuid,uuid) to service_role;
create function public.vision_commercial_event_labels(p_device uuid,p_ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name)),'[]'::jsonb)
 from public.vision_commercial_revisions r join public.vision_commercial_targets t on t.campaign_id=r.campaign_id and t.device_id=p_device where r.id=any(p_ids)
$$;
revoke all on function public.vision_commercial_event_labels(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.vision_commercial_event_labels(uuid,uuid[]) to service_role;
create function public.vision_commercial_delivery(p_device uuid,p_status text) returns void language sql security definer set search_path='' as $$
 update public.vision_commercial_targets set delivery_status=p_status,delivery_checked_at=now() where device_id=p_device and active
$$;
revoke all on function public.vision_commercial_delivery(uuid,text) from public,anon,authenticated;
grant execute on function public.vision_commercial_delivery(uuid,text) to service_role;
commit;
