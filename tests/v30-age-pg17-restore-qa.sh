#!/usr/bin/env bash
set -euo pipefail
# Real age encryption and PG17 restore, but ONLY fake data in disposable CI.
[[ "$PGHOST" == '127.0.0.1' ]] || { echo 'REFUSE remote source'; exit 81; }
[[ "$PGDATABASE" == 'vision_v30_age_ci' ]] || { echo 'REFUSE non-QA source'; exit 82; }
[[ "$PGUSER" == 'postgres' ]] || { echo 'REFUSE unexpected DB user'; exit 83; }
umask 077
work="$(mktemp -d -p /tmp v30-age-qa.XXXXXXXX)"
trap 'rm -rf -- "$work"' EXIT
age-keygen -o "$work/temporary-private.key" >/dev/null 2>&1
recipient="$(age-keygen -y "$work/temporary-private.key")"
[[ "$recipient" == age1* ]]
docker run --rm --network host -e PGPASSWORD="$PGPASSWORD" postgres:17 \
  pg_dump -h 127.0.0.1 -U postgres -d vision_v30_age_ci \
  --format=custom --no-owner --no-acl > "$work/synthetic.dump"
test -s "$work/synthetic.dump"
source_sum="$(sha256sum "$work/synthetic.dump" | cut -d' ' -f1)"
age -r "$recipient" -o "$work/synthetic.dump.age" "$work/synthetic.dump"
test -s "$work/synthetic.dump.age"
encrypted_sum="$(sha256sum "$work/synthetic.dump.age" | cut -d' ' -f1)"
age -d -i "$work/temporary-private.key" -o "$work/recovered.dump" "$work/synthetic.dump.age"
test "$source_sum" = "$(sha256sum "$work/recovered.dump" | cut -d' ' -f1)"
echo "PASS_AGE_CIPHER_SHA256 encrypted=$encrypted_sum plaintext_matches=yes"
age-keygen -o "$work/WRONG-private.key" >/dev/null 2>&1
if age -d -i "$work/WRONG-private.key" -o "$work/should-not-decrypt" "$work/synthetic.dump.age" >/dev/null 2>&1; then
  echo 'FAIL wrong-key unexpectedly decrypted'; exit 84
fi
echo "PASS_AGE_WRONG_KEY rejected"
cp "$work/synthetic.dump.age" "$work/truncated.age"
truncate -s -1 "$work/truncated.age"
if age -d -i "$work/temporary-private.key" -o "$work/should-not-authenticate" "$work/truncated.age" >/dev/null 2>&1; then
  echo 'FAIL truncated authenticated'; exit 85
fi
echo "PASS_AGE_TRUNCATED_CIPHER rejected"
psql -X -v ON_ERROR_STOP=1 -d postgres -c 'CREATE DATABASE vision_v30_age_restored_ci'
docker run --rm --network host -i -e PGPASSWORD="$PGPASSWORD" postgres:17 \
  pg_restore -h 127.0.0.1 -U postgres -d vision_v30_age_restored_ci \
  --exit-on-error --no-owner --no-acl < "$work/recovered.dump"
q_ledger="SELECT count(*)::text||':'||coalesce(sum(fingerprint_count),0)::text||':'||
coalesce(md5(string_agg(fingerprints,''::bytea ORDER BY device_id,shard,segment_no)),'')
FROM private.vision_playback_seen_segments_v30"
q_archive="SELECT count(*)::text||':'||coalesce(sum(started),0)::text||':'||
coalesce(sum(completed),0)::text
FROM public.vision_playback_daily_archive_v30"
q_raw="SELECT count(*) FROM public.playback_logs"
function query() { psql -X -v ON_ERROR_STOP=1 -d "$1" -Atqc "$2"; }
for query_name in ledger archive raw; do
  case "$query_name" in
    ledger) q="$q_ledger";;
    archive) q="$q_archive";;
    raw) q="$q_raw";;
  esac
  before="$(query vision_v30_age_ci "$q")"
  after="$(query vision_v30_age_restored_ci "$q")"
  [[ "$before" == "$after" ]] || { echo "FAIL_RESTORE_$query_name before=$before after=$after"; exit 86; }
  echo "PASS_RESTORE_$query_name $after"
done
[[ "$(query vision_v30_age_restored_ci \
 "SELECT enabled::text FROM private.vision_playback_compaction_control_v30 WHERE id=1")" == false ]] \
  || { echo 'FAIL restored compaction not stopped'; exit 87; }
accepted="$(query vision_v30_age_restored_ci "
 WITH attempted AS (
   INSERT INTO public.playback_logs(client_event_id,company_id,device_id,started_at,completed)
   VALUES('old-2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '10000000-0000-4000-8000-000000000001',now()-interval '500 days',true)
   ON CONFLICT(device_id,client_event_id) DO NOTHING RETURNING 1
 ) SELECT count(*) FROM attempted")"
[[ "$accepted" == 0 ]] || { echo "FAIL_REPLAY_AFTER_RESTORE count=$accepted"; exit 88; }
echo "PASS_RESTORE_REPLAY duplicate_rejected=true compaction_disabled=true"
echo "PASS_AGE_BACKUP_RESTORE bytes=$(wc -c < "$work/synthetic.dump.age")"
