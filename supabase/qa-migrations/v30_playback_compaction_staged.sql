-- VISION V30 — STAGED, DISABLED-BY-DEFAULT DAILY PLAYBACK COMPACTION.
-- Do not run this file on production until QA has proved hybrid totals,
-- commercials, offline replay, RLS and exports. No scheduler is created here.
-- No production records are modified by migration installation.

CREATE TABLE IF NOT EXISTS public.vision_playback_daily_archive_v30 (
  play_date date NOT NULL,
  company_id uuid NOT NULL,
  device_id uuid NOT NULL,
  campaign_key text NOT NULL,
  playlist_key text NOT NULL,
  media_key text NOT NULL,
  device_name text NOT NULL,
  campaign_name text NOT NULL,
  playlist_name text NOT NULL,
  media_name text NOT NULL,
  started bigint NOT NULL DEFAULT 0 CHECK (started >= 0),
  completed bigint NOT NULL DEFAULT 0 CHECK (completed >= 0 AND completed <= started),
  total_seconds numeric NOT NULL DEFAULT 0 CHECK (total_seconds >= 0),
  first_play timestamptz,
  last_play timestamptz,
  last_compacted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (play_date, company_id, device_id, campaign_key, playlist_key, media_key,
               device_name, campaign_name, playlist_name, media_name)
);
CREATE INDEX IF NOT EXISTS vision_playback_daily_archive_v30_company_day_idx
  ON public.vision_playback_daily_archive_v30 (company_id, play_date, device_id);
ALTER TABLE public.vision_playback_daily_archive_v30 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vision_playback_daily_archive_v30_select
  ON public.vision_playback_daily_archive_v30;
CREATE POLICY vision_playback_daily_archive_v30_select
  ON public.vision_playback_daily_archive_v30 FOR SELECT TO authenticated
  USING ((SELECT private.is_company_member(company_id)));
REVOKE ALL ON TABLE public.vision_playback_daily_archive_v30 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vision_playback_daily_archive_v30 TO authenticated;
GRANT ALL ON TABLE public.vision_playback_daily_archive_v30 TO service_role;

CREATE TABLE IF NOT EXISTS private.vision_playback_compaction_control_v30 (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  raw_days integer NOT NULL DEFAULT 7 CHECK (raw_days BETWEEN 7 AND 90),
  enabled boolean NOT NULL DEFAULT false,
  archive_verified_at timestamptz,
  reporting_verified_at timestamptz,
  offline_replay_verified_at timestamptz,
  dedupe_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.vision_playback_compaction_control_v30 (id,raw_days,enabled)
VALUES (1,7,false) ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON TABLE private.vision_playback_compaction_control_v30 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE private.vision_playback_compaction_control_v30 TO service_role;

-- Reads only. Preview before any future authorization of compaction.
CREATE OR REPLACE FUNCTION private.vision_playback_compaction_preview_v30(p_days integer DEFAULT 7)
RETURNS TABLE (eligible_rows bigint, oldest_event timestamptz, suspicious_future bigint,
               received_late bigint, current_history_bytes bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
SELECT count(*)::bigint, min(l.started_at),
 count(*) FILTER (WHERE l.started_at > l.created_at + interval '10 minutes')::bigint,
 count(*) FILTER (WHERE l.created_at > l.started_at + interval '7 days')::bigint,
 pg_total_relation_size('public.playback_logs'::regclass)
FROM public.playback_logs l
WHERE p_days BETWEEN 7 AND 90 AND l.created_at < now() - (p_days * interval '1 day');
$fn$;
REVOKE ALL ON FUNCTION private.vision_playback_compaction_preview_v30(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_compaction_preview_v30(integer) TO service_role;

-- NOT AUTOMATICALLY CALLED. A compacted row is removed and aggregated ATOMICALLY.
-- created_at (receipt time), not started_at (play time), controls 7-day retention;
-- late/offline plays therefore remain in raw for 7 days after being received.
-- Existing playback_logs INSERT trigger already updates vision_commercial_daily,
-- and it is not touched or recalculated here.
-- CRITICAL: an original event can be replayed after its raw unique index row
-- was deleted, so dedupe_verified_at MUST remain NULL until a durable
-- cross-compaction idempotency mechanism is implemented and actually tested.
-- No trigger or ledger is installed by this staging migration.
CREATE OR REPLACE FUNCTION private.vision_playback_compact_batch_v30(p_limit integer DEFAULT 250)
RETURNS TABLE (raw_removed bigint, groups_written bigint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE v_days integer; v_ok boolean;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 500';
  END IF;
  SELECT raw_days,
         enabled AND archive_verified_at IS NOT NULL
         AND reporting_verified_at IS NOT NULL AND offline_replay_verified_at IS NOT NULL
         AND dedupe_verified_at IS NOT NULL
    INTO v_days,v_ok
  FROM private.vision_playback_compaction_control_v30 WHERE id = 1;
  IF NOT COALESCE(v_ok,false) THEN
    RAISE EXCEPTION 'Vision compaction disabled: QA/backup/report/offline/dedupe approval missing';
  END IF;

  -- Reject clock-anomalous events: keep those available for investigation.
  -- Locks a small set so parallel workers cannot archive an event twice.
  WITH candidate AS MATERIALIZED (
    SELECT l.id
      FROM public.playback_logs l
     WHERE l.created_at < now() - (v_days * interval '1 day')
       AND l.started_at <= l.created_at + interval '10 minutes'
       AND l.started_at >= '2000-01-01'::timestamptz
     ORDER BY l.created_at, l.id LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), removed AS (
    DELETE FROM public.playback_logs l
    USING candidate c WHERE l.id = c.id
    RETURNING l.*
  ), grouped AS MATERIALIZED (
    SELECT (r.started_at AT TIME ZONE COALESCE(c.timezone,'America/Sao_Paulo'))::date AS play_date,
      r.company_id,r.device_id,COALESCE(r.campaign_id::text,'') AS campaign_key,
      COALESCE(r.playlist_id::text,'') AS playlist_key,
      COALESCE(r.media_id::text,'') AS media_key,
      COALESCE(NULLIF(r.device_name,''),d.name,'TV removida')::text AS device_name,
      COALESCE(NULLIF(r.campaign_name,''),a.name,CASE WHEN r.campaign_id IS NULL THEN 'Conteúdo padrão' ELSE 'Campanha removida' END)::text AS campaign_name,
      COALESCE(NULLIF(r.playlist_name,''),p.name,'Playlist removida')::text AS playlist_name,
      COALESCE(NULLIF(r.media_name,''),m.name,'Mídia removida')::text AS media_name,
      count(*)::bigint AS started,
      count(*) FILTER (WHERE r.completed)::bigint AS completed,
      COALESCE(sum(r.duration_seconds),0)::numeric AS total_seconds,
      min(r.started_at) AS first_play,max(r.started_at) AS last_play
    FROM removed r
    LEFT JOIN public.companies c ON c.id=r.company_id
    LEFT JOIN public.devices d ON d.id=r.device_id AND d.company_id=r.company_id
    LEFT JOIN public.campaigns a ON a.id=r.campaign_id AND a.company_id=r.company_id
    LEFT JOIN public.playlists p ON p.id=r.playlist_id AND p.company_id=r.company_id
    LEFT JOIN public.media_assets m ON m.id=r.media_id AND m.company_id=r.company_id
    GROUP BY 1,2,3,4,5,6,7,8,9,10
  ), applied AS (
    INSERT INTO public.vision_playback_daily_archive_v30 AS dest
      (play_date,company_id,device_id,campaign_key,playlist_key,media_key,
       device_name,campaign_name,playlist_name,media_name,
       started,completed,total_seconds,first_play,last_play)
    SELECT play_date,company_id,device_id,campaign_key,playlist_key,media_key,
       device_name,campaign_name,playlist_name,media_name,
       started,completed,total_seconds,first_play,last_play FROM grouped
    ON CONFLICT (play_date,company_id,device_id,campaign_key,playlist_key,media_key,
                 device_name,campaign_name,playlist_name,media_name)
    DO UPDATE SET started=dest.started+EXCLUDED.started,
      completed=dest.completed+EXCLUDED.completed,
      total_seconds=dest.total_seconds+EXCLUDED.total_seconds,
      first_play=LEAST(dest.first_play,EXCLUDED.first_play),
      last_play=GREATEST(dest.last_play,EXCLUDED.last_play),
      last_compacted_at=now()
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM removed),(SELECT count(*) FROM applied)
    INTO raw_removed,groups_written;
  RETURN NEXT;
END $fn$;
REVOKE ALL ON FUNCTION private.vision_playback_compact_batch_v30(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.vision_playback_compact_batch_v30(integer) TO service_role;

-- A fully parallel, opt-in RPC for the Master reports. No existing RPC is
-- replaced: the old panel remains unchanged until parity is confirmed.
CREATE OR REPLACE FUNCTION public.get_playback_report_compacted_v30(
  p_company_id uuid,p_start_date date,p_end_date date,
  p_campaign_id uuid DEFAULT NULL,p_device_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE v_tz text; v_from timestamptz; v_to timestamptz; v_result jsonb;
BEGIN
  IF p_company_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL OR
     p_end_date<p_start_date OR p_end_date-p_start_date>366 THEN
    RAISE EXCEPTION 'invalid report range';
  END IF;
  IF NOT COALESCE((SELECT private.is_company_member(p_company_id)),false) THEN
    RAISE EXCEPTION 'forbidden' USING errcode='42501';
  END IF;
  SELECT COALESCE(timezone,'America/Sao_Paulo') INTO v_tz FROM public.companies WHERE id=p_company_id;
  IF v_tz IS NULL THEN RAISE EXCEPTION 'company not found'; END IF;
  v_from := p_start_date::timestamp AT TIME ZONE v_tz;
  v_to := (p_end_date+1)::timestamp AT TIME ZONE v_tz;

  WITH events AS MATERIALIZED (
    SELECT l.device_id,l.campaign_id,l.media_id,l.playlist_id,
      COALESCE(NULLIF(l.device_name,''),d.name,'TV removida') AS device_name,
      COALESCE(NULLIF(l.campaign_name,''),c.name,CASE WHEN l.campaign_id IS NULL THEN 'Conteúdo padrão' ELSE 'Campanha removida' END) AS campaign_name,
      COALESCE(NULLIF(l.media_name,''),m.name,'Mídia removida') AS media_name,
      COALESCE(NULLIF(l.playlist_name,''),p.name,'Playlist removida') AS playlist_name,
      1::bigint started,CASE WHEN l.completed THEN 1 ELSE 0 END::bigint completed,
      COALESCE(l.duration_seconds,0)::numeric AS total_seconds,
      l.started_at first_play,l.started_at last_play
    FROM public.playback_logs l
    LEFT JOIN public.devices d ON d.id=l.device_id AND d.company_id=l.company_id
    LEFT JOIN public.campaigns c ON c.id=l.campaign_id AND c.company_id=l.company_id
    LEFT JOIN public.media_assets m ON m.id=l.media_id AND m.company_id=l.company_id
    LEFT JOIN public.playlists p ON p.id=l.playlist_id AND p.company_id=l.company_id
    WHERE l.company_id=p_company_id AND l.started_at>=v_from AND l.started_at<v_to
    AND (p_campaign_id IS NULL OR l.campaign_id=p_campaign_id)
    AND (p_device_id IS NULL OR l.device_id=p_device_id)
    UNION ALL
    SELECT a.device_id,NULLIF(a.campaign_key,'')::uuid,NULLIF(a.media_key,'')::uuid,NULLIF(a.playlist_key,'')::uuid,
      a.device_name,a.campaign_name,a.media_name,a.playlist_name,
      a.started,a.completed,a.total_seconds,a.first_play,a.last_play
    FROM public.vision_playback_daily_archive_v30 a
    WHERE a.company_id=p_company_id AND a.play_date BETWEEN p_start_date AND p_end_date
    AND (p_campaign_id IS NULL OR a.campaign_key=p_campaign_id::text)
    AND (p_device_id IS NULL OR a.device_id=p_device_id)
  ), summary AS (
    SELECT COALESCE(sum(started),0)::bigint AS started,
      COALESCE(sum(completed),0)::bigint AS completed,
      COALESCE(sum(total_seconds),0)::numeric AS total_seconds,
      count(DISTINCT device_id)::bigint AS devices,
      count(DISTINCT campaign_id) FILTER (WHERE campaign_id IS NOT NULL)::bigint AS campaigns,
      count(DISTINCT media_id) FILTER (WHERE media_id IS NOT NULL)::bigint AS media,
      min(first_play) first_play,max(last_play) last_play FROM events
  ), campaigns AS (
    SELECT campaign_id,campaign_name,sum(started)::bigint started,sum(completed)::bigint completed,
    sum(total_seconds)::numeric total_seconds,count(DISTINCT device_id)::bigint devices,
    count(DISTINCT media_id) FILTER (WHERE media_id IS NOT NULL)::bigint media,
    min(first_play) first_play,max(last_play) last_play FROM events GROUP BY campaign_id,campaign_name
  ), devices AS (
    SELECT device_id,device_name,sum(started)::bigint started,sum(completed)::bigint completed,
    sum(total_seconds)::numeric total_seconds,
    count(DISTINCT campaign_id) FILTER (WHERE campaign_id IS NOT NULL)::bigint campaigns,
    count(DISTINCT media_id) FILTER (WHERE media_id IS NOT NULL)::bigint media,
    min(first_play) first_play,max(last_play) last_play FROM events GROUP BY device_id,device_name
  ), media AS (
    SELECT media_id,media_name,sum(started)::bigint started,sum(completed)::bigint completed,
    sum(total_seconds)::numeric total_seconds,
    count(DISTINCT device_id)::bigint devices,
    count(DISTINCT campaign_id) FILTER (WHERE campaign_id IS NOT NULL)::bigint campaigns,
    min(first_play) first_play,max(last_play) last_play FROM events GROUP BY media_id,media_name
  ), recent_events AS (
    SELECT l.id,l.client_event_id,l.device_id,l.campaign_id,l.playlist_id,l.media_id,
      COALESCE(NULLIF(l.device_name,''),d.name,'TV removida') AS device_name,
      COALESCE(NULLIF(l.campaign_name,''),c.name,CASE WHEN l.campaign_id IS NULL THEN 'Conteúdo padrão' ELSE 'Campanha removida' END) AS campaign_name,
      COALESCE(NULLIF(l.playlist_name,''),p.name,'Playlist removida') AS playlist_name,
      COALESCE(NULLIF(l.media_name,''),m.name,'Mídia removida') AS media_name,
      l.started_at,l.ended_at,l.duration_seconds,l.completed
    FROM public.playback_logs l
    LEFT JOIN public.devices d ON d.id=l.device_id AND d.company_id=l.company_id
    LEFT JOIN public.campaigns c ON c.id=l.campaign_id AND c.company_id=l.company_id
    LEFT JOIN public.media_assets m ON m.id=l.media_id AND m.company_id=l.company_id
    LEFT JOIN public.playlists p ON p.id=l.playlist_id AND p.company_id=l.company_id
    WHERE l.company_id=p_company_id AND l.started_at>=v_from AND l.started_at<v_to
      AND (p_campaign_id IS NULL OR l.campaign_id=p_campaign_id)
      AND (p_device_id IS NULL OR l.device_id=p_device_id)
    ORDER BY l.started_at DESC LIMIT 250
  )
  SELECT jsonb_build_object(
   'timezone',v_tz,'start_date',p_start_date,'end_date',p_end_date,
   'summary',(SELECT jsonb_build_object('started',s.started,'completed',s.completed,
      'completion_rate',CASE WHEN s.started=0 THEN 0 ELSE round(s.completed::numeric*100/s.started,2) END,
      'total_seconds',s.total_seconds,'devices',s.devices,'campaigns',s.campaigns,'media',s.media,
      'first_play',s.first_play,'last_play',s.last_play) FROM summary s),
   'campaigns',COALESCE((SELECT jsonb_agg(jsonb_build_object('campaign_id',c.campaign_id,'campaign_name',c.campaign_name,
      'started',c.started,'completed',c.completed,'completion_rate',CASE WHEN c.started=0 THEN 0 ELSE round(c.completed::numeric*100/c.started,2) END,
      'total_seconds',c.total_seconds,'devices',c.devices,'media',c.media,'first_play',c.first_play,'last_play',c.last_play)
      ORDER BY c.started DESC,c.campaign_name) FROM campaigns c),'[]'::jsonb),
   'devices',COALESCE((SELECT jsonb_agg(jsonb_build_object('device_id',d.device_id,'device_name',d.device_name,
      'started',d.started,'completed',d.completed,'completion_rate',CASE WHEN d.started=0 THEN 0 ELSE round(d.completed::numeric*100/d.started,2) END,
      'total_seconds',d.total_seconds,'campaigns',d.campaigns,'media',d.media,'first_play',d.first_play,'last_play',d.last_play)
      ORDER BY d.started DESC,d.device_name) FROM devices d),'[]'::jsonb),
   'media',COALESCE((SELECT jsonb_agg(jsonb_build_object('media_id',m.media_id,'media_name',m.media_name,
      'started',m.started,'completed',m.completed,'completion_rate',CASE WHEN m.started=0 THEN 0 ELSE round(m.completed::numeric*100/m.started,2) END,
      'total_seconds',m.total_seconds,'devices',m.devices,'campaigns',m.campaigns,'first_play',m.first_play,'last_play',m.last_play)
      ORDER BY m.started DESC,m.media_name) FROM media m),'[]'::jsonb),
   'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'client_event_id',e.client_event_id,
      'device_id',e.device_id,'device_name',e.device_name,'campaign_id',e.campaign_id,'campaign_name',e.campaign_name,
      'playlist_id',e.playlist_id,'playlist_name',e.playlist_name,'media_id',e.media_id,'media_name',e.media_name,
      'started_at',e.started_at,'ended_at',e.ended_at,'duration_seconds',e.duration_seconds,'completed',e.completed)
      ORDER BY e.started_at DESC) FROM recent_events e),'[]'::jsonb),
   'archive_detail', 'Aggregated daily counts; individual events are kept only during raw retention.'
  ) INTO v_result;
  RETURN v_result;
END $fn$;
REVOKE ALL ON FUNCTION public.get_playback_report_compacted_v30(uuid,date,date,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_playback_report_compacted_v30(uuid,date,date,uuid,uuid) TO authenticated;

-- NO CALL to compact_batch; NO policy enable; NO cron; NO raw record deletion.