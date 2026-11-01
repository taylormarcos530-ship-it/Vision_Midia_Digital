# Vision V2 — ordered durable replay, commercial cache invalidation, PG connection fail-closed and 100/300 rollback

**Date:** 2026-11-01. **Repository:** `taylormarcos530-ship-it/Vision_Midia_Digital`.
**Experimental branch only:** `experiment/vision-v2-sequence-watermark-qa-20261031`.
**Starting commit:** `714cc83029407ad95c79d51aad6621d338a95186`.
**Last tested code SHA:** `312353210beb0e5ceb4893f0a126485d58ba3f45`.

**Decision: isolated PostgreSQL 17 QA PASS. GO for more QA only. PRODUCTION NO-GO.**

## GitHub Actions evidence — real logs

- [Run 41319192983](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41319192983) — **3/3 SUCCESS** from SHA `312353210beb0e5ceb4893f0a126485d58ba3f45`, all runners on disposable PostgreSQL `17-alpine`:
  - Job `124885586642`: durable order, replay across hard process exit, commercial cross-process invalidation, PG TCP failure and stream-lock tradeoff, `QA_ORDERED_FENCE_PASS=true`.
  - Job `124885586859`: complete gzip JSON on 100 clients, then 300 clients crossing cutover and rollback, RLS under blackholed LISTEN, `QA_ROLLBACK_PASS=true`.
  - Job `124885586445`: forced process stop/restart of remote HTTP AES-GCM manifest simulation, original cold full JSON HTTP 100/300, JWT synthetic checks, `QA_COLD_REMOTE_PASS=true`.
- [Sequence/offline regression run 41319192930](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41319192930) — **SUCCESS** on same SHA.
- [First attempt 41319109170](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41319109170) — **FAIL**: QA incorrectly assumed PostgreSQL IDENTITY sequences are gap-free after rollback. PostgreSQL legitimately consumed ID 1 in a transaction that subsequently aborted; committed events started at ID 2. The final test correctly accepts identity gaps and proves no gaps in **committed event processing**. No production change.

## Ordered durable outbox, two consumers and commercial cache

- A **synthetic global PostgreSQL advisory transaction lock** serializes writer transactions before allocating the outbox identity; this prevents one event ID from committing after a later ID in this specific QA producer implementation. It can contend at scale and does not protect against an external writer bypassing the lock.
- Separate transactional change of campaign name and immutable outbox row, with rollback test.
- Four commits from two companies issued through a thread pool produced committed IDs **2, 3, 4, 5**; ID 1 was consumed by an aborted transaction. QA deliberately terminated consumer 0 with `os._exit(78)` immediately after persisting its first receipt and cursor. A newly spawned OS process resumed from ID **3, 4, 5**, while independent consumer 1 replayed **2, 3, 4, 5**.
- A further commercial change was committed with **no NOTIFY**. Before replay, both consumer-process caches returned **503** for the affected company instead of stale values; the other company remained usable. After explicit durable replay, both saw the revised campaign.
- Independent durable checkpoints ended at **ID 6** for both consumers, and PostgreSQL had exactly 10 receipt rows (5 committed events × 2 consumers), with **no duplicate durable effects**. Local cache state after restart was reconstructed from already processed events.
- In the QA commercial lookup, each request checked the authoritative version against PostgreSQL; this is **per-commercial-lookup SQL**, not free read-side invalidation. It is not a full commercial HTTP endpoint test; the two commercially cached states are tested through interprocess commands and actual PG reads.
- Additional synthetic outbox table and indexes: **49,152 bytes**, processed receipt table **24,576 bytes**, checkpoint table **24,576 bytes**. Those are part of the database size.

## PostgreSQL outage fail-closed and revocation comparison

**Baseline per-block authorization** (separate rolling job):
- Synthetic JWT and active membership are verified against disposable PostgreSQL before HTTP headers and again before each gzip body chunk. A deterministic pause after the first 16,384 bytes allows revocation to commit while LISTEN is deliberately silenced. The next chunk is rejected with **zero additional bytes**, truncated Content-Length, and no new authorized response.
- Real refused TCP connection was tested by pointing the report server's QA PostgreSQL driver at `127.0.0.1:1` during a paused gzip HTTP stream. No later bytes were delivered; new requests returned HTTP **503**; restoring the valid PG17 DSN restored **200**. This is a genuine driver-level TCP connection refusal, but **not** a PG17 server shutdown, firewall blackhole or all-host outage.
- The time-of-check-to-time-of-write gap within one chunk remains **not proven zero**. HTTP 200 headers and already-sent bytes cannot be rolled back.

**Alternative per-stream PostgreSQL lock** (separate ordered-fence job):
- Hold a synthetic PostgreSQL **shared transaction-level advisory lock** across the stream, with one membership SQL validation; revocation writer needs exclusive lock before its commit. The test proved the writer could not commit while reader held the lock and that a 100 ms lock timeout can abort the writer.
- This prevents successful revocation commit while the stream lock is held, **at the cost of delaying or failing revocations for slow/stalled clients** and holding DB connections. Therefore the alternative is **NO-GO for an immediate-revocation SLA**, despite one authorization SELECT per stream. This comparison measures correctness and a lock-timeout negative case, **not** a fair full 100/300 HTTP A/B benchmark of the lock alternative.

**Low-traffic revision reconciliation**:
- Separately from membership checks, a one-query-per-replica-per-30-seconds **outbox MAX-ID** reconciling task catches missed NOTIFY when triggered/reconnected. During the final 400-client rolling run it recorded **8 background queries total** for both replicas, with an explicit idle/forced sync test in the ordered replay suite.
- As a 30-day cadence model: two replicas × one outbox SQL read every 30 seconds = **172,800 background SQL calls/month**, versus the earlier experimental two replicas × two companies × one membership SELECT every 2 seconds = **5,184,000** calls/month. That is a **96.667% modeled reduction** for the *background loop only*.
- Per-chunk SQL membership checks are **additional**: in the rolling job there were **1,218 successful member-check SQL reads** (1,107 + 111), including the 400 client load and follow-up security probes. This is not a full count of every SQL statement (failed checks, prewarm RPC, test setup and writes are separate).
- Strict instantaneous revocation has **not** been established under arbitrary PostgreSQL failure, host partition, or the interval between check and socket write. None of these QA settings is approved for production.

## Full original report/export via HTTP and cutover/rollback — final same-run QA

Synthetic **20,664** playback events retained, 10,000 historical records per company; original GitHub report/export RPCs, unmodified, serialize **2,793,510 bytes** per uncompressed company export. Cached gzip output used after controlled prewarm; each HTTP client received full JSON including 10,000 rows with SHA-256 checked.

| Workload | P95 | P99 | HTTP 200 | gzip egress | Raw equivalent |
|---|---:|---:|---:|---:|---:|
| 100 requests while the replacement prewarmed | **2,104.858 ms** | **2,135.118 ms** | 100/100 | **35,098,550 bytes** | 279,351,000 bytes |
| 300 requests across real OLD → NEW → OLD cutover/rollback | **5,083.727 ms** | **5,461.123 ms** | 300/300 | **105,295,650 bytes** | 838,053,000 bytes |
| **Total** | — | — | **400/400** | **140,394,200 bytes** | 1,117,404,000 bytes |

- During the 300-client wave: **38 OLD assignments before cutover**, **31 NEW assignments**, **231 OLD assignments after rollback**, including at least 80 deliberately held until the router had rolled back. Both process gateways remained ready, peak 20 active admitted requests each. All 300 returned complete gzip JSON with no router error.
- These are **two OS processes on one runner**, not separate physical hosts or network regions.
- Both replicas rebuilt the full synthetic result twice during prewarm (4 original RPC computations total). Prewarm took **13.298 and 20.360 seconds**. A brand-new site with zero existing ready replicas still has real cold startup cost.

### Independent cold baseline (non-gzip; separate runner on identical code SHA)

| Concurrent HTTP | P95 | P99 | Full SQL result reconstructions | Egress |
|---|---:|---:|---:|---:|
| 100 | 12,463.208 ms | 12,476.299 ms | 4 | 279,351,000 bytes |
| 300 | 15,468.272 ms | 15,702.293 ms | 4 | 838,053,000 bytes |

This is a different workload and runner: observed rolling vs cold differences are not a controlled same-environment causal latency improvement.

## Storage, WAL, memory and encrypted remote GETs

| Metric | Ordered replay+TCP-failure QA | Rolling 100/300 QA | Separate AES cold QA |
|---|---:|---:|---:|
| Database bytes, inclusive of indexes | **21,943,987** | **21,853,875** | **21,903,027** |
| Source playback index bytes | **9,805,824** | **9,805,824** | **9,805,824** |
| WAL delta **after 20k history inserted**, bytes | **72,872** | **487,168** | **505,328** |
| Child report Python process peak RSS | 64,532 KiB | 69,856 / 68,484 KiB | 83,316 / 84,888 KiB |
| Remote encrypted-manifest HTTP GETs | Not measured | **0** (not used) | **1 GET**, 168 bytes |
| Remote encrypted-manifest HTTP PUTs | Not measured | 0 | **4 PUTs**, 680 bytes |

The remote encrypted object test deliberately corrupted an upload, force-killed and restarted the HTTP object-store process, validated immutable versioning, exactly one durable transaction outbox event, staged PENDING status and SHA-256/AES-GCM READY publication. The GET/PUT totals refer to a **tiny synthetic encrypted manifest**, **not** images or videos played by TVs. Database values include indexes; WAL deltas **exclude loading 20,000 historical rows**. Parent RSS is separate and cannot be simply added to child process RSS as a production memory bill.

## Monthly model, 100 vs 300 clients — not Supabase billing

Assume one complete full gzip report per client/day over 30 days, original synthetic JSON gzip ~350,985.5 bytes, **3 successful membership checks per gzip stream**, 2 replicas each reconciling global outbox once per 30 s, no retries, exclude media downloads and SQL full-report cache misses.

| Model | 100 clients | 300 clients |
|---|---:|---:|
| Full gzip reports/month | 3,000 | 9,000 |
| Report gzip egress/month | **1.053 GB** | **3.159 GB** |
| Per-block authorization SELECTs modeled | **9,000** | **27,000** |
| Shared background outbox MAX-ID SELECTs | 172,800 | 172,800 |
| Modeled subtotal of auth+background SQL reads | **181,800** | **199,800** |

The measured per-block auth counts are slightly affected by error paths and extra probes; the 3/check assumption is a typical successful 350 KB gzip body case, **not** a guaranteed rate for other body sizes. Supabase Free monthly fit, rate/egress fees and any BRL cost have **not** been verified and cannot be inferred from this QA.

## Hard production blockers

1. **Instantaneous revocation gap:** after a successful SQL check and before bytes leave the socket, another transaction can commit revocation. Per-stream advisory locks delay the revoke; neither tested option proves immediate revocation at every arbitrary moment. A formal SLA and security design is needed.
2. Commercial cache invalidation is proven at interprocess IPC/SQL level, **not** integrated and exercised with complete commercial HTTP output after concurrent mutations.
3. The global advisory transaction lock serializing event IDs adds potential writer contention; actual multi-host publisher fencing/throughput, foreign writers that omit the lock, durable pagination and long outage replay remain unproven.
4. Real Supabase Auth/RLS/JWKS and all SECURITY DEFINER access paths were **not** consulted. The source synthetic fixture policies originally lacked association checks; QA hardening was disposable.
5. Real physically independent hosts, actual PG service outage/network half-open, sustained 300-client traffic, real AES object store/KMS and media bandwidth plus provider billing not measured. No approval for 300 real TVs.

**Strict scope:** No official Supabase (even read), GitHub main, APK, Vercel/site, panel, TV or real historical records were accessed or changed. Only experimental GitHub branch and disposable GitHub Actions resources. **PRODUCTION NO-GO.**
