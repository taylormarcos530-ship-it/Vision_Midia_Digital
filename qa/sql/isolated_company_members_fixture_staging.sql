-- Vision QA: isolated authorization fixture. NOT a replacement for private.is_company_member.
-- Run ONLY in staging after review; never apply to production.
-- All objects are under vision_qa; no public/private table or function is modified.
BEGIN;
CREATE SCHEMA IF NOT EXISTS vision_qa;
REVOKE ALL ON SCHEMA vision_qa FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS vision_qa.company_members_fixture (
 company_id uuid NOT NULL,
 user_id uuid NOT NULL,
 status text NOT NULL CHECK (status IN ('active','inactive')),
 PRIMARY KEY(company_id,user_id)
);
REVOKE ALL ON vision_qa.company_members_fixture FROM PUBLIC, anon, authenticated;
ALTER TABLE vision_qa.company_members_fixture ENABLE ROW LEVEL SECURITY;
-- No INSERTs or synthetic auth.users are created here. Test transactions must roll back.
COMMIT;
