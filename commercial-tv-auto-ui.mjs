// Offline browser controls: timers emulate COMPLETED media, never real player callbacks.
// Entire state is scoped to this page. A browser reload resets the lab; no persistence.
import {createAutoBench,autoBenchView,advanceAutoBench} from './commercial-tv-auto-state.mjs';

if(typeof document!=='undefined'&&document.getElementById('auto-bench-form')){
 const $=id=>document.getElementById(id), form=$('auto-bench-form');
 let state=createAutoBench({baseCount:6,adCount:5}),auto=false,timer=null;
 const clearTick=()=>{if(timer!==null){clearTimeout(timer);timer=null}};
 const options=()=>{
  const value=name=>form.elements.namedItem(name);
  return {
   baseCount:Number(value('baseCount').value),
   adCount:Number(value('adCount').value),
   shuffle:value('shuffle').checked,
   single:value('single').checked,
   scheduled:value('scheduled').checked,
   enabled:value('enabled').checked
  };
 };
 const setAuto=next=>{
  auto=next;
  clearTick();
  render();
 };
 const move=event=>{
  clearTick();
  const result=advanceAutoBench(state,event);
  state=result.state;
  render();
 };
 const runCompletion=()=>{
  const current=autoBenchView(state);
  if(!current.current||!current.connected)return;
  move({type:'complete',token:current.token});
 };
 const schedule=()=>{
  clearTick();
  const view=autoBenchView(state);
  if(!auto||!view.connected||!view.current||document.hidden)return;
  // This timeout is only a laboratory approximation of a media-completed event.
  // The token is captured before scheduling and rejected if refresh/reconnect intervenes.
  const expected=view.token;
  timer=setTimeout(()=>{
   timer=null;
   const result=advanceAutoBench(state,{type:'complete',token:expected});
   state=result.state;
   if(!result.accepted){setAuto(false);return;}
   render();
  },1600);
 };
 function render(){
  const view=autoBenchView(state);
  $('auto-status').textContent=view.status;
  $('auto-round').textContent='Rodada '+(view.cycle+1)+' · item '+(view.items.length?view.position+1:0)+' de '+view.items.length;
  $('auto-current').textContent=view.current?
   (view.current.commercial?'Anúncio comercial: ':'Mídia do estabelecimento: ')+view.current.media.name
   :'Aguardando playlist (nenhuma mídia ativa)';
  $('auto-health').textContent=state.connected?'Conexão simulada: ativa':'Conexão simulada: interrompida';
  $('auto-message').textContent=state.lastAction;
  $('auto-metrics').textContent='Rodadas concluídas: '+state.completedCycles+
   ' · Fins de mídia simulados: '+state.completedItems+
   ' · Comerciais nesta rodada: '+view.included+
   ' · Aguardando rodízio: '+view.ignored;
  $('auto-mode').textContent=auto?'Pausar avanço automático':'Iniciar avanço automático';
  $('auto-mode').disabled=!view.current||!view.connected;
  $('auto-complete').disabled=!view.current||!view.connected;
  $('auto-disconnect').disabled=!view.connected;
  $('auto-reconnect').disabled=view.connected;
  const list=$('auto-sequence');list.replaceChildren();
  if(!view.items.length){
   const empty=document.createElement('div');
   empty.className='auto-empty';
   empty.textContent='Aguardando playlist — nenhuma publicidade é inserida.';
   list.append(empty);
  }
  view.items.forEach((item,i)=>{
   const card=document.createElement('div');
   card.className='auto-item'+(item.commercial?' auto-ad':'')+(i===view.position?' auto-current':'');
   const number=document.createElement('span');
   number.textContent=String(i+1).padStart(2,'0')+(i===view.position?' · AGORA':'');
   const label=document.createElement('small');
   label.textContent=item.commercial?'ANÚNCIO COMERCIAL (FICTÍCIO)':'MÍDIA DO ESTABELECIMENTO';
   const name=document.createElement('strong');name.textContent=item.media.name;
   card.append(number,label,name);
   list.append(card);
  });
  schedule();
 }
 $('auto-mode').addEventListener('click',()=>setAuto(!auto));
 $('auto-complete').addEventListener('click',()=>runCompletion());
 $('auto-refresh').addEventListener('click',()=>move({type:'refresh'}));
 $('auto-disconnect').addEventListener('click',()=>{auto=false;move({type:'disconnect'})});
 $('auto-reconnect').addEventListener('click',()=>move({type:'reconnect'}));
 $('auto-restart').addEventListener('click',()=>{auto=false;move({type:'restart'})});
 $('auto-compatible').addEventListener('click',()=>{
  clearTick();auto=false;
  for(const name of ['shuffle','single','scheduled'])form.elements.namedItem(name).checked=false;
  form.elements.namedItem('enabled').checked=true;
  move({type:'configure',options:options()});
 });
 form.addEventListener('change',()=>{
  auto=false;move({type:'configure',options:options()});
 });
 document.addEventListener('visibilitychange',()=>{
  clearTick();
  // Avoid automated progression while the page is in the background.
  if(document.hidden)auto=false;
  render();
 });
 render();
}
