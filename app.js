(() => {
  'use strict';

  const CONFIG = window.VISION_CONFIG;
  if (!CONFIG?.supabaseUrl || !CONFIG?.supabasePublishableKey) {
    document.body.innerHTML = '<main style="padding:40px;color:white">Configuração do Supabase ausente.</main>';
    return;
  }

  const SESSION_KEY = 'vision_midia_session_v1';
  const COMPANY_KEY = 'vision_midia_company_v1';
  const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

  const state = {
    session: null,
    user: null,
    companies: [],
    company: null,
    subscription: null,
    publicConfig: null,
    companyRole: null,
    devices: [],
    media: [],
    playlists: [],
    playlistItems: [],
    deviceAssignments: [],
    campaigns: [],
    campaignDevices: [],
    deviceEvents: [],
    deviceScreenshots: [],
    playerBranding: null,
    selectedPlaylistItemIds: new Set(),
    scheduleTargetItemIds: [],
    draggingPlaylistItemId: null,
    report: null,
    reportLoading: false,
    activeView: 'dashboard',
    editingPlaylistId: null,
    viewingDeviceId: null,
    isBusy: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function setBusy(button, busy, busyText = 'Salvando...') {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  function toast(title, message = '', type = 'success', timeout = 3500) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}`;
    root.appendChild(el);
    setTimeout(() => el.remove(), timeout);
  }

  function formatBytes(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && value >= 1024; i++) {
      value /= 1024;
      unit = units[i];
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
  }

  function formatDuration(seconds) {
    if (!seconds || Number.isNaN(Number(seconds))) return '—';
    const s = Math.round(Number(seconds));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function slugify(text) {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70);
  }

  function sessionHeaders(includeJson = true) {
    const headers = {
      apikey: CONFIG.supabasePublishableKey,
      Authorization: `Bearer ${state.session?.access_token || CONFIG.supabasePublishableKey}`,
    };
    if (includeJson) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async function parseResponse(response) {
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { data = text; }
    }
    if (!response.ok) {
      const error = new Error(data?.msg || data?.message || data?.error_description || data?.error || `Erro HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function authRequest(path, { method = 'POST', body } = {}) {
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1${path}`, {
      method,
      headers: {
        apikey: CONFIG.supabasePublishableKey,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return parseResponse(response);
  }

  async function restRequest(table, { method = 'GET', query = '', body, prefer } = {}) {
    const url = `${CONFIG.supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;
    const headers = sessionHeaders();
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 && state.session?.refresh_token) {
      const refreshed = await refreshSession().catch(() => null);
      if (refreshed) return restRequest(table, { method, query, body, prefer });
    }
    return parseResponse(response);
  }

  async function storageRequest(path, { method = 'POST', body, contentType = 'application/json', extraHeaders = {} } = {}) {
    const headers = sessionHeaders(false);
    headers['Content-Type'] = contentType;
    Object.assign(headers, extraHeaders);
    const response = await fetch(`${CONFIG.supabaseUrl}/storage/v1${path}`, {
      method,
      headers,
      body: body instanceof Blob ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    return parseResponse(response);
  }

  async function functionRequest(name, { body = {}, authenticated = true } = {}) {
    const headers = {
      apikey: CONFIG.supabasePublishableKey,
      'Content-Type': 'application/json',
    };
    if (authenticated && state.session?.access_token) headers.Authorization = `Bearer ${state.session.access_token}`;
    const response = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (response.status === 401 && authenticated && state.session?.refresh_token) {
      const refreshed = await refreshSession().catch(() => null);
      if (refreshed) return functionRequest(name, { body, authenticated });
    }
    return parseResponse(response);
  }

  function saveSession(session) {
    state.session = session;
    state.user = session?.user || null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  function loadSavedSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session?.access_token || !session?.refresh_token || !session?.user?.id) return null;
      return session;
    } catch { return null; }
  }

  function decodeJwtPayload(token) {
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(atob(payload).split('').map(c => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`).join('')));
    } catch { return null; }
  }

  function tokenNeedsRefresh(session) {
    const payload = decodeJwtPayload(session?.access_token || '');
    if (!payload?.exp) return true;
    return (payload.exp * 1000) - Date.now() < 120_000;
  }

  async function refreshSession() {
    if (!state.session?.refresh_token) return null;
    const data = await authRequest('/token?grant_type=refresh_token', {
      body: { refresh_token: state.session.refresh_token },
    });
    if (!data?.access_token) throw new Error('Não foi possível renovar a sessão.');
    saveSession(data);
    return data;
  }


  function formatPlanMoney(cents) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
  }

  async function loadPublicConfig() {
    let data = null;
    try {
      data = await functionRequest('public-config', { authenticated: false, body: {} });
    } catch (primaryError) {
      // Fallback público: os planos ativos e a configuração pública possuem RLS de leitura anon.
      try {
        const headers = { apikey: CONFIG.supabasePublishableKey, 'Content-Type': 'application/json' };
        const [plansResponse, configResponse] = await Promise.all([
          fetch(`${CONFIG.supabaseUrl}/rest/v1/plans?select=id,name,description,monthly_price_cents,max_devices,storage_limit_mb,max_users,max_campaigns,sort_order&is_active=eq.true&order=sort_order.asc`, { headers, cache: 'no-store' }),
          fetch(`${CONFIG.supabaseUrl}/rest/v1/platform_public_config?select=support_whatsapp,signup_whatsapp_message,renewal_whatsapp_message,signup_enabled&id=eq.1&limit=1`, { headers, cache: 'no-store' }),
        ]);
        if (!plansResponse.ok || !configResponse.ok) throw primaryError;
        const plans = await plansResponse.json();
        const configs = await configResponse.json();
        data = { ok: true, plans: plans || [], config: configs?.[0] || {} };
      } catch (fallbackError) {
        const select = $('#signup-plan');
        if (select) select.innerHTML = '<option value="">Não foi possível carregar os planos</option>';
        throw fallbackError;
      }
    }
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
    if ('Notification' in window && Notification.permission === 'granted') notifyAccessState(reason);
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

  function showScreen(name) {
    $('#auth-screen').classList.toggle('hidden', name !== 'auth');
    $('#access-screen').classList.toggle('hidden', name !== 'access');
    $('#onboarding-screen').classList.toggle('hidden', name !== 'onboarding');
    $('#app-shell').classList.toggle('hidden', name !== 'app');
  }

  async function bootstrap() {
    bindEvents();
    await loadPublicConfig().catch(() => null);
    updateConnectionStatus();
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);
    setInterval(() => {
      if (state.company?.id && !document.hidden && !$('#app-shell').classList.contains('hidden')) loadAllData().catch(() => updateConnectionStatus(false));
    }, 30_000);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    const saved = loadSavedSession();
    if (!saved) {
      showScreen('auth');
      return;
    }

    saveSession(saved);
    try {
      if (tokenNeedsRefresh(saved)) await refreshSession();
      await enterAuthenticatedApp();
    } catch (error) {
      console.warn(error);
      saveSession(null);
      showScreen('auth');
      toast('Sessão encerrada', 'Entre novamente para continuar.', 'error');
    }
  }

  async function enterAuthenticatedApp() {
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
    const [rows, memberRows] = await Promise.all([
      restRequest('company_subscriptions', { query: `select=*&company_id=eq.${encodeURIComponent(state.company.id)}&limit=1` }),
      restRequest('company_members', { query: `select=role,status&company_id=eq.${encodeURIComponent(state.company.id)}&user_id=eq.${encodeURIComponent(state.user.id)}&limit=1` }),
    ]);
    state.subscription = rows?.[0] || null;
    state.companyRole = memberRows?.[0]?.status === 'active' ? memberRows[0].role : null;
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

  async function loadAllData() {
    if (!state.company?.id) return;
    const companyId = encodeURIComponent(state.company.id);
    try {
      const [devices, media, playlists, playlistItems, deviceAssignments, campaigns, campaignDevices, deviceEvents] = await Promise.all([
        restRequest('devices', { query: `select=*&company_id=eq.${companyId}&retired_at=is.null&order=created_at.desc` }),
        restRequest('media_assets', { query: `select=*&company_id=eq.${companyId}&order=created_at.desc` }),
        restRequest('playlists', { query: `select=*&company_id=eq.${companyId}&order=created_at.desc` }),
        restRequest('playlist_items', { query: `select=*&company_id=eq.${companyId}&order=position.asc` }),
        restRequest('device_playlist_assignments', { query: `select=*&company_id=eq.${companyId}` }),
        restRequest('campaigns', { query: `select=*&company_id=eq.${companyId}&order=priority.desc,created_at.desc` }),
        restRequest('campaign_devices', { query: `select=*&company_id=eq.${companyId}` }),
        restRequest('device_events', { query: `select=id,client_event_id,device_id,severity,event_code,message,details,occurred_at&company_id=eq.${companyId}&order=occurred_at.desc&limit=100` }),
      ]);
      state.devices = devices || [];
      state.media = media || [];
      state.playlists = playlists || [];
      state.playlistItems = playlistItems || [];
      state.deviceAssignments = deviceAssignments || [];
      state.campaigns = campaigns || [];
      state.campaignDevices = campaignDevices || [];
      state.deviceEvents = deviceEvents || [];
      const [screenshots, brandingRows] = await Promise.all([
        restRequest('device_screenshots', { query: `select=*&company_id=eq.${companyId}&order=captured_at.desc&limit=80` }),
        restRequest('company_player_branding', { query: `select=*&company_id=eq.${companyId}&limit=1` }),
      ]);
      state.deviceScreenshots = screenshots || [];
      state.playerBranding = brandingRows?.[0] || null;
      renderAll();
      updateConnectionStatus(true);
    } catch (error) {
      updateConnectionStatus(false);
      throw error;
    }
  }

  function renderIdentity() {
    const name = state.company?.name || 'Empresa';
    $('#sidebar-company-name').textContent = name;
    $('#sidebar-user-email').textContent = state.user?.email || '';
    $('#company-avatar').textContent = name.charAt(0).toUpperCase();
    $('#dashboard-company-title').textContent = `${name}: sua mídia, sob controle.`;
  }

  function renderAll() {
    renderDashboard();
    renderDevices();
    renderPlayerBranding();
    renderMonitoring();
    renderMedia();
    renderPlaylists();
    renderCampaigns();
    renderReportFilterOptions();
    if (state.report) renderPlaybackReport();
    if (state.editingPlaylistId) renderPlaylistEditor();
  }

  function renderDashboard() {
    const online = state.devices.filter(d => effectiveDeviceStatus(d) === 'online').length;
    $('#metric-devices').textContent = state.devices.length;
    $('#metric-media').textContent = state.media.length;
    $('#metric-playlists').textContent = state.playlists.length;
    $('#metric-online').textContent = online;

    $('#metric-devices-detail').textContent = state.devices.length ? `${state.devices.length} dispositivo(s) vinculado(s)` : 'Nenhuma TV cadastrada';
    $('#metric-media-detail').textContent = state.media.length ? `${formatBytes(state.media.reduce((sum, m) => sum + Number(m.size_bytes || 0), 0))} em arquivos` : 'Biblioteca vazia';
    $('#metric-playlists-detail').textContent = state.playlists.length ? `${state.playlists.length} playlist(s) disponível(is)` : 'Crie sua primeira playlist';
    $('#metric-online-detail').textContent = state.devices.length ? `${online} de ${state.devices.length} online` : 'Aguardando conexão';

    const list = $('#dashboard-devices-list');
    if (!state.devices.length) {
      list.className = 'compact-list empty-state';
      list.textContent = 'Nenhuma TV cadastrada.';
    } else {
      list.className = 'compact-list';
      list.innerHTML = state.devices.slice(0, 5).map(device => `
        <div class="compact-row">
          <div class="device-icon">▣</div>
          <div class="grow"><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(platformLabel(device.platform))} • ${escapeHtml(orientationLabel(device.orientation))}</small></div>
          <span class="status-dot ${escapeHtml(effectiveDeviceStatus(device))}">${escapeHtml(statusLabel(effectiveDeviceStatus(device)))}</span>
        </div>
      `).join('');
    }

    updateChecklist('#check-device', state.devices.length > 0, '2');
    updateChecklist('#check-media', state.media.length > 0, '3');
    updateChecklist('#check-playlist', state.playlists.length > 0, '4');
    updateChecklist('#check-campaign', state.campaigns.length > 0, '5');
  }

  function updateChecklist(selector, done, pendingText) {
    const row = $(selector);
    row.classList.toggle('pending', !done);
    row.querySelector(':scope > span').textContent = done ? '✓' : pendingText;
  }

  function platformLabel(value) {
    return ({ android: 'Android / TV Box', firetv: 'Fire TV', windows: 'Windows', web: 'Navegador', smarttv: 'Smart TV', other: 'Outro' })[value] || value;
  }

  function orientationLabel(value) {
    return ({ auto: 'Automática', landscape: 'Horizontal', portrait: 'Vertical' })[value] || value;
  }

  function statusLabel(value) {
    return ({ pending: 'pendente', online: 'online', offline: 'offline', disabled: 'desativada' })[value] || value;
  }

  function effectiveDeviceStatus(device) {
    if (device.status === 'disabled') return 'disabled';
    if (!device.last_seen_at) return device.paired_at ? 'offline' : (device.status || 'pending');
    const stale = Date.now() - new Date(device.last_seen_at).getTime() > 90_000;
    return stale ? 'offline' : 'online';
  }

  function formatLastSeen(value) {
    if (!value) return 'Ainda não conectou';
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return `Visto há ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Visto há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Visto há ${hours} h`;
    return `Visto há ${Math.floor(hours / 24)} dia(s)`;
  }

  function latestScreenshotForDevice(deviceId) {
    return state.deviceScreenshots.find(row => row.device_id === deviceId) || null;
  }

  function renderDevices() {
    const grid = $('#devices-grid');
    const empty = $('#devices-empty');
    const has = state.devices.length > 0;
    empty.classList.toggle('hidden', has);
    grid.classList.toggle('hidden', !has);
    if (!has) { grid.innerHTML = ''; return; }

    grid.innerHTML = state.devices.map(device => {
      const status = effectiveDeviceStatus(device);
      const assignment = state.deviceAssignments.find(a => a.device_id === device.id);
      const shot = latestScreenshotForDevice(device.id);
      const options = state.playlists.map(playlist => `<option value="${playlist.id}" ${assignment?.playlist_id === playlist.id ? 'selected' : ''}>${escapeHtml(playlist.name)}</option>`).join('');
      return `
      <article class="device-card">
        <div class="device-card-head">
          <div class="device-card-title"><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(platformLabel(device.platform))}</span></div>
          <div class="card-menu">
            <button class="small-icon-button view-tv-button" data-view-device="${device.id}" title="Ver a captura atual desta TV em tamanho maior">👁 Ver TV</button>
            <button class="small-icon-button capture-button" data-capture-device="${device.id}" title="Capturar o que está passando agora">📷 Capturar</button>
            ${['owner','admin'].includes(state.companyRole) ? `<button class="small-icon-button" data-replace-device="${device.id}" title="Trocar esta TV por uma nova sem consumir outra vaga do plano">⇄ Substituir</button>` : ''}
            <button class="small-icon-button" data-edit-device="${device.id}" title="Editar">✎</button>
            <button class="small-icon-button" data-delete-device="${device.id}" title="Excluir">×</button>
          </div>
        </div>
        <div class="device-screen ${shot ? 'has-screenshot' : ''}" data-device-screenshot="${device.id}" data-screenshot-path="${escapeHtml(shot?.storage_path || '')}">${shot ? '<span>Carregando captura…</span>' : '▣'}</div>
        ${shot ? `<div class="screenshot-meta">Última captura: ${escapeHtml(formatMonitorDateTime(shot.captured_at))}</div>` : ''}
        <div class="device-meta">
          <span class="status-dot ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
          <span>${escapeHtml(orientationLabel(device.orientation))}</span>
        </div>
        <div class="device-last-seen">${escapeHtml(formatLastSeen(device.last_seen_at))}${device.app_version ? ` • ${escapeHtml(device.app_version)}` : ''}</div>
        <label class="device-assignment">Playlist padrão
          <select data-device-playlist="${device.id}" ${state.playlists.length ? '' : 'disabled'}>
            <option value="">${state.playlists.length ? 'Nenhuma playlist' : 'Crie uma playlist primeiro'}</option>
            ${options}
          </select>
        </label>
      </article>`;
    }).join('');
    hydrateDeviceScreenshots();
  }

  async function hydrateDeviceScreenshots() {
    for (const shot of state.deviceScreenshots) {
      const target = $(`[data-device-screenshot="${CSS.escape(shot.device_id)}"]`);
      if (!target || target.dataset.loaded === '1' || !shot.storage_path) continue;
      try {
        const url = await getSignedMediaUrl(shot.storage_path);
        const img = new Image();
        img.alt = 'Captura da TV';
        img.src = url;
        target.replaceChildren(img);
        target.dataset.loaded = '1';
      } catch { target.textContent = 'Captura indisponível'; }
    }
  }


  async function renderTvViewer(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device) return;
    state.viewingDeviceId = deviceId;
    $('#view-tv-title').textContent = device.name;
    $('#view-tv-status').textContent = `${statusLabel(effectiveDeviceStatus(device))} • ${formatLastSeen(device.last_seen_at)}`;
    const preview = $('#view-tv-preview');
    const shot = latestScreenshotForDevice(deviceId);
    if (!shot?.storage_path) {
      preview.innerHTML = '<div class="tv-viewer-empty">Ainda não há captura desta TV.<br><small>Use “Atualizar agora” para solicitar uma imagem do que está passando.</small></div>';
      $('#view-tv-captured-at').textContent = 'Sem captura disponível';
      return;
    }
    preview.innerHTML = '<div class="tv-viewer-empty">Carregando captura…</div>';
    $('#view-tv-captured-at').textContent = `Capturada em ${formatMonitorDateTime(shot.captured_at)}`;
    try {
      const url = await getSignedMediaUrl(shot.storage_path);
      if (state.viewingDeviceId !== deviceId) return;
      const img = new Image();
      img.alt = `Captura da TV ${device.name}`;
      img.src = url;
      preview.replaceChildren(img);
    } catch {
      preview.innerHTML = '<div class="tv-viewer-empty">Não foi possível abrir a captura.</div>';
    }
  }

  async function openTvViewer(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device) return;
    openDialog('view-tv-dialog');
    await renderTvViewer(deviceId);
  }

  async function refreshTvViewer() {
    const deviceId = state.viewingDeviceId;
    if (!deviceId) return;
    const button = $('#view-tv-refresh');
    setBusy(button, true, 'Atualizando...');
    try {
      await requestDeviceScreenshot(deviceId);
      await renderTvViewer(deviceId);
    } finally {
      setBusy(button, false);
    }
  }

  async function requestDeviceScreenshot(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device) return;
    try {
      const rows = await restRequest('device_commands', {
        method: 'POST',
        body: { company_id: state.company.id, device_id: deviceId, command_type: 'screenshot', requested_by: state.user.id },
        prefer: 'return=representation',
      });
      const command = rows?.[0];
      if (!command?.id) throw new Error('O servidor não confirmou o pedido de captura.');
      toast('Captura solicitada', `${device.name}: aguardando o Player responder.`);
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1800));
        const result = await restRequest('device_commands', { query: `select=id,status,error_message&company_id=eq.${encodeURIComponent(state.company.id)}&id=eq.${encodeURIComponent(command.id)}&limit=1` });
        const row = result?.[0];
        if (row?.status === 'completed') {
          await loadAllData();
          toast('Captura concluída', `A imagem atual da ${device.name} foi recebida.`);
          return;
        }
        if (row?.status === 'failed') throw new Error(row.error_message || 'O Player não conseguiu capturar a tela.');
      }
      toast('Captura ainda pendente', 'A TV pode estar offline. O pedido ficará aguardando o Player.', 'error', 6000);
    } catch (error) { toast('Erro ao capturar TV', error.message, 'error', 6000); }
  }

  function renderPlayerBranding() {
    const b = state.playerBranding;
    const title = b?.title || state.company?.name || 'Vision Player';
    const message = b?.message || 'Instale o Player e vincule a TV pelo código.';
    if ($('#branding-title')) $('#branding-title').value = b?.title || '';
    if ($('#branding-message')) $('#branding-message').value = b?.message || '';
    if ($('#branding-preview-title')) $('#branding-preview-title').textContent = title;
    if ($('#branding-preview-message')) $('#branding-preview-message').textContent = message;
    if ($('#branding-setup-code')) $('#branding-setup-code').textContent = b?.setup_code || 'Será gerado ao salvar';
    const playerUrl = b?.setup_code ? `${location.origin}/player.html?setup=${encodeURIComponent(b.setup_code)}` : `${location.origin}/player.html`;
    if ($('#branding-player-url')) $('#branding-player-url').value = playerUrl;
    const preview = $('#player-branding-preview');
    if (preview) { preview.style.backgroundImage = ''; preview.dataset.loaded = ''; }
    hydratePlayerBrandingPreview();
  }

  async function hydratePlayerBrandingPreview() {
    const preview = $('#player-branding-preview');
    if (!preview || !state.playerBranding?.splash_path || preview.dataset.loaded === '1') return;
    try {
      const url = await getSignedMediaUrl(state.playerBranding.splash_path);
      preview.style.backgroundImage = `linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.45)),url("${url}")`;
      preview.dataset.loaded = '1';
    } catch { /* generic preview remains */ }
  }

  async function savePlayerBranding(event) {
    event.preventDefault();
    const button = $('#branding-save');
    const file = $('#branding-file')?.files?.[0] || null;
    let newPath = null;
    let oldPath = state.playerBranding?.splash_path || null;
    setBusy(button, true, 'Salvando...');
    try {
      if (file) {
        const optimized = await optimizeImageForUpload(file);
        const upload = optimized.file;
        const safeName = optimized.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100);
        newPath = `${state.company.id}/branding/${crypto.randomUUID()}-${safeName}`;
        const encodedPath = newPath.split('/').map(encodeURIComponent).join('/');
        await storageRequest(`/object/${CONFIG.storageBucket}/${encodedPath}`, { body: upload, contentType: upload.type || 'image/webp', extraHeaders: { 'x-upsert': 'false' } });
      }
      const payload = {
        company_id: state.company.id,
        title: $('#branding-title').value.trim() || null,
        message: $('#branding-message').value.trim() || null,
        splash_path: newPath || oldPath,
        updated_by: state.user.id,
      };
      let rows;
      if (state.playerBranding) {
        rows = await restRequest('company_player_branding', { method: 'PATCH', query: `company_id=eq.${encodeURIComponent(state.company.id)}`, body: payload, prefer: 'return=representation' });
      } else {
        rows = await restRequest('company_player_branding', { method: 'POST', body: payload, prefer: 'return=representation' });
      }
      state.playerBranding = rows?.[0] || state.playerBranding;
      if (!state.playerBranding) throw new Error('A configuração foi enviada, mas não retornou do servidor.');
      if (newPath && oldPath && oldPath !== newPath) {
        storageRequest(`/object/${CONFIG.storageBucket}`, { method: 'DELETE', body: { prefixes: [oldPath] } }).catch(() => {});
      }
      $('#branding-file').value = '';
      renderPlayerBranding();
      toast('Salvo com sucesso', 'Tela de instalação do Player atualizada.');
    } catch (error) {
      if (newPath) storageRequest(`/object/${CONFIG.storageBucket}`, { method: 'DELETE', body: { prefixes: [newPath] } }).catch(() => {});
      toast('Erro ao salvar tela do Player', error.message, 'error', 6000);
    } finally { setBusy(button, false); }
  }

  function deviceHasActiveIssue(device) {
    if (!device?.last_error_at) return false;
    if (!device.last_recovered_at) return true;
    return new Date(device.last_error_at).getTime() > new Date(device.last_recovered_at).getTime();
  }

  function deviceSyncIsStale(device) {
    if (effectiveDeviceStatus(device) !== 'online') return false;
    if (!device.last_sync_at) return true;
    return Date.now() - new Date(device.last_sync_at).getTime() > 120_000;
  }

  function formatMonitorDateTime(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: state.company?.timezone || 'America/Sao_Paulo',
        dateStyle: 'short', timeStyle: 'medium',
      }).format(new Date(value));
    } catch { return new Date(value).toLocaleString('pt-BR'); }
  }

  function monitorEntityName(collection, id, fallback = '—') {
    if (!id) return fallback;
    return collection.find(item => item.id === id)?.name || fallback;
  }

  function eventSeverityLabel(value) {
    return ({ critical: 'Crítico', error: 'Erro', warning: 'Aviso', info: 'Informação' })[value] || value;
  }

  function renderMonitoring() {
    const online = state.devices.filter(device => effectiveDeviceStatus(device) === 'online').length;
    const offline = state.devices.filter(device => effectiveDeviceStatus(device) === 'offline').length;
    const issues = state.devices.filter(deviceHasActiveIssue).length;
    const staleSync = state.devices.filter(deviceSyncIsStale).length;
    $('#monitor-online').textContent = online;
    $('#monitor-offline').textContent = offline;
    $('#monitor-issues').textContent = issues;
    $('#monitor-stale-sync').textContent = staleSync;

    const grid = $('#monitor-devices-grid');
    const empty = $('#monitor-devices-empty');
    const hasDevices = state.devices.length > 0;
    empty.classList.toggle('hidden', hasDevices);
    grid.classList.toggle('hidden', !hasDevices);

    if (hasDevices) {
      grid.innerHTML = state.devices.map(device => {
        const status = effectiveDeviceStatus(device);
        const activeIssue = deviceHasActiveIssue(device);
        const syncStale = deviceSyncIsStale(device);
        const campaignName = monitorEntityName(state.campaigns, device.current_campaign_id, device.current_campaign_id ? 'Campanha removida' : 'Conteúdo padrão');
        const playlistName = monitorEntityName(state.playlists, device.current_playlist_id, device.current_playlist_id ? 'Playlist removida' : '—');
        const mediaName = monitorEntityName(state.media, device.current_media_id, device.current_media_id ? 'Mídia removida' : '—');
        const resolution = device.screen_width && device.screen_height ? `${device.screen_width}×${device.screen_height}` : '—';
        const storageBytes = device.storage_free_mb == null ? null : Number(device.storage_free_mb) * 1024 * 1024;
        const queueTotal = Number(device.playback_queue_size || 0) + Number(device.event_queue_size || 0);
        return `
          <article class="monitor-device-card ${activeIssue ? 'has-issue' : ''}">
            <div class="monitor-device-head">
              <div>
                <strong>${escapeHtml(device.name)}</strong>
                <span>${escapeHtml(platformLabel(device.platform))}</span>
              </div>
              <span class="status-dot ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
            </div>
            <div class="monitor-health-line">
              <span class="health-chip ${syncStale ? 'warning' : 'ok'}">${syncStale ? 'Sincronização atrasada' : 'Sincronização normal'}</span>
              ${activeIssue ? '<span class="health-chip error">Falha ativa</span>' : '<span class="health-chip ok">Sem falha ativa</span>'}
              ${queueTotal ? `<span class="health-chip warning">${queueTotal} pendência(s) offline</span>` : ''}
            </div>
            <div class="monitor-data-grid">
              <div><span>Última conexão</span><strong>${escapeHtml(formatLastSeen(device.last_seen_at))}</strong></div>
              <div><span>Última sincronização</span><strong>${escapeHtml(device.last_sync_at ? formatMonitorDateTime(device.last_sync_at) : 'Ainda não sincronizou')}</strong></div>
              <div><span>Versão</span><strong>${escapeHtml(device.app_version || '—')}</strong></div>
              <div><span>Resolução</span><strong>${escapeHtml(resolution)}</strong></div>
              <div><span>Cache local</span><strong>${Number(device.cache_items || 0)} item(ns) • ${escapeHtml(formatBytes(Number(device.cache_bytes || 0)))}</strong></div>
              <div><span>Espaço livre estimado</span><strong>${escapeHtml(storageBytes == null ? '—' : formatBytes(storageBytes))}</strong></div>
              <div><span>Campanha atual</span><strong>${escapeHtml(campaignName)}</strong></div>
              <div><span>Playlist atual</span><strong>${escapeHtml(playlistName)}</strong></div>
              <div class="monitor-current-media"><span>Mídia em reprodução</span><strong>${escapeHtml(mediaName)}</strong></div>
              <div><span>Filas offline</span><strong>${Number(device.playback_queue_size || 0)} veiculação • ${Number(device.event_queue_size || 0)} evento</strong></div>
            </div>
            ${activeIssue ? `<div class="monitor-last-error"><strong>Última falha:</strong> ${escapeHtml(device.last_error_message || device.last_error_code || 'Erro do player')}<small>${escapeHtml(formatMonitorDateTime(device.last_error_at))}</small></div>` : ''}
          </article>`;
      }).join('');
    } else {
      grid.innerHTML = '';
    }

    const severity = $('#monitor-severity-filter')?.value || '';
    const events = state.deviceEvents.filter(event => !severity || event.severity === severity);
    const eventsList = $('#monitor-events-list');
    const eventsEmpty = $('#monitor-events-empty');
    eventsEmpty.classList.toggle('hidden', events.length > 0);
    eventsList.classList.toggle('hidden', events.length === 0);
    eventsList.innerHTML = events.map(event => {
      const device = state.devices.find(item => item.id === event.device_id);
      return `
        <div class="monitor-event ${escapeHtml(event.severity)}">
          <div class="monitor-event-icon">${event.severity === 'critical' ? '!' : event.severity === 'error' ? '×' : event.severity === 'warning' ? '!' : 'i'}</div>
          <div class="monitor-event-copy">
            <div><strong>${escapeHtml(device?.name || 'TV removida')}</strong><span class="event-severity ${escapeHtml(event.severity)}">${escapeHtml(eventSeverityLabel(event.severity))}</span></div>
            <p>${escapeHtml(event.message)}</p>
            <small>${escapeHtml(formatMonitorDateTime(event.occurred_at))} • ${escapeHtml(event.event_code)}</small>
          </div>
        </div>`;
    }).join('');
  }

  function renderMedia() {
    const grid = $('#media-grid');
    const empty = $('#media-empty');
    const has = state.media.length > 0;
    empty.classList.toggle('hidden', has);
    grid.classList.toggle('hidden', !has);
    grid.className = 'media-list-compact';
    if (!has) { grid.innerHTML = ''; return; }

    grid.innerHTML = state.media.map(media => {
      const used = state.playlistItems.filter(item => item.media_id === media.id).length;
      return `
      <article class="media-row-compact" data-media-card="${media.id}">
        <div class="media-preview" data-media-preview="${media.id}"><span>${media.media_type === 'video' ? '▶' : '▧'}</span><span class="media-type-tag">${escapeHtml(media.media_type)}</span></div>
        <div class="media-body"><strong title="${escapeHtml(media.name)}">${escapeHtml(media.name)}</strong><small>${escapeHtml(formatBytes(media.size_bytes))}${media.width && media.height ? ` • ${media.width}×${media.height}` : ''}${media.duration_seconds ? ` • ${escapeHtml(formatDuration(media.duration_seconds))}` : ''} • em ${used} item(ns) de playlist</small></div>
        <div class="media-actions"><button class="small-icon-button" data-open-media="${media.id}">Visualizar</button><button class="small-icon-button" data-delete-media="${media.id}">Excluir</button></div>
      </article>`;
    }).join('');

    state.media.filter(m => m.storage_path && ['image','video'].includes(m.media_type)).forEach(async media => {
      try {
        const url = await getSignedMediaUrl(media.storage_path);
        const preview = $(`[data-media-preview="${CSS.escape(media.id)}"]`);
        if (!preview || !url) return;
        if (media.media_type === 'image') { const img = document.createElement('img'); img.loading='lazy'; img.alt=media.name; img.src=url; preview.prepend(img); }
        else { const video=document.createElement('video'); video.muted=true; video.preload='metadata'; video.playsInline=true; video.src=url; preview.prepend(video); }
      } catch { /* placeholder */ }
    });
  }

  function renderPlaylists() {
    const grid = $('#playlists-grid');
    const empty = $('#playlists-empty');
    const has = state.playlists.length > 0;
    empty.classList.toggle('hidden', has);
    grid.classList.toggle('hidden', !has);
    if (!has) { grid.innerHTML = ''; return; }

    grid.innerHTML = state.playlists.map(playlist => {
      const itemCount = state.playlistItems.filter(i => i.playlist_id === playlist.id).length;
      return `
        <article class="playlist-card">
          <div class="playlist-card-head">
            <div class="playlist-card-title"><strong>${escapeHtml(playlist.name)}</strong><span>${escapeHtml(playlist.description || 'Sem descrição')}</span></div>
            <div class="card-menu"><button class="small-icon-button" data-delete-playlist="${playlist.id}" title="Excluir">×</button></div>
          </div>
          <div class="playlist-visual">▶</div>
          <div class="playlist-footer"><small>${itemCount} mídia(s)</small><button class="small-icon-button" data-edit-playlist-items="${playlist.id}">Editar conteúdo</button></div>
        </article>
      `;
    }).join('');
  }

  function playlistItemScheduleLabel(item) {
    if (!item?.schedule_enabled) return 'Sempre';
    const days = Array.isArray(item.weekdays) ? item.weekdays.map(Number).sort((a,b)=>a-b) : [0,1,2,3,4,5,6];
    const dayText = days.length === 7 ? 'Todos os dias' : days.map(day => WEEKDAY_NAMES[day]).filter(Boolean).join(', ');
    const timeText = item.start_time && item.end_time ? `${normalizeTime(item.start_time)}–${normalizeTime(item.end_time)}` : 'dia inteiro';
    const dateText = item.start_date || item.end_date ? `${item.start_date ? formatDateShort(item.start_date) : 'agora'} → ${item.end_date ? formatDateShort(item.end_date) : 'sem fim'}` : '';
    return [dayText, timeText, dateText].filter(Boolean).join(' • ');
  }

  function syncPlaylistBulkUi() {
    const selected = state.selectedPlaylistItemIds;
    const count = selected.size;
    const countEl = $('#playlist-selected-count');
    if (countEl) countEl.textContent = `${count} selecionada${count === 1 ? '' : 's'}`;
    const items = state.playlistItems.filter(i => i.playlist_id === state.editingPlaylistId);
    const all = $('#playlist-select-all');
    if (all) { all.checked = items.length > 0 && count === items.length; all.indeterminate = count > 0 && count < items.length; }
    ['#playlist-bulk-schedule','#playlist-bulk-enable','#playlist-bulk-disable','#playlist-bulk-replace','#playlist-bulk-delete'].forEach(selector => { const el=$(selector); if(el) el.disabled=count===0; });
  }

  function renderPlaylistEditor() {
    const playlist = state.playlists.find(p => p.id === state.editingPlaylistId);
    if (!playlist) return;
    $('#playlist-items-title').textContent = playlist.name;
    const items = state.playlistItems.filter(i => i.playlist_id === playlist.id).sort((a,b) => a.position - b.position);
    const validIds = new Set(items.map(item => item.id));
    state.selectedPlaylistItemIds = new Set([...state.selectedPlaylistItemIds].filter(id => validIds.has(id)));
    const mediaById = Object.fromEntries(state.media.map(m => [m.id, m]));

    const list = $('#playlist-items-list');
    $('#playlist-items-empty').classList.toggle('hidden', items.length > 0);
    list.innerHTML = items.map((item, index) => {
      const media = mediaById[item.media_id];
      const isImage = media?.media_type === 'image';
      const seconds = Math.max(1, Math.round(Number(item.duration_override_seconds || media?.duration_seconds || 10)));
      const checked = state.selectedPlaylistItemIds.has(item.id);
      return `
        <div class="sortable-row playlist-item-row" draggable="true" data-playlist-drag-item="${item.id}">
          <input class="playlist-select-box" type="checkbox" data-select-playlist-item="${item.id}" ${checked ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(media?.name || 'mídia')}" />
          <span class="drag-handle" title="Arrastar para ordenar">⋮⋮</span>
          <div class="playlist-thumb" data-playlist-media-preview="${media?.id || ''}"><span>${media?.media_type === 'video' ? '▶' : '▧'}</span></div>
          <div class="playlist-item-copy"><strong>${index + 1}. ${escapeHtml(media?.name || 'Mídia removida')}</strong><small>${escapeHtml(media?.media_type || '')}${media?.width && media?.height ? ` • ${media.width}×${media.height}` : ''}</small><div class="playlist-item-meta"><span class="enabled-chip ${item.enabled ? '' : 'off'}">${item.enabled ? 'Ativa' : 'Desativada'}</span><span class="schedule-chip ${item.schedule_enabled ? 'active' : ''}">${escapeHtml(playlistItemScheduleLabel(item))}</span></div></div>
          ${isImage ? `<label class="playlist-duration-mini">Tempo <input type="number" min="1" max="86400" step="1" value="${seconds}" data-item-duration-input="${item.id}" /> s <button class="small-icon-button" type="button" data-save-item-duration="${item.id}">Salvar</button></label>` : `<span class="playlist-video-duration">${media?.duration_seconds ? escapeHtml(formatDuration(media.duration_seconds)) : 'Vídeo'}</span>`}
          <div class="playlist-inline-actions"><button class="small-icon-button" type="button" data-edit-item-schedule="${item.id}">◷ Programar</button><button class="small-icon-button" type="button" data-toggle-item-enabled="${item.id}" title="${item.enabled ? 'Desativar' : 'Ativar'}">${item.enabled ? '⏸' : '▶'}</button><button class="small-icon-button" type="button" data-move-item="${item.id}" data-direction="up" ${index===0?'disabled':''}>↑</button><button class="small-icon-button" type="button" data-move-item="${item.id}" data-direction="down" ${index===items.length-1?'disabled':''}>↓</button><button class="small-icon-button" type="button" data-remove-item="${item.id}">×</button></div>
        </div>`;
    }).join('');

    const picker = $('#playlist-media-picker');
    $('#playlist-media-empty').classList.toggle('hidden', state.media.length > 0);
    const included = new Map(items.map((item,index) => [item.media_id,index + 1]));
    picker.innerHTML = state.media.map(media => { const order=included.get(media.id); return `<div class="picker-row ${order?'already-selected':''}"><div class="playlist-thumb" data-playlist-media-preview="${media.id}"><span>${media.media_type==='video'?'▶':'▧'}</span></div><div class="grow"><strong>${escapeHtml(media.name)}</strong><small>${escapeHtml(media.media_type)} • ${escapeHtml(formatBytes(media.size_bytes))}</small><span class="playlist-selection-state ${order?'selected':''}">${order?`Já adicionada • ordem ${order}`:'Ainda não selecionada'}</span></div><button class="small-icon-button picker-add-button" data-add-media-to-playlist="${media.id}" ${order?'disabled':''}>${order?'Adicionada':'+ Adicionar'}</button></div>`; }).join('');

    const replace = $('#playlist-bulk-replace-media');
    if (replace) replace.innerHTML = '<option value="">Substituir por...</option>' + state.media.map(media => `<option value="${media.id}">${escapeHtml(media.name)}</option>`).join('');
    syncPlaylistBulkUi();
    hydratePlaylistPreviews();
  }

  async function hydratePlaylistPreviews() {
    const visibleIds = new Set($$('[data-playlist-media-preview]').map(el => el.dataset.playlistMediaPreview).filter(Boolean));
    for (const media of state.media.filter(item => visibleIds.has(item.id))) {
      const targets = $$(`[data-playlist-media-preview="${CSS.escape(media.id)}"]`);
      if (!targets.length || !media.storage_path || !['image','video'].includes(media.media_type)) continue;
      try {
        const url = await getSignedMediaUrl(media.storage_path);
        targets.forEach(target => {
          if (target.dataset.loaded === '1') return;
          target.dataset.loaded = '1';
          if (media.media_type === 'image') {
            const img = document.createElement('img'); img.alt = media.name; img.loading = 'lazy'; img.src = url; target.prepend(img);
          } else {
            const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.src = url; target.prepend(video);
            video.addEventListener('loadedmetadata', () => { try { video.currentTime = Math.min(.1, Math.max(0, (video.duration || 1) / 10)); } catch {} }, { once:true });
          }
        });
      } catch { /* keep placeholder */ }
    }
  }

  const WEEKDAY_NAMES = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };

  function formatDateShort(value) {
    if (!value) return '';
    const [year, month, day] = String(value).split('-');
    return year && month && day ? `${day}/${month}/${year}` : String(value);
  }

  function normalizeTime(value) {
    if (!value) return '';
    return String(value).slice(0, 5);
  }

  function campaignIsAlways(campaign) {
    const weekdays = Array.isArray(campaign?.weekdays) ? campaign.weekdays.map(Number) : [];
    return !campaign?.start_date && !campaign?.end_date && !campaign?.start_time && !campaign?.end_time && weekdays.length === 7;
  }

  function campaignScheduleLabel(campaign) {
    if (campaignIsAlways(campaign)) return 'Sempre';
    const weekdays = Array.isArray(campaign.weekdays) ? [...campaign.weekdays].map(Number).sort((a,b) => a-b) : [];
    const days = weekdays.length === 7 ? 'Todos os dias' : weekdays.map(day => WEEKDAY_NAMES[day]).filter(Boolean).join(', ');
    const time = campaign.start_time && campaign.end_time
      ? `${normalizeTime(campaign.start_time)}–${normalizeTime(campaign.end_time)}${normalizeTime(campaign.start_time) > normalizeTime(campaign.end_time) ? ' (+1 dia)' : ''}`
      : 'Dia inteiro';
    return `${days || 'Sem dias'} • ${time}`;
  }

  function campaignPeriodLabel(campaign) {
    if (!campaign.start_date && !campaign.end_date) return 'Sem limite de datas';
    if (campaign.start_date && campaign.end_date) return `${formatDateShort(campaign.start_date)} → ${formatDateShort(campaign.end_date)}`;
    if (campaign.start_date) return `A partir de ${formatDateShort(campaign.start_date)}`;
    return `Até ${formatDateShort(campaign.end_date)}`;
  }

  function campaignTargetLabel(campaign) {
    if (campaign.all_devices) return 'Todas as TVs';
    const ids = state.campaignDevices.filter(row => row.campaign_id === campaign.id).map(row => row.device_id);
    if (!ids.length) return 'Nenhuma TV';
    if (ids.length === 1) return state.devices.find(device => device.id === ids[0])?.name || '1 TV';
    return `${ids.length} TVs selecionadas`;
  }

  function renderCampaigns() {
    const grid = $('#campaigns-grid');
    const empty = $('#campaigns-empty');
    if (!grid || !empty) return;
    const has = state.campaigns.length > 0;
    empty.classList.toggle('hidden', has);
    grid.classList.toggle('hidden', !has);
    if (!has) { grid.innerHTML = ''; return; }

    const playlistById = Object.fromEntries(state.playlists.map(playlist => [playlist.id, playlist]));
    grid.innerHTML = state.campaigns.map(campaign => `
      <article class="campaign-card ${campaign.is_active ? '' : 'inactive'}">
        <div class="campaign-card-head">
          <div class="campaign-card-title">
            <strong>${escapeHtml(campaign.name)}</strong>
            <span>${escapeHtml(playlistById[campaign.playlist_id]?.name || 'Playlist removida')}</span>
          </div>
          <div class="card-menu">
            <button class="small-icon-button" data-edit-campaign="${campaign.id}" title="Editar">✎</button>
            <button class="small-icon-button" data-delete-campaign="${campaign.id}" title="Excluir">×</button>
          </div>
        </div>
        <div class="campaign-badges">
          <span class="campaign-badge ${campaign.is_active ? 'active' : 'paused'}">${campaign.is_active ? 'Habilitada' : 'Pausada'}</span>
          <span class="campaign-badge">Prioridade ${escapeHtml(campaign.priority)}</span>
          <span class="campaign-badge">${escapeHtml(campaign.all_devices ? 'Todas as TVs' : 'TVs específicas')}</span>
        </div>
        <div class="campaign-details">
          <div class="campaign-detail-row"><span>Recorrência</span><strong>${escapeHtml(campaignScheduleLabel(campaign))}</strong></div>
          <div class="campaign-detail-row"><span>Período</span><strong>${escapeHtml(campaignPeriodLabel(campaign))}</strong></div>
          <div class="campaign-detail-row"><span>Destino</span><strong>${escapeHtml(campaignTargetLabel(campaign))}</strong></div>
        </div>
        <div class="campaign-actions">
          <div class="left"><button class="small-icon-button" data-toggle-campaign="${campaign.id}">${campaign.is_active ? 'Pausar' : 'Ativar'}</button></div>
          <div class="right"><button class="small-icon-button" data-edit-campaign="${campaign.id}">Configurar</button></div>
        </div>
      </article>
    `).join('');
  }

  function renderCampaignDevicePicker(selectedIds = []) {
    const root = $('#campaign-device-picker');
    if (!root) return;
    const selected = new Set(selectedIds);
    if (!state.devices.length) {
      root.innerHTML = '<div class="mini-empty">Nenhuma TV pareada. Use “Todas as TVs” ou pareie uma TV primeiro.</div>';
      return;
    }
    root.innerHTML = state.devices.map(device => `
      <label>
        <input type="checkbox" data-campaign-device value="${device.id}" ${selected.has(device.id) ? 'checked' : ''} />
        <span><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(platformLabel(device.platform))} • ${escapeHtml(statusLabel(effectiveDeviceStatus(device)))}</small></span>
      </label>
    `).join('');
  }

  function syncCampaignFormVisibility() {
    const always = $('#campaign-always')?.checked;
    const allDevices = $('#campaign-all-devices')?.checked;
    const allDay = $('#campaign-all-day')?.checked;
    $('#campaign-schedule-block')?.classList.toggle('hidden', Boolean(always));
    $('#campaign-targets-block')?.classList.toggle('hidden', Boolean(allDevices));
    $('#campaign-time-fields')?.classList.toggle('hidden', Boolean(allDay));
  }

  function openCampaignDialog(id = null) {
    if (!state.playlists.length) {
      toast('Crie uma playlist primeiro', 'A campanha precisa apontar para uma playlist.', 'error');
      setView('playlists');
      return;
    }
    const campaign = id ? state.campaigns.find(item => item.id === id) : null;
    $('#campaign-dialog-title').textContent = campaign ? 'Editar campanha' : 'Nova campanha';
    $('#campaign-id').value = campaign?.id || '';
    $('#campaign-name').value = campaign?.name || '';
    $('#campaign-description').value = campaign?.description || '';
    $('#campaign-playlist').innerHTML = state.playlists.map(playlist => `<option value="${playlist.id}" ${campaign?.playlist_id === playlist.id ? 'selected' : ''}>${escapeHtml(playlist.name)}</option>`).join('');
    $('#campaign-active').checked = campaign ? Boolean(campaign.is_active) : true;
    $('#campaign-priority').value = campaign?.priority ?? 50;
    $('#campaign-all-devices').checked = campaign ? Boolean(campaign.all_devices) : true;
    $('#campaign-always').checked = campaign ? campaignIsAlways(campaign) : false;
    $('#campaign-start-date').value = campaign?.start_date || '';
    $('#campaign-end-date').value = campaign?.end_date || '';
    const allDay = !campaign?.start_time && !campaign?.end_time;
    $('#campaign-all-day').checked = allDay;
    $('#campaign-start-time').value = normalizeTime(campaign?.start_time);
    $('#campaign-end-time').value = normalizeTime(campaign?.end_time);

    const weekdays = new Set((campaign?.weekdays || [0,1,2,3,4,5,6]).map(Number));
    $$('[data-campaign-weekday]').forEach(input => { input.checked = weekdays.has(Number(input.value)); });
    const targets = campaign ? state.campaignDevices.filter(row => row.campaign_id === campaign.id).map(row => row.device_id) : [];
    renderCampaignDevicePicker(targets);
    syncCampaignFormVisibility();
    openDialog('campaign-dialog');
    setTimeout(() => $('#campaign-name')?.focus(), 50);
  }

  async function handleSaveCampaign(event) {
    event.preventDefault();
    const button = $('#campaign-save');
    const always = $('#campaign-always').checked;
    const allDevices = $('#campaign-all-devices').checked;
    const allDay = $('#campaign-all-day').checked;
    const weekdays = always ? [0,1,2,3,4,5,6] : $$('[data-campaign-weekday]:checked').map(input => Number(input.value));
    const deviceIds = allDevices ? [] : $$('[data-campaign-device]:checked').map(input => input.value);
    const startDate = always ? null : ($('#campaign-start-date').value || null);
    const endDate = always ? null : ($('#campaign-end-date').value || null);
    const startTime = always || allDay ? null : ($('#campaign-start-time').value || null);
    const endTime = always || allDay ? null : ($('#campaign-end-time').value || null);

    if (!weekdays.length) return toast('Escolha os dias', 'Selecione pelo menos um dia da semana.', 'error');
    if (!allDevices && !deviceIds.length) return toast('Escolha uma TV', 'Selecione pelo menos uma TV para esta campanha.', 'error');
    if (!always && !allDay && (!startTime || !endTime)) return toast('Informe os horários', 'Preencha início e fim da campanha.', 'error');
    if (startTime && endTime && startTime === endTime) return toast('Horário inválido', 'Início e fim não podem ser iguais.', 'error');
    if (startDate && endDate && endDate < startDate) return toast('Período inválido', 'A data final não pode vir antes da data inicial.', 'error');

    setBusy(button, true, 'Salvando...');
    try {
      await restRequest('rpc/save_campaign', {
        method: 'POST',
        body: {
          p_campaign_id: $('#campaign-id').value || null,
          p_company_id: state.company.id,
          p_name: $('#campaign-name').value.trim(),
          p_playlist_id: $('#campaign-playlist').value,
          p_description: $('#campaign-description').value.trim() || null,
          p_start_date: startDate,
          p_end_date: endDate,
          p_start_time: startTime,
          p_end_time: endTime,
          p_weekdays: weekdays,
          p_priority: Number($('#campaign-priority').value || 50),
          p_all_devices: allDevices,
          p_is_active: $('#campaign-active').checked,
          p_device_ids: deviceIds,
        },
      });
      closeDialog('campaign-dialog');
      toast('Campanha salva', 'O Vision Player aplicará a programação automaticamente.');
      await loadAllData();
    } catch (error) {
      toast('Erro ao salvar campanha', error.message, 'error');
    } finally { setBusy(button, false); }
  }

  async function toggleCampaign(id) {
    const campaign = state.campaigns.find(item => item.id === id);
    if (!campaign) return;
    try {
      await restRequest('campaigns', {
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
        body: { is_active: !campaign.is_active },
        prefer: 'return=minimal',
      });
      toast(campaign.is_active ? 'Campanha pausada' : 'Campanha ativada');
      await loadAllData();
    } catch (error) { toast('Erro ao alterar campanha', error.message, 'error'); }
  }

  async function deleteCampaign(id) {
    const campaign = state.campaigns.find(item => item.id === id);
    if (!campaign || !confirm(`Excluir a campanha “${campaign.name}”?`)) return;
    try {
      await restRequest('campaigns', {
        method: 'DELETE',
        query: `id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
      });
      toast('Campanha excluída');
      await loadAllData();
    } catch (error) { toast('Erro ao excluir campanha', error.message, 'error'); }
  }

  function companyDateKey(date = new Date()) {
    const timeZone = state.company?.timezone || 'America/Sao_Paulo';
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    const parts = Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function shiftDateKey(dateKey, days) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function ensureReportDates(days = 7) {
    const end = $('#report-end-date');
    const start = $('#report-start-date');
    if (!end || !start) return;
    const today = companyDateKey();
    if (!end.value) end.value = today;
    if (!start.value) start.value = shiftDateKey(end.value || today, -(Math.max(1, days) - 1));
  }

  function renderReportFilterOptions() {
    const campaignSelect = $('#report-campaign-filter');
    const deviceSelect = $('#report-device-filter');
    if (!campaignSelect || !deviceSelect) return;
    const selectedCampaign = campaignSelect.value;
    const selectedDevice = deviceSelect.value;
    campaignSelect.innerHTML = '<option value="">Todas as campanhas</option>' + state.campaigns.map(campaign => `<option value="${campaign.id}">${escapeHtml(campaign.name)}</option>`).join('');
    deviceSelect.innerHTML = '<option value="">Todas as TVs</option>' + state.devices.map(device => `<option value="${device.id}">${escapeHtml(device.name)}</option>`).join('');
    if ([...campaignSelect.options].some(option => option.value === selectedCampaign)) campaignSelect.value = selectedCampaign;
    if ([...deviceSelect.options].some(option => option.value === selectedDevice)) deviceSelect.value = selectedDevice;
    ensureReportDates();
    const note = $('#report-timezone-note');
    if (note) note.textContent = `Fuso: ${state.company?.timezone || 'America/Sao_Paulo'}`;
  }

  function reportFilters() {
    ensureReportDates();
    const startDate = $('#report-start-date')?.value;
    const endDate = $('#report-end-date')?.value;
    if (!startDate || !endDate) throw new Error('Informe a data inicial e final.');
    if (endDate < startDate) throw new Error('A data final não pode ser anterior à data inicial.');
    const span = Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000);
    if (span > 366) throw new Error('O período máximo do relatório é de 366 dias.');
    return {
      p_company_id: state.company.id,
      p_start_date: startDate,
      p_end_date: endDate,
      p_campaign_id: $('#report-campaign-filter')?.value || null,
      p_device_id: $('#report-device-filter')?.value || null,
    };
  }

  function resetReportVisuals() {
    ['#report-started','#report-completed','#report-completion-rate','#report-total-time','#report-device-count','#report-media-count'].forEach(selector => { const el=$(selector); if(el) el.textContent='—'; });
    ['#report-campaigns-body','#report-devices-body','#report-media-body','#report-events-body'].forEach(selector => { const el=$(selector); if(el) el.innerHTML=''; });
    const generated=$('#report-generated-label'); if(generated) generated.textContent='Carregando somente eventos reais do Player…';
  }

  async function loadPlaybackReport({ quiet = false } = {}) {
    if (!state.company?.id || state.reportLoading) return;
    state.reportLoading = true;
    state.report = null;
    resetReportVisuals();
    $('#report-loading')?.classList.remove('hidden');
    $('#report-content')?.classList.add('hidden');
    $('#report-empty')?.classList.add('hidden');
    const button = $('#report-refresh');
    setBusy(button, true, 'Atualizando...');
    try {
      const filters = reportFilters();
      state.report = await restRequest('rpc/get_playback_report', { method: 'POST', body: filters });
      renderPlaybackReport();
      if (!quiet) toast('Relatório atualizado', 'A prova de veiculação foi recalculada.');
    } catch (error) {
      state.report = null;
      $('#report-content')?.classList.add('hidden');
      $('#report-empty')?.classList.remove('hidden');
      toast('Erro ao gerar relatório', error.message, 'error');
    } finally {
      state.reportLoading = false;
      $('#report-loading')?.classList.add('hidden');
      setBusy(button, false);
    }
  }

  function formatReportSeconds(value) {
    const total = Math.max(0, Math.round(Number(value || 0)));
    if (total < 60) return `${total}s`;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (!hours) return `${minutes}min ${seconds ? `${seconds}s` : ''}`.trim();
    return `${hours}h ${minutes}min`;
  }

  function formatReportDateTime(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: state.report?.timezone || state.company?.timezone || 'America/Sao_Paulo',
        dateStyle: 'short', timeStyle: 'medium',
      }).format(new Date(value));
    } catch { return new Date(value).toLocaleString('pt-BR'); }
  }

  function reportRate(value) {
    const number = Number(value || 0);
    return `${number.toLocaleString('pt-BR', { minimumFractionDigits: number % 1 ? 1 : 0, maximumFractionDigits: 2 })}%`;
  }

  function renderPlaybackReport() {
    const report = state.report;
    if (!report) return;
    const summary = report.summary || {};
    const hasData = Number(summary.started || 0) > 0;
    $('#report-empty')?.classList.toggle('hidden', hasData);
    $('#report-content')?.classList.toggle('hidden', !hasData);
    if (!hasData) return;

    $('#report-started').textContent = Number(summary.started || 0).toLocaleString('pt-BR');
    $('#report-completed').textContent = Number(summary.completed || 0).toLocaleString('pt-BR');
    $('#report-completion-rate').textContent = reportRate(summary.completion_rate);
    $('#report-total-time').textContent = formatReportSeconds(summary.total_seconds);
    $('#report-device-count').textContent = Number(summary.devices || 0).toLocaleString('pt-BR');
    $('#report-media-count').textContent = Number(summary.media || 0).toLocaleString('pt-BR');
    $('#report-period-label').textContent = `${formatDateShort(report.start_date)} → ${formatDateShort(report.end_date)}`;
    $('#report-generated-label').textContent = `Gerado em ${formatReportDateTime(new Date().toISOString())} • ${report.timezone || state.company?.timezone || ''}`;
    $('#report-print-company').textContent = `${state.company?.name || 'Empresa'} • ${formatDateShort(report.start_date)} → ${formatDateShort(report.end_date)}`;

    const campaignRows = report.campaigns || [];
    $('#report-campaigns-body').innerHTML = campaignRows.map(row => `<tr>
      <td><strong>${escapeHtml(row.campaign_name || 'Conteúdo padrão')}</strong></td>
      <td>${Number(row.started || 0).toLocaleString('pt-BR')}</td>
      <td>${Number(row.completed || 0).toLocaleString('pt-BR')}</td>
      <td>${escapeHtml(reportRate(row.completion_rate))}</td>
      <td>${Number(row.devices || 0).toLocaleString('pt-BR')}</td>
      <td>${escapeHtml(formatReportSeconds(row.total_seconds))}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="table-empty">Sem dados de campanha.</td></tr>';

    const deviceRows = report.devices || [];
    $('#report-devices-body').innerHTML = deviceRows.map(row => `<tr>
      <td><strong>${escapeHtml(row.device_name || 'TV')}</strong></td>
      <td>${Number(row.started || 0).toLocaleString('pt-BR')}</td>
      <td>${Number(row.completed || 0).toLocaleString('pt-BR')}</td>
      <td>${escapeHtml(reportRate(row.completion_rate))}</td>
      <td>${Number(row.media || 0).toLocaleString('pt-BR')}</td>
      <td>${escapeHtml(formatReportSeconds(row.total_seconds))}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="table-empty">Sem dados por TV.</td></tr>';

    const mediaRows = report.media || [];
    $('#report-media-body').innerHTML = mediaRows.map(row => `<tr>
      <td><strong>${escapeHtml(row.media_name || 'Mídia')}</strong></td>
      <td>${Number(row.started || 0).toLocaleString('pt-BR')}</td>
      <td>${Number(row.completed || 0).toLocaleString('pt-BR')}</td>
      <td>${escapeHtml(reportRate(row.completion_rate))}</td>
      <td>${Number(row.devices || 0).toLocaleString('pt-BR')}</td>
      <td>${escapeHtml(formatReportSeconds(row.total_seconds))}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="table-empty">Sem dados por mídia.</td></tr>';

    const events = report.events || [];
    $('#report-events-body').innerHTML = events.map(event => `<tr>
      <td>${escapeHtml(formatReportDateTime(event.started_at))}</td>
      <td>${escapeHtml(event.device_name || 'TV')}</td>
      <td>${escapeHtml(event.campaign_name || 'Conteúdo padrão')}</td>
      <td>${escapeHtml(event.media_name || 'Mídia')}</td>
      <td>${escapeHtml(formatReportSeconds(event.duration_seconds))}</td>
      <td><span class="report-status ${event.completed ? 'completed' : 'partial'}">${event.completed ? 'Concluída' : 'Parcial'}</span></td>
    </tr>`).join('') || '<tr><td colspan="6" class="table-empty">Sem eventos.</td></tr>';
  }

  function applyReportPreset(preset) {
    const today = companyDateKey();
    const end = $('#report-end-date');
    const start = $('#report-start-date');
    if (!end || !start) return;
    end.value = today;
    if (preset === 'today') start.value = today;
    else start.value = shiftDateKey(today, -(Math.max(1, Number(preset || 7)) - 1));
    loadPlaybackReport({ quiet: true });
  }

  function csvCell(value) {
    const text = String(value ?? '').replaceAll('"', '""');
    return `"${text}"`;
  }

  async function exportPlaybackCsv() {
    const button = $('#report-export-csv');
    setBusy(button, true, 'Exportando...');
    try {
      const filters = reportFilters();
      const allEvents = [];
      let offset = 0;
      const pageSize = 1000;
      while (offset < 100000) {
        const page = await restRequest('rpc/get_playback_events', {
          method: 'POST',
          body: { ...filters, p_limit: pageSize, p_offset: offset },
        }) || [];
        allEvents.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }
      if (!allEvents.length) throw new Error('Não há veiculações para exportar nesse período.');
      if (allEvents.length >= 100000) toast('Exportação limitada', 'Foram exportados os 100.000 eventos mais recentes do período.', 'error', 6000);

      const rows = [
        ['Data/Hora', 'TV', 'Campanha', 'Playlist', 'Mídia', 'Duração (s)', 'Status', 'ID do evento'],
        ...allEvents.map(event => [
          formatReportDateTime(event.started_at),
          event.device_name || 'TV',
          event.campaign_name || 'Conteúdo padrão',
          event.playlist_name || '',
          event.media_name || '',
          Number(event.duration_seconds || 0),
          event.completed ? 'Concluída' : 'Parcial',
          event.client_event_id || event.id,
        ]),
      ];
      const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vision-prova-veiculacao-${filters.p_start_date}-a-${filters.p_end_date}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('CSV gerado', `${allEvents.length.toLocaleString('pt-BR')} evento(s) exportado(s).`);
    } catch (error) {
      toast('Erro ao exportar CSV', error.message, 'error');
    } finally { setBusy(button, false); }
  }

  function setView(view) {
    const titles = {
      dashboard: ['VISÃO GERAL', 'Dashboard'],
      devices: ['DISPOSITIVOS', 'TVs'],
      monitoring: ['OPERAÇÃO', 'Monitoramento'],
      media: ['BIBLIOTECA', 'Mídias'],
      playlists: ['CONTEÚDO', 'Playlists'],
      campaigns: ['PROGRAMAÇÃO', 'Campanhas'],
      reports: ['RELATÓRIOS', 'Prova de veiculação'],
    };
    state.activeView = view;
    $$('.view-section').forEach(section => section.classList.add('hidden'));
    $(`#view-${view}`)?.classList.remove('hidden');
    $$('.nav-item[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    $('#view-kicker').textContent = titles[view]?.[0] || '';
    $('#view-title').textContent = titles[view]?.[1] || '';
    $('#sidebar').classList.remove('open');
    if (view === 'reports' && !state.report && !state.reportLoading) loadPlaybackReport({ quiet: true });
  }

  function updateConnectionStatus(force) {
    const el = $('#connection-status');
    if (!el) return;
    const online = force ?? navigator.onLine;
    el.className = `status-badge ${online ? 'online' : 'offline'}`;
    el.textContent = online ? '● Conectado' : '● Sem internet';
  }

  function openDialog(id) {
    const dialog = $(`#${id}`);
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(id) {
    const dialog = $(`#${id}`);
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  async function handleLogin(event) {
    event.preventDefault();
    const button = $('#login-submit');
    setBusy(button, true, 'Entrando...');
    try {
      const data = await authRequest('/token?grant_type=password', {
        body: {
          email: $('#login-email').value.trim(),
          password: $('#login-password').value,
        },
      });
      if (!data?.access_token) throw new Error('Login não retornou uma sessão válida.');
      saveSession(data);
      await enterAuthenticatedApp();
      toast('Login realizado', 'Bem-vindo à Vision Mídia Digital.');
    } catch (error) {
      toast('Não foi possível entrar', friendlyAuthError(error), 'error');
    } finally { setBusy(button, false); }
  }

  async function handleSignup(event) {
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

  async function handleForgotPassword() {
    const email = $('#login-email').value.trim();
    if (!email) {
      toast('Informe seu e-mail', 'Preencha o e-mail para receber a recuperação.', 'error');
      $('#login-email').focus();
      return;
    }
    try {
      await authRequest('/recover', {
        body: { email, redirect_to: `${location.origin}${location.pathname}` },
      });
      toast('Recuperação enviada', 'Confira sua caixa de entrada.');
    } catch (error) {
      toast('Falha ao enviar recuperação', error.message, 'error');
    }
  }

  async function handleCreateCompany(event) {
    event.preventDefault();
    const button = $('#company-submit');
    const name = $('#company-name').value.trim();
    if (!name) return;
    setBusy(button, true, 'Criando...');
    try {
      const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 6)}`;
      const rows = await restRequest('companies', {
        method: 'POST',
        body: { name, slug, owner_user_id: state.user.id },
        prefer: 'return=representation',
      });
      state.company = rows?.[0];
      if (!state.company) throw new Error('Empresa criada, mas não retornada pela API.');
      state.companies = [state.company];
      localStorage.setItem(COMPANY_KEY, state.company.id);
      showScreen('app');
      renderIdentity();
      await loadAllData();
      setView('dashboard');
      toast('Empresa criada', 'Seu ambiente está pronto.');
    } catch (error) {
      toast('Não foi possível criar a empresa', error.message, 'error');
    } finally { setBusy(button, false); }
  }

  async function handlePairDevice(event) {
    event.preventDefault();
    const button = $('#pair-device-save');
    const code = $('#pair-device-code').value.replace(/\D/g, '');
    const name = $('#pair-device-name').value.trim();
    if (code.length !== 6 || !name) {
      toast('Confira o código', 'Informe os 6 dígitos exibidos no Vision Player.', 'error');
      return;
    }
    setBusy(button, true, 'Vinculando...');
    try {
      await functionRequest('claim-device', {
        body: {
          company_id: state.company.id,
          code,
          name,
          orientation: $('#pair-device-orientation').value,
        },
      });
      closeDialog('pair-device-dialog');
      $('#pair-device-form').reset();
      toast('TV pareada', 'O Vision Player receberá o acesso automaticamente.');
      await loadAllData();
    } catch (error) {
      toast('Não foi possível parear', error.message, 'error');
    } finally { setBusy(button, false); }
  }

  function openPairDeviceDialog() {
    $('#pair-device-code').value = '';
    $('#pair-device-name').value = '';
    $('#pair-device-orientation').value = 'auto';
    openDialog('pair-device-dialog');
    setTimeout(() => $('#pair-device-code')?.focus(), 50);
  }

  function openReplaceDeviceDialog(deviceId) {
    const device = state.devices.find(d => d.id === deviceId);
    if (!device) return;
    $('#replace-device-old-id').value = device.id;
    $('#replace-device-old-name').textContent = device.name;
    $('#replace-device-code').value = '';
    $('#replace-device-name').value = device.name;
    $('#replace-device-orientation').value = device.orientation || 'auto';
    openDialog('replace-device-dialog');
    setTimeout(() => $('#replace-device-code')?.focus(), 50);
  }

  async function handleReplaceDevice(event) {
    event.preventDefault();
    const button = $('#replace-device-save');
    const oldDeviceId = $('#replace-device-old-id').value;
    const code = $('#replace-device-code').value.replace(/\D/g, '');
    const name = $('#replace-device-name').value.trim();
    if (!oldDeviceId || code.length !== 6 || !name) {
      toast('Confira os dados', 'Informe os 6 dígitos da nova TV e um nome para ela.', 'error');
      return;
    }
    setBusy(button, true, 'Substituindo...');
    try {
      await functionRequest('replace-device', {
        body: {
          company_id: state.company.id,
          old_device_id: oldDeviceId,
          code,
          name,
          orientation: $('#replace-device-orientation').value,
        },
      });
      closeDialog('replace-device-dialog');
      $('#replace-device-form').reset();
      toast('TV substituída com sucesso', 'A vaga do plano foi mantida e a programação foi transferida para a nova TV.');
      await loadAllData();
    } catch (error) {
      toast('Não foi possível substituir a TV', error.message, 'error');
    } finally { setBusy(button, false); }
  }

  async function handleAssignPlaylist(deviceId, playlistId) {
    const existing = state.deviceAssignments.find(a => a.device_id === deviceId);
    try {
      if (!playlistId) {
        if (existing) {
          await restRequest('device_playlist_assignments', {
            method: 'DELETE',
            query: `device_id=eq.${encodeURIComponent(deviceId)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
          });
        }
        toast('Playlist removida da TV');
      } else if (existing) {
        await restRequest('device_playlist_assignments', {
          method: 'PATCH',
          query: `device_id=eq.${encodeURIComponent(deviceId)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
          body: { playlist_id: playlistId },
          prefer: 'return=minimal',
        });
        toast('Playlist atualizada');
      } else {
        await restRequest('device_playlist_assignments', {
          method: 'POST',
          body: {
            device_id: deviceId,
            company_id: state.company.id,
            playlist_id: playlistId,
            created_by: state.user.id,
          },
          prefer: 'return=minimal',
        });
        toast('Playlist atribuída à TV');
      }
      await loadAllData();
    } catch (error) {
      toast('Erro ao atribuir playlist', error.message, 'error');
      await loadAllData().catch(() => {});
    }
  }

  async function handleSaveDevice(event) {
    event.preventDefault();
    const button = $('#device-save');
    const id = $('#device-id').value;
    const payload = {
      name: $('#device-name').value.trim(),
      platform: $('#device-platform').value,
      orientation: $('#device-orientation').value,
    };
    if (!payload.name) return;
    setBusy(button, true);
    try {
      if (id) {
        await restRequest('devices', {
          method: 'PATCH',
          query: `id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
          body: payload,
          prefer: 'return=minimal',
        });
        toast('TV atualizada');
      } else {
        await restRequest('devices', {
          method: 'POST',
          body: { ...payload, company_id: state.company.id, status: 'pending' },
          prefer: 'return=minimal',
        });
        toast('TV cadastrada', 'O player será vinculado em uma etapa posterior.');
      }
      closeDialog('device-dialog');
      await loadAllData();
    } catch (error) {
      toast('Erro ao salvar TV', error.message, 'error');
    } finally { setBusy(button, false); }
  }

  function openNewDeviceDialog() {
    openPairDeviceDialog();
  }

  function openEditDeviceDialog(id) {
    const device = state.devices.find(d => d.id === id);
    if (!device) return;
    $('#device-id').value = device.id;
    $('#device-name').value = device.name;
    $('#device-platform').value = device.platform;
    $('#device-orientation').value = device.orientation;
    $('#device-dialog-title').textContent = 'Editar TV';
    openDialog('device-dialog');
  }

  async function deleteDevice(id) {
    const device = state.devices.find(d => d.id === id);
    if (!device || !confirm(`Excluir a TV “${device.name}”?`)) return;
    try {
      await restRequest('devices', {
        method: 'DELETE',
        query: `id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
      });
      toast('TV excluída');
      await loadAllData();
    } catch (error) { toast('Erro ao excluir TV', error.message, 'error'); }
  }

  async function getMediaMetadata(file) {
    const base = { duration: null, width: null, height: null };
    const url = URL.createObjectURL(file);
    try {
      if (file.type.startsWith('image/')) {
        return await new Promise(resolve => {
          const img = new Image();
          const timeout = setTimeout(() => resolve(base), 5000);
          img.onload = () => { clearTimeout(timeout); resolve({ ...base, width: img.naturalWidth, height: img.naturalHeight }); };
          img.onerror = () => { clearTimeout(timeout); resolve(base); };
          img.src = url;
        });
      }
      if (file.type.startsWith('video/')) {
        return await new Promise(resolve => {
          const video = document.createElement('video');
          const timeout = setTimeout(() => resolve(base), 7000);
          video.preload = 'metadata';
          video.onloadedmetadata = () => {
            clearTimeout(timeout);
            resolve({ duration: Number.isFinite(video.duration) ? video.duration : null, width: video.videoWidth || null, height: video.videoHeight || null });
          };
          video.onerror = () => { clearTimeout(timeout); resolve(base); };
          video.src = url;
        });
      }
      return base;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }

  async function optimizeImageForUpload(file) {
    const original = { file, name: file.name, optimized: false, originalSize: file.size };
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return original;
    let url = null;
    try {
      url = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        const timeout = setTimeout(() => reject(new Error('Tempo excedido ao otimizar imagem.')), 15000);
        el.onload = () => { clearTimeout(timeout); resolve(el); };
        el.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível abrir a imagem para otimização.')); };
        el.src = url;
      });
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      if (!sourceWidth || !sourceHeight) return original;

      // Mantém a resolução original quando já está dentro de 4K e nunca amplia imagem pequena.
      const maxEdge = 3840;
      const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return original;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.92));
      if (!blob || !blob.size) return original;
      // Se não houver ganho de tamanho, preserva o arquivo original e sua qualidade original.
      if (blob.size >= file.size) return original;
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 110) || 'imagem';
      const optimizedFile = new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() });
      return { file: optimizedFile, name: optimizedFile.name, optimized: true, originalSize: file.size, width, height };
    } catch (error) {
      console.warn('Otimização WebP ignorada; usando arquivo original.', error);
      return original;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  async function handleMediaUpload(file) {
    if (!file) return;
    if (!['image/', 'video/'].some(prefix => file.type.startsWith(prefix))) {
      toast('Formato não permitido', 'Envie uma imagem ou vídeo compatível.', 'error');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast('Arquivo muito grande', 'O limite atual é 500 MB por arquivo.', 'error');
      return;
    }

    const progress = $('#media-progress');
    const progressText = $('#media-progress-text');
    let uploadedPath = null;
    let uploadFile = file;
    let uploadName = file.name;
    let optimization = null;
    progress.classList.remove('hidden');
    try {
      if (file.type.startsWith('image/')) {
        progressText.textContent = 'Otimizando imagem em alta qualidade para WebP';
        optimization = await optimizeImageForUpload(file);
        uploadFile = optimization.file;
        uploadName = optimization.name;
      }
      progressText.textContent = 'Lendo informações do arquivo';
      const meta = await getMediaMetadata(uploadFile);
      const safeName = uploadName.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120);
      const objectPath = `${state.company.id}/${crypto.randomUUID()}-${safeName}`;
      const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');

      progressText.textContent = `Enviando ${formatBytes(uploadFile.size)}`;
      await storageRequest(`/object/${CONFIG.storageBucket}/${encodedPath}`, {
        body: uploadFile,
        contentType: uploadFile.type || 'application/octet-stream',
        extraHeaders: { 'x-upsert': 'false' },
      });
      uploadedPath = objectPath;

      progressText.textContent = 'Registrando mídia na biblioteca';
      await restRequest('media_assets', {
        method: 'POST',
        body: {
          company_id: state.company.id,
          name: uploadName,
          media_type: uploadFile.type.startsWith('video/') ? 'video' : 'image',
          mime_type: uploadFile.type || null,
          storage_path: objectPath,
          source_url: null,
          duration_seconds: meta.duration,
          size_bytes: uploadFile.size,
          width: meta.width,
          height: meta.height,
          processing_status: 'ready',
          created_by: state.user.id,
        },
        prefer: 'return=minimal',
      });
      uploadedPath = null;
      const detail = optimization?.optimized
        ? `${uploadName} • otimizada ${formatBytes(optimization.originalSize)} → ${formatBytes(uploadFile.size)} sem ampliar a imagem`
        : uploadName;
      toast('Mídia enviada', detail);
      await loadAllData();
    } catch (error) {
      if (uploadedPath) {
        try {
          await storageRequest(`/object/${CONFIG.storageBucket}`, {
            method: 'DELETE',
            body: { prefixes: [uploadedPath] },
          });
        } catch { /* best effort cleanup */ }
      }
      const friendly = String(error.message || '').includes('plan_storage_limit_reached')
        ? 'O limite de armazenamento do seu plano foi atingido.'
        : error.message;
      toast('Falha no envio', friendly, 'error');
    } finally {
      progress.classList.add('hidden');
      $('#media-file-input').value = '';
    }
  }

  async function getSignedMediaUrl(storagePath) {
    const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
    const data = await storageRequest(`/object/sign/${CONFIG.storageBucket}/${encodedPath}`, {
      method: 'POST',
      body: { expiresIn: 900 },
    });
    const signed = data?.signedURL || data?.signedUrl || data?.signed_url;
    if (!signed) throw new Error('URL temporária não gerada.');
    if (/^https?:\/\//i.test(signed)) return signed;
    return `${CONFIG.supabaseUrl}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
  }

  async function openMedia(id) {
    const media = state.media.find(m => m.id === id);
    if (!media) return;
    try {
      if (media.media_type === 'url' && media.source_url) {
        window.open(media.source_url, '_blank', 'noopener,noreferrer');
        return;
      }
      const url = await getSignedMediaUrl(media.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) { toast('Não foi possível abrir a mídia', error.message, 'error'); }
  }

  async function deleteMedia(id) {
    const media = state.media.find(m => m.id === id);
    if (!media || !confirm(`Excluir “${media.name}”? Ela também sairá das playlists.`)) return;
    try {
      if (media.storage_path) {
        await storageRequest(`/object/${CONFIG.storageBucket}`, {
          method: 'DELETE',
          body: { prefixes: [media.storage_path] },
        });
      }
      await restRequest('media_assets', {
        method: 'DELETE',
        query: `id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
      });
      toast('Mídia excluída');
      await loadAllData();
    } catch (error) { toast('Erro ao excluir mídia', error.message, 'error'); }
  }

  async function handleCreatePlaylist(event) {
    event.preventDefault();
    const button = $('#playlist-save');
    setBusy(button, true, 'Criando...');
    try {
      await restRequest('playlists', {
        method: 'POST',
        body: {
          company_id: state.company.id,
          name: $('#playlist-name').value.trim(),
          description: $('#playlist-description').value.trim() || null,
          created_by: state.user.id,
          shuffle: false,
          repeat_mode: 'loop',
        },
        prefer: 'return=minimal',
      });
      closeDialog('playlist-dialog');
      $('#playlist-form').reset();
      toast('Playlist criada');
      await loadAllData();
    } catch (error) { toast('Erro ao criar playlist', error.message, 'error'); }
    finally { setBusy(button, false); }
  }

  async function deletePlaylist(id) {
    const playlist = state.playlists.find(p => p.id === id);
    if (!playlist || !confirm(`Excluir a playlist “${playlist.name}”?`)) return;
    try {
      await restRequest('playlists', {
        method: 'DELETE',
        query: `id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
      });
      toast('Playlist excluída');
      await loadAllData();
    } catch (error) { toast('Erro ao excluir playlist', error.message, 'error'); }
  }

  function openPlaylistEditor(id) {
    state.editingPlaylistId = id;
    state.selectedPlaylistItemIds = new Set();
    renderPlaylistEditor();
    openDialog('playlist-items-dialog');
  }

  async function addMediaToPlaylist(mediaId) {
    const items = state.playlistItems.filter(i => i.playlist_id === state.editingPlaylistId);
    const nextPosition = items.length ? Math.max(...items.map(i => Number(i.position || 0))) + 1 : 0;
    try {
      await restRequest('playlist_items', {
        method: 'POST',
        body: {
          company_id: state.company.id,
          playlist_id: state.editingPlaylistId,
          media_id: mediaId,
          position: nextPosition,
          duration_override_seconds: state.media.find(m => m.id === mediaId)?.media_type === 'image' ? 10 : null,
          enabled: true,
        },
        prefer: 'return=minimal',
      });
      await loadAllData();
      renderPlaylistEditor();
    } catch (error) { toast('Erro ao adicionar mídia', error.message, 'error'); }
  }

  async function savePlaylistItemDuration(itemId) {
    const input = $(`[data-item-duration-input="${CSS.escape(itemId)}"]`);
    const seconds = Number(input?.value || 0);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400) return toast('Tempo inválido', 'Use de 1 a 86400 segundos.', 'error');
    try {
      await restRequest('playlist_items', {
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(itemId)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
        body: { duration_override_seconds: Math.round(seconds) },
        prefer: 'return=minimal',
      });
      const local = state.playlistItems.find(item => item.id === itemId);
      if (local) local.duration_override_seconds = Math.round(seconds);
      toast('Tempo atualizado', `A imagem ficará ${Math.round(seconds)} segundo(s) na tela.`);
      renderPlaylistEditor();
    } catch (error) { toast('Erro ao salvar tempo', error.message, 'error'); }
  }

  function playlistScheduleStatus(message='', type='') {
    const el = $('#playlist-schedule-status');
    if (!el) return;
    el.textContent = message;
    el.className = `form-status ${type}`.trim();
    el.classList.toggle('hidden', !message);
  }

  function selectedPlaylistItems() {
    return state.playlistItems.filter(item => item.playlist_id === state.editingPlaylistId && state.selectedPlaylistItemIds.has(item.id));
  }

  function openPlaylistScheduleDialog(ids) {
    const targetIds = Array.isArray(ids) ? ids : [...state.selectedPlaylistItemIds];
    if (!targetIds.length) return toast('Selecione uma mídia', 'Marque uma ou mais mídias da playlist para programar.', 'error');
    state.scheduleTargetItemIds = targetIds;
    const first = state.playlistItems.find(item => item.id === targetIds[0]);
    $('#playlist-schedule-count').textContent = `${targetIds.length} mídia${targetIds.length===1?'':'s'}`;
    $('#playlist-schedule-enabled').checked = first?.schedule_enabled !== false;
    $('#playlist-schedule-start-date').value = first?.start_date || '';
    $('#playlist-schedule-end-date').value = first?.end_date || '';
    $('#playlist-schedule-start-time').value = normalizeTime(first?.start_time || '');
    $('#playlist-schedule-end-time').value = normalizeTime(first?.end_time || '');
    const allDay = !(first?.start_time && first?.end_time);
    $('#playlist-schedule-all-day').checked = allDay;
    const days = new Set((Array.isArray(first?.weekdays) ? first.weekdays : [0,1,2,3,4,5,6]).map(Number));
    $$('[data-playlist-weekday]').forEach(input => { input.checked = days.has(Number(input.dataset.playlistWeekday)); });
    playlistScheduleStatus();
    syncPlaylistScheduleFormVisibility();
    openDialog('playlist-schedule-dialog');
  }

  function syncPlaylistScheduleFormVisibility() {
    const enabled = $('#playlist-schedule-enabled')?.checked !== false;
    const allDay = $('#playlist-schedule-all-day')?.checked !== false;
    $$('.schedule-date-fields input').forEach(input => input.disabled = !enabled);
    $('#playlist-schedule-all-day').disabled = !enabled;
    $$('[data-playlist-weekday]').forEach(input => input.disabled = !enabled);
    $('#playlist-schedule-time-fields').classList.toggle('hidden', !enabled || allDay);
  }

  async function applyPlaylistSchedule(event) {
    event.preventDefault();
    const ids = state.scheduleTargetItemIds.filter(Boolean);
    if (!ids.length) return;
    const enabled = $('#playlist-schedule-enabled').checked;
    const allDay = $('#playlist-schedule-all-day').checked;
    const weekdays = $$('[data-playlist-weekday]').filter(input => input.checked).map(input => Number(input.dataset.playlistWeekday));
    const startDate = $('#playlist-schedule-start-date').value || null;
    const endDate = $('#playlist-schedule-end-date').value || null;
    const startTime = enabled && !allDay ? ($('#playlist-schedule-start-time').value || null) : null;
    const endTime = enabled && !allDay ? ($('#playlist-schedule-end-time').value || null) : null;
    if (enabled && !weekdays.length) return playlistScheduleStatus('❌ Selecione pelo menos um dia da semana.', 'error');
    if (startDate && endDate && endDate < startDate) return playlistScheduleStatus('❌ A data final não pode ser anterior à inicial.', 'error');
    if (enabled && !allDay && (!startTime || !endTime)) return playlistScheduleStatus('❌ Informe a hora inicial e final.', 'error');
    const button = $('#playlist-schedule-save');
    setBusy(button, true, 'Aplicando...');
    playlistScheduleStatus('Salvando programação...', 'pending');
    try {
      const payload = { schedule_enabled: enabled, start_date: enabled ? startDate : null, end_date: enabled ? endDate : null, start_time: enabled ? startTime : null, end_time: enabled ? endTime : null, weekdays: enabled ? weekdays : [0,1,2,3,4,5,6] };
      await Promise.all(ids.map(id => restRequest('playlist_items', { method:'PATCH', query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`, body:payload, prefer:'return=minimal' })));
      await loadAllData();
      playlistScheduleStatus('✅ Programação salva com sucesso.', 'success');
      toast('Programação salva', `${ids.length} mídia(s) atualizada(s).`);
      setTimeout(() => closeDialog('playlist-schedule-dialog'), 650);
    } catch (error) { playlistScheduleStatus(`❌ ${error.message}`, 'error'); toast('Erro ao programar mídias', error.message, 'error'); }
    finally { setBusy(button, false); }
  }

  async function clearPlaylistSchedule() {
    const ids = state.scheduleTargetItemIds.filter(Boolean);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map(id => restRequest('playlist_items', { method:'PATCH', query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`, body:{schedule_enabled:false,start_date:null,end_date:null,start_time:null,end_time:null,weekdays:[0,1,2,3,4,5,6]}, prefer:'return=minimal' })));
      await loadAllData();
      closeDialog('playlist-schedule-dialog');
      toast('Programação removida', 'As mídias voltaram a ficar disponíveis sempre.');
    } catch (error) { playlistScheduleStatus(`❌ ${error.message}`, 'error'); }
  }

  async function setSelectedPlaylistEnabled(enabled) {
    const ids = [...state.selectedPlaylistItemIds];
    if (!ids.length) return;
    try {
      await Promise.all(ids.map(id => restRequest('playlist_items',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,body:{enabled},prefer:'return=minimal'})));
      await loadAllData();
      toast(enabled ? 'Mídias ativadas' : 'Mídias desativadas', `${ids.length} item(ns) atualizado(s).`);
    } catch (error) { toast('Erro ao atualizar mídias', error.message, 'error'); }
  }

  async function togglePlaylistItemEnabled(itemId) {
    const item = state.playlistItems.find(row => row.id === itemId);
    if (!item) return;
    state.selectedPlaylistItemIds = new Set([itemId]);
    await setSelectedPlaylistEnabled(!item.enabled);
  }

  async function replaceSelectedPlaylistMedia() {
    const mediaId = $('#playlist-bulk-replace-media')?.value || '';
    const ids = [...state.selectedPlaylistItemIds];
    if (!ids.length) return toast('Selecione uma mídia', '', 'error');
    if (!mediaId) return toast('Escolha a substituição', 'Selecione a nova mídia no campo “Substituir por”.', 'error');
    const media = state.media.find(row => row.id === mediaId);
    if (!media) return;
    if (!confirm(`Substituir ${ids.length} item(ns) por “${media.name}”?`)) return;
    try {
      await Promise.all(ids.map(id => restRequest('playlist_items',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,body:{media_id:mediaId,duration_override_seconds:media.media_type==='image'?10:null},prefer:'return=minimal'})));
      await loadAllData();
      toast('Mídias substituídas', `${ids.length} item(ns) atualizado(s).`);
    } catch (error) { toast('Erro ao substituir', error.message, 'error'); }
  }

  async function deleteSelectedPlaylistItems() {
    const ids = [...state.selectedPlaylistItemIds];
    if (!ids.length || !confirm(`Excluir ${ids.length} item(ns) desta playlist?`)) return;
    try {
      await Promise.all(ids.map(id => restRequest('playlist_items',{method:'DELETE',query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`})));
      state.selectedPlaylistItemIds = new Set();
      await loadAllData();
      toast('Itens removidos', `${ids.length} mídia(s) removida(s) da sequência.`);
    } catch (error) { toast('Erro ao excluir itens', error.message, 'error'); }
  }

  async function persistPlaylistOrder(orderedIds) {
    if (!orderedIds?.length) return;
    try {
      await Promise.all(orderedIds.map((id,index) => restRequest('playlist_items',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,body:{position:index},prefer:'return=minimal'})));
      orderedIds.forEach((id,index)=>{const item=state.playlistItems.find(row=>row.id===id);if(item)item.position=index;});
      renderPlaylistEditor();
      toast('Ordem atualizada');
    } catch (error) { toast('Erro ao reordenar', error.message, 'error'); await loadAllData().catch(()=>{}); }
  }

  async function removePlaylistItem(itemId) {
    try {
      await restRequest('playlist_items', {
        method: 'DELETE',
        query: `id=eq.${encodeURIComponent(itemId)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
      });
      await loadAllData();
      renderPlaylistEditor();
    } catch (error) { toast('Erro ao remover mídia', error.message, 'error'); }
  }

  async function movePlaylistItem(itemId, direction) {
    const items = state.playlistItems
      .filter(i => i.playlist_id === state.editingPlaylistId)
      .sort((a,b) => a.position - b.position);
    const index = items.findIndex(i => i.id === itemId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return;
    const current = items[index];
    const target = items[targetIndex];
    try {
      await Promise.all([
        restRequest('playlist_items', {
          method: 'PATCH',
          query: `id=eq.${encodeURIComponent(current.id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
          body: { position: target.position },
        }),
        restRequest('playlist_items', {
          method: 'PATCH',
          query: `id=eq.${encodeURIComponent(target.id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
          body: { position: current.position },
        }),
      ]);
      await loadAllData();
      renderPlaylistEditor();
    } catch (error) { toast('Erro ao reordenar', error.message, 'error'); }
  }

  async function logout() {
    try {
      if (state.session?.access_token) {
        await fetch(`${CONFIG.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: sessionHeaders(false) });
      }
    } catch { /* local logout still proceeds */ }
    saveSession(null);
    localStorage.removeItem(COMPANY_KEY);
    state.company = null;
    state.devices = [];
    state.media = [];
    state.playlists = [];
    state.playlistItems = [];
    state.deviceAssignments = [];
    state.campaigns = [];
    state.campaignDevices = [];
    state.report = null;
    showScreen('auth');
    toast('Você saiu da conta');
  }

  function switchAuthTab(tab) {
    $$('.auth-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.authTab === tab));
    $('#login-form').classList.toggle('hidden', tab !== 'login');
    $('#signup-form').classList.toggle('hidden', tab !== 'signup');
  }

  function bindEvents() {
    $$('.auth-tab').forEach(btn => btn.addEventListener('click', () => switchAuthTab(btn.dataset.authTab)));
    $('#login-form').addEventListener('submit', handleLogin);
    $('#signup-form').addEventListener('submit', handleSignup);
    $('#forgot-password').addEventListener('click', handleForgotPassword);
    $('#company-form').addEventListener('submit', handleCreateCompany);
    $('#access-refresh').addEventListener('click', () => enterAuthenticatedApp().catch(error => toast('Falha ao verificar acesso', error.message, 'error')));
    $('#access-logout').addEventListener('click', logout);
    $('#access-notifications').addEventListener('click', enableAccessNotifications);
    $('#logout-button').addEventListener('click', logout);
    $('#refresh-button').addEventListener('click', async () => {
      try { await loadAllData(); toast('Dados atualizados'); }
      catch (error) { toast('Falha ao atualizar', error.message, 'error'); }
    });
    $('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $$('.nav-item[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    $$('[data-go-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.goView)));
    $$('[data-action="quick-device"]').forEach(btn => btn.addEventListener('click', () => { setView('devices'); openPairDeviceDialog(); }));

    $('#add-device-button').addEventListener('click', openPairDeviceDialog);
    $('#monitor-refresh').addEventListener('click', async () => {
      const button = $('#monitor-refresh');
      setBusy(button, true, 'Atualizando...');
      try { await loadAllData(); toast('Monitoramento atualizado'); }
      catch (error) { toast('Falha ao atualizar monitoramento', error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('#monitor-severity-filter').addEventListener('change', renderMonitoring);
    $('#pair-device-form').addEventListener('submit', handlePairDevice);
    $('#view-tv-refresh').addEventListener('click', refreshTvViewer);
    $('#replace-device-form').addEventListener('submit', handleReplaceDevice);
    $('#device-form').addEventListener('submit', handleSaveDevice);
    $('#add-playlist-button').addEventListener('click', () => openDialog('playlist-dialog'));
    $('#playlist-form').addEventListener('submit', handleCreatePlaylist);
    $('#player-branding-form').addEventListener('submit', savePlayerBranding);
    $('#branding-copy-url').addEventListener('click', async () => { const value=$('#branding-player-url').value; try{await navigator.clipboard.writeText(value);toast('Link copiado')}catch{$('#branding-player-url').select();document.execCommand('copy');toast('Link copiado')} });
    $('#branding-open-player').addEventListener('click', () => window.open($('#branding-player-url').value || './player.html','_blank','noopener'));
    $('#playlist-schedule-form').addEventListener('submit', applyPlaylistSchedule);
    $('#playlist-schedule-clear').addEventListener('click', clearPlaylistSchedule);
    $('#playlist-schedule-enabled').addEventListener('change', syncPlaylistScheduleFormVisibility);
    $('#playlist-schedule-all-day').addEventListener('change', syncPlaylistScheduleFormVisibility);
    $('#playlist-bulk-schedule').addEventListener('click', () => openPlaylistScheduleDialog());
    $('#playlist-bulk-enable').addEventListener('click', () => setSelectedPlaylistEnabled(true));
    $('#playlist-bulk-disable').addEventListener('click', () => setSelectedPlaylistEnabled(false));
    $('#playlist-bulk-replace').addEventListener('click', replaceSelectedPlaylistMedia);
    $('#playlist-bulk-delete').addEventListener('click', deleteSelectedPlaylistItems);
    $('#add-campaign-button').addEventListener('click', () => openCampaignDialog());
    $('#empty-add-campaign-button').addEventListener('click', () => openCampaignDialog());
    $('#campaign-form').addEventListener('submit', handleSaveCampaign);
    $('#campaign-always').addEventListener('change', syncCampaignFormVisibility);
    $('#campaign-all-devices').addEventListener('change', syncCampaignFormVisibility);
    $('#campaign-all-day').addEventListener('change', syncCampaignFormVisibility);
    $('#report-refresh').addEventListener('click', () => loadPlaybackReport());
    $('#report-export-csv').addEventListener('click', exportPlaybackCsv);
    $('#report-print').addEventListener('click', () => { if (!state.report?.summary?.started) return toast('Sem dados para imprimir', 'Gere um relatório com veiculações primeiro.', 'error'); window.print(); });
    $$('[data-report-preset]').forEach(button => button.addEventListener('click', () => applyReportPreset(button.dataset.reportPreset)));
    $('#media-file-input').addEventListener('change', event => handleMediaUpload(event.target.files?.[0]));

    $$('[data-close-dialog]').forEach(btn => btn.addEventListener('click', () => closeDialog(btn.dataset.closeDialog)));

    document.addEventListener('click', event => {
      const viewDevice = event.target.closest('[data-view-device]');
      if (viewDevice) return openTvViewer(viewDevice.dataset.viewDevice);
      const captureDevice = event.target.closest('[data-capture-device]');
      if (captureDevice) return requestDeviceScreenshot(captureDevice.dataset.captureDevice);
      const replaceDevice = event.target.closest('[data-replace-device]');
      if (replaceDevice) return openReplaceDeviceDialog(replaceDevice.dataset.replaceDevice);
      const editDevice = event.target.closest('[data-edit-device]');
      if (editDevice) return openEditDeviceDialog(editDevice.dataset.editDevice);
      const deleteDeviceButton = event.target.closest('[data-delete-device]');
      if (deleteDeviceButton) return deleteDevice(deleteDeviceButton.dataset.deleteDevice);
      const openMediaButton = event.target.closest('[data-open-media]');
      if (openMediaButton) return openMedia(openMediaButton.dataset.openMedia);
      const deleteMediaButton = event.target.closest('[data-delete-media]');
      if (deleteMediaButton) return deleteMedia(deleteMediaButton.dataset.deleteMedia);
      const deletePlaylistButton = event.target.closest('[data-delete-playlist]');
      if (deletePlaylistButton) return deletePlaylist(deletePlaylistButton.dataset.deletePlaylist);
      const editPlaylistItems = event.target.closest('[data-edit-playlist-items]');
      if (editPlaylistItems) return openPlaylistEditor(editPlaylistItems.dataset.editPlaylistItems);
      const editCampaign = event.target.closest('[data-edit-campaign]');
      if (editCampaign) return openCampaignDialog(editCampaign.dataset.editCampaign);
      const toggleCampaignButton = event.target.closest('[data-toggle-campaign]');
      if (toggleCampaignButton) return toggleCampaign(toggleCampaignButton.dataset.toggleCampaign);
      const deleteCampaignButton = event.target.closest('[data-delete-campaign]');
      if (deleteCampaignButton) return deleteCampaign(deleteCampaignButton.dataset.deleteCampaign);
      const addMedia = event.target.closest('[data-add-media-to-playlist]');
      if (addMedia) return addMediaToPlaylist(addMedia.dataset.addMediaToPlaylist);
      const saveDuration = event.target.closest('[data-save-item-duration]');
      if (saveDuration) return savePlaylistItemDuration(saveDuration.dataset.saveItemDuration);
      const editItemSchedule = event.target.closest('[data-edit-item-schedule]');
      if (editItemSchedule) { state.selectedPlaylistItemIds = new Set([editItemSchedule.dataset.editItemSchedule]); renderPlaylistEditor(); return openPlaylistScheduleDialog([editItemSchedule.dataset.editItemSchedule]); }
      const toggleItem = event.target.closest('[data-toggle-item-enabled]');
      if (toggleItem) return togglePlaylistItemEnabled(toggleItem.dataset.toggleItemEnabled);
      const removeItem = event.target.closest('[data-remove-item]');
      if (removeItem) return removePlaylistItem(removeItem.dataset.removeItem);
      const moveItem = event.target.closest('[data-move-item]');
      if (moveItem) return movePlaylistItem(moveItem.dataset.moveItem, moveItem.dataset.direction);
    });

    document.addEventListener('change', event => {
      const itemCheck = event.target.closest('[data-select-playlist-item]');
      if (itemCheck) { if(itemCheck.checked) state.selectedPlaylistItemIds.add(itemCheck.dataset.selectPlaylistItem); else state.selectedPlaylistItemIds.delete(itemCheck.dataset.selectPlaylistItem); syncPlaylistBulkUi(); return; }
      if (event.target.id === 'playlist-select-all') { const checked=event.target.checked; const items=state.playlistItems.filter(i=>i.playlist_id===state.editingPlaylistId); state.selectedPlaylistItemIds = checked ? new Set(items.map(i=>i.id)) : new Set(); renderPlaylistEditor(); return; }
      const select = event.target.closest('[data-device-playlist]');
      if (select) handleAssignPlaylist(select.dataset.devicePlaylist, select.value);
    });


    document.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-playlist-drag-item]');
      if (!row) return;
      state.draggingPlaylistItemId = row.dataset.playlistDragItem;
      row.classList.add('dragging');
      if (event.dataTransfer) { event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain', state.draggingPlaylistItemId); }
    });
    document.addEventListener('dragover', event => {
      const row = event.target.closest('[data-playlist-drag-item]');
      if (!row || !state.draggingPlaylistItemId) return;
      event.preventDefault();
      $$('.playlist-item-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
      if (row.dataset.playlistDragItem !== state.draggingPlaylistItemId) row.classList.add('drag-over');
    });
    document.addEventListener('drop', event => {
      const row = event.target.closest('[data-playlist-drag-item]');
      if (!row || !state.draggingPlaylistItemId) return;
      event.preventDefault();
      const dragged=state.draggingPlaylistItemId,target=row.dataset.playlistDragItem;
      const ids=state.playlistItems.filter(i=>i.playlist_id===state.editingPlaylistId).sort((a,b)=>a.position-b.position).map(i=>i.id);
      const from=ids.indexOf(dragged),to=ids.indexOf(target);
      if(from>=0&&to>=0&&from!==to){ids.splice(from,1);ids.splice(to,0,dragged);persistPlaylistOrder(ids);}
      state.draggingPlaylistItemId=null;
      $$('.playlist-item-row').forEach(el=>el.classList.remove('dragging','drag-over'));
    });
    document.addEventListener('dragend', () => { state.draggingPlaylistItemId=null; $$('.playlist-item-row').forEach(el=>el.classList.remove('dragging','drag-over')); });

    $('#view-tv-dialog').addEventListener('close', () => { state.viewingDeviceId = null; });
    $('#playlist-items-dialog').addEventListener('close', () => { state.editingPlaylistId = null; state.selectedPlaylistItemIds = new Set(); });
  }

  bootstrap().catch(error => {
    console.error(error);
    toast('Erro ao iniciar o painel', error.message, 'error', 8000);
  });
})();
