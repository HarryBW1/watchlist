'use strict';

// ── State ─────────────────────────────────────────────────────────────────
let watchlist  = [];
let ytLinks    = [];
let activeTab  = 'search';
let searchDebounce = null;
let currentModal   = null;   // item shown in modal

const STATUS_CONFIG = {
  'Want to watch': { cls: 's-want',     icon: 'ti-bookmark' },
  'Watching':      { cls: 's-watching', icon: 'ti-player-play' },
  'Finished':      { cls: 's-finished', icon: 'ti-circle-check' },
  'Dropped':       { cls: 's-dropped',  icon: 'ti-circle-x' },
};

// ── Storage ───────────────────────────────────────────────────────────────
function load() {
  try { watchlist = JSON.parse(localStorage.getItem('wl_items') || '[]'); } catch { watchlist = []; }
  try { ytLinks   = JSON.parse(localStorage.getItem('wl_yt')    || '[]'); } catch { ytLinks = []; }
  const key = localStorage.getItem('tmdb_key') || '';
  if (key) { TMDB.setKey(key); showApp(); }
}

function save() {
  localStorage.setItem('wl_items', JSON.stringify(watchlist));
  localStorage.setItem('wl_yt',    JSON.stringify(ytLinks));
  updateBadge();
}

function saveKey(k) {
  localStorage.setItem('tmdb_key', k);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2500);
}

function updateBadge() {
  const total = watchlist.length + ytLinks.length;
  document.querySelectorAll('.mob-badge, .dt-badge').forEach(el => {
    el.textContent = total || '';
    el.style.display = total ? 'inline-flex' : 'none';
  });
}

function statusBadge(status) {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG['Want to watch'];
  return `<span class="status-badge ${s.cls}"><i class="ti ${s.icon}"></i>${esc(status)}</span>`;
}

function isInWL(tmdbId) { return watchlist.some(w => w.tmdbId === tmdbId); }

// ── API key flow ──────────────────────────────────────────────────────────
function showApp() {
  document.getElementById('tmdb-key-banner').classList.add('hidden');
  document.getElementById('search-controls').style.display = 'flex';
  document.getElementById('search-hint').style.display = 'flex';
}

async function submitTmdbKey(inputId) {
  const inp = document.getElementById(inputId);
  const key = inp.value.trim();
  const btn = document.getElementById(inputId === 'api-key-input' ? 'key-submit-btn' : 'settings-key-btn');
  const defaultHtml = inputId === 'api-key-input'
    ? '<i class="ti ti-check"></i> Save key'
    : '<i class="ti ti-device-floppy"></i> Update key';
  if (!key) return;
  btn.disabled = true;
  btn.innerHTML = 'Checking…';
  TMDB.setKey(key);
  try {
    await TMDB.searchMulti('test');
    saveKey(key);
    if (inputId === 'api-key-input') showApp();
    toast('API key saved ✓', 'success');
  } catch (e) {
    TMDB.setKey('');
    toast(e.message === 'BAD_KEY' ? 'Invalid API key — check and try again' : 'Connection error', 'warn');
  } finally {
    btn.disabled = false;
    btn.innerHTML = defaultHtml;
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.nav-btn, .desktop-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'watchlist') renderWatchlist();
  if (tab === 'youtube')   renderYT();
  window.scrollTo(0, 0);
}

// ── Search ────────────────────────────────────────────────────────────────
function onSearchInput() {
  clearTimeout(searchDebounce);
  const q = document.getElementById('s-input').value.trim();
  if (!q) { resetSearch(); return; }
  searchDebounce = setTimeout(() => doSearch(q), 420);
}

function resetSearch() {
  document.getElementById('search-hint').style.display = 'flex';
  document.getElementById('search-grid').innerHTML = '';
  setSpinner(false);
}

function setSpinner(on) {
  document.getElementById('search-spinner').classList.toggle('active', on);
}

async function doSearch(q) {
  if (!TMDB.getKey()) return;
  setSpinner(true);
  document.getElementById('search-hint').style.display = 'none';
  document.getElementById('search-grid').innerHTML = '';
  try {
    const results = await TMDB.searchMulti(q);
    setSpinner(false);
    if (!results.length) {
      document.getElementById('search-grid').innerHTML =
        `<div class="empty-state" style="grid-column:1/-1"><i class="ti ti-mood-empty"></i><p>No results for "<strong>${esc(q)}</strong>"</p></div>`;
      return;
    }
    // Fetch providers in parallel (best-effort — don't fail if one errors)
    const withProviders = await Promise.all(results.map(async r => {
      try { r._providers = await TMDB.getProviders(r.id, r.media_type); }
      catch { r._providers = []; }
      return r;
    }));
    renderCards(withProviders, 'search-grid');
  } catch (e) {
    setSpinner(false);
    if (e.message === 'BAD_KEY') toast('API key problem — re-enter your key', 'warn');
    else toast('Search failed — check your connection', 'warn');
  }
}

function renderCards(items, containerId) {
  const grid = document.getElementById(containerId);
  grid.innerHTML = items.map(item => {
    const title   = item.title || item.name || 'Untitled';
    const year    = (item.release_date || item.first_air_date || '').slice(0, 4);
    const type    = item.media_type === 'movie' ? 'Film' : 'Series';
    const rating  = item.vote_average ? item.vote_average.toFixed(1) : null;
    const poster  = TMDB.posterUrl(item.poster_path, 'w342');
    const inWL    = isInWL(item.id);
    const providers = (item._providers || []).slice(0, 4);

    const posterHtml = poster
      ? `<img src="${esc(poster)}" alt="${esc(title)} poster" loading="lazy">`
      : `<div class="poster-placeholder"><i class="ti ti-device-tv"></i><span>${esc(title)}</span></div>`;

    const providerHtml = providers.map(p => {
      const logo = p.logo_path ? TMDB.posterUrl(p.logo_path, 'w92') : null;
      return logo ? `<img class="provider-logo" src="${esc(logo)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">` : '';
    }).join('');

    return `<div class="media-card ${inWL ? 'in-watchlist' : ''}" onclick="openModal(${item.id},'${esc(item.media_type)}')" data-id="${item.id}">
      <div class="poster-wrap">
        ${posterHtml}
        <span class="media-type-badge">${type}</span>
        ${rating ? `<span class="rating-badge"><i class="ti ti-star-filled"></i>${esc(rating)}</span>` : ''}
        <div class="in-wl-overlay"><i class="ti ti-bookmark-filled"></i></div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(title)}</h3>
        <p class="card-year">${year || '—'}</p>
        ${providerHtml ? `<div class="card-providers">${providerHtml}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Detail modal ──────────────────────────────────────────────────────────
async function openModal(id, mediaType) {
  const modal = document.getElementById('modal');
  const backdrop = document.getElementById('modal-backdrop');
  modal.innerHTML = `<div style="padding:80px;text-align:center;color:var(--hint)"><i class="ti ti-loader spin" style="font-size:32px"></i></div>`;
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const [details, providers] = await Promise.all([
      TMDB.getDetails(id, mediaType),
      TMDB.getProviders(id, mediaType),
    ]);
    currentModal = buildModalItem(details, mediaType, providers);
    renderModal(currentModal, details, providers);
  } catch {
    modal.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">
      <p>Couldn't load details.</p>
      <button onclick="closeModal()" class="primary-btn" style="margin-top:12px">Close</button>
    </div>`;
  }
}

function buildModalItem(d, mediaType, providers) {
  return {
    tmdbId:      d.id,
    mediaType,
    title:       d.title || d.name || 'Untitled',
    year:        (d.release_date || d.first_air_date || '').slice(0, 4),
    overview:    d.overview || '',
    posterPath:  d.poster_path || null,
    backdropPath:d.backdrop_path || null,
    rating:      d.vote_average ? d.vote_average.toFixed(1) : null,
    genres:      (d.genres || []).map(g => g.name),
    runtime:     d.runtime || (d.episode_run_time || [])[0] || null,
    seasons:     d.number_of_seasons || null,
    providerIds: providers.map(p => p.provider_id),
    status:      'Want to watch',
  };
}

function renderModal(item, details, providers) {
  const modal = document.getElementById('modal');
  const inWL  = isInWL(item.tmdbId);
  const backdropUrl = TMDB.backdropUrl(item.backdropPath);
  const posterUrl   = TMDB.posterUrl(item.posterPath, 'w342');
  const type  = item.mediaType === 'movie' ? 'Film' : 'Series';

  let metaParts = [];
  if (item.year)    metaParts.push(item.year);
  if (type)         metaParts.push(type);
  if (item.rating)  metaParts.push('★ ' + item.rating);
  if (item.runtime) metaParts.push(item.mediaType === 'movie' ? item.runtime + ' min' : item.runtime + ' min/ep');
  if (item.seasons) metaParts.push(item.seasons + (item.seasons === 1 ? ' season' : ' seasons'));

  const providerChips = providers.map(p => {
    const logo = p.logo_path ? TMDB.posterUrl(p.logo_path, 'w92') : null;
    return `<div class="provider-chip">
      ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
      <span>${esc(p.provider_name)}</span>
    </div>`;
  }).join('');

  const genreChips = item.genres.map(g => `<span class="genre-chip">${esc(g)}</span>`).join('');

  modal.innerHTML = `
    <div class="modal-hero">
      ${backdropUrl ? `<img src="${esc(backdropUrl)}" alt="">` : '<div style="height:100%;background:var(--surface2)"></div>'}
      <div class="modal-hero-grad"></div>
      <button class="modal-close" onclick="closeModal()" aria-label="Close"><i class="ti ti-x"></i></button>
    </div>
    <div class="modal-body">
      <div class="modal-poster-row">
        ${posterUrl
          ? `<img class="modal-poster" src="${esc(posterUrl)}" alt="${esc(item.title)} poster">`
          : `<div class="modal-poster-ph"><i class="ti ti-device-tv"></i></div>`}
        <div class="modal-title-block">
          <h2 class="modal-title">${esc(item.title)}</h2>
          <div class="modal-meta">${metaParts.map(p => `<span>${esc(p)}</span>`).join('<span class="meta-sep">·</span>')}</div>
        </div>
      </div>

      ${item.overview ? `<p class="modal-overview">${esc(item.overview)}</p>` : ''}

      ${providerChips ? `<div class="modal-section-label">Where to watch</div><div class="providers-row">${providerChips}</div>` : ''}
      ${genreChips    ? `<div class="modal-section-label">Genres</div><div class="genres-row">${genreChips}</div>` : ''}

      <div class="modal-actions">
        ${inWL
          ? `<button class="modal-add-btn remove" onclick="removeFromWL(${item.tmdbId})"><i class="ti ti-bookmark-off"></i> Remove from watchlist</button>`
          : `<button class="modal-add-btn" onclick="addToWL()"><i class="ti ti-bookmark-plus"></i> Add to watchlist</button>`
        }
      </div>
    </div>`;
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.body.style.overflow = '';
  currentModal = null;
}

function addToWL() {
  if (!currentModal) return;
  if (isInWL(currentModal.tmdbId)) return;
  watchlist.push({ ...currentModal, addedAt: Date.now() });
  save();
  toast(`Added "${currentModal.title}"`, 'success');
  // refresh card in search grid
  document.querySelectorAll(`[data-id="${currentModal.tmdbId}"]`).forEach(c => c.classList.add('in-watchlist'));
  // re-render modal button
  const btn = document.querySelector('.modal-add-btn');
  if (btn) {
    btn.className = 'modal-add-btn remove';
    btn.innerHTML = `<i class="ti ti-bookmark-off"></i> Remove from watchlist`;
    btn.setAttribute('onclick', `removeFromWL(${currentModal.tmdbId})`);
  }
}

function removeFromWL(tmdbId) {
  const item = watchlist.find(w => w.tmdbId === tmdbId);
  watchlist = watchlist.filter(w => w.tmdbId !== tmdbId);
  save();
  if (item) toast(`Removed "${item.title}"`, 'warn');
  document.querySelectorAll(`[data-id="${tmdbId}"]`).forEach(c => c.classList.remove('in-watchlist'));
  if (currentModal && currentModal.tmdbId === tmdbId) {
    const btn = document.querySelector('.modal-add-btn');
    if (btn) {
      btn.className = 'modal-add-btn';
      btn.innerHTML = `<i class="ti ti-bookmark-plus"></i> Add to watchlist`;
      btn.setAttribute('onclick', 'addToWL()');
    }
  }
  if (activeTab === 'watchlist') renderWatchlist();
}

// ── Watchlist ─────────────────────────────────────────────────────────────
function renderWatchlist() {
  const pf   = document.getElementById('wl-pf').value;
  const st   = document.getElementById('wl-st').value;
  const grid = document.getElementById('wl-grid');
  const stats = document.getElementById('wl-stats');

  const total    = watchlist.length + ytLinks.length;
  const watching = watchlist.filter(w => w.status === 'Watching').length;
  const finished = watchlist.filter(w => w.status === 'Finished').length;
  const want     = watchlist.filter(w => w.status === 'Want to watch').length;
  stats.innerHTML = `
    <div class="stat"><span class="stat-n">${total}</span><span class="stat-l">Total</span></div>
    <div class="stat"><span class="stat-n">${want}</span><span class="stat-l">To watch</span></div>
    <div class="stat"><span class="stat-n">${watching}</span><span class="stat-l">Watching</span></div>
    <div class="stat"><span class="stat-n">${finished}</span><span class="stat-l">Finished</span></div>`;

  // provider filter mapping
  const PROV_MAP = { 'Netflix':8, 'Disney+':337, 'HBO Max':384, 'Paramount+':531, 'Prime Video':119, 'YouTube':-1 };

  let items = watchlist.filter(w => {
    const ms = st === 'all' || w.status === st;
    let mp = true;
    if (pf !== 'all') {
      const pid = PROV_MAP[pf];
      mp = pid === -1 ? false : (w.providerIds || []).includes(pid);
    }
    return ms && mp;
  });

  if (!items.length && !ytLinks.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="ti ti-bookmark-off"></i><p>Your watchlist is empty.<br>Search for shows to add them.</p></div>`;
    return;
  }

  grid.innerHTML = items.map(w => {
    const poster = TMDB.posterUrl(w.posterPath, 'w342');
    const type   = w.mediaType === 'movie' ? 'Film' : 'Series';
    return `<div class="wl-card">
      <div class="wl-card-poster" onclick="openModal(${w.tmdbId},'${esc(w.mediaType)}')">
        ${poster
          ? `<img src="${esc(poster)}" alt="${esc(w.title)}" loading="lazy">`
          : `<div class="wl-poster-ph"><i class="ti ti-device-tv"></i></div>`}
        <button class="wl-remove-btn" onclick="event.stopPropagation();removeFromWL(${w.tmdbId})" aria-label="Remove">
          <i class="ti ti-x"></i>
        </button>
      </div>
      <div class="wl-card-body">
        <h3 class="wl-card-title">${esc(w.title)}</h3>
        <p class="wl-card-meta">${w.year || ''}${w.year && type ? ' · ' : ''}${type}</p>
        ${statusBadge(w.status)}
        <select class="status-sel" onchange="setStatus(${w.tmdbId},this.value)" aria-label="Status">
          ${Object.keys(STATUS_CONFIG).map(s => `<option ${w.status===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
      </div>
    </div>`;
  }).join('');
}

function setStatus(tmdbId, status) {
  const item = watchlist.find(w => w.tmdbId === tmdbId);
  if (item) { item.status = status; save(); renderWatchlist(); }
}

// ── YouTube ───────────────────────────────────────────────────────────────
function addYT() {
  const urlEl   = document.getElementById('yt-url');
  const titleEl = document.getElementById('yt-title');
  const url     = urlEl.value.trim();
  const title   = titleEl.value.trim();
  if (!url) { toast('Paste a YouTube URL first', 'warn'); urlEl.focus(); return; }
  if (!/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url)) {
    toast("That doesn't look like a YouTube URL", 'warn'); urlEl.focus(); return;
  }
  const displayTitle = title || inferYTTitle(url);
  ytLinks.unshift({ id: 'yt-' + Date.now(), url, title: displayTitle, status: 'Want to watch', addedAt: Date.now() });
  urlEl.value = ''; titleEl.value = '';
  save(); renderYT();
  toast('Added to YouTube list', 'success');
}

function inferYTTitle(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    const v = u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop();
    return v ? 'YouTube · ' + v : 'YouTube video';
  } catch { return 'YouTube video'; }
}

function removeYT(id) {
  const item = ytLinks.find(y => y.id === id);
  ytLinks = ytLinks.filter(y => y.id !== id);
  save(); renderYT();
  if (item) toast(`Removed "${item.title}"`, 'warn');
}

function setYTStatus(id, status) {
  const item = ytLinks.find(y => y.id === id);
  if (item) { item.status = status; save(); renderYT(); }
}

function renderYT() {
  const container = document.getElementById('yt-list');
  const header    = document.getElementById('yt-list-header');
  if (!ytLinks.length) {
    header.style.display = 'none';
    container.innerHTML = `<div class="empty-state"><i class="ti ti-brand-youtube" style="color:#f87171"></i><p>No videos saved yet.<br>Paste a YouTube link above.</p></div>`;
    return;
  }
  header.style.display = 'block';
  header.textContent = `Saved videos (${ytLinks.length})`;
  container.innerHTML = ytLinks.map(y => `
    <div class="yt-item-row">
      <i class="ti ti-brand-youtube yt-icon" aria-hidden="true"></i>
      <div class="yt-info">
        <a href="${esc(y.url)}" target="_blank" rel="noopener" class="yt-link">${esc(y.title)}</a>
        ${statusBadge(y.status)}
      </div>
      <select class="status-sel yt-sel" onchange="setYTStatus('${esc(y.id)}',this.value)">
        ${Object.keys(STATUS_CONFIG).map(s => `<option ${y.status===s?'selected':''}>${esc(s)}</option>`).join('')}
      </select>
      <button class="icon-btn" onclick="removeYT('${esc(y.id)}')" aria-label="Remove"><i class="ti ti-trash"></i></button>
    </div>`).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  load();
  updateBadge();

  document.getElementById('api-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitTmdbKey('api-key-input');
  });
  document.getElementById('settings-tmdb-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitTmdbKey('settings-tmdb-key');
  });
  document.getElementById('yt-url').addEventListener('keydown',   e => { if (e.key === 'Enter') addYT(); });
  document.getElementById('yt-title').addEventListener('keydown', e => { if (e.key === 'Enter') addYT(); });
  document.getElementById('s-input').addEventListener('keydown',  e => {
    if (e.key === 'Escape') { document.getElementById('s-input').value = ''; resetSearch(); }
  });

  // close modal on backdrop click
  document.getElementById('modal-backdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-backdrop')) closeModal();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// expose to HTML
window.switchTab   = switchTab;
window.onSearchInput = onSearchInput;
window.openModal   = openModal;
window.closeModal  = closeModal;
window.addToWL     = addToWL;
window.removeFromWL= removeFromWL;
window.setStatus   = setStatus;
window.renderWatchlist = renderWatchlist;
window.addYT       = addYT;
window.removeYT    = removeYT;
window.setYTStatus = setYTStatus;
window.submitTmdbKey = submitTmdbKey;
