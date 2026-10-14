// Read-only browser diagnostics for an independently owned lab device.
// No Supabase, device registration, player control, analytics or network calls.
import {viewportReport,decodeSupport,canUseLabFile} from './commercial-tv-device-metrics.mjs';

if(typeof document!=='undefined'&&document.getElementById('device-lab')){
 const $=id=>document.getElementById(id);
 const stage=$('diag-stage'),video=$('diag-video'),picker=$('diag-file');
 let fileURL=null,pending=null,generation=0,completed=0,interruptions=0,errors=0,completionArmed=false,portrait=false,fit='contain';
 const clearPending=()=>{if(pending!==null){clearTimeout(pending);pending=null;}generation++;};
 const message=text=>{$('diag-video-state').textContent=text;};
 const counts=()=>{
  $('diag-events').textContent='Vídeos concluídos neste teste: '+completed+
   ' · Interrupções: '+interruptions+' · Erros: '+errors;
 };
 const position=()=>{
  const seconds=Number(video.currentTime)||0,secondsTotal=Number(video.duration);
  $('diag-position').textContent='Posição de vídeo: '+seconds.toFixed(1)+' s'+
   (Number.isFinite(secondsTotal)&&secondsTotal>0?' / '+secondsTotal.toFixed(1)+' s':'');
 };
 const viewport=()=>{
  const r=viewportReport(window.innerWidth,window.innerHeight,window.devicePixelRatio);
  $('diag-viewport').textContent=r.valid?
   'Janela do navegador: '+r.width+' × '+r.height+' pixels CSS · '+r.orientation+
   ' · escala: '+r.pixelRatio:'Não foi possível medir a janela.';
  let orientation='não disponível neste navegador';
  const scr=window.screen;
  if(scr&&scr.orientation&&typeof scr.orientation.type==='string')orientation=scr.orientation.type;
  $('diag-screen').textContent='Orientação relatada pelo navegador: '+orientation+
   '. Simulação do quadro: '+(portrait?'vertical 9:16':'horizontal 16:9')+'.';
 };
 const fullscreenStatus=()=>{
  const full=document.fullscreenElement||document.webkitFullscreenElement;
  $('diag-fullscreen-state').textContent=full===stage?
   'Tela cheia: ativa nesta página.':'Tela cheia: não ativa ou indisponível.';
  $('diag-fullscreen').textContent=full===stage?'Sair da tela cheia':'Tela cheia';
 };
 const play=()=>{
  if(document.hidden){message('Guia oculta: reprodução bloqueada para segurança.');return;}
  if(!fileURL){message('Escolha primeiro um vídeo MP4 ou WebM local.');return;}
  clearPending();
  try{
   const result=video.play();
   if(result&&typeof result.catch==='function')
    result.catch(()=>message('O navegador bloqueou o vídeo ou não decodificou o arquivo. Tente pelo controle do vídeo.'));
  }catch{message('O navegador não conseguiu iniciar o vídeo.');}
 };
 const release=()=>{
  clearPending();
  video.pause();video.removeAttribute('src');video.load();
  if(fileURL){URL.revokeObjectURL(fileURL);fileURL=null;}
  video.hidden=true;$('diag-pattern').hidden=false;$('diag-pattern-title').hidden=false;
  completionArmed=false;
 };
 picker.addEventListener('change',()=>{
  const file=picker.files&&picker.files[0];
  release();
  if(!file){$('diag-file-status').textContent='Nenhum arquivo escolhido.';message('Aguardando vídeo local.');return;}
  if(!canUseLabFile(file)){
   $('diag-file-status').textContent='Arquivo recusado (somente MP4/WebM, até 100 MB).';
   message('Nenhum arquivo de vídeo válido carregado.');
   return;
  }
  fileURL=URL.createObjectURL(file);
  video.hidden=false;$('diag-pattern').hidden=true;$('diag-pattern-title').hidden=true;
  video.src=fileURL;video.load();
  $('diag-file-status').textContent='Arquivo local pronto: '+String(file.name||'Vídeo de teste').slice(0,100);
  message('Arquivo carregado somente neste aparelho. Toque em Iniciar vídeo local.');
  position();
 });
 $('diag-play').addEventListener('click',play);
 $('diag-pause').addEventListener('click',()=>{
  clearPending();video.pause();message('Vídeo pausado manualmente nesta posição.');position();
 });
 $('diag-interrupt').addEventListener('click',()=>{
  if(!fileURL||video.paused||video.ended){message('Inicie o vídeo antes de simular uma interrupção.');return;}
  clearPending();
  const thisGeneration=generation;
  const before=Number(video.currentTime)||0;
  video.pause();interruptions++;counts();
  message('Interrupção local simulada (2 segundos), na posição '+before.toFixed(1)+' s.');
  pending=setTimeout(()=>{
   pending=null;
   if(generation!==thisGeneration||document.hidden||!fileURL)return;
   try{
    const attempt=video.play();
    if(attempt&&typeof attempt.catch==='function')
     attempt.catch(()=>message('Retomada impedida pelo navegador. Toque em Iniciar vídeo local.'));
   }catch{message('Retomada impedida. Toque em Iniciar vídeo local.');}
  },2000);
 });
 $('diag-landscape').addEventListener('click',()=>{
  portrait=false;stage.classList.remove('portrait');viewport();
 });
 $('diag-portrait').addEventListener('click',()=>{
  portrait=true;stage.classList.add('portrait');viewport();
 });
 $('diag-fit').addEventListener('click',()=>{
  fit=fit==='contain'?'cover':'contain';
  video.classList.toggle('cover',fit==='cover');
  $('diag-fit-state').textContent=fit==='cover'?
   'Preenchimento: cobrir (cover) — pode cortar as bordas do vídeo.':
   'Preenchimento: mostrar inteiro (contain) — pode criar barras.';
 });
 $('diag-fullscreen').addEventListener('click',()=>{
  const full=document.fullscreenElement||document.webkitFullscreenElement;
  const method=full===stage?(document.exitFullscreen||document.webkitExitFullscreen):
   (stage.requestFullscreen||stage.webkitRequestFullscreen);
  if(typeof method!=='function'){
   $('diag-fullscreen-state').textContent='Tela cheia indisponível neste navegador/WebView.';
   return;
  }
  try{
   const result=method.call(full===stage?document:stage);
   if(result&&typeof result.catch==='function')
    result.catch(()=>$('diag-fullscreen-state').textContent='O navegador negou a tela cheia.');
  }catch{$('diag-fullscreen-state').textContent='O navegador não permitiu a tela cheia.';}
 });
 video.addEventListener('play',()=>{completionArmed=true;message('Vídeo iniciado. Execução local em andamento.');});
 video.addEventListener('playing',()=>{message('Vídeo reproduzindo neste aparelho.');});
 video.addEventListener('pause',()=>{if(fileURL&&!video.ended)message('Vídeo pausado; posição mantida.');});
 video.addEventListener('timeupdate',position);
 video.addEventListener('loadedmetadata',position);
 video.addEventListener('waiting',()=>message('Vídeo aguardando dados/decodificação neste aparelho.'));
 video.addEventListener('stalled',()=>message('Vídeo sem progresso: possível problema de arquivo ou decodificação.'));
 video.addEventListener('ended',()=>{
  if(!completionArmed)return;
  completionArmed=false;completed++;counts();position();
  message('Vídeo concluído pelo evento real de término. Nenhuma impressão comercial registrada.');
 });
 video.addEventListener('error',()=>{
  errors++;completionArmed=false;clearPending();counts();
  message('Falha de vídeo ou codec não suportado neste navegador. Não contar como concluído.');
 });
 window.addEventListener('resize',viewport);
 window.addEventListener('orientationchange',viewport);
 document.addEventListener('fullscreenchange',fullscreenStatus);
 document.addEventListener('webkitfullscreenchange',fullscreenStatus);
 window.addEventListener('keydown',event=>{
  const allowed=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','Backspace'];
  if(allowed.includes(event.key))
   $('diag-key').textContent='Última tecla de controle: '+event.key+' (apenas leitura).';
 });
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
   clearPending();video.pause();
   message('Página oculta: teste pausado. Nenhuma reprodução automática em segundo plano.');
  }
 });
 window.addEventListener('pagehide',release);
 const support=decodeSupport(mime=>video.canPlayType?video.canPlayType(mime):'');
 $('diag-codecs').textContent=support.map(item=>item.name+': '+item.level).join(' · ');
 viewport();fullscreenStatus();counts();position();
}
