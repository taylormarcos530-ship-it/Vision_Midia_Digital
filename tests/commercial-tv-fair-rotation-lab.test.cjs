const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const load=()=>import('../commercial-tv-fair-rotation-lab.mjs');
const ads=(n=5)=>Array.from({length:n},(_,i)=>({
 id:'ad-'+(i+1),media:{id:'revision-'+(i+1),name:'Fictício '+(i+1)},
 schedule:{enabled:true},commercial:true
}));
const base=(n=6)=>n===0?null:{
 playlist:{id:'autocenter-test',shuffle:false,repeat_mode:'all'},
 items:Array.from({length:n},(_,i)=>({
  id:'point-'+(i+1),schedule:{enabled:false},
  media:{id:'point-media-'+(i+1),name:'Auto Center '+(i+1)}
 }))
};
async function finishOneCycle(s,api){
 let result;
 // Completing a cycle advances automatically; only an interrupted/initial lab needs Start.
 if(!s.running){
  result=api.fairRotationEvent(s,{type:'start'});
  assert.equal(result.accepted,true);
  s=result.state;
 }
 const target=s.cycle+1;
 for(let i=0;i<25&&s.cycle<target;i++){
  const v=api.fairRotationView(s);
  assert.ok(v.current,'unexpected empty program');
  result=api.fairRotationEvent(s,{type:'complete',token:v.token});
  assert.equal(result.accepted,true);s=result.state;
 }
 assert.equal(s.cycle,target,'cycle never completed');
 return s;
}
test('fair round-robin rewards only completed ads; five ads have equal turns across ten cycles',async()=>{
 const api=await load(),primary=base(),creatives=ads();
 const frozenBase=structuredClone(primary),frozenAds=structuredClone(creatives);
 let s=api.createFairRotationLab(primary,creatives);
 const history=[];
 for(let i=0;i<10;i++){
  const v=api.fairRotationView(s);
  history.push(v.selected);
  assert.equal(v.items.length,8);
  assert.deepEqual(v.items.filter(x=>!x.commercial),primary.items);
  for(let j=1;j<v.items.length;j++)
   assert.ok(!(v.items[j-1].commercial&&v.items[j].commercial));
  assert.equal(new Set(v.selected).size,2);
  s=await finishOneCycle(s,api);
 }
 assert.deepEqual(history.slice(0,5),[
  ['ad-1','ad-2'],['ad-3','ad-4'],['ad-5','ad-1'],['ad-2','ad-3'],['ad-4','ad-5']
 ]);
 assert.deepEqual(ads().map(x=>s.played[x.id]),[4,4,4,4,4]);
 assert.equal(s.completed,80);
 assert.equal(s.completedBase,60);
 assert.equal(s.completedAds,20);
 assert.deepEqual(primary,frozenBase);assert.deepEqual(creatives,frozenAds);
});
test('a short assigned playlist still keeps every base item ahead of the commercial',async()=>{
 const api=await load();
 let s=api.createFairRotationLab(base(1),ads());
 for(let i=0;i<5;i++){
  assert.deepEqual(api.fairRotationView(s).items.map(x=>x.id),['point-1','ad-'+(i+1)]);
  s=await finishOneCycle(s,api);
 }
 assert.deepEqual(ads().map(x=>s.played[x.id]),[1,1,1,1,1]);
 assert.equal(s.completedBase,5);
});
test('interruptions and duplicate decoder callbacks never count phantom ad plays',async()=>{
 const api=await load();
 let s=api.createFairRotationLab(base(),ads());
 s=api.fairRotationEvent(s,{type:'start'}).state;
 for(let i=0;i<3;i++){
  const v=api.fairRotationView(s);
  s=api.fairRotationEvent(s,{type:'complete',token:v.token}).state;
 }
 assert.equal(api.fairRotationView(s).current.id,'ad-1');
 const token=api.fairRotationView(s).token;
 s=api.fairRotationEvent(s,{type:'disconnect'}).state;
 assert.equal(api.fairRotationEvent(s,{type:'complete',token}).accepted,false);
 assert.equal(s.completedAds,0);
 s=api.fairRotationEvent(s,{type:'reconnect'}).state;
 assert.equal(api.fairRotationEvent(s,{type:'complete',token}).accepted,false);
 s=api.fairRotationEvent(s,{type:'start'}).state;
 const beforeRestart=api.fairRotationView(s).token;
 s=api.fairRotationEvent(s,{type:'restart'}).state;
 assert.equal(api.fairRotationEvent(s,{type:'complete',token:beforeRestart}).accepted,false);
 s=api.fairRotationEvent(s,{type:'start'}).state;
 const fresh=api.fairRotationView(s).token;
 s=api.fairRotationEvent(s,{type:'complete',token:fresh}).state;
 assert.equal(s.completedAds,1);
 assert.equal(api.fairRotationEvent(s,{type:'complete',token:fresh}).accepted,false);
 assert.equal(s.completedAds,1);
});
test('removing an advertiser mid-cycle cancels stale ads without skipping base media',async()=>{
 const api=await load(),primary=base();
 let s=api.createFairRotationLab(primary,ads(3));
 s=api.fairRotationEvent(s,{type:'start'}).state;
 for(let i=0;i<3;i++)s=api.fairRotationEvent(s,{type:'complete',token:api.fairRotationView(s).token}).state;
 assert.equal(api.fairRotationView(s).current.id,'ad-1');
 const cancelledToken=api.fairRotationView(s).token;
 const changed=api.fairRotationEvent(s,{type:'inventory-changed',ads:[ads(3)[1]]});
 assert.equal(changed.accepted,true);s=changed.state;
 assert.equal(s.running,false);
 assert.deepEqual(s.items,primary.items);
 assert.equal(s.position,3);
 assert.equal(s.completedBase,3);
 assert.equal(s.completedAds,0);
 assert.equal(api.fairRotationEvent(s,{type:'complete',token:cancelledToken}).accepted,false);
 s=api.fairRotationEvent(s,{type:'start'}).state;
 while(s.cycle===0){
  const v=api.fairRotationView(s);
  s=api.fairRotationEvent(s,{type:'complete',token:v.token}).state;
 }
 assert.equal(s.completedBase,6);
 assert.equal(s.completedAds,0);
 assert.deepEqual(api.fairRotationView(s).selected,['ad-2']);
 assert.equal(api.fairRotationView(s).items.includes(primary.items[0]),true);
});
test('new advertiser joins only after the current cycle has safely finished',async()=>{
 const api=await load();
 let s=api.createFairRotationLab(base(),ads(2));
 const oldToken=api.fairRotationView(s).token;
 s=api.fairRotationEvent(s,{type:'inventory-changed',ads:ads(3)}).state;
 assert.equal(s.cycle,0);assert.equal(s.items.length,6);
 assert.equal(api.fairRotationEvent(s,{type:'complete',token:oldToken}).accepted,false);
 s=api.fairRotationEvent(s,{type:'start'}).state;
 for(let i=0;i<6;i++)s=api.fairRotationEvent(s,{type:'complete',token:api.fairRotationView(s).token}).state;
 assert.equal(s.cycle,1);
 assert.equal(s.items.length,8);
 assert.equal(s.inventory.length,3);
 assert.equal(s.completedAds,0);
});
test('commercial codec failure stops playback, never counts impression, and fails closed',async()=>{
 const api=await load(),primary=base();
 let s=api.createFairRotationLab(primary,ads(3));
 s=api.fairRotationEvent(s,{type:'start'}).state;
 for(let i=0;i<3;i++)s=api.fairRotationEvent(s,{type:'complete',token:api.fairRotationView(s).token}).state;
 const adToken=api.fairRotationView(s).token;
 s=api.fairRotationEvent(s,{type:'media-error',token:adToken}).state;
 assert.equal(s.failures,1);assert.equal(s.completedAds,0);
 assert.equal(s.blocked,true);assert.equal(s.running,false);
 assert.deepEqual(s.items,primary.items);
 assert.equal(s.position,3);
 assert.equal(api.fairRotationEvent(s,{type:'complete',token:adToken}).accepted,false);
 s=api.fairRotationEvent(s,{type:'start'}).state;
 for(let i=0;i<3;i++)s=api.fairRotationEvent(s,{type:'complete',token:api.fairRotationView(s).token}).state;
 assert.equal(s.cycle,1);assert.equal(s.items.length,6);
 assert.equal(s.completedBase,6);assert.equal(s.completedAds,0);
});
test('commercial revalidation requires explicit refreshed inventory after failure',async()=>{
 const api=await load();
 let s=api.createFairRotationLab(base(),ads(2));
 s=api.fairRotationEvent(s,{type:'start'}).state;
 for(let i=0;i<3;i++)s=api.fairRotationEvent(s,{type:'complete',token:api.fairRotationView(s).token}).state;
 s=api.fairRotationEvent(s,{type:'media-error',token:api.fairRotationView(s).token}).state;
 assert.equal(s.blocked,true);
 s=api.fairRotationEvent(s,{type:'inventory-changed',ads:ads(2)}).state;
 assert.equal(s.blocked,true);
 s=api.fairRotationEvent(s,{type:'revalidate'}).state;
 assert.equal(s.blocked,false);assert.equal(s.items.length,6);
 s=api.fairRotationEvent(s,{type:'start'}).state;
 for(let i=0;i<3;i++)s=api.fairRotationEvent(s,{type:'complete',token:api.fairRotationView(s).token}).state;
 assert.equal(s.cycle,1);assert.equal(s.items.length,8);
});
test('invalid or duplicate commercial identifiers disable ads without touching base',async()=>{
 const api=await load(),primary=base();
 for(const input of [[ads()[0],ads()[0]],[{id:'broken'}],null,Array(21).fill(ads()[0])]){
  const s=api.createFairRotationLab(primary,input);
  assert.equal(s.blocked,true);
  assert.deepEqual(api.fairRotationView(s).items,primary.items);
 }
 const s=api.createFairRotationLab(primary,ads());
 const result=api.fairRotationEvent(s,{type:'inventory-changed',ads:[ads()[0],ads()[0]]});
 assert.equal(result.accepted,false);
 assert.equal(result.state.blocked,true);
 assert.deepEqual(result.state.items,primary.items);
});
test('no assigned playlist and protected playlist modes never receive ads',async()=>{
 const api=await load();
 const none=api.createFairRotationLab(null,ads());
 assert.equal(api.fairRotationView(none).current,null);
 assert.equal(api.fairRotationEvent(none,{type:'start'}).accepted,false);
 for(const mod of [
  p=>({...p,playlist:{...p.playlist,shuffle:true}}),
  p=>({...p,playlist:{...p.playlist,repeat_mode:'single'}}),
  p=>({...p,items:p.items.map((x,i)=>i===2?{...x,schedule:{enabled:true}}:x)})
 ]){
  const s=api.createFairRotationLab(mod(base()),ads());
  assert.equal(s.items.length,6);
  assert.equal(s.items.filter(x=>x.commercial).length,0);
 }
});
test('fairness lab source is disconnected from all real systems',()=>{
 const src=readFileSync('commercial-tv-fair-rotation-lab.mjs','utf8');
 assert.match(src,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(src,/\bfetch\s*\(|createClient\s*\(|supabaseUrl|service_role|\.supabase\.co|device-gateway\/index|\bplayer\.js\b|localStorage|sessionStorage|writeFileSync|https?:\/\//);
 assert.match(src,/import \{commercialEligibility,interleave\}/);
});
