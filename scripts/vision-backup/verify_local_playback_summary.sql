-- Read-only local-day archive integrity check, for review before any retention.
-- Compare every internal summary group to the original event log in the company timezone.
WITH original AS (
 SELECT (l.started_at AT TIME ZONE coalesce(c.timezone,'America/Sao_Paulo'))::date AS play_date,
 l.company_id,l.device_id,coalesce(l.media_id::text,'') AS media_key,
 count(*) AS started,count(*) FILTER (WHERE l.completed) AS completed,
 coalesce(sum(l.duration_seconds),0) AS total_seconds
 FROM public.playback_logs l JOIN public.companies c ON c.id=l.company_id
 WHERE l.campaign_id IS NULL AND l.started_at < now()-interval '32 days'
 GROUP BY 1,2,3,4
)
SELECT count(*) AS groups_checked,
 count(*) FILTER (WHERE s.play_date IS NULL) AS missing_groups,
 count(*) FILTER (WHERE s.started IS DISTINCT FROM o.started
 OR s.completed IS DISTINCT FROM o.completed
 OR s.total_seconds IS DISTINCT FROM o.total_seconds) AS mismatched_groups
FROM original o LEFT JOIN public.playback_daily_summary_local s
 ON s.play_date=o.play_date AND s.company_id=o.company_id
 AND s.device_id=o.device_id AND s.campaign_key='' AND s.media_key=o.media_key;
