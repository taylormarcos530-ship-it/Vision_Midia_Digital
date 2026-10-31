'use strict';
const assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const api=process.env.API_URL||'',anon=process.env.ANON_KEY;
assert.match(api,/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/);
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'54322');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',TA='10000000-0000-4000-8000-000000000001';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',TB='10000000-0000-4000-8000-000000000002';
const CMD='40000000-0000-4000-8000-000000000001',CROSS='40000000-0000-4000-8000-000000000002';
const token=randomBytes(35).toString('hex');
const q=s=>"'"+String(s).replace(/'/g,"''")+"'";
const pg=s=>execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-Atq','-c',s],{encoding:'utf8',timeout:25000}).trim();
const count=s=>Number(pg(s));
const audit=table=>count('SELECT count(*) FROM private.v30_bundle_write_audit WHERE table_name='+q(table));
const hb=()=>({action:'heartbeat',app_version:'1.5.24-stable',screen_width:1920,screen_height:1080,storage_free_mb:1024,
network_connected:true,network_validated:true,network_transport:'wifi'});
async function request(key,body={action:'cycle',heartbeat:hb()},ua='VisionPlayerAndroid/1.5.24-stable'){
 const response=await fetch(api+'/functions/v1/device-bundle-stable',{method:'POST',
 headers:{apikey:anon,'content-type':'application/json','x-device-token':key,'user-agent':ua},
 body:JSON.stringify(body)});
 return {status:response.status,data:await response.json()};
}
function expected(r,status){assert.equal(r.status,status,JSON.stringify(r));return r.data}
async function main(){
 const hash=createHash('sha256').update(token).digest('hex');
 pg('INSERT INTO public.device_credentials(device_id,token_hash) VALUES ('+q(TA)+','+q(hash)+')');
 pg("UPDATE public.device_pairing_requests SET status='issued',issued_token='QA-ONLY' WHERE device_id="+q(TA));
 pg("INSERT INTO public.devices(id,company_id,name,status,last_seen_at) VALUES ('10000000-0000-4000-8000-000000000003',"+q(A)+",'stale QA','online',now()-interval '4 minutes')");
 pg('INSERT INTO public.device_commands(id,company_id,device_id,command_type,status) VALUES '+
 '('+q(CMD)+','+q(A)+','+q(TA)+",'sync_now','pending'),"+
 '('+q(CROSS)+','+q(B)+','+q(TB)+",'sync_now','pending')");
 pg('TRUNCATE private.v30_bundle_write_audit RESTART IDENTITY');
 expected(await request('wrong-token'),401);
 expected(await request(token,undefined,'LegacyClient/1'),403);
 expected(await request(token,{action:'command_status',command_id:CMD}),400);
 console.log('PASS_BUNDLE_AUTH invalid token 401, wrong UA 403, non-cycle 400');
 const first=expected(await request(token),200);
 assert.equal(first.commands.ok,true,JSON.stringify(first));
 assert.equal(first.heartbeat.ok,true,JSON.stringify(first));
 assert.equal(first.commands.data.commands.length,1);
 assert.equal(first.commands.data.commands[0].id,CMD);
 assert.equal(pg('SELECT status FROM public.device_commands WHERE id='+q(CMD)),'sent');
 assert.equal(pg('SELECT issued_token IS NULL FROM public.device_pairing_requests WHERE device_id='+q(TA)),'t');
 assert.equal(pg("SELECT status FROM public.devices WHERE id='10000000-0000-4000-8000-000000000003'"),'offline');
 console.log('PASS_BUNDLE_FIRST_CYCLE command delivered, issued pairing cleared, stale TV offline');
 for(let i=0;i<11;i++){
  const r=expected(await request(token),200);
  assert.equal(r.commands.ok,true);
  assert.equal(r.commands.data.commands.length,1);
  assert.equal(r.commands.data.commands[0].status,'sent');
  assert.equal(r.heartbeat.ok,true);
 }
 const writes={credentials:audit('device_credentials'),pairing:audit('device_pairing_requests'),
 devices:audit('devices'),heartbeats:audit('device_heartbeats'),commands:audit('device_commands')};
 assert.equal(writes.credentials,1);
 assert.equal(writes.pairing,1);
 assert.equal(writes.heartbeats,1);
 assert.equal(writes.commands,1);
 assert.equal(writes.devices,13);
 console.log('PASS_BUNDLE_LOCAL_WRITES 12 cycles '+JSON.stringify(writes));
 pg('UPDATE public.device_credentials SET revoked_at=now() WHERE device_id='+q(TA));
 expected(await request(token),401);
 pg('UPDATE public.device_credentials SET revoked_at=NULL WHERE device_id='+q(TA));
 pg('UPDATE public.companies SET status='+q('suspended')+' WHERE id='+q(A));
 expected(await request(token),403);
 pg("UPDATE public.companies SET status='active' WHERE id="+q(A));
 assert.equal(pg('SELECT status FROM public.companies WHERE id='+q(A)),'active');
 console.log('PASS_BUNDLE_BLOCKS revoked 401 suspended 403 restored active');
}
main().catch(e=>{console.error('FAIL_BUNDLE_NATIVE',e.stack||e.message);process.exitCode=1});
