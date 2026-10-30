#!/usr/bin/env bash
set -euo pipefail
# GitHub Actions ephemeral PostgreSQL only. Never run against production/shared databases.
if [[ "$(id -un)" != postgres ]]; then echo "Run as local postgres OS user" >&2; exit 1; fi
db="$(psql -XAtqc 'SELECT current_database()')"
if [[ "$db" != postgres ]]; then echo "Refusing non-default database: $db" >&2; exit 1; fi
schema="vision_command_race_$$"
trap 'psql -X -v ON_ERROR_STOP=1 -qc "DROP SCHEMA IF EXISTS \"'"$schema"'\" CASCADE" >/dev/null' EXIT
psql -X -v ON_ERROR_STOP=1 <<SQL
CREATE SCHEMA "$schema";
CREATE TABLE "$schema".device_commands(
 id integer PRIMARY KEY, company_id integer NOT NULL, device_id integer NOT NULL,
 status text NOT NULL, delivered_at timestamptz
);
INSERT INTO "$schema".device_commands VALUES (1,10,20,'pending',NULL),(2,10,20,'sent','2026-10-29 10:00:00+00');
SQL
# Both sessions target the same pending row; first holds its row lock.
# PostgreSQL rechecks status='pending' after lock release, preventing a second write.
first="$(mktemp)"; second="$(mktemp)"
trap 'rm -f "$first" "$second"; psql -X -v ON_ERROR_STOP=1 -qc "DROP SCHEMA IF EXISTS \"'"$schema"'\" CASCADE" >/dev/null' EXIT
(
 psql -XAt -v ON_ERROR_STOP=1 <<SQL > "$first"
BEGIN;
UPDATE "$schema".device_commands SET status='sent',delivered_at=clock_timestamp()
 WHERE id IN (1,2) AND company_id=10 AND device_id=20 AND status='pending';
SELECT pg_sleep(2);
COMMIT;
SQL
) &
pid=$!
sleep 0.5
psql -XAt -v ON_ERROR_STOP=1 <<SQL > "$second"
BEGIN;
UPDATE "$schema".device_commands SET status='sent',delivered_at=clock_timestamp()
 WHERE id IN (1,2) AND company_id=10 AND device_id=20 AND status='pending';
COMMIT;
SQL
wait "$pid"
first_count="$(grep -cx 'UPDATE 1' "$first" || true)"
second_count="$(grep -cx 'UPDATE 0' "$second" || true)"
[[ "$first_count" == 1 && "$second_count" == 1 ]] || { echo "Unexpected concurrent update counts"; cat "$first" "$second"; exit 1; }
psql -XAt -v ON_ERROR_STOP=1 <<SQL | grep -qx 'sent|sent|2026-10-29 10:00:00+00'
SELECT (SELECT status FROM "$schema".device_commands WHERE id=1)||'|'||
       (SELECT status FROM "$schema".device_commands WHERE id=2)||'|'||
       to_char((SELECT delivered_at FROM "$schema".device_commands WHERE id=2) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')||'+00';
SQL
echo "PASS: concurrent pending update once; second session zero writes; already-sent timestamp unchanged"
