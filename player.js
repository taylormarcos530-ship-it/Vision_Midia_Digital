(() => {
  'use strict';
  // preview-refresh-v39-timed-access

  const CONFIG = window.VISION_CONFIG;
  if (!CONFIG?.supabaseUrl || !CONFIG?.supabasePublishableKey) {
    document.body.innerHTML = '<main style="padding:40px;color:white">Configuração do Supabase ausente.</main>';
    return;
  }

  const APP_VERSION = 'vision-player-web-1.5.1';
  const DEVICE_TOKEN_KEY = 'vision_player_device_token_v1';
  const PAIRING_KEY = 'vision_player_pairing_v1';
  const MANIFEST_KEY = 'vision_player_manifest_v1';
  const MEDIA_CACHE = 'vision-player-media-v1';
  const PLAYBACK_QUEUE_KEY = 'vision_player_playback_queue_v1';
  const DEVICE_EVENT_QUEUE_KEY = 'vision_player_device_event_queue_v1';
  const SETUP_CODE_KEY = 'vision_player_setup_code_v1';
  const CACHE_REV_KEY = 'vision_player_cache_revision_v1';
  const querySetupCode = new URLSearchParams(location.search).get('setup');
  if (querySetupCode) localStorage.setItem(SETUP_CODE_KEY, String(querySetupCode).slice(0,128));

  function nativeStoredDeviceToken() {
    try { return String(window.VisionAndroid?.getDeviceToken?.() || '') || null; }
    catch { return null; }
  }

  const state = {
    deviceToken: localStorage.getItem(DEVICE_TOKEN_KEY) || nativeStoredDeviceToken() || null,
    pairing: readJson(PAIRING_KEY),
    manifest: readJson(MANIFEST_KEY),
    running: false,
    playlistNonce: 0,
    currentObjectUrl: null,
    wakeLock: null,
    heartbeatTimer: null,
    syncTimer: null,
    commandTimer: null,
    accessTimer: null,
    processingCommands: new Set(),
    lastSyncAt: readJson(MANIFEST_KEY)?.generated_at || null,
    currentMediaId: null,
    cacheItems: 0,
    cacheBytes: 0,
    audioEnabled: true,
    syncHadError: false,
    playbackHadError: false,
    lastEventTimes: {},
    cachePrefetchVersion: null,
    runtimeFallbackVersion: null,
    pairingStartInFlight: false,
    pairingRetryTimer: null,
    pairingRateLimitedUntil: 0,
  };

  if (state.deviceToken) {
    try { localStorage.setItem(DEVICE_TOKEN_KEY, state.deviceToken); } catch {}
    try { window.VisionAndroid?.storeDeviceToken?.(state.deviceToken); } catch {}
  }

  const $ = (selector) => document.querySelector(selector);
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function replaceNodeChildren(node, ...children) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    for (const child of children) {
      if (child) node.appendChild(child);
    }
  }

  function clientId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch {}
    try {
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      }
    } catch {}
    return `vision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }

  async function waitForChangeOrTimeout(nonce, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (nonce !== state.playlistNonce) return 'changed';
      await sleep(Math.min(250, Math.max(1, deadline - Date.now())));
    }
    return nonce !== state.playlistNonce ? 'changed' : 'timeout';
  }

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  }

  function writeJson(key, value) {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  }

  function playbackQueue() {
    const queue = readJson(PLAYBACK_QUEUE_KEY);
    return Array.isArray(queue) ? queue : [];
  }

  function queuePlayback(event) {
    const queue = playbackQueue();
    queue.push(event);
    if (queue.length > 2000) queue.splice(0, queue.length - 2000);
    writeJson(PLAYBACK_QUEUE_KEY, queue);
  }

  async function flushPlaybackQueue() {
    if (!state.deviceToken || !navigator.onLine) return;
    let queue = playbackQueue();
    while (queue.length) {
      const batch = queue.slice(0, 50);
      await gateway({ action: 'playback_batch', events: batch });
      queue = queue.slice(batch.length);
      writeJson(PLAYBACK_QUEUE_KEY, queue.length ? queue : null);
    }
  }


  function deviceEventQueue() {
    const queue = readJson(DEVICE_EVENT_QUEUE_KEY);
    return Array.isArray(queue) ? queue : [];
  }

  function queueDeviceEvent(eventCode, severity, message, details = {}, dedupeMs = 60_000) {
    const code = String(eventCode || '').slice(0, 80);
    const text = String(message || '').slice(0, 500);
    if (!code || !text) return;
    const fingerprint = `${code}:${text}`;
    const now = Date.now();
    if (now - Number(state.lastEventTimes[fingerprint] || 0) < dedupeMs) return;
    state.lastEventTimes[fingerprint] = now;
    const queue = deviceEventQueue();
    queue.push({
      client_event_id: clientId(),
      severity: ['info', 'warning', 'error', 'critical'].includes(severity) ? severity : 'info',
      event_code: code,
      message: text,
      details: details && typeof details === 'object' ? details : {},
      occurred_at: new Date().toISOString(),
    });
    if (queue.length > 500) queue.splice(0, queue.length - 500);
    writeJson(DEVICE_EVENT_QUEUE_KEY, queue);
  }

  async function flushDeviceEventQueue() {
    if (!state.deviceToken || !navigator.onLine) return;
    let queue = deviceEventQueue();
    while (queue.length) {
      const batch = queue.slice(0, 25);
      await monitorGateway({ action: 'event_batch', events: batch });
      queue = queue.slice(batch.length);
      writeJson(DEVICE_EVENT_QUEUE_KEY, queue.length ? queue : null);
    }
  }

  async function parseResponse(response) {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = text; }
    if (!response.ok) {
      const error = new Error(data?.message || data?.error || `Erro HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function decodeNativeBase64(value) {
    const binary = atob(String(value || ''));
    if (typeof TextDecoder !== 'undefined') {
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    try {
      return decodeURIComponent([...binary].map(ch => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    } catch {
      return binary;
    }
  }

  async function functionRequest(name, body, deviceToken = null) {
    const url = `${CONFIG.supabaseUrl}/functions/v1/${name}`;
    const payload = JSON.stringify(body || {});

    if (window.VisionAndroid?.postJson) {
      let envelope = '';
      try {
        envelope = String(window.VisionAndroid.postJson(
          url,
          payload,
          CONFIG.supabasePublishableKey,
          deviceToken || ''
        ) || '');
      } catch (bridgeError) {
        const error = new Error(`Falha na ponte Android: ${bridgeError?.message || bridgeError}`);
        error.status = 0;
        throw error;
      }
      const separator = envelope.indexOf('\n');
      const status = Number(separator >= 0 ? envelope.slice(0, separator) : 0);
      const encoded = separator >= 0 ? envelope.slice(separator + 1) : '';
      const text = encoded ? decodeNativeBase64(encoded) : '';
      if (status === 0) {
        const error = new Error(text || 'Sem conexão com o servidor. Verifique a internet e a data/hora do TV Box.');
        error.status = 0;
        throw error;
      }
      let data = null;
      try { data = text ? JSON.parse(text) : null; }
      catch { data = text; }
      if (status < 200 || status >= 300) {
        const error = new Error(data?.message || data?.error || `Erro HTTP ${status}`);
        error.status = status;
        error.data = data;
        throw error;
      }
      return data;
    }

    const headers = {
      apikey: CONFIG.supabasePublishableKey,
      'Content-Type': 'application/json',
    };
    if (deviceToken) headers['x-device-token'] = deviceToken;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
      cache: 'no-store',
    });
    return parseResponse(response);
  }

  function detectPlatform() {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('aft') || ua.includes('fire tv')) return 'firetv';
    if (ua.includes('android')) return 'android';
    if (ua.includes('windows')) return 'windows';
    if (ua.includes('smart-tv') || ua.includes('smarttv') || ua.includes('tizen') || ua.includes('webos')) return 'smarttv';
    return 'web';
  }

  function setStatus(text) {
    $('#player-status').textContent = text;
  }

  function isAccessError(error) {
    const code = String(error?.data?.error || error?.error || '');
    return ['device_access_pending','device_access_blocked','device_access_expired','account_suspended'].includes(code);
  }

  function showAccessBlocked(errorOrData = {}) {
    const data = errorOrData?.data || errorOrData || {};
    const code = String(data.error || '');
    let title = 'Acesso desta TV bloqueado';
    let message = data.message || 'Entre em contato com o administrador.';
    let expiry = 'O pareamento desta TV foi preservado.';

    if (code === 'device_access_pending') {
      title = 'Aguardando autorização';
      message = 'Esta TV já foi vinculada. O Master precisa definir o período de acesso.';
      expiry = 'Você não precisa instalar nem parear novamente.';
    } else if (code === 'device_access_expired') {
      title = 'Autorização expirada';
      message = 'O prazo de funcionamento desta TV terminou. O Master pode renovar sem novo pareamento.';
      expiry = data.access_expires_at ? `Vencimento: ${new Date(data.access_expires_at).toLocaleString('pt-BR')}` : 'Prazo encerrado.';
    } else if (code === 'device_access_blocked') {
      title = 'TV bloqueada pelo Master';
      message = 'O acesso desta TV foi bloqueado. O vínculo permanece salvo para uma futura reativação.';
    } else if (code === 'account_suspended') {
      if (data.reason === 'trial_expired') { title = 'Período de teste encerrado'; message = data.message || 'O período de demonstração terminou. Contrate ou renove um plano para continuar.'; expiry = data.trial_ends_at ? `Teste encerrado em: ${new Date(data.trial_ends_at).toLocaleString('pt-BR')}` : 'Período de teste encerrado.'; }
      else if (data.reason === 'pending_approval') { title = 'Aguardando aprovação'; message = data.message || 'O Master ainda precisa liberar esta conta.'; }
      else if (data.reason === 'payment_required' || data.reason === 'payment_overdue' || data.reason === 'subscription_expired') { title = 'Plano precisa ser regularizado'; message = data.message || 'Regularize o plano para continuar a exibição.'; }
      else { title = 'Conta suspensa'; message = data.message || 'A conta desta TV está suspensa.'; }
    }

    state.playlistNonce++;
    try { clearCurrentObjectUrl(); } catch {}
    replaceNodeChildren($('#media-stage'));
    $('#pairing-screen').classList.add('hidden');
    $('#playback-screen').classList.add('hidden');
    $('#access-screen').classList.remove('hidden');
    $('#access-heading').textContent = title;
    $('#access-message').textContent = message;
    $('#access-expiry').textContent = expiry;
    $('#access-status').textContent = 'A TV verificará a autorização automaticamente.';
  }

  function localAccessExpired() {
    const expiresAt = state.manifest?.device?.access_expires_at;
    return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
  }

  function enforceLocalAccess() {
    if (!localAccessExpired()) return false;
    showAccessBlocked({
      error: 'device_access_expired',
      access_expires_at: state.manifest?.device?.access_expires_at || null,
    });
    return true;
  }

  function applyPairingBranding(branding = null) {
    const screen = $('#pairing-screen');
    const title = branding?.title || 'Vision Mídia Digital';
    const message = branding?.message || 'No painel Vision, abra TVs → Parear TV e informe o código acima.';
    $('#pairing-brand-title').textContent = title;
    $('#pairing-heading').textContent = branding ? 'Vincule esta TV pelo código' : 'Digite este código no painel';
    $('#pairing-instruction').textContent = message;
    if (branding?.splash_url) {
      screen.style.backgroundImage = `linear-gradient(rgba(0,0,0,.32),rgba(0,0,0,.58)),url("${branding.splash_url}")`;
    } else {
      screen.style.backgroundImage = '';
    }
  }

  function showPairing() {
    $('#pairing-screen').classList.remove('hidden');
    $('#playback-screen').classList.add('hidden');
    $('#access-screen').classList.add('hidden');
  }

  function showPlayback() {
    $('#pairing-screen').classList.add('hidden');
    $('#access-screen').classList.add('hidden');
    $('#playback-screen').classList.remove('hidden');
  }

  async function startPairing(force = false) {
    showPairing();

    if (!force && state.pairing?.request_id && new Date(state.pairing.expires_at).getTime() > Date.now()) {
      applyPairingBranding(state.pairing.branding || null);
      renderPairing(state.pairing);
      pollPairing(state.pairing);
      return;
    }

    const cooldownRemaining = Math.max(0, Number(state.pairingRateLimitedUntil || 0) - Date.now());
    if (cooldownRemaining > 0) {
      const seconds = Math.ceil(cooldownRemaining / 1000);
      const min = Math.floor(seconds / 60);
      const sec = String(seconds % 60).padStart(2, '0');
      $('#pairing-code').textContent = 'AGUARDE';
      $('#pairing-status').textContent = `Limite temporário de pareamento. Tente novamente em ${min}:${sec}.`;
      const button = $('#new-code-button');
      button.classList.remove('hidden');
      button.disabled = true;
      return;
    }

    if (state.pairingStartInFlight) return;
    state.pairingStartInFlight = true;
    clearTimeout(state.pairingRetryTimer);
    state.pairingRetryTimer = null;

    const button = $('#new-code-button');
    button.classList.add('hidden');
    button.disabled = true;
    button.textContent = 'Gerar novo código';
    $('#pairing-status').textContent = 'Gerando código seguro…';

    try {
      const pairing = await functionRequest('device-bootstrap', { action: 'start', platform: detectPlatform(), setup_code: localStorage.getItem(SETUP_CODE_KEY) || null });
      state.pairingRateLimitedUntil = 0;
      state.pairing = pairing;
      writeJson(PAIRING_KEY, pairing);
      applyPairingBranding(pairing.branding || null);
      renderPairing(pairing);
      pollPairing(pairing);
    } catch (error) {
      const networkFailure = Number(error?.status || 0) === 0;
      const rateLimited = Number(error?.status || 0) === 429;

      if (rateLimited) {
        const retryAfterSeconds = Math.max(1, Number(error?.data?.retry_after_seconds || 600));
        state.pairingRateLimitedUntil = Date.now() + (retryAfterSeconds * 1000);
        $('#pairing-code').textContent = 'AGUARDE';
        button.classList.remove('hidden');
        button.disabled = true;

        const tickRateLimit = () => {
          const remaining = Math.max(0, state.pairingRateLimitedUntil - Date.now());
          if (remaining <= 0) {
            button.disabled = false;
            button.textContent = 'Gerar novo código';
            $('#pairing-status').textContent = 'Limite liberado. Gere um novo código.';
            return;
          }
          const totalSeconds = Math.ceil(remaining / 1000);
          const min = Math.floor(totalSeconds / 60);
          const sec = String(totalSeconds % 60).padStart(2, '0');
          button.textContent = `Aguarde ${min}:${sec}`;
          $('#pairing-status').textContent = `Muitas solicitações de pareamento. Nova tentativa disponível em ${min}:${sec}.`;
          state.pairingRetryTimer = setTimeout(tickRateLimit, 1000);
        };
        tickRateLimit();
        return;
      }

      $('#pairing-code').textContent = networkFailure ? 'SEM REDE' : 'ERRO';
      const retryDelay = networkFailure ? 15000 : 30000;
      $('#pairing-status').textContent = networkFailure
        ? `${error.message || 'Sem conexão com o servidor.'} Verifique Wi-Fi/cabo e Data e hora automáticas. Nova tentativa em 15 segundos…`
        : `${error.message} • nova tentativa em 30 segundos…`;
      button.classList.remove('hidden');
      button.disabled = false;
      state.pairingRetryTimer = setTimeout(() => {
        if (!state.deviceToken && !state.pairing?.request_id) startPairing(true);
      }, retryDelay);
    } finally {
      state.pairingStartInFlight = false;
    }
  }

  function renderPairing(pairing) {
    $('#pairing-code').textContent = pairing.pairing_code || '------';
    $('#pairing-status').textContent = 'Aguardando autorização no painel…';
    const tick = () => {
      if (state.pairing?.request_id !== pairing.request_id) return;
      const remaining = Math.max(0, new Date(pairing.expires_at).getTime() - Date.now());
      const totalSeconds = Math.ceil(remaining / 1000);
      const min = Math.floor(totalSeconds / 60);
      const sec = String(totalSeconds % 60).padStart(2, '0');
      $('#pairing-countdown').textContent = `Código válido por ${min}:${sec}`;
      if (remaining <= 0) {
        $('#pairing-status').textContent = 'Código expirado.';
        $('#new-code-button').classList.remove('hidden');
        return;
      }
      setTimeout(tick, 1000);
    };
    tick();
  }

  async function pollPairing(pairing) {
    while (!state.deviceToken && state.pairing?.request_id === pairing.request_id) {
      if (new Date(pairing.expires_at).getTime() <= Date.now()) return;
      try {
        const result = await functionRequest('device-bootstrap', {
          action: 'poll',
          request_id: pairing.request_id,
          request_secret: pairing.request_secret,
        });
        if (result.status === 'claimed') $('#pairing-status').textContent = 'Autorizado. Finalizando vínculo…';
        if (result.status === 'issued' && result.device_token) {
          state.deviceToken = result.device_token;
          localStorage.setItem(DEVICE_TOKEN_KEY, result.device_token);
          try { window.VisionAndroid?.storeDeviceToken?.(result.device_token); } catch {}
          state.pairing = null;
          writeJson(PAIRING_KEY, null);
          await startPlayer();
          return;
        }
      } catch (error) {
        if ([404, 410].includes(error.status)) {
          $('#pairing-status').textContent = 'Código expirado. Gere um novo código.';
          $('#new-code-button').classList.remove('hidden');
          return;
        }
        $('#pairing-status').textContent = navigator.onLine ? 'Reconectando ao servidor…' : 'Sem internet. Aguardando conexão…';
      }
      await sleep(3000);
    }
  }

  async function gateway(body) {
    try {
      return await functionRequest('device-gateway', body, state.deviceToken);
    } catch (error) {
      if (error.status === 403 && isAccessError(error)) {
        showAccessBlocked(error);
      } else if (error.status === 401) {
        resetPairing(false);
        startPairing(true);
      }
      throw error;
    }
  }


  async function monitorGateway(body) {
    try {
      return await functionRequest('device-monitoring', body, state.deviceToken);
    } catch (error) {
      if (error.status === 403 && isAccessError(error)) {
        showAccessBlocked(error);
      } else if (error.status === 401) {
        resetPairing(false);
        startPairing(true);
      }
      throw error;
    }
  }

  async function heartbeat() {
    if (!state.deviceToken) return;
    let storageFreeMb = null;
    try {
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        if (estimate.quota != null && estimate.usage != null) storageFreeMb = Math.max(0, (estimate.quota - estimate.usage) / (1024 * 1024));
      }
    } catch { /* telemetry is optional */ }

    await monitorGateway({
      action: 'heartbeat',
      app_version: APP_VERSION,
      player_version: APP_VERSION,
      apk_version: nativeAppVersion(),
      screen_width: screen.width || innerWidth,
      screen_height: screen.height || innerHeight,
      orientation: screen.orientation?.type || (innerWidth >= innerHeight ? 'landscape' : 'portrait'),
      storage_free_mb: storageFreeMb,
      last_sync_at: state.lastSyncAt,
      current_campaign_id: state.manifest?.program?.campaign_id || null,
      current_playlist_id: state.manifest?.playlist?.id || null,
      current_media_id: state.currentMediaId,
      cache_items: state.cacheItems,
      cache_bytes: state.cacheBytes,
      playback_queue_size: playbackQueue().length,
      event_queue_size: deviceEventQueue().length,
      details: { standalone: matchMedia('(display-mode: standalone)').matches, language: navigator.language, player_version: APP_VERSION, apk_version: nativeAppVersion() },
    });
  }

  function cacheKey(item) {
    const checksum = encodeURIComponent(String(item.media.checksum || 'v1'));
    return new Request(`${location.origin}/__vision_media_cache__/${encodeURIComponent(item.media.id)}/${checksum}`);
  }


  function applyCssOrientationFallback(mode) {
    const normalized = ['portrait','landscape'].includes(mode) ? mode : 'auto';
    const landscapeViewport = innerWidth >= innerHeight;
    document.body.classList.toggle('force-player-portrait', normalized === 'portrait' && landscapeViewport);
    document.body.classList.toggle('force-player-landscape', normalized === 'landscape' && !landscapeViewport);
  }

  async function applyPlayerOrientation(mode = 'auto') {
    const normalized = ['portrait','landscape'].includes(mode) ? mode : 'auto';
    document.documentElement.dataset.playerOrientation = normalized;

    let nativeHandled = false;
    try {
      if (window.VisionAndroid?.setOrientation) {
        const result = window.VisionAndroid.setOrientation(normalized);
        // New TV builds explicitly return false when Android must keep the
        // HDMI/WebView viewport in its physical orientation and CSS must rotate
        // the virtual Player stage. Older builds return undefined and keep the
        // previous native-orientation behavior.
        nativeHandled = result !== false;
      }
    } catch {}

    // Some Android TV / TV Box firmwares expose the native bridge but ignore
    // requested portrait orientation. Do not assume the native request changed
    // the actual viewport: keep the CSS fallback synchronized with reality.
    if (!nativeHandled) {
      try {
        if (screen.orientation?.lock && document.fullscreenElement && normalized !== 'auto') {
          await screen.orientation.lock(normalized === 'portrait' ? 'portrait-primary' : 'landscape-primary');
        } else if (screen.orientation?.unlock && normalized === 'auto') {
          screen.orientation.unlock();
        }
      } catch {}
    }

    const syncFallback = () => applyCssOrientationFallback(normalized);
    syncFallback();
    setTimeout(syncFallback, 250);
    setTimeout(syncFallback, 900);
    setTimeout(syncFallback, 1800);
  }

  function notifyNativePlayerAlive() {
    try { window.VisionAndroid?.playerAlive?.(); } catch {}
  }

  function nativeAppVersion() {
    try { return String(window.VisionAndroid?.getAppVersion?.() || '').slice(0, 80) || null; }
    catch { return null; }
  }

  function consumeNativeWatchdogRecovery() {
    try { return String(window.VisionAndroid?.consumeWatchdogRecovery?.() || '') || null; }
    catch { return null; }
  }

  async function clearPlayerCache() {
    state.cachePrefetchVersion = null;
    await caches.delete(MEDIA_CACHE).catch(() => false);
    state.cacheItems = 0;
    state.cacheBytes = 0;
  }

  function restartPlayerRuntime() {
    try {
      if (window.VisionAndroid?.restartApp) {
        window.VisionAndroid.restartApp();
        return;
      }
    } catch {}
    location.reload();
  }

  async function applyDeviceSettings(settings = {}, orientation = 'auto') {
    state.audioEnabled = settings.audio_enabled !== false;
    await applyPlayerOrientation(orientation);
    const currentVideo = $('#media-stage video');
    if (currentVideo) currentVideo.muted = !state.audioEnabled;
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

  async function cacheMediaItem(cache, item, { foreground = false } = {}) {
    if (!item?.media || !['image','video'].includes(item.media.type)) return false;
    const key = cacheKey(item);
    let cached = await cache.match(key);
    if (cached) return true;
    try {
      if (foreground) setStatus(`Preparando ${item.media.name}…`);
      const response = await fetch(item.media.url, { cache:'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      await cache.put(key, new Response(blob, {
        headers: {
          'Content-Type': item.media.mime_type || blob.type || 'application/octet-stream',
          'Content-Length': String(blob.size),
        },
      }));
      return true;
    } catch (error) {
      console.warn('Falha ao armazenar mídia', item.media.id, error);
      queueDeviceEvent('cache_error', 'warning', `Falha ao armazenar ${item.media.name || 'mídia'} no cache.`, {
        media_id: item.media.id,
        media_name: item.media.name || null,
        error: String(error?.message || error).slice(0, 300),
      }, 10 * 60_000);
      return false;
    }
  }

  async function cacheWithConcurrency(cache, items, concurrency = 2, foreground = false, version = null) {
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
      while (cursor < items.length) {
        if (version && state.cachePrefetchVersion !== version) return;
        const index = cursor++;
        await cacheMediaItem(cache, items[index], { foreground });
      }
    });
    await Promise.all(workers);
  }

  async function refreshCacheStats(cache, items) {
    const countedMedia = new Set();
    let cacheItems = 0;
    let cacheBytes = 0;
    for (const item of items) {
      if (!item?.media || countedMedia.has(item.media.id)) continue;
      if (await cache.match(cacheKey(item))) {
        countedMedia.add(item.media.id);
        cacheItems += 1;
        cacheBytes += Math.max(0, Number(item.media.size_bytes || 0));
      }
    }
    state.cacheItems = cacheItems;
    state.cacheBytes = cacheBytes;
  }

  async function cacheManifestAssets(manifest) {
    const cache = await caches.open(MEDIA_CACHE);
    const seen = new Set();
    const candidates = [...(manifest.items || []), ...(manifest.fallback?.items || [])].filter(item => {
      if (!item?.media || !['image','video'].includes(item.media.type) || seen.has(item.media.id)) return false;
      seen.add(item.media.id);
      return true;
    });
    const keep = new Set(candidates.map(item => cacheKey(item).url));

    const keys = await cache.keys();
    await Promise.all(keys
      .filter(key => key.url.includes('/__vision_media_cache__/') && !keep.has(key.url))
      .map(key => cache.delete(key)));

    const warmCount = Math.min(8, candidates.length);
    const warm = candidates.slice(0, warmCount);
    await cacheWithConcurrency(cache, warm, 2, true);
    await refreshCacheStats(cache, candidates);

    const rest = candidates.slice(warmCount);
    if (!rest.length) {
      state.cachePrefetchVersion = manifest.version || null;
      return;
    }

    const version = manifest.version || clientId();
    if (state.cachePrefetchVersion === version) return;
    state.cachePrefetchVersion = version;

    void (async () => {
      await cacheWithConcurrency(cache, rest, 2, false, version);
      if (state.cachePrefetchVersion === version) await refreshCacheStats(cache, candidates);
    })().catch(error => console.warn('Prefetch de mídia falhou', error));
  }

  async function syncManifest() {
    if (!state.deviceToken) return;
    try {
      const manifest = await gateway({ action: 'manifest', supports_item_schedules: true });
      const changed = !state.manifest || state.manifest.version !== manifest.version;
      await applyDeviceSettings(manifest?.device?.settings || {}, manifest?.device?.orientation || 'auto');
      await cacheManifestAssets(manifest);
      state.manifest = manifest;
      state.lastSyncAt = new Date().toISOString();
      writeJson(MANIFEST_KEY, manifest);
      showPlayback();
      if (state.syncHadError) {
        queueDeviceEvent('sync_recovered', 'info', 'Sincronização com o servidor restabelecida.', {}, 60_000);
        state.syncHadError = false;
      }
      const programLabel = manifest?.program?.source === 'campaign' && manifest.program.campaign_name
        ? `Campanha: ${manifest.program.campaign_name}`
        : 'Programação padrão';
      setStatus(navigator.onLine ? `Online • ${programLabel}` : `Offline • ${programLabel}`);
      if (changed) { state.runtimeFallbackVersion = null; state.playlistNonce++; }
      ensurePlaybackLoop();
    } catch (error) {
      if (isAccessError(error)) throw error;
      if (navigator.onLine) {
        state.syncHadError = true;
        queueDeviceEvent('sync_error', 'warning', 'Falha ao sincronizar a programação com o servidor.', {
          error: String(error?.message || error).slice(0, 300),
        }, 5 * 60_000);
      }
      if (state.manifest) {
        setStatus('Offline • usando conteúdo salvo');
        ensurePlaybackLoop();
      } else {
        setStatus('Sem conexão e sem conteúdo salvo');
        showIdle('Sem conteúdo disponível', 'Conecte a internet para receber a primeira playlist.');
      }
      throw error;
    }
  }

  function showIdle(title, message) {
    clearCurrentObjectUrl();
    replaceNodeChildren($('#media-stage'));
    $('#idle-title').textContent = title;
    $('#idle-message').textContent = message;
    $('#idle-overlay').classList.remove('hidden');
  }

  function hideIdle() {
    $('#idle-overlay').classList.add('hidden');
  }

  async function getCachedBlob(item) {
    const cache = await caches.open(MEDIA_CACHE);
    let response = await cache.match(cacheKey(item));
    if (!response && navigator.onLine) {
      await cacheMediaItem(cache, item, { foreground:true });
      response = await cache.match(cacheKey(item));
    }
    if (!response) return null;
    return response.blob();
  }

  function clearCurrentObjectUrl() {
    if (state.currentObjectUrl) URL.revokeObjectURL(state.currentObjectUrl);
    state.currentObjectUrl = null;
  }

  function swapStageElement(stage, element, objectUrl = null) {
    const previousUrl = state.currentObjectUrl;
    replaceNodeChildren(stage, element);
    state.currentObjectUrl = objectUrl;
    if (previousUrl && previousUrl !== objectUrl) URL.revokeObjectURL(previousUrl);
  }

  async function playItem(item, playlist, program, nonce) {
    const startedAt = new Date();
    let completed = false;
    state.currentMediaId = item.media?.id || null;
    hideIdle();
    const stage = $('#media-stage');

    try {
      if (item.media.type === 'image') {
        const blob = await getCachedBlob(item);
        if (!blob) throw new Error('Imagem ainda não está disponível localmente.');
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.alt = item.media.name || '';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.objectPosition = 'center';

        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Tempo excedido ao preparar a imagem.')), 8000);
            img.onload = () => { clearTimeout(timeout); resolve(); };
            img.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível abrir a imagem.')); };
            img.src = url;
          });
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }

        if (nonce !== state.playlistNonce) {
          URL.revokeObjectURL(url);
          return;
        }
        swapStageElement(stage, img, url);
        const imageWait = await waitForChangeOrTimeout(nonce, Math.max(1, Number(item.duration_seconds || 10)) * 1000);
        completed = imageWait !== 'changed';
      } else if (item.media.type === 'video') {
        const blob = await getCachedBlob(item);
        if (!blob) throw new Error('Vídeo ainda não está disponível localmente.');
        const url = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.muted = !state.audioEnabled;
        video.src = url;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.style.objectPosition = 'center';

        await Promise.race([
          new Promise(resolve => {
            video.addEventListener('loadeddata', resolve, { once:true });
            video.addEventListener('error', resolve, { once:true });
            try { video.load(); } catch {}
          }),
          sleep(5000),
        ]);

        if (nonce !== state.playlistNonce) {
          URL.revokeObjectURL(url);
          return;
        }
        swapStageElement(stage, video, url);

        let playbackStarted = false;
        try {
          await video.play();
          playbackStarted = true;
        } catch {
          video.muted = true;
          try {
            await video.play();
            playbackStarted = true;
          } catch {
            playbackStarted = false;
          }
        }
        if (!playbackStarted) throw new Error('O navegador bloqueou a reprodução deste vídeo.');
        const fallbackSeconds = Number(item.duration_seconds || 0);
        const videoResult = await Promise.race([
          new Promise(resolve => {
            video.addEventListener('ended', () => resolve('ended'), { once: true });
            video.addEventListener('error', () => resolve('error'), { once: true });
          }),
          waitForChangeOrTimeout(nonce, Math.max(15, fallbackSeconds ? fallbackSeconds + 15 : 4 * 60 * 60) * 1000),
        ]);
        if (videoResult === 'changed') video.pause();
        completed = videoResult === 'ended' && !video.error;
      } else if (item.media.type === 'url') {
        const iframe = document.createElement('iframe');
        iframe.src = item.media.url;
        iframe.referrerPolicy = 'no-referrer';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
        swapStageElement(stage, iframe, null);
        const urlWait = await waitForChangeOrTimeout(nonce, Math.max(5, Number(item.duration_seconds || 15)) * 1000);
        completed = urlWait !== 'changed';
      } else {
        throw new Error('Tipo de mídia não suportado.');
      }
    } catch (error) {
      console.warn('Falha na mídia', item.media?.name, error);
      state.playbackHadError = true;
      queueDeviceEvent('playback_error', 'error', `Falha ao reproduzir ${item.media?.name || 'mídia'}.`, {
        media_id: item.media?.id || null,
        media_name: item.media?.name || null,
        media_type: item.media?.type || null,
        playlist_id: playlist?.id || null,
        campaign_id: program?.campaign_id || null,
        error: String(error?.message || error).slice(0, 300),
      }, 2 * 60_000);
      await sleep(1500);
    } finally {
      const endedAt = new Date();
      if (state.deviceToken) {
        queuePlayback({
          client_event_id: clientId(),
          campaign_id: program?.campaign_id || null,
          playlist_id: playlist?.id || null,
          media_id: item.media?.id || null,
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
          duration_seconds: Math.max(0, (endedAt - startedAt) / 1000),
          completed,
        });
        flushPlaybackQueue().catch(() => {});
        if (completed && state.playbackHadError) {
          queueDeviceEvent('playback_recovered', 'info', 'Reprodução normal restabelecida após uma falha.', {
            media_id: item.media?.id || null,
            media_name: item.media?.name || null,
          }, 60_000);
          state.playbackHadError = false;
          flushDeviceEventQueue().catch(() => {});
        }
      }
      state.currentMediaId = null;
      if (nonce !== state.playlistNonce) return;
    }
    return completed;
  }

  const LOCAL_WEEKDAY_INDEX = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  function localClock(timeZone) {
    let zone = timeZone || 'America/Sao_Paulo';
    let formatter;
    try { formatter = new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',weekday:'short',hourCycle:'h23'}); }
    catch { zone='America/Sao_Paulo'; formatter = new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',weekday:'short',hourCycle:'h23'}); }
    const parts=Object.fromEntries(formatter.formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const year=Number(parts.year),month=Number(parts.month),day=Number(parts.day);
    const calendar=new Date(Date.UTC(year,month-1,day));
    const previous=new Date(calendar.getTime()-86400000);
    return {dateKey:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,previousDateKey:`${previous.getUTCFullYear()}-${String(previous.getUTCMonth()+1).padStart(2,'0')}-${String(previous.getUTCDate()).padStart(2,'0')}`,weekday:LOCAL_WEEKDAY_INDEX[parts.weekday]??calendar.getUTCDay(),previousWeekday:previous.getUTCDay(),seconds:Number(parts.hour)*3600+Number(parts.minute)*60+Number(parts.second)};
  }
  function timeSeconds(value){if(!value)return null;const [h='0',m='0',sec='0']=String(value).split(':');const n=Number(h)*3600+Number(m)*60+Number(sec);return Number.isFinite(n)?n:null}
  function itemScheduleActive(item, timeZone) {
    const schedule=item?.schedule;
    if(!schedule?.enabled)return true;
    const clock=localClock(timeZone),start=timeSeconds(schedule.start_time),end=timeSeconds(schedule.end_time);
    let dateKey=clock.dateKey,weekday=clock.weekday;
    if(start!=null&&end!=null){if(start<end){if(clock.seconds<start||clock.seconds>=end)return false}else{if(clock.seconds>=start){}else if(clock.seconds<end){dateKey=clock.previousDateKey;weekday=clock.previousWeekday}else return false}}
    if(schedule.start_date&&dateKey<schedule.start_date)return false;
    if(schedule.end_date&&dateKey>schedule.end_date)return false;
    const days=Array.isArray(schedule.weekdays)?schedule.weekdays.map(Number):[0,1,2,3,4,5,6];
    return days.includes(weekday);
  }

  function blobToBase64(blob) {
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.onerror=()=>reject(reader.error||new Error('Falha ao ler captura.'));reader.readAsDataURL(blob);});
  }

  async function captureCurrentFrame() {
    const media = $('#media-stage img, #media-stage video');
    if (!media) throw new Error('Nenhuma imagem ou vídeo está sendo exibido agora.');
    let viewW=Math.max(1,innerWidth||screen.width||1920),viewH=Math.max(1,innerHeight||screen.height||1080);
    const configuredOrientation=String(document.documentElement.dataset.playerOrientation||'auto');
    const cssRotationActive=document.body.classList.contains('force-player-portrait')||document.body.classList.contains('force-player-landscape');
    if(configuredOrientation==='landscape'&&viewH>viewW)[viewW,viewH]=[viewH,viewW];
    if(configuredOrientation==='portrait'&&viewW>viewH)[viewW,viewH]=[viewH,viewW];
    const scale=Math.min(1,1920/Math.max(viewW,viewH));
    const width=Math.max(1,Math.round(viewW*scale)),height=Math.max(1,Math.round(viewH*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas indisponível.');ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
    const sourceW=media.tagName==='VIDEO'?(media.videoWidth||0):(media.naturalWidth||0),sourceH=media.tagName==='VIDEO'?(media.videoHeight||0):(media.naturalHeight||0);
    if(!sourceW||!sourceH)throw new Error('A mídia ainda não está pronta para captura.');

    if(cssRotationActive){
      const rotatedW=sourceH,rotatedH=sourceW;
      const contain=Math.min(width/rotatedW,height/rotatedH);
      const drawW=sourceW*contain,drawH=sourceH*contain;
      ctx.save();
      ctx.translate(width/2,height/2);
      ctx.rotate(Math.PI/2);
      ctx.drawImage(media,-drawW/2,-drawH/2,drawW,drawH);
      ctx.restore();
    }else{
      const contain=Math.min(width/sourceW,height/sourceH),drawW=sourceW*contain,drawH=sourceH*contain,x=(width-drawW)/2,y=(height-drawH)/2;
      ctx.drawImage(media,x,y,drawW,drawH);
    }

    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
    if(!blob)throw new Error('Não foi possível gerar a captura.');
    return {image_base64:await blobToBase64(blob),width,height,size_bytes:blob.size};
  }

  async function pollDeviceCommands() {
    if(!state.deviceToken||!navigator.onLine)return;
    const result=await gateway({action:'commands'});
    for(const command of result?.commands||[]){
      if(state.processingCommands.has(command.id))continue;
      if(!['screenshot','restart_player','sync_now','clear_cache','reload_programming'].includes(command.command_type))continue;
      state.processingCommands.add(command.id);
      try{
        if(command.command_type==='screenshot'){
          const capture=await captureCurrentFrame();
          await gateway({action:'screenshot_result',command_id:command.id,...capture});
          continue;
        }

        if(command.command_type==='restart_player'){
          await gateway({action:'command_result',command_id:command.id,status:'completed'});
          queueDeviceEvent('player_restart_requested','info','Reinício remoto recebido do painel.',{command_id:command.id},30000);
          setTimeout(restartPlayerRuntime,250);
          continue;
        }

        if(command.command_type==='sync_now'){
          await syncManifest();
          await gateway({action:'command_result',command_id:command.id,status:'completed'});
          queueDeviceEvent('manual_sync_completed','info','Sincronização remota concluída.',{command_id:command.id},15000);
          continue;
        }

        if(command.command_type==='clear_cache'){
          await clearPlayerCache();
          state.runtimeFallbackVersion=null;
          state.playlistNonce++;
          await syncManifest();
          await gateway({action:'command_result',command_id:command.id,status:'completed'});
          queueDeviceEvent('cache_cleared','info','Cache local limpo por comando remoto.',{command_id:command.id},15000);
          continue;
        }

        if(command.command_type==='reload_programming'){
          state.runtimeFallbackVersion=null;
          state.playlistNonce++;
          await syncManifest();
          ensurePlaybackLoop();
          await gateway({action:'command_result',command_id:command.id,status:'completed'});
          queueDeviceEvent('programming_reloaded','info','Programação recarregada por comando remoto.',{command_id:command.id},15000);
        }
      }catch(error){
        if(command.command_type==='screenshot'){
          await gateway({action:'screenshot_error',command_id:command.id,error_message:String(error?.message||error).slice(0,400)}).catch(()=>{});
        }else{
          await gateway({action:'command_result',command_id:command.id,status:'failed',error_message:String(error?.message||error).slice(0,400)}).catch(()=>{});
          if(command.command_type==='clear_cache'){
            queueDeviceEvent('cache_error','error','Falha ao limpar ou reconstruir o cache local.',{command_id:command.id,error:String(error?.message||error).slice(0,300)},30000);
          }
        }
      }finally{state.processingCommands.delete(command.id)}
    }
  }

  function shuffled(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  async function playbackLoop() {
    state.running = true;
    try {
      while (state.deviceToken) {
        const manifest = state.manifest;
        const nonce = state.playlistNonce;
        const fallback = manifest?.fallback || null;
        const fallbackActive = (fallback?.items || []).filter(item => itemScheduleActive(item, manifest?.program?.timezone));
        const fallbackLocked = Boolean(
          manifest?.version &&
          state.runtimeFallbackVersion === manifest.version &&
          fallback?.playlist &&
          fallbackActive.length
        );

        let playlist = fallbackLocked ? fallback.playlist : manifest?.playlist;
        let items = fallbackLocked ? fallbackActive : (manifest?.items || []).filter(item => itemScheduleActive(item, manifest?.program?.timezone));
        let program = fallbackLocked
          ? { ...(manifest?.program || {}), source:'fallback', fallback_reason:'runtime_failure' }
          : manifest?.program;
        let usingFallback = fallbackLocked;

        if ((!playlist || !items.length) && fallback?.playlist && fallbackActive.length) {
          playlist = fallback.playlist;
          items = fallbackActive;
          usingFallback = true;
          if (manifest?.version) state.runtimeFallbackVersion = manifest.version;
          program = { ...(manifest?.program || {}), source:'fallback', fallback_reason:'no_active_primary_media' };
          queueDeviceEvent('fallback_activated','warning','Playlist de emergência ativada.',{
            primary_playlist_id:manifest?.playlist?.id||null,
            fallback_playlist_id:fallback.playlist.id,
            reason:'no_active_primary_media',
          },60000);
        }

        if (!playlist || !items.length) {
          if (manifest?.playlist) {
            replaceNodeChildren($('#media-stage'));
            showIdle('Playlist sem mídia ativa neste horário', 'A playlist está atribuída, mas nenhuma mídia está disponível agora e não há fallback utilizável.');
          } else {
            showIdle('Vision Player conectado', 'Aguardando uma playlist com mídias ser atribuída a esta TV.');
          }
          await sleep(3000);
          continue;
        }

        const queue = playlist.shuffle ? shuffled(items) : [...items];
        let completedCount = 0;

        if (playlist.repeat_mode === 'single' && queue.length) {
          if (await playItem(queue[0], playlist, program, nonce)) completedCount++;
          if (nonce !== state.playlistNonce) continue;
        } else {
          for (const item of queue) {
            if (nonce !== state.playlistNonce) break;
            if (await playItem(item, playlist, program, nonce)) completedCount++;
          }
          if (nonce !== state.playlistNonce) continue;
        }

        if (!usingFallback && completedCount === 0 && fallback?.playlist && fallbackActive.length) {
          if (manifest?.version) state.runtimeFallbackVersion = manifest.version;
          queueDeviceEvent('fallback_activated','warning','Playlist de emergência ativada após falha da programação principal.',{
            primary_playlist_id:manifest?.playlist?.id||null,
            fallback_playlist_id:fallback.playlist.id,
            reason:'primary_playback_failed',
          },60000);
          continue;
        }

        if (playlist.repeat_mode === 'none') {
          const completedVersion = manifest?.version;
          showIdle('Playlist concluída', 'Aguardando uma alteração na programação.');
          while (state.deviceToken && state.manifest?.version === completedVersion && nonce === state.playlistNonce) {
            await sleep(3000);
          }
        }
      }
    } finally {
      state.running = false;
    }
  }

  function ensurePlaybackLoop() {
    if (!state.running) playbackLoop().catch(error => console.error('playback loop', error));
  }

  async function startPlayer() {
    if (!state.deviceToken) return startPairing();
    if (!enforceLocalAccess()) showPlayback();
    setStatus('Conectando…');
    if (state.manifest && !localAccessExpired()) ensurePlaybackLoop();

    const watchdogRecovery = consumeNativeWatchdogRecovery();
    if (watchdogRecovery) {
      queueDeviceEvent('watchdog_restart','warning','Watchdog reiniciou o Vision Player após perda de resposta.',{recovered_at:watchdogRecovery,apk_version:nativeAppVersion()},15000);
    }
    queueDeviceEvent('player_started', 'info', 'Vision Player iniciado.', { app_version: APP_VERSION, player_version: APP_VERSION, apk_version: nativeAppVersion(), platform: detectPlatform() }, 60_000);
    try { await heartbeat(); await flushPlaybackQueue(); await flushDeviceEventQueue(); }
    catch { /* sync below handles visual state */ }
    try { await syncManifest(); }
    catch { /* offline fallback or access screen is handled */ }

    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.syncTimer) clearInterval(state.syncTimer);
    if (state.commandTimer) clearInterval(state.commandTimer);
    if (state.accessTimer) clearInterval(state.accessTimer);
    state.heartbeatTimer = setInterval(() => heartbeat().then(async () => { await flushPlaybackQueue(); await flushDeviceEventQueue(); }).catch(() => setStatus('Offline • verifique internet e Data/hora automáticas')), 30_000);
    state.syncTimer = setInterval(() => syncManifest().catch(() => {}), 15_000);
    state.commandTimer = setInterval(() => pollDeviceCommands().catch(() => {}), 5_000);
    state.accessTimer = setInterval(() => enforceLocalAccess(), 10_000);
    pollDeviceCommands().catch(() => {});
  }

  async function requestFullscreenAndWakeLock() {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); }
    catch { /* browser may not allow */ }
    try {
      if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* optional */ }
  }

  function resetPairing(clearManifest = true) {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.syncTimer) clearInterval(state.syncTimer);
    if (state.commandTimer) clearInterval(state.commandTimer);
    if (state.accessTimer) clearInterval(state.accessTimer);
    state.heartbeatTimer = null;
    state.syncTimer = null;
    state.commandTimer = null;
    state.accessTimer = null;
    state.processingCommands.clear();
    localStorage.removeItem(DEVICE_TOKEN_KEY);
    try { window.VisionAndroid?.clearDeviceToken?.(); } catch {}
    localStorage.removeItem(PLAYBACK_QUEUE_KEY);
    localStorage.removeItem(DEVICE_EVENT_QUEUE_KEY);
    writeJson(PAIRING_KEY, null);
    state.deviceToken = null;
    state.pairing = null;
    state.playlistNonce++;
    state.currentMediaId = null;
    state.cacheItems = 0;
    state.cacheBytes = 0;
    state.lastSyncAt = null;
    state.syncHadError = false;
    state.playbackHadError = false;
    if (clearManifest) {
      writeJson(MANIFEST_KEY, null);
      state.manifest = null;
    }
  }

  window.addEventListener('resize', () => {
    const mode = document.documentElement.dataset.playerOrientation || 'auto';
    if (!window.VisionAndroid?.setOrientation) applyCssOrientationFallback(mode);
  });

  setInterval(notifyNativePlayerAlive, 20_000);

  async function bootstrap() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
    $('#new-code-button').addEventListener('click', () => { state.pairing = null; writeJson(PAIRING_KEY, null); startPairing(true); });
    $('#access-retry-button').addEventListener('click', async () => {
      const button = $('#access-retry-button');
      button.disabled = true;
      button.textContent = 'Verificando...';
      $('#access-status').textContent = 'Consultando autorização no servidor…';
      try {
        await syncManifest();
        $('#access-status').textContent = 'Autorização liberada.';
      } catch (error) {
        if (!isAccessError(error)) $('#access-status').textContent = navigator.onLine ? 'Não foi possível consultar agora.' : 'Sem internet. Tentaremos novamente automaticamente.';
      } finally {
        button.disabled = false;
        button.textContent = 'Verificar autorização';
      }
    });
    $('#fullscreen-button').addEventListener('click', requestFullscreenAndWakeLock);
    $('#repair-button').addEventListener('click', async () => {
      if (!confirm('Parear esta tela novamente? A playlist atual será desvinculada desta TV.')) return;
      if (!navigator.onLine) {
        alert('Conecte esta TV à internet antes de parear novamente. Isso evita deixar um dispositivo antigo no painel.');
        return;
      }
      $('#repair-button').disabled = true;
      try {
        await gateway({ action: 'unpair' });
        resetPairing(true);
        await startPairing(true);
      } catch (error) {
        alert(`Não foi possível desvincular esta TV: ${error.message}`);
      } finally {
        $('#repair-button').disabled = false;
      }
    });
    const resumeSync = () => {
      if (!state.deviceToken) return;
      heartbeat().catch(() => {});
      syncManifest().catch(() => {});
      flushPlaybackQueue().catch(() => {});
      flushDeviceEventQueue().catch(() => {});
    };
    window.addEventListener('online', resumeSync);
    window.addEventListener('focus', resumeSync);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resumeSync();
    });

    if (state.deviceToken) await startPlayer();
    else await startPairing();
  }

  bootstrap().catch(error => {
    console.error(error);
    showPairing();
    $('#pairing-status').textContent = `Falha ao iniciar: ${error.message}`;
    $('#new-code-button').classList.remove('hidden');
  });
})();
