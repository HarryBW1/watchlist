'use strict';
// ── State ──────────────────────────────────────────────────────────────────
let currentUser    = null;
let watchlist      = [];
let ytLinks        = [];
let activeTab      = 'home';
let searchDebounce = null;
let currentModal   = null;
let homeLoaded     = false;

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
  const wlTotal = watchlist.length;
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
  setAuthTab('signup');
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
    container.innerHTML = `
      ${homeSection('🔥 Trending this week',  trending.slice(0, 12))}
      ${homeSection('🎬 In cinemas now',       nowPlaying.slice(0, 10))}
      ${homeSection('📺 Series on air',        onAir.slice(0, 10))}
      ${homeSection('🎥 Popular films',        popularMovies.slice(0, 10))}
      ${homeSection('📡 Popular series',       popularTV.slice(0, 10))}
    `;
    homeLoaded = true;
  } catch {
    container.innerHTML = `<div class="empty-state">
      <i class="ti ti-wifi-off"></i>
      <p>Couldn't load content.<br><button class="link-btn" onclick="loadHome()">Try again</button></p>
    </div>`;
  }
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
  searchDebounce = setTimeout(() => doSearch(q), 400);
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
  } catch {
    modal.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">
      <p>Couldn't load details.</p>
      <button onclick="closeModal()" class="primary-btn" style="margin-top:12px">Close</button></div>`;
  }
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
    providerIds:  providers.map(p => p.provider_id),
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
  const item = { ...currentModal, addedAt: Date.now() };
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
function renderWatchlist() {
  const stFilter   = document.getElementById('wl-st').value;
  const pfFilter   = document.getElementById('wl-pf').value;
  const typeFilter = document.getElementById('wl-type').value;   // 'all' | 'movie' | 'tv'
  const grid       = document.getElementById('wl-grid');

  const provLookup = {};
  TMDB.PROVIDER_LIST.forEach(p => { provLookup[p.name] = p.id; });

  const total    = watchlist.length;
  const watching = watchlist.filter(w => w.status === 'Watching').length;
  const finished = watchlist.filter(w => w.status === 'Finished').length;
  const want     = watchlist.filter(w => w.status === 'Want to watch').length;
  document.getElementById('wl-stats').innerHTML = `
    <div class="stat"><span class="stat-n">${total}</span><span class="stat-l">Total</span></div>
    <div class="stat"><span class="stat-n">${want}</span><span class="stat-l">To watch</span></div>
    <div class="stat"><span class="stat-n">${watching}</span><span class="stat-l">Watching</span></div>
    <div class="stat"><span class="stat-n">${finished}</span><span class="stat-l">Finished</span></div>`;

  const filtered = watchlist.filter(w => {
    const matchStatus   = stFilter   === 'all' || w.status    === stFilter;
    const matchType     = typeFilter === 'all' || w.mediaType === typeFilter;
    const matchPlatform = pfFilter   === 'all' || (() => {
      if (pfFilter === 'HBO Max Amazon Channel') return [1899,384].some(id => (w.providerIds||[]).includes(id));
      if (pfFilter === 'BBC iPlayer')            return [38,39].some(id => (w.providerIds||[]).includes(id));
      const pid = provLookup[pfFilter];
      return pid != null && (w.providerIds||[]).includes(pid);
    })();
    return matchStatus && matchType && matchPlatform;
  });

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <i class="ti ti-bookmark-off"></i>
      <p>${watchlist.length ? 'No items match your filters.' : 'Your watchlist is empty.<br>Browse the home page or search to add titles.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(w => {
    const poster = TMDB.posterUrl(w.posterPath, 'w342');
    const kind   = w.mediaType === 'movie' ? 'Film' : 'Series';
    return `<div class="wl-card" data-tmdb="${w.tmdbId}">
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
      </div>
    </div>`;
  }).join('');
}

async function setStatus(tmdbId, status) {
  const item = watchlist.find(w => w.tmdbId === tmdbId);
  if (!item) return;
  item.status = status;

  const activeFilter = document.getElementById('wl-st').value;
  if (activeFilter !== 'all') {
    // A status filter is active — re-render so the item moves out of view immediately
    setTimeout(renderWatchlist, 0);
  } else {
    // No filter — just update the badge in-place, no DOM teardown needed
    const card = document.querySelector(`.wl-card[data-tmdb="${tmdbId}"]`);
    if (card) {
      const badge = card.querySelector('.status-badge');
      if (badge) badge.outerHTML = statusBadge(status);
    }
  }

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

function renderSettings() {
  const el = document.getElementById('settings-email');
  if (el && currentUser) el.textContent = currentUser.email;
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
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
  setAuthTab('signup');
  showScreen('loading-screen');
  document.getElementById('loading-label').textContent = 'Checking session…';

  // Keyboard shortcuts
  document.getElementById('auth-email')       .addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
  document.getElementById('auth-password')    .addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
  document.getElementById('onboarding-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitOnboardingKey(); });
  document.getElementById('yt-url')           .addEventListener('keydown', e => { if (e.key === 'Enter') addYT(); });
  document.getElementById('yt-title')         .addEventListener('keydown', e => { if (e.key === 'Enter') addYT(); });
  document.getElementById('s-input')          .addEventListener('keydown', e => {
    if (e.key === 'Escape') { document.getElementById('s-input').value = ''; resetSearch(); }
  });
  document.getElementById('modal-backdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-backdrop')) closeModal();
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
  let ptrStartY    = 0;
  let ptrTriggered = false;
  const PTR_THRESHOLD = 80; // px of pull needed to trigger

  const ptrEl = document.getElementById('ptr-indicator');

  document.addEventListener('touchstart', e => {
    // Only start tracking if already scrolled to the very top
    if (window.scrollY === 0) ptrStartY = e.touches[0].clientY;
    else ptrStartY = 0;
    ptrTriggered = false;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!ptrStartY) return;
    const pullDist = e.touches[0].clientY - ptrStartY;
    if (pullDist <= 0) return;

    const clamped = Math.min(pullDist, PTR_THRESHOLD * 1.5);
    const progress = Math.min(pullDist / PTR_THRESHOLD, 1);

    // Show and move the indicator down as user pulls
    ptrEl.style.transform = `translateX(-50%) translateY(${clamped * 0.5}px)`;
    ptrEl.style.opacity   = String(progress);
    ptrEl.style.display   = 'flex';

    // Spin once threshold is reached
    ptrEl.classList.toggle('ptr-ready', pullDist >= PTR_THRESHOLD);
    ptrTriggered = pullDist >= PTR_THRESHOLD;
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (!ptrStartY) return;
    ptrStartY = 0;

    if (ptrTriggered) {
      // Snap indicator to settled position and spin while refreshing
      ptrEl.style.transform = 'translateX(-50%) translateY(20px)';
      ptrEl.classList.add('ptr-spinning');
      await doRefresh();
    }

    // Hide indicator
    ptrEl.style.opacity   = '0';
    ptrEl.style.transform = 'translateX(-50%) translateY(-40px)';
    setTimeout(() => {
      ptrEl.style.display = 'none';
      ptrEl.classList.remove('ptr-ready', 'ptr-spinning');
    }, 300);

    ptrTriggered = false;
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
window.renderWatchlist      = renderWatchlist;
window.addYT                = addYT;
window.removeYT             = removeYT;
window.setYTStatus          = setYTStatus;
window.renderSettings       = renderSettings;
