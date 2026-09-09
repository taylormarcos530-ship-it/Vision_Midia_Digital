(() => {
  'use strict';

  const CONFIG = window.VISION_CONFIG;
  const SESSION_KEY = 'vision_midia_session_v1';
  const VALID_VIEWS = new Set(['dashboard', 'clients', 'plans', 'audit']);
  const TITLES = {
    dashboard: ['PLATAFORMA', 'Dashboard SaaS'],
    clients: ['CONTAS', 'Clientes'],
    plans: ['COMERCIAL', 'Planos'],
    audit: ['SEGURANÇA', 'Auditoria'],
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function saveSession(session) {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  async function parse(response) {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = text; }
    if (!response.ok) {
      const error = new Error(data?.error_description || data?.message || data?.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function refreshSession() {
    const session = readSession();
    if (!session?.refresh_token) return null;
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: CONFIG.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
      cache: 'no-store',
    });
    const data = await parse(response);
    saveSession(data);
    return data;
  }

  async function whoAmI(retry = true) {
    const session = readSession();
    if (!session?.access_token) throw Object.assign(new Error('session_required'), { status: 401 });
    const response = await fetch(`${CONFIG.supabaseUrl}/functions/v1/master-admin`, {
      method: 'POST',
      headers: {
        apikey: CONFIG.supabasePublishableKey,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'whoami' }),
      cache: 'no-store',
    });
    if (response.status === 401 && retry && session.refresh_token) {
      await refreshSession();
      return whoAmI(false);
    }
    return parse(response);
  }

  function setOuterTitle(view) {
    const title = TITLES[view] || TITLES.dashboard;
    if ($('#view-kicker')) $('#view-kicker').textContent = title[0];
    if ($('#view-title')) $('#view-title').textContent = title[1];
  }

  function openSaasView(view, sourceButton = null) {
    if (!VALID_VIEWS.has(view)) view = 'dashboard';
    const section = $('#view-saas-admin');
    const frame = $('#saas-master-frame');
    if (!section || !frame) return;

    $$('.view-section').forEach((item) => item.classList.add('hidden'));
    section.classList.remove('hidden');
    $$('.nav-item').forEach((item) => item.classList.remove('active'));
    (sourceButton || $(`[data-saas-view="${view}"]`))?.classList.add('active');
    setOuterTitle(view);
    $('#sidebar')?.classList.remove('open');

    if (frame.dataset.masterView !== view) {
      frame.dataset.masterView = view;
      frame.src = `./master.html?embed=1&view=${encodeURIComponent(view)}`;
    }
  }

  function bindSaasNav() {
    $$('[data-saas-view]').forEach((button) => {
      if (button.dataset.saasBound === '1') return;
      button.dataset.saasBound = '1';
      button.addEventListener('click', () => openSaasView(button.dataset.saasView, button));
    });
  }

  async function init() {
    const group = $('#saas-admin-nav');
    if (!group || !CONFIG?.supabaseUrl || !CONFIG?.supabasePublishableKey) return;
    bindSaasNav();
    try {
      const who = await whoAmI();
      const allowed = ['super_admin', 'admin'].includes(String(who?.role || ''));
      group.classList.toggle('hidden', !allowed);
      document.body.classList.toggle('has-saas-admin', allowed);
    } catch (error) {
      group.classList.add('hidden');
      document.body.classList.remove('has-saas-admin');
      if (![401, 403].includes(Number(error?.status))) console.warn('SaaS admin bridge:', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
