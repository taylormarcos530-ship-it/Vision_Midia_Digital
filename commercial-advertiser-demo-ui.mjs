// Preview-only UI. No credentials, persistence, analytics, API calls or customer data.
import {demoAdvertiserData,demoAdvertiserOptions} from './commercial-advertiser-demo.mjs';
import {renderCampaigns} from './commercial-ui.mjs';

if(new URLSearchParams(location.search).get('demo')==='1'){
 const picker=document.getElementById('demo-advertiser');
 document.getElementById('demo-advertiser-label').hidden=false;
 const preset=new URLSearchParams(location.search).get('advertiser');
 if(demoAdvertiserOptions.some(item=>item.id===preset))picker.value=preset;
 const refresh=()=>{
  const data=demoAdvertiserData(picker.value);
  const dashboard=document.getElementById('dashboard');
  const campaigns=document.getElementById('campaigns');
  const status=document.getElementById('status');
  if(!data){
   dashboard.hidden=true;
   campaigns.replaceChildren();
   document.getElementById('advertiser-name').textContent='';
   status.textContent='Demonstração: acesso suspenso. Nenhuma campanha pode ser consultada.';
   return;
  }
  document.getElementById('login').hidden=true;
  dashboard.hidden=false;
  document.getElementById('advertiser-name').textContent=data.advertiser.name;
  campaigns.innerHTML=renderCampaigns(data);
  status.textContent='Dados fictícios e exibições zeradas. Alternar empresas não é um login real.';
 };
 picker.addEventListener('change',refresh);
 refresh();
}
