const {test}=require('node:test');
const assert=require('node:assert/strict');

function simulatedMaster(){
 const advertiser={id:'advertiser-test',user_id:'advertiser-auth',name:'Loja do João',status:'active',archived_at:null};
 const log=[];
 const admin={
  from(table){
   assert.equal(table,'vision_advertisers','archive must not touch operational tables');
   let op='read',filterId,filterArchive,hasArchiveFilter=false,payload;
   const query={
    select(){return query},
    eq(field,value){
     if(field==='id')filterId=value;
     if(field==='archived_at'){filterArchive=value;hasArchiveFilter=true;}
     return query;
    },
    is(field,value){if(field==='archived_at'){filterArchive=value;hasArchiveFilter=true;}return query},
    update(fields){op='update';payload=fields;return query},
    async single(){return query.maybeSingle()},
    async maybeSingle(){
     const matches=filterId===advertiser.id&&(!hasArchiveFilter||advertiser.archived_at===filterArchive);
     if(!matches)return {data:null,error:null};
     if(op==='update'){
      assert.ok(!('user_id' in payload),'Auth user must be retained');
      Object.assign(advertiser,payload);log.push({op,fields:payload});
      return {data:{id:advertiser.id},error:null};
     }
     return {data:{...advertiser},error:null};
    }
   };
   return query;
  },
  auth:{admin:{deleteUser(){throw new Error('Auth delete is forbidden')}}}
 };
 return {admin,advertiser,log};
}
test('Master Excluir archives and revokes instead of destroying advertiser data',async()=>{
 const {commercialMaster}=await import('../supabase/functions/_shared/commercial-master.mjs');
 const {admin,advertiser,log}=simulatedMaster(),user={id:'master-1'};
 const archived=await commercialMaster(admin,user,'admin',{action:'commercial_archive_advertiser',id:advertiser.id});
 assert.deepEqual(archived,{ok:true,archived:true});
 assert.equal(advertiser.status,'disabled');
 assert.ok(advertiser.archived_at);
 assert.equal(advertiser.name,'Loja do João');
 assert.equal(log.length,1);
 assert.deepEqual(Object.keys(log[0].fields).sort(),['archived_at','status']);
 await assert.rejects(()=>commercialMaster(admin,user,'admin',{action:'commercial_archive_advertiser',id:advertiser.id}),/advertiser_already_archived/);
 await assert.rejects(()=>commercialMaster(admin,user,'admin',{action:'commercial_update_advertiser',id:advertiser.id,name:'Nova Loja',status:'active'}),/advertiser_archived/);
 assert.equal(log.length,1);
});
test('Restaurar never enables access or campaigns automatically',async()=>{
 const {commercialMaster}=await import('../supabase/functions/_shared/commercial-master.mjs');
 const {admin,advertiser,log}=simulatedMaster(),user={id:'master-1'};
 await commercialMaster(admin,user,'super_admin',{action:'commercial_archive_advertiser',id:advertiser.id});
 const restored=await commercialMaster(admin,user,'super_admin',{action:'commercial_restore_advertiser',id:advertiser.id});
 assert.deepEqual(restored,{ok:true,restored:true,status:'disabled'});
 assert.equal(advertiser.archived_at,null);
 assert.equal(advertiser.status,'disabled');
 assert.equal(log.length,2);
 await assert.rejects(()=>commercialMaster(admin,user,'admin',{action:'commercial_restore_advertiser',id:advertiser.id}),/advertiser_not_archived/);
});
test('Exclusion is Master-only, fails on unknown IDs and does not write to Auth',async()=>{
 const {commercialMaster}=await import('../supabase/functions/_shared/commercial-master.mjs');
 const {admin,advertiser,log}=simulatedMaster();
 await assert.rejects(()=>commercialMaster(admin,{id:'visitor'},'viewer',{action:'commercial_archive_advertiser',id:advertiser.id}),/master_forbidden/);
 await assert.rejects(()=>commercialMaster(admin,{id:'master'},'admin',{action:'commercial_archive_advertiser',id:'missing'}),/advertiser_not_found/);
 assert.equal(advertiser.archived_at,null);assert.equal(log.length,0);
});
