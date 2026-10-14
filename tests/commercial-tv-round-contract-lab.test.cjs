const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const load=()=>import('../commercial-tv-round-contract-lab.mjs');
const base=()=>({
 playlist:{id:'point-playlist',updated_at:'playlist-revision-1',shuffle:false,repeat_mode:'all'},
 items:[1,2,3,4,5,6].map(n=>({
  id:'base-item-'+n,media:{id:'base-media-'+n,checksum:'original-'+n,name:'Mídia '+n,type:'image'},
  duration_seconds:10,schedule:{enabled:false}
 }))
});
const ads=()=>[1,2,3,4,5].map(n=>({
 id:'revision-'+n,
 media:{id:'ad-media-'+n,checksum:'ad-revision-'+n,name:'Anunciante '+n,type:'image'},
 schedule:{enabled:true,start_date:'2026-10-01',end_date:'2026-11-30'},
 commercial:true
}));
const program=()=>({primary:base(),ads:ads(),deviceId:'fixture-TV-1',assignmentRevision:'device-assignment-1',
 inventoryRevision:'commercial-inventory-1',
 capabilities:{supportsItemSchedules:true,protocolVersion:1,timeZone:'America/Sao_Paulo'}});
function accepted(session,event,api){
 const result=api.applyRoundContract(session,event);
 assert.equal(result.accepted,true,result.reason);
 return result.contract;
}
function finish(session,api,count){
 let state=session;
 if(!state.model.running)state=accepted(state,{type:'start'},api);
 for(let i=0;i<count;i++)
  state=accepted(state,{type:'complete',lease:api.currentRoundLease(state)},api);
 return state;
}
test('program identity covers playlist assignment, item revisions, commercial inventory and capabilities',async()=>{
 const api=await load(),original=program(),before=structuredClone(original);
 const id=api.describeRoundProgram(original);
 assert.equal(id.valid,true);assert.equal(id.allowed,true);
 assert.deepEqual(id,api.describeRoundProgram(structuredClone(original)));
 for(const change of [
  p=>{p.deviceId='fixture-TV-2';},
  p=>{p.assignmentRevision='device-assignment-2';},
  p=>{p.primary.playlist.updated_at='playlist-revision-2';},
  p=>{p.primary.items[0].media.checksum='changed-file';},
  p=>{p.primary.items[2].duration_seconds=30;},
  p=>{p.primary.items[2].schedule.enabled=true;},
  p=>{p.ads[0].media.id='different-commercial-revision';},
  p=>{p.ads[0].media.checksum='new-creative';},
  p=>{p.ads[0].schedule.end_date='2026-12-31';},
  p=>{p.inventoryRevision='other-inventory';},
  p=>{p.capabilities.protocolVersion=0;}
 ]){
  const modified=structuredClone(original);change(modified);
  assert.notEqual(api.describeRoundProgram(modified).key,id.key);
 }
 assert.deepEqual(original,before);
});
test('valid completion lease represents one occurrence and never counts duplicate completion',async()=>{
 const api=await load();let session=api.createRoundContract(program());
 assert.equal(session.identity.allowed,true);
 assert.equal(session.model.items.length,8);
 const lease=api.currentRoundLease(session);
 session=accepted(session,{type:'start'},api);
 session=accepted(session,{type:'complete',lease},api);
 assert.equal(session.model.completedBase,1);
 assert.equal(session.model.completedAds,0);
 const repeat=api.applyRoundContract(session,{type:'complete',lease});
 assert.equal(repeat.accepted,false);
 assert.equal(repeat.contract,session);
 assert.equal(session.model.completed,1);
});
test('unchanged revision handoff preserves round and media, pauses and invalidates stale callbacks',async()=>{
 const api=await load(),p=program();
 let session=finish(api.createRoundContract(p),api,3);
 assert.equal(session.model.items[session.model.position].id,'revision-1');
 const before=api.currentRoundLease(session),snapshot=api.exportRoundCheckpoint(session);
 const result=api.restoreRoundCheckpoint(structuredClone(p),snapshot);
 assert.equal(result.accepted,true,result.reason);
 const resumed=result.contract;
 assert.equal(resumed.model.position,3);
 assert.equal(resumed.model.cycle,0);
 assert.equal(resumed.model.completedBase,3);
 assert.equal(resumed.model.running,false);
 assert.notEqual(api.currentRoundLease(resumed),before);
 assert.equal(api.applyRoundContract(resumed,{type:'complete',lease:before}).accepted,false);
 const running=accepted(resumed,{type:'start'},api);
 const done=accepted(running,{type:'complete',lease:api.currentRoundLease(running)},api);
 assert.equal(done.model.completedAds,1);
 assert.equal(done.model.completedBase,3);
});
test('checkpoint from another fictional TV cannot resume ads even with identical playlist',async()=>{
 const api=await load(),source=program();
 const saved=api.exportRoundCheckpoint(finish(api.createRoundContract(source),api,3));
 const other=structuredClone(source);other.deviceId='fixture-TV-2';
 const result=api.restoreRoundCheckpoint(other,saved);
 assert.equal(result.accepted,false);
 assert.equal(result.reason,'base_program_changed');
 assert.equal(result.contract.model.position,0);
 assert.deepEqual(result.contract.model.items,other.primary.items);
 assert.equal(result.contract.model.items.some(item=>item.commercial),false);
 assert.equal(api.applyRoundContract(result.contract,{type:'complete',
  lease:api.currentRoundLease(api.createRoundContract(source))}).accepted,false);
});
test('simulated restart rejects old lease and requires fresh start',async()=>{
 const api=await load();
 let s=finish(api.createRoundContract(program()),api,3);
 const lease=api.currentRoundLease(s);
 s=accepted(s,{type:'restart'},api);
 assert.equal(s.model.running,false);
 assert.notEqual(api.currentRoundLease(s),lease);
 assert.equal(api.applyRoundContract(s,{type:'complete',lease}).accepted,false);
 s=accepted(s,{type:'start'},api);
 s=accepted(s,{type:'complete',lease:api.currentRoundLease(s)},api);
 assert.equal(s.model.completedAds,1);
});
test('commercial revision changed during interruption blocks ads while preserving next base media',async()=>{
 const api=await load(),current=program();
 const session=finish(api.createRoundContract(current),api,3);
 const oldLease=api.currentRoundLease(session);
 const snapshot=api.exportRoundCheckpoint(session);
 const updated=structuredClone(current);
 updated.ads[0].media.id='new-fictitious-creative-revision';
 updated.inventoryRevision='inventory-2';
 const result=api.restoreRoundCheckpoint(updated,snapshot);
 assert.equal(result.accepted,false);
 assert.equal(result.reason,'commercial_or_capability_changed');
 const c=result.contract;
 assert.equal(c.status,'base_only_commercial_or_capability_changed');
 assert.equal(c.model.position,3);
 assert.equal(c.model.items.length,6);
 assert.equal(c.model.items[3].id,'base-item-4');
 assert.equal(c.model.items.some(x=>x.commercial),false);
 assert.equal(api.applyRoundContract(c,{type:'complete',lease:oldLease}).accepted,false);
 assert.equal(c.model.completedAds,0);
 const restarted=finish(c,api,1);
 assert.equal(restarted.model.position,4);
});
test('reordered or removed commercial revisions invalidate prior round without base mutation',async()=>{
 const api=await load(),p=program();
 const snapshot=api.exportRoundCheckpoint(finish(api.createRoundContract(p),api,3));
 for(const modification of [
  x=>{x.ads=x.ads.slice(0,2);x.inventoryRevision='v2';},
  x=>{x.ads.reverse();x.inventoryRevision='v2';},
  x=>{x.ads[1].schedule.end_date='2026-12-01';}
 ]){
  const q=structuredClone(p);modification(q);
  const result=api.restoreRoundCheckpoint(q,snapshot);
  assert.equal(result.accepted,false);
  assert.equal(result.contract.model.items.filter(x=>x.commercial).length,0);
  assert.deepEqual(result.contract.model.items,q.primary.items);
  assert.equal(result.contract.model.position,3);
 }
});
test('revised establishment playlist must restart in safe base-only mode, never restore stale position',async()=>{
 const api=await load(),p=program();
 const saved=api.exportRoundCheckpoint(finish(api.createRoundContract(p),api,5));
 const updated=structuredClone(p);
 updated.primary.items[2].media.id='replacement-from-owner';
 updated.primary.playlist.updated_at='playlist-new';
 const result=api.restoreRoundCheckpoint(updated,saved);
 assert.equal(result.accepted,false);
 assert.equal(result.reason,'base_program_changed');
 assert.equal(result.contract.model.position,0);
 assert.equal(result.contract.model.items.length,6);
 assert.deepEqual(result.contract.model.items,updated.primary.items);
 assert.equal(result.contract.model.completedAds,0);
});
test('legacy/incompatible players never receive commercial additions',async()=>{
 const api=await load();
 for(const capabilities of [
  {supportsItemSchedules:false,protocolVersion:1,timeZone:'America/Sao_Paulo'},
  {supportsItemSchedules:true,protocolVersion:0,timeZone:'America/Sao_Paulo'},
  {supportsItemSchedules:true,protocolVersion:1,timeZone:'America/Manaus'}
 ]){
  const p=program();p.capabilities=capabilities;
  const contract=api.createRoundContract(p);
  assert.equal(contract.identity.reason,'legacy_or_incompatible_player');
  assert.equal(contract.model.items.length,6);
  assert.equal(contract.model.items.filter(x=>x.commercial).length,0);
  assert.equal(api.currentRoundLease(contract)!==null,true);
 }
});
test('TV waiting for playlist stays empty, and protected modes keep base media only',async()=>{
 const api=await load();
 const empty=program();empty.primary=null;
 const c=api.createRoundContract(empty);
 assert.equal(c.identity.reason,'no_base_playlist');
 assert.equal(c.model.items.length,0);
 assert.equal(api.currentRoundLease(c),null);
 assert.equal(api.applyRoundContract(c,{type:'start'}).accepted,false);
 for(const edit of [
  p=>{p.primary.playlist.shuffle=true;},
  p=>{p.primary.playlist.repeat_mode='single';},
  p=>{p.primary.items[1].schedule.enabled=true;}
 ]){
  const p=program();edit(p);
  const session=api.createRoundContract(p);
  assert.equal(session.model.items.length,6);
  assert.equal(session.model.items.filter(x=>x.commercial).length,0);
 }
});
test('invalid checkpoint and duplicate media item IDs fail closed',async()=>{
 const api=await load(),p=program();
 const healthy=api.createRoundContract(p);
 const cp=api.exportRoundCheckpoint(healthy);
 for(const modify of [
  c=>{c.version=999;},
  c=>{c.model.position=999;},
  c=>{c.model.completedAds=3;},
  c=>{c.model.inventory[0].id='wrong-revision';},
  c=>{c.epoch=-1;},
  c=>{c.model.items[0].media.id='modified-customer-media';}
 ]){
  const x=structuredClone(cp);modify(x);
  const result=api.restoreRoundCheckpoint(p,x);
  assert.equal(result.accepted,false);
  assert.equal(result.contract.model.items.some(item=>item.commercial),false);
 }
 const invalid=program();invalid.primary.items[1].id=invalid.primary.items[0].id;
 assert.equal(api.describeRoundProgram(invalid).valid,false);
 assert.equal(api.createRoundContract(invalid).model.items.length,0);
 const invalidCommercial=program();
 invalidCommercial.ads[1].id=invalidCommercial.ads[0].id;
 assert.equal(api.describeRoundProgram(invalidCommercial).valid,false);
 const commercialFallback=api.createRoundContract(invalidCommercial);
 assert.deepEqual(commercialFallback.model.items,invalidCommercial.primary.items);
 assert.equal(commercialFallback.model.items.filter(item=>item.commercial).length,0);
});
test('callback cannot issue arbitrary inventory updates or revalidate from a player event',async()=>{
 const api=await load();let s=api.createRoundContract(program());
 for(const action of ['inventory-changed','configure','revalidate']){
  const result=api.applyRoundContract(s,{type:action,ads:[]});
  assert.equal(result.accepted,false);
  assert.equal(result.contract,s);
 }
 s=accepted(s,{type:'start'},api);
 assert.equal(api.applyRoundContract(s,{type:'media-error',lease:'wrong'}).accepted,false);
});
test('round contract is strictly offline and not imported by production gateway or client player',()=>{
 const src=readFileSync('commercial-tv-round-contract-lab.mjs','utf8');
 const gateway=readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 const player=readFileSync('player.js','utf8');
 assert.match(src,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(src,/\bfetch\s*\(|createClient\s*\(|\.supabase\.co|sb_secret_|service_role|localStorage|sessionStorage|https?:\/\//);
 assert.doesNotMatch(gateway,/commercial-tv-round-contract-lab/);
 assert.doesNotMatch(player,/commercial-tv-round-contract-lab/);
});
