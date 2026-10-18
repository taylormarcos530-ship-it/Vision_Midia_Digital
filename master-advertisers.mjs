import {CommercialAPI,esc,renderCampaigns,loadThumbnails} from './commercial-ui.mjs';
import {createMasterDemoSession} from './commercial-master-demo.mjs';
import {createCommercialMediaPicker,uploadCommercialSignedFile} from './commercial-master-media-picker.mjs';
import {isPrivateCommercialDeviceName,commercialLocationErrorMessage} from './commercial-point-privacy.mjs';
const api=new CommercialAPI(true),$=s=>document.querySelector(s),demo=new URLSearchParams(location.search).get('demo')==='1',demoSession=demo?createMasterDemoSession():null;let state=null,busy=false,generation=0;let mediaLinkProcessed=false,pendingMediaLink=null;
function message(text,error=false){$('#status').textContent=text;$('#status').className=text?(error?'notice error':'notice'):'';}
const mediaPicker=createCommercialMediaPicker({api,
 grid:$('#commercial-media-grid'),search:$('#commercial-media-search'),
 status:$('#commercial-media-status'),selected:$('#commercial-media-selected'),
 preview:$('#commercial-media-preview'),count:$('#commercial-media-count'),
 filters:document.querySelectorAll('[data-media-filter]'),
 select:$('#campaign-form [name="media_id"]')});
function access(result,email){$('#access-result').textContent=`E-mail: ${email}\nSenha: ${result.temporary_password}\nPortal: ${new URL('./anunciante.html',location.href).href}`;$('#access-dialog').showModal();}
function render(){
 const search=$('#search').value.toLocaleLowerCase('pt-BR');
 const showArchived=$('#show-archived').checked;
 const rows=(state.advertisers||[]).filter(a=>(showArchived||!a.archived_at)&&
  (a.name+' '+a.email).toLocaleLowerCase('pt-BR').includes(search));
 $('#advertisers').innerHTML=rows.map(a=>{
  const archived=Boolean(a.archived_at);
  const allCampaigns=state.campaigns.filter(c=>c.advertiser_id===a.id);const campaigns=allCampaigns.filter(c=>showArchived||!c.archived_at);
  return `<article class="advertiser"><div class="campaign-head"><h2>${esc(a.name)}</h2><span class="badge ${!archived&&a.status==='active'?'active':''}">${archived?'Excluído':a.status==='active'?'Ativo':'Desativado'}</span></div>
  <p>${esc(a.email)} · ${allCampaigns.filter(c=>!c.archived_at).length} campanhas</p>
  <div class="toolbar advertiser-main-actions">${archived
    ? `<button data-report="${esc(a.id)}">Ver histórico</button><button data-restore="${esc(a.id)}">Restaurar anunciante</button>`
    : `<button data-edit="${esc(a.id)}">Editar / ${a.status==='active'?'desativar':'ativar'}</button><button data-campaign="${esc(a.id)}">+ Campanha</button><button data-report="${esc(a.id)}">Ver resultados</button><button data-reset="${esc(a.id)}">Redefinir acesso</button>`}</div>
  <div class="advertiser-campaigns"><h3>Campanhas do anunciante</h3>${campaigns.map(c=>`<section class="commercial-campaign-entry"><div class="commercial-campaign-entry-header"><strong>Campanha: ${esc(c.name)}</strong>${archived||c.archived_at?esc(c.name):`<button data-edit-campaign="${esc(c.id)}">Editar campanha</button>`}</div><div class="commercial-campaign-entry-state">${c.archived_at?'Excluída':esc({active:'Ativa',draft:'Rascunho',paused:'Pausada'}[c.status]||c.status)} ${archived?'':c.archived_at?`<button data-restore-campaign="${esc(c.id)}">Restaurar campanha</button>`:`<button class="danger subtle-danger" data-archive-campaign="${esc(c.id)}">Excluir somente esta campanha</button>`}</div></section>`).join('')||'<p class="muted">Nenhuma campanha.</p>'}</div>
  ${archived?'':`<details class="advertiser-account-danger"><summary>Ações do cadastro do anunciante</summary><p>Excluir o cadastro bloqueia o acesso deste anunciante e interrompe todas as campanhas. Para excluir apenas uma campanha, utilize a opção dentro dela.</p><button class="danger" data-archive="${esc(a.id)}">Excluir cadastro do anunciante</button></details>`}
  </article>`;
 }).join('')||'<div class="empty">Nenhum anunciante encontrado.</div>';
 // Only local Excluir/Restaurar and Ver resultados run in demo; all other actions remain disabled.
 if(demo)$('#advertisers').querySelectorAll('button:not([data-report]):not([data-archive]):not([data-restore])').forEach(b=>b.disabled=true);
}
async function confirmCommercialRemoval(type,name,details){
 const dialog=$('#commercial-remove-confirm');
 $('#commercial-remove-title').textContent=type==='anunciante'?'Excluir cadastro do anunciante':'Excluir somente a campanha';
 $('#commercial-remove-details').textContent=details;
 $('#commercial-remove-name').textContent=name;
 const typed=$('#commercial-remove-input'),ok=$('#commercial-remove-confirm-button');
 typed.value='';ok.disabled=true;
 return new Promise(resolve=>{
  let approved=false;
  const validate=()=>{ok.disabled=typed.value.trim()!==name;};
  const confirm=()=>{approved=true;dialog.close();};
  const closed=()=>{
   typed.removeEventListener('input',validate);
   ok.removeEventListener('click',confirm);
   dialog.removeEventListener('close',closed);
   resolve(approved);
  };
  typed.addEventListener('input',validate);
  ok.addEventListener('click',confirm);
  dialog.addEventListener('close',closed);
  dialog.showModal();
 });
}
async function load(){if(busy)return;busy=true;const ownGeneration=generation;try{const loaded=demo?demoSession.list():await api.masterCall('commercial_list');if(ownGeneration!==generation)return;state=loaded;$('#master-login').hidden=true;$('#admin').hidden=false;render();offerMediaLink();message(demo?'Demonstração: dados fictícios. Excluir e Restaurar funcionam só nesta página; ao recarregar o navegador, tudo volta ao início.':'Dados atualizados.');}catch(e){if(ownGeneration!==generation)return;$('#admin').hidden=true;$('#advertisers').replaceChildren();$('#report-campaigns').replaceChildren();if(e.status===401)$('#master-login').hidden=false;message(e.message,true)}finally{busy=false}}
function advertiser(id){const a=state.advertisers.find(x=>x.id===id);const f=$('#advertiser-form');f.reset();f.elements.id.value=a?.id||'';f.elements.name.value=a?.name||'';f.elements.email.value=a?.email||'';f.elements.email.disabled=!!a;f.elements.status.value=a?.status||'active';$('#advertiser-state').hidden=!a;$('#advertiser-title').textContent=a?'Editar anunciante':'Novo anunciante';f.querySelector('.form-error').textContent='';$('#advertiser-dialog').showModal();}
async function campaign(advertiserId,existing,prefillMediaId=''){const f=$('#campaign-form');f.reset();f.elements.id.value=existing?.id||'';f.elements.advertiser_id.value=advertiserId;f.elements.name.value=existing?.name||'';f.elements.status.value=existing?.status||'draft';f.elements.start_date.value=existing?.start_date||'';f.elements.end_date.value=existing?.end_date||'';f.querySelector('.form-error').textContent='';const company=new Map(state.companies.map(c=>[c.id,c.name]));f.elements.media_id.innerHTML='<option value="">Selecione a mídia</option>'+(state.sources||[]).map(m=>`<option value="${esc(m.id)}">Vision comercial · ${esc(m.name)}</option>`).join('')+state.media.map(m=>`<option value="${esc(m.id)}">${esc(company.get(m.company_id)||'Vision')} · ${esc(m.name)}</option>`).join('');let targets=[];if(existing){const r=await api.masterCall('commercial_report',{id:advertiserId});const rev=(state.revisions||[]).find(x=>x.id===existing.current_revision_id);f.elements.media_id.value=rev?.source_media_id||'';targets=r.targets.filter(t=>t.campaign_id===existing.id&&t.active).map(t=>t.device_id);}
if(!existing && prefillMediaId){
 const selected=[...(state.media||[]),...(state.sources||[])].find(media=>media.id===prefillMediaId);
 if(selected && ['image','video'].includes(selected.media_type)){
  f.elements.media_id.value=selected.id;
  f.elements.name.value=selected.name||'Anúncio comercial';
 }
}
$('#device-options').innerHTML=state.devices.map(d=>`<label class="device-choice"><input type="checkbox" name="device_ids" value="${esc(d.id)}" ${targets.includes(d.id)?'checked':''}><span>${esc(company.get(d.company_id)||'Ponto')} · ${esc(d.name)}</span></label>`).join('')||'<p>Nenhuma TV disponível.</p>';$('#campaign-dialog').showModal();mediaPicker.open(state,f.elements.media_id.value);}
function offerMediaUnlink(mediaId){
 if(!/^[0-9a-f-]{36}$/i.test(mediaId))return message('Identificador de mídia inválido.',true);
 const media=(state.media||[]).find(x=>x.id===mediaId&&['image','video'].includes(x.media_type));
 if(!media)return message('Mídia não encontrada nesta biblioteca. Atualize a página.',true);
 const sources=new Map((state.revisions||[]).map(rev=>[rev.id,rev.source_media_id]));
 const adv=new Map((state.advertisers||[]).map(row=>[row.id,row]));
 const linked=(state.campaigns||[]).filter(c=>!c.archived_at&&sources.get(c.current_revision_id)===mediaId&&!adv.get(c.advertiser_id)?.archived_at);
 if(!linked.length)return message('Esta mídia não possui campanhas vinculadas no momento.',true);
 $('#unlink-media-title').textContent=media.name;
 $('#unlink-media-campaign').innerHTML=linked.map(c=>'<option value="'+esc(c.id)+'">'+esc(adv.get(c.advertiser_id)?.name||'Anunciante')+' · '+esc(c.name)+'</option>').join('');
 $('#unlink-media-dialog').showModal();
}
$('#unlink-media-form').onsubmit=async e=>{
 e.preventDefault();
 const campaignId=$('#unlink-media-campaign').value;
 const selected=(state?.campaigns||[]).find(c=>c.id===campaignId&&!c.archived_at);
 if(!selected)return;
 $('#unlink-media-dialog').close();
 if(!await confirmCommercialRemoval('campanha',selected.name,'Desvincular arquiva somente esta campanha e interrompe a entrega. O anunciante e a mídia permanecem cadastrados; os relatórios não são apagados.'))return;
 try{
  await api.masterCall('commercial_archive_campaign',{id:campaignId});
  await load();
  message('Mídia desvinculada da campanha selecionada, com histórico preservado.');
 }catch(error){message('Falha ao desvincular: '+error.message,true);}
};
function offerMediaLink(){
 if(mediaLinkProcessed||demo||!state)return;
 const params=new URLSearchParams(location.search);
 const id=params.get('link_media')||params.get('unlink_media');
 if(!id)return;
 const unlink=params.has('unlink_media');
 mediaLinkProcessed=true;
 const nextUrl=new URL(location.href);
 nextUrl.searchParams.delete('link_media');
 nextUrl.searchParams.delete('unlink_media');
 history.replaceState(history.state,'',nextUrl.pathname+nextUrl.search+nextUrl.hash);
 if(!/^[0-9a-f-]{36}$/i.test(id))return message('Identificador de mídia inválido. Abra novamente pela gestão.',true);
 if(unlink)return offerMediaUnlink(id);
 const media=(state.media||[]).find(x=>x.id===id&&['image','video'].includes(x.media_type));
 if(!media)return message('Esta mídia não está disponível para anúncio. Verifique a empresa e a biblioteca.',true);
 const advertisers=(state.advertisers||[]).filter(x=>!x.archived_at&&x.status==='active');
 if(!advertisers.length)return message('Cadastre primeiro um anunciante ativo para vincular a mídia.',true);
 pendingMediaLink=media;
 $('#link-media-title').textContent=media.name;
 $('#link-media-advertiser').innerHTML=advertisers.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
 $('#link-media-advertiser-dialog').showModal();
}
$('#link-media-advertiser-form').onsubmit=async e=>{
 e.preventDefault();
 if(!pendingMediaLink)return;
 const id=$('#link-media-advertiser').value;
 if(!(state.advertisers||[]).some(x=>x.id===id&&!x.archived_at&&x.status==='active'))return;
 const selectedMedia=pendingMediaLink;
 pendingMediaLink=null;
 $('#link-media-advertiser-dialog').close();
 await campaign(id,null,selectedMedia.id);
 message('Mídia pré-selecionada. Confirme as datas e TVs e clique em Salvar campanha para vincular ao anunciante.');
};
$('#link-media-advertiser-dialog').addEventListener('close',()=>{pendingMediaLink=null;});

$('#new-advertiser').onclick=()=>{if(!demo)advertiser()};

function showPointForm(){
 const form=$('#public-points-form');
 const comp=new Map((state?.companies||[]).map(row=>[row.id,row.name]));
 form.elements.device_id.innerHTML=(state?.devices||[]).map(d=>
  '<option value="'+esc(d.id)+'">'+esc(comp.get(d.company_id)||'Estabelecimento')+' · '+esc(d.name)+
  (isPrivateCommercialDeviceName(d.name)?' · Privada / teste':'')+'</option>').join('');
 if(!form.elements.device_id.options.length){message('Nenhuma TV cadastrada.',true);return;}
 // Prefer a business display to avoid selecting a private test box by accident.
 const business=(state?.devices||[]).find(d=>!isPrivateCommercialDeviceName(d.name));
 if(business)form.elements.device_id.value=business.id;
 loadPointForm();$('#public-points-dialog').showModal();
}
function loadPointForm(){
 const f=$('#public-points-form');
 const row=(state?.point_profiles||[]).find(p=>p.device_id===f.elements.device_id.value);
 for(const k of ['public_label','public_address','neighborhood','city'])f.elements[k].value=row?.[k]||'';
 f.elements.share_location.checked=Boolean(row?.share_location&&row?.consent_confirmed_at);
 f.elements.consent_confirmed.checked=Boolean(row?.share_location&&row?.consent_confirmed_at);
 const device=(state?.devices||[]).find(d=>d.id===f.elements.device_id.value);
 const isPrivate=isPrivateCommercialDeviceName(device?.name);
 const sharingNotice=$('#public-point-sharing-notice');
 sharingNotice.textContent=isPrivate
  ?'TV de teste ou residencial: o endereço fica privado. Para divulgar a localização, selecione a TV física do estabelecimento.'
  :'Somente divulgue um endereço comercial verdadeiro com autorização do estabelecimento.';
 sharingNotice.classList.toggle('private-device-warning',isPrivate);
 f.elements.share_location.disabled=isPrivate;
 f.elements.consent_confirmed.disabled=isPrivate;
 if(isPrivate){f.elements.share_location.checked=false;f.elements.consent_confirmed.checked=false;}
 f.querySelector('.form-error').textContent='';
}
$('#public-points-button').onclick=()=>{if(!demo)showPointForm()};
$('#public-points-form [name="device_id"]').onchange=loadPointForm;
$('#public-points-form').onsubmit=async e=>{
 e.preventDefault();
 const f=e.currentTarget,b=e.submitter;
 const values=Object.fromEntries(new FormData(f).entries());
 values.share_location=f.elements.share_location.checked;
 values.consent_confirmed=f.elements.consent_confirmed.checked;
 const selectedDevice=(state?.devices||[]).find(d=>d.id===values.device_id);
 if(values.share_location&&isPrivateCommercialDeviceName(selectedDevice?.name)){
  f.querySelector('.form-error').textContent='Esta TV é de teste ou residencial. Selecione a TV física do estabelecimento.';return;
 }
 if(values.share_location&&!values.consent_confirmed){
  f.querySelector('.form-error').textContent='Confirme a autorização do estabelecimento.';return;
 }
 b.disabled=true;
 try{
  const res=await api.masterCall('commercial_point_save',values);
  if(!res.ok)throw new Error('Endereço não confirmado pelo servidor.');
  $('#public-points-dialog').close();
  await load();
  message(res.share_location?'Endereço comercial autorizado e publicado para os anunciantes vinculados.':'Localização mantida privada.');
 }catch(error){f.querySelector('.form-error').textContent=commercialLocationErrorMessage(error);}
 finally{b.disabled=false;}
};
$('#reload').onclick=load;$('#search').oninput=render;$('#show-archived').onchange=render;$('#close-report').onclick=()=>{$('#report').hidden=true;$('#report-campaigns').replaceChildren()};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>document.getElementById(b.dataset.close).close();$('#access-dialog').addEventListener('close',()=>{$('#access-result').textContent=''});
$('#master-login-form').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{const f=new FormData(e.target);await api.login(f.get('email'),f.get('password'));e.target.reset();await load()}catch(error){message(error.message,true)}finally{e.submitter.disabled=false}};
$('#advertiser-form').onsubmit=async e=>{e.preventDefault();const f=e.target,id=f.elements.id.value;const values=Object.fromEntries(new FormData(f));e.submitter.disabled=true;try{const r=await api.masterCall(id?'commercial_update_advertiser':'commercial_create_advertiser',values);$('#advertiser-dialog').close();await load();if(r.temporary_password)access(r,values.email)}catch(error){f.querySelector('.form-error').textContent=error.message}finally{e.submitter.disabled=false}};
$('#campaign-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),campaign=Object.fromEntries(f);if((state.sources||[]).some(s=>s.id===campaign.media_id)){campaign.commercial_source_id=campaign.media_id;delete campaign.media_id;}campaign.device_ids=f.getAll('device_ids');if(!campaign.media_id&&!campaign.commercial_source_id){
 e.target.querySelector('.form-error').textContent='Selecione uma mídia pela miniatura.';return;
}if(!campaign.device_ids.length){e.target.querySelector('.form-error').textContent='Selecione ao menos uma TV.';return;}if(campaign.end_date<campaign.start_date){e.target.querySelector('.form-error').textContent='O vencimento deve ser igual ou posterior ao início.';return;}e.submitter.disabled=true;try{await api.masterCall('commercial_save_campaign',{campaign});$('#campaign-dialog').close();await load()}catch(error){e.target.querySelector('.form-error').textContent=error.message}finally{e.submitter.disabled=false}};
$('#advertisers').onclick=async e=>{const b=e.target.closest('button');if(!b)return;if(demo&&!b.dataset.report&&!b.dataset.archive&&!b.dataset.restore)return;const ownGeneration=generation;b.disabled=true;try{if(b.dataset.edit)advertiser(b.dataset.edit);if(b.dataset.campaign)await campaign(b.dataset.campaign);if(b.dataset.editCampaign){const c=state.campaigns.find(x=>x.id===b.dataset.editCampaign);await campaign(c.advertiser_id,c)}if(b.dataset.report){const data=demo?demoSession.report(b.dataset.report):await api.masterCall('commercial_report',{id:b.dataset.report});if(ownGeneration!==generation)return;$('#report-title').textContent='Resultados · '+data.advertiser.name;$('#report-campaigns').innerHTML=renderCampaigns(data,true);$('#report').hidden=false;$('#report').scrollIntoView({behavior:'smooth'});if(!demo)await loadThumbnails($('#report-campaigns'),data,api)}if(b.dataset.archiveCampaign){
  const c=state.campaigns.find(x=>x.id===b.dataset.archiveCampaign&&!x.archived_at);
  if(!c)throw new Error('Campanha não encontrada.');
  if(await confirmCommercialRemoval('campanha',c.name,'Somente esta campanha será pausada e arquivada. O anunciante continuará ativo; a mídia e o histórico serão preservados.')){
   await api.masterCall('commercial_archive_campaign',{id:c.id});
   if(ownGeneration!==generation)return;
   await load();
   message('Campanha excluída da lista, com histórico preservado. Para recuperar, marque Mostrar excluídos.');
  }
 }
 if(b.dataset.restoreCampaign){
  const c=state.campaigns.find(x=>x.id===b.dataset.restoreCampaign&&x.archived_at);
  if(!c)throw new Error('Campanha excluída não encontrada.');
  await api.masterCall('commercial_restore_campaign',{id:c.id});
  if(ownGeneration!==generation)return;
  await load();
  message('Campanha restaurada como Rascunho. Escolha novamente as TVs antes de ativá-la.');
 }
 if(b.dataset.reset){const a=state.advertisers.find(x=>x.id===b.dataset.reset);if(confirm(`Redefinir a senha de ${a.name}?`)){const r=await api.masterCall('commercial_reset_access',{id:a.id});if(ownGeneration!==generation)return;access(r,a.email)}}if(b.dataset.archive){
  const a=state.advertisers.find(x=>x.id===b.dataset.archive&&!x.archived_at);
  if(!a)throw new Error('Anunciante não encontrado.');
  if(await confirmCommercialRemoval('anunciante',a.name,'A conta do anunciante será bloqueada e TODAS as campanhas dele serão interrompidas. O histórico e as mídias serão preservados.')){
   if(demo)demoSession.archive(a.id);else await api.masterCall('commercial_archive_advertiser',{id:a.id});
   if(ownGeneration!==generation)return;
   await load();
   message('Anunciante excluído da lista. Histórico preservado. Para recuperar, marque "Mostrar anunciantes excluídos".');
  }
 }
 if(b.dataset.restore){
  const a=state.advertisers.find(x=>x.id===b.dataset.restore&&x.archived_at);
  if(!a)throw new Error('Anunciante excluído não encontrado.');
  if(demo)demoSession.restore(a.id);else await api.masterCall('commercial_restore_advertiser',{id:a.id});
  if(ownGeneration!==generation)return;
  await load();
  message('Anunciante restaurado, mas desativado. Ative manualmente somente quando desejar liberar o acesso.');
 }
}catch(error){message(error.message,true)}finally{b.disabled=false}};
// Direct Master-only uploads use a narrowly scoped signed token, never service_role keys.
$('#commercial-source-upload').onsubmit=async e=>{
 e.preventDefault();
 const form=e.currentTarget,f=new FormData(form),file=f.get('file'),button=e.submitter,output=$('#commercial-source-status');
 const formats=new Set(['image/png','image/jpeg','image/webp','video/mp4','video/webm']);
 if(!(file instanceof File)||!formats.has(file.type)||file.size<1||file.size>26214400){
  output.textContent='Escolha PNG/JPEG/WebP/MP4/WebM de até 25 MB.';return;
 }
 button.disabled=true;output.textContent='Enviando mídia comercial para a Vision…';
 try{
  const name=String(f.get('name')||'').trim();
  const prepared=await api.masterCall('commercial_prepare_source',{name,mime:file.type,size_bytes:file.size});
  if(!prepared.ok||!/^commercial-source\/[a-f0-9-]{36}\.(png|jpg|webp|mp4|webm)$/.test(prepared.path)||
    typeof prepared.upload_token!=='string')throw new Error('Autorização de upload inválida.');
  const base=new URL(api.config.supabaseUrl);
  const path=prepared.path.split('/').map(encodeURIComponent).join('/');
  const destination=new URL('/storage/v1/object/upload/sign/vision-media/'+path,base.origin);
  destination.searchParams.set('token',prepared.upload_token);
  await uploadCommercialSignedFile(destination.href,file,api.config.supabasePublishableKey,percent=>{
   output.textContent='Enviando mídia comercial: '+percent+'% · '+(file.size/1048576).toFixed(1)+' MB';
  });
  const completed=await api.masterCall('commercial_finalize_source',{id:prepared.id,name,mime:file.type,size_bytes:file.size});
  if(!completed.ok)throw new Error('O arquivo foi enviado, mas não registrado.');
  form.reset();output.textContent='Mídia comercial cadastrada. Agora selecione-a em “+ Campanha”.';
  await load();
 }catch(error){output.textContent='Não foi possível cadastrar: '+String(error.message||error);}
 finally{button.disabled=false;}
};
$('#logout').onclick=async()=>{generation++;busy=false;state=null;$('#admin').hidden=true;$('#advertisers').replaceChildren();$('#report-campaigns').replaceChildren();try{await api.logout()}catch{}$('#master-login').hidden=false;message('Você saiu do painel.');};
if(demo){$('#master-login').hidden=true;$('#admin').hidden=false;$('#master-demo-banner').hidden=false;$('#new-advertiser').disabled=true;$('#logout').hidden=true;document.querySelector('#admin a.button').href='./anunciante.html?demo=1';load()}else if(api.session())load();else{$('#master-login').hidden=false;if(!api.config?.enabled)message('O serviço comercial está temporariamente indisponível. A programação das TVs permanece preservada.');}
