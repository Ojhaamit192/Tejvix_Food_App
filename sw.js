// Minimal service worker: caches the app shell so the site can be
// "installed" to a home screen and loads instantly on repeat visits.
// It does NOT cache API calls (/api/*), so menu/order/kitchen data
// always stays live.
const CACHE_NAME = "tejvix-food-shell-v1";
const SHELL_FILES = ["/index.html", "/admin.html", "/assets/logo-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // never cache live data
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
