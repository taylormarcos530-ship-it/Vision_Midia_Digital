(() => {
  'use strict';
  const CONFIG = window.VISION_CONFIG;
  const SESSION_KEY = 'vision_midia_session_v1';
  const LOGIN_VISUAL_PREVIEW_KEY = 'vision_midia_login_visual_preview_v1';
  const state = { session: null, role: null, data: null, platformConfig: null, emailProviderStatus: null, view: 'dashboard', selectedCompanyId: null, replaceDevices: [], accessDevices: [], loginVisualDraft: null, loginVisualRemoveRequested: false, playerBranding: null, playerBrandingDraft: null, playerBrandingRemoveRequested: false };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let lastActionButton = null;
  let lastActionAt = 0;
  const isFeedbackActionButton = button => button && !button.matches('[data-master-view],[data-go-master],[data-close]');
  function trackActionButton(button){ if(!isFeedbackActionButton(button))return; lastActionButton=button; lastActionAt=Date.now(); }
  function applyButtonFeedback(type){
    const button=lastActionButton;
    if(!button||!button.isConnected||Date.now()-lastActionAt>45000)return;
    const resultText=type==='error'?'✕ Erro':'✓ Sucesso';
    button.dataset.feedbackResult=resultText;
    if(!button.disabled){
      const original=button.dataset.old||button.dataset.feedbackOriginal||button.textContent;
      button.dataset.feedbackOriginal=original;
      button.textContent=resultText;
      clearTimeout(button._visionFeedbackTimer);
      button._visionFeedbackTimer=setTimeout(()=>{if(!button.isConnected||button.disabled)return;button.textContent=button.dataset.feedbackOriginal||original;delete button.dataset.feedbackOriginal;delete button.dataset.feedbackResult},1400);
    }
  }
  const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function toast(title, message='', type='success') {
    const writeFeedback=/(salv|criad|atualiz|adicion|enviad|paread|programad|atribu|reordenad|substitu|configurad|alterad)/i.test(String(title));
    const readOnlyRefresh=/^(Relatório|Monitoramento|Status|Captura).*atualiz/i.test(String(title));
    if(type==='success' && title!=='Salvo com sucesso' && writeFeedback && !readOnlyRefresh){message=message?`${title}. ${message}`:title;title='Salvo com sucesso'}
    let root = $('#master-toast-root');
    const dialog = $('dialog[open]');
    if (dialog) {
      let localRoot = dialog.querySelector('.dialog-toast-root');
      if (!localRoot) {
        localRoot = document.createElement('div');
        localRoot.className = 'dialog-toast-root';
        localRoot.setAttribute('aria-live','polite');
        dialog.appendChild(localRoot);
      }
      root = localRoot;
    }
    const el = document.createElement('div'); el.className = `toast ${type}`;
    el.innerHTML = `<strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ''}`;
    root.appendChild(el); applyButtonFeedback(type); setTimeout(() => el.remove(), 4200);
  }
  function formStatus(selector, message='', type='') {
    const el = $(selector);
    if (!el) return;
    el.textContent = message;
    el.className = `form-status ${type}`.trim();
    el.classList.toggle('hidden', !message);
  }
  function busy(btn, yes, text='Salvando...') {
    if (!btn) return;
    if (yes) { btn.dataset.old = btn.dataset.old || btn.textContent; btn.textContent = text; btn.disabled = true; }
    else {
      btn.disabled = false;
      const resultText=btn.dataset.feedbackResult;
      if(resultText){
        btn.textContent=resultText;
        delete btn.dataset.feedbackResult;
        clearTimeout(btn._visionFeedbackTimer);
        btn._visionFeedbackTimer=setTimeout(()=>{if(!btn.isConnected||btn.disabled)return;btn.textContent=btn.dataset.old||btn.textContent;delete btn.dataset.old},1400);
      } else {
        btn.textContent=btn.dataset.old||btn.textContent;
        delete btn.dataset.old;
      }
    }
  }
  const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100);
  function bytes(n) { n=Number(n||0); if(n<1024) return `${n} B`; const u=['KB','MB','GB','TB']; let v=n/1024,i=0; while(v>=1024&&i<u.length-1){v/=1024;i++} return `${v.toFixed(v>=10?1:2)} ${u[i]}`; }
  function dt(v){ if(!v) return '—'; try{return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))}catch{return '—'} }
  function numOrBlank(v){ return v === null || v === undefined ? '' : v; }

  function readLoginVisualPreview(){
    try{
      const raw=localStorage.getItem(LOGIN_VISUAL_PREVIEW_KEY);
      return raw?JSON.parse(raw):null;
    }catch{return null}
  }
  function writeLoginVisualPreview(value){
    try{
      if(value)localStorage.setItem(LOGIN_VISUAL_PREVIEW_KEY,JSON.stringify(value));
      else localStorage.removeItem(LOGIN_VISUAL_PREVIEW_KEY);
      return true;
    }catch{return false}
  }
  function baseLoginVisualConfig(){
    const c=state.platformConfig||{};
    return{
      imageDataUrl:c.login_image_url||'',
      fit:c.login_image_fit||'cover',
      position:c.login_image_position||'center',
      overlay:Number(c.login_image_overlay??42),
      title:c.login_image_title||'Sua operação visual, organizada em um só lugar.',
      subtitle:c.login_image_subtitle||'Gerencie telas, conteúdos, playlists e campanhas com controle profissional.',
    };
  }
  function currentLoginVisualConfig(){
    return state.loginVisualDraft||readLoginVisualPreview()||baseLoginVisualConfig();
  }
  function updateLoginVisualMasterPreview(){
    const cfg=currentLoginVisualConfig();
    const box=$('#login-visual-master-preview');
    const img=$('#login-visual-master-image');
    if(!box||!img)return;
    box.style.setProperty('--login-master-fit',['cover','contain'].includes(cfg.fit)?cfg.fit:'cover');
    box.style.setProperty('--login-master-position',cfg.position||'center');
    box.style.setProperty('--login-master-overlay',String(Math.max(0,Math.min(1,Number(cfg.overlay||0)/100))));
    $('#login-visual-master-title').textContent=cfg.title||'Sua operação visual, organizada em um só lugar.';
    $('#login-visual-master-subtitle').textContent=cfg.subtitle||'Gerencie telas, conteúdos, playlists e campanhas com controle profissional.';
    if(cfg.imageDataUrl){
      const nextSrc=String(cfg.imageDataUrl);
      if(img.dataset.visionSrc===nextSrc&&img.getAttribute('src')){
        img.classList.remove('hidden');
        box.dataset.hasImage='true';
      }else{
        const preload=new Image();
        preload.onload=()=>{
          if(!img.isConnected)return;
          img.src=nextSrc;
          img.dataset.visionSrc=nextSrc;
          img.classList.remove('hidden');
          box.dataset.hasImage='true';
        };
        preload.src=nextSrc;
      }
    }else{
      img.removeAttribute('src');
      delete img.dataset.visionSrc;
      img.classList.add('hidden');
      box.dataset.hasImage='false';
    }
  }
  function collectLoginVisualDraft(){
    const existing=currentLoginVisualConfig();
    const draft={
      ...existing,
      fit:$('#lv-fit')?.value||'cover',
      position:$('#lv-position')?.value||'center',
      overlay:Number($('#lv-overlay')?.value||42),
      title:($('#lv-title')?.value||'').trim()||'Sua operação visual, organizada em um só lugar.',
      subtitle:($('#lv-subtitle')?.value||'').trim()||'Gerencie telas, conteúdos, playlists e campanhas com controle profissional.',
      updatedAt:new Date().toISOString(),
    };
    state.loginVisualDraft=draft;
    return draft;
  }
  async function compressLoginVisualFile(file){
    if(!file)return null;
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type||''))throw new Error('Use uma imagem JPG, PNG ou WEBP.');
    if(file.size>8*1024*1024)throw new Error('A imagem pode ter no máximo 8 MB.');
    const dataUrl=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('Não foi possível ler a imagem.'));
      reader.onload=()=>resolve(String(reader.result||''));
      reader.readAsDataURL(file);
    });
    const img=await new Promise((resolve,reject)=>{
      const el=new Image();
      el.onerror=()=>reject(new Error('Imagem inválida.'));
      el.onload=()=>resolve(el);
      el.src=dataUrl;
    });
    const maxWidth=1600,maxHeight=1200;
    const scale=Math.min(1,maxWidth/img.naturalWidth,maxHeight/img.naturalHeight);
    const width=Math.max(1,Math.round(img.naturalWidth*scale));
    const height=Math.max(1,Math.round(img.naturalHeight*scale));
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Seu navegador não conseguiu preparar a imagem.');
    ctx.drawImage(img,0,0,width,height);
    return canvas.toDataURL('image/webp',0.82);
  }
  async function handleLoginVisualFile(event){
    const file=event.target.files?.[0];
    if(!file)return;
    formStatus('#lv-status','Preparando imagem...','pending');
    try{
      const imageDataUrl=await compressLoginVisualFile(file);
      const draft=collectLoginVisualDraft();
      draft.imageDataUrl=imageDataUrl;
      state.loginVisualDraft=draft;
      state.loginVisualRemoveRequested=false;
      updateLoginVisualMasterPreview();
      formStatus('#lv-status','✅ Imagem preparada. Clique em “Salvar no preview”.','success');
      toast('Imagem preparada','A prévia já está mostrando o novo visual.');
    }catch(e){
      event.target.value='';
      formStatus('#lv-status',`❌ ${e.message}`,'error');
      toast('Erro ao preparar imagem',e.message,'error');
    }
  }
  async function saveLoginVisualPreview(event){
    event.preventDefault();
    const b=$('#lv-save');busy(b,true,'Salvando...');
    try{
      const draft=collectLoginVisualDraft();
      const backendReady=Object.prototype.hasOwnProperty.call(state.platformConfig||{},'login_image_fit');

      if(backendReady){
        const payload={
          action:'update_login_visual',
          fit:draft.fit,
          position:draft.position,
          overlay:draft.overlay,
          title:draft.title,
          subtitle:draft.subtitle,
          remove_image:state.loginVisualRemoveRequested===true,
        };
        if(/^data:image\/webp;base64,/i.test(draft.imageDataUrl||''))payload.image_base64=draft.imageDataUrl;
        const result=await platformSettingsRequest(payload);
        state.platformConfig=result.config||state.platformConfig||{};
        writeLoginVisualPreview(null);
        state.loginVisualDraft=baseLoginVisualConfig();
        state.loginVisualRemoveRequested=false;
        renderPlatformSettings();
        formStatus('#lv-status','✅ Visual do login salvo para toda a plataforma.','success');
        toast('Salvo com sucesso','A tela de login global foi atualizada.');
      }else{
        if(!writeLoginVisualPreview(draft))throw new Error('O navegador não conseguiu salvar a imagem. Tente uma imagem menor.');
        state.loginVisualDraft={...draft};
        state.loginVisualRemoveRequested=false;
        updateLoginVisualMasterPreview();
        formStatus('#lv-status','✅ Visual do login salvo neste preview.','success');
        toast('Salvo com sucesso','A tela de login deste preview já está atualizada.');
      }
    }catch(e){
      formStatus('#lv-status',`❌ ${e.message}`,'error');
      toast('Erro ao salvar visual',e.message,'error');
    }finally{busy(b,false)}
  }
  function removeLoginVisualImage(){
    const draft=collectLoginVisualDraft();
    draft.imageDataUrl='';
    state.loginVisualDraft=draft;
    state.loginVisualRemoveRequested=true;
    updateLoginVisualMasterPreview();
    $('#lv-file').value='';
    formStatus('#lv-status','Imagem removida da prévia. Salve para confirmar.','pending');
  }

  function masterPlayerBrandingConfig(){
    const base=state.playerBranding||{};
    const draft=state.playerBrandingDraft||{};
    return{
      title:draft.title!==undefined?draft.title:(base.title||''),
      message:draft.message!==undefined?draft.message:(base.message||''),
      imageDataUrl:draft.imageDataUrl||'',
      splashUrl:state.playerBrandingRemoveRequested?'':(draft.imageDataUrl||base.splash_url||''),
      setupCode:base.setup_code||'',
    };
  }
  function renderMasterPlayerBrandingPreview(){
    const cfg=masterPlayerBrandingConfig();
    const box=$('#me-branding-preview');
    const img=$('#me-branding-image');
    if(!box||!img)return;
    $('#me-branding-preview-title').textContent=cfg.title||$('#me-company-name')?.value||'Vision Player';
    $('#me-branding-preview-message').textContent=cfg.message||'Instale o Player e vincule a TV pelo código.';
    $('#me-branding-setup-code').textContent=cfg.setupCode||'Gerado automaticamente';
    const nextSrc=cfg.splashUrl||'';
    if(nextSrc){
      if(img.dataset.visionSrc===nextSrc&&img.getAttribute('src')){
        img.classList.remove('hidden');
        box.dataset.hasImage='true';
      }else{
        const preload=new Image();
        preload.onload=()=>{
          if(!img.isConnected)return;
          img.src=nextSrc;
          img.dataset.visionSrc=nextSrc;
          img.classList.remove('hidden');
          box.dataset.hasImage='true';
        };
        preload.src=nextSrc;
      }
    }else{
      img.removeAttribute('src');
      delete img.dataset.visionSrc;
      img.classList.add('hidden');
      box.dataset.hasImage='false';
    }
  }
  async function loadMasterPlayerBranding(companyId){
    state.playerBranding=null;
    state.playerBrandingDraft=null;
    state.playerBrandingRemoveRequested=false;
    if($('#me-branding-title'))$('#me-branding-title').value='';
    if($('#me-branding-message'))$('#me-branding-message').value='';
    if($('#me-branding-file'))$('#me-branding-file').value='';
    renderMasterPlayerBrandingPreview();
    const result=await master({action:'get_player_branding',company_id:companyId});
    if($('#me-company-id')?.value!==companyId)return;
    state.playerBranding=result?.branding||null;
    state.playerBrandingDraft=null;
    if($('#me-branding-title'))$('#me-branding-title').value=state.playerBranding?.title||'';
    if($('#me-branding-message'))$('#me-branding-message').value=state.playerBranding?.message||'';
    renderMasterPlayerBrandingPreview();
  }
  function syncMasterPlayerBrandingDraft(){
    state.playerBrandingDraft={
      ...(state.playerBrandingDraft||{}),
      title:($('#me-branding-title')?.value||'').trim(),
      message:($('#me-branding-message')?.value||'').trim(),
    };
    renderMasterPlayerBrandingPreview();
  }
  async function handleMasterPlayerBrandingFile(event){
    const file=event.target.files?.[0];
    if(!file)return;
    formStatus('#me-branding-status','Preparando capa...','pending');
    try{
      const imageDataUrl=await compressLoginVisualFile(file);
      if(String(imageDataUrl||'').length>2.8*1024*1024)throw new Error('A capa otimizada ficou maior que 2 MB. Use uma imagem menor.');
      state.playerBrandingDraft={...(state.playerBrandingDraft||{}),imageDataUrl};
      state.playerBrandingRemoveRequested=false;
      syncMasterPlayerBrandingDraft();
      formStatus('#me-branding-status','✅ Capa preparada. Clique em “Salvar identidade”.','success');
    }catch(e){
      event.target.value='';
      formStatus('#me-branding-status',`❌ ${e.message}`,'error');
    }
  }
  function removeMasterPlayerBrandingImage(){
    state.playerBrandingRemoveRequested=true;
    state.playerBrandingDraft={...(state.playerBrandingDraft||{}),imageDataUrl:''};
    if($('#me-branding-file'))$('#me-branding-file').value='';
    renderMasterPlayerBrandingPreview();
    formStatus('#me-branding-status','Capa removida da prévia. Salve para confirmar.','pending');
  }
  async function saveMasterPlayerBranding(){
    const companyId=$('#me-company-id')?.value||'';
    if(!companyId)return;
    const button=$('#me-branding-save');
    syncMasterPlayerBrandingDraft();
    busy(button,true,'Salvando...');
    try{
      const cfg=masterPlayerBrandingConfig();
      const payload={
        action:'save_player_branding',
        company_id:companyId,
        title:cfg.title||null,
        message:cfg.message||null,
        remove_image:state.playerBrandingRemoveRequested===true,
      };
      if(/^data:image\/webp;base64,/i.test(state.playerBrandingDraft?.imageDataUrl||''))payload.image_base64=state.playerBrandingDraft.imageDataUrl;
      const result=await master(payload);
      state.playerBranding=result?.branding||null;
      state.playerBrandingDraft=null;
      state.playerBrandingRemoveRequested=false;
      if($('#me-branding-file'))$('#me-branding-file').value='';
      renderMasterPlayerBrandingPreview();
      formStatus('#me-branding-status','✅ Identidade do Player salva para esta empresa.','success');
      toast('Salvo com sucesso','Título, mensagem e capa do Player foram atualizados.');
    }catch(e){
      formStatus('#me-branding-status',`❌ ${e.message}`,'error');
      toast('Erro ao salvar identidade do Player',e.message,'error');
    }finally{busy(button,false)}
  }

  function reaisToCents(v){ const t=String(v||'').trim().replace(/\./g,'').replace(',','.'); if(!t) return null; const n=Number(t); return Number.isFinite(n)?Math.round(n*100):null; }
  function saveSession(s){ state.session=s; if(s) localStorage.setItem(SESSION_KEY,JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); }
  function savedSession(){ try{const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null'); return s?.access_token&&s?.refresh_token?s:null}catch{return null} }
  async function parse(res){ const t=await res.text(); let d=null; try{d=t?JSON.parse(t):null}catch{d=t}; if(!res.ok){const e=new Error(d?.error_description||d?.message||d?.error||`HTTP ${res.status}`); e.status=res.status; throw e} return d; }
  async function auth(path, body){ return parse(await fetch(`${CONFIG.supabaseUrl}/auth/v1${path}`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)})); }
  function passwordRecoveryRedirectUrl(){
    return 'https://vision-midia-digital.vercel.app/index.html';
  }
  async function sendPasswordRecovery(email){
    const target=String(email||'').trim().toLowerCase();
    if(!target||!target.includes('@'))throw new Error('E-mail do responsável não encontrado.');
    try{
      return await edgeRequest('password-recovery-email',{email:target,redirect_to:passwordRecoveryRedirectUrl()});
    }catch(error){
      const message=String(error?.message||error||'');
      if(/resend_not_configured|resend_api_key_required|sender_email_required/i.test(message))throw new Error('Configure o Resend no Dashboard SaaS antes de enviar redefinições.');
      if(/resend_sender_domain_not_verified/i.test(message))throw new Error('O domínio do remetente ainda não está verificado no Resend. Enquanto isso, use o modo temporário onboarding@resend.dev.');
      if(/resend_send_failed/i.test(message))throw new Error('O Resend recusou o envio. Verifique domínio, remetente e chave API.');
      throw error;
    }
  }
  function emailForUserId(userId){
    for(const company of state.data?.companies||[]){
      if(company.owner?.id===userId&&company.owner?.email)return company.owner.email;
      const member=(company.members||[]).find(item=>item.user_id===userId);
      if(member?.user?.email)return member.user.email;
    }
    return '';
  }
  async function refresh(){ if(!state.session?.refresh_token) return null; const d=await auth('/token?grant_type=refresh_token',{refresh_token:state.session.refresh_token}); saveSession(d); return d; }
  async function master(body, retry=true){ const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/master-admin`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}); if(res.status===401&&retry&&state.session?.refresh_token){await refresh(); return master(body,false)} return parse(res); }
  async function savePlanRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/save-plan`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return savePlanRequest(body,false)}return parse(res)}
  async function saveCompanyRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/save-company`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return saveCompanyRequest(body,false)}return parse(res)}
  async function edgeRequest(name,body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/${name}`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body||{}),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return edgeRequest(name,body,false)}return parse(res)}
  async function platformSettingsRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/platform-settings`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return platformSettingsRequest(body,false)}return parse(res)}

  function show(id){ ['master-auth','master-denied','master-shell'].forEach(x => $(`#${x}`).classList.toggle('hidden',x!==id)); }
  function setConn(ok){ const el=$('#master-connection'); el.className=`pill ${ok?'online':'offline'}`; el.textContent=ok?'● Conectado':'● Sem conexão'; }
  function setView(view){ state.view=view; const map={dashboard:['PLATAFORMA','Dashboard SaaS'],clients:['CONTAS','Clientes'],plans:['COMERCIAL','Planos'],audit:['SEGURANÇA','Auditoria']}; $$('.master-view').forEach(x=>x.classList.add('hidden')); $(`#master-view-${view}`)?.classList.remove('hidden'); $$('[data-master-view]').forEach(x=>x.classList.toggle('active',x.dataset.masterView===view)); $('#master-kicker').textContent=map[view]?.[0]||''; $('#master-title').textContent=map[view]?.[1]||''; }
  function planById(id){ return state.data?.plans?.find(p=>p.id===id)||null; }
  function companyById(id){ return state.data?.companies?.find(c=>c.id===id)||null; }
  function limitValue(c,key){ const o=c.subscription?.limit_overrides||{}; if(o[key]!==undefined&&o[key]!==null&&o[key]!=='') return Number(o[key]); return c.plan?.[key]??null; }
  function statusText(v){ return ({active:'Ativa',suspended:'Suspensa',trialing:'Teste',pending_approval:'Aguardando aprovação',past_due:'Pagamento pendente',cancelled:'Cancelada',pending:'Pendente',paid:'Pago',overdue:'Vencido',waived:'Liberado'})[v]||v||'Sem assinatura'; }

  const DAY_MS=86400000;
  function companyDueInfo(company){
    const sub=company?.subscription||null;
    if(!sub||!['active','trialing','past_due'].includes(sub.status||''))return null;
    const isTrial=sub.status==='trialing';
    const source=isTrial?sub.trial_ends_at:sub.current_period_end;
    if(!source)return null;
    const dueDate=new Date(source);
    if(Number.isNaN(dueDate.getTime()))return null;
    const dueMs=dueDate.getTime()-Date.now();
    const absDays=Math.max(1,Math.ceil(Math.abs(dueMs)/DAY_MS));
    const label=isTrial?'Teste':'Plano';
    const when=dueMs<0
      ? `Vencido há ${absDays} dia(s)`
      : dueMs<=DAY_MS
        ? 'Vence hoje'
        : `Vence em ${Math.ceil(dueMs/DAY_MS)} dia(s)`;
    return {company,isTrial,dueDate,dueMs,label,when,state:dueMs<0?'expired':'warning'};
  }
  function dueCompanies(){
    return (state.data?.companies||[])
      .map(companyDueInfo)
      .filter(Boolean)
      .filter(info=>info.dueMs<=3*DAY_MS)
      .sort((a,b)=>a.dueDate-b.dueDate);
  }
  function masterNotificationDayKey(){
    const now=new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  function notifyMasterDueCompanies(items){
    if(!('Notification' in window)||Notification.permission!=='granted')return;
    const day=masterNotificationDayKey();
    items.forEach(info=>{
      const key=`vision_midia_master_due_${day}_${info.company.id}_${String(info.dueDate.toISOString()).slice(0,10)}`;
      if(localStorage.getItem(key)==='1')return;
      try{
        new Notification('Vision Mídia Digital • vencimento',{
          body:`${info.company.name}: ${info.when.toLowerCase()}.`,
          tag:`vision-master-expiry-${info.company.id}`,
        });
        localStorage.setItem(key,'1');
      }catch{}
    });
  }
  function renderExpiryAlerts(){
    const list=$('#master-expiry-list');
    const enable=$('#master-expiry-enable');
    if(!list)return;
    const items=dueCompanies();
    list.innerHTML=items.length?items.map(info=>`
      <div class="master-expiry-item ${info.state}">
        <div><strong>${esc(info.company.name)}</strong><small>${esc(info.label)} • ${esc(new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'}).format(info.dueDate))}</small></div>
        <span class="expiry-chip">${esc(info.when)}</span>
      </div>`).join(''):'<div class="master-expiry-empty">Nenhum vencimento nos próximos 3 dias.</div>';
    if(enable){
      if(!('Notification' in window)){enable.disabled=true;enable.textContent='Avisos indisponíveis'}
      else if(Notification.permission==='granted'){enable.disabled=false;enable.textContent='Avisos ativos'}
      else if(Notification.permission==='denied'){enable.disabled=true;enable.textContent='Avisos bloqueados'}
      else{enable.disabled=false;enable.textContent='Ativar avisos'}
    }
    notifyMasterDueCompanies(items);
  }
  async function enableMasterExpiryNotifications(){
    const button=$('#master-expiry-enable');
    if(!('Notification' in window))return toast('Notificações indisponíveis','Este navegador não oferece notificações do sistema.','error');
    try{
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){
        renderExpiryAlerts();
        return toast('Avisos não ativados','Permita notificações para receber alertas de vencimento.','error');
      }
      renderExpiryAlerts();
      toast('Avisos de vencimento ativados','O Master avisará sobre contas vencidas ou com até 3 dias para vencer.');
    }catch(e){toast('Falha ao ativar avisos',e.message||'Não foi possível solicitar a permissão.','error')}
    finally{if(button)button.blur()}
  }
  function renderNotificationComposer(){
    const select=$('#mn-company');
    if(!select)return;
    const current=select.value;
    const companies=state.data?.companies||[];
    select.innerHTML=companies.length
      ? companies.map(c=>`<option value="${c.id}">${esc(c.name)} • ${esc(c.owner?.email||'sem e-mail')}</option>`).join('')
      : '<option value="">Nenhum cliente</option>';
    if(current&&companies.some(c=>c.id===current))select.value=current;
    if(!$('#mn-title').value.trim())$('#mn-title').value='Vision Mídia Digital';
  }
  function fillExpiryNotification(){
    const company=companyById($('#mn-company')?.value);
    if(!company)return toast('Selecione um cliente','','error');
    const info=companyDueInfo(company);
    const due=info?.dueDate
      ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'}).format(info.dueDate)
      : null;
    $('#mn-title').value='Vision Mídia Digital • Vencimento';
    $('#mn-message').value=info
      ? (info.dueMs<0
          ? `Olá! O ${info.isTrial?'período de teste':'plano'} da sua conta venceu em ${due}. Entre em contato para regularizar o acesso.`
          : `Olá! O ${info.isTrial?'período de teste':'plano'} da sua conta vence em ${due}. Entre em contato se precisar renovar.`)
      : 'Olá! Há uma atualização importante sobre sua conta Vision Mídia Digital.';
    $('#mn-message').focus();
  }
  async function sendMasterNotification(ev){
    ev.preventDefault();
    const companyId=$('#mn-company')?.value||'';
    const title=$('#mn-title')?.value.trim()||'';
    const message=$('#mn-message')?.value.trim()||'';
    if(!companyId)return formStatus('#mn-status','❌ Selecione um cliente.','error');
    if(!title||!message)return formStatus('#mn-status','❌ Preencha o título e a mensagem.','error');
    const button=$('#mn-send');
    busy(button,true,'Enviando...');
    formStatus('#mn-status','Enviando notificação…','pending');
    try{
      const result=await edgeRequest('web-push',{
        action:'send_company',
        company_id:companyId,
        title,
        message,
        url:'./',
        tag:`vision-master-${companyId}`,
      });
      if(result?.skipped==='no_subscriptions'){
        formStatus('#mn-status','⚠️ O cliente ainda não ativou notificações em nenhum aparelho.','error');
        return toast('Nenhum aparelho inscrito','Peça ao cliente para ativar as notificações no painel Vision.','error');
      }
      if(result?.skipped==='vapid_not_configured'){
        formStatus('#mn-status','❌ O Web Push ainda não está configurado no servidor.','error');
        return toast('Web Push indisponível','A configuração VAPID do servidor não está pronta.','error');
      }
      const sent=Number(result?.sent||0),failed=Number(result?.failed||0);
      if(sent<1){
        formStatus('#mn-status',`❌ Nenhuma notificação foi entregue${failed? `; ${failed} falhou(aram)`:'.'}`,'error');
        return toast('Notificação não entregue','Nenhum aparelho confirmou o envio.','error');
      }
      formStatus('#mn-status',`✅ Enviada para ${sent} aparelho(s)${failed? `; ${failed} falhou(aram)`:'.'}`,'success');
      toast('Notificação enviada',`${sent} aparelho(s) receberam o aviso.`);
    }catch(e){
      formStatus('#mn-status',`❌ ${e.message}`,'error');
      toast('Erro ao enviar notificação',e.message,'error');
    }finally{busy(button,false)}
  }

  function renderMetrics(){
    const m=state.data.metrics||{};
    const maxCompanies=Number(m.max_companies||6);
    const companies=Number(m.companies||0);
    const capacityMb=Number(m.storage_capacity_mb||1024);
    const reservedMb=Number(m.storage_reserved_mb||0);
    const usedBytes=Number(m.storage_bytes||0);
    const allocatableMb=Math.max(0,capacityMb-reservedMb);
    $('#mm-companies').textContent=`${companies} / ${maxCompanies}`;
    $('#mm-companies-detail').textContent=`${m.active_companies||0} ativos • ${Math.max(0,maxCompanies-companies)} vaga(s)`;
    $('#mm-mrr').textContent=money(m.mrr_cents);
    $('#mm-users').textContent=m.users||0;
    $('#mm-devices').textContent=m.devices||0;
    $('#mm-devices-detail').textContent=`${m.online_devices||0} online`;
    $('#mm-storage').textContent=`${bytes(usedBytes)} / ${capacityMb.toLocaleString('pt-BR')} MB`;
    $('#mm-storage-detail').textContent=`${reservedMb.toLocaleString('pt-BR')} MB reservados • ${allocatableMb.toLocaleString('pt-BR')} MB disponíveis para limites`;
    $$('[data-open-client]').forEach(btn=>{
      const full=companies>=maxCompanies;
      btn.disabled=full;
      btn.title=full?`Limite de ${maxCompanies} clientes atingido`:'';
    });
  }
  function renderDashboard(){
    const companies=(state.data.companies||[]).slice(0,6);
    $('#master-dashboard-clients').innerHTML=companies.length?companies.map(c=>`<div class="mini-row"><div><strong>${esc(c.name)}</strong><small>${esc(c.owner?.email||'')}</small></div><div><span>${esc(c.plan?.name||'Sem plano')}</span><small>${esc(statusText(c.subscription?.status||c.status))}</small></div></div>`).join(''):'<div class="empty">Nenhum cliente.</div>';
    const audits=(state.data.audits||[]).slice(0,6);
    $('#master-dashboard-audit').innerHTML=audits.length?audits.map(a=>`<div class="mini-row"><div><strong>${esc(a.action)}</strong><small>${esc(companyById(a.company_id)?.name||'Plataforma')}</small></div><span>${esc(dt(a.created_at))}</span></div>`).join(''):'<div class="empty">Sem ações registradas.</div>';
    renderExpiryAlerts();
    renderNotificationComposer();
  }
  function renderClients(){
    const q=($('#master-client-search')?.value||'').toLowerCase();
    const f=$('#master-client-filter')?.value||'';
    const all=state.data.companies||[];
    const rows=all.filter(c=>{
      const matchesStatus=!f||c.status===f||c.subscription?.status===f||c.subscription?.payment_status===f;
      return matchesStatus&&(!q||c.name.toLowerCase().includes(q)||(c.owner?.email||'').toLowerCase().includes(q));
    });
    $('#master-clients-empty').classList.toggle('hidden',rows.length>0);
    $('#master-clients-list').innerHTML=rows.map(c=>{
      const subStatus=c.subscription?.status||'—';
      const maxD=limitValue(c,'max_devices'), maxU=limitValue(c,'max_users'), maxS=limitValue(c,'storage_limit_mb'), maxC=limitValue(c,'max_campaigns');
      const isTrial=c.subscription?.status==='trialing';
      const dueSource=isTrial?c.subscription?.trial_ends_at:c.subscription?.current_period_end;
      const dueDate=dueSource?new Date(dueSource):null;
      const due=dueDate?new Intl.DateTimeFormat('pt-BR',isTrial?{dateStyle:'short',timeStyle:'short'}:{dateStyle:'short'}).format(dueDate):(isTrial?'Sem prazo definido':'Sem vencimento');
      const dueMs=dueDate?dueDate.getTime()-Date.now():null;
      const dueState=dueMs===null?'neutral':dueMs<0?'expired':dueMs<=3*86400000?'warning':'ok';
      const dueHint=dueMs===null?'Defina a data em Gerenciar conta':dueMs<0?'Vencido':dueMs<=86400000?'Vence hoje':dueMs<=3*86400000?`Vence em ${Math.max(1,Math.ceil(dueMs/86400000))} dia(s)`:(isTrial?'Demonstração ativa':'Plano vigente');
      return `<article class="client-card"><div class="client-top"><div class="client-title"><div class="client-avatar">${esc(c.name.charAt(0).toUpperCase())}</div><div><strong>${esc(c.name)}</strong><small>${esc(c.owner?.email||'Sem e-mail')} • ${esc(c.plan?.name||'Sem plano')}</small></div></div><div><span class="status ${esc(c.status)}">${esc(statusText(c.status))}</span> <span class="status ${esc(subStatus)}">${esc(statusText(subStatus))}</span> <span class="status ${esc(c.subscription?.payment_status||'pending')}">${esc(statusText(c.subscription?.payment_status||'pending'))}</span></div></div><div class="client-expiry ${dueState}"><span>${isTrial?'Teste até':'Vencimento do plano'}</span><strong>${esc(due)}</strong><small>${esc(dueHint)}</small></div><div class="client-usage"><div><span>TVs</span><strong>${c.usage.devices}${maxD===null?'':` / ${maxD}`}</strong></div><div><span>Usuários</span><strong>${c.usage.users}${maxU===null?'':` / ${maxU}`}</strong></div><div><span>Storage</span><strong>${esc(bytes(c.usage.storage_bytes))}${maxS===null?'':` / ${esc(bytes(maxS*1024*1024))}`}</strong></div><div><span>Campanhas</span><strong>${c.usage.campaigns}${maxC===null?'':` / ${maxC}`}</strong></div></div><div class="client-actions"><button class="small-button" data-manage-company="${c.id}">Gerenciar conta</button><button class="small-button" data-company-users="${c.id}">Usuários (${c.members.length})</button>${['super_admin','admin'].includes(state.role)?`<button class="small-button" data-device-access-company="${c.id}">Acesso das TVs</button><button class="small-button" data-replace-company-device="${c.id}">Substituir TV</button>`:''}<button class="small-button" data-toggle-company="${c.id}" data-next-status="${c.status==='active'?'suspended':'active'}">${c.status==='active'?'Suspender':'Reativar'}</button></div></article>`;
    }).join('');
  }
  function renderPlans(){ const plans=state.data.plans||[]; $('#master-plans-grid').innerHTML=plans.map(p=>`<article class="plan-card"><div class="client-top"><div><strong>${esc(p.name)}</strong><small>${esc(p.is_active?'Disponível':'Inativo')}</small></div><span class="status ${p.is_active?'active':'suspended'}">${p.is_active?'Ativo':'Inativo'}</span></div><div class="plan-price">${esc(money(p.monthly_price_cents))}<small>/mês</small></div><p>${esc(p.description||'')}</p><ul><li>${p.max_devices??'∞'} TV(s)</li><li>${p.storage_limit_mb==null?'Ilimitado':`${p.storage_limit_mb} MB`} de mídia</li><li>${p.max_users??'∞'} usuário(s)</li><li>${p.max_campaigns??'∞'} campanha(s)</li></ul><div class="client-actions"><button class="small-button" data-edit-plan="${p.id}">Editar plano</button></div></article>`).join(''); $('#open-plan-button').classList.toggle('hidden',state.role!=='super_admin'); }

  function renderEmailProviderSettings(){
    const c=state.platformConfig||{};
    const status=state.emailProviderStatus||{};
    if(!$('#email-provider-form'))return;
    $('#ps-resend-key').value='';
    $('#ps-resend-name').value=c.resend_sender_name||'Vision Mídia Digital';
    $('#ps-resend-sender').value=c.resend_sender_email||'onboarding@resend.dev';
    $('#ps-resend-enabled').checked=c.resend_enabled===true;

    const badge=$('#ps-resend-badge');
    if(badge){
      const testMode=(c.resend_sender_email||'').toLowerCase()==='onboarding@resend.dev';
      badge.textContent=c.resend_enabled===true?(testMode?'MODO TESTE':'ATIVO'):status.api_key_configured?'CHAVE OK':'NÃO CONFIGURADO';
    }

    const domains=Array.isArray(status.domains)?status.domains:[];
    const domainStatus=$('#ps-resend-domain-status');
    if(domainStatus){
      const verified=domains.filter(item=>String(item?.status||'').toLowerCase()==='verified');
      if(verified.length){
        domainStatus.textContent=`Domínio(s) verificado(s): ${verified.map(item=>item.name).join(', ')}.`;
        domainStatus.className='form-status success';
      }else if(domains.length){
        domainStatus.textContent=`Domínio(s) no Resend ainda não verificado(s): ${domains.map(item=>`${item.name} (${item.status||'pendente'})`).join(', ')}.`;
        domainStatus.className='form-status pending';
      }else{
        domainStatus.textContent=status.api_key_configured
          ? 'A chave está conectada. Até entrar o .com.br, use onboarding@resend.dev como remetente temporário; o link de redefinição já volta para vision-midia-digital.vercel.app.'
          : 'Cole a chave do Resend. Por enquanto o remetente temporário será onboarding@resend.dev e o link volta para vision-midia-digital.vercel.app.';
        domainStatus.className='form-status pending';
      }
    }
  }

  function renderPlatformSettings(){
    const c=state.platformConfig||{};
    if(!$('#platform-settings-form'))return;
    $('#ps-whatsapp').value=c.support_whatsapp||'';
    $('#ps-signup-message').value=c.signup_whatsapp_message||'';
    $('#ps-renewal-message').value=c.renewal_whatsapp_message||'';
    $('#ps-signup-enabled').checked=c.signup_enabled!==false;
    renderEmailProviderSettings();

    state.loginVisualDraft=readLoginVisualPreview()||baseLoginVisualConfig();
    state.loginVisualRemoveRequested=false;
    const visual=currentLoginVisualConfig();
    if($('#lv-fit'))$('#lv-fit').value=visual.fit||'cover';
    if($('#lv-position'))$('#lv-position').value=visual.position||'center';
    if($('#lv-overlay'))$('#lv-overlay').value=String(Number(visual.overlay??42));
    if($('#lv-overlay-value'))$('#lv-overlay-value').textContent=`${Number(visual.overlay??42)}%`;
    if($('#lv-title'))$('#lv-title').value=visual.title||'Sua operação visual, organizada em um só lugar.';
    if($('#lv-subtitle'))$('#lv-subtitle').value=visual.subtitle||'Gerencie telas, conteúdos, playlists e campanhas com controle profissional.';
    updateLoginVisualMasterPreview();
  }
  function renderAudit(){ const rows=state.data.audits||[]; $('#master-audit-body').innerHTML=rows.map(a=>`<tr><td>${esc(dt(a.created_at))}</td><td><strong>${esc(a.action)}</strong></td><td>${esc(companyById(a.company_id)?.name||'—')}</td><td>${esc(JSON.stringify(a.details||{}).slice(0,220))}</td></tr>`).join(''); }
  function render(){ renderMetrics(); renderDashboard(); renderClients(); renderPlans(); renderPlatformSettings(); renderAudit(); }

  async function load(){
    try{
      setConn(true);
      const [d,p,emailStatus]=await Promise.all([
        master({action:'dashboard'}),
        platformSettingsRequest({action:'get'}),
        platformSettingsRequest({action:'email_provider_status'}).catch(()=>null),
      ]);
      state.data=d;
      state.platformConfig=p?.config||{};
      state.emailProviderStatus=emailStatus||null;
      render();
    }catch(e){
      setConn(false);
      toast('Falha ao carregar Master',e.message,'error');
      throw e;
    }
  }
  async function enter(){ try{const who=await master({action:'whoami'}); state.role=who.role; $('#master-role-label').textContent=who.role==='super_admin'?'Super Master':who.role; $('#master-email-label').textContent=who.email||''; show('master-shell'); setView('dashboard'); await load();}catch(e){ if(e.status===403)show('master-denied'); else throw e; } }
  async function login(ev){ev.preventDefault();const b=$('#master-login-submit');busy(b,true,'Entrando...');try{const d=await auth('/token?grant_type=password',{email:$('#master-login-email').value.trim(),password:$('#master-login-password').value});saveSession(d);await enter();toast('Acesso Master liberado');}catch(e){toast('Não foi possível entrar',e.message,'error')}finally{busy(b,false)}}
  function logout(){saveSession(null);state.data=null;state.role=null;show('master-auth')}
  function openDialog(id){const d=$(`#${id}`); if(d?.showModal)d.showModal()}
  function closeDialog(id){const d=$(`#${id}`); if(d?.close)d.close()}
  function fillPlanSelects(){ const opts=(state.data.plans||[]).filter(p=>p.is_active).map(p=>`<option value="${p.id}">${esc(p.name)} • ${esc(money(p.monthly_price_cents))}</option>`).join(''); $('#mc-plan').innerHTML=opts; $('#me-plan').innerHTML=(state.data.plans||[]).map(p=>`<option value="${p.id}">${esc(p.name)}${p.is_active?'':' (inativo)'}</option>`).join(''); }
  function openNewClient(){
    const m=state.data?.metrics||{};
    const max=Number(m.max_companies||6);
    if(Number(m.companies||0)>=max){toast('Limite de clientes atingido',`A plataforma está em ${max}/${max} clientes. Para cadastrar outro, libere capacidade ou altere a infraestrutura.`,'error');return}
    fillPlanSelects(); $('#master-client-form').reset(); $('#mc-trial-days').value='7'; openDialog('master-client-dialog');
  }
  async function createClient(ev){ev.preventDefault();const b=$('#mc-save');busy(b,true,'Criando...');try{const d=await master({action:'create_client',company_name:$('#mc-company-name').value.trim(),owner_name:$('#mc-owner-name').value.trim(),owner_email:$('#mc-owner-email').value.trim(),plan_id:$('#mc-plan').value,trial_days:Number($('#mc-trial-days').value||0),temporary_password:$('#mc-temp-password').value});closeDialog('master-client-dialog');toast('Cliente criado',d.delivery==='invite'?'Convite enviado por e-mail.':d.delivery==='temporary_password'?'Acesso criado com senha temporária.':'Usuário existente vinculado.');await load();}catch(e){const msg=/platform_client_limit_reached/i.test(String(e.message))?'O limite de 6 clientes desta infraestrutura foi atingido.':e.message;toast('Erro ao criar cliente',msg,'error')}finally{busy(b,false)}}
  function renderTrialAccess(subscription){
    const el=$('#me-trial-status'); if(!el)return;
    const end=subscription?.trial_ends_at?new Date(subscription.trial_ends_at):null;
    const active=subscription?.status==='trialing'&&end&&!Number.isNaN(end.getTime())&&end.getTime()>Date.now();
    const expired=subscription?.status==='trialing'&&end&&!Number.isNaN(end.getTime())&&end.getTime()<=Date.now();
    el.className=`status ${active?'active':expired?'overdue':'pending'}`;
    el.textContent=active?`Teste até ${dt(subscription.trial_ends_at)}`:expired?'Teste encerrado':'Sem teste ativo';
  }
  function companyFormPayload(extra={}){
    return {company_id:$('#me-company-id').value,company_name:$('#me-company-name').value.trim(),company_status:$('#me-company-status').value,plan_id:$('#me-plan').value,subscription_status:$('#me-sub-status').value,payment_status:$('#me-payment-status').value,due_date:$('#me-due-date').value||null,manual_price_cents:reaisToCents($('#me-manual-price').value),limit_overrides:overrideObj(),billing_notes:$('#me-billing-notes').value.trim(),payment_url:$('#me-payment-url').value.trim()||null,pix_key:$('#me-pix-key')?.value.trim()||null,pix_key_type:$('#me-pix-key-type')?.value||null,pix_receiver_name:$('#me-pix-name')?.value.trim()||null,pix_receiver_city:$('#me-pix-city')?.value.trim()||null,player_audio_enabled:$('#me-player-audio').checked,player_autostart_enabled:$('#me-player-autostart').checked,...extra};
  }
  async function grantTemporaryTrial(minutes,button){
    const duration=Math.round(Number(minutes||0));
    if(!Number.isFinite(duration)||duration<1||duration>43200){formStatus('#me-status','❌ Informe um período entre 1 minuto e 30 dias.','error');return}
    busy(button,true,'Liberando...');formStatus('#me-status','Verificando suporte do backend para acesso temporário...','pending');
    try{
      let capabilities;try{capabilities=await saveCompanyRequest({action:'capabilities'})}catch{throw new Error('O backend do teste temporário ainda não foi publicado. Nenhuma alteração foi feita na conta.')}
      if(capabilities?.capabilities?.timed_trial!==true)throw new Error('O backend do teste temporário ainda não está disponível. Nenhuma alteração foi feita na conta.');
      $('#me-company-status').value='active';$('#me-sub-status').value='trialing';$('#me-payment-status').value='pending';
      const result=await saveCompanyRequest(companyFormPayload({company_status:'active',subscription_status:'trialing',payment_status:'pending',trial_minutes:duration}));
      if(!result?.ok||result?.subscription?.status!=='trialing'||!result?.subscription?.trial_ends_at)throw new Error('O servidor não confirmou o prazo do teste.');
      await load();const persisted=companyById($('#me-company-id').value);renderTrialAccess(persisted?.subscription);const until=persisted?.subscription?.trial_ends_at||result.subscription.trial_ends_at;
      formStatus('#me-status',`✅ Teste liberado por ${duration} minuto(s), até ${dt(until)}.`,'success');toast('Teste temporário liberado',`O cliente será liberado automaticamente e o acesso termina em ${duration} minuto(s).`);
    }catch(e){formStatus('#me-status',`❌ ${e.message}`,'error');toast('Não foi possível liberar o teste',e.message,'error',6500)}finally{busy(button,false)}
  }

  function openCompany(id){
    const c=companyById(id); if(!c)return;
    fillPlanSelects(); formStatus('#me-status');
    $('#me-company-id').value=c.id; $('#me-company-title').textContent=c.name; $('#me-company-name').value=c.name; $('#me-company-status').value=c.status;
    $('#me-plan').value=c.subscription?.plan_id||''; $('#me-sub-status').value=c.subscription?.status||'pending_approval';
    $('#me-payment-status').value=c.subscription?.payment_status||'pending';
    $('#me-due-date').value=c.subscription?.current_period_end?String(c.subscription.current_period_end).slice(0,10):'';
    $('#me-owner-user-id').value=c.owner?.id||c.owner_user_id||'';
    $('#me-owner-email').textContent=c.owner?.email||'E-mail não encontrado';
    const resetOwnerButton=$('#me-reset-owner-password');
    if(resetOwnerButton){
      resetOwnerButton.disabled=!c.owner?.email;
      resetOwnerButton.title=c.owner?.email?'Enviar link seguro de redefinição de senha':'E-mail do responsável não encontrado';
    }
    $('#me-reset-owner-note').textContent=c.owner?.email
      ? 'Envia um link seguro para o responsável criar uma nova senha.'
      : 'E-mail do responsável não encontrado nesta conta.';
    $('#me-payment-url').value=c.subscription?.payment_url||'';
    $('#me-manual-price').value=c.subscription?.manual_price_cents==null?'':(Number(c.subscription.manual_price_cents)/100).toFixed(2).replace('.',',');
    $('#me-billing-notes').value=c.subscription?.billing_notes||'';
    const o=c.subscription?.limit_overrides||{}; $('#me-max-devices').value=numOrBlank(o.max_devices); $('#me-storage-mb').value=numOrBlank(o.storage_limit_mb); $('#me-max-users').value=numOrBlank(o.max_users); $('#me-max-campaigns').value=numOrBlank(o.max_campaigns);
    const settings=c.settings||{}; $('#me-player-audio').checked=settings.player_audio_enabled!==false; $('#me-player-autostart').checked=settings.player_autostart_enabled!==false;
    renderTrialAccess(c.subscription);
    formStatus('#me-branding-status');
    openDialog('master-company-dialog');
    loadMasterPlayerBranding(c.id).catch(e=>formStatus('#me-branding-status',`❌ ${e.message}`,'error'));
  }
  function overrideObj(){ const o={}; [['max_devices','#me-max-devices'],['storage_limit_mb','#me-storage-mb'],['max_users','#me-max-users'],['max_campaigns','#me-max-campaigns']].forEach(([k,s])=>{const v=$(s).value.trim();if(v!=='')o[k]=Number(v)}); return o; }
  async function saveCompany(ev){
    ev.preventDefault();const b=$('#me-save');const companyId=$('#me-company-id').value;const expectedPlanId=$('#me-plan').value;const paymentUrl=$('#me-payment-url').value.trim();const requestedStatus=$('#me-sub-status').value;const existing=companyById(companyId)?.subscription||null;const existingTrialEnd=existing?.trial_ends_at?new Date(existing.trial_ends_at).getTime():0;
    if(!expectedPlanId){formStatus('#me-status','❌ Selecione um plano.','error');return}if(paymentUrl&&!/^https:\/\/\S+$/i.test(paymentUrl)){formStatus('#me-status','❌ Informe um link de pagamento HTTPS válido.','error');$('#me-payment-url').focus();return}if(requestedStatus==='trialing'&&!(existing?.status==='trialing'&&existingTrialEnd>Date.now())){formStatus('#me-status','❌ Para usar “Teste”, escolha antes um período no bloco Acesso temporário / demonstração.','error');return}
    busy(b,true,'Salvando...');formStatus('#me-status','Salvando alterações...','pending');
    try{const d=await saveCompanyRequest(companyFormPayload());if(!d?.ok||d?.subscription?.plan_id!==expectedPlanId)throw new Error('O servidor não confirmou o plano selecionado.');await load();const persisted=companyById(companyId);if(persisted?.subscription?.plan_id!==expectedPlanId)throw new Error('O plano foi salvo, mas a confirmação do painel não corresponde.');renderTrialAccess(persisted?.subscription);const planName=d?.plan?.name||planById(expectedPlanId)?.name||'selecionado';formStatus('#me-status',`✅ Salvo com sucesso. Plano ${planName} aplicado.`,'success');toast('Salvo com sucesso',`Plano ${planName} e dados da assinatura atualizados.`)}catch(e){const raw=String(e?.message||'Erro ao salvar');const msg=/platform_storage_allocation_exceeded/i.test(raw)?'A soma dos limites de armazenamento dos clientes não pode ultrapassar 1.024 MB. Reduza o limite deste ou de outro cliente.':raw;formStatus('#me-status',`❌ ${msg}`,'error');toast('Erro ao salvar',msg,'error')}finally{busy(b,false)}
  }
  async function toggleCompany(id,next){
    const c=companyById(id);if(!c)return;if(!confirm(`${next==='suspended'?'Suspender':'Reativar'} a conta “${c.name}”?`))return;
    try{await master({action:'update_company',company_id:id,company_status:next,subscription_status:next==='suspended'?'suspended':'active'});toast(next==='suspended'?'Conta suspensa':'Conta reativada');await load()}catch(e){const raw=String(e?.message||'');if(/\.catch is not a function/i.test(raw)){try{await load();const persisted=companyById(id);const expectedSub=next==='suspended'?'suspended':'active';if(persisted?.status===next&&persisted?.subscription?.status===expectedSub){toast(next==='suspended'?'Conta suspensa':'Conta reativada','A alteração foi aplicada; apenas a auditoria do backend antigo falhou.');return}}catch{}}toast('Não foi possível alterar a conta',e.message,'error')}
  }
  function deviceAccessLabel(device){
    const stateName=device?.access_state||'permanent';
    if(stateName==='pending')return 'Aguardando autorização do Master';
    if(stateName==='blocked')return 'Bloqueada pelo Master';
    if(stateName==='expired')return 'Autorização expirada';
    if(stateName==='temporary')return `Autorizada até ${dt(device.access_expires_at)}`;
    return 'Permanente';
  }
  function renderMasterDeviceAccess(){
    const root=$('#master-device-access-list');
    if(!root)return;
    const devices=state.accessDevices||[];
    if(!devices.length){root.innerHTML='<div class="empty">Nenhuma TV vinculada a esta conta.</div>';return}
    root.innerHTML=devices.map(device=>{
      const current=deviceAccessLabel(device);
      const cls=['pending','blocked','expired'].includes(device.access_state)?device.access_state:'active';
      const dateValue=device.access_expires_at?String(device.access_expires_at).slice(0,10):'';
      return `<div class="device-access-row" data-device-access-row="${device.id}">
        <div class="device-access-info"><strong>${esc(device.name)}</strong><small>${esc(device.platform||'TV')} • ${device.last_seen_at?`último contato ${esc(dt(device.last_seen_at))}`:'sem contato recente'}</small><small>Player: ${esc(device.player_version||device.app_version||'—')} • APK: ${esc(device.apk_version||'—')} • Sync: ${device.last_sync_at?esc(dt(device.last_sync_at)):'—'}</small><small>Resolução: ${device.screen_width&&device.screen_height?`${device.screen_width}×${device.screen_height}`:'—'} • livre: ${device.storage_free_mb==null?'—':`${Math.round(Number(device.storage_free_mb))} MB`} • orientação: ${esc(device.orientation||'auto')} / ${esc(device.reported_orientation||'—')}</small><small>Último comando: ${device.latest_command?`${esc(device.latest_command.command_type)} • ${esc(device.latest_command.status==='sent'?'recebido':device.latest_command.status)}`:'nenhum'}</small><span class="access-current ${cls}">${esc(current)}</span></div>
        <label>Novo prazo<select data-access-mode="${device.id}"><option value="permanent">Permanente</option><option value="10_minutes">10 minutos (teste)</option><option value="7_days">7 dias</option><option value="30_days">30 dias</option><option value="90_days">90 dias</option><option value="date">Até uma data</option><option value="block">Bloquear agora</option></select></label>
        <label>Data específica<input data-access-date="${device.id}" type="date" value="${esc(dateValue)}" /></label>
        <div class="device-access-actions">
          <button class="small-button" type="button" data-save-device-access="${device.id}">Aplicar prazo</button>
          <button class="small-button" type="button" data-restart-master-device="${device.id}">↻ Reiniciar Player</button>
          <button class="small-button" type="button" data-master-device-command="sync_now" data-master-device-id="${device.id}">⟳ Sincronizar</button>
          <button class="small-button" type="button" data-master-device-command="reload_programming" data-master-device-id="${device.id}">▶ Recarregar</button>
          <button class="small-button" type="button" data-master-device-command="clear_cache" data-master-device-id="${device.id}">⌫ Limpar cache</button>
        </div>
      </div>`;
    }).join('');
  }
  async function openMasterDeviceAccess(companyId){
    const company=companyById(companyId); if(!company)return;
    formStatus('#mda-status');
    try{
      const data=await edgeRequest('master-company-devices',{action:'list',company_id:companyId});
      state.accessDevices=data?.devices||[];
      $('#mda-company-id').value=companyId;
      $('#mda-title').textContent=`Acesso das TVs • ${company.name}`;
      renderMasterDeviceAccess();
      openDialog('master-device-access-dialog');
    }catch(error){toast('Não foi possível carregar as TVs',error.message,'error')}
  }
  async function saveMasterDeviceAccess(button){
    const deviceId=button?.dataset?.saveDeviceAccess; if(!deviceId)return;
    const companyId=$('#mda-company-id').value;
    const mode=$(`[data-access-mode="${deviceId}"]`)?.value||'permanent';
    const date=$(`[data-access-date="${deviceId}"]`)?.value||'';
    let expiresAt=null;
    if(mode==='date'){
      if(!date){formStatus('#mda-status','❌ Escolha a data final da autorização.','error');return}
      expiresAt=new Date(`${date}T23:59:59-03:00`).toISOString();
      if(new Date(expiresAt).getTime()<=Date.now()){formStatus('#mda-status','❌ Escolha uma data futura.','error');return}
    }
    busy(button,true,'Aplicando...');
    formStatus('#mda-status','Salvando autorização da TV...','pending');
    try{
      await edgeRequest('master-company-devices',{action:'set_access',company_id:companyId,device_id:deviceId,mode,expires_at:expiresAt});
      const data=await edgeRequest('master-company-devices',{action:'list',company_id:companyId});
      state.accessDevices=data?.devices||[];
      renderMasterDeviceAccess();
      formStatus('#mda-status','✅ Autorização atualizada. A TV receberá a mudança automaticamente.','success');
      toast('Salvo com sucesso','Prazo de acesso da TV atualizado.');
    }catch(error){
      formStatus('#mda-status',`❌ ${error.message}`,'error');
      toast('Erro ao atualizar acesso da TV',error.message,'error');
    }finally{busy(button,false)}
  }

  async function runMasterDeviceCommand(button){
    const deviceId=button?.dataset?.masterDeviceId,action=button?.dataset?.masterDeviceCommand,companyId=$('#mda-company-id').value;
    if(!deviceId||!['sync_now','clear_cache','reload_programming'].includes(action)||!companyId)return;
    const device=(state.accessDevices||[]).find(item=>item.id===deviceId);if(!device)return;
    if(action==='clear_cache'&&!confirm(`Limpar o cache local de “${device.name}” e sincronizar novamente?`))return;
    busy(button,true,'Enviando...');
    try{
      const result=await edgeRequest('master-company-devices',{action,company_id:companyId,device_id:deviceId});
      formStatus('#mda-status',result?.duplicate?'✅ Esse comando já estava pendente.':'✅ Comando remoto enviado.','success');
      const data=await edgeRequest('master-company-devices',{action:'list',company_id:companyId});state.accessDevices=data?.devices||[];renderMasterDeviceAccess();
    }catch(error){formStatus('#mda-status',`❌ ${error.message}`,'error');toast('Erro no comando remoto',error.message,'error')}finally{busy(button,false)}
  }

  async function restartMasterDevice(button){
    const deviceId=button?.dataset?.restartMasterDevice;if(!deviceId)return;
    const companyId=$('#mda-company-id').value;
    const device=(state.accessDevices||[]).find(item=>item.id===deviceId);
    if(!companyId||!device)return;
    if(!confirm(`Reiniciar o Vision Player da TV “${device.name}”? A reprodução voltará automaticamente.`))return;
    busy(button,true,'Solicitando...');
    formStatus('#mda-status',`Enviando comando para ${device.name}...`,'pending');
    try{
      const result=await edgeRequest('master-company-devices',{action:'restart_player',company_id:companyId,device_id:deviceId});
      const duplicate=result?.duplicate===true;
      formStatus('#mda-status',duplicate?'✅ Já havia um reinício pendente para esta TV.':'✅ Reinício solicitado. A TV executará na próxima consulta do Player.','success');
      toast('Salvo com sucesso',duplicate?'O comando anterior continua aguardando a TV.':`Reinício remoto enviado para ${device.name}.`);
    }catch(error){
      formStatus('#mda-status',`❌ ${error.message}`,'error');
      toast('Erro ao reiniciar Player',error.message,'error');
    }finally{busy(button,false)}
  }

  async function openMasterReplaceDevice(companyId){
    const c=companyById(companyId); if(!c)return;
    formStatus('#mr-status');
    try{
      const d=await edgeRequest('master-company-devices',{company_id:companyId});
      const devices=d?.devices||[];
      if(!devices.length){toast('Nenhuma TV ativa','Este cliente não possui TV disponível para substituição.','error');return}
      state.replaceDevices=devices;
      $('#mr-company-id').value=companyId;
      $('#mr-title').textContent=`Substituir TV • ${c.name}`;
      $('#mr-old-device').innerHTML=devices.map(x=>`<option value="${x.id}">${esc(x.name)} • ${esc(x.platform||'TV')}</option>`).join('');
      const first=devices[0]; $('#mr-name').value=first.name; $('#mr-orientation').value=first.orientation||'auto'; $('#mr-code').value='';
      $('#mr-plan-slot').textContent=`TVs ativas: ${devices.length}${d.max_devices==null?'':` / ${d.max_devices}`} • a substituição mantém a mesma quantidade.`;
      openDialog('master-replace-device-dialog');
      setTimeout(()=>$('#mr-code')?.focus(),50);
    }catch(e){toast('Não foi possível carregar as TVs',e.message,'error')}
  }
  function syncMasterReplacementDevice(){const d=state.replaceDevices.find(x=>x.id===$('#mr-old-device').value);if(!d)return;$('#mr-name').value=d.name;$('#mr-orientation').value=d.orientation||'auto'}
  async function replaceMasterDevice(ev){
    ev.preventDefault(); const b=$('#mr-save'); const code=$('#mr-code').value.replace(/\D/g,''); const oldId=$('#mr-old-device').value; const name=$('#mr-name').value.trim();
    if(!oldId||code.length!==6||!name){formStatus('#mr-status','❌ Informe a TV atual, o código de 6 dígitos e o nome da nova TV.','error');return}
    busy(b,true,'Substituindo...'); formStatus('#mr-status','Substituindo TV...','pending');
    try{await edgeRequest('replace-device',{company_id:$('#mr-company-id').value,old_device_id:oldId,code,name,orientation:$('#mr-orientation').value});formStatus('#mr-status','✅ TV substituída com sucesso.','success');toast('TV substituída','A vaga do plano e a programação foram preservadas.');await load();setTimeout(()=>closeDialog('master-replace-device-dialog'),700)}catch(e){formStatus('#mr-status',`❌ ${e.message}`,'error');toast('Erro ao substituir TV',e.message,'error')}finally{busy(b,false)}
  }
  function openUsers(id){const c=companyById(id);if(!c)return;state.selectedCompanyId=id;$('#mu-company-id').value=id;$('#mu-company-title').textContent=`Usuários • ${c.name}`;renderUsers(c);$('#master-add-user-form').reset();openDialog('master-users-dialog')}
  function renderUsers(c){$('#master-users-list').innerHTML=c.members.map(m=>`<div class="user-row"><div><strong>${esc(m.user?.display_name||m.user?.email||'Usuário')}</strong><small>${esc(m.user?.email||'')} • ${m.role==='owner'?'Proprietário':m.role} • ${m.status}</small></div>${m.role==='owner'?'<span class="status active">Protegido</span>':`<button class="small-button" data-toggle-member="${m.id}" data-next-member="${m.status==='active'?'disabled':'active'}">${m.status==='active'?'Desativar':'Ativar'}</button>`}${state.role==='super_admin'?`<button class="small-button" data-reset-user="${m.user_id}">Nova senha</button>`:''}</div>`).join('')}
  async function addUser(ev){ev.preventDefault();const b=$('#mu-add');busy(b,true,'Adicionando...');try{const d=await master({action:'add_user',company_id:$('#mu-company-id').value,email:$('#mu-email').value.trim(),display_name:$('#mu-name').value.trim(),role:$('#mu-role').value,temporary_password:$('#mu-password').value});toast('Usuário adicionado',d.delivery==='invite'?'Convite enviado.':d.delivery==='temporary_password'?'Senha temporária criada.':'Usuário existente vinculado.');await load();openUsers($('#mu-company-id').value)}catch(e){toast('Erro ao adicionar usuário',e.message,'error')}finally{busy(b,false)}}
  async function toggleMember(id,status){try{await master({action:'update_member',member_id:id,status});toast('Usuário atualizado');const cid=$('#mu-company-id').value;await load();openUsers(cid)}catch(e){toast('Erro ao atualizar usuário',e.message,'error')}}
  async function resetUser(id){
    const email=emailForUserId(id);
    if(!email){toast('E-mail não encontrado','Atualize a lista de clientes e tente novamente.','error');return false}
    if(!confirm(`Enviar um link de redefinição de senha para ${email}?`))return false;
    try{
      const result=await sendPasswordRecovery(email);
      if(result?.delivery==='manual'&&result?.action_link){
        let copied=false;
        try{
          await navigator.clipboard.writeText(result.action_link);
          copied=true;
        }catch{}
        if(!copied)window.prompt('O Resend está em modo temporário. Copie este link seguro e envie ao cliente:',result.action_link);
        toast(
          'Link seguro gerado',
          copied
            ? 'O Resend ainda está em modo temporário; o link de redefinição foi copiado para você enviar ao cliente.'
            : 'O Resend ainda está em modo temporário; envie o link seguro mostrado ao cliente.',
          'success'
        );
        return true;
      }
      toast('Redefinição enviada',`O e-mail personalizado da Vision Mídia Digital foi enviado para ${email}.`);
      return true;
    }catch(e){
      toast('Erro ao enviar redefinição',e.message||'Não foi possível enviar o link.','error');
      return false;
    }
  }
  async function resetCompanyOwnerPassword(){
    const id=$('#me-owner-user-id')?.value||'';
    if(!id){toast('Responsável não encontrado','Atualize a lista de clientes e tente novamente.','error');return}
    const button=$('#me-reset-owner-password');
    busy(button,true,'Enviando...');
    try{await resetUser(id)}finally{busy(button,false)}
  }
  function planStatus(message='',type=''){formStatus('#mp-status',message,type)}
  function planIntOrNull(selector){const v=$(selector).value.trim();return v===''?null:Number(v)}
  function friendlyPlanError(error){const m=String(error?.message||'Erro desconhecido');if(/super_admin_required/i.test(m))return 'Sua sessão não tem permissão de Super Master.';if(/plan_slug_already_exists|plans_slug_key|duplicate key.*slug/i.test(m))return 'Já existe um plano com esse slug.';if(/invalid_plan_slug/i.test(m))return 'O slug deve usar apenas letras minúsculas, números e hífen.';if(/invalid_plan_name/i.test(m))return 'Informe um nome de plano válido.';if(/invalid_plan_price/i.test(m))return 'Informe um preço mensal válido.';if(/plan_not_found/i.test(m))return 'Este plano não foi encontrado. Atualize a página e tente novamente.';if(/plan_save_failed|plan_save_unexpected_error/i.test(m))return 'Não foi possível salvar o plano no servidor. Tente novamente.';return m}
  function openPlan(id=null){ if(state.role!=='super_admin'){toast('Somente o Super Master pode editar planos.','','error');return} const p=id?planById(id):null; $('#master-plan-form').reset(); planStatus(); $('#mp-id').value=p?.id||''; $('#mp-title').textContent=p?'Editar plano':'Novo plano'; $('#mp-name').value=p?.name||''; $('#mp-slug').value=p?.slug||''; $('#mp-description').value=p?.description||''; $('#mp-price').value=p?(p.monthly_price_cents/100).toFixed(2).replace('.',','):''; $('#mp-order').value=p?.sort_order||0; $('#mp-devices').value=numOrBlank(p?.max_devices); $('#mp-storage').value=numOrBlank(p?.storage_limit_mb); $('#mp-users').value=numOrBlank(p?.max_users); $('#mp-campaigns').value=numOrBlank(p?.max_campaigns); $('#mp-active').checked=p?.is_active!==false; openDialog('master-plan-dialog'); }
  function validatePlanForm(){
    const required=[['#mp-name','Nome'],['#mp-slug','Slug'],['#mp-description','Descrição'],['#mp-price','Preço mensal'],['#mp-order','Ordem'],['#mp-devices','TVs'],['#mp-storage','Armazenamento MB'],['#mp-users','Usuários'],['#mp-campaigns','Campanhas']];
    const missing=required.filter(([selector])=>String($(selector)?.value??'').trim()==='');
    if(missing.length){planStatus(`❌ Preencha todos os campos obrigatórios. Falta: ${missing.map(([,label])=>label).join(', ')}.`,'error');$(missing[0][0])?.focus();return null}
    const name=$('#mp-name').value.trim(),slug=$('#mp-slug').value.trim(),description=$('#mp-description').value.trim();
    const price=reaisToCents($('#mp-price').value),sortOrder=Number($('#mp-order').value),maxDevices=Number($('#mp-devices').value),storageMb=Number($('#mp-storage').value),maxUsers=Number($('#mp-users').value),maxCampaigns=Number($('#mp-campaigns').value);
    if(name.length<2){planStatus('❌ Informe um nome de plano válido.','error');$('#mp-name').focus();return null}
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)){planStatus('❌ O slug deve usar apenas letras minúsculas, números e hífen.','error');$('#mp-slug').focus();return null}
    if(description.length<2){planStatus('❌ Preencha a descrição do plano.','error');$('#mp-description').focus();return null}
    if(price===null||price<0){planStatus('❌ Informe um preço mensal válido.','error');$('#mp-price').focus();return null}
    if(!Number.isInteger(sortOrder)||sortOrder<0){planStatus('❌ Informe uma ordem válida.','error');$('#mp-order').focus();return null}
    if(!Number.isInteger(maxDevices)||maxDevices<0){planStatus('❌ Informe a quantidade de TVs.','error');$('#mp-devices').focus();return null}
    if(!Number.isInteger(storageMb)||storageMb<0){planStatus('❌ Informe o armazenamento em MB.','error');$('#mp-storage').focus();return null}
    if(!Number.isInteger(maxUsers)||maxUsers<1){planStatus('❌ O plano deve permitir pelo menos 1 usuário.','error');$('#mp-users').focus();return null}
    if(!Number.isInteger(maxCampaigns)||maxCampaigns<0){planStatus('❌ Informe a quantidade de campanhas.','error');$('#mp-campaigns').focus();return null}
    return {id:$('#mp-id').value||null,name,slug,description,monthly_price_cents:price,max_devices:maxDevices,storage_limit_mb:storageMb,max_users:maxUsers,max_campaigns:maxCampaigns,is_active:$('#mp-active').checked,sort_order:sortOrder};
  }
  async function savePlan(ev){
    ev.preventDefault();
    const payload=validatePlanForm();
    if(!payload)return;
    const b=$('#mp-save');
    busy(b,true,'Salvando...');
    planStatus('Salvando...','pending');
    try{
      const result=await savePlanRequest(payload);
      if(!result?.ok||!result?.plan?.id)throw new Error('O servidor não confirmou o salvamento do plano.');
      $('#mp-id').value=result.plan.id;
      $('#mp-title').textContent='Editar plano';
      planStatus('✅ Salvo com sucesso. As alterações foram aplicadas.','success');
      toast('Salvo com sucesso',`Plano ${result.plan.name||payload.name} atualizado.`);
      await load().catch(e=>toast('Plano salvo, mas a lista não atualizou',e.message,'error'));
    }catch(e){
      const msg=friendlyPlanError(e);
      planStatus(`❌ Erro ao salvar: ${msg}`,'error');
      toast('Erro ao salvar plano',msg,'error');
    }finally{busy(b,false)}
  }


  async function savePlatformSettings(ev){
    ev.preventDefault(); const b=$('#ps-save'); busy(b,true,'Salvando...'); formStatus('#ps-status','Salvando...','pending');
    try{const d=await platformSettingsRequest({action:'update',support_whatsapp:$('#ps-whatsapp').value,signup_whatsapp_message:$('#ps-signup-message').value.trim(),renewal_whatsapp_message:$('#ps-renewal-message').value.trim(),signup_enabled:$('#ps-signup-enabled').checked});state.platformConfig=d.config||{};renderPlatformSettings();formStatus('#ps-status','✅ Configurações salvas.','success');toast('Salvo com sucesso','Cadastro público e WhatsApp atualizados.')}catch(e){formStatus('#ps-status',`❌ ${e.message}`,'error');toast('Erro ao salvar configurações',e.message,'error')}finally{busy(b,false)}
  }

  async function saveEmailProviderSettings(ev){
    ev.preventDefault();
    const b=$('#ps-resend-save');
    busy(b,true,'Validando...');
    formStatus('#ps-resend-status','Validando chave, remetente e domínio no Resend…','pending');
    try{
      const result=await platformSettingsRequest({
        action:'save_email_provider',
        resend_api_key:$('#ps-resend-key').value.trim(),
        sender_name:$('#ps-resend-name').value.trim(),
        sender_email:$('#ps-resend-sender').value.trim(),
        enabled:$('#ps-resend-enabled').checked,
      });
      state.platformConfig=result?.config||state.platformConfig||{};
      state.emailProviderStatus={
        api_key_configured:result?.provider?.api_key_configured!==false,
        domains:result?.provider?.domains||[],
      };
      renderEmailProviderSettings();
      formStatus('#ps-resend-status','✅ Resend validado e configurações salvas.','success');
      toast('Salvo com sucesso','Recuperação de senha por Resend atualizada.');
    }catch(e){
      const raw=String(e?.message||e||'');
      let msg=raw;
      if(/resend_sender_domain_not_verified/i.test(raw))msg='O domínio do e-mail remetente ainda não está verificado no Resend.';
      else if(/invalid_resend_api_key/i.test(raw))msg='A chave API informada não é válida.';
      else if(/sender_email_required/i.test(raw))msg='Informe o e-mail remetente.';
      else if(/invalid_sender_email/i.test(raw))msg='Informe um e-mail remetente válido.';
      formStatus('#ps-resend-status',`❌ ${msg}`,'error');
      toast('Erro ao configurar Resend',msg,'error');
      state.emailProviderStatus=await platformSettingsRequest({action:'email_provider_status'}).catch(()=>state.emailProviderStatus);
      renderEmailProviderSettings();
    }finally{busy(b,false)}
  }

  function confirmPaymentAndRelease(){
    if(!$('#me-due-date').value){formStatus('#me-status','❌ Informe o vencimento antes de liberar o acesso.','error');$('#me-due-date').focus();return}
    $('#me-company-status').value='active';
    $('#me-sub-status').value='active';
    $('#me-payment-status').value='paid';
    formStatus('#me-status','Pagamento marcado como pago. Salvando e liberando acesso...','pending');
    $('#master-company-form').requestSubmit();
  }

  async function clearCompanyCache(){
    const id=$('#me-company-id').value; if(!id)return;
    const b=$('#me-clear-cache'); busy(b,true,'Solicitando...');
    try{await saveCompanyRequest({company_id:id,company_name:$('#me-company-name').value.trim(),company_status:$('#me-company-status').value,plan_id:$('#me-plan').value,subscription_status:$('#me-sub-status').value,payment_status:$('#me-payment-status').value,due_date:$('#me-due-date').value||null,manual_price_cents:reaisToCents($('#me-manual-price').value),limit_overrides:overrideObj(),billing_notes:$('#me-billing-notes').value.trim(),player_audio_enabled:$('#me-player-audio').checked,player_autostart_enabled:$('#me-player-autostart').checked,clear_cache:true});formStatus('#me-status','✅ Limpeza de cache enviada. As TVs baixarão novamente as mídias na próxima sincronização.','success');toast('Comando enviado','Cache da conta será renovado.');await load()}catch(e){formStatus('#me-status',`❌ ${e.message}`,'error');toast('Erro ao enviar comando',e.message,'error')}finally{busy(b,false)}
  }
  function bind(){ document.addEventListener('click',ev=>trackActionButton(ev.target.closest('button')),true); document.addEventListener('submit',ev=>trackActionButton(ev.submitter),true); $('#master-login-form').addEventListener('submit',login); $('#master-logout').addEventListener('click',logout); $('#master-denied-logout').addEventListener('click',logout); $('#master-refresh').addEventListener('click',()=>load().catch(()=>{})); $$('[data-master-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.masterView))); $$('[data-go-master]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.goMaster))); $$('[data-open-client]').forEach(b=>b.addEventListener('click',openNewClient)); $('#open-plan-button').addEventListener('click',()=>openPlan()); $('#master-client-form').addEventListener('submit',createClient); $('#master-company-form').addEventListener('submit',saveCompany); $('#master-add-user-form').addEventListener('submit',addUser); $('#master-plan-form').addEventListener('submit',savePlan); $('#master-replace-device-form').addEventListener('submit',replaceMasterDevice); $('#mr-old-device').addEventListener('change',syncMasterReplacementDevice); $('#platform-settings-form').addEventListener('submit',savePlatformSettings); $('#email-provider-form')?.addEventListener('submit',saveEmailProviderSettings); $('#master-notification-form')?.addEventListener('submit',sendMasterNotification); $('#mn-fill-expiry')?.addEventListener('click',fillExpiryNotification); $('#master-expiry-enable')?.addEventListener('click',enableMasterExpiryNotifications); $('#login-visual-form')?.addEventListener('submit',saveLoginVisualPreview); $('#lv-file')?.addEventListener('change',handleLoginVisualFile); $('#lv-remove')?.addEventListener('click',removeLoginVisualImage); $('#me-branding-file')?.addEventListener('change',handleMasterPlayerBrandingFile); $('#me-branding-remove')?.addEventListener('click',removeMasterPlayerBrandingImage); $('#me-branding-save')?.addEventListener('click',saveMasterPlayerBranding); ['#me-branding-title','#me-branding-message'].forEach(selector=>$(selector)?.addEventListener('input',syncMasterPlayerBrandingDraft)); ['#lv-fit','#lv-position','#lv-title','#lv-subtitle'].forEach(selector=>$(selector)?.addEventListener('input',()=>{collectLoginVisualDraft();updateLoginVisualMasterPreview()})); $('#lv-overlay')?.addEventListener('input',()=>{const value=Number($('#lv-overlay').value||42);$('#lv-overlay-value').textContent=`${value}%`;collectLoginVisualDraft();updateLoginVisualMasterPreview()}); $('#me-clear-cache').addEventListener('click',clearCompanyCache); $('#me-mark-paid').addEventListener('click',confirmPaymentAndRelease); $('#me-reset-owner-password')?.addEventListener('click',resetCompanyOwnerPassword); $('#master-client-search').addEventListener('input',renderClients); $('#master-client-filter').addEventListener('change',renderClients); $$('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog(b.dataset.close))); document.addEventListener('click',ev=>{const b=ev.target.closest('button');if(!b)return;if(b.dataset.manageCompany)openCompany(b.dataset.manageCompany);if(b.dataset.companyUsers)openUsers(b.dataset.companyUsers);if(b.dataset.deviceAccessCompany)openMasterDeviceAccess(b.dataset.deviceAccessCompany);if(b.dataset.saveDeviceAccess)saveMasterDeviceAccess(b);if(b.dataset.restartMasterDevice)restartMasterDevice(b);if(b.dataset.masterDeviceCommand)runMasterDeviceCommand(b);if(b.dataset.replaceCompanyDevice)openMasterReplaceDevice(b.dataset.replaceCompanyDevice);if(b.dataset.toggleCompany)toggleCompany(b.dataset.toggleCompany,b.dataset.nextStatus);if(b.dataset.editPlan)openPlan(b.dataset.editPlan);if(b.dataset.toggleMember)toggleMember(b.dataset.toggleMember,b.dataset.nextMember);if(b.dataset.resetUser)resetUser(b.dataset.resetUser)}); window.addEventListener('online',()=>setConn(true)); window.addEventListener('offline',()=>setConn(false)); }

  async function boot(){ bind(); if(!CONFIG?.supabaseUrl||!CONFIG?.supabasePublishableKey){show('master-denied');return} const s=savedSession(); if(!s){show('master-auth');return} saveSession(s); try{await enter()}catch(e){saveSession(null);show('master-auth');toast('Sessão expirada','Entre novamente.','error')} }
  boot();
})();
