const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('two advertiser previews are independent and never fabricate real playback',async()=>{
 const {demoAdvertiserData,demoAdvertiserOptions}=await import('../commercial-advertiser-demo.mjs');
 assert.deepEqual(demoAdvertiserOptions.map(x=>x.id),['loja-a','loja-b','bloqueado']);
 const a=demoAdvertiserData('loja-a'),b=demoAdvertiserData('loja-b');
 assert.notEqual(a.advertiser.id,b.advertiser.id);
 assert.notEqual(a.advertiser.email,b.advertiser.email);
 assert.notEqual(a.campaigns[0].id,b.campaigns[0].id);
 assert.notEqual(a.revisions[0].id,b.revisions[0].id);
 assert.notEqual(a.targets[0].device_id,b.targets[0].device_id);
 assert.equal(a.campaigns[0].advertiser_id,a.advertiser.id);
 assert.equal(b.campaigns[0].advertiser_id,b.advertiser.id);
 assert.equal(a.targets[0].campaign_id,a.campaigns[0].id);
 assert.equal(b.targets[0].campaign_id,b.campaigns[0].id);
 assert.deepEqual(a.daily,[]);
 assert.deepEqual(b.daily,[]);
 assert.equal(a.targets[0].online,false);
 assert.equal(b.targets[0].online,false);
 assert.equal(a.revisions[0].storage_path,null);
 assert.equal(b.revisions[0].storage_path,null);
});

test('blocked and unknown fictional identity cannot disclose advertiser data',async()=>{
 const {demoAdvertiserData}=await import('../commercial-advertiser-demo.mjs');
 assert.equal(demoAdvertiserData('bloqueado'),null);
 assert.throws(()=>demoAdvertiserData('nonexistent-identity'),/fictício não encontrado/);
 const a=demoAdvertiserData('loja-a');
 a.campaigns[0].name='modified';
 assert.notEqual(demoAdvertiserData('loja-a').campaigns[0].name,'modified');
});

test('preview switcher is isolated to demo URL without persistence, network or credentials',()=>{
 const mod=fs.readFileSync('commercial-advertiser-demo.mjs','utf8');
 const ui=fs.readFileSync('commercial-advertiser-demo-ui.mjs','utf8');
 const html=fs.readFileSync('anunciante.html','utf8');
 const app=fs.readFileSync('advertiser-portal.mjs','utf8');
 for(const source of [mod,ui]){
  for(const forbidden of ['fetch(','createClient(','service_role','localStorage.','sessionStorage.','vision_advertiser_portal']){
   assert.equal(source.includes(forbidden),false,'demo only: '+forbidden);
  }
 }
 assert.match(ui,/get\('demo'\)==='1'/);
 assert.match(ui,/getElementById\('demo-advertiser'\)/);
 assert.match(ui,/picker\.addEventListener\('change',refresh\)/);
 assert.match(html,/id="demo-advertiser"/);
 assert.match(html,/commercial-advertiser-demo-ui\.mjs/);
 assert.match(app,/demo\?demoAdvertiserData/);
 assert.match(app,/if\(demo&&!data\)/);
});
