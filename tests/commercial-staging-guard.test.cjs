const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('remote staging RLS verification must reject any database without its unique guard',()=>{
 const script=fs.readFileSync('tests/sql/staging_advertiser_rls_rollback.sql','utf8');
 assert.match(script,/private\.vision_staging_guard/);
 assert.match(script,/project_ref='jmiuitrrhtaeyrpuyohk'/);
 assert.match(script,/staging_only_guard_rejected/);
 assert.match(script,/rollback;\s*select 'PASS/);
 assert.doesNotMatch(script,/\bcommit\s*;/i);
 assert.doesNotMatch(script,/fpadgedrgcxrrqflzhjt/);
});
test('commercial frontend stays disconnected from operational Supabase in every preview',()=>{
 const config=fs.readFileSync('commercial-config.js','utf8');
 assert.match(config,/enabled:false/);
 assert.match(config,/supabaseUrl:''/);
 assert.match(config,/supabasePublishableKey:''/);
 assert.doesNotMatch(config,/fpadgedrgcxrrqflzhjt|jmiuitrrhtaeyrpuyohk/);
});
