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

    button.href = url;
    button.classList.remove('disabled');
    button.removeAttribute('aria-disabled');
    button.textContent = 'Baixar APK para TV Box';
    button.setAttribute('download', 'Vision-Player-Estavel.apk');
    if (note) note.textContent = 'APK compilado disponível. Confirmando os metadados da build…';

    try {
      const cacheBust = Date.now().toString(36);
      const manifestRequest = `${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}v=${cacheBust}`;
      const checksumRequest = `${url.replace(/\.apk$/, ".sha256")}?v=${cacheBust}`;
      const apkRequest = `${url}${url.includes('?') ? '&' : '?'}v=${cacheBust}`;

      const [manifestResponse, checksumResponse, apkResponse] = await Promise.all([
        fetch(manifestRequest, { cache: 'no-store' }),
        fetch(checksumRequest, { cache: 'no-store' }),
        fetch(apkRequest, { method: 'HEAD', cache: 'no-store' }),
      ]);

      if (!manifestResponse.ok) throw new Error('Manifesto da build não encontrado.');
      if (!checksumResponse.ok) throw new Error('Checksum do APK não encontrado.');
      if (!apkResponse.ok) throw new Error('Arquivo APK não encontrado.');

      const manifest = await manifestResponse.json();
      const checksumText = (await checksumResponse.text()).trim();
      const sourceHash = String(manifest?.source_sha256 || '').trim().toLowerCase();
      const buildSha = String(manifest?.git_sha || '').trim().toLowerCase();
      const checksumMatch = checksumText.match(/^([a-f0-9]{64})\s+/i);

      if (!/^[a-f0-9]{64}$/.test(sourceHash) || !/^[a-f0-9]{40}$/.test(buildSha) || !checksumMatch) {
        throw new Error('Metadados da build incompletos.');
      }

      if (manifest.apk_sha256 && String(manifest.apk_sha256).toLowerCase() !== checksumMatch[1].toLowerCase()) {
        throw new Error('Checksum diferente dos metadados da build.');
      }

      if (manifest.application_id !== 'com.visionmidia.player.stable' || manifest.version_code < 16 || manifest.signer_sha256 !== '21642106e5a7add7537db0b87b4a6e4ff4609862beff3087aa8a76144febf8cb') {
        throw new Error('Identidade da versão estável não confirmada.');
      }

      const contentLength = Number(apkResponse.headers.get('content-length') || 0);
      if (contentLength > 0 && contentLength < 100000) {
        throw new Error('Arquivo APK inválido ou incompleto.');
      }

      button.href = `${url}${url.includes('?') ? '&' : '?'}v=${checksumMatch[1]}`;
      button.classList.remove('disabled');
      button.removeAttribute('aria-disabled');
      button.textContent = `Baixar APK ${manifest.apk_version || 'preview'}`;
      button.setAttribute('download', 'Vision-Player-Estavel.apk');
      if (note) {
        note.textContent = `APK ${manifest.apk_version || 'preview'} • build ${buildSha.slice(0, 10)} • SHA-256 ${checksumMatch[1].slice(0, 12)}… Assinatura permanente. Primeira migração: instale ao lado do Player antigo e use Substituir TV. Depois, atualize sobre o Player Estável instalado.`;
      }
    } catch (error) {
      disableApkButton(button, note, 'Tentar novamente após atualizar', `Não foi possível conferir o APK: ${error?.message || 'erro desconhecido'}. Atualize a página para tentar novamente.`);
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
    const session = await validateSession(readSession());
    if (!session) {
      warning?.classList.remove('hidden');
      content?.classList.add('hidden');
      return;
    }

    saveSession(session);
    warning?.classList.add('hidden');
    content?.classList.remove('hidden');
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
