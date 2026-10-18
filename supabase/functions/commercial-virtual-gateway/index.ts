// Virtual device gateway used ONLY in Vision Mídia Supabase staging.
import {createClient} from 'npm:@supabase/supabase-js@2';
import {augmentCommercial,refreshCommercialDaily} from '../_shared/commercial.mjs';
import {verifyVirtualToken} from '../_shared/commercial-virtual-token.mjs';
const STAGING='https://jmiuitrrhtaeyrpuyohk.supabase.co';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-device-token','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Cache-Control':'no-store','Content-Type':'application/json'}});
const validId=id=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||'');
const secret=()=>JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const publicKey=()=>JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY')||'';
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 if(Deno.env.get('SUPABASE_URL')!==STAGING)return json({error:'staging_only'},503);
 const bearer=request.headers.get('authorization')||'';
 const key=secret(),pub=publicKey();
 if(!pub||!key||!bearer.startsWith('Bearer '))return json({error:'unauthorized'},401);
 try{
 const publicClient=createClient(STAGING,pub,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:login,error:loginError}=await publicClient.auth.getUser(bearer.slice(7));
 if(loginError||!login.user)return json({error:'unauthorized'},401);
 const admin=createClient(STAGING,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:master,error:masterErr}=await admin.from('platform_admins').select('role,status').eq('user_id',login.user.id).maybeSingle();
 if(masterErr||!master||master.status!=='active'||!['admin','super_admin'].includes(master.role))return json({error:'master_required'},403);
 const proof=await verifyVirtualToken(key,request.headers.get('x-device-token'));
 if(!proof)return json({error:'virtual_device_token_invalid'},401);
 const {data:device,error:deviceError}=await admin.from('devices').select('id,name,company_id,retired_at').eq('id',proof.deviceId).maybeSingle();
 if(deviceError||!device||device.retired_at||!device.name.startsWith('LAB-VIRTUAL-'))return json({error:'virtual_device_missing'},403);
 const {data:company}=await admin.from('companies').select('name').eq('id',device.company_id).maybeSingle();
 if(!company?.name?.startsWith('LAB-VIRTUAL-'))return json({error:'virtual_company_missing'},403);
 const body=await request.json().catch(()=>({}));
 if(body.action==='manifest'){
  const original={updatedAt:'staging-qa',playlist:{id:'lab-only-playlist',shuffle:false,repeat_mode:'loop'},
   items:Array.from({length:6},(_,i)=>({id:'lab-point-'+(i+1),duration_seconds:1,essential:true,schedule:{enabled:false},
    media:{id:'lab-point-media-'+(i+1),type:'image',name:'LAB '+(i+1),url:null,checksum:'lab-original-'+i}}))};
  const augmented=await augmentCommercial(admin,device,original,true,true);
  const ids=augmented.items.map(x=>x.id);
  if(ids.length<7||ids.length>8||ids.slice(0,3).join(',')!=='lab-point-1,lab-point-2,lab-point-3')return json({error:'commercial_manifest_unavailable'},409);
  return json({ok:true,device:'virtual-only',items:augmented.items,version:'staging-virtual-only'});
 }
 if(body.action==='events'){
  if(!Array.isArray(body.events)||body.events.length<1||body.events.length>10)return json({error:'invalid_events'},400);
  const {data:commercial,error:manifestError}=await admin.rpc('vision_commercial_manifest',{p_device:device.id});
  if(manifestError)return json({error:'manifest_unavailable'},503);
  const allowed=new Set((commercial||[]).map(x=>x.id));
  const rows=[];
  for(const item of body.events){
   const start=new Date(item.start),end=item.end==null?null:new Date(item.end);
   if(typeof item.id!=='string'||item.id.length>120||!item.id.startsWith('qa-'+proof.nonce+'-')||!validId(item.media_id)||
       !allowed.has(item.media_id)||!Number.isFinite(start.getTime())||
       (end&&!Number.isFinite(end.getTime()))||start.getTime()>Date.now()+1000||
       Date.now()-start.getTime()>5*60*1000||typeof item.completed!=='boolean')
       return json({error:'event_rejected'},400);
   rows.push({device_id:device.id,client_event_id:item.id,media_id:item.media_id,
      started_at:start.toISOString(),ended_at:end?.toISOString()||null,completed:item.completed});
  }
  const {error:writeError}=await admin.from('playback_logs').upsert(rows,{onConflict:'device_id,client_event_id',ignoreDuplicates:true});
  if(writeError)return json({error:'event_storage_failed'},503);
  await refreshCommercialDaily(admin,device.id,true);
  const {data:totals,error:readError}=await admin.from('vision_commercial_daily').select('completed_count,attempt_count').eq('device_id',device.id);
  if(readError)return json({error:'report_unavailable'},503);
  return json({ok:true,events_submitted:rows.length,completed:(totals||[]).reduce((a,x)=>a+Number(x.completed_count||0),0),
     attempts:(totals||[]).reduce((a,x)=>a+Number(x.attempt_count||0),0)});
 }
 return json({error:'action_not_available'},403);
 }catch{return json({error:'virtual_device_trial_failed'},503)}
});
