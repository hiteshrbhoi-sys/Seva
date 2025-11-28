// ============================================
// SEVA PWA - ENHANCED SERVICE WORKER
// Version: 2.0.0
// ============================================

const CACHE_VERSION = 'seva-v2.0.0';
const RUNTIME_CACHE = 'seva-runtime-v2.0.0';
const IMAGE_CACHE = 'seva-images-v2.0.0';

// Critical assets to cache on install
const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/maskable-192x192.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// ============================================
// INSTALL - Cache critical assets
// ============================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => {
        console.log('[SW] Caching critical assets');
        return cache.addAll(CRITICAL_ASSETS.map(url => new Request(url, {cache: 'reload'})));
      })
      .then(() => {
        console.log('[SW] Critical assets cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache critical assets:', error);
      })
  );
});

// ============================================
// ACTIVATE - Clean up old caches
// ============================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              return cacheName !== CACHE_VERSION && 
                     cacheName !== RUNTIME_CACHE &&
                     cacheName !== IMAGE_CACHE;
            })
            .map((cacheName) => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim();
      })
  );
});

// ============================================
// FETCH - Network-first with cache fallback
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.hostname.includes('supabase.co')) return;
  if (url.protocol === 'chrome-extension:') return;

  if (request.destination === 'image') {
    event.respondWith(handleImageRequest(request));
  } else if (url.pathname.includes('leaflet') || url.pathname.includes('tile.openstreetmap')) {
    event.respondWith(handleMapRequest(request));
  } else {
    event.respondWith(handleRequest(request));
  }
});

async function handleRequest(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) return cachedResponse;
    
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    
    return new Response('Network error', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function handleImageRequest(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) return cachedResponse;
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    return new Response('Image not available', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function handleMapRequest(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) return cachedResponse;
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    return new Response('', { status: 404 });
  }
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  let data = {};
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: 'Seva Notification',
        body: event.data.text()
      };
    }
  }
  
  const title = data.title || 'Seva';
  const options = {
    body: data.body || 'New notification from Seva',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: data.tag || 'seva-notification',
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
      donationId: data.donationId
    },
    actions: [
      { action: 'open', title: '👁️ View' },
      { action: 'close', title: '✖️ Close' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ============================================
// NOTIFICATION CLICK HANDLER
// ============================================
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'close') return;
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (let client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// ============================================
// BACKGROUND SYNC
// ============================================
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'sync-donations') {
    event.waitUntil(syncDonations());
  } else if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

async function syncDonations() {
  try {
    console.log('[SW] Syncing donations...');
    return Promise.resolve();
  } catch (error) {
    console.error('[SW] Donation sync failed:', error);
    throw error;
  }
}

async function syncMessages() {
  try {
    console.log('[SW] Syncing messages...');
    return Promise.resolve();
  } catch (error) {
    console.error('[SW] Message sync failed:', error);
    throw error;
  }
}

// ============================================
// MESSAGE HANDLER
// ============================================
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      })
    );
  }
});

console.log('[SW] Service worker script loaded successfully');