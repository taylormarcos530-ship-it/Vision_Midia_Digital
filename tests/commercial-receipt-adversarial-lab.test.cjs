// Adversarial OFFLINE fixtures. No database, credential, edge function or deployment.
// The asynchronous queue below models a desired atomic transaction; it is not a
// proof that any production PostgreSQL transaction or network exists.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=()=>import('../commercial-staging-receipt-lab.mjs');

const T=Date.parse('2026-10-14T17:00:00Z');
const program=(device='tv-fixture-1')=>({
 companyId:'company-fixture-1',deviceId:device,
 assignmentRevision:'assignment-v1',playlistId:'playlist-v1',playlistRevision:'base-v1',
 base:[1,2,3,4,5,6].map(n=>({itemId:'owner-item-'+n,mediaId:'owner-media-'+n,revision:'base-revision-'+n})),
 inventoryRevision:'inventory-v1',
 ads:[1,2,3].map(n=>({campaignId:'advertiser-'+n,revisionId:'ad-revision-'+n,
  mediaId:'ad-media-'+n,status:'active',targeted:true})),
 capabilities:{protocolVersion:2,supportsItemSchedules:true,timeZone:'America/Sao_Paulo'},
 shuffle:false,repeatMode:'all',hasItemSchedule:false
});
const ctx=(now=T+15000,device='tv-fixture-1')=>({
 authenticatedDeviceId:device,serverNowMs:now
});
function lease(api,state,n=1,now=T,ttlMs=120000){
 const result=api.issueStagingOccurrence(state,{
  authenticatedDeviceId:state.program.deviceId,revisionId:'ad-revision-'+n,
  nowMs:now,ttlMs
 });
 assert.equal(result.accepted,true,result.reason);
 return {state:result.state,occurrence:result.occurrence};
}
function report(occ,clientEventId,completed=true,time=T+12000){
 return {client_event_id:clientEventId,occurrence_id:occ.occurrenceId,
  media_revision_id:occ.revisionId,completed,
  ended_at:new Date(time).toISOString()};
}
const counts=(api,state)=>api.recalculateStagingDaily(state).reduce(
 (a,x)=>({attempts:a.attempts+x.attempt_count,completed:a.completed+x.completed_count}),
 {attempts:0,completed:0}
);
// A deterministic in-memory serial commit queue, representing an atomic database
// boundary only in the fixture. The real system still needs DB constraints + tx.
function referenceTransactionQueue(api,initial){
 let current=initial;
 let tail=Promise.resolve();
 function serialize(operation){
  const work=tail.then(()=>operation());
  tail=work.then(()=>undefined,()=>undefined);
  return work;
 }
 return {
  receive(context,receipt){return serialize(()=>{
   const out=api.receiveStagingReceipt(current,context,receipt);
   current=out.state;return out;
  });},
  publish(next){return serialize(()=>{
   const out=api.republishStagingProgram(current,next);
   current=out.state;return out;
  });},
  snapshot(){return current;}
 };
}
function lcg(seed){
 let v=seed>>>0;
 return ()=>((v=(Math.imul(1664525,v)+1013904223)>>>0)/4294967296);
}
function shuffleDeterministic(array,seed){
 const a=array.slice(),random=lcg(seed);
 for(let i=a.length-1;i>0;i--){
  const j=Math.floor(random()*(i+1));
  [a[i],a[j]]=[a[j],a[i]];
 }
 return a;
}
test('100 duplicate deliveries across many reordered batches count as one completion',async()=>{
 const api=await load();let {state,occurrence}=lease(api,api.createStagingReceiptLab(program()));
 const entry=report(occurrence,'same-event');
 const attempts=Array.from({length:100},()=>({...entry}));
 for(const seed of [1,7,42,2026]){
  const input=shuffleDeterministic(attempts,seed);
  const out=api.receiveStagingBatch(state,ctx(),input);
  assert.equal(out.accepted,true);
  assert.equal(out.results.filter(x=>x.reason==='completion_claim_recorded').length,1);
  assert.equal(out.results.filter(x=>x.reason==='duplicate_event').length,99);
  assert.deepEqual(counts(api,out.state),{attempts:1,completed:1});
  assert.equal(state.accepted.length,0,'independent starting snapshot not mutated');
 }
});
test('batched false event followed by false retry and fraudulent true cannot upgrade attempt',async()=>{
 const api=await load();let {state,occurrence}=lease(api,api.createStagingReceiptLab(program()));
 const failed=report(occurrence,'first-attempt',false);
 const spoofed={...report(occurrence,'second-attempt',true)};
 const out=api.receiveStagingBatch(state,ctx(),[failed,spoofed,failed]);
 assert.deepEqual(out.results.map(x=>x.reason),[
  'incomplete_attempt_recorded','occurrence_already_finalized','duplicate_event']);
 assert.deepEqual(counts(api,out.state),{attempts:1,completed:0});
});
test('different event IDs for same occurrence can never increase completion count twice',async()=>{
 const api=await load();let {state,occurrence}=lease(api,api.createStagingReceiptLab(program()));
 const result=api.receiveStagingBatch(state,ctx(),
  Array.from({length:100},(_,i)=>report(occurrence,'unique-client-event-'+i)));
 assert.equal(result.results.filter(x=>x.accepted).length,1);
 assert.equal(result.results.filter(x=>x.reason==='occurrence_already_finalized').length,99);
 assert.deepEqual(counts(api,result.state),{attempts:1,completed:1});
});
test('bounded randomized event replay yields exactly one accepted record per issued occurrence',async()=>{
 const api=await load();
 for(const seed of [17,23,43,73,20261014]){
  let state=api.createStagingReceiptLab(program()),issued=[];
  for(let n=0;n<18;n++){
   const result=lease(api,state,n%3+1);
   state=result.state;issued.push(result.occurrence);
  }
  const valid=issued.map((x,i)=>report(x,'event-'+i));
  const replay=valid.flatMap(x=>[x,{...x}]);
  const collision=valid.map((x,i)=>({...x,client_event_id:'invalid-occurrence-'+i,
   media_revision_id:'wrong-media-revision'}));
  const out=api.receiveStagingBatch(state,ctx(),
   shuffleDeterministic([...replay,...collision],seed));
  assert.equal(out.results.filter(x=>x.reason==='completion_claim_recorded').length,18);
  assert.deepEqual(counts(api,out.state),{attempts:18,completed:18});
  const uniqueClient=new Set(out.state.accepted.map(x=>x.clientEventId));
  const uniqueOccurrence=new Set(out.state.accepted.map(x=>x.occurrenceId));
  assert.equal(uniqueClient.size,18);assert.equal(uniqueOccurrence.size,18);
 }
});
test('parallel identical retry submissions through reference commit queue remain one row',async()=>{
 const api=await load();const {state,occurrence}=lease(api,api.createStagingReceiptLab(program()));
 const txn=referenceTransactionQueue(api,state),event=report(occurrence,'parallel-same');
 const outcomes=await Promise.all(Array.from({length:32},()=>txn.receive(ctx(),{...event})));
 assert.equal(outcomes.filter(x=>x.reason==='completion_claim_recorded').length,1);
 assert.equal(outcomes.filter(x=>x.reason==='duplicate_event').length,31);
 assert.deepEqual(counts(api,txn.snapshot()),{attempts:1,completed:1});
});
test('parallel conflicting event IDs for one occurrence accept just one transaction',async()=>{
 const api=await load();const {state,occurrence}=lease(api,api.createStagingReceiptLab(program()));
 const txn=referenceTransactionQueue(api,state);
 const outcomes=await Promise.all(Array.from({length:32},(_,i)=>
  txn.receive(ctx(),report(occurrence,'concurrent-'+i))));
 assert.equal(outcomes.filter(x=>x.reason==='completion_claim_recorded').length,1);
 assert.equal(outcomes.filter(x=>x.reason==='occurrence_already_finalized').length,31);
 assert.deepEqual(counts(api,txn.snapshot()),{attempts:1,completed:1});
});
test('queued publication before a receipt revokes old pending event without touching owner media',async()=>{
 const api=await load(),p=program();const {state,occurrence}=lease(api,api.createStagingReceiptLab(p));
 const txn=referenceTransactionQueue(api,state);
 const updated=structuredClone(p);updated.ads[0].status='paused';updated.inventoryRevision='inventory-v2';
 const [publish,late]=await Promise.all([
  txn.publish(updated),txn.receive(ctx(),report(occurrence,'late-after-pause'))
 ]);
 assert.equal(publish.accepted,true);
 assert.equal(late.reason,'program_superseded');
 assert.deepEqual(counts(api,txn.snapshot()),{attempts:0,completed:0});
 assert.deepEqual(txn.snapshot().program.base,p.base);
});
test('queued receipt before publication remains one historical row and retry stays idempotent',async()=>{
 const api=await load(),p=program();const {state,occurrence}=lease(api,api.createStagingReceiptLab(p));
 const txn=referenceTransactionQueue(api,state),event=report(occurrence,'on-boundary');
 const updated=structuredClone(p);updated.ads[0].status='paused';updated.inventoryRevision='inventory-v2';
 const [accepted,published,retry]=await Promise.all([
  txn.receive(ctx(),event),txn.publish(updated),txn.receive(ctx(T+600000),event)
 ]);
 assert.equal(accepted.reason,'completion_claim_recorded');
 assert.equal(published.accepted,true);
 assert.equal(retry.reason,'duplicate_event');
 assert.deepEqual(counts(api,txn.snapshot()),{attempts:1,completed:1});
});
test('offline longer than five-minute lease refuses new first delivery but preserves unchanged base program',async()=>{
 const api=await load(),p=program(),snapshot=structuredClone(p);
 let {state,occurrence}=lease(api,api.createStagingReceiptLab(p),1,T,300000);
 const event=report(occurrence,'twelve-hours-offline');
 const late=api.receiveStagingReceipt(state,ctx(T+12*3600*1000),event);
 assert.equal(late.reason,'expired_or_not_yet_issued');
 assert.equal(late.state.accepted.length,0);
 assert.deepEqual(late.state.program.base,p.base);
 assert.deepEqual(p,snapshot);
 assert.deepEqual(counts(api,late.state),{attempts:0,completed:0});
});
test('already accepted receipt can be retried next day after apparent delivery outage without duplicate',async()=>{
 const api=await load();let {state,occurrence}=lease(api,api.createStagingReceiptLab(program()));
 const event=report(occurrence,'ack-lost');
 state=api.receiveStagingReceipt(state,ctx(),event).state;
 const nextDay=api.receiveStagingReceipt(state,ctx(T+25*3600*1000),event);
 assert.equal(nextDay.reason,'duplicate_event');
 assert.deepEqual(counts(api,nextDay.state),{attempts:1,completed:1});
 assert.equal(api.recalculateStagingDaily(nextDay.state).length,1);
});
test('São Paulo midnight assigns claim to server arrival day, not falsified client day',async()=>{
 const api=await load();
 const issueTime=Date.parse('2026-10-14T23:59:00-03:00');
 let {state,occurrence}=lease(api,api.createStagingReceiptLab(program()),1,issueTime,300000);
 const arrive=Date.parse('2026-10-15T00:01:00-03:00');
 const receipt=report(occurrence,'after-midnight',true,issueTime+30_000);
 state=api.receiveStagingReceipt(state,ctx(arrive),receipt).state;
 assert.equal(api.recalculateStagingDaily(state)[0].day,'2026-10-15');
 assert.deepEqual(counts(api,state),{attempts:1,completed:1});
});
test('mixed batch of invalid future time, wrong device and valid receipt fails only invalid rows',async()=>{
 const api=await load();
 let first=lease(api,api.createStagingReceiptLab(program()));
 let second=lease(api,first.state,2);
 const valid=report(first.occurrence,'valid');
 const wrongDevice=report(second.occurrence,'other-device');
 const future={...wrongDevice,ended_at:new Date(T+90000).toISOString()};
 const badRev={...wrongDevice,media_revision_id:'not-issued'};
 const result=api.receiveStagingBatch(second.state,ctx(),[future,badRev,valid,wrongDevice]);
 assert.deepEqual(result.results.map(x=>x.reason),[
  'untrusted_or_invalid_client_time','unissued_or_wrong_revision',
  'completion_claim_recorded','completion_claim_recorded']);
 assert.deepEqual(counts(api,result.state),{attempts:2,completed:2});
 const outsider=api.receiveStagingReceipt(result.state,ctx(T+15000,'tv-other'),wrongDevice);
 assert.equal(outsider.reason,'wrong_authenticated_device');
});
test('simultaneous snapshots WITHOUT serialization cannot prove transactional safety (documented limitation)',async()=>{
 const api=await load();const {state,occurrence}=lease(api,api.createStagingReceiptLab(program()));
 const left=api.receiveStagingReceipt(state,ctx(),report(occurrence,'race-event-a'));
 const right=api.receiveStagingReceipt(state,ctx(),report(occurrence,'race-event-b'));
 // Both return accepted from the same outdated snapshot; neither detects the
 // other. This is why PostgreSQL UNIQUE constraints/transactions are mandatory.
 assert.equal(left.accepted,true);assert.equal(right.accepted,true);
 assert.equal(left.state.accepted.length,1);assert.equal(right.state.accepted.length,1);
 assert.deepEqual(counts(api,left.state),{attempts:1,completed:1});
 assert.deepEqual(counts(api,right.state),{attempts:1,completed:1});
});
test('offline adversarial fixtures cannot access service APIs or change production player',()=>{
 const src=fs.readFileSync('commercial-staging-receipt-lab.mjs','utf8');
 const testSrc=fs.readFileSync('tests/commercial-receipt-adversarial-lab.test.cjs','utf8');
 const gateway=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
 assert.match(src,/OFFLINE LAB ONLY/);
 assert.match(testSrc,/Adversarial OFFLINE fixtures/);
 // Inspect executable source, not this test's own forbidden-token regexp.
 assert.doesNotMatch(src,/\bfetch\s*\(|createClient\s*\(|\.supabase\.co|service_role|localStorage|sessionStorage|https?:\/\//);
 assert.doesNotMatch(gateway,/commercial-receipt-adversarial-lab/);
});
