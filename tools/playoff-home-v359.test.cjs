/* v3.59: playoff home by game number (NHL 2-2-1-1-1, Q33) and the final seeded by regular-season points
   (Q34); holiday weeks skipped in the playoffs (Q31, book). */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const live = R("src/live/part_live.js");
/* v4.42: the draw moved into the database (public._draw_playoff_round). The home test is read out of its SQL and run. */
const draw = R("sql/2026-11-01-playoff-autopilot-v442.sql");
const hostSql = (draw.match(/if (v_gi < 2 or \(v_gi >= 4 and \(v_gi - 4\) % 2 = 0\)) then v_host := v_hi\[v_i\]; v_away := v_lo\[v_i\];/) || [])[1] || "false";
const hostHigher = vm.runInNewContext("(function(v_gi){ return " + hostSql.replace(/ or /g, " || ").replace(/ and /g, " && ").replace(/ = /g, " === ") + "; })");
const pattern = [0,1,2,3,4,5,6].map((gi) => hostHigher(gi) ? "H" : "L").join("");
A("games 1-7 go H H L L H L H", pattern === "HHLLHLH", pattern);
A("the draw uses it per game", hostSql !== "false" && /while v_kk < v_per_night\[v_ni \+ 1\] and v_gi < v_best loop/.test(draw));
A("the final is ordered by the league-wide table (points, then Rule 8.2)",
  /v_champs := array\(select x\.code from public\.standings_order\(p_season, null\) x where x\.code = any\(v_adv\) order by x\.pos\);/.test(draw) &&
  /v_hi := array\[v_champs\[1\]\]; v_lo := array\[v_champs\[2\]\];/.test(draw) && !/champs\.sort\(bySeed\)/.test(live));
A("the Control Center caption says so", /the higher seed is home for games 1, 2, 5 and 7, the lower seed for games 3, 4 and 6 \(Rule 8\.3\)/.test(live));
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.59");
A("changelog records 3.59", !!e);
A("8.3.1: home by game and the final by points", /Home club for games 1, 2, 5 and 7, and the lower seed for games 3, 4 and 6/.test(secs["8.3"].paragraphs[0]) && /the champion with more regular-season points/.test(secs["8.3"].paragraphs[0]));
A("0.8.1: holidays skipped in the playoffs", /A game-week containing a league-observed holiday is skipped in the postseason as in the regular season/.test(secs["0.8"].paragraphs[0]));
A("no em dashes or spaced hyphens in the 3.59 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
