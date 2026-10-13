const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('Master demonstration uses fictional accounts, no real device and zero playback events',async()=>{
 const {masterDemoList,masterDemoReport}=await import('../commercial-master-demo.mjs');
 const listed=masterDemoList();
 assert.equal(listed.advertisers.length,1);
 assert.match(listed.advertisers[0].name,/demonstração/);
 assert.match(listed.advertisers[0].email,/@anunciante\.test$/);
 assert.equal(listed.devices[0].last_seen_at,null);
 const report=masterDemoReport(listed.advertisers[0].id);
 assert.deepEqual(report.daily,[]);
 assert.equal(report.targets[0].online,false);
 assert.equal(report.campaigns[0].advertiser_id,listed.advertisers[0].id);
 assert.throws(()=>masterDemoReport('real-account'),/não encontrado/);
});
test('both previews remain disconnected, permit only local simulation and disclose demo mode',()=>{
 const cfg=fs.readFileSync('commercial-config.js','utf8');
 const html=fs.readFileSync('master-advertisers.html','utf8');
 const js=fs.readFileSync('master-advertisers.mjs','utf8');
 assert.match(cfg,/enabled:false/);
 assert.match(cfg,/supabaseUrl:''/);
 assert.match(cfg,/supabasePublishableKey:''/);
 assert.match(html,/DEMONSTRAÇÃO INTERATIVA/);
 assert.match(js,/demoSession\.list\(\)/);
 assert.match(js,/if\(demo&&!b\.dataset\.report&&!b\.dataset\.archive&&!b\.dataset\.restore\)return/);
 assert.match(js,/if\(!demo\)await loadThumbnails/);
 assert.match(js,/if\(!demo\)advertiser\(\)/);
 assert.match(js,/demoSession\.report\(b\.dataset\.report\)/);
 assert.match(js,/if\(demo\)demoSession\.archive\(a\.id\);else await api\.masterCall\('commercial_archive_advertiser'/);
 assert.match(js,/if\(demo\)demoSession\.restore\(a\.id\);else await api\.masterCall\('commercial_restore_advertiser'/);
 assert.match(js,/button:not\(\[data-report\]\):not\(\[data-archive\]\):not\(\[data-restore\]\)/);
 for(const p of ['player.js','android-player/app/src/main/java'])assert.ok(!js.includes(p));
});

test('local Excluir hides an advertiser but preserves campaign, history and restores disabled',async()=>{
 const {createMasterDemoSession}=await import('../commercial-master-demo.mjs');
 const demo=createMasterDemoSession();
 const original=demo.list();
 const id=original.advertisers[0].id;
 assert.equal(original.advertisers[0].status,'active');
 assert.equal(original.advertisers[0].archived_at,undefined);
 assert.deepEqual(demo.report(id).daily,[]);
 assert.equal(demo.archive(id).archived,true);
 const archived=demo.list();
 assert.equal(archived.advertisers[0].status,'disabled');
 assert.ok(archived.advertisers[0].archived_at);
 assert.equal(archived.campaigns.length,original.campaigns.length,'do not erase fictional campaign');
 assert.deepEqual(demo.report(id).daily,[],'history is still accessible');
 assert.throws(()=>demo.archive(id),/já excluído/);
 const freshSession=createMasterDemoSession();
 assert.equal(freshSession.list().advertisers[0].status,'active','each browser load starts fresh');
 assert.equal(demo.restore(id).restored,true);
 assert.equal(demo.list().advertisers[0].archived_at,null);
 assert.equal(demo.list().advertisers[0].status,'disabled','restore never enables campaign or account');
 assert.throws(()=>demo.restore(id),/ainda não foi excluído/);
 const detached=demo.list();detached.advertisers[0].status='active';
 assert.equal(demo.list().advertisers[0].status,'disabled','read results are detached from live in-memory fixture');
});
test('demo sandbox contains no persistence or remote endpoint and never sends writes',async()=>{
 const fs=require('node:fs');
 const source=fs.readFileSync('commercial-master-demo.mjs','utf8');
 const master=fs.readFileSync('master-advertisers.mjs','utf8');
 for(const token of ['fetch(','createClient(','supabaseUrl','admin.auth','service_role']){
  assert.equal(source.includes(token),false,'demo fixture must not include '+token);
 }
 assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage)\s*[.\[(]/);
 assert.match(master,/demo\?demoSession\.list\(\):await api\.masterCall/);
 assert.match(master,/demo\?demoSession\.report\(b\.dataset\.report\):await api\.masterCall/);
 assert.match(master,/if\(demo\)demoSession\.archive\(a\.id\);else await api\.masterCall/);
 assert.match(master,/if\(demo\)demoSession\.restore\(a\.id\);else await api\.masterCall/);
});
