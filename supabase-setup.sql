-- ══════════════════════════════════════════════════════════════════════════
-- Watchlist app — Supabase database setup
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Profiles table (stores TMDB key per user)
create table if not exists profiles (
  id       uuid primary key references auth.users(id) on delete cascade,
  tmdb_key text
);
alter table profiles enable row level security;
create policy "Users can read own profile"
  on profiles for select using (auth.uid() = id);
create policy "Users can upsert own profile"
  on profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- 2. Watchlist table
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
create policy "Users can manage own watchlist"
  on watchlist for all using (auth.uid() = user_id);

-- 3. YouTube links table
create table if not exists yt_links (
  id        text primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  url       text not null,
  title     text not null,
  status    text not null default 'Want to watch',
  added_at  timestamptz not null default now()
);
alter table yt_links enable row level security;
create policy "Users can manage own yt_links"
  on yt_links for all using (auth.uid() = user_id);
