# 📺 Watchlist

A personal streaming watchlist PWA with **cloud sync and login**. Search any film or series via TMDB, save to your watchlist, and access it from any device — iPhone, iPad, desktop — with everything synced instantly.

---

## Features

- 🔐 **Account login** - email/password, data synced across all your devices
- 🔍 **Live TMDB search** - every film and series ever made
- 🖼 **Posters, backdrops, descriptions, ratings, genres**
- 📡 **Streaming providers** - see which platform each title is on
- 🔖 **Watchlist** with status tracking (Want to watch / Watching / Finished / Dropped)
- 📺 **YouTube tab** - save and track YouTube links
- 📱 **Installs on iPhone/iPad** as a full-screen home screen app
- ✈️ Works offline after first load

---

## Setup (one-time, ~10 minutes)

You need two free services: **Supabase** (auth + database) and **TMDB** (film data).

---

### Step 1 — Supabase (auth + database)

1. Go to [supabase.com](https://supabase.com) → **Start for free** → create an account
2. Click **New project**, give it a name (e.g. "watchlist"), set a database password, click **Create**
3. Wait ~1 minute for it to provision
4. Go to **SQL Editor** → **New query**, paste the contents of `supabase-setup.sql`, click **Run**
5. Go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key (long string starting with `eyJ…`)
6. Open `js/supabase-config.js` and replace the placeholders:

```js
const SUPABASE_URL  = 'https://xxxx.supabase.co';   // ← your Project URL
const SUPABASE_ANON = 'eyJ…';                        // ← your anon public key
```

7. In Supabase dashboard → **Authentication → URL Configuration**, add your GitHub Pages URL to **Site URL** and **Redirect URLs** (e.g. `https://YOUR_USERNAME.github.io`)

---

### Step 2 — TMDB API key

1. Go to [themoviedb.org](https://www.themoviedb.org) → create a free account
2. **Settings → API → Create → Developer**
3. Fill in the form (use "Personal" and any URL)
4. Copy the **API Key (v3 auth)**
5. You'll paste this into the app after logging in — it saves to your account automatically

---

### Step 3 — Deploy to GitHub Pages

1. Create a new **public** GitHub repo (e.g. `watchlist`)
2. Upload all files (drag & drop in the GitHub UI or use Git CLI)
3. **Settings → Pages → Deploy from branch → main / root → Save**
4. Your app is live at `https://YOUR_USERNAME.github.io/watchlist/`

---

### Step 4 — Add to iPhone / iPad home screen

1. Open your GitHub Pages URL in **Safari**
2. Tap the **Share button** → **Add to Home Screen** → **Add**

Done — full-screen app with no browser chrome, synced to your account.

---

## File structure

```
watchlist/
├── index.html              # App shell (auth + all tabs)
├── manifest.json           # PWA config
├── sw.js                   # Service worker
├── supabase-setup.sql      # Run once in Supabase SQL editor
├── css/
│   └── style.css
├── js/
│   ├── supabase-config.js  # ← PUT YOUR KEYS HERE
│   ├── tmdb.js             # TMDB API wrapper
│   ├── auth.js             # Supabase auth module
│   ├── db.js               # Database operations
│   └── app.js              # Main app logic
└── icons/
    ├── icon-180.png
    ├── icon-192.png
    └── icon-512.png
```

---

## Changing streaming region

Open `js/tmdb.js` and update:

```js
const REGION = 'GB'; // → 'US', 'AU', 'CA', 'DE', etc.
```

---

## Tech

Plain HTML, CSS, vanilla JS. [Supabase](https://supabase.com) for auth and database. [TMDB](https://themoviedb.org) for film data. No build tools, no frameworks.
