const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const root='supabase/releases/commercial_off_20261018/';
const read=path=>fs.readFileSync(root+path,'utf8');
test('production commercial gateway is hard disabled in all 3 paths independent of env',()=>{
 const src=read('device-gateway/index.ts');
 assert.match(src,/const COMMERCIAL_RELEASE_APPROVED = false;/);
 assert.equal((src.match(/COMMERCIAL_RELEASE_APPROVED && commercialPilotDeviceAllowed/g)||[]).length,3);
 for(const s of ['manifest','playback_batch','refreshCommercialDaily','decorateCommercialRows','augmentCommercial'])
   assert.ok(src.includes(s),'must preserve '+s);
 assert.ok(!src.includes('jmiuitrrhtaeyrpuyohk'),'production must not point to staging');
});
test('Master commercial operations remain disabled even when legacy env flag is true',()=>{
 const src=read('master-admin/index.ts');
 assert.match(src,/const COMMERCIAL_RELEASE_APPROVED = false;/);
 assert.match(src,/if\(!COMMERCIAL_RELEASE_APPROVED\|\|Deno\.env\.get\('VISION_COMMERCIAL_ENABLED'\)!=='true'\)/);
 assert.ok(src.includes("return J({error:'commercial_staging_not_enabled'},503)"));
 assert.ok(src.includes("return J({ok:true,is_master:true,role,email:user.email})"));
});
test('all relative dependencies are packaged as reviewed frozen bundle',()=>{
 for(const file of ['_shared/commercial.mjs','_shared/commercial-pilot-allowlist.mjs',
 '_shared/commercial-master.mjs','_shared/commercial-media.mjs','_shared/web-push.ts'])
  assert.ok(read(file).length>100);
 assert.match(read('device-gateway/index.ts'),/\bcommercialPilotDeviceAllowed\b/);
 assert.match(read('master-admin/index.ts'),/\bcommercialMaster\b/);
});
