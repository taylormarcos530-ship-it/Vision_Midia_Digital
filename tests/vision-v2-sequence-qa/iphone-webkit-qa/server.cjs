// Local-only static server. No reverse proxy to production.
'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=process.cwd(),PORT=8765,HOST='127.0.0.1';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.mjs':'text/javascript; charset=utf-8','.css':'text/css','.svg':'image/svg+xml',
 '.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg',
 '.json':'application/json','.webmanifest':'application/manifest+json'};
const reqs=[];
http.createServer((req,res)=>{
 let u;
 try{u=new URL(req.url,'http://'+HOST+':'+PORT)}catch{res.writeHead(400);res.end();return}
 const p=decodeURIComponent(u.pathname);
 if(p.startsWith('/__qa_api/')){
   reqs.push({method:req.method,path:p});
   res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'});
   res.end(JSON.stringify({message:'Isolated synthetic server: no valid account'}));return;
 }
 if(p==='/__qa_requests'){
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify(reqs));return;
 }
 if(p==='/config.js'){
   res.writeHead(200,{'Content-Type':'application/javascript'});
   res.end("window.VISION_CONFIG={supabaseUrl:'http://127.0.0.1:8765/__qa_api',supabasePublishableKey:'qa-only',androidPlayerApkManifestUrl:'./does-not-exist-qa.json'};");
   return;
 }
 if(p==='/commercial-config.js'){
   res.writeHead(200,{'Content-Type':'application/javascript'});
   res.end("window.VISION_COMMERCIAL_CONFIG={environment:'qa-isolated',enabled:false,supabaseUrl:'http://127.0.0.1:8765/__qa_api',supabasePublishableKey:'qa-only'};");
   return;
 }
 const wanted=p==='/'?'/index.html':p;
 const full=path.resolve(ROOT,'.'+wanted);
 if(!full.startsWith(ROOT+path.sep) || /\.(apk|aab|keystore|p12|key)$/i.test(full)){
   res.writeHead(403);res.end('blocked');return;
 }
 let body;
 try{body=fs.readFileSync(full)}catch{res.writeHead(404);res.end('not found');return}
 const ext=path.extname(full).toLowerCase();
 if(ext==='.html'){
   let html=body.toString('utf8');
   // Prevent preconnect from initiating a socket to an official service.
   html=html.replace(/<link\b[^>]*\brel=["']preconnect["'][^>]*>/gi,'');
   body=Buffer.from(html,'utf8');
 }
 res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream',
   'Cache-Control':'no-store','X-Vision-QA':'isolated'});
 if(req.method==='HEAD'){res.end();return}
 res.end(body);
}).listen(PORT,HOST,()=>console.log('VISION_IPHONE_QA_SERVER_READY='+PORT));
