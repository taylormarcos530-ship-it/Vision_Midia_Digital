// Isolated, opt-in staging workflow: never modifies a customer's media or playlist.
const commercialError=(message,status=400)=>Object.assign(new Error(message),{status});
const unwrap=result=>{if(result?.error)throw result.error;return result?.data;};
const sameInstant=(a,b)=>a&&b&&Date.parse(a)===Date.parse(b);
const snapshotSuffix=path=>{
 const suffix=String(path||'').split('/').pop()?.split('.').pop()?.toLowerCase();
 return /^(png|jpe?g|webp|gif|mp4|mov|webm|m4v)$/i.test(suffix||'')?'.'+suffix:'';
};
export function commercialNeedsSnapshot(asset,revision){
 return !revision||revision.source_media_id!==asset.id||
   revision.source_storage_path!==asset.storage_path||
   (revision.checksum||'')!==(asset.checksum_sha256||'')||
   !sameInstant(revision.source_updated_at,asset.updated_at);
}
async function unlinkOrphan(admin,path){
 try{
  const result=await admin.from('vision_commercial_revisions').select('id').eq('storage_path',path).limit(1);
  if(result.error||result.data?.length)return;
  await admin.storage.from('vision-media').remove([path]);
 }catch{/* An unverified copy must not be deleted if an RPC may have committed. */}
}
export async function saveCommercialWithSnapshot(admin,actorId,campaign){
 if(!campaign||typeof campaign!=='object'||!campaign.media_id||!campaign.advertiser_id)
  throw commercialError('invalid_campaign');
 const media=unwrap(await admin.from('media_assets').select('id,storage_path,processing_status,media_type,checksum_sha256,updated_at').eq('id',campaign.media_id).maybeSingle());
 if(!media||media.processing_status!=='ready'||!['image','video'].includes(media.media_type)||!media.storage_path)
  throw commercialError('ready_image_or_video_required');
 let previous=null;
 if(campaign.id){
  const existing=unwrap(await admin.from('vision_commercial_campaigns').select('id,advertiser_id,current_revision_id').eq('id',campaign.id).eq('advertiser_id',campaign.advertiser_id).maybeSingle());
  if(!existing)throw commercialError('campaign_not_found',404);
  if(existing.current_revision_id){
   previous=unwrap(await admin.from('vision_commercial_revisions').select('source_media_id,source_storage_path,source_updated_at,checksum').eq('id',existing.current_revision_id).maybeSingle());
   if(!previous)throw commercialError('campaign_revision_missing',409);
  }
 }
 const needsCopy=commercialNeedsSnapshot(media,previous);
 let copied=null;
 if(needsCopy){
  copied='commercial-ads/'+crypto.randomUUID()+snapshotSuffix(media.storage_path);
  const {error}=await admin.storage.from('vision-media').copy(media.storage_path,copied);
  if(error)throw commercialError('commercial_media_copy_failed',409);
 }
 try{
  // Never trust a snapshot path supplied by the browser.
  const payload={...campaign,commercial_copy_path:copied};
  const response=unwrap(await admin.rpc('vision_commercial_save_campaign',{p_actor:actorId,p_data:payload}));
  if(copied&&response?.snapshot_used!==true)await unlinkOrphan(admin,copied);
  return {ok:true,...response};
 }catch(error){
  if(copied)await unlinkOrphan(admin,copied);
  throw error;
 }
}
