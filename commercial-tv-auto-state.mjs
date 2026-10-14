// OFFLINE-ONLY harness. Models completion callbacks and checkpoints, not a real TV.
// No persistence, networking, database, APK, device gateway or player integration.
import {simulateBench,benchDefaults} from './commercial-tv-bench.mjs';

export function autoBenchOptions(input={}){
 const count=(value,fallback,max)=>{
  const n=Number(value);
  return Number.isInteger(n)&&n>=0&&n<=max?n:fallback;
 };
 return {
  baseCount:count(input.baseCount,benchDefaults.baseCount,6),
  adCount:count(input.adCount,benchDefaults.adCount,5),
  shuffle:input.shuffle===true,
  single:input.single===true,
  scheduled:input.scheduled===true,
  enabled:input.enabled!==false
 };
}

export function createAutoBench(input={}){
 return {version:1,options:autoBenchOptions(input),cycle:0,position:0,generation:0,
  connected:true,completedItems:0,completedCycles:0,lastAction:'Bancada iniciada. Nenhum evento real registrado.'};
}

export function autoBenchView(state){
 const result=simulateBench({...state.options,cycle:state.cycle});
 const current=result.items[state.position]||null;
 return {...result,current,
  token:current?`${state.generation}:${state.cycle}:${state.position}:${current.id}`:null,
  remaining:Math.max(0,result.items.length-state.position-1),
  connected:state.connected,
  position:state.position,
  completedCycles:state.completedCycles,
  completedItems:state.completedItems,
  lastAction:state.lastAction
 };
}

function transition(state,patch,accepted,reason){
 return {state:{...state,...patch,lastAction:reason},accepted,reason};
}
export function advanceAutoBench(state,event){
 if(!state||state.version!==1||!event||typeof event.type!=='string')
  throw new Error('invalid_offline_bench_event');
 const view=autoBenchView(state);
 if(event.type==='complete'){
  if(!state.connected)return transition(state,{},false,'Sem conexão fictícia; conclusão ignorada.');
  if(!view.current)return transition(state,{},false,'Aguardando playlist; nada para concluir.');
  if(event.token!==view.token)return transition(state,{},false,'Evento repetido ou antigo ignorado.');
  if(!Number.isSafeInteger(state.completedItems+1)||!Number.isSafeInteger(state.cycle+1))
   return transition(state,{},false,'Limite da simulação; reinicie a bancada.');
  const final=state.position===view.items.length-1;
  return transition(state,{
   position:final?0:state.position+1,
   cycle:final?state.cycle+1:state.cycle,
   generation:state.generation+(final?1:0),
   completedItems:state.completedItems+1,
   completedCycles:state.completedCycles+(final?1:0)
  },true,final?'Rodada fictícia concluída; próximo rodízio preparado.':'Fim de mídia simulado; próximo item preparado.');
 }
 if(event.type==='disconnect'){
  if(!state.connected)return transition(state,{},false,'Conexão fictícia já interrompida.');
  return transition(state,{connected:false,generation:state.generation+1},true,'Conexão fictícia interrompida. Rodada e posição preservadas.');
 }
 if(event.type==='reconnect'){
  if(state.connected)return transition(state,{},false,'Bancada já conectada.');
  return transition(state,{connected:true,generation:state.generation+1},true,'Reconexão fictícia: mesma mídia e rodada, sem avanço.');
 }
 if(event.type==='refresh'){
  return transition(state,{generation:state.generation+1},true,'Programação fictícia atualizada: posição e rodada mantidas.');
 }
 if(event.type==='restart'){
  const checkpoint=JSON.parse(JSON.stringify(state));
  return restoreAutoBench(checkpoint);
 }
 if(event.type==='configure'){
  const options=autoBenchOptions(event.options);
  return transition(state,{options,position:0,generation:state.generation+1},true,
   'Alterada somente a configuração fictícia; rodada preservada e sequência reiniciada.');
 }
 return transition(state,{},false,'Evento desconhecido ignorado.');
}

export function restoreAutoBench(checkpoint){
 // Models explicit checkpoint handoff. No guarantee across real device or browser restarts.
 if(!checkpoint||checkpoint.version!==1||
    !checkpoint.options||typeof checkpoint.options!=='object'||
    !Number.isSafeInteger(checkpoint.cycle)||checkpoint.cycle<0||
    !Number.isSafeInteger(checkpoint.position)||checkpoint.position<0||
    !Number.isSafeInteger(checkpoint.generation)||checkpoint.generation<0||
    !Number.isSafeInteger(checkpoint.completedItems)||checkpoint.completedItems<0||
    !Number.isSafeInteger(checkpoint.completedCycles)||checkpoint.completedCycles<0||
    typeof checkpoint.connected!=='boolean')
  return transition(createAutoBench({enabled:false}),{},false,'Checkpoint inválido: somente playlist original liberada.');
 const restored={...checkpoint,options:autoBenchOptions(checkpoint.options)};
 if(restored.position>=autoBenchView({...restored,position:0}).items.length)
  return transition(createAutoBench({enabled:false}),{},false,'Checkpoint fora da playlist: anúncios desativados.');
 return transition(restored,{generation:restored.generation+1},true,
  'Reinício simulado: posição e rodada recuperadas; eventos antigos invalidados.');
}
