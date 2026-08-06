// Instant Discord role sync — one member, the moment their database row changes.
//
// The Netlify sweep (discord-sync.js) reconciles the whole server every 2 minutes and stays on as
// the backstop; this closes the gap between "the site changed" and "Discord shows it". The bot
// listens to ONE table — role_sync_queue — which database triggers feed whenever a row that
// decides roles changes (profiles role/departments/banned, season_registrations, roster_spots,
// teams seats). Each queue row names the member; this re-syncs exactly that member within seconds
// using the SAME rules module the sweep uses (shared/roles.mjs), so the two paths can only
// disagree about when, never about what.
//
// WHY A QUEUE instead of subscribing to the four tables directly: Supabase Realtime strips DELETE
// payloads on RLS-enabled tables down to the primary key — even for the service role (the deployed
// realtime.apply_rls filters old_record to pkey columns whenever RLS is on). A withdrawal or
// roster release would arrive as {id} with no profile_id: nobody to sync. Database triggers see
// the full OLD row always, so "who does this change affect" lives in SQL next to the data, the
// queue's INSERT events always carry a profile_id, and the member tables stay out of the realtime
// publication entirely. The queue also gives replay: realtime delivers nothing to a process that
// was restarting, so catchUp() re-reads recent rows on the way up.
//
// Deliberately NOT handled here, by design rather than omission:
//   * bans/unbans — the sweep owns removal from the server; this path never bans anyone
//   * new Discord links — discord_id lives in auth.users metadata, which no trigger here watches;
//     the sweep picks a new link up within 2 minutes (a once-per-member event)
//   * season-wide flips (registration opening/closing) — that changes every member at once, which
//     is a reconciliation job, not a per-member event
//   * nickname/gamertag sync — Discord-side changes are invisible to the database; sweep territory
//
// Dependency-free of discord.js so tools/role-sync.test.mjs can drive it with a stubbed fetch.

import { desiredRolesFor, applyManagedRoles, managedRoleIds } from "../shared/roles.mjs";

export function createRoleSyncer(env, opts = {}) {
  const { SB_URL, SB_KEY, BOT, GUILD } = env;
  const UA = "DiscordBot (https://chelgamingleague.com,1.0)";
  const DEBOUNCE_MS = opts.debounceMs != null ? opts.debounceMs : 1500;
  const sum = { synced: 0, patched: 0, noop: 0, skipped: 0 };
  const errors = [];
  const note = (e) => { errors.push(String((e && e.message) || e).slice(0, 180)); if (errors.length > 20) errors.shift(); };

  const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });
  async function sbGet(path) {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
  }
  async function dApi(method, path, body) {
    const r = await fetch(`https://discord.com/api/v10${path}`, {
      method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 404) return { __notfound: true };
    const t = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 120)}`);
    return t ? JSON.parse(t) : null;
  }

  /* Guild roles and the season rows change rarely; cache them briefly. teams is deliberately NOT
     cached: the club seats and club-role ids live there, and a seat appointment is one of the
     events this path exists to make instant — computing it from a 60-second-old snapshot made the
     "instant" sync a no-op exactly when it mattered (review finding, 2026-08-05). */
  let slow = null, slowAt = 0;
  async function slowCtx() {
    if (slow && Date.now() - slowAt < 60_000) return slow;
    const [guildRoles, seasons] = await Promise.all([
      dApi("GET", `/guilds/${GUILD}/roles`),
      sbGet("seasons?select=id,registration_open&order=number.desc&limit=5"),
    ]);
    if (!Array.isArray(guildRoles)) throw new Error("guild roles unavailable");
    const roleId = {};
    for (const r of guildRoles) roleId[String(r.name || "").toLowerCase()] = r.id;
    /* same season selection as the sweep: the registration_open season drives Player/FA/Not
       Signed Up; the LATEST season drives positions */
    const regSeason = (seasons || []).find((s) => s.registration_open) || (seasons || [])[0] || null;
    const posSeason = (seasons || [])[0] || null;
    slow = { roleId, regSeason, posSeason, regOpen: !!(regSeason && regSeason.registration_open) };
    slowAt = Date.now();
    return slow;
  }

  /* Re-derive one member's desired roles from the database and converge Discord to them.
     Returns a short outcome string; "patched" is the only one that wrote anything. */
  async function syncProfile(profileId, reason) {
    try {
      sum.synced++;
      const C = await slowCtx();

      /* the link view is the same source the sweep iterates — team_id comes from its roster-spot
         subquery, so club membership is decided by one query text, not two */
      const links = await sbGet(`discord_links?profile_id=eq.${encodeURIComponent(profileId)}&select=profile_id,role,discord_id,team_id`);
      const m = links && links[0];
      if (!m || !m.discord_id) { sum.skipped++; return "unlinked"; }

      const profs = await sbGet(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,role,departments,banned`);
      const p = profs && profs[0];
      if (!p) { sum.skipped++; return "no-profile"; }
      /* banned members are the sweep's job (it removes them from the server); adjusting the roles
         of someone being banned would just race the ban */
      if (p.banned) { sum.skipped++; return "banned-skip"; }

      /* teams fetched FRESH on every sync — seats and club-role ids must reflect the very change
         that triggered us */
      const teams = await sbGet("teams?select=id,discord_role_id,owner_profile_id,gm_profile_id,agm_profile_id");
      const teamRoleId = Object.fromEntries((teams || []).filter((t) => t.discord_role_id).map((t) => [t.id, t.discord_role_id]));
      const managedIds = managedRoleIds(C.roleId, teams);

      /* PARITY MATTERS MORE THAN ELEGANCE in this whole block: any divergence from the sweep's
         construction — even on degenerate data the role-conflict rules forbid — makes the two
         processes fight over the member every 2 minutes. So: registration comes from the
         registration season, position from the LATEST season (they are the same season today but
         the sweep distinguishes them), and multi-row/multi-seat cases resolve last-write-wins in
         the sweep's exact iteration order. */
      let isRegistered = false; let pos = null;
      if (C.regSeason) {
        const reg = await sbGet(`season_registrations?season_id=eq.${C.regSeason.id}&profile_id=eq.${encodeURIComponent(profileId)}&select=profile_id`);
        isRegistered = !!(reg && reg[0]);
      }
      if (C.posSeason) {
        const regp = await sbGet(`season_registrations?season_id=eq.${C.posSeason.id}&profile_id=eq.${encodeURIComponent(profileId)}&select=position`);
        for (const r of regp || []) if (r.position) pos = r.position;
        const spots = await sbGet(`roster_spots?season_id=eq.${C.posSeason.id}&profile_id=eq.${encodeURIComponent(profileId)}&select=position`);
        for (const s of spots || []) if (s.position) pos = s.position;   // roster spot wins over signup
      }

      /* club seat — held on the team row, not the profile; same overwrite order as the sweep's
         mgmtRoleByProfile loop (owner then gm then agm within a team, later teams overwrite) */
      let seat = null;
      for (const t of teams || []) {
        if (t.owner_profile_id === profileId) seat = "owner";
        if (t.gm_profile_id === profileId) seat = "gm";
        if (t.agm_profile_id === profileId) seat = "agm";
      }

      const mem = await dApi("GET", `/guilds/${GUILD}/members/${m.discord_id}`);
      if (!mem || mem.__notfound) { sum.skipped++; return "not-in-guild"; }

      const desired = desiredRolesFor(m, {
        roleId: C.roleId, teamRoleId,
        registered: isRegistered ? new Set([profileId]) : new Set(),
        regOpen: C.regOpen,
        mgmtRoleByProfile: seat ? { [profileId]: seat } : {},
        deptByProfile: (p.role === "staff" || p.role === "commissioner") ? { [profileId]: p.departments || [] } : {},
        posOf: pos ? { [profileId]: pos } : {},
      });
      const { next, changed } = applyManagedRoles(mem.roles, desired, managedIds);
      if (!changed) { sum.noop++; return "no-op"; }
      const res = await dApi("PATCH", `/guilds/${GUILD}/members/${m.discord_id}`, { roles: next });
      if (res && res.__notfound) { sum.skipped++; return "not-in-guild"; }
      sum.patched++;
      return "patched";
    } catch (e) {
      /* the owner and anyone ranked above the bot cannot be edited — record it, the sweep counts
         the same members every 2 minutes without failing either */
      note(new Error(`${profileId} (${reason || "?"}): ${String((e && e.message) || e)}`));
      return "error";
    }
  }

  /* One roster move writes several rows in one transaction, each of which lands a queue row
     naming the same member. The debounce collapses the burst into one sync instead of racing
     several identical PATCHes. */
  const pending = new Map();   // profileId -> { timer, reason }
  function enqueue(profileId, reason, onDone) {
    if (!profileId) return;
    const prev = pending.get(profileId);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      pending.delete(profileId);
      syncProfile(profileId, reason).then((r) => {
        if (onDone) onDone(r);
        if (r !== "no-op" && r !== "unlinked") console.log(`role-sync ${profileId} (${reason}): ${r}`);
      });
    }, DEBOUNCE_MS);
    pending.set(profileId, { timer, reason });
  }

  /* Realtime delivers nothing to a process that was down. On the way up (and every few minutes),
     re-read recent queue rows and enqueue them — the debounce dedupes, syncProfile is idempotent,
     so replaying a row the live path already handled costs one no-op. Old rows are purged so the
     queue stays tiny; nothing else consumes it. */
  async function catchUp(minutes = 15) {
    try {
      const since = new Date(Date.now() - minutes * 60_000).toISOString();
      const rows = await sbGet(`role_sync_queue?created_at=gte.${encodeURIComponent(since)}&select=profile_id,reason&order=created_at.asc&limit=500`);
      const seen = new Set();
      for (const r of rows || []) {
        if (seen.has(r.profile_id)) continue;
        seen.add(r.profile_id);
        enqueue(r.profile_id, `catch-up:${r.reason}`);
      }
      const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
      await fetch(`${SB_URL}/rest/v1/role_sync_queue?created_at=lt.${encodeURIComponent(cutoff)}`,
        { method: "DELETE", headers: { ...sbHead(), Prefer: "return=minimal" } });
      return { replayed: seen.size };
    } catch (e) { note(e); return { replayed: 0, error: true }; }
  }

  return { enqueue, syncProfile, catchUp, sum, errors, _slowCtx: slowCtx };
}
