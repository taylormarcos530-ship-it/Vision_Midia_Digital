// STAGING ONLY: minimal Master API for commercial account QA. Never deploy to production.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { commercialMaster } from '../_shared/commercial-master.mjs'
const STAGING_URL = 'https://jmiuitrrhtaeyrpuyohk.supabase.co';
const C = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}});
const allowed = new Set(['whoami','commercial_list','commercial_create_advertiser','commercial_update_advertiser','commercial_reset_access','commercial_archive_advertiser','commercial_restore_advertiser','commercial_report']);
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:C});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL')||'';
  if(url!==STAGING_URL)return json({error:'staging_only_environment_guard'},503);
  const pub=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY');
  const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!pub||!secret)return json({error:'environment_keys_unavailable'},503);
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))return json({error:'authentication_required'},401);
  const body=await req.json().catch(()=>({}));
  const action=typeof body.action==='string'?body.action:'';
  if(!allowed.has(action))return json({error:'action_not_available_in_staging'},403);
  const client=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await client.auth.getUser(authorization.slice(7));
  if(authError||!identity?.user)return json({error:'invalid_session'},401);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:master,error:roleError}=await admin.from('platform_admins').select('role,status').eq('user_id',identity.user.id).maybeSingle();
  if(roleError)return json({error:'master_lookup_failed'},503);
  if(!master||master.status!=='active'||!['admin','super_admin'].includes(master.role))return json({error:'master_forbidden'},403);
  if(action==='whoami')return json({ok:true,role:master.role,email:identity.user.email});
  const result=await commercialMaster(admin,identity.user,master.role,body);
  return json(result);
 }catch(error){
  // Fail closed. Never log passwords, tokens, advertiser private media or Supabase internals.
  const safe=String(error?.message||'request_failed');
  const status=Number(error?.status);
  if(['invalid_advertiser','separate_advertiser_account','advertiser_unavailable','advertiser_required','activate_advertiser_first','advertiser_not_found','advertiser_archived','invalid_campaign'].includes(safe))
   return json({error:safe},status>=400&&status<=499?status:400);
  return json({error:'staging_commercial_request_failed'},503);
 }
});
