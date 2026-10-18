-- Independent, Master-only commercial creatives. Does not touch customer media or playlists.
-- Approved commercial layer; delivery gateway remains hard-disabled until physical pilot.
create table public.vision_commercial_sources (
 id uuid primary key,
 name text not null check(length(trim(name)) between 2 and 140),
 storage_path text not null unique check(storage_path ~ '^commercial-source/[a-f0-9-]{36}[.](png|jpg|jpeg|webp|mp4|webm)$'),
 media_type text not null check(media_type in ('image','video')),
 duration_seconds numeric not null check(duration_seconds>0 and duration_seconds<=120),
 size_bytes bigint not null check(size_bytes>0 and size_bytes<=26214400),
 checksum_sha256 text not null,
 width int,
 height int,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.vision_commercial_sources enable row level security;
revoke all on public.vision_commercial_sources from public,anon,authenticated;
grant select,insert on public.vision_commercial_sources to service_role;
-- Revisions remain immutable. Source creatives likewise cannot be modified after use.
create trigger commercial_source_immutable before update or delete on public.vision_commercial_sources
  for each row execute function private.vision_revision_immutable();
CREATE OR REPLACE FUNCTION public.vision_commercial_save_campaign(p_actor uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid; aid uuid; rid uuid; asset record; prev public.vision_commercial_revisions; target uuid; n int; snapshot_path text; snapshot_used boolean:=false;
begin
 perform private.vision_require_master(p_actor);
 perform pg_catalog.pg_advisory_xact_lock(7162026); -- Serialize commercial saves, never operational playlists.
 aid:=(p_data->>'advertiser_id')::uuid;cid:=nullif(p_data->>'id','')::uuid;
 if not exists(select 1 from public.vision_advertisers where id=aid and archived_at is null) then raise exception 'advertiser_not_found'; end if;
 if jsonb_typeof(p_data->'device_ids') is distinct from 'array' or jsonb_array_length(p_data->'device_ids') not between 1 and 100 then raise exception 'select_1_to_100_devices';end if;
 if cid is null then
 insert into public.vision_commercial_campaigns(advertiser_id,name,start_date,end_date,status) values(aid,trim(p_data->>'name'),(p_data->>'start_date')::date,(p_data->>'end_date')::date,coalesce(p_data->>'status','draft')) returning id into cid;
 else
 perform 1 from public.vision_commercial_campaigns where id=cid and advertiser_id=aid for update;
 if not found then raise exception 'campaign_not_found';end if;
 update public.vision_commercial_campaigns set name=trim(p_data->>'name'),start_date=(p_data->>'start_date')::date,end_date=(p_data->>'end_date')::date,status=coalesce(p_data->>'status','draft'),updated_at=now() where id=cid;
 end if;
 if nullif(p_data->>'commercial_source_id','') is not null then
  select id,storage_path,updated_at,name,media_type,duration_seconds,size_bytes,
         checksum_sha256,width,height,'ready'::text as processing_status into asset
  from public.vision_commercial_sources
  where id=(p_data->>'commercial_source_id')::uuid;
 else
  select * into asset from public.media_assets
  where id=(p_data->>'media_id')::uuid and processing_status='ready'
        and media_type in ('image','video') and storage_path is not null;
 end if;
 if not found then raise exception 'ready_image_or_video_required';end if;
 select r.* into prev from public.vision_commercial_revisions r join public.vision_commercial_campaigns c on c.current_revision_id=r.id where c.id=cid;
 if prev.id is null or prev.source_media_id<>asset.id or prev.checksum<>coalesce(asset.checksum_sha256,'') or prev.source_storage_path<>asset.storage_path or prev.source_updated_at is distinct from asset.updated_at then
 snapshot_path:=nullif(p_data->>'commercial_copy_path','');
 -- The commercial revision must point to its own immutable, already copied Storage object.
 -- No operational media is moved, overwritten, locked or deleted.
 if snapshot_path is null or snapshot_path !~ '^commercial-ads/[a-f0-9-]{36}([.][a-z0-9]{2,5})?$'
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
