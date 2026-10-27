const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const player = fs.readFileSync('player.js','utf8');
function slice(start, end) {
  const a = player.indexOf(start), b = player.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'section missing: ' + start);
  return player.slice(a, b);
}

function queueHarness() {
  const storage = new Map();
  const seen = {playback:[], monitor:[]};
  let playbackSender = async() => ({ok:true});
  let monitorSender = async() => ({ok:true});
  const context = vm.createContext({
    state:{deviceToken:'device-token',lastEventTimes:{}},
    navigator:{onLine:true},
    PLAYBACK_QUEUE_KEY:'proof',
    DEVICE_EVENT_QUEUE_KEY:'monitoring',
    readJson(key) { return storage.has(key) ? JSON.parse(JSON.stringify(storage.get(key))) : null; },
    writeJson(key,value) { if (value === null) storage.delete(key); else storage.set(key,JSON.parse(JSON.stringify(value))); },
    gateway: async (payload) => {seen.playback.push(JSON.parse(JSON.stringify(payload))); return playbackSender(payload)},
    monitorGateway: async (payload) => {seen.monitor.push(JSON.parse(JSON.stringify(payload))); return monitorSender(payload)},
    clientId: ()=> 'generated-test-id',
    Date, Math, Set, Promise,
  });
  // Include the two existing queue implementations; the platform networking
  // code and actual network are deliberately NOT used.
  vm.runInContext(slice('  function playbackQueue()', '  async function parseResponse('), context);
  return {
    context,storage,seen,
    setPlaybackSender(x) {playbackSender = x},
    setMonitorSender(x) {monitorSender = x},
    pushPlayback(id) {context.queuePlayback({client_event_id:id})},
    pushMonitoring(id) {
      const current=context.deviceEventQueue();
      current.push({client_event_id:id});
      context.writeJson('monitoring',current);
    },
    playbackIds() {return Array.from(context.playbackQueue()||[], x=>String(x.client_event_id))},
    monitorIds() {return Array.from(context.deviceEventQueue()||[], x=>String(x.client_event_id))},
  };
}

test('playback concurrent submissions are single-flight, and new events are retained', async()=>{
  const h=queueHarness();
  h.pushPlayback('one');h.pushPlayback('two');
  let release;
  h.setPlaybackSender(()=>new Promise(r=>{release=r}));
  const first=h.context.flushPlaybackQueue();
  const second=h.context.flushPlaybackQueue();
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.seen.playback.length,1);
  h.pushPlayback('arrived-during-upload');
  h.setPlaybackSender(async()=>({ok:true}));
  release({ok:true});
  await Promise.all([first,second]);
  assert.deepEqual(h.seen.playback.map(x=>x.events.map(y=>y.client_event_id)),[['one','two'],['arrived-during-upload']]);
  assert.deepEqual(h.playbackIds(),[]);
});

test('failed playback POST retains queued records and retries without dropping proof',async()=>{
  const h=queueHarness();
  h.pushPlayback('a');h.pushPlayback('b');
  h.setPlaybackSender(async()=>{throw Object.assign(new Error('gateway 504'),{status:504})});
  await assert.rejects(h.context.flushPlaybackQueue(),/gateway 504/);
  assert.deepEqual(h.playbackIds(),['a','b']);
  h.setPlaybackSender(async()=>({ok:true}));
  await h.context.flushPlaybackQueue();
  assert.deepEqual(h.playbackIds(),[]);
  assert.equal(h.seen.playback.length,2);
});

test('monitoring event uploader deduplicates in-flight calls and retains arrivals',async()=>{
  const h=queueHarness();
  h.pushMonitoring('first');
  let release;
  h.setMonitorSender(()=>new Promise(r=>{release=r}));
  const a=h.context.flushDeviceEventQueue();
  const b=h.context.flushDeviceEventQueue();
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.seen.monitor.length,1);
  h.pushMonitoring('later');
  h.setMonitorSender(async()=>({ok:true}));
  release({ok:true});
  await Promise.all([a,b]);
  assert.deepEqual(h.seen.monitor.map(x=>x.events.map(y=>y.client_event_id)),[['first'],['later']]);
  assert.deepEqual(h.monitorIds(),[]);
});

test('monitoring failures never discard pending events',async()=>{
  const h=queueHarness();
  h.pushMonitoring('only');
  h.setMonitorSender(async()=>{throw new Error('temporarily offline')});
  await assert.rejects(h.context.flushDeviceEventQueue(),/temporarily offline/);
  assert.deepEqual(h.monitorIds(),['only']);
});

test('offline and unpaired TV cannot flush proof or monitoring',async()=>{
  const h=queueHarness();
  h.pushPlayback('offline');h.pushMonitoring('offline');
  h.context.navigator.onLine=false;
  await Promise.all([h.context.flushPlaybackQueue(),h.context.flushDeviceEventQueue()]);
  assert.deepEqual(h.playbackIds(),['offline']);
  assert.deepEqual(h.monitorIds(),['offline']);
  h.context.navigator.onLine=true;
  h.context.state.deviceToken=null;
  await Promise.all([h.context.flushPlaybackQueue(),h.context.flushDeviceEventQueue()]);
  assert.equal(h.seen.playback.length,0);
  assert.equal(h.seen.monitor.length,0);
});

test('periodic requests are staggered within safe jitter bounds',()=>{
  const code=slice('  const BACKGROUND_POLL_INTERVALS', '  // Reject truncated');
  const m=vm.createContext({Math});
  vm.runInContext(code+'\nthis.readIntervals = () => BACKGROUND_POLL_INTERVALS; this.jitter = staggeredPollInterval',m);
  const intervals=m.readIntervals();
  assert.equal(intervals.commands,45000);
  assert.equal(intervals.manifest,120000);
  assert.equal(intervals.heartbeat,120000);
  const samples=Array.from({length:200},()=>m.jitter(intervals.commands));
  assert.ok(samples.every(x=>x>=38250&&x<=51750));
  assert.ok(new Set(samples).size>5);
  assert.match(player,/staggeredPollInterval\(BACKGROUND_POLL_INTERVALS\.heartbeat\)/);
  assert.match(player,/staggeredPollInterval\(BACKGROUND_POLL_INTERVALS\.manifest\)/);
  assert.match(player,/staggeredPollInterval\(BACKGROUND_POLL_INTERVALS\.commands\)/);
  assert.match(player,/state\.accessTimer = setInterval\(\(\) => enforceLocalAccess\(\), 1000\)/);
});
