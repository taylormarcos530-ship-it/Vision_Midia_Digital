(() => {
  'use strict';
  // preview-refresh-v39-timed-access
  // preview-refresh-v40-force-vercel-after-tv-list-fix
  // preview-refresh-v41-after-vercel-preview-settings-reset
  // preview-refresh-v42-vercel-root-player-and-stale-manifest-fix
  // preview-refresh-v37-media-library
  // preview-refresh-v38-complete-media
  // preview-refresh-v36-complete-playlists

  const CONFIG = window.VISION_CONFIG;
  if (!CONFIG?.supabaseUrl || !CONFIG?.supabasePublishableKey) {
    document.body.innerHTML = '<main style="padding:40px;color:white">Configuração do Supabase ausente.</main>';
    return;
  }

  const SESSION_KEY = 'vision_midia_session_v1';
  const COMPANY_KEY = 'vision_midia_company_v1';
  const VIEW_KEY = 'vision_midia_active_view_v1';
  const ACTIVE_AREA_KEY = 'vision_midia_active_area_v1';
  const LOGIN_VISUAL_PREVIEW_KEY = 'vision_midia_login_visual_preview_v1';
  const VALID_OPERATIONAL_VIEWS = new Set(['dashboard', 'devices', 'monitoring', 'media', 'playlists', 'campaigns', 'reports', 'inbox']);
  const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
  const EXPECTED_PLAYER_VERSION = 'vision-player-web-1.5.3';
  const EXPECTED_APK_VERSION = '1.5.3-preview';

  function readLocalValue(key) {
    try { return localStorage.getItem(key); }
    catch { return null; }
  }

  function writeLocalValue(key, value) {
    try { localStorage.setItem(key, value); }
    catch {}
  }

  function readLoginVisualPreview() {
    try {
      const raw = localStorage.getItem(LOGIN_VISUAL_PREVIEW_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function applyLoginVisual(serverConfig = {}) {
    const serverSupportsLoginVisual = Object.prototype.hasOwnProperty.call(serverConfig || {}, 'login_image_fit');
    const local = serverSupportsLoginVisual ? {} : (readLoginVisualPreview() || {});
    const config = {
      imageUrl: local.imageDataUrl || serverConfig.login_image_url || '',
      fit: local.fit || serverConfig.login_image_fit || 'cover',
      position: local.position || serverConfig.login_image_position || 'center',
      overlay: Number.isFinite(Number(local.overlay)) ? Number(local.overlay) : Number(serverConfig.login_image_overlay ?? 42),
      title: local.title || serverConfig.login_image_title || 'Sua operação visual, organizada em um só lugar.',
      subtitle: local.subtitle || serverConfig.login_image_subtitle || 'Gerencie telas, conteúdos, playlists e campanhas com controle profissional.',
    };

    const panel = $('#auth-visual');
    const image = $('#auth-visual-image');
    if (!panel || !image) return;

    panel.style.setProperty('--auth-visual-fit', ['cover','contain'].includes(config.fit) ? config.fit : 'cover');
    panel.style.setProperty('--auth-visual-position', config.position || 'center');
    panel.style.setProperty('--auth-visual-overlay', String(Math.max(0, Math.min(1, Number(config.overlay || 0) / 100))));
    $('#auth-visual-title').textContent = config.title;
    $('#auth-visual-subtitle').textContent = config.subtitle;

    if (config.imageUrl) {
      const nextSrc = String(config.imageUrl);
      if (image.dataset.visionSrc === nextSrc && image.getAttribute('src')) {
        image.classList.remove('hidden');
        panel.dataset.hasImage = 'true';
      } else {
        const preload = new Image();
        preload.onload = () => {
          if (!image.isConnected) return;
          image.src = nextSrc;
          image.dataset.visionSrc = nextSrc;
          image.classList.remove('hidden');
          panel.dataset.hasImage = 'true';
        };
        preload.src = nextSrc;
      }
    } else {
      image.removeAttribute('src');
      delete image.dataset.visionSrc;
      image.classList.add('hidden');
      panel.dataset.hasImage = 'false';
    }
  }

  const savedOperationalView = readLocalValue(VIEW_KEY);

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
    deviceGroups: [],
    deviceGroupMembers: [],
    campaigns: [],
    campaignDevices: [],
    deviceEvents: [],
    deviceCommands: [],
    deviceHeartbeats: [],
    companyMembers: [],
    profiles: [],
    notifications: [],
    expiryCompanies: [],
    notificationUnreadCount: 0,
    notificationFilter: 'all',
    selectedNotificationIds: new Set(),
    deviceScreenshots: [],
    playerBranding: null,
    isPlatformAdmin: false,
    selectedPlaylistItemIds: new Set(),
    scheduleTargetItemIds: [],
    draggingPlaylistItemId: null,
    report: null,
    reportLoading: false,
    activeView: VALID_OPERATIONAL_VIEWS.has(savedOperationalView) ? savedOperationalView : 'dashboard',
    editingPlaylistId: null,
    viewingDeviceId: null,
    isBusy: false,
    deviceCaptureStates: new Map(),
    autoCaptureRequested: new Set(),
    deviceScreenshotUrls: new Map(),
    mediaPreviewUrls: new Map(),
    mediaRenderSignature: '',
    playlistRenderSignature: '',
    playlistEditorRenderSignature: '',
    playlistItemRenderLimit: 60,
    playlistMediaRenderLimit: 60,
    playlistMediaQuery: '',
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let lastActionButton = null;
  let lastActionAt = 0;
  let accessGateRefreshing = false;
  let accessGateTimer = null;
  let tvViewerResizeObserver = null;

  function isFeedbackActionButton(button) {
    if (!button) return false;
    return !button.matches('.nav-item,.auth-tab,[data-view],[data-saas-view],[data-close-dialog],[data-action="open-sidebar"],[data-action="close-sidebar"]');
  }

  function trackActionButton(button) {
    if (!isFeedbackActionButton(button)) return;
    lastActionButton = button;
    lastActionAt = Date.now();
  }

  function applyButtonFeedback(type) {
    const button = lastActionButton;
    if (!button || !button.isConnected || Date.now() - lastActionAt > 45000) return;
    const resultText = type === 'error' ? '✕ Erro' : '✓ Sucesso';
    button.dataset.feedbackResult = resultText;
    if (!button.disabled) {
      const original = button.dataset.originalText || button.dataset.feedbackOriginal || button.textContent;
      button.dataset.feedbackOriginal = original;
      button.textContent = resultText;
      clearTimeout(button._visionFeedbackTimer);
      button._visionFeedbackTimer = setTimeout(() => {
        if (!button.isConnected || button.disabled) return;
        button.textContent = button.dataset.feedbackOriginal || original;
        delete button.dataset.feedbackOriginal;
        delete button.dataset.feedbackResult;
      }, 1400);
    }
  }

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
      button.dataset.originalText = button.dataset.originalText || button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.disabled = false;
      const resultText = button.dataset.feedbackResult;
      if (resultText) {
        button.textContent = resultText;
        delete button.dataset.feedbackResult;
        clearTimeout(button._visionFeedbackTimer);
        button._visionFeedbackTimer = setTimeout(() => {
          if (!button.isConnected || button.disabled) return;
          button.textContent = button.dataset.originalText || button.textContent;
          delete button.dataset.originalText;
        }, 1400);
      } else {
        button.textContent = button.dataset.originalText || button.textContent;
        delete button.dataset.originalText;
      }
    }
  }

  function toast(title, message = '', type = 'success', timeout = 3500) {
    const writeFeedback = /(salv|criad|atualiz|adicion|enviad|paread|programad|atribu|reordenad|substitu|configurad|alterad)/i.test(String(title));
    const readOnlyRefresh = /^(Relatório|Monitoramento|Status|Captura).*atualiz/i.test(String(title));
    if (type === 'success' && title !== 'Salvo com sucesso' && writeFeedback && !readOnlyRefresh) {
      message = message ? `${title}. ${message}` : title;
      title = 'Salvo com sucesso';
    }
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}`;
    root.appendChild(el);
    applyButtonFeedback(type);
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
    state.session = session || null;
    state.user = session?.user || null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    window.dispatchEvent(new CustomEvent('vision-session-changed', { detail: { authenticated: Boolean(session?.access_token) } }));
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
          fetch(`${CONFIG.supabaseUrl}/rest/v1/platform_public_config?select=support_whatsapp,signup_whatsapp_message,renewal_whatsapp_message,signup_enabled,login_image_path,login_image_fit,login_image_position,login_image_overlay,login_image_title,login_image_subtitle,web_push_public_key&id=eq.1&limit=1`, { headers, cache: 'no-store' }),
        ]);
        if (!plansResponse.ok || !configResponse.ok) throw primaryError;
        const plans = await plansResponse.json();
        const configs = await configResponse.json();
        const publicConfig = configs?.[0] || {};
        if (publicConfig.login_image_path) {
          publicConfig.login_image_url = `${CONFIG.supabaseUrl}/storage/v1/object/public/platform-public/${encodeURI(publicConfig.login_image_path)}`;
        }
        data = { ok: true, plans: plans || [], config: publicConfig };
      } catch (fallbackError) {
        const select = $('#signup-plan');
        if (select) select.innerHTML = '<option value="">Não foi possível carregar os planos</option>';
        throw fallbackError;
      }
    }
    state.publicConfig = data || { config: {}, plans: [] };
    applyLoginVisual(state.publicConfig.config || {});
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

  function formatAccessDateTime(value) {
    if (!value) return 'Não definido';
    try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
    catch { return '—'; }
  }

  function renderAccessScreen(reason = accessReason()) {
    reason = reason || { key:'pending', title:'Aguardando aprovação', message:'Aguarde a liberação do administrador.' };
    $('#access-title').textContent = reason.title;
    $('#access-message').textContent = reason.message;
    $('#access-company').textContent = state.company?.name || 'Cadastro ainda não vinculado';
    const plan = (state.publicConfig?.plans || []).find(p => p.id === state.subscription?.plan_id);
    $('#access-plan').textContent = plan?.name || 'A definir';
    const trialActive = state.subscription?.status === 'trialing' && Boolean(state.subscription?.trial_ends_at);
    const dueLabel = $('#access-due-label');
    if (dueLabel) dueLabel.textContent = trialActive ? 'Teste até' : 'Vencimento';
    $('#access-due').textContent = trialActive ? formatAccessDateTime(state.subscription?.trial_ends_at) : formatAccessDate(state.subscription?.current_period_end);
    const cfg = state.publicConfig?.config || {};
    const phone = String(cfg.support_whatsapp || '').replace(/\D/g, '');
    const message = reason.key === 'renewal' ? cfg.renewal_whatsapp_message : cfg.signup_whatsapp_message;
    const link = $('#access-whatsapp');
    if (phone) {
      link.href = `https://wa.me/${phone}?text=${encodeURIComponent(message || 'Olá! Preciso de ajuda com meu acesso à Vision Mídia Digital.')}`;
      link.classList.remove('hidden');
    } else link.classList.add('hidden');
    const payLink = $('#access-payment');
    const paymentUrl = String(state.subscription?.payment_url || '').trim();
    const paymentNeeded = !['paid','waived'].includes(state.subscription?.payment_status || 'pending');
    if (payLink && paymentUrl && paymentNeeded) {
      payLink.href = paymentUrl;
      payLink.classList.remove('hidden');
    } else if (payLink) {
      payLink.removeAttribute('href');
      payLink.classList.add('hidden');
    }
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

  async function notifyAccessGranted() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const key = `vision_access_granted_${state.subscription?.updated_at || state.subscription?.trial_ends_at || 'current'}`;
    if (localStorage.getItem(key)) return;
    const body = state.subscription?.status === 'trialing' && state.subscription?.trial_ends_at
      ? `Seu teste foi liberado até ${formatAccessDateTime(state.subscription.trial_ends_at)}.`
      : 'Seu acesso foi liberado. O painel já está disponível.';
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg?.showNotification) await reg.showNotification('Vision Mídia Digital • Acesso liberado', { body, icon:'./icon.svg', tag:'vision-access-granted' });
      else new Notification('Vision Mídia Digital • Acesso liberado', { body });
      localStorage.setItem(key, '1');
    } catch {}
  }

  function pushApplicationServerKey(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const raw = atob(normalized + padding);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function ensurePersistentPushSubscription() {
    if (!state.user?.id || !state.company?.id) throw new Error('Entre em uma conta vinculada antes de ativar as notificações.');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Este navegador não oferece Web Push persistente.');
    if (!('Notification' in window) || Notification.permission !== 'granted') throw new Error('A permissão de notificações ainda não foi concedida.');

    const publicKey = String(state.publicConfig?.config?.web_push_public_key || '').trim();
    if (!publicKey) throw new Error('O Web Push ainda não foi configurado no servidor.');

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: pushApplicationServerKey(publicKey),
      });
    }

    const json = subscription.toJSON();
    if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) throw new Error('O navegador não retornou uma inscrição Web Push válida.');

    await functionRequest('web-push', {
      authenticated: true,
      body: {
        action: 'subscribe',
        company_id: state.company.id,
        subscription: json,
      },
    });
    return subscription;
  }

  async function enableAccessNotifications() {
    if (!('Notification' in window)) return toast('Notificações indisponíveis', 'Este navegador não oferece suporte.', 'error');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return toast('Notificações não ativadas', 'Permita notificações nas configurações do site.', 'error');
    try {
      await ensurePersistentPushSubscription();
      toast('Notificações ativadas', 'O Web Push ficou registrado neste aparelho e pode avisar mesmo com o app totalmente fechado.');
    } catch (error) {
      toast('Notificação local ativada', error.message || 'Não foi possível registrar o Web Push persistente.', 'error', 6500);
    }
    const reason = accessReason(); if (reason) notifyAccessState(reason);
  }

  async function refreshAccessGate({ manual = false } = {}) {
    if (accessGateRefreshing || !state.user) return false;
    accessGateRefreshing = true;
    try {
      const wasBlocked = !$('#access-screen').classList.contains('hidden');
      const wasApp = !$('#app-shell').classList.contains('hidden');
      if (!state.company?.id) {
        await enterAuthenticatedApp();
        const nowBlocked = !$('#access-screen').classList.contains('hidden');
        if (wasBlocked && !nowBlocked) await notifyAccessGranted();
        return !nowBlocked;
      }
      const companyId = encodeURIComponent(state.company.id);
      const [companies, subscriptions] = await Promise.all([
        restRequest('companies', { query: `select=id,name,status,timezone,owner_user_id,settings,fallback_playlist_id&id=eq.${companyId}&limit=1` }),
        restRequest('company_subscriptions', { query: `select=*&company_id=eq.${companyId}&limit=1` }),
      ]);
      if (companies?.[0]) state.company = { ...state.company, ...companies[0] };
      state.subscription = subscriptions?.[0] || null;
      const reason = accessReason();
      if (!reason) {
        if (wasBlocked) {
          await notifyAccessGranted();
          showScreen('app');
          renderIdentity();
          await loadAllData();
          setView(state.activeView);
          const detail = state.subscription?.status === 'trialing' && state.subscription?.trial_ends_at
            ? `Teste liberado até ${formatAccessDateTime(state.subscription.trial_ends_at)}.`
            : 'Seu painel já está disponível.';
          toast('Acesso liberado', detail);
        }
        return true;
      }
      if (wasApp) {
        showScreen('access');
        renderAccessScreen(reason);
        await notifyAccessState(reason);
        toast(reason.title, reason.message, 'error', 6000);
      } else if (wasBlocked) {
        renderAccessScreen(reason);
        if (manual) {
          const status = $('#access-refresh-status');
          if (status) {
            status.textContent = reason.message;
            status.className = 'access-refresh-status pending';
            status.classList.remove('hidden');
          }
        }
      }
      return false;
    } finally { accessGateRefreshing = false; }
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
    const refreshGateSoon = () => { if (state.user) refreshAccessGate().catch(() => {}); };
    window.addEventListener('online', refreshGateSoon);
    window.addEventListener('focus', refreshGateSoon);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshGateSoon(); });
    accessGateTimer = setInterval(refreshGateSoon, 10_000);
    setInterval(() => {
      if (state.company?.id && !document.hidden && !$('#app-shell').classList.contains('hidden')) loadAllData().catch(() => updateConnectionStatus(false));
    }, 30_000);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    if (openPasswordRecoveryFromUrl()) return;

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
      query: 'select=id,name,slug,status,timezone,owner_user_id,created_at,settings,fallback_playlist_id&order=created_at.asc',
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
    try {
      const adminResult = await restRequest('rpc/current_user_is_platform_admin', { method: 'POST', body: {} });
      state.isPlatformAdmin =
        adminResult === true ||
        adminResult === 'true' ||
        adminResult?.value === true ||
        (Array.isArray(adminResult) && (adminResult[0] === true || adminResult[0]?.current_user_is_platform_admin === true));
    } catch { state.isPlatformAdmin = false; }
    const reason = accessReason(state.subscription);
    if (reason) {
      showScreen('access');
      renderAccessScreen(reason);
      if ('Notification' in window && Notification.permission === 'granted') {
        ensurePersistentPushSubscription().catch(() => {});
      }
      return;
    }
    showScreen('app');
    renderIdentity();
    await loadAllData();
    if ('Notification' in window && Notification.permission === 'granted') {
      ensurePersistentPushSubscription().catch(() => {});
    }
    const restoreSaasArea = readLocalValue(ACTIVE_AREA_KEY) === 'saas';
    setView(state.activeView, { persist: !restoreSaasArea });
  }

  async function loadAllData() {
    if (!state.company?.id) return;
    const companyId = encodeURIComponent(state.company.id);
    try {
      const [devices, media, playlists, playlistItems, deviceAssignments, deviceGroups, deviceGroupMembers, campaigns, campaignDevices, deviceEvents, deviceCommands, deviceHeartbeats, companyMembers, profiles] = await Promise.all([
        restRequest('devices', { query: `select=*&company_id=eq.${companyId}&retired_at=is.null&order=created_at.desc` }),
        restRequest('media_assets', { query: `select=*&company_id=eq.${companyId}&order=created_at.desc` }),
        restRequest('playlists', { query: `select=*&company_id=eq.${companyId}&order=created_at.desc` }),
        restRequest('playlist_items', { query: `select=*&company_id=eq.${companyId}&order=position.asc` }),
        restRequest('device_playlist_assignments', { query: `select=*&company_id=eq.${companyId}` }),
        restRequest('device_groups', { query: `select=*&company_id=eq.${companyId}&order=name.asc` }),
        restRequest('device_group_members', { query: `select=*&company_id=eq.${companyId}` }),
        restRequest('campaigns', { query: `select=*&company_id=eq.${companyId}&order=priority.desc,created_at.desc` }),
        restRequest('campaign_devices', { query: `select=*&company_id=eq.${companyId}` }),
        restRequest('device_events', { query: `select=id,client_event_id,device_id,severity,event_code,message,details,occurred_at&company_id=eq.${companyId}&order=occurred_at.desc&limit=100` }),
        restRequest('device_commands', { query: `select=id,device_id,command_type,status,requested_by,requested_at,delivered_at,completed_at,error_message&company_id=eq.${companyId}&order=requested_at.desc&limit=100` }),
        restRequest('device_heartbeats', { query: `select=id,device_id,received_at,details&company_id=eq.${companyId}&order=received_at.desc&limit=250` }),
        restRequest('company_members', { query: `select=user_id,role,status&company_id=eq.${companyId}` }),
        restRequest('profiles', { query: 'select=id,display_name&order=updated_at.desc' }),
      ]);
      state.devices = devices || [];
      state.media = media || [];
      state.playlists = playlists || [];
      state.playlistItems = playlistItems || [];
      state.deviceAssignments = deviceAssignments || [];
      state.deviceGroups = deviceGroups || [];
      state.deviceGroupMembers = deviceGroupMembers || [];
      state.campaigns = campaigns || [];
      state.campaignDevices = campaignDevices || [];
      state.deviceEvents = deviceEvents || [];
      state.deviceCommands = deviceCommands || [];
      state.deviceHeartbeats = deviceHeartbeats || [];
      state.companyMembers = companyMembers || [];
      state.profiles = profiles || [];
      const screenshots = await restRequest('device_screenshots', { query: `select=*&company_id=eq.${companyId}&order=captured_at.desc&limit=80` });
      state.deviceScreenshots = screenshots || [];
      state.playerBranding = null;
      if (state.isPlatformAdmin) {
        // Branding is Master-only, but a branding/RLS failure must never abort the
        // operational data refresh (especially the TV list after pairing).
        try {
          const globalBrandingRows = await restRequest('platform_player_branding', { query: 'select=id,splash_path,title,message,updated_at,updated_by&id=eq.1&limit=1' });
          state.playerBranding = globalBrandingRows?.[0] || null;
        } catch (brandingError) {
          console.warn('Player branding unavailable; keeping operational data visible.', brandingError);
        }
      }
      await loadNotificationInbox({ quiet: true }).catch(() => null);
      renderAll();
      // Keep this card deterministic even if another renderer is skipped.
      renderDevicePlanUsage();
      updateConnectionStatus(true);
    } catch (error) {
      updateConnectionStatus(false);
      throw error;
    }
  }


  function inboxDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: state.company?.timezone || 'America/Sao_Paulo',
    }).format(date);
  }

  function visibleInboxItems() {
    const filter = state.notificationFilter || 'all';
    return (state.notifications || []).filter(item => {
      if (filter === 'unread') return !item.is_read;
      if (filter === 'read') return Boolean(item.is_read);
      return true;
    });
  }

  function currentDueNotices() {
    const companies = state.isPlatformAdmin ? state.expiryCompanies || [] : [{ ...state.company, subscription: state.subscription }];
    return companies.map(company => {
      const sub = company.subscription;
      const dueValue = sub?.status === 'trialing' ? sub.trial_ends_at : sub?.current_period_end;
      const dueTime = new Date(dueValue || '').getTime();
      if (!dueValue || !Number.isFinite(dueTime) || !['active','trialing','past_due'].includes(sub?.status) || dueTime - Date.now() > 3 * 86400000) return null;
      return { company, subscription: sub, dueValue, expired: dueTime < Date.now() };
    }).filter(Boolean);
  }

  function updateInboxBadge() {
    const badge = $('#inbox-unread-badge');
    if (!badge) return;
    const count = Number(state.notificationUnreadCount || 0) + currentDueNotices().length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count < 1);
  }

  function renderNotificationInbox() {
    updateInboxBadge();
    const list = $('#inbox-list');
    const empty = $('#inbox-empty');
    if (!list || !empty) return;

    const items = visibleInboxItems();
    const dueNotice = state.notificationFilter === 'read' ? '' : currentDueNotices().map(info => {
      const { company, subscription: sub, dueValue, expired } = info;
      const owner = state.isPlatformAdmin ? company.name + ': ' : 'Sua conta: ';
      return `<article class="inbox-message-card unread"><div class="inbox-message-copy"><strong>${escapeHtml(owner)}${expired ? 'assinatura vencida' : 'vencimento próximo'}</strong><p class="inbox-message-body">O ${sub.status === 'trialing' ? 'teste' : 'plano'} ${expired ? 'venceu' : 'vence'} em ${escapeHtml(formatAccessDate(dueValue))}. Entre em contato com o suporte para renovar.</p><small>Aviso do vencimento cadastrado, atualizado automaticamente.</small></div></article>`;
    }).join('');
    const validIds = new Set((state.notifications || []).map(item => item.id));
    state.selectedNotificationIds = new Set(
      [...state.selectedNotificationIds].filter(id => validIds.has(id))
    );

    list.innerHTML = dueNotice + items.map(item => {
      const selected = state.selectedNotificationIds.has(item.id);
      return `
        <article class="inbox-message-card ${item.is_read ? 'read' : 'unread'}">
          <label class="inbox-message-check" aria-label="Selecionar mensagem">
            <input type="checkbox" data-inbox-select="${escapeHtml(item.id)}" ${selected ? 'checked' : ''} />
          </label>
          <div class="inbox-message-copy">
            <div class="inbox-message-head">
              <div>
                <strong>${escapeHtml(item.title || 'Vision Mídia Digital')}</strong>
                <div class="inbox-message-meta">
                  <span class="inbox-read-state">${item.is_read ? 'Lida' : 'Não lida'}</span>
                  <span>${escapeHtml(inboxDateTime(item.created_at))}</span>
                </div>
              </div>
            </div>
            <p class="inbox-message-body">${escapeHtml(item.message || '')}</p>
          </div>
          <div class="inbox-message-actions">
            <button class="button ghost" type="button" data-inbox-read="${escapeHtml(item.id)}" data-next-read="${item.is_read ? 'false' : 'true'}">
              ${item.is_read ? 'Marcar não lida' : 'Marcar lida'}
            </button>
            <button class="button ghost" type="button" data-inbox-delete="${escapeHtml(item.id)}">Excluir</button>
          </div>
        </article>
      `;
    }).join('');

    list.classList.toggle('hidden', !items.length && !dueNotice);
    empty.classList.toggle('hidden', Boolean(items.length || dueNotice));

    const selectAll = $('#inbox-select-all');
    if (selectAll) {
      const visibleIds = items.map(item => item.id);
      const selectedVisible = visibleIds.filter(id => state.selectedNotificationIds.has(id));
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
      selectAll.disabled = visibleIds.length === 0;
    }
    const deleteButton = $('#inbox-delete-selected');
    if (deleteButton) deleteButton.disabled = state.selectedNotificationIds.size === 0;
  }

  async function loadNotificationInbox({ quiet = false } = {}) {
    if (!state.company?.id || !state.session?.access_token) {
      state.notifications = [];
      state.notificationUnreadCount = 0;
      renderNotificationInbox();
      return [];
    }
    try {
      if (state.isPlatformAdmin) {
        const dashboard = await functionRequest('master-admin', { authenticated: true, body: { action: 'dashboard' } });
        state.expiryCompanies = Array.isArray(dashboard?.companies) ? dashboard.companies : [];
      } else {
        state.expiryCompanies = [];
        const rows = await restRequest('company_subscriptions', { query: `select=*&company_id=eq.${encodeURIComponent(state.company.id)}&limit=1` });
        state.subscription = rows?.[0] || null;
      }
      const result = await functionRequest('notification-inbox', {
        authenticated: true,
        body: { action: 'list', company_id: state.company.id },
      });
      state.notifications = Array.isArray(result?.items) ? result.items : [];
      state.notificationUnreadCount = Number(result?.unread_count || 0);
      renderNotificationInbox();
      return state.notifications;
    } catch (error) {
      if (!quiet) toast('Não foi possível carregar as mensagens', error.message, 'error');
      throw error;
    }
  }

  async function setInboxMessageRead(notificationId, isRead) {
    if (!notificationId || !state.company?.id) return;
    await functionRequest('notification-inbox', {
      authenticated: true,
      body: {
        action: 'set_read',
        company_id: state.company.id,
        notification_id: notificationId,
        is_read: Boolean(isRead),
      },
    });
    const item = (state.notifications || []).find(row => row.id === notificationId);
    if (item) item.is_read = Boolean(isRead);
    state.notificationUnreadCount = (state.notifications || []).filter(row => !row.is_read).length;
    renderNotificationInbox();
  }

  async function deleteInboxMessages(ids) {
    const notificationIds = [...new Set((ids || []).filter(Boolean))];
    if (!notificationIds.length || !state.company?.id) return;
    await functionRequest('notification-inbox', {
      authenticated: true,
      body: {
        action: 'delete_many',
        company_id: state.company.id,
        notification_ids: notificationIds,
      },
    });
    const deleted = new Set(notificationIds);
    state.notifications = (state.notifications || []).filter(item => !deleted.has(item.id));
    state.selectedNotificationIds = new Set(
      [...state.selectedNotificationIds].filter(id => !deleted.has(id))
    );
    state.notificationUnreadCount = state.notifications.filter(row => !row.is_read).length;
    renderNotificationInbox();
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
    renderMonitoring();
    renderMedia();
    renderPlaylists();
    renderCampaigns();
    renderReportFilterOptions();
    renderNotificationInbox();
    renderPlayerBranding();
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

    const actions = [];
    const unassignedDevices = state.devices.filter(device => {
      const assignment = state.deviceAssignments.find(row => row.device_id === device.id);
      const group = deviceGroupFor(device.id);
      return !assignment?.playlist_id && !group?.playlist_id;
    });
    const emptyPlaylists = state.playlists.filter(playlist => !state.playlistItems.some(item => item.playlist_id === playlist.id));
    const offlineDevices = state.devices.filter(device => effectiveDeviceStatus(device) === 'offline');
    if (!state.devices.length) actions.push({ icon:'▣', title:'Pareie sua primeira TV', detail:'Abra o Vision Player e use o código exibido na tela.', view:'devices', label:'Parear TV' });
    if (!state.media.length) actions.push({ icon:'▧', title:'Envie sua primeira mídia', detail:'Adicione uma imagem ou vídeo à biblioteca.', view:'media', label:'Abrir biblioteca' });
    if (!state.playlists.length) actions.push({ icon:'▶', title:'Crie uma playlist', detail:'A TV só começa a exibir depois que houver conteúdo organizado.', view:'playlists', label:'Criar playlist' });
    else if (emptyPlaylists.length) actions.push({ icon:'!', title:'Playlist sem mídia', detail:`${emptyPlaylists.length} playlist(s) ainda não têm conteúdo para exibir.`, view:'playlists', label:'Ajustar playlist' });
    if (unassignedDevices.length) actions.push({ icon:'↗', title:'Atribua conteúdo às TVs', detail:`${unassignedDevices.length} TV(s) estão aguardando uma playlist direta ou de grupo.`, view:'devices', label:'Configurar TVs' });
    if (offlineDevices.length) actions.push({ icon:'◌', title:'Verifique as TVs offline', detail:`${offlineDevices.length} TV(s) não respondem neste momento.`, view:'monitoring', label:'Ver diagnóstico' });
    if (!actions.length) actions.push({ icon:'✓', title:'Operação em dia', detail:'Suas TVs, mídias e playlists estão configuradas. Acompanhe a saúde no monitoramento.', view:'monitoring', label:'Abrir monitoramento', positive:true });
    const actionList = $('#dashboard-action-list');
    if (actionList) actionList.innerHTML = actions.slice(0, 4).map(action => `<div class="dashboard-action-item ${action.positive ? 'positive' : ''}"><span class="dashboard-action-icon">${action.icon}</span><div><strong>${escapeHtml(action.title)}</strong><small>${escapeHtml(action.detail)}</small></div><button type="button" class="small-button" data-go-view="${escapeHtml(action.view)}">${escapeHtml(action.label)}</button></div>`).join('');
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
    return ({ pending: 'aguardando autorização', online: 'online', offline: 'offline', disabled: 'desativada' })[value] || value;
  }

  function effectiveDeviceStatus(device) {
    if (device.status === 'disabled') return 'disabled';
    if (device.access_status === 'pending') return 'pending';
    if (!device.last_seen_at) return device.paired_at ? 'offline' : (device.status || 'pending');
    const stale = Date.now() - new Date(device.last_seen_at).getTime() > 90_000;
    return stale ? 'offline' : 'online';
  }

  const LOCAL_WEEKDAY_INDEX_APP = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  function appLocalClock(timeZone) {
    let zone = timeZone || state.company?.timezone || 'America/Sao_Paulo';
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', weekday:'short', hourCycle:'h23' });
    } catch {
      zone = 'America/Sao_Paulo';
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', weekday:'short', hourCycle:'h23' });
    }
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    const previous = new Date(calendar.getTime() - 86400000);
    return {
      dateKey: `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
      previousDateKey: `${previous.getUTCFullYear()}-${String(previous.getUTCMonth()+1).padStart(2,'0')}-${String(previous.getUTCDate()).padStart(2,'0')}`,
      weekday: LOCAL_WEEKDAY_INDEX_APP[parts.weekday] ?? calendar.getUTCDay(),
      previousWeekday: previous.getUTCDay(),
      seconds: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
    };
  }

  function scheduleTimeSeconds(value) {
    if (!value) return null;
    const [h='0', m='0', sec='0'] = String(value).split(':');
    const total = Number(h) * 3600 + Number(m) * 60 + Number(sec);
    return Number.isFinite(total) ? total : null;
  }

  function playlistItemActiveNow(item) {
    if (!item?.enabled) return false;
    if (!item.schedule_enabled) return true;
    const clock = appLocalClock(state.company?.timezone);
    const start = scheduleTimeSeconds(item.start_time);
    const end = scheduleTimeSeconds(item.end_time);
    let dateKey = clock.dateKey;
    let weekday = clock.weekday;

    if (start != null && end != null) {
      if (start < end) {
        if (clock.seconds < start || clock.seconds >= end) return false;
      } else {
        if (clock.seconds >= start) {
          // same calendar day
        } else if (clock.seconds < end) {
          dateKey = clock.previousDateKey;
          weekday = clock.previousWeekday;
        } else return false;
      }
    }

    if (item.start_date && dateKey < item.start_date) return false;
    if (item.end_date && dateKey > item.end_date) return false;
    const days = Array.isArray(item.weekdays) ? item.weekdays.map(Number) : [0,1,2,3,4,5,6];
    return days.includes(weekday);
  }

  function campaignActiveNow(campaign) {
    if (!campaign?.is_active) return false;
    const clock = appLocalClock(state.company?.timezone);
    const start = scheduleTimeSeconds(campaign.start_time);
    const end = scheduleTimeSeconds(campaign.end_time);
    let dateKey = clock.dateKey;
    let weekday = clock.weekday;

    if (start != null && end != null) {
      if (start < end) {
        if (clock.seconds < start || clock.seconds >= end) return false;
      } else if (clock.seconds >= start) {
        // Same calendar day.
      } else if (clock.seconds < end) {
        dateKey = clock.previousDateKey;
        weekday = clock.previousWeekday;
      } else return false;
    }

    if (campaign.start_date && dateKey < campaign.start_date) return false;
    if (campaign.end_date && dateKey > campaign.end_date) return false;
    const days = Array.isArray(campaign.weekdays) ? campaign.weekdays.map(Number) : [0,1,2,3,4,5,6];
    return days.includes(weekday);
  }

  function campaignForDevice(device) {
    const assignment = state.deviceAssignments.find(row => row.device_id === device?.id);
    const group = deviceGroupFor(device?.id);
    if (!assignment?.playlist_id && !group?.playlist_id) return null;
    const reported = device?.current_campaign_id
      ? state.campaigns.find(campaign => campaign.id === device.current_campaign_id)
      : null;
    if (reported) return reported;
    const targeted = new Set(state.campaignDevices
      .filter(row => row.device_id === device?.id)
      .map(row => row.campaign_id));
    return state.campaigns.find(campaign =>
      campaignActiveNow(campaign) && (campaign.all_devices || targeted.has(campaign.id))) || null;
  }

  function devicePlaybackHealth(device) {
    const assignment = state.deviceAssignments.find(row => row.device_id === device.id);
    const group = deviceGroupFor(device.id);
    const campaign = campaignForDevice(device);
    const playlistId = campaign?.playlist_id || assignment?.playlist_id || group?.playlist_id || null;
    if (!playlistId) {
      return { level:'warning', playlistName:'Nenhuma', stateLabel:'Aguardando playlist', playlistId:null };
    }
    const playlist = state.playlists.find(row => row.id === playlistId);
    const items = state.playlistItems.filter(row => row.playlist_id === playlistId);
    const enabledItems = items.filter(row => row.enabled);
    const activeItems = enabledItems.filter(playlistItemActiveNow);
    const sourceSuffix = campaign
      ? ` • campanha: ${campaign.name || 'ativa'}`
      : (!assignment?.playlist_id && group?.playlist_id ? ' • via grupo' : '');

    if (!enabledItems.length) {
      return { level:'error', playlistName:playlist?.name || 'Playlist', stateLabel:`Sem mídia ativa${sourceSuffix}`, playlistId };
    }
    if (!activeItems.length) {
      return { level:'warning', playlistName:playlist?.name || 'Playlist', stateLabel:`Fora da programação agora${sourceSuffix}`, playlistId };
    }
    return { level:'success', playlistName:playlist?.name || 'Playlist', stateLabel:`Pronta para exibir${sourceSuffix}`, playlistId };
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

  function deviceScreenshotCacheKey(shot) {
    if (!shot?.storage_path) return '';
    return `${shot.id || shot.device_id || 'shot'}:${shot.storage_path}`;
  }

  function cachedDeviceScreenshotEntry(shot) {
    const key = deviceScreenshotCacheKey(shot);
    return key ? state.deviceScreenshotUrls.get(key) || null : null;
  }

  async function signedDeviceScreenshotUrlCached(shot, { force = false } = {}) {
    const key = deviceScreenshotCacheKey(shot);
    if (!key) throw new Error('Captura sem arquivo.');
    const cached = state.deviceScreenshotUrls.get(key);
    if (!force && cached?.url && cached.expiresAt > Date.now() + 60_000) return cached.url;
    const url = await getSignedMediaUrl(shot.storage_path);
    state.deviceScreenshotUrls.set(key, { url, expiresAt: Date.now() + 12 * 60_000 });
    return url;
  }

  function deviceGroupMembership(deviceId) {
    return state.deviceGroupMembers.find(row => row.device_id === deviceId) || null;
  }

  function deviceGroupFor(deviceId) {
    const membership = deviceGroupMembership(deviceId);
    return membership ? state.deviceGroups.find(row => row.id === membership.group_id) || null : null;
  }

  function latestDeviceCommand(deviceId) {
    return state.deviceCommands.find(row => row.device_id === deviceId) || null;
  }

  function screenshotMatchesConfiguredOrientation(device, shot) {
    const width = Number(shot?.width || 0);
    const height = Number(shot?.height || 0);
    if (!width || !height) return true;
    const mode = String(device?.orientation || 'auto');
    if (mode === 'landscape') return width >= height;
    if (mode === 'portrait') return height >= width;
    return true;
  }

  function deviceProgramPreviewMedia(device) {
    const direct = state.deviceAssignments.find(row => row.device_id === device.id);
    const group = deviceGroupFor(device.id);
    const playlistId = direct?.playlist_id || group?.playlist_id || null;
    if (!playlistId) return null;
    const item = state.playlistItems
      .filter(row => row.playlist_id === playlistId && row.enabled !== false)
      .sort((a,b) => Number(a.position || 0) - Number(b.position || 0))
      .find(row => state.media.some(media => media.id === row.media_id));
    return item ? state.media.find(media => media.id === item.media_id) || null : null;
  }

  function remoteCommandLabel(type) {
    return ({ screenshot:'Captura de tela', restart_player:'Reiniciar Player', sync_now:'Sincronizar agora', clear_cache:'Limpar cache', reload_programming:'Recarregar programação' })[type] || type || 'Comando';
  }

  function remoteCommandStatusLabel(status) {
    return ({ pending:'Pendente', sent:'Recebido', completed:'Concluído', failed:'Falhou' })[status] || status || '—';
  }

  function reportedOrientationLabel(value) {
    const raw = String(value || '').toLowerCase();
    if (!raw) return '—';
    if (raw.includes('portrait')) return 'Vertical';
    if (raw.includes('landscape')) return 'Horizontal';
    return raw;
  }

  function semverTuple(value) {
    const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
  }

  function versionIsOlder(actual, expected) {
    const a = semverTuple(actual), e = semverTuple(expected);
    if (!a || !e) return false;
    for (let i = 0; i < 3; i++) {
      if (a[i] < e[i]) return true;
      if (a[i] > e[i]) return false;
    }
    return false;
  }

  function recentDeviceEventCount(deviceId, matcher, withinMs = 30 * 60 * 1000) {
    const cutoff = Date.now() - withinMs;
    return state.deviceEvents.filter(event => {
      if (event.device_id !== deviceId || new Date(event.occurred_at).getTime() < cutoff) return false;
      return typeof matcher === 'function' ? matcher(event) : event.event_code === matcher;
    }).length;
  }

  function latestDeviceHeartbeat(deviceId) {
    return state.deviceHeartbeats.find(row => row.device_id === deviceId) || null;
  }

  function networkTransportLabel(value) {
    return ({ wifi:'Wi-Fi', ethernet:'Cabo', cellular:'Rede móvel', vpn:'VPN', offline:'Offline', other:'Outra rede', unknown:'Rede não identificada' })[String(value || '').toLowerCase()] || 'Rede não identificada';
  }

  function formatClockSkew(value) {
    const ms = Math.abs(Number(value || 0));
    if (!Number.isFinite(ms) || ms < 30_000) return 'menos de 1 min';
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return `${hours} h`;
  }

  function heartbeatNetworkLabel(heartbeat) {
    const details = heartbeat?.details || {};
    const transport = networkTransportLabel(details.network_transport);
    if (details.network_connected === false) return 'Sem internet';
    if (details.network_connected === true && details.network_validated === false) return `${transport} • sem internet validada`;
    if (details.network_connected === true && details.network_validated === true) return `Internet OK • ${transport}`;
    if (details.network_connected === true) return `Conectada • ${transport}`;
    return 'Diagnóstico ainda não recebido';
  }

  function heartbeatClockLabel(heartbeat) {
    const details = heartbeat?.details || {};
    if (details.clock_status === 'incorrect') return `Incorreta • diferença de ${formatClockSkew(details.clock_skew_ms)}`;
    if (details.clock_status === 'warning') return `Fora de sincronia • diferença de ${formatClockSkew(details.clock_skew_ms)}`;
    if (details.clock_status === 'ok') return 'Sincronizada';
    return 'Diagnóstico ainda não recebido';
  }

  function deviceLikelyCause(device) {
    const heartbeat = latestDeviceHeartbeat(device.id);
    const details = heartbeat?.details || {};
    const status = effectiveDeviceStatus(device);
    if (details.clock_status === 'incorrect') return 'Data/hora do TV Box incorreta — ative Data e hora automáticas.';
    if (details.network_connected === false) return 'Sem internet no TV Box — verifique Wi-Fi ou cabo de rede.';
    if (details.network_connected === true && details.network_validated === false) return 'Rede conectada, mas sem acesso à internet validado.';
    if (status === 'offline') return 'TV offline — causa não confirmada. Verifique energia, internet e Data/hora automáticas.';
    if (deviceSyncIsStale(device)) return 'Player conectado, mas a sincronização está atrasada.';
    return 'Nenhuma falha detectada no último diagnóstico.';
  }

  function deviceDiagnostics(device) {
    const alerts = [];
    const status = effectiveDeviceStatus(device);
    if (status === 'offline') alerts.push({ level:'error', label:'TV offline' });
    const heartbeat = latestDeviceHeartbeat(device.id);
    const health = heartbeat?.details || {};
    if (health.clock_status === 'incorrect') alerts.push({ level:'error', label:'Data/hora incorreta' });
    else if (health.clock_status === 'warning') alerts.push({ level:'warning', label:'Relógio fora de sincronia' });
    if (health.network_connected === false) alerts.push({ level:'error', label:'Sem internet' });
    else if (health.network_connected === true && health.network_validated === false) alerts.push({ level:'warning', label:'Internet não validada' });
    if (deviceSyncIsStale(device)) alerts.push({ level:'warning', label:'Sincronização atrasada' });
    if (device.storage_free_mb != null && Number(device.storage_free_mb) < 256) alerts.push({ level:Number(device.storage_free_mb) < 100 ? 'error' : 'warning', label:'Pouco armazenamento' });
    const playerVersion = device.player_version || device.app_version || '';
    if (playerVersion && versionIsOlder(playerVersion, EXPECTED_PLAYER_VERSION)) alerts.push({ level:'warning', label:'Player desatualizado' });
    if (device.apk_version && versionIsOlder(device.apk_version, EXPECTED_APK_VERSION)) alerts.push({ level:'warning', label:'APK desatualizado' });
    if (recentDeviceEventCount(device.id, 'playback_error') >= 3) alerts.push({ level:'error', label:'Erro repetido de mídia' });
    if (recentDeviceEventCount(device.id, 'watchdog_restart') >= 2) alerts.push({ level:'error', label:'Watchdog reiniciando' });
    if (recentDeviceEventCount(device.id, event => /cache/i.test(event.event_code || '') && ['error','critical'].includes(event.severity)) >= 2) alerts.push({ level:'warning', label:'Falha repetida de cache' });
    return alerts;
  }

  function renderDeviceGroups() {
    const grid = $('#device-groups-grid');
    const empty = $('#device-groups-empty');
    if (!grid || !empty) return;
    const canManage = ['owner','admin','operator'].includes(state.companyRole);
    const addGroup = $('#add-device-group');
    if (addGroup) addGroup.disabled = !canManage;
    empty.classList.toggle('hidden', state.deviceGroups.length > 0);
    grid.classList.toggle('hidden', state.deviceGroups.length === 0);
    grid.innerHTML = state.deviceGroups.map(group => {
      const members = state.deviceGroupMembers.filter(row => row.group_id === group.id);
      const playlist = state.playlists.find(row => row.id === group.playlist_id);
      const names = members.map(member => state.devices.find(device => device.id === member.device_id)?.name).filter(Boolean);
      return `<article class="device-group-card">
        <div><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(playlist?.name || 'Sem playlist de grupo')} • ${members.length} TV(s)</small></div>
        <p>${names.length ? escapeHtml(names.join(' • ')) : 'Nenhuma TV neste grupo.'}</p>
        ${canManage ? `<div class="device-group-actions"><button class="small-icon-button" type="button" data-edit-device-group="${group.id}">Editar</button><button class="small-icon-button danger-inline" type="button" data-delete-device-group="${group.id}">Excluir</button></div>` : ''}
      </article>`;
    }).join('');
  }

  function openDeviceGroupDialog(groupId = null) {
    const group = groupId ? state.deviceGroups.find(row => row.id === groupId) : null;
    $('#device-group-id').value = group?.id || '';
    $('#device-group-name').value = group?.name || '';
    $('#device-group-playlist').innerHTML = '<option value="">Sem playlist</option>' + state.playlists.map(playlist =>
      `<option value="${playlist.id}" ${group?.playlist_id === playlist.id ? 'selected' : ''}>${escapeHtml(playlist.name)}</option>`
    ).join('');
    $('#device-group-dialog-title').textContent = group ? 'Editar grupo de TVs' : 'Novo grupo de TVs';
    openDialog('device-group-dialog');
  }

  async function saveDeviceGroup(event) {
    event.preventDefault();
    const button = $('#device-group-save'), id = $('#device-group-id').value, name = $('#device-group-name').value.trim();
    if (!name) return;
    setBusy(button, true, 'Salvando...');
    try {
      const body = { company_id:state.company.id, name, playlist_id:$('#device-group-playlist').value || null, updated_at:new Date().toISOString() };
      if (id) await restRequest('device_groups', { method:'PATCH', query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`, body, prefer:'return=minimal' });
      else await restRequest('device_groups', { method:'POST', body:{ ...body, created_by:state.user.id }, prefer:'return=minimal' });
      closeDialog('device-group-dialog'); toast('Grupo salvo', id ? 'Grupo atualizado.' : 'Grupo criado.'); await loadAllData();
    } catch (error) { toast('Erro ao salvar grupo', error.message, 'error'); }
    finally { setBusy(button, false); }
  }

  async function deleteDeviceGroup(groupId) {
    const group = state.deviceGroups.find(row => row.id === groupId);
    if (!group || !confirm(`Excluir o grupo “${group.name}”? As TVs permanecerão cadastradas.`)) return;
    try { await restRequest('device_groups', { method:'DELETE', query:`id=eq.${encodeURIComponent(groupId)}&company_id=eq.${encodeURIComponent(state.company.id)}` }); toast('Grupo excluído'); await loadAllData(); }
    catch (error) { toast('Erro ao excluir grupo', error.message, 'error'); }
  }

  async function setDeviceGroup(deviceId, groupId) {
    try {
      await restRequest('rpc/set_device_group', { method:'POST', body:{ p_company_id:state.company.id, p_device_id:deviceId, p_group_id:groupId || null } });
      toast('Grupo atualizado'); await loadAllData();
    } catch (error) { toast('Erro ao alterar grupo', error.message, 'error'); await loadAllData().catch(() => {}); }
  }

  async function requestDeviceMaintenanceCommand(deviceId, commandType, button = null) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device || !['sync_now','clear_cache','reload_programming'].includes(commandType) || !['owner','admin','operator'].includes(state.companyRole)) return false;
    if (commandType === 'clear_cache' && !confirm(`Limpar o cache local da TV “${device.name}” e sincronizar novamente?`)) return false;
    setBusy(button, true, 'Enviando...');
    try {
      const result = await functionRequest('device-control', { body:{ action:commandType, company_id:state.company.id, device_id:deviceId }, authenticated:true });
      if (!result?.ok) throw new Error(result?.message || 'O servidor não confirmou o comando.');
      toast(result?.duplicate ? 'Comando já pendente' : 'Comando enviado', `${device.name}: ${remoteCommandLabel(commandType)}.`);
      await loadAllData().catch(() => {});
      return true;
    } catch (error) { toast('Falha no comando remoto', error.message, 'error'); return false; }
    finally { setBusy(button, false); }
  }

  function currentDevicePlanUsage() {
    const plan = (state.publicConfig?.plans || []).find(item => item.id === state.subscription?.plan_id) || null;
    const rawOverride = state.subscription?.limit_overrides?.max_devices;
    const hasOverride = rawOverride !== undefined && rawOverride !== null && rawOverride !== '';
    const limit = Number(hasOverride ? rawOverride : (plan?.max_devices || 0));
    const used = state.devices.filter(device => !device.retired_at).length;
    const available = limit > 0 ? Math.max(0, limit - used) : null;
    return { planName: plan?.name || 'Plano atual', limit, used, available, hasOverride };
  }

  function renderDevicePlanUsage() {
    const box = $('#device-plan-usage');
    if (!box) return;
    const usage = currentDevicePlanUsage();
    const button = $('#add-device-button');
    if (!usage.limit) {
      box.className = 'plan-usage-banner warning';
      box.innerHTML = '<strong>Limite de TVs não definido</strong><span>Fale com o administrador para configurar seu plano.</span>';
      if (button) button.disabled = false;
      return;
    }
    const full = usage.used >= usage.limit;
    box.className = `plan-usage-banner ${full ? 'limit-reached' : ''}`;
    box.innerHTML = `<div><strong>${escapeHtml(usage.planName)}</strong><span>Seu plano permite ${usage.limit} TV${usage.limit === 1 ? '' : 's'}.</span></div><div class="plan-usage-numbers"><b>${usage.used}</b> em uso <span>•</span> <b>${usage.available}</b> disponível${usage.available === 1 ? '' : 'is'}</div>`;
    if (button) {
      button.disabled = full;
      button.title = full ? `Limite atingido: ${usage.used} de ${usage.limit} TVs em uso.` : `${usage.available} vaga(s) de TV disponível(is) no plano.`;
    }
  }

  function friendlyPairDeviceError(error) {
    const message = String(error?.message || error || 'Erro ao parear TV.');
    if (message.includes('plan_device_limit_reached')) {
      const usage = currentDevicePlanUsage();
      if (usage.limit) return `Limite do plano atingido. Seu plano permite ${usage.limit} TV${usage.limit === 1 ? '' : 's'} e você já está usando ${usage.used}. Para adicionar outra, substitua uma TV ou altere o plano.`;
      return 'Limite de TVs do plano atingido. Fale com o administrador para ajustar seu plano.';
    }
    if (/expired_code|código expirou|codigo expirou/i.test(message)) return 'Código expirado. Gere um novo código no Vision Player da TV e tente novamente.';
    if (/invalid_code|código inválido|codigo invalido|já utilizado|ja utilizado/i.test(message)) return 'Código inválido ou já utilizado. Confira os 6 dígitos exibidos na TV ou gere um novo código.';
    if (/code_already_claimed/i.test(message)) return 'Esse código acabou de ser utilizado. Gere um novo código no Vision Player.';
    if (/branded_player_company_mismatch/i.test(message)) return 'Este Vision Player está vinculado a outra empresa.';
    if (/rate_limited/i.test(message)) return 'Muitas tentativas de pareamento. Aguarde alguns minutos e tente novamente.';
    if (/forbidden/i.test(message)) return 'Seu usuário não tem permissão para parear TVs nesta empresa.';
    return message;
  }

  function friendlyScreenshotError(error) {
    const message = String(error?.message || error || 'Falha ao capturar a tela.');
    if (/Nenhuma imagem ou vídeo está sendo exibido/i.test(message)) {
      return 'A TV está online, mas o conteúdo atual é um link/site ou ainda não carregou uma imagem ou vídeo. Por segurança do navegador, páginas incorporadas não podem ser fotografadas pelo Player web.';
    }
    if (/mídia ainda não está pronta para captura/i.test(message)) {
      return 'A mídia ainda estava carregando. Aguarde alguns segundos e tente capturar novamente.';
    }
    if (/Canvas indisponível/i.test(message)) {
      return 'Este dispositivo não liberou a captura de tela pelo navegador.';
    }
    return message;
  }

  function captureUiForDevice(device, shot) {
    const status = effectiveDeviceStatus(device);
    const capture = state.deviceCaptureStates.get(device.id) || null;
    if (capture?.status === 'pending') {
      return {
        className: 'capture-pending',
        body: '<div class="device-capture-state"><span class="capture-spinner" aria-hidden="true"></span><strong>Capturando tela…</strong><small>Aguardando resposta do Vision Player.</small></div>',
        caption: 'Solicitando nova captura…',
      };
    }
    if (capture?.status === 'error') {
      return {
        className: 'capture-error',
        body: `<div class="device-capture-state"><span class="device-preview-symbol">!</span><strong>Não foi possível capturar</strong><small>${escapeHtml(capture.message || 'Tente novamente.')}</small><button class="small-icon-button capture-retry-button" type="button" data-capture-device="${device.id}">Tentar novamente</button></div>`,
        caption: 'Captura indisponível',
      };
    }
    if (shot?.storage_path) {
      if (!screenshotMatchesConfiguredOrientation(device, shot)) {
        const media = deviceProgramPreviewMedia(device);
        return {
          className: 'capture-program-fallback',
          useScreenshot: false,
          body: media
            ? `<div class="device-program-preview" data-device-program-preview="${escapeHtml(media.id)}"><div class="device-capture-state"><span class="capture-spinner" aria-hidden="true"></span><strong>Carregando programação…</strong></div></div>`
            : '<div class="device-capture-state"><span class="device-preview-symbol">↻</span><strong>Captura antiga incompatível</strong><small>Esta captura foi feita antes da correção de rotação. Faça uma nova captura quando a TV estiver online.</small></div>',
          caption: 'Prévia da programação • captura antiga descartada',
        };
      }
      const cached = cachedDeviceScreenshotEntry(shot);
      const orientationClass = Number(shot.height || 0) > Number(shot.width || 0) ? 'capture-portrait' : 'capture-landscape';
      return {
        className: `has-screenshot ${orientationClass}`,
        useScreenshot: true,
        body: cached?.url
          ? `<img src="${escapeHtml(cached.url)}" alt="Captura da TV" decoding="async" data-screenshot-cache-key="${escapeHtml(deviceScreenshotCacheKey(shot))}">`
          : '<div class="device-capture-state"><span class="capture-spinner" aria-hidden="true"></span><strong>Carregando captura…</strong></div>',
        caption: `Última captura: ${escapeHtml(formatLastSeen(shot.captured_at))}`,
      };
    }
    if (status === 'online') {
      return {
        className: 'capture-empty',
        body: `<div class="device-capture-state"><span class="device-preview-symbol">▣</span><strong>TV conectada • sem captura</strong><small>Peça uma imagem do que está sendo exibido agora.</small><button class="small-icon-button capture-retry-button" type="button" data-capture-device="${device.id}">Capturar agora</button></div>`,
        caption: 'Sem captura disponível',
      };
    }
    return {
      className: 'capture-empty',
      body: '<div class="device-capture-state"><span class="device-preview-symbol">▣</span><strong>Sem captura disponível</strong><small>A TV está offline. A miniatura aparecerá quando o Player responder.</small></div>',
      caption: 'Aguardando conexão da TV',
    };
  }

  async function authorizeDevicePermanently(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device) return;
    const button = document.querySelector(`[data-authorize-device="${CSS.escape(deviceId)}"]`);
    setBusy(button, true, 'Liberando...');
    try {
      await functionRequest('master-company-devices', {
        body: {
          action: 'set_access',
          company_id: state.company.id,
          device_id: deviceId,
          mode: 'permanent',
        },
      });
      toast('TV liberada', `${device.name}: acesso permanente ativado com sucesso.`);
      await loadAllData();
    } catch (error) {
      toast('Erro ao liberar TV', error.message || 'Não foi possível liberar esta TV.', 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function renderDevices() {
    renderDevicePlanUsage();
    renderDeviceGroups();
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
      const captureUi = captureUiForDevice(device, shot);
      const playbackHealth = devicePlaybackHealth(device);
      const group = deviceGroupFor(device.id);
      const latestCommand = latestDeviceCommand(device.id);
      const groupOptions = state.deviceGroups.map(item => `<option value="${item.id}" ${group?.id === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
      const resolution = device.screen_width && device.screen_height ? `${device.screen_width}×${device.screen_height}` : '—';
      const storageLabel = device.storage_free_mb == null ? '—' : formatBytes(Number(device.storage_free_mb) * 1024 * 1024);
      const options = state.playlists.map(playlist => `<option value="${playlist.id}" ${assignment?.playlist_id === playlist.id ? 'selected' : ''}>${escapeHtml(playlist.name)}</option>`).join('');
      const capturePending = state.deviceCaptureStates.get(device.id)?.status === 'pending';
      return `
      <article class="device-card device-card-pro" data-device-card="${device.id}">
        <div class="device-card-head">
          <div class="device-card-title">
            <strong>${escapeHtml(device.name)}</strong>
            <span>${escapeHtml(platformLabel(device.platform))}${device.app_version ? ` • ${escapeHtml(device.app_version)}` : ''}</span>
          </div>
          <span class="status-dot device-card-status ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
        </div>

        <div class="device-screen ${captureUi.className} ${device.orientation === 'portrait' ? 'configured-portrait' : device.orientation === 'landscape' ? 'configured-landscape' : ''}" data-device-screenshot="${device.id}" data-screenshot-path="${escapeHtml(shot?.storage_path || '')}" data-screenshot-valid="${captureUi.useScreenshot === false ? '0' : '1'}">
          ${captureUi.body}
        </div>
        <div class="device-screen-footer">
          <span data-device-capture-caption="${device.id}">${captureUi.caption}</span>
          <span>${escapeHtml(orientationLabel(device.orientation))}</span>
        </div>

        <div class="device-card-actions">
          <button class="small-icon-button view-tv-button" data-view-device="${device.id}" type="button" title="Abrir a última captura em tamanho maior">👁 Ver TV</button>
          <button class="small-icon-button capture-button" data-capture-device="${device.id}" type="button" ${capturePending ? 'disabled' : ''} title="Solicitar uma nova captura ao Player">${capturePending ? 'Capturando…' : '📷 Capturar'}</button>
          <details class="device-more-menu">
            <summary class="small-icon-button" title="Mais ações" aria-label="Mais ações">⋮</summary>
            <div class="device-more-popover">
              ${['owner','admin'].includes(state.companyRole) ? `<button class="device-menu-action" type="button" data-replace-device="${device.id}">⇄ Substituir TV</button>` : ''}
              ${['owner','admin','operator'].includes(state.companyRole) ? `<button class="device-menu-action" type="button" data-restart-device="${device.id}">↻ Reiniciar Player</button>
              <button class="device-menu-action" type="button" data-maintenance-command="sync_now" data-maintenance-device="${device.id}">⟳ Sincronizar agora</button>
              <button class="device-menu-action" type="button" data-maintenance-command="reload_programming" data-maintenance-device="${device.id}">▶ Recarregar programação</button>
              <button class="device-menu-action" type="button" data-maintenance-command="clear_cache" data-maintenance-device="${device.id}">⌫ Limpar cache</button>` : ''}
              <button class="device-menu-action" type="button" data-edit-device="${device.id}">✎ Editar TV</button>
              <button class="device-menu-action danger-inline" type="button" data-delete-device="${device.id}">× Excluir TV</button>
            </div>
          </details>
        </div>

        <div class="device-simple-summary">
          <div class="device-summary-row">
            <span>Acesso</span>
            <strong class="${device.access_status === 'pending' ? 'warn' : 'ok'}">${device.access_status === 'pending' ? 'Aguardando' : 'Liberado'}</strong>
            ${device.access_status === 'pending' ? `<button type="button" class="small-icon-button master-only-device-action" data-authorize-device="${device.id}">Liberar TV</button>` : ''}
          </div>
          <div class="device-summary-row">
            <span>Playlist</span>
            <strong>${escapeHtml(playbackHealth.playlistName)}</strong>
            ${playbackHealth.playlistId ? `<button type="button" class="small-icon-button" data-edit-playlist-items="${playbackHealth.playlistId}">Ajustar</button>` : ''}
          </div>
          <div class="device-summary-note ${playbackHealth.level}">
            ${escapeHtml(playbackHealth.stateLabel)}
          </div>
          <div class="device-summary-note muted">
            ${device.access_status === 'pending' ? 'TV já pareada. Falta liberar o acesso.' : (status === 'online' ? 'TV conectada e sincronizando.' : escapeHtml(formatLastSeen(device.last_seen_at)))}
          </div>
        </div>
        <div class="device-setting-chips">
          <span class="device-setting-chip ${device.settings?.audio_enabled === false ? 'off' : 'on'}">🔊 Áudio ${device.settings?.audio_enabled === false ? 'desligado' : 'ligado'}</span>
          <span class="device-setting-chip ${device.settings?.autostart_enabled === false ? 'off' : 'on'}">⏻ Auto início ${device.settings?.autostart_enabled === false ? 'desligado' : 'ligado'}</span>
          <span class="device-setting-chip ${device.settings?.kiosk_return_enabled === true ? 'on' : 'off'}">↩ Quiosque leve ${device.settings?.kiosk_return_enabled === true ? 'ligado' : 'desligado'}</span>
        </div>
        <label class="device-orientation-quick">
          <span>Rotação da tela inteira</span>
          <select data-device-orientation-quick="${device.id}" ${['owner','admin','operator'].includes(state.companyRole) ? '' : 'disabled'}>
            <option value="auto" ${device.orientation === 'auto' ? 'selected' : ''}>Automática</option>
            <option value="landscape" ${device.orientation === 'landscape' ? 'selected' : ''}>Horizontal</option>
            <option value="portrait" ${device.orientation === 'portrait' ? 'selected' : ''}>Vertical</option>
          </select>
          <small>Gira o Vision Player inteiro, não apenas uma imagem.</small>
        </label>

        <details class="device-maintenance-panel">
          <summary>Manutenção e diagnóstico</summary>
          <div class="device-maintenance-grid">
            <div><span>Player</span><strong>${escapeHtml(device.player_version || device.app_version || '—')}</strong></div>
            <div><span>APK</span><strong>${escapeHtml(device.apk_version || '—')}</strong></div>
            <div><span>Último heartbeat</span><strong>${escapeHtml(formatLastSeen(device.last_seen_at))}</strong></div>
            <div><span>Última sincronização</span><strong>${escapeHtml(device.last_sync_at ? formatMonitorDateTime(device.last_sync_at) : 'Ainda não sincronizou')}</strong></div>
            <div><span>Espaço livre</span><strong>${escapeHtml(storageLabel)}</strong></div>
            <div><span>Resolução</span><strong>${escapeHtml(resolution)}</strong></div>
            <div><span>Orientação configurada</span><strong>${escapeHtml(orientationLabel(device.orientation))}</strong></div>
            <div><span>Orientação reportada</span><strong>${escapeHtml(reportedOrientationLabel(device.reported_orientation))}</strong></div>
            <div class="device-maintenance-command"><span>Último comando</span><strong>${latestCommand ? `${escapeHtml(remoteCommandLabel(latestCommand.command_type))} • ${escapeHtml(remoteCommandStatusLabel(latestCommand.status))}` : 'Nenhum'}</strong>${latestCommand?.error_message ? `<small>${escapeHtml(latestCommand.error_message)}</small>` : ''}</div>
          </div>
        </details>

        <details class="device-programming-panel">
          <summary>
            <span>Programação da TV</span>
            <small>${escapeHtml(group?.name || 'Sem grupo')} • ${escapeHtml(playbackHealth.playlistName || 'Sem playlist')}</small>
          </summary>
          <div class="device-programming-fields">
            <label class="device-assignment">Grupo
              <select data-device-group="${device.id}" ${state.deviceGroups.length && ['owner','admin','operator'].includes(state.companyRole) ? '' : 'disabled'}>
                <option value="">${state.deviceGroups.length ? 'Sem grupo' : 'Crie um grupo primeiro'}</option>
                ${groupOptions}
              </select>
              <small>${group?.playlist_id && assignment?.playlist_id ? 'A playlist padrão desta TV tem prioridade sobre a playlist do grupo.' : 'Use grupos para aplicar programação padrão a várias TVs.'}</small>
            </label>

            <label class="device-assignment">Playlist padrão
              <select data-device-playlist="${device.id}" ${state.playlists.length ? '' : 'disabled'}>
                <option value="">${state.playlists.length ? 'Nenhuma playlist' : 'Crie uma playlist primeiro'}</option>
                ${options}
              </select>
            </label>
          </div>
        </details>
      </article>`;
    }).join('');

    hydrateDeviceScreenshots();
    hydrateDeviceProgramPreviews();
    scheduleAutomaticDeviceCaptures();
  }

  async function hydrateDeviceProgramPreviews() {
    const targets = $$('[data-device-program-preview]');
    await Promise.all(targets.map(async target => {
      const mediaId = target.dataset.deviceProgramPreview;
      const media = state.media.find(item => item.id === mediaId);
      const path = media?.storage_path || media?.source_url;
      if (!path || !['image','video','url'].includes(media.media_type)) {
        target.innerHTML = '<div class="device-capture-state"><strong>Conteúdo sem prévia disponível</strong><small>Use Capturar para solicitar a tela da TV.</small></div>';
        return;
      }
      if (target.dataset.loadedPath === path || target.dataset.loadingPath === path) return;
      target.dataset.loadingPath = path;
      try {
        if (media.media_type === 'url') {
          target.replaceChildren(onlineDeviceProgramPreview(media));
          target.dataset.loadedPath = path;
          return;
        }
        const element = await devicePreviewWithDeadline(async () => loadStablePreviewElement(media, await signedMediaUrlCached(media)));
        if (!target.isConnected) return;
        target.replaceChildren(element);
        target.dataset.loadedPath = path;
      } catch {
        if (target.isConnected) {
          target.innerHTML = '<div class="device-capture-state"><span class="device-preview-symbol">!</span><strong>Prévia indisponível</strong><small>A captura antiga foi descartada. Faça uma nova captura quando a TV estiver online.</small></div>';
        }
      } finally {
        if (target.isConnected) delete target.dataset.loadingPath;
      }
    }));
  }

  async function devicePreviewWithDeadline(load) {
    let timer;
    try {
      return await Promise.race([load(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Prévia indisponível. Tente atualizar novamente.')), 6000);
      })]);
    } finally { clearTimeout(timer); }
  }

  function onlineDeviceProgramPreview(media) {
    const url = new URL(resolveOnlineMediaUrl(media.source_url));
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('URL de prévia inválida.');
    const frame = document.createElement('iframe');
    frame.title = `Prévia da programação: ${media.name || 'Conteúdo online'}`;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.referrerPolicy = 'no-referrer';
    frame.src = url.href;
    return frame;
  }

  function scheduleAutomaticDeviceCaptures() {
    for (const device of state.devices) {
      if (effectiveDeviceStatus(device) !== 'online') continue;
      if (latestScreenshotForDevice(device.id)) continue;
      if (state.autoCaptureRequested.has(device.id)) continue;
      if (state.deviceCaptureStates.get(device.id)?.status === 'pending') continue;
      state.autoCaptureRequested.add(device.id);
      setTimeout(() => {
        const current = state.devices.find(item => item.id === device.id);
        if (!current || effectiveDeviceStatus(current) !== 'online' || latestScreenshotForDevice(device.id)) return;
        requestDeviceScreenshot(device.id, { quiet: true, automatic: true }).catch(() => {});
      }, 2500);
    }
  }

  async function hydrateDeviceScreenshots() {
    for (const shot of state.deviceScreenshots) {
      const target = $(`[data-device-screenshot="${CSS.escape(shot.device_id)}"]`);
      if (!target || !shot.storage_path || target.dataset.screenshotValid === '0') continue;

      const key = deviceScreenshotCacheKey(shot);
      const cached = cachedDeviceScreenshotEntry(shot);
      const currentImg = target.querySelector('img');

      if (cached?.url && !currentImg) {
        const cachedImg = new Image();
        cachedImg.alt = 'Captura da TV';
        cachedImg.decoding = 'async';
        cachedImg.dataset.screenshotCacheKey = key;
        cachedImg.src = cached.url;
        target.replaceChildren(cachedImg);
        target.classList.add('has-screenshot');
        target.classList.remove('capture-empty', 'capture-error', 'capture-pending');
      }

      if (cached?.url && cached.expiresAt > Date.now() + 60_000) {
        target.dataset.loaded = '1';
        continue;
      }

      try {
        const url = await signedDeviceScreenshotUrlCached(shot, { force: Boolean(cached?.url) });
        const img = new Image();
        img.alt = 'Captura da TV';
        img.decoding = 'async';
        img.dataset.screenshotCacheKey = key;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('Não foi possível carregar a miniatura.'));
          img.src = url;
        });

        if (target.dataset.screenshotPath !== shot.storage_path) continue;
        target.replaceChildren(img);
        target.classList.add('has-screenshot');
        target.classList.remove('capture-empty', 'capture-error', 'capture-pending');
        target.dataset.loaded = '1';
      } catch {
        if (target.querySelector('img')) {
          target.dataset.loaded = '1';
          continue;
        }
        target.classList.remove('has-screenshot', 'capture-pending');
        target.classList.add('capture-error');
        target.innerHTML = '<div class="device-capture-state"><span class="device-preview-symbol">!</span><strong>Miniatura indisponível</strong><small>A captura existe, mas não pôde ser carregada agora.</small></div>';
      }
    }
  }

  function resolvedTvViewerOrientation(device, shot = null) {
    const configured = String(device?.orientation || 'auto').toLowerCase();
    if (configured === 'portrait' || configured === 'landscape') return configured;

    const shotWidth = Number(shot?.width || 0);
    const shotHeight = Number(shot?.height || 0);
    if (shotWidth > 0 && shotHeight > 0) return shotHeight > shotWidth ? 'portrait' : 'landscape';

    const reported = String(device?.reported_orientation || '').toLowerCase();
    if (reported.includes('portrait')) return 'portrait';
    if (reported.includes('landscape')) return 'landscape';

    const width = Number(device?.screen_width || 0);
    const height = Number(device?.screen_height || 0);
    if (width > 0 && height > 0) return height > width ? 'portrait' : 'landscape';
    return 'landscape';
  }

  function reportedTvViewerOrientation(device) {
    const reported = String(device?.reported_orientation || '').toLowerCase();
    if (reported.includes('portrait')) return 'portrait';
    if (reported.includes('landscape')) return 'landscape';

    const width = Number(device?.screen_width || 0);
    const height = Number(device?.screen_height || 0);
    if (width > 0 && height > 0) return height > width ? 'portrait' : 'landscape';
    return 'landscape';
  }

  function tvViewerProgramNeedsRotation(device) {
    const configured = String(device?.orientation || 'auto').toLowerCase();
    if (!['portrait','landscape'].includes(configured)) return false;
    return configured !== reportedTvViewerOrientation(device);
  }

  function syncTvViewerProgramMediaLayout(preview) {
    if (!preview) return;
    const media = preview.querySelector('.tv-viewer-media');
    if (!media) return;
    const rotated = preview.dataset.rotateProgramMedia === '1';
    media.classList.toggle('tv-viewer-media-rotated', rotated);
    if (rotated) {
      media.style.width = `${Math.max(1, preview.clientHeight)}px`;
      media.style.height = `${Math.max(1, preview.clientWidth)}px`;
    } else {
      media.style.width = '100%';
      media.style.height = '100%';
    }
  }

  function setTvViewerProgramPreviewMode(preview, device, enabled) {
    if (!preview) return;
    const rotated = Boolean(enabled && tvViewerProgramNeedsRotation(device));
    preview.dataset.rotateProgramMedia = rotated ? '1' : '0';
    preview.classList.toggle('is-program-orientation-fallback', rotated);
    syncTvViewerProgramMediaLayout(preview);
  }

  function tvViewerFrameGeometry(device, shot = null) {
    const orientation = resolvedTvViewerOrientation(device, shot);
    let width = Number(shot?.width || 0);
    let height = Number(shot?.height || 0);

    if (!(width > 0 && height > 0)) {
      width = Number(device?.screen_width || 0);
      height = Number(device?.screen_height || 0);
    }
    if (!(width > 0 && height > 0)) {
      width = 16;
      height = 9;
    }

    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (orientation === 'portrait') {
      width = shortSide;
      height = longSide;
    } else {
      width = longSide;
      height = shortSide;
    }
    return { orientation, width, height };
  }

  function fitTvViewerPreview(preview) {
    const stage = preview?.closest?.('.tv-viewer-stage-shell');
    if (!stage) return;
    const frameWidth = Number(preview.dataset.frameWidth || 16);
    const frameHeight = Number(preview.dataset.frameHeight || 9);
    const bounds = stage.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0 && frameWidth > 0 && frameHeight > 0)) return;

    const scale = Math.min(bounds.width / frameWidth, bounds.height / frameHeight);
    preview.style.width = `${Math.max(1, Math.floor(frameWidth * scale))}px`;
    preview.style.height = `${Math.max(1, Math.floor(frameHeight * scale))}px`;
    syncTvViewerProgramMediaLayout(preview);
  }

  function configureTvViewerFrame(preview, device, shot = null) {
    if (!preview) return;
    const geometry = tvViewerFrameGeometry(device, shot);
    preview.dataset.orientation = geometry.orientation;
    preview.dataset.frameWidth = String(geometry.width);
    preview.dataset.frameHeight = String(geometry.height);
    preview.style.aspectRatio = `${geometry.width} / ${geometry.height}`;
    preview.classList.toggle('is-portrait-capture', geometry.orientation === 'portrait');
    preview.classList.toggle('is-landscape-capture', geometry.orientation === 'landscape');

    requestAnimationFrame(() => fitTvViewerPreview(preview));
    tvViewerResizeObserver?.disconnect?.();
    const stage = preview.closest('.tv-viewer-stage-shell');
    if (stage && typeof ResizeObserver === 'function') {
      tvViewerResizeObserver = new ResizeObserver(() => fitTvViewerPreview(preview));
      tvViewerResizeObserver.observe(stage);
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

    if (shot?.storage_path && !screenshotMatchesConfiguredOrientation(device, shot)) {
      const media = deviceProgramPreviewMedia(device);
      configureTvViewerFrame(preview, device);
      setTvViewerProgramPreviewMode(preview, device, true);
      $('#view-tv-captured-at').textContent = 'Captura antiga descartada • exibindo prévia da programação';
      if (media?.media_type === 'url' && media.source_url) {
        const element = onlineDeviceProgramPreview(media);
        element.classList.add('tv-viewer-media');
        preview.replaceChildren(element);
        syncTvViewerProgramMediaLayout(preview);
        return;
      }
      if (!media?.storage_path || !['image','video'].includes(media.media_type)) {
        preview.innerHTML = '<div class="tv-viewer-empty">A captura antiga desta TV foi feita com orientação incompatível.<br><small>Quando a TV ficar online, use “Atualizar agora” para gerar uma nova captura.</small></div>';
        return;
      }
      preview.innerHTML = '<div class="tv-viewer-empty">Carregando prévia da programação…</div>';
      try {
        const element = await devicePreviewWithDeadline(async () => loadStablePreviewElement(media, await signedMediaUrlCached(media)));
        if (state.viewingDeviceId !== deviceId) return;
        element.classList.add('tv-viewer-media');
        preview.replaceChildren(element);
        syncTvViewerProgramMediaLayout(preview);
      } catch {
        preview.innerHTML = '<div class="tv-viewer-empty">A captura antiga foi descartada e a prévia da programação não pôde ser aberta.</div>';
      }
      return;
    }

    if (!shot?.storage_path) {
      configureTvViewerFrame(preview, device);
      setTvViewerProgramPreviewMode(preview, device, false);
      preview.innerHTML = '<div class="tv-viewer-empty">Ainda não há captura desta TV.<br><small>Use “Atualizar agora” para solicitar uma imagem do que está passando.</small></div>';
      $('#view-tv-captured-at').textContent = 'Sem captura disponível';
      return;
    }

    configureTvViewerFrame(preview, device, shot);
    setTvViewerProgramPreviewMode(preview, device, false);
    const cached = cachedDeviceScreenshotEntry(shot);
    if (!cached?.url) preview.innerHTML = '<div class="tv-viewer-empty">Carregando captura…</div>';
    $('#view-tv-captured-at').textContent = `Capturada em ${formatMonitorDateTime(shot.captured_at)}`;
    try {
      const url = await signedDeviceScreenshotUrlCached(shot);
      if (state.viewingDeviceId !== deviceId) return;
      const img = new Image();
      img.alt = `Captura da TV ${device.name}`;
      img.className = 'tv-viewer-media';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Falha ao abrir captura.'));
        img.src = url;
      });
      if (state.viewingDeviceId !== deviceId) return;
      preview.replaceChildren(img);
    } catch {
      if (!preview.querySelector('img')) preview.innerHTML = '<div class="tv-viewer-empty">Não foi possível abrir a captura.</div>';
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

  async function requestDeviceScreenshot(deviceId, { quiet = false, automatic = false } = {}) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device) return false;
    if (state.deviceCaptureStates.get(deviceId)?.status === 'pending') return false;

    state.deviceCaptureStates.set(deviceId, { status: 'pending', automatic });
    renderDevices();

    try {
      const rows = await restRequest('device_commands', {
        method: 'POST',
        body: { company_id: state.company.id, device_id: deviceId, command_type: 'screenshot', requested_by: state.user.id },
        prefer: 'return=representation',
      });
      const command = rows?.[0];
      if (!command?.id) throw new Error('O servidor não confirmou o pedido de captura.');
      if (!quiet) toast('Captura solicitada', `${device.name}: aguardando o Player responder.`);

      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1800));
        const result = await restRequest('device_commands', { query: `select=id,status,error_message&company_id=eq.${encodeURIComponent(state.company.id)}&id=eq.${encodeURIComponent(command.id)}&limit=1` });
        const row = result?.[0];
        if (row?.status === 'completed') {
          state.deviceCaptureStates.delete(deviceId);
          await loadAllData();
          if (!quiet) toast('Captura concluída', `A imagem atual da ${device.name} foi recebida.`);
          return true;
        }
        if (row?.status === 'failed') throw new Error(row.error_message || 'O Player não conseguiu capturar a tela.');
      }
      throw new Error('A TV não respondeu ao pedido de captura em até 25 segundos.');
    } catch (error) {
      const message = friendlyScreenshotError(error);
      state.deviceCaptureStates.set(deviceId, { status: 'error', message, automatic });
      renderDevices();
      if (!quiet) toast('Não foi possível capturar', message, 'error', 7500);
      return false;
    }
  }

  async function requestDeviceRestart(deviceId, button = null) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device) return false;
    if (!['owner','admin','operator'].includes(state.companyRole)) {
      toast('Sem permissão', 'Seu usuário não pode reiniciar Players.', 'error');
      return false;
    }
    if (!confirm(`Reiniciar o Vision Player da TV “${device.name}”? A reprodução volta automaticamente depois do reinício.`)) return false;
    setBusy(button, true, 'Solicitando...');
    try {
      const result = await functionRequest('device-control', {
        body: {
          action: 'restart_player',
          company_id: state.company.id,
          device_id: deviceId,
        },
        authenticated: true,
      });
      if (!result?.ok) throw new Error(result?.message || 'O servidor não confirmou o comando.');
      toast('Reinício solicitado', `${device.name}: o Player receberá o comando na próxima consulta.`);
      await loadAllData().catch(() => {});
      return true;
    } catch (error) {
      toast('Não foi possível reiniciar', error.message, 'error', 6500);
      return false;
    } finally {
      setBusy(button, false);
    }
  }

  function renderPlayerBranding() {
    const panel = $('#player-branding-panel');
    if (panel) panel.classList.remove('hidden');
    if ($('#player-branding-form')?.dataset.dirty === '1') return;
    const b = state.playerBranding;
    const title = b?.title || 'Vision Player';
    const message = b?.message || 'Instale o Player e vincule a TV pelo código.';
    if ($('#branding-title')) $('#branding-title').value = b?.title || '';
    if ($('#branding-message')) $('#branding-message').value = b?.message || '';
    if ($('#branding-preview-title')) $('#branding-preview-title').textContent = title;
    if ($('#branding-preview-message')) $('#branding-preview-message').textContent = message;
    const playerUrl = `${location.origin}/player.html`;
    if ($('#branding-player-url')) $('#branding-player-url').value = playerUrl;
    if ($('#branding-setup-code')) $('#branding-setup-code').textContent = 'Global / Master';
    const preview = $('#player-branding-preview');
    if (preview) { preview.style.backgroundImage = ''; preview.dataset.loaded = ''; }
    hydratePlayerBrandingPreview();
  }

  async function hydratePlayerBrandingPreview() {
    const preview = $('#player-branding-preview');
    if (!preview || !state.playerBranding?.splash_path || preview.dataset.loaded === '1') return;
    const path = state.playerBranding.splash_path;
    try {
      const url = await getSignedMediaUrl(path);
      if ($('#player-branding-form')?.dataset.dirty === '1' || state.playerBranding?.splash_path !== path) return;
      preview.style.backgroundImage = `linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.45)),url("${url}")`;
      preview.dataset.loaded = '1';
    } catch { /* generic preview remains */ }
  }

  async function savePlayerBranding(event) {
    event.preventDefault();
    if (!state.isPlatformAdmin) return toast('Sem permissão', 'Somente o Master pode alterar a identidade global do Player.', 'error');
    const button = $('#branding-save');
    const file = $('#branding-file')?.files?.[0] || null;
    let newPath = null;
    const oldPath = state.playerBranding?.splash_path || null;
    setBusy(button, true, 'Salvando...');
    try {
      if (file) {
        const optimized = await optimizeImageForUpload(file);
        const upload = optimized.file;
        const safeName = optimized.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100);
        newPath = `_platform/branding/${crypto.randomUUID()}-${safeName}`;
        const encodedPath = newPath.split('/').map(encodeURIComponent).join('/');
        await storageRequest(`/object/${CONFIG.storageBucket}/${encodedPath}`, { body: upload, contentType: upload.type || 'image/webp', extraHeaders: { 'x-upsert': 'false' } });
      }
      const payload = {
        id: 1,
        title: $('#branding-title').value.trim() || null,
        message: $('#branding-message').value.trim() || null,
        splash_path: newPath || oldPath,
        updated_at: new Date().toISOString(),
        updated_by: state.user.id,
      };
      const rows = state.playerBranding
        ? await restRequest('platform_player_branding', { method: 'PATCH', query: 'id=eq.1', body: payload, prefer: 'return=representation' })
        : await restRequest('platform_player_branding', { method: 'POST', body: payload, prefer: 'return=representation' });
      state.playerBranding = rows?.[0] || null;
      if (!state.playerBranding) throw new Error('A configuração global foi enviada, mas não retornou do servidor.');
      if (newPath && oldPath && oldPath !== newPath) storageRequest(`/object/${CONFIG.storageBucket}`, { method: 'DELETE', body: { prefixes: [oldPath] } }).catch(() => {});
      $('#branding-file').value = '';
      delete $('#player-branding-form').dataset.dirty;
      renderPlayerBranding();
      toast('Salvo com sucesso', 'A identidade global do Vision Player foi atualizada para todos os clientes.');
    } catch (error) {
      if (newPath) storageRequest(`/object/${CONFIG.storageBucket}`, { method: 'DELETE', body: { prefixes: [newPath] } }).catch(() => {});
      toast('Erro ao salvar tela global do Player', error.message, 'error', 6000);
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

  function memberRoleLabel(role) {
    return ({ owner:'Proprietário', admin:'Administrador', operator:'Operador', viewer:'Visualizador' })[role] || role || 'Usuário';
  }

  function operationalActor(userId) {
    if (!userId) return { name:'Vision Player', detail:'Sistema automático' };
    const profile = state.profiles.find(item => item.id === userId);
    const member = state.companyMembers.find(item => item.user_id === userId);
    const isCurrentUser = userId === state.user?.id;
    const name = profile?.display_name || (isCurrentUser ? state.user?.email : '') || 'Usuário';
    const role = memberRoleLabel(member?.role);
    const detail = isCurrentUser && state.user?.email && profile?.display_name
      ? `${role} • ${state.user.email}`
      : role;
    return { name, detail };
  }

  function commandEventLabel(command) {
    const label = remoteCommandLabel(command.command_type);
    if (command.status === 'completed') return { severity:'info', message:`${label} concluída.`, code:`command_${command.command_type}_completed` };
    if (command.status === 'failed') return { severity:'error', message:command.error_message || `${label} falhou.`, code:`command_${command.command_type}_failed` };
    return { severity:'info', message:`${label} solicitada.`, code:`command_${command.command_type}_requested` };
  }

  function operationalEvents() {
    const playerEvents = state.deviceEvents.map(event => ({
      ...event,
      source:'player',
      actor: event.details?.actor_user_id ? operationalActor(event.details.actor_user_id) : { name:'Vision Player', detail:'Sistema automático' },
      eventTime:event.occurred_at,
    }));
    const commandEvents = state.deviceCommands.map(command => {
      const presentation = commandEventLabel(command);
      return {
        id:`command-${command.id}`,
        device_id:command.device_id,
        severity:presentation.severity,
        event_code:presentation.code,
        message:presentation.message,
        actor:operationalActor(command.requested_by),
        eventTime:command.completed_at || command.requested_at,
        source:'user',
      };
    });
    return [...playerEvents, ...commandEvents]
      .sort((a,b) => new Date(b.eventTime || 0).getTime() - new Date(a.eventTime || 0).getTime())
      .slice(0,150);
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
    const search = String($('#monitor-device-search')?.value || '').trim().toLowerCase();
    const deviceFilter = $('#monitor-device-filter')?.value || 'all';
    const visibleDevices = state.devices.filter(device => {
      const status = effectiveDeviceStatus(device);
      if (search && !String(device.name || '').toLowerCase().includes(search)) return false;
      if (deviceFilter === 'online' && status !== 'online') return false;
      if (deviceFilter === 'offline' && status !== 'offline') return false;
      if (deviceFilter === 'issue' && !deviceHasActiveIssue(device)) return false;
      if (deviceFilter === 'stale' && !deviceSyncIsStale(device)) return false;
      return true;
    });
    const hasDevices = visibleDevices.length > 0;
    empty.classList.toggle('hidden', hasDevices);
    grid.classList.toggle('hidden', !hasDevices);

    if (hasDevices) {
      grid.innerHTML = visibleDevices.map(device => {
        const status = effectiveDeviceStatus(device);
        const activeIssue = deviceHasActiveIssue(device);
        const syncStale = deviceSyncIsStale(device);
        const activeCampaign = campaignForDevice(device);
        const campaignName = activeCampaign?.name || (device.current_campaign_id ? 'Campanha removida' : 'Conteúdo padrão');
        const effectivePlaylistId = activeCampaign?.playlist_id || device.current_playlist_id;
        const playlistName = monitorEntityName(state.playlists, effectivePlaylistId, effectivePlaylistId ? 'Playlist removida' : '—');
        const mediaName = monitorEntityName(state.media, device.current_media_id, device.current_media_id ? 'Mídia removida' : '—');
        const resolution = device.screen_width && device.screen_height ? `${device.screen_width}×${device.screen_height}` : '—';
        const storageBytes = device.storage_free_mb == null ? null : Number(device.storage_free_mb) * 1024 * 1024;
        const queueTotal = Number(device.playback_queue_size || 0) + Number(device.event_queue_size || 0);
        const diagnostics = deviceDiagnostics(device);
        const heartbeat = latestDeviceHeartbeat(device.id);
        const networkHealth = heartbeatNetworkLabel(heartbeat);
        const clockHealth = heartbeatClockLabel(heartbeat);
        const likelyCause = deviceLikelyCause(device);
        return `
          <article class="monitor-device-card ${activeIssue ? 'has-issue' : ''}">
            <button class="monitor-device-toggle" type="button" data-monitor-device-toggle="${escapeHtml(device.id)}" aria-expanded="false">Detalhes</button>
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
              ${diagnostics.map(alert => `<span class="health-chip ${alert.level}">${escapeHtml(alert.label)}</span>`).join('')}
            </div>
            <div class="monitor-data-grid monitor-device-details">
              <div><span>Última conexão</span><strong>${escapeHtml(formatLastSeen(device.last_seen_at))}</strong></div>
              <div><span>Última sincronização</span><strong>${escapeHtml(device.last_sync_at ? formatMonitorDateTime(device.last_sync_at) : 'Ainda não sincronizou')}</strong></div>
              <div><span>Player</span><strong>${escapeHtml(device.player_version || device.app_version || '—')}</strong></div>
              <div><span>APK</span><strong>${escapeHtml(device.apk_version || '—')}</strong></div>
              <div><span>Resolução</span><strong>${escapeHtml(resolution)}</strong></div>
              <div><span>Orientação</span><strong>${escapeHtml(orientationLabel(device.orientation))} / reportada: ${escapeHtml(reportedOrientationLabel(device.reported_orientation))}</strong></div>
              <div><span>Cache local</span><strong>${Number(device.cache_items || 0)} item(ns) • ${escapeHtml(formatBytes(Number(device.cache_bytes || 0)))}</strong></div>
              <div><span>Espaço livre estimado</span><strong>${escapeHtml(storageBytes == null ? '—' : formatBytes(storageBytes))}</strong></div>
              <div><span>Campanha atual</span><strong>${escapeHtml(campaignName)}</strong></div>
              <div><span>Playlist atual</span><strong>${escapeHtml(playlistName)}</strong></div>
              <div class="monitor-current-media"><span>Mídia em reprodução</span><strong>${escapeHtml(mediaName)}</strong></div>
              <div><span>Filas offline</span><strong>${Number(device.playback_queue_size || 0)} veiculação • ${Number(device.event_queue_size || 0)} evento</strong></div>
              <div><span>Internet</span><strong class="monitor-wrap-value">${escapeHtml(networkHealth)}</strong></div>
              <div><span>Data/hora</span><strong class="monitor-wrap-value">${escapeHtml(clockHealth)}</strong></div>
              <div class="monitor-diagnostic-cell"><span>Diagnóstico</span><strong class="monitor-wrap-value">${escapeHtml(likelyCause)}</strong></div>
            </div>
            ${activeIssue ? `<div class="monitor-last-error monitor-device-details"><strong>Última falha:</strong> ${escapeHtml(device.last_error_message || device.last_error_code || 'Erro do player')}<small>${escapeHtml(formatMonitorDateTime(device.last_error_at))}</small></div>` : ''}
          </article>`;
      }).join('');
    } else {
      grid.innerHTML = '';
    }

    const severity = $('#monitor-severity-filter')?.value || '';
    const events = operationalEvents().filter(event => !severity || event.severity === severity);
    const eventsList = $('#monitor-events-list');
    const eventsEmpty = $('#monitor-events-empty');
    eventsEmpty.classList.toggle('hidden', events.length > 0);
    eventsList.classList.toggle('hidden', events.length === 0);
    eventsList.innerHTML = events.map(event => {
      const device = state.devices.find(item => item.id === event.device_id);
      const actor = event.actor || { name:'Vision Player', detail:'Sistema automático' };
      return `
        <div class="monitor-event ${escapeHtml(event.severity)}">
          <div class="monitor-event-icon">${event.severity === 'critical' ? '!' : event.severity === 'error' ? '×' : event.severity === 'warning' ? '!' : 'i'}</div>
          <div class="monitor-event-copy">
            <div><strong>${escapeHtml(device?.name || 'TV removida')}</strong><span class="event-severity ${escapeHtml(event.severity)}">${escapeHtml(eventSeverityLabel(event.severity))}</span></div>
            <p>${escapeHtml(event.message)}</p>
            <div class="monitor-event-actor"><strong>${escapeHtml(actor.name)}</strong><span>${escapeHtml(actor.detail)}</span></div>
            <small>${escapeHtml(formatMonitorDateTime(event.eventTime))} • ${escapeHtml(event.event_code)}</small>
          </div>
        </div>`;
    }).join('');
  }

  function mediaOrientationLabel(media) {
    const width = Number(media?.width || 0);
    const height = Number(media?.height || 0);
    if (!width || !height) return 'Orientação não detectada';
    if (width === height) return 'Quadrada';
    return width > height ? 'Horizontal' : 'Vertical';
  }

  async function signedMediaUrlCached(media) {
    const key = `${media.id}:${media.storage_path}`;
    const cached = state.mediaPreviewUrls.get(key);
    if (cached?.url && cached.expiresAt > Date.now() + 60_000) return cached.url;
    const url = await getSignedMediaUrl(media.storage_path);
    state.mediaPreviewUrls.set(key, { url, expiresAt: Date.now() + 12 * 60_000 });
    return url;
  }

  function currentMediaRenderSignature() {
    const mediaPart = state.media.map(media => [
      media.id, media.storage_path, media.source_url, media.media_type, media.updated_at, media.name, media.width, media.height, media.size_bytes, media.duration_seconds
    ].join(':')).join('|');
    const itemPart = state.playlistItems.map(item => `${item.id}:${item.playlist_id}:${item.media_id}`).join('|');
    const playlistPart = state.playlists.map(playlist => `${playlist.id}:${playlist.name}`).join('|');
    return `${mediaPart}__${itemPart}__${playlistPart}`;
  }

  function mediaPlaylistOptions(mediaId) {
    if (!state.playlists.length) return '<option value="">Crie uma playlist primeiro</option>';
    const linked = new Set(state.playlistItems.filter(item => item.media_id === mediaId).map(item => item.playlist_id));
    return '<option value="">Escolha a playlist…</option>' + state.playlists.map(playlist => {
      const already = linked.has(playlist.id);
      return `<option value="${playlist.id}" ${already ? 'disabled' : ''}>${escapeHtml(playlist.name)}${already ? ' • já vinculada' : ''}</option>`;
    }).join('');
  }

  async function loadStablePreviewElement(media, url) {
    if (media.media_type === 'image') {
      const image = new Image();
      image.loading = 'eager';
      image.decoding = 'async';
      image.fetchPriority = 'low';
      image.alt = media.name || 'Imagem';
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Tempo excedido ao carregar a miniatura.')), 12000);
        image.onload = () => { clearTimeout(timeout); resolve(); };
        image.onerror = () => { clearTimeout(timeout); reject(new Error('Miniatura indisponível.')); };
        image.src = url;
      });
      return image;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tempo excedido ao carregar o vídeo.')), 12000);
      video.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
      video.onerror = () => { clearTimeout(timeout); reject(new Error('Prévia do vídeo indisponível.')); };
      video.src = url;
    });
    try { video.currentTime = Math.min(.1, Math.max(0, (video.duration || 1) / 10)); } catch {}
    return video;
  }

  async function hydrateMediaPreviews() {
    for (const media of state.media.filter(item => item.storage_path && ['image','video'].includes(item.media_type))) {
      const targets = $$(`[data-media-preview="${CSS.escape(media.id)}"]`);
      if (!targets.length) continue;

      for (const preview of targets) {
        if (preview.dataset.loadedPath === media.storage_path || preview.dataset.loadingPath === media.storage_path) continue;
        preview.dataset.loadingPath = media.storage_path;
        try {
          const url = await signedMediaUrlCached(media);
          if (!preview.isConnected || preview.dataset.loadedPath === media.storage_path) continue;
          const element = await loadStablePreviewElement(media, url);
          if (!preview.isConnected) continue;
          const old = Array.from(preview.children).find(node => node.matches?.('img, video'));
          if (old) old.replaceWith(element);
          else preview.insertBefore(element, preview.firstChild);
          preview.querySelector('.media-preview-placeholder')?.remove();
          preview.dataset.loadedPath = media.storage_path;
          delete preview.dataset.previewError;
          preview.removeAttribute('title');
        } catch (error) {
          if (preview.isConnected) {
            preview.dataset.previewError = '1';
            preview.title = String(error?.message || 'Prévia indisponível');
          }
        } finally {
          if (preview.isConnected && preview.dataset.loadingPath === media.storage_path) delete preview.dataset.loadingPath;
        }
      }
    }
  }

  function renderMedia() {
    const grid = $('#media-grid');
    const empty = $('#media-empty');
    const has = state.media.length > 0;
    empty.classList.toggle('hidden', has);
    grid.classList.toggle('hidden', !has);
    grid.className = 'media-list-compact';
    if (!has) {
      grid.innerHTML = '';
      state.mediaRenderSignature = '';
      return;
    }

    const signature = currentMediaRenderSignature();
    if (signature === state.mediaRenderSignature && grid.children.length === state.media.length) {
      hydrateMediaPreviews();
      return;
    }
    state.mediaRenderSignature = signature;

    grid.innerHTML = state.media.map(media => {
      const linkedItems = state.playlistItems.filter(item => item.media_id === media.id);
      const linkedPlaylists = new Set(linkedItems.map(item => item.playlist_id));
      const dimensions = media.width && media.height ? `${media.width}×${media.height}` : 'Resolução não detectada';
      const duration = media.duration_seconds ? ` • ${escapeHtml(formatDuration(media.duration_seconds))}` : '';
      const orientation = media.media_type === 'image' ? mediaOrientationLabel(media) : (media.media_type === 'url' ? 'Online' : 'Vídeo');
      return `
      <article class="media-row-compact media-row-pro" data-media-card="${media.id}">
        <div class="media-preview media-preview-clean" data-media-preview="${media.id}">
          <span class="media-preview-placeholder">${media.media_type === 'video' ? '▶' : (media.media_type === 'url' ? '↗' : '▧')}</span>
          ${media.media_type === 'image' ? `<div class="media-preview-tools" aria-label="Ajustes da imagem">
            <button class="media-overlay-button" type="button" data-rotate-media="${media.id}" data-rotation="-90" title="Girar para a esquerda" aria-label="Girar para a esquerda">↶</button>
            <button class="media-overlay-button" type="button" data-rotate-media="${media.id}" data-rotation="90" title="Girar para a direita" aria-label="Girar para a direita">↷</button>
          </div>` : ''}
        </div>
        <div class="media-body media-body-pro">
          <strong title="${escapeHtml(media.name)}">${escapeHtml(media.name)}</strong>
          <small>${escapeHtml(formatBytes(media.size_bytes))} • ${escapeHtml(dimensions)}${duration} • ${escapeHtml(orientation)}</small>
          <span class="media-link-count">${linkedPlaylists.size ? `Em ${linkedPlaylists.size} playlist${linkedPlaylists.size === 1 ? '' : 's'}` : 'Ainda não vinculada a playlist'}</span>
        </div>
        <div class="media-direct-playlist">
          <select data-media-playlist-select="${media.id}" ${state.playlists.length ? '' : 'disabled'}>
            ${mediaPlaylistOptions(media.id)}
          </select>
          <button class="small-icon-button media-link-button" type="button" data-link-media-playlist="${media.id}" ${state.playlists.length ? '' : 'disabled'}>+ Vincular</button>
        </div>
        <div class="media-actions media-actions-pro">
          <button class="small-icon-button" data-open-media="${media.id}">Visualizar</button>
          <button class="small-icon-button" data-delete-media="${media.id}">Excluir</button>
        </div>
      </article>`;
    }).join('');

    hydrateMediaPreviews();
  }

  function playlistCardDuration(items, mediaById) {
    return items.reduce((sum, item) => {
      if (item.enabled === false) return sum;
      const media = mediaById[item.media_id];
      const raw = item.duration_override_seconds || media?.duration_seconds || (media?.media_type === 'image' ? 10 : 0);
      const seconds = Number(raw || 0);
      return sum + (Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
    }, 0);
  }

  function playlistCardState(items) {
    if (!items.length) return { key:'empty', label:'Vazia' };
    const enabled = items.filter(item => item.enabled !== false);
    if (!enabled.length) return { key:'paused', label:'Pausada' };
    return { key:'active', label:'Ativa' };
  }

  function playlistCardSchedule(items) {
    if (!items.length) return { scheduled:false, label:'Sem programação', detail:'Adicione mídias para começar.' };
    const enabled = items.filter(item => item.enabled !== false);
    const scheduled = enabled.filter(item => item.schedule_enabled);
    if (!scheduled.length) return { scheduled:false, label:'Sempre disponível', detail:'Sem restrição de horário.' };
    if (scheduled.length === 1) return { scheduled:true, label:'1 mídia programada', detail:playlistItemScheduleLabel(scheduled[0]) };
    return { scheduled:true, label:`${scheduled.length} mídias programadas`, detail:'Cada mídia segue sua própria agenda.' };
  }

  async function hydratePlaylistCardPreviews(mediaIds) {
    const mediaById = Object.fromEntries(state.media.map(media => [media.id, media]));
    for (const mediaId of [...new Set(mediaIds.filter(Boolean))]) {
      const media = mediaById[mediaId];
      if (!media?.storage_path || !['image','video'].includes(media.media_type)) continue;
      const targets = $$(`[data-playlist-card-preview="${CSS.escape(mediaId)}"]`);
      for (const target of targets) {
        if (target.dataset.loadedPath === media.storage_path || target.dataset.loadingPath === media.storage_path) continue;
        target.dataset.loadingPath = media.storage_path;
        try {
          const url = await signedMediaUrlCached(media);
          const element = await loadStablePreviewElement(media, url);
          if (!target.isConnected) continue;
          target.replaceChildren(element);
          target.dataset.loadedPath = media.storage_path;
        } catch {
          // Mantém o placeholder atual e permite nova tentativa numa próxima atualização.
        } finally {
          if (target.isConnected && target.dataset.loadingPath === media.storage_path) delete target.dataset.loadingPath;
        }
      }
    }
  }

  function renderPlaylists() {
    const grid = $('#playlists-grid');
    const empty = $('#playlists-empty');
    const tools = $('#playlist-tools');
    const workflow = $('#playlist-workflow');
    const has = state.playlists.length > 0;

    empty.classList.toggle('hidden', has);
    grid.classList.toggle('hidden', !has);
    tools?.classList.toggle('hidden', !has);
    workflow?.classList.toggle('hidden', has);

    if (!has) { grid.innerHTML = ''; return; }

    const query = ($('#playlist-search')?.value || '').trim().toLowerCase();
    const statusFilter = $('#playlist-status-filter')?.value || 'all';
    const sortMode = $('#playlist-sort')?.value || 'updated_desc';
    const mediaById = Object.fromEntries(state.media.map(media => [media.id, media]));

    let rows = state.playlists.map(playlist => {
      const items = state.playlistItems
        .filter(item => item.playlist_id === playlist.id)
        .sort((a,b) => Number(a.position || 0) - Number(b.position || 0));
      const stateInfo = playlistCardState(items);
      const schedule = playlistCardSchedule(items);
      const duration = playlistCardDuration(items, mediaById);
      const deviceIds = new Set(state.deviceAssignments.filter(row => row.playlist_id === playlist.id).map(row => row.device_id).filter(Boolean));
      const previewMedia = items.map(item => mediaById[item.media_id]).filter(Boolean).slice(0,3);
      return {
        playlist, items, stateInfo, schedule, duration,
        tvCount: deviceIds.size,
        previewMedia,
        updatedAt: new Date(playlist.updated_at || playlist.created_at || 0).getTime() || 0,
      };
    });

    rows = rows.filter(row => {
      const searchable = `${row.playlist.name || ''} ${row.playlist.description || ''}`.toLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (statusFilter === 'active' && row.stateInfo.key !== 'active') return false;
      if (statusFilter === 'scheduled' && !row.schedule.scheduled) return false;
      if (statusFilter === 'unscheduled' && (row.items.length === 0 || row.schedule.scheduled)) return false;
      if (statusFilter === 'empty' && row.items.length !== 0) return false;
      return true;
    });

    rows.sort((a,b) => sortMode === 'name_asc'
      ? String(a.playlist.name || '').localeCompare(String(b.playlist.name || ''), 'pt-BR')
      : b.updatedAt - a.updatedAt);

    if (!rows.length) {
      grid.innerHTML = '<div class="playlist-filter-empty"><strong>Nenhuma playlist encontrada</strong><span>Ajuste a busca ou o filtro para ver outras playlists.</span></div>';
      return;
    }

    const stablePreviewIds = rows.flatMap(row => row.previewMedia.map(media => media.id));
    const playlistSignature = [
      query, statusFilter, sortMode,
      rows.map(row => [
        row.playlist.id, row.playlist.name, row.playlist.description, row.updatedAt,
        row.items.map(item => [item.id,item.media_id,item.position,item.enabled,item.schedule_enabled,item.updated_at].join(':')).join(','),
        row.previewMedia.map(media => [media.id,media.storage_path,media.updated_at].join(':')).join(',')
      ].join('|')).join('||')
    ].join('__');
    if (playlistSignature === state.playlistRenderSignature && grid.children.length === rows.length) {
      hydratePlaylistCardPreviews(stablePreviewIds);
      return;
    }
    state.playlistRenderSignature = playlistSignature;

    const previewIds = [];
    grid.innerHTML = rows.map(({ playlist, items, stateInfo, schedule, duration, tvCount, previewMedia }) => {
      previewIds.push(...previewMedia.map(media => media.id));
      const preview = previewMedia.length
        ? `<div class="playlist-preview-grid preview-count-${previewMedia.length}">${previewMedia.map(media => `<div class="playlist-preview-cell" data-playlist-card-preview="${media.id}"><span>${media.media_type === 'video' ? '▶' : '▧'}</span><small>${escapeHtml(media.name || '')}</small></div>`).join('')}</div>`
        : '<div class="playlist-preview-empty"><span>▶</span><strong>Playlist sem mídia</strong><small>Abra a playlist para adicionar conteúdo.</small></div>';
      return `
        <article class="playlist-card playlist-card-pro">
          <div class="playlist-pro-head">
            <div class="playlist-card-title">
              <div class="playlist-title-line"><strong title="${escapeHtml(playlist.name)}">${escapeHtml(playlist.name)}</strong><span class="playlist-state-chip ${stateInfo.key}">${stateInfo.label}</span></div>
              <span>${escapeHtml(playlist.description || 'Sem descrição')}</span>
            </div>
            <details class="playlist-more-menu">
              <summary class="small-icon-button" title="Mais ações" aria-label="Mais ações">⋯</summary>
              <div class="playlist-more-popover">
                <button type="button" class="playlist-menu-action danger-inline" data-delete-playlist="${playlist.id}">Excluir playlist</button>
              </div>
            </details>
          </div>

          ${preview}

          <div class="playlist-insight-grid">
            <div><span>Mídias</span><strong>${items.length}</strong></div>
            <div><span>Duração</span><strong>${duration ? escapeHtml(formatDuration(duration)) : '—'}</strong></div>
            <div><span>TVs</span><strong>${tvCount}</strong></div>
          </div>

          <div class="playlist-schedule-summary ${schedule.scheduled ? 'scheduled' : ''}">
            <span class="playlist-schedule-icon">◷</span>
            <div><strong>${escapeHtml(schedule.label)}</strong><small>${escapeHtml(schedule.detail)}</small></div>
          </div>

          <div class="playlist-card-actions">
            <button class="button primary" type="button" data-edit-playlist-items="${playlist.id}">Editar playlist</button>
          </div>
        </article>
      `;
    }).join('');

    hydratePlaylistCardPreviews(previewIds);
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
    const itemLimit = Math.max(60, Number(state.playlistItemRenderLimit || 60));
    const mediaLimitForSignature = Math.max(60, Number(state.playlistMediaRenderLimit || 60));
    const queryForSignature = String(state.playlistMediaQuery || '').trim().toLowerCase();
    const editorSignature = [
      playlist.id,
      playlist.name,
      itemLimit,
      mediaLimitForSignature,
      queryForSignature,
      [...state.selectedPlaylistItemIds].sort().join(','),
      items.map(item => [
        item.id,item.media_id,item.position,item.duration_override_seconds,item.enabled,item.is_essential,item.schedule_enabled,
        item.start_date,item.end_date,item.start_time,item.end_time,
        Array.isArray(item.weekdays) ? item.weekdays.join('.') : '',item.updated_at
      ].join(':')).join('|'),
      state.media.map(media => [
        media.id,media.name,media.media_type,media.storage_path,media.updated_at,media.width,media.height,media.size_bytes
      ].join(':')).join('|')
    ].join('__');
    if (
      editorSignature === state.playlistEditorRenderSignature &&
      $('#playlist-items-list')?.children.length >= 0 &&
      $('#playlist-media-picker')
    ) {
      syncPlaylistBulkUi();
      hydratePlaylistPreviews();
      return;
    }
    state.playlistEditorRenderSignature = editorSignature;


    const visibleItems = items.slice(0, itemLimit);
    const list = $('#playlist-items-list');
    $('#playlist-items-empty').classList.toggle('hidden', items.length > 0);
    if ($('#playlist-items-count')) $('#playlist-items-count').textContent = items.length
      ? `${Math.min(visibleItems.length, items.length)} de ${items.length} mídias`
      : '0 mídias';
    const moreItems = $('#playlist-items-more');
    if (moreItems) {
      moreItems.classList.toggle('hidden', visibleItems.length >= items.length);
      moreItems.textContent = visibleItems.length < items.length
        ? `Carregar mais (${items.length - visibleItems.length} restantes)`
        : 'Todas carregadas';
    }

    list.innerHTML = visibleItems.map((item, index) => {
      const media = mediaById[item.media_id];
      const isImage = media?.media_type === 'image';
      const seconds = Math.max(1, Math.round(Number(item.duration_override_seconds || media?.duration_seconds || 10)));
      const checked = state.selectedPlaylistItemIds.has(item.id);
      return `
        <div class="sortable-row playlist-item-row" draggable="true" data-playlist-drag-item="${item.id}">
          <input class="playlist-select-box" type="checkbox" data-select-playlist-item="${item.id}" ${checked ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(media?.name || 'mídia')}" />
          <span class="drag-handle" title="Arrastar para ordenar">⋮⋮</span>
          <div class="playlist-thumb" data-playlist-media-preview="${media?.id || ''}"><span>${media?.media_type === 'video' ? '▶' : '▧'}</span></div>
          <div class="playlist-item-copy"><strong>${index + 1}. ${escapeHtml(media?.name || 'Mídia removida')}</strong><small>${escapeHtml(media?.media_type || '')}${media?.width && media?.height ? ` • ${media.width}×${media.height}` : ''}</small><div class="playlist-item-meta"><span class="enabled-chip ${item.enabled ? '' : 'off'}">${item.enabled ? 'Ativa' : 'Desativada'}</span><span class="schedule-chip ${item.schedule_enabled ? 'active' : ''}">${escapeHtml(playlistItemScheduleLabel(item))}</span>${item.is_essential ? '<span class="schedule-chip active" title="Se esta mídia não puder ser carregada, o Player pode ativar a playlist de emergência.">Essencial</span>' : ''}</div></div>
          ${isImage ? `<label class="playlist-duration-mini">Tempo <input type="number" min="1" max="86400" step="1" value="${seconds}" data-item-duration-input="${item.id}" /> s <button class="small-icon-button" type="button" data-save-item-duration="${item.id}">Salvar</button></label>` : `<span class="playlist-video-duration">${media?.duration_seconds ? escapeHtml(formatDuration(media.duration_seconds)) : 'Vídeo'}</span>`}
          <div class="playlist-inline-actions"><button class="small-icon-button" type="button" data-edit-item-schedule="${item.id}">◷ Programar</button><button class="small-icon-button" type="button" data-toggle-item-essential="${item.id}" title="${item.is_essential ? 'Deixar de considerar essencial' : 'Marcar como mídia essencial'}">${item.is_essential ? '★ Essencial' : '☆ Essencial'}</button><button class="small-icon-button" type="button" data-toggle-item-enabled="${item.id}" title="${item.enabled ? 'Desativar' : 'Ativar'}">${item.enabled ? '⏸' : '▶'}</button><button class="small-icon-button" type="button" data-move-item="${item.id}" data-direction="up" ${index===0?'disabled':''}>↑</button><button class="small-icon-button" type="button" data-move-item="${item.id}" data-direction="down" ${index===items.length-1?'disabled':''}>↓</button><button class="small-icon-button" type="button" data-remove-item="${item.id}">×</button></div>
        </div>`;
    }).join('');

    const picker = $('#playlist-media-picker');
    const included = new Map(items.map((item,index) => [item.media_id,index + 1]));
    const query = queryForSignature;
    const filteredMedia = state.media.filter(media => !query || String(media.name || '').toLowerCase().includes(query));
    const mediaLimit = mediaLimitForSignature;
    const visibleMedia = filteredMedia.slice(0, mediaLimit);
    $('#playlist-media-empty').classList.toggle('hidden', state.media.length > 0);
    if ($('#playlist-media-count')) $('#playlist-media-count').textContent = query
      ? `${filteredMedia.length} resultado${filteredMedia.length === 1 ? '' : 's'}`
      : `${state.media.length} disponíveis`;
    const moreMedia = $('#playlist-media-more');
    if (moreMedia) {
      moreMedia.classList.toggle('hidden', visibleMedia.length >= filteredMedia.length);
      moreMedia.textContent = visibleMedia.length < filteredMedia.length
        ? `Carregar mais (${filteredMedia.length - visibleMedia.length} restantes)`
        : 'Todas carregadas';
    }

    picker.innerHTML = !filteredMedia.length && state.media.length
      ? '<div class="mini-empty playlist-search-empty">Nenhuma mídia encontrada com essa busca.</div>'
      : visibleMedia.map(media => {
          const order=included.get(media.id);
          return `<div class="picker-row ${order?'already-selected':''}"><div class="playlist-thumb" data-playlist-media-preview="${media.id}"><span>${media.media_type==='video'?'▶':'▧'}</span></div><div class="grow"><strong>${escapeHtml(media.name)}</strong><small>${escapeHtml(media.media_type)} • ${escapeHtml(formatBytes(media.size_bytes))}</small><span class="playlist-selection-state ${order?'selected':''}">${order?`Já adicionada • ordem ${order}`:'Ainda não selecionada'}</span></div><button class="small-icon-button picker-add-button" data-add-media-to-playlist="${media.id}" ${order?'disabled':''}>${order?'Adicionada':'+ Adicionar'}</button></div>`;
        }).join('');

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
      for (const target of targets) {
        if (target.dataset.loadedPath === media.storage_path || target.dataset.loadingPath === media.storage_path) continue;
        target.dataset.loadingPath = media.storage_path;
        try {
          const url = await signedMediaUrlCached(media);
          const element = await loadStablePreviewElement(media, url);
          if (!target.isConnected) continue;
          target.replaceChildren(element);
          target.dataset.loadedPath = media.storage_path;
        } catch {
          // Mantém o placeholder e tenta novamente quando a tela for atualizada.
        } finally {
          if (target.isConnected && target.dataset.loadingPath === media.storage_path) delete target.dataset.loadingPath;
        }
      }
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

  function setView(view, { persist = true } = {}) {
    const titles = {
      dashboard: ['VISÃO GERAL', 'Dashboard Operacional'],
      devices: ['DISPOSITIVOS', 'TVs'],
      monitoring: ['OPERAÇÃO', 'Monitoramento'],
      media: ['BIBLIOTECA', 'Mídias'],
      playlists: ['CONTEÚDO', 'Playlists'],
      campaigns: ['PROGRAMAÇÃO', 'Campanhas'],
      reports: ['RELATÓRIOS', 'Prova de veiculação'],
      inbox: ['COMUNICAÇÃO', 'Mensagens'],
    };
    if (!VALID_OPERATIONAL_VIEWS.has(view)) view = 'dashboard';
    state.activeView = view;
    if (persist) {
      writeLocalValue(VIEW_KEY, view);
      writeLocalValue(ACTIVE_AREA_KEY, 'operational');
    }
    $$('.view-section').forEach(section => section.classList.add('hidden'));
    $(`#view-${view}`)?.classList.remove('hidden');
    $$('.nav-item[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    $('#view-kicker').textContent = titles[view]?.[0] || '';
    $('#view-title').textContent = titles[view]?.[1] || '';
    $('#sidebar').classList.remove('open');
    if (view === 'reports' && !state.report && !state.reportLoading) loadPlaybackReport({ quiet: true });
    if (view === 'inbox') loadNotificationInbox({ quiet: true }).catch(() => null);
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
      if (/email_already_registered/i.test(code)) {
        switchAuthTab('login');
        $('#login-email').value = email;
        $('#login-password').focus();
        toast('E-mail já cadastrado', 'Esse e-mail já possui uma conta. Entre com sua senha ou use “Esqueci minha senha”.', 'error', 6500);
        return;
      }
      const friendly = /platform_client_limit_reached/i.test(code) ? 'No momento não há novas vagas de clientes nesta infraestrutura.'
        : /plan_not_available/i.test(code) ? 'O plano selecionado não está mais disponível.'
        : /signup_rate_limited/i.test(code) ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
        : friendlyAuthError(error);
      toast('Não foi possível criar o cadastro', friendly, 'error');
    } finally { setBusy(button, false); }
  }

  let passwordRecoveryCooldownTimer = null;
  let recoveryAccessToken = null;

  function passwordRecoveryWaitSeconds(error) {
    const message = String(error?.message || error || '');
    const match = message.match(/(?:after|in)\s+(\d+)\s*seconds?/i);
    if (match) return Math.max(1, Number(match[1]) || 0);
    if (/security purposes|rate.?limit|too many/i.test(message)) return 30;
    return 0;
  }

  function startPasswordRecoveryCooldown(seconds = 30) {
    const button = $('#forgot-password');
    if (!button) return;
    clearInterval(passwordRecoveryCooldownTimer);
    let remaining = Math.max(1, Math.ceil(Number(seconds) || 30));
    button.disabled = true;

    const render = () => {
      button.textContent = remaining > 0 ? `Reenviar em ${remaining}s` : 'Esqueci minha senha';
      if (remaining <= 0) {
        clearInterval(passwordRecoveryCooldownTimer);
        passwordRecoveryCooldownTimer = null;
        button.disabled = false;
        return;
      }
      remaining -= 1;
    };

    render();
    passwordRecoveryCooldownTimer = setInterval(render, 1000);
  }

  function openPasswordRecoveryFromUrl() {
    const raw = String(location.hash || '').replace(/^#/, '');
    if (!raw) return false;
    const params = new URLSearchParams(raw);
    if (params.get('type') !== 'recovery' || !params.get('access_token')) return false;
    recoveryAccessToken = params.get('access_token');
    history.replaceState({}, document.title, `${location.pathname}${location.search}`);
    showScreen('auth');
    const dialog = $('#password-reset-dialog');
    if (dialog && !dialog.open) dialog.showModal();
    return true;
  }

  async function handleRecoveryPasswordSubmit(event) {
    event.preventDefault();
    const button = $('#password-reset-save');
    const password = $('#password-reset-new').value;
    const confirmPassword = $('#password-reset-confirm').value;
    const status = $('#password-reset-status');
    const setStatus = (message = '', type = '') => {
      if (!status) return;
      status.textContent = message;
      status.className = `form-status ${type}`.trim();
      status.classList.toggle('hidden', !message);
    };
    if (!recoveryAccessToken) {
      setStatus('Link de recuperação inválido ou expirado.', 'error');
      return;
    }
    if (password.length < 8) {
      setStatus('Use pelo menos 8 caracteres.', 'error');
      $('#password-reset-new').focus();
      return;
    }
    if (password !== confirmPassword) {
      setStatus('As duas senhas precisam ser iguais.', 'error');
      $('#password-reset-confirm').focus();
      return;
    }
    setBusy(button, true, 'Salvando...');
    setStatus('Atualizando sua senha…', 'pending');
    try {
      const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: CONFIG.supabasePublishableKey,
          Authorization: `Bearer ${recoveryAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
        cache: 'no-store',
      });
      const user = await parseResponse(response);
      recoveryAccessToken = null;
      $('#password-reset-form').reset();
      closeDialog('password-reset-dialog');
      switchAuthTab('login');
      if (user?.email) $('#login-email').value = user.email;
      toast('Senha atualizada', 'Agora você já pode entrar com a nova senha.');
      return true;
    } catch (error) {
      setStatus(error.status === 401 ? 'Este link expirou. Solicite uma nova redefinição.' : 'Não foi possível atualizar a senha.', 'error');
      return false;
    } finally {
      setBusy(button, false);
    }
  }

  function passwordRecoveryRedirectUrl() {
    const isPublicOrigin = value => /^https:\/\//i.test(String(value || '')) && !/localhost|127\.0\.0\.1/i.test(String(value || ''));
    if (isPublicOrigin(location.origin)) return new URL('./index.html', location.href).href;
    try {
      if (document.referrer) {
        const ref = new URL(document.referrer);
        if (isPublicOrigin(ref.origin)) return `${ref.origin}/index.html`;
      }
    } catch {}
    return 'https://vision-midia-digital-e74lzn2i5-vision-5529.vercel.app/index.html';
  }

  async function handleForgotPassword() {
    const button = $('#forgot-password');
    if (button?.disabled) return;

    const email = $('#login-email').value.trim();
    if (!email) {
      toast('Informe seu e-mail', 'Preencha o e-mail para receber a recuperação.', 'error');
      $('#login-email').focus();
      return;
    }

    setBusy(button, true, 'Enviando...');
    try {
      await authRequest('/recover', {
        body: { email, redirect_to: passwordRecoveryRedirectUrl() },
      });
      toast('Recuperação enviada', 'Confira sua caixa de entrada. Você poderá solicitar outro link em 30 segundos.');
      setBusy(button, false);
      startPasswordRecoveryCooldown(30);
      return;
    } catch (error) {
      const wait = passwordRecoveryWaitSeconds(error);
      if (wait > 0) {
        toast('Aguarde para reenviar', `Por segurança, aguarde ${wait} segundos para solicitar outro link de recuperação.`, 'error');
        setBusy(button, false);
        startPasswordRecoveryCooldown(wait);
        return;
      }
      toast('Falha ao enviar recuperação', 'Não foi possível enviar o link agora. Confira o e-mail e tente novamente.', 'error');
    } finally {
      if (!button?.disabled) setBusy(button, false);
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
    const status = $('#pair-device-status');
    const setPairStatus = (message = '', type = '') => {
      if (!status) return;
      status.textContent = message;
      status.className = `access-refresh-status ${type}`.trim();
      status.classList.toggle('hidden', !message);
    };
    const code = $('#pair-device-code').value.replace(/\D/g, '');
    const name = $('#pair-device-name').value.trim();
    if (code.length !== 6 || !name) {
      const message = 'Informe os 6 dígitos exibidos no Vision Player e um nome para a TV.';
      setPairStatus(message, 'error');
      toast('Confira o código', message, 'error');
      return;
    }
    setBusy(button, true, 'Vinculando...');
    setPairStatus('Validando o código e vinculando esta TV…', 'pending');
    try {
      await functionRequest('claim-device', {
        body: {
          company_id: state.company.id,
          code,
          name,
          orientation: $('#pair-device-orientation').value,
        },
      });
      setPairStatus('TV vinculada com sucesso.', 'success');
      closeDialog('pair-device-dialog');
      $('#pair-device-form').reset();
      toast('TV pareada', 'O Vision Player receberá o acesso automaticamente.');
      await loadAllData();
    } catch (error) {
      const message = friendlyPairDeviceError(error);
      setPairStatus(message, 'error');
      toast('Não foi possível parear', message, 'error', 6500);
      renderDevicePlanUsage();
    } finally { setBusy(button, false); }
  }

  function openPairDeviceDialog() {
    $('#pair-device-code').value = '';
    $('#pair-device-name').value = '';
    $('#pair-device-orientation').value = 'auto';
    const status = $('#pair-device-status');
    if (status) {
      status.textContent = '';
      status.className = 'access-refresh-status hidden';
    }
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
      let replacementConfirmed = false;
      try {
        const rows = await restRequest('devices', {
          query: `select=id,status,retired_at&company_id=eq.${encodeURIComponent(state.company.id)}&id=eq.${encodeURIComponent(oldDeviceId)}&limit=1`,
        });
        const oldDevice = rows?.[0] || null;
        replacementConfirmed = !oldDevice || Boolean(oldDevice.retired_at) || oldDevice.status === 'disabled';
      } catch {
        try {
          await loadAllData();
          replacementConfirmed = !state.devices.some(device => device.id === oldDeviceId);
        } catch {}
      }

      if (replacementConfirmed) {
        closeDialog('replace-device-dialog');
        $('#replace-device-form').reset();
        toast('TV substituída com sucesso', 'A nova TV foi vinculada e a programação foi transferida. A confirmação final do servidor falhou apenas na auditoria.');
        await loadAllData().catch(() => {});
        return;
      }

      toast('Não foi possível substituir a TV', error.message || 'A substituição não foi confirmada.', 'error');
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

  async function updateDeviceOrientationQuick(deviceId, orientation, control = null) {
    const device = state.devices.find(item => item.id === deviceId);
    const allowed = ['auto','landscape','portrait'];
    if (!device || !allowed.includes(orientation)) return false;
    if (!['owner','admin','operator'].includes(state.companyRole)) {
      toast('Sem permissão', 'Seu usuário não pode alterar a rotação desta TV.', 'error');
      if (control) control.value = device.orientation || 'auto';
      return false;
    }

    if (control) control.disabled = true;
    try {
      await restRequest('devices', {
        method:'PATCH',
        query:`id=eq.${encodeURIComponent(deviceId)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
        body:{ orientation },
        prefer:'return=minimal',
      });
      device.orientation = orientation;
      toast('Rotação da TV atualizada', `${orientationLabel(orientation)}. O Vision Player aplicará a tela inteira na próxima sincronização.`);
      await loadAllData();
      return true;
    } catch (error) {
      if (control) control.value = device.orientation || 'auto';
      toast('Erro ao girar a TV', error.message || 'Não foi possível salvar a orientação.', 'error');
      return false;
    } finally {
      if (control?.isConnected) control.disabled = false;
    }
  }
  async function handleSaveDevice(event) {
    event.preventDefault();
    const button = $('#device-save');
    const id = $('#device-id').value;
    const currentDevice = id ? state.devices.find(device => device.id === id) : null;
    const currentSettings = currentDevice?.settings && typeof currentDevice.settings === 'object' ? currentDevice.settings : {};
    const payload = {
      name: $('#device-name').value.trim(),
      platform: $('#device-platform').value,
      orientation: $('#device-orientation').value,
      fallback_playlist_id: null,
      settings: {
        ...currentSettings,
        audio_enabled: $('#device-audio-enabled').checked,
        autostart_enabled: $('#device-autostart-enabled').checked,
        kiosk_return_enabled: $('#device-kiosk-return-enabled').checked,
      },
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
    const settings = device.settings && typeof device.settings === 'object' ? device.settings : {};
    $('#device-audio-enabled').checked = settings.audio_enabled !== false;
    $('#device-autostart-enabled').checked = settings.autostart_enabled !== false;
    $('#device-kiosk-return-enabled').checked = settings.kiosk_return_enabled === true;
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

  function updateMediaUploadCheck(file, meta) {
    const box = $('#media-upload-check');
    if (!box) return;
    if (!file || !file.type.startsWith('image/') || !meta?.width || !meta?.height) {
      box.classList.add('hidden');
      box.textContent = '';
      return;
    }
    const width = Number(meta.width), height = Number(meta.height);
    const ratio = width / height;
    const landscapeDelta = Math.abs(ratio - (16 / 9)) / (16 / 9);
    const portraitDelta = Math.abs(ratio - (9 / 16)) / (9 / 16);
    const landscape = landscapeDelta <= 0.025;
    const portrait = portraitDelta <= 0.025;
    const orientation = width >= height ? 'Horizontal' : 'Vertical';
    const ideal = landscape || portrait;
    const target = landscape ? '1920 × 1080 px (16:9)' : portrait ? '1080 × 1920 px (9:16)' : (width >= height ? '1920 × 1080 px (16:9)' : '1080 × 1920 px (9:16)');
    box.className = `media-upload-check ${ideal ? 'is-ideal' : 'has-warning'}`;
    box.innerHTML = `<strong>${ideal ? '✓ Proporção ideal' : '⚠ Proporção diferente da TV'}</strong><span>Imagem selecionada: ${width} × ${height} px • ${orientation}</span><small>${ideal ? 'A proporção está adequada para preencher a TV nessa orientação.' : `Para evitar faixas pretas ou cortes, crie a arte em ${target}.`}</small>`;
  }

  function resolveOnlineMediaUrl(rawUrl) {
    const url = new URL(rawUrl, location.href);
    const legacyVisionHost = /^(?:visionmidiadigital|vision-midia-digital)(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(url.hostname)
      || /^(?:[a-z0-9-]+--)?visionmidiadigitalgo\.netlify\.app$/i.test(url.hostname);
    const file = url.pathname.split('/').pop();
    if (url.origin === location.origin || legacyVisionHost) {
      if (file === 'clock.html' || (file === 'widget.html' && url.searchParams.get('type') === 'clock')) {
        return new URL('./clock.html', location.href).href;
      }
      if (file === 'news-feed.html') return new URL('./news-feed.html' + url.search, location.href).href;
    }
    return url.href;
  }

  function clockMediaUrl() {
    return new URL('./clock.html', location.href).href;
  }

  function newsMediaUrl(source = 'soccer') {
    const url = new URL('./news-feed.html', location.href);
    url.searchParams.set('source', source);
    return url.href;
  }

  function openOnlineMediaDialog(preset = '') {
    const dialog = $('#online-media-dialog');
    if (!dialog) return;
    if (preset === 'clock') {
      $('#online-media-name').value = 'Hora certa';
      $('#online-media-url').value = clockMediaUrl();
      $('#online-media-duration').value = '30';
    } else if (['soccer', 'news_br', 'cinema_br'].includes(preset)) {
      $('#online-media-name').value = {news_br:'Notícias — G1', soccer:'Futebol brasileiro — ge', cinema_br:'Cinema e séries — CinePOP'}[preset];
      $('#online-media-url').value = newsMediaUrl(preset);
      $('#online-media-duration').value = '30';
    } else {
      $('#online-media-name').value = '';
      $('#online-media-url').value = '';
      $('#online-media-duration').value = '30';
    }
    const playlistSelect = $('#online-media-playlist');
    if (playlistSelect) {
      playlistSelect.innerHTML = '<option value="">Somente biblioteca</option>' + state.playlists.map(playlist => `<option value="${escapeHtml(playlist.id)}">${escapeHtml(playlist.name)}</option>`).join('');
      playlistSelect.value = state.editingPlaylistId || '';
    }
    if (!dialog.open) dialog.showModal();
  }

  async function handleOnlineMediaSave(event) {
    event.preventDefault();
    const name = ($('#online-media-name')?.value || '').trim();
    const rawUrl = ($('#online-media-url')?.value || '').trim();
    const duration = Math.max(5, Math.min(3600, Number($('#online-media-duration')?.value || 30)));
    const playlistId = $('#online-media-playlist')?.value || '';
    if (playlistId && !state.playlists.some(playlist => playlist.id === playlistId)) return toast('Playlist indisponível', 'Escolha uma playlist da sua conta.', 'error');
    if (!name || !rawUrl) return toast('Preencha o conteúdo online', 'Informe nome e URL.', 'error');
    let parsed;
    try { parsed = new URL(resolveOnlineMediaUrl(rawUrl)); } catch { return toast('URL inválida', 'Use um endereço HTTP ou HTTPS válido.', 'error'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return toast('URL inválida', 'Use HTTP ou HTTPS.', 'error');
    const builtIn = ['clock.html', 'news-feed.html'].find(file =>
      parsed.origin === location.origin && parsed.pathname === new URL('./' + file, location.href).pathname);
    const button = event.target.querySelector('[type="submit"]');
    if (button?.disabled) return;
    setBusy(button, true, 'Adicionando...');
    let savedMedia = false;
    try {
      const created = await restRequest('media_assets', {
        method: 'POST',
        body: {
          company_id: state.company.id,
          name,
          media_type: 'url',
          mime_type: 'text/html',
          storage_path: null,
          source_url: builtIn ? './' + builtIn + parsed.search : parsed.href,
          duration_seconds: duration,
          size_bytes: 0,
          width: null,
          height: null,
          processing_status: 'ready',
          created_by: state.user.id,
        },
        prefer: 'return=representation',
      });
      savedMedia = true;
      if (playlistId) {
        const media = Array.isArray(created) ? created[0] : created;
        if (!media?.id) throw new Error('Conteúdo salvo na biblioteca, mas a API não retornou seu identificador.');
        const items = state.playlistItems.filter(item => item.playlist_id === playlistId);
        await restRequest('playlist_items', {
          method: 'POST',
          body: { company_id: state.company.id, playlist_id: playlistId, media_id: media.id,
            position: items.length ? Math.max(...items.map(item => Number(item.position || 0))) + 1 : 0,
            duration_override_seconds: duration, enabled: true },
          prefer: 'return=minimal',
        });
      }
      $('#online-media-dialog')?.close();
      toast(playlistId ? 'Conteúdo adicionado à playlist' : 'Conteúdo online adicionado', name);
      await loadAllData();
    } catch (error) {
      if (savedMedia) {
        $('#online-media-dialog')?.close();
        toast('Conteúdo salvo na biblioteca', 'Não foi possível concluir a operação. Confira a playlist antes de vincular pela biblioteca. ' + error.message, 'error');
        await loadAllData().catch(() => {});
      } else toast('Falha ao adicionar conteúdo online', error.message, 'error');
    } finally {
      setBusy(button, false);
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
    if (file.type.startsWith('image/')) {
      try {
        const selectedMeta = await getMediaMetadata(file);
        updateMediaUploadCheck(file, selectedMeta);
      } catch {
        updateMediaUploadCheck(null, null);
      }
    } else {
      updateMediaUploadCheck(null, null);
    }
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
        window.open(resolveOnlineMediaUrl(media.source_url), '_blank', 'noopener,noreferrer');
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

  async function linkMediaToPlaylist(mediaId, playlistId) {
    const media = state.media.find(item => item.id === mediaId);
    const playlist = state.playlists.find(item => item.id === playlistId);
    if (!media || !playlist) return toast('Escolha uma playlist', 'Selecione a playlist antes de vincular a mídia.', 'error');

    const duplicate = state.playlistItems.some(item => item.media_id === mediaId && item.playlist_id === playlistId);
    if (duplicate) return toast('Mídia já vinculada', `${media.name} já faz parte de ${playlist.name}.`, 'error');

    const playlistItems = state.playlistItems.filter(item => item.playlist_id === playlistId);
    const nextPosition = playlistItems.length ? Math.max(...playlistItems.map(item => Number(item.position || 0))) + 1 : 0;
    try {
      await restRequest('playlist_items', {
        method:'POST',
        body:{
          company_id:state.company.id,
          playlist_id:playlistId,
          media_id:mediaId,
          position:nextPosition,
          duration_override_seconds:media.media_type === 'image' ? 10 : null,
          enabled:true,
        },
        prefer:'return=minimal',
      });
      toast('Mídia vinculada', `${media.name} foi adicionada à playlist ${playlist.name}.`);
      state.mediaRenderSignature = '';
      await loadAllData();
    } catch (error) {
      toast('Não foi possível vincular', error.message, 'error');
    }
  }

  async function rotateMediaImage(mediaId, degrees = 90) {
    const media = state.media.find(item => item.id === mediaId);
    if (!media || media.media_type !== 'image' || !media.storage_path) return;
    const button = document.querySelector(`[data-rotate-media="${CSS.escape(mediaId)}"][data-rotation="${degrees}"]`);
    setBusy(button, true, '…');

    let tempUrl = null;
    let newPath = null;
    try {
      const signedUrl = await signedMediaUrlCached(media);
      const response = await fetch(signedUrl, { cache:'no-store' });
      if (!response.ok) throw new Error('Não foi possível baixar a imagem para girar.');
      const originalBlob = await response.blob();
      tempUrl = URL.createObjectURL(originalBlob);

      const image = await new Promise((resolve, reject) => {
        const el = new Image();
        const timeout = setTimeout(() => reject(new Error('Tempo excedido ao abrir a imagem.')), 15000);
        el.onload = () => { clearTimeout(timeout); resolve(el); };
        el.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível abrir a imagem.')); };
        el.src = tempUrl;
      });

      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight) throw new Error('A resolução da imagem não pôde ser detectada.');

      const canvas = document.createElement('canvas');
      canvas.width = sourceHeight;
      canvas.height = sourceWidth;
      const ctx = canvas.getContext('2d', { alpha:true });
      if (!ctx) throw new Error('Este navegador não conseguiu preparar a rotação.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((Number(degrees) >= 0 ? 90 : -90) * Math.PI / 180);
      ctx.drawImage(image, -sourceWidth / 2, -sourceHeight / 2);

      const outputType = ['image/jpeg','image/png','image/webp'].includes(media.mime_type) ? media.mime_type : 'image/webp';
      const blob = await new Promise(resolve => canvas.toBlob(resolve, outputType, outputType === 'image/jpeg' ? 0.94 : 0.92));
      if (!blob?.size) throw new Error('Não foi possível gerar a imagem girada.');

      const ext = outputType === 'image/jpeg' ? 'jpg' : outputType === 'image/png' ? 'png' : 'webp';
      newPath = `${state.company.id}/${crypto.randomUUID()}-rotated.${ext}`;
      const encodedPath = newPath.split('/').map(encodeURIComponent).join('/');
      await storageRequest(`/object/${CONFIG.storageBucket}/${encodedPath}`, {
        body:blob,
        contentType:outputType,
        extraHeaders:{ 'x-upsert':'false' },
      });

      await restRequest('media_assets', {
        method:'PATCH',
        query:`id=eq.${encodeURIComponent(media.id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
        body:{
          storage_path:newPath,
          mime_type:outputType,
          size_bytes:blob.size,
          width:canvas.width,
          height:canvas.height,
        },
        prefer:'return=minimal',
      });

      const oldPath = media.storage_path;
      for (const key of [...state.mediaPreviewUrls.keys()]) {
        if (key.startsWith(`${media.id}:`)) state.mediaPreviewUrls.delete(key);
      }
      state.mediaRenderSignature = '';
      state.playlistRenderSignature = '';
      state.playlistEditorRenderSignature = '';
      await loadAllData();
      hydrateMediaPreviews().catch(() => {});
      hydratePlaylistPreviews().catch(() => {});
      toast('Imagem girada', `Agora ela está em formato ${canvas.width > canvas.height ? 'horizontal' : canvas.width < canvas.height ? 'vertical' : 'quadrado'}.`);
      storageRequest(`/object/${CONFIG.storageBucket}`, { method:'DELETE', body:{ prefixes:[oldPath] } }).catch(() => {});
      newPath = null;
    } catch (error) {
      if (newPath) storageRequest(`/object/${CONFIG.storageBucket}`, { method:'DELETE', body:{ prefixes:[newPath] } }).catch(() => {});
      toast('Não foi possível girar a imagem', error.message, 'error', 6000);
    } finally {
      if (tempUrl) URL.revokeObjectURL(tempUrl);
      setBusy(button, false);
    }
  }

  async function handleCreatePlaylist(event) {
    event.preventDefault();
    const button = $('#playlist-save');
    setBusy(button, true, 'Criando...');
    try {
      const created = await restRequest('playlists', {
        method: 'POST',
        body: {
          company_id: state.company.id,
          name: $('#playlist-name').value.trim(),
          description: $('#playlist-description').value.trim() || null,
          created_by: state.user.id,
          shuffle: false,
          repeat_mode: 'loop',
        },
        prefer: 'return=representation',
      });
      if (created?.[0]?.id) state.playlists = [created[0], ...state.playlists.filter(item => item.id !== created[0].id)];
      state.mediaRenderSignature = '';
      state.playlistEditorRenderSignature = '';
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
    state.playlistItemRenderLimit = 60;
    state.playlistMediaRenderLimit = 60;
    state.playlistMediaQuery = '';
    state.playlistEditorRenderSignature = '';
    if ($('#playlist-media-search')) $('#playlist-media-search').value = '';
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
    updatePlaylistScheduleSummary();
    openDialog('playlist-schedule-dialog');
  }

  function playlistScheduleSelectedWeekdays() {
    return $('[data-playlist-weekday]')
      .filter(input => input.checked)
      .map(input => Number(input.dataset.playlistWeekday));
  }

  function playlistSchedulePeriodSummary(startDate, endDate) {
    if (!startDate && !endDate) return 'sem limite de datas';
    if (startDate && endDate) return `${formatDateShort(startDate)} → ${formatDateShort(endDate)}`;
    if (startDate) return `a partir de ${formatDateShort(startDate)}`;
    return `até ${formatDateShort(endDate)}`;
  }

  function updatePlaylistScheduleSummary() {
    const enabled = $('#playlist-schedule-enabled')?.checked !== false;
    const summary = $('#playlist-schedule-summary');
    const detail = $('#playlist-schedule-summary-detail');
    const note = $('#playlist-schedule-time-note');
    if (!summary || !detail) return;

    if (!enabled) {
      summary.textContent = 'Sempre disponível';
      detail.textContent = 'Sem restrição de data, horário ou dia da semana.';
      note?.classList.add('hidden');
      return;
    }

    const startDate = $('#playlist-schedule-start-date')?.value || '';
    const endDate = $('#playlist-schedule-end-date')?.value || '';
    const allDay = $('#playlist-schedule-all-day')?.checked !== false;
    const startTime = $('#playlist-schedule-start-time')?.value || '';
    const endTime = $('#playlist-schedule-end-time')?.value || '';
    const weekdays = playlistScheduleSelectedWeekdays();
    const orderedDays = [1,2,3,4,5,6,0].filter(day => weekdays.includes(day));
    const daysText = weekdays.length === 7
      ? 'Todos os dias'
      : orderedDays.length
        ? orderedDays.map(day => WEEKDAY_NAMES[day]).join(', ')
        : 'Nenhum dia selecionado';

    let timeText = 'dia inteiro';
    let crossesMidnight = false;
    if (!allDay) {
      if (startTime && endTime) {
        crossesMidnight = startTime > endTime;
        timeText = `${startTime} → ${endTime}${crossesMidnight ? ' (+1 dia)' : ''}`;
      } else {
        timeText = 'horário incompleto';
      }
    }

    summary.textContent = `${daysText} • ${timeText}`;
    detail.textContent = `Período: ${playlistSchedulePeriodSummary(startDate, endDate)}.`;
    if (note) {
      note.classList.toggle('hidden', allDay);
      note.textContent = crossesMidnight
        ? 'Esta janela atravessa a meia-noite. O trecho após 00:00 continua pertencendo ao dia em que a programação começou.'
        : 'Se a hora final for menor que a inicial, a programação atravessa a meia-noite. Ex.: 22:00 → 02:00.';
    }
  }

  function setPlaylistWeekdayPreset(preset) {
    const values = preset === 'weekdays' ? new Set([1,2,3,4,5])
      : preset === 'weekend' ? new Set([0,6])
      : new Set([0,1,2,3,4,5,6]);
    $$('[data-playlist-weekday]').forEach(input => {
      input.checked = values.has(Number(input.dataset.playlistWeekday));
    });
    playlistScheduleStatus();
    updatePlaylistScheduleSummary();
  }

  function syncPlaylistScheduleFormVisibility() {
    const enabled = $('#playlist-schedule-enabled')?.checked !== false;
    const allDay = $('#playlist-schedule-all-day')?.checked !== false;
    $$('.schedule-date-fields input').forEach(input => input.disabled = !enabled);
    $('#playlist-schedule-all-day').disabled = !enabled;
    $$('[data-playlist-weekday]').forEach(input => input.disabled = !enabled);
    $$('[data-playlist-weekday-preset]').forEach(button => button.disabled = !enabled);
    $('#playlist-schedule-time-fields').classList.toggle('hidden', !enabled || allDay);
    $('#playlist-schedule-time-note')?.classList.toggle('hidden', !enabled || allDay);
    updatePlaylistScheduleSummary();
  }

  async function applyPlaylistSchedule(event) {
    event.preventDefault();
    const ids = state.scheduleTargetItemIds.filter(Boolean);
    if (!ids.length) return;
    const enabled = $('#playlist-schedule-enabled').checked;
    const allDay = $('#playlist-schedule-all-day').checked;
    const weekdays = playlistScheduleSelectedWeekdays();
    const startDate = $('#playlist-schedule-start-date').value || null;
    const endDate = $('#playlist-schedule-end-date').value || null;
    const startTime = enabled && !allDay ? ($('#playlist-schedule-start-time').value || null) : null;
    const endTime = enabled && !allDay ? ($('#playlist-schedule-end-time').value || null) : null;
    if (enabled && !weekdays.length) return playlistScheduleStatus('❌ Selecione pelo menos um dia da semana.', 'error');
    if (startDate && endDate && endDate < startDate) return playlistScheduleStatus('❌ A data final não pode ser anterior à inicial.', 'error');
    if (enabled && !allDay && (!startTime || !endTime)) return playlistScheduleStatus('❌ Informe a hora inicial e final.', 'error');
    if (enabled && !allDay && startTime === endTime) return playlistScheduleStatus('❌ A hora inicial e final não podem ser iguais. Use “Dia inteiro” para exibir durante todo o dia.', 'error');
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
    const button = $('#playlist-schedule-clear');
    setBusy(button, true, 'Alterando...');
    playlistScheduleStatus('Alterando para exibição sempre disponível...', 'pending');
    try {
      await Promise.all(ids.map(id => restRequest('playlist_items', { method:'PATCH', query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`, body:{schedule_enabled:false,start_date:null,end_date:null,start_time:null,end_time:null,weekdays:[0,1,2,3,4,5,6]}, prefer:'return=minimal' })));
      await loadAllData();
      playlistScheduleStatus('✅ Agora estas mídias ficam sempre disponíveis.', 'success');
      toast('Programação removida', 'As mídias voltaram a ficar disponíveis sempre.');
      setTimeout(() => closeDialog('playlist-schedule-dialog'), 550);
    } catch (error) {
      playlistScheduleStatus(`❌ ${error.message}`, 'error');
      toast('Erro ao remover programação', error.message, 'error');
    } finally {
      setBusy(button, false);
    }
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

  async function togglePlaylistItemEssential(itemId) {
    const item = state.playlistItems.find(row => row.id === itemId);
    if (!item) return;
    try {
      await restRequest('playlist_items', {
        method:'PATCH',
        query:`id=eq.${encodeURIComponent(itemId)}&company_id=eq.${encodeURIComponent(state.company.id)}`,
        body:{ is_essential:!item.is_essential },
        prefer:'return=minimal',
      });
      await loadAllData();
      toast(!item.is_essential ? 'Mídia essencial' : 'Mídia comum', !item.is_essential ? 'Esta mídia foi marcada como essencial.' : 'Esta mídia deixou de ser essencial.');
    } catch (error) { toast('Erro ao atualizar mídia essencial', error.message, 'error'); }
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
    const brandingForm = $('#player-branding-form');
    if (brandingForm) { brandingForm.reset(); delete brandingForm.dataset.dirty; }
    localStorage.removeItem(COMPANY_KEY);
    state.company = null;
    state.expiryCompanies = [];
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

  function dismissSidebarFromOutside(event) {
    const sidebar = $('#sidebar');
    if (!sidebar?.classList.contains('open') || sidebar.contains(event.target) || $('#menu-button')?.contains(event.target)) return;
    sidebar.classList.remove('open');
  }

  function bindEvents() {
    document.addEventListener('click', event => trackActionButton(event.target.closest('button')), true);
    document.addEventListener('submit', event => trackActionButton(event.submitter), true);
    $$('.auth-tab').forEach(btn => btn.addEventListener('click', () => switchAuthTab(btn.dataset.authTab)));
    $('#login-form').addEventListener('submit', handleLogin);
    $('#signup-form').addEventListener('submit', handleSignup);
    $('#forgot-password').addEventListener('click', handleForgotPassword);
    $('#password-reset-form')?.addEventListener('submit', handleRecoveryPasswordSubmit);
    $('#company-form').addEventListener('submit', handleCreateCompany);
    $('#access-refresh').addEventListener('click', async () => {
      const button = $('#access-refresh');
      const status = $('#access-refresh-status');
      const setStatus = (message = '', type = '') => {
        if (!status) return;
        status.textContent = message;
        status.className = `access-refresh-status ${type}`.trim();
        status.classList.toggle('hidden', !message);
      };
      setBusy(button, true, 'Verificando...');
      setStatus('Consultando sua assinatura…', 'pending');
      try {
        await loadPublicConfig().catch(() => null);
        const liberated = await refreshAccessGate({ manual:true });
        if (liberated) setStatus('Acesso liberado. Abrindo seu painel…', 'success');
        else toast('Acesso ainda não liberado', 'A verificação automática continuará ativa.', 'error');
      } catch (error) {
        setStatus(`Não foi possível verificar agora: ${error.message}`, 'error');
        toast('Falha ao verificar acesso', error.message, 'error');
      } finally { setBusy(button, false); }
    });
    $('#access-logout').addEventListener('click', logout);
    $('#access-notifications').addEventListener('click', enableAccessNotifications);
    $('#app-notifications')?.addEventListener('click', enableAccessNotifications);
    $('#switch-account-button').addEventListener('click', logout);
    $('#logout-button').addEventListener('click', logout);
    $('#refresh-button').addEventListener('click', async () => {
      try { await loadAllData(); toast('Dados atualizados'); }
      catch (error) { toast('Falha ao atualizar', error.message, 'error'); }
    });
    $('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    document.addEventListener('pointerdown', dismissSidebarFromOutside);
    $$('.nav-item[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-go-view]');
      if (button) setView(button.dataset.goView);
    });
    $('#inbox-refresh')?.addEventListener('click', async () => {
      const button = $('#inbox-refresh');
      setBusy(button, true, 'Atualizando...');
      try { await loadNotificationInbox(); }
      finally { setBusy(button, false); }
    });
    $('#inbox-filter')?.addEventListener('change', event => {
      state.notificationFilter = event.target.value || 'all';
      state.selectedNotificationIds.clear();
      renderNotificationInbox();
    });
    $('#inbox-select-all')?.addEventListener('change', event => {
      const ids = visibleInboxItems().map(item => item.id);
      if (event.target.checked) ids.forEach(id => state.selectedNotificationIds.add(id));
      else ids.forEach(id => state.selectedNotificationIds.delete(id));
      renderNotificationInbox();
    });
    $('#inbox-delete-selected')?.addEventListener('click', async () => {
      const ids = [...state.selectedNotificationIds];
      if (!ids.length) return;
      if (!confirm(`Excluir ${ids.length} mensagem(ns) da sua caixa de entrada?`)) return;
      const button = $('#inbox-delete-selected');
      setBusy(button, true, 'Excluindo...');
      try {
        await deleteInboxMessages(ids);
        toast('Mensagens excluídas', `${ids.length} mensagem(ns) removida(s) da sua caixa.`);
      } catch (error) {
        toast('Não foi possível excluir', error.message, 'error');
      } finally { setBusy(button, false); }
    });
    document.addEventListener('change', event => {
      const checkbox = event.target.closest?.('[data-inbox-select]');
      if (!checkbox) return;
      const id = checkbox.dataset.inboxSelect;
      if (checkbox.checked) state.selectedNotificationIds.add(id);
      else state.selectedNotificationIds.delete(id);
      renderNotificationInbox();
    });
    document.addEventListener('click', async event => {
      const readButton = event.target.closest?.('[data-inbox-read]');
      if (readButton) {
        const id = readButton.dataset.inboxRead;
        const nextRead = readButton.dataset.nextRead !== 'false';
        setBusy(readButton, true, nextRead ? 'Marcando...' : 'Alterando...');
        try { await setInboxMessageRead(id, nextRead); }
        catch (error) { toast('Não foi possível alterar a mensagem', error.message, 'error'); }
        finally { setBusy(readButton, false); }
        return;
      }
      const deleteButton = event.target.closest?.('[data-inbox-delete]');
      if (!deleteButton) return;
      const id = deleteButton.dataset.inboxDelete;
      if (!confirm('Excluir esta mensagem da sua caixa de entrada?')) return;
      setBusy(deleteButton, true, 'Excluindo...');
      try {
        await deleteInboxMessages([id]);
        toast('Mensagem excluída');
      } catch (error) {
        toast('Não foi possível excluir', error.message, 'error');
      } finally { setBusy(deleteButton, false); }
    });
    $$('[data-action="quick-device"]').forEach(btn => btn.addEventListener('click', () => { setView('devices'); openPairDeviceDialog(); }));

    $('#add-device-button').addEventListener('click', openPairDeviceDialog);
    $('#add-device-group')?.addEventListener('click', () => openDeviceGroupDialog());
    $('#device-group-form')?.addEventListener('submit', saveDeviceGroup);
    $('#monitor-refresh').addEventListener('click', async () => {
      const button = $('#monitor-refresh');
      setBusy(button, true, 'Atualizando...');
      try { await loadAllData(); toast('Monitoramento atualizado'); }
      catch (error) { toast('Falha ao atualizar monitoramento', error.message, 'error'); }
      finally { setBusy(button, false); }
    });
    $('#monitor-severity-filter').addEventListener('change', renderMonitoring);
    $('#monitor-device-search')?.addEventListener('input', renderMonitoring);
    $('#monitor-device-filter')?.addEventListener('change', renderMonitoring);
    $('#monitor-devices-grid')?.addEventListener('click', event => {
      const button = event.target.closest('[data-monitor-device-toggle]');
      if (!button) return;
      const card = button.closest('.monitor-device-card');
      const expanded = card?.classList.toggle('expanded') || false;
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.textContent = expanded ? 'Ocultar' : 'Detalhes';
    });
    $('#pair-device-form').addEventListener('submit', handlePairDevice);
    $('#view-tv-refresh').addEventListener('click', refreshTvViewer);
    $('#replace-device-form').addEventListener('submit', handleReplaceDevice);
    $('#device-form').addEventListener('submit', handleSaveDevice);
    $('#add-playlist-button').addEventListener('click', () => openDialog('playlist-dialog'));
    $('[data-open-playlist-create]')?.addEventListener('click', () => openDialog('playlist-dialog'));
    $('#playlist-search')?.addEventListener('input', renderPlaylists);
    $('#playlist-status-filter')?.addEventListener('change', renderPlaylists);
    $('#playlist-sort')?.addEventListener('change', renderPlaylists);
    $('#playlist-media-search')?.addEventListener('input', event => {
      state.playlistMediaQuery = event.target.value || '';
      state.playlistMediaRenderLimit = 60;
      renderPlaylistEditor();
    });
    $('#playlist-items-more')?.addEventListener('click', () => {
      state.playlistItemRenderLimit = Number(state.playlistItemRenderLimit || 60) + 60;
      renderPlaylistEditor();
    });
    $('#playlist-media-more')?.addEventListener('click', () => {
      state.playlistMediaRenderLimit = Number(state.playlistMediaRenderLimit || 60) + 60;
      renderPlaylistEditor();
    });
    $('#playlist-form').addEventListener('submit', handleCreatePlaylist);
    $('#player-branding-form')?.addEventListener('submit', savePlayerBranding);
    $('#player-branding-form')?.addEventListener('input', () => {
      $('#player-branding-form').dataset.dirty = '1';
      $('#branding-preview-title').textContent = $('#branding-title').value || 'Vision Player';
      $('#branding-preview-message').textContent = $('#branding-message').value || 'Instale o Player e vincule a TV pelo código.';
    });
    $('#branding-file')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      const preview = $('#player-branding-preview');
      if (!file || !preview) return;
      $('#player-branding-form').dataset.dirty = '1';
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          preview.style.backgroundImage = `linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.45)),url("${reader.result}")`;
          toast('Capa pronta para salvar', 'Clique em Salvar tela global para aplicar ao Player.');
        };
        img.onerror = () => toast('Imagem inválida', 'Não foi possível abrir a capa selecionada.', 'error');
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
    $('#branding-copy-url')?.addEventListener('click', async () => {
      const value = $('#branding-player-url')?.value || `${location.origin}/player.html`;
      try { await navigator.clipboard.writeText(value); toast('Link copiado'); }
      catch { $('#branding-player-url')?.select(); document.execCommand('copy'); toast('Link copiado'); }
    });
    $('#branding-open-player')?.addEventListener('click', () => window.open($('#branding-player-url')?.value || './player.html','_blank','noopener'));
    $('#playlist-schedule-form').addEventListener('submit', applyPlaylistSchedule);
    $('#playlist-schedule-clear').addEventListener('click', clearPlaylistSchedule);
    $('#playlist-schedule-enabled').addEventListener('change', () => { playlistScheduleStatus(); syncPlaylistScheduleFormVisibility(); });
    $('#playlist-schedule-all-day').addEventListener('change', () => { playlistScheduleStatus(); syncPlaylistScheduleFormVisibility(); });
    ['#playlist-schedule-start-date','#playlist-schedule-end-date','#playlist-schedule-start-time','#playlist-schedule-end-time'].forEach(selector => {
      $(selector)?.addEventListener('input', () => { playlistScheduleStatus(); updatePlaylistScheduleSummary(); });
      $(selector)?.addEventListener('change', () => { playlistScheduleStatus(); updatePlaylistScheduleSummary(); });
    });
    $$('[data-playlist-weekday]').forEach(input => input.addEventListener('change', () => { playlistScheduleStatus(); updatePlaylistScheduleSummary(); }));
    $$('[data-playlist-weekday-preset]').forEach(button => button.addEventListener('click', () => setPlaylistWeekdayPreset(button.dataset.playlistWeekdayPreset)));
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
    $('#add-online-media-button')?.addEventListener('click', () => openOnlineMediaDialog());
    $('#online-media-form')?.addEventListener('submit', handleOnlineMediaSave);
    $$('[data-online-preset]').forEach(button => button.addEventListener('click', () => openOnlineMediaDialog(button.dataset.onlinePreset)));

    $$('[data-close-dialog]').forEach(btn => btn.addEventListener('click', () => closeDialog(btn.dataset.closeDialog)));

    document.addEventListener('change', event => {
      const groupSelect = event.target.closest?.('[data-device-group]');
      if (groupSelect) setDeviceGroup(groupSelect.dataset.deviceGroup, groupSelect.value);
    });

    document.addEventListener('change', event => {
      const orientationControl = event.target.closest?.('[data-device-orientation-quick]');
      if (orientationControl) {
        return updateDeviceOrientationQuick(
          orientationControl.dataset.deviceOrientationQuick,
          orientationControl.value,
          orientationControl
        );
      }
    });
    document.addEventListener('click', event => {
      const authorizeDevice = event.target.closest('[data-authorize-device]');
      if (authorizeDevice) return authorizeDevicePermanently(authorizeDevice.dataset.authorizeDevice);
      const viewDevice = event.target.closest('[data-view-device]');
      if (viewDevice) return openTvViewer(viewDevice.dataset.viewDevice);
      const captureDevice = event.target.closest('[data-capture-device]');
      if (captureDevice) return requestDeviceScreenshot(captureDevice.dataset.captureDevice);
      const restartDevice = event.target.closest('[data-restart-device]');
      if (restartDevice) return requestDeviceRestart(restartDevice.dataset.restartDevice, restartDevice);
      const maintenanceButton = event.target.closest('[data-maintenance-command][data-maintenance-device]');
      if (maintenanceButton) return requestDeviceMaintenanceCommand(maintenanceButton.dataset.maintenanceDevice, maintenanceButton.dataset.maintenanceCommand, maintenanceButton);
      const editGroup = event.target.closest('[data-edit-device-group]');
      if (editGroup) return openDeviceGroupDialog(editGroup.dataset.editDeviceGroup);
      const deleteGroup = event.target.closest('[data-delete-device-group]');
      if (deleteGroup) return deleteDeviceGroup(deleteGroup.dataset.deleteDeviceGroup);
      const replaceDevice = event.target.closest('[data-replace-device]');
      if (replaceDevice) return openReplaceDeviceDialog(replaceDevice.dataset.replaceDevice);
      const editDevice = event.target.closest('[data-edit-device]');
      if (editDevice) return openEditDeviceDialog(editDevice.dataset.editDevice);
      const deleteDeviceButton = event.target.closest('[data-delete-device]');
      if (deleteDeviceButton) return deleteDevice(deleteDeviceButton.dataset.deleteDevice);
      const openMediaButton = event.target.closest('[data-open-media]');
      if (openMediaButton) return openMedia(openMediaButton.dataset.openMedia);
      const rotateMediaButton = event.target.closest('[data-rotate-media]');
      if (rotateMediaButton) return rotateMediaImage(rotateMediaButton.dataset.rotateMedia, Number(rotateMediaButton.dataset.rotation || 90));
      const linkMediaButton = event.target.closest('[data-link-media-playlist]');
      if (linkMediaButton) {
        const mediaId = linkMediaButton.dataset.linkMediaPlaylist;
        const playlistId = document.querySelector(`[data-media-playlist-select="${CSS.escape(mediaId)}"]`)?.value || '';
        return linkMediaToPlaylist(mediaId, playlistId);
      }
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
      const toggleEssential = event.target.closest('[data-toggle-item-essential]');
      if (toggleEssential) return togglePlaylistItemEssential(toggleEssential.dataset.toggleItemEssential);
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

    $('#view-tv-dialog').addEventListener('close', () => { state.viewingDeviceId = null; tvViewerResizeObserver?.disconnect?.(); tvViewerResizeObserver = null; });
    $('#playlist-items-dialog').addEventListener('close', () => {
      state.editingPlaylistId = null;
      state.selectedPlaylistItemIds = new Set();
      state.playlistItemRenderLimit = 60;
      state.playlistMediaRenderLimit = 60;
      state.playlistMediaQuery = '';
      state.playlistEditorRenderSignature = '';
      if ($('#playlist-media-search')) $('#playlist-media-search').value = '';
    });
  }

  bootstrap().catch(error => {
    console.error(error);
    toast('Erro ao iniciar o painel', error.message, 'error', 8000);
  });
})();
