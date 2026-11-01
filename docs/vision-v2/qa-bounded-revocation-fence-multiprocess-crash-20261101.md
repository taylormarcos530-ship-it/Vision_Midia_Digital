# Vision V2 — PostgreSQL17 bounded chunk fence, durable replay across every crash boundary, 100/300 full HTTP

**Date:** 2026-11-01. **Scope:** only branch `experiment/vision-v2-sequence-watermark-qa-20261031`.
**Starting SHA:** `0795c4e45bf2669c53f63540914c5b86d4781e61`.
**Tested code SHA:** `f6c2ad3f3465373ccae1c27a29df82f0da74db0e`.
**Decision:** **5/5 PG17 QA jobs PASS; separate sequence/offline regression PASS. GO to continue disposable QA only. PRODUCTION NO-GO.**

## Verified GitHub Actions

- [Five-job complete matrix — 41325919344](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41325919344): **SUCCESS**; code `f6c2ad3f`.
  - [bounded fence HTTP + cutover job](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41325919344): job `124905699861`, PASS, bounded stream/revoke, 100/300 full gzip JSON, live cutover and rollback.
  - crash-matrix job `124905699819`: PASS, writer/consumer process hard-exits, persistent receipts, two simultaneous OS-process publishers and consumers.
  - ordered-outbox/PG TCP failure job `124905699805`: PASS.
  - commercial complete HTTP race job `124905699773`: PASS suite including an intentionally **FAIL** unsafe implementation.
  - remote AES-GCM and cold complete HTTP job `124905699496`: PASS.
- [Separate sequence/offline workflow — 41325919366](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41325919366): **SUCCESS** on same SHA.
- Prior valid QA runs are preserved and no workflow includes deployment steps.

## What is and is not solved about authorization and socket writes

**Unsafe baseline (reproduced):** A SQL authorization is checked, then the thread pauses; membership is revoked and committed; finally the previously authorized socket write proceeds. This released **16,384 compressed bytes AFTER revocation commit**. FAIL for strict post-commit byte rules.

**Controlled revalidation (reproduced):** Re-checking SQL after this particular pause stopped further data, **0 bytes after the commit**. PASS for the injection, but a second check *alone* leaves another instruction-level check-to-write gap.

**New experimental bounded transaction fence:** For every compressed body segment (~64 KiB), the server acquires a PostgreSQL **transaction-level shared advisory lock**, validates signed synthetic JWT + active membership under the disposable RLS fixture, calls `wfile.write/flush` **while holding the lock**, then commits the reader transaction to release. Revocation writers must acquire the **matching exclusive advisory lock in their own transaction BEFORE deleting membership**. The injected adversarial test verified:

- Revocation's **commit timestamp followed the protected server write timestamp**. No further application socket writes occurred after revocation commit; remaining HTTP 200 body is intentionally truncated and Content-Length detects it.
- A deliberate stall inside the protected section was automatically aborted after **300 ms**; an exclusive revocation writer committed after **292.1 ms** in the final CI trial. The local test used a 600-ms socket timeout and bounded injected event wait. It **does not prove** a hard worst-case timeout for arbitrary OS/kernel/network stalls, database connection failures or thread cancellation.
- These guarantees **require all revocation writers to use the same exclusive lock**; uncooperative SQL code bypassing the protocol can revoke mid-write. Database privilege enforcement/RPC-only writes is **not implemented or verified**.
- The PostgreSQL lock protects **application-level calls to write**, not delivery from kernel/network buffers. Bytes queued before commit can arrive afterwards. No app protocol can retract them; strict zero-*delivered*-bytes-after-commit remains unproven and needs an explicit authorization semantics/SLA design.
- Locks are held **per chunk rather than across entire slow-client stream**, reducing writer delays in the controlled test. PostgreSQL writer fairness/starvation under sustained hundreds of concurrent streams and forced rollback in real regions remains unproven.

**Production verdict: NO-GO**, even though the controlled block-write and bounded artificial stall tests pass.

## Real full original report/export HTTP performance

Disposable PG17 source rows: **20,664**, including 10,000 historical events per company. The original unmodified GitHub SQL RPCs produce report + full 10,000-row JSON export per company, `2,793,510` bytes uncompressed. Precomputed gzip level 3 is sent intact (hash verified) via two OS-process replicas behind a loopback router, with 20 admitted active clients per replica. Initial prewarm rebuilds the full RPC twice per replica; not charged to warm HTTP P99.

| final bounded-fence job | P95 | P99 | Passed full HTTP 200 | gzip wire egress | raw JSON equivalent |
|---|---:|---:|---:|---:|---:|
| 100 clients, ready endpoint | **2,545.576 ms** | **2,584.553 ms** | 100/100 | 35,098,550 bytes | 279,351,000 |
| 300 clients across in-flight cutover and rollback | **6,946.036 ms** | **7,104.182 ms** | 300/300 | 105,295,650 bytes | 838,053,000 |
| **400 total** | — | — | **400/400** | **140,394,200** | **1,117,404,000** |

Of the 300 requests, **46** were assigned to OLD before cutover, **30** to NEW during cutover and **224** to OLD after rollback (at least 80 explicitly held until rollback). No routing errors. This is **two OS processes on ONE ephemeral runner**, not two hosts/regions.

Separate genuine cold, uncompressed full-report SQL regression on another runner: 100-client P95/P99 **12,794.408/12,821.674 ms**; 300-client **16,307.397/16,438.317 ms**. Four full original SQL reconstructions per cold wave with singleflight. Cold and bounded-fence warm runs are **not a controlled apples-to-apples performance comparison**.

## Auth SQL versus latency tradeoff

- In the final bounded-fence job, two processes recorded **2,811 successful chunk/admission membership checks** and **2,811 shared-lock acquisitions**, i.e. at least **5,622 core SQL instructions** for the 400-client full gzip waves and the additional revocation/restore probes. This count excludes `SET LOCAL`, `SET ROLE`, claim `set_config`, transaction begin/commit, report-building SQL, writes and other QA setup. **Actual PostgreSQL SQL count is higher.**
- Previous 30-second shared outbox background reconciliation was projected at **172,800 reads per 30-day month** across two replicas, independent of tenants; the bounded-fence HTTP job itself did NOT run that same background reconciler, so its reported 5,622 instructions must not be conflated with measured background traffic.
- Rechecking a membership row every smaller chunk avoids lock coordination but still suffers a check-to-write race. Taking a **single shared lock across an entire stream** uses fewer SQL checks but can hold revocation commits for an unbounded period on slow clients: prior QA deliberately reproduced revocation lock timeout. **That full-stream lock is unsafe for immediate revocation.**
- New per-chunk shared lock limits the tested writer's stall but increases SQL instructions and HTTP latency; the previously measured no-fence gzip 300-client P99 was approximately 4 seconds on a different runner, versus **7.10 seconds** here. Not a causally controlled hardware-equivalent speed comparison.
- A strict zero-byte-after-*network-delivery* goal is technically different from zero server write-calls after commit; no production authorization contract was established.

## Durable replay, true multiprocess publishers/consumers and injected crash matrix

The new lightweight crash matrix is a **separate disposable PG17 schema**, so its small storage values cannot be interpreted as the 20K-event historical report storage:
- **Before producer commit:** explicit transaction abort leaves no event, mutation, or receipt; an aborted `IDENTITY` creates legitimate nonconsecutive event IDs.
- **Producer immediately after commit but before any notification/ack:** hard OS-process exit code 81; persisted outbox event was recovered.
- **Consumer immediately after reading but before receipt:** forced code 82; restart replays exactly once.
- **Consumer after inserting receipt but before checkpoint transaction commits:** forced code 83; transaction rolls back; restart replays exactly once.
- **Consumer after receipt+checkpoint COMMIT but before acknowledgement:** forced code 84; restart sees persisted checkpoint and **does not reprocess** that event.
- **Two real publisher OS processes** (distinct PIDs 2946, 2945 in the final CI) issued **eight committed events [4,5,6,7,8,9,10,11]** while **two independent consumer OS processes replayed concurrently**. Both saw the identical ordered list without durable receipt duplication. `LISTEN` loss was injected, and later durable replay caught up.
- PostgreSQL global advisory transaction sequencing applies only to cooperating writers and may serialize commits; throughput/writer contention across true hosts and noncooperating writers remain production blockers.
- Crash-matrix PG17 DB was **9,049,779 bytes**, outbox storage **49,152 bytes**, checkpoint and processed receipt relations **24,576 bytes each**, WAL delta for this tiny fixture **4,824 bytes**.

The independent full commercial HTTP test (job `124905699773`) also passed six concurrent publishers and two consumer-process replayers on the 20,664-row historical fixture, with **46 durable receipts** and checkpoints at event 26, and rejection of stale commercial revisions by full JSON HTTP. The previous test had also demonstrated a real refused PostgreSQL TCP connection after pausing an HTTP stream, returning 503 without finishing the body; it was rerun successfully here through job `124905699805`.

## Storage, RAM, WAL, GETs and egress — measured from final CI

| Metric | Bounded stream + 100/300 warm gzip | Full commercial outbox race | Cold remote AES job |
|---|---:|---:|---:|
| PG17 DB size incl. indexes | **21,821,107 bytes** | 22,001,331 | 21,903,027 |
| Historical playback source index bytes (included in DB) | **9,805,824 bytes** | 9,805,824 | 9,805,824 |
| PostgreSQL WAL bytes **after** 20K rows inserted | **215,664** | 512,584 | 505,328 |
| Per-worker Python max RSS, KiB | **72,036 / 71,920** | separately recorded | separately recorded |
| QA parent max RSS, KiB | 183,524 (not total host RSS) | separately recorded | separately recorded |
| External encrypted manifest HTTP GETs | 0 (not used) | 0 | **1 GET, 168 bytes** |
| External encrypted manifest HTTP PUTs | 0 | 0 | **4 PUTs, 680 bytes** |

The AES job uses **a separate process** serving tiny encrypted synthetic manifest files over loopback HTTP. It force-kills the object service between a corrupted staging PUT and immutable versioned successful publication; validates SHA-256, AES-GCM, durable outbox, ready marker and restore. These are **not actual remote Supabase Storage GETs or media egress costs**. Historical ingestion WAL was sampled only *after* the initial 20K synthetic events were inserted; no full WAL ingestion claim is made. Postgres itself, kernel buffers and other processes are not included in per-worker RSS.

### 30-day cost scenarios (engineering arithmetic, NOT provider billing)

Assumptions: one full 350,985.5-byte gzip report per client each day for 30 days; about seven membership checks and seven shared-lock calls per report, 2 preheated replicas, optional 30-second shared outbox reconciliation of one SQL check per replica, no retries, connection pooling costs, media/images, ingest, real Supabase plan, or compression variability.

| Model per 30 days | 100 clients | 300 clients |
|---|---:|---:|
| gzip full report egress | **1.053 GB** | **3.159 GB** |
| Core per-chunk auth + shared lock SQL calls (14/report) | **42,000** | **126,000** |
| Optional two-replica 30-second outbox polling | 172,800 | 172,800 |
| **Core modeled SQL calls subtotal** | **214,800** | **298,800** |

Actual SQL cost will be **higher**, due to session claim config, transactions, RLS queries and regular playback/backend work. **No estimate of reais or Supabase Free suitability is confirmed**, and no official usage/Billing was accessed.

## Hard production NO-GO gates

1. Prove/enforce that *every* JWT membership, commercial revocation and key-rotation writer cooperates with the correct exclusive fence using minimum privileges and audited stored procedures. No direct UPDATE/DELETE bypass allowed. The QA has not demonstrated this requirement.
2. Formally define revocation semantics: no application write calls after revocation commit versus impossible-to-retract prequeued bytes delivered after commit; network buffering and stalled kernel sends need a full security SLA.
3. Prove revocation latency caps under real slow streams and reconnecting multi-host partitions; a 300ms injected wait is not a global guarantee. Long-term PostgreSQL connection pool contention/starvation under 100/300 sustained clients still unverified.
4. Test true multi-host/region publishers, durable outbox locks, uncooperative writers, long rollbacks and write contention without a single global bottleneck.
5. Actual Supabase Auth/JWKS, RLS/SECURITY DEFINER, external encrypted object store/KMS, 7/30-day index/WAL growth, real TV media egress and provider costs have NOT been inspected/tested.
6. Cutover tests use two processes on one runner, not two physical hosts; cold performance still has multi-second P99.

**Scope guard:** No official Supabase (even read), APK, Vercel/site, panel, TV, production data/history, main branch or deployed infrastructure was queried or changed. Only selected GitHub experimental branch and ephemeral PostgreSQL17 GitHub Actions tests. **PRODUCTION NO-GO.**