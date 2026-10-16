/* v3.94 (2026-10-12): the playoff eligibility floor is prorated for a player first placed after opening night.
   Commissioner: "Are you making sure the late signups are getting the correct amount of prorated games for the minimum
   game requirement to be playoff eligible?"; rulings "Same share as the 16" and "Anyone placed after opening night".
   Rehearsed on production: 133 players keep 16 and 42 are prorated (8 to 15); placed Oct 11 needs 8, or 9 on DAL and
   NYI whose postponed game was still to play. This pins the record, the site and the rule. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-12-prorated-playoff-floor-v394.sql"), live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js"), pub2 = R("src/live/part5b_public2.js");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 240))); } };

console.log("— the definition");
A("first placed = the earliest roster spot this season, current or archived", /select rs\.created_at as t from public\.roster_spots rs/.test(sql) && /select r\.spot_created_at from public\.roster_spot_removals r/.test(sql));
A("placed by the first regular-season puck drop: the full floor", /if v_open is null or v_joined is null or v_joined <= v_open then return v_floor; end if;/.test(sql));
A("otherwise the floor times the share of his club's games still to play, rounded up, never above the floor", /count\(\*\) filter \(where g\.scheduled_at >= v_joined\)/.test(sql) && /return least\(v_floor, ceil\(v_floor::numeric \* v_left \/ v_total\)::int\);/.test(sql));
A("the playoff lineup gate and award eligibility read it", /public\.player_playoff_floor\(v_game\.season_id, v_p\) > 0/.test(sql) && /public\.regular_gp\(p_season, p_profile\) >= public\.player_playoff_floor\(p_season, p_profile\)/.test(sql));
A("read-only and public (no PUBLIC default; anon and authenticated)", /revoke execute on function public\.playoff_floors\(uuid\) from public;/.test(sql) && /grant execute on function public\.playoff_floors\(uuid\) to anon, authenticated;/.test(sql));

console.log("— the site");
/* v4.12: read by key (tools/keyset-paging-v412.test.cjs) */
A("floors load for everyone with the season extras", /CG\.sbAllRpc\("playoff_floors", \{ p_season: CG\.SEASON\.id \}, "profile_id"\)/.test(live));
/* v4.08: the awards page no longer ranks the titles itself; it reads public.statistical_title_board, whose floor is
   public.player_playoff_floor (the same prorated number) */
A("Road to 16, the hub card and the awards page read each player's own number", /var min = CG\.playoffFloorFor\(pl\.id\);/.test(live) && /myMin = CG\.playoffFloorFor\(me\.id\)/.test(hub) &&
  /CG\.sb\.rpc\("statistical_title_board"/.test(pub2) && /greatest\(1, public\.player_playoff_floor\(p_season, x\.profile_id\)\) fl/.test(fs.readFileSync(path.join(__dirname, "..", "sql/2026-10-15-two-way-stats-v408.sql"), "utf8")));
const fnSrc = (name) => { const i = live.indexOf("CG." + name + " = function"); return live.slice(i, live.indexOf("\n};", i) + 3); };
const ctx = { CG: { lg: { playoffFloors: { late: 8 } } } };
ctx.CG.playoffMinGp = () => 16;
vm.createContext(ctx); vm.runInContext(fnSrc("playoffFloorFor"), ctx);
A("CG.playoffFloorFor: a prorated player's number, the season's floor otherwise", ctx.CG.playoffFloorFor("late") === 8 && ctx.CG.playoffFloorFor("other") === 16);
A("reachability counts what he can still play within his weekly limit", /canPlay \+= Math\.max\(0, Math\.min\(weeks\[w\]\.length, cap - used\)\);/.test(live) && /reachable:need <= canPlay/.test(live));

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook;
let r83 = ""; for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === "8.3") r83 = s.paragraphs[3];
/* v4.00: the share now rounds to the nearest game, .4 or less down (tools/floor-rounding-v400.test.cjs) */
A("Rule 8.3 states the proration and the keep-your-first-date clause", /needs the same share of that figure as the share of that club's regular-season games still to be played when the player was first placed\. The result is rounded to the nearest game/.test(r83) && /keeps the date on which they were first placed/.test(r83));
const cl = rb.changelog.find((c) => c.version === "3.94");
A("changelog 3.94 says what changed", !!cl && /prorated/.test(cl.summary));
A("no em dash in what v3.94 wrote", !/—/.test(JSON.stringify(cl)) && !/—/.test(sql) && !/—/.test(r83.slice(r83.indexOf("A player first placed"))));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
