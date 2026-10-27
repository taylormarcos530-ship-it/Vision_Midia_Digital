const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('player.js','utf8');
const from=source.indexOf('  const TRAFFIC_ACTIONS = new Set(');
const to=source.indexOf('  function playbackQueue()',from);
assert.ok(from>0 && to>from,'Traffic telemetry must be defined before queueing playback');

function harness(authorized=true,failStorage=false){
  const storage=new Map();
  const context=vm.createContext({
    state:{deviceToken:authorized?'test-device-token':null},
    Set,Number,Object,Date,String,
    readJson(key){return storage.has(key)?JSON.parse(JSON.stringify(storage.get(key))):null},
    writeJson(key,value){if(failStorage)throw new Error('quota exceeded');storage.set(key,JSON.parse(JSON.stringify(value)))},
    REQUEST_METRICS_KEY:'metrics',
  });
  vm.runInContext(source.slice(from,to),context);
  return {context,storage};
}
function plain(o){return JSON.parse(JSON.stringify(o))}
test('counts device-gateway and monitoring attempts by bounded action',()=>{
  const h=harness();
  h.context.countRequestAttempt('device-gateway','manifest');
  h.context.countRequestAttempt('device-gateway','commands');
  h.context.countRequestAttempt('device-gateway','playback_batch');
  h.context.countRequestAttempt('device-monitoring','heartbeat');
  h.context.countRequestAttempt('device-monitoring','heartbeat');
  h.context.countRequestAttempt('device-gateway','dangerous--unknown-action');
  h.context.countRequestAttempt('made-up-route','heartbeat');
  assert.deepEqual(plain(h.context.requestMetricsSnapshot().counts),{
    'device-gateway.manifest':1,
    'device-gateway.commands':1,
    'device-gateway.playback_batch':1,
    'device-monitoring.heartbeat':2,
    'device-gateway.other':1
  });
});
test('per-TV counters survive JS context restart without extra HTTP calls',()=>{
  const h=harness();h.context.countRequestAttempt('device-gateway','commands');
  const first=plain(h.context.requestMetricsSnapshot());
  const h2=harness();h2.storage.set('metrics',first);
  h2.context.countRequestAttempt('device-gateway','commands');
  assert.equal(h2.context.requestMetricsSnapshot().counts['device-gateway.commands'],2);
  assert.equal(h2.context.requestMetricsSnapshot().started_at,first.started_at);
});
test('unauthorized/unpaired app never stores request measurements',()=>{
  const h=harness(false);
  h.context.countRequestAttempt('device-gateway','manifest');
  assert.equal(h.storage.has('metrics'),false);
});
test('optional telemetry failures never interrupt Player',()=>{
  const h=harness(true,true);
  assert.doesNotThrow(()=>h.context.countRequestAttempt('device-gateway','manifest'));
});
test('malformed metrics are sanitized and only whitelisted action keys are emitted',()=>{
  const h=harness();
  h.storage.set('metrics',{
    version:1,started_at:'2026-10-27T12:00:00.000Z',
    counts:{'device-gateway.commands':4,'device-gateway.manifest':-99,'extraneous.secret':'sensitive','device-monitoring.heartbeat':'not-a-number'}
  });
  assert.deepEqual(plain(h.context.requestMetricsSnapshot().counts),{'device-gateway.commands':4});
});
test('existing heartbeat carries traffic measurement without another request',()=>{
  assert.match(source,/async function heartbeat\(\)\s*\{[\s\S]*?await monitorGateway\(\{\s*action: 'heartbeat'/);
  assert.match(source,/details:\s*\{[\s\S]*?request_metrics: requestMetricsSnapshot\(\)/);
  assert.match(source,/async function gateway\(body\)\s*\{\s*countRequestAttempt\('device-gateway', body\?\.action\)/);
  assert.match(source,/async function monitorGateway\(body\)\s*\{\s*countRequestAttempt\('device-monitoring', body\?\.action\)/);
  assert.match(source,/localStorage\.removeItem\(REQUEST_METRICS_KEY\)/);
});
