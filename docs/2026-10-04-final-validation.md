# Final publication — 2026-10-04

- Capacity card uses a single bounded grid column; mobile browser checks confirm no horizontal overflow.
- Expiry messages are persisted company notifications, with existing per-user read/deletion states. Virtual expiry cards were removed.
- Inbox returns and displays at most the three newest company messages. The existing database retention trigger remains active.
- Supabase subscription-alerts runs through pg_cron/pg_net every 15 minutes. A private random scheduler token authenticates the function; its validation/claim/finish RPCs are service-role only.
- Notices are keyed by source company, recipient company, due timestamp and phase. Renewal/cancellation cancels queued stale notices. Delivery retries are bounded to three attempts; a stable push tag prevents stacked duplicate retry notifications.
- Live test: HTTP 200, two deliveries processed; two Master push subscriptions accepted the alert, customer skipped because no subscriptions. Repeat enqueue returned zero notices. This does not prove that the OS displayed push notifications.
- 27 regression tests pass; mobile browser checked plan capacity, max-three inbox, mark-read, delete, sidebar dismissal and expandable setup. H.264 MP4 completed actual Player playback in the earlier browser test; physical TV Box playback remains unverified.
- device-gateway was patched from its live version 12 to preserve deployed differences: version 13 only adds optional apk_version/player_version heartbeat persistence. The repository file receives those same additions without reverting the live function.
- APK 1.5.3-preview, versionCode 15, binary SHA-256 0cf3aa676a75afe668b1d1e231f58a3fe2b040611f57c283c3ab18a7e6b34a00. Its eleven bundled assets and source fingerprint were verified against source and the downloaded binary.
- APK signing certificate differs from 1.5.2. Updating over that installation cannot be guaranteed without the original keystore. Do not recommend uninstalling paired devices. Stable signing and automatic APK installation are not claimed complete.

## Publication blocked

Netlify production upload deploy `6ac2bf1e9a268aff07c6265a` was skipped on 2026-10-04 with `Skipped due to account credit usage exceeded`. No repeated deployment attempts. The final frontend fixes are committed but are NOT published to the main Netlify site. Restoring credits/account capacity is required before retrying. Commits use `[skip ci] [skip netlify]` to avoid automatic previews.

Supabase migration and functions are live: subscription-alerts v1, notification-inbox v2, device-gateway v13. The last observed device still reports web Player 1.5.2 with no APK version; physical APK verification remains open.
