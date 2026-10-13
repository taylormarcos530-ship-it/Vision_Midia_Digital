// Read-only preview fixtures. Never call Auth, Storage, or a database.
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
