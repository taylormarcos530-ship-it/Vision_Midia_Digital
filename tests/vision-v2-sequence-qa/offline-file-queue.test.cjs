'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {FilePlaybackQueue,daySP}=require('./offline-file-queue.cjs');
const id={deviceId:'tv-Casa-QA',streamId:'stream-Casa-QA'},A='boot-A-001',B='boot-B-002';
const event=n=>({eventId:'event-'+String(n).padStart(8,'0'),media:'ad-1',completed:true,seconds:15});
const sample=(bootId=A,monoMs=1000)=>({bootId,monoMs});
const trust=(q,boot=A,mono=1000,utc='2026-10-31T15:00:00Z')=>q.recordTrustedTime(sample(boot,mono),utc,{authenticated:true});
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-v2-offline-'));
 t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const file=path.join(dir,'qa-queue.json');
 const q=FilePlaybackQueue.initialize(file,id);
 return {q,file,open:()=>new FilePlaybackQueue(file,id)};
}
test('persistencia offline por arquivo real apos reabertura',t=>{
 const {q,open}=fixture(t);q.append(event(1),sample());
 assert.equal(q.batch({online:false}).events.length,0);
 assert.deepEqual(open().inspect(),{confirmed:0,sentThrough:0,nextSequence:2,pending:1,unresolved:1});
});
test('RTC 1970: sem horario confiavel nao envia evento',t=>{
 const {q,open}=fixture(t);q.append(event(1),sample(A,30000));
 assert.equal(q.batch({online:true}).reason,'clock_unverified');
 assert.equal(open().inspect().unresolved,1);
});
test('servidor nao autenticado e hora 1970 rejeitados',t=>{
 const {q,open}=fixture(t);q.append(event(1),sample());
 assert.throws(()=>q.recordTrustedTime(sample(),'2026-10-31T15:00:00Z'),/unauthenticated_clock_anchor/);
 assert.throws(()=>trust(q,A,1000,'1970-01-01T00:00:00Z'),/invalid_server_time/);
 assert.equal(open().inspect().unresolved,1);
});
test('ancora corrige evento anterior do mesmo boot sem usar RTC',t=>{
 const {q,open}=fixture(t);q.append(event(1),sample(A,10000));
 assert.equal(trust(q,A,20000),1);
 assert.equal(open().batch({online:true}).events[0].played_at,'2026-10-31T14:59:50.000Z');
});
test('transicao de dia America/Sao_Paulo sem deslocar UTC errado',t=>{
 const {q,open}=fixture(t);trust(q,A,10000,'2026-11-01T02:59:50Z');
 q.append(event(1),sample(A,10000));q.append(event(2),sample(A,25000));
 assert.equal(daySP(Date.parse('2026-11-01T02:59:50Z')),'2026-10-31');
 assert.equal(open().state.pending[1].playedDay,'2026-11-01');
 assert.equal(open().state.pending[0].playedDay,'2026-10-31');
});
test('novo boot nao herda ancora do anterior',t=>{
 const {q,open}=fixture(t);trust(q);q.append(event(1),sample(A,2000));q.append(event(2),sample(B,1000));
 assert.equal(open().batch({online:true}).events.length,1);
 assert.equal(open().state.pending[1].playedAt,null);
});
test('evento antigo sem ancora bloqueia lote em vez de inventar hora',t=>{
 const {q,open}=fixture(t);q.append(event(1),sample(A,2000));trust(q,B,1000,'2026-11-01T12:00:00Z');
 q.append(event(2),sample(B,2000));
 assert.equal(open().batch({online:true}).events.length,0);
 assert.equal(open().state.pending[1].playedAt,'2026-11-01T12:00:01.000Z');
});
test('ack remove somente prefixo efetivamente enviado apos reinicio',t=>{
 const {q,open}=fixture(t);trust(q);q.append(event(1),sample(A,2000));q.append(event(2),sample(A,3000));
 assert.equal(q.batch({online:true,limit:1}).events[0].sequence,1);
 open().ack(1);
 assert.deepEqual(open().inspect(),{confirmed:1,sentThrough:1,nextSequence:3,pending:1,unresolved:0});
});
test('ack de evento nao enviado e rejeitado',t=>{
 const {q,open}=fixture(t);trust(q);q.append(event(1),sample());
 assert.throws(()=>q.ack(1),/invalid_ack/);assert.equal(open().inspect().pending,1);
});
test('ACK perdido: a mesma sequencia e reenviada apos nova abertura',t=>{
 const {q,open}=fixture(t);trust(q);q.append(event(1),sample());
 const sent=q.batch({online:true});assert.deepEqual(open().batch({online:true}).events,sent.events);
 open().ack(1);assert.equal(open().inspect().pending,0);
});
test('crash antes do rename preserva fila e nao avanca sequencia',t=>{
 const {q,open}=fixture(t);
 assert.throws(()=>q.append(event(1),sample(),{failBeforeRename:true}),/simulated_power_loss/);
 assert.equal(open().inspect().nextSequence,1);
 assert.equal(open().append(event(1),sample()),1);
});
test('crash depois do commit recupera evento; retry local idempotente',t=>{
 const {q,open}=fixture(t);
 assert.throws(()=>q.append(event(1),sample(),{failAfterRename:true}),/simulated_crash_after_commit/);
 assert.equal(open().inspect().pending,1);
 assert.equal(open().append(event(1),sample()),1);
 assert.equal(open().inspect().pending,1);
});
test('persistencia do ACK falha sem perder evento enviado',t=>{
 const {q,open}=fixture(t);trust(q);q.append(event(1),sample());q.batch({online:true});
 assert.throws(()=>q.ack(1,{failBeforeRename:true}),/simulated_power_loss/);
 assert.equal(open().inspect().pending,1);
 open().ack(1);assert.equal(open().inspect().pending,0);
});
test('arquivo corrompido bloqueia e nao reinicia automaticamente',t=>{
 const {q,file}=fixture(t);q.append(event(1),sample());fs.appendFileSync(file,'bad');
 assert.throws(()=>new FilePlaybackQueue(file,id),/queue_corrupt_repair_required/);
 assert.throws(()=>FilePlaybackQueue.initialize(file,id),/queue_already_initialized/);
});
test('arquivo apagado exige intervencao, sem reset silencioso',t=>{
 const {q,file}=fixture(t);q.append(event(1),sample());fs.unlinkSync(file);
 assert.throws(()=>new FilePlaybackQueue(file,id),/queue_missing_repair_required/);
});
test('arquivo de outro stream nao pode ser reaproveitado',t=>{
 const {q,file}=fixture(t);q.append(event(1),sample());
 assert.throws(()=>new FilePlaybackQueue(file,{deviceId:'tv-outra',streamId:'stream-outro'}),/queue_state_invalid_repair_required/);
});
test('mesmo id local com payload diferente e bloqueado',t=>{
 const {q,open}=fixture(t);q.append(event(1),sample());
 assert.throws(()=>q.append({...event(1),seconds:30},sample()),/duplicate_event_id_conflict/);
 assert.equal(open().inspect().pending,1);
});
test('fila 2000 cheia falha fechada sem apagar comprovantes',t=>{
 const {q,open}=fixture(t);
 for(let i=1;i<=2000;i++)q.append(event(i),sample(A,i*10));
 assert.throws(()=>q.append(event(2001),sample(A,20010)),/queue_full_repair_required/);
 assert.deepEqual(open().inspect(),{confirmed:0,sentThrough:0,nextSequence:2001,pending:2000,unresolved:2000});
});
test('sete dias offline no mesmo boot: ancora retroativa sem RTC',t=>{
 const {q,open}=fixture(t);q.append(event(1),sample(A,1000));
 assert.equal(trust(q,A,7*86400000+1000,'2026-11-07T15:00:00Z'),1);
 assert.equal(open().state.pending[0].playedAt,'2026-10-31T15:00:00.000Z');
});
test('monotonic negativo ou janela acima de 30 dias nao geram hora falsa',t=>{
 const {q,open}=fixture(t);assert.throws(()=>q.append(event(1),sample(A,-1)),/invalid_boot_sample/);
 trust(q);q.append(event(1),sample(A,31*86400000));
 assert.equal(open().inspect().unresolved,1);
});
test.todo('Android real: SystemClock.elapsedRealtime, bootId e SQLite transacional');
test.todo('TV Box Casa fisica: queda energia, boot RTC 1970 e retorno de rede');
test.todo('conciliar evento sem data apos reboot de outro boot sem ancora');
