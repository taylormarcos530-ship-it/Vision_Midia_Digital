// Execute: node --test tests/fetch-cached-json.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchCachedJson} from '../utils/fetch-cached-json.mjs';

const now=Date.UTC(2026,9,28,18,0,0);
const valid=data=>!!data&&typeof data==='object'&&
  Array.isArray(data.itens)&&data.itens.length===1&&typeof data.itens[0]==='string';
const data={itens:['Conteúdo de teste']};
function storage(){
  const values=new Map();
  return {
    values,
    getItem(key){return values.get(key)??null;},
    setItem(key,val){values.set(key,val);}
  };
}
const ok=value=>async()=>({ok:true,json:async()=>value});
const failed=async()=>{throw new Error('offline')};

test('cache fresco evita nova consulta por até 3 horas',async()=>{
  const s=storage();s.setItem('fresh',JSON.stringify({value:data,savedAt:now-1000}));
  let calls=0;
  const r=await fetchCachedJson('./test',{cacheKey:'fresh',storage:s,validate:valid,now:()=>now,
    fetchImpl:async()=>{calls++;throw new Error('não deve chamar');}});
  assert.equal(calls,0);assert.equal(r.source,'cache');assert.equal(r.stale,false);
});
test('relógio Epoch não descarta cache offline',async()=>{
  const s=storage();s.setItem('epoch',JSON.stringify({value:data,savedAt:now}));
  const r=await fetchCachedJson('./test',{cacheKey:'epoch',storage:s,validate:valid,now:()=>0,fetchImpl:failed});
  assert.equal(r.source,'cache');assert.equal(r.stale,true);
  assert.equal(r._meta.clockPlausible,false);assert.ok(s.values.has('epoch'));
});
test('relógio muito futuro preserva cache',async()=>{
  const s=storage();s.setItem('future',JSON.stringify({value:data,savedAt:now}));
  const r=await fetchCachedJson('./test',{cacheKey:'future',storage:s,validate:valid,
    now:()=>Date.UTC(2099,0,1),fetchImpl:failed});
  assert.equal(r.source,'cache');assert.ok(s.values.has('future'));
});
test('response.ok false registra erro sem apagar cache',async()=>{
  const s=storage();s.setItem('http',JSON.stringify({value:data,savedAt:now-10800001}));
  const r=await fetchCachedJson('./test',{cacheKey:'http',storage:s,validate:valid,now:()=>now,
    fetchImpl:async()=>({ok:false,status:503})});
  assert.equal(r.source,'cache');assert.equal(r._meta.lastError,'HTTP 503');
  assert.deepEqual(JSON.parse(s.getItem('http')).value,data);
});
test('payload rejeitado não substitui o último válido',async()=>{
  const s=storage();s.setItem('invalid',JSON.stringify({value:data,savedAt:now-10800001}));
  const r=await fetchCachedJson('./test',{cacheKey:'invalid',storage:s,validate:valid,now:()=>now,
    fetchImpl:ok({itens:[42]})});
  assert.equal(r.stale,true);
  assert.deepEqual(JSON.parse(s.getItem('invalid')).value,data);
});
test('cooldown de 5min bloqueia requisições repetidas',async()=>{
  const s=storage();let calls=0,wall=now,mono=10;
  const options={cacheKey:'cooldown',storage:s,validate:valid,now:()=>wall,
    monotonicNow:()=>mono,fetchImpl:async()=>{calls++;throw new Error('offline');}};
  await fetchCachedJson('./test',options);
  const skipped=await fetchCachedJson('./test',options);
  assert.equal(calls,1);assert.equal(skipped._meta.reason,'cooldown');
  wall+=300001;mono+=300001;
  await fetchCachedJson('./test',options);
  assert.equal(calls,2);
});
test('AbortController encerra também JSON sem resolução',async()=>{
  let aborted=false;
  const r=await fetchCachedJson('./test',{cacheKey:'timeout',storage:storage(),validate:valid,
    timeoutMs:15,fetchImpl:async(_url,{signal})=>{
      signal.addEventListener('abort',()=>{aborted=true;});
      return {ok:true,json:()=>new Promise(()=>{})};
    }});
  assert.equal(aborted,true);assert.equal(r.stale,true);
  assert.match(r._meta.lastError,/Timeout/);
});
test('sucesso registra cache e metadados',async()=>{
  const s=storage();
  const r=await fetchCachedJson('./test',{cacheKey:'ok',storage:s,validate:valid,now:()=>now,
    fetchImpl:ok(data)});
  assert.equal(r.source,'network');assert.equal(r._meta.cachedAt,now);
  assert.deepEqual(JSON.parse(s.getItem('ok')).value,data);
});
test('cabeçalho Date permite cache mesmo com relógio em 1970',async()=>{
  const s=storage();
  const r=await fetchCachedJson('./test',{cacheKey:'date',storage:s,validate:valid,now:()=>0,
    fetchImpl:async()=>({ok:true,headers:{get:()=>new Date(now).toUTCString()},json:async()=>data})});
  assert.equal(r._meta.cachedAt,now);
  assert.ok(s.values.has('date'));
});
test('localStorage bloqueado não interrompe reprodução de dados',async()=>{
  const s={getItem(){throw new Error('bloqueado');},setItem(){throw new Error('bloqueado');}};
  const r=await fetchCachedJson('./test',{cacheKey:'blocked',storage:s,validate:valid,now:()=>now,
    fetchImpl:ok(data)});
  assert.equal(r.source,'network');
});
