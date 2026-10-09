(() => {
 'use strict';
 let current=null;
 async function update(){
  try{const response=await fetch('/app-icon-config',{cache:'no-store'});if(!response.ok)return;const config=await response.json();current=config;
   const icon=config.icons?.find(i=>i.sizes==='512x512'&&i.purpose==='any');if(!icon)return;
   let link=document.querySelector('link[rel="icon"]');if(!link){link=document.createElement('link');link.rel='icon';document.head.append(link);}link.type='image/png';link.href=icon.src;
   let apple=document.querySelector('link[rel="apple-touch-icon"]');if(!apple){apple=document.createElement('link');apple.rel='apple-touch-icon';document.head.append(apple);}apple.href=icon.src;
  }catch{}
 }
 update();window.addEventListener('focus',update);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
 const masterNav=document.querySelector('.master-sidebar nav');
 const nav=masterNav||document.querySelector('#saas-admin-nav');if(!nav)return;
 const button=document.createElement('button');button.type='button';button.className=masterNav?'nav-button':'nav-item';button.textContent='▧ Trocar ícone / favicon';nav.append(button);
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Trocar ícone do aplicativo');dialog.style.cssText='max-width:480px;width:calc(100% - 40px);border:0;border-radius:16px;padding:24px';
 dialog.innerHTML='<h2>Ícone do aplicativo</h2><p>A imagem será usada no favicon e nas novas instalações do Vision Mídia.</p><label>Escolher imagem<input type="file" accept="image/png,image/jpeg,image/webp" style="display:block;margin:12px 0"></label><img alt="Prévia do ícone" width="160" height="160" hidden><p>Em celulares já instalados, abra o app e aceite a atualização de imagem quando o navegador oferecer. A mudança pode levar algum tempo. No iPhone, pode ser necessário adicionar novamente à Tela de Início.</p><p role="status" aria-live="polite"></p><button type="button" data-save>Salvar ícone</button> <button type="button" data-close>Cancelar</button>';
 document.body.append(dialog);let draft=null;
 const input=dialog.querySelector('input'),preview=dialog.querySelector('img'),status=dialog.querySelector('[role=status]'),save=dialog.querySelector('[data-save]');
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 button.onclick=async()=>{await update();status.textContent='';dialog.showModal();};
 input.onchange=async()=>{
  draft=null;save.disabled=true;const file=input.files[0];if(!file)return;
  try{
   if(file.size>8000000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Escolha uma imagem PNG, JPG ou WebP de até 8 MB.');
   const image=await createImageBitmap(file);if(image.width>8192||image.height>8192){image.close();throw Error('Use uma imagem com até 8192 pixels de cada lado.');}
   const icons={};for(const [key,size,pad] of [['192',192,.875],['512',512,.875],['maskable',512,.6875]]){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');ctx.fillStyle='#0b1220';ctx.fillRect(0,0,size,size);
    const ratio=Math.min(size*pad/image.width,size*pad/image.height),w=image.width*ratio,h=image.height*ratio;ctx.drawImage(image,(size-w)/2,(size-h)/2,w,h);icons[key]=canvas.toDataURL('image/png').split(',')[1];
   }image.close();draft=icons;preview.src='data:image/png;base64,'+icons['512'];preview.hidden=false;status.textContent='Prévia pronta. Salve para atualizar o ícone de todos os clientes.';save.disabled=false;
  }catch(e){status.textContent=e.message;}
 };
 save.onclick=async()=>{
  if(!draft){status.textContent='Escolha uma imagem primeiro.';return;}save.disabled=true;status.textContent='Salvando…';
  try{const session=JSON.parse(localStorage.getItem('vision_midia_session_v1')||'null');if(!session?.access_token)throw Error('Entre novamente com sua conta Master.');
   const r=await fetch('/api/app-icon',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({icons:draft,expected_revision:current?.revision??null})});
   if(!r.ok){if(r.status===409){await update();throw Error('Outro administrador mudou o ícone. Confira a prévia e clique em Salvar novamente.');}if(r.status===401||r.status===403)throw Error('Entre novamente com uma conta Master com permissão de edição.');throw Error('Não foi possível salvar o ícone. Tente novamente.');}
   await update();status.textContent='Ícone salvo. Novas instalações usarão esta imagem. Quem já instalou pode precisar aceitar a atualização pelo navegador.';
  }catch(e){status.textContent=e.message;}finally{save.disabled=false;}
 };
})();
