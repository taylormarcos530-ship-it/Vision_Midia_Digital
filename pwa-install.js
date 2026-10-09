(() => {
 'use strict';
 if(window.top!==window.self)return;
 const INSTALLED='vision_pwa_installed_v1',SEEN='vision_pwa_install_seen_day_v1';
 let invitation=null,promptEvent=null,shown=false,installOpportunity=false;
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
 const inApp=()=>navigator.standalone===true||['standalone','minimal-ui','fullscreen'].some(mode=>window.matchMedia('(display-mode: '+mode+')').matches)||document.referrer.startsWith('android-app://');
 function read(key){try{return localStorage.getItem(key);}catch{return null;}}
 function write(key,value){try{localStorage.setItem(key,value);}catch{}}
 function clearInstalled(){try{localStorage.removeItem(INSTALLED);}catch{}}
 function today(){const d=new Date();return[d.getFullYear(),d.getMonth()+1,d.getDate()].join('-');}
 function hide(){if(invitation)invitation.remove();invitation=null;}
 function installed(){write(INSTALLED,'1');promptEvent=null;hide();}
 function show(){
  if(shown||inApp()||read(INSTALLED)==='1'||read(SEEN)===today())return;
  shown=true;write(SEEN,today());
  const card=document.createElement('aside');card.className='vision-install-invite';card.setAttribute('aria-label','Instalar aplicativo');
  card.innerHTML='<div class="vision-install-heading"><img src="/icons/vision-192.png?v=20261009" alt="" width="48" height="48"><div><strong>Instale nosso aplicativo</strong><p>Tenha o Vision Mídia sempre à mão no seu celular.</p></div><button type="button" class="vision-install-close" data-dismiss aria-label="Fechar convite">×</button></div><p class="vision-install-message" data-message role="status" aria-live="polite"></p><div class="vision-install-actions"><button type="button" data-install>Instalar aplicativo</button><button type="button" data-installed>Já instalei</button></div>';
  card.querySelector('[data-dismiss]').onclick=hide;
  card.querySelector('[data-installed]').onclick=installed;
  card.querySelector('[data-install]').onclick=async()=>{
   const message=card.querySelector('[data-message]');
   if(!promptEvent){message.textContent=ios?'No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.':'Abra o menu ⋮ do navegador e escolha Instalar aplicativo ou Adicionar à tela inicial.';return;}
   const event=promptEvent;promptEvent=null;
   try{await event.prompt();const choice=await event.userChoice;if(choice.outcome==='accepted')hide();else message.textContent='Tudo bem. Você pode instalar quando quiser pelo menu do navegador.';}catch{message.textContent='Use o menu do navegador para instalar o aplicativo.';}
  };
  document.body.append(card);invitation=card;
 }
 window.addEventListener('appinstalled',installed);
 window.addEventListener('beforeinstallprompt',event=>{
  if(inApp())return;
  event.preventDefault();promptEvent=event;installOpportunity=true;clearInstalled();show();
 });
 window.addEventListener('storage',event=>{if(event.key===INSTALLED&&event.newValue==='1')hide();});
 document.addEventListener('visibilitychange',()=>{if(inApp()||read(INSTALLED)==='1')hide();});
 if(inApp()){installed();return;}
 if(typeof navigator.getInstalledRelatedApps==='function'){
  Promise.resolve().then(()=>navigator.getInstalledRelatedApps()).then(apps=>{
   if(installOpportunity)return;
   const url=new URL('/manifest.webmanifest',location.origin).href;
   if(apps.some(app=>app.platform==='webapp'&&app.url&&new URL(app.url,location.origin).href===url)){installed();return;}
   clearInstalled();show();
  }).catch(()=>{if(ios&&read(INSTALLED)!=='1')show();});
 }else if(ios)show();
})();
