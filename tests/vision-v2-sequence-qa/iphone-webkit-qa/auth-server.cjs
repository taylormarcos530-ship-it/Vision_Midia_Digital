// Synthetic 127.0.0.1 server for authenticated Vision iPhone WebKit QA.
// Strictly no official URLs, accounts, side effects, or network proxies.
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const ROOT=process.cwd(),HOST='127.0.0.1',PORT=8876;
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
 '.mjs':'application/javascript; charset=utf-8','.css':'text/css','.svg':'image/svg+xml',
 '.png':'image/png','.webp':'image/webp','.json':'application/json',
 '.webmanifest':'application/manifest+json'};
const events=[],now='2026-11-02T16:00:00-03:00';
const uid='00000000-0000-4000-8000-000000000001';
const company='00000000-0000-4000-8000-000000000002';
const devid='00000000-0000-4000-8000-000000000003';
const mid='00000000-0000-4000-8000-000000000004';
const playlist='00000000-0000-4000-8000-000000000005';
const member={id:uid,email:'cliente-qa@example.invalid',user_metadata:{display_name:'Cliente QA'}};
const plan={id:'plan-qa',name:'Plano Sintético',monthly_price_cents:10000,description:'Apenas QA',
  is_active:true,max_devices:10,max_users:10,max_campaigns:30,storage_limit_mb:300,sort_order:1};
const tenant={id:company,name:'Empresa QA Isolada',status:'active',timezone:'America/Sao_Paulo',
 owner_user_id:uid,created_at:now,settings:{},fallback_playlist_id:playlist};
const sub={id:'sub-qa',company_id:company,plan_id:plan.id,status:'active',payment_status:'paid',
 current_period_end:'2027-01-30T20:00:00Z',plan,limit_overrides:{}};
const devices=[{id:devid,company_id:company,name:'TV Sintética iPhone QA',status:'online',
 platform:'android',orientation:'portrait',created_at:now,last_seen_at:now,
 screen_width:1080,screen_height:1920,app_version:'1.5.20',
 apk_version:'1.5.20',storage_free_mb:200}];
const media=[{id:mid,company_id:company,name:'Imagem QA Sintética',media_type:'image',
 storage_path:'qa-only/test.png',mime_type:'image/png',width:1080,height:1920,
 size_bytes:10240,created_at:now,duration_seconds:10,rotation:0}];
const lists=[{id:playlist,company_id:company,name:'Playlist QA Sintética',created_at:now,
 updated_at:now,is_active:true,description:'Somente QA'}];
const items=[{id:'item-qa',company_id:company,playlist_id:playlist,media_id:mid,position:0,duration_override_seconds:10}];
const messages=[{id:'msg-qa',company_id:company,title:'Aviso de teste',
 message:'Mensagem sintética. Nenhum anúncio real.',is_read:false,created_at:now}];
const profiles=[{id:uid,display_name:'Cliente QA'}];
const data={companies:[tenant],company_subscriptions:[sub],company_members:[{company_id:company,
 user_id:uid,role:'owner',status:'active'}],devices,media_assets:media,playlists:lists,
 playlist_items:items,device_playlist_assignments:[{device_id:devid,playlist_id:playlist,company_id:company}],
 device_groups:[],device_group_members:[],campaigns:[],campaign_devices:[],device_events:[],
 device_commands:[],device_heartbeats:[],profiles,device_screenshots:[],platform_player_branding:[]};
const dashboard={metrics:{companies:1,active_companies:1,max_companies:6,mrr_cents:10000,
 users:1,devices:1,online_devices:1,storage_capacity_mb:1024,storage_reserved_mb:300,
 storage_bytes:10240},companies:[{...tenant,owner:{...member},owner_user_id:uid,plan,
 subscription:sub,members:[{user_id:uid,user:member,role:'owner',status:'active'}],
 usage:{devices:1,users:1,storage_bytes:10240,campaigns:0}}],plans:[plan],audits:[]};
function jwt(){return 'qa.'+Buffer.from(JSON.stringify({exp:4102444800,sub:uid,role:'authenticated'})).toString('base64url')+'.sig'}
function session(){return {access_token:jwt(),refresh_token:'qa-refresh-only',token_type:'bearer',
 expires_in:99999999,user:{...member}}}
function json(res,code,body,head=false){const b=Buffer.from(JSON.stringify(body));
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',
 'Content-Length':b.length,'Cache-Control':'no-store','Access-Control-Allow-Origin':'http://127.0.0.1:'+PORT});
 res.end(head?'':b)}
const server=http.createServer((req,res)=>{
 let u;try{u=new URL(req.url,'http://'+HOST+':'+PORT)}catch{json(res,400,{error:'invalid_path'});return}
 const p=u.pathname;
 if(p==='/__qa_events'){json(res,200,{events});return}
 if(p.startsWith('/__qa_api/')){
  const chunks=[];req.on('data',x=>chunks.push(x));
  req.on('end',()=>{
   const raw=Buffer.concat(chunks).toString('utf8');let payload={};
   try{payload=raw?JSON.parse(raw):{}}catch{payload={}}
   events.push({path:p,method:req.method,action:payload.action||'',bytes:Buffer.byteLength(raw),at:Date.now()});
   if(p.startsWith('/__qa_api/auth/v1/')){
    if(p.includes('/token')){
      if(payload.email==='master-qa@example.invalid'||payload.email==='cliente-qa@example.invalid' ||
         u.searchParams.get('grant_type')==='refresh_token')return json(res,200,session());
      return json(res,400,{error:'invalid_grant',message:'invalid credentials'});
    }
    if(p.endsWith('/logout'))return json(res,204,{});
    if(p.endsWith('/user'))return json(res,200,member);
    return json(res,401,{message:'qa unauthorized'});
   }
   if(p.startsWith('/__qa_api/rest/v1/')){
    const table=p.split('/').pop();
    if(table==='rpc/current_user_is_platform_admin')return json(res,200,false);
    if(table==='rpc/get_playback_report')return json(res,200,{
      summary:{started:3,completed:3,completion_rate:100,total_seconds:30,devices:1,media:1},
      start_date:'2026-11-01',end_date:'2026-11-02',timezone:'America/Sao_Paulo',
      campaigns:[],devices:[{device_name:devices[0].name,started:3,completed:3,
       completion_rate:100,media:1,total_seconds:30}],media:[],events:[]});
    if(req.method==='GET')return json(res,200,data[table]||[]);
    // Mutations stay in volatile in-memory fixtures and are never sent outward.
    if(table==='playlist_items'&&req.method==='PATCH'){
      for(const item of items)Object.assign(item,payload);
      return json(res,200,[items[0]]);
    }
    if(req.method==='POST')return json(res,201,[{id:'new-qa-id',...payload}]);
    if(req.method==='PATCH')return json(res,200,[payload]);
    if(req.method==='DELETE')return json(res,204,{});
    return json(res,400,{message:'unsupported synthetic operation'});
   }
   if(p.startsWith('/__qa_api/functions/v1/')){
    const name=p.split('/').pop();
    if(name==='public-config')return json(res,200,{ok:true,plans:[plan],config:{signup_enabled:true}});
    if(name==='master-admin'){
      if(payload.action==='whoami')return json(res,200,{role:'super_admin',email:'master-qa@example.invalid'});
      if(payload.action==='dashboard')return json(res,200,dashboard);
      return json(res,200,{ok:true});
    }
    if(name==='platform-settings'){
      if(payload.action==='get')return json(res,200,{config:{signup_enabled:true,support_whatsapp:'5562999999999'}});
      if(payload.action==='email_provider_status')return json(res,200,{api_key_configured:false,domains:[]});
      return json(res,200,{ok:true});
    }
    if(name==='notification-inbox'){
      if(payload.action==='list')return json(res,200,{items:messages,unread_count:messages.filter(x=>!x.is_read).length});
      if(payload.action==='set_read'){
        const msg=messages.find(x=>x.id===payload.notification_id);if(msg)msg.is_read=!!payload.is_read;
        return json(res,200,{ok:true});
      }
      if(payload.action==='delete_many'){
        for(const id of payload.notification_ids||[]){let i=messages.findIndex(x=>x.id===id);if(i>=0)messages.splice(i,1)}
        return json(res,200,{ok:true});
      }
    }
    if(name==='web-push')return json(res,200,{sent:0,failed:0,skipped:'no_subscriptions'});
    return json(res,200,{ok:true});
   }
   if(p.startsWith('/__qa_api/storage/v1/'))return json(res,200,{Key:'qa-only',path:'qa-only/test.png'});
   return json(res,404,{error:'synthetic_path_missing'});
  });return;
 }
 if(p==='/config.js'){
  res.writeHead(200,{'Content-Type':'application/javascript'});
  res.end("window.VISION_CONFIG={supabaseUrl:'http://127.0.0.1:8876/__qa_api',supabasePublishableKey:'qa-publishable-only',androidPlayerApkManifestUrl:'./qa-not-real.json'};");return;
 }
 if(p==='/commercial-config.js'){
  res.writeHead(200,{'Content-Type':'application/javascript'});
  res.end("window.VISION_COMMERCIAL_CONFIG={enabled:false,environment:'qa-isolated',supabaseUrl:'http://127.0.0.1:8876/__qa_api',supabasePublishableKey:'qa-only'};");return;
 }
 const file=path.resolve(ROOT,'.'+(p==='/'?'/index.html':decodeURIComponent(p)));
 if(!file.startsWith(ROOT+path.sep)||/\.(apk|aab|keystore|key|p12)$/i.test(file)){
  res.writeHead(403);res.end('blocked');return}
 let bytes;try{bytes=fs.readFileSync(file)}catch{res.writeHead(404);res.end('not found');return}
 if(path.extname(file)==='.html')bytes=Buffer.from(bytes.toString('utf8')
   .replace(/<link\b[^>]*\brel=["']preconnect["'][^>]*>/gi,''),'utf8');
 res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream',
 'Cache-Control':'no-store','X-Vision-QA':'synthetic'});
 if(req.method==='HEAD')res.end();else res.end(bytes);
});
server.listen(PORT,HOST,()=>console.log('VISION_AUTH_SYNTHETIC_READY='+PORT));
