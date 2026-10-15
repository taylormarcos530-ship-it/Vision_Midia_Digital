// REAL PostgreSQL SQL via ephemeral in-memory PGlite; no Supabase, remote staging or deployment.
// Concurrency on ONE embedded PGlite connection is serialized: NOT evidence of multi-connection races.
// Requires independent hosted PostgreSQL staging with approved auth/locks before any integration.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const d1=uuid(1),d2=uuid(2),company=uuid(10);
const rev=uuid(20),creative=uuid(30),camp=uuid(40);
const oc1=uuid(51),oc2=uuid(52);
const start='2026-10-14T17:00:00Z';
const end='2026-10-14T17:00:20Z';
const late='2026-10-15T05:00:00Z';

async function initialize(db){
 await db.exec([
 'CREATE SCHEMA lab_commercial',
 'CREATE TABLE lab_commercial.device_epochs (device_id uuid PRIMARY KEY, company_id uuid NOT NULL, program_epoch bigint NOT NULL CHECK(program_epoch>0), program_fingerprint text NOT NULL, commercial_enabled boolean NOT NULL DEFAULT false)',
 'CREATE TABLE lab_commercial.playback_occurrences (device_id uuid NOT NULL, occurrence_id uuid NOT NULL, company_id uuid NOT NULL, campaign_id uuid NOT NULL, revision_id uuid NOT NULL, media_id uuid NOT NULL, program_epoch bigint NOT NULL, issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, status text NOT NULL CHECK(status IN (\'issued\',\'cancelled\',\'finalized\')), PRIMARY KEY(device_id,occurrence_id), UNIQUE(device_id,occurrence_id,revision_id), FOREIGN KEY(device_id) REFERENCES lab_commercial.device_epochs(device_id), CHECK(expires_at>issued_at))',
 'CREATE TABLE lab_commercial.playback_receipts (device_id uuid NOT NULL, occurrence_id uuid NOT NULL, client_event_id text NOT NULL CHECK(char_length(client_event_id) BETWEEN 1 AND 120), revision_id uuid NOT NULL, completed boolean NOT NULL, claimed_ended_at timestamptz, received_at timestamptz NOT NULL, normalized_payload_fingerprint text NOT NULL, PRIMARY KEY(device_id,client_event_id), UNIQUE(device_id,occurrence_id), FOREIGN KEY(device_id,occurrence_id,revision_id) REFERENCES lab_commercial.playback_occurrences(device_id,occurrence_id,revision_id), CHECK(NOT completed OR claimed_ended_at IS NOT NULL))',
 'CREATE TABLE lab_commercial.owner_playlist_items (id int PRIMARY KEY, media_name text NOT NULL)',
 "INSERT INTO lab_commercial.owner_playlist_items VALUES (1,'Óleo'),(2,'Freios'),(3,'Motor'),(4,'Suspensão'),(5,'Escapamento'),(6,'Revisão')"
 ].join(';')+';');
}
async function reset(db){
 await db.exec('TRUNCATE lab_commercial.playback_receipts,lab_commercial.playback_occurrences,lab_commercial.device_epochs');
 await db.query('INSERT INTO lab_commercial.device_epochs(device_id,company_id,program_epoch,program_fingerprint,commercial_enabled) VALUES ($1,$3,1,$4,true),($2,$3,1,$4,true)',[d1,d2,company,'fixture-revision-v1']);
 await db.query("INSERT INTO lab_commercial.playback_occurrences(device_id,occurrence_id,company_id,campaign_id,revision_id,media_id,program_epoch,issued_at,expires_at,status) VALUES ($1,$3,$5,$6,$7,$8,1,$9,$10,'issued'),($1,$4,$5,$6,$7,$8,1,$9,$10,'issued'),($2,$3,$5,$6,$7,$8,1,$9,$10,'issued')",
  [d1,d2,oc1,oc2,company,camp,rev,creative,start,'2026-10-14T17:05:00Z']);
}
const claim=(event='event-1',occ=oc1,device=d1,now=end,done=true)=>({
 verifiedDeviceId:device, verifiedCompanyId:company, event,occ,revision:rev,
 completed:done,endedAt:done?end:null,receivedAt:now,fingerprint:'server-canonical-payload-1'
});
async function receive(db,p){
 await db.exec('BEGIN');
 try{
  // Future implementation must validate the device token BEFORE calling this SQL.
  // In this fixture verifiedDeviceId/verifiedCompanyId are trusted test parameters only.
  const locked=await db.query('SELECT device_id FROM lab_commercial.device_epochs WHERE device_id=$1 AND company_id=$2 FOR UPDATE',[p.verifiedDeviceId,p.verifiedCompanyId]);
  if(!locked.rows.length){await db.exec('ROLLBACK');return 'wrong_device';}
  const byEvent=await db.query('SELECT * FROM lab_commercial.playback_receipts WHERE device_id=$1 AND client_event_id=$2',[p.verifiedDeviceId,p.event]);
  if(byEvent.rows.length){
   const prior=byEvent.rows[0];
   const identical=prior.occurrence_id===p.occ&&prior.revision_id===p.revision&&
    prior.completed===p.completed&&prior.normalized_payload_fingerprint===p.fingerprint&&
    (prior.claimed_ended_at?new Date(prior.claimed_ended_at).toISOString():null)===(p.endedAt?new Date(p.endedAt).toISOString():null);
   await db.exec('COMMIT');
   return identical?'duplicate_event':'event_collision';
  }
  const byOcc=await db.query('SELECT client_event_id FROM lab_commercial.playback_receipts WHERE device_id=$1 AND occurrence_id=$2',[p.verifiedDeviceId,p.occ]);
  if(byOcc.rows.length){await db.exec('COMMIT');return 'occurrence_already_finalized';}
  const inserted=await db.query(
   "INSERT INTO lab_commercial.playback_receipts(device_id,occurrence_id,client_event_id,revision_id,completed,claimed_ended_at,received_at,normalized_payload_fingerprint) SELECT o.device_id,o.occurrence_id,$4,o.revision_id,$5,$6::timestamptz,$7::timestamptz,$8 FROM lab_commercial.playback_occurrences o JOIN lab_commercial.device_epochs e ON e.device_id=o.device_id WHERE o.device_id=$1 AND o.occurrence_id=$2 AND o.revision_id=$3 AND o.company_id=e.company_id AND o.program_epoch=e.program_epoch AND o.status='issued' AND e.commercial_enabled AND o.issued_at<=$7::timestamptz AND o.expires_at>=$7::timestamptz AND ($5=false OR $6::timestamptz IS NOT NULL) AND ($6::timestamptz IS NULL OR ($6::timestamptz>=o.issued_at AND $6::timestamptz<=$7::timestamptz)) ON CONFLICT DO NOTHING RETURNING occurrence_id",
   [p.verifiedDeviceId,p.occ,p.revision,p.event,p.completed,p.endedAt,p.receivedAt,p.fingerprint]);
  if(!inserted.rows.length){await db.exec('COMMIT');return 'not_eligible_or_conflict';}
  await db.query("UPDATE lab_commercial.playback_occurrences SET status='finalized' WHERE device_id=$1 AND occurrence_id=$2",[p.verifiedDeviceId,p.occ]);
  await db.exec('COMMIT');
  return 'accepted_once';
 }catch(e){await db.exec('ROLLBACK');throw e}
}
async function rows(db){return (await db.query('SELECT device_id,occurrence_id,client_event_id,completed FROM lab_commercial.playback_receipts ORDER BY device_id,client_event_id')).rows}
async function owner(db){return (await db.query('SELECT id,media_name FROM lab_commercial.owner_playlist_items ORDER BY id')).rows}
async function revoke(db){
 await db.exec('BEGIN');
 try{
  await db.query('SELECT device_id FROM lab_commercial.device_epochs WHERE device_id=$1 FOR UPDATE',[d1]);
  await db.query('UPDATE lab_commercial.device_epochs SET program_epoch=program_epoch+1,commercial_enabled=false WHERE device_id=$1',[d1]);
  await db.query("UPDATE lab_commercial.playback_occurrences SET status='cancelled' WHERE device_id=$1 AND status='issued'",[d1]);
  await db.exec('COMMIT');
 }catch(e){await db.exec('ROLLBACK');throw e}
}

test('PostgreSQL embedded-only laboratory: constraints, rollback and offline contract',async t=>{
 const db=new PGlite();
 try{
  await initialize(db);
  await t.test('DDL creates separate unique indexes for client events and occurrence IDs',async()=>{
   await reset(db);
   const indexes=(await db.query("SELECT indexdef FROM pg_indexes WHERE schemaname='lab_commercial' AND tablename='playback_receipts'")).rows.map(x=>x.indexdef);
   assert.equal(indexes.filter(x=>/UNIQUE/.test(x)).length,2);
   assert.match(indexes.join('\n'),/client_event_id/);
   assert.match(indexes.join('\n'),/occurrence_id/);
  });
  await t.test('same event and same occurrence use single final record with idempotent retry',async()=>{
   await reset(db);
   const base=claim();
   assert.equal(await receive(db,base),'accepted_once');
   assert.equal(await receive(db,base),'duplicate_event');
   assert.equal(await receive(db,{...base,event:'event-2'}),'occurrence_already_finalized');
   assert.equal(await receive(db,{...base,completed:false}),'event_collision');
   assert.equal((await rows(db)).length,1);
  });
  await t.test('unique index rejects a competing event ID for a finalized occurrence',async()=>{
   await reset(db);
   await db.query("INSERT INTO lab_commercial.playback_receipts(device_id,occurrence_id,client_event_id,revision_id,completed,claimed_ended_at,received_at,normalized_payload_fingerprint) VALUES ($1,$2,'first',$3,true,$4,$4,'server-1')",[d1,oc1,rev,end]);
   await assert.rejects(()=>db.query("INSERT INTO lab_commercial.playback_receipts(device_id,occurrence_id,client_event_id,revision_id,completed,claimed_ended_at,received_at,normalized_payload_fingerprint) VALUES ($1,$2,'second',$3,true,$4,$4,'server-2')",[d1,oc1,rev,end]),/duplicate key value violates unique constraint/i);
   assert.equal((await rows(db)).length,1);
  });
  await t.test('event uniqueness is scoped to each TV, not shared between companies',async()=>{
   await reset(db);
   assert.equal(await receive(db,claim('same-event',oc1,d1)),'accepted_once');
   assert.equal(await receive(db,claim('same-event',oc1,d2)),'accepted_once');
   assert.equal((await rows(db)).length,2);
   assert.equal(await receive(db,{...claim('forged',oc2,d1),verifiedCompanyId:uuid(99)}),'wrong_device');
  });
  await t.test('roll back entire transaction when second SQL command fails',async()=>{
   await reset(db);
   await db.exec('BEGIN');
   await db.query("INSERT INTO lab_commercial.playback_receipts(device_id,occurrence_id,client_event_id,revision_id,completed,claimed_ended_at,received_at,normalized_payload_fingerprint) VALUES ($1,$2,'first',$3,true,$4,$4,'server-a')",[d1,oc1,rev,end]);
   await assert.rejects(()=>db.query("INSERT INTO lab_commercial.playback_receipts(device_id,occurrence_id,client_event_id,revision_id,completed,claimed_ended_at,received_at,normalized_payload_fingerprint) VALUES ($1,$2,'second',$3,true,$4,$4,'server-b')",[d1,oc1,rev,end]),/duplicate key value violates unique constraint/i);
   await db.exec('ROLLBACK');
   assert.equal((await rows(db)).length,0);
  });
  await t.test('after commit but before ACK, a retry reads the stored receipt once',async()=>{
   await reset(db);
   const p=claim('ack-lost');
   assert.equal(await receive(db,p),'accepted_once');
   assert.equal(await receive(db,{...p,receivedAt:late}),'duplicate_event');
   assert.equal((await rows(db)).length,1);
  });
  await t.test('revocation before first receipt refuses it and preserves playlist items',async()=>{
   await reset(db);
   const original=await owner(db);
   await revoke(db);
   assert.equal(await receive(db,claim('late')),'not_eligible_or_conflict');
   assert.equal((await rows(db)).length,0);
   assert.deepEqual(await owner(db),original);
  });
  await t.test('accepted receipt then revocation retains history without re-counting',async()=>{
   await reset(db);
   const p=claim('before-pause');
   assert.equal(await receive(db,p),'accepted_once');
   await revoke(db);
   assert.equal(await receive(db,p),'duplicate_event');
   assert.equal((await rows(db)).length,1);
  });
  await t.test('first delivery twelve hours offline expires, while base playlist remains intact',async()=>{
   await reset(db);
   const original=await owner(db);
   assert.equal(await receive(db,claim('twelve-hours',oc1,d1,late)),'not_eligible_or_conflict');
   assert.equal((await rows(db)).length,0);
   assert.deepEqual(await owner(db),original);
  });
  await t.test('a completed receipt with no end timestamp fails a database check',async()=>{
   await reset(db);
   await assert.rejects(()=>db.query("INSERT INTO lab_commercial.playback_receipts(device_id,occurrence_id,client_event_id,revision_id,completed,claimed_ended_at,received_at,normalized_payload_fingerprint) VALUES ($1,$2,'missing-end',$3,true,NULL,$4,'bad')",[d1,oc1,rev,end]),/violates check constraint/i);
   assert.equal((await rows(db)).length,0);
  });
  await t.test('same-key concurrent inserts on one embedded connection serialize; no multi-session claim',async()=>{
   await reset(db);
   const sql="INSERT INTO lab_commercial.playback_receipts(device_id,occurrence_id,client_event_id,revision_id,completed,claimed_ended_at,received_at,normalized_payload_fingerprint) VALUES ($1,$2,'shared-event',$3,true,$4,$4,'same') ON CONFLICT DO NOTHING RETURNING client_event_id";
   const results=await Promise.all(Array.from({length:20},()=>db.query(sql,[d1,oc1,rev,end])));
   assert.equal(results.reduce((n,x)=>n+x.rows.length,0),1);
   assert.equal((await rows(db)).length,1);
  });
  await t.test('daily totals are derived from stored final rows, not number of replays',async()=>{
   await reset(db);
   assert.equal(await receive(db,claim('success')),'accepted_once');
   assert.equal(await receive(db,claim('success')),'duplicate_event');
   assert.equal(await receive(db,claim('unfinished',oc2,d1,end,false)),'accepted_once');
   const summary=await db.query("SELECT (received_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,count(*)::int attempts,count(*) FILTER(WHERE completed)::int completed FROM lab_commercial.playback_receipts WHERE device_id=$1 GROUP BY 1",[d1]);
   assert.equal(summary.rows.length,1);
   assert.equal(summary.rows[0].attempts,2);
   assert.equal(summary.rows[0].completed,1);
   assert.equal(summary.rows[0].day,'2026-10-14');
  });
  await t.test('only isolated test file contains DDL; operations and production migrations stay untouched',()=>{
   const spec=fs.readFileSync('docs/implementation/commercial-postgres-atomicity-spec-only.md','utf8');
   const operational=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
   assert.match(spec,/SOMENTE ESPECIFICAÇÃO/);
   assert.doesNotMatch(operational,/commercial-receipt-pglite-atomicity/);
  });
 }finally{await db.close()}
});
