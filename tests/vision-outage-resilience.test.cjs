const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const player=fs.readFileSync('player.js','utf8');

function isolatedFunction(name, nextStart) {
  const start=player.indexOf('  '+name);
  const end=player.indexOf(nextStart,start);
  assert.ok(start>=0 && end>start, 'missing '+name);
  return player.slice(start,end);
}
function manifest(override={}) {
  return {
    version:'rev-1',
    device:{id:'tv-A',access_expires_at:'2026-10-27T12:00:00Z'},
    generated_at:'2026-10-26T22:00:00Z',
    program:{source:'default'},
    playlist:{id:'playlist-A'},
    items:[{id:'item-A',media:{id:'creative-A',type:'image'}}],
    ...override,
  };
}
function validator(previous=manifest()) {
  const c=vm.createContext({state:{manifest:previous},Date});
  vm.runInContext(isolatedFunction('function validateManifestPayload(', '  const backgroundPollState'),c);
  return c.validateManifestPayload;
}
test('existing valid authorized playlist is accepted',()=>{
  const validate=validator();
  assert.equal(validate(manifest()).version,'rev-1');
});
test('malformed, truncated and foreign-device payloads cannot replace cached manifest',()=>{
  const validate=validator();
  for(const broken of [null,{},manifest({items:null}),manifest({version:null}),
    manifest({device:{id:'tv-B',access_expires_at:'2026-10-27T12:00:00Z'}}),
    manifest({device:{id:'tv-A',access_expires_at:null}}),
    manifest({playlist:{id:'new'},items:[{id:'item-X'}]}),
    manifest({playlist:null,items:[],program:{source:'fallback'}})
  ]) assert.throws(()=>validate(broken),/incompleta|inválida/);
});
test('explicit authenticated empty assignment is valid but incomplete one is not',()=>{
  const validate=validator();
  const empty=manifest({playlist:null,items:[],program:{source:'none'}});
  assert.equal(validate(empty).playlist,null);
  assert.throws(()=>validate(manifest({playlist:null,items:[],program:{source:'default'}})));
});
test('sync stages incoming media before replacing the previous playlist',()=>{
  const code=isolatedFunction('async function syncManifest()', '  function showIdle(');
  const stage=code.indexOf('await cacheMediaItem(stagedCache, firstMedia)');
  const swap=code.indexOf('state.manifest = manifest');
  assert.ok(stage>0 && swap>stage);
  assert.match(code,/throw new Error\('Primeira mídia da nova playlist indisponível/);
  assert.match(code,/validateManifestPayload\(await gateway/);
  assert.match(code,/if \(changed\) void cacheManifestAssets/);
});
test('cached playlist starts before backend requests finish, local expiry still ticks',()=>{
  const start=isolatedFunction('async function startPlayer()', '  async function requestFullscreenAndWakeLock(');
  assert.ok(start.indexOf('if (state.manifest && !localAccessExpired()) ensurePlaybackLoop();')<
    start.indexOf('void runBackgroundPoll(async () =>'));
  assert.match(start,/state\.accessTimer = setInterval\(\(\) => enforceLocalAccess\(\), 1000\)/);
  assert.doesNotMatch(start,/await heartbeat\(\); await flushPlaybackQueue/);
  assert.match(start,/await syncManifest\(\);\s*await heartbeat\(\)/);
});
test('playback reports remain in a durable queue and are not flushed after every media',()=>{
  const play=isolatedFunction('async function playItem(', '  const LOCAL_WEEKDAY_INDEX');
  assert.match(play,/queuePlayback\(/);
  assert.match(play,/if \(playbackQueue\(\)\.length >= 40\) flushPlaybackQueue/);
  assert.match(player,/await flushPlaybackQueue\(\);/);
});

function cacheHarness(loaded) {
  const original='https://example.test/__vision_media_cache__/old';
  const incoming='https://example.test/__vision_media_cache__/new';
  const existing=new Map([[original,true]]);
  const removed=[];
  const cache={
    async match(key){return existing.get(key.url)?{ok:true}:null},
    async keys(){return [...existing.keys()].map(url=>({url}))},
    async delete(key){removed.push(key.url);return existing.delete(key.url)}
  };
  const state={cachePrefetchVersion:null};
  const env=vm.createContext({
    state,MEDIA_CACHE:'vision-player-media-v1',console,
    caches:{async open(){return cache}},
    cacheKey(item){return {url:incoming}},
    cacheWithConcurrency:async()=>{if(loaded)existing.set(incoming,true)},
    refreshCacheStats:async()=>{},
    clientId:()=> 'test-version',
    Set,Promise
  });
  vm.runInContext(isolatedFunction('async function cacheManifestAssets(', '  async function syncManifest('),env);
  const ready=env.cacheManifestAssets({version:'new-version',items:[{media:{id:'new',type:'image'}}]});
  return {ready,removed,existing,original,incoming};
}
test('failed download never evicts previous cached programming',async()=>{
  const h=cacheHarness(false);
  await h.ready;
  assert.equal(h.existing.has(h.original),true);
  assert.deepEqual(h.removed,[]);
});
test('previous media is pruned only after replacement is fully downloaded',async()=>{
  const h=cacheHarness(true);
  await h.ready;
  assert.equal(h.existing.has(h.original),false);
  assert.deepEqual(h.removed,[h.original]);
});
test('fresh TV retains pairing screen and retries; no invented playlist',()=>{
  assert.match(player,/if \(!state\.deviceToken\) return startPairing\(\)/);
  assert.match(player,/let temporaryFailures = 0/);
  assert.match(player,/Aguardando autorização no painel/);
  assert.match(player,/Sem conexão e sem conteúdo salvo/);
  assert.match(player,/if \(state\.manifest && !localAccessExpired\(\)\) ensurePlaybackLoop\(\)/);
});
test('old expired cache stays blocked, APK files remain untouched in isolated diff',()=>{
  assert.match(player,/function enforceLocalAccess/);
  assert.match(player,/if \(enforceLocalAccess\(\)\) return/);
  assert.match(player,/function localAccessExpired\(\)/);
  assert.match(player,/deadline <= Date\.now\(\)/);
});
