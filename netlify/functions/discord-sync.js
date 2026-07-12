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
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHead() });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...sbHead(), Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text()}`);
}
async function dApi(method, path, body) {
  const r = await fetch(`https://discord.com/api/v10${path}`, {
    method, headers: { Authorization: `Bot ${BOT}`, "User-Agent": UA, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (r.status === 404) return { __notfound: true };
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Discord channel-name slug (lowercase, hyphens) to compare against team names
function slug(n) { return String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

export default async () => {
  if (!SB_URL || !SB_KEY || !BOT || !GUILD) {
    console.log("discord-sync: missing env (need bot token + guild id + Supabase) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }

  const links = await sbGet("discord_links?select=profile_id,gamertag,role,discord_id,team_id");
  const bannedIds = new Set((await sbGet("profiles?banned=eq.true&select=id")).map((p) => p.id));
  const teams = await sbGet("teams?select=id,name,owner_profile_id,gm_profile_id,agm_profile_id,discord_role_id,discord_channel_id");
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
  const roleId = {};
  for (const r of guildRoles) roleId[r.name.toLowerCase()] = r.id;
  const guildChannels = await dApi("GET", `/guilds/${GUILD}/channels`);
  const chanNameById = Object.fromEntries(guildChannels.map((c) => [c.id, c.name]));

  const sum = { checked: 0, renamed: 0, roleUpdated: 0, roleRenamed: 0, chanRenamed: 0, notInServer: 0, errors: [] };

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

  // (0) keep each team's Discord ROLE + CHANNEL name in sync with the site team name
  for (const t of teams) {
    try {
      if (t.discord_role_id && roleNameById[t.discord_role_id] && roleNameById[t.discord_role_id] !== t.name) {
        await dApi("PATCH", `/guilds/${GUILD}/roles/${t.discord_role_id}`, { name: t.name }); sum.roleRenamed++;
      }
      const wantSlug = slug(t.name);
      if (t.discord_channel_id && chanNameById[t.discord_channel_id] && chanNameById[t.discord_channel_id] !== wantSlug) {
        await dApi("PATCH", `/channels/${t.discord_channel_id}`, { name: wantSlug }); sum.chanRenamed++;
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
  const MANAGED_STATIC = ["Player", "Owner", "General Manager", "Assistant General Manager", "Commissioner", "Free Agent", ...POSITION_ROLES];
  const managedIds = new Set();
  for (const n of MANAGED_STATIC) if (roleId[n.toLowerCase()]) managedIds.add(roleId[n.toLowerCase()]);
  for (const t of teams) if (t.discord_role_id) managedIds.add(t.discord_role_id);

  for (const m of links) {
    if (!m.discord_id) continue;
    try {
      // banned players are removed from the server and kept out (no return)
      if (bannedIds.has(m.profile_id)) {
        const res = await dApi("PUT", `/guilds/${GUILD}/bans/${m.discord_id}`, { delete_message_seconds: 0 });
        if (!(res && res.__notfound)) sum.banned = (sum.banned || 0) + 1;
        continue;
      }
      const mem = await dApi("GET", `/guilds/${GUILD}/members/${m.discord_id}`);
      if (mem.__notfound) { sum.notInServer++; continue; }
      sum.checked++;

      // (1) username sync — site gamertag follows Discord display name
      const disp = mem.nick || (mem.user && (mem.user.global_name || mem.user.username));
      if (disp && disp !== m.gamertag) { await sbPatch(`profiles?id=eq.${m.profile_id}`, { gamertag: disp }); sum.renamed++; }

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
  return new Response(JSON.stringify(sum), { status: 200, headers: { "content-type": "application/json" } });
};
