(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sessionKey='vision_midia_session_v1';
const cfg=window.VISION_CONFIG||{};
const state={list:null,pointId:null,busy:false,hoursOriginal:'',hoursTouched:false,hoursLegacy:false};
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
  tv_already_used_by_another_point:'Uma TV selecionada já está vinculada a outro ponto. Use “Editar este ponto” no aviso junto às TVs, ou escolha outra TV.',
  photo_limit_three:'O limite é de três fotos por estabelecimento.',
 }[data.error])||data.error||'Não foi possível concluir a operação.');
 return data;
}
function selected(){return state.list?.points?.find(p=>p.id===state.pointId)||null}

function pointSaveState(message,kind='pending'){
 const el=$('#point-save-confirmation');
 if(!el)return;
 el.textContent=message;el.dataset.state=kind;
}
function moneyFromCents(value){
 return (Number(value)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function centsFromInput(value){
 const raw=String(value||'').trim().replace(/^R\$\s*/i,'');
 if(!/^\d{1,7}(?:[,.]\d{1,2})?$/.test(raw))throw Error('Informe um preço válido, por exemplo: 35,00.');
 const [whole,fraction='']=raw.replace('.',',').split(',');
 const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents>100000000)throw Error('O valor informado está fora do limite permitido.');
 return cents;
}
function renderPlans(){
 const root=$('#plan-editor');
 const plans=new Map((state.list?.plans||[]).map(p=>[Number(p.slot),p]));
 root.innerHTML=[1,2,3].map(slot=>{
  const p=plans.get(slot)||{name:'Plano '+slot,description:'',price_cents:null,active:false};
  return '<form class="network-plan-item" data-plan-slot="'+slot+'">'+
   '<strong>Plano '+slot+'</strong>'+
   '<label>Nome do plano<input name="name" maxlength="80" minlength="2" required value="'+esc(p.name||'Plano '+slot)+'" placeholder="Ex.: 7 dias"></label>'+
   '<label>Descrição<textarea name="description" maxlength="280" rows="3" placeholder="Ex.: Divulgação em uma TV por sete dias">'+esc(p.description||'')+'</textarea></label>'+
   '<label>Valor do anúncio (R$)<input name="price" inputmode="decimal" type="text" placeholder="35,00" value="'+esc(p.price_cents==null?'':moneyFromCents(p.price_cents))+'"></label>'+
   '<label class="check"><input name="active" type="checkbox" '+(p.active?'checked':'')+'><span>Mostrar este plano no catálogo</span></label>'+
   '<div class="network-plan-actions"><button class="button secondary" type="submit">Salvar plano '+slot+'</button>'+
   '<span class="save-confirmation" data-plan-status="'+slot+'" role="status" aria-live="polite">Sem alterações</span></div>'+
   '</form>';
 }).join('');
 $('#plans-workspace').hidden=false;
}
$('#plan-editor').addEventListener('input',event=>{
 const form=event.target.closest('form[data-plan-slot]');
 if(form){const status=form.querySelector('[data-plan-status]');status.textContent='Alterações não salvas';status.dataset.state='pending'}
});
$('#plan-editor').addEventListener('change',event=>{
 const form=event.target.closest('form[data-plan-slot]');
 if(form){const status=form.querySelector('[data-plan-status]');status.textContent='Alterações não salvas';status.dataset.state='pending'}
});
$('#plan-editor').addEventListener('submit',async event=>{
 const form=event.target.closest('form[data-plan-slot]');
 if(!form)return;
 event.preventDefault();
 const button=form.querySelector('button[type="submit"]');
 const status=form.querySelector('[data-plan-status]');
 if(button.disabled||!form.reportValidity())return;
 try{
  const slot=Number(form.dataset.planSlot);
  const name=form.elements.name.value.trim(),description=form.elements.description.value.trim();
  const raw=form.elements.price.value.trim();
  const active=form.elements.active.checked;
  const price_cents=raw?centsFromInput(raw):null;
  if(active&&(price_cents===null||!description))throw Error('Para mostrar o plano, preencha a descrição e o valor.');
  button.disabled=true;status.textContent='Gravando plano…';status.dataset.state='pending';
  const result=await api('save_plan',{plan:{slot,name,description,price_cents,active}});
  const index=(state.list.plans||[]).findIndex(p=>Number(p.slot)===slot);
  if(index<0)state.list.plans.push(result.plan);else state.list.plans[index]=result.plan;
  status.textContent='✓ Salvo no Master às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  status.dataset.state='saved';
 }catch(error){
  status.textContent='✕ Não salvo: '+error.message;status.dataset.state='error';
 }finally{button.disabled=false}
});

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
 const conflicts=state.list.points.filter(p=>p.company_id===id&&p.id!==state.pointId&&(p.tvs||[]).some(t=>options.some(d=>d.id===t.device_id)));
 if(conflicts.length){
  const notice=document.createElement('div');
  notice.className='notice';
  notice.innerHTML='<strong>TV já cadastrada</strong><p>Este estabelecimento possui TV vinculada a outro ponto. Para alterar as informações e preservar o cadastro anterior, abra o ponto existente:</p>'+
    conflicts.map(p=>'<button class="button secondary" type="button" data-edit-existing="'+esc(p.id)+'">Editar '+esc(p.name)+'</button>').join(' ');
  $('#screen-list').prepend(notice);
 }
}
function renderPhotos(){
 const p=selected();
 $('#photo-section').hidden=false;
 if(!p){
  $('#photo-list').innerHTML='<span class="muted">Você pode enviar a primeira foto agora. O ponto será salvo como rascunho privado.</span>';
  $('#photo-input').disabled=false;$('#upload-photo').disabled=false;
  return;
 }
 $('#photo-list').innerHTML=(p.photo_paths||[]).map((path,i)=>
  '<figure>'+(p.photos?.[i]?'<img src="'+esc(p.photos[i])+'" loading="lazy" alt="Foto cadastrada do ponto">':'<span class="muted">Foto salva</span>')+
  '<button type="button" class="button secondary" data-photo-remove="'+esc(path)+'">Remover</button></figure>'
 ).join('')||'<span class="muted">Nenhuma foto cadastrada.</span>';
 $('#photo-input').disabled=p.photo_paths.length>=3;
 $('#upload-photo').disabled=p.photo_paths.length>=3;
}

const DAYS=[
 {id:'weekdays',title:'Segunda a sexta',aliases:['segunda a sexta','seg a sexta','seg a sex']},
 {id:'saturday',title:'Sábado',aliases:['sábado','sabado','sáb']},
 {id:'sunday',title:'Domingo',aliases:['domingo','dom']},
];
function hoursParts(id){
 return {
  enabled:$('#point-form [data-hours-day="'+id+'"]'),
  open:$('#point-form [data-hours-open="'+id+'"]'),
  close:$('#point-form [data-hours-close="'+id+'"]')
 };
}
function resetHours(original=''){
 state.hoursOriginal=String(original||'');state.hoursTouched=false;state.hoursLegacy=false;
 for(const d of DAYS){const h=hoursParts(d.id);h.enabled.checked=false;h.open.value='';h.close.value='';h.open.disabled=true;h.close.disabled=true;}
 const lines=state.hoursOriginal.split(/\n|;/).map(line=>line.trim()).filter(Boolean);
 let parsed=0;
 for(const line of lines){
  const label=line.split(': ')[0].toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
  const day=DAYS.find(d=>d.aliases.some(a=>a===label));
  const range=line.match(/(\d{2}:\d{2})\s*(?:às|as|a|-|–)\s*(\d{2}:\d{2})/i);
  if(!day||!range)continue;
  const h=hoursParts(day.id);h.enabled.checked=true;h.open.value=range[1];h.close.value=range[2];
  h.open.disabled=false;h.close.disabled=false;parsed++;
 }
 state.hoursLegacy=!!state.hoursOriginal && parsed!==lines.length;
 const legacy=$('#hours-legacy');
 legacy.hidden=!state.hoursLegacy;
 legacy.textContent=state.hoursLegacy?'Horário anterior preservado até você editar: '+state.hoursOriginal:'';
}
function serializeHours(){
 if(!state.hoursTouched&&state.hoursLegacy)return state.hoursOriginal;
 const lines=[];
 for(const d of DAYS){
  const h=hoursParts(d.id);
  if(!h.enabled.checked)continue;
  if(!h.open.value||!h.close.value)throw Error('Informe abertura e fechamento para '+d.title+'.');
  if(h.open.value===h.close.value)throw Error('Abertura e fechamento devem ser diferentes em '+d.title+'.');
  lines.push(d.title+': '+h.open.value+' às '+h.close.value);
 }
 return lines.join('\n');
}
for(const d of DAYS){
 const h=hoursParts(d.id);
 h.enabled.addEventListener('change',()=>{
  state.hoursTouched=true;
  h.open.disabled=!h.enabled.checked;h.close.disabled=!h.enabled.checked;
  $('#hours-legacy').hidden=true;
 });
 h.open.addEventListener('change',()=>{state.hoursTouched=true;$('#hours-legacy').hidden=true});
 h.close.addEventListener('change',()=>{state.hoursTouched=true;$('#hours-legacy').hidden=true});
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
 resetHours(p?.opening_hours||'');
 form.elements.estimated_daily_visitors.value=p?.estimated_daily_visitors??'';
 form.elements.consent.checked=!!p?.consent_confirmed_at;
 form.elements.share_address.checked=!!p?.share_address;
 form.elements.published.checked=!!p?.published;
 $('#edit-title').textContent=p?'Editar: '+p.name:'Cadastrar ponto';
 pointSaveState(p?'Ponto carregado':'Novo ponto ainda não salvo');
 renderScreens(p?.tvs||[]);
 renderPhotos();
 if(p)$('#point-form').scrollIntoView({behavior:'smooth',block:'start'});
}
async function load(idToOpen=null){
 const data=await api('master_list');
 state.list=data;
 $('#workspace').hidden=false;
 renderCompanies();renderEntries();renderPlans();
 if(idToOpen!==null)state.pointId=idToOpen;
 editPoint(selected());
 setStatus('Painel conectado. Pontos publicados aparecem no catálogo; rascunhos permanecem privados.');
}

function pointFromForm({asDraft=false}={}){
 const f=$('#point-form');
 const tvs=[...f.querySelectorAll('[name="device_ids"]:checked')].map(input=>({
  device_id:input.value,
  screen_inches:f.elements['inches_'+input.value]?.value||null,
  placement:f.elements['place_'+input.value]?.value||'',
 }));
 const point={
  id:f.elements.id.value||null,
  company_id:f.elements.company_id.value,
  name:f.elements.name.value.trim(),category:f.elements.category.value,
  city:f.elements.city.value.trim(),neighborhood:f.elements.neighborhood.value.trim(),
  public_address:f.elements.public_address.value.trim(),
  opening_hours:serializeHours(),
  estimated_daily_visitors:f.elements.estimated_daily_visitors.value,
  consent:f.elements.consent.checked,share_address:f.elements.share_address.checked,
  published:asDraft?false:f.elements.published.checked,tvs,
 };
 if(point.published&&!point.consent)throw Error('Confirme a autorização do estabelecimento para publicar.');
 if(point.published&&!tvs.length)throw Error('Para publicar, selecione pelo menos uma TV real do estabelecimento.');
 if(point.share_address&&!point.consent)throw Error('Para divulgar o endereço, confirme a autorização do estabelecimento.');
 return point;
}
async function save(event){
 event.preventDefault();
 if(state.busy)return;
 const form=event.currentTarget;
 if(!form.reportValidity())return;
 state.busy=true;$('#save-point').disabled=true;
 try{
  const point=pointFromForm();
  const result=await api('save',{point});
  setStatus('Dados gravados com sucesso. Atualizando informações…');
  try{
   await load(result.id);
   pointSaveState('✓ Salvo no Master às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),'saved');
   setStatus('✓ Informações salvas. '+(point.published?'Ponto publicado no catálogo.':'Rascunho privado salvo.'));
  }catch(error){
   state.pointId=result.id;
   pointSaveState('✓ Salvo no servidor (lista aguardando atualização)','saved');
   setStatus('Ponto salvo no servidor, mas a lista não atualizou: '+error.message,true);
  }
 }catch(error){pointSaveState('✕ Não salvo: '+error.message,'error');setStatus('Não foi possível salvar: '+error.message,true)}
 finally{state.busy=false;$('#save-point').disabled=false}
}
async function preparePhoto(file){
 if(!file||!file.size)throw Error('Selecione uma foto válida.');
 const formats=new Set(['image/jpeg','image/png','image/webp']);
 const max=4000000;
 if(file.size<=max&&formats.has(file.type))return file;
 if(file.size>40000000)throw Error('Esta foto é muito grande. Escolha uma imagem de até 40 MB.');
 let img=null,objectUrl=null;
 try{
  if(typeof createImageBitmap==='function')img=await createImageBitmap(file);
  else{
   objectUrl=URL.createObjectURL(file);
   img=await new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(Error('Formato de imagem não compatível com o navegador.'));
    image.src=objectUrl;
   });
  }
  const width=img.width||img.naturalWidth,height=img.height||img.naturalHeight;
  if(!width||!height)throw Error('Não foi possível ler as dimensões da foto.');
  const scale=Math.min(1,1920/Math.max(width,height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));
  canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('O navegador não consegue otimizar esta foto.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  for(const quality of [0.86,0.74,0.6,0.47]){
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
   if(blob&&blob.size>0&&blob.size<=max)return new File([blob],'foto-ponto-vision.jpg',{type:'image/jpeg'});
  }
  throw Error('Não foi possível reduzir esta foto. Escolha outra imagem.');
 }catch(e){
  if(e?.message)throw e;
  throw Error('O formato desta foto não é compatível. Experimente uma imagem JPG ou PNG.');
 }finally{try{img?.close?.()}catch{}if(objectUrl)URL.revokeObjectURL(objectUrl)}
}
async function photoUpload(){
 if(state.busy)return;
 const picked=$('#photo-input').files?.[0];
 if(!picked){setStatus('Escolha uma foto para enviar.',true);return}
 state.busy=true;$('#upload-photo').disabled=true;$('#save-point').disabled=true;
 let draftCreated=false;
 try{
  setStatus('Preparando a foto para envio…');
  const file=await preparePhoto(picked);
  let p=selected();
  if(!p){
   const form=$('#point-form');
   if(!form.reportValidity()){setStatus('Complete os campos obrigatórios do ponto antes de enviar a foto.',true);return;}
   const point=pointFromForm({asDraft:true});
   const created=await api('save',{point});
   draftCreated=true;
   await load(created.id);
   p=selected();
   if(!p)throw Error('Rascunho salvo, mas não foi possível recuperá-lo.');
  }
  setStatus('Enviando foto '+(file.size/1048576).toFixed(1)+' MB para a Vision…');
  const signed=await api('photo_start',{id:p.id,mime:file.type,size_bytes:file.size});
  const path=signed.path.split('/').map(encodeURIComponent).join('/');
  const destination=cfg.supabaseUrl+'/storage/v1/object/upload/sign/vision-media/'+path+'?token='+encodeURIComponent(signed.token);
  const form=new FormData();form.append('cacheControl','3600');form.append('',file);
  const response=await fetch(destination,{method:'PUT',headers:{apikey:cfg.supabasePublishableKey},body:form});
  if(!response.ok){
   const detail=await response.json().catch(()=>({}));
   throw Error('Armazenamento recusou o envio: '+String(detail.message||detail.error||'HTTP '+response.status).slice(0,180));
  }
  await api('photo_attach',{id:p.id,path:signed.path});
  $('#photo-input').value='';
  setStatus('Foto enviada. Atualizando o cadastro…');
  try{await load(p.id)}catch(error){setStatus('Foto enviada e registrada; atualize a lista para vê-la: '+error.message,true);return;}
  setStatus('Foto salva com sucesso.'+(draftCreated?' O ponto foi criado como rascunho privado. Para divulgá-lo, marque Publicar e salve.':''));
 }catch(error){
  setStatus((draftCreated?'Rascunho do ponto preservado. ':'')+'Falha ao enviar foto: '+error.message,true);
 }finally{state.busy=false;$('#upload-photo').disabled=!!(selected()?.photo_paths?.length>=3);$('#save-point').disabled=false}
}
async function removePhoto(path){
 const p=selected();
 if(!p||!confirm('Remover esta foto do catálogo?'))return;
 try{await api('photo_remove',{id:p.id,path});await load(p.id);setStatus('Foto removida do catálogo.')}
 catch(error){setStatus(error.message,true)}
}
$('#point-form').addEventListener('submit',save);
for(const eventType of ['input','change'])$('#point-form').addEventListener(eventType,()=>{
 pointSaveState('Alterações não salvas','pending');
});

$('#point-form [name="company_id"]').addEventListener('change',()=>{
 const form=$('#point-form'),id=form.elements.company_id.value;
 const matches=(state.list?.points||[]).filter(p=>p.company_id===id);
 const screens=(state.list?.devices||[]).filter(d=>d.company_id===id&&d.allowed);
 const used=new Set(matches.flatMap(p=>(p.tvs||[]).map(t=>t.device_id)));
 const hasDetails=!!(form.elements.name.value.trim()||form.elements.city.value.trim()||form.elements.neighborhood.value.trim()||form.elements.public_address.value.trim());
 if(!state.pointId&&matches.length===1&&screens.length>0&&screens.every(d=>used.has(d.id))&&!hasDetails){
  editPoint(matches[0]);
  setStatus('Cadastro existente aberto para edição: '+matches[0].name+'. Altere os dados e clique em Salvar ponto.');
 }else{
  renderScreens();
  if(!state.pointId&&matches.length)setStatus('Este estabelecimento já tem ponto cadastrado. Para editar as TVs vinculadas, toque em “Editar este ponto” junto às TVs.');
 }
});
$('#screen-list').addEventListener('click',event=>{
 const button=event.target.closest('[data-edit-existing]');
 if(!button)return;
 const point=state.list?.points?.find(p=>p.id===button.dataset.editExisting);
 if(point){editPoint(point);setStatus('Editando o cadastro existente: '+point.name+'. Confira as alterações e salve.')}
});
$('#new-point').addEventListener('click',()=>editPoint());
$('#reset-point').addEventListener('click',()=>editPoint());
$('#upload-photo').addEventListener('click',photoUpload);
$('#photo-list').addEventListener('click',event=>{const b=event.target.closest('[data-photo-remove]');if(b)removePhoto(b.dataset.photoRemove)});
$('#entries').addEventListener('click',event=>{const button=event.target.closest('[data-edit]');if(button){const p=state.list?.points.find(p=>p.id===button.dataset.edit);if(p)editPoint(p)}});
const demoMode=new URLSearchParams(location.search).get('demo')==='1';
if(demoMode){
 const id='00000000-0000-4000-8000-000000000001',companyId='00000000-0000-4000-8000-000000000002';
 const tvId='00000000-0000-4000-8000-000000000003';
 state.list={
  companies:[{id:companyId,name:'Academia — Exemplo de Cadastro'}],
  devices:[{id:tvId,company_id:companyId,name:'TV de demonstração',orientation:'portrait',allowed:true}],
  points:[{id,company_id:companyId,slug:'academia-exemplo',name:'Academia — Exemplo',category:'Academia',
   city:'Anápolis',neighborhood:'A cadastrar',public_address:'',opening_hours:'',
   estimated_daily_visitors:null,share_address:false,consent_confirmed_at:null,published:false,
   photo_paths:[],photos:[],tvs:[{point_id:id,device_id:tvId,screen_inches:null,placement:''}]}],
 };
 $('#workspace').hidden=false;renderCompanies();renderEntries();editPoint(state.list.points[0]);
 $('#save-point').disabled=true;$('#upload-photo').disabled=true;$('#photo-input').disabled=true;
 $('#point-form').addEventListener('submit',event=>{event.preventDefault();setStatus('Demonstração visual: nenhum dado será salvo na Vision.');},true);
 setStatus('DEMONSTRAÇÃO VISUAL — Dados fictícios. Nenhuma alteração é gravada.');
}else if(!cfg.supabaseUrl||!cfg.supabasePublishableKey)setStatus('Configuração do servidor indisponível.',true);
else if(!getSession()?.access_token)setStatus('Entre primeiro no <a href="./master.html">Master</a>.',true);
else load().catch(error=>setStatus(error.message+' Abra o Master para entrar novamente.',true));
})();