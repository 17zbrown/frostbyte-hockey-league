/* v4.45 (commissioner, 2026-11-04): asked whether to fix the team shot numbers, "fix them"; asked whether to fix them on the real
   site too, "yes". A club's shots were its skaters' lines added up, about 11% below EA's own club count, and its shots per game
   divided by games that had no shots in them. This pins the SQL record, the importer's five writers and its merge, the site's load,
   and runs the real CG.aggregate on fixtures.
   Run: node tools/club-shots-v445.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got))); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-11-04-club-shots-v445.sql"), ing = R("netlify/functions/ingest-stats.js"), live = R("src/live/part_live.js"),
      eng = R("src/live/part2_engine.js"), pub = R("src/live/part5a_public.js"), content = R("src/live/part3_content.js");
const count = (s, needle) => s.split(needle).length - 1;

console.log("— the database record");
A("two nullable integer columns", /add column if not exists home_shots integer/.test(sql) && /add column if not exists away_shots integer/.test(sql));
A("SELECT on games is granted column by column, so the new columns carry their own grant", /grant select \(home_shots, away_shots\) on public\.games to anon, authenticated;/.test(sql));
A("no lobby column is granted", !/grant select[^;]*(game_code|server)/.test(sql));
A("re-opening a final clears the counts with the result", /v_a \|\| ' home_shots=null, away_shots=null/.test(sql));
A("a no-show forfeit has no shots", /home_shots = null, away_shots = null,/.test(sql));
A("both patches anchor on the exact text and assert one match", count(sql, "if v_n <> 1 then raise exception") === 2);
A("the backfill leaves struck sittings out", /l\.status in \('ingested', 'merged', 'incomplete'\)/.test(sql) && !/'struck'\)/.test(sql));
A("the backfill matches a club by its players' EA ids, so a Rule 4.6 game lands on the right club", /gs\.ea_player_id = pid/.test(sql) && !/ea_club_id/.test(sql.replace(/^--.*$/gm, "")));
A("the backfill writes only the two columns", /set home_shots = h\.shots, away_shots = w\.shots\n/.test(sql));
A("self-checks raise when a game with a box score has no count, or one without has one", /games with a box score have no club shots/.test(sql) && /games with no box score have club shots/.test(sql));
A("the voided goals' shots stay out: part b lowers the two 2026-10-21 games, guarded on their values", /id = '7dbccaf8-63fb-4189-8d33-02a3b00d5d26' and home_shots = 23 and away_shots = 20/.test(sql) && /id = '81a06b51-9718-40eb-a84c-f6f5e624e947' and home_shots = 29 and away_shots = 24/.test(sql) && /the games do not hold 7,124 shots/.test(sql));
A("the rehearsal and the grant audit are recorded", /REHEARSAL OK: T0/.test(sql) && /Applied as migration v445_club_shots; tools\/sql\/grant-audit\.sql returned zero rows\./.test(sql));

console.log("\n— the importer keeps EA's count on every path");
A("normalizeMatch reads the club's shots, null when EA sends none", /shots: c\.shots != null && c\.shots !== "" \? \+c\.shots : null/.test(ing));
A("a merged game adds its sittings, and one missing count leaves it null", /shots: parts\.some\(\(x\) => x\.shots == null\) \? null : parts\.reduce\(\(a, x\) => a \+ x\.shots, 0\)/.test(ing));
A("every writer of the power-play columns also writes the shots", count(ing, "home_ppg:") === count(ing, "home_shots:") && count(ing, "home_shots:") === 7, [count(ing, "home_ppg:"), count(ing, "home_shots:")]);
A("the restart path carries them through its shared fields", /const ppgR = \{[^}]*home_shots: hC\.shots, away_shots: aC\.shots \}/.test(ing));

/* the real normalizeMatch and mergeSegments */
const fn = (name) => { const i = ing.indexOf("function " + name + "("); return ing.slice(i, ing.indexOf("\n}\n", i) + 2); };
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const lib = new Function("etFmt", "const etDayUnix = (s) => etFmt.format(new Date(s * 1000));\n" + fn("mapPos") + fn("normalizeMatch") + fn("mergeSegments") + "\nreturn { normalizeMatch, mergeSegments };")(etFmt);
const raw = (id, s10, s20) => ({ matchId: id, timestamp: 1760576000, clubs: { 10: { score: "1", shots: s10, ppg: "0", ppo: "0", result: "1", details: { name: "A" } }, 20: { score: "0", shots: s20, ppg: "0", ppo: "0", result: "2", details: { name: "B" } } },
  players: { 10: { 1: { playername: "a", position: "center", skgoals: "1", skshots: "3", toiseconds: "1200" } }, 20: { 2: { playername: "b", position: "center", skshots: "2", toiseconds: "1200" } } } });
const one = lib.normalizeMatch(raw("m1", "12", "7"));
A("the club's count comes through, not its players' shots", one.clubs[0].shots === 12 && one.clubs[1].shots === 7, one.clubs.map((c) => c.shots));
const missing = raw("m2", "12", "7"); delete missing.clubs[10].shots;
A("EA sending none is null, never zero", lib.normalizeMatch(missing).clubs[0].shots === null);
const two = lib.mergeSegments([one, lib.normalizeMatch(raw("m3", "9", "4"))]), byId = (c) => two.clubs.find((x) => x.ea_club_id === c);
A("a merged game adds both sittings", byId("10").shots === 21 && byId("20").shots === 11, two.clubs.map((c) => c.shots));
const gap = lib.mergeSegments([one, lib.normalizeMatch(missing)]);
A("a sitting with no count leaves the merged game null, so the site adds up the lines", gap.clubs.find((x) => x.ea_club_id === "10").shots === null);

console.log("\n— the site loads the counts");
A("the boot query selects them", /home_ppg,home_ppo,away_ppg,away_ppo,home_shots,away_shots,stage,/.test(live));
A("a result carries them keyed by club code, as its box score is", /shots\[g\.home\]=g\.homeShots; shots\[g\.away\]=g\.awayShots;/.test(live) && /score:score, box:box, shots:shots,/.test(live));
A("the load test mirrors the query", count(R("tools/loadtest.mjs"), "home_shots,away_shots") === 2);

console.log("\n— the real CG.aggregate");
const grab = (src, fn) => { const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};")); if (!m) throw new Error("no CG." + fn); return m[0]; };
const TEAMS = ["AAA", "BBB", "CCC"].map((code) => ({ code, name: code, color: "#000" }));
const ctx = { console, Math, Object, Array, String, Number, JSON, Date, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.CG = { TEAMS, TEAM: Object.fromEntries(TEAMS.map((t) => [t.code, t])), SEASON: { completedWeeks: 2 },
  DEFAULT_WEIGHTS: { skater: { production: 1, efficiency: 1, defense: 1, discipline: 1, form: 1 }, goalie: { saves: 1, workload: 1, wins: 1, discipline: 1 }, team: { record: 1, goalDiff: 1, goaltending: 1, depth: 1, form: 1 } } };
vm.createContext(ctx);
for (const f of ["boxLines", "boxPut", "blankStatLine", "statPlayers", "addStatLine", "aggregate"]) vm.runInContext(grab(eng, f), ctx);
const CG = ctx.CG, sk = (shots) => ({ g: 0, a: 0, shots, hits: 0, blk: 0, pim: 0, pm: 0, toi: 0 }), gl = () => ({ goalie: true, sv: 5, sa: 6, ga: 1, w: 0, l: 0, otl: 0, so: 0, qs: 0 });
const game = (id, home, away, hs, as, box, shots, forfeit) => ({ id, week: 1, stage: "regular", home, away, at: 1, ot: false, score: { [home]: hs, [away]: as }, box, shots, stars: [], entered: true, forfeit: forfeit || null });
const lg = { players: [], byTeam: { AAA: [], BBB: [], CCC: [] }, schedule: [], results: [
  /* EA's count stands above the lines: 30 and 18 against lines of 3 and 2 */
  game("g1", "AAA", "BBB", 4, 2, { AAA: { x: sk(3), gx: gl() }, BBB: { y: sk(2), gy: gl() } }, { AAA: 30, BBB: 18 }),
  /* a hand-filed box score has no count: the skating lines stand in, and the goalie line does not count as a shot */
  game("g2", "AAA", "CCC", 1, 3, { AAA: { x: sk(5), gx: gl() }, CCC: { z: sk(7), gz: gl() } }, { AAA: null, CCC: null }),
  /* a no-show forfeit: a 1-0 score, no ice, no shots */
  game("g3", "AAA", "BBB", 1, 0, { AAA: {}, BBB: {} }, { AAA: null, BBB: null }, "BBB"),
  /* a result with no shots field at all, as a stored or simulated season has */
  game("g4", "BBB", "CCC", 2, 1, { BBB: { y: sk(4) }, CCC: { z: sk(6) } }, undefined),
] };
CG.aggregate(lg, {});
const T = lg.teams;
A("shots for use EA's count, then the lines where a game has none", T.AAA.sf === 30 + 5, T.AAA.sf);
A("shots against are the other club's count", T.AAA.sa === 18 + 7, T.AAA.sa);
A("a no-show forfeit is no game in the shot figures", T.AAA.sgp === 2 && T.AAA.gp === 3, [T.AAA.sgp, T.AAA.gp]);
A("its forfeit goal is not a goal scored on a shot", T.AAA.sgf === 5 && T.AAA.gf === 6, [T.AAA.sgf, T.AAA.gf]);
A("the forfeiting club is not charged the game either", T.BBB.sgp === 2 && T.BBB.gp === 3, [T.BBB.sgp, T.BBB.gp]);
A("a result with no shots field still adds up its lines", T.BBB.sf === 18 + 4 && T.CCC.sa === 5 + 4 && T.CCC.sf === 7 + 6, [T.BBB.sf, T.CCC.sa, T.CCC.sf]);
A("the goalie lines still make the club's save percentage", T.AAA.gsv === 10 && T.AAA.gsa === 12, [T.AAA.gsv, T.AAA.gsa]);

console.log("\n— the pages");
A("Stat Central divides by the games with a shot count", /'<td data-v="'\+\(r\.sf\/sgp\)\.toFixed\(1\)/.test(pub) && /\(r\.sa\/sgp\)\.toFixed\(1\)/.test(pub) && !/\(r\.sf\/gp\)/.test(pub));
A("S% uses the goals in those games", /100\*sgf\/r\.sf/.test(pub) && !/100\*r\.gf\/r\.sf/.test(pub));
A("the club page's tiles use the same base", /\(s\.sf\/_sgp\)/.test(pub) && /\(s\.sa\/_sgp\)/.test(pub) && !/\(s\.sf\/_gp\)/.test(pub));
A("GF/GP keeps every game (a forfeit's goal stands in the standings)", /\(r\.gf\/gp\)\.toFixed\(2\)/.test(pub));
A("a season stored before this keeps working", /s\.sgp != null \? s\.sgp : s\.gp/.test(pub) && /r\.sgp != null \? r\.sgp : r\.gp/.test(pub));
A("the definitions say what the numbers are", /A club’s S\/GP and SA\/GP are EA’s own club shot count per game with a box score/.test(pub));
A("the old line sum and its second pass are gone", !/else t\.sf \+= \(b\.shots\|\|0\)/.test(eng) && !/teams\[code\]\.sa \+= Object\.keys/.test(eng));

console.log("\n— the changelog");
const sb = { CG: {} }; vm.runInNewContext(content, sb);
const entry = sb.CG.CONTENT.rulebook.changelog.find((c) => c.version === "4.45");
A("4.45 has an entry", !!entry);
A("it says what changed for a member", entry && /shot/i.test(entry.summary) && entry.items.length >= 2, entry && entry.summary);
A("no em dashes in it", entry && !/[—–]/.test(JSON.stringify(entry)));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
