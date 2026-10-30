# QA authentication integration test matrix — 2026-10-30

This is documentation only. No deployment, permission grant, or production migration is authorized.

Target: public.vision_playback_events_cursor_qa in a production-schema-compatible isolated staging database.

Prerequisites: actual Supabase Auth test accounts, two test companies, active membership for user A in company A, inactive membership for user B in company A, and isolated playback events for companies A and B. Confirm RLS and RPC grants. Do not copy production personal data.

Required checks:
1. No Authorization header / anon: RPC inaccessible (permission denied).
2. Authenticated A, company A: returns only company A events in stable (started_at DESC,id DESC) order.
3. Authenticated A, company B: SQLSTATE 42501; no rows.
4. Authenticated B, inactive membership: SQLSTATE 42501; no rows.
5. Authenticated user without membership: SQLSTATE 42501.
6. First page 500, second 500, third remainder, fourth empty; no duplicate IDs, including identical timestamps.
7. Cursor with only timestamp or only ID rejected; date range invalid rejected; limit clamped to 1..1000.
8. Date timezone boundaries, campaign/device filters, and 14 returned column types match current report.
9. Confirm current public.get_playback_events and public.get_playback_report unchanged.
10. Benchmark representative pages and inspect EXPLAIN BUFFERS; review indexing separately.

Current blocker: existing staging schema is legacy and does not contain production-compatible playback_logs fields, campaigns, playlists, or private.is_company_member. Real JWT tests are NOT completed. Existing vision_qa functions remain inaccessible to authenticated and anon roles. Do not expose vision_qa or grant permissions to work around the mismatch.

Release gate: QA results recorded, security reviewed, rollback documented, explicit authorization before production rollout.
