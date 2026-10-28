import {fetchCachedJson} from './utils/fetch-cached-json.mjs';
const heading=document.getElementById('heading');
const list=document.getElementById('items');
const status=document.getElementById('status');
const diagnostic=document.getElementById('diagnostic');
const params=new URLSearchParams(location.search);
const src=params.get('source')||'./informativo-demo.json';
let currentSource,working=false;

function parseSource(raw){
  let url;
  try{url=new URL(raw,location.href)}catch{return null}
  if(url.username||url.password||url.hash||url.href.length>2000)return null;
  if(url.protocol!=='https:'&&!(url.origin===location.origin&&url.protocol==='http:'))return null;
  if(url.origin!==location.origin&&(url.hostname==='localhost'||url.hostname.endsWith('.local')||
    /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)))return null;
  for(const key of url.searchParams.keys()){
    if(/^(?:key|api_?key|token|access_?token|secret|password|authorization)$/i.test(key))return null;
  }
  return url.href;
}
function validData(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  if(value.titulo!==undefined&&(typeof value.titulo!=='string'||value.titulo.length>120))return false;
  return Array.isArray(value.itens)&&value.itens.length>=1&&value.itens.length<=12&&
    value.itens.every(item=>typeof item==='string'&&item.length>0&&item.length<=200);
}
function render(result){
  const value=result.value;
  if(value){
    heading.textContent=(value.titulo||'Painel informativo').trim()||'Painel informativo';
    list.replaceChildren(...value.itens.map(item=>{
      const node=document.createElement('div');node.className='entry';node.textContent=item;return node;
    }));
    if(result.stale)status.textContent='Dados salvos • Aguardando atualização';
    else if(result.source==='cache')status.textContent='Dados em cache • Atualização até 3 horas';
    else status.textContent='Dados atualizados';
  }else{
    list.textContent='Conteúdo indisponível';status.textContent='Sem fonte ou cache válido';
  }
  const meta=result._meta||{};
  diagnostic.textContent=meta.lastError
    ?'Último erro: '+meta.lastError+' • '+(meta.clockPlausible?'Relógio plausível':'Relógio não sincronizado')
    :(meta.clockPlausible?'Informação pública • relógio plausível':'Informação pública • aguardando sincronização');
}
async function refresh(){
  if(working||!currentSource)return;working=true;
  try{
    const result=await fetchCachedJson(currentSource,{
      cacheKey:'vision-public-feed:v1:'+currentSource,
      validate:validData
    });
    render(result);
  }catch(error){status.textContent='Falha na visualização';diagnostic.textContent=String(error?.message||error);}
  finally{working=false;}
}
currentSource=parseSource(src);
if(currentSource){
  refresh();
  setInterval(refresh,60_000);
  window.addEventListener('online',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
}else{
  list.textContent='URL de fonte inválida';
  status.textContent='Fonte bloqueada';
}
