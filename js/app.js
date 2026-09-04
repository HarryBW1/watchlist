'use strict';
// ── State ──────────────────────────────────────────────────────────────────
let currentUser    = null;
let currentAvatarId = null;
let watchlist      = [];
let ytLinks        = [];
let activeTab      = 'home';
let searchDebounce = null;
let currentModal   = null;
let homeLoaded     = false;
let discoveryLoaded = false;

const STATUS_CONFIG = {
  'Want to watch': { cls: 's-want',     icon: 'ti-bookmark' },
  'Watching':      { cls: 's-watching', icon: 'ti-player-play' },
  'Finished':      { cls: 's-finished', icon: 'ti-circle-check' },
  'Dropped':       { cls: 's-dropped',  icon: 'ti-circle-x' },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function updateBadge() {
  // Finished items are tucked away from the default view, so they don't count
  // toward the badge either — badge reflects what's visible under "All statuses"
  const wlTotal = watchlist.filter(w => w.status !== 'Finished').length;
  const ytTotal = ytLinks.length;

  document.querySelectorAll('.mob-badge, .dt-badge').forEach(el => {
    el.textContent = wlTotal || '';
    el.style.display = wlTotal ? 'inline-flex' : 'none';
  });

  document.querySelectorAll('.mob-badge-yt, .dt-badge-yt').forEach(el => {
    el.textContent = ytTotal || '';
    el.style.display = ytTotal ? 'inline-flex' : 'none';
  });
}

function statusBadge(status) {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG['Want to watch'];
  return `<span class="status-badge ${s.cls}"><i class="ti ${s.icon}"></i>${esc(status)}</span>`;
}

function isInWL(tmdbId) { return watchlist.some(w => w.tmdbId === tmdbId); }

// ── Screen switching — three distinct screens ─────────────────────────────
// Screen 1: auth (login / sign up)
// Screen 2: onboarding (TMDB key entry, shown once after first login)
// Screen 3: app shell (the full app)

function showScreen(name) {
  ['loading-screen', 'auth-screen', 'onboarding-screen', 'app-shell', 'error-screen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(name);
  if (target) target.style.display = name === 'app-shell' ? 'block' : 'flex';
}

// ── Auth screen ────────────────────────────────────────────────────────────
function setAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  const isLogin = tab === 'login';
  document.getElementById('auth-form-title').textContent  = isLogin ? 'Welcome back' : 'Create your account';
  document.getElementById('auth-submit-btn').textContent  = isLogin ? 'Sign in' : 'Create account';
  document.getElementById('auth-switch-msg').innerHTML    = isLogin
    ? `New here? <button class="link-btn" onclick="setAuthTab('signup')">Create an account</button>`
    : `Already have an account? <button class="link-btn" onclick="setAuthTab('login')">Sign in</button>`;
  document.getElementById('auth-error').textContent = '';
  document.getElementById('auth-error').style.color = '';
  // Autofocus email
  setTimeout(() => document.getElementById('auth-email')?.focus(), 50);
}

async function submitAuth() {
  const tab   = document.querySelector('.auth-tab.active')?.dataset.tab || 'signup';
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-password').value;
  const btn   = document.getElementById('auth-submit-btn');
  const errEl = document.getElementById('auth-error');

  errEl.style.color = '';
  errEl.textContent = '';

  if (!email)       { errEl.textContent = 'Please enter your email address.'; return; }
  if (!pass)        { errEl.textContent = 'Please enter a password.'; return; }
  if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }

  btn.disabled = true;
  btn.textContent = tab === 'login' ? 'Signing in…' : 'Creating account…';

  try {
    if (tab === 'signup') {
      await Auth.signUp(email, pass);
      // Supabase may auto-confirm (if email confirm is disabled in dashboard)
      // or require email confirmation. Try signing in immediately.
      try {
        await Auth.signIn(email, pass);
        // onAuthChange will fire → handleUser()
      } catch {
        // Email confirmation required — tell user
        errEl.style.color = 'var(--success)';
        errEl.textContent = '✓ Account created! Check your email to confirm it, then sign in.';
        setAuthTab('login');
      }
    } else {
      await Auth.signIn(email, pass);
      // onAuthChange fires → handleUser()
    }
  } catch (e) {
    errEl.style.color = '';
    errEl.textContent = friendlyAuthError(e.message);
    btn.disabled = false;
    btn.textContent = tab === 'login' ? 'Sign in' : 'Create account';
  }
}

function friendlyAuthError(msg) {
  if (!msg) return 'Something went wrong. Please try again.';
  if (msg.includes('Invalid login') || msg.includes('invalid_credentials'))
    return 'Incorrect email or password.';
  if (msg.includes('Email not confirmed'))
    return 'Please confirm your email address first, then sign in.';
  if (msg.includes('already registered') || msg.includes('already been registered'))
    return 'An account with this email already exists — try signing in.';
  if (msg.includes('weak') || msg.includes('password'))
    return 'Password is too weak. Use 6 or more characters.';
  if (msg.includes('valid email'))
    return 'Please enter a valid email address.';
  return msg;
}

async function handleSignOut() {
  try { await Auth.signOut(); } catch {}
  currentUser = null; watchlist = []; ytLinks = []; homeLoaded = false;
  // Reset to sign-up tab for next visitor
  setAuthTab('login');
  showScreen('auth-screen');
}

// ── Onboarding screen (TMDB key) ───────────────────────────────────────────
function showOnboarding(email) {
  showScreen('onboarding-screen');
  const hint = document.getElementById('onboarding-email-hint');
  if (hint) hint.textContent = email;
}

async function submitOnboardingKey() {
  const inp = document.getElementById('onboarding-key-input');
  const key = inp?.value.trim();
  const btn = document.getElementById('onboarding-key-btn');
  const err = document.getElementById('onboarding-error');

  err.textContent = '';
  if (!key) { err.textContent = 'Please paste your TMDB API key above.'; return; }

  btn.disabled = true;
  btn.innerHTML = `<i class="ti ti-loader spin"></i> Checking…`;

  TMDB.setKey(key);
  try {
    await TMDB.searchMulti('test');          // validate key
    await DB.saveProfile(currentUser.id, key); // save to Supabase profile
    // Pre-fill settings field
    const sf = document.getElementById('settings-tmdb-key');
    if (sf) sf.value = key;
    // Hide the in-app banner (won't be seen, but keep state clean)
    document.getElementById('tmdb-key-banner')?.classList.add('hidden');
    document.getElementById('search-controls') && (document.getElementById('search-controls').style.display = 'flex');
    document.getElementById('search-hint')     && (document.getElementById('search-hint').style.display     = 'flex');
    // Enter the app
    showScreen('app-shell');
    loadHome();
  } catch (e) {
    TMDB.setKey('');
    err.textContent = e.message === 'BAD_KEY'
      ? 'That key didn\'t work — please double-check and try again.'
      : 'Connection error — check your internet and try again.';
    btn.disabled = false;
    btn.innerHTML = `<i class="ti ti-check"></i> Confirm & enter app`;
  }
}

// ── Handle user session after login ────────────────────────────────────────
async function handleUser(user) {
  if (!user) { showScreen('auth-screen'); return; }

  currentUser = user;
  showScreen('loading-screen');
  document.getElementById('loading-label').textContent = 'Loading your profile…';

  // Update header avatar initial
  const av = document.getElementById('user-avatar');
  if (av) av.textContent = user.email[0].toUpperCase();

  try {
    const [profile, wl, yt] = await Promise.all([
      DB.loadProfile(user.id),
      DB.loadWatchlist(user.id),
      DB.loadYTLinks(user.id),
    ]);
    watchlist = wl;
    ytLinks   = yt;
    updateBadge();
    applyAvatar(profile?.avatar_id);

    if (profile?.tmdb_key) {
      // Returning user with key — go straight to app
      TMDB.setKey(profile.tmdb_key);
      document.getElementById('tmdb-key-banner')?.classList.add('hidden');
      const sc = document.getElementById('search-controls');
      const sh = document.getElementById('search-hint');
      if (sc) sc.style.display = 'flex';
      if (sh) sh.style.display = 'flex';
      const sf = document.getElementById('settings-tmdb-key');
      if (sf) sf.value = profile.tmdb_key;
      showScreen('app-shell');
      if (!homeLoaded) loadHome();
    } else {
      // New user — show onboarding to collect TMDB key
      showOnboarding(user.email);
    }
  } catch (e) {
    showScreen('auth-screen');
    const errEl = document.getElementById('auth-error');
    if (errEl) errEl.textContent = 'Failed to load your profile: ' + e.message;
  }
}

// ── TMDB key update from Settings ─────────────────────────────────────────
async function submitTmdbKey() {
  const inp = document.getElementById('settings-tmdb-key');
  const key = inp?.value.trim();
  const btn = document.getElementById('settings-key-btn');
  const err = document.getElementById('settings-key-error');
  if (err) err.textContent = '';
  if (!key) return;

  btn.disabled = true; btn.textContent = 'Checking…';
  TMDB.setKey(key);
  try {
    await TMDB.searchMulti('test');
    await DB.saveProfile(currentUser.id, key);
    document.getElementById('tmdb-key-banner')?.classList.add('hidden');
    const sc = document.getElementById('search-controls');
    const sh = document.getElementById('search-hint');
    if (sc) sc.style.display = 'flex';
    if (sh) sh.style.display = 'flex';
    toast('TMDB key updated and synced ✓', 'success');
    if (!homeLoaded) { switchTab('home'); }
  } catch (e) {
    TMDB.setKey('');
    if (err) err.textContent = e.message === 'BAD_KEY' ? 'Invalid key — please check it.' : 'Connection error.';
    toast('Key update failed', 'warn');
  } finally {
    btn.disabled = false; btn.textContent = 'Update key';
  }
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.nav-btn, .desktop-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'home'      && !homeLoaded && TMDB.getKey()) loadHome();
  if (tab === 'search'    && !discoveryLoaded && TMDB.getKey()) loadDiscovery();
  if (tab === 'watchlist') renderWatchlist();
  if (tab === 'youtube')   renderYT();
  if (tab === 'settings')  renderSettings();
  window.scrollTo(0, 0);
}

// ── Home ───────────────────────────────────────────────────────────────────
async function loadHome() {
  if (!TMDB.getKey()) return;
  const container = document.getElementById('home-content');
  container.innerHTML = `<div class="home-loading"><i class="ti ti-loader spin" style="font-size:28px;color:var(--hint)"></i></div>`;

  try {
    const [trending, nowPlaying, onAir, popularMovies, popularTV] = await Promise.all([
      TMDB.getTrending('all', 'week'),
      TMDB.getNowPlaying(),
      TMDB.getOnAir(),
      TMDB.getPopularMovies(),
      TMDB.getPopularTV(),
    ]);
    const featured = trending[0];
    container.innerHTML = `
      ${featuredSection(featured)}
      ${homeSection('Trending this week',  trending.slice(0, 12))}
      ${homeSection('In cinemas now',       nowPlaying.slice(0, 10))}
      ${homeSection('Series on air',        onAir.slice(0, 10))}
      ${homeSection('Popular films',        popularMovies.slice(0, 10))}
      ${homeSection('Popular series',       popularTV.slice(0, 10))}
    `;
    homeLoaded = true;
  } catch {
    container.innerHTML = `<div class="empty-state">
      <i class="ti ti-wifi-off"></i>
      <p>Couldn't load content.<br><button class="link-btn" onclick="loadHome()">Try again</button></p>
    </div>`;
  }
}

function featuredSection(item) {
  if (!item) return '';
  const t        = item.title || item.name || 'Untitled';
  const year     = (item.release_date || item.first_air_date || '').slice(0, 4);
  const backdrop = TMDB.backdropUrl(item.backdrop_path, 'w1280') || TMDB.posterUrl(item.poster_path, 'w780');
  const rating   = item.vote_average ? item.vote_average.toFixed(1) : null;
  const inWL     = isInWL(item.id);
  const kind     = item.media_type === 'movie' ? 'Film' : 'Series';
  const overview = item.overview ? esc(item.overview).slice(0, 140) + (item.overview.length > 140 ? '…' : '') : '';

  return `<div class="home-section featured-section">
    <div class="featured-card ${inWL ? 'in-watchlist' : ''}" onclick="openModal(${item.id},'${esc(item.media_type)}')" data-id="${item.id}">
      <div class="featured-backdrop">
        ${backdrop ? `<img src="${esc(backdrop)}" alt="${esc(t)}" loading="lazy">` : ''}
        <div class="featured-grad"></div>
        <span class="featured-badge"><i class="ti ti-sparkles"></i> Featured</span>
        <div class="in-wl-overlay"><i class="ti ti-bookmark-filled"></i></div>
      </div>
      <div class="featured-info">
        <h2 class="featured-title">${esc(t)}</h2>
        <p class="featured-meta">
          ${kind}${year ? ' · ' + esc(year) : ''}${rating ? ` · <i class="ti ti-star-filled"></i> ${esc(rating)}` : ''}
        </p>
        ${overview ? `<p class="featured-overview">${overview}</p>` : ''}
      </div>
    </div>
  </div>`;
}

function homeSection(title, items) {
  if (!items.length) return '';
  const cards = items.map(item => {
    const t      = item.title || item.name || 'Untitled';
    const year   = (item.release_date || item.first_air_date || '').slice(0, 4);
    const poster = TMDB.posterUrl(item.poster_path, 'w342');
    const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
    const inWL   = isInWL(item.id);
    const kind   = item.media_type === 'movie' ? 'Film' : 'Series';
    return `<div class="home-card ${inWL ? 'in-watchlist' : ''}" onclick="openModal(${item.id},'${esc(item.media_type)}')" data-id="${item.id}">
      <div class="poster-wrap">
        ${poster ? `<img src="${esc(poster)}" alt="${esc(t)}" loading="lazy">` : `<div class="poster-placeholder"><i class="ti ti-device-tv"></i></div>`}
        <span class="media-type-badge">${kind}</span>
        ${rating ? `<span class="rating-badge"><i class="ti ti-star-filled"></i>${esc(rating)}</span>` : ''}
        <div class="in-wl-overlay"><i class="ti ti-bookmark-filled"></i></div>
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(t)}</h3>
        <p class="card-year">${year || '—'}</p>
      </div>
    </div>`;
  }).join('');
  return `<div class="home-section">
    <h2 class="home-section-title">${title}</h2>
    <div class="home-row">${cards}</div>
  </div>`;
}

// ── Search ─────────────────────────────────────────────────────────────────
function onSearchInput() {
  clearTimeout(searchDebounce);
  const q = document.getElementById('s-input').value.trim();
  if (!q) { resetSearch(); return; }
  document.getElementById('search-discovery').style.display = 'none';
  searchDebounce = setTimeout(() => doSearch(q), 400);
}

function resetSearch() {
  document.getElementById('search-hint').style.display = 'flex';
  document.getElementById('search-discovery').style.display = discoveryLoaded ? 'block' : 'none';
  document.getElementById('search-grid').innerHTML = '';
  setSpinner(false);
}

async function loadDiscovery() {
  if (!TMDB.getKey()) return;
  const grid = document.getElementById('discovery-grid');
  try {
    const trending = await TMDB.getTrending('all', 'week');
    renderCards(trending.slice(0, 10), 'discovery-grid');
    discoveryLoaded = true;
    if (!document.getElementById('s-input').value.trim()) {
      document.getElementById('search-discovery').style.display = 'block';
    }
  } catch {
    grid.innerHTML = '';
  }
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
    let results = await TMDB.searchMulti(q);
    const typeF = document.getElementById('s-type').value;
    if (typeF === 'movie') results = results.filter(r => r.media_type === 'movie');
    if (typeF === 'tv')    results = results.filter(r => r.media_type === 'tv');
    setSpinner(false);
    if (!results.length) {
      document.getElementById('search-grid').innerHTML =
        `<div class="empty-state" style="grid-column:1/-1"><i class="ti ti-mood-empty"></i><p>No results for "<strong>${esc(q)}</strong>"</p></div>`;
      return;
    }
    const withProviders = await Promise.all(results.map(async r => {
      try { r._providers = await TMDB.getProviders(r.id, r.media_type); } catch { r._providers = []; }
      return r;
    }));
    renderCards(withProviders, 'search-grid');
  } catch (e) {
    setSpinner(false);
    toast(e.message === 'BAD_KEY' ? 'API key issue — check Settings' : 'Search failed', 'warn');
  }
}

function renderCards(items, containerId) {
  const grid = document.getElementById(containerId);
  grid.innerHTML = items.map(item => {
    const title     = item.title || item.name || 'Untitled';
    const year      = (item.release_date || item.first_air_date || '').slice(0, 4);
    const kind      = item.media_type === 'movie' ? 'Film' : 'Series';
    const rating    = item.vote_average ? item.vote_average.toFixed(1) : null;
    const poster    = TMDB.posterUrl(item.poster_path, 'w342');
    const inWL      = isInWL(item.id);
    const providers = (item._providers || []).slice(0, 4);
    const posterHtml = poster
      ? `<img src="${esc(poster)}" alt="${esc(title)}" loading="lazy">`
      : `<div class="poster-placeholder"><i class="ti ti-device-tv"></i><span>${esc(title)}</span></div>`;
    const providerHtml = providers.map(p => {
      const logo = p.logo_path ? TMDB.posterUrl(p.logo_path, 'w92') : null;
      return logo ? `<img class="provider-logo" src="${esc(logo)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">` : '';
    }).join('');
    return `<div class="media-card ${inWL ? 'in-watchlist' : ''}" onclick="openModal(${item.id},'${esc(item.media_type)}')" data-id="${item.id}">
      <div class="poster-wrap">
        ${posterHtml}
        <span class="media-type-badge">${kind}</span>
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

// ── Detail modal ───────────────────────────────────────────────────────────
async function openModal(id, mediaType) {
  const modal    = document.getElementById('modal');
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
    renderModal(currentModal, providers);
    syncWatchlistPoster(currentModal); // pick up any poster/backdrop change from TMDB
  } catch {
    modal.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">
      <p>Couldn't load details.</p>
      <button onclick="closeModal()" class="primary-btn" style="margin-top:12px">Close</button></div>`;
  }
}

// If this title is already in the watchlist and TMDB's poster/backdrop has
// changed since it was added, update the stored copy automatically.
async function syncWatchlistPoster(fresh) {
  const item = watchlist.find(w => w.tmdbId === fresh.tmdbId);
  if (!item) return;
  const posterChanged   = fresh.posterPath   && fresh.posterPath   !== item.posterPath;
  const backdropChanged = fresh.backdropPath && fresh.backdropPath !== item.backdropPath;
  if (!posterChanged && !backdropChanged) return;

  item.posterPath   = fresh.posterPath;
  item.backdropPath = fresh.backdropPath;
  if (activeTab === 'watchlist') renderWatchlist();

  try { await DB.upsertWatchlistItem(currentUser.id, item); }
  catch { /* best-effort — will retry next time the item is opened */ }
}

function buildModalItem(d, mediaType, providers) {
  return {
    tmdbId: d.id, mediaType,
    title:        d.title || d.name || 'Untitled',
    year:         (d.release_date || d.first_air_date || '').slice(0, 4),
    overview:     d.overview || '',
    posterPath:   d.poster_path   || null,
    backdropPath: d.backdrop_path || null,
    rating:       d.vote_average ? d.vote_average.toFixed(1) : null,
    genres:       (d.genres || []).map(g => g.name),
    runtime:      d.runtime || (d.episode_run_time || [])[0] || null,
    seasons:      d.number_of_seasons || null,
    providerIds:   providers.map(p => p.provider_id),
    // Store resolved display names — these drive the filter and always match the modal
    providerNames: [...new Set(providers.map(p => TMDB.providerInfo(p.provider_id).name || p.provider_name))],
    status:       'Want to watch',
  };
}

function renderModal(item, providers) {
  const modal       = document.getElementById('modal');
  const inWL        = isInWL(item.tmdbId);
  const backdropSrc = TMDB.backdropUrl(item.backdropPath);
  const posterSrc   = TMDB.posterUrl(item.posterPath, 'w342');
  const kind        = item.mediaType === 'movie' ? 'Film' : 'Series';
  const metaParts   = [
    item.year, kind,
    item.rating  ? '★ ' + item.rating : null,
    item.runtime ? (item.mediaType === 'movie' ? item.runtime + ' min' : item.runtime + ' min/ep') : null,
    item.seasons ? item.seasons + (item.seasons === 1 ? ' season' : ' seasons') : null,
  ].filter(Boolean);
  const providerChips = providers.map(p => {
    const logo = p.logo_path ? TMDB.posterUrl(p.logo_path, 'w92') : null;
    return `<div class="provider-chip">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<span>${esc(p.provider_name)}</span></div>`;
  }).join('');
  const genreChips = item.genres.map(g => `<span class="genre-chip">${esc(g)}</span>`).join('');
  modal.innerHTML = `
    <div class="modal-hero">
      ${backdropSrc ? `<img src="${esc(backdropSrc)}" alt="">` : '<div style="height:100%;background:var(--surface2)"></div>'}
      <div class="modal-hero-grad"></div>
      <button class="modal-close" onclick="closeModal()"><i class="ti ti-x"></i></button>
    </div>
    <div class="modal-body">
      <div class="modal-poster-row">
        ${posterSrc ? `<img class="modal-poster" src="${esc(posterSrc)}" alt="${esc(item.title)}">` : `<div class="modal-poster-ph"><i class="ti ti-device-tv"></i></div>`}
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
          : `<button class="modal-add-btn" onclick="addToWL()"><i class="ti ti-bookmark-plus"></i> Add to watchlist</button>`}
      </div>
    </div>`;
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.body.style.overflow = '';
  currentModal = null;
}

async function addToWL() {
  if (!currentModal || isInWL(currentModal.tmdbId)) return;
  // Negative timestamp means new items naturally sort before older ones
  // Small negative counter so new items sort first — avoids integer overflow
  // that a raw Date.now() timestamp would cause in a standard integer column
  const item = { ...currentModal, addedAt: Date.now(), sortOrder: -(watchlist.length + 1) };
  watchlist.unshift(item);
  updateBadge();
  document.querySelectorAll(`[data-id="${item.tmdbId}"]`).forEach(c => c.classList.add('in-watchlist'));
  const btn = document.querySelector('.modal-add-btn');
  if (btn) {
    btn.className = 'modal-add-btn remove';
    btn.innerHTML = `<i class="ti ti-bookmark-off"></i> Remove from watchlist`;
    btn.setAttribute('onclick', `removeFromWL(${item.tmdbId})`);
  }
  toast(`Added "${item.title}"`, 'success');
  try { await DB.upsertWatchlistItem(currentUser.id, item); }
  catch (e) { toast('Sync error: ' + e.message, 'warn'); }
}

async function removeFromWL(tmdbId) {
  const item = watchlist.find(w => w.tmdbId === tmdbId);
  watchlist = watchlist.filter(w => w.tmdbId !== tmdbId);
  updateBadge();
  document.querySelectorAll(`[data-id="${tmdbId}"]`).forEach(c => c.classList.remove('in-watchlist'));
  if (currentModal?.tmdbId === tmdbId) {
    const btn = document.querySelector('.modal-add-btn');
    if (btn) {
      btn.className = 'modal-add-btn';
      btn.innerHTML = `<i class="ti ti-bookmark-plus"></i> Add to watchlist`;
      btn.setAttribute('onclick', 'addToWL()');
    }
  }
  if (item) toast(`Removed "${item.title}"`, 'warn');
  if (activeTab === 'watchlist') renderWatchlist();
  try { await DB.deleteWatchlistItem(currentUser.id, tmdbId); }
  catch (e) { toast('Sync error: ' + e.message, 'warn'); }
}

// ── Watchlist ──────────────────────────────────────────────────────────────
// Returns the deduplicated display names for a watchlist item's providers.
// Prefers providerNames (stored on new items) and falls back to resolving
// from providerIds (for items saved before providerNames was added).
function getProviderNames(item) {
  if (item.providerNames && item.providerNames.length) {
    return item.providerNames;
  }
  // Fallback: resolve from stored IDs
  const names = [...new Set(
    (item.providerIds || []).map(pid => TMDB.providerInfo(pid).name).filter(Boolean)
  )];
  return names;
}

function renderWatchlist() {
  const stFilter   = document.getElementById('wl-st').value;
  const pfFilter   = document.getElementById('wl-pf').value;
  const typeFilter = document.getElementById('wl-type').value;
  const grid       = document.getElementById('wl-grid');
  const pfSelect   = document.getElementById('wl-pf');

  // Build dropdown from resolved provider names — these match exactly what the modal shows.
  // Falls back to resolving names from IDs for items saved before providerNames was added.
  const allNames = new Set();
  watchlist.forEach(w => {
    const names = getProviderNames(w);
    names.forEach(n => allNames.add(n));
  });

  const currentPf = pfSelect.value;
  pfSelect.innerHTML = '<option value="all">All platforms</option>';
  [...allNames].sort().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === currentPf) opt.selected = true;
    pfSelect.appendChild(opt);
  });
  if (currentPf !== 'all' && pfSelect.value !== currentPf) pfSelect.value = 'all';

  const finished = watchlist.filter(w => w.status === 'Finished').length;
  const watching = watchlist.filter(w => w.status === 'Watching').length;
  const want     = watchlist.filter(w => w.status === 'Want to watch').length;
  // "Total" reflects what's visible under All statuses — Finished items are
  // tucked away and only surface when the Finished filter is explicitly chosen
  const total    = watchlist.length - finished;
  document.getElementById('wl-stats').innerHTML = `
    <div class="stat"><span class="stat-n">${total}</span><span class="stat-l">Total</span></div>
    <div class="stat"><span class="stat-n">${want}</span><span class="stat-l">To watch</span></div>
    <div class="stat"><span class="stat-n">${watching}</span><span class="stat-l">Watching</span></div>
    <div class="stat"><span class="stat-n">${finished}</span><span class="stat-l">Finished</span></div>`;

  const filtered = watchlist.filter(w => {
    // Finished items are hidden under "All statuses" — only the Finished filter shows them
    if (stFilter === 'all' && w.status === 'Finished') return false;
    const matchStatus   = stFilter   === 'all' || w.status    === stFilter;
    const matchType     = typeFilter === 'all' || w.mediaType === typeFilter;
    const matchPlatform = pfFilter   === 'all' || getProviderNames(w).includes(pfFilter);
    return matchStatus && matchType && matchPlatform;
  });

  const viewMode = localStorage.getItem('wl_view_mode') || 'grid';
  grid.classList.toggle('view-grid', viewMode === 'grid');
  grid.classList.toggle('view-list', viewMode === 'list');
  document.querySelectorAll('.view-toggle-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === viewMode));

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <i class="ti ti-bookmark-off"></i>
      <p>${watchlist.length ? 'No items match your filters.' : 'Your watchlist is empty.<br>Browse the home page or search to add titles.'}</p>
    </div>`;
    return;
  }

  // Reordering is only meaningful with no filters active — otherwise a drag
  // would silently reorder a subset in a way that doesn't reflect visually.
  const reorderable = stFilter === 'all' && pfFilter === 'all' && typeFilter === 'all';

  grid.innerHTML = filtered.map(w => {
    const poster = TMDB.posterUrl(w.posterPath, 'w342');
    const kind   = w.mediaType === 'movie' ? 'Film' : 'Series';

    const dragHandle = reorderable
      ? `<div class="drag-handle" draggable="true" aria-label="Drag to reorder"><i class="ti ti-grip-vertical"></i></div>`
      : '';

    if (viewMode === 'list') {
      const backdrop = TMDB.backdropUrl(w.backdropPath, 'w780');
      return `<div class="wl-card list-card" data-tmdb="${w.tmdbId}">
        <div class="wl-card-hero" onclick="openModal(${w.tmdbId},'${esc(w.mediaType)}')">
          ${backdrop ? `<img src="${esc(backdrop)}" alt="" loading="lazy">` : ''}
          <div class="wl-card-hero-grad"></div>
        </div>
        <button class="wl-remove-btn" onclick="event.stopPropagation();removeFromWL(${w.tmdbId})"><i class="ti ti-x"></i></button>
        <div class="list-body">
          ${poster
            ? `<img class="list-poster" src="${esc(poster)}" alt="${esc(w.title)}" loading="lazy" onclick="openModal(${w.tmdbId},'${esc(w.mediaType)}')">`
            : `<div class="list-poster-ph"><i class="ti ti-device-tv"></i></div>`}
          <div class="list-info">
            <h3 class="wl-card-title">${esc(w.title)}</h3>
            <p class="wl-card-meta">${w.year || ''}${w.year ? ' · ' : ''}${kind}</p>
            ${statusBadge(w.status)}
            <select class="status-sel" onchange="setStatus(${w.tmdbId},this.value)">
              ${Object.keys(STATUS_CONFIG).map(s => `<option value="${esc(s)}" ${w.status===s?'selected':''}>${esc(s)}</option>`).join('')}
            </select>
            ${stFilter === 'Finished' ? renderStars(w.tmdbId, w.userRating) : ''}
          </div>
          ${dragHandle}
        </div>
      </div>`;
    }

    // Grid view (default)
    return `<div class="wl-card" data-tmdb="${w.tmdbId}">
      ${dragHandle}
      <div class="wl-card-poster" onclick="openModal(${w.tmdbId},'${esc(w.mediaType)}')">
        ${poster ? `<img src="${esc(poster)}" alt="${esc(w.title)}" loading="lazy">` : `<div class="wl-poster-ph"><i class="ti ti-device-tv"></i></div>`}
        <button class="wl-remove-btn" onclick="event.stopPropagation();removeFromWL(${w.tmdbId})"><i class="ti ti-x"></i></button>
      </div>
      <div class="wl-card-body">
        <h3 class="wl-card-title">${esc(w.title)}</h3>
        <p class="wl-card-meta">${w.year || ''}${w.year ? ' · ' : ''}${kind}</p>
        ${statusBadge(w.status)}
        <select class="status-sel" onchange="setStatus(${w.tmdbId},this.value)">
          ${Object.keys(STATUS_CONFIG).map(s => `<option value="${esc(s)}" ${w.status===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        ${stFilter === 'Finished' ? renderStars(w.tmdbId, w.userRating) : ''}
      </div>
    </div>`;
  }).join('');

  if (reorderable) attachDragReorder(grid);
}

function setWatchlistView(mode) {
  localStorage.setItem('wl_view_mode', mode);
  renderWatchlist();
}

// ── Drag-to-reorder (Pointer Events — works on touch/iOS and mouse/desktop) ──
// Native HTML5 drag-and-drop does not work on iOS touch, so this uses
// pointerdown/pointermove/pointerup on the drag handle instead, manually
// tracking position and swapping list order as the card is dragged.
let dragState = null;

function attachDragReorder(container) {
  container.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('pointerdown', onDragHandleDown);
  });
}

function onDragHandleDown(e) {
  e.preventDefault();
  const card = e.currentTarget.closest('.wl-card');
  if (!card) return;

  const container = card.parentElement;
  const cards = [...container.querySelectorAll('.wl-card')];

  dragState = {
    card,
    container,
    cards,
    startY: e.clientY,
    startX: e.clientX,
    lastClientX: e.clientX,
    lastClientY: e.clientY,
    startScrollY: window.scrollY,
    cardStartRect: card.getBoundingClientRect(),
    pointerId: e.pointerId,
  };

  card.classList.add('dragging');
  card.style.position = 'relative';
  card.style.zIndex = '50';
  card.style.pointerEvents = 'none'; // let drop-target detection see through to cards beneath

  e.currentTarget.setPointerCapture(e.pointerId);
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragUp);
  document.addEventListener('pointercancel', onDragUp);
}

function onDragMove(e) {
  if (!dragState) return;
  dragState.lastClientX = e.clientX;
  dragState.lastClientY = e.clientY;
  const scrollDelta = window.scrollY - dragState.startScrollY;
  const dy = (e.clientY - dragState.startY) + scrollDelta;
  const dx = e.clientX - dragState.startX;
  dragState.card.style.transform = `translate(${dx}px, ${dy}px)`;

  // Find which other card the pointer is currently over
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.wl-card');
  dragState.cards.forEach(c => c.classList.remove('drag-over'));
  if (target && target !== dragState.card && dragState.cards.includes(target)) {
    target.classList.add('drag-over');
    dragState.hoverTarget = target;
  } else {
    dragState.hoverTarget = null;
  }

  updateAutoScroll(e.clientY);
}

// ── Auto-scroll while dragging near the top/bottom of the screen ───────────
const AUTOSCROLL_EDGE  = 130; // px from viewport edge that triggers scrolling
const AUTOSCROLL_SPEED = 22;  // px per frame at full deflection
let autoScrollDir  = 0;       // -1 up, 0 none, 1 down
let autoScrollFrame = null;

function updateAutoScroll(clientY) {
  const vh = window.innerHeight;
  // Bottom nav overlays the lower portion of the viewport — the content
  // visually "ends" above it, so measure the bottom trigger zone from there
  // rather than the true screen edge (which is what made this feel unresponsive).
  const nav = document.querySelector('.bottom-nav');
  const navHeight = (nav && getComputedStyle(nav).display !== 'none') ? nav.getBoundingClientRect().height : 0;
  const effectiveBottom = vh - navHeight;

  if (clientY < AUTOSCROLL_EDGE) {
    autoScrollDir = -Math.min(1, 1 - clientY / AUTOSCROLL_EDGE);
  } else if (clientY > effectiveBottom - AUTOSCROLL_EDGE) {
    autoScrollDir = Math.min(1, (clientY - (effectiveBottom - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE);
  } else {
    autoScrollDir = 0;
  }

  if (autoScrollDir !== 0 && !autoScrollFrame) {
    autoScrollFrame = requestAnimationFrame(autoScrollStep);
  }
}

function autoScrollStep() {
  autoScrollFrame = null;
  if (!dragState || autoScrollDir === 0) return;

  window.scrollBy(0, autoScrollDir * AUTOSCROLL_SPEED);

  // Update the card's on-screen position to compensate for the scroll that just happened
  const scrollDelta = window.scrollY - dragState.startScrollY;
  const dy = (dragState.lastClientY - dragState.startY) + scrollDelta;
  const dx = dragState.lastClientX - dragState.startX;
  dragState.card.style.transform = `translate(${dx}px, ${dy}px)`;

  // Keep the dragged card visually tracking the pointer as the page scrolls
  // beneath it — re-run the hover-target detection at the same screen position
  const rect = dragState.card.getBoundingClientRect();
  const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    ?.closest('.wl-card');
  if (target && target !== dragState.card && dragState.cards.includes(target)) {
    dragState.cards.forEach(c => c.classList.remove('drag-over'));
    target.classList.add('drag-over');
    dragState.hoverTarget = target;
  }

  autoScrollFrame = requestAnimationFrame(autoScrollStep);
}

function stopAutoScroll() {
  autoScrollDir = 0;
  if (autoScrollFrame) { cancelAnimationFrame(autoScrollFrame); autoScrollFrame = null; }
}

function onDragUp(e) {
  if (!dragState) return;
  stopAutoScroll();
  const { card, hoverTarget, cards } = dragState;

  card.classList.remove('dragging');
  card.style.position = '';
  card.style.zIndex = '';
  card.style.pointerEvents = '';
  card.style.transform = '';
  cards.forEach(c => c.classList.remove('drag-over'));

  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragUp);
  document.removeEventListener('pointercancel', onDragUp);

  if (hoverTarget) {
    const srcId  = parseInt(card.dataset.tmdb, 10);
    const destId = parseInt(hoverTarget.dataset.tmdb, 10);
    reorderWatchlist(srcId, destId);
  }

  dragState = null;
}

function reorderWatchlist(srcId, destId) {
  const srcIdx  = watchlist.findIndex(w => w.tmdbId === srcId);
  const destIdx = watchlist.findIndex(w => w.tmdbId === destId);
  if (srcIdx === -1 || destIdx === -1) return;

  const [moved] = watchlist.splice(srcIdx, 1);
  watchlist.splice(destIdx, 0, moved);

  renderWatchlist();
  saveWatchlistOrder();
}

async function saveWatchlistOrder() {
  // Persist the new order by writing a sortOrder index to each item.
  // Runs in the background — UI has already updated optimistically.
  try {
    await Promise.all(
      watchlist.map((w, i) => DB.updateWatchlistOrder(currentUser.id, w.tmdbId, i))
    );
  } catch (e) {
    toast('Could not save new order: ' + e.message, 'warn');
  }
}

// ── Star rating (Finished filter only) — supports half-star increments ─────
function renderStars(tmdbId, rating) {
  rating = rating || 0;
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    let fill = 0;
    if (rating >= i) fill = 100;
    else if (rating >= i - 0.5) fill = 50;
    stars += `<div class="star-slot">
      <div class="star-bg"><i class="ti ti-star-filled"></i></div>
      <div class="star-fg-mask" style="--fill:${fill}%"><div class="star-fg-icon"><i class="ti ti-star-filled"></i></div></div>
    </div>`;
  }
  const label = rating ? `${rating.toFixed(1).replace('.0','')} / 5` : 'Not rated';
  return `<div class="star-rating-row">
    <div class="star-rating" data-tmdb="${tmdbId}">${stars}</div>
    <span class="star-rating-label">${label}</span>
    ${rating ? `<button class="star-clear" onclick="event.stopPropagation();setUserRating(${tmdbId},0)" aria-label="Clear rating"><i class="ti ti-x"></i></button>` : ''}
  </div>`;
}

async function setUserRating(tmdbId, rating) {
  const item = watchlist.find(w => w.tmdbId === tmdbId);
  if (!item) return;
  item.userRating = rating || null;
  setTimeout(renderWatchlist, 0);
  try { await DB.updateWatchlistRating(currentUser.id, tmdbId, item.userRating); }
  catch (e) { toast('Sync error: ' + e.message, 'warn'); }
}

// ── Star rating: press-and-drag across the row (tap also works, as a zero-distance drag) ──
let starDrag = null;

function computeRatingFromX(clientX, rect) {
  const relX = clientX - rect.left;
  let raw = (relX / rect.width) * 5;
  raw = Math.round(raw * 2) / 2; // snap to nearest 0.5
  return Math.max(0, Math.min(5, raw));
}

function paintStarRating(container, rating) {
  container.querySelectorAll('.star-slot').forEach((slot, idx) => {
    const i = idx + 1;
    let fill = 0;
    if (rating >= i) fill = 100;
    else if (rating >= i - 0.5) fill = 50;
    const mask = slot.querySelector('.star-fg-mask');
    if (mask) mask.style.setProperty('--fill', fill + '%');
  });
  const row = container.closest('.star-rating-row');
  const label = row?.querySelector('.star-rating-label');
  if (label) label.textContent = rating ? `${rating.toFixed(1).replace('.0','')} / 5` : 'Not rated';
}

function initStarDrag() {
  document.addEventListener('pointerdown', e => {
    const container = e.target.closest('.star-rating');
    if (!container) return;
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    starDrag = {
      tmdbId: parseInt(container.dataset.tmdb, 10),
      container, rect,
      rating: computeRatingFromX(e.clientX, rect),
    };
    paintStarRating(container, starDrag.rating);
    try { container.setPointerCapture(e.pointerId); } catch {}
  });

  document.addEventListener('pointermove', e => {
    if (!starDrag) return;
    starDrag.rating = computeRatingFromX(e.clientX, starDrag.rect);
    paintStarRating(starDrag.container, starDrag.rating);
  });

  const commit = () => {
    if (!starDrag) return;
    setUserRating(starDrag.tmdbId, starDrag.rating);
    starDrag = null;
  };
  document.addEventListener('pointerup', commit);
  document.addEventListener('pointercancel', () => { starDrag = null; });
}

async function setStatus(tmdbId, status) {
  const item = watchlist.find(w => w.tmdbId === tmdbId);
  if (!item) return;
  const prevStatus = item.status;
  item.status = status;

  const activeFilter = document.getElementById('wl-st').value;
  // Finished items are hidden under "All statuses", so switching a status
  // to or from Finished changes what's visible — always re-render for that case.
  const visibilityChanged = status === 'Finished' || prevStatus === 'Finished';

  if (activeFilter !== 'all' || visibilityChanged) {
    // Re-render so the item moves in/out of view immediately
    setTimeout(renderWatchlist, 0);
  } else {
    // No filter, no visibility change — just update the badge in-place
    const card = document.querySelector(`.wl-card[data-tmdb="${tmdbId}"]`);
    if (card) {
      const badge = card.querySelector('.status-badge');
      if (badge) badge.outerHTML = statusBadge(status);
    }
  }

  updateBadge(); // Total/nav badge exclude Finished, so this needs to reflect the change too

  try { await DB.updateWatchlistStatus(currentUser.id, tmdbId, status); }
  catch (e) { toast('Sync error: ' + e.message, 'warn'); }
}

// ── YouTube ────────────────────────────────────────────────────────────────
async function addYT() {
  const urlEl   = document.getElementById('yt-url');
  const titleEl = document.getElementById('yt-title');
  const addBtn  = document.getElementById('yt-add-btn');
  const url     = urlEl.value.trim();
  if (!url) { toast('Paste a YouTube URL first', 'warn'); urlEl.focus(); return; }
  if (!/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url)) {
    toast("That doesn't look like a YouTube URL", 'warn'); urlEl.focus(); return;
  }
  addBtn.disabled = true;
  addBtn.innerHTML = `<i class="ti ti-loader spin"></i> Fetching…`;
  const meta = await YouTube.fetchYTMeta(url);
  const link = {
    id:           'yt-' + Date.now(),
    url,
    title:        titleEl.value.trim() || meta?.title || inferYTTitle(url),
    thumbnailUrl: meta?.thumbnailUrl || null,
    videoId:      meta?.videoId || YouTube.extractVideoId(url),
    status:       'Want to watch',
    addedAt:      Date.now(),
  };
  ytLinks.unshift(link);
  urlEl.value = ''; titleEl.value = '';
  addBtn.disabled = false;
  addBtn.innerHTML = `<i class="ti ti-plus"></i> Add video`;
  updateBadge(); renderYT();
  toast('Added to YouTube list', 'success');
  try { await DB.upsertYTLink(currentUser.id, link); }
  catch (e) { toast('Sync error: ' + e.message, 'warn'); }
}

function inferYTTitle(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    const v = u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop();
    return v ? 'YouTube · ' + v : 'YouTube video';
  } catch { return 'YouTube video'; }
}

async function removeYT(id) {
  const item = ytLinks.find(y => y.id === id);
  ytLinks = ytLinks.filter(y => y.id !== id);
  updateBadge(); renderYT();
  if (item) toast(`Removed "${item.title}"`, 'warn');
  try { await DB.deleteYTLink(currentUser.id, id); }
  catch (e) { toast('Sync error: ' + e.message, 'warn'); }
}

async function setYTStatus(id, status) {
  const item = ytLinks.find(y => y.id === id);
  if (!item) return;
  item.status = status;
  // Update badge in-place — avoids full re-render which causes cross-browser onchange double-fire
  const row = document.querySelector(`.yt-item-row[data-yt-id="${CSS.escape(id)}"]`);
  if (row) {
    const badge = row.querySelector('.status-badge');
    if (badge) badge.outerHTML = statusBadge(status);
  }
  try { await DB.updateYTStatus(currentUser.id, id, status); }
  catch (e) { toast('Sync error: ' + e.message, 'warn'); }
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
  container.innerHTML = ytLinks.map(y => {
    const thumb = y.thumbnailUrl || (y.videoId ? `https://img.youtube.com/vi/${y.videoId}/mqdefault.jpg` : null);
    return `<div class="yt-item-row" data-yt-id="${esc(y.id)}">
      <div class="yt-item-top">
        ${thumb
          ? `<img class="yt-thumb" src="${esc(thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="yt-thumb-ph"><i class="ti ti-brand-youtube yt-icon"></i></div>`}
        <div class="yt-info">
          <a href="${esc(y.url)}" target="_blank" rel="noopener" class="yt-link">${esc(y.title)}</a>
          ${statusBadge(y.status)}
        </div>
      </div>
      <div class="yt-item-controls">
        <select class="status-sel yt-sel" onchange="setYTStatus('${esc(y.id)}',this.value)">
          ${Object.keys(STATUS_CONFIG).map(s => `<option value="${esc(s)}" ${y.status===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <button class="icon-btn" onclick="removeYT('${esc(y.id)}')" aria-label="Remove"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

// ── Settings ───────────────────────────────────────────────────────────────
// ── Pull-to-refresh data reload ────────────────────────────────────────────
async function doRefresh() {
  if (!currentUser) return;
  try {
    const [wl, yt] = await Promise.all([
      DB.loadWatchlist(currentUser.id),
      DB.loadYTLinks(currentUser.id),
    ]);
    watchlist = wl;
    ytLinks   = yt;
    updateBadge();
    // Re-render whichever tab is currently visible
    if (activeTab === 'home')      { homeLoaded = false; loadHome(); }
    if (activeTab === 'watchlist') renderWatchlist();
    if (activeTab === 'youtube')   renderYT();
  } catch (e) {
    toast('Refresh failed: ' + e.message, 'warn');
  }
}

// ── Export / Import ────────────────────────────────────────────────────────
function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version:    1,
    watchlist,
    ytLinks,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  a.href     = url;
  a.download = `watchlist-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Watchlist exported', 'success');
}

async function importData(event) {
  const file     = event.target.files[0];
  const statusEl = document.getElementById('import-status');
  if (!file) return;

  // Reset the input so the same file can be re-imported if needed
  event.target.value = '';
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Reading file…';

  try {
    const text    = await file.text();
    const payload = JSON.parse(text);

    if (!payload.watchlist || !Array.isArray(payload.watchlist)) {
      throw new Error('Invalid file — does not look like a Watchlist export.');
    }

    const importedWL = payload.watchlist  || [];
    const importedYT = payload.ytLinks    || [];

    // Merge — skip items already in the list (matched by tmdbId / yt id)
    let addedWL = 0;
    let addedYT = 0;

    for (const item of importedWL) {
      if (!watchlist.some(w => w.tmdbId === item.tmdbId)) {
        watchlist.push(item);
        addedWL++;
        try { await DB.upsertWatchlistItem(currentUser.id, item); } catch {}
      }
    }

    for (const link of importedYT) {
      if (!ytLinks.some(y => y.id === link.id)) {
        ytLinks.push(link);
        addedYT++;
        try { await DB.upsertYTLink(currentUser.id, link); } catch {}
      }
    }

    updateBadge();
    statusEl.style.color = 'var(--success)';
    statusEl.textContent = `Imported ${addedWL} watchlist item${addedWL !== 1 ? 's' : ''} and ${addedYT} YouTube link${addedYT !== 1 ? 's' : ''}.${addedWL + addedYT === 0 ? ' Nothing new to add.' : ''}`;
    toast('Import complete', 'success');

  } catch (e) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = e.message || 'Failed to read file.';
  }
}

// ── Theme (mode + accent) ───────────────────────────────────────────────────
function setThemeMode(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem('wl_theme_mode', mode);
  syncThemeControls();
}

function setThemeAccent(accent) {
  if (accent === 'purple') {
    document.documentElement.removeAttribute('data-accent'); // purple is the default, no override needed
  } else {
    document.documentElement.setAttribute('data-accent', accent);
  }
  localStorage.setItem('wl_theme_accent', accent);
  syncThemeControls();
}

function syncThemeControls() {
  const mode   = localStorage.getItem('wl_theme_mode')   || 'dark';
  const accent = localStorage.getItem('wl_theme_accent') || 'purple';
  document.querySelectorAll('.theme-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.theme-swatch').forEach(b =>
    b.classList.toggle('active', b.dataset.accent === accent));
}

function applyStoredTheme() {
  const mode   = localStorage.getItem('wl_theme_mode')   || 'dark';
  const accent = localStorage.getItem('wl_theme_accent') || 'purple';
  document.documentElement.setAttribute('data-theme', mode);
  if (accent !== 'purple') document.documentElement.setAttribute('data-accent', accent);
}

// ── Password reset ───────────────────────────────────────────────────────────
async function sendPasswordReset() {
  const statusEl = document.getElementById('reset-password-status');
  if (!currentUser) return;
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Sending…';
  try {
    await Auth.sendPasswordReset(currentUser.email);
    statusEl.style.color = 'var(--success)';
    statusEl.textContent = `Reset email sent to ${currentUser.email}. Check your inbox.`;
  } catch (e) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = e.message || 'Failed to send reset email.';
  }
}

// ── Profile picture ──────────────────────────────────────────────────────────
// A set of built-in colourful icon avatars — similar in spirit to the preset
// profile pictures on Netflix/Disney+/Prime Video, without using any
// copyrighted platform artwork.
const AVATAR_OPTIONS = [
  { id: 'a1',  icon: 'ti-mood-smile', bg: '#e50914' },
  { id: 'a2',  icon: 'ti-ghost-2',    bg: '#6c63ff' },
  { id: 'a3',  icon: 'ti-robot',      bg: '#00a8e0' },
  { id: 'a4',  icon: 'ti-cat',        bg: '#ce712e' },
  { id: 'a5',  icon: 'ti-alien',      bg: '#22c55e' },
  { id: 'a6',  icon: 'ti-crown',      bg: '#eab308' },
  { id: 'a7',  icon: 'ti-skull',      bg: '#71717a' },
  { id: 'a8',  icon: 'ti-heart',      bg: '#ec4899' },
  { id: 'a9',  icon: 'ti-bolt',       bg: '#3b82f6' },
  { id: 'a10', icon: 'ti-flame',      bg: '#f97316' },
  { id: 'a11', icon: 'ti-star-filled',bg: '#8adae0' },
  { id: 'a12', icon: 'ti-moon-stars', bg: '#5822b4' },
];

function applyAvatar(avatarId) {
  currentAvatarId = avatarId || null;
  const opt = AVATAR_OPTIONS.find(a => a.id === avatarId);
  document.querySelectorAll('#user-avatar').forEach(el => {
    if (opt) {
      el.style.background = opt.bg;
      el.innerHTML = `<i class="ti ${opt.icon}"></i>`;
    } else {
      el.style.background = '';
      el.textContent = currentUser ? currentUser.email[0].toUpperCase() : '?';
    }
  });
}

function renderAvatarPicker() {
  const grid = document.getElementById('avatar-picker');
  if (!grid) return;
  grid.innerHTML = AVATAR_OPTIONS.map(a => `
    <button class="avatar-option ${currentAvatarId === a.id ? 'selected' : ''}"
            style="background:${a.bg}" onclick="setAvatar('${a.id}')" aria-label="Choose avatar">
      <i class="ti ${a.icon}"></i>
    </button>`).join('') +
    `<button class="avatar-option avatar-option-clear ${!currentAvatarId ? 'selected' : ''}"
             onclick="setAvatar(null)" aria-label="Use initials instead">
      <i class="ti ti-letter-case"></i>
    </button>`;
}

async function setAvatar(avatarId) {
  applyAvatar(avatarId);
  renderAvatarPicker();
  try { await DB.saveAvatar(currentUser.id, avatarId); }
  catch (e) { toast('Could not save avatar: ' + e.message, 'warn'); }
}

// ── Delete account ───────────────────────────────────────────────────────────
function openDeleteAccountModal() {
  document.getElementById('delete-account-modal').classList.add('open');
  document.getElementById('delete-confirm-input').value = '';
  document.getElementById('delete-confirm-btn').disabled = true;
}

function closeDeleteAccountModal() {
  document.getElementById('delete-account-modal').classList.remove('open');
}

function onDeleteConfirmInput() {
  const val = document.getElementById('delete-confirm-input').value.trim();
  document.getElementById('delete-confirm-btn').disabled = (val !== 'DELETE');
}

async function confirmDeleteAccount() {
  const btn = document.getElementById('delete-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    await DB.deleteAllUserData(currentUser.id);
    toast('Your data has been deleted', 'success');
    closeDeleteAccountModal();
    await handleSignOut();
  } catch (e) {
    toast('Delete failed: ' + e.message, 'warn');
    btn.disabled = false;
    btn.textContent = 'Delete everything';
  }
}

function renderSettings() {
  const el = document.getElementById('settings-email');
  if (el && currentUser) el.textContent = currentUser.email;
  syncThemeControls();
  renderAvatarPicker();
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  applyStoredTheme(); // apply immediately to avoid a flash of the wrong theme
  initStarDrag();

  // ── Guard: Supabase CDN must have loaded ───────────────────────────────
  if (typeof window.supabase === 'undefined') {
    showScreen('error-screen');
    document.getElementById('error-message').textContent =
      'Could not load Supabase library. Check your internet connection and reload.';
    return;
  }

  // ── Guard: config must have real values ────────────────────────────────
  if (!Auth.isConfigured()) {
    showScreen('error-screen');
    document.getElementById('error-message').innerHTML =
      '<strong>Supabase not configured.</strong><br>' +
      'Open <code>js/supabase-config.js</code> and replace<br>' +
      '<code>YOUR_SUPABASE_URL</code> and <code>YOUR_SUPABASE_ANON_KEY</code><br>' +
      'with your values from the Supabase dashboard.';
    return;
  }

  Auth.initSupabase();

  // Default to sign-up tab (better for new users)
  setAuthTab('login');
  showScreen('loading-screen');
  document.getElementById('loading-label').textContent = 'Checking session…';

  // Keyboard shortcuts
  document.getElementById('auth-email')       .addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
  document.getElementById('auth-password')    .addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
  document.getElementById('onboarding-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitOnboardingKey(); });
  document.getElementById('yt-url')           .addEventListener('keydown', e => { if (e.key === 'Enter') addYT(); });
  document.getElementById('yt-title')         .addEventListener('keydown', e => { if (e.key === 'Enter') addYT(); });
  document.getElementById('delete-confirm-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !document.getElementById('delete-confirm-btn').disabled) confirmDeleteAccount();
  });
  document.getElementById('s-input')          .addEventListener('keydown', e => {
    if (e.key === 'Escape') { document.getElementById('s-input').value = ''; resetSearch(); }
  });
  document.getElementById('modal-backdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-backdrop')) closeModal();
  });
  document.getElementById('delete-account-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('delete-account-modal')) closeDeleteAccountModal();
  });

  // Auth state listener fires on login, logout, token refresh
  Auth.onAuthChange(user => handleUser(user));

  // Check for existing session on page load
  const user = await Auth.getUser();
  if (!user) {
    showScreen('auth-screen');
  }
  // If user exists, onAuthChange already fired and handleUser() is running

  // Safety net — if still on loading screen after 8 seconds, show auth instead
  setTimeout(() => {
    const ls = document.getElementById('loading-screen');
    if (ls && ls.style.display !== 'none') {
      console.warn('Loading timeout — falling back to auth screen');
      showScreen('auth-screen');
    }
  }, 8000);

  // ── Pull-to-refresh ──────────────────────────────────────────────────────
  // Grows #ptr-zone's height as the user pulls, revealing the spinner in its
  // own reserved space below the (now-fixed) header — rather than floating
  // an indicator over the content. Only our own threshold triggers a refresh;
  // ordinary elastic overscroll bounce alone never does.
  let ptrStartY    = 0;
  let ptrTriggered = false;
  const PTR_THRESHOLD  = 70;  // px of pull needed to trigger a refresh
  const PTR_MAX_HEIGHT = 56;  // px — cap on how tall the reveal zone grows

  const ptrZone = document.getElementById('ptr-zone');
  const ptrEl   = document.getElementById('ptr-indicator');

  document.addEventListener('touchstart', e => {
    // Never start pull-to-refresh while a card drag is in progress
    if (dragState) { ptrStartY = 0; return; }
    // Only start tracking if already scrolled to the very top
    if (window.scrollY === 0) ptrStartY = e.touches[0].clientY;
    else ptrStartY = 0;
    ptrTriggered = false;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (dragState) { ptrStartY = 0; ptrZone.style.height = '0px'; return; }
    if (!ptrStartY) return;
    const pullDist = e.touches[0].clientY - ptrStartY;
    if (pullDist <= 0) return;

    const height = Math.min(pullDist * 0.5, PTR_MAX_HEIGHT);
    ptrZone.style.height = `${height}px`;

    // Spin once threshold is reached
    ptrEl.classList.toggle('ptr-ready', pullDist >= PTR_THRESHOLD);
    ptrTriggered = pullDist >= PTR_THRESHOLD;
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (dragState) { ptrStartY = 0; return; }
    if (!ptrStartY) return;
    ptrStartY = 0;

    if (ptrTriggered) {
      // Settle at a fixed reveal height and spin while refreshing
      ptrZone.style.height = `${PTR_MAX_HEIGHT}px`;
      ptrEl.classList.add('ptr-spinning');
      await doRefresh();
    }

    // Collapse the reveal zone back to nothing
    ptrZone.style.height = '0px';
    setTimeout(() => {
      ptrEl.classList.remove('ptr-ready', 'ptr-spinning');
    }, 250);

    ptrTriggered = false;
  }, { passive: true });

  // Dismiss the on-screen keyboard only on an actual manual scroll gesture —
  // not the automatic scroll iOS performs to reveal a newly-focused input
  // above the keyboard (which also fires a native 'scroll' event and was
  // closing the keyboard immediately after opening it).
  document.addEventListener('touchmove', e => {
    const ae = document.activeElement;
    if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName) && e.target !== ae) {
      ae.blur();
    }
  }, { passive: true });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});

// Globals
window.setAuthTab           = setAuthTab;
window.submitAuth           = submitAuth;
window.handleSignOut        = handleSignOut;
window.submitOnboardingKey  = submitOnboardingKey;
window.submitTmdbKey        = submitTmdbKey;
window.switchTab            = switchTab;
window.loadHome             = loadHome;
window.onSearchInput        = onSearchInput;
window.openModal            = openModal;
window.closeModal           = closeModal;
window.addToWL              = addToWL;
window.removeFromWL         = removeFromWL;
window.setStatus            = setStatus;
window.setUserRating        = setUserRating;
window.setAvatar             = setAvatar;
window.openDeleteAccountModal   = openDeleteAccountModal;
window.closeDeleteAccountModal  = closeDeleteAccountModal;
window.onDeleteConfirmInput     = onDeleteConfirmInput;
window.confirmDeleteAccount     = confirmDeleteAccount;
window.renderWatchlist      = renderWatchlist;
window.addYT                = addYT;
window.removeYT             = removeYT;
window.setYTStatus          = setYTStatus;
window.renderSettings       = renderSettings;
window.exportData           = exportData;
window.importData           = importData;
