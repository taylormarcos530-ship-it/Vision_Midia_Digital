const CACHE = 'vision-midia-shell-v29';
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

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list[0]) return list[0].focus();
      return clients.openWindow('./');
    })
  );
});
