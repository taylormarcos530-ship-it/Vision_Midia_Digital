# Vision V2 — Integrated commercial gzip cache with per-block PostgreSQL17 revocation fence, atomic file failures and 300-client cutover

**Date:** 2026-11-01. **QA-only branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`.
**Requested starting SHA:** `899cccb54bb0286ee9c047b742d7c9067ae1321b`.
**Last tested code SHA:** `1dbbea557270d3a94f08695b0731240b40a7f025`.
**Verdict:** **12/12 final GitHub Actions QA jobs SUCCESS; separate sequence/offline SUCCESS. GO only for further disposable QA; PRODUCTION NO-GO.** No production resources queried or modified, not even official Supabase in read-only mode.

## GitHub Actions actual evidence and failure history

- [Final integrated workflow 41336406529](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41336406529), SHA `1dbbea55`: **12/12 PASS** on separate disposable PostgreSQL17 databases:
  - 6 concurrent admission/DB connection caps (8/12/20) × chunk (64/256KiB) staged 100 OLD + 100 NEW + 100 post-replay rollback full 10K JSON SHA-256 gzip HTTP jobs
  - 2 forced corrupted/truncated/world-readable/symlink asset and fsync-before-rename crash tests, including hard process death and in-stream commercial mutation/revocation
  - 1 simultaneous mixed **300-client** OLD→NEW cutover, DB revision commit, rollback and full recovery
  - durable outbox multiprocess-crash regression; synthetic FORCE RLS/SECURITY DEFINER 2-revoker slow-TCP regression; remote simulated AES-GCM immutable manifest and cold 100/300 original SQL HTTP regression
- [Independent sequence/offline regression 41336406505](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41336406505): source SHA `1dbbea55`, inspect final success status as additional evidence.
- Prior successful [6-stage integrated-run 41335516858](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41335516858) and [11-job run 41335775409](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41335775409) are preserved.
- Explicitly documented **initial FAILs**: (a) additional SQL revision check under `SET LOCAL ROLE authenticated` lacked SELECT privilege; resolved with *disposable tenant+active-member RLS policy* granting only `SELECT(company_id,revision)`, no writes; (b) fault runner referenced wrong Python audit import and the process-crash warmup cap was too short; fixed test harness; (c) mixed 300 returned all HTTP 503 under revision invalidation, an acceptable fail-closed result, not a requirement for old-version success; (d) mixed cutover initially checked new-router assignment too soon; fixed to require actual assignment; (e) commercial-revision race was incorrectly classified 401, fixed to 503 while revoked/invalid JWT remains 401. **These failed runs are not counted as successes; the final SHA was retested.**

## Actual integrated implementation under test

New isolated harness `tests/vision-v2-sequence-qa/integrated-commercial-fence-qa/qa.py` extends the already validated disk-backed compressed report fixture, not any deployed code.

- Two separate OS-process commercial endpoints on a single GitHub Actions runner. Original unmodified PostgreSQL17 report+export RPC: 10,000 rows per company from the **20,664 synthetic playback-event fixture**. Prepare source raw bytes once and materialize a gzip commercial envelope once per durable outbox revision. File written in 64KiB increments, SHA256 recorded, fsynced, and atomically published using `os.replace`. No request reparses all 10K JSON objects. Report producer retains prior version when a new stage fails, but admission denies it when authoritative revision has advanced.
- Each HTTP admission reads and verifies synthetic JWT company, uses PostgreSQL transaction-level **shared advisory lock**, checks active membership and commercial revision under the tenant-limited disposable `authenticated` RLS policy.
- Every compressed 64KiB/256KiB BODY chunk acquires the shared advisory transaction fence, rechecks active membership+current revision, **calls the application socket write/flush while the transaction lock is still held**, then releases at transaction end.
- Synthetic commercial writer atomically locks outbox global ID sequence, acquires matching **exclusive tenant lock**, mutates campaign revision and appends outbox event in one PG17 transaction. Synthetic revoker also obtains the exclusive tenant lock before revoking membership.
- Per-process semaphores limit concurrent openings of PostgreSQL connections to `QA_PG_POOL_SIZE` = 8/12/20; reverse proxy limits active HTTP admissions to same tested cap. **Crucial: connections are opened and closed on each protected chunk — this is a maximum-active-connection semaphore, NOT a persistent reused connection pool.** Full actual cloud PgBouncer/connection-reuse and SQL cost still untested.
- The guarded writer is the tested convention, **not enforced against every privileged/noncooperating direct database writer**; the separate synthetic minimum-role suite verifies many role attempts but is not a comprehensive production authorization map. Prequeued OS TCP bytes can be delivered after a revocation commits. The benchmark therefore proves a narrower **no additional application write calls after commit** guarantee, NOT a universal zero-delivered-bytes guarantee.

## Six 8/12/20 joint HTTP & PG17 connection-cap load tests — FINAL run

Each 100 OLD, 100 NEW and 100 rollback full report response is 100/100 HTTP 200; 300/300 per job. Two stale-cache HTTP 503 probes after the commercial commit before replay, and successful new-campaign SHA-256/10K export after replay. Test jobs run on separate GitHub-hosted machines, **not** an apples-to-apples causal latency experiment.

| HTTP AND SQL maximum concurrency | Chunk | OLD 100 P95/P99 ms | NEW 100 P95/P99 ms | rollback 100 P95/P99 ms | worker peak RSS KiB A/B | Successful SQL guards (admission+chunks) |
|---|---:|---:|---:|---:|---:|---:|
| 8 | 64KiB | 2399.867 / **2752.204** | 2465.366 / **2919.083** | 2783.461 / **3372.114** | 59852 / 59844 | **2109** |
| 8 | 256KiB | 2928.154 / **3243.389** | 2964.876 / **3074.202** | 2995.095 / **3133.490** | 59372 / 59192 | **905** |
| 12 | 64KiB | 3828.892 / **4041.542** | 3793.351 / **4020.695** | 3982.518 / **4069.515** | 59864 / 59692 | **2109** |
| 12 | 256KiB | 3201.100 / **3284.748** | 2901.867 / **3304.129** | 3000.618 / **3196.765** | 59796 / 59744 | **905** |
| 20 | 64KiB | 4414.145 / **4533.798** | 4336.873 / **4463.872** | 4443.496 / **4468.023** | 59676 / 59716 | **2109** |
| 20 | 256KiB | 2860.901 / **2922.159** | 2773.641 / **2918.973** | 2949.190 / **3151.421** | 62204 / 62500 | **905** |

Max worker RSS in this six-job final run **~58–61MiB**, far below the old previous unconstrained 50-proxy-admission handler (~800MiB), and around the earlier no-fence disk-compressed benchmark. Each 300-report job sent **105,525,300 gzip bytes** (the compressed full commercial envelopes), while originals were much larger. The cached original source and active gzip bytes occupied **5,938,774 bytes of disk per worker** in the normal fixture. This raw source is plaintext in QA, permissions `0700` directory and `0600` files, and **NOT approved production storage encryption**.

SQL guard count is accurate for the server-instrumented admission+body calls; actual SQL statements are higher. Per guard the code executes lock timeout setup, advisory lock, role setup, 2 claim settings, membership check and revision check, plus separate initial revision lookup and connection setup. No production Supabase consumption measured.

## Exact fault injection — 64 and 256KiB PASS

Each fault job runs a standalone synthetic HTTP server with a private temporary raw report and gzip revision. Verified:
- Success against SHA256, full gzip, original SQL 10,000-row JSON, restricted owner-only file access.
- New commercial transaction committed without NOTIFY; stale cache rejected with HTTP 503 until outbox replay.
- Forced OSError **after file fsync but before atomic rename**; durable outbox cursor still advanced and old version refused with HTTP 503. A subsequent rebuild recovered the correct current revision.
- Actual malicious byte mutation, truncation, `0644` world-readable permission and symlink substitution on current gzip: ALL rejected with HTTP 503; full SHA repair and 200 afterwards.
- Separate process forcibly exited **with code 94 after fsync but before rename**; replacement process loaded persisted outbox receipt/checkpoint, rebuilt the current gzip, verified integrity. No production history involved.
- A precise pause between authorization and FIRST application socket write while holding a shared PG transaction lock; concurrent exclusive lock writer cannot commit until first write completed. After commit, next write denied and HTTP 200 body **truncated**; exactly **0 additional application bytes written after commit**. 64KiB job: commercial writer **40.156ms**, revoker **38.745ms**; 256KiB: **43.630ms / 38.617ms**. Already-buffered TCP data remains possible.
- Fault jobs reported source database **22,001,331 bytes**, source index **9,805,824 bytes**, temporary source+active gzip **~5,938,776 bytes**, fault harness parent RSS **79,764/79,892 KiB**, successful guard SQL calls **53/29**. These tests only check narrow synthetic conditions and do not prove secure production filesystem controls under all users, disk exhaustion or encryption.

## Actual simultaneous 300-client cutover, commercial commit and rollback

Final job `124937060893` in run `41336406529`: 300 requests launched while OLD endpoint was serving; switched to NEW with **real observed NEW router assignments**, committed revised commercial campaign in a cooperating PG transaction while **300 requests remained unfinished**, then rolled back while there were in-flight requests.

- **All 300 attempts returned HTTP 503** under the commercial version mismatch. This is **PASS for fail-closed confidentiality/integrity**, but **FAIL for uninterrupted availability** during the change and not approved for production rollout. It is not 300 full 200 reports during the mutation.
- After durable replay on both independent consumer processes: 100/100 full SHA-verified current JSON responses on OLD after rollback and 100/100 on NEW. P95/P99 OLD **2564.406/2791.105ms**, NEW **3011.038/3122.872ms**.
- P95/P99 of 300 **rejections**, not successful reports, **755.502/788.272ms**.
- At cutover 10 proxy requests active; new route had 2 observed assignments by commit; rollback 12 active; full set remained incomplete at mutation and rollback. Parent process peak RSS **214,248 KiB**, workers **59,616 / 59,572 KiB**. Original source historical index **9,805,824 bytes** included in DB **22,001,331 bytes**.
- 300 invalidated requests had **0 complete-report gzip egress** (headers/errors may still consume bytes). The two 100-client post-replay full waves sent **70,345,600 gzip bytes** total. These are measured synthetic HTTP reports, **not media GETs**.
- Completed previous-version responses admitted before a change are allowed by this test, since buffered network delivery after commit is outside app-lock guarantee. In the final run none of the 300 completed as 200.

## Independently preserved regressions and remote AES-GCM

- Multiprocess PG17 outbox: transaction abort, producer after durable commit but before notification, consumer after read before receipt, inside receipt transaction and after committed checkpoint before acknowledgment; replay without duplicates and correct global outbox order. Real two publisher OS processes and two consumer OS processes on same CI runner.
- Separate synthetic least-privileged roles with FORCE RLS and SECURITY DEFINER negative paths, two competing revokers, 300 queued slow socket attempts, 12 PG sessions in separate job, bounded local socket-timeout and lock release after process crash — PASS.
- Separate **AES-GCM encrypted tiny manifest** HTTP simulated object store: immutable version/staging PENDING→READY, tamper/hash checks, service kill and restart with durable outbox replay; earlier run had **1 GET of 168 bytes and 4 PUTs of 680 bytes**. This does NOT measure TV media GETs, provider Storage or keys held by cloud KMS.
- Original cold 100/300 complete report RPC HTTP regression rerun; cold and prewarmed commercial paths are not identical workloads and MUST NOT be described as a controlled performance A/B test.
- Separate sequence/offline-clock workflow remains green, distinct Vision V30 work not touched.

## Database storage, WAL, memory, GETs, egress and estimated operating cost

- Across 6 full commercial synthetic PostgreSQL17 jobs final DB sizes **21,993,139–22,001,331 bytes**, including **9,805,824 bytes** of original playback source indexes; WAL delta samples **214,360–488,320 bytes AFTER loading the 20,664 fixture events**, so do not extrapolate these to 30 days of real TV ingest.
- Optimized commercial workers ~**59–63MiB peak RSS each**, plus PG17 server, parent, other processes and kernel buffers not counted. Temporary plaintext+gzip ~**5.94MB per worker**, not a real encrypted backup store.
- Each successful commercial gzip report ~**351,751 bytes**. Model one full export per client per day for a 30-day month, 2 replicas, optional separate global outbox reconciliation every 30 seconds (172,800 SQL queries/month). **No media/video/images, heartbeats, pairing, retries, real billing or retention growth.**

| Monthly scenario | 100 clients | 300 clients |
|---|---:|---:|
| full commercial gzip reports/month | 3,000 | 9,000 |
| report gzip egress/month | **~1.055 GB** | **~3.166 GB** |
| 64KiB synthetic authorization/revision guard invocations (~7/report) | 21,000 | 63,000 |
| 256KiB guard invocations (~3/report) | 9,000 | 27,000 |
| 64KiB approximate SQL statements (7 per guard + 1 initial revision query/report) | **150,000** | **450,000** |
| 256KiB same expanded approximation | **66,000** | **198,000** |
| optional shared 30-second outbox SQL probes across 2 replicas | 172,800 | 172,800 |
| **64KiB approx total SQL + optional reconciliation** | **322,800** | **622,800** |
| **256KiB approx total SQL + optional reconciliation** | **238,800** | **370,800** |

The statement counts are **engineering estimates**, not a full measured PostgreSQL audit (transaction messages, connection setup/teardown, occasional restarts, archive writes, event history and other business activity excluded). **Connection churn is significant**: the semaphore limits simultaneous openings but each chunk creates/closes a connection; a real reused pool is required. Actual R$ and Supabase Free compatibility **remain unverified by request**, since no official environment was touched.

## Hard PRODUCTION NO-GO gates

1. **No universal no-delivery-after-revocation guarantee**: cooperative PG xact locks prevent application *write calls* post-commit in controlled races, but already-written kernel/socket buffers may arrive afterwards. Uncooperative privileged revokers could bypass the convention. Need enforceable minimal DB privileges and a formally defined security SLA.
2. **Availability regression:** the simultaneous 300-client commercial update/cutover gave 300 HTTP 503 (fail-closed); require graceful drain, old-version authorization rules or retry behavior without exposing invalid revisions before a deployment can be approved.
3. **Actual pool reuse absent:** each protected chunk opens a new PostgreSQL connection, despite semaphore maximum; realistic PgBouncer/connection pooling and burst exhaustion not proven.
4. **Disk security incomplete:** temporary raw JSON is readable plaintext under private `0700/0600` access. Production requires encryption/KMS, secure temporary file lifecycle, filesystem quota, fsync of directory, immutable/no-follow descriptors, atomic metadata fencing, preventing corruption after initial hash verification, retention cleanup and multi-host artifacts. Controlled fault tests are not equivalent to all these guarantees.
5. **Real Auth/security topology unverified:** original fixture JWT and RLS synthetic; tenant-limited SELECT revision RLS created only in disposable schema. Actual Supabase JWT/JWKS, SECURITY DEFINER, service role and all revocation paths cannot be assumed.
6. **True distributed capacity unknown:** two OS HTTP processes on one GitHub runner, no independent physical/region hosts, real stalled remote TCP half-open, streaming media egress/GETs, 30-day WAL/index retention, cloud object service/KMS, provider pricing or 300 actual TVs. Monthly projection is not evidence of Supabase Free fit.

**NO-GO — Scope enforced.** No production Supabase access (even read-only), SQL or API requests to official Supabase, APK, panel, Vercel/site, TV, real historical record or main branch change, and NO deploy. Only disposable GitHub Actions PG17 databases and the selected experimental branch were changed.
