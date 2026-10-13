const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../supabase/functions/_shared/commercial-media.mjs');
const asset={id:'media-1',storage_path:'point/offers/ad.webp',processing_status:'ready',media_type:'image',checksum_sha256:'hash-1',updated_at:'2026-10-13T00:00:00.000Z'};
function fixture({previous=null,copyError=null,rpcError=null,knownSnapshot=false}={}){
 const calls={copy:[],remove:[],rpc:[]};
 const admin={
  from(table){
   const q={select(){return q},eq(){return q},limit:async()=>({data:knownSnapshot?[{id:'saved'}]:[],error:null}),
    maybeSingle:async()=>{
     if(table==='media_assets')return {data:asset,error:null};
     if(table==='vision_commercial_campaigns')return {data:{id:'campaign-1',advertiser_id:'adv-1',current_revision_id:previous?'revision-1':null},error:null};
     if(table==='vision_commercial_revisions')return {data:previous,error:null};
     return {data:null,error:null};
    }};
   return q;
  },
  storage:{from(bucket){assert.equal(bucket,'vision-media');return {
   copy:async(source,dest)=>{calls.copy.push({source,dest});return {error:copyError?new Error('copy_failed'):null};},
   remove:async paths=>{calls.remove.push(paths);return {error:null};}
  };}},
  rpc:async(name,args)=>{calls.rpc.push({name,args});return rpcError?{error:new Error('rpc_failed')}:{data:{id:'campaign-1',snapshot_used:!!args.p_data.commercial_copy_path}};}
 };
 return {admin,calls};
}
const campaign={advertiser_id:'adv-1',name:'Teste Portal',media_id:'media-1',status:'active',device_ids:['tv-1']};
test('copying a new campaign keeps the original media intact and ignores forged copy paths',async()=>{
 const {saveCommercialWithSnapshot}=await load(),{admin,calls}=fixture();
 const result=await saveCommercialWithSnapshot(admin,'master-1',{...campaign,commercial_copy_path:'point/forged.webp'});
 assert.equal(result.ok,true);
 assert.equal(calls.copy.length,1);
 assert.equal(calls.copy[0].source,'point/offers/ad.webp');
 assert.match(calls.copy[0].dest,/^commercial-ads\/[a-f0-9-]{36}\.webp$/);
 assert.equal(calls.rpc[0].args.p_data.commercial_copy_path,calls.copy[0].dest);
 assert.deepEqual(calls.remove,[]);
});
test('changing campaign dates without changing source file does not duplicate Storage',async()=>{
 const {saveCommercialWithSnapshot}=await load();
 const previous={source_media_id:asset.id,source_storage_path:asset.storage_path,source_updated_at:asset.updated_at,checksum:asset.checksum_sha256};
 const {admin,calls}=fixture({previous});
 const result=await saveCommercialWithSnapshot(admin,'master-1',{...campaign,id:'campaign-1'});
 assert.equal(result.ok,true);assert.equal(calls.copy.length,0);
 assert.equal(calls.rpc[0].args.p_data.commercial_copy_path,null);
});
test('a missing source copy prevents SQL save, without touching customer Storage',async()=>{
 const {saveCommercialWithSnapshot}=await load(),{admin,calls}=fixture({copyError:true});
 await assert.rejects(()=>saveCommercialWithSnapshot(admin,'master-1',campaign),/commercial_media_copy_failed/);
 assert.equal(calls.rpc.length,0);assert.equal(calls.remove.length,0);
});
test('failed SQL save cleans only confirmed unused newly copied object',async()=>{
 const {saveCommercialWithSnapshot}=await load(),{admin,calls}=fixture({rpcError:true});
 await assert.rejects(()=>saveCommercialWithSnapshot(admin,'master-1',campaign),/rpc_failed/);
 assert.equal(calls.copy.length,1);
 assert.deepEqual(calls.remove,[[calls.copy[0].dest]]);
});
test('ambiguous SQL failure never deletes a snapshot known to be referenced',async()=>{
 const {saveCommercialWithSnapshot}=await load(),{admin,calls}=fixture({rpcError:true,knownSnapshot:true});
 await assert.rejects(()=>saveCommercialWithSnapshot(admin,'master-1',campaign),/rpc_failed/);
 assert.deepEqual(calls.remove,[]);
});
