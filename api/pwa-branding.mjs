import * as blob from '@vercel/blob';
import {createBlobStore} from '../lib/pwa-blob-store.mjs';
import {createHandler} from '../lib/pwa-icon-core.mjs';
const API='https://fpadgedrgcxrrqflzhjt.supabase.co';
const KEY='sb_publishable_pSGsns390QFjOY4JHs-Xqw_bGrX_kCN';
async function authorize(token){
 const r=await fetch(API+'/functions/v1/master-admin',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'whoami'}),signal:AbortSignal.timeout(8000)});
 if(!r.ok)return null;return(await r.json()).role;
}
const handler=createHandler({getStore:()=>createBlobStore(blob),authorize});
export default async function(req,res){
 if(req.method==='POST'&&process.env.VERCEL_ENV!=='production')return res.status(403).json({error:'production_only'});
 const url=new URL(req.url,'https://'+req.headers.host);
 const route=url.searchParams.get('route');
 const paths={manifest:'/manifest.webmanifest',config:'/app-icon-config',save:'/api/app-icon'};
 if(route==='icon')url.pathname='/app-icons/'+url.searchParams.get('revision')+'/'+url.searchParams.get('size')+'.png';else url.pathname=paths[route]||url.pathname;
 const headers=new Headers();for(const[k,v]of Object.entries(req.headers)){if(typeof v==='string')headers.set(k,v);}
 const body=req.method==='POST'?(typeof req.body==='string'?req.body:JSON.stringify(req.body??{})):undefined;
 const response=await handler(new Request(url,{method:req.method,headers,body}));
 res.statusCode=response.status;for(const[k,v]of response.headers)res.setHeader(k,v);res.end(Buffer.from(await response.arrayBuffer()));
}
