/* v4.08 (commissioner, 2026-10-14): "Why are Bowman's stats not being tracked", "He also may have played other positions
   so check with that as well.", "Make sure to count every player's stats of every game. Even if they disconnect."
   The site's season totals (CG.aggregate) built one shape per player from his REGISTERED position, so a registered
   goalie's skating lines and a registered skater's goalie lines were lost (NaN), and every per-game rate divided by all
   appearances. This runs the real engine and page helpers on Bowman's and Easy pickins' real lines.
   Run: node tools/two-way-stats-v408.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const eng = R("src/live/part2_engine.js"), pub = R("src/live/part5a_public.js"), pub2 = R("src/live/part5b_public2.js"),
      ui = R("src/live/part4_ui.js"), live = R("src/live/part_live.js");
const grab = (src, fn) => { const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};")); if (!m) throw new Error("no CG." + fn); return m[0]; };

const ctx = { console, Math, Object, Array, String, Number, JSON, Date, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
const TEAMS = ["NYI", "DAL", "SEA", "BOS"].map((code) => ({ code, name: code + " club", color: "#000" }));
ctx.CG = {
  TEAMS, TEAM: Object.fromEntries(TEAMS.map((t) => [t.code, t])), SEASON: { completedWeeks: 4 },
  DEFAULT_WEIGHTS: { skater: { production: 1, efficiency: 1, defense: 1, discipline: 1, form: 1 }, goalie: { saves: 1, workload: 1, wins: 1, discipline: 1 },
    team: { record: 1, goalDiff: 1, goaltending: 1, depth: 1, form: 1 } },
  crest: () => "", fmtToi: (s) => String(Math.round(s)), seasonTag: () => "Season 2", playerRoute: (p) => "#/player/" + p.id,
  playoffMinGp: () => 16,
};
ctx.esc = (s) => String(s);
vm.createContext(ctx);
ctx.CG.playerById = (lg, id) => lg.players.find((p) => p.id === id);
for (const f of ["blankStatLine", "statPlayers", "aggregate", "skaterLeaders", "goalieLeaders", "roleLine", "lineRoles", "offRoleTag"]) vm.runInContext(grab(eng, f), ctx);
for (const f of ["seasonLineText", "profileSeasonHtml", "gameLogTables", "profileStatCells", "statCellsHtml", "scoutLine", "leagueDNA", "formerLeagueHtml", "playoffLine", "playoffCardHtml", "playoffLogHtml"]) vm.runInContext(grab(pub, f), ctx);
vm.runInContext(pub2.slice(pub2.indexOf("CG.TITLE_CARDS = "), pub2.indexOf("CG.loadTitleBoard = function")), ctx);
const CG = ctx.CG;

/* ---- the fixture: real lines ---- */
const players = [
  { id: "bowman", tag: "Bowman", team: "NYI", pos: "G" },
  { id: "easy", tag: "Easy pickins", team: "NYI", pos: "RD" },
  { id: "rob", tag: "Rob", team: "DAL", pos: "G" },          /* registered G: 1 start, 5 skating games */
  { id: "keeper", tag: "Keeper48", team: "BOS", pos: "LW" }, /* registered LW: 0 skating, 1 game in goal */
  { id: "sk", tag: "Pure skater", team: "DAL", pos: "C" },
  { id: "gl", tag: "Pure goalie", team: "SEA", pos: "G" },
];
const former = [{ id: "gone", tag: "Gone goalie", team: "NYI", pos: "G", former: true }];
const S = (g, a, shots, pos) => ({ g, a, shots, pos: pos || "C", pm: 0, hits: 1, blk: 0, gv: 0, tk: 0, pim: 0, fow: 0, fot: 0, gwg: 0 });
const G = (sv, sa, ga, w, l, otl) => ({ goalie: true, pos: "G", sv, sa, ga, w, l, otl, so: 0, qs: (sa ? sv / sa : 1) >= .885 ? 1 : 0 });
let gid = 0;
const results = [];
const game = (week, nyiBox, oppBox, opp) => results.push({ id: "g" + (++gid), week, home: "NYI", away: opp || "DAL", at: gid,
  score: { NYI: 3, [opp || "DAL"]: 2 }, box: { NYI: nyiBox, [opp || "DAL"]: oppBox || {} }, ot: false });
/* Bowman in goal: 24/31 (7 GA, L), 26/29 (3 GA, OTL), 9/15 (6 GA, L, the forfeit), 14/20 (6 GA, L) */
game(1, { bowman: G(24, 31, 7, 0, 1, 0) }); game(1, { bowman: G(26, 29, 3, 0, 0, 1) });
game(2, { bowman: G(9, 15, 6, 0, 1, 0) }); game(4, { bowman: G(14, 20, 6, 0, 1, 0) });
/* Bowman skating: D 0G0A, 0G4A, 0G0A; C 0G2A, 0G3A, 1G3A; 14 shots */
game(3, { bowman: S(0, 0, 2, "D") }); game(3, { bowman: S(0, 4, 3, "D") }); game(3, { bowman: S(0, 0, 1, "D") });
game(4, { bowman: S(0, 2, 2, "C") }); game(4, { bowman: S(0, 3, 3, "C") }); game(4, { bowman: S(1, 3, 3, "C") });
/* Easy pickins: 5 skating (0G 5A), 8 in goal (118 of 178, 60 GA, 3-4-1) */
[1, 1, 1, 1, 1].forEach((a) => game(2, { easy: S(0, a, 1, "D") }));
[[15, 20, 5, 1, 0, 0], [15, 22, 7, 1, 0, 0], [14, 21, 7, 1, 0, 0], [16, 24, 8, 0, 1, 0], [14, 22, 8, 0, 1, 0], [15, 23, 8, 0, 1, 0],
 [14, 22, 8, 0, 1, 0], [15, 24, 9, 0, 0, 1]].forEach((x) => game(3, { easy: G.apply(null, x) }));
/* Rob: 1 start (7 GA on 20), 5 skating games (1G 4A); Keeper48: 1 game in goal */
game(1, {}, { rob: G(13, 20, 7, 0, 1, 0) });
[[1, 0], [0, 1], [0, 1], [0, 1], [0, 1]].forEach((x) => game(2, {}, { rob: S(x[0], x[1], 2, "C") }));
game(2, {}, { keeper: G(14, 20, 6, 0, 1, 0) }, "BOS");
/* pure players, and a goalie no longer rostered with 3 games in goal for NYI */
[[2, 1], [1, 1], [0, 2]].forEach((x) => game(1, {}, { sk: S(x[0], x[1], 4, "C") }));
[[20, 22, 2, 1, 0, 0], [18, 21, 3, 1, 0, 0], [19, 20, 1, 1, 0, 0]].forEach((x) => game(2, {}, { gl: G.apply(null, x) }, "SEA"));
[[20, 25, 5, 1, 0, 0], [21, 24, 3, 1, 0, 0], [22, 25, 3, 0, 1, 0]].forEach((x) => game(1, { gone: G.apply(null, x) }));

const byTeam = {}; TEAMS.forEach((t) => (byTeam[t.code] = players.filter((p) => p.team === t.code)));
const lg = { players, formerPlayers: former, byTeam, results };
CG.aggregate(lg, {});
CG.lg = lg;
const ps = lg.pstats;

console.log("— one shape, every field a number, gp = skating games + games in goal");
{
  const keys = Object.keys(CG.blankStatLine()).filter((k) => !/weekly/.test(k));
  const bad = [];
  CG.statPlayers(lg).forEach((p) => { const s = ps[p.id]; keys.forEach((k) => { if (typeof s[k] !== "number" || Number.isNaN(s[k])) bad.push(p.id + "." + k); }); if (s.gp !== s.sgp + s.gs) bad.push(p.id + ".gp"); });
  A("no missing or NaN field for anyone, and gp === sgp + gs", bad.length === 0, bad.join(", "));
  A("a player no longer rostered has a season line too", ps.gone && ps.gone.gs === 3);
}

console.log("\n— Bowman (registered G): 4 games in goal, 6 skating");
{
  const b = ps.bowman;
  A("10 appearances = 6 skating + 4 in goal", b.gp === 10 && b.sgp === 6 && b.gs === 4, JSON.stringify([b.gp, b.sgp, b.gs]));
  A("skating 1G 12A 13P on 14 shots", b.g === 1 && b.a === 12 && b.p === 13 && b.shots === 14);
  A("in goal 0-3-1, 73 saves on 95, 22 GA", b.w === 0 && b.l === 3 && b.otl === 1 && b.sv === 73 && b.sa === 95 && b.ga === 22);
  const gl = CG.roleLine(b, "G"), sl = CG.roleLine(b, "S");
  A("GAA over his 4 games in goal is 5.50 (it read 2.20 over all 10)", (gl.ga / gl.gp).toFixed(2) === "5.50");
  A("points per game over his 6 skating games is 2.17", (sl.p / sl.gp).toFixed(2) === "2.17");
}

console.log("\n— Easy pickins (registered RD): 5 skating, 8 in goal");
{
  const e = ps.easy;
  A("13 = 5 + 8", e.gp === 13 && e.sgp === 5 && e.gs === 8);
  A("in goal 3-4-1, 118 of 178", e.w === 3 && e.l === 4 && e.otl === 1 && e.sv === 118 && e.sa === 178 && e.ga === 60);
  A("skating 0G 5A, 1.00 points per game (it read 0.38 over 13)", e.g === 0 && e.a === 5 && (CG.roleLine(e, "S").p / CG.roleLine(e, "S").gp).toFixed(2) === "1.00");
}

console.log("\n— leaders admit by the games played in each role");
{
  const sk = CG.skaterLeaders(lg, "p").map((p) => p.id), go = CG.goalieLeaders(lg).map((p) => p.id);
  A("skater boards include Bowman and Rob (registered goalies who skated)", sk.includes("bowman") && sk.includes("rob"));
  A("...and leave out Keeper48, who never skated", !sk.includes("keeper"));
  A("goalie boards include Bowman (4 starts), Easy pickins (8) and the goalie no longer rostered (3)", go.includes("bowman") && go.includes("easy") && go.includes("gone"));
  A("...and leave out Rob and Keeper48 with one start each (the 3-start minimum counts starts, not appearances)", !go.includes("rob") && !go.includes("keeper"));
  A("a ballot list ({current:true}) leaves out players no longer rostered", !CG.goalieLeaders(lg, 3, { current: true }).some((p) => p.id === "gone"));
  A("the pure skater and goalie are unchanged", ps.sk.gp === 3 && ps.sk.sgp === 3 && ps.sk.p === 7 && ps.gl.gs === 3 && ps.gl.sv === 57 && ps.gl.sa === 63);
}

console.log("\n— club totals count every line");
{
  const nyi = lg.teams.NYI;
  const want = ps.bowman.sv + ps.easy.sv + ps.gone.sv, wantA = ps.bowman.sa + ps.easy.sa + ps.gone.sa;
  A("NYI's save percentage comes from every NYI goalie line, a skater in net and a departed goalie included", nyi.gsv === want && nyi.gsa === wantA, nyi.gsv + "/" + nyi.gsa);
  A("shots for count every skating line", lg.teams.DAL.sf === 2 * 5 + 4 * 3);
  /* review, 2026-10-15: the bar used an NHL band (.840 to .940) and read 0 for 7 of 8 real clubs (league .777) */
  let lsv = 0, lsa = 0; TEAMS.forEach((t) => { lsv += lg.teams[t.code].gsv; lsa += lg.teams[t.code].gsa; });
  const wantBar = (t) => { const x = lg.teams[t]; return x.gsa ? Math.round(100 * Math.min(1, Math.max(0, .5 + ((x.gsv + 35 * lsv / lsa) / (x.gsa + 35) - lsv / lsa) / .15))) : 50; };
  A("the goaltending bar measures each club against the league's own save percentage", TEAMS.every((t) => lg.teamRatings[t.code].parts.goaltending === wantBar(t.code)),
    TEAMS.map((t) => t.code + " " + lg.teamRatings[t.code].parts.goaltending + "/" + wantBar(t.code)).join(", "));
  const svp = (t) => lg.teams[t].gsv / Math.max(1, lg.teams[t].gsa), withG = TEAMS.map((t) => t.code).filter((t) => lg.teams[t].gsa);
  const best = withG.slice().sort((x, y) => svp(y) - svp(x))[0], worst = withG.slice().sort((x, y) => svp(x) - svp(y))[0];
  A("...so the best club reads above 50 and the worst below it, and no club sits at 0", lg.teamRatings[best].parts.goaltending > 50 && lg.teamRatings[worst].parts.goaltending < 50 &&
    withG.every((t) => lg.teamRatings[t].parts.goaltending > 0));
}

console.log("\n— the pages");
{
  const bowman = players[0], easy = players[1];
  const html = CG.profileSeasonHtml(ps.bowman, true);
  A("the profile shows an In goal line and a Skating line, in goal first", /In goal · 4 GP[\s\S]*Skating · 6 GP/.test(html));
  A("...each over its own games (GAA 5.50, 13 points)", />5\.50</.test(html) && />13</.test(html));
  A("...with no NaN or undefined", !/NaN|undefined/.test(html));
  A("a one-role player's profile line is a single grid, as before", !/In goal ·|Skating ·/.test(CG.profileSeasonHtml(ps.sk, false)));
  const logT = CG.gameLogTables(lg.glog.bowman, true, { link: true });
  A("the game log splits into an in-goal table and a skating table", logT.length === 2 && logT[0].kind === "G" && logT[0].n === 4 && logT[1].kind === "S" && logT[1].n === 6);
  A("...and no row prints undefined or NaN (skating games printed undefined saves before)", logT.every((t) => !/undefined|NaN/.test(t.rows)));
  A("the club and directory line reads both roles", CG.seasonLineText(ps.bowman, bowman) === "0-3-1 · .768 (4 in goal) · 13 pts · 1G 12A (6 skating)", CG.seasonLineText(ps.bowman, bowman));
  A("...and a skater who played goal reads skating first", /^5 pts · 0G 5A \(5 skating\) · 3-4-1/.test(CG.seasonLineText(ps.easy, easy)));
  A("an older stored season line (no sgp/gs) still reads as before", CG.seasonLineText({ gp: 3, p: 4, g: 2, a: 2 }, { pos: "C" }) === "4 pts · 2G 2A");
  lg.ratings = lg.ratings || {}; lg.ratings.bowman = lg.ratings.bowman || { parts: { defense: 50 } };
  const scout = CG.scoutLine(bowman);
  A("the scouting line counts his starts, not his appearances", /has started 4 of/.test(scout) && /5\.50 goals-against/.test(scout) && /Also skated in 6 games \(1G, 12A\)/.test(scout));
  A("...with no pronoun guessed", !/\bHe has also\b/.test(scout));
  A("off-role tags", CG.offRoleTag(bowman, "S") === "G, skating" && CG.offRoleTag(easy, "G") === "RD, in goal" && CG.offRoleTag(bowman, "G") === "");
  A("lineRoles: registered role first, then the other when played", JSON.stringify(CG.lineRoles(ps.bowman, true)) === '["G","S"]' && JSON.stringify(CG.lineRoles(ps.keeper, false)) === '["G"]');
  /* review, 2026-10-15: a former player's row linked to a page that said "only pickup game stats show here" */
  const fh = CG.formerLeagueHtml("gone");
  A("a player no longer rostered: his profile shows the league season line and the game log", /no longer rostered/.test(fh) && /Game log/.test(fh) && />3 GP</.test(fh) && /last played for NYI club/.test(fh));
  A("...with no NaN or undefined", !/NaN|undefined/.test(fh));
  A("...and an account with no league games (or a rostered player, who has the full profile) gets nothing extra", CG.formerLeagueHtml("nobody") === "" && CG.formerLeagueHtml("bowman") === "");
}

console.log("\n— the statistical titles come from the database's one ranking");
{
  CG.SEASON.id = "s2"; CG.sb = {};
  CG.statPlayerById = (lg, id) => lg.players.find((p) => p.id === id) || lg.formerPlayers.find((p) => p.id === id) || null;
  A("before the board arrives, the cards say they are reading the record (no ranking of their own)", /Reading the official record/.test(CG.titleBoardHtml(lg)) && !/leaderrow/.test(CG.titleBoardHtml(lg)));
  CG._titleBoard.s2 = [
    { category: "goaltending_title", place: 1, profile_id: "gone", gamertag: "Gone goalie", gp: 16, total: 40, per_game: 2.5 },
    { category: "points_title", place: 1, profile_id: "sk", gamertag: "Pure skater", gp: 16, total: 40, per_game: 2.5 },
    { category: "points_title", place: 2, profile_id: "x9", gamertag: "Unknown", gp: 16, total: 30, per_game: 1.875 }];
  lg.seasonAwards = [{ category: "points_title", profile_id: "sk" }];
  const tb = CG.titleBoardHtml(lg);
  A("the board renders the database's order and figures", /Pure skater[\s\S]*16 GP skating[\s\S]*2\.50[\s\S]*Unknown[\s\S]*1\.88/.test(tb));
  A("...a former player is marked, with his games in goal", /Gone goalie[\s\S]*16 GP in goal · no longer rostered/.test(tb));
  A("...a filed title says Decided", /Scoring Title<\/h3><span class="chip chip-win">Decided/.test(tb));
  A("...an empty category says nobody has reached the floor", /Nobody has reached 16 games at the position yet/.test(tb));
  A("...and nothing is undefined or NaN", !/undefined|NaN/.test(tb));
  lg.seasonAwards = [];
}

console.log("\n— the readers use role games, never registered position");
A("Stat central: skaters, advanced and goalies by role games and role lines",
  /* v4.09: the tables read SL, the league or its playoff view, through the same role-game filters */
  /CG\.statPlayers\(SL\)\.filter\(function\(p\)\{ var s0 = SL\.pstats\[p\.id\]; return s0 && skatedOrSkater\(p, s0\) && s0\.sgp>=minGp/.test(pub) &&
  /var s=CG\.roleLine\(SL\.pstats\[p\.id\], "S"\);/.test(pub) && /var s=CG\.roleLine\(SL\.pstats\[p\.id\], "G"\); var svp/.test(pub));
A("no stats tab filters on registered position any more", !/lg\.players\.filter\(function\(p\)\{ return p\.pos!=="G" && lg\.pstats\[p\.id\]\.gp>=minGp/.test(pub) && !/return p\.pos==="G" && lg\.pstats\[p\.id\]\.gp>=Math\.min\(minGp,3\)/.test(pub));
A("the ticker's GAA divides by games in goal", /ps\[gaaL\.id\]\.ga\/ps\[gaaL\.id\]\.gs/.test(ui) && !/ps\[a\.id\]\.ga\/ps\[a\.id\]\.gp/.test(ui));
A("the awards page reads the title leaders from the database and ranks nothing itself", /CG\.sb\.rpc\("statistical_title_board", \{ p_season: sid, p_top: 3 \}\)/.test(pub2) &&
  /if \(document\.getElementById\("titleBoard"\)\) CG\.loadTitleBoard\(\);/.test(pub2) && !/roleGp|eligibleNow|floorOf/.test(pub2));
A("a decided title can go to a player no longer rostered (statPlayerById)", /decided\.map\(function\(a\)\{ var p = CG\.statPlayerById\(lg, a\.profile_id\);/.test(pub2));
A("Players to watch keeps the club's skaters before they have played, plus a goalie who skated",
  /return p\.pos!=="G" \|\| \(!pre && \(\(lg\.pstats\[p\.id\]\|\|\{\}\)\.sgp\|\|0\) > 0\);/.test(pub2));
A("a former player's box-score line wears the crest of the club he played that game for", /fp && Object\.assign\(\{\}, fp, \{ team: code \}\)/.test(pub2));
A("the directory reads a former player's games instead of printing 0", /var us = lg\.pstats\[u\.id\], ugp = \(us && us\.gp\) \|\| 0;/.test(pub) && !/<td class="tnum">0<\/td><td class="tleft tnum" style="font-size:12px">—<\/td>/.test(pub));
A("the account page's caption has no dash, and names the record for a former player", /No longer on a league roster\. This season(’|\\u2019)s league games stay in the official record \(Rule 6\.1\)\./.test(pub) && !/isn’t on a league roster —/.test(pub));
/* v4.09: the step moved into the engine (CG.addEaMetrics), which the live build calls for each line */
A("ice time is split by role", /s\.gToi = \(s\.gToi\|\|0\)/.test(eng) && /s\.skToi = \(s\.skToi\|\|0\)/.test(eng) && /CG\.addEaMetrics\(lg, lg\.pstats, regResults, gameStatsRows, lg\.posSplitRows\);/.test(live));
A("players no longer rostered are kept apart from lg.players", /formerPlayers:formerPlayers/.test(live) && /CG\.statPlayers = function\(lg\)\{ return \(lg\.players\|\|\[\]\)\.concat\(lg\.formerPlayers\|\|\[\]\); \};/.test(eng));
A("the provisional draft row uses the one shape", /lg\.pstats\[row\.player_id\] = CG\.blankStatLine\(\);/.test(live));

console.log("\n— the record, the rulebook and the changelog");
{
  const sql = R("sql/2026-10-15-two-way-stats-v408.sql");
  A("statistical_titles needs the floor at the title's position", /and c\.gp >= greatest\(1, public\.player_playoff_floor\(p_season, c\.profile_id\)\)\)/.test(sql));
  /* Part 4: one definition. The board ranks, statistical_titles files its place 1, the page reads it */
  const p4 = sql.slice(sql.indexOf("-- Part 4 (migration v408c_title_board)"));
  A("the title board: every line counts (no ice-time filter), the floor at the position, eligibility once per player",
    /from lines l where not l\.g group by l\.profile_id/.test(p4) && /from lines l where l\.g group by l\.profile_id/.test(p4) && !/toi/.test(p4.slice(p4.indexOf("create or replace"))) &&
    /public\.award_eligible\(p_season, x\.profile_id\) ok/.test(p4) && /where w\.ok and c\.gp >= w\.fl/.test(p4));
  A("...a tie at the same rate goes to more games at the position, as Rule 9.2 says", /order by case when c\.high then -c\.pg else c\.pg end, -c\.gp, pr\.gamertag, c\.profile_id/.test(p4));
  A("...statistical_titles is the board's place 1", /from public\.statistical_title_board\(p_season, 1\) b/.test(p4));
  A("...readable by the site, granted explicitly", /revoke all on function public\.statistical_title_board\(uuid, int\) from public;/.test(p4) &&
    /grant execute on function public\.statistical_title_board\(uuid, int\) to anon, authenticated, service_role;/.test(p4) &&
    /'statistical_title_board'\]\) c\(name\)/.test(R("tools/sql/grant-audit.sql")));
  /* Part 3: lines credited to nobody relink themselves; a played box score is never erased; one credit per game */
  A("an unlinked line relinks under the four-way check: one candidate, the line's club, same position group (camp anywhere), one credit per game",
    /continue when v_cands <> 1;/.test(sql) && /rs\.team_id = r\.team_id/.test(sql) && /coalesce\(v_squad, ''\) <> 'tc' and v_grp <> v_rowgrp/.test(sql) &&
    /x\.game_id = r\.game_id and x\.profile_id = p_profile/.test(sql));
  A("...matching with lower() equality, never ilike", !/ilike/i.test(sql.slice(sql.indexOf("create or replace function public._relink_member_lines"))));
  A("...when a member's EA identity changes, and every 15 minutes", /after update of ea_id, platform_gamertag, gamertag, ea_player_id on public\.profiles/.test(sql) &&
    /after insert or update of ea_id, platform_gamertag on public\.season_registrations/.test(sql) && /cron\.schedule\('relink-unlinked-lines', '\*\/15 \* \* \* \*'/.test(sql));
  A("...a failed relink never fails the member's save and is recorded, not swallowed", /box_relink_failed/.test(sql));
  A("the no-show forfeit refuses a played game instead of deleting its box score",
    /This game was played and its box score is in\. A forfeit here keeps the played statistics/.test(sql) && /noshow_forfeit/.test(sql) && /kept_result_forfeit/.test(sql));
  A("one credit per game is enforced by the database", /create unique index if not exists game_stats_one_credit_per_game on public\.game_stats \(game_id, profile_id\) where profile_id is not null;/.test(sql));
  A("the internal relink functions are not callable by members", /revoke execute on function public\._relink_member_lines\(uuid, text\) from public, anon, authenticated;/.test(sql) && /revoke execute on function public\._relink_all_unlinked\(\) from public, anon, authenticated;/.test(sql));
  const C = {}; new Function("CG", R("src/live/part3_content.js"))(C);
  const rb = C.CONTENT.rulebook;
  const sec = (id) => { for (const ch of rb.chapters) for (const s of (ch.sections || [])) if (s.id === id) return s; };
  A("Rule 6.1 keeps two lines for a two-way player and counts a disconnected line", /two season lines, one from the games skated and one from the games played in goal/.test(sec("6.1").paragraphs[1]) && /including a line cut short by a disconnection/.test(sec("6.1").paragraphs[1]));
  A("Rule 9.2 requires the floor at the title's position", /games-played floor of Rule 8\.3 that applies to the player at the title's position/.test(sec("9.2").paragraphs[1]));
  A("...and breaks a tie at the same rate toward more games at that position", /A tie at the same rate goes to the player with more games played at that position\./.test(sec("9.2").paragraphs[1]) &&
    !/A tie goes to the higher total/.test(sec("9.2").paragraphs[1]));
  /* by version, never by position: a later release takes changelog[0] */
  const e408 = rb.changelog.find((c) => c.version === "4.08");
  A("the changelog has its 4.08 entry", !!e408);
  A("...with no em dashes", !/—/.test(JSON.stringify(e408)));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
