'use strict';
// ── TMDB API wrapper ──────────────────────────────────────────────────────
const TMDB_BASE   = 'https://api.themoviedb.org/3';
const IMG_BASE    = 'https://image.tmdb.org/t/p/';
const REGION      = 'GB'; // UK streaming providers — change to US, AU etc if needed

// Provider → our display colour (TMDB provider_id keys)
const PROVIDER_COLORS = {
  8:   { name:'Netflix',      dot:'#e50914', bg:'#2a0a0a', text:'#ff8080' },
  337: { name:'Disney+',      dot:'#3b82f6', bg:'#0a1226', text:'#7eb8ff' },
  384: { name:'HBO Max',      dot:'#a78bfa', bg:'#140d26', text:'#c4b5fd' },
  531: { name:'Paramount+',   dot:'#60a5fa', bg:'#081230', text:'#93c5fd' },
  119: { name:'Prime Video',  dot:'#38bdf8', bg:'#031824', text:'#7dd3fc' },
  // extras often returned
  350: { name:'Apple TV+',    dot:'#aaaaaa', bg:'#1a1a1a', text:'#cccccc' },
  283: { name:'Crunchyroll',  dot:'#f97316', bg:'#200d00', text:'#fdba74' },
};

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
  return region.flatrate || [];   // subscription streaming only
}

async function getDetails(id, mediaType) {
  return tmdbGet(`/${mediaType}/${id}`, { append_to_response: 'credits' });
}

function posterUrl(path, size = 'w342')  { return path ? IMG_BASE + size + path : null; }
function backdropUrl(path, size = 'w780') { return path ? IMG_BASE + size + path : null; }

function providerInfo(providerId) {
  return PROVIDER_COLORS[providerId] || { name: null, dot: '#888', bg: '#1a1a1a', text: '#aaa' };
}

window.TMDB = { setKey, getKey, searchMulti, getProviders, getDetails, posterUrl, backdropUrl, providerInfo, PROVIDER_COLORS };
