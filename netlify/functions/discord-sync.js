// Netlify Scheduled Function — keeps Discord in sync with the site every 5 min.
//  (1) Username sync: sets each profile's gamertag to the member's current Discord
//      display name (server nick > global name > username), so name changes flow in.
//  (2) Role sync: reconciles each member's MANAGED Discord roles with the DB —
//      team role (from their roster spot), Owner/GM/AGM (from the team's front-office
//      slots), Commissioner (league role), Player, Free Agent, and a position role
//      (Center/Left Wing/Right Wing/Left Defense/Right Defense/Goalie, auto-created).
//      Never touches non-managed roles (boosters, custom, etc.).
//  (3) Server resolution: once a game's 30-min pick-lock passes, compute its
//      server from the teams' private veto/preference picks (auto-fills the match card).
//
// Env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// No-ops safely if the bot token / guild id aren't set. Node 18+ (global fetch).

export const config = { schedule: "*/5 * * * *" };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const UA = "DiscordBot (https://chelgamingleague.com,1.0)";

const sbHead = () => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" });

// A transient network failure ("fetch failed" from undici — a DNS blip, connection reset, or
// timeout) throws BEFORE any HTTP response, so the 429 handling in dApi never sees it and one blip
// aborts the whole sweep (this is what kept failing lockPrivate). Retry the fetch itself a few
// times with backoff so a momentary hiccup doesn't fail the run.
async function rfetch(url, opts, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); }
    catch (e) { err = e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  throw err;
}

// This endpoint is publicly HTTP-invocable (the site pings it for instant sync). Debounce so a
// flood of anonymous POSTs can't drive endless Discord/DB work. Fail-open on any guard error.
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
async function sbGet(path) {
  const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPatch(path, body) {
  const r = await rfetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
}
async function dApi(method, path, body) {
  // Retry on 429 (respect Retry-After) so a busy run doesn't skip members and mis-flag them.
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await rfetch(`https://discord.com/api/v10${path}`, {
      method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (r.status === 404) return { __notfound: true };
    if (r.status === 429) { const ra = +(r.headers.get("retry-after") || 1); await new Promise((res) => setTimeout(res, ra * 1000 + 250)); continue; }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  throw new Error(`${method} ${path} -> rate-limited after retries`);
}

// Discord channel-name slug (lowercase, hyphens) to compare against team names
function slug(n) { return String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

async function sbUpsertCfg(key, value) {
  await rfetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key, value: String(value), updated_at: new Date().toISOString() }) });
}

// Ensure the "Team Management" category + its rooms exist, private to the front office. Idempotent:
// looks up by name, creates only what's missing, and drops a webhook on #management-moves so the DB
// trigger can post appointments/removals. VIEW(1024)+SEND(2048)+READ_HISTORY(65536)=68608.
async function ensureMgmtCategory(guildChannels, roleId, sum) {
  const owner = roleId["owner"], gm = roleId["general manager"], agm = roleId["assistant general manager"];
  const office = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  if (!owner || !gm || !agm || office.length < 2) return; // roles not provisioned yet — try next run
  const MGMT_ALLOW = "68608";
  const ow = (ids) => [{ id: GUILD, type: 0, deny: "1024", allow: "0" }, ...ids.map((id) => ({ id, type: 0, allow: MGMT_ALLOW, deny: "0" }))];
  const ownerAud = [owner, ...office];
  const mgmtAud = [owner, gm, agm, ...office];

  let cat = guildChannels.find((c) => c.type === 4 && (c.name || "").toLowerCase() === "team management");
  if (!cat) {
    cat = await dApi("POST", `/guilds/${GUILD}/channels`, { name: "Team Management", type: 4, permission_overwrites: ow(mgmtAud) });
    guildChannels.push(cat); sum.mgmtCatCreated = 1;
  }
  const catId = cat.id;
  async function ensure(name, type, allowIds, topic) {
    const found = guildChannels.find((c) => c.name === name && c.parent_id === catId);
    if (found) return found;
    const base = { name, parent_id: catId, permission_overwrites: ow(allowIds) };
    if (type === 0 || type === 15) base.topic = topic;
    try {
      const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { ...base, type });
      guildChannels.push(ch); sum.mgmtChansCreated = (sum.mgmtChansCreated || 0) + 1; return ch;
    } catch (e) {
      // a forum (type 15) needs a Community server; fall back to a text room so the space still exists
      if (type === 15) {
        try { const ch = await dApi("POST", `/guilds/${GUILD}/channels`, { ...base, type: 0 }); guildChannels.push(ch); sum.mgmtHelpFellBackToText = 1; return ch; }
        catch (e2) { sum.errors.push({ mgmtChan: name, error: String(e2.message || e2) }); return null; }
      }
      sum.errors.push({ mgmtChan: name, error: String(e.message || e) }); return null;
    }
  }
  await ensure("owners-chat", 0, ownerAud, "Club owners only (plus the league office). Talk shop with your fellow owners.");
  await ensure("management-chat", 0, mgmtAud, "Everyone in club management — owners, GMs, and AGMs. Anything goes.");
  await ensure("management-help", 15, mgmtAud, "Ask the league office anything — post a thread and staff will help.");
  const moves = await ensure("management-moves", 0, mgmtAud, "Front-office moves: new owners, GMs, and AGMs voted in, and departures. Auto-posted.");
  if (moves && moves.id) {
    try {
      const hooks = await dApi("GET", `/channels/${moves.id}/webhooks`);
      let hook = Array.isArray(hooks) ? hooks.find((h) => h.name === "CGHL Moves" && h.token) : null;
      if (!hook) hook = await dApi("POST", `/channels/${moves.id}/webhooks`, { name: "CGHL Moves" });
      if (hook && hook.id && hook.token) { await sbUpsertCfg("discord_mgmt_moves_webhook", `https://discord.com/api/webhooks/${hook.id}/${hook.token}`); sum.mgmtMovesHook = 1; }
    } catch (e) { sum.errors.push({ mgmtMovesHook: String(e.message || e) }); }
  }
}

// Staff departments — one Discord role + one private room per office lane, all under the Staff
// category. Each room is visible to its department AND the commissioners (oversight), not to all
// staff. `key` mirrors the site's CG.STAFF_DEPARTMENTS and profiles.departments, so picking a
// department on the site grants the matching Discord role, which opens that department's room.
const STAFF_DEPARTMENTS = [
  { key: "applications", role: "Review Board", channel: "review-board", topic: "Review Board — the deciding vote on owner, GM, AGM, and staff applications." },
  { key: "officiating",  role: "Officials",    channel: "officials",    topic: "Officials — game-night disputes, forfeits, and rule calls." },
  { key: "operations",   role: "Operations",   channel: "operations",   topic: "Operations — scheduling, reschedules, game codes, and no-show follow-up." },
  { key: "draft",        role: "Draft Room",   channel: "draft-room",   topic: "Draft Room — draft night and the free-agency bidding board." },
  { key: "transactions", role: "Transactions", channel: "transactions-desk", alt: ["transactions"], topic: "Transactions — trades, waivers, and cap & contract compliance." },
  { key: "community",    role: "Community",     channel: "community",    topic: "Community — Discord moderation, welcome, and onboarding." },
  { key: "statistics",   role: "Statistics",   channel: "statistics",   topic: "Statistics — EA import accuracy and the record book." },
  { key: "media",        role: "Media",         channel: "media",        topic: "Media — news, recaps, broadcast, and socials." },
];

// Ensure the department roles (mentionable) and a private room per department under the Staff
// category. Idempotent: creates only what's missing, never deletes. VIEW+SEND+READ_HISTORY=68608.
async function ensureStaffDepartments(guildChannels, roleId, roleNameById, sum) {
  const commish = roleId["commissioner"], staff = roleId["staff"];
  if (!commish || !staff) return; // office roles not provisioned yet — next run
  const ALLOW = "68608";
  // (a) a Discord role per department
  for (const d of STAFF_DEPARTMENTS) {
    if (roleId[d.role.toLowerCase()]) continue;
    try {
      const created = await dApi("POST", `/guilds/${GUILD}/roles`, { name: d.role, mentionable: true });
      if (created && created.id) { roleId[d.role.toLowerCase()] = created.id; roleNameById[created.id] = d.role; sum.rolesCreated = (sum.rolesCreated || 0) + 1; }
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

export default async (req) => {
  // Read-only diagnostics. ?diag=staff proves who can actually see the staff rooms (the sync
  // reporting "changed nothing" is ambiguous between already-correct and wrongly-judged-correct,
  // and privacy is not something to infer); ?diag=guild dumps the server's structure for audits.
  // GATED: describing a private room — even just its name and who may read it — is itself
  // information about the league office, so this requires app_config.diag_key and 404s otherwise.
  // Never returns ids, tokens, or message content.
  const diag = (() => { try { return new URL(req.url).searchParams; } catch { return new URLSearchParams(); } })();
  const diagMode = diag.get("diag");
  if (diagMode) {
    const keyRow = await sbGet("app_config?key=eq.diag_key&select=value").catch(() => []);
    const want = keyRow[0] && keyRow[0].value;
    const got = diag.get("key") || req.headers.get("x-diag-key") || "";
    // constant-length compare is overkill for a diagnostic, but never 401 — a 404 doesn't
    // confirm the endpoint exists to someone probing for it
    if (!want || got !== want) return new Response("Not found", { status: 404 });
  }
  try {
    if (BOT && GUILD && diagMode === "guild") {
      const roles = await dApi("GET", `/guilds/${GUILD}/roles`);
      const chans = await dApi("GET", `/guilds/${GUILD}/channels`);
      const TYPE = { 0: "text", 2: "voice", 4: "category", 5: "announcement", 13: "stage", 15: "forum" };
      const catName = Object.fromEntries(chans.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
      const priv = (c) => {
        const ev = (c.permission_overwrites || []).find((o) => o.id === GUILD);
        return !!ev && (BigInt(ev.deny || "0") & 1024n) === 1024n;
      };
      return new Response(JSON.stringify({
        roles: roles.filter((r) => r.name !== "@everyone")
          .sort((a, b) => b.position - a.position)
          .map((r) => ({ name: r.name, color: r.color, hoisted: r.hoist, mentionable: r.mentionable, managed: r.managed })),
        channels: chans.filter((c) => c.type !== 4).sort((a, b) => a.position - b.position).map((c) => ({
          name: c.name, type: TYPE[c.type] || c.type, category: catName[c.parent_id] || null,
          private: priv(c), topic: c.topic || null, nsfw: !!c.nsfw, slowmode: c.rate_limit_per_user || 0,
        })),
        categories: chans.filter((c) => c.type === 4).sort((a, b) => a.position - b.position).map((c) => c.name),
      }, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (BOT && GUILD && diagMode === "staff") {
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
      return new Response(JSON.stringify({
        officeRoles: office.map((r) => r.name),
        privateCategories: chans.filter((c) => privCatIds.includes(c.id)).map((c) => c.name),
        staffChannels: report,
      }, null, 2), { status: 200, headers: { "content-type": "application/json" } });
    }
  } catch (e) { return new Response(JSON.stringify({ diagError: String(e.message || e) }), { status: 500, headers: { "content-type": "application/json" } }); }

  if (!SB_URL || !SB_KEY || !BOT || !GUILD) {
    console.log("discord-sync: missing env (need bot token + guild id + Supabase) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }
  // collapse rapid repeat invocations (spam / abuse); scheduled runs are 5 min apart so this never blocks them
  if (await ranRecently("discord-sync", 6)) return new Response("skipped: ran moments ago", { status: 200 });

  const links = await sbGet("discord_links?select=profile_id,gamertag,role,discord_id,team_id,discord_username");
  // staff department picks (site) -> department Discord roles for the officials who chose them
  const deptByProfile = {};
  try { for (const p of await sbGet("profiles?select=id,departments&role=in.(staff,commissioner)")) deptByProfile[p.id] = p.departments || []; } catch (e) {}
  const bannedIds = new Set((await sbGet("profiles?banned=eq.true&select=id")).map((p) => p.id));
  // current in_guild per profile, so we only write when it changes
  const inGuildById = {};
  for (const p of await sbGet("profiles?select=id,in_guild")) inGuildById[p.id] = p.in_guild;
  const markGuild = async (pid, v) => { if (inGuildById[pid] !== v) { await sbPatch(`profiles?id=eq.${pid}`, { in_guild: v }); inGuildById[pid] = v; } };
  const teams = await sbGet("teams?select=id,name,color,owner_profile_id,gm_profile_id,agm_profile_id,discord_role_id,discord_channel_id");
  const teamRoleId = Object.fromEntries(teams.filter((t) => t.discord_role_id).map((t) => [t.id, t.discord_role_id]));
  // team management role now lives on the team's slots (owner/gm/agm), not profiles.role
  const mgmtRoleByProfile = {};
  for (const t of teams) {
    if (t.owner_profile_id) mgmtRoleByProfile[t.owner_profile_id] = "owner";
    if (t.gm_profile_id) mgmtRoleByProfile[t.gm_profile_id] = "gm";
    if (t.agm_profile_id) mgmtRoleByProfile[t.agm_profile_id] = "agm";
  }

  // player position (current season) -> for position-based Discord roles
  const POS_LABEL = { C: "Center", LW: "Left Wing", RW: "Right Wing", LD: "Left Defense", RD: "Right Defense", G: "Goalie" };
  const POSITION_ROLES = ["Center", "Left Wing", "Right Wing", "Left Defense", "Right Defense", "Goalie"];
  const posOf = {};
  try {
    const seasons = await sbGet("seasons?select=id&order=number.desc&limit=1");
    const seasonId = seasons[0] && seasons[0].id;
    if (seasonId) {
      for (const r of await sbGet(`season_registrations?season_id=eq.${seasonId}&select=profile_id,position`)) if (r.position) posOf[r.profile_id] = r.position;
      for (const s of await sbGet(`roster_spots?season_id=eq.${seasonId}&select=profile_id,position`)) if (s.position) posOf[s.profile_id] = s.position; // roster spot wins over signup
    }
  } catch (e) { /* positions optional */ }

  // guild roles + channels (id -> current name) for auto-rename + id-based assignment
  const guildRoles = await dApi("GET", `/guilds/${GUILD}/roles`);
  const roleNameById = Object.fromEntries(guildRoles.map((r) => [r.id, r.name]));
  const roleColorById = Object.fromEntries(guildRoles.map((r) => [r.id, r.color]));
  const roleId = {};
  for (const r of guildRoles) roleId[r.name.toLowerCase()] = r.id;
  const guildChannels = await dApi("GET", `/guilds/${GUILD}/channels`);
  const chanNameById = Object.fromEntries(guildChannels.map((c) => [c.id, c.name]));

  const sum = { checked: 0, renamed: 0, roleUpdated: 0, roleRenamed: 0, chanRenamed: 0, notInServer: 0,
    staffChecked: 0, staffLocked: 0, staffMissing: 0, errors: [] };

  // Department roles + their Staff-category rooms first, so the private-channel sweep below can
  // self-heal them the same run. deptRoleByChannel lets that sweep keep each room department-private
  // (its role + commissioners) instead of the category default (all staff).
  try { await ensureStaffDepartments(guildChannels, roleId, roleNameById, sum); } catch (e) { sum.errors.push({ staffDepts: String(e.message || e) }); }
  const deptRoleByChannel = {};
  for (const d of STAFF_DEPARTMENTS) { const rid = roleId[d.role.toLowerCase()]; if (rid) deptRoleByChannel[d.channel] = rid; }
  try {
    const dmap = {};
    for (const d of STAFF_DEPARTMENTS) if (roleId[d.role.toLowerCase()]) dmap[d.key] = roleId[d.role.toLowerCase()];
    if (Object.keys(dmap).length) await sbUpsertCfg("discord_dept_role_ids", JSON.stringify(dmap));
  } catch (e) { sum.errors.push({ deptRoleIds: String(e.message || e) }); }

  // Keep #free-agency and #trade-block private to team management — self-heals if the @everyone
  // view permission ever gets re-added. VIEW_CHANNEL(1024)+SEND_MESSAGES(2048)+READ_HISTORY(65536)=68608.
  const MGMT_ALLOW = "68608";
  const mgmtRoleIds = ["owner", "general manager", "assistant general manager", "commissioner"].map((n) => roleId[n]).filter(Boolean);
  for (const cname of ["free-agency", "trade-block"]) {
    const chan = guildChannels.find((c) => c.name === cname && c.type === 0);
    if (!chan) continue;
    const everyone = (chan.permission_overwrites || []).find((o) => o.id === GUILD);
    const hidden = everyone && (BigInt(everyone.deny || "0") & 1024n) === 1024n;
    if (hidden) continue; // already locked down
    try {
      await dApi("PUT", `/channels/${chan.id}/permissions/${GUILD}`, { type: 0, deny: "1024", allow: "0" });
      for (const rid of mgmtRoleIds) await dApi("PUT", `/channels/${chan.id}/permissions/${rid}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
      sum.mgmtLocked = (sum.mgmtLocked || 0) + 1;
    } catch (e) { sum.errors.push({ lockChannel: cname, error: String(e.message || e) }); }
  }

  // Team channels self-heal the same way: private to the club + the league office. The club-role
  // allow goes in the SAME pass as the @everyone deny (never deny first and stop — the club would
  // lose sight of its own room), and the fast-path also verifies the club allow still exists.
  const staffRoleIds = ["commissioner", "staff"].map((n) => roleId[n]).filter(Boolean);
  for (const t of teams) {
    if (!t.discord_channel_id || !t.discord_role_id) continue;
    const chan = guildChannels.find((c) => c.id === t.discord_channel_id);
    if (!chan) continue;
    const ow = chan.permission_overwrites || [];
    const everyone = ow.find((o) => o.id === GUILD);
    const clubAllow = ow.find((o) => o.id === t.discord_role_id);
    const hidden = everyone && (BigInt(everyone.deny || "0") & 1024n) === 1024n;
    const clubOk = clubAllow && (BigInt(clubAllow.allow || "0") & 1024n) === 1024n;
    if (hidden && clubOk) continue;
    try {
      await dApi("PUT", `/channels/${chan.id}/permissions/${t.discord_role_id}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
      for (const rid of staffRoleIds) await dApi("PUT", `/channels/${chan.id}/permissions/${rid}`, { type: 0, allow: MGMT_ALLOW, deny: "0" });
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
        const created = await dApi("POST", `/guilds/${GUILD}/roles`, { name: pn, mentionable: false });
        if (created && created.id) { roleId[pn.toLowerCase()] = created.id; roleNameById[created.id] = pn; sum.rolesCreated = (sum.rolesCreated || 0) + 1; }
      } catch (e) { sum.errors.push({ role: pn, error: String(e.message || e) }); }
    }
  }

  // managed role ids = static roles + position roles (by name) + every team's role (by stored id)
  const MANAGED_STATIC = ["Player", "Owner", "General Manager", "Assistant General Manager", "Commissioner", "Staff", "Free Agent", "Not Signed Up", ...POSITION_ROLES];
  // ensure the mentionable roles the automations depend on exist (created once, then reused):
  //  Staff (members ping the officials), the front-office roles (gate the Team Management rooms),
  //  and "Not Signed Up" (the daily sign-up reminder pings this one role).
  const ENSURE_ROLES = [["Staff", true], ["Owner", true], ["General Manager", true], ["Assistant General Manager", true], ["Not Signed Up", true]];
  for (const [name, mentionable] of ENSURE_ROLES) {
    if (roleId[name.toLowerCase()]) continue;
    try {
      const created = await dApi("POST", `/guilds/${GUILD}/roles`, { name, mentionable });
      if (created && created.id) { roleId[name.toLowerCase()] = created.id; roleNameById[created.id] = name; sum.rolesCreated = (sum.rolesCreated || 0) + 1; }
    } catch (e) { sum.errors.push({ role: name, error: String(e.message || e) }); }
  }
  if (roleId["not signed up"]) await sbUpsertCfg("discord_not_signed_up_role_id", roleId["not signed up"]);
  // Publish a name->id map of the league roles so the DATABASE can render @role pills too
  // (public._role_tag reads this). Without it the DB can only bold a role name.
  try {
    const wanted = ["staff", "commissioner", "owner", "general manager", "assistant general manager", "player", "free agent", "not signed up"];
    const map = {};
    for (const n of wanted) if (roleId[n]) map[n] = roleId[n];
    if (Object.keys(map).length) await sbUpsertCfg("discord_role_ids", JSON.stringify(map));
  } catch (e) { sum.errors.push({ roleIdMap: String(e.message || e) }); }
  // the Team Management category + its rooms (private to the front office)
  try { await ensureMgmtCategory(guildChannels, roleId, sum); } catch (e) { sum.errors.push({ mgmtCategory: String(e.message || e) }); }

  const managedIds = new Set();
  for (const n of MANAGED_STATIC) if (roleId[n.toLowerCase()]) managedIds.add(roleId[n.toLowerCase()]);
  for (const t of teams) if (t.discord_role_id) managedIds.add(t.discord_role_id);
  // department roles are managed too, so they're added/removed as officials change their picks
  for (const d of STAFF_DEPARTMENTS) { const rid = roleId[d.role.toLowerCase()]; if (rid) managedIds.add(rid); }

  // who still needs to register for the open season → drives the "Not Signed Up" role
  let regOpen = false; const registered = new Set();
  try {
    const s = (await sbGet("seasons?select=id,registration_open,signup_deadline_at,registration_deadline&order=number.desc&limit=1"))[0];
    if (s) {
      const deadline = s.signup_deadline_at || s.registration_deadline;
      regOpen = !!s.registration_open && (!deadline || Date.now() < Date.parse(deadline));
      if (regOpen) for (const r of await sbGet(`season_registrations?season_id=eq.${s.id}&select=profile_id`)) registered.add(r.profile_id);
    }
  } catch (e) { sum.errors.push({ regStatus: String(e.message || e) }); }

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

  for (const m of links) {
    if (!m.discord_id) continue;
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
      const mem = await dApi("GET", `/guilds/${GUILD}/members/${m.discord_id}`);
      if (mem.__notfound) { sum.notInServer++; await markGuild(m.profile_id, false); continue; }
      sum.checked++;
      await markGuild(m.profile_id, true);

      // (1) username sync — site gamertag follows Discord display name
      const disp = mem.nick || (mem.user && (mem.user.global_name || mem.user.username));
      if (disp && disp !== m.gamertag) { await sbPatch(`profiles?id=eq.${m.profile_id}`, { gamertag: disp }); sum.renamed++; }
      // (1b) store the Discord @handle so the commissioner directory can show it
      const handle = mem.user && mem.user.username;
      if (handle && handle !== m.discord_username) { await sbPatch(`profiles?id=eq.${m.profile_id}`, { discord_username: handle }); }

      // (2) role sync — desired managed roles for this member
      const desired = new Set();
      if (roleId["player"]) desired.add(roleId["player"]);
      if (m.team_id && teamRoleId[m.team_id]) desired.add(teamRoleId[m.team_id]);
      else if (roleId["free agent"]) desired.add(roleId["free agent"]);
      const teamRole = mgmtRoleByProfile[m.profile_id];
      if (teamRole === "owner" && roleId["owner"]) desired.add(roleId["owner"]);
      if (teamRole === "gm" && roleId["general manager"]) desired.add(roleId["general manager"]);
      if (teamRole === "agm" && roleId["assistant general manager"]) desired.add(roleId["assistant general manager"]);
      if (m.role === "commissioner" && roleId["commissioner"]) desired.add(roleId["commissioner"]);
      // league officials: staff wear Staff; the commissioner is staff too
      if ((m.role === "staff" || m.role === "commissioner") && roleId["staff"]) desired.add(roleId["staff"]);
      // department roles the official signed up for on the site — these open the department rooms
      if (m.role === "staff" || m.role === "commissioner") {
        for (const key of (deptByProfile[m.profile_id] || [])) {
          const d = STAFF_DEPARTMENTS.find((x) => x.key === key);
          const rid = d && roleId[d.role.toLowerCase()];
          if (rid) desired.add(rid);
        }
      }
      // "Not Signed Up" — a plain member who hasn't registered for the open season (the daily
      // #season-signups reminder pings this role). Cleared automatically once they register or the
      // window closes, since it's a managed role reconciled to `desired` every run.
      if (regOpen && m.role === "member" && !registered.has(m.profile_id) && roleId["not signed up"]) desired.add(roleId["not signed up"]);
      // position role (Center / Left Wing / … / Goalie) from their current-season position
      const posName = POS_LABEL[posOf[m.profile_id]];
      if (posName && roleId[posName.toLowerCase()]) desired.add(roleId[posName.toLowerCase()]);

      const current = new Set(mem.roles || []);
      // keep all NON-managed roles, set the managed ones to `desired`
      const next = [...current].filter((id) => !managedIds.has(id));
      for (const id of desired) next.push(id);
      const nextSet = new Set(next);
      const changed = nextSet.size !== current.size || [...nextSet].some((id) => !current.has(id));
      if (changed) {
        const res = await dApi("PATCH", `/guilds/${GUILD}/members/${m.discord_id}`, { roles: [...nextSet] });
        if (!(res && res.__notfound)) sum.roleUpdated++;
      }
    } catch (e) {
      // owner + higher-role members can't be modified by the bot — log and continue
      sum.errors.push({ discord_id: m.discord_id, error: String(e.message || e) });
    }
  }
  // (3) resolve the server for any game whose 30-min pick-lock has passed (auto-fills the match card)
  try {
    const rr = await fetch(`${SB_URL}/rest/v1/rpc/resolve_due_servers`, { method: "POST", headers: sbHead(), body: "{}" });
    sum.serversResolved = rr.ok ? await rr.json() : `err ${rr.status}`;
  } catch (e) { sum.errors.push({ rpc: "resolve_due_servers", error: String(e.message || e) }); }

  console.log("discord-sync:", JSON.stringify(sum));
  // per-run result for the Automations panel — red chip + last error when a run fails
  try {
    await fetch(`${SB_URL}/rest/v1/app_config`, { method: "POST", headers: { ...sbHead(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key: "rl_discord-sync_result", value: JSON.stringify({
        at: new Date().toISOString(), ok: sum.errors.length === 0, checked: sum.checked,
        staffChecked: sum.staffChecked, staffLocked: sum.staffLocked, staffMissing: sum.staffMissing,
        errCount: sum.errors.length, lastError: sum.errors[0] ? JSON.stringify(sum.errors[0]).slice(0, 200) : null
      }), updated_at: new Date().toISOString() }) });
  } catch {}
  return new Response(JSON.stringify(sum), { status: 200, headers: { "content-type": "application/json" } });
};
