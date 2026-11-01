# Vision V2 — PG17 QA: 300 full JSON HTTP across live cutover + rollback, low-poll outbox and authoritative streaming RLS

**Date:** 2026-11-01. **Branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`.
**Requested starting HEAD:** `d81b6743e5c593aacbb35f2f3c1d12fb209b0ce0`.
**Last code SHA tested:** `fa17def78968919849ad7fac5a23f7f48f98082a`.
**Decision: PASS in isolated QA; GO to continue isolated QA; STRICT NO-GO production.**

## Verified GitHub Actions logs — no deploy

- [Final run 41317470747](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41317470747), SHA `fa17def78968919849ad7fac5a23f7f48f98082a`: **2/2 PASS**, in-flight 300-client cutover + rollback with post-rollback barrier, PostgreSQL17 synthetic JWT/RLS and outbox; independent remote AES-GCM crash/recovery with original RPC cold 100/300. Jobs `124880466348` and `124880466203`.
- [Previous first PASS 41317309280](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41317309280): 2/2 PASS at `d13923c9`. A follow-up test strengthened the proof to require **at least 80 post-rollback** HTTP requests, rather than only validating that both hosts served some traffic.
- [Sequence/offline regression 41317470790](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41317470790): inspect actual conclusion in GitHub if needed; independent workflow.

## Scope

Only ephemeral GitHub Actions runner and disposable `postgres:17-alpine` with exact database name `vision_v2_quarantine_disposable`. Original GitHub commercial report/export SQL functions ran unmodified on synthetic data: **20,664 source events** including **10,000 historical records for each of two companies**. Two independent process PIDs `2893` and `2899` hosted complete per-company gzip report/export JSON. RLS policies for eight surviving synthetic tables were strengthened in the disposable database only; this is **not a verification of official Supabase RLS**. No real objects, JWTs, apps or histories.

## HTTP measurements: guaranteed real in-flight cutover and rollback

An existing ready HTTP replica served 100 clients as the second replica prewarmed. After both were READY, **300 actual client tasks were submitted concurrently**. A test barrier held 80 requests until after an OLD -> NEW -> OLD routing transition. All 300 received complete original JSON export with gzip and validated SHA-256.

| Cohort | P95 ms | P99 ms | Complete gzip payload | Status |
|---|---:|---:|---:|---|
| 100 while replacement warming | 2,037.551 | **2,054.769** | 35,098,550 bytes | 100/100 HTTP 200 |
| 300 across real cutover and rollback | 5,129.343 | **5,623.299** | 105,295,650 bytes | 300/300 HTTP 200 |
| Total | — | — | **140,394,200 bytes** | 400/400 |

Evidence of exact timing: 37 OLD assignments before first cutover, 34 NEW assignments during switch, and **229 OLD assignments after rollback**; at least 80 explicitly released after rollback. No routing errors; both processes served. This is same-runner two-process routing with loopback, **not** a two-host fault-tolerant deployment or Internet path benchmark. Maximum admitted HTTP active per replica: 20.

Earlier *true cold uncompressed* benchmark rerun independently in this final workflow: 100 clients P95/P99 12,699.517 / 12,751.288 ms, 300 clients 16,091.779 / **16,181.238 ms**, with **four full SQL original RPC rebuilds per cold wave**, singleflight by tenant and replica. These are separate workloads/runners: do not claim causal head-to-head speedup in cold SQL. Prewarm still costs ~12.890 and 19.829 seconds for two ready workers while the existing worker serves; **first startup with no old replica remains cold**.

## Revocation + durable outbox under deliberately silent LISTEN

- Actual synthetic PostgreSQL membership deletion was committed **in one transaction with revision increment and durable outbox event**. Artificially blackholed LISTEN during this revocation: the cache observer was NOT relied upon to approve access.
- A compressed HTTP response paused immediately after the first **16,384 bytes**. While paused, membership revocation was committed. On resume, an **authoritative synthetic PG membership SQL check** denied the next streaming chunk: **zero additional bytes delivered**. New cached-result requests were also denied.
- Background listener is only for changed-result revision maintenance. It can be stalled: **an independent 30-second reconciliation SELECT per instance** reads the maximum persisted outbox id, including missed events. The QA explicitly forced reconciliation and verified both revoke and restore events persisted and were reloaded.
- This streaming policy performs synthetic signed JWT verification and membership SQL **per block of HTTP body data** (roughly three successful SQL auth checks per gzip report in this test). **There is still a time-of-check-to-time-of-write gap inside each block**, and the tests cannot prove zero-byte instantaneous revocation during arbitrary parallel commit races. Real Supabase Auth/JWKS and all RLS/SECURITY DEFINER paths are not tested.
- Outbox notification and 30-second check are NOT trusted to grant access. Authoritative per-chunk SQL fails closed on a broken auth source rather than serving from stale in-memory membership. Production-compatible database error/partition behavior needs additional independent test.
- Evidence: 9 background reconciliation SELECTs across the two replica processes for this short test, **1,218 successful chunk-auth SQL checks** (1,098 + 120) including 400 loads and extra probes. Two initial full SQL report/export builds per replica, **four total**.

### Cost model: 100 and 300 clients over a 30-day month (not billed)

Previous QA: two replicas × two tenant membership SELECTs every **2 s** = **5,184,000 SQL checks per 30 days** before HTTP. New tested scheduler: one durable-outbox max-ID SELECT **per replica per 30 s**, independent of tenants = **172,800 scheduled SQL reads per 30 days**. This reduces modeled **background reconciliation by 96.667%**.

Separately, per-response DB membership checks remain. Assuming **3 authoritative checks per compressed export** and **one complete export/client/day** for 30 days:
- 100 clients: **3,000 reports**, **9,000 auth SQL checks**, plus 172,800 background = **181,800 modeled queries/month**, excluding RPC rebuilds, manifest, retries, notifications and other traffic.
- 300 clients: **9,000 reports**, **27,000 auth SQL checks**, plus 172,800 background = **199,800 modeled queries/month**, excluding other traffic.

The observed 400-client gzip traffic is **140,394,200 bytes** for 400 full responses. One complete compressed report is roughly 350,985.5 bytes: projected **1.053 GB/30 days for 100 daily clients**, **3.159 GB for 300 daily clients**, before videos/images or user downloads. Without compression those same reports are **8.381/25.142 GB**. **No verified BRL costs or Supabase Free approval** is possible from this isolated test.

## PostgreSQL indexes, WAL, memory and remote object GET

| Metric | Rolling + low-poll QA job | Separate remote AES/cold QA job |
|---|---:|---:|
| Disposable PostgreSQL DB after tests (bytes) | **21,853,875** | 21,903,027 |
| Source playback index bytes (included in DB size) | **9,805,824** | 9,805,824 |
| WAL delta after 20K source rows already inserted (bytes) | **216,728** | 234,888 |
| Peak Python process RSS (KiB) | **68,856 / 69,000** | not comparable |
| QA parent RSS high-water (KiB) | **187,592** | not comparable |
| External encrypted-manifest HTTP GET | Not used, 0 | **1**, 168 bytes |
| External encrypted-manifest HTTP PUT | Not used | **4**, 680 bytes |

WAL excludes initial historical insertion, parent RSS is not total cluster RAM, and the encrypted manifest was a tiny synthetic envelope on a separate HTTP process; no real media retrieval or Supabase Storage quota tested. Remote AES regression passed crash rollback, incomplete PUT rejection, version immutability, PENDING/READY, AES-GCM SHA and restart recovery.

## Unresolved production blockers — hard NO-GO

1. Cannot guarantee instantaneous revocation for bytes within the chunk between SQL authorization and socket write. Need explicit maximum revocation SLA and stronger end-to-end authorization design, real JWT/JWKS and all report paths.
2. SQL auth checks per streamed chunk remain, and low-poll outbox invalidation is not production-verified under silent multiprocess/network failure and sustained media streams.
3. Real two-host/VM load balancer routing, cutover/rollback with crashes and misrouting, reconnects, stale session handover, persistent outbox consumer checkpoints, and 100/300 sustained traffic over long duration.
4. Real remote object-storage/KMS atomic publish fencing under concurrent writers; simulated AES HTTP object process is not cloud storage.
5. Total production Free-tier budget and billing with WAL for 20K inserts, real media egress, memory, rate of GET/PATCH and source index retention.

No official Supabase even in read mode, production branch, APK, panel, site, Vercel, TV or real playback history was accessed or changed. No deployment, no SQL migration applied to production. Keep GO for QA only and **NO-GO production**.
