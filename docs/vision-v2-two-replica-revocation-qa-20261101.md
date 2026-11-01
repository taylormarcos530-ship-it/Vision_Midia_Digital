# Vision V2 — Isolated two-replica commercial-result invalidation and JWT revocation QA

Date: 2026-11-01 UTC. Branch: experiment/vision-v2-sequence-watermark-qa-20261031.
Tested commit: 3e6a4b1b56158ae9bc82b931d2e1053f3d9247c2.

## Immutable references / final verdict

- GitHub Actions two-replica PG17: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41267713659 (completed, success, both jobs PASS).
- GitHub Actions sequence/offline: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41267713655 (completed, success).
- Regression cache matrix after fail-closed compute hook: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41267444596 (completed, success).
- Original prior cache benchmark: https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41266065741 (completed, success).
- **GO for isolated QA only. NO-GO for production.**
- No production Supabase, APK, panel, Vercel/site, TVs, or real histories queried/modified.

## What was tested (scope matters)

Two independently listening loopback HTTP server instances, each with independent result cache, decrypted segment cache, and dedicated PostgreSQL LISTEN connection, running **inside a single Python process** on one GitHub runner. PostgreSQL 17 is an ephemeral service; both source SQL RPC definitions are installed from the GitHub repository, and their **full JSON report + paginated export** is validated against the synthetic reference. The source contains 664 immutable synthetic playback events and 276 daily groups. The encrypted archive contains 10 AES-256-GCM segments. No second permanent event read-model table.

Database transaction atomically increments per-tenant revision, updates synthetic account ACL as applicable, and calls pg_notify. Each listener invalidates its tenant cache upon receiving the message. Listener startup/restart reads the durable revision and ACL snapshot once; a manually stopped listener fails closed with HTTP 503. After both listeners observed a revoke, new requests were denied HTTP 401, with no success ACK. A racing cache fill verifies revision and ACL before ACK and returns HTTP 503 if invalidated mid-flight.

This is a **synthetic JWT/ACL simulation, not actual Supabase JWT revocation**. Missed LISTEN notifications, silent half-open network partitions, and real cross-process orchestration are not fully covered.

No periodic SQL polling: in each quota cohort, **6 snapshot SELECTs** for listener startup/restart, **19 NOTIFY events received** in aggregate between both listeners, **0 extra revision SQL reads per HTTP request**, **0 polling SQL queries**. This excludes the SQL RPC computations on cache misses. Event loss/ordering across separate failure domains needs further testing.

## Final test — 2 HTTP replicas, 300 concurrent requests, warm phase

| Per-company result & segment quotas | P95 HTTP ms | P99 HTTP ms | Archive GETs (phase) | SQL cache misses (phase) |
|---|---:|---:|---:|---:|
| 110,000 bytes | 2,448.671 | 2,745.032 | 105 | 96 |
| 512,000 bytes | 941.441 | 1,072.266 | 20 | 32 |
| 2,000,000 bytes | 99.276 | 101.091 | 0 | 0 |

- 12 cold/warm HTTP phases in total, 100/300 clients at each of three quotas: **2,400 successful HTTP queries** with full report/export hash parity.
- Six additional revocation-during-flight phases (100 and 300 clients at each quota): **1,200 in-flight HTTP queries** (including expected HTTP 503 and already-authorized HTTP 200); all additional *new* requests tested after both listeners observed revocation returned HTTP 401.
- Race 110K: 100 clients 20x200/80x503; 300 clients 65x200/235x503.
- Race 512K: 100 clients 20x200/80x503; 300 clients 65x200/235x503.
- Race 2M: 100 clients 24x200/76x503; 300 clients 52x200/248x503.
- **0 queue timeouts**. Maximum concurrent active PG tasks was 12 **per replica**. Queue maximum was 11/11/12 respectively, for 110K/512K/2M.
- Security preflight PASS for tenant isolation with native PG17 RLS, original RPC membership checks, synthetic JWT signature/expiry/cross-tenant, TTL, fail-closed listener, restoration of lost notification from DB snapshot, archive failure 503 with no ACK and recovery.
- Total archive GETs across all quota cohorts, phases, revocation bursts and preflights: **638**. This is NOT comparable directly to the previous 398-GET single-instance matrix; two instances, extra 1,200 revocation requests, and workload timing differ.
- Measured process maximum RSS: **151,032 KiB** (~147.5 MiB). This is Python process RSS, NOT PostgreSQL resident memory or cluster memory.
- Disposable database bytes: **13,514,419**. Indexes already included: source history **335,872 bytes** and daily CQRS **16,384 bytes**. No measured net savings versus baseline retained-event schema, and no real paid storage rate measured.
- Performance is a synthetic snapshot only, not an SLA or prediction of 300 real TVs. Caches still have per-replica memory and no shared eviction semantics. An event notification may arrive after its transaction commits; this test does not establish real-world zero-window revocation.

## Limitations before production

1. Test **two real processes/hosts** with independently failing LISTEN connections and a bounded fail-closed freshness/lease strategy for silent partitions, without excessive polling.
2. Provide a production-grade revision/ACL change source with durable event/outbox semantics, authenticated notifications and cross-instance recovery. Do not assume that NOTIFY is a durable message queue.
3. Integrate actual Supabase Auth/JWT membership revocation (synthetic is insufficient), role changes, signing-key rotation, and TTL/expiry while serving cached results. Ensure session/tenant checks on every hit with bounded database load.
4. Validate **actual campaign/device/media changes** and exact JSON parity under matching revision with multiple processes, including revocation during a SQL miss and event ordering. Current revision bumps leave fixture commercial content unchanged.
5. Measure source/summary/manifest/index growth, RAM (all services), IOPS, WAL, 24h and 7d history, p95/p99 and GETs at realistic 100/300 TV/client concurrency, with an explicitly modeled Supabase Free limit and a real external object store/KMS.
6. Preserve audit proofs and original RPCs; no deletes or production migration. The test artifact contains a synthetic AES key, not production key management.

Conclusion: functional isolated two-replica QA PASS; production **NO-GO**. Next gate is separate-process notification liveness and real ACL/contents revision integration with production-like topology, still without production access.
