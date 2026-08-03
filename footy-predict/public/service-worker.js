// Deliberately minimal: this exists to make the app installable to a home
// screen and load instantly on repeat visits, NOT to work offline with
// real data. Only the static shell (HTML/CSS/JS/icons) is cached — every
// API call always goes to the network, so predictions and live scores are
// never served stale from a cache. Showing yesterday's "live" score as if
// it were current would be actively misleading, not just inconvenient.

const CACHE_NAME = "footy-predict-shell-v1";
const SHELL_FILES = [
  "/", "/index.html", "/style.css", "/app.js", "/manifest.json",
  "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — always hit the network, never cache.
  if (url.pathname.startsWith("/api/")) return;

  // Static shell files: try the network first (so updates show up
  // immediately when online), falling back to cache if offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
