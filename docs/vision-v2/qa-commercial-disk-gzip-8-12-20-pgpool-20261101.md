# Vision V2 — bounded commercial JSON materialization, HTTP admission 8/12/20, real PG pool 8/12/20 and 64/256 KiB (QA only)

**Date:** 2026-11-01. **Only branch:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Requested starting HEAD:** `24490fe5d10947d7688eec4ea5047194ac0fc63c`.
**Implementation tested:** `0a746b715585eb817a9bcdc37a21a9f907c1d475` for optimized commercial jobs and `ba22d8cd703af8cca17a2718c32bca52804ea3d1` for 8/12/20 actual PG-pool jobs (pool-only parameter/workflow changes after the full commercial run).
**Outcome:** **13/13 PASS** complete suite; **6/6 PASS** independent PostgreSQL pool matrix. **GO for disposable QA only; PRODUCTION NO-GO.**

## Immutable CI references and diagnostic failures

- [Complete commercial + regressions workflow 41332143609](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41332143609) **13/13 SUCCESS**, including 6 optimized 8/12/20 HTTP admission x 64/256 KiB jobs; 2 concurrent revoker jobs; original 100 and actual simultaneous 300 HTTP cutover/rollback; multiprocess outbox crash replay; concurrent publishers/consumers; denied PG TCP; AES manifest and cold full HTTP.
- [Real PostgreSQL pool 8/12/20 x 64/256 KiB workflow 41332345605](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41332345605) **6/6 SUCCESS** on `ba22d8cd`.
- [Sequence/offline regression 41332143492](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41332143492) SUCCESS on optimized version; prior sequence/offline runs preserved.
- [First optimized workflow 41331764482](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41331764482): original child initialization could wait indefinitely on IPC when child crashed; this is NOT valid optimized test evidence.
- [Fail-fast diagnostic run 41332048092](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41332048092): all six optimized jobs **FAILED** explicitly, isolating a QA type error `AttributeError: 'bytes' object has no attribute 'encode'`: original report RPC already returns **bytes**. Fixed by materializing original bytes unchanged without re-encoding, preserving server SHA checks. Final 13-job CI passed with corrected code. No official data touched.

## Change made — avoid per-request full JSON parsing and re-encoding

Old commercial HTTP handler, on every request, `gzip.decompress(base)` → `json.loads` of a full ~2.8MB report → build commercial envelope → `json.dumps` full ~2.9MB JSON → `gzip.compress` and write. This created many simultaneous large Python object graphs.

New **synthetic-only** commercial handler does two controlled preparation steps:
1. Run the **original unmodified historical report/export SQL RPC** once per company at startup (10,000 event export rows per company); validate event count, store the raw original SQL payload as a temporary on-disk file, **preserving source bytes**.
2. On each committed commercial outbox revision replay, assemble a commercial metadata prefix with the original JSON bytes and suffix into a gzip file using **incremental 64KiB compression** and SHA-256, publish it atomically with `os.replace`, then hand each HTTP request a small file read buffer of **64 or 256KiB**. Missing or stale revision remains **HTTP 503** until durable replay completes; new revisions are never served before the compressed asset is published. A process reconstructs state from persisted outbox receipts after restart.

For every HTTP admission: synthetic signed JWT membership check and authoritative PostgreSQL commercial revision check. For every served body chunk: synthetic membership/RLS SQL check again. **The old per-chunk check-to-socket-write gap is NOT removed in this optimized commercial implementation; the distinct bounded-fence jobs test a different cooperating-writer solution. Production NO-GO.** Disk files in the fixture contain readable original JSON; an actual hosted implementation would need access controls, encryption at rest, version cleanup, disk budget and crash recovery fencing. Two compressed versions can remain temporarily; unlimited historical versions and a concurrent compressor crash were not separately load tested.

## 300 complete commercial HTTP reports across staged cutover/replay/rollback

Each optimized job used 2 OS-process commercial workers on **one** ephemeral runner, stable HTTP proxy, real original 10,000-row historical export wrapped in revision/campaign JSON, gzip response, full-body read/decompression/JSON parse/SHA verification per client. Three distinct 100-client waves:
- OLD ready: 100/100 HTTP 200 original campaign
- cutover to NEW ready: 100/100 HTTP 200 original campaign
- commit commercial revision WITHOUT NOTIFY; both stale replicas must return 503; durable replay into both; NEW 200; rollback to OLD: 100/100 HTTP 200 revised campaign

**All six jobs PASS**: each had 300/300 complete report HTTP 200, two deliberately denied stale HTTP 503, and updated campaign/revision at rollback. This is staged `100+100+100`, **not** 300 simultaneous commercial revisions during cutover. A separate original SQL report job tested **300 in-flight simultaneous clients across OLD→NEW→OLD** with no commercial mutation.

| HTTP admissions | Chunk | OLD 100 P95/P99 ms | NEW 100 P95/P99 ms | rollback 100 P95/P99 ms | worker peak RSS KiB A/B | successful auth SQL checks |
|---|---:|---:|---:|---:|---:|---:|
| **8** | 64KiB | 4301.328 / **4918.893** | 4463.505 / **5213.947** | 4204.252 / **5222.615** | 59456 / 59632 | 2109 |
| **8** | 256KiB | 3135.262 / **3365.519** | 2990.876 / **3240.596** | 2990.573 / **3448.394** | 59332 / 59268 | 905 |
| **12** | 64KiB | 2976.912 / **3218.639** | 3358.341 / **3423.382** | 3357.961 / **3492.152** | 59708 / 59388 | 2109 |
| **12** | 256KiB | 3166.358 / **3249.407** | 3072.360 / **3244.330** | 3073.808 / **3200.377** | 59368 / 59336 | 905 |
| **20** | 64KiB | 3406.185 / **3709.011** | 3557.751 / **3602.473** | 3578.422 / **3784.730** | 59344 / 59364 | 2109 |
| **20** | 256KiB | 2755.514 / **2901.935** | 3051.242 / **3182.942** | 3073.626 / **3247.080** | 59600 / 59484 | 905 |

Each optimized job also recorded **303 authoritative commercial revision/admission SELECTs**, **4 durable replay SELECTs**, and **300 report GETs plus 3 check GETs**. Actual SQL count is **higher** than these tracked SQL categories because role/session configuration, other RPCs, transactions, fixture creation and WAL changes are not totaled here.

**Across each optimized 300-report run:** **105,525,300 bytes gzip egress**, ~**838,077,?** raw-equivalent bytes (exact sum of three compressed-envelope raw groups depends on campaign label), ~**5,938,774 bytes** of temporary raw-source-plus-current-gzip files per worker, and **zero remote object/media GETs**. The independently simulated AES-manifest regression uses **one GET** of 168 bytes and **four PUTs** totaling 680 bytes.

## Original commercial baseline 12-admission comparison — independent CI runners

Previously validated baseline source, using full parse+encode for EVERY request: [baseline 12-slot commercial 41330719240](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41330719240), worker RSS **264,804/271,240 KiB**, stage P99 **13,495.929 / 15,573.406 / 13,210.484 ms**.
Corrected precompressed 12-slot, 64KiB: **59,708/59,388 KiB**, stage P99 **3218.639/3423.382/3492.152 ms**.
Corrected precompressed 12-slot, 256KiB: **59,368/59,336 KiB**, stage P99 **3249.407/3244.330/3200.377 ms**.

The lower worker peak RSS is approximately **77.5–78%** per worker, with **~4-5x lower observed P99** in independently scheduled GitHub runners. These are observations; not a controlled same-runner causal speedup. The baseline 50 HTTP proxy-slot run had worker RSS 840,484/837,120 KiB; it was likewise not on the same runner.

## Actual PG SQL pool ≠ HTTP admission cap — separate 6-job matrix

A second independent 6-job workflow uses a hard **8, 12 or 20 real PostgreSQL login connection pool** feeding 300 submitted **slow Linux socketpair writes**, with **two independently running revokers** and a persistent `pending` marker. Pending/active member SQL checks use synthetic FORCE RLS, SECURITY DEFINER role restrictions and PG transaction advisory locks. A non-reading socket causes a real 105ms send timeout under a held shared lock; on release, both exclusive revoker commits must complete. **This is not 300 simultaneous live TV/DB connections.**

| PG pool | Chunk | Peak PG sessions | accepted before pending | denied after pending | revoker commit elapsed ms pair | socket timeouts | result |
|---|---:|---:|---:|---:|---:|---:|---|
| 8 | 64KiB | 8 | 8 | 292 | 107.733 / 105.827 | 8 | PASS |
| 8 | 256KiB | 8 | 8 | 292 | 109.008 / 111.165 | 8 | PASS |
| 12 | 64KiB | 12 | 12 | 288 | 116.553 / 120.052 | 12 | PASS |
| 12 | 256KiB | 12 | 12 | 288 | 107.678 / 108.960 | 12 | PASS |
| 20 | 64KiB | 20 | 20 | 280 | 125.328 / 124.087 | 20 | PASS |
| 20 | 256KiB | 20 | 20 | 280 | 122.921 / 124.162 | 20 | PASS |

Zero unexpected PG pool wait errors in all six; both revokers concluded and no live sessions leaked in the controlled test. **38 prohibited RLS/SECURITY DEFINER privilege or schema-bypass operations** were denied in each case, including temporary schema shadowing. Killing a separate OS process with a shared advisory lock released the lock; revocation after crash passed. No universal lock fairness, 300 simultaneous connections, actual TCP network partitions, superuser bypass or production Auth tested.

## Other independent PASS regressions in final 13-job run

- Full original report/export **100 + simultaneously 300 clients across cutover and rollback** with 256KiB protected application writes, zero HTTP errors, 80+ post-rollback requests. **100 P95/P99 1724.964/1749.136 ms**, **300 P95/P99 4973.565/5596.785 ms**. Original report gzip egress **140,394,200 bytes** for 400 complete responses, core synthetic auth+fence SQL instructions **2414**, worker RSS **77,992/72,328 KiB**, PG database **21,821,107 bytes**, playback index **9,805,824 bytes**, post-fixture WAL **215,776 bytes**.
- Multiprocess durable outbox: producer crashed after commit, consumer crashed before receipt, inside receipt transaction, and after durable checkpoint before ack; 2 independent OS-process writers and 2 consumer processes replayed events in exact same order without durable duplicates. Aborted IDENTITY values remain legitimate nonconsecutive IDs.
- Exact commercial concurrent 6 publishers / 2 consumers replay passed; original deliberately unsafe auth-once HTTP baseline still **FAIL** with 16,384 bytes written post-revocation; synthetic controlled re-check delivered zero bytes only in the controlled gap.
- Refused PG TCP connection midstream led to truncation, new HTTP 503, and recovery HTTP 200; not a real remote PG cluster failure.
- Separate AES-GCM manifest partial object crash/store restart and immutable ready marker passed; **one remote-simulated manifest GET, four PUTs**, no media.
- Cold uncompressed original SQL report baseline 100 P95/P99 **12,770.640/12,783.794 ms**, 300 **15,612.337/15,786.159 ms**; not directly comparable to warm gzip commercial.

## Storage, WAL, RAM and cost modeling

- Optimized commercial disposable PG17 database sizes observed **21,993,139–22,001,331 bytes** (includes original playback indexes **9,805,824 bytes**); WAL delta **214,240–488,176 bytes**, measured **after** inserting 20K synthetic history source rows, so not total ingestion WAL. Differences among independent runners must not be attributed causally to chunk/admission values.
- Optimized commercial workers peak RSS ~**59,268–59,708 KiB** each; includes Python and prewarm, excludes PostgreSQL server, parent, kernel and the remote object simulation. Disk space **~5.94MB per worker**, synthetic only.
- One complete commercial gzip ~**351,755 bytes**. With **1 full export/client/day for 30 days**: 100 clients → **3000 reports, ~1.055 GB egress**; 300 → **9000 reports, ~3.166 GB egress**, excluding all TV video/image/media playback.
- Full commercial HTTP has approximately **8 tracked core SQL checks/report at 64KiB** (7 JWT/member + 1 revision/admission), or **4 checks/report at 256KiB** (3 JWT/member + 1 revision/admission). Optional existing *separate* two-replica durable-outbox 30-second poll would add **172,800 SQL/month** if implemented, but it was NOT enabled in the optimized commercial jobs:

| Monthly modeled core SQL (1 report/client/day) | 100 clients | 300 clients |
|---|---:|---:|
| 64KiB auth/revision only | **24,000** | **72,000** |
| 256KiB auth/revision only | **12,000** | **36,000** |
| 64KiB plus hypothetical shared 30s reconciliation | **196,800** | **244,800** |
| 256KiB plus hypothetical shared 30s reconciliation | **184,800** | **208,800** |

These counts omit report RPC rebuilds, `SET ROLE`, GUCs, transaction SQL, outbox writes, retries, videos/images, playback heartbeats, full system WAL and connection overhead. **No actual R$ bill, Supabase Free quota suitability or current production usage was consulted or established.**

## Remaining production NO-GO gates

1. **Security:** Optimized commercial HTTP retains per-block synthetic JWT/RLS SQL but does **NOT integrate the proven-bounded cooperative transaction fence with all actual membership revokers**; the check-to-socket-write gap persists. A separate protocol tests bounded locks but not the optimized HTTP path. No zero-network-delivery guarantee for prebuffered bytes.
2. **Coherence under simultaneous mutation:** new cache tested complete 100-old/100-new/100-post-rollback stages with a revision between waves; **not an in-flight simultaneous commercial mutation + router cutover + 300 clients**. Revision SQL is checked at admission, not automatically fenced against an in-progress body write.
3. **Disk security and lifecycle:** temporary original plaintext report file in QA must not be ported as-is. Production requires encrypted/policy-controlled storage, atomic revision cleanup, bounded disk, crash during gzip materialization, exhaustion and corruption handling.
4. **Resource semantics:** proxy admission 8/12/20 and PostgreSQL pool 8/12/20 measured in **different jobs**. One-to-one integrated 100/300 TV HTTP with persistent PG pooling, backpressure and actual device/media traffic remains untested.
5. **Real hosts:** all producer/consumer and router tests are separate OS processes on the same GitHub Actions runner, not two physical hosts; socketpair/localhost refusal do not simulate real long network half-open, packet loss or cloud Auth.
6. **Capacity and pricing:** 30/90-day history, real storage/index/WAL ingestion, realtime GET/PATCH media egress, Supabase Auth/JWKS/SECURITY DEFINER permissions, AES KMS/cloud object storage and official Supabase plan/billing are not verified. No real 300-TV approval.

**Guardrail:** no official Supabase even read-only, production APIs, live database, APK, Vercel, site, panel, TV, real history or GitHub main accessed or changed. Only selected isolated GitHub branch and synthetic PostgreSQL17 GitHub Actions files/tests, **NO DEPLOY, PRODUCTION NO-GO**.
