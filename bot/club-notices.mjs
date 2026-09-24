// Club notices — every signing, waiver, trade, loan and roster move, posted into the club's own
// private Discord room the moment the database records it (2026-09-14, v2.42).
//
// The database is the writer: public.club_notify() inserts one row per club per event into
// public.club_notices (and creates the site notifications for the Owner, GM and AGM). This lane
// listens to that table and posts each row into teams.discord_channel_id. The public feeds
// (#transactions, #trade-block, #management-moves) are untouched — this is the front office's copy.
//
// Exactly-once: a row is claimed on discord_post_log (kind "club", ref "club:<id>") before it is
// posted, so the live realtime path and the catch-up (this file's sweep, and discord-sync's) can
// both try the same row and only one message goes out. posted_at is stamped after delivery; a row
// that could not be delivered keeps posted_at null with post_error set, and is retried by the
// catch-up until it lands.
//
// The claim is released ONLY when Discord provably never took the message (a 4xx, a body with no
// message id). A timeout or a 5xx is an unknown outcome — the message may be sitting in the room —
// so the claim is kept, the row is marked "unconfirmed", and nothing re-sends it: the backstop
// used to double-post exactly here (audit 2026-09-17, P2-12). And once Discord HAS accepted the
// message, the posted_at stamp is retried and, failing that, the claim is still kept: releasing
// it after a delivery is the other way to post twice.
import { timedFetch, withRetries, SB_TIMEOUT_MS, DISCORD_TIMEOUT_MS } from "./handlers.mjs";

const UA = "DiscordBot (https://chelgamingleague.com,1.0)";
const SITE = "https://chelgamingleague.com";

/* one look for all of them: colour by kind, a compact title, the body as written by the database */
export const KIND_STYLE = {
  sign:  { colour: 0x2F9E44, icon: "✍️" },
  draft: { colour: 0x2F9E44, icon: "🎯" },
  loan:  { colour: 0x5C6B75, icon: "🔁" },
  waive: { colour: 0xC2410C, icon: "📤" },
  trade: { colour: 0xFFE500, icon: "🔄" },
  roster:{ colour: 0x8899A6, icon: "🧾" },
  offer: { colour: 0x1C7ED6, icon: "📨" },
  /* v2.72: a player's weekly availability, the moment it is in (notify_availability_submitted) */
  availability: { colour: 0x0CA678, icon: "📅" },
};
export function buildNoticeEmbed(row, actorName) {
  const st = KIND_STYLE[row.kind] || { colour: 0x8899A6, icon: "🧾" };
  const tail = actorName ? "\n— " + actorName : "";
  return {
    title: st.icon + " " + String(row.title || "Roster move"),
    description: String(row.body || "") + tail,
    color: st.colour,
    url: SITE + "/#/hub/" + (row.kind === "trade" ? "tradehub" : row.kind === "offer" ? "freeagents" : row.kind === "availability" ? "lineups" : "roster"),
    timestamp: row.created_at || new Date().toISOString(),
  };
}

export function createClubNotices(env, opts = {}) {
  const { SB_URL, SB_KEY, BOT } = env;
  const SB_MS = opts.sbTimeoutMs ?? SB_TIMEOUT_MS;
  const D_MS = opts.discordTimeoutMs ?? DISCORD_TIMEOUT_MS;
  /* failed: Discord provably refused it (retried by the catch-up). unconfirmed: outcome unknown,
     claim kept, never re-sent. stampFailed: delivered, but posted_at would not write — the claim
     stands in for the stamp. errors / lastErrorAt / lastError feed the gateway heartbeat. */
  const sum = { announced: 0, skipped: 0, failed: 0, unconfirmed: 0, stampFailed: 0, errors: 0, lastErrorAt: null, lastError: null };
  const errors = [];
  const note = (e) => {
    const msg = String((e && e.message) || e).slice(0, 180);
    errors.push(msg); if (errors.length > 20) errors.shift();
    sum.errors++; sum.lastErrorAt = Date.now(); sum.lastError = msg;
  };
  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
  async function sbGet(path) {
    const r = await timedFetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() }, SB_MS);
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
  }
  async function sbPatch(path, body) {
    const r = await timedFetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify(body) }, SB_MS);
    if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status}`);
  }
  /* ONE attempt at Discord, apart from a 429 — which is a definitive rejection, nothing was
     stored, so waiting out Retry-After and sending again is safe. A 5xx or a timeout is not:
     the message may already be in the room, and the old retry loop here is where a club used to
     read the same waiver twice. Those throw tagged `ambiguous`; a 4xx or a body without a
     message id throws tagged `provable` (never delivered). The caller's claim handling turns on
     exactly that tag. */
  async function post(channelId, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await timedFetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST", headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, D_MS);
      if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
      if (r.status >= 500) { const e = new Error(`post ${channelId} -> ${r.status} (delivery unknown)`); e.ambiguous = true; throw e; }
      if (!r.ok) { const e = new Error(`post ${channelId} -> ${r.status}`); e.provable = true; throw e; }
      const t = await r.text();
      const j = t ? JSON.parse(t) : null;
      if (!j || !j.id) { const e = new Error(`post ${channelId} did not deliver`); e.provable = true; throw e; }
      return j;
    }
    const e = new Error(`post ${channelId} -> rate-limited after retries`); e.provable = true; throw e;
  }
  async function claim(ref) {
    const r = await timedFetch(`${SB_URL}/rest/v1/discord_post_log`, { method: "POST", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify({ kind: "club", ref }) }, SB_MS);
    if (r.status === 201) return true;
    if (r.status === 409) return false;
    note(new Error(`claim ${ref} -> ${r.status}`));
    return false;
  }
  async function release(ref) {
    try { await timedFetch(`${SB_URL}/rest/v1/discord_post_log?kind=eq.club&ref=eq.${encodeURIComponent(ref)}`, { method: "DELETE", headers: { ...sbHead(), Prefer: "return=minimal" } }, SB_MS); }
    catch (e) { note(e); }
  }
  const stamp = (rowId, body) => sbPatch(`club_notices?id=eq.${encodeURIComponent(rowId)}`, body);

  /* Rows this process settled without a stamp, so the catch-up — which selects on posted_at
     alone — does not look them up and hit its own claim every five minutes for the rest of the
     season. Delivered-but-unstamped rows get their stamp retried on every pass instead; unconfirmed
     ones are skipped outright. In memory only: a restart re-reads them once, meets the claim
     (409), and settles them again. */
  const unstamped = new Map();   // ref -> row id: Discord has it, posted_at does not
  const unconfirmed = new Set(); // ref: outcome unknown, claim held, never re-sent

  /* one row → one message in the club's room */
  async function announce(row) {
    const ref = row && row.id ? "club:" + row.id : null;
    try {
      if (!row || !row.id || !row.team_id) { sum.skipped++; return "skip"; }
      if (row.posted_at) { sum.skipped++; return "already"; }
      if (unconfirmed.has(ref)) { sum.skipped++; return "unconfirmed"; }
      if (unstamped.has(ref)) {
        /* the message is in the room; only the bookkeeping is owed */
        try { await stamp(row.id, { posted_at: new Date().toISOString(), post_error: null }); unstamped.delete(ref); return "stamped-late"; }
        catch (e) { note(e); return "unstamped"; }
      }
      const teams = await sbGet(`teams?id=eq.${encodeURIComponent(row.team_id)}&select=id,code,discord_channel_id`);
      const t = teams[0];
      if (!t || !t.discord_channel_id) { sum.skipped++; return "no-room"; }
      let actor = null;
      if (row.actor_profile_id) {
        try { const p = await sbGet(`profiles?id=eq.${encodeURIComponent(row.actor_profile_id)}&select=gamertag`); actor = p[0] && p[0].gamertag ? p[0].gamertag : null; }
        catch { /* the notice stands without the name */ }
      }
      if (!(await claim(ref))) { sum.skipped++; return "claimed-elsewhere"; }
      try {
        /* v3.11 — a notice may carry ONE role mention (ping_role_id). The role has to be named in
           BOTH the content and allowed_mentions.roles: content alone renders the mention but
           Discord suppresses the notification, and allowed_mentions alone pings nobody because
           there is no mention in the body to allow. Everything without the column behaves exactly
           as before, mentions suppressed, because the default is null. */
        const ping = row.ping_role_id ? String(row.ping_role_id) : null;
        await post(t.discord_channel_id, {
          ...(ping ? { content: `<@&${ping}>` } : {}),
          embeds: [buildNoticeEmbed(row, actor)],
          allowed_mentions: ping ? { parse: [], roles: [ping] } : { parse: [] },
        });
      } catch (e) {
        const msg = String(e.message || e).slice(0, 200);
        if (e.provable) {
          /* Discord never took it: hand the claim back so the catch-up can land it */
          await release(ref);
          try { await stamp(row.id, { post_error: msg }); } catch { /* observability only */ }
          throw e;
        }
        /* unknown outcome: the claim stays, the row says why, nobody sends it again */
        unconfirmed.add(ref);
        sum.unconfirmed++;
        note(new Error(`${ref}: delivery unconfirmed (${msg}) — claim kept, not re-sent`));
        try { await stamp(row.id, { post_error: `unconfirmed: ${msg}`.slice(0, 200) }); } catch { /* observability only */ }
        return "unconfirmed";
      }
      sum.announced++;
      try { await withRetries(() => stamp(row.id, { posted_at: new Date().toISOString(), post_error: null })); }
      catch (e) {
        /* delivered, unstamped: the claim is the record now. Never release it here — the message
           is in the room, and a released claim is a second copy of it on the next catch-up. */
        unstamped.set(ref, row.id);
        sum.stampFailed++;
        note(new Error(`${ref}: delivered but posted_at would not write after 3 tries (${String(e.message || e).slice(0, 120)}) — claim kept`));
        console.error(`club-notice ${row.id}: delivered to ${t.discord_channel_id} but unstamped — claim kept; the stamp is retried on the next catch-up`);
        return "announced-unstamped";
      }
      return "announced";
    } catch (e) { sum.failed++; note(e); return "error"; }
  }

  /* anything still unposted after a couple of minutes: a realtime event that never arrived, a
     Discord blip, a restart mid-post */
  async function catchUp(minAgeMs = opts.catchUpAgeMs ?? 2 * 60 * 1000) {
    const before = new Date(Date.now() - minAgeMs).toISOString();
    let rows = [];
    try { rows = await sbGet(`club_notices?posted_at=is.null&created_at=lt.${encodeURIComponent(before)}&order=created_at.asc&limit=100`); }
    catch (e) { note(e); return 0; }
    let n = 0;
    for (const row of rows) { if (String(await announce(row)).startsWith("announced")) n++; }
    return n;
  }

  return { announce, catchUp, sum, errors };
}
