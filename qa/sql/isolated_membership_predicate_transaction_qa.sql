-- QA ONLY: run in the staging database. No production objects modified.
-- Transaction-scoped test of the production membership predicate using synthetic actors.
-- The real function private.is_company_member uses auth.uid(); this fixture substitutes
-- an explicit actor solely to verify the same EXISTS/status logic, not actual JWT handling.
BEGIN;
INSERT INTO vision_qa.company_members_fixture(company_id,user_id,status) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','active'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','active'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','inactive');
WITH cases AS (
 SELECT 'active_member' scenario,'11111111-1111-4111-8111-111111111111'::uuid actor,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid company,true expected
 UNION ALL SELECT 'other_company','22222222-2222-4222-8222-222222222222'::uuid,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,false
 UNION ALL SELECT 'inactive_member','33333333-3333-4333-8333-333333333333'::uuid,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,false
 UNION ALL SELECT 'anonymous',NULL::uuid,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,false
), checked AS (
 SELECT scenario,expected,(actor IS NOT NULL AND EXISTS(SELECT 1 FROM vision_qa.company_members_fixture m WHERE m.company_id=cases.company AND m.user_id=cases.actor AND m.status='active')) actual FROM cases
)
SELECT scenario,expected,actual,(expected=actual) passed FROM checked ORDER BY scenario;
ROLLBACK;
-- Confirm separately: SELECT count(*) FROM vision_qa.company_members_fixture; -- expect 0
