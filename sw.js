// sw.js - Enhanced Service Worker for Seva Platform v2.0
const CACHE_VERSION = 'seva-v2.1';
const CACHE_NAME = `seva-cache-${CACHE_VERSION}`;

// Assets to cache immediately
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/site.webmanifest'
];

// CDN assets to cache
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Cache strategies
const CACHE_STRATEGIES = {
  cacheFirst: ['css', 'js', 'woff2', 'woff', 'ttf', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
  networkFirst: ['html', 'json'],
  networkOnly: ['api']
};

// ============================================
// INSTALL EVENT
// ============================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker v' + CACHE_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching core assets');
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => {
        // Optionally cache CDN assets (don't fail if CDN is down)
        return caches.open(CACHE_NAME).then((cache) => {
          return Promise.allSettled(
            CDN_ASSETS.map(url => 
              cache.add(url).catch(err => {
                console.warn(`[SW] Failed to cache ${url}:`, err);
              })
            )
          );
        });
      })
      .then(() => {
        console.log('[SW] Installation complete');
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Installation failed:', err);
      })
  );
});

// ============================================
// ACTIVATE EVENT
// ============================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker v' + CACHE_VERSION);
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME && cacheName.startsWith('seva-cache-')) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Activation complete');
        return self.clients.claim();
      })
      .then(() => {
        // Notify all clients of update
        return self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'SW_UPDATED',
              version: CACHE_VERSION
            });
          });
        });
      })
  );
});

// ============================================
// FETCH EVENT - Smart Caching Strategy
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip chrome extensions and non-http requests
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }
  
  // Skip Supabase API calls (always network)
  if (url.hostname.includes('supabase.co')) {
    return event.respondWith(fetch(request));
  }
  
  // Determine cache strategy based on file type
  const fileExtension = url.pathname.split('.').pop().toLowerCase();
  
  if (CACHE_STRATEGIES.cacheFirst.includes(fileExtension)) {
    // Cache first strategy (for static assets)
    event.respondWith(cacheFirstStrategy(request));
  } else if (CACHE_STRATEGIES.networkFirst.includes(fileExtension)) {
    // Network first strategy (for HTML/JSON)
    event.respondWith(networkFirstStrategy(request));
  } else {
    // Default: Network with cache fallback
    event.respondWith(networkWithCacheFallback(request));
  }
});

// ============================================
// CACHING STRATEGIES
// ============================================

// Cache First - Best for static assets
async function cacheFirstStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  if (cached) {
    // Return cached version, update in background
    fetchAndCache(request, cache);
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Cache first fetch failed:', error);
    throw error;
  }
}

// Network First - Best for dynamic content
async function networkFirstStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    const response = await fetch(request, { 
      cache: 'no-cache',
      headers: { 'Cache-Control': 'no-cache' }
    });
    
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.warn('[SW] Network first failed, trying cache:', error);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

// Network with Cache Fallback - Default strategy
async function networkWithCacheFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    
    throw error;
  }
}

// Background fetch and cache update
function fetchAndCache(request, cache) {
  fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
    })
    .catch(() => {
      // Silently fail background updates
    });
}

// ============================================
// PUSH NOTIFICATION EVENT
// ============================================
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error('[SW] Failed to parse push data:', e);
    data = { title: 'Seva', body: 'New notification' };
  }
  
  const title = data.title || 'Seva - Food Donation';
  const options = {
    body: data.body || 'You have a new update',
    icon: data.icon || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect fill='%23FF6B3D' width='192' height='192' rx='48'/%3E%3Ctext x='96' y='130' font-size='100' text-anchor='middle' fill='white'%3E❤️%3C/text%3E%3C/svg%3E",
    badge: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 72'%3E%3Ccircle fill='%23FF6B3D' cx='36' cy='36' r='36'/%3E%3Ctext x='36' y='50' font-size='40' text-anchor='middle' fill='white'%3E❤️%3C/text%3E%3C/svg%3E",
    vibrate: [200, 100, 200],
    tag: data.tag || 'seva-notification',
    requireInteraction: data.requireInteraction || false,
    data: {
      url: data.url || '/',
      timestamp: Date.now(),
      ...data
    },
    actions: data.actions || [
      { action: 'open', title: '👁️ View', icon: '/icons/view.png' },
      { action: 'close', title: '✖️ Close', icon: '/icons/close.png' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => {
        console.log('[SW] Notification shown successfully');
      })
      .catch(err => {
        console.error('[SW] Failed to show notification:', err);
      })
  );
});

// ============================================
// NOTIFICATION CLICK EVENT
// ============================================
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'close') {
    return;
  }
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if app is already open
        for (let client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Open new window if not already open
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
      .catch(err => {
        console.error('[SW] Failed to handle notification click:', err);
      })
  );
});

// ============================================
// MESSAGE EVENT - Handle commands from app
// ============================================
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    event.waitUntil(
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(urls);
      })
    );
  } else if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(names => {
        return Promise.all(names.map(name => caches.delete(name)));
      })
    );
  }
});

// ============================================
// BACKGROUND SYNC EVENT
// ============================================
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-donations') {
    event.waitUntil(syncDonations());
  } else if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

async function syncDonations() {
  try {
    console.log('[SW] Syncing donations...');
    
    // Notify clients to refresh donations
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_DONATIONS' });
    });
    
    console.log('[SW] Donations synced');
  } catch (error) {
    console.error('[SW] Sync donations failed:', error);
  }
}

async function syncMessages() {
  try {
    console.log('[SW] Syncing messages...');
    
    // Notify clients to refresh messages
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_MESSAGES' });
    });
    
    console.log('[SW] Messages synced');
  } catch (error) {
    console.error('[SW] Sync messages failed:', error);
  }
}

// ============================================
// PERIODIC BACKGROUND SYNC
// ============================================
self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync:', event.tag);
  
  if (event.tag === 'update-content') {
    event.waitUntil(updateContent());
  }
});

async function updateContent() {
  try {
    console.log('[SW] Updating content in background...');
    
    // Update cache with latest content
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(
      CORE_ASSETS.map(url => fetch(url).then(response => {
        if (response.ok) {
          return cache.put(url, response);
        }
      }))
    );
    
    console.log('[SW] Content updated');
  } catch (error) {
    console.error('[SW] Update content failed:', error);
  }
}

console.log('[SW] Service Worker loaded successfully v' + CACHE_VERSION);
