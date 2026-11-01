# Vision V2 — 300-client bounded 503 retry, AES-GCM key rotation and dead-process orphan cleanup (disposable PG17 QA)

**Date:** 2026-11-01. **Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Requested starting HEAD:** `4b855431e5579b9ce77e3ec50385d28c2a390f72`. **Source code and workflow tested at:** `e5afbb0d35d4bdbf91efb1305f3eb04dfd978510`.

**Result: 7/7 dedicated retry + encryption/cleanup QA jobs PASS**, independently **12/12 baseline full-commercial, JWT/RLS, outbox/AES jobs PASS** at the immediately preceding code SHA `b54c15c2c57f4218121bc2bf3a0458d3b6a0aca4` (its main source code was not modified by the subsequent workflow-only commit), plus sequence/offline PASS at that SHA. **GO only for further synthetic QA. PRODUCTION NO-GO.**

## Exact GitHub Actions evidence

- [FINAL 7/7 GitHub Actions PG17 workflow 41340613160](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41340613160) on SHA `e5afbb0`: one actual 300-client retry/cutover/rollback job and 6 PG17 AES key rotation + abandoned-file + pool-failure jobs (8/12/20 × 64/256 KiB), 7/7 SUCCESS.
- [Prior 300-client retry 41340320499](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41340320499): 1/1 PASS, 12 transient 503 → 0 final, P95 **1550.698ms**, P99 **1818.052ms**, max **2054.008ms**. Independent stochastic runner; not identical P99.
- [Independent full PG17 12/12 regression 41340555861](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41340555861): 6 stages 100/100/100 complete original JSON SHA gzip, concurrent 300 client commercial mutation, two AES encrypted file corruption/crash and in-stream revoke tests, multiprocess outbox, minimum-privileged two revokers, remote-simulated AES-GCM manifest/cold full HTTP. 12/12 PASS.
- [Independent sequence/offline QA 41340555853](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41340555853) PASS.

No official Supabase queried even read-only, no production, APK, panel, site, TV, real history, Vercel deploy, main or V30 branch touched. All PostgreSQL17 databases and identity data synthetic. Source changes limited to new QA test files and one isolated GitHub Actions workflow on the experimental branch.

## Policy — bounded idempotent GET retry (not bypassing authorization)

New `tests/vision-v2-sequence-qa/secure-pool-qa/retry_300.py` repeats the real 300-client OLD→NEW cutover, committing a commercial revision while all 300 requests remain in-flight, and rolling back with pending clients. The client retries **only safe idempotent GETs returning HTTP 503**, with an exponential backoff capped at 140ms and **maximum five attempts, 7.5-second end-to-end deadline**. Every attempt goes through a NEW HTTP request, a NEW synthetic JWT/RLS membership and authoritative company revision SQL check and an application write protected by the existing per-block transaction advisory fence. **401/403 must never retry and fail the test; an incomplete/truncated HTTP 200 is NOT reported as success or blindly retried.** All successful results must be full 10,000-event original JSON export, gzip-valid, SHA-256 valid, with one of the two actual committed campaign revisions.

**Final run job 124949605943:**
- 300/300 final full HTTP 200, 0/300 final 503, zero incomplete results.
- **12 transient backend 503** on **12 distinct clients**, each recovered on its **second attempt**; maximum attempted count=2.
- End-to-end client **P95=1833.358 ms, P99=2190.722 ms**, max observed=**2398.149 ms**, below configured 7500ms cap. These P95/P99 include retries, not only successful backend service time.
- **283 complete updated-campaign reports** and **17 original-campaign reports authorized before commercial commit**. Some already authorized original bytes could arrive AFTER the commit due to proxy/kernel buffers. **This is not zero post-commit network delivery** and not a proof that all 300 clients see only the latest campaign.
- SHA256 full 10K report PASS for each completed response. Post-replay independent 100/100 old/new complete revised HTTP: OLD P95/P99 **1103.692/1142.408 ms**, NEW **1298.301/1387.773 ms**.
- 2 workers persistent SQL pool created **12 sessions each**, worker A/B borrowed **1179/346**, reused **1167/334**, peak 12 each, zero unexpected SQL pool breaks or timeouts. Worker RSS maxima **67008/66896 KiB** (~65.4 MiB). Parent and PostgreSQL server RAM not included.
- Mixed 300 full reports gzip egress **105,518,468 bytes**, excluding 503 response headers; official storage/media GETs=0.

**Interpretation:** Eliminating final 503 after client retry in these controlled runs is confirmed. Backend 503 is **not eliminated**; graceful server/router admission drain was **not implemented or tested**. Separate independent CI runners give a performance distribution, not a deterministically guaranteed P99 at 300 real TVs. 401 is forbidden by code and authenticated membership denial is tested in the separate key/GC jobs, but a dedicated end-to-end 401-after-revocation-in-the-retry-client wave is an additional desirable test.

## AES-GCM key rotation, actual hard-crash orphan GC and pinned sealed descriptor

New isolated `rotation_gc.py` and `key_gc_faults.py` implement/test:
1. **Two-phase key change:** generate a new random 256-bit AES-GCM data key, decrypt each source/report ciphertext into a STREAMING re-encryption using 64KiB authenticated frames with new nonces and company/revision/frame AAD, stage files with restrictive permissions, authenticate all staged files **before** any rename. Controlled injected exception before first rename leaves old key and old ciphertext intact, with staging files cleaned. Successful commit updates current ciphertext hashes and key in-process.
2. **Pinned immutable Linux memfd:** an already verified full gzip descriptor is duplicated and F_SEAL_WRITE/F_SEAL_SHRINK/F_SEAL_GROW/F_SEAL_SEAL locked. Its bytes remain unchanged across key rotation, ciphertext archive modification, file unlink/cleanup and revision rollover. A new HTTP request after archive tampering receives HTTP 503; old AES key is rejected on newly rotated encrypted source with real `InvalidTag`.
3. **Real dead-process orphan cleanup:** separate PG17 test process prepares a source encrypted file, fsyncs AES archive staging, exits immediately with code 94 before atomic rename. The parent confirms exit and exactly **three abandoned files** under a private disposable temporary directory; a bounded directory-fd cleanup eliminates those three. A second GC removes **three synthetic abandoned staging/rotation paths**, including a symlink without following its target, preserving a foreign file and an unrelated file. Empty scans are idempotent. Cleaner refuses unexpected directories and files outside private temporary root. Live-reader key descriptors are protected in the controlling process.
4. **Pool fail closed/recover:** close one genuine connection: first request is denied with 503; pool opens one replacement and subsequent verified HTTP 200 resumes; tested with pool sizes 8, 12, 20. JWT membership revocation gives 401; restoring association returns correct current campaign. Checkpointed ordered outbox retains commercial revision identity across rebuild.
5. **Strict negative cases**: AES plaintext source never written to disk by the rotation routine, previous key rejects updated files, file SHA mutation after verified lookup is refused for NEW reads, old pinned descriptor still matches previous gzip SHA, symlinks do not redirect source reads or cleanup, unrelated path is not deleted.

### Six independent key/GC negative job results (all PASS)

| PG pool max | HTTP gzip chunk | Opened after 1 deliberately broken SQL connection | Borrows / actual reuses | Reaped real dead-worker files | Reaped abandoned stage names |
|---|---:|---:|---:|---:|---:|
| 8 | 256KiB | **9** | 24 / 16 | 3 | 3 |
| 8 | 64KiB | **9** | 52 / 44 | 3 | 3 |
| 12 | 256KiB | **13** | 24 / 12 | 3 | 3 |
| 12 | 64KiB | **13** | 52 / 40 | 3 | 3 |
| 20 | 256KiB | **21** | 24 / 4 | 3 | 3 |
| 20 | 64KiB | **21** | 52 / 32 | 3 | 3 |

In these negative jobs: encrypted source + current gzip ~**5,941,729 bytes**, process RSS **79,604–80,080 KiB** including test harness, database **21,943,987–22,001,331 bytes**, playback source indexes **9,805,824 bytes**. These tests only open 1 HTTP at a time for key/GC, while the separate full matrix tests peak 8/12/20 HTTP and SQL concurrency.

**Important unsupported crash phase:** the key rotation is **not crash-atomic across multiple file os.replace calls**. A crash after the first ciphertext replacement and before swapping all records could leave inconsistent per-process key state. In the synthetic test the process key is lost on hard crash and the data may be rebuilt from original PG17 SQL and durable outbox, but this is NOT a production KMS/recovery solution. Orphan GC is restricted to the fixture's own private dead-worker directory and does not imply safe sweeping of arbitrary production media. Production remains NO-GO.

## Full independent commercial matrix, 100 OLD +100 NEW +100 rollback

Last full run `41340555861` at SHA `b54c15c`, source files unchanged in final workflow-only SHA. All jobs **300/300 full HTTP 200** with SHA-valid 10K original event JSON.

| Persistent PostgreSQL connections per worker and HTTP cap | Chunk | Highest stage P99 of three 100-client waves (ms) | Worker peak RSS KiB A/B | SQL admission + chunk guard invocations |
|---|---:|---:|---:|---:|
| 8 | 64KiB | 1407.659 | 67488 / 67596 | 2121 |
| 8 | 256KiB | 1588.172 | 67396 / 67240 | 909 |
| 12 | 64KiB | 1720.906 | 67232 / 67432 | 2121 |
| 12 | 256KiB | 1210.817 | 67624 / 67736 | 909 |
| 20 | 64KiB | 1798.404 | 67372 / 67512 | 2121 |
| 20 | 256KiB | 1516.100 | 68268 / 67208 | 909 |

Each full commercial 300-response job sent **105,525,300 bytes** gzip and processed original full source ~838MB raw-equivalent bytes. SQLite and actual cloud were NOT used; PostgreSQL17 is a disposable container on GitHub runner. All 6 used two worker OS processes on the same runner, **not two independent hosts**.

## Independent core safety and AES regression

- Synthetic FORCE RLS / SECURITY DEFINER privilege-denial, 2 concurrent revokers and 300 queued slow non-reading socket writes, bounded socket timeout and lock release after process death: PASS in `41340555861`.
- Outbox global ordered durable checkpoints over 2 OS producer/consumer pairs, crash after commit, before receipt, within receipt transaction, after checkpoint/ack, and restart: PASS.
- Tiny AES-GCM manifest on a simulated remote HTTP object store with partial uploads, forced crash, reconstruction and SHA: PASS. Historical fixture recorded **1 GET (168 bytes) / 4 PUT (680 bytes)**, but do not confuse this with media GETs or cloud Storage operations.
- Original full uncompressed cold HTTP tests 100 and 300 clients, and original synthetic RLS/JWT after revocation: PASS separately; these are different workloads from cached commercial gzip.
- Test excludes official JWT/JWKS, official Supabase project and real historical/user data by request.

## Storage, memory, WAL, egress and modeled 100/300 customer costs

- Original full synthetic playback history fixture contains **20,664 synthetic events**, database about **21.94–22.00 MB**, original playback indexes **9.81MB**. Previous full-run **WAL snapshots after fixture** were ~**2.7–218 KiB**; NOT total ingest WAL and not adequate to extrapolate full storage retention. The final retry+key-GC jobs do not recalculate complete WAL, so report this as inherited independent measurement, not new observation.
- **AES ciphertext cache ~5.94MB per process**, with rotated old revisions cleaned in normal operation; real crashed process orphan GC verified for three abandoned files. These numbers do not include full media/cache or provider snapshots.
- Full commercial gzip report ~**351,751 bytes**. With exactly one full report/client/day over a 30-day synthetic billing month: 100 clients => **3,000 reports**, **~1.055GB report egress**; 300 => **9,000 reports**, **~3.166GB report egress**. Excludes videos, images, heartbeats, other endpoints and object GETs.
- 64KiB body chunk makes ~7 admission+chunk guard invocations per report, 256KiB ~3; each involves several explicit SQL statements. With ~7 statements/guard + one revision SELECT/report, model 64KiB ~50 SQL statements/report and 256KiB ~22 SQL/report; this is **not an exhaustive measured SQL audit**, and connection reuse reduces connection churn, not the number of authorization statements.
| Hypothetical 30-day report SQL plus **optional** 30-second shared two-replica poll | 100 clients | 300 clients |
|---|---:|---:|
| 64KiB: ~50 SQL/report +172,800 polls | **322,800** | **622,800** |
| 256KiB: ~22 SQL/report +172,800 polls | **238,800** | **370,800** |

**No real Supabase Free quota assessment, SQL billing, media traffic, provider price in R$, storage GET/effective monthly physical WAL or 30/90-day history extrapolation claimed.** The optional 30-second poll was not enabled in the cache tests.

## Strict PRODUCTION NO-GO reasons

1. Client retry is limited to safe GET 503 and proved 0 final 503 only in the two measured synthetic trials; there is no completed graceful router/server DRAIN implementation or formal availability SLA. Actual 503 can recur on load beyond the retry cap. Incomplete 200 is refused, not secretly retried.
2. **Strict zero commercial/JWT-revoked bytes delivered after commit is NOT proven**. 17 precommit-authorized old 200s in the final trial can still be delivered from proxy/TCP buffers afterward. Application socket writes within the cooperative per-block PG transaction are protected; kernel delivery and uncooperative real privileged writers are not.
3. Multi-file rotation is not crash-atomic and has no KMS-backed durable keyring, key-id metadata, recovery from mid-publish process crash, envelope encryption, or real key custody verification. The GC targets only private synthetic orphan paths with known process death.
4. Two OS instances were on one disposable runner, not separate hosts or production proxy/cloud load balancer. True network partition, TCP half-open, PgBouncer, live media traffic and actual user JWT/JWKS untested.
5. Free-tier suitability, real storage/WAL growth, 300 TV concurrent device heartbeat, cloud egress/GET and monetary operating costs remain unverified because official Supabase, live TVs and real history were forbidden.
6. No code deployed to production and the experimental scripts are **QA-only**; no production cutover/rollback authorization has been given.

**GO only for further disposable QA. Keep PRODUCTION NO-GO.**
