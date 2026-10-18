const {test}=require('node:test'),assert=require('node:assert/strict');
const helper='../supabase/releases/commercial_master_management_20261018/_shared/commercial-preview.mjs';
const idA='11111111-1111-4111-8111-111111111111',idB='22222222-2222-4222-8222-222222222222',idC='33333333-3333-4333-8333-333333333333';
test('only Master may call signed media preview action, never advertiser portal',async()=>{
 const fs=require('node:fs');
 const dispatch=fs.readFileSync('supabase/releases/commercial_master_management_20261018/_shared/commercial-master.mjs','utf8');
 assert.match(dispatch,/\['admin','super_admin'\]\.includes\(role\)/);
 assert.match(dispatch,/action==='commercial_media_previews'/);
 assert.doesNotMatch(fs.readFileSync('advertiser-portal.mjs','utf8'),/commercial_media_previews/);
});
test('Master previews sign only verified DB media IDs and avoid arbitrary paths',async()=>{
 const {commercialMasterPreviews}=await import(helper);
 const calls=[],admin={
  from(table){
   assert.ok(['media_assets','vision_commercial_sources'].includes(table));
   let filters=[];
   const q={select:()=>q,in:(k,values)=>{assert.equal(k,'id');assert.deepEqual(values,[idA,idB,idC]);return q;},eq:(k,v)=>{filters.push([k,v]);return q;},then(resolve){
     if(table==='media_assets')assert.deepEqual(filters,[['processing_status','ready']]);
     return Promise.resolve({data:table==='vision_commercial_sources'?
      [{id:idA,storage_path:'commercial-source/'+idA+'.mp4',media_type:'video'}]:
      [{id:idB,storage_path:'customer/image.webp',media_type:'image'},
       {id:idC,storage_path:'../hidden',media_type:'image'}],error:null}).then(resolve);
   }};
   return q;
  },
  storage:{from(bucket){assert.equal(bucket,'vision-media');return {createSignedUrls:async(paths,ttl)=>{
    calls.push({paths,ttl});return {data:paths.map(path=>({path,signedUrl:'https://example.test/'+path})),error:null};
  }};}}
 };
 const out=await commercialMasterPreviews(admin,[idA,idB,idC]);
 assert.equal(out.ok,true);assert.equal(out.previews.length,2);assert.deepEqual(calls[0].paths,['commercial-source/'+idA+'.mp4','customer/image.webp']);
 assert.equal(calls[0].ttl,180);
});
test('invalid preview request returns 400 before access to storage or DB',async()=>{
 const {commercialMasterPreviews}=await import(helper);
 await assert.rejects(()=>commercialMasterPreviews({},['../../storage']),/invalid_preview_selection/);
 await assert.rejects(()=>commercialMasterPreviews({},Array(31).fill(idA)),/invalid_preview_selection/);
});
