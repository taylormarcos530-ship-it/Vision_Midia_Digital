-- Vision read-only pre-retention acceptance checks.
-- No data modifications. UTC summary and Sao Paulo report day boundaries differ.
-- Run before considering any deletion; zero mismatches required.
WITH original AS (
 SELECT (started_at AT TIME ZONE 'UTC')::date AS play_date,
        company_id,device_id,coalesce(campaign_id::text,'') AS campaign_key,
        coalesce(media_id::text,'') AS media_key,
        count(*) AS started,count(*) FILTER (WHERE completed) AS completed,
        coalesce(sum(duration_seconds),0) AS total_seconds
 FROM public.playback_logs
 WHERE campaign_id IS NULL AND started_at < now()-interval '32 days'
 GROUP BY 1,2,3,4,5
), checked AS (
 SELECT o.*,s.started AS summary_started,s.completed AS summary_completed,
        s.total_seconds AS summary_seconds
 FROM original o LEFT JOIN public.playback_daily_summary s
 USING (play_date,company_id,device_id,campaign_key,media_key)
)
SELECT count(*) AS groups_checked,
 count(*) FILTER (WHERE summary_started IS NULL) AS missing,
 count(*) FILTER (WHERE started IS DISTINCT FROM summary_started
  OR completed IS DISTINCT FROM summary_completed
  OR total_seconds IS DISTINCT FROM summary_seconds) AS mismatches
FROM checked;
