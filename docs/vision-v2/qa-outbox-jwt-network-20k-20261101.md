# Vision V2 — PG17 durable outbox, JWT rotation, 20K historical RPC and real Docker partition

**Date:** 2026-11-01. **Scope:** experimental `experiment/vision-v2-sequence-watermark-qa-20261031`, starting from `ca772431472b3b19442d285ac5a371baf56785ce`.
**Tested code SHA:** `1f55e4d7af258fcb9a330005ab892a2cb67f1682`.
**Verdict:** **PASS for isolated QA; GO to continue synthetic QA only; strict NO-GO for production.**

## Audit trail — real GitHub Actions

- [Outbox, JWT signing-key rotation, full historical original RPC and WAL — run 41311332752](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41311332752): PASS, disposable PostgreSQL 17.
- [Real two-Docker-namespace backend disconnection and recovery — run 41312021308](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41312021308): PASS, unprivileged containers on independent Docker network namespaces on one ephemeral GitHub runner.
- [Sequence/offline regression — run 41312021309](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41312021309): PASS.
- Debugging did encounter failures. First advanced job [41311234726](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41311234726) missed São Paulo/UTC rollover in a synthetic export; date range extended to include 2024-12-31 through 2025-01-06.
- First network jobs [41311584274](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41311584274), [41311659624](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41311659624) and [41311900960](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41311900960) exposed, respectively, runner namespace inspection incompatibility, **healthy-replica loss of NOTIFY heartbeat after a peer-network cut**, and a blocked PostgreSQL notification socket. Final isolated QA mitigation uses a separate periodic database reconciliation channel per replica and fail-closed freshness lease.

## Actual PostgreSQL transaction and security results

- One transaction updates an actual synthetic commercial campaign name, tenant revision and a persistent outbox event. A deliberately injected exception rolls back all three; no partial mutation or orphan event.
- Durable consumer checkpoints persisted in PostgreSQL. Two independent OS processes replay missed events, including an event **without any pg_notify**, and reject repeat replay (idempotent).
- Synthetic HS256 JWT rotates key ID from `a` to `b`, rejects the old key, invalid signatures and expiry, while accepting the new key. This is **not real Supabase Auth signing-key/JWKS integration**.
- Source fixture originally scoped playback table RLS only by company claim. With the user membership deleted, this alone was not sufficient to deny direct SELECT. The new test **locally hardened** the disposable DB policy to require `private.is_company_member(company_id)` and confirmed RLS denial and restoration. **No production policy was modified; a real policy audit is mandatory before promotion.**
- The report and export SQL functions are the original version from GitHub. 20,000 older synthetic playback events were exported **in full** (10,000 per company, 20 pages of 500 each); São Paulo local midnight rollover included.

### Full original report and export on 20K synthetic older events

| Tenant | Full original export rows | Pages | Combined report + export |
|---|---:|---:|---:|
| QA A | 10,000 | 20 | 2,519.912 ms |
| QA B | 10,000 | 20 | 2,701.556 ms |

The complete exports were fingerprinted with SHA-256; all 20,664 source synthetic events were retained. This is not a 100/300-concurrent 20K full-export performance benchmark.

### Database, index, outbox and WAL measurements

| Metric | Measured value |
|---|---:|
| Disposable database before synthetic expansion | 8,861,363 bytes |
| Database after synthetic expansion, outbox and tests | **21,788,339 bytes** |
| Source playback indexes before | 335,872 bytes |
| Source playback indexes after | **9,805,824 bytes** |
| Outbox table + associated indexes | 65,536 bytes |
| WAL written during expansion plus QA transactions | **17,785,624 bytes** |
| Python parent process maximum RSS | 73,224 KiB |

Index sizes and outbox storage are **included in** database bytes; do not add these figures together. WAL delta covers many operations, not just the outbox insert. PostgreSQL daemon RSS, true monthly WAL retention and production IOPS were not measured.

## Real network disconnection test

- Separate, unprivileged Docker containers in distinct Linux network namespaces: `net:[4026532329]` and `net:[4026532393]`, both within one ephemeral runner, with independent frontend and backend Docker networks.
- Disconnect the PostgreSQL backend network of replica B while leaving its HTTP frontend available; B returned **HTTP 503**, never a stale authorized 200.
- Commit a revision 2 in the disposable PostgreSQL while B's backend is isolated; replica A remains healthy. After reconnect, B reloads durable revision 2 and resumes HTTP 200; A stays revision 2.
- A blocked or silently stalled LISTEN connection is **not treated as a reliable health signal**. A distinct bounded per-replica SQL reconciliation channel was required for this PASS. The Docker test used **0.5-second** reconciliation and **1.7-second** freshness lease only for accelerated QA; not production settings. During HTTP waves the independent background reconciliation performed zero and one SQL queries respectively, **not one query per HTTP**.
- Measured Docker memory `24.87 MiB` and `24.91 MiB` for the two small HTTP health replicas (does **not** measure the full commercial result-cache app).
- **100 HTTP** health-check clients: P95 **10.921 ms**, P99 **12.001 ms**.
- **300 HTTP** health-check clients: P95 **10.545 ms**, P99 **12.928 ms**. These requests returned only small revision/health JSON, not commercial reports or exports.

## Low-traffic budget / cost drivers (not a Supabase bill)

- Hypothetical **one global PostgreSQL heartbeat per 60 s** = **43,200 heartbeats / 30 days**, independent of TV count.
- If each of **two application replicas** additionally reconciles revision once per 60 s, that's **86,400 revision reads / 30 days**, a combined budget of **129,600 SQL/notify operations** (assuming no retries or other traffic). This remains a design estimate, NOT tested cadence or proven quotas.
- Incorrect design sending each of 300 TVs a 60-second heartbeat to PG would create **12,960,000 TV heartbeats / 30 days**, before other requests. A global shared heartbeat would avoid 99.667% of those synthetic per-TV pulses, but real comparison requires representative device behavior.
- Fail-closed model with **60-second global pulse + 180-second lease** was checked with a virtual clock, **not for an actual continuous 180-second network outage**. A multi-minute stale-revocation window and availability tradeoff must be resolved before GO.
- The previous synthetic full commercial report HTTP workload achieved 300 concurrent requests on two OS processes at 2 MB with [P99 38.066 ms](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41310376640) warm cache; **this is separate from** the network health JSON P99 above.
- No official Supabase billing, Edge Functions counts, egress, object-storage cost, total production RSS or paid plan cost in BRL was measured.

## Unresolved production blockers — strict NO-GO

1. Hosts genuinely separate from each other (different VMs/regions), forced asymmetric TCP blackholes, timing of live revocation, multi-minute lease expiration and reconnect, and distributed full commercial cache under network failure.
2. Production-grade durable event processing, external object-store manifest versioning, KMS and atomic archive publication: the test proved a PG transaction and outbox, but **did not atomically couple a real external encrypted archive** to the commercial transaction.
3. Supabase Auth/JWKS rotation, actual token revocation, user membership RLS for **all** report/export/cache paths, and key revocation handling; the original synthetic RLS weakness is a release blocker.
4. Per-tenant scaling with realistic 100/300 TV report/export concurrency over 20K+ events, filters changing over time, 7/30-day retention, WAL/IOPS, source/index costs, and cross-instance HTTP response parity after outbox replay.
5. Design and verify a low-frequency, bounded lease/reconciliation plan with measured per-replica SQL load. **Never deploy 0.35s heartbeat / 0.5s SQL reconcile / 1.7s lease** from QA.

**Production scope:** No Supabase project (including read-only), device, APK, panel, website, production SQL, deployed Edge Function, real history or production GitHub branch was touched. Only the user-selected experimental branch and ephemeral GitHub runner resources were changed.