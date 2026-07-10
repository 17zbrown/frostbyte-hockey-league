// Netlify Scheduled Function — keeps Discord in sync with the site every 5 min.
//  (1) Username sync: sets each profile's gamertag to the member's current Discord
//      display name (server nick > global name > username), so name changes flow in.
//  (2) Role sync: reconciles each member's MANAGED Discord roles with the DB —
//      team role (from their roster spot), General Manager, Commissioner, Player,
//      Free Agent. Never touches non-managed roles (boosters, custom, etc.).
//
// Env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// No-ops safely if the bot token / guild id aren't set. Node 18+ (global fetch).

export const config = { schedule: "*/5 * * * *" };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const UA = "DiscordBot (https://chelgaming.netlify.app,1.0)";

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

export default async () => {
  if (!SB_URL || !SB_KEY || !BOT || !GUILD) {
    console.log("discord-sync: missing env (need bot token + guild id + Supabase) — skipping");
    return new Response("skipped: missing env", { status: 200 });
  }

  const links = await sbGet("discord_links?select=profile_id,gamertag,role,discord_id,team_id");
  const teams = await sbGet("teams?select=id,name,gm_profile_id");
  const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  // Map managed Discord role NAMES -> ids
  const guildRoles = await dApi("GET", `/guilds/${GUILD}/roles`);
  const roleId = {};
  for (const r of guildRoles) roleId[r.name.toLowerCase()] = r.id;
  const MANAGED_STATIC = ["Player", "General Manager", "Commissioner", "Free Agent"];
  const managedIds = new Set();
  for (const n of MANAGED_STATIC) if (roleId[n.toLowerCase()]) managedIds.add(roleId[n.toLowerCase()]);
  for (const t of teams) if (roleId[(t.name || "").toLowerCase()]) managedIds.add(roleId[(t.name || "").toLowerCase()]);

  const sum = { checked: 0, renamed: 0, roleUpdated: 0, notInServer: 0, errors: [] };

  for (const m of links) {
    if (!m.discord_id) continue;
    try {
      const mem = await dApi("GET", `/guilds/${GUILD}/members/${m.discord_id}`);
      if (mem.__notfound) { sum.notInServer++; continue; }
      sum.checked++;

      // (1) username sync — site gamertag follows Discord display name
      const disp = mem.nick || (mem.user && (mem.user.global_name || mem.user.username));
      if (disp && disp !== m.gamertag) { await sbPatch(`profiles?id=eq.${m.profile_id}`, { gamertag: disp }); sum.renamed++; }

      // (2) role sync — desired managed roles for this member
      const desired = new Set();
      if (roleId["player"]) desired.add(roleId["player"]);
      if (m.team_id && roleId[(teamName[m.team_id] || "").toLowerCase()]) desired.add(roleId[(teamName[m.team_id] || "").toLowerCase()]);
      else if (roleId["free agent"]) desired.add(roleId["free agent"]);
      if (m.role === "gm" && roleId["general manager"]) desired.add(roleId["general manager"]);
      if (m.role === "commissioner" && roleId["commissioner"]) desired.add(roleId["commissioner"]);

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
  console.log("discord-sync:", JSON.stringify(sum));
  return new Response(JSON.stringify(sum), { status: 200, headers: { "content-type": "application/json" } });
};
