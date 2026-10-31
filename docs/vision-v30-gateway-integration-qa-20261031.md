# Vision V30 — Playback gateway + segmented ledger integration QA (2026-10-31)

**Status:** PASS in PostgreSQL 17 disposable CI. **NOT RELEASED**: no Supabase, Vercel production, APK or TV changes; no real events deleted. The gateway fix and tests are on isolated branch `fix/playback-daily-retention-safe-20261030`.

## Verified run
- https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41201892514
- Passing commit: `afbe405da09e14604795512fb7b11ce4f50bc315`.
- Earlier QA runs 41201593141, 41201693821, 41201794956 failed on ambiguous SQL test variable names, not on an observed data inconsistency. Corrected test SQL and reran complete workflow until success.

## Gateway playback_batch actual code inspection
- `supabase/functions/device-gateway/index.ts` already writes `playback_logs` using `.upsert(rows,{onConflict:'device_id,client_event_id',ignoreDuplicates:true})`.
- The API responds `{ok:true,accepted:rows.length}`; `accepted` is number of events acknowledged as processed or duplicate, **not** the number of new rows inserted.
- `player.js` awaits successful `gateway({action:'playback_batch',events:batch})` before removing IDs from the local queue. An unsuccessful HTTP response retains them.
- **Proved bug:** previous gateway silently ignored invalid entries inside otherwise valid batches, then returned success for a partial subset; the Player would remove ALL IDs and lose rejected playback proofs.
- **Fix on isolated branch:** reject entire mixed-invalid batch (HTTP 400, without upsert); reject overlong `client_event_id` instead of truncating it into a possible collision; retain successful acknowledgments for all-valid batches including already-archived retries.
- Gateway validation tests dynamically execute the actual `playback_batch` handler code with a stub admin client; test successes include valid batch, mixed-invalid fail-closed, invalid timestamp, overlong ID, idempotent acknowledgment, database failure preserving queue semantics, max 100 / reject 101, and Player queue acknowledgment order.
- **Note:** a permanently invalid event may require a future safe quarantine/recovery workflow; returning 400 ensures no silent loss but by itself does not remove the stuck event from the Player queue.

## PostgreSQL17 integration (disposable database, synthetic records only)

- **64/65 boundary:** 64 hashes grouped into segment 1 and 65th in segment 2, same shard; duplicate fingerprint rejected, counts unaffected.
- **20 TVs and two companies:** 2,000 raw reproductions (=100 per TV) compacted in 21 calls; 20 TVs represented in archive; before/after reports identical per company and per TV. Compaction duration in this run: **128.73 ms** for 2,000 synthetic rows (not a production throughput SLA).
- **1,000 old retries:** matching already-archived ID, including altered playback date, resulted in zero inserted raw rows using `ON CONFLICT DO NOTHING`, no SQL error; 1,000 attempted retries took **22.63 ms** total in the test.
- **Failure/rollback:** forced transaction exception left zero persisted rows for failed synthetic event; next retry inserted once.
- **Identity scope:** same *new* `client_event_id` on distinct TVs was accepted twice, once for each device, without cross-TV suppression.
- **Tenant RLS:** with synthetic `authenticated` role and a fixture-provided `private.is_company_member`, company A read its 1,000 archived plays and zero for company B, and could not read private ledger. This proves the test policy behavior, **not** real-JWT company isolation in the live Supabase project.
- Previous seven-day retention tests passed (8,000 historical consolidated, 2,000 newly received + 100 clock-suspect retained; five report comparisons matched). Previous ledger scale benchmarks (100k/300k) and actual two-session race passed.
- Existing segmented pg_dump/pg_restore passed in this run: 5,329 segments / 308,501 identities; archive 3 groups/8,001 plays; 2,100 raw events; replays rejected after restore. The backup is synthetic, not a live encrypted external backup.

## Production blockers

1. Confirm deployed Supabase `device-gateway` implementation matches the checked GitHub branch or reconcile with deployed v22 (GitHub alone does not prove live code parity).
2. Validate real JWT / service_role permissions, RLS, advertiser authorization and tenant isolation in a detached/staging environment.
3. Verify end-to-end ACK semantics over HTTP/PostgREST with a real Edge Function instance and Player in bench QA; current test executes actual handler logic in Node with a stub client and verifies real Postgres UPSERT/BEFORE INSERT trigger separately.
4. Provide safe handling of corrupt/persistently invalid local queued events without silent discarding, and verify no older Player version depends on acceptance of partial payloads.
5. Ensure future Master / advertiser report views preserve historical totals, day/timezone, filtering and export semantics; `get_playback_events` can only export raw individual events still retained, unlike the daily summaries.
6. External encrypted full database backup, tested restore, documented cutoff / rollback, size monitoring, WAL and physical disk reclaim plan. No SQL cleanup or cron until user authorizes.
7. Segmented ledger is cheaper for 500 incremental inserts than monolithic `bytea`, but bulk operations are still slower than UUID-per-row and all exact-or-cryptographic dedupe storage grows without bound.
8. Separate production release approval required. No data deletion, migration application, Vercel deploy, APK rebuild or TV update performed.

## Relevant files
- `supabase/functions/device-gateway/index.ts`: fail-closed batch ACK fix (branch only).
- `tests/v30-playback-gateway-ack.test.cjs`: JS execution of real gateway handler branch (mocked PostgREST).
- `tests/v30-gateway-segmented-integration.sql`: actual PostgreSQL17 boundary, multi-TV, retry, transaction rollback, tenant RLS tests.
- `supabase/qa-migrations/v30_playback_segmented_ledger_qa.sql`: isolated segmented hash ledger, default disabled.
