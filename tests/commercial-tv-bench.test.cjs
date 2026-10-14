const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const real=()=>import('../supabase/functions/_shared/commercial.mjs');
const bench=()=>import('../commercial-tv-bench.mjs');

test('bench TV includes 2 commercials between six real-order base media',async()=>{
 const {simulateBench}=await bench();
 const r=simulateBench();
 assert.deepEqual(r.items.map(x=>x.id),[
  'base-1','base-2','base-3','commercial-1',
  'base-4','base-5','base-6','commercial-2'
 ]);
 assert.equal(r.included,2);assert.equal(r.ignored,0);assert.equal(r.preserved,true);
 assert.equal(r.original.items.length,6);assert.equal(r.ads.length,2);
});

test('extra commercial ads never form a consecutive ad block or replace customer media',async()=>{
 const {simulateBench}=await bench();
 for(const baseCount of [1,3,6]){
  const r=simulateBench({baseCount,adCount:5});
  assert.equal(r.original.items.length,baseCount);
  assert.equal(r.items.filter(x=>!x.commercial).length,baseCount);
  assert.equal(r.included+r.ignored,5);
  assert.ok(r.included<=baseCount);
  assert.deepEqual(r.items.filter(x=>!x.commercial).map(x=>x.id),r.original.items.map(x=>x.id));
  for(let i=1;i<r.items.length;i++)
   assert.ok(!(r.items[i].commercial&&r.items[i-1].commercial),'never play back-to-back ads');
 }
 const many=simulateBench({baseCount:6,adCount:5});
 assert.deepEqual(many.items.map(x=>x.id),['base-1','base-2','base-3','commercial-1','base-4','base-5','base-6','commercial-2']);
 assert.equal(many.ignored,3,'surplus is explicitly reported instead of silently appended');
});
test('short assigned playlists keep base content and allow at most one ad insertion',async()=>{
 const {simulateBench}=await bench();
 const r=simulateBench({baseCount:1,adCount:5});
 assert.deepEqual(r.items.map(x=>x.id),['base-1','commercial-1']);
 assert.equal(r.ignored,4);
});
test('no assigned playlist stays Aguardando playlist even when commercial ads exist',async()=>{
 const {simulateBench}=await bench();
 const r=simulateBench({baseCount:0,adCount:5});
 assert.equal(r.original,null);
 assert.deepEqual(r.items,[]);
 assert.equal(r.reason,'no_base_playlist');
 assert.equal(r.status,'Aguardando playlist');
 assert.equal(r.included,0);
});
test('playlists with shuffle, single repeat and per-media schedules are never augmented',async()=>{
 const {simulateBench}=await bench();
 for(const options of [{shuffle:true},{single:true},{scheduled:true},{enabled:false}]){
  const r=simulateBench({...options,adCount:5});
  assert.equal(r.included,0);
  assert.deepEqual(r.items.map(x=>x.id),r.original.items.map(x=>x.id));
  assert.ok(r.reason);
 }
});
test('original base playlist is untouched even if caller passes too many ads',async()=>{
 const {makeBenchPrimary,makeBenchAds}=await bench();
 const {interleave}=await real();
 const orig=makeBenchPrimary({baseCount:6});
 const before=JSON.stringify(orig);
 const inputAds=makeBenchAds(5),beforeAds=JSON.stringify(inputAds);
 const result=interleave(orig,inputAds,3);
 assert.equal(JSON.stringify(orig),before);
 assert.equal(JSON.stringify(inputAds),beforeAds);
 assert.equal(result.playlist,orig.playlist);
 orig.items.forEach((x,i)=>assert.equal(result.items.filter(row=>!row.commercial)[i],x));
});
test('real optional gateway helper signs ad media and interleaves without base mutations',async()=>{
 const {augmentCommercial}=await real(),{makeBenchPrimary}=await bench();
 const primary=makeBenchPrimary({baseCount:6});
 const ads=Array.from({length:5},(_,i)=>({
  id:'revision-'+i,campaign_id:'campaign-'+i,storage_path:'commercial-ads/mock-'+i+'.webp',
  duration_seconds:10,name:'Anunciante '+(i+1),media_type:'image',size_bytes:200,
  checksum:'test-hash-'+i,width:1920,height:1080,start_date:'2026-10-01',end_date:'2026-11-30'
 }));
 const requested=[],calls=[];
 const admin={
  rpc:async(name,params)=>{
   calls.push({name,params});
   if(name==='vision_commercial_manifest')return {data:ads,error:null};
   if(name==='vision_commercial_delivery')return {data:null,error:null};
   throw Error('unexpected remote action '+name);
  },
  storage:{from(bucket){
   assert.equal(bucket,'vision-media');
   return {createSignedUrls:async(paths,seconds)=>{
    requested.push({paths,seconds});
    return {data:paths.map(path=>({path,signedUrl:'/object/sign/vision-media/'+path+'?token=fictional'})),error:null};
   }};
  }}
 };
 const before=JSON.stringify(primary);
 const out=await augmentCommercial(admin,{id:'test-tv-do-not-connect'},primary,true,true);
 assert.equal(out.items.length,8);
 assert.deepEqual(out.items.filter(x=>x.id.startsWith('base-')),primary.items);
 assert.deepEqual(out.items.filter(x=>x.id.startsWith('revision-')).map(x=>x.id),['revision-0','revision-1']);
 assert.equal(JSON.stringify(primary),before);
 assert.equal(requested.length,1);assert.equal(requested[0].paths.length,5);
 assert.deepEqual(calls.map(x=>x.name),['vision_commercial_manifest','vision_commercial_delivery']);
 assert.equal(out.items[3].schedule.enabled,true);
 assert.equal(out.items[3].media.type,'image');
});
test('offline preview contains no Supabase keys, real TV identity, playback or API calls',()=>{
 const html=fs.readFileSync('commercial-tv-bench.html','utf8');
 const js=fs.readFileSync('commercial-tv-bench.mjs','utf8');
 assert.match(html,/SIMULAÇÃO OFFLINE/);
 assert.match(html,/commercial-tv-bench\.mjs/);
 assert.match(js,/supabase\/functions\/_shared\/commercial\.mjs/);
 assert.match(js,/Aguardando playlist/);
 assert.doesNotMatch(js,/fetch\(|createClient\(|new CommercialAPI|localStorage|sessionStorage|\/auth\/v1|supabase\.co/);
 assert.doesNotMatch(html,/src="\.\/commercial-staging-config\.js"|src="\.\/commercial-config\.js"/);
 assert.doesNotMatch(html,/autoplay|\/player\.js|\/device-gateway/);
 assert.doesNotMatch(js,/fpadgedrgcxrrqflzhjt|jmiuitrrhtaeyrpuyohk|sb_publishable_/);
});
