'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Modelo teorico 24h/dia, 30 dias e 15s por reproducao; NAO e telemetria real.
// sync/heartbeat e playback_batch ainda sao requisicoes separadas na API QA.
// Projecao nao inclui consultas de admin, retries, logs extras, overhead de rede,
// outros projetos da mesma organizacao e custos de CPU/I/O/armazenamento.
const DAY = 24 * 60;
const DAYS = 30;
const FREE = 500_000;
const PRO = 2_000_000;
const MARGIN = 0.70;
function forecast(tvs, pollMinutes, durationSeconds = 15, batchSize = 50) {
  const perTvPoll = Math.ceil(DAY * DAYS / pollMinutes);
  const perTvEvents = Math.ceil(DAY * 60 * DAYS / durationSeconds);
  const perTvFlush = Math.ceil(perTvEvents / batchSize);
  return { tvs, pollMinutes, requests: tvs * (perTvPoll + perTvFlush),
    events: tvs * perTvEvents, requestsPerTv: perTvPoll + perTvFlush,
    eventRowsPerTv: perTvEvents };
}
function withinTarget(m, quota) { return m.requests <= Math.floor(quota * MARGIN); }

test('12 TVs with 1-minute polling exceed Free 30 percent safety margin', () => {
  const currentRisk = forecast(12,1);
  assert.ok(currentRisk.requests > FREE * MARGIN);
  assert.equal(currentRisk.requests, 559872);
});
test('Free budget: 12 TVs every 5 minutes can fit model, not counting shared organization usage', () => {
  const plan = forecast(12,5);
  assert.equal(plan.requests,145152);
  assert.equal(withinTarget(plan,FREE),true);
});
test('100 TVs every 2 minutes exceed Pro budget margin', () => {
  const plan = forecast(100,2);
  assert.equal(plan.requests,2505600);
  assert.equal(withinTarget(plan,PRO),false);
});
test('100 TVs every 5 minutes fit only invocation model; storage gate must remain blocked', () => {
  const plan = forecast(100,5);
  assert.equal(plan.requests,1209600);
  assert.equal(withinTarget(plan,PRO),true);
  assert.equal(plan.events,17_280_000);
});
test('Ledger QA accumulates one unique ID per playback: retention MUST be designed first', () => {
  const sql = fs.readFileSync(path.join(__dirname,'../docs/vision-v2/qa-foundation.sql'),'utf8');
  const rpc = fs.readFileSync(path.join(__dirname,'../docs/vision-v2/qa-device-api.sql'),'utf8');
  assert.match(sql,/create table if not exists vision_v2_qa.playback_event_keys/i);
  assert.match(rpc,/insert into vision_v2_qa.playback_event_keys/i);
  assert.doesNotMatch(sql + rpc,/create\s+trigger[\s\S]*delete\s+from\s+vision_v2_qa.playback_event_keys/i);
  // QA sem politicas de compactacao validada NAO pode ser declarada pronta.
  const liveReady = false;
  assert.equal(liveReady,false);
});
test('V2 source references only isolated QA project; no production, secrets, deletion or automation', () => {
  const source = fs.readFileSync(path.join(__dirname,'../supabase/functions/vision-v2-qa-device/index.ts'),'utf8');
  const sql = fs.readFileSync(path.join(__dirname,'../docs/vision-v2/qa-device-api.sql'),'utf8');
  const foundation = fs.readFileSync(path.join(__dirname,'../docs/vision-v2/qa-foundation.sql'),'utf8');
  assert.match(source,/yuwvgpvwgeowhgtxssvr/);
  assert.doesNotMatch(source+sql+foundation,/fpadgedrgcxrrqflzhjt|vision-midia-digital\.vercel\.app/);
  assert.doesNotMatch(source+sql+foundation,/\b(drop\s+table|truncate\s+table|delete\s+from|create\s+(?:or\s+replace\s+)?trigger|create\s+extension)\b/i);
  assert.match(sql,/from public,anon,authenticated;/i);
  assert.match(sql,/to service_role;/i);
});
