'use strict';
// ── TMDB API wrapper ───────────────────────────────────────────────────────
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE  = 'https://image.tmdb.org/t/p/';
const REGION    = 'GB';

// Comprehensive GB provider ID map.
// Source: /watch/providers/movie?watch_region=GB and /watch/providers/tv?watch_region=GB
// Any provider TMDB returns that isn't here will still show its logo in the modal
// and be included in the filter using its TMDB name directly.
const PROVIDERS = {
  // ── Major SVoD ────────────────────────────────────────────────────────────
  8:    { name: 'Netflix',               dot: '#e50914', bg: '#1a0000', text: '#ff8080' },
  119:  { name: 'Prime Video',           dot: '#00a8e0', bg: '#001a22', text: '#67d7f5' },
  337:  { name: 'Disney+',               dot: '#1a6fff', bg: '#000d26', text: '#7eb8ff' },
  350:  { name: 'Apple TV+',             dot: '#b0b0b0', bg: '#1a1a1a', text: '#d8d8d8' },
  531:  { name: 'Paramount+',            dot: '#1b57e4', bg: '#000d26', text: '#93c5fd' },
  // ── HBO / Max ─────────────────────────────────────────────────────────────
  384:  { name: 'Max',                   dot: '#5822b4', bg: '#0d0026', text: '#c4b5fd' },
  1899: { name: 'Max',                   dot: '#5822b4', bg: '#0d0026', text: '#c4b5fd' },
  // ── UK Free / PSB ─────────────────────────────────────────────────────────
  38:   { name: 'BBC iPlayer',           dot: '#cc0000', bg: '#1a0000', text: '#ff8080' },
  39:   { name: 'BBC iPlayer',           dot: '#cc0000', bg: '#1a0000', text: '#ff8080' },
  103:  { name: 'Channel 4',             dot: '#6600cc', bg: '#0d0022', text: '#cc88ff' },
  135:  { name: 'ITVX',                  dot: '#00a650', bg: '#001a0d', text: '#6ee7b7' },
  // ── UK Paid / Niche ───────────────────────────────────────────────────────
  29:   { name: 'Sky Go',                dot: '#0072c9', bg: '#001526', text: '#7eb8ff' },
  188:  { name: 'YouTube Premium',       dot: '#ff0000', bg: '#1a0000', text: '#fca5a5' },
  192:  { name: 'YouTube',               dot: '#ff0000', bg: '#1a0000', text: '#fca5a5' },
  // ── Amazon Channels ───────────────────────────────────────────────────────
  10:   { name: 'Amazon Video',          dot: '#00a8e0', bg: '#001a22', text: '#67d7f5' },
  1770: { name: 'MGM+ Amazon Channel',   dot: '#b8972a', bg: '#1a1000', text: '#fcd34d' },
  // ── Streaming / Other ─────────────────────────────────────────────────────
  2:    { name: 'Apple iTunes',          dot: '#b0b0b0', bg: '#1a1a1a', text: '#d8d8d8' },
  3:    { name: 'Google Play',           dot: '#4285f4', bg: '#001a26', text: '#93c5fd' },
  68:   { name: 'Microsoft Store',       dot: '#0078d4', bg: '#001526', text: '#7eb8ff' },
  100:  { name: 'Rakuten TV',            dot: '#bf0000', bg: '#1a0000', text: '#fca5a5' },
  130:  { name: 'Curzon Home Cinema',    dot: '#c0392b', bg: '#1a0000', text: '#fca5a5' },
  143:  { name: 'MUBI',                  dot: '#0072b1', bg: '#001526', text: '#7eb8ff' },
  190:  { name: 'BFI Player',            dot: '#e63329', bg: '#1a0000', text: '#fca5a5' },
  239:  { name: 'BFI Player+',           dot: '#e63329', bg: '#1a0000', text: '#fca5a5' },
  547:  { name: 'Crunchyroll',           dot: '#f47521', bg: '#1a0900', text: '#fdba74' },
  569:  { name: 'Discovery+',            dot: '#2175d9', bg: '#001526', text: '#93c5fd' },
  1715: { name: 'Shudder',               dot: '#cc0000', bg: '#1a0000', text: '#fca5a5' },
  283:  { name: 'Crunchyroll',           dot: '#f47521', bg: '#1a0900', text: '#fdba74' },
};

// Deduplicate providers that have multiple IDs mapping to the same service
// (e.g. Max = 384 and 1899). When building filter dropdowns we group by name.
function dedupeProviders(providers) {
  const seen = new Set();
  return providers.filter(p => {
    const info = providerInfo(p.provider_id);
    const key  = info.name || p.provider_name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  const all = [...(region.flatrate || []), ...(region.free || [])];
  return dedupeProviders(all);
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

function providerInfo(id) {
  return PROVIDERS[id] || { name: null, dot: '#666', bg: '#1a1a1a', text: '#aaa' };
}

// Returns the display name for a provider — falls back to TMDB's own name
function providerName(provider) {
  const info = providerInfo(provider.provider_id);
  return info.name || provider.provider_name;
}

window.TMDB = {
  setKey, getKey, searchMulti, getProviders, getDetails,
  getTrending, getNowPlaying, getOnAir, getPopularMovies, getPopularTV,
  posterUrl, backdropUrl, providerInfo, providerName, dedupeProviders,
  PROVIDERS,
};
