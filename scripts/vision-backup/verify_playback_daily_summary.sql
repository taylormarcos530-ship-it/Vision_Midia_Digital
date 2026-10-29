-- Read-only acceptance test for archived playback summary.
-- Expected: missing_groups=0 and mismatched_groups=0.
WITH source_groups AS (
  SELECT (started_at AT TIME ZONE 'UTC')::date AS play_date,
         company_id, device_id,
         coalesce(campaign_id::text,'') AS campaign_key,
         coalesce(media_id::text,'') AS media_key,
         count(*) AS started,
         count(*) FILTER (WHERE completed) AS completed,
         coalesce(sum(duration_seconds),0) AS total_seconds
  FROM public.playback_logs
  WHERE started_at < now()-interval '32 days'
  GROUP BY 1,2,3,4,5
)
SELECT count(*) AS groups_checked,
       count(*) FILTER (WHERE s.play_date IS NULL) AS missing_groups,
       count(*) FILTER (WHERE s.started IS DISTINCT FROM g.started
         OR s.completed IS DISTINCT FROM g.completed
         OR s.total_seconds IS DISTINCT FROM g.total_seconds) AS mismatched_groups
FROM source_groups g
LEFT JOIN public.playback_daily_summary s
 ON s.play_date=g.play_date AND s.company_id=g.company_id
 AND s.device_id=g.device_id AND s.campaign_key=g.campaign_key
 AND s.media_key=g.media_key;
