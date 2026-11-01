# Vision V2 — rolling restart with synthetic PG17 outbox regression, authorization event watchdog (QA only)

**Date**: 2026-11-01. **Experimental branch**: `experiment/vision-v2-sequence-watermark-qa-20261031`.
**Starting SHA**: `d0a76fa7f29dfd989f9829d968e1e074663ffee7`.
**Code actually tested**: `4f38cb4a0c11dde0c6647c5c2fa3fb238a888191`.
**Decision**: **PASS for isolated scenarios; GO for continuing QA only; production NO-GO**.

## Evidence and failed intermediate experiments

- [Final two-job workflow 41316032463](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41316032463): **2/2 SUCCESS**. PG17 disposable rolling job `124876163138` and independent remote AES/PG17 cold baseline job `124876162832`.
- [GitHub Actions sequence/offline regression 41316032406](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41316032406): verify conclusion in Actions if needed; separate code path.
- [Initial rolling failure 41315457532](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41315457532) and [diagnostic failure 41315623539](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41315623539) **FAILED a security test**: PostgreSQL confirmed membership revoked but the LISTEN generator stopped advancing, leaving an in-memory authorization snapshot stale. Logs proved `revocation_notifies=0` and last-read age increasing to 10.844 s.
- [Corrected watcher run 41315830864](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41315830864): **PASS**, additional independent per-replica database reconciliation watcher. Final code adds a negative silent-snapshot test.

## Workload and meaning of 'rolling'

- Synthetic PostgreSQL 17 ephemeral service with **20,664 immutable event rows** (10K historical rows per tenant). Both unmodified original GitHub report and export RPCs produce a **2,793,510-byte complete JSON** response per tenant. gzip level 3 is precomputed and used for all 100/300 HTTP requests.
- A stable loopback HTTP reverse proxy routes requests to an OLD ready process. A distinct NEW OS-process replica runs two full report/export RPC rebuilds and marks itself READY only after both company caches exist.
- The router switches to NEW **after** readiness and OLD finishes all assigned requests before shutdown. Both 100/300 test waves finished **before the new replica's readiness** because rebuilding the full reports takes longer than delivering the wave; four additional full JSON probes confirmed the new replica after switchover. **It is not a 300-client split-traffic cutover benchmark.**
- Initial first replica readiness measured **7.306 s**; subsequent replacement prewarm measured **7.635 s (100 wave)** and **8.664 s (300 wave)**. Prewarm is overlapped with OLD serving, not eliminated.
- No physical multi-host or geographic failover tested; two process replicas and router run on one ephemeral GitHub runner.

## Measured final rolling vs direct cold from two separate CI jobs

| Cohort | Rolling while old READY P95/P99 ms | True DIRECT cold baseline P95/P99 ms | gzip egress during rolling |
|---|---:|---:|---:|
| 100 full HTTP clients | **446.351 / 511.789** | 12,781.019 / 12,810.869 | 35,098,550 bytes |
| 300 full HTTP clients | **1,194.962 / 1,215.216** | 16,114.706 / 16,206.849 | 105,295,650 bytes |

The direct cold baseline has **four full SQL reconstructions per wave** across two report workers; rolling needs 2 RPC builds **per replacement process**, done before its readiness, while OLD is available. Different separate GitHub runners and code paths, so results are observational, not a statistically controlled speedup. Genuine *single-instance first boot* is still cold. Zero routing errors and 400/400 HTTP 200 complete gzip JSON responses in rolling waves.

For the exact 400 complete exports in rolling, uncompressed bytes would have totaled **1,117,404,000**, compared with **140,394,200** gzip bytes (~87.44% reduction). Media egress and remote media GETs were not part of this result.

## Security: important negative finding and tested correction

- Baseline QA schema has eight RLS policies lacking active membership checks; existing synthetic QA hardens them **only in the disposable PG17**, never the official Supabase instance.
- First proposed process-only LISTEN revision observer **FAILED**: the notification read stalled and revocation went unseen for >10 seconds, despite the DB change being committed. This is a real test-detected design bug.
- Correction uses a **dedicated second PostgreSQL connection per process for durable membership reconciliation**, every **2 s**, independently of the `LISTEN` connection. Each HTTP request first validates signed synthetic JWT and active membership via **one actual PostgreSQL SQL check**; streaming chunks then check the memory revocation state and a **6-second fail-closed freshness lease**, with no per-chunk SQL lookup.
- After first 16,384 compressed bytes had already been delivered, a synthetic membership revoke was committed. The test waited for a worker to observe it, then resumed the stream and confirmed **zero further bytes** delivered, an incomplete HTTP 200 Content-Length, and subsequent new requests denied.
- Synthetic key rotation A -> B: old signed tokens denied, new signed tokens accepted only after membership restoration.
- Additional final negative test pauses authorization snapshots for >6 seconds. The worker then rejects a still-valid B token because freshness expired; after reopening reconciliation the same legitimate access recovers. **PASS**.
- **Critical NO-GO security limitation:** notification propagation is not instantaneous; bytes can be delivered during the interval between a revocation commit and the independent watcher learning about it. A 2-second period and 6-second lease do **not** establish strict immediate revocation or equivalence to per-chunk real SQL checks. Actual Supabase Auth/JWKS, multi-host partitions and threat model remain untested.

## Quantified SQL and capacity cost

The final rolling wave tested 400 genuine full JSON HTTP requests (100 + 300). Each request performs **one original synthetic PostgreSQL membership check** at admission, and each streaming checkpoint performs only an in-process state check. Replacements each prewarm two full original RPC queries. The earlier 512KiB per-chunk authorization matrix reported **4,409 successful auth SQL checks for 800 HTTP calls** plus security probes (~5.51 per call); this rolling model is around **one SQL check per HTTP request**, but the test populations differ. No SQL reduction is safe to claim without accounting for the **background reconciliation** and revocation gap.

- QA-only 2 s per-process reconciliation: two replicas, two tenants means at least **5,184,000 tenant-membership SELECT checks per 30 days** if sustained continuously, before the original LISTEN observer also performs any checks, and before HTTP load. **Not a viable Free-tier default**.
- Hypothetical 60-second reconciliation for two replicas/two tenants = **172,800 reads/30 d**, but a **6-second** freshness lease would reject healthy traffic at that cadence. No validated low-frequency production replacement exists.
- At one full report per client/day for 30 days, complete gzip JSON egress would be approximately **1.053 GB (100)** or **3.159 GB (300)**, compared with 8.381/25.142 GB plain. No BRL amount or Free-tier entitlement inferred.

## Measured storage, WAL, RAM, remote object GETs

| Metric | Final rolling synthetic job | Separate remote-regression job |
|---|---:|---:|
| PostgreSQL database bytes | **21,821,107** | 21,903,027 |
| Source playback index bytes (included in DB size) | **9,805,824** | 9,805,824 |
| PostgreSQL WAL **after initial 20K data insert** | **215,344 bytes** | 505,328 bytes |
| Last ready rolling replica Python peak RSS | **86,528 KiB** | n/a |
| QA coordinator Python RSS peak | **215,888 KiB** | n/a |
| Remote encrypted-manifest HTTP GETs | Not exercised | **1 GET, 168 bytes** |
| Remote encrypted-manifest HTTP PUTs | Not exercised | 4 PUTs, 680 bytes |

Parent RSS and replica RSS **must not be simply added** as total host physical memory; other OS processes, PostgreSQL, parent fork accounting and router have different scopes. WAL excludes insertion of 20K synthetic original rows, so it does not represent monthly WAL retention or full ingest cost.

The independent AES regression job again validated forced termination/restart of the external simulated object HTTP server, outbox transaction rollback, HTTP 503 for partial object, immutable publication by version, digest verification and synthetic JWT rotation, with production unchanged.

## Production release blockers — NO-GO

1. Demonstrate zero/acceptable authorization-revocation exposure window under actual JWT/JWKS, role changes, silent asymmetric network partitions, and in-progress full HTTP streaming. The event listener alone failed and 2-second SQL reconciliation is expensive.
2. Production design for economical durable invalidation without a multi-million-per-month membership polling loop, including secure fencing, cache lease and explicit SLA. Do not copy QA's 2s/6s settings.
3. Real two-host/VM rolling deployment and full-load 100/300 split-traffic cutover while a replacement warms, crash midway, rollback and shared cache fencing. Current waves finish before cutover.
4. Real external object storage/KMS, transactional manifest change under concurrent publishers, WAL/index retention and provider costs; local HTTP AES object service is simulation.
5. Test repeated start times, RSS, full cold P99 on realistic multi-tenant workloads, 7/30-day history, uploads and real media bandwidth. The ~7.3 second first-boot observed in this run is not a production SLA.

**Hard scope:** No official Supabase consulted (even read), no APK, website, Vercel, panel, TV, production database or real history touched. All writes confined to the selected isolated GitHub branch and disposable PostgreSQL 17 GitHub Actions. No deploy and no main merge.
