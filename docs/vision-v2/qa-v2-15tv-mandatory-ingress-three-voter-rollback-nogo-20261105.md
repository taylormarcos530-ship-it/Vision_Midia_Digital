# Vision V2 — 15 TV Free, mandatory ingress and 3-voter JTI rollback independent review

Date 2026-11-05. BASE commit eb9931a4f7013644df932a450fb18e4b8adf709e. Exclusive experiment/vision-v2-toctou-continuous-guard-qa-20261102 branch. **SECURITY FAIL / PRODUCTION NO-GO.** Every modified artifact was an additive experimental workflow, QA test or report. Do NOT deploy. No changes or reads of real Supabase, Vercel, APKs, site, panel, TVs, main or customer histories.

## 1. Mandatory ingress with actual physical Docker network isolation — PASS IN QA

New test: tests/vision-v2-sequence-qa/mandatory-ingress-docker-qa/ingress.mjs and workflow .github/workflows/vision-v2-mandatory-docker-ingress-no-deploy.yml.
Validated CI [42033224434](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42033224434), **1/1 PASS**:
- Two independent legacy/origin OS containers reside **only** on Docker private bridge, **not published to host**.
- Two independent ingress OS containers connect to the client-facing bridge and the private bridge.
- Two independent untrusted client containers on the public bridge: one checks normal HTTP/SHA, the other checks direct private access via names and an explicit origin private IPv4 address (separate OS containers to isolate test side-effects).
- All **five** attempted direct paths to legacy-a, legacy-b, Redis, authority and origin private IP were unreachable for the untrusted client.
- Before revocation 15/15 HTTP requests via two ingress processes returned SHA-valid complete synthetic 200 bodies. Wrong auth returned 401, unknown/forward route returned 404.
- Redis7 qa:epoch is checked before headers and each response chunk; revocation after an already-started response caused **HTTP 200 truncated at 65,536/303,104 bytes**, rejected by length/SHA256 client oracle.
- After closure **30/30** HTTP requests denied 503 across two ingress processes.
- After real SIGKILL of independent central epoch authority **30/30** requests denied 503.
- Earlier failed CI iterations preserved; corrected Redis RESP framing, client-facing Docker networking and isolation checks so the **last run exercises BOTH working transport and direct-origin isolation**. Never cite earlier incomplete runs as proof.
- Privileged root/Docker administrator could join the private bridge or override network rules: NOT tested against a trusted-host compromise. The QA token is a **static synthetic X-QA-Token**, NOT real APK JWT/device authentication. The central epoch in Redis is not a nonrollbackable durable authority. This is an ingress network-access candidate, NOT a production migration. No physical TLS packet-delivery/ACK cutoff guarantee, no real origin path inventory, and the historical unprotected origin still bypasses unless isolated.

## 2. Three distinct real PG17 voters for JTI — PASS QA / SECURITY FAIL

New tests: tests/vision-v2-sequence-qa/quorum-jti-qa/worker.py and controller.py. CI [42031520505](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42031520505) **1/1 CI PASS** on three real independently running PostgreSQL17 containers, with a deterministic barrier and two different authorization OS processes:
- 2/3 durable SQL INSERT votes needed before local ACK. Same JTI concurrently admitted by just one process: ACK once, DENY once. Next replay denied.
- One voter stopped: authorization with two remaining votes succeeded. Two voters stopped: authorization blocked.
- Real pg_dump + pg_restore of **one** voter does not reaccept spent JTI if the other two retain state.
- **Security FAIL proven**: real pg_dump + pg_restore of **two** voters to pre-JTI state reaccepts exactly the same old signed token with 2/3 votes.
- Manually established leader term epoch 8 on two voters fenced old leader epoch 7; these are NOT safe distributed election/quorum membership protocols and majority rollback can reinstate the old term. A privileged synchronized restore or split membership still defeats this design. Two independent anchor split-brain was also reproduced in the original independent negative harness.
- Fifteen consecutive JTI login checks: **15/15 ACK**, P95 **37.796 ms**, P99 **42.487 ms** on one local CI runner. Minimum 30 durable voter writes, not WSS frames.
- Controller RSS **47,856 KiB**; narrow PG17 WAL LSN deltas: witness **145,816 bytes**, shadow **264,984 bytes**, anchor **3,776 bytes** (different restore/write histories, cannot extrapolate linear billing).
- **NOT consensus**: cross-DB votes are not an atomic transaction, no real Raft/Paxos leadership, no nonrollbackable external monotonic authority/hardware, no multi-host partition tolerance guarantee. SECURITY FAIL + NO-GO.

## 3. Fifteen TVs, 4-minute manifest, 402/403, cache, expiry and commercial batches

Existing QA-only uninstalled patch docs/vision-v2/homolog-only-4minute-manifest-402-polling-20261104.patch modifies only a temporary copy:
- programming manifest 120,000 ms to **240,000 ms**;
- 402 administrative retry cool-down **30–31 minutes** without a retry storm;
- leaves 60-second presence legacy heartbeat, 58-second integrated bundle cycle and 45-second nonpush command fallback unchanged. True HTTP403 access revocation and local lease expiry remain fail-closed.

New accelerated independent 15-player 30-day simulation tests/vision-v2-sequence-qa/free-15tv-presence-qa/30day-client-budget.test.cjs; [CI 42032146589](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42032146589), **Node20/22 2/2 PASS**, all synthetic in-memory:
- **15 TV x 30 days x 24 hours**, valid cached programming refreshed every 4 min;
- **162,000 modeled Edge manifest requests**;
- **648,000 WSS presence frames**, NOT Edge invocations; separate persistent service assumed and central SQL cost not free;
- one simulated playback proof per TV per minute = **648,000 proofs**, enqueued and uploaded as 50-record acknowledged batches = **12,960 modeled Edge batch calls**;
- **174,960 modeled Edge calls from these two channels** and arithmetic remainder **325,040** from 500k monthly Free allowance. This is NOT a live invoice, leaves out other Edge functions, retries, 402 usage, media/storage/egress, SQL, panel operations and infrastructure charges. The real stable 58-second Edge bundle must be replaced, NOT left running alongside these channels: otherwise **670,345 extra Edge invocations / 30 days** already exceed the Free allowance.
- Explicit negative unit tests: HTTP200 incomplete length/SHA rejected, commercial partial or failed ACK retains proofs, duplicate or cross-device command ACK denied, offline local expiry stops playback, HTTP403 denies, HTTP402 cached playback allowed only while pre-existing lease is valid.
- This is NOT 30 real days, not actual TV APK integration, not measured real WSS/Realtime billing or 500k quota compliance proof.

Prior real 15 WSS TLS load [42026646607](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42026646607) measured 15/15 authenticated WSS, 15/15 heartbeat ACK, 8/8 commands, 8 offline and 7 online after real gateway SIGKILL within **14.269s** using accelerated **12s** Redis TTL. WSS heartbeat P95/P99 **23.631/23.790ms**, witness WAL 32,664 bytes, gateway RSS ~52MiB. It is NOT a 90-second guarantee for real Master/TV operation; continued nonrollbackable JTI/owner security was NOT proven.

## 4. Reexecuted original unchanged security/capacity regressions

- [42032314552](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42032314552): **7/7 PASS** original WSS 100/300/600/1000, Node20 and Node22 **46/46 each**, exact **10,090** AES-GCM synthetic commercial records and unchanged original SHA256 **161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18**.
- [42032321639](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42032321639): **4/4 PASS** original HTTP FIN/RST/half-open, 100/300 clients, 64/256KiB, SIGKILL, truncated reports correctly rejected.
- [42032333328](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42032333328): **4/4 CI PASS**, 100/300 PostgreSQL17 old shared locks remain while independently wrapped ingress rejects requests. **SECURITY FAIL NEGATIVE PERSISTS**: unwrapped old legacy origin directly reachable in that separate fixture accepts post-revoke HTTP200 SHA-valid report. Docker private bridge candidate above is one tested network-level mitigation, not integrated in this original fixture or a real deployment.
- [42032341438](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42032341438): **2/2 CI PASS of negative case**, 100/300 real same-device PostgreSQL17 FOR SHARE holders blocked owner UPDATE for ~750ms (writer fails); independent epoch closed promptly but old ACK and actual physical deadline still not certifiable.
- [42026596312](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42026596312): **1/1 PASS test harness reproducing SECURITY FAIL**: restoring separate canonical anchor and split independent anchors admits old/duplicate JTI. An additional post-quorum rerun is included in this review. Retain negative tests.

## 5. Explicit production gate verdict

**NO-GO**. Remaining mandatory proof:
1. Replace synthetic ingress header with device-authenticated and tenant-scoped real JWT/mTLS and canonical fencing, restrict every legacy origin with exclusive private ingress, validate direct-origin network escape by authorized and unauthorized processes.
2. Real quorum/leader consensus with monotonic authority outside rollback domain. The 3-voter majority rollback above is a concrete SECURITY FAIL; do not deploy.
3. Resolve official Supabase Free HTTP402 via normal billing/administration and verify actual 200 on relevant functions; this review did **not** access official Supabase or change production.
4. Integrate 15 real APK/PWA clients with WSS/manifest/batched receipts; validate physical transport, 403 revocation, 90s Master online threshold, offline cache, lossless commercial ledger, command idempotence, deployment/rollback and actual paid egress.
5. Measure 30-day organization-wide quotas, SQL/WAL/RSS/egress, database growth/retention and Supabase Realtime fanout if chosen. Custom WSS is NOT automatically managed Supabase Realtime; hosting may cost money.
6. Revalidate 100/300 full same-device WSS row locks, actual TLS send backpressure, ACK chronology, SIGKILL and leader churn with deterministic barriers and a defensible 750ms writer deadline.
7. Preserve all previous source, tests, migrations, historical negative proofs, and maintain NO-GO until every gate passes.

All new files QA-only, no existing player.js or Android source edits; all CI uses synthetic disposable PostgreSQL17, Redis7 and Docker. Experimental PASS != release PASS.


## 6. Final post-quorum rerun verification (2026-11-05)

- [42033433870](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42033433870): **1/1 PASS** real fifteen-client WSS TLS with two OS gateways and central PG17; 15/15 admitted and 15/15 first-heartbeat ACKs. First-heartbeat P95/P99 **21.332/21.417ms**. Real SIGKILL: 8/8 disconnected detected offline with 12-second synthetic TTL in **14,259.035ms**, other 7/7 stayed online. Witness WAL delta **32,664B**. Child process RSS **52,808/52,436 KiB**. Actual real Master/TV behavior and security gates remain unproven.
- [42033443592](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42033443592): **1/1 PASS negative tests** with 4 disposable PG17 services, real pg_restore of canonical external anchor **reaccepting a spent JTI** and two independent uncoordinated anchors **both accepting the same JTI**. **SECURITY FAIL REPRODUCED / NO-GO**.
- The latest passing mandatory ingress workflow is [42033224434](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42033224434); it must be distinguished from earlier incomplete/failing harness iterations. The latest one tests an independent client container unable to reach origins or authority, 15 valid ingress GETs, and the 200-truncation and shared-epoch fail-closed behavior.

**No release approval:** the mandatory ingress has only a static QA header, quorum is not true consensus, 2-of-3 rollback succeeded adversarially, original WSS JTI split-brain persists, full client/auth integration not run on real APK, and no official Supabase traffic or storage was touched.
