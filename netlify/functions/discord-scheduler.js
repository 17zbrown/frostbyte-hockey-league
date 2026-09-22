// Netlify Scheduled Function — time-based Discord posts (runs every 5 min, gated to America/New_York,
// de-duped so nothing ever double-posts across the 5-min cadence).
//   (A) #schedule  — Tuesdays 5:00pm ET: the week's slate + 3 featured matchups.
//   (B) #standings — Friday nights, once every game that week is final: a standings snapshot.
//   (C) team private channels — ~30 min before a club's first game of the night: their matchups.
//
// De-dupe: each one-shot post claims a row in public.discord_post_log (unique kind+ref); only the
// first claimant posts. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_BOT_TOKEN. Node 18+.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const config = { schedule: "*/5 * * * *" };

/* this file is ESM ("type":"module"), so there is no require() or __dirname at runtime */
const HERE = path.dirname(fileURLToPath(import.meta.url));

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;   // only the #rules mirror needs it (it resolves the channel by name)
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${(await r.text()).slice(0, 140)}`);
  return r.json();
}
// Claim a one-shot post; true only for the first caller (unique PK -> 409 for the rest).
async function claim(kind, ref) {
  const r = await fetch(`${SB_URL}/rest/v1/discord_post_log`, {
    method: "POST", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify({ kind, ref }),
  });
  if (r.status === 201) return true;
  if (r.status === 409) return false;
  console.error(`claim ${kind}/${ref} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
  return false; // on any other error, stay safe and don't post
}
// Hand a one-shot claim back so the next tick can retry. Only call this when Discord PROVABLY
// never took the message (non-2xx, or 429s we gave up on) — a transport error is ambiguous, the
// message may well have landed, and releasing on those would double-post.
async function release(kind, ref) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/discord_post_log?kind=eq.${encodeURIComponent(kind)}&ref=eq.${encodeURIComponent(ref)}`,
      { method: "DELETE", headers: { ...sbHead(), Prefer: "return=minimal" } });
    if (!r.ok) console.error(`release ${kind}/${ref} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
  } catch (e) { console.error(`release ${kind}/${ref} -> ${String(e.message || e)}`); }
}
// The single choke point for every Discord delivery, so it is also the only place that decides
// what "delivered" means. Always resolves to an outcome object — never undefined, never a raw
// Response — so an exhausted retry loop can't be mistaken for success by a caller that ignores it.
// `ambiguous` marks the one case where we don't know whether the message landed.
async function postWithRetry(url, headers, payload) {
  const ATTEMPTS = 4;
  /* Commissioner's standing instruction (2026-09-22): no link previews. Every post of ours that
     carries a URL was unfurling into a card that buried the message under a site preview, three
     and four deep in the weekly schedule. SUPPRESS_EMBEDS (flag 4) is set on every plain-text
     message; a post that carries its own `embeds` (the #rules mirror, the schedule card) is left
     alone, because that flag would hide those too. */
  if (payload && payload.content && !payload.embeds) payload = { ...payload, flags: 4 };
  for (let i = 0; i < ATTEMPTS; i++) {
    let r;
    try {
      r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    } catch (e) {
      return { ok: false, status: 0, ambiguous: true, error: `network error: ${String(e.message || e)}` };
    }
    if (r.ok) return { ok: true, status: r.status };
    if (r.status !== 429) {
      // A 4xx is a definitive rejection: bad payload, deleted webhook, missing permission. The
      // message did not land, so the claim is safe to release and retry.
      // A 5xx (or the Cloudflare error page that fronts Discord) may mean the message WAS delivered
      // and only the response was lost. Releasing on that would post the same reminder twice, which
      // is a worse outcome than missing one — so it stays claimed.
      const ambiguous = r.status >= 500 || r.status === 408;
      return { ok: false, status: r.status, ambiguous, error: `${r.status} ${(await r.text()).slice(0, 160)}` };
    }
    if (i === ATTEMPTS - 1) break; // out of attempts: don't burn the Retry-After wait we'll never use
    const ra = +(r.headers.get("retry-after") || 1);
    await new Promise((s) => setTimeout(s, (ra + 0.3) * 1000));
  }
  return { ok: false, status: 429, error: `rate limited, gave up after ${ATTEMPTS} attempts` };
}
// Informational posts (the schedule slate, the standings table) name every club, and every club
// name is a role mention — parse:["roles"] would fire a league-wide notification twice a week for
// a table, which trains people to mute the exact channels that later carry game reminders. The
// role pills still RENDER with parse:[], they just don't notify. Pass { ping: true } only when the
// post is genuinely FOR the people it names.
/* Discord caps a message at 2000 characters. Split on line boundaries so nothing is lost; a
   single line longer than the cap is the only thing ever truncated. */
function splitForDiscord(text) {
  const chunks = [];
  let buf = "";
  for (const line of String(text == null ? "" : text).split("\n")) {
    const piece = line.length > 1990 ? line.slice(0, 1990) : line;
    if ((buf + "\n" + piece).length > 1990) { if (buf) chunks.push(buf); buf = piece; }
    else buf = buf ? buf + "\n" + piece : piece;
  }
  if (buf) chunks.push(buf);
  return chunks;
}
async function postWebhook(url, content, opts = {}) {
  if (!url) return { ok: false, status: 0, error: "no webhook url" };
  /* Discord caps a message at 2000 characters. Silently slicing meant the weekly schedule lost
     its last ~20 games AND the whole Featured Matchups block while the job reported success.
     Split on line boundaries and post every part; the first part decides ok/failed. */
  const text = String(content == null ? "" : content);
  const mentions = opts.ping ? { parse: ["users", "roles"] } : { parse: [] };
  if (text.length <= 1990) {
    return postWithRetry(url, { "Content-Type": "application/json" }, { content: text, allowed_mentions: mentions });
  }
  const chunks = splitForDiscord(text);
  let first = null;
  for (const c of chunks) {
    const r = await postWithRetry(url, { "Content-Type": "application/json" }, { content: c, allowed_mentions: mentions });
    if (!first) first = r;
    if (!r.ok) break;      /* stop rather than spray half a schedule at a broken webhook */
  }
  return first || { ok: false, status: 0, error: "nothing to post" };
}
// Game reminders go to a club's own private room and are addressed to that club — this ping is
// the whole point of the message, so it keeps parse:["roles"].
async function postChannel(channelId, content) {
  if (!BOT || !channelId) return { ok: false, status: 0, error: BOT ? "no channel id" : "no bot token" };
  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  const head = { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" };
  let first = null;
  for (const c of splitForDiscord(content)) {
    const r = await postWithRetry(url, head, { content: c, allowed_mentions: { parse: ["users", "roles"] } });
    if (!first) first = r;
    if (!r.ok) break;
  }
  return first || { ok: false, status: 0, error: "nothing to post" };
}
// This endpoint is publicly HTTP-invocable; debounce anonymous floods (posts are already dedup'd by claim()).
async function ranRecently(key, sec) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?key=eq.rl_${key}&select=value`, { headers: sbHead() });
    const rows = await r.json();
    const last = rows && rows[0] && rows[0].value ? Date.parse(rows[0].value) : 0;
    if (Date.now() - last < sec * 1000) return true;
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: `rl_${key}`, value: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return false;
  } catch (e) { return false; }
}

// ---- America/New_York time helpers (DST-safe: everything is evaluated in ET) ----
function etParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { wd, hr: (+p.hour) % 24, mi: +p.minute, ymd: `${p.year}-${p.month}-${p.day}` };
}
/* A stable day index off the ET CALENDAR date. Not Date.now()/86400000 — that drifts by an hour
   twice a year and would let a window open early or late around a DST change. */
const etDayNum = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
const fmtTime = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)) + " ET";
const fmtDay = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));

/* ---------- #rules — mirror the published rulebook, and keep it mirrored ----------
   The rulebook is CG.CONTENT.rulebook in the site bundle, so this reads that same file
   (bundled via netlify.toml included_files) — one source of truth, no second copy to drift.
   Messages are EDITED in place against stored ids, so a new version updates the channel
   rather than appending another 16-message wall. A content hash makes it a cheap no-op
   on every tick until the rules actually change. */
const RULES_BRAND = 0xFFE500;
export function readRulebook() {
  const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd(), HERE,
                 path.join(HERE, "..", ".."), path.join(HERE, "..", "..", "..")].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, "src", "live", "part3_content.js");
    try {
      if (!fs.existsSync(p)) continue;
      const CG = {};
      new Function("CG", fs.readFileSync(p, "utf8"))(CG);
      if (CG.CONTENT && CG.CONTENT.rulebook) return CG.CONTENT.rulebook;
    } catch (e) { /* try the next candidate root */ }
  }
  return null;
}
/* Posting 16 messages back-to-back trips Discord's per-channel limit, so this honours Retry-After
   instead of dropping the tail of the rulebook. */
async function rulesApi(method, p, body, tries = 5) {
  for (let i = 0; i < tries; i++) {
    let r;
    try {
      r = await fetch(`https://discord.com/api/v10${p}`, {
        method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new Error(`${method} ${p} -> ${String(e.message || e)}`); }
    if (r.status === 429) {
      const j = await r.json().catch(() => ({}));
      await new Promise((s) => setTimeout(s, ((+j.retry_after || 1) + 0.25) * 1000));
      continue;
    }
    // A Discord-side 5xx is transient. Only 429 was retried, so one blip aborted the run.
    if (r.status >= 500) { await new Promise((s) => setTimeout(s, 600 * (i + 1))); continue; }
    if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${(await r.text()).slice(0, 140)}`);
    return r.status === 204 ? null : r.json();
  }
  throw new Error(`${method} ${p} -> still rate limited after ${tries} attempts`);
}
const rulesPace = () => new Promise((s) => setTimeout(s, 400));   // stay under the per-channel burst cap
/* One card in #rules pointing at the rulebook page, instead of the whole book mirrored chapter by
   chapter. The mirror was a dozen-plus messages that had to be rewritten on every amendment — it
   tripped the per-channel rate limit, and it meant two copies of the rules that could disagree the
   moment one edit failed. The site is the rulebook; Discord links to it.
   The card carries the version and effective date so it is obvious at a glance whether it is
   current, and the chapter list so nobody has to click just to see what is covered. */
export function buildRulesLink(rb) {
  const cur = (rb.changelog || [])[0] || {};
  const toc = (rb.chapters || []).map((c) => `**${c.num}.** ${c.title}`).join("\n");
  const when = (cur.dateIso || cur.date)
    ? new Date((cur.dateIso || cur.date) + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;
  return {
    embeds: [{
      title: "📖 CGHL Official Rulebook",
      url: "https://chelgamingleague.com/#/rulebook",
      description:
        "The rulebook lives on the site, where it is always current, searchable, and linkable — " +
        "cite any rule by its number and the link goes straight to it.\n\n" +
        "**→ [Read the rulebook](https://chelgamingleague.com/#/rulebook)**\n\n" + toc,
      color: RULES_BRAND,
      footer: { text: cur.version ? `Version ${cur.version}${when ? ` · effective ${when}` : ""}` : "Chel Gaming Hockey League" },
    }],
  };
}
async function rulesUpkeep(errors) {
  const out = { checked: 1, posted: 0, edited: 0, removed: 0, skipped: null };
  if (!BOT || !GUILD) { out.skipped = "no bot/guild"; return out; }
  const rb = readRulebook();
  if (!rb) { out.skipped = "rulebook not readable"; return out; }
  const card = buildRulesLink(rb);
  const hash = crypto.createHash("sha256").update(JSON.stringify(card)).digest("hex").slice(0, 32);

  let cfg = [];
  try { cfg = await sbGet("app_config?key=in.(rules_sync_hash,rules_message_ids)&select=key,value"); } catch (e) {}
  const get = (k) => (cfg.find((c) => c.key === k) || {}).value || "";
  let ids = [];
  try { ids = JSON.parse(get("rules_message_ids") || "[]"); } catch (e) { ids = []; }
  if (get("rules_sync_hash") === hash && ids.length === 1) return out;   // already in sync

  // resolve #rules — prefer the one under the Information category over any stray duplicate
  let chan = null;
  try {
    const chans = await rulesApi("GET", `/guilds/${GUILD}/channels`);
    const cats = Object.fromEntries((chans || []).filter((c) => c.type === 4).map((c) => [c.id, (c.name || "").toLowerCase()]));
    const named = (chans || []).filter((c) => c.type === 0 && (c.name || "").toLowerCase() === "rules");
    chan = named.find((c) => cats[c.parent_id] === "information") || named[0] || null;
  } catch (e) { errors.push(`rules channel lookup: ${String(e.message || e)}`); return out; }
  if (!chan) { out.skipped = "no #rules channel"; return out; }

  const body = { embeds: card.embeds, allowed_mentions: { parse: [] } };
  let keep = ids[0] || null;

  // Reuse the first mirrored message so the card sits where the rules already were, at the top of
  // the channel. If it is gone (deleted by hand), post a fresh one.
  if (keep) {
    try { await rulesPace(); await rulesApi("PATCH", `/channels/${chan.id}/messages/${keep}`, body); out.edited++; }
    catch (e) { keep = null; }
  }
  if (!keep) {
    try {
      await rulesPace();
      const posted = await rulesApi("POST", `/channels/${chan.id}/messages`, body);
      if (posted && posted.id) { keep = posted.id; out.posted++; }
    } catch (e) { errors.push(`rules card: ${String(e.message || e)}`); return out; }
  }

  // every other message this sync ever posted — the chapter-by-chapter mirror — comes down.
  // Only ids we recorded ourselves are touched, so nothing anyone else posted is at risk.
  for (const stale of ids) {
    if (stale === keep) continue;
    try { await rulesPace(); await rulesApi("DELETE", `/channels/${chan.id}/messages/${stale}`); out.removed++; }
    catch (e) { /* already gone by hand — nothing to do */ }
  }

  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST",
      headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([
        { key: "rules_message_ids", value: JSON.stringify(keep ? [keep] : []), updated_at: new Date().toISOString() },
        { key: "rules_sync_hash", value: hash, updated_at: new Date().toISOString() },
      ]) });
  } catch (e) { errors.push(`rules state save: ${String(e.message || e)}`); }
  return out;
}

/* The season, the clubs, the config and the schedule: every step reads the same four, so they are
   loaded once here and handed down. The ops door (runAvailabilityReminder) calls this too, which is
   the point: the season is picked by ONE rule, in one place, rather than re-queried per entry. */
async function loadWorld() {
  const active = await sbGet("seasons?select=id,number&status=eq.active&order=number.desc&limit=1");
  /* v2.36: no active season yet -> the LOWEST-numbered open one (the season next up), never the
     newest — a Season 2 row created ahead of time would otherwise have swallowed the pre-season slate */
  const season = active[0] || (await sbGet("seasons?select=id,number&status=neq.complete&order=number.asc&limit=1"))[0];
  if (!season) return null;
  const teams = await sbGet("teams?select=id,name,code,division,discord_channel_id,discord_role_id");
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const cfg = Object.fromEntries((await sbGet("app_config?select=key,value")).map((c) => [c.key, c.value]));
  const games = await sbGet(`games?season_id=eq.${season.id}&select=id,week,stage,home_team_id,away_team_id,scheduled_at,home_score,away_score,went_ot,status,game_code,forfeit_team_id,voided&order=scheduled_at`);
  return { season, teams, teamById, cfg, games };
}

export default async (req) => {
  if (!SB_URL || !SB_KEY) return json({ skipped: "missing supabase env" });
  // ?run=casework|signups bypasses the time gate for a manual check; &dry=1 computes without posting.
  const params = (() => { try { return new URL(req.url).searchParams; } catch { return new URLSearchParams(); } })();
  const forceRun = params.get("run"), dry = params.get("dry") === "1";
  if (!forceRun && await ranRecently("discord-scheduler", 60)) return json({ skipped: "ran moments ago" });
  // Delivery failures land in sum.errors rather than throwing, so a dead standings webhook can't
  // take the game reminders down with it. Both feed the ok/errCount record the Automations chip reads.
  // `unconfigured` is deliberately SEPARATE from `errors`: a feed nobody has set up yet must be
// visible without paging the watchdog forever, but it must not read as healthy silence either.
// These four used to return a bare string, so an unset webhook left errors empty and the result
// row said ok:true while a public feed was dark.
  const now = new Date(), et = etParts(now), sum = { errors: [], unconfigured: [] };
  try {
    /* mirror the rulebook into #rules — a no-op on every tick until the published version changes */
    try { sum.rules = await rulesUpkeep(sum.errors); } catch (e) { sum.errors.push(`rules: ${String(e.message || e)}`); }

    const world = await loadWorld();
    if (!world) return json({ skipped: "no season" });
    const { season, teamById, cfg, games } = world;

    // (A) weekly schedule — Tuesday 5:00-5:09pm ET
    if (et.wd === 2 && et.hr === 17 && et.mi < 10) sum.schedule = await weeklySchedule(games, teamById, cfg, sum.errors, sum.unconfigured);
    // (B) standings — Friday 11pm ET through Saturday 2am ET, once the week's games are all final
    if ((et.wd === 5 && et.hr >= 23) || (et.wd === 6 && et.hr < 2)) sum.standings = await weeklyStandings(games, teamById, cfg, sum.errors, sum.unconfigured);
    // (C) team reminders — ~30 min before a club's first game of the night
    sum.reminders = await gameReminders(games, teamById, now, sum.errors);
    // (D) casework nudge — daily 12pm ET: @ reviewers who still owe an application vote, and staff
    //     sitting on a claimed case. (E) sign-up reminder — unpinged, and pausable from app_config.
    if (forceRun === "casework" || (et.hr === 12 && et.mi < 10)) sum.casework = await caseworkNudge(cfg, teamById, et, dry, sum.errors, sum.unconfigured);
    if (forceRun === "signups"  || (et.hr === 18 && et.mi < 10)) sum.signups  = await signupReminder(cfg, et, dry, sum.errors, sum.unconfigured);
    // (F) availability + lineup reminder — self-gating on the week's own deadline minus 24 hours,
    //     so it needs no clock window here (a holiday-shifted week moves its own reminder with it).
    sum.availability = await availabilityReminder(season, games, teamById, cfg, now, dry, forceRun === "availability", sum.errors, sum.unconfigured);
  } catch (e) { sum.error = String(e.message || e); console.error("discord-scheduler:", sum.error); }
  console.log("discord-scheduler:", JSON.stringify(sum));
  const errs = (sum.error ? [sum.error] : []).concat(sum.errors);
  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "rl_discord-scheduler_result", value: JSON.stringify({
        at: new Date().toISOString(), ok: errs.length === 0, errCount: errs.length, lastError: errs[0] ? String(errs[0]).slice(0, 200) : null,
        unconfigured: sum.unconfigured, unconfiguredCount: sum.unconfigured.length
      }), updated_at: new Date().toISOString() }) });
  } catch {}
  return json(sum);
};

function computeStandings(games, teamById) {
  const t = {};
  for (const id in teamById) t[id] = { id, name: teamById[id].name, division: teamById[id].division, gp: 0, w: 0, l: 0, otl: 0, gf: 0, ga: 0, pts: 0 };
  for (const g of games) {
    if (g.status !== "final" || g.voided) continue;
    if ((g.stage || "regular") !== "regular") continue;   // pre-season + playoffs keep their own tables
    const h = t[g.home_team_id], a = t[g.away_team_id]; if (!h || !a) continue;
    const hs = g.home_score || 0, as = g.away_score || 0;
    h.gp++; a.gp++; h.gf += hs; h.ga += as; a.gf += as; a.ga += hs;
    if (g.forfeit_team_id) {
      // a forfeit is a regulation result (Rule 8.2): winner is the club that did NOT forfeit, no OT point
      const hw = g.forfeit_team_id !== g.home_team_id;
      if (hw) { h.w++; h.pts += 2; a.l++; } else { a.w++; a.pts += 2; h.l++; }
    } else if (hs > as) { h.w++; h.pts += 2; if (g.went_ot) { a.otl++; a.pts += 1; } else a.l++; }
    else if (as > hs) { a.w++; a.pts += 2; if (g.went_ot) { h.otl++; h.pts += 1; } else h.l++; }
  }
  return t;
}
const nameOf = (teamById, id) => (teamById[id] || {}).name || "?";
// A club's role mention (pings everyone on the club) when we know its Discord role, else the plain name.
const teamTag = (teamById, id) => { const t = teamById[id] || {}; return t.discord_role_id ? `<@&${t.discord_role_id}>` : (t.name || "?"); };

// Captions are bare noun phrases — the line they land on already reads "AWAY @ HOME — **caption**",
// so a caption with a verb ("visits") has to agree with a club name, and 7 of the 8 are plural.
// Each game carries a RANKED LIST of captions rather than one string: three featured games can
// easily share a headline fact (two same-division games in a week; on opening night every game
// falls into the same one or two early-season buckets), and the list lets the assignment below give
// each game something nobody else took. If a game genuinely has nothing left to say it gets NO
// caption — better a bare matchup line than a repeated one or an invented distinction.
function pickFeatured(weekGames, allGames, teamById) {
  const st = computeStandings(allGames, teamById);
  const finals = allGames.filter((g) => g.status === "final");
  const ranked = Object.values(st).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.gf - b.ga) - (a.gf - a.ga));
  const rank = {}; ranked.forEach((tm, i) => (rank[tm.id] = i + 1));
  const met = (x, y) => finals.some((g) => (g.home_team_id === x && g.away_team_id === y) || (g.home_team_id === y && g.away_team_id === x));
  const scored = weekGames.map((g) => {
    const h = st[g.home_team_id], a = st[g.away_team_id];
    if (!h || !a) return { g, s: -1, whys: [] };
    const sameDiv = h.division && h.division === a.division;
    const whys = [];
    if (finals.length < 6) { // early season: standings aren't meaningful yet, so lead with what is
      const debut = h.gp === 0 && a.gp === 0;
      if (sameDiv) {
        if (debut) whys.push(`${h.division} Division opener`);
        whys.push(`${h.division} Division rivalry`);
        if (!met(g.home_team_id, g.away_team_id)) whys.push(`first ${h.division} Division meeting of the season`);
        whys.push(`${h.division} Division points on the line`);
      } else {
        if (debut) whys.push("cross-division opener");
        whys.push("early-season measuring stick");
        if (!met(g.home_team_id, g.away_team_id)) whys.push("first meeting of the season");
      }
      return { g, s: 2 + (sameDiv ? 5 : 0), whys };
    }
    const gap = Math.abs(h.pts - a.pts), topClash = rank[g.home_team_id] <= 3 && rank[g.away_team_id] <= 3;
    const s = (h.pts + a.pts) - gap * 0.6 + (sameDiv ? 4 : 0) + (topClash ? 8 : 0);
    if (topClash) whys.push(`top-of-the-table clash — #${rank[g.away_team_id]} at #${rank[g.home_team_id]}`);
    if (sameDiv && gap <= 3) whys.push(`${h.division} Division rivalry with seeding on the line`);
    if (sameDiv) whys.push(`${h.division} Division rivalry`);
    if (gap <= 3) whys.push("two clubs neck-and-neck in the table");
    whys.push(`#${rank[g.away_team_id]} at #${rank[g.home_team_id]} in the table`);
    return { g, s, whys };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  // Highest-scoring game gets first pick of its captions; the rest take the best one still free.
  const top = scored.slice(0, 3), taken = new Set();
  for (const f of top) {
    f.why = f.whys.find((w) => !taken.has(w)) || "";
    if (f.why) taken.add(f.why);
  }
  return top;
}

async function weeklySchedule(games, teamById, cfg, errors, unconfigured) {
  const nowMs = Date.now();
  const wk = games.filter((g) => g.status !== "final" && new Date(g.scheduled_at).getTime() < nowMs + 6 * 864e5 && new Date(g.scheduled_at).getTime() > nowMs - 3600e3);
  if (!wk.length) return "no upcoming games this week";
  const url = cfg.discord_schedule_webhook || cfg.discord_default_webhook;
  if (!url) { unconfigured.push("weekly schedule (discord_schedule_webhook)"); return "no schedule webhook configured"; } // checked before claim() so the slot isn't burned
  const ref = "sched-" + etParts(new Date(wk[0].scheduled_at)).ymd;
  if (!(await claim("weekly_schedule", ref))) return "already posted";
  const tag = (id) => teamTag(teamById, id);
  const byDay = {};
  for (const g of wk) (byDay[fmtDay(g.scheduled_at)] = byDay[fmtDay(g.scheduled_at)] || []).push(g);
  const lines = ["📅 **This Week in the CGHL**", ""];
  for (const day of Object.keys(byDay)) {
    lines.push(`__${day}__`);
    for (const g of byDay[day].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)))
      lines.push(`• ${tag(g.away_team_id)} @ ${tag(g.home_team_id)} — ${fmtTime(g.scheduled_at)}`);
    lines.push("");
  }
  const feat = pickFeatured(wk, games, teamById);
  if (feat.length) {
    lines.push("⭐ **Featured Matchups**");
    for (const f of feat) lines.push(`• ${tag(f.g.away_team_id)} @ ${tag(f.g.home_team_id)}${f.why ? ` — **${f.why}**` : ""}`);
  }
  const res = await postWebhook(url, lines.join("\n"));
  if (!res.ok) {
    errors.push(`weekly schedule: ${res.error}`);
    if (!res.ambiguous) await release("weekly_schedule", ref); // nothing landed — let a later tick retry
    return `post failed: ${res.error}`;
  }
  return `posted ${wk.length} games`;
}

async function weeklyStandings(games, teamById, cfg, errors, unconfigured) {
  const nowMs = Date.now();
  const wk = games.filter((g) => { const t = new Date(g.scheduled_at).getTime(); return t > nowMs - 5 * 864e5 && t <= nowMs; });
  if (!wk.length) return "no games this week";
  if (wk.some((g) => g.status !== "final")) return "week not complete yet"; // re-checks next tick
  const url = cfg.discord_standings_webhook || cfg.discord_default_webhook;
  if (!url) { unconfigured.push("weekly standings (discord_standings_webhook)"); return "no standings webhook configured"; } // checked before claim() so the slot isn't burned
  const anchor = wk.reduce((m, g) => (g.scheduled_at > m ? g.scheduled_at : m), wk[0].scheduled_at);
  const ref = "standings-" + etParts(new Date(anchor)).ymd; // stable across the Fri-night / Sat-early window
  if (!(await claim("weekly_standings", ref))) return "already posted";
  const rows = Object.values(computeStandings(games, teamById)).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.gf - b.ga) - (a.gf - a.ga));
  // Ranked list rather than a code block so the club role mentions render as pills (they don't ping).
  const lines = [`🏒 **CGHL Standings** — through ${fmtDay(anchor)}`, ""];
  rows.forEach((t, i) => {
    const diff = (t.gf - t.ga >= 0 ? "+" : "") + (t.gf - t.ga);
    lines.push(`\`${String(i + 1).padStart(2)}\` ${teamTag(teamById, t.id)} — **${t.pts}** PTS · ${t.w}-${t.l}-${t.otl} · ${diff}`);
  });
  const res = await postWebhook(url, lines.join("\n"));
  if (!res.ok) {
    errors.push(`weekly standings: ${res.error}`);
    if (!res.ambiguous) await release("weekly_standings", ref); // nothing landed — let a later tick retry
    return `post failed: ${res.error}`;
  }
  return `posted standings (${rows.length} clubs)`;
}

// A reminder becomes eligible 35 min out and STAYS eligible until puck drop, rather than living in a
// 25-35 min slot. On a healthy */5 cron the first eligible tick is still ~30-35 min out, so the normal
// timing is unchanged — but if that tick is lost to a cold start or a deploy, every later tick is a
// catch-up instead of the reminder vanishing for the night. claim() is what keeps this idempotent:
// the first tick to post takes the (team, night) row and every later tick short-circuits on it, so a
// wider window can never double-post. Games already under way are filtered out above, which is what
// closes the window at puck drop.
// v2.78: 75, not 35. Lineups lock 30 minutes before each game (Rule 5.3), so a reminder that only
// became eligible at T-35 landed in the last five minutes before the lock, and if that one cron tick
// was late, after it. At 75 a club has three quarters of an hour to file, and the claim per club per
// ET night still makes a wider window impossible to double-post.
const REMINDER_LEAD_MAX = 75;

async function gameReminders(games, teamById, now, errors) {
  const nowMs = now.getTime(), byTeam = {};
  for (const g of games) {
    if (g.status === "final" || g.voided || new Date(g.scheduled_at).getTime() < nowMs) continue;
    for (const tid of [g.home_team_id, g.away_team_id]) (byTeam[tid] = byTeam[tid] || []).push(g);
  }
  let posted = 0;
  for (const tid in byTeam) {
    const team = teamById[tid];
    if (!team || !team.discord_channel_id){
      /* v2.78: say so. This used to drop a club's whole game-night post with the run still green. */
      errors.push({ gameReminder: `${(team && team.code) || tid} has no Discord room — its game-night reminder was not posted` });
      continue;
    }
    const list = byTeam[tid].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const firstMs = new Date(list[0].scheduled_at).getTime(), mins = (firstMs - nowMs) / 60000;
    if (mins > REMINDER_LEAD_MAX) continue;
    const nightYmd = etParts(new Date(list[0].scheduled_at)).ymd;
    const tonight = list.filter((g) => etParts(new Date(g.scheduled_at)).ymd === nightYmd);
    const ref = `${tid}:${nightYmd}`;
    if (!(await claim("game_reminder", ref))) continue;
    const nm = (id) => nameOf(teamById, id);
    const lines = [`${teamTag(teamById, tid)} 🚨 **Game night!** You've got ${tonight.length} matchup${tonight.length > 1 ? "s" : ""} tonight:`, ""];
    for (const g of tonight) {
      // the opponent is a club too — render it as its role pill, not bold text
      const oppId = g.home_team_id === tid ? g.away_team_id : g.home_team_id;
      const ha = g.home_team_id === tid ? "vs" : "@";
      lines.push(`• ${ha} ${teamTag(teamById, oppId)} — ${fmtTime(g.scheduled_at)}${g.game_code ? ` · lobby \`${g.game_code}\`` : ""}`);
    }
    // On a catch-up post the lock has already passed, so don't tell them to go set a lineup they can't change.
    lines.push("", mins >= 30
      ? "⏰ Lineups + server picks lock **30 minutes before puck drop** — set yours: https://chelgamingleague.com"
      : `⏰ Puck drop in about ${Math.max(1, Math.round(mins))} min — lineups + server picks are already locked: https://chelgamingleague.com`);
    const res = await postChannel(team.discord_channel_id, lines.join("\n"));
    if (!res.ok) {
      errors.push(`game reminder ${team.name || tid}: ${res.error}`);
      if (!res.ambiguous) await release("game_reminder", ref); // nothing landed — a later tick can still catch it
      continue;
    }
    posted++;
  }
  return `sent ${posted} reminder(s)`;
}

// (D) Daily nudge to #staff-casework: for every pending application, @ the reviewers who still owe a
// vote; for every claimed-but-unresolved case, @ the assignee. Posts only when something's outstanding.
async function caseworkNudge(cfg, teamById, et, dry, errors, unconfigured) {
  const url = cfg.discord_staff_casework_webhook || cfg.discord_staff_webhook;   // staff channels only — NEVER the public default
  if (!url) { unconfigured.push("casework nudge (discord_staff_casework_webhook)"); return "no casework webhook"; }
  const [profs, links, oa, sa, ma, ballots, cases] = await Promise.all([
    sbGet("profiles?select=id,role,departments,gamertag"),
    sbGet("discord_links?select=profile_id,discord_id"),
    sbGet("owner_applications?status=eq.pending&select=id,profile_id"),
    sbGet("staff_applications?status=eq.pending&select=id,profile_id"),
    sbGet("management_applications?status=eq.pending&select=id,role,team_id,nominee_id"),
    sbGet("application_ballots?select=app_type,application_id,voter_id"),
    sbGet("action_requests?status=not.in.(resolved,denied)&assigned_to=not.is.null&select=id,subject,type,assigned_to"),
  ]);
  const did = Object.fromEntries(links.filter((l) => l.discord_id).map((l) => [l.profile_id, l.discord_id]));
  const gt = Object.fromEntries(profs.map((p) => [p.id, p.gamertag || "a member"]));
  const mention = (pid) => (did[pid] ? `<@${did[pid]}>` : `**${gt[pid] || "a reviewer"}**`);
  const reviewers = profs.filter((p) => (p.role === "staff" || p.role === "commissioner") && Array.isArray(p.departments) && p.departments.includes("applications"));
  const votedBy = {};
  for (const b of ballots) (votedBy[b.app_type + ":" + b.application_id] = votedBy[b.app_type + ":" + b.application_id] || new Set()).add(b.voter_id);

  const appLines = [];
  const owe = (key) => reviewers.filter((r) => !(votedBy[key] || new Set()).has(r.id));
  // the applicant/nominee and their club are named here too — all three render as mentions
  for (const a of oa) { const o = owe("owner:" + a.id); if (o.length) appLines.push(`• **Owner application** — ${mention(a.profile_id)} · still needs: ${o.map((r) => mention(r.id)).join(" ")}`); }
  for (const a of sa) { const o = owe("staff:" + a.id); if (o.length) appLines.push(`• **Staff application** — ${mention(a.profile_id)} · still needs: ${o.map((r) => mention(r.id)).join(" ")}`); }
  for (const a of ma) {
    const o = owe("management:" + a.id); if (!o.length) continue;
    appLines.push(`• **${a.role === "gm" ? "GM" : "AGM"} application** — ${mention(a.nominee_id)} (${teamTag(teamById, a.team_id)}) · still needs: ${o.map((r) => mention(r.id)).join(" ")}`);
  }
  const caseLines = cases.map((c) => `• ${c.subject || c.type || "Case"} · ${mention(c.assigned_to)}`);

  if (!appLines.length && !caseLines.length) return "nothing outstanding";
  const lines = ["🗳️ **League office — items awaiting you**"];
  if (appLines.length) { lines.push("", "__Applications awaiting your vote__", ...appLines); }
  if (caseLines.length) { lines.push("", "__Claimed cases awaiting a ruling__", ...caseLines); }
  lines.push("", "Open the Staff Desk to act: https://chelgamingleague.com/#/hub/staffdesk");
  const content = lines.join("\n");
  if (dry) return { would_post: content, apps: appLines.length, cases: caseLines.length };
  if (!(await claim("casework_nudge", et.ymd))) return "already posted today";
  const res = await postWebhook(url, content, { ping: true });
  if (!res.ok) { errors.push(`casework nudge: ${res.error}`); if (!res.ambiguous) await release("casework_nudge", et.ymd); return `post failed: ${res.error}`; }
  return `nudged (${appLines.length} apps, ${caseLines.length} cases)`;
}

// (E) Recurring #season-signups notice while registration is open. It used to @-ping the bot-maintained
// "Not Signed Up" role; the commissioner removed that ping on 2026-09-08. The notice still posts — it
// carries the deadline and the link — and now mentions nobody: postWebhook without `ping` sends
// allowed_mentions {parse:[]}, so even a stray <@&…> in the copy could not fire a notification.
// The ROLE itself stays: discord-sync still uses it for channel permissions and the GIF carve-out.
/* ---------- (F) availability, 24 hours out, and the lineups that hang on it (Rule 5.1) ----------
   A week's availability closes at 7:30 PM ET on the night of its FIRST game: Wednesday in a normal
   week, and whatever the first night is in a holiday-shifted one. The deadline itself is computed
   in ONE place, public.week_availability_deadline, and who has not answered in one more,
   public.availability_missing. The post-deadline nudge reads the same two, so the reminder that
   goes out a day earlier can never name a different set of players than the nudge that follows it.

   The window OPENS at the deadline minus 24 hours and stays open until the deadline, exactly as
   REMINDER_LEAD_MAX does for game night: a tick lost to a cold start or a deploy becomes a
   catch-up, not a missed week. What makes a wide window safe is the claim, one per club per week
   plus one for the front offices, so the first tick inside the window posts and every later tick
   is refused. A club whose post fails keeps its own retry without re-posting to the other seven. */
const AVAIL_LEAD_MS = 24 * 60 * 60 * 1000;
/* Commissioner's ruling (2026-09-22): the office asks for lineups ONE HOUR after availability
   closes, 8:30 PM ET in a normal week, so that a club builds its sheets on the finished
   availability picture rather than racing the same clock its players are on. It is still a
   request and not a lock: Rule 5.3 locks each game 30 minutes before its own puck drop. */
const LINEUP_LAG_MS = 60 * 60 * 1000;
async function sbRpc(fn, body) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: sbHead(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`rpc ${fn} -> ${r.status} ${(await r.text()).slice(0, 140)}`);
  return r.json();
}
/* the deadline is the database's to define, not this file's (there is already one structural copy
   in the browser, which cannot call a function at render time; a third would be the regression) */
async function weekDeadlineMs(seasonId, weekKey) {
  const v = await sbRpc("week_availability_deadline", { p_season: seasonId, p_week_key: weekKey });
  const at = typeof v === "string" ? v : (v && v.length ? v[0] : null);
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}
async function availabilityReminder(season, games, teamById, cfg, now, dry, forced, errors, unconfigured) {
  /* OFF SWITCH: set app_config.availability_reminder_enabled to off/paused to stop it with no
     deploy. Unset means ON, so a fresh environment never silently loses it. */
  const sw = String(cfg.availability_reminder_enabled ?? "").trim().toLowerCase();
  if (["off", "0", "false", "no", "paused"].includes(sw)) return `paused (app_config.availability_reminder_enabled=${sw})`;
  const nowMs = now.getTime();
  const regular = games.filter((g) => (g.stage || "regular") === "regular" && !g.voided);
  /* look only at the week in play and the one after it: two RPC calls at most per tick */
  const weeks = [...new Set(regular.filter((g) => Date.parse(g.scheduled_at) > nowMs - 6 * 60 * 60 * 1000).map((g) => g.week || 1))].sort((a, b) => a - b).slice(0, 2);
  let wk = null, dl = null;
  for (const w of weeks) {
    const at = await weekDeadlineMs(season.id, `w${w}`);
    if (at && at > nowMs) { wk = w; dl = at; break; }
  }
  if (wk === null) return "no game week with an open availability window";
  const lead = dl - nowMs;
  if (!forced && lead > AVAIL_LEAD_MS) return `week ${wk} closes ${fmtDay(new Date(dl).toISOString())} ${fmtTime(new Date(dl).toISOString())}; the reminder is due in ${Math.round((lead - AVAIL_LEAD_MS) / 60000)} min`;
  const wkKey = `w${wk}`, closes = `${fmtDay(new Date(dl).toISOString())}, ${fmtTime(new Date(dl).toISOString())}`;
  const linesBy = `${fmtDay(new Date(dl + LINEUP_LAG_MS).toISOString())}, ${fmtTime(new Date(dl + LINEUP_LAG_MS).toISOString())}`;
  const mgmtRoom = cfg.discord_mgmt_room_management_announcements_id;
  if (!mgmtRoom) unconfigured.push("management lineup reminder (app_config.discord_mgmt_room_management_announcements_id)");
  let roles = {};
  try { roles = JSON.parse(cfg.discord_role_ids || "{}") || {}; } catch { roles = {}; }

  const weekGames = regular.filter((g) => (g.week || 1) === wk).sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  const byClub = {};
  for (const g of weekGames) for (const tid of [g.home_team_id, g.away_team_id]) (byClub[tid] = byClub[tid] || []).push(g);
  const missing = await sbRpc("availability_missing", { p_season: season.id, p_week_key: wkKey });
  const missByClub = {};
  for (const m of missing || []) (missByClub[m.team_id] = missByClub[m.team_id] || []).push(m);
  const filed = weekGames.length
    ? await sbGet(`game_lineups?game_id=in.(${weekGames.map((g) => g.id).join(",")})&select=game_id,team_id`)
    : [];
  const filedSet = new Set((filed || []).map((r) => `${r.game_id}:${r.team_id}`));
  const owed = {};      /* club -> sheets not yet filed this week */
  for (const tid of Object.keys(byClub)) owed[tid] = byClub[tid].filter((g) => !filedSet.has(`${g.id}:${tid}`)).length;

  /* a week is three nights of three games: group them by night so the line reads like a schedule
     rather than nine repetitions of the same date */
  const opp = (g, tid) => (g.home_team_id === tid ? "vs " : "at ") + ((teamById[g.home_team_id === tid ? g.away_team_id : g.home_team_id] || {}).code || "?");
  const clubLine = (tid) => {
    const nights = [];
    for (const g of byClub[tid]) {
      const day = fmtDay(g.scheduled_at).split(",")[0];
      const last = nights[nights.length - 1];
      const at = `${fmtTime(g.scheduled_at).replace(" ET", "")} ${opp(g, tid)}`;
      if (last && last.day === day) last.games.push(at); else nights.push({ day, games: [at] });
    }
    return nights.map((n) => `${n.day} ${n.games.join(", ")}`).join(" · ");
  };
  const clubBody = (tid) => {
    const team = teamById[tid] || {}, out = missByClub[tid] || [];
    const head = `📋 **Week ${wk} availability closes ${closes}** (Rule 5.1, 90 minutes before the night's first puck drop).`;
    const who = out.length
      ? `\nStill to answer (${out.length}): ` + out.map((m) => (m.discord_id ? `<@${m.discord_id}>` : m.gamertag)).join(" ")
        + `\nIt takes a minute, one answer per game: https://chelgamingleague.com/#/hub/availability`
      : `\nEvery ${team.name || team.code || "club"} player has answered. Nothing to do.`;
    return head + who + `\n${team.code || ""} this week (times ET): ${clubLine(tid)}`;
  };
  const mgmtBody = () => {
    /* One role covers all three front-office seats. The three separate pings are kept only as a
       fallback for a guild that has no such role yet, so this never silently pings nobody. */
    const ping = roles["cghl management"]
      ? `<@&${roles["cghl management"]}>`
      : ["owner", "general manager", "assistant general manager"].map((k) => roles[k]).filter(Boolean).map((id) => `<@&${id}>`).join(" ");
    const sheets = Object.values(owed).reduce((a, b) => a + b, 0), total = weekGames.length * 2;
    const still = Object.keys(owed).filter((tid) => owed[tid] > 0)
      .sort((a, b) => owed[b] - owed[a]).map((tid) => `${(teamById[tid] || {}).code || "?"} ${owed[tid]}`).join(" · ");
    return `${ping}\n🗓️ **Week ${wk} lineups: please have them filed by ${linesBy}**, one hour after availability closes (${closes}, Rule 5.1), so you are building on the finished picture.`
      + `\nSheets still to file: **${sheets} of ${total}**${still ? ` (${still})` : ""}.`
      + `\nTeam HQ, Lineups: https://chelgamingleague.com/#/hub/lineup`
      + `\nAvailability still outstanding: ${(missing || []).length} player${(missing || []).length === 1 ? "" : "s"}; each club's list is in its own room.`
      + `\nThe lock is unchanged: each game locks 30 minutes before its own puck drop. After the lock a change is an emergency call-up only, and **each player you change costs the club one in-game minor in that game** (two swaps, two minors; moving the same six between positions costs nothing). The door shuts 10 minutes after puck drop, and the filed sheet is then the record (Rule 5.3).`;
  };
  if (dry) return { week: wk, closes, missing: (missing || []).length, sheetsOwed: Object.values(owed).reduce((a, b) => a + b, 0), clubs: Object.keys(byClub).map((tid) => clubBody(tid)), management: mgmtBody() };

  let posted = 0;
  for (const tid of Object.keys(byClub)) {
    const team = teamById[tid];
    if (!team || !team.discord_channel_id) {
      errors.push(`availability reminder: ${(team && team.code) || tid} has no Discord room, so its club was not reminded`);
      continue;
    }
    const ref = `${season.id}-${wkKey}-${team.code || tid}`;
    if (!(await claim("availability_reminder", ref))) continue;
    const res = await postChannel(team.discord_channel_id, clubBody(tid));
    if (!res.ok) {
      errors.push(`availability reminder ${team.code || tid}: ${res.error}`);
      if (!res.ambiguous) await release("availability_reminder", ref);
      continue;
    }
    posted++;
  }
  let mgmt = "no management room configured";
  if (mgmtRoom) {
    const ref = `${season.id}-${wkKey}-management`;
    if (!(await claim("availability_reminder", ref))) mgmt = "already posted";
    else {
      const res = await postChannel(mgmtRoom, mgmtBody());
      if (!res.ok) {
        errors.push(`lineup reminder (management): ${res.error}`);
        if (!res.ambiguous) await release("availability_reminder", ref);
        mgmt = `post failed: ${res.error}`;
      } else mgmt = "posted";
    }
  }
  return `week ${wk}: reminded ${posted} club${posted === 1 ? "" : "s"} (${(missing || []).length} players outstanding), management ${mgmt}`;
}
/* The scheduler is a SCHEDULED function, and Netlify refuses external HTTP to those, so ?run= is
   unreachable in production. /api/discord-ops?post=availability-reminder calls this instead: the
   same step, the same claims, forced past the 24-hour window so the office can send it early or
   re-send a week that failed. One implementation, two doors. */
export async function runAvailabilityReminder({ dry = false } = {}) {
  const w = await loadWorld();
  if (!w) return { skipped: "no season" };
  const errors = [], unconfigured = [];
  const availability = await availabilityReminder(w.season, w.games, w.teamById, w.cfg, new Date(), dry, true, errors, unconfigured);
  return { availability, errors, unconfigured, ok: errors.length === 0 };
}

async function signupReminder(cfg, et, dry, errors, unconfigured) {
  /* OFF SWITCH (commissioner, 2026-09-08): the notice is PAUSED, not deleted. Turn it back on by
     setting app_config.signup_reminder_enabled to "on" — or deleting that row — with no deploy.
     Unset means ON so a fresh environment never silently loses a job it is supposed to run, and the
     gate sits above the webhook check so a paused job is never reported as misconfigured. A forced
     ?run=signups is paused too: "stopped" has to mean stopped, or the pause cannot be trusted. */
  const sw = String(cfg.signup_reminder_enabled ?? "").trim().toLowerCase();
  if (["off", "0", "false", "no", "paused"].includes(sw)) return `paused (app_config.signup_reminder_enabled=${sw})`;
  const EVERY = Math.max(1, parseInt(cfg.signup_reminder_days || "3", 10) || 3);
  const url = cfg.discord_signup_webhook || cfg.discord_default_webhook;
  if (!url) { unconfigured.push("sign-up reminder (discord_signup_webhook)"); return "no signup webhook"; }
  const s = (await sbGet("seasons?select=id,name,registration_open,signup_deadline_at,registration_deadline&registration_open=is.true&order=number.desc&limit=1"))[0];
  if (!s) return "registration closed";   /* Rule 1.1 (v2.8): open until the next season's opens */
  const [members, regs] = await Promise.all([
    sbGet("profiles?select=id&role=eq.member&banned=eq.false&in_guild=eq.true"),
    sbGet(`season_registrations?season_id=eq.${s.id}&select=profile_id`),
  ]);
  const reg = new Set(regs.map((r) => r.profile_id));
  const remaining = members.filter((m) => !reg.has(m.id)).length;
  if (remaining === 0) return "everyone signed up";
  /* The deadline no longer CLOSES registration (Rule 1.1 v2.8) — it is the draft-eligibility
     cutoff. Losing this binding when that rule shipped is what silently killed this reminder for
     four days: the template below still referenced it, so every run threw ReferenceError before
     reaching the post. Keep the date in the copy, but say what it actually means. */
  const deadline = s.signup_deadline_at || s.registration_deadline || null;
  const content = `⏰ **${s.name} sign-ups are open** — ${remaining} member${remaining === 1 ? " hasn't" : "s haven't"} registered yet.\n` +
    ((deadline && new Date(deadline).getTime() > Date.now())
      ? `Sign up before **${fmtDay(deadline)}** to go into the draft — after that you can still join, you'll just be placed on a club: https://chelgamingleague.com/#/register`
      : `Grab your spot: https://chelgamingleague.com/#/register`);
  if (dry) return { would_post: content, remaining, everyDays: EVERY };
  /* Every N days rather than daily (commissioner's call, 2026-08-19: 3). The claim is keyed on the
     WINDOW, not the date, which matters — keying on et.ymd would post once per day, and gating on
     `dayNum % N === 0` would skip the whole window whenever the 18:00 tick was missed on the one
     firing day. With a window key the first successful run inside each window posts and the rest
     are refused, so a missed tick simply catches up the next evening. */
  const windowRef = `w${EVERY}-${Math.floor(etDayNum(et.ymd) / EVERY)}`;
  if (!(await claim("signup_reminder", windowRef))) return `already posted this ${EVERY}-day window`;
  const res = await postWebhook(url, content);   /* no `ping` → allowed_mentions {parse:[]} → mentions nobody */
  if (!res.ok) { errors.push(`signup reminder: ${res.error}`); if (!res.ambiguous) await release("signup_reminder", windowRef); return `post failed: ${res.error}`; }
  return `posted the sign-up notice, no ping (${remaining} remaining, every ${EVERY} days)`;
}

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } }); }
