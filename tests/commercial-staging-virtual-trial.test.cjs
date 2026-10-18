const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const edge=fs.readFileSync('supabase/functions/commercial-staging-master/index.ts','utf8');
const run=fs.readFileSync('supabase/functions/_shared/commercial-staging-virtual-trial.mjs','utf8');
const html=fs.readFileSync('master-advertisers-homologacao.html','utf8');
const client=fs.readFileSync('master-advertisers-staging.mjs','utf8');
test('trial endpoint requires Master auth and restricts virtual device URL to homologation',()=>{
 assert.match(edge,/if\(url!==STAGING_URL\)/);
 assert.match(edge,/if\(!master\|\|master.status!=='active'/);
 assert.ok(edge.indexOf("if(action==='commercial_virtual_trial')")>edge.indexOf("if(!master||master.status!=='active'"));
 assert.match(run,/url!=='https:\/\/jmiuitrrhtaeyrpuyohk\.supabase\.co'/);
 assert.doesNotMatch(run,/fpadgedrgcxrrqflzhjt/);
 assert.match(run,/commercial-virtual-gateway/);
 assert.match(html,/id="staging-virtual-trial"/);
 assert.match(client,/commercial_virtual_trial/);
});
test('trial enforces zero existing staging devices and no operational playlist writes',()=>{
 assert.match(run,/devices\.count!==0\|\|companies\.count!==0\|\|media\.count!==0/);
 assert.match(run,/staging_not_empty/);
 assert.match(run,/startsWith\('lab-point-'\)/);
 assert.doesNotMatch(run,/from\('playlist_items'\)|from\('device_playlist_assignments'\)/);
});
test('trial tests real Storage bytes and deduplicated playback and always cleans up by IDs',()=>{
 for(const token of ['bucket.upload','bucket.copy','signed_media_bytes_changed','virtual_telemetry_not_idempotent',
  "remove('playback_logs'","remove('vision_commercial_daily'","remove('vision_commercial_revisions'",
  "remove('devices'","remove('companies'","bucket.remove"])assert.ok(run.includes(token),token);
 assert.match(run,/cleanupFailures\.length/);
 assert.match(run,/cleanup_verified:true/);
});
