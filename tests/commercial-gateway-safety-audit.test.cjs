// Isolated contract tests: no remote Supabase, no customer player, no production access.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const load=()=>import('../supabase/functions/_shared/commercial.mjs');

function basePlaylist(){
 return {
  updatedAt:'fixture-v1',
  playlist:{id:'fixture-playlist',shuffle:false,repeat_mode:'all'},
  items:Array.from({length:6},(_,i)=>({
   id:'point-'+(i+1),schedule:{enabled:false},
   media:{id:'point-media-'+(i+1),name:'Mídia local '+(i+1),checksum:'original-'+(i+1)}
  })),
  fallback:{playlist:{id:'backup'},items:[{id:'backup-item'}]}
 };
}
function revisions(count=3){
 return Array.from({length:count},(_,i)=>({
  id:'commercial-revision-'+(i+1),
  storage_path:'commercial-ads/fictional-'+(i+1)+'.webp',
  name:'Anunciante fictício '+(i+1),media_type:'image',
  duration_seconds:8,size_bytes:2048,checksum:'fake-'+(i+1),
  width:1920,height:1080,start_date:'2026-10-01',end_date:'2026-11-30'
 }));
}
function backend(rows,signer){
 const trace=[];
 const admin={
  async rpc(name,payload){
   trace.push({kind:'rpc',name,payload});
   if(name==='vision_commercial_manifest')return {data:rows,error:null};
   if(name==='vision_commercial_delivery')return {data:null,error:null};
   throw new Error('unexpected_rpc_'+name);
  },
  storage:{from(bucket){
   trace.push({kind:'bucket',bucket});
   assert.equal(bucket,'vision-media');
   return {async createSignedUrls(paths,seconds){
    trace.push({kind:'signed',paths,seconds});
    return signer?signer(paths):{data:paths.map(path=>({path,signedUrl:'https://example.invalid/'+path})),error:null};
   }};
  }}
 };
 return {admin,trace};
}

test('gateway opt-out has zero RPCs, signed URLs, and playlist mutations',async()=>{
 const {augmentCommercial}=await load();
 const primary=basePlaylist(),snapshot=structuredClone(primary);
 const {admin,trace}=backend(revisions());
 const actual=await augmentCommercial(admin,{id:'fictional-tv'},primary,true,false);
 assert.equal(actual,primary);
 assert.deepEqual(primary,snapshot);
 assert.equal(trace.length,0);
});

test('incompatible base programs never query commercial manifest or Storage',async()=>{
 const {augmentCommercial}=await load();
 for(const scenario of [
  {name:'no assignment',primary:null,schedules:true,zone:'America/Sao_Paulo'},
  {name:'empty playlist',primary:{...basePlaylist(),items:[]},schedules:true,zone:'America/Sao_Paulo'},
  {name:'shuffle',primary:{...basePlaylist(),playlist:{...basePlaylist().playlist,shuffle:true}},schedules:true,zone:'America/Sao_Paulo'},
  {name:'single',primary:{...basePlaylist(),playlist:{...basePlaylist().playlist,repeat_mode:'single'}},schedules:true,zone:'America/Sao_Paulo'},
  {name:'schedule',primary:{...basePlaylist(),items:[{...basePlaylist().items[0],schedule:{enabled:true}}]},schedules:true,zone:'America/Sao_Paulo'},
  {name:'old player',primary:basePlaylist(),schedules:false,zone:'America/Sao_Paulo'},
  {name:'timezone',primary:basePlaylist(),schedules:true,zone:'America/Manaus'}
 ]){
  const {admin,trace}=backend(revisions());
  const before=structuredClone(scenario.primary);
  const out=await augmentCommercial(admin,{id:'fictional-tv'},scenario.primary,scenario.schedules,true,scenario.zone);
  assert.equal(out,scenario.primary,scenario.name);
  assert.deepEqual(scenario.primary,before,scenario.name);
  assert.deepEqual(trace.map(x=>x.name||x.kind),['vision_commercial_delivery'],scenario.name);
 }
});

test('signing failure fails closed and returns original playlist unchanged',async()=>{
 const {augmentCommercial}=await load();
 const primary=basePlaylist(),before=structuredClone(primary);
 const {admin,trace}=backend(revisions(),async()=>({data:[],error:new Error('fixture-signing-unavailable')}));
 const oldWarn=console.warn;console.warn=()=>{};
 try{
  const out=await augmentCommercial(admin,{id:'fictional-tv'},primary,true,true);
  assert.equal(out,primary);
  assert.deepEqual(primary,before);
  assert.equal(trace.some(x=>x.kind==='signed'),true);
 }finally{console.warn=oldWarn;}
});

test('partial signed media only inserts available ads and signals degraded delivery',async()=>{
 const {augmentCommercial}=await load();
 const primary=basePlaylist(),before=structuredClone(primary);
 const {admin,trace}=backend(revisions(3),async paths=>({
  data:[{path:paths[0],signedUrl:'https://example.invalid/local-signed-1'}],error:null
 }));
 const out=await augmentCommercial(admin,{id:'fictional-tv'},primary,true,true);
 assert.notEqual(out,primary);
 assert.equal(out.playlist,primary.playlist);
 assert.equal(out.fallback,primary.fallback);
 assert.deepEqual(out.items.map(x=>x.id),[
  'point-1','point-2','point-3','commercial-revision-1','point-4','point-5','point-6'
 ]);
 assert.deepEqual(out.items.filter(x=>x.id.startsWith('point-')),primary.items);
 assert.deepEqual(primary,before);
 assert.equal(out.items[3].schedule.enabled,true);
 assert.equal(out.items[3].media.id,'commercial-revision-1');
 assert.equal(trace.find(x=>x.kind==='signed').seconds,21600);
 assert.equal(trace.find(x=>x.name==='vision_commercial_delivery').payload.p_status,'media_unavailable');
});

test('zero active campaigns leaves the assigned playlist untouched',async()=>{
 const {augmentCommercial}=await load();
 const primary=basePlaylist();
 const {admin,trace}=backend([]);
 assert.equal(await augmentCommercial(admin,{id:'fictional-tv'},primary,true,true),primary);
 assert.deepEqual(trace.map(x=>x.name||x.kind),[
  'vision_commercial_manifest','vision_commercial_delivery'
 ]);
 assert.equal(trace[1].payload.p_status,'no_active_campaign');
});

test('real gateway has explicit flag gate, protected base fallback, no client player changes',()=>{
 const gateway=readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 const shared=readFileSync('supabase/functions/_shared/commercial.mjs','utf8');
 const settings=readFileSync('commercial-config.js','utf8');
 assert.match(gateway,/augmentCommercial\(admin, device, primary, supportsItemSchedules/);
 assert.match(gateway,/VISION_COMMERCIAL_ENABLED/);
 assert.match(shared,/if \(!enabled\) return primary/);
 assert.match(shared,/if \(commercialEligibility\(primary\) \|\| !ads\?\.length\) return primary/);
 assert.match(settings,/enabled:false/);
 assert.match(settings,/supabaseUrl:''/);
});
