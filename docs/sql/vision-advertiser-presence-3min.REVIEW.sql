-- REVIEW ONLY; DO NOT EXECUTE AUTOMATICALLY.
-- Captured from the current production definition of private.vision_portal_data(uuid).
-- Only two TV-presence predicates change from 90 seconds to 3 minutes.
-- The advertiser authorization boundary, SECURITY DEFINER signature,
-- allowed fields, company scope, playback counts, and commercial_on_screen
-- logic are otherwise unchanged. Validate against current live definition
-- and make a verified backup before creating a formal migration/deploy.
-- Adjusts portal status to the existing device-health-alerts offline policy.

CREATE OR REPLACE FUNCTION private.vision_portal_data(p_advertiser uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        d.last_seen_at BETWEEN now()-interval '3 minutes' AND now()+interval '5 seconds',
        false
      ) AND d.retired_at IS NULL,
      'last_seen_at',d.last_seen_at,
      'commercial_on_screen',COALESCE(
       exists(select 1 from public.vision_commercial_revisions active_rev where active_rev.id=c.current_revision_id and active_rev.source_media_id=d.current_media_id)
       AND d.last_seen_at BETWEEN now()-interval '3 minutes' AND now()+interval '5 seconds'
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
$function$;
