// All fixtures are synthetic, isolated to staging and removed in finally.
import {issueVirtualToken,verifyVirtualToken} from './commercial-virtual-token.mjs';
const png=()=>Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO97GrEAAAAASUVORK5CYII='),x=>x.charCodeAt(0));
const check=(res,what)=>{if(res?.error)throw Error(what+'_failed');return res.data};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const DELAY=2500;
export async function virtualDeviceTrial({admin,actorId,authorization,url,publishableKey,secret,fetcher=fetch}){
 if(url!=='https://jmiuitrrhtaeyrpuyohk.supabase.co'||!actorId||!authorization?.startsWith('Bearer ')||!publishableKey||!secret)
   throw Error('virtual_staging_guard');
 const [devices,companies,media,objects]=await Promise.all([
  admin.from('devices').select('id',{count:'exact',head:true}),
  admin.from('companies').select('id',{count:'exact',head:true}),
  admin.from('media_assets').select('id',{count:'exact',head:true}),
  admin.storage.from('vision-media').list('',{limit:1})
 ]);
 for(const r of [devices,companies,media,objects])if(r.error)throw Error('staging_preflight_failed');
 if(devices.count!==0||companies.count!==0||media.count!==0||objects.data?.length)throw Error('staging_not_empty');
 const {data:accounts,error:accErr}=await admin.from('vision_advertisers')
  .select('id').eq('name','Teste').eq('status','active').is('archived_at',null).limit(2);
 if(accErr||accounts?.length!==1)throw Error('synthetic_advertiser_not_ready');
 const uuid=crypto.randomUUID();
 const base='LAB-VIRTUAL-'+uuid;
 const source='qa-commercial-probe/'+crypto.randomUUID()+'.png';
 const copy='commercial-ads/'+crypto.randomUUID()+'.png';
 const content=png(),bucket=admin.storage.from('vision-media');
 const created={company:null,device:null,media:null,campaign:null,source:false,copy:false};
 let fail=null,result=null,cleanupFailures=[];
 const remove=async(table,field,id)=>{
  if(!id)return;
  const response=await admin.from(table).delete().eq(field,id);
  if(response.error)cleanupFailures.push(table+'_cleanup_failed');
 };
 try{
  const comp=check(await admin.from('companies').insert({name:base}).select('id').single(),'company');
  created.company=comp.id;
  const device=check(await admin.from('devices').insert({company_id:comp.id,name:base}).select('id').single(),'device');
  created.device=device.id;
  check(await bucket.upload(source,content,{contentType:'image/png',upsert:false}),'source_upload');created.source=true;
  check(await bucket.copy(source,copy),'commercial_copy');created.copy=true;
  const media=check(await admin.from('media_assets').insert({company_id:comp.id,name:'LAB ONLY - 1px',
   media_type:'image',storage_path:source,duration_seconds:1,size_bytes:content.length,checksum_sha256:uuid,
   width:1,height:1,processing_status:'ready'}).select('id').single(),'media');
  created.media=media.id;
  const saved=check(await admin.rpc('vision_commercial_save_campaign',{p_actor:actorId,p_data:{
   advertiser_id:accounts[0].id,name:base,start_date:today(),end_date:today(),status:'active',
   media_id:media.id,device_ids:[device.id],commercial_copy_path:copy
  }}),'save_campaign');
  created.campaign=saved?.id;
  if(!created.campaign||!saved?.snapshot_used)throw Error('revision_missing');
  const token=await issueVirtualToken(secret,device.id,120);
  const proof=await verifyVirtualToken(secret,token);
  const endpoint=url+'/functions/v1/commercial-virtual-gateway';
  const call=async(body,key=token)=>{
   const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json',
    apikey:publishableKey,Authorization:authorization,'x-device-token':key},body:JSON.stringify(body)});
   const payload=await response.json().catch(()=>({}));
   return {status:response.status,payload};
  };
  const invalid=await call({action:'manifest'},'invalid-test-device-token');
  if(invalid.status!==401)throw Error('bad_token_accepted');
  const manifest=await call({action:'manifest'});
  const items=manifest.payload?.items;
  if(manifest.status!==200||!Array.isArray(items)||items.length!==7||
     items[0]?.id!=='lab-point-1'||items[3]?.id?.startsWith('lab-point-')||
     items.filter(x=>x.id.startsWith('lab-point-')).length!==6)throw Error('virtual_manifest_failed');
  const ad=items[3],uri=ad.media?.url;
  if(typeof uri!=='string'||!uri.startsWith('https://')||!uri.includes('/storage/v1/'))throw Error('signed_media_missing');
  const signed=await fetcher(uri,{method:'GET',redirect:'error'});
  if(!signed.ok)throw Error('signed_download_failed');
  const read=new Uint8Array(await signed.arrayBuffer());
  if(read.length!==content.length||read.some((n,i)=>n!==content[i]))throw Error('signed_media_bytes_changed');
  const now=Date.now(),eventId=n=>'qa-'+proof.nonce+'-'+n;
  const events=[
   {id:eventId(1),media_id:ad.id,start:new Date(now-95000).toISOString(),end:new Date(now-94000).toISOString(),completed:true},
   {id:eventId(2),media_id:ad.id,start:new Date(now-75000).toISOString(),end:new Date(now-74000).toISOString(),completed:true},
   {id:eventId(3),media_id:ad.id,start:new Date(now-55000).toISOString(),end:null,completed:false},
   {id:eventId(4),media_id:ad.id,start:new Date(now-35000).toISOString(),end:new Date(now-36000).toISOString(),completed:true}
  ];
  const first=await call({action:'events',events});
  const repeated=await call({action:'events',events});
  if(first.status!==200||repeated.status!==200||first.payload?.completed!==2||
      repeated.payload?.completed!==2||first.payload?.attempts!==4||repeated.payload?.attempts!==4)
   throw Error('virtual_telemetry_not_idempotent');
  result={ok:true,staging_only:true,invalid_device_blocked:true,base_media_preserved:6,
   commercial_inserted:1,signed_media_verified:true,events_submitted:4,valid_completions:2,
   retry_without_duplication:true,device_type:'virtual'};
 }catch(e){fail=String(e?.message||'trial_failed')}
 // Clean in dependency order; no table-wide deletion and no customer row IDs.
 await remove('vision_commercial_daily','device_id',created.device);
 await remove('playback_logs','device_id',created.device);
 await remove('vision_commercial_targets','campaign_id',created.campaign);
 if(created.campaign){
  const u=await admin.from('vision_commercial_campaigns').update({current_revision_id:null}).eq('id',created.campaign);
  if(u.error)cleanupFailures.push('revision_unlink_failed');
 }
 await remove('vision_commercial_revisions','campaign_id',created.campaign);
 await remove('vision_commercial_campaigns','id',created.campaign);
 await remove('media_assets','id',created.media);
 await remove('devices','id',created.device);
 await remove('companies','id',created.company);
 if(created.copy||created.source){
  const rem=await bucket.remove([...(created.copy?[copy]:[]),...(created.source?[source]:[])]);
  if(rem.error)cleanupFailures.push('storage_cleanup_failed');
 }
 if(cleanupFailures.length)throw Error('virtual_trial_cleanup_failed:'+cleanupFailures.join(','));
 if(fail)throw Error(fail);
 return {...result,cleanup_verified:true};
}
