import {saveCommercialWithSnapshot} from './commercial-media.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const requireData=result=>{if(result.error)throw result.error;return result.data;};
const clean=(value,max)=>String(value??'').trim().slice(0,max);
const password=()=> 'V!'+crypto.randomUUID().replaceAll('-','')+'a9';
async function independentAccount(admin,id){
 const [members,masters]=await Promise.all([admin.from('company_members').select('user_id').eq('user_id',id).limit(1),admin.from('platform_admins').select('user_id').eq('user_id',id).limit(1)]);
 if(requireData(members)?.length||requireData(masters)?.length)throw fail('separate_advertiser_account',409);
}
export async function commercialMaster(admin,user,role,body){
 if(!['admin','super_admin'].includes(role))throw fail('master_forbidden',403);
 const action=body.action;
 if(action==='commercial_list'){
  const [advertisers,campaigns,devices,media,companies,sources,revisions,pointProfiles]=await Promise.all([
   admin.from('vision_advertisers').select('*').order('created_at',{ascending:false}),
   admin.from('vision_commercial_campaigns').select('*').order('created_at',{ascending:false}),
   admin.from('devices').select('id,company_id,name,last_seen_at').is('retired_at',null),
   admin.from('media_assets').select('id,company_id,name,media_type').eq('processing_status','ready').in('media_type',['image','video']),
   admin.from('companies').select('id,name'),
   admin.from('vision_commercial_sources').select('*').order('created_at',{ascending:false}),
   admin.from('vision_commercial_revisions').select('id,campaign_id,source_media_id,name,media_type,storage_path,created_at'),
   admin.from('vision_commercial_point_profile').select('*')]);
  return {ok:true,advertisers:requireData(advertisers),campaigns:requireData(campaigns),devices:requireData(devices),media:requireData(media),companies:requireData(companies),sources:requireData(sources),revisions:requireData(revisions),point_profiles:requireData(pointProfiles)};
 }
 if(action==='commercial_create_advertiser'){
  const name=clean(body.name,140),email=clean(body.email,320).toLowerCase();
  if(name.length<2||!/^\S+@\S+\.\S+$/.test(email))throw fail('invalid_advertiser');
  const temporary_password=password();
  // Never reuse an existing Auth account: it may already belong to a point or Master.
  const created=requireData(await admin.auth.admin.createUser({email,password:temporary_password,email_confirm:true,user_metadata:{display_name:name}}));
  const account=created.user;if(!account)throw fail('account_creation_failed',500);
  try{
   await independentAccount(admin,account.id);
   const advertiser=requireData(await admin.from('vision_advertisers').insert({name,email,user_id:account.id}).select('*').single());
   return {ok:true,advertiser,temporary_password};
  }catch(error){await admin.auth.admin.deleteUser(account.id);throw error;}
 }
 if(action==='commercial_archive_advertiser'||action==='commercial_restore_advertiser'){
  const id=clean(body.id,80);
  if(!id)throw fail('advertiser_required');
  const advertiser=requireData(await admin.from('vision_advertisers').select('id,archived_at').eq('id',id).maybeSingle());
  if(!advertiser)throw fail('advertiser_not_found',404);
  if(action==='commercial_archive_advertiser'){
   if(advertiser.archived_at)throw fail('advertiser_already_archived',409);
   // One atomic update: archive revokes portal RLS access and manifest eligibility.
   // Do not delete Auth users, media, campaign revisions, targets or playback history.
   const changed=requireData(await admin.from('vision_advertisers')
    .update({status:'disabled',archived_at:new Date().toISOString()}).eq('id',id).is('archived_at',null)
    .select('id').maybeSingle());
   if(!changed)throw fail('advertiser_conflict',409);
   return {ok:true,archived:true};
  }
  if(!advertiser.archived_at)throw fail('advertiser_not_archived',409);
  // Restoration never reactivates commercial playback or advertiser login.
  const restored=requireData(await admin.from('vision_advertisers')
   .update({archived_at:null,status:'disabled'}).eq('id',id).eq('archived_at',advertiser.archived_at)
   .select('id').maybeSingle());
  if(!restored)throw fail('advertiser_conflict',409);
  return {ok:true,restored:true,status:'disabled'};
 }
 if(action==='commercial_update_advertiser'||action==='commercial_reset_access'){
  const advertiser=requireData(await admin.from('vision_advertisers').select('*').eq('id',body.id).single());
  if(advertiser.archived_at)throw fail('advertiser_archived',409);
  await independentAccount(admin,advertiser.user_id);
  if(action==='commercial_reset_access'){
   if(advertiser.status!=='active')throw fail('activate_advertiser_first',409);
   const temporary_password=password();requireData(await admin.auth.admin.updateUserById(advertiser.user_id,{password:temporary_password}));
   return {ok:true,temporary_password};
  }
  const name=clean(body.name,140),status=body.status;
  if(name.length<2||!['active','disabled'].includes(status))throw fail('invalid_advertiser');
  requireData(await admin.from('vision_advertisers').update({name,status}).eq('id',advertiser.id));
  return {ok:true};
 }
 if(action==='commercial_save_campaign')return saveCommercialWithSnapshot(admin,user.id,body.campaign);
 if(action==='commercial_report')return {ok:true,...requireData(await admin.rpc('vision_commercial_master_report',{p_actor:user.id,p_advertiser:body.id}))};
 if(action==='commercial_archive_campaign'||action==='commercial_restore_campaign'){
  const id=clean(body.id,80);
  if(!/^[0-9a-f-]{36}$/i.test(id))throw fail('campaign_required');
  const routine=action==='commercial_archive_campaign'?'vision_commercial_archive_campaign':'vision_commercial_restore_campaign';
  return {ok:true,...requireData(await admin.rpc(routine,{p_actor:user.id,p_campaign:id}))};
 }
 if(action==='commercial_point_save'){
  const id=clean(body.device_id,80);
  if(!/^[0-9a-f-]{36}$/i.test(id))throw fail('public_point_not_found',404);
  const device=requireData(await admin.from('devices').select('id,name').eq('id',id).is('retired_at',null).maybeSingle());
  if(!device)throw fail('public_point_not_found',404);
  const share=body.share_location===true;
  const privateDevice=/\bteste\b|^\s*casa\s*$|^\s*home\s*$|^\s*resid[eê]ncia\b/i.test(device.name||'');
  if(privateDevice&&share)throw fail('private_test_device_location_blocked',403);
  const public_label=clean(body.public_label,100)||null;
  const public_address=clean(body.public_address,220)||null;
  const neighborhood=clean(body.neighborhood,110)||null;
  const city=clean(body.city,110)||null;
  if(share&&(!body.consent_confirmed||!public_label||!city))throw fail('public_point_consent_required');
  const row={device_id:id,public_label,public_address,neighborhood,city,
    share_location:share,
    consent_confirmed_at:share?new Date().toISOString():null,
    consent_confirmed_by:share?user.id:null,
    updated_at:new Date().toISOString()};
  requireData(await admin.from('vision_commercial_point_profile').upsert(row,{onConflict:'device_id'}));
  return {ok:true,share_location:share};
 }
 if(action==='commercial_media_previews'){
  const raw=body.ids;
  if(!Array.isArray(raw)||raw.length<1||raw.length>25)throw fail('invalid_preview_request');
  const ids=[...new Set(raw.map(x=>clean(x,80)))];
  if(ids.some(id=>!/^[0-9a-f-]{36}$/i.test(id)))throw fail('invalid_media_id');
  const [sources,media]=await Promise.all([
    admin.from('vision_commercial_sources').select('id,storage_path').in('id',ids),
    admin.from('media_assets').select('id,storage_path,processing_status,media_type').in('id',ids),
  ]);
  const list=[...requireData(sources),...requireData(media).filter(x=>x.processing_status==='ready'&&['image','video'].includes(x.media_type))];
  const previews=[];
  for(const file of list){
    if(!file.storage_path||!ids.includes(file.id))continue;
    const {data,error}=await admin.storage.from('vision-media').createSignedUrl(file.storage_path,300);
    if(!error&&data?.signedUrl)previews.push({id:file.id,url:data.signedUrl});
  }
  return {ok:true,previews};
 }
 if(action==='commercial_prepare_source'){
  const name=clean(body.name,140),mime=clean(body.mime,80),size=Number(body.size_bytes);
  const formats={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'};
  if(name.length<2||!Object.hasOwn(formats,mime)||!Number.isInteger(size)||size<1||size>26214400)throw fail('invalid_commercial_source');
  const id=crypto.randomUUID(),path='commercial-source/'+id+'.'+formats[mime];
  const {data,error}=await admin.storage.from('vision-media').createSignedUploadUrl(path);
  if(error||!data?.token)throw fail('commercial_upload_sign_failed',500);
  return {ok:true,id,path,upload_token:data.token};
 }
 if(action==='commercial_finalize_source'){
  const id=clean(body.id,80),name=clean(body.name,140),mime=clean(body.mime,80),size=Number(body.size_bytes);
  const formats={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'};
  if(!/^[0-9a-f-]{36}$/i.test(id)||name.length<2||!Object.hasOwn(formats,mime)||
    !Number.isInteger(size)||size<1||size>26214400)throw fail('invalid_commercial_source');
  const path='commercial-source/'+id+'.'+formats[mime];
  const {data:file,error:downloadError}=await admin.storage.from('vision-media').download(path);
  if(downloadError||!file)throw fail('commercial_uploaded_file_not_found',404);
  if(file.size!==size)throw fail('commercial_uploaded_size_mismatch',409);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()));
  const checksum=[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const payload={id,name,storage_path:path,media_type:mime.startsWith('image/')?'image':'video',
    duration_seconds:10,size_bytes:size,checksum_sha256:checksum,
    created_by:user.id,updated_at:new Date().toISOString()};
  const {data,error}=await admin.from('vision_commercial_sources').insert(payload).select('id').single();
  if(error)throw error;
  return {ok:true,id:data.id};
 }
 throw fail('unknown_commercial_action');
}
