import {CommercialAPI,esc,renderCampaigns,loadThumbnails} from './commercial-ui.mjs';
import {createMasterDemoSession} from './commercial-master-demo.mjs';
const api=new CommercialAPI(true),$=s=>document.querySelector(s),demo=false,demoSession=demo?createMasterDemoSession():null;let state=null,busy=false,generation=0;
function message(text,error=false){$('#status').textContent=text;$('#status').className=text?(error?'notice error':'notice'):'';}
function access(result,email){$('#access-result').textContent=`E-mail: ${email}\nSenha: ${result.temporary_password}\nPortal: ${new URL('./anunciante-homologacao.html',location.href).href}`;$('#access-dialog').showModal();}
function render(){
 const search=$('#search').value.toLocaleLowerCase('pt-BR');
 const showArchived=$('#show-archived').checked;
 const rows=(state.advertisers||[]).filter(a=>(showArchived||!a.archived_at)&&
  (a.name+' '+a.email).toLocaleLowerCase('pt-BR').includes(search));
 $('#advertisers').innerHTML=rows.map(a=>{
  const archived=Boolean(a.archived_at);
  const campaigns=state.campaigns.filter(c=>c.advertiser_id===a.id);
  return `<article class="advertiser"><div class="campaign-head"><h2>${esc(a.name)}</h2><span class="badge ${!archived&&a.status==='active'?'active':''}">${archived?'Excluído':a.status==='active'?'Ativo':'Desativado'}</span></div>
  <p>${esc(a.email)} · ${campaigns.length} campanhas</p>
  <div class="toolbar">${archived
    ? `<button data-report="${esc(a.id)}">Ver histórico</button><button data-restore="${esc(a.id)}">Restaurar anunciante</button>`
    : `<button data-edit="${esc(a.id)}">Editar / ${a.status==='active'?'desativar':'ativar'}</button><button data-campaign="${esc(a.id)}">+ Campanha</button><button data-report="${esc(a.id)}">Ver resultados</button><button data-reset="${esc(a.id)}">Redefinir acesso</button><button class="danger" data-archive="${esc(a.id)}">Excluir anunciante</button>`}</div>
  <div>${campaigns.map(c=>`<p>${archived?esc(c.name):`<button data-edit-campaign="${esc(c.id)}">${esc(c.name)}</button>`} · ${esc({active:'Ativa',draft:'Rascunho',paused:'Pausada'}[c.status])}</p>`).join('')}</div>
  </article>`;
 }).join('')||'<div class="empty">Nenhum anunciante encontrado.</div>';
 // Only local Excluir/Restaurar and Ver resultados run in demo; all other actions remain disabled.
 if(demo)$('#advertisers').querySelectorAll('button:not([data-report]):not([data-archive]):not([data-restore])').forEach(b=>b.disabled=true);
 // This staging interface validates account access only: never offer writes to commercial campaigns or TV scheduling.
 $('#advertisers').querySelectorAll('button[data-campaign],button[data-edit-campaign]').forEach(b=>{b.disabled=true;b.title='Campanhas indisponíveis nesta homologação de usuários';});
}
async function load(){if(busy)return;busy=true;const ownGeneration=generation;try{const loaded=demo?demoSession.list():await api.masterCall('commercial_list');if(ownGeneration!==generation)return;state=loaded;$('#master-login').hidden=true;$('#admin').hidden=false;render();message(demo?'Demonstração: dados fictícios. Excluir e Restaurar funcionam só nesta página; ao recarregar o navegador, tudo volta ao início.':'Dados atualizados.');}catch(e){if(ownGeneration!==generation)return;$('#admin').hidden=true;$('#advertisers').replaceChildren();$('#report-campaigns').replaceChildren();if(e.status===401)$('#master-login').hidden=false;message(e.message,true)}finally{busy=false}}
function advertiser(id){const a=state.advertisers.find(x=>x.id===id);const f=$('#advertiser-form');f.reset();f.elements.id.value=a?.id||'';f.elements.name.value=a?.name||'';f.elements.email.value=a?.email||'';f.elements.email.disabled=!!a;f.elements.status.value=a?.status||'active';$('#advertiser-state').hidden=!a;$('#advertiser-title').textContent=a?'Editar anunciante':'Novo anunciante';f.querySelector('.form-error').textContent='';$('#advertiser-dialog').showModal();}
async function campaign(advertiserId,existing){const f=$('#campaign-form');f.reset();f.elements.id.value=existing?.id||'';f.elements.advertiser_id.value=advertiserId;f.elements.name.value=existing?.name||'';f.elements.status.value=existing?.status||'draft';f.elements.start_date.value=existing?.start_date||'';f.elements.end_date.value=existing?.end_date||'';f.querySelector('.form-error').textContent='';const company=new Map(state.companies.map(c=>[c.id,c.name]));f.elements.media_id.innerHTML='<option value="">Selecione a mídia</option>'+state.media.map(m=>`<option value="${esc(m.id)}">${esc(company.get(m.company_id)||'Vision')} · ${esc(m.name)}</option>`).join('');let targets=[];if(existing){const r=await api.masterCall('commercial_report',{id:advertiserId});const rev=r.revisions.find(x=>x.id===existing.current_revision_id);f.elements.media_id.value=rev?.source_media_id||'';targets=r.targets.filter(t=>t.campaign_id===existing.id&&t.active).map(t=>t.device_id);}
$('#device-options').innerHTML=state.devices.map(d=>`<label class="device-choice"><input type="checkbox" name="device_ids" value="${esc(d.id)}" ${targets.includes(d.id)?'checked':''}><span>${esc(company.get(d.company_id)||'Ponto')} · ${esc(d.name)}</span></label>`).join('')||'<p>Nenhuma TV disponível.</p>';$('#campaign-dialog').showModal();}
$('#new-advertiser').onclick=()=>{if(!demo)advertiser()};$('#reload').onclick=load;$('#search').oninput=render;$('#show-archived').onchange=render;$('#close-report').onclick=()=>{$('#report').hidden=true;$('#report-campaigns').replaceChildren()};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>document.getElementById(b.dataset.close).close();$('#access-dialog').addEventListener('close',()=>{$('#access-result').textContent=''});
$('#master-login-form').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{const f=new FormData(e.target);await api.login(f.get('email'),f.get('password'));e.target.reset();await load()}catch(error){message(error.message,true)}finally{e.submitter.disabled=false}};
$('#advertiser-form').onsubmit=async e=>{e.preventDefault();const f=e.target,id=f.elements.id.value;const values=Object.fromEntries(new FormData(f));e.submitter.disabled=true;try{const r=await api.masterCall(id?'commercial_update_advertiser':'commercial_create_advertiser',values);$('#advertiser-dialog').close();await load();if(r.temporary_password)access(r,values.email)}catch(error){f.querySelector('.form-error').textContent=error.message}finally{e.submitter.disabled=false}};
$('#campaign-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),campaign=Object.fromEntries(f);campaign.device_ids=f.getAll('device_ids');if(!campaign.device_ids.length){e.target.querySelector('.form-error').textContent='Selecione ao menos uma TV.';return;}if(campaign.end_date<campaign.start_date){e.target.querySelector('.form-error').textContent='O vencimento deve ser igual ou posterior ao início.';return;}e.submitter.disabled=true;try{await api.masterCall('commercial_save_campaign',{campaign});$('#campaign-dialog').close();await load()}catch(error){e.target.querySelector('.form-error').textContent=error.message}finally{e.submitter.disabled=false}};
$('#advertisers').onclick=async e=>{const b=e.target.closest('button');if(!b)return;if(demo&&!b.dataset.report&&!b.dataset.archive&&!b.dataset.restore)return;const ownGeneration=generation;b.disabled=true;try{if(b.dataset.edit)advertiser(b.dataset.edit);if(b.dataset.campaign)await campaign(b.dataset.campaign);if(b.dataset.editCampaign){const c=state.campaigns.find(x=>x.id===b.dataset.editCampaign);await campaign(c.advertiser_id,c)}if(b.dataset.report){const data=demo?demoSession.report(b.dataset.report):await api.masterCall('commercial_report',{id:b.dataset.report});if(ownGeneration!==generation)return;$('#report-title').textContent='Resultados · '+data.advertiser.name;$('#report-campaigns').innerHTML=renderCampaigns(data,true);$('#report').hidden=false;$('#report').scrollIntoView({behavior:'smooth'});if(!demo)await loadThumbnails($('#report-campaigns'),data,api)}if(b.dataset.reset){const a=state.advertisers.find(x=>x.id===b.dataset.reset);if(confirm(`Redefinir a senha de ${a.name}?`)){const r=await api.masterCall('commercial_reset_access',{id:a.id});if(ownGeneration!==generation)return;access(r,a.email)}}if(b.dataset.archive){
  const a=state.advertisers.find(x=>x.id===b.dataset.archive&&!x.archived_at);
  if(!a)throw new Error('Anunciante não encontrado.');
  if(confirm(`Excluir o anunciante "${a.name}"? O acesso ao portal será bloqueado e os anúncios deixarão de entrar nas novas programações. Histórico, campanhas e mídias ficam preservados, e o cadastro poderá ser restaurado.`)){
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
// Staging-only probe: no customer upload, playlist or TV commands.
$('#staging-storage-probe').onclick=async e=>{
 const button=e.currentTarget, output=$('#staging-storage-probe-result');
 if(!api.session()){output.textContent='Entre com sua conta Master de homologação antes de testar.';return;}
 button.disabled=true;output.textContent='Verificando Storage privado de homologação…';
 try{
  const r=await api.masterCall('commercial_storage_probe');
  if(!r.ok||!r.uploaded||!r.copied||!r.signed_read_verified||!r.cleanup_verified)
   throw new Error('O teste não passou por todas as verificações.');
  output.textContent='APROVADO: arquivo real enviado, copiado, lido por URL assinada e removido. Nenhuma TV ou playlist foi alterada.';
 }catch(e){output.textContent='Teste incompleto: '+String(e?.message||'falha no Storage')+'. Não envie campanhas reais.';}
 finally{button.disabled=false;}
};
// Run the complete authenticated virtual TV + Storage trial in staging only.
$('#staging-virtual-trial').onclick=async e=>{
 const button=e.currentTarget,output=$('#staging-virtual-trial-result');
 if(!api.session()){output.textContent='Entre com o Master de homologação primeiro.';return;}
 button.disabled=true;output.textContent='Validando TV virtual, anúncio, Storage e relatório. Aguarde…';
 try{
  const r=await api.masterCall('commercial_virtual_trial');
  if(!r.ok||!r.cleanup_verified||!r.signed_media_verified||r.valid_completions!==2)
   throw new Error('Validação parcial');
  output.textContent='APROVADO: TV virtual autenticada, anúncio entregue, imagem assinada conferida, 2 exibições válidas sem duplicação e dados temporários removidos. Nenhuma TV real alterada.';
 }catch(error){output.textContent='NÃO CONCLUÍDO: '+String(error?.message||'erro de homologação')+'. Não usar em produção.';}
 finally{button.disabled=false;}
};
$('#logout').onclick=async()=>{generation++;busy=false;state=null;$('#admin').hidden=true;$('#advertisers').replaceChildren();$('#report-campaigns').replaceChildren();try{await api.logout()}catch{}$('#master-login').hidden=false;message('Você saiu do painel.');};
if(demo){$('#master-login').hidden=true;$('#admin').hidden=false;$('#master-demo-banner').hidden=false;$('#new-advertiser').disabled=true;$('#logout').hidden=true;document.querySelector('#admin a.button').href='./anunciante-homologacao.html?demo=1';load()}else if(api.session())load();else{$('#master-login').hidden=false;if(!api.config?.enabled)message('Homologação ainda não conectada. O sistema em produção permanece intacto.');}
