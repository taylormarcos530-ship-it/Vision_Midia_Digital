# Vision V2 — 15 TVs, 4-minute manifest, Supabase Free, legacy bypass and WSS row locks

**Review:** 2026-11-04. **Base HEAD:** 8ac9cbbf6281c929db322cc60c79abe55993289c. **Exclusive branch:** experiment/vision-v2-toctou-continuous-guard-qa-20261102. **Production and security NO-GO.** All source changes in this mission are NEW QA files only; original player, Android APK, Supabase project, TVs, Vercel, production site, main, live history and existing tests remain untouched.

## Supabase official project (READ-ONLY observation)

Connected Supabase project fpadgedrgcxrrqflzhjt reports ACTIVE_HEALTHY for its PostgreSQL 17 project metadata, but Edge Function logs for the most recent 24-hour window still contain HTTP **402**. Entries include device-bundle-stable, device-health-alerts and subscription-alerts. This is consistent with a platform billing/Fair Use restriction; neither the logs nor project metadata prove the exact quota root cause. Database size ~223MB; no new playback_logs entries in the last 24h and latest prior entry Oct 30, 2026. PostgreSQL being healthy is NOT equivalent to all Edge Functions returning HTTP 200.

Supabase Free publicly documents 500,000 Edge Function invocations per monthly billing cycle across the organization and 500MB project database. Quotas generally refill at the next billing cycle; retained database/storage bytes do NOT reset. HTTP402 administrative restrictions cannot be removed by client retries or by changing player poll timing. Official references:

- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations
- https://supabase.com/docs/guides/platform/billing-faq
- https://supabase.com/kb/troubleshooting/http-status-codes

## Actual player scheduling, not a blanket 2-to-4-minute change

Read-only code inspection of original player.js found these independent periods: legacy manifest 120s; bundled manifest 120s; legacy presence heartbeat 60s; no-push command fallback 45s; stable integrated device-bundle-stable every **58 seconds**. Master offline window approximately 90 seconds. Slowing a heartbeat to 240s would misclassify working TVs as offline; slowing only manifest to 240s does NOT halve bundled Edge calls.

A QA-only Node script generates a **temporary copy** of player.js with 240s manifest and bundled-manifest intervals and HTTP402 backoff 30–31min, preserving existing 403 security handling, cached media, queued proofs, 58s bundled heartbeat, 60s legacy presence, 45s command fallback, anti-stampede jitter and single-flight control. Verified with both Node20 and Node22 in CI [41821790373](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41821790373) **2/2 PASS**. Original player.js remains byte-for-byte UNCHANGED. The patch is **NOT** in production or an installable APK.

### 15 TVs: 30-day total calls under different uptime assumptions

| Each TV active | Integrated 58s Edge calls | A separate 4-minute manifest call | Legacy 60s Edge heartbeat | 45s fallback command calls |
|---|---:|---:|---:|---:|
| 12h/day | 335,173 | 81,000 | 324,000 | 432,000 |
| 16h/day | 446,897 | 108,000 | 432,000 | 576,000 |
| 24h/day | **670,345** | 162,000 | **648,000** | **864,000** |

Different modes can replace each other: do NOT blindly add columns together. Real invocation usage includes startup, other alerts, failures, the dashboard and retries; this is an arithmetic model, not a measured invoice. Keeping 15 TVs online 24h via the current 58s bundled Edge request **exceeds Free 500k calls on that channel alone**. 4min manifest only does NOT fix it. A viable future solution requires a separately audited presence path that stays online under Master 90s timeout without one Edge Function invocation per minute, plus slower manifest and event-driven commands. The experimental WSS channel still has JTI rollback/split-brain security failures; it is NOT ready for deployment.

## Next Vision V2 experiments completed

### A. Universal-epoch wrappers vs direct legacy origin

CI [41822155768](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41822155768) **4/4 QA PASS** with 100/300 real independent PostgreSQL 17 backend transactions continuing to hold old shared advisory locks. Two isolated OS HTTP workers wrap ALL their production-shaped GET paths with a new mandatory epoch check before headers and each block. A non-destructive epoch closing COMMIT completes in 7.546–9.860ms; after COMMIT all 100/300 requests to the WRAPPED endpoints return 503. A started HTTP 200 truncates and fails content-length/SHA256 verification; missing authority row is fail-closed. **Security FAIL reproduced:** an UNWRAPPED original worker reachable by a direct route still returns a complete, SHA-valid HTTP200 after the epoch closes. Thus there is no release authorization until every legacy origin is made inaccessible or retrofitted; no real ingress has been changed. Historical first harness syntax FAIL [41822037232](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41822037232) preserved, corrected in passing run.

### B. Same-device PostgreSQL17 owner ROW SHARE locks and writer starvation

CI [41822767516](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41822767516) **2/2 QA PASS of a negative security case**. 100 or 300 distinct PostgreSQL 17 backend connections in two OS processes execute an actual same-device SELECT FOR SHARE and hold open real transactions. We verify backend identity, relation RowShareLocks, issued same-row SQL and a writer blocked by the lock. PostgreSQL may not expose each tuple lock as a separate pg_locks entry, so that is not claimed.

| Same-device locks | Original owner UPDATE | Independent epoch close | UPDATE after voluntary release |
|---:|---:|---:|---:|
| 100 | **FAIL** ~759ms / no COMMIT | 8.401ms | 119.196ms COMMIT |
| 300 | **FAIL** ~758ms / no COMMIT | 7.488ms | 298.433ms COMMIT |

No SIGKILL was used. This proves that unbounded row-lock holders violate the 750ms owner update deadline; the independent epoch can close quickly, but actual old WSS sessions not checking the new epoch can still ACK. Neither real multi-host transport ordering nor 300 simultaneous live WSS tenant-writer locks has been proven.

### C. Original independent regressions, all previous code preserved

- [41822384647](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41822384647): **7/7 PASS** original WSS TLS 100/300/600/1000 TVs, Node20 and Node22 **46/46 each**, 10,090 synthetic original AES-GCM commercial receipt reconstructions; original commercial SHA256 **161ef8434e8b718b74c77cadd7501e853eff5fb6c62ae7c48b7ded7ad6923d18**.
- [41822391846](https://github.com/taylormarcos530-ship-it/Vision_Midia_Digital/actions/runs/41822391846): **4/4 PASS** original HTTP slow-client 100/300, 64/256KiB, TCP FIN/RST/half-open, real SIGKILL, truncated HTTP200 strictly rejected.

## Hard production blockers and safe next steps

1. Confirm HTTP402 cleared by billing/quota remediation at official Supabase Free; check a genuine device-bundle-stable HTTP200. Do not bypass restrictions.
2. Inspect which APK version/calling profile is ACTUALLY installed and current daily per-device requests. No bulk updates.
3. Do not simply change 60s heartbeat to 4min while Master offline timeout is 90s.
4. Implement independently audited authenticated presence without per-minute Edge invocations, preserving fail-closed lease/security, TTL, push commands and offline playback. Verify Supabase Realtime or any alternative service's egress/message/storage quotas instead of assuming free.
5. Eliminate direct raw legacy route bypass before adopting independent-epoch admission.
6. Eliminate WSS JTI rollback / split-brain before adopting the experimental WSS transport. Prove total rollback and proper quorum/leader fencing.
7. Stage 4min manifest and 402 cooldown on a non-production homologated TV after backup, tests, and rollback; no code was deployed to existing TVs.

**Verdict: PASS for isolated tests only. SECURITY FAIL for legacy bypass and 750ms persistent same-row holders. PRODUCTION NO-GO.**
