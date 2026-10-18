const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {issueVirtualToken,verifyVirtualToken}=require('../supabase/functions/_shared/commercial-virtual-token.mjs');
const source=fs.readFileSync('supabase/functions/commercial-virtual-gateway/index.ts','utf8');
const tokenSecret='ONLY-TEST-NOT-A-PRODUCTION-KEY';
const uuid='f4000b60-cd18-44e2-bbbf-7189d32efb22';
test('synthetic token is authenticated, time-limited and bound to a virtual UUID',async()=>{
 const proof=await issueVirtualToken(tokenSecret,uuid,90);const verified=await verifyVirtualToken(tokenSecret,proof);
 assert.equal(verified.deviceId,uuid);assert.ok(verified.nonce);
 assert.equal(await verifyVirtualToken('WRONG-TEST-KEY',proof),null);
 assert.equal(await verifyVirtualToken(tokenSecret,proof.replace(/.$/,proof.endsWith('0')?'1':'0')),null);
 assert.equal(await verifyVirtualToken(tokenSecret,proof,verified.expiresAt),null);
 assert.equal(await verifyVirtualToken(tokenSecret,proof,verified.expiresAt-121),null);
 await assert.rejects(issueVirtualToken(tokenSecret,uuid,121));
});
test('staging-only gateway authorizes Master and a separately signed device token',()=>{
 assert.match(source,/const STAGING='https:\/\/jmiuitrrhtaeyrpuyohk\.supabase\.co'/);
 assert.match(source,/Deno\.env\.get\('SUPABASE_URL'\)!==STAGING/);
 assert.match(source,/auth\.getUser\(bearer\.slice\(7\)\)/);
 assert.match(source,/from\('platform_admins'\)/);
 assert.match(source,/verifyVirtualToken\(key,request\.headers\.get\('x-device-token'\)\)/);
 assert.match(source,/device\.name\.startsWith\('LAB-VIRTUAL-'\)/);
 assert.match(source,/company\?\.name\?\.startsWith\('LAB-VIRTUAL-'\)/);
 assert.doesNotMatch(source,/fpadgedrgcxrrqflzhjt/);
 assert.doesNotMatch(source,/from\('device_playlist_assignments'\)|from\('device_credentials'\)/);
});
test('virtual-only gateway preserves all six base items and restricts commercial event writes',()=>{
 assert.match(source,/Array\.from\(\{length:6\}/);
 assert.match(source,/augmentCommercial\(admin,device,original,true,true\)/);
 assert.match(source,/vision_commercial_manifest/);
 assert.match(source,/allowed\.has\(item\.media_id\)/);
 assert.match(source,/ignoreDuplicates:true/);
 assert.match(source,/refreshCommercialDaily\(admin,device\.id,true\)/);
 assert.doesNotMatch(source,/\.from\('playlist_items'\).*\.update/);
});
