/* v4.13 (commissioner, 2026-10-15): "Split traded players' stats by club" and "But still show all the full season stats
   on their main page but in their history tab it should show per team they have played with."
   This runs the real engine (CG.aggregate, CG.addEaMetrics) and the real profile helpers on a fixture shaped like the live
   movers: a two-way player traded mid-season (SqurlyDanNit: UTA 3 skating, then PIT 3 skating and 2 in goal), a goalie
   whose every start was for the club he left (Kolosov: 3 starts for UTA, now on SEA), a player no longer rostered who
   played for two clubs (.-ZaZa: PIT then UTA), and a pure player who never moved.
   Run: node tools/club-split-v413.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const eng = R("src/live/part2_engine.js"), pub = R("src/live/part5a_public.js"), pub2 = R("src/live/part5b_public2.js"),
      live = R("src/live/part_live.js"), head = R("src/live/part1_head.html");
const grab = (src, fn) => { const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};")); if (!m) throw new Error("no CG." + fn); return m[0]; };

const ctx = { console, Math, Object, Array, String, Number, JSON, Date, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
const TEAMS = ["UTA", "PIT", "SEA", "DAL"].map((code) => ({ code, name: { UTA: "Mammoth", PIT: "Penguins", SEA: "Kraken", DAL: "Stars" }[code], color: "#000" }));
ctx.CG = {
  TEAMS, TEAM: Object.fromEntries(TEAMS.map((t) => [t.code, t])), SEASON: { completedWeeks: 4, number: 1 },
  DEFAULT_WEIGHTS: { skater: { production: 1, efficiency: 1, defense: 1, discipline: 1, form: 1 }, goalie: { saves: 1, workload: 1, wins: 1, discipline: 1 },
    team: { record: 1, goalDiff: 1, goaltending: 1, depth: 1, form: 1 } },
  crest: (c) => "[" + c + "]", seasonTag: () => "Season 1", playerRoute: (p) => "#/player/" + p.id,
  fmtToi: (sec) => { sec = Math.round(sec); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); },
};
ctx.esc = (s) => String(s);
vm.createContext(ctx);
for (const f of ["boxLines", "boxPut", "glogGames", "boxStarText", "blankStatLine", "statPlayers", "statPlayerById", "addStatLine", "clubLine", "clubsPlayed", "clubStatPlayers", "aggregate",
                 "addEaRow", "addEaMetrics", "playerById", "potwPicks", "roleLine", "lineRoles"]) vm.runInContext(grab(eng, f), ctx);
for (const f of ["profileSeasonHtml", "profileStatCells", "statCellsHtml", "gameLogTables", "clubHistoryHtml", "scoutLine", "seasonLineText"]) vm.runInContext(grab(pub, f), ctx);
const CG = ctx.CG;

/* ---- the fixture ---- */
const players = [
  { id: "squrly", tag: "SqurlyDanNit", team: "PIT", pos: "C" },
  { id: "kolo", tag: "Kolosov", team: "SEA", pos: "G" },
  { id: "pure", tag: "Stays put", team: "PIT", pos: "C" },
];
const former = [{ id: "zaza", tag: ".-ZaZa", team: "UTA", pos: "LD", former: true }];
const S = (g, a, shots) => ({ g, a, shots, pos: "C", pm: 1, hits: 2, blk: 1, gv: 0, tk: 1, pim: 0, fow: 0, fot: 0, gwg: 0 });
const G = (sv, sa, ga, w, l, otl) => ({ goalie: true, pos: "G", sv, sa, ga, w, l, otl, so: ga ? 0 : 1, qs: (sa ? sv / sa : 1) >= .885 ? 1 : 0 });
const results = [];
let k = 0;
const game = (week, home, away, homeBox, awayBox) => {
  const id = "g" + (++k);
  results.push({ id, week, home, away, at: 1000 * k, score: { [home]: 3, [away]: 2 }, box: { [home]: homeBox || {}, [away]: awayBox || {} }, ot: false, stars: [] });
  return id;
};
/* weeks 1 and 2: Squrly and Kolosov for Utah, ZaZa for Pittsburgh */
game(1, "UTA", "DAL", { squrly: S(0, 3, 2), kolo: G(20, 23, 3, 1, 0, 0) });
game(1, "PIT", "SEA", { zaza: S(1, 0, 3), pure: S(1, 1, 4) });
game(2, "UTA", "SEA", { squrly: S(0, 2, 1), kolo: G(18, 22, 4, 1, 0, 0) });
game(2, "PIT", "DAL", { zaza: S(0, 1, 1), pure: S(0, 2, 2) });
game(2, "DAL", "UTA", {}, { squrly: S(0, 2, 2), kolo: G(25, 27, 2, 1, 0, 0) });
/* weeks 3 and 4: Squrly traded to Pittsburgh (skates 3, plays goal 2), ZaZa claimed by Utah, Kolosov traded to Seattle and not played */
game(3, "PIT", "UTA", { squrly: S(2, 1, 4) }, { zaza: S(0, 0, 1) });
game(3, "SEA", "PIT", {}, { squrly: S(1, 2, 3) });
const g8 = game(3, "PIT", "DAL", { squrly: S(1, 3, 3) });   /* all three of his Penguins skating games in week 3, as live */
game(4, "DAL", "PIT", {}, { squrly: G(19, 21, 2, 1, 0, 0) });
game(4, "PIT", "SEA", { squrly: G(13, 16, 3, 0, 1, 0) });
const byTeam = {}; TEAMS.forEach((t) => (byTeam[t.code] = players.filter((p) => p.team === t.code)));
const lg = { players, formerPlayers: former, byTeam, results };
CG.aggregate(lg, {});
CG.lg = lg;
const ps = lg.pstats;

console.log("— every line goes to the season line AND to the line for the club it was recorded for");
{
  const keys = Object.keys(CG.blankStatLine()).filter((x) => !/weekly/.test(x));
  const bad = [];
  CG.statPlayers(lg).forEach((p) => {
    const s = ps[p.id], bc = s.byClub || {};
    keys.forEach((key) => { const sum = Object.keys(bc).reduce((a, c) => a + bc[c][key], 0); if (sum !== s[key]) bad.push(p.id + "." + key + " " + sum + "/" + s[key]); });
  });
  A("for every player and every counted field, the club lines add up to the season line", bad.length === 0, bad.join(", "));
  A("SqurlyDanNit: 8 games, UTA 3 skating, PIT 3 skating + 2 in goal", ps.squrly.gp === 8 && ps.squrly.byClub.UTA.sgp === 3 && ps.squrly.byClub.UTA.gs === 0 &&
    ps.squrly.byClub.PIT.sgp === 3 && ps.squrly.byClub.PIT.gs === 2, JSON.stringify(Object.fromEntries(Object.entries(ps.squrly.byClub).map(([c, x]) => [c, [x.sgp, x.gs]]))));
  A("...0G 7A for Utah, 4G 6A for Pittsburgh, 4G 13A in all", ps.squrly.byClub.UTA.g === 0 && ps.squrly.byClub.UTA.a === 7 && ps.squrly.byClub.PIT.g === 4 && ps.squrly.byClub.PIT.a === 6 && ps.squrly.g === 4 && ps.squrly.a === 13);
  A("...and his in-goal record is Pittsburgh's (1-1, 32 of 37)", ps.squrly.byClub.PIT.w === 1 && ps.squrly.byClub.PIT.l === 1 && ps.squrly.byClub.PIT.sv === 32 && ps.squrly.byClub.PIT.sa === 37 && !ps.squrly.byClub.UTA.sa);
  A("Kolosov: all 3 starts for Utah, none for Seattle (his club now)", ps.kolo.byClub.UTA.gs === 3 && !ps.kolo.byClub.SEA && ps.kolo.gs === 3);
  A("a player no longer rostered is split too (ZaZa: PIT 2, UTA 1)", ps.zaza.byClub.PIT.gp === 2 && ps.zaza.byClub.UTA.gp === 1);
  A("a player who never moved has one club line, equal to his season line", Object.keys(ps.pure.byClub).join() === "PIT" && ps.pure.byClub.PIT.p === ps.pure.p && ps.pure.byClub.PIT.gp === ps.pure.gp);
  A("each club line knows its first and last week", ps.squrly.byClub.UTA.wkFirst === 1 && ps.squrly.byClub.UTA.wkLast === 2 && ps.squrly.byClub.PIT.wkFirst === 3 && ps.squrly.byClub.PIT.wkLast === 4);
  A("...and each role's weeks there (review, 2026-10-15: skating week 3, in goal week 4 at Pittsburgh)",
    ps.squrly.byClub.PIT.sWkFirst === 3 && ps.squrly.byClub.PIT.sWkLast === 3 && ps.squrly.byClub.PIT.gWkFirst === 4 && ps.squrly.byClub.PIT.gWkLast === 4 && ps.squrly.byClub.UTA.gWkFirst == null);
  A("CG.clubsPlayed orders the clubs by his first game for each", CG.clubsPlayed(ps.squrly).join() === "UTA,PIT" && CG.clubsPlayed(ps.zaza).join() === "PIT,UTA" && CG.clubsPlayed(undefined).length === 0);
  A("every game log entry names the club it was played for", lg.glog.squrly.every((e) => e.team === (e.game < "g6" && e.game.length === 2 ? "UTA" : e.team)) && lg.glog.squrly[0].team === "UTA" && lg.glog.squrly[lg.glog.squrly.length - 1].team === "PIT");
}

console.log("\n— a game played in both roles (v4.11) is one game for its club too");
{
  const one = { players: [{ id: "two", tag: "Two roles", team: "PIT", pos: "C" }], formerPlayers: [], byTeam: { UTA: [], PIT: [], SEA: [], DAL: [] }, results: [] };
  one.byTeam.PIT = one.players;
  const box = { PIT: {}, DAL: {} };
  CG.boxPut(box.PIT, "two", S(1, 1, 2)); CG.boxPut(box.PIT, "two", G(10, 12, 2, 1, 0, 0));
  one.results.push({ id: "x1", week: 5, home: "PIT", away: "DAL", at: 1, score: { PIT: 3, DAL: 2 }, box, ot: false, stars: [] });
  CG.aggregate(one, {});
  const s2 = one.pstats.two, c2 = s2.byClub.PIT;
  A("one game, skated and in goal: gp 1, sgp 1, gs 1, for the season and for Pittsburgh alike",
    s2.gp === 1 && s2.sgp === 1 && s2.gs === 1 && c2.gp === 1 && c2.sgp === 1 && c2.gs === 1 && c2.g === 1 && c2.sv === 10, JSON.stringify([s2.gp, s2.sgp, s2.gs, c2.gp, c2.sgp, c2.gs]));
  A("...and both of its lines are in the game log, each naming the club", one.glog.two.length === 2 && one.glog.two.every((e) => e.team === "PIT") && CG.glogGames(one.glog.two)[0].team === "PIT");
}

console.log("\n— the EA extras (ice time, special teams, passing) split the same way");
{
  const rows = [];
  results.forEach((r) => [r.home, r.away].forEach((c) => Object.keys(r.box[c]).forEach((pid) => {
    const b = r.box[c][pid];
    rows.push({ game_id: r.id, profile_id: pid, is_goalie: !!b.goalie, time_on_ice_seconds: b.goalie ? 3600 : 1000 + (pid === "squrly" ? 100 : 0), pp_goals: b.goalie ? 0 : 1,
      passes_completed: 10, passes_attempted: 12, offense_rating: 70, defense_rating: 60, team_play_rating: 65 });
  })));
  /* a row whose base line is in neither box (a club outside the fixture) adds nothing, to the season or a club */
  rows.push({ game_id: g8, profile_id: "pure", is_goalie: false, time_on_ice_seconds: 9999, pp_goals: 9 });
  const split = {};
  CG.addEaMetrics(lg, ps, results, rows, split);
  const s = ps.squrly;
  A("Squrly's ice time per club adds up to his season ice time", s.byClub.UTA.toi + s.byClub.PIT.toi === s.toi && s.byClub.PIT.gToi === 7200 && s.byClub.UTA.skToi === 3300, [s.byClub.UTA.toi, s.byClub.PIT.toi, s.toi].join("/"));
  A("...and so do his power-play goals and passes", s.byClub.UTA.ppg + s.byClub.PIT.ppg === s.ppg && s.byClub.UTA.pass + s.byClub.PIT.pass === s.pass);
  A("each club line averages its own EA ratings", s.byClub.UTA.ratOff === 70 && s.byClub.PIT.ratDef === 60 && s.ratTeam === 65);
  A("a row whose base line is not in the box adds nothing (the season line and its club line agree)", ps.pure.ppg === 2 && ps.pure.byClub.PIT.ppg === 2 && ps.pure.toi === 2000);
  A("roleLine reads a club line's own ice time", CG.roleLine(s.byClub.PIT, "S").toi === 3300 && CG.roleLine(s.byClub.PIT, "G").toi === 7200);
}

console.log("\n— a club's view counts only its own games, departed players included");
{
  const uta = CG.clubStatPlayers(lg, "UTA");
  const ids = uta.map((x) => x.p.id).sort().join();
  A("Utah's players this season: Squrly and Kolosov (both traded away) and ZaZa (no longer rostered)", ids === "kolo,squrly,zaza", ids);
  A("...each with his Utah line only", uta.find((x) => x.p.id === "squrly").s.p === 7 && uta.find((x) => x.p.id === "zaza").s.gp === 1);
  A("Seattle has nobody: Kolosov has not played for it", CG.clubStatPlayers(lg, "SEA").length === 0);
  A("CG.clubLine is null for a club he never played for, and for a line with no split", CG.clubLine(ps.kolo, "SEA") === null && CG.clubLine({ gp: 3 }, "UTA") === null);
}

console.log("\n— the profile: full season on the main page, the split on Honors and history");
{
  const sq = players[0];
  const h = CG.clubHistoryHtml(sq, ps.squrly);
  A("the Team history card names both clubs, Utah first", /Team history[\s\S]*2 clubs/.test(h) && h.indexOf("Mammoth") < h.indexOf("Penguins"));
  A("...a skating table (registered role first) then an in-goal table", /Skating · 6 GP[\s\S]*In goal · 2 GP/.test(h));
  A("...the current club is marked", /Penguins<\/a><\/span> <span class="chip chip-xs">Current<\/span>/.test(h));
  const skT = h.slice(0, h.indexOf("In goal · ")), glT = h.slice(h.indexOf("In goal · "));
  A("...weeks for each club, per role: skating Utah 1 to 2 and Pittsburgh 3, in goal Pittsburgh 4", /Wk 1 to 2/.test(skT) && /Penguins[\s\S]*?<td>Wk 3<\/td>/.test(skT) && /<td>Wk 4<\/td>/.test(glT) && !/Wk 3 to 4/.test(h));
  A("...and the skating total spans the skating weeks only (Wk 1 to 3)", /Season total<\/td><td>Wk 1 to 3<\/td>/.test(skT));
  const tot = CG.roleLine(ps.squrly, "S");
  const foot = (h.match(/<tfoot>([\s\S]*?)<\/tfoot>/) || [])[1] || "";
  A("...the skating total row is the main page's line exactly (6 GP, 4 G, 13 A, 17 P)", /Season total/.test(foot) && foot.indexOf("<td>" + tot.sgp + "</td>") >= 0 && foot.indexOf('class="pts">17<') >= 0, foot);
  A("...the in-goal table has one club, so no total row", (h.match(/<tfoot>/g) || []).length === 1);
  A("...the total sits in tfoot, out of the table sorter's reach, and the table opts out of the filter", /<\/tbody><tfoot>/.test(h) && /data-nofilter/.test(h) && /\.tbl tfoot td\{/.test(head));
  A("...no NaN or undefined", !/NaN|undefined/.test(h));
  const kh = CG.clubHistoryHtml(players[1], ps.kolo);
  A("Kolosov: one club row (Utah) and a note that he has not played for Seattle yet", /1 club</.test(kh) && /Now with the Kraken: no games for them yet\./.test(kh) && /Every game this season was for the Mammoth\./.test(kh));
  A("...no Current chip on a club he no longer plays for", !/Current/.test(kh));
  const zh = CG.clubHistoryHtml(former[0], ps.zaza, { former: true });
  A("a former player's card marks his last club, not a current one", /Mammoth<\/a><\/span> <span class="chip chip-xs">Last club<\/span>/.test(zh) && !/Current/.test(zh) && !/Now with/.test(zh));
  A("a player with no games yet gets no split card (the old Team history card stands)", CG.clubHistoryHtml(players[2], CG.blankStatLine()) === "" && CG.clubHistoryHtml(players[2], { gp: 0 }) === "");
  lg.draftPicks = [{ used: true, playerId: "squrly", season: 1, round: 2, overall: 11, ownerCode: "UTA" }];
  A("the card says who drafted him, from the draft record", /Drafted by the Mammoth in round 2 \(#11 overall\)\./.test(CG.clubHistoryHtml(sq, ps.squrly)));
  lg.draftPicks = [];
  A("a player who was not drafted keeps the line saying how he joined, without naming a club",
    /Placed by the league office as depth \(Rule 2\.8\)\./.test(CG.clubHistoryHtml(Object.assign({}, sq, { origin: "depth_random" }), ps.squrly)) &&
    /Signed as a free agent\./.test(CG.clubHistoryHtml(Object.assign({}, sq, { origin: "free_agency" }), ps.squrly)) &&
    !/Placed|Signed/.test(CG.clubHistoryHtml(Object.assign({}, sq, { origin: "assigned" }), ps.squrly)));
  lg.draftPicks = [{ used: true, playerId: "squrly", season: 1, round: 2, overall: 11, ownerCode: "UTA" }];
  A("...and a drafted player gets the draft line instead", /Drafted by the Mammoth/.test(CG.clubHistoryHtml(Object.assign({}, sq, { origin: "depth_random" }), ps.squrly)) &&
    !/as depth/.test(CG.clubHistoryHtml(Object.assign({}, sq, { origin: "depth_random" }), ps.squrly)));
  lg.draftPicks = [];
  A("the history card has no dashes as punctuation", !/ — | - /.test(h + kh + zh));
  const log = CG.gameLogTables(lg.glog.squrly, false, { link: true });
  A("the game log gets a Club column when he played for more than one club", log.every((t) => /<th class="tleft">Club<\/th>/.test(t.head)) && /data-sort="UTA"/.test(log[0].rows) && /data-sort="PIT"/.test(log[0].rows));
  A("...and none when he played for one", !/>Club</.test(CG.gameLogTables(lg.glog.pure, false, {})[0].head));
  lg.teams.SEA.gp = 30; lg.ratings = { kolo: { parts: { defense: 50 } } };
  const sc = CG.scoutLine(players[1]);
  A("a goalie traded after every start does not read as starting his new club's games", /has started 3 games in goal \(3 for the Mammoth\)/.test(sc) && !/of 30 club games/.test(sc), sc);
  A("the main page wiring: the honors tab renders the split, the overview keeps the season line",
    /\(CG\.clubHistoryHtml\(p, s\) \|\|/.test(pub) && /'<div id="posKpi">'\+CG\.profileSeasonHtml\(s, isG\)/.test(pub));
  A("the former player's page shows the split when he played for two or more clubs", /\(CG\.clubsPlayed\(s\)\.length > 1 \? CG\.clubHistoryHtml\(fp, s, \{ former: true \}\) : ''\)/.test(pub));
}

console.log("\n— club pages, Stat Central, rankings and the matchup panel read the club line");
A("the team page roster uses the club line, says where else a player played, and lists who moved on",
  /var clubPs = function\(p\)\{ var full = SD\.pstats\[p\.id\]; return !full \|\| !full\.byClub \? full : \(CG\.clubLine\(full, code\) \|\| CG\.blankStatLine\(\)\); \};/.test(pub) &&
  /var ps = clubPs\(p\), line = CG\.seasonLineText\(ps, p\);/.test(pub) && /Earlier this season: '\+gone\.length/.test(pub) &&
  /var gone = CG\.clubStatPlayers\(lg, code\)\.filter\(function\(x\)\{ return x\.p\.former \|\| x\.p\.team !== code; \}\)/.test(pub));
A("Stat Central, All clubs: a player with no games for his current club reads 'UTA · now with SEA' under the club he played for, never '(also)'",
  /var playedNowhereHere = function\(p\)\{ var full = SL\.pstats\[p\.id\]; return !!\(full && full\.byClub && !CG\.clubLine\(full, p\.team\) && CG\.clubsPlayed\(full\)\.length\); \};/.test(pub) &&
  /if \(playedNowhereHere\(p\)\)\{ var cs = CG\.clubsPlayed\(SL\.pstats\[p\.id\]\); return cs\[cs\.length-1\]; \}/.test(pub) &&
  /if \(playedNowhereHere\(p\)\) return CG\.clubsPlayed\(full\)\.map\(esc\)\.join\(', '\) \+ ' · now with '\+esc\(p\.team\)/.test(pub));
A("a decided award card wears the club it was filed to", /var ac = \(a\.team_id && \(lg\._idToCode\|\|\{\}\)\[a\.team_id\] && CG\.TEAM\[\(lg\._idToCode\|\|\{\}\)\[a\.team_id\]\]\) \? lg\._idToCode\[a\.team_id\] : p\.team;/.test(pub2) && /CG\.crest\(ac,44\)/.test(pub2));
A("Stat Central: the chosen club's line, or the season with All clubs", /if \(!fTeam\) return full;\s*return CG\.clubLine\(full, fTeam\) \|\|/.test(pub) && /' · now with '\+esc\(p\.team\)/.test(pub) && /' \(also '\+other\.map\(esc\)\.join\(', '\)\+'\)'/.test(pub));
A("the power rankings' key player is the club's own top scorer", /var clubP = function\(p\)\{ var c = CG\.clubLine\(lg\.pstats\[p\.id\], pr\.team\); return c \? c\.p : 0; \};/.test(pub2) && /pts for the '\+esc\(t\.name\)/.test(pub2));
A("players to watch count the club's own games and say so for a mover", /function mxLine\(p, code\)\{ return CG\.clubLine\(lg\.pstats\[p\.id\], code\) \|\| CG\.blankStatLine\(\); \}/.test(pub2) && /for '\+esc\(code\)\+' this season/.test(pub2));
A("eligibility, limits, ratings and trades keep the full season (no club line read there)",
  ["canMovePlayer", "playoffRoad", "weekLedger", "tradeStats"].every((f) => { const src = grab(live, f); return !/clubLine|byClub|clubStatPlayers/.test(src); }) &&
  !/clubLine|byClub/.test(eng.slice(eng.indexOf("/* ----- player ratings"), eng.indexOf("/* ----- team overall"))));

console.log("\n— honors stay with the club they were earned for");
{
  const w = { week: 2, forward: "squrly", forwardTeam: "UTA", goalie: "kolo" };
  const picks = CG.potwPicks(lg, w);
  A("a Player of the Week carries the club it was won for (Utah), not his club today (Pittsburgh)", picks[0].team === "UTA" && picks[0].p.team === "PIT");
  A("...a week with no stored club falls back to his club today", picks[1].team === "SEA");
  A("...and a winner no longer rostered still shows", CG.potwPicks(lg, { week: 1, defense: "zaza" })[0].p.tag === ".-ZaZa");
  A("the award's club is read from the awards row", /e\[f\[0\]\+"Team"\] = a\.team_id \? \(id2code\[a\.team_id\]\|\|null\) : null;/.test(live));
  A("the team page's honors filter by the club it was won for", /if \(pk\.team===code\) wins\.push/.test(pub));
  A("stars wear the crest of the club the game was played for", /CG\.crest\(st\.team,28\)/.test(pub2) && /CG\.crest\(st\.team,30\)/.test(pub2) && /CG\.crest\(s\.team,30\)/.test(pub));
  A("the stars board names every club a player earned stars for", /if \(t\.clubs\.indexOf\(st\.team\) < 0\) t\.clubs\.push\(st\.team\);/.test(pub2));
}

console.log("\n— the record, the rulebook and the changelog");
{
  const sql = R("sql/2026-10-15-club-split-v413.sql");
  A("a filed title goes to the club of the winner's latest regular-season line, not his roster spot",
    /select gs\.team_id from public\.game_stats gs join public\.games g on g\.id = gs\.game_id[\s\S]*order by g\.scheduled_at desc, gs\.id desc limit 1\)/.test(sql) &&
    !/from public\.roster_spots/.test(sql.slice(sql.indexOf("create or replace"))));
  const C = {}; new Function("CG", R("src/live/part3_content.js"))(C);
  const rb = C.CONTENT.rulebook;
  const sec = (id) => { for (const ch of rb.chapters) for (const s of (ch.sections || [])) if (s.id === id) return s; };
  const r61 = sec("6.1").paragraphs.join(" ");
  A("Rule 6.1: every line is credited to the club played for; profile main page = season, Honors and history = by club",
    /Every line is credited to the club the player played that game for\./.test(r61) && /the Honors and history tab of that profile divides it by club/.test(r61) &&
    /Eligibility \(Rules 2\.4 and 8\.3\) and the statistical titles \(Rule 9\.2\) count a player's games at every club, and the weekly limits \(Rule 5\.2\) count every club's games in that week\./.test(r61) &&
    /its players to watch for a game are drawn from its current roster by their games for that club/.test(r61) && /a Player of the Week to the club of the winner's last game that week/.test(r61));
  A("...and the playoff paragraph of v4.09 is still there", /Playoff games are part of the official record and are kept apart from the regular season\./.test(r61));
  const e413 = rb.changelog.find((c) => c.version === "4.13");
  A("the changelog has its 4.13 entry, right after 4.12 in order", !!e413 && rb.changelog.indexOf(e413) + 1 === rb.changelog.findIndex((c) => c.version === "4.12"));
  A("...with no em dashes and no guessed pronouns", !/—/.test(JSON.stringify(e413)) && !/\b(he|his|him)\b/i.test(JSON.stringify(e413)));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
