-- Archive-only commercial controls. Never delete media, playlists, logs or receipts.
alter table public.vision_commercial_campaigns add column if not exists archived_at timestamptz;
create index if not exists commercial_campaign_archived_idx on public.vision_commercial_campaigns(advertiser_id,archived_at);

create function public.vision_commercial_archive_campaign(p_actor uuid,p_campaign uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 perform private.vision_require_master(p_actor);
 select id into cid from public.vision_commercial_campaigns where id=p_campaign and archived_at is null for update;
 if not found then raise exception 'campaign_not_available';end if;
 update public.vision_commercial_campaigns set status='paused',archived_at=now(),updated_at=now() where id=cid;
 update public.vision_commercial_targets set active=false,delivery_status='pending_player_check',delivery_checked_at=null where campaign_id=cid;
 return jsonb_build_object('ok',true,'archived',true,'id',cid);
end$$;
revoke all on function public.vision_commercial_archive_campaign(uuid,uuid) from public,anon,authenticated;
grant execute on function public.vision_commercial_archive_campaign(uuid,uuid) to service_role;

create function public.vision_commercial_restore_campaign(p_actor uuid,p_campaign uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 perform private.vision_require_master(p_actor);
 select id into cid from public.vision_commercial_campaigns where id=p_campaign and archived_at is not null for update;
 if not found then raise exception 'campaign_not_archived';end if;
 update public.vision_commercial_campaigns set status='draft',archived_at=null,updated_at=now() where id=cid;
 -- Existing targets remain disabled. Master must save again with explicit TV selection.
 return jsonb_build_object('ok',true,'restored',true,'status','draft','id',cid);
end$$;
revoke all on function public.vision_commercial_restore_campaign(uuid,uuid) from public,anon,authenticated;
grant execute on function public.vision_commercial_restore_campaign(uuid,uuid) to service_role;
