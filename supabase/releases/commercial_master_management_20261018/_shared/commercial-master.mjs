import {saveCommercialWithSnapshot} from './commercial-media.mjs';
import {commercialPrepareSource,commercialFinalizeSource} from './commercial-source.mjs';
import {commercialMasterPreviews} from './commercial-preview.mjs';
import {commercialSavePublicPoint} from './commercial-points.mjs';
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
  const [advertisers,campaigns,devices,media,companies,revisions,sources,pointProfiles]=await Promise.all([
   admin.from('vision_advertisers').select('*').order('created_at',{ascending:false}),
   admin.from('vision_commercial_campaigns').select('*').order('created_at',{ascending:false}),
   admin.from('devices').select('id,company_id,name,last_seen_at').is('retired_at',null),
   admin.from('media_assets').select('id,company_id,name,media_type').eq('processing_status','ready').in('media_type',['image','video']),
   admin.from('companies').select('id,name'),
   admin.from('vision_commercial_revisions').select('id,campaign_id,source_media_id'),
   admin.from('vision_commercial_sources').select('id,name,media_type,storage_path,size_bytes'),
   admin.from('vision_commercial_point_profile').select('device_id,public_label,public_address,neighborhood,city,share_location,consent_confirmed_at')]);
  return {ok:true,advertisers:requireData(advertisers),campaigns:requireData(campaigns),devices:requireData(devices),media:requireData(media),companies:requireData(companies),revisions:requireData(revisions),sources:requireData(sources),point_profiles:requireData(pointProfiles)};
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
 if(action==='commercial_point_save')return commercialSavePublicPoint(admin,user,body);
 if(action==='commercial_media_previews')return commercialMasterPreviews(admin,body.ids);
 if(action==='commercial_prepare_source')return commercialPrepareSource(admin,user,body);
 if(action==='commercial_finalize_source')return commercialFinalizeSource(admin,user,body);
 if(action==='commercial_archive_campaign'||action==='commercial_restore_campaign'){
  const campaignId=clean(body.id,36);
  if(!/^[0-9a-f-]{36}$/i.test(campaignId))throw fail('invalid_campaign_id');
  const actionName=action==='commercial_archive_campaign'?'vision_commercial_archive_campaign':'vision_commercial_restore_campaign';
  return requireData(await admin.rpc(actionName,{p_actor:user.id,p_campaign:campaignId}));
 }
 if(action==='commercial_save_campaign')return saveCommercialWithSnapshot(admin,user.id,body.campaign);
 if(action==='commercial_report')return {ok:true,...requireData(await admin.rpc('vision_commercial_master_report',{p_actor:user.id,p_advertiser:body.id}))};
 throw fail('unknown_commercial_action');
}
