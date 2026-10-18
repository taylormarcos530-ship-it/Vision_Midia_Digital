'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const player=readFileSync('player.js','utf8');
const gateway=readFileSync('supabase/functions/device-gateway/index.ts','utf8');
const source=()=>import('../supabase/functions/_shared/commercial.mjs');
function extract(name) {
  const match=player.match(new RegExp('  function '+name+'\\([^]*?\\n  \\}'));
  assert.ok(match,name+' function must exist in actual Player');
  return match[0];
}
const context={};
vm.runInNewContext(extract('nextCommercialCycle')+';this.nextCommercialCycle=nextCommercialCycle',context);
const next=context.nextCommercialCycle;
const point=n=>({id:'base-'+n,media:{id:'point-'+n}});
test('live Player advances only after all eight items finish (6 point + 2 ads)',()=>{
 const base=Array.from({length:6},(_,i)=>point(i+1));
 const queue=[...base.slice(0,3),{id:'ad-1',commercial:true},...base.slice(3),{id:'ad-2',commercial:true}];
 assert.equal(next(queue,8,'all',0),1);
 assert.equal(next(queue,7,'all',0),null);
 assert.equal(next(queue,0,'all',0),null);
 assert.equal(next(base,6,'all',0),null);
 assert.equal(next(queue,8,'single',0),null);
 assert.equal(next(queue,8,'none',0),null);
 assert.equal(next(queue,8,'all',999999),0);
});
test('real commercial manifest rotates five ads fairly over five completed cycles',async()=>{
 const {augmentCommercial}=await source();
 const primary={playlist:{id:'fictional',shuffle:false,repeat_mode:'all'},
  items:Array.from({length:6},(_,i)=>point(i+1))};
 const ads=Array.from({length:5},(_,i)=>({id:'ad-'+i,name:'Ad '+i,storage_path:'advertisements/'+i,
  media_type:'image',duration_seconds:15,size_bytes:1,checksum:'hash'+i,width:1,height:1,
  start_date:'2026-10-01',end_date:'2026-12-31'}));
 const admin={rpc:async name=>({data:name==='vision_commercial_manifest'?ads:null,error:null}),
  storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'https://fixture.invalid/'+path})),error:null})})}};
 const originals=JSON.stringify(primary);
 const counts=Array(5).fill(0),rotations=[];
 for(let cycle=0;cycle<5;cycle++){
  const manifest=await augmentCommercial(admin,{id:'fictional-tv'},primary,true,true,'America/Sao_Paulo',cycle);
  assert.equal(manifest.items.length,8);
  assert.deepEqual(manifest.items.map(i=>i.commercial===true),
   [false,false,false,true,false,false,false,true]);
  const chosen=manifest.items.filter(i=>i.commercial).map(i=>Number(i.id.slice(3)));
  chosen.forEach(i=>counts[i]++);
  rotations.push(chosen);
 }
 assert.deepEqual(rotations,[[0,1],[2,3],[4,0],[1,2],[3,4]]);
 assert.deepEqual(counts,[2,2,2,2,2]);
 assert.equal(JSON.stringify(primary),originals,'establishment playlist immutable');
});
test('gateway permits ads only for capable players AND allowlisted TVs',()=>{
 assert.match(player,/supports_commercial_rounds: true/);
 assert.match(player,/commercial_cycle:/);
 assert.match(player,/await syncManifest\(\); \} catch \{ \/\* Continue cached base content offline/);
 assert.match(gateway,/commercialPilotDeviceAllowed\(device\.id,[^\n]+\) && body\?\.supports_commercial_rounds === true/);
 assert.match(gateway,/resolved\.program\?\.timezone, body\?\.commercial_cycle\)/);
 assert.match(player,/writeJson\(COMMERCIAL_CYCLE_KEY, null\);\s*state\.commercialCycle = 0/);
});
test('legacy gateway / unavailable feature causes no ad insertion',async()=>{
 const {augmentCommercial}=await source();
 const base={playlist:{id:'fictional',shuffle:false,repeat_mode:'all'},items:Array.from({length:6},(_,i)=>point(i+1))};
 let called=false;
 const admin={rpc:async()=>{called=true;throw new Error('unexpected commercial');}};
 assert.equal(await augmentCommercial(admin,{id:'fictional'},base,true,false,'America/Sao_Paulo',4),base);
 assert.equal(called,false);
});
