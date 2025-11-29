// ============================================
// SEVA PWA - ENHANCED SERVICE WORKER v3.0.0
// ============================================

const CACHE_VERSION = 'seva-v3.0.0';
const RUNTIME_CACHE = 'seva-runtime-v3';
const IMAGE_CACHE = 'seva-images-v3';
const MAP_CACHE = 'seva-maps-v3';

// Critical assets for offline functionality
const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/maskable-192x192.png',
  '/icons/maskable-512x512.png'
];

// External dependencies (attempt to cache, but don't fail install)
const OPTIONAL_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// ============================================
// INSTALL - Cache critical assets
// ============================================
self.addEventListener('install', (event) => {
  console.log('[SW v3] Installing...');
  
  event.waitUntil(
    Promise.all([
      // Cache critical assets (must succeed)
      caches.open(CACHE_VERSION).then((cache) => {
        console.log('[SW] Caching critical assets');
        return cache.addAll(CRITICAL_ASSETS.map(url => 
          new Request(url, {cache: 'reload'})
        ));
      }),
      
      // Cache optional assets (can fail)
      caches.open(CACHE_VERSION).then((cache) => {
        console.log('[SW] Attempting to cache optional assets');
        return Promise.allSettled(
          OPTIONAL_ASSETS.map(url => 
            cache.add(new Request(url, {cache: 'reload'}))
              .catch(err => console.warn('[SW] Failed to cache:', url, err))
          )
        );
      })
    ])
    .then(() => {
      console.log('[SW] Installation complete');
      return self.skipWaiting();
    })
    .catch((error) => {
      console.error('[SW] Installation failed:', error);
      throw error;
    })
  );
});

// ============================================
// ACTIVATE - Clean up old caches
// ============================================
self.addEventListener('activate', (event) => {
  console.log('[SW v3] Activating...');
  
  const validCaches = [CACHE_VERSION, RUNTIME_CACHE, IMAGE_CACHE, MAP_CACHE];
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => !validCaches.includes(cacheName))
            .map((cacheName) => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      }),
      
      // Take control of all clients
      self.clients.claim()
    ])
    .then(() => {
      console.log('[SW] Activation complete');
      
      // Notify all clients about the update
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
// FETCH - Smart caching strategy
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip Supabase API calls (always fresh)
  if (url.hostname.includes('supabase.co')) return;
  
  // Skip chrome extensions
  if (url.protocol === 'chrome-extension:') return;

  // Route based on request type
  if (request.destination === 'image') {
    event.respondWith(cacheFirstStrategy(request, IMAGE_CACHE));
  } else if (url.hostname.includes('openstreetmap.org')) {
    event.respondWith(cacheFirstStrategy(request, MAP_CACHE));
  } else if (url.hostname.includes('leaflet')) {
    event.respondWith(cacheFirstStrategy(request, CACHE_VERSION));
  } else {
    event.respondWith(networkFirstStrategy(request));
  }
});

// ============================================
// CACHING STRATEGIES
// ============================================

// Network-first: Try network, fallback to cache
async function networkFirstStrategy(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      // Clone before caching (response can only be read once)
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, using cache:', request.url);
    
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    
    // Return error response
    return new Response(
      JSON.stringify({ error: 'Network error', offline: true }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Cache-first: Use cache, update in background
async function cacheFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // Return cached version immediately
    // Update cache in background (don't await)
    fetch(request).then(networkResponse => {
      if (networkResponse && networkResponse.status === 200) {
        cache.put(request, networkResponse);
      }
    }).catch(() => {
      // Silently fail background update
    });
    
    return cachedResponse;
  }
  
  // No cache, fetch from network
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Return placeholder for images
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#ccc" width="200" height="200"/><text x="50%" y="50%" text-anchor="middle" fill="#666">No Image</text></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    
    return new Response('Resource not available offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);
  
  let notificationData = {
    title: 'Seva',
    body: 'New notification',
    icon: '/icons/icon-192x192.png'
  };
  
  if (event.data) {
    try {
      notificationData = event.data.json();
    } catch (e) {
      notificationData.body = event.data.text();
    }
  }
  
  const options = {
    body: notificationData.body || 'New notification from Seva',
    icon: notificationData.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: notificationData.tag || `seva-${Date.now()}`,
    requireInteraction: notificationData.requireInteraction || false,
    vibrate: [200, 100, 200],
    data: {
      url: notificationData.url || '/',
      donationId: notificationData.donationId,
      timestamp: Date.now()
    },
    actions: [
      { action: 'open', title: '👁️ View', icon: '/icons/icon-72x72.png' },
      { action: 'close', title: '✖️ Dismiss' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(notificationData.title || 'Seva', options)
  );
});

// ============================================
// NOTIFICATION CLICK
// ============================================
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action, event.notification.tag);
  
  event.notification.close();
  
  if (event.action === 'close') {
    return;
  }
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if window is already open
        for (let client of clientList) {
          if (client.url.includes(urlToOpen) && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Open new window
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
    
    // Send message to all clients to trigger sync
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_DONATIONS' });
    });
    
    return Promise.resolve();
  } catch (error) {
    console.error('[SW] Donation sync failed:', error);
    throw error;
  }
}

async function syncMessages() {
  try {
    console.log('[SW] Syncing messages...');
    
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_MESSAGES' });
    });
    
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
  
  if (!event.data) return;
  
  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys().then((cacheNames) => {
          return Promise.all(
            cacheNames.map((cacheName) => {
              console.log('[SW] Clearing cache:', cacheName);
              return caches.delete(cacheName);
            })
          );
        }).then(() => {
          event.ports[0]?.postMessage({ success: true });
        })
      );
      break;
      
    case 'GET_VERSION':
      event.ports[0]?.postMessage({ version: CACHE_VERSION });
      break;
  }
});

console.log('[SW v3] Service worker loaded successfully');
