# Vision V2 — PG17 minimum privilege, revocation priority, real socket timeout, chunk-size 16/64/256 KiB

**Date:** 2026-11-01. **Branch only:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Starting HEAD:** `7d98de4d0945c7572a8bc2550d48ab747282b197`. **Last tested code SHA:** `1a0cf4e0f0948db3c95ee9f25af2e483769b2e40`.
**Decision:** **7/7 PG17 CI jobs PASS (for tested cases); GO for further isolated QA, PRODUCTION NO-GO.**

## Exact CI evidence

- [Final 7-job GitHub Actions run 41328338880](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41328338880), source SHA `1a0cf4e0`, SUCCESS; seven independent ephemeral runners/databases:
  - `124912912207`: minpriv FORCE RLS, forbidden direct writes, revocation priority under 300 queued chunks, actual Linux socket send timeout — PASS.
  - `124912911978`: **16 KiB** full original report/export HTTP 100/300, protected writes, forced revocation, cutover/rollback — PASS.
  - `124912912107`: **64 KiB** same test — PASS.
  - `124912912204`: **256 KiB** same test — PASS.
  - `124912912165`: durable outbox checkpoint crash matrix; 2 OS publisher processes and 2 OS consumer processes — PASS.
  - `124912912278`: commercial HTTP replay with six publishers/two consumers plus explicit **FAIL of unsafe** auth/write strategy — PASS test suite.
  - `124912912175`: remote-simulated HTTP AES-GCM manifest partial PUT, forced process restart, cold 100/300 complete JSON HTTP — PASS.
- [Independent original sequence/offline QA 41328273414](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41328273414) succeeded at the privilege QA source commit; additional sequence runs preserved. This is not a test of the new role's implementation.

## Minimum-privilege roles — synthetic PostgreSQL17 only

Created three test roles in disposable PG17: `qa_v2_guard_owner` (NOLOGIN), `qa_v2_stream_login` (LOGIN, NOINHERIT, no superuser/DB/role creation), `qa_v2_revoke_login` (same restrictions). Guard relations `identities`, `memberships`, and `fences` use **FORCE ROW LEVEL SECURITY** with a policy granting the dedicated SECURITY DEFINER owner access but no direct table grants to caller roles. Function EXECUTE is explicitly revoked from PUBLIC. Role identities are derived from immutable PostgreSQL `session_user` mapping, not a user-provided claim argument.

**22 negative privilege attempts were correctly denied**, including direct INSERT/UPDATE/DELETE membership, bypass of the revocation-pending flag, identity changes, role escalation to owner/administrator, cross-tenant access, calling the other actor's SECURITY DEFINER function, and attempting original private membership access. Forged `request.jwt.claim.*` GUCs did not change the role-bound identity.

This tests **limited synthetic login roles**, not true production Supabase Auth/JWKS, RLS setup, security invoker/definer topology or a service-role credential. A real superuser/DB owner can bypass protections, and other uncooperative revocation SQL paths are not automatically blocked. Production needs audited ownership, permitted RPCs, RLS and precise database-privilege controls, not a simple copy of this fixture.

## Persistent priority for revoke and 300 slow streams

The revoker function commits a persistent `pending=true` flag BEFORE seeking an exclusive PG transaction advisory fence. Each new protected stream chunk acquires the matching shared lock and checks membership plus pending. A pending or revoked tenant fails closed. The real test submitted **300 slow chunk attempts** through at most **24 simultaneous PostgreSQL connections**, with an actual revoker competing:

- 4 chunks already authorized before revocation intent; **296 denied** while intent pending or after revocation.
- Revocation exclusive-lock commit latency **122.971 ms**; **zero unexpected connection errors** and no observed starvation in this local test.
- This is **300 queued chunk attempts, not 300 simultaneous database sessions**; session caps/host/network load differ from a 300-TV system.

## Real kernel socket timeout while shared lock held

A Linux `socketpair` uses an intentionally tiny send buffer, a non-reading receiver, and a large `sendall` while a dedicated stream login holds the PG advisory shared fence. The actual kernel write hits a socket timeout at **140 ms**. The DB transaction and lock release, permitting revocation commit in **113.122 ms** (measured writer path), with ~154 ms total wall time in this test. No infinite stall observed.

This is a real local kernel socket timeout, not a real inter-host TCP half-open, packet loss or production load-balancer failure; no proof of universal 140-ms cancellation under arbitrary OS, process or DB failure. Stream bytes queued to the kernel before revocation cannot be retracted.

## Actual complete HTTP 100/300 with 16, 64 and 256 KiB blocks

Each independent job uses a separate disposable PG17 `postgres:17-alpine`. It creates **20,664 synthetic playback events** including 10,000 historical events/tenant; executes the unmodified source report/export SQL; every completed HTTP response is **the entire original report and 10k-row export, gzip level 3**, verified by SHA-256. Two real HTTP OS processes behind same-runner loopback router, with 20 admitted active sessions each, prewarmed before wave. The 300-client wave crosses an actual cutover and rollback while in flight and has at least 80 post-rollback assignments. **No two physical/remote hosts**.

| Chunk bytes | 100 P95 | 100 P99 | 300 P95 | 300 P99 | Core SQL auth+shared lock instructions for 400 client tests |
|---|---:|---:|---:|---:|---:|
| **16,384** | 12,154.877 ms | **12,194.013 ms** | 32,170.404 ms | **33,042.722 ms** | **18,454** |
| **65,536** | 3,662.449 ms | **3,714.801 ms** | 10,060.725 ms | **10,311.709 ms** | **5,622** |
| **262,144** | 1,694.878 ms | **1,784.155 ms** | 5,302.406 ms | **5,365.553 ms** | **2,414** |

All three configurations: **100/100 + 300/300 HTTP 200 PASS**, total full gzip egress **140,394,200 bytes** (vs raw JSON **1,117,404,000 bytes**) for the two waves, independent of chunk size. Each job also passed a controlled revoke occurring during protected socket write; the commit followed the protected first write, with **zero additional application writes after revocation commit**. Each job also aborted an injected 300-ms stalled stream, and the competing revocation committed after **292.8/293.1/293.2 ms** for 16/64/256 KiB respectively.

**IMPORTANT:** The SQL instruction counts are **minimum core counts**, not every PostgreSQL query. Each protected block additionally needs transactions, session role/claim setup, connection handling and the original report RPCs. The varying benchmark results are from **different parallel GitHub runner instances**. The pronounced SQL-count reduction is structurally due to fewer chunks, but P99 differences are observations rather than controlled causal guarantees. Larger blocks can prolong a single protected send and widen kernel-buffered delivery. **Do not promote 256 KiB to production just because it is fastest in QA.**

### Actual memory, WAL, and indexes per runner

| Chunk | HTTP worker A/B max RSS | PG17 database size (incl. indexes) | Original playback indexes | Post-history WAL delta |
|---|---:|---:|---:|---:|
| 16 KiB | 71,664 / 71,796 KiB | 21,821,107 bytes | 9,805,824 bytes | 486,328 bytes |
| 64 KiB | 72,168 / 72,060 KiB | 21,821,107 bytes | 9,805,824 bytes | 486,216 bytes |
| 256 KiB | 78,720 / 71,780 KiB | 21,821,107 bytes | 9,805,824 bytes | 215,720 bytes |

Child RSS excludes PostgreSQL, QA parent and OS. WAL was sampled only AFTER inserting the historical 20K rows and cannot be extrapolated as ingest cost. WAL differences between independent job runners must **not** be attributed causally to HTTP chunk size; this HTTP stream has no historical event writes.

## Durable replay, authorization negatives and remote AES regression

- **Four** actual process crashes in separate PG17 fixture: writer after commit but before notify, consumer after read but before receipt, consumer after inserting receipt but before checkpoint transaction commit, consumer after committed receipt/checkpoint but before acknowledgment; a further forced writer transaction abort. Recovery correctly resumed from durable checkpoints, with no duplicate processed effects. PostgreSQL IDENTITY gaps after aborted commits were accepted.
- **Two independent publisher OS processes** and two persistent consumer OS processes overlapped. Committed IDs **[4,5,6,7,8,9,10,11]** were replayed in identical order by both consumers; durable outbox test job had **4,824 WAL bytes**, **49,152-byte** outbox relation, and **24,576-byte** receipt and cursor relations (no 20K events loaded in this lightweight job).
- Commercial HTTP full report/export replay with 6 overlapping publisher threads and two consumer OS processes validated campaign name/revision and stale-cache blocking. Its negative control deliberately leaked **16,384 compressed bytes post-revocation** with authorization once before write; a controlled recheck after injected pause had **0** post-commit bytes, but cannot prove a universal zero gap.
- The independently rerun PostgreSQL authentication TCP-refusal fixture stopped in-progress streaming, blocked new requests, and recovered after reconnect.
- Separate AES-GCM manifest HTTP process was force-killed/restarted after partial corrupted upload, before immutable READY publication: **four PUTs totaling 680 bytes; one GET of 168 bytes**. This is a **tiny synthetic encrypted manifest, not TV video/media GET counts**.
- True cold/uncompressed HTTP full 100-client P95/P99 **12,978.858/12,997.980 ms**, 300-client **16,387.914/16,449.167 ms**; four full original SQL report/export builds per cold wave, coalesced per company/replica. This is not the same benchmark as the prewarmed gzip matrix.

## Projected 30-day cost by chunk (not verified provider billing)

Assume exactly one 350,985.5-byte full gzip report per client **per day** for 30 days and two replicas doing one *optional* outbox revision probe every 30 seconds = 172,800 SQL calls/month. Core stream SQL model is **2 × (1 + ceil(gzip report size / chunk))** instructions per full export (admission + blocks, shared-lock and membership-check); does not include SET ROLE, claims, transactions, SQL reports/misses, user activity, image/video downloads or retries.

| Per 30-day modeled scenario | 100 daily clients | 300 daily clients |
|---|---:|---:|
| Report gzip egress | **1.053 GB** | **3.159 GB** |
| **16 KiB** core stream SQL instructions | 138,000 | 414,000 |
| **16 KiB** plus optional shared reconciliation | **310,800** | **586,800** |
| **64 KiB** core stream SQL instructions | 42,000 | 126,000 |
| **64 KiB** plus optional shared reconciliation | **214,800** | **298,800** |
| **256 KiB** core stream SQL instructions | 18,000 | 54,000 |
| **256 KiB** plus optional shared reconciliation | **190,800** | **226,800** |

**These are synthetic engineering projections, not actual Supabase Free quotas, Supabase cost in BRL or real media egress.** Backend SQL count and connection costs are higher.

## Hard NO-GO blockers

1. **Strict zero-delivered-bytes-after-commit security is still not proven**: locks protect server-side write calls but bytes already buffered may arrive later. Formal revocation semantics and audit are required.
2. All real production revocation writers must be forced to use the same exclusive fence; synthetic minimum roles and FORCE RLS aren't proof of the real Supabase role/SECURITY DEFINER/JWKS setup. A superuser/privileged bypass remains possible, and direct role mappings are not deployable production auth.
3. The 24 concurrent PG sessions and actual loopback socket timeout do not establish 300 live device TCP sessions under physical inter-host network failures, post-write buffering and long-term starvation.
4. The faster 256 KiB chunk still needs writer-latency bounds under real slow clients; under congested networks its large locked write could violate a defined revocation SLA. PostgreSQL pool constraints and RLS policies have not been verified in production.
5. Outbox global advisory write serialization, receipt retention/WAL 30 days, remote object store/KMS and 100/300 live TV media bandwidth/GETs have not been validated on physically independent hosts.
6. No real cost in reais or suitability for Supabase Free is established.

**Strict restriction adhered to:** No official Supabase (even read-only), deployed API, GitHub main, APK, site/Vercel, panel, TV, real user history or production database accessed or modified. Code only in the chosen experimental GitHub branch and disposable PG17 Actions. **NO DEPLOY. NO-GO production.**
