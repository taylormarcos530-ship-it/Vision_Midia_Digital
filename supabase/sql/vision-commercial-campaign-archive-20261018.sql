-- Archive-only commercial controls. Never delete media, playlists, logs or receipts.
alter table public.vision_commercial_campaigns add column if not exists archived_at timestamptz;
create index if not exists commercial_campaign_archived_idx on public.vision_commercial_campaigns(advertiser_id,archived_at);

-- Do not allow an archived campaign to be edited or silently reactivated.
create function private.vision_commercial_archive_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.archived_at is not null and new.archived_at is not null then raise exception 'archived_campaign_locked';end if;
 if old.archived_at is not null and new.archived_at is null and new.status<>'draft' then raise exception 'restore_to_draft_only';end if;
 if old.archived_at is null and new.archived_at is not null and new.status<>'paused' then raise exception 'archive_must_pause';end if;
 return new;
end$$;
revoke all on function private.vision_commercial_archive_guard() from public,anon,authenticated;
create trigger vision_campaign_archive_guard before update on public.vision_commercial_campaigns
 for each row execute function private.vision_commercial_archive_guard();

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

-- Hide archived campaigns in advertiser-scoped RPC; underlying evidence is retained.
CREATE OR REPLACE FUNCTION private.vision_portal_data(p_advertiser uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'advertiser',(
    SELECT jsonb_build_object('id',a.id,'name',a.name,'email',a.email,'status',a.status)
    FROM public.vision_advertisers a WHERE a.id=p_advertiser
  ),
  'server_time',now(),
  'today',(now() AT TIME ZONE 'America/Sao_Paulo')::date,
  'campaigns',COALESCE((
    SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC)
    FROM public.vision_commercial_campaigns c
    WHERE c.advertiser_id=p_advertiser AND c.archived_at IS NULL
  ),'[]'::jsonb),
  'revisions',COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
     'id',r.id,
     'campaign_id',r.campaign_id,
     'name',r.name,
     'media_type',r.media_type,
     'storage_path',r.storage_path,
     'duration_seconds',r.duration_seconds,
     'size_bytes',r.size_bytes,
     'width',r.width,
     'height',r.height,
     'created_at',r.created_at
    ) ORDER BY r.created_at)
    FROM public.vision_commercial_revisions r
    JOIN public.vision_commercial_campaigns c ON c.id=r.campaign_id
    WHERE c.advertiser_id=p_advertiser AND c.archived_at IS NULL
  ),'[]'::jsonb),
  'targets',COALESCE((
    SELECT jsonb_agg(to_jsonb(t) || jsonb_build_object(
      'online',COALESCE(
        d.last_seen_at BETWEEN now()-interval '90 seconds' AND now()+interval '5 seconds',
        false
      ) AND d.retired_at IS NULL,
      'last_seen_at',d.last_seen_at,
      'commercial_on_screen',COALESCE(
       d.current_media_id=c.current_revision_id
       AND d.last_seen_at BETWEEN now()-interval '90 seconds' AND now()+interval '5 seconds'
       AND d.retired_at IS NULL,false
      ),
      'public_location',CASE
       WHEN profile.share_location AND profile.consent_confirmed_at IS NOT NULL
       THEN jsonb_build_object(
         'label',profile.public_label,'address',profile.public_address,
         'neighborhood',profile.neighborhood,'city',profile.city)
       ELSE NULL END,
      'location_authorized',COALESCE(profile.share_location AND profile.consent_confirmed_at IS NOT NULL,false)
    ))
    FROM public.vision_commercial_targets t
    JOIN public.vision_commercial_campaigns c ON c.id=t.campaign_id
    LEFT JOIN public.devices d ON d.id=t.device_id
    LEFT JOIN public.vision_commercial_point_profile profile ON profile.device_id=d.id
    WHERE c.advertiser_id=p_advertiser AND c.archived_at IS NULL
  ),'[]'::jsonb),
  'daily',COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.day DESC)
    FROM public.vision_commercial_daily s
    JOIN public.vision_commercial_campaigns c ON c.id=s.campaign_id
    WHERE c.advertiser_id=p_advertiser AND c.archived_at IS NULL
  ),'[]'::jsonb)
 );
$$;
revoke all on function private.vision_portal_data(uuid) from public,anon,authenticated;
