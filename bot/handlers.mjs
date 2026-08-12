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
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID.

const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

export function createHandlers(env, opts = {}) {
  const { SB_URL, SB_KEY, BOT, GUILD } = env;
  const CHAN_TTL_MS = opts.chanTtlMs ?? 10 * 60 * 1000;
  // Mirrors BURST_CAP / DEPART_SANITY in the sweeps: a flood of gateway events is recorded
  // silently instead of mass-pinging a channel (raid) or spamming the commissioners (outage).
  const BURST_CAP = opts.burstCap ?? 15;
  const BURST_WINDOW_MS = opts.burstWindowMs ?? 10 * 60 * 1000;
  const gatewayState = opts.gatewayState;

  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });

  // Same transient-failure posture as the sweeps: retry the fetch itself on network blips,
  // respect Retry-After on 429, back off on Discord 5xx.
  async function rfetch(url, o, tries = 3) {
    let err;
    for (let i = 0; i < tries; i++) {
      try { return await fetch(url, o); }
      catch (e) { err = e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
    }
    throw err;
  }
  async function sbGet(path) {
    const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
    return r.json();
  }
  async function sbPost(path, body, prefer) {
    const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { method: "POST",
      headers: { ...sbHead(), Prefer: prefer || "return=minimal" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  async function sbPatch(path, body) {
    const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH",
      headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
  }
  async function dApi(method, path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await rfetch(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (r.status === 404) return { __notfound: true };   // callers MUST check — see dPost
      if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
      if (r.status >= 500) { await new Promise((res) => setTimeout(res, 600 * (attempt + 1))); continue; }
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
          display_name: m.nick || m.globalName || null, is_bot: false,
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
      await markWelcomed(m.id);
      sum.welcomed++;
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
      const displayName = (known && known.display_name) || m.nick || m.globalName || null;

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

      const who = displayName || username || (link && link.gamertag) || id;
      const fields = [];
      if (link && link.gamertag) fields.push({ name: "Site account", value: String(link.gamertag), inline: true });
      if (club) fields.push({ name: "Club", value: String(club), inline: true });
      if (days != null) fields.push({ name: "In the server", value: days === 0 ? "less than a day" : days + " day" + (days === 1 ? "" : "s"), inline: true });
      if (wasRegistered) fields.push({ name: "Season sign-up", value: "was registered to play", inline: true });
      try {
        await dPost(`/channels/${chId}/messages`, { embeds: [{
          title: "👋 " + who + " left the server",
          description: (link ? "" : "No linked site account — they never signed in at chelgamingleague.com.\n") +
            "`" + id + "`",
          color: 0xC2410C, fields: fields.length ? fields : undefined,
          timestamp: new Date().toISOString() }], allowed_mentions: { parse: [] } });
        sum.departAnnounced++;
        return "announced";
      } catch (e) { recordError(`depart-post ${id}`, e); sum.departUnannounced++; return "recorded-postfail"; }
    } catch (e) { recordError(`depart ${m && m.id}`, e); return "error"; }
  }

  /* ============ heartbeat + per-run result, in the shapes the watchdog already reads ============ */

  /* A heartbeat that only proves "the timer fired" is worse than none: it makes a deaf bot look
     healthy on the Automations panel and satisfies the watchdog's staleness check. So the row
     reports the GATEWAY's state, and a disconnected bot writes ok:false — which the watchdog's
     failing-run branch pages on, without waiting out the 10-minute staleness window. */
  async function beat(opts = {}) {
    const nowIso = new Date().toISOString();
    const gw = typeof gatewayState === "function" ? gatewayState() : { connected: true, detail: "not instrumented" };
    const recent = errors.filter((e) => Date.now() - e.at < 60 * 60 * 1000);
    const fatal = opts.fatal || null;
    const healthy = recent.length === 0 && gw.connected !== false && !fatal;
    await cfgSet("rl_gateway-bot", nowIso);
    await cfgSet("rl_gateway-bot_result", JSON.stringify({
      at: nowIso, ok: healthy, connected: gw.connected !== false,
      welcomed: sum.welcomed, welcomedSilent: sum.welcomedSilent,
      departures: sum.departures, departAnnounced: sum.departAnnounced,
      departUnannounced: sum.departUnannounced,
      uptimeMin: Math.round((Date.now() - startedAt) / 60000),
      ...(opts.extra || {}),          // e.g. the incident lane's own liveness
      errCount: errors.length,
      lastError: fatal || (gw.connected === false ? `not connected to Discord (${gw.detail})` : null)
        || (errors.length ? errors[errors.length - 1].error : null)
    }));
  }

  return { onMemberAdd, onMemberUpdate, onMemberRemove, beat, sum, errors,
    _test: { resetChannels: () => { chan = { at: 0, byName: {} }; }, bursts } };
}
