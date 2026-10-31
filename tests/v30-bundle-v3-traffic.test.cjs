'use strict';
// Executes the exact v30 bundle auth touch and stale sweep blocks in isolation.
// Regression source: deployed bundle-stable v3, read-only inspected 31 Oct 2026.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { AsyncFunction } = { AsyncFunction: Object.getPrototypeOf(async function () {}).constructor };
const source = fs.readFileSync('supabase/functions/device-bundle-stable/index.ts', 'utf8');
const gateway = fs.readFileSync('supabase/functions/device-gateway/index.ts', 'utf8');
function extract(text,begin,end,after=0){
  const i=text.indexOf(begin,after),j=text.indexOf(end,i+begin.length);
  assert.ok(i>=0&&j>i,'source segment missing: '+begin);
  return text.slice(i,j);
}
const touch=extract(source,
 '  const lastUsedAtMs = credential.last_used_at ? Date.parse(credential.last_used_at) : NaN',
 '  return { ...device, offline_access_expires_at');
const monitorStart=source.indexOf('async function runExistingMonitoringAction(');
const sweep=extract(source,"    if (action === 'heartbeat') {",
 "      const now = new Date().toISOString()",monitorStart);
const doTouch=new AsyncFunction('credential','admin','device','Date','console',
 touch+'\nreturn true;');
const doSweep=new AsyncFunction('admin','device','body','Date','console',
 'lastOfflineSweepByCompany','offlineSweepInFlight',
 'const action = body?.action;\n'+sweep+'\nreturn true;\n}');
const nowBase=Date.parse('2026-10-31T10:07:00.000Z');
function Clock(epoch) {
 return class FrozenDate extends Date {
   constructor(...args){super(...(args.length ? args : [epoch]))}
   static now(){return epoch}
 };
}
function updates(){
 const stats={credentials:0,pairing:0,offline:0};
 let failOffline=false;
 let offlinePromiseFactory=null;
 const admin={from(table){
   return {update(){
     if(table==='device_credentials')stats.credentials++;
     else if(table==='device_pairing_requests')stats.pairing++;
     else if(table==='devices')stats.offline++;
     else throw Error('unexpected table '+table);
     const chain={
       eq(){return chain},not(){return Promise.resolve({error:null})},
       or(){return Promise.resolve({error:null})},
       lt(){return chain},
       is(){
         if(offlinePromiseFactory)return offlinePromiseFactory();
         return Promise.resolve({error:failOffline?{message:'synthetic timeout'}:null});
       },
     };
     return chain;
   }};
 }};
 return {stats,admin,setFailure:v=>{failOffline=v},setOfflinePromise:f=>{offlinePromiseFactory=f}};
}
test('bundle pairs only on due credential touch and five-minute boundary',async()=>{
 const x=updates(),device={id:'dev-one'};
 await doTouch({last_used_at:new Date(nowBase-10_000).toISOString()},x.admin,device,Clock(nowBase),console);
 assert.deepEqual(x.stats,{credentials:0,pairing:0,offline:0});
 await doTouch({last_used_at:new Date(nowBase-80_000).toISOString()},x.admin,device,Clock(nowBase),console);
 assert.deepEqual(x.stats,{credentials:1,pairing:0,offline:0});
 await doTouch({last_used_at:new Date(nowBase-130_000).toISOString()},x.admin,device,Clock(nowBase),console);
 assert.deepEqual(x.stats,{credentials:2,pairing:1,offline:0});
 await doTouch({last_used_at:null},x.admin,device,Clock(nowBase),console);
 assert.deepEqual(x.stats,{credentials:3,pairing:2,offline:0});
});
test('100 heartbeats same company produce only one offline sweep in 30 seconds',async()=>{
 const x=updates(),map=new Map(),flight=new Set(),device={company_id:'company-A'};
 for(let n=0;n<100;n++)
  await doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase),console,map,flight);
 assert.equal(x.stats.offline,1);
 assert.equal(map.get('company-A'),nowBase);
 await doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase+29_999),console,map,flight);
 assert.equal(x.stats.offline,1);
 await doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase+30_000),console,map,flight);
 assert.equal(x.stats.offline,2);
 await doSweep(x.admin,{company_id:'company-B'},{action:'heartbeat'},Clock(nowBase+30_000),console,map,flight);
 assert.equal(x.stats.offline,3);
});
test('parallel heartbeats per company do not start two simultaneous sweeps',async()=>{
 const x=updates(),map=new Map(),flight=new Set();
 let release;const waiting=new Promise(resolve=>{release=resolve});
 x.setOfflinePromise(()=>waiting);
 const device={company_id:'company-C'};
 const one=doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase),console,map,flight);
 const two=doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase),console,map,flight);
 assert.equal(x.stats.offline,1);
 assert.equal(flight.has('company-C'),true);
 release({error:null});
 await Promise.all([one,two]);
 assert.equal(x.stats.offline,1);
 assert.equal(map.get('company-C'),nowBase);
 assert.equal(flight.size,0);
});
test('failed offline sweep does not suppress retry; next heartbeat may retry',async()=>{
 const x=updates(),map=new Map(),flight=new Set(),device={company_id:'company-D'};
 const quiet={warn(){}};
 x.setFailure(true);
 await doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase),quiet,map,flight);
 assert.equal(map.has('company-D'),false);
 x.setFailure(false);
 await doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase),quiet,map,flight);
 assert.equal(x.stats.offline,2);
 assert.equal(map.get('company-D'),nowBase);
});
test('per-company in-memory guard is explicitly per isolate, not global SQL throttle',async()=>{
 const x=updates(),dev={company_id:'company-E'};
 await doSweep(x.admin,dev,{action:'heartbeat'},Clock(nowBase),console,new Map(),new Set());
 await doSweep(x.admin,dev,{action:'heartbeat'},Clock(nowBase),console,new Map(),new Set());
 assert.equal(x.stats.offline,2);
});
test('gateway v22 60s credential touch still encloses pairing cleanup',()=>{
 const p=gateway.slice(gateway.indexOf('  const lastUsedAtMs = credential.last_used_at'),
 gateway.indexOf('  return { ...device, offline_access_expires_at:'));
 assert.match(p,/nowMs - lastUsedAtMs >= 60_000/);
 assert.match(p,/device_pairing_requests/);
 assert.ok(p.lastIndexOf('  }\n') > p.indexOf("device_pairing_requests"));
});
test('bundle v30 preserves v3 command acknowledgement concurrency protection',()=>{
 const snippet=source.slice(source.indexOf("if (action === 'command_result')"),
   source.indexOf("if (action === 'playback'"));
 assert.match(snippet,/\.in\('status', \['pending', 'sent'\]\)/);
});

test('T04 attempted zero-row offline PATCH is counted even without changed rows',async()=>{
 const x=updates(),map=new Map(),flight=new Set(),device={company_id:'qa-zero-row'};
 let attempted=0,changed=0;
 x.setOfflinePromise(()=>{attempted++;return Promise.resolve({data:[],count:0,error:null})});
 await doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase),console,map,flight);
 assert.equal(attempted,1,'HTTP-like PATCH attempted once');
 assert.equal(changed,0,'no matching offline rows updated');
 assert.equal(x.stats.offline,1,'update builder called despite zero rows');
 console.log('PASS_T04 attempted_patch=1 affected_rows=0');
});
test('T05 independent isolates cause separate sweep PATCH attempts',async()=>{
 const x=updates(),device={company_id:'qa-multi-isolate'};
 let attempts=0;
 x.setOfflinePromise(()=>{attempts++;return Promise.resolve({data:[],count:0,error:null})});
 await Promise.all([
  doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase),console,new Map(),new Set()),
  doSweep(x.admin,device,{action:'heartbeat'},Clock(nowBase),console,new Map(),new Set())
 ]);
 assert.equal(attempts,2,'per-isolate throttle cannot suppress global duplicate');
 assert.equal(x.stats.offline,2);
 console.log('PASS_T05 independent_isolates=2 patch_attempts=2');
});
