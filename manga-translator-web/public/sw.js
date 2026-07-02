// ============================================
// Manga Translator PWA 2.0 Service Worker
// Cache-First strategy for offline reading
// Background sync for progress uploads
// ============================================

const CACHE_VERSION = 'manga-v3';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/offline',
  '/manifest.json',
  '/favicon.ico',
];

// Install: pre-cache essential static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch(() => {
            // Non-critical file missing — skip
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Network-first for API, Cache-first for pages, Cache-only for images
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and non-HTTP requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // API requests: Network-first (don't cache stale data)
  if (url.pathname.includes('/api/')) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // Image requests: Cache-first with network fallback
  if (request.destination === 'image' ||
      url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Page/HTML requests: Network-first, fallback to cached page or /offline
  if (request.destination === 'document' || request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, PAGE_CACHE).catch(() => {
        return caches.match('/offline').then((resp) => {
          return resp || new Response(
            '<html><body><h1>离线模式</h1><p>请连接网络后重试</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        });
      })
    );
    return;
  }

  // Static assets (JS, CSS, fonts): Cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// Background sync for offline progress uploads
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reading-progress') {
    event.waitUntil(syncReadingProgress());
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    data: { url: data.url || '/' },
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '漫画翻译系统', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

// ── Cache strategies ──

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline — return nothing, let caller handle
    throw new Error('offline');
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error('offline');
  }
}

// ── Background sync ──

async function syncReadingProgress() {
  try {
    // Read pending progress from IndexedDB
    const db = await openProgressDB();
    const tx = db.transaction('pending-progress', 'readonly');
    const store = tx.objectStore('pending-progress');
    const pending = await getAllFromStore(store);

    for (const item of pending) {
      try {
        await fetch('/api/v1/reader/progress', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
        // Remove synced item
        const deleteTx = db.transaction('pending-progress', 'readwrite');
        deleteTx.objectStore('pending-progress').delete(item.id);
        await deleteTx.done;
      } catch {
        // Keep for next sync attempt
      }
    }
  } catch {
    // IndexedDB not available — nothing to sync
  }
}

function openProgressDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('manga-offline-progress', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('pending-progress', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllFromStore(store) {
  return new Promise((resolve) => {
    const items = [];
    store.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { items.push(cursor.value); cursor.continue(); }
      else { resolve(items); }
    };
  });
}
