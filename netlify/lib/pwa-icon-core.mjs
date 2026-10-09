import pngjs from 'pngjs';
import {randomUUID} from 'node:crypto';
const {PNG}=pngjs;
const DEFAULT={name:'Vision Mídia Digital',short_name:'Vision Mídia',description:'Painel de digital signage da Vision Mídia Digital',start_url:'./',scope:'./',display:'standalone',background_color:'#07101f',theme_color:'#0b1220'};
const sizes={'192':192,'512':512,maskable:512};
function manifest(revision){return {...DEFAULT,icons:Object.entries(sizes).map(([key,size])=>({src:revision?`/app-icons/${revision}/${key}.png`:`/icons/vision-${key==='maskable'?'maskable-512':key}.png?v=20261009`,sizes:`${size}x${size}`,type:'image/png',purpose:key==='maskable'?'maskable':'any'}))};}
function json(body,status=200){return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
function validate(body){
 const out={};
 for(const [key,size] of Object.entries(sizes)){
  const raw=body?.icons?.[key];if(typeof raw!=='string'||raw.length>1400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))throw Error('invalid_image');
  const bytes=Buffer.from(raw,'base64');if(bytes.length<33||bytes.length>1048576||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==size||bytes.readUInt32BE(20)!==size)throw Error('invalid_dimensions');
  const decoded=PNG.sync.read(bytes,{checkCRC:true});if(decoded.width!==size||decoded.height!==size)throw Error('invalid_dimensions');out[key]=raw;
 }
 return out;
}
export function createHandler({getStore,authorize}){return async request=>{
 const url=new URL(request.url),path=url.pathname;
 try{
  if(request.method==='POST'&&path==='/api/app-icon'){
   if(request.headers.get('origin')!==url.origin)return json({error:'origin_forbidden'},403);
   const match=/^Bearer (\S+)$/.exec(request.headers.get('authorization')||'');if(!match)return json({error:'login_required'},401);
   const role=await authorize(match[1]);if(!['super_admin','admin'].includes(role))return json({error:'master_required'},403);
   if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'invalid_content_type'},415);
   const text=await request.text();if(text.length>2200000)return json({error:'image_too_large'},413);
   let body,icons;try{body=JSON.parse(text);icons=validate(body);}catch{return json({error:'invalid_image'},400);}
   const store=getStore(),old=await store.getWithMetadata('current',{type:'json'});
   if((body.expected_revision??null)!==(old?.data?.revision??null))return json({error:'icon_changed_reload'},409);
   const revision=randomUUID();await store.setJSON('revisions/'+revision,{icons});
   const saved=await store.setJSON('current',{revision},{...(old?{onlyIfMatch:old.etag}:{onlyIfNew:true})});
   if(!saved.modified)return json({error:'icon_changed_reload'},409);
   return json({ok:true,revision,icons:manifest(revision).icons});
  }
  if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'method_not_allowed'},405);
  if(path.startsWith('/app-icons/')){
   const match=/^\/app-icons\/([0-9a-f-]{36})\/(192|512|maskable)\.png$/.exec(path);if(!match)return json({error:'not_found'},404);
   const stored=await getStore().get('revisions/'+match[1],{type:'json'});if(!stored?.icons?.[match[2]])return json({error:'not_found'},404);
   return new Response(request.method==='HEAD'?null:Buffer.from(stored.icons[match[2]],'base64'),{headers:{'Content-Type':'image/png','Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff'}});
  }
  const current=await getStore().get('current',{type:'json'}),revision=current?.revision??null;
  if(path==='/app-icon-config')return json({revision,icons:manifest(revision).icons});
  if(path==='/manifest.webmanifest')return new Response(request.method==='HEAD'?null:JSON.stringify(manifest(revision)),{headers:{'Content-Type':'application/manifest+json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return json({error:'not_found'},404);
 }catch{return json({error:'icon_service_unavailable'},503);}
};}
