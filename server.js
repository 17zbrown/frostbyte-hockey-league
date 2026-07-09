// Chel Gaming Hockey League — local server (FREE vision backend, with fallback)
// Serves the static site AND exposes POST /api/parse-screenshots, which sends
// uploaded EA NHL end-of-game screenshots to a vision model and returns a
// structured box score. Two free providers are tried in order for redundancy:
//   1. Google Gemini  (GEMINI_API_KEY)  — https://aistudio.google.com/apikey
//   2. Groq / Llama    (GROQ_API_KEY)    — https://console.groq.com/keys
// If the first is missing/erroring/rate-limited, it falls through to the next.
// Run with either or both keys set:  GEMINI_API_KEY=... GROQ_API_KEY=... node server.js
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4600;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// ---- The structured box score the model must return (Gemini responseSchema) ----
const SKATER = { type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    position: { type: "STRING", description: "C, LW, RW, LD, RD, W, D, or F" },
    goals: { type: "INTEGER" }, assists: { type: "INTEGER" },
    shots: { type: "INTEGER" }, hits: { type: "INTEGER" }, pim: { type: "INTEGER" } },
  required: ["name", "position", "goals", "assists", "shots", "hits", "pim"] };
const GOALIE = { type: "OBJECT",
  properties: { name: { type: "STRING" }, saves: { type: "INTEGER" },
    shotsAgainst: { type: "INTEGER" }, goalsAgainst: { type: "INTEGER" } },
  required: ["name", "saves", "shotsAgainst", "goalsAgainst"] };
const SCHEMA = { type: "OBJECT",
  properties: { teams: { type: "ARRAY", items: { type: "OBJECT",
    properties: { name: { type: "STRING" }, goals: { type: "INTEGER" },
      skaters: { type: "ARRAY", items: SKATER }, goalie: GOALIE },
    required: ["name", "goals", "skaters", "goalie"] } } },
  required: ["teams"] };

const PROMPT = `These are screenshots of the END OF GAME / PLAYER SUMMARY screens from EA Sports NHL (competitive 6v6 club hockey). Read them carefully and extract the full box score for BOTH teams.

For each team return: its name, its total goals, up to 6 skaters (forwards + defense) each with goals (G), assists (A), shots (S), hits (HIT) and penalty minutes (PIM), and its starting goalie with saves (SV), shots against, and goals against (GA).

Notes:
- Combine data across every screenshot provided (the offense page, the shots/hits/PIM page, and the goalie rows may be on different screens).
- Where both a gamertag and an in-game PLAYER NAME are shown, use the PLAYER NAME.
- If a stat is not visible for a player, use 0.
- Return exactly two teams, in the order they appear on screen (top team first).`;

// Groq speaks OpenAI's chat format and JSON-object mode (no schema param), so the
// exact shape is spelled out in the prompt for it.
const JSON_SHAPE = `Return ONLY a JSON object of exactly this shape (no prose, no markdown):
{"teams":[{"name":string,"goals":integer,"skaters":[{"name":string,"position":string,"goals":integer,"assists":integer,"shots":integer,"hits":integer,"pim":integer}],"goalie":{"name":string,"saves":integer,"shotsAgainst":integer,"goalsAgainst":integer}}]}
Exactly two teams, top team first, up to 6 skaters each.`;

function validImages(images) {
  images.forEach((dataUrl) => {
    if (!/^data:image\/[a-zA-Z+]+;base64,/.test(dataUrl))
      throw Object.assign(new Error("Invalid image data."), { status: 400 });
  });
  return images;
}

// ---- Provider 1: Google Gemini (native responseSchema) ----
async function parseWithGemini(images) {
  const parts = images.map((dataUrl) => {
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(dataUrl);
    return { inline_data: { mime_type: m[1], data: m[2] } };
  });
  parts.push({ text: PROMPT });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ?? "{}";
  return JSON.parse(text);
}

// ---- Provider 2: Groq / Llama vision (OpenAI-compatible, JSON-object mode) ----
async function parseWithGroq(images) {
  const content = images.slice(0, 5).map((url) => ({ type: "image_url", image_url: { url } }));
  content.push({ type: "text", text: `${PROMPT}\n\n${JSON_SHAPE}` });
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data?.choices?.[0]?.message?.content ?? "{}");
}

const PROVIDERS = [
  { name: "Gemini", key: GEMINI_KEY, run: parseWithGemini },
  { name: "Groq", key: GROQ_KEY, run: parseWithGroq },
];

async function parseScreenshots(images) {
  validImages(images);
  const enabled = PROVIDERS.filter((p) => p.key);
  if (!enabled.length)
    throw Object.assign(new Error("No vision provider configured. Set GEMINI_API_KEY and/or GROQ_API_KEY."), { status: 501 });
  const errors = [];
  for (const p of enabled) {
    try {
      const data = await p.run(images);
      if (!data || !Array.isArray(data.teams) || !data.teams.length) throw new Error("empty result");
      data._provider = p.name;
      return data;
    } catch (e) {
      errors.push(`${p.name}: ${e.message}`);
      console.warn(`  ! ${p.name} failed — ${e.message}`);
    }
  }
  throw Object.assign(new Error(`All providers failed. ${errors.join(" | ")}`), { status: 502 });
}

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error("Payload too large."), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // ---- API ----
  if (req.method === "POST" && req.url === "/api/parse-screenshots") {
    try {
      const { images } = JSON.parse(await readBody(req) || "{}");
      if (!Array.isArray(images) || !images.length) throw Object.assign(new Error("No images provided."), { status: 400 });
      const data = await parseScreenshots(images.slice(0, 6));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(e.status || 500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message || "Parse failed." }));
    }
    return;
  }
  // ---- static files ----
  try {
    let path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (path === "/") path = "/index.html";
    const full = normalize(join(__dirname, path));
    if (!full.startsWith(__dirname)) { res.writeHead(403); res.end("Forbidden"); return; }
    const body = await readFile(full);
    res.writeHead(200, { "content-type": MIME[extname(full)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found");
  }
});

server.listen(PORT, () => {
  const active = PROVIDERS.filter((p) => p.key).map((p) => p.name);
  const line = active.length
    ? `✓ Vision providers (in order): ${active.join(" → ")}`
    : "✗ No provider key set (GEMINI_API_KEY / GROQ_API_KEY) — screenshot scanning will use the built-in demo";
  console.log(`\n  Chel Gaming Hockey League  →  http://localhost:${PORT}\n  ${line}\n`);
});
