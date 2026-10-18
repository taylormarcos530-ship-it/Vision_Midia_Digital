// Commercial staging ONLY. Authenticated Master may probe a private Storage upload,
 // immutable commercial copy, short signed read and deletion. No DB/device writes.
const sampleB64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO97GrEAAAAASUVORK5CYII=';
function bytes(){
 const b=atob(sampleB64);
 return Uint8Array.from(b,c=>c.charCodeAt(0));
}
export async function stagingStorageProbe(admin,fetcher=fetch){
 const content=bytes();
 const source='qa-commercial-probe/'+crypto.randomUUID()+'.png';
 const copy='commercial-ads/'+crypto.randomUUID()+'.png';
 const bucket=admin.storage.from('vision-media');
 let failure=null,readVerified=false,copyVerified=false,uploadVerified=false;
 try{
  const uploaded=await bucket.upload(source,content,{upsert:false,contentType:'image/png',cacheControl:'60'});
  if(uploaded.error)throw new Error('upload_failed');
  uploadVerified=true;
  const copied=await bucket.copy(source,copy);
  if(copied.error)throw new Error('copy_failed');
  copyVerified=true;
  const signed=await bucket.createSignedUrl(copy,60);
  if(signed.error||!signed.data?.signedUrl)throw new Error('sign_failed');
  // The signed URL is never sent back to the browser or stored in logs.
  const response=await fetcher(signed.data.signedUrl,{method:'GET',redirect:'error'});
  if(!response.ok)throw new Error('signed_read_failed');
  const received=new Uint8Array(await response.arrayBuffer());
  if(received.length!==content.length||received.some((n,i)=>n!==content[i]))
   throw new Error('content_mismatch');
  readVerified=true;
 }catch(e){failure=e}
 // Always attempt cleanup, including errors after upload or copy.
 let cleanupOk=false;
 try{
  const removed=await bucket.remove([copy,source]);
  cleanupOk=!removed.error;
 }catch{cleanupOk=false}
 if(!cleanupOk)throw new Error('staging_storage_probe_cleanup_failed');
 if(failure)throw new Error('staging_storage_probe_'+(failure.message||'failed'));
 return {ok:true,staging_only:true,uploaded:uploadVerified,copied:copyVerified,
  signed_read_verified:readVerified,cleanup_verified:true,production_untouched:true};
}
