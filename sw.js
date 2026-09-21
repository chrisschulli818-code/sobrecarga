// Service worker: deixa o app abrir sem internet. NUNCA mexe em /api — os dados
// do treino continuam indo direto pro servidor (e ficando no localStorage
// quando offline, sincronizando depois).
const CACHE = 'sobrecarga-shell-v2';
const SHELL = ['/', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (pega sempre a versão nova quando online), cache como reserva.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    event.respondWith(networkFirst(req));
    return;
  }
  // Fontes e bibliotecas de CDN (pdf.js, jsPDF, Google Fonts): guarda pra usar offline.
  if (/(^|\.)(googleapis|gstatic)\.com$|(^|\.)(cdnjs\.cloudflare|jsdelivr)\.(com|net)$/.test(url.hostname)) {
    event.respondWith(networkFirst(req));
  }
});
