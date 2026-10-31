'use strict';
// Local Supabase Auth (GoTrue) + PostgREST + Deno Edge Functions with real
// supabase-js. No production secrets, API endpoints, migrations or data.
const assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createClient}=require('@supabase/supabase-js');

const apiUrl=process.env.API_URL||process.env.SUPABASE_URL||'';
const anonKey=process.env.ANON_KEY||'';
const roleKey=process.env.SERVICE_ROLE_KEY||'';
assert.match(apiUrl,/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/);
assert.ok(anonKey.length>30 && roleKey.length>30,'Only local keys from CLI status');
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'54322');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TV_A='10000000-0000-4000-8000-000000000001';
const TV_B='10000000-0000-4000-8000-000000000002';
const service=createClient(apiUrl,roleKey,{auth:{persistSession:false,autoRefreshToken:false}});
const anon=createClient(apiUrl,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const q=v=>"'"+String(v).replace(/'/g,"''")+"'";
const pg=s=>execFileSync('psql',['-v','ON_ERROR_STOP=1','-Atq','-c',s],{encoding:'utf8',timeout:40000}).trim();
const hash=x=>createHash('sha256').update(x).digest('hex');
const tokenA=randomBytes(35).toString('hex'), tokenB=randomBytes(35).toString('hex');
const assertNoError=(r,desc)=>{if(r.error)throw Error(desc+': '+r.error.message);return r.data;};
const ev=(id,start='2026-10-20T16:00:00.000Z')=>({client_event_id:id,started_at:start,duration_seconds:15,completed:true});
async function playback(token,events,overrides={}){
 const r=await fetch(apiUrl+'/functions/v1/device-gateway',{
  method:'POST',headers:{
    apikey:anonKey,'content-type':'application/json','x-device-token':token
  },body:JSON.stringify({action:'playback_batch',events,...overrides})
 });
 let body;try{body=await r.json()}catch{body={parse_failure:true}};
 return {code:r.status,body};
}
function note(label,description){console.log('PASS_LOCAL_SUPABASE_'+label+' '+description);}
async function createUser(company,index){
 const email='vision-v30-local-'+index+'@example.invalid';
 const password='qa-'+randomBytes(24).toString('hex');
 const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true});
 assert.ifError(error);
 assert.ok(data.user?.id);
 pg('INSERT INTO private.v30_qa_membership(user_id,company_id) VALUES ('+
   q(data.user.id)+','+q(company)+')');
 const userClient=createClient(apiUrl,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:login,error:loginError}=await userClient.auth.signInWithPassword({email,password});
 assert.ifError(loginError);
 assert.ok(login.session?.access_token&&login.session?.user?.id===data.user.id);
 const parsed=JSON.parse(Buffer.from(login.session.access_token.split('.')[1],'base64url').toString());
 assert.equal(parsed.role,'authenticated');
 return {client:userClient,userId:data.user.id};
}
async function main(){
 // Local Auth created 2 independently signed user JWTs; RLS reads their uid.
 const userA=await createUser(A,'a');
 const userB=await createUser(B,'b');
 note('LOCAL_AUTH','2 signed-in users, JWTs issued by local GoTrue');

 pg('INSERT INTO public.device_credentials(device_id,token_hash) VALUES ('+
   q(TV_A)+','+q(hash(tokenA))+'),('+q(TV_B)+','+q(hash(tokenB))+')');

 let r=await playback('not-valid-token',[ev('wrong')]);assert.equal(r.code,401);
 note('DEVICE_AUTH_INVALID','401');
 pg('UPDATE public.device_credentials SET revoked_at=now() WHERE device_id='+q(TV_A));
 r=await playback(tokenA,[ev('revoked')]);assert.equal(r.code,401);
 pg('UPDATE public.device_credentials SET revoked_at=NULL WHERE device_id='+q(TV_A));
 note('DEVICE_AUTH_REVOKED','401');
 pg('UPDATE public.companies SET status='+q('suspended')+' WHERE id='+q(B));
 r=await playback(tokenB,[ev('suspended')]);assert.equal(r.code,403);
 pg('UPDATE public.companies SET status='+q('active')+' WHERE id='+q(B));
 note('SUSPENDED_COMPANY','403');

 r=await playback(tokenA,[ev('first'),ev('second')],{company_id:B,device_id:TV_B});
 assert.equal(r.code,200,JSON.stringify(r.body));assert.equal(r.body.accepted,2);
 r=await playback(tokenA,[ev('first'),ev('second')]);
 assert.equal(r.code,200,JSON.stringify(r.body));
 assert.equal(Number(pg('select count(*) from public.playback_logs')),2);
 note('IDEMPOTENT_ACK','2 created 2 replayed 0 duplicates');

 const malformed=[ev('valid-in-bad-batch'),{client_event_id:'',started_at:'bad'}];
 r=await playback(tokenA,malformed);assert.equal(r.code,400);
 assert.equal(Number(pg('select count(*) from public.playback_logs')),2);
 note('INVALID_BATCH','400 no partial persistence');

 // Repeat same event identity on different TVs: legal and isolated.
 r=await playback(tokenB,[ev('first')]);assert.equal(r.code,200);
 assert.equal(Number(pg("select count(*) from public.playback_logs where client_event_id='first'")),2);
 note('TWO_TV_IDENTITIES','same client ID scoped by device');

 let a=assertNoError(await userA.client.from('playback_logs').select('client_event_id,company_id'),'user A raw');
 let b=assertNoError(await userB.client.from('playback_logs').select('client_event_id,company_id'),'user B raw');
 assert.equal(a.length,2);assert.equal(b.length,1);
 assert.ok(a.every(e=>e.company_id===A)&&b.every(e=>e.company_id===B));
 const anonRead=await anon.from('playback_logs').select('client_event_id');
 if(anonRead.error){
   assert.match(anonRead.error.message,/permission denied|permission/i);
 }else{
   assert.equal(anonRead.data.length,0);
 }
 note('JWT_RLS_RAW','A=2 B=1 anon=0');

 // Compare archived report totals, including correct filters after retention.
 const day='2026-10-20';
 const req={p_start_date:day,p_end_date:day};
 const getReport=async(client,company)=>assertNoError(await client.rpc('get_playback_report_compacted_v30',
 {p_company_id:company,...req}),'hybrid report');
 let ra=await getReport(userA.client,A),rb=await getReport(userB.client,B);
 assert.equal(ra.summary.started,2);assert.equal(rb.summary.started,1);
 let cross=await userA.client.rpc('get_playback_report_compacted_v30',{p_company_id:B,...req});
 assert.ok(cross.error,'Cross-tenant report must fail');
 note('JWT_RLS_REPORTS','A=2 B=1 cross-tenant denied');

 // Synthetic-only archival, enabled after all test gates. Does not run on Vision.
 pg("UPDATE public.playback_logs SET created_at=now()-interval '10 days'");
 pg("UPDATE private.vision_playback_compaction_control_v30 SET enabled=true,raw_days=7,"+
 "archive_verified_at=now(),reporting_verified_at=now(),"+
 "offline_replay_verified_at=now(),dedupe_verified_at=now() WHERE id=1");
 let archived=0;
 for(let cycle=0;cycle<10;cycle++){
   const moved=Number(pg('SELECT raw_removed FROM private.vision_playback_compact_batch_v30(250)'));
   archived+=moved;
   if(moved===0)break;
 }
 assert.equal(archived,3,'Every TV must eventually be archived; one call may process one TV');
 ra=await getReport(userA.client,A);rb=await getReport(userB.client,B);
 assert.equal(ra.summary.started,2);assert.equal(rb.summary.started,1);
 a=assertNoError(await userA.client.from('vision_playback_daily_archive_v30').select('company_id,started'),'archive A');
 b=assertNoError(await userB.client.from('vision_playback_daily_archive_v30').select('company_id,started'),'archive B');
 assert.equal(a.length,1);assert.equal(b.length,1);
 assert.equal(a[0].started,2);assert.equal(b[0].started,1);
 cross=await userA.client.from('vision_playback_daily_archive_v30').select('started').eq('company_id',B);
 assert.equal(assertNoError(cross,'cross archive').length,0);
 note('ARCHIVED_JWT_REPORTS','A=2 B=1 company isolation preserved');

 r=await playback(tokenA,[ev('first')]);assert.equal(r.code,200);
 assert.equal(Number(pg('SELECT count(*) from public.playback_logs')),0);
 assert.equal(Number(pg('SELECT sum(started) from public.vision_playback_daily_archive_v30')),3);
 note('ARCHIVED_REPLAY_HTTP','200 acknowledged no duplicate database row');

 // PostgREST service-role ingestion must not expose the secret key to any device;
 // all access runs inside local Deno Edge Function.
 note('COMPLETED','real GoTrue local JWT, real SDK, real PostgREST and Deno Edge runtime');
}
main().catch(e=>{console.error('FAIL_LOCAL_SUPABASE',e.stack||e.message);process.exitCode=1});
