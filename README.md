# 📺 Watchlist

A personal streaming watchlist PWA. Search any film or series via **The Movie Database (TMDB)** — real posters, descriptions, ratings, and streaming provider info load automatically. Save anything to your watchlist and track your progress. Add YouTube links too. Works offline and installs as a home screen app on iPhone and iPad.

---

## Features

- 🔍 Live search powered by TMDB — every film and series ever made
- 🖼 Real posters, backdrops, descriptions, ratings & genres
- 📡 Shows which streaming platform each title is on (Netflix, Disney+, HBO Max, Paramount+, Prime Video)
- 🔖 Personal watchlist with status tracking (Want to watch / Watching / Finished / Dropped)
- 📺 YouTube tab — paste links and track them
- 💾 All data saved in your browser — no account needed
- 📱 Installable on iPhone, iPad, and Android as a full-screen app
- ✈️ Works offline after first load (TMDB searches require a connection)

---

## Setup — TMDB API Key (free, 2 minutes)

The app uses TMDB's free API to search shows and fetch posters.

1. Go to [themoviedb.org](https://www.themoviedb.org) and create a free account
2. Go to **Settings → API → Create → Developer**
3. Fill in the form (use "Personal" for use case, any URL for the site field)
4. Copy your **API Key (v3 auth)**
5. Open the app, paste the key into the setup box, and hit **Save key**

Your key is stored in your browser and never leaves your device.

---

## Deploy to GitHub Pages (free hosting)

### 1. Create a GitHub repository

1. Go to [github.com](https://github.com) → **New repository**
2. Name it `watchlist`, set to **Public**, click **Create**

### 2. Upload the files

**Via GitHub web UI (easiest):**
1. Open your new repo → **Add file → Upload files**
2. Drag in the entire contents of this folder
3. Click **Commit changes**

**Via Git CLI:**
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/watchlist.git
git push -u origin main
```

### 3. Enable GitHub Pages

1. Repo → **Settings → Pages**
2. Source: **Deploy from a branch** → **main** / **root**
3. Click **Save** — live in ~60 seconds at:
   `https://YOUR_USERNAME.github.io/watchlist/`

---

## Add to iPhone / iPad home screen

1. Open the GitHub Pages URL in **Safari**
2. Tap the **Share button** (box with arrow)
3. Tap **Add to Home Screen**
4. Name it **Watchlist** → tap **Add**

It installs as a full-screen app with no browser chrome.

---

## File structure

```
watchlist/
├── index.html          # Main app shell
├── manifest.json       # PWA config
├── sw.js               # Service worker (offline support)
├── css/
│   └── style.css       # All styles — dark cinema theme
├── js/
│   ├── tmdb.js         # TMDB API wrapper
│   └── app.js          # App logic
└── icons/
    ├── icon-180.png    # iOS home screen icon
    ├── icon-192.png    # Android / PWA icon
    └── icon-512.png    # Splash icon
```

---

## Changing the streaming region

By default the app shows UK streaming providers. To change to your country, open `js/tmdb.js` and update:

```js
const REGION = 'GB'; // → 'US', 'AU', 'CA', 'DE', etc.
```

Use any [ISO 3166-1](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) two-letter country code.

---

## Tech

Plain HTML, CSS, and vanilla JavaScript. No build tools, no frameworks, no npm. Deployable to any static host.
