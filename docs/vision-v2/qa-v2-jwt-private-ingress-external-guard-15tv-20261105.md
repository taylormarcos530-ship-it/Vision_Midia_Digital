# Vision V2 — independent QA: synthetic JWT private ingress, external JTI guard, 15-TV integrated transport

**Review date:** 2026-11-05. **Starting commit:** a39fba80065679c37099c1964713ca494a2b5fbe.  
**Only branch:** experiment/vision-v2-toctou-continuous-guard-qa-20261102.  
**Release verdict:** **PRODUCTION NO-GO**. **Security FAIL** persists on global authority rollback, split-brain, legacy routes not migrated to the private ingress, and 750ms owner-writer deadline. A passing CI test demonstrates the stated *bounded QA observation*, not a release gate.

**Scope and isolation:** Added NEW tests/workflows/report files only, not edits to original player.js, Android APK, Supabase official/production, Vercel, panels, websites, screens, commercial historical data or main. All TLS/HTTP, Redis 7 and PostgreSQL 17 are isolated GitHub Actions fixtures. HMAC signing keys are ephemeral on CI runner and never committed or mounted in client containers.

## 1. Per-device and per-company JWT private HTTP ingress (real Docker, local only)

[CI 42046493877 — PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42046493877)

Experimental additions:
- tests/vision-v2-sequence-qa/jwt-private-ingress-qa/secure-ingress.mjs
- .github/workflows/vision-v2-jwt-private-dual-ingress-no-deploy.yml

Two independent ingress container processes, two inaccessible legacy-origin containers (separate Docker private-only network), one Redis7-backed central owner/epoch/term authority container and two isolated untrusted client containers. Neither origin publishes a host port; arbitrary untrusted clients cannot resolve private origin names or directly connect to its private IPv4 address.

Public ingress replaces the **previous static QA header** with *synthetic HS256 Bearer JWT*: HMAC key is 32 CSPRNG bytes generated during CI, stored on ingress-only read-only mount; 15 distinct test JWTs have device claim, company-A tenant, issuer/audience, manifest:read scope, term 7, iat/nbf/exp and jti. Signature compared in constant time. This is NOT a physical Android device certificate / real JWT issuer integration and is not TLS at the ingress front itself. Original WSS TLS transport remains separately tested.

Result:
- 15/15 complete correct SHA-validated HTTP GETs through two independent ingress processes, with 15 distinct tokens.
- 14/14 negative requests correctly denied (missing token, legacy static header, wrong route/SSRF, altered signature, expired, future, invalid alg, wrong audience, wrong scope, wrong term, different signed tenant/device, mismatched URL identity).
- Owner reassignment detected through per-request central Redis owner check: 30/30 old-company requests denied across two ingress.
- Leader-term mutation detected through per-request central Redis term check: 30/30 denied.
- Shared epoch CLOSED => 30/30 rejected; real authority-container SIGKILL => 30/30 fail-closed.
- An HTTP 200 already streaming was truncated at 65,536/303,104 bytes immediately upon epoch closure; client verified Content-Length and SHA256 and rejected it.
- Every authorized request and each bounded HTTP body chunk checks central epoch+owner+term. This DOES NOT prove packets already queued by TLS/kernel are undone. The JWT jti itself is NOT globally consumed at every manifest GET: signed GET bearer reuse before expiry and theft detection are not proven.
- The epoch and ownership are Redis state and can be rolled back. QA host privileged Docker/network administrators can join private network. No guarantee all actual origins in production are configured privately; not integrated with real APK/production ingress.

Early incomplete CI harness runs (syntax source duplication, RESP format and network fixture errors) retained as failures; the cited final run passed the actual positive AND negative network cases.

## 2. Three real PostgreSQL 17 voters plus independently restorable fourth PG17 JTI guard

[CI 42046881472 — PASS negative security review](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42046881472)

Experimental additions:
- tests/vision-v2-sequence-qa/guarded-majority-qa/verify.py
- .github/workflows/vision-v2-guarded-majority-jti-restores-no-deploy.yml

The previous 2-of-3 SQL voter experiment was NOT consensus and allowed a spent signed JTI to be accepted after physical/logical restore of two voters. An independent, single-writer, centrally serialized PostgreSQL 17 JTI/owner/term guard was added **outside the three-voter restoration domain**, but remains itself restorable (no hardware-backed external irreversible clock).

Actual PG17 observations:
- Two independent OS authentication processes racing one signed JTI: one ACK, one DENY.
- Restore 2 of 3 voter PostgreSQL databases by real pg_dump/pg_restore while guard untouched: **spent JTI denied**.
- Restore all 3 voters while guard untouched: **spent JTI denied**.
- Stop independent guard container: authorization **fail closed**. Restart guard: fresh token ACK, spent token still DENY.
- Manual term change from 7/leader-A to 8/leader-B on guard and majority: stale leader denied; new leader accepted. This is **NOT a tested leader election**.
- Fifteen new JWT admissions: **15/15 ACK**, P95 **101.266ms**, P99 **211.339ms** (local CI single-run measurements).
- Real full pg_dump/pg_restore of all 3 voters **and the external guard** to initial state: **SECURITY FAIL REPRODUCED**, old spent signed token accepted again.
- Narrow WAL deltas (after backups, SQL and restore; cannot extrapolate monthly): witness 144,512B, shadow 144,512B, third anchor 139,168B, external guard 264,688B. Controller RSS ~47,856KiB.
- A single central guard is a single availability dependency. Partial votes may burn a JWT without 2-of-3 success. There is NO Raft/Paxos membership consensus, no strong antirollback hardware trust root, no two-host true partition test and no end-to-end mobile JWT integration.

Re-run of older independent 2-anchor adversarial counterexamples:
[CI 42047746404 — PASS negative proof](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047746404):
- Independent canonical anchor retained while both SQL auth mirrors restored: old JTI denied.
- **Canonical anchor also restored: old JTI accepted — SECURITY FAIL**.
- **Two uncoordinated anchors both accept the same JTI — SPLIT-BRAIN SECURITY FAIL**.
- No production authorization can be granted based on a vote-only quorum or an ordinary restorable backup domain.

## 3. Same-run 15 actual WSS/TLS + real HTTPS synthetic manifests and 50-record commercial batches

[CI 42047528093 — PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047528093)

Experimental additions:
- tests/vision-v2-sequence-qa/free-15tv-integrated-qa/verify.py
- tests/vision-v2-sequence-qa/free-15tv-integrated-qa/qa_https_fixture.py
- .github/workflows/vision-v2-15tv-integrated-wss-https-cache-402-batch-no-deploy.yml

Fifteen actual authenticated localhost WSS/TLS clients over two gateway OS processes, isolated PostgreSQL17/Redis7. While all clients were connected a second localhost-only HTTPS server returned manifests verified by SHA256, with identity verified using the **original synthetic WSS signed token fixture**, not the new Docker ingress key (these two separate authentication stacks have **not** been unified end to end).

Results:
- WSS 15/15 authenticated, first heartbeat 15/15 ACK, heartbeat P95 **18.459ms**, P99 **18.540ms**.
- Concurrent idempotent commands persisted: **8/8**.
- Real localhost HTTPS valid SHA-complete manifests **15/15**; HTTPS P95 **2.427ms**, P99 **3.199ms** (local one runner, not paid hosting).
- Simulated four-minute manifest refresh with accelerated virtual clock (240,000 ms). HTTP 402 check from local fixture preserves prior cached content only while the original authorization lease and cache validity remain true; 30min 17s retry. HTTP 403 revokes immediately, expired local lease denies playback, wrong tenant/device JWT denied. These are **synthetic HTTP error injections, not responses from Supabase production**.
- 15 clients × 50 synthetic proof entries = **750 unique commercial proofs** inserted in ephemeral in-memory dedup ledger by **16 HTTPS batch POSTs**. The first attempted 50-record batch returned a partial ACK of 49; the client retained the entire batch and retried; no proof loss claimed only within this fixture. Does not prove real billing integrity or transactional exactly-once delivery under crashes.
- Real SIGKILL one gateway; 8 lost sessions were declared offline after **13,209.485ms** with **synthetic 12-second TTL** while 7 on second gateway stayed online. Real Master 90s behavior remains unproven.
- Witness WAL during this scripted fixture: **31,600B**. Gateway process RSS: **53,116 and 52,660 KiB**.
- Actual site, TV PWA, APK, panel, real Supabase endpoints, enterprise JWT flow and commercial customer files were NOT touched.

## 4. Thirty-day Free consumption forecast, not a 30-day physical soak

[CI 42047756506 — Node20 and Node22 2/2 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047756506) re-runs unchanged 15-device accelerated 30-day model. It assumes 15 TVs active 24h every day for 30 days, one proof per device per minute, batch50 proof uploads, a new standalone manifest Edge request per 4min, **and total retirement of the old 58-second integrated Edge bundle**.

| Channel | Synthetic 30-day count |
|---|---:|
| Manifest Edge checks, 4min per TV | 162,000 |
| Commercial Edge uploads, batch50 | 12,960 |
| **Total modeled Edge invocations from these two only** | **174,960** |
| Free Edge quota used for this comparison | 500,000 per billing cycle across organization |
| **Arithmetic remainder for every other system operation** | **325,040** |
| WSS presence frames, 60s per TV, not Edge invocations | 648,000 |
| Legacy bundled Edge invocations at 58 seconds IF still running | 670,345 extra, already over Free quota alone |

This model is NOT actual billable usage. Reconnects, Edge retries/402 errors, upload failures, Supabase Realtime message fanout, presence management, JWT/key issuance, storage/egress, overhead and concurrent projects remain unmeasured. Independent WSS gateway hosting/SQL/Redis may have non-Free costs. Time since official Supabase Free HTTP402 was last observed is not reassessed: this round explicitly never contacted the official Supabase project.

HTTP 402 backoff and 4-minute manifest patch were previously syntax-verified in disposable copy only; player.js, 58s stable client bundle and APK production remain unchanged.

## 5. Independent original regression matrix (after JWT and guard changes)

| Job | Current GitHub Actions | Status |
|---|---|---|
| Unchanged original WSS 100/300/600/1000 TVs, Node20/22 46/46, 10,090 AES-GCM commercial receipts | [42047607729](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047607729) | **7/7 PASS** |
| Original 10,090 synthetic archived AES-GCM records exact SHA256 | Same run | **PASS** with SHA256 161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18 |
| Original 100/300 real HTTP FIN/RST/half-open, 64/256KiB and SIGKILL | [42047672675](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047672675) | **4/4 PASS** |
| Original 100/300 PG17 advisory locks, wrapped vs raw legacy bypass | [42047700418](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047700418) | **4/4 CI PASS of SECURITY FAIL counterexample**: raw unwrapped legacy origin can still serve SHA-complete 200 |
| Original 100/300 PG17 same-device FOR SHARE owner locks and writer deadline | [42047722270](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047722270) | **2/2 CI PASS of SECURITY FAIL**: row holders can force >750ms timeout |
| Accelerated model of 15 devices / 30 days (Node20/22) | [42047756506](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047756506) | **2/2 PASS** |
| Original external anchor restore + split brain | [42047746404](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42047746404) | **1/1 test PASS**, **security FAIL** |

No historical tests were deleted or modified. No original code changes.

## 6. Explicit remaining production gates — NO-GO

1. **Rollback-total and split-brain FAIL**: independent fourth PostgreSQL guard is itself restorable. Real irreversible epoch authority and documented consensus/leader quorum behavior across partitions, privileged rollback and split brain are missing.
2. **Actual ingresso / all-origin migration unproven**: Docker-network and synthetic JWT proof does not prove actual 100% ingress enforcement, privileged origin access resistance, revocation under paused TLS senders or device certificates. JWT issuer for Docker private ingress and the independent WSS JWT fixture are separate. Neither is installed on real APK.
3. **Legacy origin bypass still demonstrably possible** if any unwrapped route remains accessible, as proven by unchanged regression.
4. **750ms PostgreSQL owner writer deadline still fails** with unbounded 100/300 held row locks; closing epoch alone does not guarantee timely completion of actual tenant transfer.
5. **Actual Supabase Free HTTP402 unresolved/unknown** from this round; no official Supabase inspected due user's isolation constraint. Actual paid egress/realtime/hosting and 30-day billing not measured.
6. **Real end-to-end soak and hardware invalidation untested**: no real TVs, APKs, panels, production database, offline media activation, actual 90s Master threshold or remote multi-host stalls tested.
7. Preserve branch-only experimentation and historical FAIL fixtures, re-evaluate with safe independent tests. **Never claim production ready based on a passing synthetic CI job.**

**Final verdict: QA scoped PASS, security RELEASE FAIL, production NO-GO.**
