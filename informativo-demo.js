import {fetchCachedJson} from './utils/fetch-cached-json.mjs';

const items=document.getElementById('items');
const status=document.getElementById('status');
const diagnostics=document.getElementById('diagnostics');
let inFlight=false;
const validDemo=(data)=>!!data&&typeof data==='object'&&!Array.isArray(data)&&
  Array.isArray(data.itens)&&data.itens.length>=1&&data.itens.length<=20&&
  data.itens.every(x=>typeof x==='string'&&x.length>0&&x.length<=200);
const stamp=(value)=>Number.isFinite(value)
  ?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))
  :'Não disponível';

function render(result){
  if(result.value){
    items.replaceChildren(...result.value.itens.map(value=>{
      const node=document.createElement('div');
      node.textContent=value;
      return node;
    }));
    if(result._meta?.reason==='cooldown') status.textContent='Aguardando nova tentativa • Cache preservado';
    else if(result.stale) status.textContent='Modo offline • Último conteúdo válido salvo';
    else if(result.source==='cache') status.textContent='Conteúdo local • Atualização a cada 3 horas';
    else status.textContent='Consulta concluída • Dados informativos de demonstração';
  }else{
    items.textContent='Conteúdo indisponível • Sem cache válido';
    status.textContent='Aguardando conexão';
  }
  const meta=result._meta??{};
  diagnostics.textContent=[
    'Fonte: '+(result.source==='network'?'rede':result.source==='cache'?'cache local':'indisponível'),
    'Cache: '+(result.stale?'desatualizado/sem confirmação':'válido'),
    'Relógio: '+(meta.clockPlausible?'plausível':'desajustado ou sem sincronização'),
    'Última consulta válida: '+stamp(meta.lastServerCheckAt),
    ...(meta.lastError?['Último erro: '+meta.lastError]:[]),
    ...(meta.reason==='cooldown'?['Proteção de nova tentativa: 5 minutos']:[])
  ].join(' • ');
}
async function update(){
  if(inFlight)return;
  inFlight=true;
  try{
    render(await fetchCachedJson('./informativo-demo.json',{
      cacheKey:'vision-informativo-demo-v2',
      validate:validDemo
    }));
  }catch(e){
    status.textContent='Falha inesperada ao carregar o conteúdo';
    diagnostics.textContent=String(e?.message||e);
  }finally{inFlight=false;}
}
update();
setInterval(update,60000);
window.addEventListener('online',update);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)update()});
