# Vision V2 — 300-client admission drain and recoverable AES generation receipts

**Date:** 2026-11-01. **Experimental branch ONLY:** experiment/vision-v2-sequence-watermark-qa-20261031.
**User-specified starting commit:** 8b9cba122a02466388a0f7cda2a9c164813c4af3.
**Verified code and CI commit:** 7633bac865405229216b74360bdc77efd653432c.

**Verdict: PASS for disposable PostgreSQL17 QA, PRODUCTION NO-GO.** No official Supabase (including read-only), production GitHub branch, APK, panel, Vercel, site, TVs or real histories accessed or altered. No deploy.

## Executed and verified GitHub Actions

- [Six final drain jobs, all PASS, workflow 41342174441](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41342174441): matrix 8/12/20 persistent PostgreSQL sessions per process × gzip 64/256 KiB; 300 simultaneous mixed requests spanning OLD→NEW→OLD routing and a committed commercial change, 100+100 current post-replay reports, signed JWT and synthetic RLS revocation/restore, SHA256 complete report, sampled WAL.
- [Three crash-recovery AES generation receipt jobs, all PASS, workflow 41341950002](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41341950002): child OS process killed after first file rename, second file rename, or after manifest publication before SQL COMMIT. Atomic generation pointer, PostgreSQL17 PREPARED→COMMITTED receipt, strict SHA/HMAC, pinned sealed memfd and generation GC. Tested at earlier code commit 55f928bed4a9f8662f0be85ddc8c6e056f2084ee; keyring source remains unchanged at final code commit.
- [Twelve unchanged full-system QA regressions, all PASS, workflow 41342174434](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41342174434) at the same final code SHA: full 10K-row JSON old/new/rollback and simultaneous 300-client cutover, two concurrent revokers with slow socket timeout, negative FORCE RLS/SECURITY DEFINER, multi-process durable outbox/checkpoints and forced crash, encrypted archive integrity, AES-GCM simulated remote manifest, original cold HTTP 100/300.
- [Separate sequence/offline QA 41342174410](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41342174410): PASS.
- The initial drain workflow 41341659374 had **5 PASS, 1 FAIL**: one 100-client wave after cutover unexpectedly encountered transient 503 but its older verifier did not retry. Updated test repeats only idempotent GET/503 up to five tries and a 7.5-second budget; revoked 401, invalid SHA and truncated 200 NEVER retry. Prior failures preserved.

## What was implemented in isolated QA

**Bounded admissions drain:** A new loopback reverse-proxy handler closes old-route admission at cutover, atomically redirects new admissions to the new instance, tracks previously admitted old-port HTTP requests and waits up to a configured 420ms for old activity to quiesce; retrying clients are reauthenticated at the back end on each attempt. The two old→new→old switches run while all 300 clients are actively submitted. Existing matching shared/exclusive PostgreSQL transaction advisory locks still cover every application HTTP body write and synthetic commercial revision/membership revocation. The test has a bounded 18ms gate and 503 Retry-After, client maximum five GET attempts, maximum 7.5s end-to-end and no retry after an incomplete 200. The final test revokes one tenant membership and confirms exactly **one HTTP 401, zero body bytes, no retry**, then regrants under the exclusive lock and verifies current SHA-256 report.

**Durable AES rotation:** New independent synthetic PG17 receipt protocol uses a wrapped AES generation key per key-id, plus parent generation, expected file hashes and PREPARED/COMMITTED SQL states. Each new generation uses unique AES-GCM ciphertext files. The authenticated active-generation manifest is atomically replaced after files are fully fsynced. Before the durable receipt is COMMITTED, any reader that sees the new manifest FAILS CLOSED. Recovery reconstructs missing new-generation ciphertext from prior committed generation, verifies all four SHA-256 content hashes and finalizes the receipt. GC after COMMITTED deletes four old-generation ciphertext files without invalidating an already pinned sealed memory descriptor. This is a disposable prototype: wrapping MASTER is a hardcoded synthetic test-only secret, not a provider KMS.

## Final measured 300 HTTP drain matrix

Every job: 300/300 COMPLETE compressed original 10,000-row report JSON verified by SHA-256, **zero final HTTP 503**, zero incomplete, two actual cutover/rollback route switches, zero observed drain deadline failures, one revoked-user JWT/RLS 401 with NO retry and subsequent valid regrant. Transient 503 from admission/commit remain permitted within client retry budget.

| Pool/HTTP cap per process | Chunk | 300 P95 ms | P99 ms | 503 transient | Max observed old-port drain ms | Auth/revision guard calls | WAL delta bytes after fixture |
|---|---:|---:|---:|---:|---:|---:|---:|
| 8 | 64KiB | 2030.229 | 3100.333 | 16 | 144.814 | 3528 | 487880 |
| 8 | 256KiB | 1866.614 | 3044.714 | 11 | 140.384 | 1513 | 487880 |
| 12 | 64KiB | 1867.407 | 2901.860 | 12 | 325.279 | 3529 | 487880 |
| 12 | 256KiB | 1616.317 | 2386.483 | 9 | 210.024 | 1512 | 217440 |
| 20 | 64KiB | 1456.093 | 2353.855 | 16 | 352.909 | 3528 | 213824 |
| 20 | 256KiB | 1528.477 | 2036.139 | 20 | 129.679 | 1512 | 484256 |

Measured **worst drain wait 352.909ms in the FINAL run**, under configured 420ms. HOWEVER an earlier independent run observed 451.671ms due to OS scheduling. A strict 420ms SLA is **NOT PROVEN**; final test checks less than 500ms. Customer end-to-end maximum seen across six trials was 3534.489ms, under 7500ms. These are 300 concurrent HTTP submissions, **not 300 PostgreSQL sessions**, and independent CI runners are not a controlled comparison.

At 12 connections and 256KiB: PostgreSQL connections opened **12 per process**, 1068 and 454 borrows respectively (real reuse); 1512 instrumented membership/revision guard invocations for mixed 300 + follow-ups; worker peak RSS **67200 / 67364 KiB**, excluding the Postgres service, coordinator and kernel. The successful compressed 300-report wave transferred **105,518,588 bytes gzip**; follow-up 100+100 reports were also SHA verified and served the current commercial revision. PG database **22,001,331 bytes** including playback index **9,805,824 bytes**. WAL during post-fixture request/membership activity **217,440 bytes**. WAL deliberately excludes initial 20,664 synthetic history inserts and is not actual 30-day live WAL.

The exact number of SQL statements is higher than guard invocations (per-transaction role/claims, advisory lock, revision, membership, connection and outbox SQL); do not interpret 1512 as total SQL statements.

## Key-rotation crash matrix

| Crash point | Exit code | Manifest before recovery | Checkpoint state | Verified recovery |
|---|---:|---|---|---|
| After first file rename | 94 | old gen 0 | PREPARED | roll-forward new gen 1, four SHA checks PASS |
| After second file rename | 95 | old gen 0 | PREPARED | roll-forward new gen 1, four SHA checks PASS |
| After manifest published but before SQL commit | 96 | new gen 1, READS BLOCKED | PREPARED | verify all 4 AES files then COMMITTED, PASS |

All three: PostgreSQL receipt 2 durable rows, HMAC manifest tamper rejected, idempotent recovery, four old ciphertext files safely deleted, pinned sealed original descriptor still readable. Synthetic keyring fixture database **7,739,059 bytes**, remaining encrypted data and manifest **973,477 bytes**, parent RSS about 62–64MiB. These key-management fixtures are smaller than original 20K-row HTTP report workload; results are not comparable as general PostgreSQL capacity metrics.

## Independently revalidated regressions, GETs and costs

The 12-job full regression covers synthetic JWT/RLS and minimum privileges, two concurrent revokers, app writes under shared advisory transaction locks, process crashes and outbox durable checkpoints, and AES-GCM remote-manifest force-crash recovery. The simulated tiny remote encrypted manifest was previously instrumented as **1 GET (168 bytes) / 4 PUTs (680 bytes)**; this does **NOT** include any actual TV media/video/image GETs or production Storage egress.

Assume EXACTLY one full gzip commercial report (about 351.75KiB compressed) per client per day, for 30 days. 100 clients -> 3,000 reports, about **1.055GB gzip egress**. 300 clients -> 9,000 reports, about **3.166GB gzip egress**. Neither includes retries, advertisements/media, device heartbeat, GET/PATCH or real storage.

| Engineering monthly SQL (approximate; includes OPTIONAL 30-second two-replica outbox poll, not enabled in these jobs) | 100 clients | 300 clients |
|---|---:|---:|
| 64KiB ~50 SQL statements/report +172800 poll | 322800 | 622800 |
| 256KiB ~22 SQL statements/report +172800 poll | 238800 | 370800 |

These are not exhaustive measured SQL counts and not actual provider charges. No Supabase Free quota or BRL bill verified, per production-access restriction.

## PRODUCTION NO-GO blockers

1. Backend still generates transient HTTP 503; 0 FINAL 503 was verified only for six bounded client-retry synthetic runs. Graceful drain is a single-runner loopback proxy, not a distributed cloud admission-drain protocol. No hard 420ms OS scheduling guarantee or real TV end-to-end SLA.
2. Authenticated old campaign bytes already buffered before SQL revocation/commit can still be delivered later; the protected guarantee concerns **new application write calls after a cooperating PostgreSQL transaction commit**, not all network bytes received after commit. Full real authorization/revocation writer privileges and actual JWT/JWKS untested.
3. AES generation recovery is only a single-filesystem + synthetic PG17 receipt prototype. Synthetic MASTER secret is embedded in fixture code; production KMS/HSM, cross-host filesystem semantics, hard power loss/FSYNC, DB/network partition and signing-key custody are NOT proven.
4. Two OS processes on ONE CI host, not independent hosts or live TV Boxes; no real media egress/GETs, playback traffic, real Supabase plan connection quotas, cloud provider billing or monthly physical WAL retention modeled or accessed.
5. Per-worker PostgreSQL pools 8/12/20 mean 16/24/40 connections for two replicas; actual provider pooling, distributed fencing, 30/90-day storage retention and sustained real 300-TV load remain untested.

**Verdict: QA PASS, production NO-GO; no deploy and no official data access.**
