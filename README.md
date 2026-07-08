# Frostbyte Hockey League

The hub for a competitive 6v6 **EA Sports NHL 27** league — standings, team pages,
player profiles, stats, schedule, playoff bracket, awards, records, news, league
chat, free agency, draft board, a Manager portal, and a Commissioner dashboard.

The entire site is one self-contained **`index.html`** (all CSS + JS inlined). The
only backend piece is a serverless function that reads EA end-of-game screenshots
with a free vision model and returns a structured box score.

> **Data:** the site runs on a live **Supabase** backend (Postgres + Auth + RLS).
> Every public and manager view reads real data — standings, schedule, rosters,
> team pages, stats & leaders, player profiles, transactions, news, free agency,
> bracket, and power rankings — with clean pre-season empty states until games are
> played. Discord OAuth gates the Manager and Commissioner tools. League chat lives
> in Discord.

---

## Deploy it live (GitHub + Netlify)

You'll do this once; after that every `git push` auto-deploys.

### 1. Put it on GitHub
```bash
cd "Frostbyte Hockey League"
git add .
git commit -m "Initial commit"          # (already done for you)
# Create an empty repo at https://github.com/new  (e.g. frostbyte-hockey-league)
git remote add origin https://github.com/<your-username>/frostbyte-hockey-league.git
git branch -M main
git push -u origin main
```

### 2. Connect Netlify
1. Go to <https://app.netlify.com> → **Add new site → Import an existing project**.
2. Pick **GitHub** and select the `frostbyte-hockey-league` repo.
3. Build settings are read from `netlify.toml` — leave the defaults:
   - **Build command:** *(none)*
   - **Publish directory:** `.`
   - **Functions directory:** `netlify/functions`
4. Click **Deploy**. You get a live URL like `https://<name>.netlify.app`.

### 3. (Optional) Turn on live AI screenshot reading
Without keys the screenshot import runs in **demo mode** — everything else works.
To read real screenshots:
1. Get a free key — Gemini: <https://aistudio.google.com/apikey> (no credit card).
2. In Netlify: **Site settings → Environment variables → Add** `GEMINI_API_KEY`.
3. Redeploy (**Deploys → Trigger deploy**). Optionally add `GROQ_API_KEY` as a fallback.

That's it — the site is public.

---

## Run locally

```bash
# static only (no AI): just open index.html in a browser, or:
python3 -m http.server 8000

# with the AI endpoint (mimics production):
GEMINI_API_KEY=... node server.js       # → http://localhost:4600
```

`server.js` is the local dev server; in production the same logic runs as the
Netlify function in `netlify/functions/parse-screenshots.js`. Both expose
`POST /api/parse-screenshots` and return the same `{ teams: [...] }` shape.

---

## Project structure

```
index.html                         the entire site (HTML + CSS + JS)
server.js                          local dev server (static + /api/parse-screenshots)
netlify/functions/
  parse-screenshots.js             production serverless function (same logic)
netlify.toml                       Netlify config + /api route + security headers
.env.example                       which env vars to set
```

---

## Roadmap — from demo to production

- [x] **Deploy the static build** (GitHub + Netlify)
- [x] **Supabase project** (Postgres + Auth + RLS)
- [x] **Auth** (Discord OAuth) + roles (member / GM / commissioner)
- [x] **Schema** — profiles, seasons, teams, roster_spots, season_registrations,
      trades, transactions, games, player_season_stats, news, app_config (all with RLS)
- [x] **Wire reads** (standings, schedule, rosters, team pages, stats & leaders,
      profiles, transactions, news, free agency, bracket, rankings from the DB)
- [x] **Writes** — registration → roster spot (+ jersey), trades (mutual accept),
      commissioner scheduler/scores, news publishing
- [ ] Game-report box scores + screenshot uploads to Supabase Storage
      (needs `game_reports` / `box_score_entries` tables — commissioner scores are
      the live stat path today)
- [ ] Playoff bracket results model + awards/records tracking
- [ ] Deadline automation (pg_cron) + more Discord automation

---

*Not affiliated with the NHL or EA Sports.*
