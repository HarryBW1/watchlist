// Service worker — uses relative paths so it works on any subdirectory (e.g. GitHub Pages /watchlist/)
const CACHE = 'watchlist-v6';

// Use relative paths — resolved relative to the SW's own location
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/supabase-config.js',
  './js/tmdb.js',
  './js/youtube.js',
  './js/auth.js',
  './js/db.js',
  './js/viewport.js',
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
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always fetch live — never cache these
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

  // Cache-first for app shell files
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
