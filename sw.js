const CACHE = 'vision-midia-shell-v43';
// preview-refresh-v39-timed-access
// preview-refresh-v35-playlists
const SHELL = [
  './', './index.html', './styles.css', './config.js', './app.js', './payment-ui.js', './saas-shell.js', './manifest.webmanifest', './icon.svg',
  './master.html', './master.css', './master.js', './master-payment.js', './master-embed.js',
  './downloads.html', './downloads.css', './downloads.js',
  './player.html', './player.css', './player.js', './player.webmanifest'
];

const CODE_EXTENSIONS = /\.(?:html?|js|css|json|webmanifest)$/i;

async function cacheResponse(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return response;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  } catch {}
  return response;
}

async function exactCacheFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return new Response('Conteúdo indisponível offline.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function navigationFallback(request, url) {
  const cachedExact = await caches.match(request);
  if (cachedExact) return cachedExact;
  const path = url.pathname.toLowerCase();
  if (path.includes('player')) return (await caches.match('./player.html')) || exactCacheFallback(request);
  if (path.includes('master')) return (await caches.match('./master.html')) || exactCacheFallback(request);
  if (path.includes('downloads')) return (await caches.match('./downloads.html')) || exactCacheFallback(request);
  return (await caches.match('./index.html')) || exactCacheFallback(request);
}

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request);
    return cacheResponse(request, response);
  } catch {
    return fallback();
  }
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith('vision-midia-shell-') && key !== CACHE)
        .map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;

  // Online feeds must not reuse a cached response from an old source/provider.
  if (url.pathname.endsWith('/api/news-feed')) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ ok: false }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, () => navigationFallback(request, url)));
    return;
  }

  const isCodeAsset =
    CODE_EXTENSIONS.test(url.pathname) ||
    ['script', 'style', 'manifest'].includes(request.destination);

  if (isCodeAsset) {
    // Never replace JavaScript/CSS/manifest responses with HTML.
    event.respondWith(networkFirst(request, () => exactCacheFallback(request)));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const refresh = fetch(request)
        .then(response => cacheResponse(request, response))
        .catch(() => null);
      return cached || refresh.then(response => response || exactCacheFallback(request));
    })
  );
});

// Resolve the same dynamically configured favicon used by the Vision PWA.
// Never force the legacy V icon.svg in notifications, even if an Edge Function
// supplies it in an older payload. Cache only the last valid custom logo URL.
const PUSH_BRAND_CACHE = 'vision-midia-push-brand-v1';
const PUSH_BRAND_KEY = '/__vision-push-brand';

function trustedPushBrandIcon(src) {
  return /^\/app-icons\/[0-9a-f-]{36}\/(?:192|512)\.png$/i.test(String(src || ''))
    ? new URL(src, self.location.origin).href
    : null;
}

async function currentPushBrandIcon() {
  try {
    const response = await fetch(new URL('/app-icon-config', self.location.origin), {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const config = await response.json();
      const icon = config?.icons?.find(entry => entry?.sizes === '192x192' && entry?.purpose === 'any') ||
        config?.icons?.find(entry => entry?.sizes === '512x512' && entry?.purpose === 'any');
      const fresh = trustedPushBrandIcon(icon?.src);
      if (fresh) {
        try {
          const cache = await caches.open(PUSH_BRAND_CACHE);
          await cache.put(PUSH_BRAND_KEY, new Response(icon.src, {
            headers: { 'Content-Type': 'text/plain' },
          }));
        } catch {}
        return fresh;
      }
    }
  } catch {}
  // A temporary outage should not revert an already configured logo to V.
  try {
    const cache = await caches.open(PUSH_BRAND_CACHE);
    const response = await cache.match(PUSH_BRAND_KEY);
    return trustedPushBrandIcon(response && await response.text());
  } catch {
    return null;
  }
}

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil((async () => {
    const brandIcon = await currentPushBrandIcon();
    return self.registration.showNotification(
      String(payload.title || 'Vision Mídia Digital'),
      {
        body: String(payload.body || ''),
        icon: brandIcon || undefined,
        // A full-color app logo is not a suitable monochrome Android badge.
        // Let Android choose its small application icon instead of the old SVG.
        image: payload.image || undefined,
        tag: payload.tag || 'vision-midia',
        renotify: Boolean(payload.renotify),
        data: { url: payload.url || './' },
      },
    );
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification?.data?.url || './', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(client => client.url === target || client.url.startsWith(self.location.origin));
      if (existing) {
        return existing.focus().then(client => {
          if ('navigate' in client && client.url !== target) return client.navigate(target);
          return client;
        });
      }
      return clients.openWindow(target);
    })
  );
});
