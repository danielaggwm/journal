/* Journal service worker
 *
 * Goal: make the site paint fast and work on flaky mobile connections by
 * caching the "app shell" (HTML, CSS, JS, icons) and the third-party
 * libraries it depends on — WITHOUT ever caching live Firebase data.
 *
 * Bump CACHE_VERSION whenever you change cached files, so old caches are
 * cleaned up and everyone picks up the new version.
 */

const CACHE_VERSION = 'journal-v1';
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME = `${CACHE_VERSION}-runtime`;

// Same-origin core files to cache up front (relative to this worker's scope).
const APP_SHELL = [
  './',
  './index.html',
  './base.css',
  './script.js',
  './icon.svg',
];

// Cross-origin hosts whose responses are safe to cache (versioned, static
// library + font files). These never contain user data.
const CACHEABLE_HOSTS = [
  'www.gstatic.com',      // Firebase SDK JS
  'cdn.jsdelivr.net',     // FullCalendar, image-compression lib
  'fonts.googleapis.com', // font stylesheet
  'fonts.gstatic.com',    // font files
];

// Hosts that must ALWAYS hit the network — live auth, database, storage,
// analytics and the search backend. The worker leaves these untouched.
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebasestorage.googleapis.com',
  'www.googleapis.com',
  'firebaselogging.googleapis.com',
  'google-analytics.com',
  'analytics.google.com',
  'www.googletagmanager.com',
  'region1.google-analytics.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isNeverCache(url) {
  return NEVER_CACHE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))
    || url.hostname.endsWith('.run.app')            // Cloud Run search endpoint
    || url.hostname.endsWith('.firebasestorage.app');
}

function isCacheableCrossOrigin(url) {
  return CACHEABLE_HOSTS.includes(url.hostname);
}

// Serve from cache immediately, refresh in the background. Great for static
// assets — the second visit is instant, and the cache silently stays current.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached); // offline: fall back to whatever we have
  return cached || network;
}

// Try the network first (so HTML stays fresh), but if it's slow or offline,
// fall back to the cached shell so the page still paints instead of going blank.
async function networkFirstWithTimeout(request, timeoutMs = 3000) {
  const cache = await caches.open(RUNTIME);
  try {
    const network = fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('network timeout')), timeoutMs)
    );
    return await Promise.race([network, timeout]);
  } catch (err) {
    const cached = (await cache.match(request)) || (await caches.match(request));
    if (cached) return cached;
    // Last resort for a navigation with nothing cached yet.
    const shell = await caches.match('./index.html');
    if (shell) return shell;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GETs over http(s); ignore POSTs, chrome-extension://, etc.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never intercept live Firebase / analytics / backend traffic.
  if (isNeverCache(url)) return;

  const sameOrigin = url.origin === self.location.origin;

  // HTML navigations → network-first (fresh when online, cached when not).
  if (request.mode === 'navigate' ||
      (sameOrigin && request.destination === 'document')) {
    event.respondWith(networkFirstWithTimeout(request));
    return;
  }

  // Static assets (our files + allowlisted CDN libs) → stale-while-revalidate.
  if (sameOrigin || isCacheableCrossOrigin(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Anything else: leave it to the browser's default handling.
});
