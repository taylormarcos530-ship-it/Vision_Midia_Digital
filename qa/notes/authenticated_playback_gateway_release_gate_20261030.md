# QA: authenticated playback pagination gateway (design only)

Status: NOT DEPLOYED. Isolated branch; no production changes.

## Evidence
- Staging legacy function vision_qa.playback_cursor_guarded passed synthetic 500+500 pagination (0 overlaps) and cross-company isolation (0 foreign events); fixtures rolled back.
- Its helper vision_qa.is_active_member_for_session checks auth.uid() and active membership. Anonymous calls rejected with SQLSTATE 42501; malformed cursor rejected.
- Staging public schema differs from production; this legacy QA function is NOT production-compatible.
- authenticated and anon currently lack USAGE on vision_qa and EXECUTE on both QA functions. Do not grant them access to private schema.

## Safe gateway design
1. In a parity-matched, isolated environment only, create a separate public RPC with SECURITY INVOKER; grant EXECUTE to authenticated only and revoke PUBLIC/anon. Never expose the private schema.
2. Use the existing production private.is_company_member(company_id) predicate for authorization, not client-supplied identity; fail closed when auth.uid() is NULL.
3. Validate paired cursor (started_at,id), limit 1..1000, and company scope; order by started_at DESC,id DESC.
4. Match all 14 return columns and types of public.get_playback_events, without replacing that RPC.
5. Test with actual Supabase Auth JWTs for active own-company, other-company, inactive and anonymous sessions. Verify RLS and RPC grants; record expected SQLSTATE and row counts.
6. Benchmark representative deep pages against existing RPC, and review indexes before any migration. Do not add indexes without separate impact assessment.
7. Require explicit approval and rollback plan before any production deployment.

## Release gate
BLOCKED: no real authenticated API test, no production-parity integration test, no full 14-column report verification. Existing report and TVs remain unchanged.
