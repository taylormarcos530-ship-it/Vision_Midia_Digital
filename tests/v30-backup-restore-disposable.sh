#!/usr/bin/env bash
set -euo pipefail
# GitHub Actions disposable PostgreSQL 17 only. No database/network from Vision.
[[ "$PGDATABASE" == "vision_v30_scale_ci" ]] || { echo "REFUSE non-QA source database"; exit 37; }
[[ "$PGHOST" == "localhost" ]] || { echo "REFUSE remote database host"; exit 38; }
umask 077
DUMP=/tmp/vision_v30_synthetic_backup.dump
HASH=/tmp/vision_v30_synthetic_backup.sha256
# Use pg_dump/pg_restore *from postgres:17 container*: default Ubuntu client may be v16.
docker run --rm --network host -e PGPASSWORD="$PGPASSWORD" postgres:17 \
  pg_dump -h 127.0.0.1 -U postgres -d vision_v30_scale_ci \
  --format=custom --no-owner --no-acl > "$DUMP"
test -s "$DUMP"
sha256sum "$DUMP" > "$HASH"
sha256sum -c "$HASH"
psql -v ON_ERROR_STOP=1 -d postgres -c 'CREATE DATABASE vision_v30_scale_restored_ci'
docker run --rm --network host -i -e PGPASSWORD="$PGPASSWORD" postgres:17 \
  pg_restore -h 127.0.0.1 -U postgres -d vision_v30_scale_restored_ci \
  --exit-on-error --no-owner --no-acl < "$DUMP"

# Exact membership and counter consistency across both isolated databases.
q="SELECT count(*)::text||':'||coalesce(sum(octet_length(fingerprints)/16),0)::text||':'||
coalesce(md5(string_agg(fingerprints,''::bytea ORDER BY device_id,shard)),'') FROM private.vision_playback_seen_packed_v30"
source_ledger=$(psql -v ON_ERROR_STOP=1 -d vision_v30_scale_ci -Atqc "$q")
restored_ledger=$(psql -v ON_ERROR_STOP=1 -d vision_v30_scale_restored_ci -Atqc "$q")
[[ "$source_ledger" == "$restored_ledger" ]] || {
  echo 'FAIL restored ledger digest differs from backup'; exit 40;
}
source_summary=$(psql -v ON_ERROR_STOP=1 -d vision_v30_scale_ci -Atqc \
 "SELECT count(*)::text||':'||coalesce(sum(started),0)::text||':'||coalesce(sum(completed),0)::text FROM public.vision_playback_daily_archive_v30")
restored_summary=$(psql -v ON_ERROR_STOP=1 -d vision_v30_scale_restored_ci -Atqc \
 "SELECT count(*)::text||':'||coalesce(sum(started),0)::text||':'||coalesce(sum(completed),0)::text FROM public.vision_playback_daily_archive_v30")
[[ "$source_summary" == "$restored_summary" ]] || {
  echo 'FAIL restored daily summary differs'; exit 41;
}
raw_source=$(psql -v ON_ERROR_STOP=1 -d vision_v30_scale_ci -Atqc 'SELECT count(*) FROM public.playback_logs')
raw_restored=$(psql -v ON_ERROR_STOP=1 -d vision_v30_scale_restored_ci -Atqc 'SELECT count(*) FROM public.playback_logs')
[[ "$raw_source" == "$raw_restored" ]] || {
  echo 'FAIL restored raw rows differ'; exit 42;
}

# After restore, an archived replay must still be rejected.
attempt=$(psql -v ON_ERROR_STOP=1 -d vision_v30_scale_restored_ci -Atqc "
WITH attempted AS (
 INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
 VALUES('scale-123','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'ffffffff-ffff-4fff-8fff-ffffffffffff',now()-interval '900 days',true)
 ON CONFLICT DO NOTHING RETURNING 1)
SELECT count(*) FROM attempted")
[[ "$attempt" == "0" ]] || { echo 'FAIL restored replay accepted'; exit 43; }
echo "PASS_BACKUP_RESTORE sha256=$(cut -d' ' -f1 "$HASH") bytes=$(wc -c < "$DUMP")"
echo "PASS_LEDGER_RESTORE $source_ledger"
echo "PASS_REPORT_SUMMARY_RESTORE $source_summary"
echo "PASS_RAW_RESTORE $raw_source; restored replay refused"
# The dump is synthetic: never upload it or retain as a production backup.
rm -f "$DUMP" "$HASH"
