# Vision V2 — isolated non-destructive epoch, 100/300 WSS TLS load and external JTI authority

**Executed:** 2026-11-03 UTC. **Initial HEAD:** `9597a6b54abb10216b7edfef3b41d8a91b8ab7aa`. **Only branch:** `experiment/vision-v2-toctou-continuous-guard-qa-20261102`.

**Production decision: NO-GO / SECURITY GATES FAIL.** Nothing in these experiments is deployed to Supabase official, Vercel, main, site, panel, Android APKs, TV Boxes, real database/history/media or actual customer credentials. All PostgreSQL 17 and Redis 7 services are GitHub Actions disposable Docker services and all test endpoints are localhost. No existing original source/tests/negative reports are edited: additions only, except isolated new harness/workflow fixes.

## GitHub Actions evidence: PASS of CI vs FAIL of security

| Run | Actual CI outcome | Interpretable security result |
|---|---|---|
| [41699173768 — disjoint non-destructive epoch / 100-300 real PG holders](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41699173768) | **4/4 PASS** | Independent new gate closes without SIGKILL while the old 100/300 PG advisory-lock transactions remain alive. **SECURITY FAIL** old readers still see old gate open and can bypass if not migrated |
| [41700208749 — WSS 100/300 actual TLS clients](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41700208749) | **2/2 PASS** | Auth, heartbeats, Redis messages/command acknowledgments, simulated paused readers, SIGKILL one gateway, row lock through ACK **local only**, no 100/300 simultaneous owner-row locks proof and no long-term TLS backpressure proof |
| [41700468100 — four PG17 services / canonical JTI owner anchor](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41700468100) | **1/1 PASS** negative/positive verification | Both local authority databases can be restored while a separate external anchor preserves JTI. But **SECURITY FAIL** restoring the canonical anchor itself or splitting it between two isolated nodes reaccepts old/same JWT |
| [41638331823 — historical 100/300 long-lived advisory-lock negative](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41638331823) | **4/4 PASS of negative test** | Writer `lock_timeout=750ms` with all 100/300 actual PG17 holders alive fails to COMMIT; old gate open |
| [41632967269 — 100/300 slow HTTP clients](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41632967269) | **4/4 PASS** | 100/300 open real TCP sockets, rather than simultaneously held PG advisory locks; no physical packet/byte rewind |
| [41639213454 — auth check / WSS ACK TOCTOU negative](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639213454) | **1/1 PASS of counterexample** | Old company ACK arrived after owner reassignment COMMIT, **security FAIL** |
| [41639776045 — row-lock-through-ACK corrected WSS candidate](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41639776045) | **1/1 PASS local** | Owns row lock through short application-layer WSS send, no physical network ordering proof; total rollback and dual authorities remain FAIL |

**Historical intermediate CI failures preserved:** [41699758721](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41699758721) due to incorrectly escaped workflow matrix fields, [41699807708](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41699807708) due to using `Connection.executemany` instead of `cursor.executemany`, and [41699972502](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41699972502) passed but had an incorrect P95/P99 interpolation function; corrected and independently rerun [41700208749](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41700208749). An earlier external anchor workflow [41700443868](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41700443868) used missing environment field names; corrected and rerun [41700468100](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41700468100). These harness faults are NOT counted as security passes.

## Final regressions rerun after all new changes

The last independent CI run completed [41700677750](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41700677750) **7/7 PASS**: WSS original TLS/Redis7/PostgreSQL17 capacity matrices **100/300/600/1000 TVs**, Node20 and Node22 each **46/46 tests PASS**, and original synthetic **10,090** AES-GCM receipts reconstructed with **200 group comparisons** and SHA-256 **exactly** `161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18`. The unchanged original gateway is what this run tests: NOT a 1,000-TVs scalability claim for the NEW extra-per-heartbeat central authority candidate.

Another independent [41700686492](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41700686492) completed **4/4 PASS** on the original block-fence HTTP protocol: 100/300 GETs, 64/256 KiB, FIN/RST/half-open, real SIGKILL and response-length/SHA rejection of truncated HTTP 200. This is an isolated baseline and does not prove physical TCP delivery cutoff.

**Explicit gates still FAIL**: legacy reader bypass of the new epoch, full rollback of canonical JTI/owner authority, two separate anchor split brain, and genuine multi-host worst-case 750ms revocation/ACK delivery.

## 1. Non-destructive alternative while 100/300 old lock holders remain alive

Test fixture creates original `qa_mproc_gate` and 100/300 separate, actual PG17 backend transactions each holding `pg_advisory_xact_lock_shared` with verifiable distinct PIDs in `pg_locks`, in two real holder OS processes. It adds a **disjoint** `qa_nd_fence(enabled,epoch)` row independent of the original advisory lock. HTTP candidate worker copies (never production) check `SELECT enabled,epoch ... FOR SHARE` on each bounded chunk. A new writer updates this row in a regular transaction and COMMIT; the original 100/300 locks stay granted. No SIGKILL required.

| Verified old PG holders | HTTP block | Separate closing COMMIT | New-route rejected GETs | Legacy gate after closing |
|---:|---:|---:|---:|---|
| 100 | 64 KiB | 8.145ms | 100/100 | **OPEN** |
| 100 | 256 KiB | 6.241ms | 100/100 | **OPEN** |
| 300 | 64 KiB | 8.777ms | 300/300 | **OPEN** |
| 300 | 256 KiB | 7.457ms | 300/300 | **OPEN** |

A request that received HTTP **200 before COMMIT** was cut off after its initial 64/256 KiB block and rejected by Content-Length and SHA-256 validation; a 200 header alone is **not** a successful receipt. Post-close 100/300 real GETs to the **new route** returned 503, no full accepted report; FIN/RST/half-open are simulated and rejected by the test oracle. Two concurrent new writers monotonically increased the isolated epoch from 2 to 4. All original 100/300 holder backends remained granted, without stopping either holder process.

**Crucial SECURITY FAIL:** since the original gate remains **OPEN** and legacy readers do NOT consult the new row, any unmodified route may still be authorized and deliver data. There is no safe cross-version distributed rollout, no signed per-device epoch token, and no proof all product readers use this authority. The very fast separate COMMIT is NOT a proof of end-to-end revocation in production. P99 of 100/300 new-route denied GETs sometimes exceeded 1,000ms in GitHub Actions, separate from the 6–9ms writer times; do not conflate these latencies. Narrow local WAL difference across full fixture ~15–49KiB, excluding service/network overhead. Authority row SELECT instrumented 103–303 in these cases, NOT a billable SQL statement census. Proxy RSS ~49–50MiB per process, excluding database/OS.

## 2. Actual WSS TLS, PostgreSQL17 central owner/active lease and Redis7 (100/300)

The second matrix starts two separate WSS gateway OS processes from **temporary copies** of the previously audited fenced candidate. It inserts 100/300 distinct synthetic TV owner/JTI records into central PostgreSQL17. Both gateways have central auth pool max 6; Redis clients are separate. Every WSS heartbeat uses the central SQL check and row-lock held through bounded application ACK, then Redis session refresh.

| Metric | 100 TVs | 300 TVs |
|---|---:|---:|
| Authenticated live WSS TLS clients | 100/100 | 300/300 |
| First heartbeat ACK | 100/100 | 300/300 |
| Login P95 / P99 localhost | 144.636 / 167.657ms | 171.276 / 209.726ms |
| Heartbeat P95 / P99 localhost | 52.598 / 58.752ms | 183.118 / 189.073ms |
| Concurrent command_ACKs uniquely in main PostgreSQL | 10/10 | 30/30 |
| Application-paused WSS client reads | 20 | 60 |
| Redis command delivered with full central checks | PASS | PASS |
| SIGKILL one gateway, other continues | PASS | PASS |
| Owner update concurrent with locked ACK of one selected client | PASS local | PASS local |
| Witness WAL difference during fixture | 88,664 bytes | 269,584 bytes |
| Controller RSS peak | 88,524 KiB | 161,132 KiB |
| Two live gateway child RSS (sample before SIGKILL) | 68,468/68,484 KiB | 104,992/104,892 KiB |

P95/P99 data is corrected linear interpolation and from the validated run [41700208749](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41700208749). The 20/60 client transport reads were actually paused via `ws.transport.pause_reading()`, but the small ACK frames may already fit OS buffers; **sustained real TCP/TLS backpressure and physical client delivery order are unproven**. The owner writer was blocked on a central row lock through the **application** ACK send; a pre-COMMIT ACK may still arrive at a client after COMMIT. There were 100/300 WSS TLS clients, but NOT 100/300 concurrent row locks for one owner/writer. Under a blocked scheduler, an arbitrary row-lock hold can still exceed a claimed 750ms writer deadline without a verified end-to-end lock watchdog.

The instrumented lower bound on witness SQL reads is 232 (100 TVs) and 692 (300 TVs) in this fixture, not exact SQL count or billing; command ACKs add actual unique writes to business PostgreSQL. The candidate requires at least one extra central SQL SELECT per heartbeat: if heartbeat interval=2 min, exactly 72,000 / 216,000 / 432,000 / 720,000 potential checks/day at 100 / 300 / 600 / 1,000 TVs, before reconnects, writes, replication, locks and other requests. Not a Supabase invoice projection.

## 3. Single canonical JTI+device owner anchor, real multi-DB logical restore

New audit uses **four isolated PostgreSQL17 Docker services** (main/authority primary/authority shadow/canonical anchor), two independent Redis7 and two real independent OS authentication processes. Each validates a **synthetic HMAC JWT fixture** and consumes JTI in its local mirror and one external canonical `qa_anchor.jti` table with a unique index, only after checking the **canonical** device→company owner mapping. Not a production WSS gateway and no real Auth/RLS/token key setup. Transactions across two PostgreSQL clusters are NOT atomic; a crash in the gap can deny availability/retry of a newly issued JWT even though it is consumed.

- **PASS limited:** same JWT presented concurrently to two independent auth processes -> only one accepted; other rejected `GLOBAL_JTI_REPLAY`. Divergent Redis company ownership did not override canonical owner.
- **PASS limited after real logical restores:** two actual `pg_dump -Fc` / `pg_restore --clean` resets of primary and secondary authority databases (and both Redis) did NOT reaccept a previously spent JTI while canonical external anchor persisted.
- **PASS limited:** real Docker stop of anchor denied new logins from BOTH processes. After Docker restart the consumed JTI persisted and remained rejected (fail-closed new auth).
- **SECURITY FAIL reproduced:** `pg_restore` of the anchor's own earlier checkpoint plus the two local authorities caused the old JWT to be accepted again. No independent non-rollbackable monotonic trust root was tested.
- **SECURITY FAIL reproduced:** a third rogue auth process pointed at a separate independent `qa_anchor` ledger in a second PG17 authority accepted the same fresh signed JWT alongside the legitimate process: without a single global authority election/quorum, split brain remains.
- Independent external anchor minimum **two canonical SQL queries per new token** (owner check and unique-JTI INSERT) plus cross-database transaction work. This is a login protocol isolated QA proof and **not integrated with the prior WSS 100/300 workload or per-heartbeat fencing**. Full WAL physical backup/restore, multi-host clocks/partition, key management, RLS, quorum, paid capacity and authentication identity remain unproven.

## Outstanding gates (hard NO-GO)

1. **Legacy-route bypass:** no proof every deployed HTTP/WSS product reader checks a common non-destructive epoch/fence. Original advisory-lock case with 100/300 holders remains a reproducible 750ms revocation **FAIL**.
2. **Total rollback and split brain:** real `pg_restore` of the last external anchor lets an old JWT replay, and two independent anchors admit duplicates. Unproven physical/data-center independent monotonic fencing and leader election.
3. **WSS slow clients:** 100/300 real TLS sessions tested, 20/60 pause app reads, only one deterministic owner writer and short ACK lock held. No saturated TLS buffer, 300 concurrent row locks or enforced physical 750ms revocation guarantee.
4. **Commercial correctness:** the original synthetic report is a regression with encrypted AES-GCM receipts, not real customer/prod data or live RPC/storage.
5. **Resource governance:** new SQL/lock footprint, PostgreSQL connection contention, WAL, egress, paid services, retention and true multi-host failure need independent profiling. Do not claim billing safety from 0 live production calls.

**Release and data safety: NO-GO; no production action performed.**
