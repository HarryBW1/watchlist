'use strict';
// ── Auth module ────────────────────────────────────────────────────────────
// Wraps Supabase auth and exposes a simple interface to the rest of the app.

let _sb = null;  // Supabase client, initialised on DOMContentLoaded

function initSupabase() {
  const { url, anon } = window.SB_CONFIG;
  if (!url || url === 'YOUR_SUPABASE_URL') {
    console.warn('Supabase not configured — see js/supabase-config.js');
    return false;
  }
  _sb = window.supabase.createClient(url, anon);
  return true;
}

function sbClient() { return _sb; }

// ── Auth actions ───────────────────────────────────────────────────────────
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

async function getSession() {
  const { data } = await _sb.auth.getSession();
  return data?.session ?? null;
}

async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

// Listen for auth state changes (login / logout / token refresh)
function onAuthChange(callback) {
  if (!_sb) return;
  _sb.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

window.Auth = { initSupabase, sbClient, signUp, signIn, signOut, getSession, getUser, onAuthChange };
