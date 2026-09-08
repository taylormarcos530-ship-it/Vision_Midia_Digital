(() => {
  'use strict';

  const CONFIG = window.VISION_CONFIG;
  if (!CONFIG?.supabaseUrl || !CONFIG?.supabasePublishableKey) {
    document.body.innerHTML = '<main style="padding:40px;color:white">Configuração do Supabase ausente.</main>';
    return;
  }

  const APP_VERSION = 'vision-player-web-1.2.0';
  const DEVICE_TOKEN_KEY = 'vision_player_device_token_v1';
  const PAIRING_KEY = 'vision_player_pairing_v1';
  const MANIFEST_KEY = 'vision_player_manifest_v1';
  const MEDIA_CACHE = 'vision-player-media-v1';
  const PLAYBACK_QUEUE_KEY = 'vision_player_playback_queue_v1';
  const DEVICE_EVENT_QUEUE_KEY = 'vision_player_device_event_queue_v1';

  const state = {
    deviceToken: localStorage.getItem(DEVICE_TOKEN_KEY) || null,
    pairing: readJson(PAIRING_KEY),
    manifest: readJson(MANIFEST_KEY),
    running: false,
    playlistNonce: 0,
    currentObjectUrl: null,
    wakeLock: null,
    heartbeatTimer: null,
    syncTimer: null,
    lastSyncAt: readJson(MANIFEST_KEY)?.generated_at || null,
    currentMediaId: null,
    cacheItems: 0,
    cacheBytes: 0,
    syncHadError: false,
    playbackHadError: false,
    lastEventTimes: {},
  };

  const $ = (selector) => document.querySelector(selector);
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
      client_event_id: crypto.randomUUID(),
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

  async function functionRequest(name, body, deviceToken = null) {
    const headers = {
      apikey: CONFIG.supabasePublishableKey,
      'Content-Type': 'application/json',
    };
    if (deviceToken) headers['x-device-token'] = deviceToken;
    const response = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
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

  function showPairing() {
    $('#pairing-screen').classList.remove('hidden');
    $('#playback-screen').classList.add('hidden');
  }

  function showPlayback() {
    $('#pairing-screen').classList.add('hidden');
    $('#playback-screen').classList.remove('hidden');
  }

  async function startPairing(force = false) {
    showPairing();
    $('#new-code-button').classList.add('hidden');
    $('#pairing-status').textContent = 'Gerando código seguro…';

    if (!force && state.pairing?.request_id && new Date(state.pairing.expires_at).getTime() > Date.now()) {
      renderPairing(state.pairing);
      pollPairing(state.pairing);
      return;
    }

    try {
      const pairing = await functionRequest('device-bootstrap', { action: 'start', platform: detectPlatform() });
      state.pairing = pairing;
      writeJson(PAIRING_KEY, pairing);
      renderPairing(pairing);
      pollPairing(pairing);
    } catch (error) {
      $('#pairing-code').textContent = 'ERRO';
      $('#pairing-status').textContent = error.message;
      $('#new-code-button').classList.remove('hidden');
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
      if (error.status === 401) {
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
      if (error.status === 401) {
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
      details: { standalone: matchMedia('(display-mode: standalone)').matches, language: navigator.language },
    });
  }

  function cacheKey(item) {
    const checksum = encodeURIComponent(String(item.media.checksum || 'v1'));
    return new Request(`${location.origin}/__vision_media_cache__/${encodeURIComponent(item.media.id)}/${checksum}`);
  }

  async function cacheManifestAssets(manifest) {
    const cache = await caches.open(MEDIA_CACHE);
    const keep = new Set();
    const countedMedia = new Set();
    let cacheItems = 0;
    let cacheBytes = 0;
    for (const item of manifest.items || []) {
      if (!['image', 'video'].includes(item.media.type)) continue;
      const key = cacheKey(item);
      keep.add(key.url);
      let cached = await cache.match(key);
      if (!cached) {
        try {
          setStatus(`Baixando ${item.media.name}…`);
          const response = await fetch(item.media.url, { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          await cache.put(key, new Response(blob, {
            headers: {
              'Content-Type': item.media.mime_type || blob.type || 'application/octet-stream',
              'Content-Length': String(blob.size),
            },
          }));
          cached = await cache.match(key);
        } catch (error) {
          console.warn('Falha ao armazenar mídia', item.media.id, error);
          queueDeviceEvent('cache_error', 'warning', `Falha ao armazenar ${item.media.name || 'mídia'} no cache.`, {
            media_id: item.media.id,
            media_name: item.media.name || null,
            error: String(error?.message || error).slice(0, 300),
          }, 10 * 60_000);
        }
      }
      if (cached && !countedMedia.has(item.media.id)) {
        countedMedia.add(item.media.id);
        cacheItems += 1;
        cacheBytes += Math.max(0, Number(item.media.size_bytes || 0));
      }
    }
    const keys = await cache.keys();
    await Promise.all(keys.filter(key => key.url.includes('/__vision_media_cache__/') && !keep.has(key.url)).map(key => cache.delete(key)));
    state.cacheItems = cacheItems;
    state.cacheBytes = cacheBytes;
  }

  async function syncManifest() {
    if (!state.deviceToken) return;
    try {
      const manifest = await gateway({ action: 'manifest' });
      const changed = !state.manifest || state.manifest.version !== manifest.version;
      await cacheManifestAssets(manifest);
      state.manifest = manifest;
      state.lastSyncAt = new Date().toISOString();
      writeJson(MANIFEST_KEY, manifest);
      if (state.syncHadError) {
        queueDeviceEvent('sync_recovered', 'info', 'Sincronização com o servidor restabelecida.', {}, 60_000);
        state.syncHadError = false;
      }
      const programLabel = manifest?.program?.source === 'campaign' && manifest.program.campaign_name
        ? `Campanha: ${manifest.program.campaign_name}`
        : 'Programação padrão';
      setStatus(navigator.onLine ? `Online • ${programLabel}` : `Offline • ${programLabel}`);
      if (changed) {
        state.playlistNonce++;
        ensurePlaybackLoop();
      }
    } catch (error) {
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
    $('#media-stage').replaceChildren();
    $('#idle-title').textContent = title;
    $('#idle-message').textContent = message;
    $('#idle-overlay').classList.remove('hidden');
  }

  function hideIdle() {
    $('#idle-overlay').classList.add('hidden');
  }

  async function getCachedBlob(item) {
    const cache = await caches.open(MEDIA_CACHE);
    const response = await cache.match(cacheKey(item));
    if (!response) return null;
    return response.blob();
  }

  function clearCurrentObjectUrl() {
    if (state.currentObjectUrl) URL.revokeObjectURL(state.currentObjectUrl);
    state.currentObjectUrl = null;
  }

  async function playItem(item, playlist, program, nonce) {
    const startedAt = new Date();
    let completed = false;
    state.currentMediaId = item.media?.id || null;
    hideIdle();
    clearCurrentObjectUrl();
    const stage = $('#media-stage');
    stage.replaceChildren();

    try {
      if (item.media.type === 'image') {
        const blob = await getCachedBlob(item);
        if (!blob) throw new Error('Imagem ainda não está no cache local.');
        const url = URL.createObjectURL(blob);
        state.currentObjectUrl = url;
        const img = new Image();
        img.alt = item.media.name || '';
        img.src = url;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.objectPosition = 'center';
        stage.appendChild(img);
        await Promise.race([
          new Promise(resolve => { img.onload = resolve; img.onerror = resolve; }),
          sleep(5000),
        ]);
        const imageWait = await waitForChangeOrTimeout(nonce, Math.max(1, Number(item.duration_seconds || 10)) * 1000);
        completed = imageWait !== 'changed';
      } else if (item.media.type === 'video') {
        const blob = await getCachedBlob(item);
        if (!blob) throw new Error('Vídeo ainda não está no cache local.');
        const url = URL.createObjectURL(blob);
        state.currentObjectUrl = url;
        const video = document.createElement('video');
        video.src = url;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.style.objectPosition = 'center';
        stage.appendChild(video);
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
        stage.appendChild(iframe);
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
          client_event_id: crypto.randomUUID(),
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
        if (!manifest?.playlist || !manifest.items?.length) {
          showIdle('Vision Player conectado', 'Aguardando uma playlist com mídias ser atribuída a esta TV.');
          await sleep(3000);
          continue;
        }

        const queue = manifest.playlist.shuffle ? shuffled(manifest.items) : [...manifest.items];
        if (manifest.playlist.repeat_mode === 'single' && queue.length) {
          await playItem(queue[0], manifest.playlist, manifest.program, nonce);
          if (nonce !== state.playlistNonce) continue;
          continue;
        }

        for (const item of queue) {
          if (nonce !== state.playlistNonce) break;
          await playItem(item, manifest.playlist, manifest.program, nonce);
        }

        if (nonce !== state.playlistNonce) continue;
        if (manifest.playlist.repeat_mode === 'none') {
          const completedVersion = manifest.version;
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
    showPlayback();
    setStatus('Conectando…');
    if (state.manifest) ensurePlaybackLoop();

    queueDeviceEvent('player_started', 'info', 'Vision Player iniciado.', { app_version: APP_VERSION, platform: detectPlatform() }, 60_000);
    try { await heartbeat(); await flushPlaybackQueue(); await flushDeviceEventQueue(); }
    catch { /* sync below handles visual state */ }
    try { await syncManifest(); }
    catch { /* offline fallback is handled */ }

    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.syncTimer) clearInterval(state.syncTimer);
    state.heartbeatTimer = setInterval(() => heartbeat().then(async () => { await flushPlaybackQueue(); await flushDeviceEventQueue(); }).catch(() => setStatus('Offline • aguardando internet')), 30_000);
    state.syncTimer = setInterval(() => syncManifest().catch(() => {}), 15_000);
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
    state.heartbeatTimer = null;
    state.syncTimer = null;
    localStorage.removeItem(DEVICE_TOKEN_KEY);
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

  async function bootstrap() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
    $('#new-code-button').addEventListener('click', () => { state.pairing = null; writeJson(PAIRING_KEY, null); startPairing(true); });
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
    window.addEventListener('online', () => { if (state.deviceToken) { syncManifest().catch(() => {}); flushPlaybackQueue().catch(() => {}); flushDeviceEventQueue().catch(() => {}); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.deviceToken) heartbeat().catch(() => {}); });

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
