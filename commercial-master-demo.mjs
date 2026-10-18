// Isolated, client-side preview fixtures. No Auth, Storage, remote API or database access.
import {demoData} from './commercial-ui.mjs';
export function masterDemoList(){
 const d=demoData(),a={id:'demo-advertiser',name:'Loja do João — demonstração',email:'exemplo@anunciante.test',status:'active'};
 const c={...d.campaigns[0],id:'demo-campaign',advertiser_id:a.id,name:'Campanha ilustrativa',current_revision_id:'demo-revision'};
 return {advertisers:[a],campaigns:[c],devices:[{id:'demo-tv',company_id:'demo-point',name:'TV ilustrativa',last_seen_at:null}],media:[{id:'demo-media',company_id:'demo-point',name:'Propaganda ilustrativa',media_type:'image'}],companies:[{id:'demo-point',name:'Auto Center — ponto ilustrativo'}]};
}
export function masterDemoReport(advertiserId){
 const listed=masterDemoList(),advertiser=listed.advertisers.find(a=>a.id===advertiserId);
 if(!advertiser)throw new Error('Anunciante ilustrativo não encontrado');
 const d=demoData(),campaign=listed.campaigns[0];
 return {advertiser,today:d.today,campaigns:[campaign],revisions:[{id:'demo-revision',campaign_id:campaign.id,source_media_id:'demo-media',name:'Mídia ilustrativa',media_type:'image',storage_path:null}],targets:[{campaign_id:campaign.id,device_id:'demo-tv',point_name:'Auto Center — ponto ilustrativo',device_name:'TV ilustrativa',online:false,active:true,last_seen_at:null,delivery_status:'pending_player_check'}],daily:[]};
}

/**
 * Interactive preview sandbox. A new instance is created on each page load.
 * No localStorage, sessionStorage, network, Auth or real customer data.
 */
export function createMasterDemoSession(){
 const fixtures=masterDemoList();
 const clone=value=>JSON.parse(JSON.stringify(value));
 function advertiser(id){
  const row=fixtures.advertisers.find(a=>a.id===id);
  if(!row)throw new Error('Anunciante ilustrativo não encontrado');
  return row;
 }
 return {
  list(){return clone(fixtures);},
  report(id){
   const row=advertiser(id);
   const report=masterDemoReport(id);
   return {...report,advertiser:clone(row)};
  },
  archive(id){
   const row=advertiser(id);
   if(row.archived_at)throw new Error('Anunciante já excluído nesta demonstração');
   row.status='disabled';
   row.archived_at=new Date().toISOString();
   return {ok:true,archived:true};
  },
  restore(id){
   const row=advertiser(id);
   if(!row.archived_at)throw new Error('Anunciante ainda não foi excluído');
   row.archived_at=null;
   // Restore never silently re-enables login or resumes advertisements.
   row.status='disabled';
   return {ok:true,restored:true,status:'disabled'};
  }
 };
}
