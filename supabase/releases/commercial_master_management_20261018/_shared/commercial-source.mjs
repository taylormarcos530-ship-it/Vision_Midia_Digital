// Master-only independent advertising uploads. No customer media_asset or playlist writes.
const clean=(x,max)=>String(x??'').trim().slice(0,max);
const formats=Object.freeze({
 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp',
 'video/mp4':'.mp4','video/webm':'.webm'
});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(s)=>{throw Object.assign(new Error(s),{status:400})};
export async function commercialPrepareSource(admin,user,body){
 const mime=clean(body.mime,90).toLowerCase(),name=clean(body.name,140),
  size=Number(body.size_bytes),ext=formats[mime];
 if(!ext||name.length<2||!Number.isSafeInteger(size)||size<1||size>26214400)fail('invalid_commercial_media');
 const id=crypto.randomUUID(),path='commercial-source/'+id+ext;
 const {data,error}=await admin.storage.from('vision-media').createSignedUploadUrl(path,{upsert:false});
 if(error||!data?.token)fail('commercial_upload_unavailable');
 return {ok:true,id,path,upload_token:data.token,max_bytes:26214400};
}
export async function commercialFinalizeSource(admin,user,body){
 const id=clean(body.id,36),name=clean(body.name,140),mime=clean(body.mime,90).toLowerCase(),
  size=Number(body.size_bytes),ext=formats[mime];
 if(!uuid.test(id)||!ext||name.length<2||!Number.isSafeInteger(size)||size<1||size>26214400)fail('invalid_commercial_media');
 const path='commercial-source/'+id+ext;
 const {data:info,error:storageError}=await admin.storage.from('vision-media').info(path);
 if(storageError||!info)fail('commercial_upload_missing');
 const actual=Number(info.size??info.metadata?.size);
 if(!Number.isSafeInteger(actual)||actual<1||actual>26214400||actual!==size)fail('commercial_upload_size_mismatch');
 const actualType=String(info.mimetype||info.mimeType||info.contentType||info.metadata?.mimetype||'').toLowerCase();
 if(actualType&&actualType!==mime)fail('commercial_upload_type_mismatch');
 const record={id,name,media_type:mime.startsWith('image/')?'image':'video',
  storage_path:path,size_bytes:actual,checksum_sha256:clean(info.etag||info.eTag||info.id||id,120),
  duration_seconds:15,created_by:user.id};
 const {data,error}=await admin.from('vision_commercial_sources').insert(record).select('id,name,media_type,storage_path,size_bytes').single();
 if(error||!data)fail('commercial_media_registration_failed');
 return {ok:true,creative:data};
}
