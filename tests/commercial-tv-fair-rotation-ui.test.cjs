const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=()=>import('../commercial-tv-fair-rotation-ui.mjs');
const engine=()=>import('../commercial-tv-fair-rotation-lab.mjs');
const html=()=>fs.readFileSync('commercial-tv-fair-rotation-lab.html','utf8');
const source=()=>fs.readFileSync('commercial-tv-fair-rotation-ui.mjs','utf8');

test('visual lab starts with five fictitious advertisers, two placements and base-first sequence',async()=>{
 const {makeLab,labDashboard}=await load();
 const state=makeLab();
 const view=labDashboard(state);
 assert.equal(view.current.id,'point-1');
 assert.equal(view.items.length,8);
 assert.deepEqual(view.selected,['ad-1','ad-2']);
 assert.deepEqual(view.queue,['Publicidade C','Publicidade D','Publicidade E']);
 assert.deepEqual(view.advertisers.map(x=>x.plays),[0,0,0,0,0]);
 assert.deepEqual(view.items.filter(x=>!x.commercial).map(x=>x.id),
  ['point-1','point-2','point-3','point-4','point-5','point-6']);
});
test('visual completion buttons model ten cycles with equal fictitious outcomes',async()=>{
 const {makeLab,labDashboard,completeLabCycles}=await load();
 let s=makeLab();
 let result=completeLabCycles(s,5);
 assert.equal(result.accepted,true);
 s=result.state;
 assert.equal(s.completed,40);
 assert.equal(s.completedAds,10);
 assert.equal(s.completedBase,30);
 result=completeLabCycles(s,5);
 assert.equal(result.accepted,true);
 s=result.state;
 assert.equal(labDashboard(s).cycle,10);
 assert.deepEqual(labDashboard(s).advertisers.map(x=>x.plays),[4,4,4,4,4]);
});
test('local batch rejects invalid counts and never advances TV without playlist',async()=>{
 const {makeLab,completeLabCycles,labDashboard}=await load();
 const original=makeLab();
 for(const count of [0,11,-1,NaN,Infinity,1.5]){
  const out=completeLabCycles(original,count);
  assert.equal(out.accepted,false);
  assert.equal(out.state,original);
 }
 const idle=makeLab(0);
 assert.equal(completeLabCycles(idle,1).accepted,false);
 assert.equal(labDashboard(idle).currentLabel,'Aguardando playlist');
});
test('visual advertiser checklist drives in-memory pending inventory without fake completions',async()=>{
 const {makeLab,labAds,labDashboard}=await load();
 const {fairRotationEvent,fairRotationView}=await engine();
 let state=makeLab();
 state=fairRotationEvent(state,{type:'start'}).state;
 for(let i=0;i<3;i++)state=fairRotationEvent(state,{type:'complete',token:fairRotationView(state).token}).state;
 assert.equal(fairRotationView(state).current.id,'ad-1');
 const previous=state.completedAds;
 const update=fairRotationEvent(state,{type:'inventory-changed',ads:labAds(['ad-2','ad-3'])});
 assert.equal(update.accepted,true);
 state=update.state;
 assert.equal(state.running,false);
 assert.equal(labDashboard(state,['ad-2','ad-3']).hasPending,true);
 assert.equal(state.completedAds,previous);
 assert.equal(state.items.filter(item=>item.commercial).length,0);
 const continued=fairRotationEvent(state,{type:'start'});
 assert.equal(continued.accepted,true);
 state=continued.state;
 while(state.cycle===0){
  state=fairRotationEvent(state,{type:'complete',token:fairRotationView(state).token}).state;
 }
 assert.deepEqual(labDashboard(state,['ad-2','ad-3']).selected,['ad-2','ad-3']);
});
test('laboratory model keeps on-screen totals after disconnect and restart, no phantom ads',async()=>{
 const {makeLab,labDashboard,completeLabCycles}=await load();
 const {fairRotationEvent}=await engine();
 let s=completeLabCycles(makeLab(),1).state;
 assert.equal(s.completedAds,2);
 s=fairRotationEvent(s,{type:'disconnect'}).state;
 assert.equal(completeLabCycles(s,1).accepted,false);
 s=fairRotationEvent(s,{type:'reconnect'}).state;
 s=fairRotationEvent(s,{type:'restart'}).state;
 assert.equal(s.completedAds,2);
 assert.equal(labDashboard(s).connected,true);
 s=completeLabCycles(s,1).state;
 assert.equal(s.completedAds,4);
});
test('declared visual controls have matching real action handlers and accessible live feedback',()=>{
 const page=html(),js=source();
 const controls=['start','pause','finish','cycle','five','disconnect','reconnect',
  'restart','error','revalidate','reset'];
 for(const suffix of controls){
  assert.match(page,new RegExp('id="fair-'+suffix+'"'));
  assert.match(js,new RegExp('controls\\.'+suffix+'\\.addEventListener\\(\'click\''));
 }
 for(const suffix of ['round','position','base-count','ad-count','failures','current',
  'current-type','state','notice','queue','guard','sequence','toggles','advertisers','base-select'])
  assert.match(page,new RegExp('id="fair-'+suffix+'"'));
 assert.match(page,/lang="pt-BR"/);
 assert.match(page,/aria-live="polite"/);
 assert.match(page,/min-width:0/);
 assert.match(page,/@media\(max-width:480px\)/);
});
test('offline visual files have no connections, client code, real metrics or auto deploy',()=>{
 const page=html(),js=source();
 assert.match(page,/SEM TV REAL/);
 assert.match(page,/Nenhuma contagem representa impressão comercial verdadeira/);
 assert.match(page,/connect-src 'none'/);
 assert.match(page,/src="\.\/commercial-tv-fair-rotation-ui\.mjs"/);
 assert.match(js,/OFFLINE LAB ONLY/);
 assert.match(js,/import \{createFairRotationLab,fairRotationView,fairRotationEvent\}/);
 for(const raw of [page,js]){
  assert.doesNotMatch(raw,/fetch\s*\(|XMLHttpRequest|WebSocket|createClient\s*\(|localStorage|sessionStorage|supabase\.co|sb_publishable_|service_role|<script[^>]*src="https?:/i);
  assert.doesNotMatch(raw,/src="(?:\.\/)?(?:player\.js|commercial-staging-config\.js|commercial-config\.js)"/);
 }
});
