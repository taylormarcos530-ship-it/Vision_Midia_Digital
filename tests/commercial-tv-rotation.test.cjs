const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=()=>import('../commercial-tv-bench.mjs');
const source=()=>import('../supabase/functions/_shared/commercial.mjs');

test('5 commercial advertisers receive exactly 2 insertions each across 5 simulated rounds',async()=>{
 const {simulateBench}=await load();
 const counts=Object.fromEntries([1,2,3,4,5].map(n=>['commercial-'+n,0]));
 const rounds=[];
 for(let cycle=0;cycle<5;cycle++){
  const r=simulateBench({baseCount:6,adCount:5,cycle});
  const selected=r.items.filter(item=>item.commercial).map(x=>x.id);
  assert.equal(selected.length,2);
  assert.equal(r.included,2);
  assert.equal(r.ignored,3);
  assert.equal(r.preserved,true);
  assert.equal(r.waitingNames.length,3);
  assert.deepEqual(r.items.filter(item=>!item.commercial).map(item=>item.id),
   ['base-1','base-2','base-3','base-4','base-5','base-6']);
  for(let i=1;i<r.items.length;i++)
   assert.ok(!(r.items[i-1].commercial&&r.items[i].commercial));
  selected.forEach(k=>counts[k]++);
  rounds.push(selected);
 }
 assert.deepEqual(rounds,[
  ['commercial-1','commercial-2'],
  ['commercial-3','commercial-4'],
  ['commercial-5','commercial-1'],
  ['commercial-2','commercial-3'],
  ['commercial-4','commercial-5']
 ]);
 assert.deepEqual(Object.values(counts),[2,2,2,2,2]);
});
test('single-media TV gives five fictional ads one turn each over five simulation rounds',async()=>{
 const {simulateBench}=await load();
 const all=new Set();
 for(let cycle=0;cycle<5;cycle++){
  const r=simulateBench({baseCount:1,adCount:5,cycle});
  assert.deepEqual(r.items.map(x=>x.id),['base-1','commercial-'+(cycle+1)]);
  assert.equal(r.included,1);
  all.add(r.items[1].id);
 }
 assert.equal(all.size,5);
});
test('round selection cycles deterministically and rejects bad indexes without mutating lists',async()=>{
 const {cycleCommercialSelection,interleave}=await source();
 const primary={playlist:{id:'bench',shuffle:false,repeat_mode:'all'},
  items:[1,2,3,4,5,6].map(i=>({id:'base-'+i,schedule:{enabled:false}}))};
 const ads=Array.from({length:5},(_,i)=>({id:'ad-'+(i+1),commercial:true}));
 const primaryText=JSON.stringify(primary),adsText=JSON.stringify(ads);
 for(const cycle of [0,1,2,3,4,5,29,100,-1,NaN,Infinity,1.5]){
  const result=interleave(primary,ads,3,cycle);
  assert.equal(result.items.length,8);
  assert.deepEqual(result.items.filter(x=>!x.commercial).map(x=>x.id),primary.items.map(x=>x.id));
  assert.equal(new Set(result.items.filter(x=>x.commercial).map(x=>x.id)).size,2);
 }
 assert.deepEqual(cycleCommercialSelection(ads,2,0).map(a=>a.id),
  cycleCommercialSelection(ads,2,5).map(a=>a.id));
 assert.deepEqual(cycleCommercialSelection(ads,2,-1).map(a=>a.id),
  cycleCommercialSelection(ads,2,0).map(a=>a.id));
 assert.deepEqual(cycleCommercialSelection([],2,20),[]);
 assert.deepEqual(cycleCommercialSelection(ads,0,1),[]);
 assert.equal(JSON.stringify(primary),primaryText);
 assert.equal(JSON.stringify(ads),adsText);
});
test('manual rotation never bypasses protections, disabled layer, or Aguardando playlist',async()=>{
 const {simulateBench}=await load();
 for(const cycle of [0,1,4,99]){
  for(const flags of [{baseCount:0},{shuffle:true},{single:true},{scheduled:true},{enabled:false}]){
   const result=simulateBench({...flags,baseCount:flags.baseCount??6,adCount:5,cycle});
   assert.equal(result.included,0);
   assert.deepEqual(result.items.filter(x=>x.commercial),[]);
   assert.deepEqual(result.items.filter(x=>!x.commercial).map(x=>x.id),
    result.original?.items.map(x=>x.id)||[]);
  }
 }
});
test('offline preview provides working cycle and compatibility controls without Supabase credentials',()=>{
 const html=fs.readFileSync('commercial-tv-bench.html','utf8');
 const source=fs.readFileSync('commercial-tv-bench.mjs','utf8');
 for(const id of ['bench-compatible','bench-prev-round','bench-next-round','bench-round','bench-waiting'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(source,/previous\.addEventListener\('click'/);
 assert.match(source,/next\.addEventListener\('click'/);
 assert.match(source,/compatible\.addEventListener\('click'/);
 assert.match(source,/form\.addEventListener\('change'/);
 assert.match(source,/interleave\(original,adverts,3,cycle\)/);
 assert.doesNotMatch(source,/fetch\(|createClient\(|localStorage\.|sessionStorage\.|\.supabase\.co|sb_secret_/);
 assert.doesNotMatch(html,/src=".*(?:player\.js|commercial-staging-config\.js|commercial-config\.js)"/);
 assert.match(html,/a passagem para a rodada seguinte é manual/i);
});
