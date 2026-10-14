// Isolated media-playback adapter for the staging browser laboratory.
// It never imports the production player, device gateway, network clients or Storage.
import {createAutoBench,autoBenchView,advanceAutoBench} from './commercial-tv-auto-state.mjs';

export function createMediaTestPlayer(options={baseCount:6,adCount:5}){
 return {state:createAutoBench(options),playing:false,epoch:0,lastMessage:'Pronto para iniciar mídia de testes.',failures:0};
}
export function mediaTestView(player){
 const current=autoBenchView(player.state);
 return {...current,playing:player.playing,
  key:current.token?`${player.epoch}/${current.token}`:null,
  failures:player.failures,message:player.lastMessage};
}
export function mediaTestEvent(player,event){
 if(!player||!event||typeof event.type!=='string')throw new Error('invalid_test_player_event');
 const now=mediaTestView(player);
 const done=(state,playing,message,failures=player.failures)=>({
  player:{...player,state,playing,epoch:player.epoch+1,failures,lastMessage:message},
  accepted:true
 });
 const denied=message=>({player,accepted:false,message});
 if(event.type==='start'){
  if(player.playing||!now.current||!now.connected)return denied('Nada disponível para iniciar.');
  return done(player.state,true,'Reprodução local iniciada.');
 }
 if(event.type==='pause'){
  if(!player.playing)return denied('Reprodução já pausada.');
  return done(player.state,false,'Pausado nesta mídia.');
 }
 if(event.type==='ended'){
  if(!player.playing||!now.connected||!now.current||event.key!==now.key)
   return denied('Evento antigo, repetido ou fora da reprodução ignorado.');
  const next=advanceAutoBench(player.state,{type:'complete',token:now.token});
  if(!next.accepted)return denied(next.reason);
  return done(next.state,true,'Mídia concluída na bancada. Próximo item preparado.');
 }
 if(event.type==='media-error'){
  if(!player.playing||!now.current||event.key!==now.key)
   return denied('Erro de mídia antigo ignorado.');
  // Never claim a completed impression or advance after a playback error.
  // Stop the test; if an ad failed, switch OFF all commercial insertions.
  const disable=now.current.commercial;
  const next=disable?advanceAutoBench(player.state,{
   type:'configure',options:{...player.state.options,enabled:false}
  }):advanceAutoBench(player.state,{type:'refresh'});
  return done(next.state,false,disable?
   'Falha na mídia comercial: anúncios desativados; playlist fictícia do ponto preservada.':
   'Falha na mídia do ponto: teste pausado sem contabilizar conclusão.',player.failures+1);
 }
 if(event.type==='disconnect'){
  if(!player.state.connected)return denied('Já desconectado.');
  const next=advanceAutoBench(player.state,{type:'disconnect'});
  return done(next.state,false,'Desconectado. Playback local pausado; posição preservada.');
 }
 if(event.type==='reconnect'){
  if(player.state.connected)return denied('Conexão de bancada já ativa.');
  const next=advanceAutoBench(player.state,{type:'reconnect'});
  return done(next.state,false,'Reconectado. Toque em iniciar para retomar o mesmo item.');
 }
 if(event.type==='restart'){
  const next=advanceAutoBench(player.state,{type:'restart'});
  return done(next.state,false,next.accepted?'Reinício fictício: item preservado, aguarde início manual.':
   'Checkpoint inválido. Comerciais desativados.');
 }
 if(event.type==='refresh'){
  const next=advanceAutoBench(player.state,{type:'refresh'});
  return done(next.state,false,'Manifesto fictício atualizado sem mudança de posição.');
 }
 if(event.type==='configure'){
  const options=event.options||{};
  // Force explicit restart for newly selected local-media fixtures.
  const next=createAutoBench(options);
  return done(next,false,'Configuração de testes reiniciada. Nenhum evento anterior é válido.');
 }
 return denied('Evento de teste desconhecido.');
}
