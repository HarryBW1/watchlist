'use strict';
// ── YouTube oEmbed helper ──────────────────────────────────────────────────
// Fetches title and thumbnail from YouTube's free oEmbed endpoint.
// No API key required. Works for public videos.

const YT_OEMBED = 'https://www.youtube-nocookie.com/oembed';

/**
 * Given a YouTube URL, returns { title, thumbnailUrl, videoId } or null on failure.
 */
async function fetchYTMeta(url) {
  try {
    const videoId = extractVideoId(url);
    if (!videoId) return null;

    const endpoint = `${YT_OEMBED}?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`;
    const res = await fetch(endpoint);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title:        data.title || null,
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      videoId,
    };
  } catch {
    return null;
  }
}

function extractVideoId(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    // youtube.com/watch?v=ID
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    // youtu.be/ID
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split(/[?&]/)[0];
    // youtube.com/embed/ID or youtube.com/shorts/ID
    const parts = u.pathname.split('/').filter(Boolean);
    if (['embed', 'shorts', 'v'].includes(parts[0]) && parts[1]) return parts[1];
    return null;
  } catch {
    return null;
  }
}

window.YouTube = { fetchYTMeta, extractVideoId };
