# Vision V30 — Packed deduplication, isolated PostgreSQL 17 QA (31 October 2026)

**Status:** PASS in disposable PostgreSQL 17, **NOT DEPLOYED TO SUPABASE**. No raw playback rows deleted in production; no changes to APKs/TVs. This is an isolated experimental patch, not a production-ready automatic deletion policy.

## Provenance
- Branch: `fix/playback-daily-retention-safe-20261030`
- Full run: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41196188813
- Passing commit: `9644e74ad2b808e7486522cea7d5067011d9b0d2`.
- First run `41196112297` failed from a PostgreSQL substring syntax error; fixed, rerun passed.
- Synthetic benchmark: prior ledger 20,004 entries, 1,712,128 bytes, **85.59 B/identity**; packed ledger 20,005 identities, 417,792 bytes including indexes, **20.88 B/identity** (**75.6% smaller**).
- Packed table: 261 shards including synthetic fixtures; PK index 32,768 bytes.
- 1,000 positive packed membership queries: **13.95 ms aggregate** in one PostgreSQL PL/pgSQL loop (not a deployment latency benchmark).
- Checks: old JS and SQL regression suites passed; original ledger replay/concurrency passed; packed archive, late replay with changed dates, different TVs, advertiser/TV report parity, tenant isolation, duplicate-ledger rollback and two-session concurrency passed.
- Packed two-session result: 1 raw archived, 0 duplicate replays accepted, 1 packed fingerprint retained.

## Design
- Derived hash: first **128 bits SHA-256** over `device_id:client_event_id`. Independent of `started_at` and of receipt date.
- Store sorted 16-byte fingerprints as bytea per `(device_id, first_byte)`; only 256 possible shards per TV. Strict aligned binary search checks identities. Transactional merge rejects duplicate identities.
- Existing per-TV advisory transaction lock serializes BEFORE INSERT replay validation with archive and prevents race; AFTER INSERT commercial accounting is not invoked on rejected duplicates.
- Existing opt-in compactor still retains authorization gates and raw-row checks. No task/cron is installed or activated.
- Migration refuses retrofitting a database where archival/old-ledger entries already exist, since transferring fingerprints must be proven lossless. Never run on production without an explicitly reviewed migration and backup.
- SQL functions are installed only in a disposable CI database. No production SQL is executed.
- The legacy record-per-hash table remains in QA as an inert reference for comparison.

## Projection using observed high-volume day
The 29 October sample contained 22,909 events over five TVs; **4,582 events/day/TV**. The existing playback_logs measured about **962 bytes per raw event including indexes**. This projection uses **20.88 B per packed identity**, based on one 20k-fingerprint fixture, and assumes 180 days of retained fingerprints. Remaining database structures were about 31 MB as observed; figures are approximate in decimal MB and do NOT account for table bloat/TOAST changes, VACUUM, temporary peak disk or future feature growth.

| TVs | 7 days raw + 180d fingerprints + other 31MB | 3 days raw + 180d fingerprints + other 31MB | 2 days raw + 180d fingerprints + other 31MB |
|---|---:|---:|---:|
| 5 | ~271 MB | ~183 MB | ~161 MB |
| 10 | ~511 MB | ~335 MB | ~291 MB |
| 15 | ~751 MB | ~487 MB | ~421 MB |
| 20 | ~992 MB | ~639 MB | ~551 MB |

For each TV, packed identities accumulate approximately **95.7 KB/day**; retaining exact deduplication without expiry is *unbounded*. One 180-day volume of identifiers is about 17.2 MB/TV. 300 TVs for 180d would require ~5.16GB just for this exact identity ledger. It is mathematically impossible to guarantee perfect arbitrary-late replay suppression with fixed finite storage for unbounded unique identities.

## Retention safety
Live production read-only snapshot: 210,582 raw events; receipts older than 2/3/7 days: 184,035 / 161,676 / 124,140 events. 2,391 arrivals occurred over 35 days after their playback timestamp; the cutoff must always be based on **created_at**, and identity retention must not expire without changing service guarantees.
- **7 days** recommended as cautious operational raw auditing window, *not approved for deployment yet*.
- **3 days** may work once late-arrival and audit workflows are verified, but reduces detailed troubleshooting.
- **2 days** not recommended now.
- Delayed event reporting remains by original play date. No silent deletion of suspect-clock records.
- Earlier raw rows will not automatically shrink the PostgreSQL physical file after DELETE. Budget for tested reclaim/maintenance and prevent near-quota rewrite.

## Production release blockers
1. Encrypted external backup + restore verification.
2. Test with full real anonymized data, especially collisions/names/history and client export behavior.
3. Validate 128-bit hash collision and the backend's exact retry behavior and access policies; review performance/write amplification at 10/15/20 TVs.
4. Confirm the preview-only branch does not affect production deployment pipelines; do not merge without explicit authorization.
5. Set maximum DB, Edge Function and Storage usage alerts and a safe rollback protocol.
6. Approve changes to Supabase/portal separately. NO compaction enable or delete until all gates pass.
