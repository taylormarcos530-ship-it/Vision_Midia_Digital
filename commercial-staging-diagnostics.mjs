// Standalone staging-only diagnostic: no login capture, secrets, persistence or writes.
// Works ONLY when the dedicated staging page and staging public configuration are present.
import {CommercialAPI} from './commercial-ui.mjs';

const STAGING_URL='https://jmiuitrrhtaeyrpuyohk.supabase.co';

export async function checkStagingAccess(config, api, fetcher){
 if(config?.environment!=='staging'||config?.supabaseUrl!==STAGING_URL
   ||!config.enabled||!/^sb_publishable_/.test(config.supabasePublishableKey||'')){
  return {ok:false,lines:['Ambiente de homologação não habilitado. Nenhuma consulta realizada.']};
 }
 try{
  const health=await fetcher(STAGING_URL+'/auth/v1/health',{
   method:'GET',cache:'no-store',headers:{apikey:config.supabasePublishableKey}
  });
  if(!health.ok)throw new Error('Serviço de autenticação indisponível (HTTP '+health.status+').');
  const sessionToken=api.session()?.access_token;
  if(!sessionToken){
   return {ok:true,authenticated:false,lines:[
    'Conexão com o Supabase de homologação: OK.',
    'Login: ainda não efetuado neste navegador.',
    'Entre com uma conta fictícia de teste e verifique novamente.'
   ]};
  }
  const data=await api.rpc('vision_advertiser_portal');
  if(api.session()?.access_token!==sessionToken){
   return {ok:false,authenticated:false,lines:['A sessão mudou durante a verificação. Verifique novamente após entrar.']};
  }
  if(!data?.advertiser?.id||!Array.isArray(data.campaigns)
    ||!Array.isArray(data.targets)||!Array.isArray(data.daily)){
   throw new Error('Resposta do portal incompleta. Verifique a configuração de homologação.');
  }
  if(data.campaigns.some(c=>c.advertiser_id!==data.advertiser.id)){
   throw new Error('Divergência de isolamento detectada. Não utilize o painel.');
  }
  const total=data.daily.reduce((sum,row)=>sum+Math.max(0,Number(row.completed_count)||0),0);
  const draftCount=data.campaigns.filter(c=>c.status==='draft').length;
  return {ok:true,authenticated:true,lines:[
   'Conexão com o Supabase de homologação: OK.',
   'Conta autorizada: '+String(data.advertiser.name||'Anunciante de teste'),
   'Campanhas da conta: '+data.campaigns.length+' (rascunhos: '+draftCount+').',
   'Vínculos com TVs de teste: '+data.targets.length+'.',
   'Exibições registradas para esta conta: '+total+'.'
  ]};
 }catch(error){
  const accessDenied=error.status===401||error.status===403;
  return {ok:false,authenticated:false,lines:[
   accessDenied?'Acesso não autorizado. Confira se a conta de teste está ativa e vinculada.':
    'Não foi possível concluir a verificação com o Supabase de homologação.',
   'Detalhe: '+(accessDenied?'A sessão precisa ser revisada.':(error.message||'Falha de rede.'))
  ]};
 }
}

if(typeof document!=='undefined' && document.getElementById('staging-check-access')){
 const button=document.getElementById('staging-check-access');
 const output=document.getElementById('staging-check-output');
 const api=new CommercialAPI();
 let checkVersion=0;
 const clearDiagnostic=()=>{
  checkVersion++;
  output.textContent='';
  delete output.dataset.result;
 };
 // Never leave the previous advertiser's name visible after exit or account change.
 document.getElementById('logout')?.addEventListener('click',clearDiagnostic,true);
 document.getElementById('login-form')?.addEventListener('submit',clearDiagnostic,true);
 button.onclick=async()=>{
  if(button.disabled)return;
  const currentVersion=++checkVersion;
  button.disabled=true;
  output.textContent='Verificando apenas o Supabase de homologação...';
  try{
   const result=await checkStagingAccess(api.config,api,fetch);
   if(currentVersion!==checkVersion)return;
   output.textContent=result.lines.join('\n');
   output.dataset.result=result.ok?'ok':'error';
  }finally{button.disabled=false}
 };
}
