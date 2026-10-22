(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sessionKey='vision_midia_session_v1';
const cfg=window.VISION_CONFIG||{};
const state={list:null,pointId:null,busy:false};
const getSession=()=>{try{return JSON.parse(localStorage.getItem(sessionKey)||'null')}catch{return null}};
const setStatus=(text,error=false)=>{const el=$('#status');el.textContent=text;el.className='notice'+(error?' error':'')};
async function refresh(){
 const old=getSession();
 if(!old?.refresh_token)throw Error('Sua sessão expirou. Entre novamente no Master.');
 const res=await fetch(cfg.supabaseUrl+'/auth/v1/token?grant_type=refresh_token',{
  method:'POST',headers:{apikey:cfg.supabasePublishableKey,'Content-Type':'application/json'},
  body:JSON.stringify({refresh_token:old.refresh_token})});
 const d=await res.json();
 if(!res.ok||!d.access_token)throw Error('Faça login novamente no Master.');
 const next={...old,...d,expires_at:Math.floor(Date.now()/1000)+(d.expires_in||3600)};
 localStorage.setItem(sessionKey,JSON.stringify(next));
 return next;
}
async function api(action,body={},retry=true){
 let session=getSession();
 if(!session?.access_token)throw Error('Entre no Master para administrar os pontos.');
 const res=await fetch(cfg.supabaseUrl+'/functions/v1/vision-network-points',{
  method:'POST',headers:{apikey:cfg.supabasePublishableKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
  body:JSON.stringify({action,...body}),cache:'no-store'});
 if(res.status===401&&retry){await refresh();return api(action,body,false)}
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(({
  master_only:'Acesso reservado ao Master.',
  publication_requires_consent_and_location:'Confirme autorização e informe cidade e bairro antes de publicar.',
  publication_requires_tv:'Selecione pelo menos uma TV do estabelecimento.',
  tv_not_eligible_for_public_catalog:'TV inválida, residencial ou não pareada; selecione uma TV real do ponto.',
  tv_already_used_by_another_point:'Esta TV já pertence a outro ponto do catálogo.',
  photo_limit_three:'O limite é de três fotos por estabelecimento.',
 }[data.error])||data.error||'Não foi possível concluir a operação.');
 return data;
}
function selected(){return state.list?.points?.find(p=>p.id===state.pointId)||null}
function renderEntries(){
 const points=state.list.points;
 $('#entries').innerHTML=points.length?points.map(p=>
  '<div class="entry"><strong>'+esc(p.name)+'</strong><div class="mini muted">'+
  esc([p.neighborhood,p.city].filter(Boolean).join(' · '))+' · '+(p.tvs?.length||0)+' TVs</div>'+
  '<span class="chip">'+(p.published?'Publicado':'Rascunho')+'</span><br>'+
  '<button type="button" class="button secondary" data-edit="'+esc(p.id)+'">Editar ponto</button> '+
  '<a class="ghostlink" href="./pontos.html?ponto='+encodeURIComponent(p.slug)+'" target="_blank" rel="noopener">Abrir catálogo ↗</a></div>'
 ).join(''):'<p class="muted">Nenhum ponto criado. Comece pelo formulário ao lado.</p>';
}
function renderCompanies(){
 const sel=$('#point-form [name="company_id"]');
 const prev=sel.value;
 sel.replaceChildren(new Option('Selecione um estabelecimento',''),...state.list.companies.map(c=>new Option(c.name,c.id)));
 if(state.list.companies.some(c=>c.id===prev))sel.value=prev;
}
function renderScreens(selectedTvs=[]){
 const id=$('#point-form [name="company_id"]').value;
 const options=state.list.devices.filter(d=>d.company_id===id && d.allowed);
 const chosen=new Map(selectedTvs.map(t=>[t.device_id,t]));
 $('#screen-list').className=options.length?'':'notice';
 if(!id||!options.length){$('#screen-list').textContent=id?'Nenhuma TV física pareada disponível para esse estabelecimento. TVs de teste e residenciais não podem ser publicadas.':'Selecione um estabelecimento.';return;}
 $('#screen-list').innerHTML=options.map(d=>{
  const row=chosen.get(d.id),checked=!!row;
  return '<div class="screen"><input id="dev-'+esc(d.id)+'" type="checkbox" value="'+esc(d.id)+'" name="device_ids" '+(checked?'checked':'')+'>'+
  '<label for="dev-'+esc(d.id)+'">'+esc(d.name)+'<br><small>'+esc(d.orientation==='portrait'?'Vertical':d.orientation==='landscape'?'Horizontal':'Orientação automática')+'</small></label>'+
  '<input type="number" aria-label="Polegadas da TV '+esc(d.name)+'" min="10" max="120" step="1" name="inches_'+esc(d.id)+'" placeholder="Pol." value="'+esc(row?.screen_inches??'')+'">'+
  '<input class="placement" type="text" aria-label="Posição da TV '+esc(d.name)+'" name="place_'+esc(d.id)+'" maxlength="120" placeholder="Posição: entrada, recepção, sala..." value="'+esc(row?.placement||'')+'"></div>';
 }).join('');
}
function renderPhotos(){
 const p=selected();
 $('#photo-section').hidden=!p;
 if(!p)return;
 $('#photo-list').innerHTML=(p.photo_paths||[]).map((path,i)=>
  '<figure>'+(p.photos?.[i]?'<img src="'+esc(p.photos[i])+'" loading="lazy" alt="Foto cadastrada do ponto">':'<span class="muted">Foto salva</span>')+
  '<button type="button" class="button secondary" data-photo-remove="'+esc(path)+'">Remover</button></figure>'
 ).join('')||'<span class="muted">Nenhuma foto cadastrada.</span>';
 $('#photo-input').disabled=p.photo_paths.length>=3;
 $('#upload-photo').disabled=p.photo_paths.length>=3;
}
function editPoint(p=null){
 state.pointId=p?.id||null;
 const form=$('#point-form');
 form.reset();form.elements.id.value=p?.id||'';
 form.elements.company_id.value=p?.company_id||'';
 form.elements.company_id.disabled=!!p; // immutable association to prevent cross-client changes
 form.elements.name.value=p?.name||'';
 form.elements.category.value=p?.category||'Comércio';
 form.elements.city.value=p?.city||'';
 form.elements.neighborhood.value=p?.neighborhood||'';
 form.elements.public_address.value=p?.public_address||'';
 form.elements.opening_hours.value=p?.opening_hours||'';
 form.elements.estimated_daily_visitors.value=p?.estimated_daily_visitors??'';
 form.elements.consent.checked=!!p?.consent_confirmed_at;
 form.elements.share_address.checked=!!p?.share_address;
 form.elements.published.checked=!!p?.published;
 $('#edit-title').textContent=p?'Editar: '+p.name:'Cadastrar ponto';
 renderScreens(p?.tvs||[]);
 renderPhotos();
 if(p)$('#point-form').scrollIntoView({behavior:'smooth',block:'start'});
}
async function load(idToOpen=null){
 const data=await api('master_list');
 state.list=data;
 $('#workspace').hidden=false;
 renderCompanies();renderEntries();
 if(idToOpen!==null)state.pointId=idToOpen;
 editPoint(selected());
 setStatus('Painel conectado. Pontos publicados aparecem no catálogo; rascunhos permanecem privados.');
}
async function save(event){
 event.preventDefault();
 if(state.busy)return;
 const f=event.currentTarget,fields=Object.fromEntries(new FormData(f));
 const tvs=[...f.querySelectorAll('[name="device_ids"]:checked')].map(input=>({
  device_id:input.value,
  screen_inches:f.elements['inches_'+input.value]?.value||null,
  placement:f.elements['place_'+input.value]?.value||'',
 }));
 const point={
  id:fields.id||null,
  company_id:f.elements.company_id.value,
  name:f.elements.name.value,category:f.elements.category.value,
  city:f.elements.city.value,neighborhood:f.elements.neighborhood.value,
  public_address:f.elements.public_address.value,opening_hours:f.elements.opening_hours.value,
  estimated_daily_visitors:f.elements.estimated_daily_visitors.value,
  consent:f.elements.consent.checked,share_address:f.elements.share_address.checked,
  published:f.elements.published.checked,tvs,
 };
 if(point.published&&!point.consent){setStatus('É necessário confirmar a autorização antes de publicar.',true);return}
 if(point.published&&!tvs.length){setStatus('Para publicar, selecione pelo menos uma TV válida.',true);return}
 state.busy=true;$('#save-point').disabled=true;
 try{
  const result=await api('save',{point});
  await load(result.id);
  setStatus('Ponto salvo. '+(point.published?'Publicado no catálogo compartilhável.':'Mantido como rascunho privado.'));
 }catch(error){setStatus('Erro ao salvar: '+error.message,true)}
 finally{state.busy=false;$('#save-point').disabled=false}
}
async function photoUpload(){
 const p=selected(),file=$('#photo-input').files?.[0];
 if(!p||!file){setStatus('Salve o ponto e escolha uma foto antes de enviar.',true);return}
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size<1||file.size>4000000){
  setStatus('Use uma foto PNG, JPG ou WebP de até 4 MB.',true);return;
 }
 $('#upload-photo').disabled=true;
 try{
  const signed=await api('photo_start',{id:p.id,mime:file.type,size_bytes:file.size});
  const path=signed.path.split('/').map(encodeURIComponent).join('/');
  const destination=cfg.supabaseUrl+'/storage/v1/object/upload/sign/vision-media/'+path+'?token='+encodeURIComponent(signed.token);
  const form=new FormData();form.append('cacheControl','3600');form.append('',file);
  const response=await fetch(destination,{method:'PUT',headers:{apikey:cfg.supabasePublishableKey},body:form});
  if(!response.ok)throw Error('O armazenamento recusou o arquivo ('+response.status+').');
  await api('photo_attach',{id:p.id,path:signed.path});
  await load(p.id);$('#photo-input').value='';
  setStatus('Foto salva. Será exibida quando o ponto estiver publicado.');
 }catch(error){setStatus('Falha ao enviar foto: '+error.message,true)}
 finally{$('#upload-photo').disabled=false}
}
async function removePhoto(path){
 const p=selected();
 if(!p||!confirm('Remover esta foto do catálogo?'))return;
 try{await api('photo_remove',{id:p.id,path});await load(p.id);setStatus('Foto removida do catálogo.')}
 catch(error){setStatus(error.message,true)}
}
$('#point-form').addEventListener('submit',save);
$('#point-form [name="company_id"]').addEventListener('change',()=>renderScreens());
$('#new-point').addEventListener('click',()=>editPoint());
$('#reset-point').addEventListener('click',()=>editPoint());
$('#upload-photo').addEventListener('click',photoUpload);
$('#photo-list').addEventListener('click',event=>{const b=event.target.closest('[data-photo-remove]');if(b)removePhoto(b.dataset.photoRemove)});
$('#entries').addEventListener('click',event=>{const button=event.target.closest('[data-edit]');if(button){const p=state.list?.points.find(p=>p.id===button.dataset.edit);if(p)editPoint(p)}});
if(!cfg.supabaseUrl||!cfg.supabasePublishableKey)setStatus('Configuração do servidor indisponível.',true);
else if(!getSession()?.access_token)setStatus('Entre primeiro no <a href="./master.html">Master</a>.',true);
else load().catch(error=>setStatus(error.message+' Abra o Master para entrar novamente.',true));
})();