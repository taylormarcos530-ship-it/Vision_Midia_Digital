from pathlib import Path
import re

ROOT = Path('.')

def read(path): return (ROOT/path).read_text(encoding='utf-8')
def write(path, text): (ROOT/path).write_text(text, encoding='utf-8')
def rep(text, old, new, label):
    if old not in text:
        raise SystemExit(f'MISSING EXACT: {label}')
    return text.replace(old, new, 1)
def sub(text, pattern, repl, label, flags=0):
    out, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'MISSING REGEX {label}: {n}')
    return out

# ---------- index.html ----------
p = Path('index.html'); s = read(p)
s = rep(s,
'''        <label>Nome
          <input id="signup-name" type="text" autocomplete="name" minlength="2" required placeholder="Seu nome" />
        </label>
        <label>E-mail''',
'''        <label>Nome
          <input id="signup-name" type="text" autocomplete="name" minlength="2" required placeholder="Seu nome" />
        </label>
        <label>Empresa
          <input id="signup-company" type="text" minlength="2" maxlength="120" required placeholder="Ex.: Mercado Central" />
        </label>
        <label>Plano de interesse
          <select id="signup-plan" required><option value="">Carregando planos...</option></select>
        </label>
        <label>E-mail''', 'signup company/plan')
s = s.replace('A conta é liberada imediatamente após o cadastro.', 'Após o cadastro, sua conta ficará aguardando aprovação do administrador. Você poderá falar com o suporte pelo WhatsApp.')
access = '''
  <section id="access-screen" class="center-screen hidden">
    <div class="onboarding-card access-card">
      <div class="brand-mark large">V</div>
      <span class="eyebrow" id="access-kicker">ACESSO</span>
      <h2 id="access-title">Aguardando aprovação</h2>
      <p id="access-message">Seu cadastro foi recebido e está aguardando liberação.</p>
      <div class="access-summary">
        <div><span>Empresa</span><strong id="access-company">—</strong></div>
        <div><span>Plano</span><strong id="access-plan">—</strong></div>
        <div><span>Vencimento</span><strong id="access-due">—</strong></div>
      </div>
      <div class="access-actions">
        <a id="access-whatsapp" class="button primary full hidden" href="#" target="_blank" rel="noopener">Falar com suporte no WhatsApp</a>
        <button id="access-refresh" class="button ghost full" type="button">Verificar liberação</button>
        <button id="access-notifications" class="button ghost full" type="button">Ativar notificações</button>
        <button id="access-logout" class="link-button" type="button">Sair desta conta</button>
      </div>
      <p class="form-hint">Quando o administrador liberar seu plano, basta tocar em “Verificar liberação”.</p>
    </div>
  </section>

'''
s = rep(s, '  <section id="onboarding-screen" class="center-screen hidden">', access + '  <section id="onboarding-screen" class="center-screen hidden">', 'access screen')
write(p,s)

# ---------- app.js ----------
p=Path('app.js'); s=read(p)
s = rep(s, '    company: null,\n    devices:', '    company: null,\n    subscription: null,\n    publicConfig: null,\n    devices:', 'app state')
helper = r'''
  function formatPlanMoney(cents) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
  }

  async function loadPublicConfig() {
    const data = await functionRequest('public-config', { authenticated: false, body: {} });
    state.publicConfig = data || { config: {}, plans: [] };
    const select = $('#signup-plan');
    if (select) {
      const plans = state.publicConfig.plans || [];
      select.innerHTML = plans.length
        ? '<option value="">Selecione um plano</option>' + plans.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} • ${escapeHtml(formatPlanMoney(p.monthly_price_cents))}/mês</option>`).join('')
        : '<option value="">Nenhum plano disponível</option>';
    }
    return state.publicConfig;
  }

  function accessReason(subscription = state.subscription) {
    if (!subscription) return { key: 'pending', title: 'Aguardando aprovação', message: 'Seu cadastro ainda não possui uma assinatura liberada.' };
    const now = Date.now();
    const status = subscription.status;
    if (status === 'pending_approval') return { key: 'pending', title: 'Aguardando aprovação', message: 'Seu cadastro foi recebido. O administrador precisa definir o plano, vencimento e liberar o acesso.' };
    if (status === 'past_due') return { key: 'renewal', title: 'Pagamento pendente', message: 'Sua assinatura está com pagamento pendente. Regularize para voltar a usar o painel.' };
    if (status === 'suspended') return { key: 'renewal', title: 'Acesso suspenso', message: 'Sua assinatura está suspensa. Fale com o suporte para regularizar.' };
    if (status === 'cancelled') return { key: 'renewal', title: 'Assinatura cancelada', message: 'Esta assinatura foi cancelada. Fale com o suporte para reativar.' };
    if (status === 'trialing' && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() <= now) return { key: 'renewal', title: 'Período de teste encerrado', message: 'Seu período de teste terminou. Escolha um plano para continuar.' };
    if (status === 'active') {
      if (!['paid','waived'].includes(subscription.payment_status || 'pending')) return { key: 'renewal', title: 'Aguardando pagamento', message: 'O plano foi definido, mas o pagamento ainda não foi liberado.' };
      if (subscription.current_period_end && new Date(subscription.current_period_end).getTime() <= now) return { key: 'renewal', title: 'Assinatura vencida', message: 'Sua assinatura venceu. Regularize o pagamento para reativar o acesso.' };
    }
    if (state.company?.status === 'suspended') return { key: 'renewal', title: 'Acesso suspenso', message: 'Esta empresa está suspensa pelo administrador.' };
    return null;
  }

  function formatAccessDate(value) {
    if (!value) return 'Não definido';
    try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value)); }
    catch { return '—'; }
  }

  function renderAccessScreen(reason = accessReason()) {
    reason = reason || { key:'pending', title:'Aguardando aprovação', message:'Aguarde a liberação do administrador.' };
    $('#access-title').textContent = reason.title;
    $('#access-message').textContent = reason.message;
    $('#access-company').textContent = state.company?.name || 'Cadastro ainda não vinculado';
    const plan = (state.publicConfig?.plans || []).find(p => p.id === state.subscription?.plan_id);
    $('#access-plan').textContent = plan?.name || 'A definir';
    $('#access-due').textContent = formatAccessDate(state.subscription?.current_period_end);
    const cfg = state.publicConfig?.config || {};
    const phone = String(cfg.support_whatsapp || '').replace(/\D/g, '');
    const message = reason.key === 'renewal' ? cfg.renewal_whatsapp_message : cfg.signup_whatsapp_message;
    const link = $('#access-whatsapp');
    if (phone) {
      link.href = `https://wa.me/${phone}?text=${encodeURIComponent(message || 'Olá! Preciso de ajuda com meu acesso à Vision Mídia Digital.')}`;
      link.classList.remove('hidden');
    } else link.classList.add('hidden');
    if (Notification?.permission === 'granted') notifyAccessState(reason);
  }

  async function notifyAccessState(reason) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const key = `vision_access_notice_${reason.key}_${state.subscription?.updated_at || ''}`;
    if (localStorage.getItem(key)) return;
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg?.showNotification) await reg.showNotification(`Vision Mídia Digital • ${reason.title}`, { body: reason.message, icon: './icon.svg', tag: `vision-${reason.key}` });
      else new Notification(`Vision Mídia Digital • ${reason.title}`, { body: reason.message });
      localStorage.setItem(key, '1');
    } catch {}
  }

  async function enableAccessNotifications() {
    if (!('Notification' in window)) return toast('Notificações indisponíveis', 'Este navegador não oferece suporte.', 'error');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return toast('Notificações não ativadas', 'Permita notificações nas configurações do site.', 'error');
    toast('Notificações ativadas', 'Você verá avisos do acesso quando o app estiver sincronizando.');
    const reason = accessReason(); if (reason) notifyAccessState(reason);
  }

'''
s = rep(s, '  function showScreen(name) {', helper + '  function showScreen(name) {', 'insert access helpers')
s = rep(s,
'''  function showScreen(name) {
    $('#auth-screen').classList.toggle('hidden', name !== 'auth');
    $('#onboarding-screen').classList.toggle('hidden', name !== 'onboarding');
    $('#app-shell').classList.toggle('hidden', name !== 'app');
  }''',
'''  function showScreen(name) {
    $('#auth-screen').classList.toggle('hidden', name !== 'auth');
    $('#access-screen').classList.toggle('hidden', name !== 'access');
    $('#onboarding-screen').classList.toggle('hidden', name !== 'onboarding');
    $('#app-shell').classList.toggle('hidden', name !== 'app');
  }''', 'showScreen')
s = rep(s, '    bindEvents();\n    updateConnectionStatus();', '    bindEvents();\n    await loadPublicConfig().catch(() => null);\n    updateConnectionStatus();', 'bootstrap public config')
s = s.replace("if (state.company?.id && !document.hidden) loadAllData().catch(() => updateConnectionStatus(false));", "if (state.company?.id && !document.hidden && !$('#app-shell').classList.contains('hidden')) loadAllData().catch(() => updateConnectionStatus(false));")
new_enter = '''  async function enterAuthenticatedApp() {
    state.companies = await restRequest('companies', {
      query: 'select=id,name,slug,status,timezone,owner_user_id,created_at,settings&order=created_at.asc',
    }) || [];

    if (!state.companies.length) {
      state.company = null;
      state.subscription = null;
      showScreen('access');
      renderAccessScreen({ key:'pending', title:'Cadastro aguardando vínculo', message:'Sua conta existe, mas ainda não está vinculada a uma empresa liberada. Fale com o suporte.' });
      return;
    }

    const savedCompanyId = localStorage.getItem(COMPANY_KEY);
    state.company = state.companies.find(c => c.id === savedCompanyId) || state.companies[0];
    localStorage.setItem(COMPANY_KEY, state.company.id);
    const rows = await restRequest('company_subscriptions', {
      query: `select=*&company_id=eq.${encodeURIComponent(state.company.id)}&limit=1`,
    });
    state.subscription = rows?.[0] || null;
    const reason = accessReason(state.subscription);
    if (reason) {
      showScreen('access');
      renderAccessScreen(reason);
      return;
    }
    showScreen('app');
    renderIdentity();
    await loadAllData();
    setView(state.activeView);
  }

'''
s = sub(s, r"  async function enterAuthenticatedApp\(\) \{.*?\n  async function loadAllData\(\) \{", new_enter + '  async function loadAllData() {', 'enterAuthenticatedApp', re.S)
new_signup = '''  async function handleSignup(event) {
    event.preventDefault();
    const button = $('#signup-submit');
    const email = $('#signup-email').value.trim();
    const password = $('#signup-password').value;
    const displayName = $('#signup-name').value.trim();
    const companyName = $('#signup-company').value.trim();
    const planId = $('#signup-plan').value;
    if (!companyName || !planId) return toast('Complete o cadastro', 'Informe a empresa e selecione o plano de interesse.', 'error');
    setBusy(button, true, 'Criando cadastro...');
    try {
      await functionRequest('public-signup-v2', { authenticated:false, body:{ email, password, display_name:displayName, company_name:companyName, plan_id:planId } });
      const data = await authRequest('/token?grant_type=password', { body:{ email, password } });
      saveSession(data);
      await loadPublicConfig().catch(() => null);
      await enterAuthenticatedApp();
      toast('Cadastro recebido', 'Seu acesso está aguardando aprovação do administrador.');
    } catch (error) {
      const code = String(error?.message || '');
      const friendly = /email_already_registered/i.test(code) ? 'Este e-mail já está cadastrado.'
        : /platform_client_limit_reached/i.test(code) ? 'No momento não há novas vagas de clientes nesta infraestrutura.'
        : /plan_not_available/i.test(code) ? 'O plano selecionado não está mais disponível.'
        : /signup_rate_limited/i.test(code) ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
        : friendlyAuthError(error);
      toast('Não foi possível criar o cadastro', friendly, 'error');
    } finally { setBusy(button, false); }
  }

'''
s = sub(s, r"  async function handleSignup\(event\) \{.*?\n  async function handleForgotPassword", new_signup + '  async function handleForgotPassword', 'handleSignup', re.S)
s = rep(s, "    $('#company-form').addEventListener('submit', handleCreateCompany);", "    $('#company-form').addEventListener('submit', handleCreateCompany);\n    $('#access-refresh').addEventListener('click', () => enterAuthenticatedApp().catch(error => toast('Falha ao verificar acesso', error.message, 'error')));\n    $('#access-logout').addEventListener('click', logout);\n    $('#access-notifications').addEventListener('click', enableAccessNotifications);", 'access events')
s = s.replace('data-edit-item-schedule="${item.id}">◷</button>', 'data-edit-item-schedule="${item.id}">◷ Programar</button>')
write(p,s)

# ---------- styles.css ----------
p=Path('styles.css'); s=read(p)
s += '''

/* SaaS approval + compact scheduling */
.access-card{max-width:560px;text-align:center}.access-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.access-summary>div{padding:12px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.025);display:flex;flex-direction:column;gap:4px}.access-summary span{font-size:.78rem;color:var(--muted)}.access-summary strong{font-size:.92rem}.access-actions{display:grid;gap:10px}.playlist-inline-actions [data-edit-item-schedule]{min-width:98px}.schedule-chip.active{white-space:normal;line-height:1.25}.playlist-item-row{cursor:grab}.playlist-item-row.dragging{opacity:.55;transform:scale(.995)}
@media(max-width:640px){.access-summary{grid-template-columns:1fr}.playlist-inline-actions{display:flex;flex-wrap:wrap;gap:6px}.playlist-inline-actions [data-edit-item-schedule]{flex:1 1 120px}.playlist-item-row{align-items:flex-start}}
'''
write(p,s)

# ---------- master.html ----------
p=Path('master.html'); s=read(p)
s = s.replace('<option value="active">Ativos</option><option value="suspended">Suspensos</option>', '<option value="active">Ativos</option><option value="pending_approval">Aguardando aprovação</option><option value="past_due">Pagamento pendente</option><option value="overdue">Vencidos</option><option value="suspended">Suspensos</option>')
settings_panel = '''
          <article class="panel platform-settings-panel">
            <div class="panel-head"><div><small>COMERCIAL</small><h3>Cadastro público e WhatsApp</h3></div></div>
            <form id="platform-settings-form" class="stack">
              <label>WhatsApp do suporte <input id="ps-whatsapp" inputmode="tel" placeholder="Ex.: 5562999999999" /></label>
              <label>Mensagem após cadastro <textarea id="ps-signup-message" rows="2" maxlength="500"></textarea></label>
              <label>Mensagem de renovação <textarea id="ps-renewal-message" rows="2" maxlength="500"></textarea></label>
              <label class="switch-line"><input id="ps-signup-enabled" type="checkbox" checked /> Permitir novos cadastros públicos</label>
              <div id="ps-status" class="form-status hidden" role="status" aria-live="polite"></div>
              <button id="ps-save" class="button primary" type="submit">Salvar configurações</button>
            </form>
          </article>
'''
s = rep(s, '          </div>\n        </section>\n\n        <section id="master-view-clients"', '          </div>\n' + settings_panel + '        </section>\n\n        <section id="master-view-clients"', 'platform settings panel')
s = rep(s,
'''      <div class="form-grid two"><label>Plano<select id="me-plan"></select></label><label>Status da assinatura<select id="me-sub-status"><option value="trialing">Teste</option><option value="active">Ativa</option><option value="past_due">Pagamento pendente</option><option value="suspended">Suspensa</option><option value="cancelled">Cancelada</option></select></label></div>''',
'''      <div class="form-grid two"><label>Plano<select id="me-plan"></select></label><label>Status da assinatura<select id="me-sub-status"><option value="pending_approval">Aguardando aprovação</option><option value="trialing">Teste</option><option value="active">Ativa</option><option value="past_due">Pagamento pendente</option><option value="suspended">Suspensa</option><option value="cancelled">Cancelada</option></select></label></div>
      <div class="form-grid two"><label>Situação do pagamento<select id="me-payment-status"><option value="pending">Pendente</option><option value="paid">Pago</option><option value="overdue">Vencido</option><option value="waived">Liberado manualmente</option></select></label><label>Vencimento<input id="me-due-date" type="date" /></label></div>''', 'billing fields')
player_box = '''      <div class="limit-box"><strong>Controles do Player desta conta</strong><div class="form-grid two"><label class="switch-line"><input id="me-player-audio" type="checkbox" checked /> Áudio da TV ativado</label><label class="switch-line"><input id="me-player-autostart" type="checkbox" checked /> Iniciar Player ao ligar o TV Box</label></div><div class="dialog-actions compact-actions"><button id="me-clear-cache" class="button ghost" type="button">Limpar cache das TVs</button></div><small>Limpar cache aumenta a revisão da conta; na próxima sincronização os Players baixam novamente as mídias.</small></div>
'''
s = rep(s, '      <div class="danger-note">Suspender a empresa ou assinatura bloqueia novas operações e o player deixa de receber conteúdo.</div>', player_box + '      <div class="danger-note">Aguardando aprovação, pagamento vencido, suspensão ou cancelamento bloqueiam o painel e o Player.</div>', 'player controls box')
write(p,s)

# ---------- master.js ----------
p=Path('master.js'); s=read(p)
s = rep(s, "const state = { session: null, role: null, data: null, view: 'dashboard', selectedCompanyId: null };", "const state = { session: null, role: null, data: null, platformConfig: null, view: 'dashboard', selectedCompanyId: null };", 'master state')
s = rep(s, "  async function saveCompanyRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/save-company`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return saveCompanyRequest(body,false)}return parse(res)}", "  async function saveCompanyRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/save-company`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return saveCompanyRequest(body,false)}return parse(res)}\n  async function platformSettingsRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/platform-settings`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return platformSettingsRequest(body,false)}return parse(res)}", 'platform settings request')
s = s.replace("({active:'Ativa',suspended:'Suspensa',trialing:'Teste',past_due:'Pendente',cancelled:'Cancelada'})", "({active:'Ativa',suspended:'Suspensa',trialing:'Teste',pending_approval:'Aguardando aprovação',past_due:'Pagamento pendente',cancelled:'Cancelada',pending:'Pendente',paid:'Pago',overdue:'Vencido',waived:'Liberado'})")
new_render_clients = '''  function renderClients(){
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
      const due=c.subscription?.current_period_end?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'}).format(new Date(c.subscription.current_period_end)):'Sem vencimento';
      return `<article class="client-card"><div class="client-top"><div class="client-title"><div class="client-avatar">${esc(c.name.charAt(0).toUpperCase())}</div><div><strong>${esc(c.name)}</strong><small>${esc(c.owner?.email||'Sem e-mail')} • ${esc(c.plan?.name||'Sem plano')} • vence ${esc(due)}</small></div></div><div><span class="status ${esc(c.status)}">${esc(statusText(c.status))}</span> <span class="status ${esc(subStatus)}">${esc(statusText(subStatus))}</span> <span class="status ${esc(c.subscription?.payment_status||'pending')}">${esc(statusText(c.subscription?.payment_status||'pending'))}</span></div></div><div class="client-usage"><div><span>TVs</span><strong>${c.usage.devices}${maxD===null?'':` / ${maxD}`}</strong></div><div><span>Usuários</span><strong>${c.usage.users}${maxU===null?'':` / ${maxU}`}</strong></div><div><span>Storage</span><strong>${esc(bytes(c.usage.storage_bytes))}${maxS===null?'':` / ${esc(bytes(maxS*1024*1024))}`}</strong></div><div><span>Campanhas</span><strong>${c.usage.campaigns}${maxC===null?'':` / ${maxC}`}</strong></div></div><div class="client-actions"><button class="small-button" data-manage-company="${c.id}">Gerenciar conta</button><button class="small-button" data-company-users="${c.id}">Usuários (${c.members.length})</button><button class="small-button" data-toggle-company="${c.id}" data-next-status="${c.status==='active'?'suspended':'active'}">${c.status==='active'?'Suspender':'Reativar'}</button></div></article>`;
    }).join('');
  }
'''
s = sub(s, r"  function renderClients\(\)\{.*?\n  function renderPlans", new_render_clients + '  function renderPlans', 'renderClients', re.S)
render_platform = '''
  function renderPlatformSettings(){
    const c=state.platformConfig||{};
    if(!$('#platform-settings-form'))return;
    $('#ps-whatsapp').value=c.support_whatsapp||'';
    $('#ps-signup-message').value=c.signup_whatsapp_message||'';
    $('#ps-renewal-message').value=c.renewal_whatsapp_message||'';
    $('#ps-signup-enabled').checked=c.signup_enabled!==false;
  }
'''
s = rep(s, '  function renderAudit(){', render_platform + '  function renderAudit(){', 'renderPlatformSettings')
s = s.replace('  function render(){ renderMetrics(); renderDashboard(); renderClients(); renderPlans(); renderAudit(); }', '  function render(){ renderMetrics(); renderDashboard(); renderClients(); renderPlans(); renderPlatformSettings(); renderAudit(); }')
s = sub(s, r"  async function load\(\)\{.*?\n  async function enter", "  async function load(){ try{setConn(true); const [d,p]=await Promise.all([master({action:'dashboard'}),platformSettingsRequest({action:'get'})]); state.data=d; state.platformConfig=p?.config||{}; render();}catch(e){setConn(false); toast('Falha ao carregar Master',e.message,'error');throw e} }\n  async function enter", 'master load', re.S)
new_open = '''  function openCompany(id){
    const c=companyById(id); if(!c)return;
    fillPlanSelects(); formStatus('#me-status');
    $('#me-company-id').value=c.id; $('#me-company-title').textContent=c.name; $('#me-company-name').value=c.name; $('#me-company-status').value=c.status;
    $('#me-plan').value=c.subscription?.plan_id||''; $('#me-sub-status').value=c.subscription?.status||'pending_approval';
    $('#me-payment-status').value=c.subscription?.payment_status||'pending';
    $('#me-due-date').value=c.subscription?.current_period_end?String(c.subscription.current_period_end).slice(0,10):'';
    $('#me-manual-price').value=c.subscription?.manual_price_cents==null?'':(Number(c.subscription.manual_price_cents)/100).toFixed(2).replace('.',',');
    $('#me-billing-notes').value=c.subscription?.billing_notes||'';
    const o=c.subscription?.limit_overrides||{}; $('#me-max-devices').value=numOrBlank(o.max_devices); $('#me-storage-mb').value=numOrBlank(o.storage_limit_mb); $('#me-max-users').value=numOrBlank(o.max_users); $('#me-max-campaigns').value=numOrBlank(o.max_campaigns);
    const settings=c.settings||{}; $('#me-player-audio').checked=settings.player_audio_enabled!==false; $('#me-player-autostart').checked=settings.player_autostart_enabled!==false;
    openDialog('master-company-dialog');
  }
'''
s = sub(s, r"  function openCompany\(id\)\{.*?\n  function overrideObj", new_open + '  function overrideObj', 'openCompany', re.S)
s = s.replace("        subscription_status:$('#me-sub-status').value,", "        subscription_status:$('#me-sub-status').value,\n        payment_status:$('#me-payment-status').value,\n        due_date:$('#me-due-date').value||null,")
s = s.replace("        billing_notes:$('#me-billing-notes').value.trim()", "        billing_notes:$('#me-billing-notes').value.trim(),\n        player_audio_enabled:$('#me-player-audio').checked,\n        player_autostart_enabled:$('#me-player-autostart').checked")
extra_funcs = '''
  async function savePlatformSettings(ev){
    ev.preventDefault(); const b=$('#ps-save'); busy(b,true,'Salvando...'); formStatus('#ps-status','Salvando...','pending');
    try{const d=await platformSettingsRequest({action:'update',support_whatsapp:$('#ps-whatsapp').value,signup_whatsapp_message:$('#ps-signup-message').value.trim(),renewal_whatsapp_message:$('#ps-renewal-message').value.trim(),signup_enabled:$('#ps-signup-enabled').checked});state.platformConfig=d.config||{};renderPlatformSettings();formStatus('#ps-status','✅ Configurações salvas.','success');toast('Salvo com sucesso','Cadastro público e WhatsApp atualizados.')}catch(e){formStatus('#ps-status',`❌ ${e.message}`,'error');toast('Erro ao salvar configurações',e.message,'error')}finally{busy(b,false)}
  }

  async function clearCompanyCache(){
    const id=$('#me-company-id').value; if(!id)return;
    const b=$('#me-clear-cache'); busy(b,true,'Solicitando...');
    try{await saveCompanyRequest({company_id:id,company_name:$('#me-company-name').value.trim(),company_status:$('#me-company-status').value,plan_id:$('#me-plan').value,subscription_status:$('#me-sub-status').value,payment_status:$('#me-payment-status').value,due_date:$('#me-due-date').value||null,manual_price_cents:reaisToCents($('#me-manual-price').value),limit_overrides:overrideObj(),billing_notes:$('#me-billing-notes').value.trim(),player_audio_enabled:$('#me-player-audio').checked,player_autostart_enabled:$('#me-player-autostart').checked,clear_cache:true});formStatus('#me-status','✅ Limpeza de cache enviada. As TVs baixarão novamente as mídias na próxima sincronização.','success');toast('Comando enviado','Cache da conta será renovado.');await load()}catch(e){formStatus('#me-status',`❌ ${e.message}`,'error')}finally{busy(b,false)}
  }
'''
s = rep(s, '  function bind(){', extra_funcs + '  function bind(){', 'master extra funcs')
s = s.replace("$('#master-plan-form').addEventListener('submit',savePlan);", "$('#master-plan-form').addEventListener('submit',savePlan); $('#platform-settings-form').addEventListener('submit',savePlatformSettings); $('#me-clear-cache').addEventListener('click',clearCompanyCache);")
write(p,s)

# ---------- master.css ----------
p=Path('master.css'); s=read(p)
s += '''
.platform-settings-panel{margin-top:18px}.platform-settings-panel textarea{resize:vertical;min-height:70px}.compact-actions{justify-content:flex-start}.status.pending_approval,.status.pending{background:rgba(245,158,11,.12);color:#fbbf24}.status.paid,.status.waived{background:rgba(34,197,94,.12);color:#4ade80}.status.overdue,.status.past_due{background:rgba(239,68,68,.12);color:#f87171}
'''
write(p,s)

# ---------- player.js ----------
p=Path('player.js'); s=read(p)
s = s.replace("const APP_VERSION = 'vision-player-web-1.3.0';", "const APP_VERSION = 'vision-player-web-1.4.0';")
s = rep(s, "  const SETUP_CODE_KEY = 'vision_player_setup_code_v1';", "  const SETUP_CODE_KEY = 'vision_player_setup_code_v1';\n  const CACHE_REV_KEY = 'vision_player_cache_revision_v1';", 'cache revision const')
s = rep(s, '    cacheBytes: 0,\n    syncHadError:', '    cacheBytes: 0,\n    audioEnabled: true,\n    syncHadError:', 'player state audio')
apply_settings = '''
  async function applyDeviceSettings(settings = {}) {
    state.audioEnabled = settings.audio_enabled !== false;
    const revision = Number(settings.cache_revision || 0);
    const previous = Number(localStorage.getItem(CACHE_REV_KEY) || 0);
    if (revision !== previous) {
      await caches.delete(MEDIA_CACHE).catch(() => false);
      localStorage.setItem(CACHE_REV_KEY, String(revision));
      state.cacheItems = 0; state.cacheBytes = 0;
      queueDeviceEvent('cache_revision_applied','info','Cache local renovado por solicitação do painel.',{revision},30000);
    }
    try { window.VisionAndroid?.setAutostart?.(settings.autostart_enabled !== false); } catch {}
  }

'''
s = rep(s, '  async function cacheManifestAssets(manifest) {', apply_settings + '  async function cacheManifestAssets(manifest) {', 'apply device settings')
s = rep(s, "      const changed = !state.manifest || state.manifest.version !== manifest.version;\n      await cacheManifestAssets(manifest);", "      const changed = !state.manifest || state.manifest.version !== manifest.version;\n      await applyDeviceSettings(manifest?.device?.settings || {});\n      await cacheManifestAssets(manifest);", 'sync settings before cache')
s = s.replace("const video = document.createElement('video');", "const video = document.createElement('video');\n        video.muted = !state.audioEnabled;")
write(p,s)

# ---------- Android ----------
p=Path('android-player/app/src/main/java/com/visionmidia/player/MainActivity.java'); s=read(p)
s = rep(s, 'import android.webkit.WebChromeClient;', 'import android.webkit.JavascriptInterface;\nimport android.webkit.WebChromeClient;', 'android js interface import')
s = rep(s, '    private static final String KEY_SETUP_CODE = "company_setup_code";', '    private static final String KEY_SETUP_CODE = "company_setup_code";\n    public static final String KEY_AUTOSTART = "autostart_enabled";', 'autostart key')
s = rep(s, '        webView.setWebChromeClient(new WebChromeClient());', '        webView.addJavascriptInterface(new PlayerBridge(), "VisionAndroid");\n        webView.setWebChromeClient(new WebChromeClient());', 'add js bridge')
bridge = '''
    private class PlayerBridge {
        @JavascriptInterface
        public void setAutostart(boolean enabled) {
            prefs.edit().putBoolean(KEY_AUTOSTART, enabled).apply();
        }
    }

'''
s = rep(s, '    private void enterImmersiveMode() {', bridge + '    private void enterImmersiveMode() {', 'player bridge class')
write(p,s)

p=Path('android-player/app/src/main/java/com/visionmidia/player/BootReceiver.java'); s=read(p)
s = rep(s, '        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {', '        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {\n            boolean enabled = context.getSharedPreferences("vision_player_prefs", Context.MODE_PRIVATE).getBoolean(MainActivity.KEY_AUTOSTART, true);\n            if (!enabled) return;', 'boot preference')
write(p,s)

# ---------- service worker notification click ----------
p=Path('sw.js'); s=read(p)
if 'notificationclick' not in s:
    s += '''\nself.addEventListener('notificationclick', event => { event.notification.close(); event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list => { if(list[0]) return list[0].focus(); return clients.openWindow('./'); })); });\n'''
write(p,s)

print('PATCH_OK')
