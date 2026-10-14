const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path='tests/sql/staging_link_two_auth_advertisers.sql';

test('staging-only Auth binding refuses wrong project, unknown or unconfirmed user',()=>{
 const sql=fs.readFileSync(path,'utf8');
 assert.match(sql,/to_regclass\('private\.vision_staging_guard'\) is null/);
 assert.match(sql,/project_ref='jmiuitrrhtaeyrpuyohk'/);
 assert.match(sql,/staging_only_guard_rejected/);
 assert.match(sql,/email_confirmed_at is not null/);
 assert.match(sql,/is_anonymous is not true/);
 assert.match(sql,/two_distinct_test_emails/);
 assert.match(sql,/test_users_not_confirmed_or_not_found/);
 assert.doesNotMatch(sql,/fpadgedrgcxrrqflzhjt/);
});
test('staging binding changes only dedicated advertiser rows after Auth users exist',()=>{
 const sql=fs.readFileSync(path,'utf8');
 assert.match(sql,/public\.vision_advertisers\(user_id,name,email,status\)/);
 assert.match(sql,/on conflict\(user_id\) do nothing/);
 assert.match(sql,/archived_account_requires_master_review/);
 for(const forbidden of [
  /insert\s+into\s+auth\.users/i,
  /update\s+auth\.users/i,
  /delete\s+from\s+auth\.users/i,
  /insert\s+into\s+public\.playback_logs/i,
  /\bservice_role\b/i,
  /sb_secret_/i,
  /encrypted_password\s*=/i,
  /\bpassword\s*\=\s*'/i
 ])assert.doesNotMatch(sql,forbidden);
 assert.equal((sql.match(/insert into public\.vision_advertisers\(/g)||[]).length,2);
 assert.match(sql,/begin;[\s\S]*commit;/i);
});
test('Auth binding cannot be executed meaningfully until two specific emails are chosen',()=>{
 const sql=fs.readFileSync(path,'utf8');
 assert.match(sql,/__TEST_EMAIL_A__/);
 assert.match(sql,/__TEST_EMAIL_B__/);
 assert.match(sql,/email_a like '%__test_email%'/);
 assert.match(sql,/email_b like '%__test_email%'/);
});

test('linked A/B isolation verification is strictly staging-only and always rolls back',()=>{
 const sql=fs.readFileSync('tests/sql/staging_linked_accounts_rls_rollback.sql','utf8');
 assert.match(sql,/private\.vision_staging_guard/);
 assert.match(sql,/project_ref='jmiuitrrhtaeyrpuyohk'/);
 assert.match(sql,/staging_only_guard_rejected/);
 assert.match(sql,/set local role authenticated/);
 assert.match(sql,/vision_advertiser_portal\(\)/);
 assert.match(sql,/archived advertiser still can access portal/);
 assert.match(sql,/rollback;\s*select 'PASS/);
 assert.doesNotMatch(sql,/\bcommit\s*;/i);
 assert.doesNotMatch(sql,/fpadgedrgcxrrqflzhjt/);
 assert.doesNotMatch(sql,/insert into auth\.users/i);
 assert.doesNotMatch(sql,/encrypted_password\s*=/i);
});
