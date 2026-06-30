'use strict';
// ── Auth module ────────────────────────────────────────────────────────────

let _sb = null;

function initSupabase() {
  // Guard: supabase JS must be loaded
  if (typeof window.supabase === 'undefined') {
    console.error('Supabase JS library not loaded');
    return false;
  }
  const cfg = window.SB_CONFIG || {};
  if (!cfg.url || cfg.url === 'YOUR_SUPABASE_URL' ||
      !cfg.anon || cfg.anon === 'YOUR_SUPABASE_ANON_KEY') {
    return false; // caller will show config error
  }
  try {
    _sb = window.supabase.createClient(cfg.url, cfg.anon, {
      auth: {
        persistSession:   true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }
    });
    return true;
  } catch (e) {
    console.error('Supabase init failed:', e);
    return false;
  }
}

function isConfigured() {
  const cfg = window.SB_CONFIG || {};
  return !!(cfg.url && cfg.url !== 'YOUR_SUPABASE_URL' &&
            cfg.anon && cfg.anon !== 'YOUR_SUPABASE_ANON_KEY');
}

function sbClient() { return _sb; }

async function signUp(email, password) {
  const { data, error } = await _sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  const { data, error } = await _sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  const { error } = await _sb.auth.signOut();
  if (error) throw error;
}

async function getUser() {
  try {
    // getUser() hits the Supabase server — use getSession() for local check first
    const { data: sessionData } = await _sb.auth.getSession();
    return sessionData?.session?.user ?? null;
  } catch {
    return null;
  }
}

function onAuthChange(callback) {
  if (!_sb) return;
  _sb.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

window.Auth = { initSupabase, isConfigured, sbClient, signUp, signIn, signOut, getUser, onAuthChange };
