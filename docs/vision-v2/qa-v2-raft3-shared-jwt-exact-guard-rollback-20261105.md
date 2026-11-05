# Vision V2 — independent real Raft / four-PG rollback / shared JWT WSS + HTTPS review

**Date:** 2026-11-05. **Baseline:** a3ec49626760a051df55e8da02cb76b3eea8f0a5.  
**Exclusive QA branch:** experiment/vision-v2-toctou-continuous-guard-qa-20261102.  
**Release status: NO-GO.** Only additive experimental files in this review; no production/official Supabase, APKs, TVs, historical customer data, Vercel, panel/site or main were accessed or changed. Preserve all original versions and negative proofs.

## A. Real Raft quorum, JTI consumption, isolation and foreign clusters

[42065139563 — PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42065139563). Additions: tests/vision-v2-sequence-qa/raft-etcd-qa/raft_api.py, pg_backup.py, verify.py and CI workflow vision-v2-raft-etcd-3node-4pg-rollback-no-deploy.yml.

- **Three actual etcd 3.5.21 Raft members in independent Docker processes**, one separate uncoordinated shadow cluster, one GitHub CI host. API uses atomic /v3/kv/txn: JTI VERSION=0 AND owner company-A AND leader application epoch, write spent JTI in one consensus transaction.
- Two independently launched OS clients with a deterministic barrier racing one JTI: **one ACK, one DENY by CAS**. Reusing consumed JTI: denied.
- Four truly independent disposable PostgreSQL 17 databases/schemas underwent pg_dump and pg_restore; retained JTI in **separate Raft cluster** remained consumed after all 4 restores, even when SQL's local spent records vanished. The Raft global revision did not go backwards.
- **Real Docker leader network disconnection:** remaining 2/3 Raft members elected a new Raft leader and committed a new JTI; old isolated member failed closed. Rejoin denied old spent JTI. Fencing old application term epoch7 after majority advanced term to epoch8 also worked. Application leader election *itself* was NOT implemented or proven.
- 15 local atomic JTI admissions passed; P95/P99 from initial run **2.23/2.76 ms**. Controller RSS ~46,208 KiB; four PG17 restored schema WAL deltas initially ~37,104 B each; amounts depend on timing and CI run.
- Separate unrelated etcd cluster, without cluster ID pin, consumed the **same JTI in parallel**: **SECURITY FAIL** (split-cluster membership). A client with expected cluster ID pinned rejected the foreign cluster. A pinned cluster ID alone does **not** defend restoring a cluster into its old identity; independent hardware monotonic anchor remains absent.
- etcd peers/client connections use plaintext inside disposable Docker network. Does NOT establish production-grade mTLS, three physical hosts, privileged snapshot rollback protection or cost neutrality. No fully isolated two-down partition case was executed in this particular fixture.

Official implementation references: https://etcd.io/docs/v3.5/op-guide/container/ and https://etcd.io/docs/v3.8/dev-guide/api_grpc_gateway/ .

## B. Exact rollback of THREE old voter schemas plus original independent guard

[42065139185 — PASS negative/replay proof](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42065139185). Additions: raft-etcd-qa/real_guard_adapter.py and workflow vision-v2-real-3voter-guard-raft-sharedjwt-no-deploy.yml.

- Imported **unaltered** original quorum-jti-qa/controller.py and guarded-majority-qa/verify.py code and database schema setup. Used real PostgreSQL 17 witness, shadow and anchor voters + fourth independent PostgreSQL 17 guard, all disposable.
- Old signed JWT/JTI spent once by the original guard+2-of-3 SQL system and separately committed to real 3-member etcd/Raft.
- Restored by real pg_restore **all three original qa_quorum SQL schemas plus original qa_guard**, not merely dummy tables.
- Historical SQL guard **accepted the old signed JTI after full four-DB restoration — SECURITY FAIL REPRODUCED**.
- Independent, pinned Raft JTI remained spent and its CAS denied the identical consumed token — **PASS only while Raft history is retained outside the SQL restoration domain**. Replay rejection measured **3.219 ms**, initial Raft consume **3.209 ms** in this run.
- This is a QA **adapter**, not a deployed mandatory auth path. If raw legacy ingress can bypass the Raft check, SQL-origin replay still succeeds. Restoring/forging the own Raft cluster authority remains unproven.

The earlier harness initially failed for missing psycopg_pool/redis dependencies and then an omitted proto3 false response field; these CI iterations were preserved and corrected. The final run verifies both positive and adversarial conditions, not merely successful startup.

## C. One synthetic issuer, actual TLS WSS + HTTPS clients

[42065139180 — PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42065139180) and the original integrated candidate [42064226438](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42064226438). Additions: unified-jwt-wss-qa/identity.py, servers.py, verify.py, plus isolated workflow vision-v2-unified-jwt-wss-raft-15tv-no-deploy.yml.

- Separate localhost HTTPS and WSS/TLS OS service processes authorize **the exact same 15 device/tenant-signed synthetic JWTs** issued under one HS256 issuer with scoped permissions, issuer/audience, nbf/iat/exp, JTI and a fixed application epoch. They verify the actual etcd Raft owner/term/revocation before HTTP requests and WSS heartbeat frames.
- 15/15 WSS sessions and 15/15 HTTPS manifest GETs passed with a shared token per device. HTTPS SHA integrity checked. WSS heartbeat P95/P99 **64.534/66.976 ms** in the original pass; HTTPS P95/P99 **357.304/907.346 ms** on the local single-run fixture (not production latency forecasts).
- A real synthetic command over WSS was ACKed. Per-device revocation invalidated HTTPS (403) and closed WSS (1008); handshake rejected. Changing active HS256 kid rejected old tokens on both channels (HTTPS 401, existing WSS session closed). Renewed JWTs authorized 14 unrevoked WSS clients and 13 HTTPS 200 responses, with the 14th returning intentionally injected HTTP 402.
- Actual WSS process SIGKILL left HTTPS running, then **14/14** newly signed WSS clients reconnected.
- One test-local 402 caused the **virtual** manifest refresh of 240,000 ms to use 30 min 17 sec synthetic backoff; valid local cache still subject to expiry. Authorization 403 immediately denies. No physical 4-minute wait or actual Supabase 402 request was made.
- HTTPS commercial records: 13 × 50 = **650 unique synthetic proofs**, 14 POST attempts with one partial 49/50 ACK followed by successful retry of all 50; proof ledger is in-memory fixture, NOT real durable commercial storage. A prior independently tested same-run WSS+HTTPS fixture handled 15 × 50 = **750** proofs [42047528093](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047528093).
- Key signing material was ephemeral on CI and not committed. This single-run Python QA **is not the original APK/WSS gateway or deployed Docker ingress**; client/controller lives in same CI host and does not establish a real hardware-bound identity or client mTLS. A stolen bearer JWT can be reused until expiry/revocation; nonrollbackable JTI reservations across HTTPS and WSS session flows remain a release gate.
- A previously installed/tested JWT Docker private ingress fixture [42046493877](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42046493877) kept origins unreachable and denied cross-tenant tokens; unification with this new Raft-backed WSS/HTTPS fixture **has not been deployed or exhaustively proved for all real ingress routes**.

## D. Free 15 TV / 30-day forecast (accelerated, not observed billing)

[42064377435 — 2/2 PASS Node20/22](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42064377435). Same unchanged 15-TV 30-day client model was reexecuted after Raft/JWT candidate creation.

For **15 TVs × 24 h/day × 30 days** and assuming the **old stable 58-second bundled Edge request is fully retired**:

| Synthetic monthly channel | Count |
|---|---:|
| Standalone Edge manifest requests every 4 minutes | 162,000 |
| Edge proof batch POSTs, 50 records each from one proof/TV/min | 12,960 |
| TOTAL modeled Edge calls from those two channels | **174,960** |
| Assumed monthly Free Edge quota | 500,000 |
| Remaining theoretical capacity for all other Edge work | **325,040** |
| Independent WSS presence frames every 60 seconds, NOT Edge calls | 648,000 |
| Legacy 58s Edge bundle if accidentally left enabled | **670,345 extra Edge invocations**, already over 500k |

The model does not include paid custom etcd/WSS/Redis hosting, Supabase database/storage/egress/Realtime fanout, reconnections, panel/alerts/other tenants/projects, other quotas and persistent data growth. The billing-period quota is shared where applicable and subject to current platform terms. **Do not call this a Free production cost guarantee.** The existing 4-minute manifest patch remains homologation-only and has NOT been applied to player.js or APKs.

## E. Fresh unchanged regressions and critical negative gates

| Original suite rerun after Raft and shared JWT | CI | Result |
|---|---|---|
| WSS/TLS 100/300/600/1000, Node20/22 46/46 each, original 10,090 AES-GCM synthetic commercial reports | [42064296962](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42064296962) | **7/7 PASS** |
| Original commercial SHA256 of 10,090 reconstructed records | Same run | **161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18**, unchanged |
| TCP HTTP FIN/RST/half-open, real SIGKILL, 64/256 KiB, 100/300 clients | [42064320423](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42064320423) | **4/4 PASS** |
| 100/300 real PG17 advisory locks, independently wrapped and unwrapped legacy origins | [42064340764](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42064340764) | **4/4 CI PASS of security FAIL**: unprotected origin returns complete SHA-valid HTTP200 despite epoch |
| 100/300 real PG17 FOR SHARE owner row locks and writer 750 ms deadline | [42064363619](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42064363619) | **2/2 CI PASS of security FAIL**: owner writer still can time out |
| Original 4 PG17 independent anchor restore and 2-anchor split brain | [42064406188](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42064406188) | **1/1 CI PASS negative proof**, JTI replay and dual acceptance SECURITY FAIL |

Explicit **security and operational FAIL/NO-GO**:
1. Real etcd/Raft protects only while its durable history is outside the rollback domain. Rollback of Raft cluster storage, privileged compromise and re-bootstrap with a cloned identity are NOT prevented by a trusted hardware root.
2. An uncoordinated foreign cluster accepts duplicate JTI if the client does not enforce pinned cluster membership. Same-cluster restore and Raft mTLS/client authentication require separate proof.
3. WSS/HTTPS unified-issuer candidate does not yet replace the real installed APK, all legacy ingress paths or proven durable commercial report pipeline. Stolen bearer tokens and actual 90s Master TTL under mobile/TV connectivity remain release gates.
4. Raw legacy direct access remains exploitable in negative regression; every ingress route must be made inaccessible and fenced before issuing a token.
5. 750 ms owner-writer deadline still FAILS with 100/300 same-device held row locks; closing epoch does not physically revoke already emitted ACK packets.
6. Official Supabase Free HTTP402 was not rechecked and no production project was touched, per user's explicit isolation rule. All tests use local synthetic identities, PG17/Redis7/etcd on disposable CI.
7. Real multi-host partitions, actual full 30-day device soak and billable Supabase usage unverified.

**QA bounded PASS, persistent SECURITY FAIL, production NO-GO.**
