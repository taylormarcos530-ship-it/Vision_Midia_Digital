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
async function call(device,body){
 const r=await fn(new Request('http://127.0.0.1/local',{method:'POST'}),{admin:service,device,body});
 return {status:r.status,data:await r.json()};
}
async function main(){
 let x=await call(devA,{action:'command_status',command_id:CMD});
 assert.equal(x.status,200,JSON.stringify(x));
 assert.equal(x.data.command.status,'sent');
 x=await call(devA,{action:'command_status',command_id:CROSS});assert.equal(x.status,404);
 x=await call(devB,{action:'command_result',command_id:CMD,status:'completed'});assert.equal(x.status,404);
 console.log('PASS_BUNDLE_STATUS real PostgREST status sent, cross company 404');
 let before=audit();
 x=await call(devA,{action:'command_result',command_id:CMD,status:'completed'});
 assert.equal(x.status,200,JSON.stringify(x));
 x=await call(devA,{action:'command_result',command_id:CMD,status:'failed'});
 assert.equal(x.status,200);
 assert.equal(pg('SELECT status FROM public.device_commands WHERE id='+q(CMD)),'completed');
 assert.equal(audit()-before,1);
 console.log('PASS_BUNDLE_TERMINAL repeat cannot rewrite terminal status');
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
