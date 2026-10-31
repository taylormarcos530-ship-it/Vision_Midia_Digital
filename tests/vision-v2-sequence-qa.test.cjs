'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SequenceServer,DurableJournal,dateInBrazil}=require('./vision-v2-sequence-model.cjs');
const T='dev-A-fake-token';
const event=(seq,other={})=>({seq,mediaId:'ad-001',playedAt:'2026-10-31T12:00:00Z',
  completed:true,durationSeconds:15,...other});
const device=(server=new SequenceServer(),opts={})=>{
  server.provision({tenant:'company-A',device:'tv-A',epoch:'epoch-1',token:T,adminApproved:true,...opts});
  return server;
};

test('1 - New epoch requires an explicit administrative authorization',()=>{
  assert.throws(()=>new SequenceServer().provision({tenant:'A',device:'D',epoch:'E',token:'X'}),/admin_approval_required/);
});
test('2 - Wrong or missing device token has no access',()=>{
  const s=device();assert.equal(s.submit('none',[event(1)]).error,'unauthorized');
  assert.equal(s.totals(T).starts,0);
});
test('3 - First event commits and produces one count',()=>{
  const s=device();let a=s.submit(T,[event(1)]);
  assert.deepEqual([a.ok,a.committedThrough,a.committed],[true,1,1]);
  assert.deepEqual(s.totals(T),{starts:1,completes:1,seconds:15});
});
test('4 - Exact retry does not increment advertiser count',()=>{
  const s=device();s.submit(T,[event(1)]);
  const a=s.submit(T,[event(1)]);
  assert.deepEqual([a.accepted,a.duplicates,a.committedThrough],[0,1,1]);
  assert.equal(s.totals(T).starts,1);
});
test('5 - Altered retry inside verification window is refused',()=>{
  const s=device();s.submit(T,[event(1)]);
  assert.equal(s.submit(T,[event(1,{durationSeconds:50})]).error,'sequence_conflict');
  assert.equal(s.totals(T).seconds,15);
});
test('6 - Gaps do not count future events prematurely',()=>{
  const s=device();const a=s.submit(T,[event(2)]);
  assert.deepEqual([a.committedThrough,a.committed,a.pending],[0,0,1]);
  assert.equal(s.totals(T).starts,0);
});
test('7 - Missing event fills gap and commits pending in correct order',()=>{
  const s=device();s.submit(T,[event(3),event(2)]);const a=s.submit(T,[event(1)]);
  assert.deepEqual([a.committedThrough,a.committed,a.pending],[3,3,0]);
  assert.equal(s.totals(T).starts,3);
});
test('8 - Reverse order within same batch is handled atomically',()=>{
  const s=device();const a=s.submit(T,[event(3),event(2),event(1)]);
  assert.equal(a.committedThrough,3);assert.equal(s.totals(T).starts,3);
});
test('9 - Lost ACK after commit followed by replay remains idempotent',()=>{
  const s=device();assert.throws(()=>s.submit(T,[event(1),event(2)],{failpoint:'afterCommitBeforeAck'}),/simulated_lost_ack/);
  const retry=s.submit(T,[event(1),event(2)]);
  assert.deepEqual([retry.accepted,retry.duplicates,retry.committedThrough],[0,2,2]);
  assert.equal(s.totals(T).starts,2);
});
test('10 - Restart from durable journal does not reuse a sequence number',()=>{
  const s=device(),j=new DurableJournal({epoch:'epoch-1'});
  j.append(event(0));j.append(event(0));const saved=j.save();
  const afterRestart=new DurableJournal({epoch:'epoch-1',stored:saved});
  assert.deepEqual(afterRestart.batch().map(x=>x.seq),[1,2]);
  const a=s.submit(T,afterRestart.batch());afterRestart.ack(a);
  assert.equal(afterRestart.events.length,0);
  assert.equal(afterRestart.append(event(0)).seq,3);
});
test('11 - Invalid item after valid item rolls back whole batch',()=>{
  const s=device();const a=s.submit(T,[event(1),event(2,{durationSeconds:-1})]);
  assert.equal(a.error,'invalid_event');assert.equal(s.snapshot(T).watermark,0);
  assert.equal(s.totals(T).starts,0);
});
test('12 - Simulated failure before transaction COMMIT rolls everything back',()=>{
  const s=device();const a=s.submit(T,[event(1)],{failpoint:'beforeCommit'});
  assert.equal(a.error,'simulated_db_rollback');assert.equal(s.snapshot(T).watermark,0);
  assert.equal(s.totals(T).starts,0);
});
test('13 - Out-of-order pending records never exceed the configured window',()=>{
  const s=device(new SequenceServer({window:3}));s.submit(T,[event(2),event(3),event(4)]);
  assert.equal(s.snapshot(T).pending,3);
  const a=s.submit(T,[event(5)]);assert.equal(a.error,'gap_out_of_window');
  assert.equal(s.snapshot(T).pending,3);
});
test('14 - Very large jump is rejected without advancing watermark',()=>{
  const s=device();assert.equal(s.submit(T,[event(10000)]).error,'gap_out_of_window');
  assert.equal(s.snapshot(T).watermark,0);
});
test('15 - Repeated pending event does not create another pending record',()=>{
  const s=device();s.submit(T,[event(2)]);const a=s.submit(T,[event(2)]);
  assert.equal(a.duplicates,1);assert.equal(s.snapshot(T).pending,1);
});
test('16 - Conflicting pending payload is refused, first remains intact',()=>{
  const s=device();s.submit(T,[event(2)]);const a=s.submit(T,[event(2,{mediaId:'other-ad'})]);
  assert.equal(a.error,'sequence_conflict');assert.equal(s.snapshot(T).pending,1);
  s.submit(T,[event(1)]);assert.equal(s.totals(T).starts,2);
});
test('17 - Tenant A and tenant B never share counts or sequence state',()=>{
  const s=device();s.provision({tenant:'company-B',device:'tv-B',epoch:'epoch-1',token:'dev-B-token',adminApproved:true});
  s.submit(T,[event(1)]);s.submit('dev-B-token',[event(1),event(2,{completed:false})]);
  assert.deepEqual(s.totals(T),{starts:1,completes:1,seconds:15});
  assert.deepEqual(s.totals('dev-B-token'),{starts:2,completes:1,seconds:30});
});
test('18 - Revocation prevents any later operation',()=>{
  const s=device();s.revoke(T);assert.equal(s.submit(T,[event(1)]).error,'unauthorized');
});
test('19 - Replay older than recent fingerprint window is NOT falsely certified',()=>{
  const s=device(new SequenceServer({recent:2}));
  s.submit(T,[event(1),event(2),event(3)]);
  assert.equal(s.submit(T,[event(1)]).error,'old_replay_unverifiable');
  assert.equal(s.submit(T,[event(2)]).duplicates,1);
  assert.equal(s.totals(T).starts,3);
});
test('20 - Reset cannot silently reuse epoch, old epoch can be revoked',()=>{
  const s=device();s.submit(T,[event(1)]);
  assert.throws(()=>s.provision({tenant:'company-A',device:'tv-A',epoch:'epoch-1',token:'another-token',adminApproved:true}),/epoch_already_exists/);
  s.revoke(T);
  s.provision({tenant:'company-A',device:'tv-A',epoch:'epoch-2',token:'epoch-2-token',adminApproved:true});
  assert.equal(s.submit(T,[event(2)]).error,'unauthorized');
  assert.equal(s.submit('epoch-2-token',[event(1)]).committedThrough,1);
});
test('21 - Local storage full fails closed without discarding earlier events',()=>{
  const j=new DurableJournal({epoch:'epoch-1',cap:2});
  j.append(event(0));j.append(event(0));
  assert.throws(()=>j.append(event(0)),/device_storage_full/);
  assert.deepEqual(j.batch().map(x=>x.seq),[1,2]);assert.equal(j.lastIssued,2);
});
test('22 - The day follows Brazilian time, not UTC midnight',()=>{
  assert.equal(dateInBrazil('2026-11-01T01:59:00Z'),'2026-10-31');
  const s=device();s.submit(T,[event(1,{playedAt:'2026-11-01T01:59:00Z'})]);
  assert.ok(s.snapshot(T).aggregates[0][0].includes('2026-10-31'));
});
test('23 - Bad event timestamp or duration cannot commit',()=>{
  const s=device();
  for(const x of [
    event(1,{playedAt:'2026-10-31 12:00:00'}),
    event(1,{durationSeconds:Infinity}),
    event(1,{completed:'true'}),
    event(0),
  ]) assert.equal(s.submit(T,[x]).error,'invalid_event');
  assert.equal(s.snapshot(T).watermark,0);
});
test('24 - Batch bound is fifty events, never a much larger payload',()=>{
  const s=device();
  assert.equal(s.submit(T,Array.from({length:51},(_,i)=>event(i+1))).error,'invalid_batch');
  assert.equal(s.snapshot(T).watermark,0);
});
test('25 - Ten thousand events stay exactly counted with bounded recent memory',()=>{
  const s=device(new SequenceServer({window:128,recent:128}));
  for(let start=1;start<=10000;start+=50) {
    const batch=Array.from({length:Math.min(50,10001-start)},(_,i)=>event(start+i));
    const a=s.submit(T,batch);assert.equal(a.ok,true);
  }
  const state=s.snapshot(T);
  assert.deepEqual([state.watermark,state.pending,state.recent],[10000,0,128]);
  assert.deepEqual(s.totals(T),{starts:10000,completes:10000,seconds:150000});
});
test('26 - Concurrent-like interleaving of two independent device streams',()=>{
  const s=device();s.provision({tenant:'company-A',device:'tv-B',epoch:'epoch-X',token:'token-X',adminApproved:true});
  for(let n=1;n<=50;n++) {
    s.submit(T,[event(n)]);s.submit('token-X',[event(n)]);
  }
  assert.equal(s.totals(T).starts,50);
  assert.equal(s.totals('token-X').starts,50);
  assert.equal(s.streams.size,2);
});
test('27 - Epoch persistence prevents accidental journal swap',()=>{
  const j=new DurableJournal({epoch:'epoch-1'});j.append(event(0));
  assert.throws(()=>new DurableJournal({epoch:'epoch-2',stored:j.save()}),/epoch_drift/);
});
test('28 - ACK must be valid before client erases queued evidence',()=>{
  const j=new DurableJournal({epoch:'epoch-1'});j.append(event(0));
  assert.throws(()=>j.ack({ok:false,committedThrough:1}),/ack_invalid/);
  assert.equal(j.events.length,1);
});
