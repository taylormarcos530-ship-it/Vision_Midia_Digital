# Vision V2: actually reused PostgreSQL pool, AES-GCM sealed commercial cache and 300-client revision cutover — disposable PG17 QA

**Date:** 2026-11-01. **Only experimental branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Requested starting HEAD:** `937f1c1626cf1de7e0e5c7e44c06f6be9a541b98`. **Last tested code:** `8cb722007fec94619261512c0f82e08b7dba1ef1`.

**Decision: final 12/12 GitHub Actions PG17 jobs PASS + independent sequence/offline QA PASS. GO ONLY for further disposable QA; PRODUCTION NO-GO.** No official Supabase (even READ ONLY), production database, API, APK, panel, site/Vercel, TV or real history read or altered. No deploy, main, production V30 branch changes.

## Evidence

- **[FINAL 12/12 synthetic PostgreSQL17 workflow, run 41339035337](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41339035337)** — SUCCESS at exactly `8cb7220`: 6 × (HTTP admission cap and genuine persistent PG pool size 8/12/20) × gzip chunk 64/256KiB; 300 simultaneous mixed cutover+commercial update+rollback; 2 × (64/256KiB) encrypted file and sealed descriptor corruption, process crash, in-stream writer/revoker and PG connection fault; independent 2-revoker/300 slow sockets/privilege negative; independent durable outbox multiprocess crashed stages; independent tiny remote simulated AES-GCM manifest forced crash and full cold original 100/300 HTTP.
- **[Independent sequence/offline 41339035431](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41339035431)** — SUCCESS at the same SHA.
- Earlier complete green baseline **[10/10 code version 41338746121](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41338746121)** retained. Intermediate runs FAILED due to isolated test construction issues: recursive import, missing imported `txguard`, mismatched original stale-503 expectations after adding safe on-demand rebuild, missing disposable read-only RLS wiring in the separately imported staged test, and incorrectly asserting that a forced broken SQL connection would not be replaced. These are corrected in the final SHA; intermediate failures are NOT counted as passes.

## Implemented only in isolated test files

`tests/vision-v2-sequence-qa/secure-pool-qa/qa.py` and dedicated `staged.py`, `mixed_300.py`, `faults.py`. Prior benchmark/homologation files preserved.

**Actual reused PG connection pool:** each worker creates exactly `N` PostgreSQL connections once (N=8,12,20), and exclusive-thread queue checkout reuses them across HTTP admission and protected body chunks. Local `SET LOCAL ROLE authenticated` and claim variables are scoped to an SQL transaction (avoid cross-request leakage). A closed connection is denied **fail closed** for that operation and replaced before later use; pool capacity and peak active are measured.

**AES-GCM storage encryption:** both original full SQL report payload and commercial gzip cache are stored exclusively as AES-GCM authenticated 64KiB frames in private `0700` temporary directory with `0600` files. Each stored frame has a fresh random nonce and authenticated company/revision/frame AAD. Keys are generated per test-process in memory, not saved to disk. AES-GCM keys, contents and tokens are synthetic, never production secrets. A forced-hard-crash leftover archive cannot be decrypted without its now-lost process key, but **orphan cleanup and secure zeroization are not demonstrated**.

**Immutable descriptor and TOCTOU:** after materializing verified commercial gzip, publish ciphertext via staged write+file fsync+atomic replace+directory fsync. A sealed Linux memfd contains gzip in memory, not the plaintext file on disk; all HTTP requests read from `os.pread` using a **duplicated sealed fd**, with F_SEAL_WRITE/GROW/SHRINK/SEAL. The AES ciphertext is opened using O_NOFOLLOW; fstat owner-only regular-file checks and SHA-256 verification operate on the same fd before each request, while already pinned memfd data remains immutable. Revision cleanup unlinks previous encrypted archive but cannot invalidate readers that already hold the sealed fd.

**Safe commercial recency and fewer 503s:** after JWT membership and shared PG transaction advisory fence verify tenant/revision, a **singleflight** process-local cache rebuild looks up the committed authoritative campaign and matching durable outbox event in the disposable database. Rebuild produces a new sealed AES-GCM gzip version **without relying on LISTEN**. Durable outbox consumer checkpoint still replays on restart. Both commercial updates and membership revocation use matching exclusive transaction advisory locks; each BODY block rechecks membership+revision and holds shared lock through the application socket write. The library reports HTTP 503 when the current revision cannot be verified. The implementation DOES NOT retract bytes already written to kernel buffers and is not a formal zero-delivered-bytes-after-commit guarantee.

## 300 actual overlapping clients: old→new cutover, commercial commit and rollback

Final run job `124944903505`, 256KiB chunk, 12 HTTP admissions and 12 actually reusable PG connections per worker:
- **289 / 300 full HTTP 200 and SHA verified**, **11 / 300 HTTP 503**; zero unclassified failed or incomplete requests in this run. Of the 289 full 200, **282 had revised commercial data, 7 had original data authorized before the commit**. The earlier version with no on-demand rebuild had **300/300 503** during a comparable synthetic event. The reduction is **289 fewer 503s** (~96.3% of the previous 300), but these are separate test runs with different scheduling, **not production performance causality proof**.
- Actual in-flight requests at cutover (12) and rollback (10); new router received traffic; mutation committed while all 300 were unfinished, and 298 remained unfinished at rollback. No claim all 300 were simultaneously connected to PostgreSQL.
- 300 client wave P95 **1,567.757ms**, P99 **1,727.158ms**. **These percentiles include both successful reports and 503 failures.** After durable replay, independent 100 OLD + 100 NEW full commercial export HTTP waves: OLD P95/P99 **1,229.510/1,264.400ms**, NEW **1,445.037/1,499.067ms**, 200/200 SHA checks PASS.
- Full 200 compressed egress during mixed 300: **101,649,420 bytes**, plus error headers/body excluded from this figure. The two 100 current-report waves sent **70,345,600 compressed bytes**. Two workers RSS maxima **66,264 and 66,252 KiB**; parent coordinator **206,688 KiB** excluding PG17 OS service and system caches.
- Genuine PG pool counters: 12 connections created per worker, **1,176/319 borrows**, **1,164/307 reuses**, peak 12 active, zero pool timeouts; no official Supabase use.
- **IMPORTANT:** 7 original-revision HTTP 200 clients may receive buffered bytes after the commercial commit even if application writes were authorized earlier. This run does not prove strict no-old-delivery after commit. The test checks the revision stored in each completed JSON against one of the two real committed revisions and SHA-256; any new request after commit must use the new revision.

## 6 joint pool and HTTP-admission matrix tests: complete original 100+100+100

Each job runs the **unmodified PostgreSQL17 original report/export SQL** and returns full SHA-verified gzip JSON with 10,000 original synthetic event records per company. 300/300 HTTP 200, with OLD 100, NEW 100, then revised current campaign at rollback 100. Data are synthetic: 20,664 original event rows loaded. Independent GitHub runners, not same-host A/B; P99 differences are indicative, not causally controlled.

| Pool/admission N | gzip chunk | OLD P99 ms | NEW P99 ms | Rollback P99 ms | Highest stage P99 ms | Worker RSS KiB A/B | SQL admission+chunk guards (both) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 8 | 64KiB | 2351.787 | 2339.805 | 2010.680 | **2351.787** | 67560/67760 | 2121 |
| 8 | 256KiB | 909.623 | 962.177 | 749.694 | **962.177** | 67620/67516 | 909 |
| 12 | 64KiB | 1667.809 | 1152.117 | 1621.494 | **1667.809** | 67784/67908 | 2121 |
| 12 | 256KiB | 1149.944 | 1167.659 | 1060.277 | **1167.659** | 68036/67624 | 909 |
| 20 | 64KiB | 2294.693 | 2199.348 | 2168.548 | **2294.693** | 68136/67544 | 2121 |
| 20 | 256KiB | 891.263 | 743.238 | 1031.722 | **1031.722** | 68020/68480 | 909 |

Each stage uses the SHA of the full original report including 10,000 rows. 64KiB has 6 gzip body chunks per full report + 1 SQL admission guard, 256KiB has 2 chunks + 1 admission. **8/12/20 denotes both max concurrent HTTP admissions in proxy and persistent per-worker PG connection count**; 2 workers mean 16/24/40 established PG connections across the two workers, not a single pooled global capacity.

**Pool instrumentation**: at 12/256KiB, worker A/B each *opened 12 PG connections*, while processing **603 / 306 checkouts and 591 / 294 reuses**; peak 12 active each. At 20/256KiB, *opened 20* per worker, peak 16/18 active, suggesting 20 may be excessive for this synthetic workload. Results support considering **8 or 12**, not production approval.

**Compressed HTTP egress per 300-report staged job:** **105,525,300 bytes**, whereas original JSON uncompressed is ~838MB for 300 full commercial reports. These are HTTP report/export bytes, not video/image media. **Zero cloud media GETs measured.**

## Actual AES and PostgreSQL failures: two full negative jobs PASS

Jobs `124944903337` (64KiB) and `124944903565` (256KiB), both PASS:
- Synthetic source **and** commercial archive confirmed encrypted on disk by format/magic and absence of readable JSON terms. Private 0700 folder and 0600 files.
- AES-GCM ciphertext byte corruption denied before HTTP 200; world-readable permissions denied; symlink replacement denied by O_NOFOLLOW on pinned descriptor. Repair produces verified full HTTP. Sealed memfd prevented write and preserved a pinned old read despite ciphertext path rotation.
- Forced hard process exit **94 after encrypted fsync but before rename**; successor can rebuild safely using the durable outbox + original SQL with a fresh process key. No uncommitted revision exposed.
- Old ciphertext version unlinked on revision supersession, while pinned sealed fd remains usable. This validates controlled version cleanup, **not** orphan cleanup after uncatchable process crash.
- Forced closed pooled PostgreSQL connection caused HTTP 503 for that request and triggered exactly **one connection replacement**: 12 initial → **13 total opened**, 1 counted broken, future requests succeed. This is an intentional fail-closed scenario, not a production PostgreSQL partition test.
- Exact in-stream concurrent commercial revision and membership revocation hold matching exclusive advisory lock and prevent additional **application** socket writes after committed change: at 64KiB, first chunk=65536 bytes, commercial commit **34.12ms**, revoke **33.05ms**; at 256KiB first chunk=262144 bytes, commercial **34.36ms**, revoke **32.87ms**. Old TCP bytes already queued may arrive after commit.
- Fault job local PG17 database **21,943,987–22,001,331 bytes**, original playback index **9,805,824 bytes**. Encrypted temp files **5,941,720 bytes** per test worker; parent RSS **~79,000–81,100 KiB**, which includes the in-process test harness (not only HTTP worker).
- SQL pool reuse in faults: 64KiB 59 borrows / 47 reuses, 256KiB 31 borrows / 19 reuses; one deliberate replacement per job and no unexpected pool saturation.

## Independently verified original regressions

- Multi-process durable outbox publisher/consumer committed ordered replay, after-commit crash, prior to receipt, during receipt/checkpoint, after checkpoint before acknowledgment, idempotence, process restart: PASS.
- Separate PostgreSQL17 minimum-privileged synthetic FORCE RLS and SECURITY DEFINER negative privileges, two concurrent revokers and 300 queued non-reading socket writes with actual timeout and PG shared/exclusive fence: PASS.
- Simulated remote HTTP object store AES-GCM tiny immutable manifest: partial corrupt PUT, kill/restart, durable outbox replay and SHA check: **1 GET (168 bytes), 4 PUT (680 bytes)** total. This is **not** cloud media or production encryption key service.
- Independent true cold original uncompressed full-JSON HTTP: 100 clients P95/P99 **12,905.551/12,948.326ms**, 300 clients **14,540.834/14,763.357ms** with four full SQL rebuilds per cold wave. Different cached/uncompressed mode and runner from optimized gzip; not controlled A/B.

## DB size, index, WAL, RAM and cost

- Staged PG17 fixtures: database sizes roughly **21.94–22.00 MB** including **9,805,824 bytes (~9.81MB)** original playback source indexes. Post-fixture WAL snapshots vary **2,712–217,880 bytes** across independent runners; observed only *after loading 20,664 events*, so **do not extrapolate to real ingest, retention or cost**.
- HTTP worker RSS **~66–69MiB** each, plus parent coordinator, PostgreSQL service, kernel caches, and memfd pages not accounted for by that worker RSS. AES ciphertext archive plus encrypted source **~5.94MB per process**, with temporary older versions reclaimed on ordinary update.
- Model exactly one complete ~**351,751 byte gzip commercial report per client per day for 30 days**; no media, polling, content assets, playback heartbeats, background retries or other customer traffic.
  - 100 clients: **3,000 full reports/month**, ~**1.055GB gzip report egress**.
  - 300 clients: **9,000 full reports/month**, ~**3.166GB gzip report egress**.
  - 64KiB: ~7 SQL authorization/revision guards/report; 256KiB: ~3 guards/report. ~7 explicit SQL statements per guard (timeout, shared lock, local role, 2 claim settings, membership, revision), plus initial revision SELECT. These estimates exclude connection establishment, transaction protocol, report RPC rebuilds, revocation/outbox and any real device media/API traffic.
| Engineering monthly SQL approximation | 100 clients | 300 clients |
|---|---:|---:|
| 64KiB core ~50 SQL statements per full report | 150,000 | 450,000 |
| 256KiB core ~22 SQL statements per full report | 66,000 | 198,000 |
| Optional 2-replica durable outbox 30-second probe (NOT active in the optimized HTTP suite) | +172,800 | +172,800 |
| 64KiB core plus optional probe | **322,800** | **622,800** |
| 256KiB core plus optional probe | **238,800** | **370,800** |

**These are model calculations, not exhaustive measured SQL, current Supabase quota, BRL charges, or proof of Supabase Free sustainability.** Official Supabase deliberately NOT accessed.

## Hard production NO-GO blockers

1. **Security scope:** advisory locks are a cooperative protocol; not every real privileged auth/revocation writer in official Supabase is proven unable to bypass it. No strict zero **delivered** bytes after revoke/commit because network buffers cannot be retroactively canceled. Review actual role ownership/DEFNER/RLS and JWT/JWKS in isolated realistic environment before any rollout.
2. **Graceful availability:** 11/300 503 remains in final 300 concurrent cutover, and observed ratios vary by runner/scheduling. Need a predictable drain/retry mechanism, bounded admission, no forbidden old versions and proper client retry semantics.
3. **Real distributed environment:** 2 OS processes on same runner, no independent physical host/region or real cloud/load-balancer half-open, real pooler/PgBouncer, long-running 300 TV device simulator, or real media workload.
4. **Cryptographic key lifecycle and disk:** current AES key in process memory, no KMS/envelope rotation or securely erased key guarantees; old orphaned ciphertext may remain after hard crash, no disk quota-exhaustion or atomic directory clean recovery model across reboot. memfd is Linux-specific. Required audit before production and protected media caches must not store plaintext.
5. **Storage capacity and billing:** no real video GET, storage egress, 30/90-day WAL/index growth, PostgreSQL server RAM/pool limits across many instances, nor actual provider cost or Free-tier fit verified. This is a report-only synthetic workload.
6. **Version consistency:** per-revision on-demand build reads committed commercial DB and committed outbox, but a complete formal global consistency/nonce/fencing and crash-phase model over multi-host deployment remains untested.

**Result: PASS for these synthetic tests, PRODUCTION NO-GO.** The isolated code and workflows are not deployed artifacts. Preserve all existing V30/V2 code, APK, panel, site, TVs and production unchanged.
