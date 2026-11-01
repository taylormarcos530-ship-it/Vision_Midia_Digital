# Vision V2 — Independent recheck of isolated PG17 HTTP/Commercial QA (2026-11-01)

**Branch ONLY:** `experiment/vision-v2-sequence-watermark-qa-20261031`
**Requested base:** `9eff56238744481369a6ef95139fb3585ed9670c`
**Reviewed HEAD prior to this documentation-only commit:** `4b20a6c0f1975cc8ba2b1a0c0dcaa5cc8cd68599`
**Security policy:** PostgreSQL 17 disposable, synthetic JWT/roles/data, no Supabase official or production infrastructure. **PRODUCTION NO-GO**.

## Evidence checked directly in GitHub Actions

- [Transport admission/TCP multiprocess, run 41358314336](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41358314336): original 12/12 SUCCESS. Re-run requested for 300 clients / PG pool 12 / 256KiB, accepted by GitHub and completed SUCCESS in attempt 2.
- [Commercial original reports/AES/pools, run 41358314468](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41358314468): original 12/12 SUCCESS. Re-run requested for 300-client mixed cutover/commit/rollback, accepted by GitHub and completed SUCCESS in attempt 2.
- [AES receipt, durable outbox and protected writes run 41358152677](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41358152677): 7/7 SUCCESS (prior run inspected, **not re-run**).
- [Sequence/offline 41358314499](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41358314499): 1/1 SUCCESS (prior run inspected, **not re-run**).

**PASS/FAIL statement:** 32/32 previous jobs confirmed successful. Two *selected* new executions accepted and completed successful. Status 'SUCCESS' for a job does not imply production acceptance. The latest attempt may display other inherited successful matrix jobs; do not attribute a fresh test to jobs not explicitly re-run.

## New isolated recheck: 300 clients / pool 12 / 256KiB

From job `125007973239`, JSON summary:
- PostgreSQL 17 disposable, two endpoint processes on one CI host.
- Full healthy HTTP 200 300/300, 309 local GET attempts including negative cases, 900 instrumented authorization guard calls as a lower bound (not total SQL statements).
- P95 **1653.950ms**, P99 **1845.164ms** (first attempt was 689.313ms / 1118.977ms); runner differences prevent causal comparisons.
- Revocation COMMIT: zero further application-written body bytes; an active partial stream failed closed. Actual TCP buffers may still deliver bytes accepted earlier.
- Multiprocess stale admission ticket denied: 2/2 processes; late scheduling approximately **140.507ms past a 420ms nominal deadline**. **Physical stream termination within 420ms NOT PROVEN**.
- Transport failures: header-only 200, FIN mid-block, RST mid-block, half-open: fail closed with no auto-retry; 401 single attempt; explicitly recoverable 503 GET retried exactly once.
- Gzip healthy report synthetic **442,825 bytes**; 300 responses **132,847,500 bytes**, excluding TCP/TLS overhead, videos, media GETs and real egress billing.
- DB **7,763,635 bytes**, association index **16,384 bytes**, WAL delta **215,776 bytes**, parent RSS **247,688 KiB** (children/PG/kernel not included).

## New isolated recheck: mixed 300 concurrent commercial cutover

From job `125007980532`, JSON summary:
- **291 valid complete 200 / 9 HTTP 503 / 0 falsely accepted incomplete responses**. Earlier run: **293 valid complete 200 / 7 HTTP 503**. Both jobs returned SUCCESS because the implementation intentionally fails closed.
- Availability on these two attempts: **97.00% and 97.67%** of submitted requests, respectively; no claim of a reliable production SLA. **Availability requirement remains FAIL/NO-GO** pending explicit accepted error budget and test design.
- P95 **1007.881ms**, P99 **1129.152ms** for mixed 300 (first attempt 1479.104/1539.936ms); these are distinct-run measurements, not causal improvement.
- Full commercial reports preserve original SQL functions, SHA validation, outbox, AES-GCM, cutover/rollback. Synthetic report data, no official data.
- Mixed full-success compressed bytes **102,352,964**; DB **21,943,987 bytes**, index **9,805,824 bytes**, parent RSS **206,324 KiB**; each of two workers approximately 66MiB RSS separately.
- SQL statement totals, full process aggregate RSS and end-to-end media egress/cost not established by these jobs.

## Explicit FAIL/NOT PROVEN vs PASS

| Requirement | Classification |
| --- | --- |
| Fresh targeted CI transport rerun PG17 / 300 / 12 / 256K | PASS |
| Fresh targeted CI commercial concurrency rerun | PASS by existing fail-closed assertions |
| No auto-retry on partial 200/401, real FIN/RST/half-open | PASS in synthetic localhost |
| Monotonic deadline governs admission epoch, no stale new admissions | PASS in single-host multiprocess |
| Physical end of every stream within 420ms | **NOT PROVEN; NO-GO** |
| Zero new application writes after revocation COMMIT | PASS in cooperative server test |
| Zero post-COMMIT bytes delivered by TCP/proxy/kernel | **NOT PROVEN; NO-GO** |
| 300/300 continuous availability during concurrent commercial mutation | **FAIL (291/300; nine 503)** |
| Original commercial report/AES-GCM/outbox/manifest regression | PASS in synthetic PG17 |
| Real JWT/JWKS, multi-host/cross-region, real KMS/Supabase, real TV/player performance | **NOT TESTED; NO-GO** |
| Real SQL totals, WAL over retention window, aggregate RSS, media GET/egress, monetary provider costs | **NOT PROVEN; NO-GO** |

## Cost ceiling, explicitly not provider billing

One 442,825 B synthetic report per client per day for 30 days corresponds to about **1.328GB** at 100 clients or **3.985GB** at 300; original commercial gzip (~351,751 B) corresponds to ~1.055/3.166GB. These exclude retries, other GETs, images, video, heartbeat, TLS and storage. No Supabase Free-plan conclusion is authorized.

**Conclusion:** Isolated QA can continue. PRODUCTION NO-GO. This commit is documentation only; no application migrations, deploy or production calls.