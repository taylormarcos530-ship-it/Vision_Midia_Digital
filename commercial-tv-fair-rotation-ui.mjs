// OFFLINE LAB ONLY. UI visualises fictitious completed-item events, not real impressions.
// In-memory fixtures only. No external connections, persistence or device access.
import {createFairRotationLab,fairRotationView,fairRotationEvent} from './commercial-tv-fair-rotation-lab.mjs';

export const advertiserFixtures=Object.freeze([
 {id:'ad-1',name:'Loja do João'},
 {id:'ad-2',name:'Empresa B'},
 {id:'ad-3',name:'Publicidade C'},
 {id:'ad-4',name:'Publicidade D'},
 {id:'ad-5',name:'Publicidade E'}
]);
const baseNames=['Troca de óleo','Suspensão','Escapamento','Freios','Motor','Revisão'];
export function labPrimary(count=6){
 if(count===0)return null;
 if(![1,3,6].includes(count))throw new Error('invalid_lab_playlist_size');
 return {playlist:{id:'lab-auto-center',shuffle:false,repeat_mode:'all'},
  items:baseNames.slice(0,count).map((name,index)=>({
   id:'point-'+(index+1),schedule:{enabled:false},
   media:{id:'point-media-'+(index+1),name:'Auto Center · '+name}
  }))};
}
export function labAds(activeIds=advertiserFixtures.map(ad=>ad.id)){
 const ids=new Set(activeIds);
 return advertiserFixtures.filter(ad=>ids.has(ad.id)).map(ad=>({
  id:ad.id,media:{id:'fictional-revision-'+ad.id,name:ad.name},
  schedule:{enabled:true},commercial:true
 }));
}
export function makeLab(count=6,activeIds=advertiserFixtures.map(ad=>ad.id)){
 return createFairRotationLab(labPrimary(count),labAds(activeIds));
}
export function labDashboard(state,activeIds=advertiserFixtures.map(ad=>ad.id)){
 const v=fairRotationView(state),active=new Set(activeIds),selected=new Set(v.selected);
 const queue=state.primary?advertiserFixtures.filter(ad=>active.has(ad.id)&&!selected.has(ad.id)).map(ad=>ad.name):[];
 return {...v,queue,hasPending:state.pending!==null,
  currentLabel:v.current?.media?.name||'Aguardando playlist',
  currentIsAd:Boolean(v.current?.commercial),
  advertisingActive:!state.blocked&&v.selected.length>0,
  advertisers:advertiserFixtures.map(ad=>({
   ...ad,active:active.has(ad.id),selected:selected.has(ad.id),
   plays:v.played[ad.id]||0,awaiting:active.has(ad.id)&&!selected.has(ad.id)
  }))
 };
}
export function completeLabCycles(state,requested=1){
 if(!Number.isSafeInteger(requested)||requested<1||requested>10)
  return {state,accepted:false,reason:'invalid_cycle_count'};
 let working=state;
 if(!working.running){
  const result=fairRotationEvent(working,{type:'start'});
  if(!result.accepted)return result;
  working=result.state;
 }
 const end=working.cycle+requested;
 if(!Number.isSafeInteger(end))return {state,accepted:false,reason:'simulation_limit'};
 let steps=0;
 while(working.cycle<end&&steps<requested*12){
  const view=fairRotationView(working);
  const result=fairRotationEvent(working,{type:'complete',token:view.token});
  if(!result.accepted)return result;
  working=result.state;steps++;
 }
 if(working.cycle!==end)return {state:working,accepted:false,reason:'simulation_guard_reached'};
 return {state:working,accepted:true,reason:requested+' rodadas fictícias concluídas: apenas contadores locais.'};
}
function onBrowserLab(){
 const root=document.getElementById('fair-lab');
 if(!root)return;
 const $=id=>document.getElementById(id);
 let baseCount=6,activeIds=new Set(advertiserFixtures.map(a=>a.id));
 let state=makeLab(baseCount,[...activeIds]),notice='Bancada pronta. Use Iniciar ou Simular 5 rodadas.';
 const controls={
  start:$('fair-start'),pause:$('fair-pause'),finish:$('fair-finish'),
  cycle:$('fair-cycle'),five:$('fair-five'),disconnect:$('fair-disconnect'),
  reconnect:$('fair-reconnect'),restart:$('fair-restart'),error:$('fair-error'),
  revalidate:$('fair-revalidate'),reset:$('fair-reset')
 };
 const slots=$('fair-sequence'),tbody=$('fair-advertisers'),list=$('fair-toggles');
 const update=(result)=>{
  state=result.state;
  notice=result.accepted?(result.reason||'Operação fictícia concluída.'):'Operação indisponível: '+result.reason;
  render();
 };
 const action=(event)=>update(fairRotationEvent(state,event));
 function renderToggles(){
  list.replaceChildren();
  for(const ad of advertiserFixtures){
   const label=document.createElement('label');label.className='fair-toggle';
   const input=document.createElement('input');
   input.type='checkbox';input.value=ad.id;input.checked=activeIds.has(ad.id);
   input.setAttribute('aria-label','Ativar '+ad.name+' somente na simulação');
   input.addEventListener('change',()=>{
    if(input.checked)activeIds.add(ad.id);else activeIds.delete(ad.id);
    update(fairRotationEvent(state,{type:'inventory-changed',ads:labAds([...activeIds])}));
   });
   const text=document.createElement('span');text.textContent=ad.name;
   label.append(input,text);list.append(label);
  }
 }
 function render(){
  const v=labDashboard(state,[...activeIds]);
  $('fair-round').textContent=String(v.cycle+1);
  $('fair-position').textContent=v.current?(v.position+1)+' / '+v.items.length:'0 / 0';
  $('fair-base-count').textContent=String(v.completedBase);
  $('fair-ad-count').textContent=String(v.completedAds);
  $('fair-failures').textContent=String(v.failures);
  $('fair-current').textContent=v.currentLabel;
  $('fair-current-type').textContent=!v.current?'Sem playlist':v.currentIsAd?'Anúncio fictício':'Mídia do estabelecimento';
  $('fair-state').textContent=v.blocked?'Comerciais bloqueados':!v.connected?'Desconectado (fictício)':v.running?'Executando eventos fictícios':'Pausado';
  $('fair-state').dataset.kind=v.blocked?'blocked':v.running?'running':'paused';
  $('fair-notice').textContent=notice;
  $('fair-queue').textContent=v.hasPending?
   'Alteração pendente: os anúncios ficam suspensos até terminar esta rodada.':
   v.blocked?'Inserções comerciais desativadas até revalidação.':
   v.queue.length?'Aguardando vagas nas próximas rodadas: '+v.queue.join(', ')+'.':
   'Nenhum anunciante elegível aguardando nesta rodada.';
  $('fair-guard').textContent=!state.primary?'TV fictícia sem playlist: nenhuma campanha é inserida.':
   state.blocked?'Falha comercial: playlist do estabelecimento preservada.':
   v.hasPending?'Inventário alterado: só mídias do estabelecimento até a próxima rodada.':
   'As mídias do estabelecimento mantêm a ordem; anúncios entram após até 3 mídias.';
  slots.replaceChildren();
  if(!v.items.length){
   const li=document.createElement('li');li.textContent='Aguardando playlist';slots.append(li);
  }
  v.items.forEach((item,index)=>{
   const li=document.createElement('li');li.className='fair-item'+(item.commercial?' commercial':'')+(index===v.position?' current':'');
   const small=document.createElement('small');small.textContent=(index+1)+' · '+(item.commercial?'ANÚNCIO FICTÍCIO':'ESTABELECIMENTO');
   const strong=document.createElement('strong');strong.textContent=item.media.name;
   li.append(small,strong);slots.append(li);
  });
  tbody.replaceChildren();
  for(const ad of v.advertisers){
   const tr=document.createElement('tr');
   for(const value of [ad.name,ad.active?(ad.selected?'Nesta rodada':ad.awaiting?'Aguardando':'Ativo'):'Desativado',String(ad.plays)]){
    const td=document.createElement('td');td.textContent=value;tr.append(td);
   }
   if(!ad.active)tr.className='fair-disabled';
   tbody.append(tr);
  }
  controls.start.disabled=v.running||!v.connected||!v.current;
  controls.pause.disabled=!v.running;
  controls.finish.disabled=!v.running||!v.connected||!v.current;
  controls.cycle.disabled=!v.connected||!v.current;
  controls.five.disabled=!v.connected||!v.current;
  controls.disconnect.disabled=!v.connected;
  controls.reconnect.disabled=v.connected;
  controls.error.disabled=!v.running||!v.current;
  controls.revalidate.disabled=!v.blocked;
  renderToggles();
 }
 controls.start.addEventListener('click',()=>action({type:'start'}));
 controls.pause.addEventListener('click',()=>action({type:'pause'}));
 controls.finish.addEventListener('click',()=>action({type:'complete',token:fairRotationView(state).token}));
 controls.cycle.addEventListener('click',()=>update(completeLabCycles(state,1)));
 controls.five.addEventListener('click',()=>update(completeLabCycles(state,5)));
 controls.disconnect.addEventListener('click',()=>action({type:'disconnect'}));
 controls.reconnect.addEventListener('click',()=>action({type:'reconnect'}));
 controls.restart.addEventListener('click',()=>action({type:'restart'}));
 controls.error.addEventListener('click',()=>action({type:'media-error',token:fairRotationView(state).token}));
 controls.revalidate.addEventListener('click',()=>{
  // Explicitly reload selected fictitious inventory before clearing the error gate.
  // New ads still wait for the next completed cycle.
  const staged=fairRotationEvent(state,{type:'inventory-changed',ads:labAds([...activeIds])});
  if(!staged.accepted){update(staged);return;}
  const result=fairRotationEvent(staged.state,{type:'revalidate'});
  update({...result,reason:result.accepted?
   'Anunciantes fictícios revalidados; anúncios só retornam na próxima rodada.':result.reason});
 });
 controls.reset.addEventListener('click',()=>{
  state=makeLab(baseCount,[...activeIds]);
  notice='Bancada reiniciada apenas em memória. Nenhum sistema foi alterado.';
  render();
 });
 $('fair-base-select').addEventListener('change',event=>{
  baseCount=Number(event.target.value);
  state=makeLab(baseCount,[...activeIds]);notice='Playlist fictícia alterada: contadores da bancada zerados.';render();
 });
 render();
}
if(typeof document!=='undefined')onBrowserLab();
