# Vision V2 — 2026-11-01 isolated PG17 publisher/consumer race, full commercial HTTP and revocation pre-write gap

**Scope:** only branch `experiment/vision-v2-sequence-watermark-qa-20261031`, from commit `6296dc7d6b446604723344324383ae90a2e1e313`. **Last tested code SHA:** `f32a5e6741fa637561c4311816ce983d36e2c572`. **Verdict: synthetic QA PASS; go for further QA only; production NO-GO.**

## Auditable GitHub Actions

- [Final run 41322672208](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41322672208): **3/3 jobs SUCCESS**, from `f32a5e67`.
  - `124896021886`: concurrent 9 publisher threads with 3 intentional rollbacks, plus **6 additional simultaneous publishers and 2 independent consumer-process replay loops**, complete original report/export HTTP with commercial revision parity, and explicitly unsafe vs gated auth-to-write negative race.
  - `124896021910`: full gzip JSON 100/300 clients crossing real in-flight OLD→NEW→OLD cutover and rollback with 80+ post-rollback requests.
  - `124896021631`: cold full export HTTP 100/300, ephemeral HTTP encrypted AES-GCM manifest, forced remote service restart, outbox retry and JWT/RLS synthetic regression.
- [Sequence/offline run 41322672218](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41322672218): **SUCCESS** same SHA.
- [Initial 3-job run 41322477959](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41322477959): **SUCCESS** before adding true writer/consumer overlap. Its results are not substituted for the final overlapping QA.

## Publisher/consumer concurrency and cache invalidation

- Synthetic outbox append and commercial name/revision mutation share an atomic PG17 transaction. A producer uses `pg_advisory_xact_lock` before allocating its identity ID to preserve **commit order among cooperating writers**; this can introduce contention and fails if a future writer bypasses the lock.
- In the first stage, 9 publisher threads attempted 18 mutations, with 3 forced aborts and **15 committed events**. Nontransactional IDENTITY leaves valid gaps following rollback. A process was then killed **after DB commits but before replay**; restarted OS consumer reloaded its persisted checkpoint and processed the missing events once.
- Next, **6 concurrent publisher threads and 2 independent live OS consumer processes** ran together. Each consumer performed 16 repeated durable outbox reads while changes committed, observing nonempty batches in **5** reads apiece. Both independently processed committed IDs **21,22,23,24,25,26** in order, without duplicate effects.
- Persisted checkpoints ended at `(consumer0,26)` and `(consumer1,26)`, with **46 durable processed receipts**, exactly 23 committed events × 2 consumers. A revoked/out-of-date commercial cache returns HTTP **503** until the replay is processed; the unaffected company remains readable in previous tests. After replay, both processes returned complete compressed HTTP report/export JSON (10,000 historical event rows per company) with the new campaign name and current revision.
- This is a **two-process, same-runner** fixture and uses SQL revision checks per commercial request. It does not establish multi-host outbox sequencing, permanent scalable subscriber transactions, or production database capacity.

## Security: controlled race *after* SQL approval but *before* sending HTTP bytes

- Test deliberately waits until the last authorization SQL succeeds, then commits synthetic membership revocation in PostgreSQL before releasing the first chunk.
- **FAIL — unsafe one-check-before-write design:** leaks **16,384 compressed bytes after revocation commit**. A later chunk check cannot retrieve already-delivered bytes.
- **PASS — second authorization check after controlled barrier:** **0 bytes after commit** in this injected test. JWT and member status checked in synthetic DB; the stream is truncated on denial (HTTP 200 headers may already be sent).
- **NOT proven:** instantaneous revocation for every possible interval **after the final re-check and before the actual socket write**. This proof does not make zero leakage universally guaranteed. Real Supabase Auth/JWKS, SECURITY DEFINER and independent network partitions remain untested.
- Previous independent PG17 negative test [41319192983](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41319192983) verified a refused PostgreSQL TCP auth connection interrupts a pending stream and denies new requests, restoring on reconnect. That driver-level failure was **not re-run** in this three-job code SHA; do not conflate with live PG server shutdown.
- A 1-SQL-per-stream shared PostgreSQL advisory-lock alternative from earlier QA prevents concurrent revocation commits but **can delay or fail revocation if a client stalls**; it remains unsafe for immediate revocation and was not rebenchmarked at 300 clients.

## Full gzip HTTP 100/300: final same-SHA independent runner

| Workload | P95 | P99 | Responses | gzip egress | Raw bytes |
|---|---:|---:|---:|---:|---:|
| 100 while replacement warms | **1,613.536 ms** | **1,672.770 ms** | 100/100 HTTP 200 | 35,098,550 | 279,351,000 |
| 300 across in-flight cutover and rollback | **3,934.470 ms** | **4,016.527 ms** | 300/300 HTTP 200 | 105,295,650 | 838,053,000 |
| **Total** | — | — | **400/400** | **140,394,200** | **1,117,404,000** |

Router log confirms **34 OLD requests before switch**, 30 NEW requests and **236 OLD requests after rollback** (including at least 80 held until the rollback). Max admitted HTTP simultaneously 20 per process. 20,664 original synthetic events remain; each full response has original report plus 10,000-row export. Everything runs on one ephemeral GitHub Actions runner, **not two physical hosts**. Two report builders were prewarmed before serving the wave, so this is not a 300-independent-uncached-SQL benchmark.

The independent **cold/uncompressed** job had P95/P99 **8,349.151 / 8,368.307 ms** at 100 and **10,178.400 / 10,273.765 ms** at 300, with 4 original RPC rebuilds per wave and singleflight. Different runners and workloads mean no causal head-to-head speedup claim.

## SQL, storage, WAL, RSS, object requests and 30-day scenarios

| Measured | Publisher/consumer race + full commercial HTTP | Rolling 100/300 | Cold AES remote QA |
|---|---:|---:|---:|
| PG17 database bytes, indexes included | **22,001,331** | 21,853,875 | 21,903,027 |
| Original playback indexes | **9,805,824** | 9,805,824 | 9,805,824 |
| WAL bytes after initial synthetic history insertion | **242,032** | 216,736 | 235,024 |
| QA report server RSS, process A/B | **74,428 / 75,176 KiB** | **70,748 / 67,576 KiB** | 84,340 / 83,924 KiB |
| Successful chunk auth SQL | **96 + 117** (small HTTP/cache/race fixture) | **1,110 + 108** (400 loads plus security probes) | 432 + 400 two-check guard |
| Background replay/reconcile SQL calls | **19 + 20** during 16-step overlap loops | **3 + 4** | not comparable |
| Remote encrypted object GETs | not exercised | **0** | **1 GET**, 168 bytes |
| Remote encrypted object PUTs | not exercised | 0 | **4 PUTs**, 680 bytes |

DB size includes indexes/outbox; WAL excludes loading 20,000 synthetic historical events; Python process RSS excludes PostgreSQL, runner and other processes. The small AES-GCM encrypted manifest GET is **not a measurement of playback-video or image GETs**. Egress for complete report JSON was actually measured, but hosting/media egress and cash price were not.

**30-day model**, 100 vs 300 report consumers: assume one full report per day per client; gzip ~350,985.5 bytes per report. Two replicas × one durable outbox MAX-ID SELECT / 30s = **172,800 scheduled background operations per 30 days** (not measured for a month). For ~3 to 24 SQL authorization checks per report, based on implementation chunk sizing and mixed successful/report race measurements:

| Cost model | 100 clients | 300 clients |
|---|---:|---:|
| Reports/month | 3,000 | 9,000 |
| Full gzip JSON egress | **1.053 GB** | **3.159 GB** |
| Background outbox lookups | 172,800 | 172,800 |
| Auth SQL checks, 3–24 per report | **9,000–72,000** | **27,000–216,000** |
| **Combined background + auth SQL** (excluding report rebuild, writes, media, retries, other queries) | **181,800–244,800** | **199,800–388,800** |

Those are **engineering estimates only**, not Supabase Free quota availability or R$ cost. Background budget drops materially versus the previous 2-second per-company watcher but SQL authorization at every 16 KiB chunk would be costly in production.

## Remaining release blockers — NO-GO

1. No universal zero-byte revocation guarantee after the last SQL check and before a socket write; the deliberately unsafe case leaked actual post-commit bytes. Need formal revocation SLA and threat-model-complete end-to-end design, not simply fewer authorization SELECTs.
2. Consumer checkpoint concurrency, producer lock contention under high write rate, escaped/noncooperating publisher and crash between every application-side step require long-running multi-host verification.
3. Two independent *physical* hosts, real PostgreSQL/network partitions, genuine Supabase Auth/JWKS/RLS and production-grade KMS/object store were **not** accessed or tested.
4. A meaningful sustained 100/300 actual TV workload (media downloads, pairing/heartbeat, object egress, index retention, WAL generated by all events and full cluster RSS), plus actual current Supabase plan costs, is still missing.
5. Existing QA's 30-second heartbeat/reconciliation budget is not an approved production setting. No OTA APK, TV, panel or site changes.

**NO-GO** — This turn did **not** query Supabase official even in read mode, did not run SQL on live service, did not publish, modify any TV/APK/panel/site or delete real history. All code and report changes were isolated to this user-selected GitHub branch and GitHub Actions disposable database.