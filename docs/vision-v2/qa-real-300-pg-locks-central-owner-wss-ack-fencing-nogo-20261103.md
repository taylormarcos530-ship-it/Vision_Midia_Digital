# Vision V2 — 100/300 real lock holders, WSS live owner fencing, independent negative verification

**Date:** 2026-11-03 UTC. **Exact base commit:** `15779b4c05308e75f3043f7e24dcfe345668c3bf`. **Sole branch:** `experiment/vision-v2-toctou-continuous-guard-qa-20261102`.

**Final security verdict: FAIL / PRODUCTION NO-GO.** All PostgreSQL17 and Redis7.4 services in these new workflows were disposable CI containers, using localhost, synthetic credentials/certificates, synthetic data and no official Supabase/GitHub deployment/Vercel/APKs/TVs/panel/site/history operations. GitHub activity was limited to this experiment branch and CI. The original WSS, commercial and historical TOCTOU negative test code/reports remain unchanged. `QA_STREAM_GUARD_GROUP=1`, drain disabled.

## Independent GitHub Actions evidence

| Workflow | CI outcome | Security outcome |
|---|---|---|
| [41638331823 — 100/300 true PostgreSQL17 shared advisory lock backends](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41638331823) | **4/4 jobs PASS** verifying 100 or 300 actually granted locks, `pg_locks`, distinct backends, idle transactions; 20 late readers | **FAIL**: writer lock timeout at 750ms leaves gate OPEN; emergency SIGKILL of *both* holder OS processes allowed local commit, not deployable safety |
| [41639213454 — prior central owner and per-heartbeat witness](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639213454) | **1/1 PASS negative-probe audit** | **FAIL**: owner update COMMIT after witness check but before WSS ACK still produced ACK on stale old session; preserved as a counterexample |
| [41639776045 — NEW separate fenced heartbeat candidate](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639776045) | **1/1 job PASS local**, explicit checked-then-writer race, route SIGKILL, global owner and JTI | **LOCAL PASS only**: a PG row lock spanning check → bounded WSS ACK serialized this race; independent witness rollback and split authority remain **SECURITY FAIL** |
| [41639969560 — original HTTP 100/300 requests, RST/FIN/halfopen/SIGKILL](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639969560) | **4/4 PASS** re-regression after WSS proof | Per-block HTTP synthetic candidate only; 200 truncated must be treated as failure by actual client |
| [41639947739 — original WSS/commercial final re-regression](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639947739) | **7/7 PASS**, Node20/22 + PG17 WSS 100/300/600/1000 + 10,090 AES-GCM proofs | Original protocol and commercial invariants preserved; does not certify new WSS candidate at 1000 TVs or production security |
| [41632967269 — 100/300 real TCP sockets stopped receiving](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41632967269) | **4/4 PASS** local revocation storms | 100/300 sockets did **not** hold 100/300 PostgreSQL advisory locks simultaneously; the new job above closes that testing gap |

**Intermediate CI FAILs retained, not hidden:** [41638803624](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41638803624) used the wrong entrypoint in a new workflow; [41639682045](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639682045) produced an invalid Python gateway from a double-escaped newline in synthetic code generation. Both isolated harness issues were corrected and independently re-run, respectively [41638944369](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41638944369) and [41639776045](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639776045). The old callback TOCTOU vulnerability proof is explicitly **preserved unchanged**; its reproducer exits successfully but indicates a failing security gate.

## PostgreSQL17 — exact 100/300 lock-holder concurrency

The isolated CI service was reconfigured with `ALTER SYSTEM SET max_connections=450` and restarted **only inside its disposable Docker service**. Two actual Python OS processes held 50 or 150 separate PostgreSQL transaction-level shared advisory locks each (100 or 300 distinct Postgres backend PIDs in `pg_locks`), all in `idle in transaction`. A third writer attempted `pg_advisory_xact_lock` with `lock_timeout=750ms`.

| True PG backends holding shared lock | Metadata block | Writer under persistent holders | Writer after SIGKILL of holder processes | Late reader wait P95 / P99 |
|---:|---:|---|---:|---:|
| 100 | 64 KiB | **FAIL** 760.0ms, no COMMIT; gate open | 206.8ms COMMIT | 212.2 / 213.3ms |
| 100 | 256 KiB | **FAIL** 757.7ms, no COMMIT; gate open | 506.4ms COMMIT | 502.5 / 505.9ms |
| 300 | 64 KiB | **FAIL** 757.8ms, no COMMIT; gate open | 300.0ms COMMIT | 311.5 / 318.1ms |
| 300 | 256 KiB | **FAIL** 758.0ms, no COMMIT; gate open | 301.0ms COMMIT | 304.3 / 316.1ms |

An exclusive writer was observed waiting behind all 100/300 granted locks before SIGKILL; **20 additional shared readers** were also enqueued and each subsequently observed the CLOSED gate after the writer committed. The process-kill mechanism is a **disruptive local operator intervention, not a reliable bounded safe cancellation or production fix**. Bytes already transmitted over TCP cannot be revoked, and the lock-only harness did not stream HTTP; RST/FIN/half-open/HTTP200 partial were independently rechecked in the separate [4/4 HTTP workflow](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639969560). The protocol still requires complete Content-Length and SHA256 validation to avoid acknowledging partial data.

Minimum instrumented holder SQL statements: **200** for 100 locks or **600** for 300 locks (one advisory-lock query and one backend PID query per connection); controller SQL and implicit BEGIN/COMMIT are **additional, not counted**. WAL measured through the gate update was 120 bytes across these narrow sessions—not total WAL for 100/300 HTTP clients. Holder OS child-process observed RSS at readiness: approximately 44,176–44,216 KiB per process (100 locks) or 49,800–50,100 KiB (300 locks). It excludes PostgreSQL service, sockets, controller and TLS overhead. No price or paid service capacity can be inferred. P95/P99 in the table are the **20 late readers' wait times**, not full-HTTP latency or SLA compliance.

## WSS — proven prior failure and local candidate

The original isolated WSS gateway trusted per-Redis company→device owner mappings and consumed JTI only inside each Redis. The prior separate PG17 witness test improved login but left old sessions eligible during witness partition. The next synthetic local variant added a **single centralized PG17 table of device owner, JTI unique ledger and active leases**, with one authoritative SQL SELECT per heartbeat. It showed:

- **PASS local limited:** wrong tenant rejected even with contradictory Redis owner mapping, global JTI duplicate rejected, live heartbeat fail-closed when the witness TCP forwarder was SIGKILLed, and next heartbeat denied for old tenant after an owner change.
- **SECURITY FAIL reproduced:** with deterministic barrier *after SQL authorization check and before Redis heartbeat refresh/ACK*, a concurrent owner reassign could COMMIT and the old session could still receive `heartbeat_ack`. The original checked-once synthetic candidate is retained as a negative proof at [41639213454](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639213454), and its source remains available.
- **Separate corrected QA-only candidate:** wraps the central owner+active-lease `SELECT ... FOR SHARE OF o,a` in a PostgreSQL17 transaction, then performs Redis lease checks and a **150ms bounded application WSS ACK send** while still holding the shared row locks. An owner writer `UPDATE` cannot COMMIT ahead of the already-authorized ACK; a subsequent old heartbeat is rejected. A deterministic barrier and owner writer concurrently verified this in [41639776045](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639776045). **Not** a claim of physical receipt order or robust 300-device concurrent latency; WSS backpressure, slow TLS consumers, writer starvation and multi-host failover still require independent adversarial tests.
- **SECURITY FAIL still reproduced:** an actual `pg_dump -Fc`/`pg_restore` of an earlier witness ledger (3,699 bytes in the synthetic fixture), plus Redis state reset, reaccepts an already-used JWT; pointing gateways at **two uncoordinated PG17 authorities** can also accept the same JTI twice. There is **no proven nonrollbackable monotonic anchor, no global leader fencing** and no real registered device certificate/Auth/RLS integration.
- **Cost tradeoff:** one additional central authority SELECT per WSS heartbeat (and potentially per other session frame) is required by this proof. With the scenario heartbeat rate 1 per 2 minutes, the **unbilled arithmetic only** is 72,000 extra SQL checks/day for 100 TVs; 216,000 for 300; 432,000 for 600; 720,000 for 1,000. Actual SQL protocol overhead, WAL, shard pooling, timeouts, egress, pricing and data retention have **not** been comprehensively measured.

Both candidate versions were created as **separate synthetic QA files** and a temporary generated gateway copy in each CI runner; the original gateway was never edited.

## Unchanged baseline regression

Latest re-run [41639947739](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639947739): 4 WSS matrix jobs PASS (100, 300, 600, 1000 synthetic TVs), Node20 PASS 46/46 and Node22 PASS 46/46, and PG17 original commercial AES-GCM archive PASS with 10,090 receipts and 200 group comparisons. Immutable commercial SHA-256:
`161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18`.

Latest HTTP fault re-run [41639969560](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639969560) verified four 100/300 GET block-fence tests PASS including SHA-rejected truncated HTTP 200, FIN/RST/half-open and SIGKILL, with no deployment. Prior evidence, versions and negative contraproofs remain available.

## Nonnegotiable blockers / next experimental step

1. Prove revocation with a non-disruptive bounded-lease protocol under 100/300 **actual simultaneous PG locks**; the current long-lock approach provably FAILS at 750ms and process SIGKILL is not safe in production.
2. Design a **single globally elected, nonrollbackable JTI and owner authority** with independent monotonic anchor, cross-host network partitions, restoration of PostgreSQL/Redis and key compromise assumptions; both fully restored ledger and shadow PG17 remain SECURITY FAIL.
3. Prove WSS row-lock-through-ACK under 100/300 concurrent slow subscribers, 150ms send deadline, SIGKILL, actual TLS frame backpressure and consistent comparison of server application send time versus physical delivery. Client-visible ACK may arrive after the writer COMMIT even when server send logically preceded it; do not overclaim.
4. Quantify SQL, locks, WAL, RSS, index retention, P95/P99 and paid costs for the **new authority-select-per-heartbeat implementation** at 100/300/600/1000 TVs. Existing original WSS scale regressions cannot establish this new system's capacity.
5. Authenticate real devices and companies with least-privilege SQL roles, RLS, keys and tenant membership. Only then consider isolated APK homologation, never direct installation on active TVs.

**Safety gate: NO-GO; official Supabase/Vercel/Android APKs/panel/TVs/real history unchanged.**
