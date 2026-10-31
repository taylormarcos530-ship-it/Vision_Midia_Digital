#!/usr/bin/env bash
set -euo pipefail
# Disposable GitHub Actions PostgreSQL only, never production.
[[ "$PGDATABASE" == "vision_v30_packed_ci" ]] || { echo 'REFUSING non-QA database'; exit 32; }
psql -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,created_at,completed)
VALUES('concurrent-race','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',now()-interval '12 days',now()-interval '10 days',true);
CREATE OR REPLACE FUNCTION private.qa_pause_delete_v30() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.client_event_id='concurrent-race' THEN PERFORM pg_sleep(2); END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER qa_pause_delete_v30 BEFORE DELETE ON public.playback_logs
FOR EACH ROW EXECUTE FUNCTION private.qa_pause_delete_v30();
SQL
psql -v ON_ERROR_STOP=1 -Atqc 'SELECT raw_removed FROM private.vision_playback_compact_batch_v30(250)' >/tmp/v30_packed_race_compact.txt 2>&1 &
archiver=$!
sleep 0.5
attempt=$(psql -v ON_ERROR_STOP=1 -Atqc "WITH inserted AS (INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,created_at,completed) VALUES('concurrent-race','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001',now()-interval '12 days',now(),true) ON CONFLICT DO NOTHING RETURNING 1) SELECT count(*) FROM inserted")
wait "$archiver"
archived=$(tr -d '[:space:]' </tmp/v30_packed_race_compact.txt)
[[ "$archived" == '1' ]] || { echo "FAIL archive: $archived"; exit 1; }
[[ "$attempt" == '0' ]] || { echo "FAIL raced replay was accepted: $attempt"; exit 1; }
raw=$(psql -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public.playback_logs WHERE client_event_id='concurrent-race'")
[[ "$raw" == '0' ]] || { echo "FAIL duplicate persisted: $raw"; exit 1; }
seen=$(psql -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM private.vision_playback_seen_packed_v30 WHERE device_id='10000000-0000-4000-8000-000000000001' AND shard=get_byte(private.vision_playback_fingerprint_bytes_v30('10000000-0000-4000-8000-000000000001','concurrent-race'),0) AND private.vision_playback_packed_contains_v30(fingerprints,private.vision_playback_fingerprint_bytes_v30('10000000-0000-4000-8000-000000000001','concurrent-race'))")
[[ "$seen" == '1' ]] || { echo "FAIL ledger count: $seen"; exit 1; }
psql -v ON_ERROR_STOP=1 -c 'DROP TRIGGER qa_pause_delete_v30 ON public.playback_logs'
echo 'PASS packed concurrent race: 1 archive, 0 replays, 1 retained fingerprint'
