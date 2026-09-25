// Chel Gaming gateway bot — the event handlers, kept free of discord.js so
// tools/gateway-bot.test.mjs can exercise them with a stubbed fetch.
//
// The bot is the INSTANT lane, not the source of truth. Every write it makes uses the
// same ledgers the Netlify sweeps already reconcile against:
//   - welcomes:    welcomed_members (discord_id PK) — post first, record after, so a failed
//                  post is retried by the 5-minute discord-welcome sweep instead of lost.
//   - departures:  guild_members.present + guild_departures — the bot marks present=false
//                  the moment someone leaves, which is exactly what stops the 2-minute
//                  discord-sync census diff from reporting the same departure again.
// If this process dies, nothing is lost: the sweeps simply take over at their own pace.
//
// This file also exports the bot's transport (timedFetch + the two deadlines, withRetries) —
// the one definition every instant lane in bot/ imports, so "every call has a deadline" and
// "a POST /messages is never re-sent on an unknown outcome" are decided once.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID.
//
// v3.22 — a member's name in CGHL is his DISCORD name, never a per-server nickname. This file used
// to rank `m.nick` first, so a nickname became the name the whole league saw. TWIN: the same
// function lives in netlify/functions/discord-sync.js; change one, change the other.

import { buildDepartureEmbed } from "../shared/departure-card.mjs";

function discordName(m) {
  return String((m && (m.globalName || m.username)) || "").trim() || null;
}

const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

/* ================= the bot's transport: every call has a deadline =================
   One definition for all four instant lanes (role-sync, club-notices, incidents, staff-alerts
   import these), kept here rather than in a module of its own because this file already owns the
   bot's failure posture. Before this, no Discord or Supabase call in the bot carried a timeout: a
   socket that stopped answering mid-response hung its lane forever — and role-sync's serial
   worker meant one hung member stalled every instant role change behind it (audit 2026-09-17,
   P2-12). The deadlines are the audit's: 15 s for Discord, 10 s for Supabase. */
export const DISCORD_TIMEOUT_MS = 15_000;
export const SB_TIMEOUT_MS = 10_000;

/* fetch with a hard deadline that covers the WHOLE exchange — headers and body — and rejects even
   if the underlying fetch ignores its signal (a stubbed fetch in a test, say). The body is read
   inside the window and re-wrapped, so callers keep the familiar Response surface (ok, status,
   headers.get, text(), json()) and nothing downstream can hang on a stalled body stream. Timeouts
   are tagged `timeout` and `ambiguous`: the request may or may not have been processed. fetch is
   resolved from the global at call time so tests can stub it after import. */
export async function timedFetch(url, o = {}, ms) {
  const ctl = new AbortController();
  /* deliberately NOT unref'd: an in-flight request is real work, and a process whose only
     pending work is a request that has stopped answering must live long enough to time it out
     and log it, not exit with the outcome unknown. Bounded by ms, and every shutdown path in
     bot/ exits explicitly, so it can never hold a stop hostage. */
  const timer = setTimeout(() => ctl.abort(), ms);
  const timedOut = () => {
    const e = new Error(`${o.method || "GET"} ${String(url).split("?")[0]} timed out after ${ms} ms`);
    e.timeout = true; e.ambiguous = true;
    return e;
  };
  try {
    const { res, text } = await new Promise((resolve, reject) => {
      ctl.signal.addEventListener("abort", () => reject(timedOut()), { once: true });
      Promise.resolve()
        .then(() => globalThis.fetch(url, { ...o, signal: ctl.signal }))
        .then((r) => r.text().then((t) => ({ res: r, text: t })))
        .then(resolve, reject);
    });
    /* a null-body status refuses a body — and an empty text is the same thing to every caller */
    const nullBody = text === "" || res.status === 204 || res.status === 205 || res.status === 304;
    return new Response(nullBody ? null : text, { status: res.status, statusText: res.statusText, headers: res.headers });
  } catch (e) {
    if (e && (e.name === "AbortError" || e.name === "TimeoutError")) throw timedOut();
    throw e;
  } finally { clearTimeout(timer); }
}

/* Bookkeeping that follows a delivered message (welcomed_members, club_notices.posted_at) is the
   write that must not be lost to a blip: Discord has already accepted the message, so a lost
   stamp means the sweep sends it again. Three attempts with a short backoff, then the caller
   decides what "still failing" means for its ledger. */
export async function withRetries(fn, tries = 3, baseDelayMs = 500) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { err = e; if (i + 1 < tries) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1))); }
  }
  throw err;
}

export function createHandlers(env, opts = {}) {
  const { SB_URL, SB_KEY, BOT, GUILD } = env;
  const CHAN_TTL_MS = opts.chanTtlMs ?? 10 * 60 * 1000;
  // Mirrors BURST_CAP / DEPART_SANITY in the sweeps: a flood of gateway events is recorded
  // silently instead of mass-pinging a channel (raid) or spamming the commissioners (outage).
  const BURST_CAP = opts.burstCap ?? 15;
  const BURST_WINDOW_MS = opts.burstWindowMs ?? 10 * 60 * 1000;
  const gatewayState = opts.gatewayState;
  const SB_MS = opts.sbTimeoutMs ?? SB_TIMEOUT_MS;
  const D_MS = opts.discordTimeoutMs ?? DISCORD_TIMEOUT_MS;

  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });

  /* Same transient-failure posture as the sweeps — retry the fetch itself on a network blip —
     with two limits the sweeps lack. A TIMEOUT is not a blip: it is ten seconds of nothing, and
     stacking three of them stalls the lane for half a minute, so it is thrown as the failure it
     is. And only an IDEMPOTENT request is retried at all: a POST whose socket died after the
     bytes went out may have landed, and sending it again is how a departure gets logged twice. */
  async function rfetch(url, o, ms, tries = 3) {
    const idempotent = (o.method || "GET") !== "POST";
    let err;
    for (let i = 0; i < tries; i++) {
      try { return await timedFetch(url, o, ms); }
      catch (e) {
        err = e;
        if (e.timeout || !idempotent) { if (!idempotent) e.ambiguous = true; throw e; }
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    throw err;
  }
  async function sbGet(path) {
    const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() }, SB_MS);
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
    return r.json();
  }
  async function sbPost(path, body, prefer) {
    const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { method: "POST",
      headers: { ...sbHead(), Prefer: prefer || "return=minimal" }, body: JSON.stringify(body) }, SB_MS);
    if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  async function sbPatch(path, body) {
    const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH",
      headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify(body) }, SB_MS);
    if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
  }
  /* Retry-After on a 429 is always honored — a 429 is a definitive rejection, the request was
     not processed. A 5xx is only retried when the request is idempotent (GET, PATCH): for a
     POST /messages a 502 from the edge says nothing about whether Discord stored the message,
     and re-sending is exactly the double post the claim ledgers exist to prevent. So a
     non-idempotent 5xx, like a timeout, is thrown tagged `ambiguous` and the caller keeps its
     claim (audit 2026-09-17, P2-12). */
  async function dApi(method, path, body) {
    const idempotent = method !== "POST";
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await rfetch(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      }, D_MS);
      if (r.status === 404) return { __notfound: true };   // callers MUST check — see dPost
      if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
      if (r.status >= 500) {
        if (!idempotent) { const e = new Error(`${method} ${path} -> ${r.status} (delivery unknown)`); e.ambiguous = true; throw e; }
        await new Promise((res) => setTimeout(res, 600 * (attempt + 1))); continue;
      }
      if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
      const t = await r.text();
      return t ? JSON.parse(t) : null;
    }
    throw new Error(`${method} ${path} -> rate-limited after retries`);
  }
  /* Posting a message is the one call whose success we RECORD, so it is the one call that must
     never report success it didn't achieve. dApi turns a 404 (channel deleted mid-flight) into
     {__notfound:true} rather than throwing, and Discord answers a successful post with the
     message object — so anything without an id means the member was not actually told, and the
     exactly-once claim must not be burned. Same trap as the pickup lobby's warned-flag. */
  async function dPost(path, body) {
    const res = await dApi("POST", path, body);
    if (!res || res.__notfound || !res.id) {
      throw new Error(`post to ${path} did not deliver (${res && res.__notfound ? "channel is gone" : "no message id"})`);
    }
    return res;
  }
  async function cfgGet(key) {
    try {
      const rows = await sbGet(`app_config?key=eq.${key}&select=value`);
      return rows && rows[0] ? rows[0].value : null;
    } catch { return null; }
  }
  async function cfgSet(key, value) {
    await sbPost("app_config", { key, value, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=minimal");
  }

  /* ---- run counters, surfaced in rl_gateway-bot_result ---- */
  const startedAt = Date.now();
  const sum = { welcomed: 0, welcomedSilent: 0, departures: 0, departAnnounced: 0, departUnannounced: 0, skipped: 0 };
  const errors = [];   // [{at, error}] — pruned to the last 20
  const recordError = (label, e) => {
    errors.push({ at: Date.now(), error: `${label}: ${String((e && e.message) || e).slice(0, 180)}` });
    if (errors.length > 20) errors.shift();
    console.error("gateway-bot error —", errors[errors.length - 1].error);
  };

  /* ---- text-channel cache (name -> id), refreshed on a TTL ---- */
  let chan = { at: 0, byName: {} };
  async function textChannels() {
    if (Date.now() - chan.at < CHAN_TTL_MS) return chan.byName;
    const list = await dApi("GET", `/guilds/${GUILD}/channels`);
    const byName = {};
    for (const c of Array.isArray(list) ? list : []) if (c.type === 0) byName[c.name] = c.id;
    chan = { at: Date.now(), byName };
    return byName;
  }

  /* ---- burst limiter: timestamps of recent events per kind ---- */
  const bursts = { welcome: [], depart: [] };
  function burstExceeded(kind) {
    const now = Date.now();
    bursts[kind] = bursts[kind].filter((t) => now - t < BURST_WINDOW_MS);
    bursts[kind].push(now);
    return bursts[kind].length > BURST_CAP;
  }

  /* ================= welcome — the instant twin of discord-welcome.js ================= */

  // KEEP IN SYNC with welcomeText in netlify/functions/discord-welcome.js — same greeting
  // whichever lane gets to the member first.
  const chanRef = (id, fallback) => (id ? `<#${id}>` : fallback);
  function welcomeText(userId, ch) {
    return `🏒 Welcome to **Chel Gaming**, <@${userId}>! Glad to have you on the ice.\n\n` +
      `• New here? Skim ${chanRef(ch.rules, "**#rules**")} to get the lay of the land.\n` +
      `• Ready to play? Register at https://chelgamingleague.com/#/register — sign-ups happen on the site.\n` +
      `• Say hey in ${chanRef(ch.general, "**#general-chat**")} — tell us your team and platform.\n\n` +
      `The full league hub lives at https://chelgamingleague.com — lace 'em up. 🥅`;
  }
  async function markWelcomed(discordId) {
    await sbPost("welcomed_members?on_conflict=discord_id", [{ discord_id: discordId }],
      "resolution=merge-duplicates,return=minimal");
  }

  // m: { id, bot, pending, username, globalName, nick, joinedAt }
  async function onMemberAdd(m) {
    try {
      if (!m || !m.id || m.bot) { sum.skipped++; return "skip"; }
      /* Presence first, before any greeting gate: the census sweep is minutes away, and the
         site's departure rule (remove_departed_signups) reads guild_members — a rejoin has to
         flip present=true instantly so nobody's sign-up is withdrawn while they are standing in
         the server. Linked to the profile when we know it, since the rule judges presence
         across a profile's accounts. Best-effort: a failure here must never block the welcome. */
      try {
        const links = await sbGet(`discord_links?discord_id=eq.${encodeURIComponent(m.id)}&select=profile_id`);
        const row = { discord_id: String(m.id), username: m.username || m.globalName || null,
          display_name: discordName(m), is_bot: false,
          joined_guild_at: m.joinedAt || new Date().toISOString(),
          last_seen: new Date().toISOString(), present: true };
        if (links[0] && links[0].profile_id) row.profile_id = links[0].profile_id;
        await sbPost("guild_members?on_conflict=discord_id", [row], "resolution=merge-duplicates,return=minimal");
        sum.presenceMarked = (sum.presenceMarked || 0) + 1;
      } catch (e) { recordError(`presence ${m.id}`, e); }
      // Community membership screening: greet only once they're through the gate.
      // The pending->false transition arrives as a member update (see onMemberUpdate).
      if (m.pending) { sum.skipped++; return "pending"; }
      // Before the sweep's first-run seeding, staying silent matches its behavior exactly —
      // the seed pass will record this member without a greeting.
      if (!(await cfgGet("welcome_seeded"))) { sum.skipped++; return "unseeded"; }
      const already = await sbGet(`welcomed_members?discord_id=eq.${encodeURIComponent(m.id)}&select=discord_id`);
      if (already.length) { sum.skipped++; return "already"; }
      if (burstExceeded("welcome")) {
        await markWelcomed(m.id);
        sum.welcomedSilent++;
        return "burst";
      }
      const byName = await textChannels();
      const welcomeChan = (await cfgGet("discord_welcome_channel_id")) || byName["welcome"];
      if (!welcomeChan) { sum.skipped++; return "no-channel"; }   // sweep will greet within 5 min
      // Post first, record after — a failed post stays unrecorded so the sweep retries it.
      await dPost(`/channels/${welcomeChan}/messages`, {
        content: welcomeText(m.id, { rules: byName["rules"], general: byName["general-chat"] }),
        allowed_mentions: { users: [m.id] },
      });
      sum.welcomed++;
      /* Discord has the greeting now; the record is what stops the sweep sending a second one.
         There is no claim to hold here (welcomed_members IS the claim), so a record that will
         not write after three tries is reported loudly and the duplicate is the sweep's — better
         a member greeted twice than a lane that pretends it recorded something it did not. */
      try { await withRetries(() => markWelcomed(m.id)); }
      catch (e) { recordError(`welcome-record ${m.id} (greeted, unrecorded — the sweep may greet again)`, e); return "welcomed-unrecorded"; }
      return "welcomed";
    } catch (e) { recordError(`welcome ${m && m.id}`, e); return "error"; }
  }

  async function onMemberUpdate(before, after) {
    if (before && before.pending && after && !after.pending) return onMemberAdd(after);
    return "ignored";
  }

  /* ============ departures — the instant twin of trackDepartures in discord-sync.js ============ */

  // m: { id, bot, username, globalName, nick, joinedAt }
  async function onMemberRemove(m) {
    try {
      if (!m || !m.id) { sum.skipped++; return "skip"; }
      const id = String(m.id);
      const rows = await sbGet(`guild_members?discord_id=eq.${encodeURIComponent(id)}&select=discord_id,username,display_name,profile_id,joined_guild_at,is_bot,present`);
      const known = rows[0] || null;
      // present=false means a lane (this one or the census) already handled this departure.
      if (known && known.present === false) { sum.skipped++; return "already-recorded"; }

      const links = await sbGet(`discord_links?discord_id=eq.${encodeURIComponent(id)}&select=profile_id,gamertag,team_id`);
      const link = links[0] || null;
      const pid = (known && known.profile_id) || (link && link.profile_id) || null;
      let club = null;
      if (link && link.team_id) {
        try { const t = await sbGet(`teams?id=eq.${link.team_id}&select=code`); club = (t[0] && t[0].code) || null; }
        catch { /* the log is still worth writing without it */ }
      }
      let wasRegistered = false;
      if (pid) {
        try { wasRegistered = (await sbGet(`season_registrations?profile_id=eq.${pid}&select=profile_id&limit=1`)).length > 0; }
        catch { /* same */ }
      }

      const now = new Date().toISOString();
      const joinedAt = (known && known.joined_guild_at) || m.joinedAt || null;
      const days = joinedAt ? Math.max(0, Math.round((Date.now() - Date.parse(joinedAt)) / 86400000)) : null;
      const username = (known && known.username) || m.username || m.globalName || null;
      const displayName = (known && known.display_name) || discordName(m);

      // Record first (the part that must survive), announce after — same order as the sweep.
      await sbPost("guild_departures", [{
        discord_id: id, username, display_name: displayName,
        profile_id: pid, joined_guild_at: joinedAt, left_at: now, days_in_server: days,
        was_registered: wasRegistered, club, had_roles: null
      }]);
      await sbPost("guild_members?on_conflict=discord_id", [{
        discord_id: id, username, display_name: displayName, profile_id: pid,
        is_bot: !!((known && known.is_bot) || m.bot), joined_guild_at: joinedAt,
        last_seen: now, present: false
      }], "resolution=merge-duplicates,return=minimal");
      sum.departures++;

      if (burstExceeded("depart")) {
        recordError("depart-sanity", `${bursts.depart.length} departures inside ${Math.round(BURST_WINDOW_MS / 60000)} min — recorded, not announced`);
        sum.departUnannounced++;
        return "recorded-burst";
      }
      const byName = await textChannels();
      const chId = byName["member-departures"];
      if (!chId) { sum.departUnannounced++; return "recorded-unannounced"; }

      const who = displayName || username || (link && link.gamertag) || "A member";
      // the member's place in the league, described by the database — the same card the sweep
      // reads, so the two lanes never disagree; a failed lookup falls back to what we already know
      let card = null;
      try { card = await sbPost("rpc/member_league_card", { p_discord_id: id }, "return=representation"); }
      catch (e) { recordError(`depart-card ${id}`, e); }
      if (!card) card = { linked: !!link, gamertag: link && link.gamertag, kind: link ? "member" : "none", registered: wasRegistered };
      try {
        await dPost(`/channels/${chId}/messages`, { embeds: [buildDepartureEmbed({ who, card, days })], allowed_mentions: { parse: [] } });
        sum.departAnnounced++;
        return "announced";
      } catch (e) { recordError(`depart-post ${id}`, e); sum.departUnannounced++; return "recorded-postfail"; }
    } catch (e) { recordError(`depart ${m && m.id}`, e); return "error"; }
  }

  /* ============ heartbeat + per-run result, in the shapes the watchdog already reads ============ */

  /* A heartbeat that only proves "the timer fired" is worse than none: it makes a deaf bot look
     healthy on the Automations panel and satisfies the watchdog's staleness check. So the row
     reports the GATEWAY's state, and a disconnected bot writes ok:false — which the watchdog's
     failing-run branch pages on, without waiting out the 10-minute staleness window.

     opts.lanes — [{ key, sum }] for the instant lanes chel-bot.mjs wires up. Each lane's note()
     keeps sum.errors / sum.lastErrorAt / sum.lastError, and a lane error inside the last hour
     flips ok:false exactly as one of this file's own does: a role PATCH or a club-room post that
     failed used to be visible only in the journal, while the row the watchdog reads stayed green
     (audit 2026-09-17). The sweep grades itself the same way — any failed member PATCH is a
     failing run — so the two lanes' rows now mean the same thing. */
  async function beat(opts = {}) {
    const nowIso = new Date().toISOString();
    const HOUR = 60 * 60 * 1000;
    const gw = typeof gatewayState === "function" ? gatewayState() : { connected: true, detail: "not instrumented" };
    const recent = errors.filter((e) => Date.now() - e.at < HOUR);
    const lanes = (opts.lanes || []).filter((L) => L && L.sum);
    const laneErrors = lanes.reduce((n, L) => n + (L.sum.errors || 0), 0);
    const laneRecent = lanes.filter((L) => L.sum.lastErrorAt && Date.now() - L.sum.lastErrorAt < HOUR)
      .sort((a, b) => b.sum.lastErrorAt - a.sum.lastErrorAt);
    const fatal = opts.fatal || null;
    const healthy = recent.length === 0 && laneRecent.length === 0 && gw.connected !== false && !fatal;
    /* the most recent failure wins the lastError slot, whichever lane it came from */
    const ownLast = errors.length ? errors[errors.length - 1] : null;
    const laneLast = laneRecent[0] ? { at: laneRecent[0].sum.lastErrorAt, error: `${laneRecent[0].key}: ${laneRecent[0].sum.lastError}` } : null;
    const latest = ownLast && laneLast ? (ownLast.at >= laneLast.at ? ownLast : laneLast) : (ownLast || laneLast);
    await cfgSet("rl_gateway-bot", nowIso);
    await cfgSet("rl_gateway-bot_result", JSON.stringify({
      at: nowIso, ok: healthy, connected: gw.connected !== false,
      welcomed: sum.welcomed, welcomedSilent: sum.welcomedSilent,
      departures: sum.departures, departAnnounced: sum.departAnnounced,
      departUnannounced: sum.departUnannounced,
      uptimeMin: Math.round((Date.now() - startedAt) / 60000),
      ...(opts.extra || {}),          // e.g. the incident lane's own liveness
      errCount: errors.length,
      laneErrors,                     // every failed instant-lane operation since this process started
      laneErrorsRecent: laneRecent.length,   // lanes with a failure inside the last hour (what flips ok)
      lastError: fatal || (gw.connected === false ? `not connected to Discord (${gw.detail})` : null)
        || (latest ? latest.error : null)
    }));
  }

  return { onMemberAdd, onMemberUpdate, onMemberRemove, beat, sum, errors,
    _test: { resetChannels: () => { chan = { at: 0, byName: {} }; }, bursts } };
}
