# Vision V2 — short-lock HTTP block fencing, independent JTI witness, regressions

**Executed:** 03/11/2026 (UTC). **Base:** `8cc784c22fb1d6881f97c367c341e75954483d45`. **Branch ONLY:** `experiment/vision-v2-toctou-continuous-guard-qa-20261102`.

**Verdict: QA experimental progress / global production security FAIL / NO-GO.** All PostgreSQL 17 and Redis 7.4 instances were ephemeral GitHub Actions containers; all network sockets localhost, TLS test certificates ephemeral. No Supabase official, real users/records, APKs, TVs, panel, website, Vercel, deployments or main were accessed/modified. `QA_STREAM_GUARD_GROUP=1`, drain disabled. No code changed in existing commercial, original WSS, old TOCTOU counterexample, or prior reports.

## CI evidence and interpretation

| Independent workflow | Jobs | What it actually proves |
|---|---:|---|
| [PG17 per-block HTTP fence 41627911899](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41627911899) | **4/4 PASS** | Local isolated **candidate**, 100/300 actual GETs, 64/256 KiB chunks, sockets, RST/FIN/half-open, dual gate/membership commits, 1 slow reader, SIGKILL; not physical TCP rollback proof |
| [PG17 separate JTI witness 41627839145](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41627839145) | **1/1 PASS** | Global PG17 unique JTI blocks replay across 2 Redis; main PG+Redis logical rollback resisted if separate PG17 witness retained; **rollback including witness reproduces FAIL** |
| [Previous WSS + commerce retest 41628201783](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41628201783) | **7/7 PASS** | Original WSS source used via temporary copy with *branch-check string only* changed; 100/300/600/1000 TVs, Node20/22 capacity 46/46 per version, original AES-GCM 10090 reports |
| [Original long-lock revocation negative 41622190015](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41622190015) | **2/2 PASS reproducing security FAIL** | 750ms writer fails to commit under long-held lock |
| [Original dual-authority Redis negative 41622123827](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41622123827) | **1/1 PASS reproducing security FAIL** | same JWT accepted by separate Redis authorities, and after Redis-only rollback |
| [Original gate TOCTOU counterexample 41556405244](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41556405244) | **2/2 PASS reproducing security FAIL** | old gate can return full HTTP 200 after the closing COMMIT |

**Intermediate failures kept as evidence:** [41627544720](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41627544720) and [41627905819](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41627905819) failed because a deterministic pause event remained released between scenarios, making the second assertion invalid (a *test-harness flaw*). Only the new isolated worker/verify harness was corrected with `reset_pause`; [41627911899](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41627911899) ran all four settings green. The failures are NOT evidence of safety approval or of defects in the official system.

## Comparison: long lock versus per-block candidate

- Original QA held shared `pg_advisory_xact_lock_shared` throughout the entire HTTP response. A slow TCP reader or post-check pause caused the writer's `lock_timeout=750ms` to expire after ~760ms with gate **still open**. Thus fail-closed revocation with bounded commit = **SECURITY FAIL**.
- New disposable worker verifies gate **and** tenant membership under consistent shared advisory locks for **each block**. It holds locks only around a finite socket write using a 75ms send timeout and a 150ms SQL lock acquisition limit; the exclusive closing writer can enter between blocks. No original implementation or commercial stream was replaced.
- The first response header can be HTTP **200 before the closing COMMIT**. If gate/membership is later closed, the response is truncated: client MUST check declared length and full-body SHA-256 and reject as invalid. It is **not** possible to promise every wire HTTP 200 is a complete response. Bytes already in TCP/kernel buffers may be delivered after COMMIT even without any subsequent application write.
- Send timeout in Python `sendall` may transfer partial TCP bytes even when it raises; instrumented completed writes are not a complete wire capture. No CDN, Android, production origin, kernel packet capture, WAN, 300 simultaneous slow readers, multi-host partition or hard real-time scheduler guarantees were tested.

| HTTP GETs | Block | HTTP P95/P99 localhost ms | Slow TCP reader gate COMMIT ms | SIGKILL gate COMMIT ms | Pause-after-first-block COMMIT ms |
|---:|---:|---:|---:|---:|---:|
| 100 | 64 KiB | 748.418 / 857.603 | 293.4 | 20.006 | 9.781 |
| 100 | 256 KiB | 335.56 / 400.437 | 292.582 | 17.401 | 30.129 |
| 300 | 64 KiB | 602.659 / 662.303 | 293.522 | 21.706 | 10.178 |
| 300 | 256 KiB | 463.257 / 548.291 | 293.375 | 19.018 | 9.654 |

The slow-consumer fixture used a real TCP reader with SO_RCVBUF=1024 that stopped `recv`, and a *deliberate 220ms scheduler stall inside the first short guard* to guarantee writer contention. The measured ~293ms is a local QA result, **not a production bound**. Real SIGKILL was issued while one process held the guard and another waited to revoke. FIN and half-open delivered 7000 bytes with wire HTTP 200 but application validation rejected them as incomplete; RST disconnected before headers. No retry of bad results.

All 100/300 normal reports were SHA-complete, using unchanged synthetic input SHA-256:
`552f905e69b774f01a643f0b1e3980d0e90ab562494d7f815da50d2782bce4d3`.

Per-block locks increase database read/lock operations with each HTTP transfer. This round did **not** measure full SQL statement volume, wall-clock revocation tail under a large adversarial population, WAL per download, or paid database costs. No 750ms SLA can be claimed.

## JTI independent-witness candidate — boundaries of durability

The candidate creates **two separate PostgreSQL17 containers**: one business database (5432) and a second authorizer/witness database (5433), plus **two Redis 7 instances** and two WSS gateway processes. Only the local synthetic gateway copy was modified to insert JTI into a unique ledger in the witness DB **before `ready`**. All four services run on the same GitHub runner, so this is separate logical state, not a true independent physical/corruption failure domain.

- **PASS local:** two concurrent authentications of one JWT across two Redis authorities: one `ready`, one `WITNESS_JTI_REPLAY`. Five heartbeats retained **one JTI record**; zero witness SQL writes per heartbeat.
- **PASS limited:** `TRUNCATE` of synthetic business PG status tables and `FLUSHDB` of both Redis nodes did not allow reuse of spent JWT while witness remained. Old lease heartbeat denied. This is a simulated **logical state rollback**, not a PostgreSQL WAL/base-backup physical restore.
- **PASS limited:** actual `docker stop` of the witness PostgreSQL container denied new authentication; `docker start` preserved its JTI record, so old JWT remained denied.
- **SECURITY FAIL, explicitly reproduced:** if the JTI row is also erased from the witness (together with the business and Redis state), that old JWT can be authenticated again. A hardware/independently anchored monotonic witness was **not** provided or proven. This is **NO-GO** for claimed total rollback resistance.
- Small fixture witness ledger: 1 final row, 40,960 bytes relation size, 1,920 bytes measured WAL change in this narrow run. Not scale/cost estimates for 300–3000 TVs. Real device identity, server roles, writer RLS, HA, key rotation, retention, split network partitions, recovery of SQL transactions, true rollback and independent clocks remain unproven.

## Original regression (unaltered code) completed 7/7

[Run 41628201783](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41628201783) included:

| TVs | N+1 instances | Reconnected after SIGKILL | WSS heartbeat RTT P95 / P99 local ms | PG writes per heartbeat |
|---:|---:|---:|---:|---:|
| 100 | 2 | 50 | 23.030 / 33.846 | 0 |
| 300 | 3 | 100 | 61.413 / 79.229 | 0 |
| 600 | 5 | 120 | 111.517 / 127.110 | 0 |
| 1000 | 7 | 143 | 191.533 / 257.271 | 0 |

Node 20 and Node 22 each passed **46/46 budget/capacity tests**, with no regression in original paid budget model. The unmodified commercial module reconstructed **10,090** AES-256-GCM synthetic receipts from 6 immutable archive segments with 40 filters and 200 group comparisons. Final commercial SHA-256 **exactly matched**:
`161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18`.
No current plan price, real API quota or invoice was inferred from this local regression.

## Security gate and next work

- **PASS only as local candidates:** bounded per-block writer in tested cases; global JTI witness for rollback of business PG+Redis while witness remains intact; prior WSS and archive regression.
- **FAIL or NOT VERIFIED:** physically independent monotonic authority resistant to full rollback; all wire HTTP200 always valid; CDN/client SHA enforcement; worst-case 750ms writer deadline under hundreds of concurrent slow HTTP clients; correct RLS/writer privileges and multi-region split-brain; real SQL/WAL cost; real player authentication; WSS/HTTP composition; APK homologation; disaster recovery.
- **Next:** run independent adversarial 100/300 slow-client revocation storms; SQL/lock instrumentation; verify app/client handling of truncated HTTP200 at raw transport level; test two physical/network-separated witness domains with durable rollback/restore/fencing, with no claims beyond experimentally demonstrated invariants.

**Final safety decision: production NO-GO, no deployment, no real changes.**
