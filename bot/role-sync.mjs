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
// Every call carries a deadline (handlers.mjs timedFetch) and every job carries its own: one
// member whose socket stops answering used to stall every instant role change behind it in the
// serial worker (audit 2026-09-17, P2-12). A failed or abandoned sync re-queues on a bounded
// backoff ladder, then belongs to the sweep.
//
// Dependency-free of discord.js so tools/role-sync.test.mjs can drive it with a stubbed fetch.

import { desiredRolesFor, applyManagedRoles, managedRoleIds } from "../shared/roles.mjs";
import { timedFetch, SB_TIMEOUT_MS, DISCORD_TIMEOUT_MS } from "./handlers.mjs";

export function createRoleSyncer(env, opts = {}) {
  const { SB_URL, SB_KEY, BOT, GUILD } = env;
  const UA = "DiscordBot (https://chelgamingleague.com,1.0)";
  const DEBOUNCE_MS = opts.debounceMs != null ? opts.debounceMs : 1500;
  const SB_MS = opts.sbTimeoutMs ?? SB_TIMEOUT_MS;
  const D_MS = opts.discordTimeoutMs ?? DISCORD_TIMEOUT_MS;
  /* A member's sync is a dozen sequential calls; each has its own deadline, and the JOB has one
     too, so a member that keeps answering slowly cannot hold the queue any longer than this. */
  const JOB_TIMEOUT_MS = opts.jobTimeoutMs ?? 90_000;
  /* A failed sync is tried again on a growing delay, a bounded number of times — after the last
     one the member is the sweep's, which reconciles everyone within 2 minutes anyway. Bounded so
     a member the bot can never edit (the server owner, anyone ranked above it) does not circle
     the queue forever. */
  const RETRY_DELAYS_MS = opts.retryDelaysMs ?? [5_000, 30_000, 120_000];
  /* errors / lastErrorAt / lastError feed the gateway heartbeat (handlers.mjs beat): a failed
     role PATCH is a failing run, the same grade the sweep gives itself */
  const sum = { synced: 0, patched: 0, noop: 0, skipped: 0, timedOut: 0, retried: 0, dropped: 0, errors: 0, lastErrorAt: null, lastError: null };
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
  /* Same transport discipline the sweeps already use (discord-sync.js). Without it a 429 was
     recorded as a permanent failure and the member's roles simply never applied — and this is the
     path that runs on every seat change, for 200+ members. Every call here is a GET or a PATCH of
     the full role list — idempotent — so a 5xx is safe to retry; a timeout is thrown as the
     failure it is and the job-level retry below decides whether to try the member again. */
  async function dApi(method, path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await timedFetch(`https://discord.com/api/v10${path}`, {
        method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, D_MS);
      if (r.status === 404) return { __notfound: true };
      if (r.status === 429) {
        const ra = +(r.headers.get("retry-after") || 1);
        await new Promise((res) => setTimeout(res, ra * 1000 + 250));
        continue;
      }
      if (r.status >= 500) { await new Promise((res) => setTimeout(res, 600 * (attempt + 1))); continue; }
      const t = await r.text();
      if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 120)}`);
      return t ? JSON.parse(t) : null;
    }
    throw new Error(`${method} ${path} -> rate-limited after retries`);
  }

  /* Guild roles and the season rows change rarely; cache them briefly. teams is deliberately NOT
     cached: the club seats and club-role ids live there, and a seat appointment is one of the
     events this path exists to make instant — computing it from a 60-second-old snapshot made the
     "instant" sync a no-op exactly when it mattered (review finding, 2026-08-05). */
  let slow = null, slowAt = 0;
  async function slowCtx() {
    if (slow && Date.now() - slowAt < 60_000) return slow;
    const [guildRoles, seasons, rfaCfg] = await Promise.all([
      dApi("GET", `/guilds/${GUILD}/roles`),
      sbGet("seasons?select=id,number,status,registration_open,format&status=neq.complete&order=number.asc"),
      sbGet("app_config?key=eq.rfa_offseasons&select=value"),
    ]);
    if (!Array.isArray(guildRoles)) throw new Error("guild roles unavailable");
    const roleId = {};
    for (const r of guildRoles) roleId[String(r.name || "").toLowerCase()] = r.id;
    /* same season selection as the sweep (v2.36): the registration_open season drives Player/FA/
       Not Signed Up and sign-up positions; the season IN PLAY — active, else the lowest-numbered
       open season, never the newest, which a next season created ahead of time would be — drives
       roster positions and the rights classes */
    const curSeason = (seasons || []).find((s) => s.status === "active") || (seasons || [])[0] || null;
    const regSeason = (seasons || []).filter((s) => s.registration_open).sort((a, b) => (b.number || 0) - (a.number || 0))[0] || curSeason;
    const posSeason = curSeason;
    const rfaYears = Math.max(1, parseInt((rfaCfg && rfaCfg[0] && rfaCfg[0].value) || "4", 10) || 4);
    /* v2.48: rights classes exist only in the full season format (Rule 2.2) */
    const rightsOn = !!curSeason && curSeason.format === "full";
    slow = { roleId, regSeason, posSeason, regOpen: !!(regSeason && regSeason.registration_open), rfaYears, rightsOn };
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
        const reg = await sbGet(`season_registrations?season_id=eq.${C.regSeason.id}&profile_id=eq.${encodeURIComponent(profileId)}&select=profile_id,position`);
        isRegistered = !!(reg && reg[0]);
        for (const r of reg || []) if (r.position) pos = r.position;    // sign-up position, from the season taking sign-ups
      }
      let inCamp = false;
      if (C.posSeason) {
        const spots = await sbGet(`roster_spots?season_id=eq.${C.posSeason.id}&profile_id=eq.${encodeURIComponent(profileId)}&select=position,squad,status`);
        for (const s of spots || []) {
          if (s.position) pos = s.position;   // roster spot (season in play) wins over signup
          if (s.squad === "tc" && (s.status || "active") === "active") inCamp = true;   // v2.72: Training Camp role
        }
      }

      /* club seat — held on the team row, not the profile; same overwrite order as the sweep's
         mgmtRoleByProfile loop (owner then gm then agm within a team, later teams overwrite) */
      let seat = null;
      for (const t of teams || []) {
        if (t.owner_profile_id === profileId) seat = "owner";
        if (t.gm_profile_id === profileId) seat = "gm";
        if (t.agm_profile_id === profileId) seat = "agm";
      }

      /* Rights classes (Rule 2.2) — same rule the sweep applies, computed for this one profile:
         rookie = never on a prior-season roster and no earlier draft pick; RFA = has prior service
         but under the threshold, and not currently rostered or under contract. Omitting these made
         the bot strip Rookie/RFA every sync while the sweep re-granted them. */
      let isRookie = false, isRfa = false;
      const curId = C.posSeason && C.posSeason.id, curNum = (C.posSeason && C.posSeason.number) || 1;
      if (curId) {
        const allSpots = await sbGet(`roster_spots?profile_id=eq.${encodeURIComponent(profileId)}&select=season_id`);
        const priorSeasons = new Set((allSpots || []).filter((r) => r.season_id && r.season_id !== curId).map((r) => r.season_id));
        const onRosterNow = (allSpots || []).some((r) => r.season_id === curId);
        const dp = await sbGet(`draft_picks?player_id=eq.${encodeURIComponent(profileId)}&select=season_number`);
        const draftedBefore = (dp || []).some((d) => (d.season_number || 0) < curNum);
        const cts = await sbGet(`contracts?profile_id=eq.${encodeURIComponent(profileId)}&status=in.(active,signed)&select=is_manager,start_season,end_season`);
        const underContract = (cts || []).some((c) => !c.is_manager && (c.start_season || 1) <= curNum && (c.end_season || 1) >= curNum);
        isRookie = priorSeasons.size === 0 && !draftedBefore;
        isRfa = C.rightsOn && priorSeasons.size > 0 && priorSeasons.size < C.rfaYears && !onRosterNow && !underContract;
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
        rfa: isRfa ? new Set([profileId]) : new Set(),
        rookies: isRookie ? new Set([profileId]) : new Set(),
        camp: inCamp ? new Set([profileId]) : new Set(),
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
  /* One worker, not one timer per member. The debounce still coalesces repeat events for the same
     profile, but the actual syncs now DRAIN serially: catchUp can hand this 500 rows at once, and
     the old per-profile setTimeout fired them all simultaneously — a self-inflicted rate limit
     against the very API that has no retry budget to spare. */
  const pending = new Map();   // profileId -> { timer, reason }
  const queue = [];            // jobs waiting for the worker
  const queued = new Map();    // profileId -> the job already in the queue
  let draining = false;
  /* the job's own clock: resolves "timeout" when the sync outlives it. The sync keeps running
     in the background until its own per-call deadlines end it — every write it could still make
     is idempotent, so an abandoned one that finishes late just converges the member early. */
  function withDeadline(p, ms) {
    let t;
    const clock = new Promise((res) => { t = setTimeout(() => res("timeout"), ms); if (t.unref) t.unref(); });
    return Promise.race([p, clock]).finally(() => clearTimeout(t));
  }
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        queued.delete(job.profileId);
        let r;
        try { r = await withDeadline(syncProfile(job.profileId, job.reason), JOB_TIMEOUT_MS); }
        catch (e) { r = "error"; note(new Error(`${job.profileId} (${job.reason || "?"}): ${String((e && e.message) || e)}`)); }
        if (r === "timeout") { sum.timedOut++; note(new Error(`${job.profileId} (${job.reason || "?"}): sync abandoned after ${JOB_TIMEOUT_MS} ms — the queue moves on`)); }
        /* One hung or failed member must not stall the members behind it: the queue continues
           NOW, and this one comes back on the retry ladder. onDone is a delivery contract, so it
           fires only when the job is truly finished — delivered, or given up on. */
        if (r === "error" || r === "timeout") {
          const attempt = job.attempt || 0;
          if (attempt < RETRY_DELAYS_MS.length) {
            sum.retried++;
            /* ref'd on purpose, like the transport deadline: a scheduled retry is owed work,
               bounded by the ladder, and every shutdown path exits explicitly */
            setTimeout(() => push({ ...job, attempt: attempt + 1 }), RETRY_DELAYS_MS[attempt]);
            console.warn(`role-sync ${job.profileId} (${job.reason}): ${r} — retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${RETRY_DELAYS_MS[attempt]} ms`);
            continue;
          }
          sum.dropped++;
          note(new Error(`${job.profileId} (${job.reason || "?"}): gave up after ${attempt} retries — the sweep reconciles this member within 2 minutes`));
          if (job.onDone) job.onDone(r);
          console.warn(`role-sync ${job.profileId} (${job.reason}): ${r} — dropped after ${attempt} retries`);
          continue;
        }
        if (job.onDone) job.onDone(r);
        if (r !== "no-op" && r !== "unlinked") console.log(`role-sync ${job.profileId} (${job.reason}): ${r}`);
      }
    } finally { draining = false; }
  }
  /* Already waiting its turn: MERGE into that job rather than dropping this one — the caller's
     onDone is a delivery contract, and silently discarding it left callers waiting on a callback
     that would never fire. A retry landing on a fresh job for the same member folds into it the
     same way: one sync serves both. */
  function push(job) {
    const existing = queued.get(job.profileId);
    if (existing) {
      existing.reason = job.reason;
      if (job.onDone) {
        const prev = existing.onDone;
        existing.onDone = prev ? function(r){ prev(r); job.onDone(r); } : job.onDone;
      }
      return;
    }
    queued.set(job.profileId, job);
    queue.push(job);
    drain();
  }
  function enqueue(profileId, reason, onDone) {
    if (!profileId) return;
    const prev = pending.get(profileId);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      pending.delete(profileId);
      push({ profileId, reason, onDone });
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
      await timedFetch(`${SB_URL}/rest/v1/role_sync_queue?created_at=lt.${encodeURIComponent(cutoff)}`,
        { method: "DELETE", headers: { ...sbHead(), Prefer: "return=minimal" } }, SB_MS);
      return { replayed: seen.size };
    } catch (e) { note(e); return { replayed: 0, error: true }; }
  }

  return { enqueue, syncProfile, catchUp, sum, errors, _slowCtx: slowCtx };
}
