import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const client=readFileSync(new URL('../player.js',import.meta.url),'utf8');
const backend=readFileSync(new URL('../supabase/functions/device-bundle-stable/index.ts',import.meta.url),'utf8');
const MINUTE=60000;
function makeTv({period=58000,online=true}={}){
 let now=0,next=0,lastSeen=0,requests=0,commands=[],cached=['ad-1'],ack=[];
 return {
  setOnline(v){online=v;},
  enqueueCommand(c){commands.push(c);},
  step(to){while(next<=to){now=next;if(online){requests++;lastSeen=now;ack.push(...commands.splice(0));}next+=period;}now=to;},
  get snapshot(){return {now,lastSeen,requests,ack:[...ack],cached:[...cached],offline:now-lastSeen>8*MINUTE};}
 };
}
test('network outage preserves cached media and queues commands until reconnection',()=>{
 const tv=makeTv();tv.step(58000);const initial=tv.snapshot.requests;
 tv.setOnline(false);tv.enqueueCommand('screenshot-1');tv.step(9*MINUTE);
 assert.equal(tv.snapshot.requests,initial);assert.deepEqual(tv.snapshot.cached,['ad-1']);
 assert.deepEqual(tv.snapshot.ack,[]);assert.equal(tv.snapshot.offline,true);
 tv.setOnline(true);tv.step(10*MINUTE);
 assert.ok(tv.snapshot.requests>initial);assert.deepEqual(tv.snapshot.ack,['screenshot-1']);
 assert.equal(tv.snapshot.offline,false);
});
test('offline threshold strictly greater than eight minutes',()=>{
 const tv=makeTv();tv.step(0);tv.setOnline(false);tv.step(8*MINUTE);
 assert.equal(tv.snapshot.offline,false);
 tv.step(8*MINUTE+1);assert.equal(tv.snapshot.offline,true);
});
test('source keeps real offline and command safety gates',()=>{
 assert.match(client,/backgroundPollState\.inFlight/);
 assert.match(client,/!navigator\.onLine/);
 assert.match(client,/response\?\.device_id !== state\.manifest\?\.device\?\.id/);
 assert.match(client,/pollDeviceCommands\(response\.commands/);
 assert.match(backend,/response\.commands = await unwrapAction/);
 assert.match(backend,/response\.heartbeat = await unwrapAction/);
});
function fleet(n){
 let seed=1979;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const buckets=new Uint16Array(3600);let calls=0;
 for(let i=0;i<n;i++){
  const interval=Math.round(58000*(0.85+rand()*0.30));
  const offset=Math.floor(rand()*interval);
  for(let t=offset;t<3600000;t+=interval){buckets[Math.floor(t/1000)]++;calls++;}
 }
 const sorted=Array.from(buckets).sort((a,b)=>a-b);
 return {calls,averagePerSecond:calls/3600,peakPerSecond:sorted.at(-1),p95PerSecond:sorted[Math.floor(sorted.length*.95)]};
}
for(const n of [50,100,300])test('offline 1-hour bundle scheduling simulation '+n+' TVs',()=>{
 const s=fleet(n);console.log(JSON.stringify({tvs:n,...s}));
 assert.ok(s.calls>n*50 && s.calls<n*75);
 assert.ok(s.peakPerSecond<n/3);
});
