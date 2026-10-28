import {fetchCachedJson} from './utils/fetch-cached-json.mjs';
const items=document.getElementById('items'),status=document.getElementById('status');
let inFlight=false;
function render(result){
 if(result.value){
  items.replaceChildren(...result.value.itens.map(v=>{const el=document.createElement('div');el.textContent=String(v);return el}));
  status.textContent=result.stale?'Dados offline • Exibindo último conteúdo salvo':result.source==='cache'?'Conteúdo salvo • Atualização a cada 3 horas':'Conteúdo atualizado • Próxima consulta em até 3 horas';
 }else{
  items.textContent='Conteúdo temporariamente indisponível';
  status.textContent='Aguardando conexão';
 }
}
async function update(){
 if(inFlight)return;inFlight=true;
 try{render(await fetchCachedJson('./informativo-demo.json',{cacheKey:'vision-informativo-demo-v1',validate:d=>!!d&&Array.isArray(d.itens)&&d.itens.every(x=>typeof x==='string')}));}
 catch{items.textContent='Conteúdo temporariamente indisponível';status.textContent='Aguardando conexão';}
 finally{inFlight=false;}
}
update();setInterval(update,60000);
window.addEventListener('online',update);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)update()});