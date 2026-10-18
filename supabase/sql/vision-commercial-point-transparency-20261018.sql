-- Vision Commercial: consent-gated location and status for advertiser transparency.
-- Additive, no customer playlist, device command or playback changes.
CREATE TABLE IF NOT EXISTS public.vision_commercial_point_profile(
  device_id uuid PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
  public_label text CHECK (char_length(public_label)<=100),
  public_address text CHECK (char_length(public_address)<=220),
  neighborhood text CHECK (char_length(neighborhood)<=110),
  city text CHECK (char_length(city)<=110),
  share_location boolean NOT NULL DEFAULT false,
  consent_confirmed_at timestamptz,
  consent_confirmed_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_requires_consent CHECK (
    NOT share_location OR
    (consent_confirmed_at IS NOT NULL AND consent_confirmed_by IS NOT NULL
     AND nullif(trim(city),'') IS NOT NULL)
  )
);
ALTER TABLE public.vision_commercial_point_profile ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vision_commercial_point_profile FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.vision_commercial_point_profile TO service_role;
-- End-user access is granted only through advertiser-scoped SECURITY DEFINER projection.
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
REVOKE ALL ON FUNCTION private.vision_portal_data(uuid) FROM PUBLIC,anon,authenticated;
