import {fetchCachedJson} from './utils/fetch-cached-json.mjs';

const params=new URLSearchParams(location.search);
const panels=Array.from(document.querySelectorAll('[data-panel]'));
const inFlight=new Set();
const blocked=/^(?:key|api_?key|token|access_?token|secret|password|authorization)$/i;
const privateIp=/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

function parsePublicUrl(raw){
  if(typeof raw!=='string'||raw.length>1500)return null;
  let url;
  try{url=new URL(raw,location.href)}catch{return null}
  if(url.username||url.password||url.hash||url.href.length>2000)return null;
  const sameOrigin=url.origin===location.origin;
  if(url.protocol!=='https:'&&!(sameOrigin&&url.protocol==='http:'))return null;
  if(!sameOrigin&&(url.hostname==='localhost'||url.hostname.endsWith('.local')||privateIp.test(url.hostname)))return null;
  for(const key of url.searchParams.keys())if(blocked.test(key))return null;
  return url.href;
}
function validFeed(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  if(typeof value.titulo!=='string'||!value.titulo.trim()||value.titulo.length>90)return false;
  return Array.isArray(value.itens)&&value.itens.length>=1&&value.itens.length<=8&&
    value.itens.every(item=>typeof item==='string'&&item.trim().length>=1&&item.length<=160);
}
function render(panel,result){
  const title=panel.querySelector('[data-title]');
  const items=panel.querySelector('[data-items]');
  const status=panel.querySelector('[data-status]');
  if(result.value){
    title.textContent=result.value.titulo;
    items.replaceChildren(...result.value.itens.map(value=>{
      const el=document.createElement('div');
      el.className='item';
      el.textContent=value;
      return el;
    }));
    status.classList.toggle('stale',Boolean(result.stale));
    if(result.stale)status.textContent='Últimos dados válidos • Aguardando conexão';
    else if(result.source==='cache')status.textContent='Dados locais • Consulta a cada 3 horas';
    else status.textContent='Dados atualizados';
  }else{
    items.replaceChildren();
    const message=document.createElement('div');
    message.className='item';
    message.textContent='Sem dados válidos disponíveis';
    items.append(message);
    status.classList.add('stale');
    status.textContent=result._meta?.lastError?'Fonte indisponível • Verificar URL e CORS':'Aguardando fonte de dados';
  }
}
function renderInvalid(panel){
  panel.querySelector('[data-items]').textContent='Configure uma URL HTTPS pública para este canal.';
  panel.querySelector('[data-status]').textContent='Fonte não configurada';
}
async function refreshPanel(panel,source){
  const id=panel.dataset.panel;
  if(inFlight.has(id))return;
  inFlight.add(id);
  try{
    const result=await fetchCachedJson(source,{
      cacheKey:'vision-json-trio:v1:'+id+':'+source,
      validate:validFeed
    });
    render(panel,result);
  }catch(error){
    panel.querySelector('[data-status]').textContent='Falha ao abrir informações';
  }finally{inFlight.delete(id)}
}
function init(){
  const sources=panels.map((panel,i)=>parsePublicUrl(params.get('s'+(i+1))));
  panels.forEach((panel,i)=>{
    if(!sources[i])renderInvalid(panel);
    else refreshPanel(panel,sources[i]);
  });
  // 60-second check; 3-hour TTL prevents repeated network fetches.
  const refreshAll=()=>panels.forEach((panel,i)=>{if(sources[i])refreshPanel(panel,sources[i])});
  setInterval(refreshAll,60000);
  window.addEventListener('online',refreshAll);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAll()});
}
init();
