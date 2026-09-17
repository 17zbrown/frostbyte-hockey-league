#!/usr/bin/env node
/* Post (or re-post) the how-to guides into the two FAQ forums as one thread per guide, each
   carrying the guide's pages inline and the one-file PDF (2026-09-17).
     node tools/discord/post-faq-guides.mjs <dir-with-pages-and-pdfs> [--only lineup,draft]
   Env: DISCORD_BOT_TOKEN plus the forum ids DISCORD_MANAGEMENT_FAQ and DISCORD_PLAYER_FAQ
   (app_config.discord_management_faq_channel_id / discord_player_faq_channel_id — written by
   discord-sync's ensureFaqForums). Runs on the bot VM, where the token lives (/etc/chel-bot.env).
   Re-running for a guide that already has a thread with the same title archives nothing: it posts
   a new thread and reports the old one's id so the office can close it — the guide history stays. */
import fs from "node:fs";
import path from "node:path";
const [dir, ...rest] = process.argv.slice(2);
if (!dir) { console.error("usage: post-faq-guides.mjs <dir> [--only a,b]"); process.exit(2); }
const only = (rest.indexOf("--only") > -1 ? rest[rest.indexOf("--only") + 1] : "").split(",").filter(Boolean);
const BOT = process.env.DISCORD_BOT_TOKEN, MGMT = process.env.DISCORD_MANAGEMENT_FAQ, PLAYER = process.env.DISCORD_PLAYER_FAQ;
if (!BOT || !MGMT || !PLAYER) { console.error("missing DISCORD_BOT_TOKEN / DISCORD_MANAGEMENT_FAQ / DISCORD_PLAYER_FAQ"); process.exit(2); }

const GUIDES = [
  { key: "getting_started", forum: "player", tag: "Getting started", title: "How to sign up to play",
    body: "From Discord sign-in to the draft pool in three boxes — join the server, add your EA ID, register — and what happens at the sign-up cutoff. Rulebook 1.1 · 2.8 · 2.9." },
  { key: "availability", forum: "player", tag: "Availability", title: "How to mark your availability",
    body: "Available or Not Available for each of the week's nine games, in by Wednesday 7:30 PM ET. No weekly quota — but 18 regular-season games to be dressed in the playoffs. Rulebook 5.1 · 5.2 · 8.3." },
  { key: "loadout", forum: "both", tag: "Rules", title: "Banned X-Factors, builds, loadouts and cosmetics",
    body: "Six abilities banned at every tier, two more at Red tier only, no pre-built loadouts, no special-character cosmetics, no enforcer build, builds locked to your position — and what happens if you load in with one. Rulebook 4.5." },
  { key: "lineup", forum: "management", tag: "Lineups", title: "How to set your lineups",
    body: "Three saved lines, the night plan, dressing the week, the per-game page, the 30-minute lock and emergency call-ups — and how the six-game week is counted from the box score. Rulebook 5.2 · 5.3 · 8.3." },
  { key: "tradehub", forum: "management", tag: "Trades", title: "How to make a trade",
    body: "Build an offer, propose it, counter, decline or accept — players for players, live the moment the other club accepts. Rulebook 2.3 · 2.4 · 2.5 · 2.6." },
  { key: "waive", forum: "management", tag: "Waivers", title: "How to waive a player",
    body: "One button on the Roster page: he leaves immediately, his cap hit clears, and any club with room may sign him at the league minimum until the movement deadline. Rulebook 2.2 · 2.4 · 2.5 · 2.6." },
  { key: "draft", forum: "management", tag: "Draft", title: "How to draft your team",
    body: "Rank your board before draft day, pick in one click when your clock runs, the snake order, make-up picks and the public draft room. The draft starts at 9:00 AM ET. Rulebook 2.1 · 2.3 · 2.5 · 2.6 · 2.8." },
];
async function api(method, p, body, headers) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch("https://discord.com/api/v10" + p, { method, headers: { Authorization: "Bot " + BOT, ...(headers || {}) }, body });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 1250 * (i + 1))); continue; }
    const t = await r.text();
    if (!r.ok) throw new Error(method + " " + p + " -> " + r.status + " " + t.slice(0, 200));
    return t ? JSON.parse(t) : null;
  }
  throw new Error("rate limited: " + p);
}
const forums = { management: await api("GET", `/channels/${MGMT}`), player: await api("GET", `/channels/${PLAYER}`) };
const tagId = (forum, name) => ((forums[forum].available_tags || []).find((t) => t.name === name) || {}).id;
const pageFiles = (key) => fs.readdirSync(dir).filter((f) => new RegExp("^" + key + "-\\d+\\.png$").test(f)).sort((a, b) => +a.match(/-(\d+)\.png$/)[1] - +b.match(/-(\d+)\.png$/)[1]).map((f) => path.join(dir, f));
for (const g of GUIDES) {
  if (only.length && !only.includes(g.key)) continue;
  const pages = pageFiles(g.key), pdf = path.join(dir, g.key + ".pdf");
  if (!fs.existsSync(pdf) || !pages.length) { console.log("skip " + g.key + " (no pages/pdf in " + dir + ")"); continue; }
  for (const forum of (g.forum === "both" ? ["player", "management"] : [g.forum])) {
    const chan = forum === "management" ? MGMT : PLAYER;
    const files = [...pages, pdf].slice(0, 10);
    const fd = new FormData();
    const applied = tagId(forum, g.tag) ? [tagId(forum, g.tag)] : [];
    fd.append("payload_json", JSON.stringify({ name: g.title, applied_tags: applied,
      message: { content: g.body + "\n\nThe pages are below; the PDF is the same guide as one scrollable file.",
        attachments: files.map((f, i) => ({ id: i, filename: path.basename(f) })) } }));
    files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([fs.readFileSync(f)], { type: f.endsWith(".pdf") ? "application/pdf" : "image/png" }), path.basename(f)));
    const th = await api("POST", `/channels/${chan}/threads`, fd);
    console.log(`${forum}/${g.key}: thread ${th.id} "${g.title}" (${files.length} files)`);
  }
}
