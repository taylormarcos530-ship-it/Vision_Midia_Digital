# Vision V2 — cold 100/300 HTTP full original RPC, remote simulated AES storage and JWT/RLS revocation

**Date:** 2026-11-01. **Starting HEAD:** `b01df8e1d0663290bc9e1f8498aeb40f62731fe7`.
**Tested code:** `523c4243d894d15d2e364d19188c54d778cefb95`.
**Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`, no merge.
**Verdict:** **PASS for isolated PostgreSQL 17 QA only; GO for further QA; NO-GO production.**

## Primary verified GitHub Actions

- [Run 41313609081](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41313609081), **SUCCESS**, final cold remote crash, full RPC HTTP and JWT rotation; `QA_COLD_REMOTE_PASS=true`.
- [Run 41313609072](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41313609072), **SUCCESS**, sequence/offline regression on identical code HEAD.
- [Run 41313415103](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41313415103), **SUCCESS**, earlier cold prototype. The final QA extended this with forcibly killed external HTTP store and two live worker JWT key rotation.
- [Earlier real Docker 183-second partition 41312513819](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41312513819), PASS from prior QA stage; **not rerun** in this code HEAD.

## Test environment and scope

Disposable GitHub Actions PostgreSQL **17-alpine** service and Python 3.12, independent Python OS processes for HTTP report workers and separate remote-simulated HTTP AES object server on **same ephemeral runner**. All commercial data, tenants, JWT keys and object files are synthetic. Original GitHub RPC SQL `get_playback_report` and `get_playback_events` is executed unchanged in the synthetic database. Two companies have **10,000 older historical events each**, while source has **20,664 total events including 664 more recent synthetic events**. No original rows deleted or permanent duplicate event-level read model created.

Each HTTP report response contains the entire original report + all 10,000 export rows for **one company**, not 20,000 events per single response. Complete body, size and hash verified; sampled JSON is deserialized and checked. No CDN, gzip or real Internet network latency measured.

## Actual cold-start wave results

The result cache was explicitly cleared before **each** wave. Two independent HTTP process workers, two companies; singleflight synchronized one rebuild per company per replica (four full SQL report/export reconstructions across each wave). 100/300 requests enter with cold caches. This does **not** equal 100/300 independent uncached full SQL exports; coalescing is fundamental to the result.

| Concurrent clients | P95 | P99 | Full RPC rebuilds | Full HTTP 200 | Total bytes delivered |
|---|---:|---:|---:|---:|---:|
| 100 | **13,596.218 ms** | **13,614.889 ms** | 4 | 100 | 279,351,000 |
| 300 | **14,986.452 ms** | **15,114.572 ms** | 4 | 300 | 838,053,000 |
| Both | — | — | 8 | 400 | **1,117,404,000** |

The 300-client P99 is ~15.11 seconds, materially slower than a previous warm cache ~0.17 seconds; do not imply production SLA.

Replica Python maximum RSS at end: **85,372 + 84,272 KiB** (approx 166 MiB combined), excluding PostgreSQL, remote store and QA parent. The separate simulated remote store recorded RSS **36,024 KiB before forced termination**, **35,400 KiB after restart**. QA parent high-water **239,688 KiB** (may reflect forked memory; do not blindly add to all processes as exact host memory).

Two report workers had 827 successful authorization-check SQL counters (427+400), excluding denied guards that do not increment the counter. **Authentication checks are NOT free on cache hits**. Measured 4 full report rebuilds per wave, 8 total; further SQL for authorization and test setup exists.

## Durable outbox, remote HTTP object and real process failure

- A single PostgreSQL transaction holds synthetic commercial mutation, revision and durable outbox event; injected precommit exception causes rollback with no partial event.
- A separate HTTP object-store **process** stores versioned AES-256-GCM manifest payloads under a temporary directory. A PUT with injected fault persisted only a partial encrypted object and returned HTTP 503; any report access with PostgreSQL state PENDING is blocked.
- The store process was **terminated forcibly**, without orderly HTTP shutdown, then restarted while retaining the temporary files. Partial object remains unusable.
- An entirely new immutable object version was uploaded; repeated identical PUT succeeded, different content at the same version returned HTTP 409; PostgreSQL READY pointer and SHA-256 were committed **after** upload verification.
- The published object was retrieved and validated with SHA-256, AES-GCM authentication and revision.
- **Remote simulated HTTP metrics, entire test including both process lifetimes:** 4 PUTs, 1 GET; 680 bytes uploaded and 168 bytes downloaded. These are tiny manifest envelopes, **not remote object/media playback GET metrics** and cannot estimate total 300-TV bandwidth.

The PG and external object server cannot share one atomic database transaction. This QA validates fail-closed sequencing and retry/idempotence; it is not proof of exactly-once remote publication in all crash windows or a deployable object-storage protocol.

## Revocation and key rotation

- Native synthetic PostgreSQL RLS policy strengthening for all eight surviving tables was previously reproduced (all eight source fixture policies lacked active membership checks before local hardening). The new suite reuses that QA hardening, leaves official Supabase untouched.
- Synthetic HS256 signed JWT and membership were verified before and **after** expensive SQL report computation.
- During 24 in-flight report requests, user A's company membership was removed in synthetic PostgreSQL. In-progress requests either completed before revocation or were denied; **12 additional new signed-token calls were denied** after revocation, plus **6 calls using the rotated key while membership remained revoked**.
- Both **live report worker processes** were switched from accepting old and new key to accepting only key B. After membership restoration, 4 old-key requests were denied and 4 valid new-key requests succeeded.
- This is not actual Supabase Auth, deployed JWT verification, JWKS rotation or a guaranteed zero-window revocation SLA. Each HTTP authorization uses real synthetic SQL; further batching/caching requires careful revocation consistency.

## Database capacity and storage

| Metric | Observed |
|---|---:|
| 20,664 synthetic original events retained | PASS |
| Database size at final QA checkpoint | **21,903,027 bytes** |
| Source playback index bytes | **9,805,824 bytes** |
| WAL delta **after** 20K historical insertion, including rest of QA | **505,328 bytes** |
| Remote GETs across forced crash/restart | **1** |
| Full JSON response size | **2,793,510 bytes** |
| Total two-wave HTTP bytes | **1,117,404,000 bytes** |

Index bytes are INCLUDED in database size. WAL is not the total WAL for expanding 20K historical rows. 1 remote GET fetches the tiny synthetic encrypted manifest, not the 400 report results; report HTML/JSON egress is separate.

## Transparent 100 vs 300 client cost model — no invented R$ billing

Assumptions: each TV/client requests **one full 2,793,510-byte report per day** for 30 days; **two** synthetic per-request membership SQL checks, no retries, exactly two server replicas; one global 60-second heartbeat, two global 60-second reconciliation checks; ignores application overhead, HTTP framing, images/video/device heartbeats, server CPU, network compression and billing tiers.

| Model | 100 clients | 300 clients |
|---|---:|---:|
| Monthly full-report requests (one per day) | 3,000 | 9,000 |
| Full JSON egress bytes per 30 days | **8,380,530,000 (8.38 GB)** | **25,141,590,000 (25.14 GB)** |
| Synthetic report authorization SQL checks/month | 6,000 | 18,000 |
| Background heartbeat+two check channels per 30 days | 129,600 | 129,600 |
| Modeled SQL/notify subtotal excluding report misses | **135,600** | **147,600** |

At **one report each hour** instead of daily, full JSON egress would become approximately **201.13 GB (100)** or **603.40 GB (300)** per 30 days, excluding all media. A monetary estimate requires actual applicable Supabase/hosting/egress tariffs and architecture, none was fetched from official production. **No verified cost in reais or Free-tier sufficiency** is claimed.

## Release blockers and production gates

1. **Real Supabase JWT/JWKS and production-specific RLS/SECURITY DEFINER permissions** with user revocation during streaming large report responses, not just synthetic fixtures. Previous fixture was demonstrably permissive.
2. Multiple independent hosts/VMs or regions; this QA uses multiple isolated OS processes on ONE runner. Prior Docker namespace partition is separate evidence, not a cross-host real failover test.
3. Live remote object-store infrastructure/KMS, durable acknowledgments, retries and crash points before/after archive publication, consumer fencing and correctness during concurrent publisher races.
4. 300 genuinely **distinct** cold SQL builds under load, sustained 24-hour/7-day tests and changing active campaigns, with safe concurrency bounds and no write amplification. Existing cold wave uses singleflight as intended and is not that stress test.
5. Capacity assessment with full PostgreSQL+application+storage memory, WAL **including 20K insertion**, index retention, real media downloads, GETs, egress and billing. 15-second cold P99 is not yet acceptable for production without an explicit SLA.
6. Never deploy the aggressive 0.5-second QA reconciliation from prior tests; safe production lease heartbeat and load need separate approval.

**Do not deploy. No production Supabase, APK, panel, site, TV, RLS or real historical data was queried or changed. All writes confined to this GitHub experimental branch and disposable CI resources.**