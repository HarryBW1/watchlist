// Service worker — uses relative paths so it works from any subdirectory
// (e.g. GitHub Pages /watchlist/). Bump CACHE whenever files change so
// every device discards old cached assets and fetches fresh ones.
const CACHE = 'watchlist-v6';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/supabase-config.js',
  './js/tmdb.js',
  './js/youtube.js',
  './js/auth.js',
  './js/db.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always fetch these live — never serve a stale cached copy
  if (url.includes('api.themoviedb.org') ||
      url.includes('image.tmdb.org')      ||
      url.includes('youtube-nocookie.com') ||
      url.includes('img.youtube.com')      ||
      url.includes('supabase.co')          ||
      url.includes('cdn.jsdelivr.net')     ||
      url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Network-first for the app shell files — always try to get the latest
  // version, only falling back to cache if the network request fails.
  // This prevents exactly the "stale CSS/JS after an update" problem.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
