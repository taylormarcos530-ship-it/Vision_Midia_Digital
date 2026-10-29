-- Read-only retention safety gate: never delete without independently verified backup.
-- Late arrivals are real; created_at can be much later than started_at.
-- A safe compactor must use an ingestion watermark, idempotent event IDs,
-- and a report that reads both raw and local-day aggregates.
SELECT
 count(*) AS eligible_by_play_date,
 count(*) FILTER (WHERE created_at >= now()-interval '7 days') AS recently_ingested,
 count(*) FILTER (WHERE created_at >= now()-interval '32 days') AS ingested_within_retention,
 min(created_at) AS earliest_ingest,
 max(created_at) AS latest_ingest
FROM public.playback_logs
WHERE campaign_id IS NULL
 AND started_at < now()-interval '32 days';
-- STOP if recently_ingested > 0. No DELETE or UPDATE is present.
