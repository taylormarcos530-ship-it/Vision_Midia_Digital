// Media laboratory uses local file Object URLs only. No uploads or server calls.
import {createMediaTestPlayer,mediaTestView,mediaTestEvent} from './commercial-tv-media-controller.mjs';
if(typeof document!=='undefined'&&document.getElementById('media-lab')){
 const $=id=>document.getElementById(id);
 const screen=$('media-screen'),video=$('media-video'),photo=$('media-photo');
 const baseFile=$('media-base-file'),commercialFile=$('media-commercial-file');
 let player=createMediaTestPlayer(),clock=null,objects={base:null,commercial:null};
 let reconnectTimer=null,rebootTimer=null,rebooting=false,resumeAfterRecovery=false;
 const clearReconnect=()=>{if(reconnectTimer!==null){clearTimeout(reconnectTimer);reconnectTimer=null;}};
 const clearReboot=()=>{if(rebootTimer!==null){clearTimeout(rebootTimer);rebootTimer=null;}};
 const stopClock=()=>{if(clock!==null){clearTimeout(clock);clock=null;}};
 const stopMedia=()=>{
  stopClock();
  video.pause();video.onended=null;video.onerror=null;
  photo.onload=null;photo.onerror=null;
  video.removeAttribute('src');video.load();photo.removeAttribute('src');
  photo.hidden=true;video.hidden=true;
 };
 function safeFile(file){
  if(!file)return null;
  // No SVG or HTML, only browser-native raster formats and videos.
  if(file.size<=0||file.size>100*1024*1024)return null;
  if(!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/.test(file.type))return null;
  return file;
 }
 function output(message){
  $('media-notice').textContent=message;
 }
 function clearPreview(role){
  const name=role==='base'?'base':'commercial';
  const pic=$('media-'+name+'-thumb-image');
  const vid=$('media-'+name+'-thumb-video');
  vid.pause();vid.removeAttribute('src');vid.load();
  pic.removeAttribute('src');
  pic.hidden=true;vid.hidden=true;
 }
 function updatePreview(role){
  const item=objects[role],name=role==='base'?'base':'commercial';
  clearPreview(role);
  $('media-'+name+'-loaded').textContent=item?
   (item.type==='video'?'VÍDEO':'IMAGEM')+' carregado ✓ · '+item.name:
   'Nenhum arquivo carregado; será mostrado um quadro fictício.';
  if(!item)return;
  if(item.type==='video'){
   const v=$('media-'+name+'-thumb-video');
   v.src=item.url;v.hidden=false;
  }else{
   const img=$('media-'+name+'-thumb-image');
   img.src=item.url;img.hidden=false;
  }
 }
 function reconnectNow(){
  if(rebooting)return;
  if(player.state.connected){
   output('Conexão fictícia já ativa. A reprodução não foi reiniciada.');
   return;
  }
  clearReconnect();
  const shouldResume=resumeAfterRecovery;
  resumeAfterRecovery=false;
  if(apply({type:'reconnect',resume:shouldResume}))
   output(shouldResume?'Reconectado automaticamente: reprodução retomada na mesma rodada e mídia.':
    'Reconectado: rodada e mídia preservadas. Toque em Iniciar para continuar.');
 }
 function beginDisconnect(){
  if(rebooting||!player.state.connected)return;
  clearReconnect();clearReboot();
  resumeAfterRecovery=mediaTestView(player).playing;
  if(!apply({type:'disconnect'}))return;
  output('SEM CONEXÃO: aguarde 3 segundos para reconexão automática ou toque em Reconectar agora.');
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;reconnectNow()},3000);
 }
 function beginRestart(){
  if(rebooting)return;
  clearReconnect();clearReboot();
  const shouldResume=mediaTestView(player).playing||resumeAfterRecovery;
  resumeAfterRecovery=false;
  stopMedia();
  if(player.playing)player=mediaTestEvent(player,{type:'pause'}).player;
  rebooting=true;render();
  output('REINICIANDO: aguarde 2 segundos; o mesmo item será recuperado.');
  rebootTimer=setTimeout(()=>{
   rebootTimer=null;
   const restarted=mediaTestEvent(player,{type:'restart',resume:shouldResume&&player.state.connected});
   player=restarted.player;
   if(!player.state.connected){
    const reconnected=mediaTestEvent(player,{type:'reconnect',resume:shouldResume});
    player=reconnected.player;
   }
   rebooting=false;
   render();
   output(player.playing?'Reinício simulado concluído: reprodução retomada no mesmo item.':
    'Reinício simulado concluído: posição preservada; toque em Iniciar.');
  },2000);
 }
 function apply(event){
  const result=mediaTestEvent(player,event);
  if(!result.accepted){output(result.message||'Operação indisponível.');return false;}
  stopMedia();player=result.player;render();return true;
 }
 function onFinish(key){
  if(!mediaTestView(player).playing)return;
  apply({type:'ended',key});
 }
 function beginItem(view){
  const key=view.key;
  const role=view.current.commercial?'commercial':'base';
  const item=objects[role];
  if(!item){
   $('media-placeholder').hidden=false;
   clock=setTimeout(()=>{clock=null;onFinish(key)},2000);
   return;
  }
  $('media-placeholder').hidden=true;
  if(item.type==='video'){
   video.hidden=false;video.muted=true;video.playsInline=true;video.loop=false;
   video.onended=()=>onFinish(key);
   video.onerror=()=>apply({type:'media-error',key});
   video.src=item.url;
   const promise=video.play();
   if(promise?.catch)promise.catch(()=>{if(mediaTestView(player).key===key){
    stopMedia();player=mediaTestEvent(player,{type:'pause'}).player;
    render();output('Vídeo impedido pelo navegador. Toque em Iniciar novamente.');
   }});
  }else{
   photo.hidden=false;
   photo.onerror=()=>apply({type:'media-error',key});
   photo.onload=()=>{
    if(mediaTestView(player).key===key)
     clock=setTimeout(()=>{clock=null;onFinish(key)},2500);
   };
   // Attach handlers before src: cached images can load very quickly on Android.
   photo.src=item.url;
  }
 }
 function render(){
  const view=mediaTestView(player),item=view.current;
  $('media-status').textContent=rebooting?
   'REINICIANDO: recuperando a mesma rodada e a mídia atual…':
   !view.connected?'SEM CONEXÃO: programação local pausada.':view.message;
  $('media-round').textContent='Rodada '+(view.cycle+1)+' · item '+(item?view.position+1:0)+' de '+view.items.length;
  $('media-count').textContent='Itens concluídos neste teste: '+player.state.completedItems+
   ' · Comerciais nesta rodada: '+view.included+' · Falhas: '+view.failures;
  $('media-current').textContent=item?(item.commercial?'Publicidade comercial fictícia':'Mídia do Auto Center fictício')+' — '+item.media.name:
   'Aguardando playlist';
  $('media-placeholder').textContent=rebooting?'REINICIANDO…':
   item?item.media.name:'AGUARDANDO PLAYLIST';
  $('media-placeholder').hidden=false;
  $('media-live').textContent=rebooting?'REINICIANDO':!view.connected?'SEM CONEXÃO':
   view.playing?'EXECUTANDO':'PAUSADO';
  $('media-live').dataset.playing=String(view.playing&&!rebooting);
  $('media-start').disabled=rebooting||view.playing||!item||!view.connected;
  $('media-pause').disabled=rebooting||!view.playing;
  $('media-disconnect').disabled=rebooting||!view.connected;
  $('media-reconnect').disabled=rebooting;
  $('media-reconnect').textContent=rebooting?'Aguarde…':view.connected?'Verificar conexão ✓':'Reconectar agora';
  $('media-restart').disabled=rebooting;
  $('media-base-file').disabled=rebooting;
  $('media-commercial-file').disabled=rebooting;
  $('media-no-playlist').disabled=rebooting;
  $('media-restore-playlist').disabled=rebooting;
  const firstAd=view.items.findIndex(x=>x.commercial);
  $('media-order-hint').textContent=firstAd<0?
   'Nenhum anúncio comercial nesta rodada.':('O anúncio comercial aparece no item '+(firstAd+1)+
   ' de '+view.items.length+'. Os arquivos são exibidos por categoria, não na ordem do envio.');
  $('media-file-count').textContent='Arquivos escolhidos: '+
   Number(Boolean(objects.base))+ ' mídia do estabelecimento · '+
   Number(Boolean(objects.commercial))+' comercial';
  if(view.playing&&item&&!rebooting)beginItem(view);
 }
 function loadLocal(role,file){
  if(rebooting)return;
  clearReconnect();clearReboot();resumeAfterRecovery=false;
  stopMedia();clearPreview(role);
  const old=objects[role];if(old)URL.revokeObjectURL(old.url);
  const valid=safeFile(file);
  objects[role]=valid?{type:valid.type.startsWith('video/')?'video':'image',
   url:URL.createObjectURL(valid),name:String(valid.name||'Arquivo local').slice(0,120)}:null;
  player=mediaTestEvent(player,{type:'configure',options:{...player.state.options,
   programRevision:'local-'+Date.now()}}).player;
  updatePreview(role);render();
  output(file&&!valid?'Arquivo não aceito. Use PNG, JPEG, WEBP, GIF, MP4 ou WEBM com até 100 MB.':
   valid?'Arquivo local carregado ✓. Os dois arquivos serão usados nos respectivos itens da sequência.':
   'Sem arquivo selecionado: exibindo quadros fictícios.');
 }
 baseFile.addEventListener('change',()=>loadLocal('base',baseFile.files?.[0]));
 commercialFile.addEventListener('change',()=>loadLocal('commercial',commercialFile.files?.[0]));
 $('media-start').addEventListener('click',()=>{if(rebooting)return;clearReconnect();resumeAfterRecovery=false;apply({type:'start'});});
 $('media-pause').addEventListener('click',()=>{if(rebooting)return;clearReconnect();resumeAfterRecovery=false;apply({type:'pause'});});
 $('media-disconnect').addEventListener('click',beginDisconnect);
 $('media-reconnect').addEventListener('click',reconnectNow);
 $('media-restart').addEventListener('click',beginRestart);
 $('media-no-playlist').addEventListener('click',()=>{
  if(rebooting)return;clearReconnect();resumeAfterRecovery=false;
  apply({type:'configure',options:{...player.state.options,baseCount:0}});
 });
 $('media-restore-playlist').addEventListener('click',()=>{
  if(rebooting)return;clearReconnect();resumeAfterRecovery=false;
  apply({type:'configure',options:{...player.state.options,baseCount:6}});
 });
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
   clearReconnect();clearReboot();resumeAfterRecovery=false;
   rebooting=false;
   if(player.playing)apply({type:'pause'});
   else render();
   output('Página oculta: simulação pausada. Retome manualmente quando voltar.');
  }
 });
 window.addEventListener('pagehide',()=>{
  clearReconnect();clearReboot();stopMedia();
  for(const role of ['base','commercial']){
   clearPreview(role);
   if(objects[role])URL.revokeObjectURL(objects[role].url);
  }
  objects={base:null,commercial:null};
 });
 render();
}
