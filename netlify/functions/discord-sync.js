// Netlify Scheduled Function — keeps Discord in sync with the site every 2 min.
//  (1) Username sync: sets each profile's gamertag to the member's current Discord
//      display name (server nick > global name > username), so name changes flow in.
//  (2) Role sync: reconciles each member's MANAGED Discord roles with the DB —
//      team role (from their roster spot), Owner/GM/AGM (from the team's front-office
//      slots), Commissioner (league role), Player, Free Agent, and a position role
//      (Center/Left Wing/Right Wing/Left Defense/Right Defense/Goalie, auto-created).
//      Never touches non-managed roles (boosters, custom, etc.).
//  (3) Guild furniture and permissions: the categories, rooms, forums, roles, AutoMod rules and
//      channel locks the league depends on, reconciled every sweep.
//
// Server resolution (resolve_due_servers) used to run at the tail of this sweep. It runs on
// pg_cron in the database since 2026-09-17, so a game's server pick no longer depends on a sweep
// reaching its last line inside the 30-second limit.
//
// The sweep body is exported as runSweep() and the diagnostic / setup entry points as `ops`:
// Netlify refuses external HTTP calls to a scheduled function, so netlify/functions/discord-ops.js
// (an ordinary HTTP function) imports them and is the only way to reach them by request.
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/* The role rules are SHARED with the Oracle gateway bot (bot/role-sync.mjs), which applies the
   same computation the moment a member's database row changes instead of on the next sweep. Both
   sides importing one module is what stops the two processes from ever disagreeing about what a
   member's roles should be — they can only disagree about when. */
import { STAFF_DEPARTMENTS, POS_LABEL, POSITION_ROLES, MANAGED_STATIC,
  desiredRolesFor, applyManagedRoles, managedRoleIds } from "../../shared/roles.mjs";
import { buildDepartureEmbed } from "../../shared/departure-card.mjs";
import { buildNoticeEmbed } from "../../bot/club-notices.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// No-ops safely if the bot token / guild id aren't set. Node 18+ (global fetch).

export const config = { schedule: "*/2 * * * *" };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });

/* Every request in this file carries a deadline. A scheduled function has 30 seconds in total, and
   one hung socket — Discord or Supabase — used to hold the whole sweep until Netlify killed it,
   with nothing written down. A request that cannot answer inside its budget is a failed request
   like any other: it throws, the step records the error, and the sweep moves on. */
const DISCORD_TIMEOUT_MS = 15000;
const SB_TIMEOUT_MS = 10000;
const deadline = (ms) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
const sbOpts = (opts) => ({ signal: deadline(SB_TIMEOUT_MS), ...(opts || {}) });

// A transient network failure ("fetch failed" from undici — a DNS blip, connection reset, or
// timeout) throws BEFORE any HTTP response, so the 429 handling in dApi never sees it and one blip
// aborts the whole sweep (this is what kept failing lockPrivate). Retry the fetch itself a few
// times with backoff so a momentary hiccup doesn't fail the run. Each attempt gets its own
// deadline — a signal is single-use, so it cannot be built once outside the loop.
async function rfetch(url, opts, tries = 3, timeoutMs = SB_TIMEOUT_MS) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, { signal: deadline(timeoutMs), ...(opts || {}) }); }
    catch (e) { err = e; if (i + 1 < tries) await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  throw err;
}

// The sweep is reachable through discord-ops.js (run-now) as well as the schedule. Debounce so a
// burst of run-now calls can't drive endless Discord/DB work. Fail-open on any guard error.
async function ranRecently(key, sec) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?key=eq.rl_${key}&select=value`, sbOpts({ headers: sbHead() }));
    const rows = await r.json();
    const last = rows && rows[0] && rows[0].value ? Date.parse(rows[0].value) : 0;
    if (Date.now() - last < sec * 1000) return true;
    await fetch(`${SB_URL}/rest/v1/app_config`, sbOpts({ method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ key: `rl_${key}`, value: new Date().toISOString(), updated_at: new Date().toISOString() }) }));
    return false;
  } catch (e) { return false; }
}
async function sbGet(path) {
  const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPatch(path, body) {
  const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
}
/* Posting a message is the one call here that is not safe to repeat: Discord may have delivered
   it even when we never saw the response (a timeout, or a 5xx from a proxy in front of a
   successful write). Retrying such a call is how a club room gets the same notice twice. So a
   message POST is sent exactly once and an ambiguous outcome is thrown as `unknown` — the caller
   decides what "unknown" means for its bookkeeping, never dApi. Everything else (role and channel
   PATCHes, PUT overwrites, GETs) is idempotent and retried as before. */
const isMessagePost = (method, path) => method === "POST" && /^\/channels\/[^/]+\/messages$/.test(path);
async function dApi(method, path, body) {
  const oneShot = isMessagePost(method, path);
  // Retry on 429 (respect Retry-After) so a busy run doesn't skip members and mis-flag them.
  for (let attempt = 0; attempt < 4; attempt++) {
    let r;
    try {
      r = await rfetch(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      }, oneShot ? 1 : 3, DISCORD_TIMEOUT_MS);
    } catch (e) {
      if (!oneShot) throw e;
      const err = new Error(`${method} ${path} -> delivery unknown (${e && e.name === "TimeoutError" ? "timeout" : String(e.message || e)})`);
      err.unknown = true; throw err;
    }
    if (r.status === 404) return { __notfound: true };
    if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
    // A Discord-side 5xx is transient. Only 429 was retried, so one blip aborted the sweep.
    if (r.status >= 500) {
      if (oneShot) { const err = new Error(`${method} ${path} -> delivery unknown (${r.status})`); err.unknown = true; throw err; }
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1))); continue;
    }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  throw new Error(`${method} ${path} -> rate-limited after retries`);
}

async function sbPost(path, body, prefer) {
  const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { method: "POST",
    headers: { ...sbHead(), Prefer: prefer || "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
/* Several app_config keys read in one round trip (the stored channel ids the adopters below key
   on). Returns {key: value}; a failed read is an empty map, so every caller falls back to its
   name-based lookup rather than failing the step. */
async function sbCfgMany(keys) {
  const out = {};
  try {
    const rows = await sbGet(`app_config?key=in.(${keys.map(encodeURIComponent).join(",")})&select=key,value`);
    for (const r of rows || []) if (r && r.key) out[r.key] = r.value;
  } catch (e) { /* the adopters fall back to name lookups */ }
  return out;
}

// Discord channel-name slug (lowercase, hyphens) to compare against team names
function slug(n) { return String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

/* ---- who left the server ----------------------------------------------------------------
   Discord keeps no "who left" record and this league runs no gateway bot, so a departure is only
   ever visible as the difference between two census sweeps. The census above already pulls the
   whole member list; this gives it a memory to diff against and posts what changed into the
   #member-departures room (Information — public, like #welcome, since 2026-09-13).

   The one thing that must never happen is a false mass-departure. Three guards:
     1. memberListOk — set only AFTER every page came back, so a throw mid-pagination leaves it
        false and this is skipped entirely.
     2. an empty census is treated as a failed one, never as "everybody left".
     3. a drop of more than a quarter of the server in a single 2-minute tick is recorded but NOT
        announced, and flagged in the run result instead. Real servers do not do that; a partial
        read does.
*/
const DEPART_SANITY = 0.25;
/* A present row is rewritten only when something the diff needs has changed — the member is new
   to the census (or back after an absence, so `present` flips) — or its last_seen is older than
   this. Before, every sweep rewrote every row (~150 upserts every 2 minutes) to move a timestamp
   nobody reads at that resolution. An hour is precise enough for "when were they last seen". */
const DEPART_TOUCH_MS = 60 * 60 * 1000;
async function trackDepartures(memberById, memberListOk, links, teams, sum) {
  if (!memberListOk || memberById.size === 0) { sum.departSkipped = "no complete census"; return; }
  let known = [];
  try { known = await sbGet("guild_members?present=is.true&select=discord_id,username,display_name,profile_id,joined_guild_at,is_bot,last_seen"); }
  catch (e) { sum.errors.push({ departLoad: String(e.message || e) }); return; }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const profByDiscord = new Map(links.filter((l) => l.discord_id).map((l) => [String(l.discord_id), l]));
  const codeByTeam = Object.fromEntries((teams || []).map((t) => [t.id, t.code]));
  /* whether a leaver had signed up for the season is the part a commissioner actually reacts to,
     so it is worth one small extra read */
  let registered = new Set();
  try { registered = new Set((await sbGet("season_registrations?select=profile_id")).map((r) => r.profile_id)); }
  catch (e) { /* the log is still worth writing without it */ }

  // 1) everyone seen now is present — written only where the row would actually change
  const seenAt = new Map(known.map((k) => [String(k.discord_id), k.last_seen ? Date.parse(k.last_seen) : 0]));
  const rows = [];
  for (const [id, m] of memberById) {
    const last = seenAt.get(id);
    /* known, present, and touched within the hour: nothing to write */
    if (last !== undefined && nowMs - last < DEPART_TOUCH_MS) continue;
    const link = profByDiscord.get(id);
    rows.push({ discord_id: id,
      username: (m.user && (m.user.username || m.user.global_name)) || null,
      display_name: m.nick || (m.user && m.user.global_name) || null,
      profile_id: (link && link.profile_id) || null,
      is_bot: !!(m.user && m.user.bot),
      joined_guild_at: m.joined_at || null,
      last_seen: now, present: true });
  }
  sum.departRowsWritten = rows.length;
  try {
    for (let i = 0; i < rows.length; i += 200) {
      await sbPost("guild_members?on_conflict=discord_id", rows.slice(i, i + 200), "resolution=merge-duplicates,return=minimal");
    }
  } catch (e) { sum.errors.push({ departUpsert: String(e.message || e) }); return; }

  // 2) anyone we knew about who is no longer in the list has left
  const gone = known.filter((k) => !memberById.has(String(k.discord_id)));
  sum.departed = gone.length;
  if (!gone.length) return;
  const share = known.length ? gone.length / known.length : 0;
  const suspicious = share > DEPART_SANITY && gone.length > 5;

  for (const g of gone) {
    const link = profByDiscord.get(String(g.discord_id));
    const days = g.joined_guild_at ? Math.max(0, Math.round((Date.now() - Date.parse(g.joined_guild_at)) / 86400000)) : null;
    try {
      await sbPost("guild_departures", [{
        discord_id: g.discord_id, username: g.username, display_name: g.display_name,
        profile_id: g.profile_id || (link && link.profile_id) || null,
        joined_guild_at: g.joined_guild_at, left_at: now, days_in_server: days,
        was_registered: registered.has(g.profile_id || (link && link.profile_id)),
        club: (link && codeByTeam[link.team_id]) || null,
        had_roles: null
      }]);
      await sbPatch(`guild_members?discord_id=eq.${encodeURIComponent(g.discord_id)}`, { present: false, last_seen: now });
    } catch (e) { sum.errors.push({ departWrite: g.discord_id, error: String(e.message || e) }); }
  }

  if (suspicious) {
    sum.departSuspicious = `${gone.length}/${known.length} in one tick — recorded, not announced`;
    sum.errors.push({ departSanity: sum.departSuspicious });
    return;
  }
  await announceDepartures(gone, profByDiscord, codeByTeam, registered, sum);
}

/* The departures log lives in the Information category beside #welcome and carries the same
   permissions (2026-09-13 — it was a commissioner-only Staff room before). It is found by name and
   never re-permissioned here, so a commissioner's changes in Discord stand; this only creates it
   if it is missing, in the same shape it has today. */
async function ensureDeparturesChannel(guildChannels, roleId, sum) {
  const NAME = "member-departures";
  let ch = guildChannels.find((c) => c.type === 0 && c.name === NAME);
  if (ch) return ch;
  let cat = guildChannels.find((c) => c.type === 4 && /^information\b/i.test(c.name || ""))
         || guildChannels.find((c) => c.type === 4 && /^staff\b/i.test(c.name || ""));
  try {
    ch = await dApi("POST", `/guilds/${GUILD}/channels`, {
      name: NAME, type: 0, parent_id: cat ? cat.id : undefined,
      topic: "Who left the server, posted automatically within a couple of minutes — how long they were around, and whether they had signed up or held a club seat."
      /* no overwrites: it inherits the category exactly as #welcome does */
    });
    if (ch && ch.id) {
      guildChannels.push(ch);
      sum.departChanCreated = 1;
      await dApi("POST", `/channels/${ch.id}/messages`, { embeds: [{
        title: "👋 Member departures",
        description: "Anyone who leaves the server is logged here within a couple of minutes, with how long they were around and whether they had signed up or held a club seat.\n\nDiscord does not tell a bot who left unless it is running a live gateway connection, so this is worked out by comparing each member sweep to the last one. A sweep that fails is skipped rather than guessed at, so a quiet day here means a quiet day, not a broken job.",
        color: 0xFFE500 }] });
    }
    return ch;
  } catch (e) { sum.errors.push({ departChan: String(e.message || e) }); return null; }
}

/* The member's place in the league, described once by the database (member_league_card) so this
   lane and the gateway bot post the same thing. A failed lookup posts the visitor wording rather
   than nothing — the departure itself is already recorded. */
async function leagueCardFor(discordId, sum) {
  try {
    const r = await rfetch(`${SB_URL}/rest/v1/rpc/member_league_card`, { method: "POST", headers: sbHead(), body: JSON.stringify({ p_discord_id: String(discordId) }) });
    if (!r.ok) throw new Error(`member_league_card -> ${r.status}`);
    return await r.json();
  } catch (e) { sum.errors.push({ departCard: String(discordId), error: String(e.message || e) }); return null; }
}

async function announceDepartures(gone, profByDiscord, codeByTeam, registered, sum) {
  const chId = sum.__departChanId;
  if (!chId) { sum.departUnannounced = gone.length; return; }
  /* one message per departure, so each can be replied to — the room is public now, so the post
     is a league notice (who they were to the league, how long they were with us), not a log line */
  for (const g of gone) {
    const link = profByDiscord.get(String(g.discord_id));
    const days = g.joined_guild_at ? Math.max(0, Math.round((Date.now() - Date.parse(g.joined_guild_at)) / 86400000)) : null;
    const who = g.display_name || g.username || (link && link.gamertag) || "A member";
    const card = (await leagueCardFor(g.discord_id, sum)) || { linked: !!link, gamertag: link && link.gamertag, kind: link ? "member" : "none", registered: !!(link && registered.has(link.profile_id)) };
    try {
      await dApi("POST", `/channels/${chId}/messages`, { embeds: [buildDepartureEmbed({ who, card, days })], allowed_mentions: { parse: [] } });
      sum.departAnnounced = (sum.departAnnounced || 0) + 1;
    } catch (e) { sum.errors.push({ departPost: g.discord_id, error: String(e.message || e) }); }
  }
}

/* REINSTATED 2026-09-15 (v2.47) at the league's direction, one day after it was retired in v2.43. */
/* ---- a sign-up does not survive leaving the server ---------------------------------------
   Registering requires being in the Discord (require_guild_membership blocks the INSERT), so the
   list has to hold the same way on the way out. The removal itself is one SECURITY DEFINER RPC:
   pending sign-ups only (never a drafted player's), archived to season_registration_removals
   before deletion, and the member gets a site notification whose click is the server invite.
   The grace window exists for the same reason trackDepartures has its census guards — a
   kick-and-rejoin or a bad read must never cost anyone their sign-up date. */
const SIGNUP_REMOVAL_GRACE_HOURS = 24;
async function removeDepartedSignups(sum) {
  let removed = [];
  try {
    removed = (await sbPost("rpc/remove_departed_signups",
      { p_grace_hours: SIGNUP_REMOVAL_GRACE_HOURS }, "return=representation")) || [];
  } catch (e) { sum.errors.push({ signupRemoval: String(e.message || e) }); return; }
  if (!removed.length) return;
  sum.signupsRemoved = removed.map((r) => r.gamertag || r.profile_id);
  const chId = sum.__departChanId;
  if (!chId) return;
  /* Discord caps an embed description at 4096 chars, and the big batches land exactly when the
     record matters most (first tick against a backlog). Chunk the names so no batch size can
     400 the whole announcement away; each chunk posts independently. */
  const blurb = "\n\nOut of the server for over " + SIGNUP_REMOVAL_GRACE_HOURS + " hours while still on the " +
    "sign-up board — the registration was archived and removed from the pool, and the member " +
    "was told on the site how to come back. Re-registering after a rejoin counts as a fresh sign-up.";
  const chunks = [];
  let cur = [], len = 0;
  for (const n of sum.signupsRemoved) {
    const line = "• **" + n + "**";
    if (cur.length && len + line.length + blurb.length + 64 > 4096) { chunks.push(cur); cur = []; len = 0; }
    cur.push(line); len += line.length + 1;
  }
  if (cur.length) chunks.push(cur);
  for (let i = 0; i < chunks.length; i++) {
    try {
      await dApi("POST", `/channels/${chId}/messages`, { embeds: [{
        title: "📋 Sign-up" + (sum.signupsRemoved.length === 1 ? "" : "s") + " withdrawn" +
          (chunks.length > 1 ? " (" + (i + 1) + "/" + chunks.length + ")" : ""),
        description: chunks[i].join("\n") + (i === chunks.length - 1 ? blurb : ""),
        color: 0xC2410C, timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } });
    } catch (e) { sum.errors.push({ signupRemovalPost: String(e.message || e) }); }
  }
}

async function sbUpsertCfg(key, value) {
  await rfetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key, value: String(value), updated_at: new Date().toISOString() }) });
}

/* The "Team Management" category and its rooms, private to the front office (Owner / GM / AGM)
   plus the league office. Two things changed on 2026-09-17:

   IDENTITY BY ID, NOT NAME. Every room's id is stored in app_config (discord_mgmt_category_id,
   discord_mgmt_room_<slug>_id) and looked up there FIRST; a room found by its stored id is adopted
   whatever it is called now. The name+parent lookup is only the fallback for a room that has no
   stored id yet, and creation happens only when neither finds anything. Keying on the name was how
   a hand rename spawned a duplicate #management-faq (P2-8 in the 09-17 audit) — a rename is a
   commissioner's decision and the sweep follows it.

   RECONCILED EVERY SWEEP, NOT CREATE-ONLY. The rooms were created with their overwrites and never
   looked at again, so #management-announcements let every Owner/GM/AGM post. Each room now has a
   declared kind: a "chat" room (VIEW+SEND+READ for the front office, thread creation denied) or a
   "feed" the office alone posts in (front office VIEW+READ only). The category carries the chat
   shape so a room added by hand inherits a sane baseline before the next sweep sees it.

   Overwrites the sweep did not write (a muted member, a bot's own entry) are kept, with the bits
   the room denies its audience stripped from them — the same rule the Information lock applies. */
const CREATE_THREAD_BITS = (1n << 35n) | (1n << 36n);                      /* CREATE_PUBLIC + CREATE_PRIVATE */
const MGMT_CHAT_ALLOW = 1024n | 2048n | 65536n | (1n << 38n);              /* VIEW + SEND + READ_HISTORY + SEND_IN_THREADS (a forum post is a thread) */
const MGMT_CHAT_DENY = CREATE_THREAD_BITS;
const MGMT_FEED_ALLOW = 1024n | 65536n;                                    /* VIEW + READ_HISTORY */
const MGMT_FEED_DENY = 2048n | (1n << 35n) | (1n << 36n) | (1n << 38n);    /* no messages, no threads, no replies in one */
/* the office: everything a poster needs plus moderation of the room — the same grant the FAQ
   forums give it (FAQ_OFFICE_ALLOW below); declared here as a value, not a name, so the two can
   never be edited apart by accident */
const MGMT_OFFICE_ALLOW = 1024n | 65536n | 2048n | 16384n | 32768n | 8192n | (1n << 34n) | (1n << 35n) | (1n << 36n) | (1n << 38n);
const MGMT_ROOMS = [
  { name: "owners-chat", slug: "owners_chat", type: 0, kind: "chat", audience: "owners",
    topic: "Club owners only (plus the league office). Talk shop with your fellow owners." },
  { name: "management-chat", slug: "management_chat", type: 0, kind: "chat", audience: "mgmt",
    topic: "Everyone in club management — owners, GMs, and AGMs. Anything goes." },
  { name: "management-help", slug: "management_help", type: 15, kind: "chat", audience: "mgmt",
    topic: "Ask the league office anything — post a thread and staff will help." },
  { name: "management-moves", slug: "management_moves", type: 0, kind: "chat", audience: "mgmt",
    topic: "Front-office moves: new owners, GMs, and AGMs voted in, and departures. Auto-posted." },
  { name: "management-announcements", slug: "management_announcements", type: 0, kind: "feed", audience: "mgmt",
    topic: "Notices from the league office to every club's front office. Read-only — questions go in #management-help." },
  { name: "club-ids", slug: "club_ids", type: 0, kind: "feed", audience: "mgmt",
    topic: "Each club's EA club id and Discord ids, posted by the league office. Read-only." },
];
const MGMT_CFG_KEY = (slug) => `discord_mgmt_room_${slug}_id`;
const MGMT_CAT_KEY = "discord_mgmt_category_id";
/* the overwrite set a room of this kind should carry for this audience: @everyone hidden, the
   audience roles by kind, the office in full */
function mgmtOverwrites(kind, audienceIds, officeIds) {
  const allow = kind === "feed" ? MGMT_FEED_ALLOW : MGMT_CHAT_ALLOW;
  const deny = kind === "feed" ? MGMT_FEED_DENY : MGMT_CHAT_DENY;
  return [
    { id: GUILD, type: 0, allow: "0", deny: "1024" },
    ...audienceIds.map((id) => ({ id, type: 0, allow: String(allow), deny: String(deny) })),
    ...officeIds.map((id) => ({ id, type: 0, allow: String(MGMT_OFFICE_ALLOW), deny: "0" })),
  ];
}
/* order-insensitive comparison of two overwrite lists on (id, allow, deny) */
const sameOverwrites = (a, b) => JSON.stringify((a || []).map((o) => [o.id, String(BigInt(o.allow || "0")), String(BigInt(o.deny || "0"))]).sort())
                              === JSON.stringify((b || []).map((o) => [o.id, String(BigInt(o.allow || "0")), String(BigInt(o.deny || "0"))]).sort());
/* desired = ours + everything else that was there, minus the bits this kind denies its audience */
function mgmtDesired(chan, ours, kind) {
  const mine = new Set(ours.map((o) => o.id));
  const strip = kind === "feed" ? MGMT_FEED_DENY : MGMT_CHAT_DENY;
  const keep = (chan.permission_overwrites || []).filter((o) => !mine.has(o.id))
    .map((o) => ({ id: o.id, type: o.type, allow: String(BigInt(o.allow || "0") & ~strip), deny: String(o.deny || "0") }));
  return [...ours, ...keep];
}
/* find a channel by its stored id first (adopting a rename), then by name under the category */
function findMgmtChannel(guildChannels, storedId, name, catId, types) {
  if (storedId) {
    const byId = guildChannels.find((c) => c.id === storedId && types.includes(c.type));
    if (byId) return { ch: byId, via: "id" };
  }
  const byName = guildChannels.find((c) => c.name === name && c.parent_id === catId && types.includes(c.type));
  return byName ? { ch: byName, via: "name" } : { ch: null, via: null };
}
async function ensureMgmtCategory(guildChannels, roleId, sum) {
  const owner = roleId["owner"], gm = roleId["general manager"], agm = roleId["assistant general manager"];
  const office = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  if (!owner || !gm || !agm || office.length < 2) return; // roles not provisioned yet — try next run
  const audienceOf = { owners: [owner], mgmt: [owner, gm, agm] };
  const cfg = await sbCfgMany([MGMT_CAT_KEY, ...MGMT_ROOMS.map((r) => MGMT_CFG_KEY(r.slug))]);

  let cat = cfg[MGMT_CAT_KEY] ? guildChannels.find((c) => c.id === cfg[MGMT_CAT_KEY] && c.type === 4) : null;
  if (!cat) cat = guildChannels.find((c) => c.type === 4 && (c.name || "").toLowerCase() === "team management");
  const catOurs = mgmtOverwrites("chat", audienceOf.mgmt, office);
  if (!cat) {
    cat = await dApi("POST", `/guilds/${GUILD}/channels`, { name: "Team Management", type: 4, permission_overwrites: catOurs });
    guildChannels.push(cat); sum.mgmtCatCreated = 1;
  } else {
    const want = mgmtDesired(cat, catOurs, "chat");
    if (!sameOverwrites(cat.permission_overwrites, want)) {
      try { await dApi("PATCH", `/channels/${cat.id}`, { permission_overwrites: want }); cat.permission_overwrites = want; sum.mgmtRoomsHealed = (sum.mgmtRoomsHealed || 0) + 1; }
      catch (e) { sum.errors.push({ mgmtCat: String(e.message || e) }); }
    }
  }
  if (cat && cat.id && cfg[MGMT_CAT_KEY] !== cat.id) await sbUpsertCfg(MGMT_CAT_KEY, cat.id).catch(() => {});
  const catId = cat.id;

  async function ensure(spec) {
    const ours = mgmtOverwrites(spec.kind, audienceOf[spec.audience], office);
    const key = MGMT_CFG_KEY(spec.slug);
    /* a forum that had to fall back to a text room is still this room — accept either type */
    const types = spec.type === 15 ? [15, 0] : [spec.type];
    let { ch, via } = findMgmtChannel(guildChannels, cfg[key], spec.name, catId, types);
    if (ch) {
      if (via === "id" && (ch.name !== spec.name || ch.parent_id !== catId)) sum.mgmtRoomsAdopted = (sum.mgmtRoomsAdopted || 0) + 1;
      const want = mgmtDesired(ch, ours, spec.kind);
      if (!sameOverwrites(ch.permission_overwrites, want)) {
        try { await dApi("PATCH", `/channels/${ch.id}`, { permission_overwrites: want }); ch.permission_overwrites = want; sum.mgmtRoomsHealed = (sum.mgmtRoomsHealed || 0) + 1; }
        catch (e) { sum.errors.push({ mgmtChan: spec.name, error: String(e.message || e) }); }
      }
      if (cfg[key] !== ch.id) await sbUpsertCfg(key, ch.id).catch(() => {});
      return ch;
    }
    const base = { name: spec.name, parent_id: catId, permission_overwrites: ours, topic: spec.topic };
    try {
      ch = await dApi("POST", `/guilds/${GUILD}/channels`, { ...base, type: spec.type });
    } catch (e) {
      // a forum (type 15) needs a Community server; fall back to a text room so the space still exists
      if (spec.type !== 15) { sum.errors.push({ mgmtChan: spec.name, error: String(e.message || e) }); return null; }
      try { ch = await dApi("POST", `/guilds/${GUILD}/channels`, { ...base, type: 0 }); sum.mgmtHelpFellBackToText = 1; }
      catch (e2) { sum.errors.push({ mgmtChan: spec.name, error: String(e2.message || e2) }); return null; }
    }
    if (!ch || !ch.id) return null;
    guildChannels.push(ch); sum.mgmtChansCreated = (sum.mgmtChansCreated || 0) + 1;
    await sbUpsertCfg(key, ch.id).catch(() => {});
    return ch;
  }
  let moves = null;
  for (const spec of MGMT_ROOMS) {
    const ch = await ensure(spec);
    if (spec.name === "management-moves") moves = ch;
  }
  if (moves && moves.id) {
    try {
      const hooks = await dApi("GET", `/channels/${moves.id}/webhooks`);
      let hook = Array.isArray(hooks) ? hooks.find((h) => h.name === "CGHL Moves" && h.token) : null;
      if (!hook) hook = await dApi("POST", `/channels/${moves.id}/webhooks`, { name: "CGHL Moves" });
      if (hook && hook.id && hook.token) { await sbUpsertCfg("discord_mgmt_moves_webhook", `https://discord.com/api/webhooks/${hook.id}/${hook.token}`); sum.mgmtMovesHook = 1; }
    } catch (e) { sum.errors.push({ mgmtMovesHook: String(e.message || e) }); }
  }
}

/* The two FAQ forums (2026-09-17): where the league office posts the how-to guides — one thread
   per guide — and members ask under them. #management-faq sits in Team Management for the front
   office; #player-faq sits in General for every member (the sign-up guide is for people who are
   not rostered yet). Only the office opens posts; everyone who can see the forum may reply in a
   thread and react. Idempotent: creates what is missing and reconciles the overwrites every run,
   so a hand-edit that reopens posting to everyone self-corrects.

   A forum is identified by the id stored in app_config (discord_management_faq_channel_id /
   discord_player_faq_channel_id) FIRST: if that channel still exists and is a forum, it is the
   forum, whatever it has been renamed to. The name+parent lookup only serves a forum with no
   stored id, and creation happens only when neither finds one. The day this shipped, #management-faq
   was renamed by hand and the name-keyed version of this code created an empty duplicate beside
   the one holding the seeded guides. */
const FAQ_VIEW = 1024n | 65536n;                                   /* VIEW + READ_HISTORY */
const FAQ_MEMBER_ALLOW = FAQ_VIEW | 64n | (1n << 38n);              /* + ADD_REACTIONS + SEND_IN_THREADS */
const FAQ_MEMBER_DENY = 2048n | (1n << 35n) | (1n << 36n);          /* no posts of their own (SEND, CREATE_*_THREADS) */
const FAQ_OFFICE_ALLOW = FAQ_VIEW | 2048n | 16384n | 32768n | 8192n | (1n << 34n) | (1n << 35n) | (1n << 36n) | (1n << 38n);
                                                                   /* + SEND + EMBED + ATTACH + MANAGE_MESSAGES + MANAGE_THREADS + every thread bit */
const FAQ_CFG_KEY = (name) => "discord_" + name.replace(/-/g, "_") + "_channel_id";
async function ensureFaqForums(guildChannels, roleId, sum) {
  const office = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  const front = ["owner", "general manager", "assistant general manager"].map((n) => roleId[n]).filter(Boolean);
  if (office.length < 2 || front.length < 3) return;             /* roles not provisioned yet — next run */
  const cat = (name) => (guildChannels || []).find((c) => c.type === 4 && (c.name || "").toLowerCase() === name);
  const mgmtCat = cat("team management"), genCat = cat("general");
  const overwrites = (everyoneAllow, everyoneDeny, memberRoles) => [
    { id: GUILD, type: 0, allow: String(everyoneAllow), deny: String(everyoneDeny) },
    ...memberRoles.map((id) => ({ id, type: 0, allow: String(FAQ_MEMBER_ALLOW), deny: String(FAQ_MEMBER_DENY) })),
    ...office.map((id) => ({ id, type: 0, allow: String(FAQ_OFFICE_ALLOW), deny: "0" })),
  ];
  const FORUMS = [
    { name: "management-faq", parent: mgmtCat, ow: overwrites(0n, 1024n, front),
      topic: "How-to guides for the front office — lineups, trades, waivers, the draft, the banned-ability list. One post per guide, kept current by the league office. Ask under the guide it belongs to; for anything else, #management-help.",
      tags: [{ name: "Lineups" }, { name: "Trades" }, { name: "Waivers" }, { name: "Draft" }, { name: "Rules" }] },
    { name: "player-faq", parent: genCat, ow: overwrites(FAQ_MEMBER_ALLOW, FAQ_MEMBER_DENY, []),
      topic: "How-to guides for every player — signing up, availability, the banned-ability list. One post per guide, kept current by the league office. Ask under the guide it belongs to.",
      tags: [{ name: "Getting started" }, { name: "Availability" }, { name: "Rules" }] },
  ];
  const cfg = await sbCfgMany(FORUMS.map((f) => FAQ_CFG_KEY(f.name)));
  for (const f of FORUMS) {
    const key = FAQ_CFG_KEY(f.name);
    /* by stored id first — a forum, wherever it sits and whatever it is called now */
    let ch = cfg[key] ? (guildChannels || []).find((c) => c.id === cfg[key] && c.type === 15) : null;
    if (ch && (ch.name !== f.name || (f.parent && ch.parent_id !== f.parent.id))) sum.faqForumsAdopted = (sum.faqForumsAdopted || 0) + 1;
    if (!ch) {
      if (!f.parent) continue;
      ch = (guildChannels || []).find((c) => c.name === f.name && c.parent_id === f.parent.id && c.type === 15);
    }
    try {
      if (!ch) {
        ch = await dApi("POST", `/guilds/${GUILD}/channels`, { name: f.name, type: 15, parent_id: f.parent.id, topic: f.topic,
          permission_overwrites: f.ow, available_tags: f.tags, default_sort_order: 0 });
        guildChannels.push(ch); sum.faqForumsCreated = (sum.faqForumsCreated || 0) + 1;
      } else if (!sameOverwrites(ch.permission_overwrites, f.ow)) {
        await dApi("PATCH", `/channels/${ch.id}`, { permission_overwrites: f.ow });
        ch.permission_overwrites = f.ow; sum.faqForumsHealed = (sum.faqForumsHealed || 0) + 1;
      }
      if (ch && ch.id && cfg[key] !== ch.id) await sbUpsertCfg(key, ch.id).catch(() => {});
    } catch (e) { sum.errors.push({ faqForum: f.name, error: String(e.message || e) }); }
  }
}

// Club rooms and roles are created once and then left alone, which meant a club that rebranded or
// relocated kept its old Discord identity forever — the site said Canucks, Discord still said
// Senators. Reconcile the name, colour and topic against the DB every run, PATCHing in place so the
// role keeps its id, position and members and the channel keeps its history. Rename only: nothing
// here creates or deletes.
async function syncClubIdentity(guildChannels, guildRoles, teams, sum) {
  const snapshot = [];
  /* One gradient probe per sweep: if Discord refuses the first colors PATCH because the guild
     lacks ENHANCED_ROLE_COLORS (a boost-gated feature), every later club skips straight to flat
     color this sweep instead of burning nine more doomed API calls every two minutes. The flag
     resets next sweep, so the moment the server is boosted the gradients apply themselves. */
  let gradientBlocked = false;
  for (const t of teams) {
    if (!t.name) continue;
    const wantRole = t.name;
    const wantChan = slug(t.name);
    const wantColor = /^#?[0-9a-f]{6}$/i.test(t.color || "") ? parseInt(String(t.color).replace("#", ""), 16) : 0;
    /* null = no secondary on file; 0 is a legitimate value (pure black), so the sentinel must
       not be falsy-conflated with it */
    const wantColor2 = /^#?[0-9a-f]{6}$/i.test(t.color2 || "") ? parseInt(String(t.color2).replace("#", ""), 16) : null;

    if (t.discord_role_id) {
      const role = guildRoles.find((r) => r.id === t.discord_role_id);
      if (role && !role.managed) {
        const patch = {};
        if (role.name !== wantRole) patch.name = wantRole;
        /* Both club colors on file -> a two-color gradient role (Discord's enhanced role styles).
           The `colors` object supersedes the flat `color`; primary_color doubles as the fallback
           everywhere gradients don't render. Requires the ENHANCED_ROLE_COLORS guild feature
           (server boosts) — if Discord refuses, fall back to the flat primary and record why,
           rather than erroring the whole sweep. */
        const curColors = role.colors || {};
        const cur1 = curColors.primary_color != null ? curColors.primary_color : role.color;
        const curSecondary = curColors.secondary_color != null ? curColors.secondary_color : null;
        if (wantColor && wantColor2 != null && !gradientBlocked) {
          if (cur1 !== wantColor || curSecondary !== wantColor2) {
            patch.colors = { primary_color: wantColor, secondary_color: wantColor2 };
          }
        } else if (wantColor) {
          /* no secondary wanted: clear a stale gradient if one is showing, else fix flat drift */
          if (wantColor2 == null && curSecondary != null && !gradientBlocked) {
            patch.colors = { primary_color: wantColor, secondary_color: null };
          } else if (role.color !== wantColor) patch.color = wantColor;
        }
        if (Object.keys(patch).length) {
          try {
            await dApi("PATCH", `/guilds/${GUILD}/roles/${role.id}`, patch);
            if (patch.colors) { role.colors = patch.colors; role.color = patch.colors.primary_color; sum.roleGradients = (sum.roleGradients || 0) + 1; }
            Object.assign(role, patch.colors ? { name: patch.name || role.name } : patch);
            sum.clubRolesRenamed = (sum.clubRolesRenamed || 0) + 1;
          } catch (e) {
            const msg = String(e.message || e);
            /* Only a 400 means "this guild can't do gradients" — a 5xx or a network blip is
               transient, must NOT set the blocked flag, and simply retries next sweep. */
            if (patch.colors && / -> 400\b/.test(msg)) {
              gradientBlocked = true;
              sum.roleGradientUnsupported = msg.slice(0, 100);
              const flat = {};
              if (patch.name) flat.name = patch.name;
              if (role.color !== wantColor) flat.color = wantColor;
              if (Object.keys(flat).length) {
                try {
                  await dApi("PATCH", `/guilds/${GUILD}/roles/${role.id}`, flat);
                  Object.assign(role, flat);
                  sum.clubRolesRenamed = (sum.clubRolesRenamed || 0) + 1;
                } catch (e2) { sum.errors.push({ clubRole: t.code, error: String(e2.message || e2) }); }
              }
            } else sum.errors.push({ clubRole: t.code, error: msg });
          }
        }
      }
    }
    if (t.discord_channel_id) {
      const chan = guildChannels.find((c) => c.id === t.discord_channel_id);
      if (chan) {
        const wantTopic = `Private room for the ${t.name} — roster, lineups, and team talk. Visible only to the club and staff.`;
        const patch = {};
        if (chan.name !== wantChan) patch.name = wantChan;
        if ((chan.topic || "") !== wantTopic) patch.topic = wantTopic;
        if (Object.keys(patch).length) {
          try {
            await dApi("PATCH", `/channels/${chan.id}`, patch);
            Object.assign(chan, patch);
            sum.clubRoomsRenamed = (sum.clubRoomsRenamed || 0) + 1;
          } catch (e) { sum.errors.push({ clubRoom: t.code, error: String(e.message || e) }); }
        }
      }
    }
    snapshot.push(`${t.code}=${wantRole}/#${wantChan}`);
  }
  // the ?diag= endpoints are unreachable on a scheduled function, so leave the mapping readable
  try { await sbUpsertCfg("discord_club_identity", JSON.stringify(snapshot)); } catch (e) { /* observability only */ }
}

// Role icons — the club crest on the club role, the referee jersey on Staff, the server icon on
// Commissioner.
//
// Needs Boost Level 2; without it Discord rejects the PATCH, so the guild's feature list is checked
// first and the run records WHY it skipped rather than failing silently. If the boosts lapse the
// icons stay on the roles Discord-side and this simply stops reconciling them.
//
// Every mark is now fetched at run time from its own source of truth: a club's from the logo on the
// site, Commissioner's from the guild icon, Staff's from the one fixed PNG in the repo. Nothing is
// pre-rendered, so "the shipped image no longer matches the site" is not a state that can exist.
//
// Idempotent by source: an applied-map of roleId -> source is compared each run, and a role is only
// fetched and PATCHed when its source actually changes. A normal tick does no image work at all.
/* A club's role icon, rendered LIVE from the logo the club uploaded on the site.

   The old pipeline shipped hand-rendered PNGs in assets/role-icons/ keyed by a manifest, because
   the site stores logos as WebP and Discord refuses WebP — decoding it inside the function would
   have meant a native image dependency. That made every new club and every re-brand a manual
   commit, and Montreal sat without an icon for days as a result.

   Supabase's own image transformer removes the problem: request the object through
   /storage/v1/render/image/... and it returns image/png, resized, with no dependency at all.
   So the logo a commissioner uploads becomes the Discord role icon on the next sweep. */
async function fetchClubLogoPng(logoUrl) {
  if (!logoUrl) return null;
  /* /object/public/<bucket>/<path>  ->  /render/image/public/<bucket>/<path> */
  let url = logoUrl.includes("/storage/v1/object/public/")
    ? logoUrl.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") +
      (logoUrl.includes("?") ? "&" : "?") + "width=128&height=128&resize=contain"
    : logoUrl;
  const r = await fetch(url, { signal: deadline(SB_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`logo ${r.status}`);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  /* Discord accepts png/jpeg/gif only. The transformer answers png; a non-Supabase URL might not,
     and silently PATCHing a WebP would fail per-role every sweep forever. */
  if (!/^image\/(png|jpe?g|gif)/.test(ct)) throw new Error(`logo is ${ct || "unknown"}, not png/jpeg/gif`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 240 * 1024) throw new Error(`logo is ${Math.round(buf.length/1024)}KB, over Discord's limit`);
  return { data: `data:${ct.split(";")[0]};base64,${buf.toString("base64")}` };
}

/* Fixed artwork shipped with the repo — Staff's referee jersey, and only that. Clubs used to come
   from here too, keyed by a manifest that recorded which logo_url each PNG had been rendered from;
   they now render live, and the manifest is gone with them. It was worse than redundant: the version
   marker lived in two places (the `local:` string below and the manifest entry), so following the
   manifest's own instruction to "bump the version to force a re-apply" made the two disagree and
   parked the icon in `stale-render` permanently. The marker is a single string in this file now. */
function readRoleIcon(code) {
  const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd(), HERE,
                 path.join(HERE, "..", ".."), path.join(HERE, "..", "..", "..")].filter(Boolean);
  for (const r of roots) {
    /* assets/, not netlify/functions/: Netlify treats every subdirectory of the functions dir as a
       function candidate, so bundled assets have to sit outside it. */
    for (const rel of [["assets", "role-icons"], ["role-icons"]]) {
      try {
        const img = path.join(r, ...rel, `${code}.png`);
        if (!fs.existsSync(img)) continue;
        return { data: "data:image/png;base64," + fs.readFileSync(img).toString("base64") };
      } catch (e) { /* try the next candidate root */ }
    }
  }
  return null;
}

/* The guild icon straight off Discord's CDN, already PNG. size=128 keeps it well inside the 256KB
   role-icon limit without any resampling on our side. */
async function fetchGuildIconPng(hash) {
  if (!hash) return null;
  try {
    const r = await rfetch(`https://cdn.discordapp.com/icons/${GUILD}/${hash}.png?size=128`,
      { headers: { "User-Agent": UA } }, 3, DISCORD_TIMEOUT_MS);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 240 * 1024) return null;
    return { data: "data:image/png;base64," + buf.toString("base64") };
  } catch (e) { return null; }
}

async function syncRoleIcons(guildRoles, teams, roleId, sum) {
  const guild = await dApi("GET", `/guilds/${GUILD}`);
  const features = (guild && guild.features) || [];
  /* answers "do we even have a screening gate?" from the horse's mouth, and the true member count
     with it — the client sidebar rounds, this does not */
  sum.gate = features.includes("MEMBER_VERIFICATION_GATE_ENABLED");
  sum.guildMemberCount = guild && guild.approximate_member_count;
  if (!features.includes("ROLE_ICONS")) {
    await sbUpsertCfg("discord_role_icons", JSON.stringify({
      at: new Date().toISOString(), skipped: "guild lacks ROLE_ICONS (needs Boost Level 2)" }));
    return;
  }

  const want = {};                                  // roleId -> { code, src }
  for (const t of teams) {
    if (t.discord_role_id && t.logo_url) want[t.discord_role_id] = { code: t.code, src: t.logo_url };
  }
  /* Staff wears the referee jersey — fixed artwork in the repo rather than anything from the DB, so
     its "source" is a version marker. Bump this string to force a re-apply; it is the only copy. */
  const staffId = roleId["staff"];
  if (staffId) want[staffId] = { code: "STAFF", src: "local:referee-jersey-v2" };

  /* Commissioner wears the server's own icon. Taken live from the guild rather than shipped:
     Discord's CDN already serves it as PNG, so there is nothing to pre-render and nothing to keep
     in sync — change the server icon and this follows on the next tick. */
  const commishId = roleId["commissioner"];
  const guildIcon = guild && guild.icon;
  if (commishId && guildIcon) want[commishId] = { code: "GUILD", src: `guild-icon:${guildIcon}` };

  let applied = {};
  try {
    const rows = await sbGet("app_config?key=eq.discord_role_icons_applied&select=value");
    if (rows && rows[0] && rows[0].value) applied = JSON.parse(rows[0].value);
  } catch (e) { /* first run, or unreadable — treat as nothing applied */ }

  const snap = [];
  const todo = Object.keys(want).filter((rid) => applied[rid] !== want[rid].src);

  /* The bot's own avatar, matched to the server icon. PATCH /users/@me is rate-limited far harder
     than role edits (a couple of changes an hour), so this is gated on the icon hash and runs at
     most once per change — never on a normal tick. A failure here is recorded and dropped: the
     avatar is cosmetic and must not cost the sync its role work.

     This is deliberately ABOVE the `todo` early return. It used to sit at the end of the function,
     which made a failed avatar PATCH permanent: the failure leaves `applied.__botAvatar` unset but
     the run still persists `applied`, so the next sweep finds `todo` empty, returns before ever
     reaching the retry, and the bot keeps the wrong avatar until some unrelated icon changes. The
     hash gate below is the intended "at most once per change" guard; `todo` was never meant to be a
     second one. */
  let avatarChanged = false;
  if (guildIcon && applied.__botAvatar !== guildIcon) {
    const av = await fetchGuildIconPng(guildIcon);
    if (av) {
      try {
        await dApi("PATCH", "/users/@me", { avatar: av.data });
        applied.__botAvatar = guildIcon;
        avatarChanged = true;
        snap.push("BOT=ok");
      } catch (e) {
        snap.push("BOT=error");
        sum.errors.push({ botAvatar: String(e.message || e) });
      }
    }
  }

  /* nothing changed anywhere: read no files, call nothing. `avatarChanged` keeps a successful
     avatar-only run from returning before its result is written down. */
  if (!todo.length && !avatarChanged) return;

  /* One-shot diagnostic for the single remaining bundled file. If STAFF.png cannot be found, record
     WHERE the function actually looked and what is there, rather than reporting "no-image" forever
     with no way to tell whether the included_files glob, the path or the deploy is at fault. */
  if (todo.length && !readRoleIcon("STAFF")) {
    const probe = [];
    const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd(), HERE,
                   path.join(HERE, ".."), path.join(HERE, "..", "..")].filter(Boolean);
    for (const r of roots) {
      let listing = "unreadable";
      try { listing = fs.readdirSync(r).slice(0, 14).join(","); } catch (e) { listing = String(e.code || e); }
      probe.push({ root: r, entries: listing,
                   hasAssets: (() => { try { return fs.existsSync(path.join(r, "assets")); } catch (e) { return "?"; } })() });
    }
    try { await sbUpsertCfg("discord_role_icons_probe", JSON.stringify(probe).slice(0, 3000)); } catch (e) { /* observability */ }
  }
  for (const rid of todo) {
    const w = want[rid];
    const role = guildRoles.find((r) => r.id === rid);
    if (!role || role.managed) { snap.push(`${w.code}=no-role`); continue; }
    let img;
    try {
      if (w.code === "GUILD") {
        img = await fetchGuildIconPng(guildIcon);
      } else if (w.src && /^https?:/.test(w.src)) {
        /* a club: render straight from the uploaded logo, so a new or re-branded club needs no
           commit. `applied[rid]` is keyed on the logo URL, so this re-applies exactly when the
           club changes its logo and never otherwise. */
        img = await fetchClubLogoPng(w.src);
      } else {
        img = readRoleIcon(w.code);                // STAFF: fixed artwork shipped with the repo
      }
    } catch (e) {
      snap.push(`${w.code}=logo-error`);
      sum.errors.push({ roleIcon: w.code, error: String(e.message || e) });
      continue;
    }
    if (!img) { snap.push(`${w.code}=no-image`); continue; }
    try {
      await dApi("PATCH", `/guilds/${GUILD}/roles/${rid}`, { icon: img.data });
      applied[rid] = w.src;
      sum.roleIcons = (sum.roleIcons || 0) + 1;
      snap.push(`${w.code}=ok`);
    } catch (e) {
      snap.push(`${w.code}=error`);
      sum.errors.push({ roleIcon: w.code, error: String(e.message || e) });
    }
  }
  try { await sbUpsertCfg("discord_role_icons_applied", JSON.stringify(applied)); } catch (e) { /* retried next run */ }
  try { await sbUpsertCfg("discord_role_icons", JSON.stringify({ at: new Date().toISOString(), result: snap })); } catch (e) { /* observability only */ }
}

// #announcements under an Information category: everyone reads, only the commissioners write —
// the same lock enforceReadOnlyCategories holds on every channel under Information (2026-09-13;
// Staff used to be granted posting here too). Its webhook is stored so the site can post league
// news without a bot token. Creation only — if the channel already exists under Information we
// adopt it and just make sure the hook is on file.
async function ensureAnnouncements(guildChannels, roleId, sum) {
  const office = ["commissioner"].map((n) => roleId[n]).filter(Boolean);
  if (office.length < 1) return;                       // role not provisioned yet — try next run

  let cat = guildChannels.find((c) => c.type === 4 && (c.name || "").toLowerCase() === "information");
  if (!cat) {
    try {
      cat = await dApi("POST", `/guilds/${GUILD}/channels`, { name: "Information", type: 4 });
      guildChannels.push(cat); sum.infoCatCreated = 1;
    } catch (e) { sum.errors.push({ infoCat: String(e.message || e) }); return; }
  }

  let ch = guildChannels.find((c) => c.type !== 4 && (c.name || "").toLowerCase() === "announcements");
  if (!ch) {
    try {
      ch = await dApi("POST", `/guilds/${GUILD}/channels`, {
        name: "announcements", type: 0, parent_id: cat.id,
        topic: "League announcements from the commissioners. Read-only — discussion goes in the forums or #general.",
        permission_overwrites: [
          { id: GUILD, type: 0, allow: String(INFO_EVERYONE_ALLOW), deny: String(INFO_EVERYONE_DENY) },   // everyone: read; no messages, no threads
          ...office.map((id) => ({ id, type: 0, allow: String(INFO_POSTER_ALLOW), deny: "0" })),
        ],
      });
      guildChannels.push(ch); sum.announcementsCreated = 1;
    } catch (e) { sum.errors.push({ announcements: String(e.message || e) }); return; }
  }

  try {
    const hooks = await dApi("GET", `/channels/${ch.id}/webhooks`);
    let hook = Array.isArray(hooks) ? hooks.find((h) => h.name === "CGHL Announcements" && h.token) : null;
    if (!hook) hook = await dApi("POST", `/channels/${ch.id}/webhooks`, { name: "CGHL Announcements" });
    if (hook && hook.id && hook.token) {
      await sbUpsertCfg("discord_announcements_webhook", `https://discord.com/api/webhooks/${hook.id}/${hook.token}`);
      sum.announcementsHook = 1;
    }
  } catch (e) { sum.errors.push({ announcementsHook: String(e.message || e) }); }
}

// Community + game-night channels: a public #pickup-games and #draft-hub, per-club voice rooms (private to
// the club + office, mirroring the club text rooms), and a couple of public Game Voice lobbies for
// scrims. Creation only — never deletes an existing channel. Idempotent by name+parent.
async function ensureCommunityChannels(guildChannels, teams, roleId, sum) {
  const cat = (name) => guildChannels.find((c) => c.type === 4 && (c.name || "").toLowerCase() === name);
  const office = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  const generalCat = cat("general"), gamesCat = cat("games"), teamRoomsCat = cat("team rooms");

  // Creates the channel if missing. If oldNames is given and a channel by one of those names still
  // exists, it's RENAMED in place (keeping its position, history, and id) instead of a duplicate being
  // made — this is how #lfg was migrated to #pickup-games without the sweep recreating the old name.
  async function ensurePublicText(name, parentId, topic, oldNames) {
    /* returns the channel in every successful path — callers that need to hang a webhook off it
       (the draft feed) must be able to find it whether it existed, was renamed, or was created */
    if (!parentId) return null;
    const existing = guildChannels.find((c) => c.type === 0 && c.name === name);
    if (existing) {
      // keep the topic current on an already-present channel (e.g. the /lfg -> /join wording) without recreating it
      if (topic && existing.topic !== topic) {
        try { await dApi("PATCH", `/channels/${existing.id}`, { topic }); existing.topic = topic; sum.communityChansRetopic = (sum.communityChansRetopic || 0) + 1; }
        catch (e) { sum.errors.push({ communityChanTopic: name, error: String(e.message || e) }); }
      }
      return existing;
    }
    const prev = (oldNames && oldNames.length)
      ? guildChannels.find((c) => c.type === 0 && oldNames.includes(c.name)) : null;
    if (prev) {
      try { await dApi("PATCH", `/channels/${prev.id}`, { name, topic }); prev.name = name;
        sum.communityChansRenamed = (sum.communityChansRenamed || 0) + 1; return prev;
      } catch (e) { sum.errors.push({ communityChanRename: name, error: String(e.message || e) }); }
    }
    try { const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { name, type: 0, parent_id: parentId, topic });
      guildChannels.push(ch); sum.communityChansCreated = (sum.communityChansCreated || 0) + 1; return ch;
    } catch (e) { sum.errors.push({ communityChan: name, error: String(e.message || e) }); }
    return null;
  }
  // #pickup-games (formerly #lfg) — the /join pickup lobbies live here.
  await ensurePublicText("pickup-games", generalCat && generalCat.id, "Pickup games — run /join to line up 6s and scrims. Call your position and go.", ["lfg"]);
  const draftHub = await ensurePublicText("draft-hub", gamesCat && gamesCat.id, "Watch the CGHL entry draft live and talk picks — the draft itself runs on the site.");
  /* the per-pick feed: a DB trigger posts every selection through this webhook the moment it
     lands (notify_discord_draft_pick). Maintained here the same way the mgmt-moves hook is. */
  if (draftHub && draftHub.id) {
    try {
      const hooks = await dApi("GET", `/channels/${draftHub.id}/webhooks`);
      let hook = Array.isArray(hooks) ? hooks.find((h) => h.name === "CGHL Draft" && h.token) : null;
      if (!hook) hook = await dApi("POST", `/channels/${draftHub.id}/webhooks`, { name: "CGHL Draft" });
      if (hook && hook.id && hook.token) { await sbUpsertCfg("discord_draft_webhook", `https://discord.com/api/webhooks/${hook.id}/${hook.token}`); sum.draftHook = 1; }
    } catch (e) { sum.errors.push({ draftHook: String(e.message || e) }); }
  }

  // "Pickup Lobbies" category — each filled /join lobby gets its own channel here (created by the
  // interactions endpoint on fill, removed by the sweep below). Stash its id so that endpoint finds it.
  try {
    let plCat = cat("pickup lobbies");
    if (!plCat) {
      plCat = await dApi("POST", `/guilds/${GUILD}/channels`, { name: "Pickup Lobbies", type: 4 });
      if (plCat && plCat.id) { guildChannels.push(plCat); sum.pickupCatCreated = 1; }
    }
    if (plCat && plCat.id) await sbUpsertCfg("pickup_lobby_category_id", plCat.id);
  } catch (e) { sum.errors.push({ pickupCat: String(e.message || e) }); }

  // Sweep spent pickup-lobby channels: any lobby marked closed (staff hit Delete), or untouched for
  // 12h, has its channel (thread_id) removed and the marker cleared. Idempotent; a 404 is fine.
  try {
    const now = Date.now();
    const rooms = await sbGet("lfg_lobbies?thread_id=not.is.null&select=id,thread_id,status,updated_at&order=updated_at.asc&limit=100");
    for (const lo of (rooms || [])) {
      const stale = lo.status === "closed" || (now - Date.parse(lo.updated_at) > 12 * 3600 * 1000);
      if (!stale) continue;
      try { await dApi("DELETE", `/channels/${lo.thread_id}`); } catch (e) { /* already gone */ }
      /* Reaping a lobby MUST also close it. The one-game-at-a-time gate blocks any player whose
         lobby is still in an active state (captains/drafting/server/done); clearing only thread_id
         left all 12 players permanently unable to queue again. Close it so they are released. */
      await sbPatch(`lfg_lobbies?id=eq.${lo.id}`, { thread_id: null, status: "closed", updated_at: new Date().toISOString() });
      sum.pickupRoomsSwept = (sum.pickupRoomsSwept || 0) + 1;
    }
    // Stuck lobbies that NEVER got a channel: a formed lobby whose room-creation failed keeps
    // thread_id null forever, so the reaper above never saw it and its 12 players stayed locked
    // out with no room at all. Close any active-state, channel-less lobby older than 12h.
    const orphans = await sbGet("lfg_lobbies?thread_id=is.null&status=in.(captains,drafting,server,done)&select=id,updated_at&order=updated_at.asc&limit=100");
    for (const lo of (orphans || [])) {
      if (now - Date.parse(lo.updated_at) <= 12 * 3600 * 1000) continue;
      await sbPatch(`lfg_lobbies?id=eq.${lo.id}`, { status: "closed", updated_at: new Date().toISOString() });
      sum.pickupOrphansClosed = (sum.pickupOrphansClosed || 0) + 1;
    }
  } catch (e) { sum.errors.push({ pickupSweep: String(e.message || e) }); }

  // Clubs do NOT get their own voice rooms — teams use the shared Game Voice lobbies below.
  // (?reconcile=teams removes any per-club voice channel left over from the old behavior.)
  // public Game Voice lobbies for scrims / mixed groups on game night
  if (gamesCat) {
    for (const vn of ["Game Voice 1", "Game Voice 2"]) {
      if (guildChannels.find((c) => c.type === 2 && c.name === vn && c.parent_id === gamesCat.id)) continue;
      try { const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { name: vn, type: 2, parent_id: gamesCat.id });
        guildChannels.push(ch); sum.gameVoiceCreated = (sum.gameVoiceCreated || 0) + 1;
      } catch (e) { sum.errors.push({ gameVoice: vn, error: String(e.message || e) }); }
    }
  }

  // One-time cleanup: remove the stray duplicate #league-advertisement (a topic-less Staff dup of
  // #advertisement). Guarded by a config flag so this runs exactly once and the recurring sweep
  // never deletes a future channel someone deliberately names that.
  try {
    const done = await sbGet("app_config?key=eq.cleanup_league_advertisement_done&select=value");
    if (!(Array.isArray(done) && done.length)) {
      const dup = guildChannels.find((c) => c.type === 0 && c.name === "league-advertisement");
      if (dup) { await dApi("DELETE", `/channels/${dup.id}`); sum.dupAdChanDeleted = 1;
        const i = guildChannels.indexOf(dup); if (i >= 0) guildChannels.splice(i, 1); }
      await sbUpsertCfg("cleanup_league_advertisement_done", "1");
    }
  } catch (e) { sum.errors.push({ dupAdCleanup: String(e.message || e) }); }
}

// Staff departments — one Discord role + one private room per office lane, all under the Staff
// category. Each room is visible to its department AND the commissioners (oversight), not to all
// staff. The list itself lives in shared/roles.mjs (imported above) because the gateway bot's
// instant role sync grants the same department roles and the two must never diverge.

// Ensure the department roles (mentionable) and a private room per department under the Staff
// category. Idempotent: creates only what's missing, never deletes. VIEW+SEND+READ_HISTORY=68608.
/* Give every club a Discord role + private room. This used to run only from the gated
   ?reconcile=teams action, which was fine while clubs were created by hand — but an owner
   application can now stand a club up on its own, and that club would sit on the site with no
   Discord presence until someone remembered to reconcile. Runs on the normal sweep instead:
   it's a no-op for clubs that already have both. */
async function ensureClubRooms(guildChannels, guildRoles, teams, roleId, sum) {
  const teamRoomsCat = guildChannels.find((c) => c.type === 4 && (c.name || "").toLowerCase() === "team rooms");
  // A club room is for THAT club plus the league office — and the office is Commissioner + Staff
  // ONLY. The seat roles (Owner / General Manager / Assistant GM) are worn by every club's front
  // office at once, so granting them here would have handed all five front offices a key to all
  // five rooms. A club's own management reaches its room through the club role they already wear.
  const office = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  for (const t of teams) {
    if (t.discord_role_id && t.discord_channel_id) continue;   // already provisioned
    try {
      let trole = t.discord_role_id;
      if (!trole || !guildRoles.find((r) => r.id === trole)) {
        const existing = guildRoles.find((r) => !r.managed && slug(r.name) === slug(t.name));
        if (existing) trole = existing.id;
        else {
          const wantColor = /^#?[0-9a-f]{6}$/i.test(t.color || "") ? parseInt(String(t.color).replace("#", ""), 16) : 0;
          const cr = await dApi("POST", `/guilds/${GUILD}/roles`, { name: t.name, color: wantColor, mentionable: true, permissions: rolePermissionsAtBirth(t.name, guildRoles) });
          if (cr && cr.id) { trole = cr.id; guildRoles.push(cr); sum.clubRolesCreated = (sum.clubRolesCreated || 0) + 1; }
        }
        if (trole) { await sbPatch(`teams?id=eq.${t.id}`, { discord_role_id: trole }); t.discord_role_id = trole; }
      }
      let tchan = t.discord_channel_id;
      if (teamRoomsCat && (!tchan || !guildChannels.find((c) => c.id === tchan))) {
        const existing = guildChannels.find((c) => c.type === 0 && c.parent_id === teamRoomsCat.id && slug(c.name) === slug(t.name));
        if (existing) tchan = existing.id;
        else {
          const allow = String(1024 | 2048 | 65536);   // VIEW + SEND + READ_HISTORY
          const overwrites = [{ id: GUILD, type: 0, deny: "1024", allow: "0" }];
          if (trole) overwrites.push({ id: trole, type: 0, allow, deny: "0" });
          for (const oid of office) overwrites.push({ id: oid, type: 0, allow, deny: "0" });
          const topic = `Private room for the ${t.name} — roster, lineups, and team talk. Visible only to the club and staff.`;
          const cc = await dApi("POST", `/guilds/${GUILD}/channels`,
            { name: slug(t.name), type: 0, parent_id: teamRoomsCat.id, topic, permission_overwrites: overwrites });
          if (cc && cc.id) { tchan = cc.id; guildChannels.push(cc); sum.clubRoomsCreated = (sum.clubRoomsCreated || 0) + 1; }
        }
        if (tchan) { await sbPatch(`teams?id=eq.${t.id}`, { discord_channel_id: tchan }); t.discord_channel_id = tchan; }
      }
    } catch (e) { sum.errors.push({ clubProvision: t.name, error: String(e.message || e) }); }
  }
}
// Discord paints a member's name with the colour of their HIGHEST colour-bearing role, and
// POST /guilds/{id}/roles always creates a role at the BOTTOM of the list. So every club role
// was created underneath Owner / General Manager / Assistant GM, and anyone holding a seat wore
// the seat's colour instead of their club's. Sort the roles we manage into three tiers, lowest
// first:
//
//     everything else we manage   <   club colours   <   league office
//
// A player therefore reads as their club, while Commissioner and Staff still read as the office.
//
// This only ever reuses positions ALREADY held by these roles — it permutes the band rather than
// reaching for a higher slot. Discord refuses to move any role above the bot's own, and a
// permutation can never ask for that, so this can't fail on hierarchy no matter where the bot sits.
// Runs every sync, so a club role created a minute ago is in the right place on the next tick.
/* ---------- @everyone / @here is the league office's alone ----------
   MENTION_EVERYONE (bit 17) also covers @here and all-role pings, so a single role holding it
   hands every wearer a server-wide megaphone. Every registered player wears a position role and
   every staffer a department role, so a stray grant on any of those is effectively a grant to
   the whole league. This re-strips it on every sweep: a permission changed by hand in the UI, or
   inherited by a role recreated from the @everyone template, is corrected within two minutes
   rather than discovered after a 3am mass ping.

   KEPT deliberately: Commissioner and Staff — the two roles Rule 1.3 names — and managed
   integration roles the API refuses to edit, except the premium-subscriber role, which is managed
   but editable and would otherwise let anyone buy a megaphone with a boost.

   MEDIA WAS ONCE KEPT AND IS NOT ANYMORE. Media-only staffers wear only the Media role (they were
   deliberately taken off the Staff role), so exempting Media handed the megaphone to someone
   carrying neither Commissioner nor Staff — exactly what this guard exists to stop, and it went
   unnoticed because the role audit looked clean while the wearer list did not. Rule 1.3 already
   said "only commissioners and league staff"; the code was the thing that was wrong. */
/* BigInt is load-bearing, not style: Discord permissions are a 64-bit bitfield and JavaScript's
   bitwise operators coerce to INT32. `2248473465835073 & ~(1<<17)` evaluates to -2043294143 —
   writing that back would not clear one bit, it would rewrite the role's entire permission set
   with garbage. Every value here stays a BigInt until it is stringified for the API. */
const MENTION_EVERYONE = 1n << 17n;
/* ADMINISTRATOR implies EVERY permission, so a role holding it can ping the whole server without
   bit 17 ever being set. Stripping bit 17 from such a role would change nothing and hide the fact.
   This guard therefore cannot enforce the policy against an admin role — so it REPORTS them
   (sum.mentionViaAdmin) rather than pretending the server is clean. Commissioner is admin by
   design; anything else appearing there is a real finding. */
const ADMINISTRATOR = 1n << 3n;
/* Exactly the two the rulebook names (Rule 1.3). Media is NOT here: a media-only staffer wears
   only the Media role in Discord, and exempting that role let someone with no Commissioner or
   Staff role ping the entire server — which is the thing this guard exists to prevent. Media asks
   the office to post, like everyone else. */
const MENTION_ALLOWED = new Set(["commissioner", "staff"]);
async function enforceMentionPolicy(guildRoles, sum) {
  for (const r of guildRoles || []) {
    let perms;
    try { perms = BigInt(r.permissions || 0); } catch (e) { continue; }
    const name0 = String(r.name || "").toLowerCase();
    /* surfaced whether or not bit 17 is set — an admin role bypasses this policy entirely */
    if ((perms & ADMINISTRATOR) !== 0n && !MENTION_ALLOWED.has(name0) && !r.managed) {
      sum.mentionViaAdmin = (sum.mentionViaAdmin || []).concat(r.name);
    }
    if ((perms & MENTION_EVERYONE) === 0n) continue;
    const name = name0;
    if (MENTION_ALLOWED.has(name)) continue;
    /* the bot's OWN integration role must keep it — the bot posts league-wide announcements —
       and Discord refuses PATCH on integration roles anyway. The booster role is managed but
       editable, so it is not exempt. */
    if (r.managed && name !== "server booster") continue;
    const cleared = (perms & ~MENTION_EVERYONE).toString();
    try {
      await dApi("PATCH", `/guilds/${GUILD}/roles/${r.id}`, { permissions: cleared });
      sum.mentionStripped = (sum.mentionStripped || 0) + 1;
      r.permissions = cleared;
    } catch (e) { sum.errors.push({ mentionPolicy: r.name, error: String(e.message || e) }); }
  }
}

/* ---- posting policy: links and images require a league role (Rule 1.3) ----
   Ad bots join, post a link, and leave. The counter is that posting a LINK or an IMAGE requires
   proof of being a real member — a role that only exists once you have signed in to the site and
   registered — while reading and chatting stay open to everyone.

   THE TRAP THIS GUARD EXISTS FOR: "Not Signed Up" is granted by THIS SWEEP to every unlinked human
   within two minutes, ad accounts included. It carried EMBED_LINKS and ATTACH_FILES, so the gate
   was decorative until those were stripped (2026-08-08). Any role that is handed out automatically
   must never be a qualifying role — hence DENY below is enforced, not assumed.

   CREATE_INSTANT_INVITE rides along: a drive-by account should not be able to mint invites. */
const EMBED_LINKS = 1n << 14n;
const ATTACH_FILES = 1n << 15n;
const CREATE_INSTANT_INVITE = 1n << 0n;
const POST_BITS = EMBED_LINKS | ATTACH_FILES;
/* Roles that must NEVER carry the posting bits: @everyone (handled by id) and any role this sweep
   grants automatically without the member proving anything.

   GIF CARVE-OUT (2026-08-10): "Not Signed Up" KEEPS EMBED_LINKS. Discord has no GIF permission —
   the picker just posts a tenor.com link and the animation is that link's embed — so GIFs cannot be
   allowed without the embed bit. The links this bit would otherwise reopen are closed one layer up:
   the "Links require registration" AutoMod rule blocks any URL from a non-exempt member outright,
   with tenor/giphy on its allow-list. Net: unregistered members get the GIF picker, and every other
   link they try is now refused as a MESSAGE (stronger than before, when it posted as plain text).
   ATTACH_FILES and invite creation stay stripped — the picker needs neither. */
const POST_DENY = new Set(["not signed up"]);
const DENY_STRIP_NAMED = ATTACH_FILES | CREATE_INSTANT_INVITE;   /* named deny roles: keep EMBED */
const DENY_GRANT_NAMED = EMBED_LINKS;                            /* the GIF picker needs the bit ON */
/* Roles that must ALWAYS carry them: earning any of these means a real registration or a league
   office seat. Club and position roles are added dynamically below — they are data, not names. */
const POST_ALLOW_STATIC = ["player", "free agent", "commissioner", "staff", "owner",
  "general manager", "assistant general manager"];

async function enforcePostingPolicy(guildRoles, teams, sum) {
  const allow = new Set(POST_ALLOW_STATIC);
  for (const p of POSITION_ROLES) allow.add(p.toLowerCase());
  for (const d of STAFF_DEPARTMENTS) allow.add(d.role.toLowerCase());
  const clubRoleIds = new Set((teams || []).map((t) => t.discord_role_id).filter(Boolean));

  for (const r of guildRoles || []) {
    let perms;
    try { perms = BigInt(r.permissions || 0); } catch (e) { continue; }
    const name = String(r.name || "").toLowerCase();
    const isEveryone = r.id === GUILD;
    /* integration roles belong to their app and Discord refuses to PATCH them */
    if (r.managed) continue;

    if (isEveryone || POST_DENY.has(name)) {
      /* @everyone loses everything; a NAMED deny role (Not Signed Up) keeps EMBED_LINKS for the
         GIF picker — the AutoMod URL gate is what keeps that bit from reopening links — and is
         GRANTED it if missing, or the picker stays dark for every unregistered member. */
      const strip = isEveryone ? (POST_BITS | CREATE_INSTANT_INVITE) : DENY_STRIP_NAMED;
      const grant = isEveryone ? 0n : DENY_GRANT_NAMED;
      const next = (perms & ~strip) | grant;
      if (next === perms) continue;
      const cleared = next.toString();
      try {
        await dApi("PATCH", `/guilds/${GUILD}/roles/${r.id}`, { permissions: cleared });
        sum.postingStripped = (sum.postingStripped || 0) + 1;
        r.permissions = cleared;
      } catch (e) { sum.errors.push({ postingPolicy: r.name, error: String(e.message || e) }); }
      continue;
    }

    if (allow.has(name) || clubRoleIds.has(r.id)) {
      if ((perms & POST_BITS) === POST_BITS) continue;
      const granted = (perms | POST_BITS).toString();
      try {
        await dApi("PATCH", `/guilds/${GUILD}/roles/${r.id}`, { permissions: granted });
        sum.postingGranted = (sum.postingGranted || 0) + 1;
        r.permissions = granted;
      } catch (e) { sum.errors.push({ postingPolicy: r.name, error: String(e.message || e) }); }
    }
  }
}

/* ---- elevated bits on ordinary roles (P2-9, 2026-09-17) ----
   POST /guilds/{id}/roles without `permissions` copies @everyone's permission set into the new
   role, and @everyone on this server carries CREATE_EVENTS and CREATE_GUILD_EXPRESSIONS (Discord's
   defaults for a Community server). So every role this sweep ever created — the six positions, the
   departments, the seat roles, Not Signed Up — let any member schedule server events and upload
   emoji and stickers, and @everyone plus the club roles let anyone open threads under the post-only
   feeds. None of those are a member's to hold; the office (Commissioner, Staff) keeps whatever it
   has, because moderation tooling is exactly what those bits are for.

   Two halves, so the hole cannot reopen: roles are CREATED with an explicit permission set
   (rolePermissionsAtBirth), and every role the sweep owns is RECONCILED each sweep, the way the
   mention and posting policies already are — a bit added by hand in the UI is gone within two
   minutes. @everyone loses only the two thread-creation bits; its events/expressions bits are the
   commissioners' call and are reported, not touched.

   DISBOARD.org is a third-party bump bot whose managed role arrived holding MANAGE_CHANNELS
   guild-wide. The sweep tries to strip it; Discord may refuse to edit a managed role, and when it
   does the result says "manual" so the office knows to do it in the UI — rather than the sweep
   logging the same error every two minutes forever. */
const CREATE_GUILD_EXPRESSIONS = 1n << 43n;
const CREATE_EVENTS = 1n << 44n;
const MANAGE_CHANNELS = 1n << 4n;
const ROLE_STRIP_BITS = CREATE_EVENTS | CREATE_GUILD_EXPRESSIONS | CREATE_THREAD_BITS;
const EVERYONE_STRIP_BITS = CREATE_THREAD_BITS;
const ROLE_BITS_KEEP = new Set(["commissioner", "staff"]);
const DISBOARD_ROLE = /^disboard(\.org)?$/i;
/* the permission set a role this sweep creates is born with: @everyone's, minus everything the
   reconcilers would strip on the next pass (elevated bits, the megaphone, invites), plus the
   posting bits the posting policy would grant it — so a new role is correct from its first second
   and never spends a sweep in the wrong state. ONE definition of "what a fresh role may do". */
function rolePermissionsAtBirth(name, guildRoles) {
  const everyone = (guildRoles || []).find((r) => r.id === GUILD);
  let perms = 0n;
  try { perms = BigInt((everyone && everyone.permissions) || 0); } catch (e) { perms = 0n; }
  perms &= ~(ROLE_STRIP_BITS | MENTION_EVERYONE | CREATE_INSTANT_INVITE);
  const n = String(name || "").toLowerCase();
  if (POST_DENY.has(n)) perms = (perms & ~DENY_STRIP_NAMED) | DENY_GRANT_NAMED;
  else perms |= POST_BITS;
  return perms.toString();
}
async function enforceRoleBits(guildRoles, teams, roleId, sum) {
  const owned = managedRoleIds(roleId, teams);
  for (const r of guildRoles || []) {
    let perms;
    try { perms = BigInt(r.permissions || 0); } catch (e) { continue; }
    const name = String(r.name || "").toLowerCase();
    let strip = 0n;
    let disboard = false;
    if (r.id === GUILD) strip = EVERYONE_STRIP_BITS;
    else if (DISBOARD_ROLE.test(name)) { strip = MANAGE_CHANNELS; disboard = true; }
    else if (r.managed || ROLE_BITS_KEEP.has(name) || !owned.has(r.id)) continue;
    else strip = ROLE_STRIP_BITS;
    const next = perms & ~strip;
    if (next === perms) continue;
    try {
      await dApi("PATCH", `/guilds/${GUILD}/roles/${r.id}`, { permissions: next.toString() });
      r.permissions = next.toString();
      if (disboard) sum.disboardManageChannels = "stripped";
      else sum.roleBitsStripped = (sum.roleBitsStripped || 0) + 1;
    } catch (e) {
      /* a managed role Discord will not let the bot edit: say so once per run, in the result */
      if (disboard) sum.disboardManageChannels = "manual";
      else sum.errors.push({ roleBits: r.name, error: String(e.message || e) });
    }
  }
}

/* AutoMod's "Block invite links" rule caught a club owner posting their own team's Discord with a
   scouting note — the rule only exempted Commissioner and Staff, so every ordinary member was
   blocked from sharing any invite link. The league's line is: anyone who has signed up may post
   links; only the not-signed-up may not.

   AutoMod has no deny-list — exempt_roles is the only lever, and it is capped at 20 while the guild
   carries 33+ roles, so "exempt every role" is not available. These eight are instead the exact
   cover: desiredRolesFor gives Player to everyone registered or rostered, management and league
   office wear their own roles whether or not they play, and media-only staff wear just Media.
   Measured against the live membership when this shipped: 105 members exempt, 102 still gated, and
   all 102 of those carried "Not Signed Up" — nobody roleless, nobody stranded.

   Reconciled every sweep BY NAME rather than left as hand-entered ids, because this sweep itself
   recreates missing roles: a role rebuilt under a new id would silently drop out of a static
   exempt list and the rule would start blocking members again with nothing to say so. */
const AUTOMOD_LINK_RULE = "Block invite links";
const AUTOMOD_ADS_RULE = "Ad + scam keywords";
/* The other half of the GIF carve-out: with EMBED_LINKS back on "Not Signed Up", THIS rule is what
   keeps links registration-gated. Any schemed or www. URL from a non-exempt member blocks the whole
   message; tenor/giphy (the GIF picker's own output) ride the allow-list. Content matching, not a
   permission — a spam gate, not a security boundary — but the message-level block is stronger than
   the old embed-strip, which still let links post as plain text. */
const AUTOMOD_URL_RULE = "Links require registration";
const AUTOMOD_URL_REGEX = "(https?://|www\\.)[^\\s]+";
/* Every host Discord's GIF picker posts from. Klipy is the one that bit us: Discord has been
   moving picker results from Tenor to Klipy, so a member's GIF arrived as klipy.com/gifs/... and
   the gate blocked it (#bot-logs 2026-08-11, matched_content shows the exact URL). When a GIF is
   ever blocked again, read that alert first — it names the provider to add here; the reconciler
   pushes additions to the live rule within one sweep. */
const AUTOMOD_URL_ALLOW = ["*tenor.com/*", "*giphy.com/*", "*klipy.com/*"];
const AUTOMOD_EXEMPT = ["commissioner", "staff", "player", "free agent", "owner",
  "general manager", "assistant general manager", "media"];
/* #scouting-links is the recruitment board: club management post their club's Discord there and the
   whole league browses it. Both keyword rules are exempted IN THAT CHANNEL — the invite rule for
   obvious reasons, and the ad/scam rule because ordinary recruiting copy trips it ("dm me for",
   "cheap boosting"). Only management can post there (enforcePostOnlyBoards), so exempting the
   channel widens nothing: the audience that can write in it is already the narrowest on the server. */
const AUTOMOD_EXEMPT_CHANNELS = { [AUTOMOD_LINK_RULE]: ["scouting-links"],
  [AUTOMOD_ADS_RULE]: ["scouting-links"] };
/* A club's management may @ whatever it wants in its own room, any time (2026-09-15). A GM tagging
   the six he is dressing is the point of the room, and Discord's generic "Spam content" detector —
   which flags mention-heavy messages — blocked exactly that in #stars. AutoMod exemptions cannot be
   scoped to "this role in that channel", so: the four front-office roles are exempt from both
   mention-shaped rules everywhere (accountable seats; the ML spam gate never had a reason to fire
   on them), and every club room is exempt from the mention-spam rule outright — it is a private
   room of ~20 people, and nobody outside the club is reachable from it. By NAME, like the rest of
   this reconciler, so a rebuilt role or a hand-edit heals within a sweep.

   EXACT SETS, NOT UNION (2026-09-17). The reconciler used to add what was missing and never remove
   anything, so an exemption added by hand in the UI stayed forever with nothing to say so — a role
   quietly exempted from the link gate is a role that can post ads, and no sweep would ever report
   it. Each rule's exempt_roles and exempt_channels are now set to precisely the declared set; what
   the sweep removes is counted in automodPruned. The league office (Commissioner, Staff) is part of
   the declared set on the two mention-shaped rules — it was hand-exempted with reason and must not
   be pruned by the very change that makes pruning possible. */
const AUTOMOD_SPAM_RULE = "Spam content";
const AUTOMOD_MENTION_RULE = "Mention spam";
const AUTOMOD_MGMT_EXEMPT = ["owner", "general manager", "assistant general manager", "cghl management"];
const AUTOMOD_OFFICE = ["commissioner", "staff"];
async function enforceAutomodExemptions(roleId, guildChannels, sum, teams) {
  const want = AUTOMOD_EXEMPT.map((n) => roleId[n]).filter(Boolean);
  if (!want.length) return;                       // roles not provisioned yet — try next sweep
  const wantMgmt = AUTOMOD_MGMT_EXEMPT.map((n) => roleId[n]).filter(Boolean);
  const wantOffice = AUTOMOD_OFFICE.map((n) => roleId[n]).filter(Boolean);
  const clubRooms = (teams || []).map((t) => t && t.discord_channel_id).filter(Boolean);
  /* exact-set reconcile of one list: returns the list to write, or null when it already matches;
     counts additions and removals into the two result counters */
  const exact = (have, wanted, addKey) => {
    const H = new Set(have || []), W = new Set(wanted);
    const missing = [...W].filter((id) => !H.has(id)), extra = [...H].filter((id) => !W.has(id));
    if (!missing.length && !extra.length) return null;
    if (missing.length) sum[addKey] = (sum[addKey] || 0) + missing.length;
    if (extra.length) sum.automodPruned = (sum.automodPruned || 0) + extra.length;
    return [...W];
  };
  const rules = await dApi("GET", `/guilds/${GUILD}/auto-moderation/rules`);
  if (!Array.isArray(rules)) return;
  const chanId = (name) => {
    const c = (guildChannels || []).find((x) => x.name === name && x.type === 0);
    return c && c.id;
  };
  /* The URL gate is CREATED here if absent — it is this sweep's own rule, unlike the two
     hand-created ones, so "missing" is a state to fix rather than report. The alert channel is
     inherited from the invite rule so all automod alerts land in one place. */
  const urlRule = rules.find((r) => r && r.name === AUTOMOD_URL_RULE);
  if (!urlRule) {
    const inviteRule = rules.find((r) => r && r.name === AUTOMOD_LINK_RULE);
    const alertAction = (inviteRule && (inviteRule.actions || []).find((a) => a.type === 2)) || null;
    try {
      const created = await dApi("POST", `/guilds/${GUILD}/auto-moderation/rules`, {
        name: AUTOMOD_URL_RULE, event_type: 1, trigger_type: 1, enabled: true,
        trigger_metadata: { regex_patterns: [AUTOMOD_URL_REGEX], allow_list: AUTOMOD_URL_ALLOW },
        actions: [{ type: 1 }].concat(alertAction ? [alertAction] : []),
        exempt_roles: want,
      });
      if (created && created.id) { rules.push(created); sum.automodCreated = AUTOMOD_URL_RULE; }
    } catch (e) { sum.errors.push({ automodCreate: AUTOMOD_URL_RULE, error: String(e.message || e) }); }
  }

  for (const ruleName of [AUTOMOD_LINK_RULE, AUTOMOD_ADS_RULE, AUTOMOD_URL_RULE, AUTOMOD_SPAM_RULE, AUTOMOD_MENTION_RULE]) {
    const rule = rules.find((r) => r && r.name === ruleName);
    if (!rule) { sum.automodMissing = (sum.automodMissing ? sum.automodMissing + "," : "") + ruleName; continue; }
    const patch = {};
    /* roles: the link rule and the URL gate both gate who may post a link at all. The ad/scam rule
       stays on for everyone — it catches phrases no member needs — so its role set is empty. The
       two mention-shaped rules never fire on the front office or the league office. */
    let wantRoles = null, addKey = "automodExempted";
    if (ruleName === AUTOMOD_LINK_RULE || ruleName === AUTOMOD_URL_RULE) wantRoles = want;
    else if (ruleName === AUTOMOD_ADS_RULE) wantRoles = [];
    else if (wantMgmt.length) { wantRoles = [...wantOffice, ...wantMgmt]; addKey = "automodMgmtExempted"; }
    if (wantRoles) {
      const next = exact(rule.exempt_roles, wantRoles, addKey);
      if (next) patch.exempt_roles = next;
    }
    /* the URL gate's GIF allow-list is add-only — a hand-added allowance survives (a provider the
       picker started using before this file learned its name), a hand-REMOVED tenor/giphy heals
       back (or the picker breaks) */
    if (ruleName === AUTOMOD_URL_RULE) {
      const md = rule.trigger_metadata || {};
      const haveAllow = new Set(md.allow_list || []);
      const missingAllow = AUTOMOD_URL_ALLOW.filter((a) => !haveAllow.has(a));
      const haveRegex = new Set(md.regex_patterns || []);
      if (missingAllow.length || !haveRegex.has(AUTOMOD_URL_REGEX)) {
        patch.trigger_metadata = {
          regex_patterns: Array.from(new Set([...(md.regex_patterns || []), AUTOMOD_URL_REGEX])),
          allow_list: Array.from(new Set([...(md.allow_list || []), ...AUTOMOD_URL_ALLOW])),
        };
        sum.automodGifAllow = (sum.automodGifAllow || 0) + missingAllow.length;
      }
    }
    const wantChans = (AUTOMOD_EXEMPT_CHANNELS[ruleName] || []).map(chanId).filter(Boolean)
      .concat(ruleName === AUTOMOD_MENTION_RULE ? clubRooms : []);
    const nextChans = exact(rule.exempt_channels, wantChans, "automodChannels");
    if (nextChans) patch.exempt_channels = nextChans;
    if (!Object.keys(patch).length) continue;     // already correct: no write
    try {
      await dApi("PATCH", `/guilds/${GUILD}/auto-moderation/rules/${rule.id}`, patch);
    } catch (e) { sum.errors.push({ automodExempt: ruleName, error: String(e.message || e) }); }
  }
}

/* Read-only boards: the whole league can see and read them, only the named roles may post.
   #scouting-links is one — club management post their club's Discord for recruitment and everyone
   else browses. Reconciled every sweep like every other permission here, because a channel whose
   audience is set once by hand drifts the moment anyone edits it in the UI.
   VIEW(1024)+READ_HISTORY(65536)=66560 allowed to @everyone; SEND(2048) and both thread-creation
   bits denied (a thread under a post-only board is a side door to posting in it — the Information
   lock closes the same door); SEND+EMBED_LINKS(16384)+ATTACH_FILES(32768)=51200 allowed to the
   posting roles.

   POST-ONLY FEEDS (2026-09-17): #transactions and #game-scores are written by the database through
   webhooks, which ignore overwrites entirely, so nobody needs SEND there — @everyone reads, the
   commissioners may post a correction, and no member may open a thread beneath a feed. Same
   machinery, with the Information lock's poster grant. */
const BOARD_EVERYONE_ALLOW = 66560n, BOARD_EVERYONE_DENY = 2048n | CREATE_THREAD_BITS, BOARD_POSTER_ALLOW = 51200n;
/* the categories whose rooms are private by construction — never candidates for a public lock */
const PRIVATE_CATEGORY_NAME = /^(staff\b|commissioners?\b|team management$|team rooms$)/i;
const POST_ONLY_BOARDS = {
  "scouting-links": ["owner", "general manager", "assistant general manager"],
};
const POST_ONLY_FEEDS = {
  "transactions": ["commissioner"],
  "game-scores": ["commissioner"],
};
async function enforcePostOnlyBoards(guildChannels, roleId, sum) {
  const specs = [
    ...Object.keys(POST_ONLY_BOARDS).map((cname) => ({ cname, roles: POST_ONLY_BOARDS[cname], posterAllow: BOARD_POSTER_ALLOW, key: "boardsLocked", types: [0] })),
    ...Object.keys(POST_ONLY_FEEDS).map((cname) => ({ cname, roles: POST_ONLY_FEEDS[cname], posterAllow: INFO_POSTER_ALLOW, key: "feedsLocked", types: [0, 5] })),
  ];
  /* a board or feed is a PUBLIC channel: a same-named room under a private category (the Staff
     department rooms once carried the plain name "transactions") must never be opened to the
     league by this lock */
  const privateCat = new Set((guildChannels || []).filter((c) => c.type === 4 && PRIVATE_CATEGORY_NAME.test(c.name || "")).map((c) => c.id));
  for (const spec of specs) {
    const { cname } = spec;
    const chan = (guildChannels || []).find((c) => c.name === cname && spec.types.includes(c.type) && !privateCat.has(c.parent_id));
    if (!chan) continue;                          // not created — nothing to enforce
    const posters = spec.roles.map((n) => roleId[n]).filter(Boolean);
    if (!posters.length) continue;                // roles not provisioned yet
    const ow = chan.permission_overwrites || [];
    const has = (id, allow, deny) => {
      const o = ow.find((x) => x.id === id);
      if (!o) return false;
      return (BigInt(o.allow || "0") & allow) === allow && (BigInt(o.deny || "0") & deny) === deny;
    };
    const everyoneOk = has(GUILD, BOARD_EVERYONE_ALLOW, BOARD_EVERYONE_DENY);
    const postersOk = posters.every((rid) => has(rid, spec.posterAllow, 0n));
    if (everyoneOk && postersOk) continue;        // already correct: no write
    /* keep any overwrite someone added deliberately (a muted member, a bot) — only the @everyone
       and poster entries are ours to state */
    const keep = ow.filter((o) => o.id !== GUILD && !posters.includes(o.id))
      .map((o) => ({ id: o.id, type: o.type, allow: String(o.allow || "0"), deny: String(o.deny || "0") }));
    const next = [
      { id: GUILD, type: 0, allow: String(BOARD_EVERYONE_ALLOW), deny: String(BOARD_EVERYONE_DENY) },
      ...posters.map((rid) => ({ id: rid, type: 0, allow: String(spec.posterAllow), deny: "0" })),
      ...keep,
    ];
    try {
      await dApi("PATCH", `/channels/${chan.id}`, { permission_overwrites: next });
      chan.permission_overwrites = next;
      sum[spec.key] = (sum[spec.key] || 0) + 1;
    } catch (e) { sum.errors.push({ postOnlyBoard: cname, error: String(e.message || e) }); }
  }
}

/* ---- club notices backstop (v2.42) ------------------------------------------------------------
   public.club_notify() writes club_notices; the always-on bot posts them into the club's private
   room within a second. If the bot is down, nothing else would ever deliver them — so every sweep
   posts whatever has sat unposted for 5 minutes, claiming each row on discord_post_log exactly the
   way the bot does, so the two lanes never double-post. */
const CLUB_NOTICE_BACKSTOP_MS = 5 * 60 * 1000;
const CLUB_NOTICE_BOOKKEEPING_TRIES = 3;
async function flushClubNotices(sum) {
  const before = new Date(Date.now() - CLUB_NOTICE_BACKSTOP_MS).toISOString();
  const rows = await sbGet(`club_notices?posted_at=is.null&created_at=lt.${encodeURIComponent(before)}&order=created_at.asc&limit=50`);
  if (!rows || !rows.length) return;
  const teamIds = Array.from(new Set(rows.map((r) => r.team_id)));
  const teams = await sbGet(`teams?id=in.(${teamIds.join(",")})&select=id,discord_channel_id`);
  const roomOf = Object.fromEntries((teams || []).map((t) => [t.id, t.discord_channel_id]));
  const releaseClaim = (ref) => rfetch(`${SB_URL}/rest/v1/discord_post_log?kind=eq.club&ref=eq.${encodeURIComponent(ref)}`, { method: "DELETE", headers: { ...sbHead(), Prefer: "return=minimal" } }).catch(() => {});
  for (const row of rows) {
    const room = roomOf[row.team_id];
    if (!room) { sum.clubNoticesNoRoom = (sum.clubNoticesNoRoom || 0) + 1; continue; }
    const ref = "club:" + row.id;
    const c = await rfetch(`${SB_URL}/rest/v1/discord_post_log`, { method: "POST", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify({ kind: "club", ref }) });
    if (c.status !== 201) continue;                       // 409: the bot has it
    let actor = null;
    if (row.actor_profile_id) {
      try { const p = await sbGet(`profiles?id=eq.${row.actor_profile_id}&select=gamertag`); actor = p[0] && p[0].gamertag ? p[0].gamertag : null; } catch { /* fine */ }
    }
    let delivered = false;
    try {
      const r = await dApi("POST", `/channels/${room}/messages`, { embeds: [buildNoticeEmbed(row, actor)], allowed_mentions: { parse: [] } });
      if (!r || r.__notfound || !r.id) throw new Error("did not deliver");
      delivered = true;
    } catch (e) {
      /* An UNKNOWN outcome (timeout, 5xx) may well have been delivered. Releasing the claim would
         invite the bot to post it again, so the claim stays and the row says why; a definite
         refusal (4xx, a dead room) releases the claim so the next lane can try. */
      if (!(e && e.unknown)) await releaseClaim(ref);
      try { await sbPatch(`club_notices?id=eq.${row.id}`, { post_error: String(e.message || e).slice(0, 200) }); } catch { /* observability only */ }
      sum.errors.push({ clubNotice: row.id, error: String(e.message || e) });
      continue;
    }
    /* Discord accepted the message. From here the claim is NEVER released — releasing it after a
       failed bookkeeping write is exactly how the room got the same notice twice. The PATCH is
       retried a few times; if it still fails the claim stands, the row stays unposted for a human
       to see, and the summary carries the error. */
    sum.clubNoticesPosted = (sum.clubNoticesPosted || 0) + 1;
    let bookErr = null;
    for (let i = 0; i < CLUB_NOTICE_BOOKKEEPING_TRIES; i++) {
      try { await sbPatch(`club_notices?id=eq.${row.id}`, { posted_at: new Date().toISOString(), post_error: null }); bookErr = null; break; }
      catch (e) { bookErr = e; if (i + 1 < CLUB_NOTICE_BOOKKEEPING_TRIES) await new Promise((res) => setTimeout(res, 300 * (i + 1))); }
    }
    if (bookErr) {
      sum.clubNoticeBookkeeping = (sum.clubNoticeBookkeeping || 0) + 1;
      sum.errors.push({ clubNoticeBookkeeping: row.id, delivered, error: String(bookErr.message || bookErr) });
    }
  }
}

/* Read-only CATEGORIES (2026-09-13): every channel under Information — welcome, rules, schedule,
   standings, season-signups, news, website, announcements, member-departures, and whatever is added
   there next — is the league talking to its members, never the other way round. Nobody but the
   commissioners may post a message or open a thread in any of them; everyone reads. The category
   itself carries the same overwrites, so a channel created inside it inherits the lock before the
   next sweep re-asserts it. The bot is Administrator, so the feeds it writes are unaffected.
   Thread bits: CREATE_PUBLIC_THREADS 1<<35, CREATE_PRIVATE_THREADS 1<<36, SEND_MESSAGES_IN_THREADS 1<<38. */
const THREAD_BITS = (1n << 35n) | (1n << 36n) | (1n << 38n);
const INFO_EVERYONE_ALLOW = 66560n;                       /* VIEW + READ_HISTORY */
const INFO_EVERYONE_DENY = 2048n | THREAD_BITS;           /* SEND + every thread bit */
const INFO_POSTER_ALLOW = 51200n | THREAD_BITS;           /* SEND + EMBED + ATTACH + threads */
const READ_ONLY_CATEGORIES = { information: ["commissioner"] };
async function enforceReadOnlyCategories(guildChannels, roleId, sum) {
  for (const catName of Object.keys(READ_ONLY_CATEGORIES)) {
    const cat = (guildChannels || []).find((c) => c.type === 4 && new RegExp("^" + catName + "\\b", "i").test(c.name || ""));
    if (!cat) continue;                           // no such category — nothing to enforce
    const posters = READ_ONLY_CATEGORIES[catName].map((n) => roleId[n]).filter(Boolean);
    if (!posters.length) continue;                // the commissioner role is not provisioned yet
    const targets = [cat, ...(guildChannels || []).filter((c) => c.parent_id === cat.id && [0, 5, 15].includes(c.type))];
    for (const chan of targets) {
      const ow = chan.permission_overwrites || [];
      const has = (id, allow, deny) => {
        const o = ow.find((x) => x.id === id);
        if (!o) return false;
        return (BigInt(o.allow || "0") & allow) === allow && (BigInt(o.deny || "0") & deny) === deny;
      };
      /* Discord applies a role or member overwrite AFTER the @everyone one, so any other entry that
         ALLOWS a posting bit would quietly reopen the room (the Staff grant a recreated
         #announcements used to carry, a hand-added role). Those bits are stripped from every kept
         entry; everything else about it (a mute, a bot's view grant) stays as it is. */
      const POSTING = 2048n | THREAD_BITS;
      const others = ow.filter((o) => o.id !== GUILD && !posters.includes(o.id));
      const othersClean = others.every((o) => (BigInt(o.allow || "0") & POSTING) === 0n);
      if (has(GUILD, INFO_EVERYONE_ALLOW, INFO_EVERYONE_DENY) && posters.every((rid) => has(rid, INFO_POSTER_ALLOW, 0n)) && othersClean) continue;
      const keep = others.map((o) => ({ id: o.id, type: o.type, allow: String(BigInt(o.allow || "0") & ~POSTING), deny: String(o.deny || "0") }));
      const next = [
        { id: GUILD, type: 0, allow: String(INFO_EVERYONE_ALLOW), deny: String(INFO_EVERYONE_DENY) },
        ...posters.map((rid) => ({ id: rid, type: 0, allow: String(INFO_POSTER_ALLOW), deny: "0" })),
        ...keep,
      ];
      try {
        await dApi("PATCH", `/channels/${chan.id}`, { permission_overwrites: next });
        chan.permission_overwrites = next;
        sum.infoLocked = (sum.infoLocked || 0) + 1;
      } catch (e) { sum.errors.push({ readOnlyCategory: chan.name, error: String(e.message || e) }); }
    }
  }
}

/* The server's own join gate. HIGH = a new account must be in the guild ten minutes before it can
   post at all, which defeats the join-post-leave pattern outright. Raised by hand on 2026-08-08;
   re-asserted here so it cannot be quietly lowered. Never LOWERS a stricter setting the
   commissioner may have chosen (VERY HIGH = 4). */
const MIN_VERIFICATION_LEVEL = 3;
async function enforceVerificationLevel(guild, sum) {
  const cur = guild && guild.verification_level;
  if (typeof cur !== "number" || cur >= MIN_VERIFICATION_LEVEL) return;
  try {
    await dApi("PATCH", `/guilds/${GUILD}`, { verification_level: MIN_VERIFICATION_LEVEL });
    sum.verificationRaised = `${cur} -> ${MIN_VERIFICATION_LEVEL}`;
  } catch (e) { sum.errors.push({ verificationLevel: String(e.message || e) }); }
}

async function ensureRoleOrder(guildRoles, teams, roleId, sum) {
  const byId = new Map(guildRoles.map((r) => [r.id, r]));
  // @everyone shares the guild id and integration-managed roles can't be moved at all
  const movable = (id) => { const r = byId.get(id); return !!r && r.id !== GUILD && !r.managed; };
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const idsOf = (names) => uniq(names.map((n) => roleId[String(n).toLowerCase()]));

  const office = idsOf(["commissioner", "staff"]).filter(movable);
  const club = uniq(teams.map((t) => t.discord_role_id)).filter(movable);
  const rest = uniq([
    ...idsOf(["owner", "general manager", "assistant general manager", "player", "free agent",
              "not signed up", "training camp", "center", "left wing", "right wing", "left defense", "right defense", "goalie"]),
    ...STAFF_DEPARTMENTS.map((d) => roleId[String(d.role).toLowerCase()]),
  ]).filter((id) => movable(id) && !club.includes(id) && !office.includes(id));

  const tiers = [rest, club, office];
  const all = tiers.flat();
  if (!club.length || all.length < 2) return;

  const slots = all.map((id) => byId.get(id).position).sort((a, b) => a - b);
  const byPos = (a, b) => byId.get(a).position - byId.get(b).position;  // keep each tier's own order
  const ordered = tiers.flatMap((t) => t.slice().sort(byPos));
  const moves = ordered.map((id, i) => ({ id, position: slots[i] }))
                       .filter((m) => byId.get(m.id).position !== m.position);

  if (moves.length) {
    const res = await dApi("PATCH", `/guilds/${GUILD}/roles`, moves);
    if (Array.isArray(res)) for (const r of res) { const cur = byId.get(r.id); if (cur) cur.position = r.position; }
    sum.roleOrderMoved = moves.length;
  }
  // The ?diag= endpoints can't be reached (Netlify refuses public HTTP on a scheduled function),
  // so leave the resulting order somewhere readable for whoever debugs the next colour complaint.
  try {
    await sbUpsertCfg("discord_role_order", JSON.stringify({
      tiers: "other < club < office",
      moved: moves.length,
      order: ordered.map((id) => `${byId.get(id).position}:${byId.get(id).name}`),
    }));
  } catch (e) { /* observability only — never fail the sync over it */ }
}

/* The guild slash commands, self-registered by the sweep. The old GET ?register=commands path
   still exists but Netlify refuses public HTTP to scheduled functions, so it can never run again —
   without this, a new command could be coded but never registered. The desired set is hashed into
   app_config (discord_cmds_hash) so steady-state sweeps cost zero Discord calls. */
const GUILD_COMMANDS = [
  { name: "join", type: 1, description: "Join or start a pickup game lobby — run in #pickup-games" },
  { name: "leave", type: 1, description: "Leave the pickup signup sheet — run in #pickup-games" },
  { name: "captain", type: 1, description: "Volunteer as a captain — run in a full pickup lobby's channel" },
  { name: "kick", type: 1, description: "Captains: vote to kick a player from this pickup lobby",
    options: [{ type: 6, name: "player", description: "Who to kick", required: true }] },
  { name: "delete", type: 1, description: "Vote to close this pickup lobby — a majority of the lobby closes it" },
];
async function ensureGuildCommands(sum) {
  /* the marker only needs to CHANGE when the command set changes — the JSON itself is the
     simplest collision-free fingerprint and avoids importing crypto for a config stamp */
  const hash = JSON.stringify(GUILD_COMMANDS);
  try {
    const cur = await sbGet(`app_config?key=eq.discord_cmds_hash&select=value`);
    if (cur && cur[0] && cur[0].value === hash) return;
    const app = await dApi("GET", `/applications/@me`);
    const res = await dApi("PUT", `/applications/${app.id}/guilds/${GUILD}/commands`, GUILD_COMMANDS);
    await sbUpsertCfg("discord_cmds_hash", hash);
    sum.commandsRegistered = (res || []).map((c) => c.name);
  } catch (e) { sum.errors.push({ commands: String(e.message || e) }); }
}

async function ensureStaffDepartments(guildChannels, guildRoles, roleId, roleNameById, sum) {
  const commish = roleId["commissioner"], staff = roleId["staff"];
  if (!commish || !staff) return; // office roles not provisioned yet — next run
  const ALLOW = "68608";
  // (a) a Discord role per department
  for (const d of STAFF_DEPARTMENTS) {
    if (roleId[d.role.toLowerCase()]) continue;
    try {
      const created = await dApi("POST", `/guilds/${GUILD}/roles`, { name: d.role, mentionable: true, permissions: rolePermissionsAtBirth(d.role, guildRoles) });
      if (created && created.id) { roleId[d.role.toLowerCase()] = created.id; roleNameById[created.id] = d.role; guildRoles.push(created); sum.rolesCreated = (sum.rolesCreated || 0) + 1; }
    } catch (e) { sum.errors.push({ deptRole: d.role, error: String(e.message || e) }); }
  }
  // (b) the Staff category (created office-private if it doesn't exist)
  let cat = guildChannels.find((c) => c.type === 4 && /^staff\b/i.test(c.name || ""));
  if (!cat) {
    try {
      cat = await dApi("POST", `/guilds/${GUILD}/channels`, { name: "Staff", type: 4,
        permission_overwrites: [{ id: GUILD, type: 0, deny: "1024", allow: "0" },
          { id: commish, type: 0, allow: ALLOW, deny: "0" }, { id: staff, type: 0, allow: ALLOW, deny: "0" }] });
      guildChannels.push(cat); sum.staffCatCreated = 1;
    } catch (e) { sum.errors.push({ staffCat: String(e.message || e) }); return; }
  }
  // (c) one private room per department — visible to that department + the commissioners. The grant
  //     goes in the SAME create call as the @everyone deny, so the room is never briefly public.
  for (const d of STAFF_DEPARTMENTS) {
    const rid = roleId[d.role.toLowerCase()];
    if (!rid) continue;
    if (guildChannels.find((c) => c.name === d.channel && c.parent_id === cat.id)) continue;
    // a room created under a prior name (e.g. before a rename to dodge a public channel clash) is
    // renamed in place rather than duplicated
    if (d.alt) {
      const old = guildChannels.find((c) => d.alt.includes(c.name) && c.parent_id === cat.id);
      if (old) {
        try { await dApi("PATCH", `/channels/${old.id}`, { name: d.channel, topic: d.topic }); old.name = d.channel; sum.deptChansRenamed = (sum.deptChansRenamed || 0) + 1; continue; }
        catch (e) { sum.errors.push({ deptRename: d.channel, error: String(e.message || e) }); }
      }
    }
    try {
      const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { name: d.channel, type: 0, parent_id: cat.id, topic: d.topic,
        permission_overwrites: [{ id: GUILD, type: 0, deny: "1024", allow: "0" },
          { id: commish, type: 0, allow: ALLOW, deny: "0" }, { id: rid, type: 0, allow: ALLOW, deny: "0" }] });
      if (ch && ch.id) { guildChannels.push(ch); sum.deptChansCreated = (sum.deptChansCreated || 0) + 1; }
    } catch (e) { sum.errors.push({ deptChan: d.channel, error: String(e.message || e) }); }
  }
}

/* ---- the two member passes ------------------------------------------------------------------
   Pass 1 walks every site profile with a Discord id; pass 2 walks every guild member the first
   pass did not cover. Both take `ctx` (everything the sweep loaded) and `outOfTime()`, and stop
   the moment it answers true: a Netlify scheduled function has 30 seconds, and a pass that needs
   hundreds of PATCH /members (registration opening, a ban wave, the bot down through draft day)
   used to be killed mid-loop with nothing written — a fresh heartbeat beside a stale ok:true. A
   pass cut short is recorded as partial with the count left; the next tick continues, and since
   a member who needs nothing costs no request, the passes converge across ticks. */
const MEMBER_PASS_BUDGET_MS = 18000;
function cutShort(sum, left) {
  sum.partial = true;
  sum.membersLeft = (sum.membersLeft || 0) + left;
}
async function syncLinkedMembers(ctx, sum, outOfTime) {
  const { links, bannedIds, guildBans, memberById, memberListOk, markGuild, avatarById, tagOwner, inputsOk,
    roleId, teamRoleId, registered, regOpen, mgmtRoleByProfile, deptByProfile, posOf, rfa, rookies, camp, managedIds } = ctx;
  const linked = links.filter((m) => m.discord_id);
  for (let i = 0; i < linked.length; i++) {
    if (outOfTime()) { cutShort(sum, linked.length - i); return; }
    const m = linked[i];
    try {
      // banned players are removed from the server and kept out (no return)
      if (bannedIds.has(m.profile_id)) {
        if (!guildBans.has(String(m.discord_id))) {
          const res = await dApi("PUT", `/guilds/${GUILD}/bans/${m.discord_id}`, { delete_message_seconds: 0 });
          if (!(res && res.__notfound)) sum.banned = (sum.banned || 0) + 1;
        }
        await markGuild(m.profile_id, false);
        continue;
      }
      // not banned on the site but still banned on Discord → lift it (site Unban made real)
      if (guildBans.has(String(m.discord_id))) {
        await dApi("DELETE", `/guilds/${GUILD}/bans/${m.discord_id}`);
        guildBans.delete(String(m.discord_id));
        sum.unbanned = (sum.unbanned || 0) + 1;
      }
      // read from the bulk listing; only fall back to a single fetch if that listing failed
      const mem = memberListOk
        ? (memberById.get(String(m.discord_id)) || { __notfound: true })
        : await dApi("GET", `/guilds/${GUILD}/members/${m.discord_id}`);
      if (mem.__notfound) { sum.notInServer++; await markGuild(m.profile_id, false); continue; }
      sum.checked++;
      await markGuild(m.profile_id, true);

      // (1) username sync — site gamertag follows Discord display name. Two refusals: never an
      // empty name (a nick of spaces would blank the tag the whole site keys on), and never a
      // tag another profile already holds in any case — the unique index is case-sensitive, the
      // site is not, so "SNIPER" beside "Sniper" would be two players nothing can tell apart.
      const disp = String(mem.nick || (mem.user && (mem.user.global_name || mem.user.username)) || "").trim();
      if (disp && disp !== m.gamertag) {
        const holder = tagOwner.get(disp.toLowerCase());
        if (holder && holder !== m.profile_id) {
          sum.renameCollisions = (sum.renameCollisions || 0) + 1;
        } else {
          await sbPatch(`profiles?id=eq.${m.profile_id}`, { gamertag: disp });
          if (m.gamertag) tagOwner.delete(String(m.gamertag).trim().toLowerCase());
          tagOwner.set(disp.toLowerCase(), m.profile_id);
          m.gamertag = disp;
          sum.renamed++;
        }
      }
      // (1b) store the Discord @handle so the commissioner directory can show it
      const handle = mem.user && mem.user.username;
      if (handle && handle !== m.discord_username) { await sbPatch(`profiles?id=eq.${m.profile_id}`, { discord_username: handle }); }
      // (1c) avatar freshness — Discord avatar hashes rot when a member changes theirs, and the
      // stale URL 404s forever (the users table showed 38 broken discs). Keep the stored URL
      // current for everyone in the guild. A custom (supabase-hosted) avatar is the member's own
      // upload and is never touched — the same rule discordIdentityPatch applies at sign-in.
      const wantAv = mem.user && mem.user.avatar
        ? `https://cdn.discordapp.com/avatars/${m.discord_id}/${mem.user.avatar}.png?size=128` : null;
      const curAv = avatarById[m.profile_id] || null;
      if (wantAv && curAv !== wantAv && (!curAv || /cdn\.discordapp\.com|media\.discordapp\.net/.test(curAv))) {
        await sbPatch(`profiles?id=eq.${m.profile_id}`, { avatar_url: wantAv });
        avatarById[m.profile_id] = wantAv;
        sum.avatarsFreshened = (sum.avatarsFreshened || 0) + 1;
      }

      // (2) role sync — desired managed roles for this member. The rules live in
      // shared/roles.mjs, shared verbatim with the gateway bot's instant per-member sync.
      if (inputsOk) {
        const desired = desiredRolesFor(m, { roleId, teamRoleId, registered, regOpen,
          mgmtRoleByProfile, deptByProfile, posOf, rfa, rookies, camp });
        const { next, changed } = applyManagedRoles(mem.roles, desired, managedIds);
        if (changed) {
          const res = await dApi("PATCH", `/guilds/${GUILD}/members/${m.discord_id}`, { roles: next });
          if (!(res && res.__notfound)) sum.roleUpdated++;
        }
      }
    } catch (e) {
      // owner + higher-role members can't be modified by the bot — log and continue
      sum.errors.push({ discord_id: m.discord_id, error: String(e.message || e) });
    }
  }
}
/* Pass 2 — guild members with NO site link. The loop above walks site profiles that carry a
   discord_id, so a member who joined the server but never signed into the website was never
   visited: with ~150 members and ~80 linked, some seventy people sat outside the sweep, which is
   why "Not Signed Up" held 18 members when it should have held roughly 85. They cannot be
   reached from the profiles side because there is nothing to join on — so walk the guild list
   and reconcile everyone the first pass did not cover. An unlinked member's managed roles are
   exactly {Not Signed Up} while sign-ups are open (they have not signed up, by definition), and
   none once the window closes. Their non-managed roles are left alone, same as pass 1. */
async function syncUnlinkedMembers(ctx, sum, outOfTime) {
  const { links, memberById, memberListOk, inputsOk, roleId, regOpen, managedIds } = ctx;
  if (!(inputsOk && memberListOk && roleId["not signed up"])) return;
  const linkedIds = new Set(links.filter((l) => l.discord_id).map((l) => String(l.discord_id)));
  sum.unlinkedSeen = 0;
  const todo = [...memberById].filter(([uid, mem]) => !linkedIds.has(uid) && !(mem.user && mem.user.bot));
  for (let i = 0; i < todo.length; i++) {
    if (outOfTime()) { cutShort(sum, todo.length - i); return; }
    const [uid, mem] = todo[i];
    sum.unlinkedSeen++;
    const desired = new Set();
    if (regOpen) desired.add(roleId["not signed up"]);
    const { next, changed } = applyManagedRoles(mem.roles, desired, managedIds);
    if (!changed) continue;
    try {
      const res = await dApi("PATCH", `/guilds/${GUILD}/members/${uid}`, { roles: next });
      if (!(res && res.__notfound)) sum.unlinkedTagged = (sum.unlinkedTagged || 0) + 1;
    } catch (e) {
      // the owner and anyone above the bot cannot be edited — count it rather than fail the run
      sum.unlinkedSkipped = (sum.unlinkedSkipped || 0) + 1;
    }
  }
}

/* ---- entry points reachable by request ------------------------------------------------------
   Netlify refuses external HTTP calls to a scheduled function, so nothing here can be reached
   through THIS function's URL — the ?diag= / ?register= / ?setup= / ?reconcile= branches sat dead
   on the sweep for weeks (P2-0 in the 09-17 audit). netlify/functions/discord-ops.js, a plain HTTP
   function, imports `ops`, `OPS_ROUTES`, `runOp`, `opsKeyOk` and `runSweep` and is the door:
   /api/discord-ops?diag=…|register=…|setup=…|reconcile=…|run=now.

   The key check is exactly the one those branches always used: app_config.diag_key, presented as
   ?key= or the x-diag-key header. Describing a private room — even just its name and who may read
   it — is itself information about the league office, so a miss is a 404, never a 401: a 404
   doesn't confirm the endpoint exists to someone probing for it. Nothing here returns ids, tokens,
   or message content. */
export async function opsKeyOk(req) {
  const params = (() => { try { return new URL(req.url).searchParams; } catch { return new URLSearchParams(); } })();
  const keyRow = await sbGet("app_config?key=eq.diag_key&select=value").catch(() => []);
  const want = keyRow[0] && keyRow[0].value;
  const got = params.get("key") || (req.headers && typeof req.headers.get === "function" && req.headers.get("x-diag-key")) || "";
  return !!want && got === want;
}
/* query parameter -> value -> op, so discord-ops.js carries no knowledge of what the ops do */
export const OPS_ROUTES = {
  diag: { guild: "diagGuild", staff: "diagStaff", teamrooms: "diagTeamrooms", rolecheck: "diagRolecheck" },
  register: { commands: "registerCommands" },
  setup: { community: "setupCommunity", staffmod: "setupStaffmod" },
  reconcile: { teams: "reconcileTeams" },
};
export async function runOp(name) {
  if (!ops[name]) return { status: 404, body: { error: "Not found" } };
  if (!BOT || !GUILD) return { status: 200, body: { skipped: "Discord bot not configured" } };
  try { return { status: 200, body: await ops[name]() }; }
  catch (e) { return { status: 500, body: { diagError: String(e.message || e) } }; }
}
export const ops = {
  // Register the guild slash commands (idempotent bulk-overwrite). Only /join is advertised — this
  // replaces the old /lfg. (The handler still accepts an "lfg" name as a harmless safety net.)
  async registerCommands() {
    const app = await dApi("GET", `/applications/@me`);
    const res = await dApi("PUT", `/applications/${app.id}/guilds/${GUILD}/commands`, GUILD_COMMANDS);
    return { appId: app.id, registered: (res || []).map((c) => c.name) };
  },

  // Ground truth for the office: does every member's PARTICIPATION role match the database?
  // Compares the live guild against season_registrations for the three roles the sweep manages
  // around sign-ups (Not Signed Up / Player / Free Agent context). Read-only, names only.
  // "The sync reported no errors" is not the same as "the roles are right" — this proves it.
  async diagRolecheck() {
    const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
    const rid = {}; for (const r of roles) rid[(r.name || "").toLowerCase()] = r.id;
    const members = [];
    let after = "0";
    for (let page = 0; page < 10; page++) {
      const chunk = await dApi("GET", `/guilds/${GUILD}/members?limit=1000&after=${after}`);
      if (!Array.isArray(chunk) || !chunk.length) break;
      members.push(...chunk);
      if (chunk.length < 1000) break;
      after = chunk[chunk.length - 1].user.id;
    }
    /* Rule 1.1 (v2.8): registration stays open until the NEXT season's opens — the deadline is
       only the draft-eligibility line. Prefer the season whose registration is open. */
    const season = (await sbGet("seasons?select=id,registration_open&registration_open=is.true&order=number.desc&limit=1"))[0]
      || (await sbGet("seasons?select=id,registration_open,status&status=neq.complete&order=number.asc&limit=1"))[0] || {};
    const regOpen = !!season.registration_open;
    const registered = new Set((await sbGet(`season_registrations?season_id=eq.${season.id}&select=profile_id&limit=10000`)).map((r) => r.profile_id));
    const linkRows = await sbGet("discord_links?select=profile_id,gamertag,discord_id");
    const byDiscord = {}; for (const l of linkRows) if (l.discord_id) byDiscord[String(l.discord_id)] = l;
    const nsu = rid["not signed up"], player = rid["player"];
    const out = {
      guildMembers: members.length, linked: 0, registeredInDb: registered.size, regOpen,
      registeredWearingNotSignedUp: [], registeredMissingPlayer: [],
      unregisteredMissingNotSignedUp: [], unlinkedWearingNotSignedUp: [],
    };
    for (const m of members) {
      if (m.user && m.user.bot) continue;
      const link = byDiscord[String(m.user.id)];
      const has = new Set(m.roles || []);
      const nm = m.nick || (m.user && (m.user.global_name || m.user.username));
      if (!link) { if (nsu && has.has(nsu)) out.unlinkedWearingNotSignedUp.push(nm); continue; }
      out.linked++;
      const isReg = registered.has(link.profile_id);
      if (isReg && nsu && has.has(nsu)) out.registeredWearingNotSignedUp.push(nm);
      if (isReg && player && !has.has(player)) out.registeredMissingPlayer.push(nm);
      if (!isReg && regOpen && nsu && !has.has(nsu)) out.unregisteredMissingNotSignedUp.push(nm);
    }
    out.verdict = (out.registeredWearingNotSignedUp.length || out.registeredMissingPlayer.length || out.unregisteredMissingNotSignedUp.length)
      ? "MISMATCHES — the 2-minute sweep should clear these; if one persists, that member's top role likely outranks the bot"
      : "clean — every linked member's participation roles match the database";
    out.note = "unlinkedWearingNotSignedUp = in the Discord but never signed into the site; the role is telling them the truth";
    return out;
  },

  // Grant the Staff role its moderation powers: "Timeout Members" (the modern mute — blocks
  // sending, reacting and speaking) plus voice Mute. Additive and idempotent: it ORs the bits
  // into whatever the role already has and never takes a permission away. One-shot (not enforced
  // every sync) so the office can still adjust the role by hand in Discord.
  async setupStaffmod() {
    const MODERATE_MEMBERS = 1n << 40n;   // "Timeout Members" — mutes text + voice for a duration
    const MUTE_MEMBERS = 1n << 22n;       // voice mute
    const wanted = MODERATE_MEMBERS | MUTE_MEMBERS;
    const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
    const role = roles.find((r) => (r.name || "").toLowerCase() === "staff");
    if (!role) return { error: "staff role not found" };
    const cur = BigInt(role.permissions || "0");
    const next = cur | wanted;
    const out = { role: role.name, alreadyHad: { timeout: (cur & MODERATE_MEMBERS) !== 0n, voiceMute: (cur & MUTE_MEMBERS) !== 0n } };
    if (next === cur) out.changed = false;
    else {
      await dApi("PATCH", `/guilds/${GUILD}/roles/${role.id}`, { permissions: next.toString() });
      out.changed = true;
    }
    // A role can only time out members whose HIGHEST role sits below it, so surface the blockers.
    const above = roles.filter((r) => r.position > role.position && r.name !== "@everyone" && !r.managed).map((r) => r.name);
    out.cannotModerate = above;   // members whose top role is one of these are out of Staff's reach
    return out;
  },

  // Reconcile the Team Rooms with the live club list: delete every per-club VOICE channel (clubs
  // no longer get voice), delete text rooms + roles for clubs that no longer exist, and provision a
  // private text room + role (no voice) for any current club missing one — e.g. a newly added club.
  async reconcileTeams() {
    const out = { deletedVoice: [], deletedRooms: [], deletedRoles: [], createdRoles: [], createdRooms: [], errors: [] };
    const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
    const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
    const teams = await sbGet("teams?select=id,code,name,color,color2,discord_role_id,discord_channel_id");
    const teamRoomsCat = chans.find((c) => c.type === 4 && (c.name || "").toLowerCase() === "team rooms");
    const currentSlugs = new Set(teams.map((t) => slug(t.name)));
    const roleIdByName = {}; for (const r of roles) roleIdByName[(r.name || "").toLowerCase()] = r.id;
    const orphanSlugs = new Set();

    if (teamRoomsCat) {
      const inCat = chans.filter((c) => c.parent_id === teamRoomsCat.id);
      // every per-club voice channel goes — clubs don't get their own voice
      for (const c of inCat.filter((c) => c.type === 2)) {
        try { await dApi("DELETE", `/channels/${c.id}`); out.deletedVoice.push(c.name); }
        catch (e) { out.errors.push({ voice: c.name, error: String(e.message || e) }); }
      }
      // text rooms for clubs that no longer exist
      for (const c of inCat.filter((c) => c.type === 0)) {
        if (currentSlugs.has(slug(c.name))) continue;
        orphanSlugs.add(slug(c.name));
        try { await dApi("DELETE", `/channels/${c.id}`); out.deletedRooms.push(c.name); }
        catch (e) { out.errors.push({ room: c.name, error: String(e.message || e) }); }
      }
    } else { out.errors.push({ teamRooms: "category not found" }); }

    // orphaned team roles: a role whose slug matches a room we just removed. Never a managed/booster role.
    for (const r of roles) {
      if (r.managed || (r.name || "").toLowerCase() === "@everyone") continue;
      if (orphanSlugs.has(slug(r.name))) {
        try { await dApi("DELETE", `/guilds/${GUILD}/roles/${r.id}`); out.deletedRoles.push(r.name); }
        catch (e) { out.errors.push({ role: r.name, error: String(e.message || e) }); }
      }
    }

    // provision a role + private text room (no voice) for any current club missing one
    // Commissioner + Staff only — the seat roles are worn across every club, so putting them on
    // one club's room opens it to all five front offices (same rule as ensureClubRooms).
    const office = ["commissioner", "staff"].map((n) => roleIdByName[n]).filter(Boolean);
    for (const t of teams) {
      try {
        let trole = t.discord_role_id;
        if (!trole || !roles.find((r) => r.id === trole)) {
          const existing = roles.find((r) => !r.managed && slug(r.name) === slug(t.name));
          if (existing) trole = existing.id;
          else {
            const wantColor = /^#?[0-9a-f]{6}$/i.test(t.color || "") ? parseInt(String(t.color).replace("#", ""), 16) : 0;
            const cr = await dApi("POST", `/guilds/${GUILD}/roles`, { name: t.name, color: wantColor, mentionable: true, permissions: rolePermissionsAtBirth(t.name, roles) });
            if (cr && cr.id) { trole = cr.id; out.createdRoles.push(t.name); }
          }
          if (trole) await sbPatch(`teams?id=eq.${t.id}`, { discord_role_id: trole });
        }
        let tchan = t.discord_channel_id;
        if (teamRoomsCat && (!tchan || !chans.find((c) => c.id === tchan))) {
          const existing = chans.find((c) => c.type === 0 && c.parent_id === teamRoomsCat.id && slug(c.name) === slug(t.name));
          if (existing) tchan = existing.id;
          else {
            const allow = String(1024 | 2048 | 65536); // VIEW + SEND + READ_HISTORY
            const overwrites = [{ id: GUILD, type: 0, deny: "1024", allow: "0" }];
            if (trole) overwrites.push({ id: trole, type: 0, allow, deny: "0" });
            for (const oid of office) overwrites.push({ id: oid, type: 0, allow, deny: "0" });
            const topic = `Private room for the ${t.name} — roster, lineups, and team talk. Visible only to the club and staff.`;
            const cc = await dApi("POST", `/guilds/${GUILD}/channels`, { name: slug(t.name), type: 0, parent_id: teamRoomsCat.id, topic, permission_overwrites: overwrites });
            if (cc && cc.id) { tchan = cc.id; out.createdRooms.push(cc.name); }
          }
          if (tchan) await sbPatch(`teams?id=eq.${t.id}`, { discord_channel_id: tchan });
        }
      } catch (e) { out.errors.push({ provision: t.name, error: String(e.message || e) }); }
    }

    return out;
  },

  // Configure Community onboarding + welcome screen (idempotent). Prompt options reveal CHANNELS
  // only — never roles — so nothing here fights the managed role sync. Enabling onboarding turns on
  // the low-friction rules-accept gate; the welcome bot already skips members still in that gate.
  async setupCommunity() {
    const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
    const idByName = {};
    for (const c of chans) { if (c.type === 0) { const n = (c.name || "").toLowerCase(); if (!idByName[n]) idByName[n] = c.id; } }
    const pick = (names) => names.map((n) => idByName[n]).filter(Boolean);
    const out = {};

    // Welcome screen — the panel a prospective member sees on the invite.
    const ws = [
      { name: "welcome", desc: "Start here — what Chel Gaming is", emoji: "👋" },
      { name: "season-signups", desc: "Register to play this season", emoji: "📝" },
      { name: "pickup-games", desc: "Jump into pickup 6s — run /join", emoji: "🏒" },
      { name: "rules", desc: "The league rulebook", emoji: "📖" },
    ].filter((w) => idByName[w.name]).slice(0, 5);
    try {
      await dApi("PATCH", `/guilds/${GUILD}/welcome-screen`, {
        enabled: true,
        description: "Competitive 6v6 EA NHL — a full season with automated stats, and clubs you can own and run.",
        welcome_channels: ws.map((w) => ({ channel_id: idByName[w.name], description: w.desc, emoji_name: w.emoji })),
      });
      out.welcomeScreen = "set";
    } catch (e) { out.welcomeScreenError = String(e.message || e); }

    // Onboarding — a solid set of default channels + one optional, channel-only routing question.
    const defaults = pick(["welcome", "rules", "announcements", "season-signups", "schedule", "standings", "news", "general-chat", "trash-talk", "highlight-reel", "league-suggestions", "pickup-games"]);
    const opt = (id, title, desc, names) => ({ id, title, description: desc, channel_ids: pick(names), role_ids: [] });
    const onboarding = {
      default_channel_ids: defaults,
      enabled: true,
      mode: 0,
      prompts: [{
        id: "1", type: 0, title: "What brings you to Chel Gaming?",
        single_select: true, required: false, in_onboarding: true,
        options: [
          opt("11", "I want to play this season", "Sign up and get into pickup games.", ["season-signups", "pickup-games"]),
          opt("12", "I want to own or manage a club", "Run a franchise — draft, cap, and trades.", ["season-signups", "announcements", "website"]),
          opt("13", "Just following along", "Scores, standings, and league news.", ["standings", "game-scores", "news"]),
        ],
      }],
    };
    try {
      await dApi("PUT", `/guilds/${GUILD}/onboarding`, onboarding);
      out.onboarding = "enabled";
      out.defaultChannels = defaults.length;
    } catch (e) { out.onboardingError = String(e.message || e); }

    return out;
  },

  async diagGuild() {
    const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
    const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
    const TYPE = { 0: "text", 2: "voice", 4: "category", 5: "announcement", 13: "stage", 15: "forum" };
    const catName = Object.fromEntries(chans.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
    const priv = (c) => {
      const ev = (c.permission_overwrites || []).find((o) => o.id === GUILD);
      return !!ev && (BigInt(ev.deny || "0") & 1024n) === 1024n;
    };
    return {
      roles: roles.filter((r) => r.name !== "@everyone")
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ name: r.name, color: r.color, hoisted: r.hoist, mentionable: r.mentionable, managed: r.managed })),
      channels: chans.filter((c) => c.type !== 4).sort((a, b) => a.position - b.position).map((c) => ({
        name: c.name, type: TYPE[c.type] || c.type, category: catName[c.parent_id] || null,
        private: priv(c), topic: c.topic || null, nsfw: !!c.nsfw, slowmode: c.rate_limit_per_user || 0,
      })),
      categories: chans.filter((c) => c.type === 4).sort((a, b) => a.position - b.position).map((c) => c.name),
    };
  },

  async diagStaff() {
    const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
    const byId = Object.fromEntries(roles.map((r) => [r.id, r.name]));
    const office = roles.filter((r) => ["commissioner", "staff"].includes(r.name.toLowerCase()));
    const cfg = await sbGet("app_config?key=eq.discord_staff_channel_ids&select=value");
    const configured = String((cfg[0] && cfg[0].value) || "").split(",").map((s) => s.trim()).filter(Boolean);
    const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
    // same target set the sync enforces: every room under a private category, plus pinned ids
    const privCatIds = chans.filter((c) => c.type === 4 && (/^staff\b/i.test(c.name || "") || /^commissioners?\b/i.test(c.name || ""))).map((c) => c.id);
    const ids = [...new Set([...configured, ...chans.filter((c) => c.type !== 4 && privCatIds.includes(c.parent_id)).map((c) => c.id)])];
    const report = ids.map((cid) => {
      const c = chans.find((x) => x.id === cid);
      if (!c) return { channel: null, configuredId: cid, exists: false };
      const ow = c.permission_overwrites || [];
      const ev = ow.find((o) => o.id === GUILD);
      return {
        channel: "#" + c.name, exists: true,
        hiddenFromEveryone: !!ev && (BigInt(ev.deny || "0") & 1024n) === 1024n,
        canView: ow.filter((o) => (BigInt(o.allow || "0") & 1024n) === 1024n)
          .map((o) => (o.type === 0 ? byId[o.id] || "(role)" : "(member)")),
      };
    });
    return {
      officeRoles: office.map((r) => r.name),
      privateCategories: chans.filter((c) => privCatIds.includes(c.id)).map((c) => c.name),
      staffChannels: report,
    };
  },

  // Who can actually read each club's room. A club room is for THAT club plus the league
  // office — an Owner/GM/AGM role allow would open every club's room to every club's front
  // office, which is a scouting leak rather than a permission subtlety. Read-only; names only.
  async diagTeamrooms() {
    const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
    const byId = Object.fromEntries(roles.map((r) => [r.id, r.name]));
    const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
    const teams = await sbGet("teams?select=code,name,discord_role_id,discord_channel_id");
    const seatNames = ["owner", "general manager", "assistant general manager"];
    const seatIds = roles.filter((r) => seatNames.includes((r.name || "").toLowerCase())).map((r) => r.id);
    const report = teams.map((t) => {
      const c = t.discord_channel_id && chans.find((x) => x.id === t.discord_channel_id);
      if (!c) return { club: t.code, room: null, provisioned: false };
      const ow = c.permission_overwrites || [];
      const ev = ow.find((o) => o.id === GUILD);
      const viewers = ow.filter((o) => (BigInt(o.allow || "0") & 1024n) === 1024n);
      return {
        club: t.code, room: "#" + c.name, provisioned: true,
        hiddenFromEveryone: !!ev && (BigInt(ev.deny || "0") & 1024n) === 1024n,
        clubRoleCanView: viewers.some((o) => o.id === t.discord_role_id),
        canView: viewers.map((o) => (o.type === 0 ? byId[o.id] || "(role)" : "(member)")),
        // the whole point of this check: seat roles must NOT appear above
        seatRolesWithAccess: viewers.filter((o) => seatIds.includes(o.id)).map((o) => byId[o.id]),
      };
    });
    const leaking = report.filter((r) => (r.seatRolesWithAccess || []).length);
    const catsWithSeats = chans.filter((c) => c.type === 4 && /^team rooms$/i.test(c.name || ""))
      .map((c) => ({ category: c.name,
        seatRolesWithAccess: (c.permission_overwrites || [])
          .filter((o) => seatIds.includes(o.id) && (BigInt(o.allow || "0") & 1024n) === 1024n)
          .map((o) => byId[o.id]) }));
    return {
      verdict: leaking.length
        ? `${leaking.length} club room(s) still grant a seat role — every front office can read them`
        : "clean — each club room is visible to its own club plus the league office only",
      teamRooms: report,
      teamRoomsCategory: catsWithSeats,
    };
  },
};

/* ---- the sweep ------------------------------------------------------------------------------
   Returns { status, body } rather than a Response so the scheduled default export below and the
   run-now door in discord-ops.js can share it. opts.budgetMs overrides the member-pass budget
   (tests). */
export async function runSweep(opts = {}) {
  if (!SB_URL || !SB_KEY || !BOT || !GUILD) {
    console.log("discord-sync: missing env (need bot token + guild id + Supabase) — skipping");
    return { status: 200, body: { skipped: "missing env" } };
  }
  // collapse rapid repeat invocations (run-now bursts); scheduled runs are 2 min apart so this never blocks them
  if (await ranRecently("discord-sync", 6)) return { status: 200, body: { skipped: "ran moments ago" } };
  /* The wall clock for the whole run, and the second stamp. The heartbeat above is written at
     start and the result at the end, so a run Netlify kills at 30 s leaves a fresh heartbeat
     beside a stale ok:true result — the Automations chip stays green while nothing completes.
     rl_discord-sync_started is written here so a killed run is visible as started > result.at. */
  const T0 = Date.now();
  const BUDGET_MS = typeof opts.budgetMs === "number" ? opts.budgetMs : MEMBER_PASS_BUDGET_MS;
  try { await sbUpsertCfg("rl_discord-sync_started", new Date(T0).toISOString()); } catch (e) { /* observability only */ }

  /* Everything below runs inside one try: ranRecently already stamped the heartbeat, so a throw
     from any of the early loads would otherwise leave a fresh heartbeat next to a stale ok:true
     result — the Automations panel would show green forever while nothing ran. The catch writes
     a failing result where the panel reads it. */
  try {

  /* v2.35: a failed input load used to leave its map EMPTY and the role pass ran regardless — one
     Supabase blip stripped department, position, Player/FA/RFA/Rookie and Not-Signed-Up roles from
     every member, and the next sweep put them all back. Any load failure below flips this off and
     the managed roles are left exactly as they are for this run. */
  let inputsOk = true; const inputsErr = [];
  const links = await sbGet("discord_links?select=profile_id,gamertag,role,discord_id,team_id,discord_username");
  // staff department picks (site) -> department Discord roles for the officials who chose them
  const deptByProfile = {};
  try { for (const p of await sbGet("profiles?select=id,departments&role=in.(staff,commissioner)")) deptByProfile[p.id] = p.departments || []; }
  catch (e) { inputsOk = false; inputsErr.push("departments: " + String(e.message || e)); }
  const bannedIds = new Set((await sbGet("profiles?banned=eq.true&select=id")).map((p) => p.id));
  // current in_guild per profile, so we only write when it changes
  const inGuildById = {};
  const avatarById = {};
  /* every gamertag in use, lower-cased -> its owner, for the rename collision check: the unique
     index on profiles.gamertag is case-sensitive while every consumer of the tag (stat linking,
     @-pills, fuzzyProfile) is case-insensitive, so "the tag is free" must be answered without case */
  const tagOwner = new Map();
  for (const p of await sbGet("profiles?select=id,in_guild,avatar_url,gamertag")) {
    inGuildById[p.id] = p.in_guild; avatarById[p.id] = p.avatar_url;
    if (p.gamertag) tagOwner.set(String(p.gamertag).trim().toLowerCase(), p.id);
  }
  const markGuild = async (pid, v) => { if (inGuildById[pid] !== v) { await sbPatch(`profiles?id=eq.${pid}`, { in_guild: v }); inGuildById[pid] = v; } };
  const teams = await sbGet("teams?select=id,code,name,color,color2,logo_url,owner_profile_id,gm_profile_id,agm_profile_id,discord_role_id,discord_channel_id");
  const teamRoleId = Object.fromEntries(teams.filter((t) => t.discord_role_id).map((t) => [t.id, t.discord_role_id]));
  // team management role now lives on the team's slots (owner/gm/agm), not profiles.role
  const mgmtRoleByProfile = {};
  for (const t of teams) {
    if (t.owner_profile_id) mgmtRoleByProfile[t.owner_profile_id] = "owner";
    if (t.gm_profile_id) mgmtRoleByProfile[t.gm_profile_id] = "gm";
    if (t.agm_profile_id) mgmtRoleByProfile[t.agm_profile_id] = "agm";
  }

  // player position (current season) -> for position-based Discord roles
  // POS_LABEL / POSITION_ROLES come from shared/roles.mjs (imported at top)
  const posOf = {};
  const camp = new Set();   /* v2.72: roster spots in training camp this season → the Training Camp role */
  try {
    /* v2.36: sign-up positions come from the season taking sign-ups and roster positions from the
       season in play (active, else the lowest-numbered open season). "Newest season" pointed at a
       Season 2 row created ahead of time and would have emptied every position role. */
    const seasons = await sbGet("seasons?select=id,number,status,registration_open&status=neq.complete&order=number.asc");
    const curSeason = seasons.find((s) => s.status === "active") || seasons[0] || null;
    const regSeasonRow = seasons.filter((s) => s.registration_open).sort((a, b) => b.number - a.number)[0] || curSeason;
    if (regSeasonRow) for (const r of await sbGet(`season_registrations?season_id=eq.${regSeasonRow.id}&select=profile_id,position`)) if (r.position) posOf[r.profile_id] = r.position;
    if (curSeason) for (const s of await sbGet(`roster_spots?season_id=eq.${curSeason.id}&select=profile_id,position,squad,status`)) {
      if (s.position) posOf[s.profile_id] = s.position; // roster spot wins over signup
      if (s.squad === "tc" && (s.status || "active") === "active") camp.add(s.profile_id);
    }
  } catch (e) { inputsOk = false; inputsErr.push("positions: " + String(e.message || e)); }


  // guild roles + channels (id -> current name) for auto-rename + id-based assignment
  const guildRoles = await dApi("GET", `/guilds/${GUILD}/roles`);
  const roleNameById = Object.fromEntries(guildRoles.map((r) => [r.id, r.name]));
  const roleColorById = Object.fromEntries(guildRoles.map((r) => [r.id, r.color]));
  const roleMentionableById = Object.fromEntries(guildRoles.map((r) => [r.id, !!r.mentionable]));
  const roleObjById = Object.fromEntries(guildRoles.map((r) => [r.id, r]));
  const roleId = {};
  for (const r of guildRoles) roleId[r.name.toLowerCase()] = r.id;
  const guildChannels = await dApi("GET", `/guilds/${GUILD}/channels`);
  const chanNameById = Object.fromEntries(guildChannels.map((c) => [c.id, c.name]));

  const sum = { checked: 0, renamed: 0, roleUpdated: 0, roleRenamed: 0, chanRenamed: 0, notInServer: 0,
    staffChecked: 0, staffLocked: 0, staffMissing: 0, errors: [] };

  /* MUST stay below the `sum` declaration above. This block reports into sum.rights and its catch
     writes sum.errors, so sitting even one line higher puts `sum` in the temporal dead zone and the
     ReferenceError throws from both the body AND the catch — taking the entire sweep down, exactly
     as the @everyone call did once before. Roles, welcomes, departures and channel locks all stop. */
  /* Rights classes (Rule 2.2), the NHL's model: service earns freedom.
       · never held a roster spot        -> unrestricted Free Agent. That is EVERYONE in Season 1,
                                            because the league has no history to accrue against.
       · has played, contract now over,
         fewer than N off-seasons served -> Restricted Free Agent: his former club holds his rights.
       · N or more off-seasons served    -> unrestricted for good.
     N is app_config.rfa_offseasons (default 4) so the office can move the line without a deploy.
     Service counts DISTINCT PRIOR seasons with a roster spot — the current season is excluded,
     because you accrue an off-season by finishing a season, not by starting one.
     Rookie is a separate question (how new are you), not a rights class, so it is computed here
     too but applied independently: no prior-season roster spot and no pick in an EARLIER draft. */
  const rfa = new Set(), rookies = new Set();
  try {
    /* v2.36: "current" = the season in play (active, else the lowest-numbered open season). The
       newest row is not it once a next season exists ahead of time — with Season 2 created in
       September, "newest" made every Season 1 roster spot read as PRIOR service and would have
       handed the whole league Restricted Free Agent roles. */
    const seasonsAll = await sbGet("seasons?select=id,number,status,format&status=neq.complete&order=number.asc");
    const curSeason = seasonsAll.find((s) => s.status === "active") || seasonsAll[0] || null;
    const curId = curSeason && curSeason.id, curNum = (curSeason && curSeason.number) || 1;
    /* v2.48: rights classes exist only in the FULL season format (Rule 2.2). A basic season holds
       nobody's rights, so the Restricted Free Agent role is never granted while one is in play. */
    const rightsOn = !!curSeason && curSeason.format === "full";
    const cfgRows = await sbGet("app_config?key=eq.rfa_offseasons&select=value");
    const RFA_YEARS = Math.max(1, parseInt((cfgRows[0] && cfgRows[0].value) || "4", 10) || 4);

    const priorSeasons = {};          // profile_id -> Set of prior season ids held
    for (const r of await sbGet("roster_spots?select=profile_id,season_id")) {
      if (!r.profile_id || !r.season_id || r.season_id === curId) continue;
      (priorSeasons[r.profile_id] = priorSeasons[r.profile_id] || new Set()).add(r.season_id);
    }
    const draftedBefore = new Set();
    for (const d of await sbGet("draft_picks?select=player_id,season_number")) {
      if (d.player_id && (d.season_number || 0) < curNum) draftedBefore.add(d.player_id);
    }
    // who is on a roster right now, and whose contract still runs — neither is a free agent
    const onRosterNow = new Set();
    if (curId) for (const r of await sbGet(`roster_spots?season_id=eq.${curId}&select=profile_id`)) onRosterNow.add(r.profile_id);
    const underContract = new Set();
    // a deal SIGNED for this season (an extension from last season's window, v2.34) holds the player as an active one does
    for (const c of await sbGet(`contracts?status=in.(active,signed)&select=profile_id,is_manager,start_season,end_season`)) {
      if (c.is_manager) continue;
      if ((c.start_season || 1) <= curNum && (c.end_season || 1) >= curNum) underContract.add(c.profile_id);
    }
    for (const pid of Object.keys(priorSeasons)) {
      if (onRosterNow.has(pid) || underContract.has(pid)) continue;   // not a free agent at all
      if (rightsOn && priorSeasons[pid].size < RFA_YEARS) rfa.add(pid);   // rights still held (full format only)
    }
    for (const p of await sbGet("profiles?select=id")) {
      if (!priorSeasons[p.id] && !draftedBefore.has(p.id)) rookies.add(p.id);
    }
    sum.rights = { rfa: rfa.size, rookies: rookies.size, rfaYears: RFA_YEARS, format: rightsOn ? "full" : "basic" };
  } catch (e) { inputsOk = false; inputsErr.push("rights"); sum.errors.push({ rights: String(e.message || e) }); }

  /* @everyone/@here stays with the league office — re-checked every sweep, not just once.
     Must run AFTER `sum` exists: this call sat nine lines above the declaration for one deploy,
     and because the catch block also touches `sum`, the temporal-dead-zone ReferenceError threw
     twice and killed the whole sweep before it could write its result. */
  try { await enforceMentionPolicy(guildRoles, sum); }
  catch (e) { sum.errors.push({ mentionPolicy: String(e.message || e) }); }

  /* Anti-spam baseline, re-asserted every sweep for the same reason the mention policy is: a
     permission changed by hand in the UI, or a role recreated from a template, silently reopens
     the hole and nothing would say so. `teams` (line above) supplies the club role ids; both it
     and `sum` are declared before this point — see the TDZ note above, that mistake cost a sweep. */
  try { await enforcePostingPolicy(guildRoles, teams, sum); }
  catch (e) { sum.errors.push({ postingPolicy: String(e.message || e) }); }
  /* Elevated bits (events, expressions, thread creation) come off every role the sweep owns, and
     the thread bits off @everyone, every sweep — same reasoning as the two policies above. */
  try { await enforceRoleBits(guildRoles, teams, roleId, sum); }
  catch (e) { sum.errors.push({ roleBits: String(e.message || e) }); }
  try {
    const g0 = await dApi("GET", `/guilds/${GUILD}`);
    if (g0 && !g0.__notfound) await enforceVerificationLevel(g0, sum);
  } catch (e) { sum.errors.push({ verificationLevel: String(e.message || e) }); }
  /* Signed-up members may post links; the not-signed-up may not. Runs after `roleId`,
     `guildChannels` and `sum` (all declared above), for the temporal-dead-zone reason noted on the
     mention policy. */
  try { await enforceAutomodExemptions(roleId, guildChannels, sum, teams); }
  catch (e) { sum.errors.push({ automodExempt: String(e.message || e) }); }
  /* #scouting-links: the league reads, club management posts. */
  try { await enforcePostOnlyBoards(guildChannels, roleId, sum); }
  catch (e) { sum.errors.push({ postOnlyBoard: String(e.message || e) }); }
  /* Information: the league posts, everyone reads — no member messages or threads anywhere in it. */
  try { await enforceReadOnlyCategories(guildChannels, roleId, sum); }
  catch (e) { sum.errors.push({ readOnlyCategory: String(e.message || e) }); }
  /* Club notices the gateway bot did not post (it is the instant lane; this is the backstop when
     it is down): anything unposted for 5 minutes goes out from here, under the same claim. */
  try { await flushClubNotices(sum); }
  catch (e) { sum.errors.push({ clubNotices: String(e.message || e) }); }

  /* ---- time-critical, cheap, and therefore EARLY (2026-09-17) ----
     The census, the departure diff, the sign-up withdrawals and the two id-keyed room checks all
     run before any guild furniture and long before the member passes, so a sweep that runs out of
     road (a registration-opening tick with hundreds of role PATCHes) has already done the part
     that cannot wait for the next one. */
  /* the departures room (Information, beside #welcome), and its id for the announcer further down */
  try { const dch = await ensureDeparturesChannel(guildChannels, roleId, sum); if (dch && dch.id) sum.__departChanId = dch.id; }
  catch (e) { sum.errors.push({ departChan: String(e.message || e) }); }
  /* One bulk member list per run instead of a GET per linked member. That was ~40 requests against
     the same route every sweep, which exhausted the rate-limit bucket (and every retry) once the
     cadence moved to 2 minutes. Uses the same paginated endpoint as discord-welcome, so it needs
     no extra intent. If the listing fails we fall back to per-member fetches rather than skipping
     the sweep entirely. */
  const memberById = new Map();
  let memberListOk = false;
  try {
    let after = "0";
    for (let page = 0; page < 10; page++) {
      const chunk = await dApi("GET", `/guilds/${GUILD}/members?limit=1000&after=${after}`);
      if (!Array.isArray(chunk) || !chunk.length) break;
      for (const mm of chunk) if (mm.user && mm.user.id) memberById.set(String(mm.user.id), mm);
      if (chunk.length < 1000) break;
      after = chunk[chunk.length - 1].user.id;
    }
    memberListOk = true;
    sum.memberList = memberById.size;
    sum.pendingAtGate = [...memberById.values()].filter((mm) => mm.pending === true).length;
    sum.bots = [...memberById.values()].filter((mm) => mm.user && mm.user.bot).length;
  } catch (e) { sum.errors.push({ memberList: String(e.message || e) }); }

  /* Diff this census against the last one to see who left. Runs before the per-member passes below
     so a departure is logged on the same tick it is noticed, not the next one. */
  try { await trackDepartures(memberById, memberListOk, links, teams, sum); }
  catch (e) { sum.errors.push({ departures: String(e.message || e) }); }

  /* Sign-ups whose owner has been out of the server past the grace window are withdrawn.
     Deliberately RIGHT after the census lands: the role passes below can take minutes of
     rate-limited Discord calls, and a member whose grace expires this tick but who rejoins
     during that stretch should not be caught by a stale read. Candidates were flagged whole
     ticks ago (the grace is measured in hours), so this never needs the passes below to run
     first. */
  try { await removeDepartedSignups(sum); }
  catch (e) { sum.errors.push({ signupRemoval: String(e.message || e) }); }

  // the Team Management category + its rooms (private to the front office) and the FAQ forums —
  // both keyed by stored id, so a rename is followed rather than duplicated
  try { await ensureMgmtCategory(guildChannels, roleId, sum); } catch (e) { sum.errors.push({ mgmtCategory: String(e.message || e) }); }
  try { await ensureFaqForums(guildChannels, roleId, sum); } catch (e) { sum.errors.push({ faqForums: String(e.message || e) }); }

  // Guild ban list (paginated), fetched once per run. Two jobs:
  //  * stop re-PUTting the same ban every 5 minutes for already-banned members
  //  * UNBAN reconciliation — a site Unban must lift the Discord ban too, or the member can
  //    never rejoin the server and (since registration requires membership) is locked out forever
  const guildBans = new Set();
  try {
    let after = null;
    for (let page = 0; page < 10; page++) {
      const batch = await dApi("GET", `/guilds/${GUILD}/bans?limit=1000${after ? "&after=" + after : ""}`);
      if (!Array.isArray(batch) || !batch.length) break;
      for (const b of batch) if (b.user && b.user.id) guildBans.add(String(b.user.id));
      if (batch.length < 1000) break;
      after = batch[batch.length - 1].user.id;
    }
  } catch (e) { sum.errors.push({ banList: String(e.message || e) }); }

  // Department roles + their Staff-category rooms first, so the private-channel sweep below can
  // self-heal them the same run. deptRoleByChannel lets that sweep keep each room department-private
  // (its role + commissioners) instead of the category default (all staff).
  try { await ensureStaffDepartments(guildChannels, guildRoles, roleId, roleNameById, sum); } catch (e) { sum.errors.push({ staffDepts: String(e.message || e) }); }
  try { await ensureGuildCommands(sum); } catch (e) { sum.errors.push({ commands: String(e.message || e) }); }
  /* One-shot Discord reap: when a club is removed from the league, its role and channel objects
     outlive the database row — the sync creates guild furniture but deliberately never deletes any
     on its own. The commissioner tooling writes the ids to reap into app_config (discord_reap:
     {"roles":[],"channels":[]}); this consumes the list, deletes exactly those ids, and clears the
     key. Explicit ids only — this must never infer what to delete. */
  try {
    const reapCfg = await sbGet(`app_config?key=eq.discord_reap&select=value`);
    if (reapCfg && reapCfg[0] && reapCfg[0].value) {
      const reap = JSON.parse(reapCfg[0].value);
      for (const rid of (reap.roles || [])) {
        try { await dApi("DELETE", `/guilds/${GUILD}/roles/${rid}`); sum.reapedRoles = (sum.reapedRoles || 0) + 1; }
        catch (e) { sum.errors.push({ reapRole: rid, error: String(e.message || e) }); }
      }
      for (const cid of (reap.channels || [])) {
        try { await dApi("DELETE", `/channels/${cid}`); sum.reapedChannels = (sum.reapedChannels || 0) + 1; }
        catch (e) { sum.errors.push({ reapChannel: cid, error: String(e.message || e) }); }
      }
      /* consumed — errors above are surfaced but do NOT re-run forever on a dead id (dApi maps
         404 to null, so an already-gone object counts as reaped) */
      await fetch(`${SB_URL}/rest/v1/app_config?key=eq.discord_reap`, sbOpts({ method: "DELETE", headers: sbHead() }));
    }
  } catch (e) { sum.errors.push({ reap: String(e.message || e) }); }
  const deptRoleByChannel = {};
  for (const d of STAFF_DEPARTMENTS) { const rid = roleId[d.role.toLowerCase()]; if (rid) deptRoleByChannel[d.channel] = rid; }
  try {
    const dmap = {};
    for (const d of STAFF_DEPARTMENTS) if (roleId[d.role.toLowerCase()]) dmap[d.key] = roleId[d.role.toLowerCase()];
    if (Object.keys(dmap).length) await sbUpsertCfg("discord_dept_role_ids", JSON.stringify(dmap));
  } catch (e) { sum.errors.push({ deptRoleIds: String(e.message || e) }); }
  /* The department -> room map, the twin of discord_dept_role_ids above. The gateway bot's instant
     desk alerts (bot/staff-alerts.mjs) resolve a room from this rather than searching the guild by
     name, so a room renamed here is followed there on the next sweep. Matched under the Staff
     category only — a public channel that happens to share the name must never be posted into. */
  try {
    const staffCat = guildChannels.find((c) => c.type === 4 && /^staff\b/i.test(c.name || ""));
    const cmap = {};
    if (staffCat) {
      for (const d of STAFF_DEPARTMENTS) {
        const ch = guildChannels.find((c) => c.name === d.channel && c.parent_id === staffCat.id);
        if (ch && ch.id) cmap[d.key] = ch.id;
      }
    }
    if (Object.keys(cmap).length) await sbUpsertCfg("discord_dept_channel_ids", JSON.stringify(cmap));
    sum.deptChanMapped = Object.keys(cmap).length;
  } catch (e) { sum.errors.push({ deptChannelIds: String(e.message || e) }); }

  // #trade-block and #free-agency self-heal to their intended audience if @everyone view ever
  // gets re-added. They are NOT the same audience: #trade-block is team management only, but
  // #free-agency exists for free agents AND clubs to talk deals, so the Free Agent role must be
  // able to see it — locking it to management hid the channel from the very people it is for.
  // VIEW_CHANNEL(1024)+SEND_MESSAGES(2048)+READ_HISTORY(65536)=68608.
  const MGMT_ALLOW = "68608";
  const mgmtRoleIds = ["owner", "general manager", "assistant general manager", "commissioner"].map((n) => roleId[n]).filter(Boolean);
  const faRoleId = roleId["free agent"];
  const CHANNEL_AUDIENCE = {
    "trade-block": mgmtRoleIds,
    "free-agency": [...mgmtRoleIds, faRoleId].filter(Boolean),
  };
  for (const cname of Object.keys(CHANNEL_AUDIENCE)) {
    const allowIds = CHANNEL_AUDIENCE[cname];
    const chan = guildChannels.find((c) => c.name === cname && c.type === 0);
    if (!chan || !allowIds.length) continue;
    const ow = chan.permission_overwrites || [];
    const everyone = ow.find((o) => o.id === GUILD);
    const hidden = everyone && (BigInt(everyone.deny || "0") & 1024n) === 1024n;
    // Fast-path skip only when it's hidden from @everyone AND every intended role can already
    // view it — otherwise a missing role allow (e.g. Free Agent) would never be healed.
    const allAllowed = allowIds.every((rid) => {
      const o = ow.find((x) => x.id === rid);
      return o && (BigInt(o.allow || "0") & 1024n) === 1024n;
    });
    if (hidden && allAllowed) continue;
    try {
      // Grant the audience FIRST, then deny @everyone — never deny-then-stop, or a mid-sweep
      // failure would leave the channel hidden from everyone including its own audience.
      for (const rid of allowIds) await dApi("PUT", `/channels/${chan.id}/permissions/${rid}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
      await dApi("PUT", `/channels/${chan.id}/permissions/${GUILD}`, { type: 0, deny: "1024", allow: "0" });
      sum.mgmtLocked = (sum.mgmtLocked || 0) + 1;
    } catch (e) { sum.errors.push({ lockChannel: cname, error: String(e.message || e) }); }
  }

  // Team channels self-heal the same way: private to the club + the league office (Commissioner +
  // Staff). The club-role allow goes in the SAME pass as the @everyone deny (never deny first and
  // stop — the club would lose sight of its own room).
  //
  // The fast-path checks FOUR things, not two. Checking only "hidden + club can view" let two
  // real faults survive indefinitely, because a room that was hidden with its club allowed was
  // never looked at again: #hurricanes and #maple-leafs sat without Staff access, and #penguins
  // kept the Owner/GM/AGM allows its creation pass had added — which let every club's front
  // office read another club's room.
  const staffRoleIds = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  // Seat roles are worn across clubs, so they must never appear on a single club's room.
  const seatRoleIds = ["owner", "general manager", "assistant general manager"].map((n) => roleId[n]).filter(Boolean);
  for (const t of teams) {
    if (!t.discord_channel_id || !t.discord_role_id) continue;
    const chan = guildChannels.find((c) => c.id === t.discord_channel_id);
    if (!chan) continue;
    const ow = chan.permission_overwrites || [];
    const everyone = ow.find((o) => o.id === GUILD);
    const clubAllow = ow.find((o) => o.id === t.discord_role_id);
    const hidden = everyone && (BigInt(everyone.deny || "0") & 1024n) === 1024n;
    const clubOk = clubAllow && (BigInt(clubAllow.allow || "0") & 1024n) === 1024n;
    const officeOk = staffRoleIds.every((rid) => {
      const o = ow.find((x) => x.id === rid);
      return o && (BigInt(o.allow || "0") & 1024n) === 1024n;
    });
    // any seat-role overwrite at all, granting or not — none belongs on a club room
    const strays = ow.filter((o) => seatRoleIds.includes(o.id));
    if (hidden && clubOk && officeOk && !strays.length) continue;
    try {
      await dApi("PUT", `/channels/${chan.id}/permissions/${t.discord_role_id}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
      for (const rid of staffRoleIds) await dApi("PUT", `/channels/${chan.id}/permissions/${rid}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
      // remove the cross-club seat roles only — a member-specific overwrite or the bot's own
      // integration role is somebody's deliberate choice and is left exactly as it is
      for (const o of strays) {
        await dApi("DELETE", `/channels/${chan.id}/permissions/${o.id}`);
        sum.teamSeatRolesRemoved = (sum.teamSeatRolesRemoved || 0) + 1;
      }
      await dApi("PUT", `/channels/${chan.id}/permissions/${GUILD}`, { type: 0, deny: "1024", allow: "0" });
      sum.teamLocked = (sum.teamLocked || 0) + 1;
    } catch (e) { sum.errors.push({ lockChannel: t.name, error: String(e.message || e) }); }
  }

  // Private categories, and exactly who may read each. The league office is NOT one audience:
  // #commissioner-chat is commissioners only, while the staff rooms are commissioners AND staff.
  // Widening one regex to cover both categories would quietly hand Staff the commissioners' room,
  // so the permitted roles are declared per category instead.
  const PRIVATE_CATEGORIES = [
    { match: /^staff\b/i,          roles: ["commissioner", "staff"] },
    { match: /^commissioners?\b/i, roles: ["commissioner"] },
  ];

  // Each private room is self-healed on every pass, exactly like the club rooms. Membership comes
  // from the category a channel sits in, so a room added months from now is covered without anyone
  // remembering to register it — plus any ids pinned in app_config.discord_staff_channel_ids.
  // SAFETY: a category whose roles don't resolve is skipped entirely. Denying @everyone with no
  // allow in place would hide the room from everybody, including the people who need it.
  try {
    const cfgRows = await sbGet("app_config?key=eq.discord_staff_channel_ids&select=value");
    const pinned = String((cfgRows[0] && cfgRows[0].value) || "")
      .split(",").map((s) => s.trim()).filter(Boolean);

    // channel id -> the role ids permitted to see it
    const target = new Map();
    for (const spec of PRIVATE_CATEGORIES) {
      const allowIds = spec.roles.map((n) => roleId[n]).filter(Boolean);
      if (allowIds.length !== spec.roles.length) {
        sum.errors.push({ lockPrivate: `roles ${spec.roles.join("+")} did not all resolve — category skipped rather than risk hiding it from everyone` });
        continue;
      }
      const catIds = guildChannels.filter((c) => c.type === 4 && spec.match.test(c.name || "")).map((c) => c.id);
      // every channel type, not just text — a private voice room or forum is exactly as private as
      // a text room, and VIEW_CHANNEL is what gates all of them
      for (const c of guildChannels) {
        if (c.type !== 4 && catIds.includes(c.parent_id)) {
          // a department room stays private to ITS role + the commissioners, not all of staff
          const deptRid = deptRoleByChannel[c.name];
          target.set(c.id, deptRid ? [roleId["commissioner"], deptRid].filter(Boolean) : allowIds);
        }
      }
    }
    // pinned ids default to the staff audience, which is what they were registered for
    if (staffRoleIds.length) for (const id of pinned) if (!target.has(id)) target.set(id, staffRoleIds);

    if (target.size) {
      for (const [cid, allowIds] of target) {
        sum.staffChecked++;
        const chan = guildChannels.find((c) => c.id === cid);
        // a pinned room that no longer exists is a misconfiguration, not an outage — count it
        // so the Automations panel shows it, but don't page the watchdog over a deleted channel
        if (!chan) { sum.staffMissing++; continue; }
        const ow = chan.permission_overwrites || [];
        const everyone = ow.find((o) => o.id === GUILD);
        const hidden = everyone && (BigInt(everyone.deny || "0") & 1024n) === 1024n;
        const officeOk = allowIds.every((rid) => {
          const a = ow.find((o) => o.id === rid);
          return a && (BigInt(a.allow || "0") & 1024n) === 1024n;
        });
        if (hidden && officeOk) continue; // already correct
        // grant the permitted roles FIRST, then hide from @everyone (never the other way round)
        for (const rid of allowIds) await dApi("PUT", `/channels/${chan.id}/permissions/${rid}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
        await dApi("PUT", `/channels/${chan.id}/permissions/${GUILD}`, { type: 0, deny: "1024", allow: "0" });
        sum.staffLocked++;
      }
    }
  } catch (e) { sum.errors.push({ lockPrivate: String(e.message || e) }); }

  // A room's topic states who it's for, and the sweep above states who can actually read it — when
  // those disagree the topic is the one that misleads (#design-suggestions announced itself as
  // "Staff-only" while sitting in the commissioners-only category). Canonical topics live in
  // app_config.discord_channel_topics as {"channel-name": "topic"} so they can be corrected without
  // a deploy, and are reconciled here the same way club topics are.
  try {
    const rows = await sbGet("app_config?key=eq.discord_channel_topics&select=value");
    const want = rows[0] && rows[0].value ? JSON.parse(rows[0].value) : null;
    if (want) {
      // Only text-like channels carry a topic — voice and stage reject it outright with a 400.
      const TOPIC_TYPES = [0, 5, 15];
      for (const [name, topic] of Object.entries(want)) {
        const chan = guildChannels.find((c) => c.name === name && TOPIC_TYPES.includes(c.type));
        if (!chan || (chan.topic || "") === topic) continue;
        // one unhappy channel must not abandon the rest of the map
        try {
          await dApi("PATCH", `/channels/${chan.id}`, { topic });
          sum.topicsFixed = (sum.topicsFixed || 0) + 1;
        } catch (e) { sum.errors.push({ channelTopic: name, error: String(e.message || e).slice(0, 140) }); }
      }
    }
  } catch (e) { sum.errors.push({ channelTopics: String(e.message || e) }); }

  // (0) keep each team's Discord ROLE (name + color) + CHANNEL name in sync with the site
  for (const t of teams) {
    try {
      if (t.discord_role_id && roleNameById[t.discord_role_id]) {
        const patch = {};
        if (roleNameById[t.discord_role_id] !== t.name) { patch.name = t.name; sum.roleRenamed++; }
        // role color mirrors the club's primary color from the site (teams.color hex -> int)
        const wantColor = /^#?[0-9a-f]{6}$/i.test(t.color || "") ? parseInt(String(t.color).replace("#", ""), 16) : null;
        if (wantColor != null && roleColorById[t.discord_role_id] !== wantColor) {
          patch.color = wantColor; sum.roleRecolored = (sum.roleRecolored || 0) + 1;
        }
        /* Club roles are MENTIONABLE (2026-09-14): a club's management rallies its room with an
           @Club ping — in the team channel and in any channel they can post in — and Discord's only
           other way to let someone ping a non-mentionable role is MENTION_EVERYONE, which is the
           server-wide megaphone enforceMentionPolicy exists to keep with the league office. A role
           ping reaches only that club's members, so it needs none of that. Reconciled here every
           sweep so a hand-edit in the UI cannot quietly switch it back off. */
        if (roleMentionableById[t.discord_role_id] !== true) {
          patch.mentionable = true; sum.clubRoleMentionable = (sum.clubRoleMentionable || 0) + 1;
        }
        if (Object.keys(patch).length) await dApi("PATCH", `/guilds/${GUILD}/roles/${t.discord_role_id}`, patch);
      }
      const wantSlug = slug(t.name);
      // The topic names the club, so a rename has to carry into it too. Syncing only the name is how
      // every team room ended up advertising a club that no longer exists ("Private room for the
      // Aurora Blades" sitting on #dallas-stars). Name and topic go in one PATCH — same rate limit.
      const wantTopic = `Private room for the ${t.name} — roster, lineups, and team talk. Visible only to the club and staff.`;
      if (t.discord_channel_id && chanNameById[t.discord_channel_id]) {
        const cur = guildChannels.find((c) => c.id === t.discord_channel_id);
        const cpatch = {};
        if (chanNameById[t.discord_channel_id] !== wantSlug) { cpatch.name = wantSlug; sum.chanRenamed++; }
        if (cur && (cur.topic || "") !== wantTopic) { cpatch.topic = wantTopic; sum.chanRetopic = (sum.chanRetopic || 0) + 1; }
        if (Object.keys(cpatch).length) await dApi("PATCH", `/channels/${t.discord_channel_id}`, cpatch);
      }
    } catch (e) { sum.errors.push({ team: t.name, error: String(e.message || e) }); }
  }

  // ensure a Discord role exists for every position (created once, then reused)
  for (const pn of POSITION_ROLES) {
    if (!roleId[pn.toLowerCase()]) {
      try {
        const created = await dApi("POST", `/guilds/${GUILD}/roles`, { name: pn, mentionable: false, permissions: rolePermissionsAtBirth(pn, guildRoles) });
        if (created && created.id) { roleId[pn.toLowerCase()] = created.id; roleNameById[created.id] = pn; guildRoles.push(created); sum.rolesCreated = (sum.rolesCreated || 0) + 1; }
      } catch (e) { sum.errors.push({ role: pn, error: String(e.message || e) }); }
    }
  }

  // managed role ids = static roles + position roles (by name) + every team's role (by stored id)
  // MANAGED_STATIC comes from shared/roles.mjs (imported at top)
  // ensure the mentionable roles the automations depend on exist (created once, then reused):
  //  Staff (members ping the officials), the front-office roles (gate the Team Management rooms),
  //  and "Not Signed Up" (the daily sign-up reminder pings this one role).
  const ENSURE_ROLES = [["Training Camp", true], ["Staff", true], ["Owner", true], ["General Manager", true], ["Assistant General Manager", true], ["CGHL Management", true], ["Not Signed Up", true], ["Restricted Free Agent", true], ["Rookie", true]];
  for (const [name, mentionable] of ENSURE_ROLES) {
    if (roleId[name.toLowerCase()]) continue;
    try {
      const created = await dApi("POST", `/guilds/${GUILD}/roles`, { name, mentionable, permissions: rolePermissionsAtBirth(name, guildRoles) });
      if (created && created.id) { roleId[name.toLowerCase()] = created.id; roleNameById[created.id] = name; guildRoles.push(created); sum.rolesCreated = (sum.rolesCreated || 0) + 1; }
    } catch (e) { sum.errors.push({ role: name, error: String(e.message || e) }); }
  }
  // Reconcile properties on the EXISTING static roles — ENSURE_ROLES only sets them at creation,
  // so roles seeded before the intent changed drifted (Owner and AGM ended up mentionable:false,
  // and the senior Owner role sat un-hoisted below the hoisted GM). Enforce the declared config.
  //   [name, mentionable, hoist]
  const ROLE_PROPS = [
    ["Owner", true, true], ["General Manager", true, true], ["Assistant General Manager", true, false],
    /* the whole front office in one handle — mentionable so the league office can reach every
       Owner, GM and AGM at once; not hoisted, because the three seat roles already head the list */
    ["CGHL Management", true, false],
    ["Staff", true, true], ["Commissioner", true, true], ["Not Signed Up", true, false],
    /* the two rights classes sit beside Free Agent, and Rookie beside them — mentionable so the
       office can address a class at once, unhoisted so they do not crowd the seat roles */
    ["Restricted Free Agent", true, false], ["Rookie", true, false],
    /* v2.72: camp players, so management can address its camp at once; unhoisted, a badge not a rank */
    ["Training Camp", true, false],
  ];
  for (const [name, mentionable, hoist] of ROLE_PROPS) {
    const rid = roleId[name.toLowerCase()];
    const cur = rid && roleObjById[rid];
    if (!cur) continue;
    if (cur.mentionable !== mentionable || cur.hoist !== hoist) {
      try {
        await dApi("PATCH", `/guilds/${GUILD}/roles/${rid}`, { mentionable, hoist });
        sum.roleUpdated = (sum.roleUpdated || 0) + 1;
      } catch (e) { sum.errors.push({ roleProps: name, error: String(e.message || e) }); }
    }
  }
  if (roleId["not signed up"]) await sbUpsertCfg("discord_not_signed_up_role_id", roleId["not signed up"]);
  // Publish a name->id map of the league roles so the DATABASE can render @role pills too
  // (public._role_tag reads this). Without it the DB can only bold a role name.
  try {
    /* "cghl management" is the one role that covers all three front-office seats; the weekly
       lineup reminder pings it instead of three separate roles (commissioner, 2026-09-22). It is
       published here with the rest so there is no second place that has to learn its id. */
    const wanted = ["staff", "commissioner", "owner", "general manager", "assistant general manager", "player", "free agent", "not signed up", "cghl management"];
    const map = {};
    for (const n of wanted) if (roleId[n]) map[n] = roleId[n];
    if (Object.keys(map).length) await sbUpsertCfg("discord_role_ids", JSON.stringify(map));
  } catch (e) { sum.errors.push({ roleIdMap: String(e.message || e) }); }
  try { await ensureAnnouncements(guildChannels, roleId, sum); } catch (e) { sum.errors.push({ announcements: String(e.message || e) }); }
  try { await ensureCommunityChannels(guildChannels, teams, roleId, sum); } catch (e) { sum.errors.push({ communityChannels: String(e.message || e) }); }
  /* after the Team Rooms category is in place: give any club still missing a role or room one
     (a club created by an approved owner application arrives with neither) */
  try { await ensureClubRooms(guildChannels, guildRoles, teams, roleId, sum); } catch (e) { sum.errors.push({ clubRooms: String(e.message || e) }); }
  /* a club that rebranded or relocated: bring its role + room name/colour back in line with the DB */
  try { await syncClubIdentity(guildChannels, guildRoles, teams, sum); } catch (e) { sum.errors.push({ clubIdentity: String(e.message || e) }); }
  try { await syncRoleIcons(guildRoles, teams, roleId, sum); } catch (e) { sum.errors.push({ roleIcons: String(e.message || e) }); }
  /* club colours above the front-office seats, so a player's name shows their club */
  try { await ensureRoleOrder(guildRoles, teams, roleId, sum); } catch (e) { sum.errors.push({ roleOrder: String(e.message || e) }); }

  const managedIds = managedRoleIds(roleId, teams);

  // Current-season registration drives the three participation roles. `registered` is populated
  // year-round (not only while the window is open) so Player and Free Agent stay coherent all
  // season; `regOpen` is the narrower "sign-ups still open" flag that drives Not Signed Up.
  let regOpen = false; const registered = new Set();
  try {
    const s = (await sbGet("seasons?select=id,registration_open&registration_open=is.true&order=number.desc&limit=1"))[0]
      || (await sbGet("seasons?select=id,registration_open,status&status=neq.complete&order=number.asc&limit=1"))[0];   /* v2.36: the season in play, never the newest */
    if (s) {
      regOpen = !!s.registration_open;   /* Rule 1.1 (v2.8): the deadline never closes registration */
      for (const r of await sbGet(`season_registrations?season_id=eq.${s.id}&select=profile_id`)) registered.add(r.profile_id);
    }
  } catch (e) { inputsOk = false; inputsErr.push("registrations"); sum.errors.push({ regStatus: String(e.message || e) }); }

  if (!inputsOk) sum.errors.push({ inputs: "load failed (" + inputsErr.join("; ") + ") — managed roles left untouched this run" });
  /* The two member passes are the only part of the sweep whose cost scales with the server, and
     they run LAST for that reason: everything time-critical above has already landed. They stop
     when the budget is spent and the result says so (partial, membersLeft); the next tick picks
     the remainder up, because a member that needed nothing is a no-op that costs no request. */
  const outOfTime = () => Date.now() - T0 > BUDGET_MS;
  const ctx = { links, bannedIds, guildBans, memberById, memberListOk, markGuild, avatarById, tagOwner, inputsOk,
    roleId, teamRoleId, registered, regOpen, mgmtRoleByProfile, deptByProfile, posOf, rfa, rookies, camp, managedIds };
  await syncLinkedMembers(ctx, sum, outOfTime);
  try { await syncUnlinkedMembers(ctx, sum, outOfTime); }
  catch (e) { sum.errors.push({ unlinkedPass: String(e.message || e) }); }
  sum.elapsedMs = Date.now() - T0;

  console.log("discord-sync:", JSON.stringify(sum));
  // per-run result for the Automations panel — red chip + last error when a run fails
  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, sbOpts({ method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "rl_discord-sync_result", value: JSON.stringify({
        at: new Date().toISOString(), ok: sum.errors.length === 0, checked: sum.checked,
        /* a run cut short by the time budget is a fact the panel must show, not an error */
        partial: !!sum.partial, membersLeft: sum.membersLeft || 0, elapsedMs: sum.elapsedMs,
        unlinkedSeen: sum.unlinkedSeen, unlinkedTagged: sum.unlinkedTagged,
        renamed: sum.renamed, renameCollisions: sum.renameCollisions || 0,
        roleBitsStripped: sum.roleBitsStripped || 0, disboardManageChannels: sum.disboardManageChannels || null,
        automodPruned: sum.automodPruned || 0, feedsLocked: sum.feedsLocked || 0,
        mgmtRoomsHealed: sum.mgmtRoomsHealed || 0, mgmtRoomsAdopted: sum.mgmtRoomsAdopted || 0,
        faqForumsAdopted: sum.faqForumsAdopted || 0, faqForumsHealed: sum.faqForumsHealed || 0,
        departRowsWritten: sum.departRowsWritten || 0, clubNoticeBookkeeping: sum.clubNoticeBookkeeping || 0,
        gate: sum.gate, guildMemberCount: sum.guildMemberCount, memberList: sum.memberList,
        departed: sum.departed || 0, departAnnounced: sum.departAnnounced || 0,
        signupsRemoved: (sum.signupsRemoved || []).length,
        roleGradients: sum.roleGradients || 0, roleGradientUnsupported: sum.roleGradientUnsupported || null,
        roleIcons: sum.roleIcons || 0,
        automodExempted: sum.automodExempted || 0, automodMgmtExempted: sum.automodMgmtExempted || 0, automodChannels: sum.automodChannels || 0,
        automodCreated: sum.automodCreated || null, automodGifAllow: sum.automodGifAllow || 0,
        automodMissing: sum.automodMissing || null, boardsLocked: sum.boardsLocked || 0, infoLocked: sum.infoLocked || 0,
        clubNoticesPosted: sum.clubNoticesPosted || 0,
        reapedRoles: sum.reapedRoles || 0, reapedChannels: sum.reapedChannels || 0,
        postingStripped: sum.postingStripped || 0, postingGranted: sum.postingGranted || 0,
        verificationRaised: sum.verificationRaised || null,
        mentionStripped: sum.mentionStripped || 0,
        pendingAtGate: sum.pendingAtGate, bots: sum.bots,
        staffChecked: sum.staffChecked, staffLocked: sum.staffLocked, staffMissing: sum.staffMissing,
        errCount: sum.errors.length, lastError: sum.errors[0] ? JSON.stringify(sum.errors[0]).slice(0, 200) : null
      }), updated_at: new Date().toISOString() }) }));
  } catch {}
  return { status: 200, body: sum };

  } catch (e) {
    // the heartbeat is already stamped — record the failure or the panel lies green
    try {
      await fetch(`${SB_URL}/rest/v1/app_config`, sbOpts({ method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ key: "rl_discord-sync_result", value: JSON.stringify({
          at: new Date().toISOString(), ok: false, errCount: 1,
          lastError: String(e.message || e).slice(0, 200)
        }), updated_at: new Date().toISOString() }) }));
    } catch {}
    return { status: 500, body: { error: String(e.message || e) } };
  }
}

/* the scheduled entry point: Netlify calls this every two minutes with no useful request */
export default async () => {
  const r = await runSweep();
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
};

/* Exposed for tools/departures.test.mjs. The departure tracker is the one part of this file whose
   failure mode is silent and public — a false mass-departure would page the commissioners with a
   fake exodus — so it is tested directly rather than only through the whole sync. */
export const _internals = { fetchClubLogoPng, readRoleIcon, enforcePostingPolicy, enforceVerificationLevel, POST_BITS,
  removeDepartedSignups, SIGNUP_REMOVAL_GRACE_HOURS,
  dApi, flushClubNotices, syncLinkedMembers, syncUnlinkedMembers, MEMBER_PASS_BUDGET_MS, DEPART_TOUCH_MS,
  enforceRoleBits, rolePermissionsAtBirth, ROLE_STRIP_BITS, EVERYONE_STRIP_BITS, CREATE_THREAD_BITS, CREATE_EVENTS,
  CREATE_GUILD_EXPRESSIONS, MANAGE_CHANNELS, ROLE_BITS_KEEP,
  ensureMgmtCategory, MGMT_ROOMS, MGMT_CFG_KEY, MGMT_CAT_KEY, MGMT_CHAT_ALLOW, MGMT_CHAT_DENY, MGMT_FEED_ALLOW, MGMT_FEED_DENY, MGMT_OFFICE_ALLOW,
  ensureFaqForums, FAQ_CFG_KEY, POST_ONLY_FEEDS, AUTOMOD_OFFICE,
  AUTOMOD_SPAM_RULE, AUTOMOD_MENTION_RULE, AUTOMOD_MGMT_EXEMPT,
  enforceAutomodExemptions, AUTOMOD_EXEMPT, AUTOMOD_LINK_RULE, AUTOMOD_ADS_RULE,
  AUTOMOD_URL_RULE, AUTOMOD_URL_REGEX, AUTOMOD_URL_ALLOW, DENY_STRIP_NAMED, DENY_GRANT_NAMED,
  AUTOMOD_EXEMPT_CHANNELS, enforcePostOnlyBoards, POST_ONLY_BOARDS,
  BOARD_EVERYONE_ALLOW, BOARD_EVERYONE_DENY, BOARD_POSTER_ALLOW,
  enforceReadOnlyCategories, READ_ONLY_CATEGORIES, INFO_EVERYONE_ALLOW, INFO_EVERYONE_DENY, INFO_POSTER_ALLOW, THREAD_BITS,
  CREATE_INSTANT_INVITE, POST_DENY, POST_ALLOW_STATIC, MIN_VERIFICATION_LEVEL,
  trackDepartures, announceDepartures, ensureDeparturesChannel, DEPART_SANITY,
  enforceMentionPolicy, MENTION_EVERYONE, MENTION_ALLOWED };
