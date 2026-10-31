'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DurableDeviceQueue, SequenceServer, deviceState } = require('./model.cjs');
const e = (mediaId = 'advert-1', completed = true) =>
  ({ mediaId, playedAt:'2026-10-31T15:00:00Z', completed, durationSeconds:15 });
function setup() {
  const s = new SequenceServer();
  s.register('tv1','secret1','stream1');
  const state=deviceState('tv1','stream1');
  return { s,state,q:new DurableDeviceQueue(state) };
}
test('50 eventos: contador continuo e total diario corretos',async()=>{
  const {s,q}=setup();for(let i=0;i<50;i++)q.enqueue(e());
  const a=await s.receive('tv1','secret1','stream1',q.batch());q.acknowledge(a.ack);
  assert.deepEqual(a,{ack:50,accepted:50,duplicates:0,needFrom:51});
  assert.equal(s.total(),50);assert.equal(q.s.pending.length,0);
});
test('ACK perdido: reenvio sem contagem duplicada',async()=>{
  const {s,q}=setup();q.enqueue(e());q.enqueue(e());
  await assert.rejects(s.receive('tv1','secret1','stream1',q.batch(),'after_commit_before_ack'),/lost_response/);
  const a=await s.receive('tv1','secret1','stream1',q.batch());q.acknowledge(a.ack);
  assert.equal(a.accepted,0);assert.equal(a.duplicates,2);assert.equal(s.total(),2);
});
test('falha antes do commit deixa comprovantes pendentes',async()=>{
  const {s,q}=setup();q.enqueue(e());
  await assert.rejects(s.receive('tv1','secret1','stream1',q.batch(),'before_commit'),/server_unavailable/);
  assert.equal(s.total(),0);assert.equal(q.s.pending.length,1);
});
test('reinicio preserva contador e fila em estado simulado',async()=>{
  const {s,state,q}=setup();q.enqueue(e());
  const restarted=new DurableDeviceQueue(state);restarted.enqueue(e());
  const a=await s.receive('tv1','secret1','stream1',restarted.batch());
  restarted.acknowledge(a.ack);
  assert.equal(s.total(),2);assert.equal(state.nextSequence,3);
});
test('disco cheio nao incrementa sequencia sem gravar evento',()=>{
  const {q}=setup();assert.throws(()=>q.enqueue(e(),{failStorage:true}),/storage_full/);
  assert.equal(q.s.nextSequence,1);assert.equal(q.s.pending.length,0);
});
test('lacuna rejeita lote inteiro e permite reenvio ordenado',async()=>{
  const {s,q}=setup();q.enqueue(e());q.enqueue(e());q.enqueue(e());
  await assert.rejects(s.receive('tv1','secret1','stream1',[q.batch()[0],q.batch()[2]]),/sequence_gap/);
  assert.equal(s.total(),0);
  const a=await s.receive('tv1','secret1','stream1',q.batch());
  assert.equal(a.accepted,3);assert.equal(s.total(),3);
});
test('lote fora de ordem falha sem gravacao',async()=>{
  const {s,q}=setup();q.enqueue(e());q.enqueue(e());
  await assert.rejects(s.receive('tv1','secret1','stream1',q.batch().reverse()),/unordered_sequence/);
  assert.equal(s.total(),0);
});
test('sobreposicao de sequencias antigas e novas so conta novas',async()=>{
  const {s,q}=setup();q.enqueue(e());q.enqueue(e());
  await s.receive('tv1','secret1','stream1',q.batch());q.enqueue(e());
  const a=await s.receive('tv1','secret1','stream1',q.batch());
  assert.equal(a.accepted,1);assert.equal(a.duplicates,2);assert.equal(s.total(),3);
});
test('lote inteiramente duplicado nao altera total',async()=>{
  const {s,q}=setup();q.enqueue(e());const one=q.batch();
  await s.receive('tv1','secret1','stream1',one);
  const a=await s.receive('tv1','secret1','stream1',one);
  assert.equal(a.accepted,0);assert.equal(a.ack,1);assert.equal(s.total(),1);
});
test('seis envios concorrentes identicos contam somente uma vez',async()=>{
  const {s,q}=setup();for(let i=0;i<20;i++)q.enqueue(e());
  const all=await Promise.all(Array.from({length:6},()=>s.receive('tv1','secret1','stream1',q.batch())));
  assert.equal(all.reduce((n,a)=>n+a.accepted,0),20);assert.equal(s.total(),20);
});
test('token e stream nao atravessam TVs',async()=>{
  const {s,q}=setup();s.register('tv2','secret2','stream2');q.enqueue(e());
  await assert.rejects(s.receive('tv1','secret2','stream1',q.batch()),/unauthorized/);
  await assert.rejects(s.receive('tv2','secret2','stream1',q.batch()),/stale_stream/);
  assert.equal(s.total(),0);
});
test('stream antigo nao pode reproduzir sequencia apos substituicao',async()=>{
  const {s,q}=setup();q.enqueue(e());await s.receive('tv1','secret1','stream1',q.batch());
  s.devices.get('tv1').streamId='stream2';
  await assert.rejects(s.receive('tv1','secret1','stream1',q.batch()),/stale_stream/);
  assert.equal(s.total(),1);
});
test('evento invalido invalida lote inteiro',async()=>{
  const {s,q}=setup();q.enqueue(e());q.enqueue({...e(),durationSeconds:-5});
  await assert.rejects(s.receive('tv1','secret1','stream1',q.batch()),/invalid_event/);
  assert.equal(s.total(),0);
});
test('lote vazio ou acima de 50 e rejeitado',async()=>{
  const {s,q}=setup();
  await assert.rejects(s.receive('tv1','secret1','stream1',[]),/invalid_batch/);
  for(let i=0;i<51;i++)q.enqueue(e());
  await assert.rejects(s.receive('tv1','secret1','stream1',q.batch(51)),/invalid_batch/);
  assert.equal(s.total(),0);
});
test('ACK futuro e rejeitado para evitar apagar fila nao confirmada',()=>{
  const {q}=setup();q.enqueue(e());assert.throws(()=>q.acknowledge(5),/ack_beyond_sent/);
});
test('starts, completes e midia ficam separados',async()=>{
  const {s,q}=setup();q.enqueue(e('A',true));q.enqueue(e('A',false));q.enqueue(e('B',true));
  await s.receive('tv1','secret1','stream1',q.batch());
  assert.equal(s.summaries.get('tv1|2026-10-31|A').starts,2);
  assert.equal(s.summaries.get('tv1|2026-10-31|A').completes,1);
  assert.equal(s.summaries.get('tv1|2026-10-31|B').starts,1);
});
test('lacuna apos ACK parcial exige retomada no numero correto',async()=>{
  const {s,q}=setup();for(let i=0;i<4;i++)q.enqueue(e());
  const a=await s.receive('tv1','secret1','stream1',q.batch(2));q.acknowledge(a.ack);
  await assert.rejects(s.receive('tv1','secret1','stream1',[q.batch()[1]]),/sequence_gap/);
  const b=await s.receive('tv1','secret1','stream1',q.batch());q.acknowledge(b.ack);
  assert.equal(s.total(),4);assert.equal(q.s.pending.length,0);
});
test('replay antigo permanece bloqueado mesmo sem historico bruto',async()=>{
  const {s,q}=setup();q.enqueue(e());const old=q.batch();
  await s.receive('tv1','secret1','stream1',old);
  const a=await s.receive('tv1','secret1','stream1',old);
  assert.equal(a.accepted,0);assert.equal(s.total(),1);assert.equal(s.devices.get('tv1').watermark,1);
});
test('estado perdido ou contador corrompido exige reparo',()=>{
  assert.throws(()=>new DurableDeviceQueue({deviceId:'tv1',streamId:'stream1',pending:[]}),/repair_required/);
  assert.throws(()=>new DurableDeviceQueue({deviceId:'tv1',streamId:'stream1',nextSequence:1,confirmed:1,pending:[]}),/repair_required/);
});
test.todo('proteger relogio 1970, reconhecer dia local e reconciliar depois de hora valida');
test.todo('Postgres real: row lock, transacao e concorrencia em 100 TVs');
test.todo('Android: transacao duravel, perda de armazenamento e reinstalacao controlada');
