// Local HTTP integration with the ACTUAL entire device-gateway source.
// Supabase-js PostgREST is replaced by a deterministic PostgreSQL 17 adapter
// using psql, with synthetic rows/tokens only. There is no production network.
'use strict';
const assert = require('node:assert/strict');
const { createHash,randomBytes,webcrypto } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');

assert.equal(process.env.PGHOST,'localhost','No remote DB allowed');
assert.equal(process.env.PGDATABASE,'vision_v30_http_ci','Disposable DB required');
const COMP_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMP_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TV_A='10000000-0000-4000-8000-000000000001';
const TV_B='10000000-0000-4000-8000-000000000002';
const quote=v=>v==null?'NULL':("'"+String(v).replace(/'/g,"''")+"'");
function sql(q) {
  return execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-Atq','-c',q], {
    encoding:'utf8',env:process.env,timeout:30000
  }).trim();
}
const scalar=q=>Number(sql(q));
const tokenA=randomBytes(35).toString('hex');
const tokenB=randomBytes(35).toString('hex');
const tokenHash=x=>createHash('sha256').update(x).digest('hex');
sql("INSERT INTO public.device_credentials(device_id,token_hash) VALUES "+
  "("+quote(TV_A)+","+quote(tokenHash(tokenA))+"),"+
  "("+quote(TV_B)+","+quote(tokenHash(tokenB))+")");
let failInsertOnce=false;
let loseResponseAfterCommit=false;
let requests=0;
class PGQuery {
  constructor(table){this.table=table;this.filters=[];this.updatePayload=null;this.selectCols='*';}
  select(cols='*'){this.selectCols=cols;return this;}
  eq(key,val){this.filters.push(key+'='+quote(val));return this;}
  not(key,op,val){ if(op==='is'&&val==='null') this.filters.push(key+' IS NOT NULL');return this;}
  or(){return this;}
  async maybeSingle(){
    const cond=this.filters.length?' WHERE '+this.filters.join(' AND '):'';
    const row=sql('SELECT row_to_json(t) FROM (SELECT '+this.selectCols+
      ' FROM public.'+this.table+cond+' LIMIT 1) t');
    return {data:row?JSON.parse(row):null,error:null};
  }
  async in(key,values){
    const cond=[...this.filters,key+' IN ('+values.map(quote).join(',')+')'].join(' AND ');
    const rows=sql('SELECT COALESCE(json_agg(t),'+quote('[]')+'::json) FROM '+
       '(SELECT '+this.selectCols+' FROM public.'+this.table+' WHERE '+cond+') t');
    return {data:JSON.parse(rows),error:null};
  }
  update(payload){this.updatePayload=payload;return this;}
  async executeUpdate(){
    const keys=Object.keys(this.updatePayload);
    const assignments=keys.map(k=>k+'='+quote(this.updatePayload[k])).join(',');
    const cond=this.filters.length?' WHERE '+this.filters.join(' AND '):'';
    sql('UPDATE public.'+this.table+' SET '+assignments+cond);
    return {data:null,error:null};
  }
  then(resolve,reject){return this.executeUpdate().then(resolve,reject);}
  async upsert(rows,options){
    assert.equal(this.table,'playback_logs');
    assert.equal(options.onConflict,'device_id,client_event_id');assert.equal(options.ignoreDuplicates,true);
    if(failInsertOnce){failInsertOnce=false;return {data:null,error:{message:'synthetic_database_failure'}};}
    const cols=['client_event_id','company_id','device_id','campaign_id','playlist_id',
      'media_id','started_at','ended_at','duration_seconds','completed','device_name',
      'campaign_name','playlist_name','media_name'];
    const values=rows.map(row=>'('+cols.map(k=>row[k]===true?'true':
      row[k]===false?'false':quote(row[k])).join(',')+')');
    try {
      sql('INSERT INTO public.playback_logs ('+cols.join(',')+') VALUES '+
        values.join(',')+' ON CONFLICT(device_id,client_event_id) DO NOTHING');
      return {data:null,error:null};
    } catch(e){return {data:null,error:{message:'PostgreSQL sandbox failure'}};}
  }
}
const mockAdmin={from(table){return new PGQuery(table)}};
let handler;
const source=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
assert.ok(source.startsWith("import { createClient }"));
const transformed=source.replace(/^import[^\n]+\n/,'');
vm.runInNewContext(transformed,{
  createClient:(url,key)=> {
    assert.equal(url,'http://localhost/QA');
    assert.equal(key,'synthetic-only-key');
    return mockAdmin;
  },
  Deno:{
    env:{get(key){const vars={
      SUPABASE_SERVICE_ROLE_KEY:'synthetic-only-key',
      SUPABASE_URL:'http://localhost/QA',
    };return vars[key]||'';}},
    serve(fn){handler=fn},
  },
  crypto:webcrypto,TextEncoder,Response,Request,Headers,URL,console,atob,btoa,
  setTimeout,clearTimeout,Buffer,
},{filename:'device-gateway-qa.mjs',timeout:15000});
assert.equal(typeof handler,'function','Entire gateway must register actual HTTP handler');

const server=http.createServer(async(req,res)=>{
  const parts=[];for await(const part of req)parts.push(part);
  const request=new Request('http://127.0.0.1/playback',{
    method:req.method,headers:req.headers,body:Buffer.concat(parts)
  });
  const response=await handler(request);
  requests++;
  if(loseResponseAfterCommit){loseResponseAfterCommit=false;res.destroy();return;}
  res.writeHead(response.status,Object.fromEntries(response.headers.entries()));
  res.end(await response.text());
});
let base;
async function post(token,events,extras={}){
  const res=await fetch(base,{
    method:'POST',
    headers:{'content-type':'application/json','x-device-token':token},
    body:JSON.stringify({action:'playback_batch',events,...extras})
  });
  return {status:res.status,data:await res.json()};
}
const event=(id,startedAt=new Date(Date.now()-30*86400000).toISOString())=>({
 client_event_id:id,started_at:startedAt,completed:true,duration_seconds:15
});
const rawCount=()=>scalar('SELECT count(*) FROM public.playback_logs');
function notice(name,value){console.log('PASS_HTTP_'+name+' '+value)}
async function main(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 base='http://127.0.0.1:'+server.address().port+'/playback';
 try{
  let result=await post('wrong-token-'+tokenA,[event('bad')]);
  assert.equal(result.status,401);
  notice('WRONG_TOKEN','401');

  sql('UPDATE public.device_credentials SET revoked_at=now() WHERE device_id='+quote(TV_A));
  result=await post(tokenA,[event('revoked')]);assert.equal(result.status,401);
  sql('UPDATE public.device_credentials SET revoked_at=NULL WHERE device_id='+quote(TV_A));
  notice('REVOKED_TOKEN','401');

  sql('UPDATE public.companies SET status='+quote('suspended')+' WHERE id='+quote(COMP_B));
  result=await post(tokenB,[event('blocked')]);assert.equal(result.status,403);
  sql('UPDATE public.companies SET status='+quote('active')+' WHERE id='+quote(COMP_B));
  notice('COMPANY_SUSPENSION','403');

  result=await post(tokenA,[event('first'),event('second')],{
    company_id:COMP_B,device_id:TV_B});
  assert.deepEqual(result,{status:200,data:{ok:true,accepted:2}});
  assert.equal(rawCount(),2);
  assert.equal(scalar("SELECT count(*) FROM public.playback_logs WHERE company_id="+quote(COMP_B)),0);
  result=await post(tokenA,[event('first'),event('second')]);
  assert.deepEqual(result,{status:200,data:{ok:true,accepted:2}});
  assert.equal(rawCount(),2);
  notice('IDEMPOTENT_ACK','initial=2 retries=0 company_spoof=0');

  let queue=[event('good-but-batched'),event('')];
  result=await post(tokenA,queue);
  assert.equal(result.status,400);assert.equal(result.data.error,'invalid_playback_event');
  assert.equal(rawCount(),2);
  // Player only pops queue after a successful response: this stays pending.
  assert.equal(queue.length,2);
  notice('INVALID_BATCH_QUEUE','HTTP=400 preserved=2 dbWrites=0');
  // A separately recovered valid ID can be resent after identifying bad input.
  result=await post(tokenA,[queue[0]]);
  assert.equal(result.status,200);assert.equal(rawCount(),3);

  failInsertOnce=true;
  queue=[event('recover-after-db-error')];
  result=await post(tokenA,queue);
  assert.equal(result.status,400);assert.equal(rawCount(),3);
  result=await post(tokenA,queue);assert.equal(result.status,200);assert.equal(rawCount(),4);
  notice('DB_ERROR_RETRY','HTTP=400 then HTTP=200 stored_once=1');

  queue=[event('recover-after-lost-http-response')];
  loseResponseAfterCommit=true;
  await assert.rejects(post(tokenA,queue));
  assert.equal(rawCount(),5);
  result=await post(tokenA,queue);
  assert.equal(result.status,200);assert.equal(rawCount(),5);
  notice('NETWORK_LOST_AFTER_COMMIT','same_event_acknowledged_once');

  result=await post(tokenB,[event('first')]);assert.equal(result.status,200);
  assert.equal(scalar("SELECT count(*) FROM public.playback_logs WHERE client_event_id='first'"),2);
  notice('CROSS_TV_SAME_ID','two TV scoped identities');

  const old=event('archived-old');
  result=await post(tokenA,[old]);assert.equal(result.status,200);
  const before=rawCount();
  sql("UPDATE public.playback_logs SET created_at=now()-interval '9 days'"+
    " WHERE client_event_id='archived-old'");
  sql("UPDATE private.vision_playback_compaction_control_v30 "+
    "SET enabled=true,raw_days=7,archive_verified_at=now(),reporting_verified_at=now(),"+
    "offline_replay_verified_at=now(),dedupe_verified_at=now() WHERE id=1");
  const moved=scalar('SELECT raw_removed FROM private.vision_playback_compact_batch_v30(250)');
  assert.equal(moved,1);assert.equal(rawCount(),before-1);
  result=await post(tokenA,[old]);assert.equal(result.status,200);
  assert.equal(rawCount(),before-1);
  const archived=scalar('SELECT coalesce(sum(started),0) FROM public.vision_playback_daily_archive_v30');
  assert.equal(archived,1);
  notice('ARCHIVED_REPLAY','after_archive_duplicate=0 summary=1');

  result=await post(tokenA,[event('last-unique')]);assert.equal(result.status,200);
  assert.equal(scalar("SELECT count(*) FROM public.playback_logs WHERE client_event_id='last-unique'"),1);
  notice('COUNTS_FINAL','httpRequests='+requests+' raw='+rawCount()+' archive='+archived);
 }finally{await new Promise(resolve=>server.close(resolve))}
}
main().catch(e=>{console.error('FAIL_HTTP',e.message);process.exitCode=1;server.close()});
