// Instant role sync + the shared role rules. Run: node tools/role-sync.test.mjs
//
// The failure that matters is DRIFT: the sweep and the bot each deciding different roles for the
// same member, expressed as roles flapping on/off every two minutes as the two processes fight.
// The rules live once in shared/roles.mjs; this file tests the rules, the per-member syncer, the
// event → member routing, and — because a fork would be invisible until it flapped — asserts the
// sweep actually imports the shared module instead of carrying a copy.
import { desiredRolesFor, applyManagedRoles, managedRoleIds, STAFF_DEPARTMENTS,
  MANAGED_STATIC, POSITION_ROLES } from "../shared/roles.mjs";
import { createRoleSyncer } from "../bot/role-sync.mjs";
import fs from "node:fs";

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

/* ---------------- the rules ---------------- */
const roleId = {
  player: "R_PLAYER", "free agent": "R_FA", "not signed up": "R_NSU",
  commissioner: "R_COMM", staff: "R_STAFF",
  owner: "R_OWNER", "general manager": "R_GM", "assistant general manager": "R_AGM",
  center: "R_C", "left wing": "R_LW", goalie: "R_G",
  "review board": "R_DEPT_APPS", media: "R_DEPT_MEDIA", statistics: "R_DEPT_STATS",
  "free agent": "R_FA", "restricted free agent": "R_RFA", rookie: "R_ROOKIE",
};
const teamRoleId = { T1: "R_CLUB_MTL" };
const base = { roleId, teamRoleId, registered: new Set(), regOpen: false,
  mgmtRoleByProfile: {}, deptByProfile: {}, posOf: {} };
const want = (m, over) => desiredRolesFor(m, { ...base, ...over });
const has = (s, ...ids) => ids.every((i) => s.has(i));

console.log("— who gets what");
{
  const plain = want({ profile_id: "p1", role: "member", team_id: null }, {});
  A("an unregistered, unrostered member gets nothing", plain.size === 0);

  const fa = want({ profile_id: "p1", role: "member", team_id: null }, { registered: new Set(["p1"]) });
  A("registered + teamless = Player + Free Agent", has(fa, "R_PLAYER", "R_FA") && fa.size === 2);

  const rost = want({ profile_id: "p1", role: "member", team_id: "T1" },
    { registered: new Set(["p1"]), posOf: { p1: "C" } });
  A("rostered = Player + club role + position, NOT Free Agent",
    has(rost, "R_PLAYER", "R_CLUB_MTL", "R_C") && !rost.has("R_FA") && rost.size === 3);

  const roster_only = want({ profile_id: "p1", role: "member", team_id: "T1" }, {});
  A("a roster spot alone still makes a Player", has(roster_only, "R_PLAYER", "R_CLUB_MTL"));

  const nsu = want({ profile_id: "p1", role: "member", team_id: null }, { regOpen: true });
  A("unregistered while the window is open = Not Signed Up", has(nsu, "R_NSU") && nsu.size === 1);
  const nsuStaff = want({ profile_id: "p1", role: "staff", team_id: null },
    { regOpen: true, deptByProfile: { p1: ["officiating"] } });
  A("...staff get the nudge too — they may play", nsuStaff.has("R_NSU"));

  const owner = want({ profile_id: "p1", role: "member", team_id: "T1" },
    { mgmtRoleByProfile: { p1: "owner" } });
  A("a club seat grants the seat role", owner.has("R_OWNER"));

  const comm = want({ profile_id: "p1", role: "commissioner", team_id: null },
    { deptByProfile: { p1: ["applications"] } });
  A("a commissioner wears Commissioner AND Staff", has(comm, "R_COMM", "R_STAFF"));
  A("...and their department rooms", comm.has("R_DEPT_APPS"));

  const staff = want({ profile_id: "p1", role: "staff", team_id: null },
    { deptByProfile: { p1: ["statistics", "media"] } });
  A("staff wear Staff + each department role", has(staff, "R_STAFF", "R_DEPT_STATS", "R_DEPT_MEDIA"));

  const mediaOnly = want({ profile_id: "p1", role: "staff", team_id: null },
    { deptByProfile: { p1: ["media"] } });
  A("media-ONLY staff wear Media but never Staff",
    mediaOnly.has("R_DEPT_MEDIA") && !mediaOnly.has("R_STAFF"));
  const mediaCase = want({ profile_id: "p1", role: "staff", team_id: null },
    { deptByProfile: { p1: [" Media "] } });
  A("...and the media-only test survives stray case/whitespace", !mediaCase.has("R_STAFF"));
}

console.log("\n— the reconcile touches only managed roles");
{
  const managed = managedRoleIds(roleId, [{ discord_role_id: "R_CLUB_MTL" }]);
  A("club + department + static roles are all managed",
    managed.has("R_CLUB_MTL") && managed.has("R_DEPT_MEDIA") && managed.has("R_PLAYER"));
  const { next, changed } = applyManagedRoles(
    ["R_BOOSTER", "R_CUSTOM", "R_PLAYER", "R_FA"],           // current: two foreign, two managed
    new Set(["R_PLAYER", "R_CLUB_MTL"]),                      // desired now
    managed);
  A("non-managed roles survive untouched", next.includes("R_BOOSTER") && next.includes("R_CUSTOM"));
  A("stale managed roles are removed", !next.includes("R_FA"));
  A("new managed roles are added", next.includes("R_CLUB_MTL") && changed === true);
  const same = applyManagedRoles(next, new Set(["R_PLAYER", "R_CLUB_MTL"]), managed);
  A("a converged member needs no write", same.changed === false);
}

console.log("\n— one definition, not two");
{
  const sweep = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  A("the sweep imports the shared rules", /from "\.\.\/\.\.\/shared\/roles\.mjs"/.test(sweep));
  A("...and no longer carries its own copy of the grant logic",
    !/desired\.add\(roleId\["player"\]\)/.test(sweep));
  A("...or of STAFF_DEPARTMENTS", !/const STAFF_DEPARTMENTS = \[/.test(sweep));
  const bot = fs.readFileSync(new URL("../bot/role-sync.mjs", import.meta.url), "utf8");
  A("the bot imports the same module", /from "\.\.\/shared\/roles\.mjs"/.test(bot));
  A("the shared module stays pure — no fetch, no env",
    !/fetch\(|process\.env/.test(fs.readFileSync(new URL("../shared/roles.mjs", import.meta.url), "utf8")));
}

/* "Which member a change touches" lives in SQL now — the rsq_* triggers on profiles /
   season_registrations / roster_spots / teams write role_sync_queue with the full OLD row in
   hand (Realtime strips DELETE payloads on RLS tables to a bare pkey, even for the service
   role, so this decision CANNOT live client-side). tools cannot run Postgres; the trigger
   behavior is verified live in a rolled-back transaction at deploy time. What CAN be asserted
   here is that the client no longer pretends to own that decision. */
console.log("\n— routing belongs to the database triggers");
{
  const bot = fs.readFileSync(new URL("../bot/role-sync.mjs", import.meta.url), "utf8");
  A("the bot carries no table-routing logic", !/affectedProfiles/.test(bot));
  A("...and consumes only the queue", /role_sync_queue/.test(bot));
  const wiring = fs.readFileSync(new URL("../bot/chel-bot.mjs", import.meta.url), "utf8");
  A("the wiring subscribes to the queue, not the member tables",
    /table: "role_sync_queue"/.test(wiring) && !/table: "roster_spots"/.test(wiring) && !/table: "season_registrations"/.test(wiring));
}

/* ---------------- the live syncer, network stubbed ---------------- */
const GUILD_ROLES = Object.entries({
  Player: "R_PLAYER", "Free Agent": "R_FA", "Not Signed Up": "R_NSU", Commissioner: "R_COMM",
  Staff: "R_STAFF", Center: "R_C", Media: "R_DEPT_MEDIA", Montreal: "R_CLUB_MTL",
}).map(([name, id]) => ({ id, name }));
let DB, member, patches, fail404, purged = 0;
function reset() {
  DB = {
    links: [{ profile_id: "p1", role: "member", discord_id: "d1", team_id: null }],
    profile: { id: "p1", role: "member", departments: null, banned: false },
    seasons: [{ id: "S1", registration_open: true }],
    reg: [], spot: [],
    teams: [{ id: "T1", discord_role_id: "R_CLUB_MTL", owner_profile_id: null, gm_profile_id: null, agm_profile_id: null }],
  };
  member = { user: { id: "d1" }, roles: ["R_BOOSTER"] };
  patches = []; fail404 = false;
}
reset();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), m = opts.method || "GET";
  const J = (b, c) => new Response(JSON.stringify(b), { status: c || 200, headers: { "content-type": "application/json" } });
  if (u.includes("/guilds/") && u.includes("/roles")) return J(GUILD_ROLES);
  if (u.includes("/guilds/") && u.includes("/members/")) {
    if (m === "GET") return fail404 ? J({ message: "Unknown Member" }, 404) : J(member);
    if (m === "PATCH") { const b = JSON.parse(opts.body); patches.push(b); member.roles = b.roles; return J({}); }
  }
  if (u.includes("discord_links")) return J(DB.links);
  if (u.includes("/rest/v1/profiles")) return J([DB.profile]);
  if (u.includes("/rest/v1/seasons")) return J(DB.seasons);
  if (u.includes("season_registrations")) return J(DB.reg);
  if (u.includes("roster_spots")) return J(DB.spot);
  if (u.includes("/rest/v1/teams")) return J(DB.teams);
  if (u.includes("role_sync_queue")) {
    if (m === "DELETE") { purged++; return new Response(null, { status: 204 }); }
    return J(DB.queue || []);
  }
  return J([]);
};
const ENV = { SB_URL: "https://sb.invalid", SB_KEY: "k", BOT: "t", GUILD: "g1" };

console.log("\n— a member's change converges Discord in one write");
{
  reset();
  DB.reg = [{ profile_id: "p1", position: "C" }];        // they just signed up as a center
  const S = createRoleSyncer(ENV, { debounceMs: 1 });
  const r = await S.syncProfile("p1", "test");
  A("the sync patches", r === "patched" && patches.length === 1);
  const roles = patches[0].roles;
  A("...to Player + Free Agent + Not... no — registered, so no NSU",
    roles.includes("R_PLAYER") && roles.includes("R_FA") && !roles.includes("R_NSU"));
  A("...with their position", roles.includes("R_C"));
  A("...keeping the booster role", roles.includes("R_BOOSTER"));
  /* the stub applies patches back to the member (as Discord does), so the second sync sees the
     converged state and must not write again */
  const again = await S.syncProfile("p1", "test");
  A("already-converged members are a no-op", again === "no-op" && patches.length === 1, again);
}

console.log("\n— rostered member gets the club role instantly");
{
  reset();
  DB.links[0].team_id = "T1";
  DB.reg = [{ profile_id: "p1", position: "LW" }];
  DB.spot = [{ position: "C" }];                          // roster spot position wins
  const S = createRoleSyncer(ENV, { debounceMs: 1 });
  await S.syncProfile("p1", "test");
  const roles = patches[0].roles;
  A("club role granted", roles.includes("R_CLUB_MTL"));
  A("Free Agent removed by the same write", !roles.includes("R_FA"));
  A("roster-spot position beats signup position", roles.includes("R_C"));
}

console.log("\n— the guard rails");
{
  reset(); DB.links = [];
  const S = createRoleSyncer(ENV, { debounceMs: 1 });
  A("an unlinked member is skipped", (await S.syncProfile("p1")) === "unlinked" && patches.length === 0);

  reset(); DB.profile.banned = true;
  const S2 = createRoleSyncer(ENV, { debounceMs: 1 });
  A("a banned member is never touched — the sweep owns bans",
    (await S2.syncProfile("p1")) === "banned-skip" && patches.length === 0);

  reset(); fail404 = true;
  const S3 = createRoleSyncer(ENV, { debounceMs: 1 });
  A("not-in-guild is a skip, not a crash", (await S3.syncProfile("p1")) === "not-in-guild");

  reset();
  member.roles = ["R_BOOSTER", "R_NSU"];                  // already exactly right (regOpen, unregistered)
  const S4 = createRoleSyncer(ENV, { debounceMs: 1 });
  A("a converged member costs zero writes", (await S4.syncProfile("p1")) === "no-op" && patches.length === 0);
}

console.log("\n— the debounce collapses a burst");
{
  reset();
  DB.reg = [{ profile_id: "p1", position: "C" }];
  const S = createRoleSyncer(ENV, { debounceMs: 30 });
  let done = 0;
  await new Promise((res) => {
    const fin = () => { done++; res(); };
    S.enqueue("p1", "roster_spots:insert");
    S.enqueue("p1", "contracts:insert");
    S.enqueue("p1", "teams:update", fin);               // three events, one member
  });
  await new Promise((r) => setTimeout(r, 60));
  A("three events in a burst produce ONE sync", S.sum.synced === 1 && done === 1);
  A("...and one write", patches.length === 1);
}

console.log("\n— the queue replay never floods and always prunes");
{
  reset(); purged = 0;
  DB.queue = [
    { profile_id: "p1", reason: "registration:insert" },
    { profile_id: "p1", reason: "roster:insert" },       // same member twice -> one sync
  ];
  DB.reg = [{ profile_id: "p1", position: "C" }];
  const S = createRoleSyncer(ENV, { debounceMs: 5 });
  const r = await S.catchUp();
  await new Promise((res) => setTimeout(res, 60));
  A("recent rows replay, deduped per member", r.replayed === 1 && S.sum.synced === 1, `replayed=${r.replayed} synced=${S.sum.synced}`);
  A("old rows are purged", purged === 1);
}

/* ---- CGHL Management: one handle for a club's whole front office (2026-08-13) ---------------
   The league office wanted to reach every Owner, GM and AGM in one ping. It rides on the same
   seat check as the three individual roles, so it cannot drift out of step with them: gain a
   seat, gain the role; lose the seat, lose the role. */
{
  const rid = { "owner":"R_OWN", "general manager":"R_GM", "assistant general manager":"R_AGM",
                "cghl management":"R_MGMT", "player":"R_PLAYER" };
  const base = { roleId: rid, teamRoleId: {}, registered: new Set(), regOpen: false,
                 mgmtRoleByProfile: {}, deptByProfile: {}, posOf: {} };
  const rolesFor = (seat) => {
    const ctx = { ...base, mgmtRoleByProfile: seat ? { p1: seat } : {} };
    return desiredRolesFor({ profile_id: "p1", role: "member", team_id: null }, ctx);
  };
  A("an Owner gets CGHL Management", rolesFor("owner").has("R_MGMT"));
  A("a GM gets it too", rolesFor("gm").has("R_MGMT"));
  A("an AGM gets it too", rolesFor("agm").has("R_MGMT"));
  A("...alongside their own seat role, not instead of it",
    rolesFor("owner").has("R_OWN") && rolesFor("gm").has("R_GM") && rolesFor("agm").has("R_AGM"));
  A("a member with no seat does NOT get it", !rolesFor(null).has("R_MGMT"));
  A("...and losing the seat revokes it, because it is reconciled like every managed role",
    MANAGED_STATIC.includes("CGHL Management"));

  const sync = fs.readFileSync(new URL("../netlify/functions/discord-sync.js", import.meta.url), "utf8");
  A("the sweep creates the role if it is missing", /\["CGHL Management", true\]/.test(sync));
  A("...and keeps it mentionable, so the ping actually works",
    /\["CGHL Management", true, false\]/.test(sync));
}

console.log("\n— rights classes ride on the ctx sets (the bot must pass these or roles flap)");
{
  const reg = new Set(["p1"]);
  const rfa = want({ profile_id: "p1", role: "member", team_id: null }, { registered: reg, rfa: new Set(["p1"]) });
  A("an RFA wears Restricted Free Agent, not Free Agent", rfa.has("R_RFA") && !rfa.has("R_FA"));
  const fa = want({ profile_id: "p1", role: "member", team_id: null }, { registered: reg });
  A("with no rfa set, an unrostered registrant is a plain Free Agent", fa.has("R_FA") && !fa.has("R_RFA"));
  const rk = want({ profile_id: "p1", role: "member", team_id: null }, { registered: reg, rookies: new Set(["p1"]) });
  A("a rookie wears Rookie alongside Free Agent", rk.has("R_ROOKIE") && rk.has("R_FA"));
  A("omitting the sets grants neither — which is exactly why the bot had to compute them",
    !fa.has("R_ROOKIE") && !fa.has("R_RFA"));

  const botSrc = fs.readFileSync(new URL("../bot/role-sync.mjs", import.meta.url), "utf8");
  A("the bot computes rookie/RFA for the profile", /isRookie = priorSeasons\.size === 0 && !draftedBefore/.test(botSrc) &&
    /isRfa = priorSeasons\.size > 0 && priorSeasons\.size < C\.rfaYears/.test(botSrc));
  A("...and passes them into desiredRolesFor", /rfa: isRfa \? new Set\(\[profileId\]\) : new Set\(\)/.test(botSrc) &&
    /rookies: isRookie \? new Set\(\[profileId\]\) : new Set\(\)/.test(botSrc));
  A("...reading the same rfa_offseasons threshold the site uses", /app_config\?key=eq\.rfa_offseasons/.test(botSrc));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
