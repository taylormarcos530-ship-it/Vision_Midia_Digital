const {test}=require('node:test'),assert=require('node:assert/strict');
const file='../supabase/releases/commercial_master_management_20261018/_shared/commercial-points.mjs';
const id='11111111-1111-4111-8111-111111111111';
function client(name){
 const saved=[];
 const admin={from(table){
  if(table==='devices'){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id,name,retired_at:null},error:null})};return q;}
  assert.equal(table,'vision_commercial_point_profile');
  return {upsert:async(v,opts)=>{saved.push(v);assert.equal(opts.onConflict,'device_id');return {error:null};}};
 }};
 return {admin,saved};
}
test('location privacy: home and test TV never publishes address',async()=>{
 const {commercialSavePublicPoint}=await import(file);
 const {admin,saved}=client('Teste casa');
 await assert.rejects(()=>commercialSavePublicPoint(admin,{id},{device_id:id,share_location:true,consent_confirmed:true,public_label:'Casa',city:'Anápolis'}),/private_test_device_location_blocked/);
 assert.equal(saved.length,0);
 const off=await commercialSavePublicPoint(admin,{id},{device_id:id,share_location:false,public_address:'residential',city:'Anápolis'});
 assert.equal(off.share_location,false);
 assert.equal(saved[0].consent_confirmed_at,null);
});
test('business sharing requires consent and public label; Master may revoke anytime',async()=>{
 const {commercialSavePublicPoint}=await import(file);
 const {admin,saved}=client('Academia Life');
 await assert.rejects(()=>commercialSavePublicPoint(admin,{id},{device_id:id,share_location:true,public_label:'Life',city:'Anápolis'}),/public_point_consent_required/);
 const allowed=await commercialSavePublicPoint(admin,{id},{device_id:id,share_location:true,consent_confirmed:true,public_label:'Academia Life',public_address:'Rua Comercial 123',city:'Anápolis'});
 assert.equal(allowed.ok,true);assert.equal(saved[0].share_location,true);
 assert.equal(saved[0].consent_confirmed_by,id);
 await commercialSavePublicPoint(admin,{id},{device_id:id,share_location:false,consent_confirmed:false});
 assert.equal(saved[1].share_location,false);assert.equal(saved[1].consent_confirmed_at,null);
});
test('only Master management exposes business point actions, not advertiser mutation',()=>{
 const fs=require('node:fs');
 const master=fs.readFileSync('supabase/releases/commercial_master_management_20261018/_shared/commercial-master.mjs','utf8');
 assert.match(master,/commercial_point_save/);
 assert.match(master,/point_profiles:requireData/);
 assert.match(master,/\['admin','super_admin'\]\.includes\(role\)/);
});
