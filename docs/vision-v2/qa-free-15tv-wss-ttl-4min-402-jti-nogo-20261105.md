# Vision V2 — 15 TVs WSS, quatro minutos e orçamento Free

Date 2026-11-05. Initial commit afa16bd74e6e422033ab7dc57071628ba0500ce6. Exclusive branch experiment/vision-v2-toctou-continuous-guard-qa-20261102. **Release and security: NO-GO.** All work is new experimental files on the branch; NO official Supabase project access or mutation, APK, panel, TV, site, Vercel, data, main or publication.

## Real 15-client TLS/WSS presence and automatic offline

[Run 42026646607](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42026646607) **1/1 PASS**. Two OS gateway processes generated from the previously audited WSS fenced candidate use one shared Redis 7 lease/command store, PostgreSQL 17 central owner/JTI/lease witness and disposable PostgreSQL 17 primary. A second Redis 7 is present but is not active as leader/HA; there is NO distributed failover proof.

| Property | CI measurement |
|---|---:|
| Actual TLS WSS sessions accepted and recorded online in PostgreSQL | 15/15 |
| WSS per-session centrally authorized first heartbeat ACK | 15/15 |
| Login P95 / P99 | 107.828 / 108.462 ms |
| Heartbeat P95 / P99 | 23.631 / 23.790 ms |
| Command acknowledgements persisted in PostgreSQL | 8/8 |
| Paused client reads / ACK on resume | 8/8 (not sustained TLS saturation) |
| Real SIGKILL of gateway A | 8 sessions lost ACK; gateway B retained 7 |
| PostgreSQL offline detection after lease expiration | 8/8 offline; 7/7 remained online |
| Wall clock for all expired sessions to be declared offline | 14,268.685 ms |
| TTL used in this **local accelerated test** | 12,000 ms |
| Witness WAL delta | 32,664 bytes |
| Gateway RSS measured before SIGKILL | 52,784 and 52,420 KiB |
| Controller RSS peak | 56,876 KiB |
| Edge Function HTTP API invocations in **this isolated WSS fixture** | 0 |

The WSS central witness still checks PostgreSQL on each heartbeat. **Zero Edge invocations does not imply zero SQL, network or hosting costs.** The 12-second local TTL test does NOT prove that actual APKs and the Master meet the real 90-second online/offline semantics over a full month; no real hardware or multi-host path was used. Delayed TLS bytes and network ACK delivery remain unproven. The tested gateway is **custom WSS, not Supabase Realtime**, and may require separately paid hosting.

## 15 TVs, 24 hours a day, 30 days

Official Supabase documentation checked 2026-11-05: [Billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Realtime message billing](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages), [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Billing FAQ and 402](https://supabase.com/docs/guides/platform/billing-faq), [Realtime egress and heartbeat frames](https://supabase.com/kb/troubleshooting/realtime-egress-faq).

Free limits include 500,000 monthly Edge invocations across the organization, 200 Realtime peak connections, 2 million Realtime messages, 5GB regular egress, 500MB database per project. The monthly counter refills on the billing cycle; persisted database and Storage bytes remain.

| Traffic path | Approximate 30-day total | Implication |
|---|---:|---|
| Existing stable bundled Edge route every 58 seconds for 15 TVs | **670,345 Edge calls** | Already exceeds Free 500k before other system traffic |
| Dedicated Edge manifest every 4 minutes for 15 TVs | **162,000 Edge calls** | Fits only if 58s bundled Edge route is retired and all other usage stays inside remaining quota |
| Independent WSS presence 60s per TV | **648,000 WSS frames** | These are not Edge invocations, but require WSS infrastructure and central PostgreSQL checks |

Supabase managed Realtime has DIFFERENT billing semantics from this custom gateway: message fan-out, Phoenix control frames, egress, reconnects and other projects must be independently measured. Never equate 648k local WSS frames with exactly 648k billed Realtime messages or assume 15 connections guarantee no restriction.

## Four-minute manifest + HTTP402 retry protection

The previously created [homologation-only patch](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/blob/experiment/vision-v2-toctou-continuous-guard-qa-20261102/docs/vision-v2/homolog-only-4minute-manifest-402-polling-20261104.patch) was verified by [Node20 and Node22, 2/2 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41823341624), including a real git apply --check and Node syntax check in ephemeral CI checkout. It changes manifest 120s to 240s and adds 30–31 minute backoff when HTTP402 arrives, preserving 403 revocation, 58s bundled heartbeats, 60s standalone presence, and 45s fallback commands. **It is NOT deployed.** Slowing only manifest from two to four minutes does NOT reduce the total bundled Edge calls. Simply slowing all heartbeat calls to four minutes would break Master offline detection at ~90s. A retry backoff does NOT remove Supabase administrative restrictions.

## Independent regression and SECURITY FAIL ledger

- [42026580748: 7/7 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42026580748): original WSS TLS 100/300/600/1000 devices; Node20 46/46 and Node22 46/46; 10,090 synthetic AES-GCM commercial receipts reconstructed with exact original SHA256 **161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18**, 200 group comparisons.
- [42026585524: 4/4 PASS](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42026585524): unchanged original 100/300 HTTP/TCP fault suite with 64/256KiB, RST/FIN/half-open, SIGKILL, truncated HTTP200 rejecting incomplete commercial body.
- [42026596312: 1/1 PASS of explicit negative security evidence](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42026596312): four PG17 disposable services, one canonical anchor. Restoring both local authority databases while preserving the anchor rejects the spent JWT. **SECURITY FAIL** when the canonical anchor is restored (old JWT accepted again). **SECURITY FAIL** when separate uncoordinated authorities each accept same JTI (split-brain).
- [41822155768: 4/4 PASS of negative legacy bypass proof](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41822155768): new epoch wrappers deny 100/300 requests after COMMIT while a reachable raw legacy origin still returns a fully SHA-valid HTTP 200. **SECURITY FAIL** until every origin bypass is made inaccessible.
- [41822767516: 2/2 PASS of negative row-lock proof](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41822767516): 100/300 truly held PG17 same-device FOR SHARE sessions block owner UPDATE beyond 750ms; independent epoch closes fast but cannot revoke an old unwrapped WSS client by itself.

Previous early [42026359406](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42026359406) and [42026491647](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/42026491647) CI harness errors (wrong module path/missing sys import) were preserved and corrected at passing run 42026646607; do not count them as security testing.

## Release gates and remaining work

1. Previously observed official Supabase HTTP402 must be removed through normal administrative billing/quota resolution and real device requests must succeed. **Not rechecked today; project was not contacted in this mission.**
2. Validate real APK version, actual on-TV calling profile and 90s Master semantics in homologation before any installation.
3. Eliminate every raw legacy endpoint/direct origin bypass of central epoch fencing. This remains unproven.
4. Correct the WSS central authority JTI rollback and two-anchor split-brain. Independent nonrollbackable witness and leader/quorum proof missing.
5. Prove 750ms owner-writer completion under 100/300 real stalled WSS row holders and physical ACK packet-delivery ordering. Earlier negative persists.
6. Measure pricing/egress, bandwidth, JWT issuance, media Storage/CDN cost, event queue growth, playback_logs history/retention and actual 30-day Free organization usage; no production deletes or database migrations.
7. Keep cached playback available offline while preserving true 403 expiry and commercial evidence; stage each feature under separate QA releases.

**End state: local functional proof PASS; global security and release gates NO-GO.**
