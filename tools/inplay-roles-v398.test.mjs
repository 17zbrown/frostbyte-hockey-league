// v3.98 (commissioner, 2026-10-13): "Keep through Season 1". At the movement deadline the next season's sign-ups open and
// the Discord roles follow the season taking sign-ups, so the waived Season 1 free agents would have lost Player and Free
// Agent while clubs could still sign them as replacements (Rule 2.4). A player registered for the season IN PLAY keeps both
// until it ends; Not Signed Up still follows the season taking sign-ups. Both lanes (the Netlify sweep and the gateway
// bot's instant sync) feed the same `playing` set to the one shared rule, so they cannot flap against each other.
// Run: node tools/inplay-roles-v398.test.mjs
import { desiredRolesFor } from "../shared/roles.mjs";
import fs from "node:fs";

let fail = 0, n = 0;
const A = (l, p) => { n++; if (!p) fail++; console.log(`${p ? "ok  " : "FAIL"} ${l}`); };
const roleId = { player: "R_PLAYER", "free agent": "R_FA", "not signed up": "R_NSU", "training camp": "R_TC" };
const teamRoleId = { T1: "R_CLUB" };
const base = { roleId, teamRoleId, registered: new Set(), regOpen: true, mgmtRoleByProfile: {}, deptByProfile: {}, posOf: {} };
const want = (m, over) => desiredRolesFor(m, { ...base, ...over });
const set = (s) => [...s].sort().join(",");

console.log("— after the Season 1 deadline (Season 2 taking sign-ups)");
const waived = want({ profile_id: "p1", role: "member", team_id: null }, { playing: new Set(["p1"]) });
A("a waived Season 1 player keeps Player and Free Agent, and is nudged to sign up for Season 2", set(waived) === "R_FA,R_NSU,R_PLAYER");
const both = want({ profile_id: "p1", role: "member", team_id: null }, { playing: new Set(["p1"]), registered: new Set(["p1"]) });
A("signed up for Season 2 as well: Player and Free Agent, no nudge", set(both) === "R_FA,R_PLAYER");
const gone = want({ profile_id: "p1", role: "member", team_id: null }, {});
A("not registered for either season: only the nudge", set(gone) === "R_NSU");
const rostered = want({ profile_id: "p1", role: "member", team_id: "T1" }, { playing: new Set(["p1"]) });
A("a rostered Season 1 player keeps the club role, never Free Agent", set(rostered) === "R_CLUB,R_NSU,R_PLAYER");
const seat = want({ profile_id: "p1", role: "member", team_id: null }, { playing: new Set(["p1"]), mgmtRoleByProfile: { p1: "gm" } });
A("a seat holder is management, never a free agent", !seat.has("R_FA") && seat.has("R_PLAYER"));
A("no `playing` set at all behaves exactly as before", set(want({ profile_id: "p1", role: "member", team_id: null }, { registered: new Set(["p1"]) })) === "R_FA,R_PLAYER");

console.log("— both lanes feed the same set");
const R = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const sweep = R("netlify/functions/discord-sync.js"), bot = R("bot/role-sync.mjs");
A("the sweep loads the active season's registrations when it is not the season taking sign-ups",
  /const act = \(await sbGet\("seasons\?select=id&status=eq\.active&order=number\.asc&limit=1"\)\)\[0\];\n\s+if \(act && act\.id !== regSeasonId\)/.test(sweep));
A("...a failed load leaves roles untouched instead of stripping them", /inputsOk = false; inputsErr\.push\("in-play registrations"\)/.test(sweep));
A("...and passes it to the shared rule", /desiredRolesFor\(m, \{ roleId, teamRoleId, registered, playing, regOpen,/.test(sweep));
A("the bot picks the same season: active, and not the one taking sign-ups",
  /curSeason && curSeason\.status === "active" && regSeason && curSeason\.id !== regSeason\.id\) \? curSeason : null/.test(bot));
A("...and passes it to the shared rule", /playing: isPlaying \? new Set\(\[profileId\]\) : new Set\(\),/.test(bot));

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
