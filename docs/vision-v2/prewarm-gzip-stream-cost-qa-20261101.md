# Vision V2 — PostgreSQL17 isolated prewarm/gzip, revocation while streaming and AES outbox regression

**Date**: 2026-11-01. **Branch only**: `experiment/vision-v2-sequence-watermark-qa-20261031`. **Initial commit**: `a0a95e91f276cb83b8a71b38e863f67c22bf9705`. **Last tested code before this document**: `0b494a66da3b39db8890db947fc23ebc3654fa91`.

**Verdict: PASS for these isolated QA test cases, GO for additional QA only, NO-GO production. No deployed work or official Supabase access.**

## Verifiable GitHub Actions logs

- [Final workflow 41314686291](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41314686291): **2/2 jobs success** on same HEAD. Job `124872120402` runs gzip, bounded concurrency, streaming revocation. Job `124872120316` reruns synthetic remote AES-256-GCM outbox crash/restart and 100/300 cold full original RPC HTTP.
- [512KiB checkpoint matrix 41314542537](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41314542537): PASS, no concurrent remote benchmark job.
- [256KiB checkpoint initial PASS 41314370609](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41314370609): PASS. Initial run `41314277817` failed only at a QA log `NameError`, corrected in `27fab690`.
- [Sequence/offline regression 41314542480](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41314542480): PASS on the 512KiB code commit `972f140c`.

## Workload facts and restrictions

Disposable PostgreSQL17 from GitHub Actions. Original unmodified GitHub `get_playback_report` and `get_playback_events` SQL; 20,664 synthetic events retained, including 10,000 old history events per company. Full original report + 10,000-row export is **2,793,510 bytes/company**. Two separate Python OS-process HTTP replicas, each holding two per-company canonical JSON results. Cache prewarming runs before readiness, and HTTP returns **503 prewarm_not_ready** until complete.

The test checks all eight surviving synthetic RLS-protected tables after **QA-only** policy hardening; membership is checked through actual synthetic PG SQL. A bounded semaphore permits maximum **20 admitted HTTP requests per replica**, plus 8 auth lookups per replica. Requests beyond the bound wait in Python threads; this does not guarantee a production-size bounded thread pool. QA chunk-streaming rechecks JWT and active membership at HTTP admission, before HTTP headers and at **512KiB boundaries**; a deterministic pause after the first 16KiB gzip chunk confirms revocation aborts the rest of the stream. Already-delivered bytes **cannot** be retracted. HTTP status has already been 200, so the connection is terminated deliberately and Content-Length signals truncation.

gzip level 3 is applied once during prewarm and held alongside the canonical full JSON per tenant; every client verifies SHA-256 of the *uncompressed* full JSON including all 10,000 rows (plus sample full parsing). AES manifest is not used by this report-serving gateway test; it is verified independently in the second final CI job.

## Measured performance — final simultaneous 2-job CI run 41314686291

| Concurrent clients | Plain full JSON P95/P99 | gzip full JSON P95/P99 | Plain bytes transferred | gzip bytes transferred |
|---|---|---|---:|---:|
| 100 | 3,961.053 / **3,992.435 ms** | 1,296.319 / **1,545.702 ms** | 279,351,000 | 35,098,550 |
| 300 | 11,928.935 / **12,063.155 ms** | 3,409.114 / **3,666.394 ms** | 838,053,000 | 105,295,650 |
| Total | — | — | **1,117,404,000** | **140,394,200** |

Compression yields **87.44% less report HTTP payload egress**, in this synthetic repetitive JSON. Real media egress unchanged.

**Prewarm wall-clock** was **14.767 seconds** on this runner, including four full RPC reconstructions (2 per replica) before the HTTP readiness gate. At 300 gzip clients, prewarm + subsequent observed P99 is **18.433 s**, not demonstrated better than 300-client direct cold P99 **17.955 s** in the concurrent regression job. Warm HTTP **service** P99 improves a lot, but startup cost is **shifted**. Do not claim 15s genuine cold-start p99 was eliminated.

A separate 512KiB isolated run `41314542537` had 9.435 s prewarm and gzip 300-client P99 3.490 s; another 256KiB run `41314370609` had 8.578 s prewarm and gzip P99 3.915 s. Host load varies; no statistically controlled causal latency improvement is established by these differences.

## SQL, RAM, WAL and index tradeoffs

| Metric | 256KiB run 41314370609 | 512KiB run 41314542537 | Final simultaneous 512KiB 41314686291 |
|---|---:|---:|---:|
| Successful auth SQL checks, two replicas, four waves + security preflights | 6,811 | **4,409** | **4,409** |
| Full report/export RPC reconstructions per run | 4 | 4 | 4 |
| Peak admitted HTTP across both replicas | 40 | 40 | 40 |
| Replica Python RSS peak, KiB A + B | 85,816 + 87,080 | 103,636 + 102,172 | 102,288 + 105,080 |
| Combined peak canonical + gzip cache bytes, two replicas | 12,577,982 | 12,577,982 | 12,577,982 |
| PG history index bytes | 9,805,824 | 9,805,824 | 9,805,824 |
| PG database bytes | 21,812,915 | 21,812,915 | 21,812,915 |
| Post-fixture WAL delta, bytes | 211,832 | 211,832 | 211,792 |
| Remote object GETs in *this* prewarm benchmark | 0 | 0 | 0 |

512KiB checkpointing reduces successful SQL membership checks **35.27% vs 256KiB**, yet 4,409 for 800 successful HTTP requests (plus security probes) is still substantial, compared with checking only twice per request. This is a **security vs DB-load tradeoff**, NOT production-ready. More extensive auth buffering without sound revocation guarantees is unacceptable. Replica RSS is higher in this run; treat memory differences as observed environment variance, not proven stable change. PostgreSQL RSS and WAL from initial fixture insertion were **not** collected.

## Streaming revocation PASS limits

- At 16,384 bytes streamed, synthetic PostgreSQL membership is removed while a controlled HTTP transmission is held.
- On release, re-check denies subsequent data; HTTP 200 stream ends incompletely and client verifies **zero additional bytes** after revocation.
- New requests denied on both process replicas; synthetic signing key A revoked on both, B allowed after membership restore.
- Does **not** test a true production Supabase JWT/JWKS, multi-host rollout, or adversarial high-frequency revocation at every phase of a real network transfer.

## Independent remote encrypted outbox regression PASS

The second final job `124872120316` preserves the earlier independent QA design: encrypted tiny synthetic AES manifest over separate HTTP object service, forcibly terminates and restarts that process, discards partial PUT, uses immutable versioned object, checks SHA-256, validates PENDING/READY and PG rollback, tests live two-worker synthetic JWT key rotation. **Four PUTs, one GET, 680 uploaded and 168 downloaded bytes for the tiny manifest envelope** across the process-crash/restart run. This does **not** represent media/object GET counts for 300 TVs.

The same independent regression recomputed truly cold full report/export JSON in four SQL builds per wave: 100 clients **P99 13.584 s**, 300 clients **P99 17.955 s**; both deliver complete original JSON. Neither test accessed production.

## Monthly egress scenarios (modeled, NOT billed)

Assume 1 report per client/day for 30 days, uncompressed 2,793,510 bytes or gzip 350,985.5 bytes per report. Does not include media, playback, HTTP headers, database WAL retention, retries, provider-specific billing.

| 30-day model | 100 clients | 300 clients |
|---|---:|---:|
| Plain full JSON exports | **8.381 GB** | **25.142 GB** |
| Gzip full JSON exports | **1.053 GB** | **3.159 GB** |
| Plain if hourly | **201.133 GB** | **603.398 GB** |
| Gzip if hourly | **25.271 GB** | **75.813 GB** |

Heartbeat and reconciliation (hypothetical two-replica 60-second cadence) were previously modeled at **129,600 SQL/notify operations/month** before any requests. The measured 512KiB chunk authentication guards add an *actual test* average ~5.51 successful SQL auth checks per request (mix of plain/gzip), a substantial possible cost. There is **no valid BRL or Supabase Free-tier capacity conclusion** without actual public provider quota assumptions and architecture measurements.

## NO-GO blockers

1. Prewarm readiness makes full cold user P99 better only if a previous serving replica remains ready during rolling start; zero-downtime rolling restart and memory pressure **not tested**.
2. High SQL authorization-check overhead for full uncompressed streaming and uncertain acceptable revocation window. Do not reduce checks solely to improve speed without security proof.
3. PostgreSQL-native synthetic RLS vs real Supabase Auth/JWKS, distributed revocation notification / durable event replay in actual deployment.
4. External remote AES object storage transactional publication under concurrent writers, KMS, retries, crash windows (the QA uses a temporary local directory with separate HTTP process).
5. True multi-host 100/300-client event variety and sustained cold workloads, real network media egress, provider billing, total cluster RSS, WAL and indexes over 7/30 days.

**Hard guard**: No official Supabase (read or write), APK, panel, website, TV, production database or real playback history was consulted or modified. Only experimental GitHub branch and disposable PG17 CI ran. No deploy.