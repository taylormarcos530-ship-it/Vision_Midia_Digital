// Validates staging SQL candidate against already-tested disposable PGlite fixture.
// Never connects to Supabase and never applies the patch.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fixture=fs.readFileSync('tests/fixtures/commercial-safe-projection-lab.sql','utf8');
const candidate=fs.readFileSync('supabase/sql/advertiser-staging-security-candidate.sql','utf8');
const marker='REVOKE SELECT ON TABLE public.vision_commercial_revisions FROM authenticated;';
test('the staging-only candidate is identical to the approved local SQL lab body',()=>{
  assert.ok(candidate.indexOf(marker)>0,'candidate must have a review-only safety header');
  assert.equal(candidate.slice(candidate.indexOf(marker)),fixture.slice(fixture.indexOf(marker)));
  assert.match(candidate,/do not run in production or the shared staging environment without specific authorization/i);
});
test('staging SQL candidate avoids unrelated schema or player changes',()=>{
  const body=candidate.slice(candidate.indexOf(marker));
  assert.match(body,/GRANT SELECT \(/);
  assert.match(body,/CREATE OR REPLACE FUNCTION private\.vision_portal_data/);
  assert.match(body,/REVOKE ALL ON FUNCTION private\.vision_portal_data/);
  assert.doesNotMatch(body,/\b(?:drop\s+(?:table|schema)|create\s+table|truncate|delete\s+from|update\s+public\.)\b/i);
});
