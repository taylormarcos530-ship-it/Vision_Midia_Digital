(() => {
  'use strict';

  const CONFIG = window.VISION_CONFIG || {};
  const SESSION_KEY = 'vision_midia_session_v1';
  let deferredInstallPrompt = null;

  const $ = (selector) => document.querySelector(selector);

  function actionFeedback(message, type = 'success') {
    const el = $('#downloads-action-status');
    if (!el) return;
    el.textContent = message;
    el.className = `download-action-status ${type}`;
    el.classList.remove('hidden');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.add('hidden'), 4200);
  }

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
    const merged = { ...session, ...next, user: next.user || session.user || null };
    saveSession(merged);
    return merged;
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

  async function switchAccount() {
    const button = $('#downloads-switch-account');
    if (button) { button.disabled = true; button.textContent = 'Saindo...'; }
    actionFeedback('Saindo da conta...', 'pending');
    const session = readSession();
    try {
      if (session?.access_token) {
        await fetch(`${CONFIG.supabaseUrl}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            apikey: CONFIG.supabasePublishableKey,
            Authorization: `Bearer ${session.access_token}`,
          },
          cache: 'no-store',
        });
      }
    } catch {}
    saveSession(null);
    location.assign('./index.html');
  }

  const PLAYER_SOURCE_FILES = [
    './player.html',
    './player.css',
    './player.js',
    './config.js',
    './icon.svg',
    './player.webmanifest',
    './sw.js',
  ];

  async function sha256Hex(value) {
    if (!crypto?.subtle) throw new Error('Validação criptográfica indisponível.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function currentPlayerSourceHash() {
    let payload = '';
    for (const file of PLAYER_SOURCE_FILES) {
      const response = await fetch(file, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Não foi possível validar ${file}.`);
      payload += `${file.replace(/^\\.\\//, '')}\n${await response.text()}\n`;
    }
    return sha256Hex(payload);
  }

  function disableApkButton(button, note, label, message) {
    button.removeAttribute('href');
    button.classList.add('disabled');
    button.setAttribute('aria-disabled', 'true');
    button.textContent = label;
    if (note) note.textContent = message;
  }

  async function setupApkButton() {
    const button = $('#android-apk-download');
    const note = $('#android-apk-note');
    const url = String(CONFIG.androidPlayerApkUrl || '').trim();
    const manifestUrl = String(CONFIG.androidPlayerApkManifestUrl || '').trim();
    if (!button) return;

    if (!url || !manifestUrl) {
      disableApkButton(button, note, 'APK ainda não publicado', 'A build do Vision Player ainda não foi publicada para esta versão.');
      return;
    }

    disableApkButton(button, note, 'Validando APK...', 'Confirmando se o APK foi gerado com a mesma versão do Player deste painel.');

    try {
      const [manifestResponse, currentHash] = await Promise.all([
        fetch(manifestUrl, { cache: 'no-store' }),
        currentPlayerSourceHash(),
      ]);
      if (!manifestResponse.ok) throw new Error('Manifesto da build não encontrado.');
      const manifest = await manifestResponse.json();
      const apkHash = String(manifest?.source_sha256 || '').trim().toLowerCase();
      if (!apkHash || apkHash !== currentHash.toLowerCase()) {
        disableApkButton(
          button,
          note,
          'APK aguardando nova compilação',
          'O Player web foi atualizado depois da última build do APK. Gere uma nova build antes de instalar no TV Box.'
        );
        return;
      }

      button.href = url;
      button.classList.remove('disabled');
      button.removeAttribute('aria-disabled');
      button.textContent = 'Baixar APK para TV Box';
      button.setAttribute('download', 'Vision-Player-TVBox-preview.apk');
      if (note) {
        const shortSha = String(manifest?.git_sha || '').slice(0, 10);
        note.textContent = `APK validado com os mesmos arquivos do Player${shortSha ? ` • build ${shortSha}` : ''}. Instale no TV Box e faça o pareamento pelo código exibido.`;
      }
    } catch (error) {
      disableApkButton(
        button,
        note,
        'APK aguardando nova compilação',
        'Não foi possível confirmar que o APK corresponde ao Player atual. Gere uma nova build antes de instalar.'
      );
    }
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
        actionFeedback('✕ Não foi possível abrir o instalador automaticamente. Use o menu do navegador.', 'error');
        return;
      }
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      if (choice?.outcome === 'accepted') {
        button.disabled = true;
        button.textContent = '✓ Instalação iniciada';
        status.textContent = 'O painel está sendo instalado neste dispositivo.';
        actionFeedback('✓ Instalação iniciada com sucesso.');
      } else {
        status.textContent = 'Instalação cancelada. Você pode tentar novamente pelo menu do navegador.';
        actionFeedback('✕ Instalação cancelada.', 'error');
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
    if (button) { button.disabled = true; button.textContent = '✓ Painel instalado'; }
    if (status) status.textContent = 'Instalação concluída.';
    actionFeedback('✓ Painel instalado com sucesso.');
  });

  async function boot() {
    const warning = $('#auth-warning');
    const content = $('#downloads-content');
    const storedSession = readSession();
    if (!storedSession) {
      warning?.classList.remove('hidden');
      content?.classList.add('hidden');
      return;
    }

    // Render immediately from the local authenticated session so a slow or
    // temporarily unavailable auth check cannot leave the downloads page blank.
    warning?.classList.add('hidden');
    content?.classList.remove('hidden');
    const session = await validateSession(storedSession);
    if (!session) {
      saveSession(null);
      content?.classList.add('hidden');
      warning?.classList.remove('hidden');
      return;
    }
    saveSession(session);
    await setupApkButton();
    setupPanelInstall();
    $('#downloads-switch-account')?.addEventListener('click', switchAccount);
    $('#android-apk-download')?.addEventListener('click', event => {
      if (event.currentTarget.classList.contains('disabled')) {
        event.preventDefault();
        actionFeedback('✕ APK indisponível no momento.', 'error');
        return;
      }
      actionFeedback('✓ Download do APK iniciado.');
    });
    $('#panel-back')?.addEventListener('click', () => actionFeedback('Voltando ao painel...', 'pending'));

    if (await detectMaster(session)) $('#master-back')?.classList.remove('hidden');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
