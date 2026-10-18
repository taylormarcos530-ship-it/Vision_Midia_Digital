// Master-only temporary previews. No access token or service_role key goes to the browser.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function commercialMasterPreviews(admin,ids){
 if(!Array.isArray(ids)||ids.length<1||ids.length>30||ids.some(id=>typeof id!=='string'||!uuid.test(id)))
  throw Object.assign(new Error('invalid_preview_selection'),{status:400});
 const unique=[...new Set(ids)];
 const [sources,assets]=await Promise.all([
  admin.from('vision_commercial_sources').select('id,storage_path,media_type').in('id',unique),
  admin.from('media_assets').select('id,storage_path,media_type').in('id',unique).eq('processing_status','ready')
 ]);
 if(sources.error||assets.error)throw Object.assign(new Error('commercial_preview_lookup_failed'),{status:503});
 const allowed=[...(sources.data||[]),...(assets.data||[])].filter(row=>
  row?.id&&typeof row.storage_path==='string'&&
  ['image','video'].includes(row.media_type)&&
  row.storage_path.length<400&&row.storage_path.indexOf('..')<0
 );
 if(!allowed.length)return {ok:true,previews:[]};
 const paths=[...new Set(allowed.map(row=>row.storage_path))];
 const {data,error}=await admin.storage.from('vision-media').createSignedUrls(paths,180);
 if(error)throw Object.assign(new Error('commercial_preview_unavailable'),{status:503});
 const urls=new Map((data||[]).filter(x=>x?.path&&x?.signedUrl&&!x.error).map(x=>[x.path,x.signedUrl]));
 return {ok:true,previews:allowed.filter(row=>urls.has(row.storage_path)).map(row=>({
  id:row.id,url:urls.get(row.storage_path),type:row.media_type
 }))};
}
