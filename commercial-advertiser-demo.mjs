// Static, fictional advertiser previews ONLY. Never send analytics or authenticate here.
// Production and staging always use Supabase Auth + RLS through the existing real portal.
import {demoData} from './commercial-ui.mjs';

export const demoAdvertiserOptions=Object.freeze([
 {id:'loja-a',label:'Loja do João — exemplo A'},
 {id:'loja-b',label:'Empresa B — exemplo B'},
 {id:'bloqueado',label:'Anunciante bloqueado — exemplo'}
]);

export function demoAdvertiserData(id='loja-a'){
 if(id==='bloqueado')return null; // Emulates an access revocation without using real Auth.
 if(!demoAdvertiserOptions.some(x=>x.id===id))throw new Error('Anunciante fictício não encontrado');
 const base=demoData();
 const b=id==='loja-b';
 const campaignId=b?'demo-campaign-b':'demo-campaign-a';
 const revisionId=b?'demo-revision-b':'demo-revision-a';
 const deviceId=b?'demo-tv-b':'demo-tv-a';
 const advertiserId=b?'demo-advertiser-b':'demo-advertiser';
 return {
  advertiser:{id:advertiserId,name:b?'Empresa B — demonstração':'Loja do João — demonstração',email:b?'exemplo-b@anunciante.test':'exemplo-a@anunciante.test'},
  today:base.today,
  campaigns:[{id:campaignId,advertiser_id:advertiserId,name:b?'Campanha B — ilustrativa':'Campanha A — ilustrativa',status:'draft',start_date:base.today,end_date:base.today,current_revision_id:revisionId}],
  revisions:[{id:revisionId,campaign_id:campaignId,name:'Propaganda ilustrativa',media_type:'image',storage_path:null}],
  targets:[{campaign_id:campaignId,device_id:deviceId,point_name:b?'Ponto B — fictício':'Auto Center — ponto ilustrativo',device_name:b?'TV B — demonstração':'TV A — demonstração',online:false,active:true,last_seen_at:null}],
  daily:[] // Always zero: no invented exposures, events, or live devices.
 };
}
