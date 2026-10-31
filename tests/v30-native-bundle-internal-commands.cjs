'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createClient}=require('@supabase/supabase-js');
const api=process.env.API_URL;
assert.match(api,/^http:\/\/(localhost|127\.0\.0\.1):54321\/?$/);
assert.equal(process.env.PGHOST,'127.0.0.1');
const service=createClient(api,process.env.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TA='10000000-0000-4000-8000-000000000001',TB='10000000-0000-4000-8000-000000000002';
const CMD='40000000-0000-4000-8000-000000000001',CROSS='40000000-0000-4000-8000-000000000002';
const RACE='40000000-0000-4000-8000-000000000003';
const TC='10000000-0000-4000-8000-000000000004';
const SAME='40000000-0000-4000-8000-000000000004';
const FAILED='40000000-0000-4000-8000-000000000005';
const UNSUPPORTED='40000000-0000-4000-8000-000000000006';
const MISSING='40000000-0000-4000-8000-000000000099';
const q=s=>"'"+String(s).replace(/'/g,"''")+"'";
const pg=s=>execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-Atq','-c',s],{encoding:'utf8',timeout:35000}).trim();
const audit=()=>Number(pg("SELECT count(*) FROM private.v30_bundle_write_audit WHERE table_name='device_commands'"));
const source=fs.readFileSync('supabase/functions/device-bundle-stable/index.ts','utf8');
assert.ok(source.includes('async function runExistingGatewayAction'));
const context={createClient,Response,Request,Headers,URL,TextEncoder,Uint8Array,crypto:webcrypto,atob,btoa,
 console,Date,Map,Set,Promise,Intl,Deno:{serve(){},env:{get(){return null}}}};
vm.runInNewContext(source.replace(/^import[^\n]+\n/m,'')+
  '\nglobalThis.__qaAction = runExistingGatewayAction;',context,{timeout:15000});
const fn=context.__qaAction,devA={id:TA,company_id:A,name:'TV QA'},devB={id:TB,company_id:B,name:'TV B'};
const devC={id:TC,company_id:A,name:'TV C QA'};
async function call(device,body){
 const r=await fn(new Request('http://127.0.0.1/local',{method:'POST'}),{admin:service,device,body});
 return {status:r.status,data:await r.json()};
}
async function main(){
 pg('INSERT INTO public.devices(id,company_id,name,status) VALUES ('+q(TC)+','+q(A)+",'TV C QA','online')");
 pg('INSERT INTO public.device_commands(id,company_id,device_id,command_type,status) VALUES '+
 '('+q(SAME)+','+q(A)+','+q(TC)+",'sync_now','sent'),"+
 '('+q(FAILED)+','+q(A)+','+q(TA)+",'sync_now','sent'),"+
 '('+q(UNSUPPORTED)+','+q(A)+','+q(TA)+",'qa_unsupported','sent')");
 let x=await call(devA,{action:'command_status',command_id:CMD});
 assert.equal(x.status,200,JSON.stringify(x));
 assert.equal(x.data.command.status,'sent');
 assert.equal(x.data.command.id,CMD);
 assert.equal(x.data.command.device_id,TA);
 assert.equal(x.data.command.command_type,'sync_now');
 x=await call(devA,{action:'command_status',command_id:SAME});assert.equal(x.status,404);
 x=await call(devC,{action:'command_status',command_id:CMD});assert.equal(x.status,404);
 x=await call(devA,{action:'command_status',command_id:''});assert.equal(x.status,400);
 x=await call(devA,{action:'command_status',command_id:MISSING});assert.equal(x.status,404);
 x=await call(devA,{action:'command_status',command_id:CROSS});assert.equal(x.status,404);
 x=await call(devB,{action:'command_result',command_id:CMD,status:'completed'});assert.equal(x.status,404);
 console.log('PASS_BUNDLE_STATUS own device, same-company other TV, cross-company, empty and missing ID');
 let blockedBefore=audit();
 for(const device of [devB,devC]){
  x=await call(device,{action:'command_result',command_id:CMD,status:'completed'});
  assert.equal(x.status,404);
 }
 assert.equal(audit(),blockedBefore,'cross-device result must not write');
 for(const body of [
  {action:'command_result',command_id:'',status:'completed'},
  {action:'command_result',command_id:MISSING,status:'completed'},
  {action:'command_result',command_id:CMD,status:'invalid'},
  {action:'command_result',command_id:UNSUPPORTED,status:'completed'}
 ]){
  x=await call(devA,body);
  assert.equal(x.status,body.command_id===MISSING?404:400,JSON.stringify(x));
 }
 assert.equal(audit(),blockedBefore,'invalid result must not write');
 console.log('PASS_BUNDLE_RESULT_NEGATIVE same-company isolation, invalid/missing ID and unsupported type');
 let before=audit();
 x=await call(devA,{action:'command_result',command_id:CMD,status:'completed'});
 assert.equal(x.status,200,JSON.stringify(x));
 assert.equal(x.data.ok,true);
 x=await call(devA,{action:'command_result',command_id:CMD,status:'completed'});
 assert.equal(x.status,200);
 x=await call(devA,{action:'command_result',command_id:CMD,status:'failed'});
 assert.equal(x.status,200);
 assert.equal(pg('SELECT status FROM public.device_commands WHERE id='+q(CMD)),'completed');
 assert.equal(audit()-before,1);
 console.log('PASS_BUNDLE_TERMINAL repeat cannot rewrite terminal status');
 before=audit();
 x=await call(devA,{action:'command_result',command_id:FAILED,status:'failed'});
 assert.equal(x.status,200);
 x=await call(devA,{action:'command_result',command_id:FAILED,status:'completed'});
 assert.equal(x.status,200);
 assert.equal(pg('SELECT status FROM public.device_commands WHERE id='+q(FAILED)),'failed');
 assert.equal(audit()-before,1,'failed terminal state cannot be overwritten');
 console.log('PASS_BUNDLE_TERMINAL_REVERSE failed then completed remains failed');
 pg('INSERT INTO public.device_commands(id,company_id,device_id,command_type,status) VALUES ('+
 q(RACE)+','+q(A)+','+q(TA)+",'reload_programming','sent')");
 before=audit();
 const res=await Promise.all(Array.from({length:12},(_,i)=>call(devA,{action:'command_result',command_id:RACE,
 status:i%2?'completed':'failed'})));
 assert.ok(res.every(r=>r.status===200),JSON.stringify(res));
 assert.equal(audit()-before,1,'only one terminal update must commit');
 const final=pg('SELECT status FROM public.device_commands WHERE id='+q(RACE));
 assert.ok(['completed','failed'].includes(final));
 console.log('PASS_BUNDLE_RACE 12 concurrent command ACKs -> exactly one UPDATE, final='+final);
 const terminal=await call(devA,{action:'command_status',command_id:RACE});
 assert.equal(terminal.data.command.status,final);
}
main().catch(e=>{console.error('FAIL_BUNDLE_COMMANDS',e.stack||e.message);process.exitCode=1});
