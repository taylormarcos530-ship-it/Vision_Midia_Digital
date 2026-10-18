const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const code=fs.readFileSync('supabase/functions/commercial-staging-master/index.ts','utf8');
test('staging Master commercial endpoint strictly targets isolated database',()=>{
 assert.match(code,/const STAGING_URL = 'https:\/\/jmiuitrrhtaeyrpuyohk\.supabase\.co'/);
 assert.match(code,/if\(url!==STAGING_URL\)/);
 assert.doesNotMatch(code,/fpadgedrgcxrrqflzhjt|SUPABASE_SERVICE_ROLE_KEY.*console|console\.log/);
});
test('only commercial account operations are exposed; campaign writes and player operations excluded',()=>{
 assert.match(code,/new Set\(\['whoami','commercial_list'/);
 assert.doesNotMatch(code,/commercial_save_campaign|device-gateway|create_client|save_playlist|apply_migration/);
 assert.match(code,/allowed\.has\(action\)/);
});
test('server authorizes authenticated Master before invoking Admin commercial API',()=>{
 assert.match(code,/client\.auth\.getUser\(authorization\.slice\(7\)\)/);
 assert.match(code,/from\('platform_admins'\)/);
 assert.match(code,/master\.status!=='active'/);
 assert.match(code,/commercialMaster\(admin,identity\.user,master\.role,body\)/);
});
