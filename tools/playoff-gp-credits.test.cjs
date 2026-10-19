/* 2026-10-19: league office games-played credits toward the playoff floor (Rule 8.3). A credit is added by
   public.regular_gp, the one count the playoff lineup gate, award eligibility and the waiver minimum read, and reaches the
   site through playoff_floors, so Team HQ's Road card and a player's eligibility card count it too. It adds no
   statistics: season lines and Stat Central keep games played.
   The SQL ran as a rolled-back rehearsal on production before it was applied (results recorded in the SQL file).
   Run: node tools/playoff-gp-credits.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js");
const sql = R("sql/2026-10-19-playoff-gp-credits.sql");
const body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const grab = (src, fn) => { const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};")); if (!m) throw new Error("no CG." + fn); return m[0]; };

console.log("# the database");
A("gp_credits: RLS on and no API role can reach it", /alter table public\.gp_credits enable row level security;/.test(body) &&
  /revoke all on public\.gp_credits from public, anon, authenticated;/.test(body) && !/create policy[^;]*gp_credits/i.test(body) && !/grant [^;]* on public\.gp_credits/i.test(body));
A("...a credit is at least one game and carries a reason", /games\s+int\s+not null check \(games between 1 and 82\)/.test(body) && /reason\s+text not null check \(length\(btrim\(reason\)\) > 0\)/.test(body));
A("regular_gp adds the credits to the games played", /function public\.regular_gp[\s\S]*count\(distinct g\.id\)[\s\S]*\+ coalesce\(\(select sum\(c\.games\)::int from public\.gp_credits c/.test(body));
A("playoff_floors carries each player's credit, and keeps its grants", /returns table\(profile_id uuid, floor integer, credit integer\)/.test(body) &&
  /grant execute on function public\.playoff_floors\(uuid\) to anon, authenticated, service_role;/.test(body));
A("the rehearsal is recorded", /Result: REHEARSAL OK: T1 T2 T3 T4 T5\./.test(sql));
A("the grant audit checks playoff_floors keeps its grant", /'career_games_played','playoff_floors','can_see_match'/.test(R("tools/sql/grant-audit.sql")));

/* ---- the Road card, run for real ---- */
const ctx = { console, Math, Object, Array, String, Number, JSON };
vm.createContext(ctx);
ctx.CG = { playoffMinGp: () => 16, weeklyCap: () => 6, weekUsedFor: () => 0 };
for (const f of ["playoffFloorFor", "floorGp", "limitWeekOf", "playoffRoad"]) vm.runInContext(grab(live, f), ctx);
const CG = ctx.CG;
const players = [{ id: "g1", tag: "Credited goalie", pos: "G", spotId: "a" }, { id: "g2", tag: "Other goalie", pos: "G", spotId: "b" }];
const schedule = [];
[5, 6].forEach((week) => { for (let i = 0; i < 9; i++) schedule.push({ stage: "regular", status: "scheduled", week, home: "VAN", away: "SEA" }); });
const lg = { byTeam: { VAN: players }, schedule, pstats: { g1: { gp: 3 }, g2: { gp: 3 } }, playoffFloors: { g1: 16, g2: 16 }, gpCredits: { g1: 1 } };
CG.lg = lg;

console.log("\n# Team HQ counts the credit toward the floor");
{
  const road = CG.playoffRoad(lg, "VAN"), g1 = road.find((r) => r.pid === "g1"), g2 = road.find((r) => r.pid === "g2");
  A("3 played plus a one-game credit reads 4 of 16, needs 12", g1.gp === 4 && g1.min === 16 && g1.need === 12, JSON.stringify(g1));
  A("...which 18 games left at 6 a week can still reach", g1.canPlay === 12 && g1.reachable === true);
  A("without a credit, 3 of 16 is out of reach (needs 13, can play 12)", g2.gp === 3 && g2.need === 13 && g2.reachable === false, JSON.stringify(g2));
  A("the season line keeps the games played", lg.pstats.g1.gp === 3);
  A("no credits loaded yet: games played alone", CG.floorGp({ pstats: { x: { gp: 5 } } }, "x") === 5);
  A("a credit with no season line yet still counts, never NaN", CG.floorGp({ pstats: {}, gpCredits: { x: 1 } }, "x") === 1 && CG.floorGp(null, "x") === 0);
}

console.log("\n# the site reads the credit everywhere the floor is shown");
A("playoff_floors loads each player's credit into lg.gpCredits", /if \(x\.credit\) c\[x\.profile_id\] = x\.credit; \}\); CG\.lg\.playoffFloors = m; CG\.lg\.gpCredits = c;/.test(live));
A("...and a refetch carries it over", /"playoffFloors","gpCredits"/.test(live));
A("management loads the floors with its data, and a signed-in player loads them too (the eligibility card reads them)",
  /jobs\.push\(CG\.loadPlayoffFloors\(\)\);/.test(live) &&
  /if \(CG\.auth\.user && CG\.auth\.role !== "mgmt" && CG\.auth\.role !== "commish" && CG\.auth\.role !== "staff"\)\{\s+CG\.loadPlayoffFloors\(\)/.test(live) &&
  (live.match(/sbAllRpc\("playoff_floors"/g) || []).length === 1);
A("the player's own eligibility card counts it", /var myGp = CG\.floorGp\(lg, me\.id\), myMin = CG\.playoffFloorFor\(me\.id\)/.test(hub));
A("the Road card counts it", /var gp = CG\.floorGp\(lg, pl\.id\), need = Math\.max\(0, min - gp\);/.test(live));

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
