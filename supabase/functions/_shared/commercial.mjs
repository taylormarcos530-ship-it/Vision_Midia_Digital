// Optional manifest augmentation. No writes to customer playlists or player changes.
export function commercialEligibility(primary) {
 if (!primary?.playlist || !primary.items?.length) return 'no_base_playlist';
 if (primary.playlist.shuffle) return 'shuffle_preserved';
 if (primary.playlist.repeat_mode === 'single') return 'single_preserved';
 if (primary.items.some(item => item.schedule?.enabled)) return 'scheduled_base_preserved';
 return null;
}
export function interleave(primary, ads, every = 3) {
 if (commercialEligibility(primary) || !ads?.length) return primary;
 const gap = Number.isInteger(every) && every >= 1 && every <= 20 ? every : 3;
 const items=[]; let cursor=0;
 primary.items.forEach((item,i)=>{items.push(item);if((i+1)%gap===0 && cursor<ads.length)items.push(ads[cursor++]);});
 items.push(...ads.slice(cursor));
 return {...primary,items};
}
export async function bounded(operation, timeoutMs=1500) {
 let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('commercial_timeout')),timeoutMs)})]);}finally{clearTimeout(timer);}
}
export async function augmentCommercial(admin,device,primary,supportsSchedules,enabled,timeZone='America/Sao_Paulo') {
 if (!enabled) return primary;
 const reason=!supportsSchedules?'legacy_player':commercialEligibility(primary)||(timeZone!=='America/Sao_Paulo'?'timezone_preserved':null);
 if(reason){await reportCommercialDelivery(admin,device.id,reason);return primary;}
 try {
 return await bounded(async()=>{
  const {data,error}=await admin.rpc('vision_commercial_manifest',{p_device:device.id});
  if(error)throw error;if(!data?.length){await reportCommercialDelivery(admin,device.id,'no_active_campaign');return primary;}
  const paths=[...new Set(data.map(r=>r.storage_path))];
  const signed=await admin.storage.from('vision-media').createSignedUrls(paths,6*60*60);
  if(signed.error)throw signed.error;
  const urls=new Map((signed.data||[]).filter(r=>r.signedUrl&&!r.error).map(r=>[r.path,r.signedUrl]));
  const ads=data.filter(r=>urls.has(r.storage_path)).map(r=>({
   id:r.id,essential:false,position:0,duration_seconds:r.duration_seconds,
   schedule:{enabled:true,start_date:r.start_date,end_date:r.end_date,start_time:null,end_time:null,weekdays:[0,1,2,3,4,5,6]},
   media:{id:r.id,name:r.name,type:r.media_type,url:urls.get(r.storage_path),size_bytes:r.size_bytes,checksum:r.checksum+':'+r.id,width:r.width,height:r.height}
  }));
  await reportCommercialDelivery(admin,device.id,ads.length===data.length?'manifest_ready':'media_unavailable');
  return interleave(primary,ads);
 });
 }catch(error){console.warn('commercial manifest unavailable; preserving base playlist',error?.message);return primary;}
}
export async function refreshCommercialDaily(admin,deviceId,enabled) {
 if(!enabled)return;
 try{await bounded(async()=>{const {error}=await admin.rpc('vision_commercial_refresh_daily',{p_device:deviceId});if(error)throw error;});}
 catch(error){console.warn('commercial rollup pending retry',error?.message);}
}
export async function decorateCommercialRows(admin,deviceId,rows,enabled) {
 if(!enabled)return rows;
 try{return await bounded(async()=>{
  const ids=[...new Set(rows.map(r=>r.media_id).filter(Boolean))];if(!ids.length)return rows;
  const {data,error}=await admin.rpc('vision_commercial_event_labels',{p_device:deviceId,p_ids:ids});if(error)throw error;
  const names=new Map((data||[]).map(r=>[r.id,r.name]));
  return rows.map(row=>names.has(row.media_id)?{...row,campaign_id:null,campaign_name:'Publicidade comercial',media_name:names.get(row.media_id)}:row);
 });}catch(error){console.warn('commercial event labels unavailable',error?.message);return rows;}
}

async function reportCommercialDelivery(admin,deviceId,status){try{await bounded(()=>admin.rpc('vision_commercial_delivery',{p_device:deviceId,p_status:status}),500)}catch{/* Diagnostic failures must not block the base playlist. */}}
