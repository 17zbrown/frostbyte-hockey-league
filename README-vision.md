# Frostbyte Hockey League — Free AI Screenshot Import

Managers drop their EA NHL end-of-game **Player Summary** screenshots into a game
report, an AI vision model reads the box score, and every skater and goalie for
both clubs auto-fills. Then the GM just reviews and submits.

## Two free providers, with automatic fallback

For redundancy the server tries two **free** vision providers in order:

1. **Google Gemini** (`GEMINI_API_KEY`) — best OCR quality, primary.
2. **Groq / Llama** (`GROQ_API_KEY`) — fast fallback.

If the primary is missing, rate-limited, or erroring, the request **falls through**
to the next. Set one or both. Both keys are free with **no credit card**. The
server calls them over plain HTTPS, so there are **zero npm dependencies** (Node
18+ has `fetch` built in — nothing to `npm install`).

## How it works

```
Browser (index.html)            Node server (server.js)           Vision provider
────────────────────            ───────────────────────           ───────────────
drop screenshots
  → base64 data URLs  ─ POST ─▶ /api/parse-screenshots
                               1) try Gemini  ─────────── ▶  reads images → strict JSON
                               2) if it fails, try Groq ─ ▶  (fallback)
  auto-fills form + ◀─ JSON ── returns { teams:[...], _provider }
  "read by Gemini"
```

Keys live **only on the server** — they are never shipped to the browser. The
response tells the UI which provider read it (shown as "· read by Gemini").

## Run it

Requires **Node 18+**. No install step.

```bash
cd "Frostbyte Hockey League"
GEMINI_API_KEY=... GROQ_API_KEY=... npm start     # either or both
```

Then open **http://localhost:4600** → Manager Portal → **Game Reports**, expand a
pending game, and drop your screenshots into the **Import from EA screenshots**
panel.

### Get the free keys (1 minute each, no credit card)

- **Gemini:** https://aistudio.google.com/apikey → sign in with Google → *Create API key*.
- **Groq:** https://console.groq.com/keys → sign in → *Create API Key*.

## No key? Demo mode still works.

If the server isn't running or no provider key is set, the upload UI falls back to
a **simulated scan** so you can see the full experience. It reads the game's known
result instead of the image, and labels itself "demo scan." Add a key to switch on
live screenshot reading.

## Notes

- Gemini uses a strict `responseSchema`; Groq uses JSON-object mode with the shape
  spelled out in the prompt. Either way the response is a valid two-team box score.
- Override models with `GEMINI_MODEL` (e.g. `gemini-2.5-flash`) or `GROQ_MODEL`
  (e.g. `meta-llama/llama-4-maverick-17b-128e-instruct`).
- Up to 6 screenshots per game (Groq takes the first 5).
- The rest of the site is still the single self-contained `index.html`; this server
  just adds the one `/api/parse-screenshots` endpoint and serves the file.
- Adding a third provider is one more `{ name, key, run }` entry in the `PROVIDERS`
  array in `server.js`; the browser contract (`{ teams: [...] }`) never changes.
