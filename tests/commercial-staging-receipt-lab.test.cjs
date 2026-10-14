const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const apiPromise=import('../commercial-staging-receipt-lab.mjs');
const START=Date.parse('2026-10-14T14:00:00Z');
const program=()=>({
 companyId:'company-fixture-1',deviceId:'tv-fixture-1',
 assignmentRevision:'assigned-v1',playlistId:'playlist-fixture-1',playlistRevision:'playlist-v1',
 base:[1,2,3,4,5,6].map(i=>({itemId:'owner-'+i,mediaId:'owner-media-'+i,revision:'media-rev-'+i})),
 inventoryRevision:'ads-revision-1',
 ads:[1,2,3,4,5].map(i=>({campaignId:'campaign-'+i,revisionId:'revision-'+i,
  mediaId:'ad-media-'+i,status:'active',targeted:true})),
 capabilities:{protocolVersion:2,supportsItemSchedules:true,timeZone:'America/Sao_Paulo'},
 shuffle:false,repeatMode:'all',hasItemSchedule:false
});
const started=(programDevice='tv-fixture-1')=>({authenticatedDeviceId:programDevice,nowMs:START,ttlMs:120000,revisionId:'revision-1'});
const endEvent=(occurrence,clientId='event-1',completed=true)=>({
 client_event_id:clientId,occurrence_id:occurrence.occurrenceId,
 media_revision_id:occurrence.revisionId,completed,ended_at:new Date(START+30000).toISOString()
});
function issued(api,s,p=started()){
 const r=api.issueStagingOccurrence(s,p);assert.equal(r.accepted,true,r.reason);
 return r;
}
const receive=(api,s,event,when=START+30000,device='tv-fixture-1')=>
 api.receiveStagingReceipt(s,{authenticatedDeviceId:device,serverNowMs:when},event);

test('trusted server program gates legacy, playlist-less, shuffle and schedule modes',async()=>{
 const api=await apiPromise;
 for(const edit of [
  p=>{p.base=null;p.playlistId=null;p.playlistRevision=null;},
  p=>{p.base=[];},
  p=>{p.shuffle=true;},
  p=>{p.repeatMode='single';},
  p=>{p.hasItemSchedule=true;},
  p=>{p.capabilities.protocolVersion=1;},
  p=>{p.capabilities.supportsItemSchedules=false;},
  p=>{p.capabilities.timeZone='America/Manaus';}
 ]){
  const p=program();edit(p);
  const server=api.createStagingReceiptLab(p);
  assert.equal(server.description.enabled,false);
  assert.equal(api.issueStagingOccurrence(server,started()).accepted,false);
  assert.deepEqual(server.accepted,[]);
 }
});
test('advertiser must be a current active target; no owner media may receive an ad lease',async()=>{
 const api=await apiPromise;const p=program();
 p.ads[0].status='paused';p.ads[1].targeted=false;
 const server=api.createStagingReceiptLab(p);
 for(const revisionId of ['revision-1','revision-2','owner-media-1','not-existing'])
  assert.equal(api.issueStagingOccurrence(server,{...started(),revisionId}).accepted,false);
 assert.equal(issued(api,server,{...started(),revisionId:'revision-3'}).occurrence.revisionId,'revision-3');
});
test('server-side issued occurrence and device binding are mandatory for one completed claim',async()=>{
 const api=await apiPromise;const p=program(),snapshot=structuredClone(p);
 let server=api.createStagingReceiptLab(p);
 assert.equal(api.issueStagingOccurrence(server,{...started(),authenticatedDeviceId:'other-TV'}).reason,'wrong_authenticated_device');
 const a=issued(api,server);server=a.state;
 const event=endEvent(a.occurrence);
 assert.equal(receive(api,server,event,START+30000,'other-TV').accepted,false);
 assert.equal(receive(api,server,{...event,media_revision_id:'revision-2'}).accepted,false);
 assert.equal(receive(api,server,{...event,occurrence_id:'fixture:missing:999'}).accepted,false);
 const accepted=receive(api,server,event);assert.equal(accepted.accepted,true);
 assert.equal(accepted.reason,'completion_claim_recorded');
 assert.equal(accepted.state.accepted.length,1);
 assert.deepEqual(p,snapshot);
});
test('same event retry is idempotent, conflicting event ID and second completion per occurrence are rejected',async()=>{
 const api=await apiPromise;let s=api.createStagingReceiptLab(program());
 const a=issued(api,s);s=a.state;
 const event=endEvent(a.occurrence);
 s=receive(api,s,event).state;
 const first=api.recalculateStagingDaily(s);
 const retry=receive(api,s,structuredClone(event),START+61000);
 assert.equal(retry.accepted,true);assert.equal(retry.reason,'duplicate_event');
 assert.equal(retry.duplicate,true);assert.equal(retry.state,s);
 assert.equal(receive(api,s,{...event,completed:false}).reason,'client_event_id_collision');
 assert.equal(receive(api,s,{...event,client_event_id:'event-different'}).reason,'occurrence_already_finalized');
 assert.deepEqual(api.recalculateStagingDaily(s),first);
 assert.equal(first[0].attempt_count,1);assert.equal(first[0].completed_count,1);
});
test('incomplete final report is an attempt, not a completed commercial impression',async()=>{
 const api=await apiPromise;let s=api.createStagingReceiptLab(program());
 const a=issued(api,s);s=a.state;
 const report=endEvent(a.occurrence,'event-incomplete',false);
 s=receive(api,s,report).state;
 const totals=api.recalculateStagingDaily(s);
 assert.equal(totals[0].attempt_count,1);assert.equal(totals[0].completed_count,0);
 const falselyCompleted={...report,client_event_id:'event-swap',completed:true};
 assert.equal(receive(api,s,falselyCompleted).reason,'occurrence_already_finalized');
});
test('late first submission is rejected but previously accepted retry after expiry stays duplicate',async()=>{
 const api=await apiPromise;let s=api.createStagingReceiptLab(program());
 const a=issued(api,s,{...started(),ttlMs:30000});s=a.state;
 const event={...endEvent(a.occurrence),ended_at:new Date(START+20000).toISOString()};
 assert.equal(receive(api,s,event,START+40000).reason,'expired_or_not_yet_issued');
 s=receive(api,s,event,START+20000).state;
 assert.equal(receive(api,s,event,START+40000).reason,'duplicate_event');
 assert.equal(api.recalculateStagingDaily(s)[0].completed_count,1);
});
test('client timestamp cannot be before issue, beyond server clock, beyond expiry or malformed',async()=>{
 const api=await apiPromise;const a=issued(api,api.createStagingReceiptLab(program()));
 const s=a.state;
 for(const ended_at of ['fake-time',new Date(START-1000).toISOString(),
   new Date(START+90000).toISOString(),new Date(START+180000).toISOString()]){
  const x=receive(api,s,{...endEvent(a.occurrence),ended_at},START+30000);
  assert.equal(x.accepted,false);
  assert.equal(x.state,s);
 }
});
test('republish revokes all unused old occurrences after campaign removal and old playlist assignment',async()=>{
 const api=await apiPromise;
 for(const edit of [p=>{p.ads[0].status='paused';p.inventoryRevision='ads-revision-2';},
  p=>{p.assignmentRevision='assigned-v2';},
  p=>{p.base[0].revision='owner-media-new';p.playlistRevision='playlist-v2';}]){
  let s=api.createStagingReceiptLab(program());
  const a=issued(api,s);s=a.state;
  const p=program();edit(p);
  const published=api.republishStagingProgram(s,p);
  assert.equal(published.accepted,true);s=published.state;
  const late=receive(api,s,endEvent(a.occurrence));
  assert.equal(late.reason,'program_superseded');
  assert.equal(late.state.accepted.length,0);
 }
});
test('idempotent previously accepted event stays counted once across same-device republish',async()=>{
 const api=await apiPromise;
 let s=api.createStagingReceiptLab(program());
 const issue=issued(api,s);s=issue.state;
 const event=endEvent(issue.occurrence);
 s=receive(api,s,event).state;
 const p=program();p.inventoryRevision='v2';p.ads[0].status='paused';
 s=api.republishStagingProgram(s,p).state;
 const duplicate=receive(api,s,event,START+300000);
 assert.equal(duplicate.reason,'duplicate_event');
 assert.equal(api.recalculateStagingDaily(duplicate.state)[0].completed_count,1);
});
test('two devices, independent ledgers and cross-device collision do not contaminate totals',async()=>{
 const api=await apiPromise;
 const first=api.createStagingReceiptLab(program());
 const otherProgram=program();otherProgram.deviceId='tv-fixture-2';
 const second=api.createStagingReceiptLab(otherProgram);
 const x=issued(api,first),y=issued(api,second,{...started(),authenticatedDeviceId:'tv-fixture-2'});
 assert.equal(receive(api,x.state,endEvent(y.occurrence,'event-cross')).accepted,false);
 assert.equal(receive(api,y.state,endEvent(x.occurrence,'event-cross'),START+30000,'tv-fixture-2').accepted,false);
 const yesX=receive(api,x.state,endEvent(x.occurrence));
 const yesY=receive(api,y.state,endEvent(y.occurrence),START+30000,'tv-fixture-2');
 assert.equal(yesX.accepted,true);assert.equal(yesY.accepted,true);
 assert.equal(api.recalculateStagingDaily(yesX.state)[0].deviceId,'tv-fixture-1');
 assert.equal(api.recalculateStagingDaily(yesY.state)[0].deviceId,'tv-fixture-2');
});
test('batch replays and mixed invalid receipts are isolated without duplicate rollup',async()=>{
 const api=await apiPromise;
 let s=api.createStagingReceiptLab(program());
 const a=issued(api,s);s=a.state;
 const b=issued(api,s,{...started(),revisionId:'revision-2'});s=b.state;
 const good=endEvent(a.occurrence,'a');const bad={...endEvent(b.occurrence,'b'),media_revision_id:'wrong'};
 const batch=api.receiveStagingBatch(s,{authenticatedDeviceId:'tv-fixture-1',serverNowMs:START+30000},
  [good,good,bad,endEvent(b.occurrence,'b')]);
 assert.deepEqual(batch.results.map(x=>x.reason),[
  'completion_claim_recorded','duplicate_event','unissued_or_wrong_revision','completion_claim_recorded']);
 assert.equal(batch.state.accepted.length,2);
 assert.equal(api.recalculateStagingDaily(batch.state).reduce((n,r)=>n+r.completed_count,0),2);
 assert.equal(api.receiveStagingBatch(s,{authenticatedDeviceId:'tv-fixture-1',serverNowMs:START},[]).accepted,false);
 assert.equal(api.receiveStagingBatch(s,{authenticatedDeviceId:'tv-fixture-1',serverNowMs:START},Array(101).fill(good)).accepted,false);
});
test('daily reconciliation derives counts from accepted ledger and server receipt day',async()=>{
 const api=await apiPromise;let s=api.createStagingReceiptLab(program());
 const a=issued(api,s,{...started(),nowMs:Date.parse('2026-10-14T23:57:00-03:00'),ttlMs:300000});
 s=a.state;
 const t=Date.parse('2026-10-15T00:00:00-03:00');
 s=receive(api,s,{...endEvent(a.occurrence,'after-midnight'),ended_at:new Date(t).toISOString()},t).state;
 assert.deepEqual(api.recalculateStagingDaily(s).map(x=>x.day),['2026-10-15']);
 assert.deepEqual(api.recalculateStagingDaily(s),api.recalculateStagingDaily(s));
});
test('invalid ID, invalid program, excessive TTL and no target fail closed',async()=>{
 const api=await apiPromise;for(const edit of [
  p=>{p.ads[0].revisionId=p.ads[1].revisionId;},
  p=>{p.base[0].itemId=p.base[1].itemId;},
  p=>{p.deviceId='';},
  p=>{p.ads[0].status='deactivated';}
 ]){
  const p=program();edit(p);const s=api.createStagingReceiptLab(p);
  assert.equal(s.description.valid,false);
  assert.equal(api.issueStagingOccurrence(s,started()).accepted,false);
 }
 const s=api.createStagingReceiptLab(program());
 assert.equal(api.issueStagingOccurrence(s,{...started(),ttlMs:300001}).accepted,false);
 assert.equal(api.issueStagingOccurrence(s,{...started(),nowMs:-1}).accepted,false);
 assert.equal(api.republishStagingProgram(s,{...program(),ads:null}).accepted,false);
});
test('only new offline module introduced; existing gateway, playback_logs and client stay unmodified',()=>{
 const source=readFileSync('commercial-staging-receipt-lab.mjs','utf8');
 const gateway=readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 const player=readFileSync('player.js','utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(source,/\bfetch\s*\(|createClient\s*\(|\.supabase\.co|sb_secret_|localStorage|sessionStorage|https?:\/\//);
 assert.doesNotMatch(gateway,/commercial-staging-receipt-lab/);
 assert.doesNotMatch(player,/commercial-staging-receipt-lab/);
 assert.match(gateway,/upsert\(labeledRows, \{ onConflict: 'device_id,client_event_id', ignoreDuplicates: true \}\)/);
});
