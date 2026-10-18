-- VISION MÍDIA DIGITAL - STAGING COMMERCIAL SECURITY PATCH CANDIDATE
-- REVIEW-ONLY: do not run in production or the shared staging environment without specific authorization.
-- The canonical tested SQL body below matches tests/fixtures/commercial-safe-projection-lab.sql.
-- Scope: only authenticated column SELECT on vision_commercial_revisions and
-- private.vision_portal_data projection. No client TVs, players, playlists, Auth or Edge deployment.
-- Required before running: confirm Supabase project target jmiuitrrhtaeyrpuyohk
-- is approved for this commercial test while Vision Menu experiments are preserved;
-- then verify a backup/rollback plan and staged account isolation. Do not run automatically.

REVOKE SELECT ON TABLE public.vision_commercial_revisions FROM authenticated;
GRANT SELECT (
  id, campaign_id, name, media_type, storage_path,
  duration_seconds, size_bytes, width, height, created_at
) ON TABLE public.vision_commercial_revisions TO authenticated;

-- The SECURITY DEFINER portal requires its OWN explicit safe projection:
-- revoking SELECT from authenticated alone does not redact a definer RPC.
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
    WHERE c.advertiser_id=p_advertiser
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
    WHERE c.advertiser_id=p_advertiser
  ),'[]'::jsonb),
  'targets',COALESCE((
    SELECT jsonb_agg(to_jsonb(t) || jsonb_build_object(
      'online',COALESCE(
        d.last_seen_at BETWEEN now()-interval '90 seconds' AND now()+interval '5 seconds',
        false
      ) AND d.retired_at IS NULL,
      'last_seen_at',d.last_seen_at
    ))
    FROM public.vision_commercial_targets t
    JOIN public.vision_commercial_campaigns c ON c.id=t.campaign_id
    LEFT JOIN public.devices d ON d.id=t.device_id
    WHERE c.advertiser_id=p_advertiser
  ),'[]'::jsonb),
  'daily',COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.day DESC)
    FROM public.vision_commercial_daily s
    JOIN public.vision_commercial_campaigns c ON c.id=s.campaign_id
    WHERE c.advertiser_id=p_advertiser
  ),'[]'::jsonb)
 );
$$;

-- Restore only intended function grants, never expose the private helper.
REVOKE ALL ON FUNCTION private.vision_portal_data(uuid) FROM PUBLIC, anon, authenticated;
