import {getStore} from '@netlify/blobs';
import {createHandler} from '../lib/pwa-icon-core.mjs';
const API='https://fpadgedrgcxrrqflzhjt.supabase.co';
const KEY='sb_publishable_pSGsns390QFjOY4JHs-Xqw_bGrX_kCN';
async function authorize(token){
 const response=await fetch(API+'/functions/v1/master-admin',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'whoami'}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)return null;const body=await response.json();return body.role;
}
const handler=createHandler({getStore:()=>getStore({name:'vision-pwa-icons-v1',consistency:'strong'}),authorize});
export default async function(request,context){
 if(request.method==='POST'&&context?.deploy?.context!=='production')return Response.json({error:'production_only'},{status:403});
 return handler(request);
}
export const config={path:['/manifest.webmanifest','/app-icon-config','/app-icons/:revision/:size','/api/app-icon']};
