(() => {
  'use strict';

  const CONFIG = window.VISION_CONFIG || {};
  const SESSION_KEY = 'vision_midia_session_v1';
  let deferredInstallPrompt = null;

  const $ = (selector) => document.querySelector(selector);

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function saveSession(session) {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  async function refreshSession(session) {
    if (!session?.refresh_token) return null;
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: CONFIG.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const next = await response.json().catch(() => null);
    if (!next?.access_token) return null;
    saveSession(next);
    return next;
  }

  async function validateSession(session) {
    if (!session?.access_token || !CONFIG.supabaseUrl || !CONFIG.supabasePublishableKey) return null;
    let current = session;
    let response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: CONFIG.supabasePublishableKey, Authorization: `Bearer ${current.access_token}` },
      cache: 'no-store',
    });
    if (response.status === 401 && current.refresh_token) {
      current = await refreshSession(current);
      if (!current) return null;
      response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/user`, {
        headers: { apikey: CONFIG.supabasePublishableKey, Authorization: `Bearer ${current.access_token}` },
        cache: 'no-store',
      });
    }
    return response.ok ? current : null;
  }

  async function detectMaster(session) {
    try {
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
      if (!response.ok) return false;
      const data = await response.json().catch(() => null);
      return Boolean(data?.role);
    } catch { return false; }
  }

  function setupApkButton() {
    const button = $('#android-apk-download');
    const note = $('#android-apk-note');
    const url = String(CONFIG.androidPlayerApkUrl || '').trim();
    if (!button) return;
    if (!url) {
      button.removeAttribute('href');
      button.classList.add('disabled');
      button.setAttribute('aria-disabled', 'true');
      button.textContent = 'APK ainda não publicado';
      return;
    }
    button.href = url;
    button.classList.remove('disabled');
    button.removeAttribute('aria-disabled');
    button.textContent = 'Baixar APK para TV Box';
    button.setAttribute('download', 'Vision-Player-TVBox.apk');
    if (note) note.textContent = 'Baixe o APK, instale no TV Box e depois faça o pareamento pelo código exibido.';
  }

  function setupPanelInstall() {
    const button = $('#install-panel-button');
    const status = $('#install-panel-status');
    if (!button || !status) return;

    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
    if (standalone) {
      button.disabled = true;
      button.textContent = 'Painel já instalado';
      status.textContent = 'Este painel já está sendo executado como aplicativo.';
      return;
    }

    button.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        status.textContent = 'Se o navegador não abriu a instalação, use o menu do Chrome/Edge e escolha “Instalar aplicativo”.';
        return;
      }
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      if (choice?.outcome === 'accepted') {
        button.disabled = true;
        button.textContent = 'Instalação iniciada';
        status.textContent = 'O painel está sendo instalado neste dispositivo.';
      } else {
        status.textContent = 'Instalação cancelada. Você pode tentar novamente pelo menu do navegador.';
      }
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    const status = $('#install-panel-status');
    if (status) status.textContent = 'Instalação disponível neste dispositivo.';
  });

  window.addEventListener('appinstalled', () => {
    const button = $('#install-panel-button');
    const status = $('#install-panel-status');
    if (button) { button.disabled = true; button.textContent = 'Painel instalado'; }
    if (status) status.textContent = 'Instalação concluída.';
  });

  async function boot() {
    const warning = $('#auth-warning');
    const content = $('#downloads-content');
    const session = await validateSession(readSession());
    if (!session) {
      warning?.classList.remove('hidden');
      content?.classList.add('hidden');
      return;
    }

    warning?.classList.add('hidden');
    content?.classList.remove('hidden');
    setupApkButton();
    setupPanelInstall();

    if (await detectMaster(session)) $('#master-back')?.classList.remove('hidden');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
