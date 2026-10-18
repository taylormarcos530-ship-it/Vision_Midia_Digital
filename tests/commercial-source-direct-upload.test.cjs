const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../supabase/releases/commercial_master_management_20261018/_shared/commercial-source.mjs');
test('Master upload creates isolated, no-overwrite signed source only',async()=>{
 const {commercialPrepareSource}=await load();
 let path='';
 const admin={storage:{from(bucket){assert.equal(bucket,'vision-media');return {
 createSignedUploadUrl:async(p,opts)=>{path=p;assert.deepEqual(opts,{upsert:false});return {data:{token:'mock-token'},error:null};}
 };}}};
 const result=await commercialPrepareSource(admin,{id:'master'},{mime:'image/png',name:'Publicidade Teste',size_bytes:1212});
 assert.equal(result.ok,true);assert.equal(result.upload_token,'mock-token');
 assert.match(path,/^commercial-source\/[a-f0-9-]{36}\.png$/);
 await assert.rejects(()=>commercialPrepareSource(admin,{id:'master'},{mime:'text/html',name:'XSS',size_bytes:10}),/invalid_commercial_media/);
 await assert.rejects(()=>commercialPrepareSource(admin,{id:'master'},{mime:'video/mp4',name:'Ad',size_bytes:50000000}),/invalid_commercial_media/);
});
test('Master finalizes only uploaded exact-size immutable source',async()=>{
 const {commercialFinalizeSource}=await load();
 const id='00000000-0000-4000-8000-000000000040',writes=[];
 const admin={storage:{from:()=>({info:async path=>{assert.equal(path,'commercial-source/'+id+'.webp');return {data:{size:100,mimetype:'image/webp'},error:null};}})},
 from:t=>{assert.equal(t,'vision_commercial_sources');return {insert:r=>{writes.push(r);return {select:()=>({single:async()=>({data:{id:r.id,name:r.name},error:null})})};}};}};
 const data=await commercialFinalizeSource(admin,{id:'master-uuid'},{id,name:'Teste de oferta',mime:'image/webp',size_bytes:100});
 assert.equal(data.ok,true);assert.equal(writes.length,1);
 assert.equal(writes[0].created_by,'master-uuid');
 assert.equal(writes[0].storage_path,'commercial-source/'+id+'.webp');
 await assert.rejects(()=>commercialFinalizeSource(admin,{id:'master-uuid'},{id,name:'Teste de oferta',mime:'image/webp',size_bytes:50}),/size_mismatch/);
});
test('commercial source never alters point library and remains Master-only',async()=>{
 const {saveCommercialWithSnapshot}=await import('../supabase/releases/commercial_master_management_20261018/_shared/commercial-media.mjs');
 const calls=[];
 const admin={from:table=>{
  assert.equal(table,'vision_commercial_sources');
  const q={select:cols=>{assert.doesNotMatch(cols,/processing_status/);return q;},eq:()=>q,maybeSingle:async()=>({data:{id:'source-1',storage_path:'commercial-source/mock.png',media_type:'image',checksum_sha256:'hash',updated_at:'2026-10-18T00:00:00Z'},error:null})};
  return q;
 },storage:{from:()=>({copy:async(a,b)=>{calls.push([a,b]);return {error:null}}})},
 rpc:async(name,args)=>{assert.equal(name,'vision_commercial_save_campaign');assert.equal(args.p_data.commercial_source_id,'source-1');return {data:{id:'campaign',snapshot_used:true},error:null};}};
 const result=await saveCommercialWithSnapshot(admin,'master',{advertiser_id:'adv',commercial_source_id:'source-1',name:'Ad',device_ids:['tv']});
 assert.equal(result.ok,true);assert.equal(calls.length,1);assert.equal(calls[0][0],'commercial-source/mock.png');
});
