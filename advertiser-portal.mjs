import {CommercialAPI,updateCommercialCards,demoData,loadThumbnails,commercialPreviewPath} from './commercial-ui.mjs?v=commercial-r3-20261018';
import {demoAdvertiserData,demoAdvertiserOptions} from './commercial-advertiser-demo.mjs';
const api=new CommercialAPI(),$=s=>document.querySelector(s),demo=new URLSearchParams(location.search).get('demo')==='1';let loading=false,requestId=0,latestPortalData=null;
function message(text,error=false){$('#status').textContent=text;$('#status').className=text?(error?'notice error':'notice'):'';}
function closeView(){ requestId++;loading=false;latestPortalData=null;document.querySelector('#commercial-revision-dialog')?.close(); $('#dashboard').hidden=true;$('#campaigns').innerHTML='';$('#advertiser-name').textContent='';$('#login').hidden=false;$('#logout').hidden=true;if(api.config?.environment==='staging'){const diagnostic=$('#staging-check-output');if(diagnostic)diagnostic.textContent='';}}
async function show(manual=false){if(loading){if(manual)message('Atualização já em andamento…');return;}loading=true;const previous=latestPortalData?.daily?.reduce((n,x)=>n+(Number(x.completed_count)||0),0);if(manual)message('Consultando exibições…');const ownRequest=++requestId;try{const data=demo?demoAdvertiserData(document.getElementById('demo-advertiser').value):await api.rpc('vision_advertiser_portal');if(ownRequest!==requestId)return;if(demo&&!data){$('#dashboard').hidden=true;$('#campaigns').replaceChildren();$('#login').hidden=true;$('#logout').hidden=true;message('Acesso suspenso nesta demonstração.');return;}$('#login').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=demo;$('#advertiser-name').textContent=data.advertiser.name;latestPortalData=data;updateCommercialCards($('#campaigns'),data);
 const stamp=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date());
 const verified=(data.daily||[]).reduce((sum,item)=>sum+(Number(item.completed_count)||0),0);
 message(demo?'Nenhum dado real conectado. As contagens começam em zero.':
  manual?(previous==null?'Atualizado! Exibições registradas: '+verified+'.':verified>previous?'Atualizado! '+(verified-previous)+' nova(s) exibição(ões).':'Atualizado! Nenhuma nova exibição.')+' Consulta às '+stamp+'.':
  'Dados consultados às '+stamp+'. '+(verified?'Exibições comerciais registradas: '+verified+'.':'Aguardando a primeira exibição comercial concluída.'));if(!demo){const sessionToken=api.session()?.access_token;const authorized=()=>ownRequest===requestId&&!$('#dashboard').hidden&&!!sessionToken&&api.session()?.access_token===sessionToken;void loadThumbnails($('#campaigns'),data,api,authorized).catch(()=>{});}}catch(e){if(ownRequest!==requestId)return;if(e.status===401||e.status===403||(!demo&&!api.session())){api.clear();closeView();message(e.status===401||e.status===403?e.message:'Sua sessão expirou. Entre novamente.',true);return;}message('Não foi possível atualizar: '+(e.message||'erro de conexão'),true);}finally{if(ownRequest===requestId)loading=false}}
// Previewing an owned creative is optional and never counted as an impression.
// A short-lived signed URL is issued only after the advertiser's normal RLS check.
$('#campaigns').addEventListener('click',async event=>{
 const button=event.target.closest('[data-watch-revision]');
 if(!button||demo)return;
 const id=button.dataset.watchRevision;
 const rev=(latestPortalData?.revisions||[]).find(x=>x.id===id);
 if(!rev||!latestPortalData?.campaigns?.some(c=>c.id===rev.campaign_id))return;
 const path=commercialPreviewPath(rev.storage_path);
 if(!path)return message('Prévia indisponível.',true);
 const dialog=$('#commercial-revision-dialog'),screen=$('#commercial-revision-content');
 const description=$('#commercial-revision-note');
 const session=api.session()?.access_token;
 screen.replaceChildren();description.textContent='Preparando prévia do seu anúncio…';button.disabled=true;
 dialog.showModal();
 try{
  const signedPath='/storage/v1/object/sign/vision-media/'+path.split('/').map(encodeURIComponent).join('/');
  const result=await api.request(signedPath,{body:{expiresIn:120}});
  if(!dialog.open||api.session()?.access_token!==session)return;
  const raw=result?.signedURL||result?.signedUrl;
  const url=new URL(raw?.startsWith('/object/')?'/storage/v1'+raw:raw,api.config.supabaseUrl);
  if(url.origin!==new URL(api.config.supabaseUrl).origin||url.pathname!==signedPath||!url.searchParams.has('token'))throw new Error('URL de prévia inválida.');
  const media=document.createElement(rev.media_type==='video'?'video':'img');
  media.className='commercial-watch-media';
  if(rev.media_type==='video'){media.controls=true;media.playsInline=true;media.preload='metadata';}
  else media.alt='Prévia comercial: '+rev.name;
  screen.replaceChildren(media);media.src=url.href;
  description.textContent='Prévia do seu anúncio. Não é transmissão da TV e não contabiliza exibições.';
 }catch(error){if(dialog.open)description.textContent='Não foi possível abrir esta prévia. Tente novamente.';}
 finally{button.disabled=false;}
});
$('#commercial-revision-close').onclick=()=>$('#commercial-revision-dialog').close();
$('#commercial-revision-dialog').addEventListener('close',()=>$('#commercial-revision-content').replaceChildren());

$('#login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const f=new FormData(e.target);await api.login(f.get('email'),f.get('password'));e.target.reset();await show();}catch(error){message(error.message,true)}finally{button.disabled=false}};
$('#logout').onclick=async()=>{closeView();try{await api.logout()}catch{}message('Você saiu do painel.');};
$('#refresh').onclick=async()=>{const button=$('#refresh');button.disabled=true;button.textContent='Atualizando…';try{await show(true)}finally{button.disabled=false;button.textContent='Atualizar'}};
$('#password-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);if(f.get('password')!==f.get('confirmation'))return message('As senhas devem ser iguais.',true);e.submitter.disabled=true;try{await api.request('/auth/v1/user',{method:'PUT',body:{password:f.get('password')}});e.target.reset();message('Senha alterada.');}catch(error){message(error.message,true)}finally{e.submitter.disabled=false}};
if(demo){$('#demo-banner').hidden=false;$('#password-section').hidden=true;show()}else if(api.session())show();else if(!api.config?.enabled)message('Login real ainda não habilitado neste preview. A homologação será conectada a um ambiente isolado, sem usar a produção.');
// Data already comes from completed playback batches; polling every 15s does not improve counting.
// Refresh at most every 2 minutes while visible, or immediately when the advertiser requests it.
const PORTAL_AUTO_REFRESH_MS = 120_000;
setInterval(()=>{if(!demo&&!document.hidden&&!$('#dashboard').hidden)show()},PORTAL_AUTO_REFRESH_MS);
