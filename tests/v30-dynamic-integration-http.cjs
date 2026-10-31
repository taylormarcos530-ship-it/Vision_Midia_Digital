'use strict';
const assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
assert.match(process.env.API_URL||'',/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/);
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'54322');
const device='10000000-0000-4000-8000-000000000001';
const token=randomBytes(35).toString('hex');
const q=x=>"'"+String(x).replace(/'/g,"''")+"'";
const pg=s=>execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-Atq','-c',s],{encoding:'utf8',timeout:25000}).trim();
const count=id=>Number(pg('SELECT count(*) FROM public.playback_logs WHERE device_id='+q(device)+' AND client_event_id='+q(id)));
const proof=id=>({client_event_id:id,started_at:'2026-10-31T10:00:00Z',completed:true});
async function cycle(proofs,events=[]){
 const r=await fetch(process.env.API_URL+'/functions/v1/device-bundle-stable',{method:'POST',headers:{
 apikey:process.env.ANON_KEY,'content-type':'application/json','x-device-token':token,'user-agent':'VisionPlayerAndroid/1.5.24-stable'},
 body:JSON.stringify({action:'cycle',heartbeat:{action:'heartbeat',app_version:'1.5.24-stable'},proofs,events})});
 return {status:r.status,data:await r.json()};
}
async function main(){
 pg('INSERT INTO public.device_credentials(device_id,token_hash) VALUES ('+q(device)+','+q(createHash('sha256').update(token).digest('hex'))+')');
 const good='qa-t01-good',bad={client_event_id:'',started_at:'invalid'};
 const mixed=await cycle([proof(good),bad]);
 assert.equal(count(good),0,'T01: mixed invalid batch must not partially write valid proof; response='+JSON.stringify(mixed));
 assert.ok(mixed.status>=400||mixed.data.proofs?.ok===false,'T01: invalid mixed batch must be rejected');
 console.log('PASS_T01 mixed batch atomic no partial write');
 const a='qa-t02-proof';
 const partial=await cycle([proof(a)],[{event_type:'invalid-qa-event',timestamp:'invalid'}]);
 assert.equal(partial.status,200);
 assert.equal(partial.data.proofs?.ok,true,'T02 proof subaction should succeed');
 assert.equal(partial.data.proofs?.data?.accepted,1);
 assert.equal(partial.data.events?.ok,false,'T02 invalid events must fail independently');
 assert.equal(count(a),1);
 console.log('PASS_T02 independent partial proof/event ACK');
 const id='qa-t03-lost-ack';
 const first=await cycle([proof(id)]);
 assert.equal(first.data.proofs?.ok,true);
 assert.equal(count(id),1);
 // Simulate lost client response: do not consume first response; retry identical proof.
 const again=await cycle([proof(id)]);
 assert.equal(again.data.proofs?.ok,true,'T03 duplicate retry must ACK');
 assert.equal(count(id),1,'T03 retry must not create duplicate');
 console.log('PASS_T03 lost ACK retry idempotent');
}
main().catch(e=>{console.error('FAIL_T_DYNAMIC',e.stack||e.message);process.exitCode=1});
