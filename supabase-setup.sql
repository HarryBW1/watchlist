-- ══════════════════════════════════════════════════════════════════════════
-- Watchlist app — Supabase database setup
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Profiles table (stores TMDB key per user) ──────────────────────────
create table if not exists profiles (
  id       uuid primary key references auth.users(id) on delete cascade,
  tmdb_key text
);
alter table profiles enable row level security;

-- Drop existing policies if re-running this script
drop policy if exists "Users can read own profile"   on profiles;
drop policy if exists "Users can upsert own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;
drop policy if exists "Users manage own profile"     on profiles;

create policy "Users manage own profile"
  on profiles for all using (auth.uid() = id) with check (auth.uid() = id);

-- ── 2. Auto-create a profile row when a new user signs up ─────────────────
-- This means DB.loadProfile() will always find a row (with tmdb_key = null)
-- rather than returning null, which avoids an extra upsert on first login.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, tmdb_key)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 3. Watchlist table ────────────────────────────────────────────────────
create table if not exists watchlist (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  tmdb_id       integer not null,
  media_type    text not null,
  title         text not null,
  year          text,
  overview      text,
  poster_path   text,
  backdrop_path text,
  rating        text,
  genres        text[],
  runtime       integer,
  seasons       integer,
  provider_ids  integer[],
  status        text not null default 'Want to watch',
  added_at      timestamptz not null default now(),
  unique (user_id, tmdb_id)
);
alter table watchlist enable row level security;
drop policy if exists "Users can manage own watchlist" on watchlist;
drop policy if exists "Users manage own watchlist"     on watchlist;
create policy "Users manage own watchlist"
  on watchlist for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 4. YouTube links table ────────────────────────────────────────────────
create table if not exists yt_links (
  id        text primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  url       text not null,
  title     text not null,
  thumbnail_url text,
  video_id      text,
  status    text not null default 'Want to watch',
  added_at  timestamptz not null default now()
);
alter table yt_links enable row level security;
drop policy if exists "Users can manage own yt_links" on yt_links;
drop policy if exists "Users manage own yt_links"     on yt_links;
create policy "Users manage own yt_links"
  on yt_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
