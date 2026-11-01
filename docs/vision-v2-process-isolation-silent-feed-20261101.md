# Vision V2 — Two OS-process replicas, silent LISTEN failure and commercial JSON revision (QA only)

Date: 2026-11-01. Branch: `experiment/vision-v2-sequence-watermark-qa-20261031`.
Tested code HEAD: `32e6d24cfdae309b1cce10a4db33a255f044a7a1`.

**Decision: PASS for isolated synthetic QA; GO for further QA only; NO-GO for production.**

## Verifiable GitHub Actions

- [Final full run 41310376640](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41310376640): both disposable PG17 jobs **success**, `QA_PROCESS_PG17_PASS=true`.
- [Sequence/offline regression 41310376625](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41310376625): **success**.
- [Prior corrected counter run 41310194206](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41310194206): **success**.
- [Initial failed 41309924145](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41309924145) failed at Bash `set -u` because `SUPABASE_URL` was absent; fixed to `${SUPABASE_URL:-}` in `4d0e798f` before any SQL workload ran. No impact on production.

## Test design and actual guarantees

- PostgreSQL **17-alpine** disposable service, GitHub original playback/report SQL unmodified in QA, original full report JSON and export equality verified from synthetic fixture.
- Two HTTP replicas in genuinely **different operating-system processes** (two distinct PIDs per quota), each with independent authenticated cache, archival segment LRU, dedicated PG LISTEN connection, own DB connections.
- One QA heartbeat producer using **a single reused PostgreSQL connection**, rather than opening a connection on each pulse. Listener freshness is checked at every HTTP request and before ACK, **without query-per-request polling**.
- QA heartbeat interval **0.45 s** and lease **1.8 s** are accelerated for verification, **NOT production parameters**. Blackholed (silently discarded) LISTEN messages trigger HTTP 503 only after the lease expires. This is **bounded failure detection**, not instantaneous zero-gap revocation.
- While the disconnected replica denies requests, another replica commits revocation in PG and receives NOTIFY. On reconnect, the disconnected process reloads durable revision and ACL and denies revoked JWT; later restoration permits access. Validation uses synthetic HS256 JWT/RLS only; real Supabase Auth not queried.
- Actual synthetic commercial change updates **306** playback event campaign-name snapshots and **306** AES-GCM archive source snapshots, updates manifest hashes and the original-RPC comparison baseline; complete report JSON SHA changes from `37e4ed...` to `1d9b12...`, and company B's JSON remains unchanged.
- **20,000 additional older synthetic events** inserted, totaling **20,664** original events; source events retained; no permanent duplicate event read model. Historical events outside report dates were **not** CQRS-backfilled nor queried as a 20,000-event full JSON report; do not treat as full-history performance proof.
- Archive outage forces HTTP 503 and no ACK, then recovery; JWT cross-tenant/expired, real synthetic PostgreSQL RLS and source-RPC membership checked.
- Two PIDs independently pass 100/300 concurrent HTTP at quotas 110,000 / 512,000 / 2,000,000 bytes, cold and warm: **12 waves, 2,400 successful HTTP responses**, no queue timeouts, <=12 concurrent SQL tasks per replica.

## Final 100 and 300 HTTP performance (P95/P99 milliseconds)

| Quota/tenant | Clients | Phase | P95 | P99 | Archive GET | SQL reconstruct |
|---|---:|---|---:|---:|---:|---:|
| 110 KB | 100 | cold | 1,404.257 | 1,547.593 | 59 | 58 |
| 110 KB | 100 | warm | 1,415.120 | 1,538.492 | 43 | 57 |
| 110 KB | 300 | cold | 2,891.029 | 3,494.393 | 126 | 104 |
| 110 KB | 300 | warm | 2,889.084 | 3,503.117 | 148 | 121 |
| 512 KB | 100 | cold | 1,207.546 | 1,247.730 | 20 | 49 |
| 512 KB | 100 | warm | 759.783 | 819.966 | 0 | 37 |
| 512 KB | 300 | cold | 1,277.427 | 1,369.612 | 20 | 50 |
| 512 KB | 300 | warm | 723.195 | 867.298 | 0 | 36 |
| 2 MB | 100 | cold | 969.591 | 1,045.321 | 20 | 48 |
| 2 MB | 100 | warm | 27.884 | 32.133 | 0 | 0 |
| 2 MB | 300 | cold | 1,193.192 | 1,297.201 | 20 | 48 |
| 2 MB | 300 | warm | **28.924** | **38.066** | **0** | **0** |

This is a synthetic repeated workload; latency is not a production SLA. No causal comparison to earlier 1-process tests should be claimed. Across all quotas and the extra security preflights, **484 archive HTTP GETs**; GET count is not a production monthly bill.

## Storage, indexes, RSS, traffic-based cost model

- Disposable PG database: **25,851,571 bytes**, including **9,830,400 bytes** source history indexes and **16,384 bytes** daily summary indexes. Index figures are *included* in database bytes; do not add them twice.
- Per-replica Python RSS during final 2 MB quota: **135,892 + 137,792 KiB**, about **267.3 MiB combined**, EXCLUDING the PostgreSQL service and the parent/coordinator process. The ~4.2 MB aggregate result-cache peak and 514,750 bytes segment-cache peak are *already* inside Python RSS.
- One persistent PG connection sent **76** QA heartbeat statements across the run with **0 producer failures**. At the deliberately accelerated 0.45-second QA interval, an unchecked extrapolation would yield **5,760,000 statements per 30-day month**, which is unacceptable as a production default for a low-request architecture. At a hypothetical 60-second **global** interval this would be **43,200 statements in 30 days**, but the safe lease/latency tradeoff and failure timing at that cadence were **not** tested.
- The benchmark cannot assign verified Supabase Free monthly cost, egress fee, object-storage cost, replica memory bill or true 300-TV capacity. We estimate measurable *cost drivers* only: SQL heartbeat count, HTTP GET, database/index bytes, memory. The test's cached commercial JSON parity requires the encrypted archive; it does not demonstrate deleting historical originals.

## Open blockers — no production promotion

1. Real multi-host and/or container restart with silent TCP network partitions; durable invalidation/outbox and event replay ordering. PG NOTIFY is not a durable queue.
2. Production Auth JWT/RLS and revocation with key rotation, expired sessions, membership changes, scoped cache hits, and bounded failure-detection lease. Current ACL and JWT are synthetic.
3. Atomic coupling of actual campaign/media mutation, archive manifest version and revision. The QA demonstration uses ordered local file replacement then PG NOTIFY, not a production-safe distributed transaction.
4. Realistic 7-day/30-day report windows over 20K+ events, summaries and archival lifecycle, WAL/IOPS/PG RSS, database index retention and complete cost. Older synthetic rows were inserted only for database/index growth.
5. Select a **low-frequency, shared** heartbeat/reconciliation strategy with failure safety, persistent connections and measured overhead; do NOT deploy the 0.45-second QA pulse.
6. Simulate 100 and 300 real device/client workloads over longer duration with changing keys, not just 48 repeating report filters. Do not touch production until GO criteria are independently satisfied.

**Scope guard:** No official Supabase consultation or changes; no APK, panel, website, TV, live history or migrations touched. Code and docs changed only on the user-selected experimental branch.