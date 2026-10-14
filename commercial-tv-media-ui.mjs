// Media laboratory uses local file Object URLs only. No uploads or server calls.
import {createMediaTestPlayer,mediaTestView,mediaTestEvent} from './commercial-tv-media-controller.mjs';
if(typeof document!=='undefined'&&document.getElementById('media-lab')){
 const $=id=>document.getElementById(id);
 const screen=$('media-screen'),video=$('media-video'),photo=$('media-photo');
 const baseFile=$('media-base-file'),commercialFile=$('media-commercial-file');
 let player=createMediaTestPlayer(),clock=null,objects={base:null,commercial:null};
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
  $('media-status').textContent=view.message;
  $('media-round').textContent='Rodada '+(view.cycle+1)+' · item '+(item?view.position+1:0)+' de '+view.items.length;
  $('media-count').textContent='Itens concluídos neste teste: '+player.state.completedItems+
   ' · Comerciais nesta rodada: '+view.included+' · Falhas: '+view.failures;
  $('media-current').textContent=item?(item.commercial?'Publicidade comercial fictícia':'Mídia do Auto Center fictício')+' — '+item.media.name:
   'Aguardando playlist';
  $('media-placeholder').textContent=item?item.media.name:'AGUARDANDO PLAYLIST';
  $('media-placeholder').hidden=false;
  $('media-live').textContent=view.playing?'EXECUTANDO':'PAUSADO';
  $('media-live').dataset.playing=String(view.playing);
  $('media-start').disabled=view.playing||!item||!view.connected;
  $('media-pause').disabled=!view.playing;
  $('media-disconnect').disabled=!view.connected;
  $('media-reconnect').disabled=view.connected;
  $('media-restart').disabled=false;
  if(view.playing&&item)beginItem(view);
 }
 function loadLocal(role,file){
  stopMedia();
  const old=objects[role];if(old)URL.revokeObjectURL(old.url);
  const valid=safeFile(file);
  objects[role]=valid?{type:valid.type.startsWith('video/')?'video':'image',url:URL.createObjectURL(valid)}:null;
  player=mediaTestEvent(player,{type:'configure',options:{...player.state.options,
   programRevision:'local-'+Date.now()}}).player;
  render();
  output(file&&!valid?'Arquivo não aceito. Use PNG, JPEG, WEBP, GIF, MP4 ou WEBM com até 100 MB.':
   valid?'Arquivo local carregado apenas na memória deste navegador; clique em Iniciar.':
   'Sem arquivo selecionado: exibindo quadros fictícios.');
 }
 baseFile.addEventListener('change',()=>loadLocal('base',baseFile.files?.[0]));
 commercialFile.addEventListener('change',()=>loadLocal('commercial',commercialFile.files?.[0]));
 $('media-start').addEventListener('click',()=>apply({type:'start'}));
 $('media-pause').addEventListener('click',()=>apply({type:'pause'}));
 $('media-disconnect').addEventListener('click',()=>apply({type:'disconnect'}));
 $('media-reconnect').addEventListener('click',()=>apply({type:'reconnect'}));
 $('media-restart').addEventListener('click',()=>apply({type:'restart'}));
 $('media-no-playlist').addEventListener('click',()=>apply({type:'configure',
  options:{...player.state.options,baseCount:0}}));
 $('media-restore-playlist').addEventListener('click',()=>apply({type:'configure',
  options:{...player.state.options,baseCount:6}}));
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&mediaTestView(player).playing)apply({type:'pause'});
 });
 window.addEventListener('pagehide',()=>{
  stopMedia();
  for(const role of ['base','commercial']){
   if(objects[role])URL.revokeObjectURL(objects[role].url);
  }
  objects={base:null,commercial:null};
 });
 render();
}
