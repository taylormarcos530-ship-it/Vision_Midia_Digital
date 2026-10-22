import {createClient} from 'npm:@supabase/supabase-js@2'

// Standalone v1: neither player, advertisers nor customer playlists are modified.
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const J=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:C});
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
const short=(v:unknown,max=120)=>String(v??'').trim().slice(0,max);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const privateTv=(v:unknown)=>/\bteste\b|^\s*casa\s*$|^\s*home\s*$|^\s*resid[eê]ncia\b/i.test(String(v||''));
const mediaPath=/^vision-network\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/i;
function client(){
  let service='';
  try{service=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')?.default||''}catch{}
  service ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  let publishable='';
  try{publishable=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}')?.default||''}catch{}
  publishable ||= Deno.env.get('SUPABASE_ANON_KEY')||'';
  const url=Deno.env.get('SUPABASE_URL')||'';
  if(!url||!service||!publishable)throw fail('configuration_unavailable',503);
  return{url,publishable,admin:createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})};
}
function unwrap(response:any){if(response.error)throw response.error;return response.data}
async function requireMaster(req:Request,admin:any,url:string,pub:string){
  const header=req.headers.get('authorization')||'';
  if(!header.startsWith('Bearer '))throw fail('login_required',401);
  const token=header.slice(7);
  const userClient=createClient(url,pub,{global:{headers:{Authorization:header}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await userClient.auth.getUser(token);
  if(error||!data?.user)throw fail('session_expired',401);
  const master=unwrap(await admin.from('platform_admins').select('role,status').eq('user_id',data.user.id).maybeSingle());
  if(master?.status!=='active'||!['admin','super_admin'].includes(master.role))throw fail('master_only',403);
  return data.user;
}
async function signPhotos(admin:any,paths:string[]){
  const result:string[]=[];
  for(const path of (paths||[]).slice(0,3)){
    if(!mediaPath.test(path))continue;
    const {data,error}=await admin.storage.from('vision-media').createSignedUrl(path,3600);
    if(!error&&data?.signedUrl)result.push(data.signedUrl);
  }
  return result;
}
async function makePublic(admin:any){
  const points=unwrap(await admin.from('vision_network_points')
    .select('id,company_id,slug,name,category,city,neighborhood,public_address,opening_hours,estimated_daily_visitors,photo_paths,share_address')
    .eq('published',true).not('consent_confirmed_at','is',null)
    .order('name').limit(150))||[];
  if(!points.length)return [];
  const joins=unwrap(await admin.from('vision_network_point_tvs')
    .select('point_id,device_id,screen_inches,placement').in('point_id',points.map((p:any)=>p.id)))||[];
  const devices=joins.length?unwrap(await admin.from('devices')
    .select('id,company_id,name,orientation,paired_at,retired_at').in('id',[...new Set(joins.map((t:any)=>t.device_id))]))||[]:[];
  const byId=new Map(devices.map((d:any)=>[d.id,d]));
  const out=[];
  for(const p of points){
    const tvs=joins.filter((link:any)=>{
      const d:any=byId.get(link.device_id);
      return link.point_id===p.id&&d&&d.company_id===p.company_id&&!d.retired_at&&d.paired_at&&!privateTv(d.name);
    }).map((link:any)=>{
      const d:any=byId.get(link.device_id);
      return {size_inches:link.screen_inches||null,orientation:d.orientation||'auto',placement:link.placement||''};
    });
    if(!tvs.length)continue; // never advertise a point without a valid, paired screen
    out.push({id:p.id,slug:p.slug,name:p.name,category:p.category,city:p.city,
      neighborhood:p.neighborhood,address:p.share_address?p.public_address:'',hours:p.opening_hours,
      estimated_daily_visitors:p.estimated_daily_visitors,tv_count:tvs.length,tvs,
      photos:await signPhotos(admin,p.photo_paths)});
  }
  return out;
}
async function makeMaster(admin:any){
  const [ps,co,ds,links]=await Promise.all([
    admin.from('vision_network_points').select('*').order('created_at',{ascending:false}).limit(200),
    admin.from('companies').select('id,name').order('name'),
    admin.from('devices').select('id,name,company_id,orientation,paired_at,retired_at').is('retired_at',null).order('name'),
    admin.from('vision_network_point_tvs').select('*'),
  ]);
  const points=unwrap(ps)||[],companies=unwrap(co)||[],devices=unwrap(ds)||[],tvs=unwrap(links)||[];
  const enriched=await Promise.all(points.map(async(p:any)=>({...p,
    tvs:tvs.filter((t:any)=>t.point_id===p.id),
    photos:await signPhotos(admin,p.photo_paths)})));
  return{points:enriched,companies,devices:devices.map((d:any)=>({
    id:d.id,name:d.name,company_id:d.company_id,orientation:d.orientation,
    allowed:!!d.paired_at&&!privateTv(d.name)
  }))};
}
async function savePoint(admin:any,user:any,raw:any){
  const currentId=short(raw.id,80);
  if(currentId&&!uuid.test(currentId))throw fail('invalid_point');
  const existing=currentId?unwrap(await admin.from('vision_network_points').select('*').eq('id',currentId).maybeSingle()):null;
  if(currentId&&!existing)throw fail('point_not_found',404);
  const companyId=existing?.company_id||short(raw.company_id,80);
  if(!uuid.test(companyId))throw fail('invalid_company');
  if(!unwrap(await admin.from('companies').select('id').eq('id',companyId).maybeSingle()))throw fail('company_not_found',404);
  const name=short(raw.name,120),category=short(raw.category,70)||'Comércio';
  const city=short(raw.city,100),neighborhood=short(raw.neighborhood,100);
  const consent=raw.consent===true,published=raw.published===true,shareAddress=raw.share_address===true;
  if(name.length<2||category.length<2)throw fail('name_and_category_required');
  if(published&&(!consent||!city||!neighborhood))throw fail('publication_requires_consent_and_location');
  if(shareAddress&&!consent)throw fail('address_requires_consent');
  const wanted=Array.isArray(raw.tvs)?raw.tvs:[];
  if(wanted.length>12)throw fail('too_many_screens');
  const tvIds=wanted.map((v:any)=>short(v.device_id,80));
  if(new Set(tvIds).size!==tvIds.length||tvIds.some((v:string)=>!uuid.test(v)))throw fail('invalid_tv_selection');
  if(published&&!tvIds.length)throw fail('publication_requires_tv');
  const matching=tvIds.length?unwrap(await admin.from('devices')
    .select('id,name,company_id,paired_at,retired_at').in('id',tvIds))||[]:[];
  if(matching.length!==tvIds.length||matching.some((d:any)=>d.company_id!==companyId||!d.paired_at||d.retired_at||privateTv(d.name)))throw fail('tv_not_eligible_for_public_catalog');
  if(tvIds.length){
    const collisions=unwrap(await admin.from('vision_network_point_tvs').select('point_id,device_id').in('device_id',tvIds))||[];
    if(collisions.some((x:any)=>x.point_id!==currentId))throw fail('tv_already_used_by_another_point');
  }
  const tvs=wanted.map((value:any)=>{
    const inches=value.screen_inches===''||value.screen_inches==null?null:Number(value.screen_inches);
    if(inches!==null&&(!Number.isInteger(inches)||inches<10||inches>120))throw fail('invalid_tv_inches');
    return {device_id:short(value.device_id,80),screen_inches:inches,placement:short(value.placement,120)};
  });
  let footfall=null;
  if(raw.estimated_daily_visitors!==''&&raw.estimated_daily_visitors!=null){
    footfall=Number(raw.estimated_daily_visitors);
    if(!Number.isInteger(footfall)||footfall<0||footfall>1000000)throw fail('invalid_estimated_visitors');
  }
  const id=existing?.id||crypto.randomUUID();
  const slug=existing?.slug||
    (name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,58)||'ponto')
    +'-'+id.slice(0,8);
  const row={
    id,company_id:companyId,slug,name,category,city,neighborhood,
    public_address:short(raw.public_address,220),opening_hours:short(raw.opening_hours,220),
    estimated_daily_visitors:footfall,share_address:shareAddress,
    published,consent_confirmed_at:consent?(existing?.consent_confirmed_at||new Date().toISOString()):null,
    consent_confirmed_by:consent?user.id:null,updated_at:new Date().toISOString(),
  };
  // Set new/updated master metadata before linking TV; never mutate devices or their playlists.
  unwrap(await admin.from('vision_network_points').upsert(row,{onConflict:'id'}).select('id').single());
  // Add/update validated TVs before removing obsolete links. A failed insert can no
  // longer erase previously saved screen associations.
  if(tvs.length){
    unwrap(await admin.from('vision_network_point_tvs')
      .upsert(tvs.map((t:any)=>({...t,point_id:id})),{onConflict:'point_id,device_id'}));
  }
  if(existing){
    const removed=unwrap(await admin.from('vision_network_point_tvs')
      .select('device_id').eq('point_id',id))||[];
    for(const row of removed){
      if(!tvIds.includes(row.device_id)){
        unwrap(await admin.from('vision_network_point_tvs')
          .delete().eq('point_id',id).eq('device_id',row.device_id));
      }
    }
  }
  return{id};
}
async function uploadStart(admin:any,body:any){
  const id=short(body.id,80),mime=short(body.mime,80),size=Number(body.size_bytes);
  if(!uuid.test(id)||!['image/png','image/jpeg','image/webp'].includes(mime)||!Number.isInteger(size)||size<1||size>4000000)throw fail('invalid_photo');
  const found=unwrap(await admin.from('vision_network_points').select('id,photo_paths').eq('id',id).maybeSingle());
  if(!found)throw fail('point_not_found',404);
  if((found.photo_paths||[]).length>=3)throw fail('photo_limit_three');
  const ext=mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'webp';
  const path='vision-network/'+id+'/'+crypto.randomUUID()+'.'+ext;
  const {data,error}=await admin.storage.from('vision-media').createSignedUploadUrl(path);
  if(error||!data?.token)throw fail('upload_unavailable',503);
  return{path,token:data.token};
}
async function photoAttach(admin:any,body:any){
  const id=short(body.id,80),path=short(body.path,260);
  if(!uuid.test(id)||!mediaPath.test(path)||!path.startsWith('vision-network/'+id+'/'))throw fail('invalid_photo');
  const p=unwrap(await admin.from('vision_network_points').select('photo_paths').eq('id',id).maybeSingle());
  if(!p)throw fail('point_not_found',404);
  const photos=(p.photo_paths||[]) as string[];
  if(photos.includes(path))return{ok:true};
  if(photos.length>=3)throw fail('photo_limit_three');
  // Signed URL alone never adds a public photo. Verify bytes exist on storage first.
  const {data:file,error}=await admin.storage.from('vision-media').download(path);
  if(error||!file||file.size>4000000||!file.size)throw fail('photo_upload_not_finished');
  unwrap(await admin.from('vision_network_points').update({photo_paths:[...photos,path],updated_at:new Date().toISOString()}).eq('id',id));
  return{ok:true};
}
async function removePhoto(admin:any,body:any){
  const id=short(body.id,80),path=short(body.path,260);
  if(!uuid.test(id)||!path.startsWith('vision-network/'+id+'/'))throw fail('invalid_photo');
  const p=unwrap(await admin.from('vision_network_points').select('photo_paths').eq('id',id).maybeSingle());
  if(!p)throw fail('point_not_found',404);
  unwrap(await admin.from('vision_network_points').update({photo_paths:(p.photo_paths||[]).filter((x:string)=>x!==path),updated_at:new Date().toISOString()}).eq('id',id));
  // Retain original storage bytes for audit and recovery; never delete customer media.
  return{ok:true};
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C});
  if(req.method!=='POST')return J({error:'method_not_allowed'},405);
  try{
    const body=await req.json().catch(()=>({})),action=short(body.action,40);
    const {admin,url,publishable}=client();
    if(action==='public_list'){
      const {data}=await admin.from('platform_public_config').select('support_whatsapp').eq('id',1).maybeSingle();
      const digits=String(data?.support_whatsapp||'').replace(/\D/g,'').slice(0,15);
      return J({ok:true,points:await makePublic(admin),whatsapp:digits});
    }
    const user=await requireMaster(req,admin,url,publishable);
    if(action==='master_list')return J({ok:true,...await makeMaster(admin)});
    if(action==='save')return J({ok:true,...await savePoint(admin,user,body.point||{})});
    if(action==='photo_start')return J({ok:true,...await uploadStart(admin,body)});
    if(action==='photo_attach')return J(await photoAttach(admin,body));
    if(action==='photo_remove')return J(await removePhoto(admin,body));
    return J({error:'unknown_action'},400);
  }catch(error:any){
    console.error('vision-network-points',error?.message||error);
    return J({error:error?.message||'internal_error'},Number(error?.status||500));
  }
});
