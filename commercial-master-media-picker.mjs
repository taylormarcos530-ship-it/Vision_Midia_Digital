import {esc} from './commercial-ui.mjs';

// Commercial previews are signed server-side only for authorized Master sessions.
// Images are lazy; videos load metadata when visible and play only upon explicit selection.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const validMedia=media=>media&&uuid.test(media.id)&&['image','video'].includes(media.media_type);
export function mediaPickerEntries(data){
 const company=new Map((data?.companies||[]).map(c=>[c.id,c.name]));
 return [
  ...(data?.sources||[]).filter(validMedia).map(m=>({...m,origin:'vision',subtitle:'Vision comercial'})),
  ...(data?.media||[]).filter(validMedia).map(m=>({...m,origin:'customer',subtitle:company.get(m.company_id)||'Estabelecimento'}))
 ];
}
export function normalizeSignedPreview(raw,base){
 if(typeof raw!=='string'||!raw)return null;
 try{
  const origin=new URL(base).origin;
  const url=new URL(raw.startsWith('/object/')?'/storage/v1'+raw:raw,origin);
  if(url.origin!==origin||!/^\/storage\/v1\/object\/sign\/vision-media\/[^\s]+$/i.test(url.pathname)||!url.searchParams.has('token'))return null;
  return url.href;
 }catch{return null;}
}
export function createCommercialMediaPicker({api,grid,search,status,selected,preview,count,filters,select}){
 let entries=[],filter='vision',value='',generation=0;
 const urls=new Map();
 const current=()=>generation;
 const asset=id=>entries.find(x=>x.id===id);
 const thumb=(item,url)=>{
  const slot=grid.querySelector('[data-thumbnail="'+item.id+'"]');
  if(!slot||!url)return;
  const element=document.createElement(item.media_type==='video'?'video':'img');
  element.className='commercial-media-image';
  if(item.media_type==='video'){
   element.muted=true;element.playsInline=true;element.preload='metadata';
   element.setAttribute('aria-hidden','true');
   element.addEventListener('loadedmetadata',()=>{
    try{if(Number.isFinite(element.duration)&&element.duration>0.3)element.currentTime=0.2;}catch{}
   },{once:true});
  }else{element.loading='lazy';element.alt='Prévia: '+item.name;}
  element.addEventListener('error',()=>element.remove(),{once:true});
  slot.appendChild(element);
  element.src=url;
 };
 const previewSelected=()=>{
  const item=asset(value),url=urls.get(value);
  selected.textContent=item?'Selecionada: '+item.subtitle+' · '+item.name:'Nenhuma mídia selecionada.';
  preview.replaceChildren();
  if(!item)return;
  const name=document.createElement('strong');
  name.textContent=item.name;preview.appendChild(name);
  if(!url){const p=document.createElement('p');p.textContent='Carregando prévia segura…';preview.appendChild(p);return;}
  const el=document.createElement(item.media_type==='video'?'video':'img');
  el.className='commercial-media-large';
  if(item.media_type==='video'){el.controls=true;el.playsInline=true;el.preload='metadata';}
  else el.alt='Imagem selecionada: '+item.name;
  el.src=url;preview.appendChild(el);
 };
 const render=async()=>{
  const version=++generation;
  const term=search.value.trim().toLocaleLowerCase('pt-BR');
  filters.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mediaFilter===filter)));
  const matching=entries.filter(x=>(filter==='all'||x.origin===filter)&&
   (x.name+' '+x.subtitle).toLocaleLowerCase('pt-BR').includes(term));
  const visible=matching.slice(0,30);
  count.textContent=matching.length+' arquivo(s)';
  grid.innerHTML=visible.map(m=>'<button type="button" class="commercial-media-tile'+(m.id===value?' is-selected':'')+
   '" data-media-id="'+esc(m.id)+'" aria-pressed="'+String(m.id===value)+'"><span class="commercial-media-thumb" data-thumbnail="'+esc(m.id)+'"><span aria-hidden="true">'+
   (m.media_type==='video'?'▶':'▧')+'</span></span><strong>'+esc(m.name)+'</strong><small>'+esc(m.subtitle)+' · '+(m.media_type==='video'?'Vídeo':'Imagem')+'</small></button>').join('')||
   '<p class="muted">Nenhuma mídia encontrada neste grupo.</p>';
  status.textContent=matching.length>30?'Exibindo as primeiras 30 mídias. Use a busca para encontrar outras.':'Carregando miniaturas…';
  const needed=visible.filter(x=>!urls.has(x.id)).map(x=>x.id);
  for(let i=0;i<needed.length;i+=25){
   const segment=needed.slice(i,i+25);
   try{
    const response=await api.masterCall('commercial_media_previews',{ids:segment});
    if(version!==current())return;
    for(const p of response.previews||[]){
     if(!segment.includes(p.id))continue;
     const normalized=normalizeSignedPreview(p.url,api.config.supabaseUrl);
     if(normalized)urls.set(p.id,normalized);
    }
   }catch(error){
    if(version!==current())return;
    status.textContent='Miniaturas temporariamente indisponíveis. É possível selecionar pelo nome.';
    continue;
   }
  }
  if(version!==current())return;
  for(const item of visible)thumb(item,urls.get(item.id));
  if(!status.textContent.includes('indisponíveis'))status.textContent='Toque na mídia para selecionar. Vídeos mostram uma prévia sem iniciar a reprodução.';
  previewSelected();
 };
 const choose=id=>{
  if(!asset(id))return;
  value=id;select.value=id;
  grid.querySelectorAll('[data-media-id]').forEach(button=>{
   const active=button.dataset.mediaId===id;
   button.classList.toggle('is-selected',active);
   button.setAttribute('aria-pressed',String(active));
  });
  previewSelected();
 };
 grid.addEventListener('click',event=>{
  const target=event.target.closest('[data-media-id]');
  if(target)choose(target.dataset.mediaId);
 });
 select.addEventListener('change',()=>{choose(select.value);if(!urls.has(value))render()});
 search.addEventListener('input',()=>{render()});
 filters.forEach(button=>button.addEventListener('click',()=>{
  filter=button.dataset.mediaFilter;
  render();
 }));
 return {
  open(data,selectedId){
   entries=mediaPickerEntries(data);
   urls.clear();value=selectedId||'';
   filter=asset(value)?.origin||((data?.sources||[]).length?'vision':'all');
   search.value='';
   render();
  },
  close(){++generation;urls.clear();entries=[];value='';preview.replaceChildren();}
 };
}
// XHR gives genuine upload progress on Android/mobile (fetch does not expose it).
export function uploadCommercialSignedFile(url,file,key,onProgress=()=>{}){
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open('PUT',url);
  xhr.timeout=300000;
  xhr.setRequestHeader('apikey',key);
  xhr.upload.onprogress=e=>{if(e.lengthComputable&&e.total>0)onProgress(Math.min(100,Math.round(e.loaded*100/e.total)));};
  xhr.onerror=()=>reject(new Error('Falha de rede durante o envio. Confira sua conexão.'));
  xhr.ontimeout=()=>reject(new Error('O envio excedeu cinco minutos. Tente uma rede mais estável.'));
  xhr.onabort=()=>reject(new Error('O envio foi interrompido.'));
  xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('Storage recusou o envio ('+xhr.status+').'));
  const body=new FormData();body.append('cacheControl','3600');body.append('',file);
  xhr.send(body);
 });
}
