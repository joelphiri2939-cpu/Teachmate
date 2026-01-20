/* =========================================================
   TeachMate PWA – Production Service Worker
   Purpose:
   - App shell caching (FAST load)
   - Safe updates (NO stale JS/HTML bugs)
   - Offline fallback
   - Background sync trigger
   - Zero interference with IndexedDB, Firebase, photos
   ========================================================= */

const SW_VERSION = 'teachmate-sw-v3.0.0';

const APP_SHELL_CACHE = 'teachmate-shell-v3';
const RUNTIME_CACHE = 'teachmate-runtime-v3';

const APP_SHELL = [
  '/', // index.html
  '/manifest.json',
  '/offline.html'
];

/* =========================================================
   INSTALL
   ========================================================= */
self.addEventListener('install', event => {
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(cache => {
      return cache.addAll(APP_SHELL);
    })
  );
});

/* =========================================================
   ACTIVATE
   ========================================================= */
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      // Clean old caches
      caches.keys().then(keys =>
        Promise.all(
          keys.map(key => {
            if (![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key)) {
              return caches.delete(key);
            }
          })
        )
      ),
      self.clients.claim()
    ])
  );
});

/* =========================================================
   FETCH STRATEGY
   ========================================================= */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  
  // Ignore non-GET
  if (req.method !== 'GET') return;
  
  // Ignore Firebase, auth, storage, APIs
  if (
    url.origin.includes('googleapis') ||
    url.origin.includes('firebase') ||
    url.origin.includes('gstatic')
  ) {
    return;
  }
  
  // App shell → network first (prevents stale JS bugs)
  if (APP_SHELL.includes(url.pathname) || url.pathname === '/') {
    event.respondWith(networkFirst(req));
    return;
  }
  
  // Images, PDFs, fonts → cache first
  if (
    req.destination === 'image' ||
    req.destination === 'font' ||
    req.destination === 'style'
  ) {
    event.respondWith(cacheFirst(req));
    return;
  }
  
  // Default → network with cache fallback
  event.respondWith(networkWithFallback(req));
});

/* =========================================================
   FETCH HELPERS
   ========================================================= */

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(APP_SHELL_CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match(req);
    return cached || caches.match('/offline.html');
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  
  const fresh = await fetch(req);
  const cache = await caches.open(RUNTIME_CACHE);
  cache.put(req, fresh.clone());
  return fresh;
}

async function networkWithFallback(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return caches.match(req) || caches.match('/offline.html');
  }
}

/* =========================================================
   BACKGROUND SYNC (TRIGGER ONLY)
   ========================================================= */
self.addEventListener('sync', event => {
  if (event.tag === 'teachmate-sync') {
    event.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ action: 'SYNC_NOW' });
  }
}

/* =========================================================
   MESSAGE HANDLER
   ========================================================= */
self.addEventListener('message', event => {
  if (event.data?.action === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* =========================================================
   OFFLINE SAFETY NET
   ========================================================= */
self.addEventListener('error', event => {
  console.error('[SW Error]', event.error);
});

console.log(`✔ TeachMate Service Worker Loaded (${SW_VERSION})`);
