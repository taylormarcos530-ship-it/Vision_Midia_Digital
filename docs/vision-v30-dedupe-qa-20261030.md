# Vision V30 — QA report: persistent playback deduplication (isolated)

## Real execution
- Run: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41153078095
- Result: success on PostgreSQL 17.11 disposable container.
- Source branch: fix/playback-daily-retention-safe-20261030.
- No live Supabase migrations, production changes, APK/TV changes or production deletion.
- Existing original V30 regression suite: PASS.
- New static dedupe checks: PASS.
- Synthetic SQL: PASS (two TVs/two advertisers; per-company, per-TV and campaign totals; late offline event; replay after raw deletion; changed started_at replay; tenant access; transactional rollback).
- Real concurrency: PASS (archiver and replay raced using two PostgreSQL sessions; 1 archived, 0 duplicates written, 1 identity retained).
- QA ledger benchmark: 20,004 fingerprints, 1,712,128 bytes heap + primary key = 85.59 bytes/fingerprint, measured on PostgreSQL 17.11.

## Implementation
1. Staging SQL first; companion migration creates private.vision_playback_seen_v30 with a 128-bit truncated SHA-256 fingerprint of (device_id,client_event_id).
2. A BEFORE INSERT trigger returns NULL when a previously archived fingerprint is found, suppressing the current after-insert commercial counter as well.
3. Insertion and compactor acquire the same transaction-level advisory lock for each TV. Compactor selects one TV per transaction before raw row locks.
4. Raw DELETE RETURNING, daily summary upsert and ledger write are one atomic transaction. Any failure rolls back all three.
5. The existing V30 approvals remain disabled; dedupe_verified_at is not changed. Existing Master RPC stays unmodified; no cron added.
6. Because archived raw event IDs cannot be reconstructed, companion migration refuses to run if the new V30 archive already contains rows.

## Size / limits — NOT ready for Free fleet deployment
The observed Oct 29 baseline is 22,909 plays/day from 5 TV IDs. Current playback_logs physical size is 202,522,624 bytes / 210,582 events ~ 961.73 bytes per row including indexes. These are rough linear projections, not measured load tests.

| TVs | 7-day raw logs | ledger after 35 days | ledger after 180 days | raw+ledger+30MB base after 180d |
| --- | ---: | ---: | ---: | ---: |
| 5 | 154.2 MB | 68.6 MB | 352.9 MB | 537.2 MB |
| 10 | 308.5 MB | 137.3 MB | 705.9 MB | 1,044.3 MB |
| 15 | 462.7 MB | 205.9 MB | 1,058.8 MB | 1,551.5 MB |
| 20 | 616.9 MB | 274.5 MB | 1,411.8 MB | 2,058.7 MB |

The ledger is ~91% smaller per event than the current 962 B raw row, but **permanent exact deduplication still grows indefinitely** and exceeds Free 500 MB over time, even for 5 TVs at the sampled volume (before PostgreSQL bloat, VACUUM and other business data). Ledger-only 180-day storage for 10 TVs is already ~706 MB.

## Unresolved gating
- Implement and benchmark *more compact* persistent identity storage (for example packed fingerprints in bucketed immutable chunks), without introducing expensive inserts/queries or a false-positive suppression risk. Exact indefinite replay protection cannot have a hard storage ceiling without a retention policy limiting very-old offline events.
- Test real operator roles/JWT, RLS, concurrent ingestion throughput and recovery/restore independently.
- Validate user-facing Master and advertiser dashboards using hybrid report outputs before any switch.
- External encrypted backup and demonstrated restore, then explicit authorization before any real data deletion or cron activation.
- Existing raw duplicate UNIQUE (device_id,client_event_id) is preserved; no change to Player APK is required for staged schema approach.
