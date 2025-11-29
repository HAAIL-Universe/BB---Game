// Minimal PWA service worker for installability.
// We don't do any caching yet, just claim control.

self.addEventListener('install', () => {
  // Activate immediately after install
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all clients without reload
  event.waitUntil(clients.claim());
});

// Optional: no fetch handler yet – network goes straight to the origin.
