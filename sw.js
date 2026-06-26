const CACHE = 'watchlist-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/supabase-config.js',
  '/js/tmdb.js',
  '/js/youtube.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Always live: TMDB API, TMDB images, YouTube oEmbed, YouTube thumbnails, Supabase
  const url = e.request.url;
  if (url.includes('api.themoviedb.org') ||
      url.includes('image.tmdb.org') ||
      url.includes('youtube-nocookie.com') ||
      url.includes('img.youtube.com') ||
      url.includes('supabase.co')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
