'use strict';
// ── TMDB API wrapper ───────────────────────────────────────────────────────
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE  = 'https://image.tmdb.org/t/p/';
const REGION    = 'GB';

// Verified TMDB provider IDs for GB region
// Check: /watch/providers/movie?watch_region=GB and /watch/providers/tv?watch_region=GB
const PROVIDERS = {
  8:    { name: 'Netflix',                 dot: '#e50914', bg: '#2a0a0a', text: '#ff8080' },
  119:  { name: 'Amazon Prime Video',      dot: '#00a8e0', bg: '#00111a', text: '#67d7f5' },
  350:  { name: 'Apple TV',                dot: '#a0a0a0', bg: '#1a1a1a', text: '#d0d0d0' },
  337:  { name: 'Disney Plus',             dot: '#1a6fff', bg: '#020d26', text: '#7eb8ff' },
  531:  { name: 'Paramount Plus',          dot: '#1b57e4', bg: '#020d26', text: '#93c5fd' },
  1899: { name: 'HBO Max Amazon Channel',  dot: '#5822b4', bg: '#140d26', text: '#c4b5fd' },
  384:  { name: 'HBO Max Amazon Channel',  dot: '#5822b4', bg: '#140d26', text: '#c4b5fd' },
  103:  { name: 'Channel 4',              dot: '#6600cc', bg: '#110022', text: '#cc88ff' },
  38:   { name: 'BBC iPlayer',             dot: '#cc0000', bg: '#1a0000', text: '#ff6666' },
  39:   { name: 'BBC iPlayer',             dot: '#cc0000', bg: '#1a0000', text: '#ff6666' },
};

// Ordered list for filter dropdowns — name must match exactly what TMDB returns for GB
const PROVIDER_LIST = [
  { id: 8,    name: 'Netflix' },
  { id: 119,  name: 'Amazon Prime Video' },
  { id: 350,  name: 'Apple TV' },
  { id: 337,  name: 'Disney Plus' },
  { id: 531,  name: 'Paramount Plus' },
  { id: 1899, name: 'HBO Max Amazon Channel' },
  { id: 103,  name: 'Channel 4' },
  { id: 38,   name: 'BBC iPlayer' },
];

let _apiKey = '';
function setKey(k) { _apiKey = k.trim(); }
function getKey()  { return _apiKey; }

async function tmdbGet(path, params = {}) {
  if (!_apiKey) throw new Error('NO_KEY');
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set('api_key', _apiKey);
  url.searchParams.set('language', 'en-GB');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(res.status === 401 ? 'BAD_KEY' : 'API_ERR_' + res.status);
  return res.json();
}

async function searchMulti(query, page = 1) {
  const data = await tmdbGet('/search/multi', { query, page, include_adult: false });
  return (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
}

async function getProviders(id, mediaType) {
  const data = await tmdbGet(`/${mediaType}/${id}/watch/providers`);
  const region = (data.results || {})[REGION] || {};
  return [...(region.flatrate || []), ...(region.free || [])];
}

async function getDetails(id, mediaType) {
  return tmdbGet(`/${mediaType}/${id}`, { append_to_response: 'credits' });
}

async function getTrending(mediaType = 'all', timeWindow = 'week') {
  const data = await tmdbGet(`/trending/${mediaType}/${timeWindow}`);
  return (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
}

async function getNowPlaying() {
  const data = await tmdbGet('/movie/now_playing', { region: REGION });
  return (data.results || []).map(r => ({ ...r, media_type: 'movie' }));
}

async function getOnAir() {
  const data = await tmdbGet('/tv/on_the_air');
  return (data.results || []).map(r => ({ ...r, media_type: 'tv' }));
}

async function getPopularMovies() {
  const data = await tmdbGet('/movie/popular', { region: REGION });
  return (data.results || []).map(r => ({ ...r, media_type: 'movie' }));
}

async function getPopularTV() {
  const data = await tmdbGet('/tv/popular');
  return (data.results || []).map(r => ({ ...r, media_type: 'tv' }));
}

function posterUrl(path, size = 'w342')   { return path ? IMG_BASE + size + path : null; }
function backdropUrl(path, size = 'w780') { return path ? IMG_BASE + size + path : null; }
function providerInfo(id) { return PROVIDERS[id] || { name: null, dot: '#888', bg: '#1a1a1a', text: '#aaa' }; }

window.TMDB = {
  setKey, getKey, searchMulti, getProviders, getDetails,
  getTrending, getNowPlaying, getOnAir, getPopularMovies, getPopularTV,
  posterUrl, backdropUrl, providerInfo, PROVIDERS, PROVIDER_LIST,
};
