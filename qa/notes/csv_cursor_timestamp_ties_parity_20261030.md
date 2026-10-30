# Playback CSV parity: timestamp ties (QA finding, 2026-10-30)

Read-only source comparison:
- Existing `public.get_playback_events` orders by `l.started_at DESC` only, then applies LIMIT/OFFSET.
- Draft `public.vision_playback_events_cursor_qa` orders by `l.started_at DESC,l.id DESC` and filters subsequent pages using `(l.started_at,l.id) < (cursor_timestamp,cursor_id)`.
- Existing date boundaries use company timezone, start inclusive and end date +1 exclusive. Draft preserves this.
- Both return 14 columns and clamp limit to 1..1000.

**Implication:** Exact row ordering of equal-timestamp events is not guaranteed by the old RPC. CSV parity should compare event ID multisets and field values, not strict line order when timestamps tie. Old OFFSET paging can produce duplicates or skips across equal timestamps or concurrent inserts. Do not change the old RPC without separate approval.

**Test cases required before rollout:**
1. Many events sharing identical started_at, across a page boundary; cursor must return each ID exactly once.
2. Date boundaries in the company timezone; filter combinations; null/removed entity name fallbacks.
3. Compare 14-column payload values and CSV output columns.
4. Real-JWT authorization and tenant isolation; staging public schema is legacy, so current isolated fixture does not replace this test.
5. No additional writes or polling; feature flag OFF by default; old export retained as fallback.

No production changes authorized.
