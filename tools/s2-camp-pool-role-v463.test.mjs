// v463 (Season 2 rulings, 2026-11-23: no club camps, one league-wide training camp pool; standing default "Pool players
// get the TC Discord role but no club room"): the Training Camp role follows the pool. Run: node tools/s2-camp-pool-role-v463.test.mjs
//
// The pool is the database's ONE list, public.market_pool(season) (v4.58: sign-ups not declined, on no roster, not on open
// waivers, not banned; empty unless market_on(season) and that season's draft is complete). Both lanes read it, the sweep
// for the whole season and the gateway bot for one member, and hand it to the one rule in shared/roles.mjs, so the two can
// never fight over the role. Season 1 (market off) is unchanged: its camp players still wear the role through a roster
// spot in training camp. Network is stubbed throughout; nothing reaches Supabase or Discord.
process.env.SUPABASE_URL ||= "https://sb.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "k";
process.env.DISCORD_BOT_TOKEN ||= "t";
process.env.DISCORD_GUILD_ID ||= "guild1";

import fs from "node:fs";
import { desiredRolesFor } from "../shared/roles.mjs";
import { createRoleSyncer } from "../bot/role-sync.mjs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const set = (s) => [...s].sort().join(",");

/* ---------------- the rule ---------------- */
const roleId = { player: "R_PLAYER", "free agent": "R_FA", "not signed up": "R_NSU", "training camp": "R_TC" };
const base = { roleId, teamRoleId: { T1: "R_CLUB" }, registered: new Set(), regOpen: false, mgmtRoleByProfile: {}, deptByProfile: {}, posOf: {} };
const want = (m, over) => desiredRolesFor(m, { ...base, ...over });
const teamless = { profile_id: "p1", role: "member", team_id: null };

console.log("— the pool wears Training Camp");
A("a Season 2 pool player: Player, Free Agent and Training Camp, no club role",
  set(want(teamless, { registered: new Set(["p1"]), pool: new Set(["p1"]) })) === "R_FA,R_PLAYER,R_TC");
A("a signed-up member outside the pool (before the draft, or on open waivers) does not",
  !want(teamless, { registered: new Set(["p1"]), pool: new Set() }).has("R_TC"));
A("no pool in the context behaves exactly as before",
  set(want(teamless, { registered: new Set(["p1"]) })) === "R_FA,R_PLAYER");

console.log("\n— Season 1 is unchanged");
A("a club camp player (roster spot in training camp) keeps it with the club role",
  set(want({ profile_id: "p1", role: "member", team_id: "T1" }, { registered: new Set(["p1"]), camp: new Set(["p1"]) })) === "R_CLUB,R_PLAYER,R_TC");
A("a camp flag with no roster spot still grants nothing (the club role is the reason)",
  !want(teamless, { registered: new Set(["p1"]), camp: new Set(["p1"]) }).has("R_TC"));
A("a rostered member called up from camp loses it", !want({ profile_id: "p1", role: "member", team_id: "T1" }, { registered: new Set(["p1"]) }).has("R_TC"));

/* ---------------- the bot's instant lane ---------------- */
const GUILD_ROLES = [["Player", "R_PLAYER"], ["Free Agent", "R_FA"], ["Training Camp", "R_TC"], ["Montreal", "R_CLUB"]].map(([name, id]) => ({ id, name }));
let W, patches, poolUrls;
function reset() {
  W = { season: { id: "S2", number: 2, status: "upcoming", registration_open: false }, reg: [{ profile_id: "p1", position: "C" }],
        pool: [], poolStatus: 200, roles: ["R_PLAYER", "R_FA"] };
  patches = []; poolUrls = [];
}
const botFetch = async (url, opts = {}) => {
  const u = decodeURIComponent(String(url)), m = opts.method || "GET";
  if (u.includes("/guilds/") && u.endsWith("/roles")) return J(GUILD_ROLES);
  if (u.includes("/guilds/") && u.includes("/members/")) {
    if (m === "GET") return J({ user: { id: "d1" }, roles: W.roles });
    if (m === "PATCH") { const b = JSON.parse(opts.body); patches.push(b.roles); W.roles = b.roles; return J({}); }
  }
  if (u.includes("/rest/v1/rpc/market_pool")) { poolUrls.push(u); return W.poolStatus === 200 ? J(W.pool) : J({ message: "boom" }, W.poolStatus); }
  if (u.includes("/rest/v1/discord_links")) return J([{ profile_id: "p1", role: "member", discord_id: "d1", team_id: null }]);
  if (u.includes("/rest/v1/profiles")) return J([{ id: "p1", role: "member", departments: null, banned: false }]);
  if (u.includes("/rest/v1/seasons")) return J([W.season]);
  if (u.includes("/rest/v1/season_registrations")) return J(W.reg);
  if (u.includes("/rest/v1/teams")) return J([{ id: "T1", discord_role_id: "R_CLUB" }]);
  return J([]);
};
globalThis.fetch = botFetch;
const ENV = { SB_URL: "https://sb.invalid", SB_KEY: "k", BOT: "t", GUILD: "g1" };

console.log("\n— the bot asks the database's pool for this one member");
{
  reset(); W.pool = [{ profile_id: "p1" }];
  const S = createRoleSyncer(ENV, { debounceMs: 1, retryDelaysMs: [] });
  const r = await S.syncProfile("p1", "test");
  A("a pool player is patched to wear Training Camp", r === "patched" && patches.length === 1 && patches[0].includes("R_TC"), r);
  A("...with no club role", !patches[0].includes("R_CLUB"));
  A("...from market_pool for the season in play, filtered to the member",
    poolUrls.length === 1 && poolUrls[0] === "https://sb.invalid/rest/v1/rpc/market_pool?p_season=S2&profile_id=eq.p1&select=profile_id", poolUrls[0]);

  reset(); W.roles = ["R_PLAYER", "R_FA", "R_TC"]; W.pool = [];
  const S2 = createRoleSyncer(ENV, { debounceMs: 1, retryDelaysMs: [] });
  await S2.syncProfile("p1", "test");
  A("a member who leaves the pool (claimed off waivers, drafted, banned) loses it", patches.length === 1 && !patches[0].includes("R_TC"));

  reset(); W.pool = [{ profile_id: "p1" }]; W.poolStatus = 500;
  const S3 = createRoleSyncer(ENV, { debounceMs: 1, retryDelaysMs: [] });
  const r3 = await S3.syncProfile("p1", "test");
  A("a failed pool read is an error, and no roles are written on a guess", r3 === "error" && patches.length === 0 && S3.sum.errors === 1, r3);
}

/* ---------------- the sweep ---------------- */
const src = fs.readFileSync(new URL("../jobs/discord-sync.js", import.meta.url), "utf8");
const botSrc = fs.readFileSync(new URL("../bot/role-sync.mjs", import.meta.url), "utf8");
console.log("\n— the sweep reads the same pool for the season in play");
A("it calls market_pool once for the season in play (the same curSeason as roster positions)",
  /if \(curSeason\) for \(const r of await sbGet\(`rpc\/market_pool\?p_season=\$\{curSeason\.id\}&select=profile_id`\)\) pool\.add\(r\.profile_id\);\n  \} catch \(e\) \{ inputsOk = false; inputsErr\.push\("positions: "/.test(src));
A("...so a failed read leaves managed roles untouched this run", /pool\.add\(r\.profile_id\);\n  \} catch \(e\) \{ inputsOk = false;/.test(src));
A("...and hands it to the shared rule", /desiredRolesFor\(m, \{ roleId, teamRoleId, registered, playing, regOpen,\n\s+mgmtRoleByProfile, deptByProfile, posOf, rfa, rookies, camp, pool/.test(src));
A("both lanes pick the season the same way (in play: active, else the lowest open)",
  /const curSeason = seasons\.find\(\(s\) => s\.status === "active"\) \|\| seasons\[0\] \|\| null;/.test(src)
  && /const curSeason = \(seasons \|\| \[\]\)\.find\(\(s\) => s\.status === "active"\) \|\| \(seasons \|\| \[\]\)\[0\] \|\| null;/.test(botSrc));
A("no second pool definition in either lane", !/status <> 'declined'|market_waivers/.test(src) && !/market_waivers/.test(botSrc));

{
  /* drive the sweep's real member pass with the pool in its context */
  const patched = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), m = (opts.method || "GET").toUpperCase();
    if (u.includes("discord.com/api") && m === "PATCH" && /\/members\//.test(u)) { patched.push(JSON.parse(opts.body).roles); return J({}); }
    if (u.includes("/rest/v1/")) return m === "GET" ? J([]) : new Response(null, { status: 204 });
    return J({});
  };
  const { _internals: I } = await import(new URL("../jobs/discord-sync.js", import.meta.url).pathname);
  const mem = { user: { id: "d1", username: "frosty", global_name: "Frosty" }, roles: ["R_BOOSTER", "R_PLAYER", "R_FA"] };
  const ctx = {
    links: [{ profile_id: "p1", gamertag: "Frosty", role: "member", discord_id: "d1", team_id: null, discord_username: "frosty" }],
    bannedIds: new Set(), guildBans: new Set(), memberById: new Map([["d1", mem]]), memberListOk: true,
    markGuild: async () => {}, avatarById: {}, tagOwner: new Map([["frosty", "p1"]]), inputsOk: true,
    roleId, teamRoleId: {}, registered: new Set(["p1"]), playing: new Set(), regOpen: false, mgmtRoleByProfile: {},
    deptByProfile: {}, posOf: {}, rfa: new Set(), rookies: new Set(), camp: new Set(), pool: new Set(["p1"]),
    managedIds: new Set(["R_PLAYER", "R_FA", "R_TC", "R_NSU"]), timeoutUntil: null, timeoutsApplied: null,
  };
  const sum = { checked: 0, renamed: 0, roleUpdated: 0, notInServer: 0, errors: [] };
  await I.syncLinkedMembers(ctx, sum, () => false);
  A("the sweep's member pass puts Training Camp on a pool player", patched.length === 1 && patched[0].includes("R_TC"), JSON.stringify(patched));
  A("...keeping roles the league does not manage", patched[0] && patched[0].includes("R_BOOSTER"));
  globalThis.fetch = botFetch;
}

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
