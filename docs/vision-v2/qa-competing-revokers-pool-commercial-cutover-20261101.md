# Vision V2 — concurrent revokers, bounded PG pool, 64/256 KiB stream, commercial HTTP cutover and rollback

**Date:** 2026-11-01. **Experimental branch only:** `experiment/vision-v2-sequence-watermark-qa-20261031`. **Starting SHA:** `800e25a4d529126ae605642215948464f37237ba`.

**Decision: PASS on the final disposable PG17 tests, GO for further QA only, PRODUCTION NO-GO.** NO official Supabase access even read-only, production APK, panel, site, TV, database, real history, deployment or main-branch change.

## Audit trail and corrected CI failures

- [Final integrated 8-job PG17 regression 41330270792](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41330270792): **8/8 SUCCESS**, source commit **`6dc24f1cc2b357c8406abafa04c149f482742e56`**. Both actual competing-revoker/pool jobs (64 and 256KiB), two full original HTTP stress jobs (100/300 cutover rollback), multiprocess outbox crash, commercial revision, independent PG TCP refusal and AES-GCM manifest forced restart passed. [Sequence/offline regression 41330270772](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41330270772) also SUCCESS for same SHA.
- [First 8-job attempt 41330073517](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41330073517): two competing-revoker jobs **FAIL** because the negative `LOCK TABLE` test was outside a transaction and produced `25P01` rather than testing privilege; corrected by wrapping the statement in a real transaction.
- [Second attempt 41330159146](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41330159146): initial code falsely passed because two revokers had been queued behind 300 reader tasks in the **same executor**, so 288/300 reader attempts were authorized before the writer threads ran. This was detected by inspecting the logs and **corrected**: writers now start independently while readers have active shared locks, with a hard requirement that >=150/300 attempted accesses are denied. Never use the earlier result as proof of writer priority.
- [Commercial full HTTP cutover baseline 41330564997](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41330564997), SHA **`ce245e17f070e6bf99582c12827f3f3e8554e5e7`**: one job PASS, 50 proxy admission slots; **excessive RAM**.
- [Commercial full HTTP with 12-slot limit 41330719240](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41330719240), SHA **`8e8420d38a9ec9c0802a67a999ad25812c805228`**: one job PASS; lower RSS and higher P99. Separate original sequence/offline run [41330719252](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41330719252) was triggered for this revision; consult its conclusion if needed.
- All CI runs are disposable GitHub Actions with isolated `postgres:17-alpine`; no deploy steps or production credentials. Previous versions and tests remain in the experimental branch.

## Minimum privileges and SECURITY DEFINER/RLS negative checks

Disposable roles `qa_v2_guard_owner` (NOLOGIN), `qa_v2_stream_login` and `qa_v2_revoke_login` (both NOINHERIT, non-administrative). Guard tables use FORCE ROW LEVEL SECURITY, isolated SECURITY DEFINER functions have a hardened `search_path`, and caller roles lack direct INSERT/UPDATE/DELETE/GRANT/ALTER capability on protected relations. Identities are derived from actual `session_user`, not user-supplied JWT GUC values.

**38 negative checks** (22 original + 16 additional) correctly denied direct table mutation, privileged role escalation, a function replacement, dropping FORCE RLS, granting table privileges, cross-role RPC calls, exclusive table locks and forgery. Temporary schema shadowing did not redirect the privileged function or allow a cross-tenant request. Synthetic tests do not prove all real Supabase SECURITY DEFINER, Auth, JWT/JWKS, service roles or superuser protections.

## Competing writers, bounded pool, 300 slow socket sends

Two **independent revoker threads** compete against 300 submitted slow socket-write tasks with a **hard maximum of 12 PostgreSQL login sessions**. Sender and receiver are Linux `socketpair`, the receiver does not consume and a 105-ms socket send timeout forces actual kernel backpressure. Revocation `begin_revoke` first commits a `pending=true` flag. All new signed synthetic stream admissions then use a shared PG advisory transaction lock and reject pending or revoked memberships; `finish_revoke` uses the matching exclusive lock.

| Measured result | 64 KiB | 256 KiB |
|---|---:|---:|
| Submitted attempts | 300 | 300 |
| Peak PG sender sessions | **12** | **12** |
| Accepted before pending flag | 12 | 12 |
| Denied pending or revoked | **288** | **288** |
| Actual saturated socket send timeouts | 12 | 12 |
| Writer #1 commit elapsed | **107.867 ms** | **109.421 ms** |
| Writer #2 commit elapsed | **110.104 ms** | **111.902 ms** |
| Pool wait timeouts / other errors | 0 | 0 |
| Recovered PG lock after a separate OS-process crash | **12.237 ms** | **8.770 ms** |

No starvation was observed and no active PG connection was leaked in this test. A synthetic child exited with code 91 while holding an advisory transaction lock; PostgreSQL released the session lock and the revoker then committed. **300 queued tasks are NOT 300 simultaneous live PG connections or slow remote TCP clients.** No inter-host half-open test, kernel delivery timing guarantee, or general 1-second fairness SLA has been demonstrated.

## Complete original 100/300 HTTP report+export, actual cutover and rollback

Two OS-process report servers on the same disposable runner, not two physical hosts. Source is the exact original GitHub report + 10,000-row event export RPC for each of two companies; 20,664 original synthetic playback rows retained. Prewarmed full report `2,793,510` uncompressed bytes per tenant, gzip level 3 `~350,985` bytes. SHA-256 checked per HTTP client. Max 20 admitted HTTP streams per worker in this particular stress test; the PG pool limit of 12 is a **separate** workload.

| Chunk size | 100 P95 / P99 ms | 300 P95 / P99 ms | Core auth+shared fence SQL instructions | 400 gzip HTTP responses |
|---|---:|---:|---:|---:|
| **64 KiB** | 2,762.407 / **2,775.225** | 7,625.369 / **7,768.134** | **5,622** | **400/400 HTTP 200** |
| **256 KiB** | 2,012.493 / **2,027.408** | 4,995.493 / **5,392.781** | **2,414** | **400/400 HTTP 200** |

The 300-client wave exercises an in-flight OLD→NEW→OLD cutover with >=80 explicitly delayed requests after rollback; 64KiB job had **238** OLD-after-rollback assignments; 256KiB had **231**. Both protected per-chunk application write calls with PostgreSQL shared advisory transaction locks; the competing revoker commit followed the protected write and an injected stall was aborted after **300ms**, with revocation commit measured **292.4/293.4 ms** respectively. The writer must cooperate with the exclusive lock; bytes queued in kernel buffers may still arrive after commit. This is NOT strict zero-**delivered**-bytes revocation.

Both 64/256 jobs transferred **140,394,200 bytes gzip** over the 400 complete responses, versus **1,117,404,000 uncompressed bytes**. Warm P99s across independently loaded runners are indicative, **not controlled causal guarantees**. 256KiB reduces observed core SQL calls but can hold a larger protected socket send and demands separate real slow-network SLA verification.

## Commercial coherence in the same staged HTTP cutover/rollback flow

A supplementary **full original HTTP report/export + commercial name/revision** QA uses a stable reverse proxy, two OS-process commercial report workers and original 10,000-event export. **Stage 1:** 100 HTTP 200 with original campaign on OLD. **Stage 2:** 100 HTTP 200 with original campaign on NEW after cutover. **Stage 3:** commit a revised campaign without NOTIFY, require HTTP **503** from **both** stale caches, replay the durable outbox in both processes, require NEW to return updated content and OLD after rollback to serve **100 HTTP 200** with correct revised campaign. All 300 SHA-256/10K-row checks PASS. This is staged 100+100+100, **NOT 300 clients crossing a simultaneous revision+cutover race**.

| Admission slots in proxy | OLD stage P99 | NEW stage P99 | post-replay rollback stage P99 | Worker A/B peak RSS |
|---|---:|---:|---:|---:|
| 50 | **9,591 ms** | **9,460 ms** | **9,528 ms** | **840,484 / 837,120 KiB** |
| **12** | **13,496 ms** | **15,573 ms** | **13,210 ms** | **264,804 / 271,240 KiB** |

Admission capped at 12 reduces the memory peaks by roughly **68.5% / 67.6%**, but increases latency. Different runners and independent process runs; results are not controlled A/B proof. Both batches had 300 complete reports and gzip egress **106,105,000 bytes** including commercial JSON metadata, with database **22,001,331 bytes**, source index **9,805,824 bytes**, and WAL sampled after 20K synthetic events **488,240 bytes** for the 12-admission run. This is an **important NO-GO capacity discovery**: the unconstrained commercial handler is memory-heavy under concurrent full JSON serialization. No production admission limit chosen or deployed.

## Outbox, PostgreSQL connection failure and AES regression

- Full durable outbox checkpoint crash matrix PASS: transaction abort before commit, producer killed immediately after COMMIT/no notification, consumer killed after read/before receipt, killed inside receipt+checkpoint transaction, and killed after durable COMMIT/before response; restart sees exactly-once processed receipts. PostgreSQL IDENTITY gaps are accepted. Two distinct publisher OS-processes generated IDs **[4..11]** concurrently with two consumer OS-processes; all events replayed in identical order.
- A separate driver-level refused PostgreSQL TCP connection (localhost port 1) during paused HTTP stream aborted the remainder, denied new requests with HTTP 503 and recovered after reconnect; not a real cluster outage.
- Commercial exact concurrent 6-publisher/2-consumer overlap and SHA-verified HTTP content passed. The intentionally unsafe check-before-write scenario again leaked **16,384 gzip bytes after revoke commit**; revalidation in a controlled pause delivered zero bytes but does not eliminate the final race.
- Remote simulated AES-GCM manifest: corrupted/partial PUT rejected, separate object server forcibly killed and restarted, immutable version and PENDING/READY publication recovered. **Four PUTs totaling 680 bytes; one GET of 168 bytes**, tiny manifest only. No real media/video GET or Supabase Storage measured.
- Independent genuinely cold full uncompressed HTTP baseline: **100 P95/P99 8,844/8,874 ms**, **300 P95/P99 10,532/10,580 ms** with 4 complete SQL rebuilds/wave. Different runners and modes from the prewarmed gzip tests.

## Memory, WAL, indexes and cost — isolated measurements

| Metric | 64KiB full HTTP | 256KiB full HTTP | Low-memory commercial (12 proxy slots) |
|---|---:|---:|---:|
| PostgreSQL database bytes incl indexes | **21,821,107** | **21,821,107** | **22,001,331** |
| Original playback index bytes, included in DB | **9,805,824** | **9,805,824** | **9,805,824** |
| WAL delta **after** original 20K rows inserted | **215,784** | **215,720** | **488,240** |
| HTTP worker A/B peak RSS KiB | **72,408 / 72,120** | **78,884 / 72,156** | **264,804 / 271,240** |
| Remote encrypted-manifest GETs | 0 (not exercised) | 0 | 0; separate AES job **1** |

Note that PostgreSQL service RSS, other processes and kernel socket buffers are not included in each worker RSS and cannot simply be added as total cluster RAM. WAL excludes the original insert of historical 20K events; differences in post-fixture WAL are not causal evidence of HTTP chunk sizing.

**Monthly engineering model, not Supabase billing:** 1 complete compressed report/client/day for 30 days, two replica outbox MAX-ID probes per 30s optionally adding 172,800 SQL reads/month, 64KiB uses `2×(1+ceil(351k/65536))=14` core auth+fence SQL instructions/report, 256KiB uses 6/report. 100 client reports/month 3,000 and gzip egress ~**1.053 GB**, 300 reports/month 9,000 and gzip ~**3.159 GB**.

| SQL model (excluding full SQL reports, claim configuration, transactions, events, retries and media) | 100 clients | 300 clients |
|---|---:|---:|
| 64KiB core + optional 30-second reconciliation | **214,800** | **298,800** |
| 256KiB core + optional reconciliation | **190,800** | **226,800** |

All monetary R$ costs and Free-plan capacity remain **unknown/unverified** because official Supabase was not consulted as requested.

## Hard NO-GO gates

1. No universal zero-byte-after-revoke delivery guarantee; application advisory fence covers cooperating writer/server write calls only, not already-buffered TCP data.
2. Synthetic least-privileged FORCE-RLS/SECURITY DEFINER roles do not prove the official Supabase role/topology. Bypass by privileged or uncooperative writer remains possible, and JWT/JWKS/Auth are synthetic.
3. 12 PG sessions and 300 slow queued socketpair requests are **not** 300 simultaneous cross-host TV connections. Two actual concurrent revokers passed this narrow fairness test; no sustained days-long starvation or real network-partition proof.
4. The commercial report worker had **~800 MiB RSS** with 50 concurrent proxy admissions; lowering to 12 reduces memory but P99 rises to 13–16s. Need better bounded JSON serialization/memory use and production capacity controls.
5. True distributed hosts, failover, outbox fencing against non-cooperating writers, long-term WAL/receipt retention, real media egress/GETs, external AES KMS/storage and provider billing remain untested.
6. No production rollout without independent security SLA and capacity verification.

**Strict restriction followed:** no official Supabase even in read-only, production data/history, GitHub main, APK, site/Vercel, panel, TVs or production deploy. Only experimental GitHub branch and disposable PostgreSQL17 GitHub Actions were altered/run. **NO-GO.**
