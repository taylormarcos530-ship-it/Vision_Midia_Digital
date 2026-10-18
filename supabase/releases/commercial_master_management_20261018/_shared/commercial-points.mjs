// Master-managed business directory. PRIVATE by default; never infer/share a home address.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const val=(x,max)=>String(x??'').trim().slice(0,max);
const fail=(message)=>{throw Object.assign(new Error(message),{status:400});};
export async function commercialSavePublicPoint(admin,user,body){
 const deviceId=val(body.device_id,36);
 if(!uuid.test(deviceId))fail('invalid_public_point_device');
 const {data:device,error:deviceError}=await admin.from('devices').select('id,name,retired_at').eq('id',deviceId).maybeSingle();
 if(deviceError)throw deviceError;
 if(!device||device.retired_at)fail('public_point_not_found');
 const consent=body.consent_confirmed===true;
 const share=body.share_location===true;
 // Test devices and installations in private homes can never be published by mistake.
 if(share&&/teste|casa|home|resid[eê]ncia/i.test(device.name))fail('private_test_device_location_blocked');
 const label=val(body.public_label,100),address=val(body.public_address,220),
  neighborhood=val(body.neighborhood,110),city=val(body.city,110);
 if(share&&(!consent||city.length<2||!label))fail('public_point_consent_required');
 const record={
  device_id:deviceId,public_label:label||null,public_address:address||null,
  neighborhood:neighborhood||null,city:city||null,share_location:share,
  consent_confirmed_at:share?new Date().toISOString():null,
  consent_confirmed_by:share?user.id:null,
  updated_at:new Date().toISOString()
 };
 const {error}=await admin.from('vision_commercial_point_profile').upsert(record,{onConflict:'device_id'});
 if(error)throw error;
 return {ok:true,device_id:deviceId,share_location:share};
}
