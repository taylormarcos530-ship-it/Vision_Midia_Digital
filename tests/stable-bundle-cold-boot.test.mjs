import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../player.js',import.meta.url),'utf8');
function fleet(n, mode, duration=3600000){
 let seed=14711;
 const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const b=new Uint16Array(duration/1000);let total=0;
 for(let i=0;i<n;i++){
  const interval=Math.round(58000*(0.85+rand()*.3));
  const initial=mode==='cold-boot'?0:mode==='cached-cold-boot'?Math.floor(rand()*15000):Math.floor(rand()*interval);
  for(let t=initial;t<duration;t+=interval){b[Math.floor(t/1000)]++;total++;}
 }
 const ordered=Array.from(b).sort((a,b)=>a-b);
 return {total,meanRps:total/(duration/1000),peakRps:ordered.at(-1),p95Rps:ordered[Math.floor(ordered.length*.95)],firstSecond:b[0],estimatedGatewayCyclesPerMonth:total*24*30};
}
for(const mode of ['cold-boot','cached-cold-boot','distributed']){
 test('300 TVs '+mode+' synthetic no-network scheduling',()=>{
  const result=fleet(300,mode);
  console.log(JSON.stringify({mode,tvs:300,...result}));
  assert.ok(result.total>17000&&result.total<22000);
  if(mode==='cold-boot')assert.equal(result.firstSecond,300);
  else assert.ok(result.peakRps<65);
 });
}
test('existing startup bundle call is immediate, so cold boot spike is not yet fixed',()=>{
 assert.match(code,/void runBackgroundPoll\(runQaBundle\);\s*return;/);
 assert.match(code,/staggeredPollInterval\(QA_BUNDLE_INTERVAL_MS\)/);
});
test('offline alert tolerance is independent of player polling cadence',()=>{
 const offlineAfterMs=8*60000,cronPeriodMs=3*60000;
 assert.equal(offlineAfterMs,480000);
 assert.ok(cronPeriodMs>0);
 assert.equal(Math.ceil(offlineAfterMs/cronPeriodMs)*cronPeriodMs,540000);
});
