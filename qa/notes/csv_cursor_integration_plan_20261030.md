# CSV playback export: isolated cursor migration plan (2026-10-30)

## Confirmed application call site
- app.js `exportPlaybackCsv()` calls `rpc/get_playback_events` with `p_limit: 1000` and `p_offset`, looping while offset < 100000.
- The existing report display uses `report.events` separately. Do not replace the existing report RPCs.
- Existing CSV columns: Data/Hora, TV, Campanha, Playlist, Mídia, Duração (s), Status, ID do evento. Preserve exact order and semicolon/BOM encoding.
- Existing CSV export has a 100,000-event cap and uses the existing report filters; preserve behavior unless separately approved.

## Migration gate
1. Do not change `public.get_playback_events` or `public.get_playback_report` in production.
2. Test a separate cursor RPC using a production-compatible schema and a real Supabase Auth JWT, including active/inactive/foreign/anonymous access.
3. Confirm dates and time zone semantics match the existing date-based RPC. Existing cursor draft uses timestamps and a half-open interval, which must be mapped carefully from `p_start_date` and `p_end_date`.
4. For the CSV call only, test cursor pages using `(started_at,id)` from the last returned event, ordered DESC. Do not use OFFSET in the new code path.
5. Compare CSV outputs for identical frozen synthetic datasets, including ties on started_at, filters, empty results, and 100,000 cap.
6. Benchmark read load and ensure no added TV heartbeat, player polling, or write traffic.
7. Keep a feature flag default OFF and fallback to the unchanged existing CSV implementation. Rollback: disable the flag; do not remove the old RPC.
8. Release only after isolated tests, security review, and explicit production authorization.

## Current blockers
- Staging public playback_logs is legacy: 7/15 expected fixture fields present, 8 missing.
- `vision_qa` full-cursor fixture passes synthetic pagination and authorization simulations, but has no anon/authenticated EXECUTE and no real-JWT integration test.
- No production deployment authorized. This document is a plan only.
