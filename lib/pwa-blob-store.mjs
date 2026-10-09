export function createBlobStore(api){
 const pathname=key=>'pwa-icons-v1/'+key+'.json';
 async function read(key){const r=await api.get(pathname(key),{access:'private',useCache:false});if(!r)return null;if(r.statusCode!==200)throw Error('blob_read_failed');return{data:await new Response(r.stream).json(),etag:r.blob.etag};}
 return{getWithMetadata:read,async get(key){return(await read(key))?.data??null;},async setJSON(key,data,options={}){
  try{const r=await api.put(pathname(key),JSON.stringify(data),{access:'private',addRandomSuffix:false,contentType:'application/json',allowOverwrite:Boolean(options.onlyIfMatch),...(options.onlyIfMatch?{ifMatch:options.onlyIfMatch}:{})});return{modified:true,etag:r.etag};}
  catch(e){if(e.name==='BlobPreconditionFailedError')return{modified:false};if(options.onlyIfNew&&await read(key))return{modified:false};throw e;}
 }};
}
