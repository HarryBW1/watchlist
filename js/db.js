'use strict';
// ── Database module ────────────────────────────────────────────────────────

function sb() { return Auth.sbClient(); }

// ── Profile / TMDB key ─────────────────────────────────────────────────────
async function loadProfile(userId) {
  const { data, error } = await sb()
    .from('profiles')
    .select('tmdb_key')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data; // { tmdb_key } or null
}

async function saveProfile(userId, tmdbKey) {
  const { error } = await sb()
    .from('profiles')
    .upsert({ id: userId, tmdb_key: tmdbKey }, { onConflict: 'id' });
  if (error) throw error;
}

// ── Watchlist ──────────────────────────────────────────────────────────────
async function loadWatchlist(userId) {
  const { data, error } = await sb()
    .from('watchlist')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({
    tmdbId:       row.tmdb_id,
    mediaType:    row.media_type,
    title:        row.title,
    year:         row.year,
    overview:     row.overview,
    posterPath:   row.poster_path,
    backdropPath: row.backdrop_path,
    rating:       row.rating,
    genres:       row.genres || [],
    runtime:      row.runtime,
    seasons:      row.seasons,
    providerIds:  row.provider_ids || [],
    status:       row.status,
    addedAt:      new Date(row.added_at).getTime(),
  }));
}

async function upsertWatchlistItem(userId, item) {
  const { error } = await sb()
    .from('watchlist')
    .upsert({
      user_id:       userId,
      tmdb_id:       item.tmdbId,
      media_type:    item.mediaType,
      title:         item.title,
      year:          item.year,
      overview:      item.overview,
      poster_path:   item.posterPath,
      backdrop_path: item.backdropPath,
      rating:        item.rating,
      genres:        item.genres,
      runtime:       item.runtime,
      seasons:       item.seasons,
      provider_ids:  item.providerIds,
      status:        item.status,
      added_at:      new Date(item.addedAt).toISOString(),
    }, { onConflict: 'user_id,tmdb_id' });
  if (error) throw error;
}

async function deleteWatchlistItem(userId, tmdbId) {
  const { error } = await sb()
    .from('watchlist').delete()
    .eq('user_id', userId).eq('tmdb_id', tmdbId);
  if (error) throw error;
}

async function updateWatchlistStatus(userId, tmdbId, status) {
  const { error } = await sb()
    .from('watchlist').update({ status })
    .eq('user_id', userId).eq('tmdb_id', tmdbId);
  if (error) throw error;
}

// ── YouTube links ──────────────────────────────────────────────────────────
async function loadYTLinks(userId) {
  const { data, error } = await sb()
    .from('yt_links')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({
    id:           row.id,
    url:          row.url,
    title:        row.title,
    thumbnailUrl: row.thumbnail_url || null,
    videoId:      row.video_id      || null,
    status:       row.status,
    addedAt:      new Date(row.added_at).getTime(),
  }));
}

async function upsertYTLink(userId, link) {
  const payload = {
    id:            link.id,
    user_id:       userId,
    url:           link.url,
    title:         link.title,
    thumbnail_url: link.thumbnailUrl || null,
    video_id:      link.videoId      || null,
    status:        link.status,
    added_at:      new Date(link.addedAt).toISOString(),
  };
  let { error } = await sb().from('yt_links').upsert(payload, { onConflict: 'id' });

  // Fallback: older yt_links tables created before thumbnail_url/video_id existed.
  // Retry without those columns so the save still succeeds.
  if (error && /column .*(thumbnail_url|video_id)/i.test(error.message || '')) {
    const { thumbnail_url, video_id, ...legacyPayload } = payload;
    const retry = await sb().from('yt_links').upsert(legacyPayload, { onConflict: 'id' });
    error = retry.error;
  }

  if (error) throw error;
}

async function deleteYTLink(userId, id) {
  const { error } = await sb()
    .from('yt_links').delete()
    .eq('user_id', userId).eq('id', id);
  if (error) throw error;
}

async function updateYTStatus(userId, id, status) {
  const { error } = await sb()
    .from('yt_links').update({ status })
    .eq('user_id', userId).eq('id', id);
  if (error) throw error;
}

window.DB = {
  loadProfile, saveProfile,
  loadWatchlist, upsertWatchlistItem, deleteWatchlistItem, updateWatchlistStatus,
  loadYTLinks, upsertYTLink, deleteYTLink, updateYTStatus,
};
