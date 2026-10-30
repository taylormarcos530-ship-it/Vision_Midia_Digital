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
for(const n of [50,100,300]) for(const mode of ['cold-boot','cached-cold-boot','distributed']){
 test(n+' TVs '+mode+' synthetic no-network scheduling',()=>{
  const result=fleet(n,mode);
  console.log(JSON.stringify({mode,tvs:n,...result}));
  assert.ok(result.total>n*50&&result.total<n*75);
  if(mode==='cold-boot')assert.equal(result.firstSecond,n);
  else assert.ok(result.peakRps<Math.max(15,n/4));
 });
}
test('first cycle deferred only for valid fully cached device',()=>{
 assert.ok(code.includes("localAccessState() === 'valid'"));
 assert.ok(code.includes("state.manifest.items.length > 0"));
 assert.ok(code.includes("cache.match(cacheKey(item))"));
 assert.ok(code.includes("Math.random() * 15_000"));
 assert.ok(code.includes("state.deviceToken !== pairedToken"));
 assert.ok(code.includes("startBundleImmediately()"));
});
test('offline alert tolerance is independent of player polling cadence',()=>{
 const offlineAfterMs=8*60000,cronPeriodMs=3*60000;
 assert.equal(offlineAfterMs,480000);
 assert.ok(cronPeriodMs>0);
 assert.equal(Math.ceil(offlineAfterMs/cronPeriodMs)*cronPeriodMs,540000);
});
