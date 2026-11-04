/** QA ONLY: test 4-minute MANIFEST in temporary copy; no production changes. */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const vm=require('node:vm'),assert=require('node:assert/strict');
const child=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const original=fs.readFileSync(path.join(root,'player.js'),'utf8');
const markers={
 manifest:'    manifest: 120_000,',
 bundle:'  const QA_BUNDLE_MANIFEST_INTERVAL_MS = 120_000;',
 retry:'      if (status === 403) {',
};
for(const [k,marker] of Object.entries(markers))
 assert.equal(original.split(marker).length,2,'unexpected original invariant '+k);
const patch402=[
 '      if (status === 402) {',
 '        // Admin/quota restriction: retain cached playlist and queues.',
 '        backgroundPollState.failures = 0;',
 '        backgroundPollState.retryAt = performance.now() + 30 * 60_000 +',
 '          Math.floor(Math.random() * 60_000);',
 '      } else if (status === 403) {',
].join('\n');
const preview=original
 .replace(markers.manifest,'    manifest: 240_000,')
 .replace(markers.bundle,'  const QA_BUNDLE_MANIFEST_INTERVAL_MS = 240_000;')
 .replace(markers.retry,patch402);
const output=path.join(os.tmpdir(),'vision-v2-four-minute-candidate-'+process.pid+'.js');
fs.writeFileSync(output,preview);
child.execFileSync('node',['--check',output],{timeout:5000,stdio:'pipe'});
const part=(src,a,b)=>{
 const i=src.indexOf(a),j=src.indexOf(b,i);
 assert.ok(i>=0 && j>i,'source section missing '+a);
 return src.slice(i,j);
};
const env=vm.createContext({
  Math,Promise,Date,
  state:{deviceToken:'synthetic-local-only'},
  navigator:{onLine:true},
  performance:{now:()=>0},
  isAccessError:()=>false,
});
vm.runInContext(
 part(preview,'  const BACKGROUND_POLL_INTERVALS','  // Reject truncated')+
 part(preview,'  const backgroundPollState','  function replaceNodeChildren')+
 '\nthis.intervals=BACKGROUND_POLL_INTERVALS; this.bundleCycle=QA_BUNDLE_INTERVAL_MS; this.bundleManifest=QA_BUNDLE_MANIFEST_INTERVAL_MS; this.pollState=backgroundPollState; this.run=runBackgroundPoll; this.stagger=staggeredPollInterval;',
 env
);
const plain=x=>JSON.parse(JSON.stringify(x));
assert.deepEqual(plain(env.intervals),{heartbeat:60000,manifest:240000,commands:45000});
assert.equal(env.bundleManifest,240000);
assert.equal(env.bundleCycle,58000);
const maxPresenceWithJitter=env.intervals.heartbeat*1.15;
assert.ok(maxPresenceWithJitter<90000,'would mark TV offline in Master');
const sample=Array.from({length:100},()=>env.stagger(240000));
assert.ok(sample.every(ms=>ms>=204000 && ms<=276000),'manifest jitter mismatch');
const count=(tvs,hours,periodMinutes)=>Math.ceil(tvs*hours*60*30/periodMinutes);
async function run(){
 let now=1000;
 env.performance.now=()=>now;
 let calls=0;
 let release;
 const first=env.run(()=>new Promise(ok=>{calls++;release=ok}));
 const duplicate=await env.run(async()=>{calls++});
 assert.equal(duplicate,false,'concurrent poll was not suppressed');
 release();
 assert.equal(await first,true);
 assert.equal(calls,1);
 assert.equal(await env.run(async()=>{
  calls++;throw Object.assign(new Error('HTTP 402'),{status:402});
 }),false);
 const retry=env.pollState.retryAt;
 assert.ok(retry>=now+30*60000 && retry<now+31*60000);
 assert.equal(env.pollState.failures,0);
 assert.equal(env.state.deviceToken,'synthetic-local-only');
 assert.equal(await env.run(async()=>{calls++}),false);
 assert.equal(calls,2,'HTTP 402 repeated before cooldown');
 now=retry+1;
 assert.equal(await env.run(async()=>{calls++}),true,'no recovery after 402');
 assert.equal(calls,3);
 assert.equal(env.pollState.retryAt,0);
 assert.equal(await env.run(async()=>{
  calls++;throw Object.assign(new Error('403'),{status:403});
 }),false);
 assert.ok(env.pollState.retryAt>=now+5*60000,'403 accidentally changed');
 const use={};
 for(const hours of [12,16,24]) use[hours+'h']={
  integrated_58s_edge_calls:count(15,hours,58/60),
  manifest_4min_calls:count(15,hours,4),
  standalone_60s_heartbeat_calls:count(15,hours,1),
  command_45s_no_push_calls:count(15,hours,.75),
 };
 assert.ok(use['24h'].integrated_58s_edge_calls>500000);
 assert.ok(use['24h'].manifest_4min_calls<500000);
 const report={
  QA:'PASS_LOCAL_PREVIEW_ONLY',
  production_GO:false,
  original_player_unchanged:true,
  compiled_preview_only_in_CI_temp:true,
  manifest_ms:240000,
  bundle_manifest_ms:240000,
  heartbeat_ms:60000,
  commands_ms:45000,
  integrated_bundle_heartbeat_ms:58000,
  master_offline_threshold_ms:90000,
  HTTP402_min_cooldown_minutes:30,
  HTTP402_cooldown_test:'PASS',
  HTTP403_separate_cooldown_test:'PASS',
  single_flight_test:'PASS',
  manifest_jitter_test:'PASS',
  budget_15_TVs_30days:use,
  free_edge_quota:500000,
  quota_exceed_15_TVs_24h_if_integrated_bundle_every_58s:true,
  increased_manifest_interval_does_not_reduce_number_of_bundle_Edge_calls:true,
  cannot_fix_HTTP402_platform_restriction_by_changing_client_interval:true,
  actual_15TV_capacity_not_proven:true
 };
 fs.writeFileSync('qa-v2-4min-manifest-budget.json',JSON.stringify(report,null,2));
 console.log('QA_4MIN_MANIFEST_JSON='+JSON.stringify(report));
}
run().catch(e=>{console.error(e);process.exitCode=1});
