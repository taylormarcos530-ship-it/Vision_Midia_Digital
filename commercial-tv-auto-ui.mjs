// Offline browser controls: timers emulate COMPLETED media, never real player callbacks.
// Entire state is scoped to this page. A browser reload resets the lab; no persistence.
import {createAutoBench,autoBenchView,advanceAutoBench} from './commercial-tv-auto-state.mjs';

if(typeof document!=='undefined'&&document.getElementById('auto-bench-form')){
 const $=id=>document.getElementById(id), form=$('auto-bench-form');
 let state=createAutoBench({baseCount:6,adCount:5}),auto=false,timer=null;
 let reconnectTimer=null,rebootTimer=null,rebooting=false,resumeAfterRecovery=false;
 const clearTick=()=>{if(timer!==null){clearTimeout(timer);timer=null}};
 const clearRecovery=()=>{if(reconnectTimer!==null){clearTimeout(reconnectTimer);reconnectTimer=null}};
 const clearReboot=()=>{if(rebootTimer!==null){clearTimeout(rebootTimer);rebootTimer=null}};
 const resumeConnection=()=>{
  if(rebooting||state.connected)return;
  clearRecovery();
  const result=advanceAutoBench(state,{type:'reconnect'});
  state=result.state;
  auto=resumeAfterRecovery;
  resumeAfterRecovery=false;
  render();
 };
 const beginDisconnect=()=>{
  if(rebooting||!state.connected)return;
  resumeAfterRecovery=auto;
  auto=false;
  clearTick();clearRecovery();
  state=advanceAutoBench(state,{type:'disconnect'}).state;
  render();
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;resumeConnection()},3000);
 };
 const beginRestart=()=>{
  if(rebooting)return;
  resumeAfterRecovery=auto||resumeAfterRecovery;
  auto=false;
  clearTick();clearRecovery();clearReboot();
  rebooting=true;
  render();
  rebootTimer=setTimeout(()=>{
   rebootTimer=null;
   const restored=advanceAutoBench(state,{type:'restart'});
   state=restored.state;
   if(restored.accepted&&!state.connected)
    state=advanceAutoBench(state,{type:'reconnect'}).state;
   rebooting=false;
   auto=restored.accepted&&state.connected&&resumeAfterRecovery;
   resumeAfterRecovery=false;
   state={...state,lastAction:restored.accepted?
    'Reinício simulado concluído. Rodada e item recuperados; '+(auto?'avanço automático retomado.':'pronto para continuar.') :
    'Não foi possível recuperar a programação. Anúncios desativados.'};
   render();
  },2000);
 };
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
  if(!auto||!view.connected||!view.current||document.hidden||rebooting)return;
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
  $('auto-status').textContent=rebooting?'Reiniciando o player fictício…':
   !state.connected?'Simulação pausada — sem conexão':view.status;
  $('auto-round').textContent='Rodada '+(view.cycle+1)+' · item '+(view.items.length?view.position+1:0)+' de '+view.items.length;
  const name=view.current?
   (view.current.commercial?'Anúncio comercial: ':'Mídia do estabelecimento: ')+view.current.media.name
   :'Aguardando playlist (nenhuma mídia ativa)';
  $('auto-current').textContent=rebooting?'Recuperando checkpoint da memória desta página…':
   !state.connected?'Pausado em: '+name:name;
  $('auto-health').textContent=rebooting?'Estado da simulação: REINICIANDO':
   state.connected?'Conexão simulada: ativa':
   'Conexão fictícia interrompida. Reconexão automática em cerca de 3 segundos.';
  $('auto-message').textContent=rebooting?
   'Simulando reinício por 2 segundos; a rodada e o item serão preservados.':
   !state.connected?'A reprodução fictícia está pausada. Aguarde a reconexão automática ou toque em Reconectar.':
   state.lastAction;
  $('auto-metrics').textContent='Rodadas concluídas: '+state.completedCycles+
   ' · Fins de mídia simulados: '+state.completedItems+
   ' · Comerciais nesta rodada: '+view.included+
   ' · Aguardando rodízio: '+view.ignored;
  $('auto-mode').textContent=auto?'Pausar avanço automático':'Iniciar avanço automático';
  $('auto-mode').disabled=rebooting||!view.current||!view.connected;
  $('auto-complete').disabled=rebooting||!view.current||!view.connected;
  $('auto-disconnect').disabled=rebooting||!view.connected;
  $('auto-reconnect').disabled=rebooting||view.connected;
  $('auto-refresh').disabled=rebooting;
  $('auto-restart').disabled=rebooting;
  $('auto-compatible').disabled=rebooting;
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
 $('auto-disconnect').addEventListener('click',beginDisconnect);
 $('auto-reconnect').addEventListener('click',resumeConnection);
 $('auto-restart').addEventListener('click',beginRestart);
 $('auto-compatible').addEventListener('click',()=>{
  clearTick();clearRecovery();clearReboot();rebooting=false;auto=false;resumeAfterRecovery=false;
  for(const name of ['shuffle','single','scheduled'])form.elements.namedItem(name).checked=false;
  form.elements.namedItem('enabled').checked=true;
  move({type:'configure',options:options()});
 });
 form.addEventListener('change',()=>{
  if(rebooting)return;
  auto=false;resumeAfterRecovery=false;
  clearRecovery();
  move({type:'configure',options:options()});
  if(!state.connected)reconnectTimer=setTimeout(()=>{reconnectTimer=null;resumeConnection()},3000);
 });
 document.addEventListener('visibilitychange',()=>{
  clearTick();
  // Never advance simulations silently in a hidden browser tab.
  if(document.hidden){
   auto=false;
   resumeAfterRecovery=false;
   clearRecovery();
   clearReboot();
   if(rebooting){
    rebooting=false;
    state={...state,lastAction:'Reinício simulado interrompido ao ocultar a página.'};
   }
  }
  render();
 });
 render();
}
