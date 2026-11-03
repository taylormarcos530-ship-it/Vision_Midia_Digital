# Vision V2 — 100/300 slow TCP storms and PG17 JTI witness logical restore

**Date:** 2026-11-03 UTC. **Branch:** `experiment/vision-v2-toctou-continuous-guard-qa-20261102`. **Exact base preserved:** `5246dfe62c6d04353a82e176e9a1c81ba93bb8c5`.

**Security decision: PRODUCTION NO-GO.** All extra sources are strictly experimental tests or CI workflows. Main, production Supabase, Vercel, APKs, TVs, panel, website, original WSS/TOCTOU and commercial reports were not modified. PostgreSQL17/Redis7.4 ran only in disposable GitHub Actions containers; localhost ports, synthetic certificates, company/device JWTs and data. `QA_STREAM_GUARD_GROUP=1`; drain disabled.

## Audited GitHub Actions runs

| Run | CI verification | Security interpretation |
|---|---|---|
| [41632967269](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41632967269) | **4/4 PASS**, 100/300 real TCP slow clients and 64/256 KiB | Only a local bounded-deadline result; 100/300 open connections do **not** mean 100/300 simultaneous PG lock holders |
| [41632747414](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41632747414) | **1/1 PASS of independently reproduced counterexamples**: real PG17 `pg_dump`/`pg_restore`, TCP witness path SIGKILL, two uncoordinated PG17 witness DBs, divergent Redis owner maps | **Security FAIL**: restored JWT replay, split-brain authorizers, incorrect cross-tenant device ownership, still-active legacy lease during authority path outage |
| [41628201783](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41628201783) | **7/7 PASS prior regression**: 100/300/600/1000 WSS and 46/46 Node20, 46/46 Node22, original 10,090 AES-GCM reports | Prior unchanged code; its limits remain, not a production approval |
| [41627911899](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41627911899) | **4/4 PASS earlier** for single slow TCP reader, FIN/RST/half-open, concurrent gate and membership commits and real SIGKILL under PG17 | Local per-block prototype only. These were **not all repeated** in the new 100/300 storm run |
| [41622190015](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41622190015) | 2/2 PASS negative test with old long-held guard | **Security FAIL**: writer `lock_timeout=750ms` cancelled revocation, leaving gate open |
| [41622123827](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41622123827) | 1/1 PASS negative test for dual Redis | **Security FAIL**: JWT replay across independent Redis authorities |

The early new runs [41632553629](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41632553629) and [41632832084](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41632832084) **failed due to independent harness defects**, retained as FAIL: (1) Redis had already marked a JWT spent and intercepted a PG witness replay test; fixed by deleting **only** the synthetic Redis spent flag of that fixture before testing witness authority, **without deleting witness ledger**; (2) closed socket tuple samples were discarded before P95/P99 calculation; fixed by preserving the header timing data. The corrected runs listed above are independently green. Both the fail history and the fixes are retained.

## PG17 100/300 concurrent slow socket stress

A new synthetic test starts **two independently spawned HTTP server OS processes** and 100/300 actual connected localhost TCP clients with a 1,024-byte SO_RCVBUF. Each client reads a complete HTTP 200 header including SHA256, then deliberately **stops reading the body**.

The test uses a **temporary copy** of the existing isolated per-block worker modified in the runner (not committed as production), increases server listen backlog to 512 and places a deterministic barrier **outside of any PG lock** immediately after HTTP headers. It tests two cases:
- `release_after_commit`: hold all 100/300 behind that barrier; close the gate and COMMIT first; release all; check no valid/full report is written.
- `writer_races_block_guards`: release all, wait until some real short per-block PG locks have begun, then close the gate in concurrency with readers; require **COMMIT within 750ms**. A worker pool of five PG connections per process limits simultaneous PG lockers; clients remain simultaneously connected.

All 4 jobs PASS in [41632967269](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41632967269). Numbers are **measured per isolated GitHub runner**, not production SLOs. Round to 0.1ms in prose.

| Active TCP sockets | Block | Gate COMMIT after barrier (ms) | Gate COMMIT racing blocks (ms) | Racing HTTP header P95/P99 (ms) | Racing response cut-off P95/P99 (ms) |
|---:|---:|---:|---:|---:|---:|
| 100 | 64 KiB | 10.7 | 81.1 | 63.3 / 68.4 | 355.4 / 368.8 |
| 100 | 256 KiB | 10.7 | 82.3 | 59.6 / 67.7 | 346.5 / 359.5 |
| 300 | 64 KiB | 7.8 | 80.0 | 84.7 / 112.8 | 436.4 / 452.2 |
| 300 | 256 KiB | 10.9 | 81.7 | 123.4 / 168.9 | 575.8 / 590.1 |

**The P95/P99 reflect handshake/header latency and interrupted response close times**—not successfully downloaded complete reports or WSS heartbeats. 0 fully received report bodies **after COMMIT** across these test cases. Old bytes queued before gate closure may arrive later. A wire-level HTTP 200 must never be interpreted as commercial success without strict Content-Length + SHA256, and pending pre-COMMIT bytes cannot be revoked.

### Database and process measurements

The fixture uses six explicitly observed SQL calls per `gate_allowed` (SET LOCAL ROLE, tenant setting, two shared advisory locks and two SELECTs). Therefore **per stress subcase** an instrumented conservative lower bound is 1,200 SQL statements for 100 clients (200 guard reads), or 3,600 for 300 clients (600 guard reads), **plus** `lock_timeout` configuration, implicit transactions and uncounted SQL; not an exact total SQL count.

Observed proxy child VmRSS peak readings were ~51,312–51,540 KiB for 100 clients and ~54,356–54,780 KiB for 300. These are maxima of **one child process** and exclude controller, PostgreSQL, Redis, system buffers and TLS overhead. `pg_current_wal_insert_lsn` difference until the gate COMMIT was 120 bytes per subcase; this narrow metric does not measure all operations across the full run or PostgreSQL storage costs. `pg_stat_database` counters can lag and count the controller's connections; the recorded snapshot deltas do **not** establish exact SQL or transaction totals.

The 100/300 test did not simultaneously hold 100/300 PG shared locks. It does **not** prove bounded revocation under 300 lock holders, network pauses, distributed HA or prolonged stalled clients. The 750ms gate writer requirement **passes in this constrained experiment only**; durable production deadline remains **UNPROVEN**. Original synthetic report SHA256 preserved:
`552f905e69b774f01a643f0b1e3980d0e90ab562494d7f815da50d2782bce4d3`.

## JTI witness: actual logical PostgreSQL restore, simulated network partition and split brain

[41632747414](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41632747414) uses three **independent disposable PG17 Docker services on one CI runner**: business PG, witness PG, separate uncoordinated shadow witness. Redis7 x2. Three real WSS TLS processes. A separate TCP forwarding OS process routes auth witness traffic on loopback; real `SIGKILL` of that process simulates the loss of a single client-to-witness transport path while Redis and witness PG remain alive. This is **not a full network partition across hosts**.

- **PASS limited:** with one shared witness primary, concurrent presentation of a JWT at two WSS gateways and distinct Redis accepted exactly 1 session and rejected the other as `JTI_ALREADY_USED`.
- **PASS new login fail-closed:** during actual TCP proxy SIGKILL, the gateway denied **new** JWT logins; after forwarding resumed the witness ledger continued rejecting a spent JWT. A JWT attempted during the outage was consumed in Redis **before** failed witness authority access, so retrying it requires a *fresh* JWT after recovery (availability defect).
- **SECURITY LIMITATION:** an **already-open WSS session continued receiving heartbeat ACK** while authority connectivity was unavailable. Login-only JTI protection does not impose ongoing global session revocation.
- **PASS limited:** resetting both Redis and the business PG synthetic status while leaving primary witness intact still rejected the previously spent JWT.
- **SECURITY FAIL real backup/restore:** `docker exec pg_dump -Fc` produced a 2,712-byte synthetic witness schema backup **before** JWT consumption. The test later executed real `pg_restore --clean --if-exists` inside the disposable PG17 witness Docker service. After restoring the prior ledger and resetting Redis and business state, the **old JWT was accepted again**. This is an actual *logical restore*, NOT proven physical WAL/base-backup restoration and NOT a user backup.
- **SECURITY FAIL split authority:** pointing one gateway at a separate shadow PG17 witness with no shared ledger allowed **both** to accept the same JWT while connected to independent Redis. No trusted global leader or external monotonic fence exists.
- **SECURITY FAIL tenant ownership:** when Redis owner mappings disagreed between nodes, two distinct correctly signed synthetic JWTs for the same device but different companies were both accepted even though the JTI ledger was globally shared. Device/company authority must be centralized and independently fenced, not delegated to per-shard Redis owner maps.

Neither WSS real production Auth/RLS nor independent physical storage/host failure domain has been established. Hard user-facing security implications are **FAIL**: full rollback resistance, single durable global authority, cross-tenant ownership, live lease fencing during authority partition.

## Regressions preserved and remaining gates

The previously confirmed [7/7 regression run 41628201783](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41628201783) remains applicable to the **unchanged original** WSS/commerce suites. 46/46 checks passed on Node20 and Node22. The original synthetic 10,090 AES-GCM commercial receipts, 200 grouping comparisons and 6 archived segments reconstructed unchanged, SHA256:
`161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18`.
The full 7/7 regression workflow was **not rerun** at the newest test-only HEAD, but the diff must be inspected to ensure no original source changes.

Next independent work needs (1) real 100/300 active shared-lock holder contention under a worst-case forced scheduler pause, not only 100/300 connected sockets; (2) precise SQL/lock/WAL and cost projection with 100/300/600/1000 TVs; (3) strict real Android client rejection of truncated HTTP 200; (4) a single cryptographic ownership and JTI authority with fail-closed bounded lease validation, HA witness leader election and anti-rollback anchoring; (5) physical backup/restore and true multi-host network partition evidence. Never confuse negative test reproduction PASS with security PASS.

**Final: production NO-GO. No deployment, no live credentials, no production resource touched.**
