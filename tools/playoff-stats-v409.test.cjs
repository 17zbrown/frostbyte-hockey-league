/* v4.09: playoff box scores were imported into game_stats (games.stage = 'playoff') but never reached a player's
   statistics: buildLiveLeague aggregated every stage for the ratings, then the regular season alone for lg.pstats and
   lg.glog, so no page showed a playoff line or a playoff game log. Each player now has a playoff line (lg.playoff), the
   one shape of v4.08 (CG.blankStatLine, gp = sgp + gs, every role played, players no longer rostered included), shown on
   the profile and in a Playoffs view of Stat Central, never added into the regular season's.
   This runs the real engine (CG.splitStages, CG.aggregateStages, CG.aggregate, CG.addEaMetrics) and the real page
   helpers on a fixture season with pre-season, regular-season and playoff games, two-way players and a player no longer
   rostered, and proves the regular season reads exactly as it did before.
   Run: node tools/playoff-stats-v409.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const eng = R("src/live/part2_engine.js"), pub = R("src/live/part5a_public.js"), live = R("src/live/part_live.js");
const grab = (src, fn) => { const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};")); if (!m) throw new Error("no CG." + fn); return m[0]; };

const TEAMS = ["NYI", "DAL", "SEA", "BOS"].map((code) => ({ code, name: code + " club", color: "#000", div: code === "NYI" || code === "BOS" ? "East" : "West" }));
const ctx = { console, Math, Object, Array, String, Number, JSON, Date, Intl };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.CG = {
  TEAMS, TEAM: Object.fromEntries(TEAMS.map((t) => [t.code, t])), SEASON: { completedWeeks: 0 },
  DEFAULT_WEIGHTS: { skater: { production: 46, efficiency: 16, defense: 14, discipline: 8, form: 16 }, goalie: { saves: 52, workload: 18, wins: 22, discipline: 8 },
    team: { record: 38, goalDiff: 22, goaltending: 14, depth: 14, form: 12 } },
  crest: () => "", fmtToi: (s) => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0"), seasonTag: () => "Season 2",
  playerRoute: (p) => "#/player/" + p.id, isCamp: () => false, ic: () => "",
  pageHead: (eyebrow, title, sub, side) => "<header><h1>" + title + "</h1><p>" + sub + "</p>" + (side || "") + "</header>",
};
ctx.esc = (s) => String(s);
vm.createContext(ctx);
for (const f of ["boxLines", "boxPut", "glogGames", "blankStatLine", "statPlayers", "statPlayerById", "addStatLine", "clubLine", "clubsPlayed", "aggregate",   /* v4.11: aggregate reads box entries through boxLines */ "splitStages", "aggregateStages", "addEaRow", "addEaMetrics",
  "playerById", "standings", "h2hPoints", "skaterLeaders", "goalieLeaders", "roleLine", "lineRoles", "offRoleTag"]) vm.runInContext(grab(eng, f), ctx);
for (const f of ["emptyRow", "profileSeasonHtml", "gameLogTables", "profileStatCells", "statCellsHtml", "formerLeagueHtml", "clubHistoryHtml",
  "playoffLine", "playoffCardHtml", "playoffLogHtml", "playoffView", "ROUTES\\.stats"]) {
  if (f === "ROUTES\\.stats") ctx.CG.ROUTES = {};
  vm.runInContext(grab(pub, f), ctx);
}
const CG = ctx.CG;

/* ---- the fixture: a season with every stage ---- */
const players = [
  { id: "sk", tag: "Sniper", team: "NYI", pos: "C" },
  { id: "d1", tag: "Rearguard", team: "NYI", pos: "LD" },
  { id: "gN", tag: "Islander tender", team: "NYI", pos: "G" },
  { id: "twoG", tag: "Bowman", team: "NYI", pos: "G" },       /* registered G: skates one playoff game */
  { id: "dsk", tag: "Dallas skater", team: "DAL", pos: "RW" },
  { id: "gD", tag: "Dallas tender", team: "DAL", pos: "G" },
  { id: "twoS", tag: "Easy pickins", team: "DAL", pos: "RD" }, /* registered RD: plays one playoff game in goal */
  { id: "ssk", tag: "Seattle skater", team: "SEA", pos: "LW" },
  { id: "gS", tag: "Seattle tender", team: "SEA", pos: "G" },
  { id: "bsk", tag: "Boston skater", team: "BOS", pos: "C" },
  { id: "gB", tag: "Boston tender", team: "BOS", pos: "G" },
];
/* left the league after the regular season, but played two playoff games for NYI before that? No: a player waived during
   the playoffs. He has no regular-season games at all, only playoff lines. */
const former = [{ id: "gone", tag: "Playoff rental", team: "NYI", pos: "RW", former: true }];
const S = (g, a, shots, pos, x) => Object.assign({ g, a, shots, pos: pos || "C", pm: g - 1, hits: 2, blk: 1, gv: 1, tk: 1, pim: 0, fow: 0, fot: 0, gwg: 0 }, x || {});
const G = (sv, sa, w, l, otl) => ({ goalie: true, pos: "G", sv, sa, ga: sa - sv, w, l, otl, so: sa === sv ? 1 : 0, qs: (sa ? sv / sa : 1) >= .885 ? 1 : 0 });
let gid = 0;
const results = [];
const game = (stage, week, home, away, hs, as, box, ot) => {
  const r = { id: stage[0] + (++gid), week, stage, home, away, at: 1e12 + gid * 3600000, score: { [home]: hs, [away]: as }, box: { [home]: box[home] || {}, [away]: box[away] || {} }, ot: !!ot, stars: [] };
  results.push(r); return r;
};
/* pre-season, week 1 */
game("preseason", 1, "NYI", "DAL", 2, 1, { NYI: { sk: S(1, 0, 3), gN: G(20, 21, 1, 0, 0) }, DAL: { dsk: S(1, 0, 2), gD: G(18, 20, 0, 1, 0) } });
/* regular season, weeks 1 and 2 */
game("regular", 1, "NYI", "DAL", 4, 2, { NYI: { sk: S(2, 1, 6), d1: S(0, 2, 2, "LD"), gN: G(25, 27, 1, 0, 0) }, DAL: { dsk: S(1, 1, 4), twoS: S(0, 1, 2, "RD"), gD: G(20, 24, 0, 1, 0) } });
game("regular", 1, "SEA", "BOS", 3, 2, { SEA: { ssk: S(2, 0, 5), gS: G(22, 24, 1, 0, 0) }, BOS: { bsk: S(1, 1, 4), gB: G(19, 22, 0, 0, 1) } }, true);
game("regular", 2, "DAL", "SEA", 1, 3, { DAL: { dsk: S(0, 1, 3), twoS: S(1, 0, 2, "RD"), gD: G(17, 20, 0, 1, 0) }, SEA: { ssk: S(1, 1, 3), gS: G(25, 26, 1, 0, 0) } });
game("regular", 2, "BOS", "NYI", 2, 5, { BOS: { bsk: S(2, 0, 5), gB: G(21, 26, 0, 1, 0) }, NYI: { sk: S(1, 2, 4), d1: S(1, 1, 3, "LD"), twoG: S(0, 1, 1, "D"), gN: G(22, 24, 1, 0, 0) } });
const regOnly = results.slice(1);
/* playoffs, round 1 (week 1): NYI beat DAL in a short series; SEA and BOS do not play */
game("playoff", 1, "NYI", "DAL", 3, 1, { NYI: { sk: S(1, 1, 5), d1: S(0, 1, 2, "LD"), gone: S(1, 0, 2, "RW"), gN: G(30, 31, 1, 0, 0) }, DAL: { dsk: S(1, 0, 3), twoS: S(0, 0, 1, "RD"), gD: G(24, 27, 0, 1, 0) } });
game("playoff", 1, "NYI", "DAL", 2, 3, { NYI: { sk: S(0, 2, 4), twoG: S(1, 0, 2, "D"), gone: S(0, 1, 1, "RW"), gN: G(27, 30, 0, 0, 1) }, DAL: { dsk: S(2, 0, 6), twoS: G(28, 30, 1, 0, 0) } }, true);
game("playoff", 1, "DAL", "NYI", 0, 4, { DAL: { dsk: S(0, 0, 2), gD: G(26, 30, 0, 1, 0) }, NYI: { sk: S(2, 1, 6), twoG: G(22, 22, 1, 0, 0) } });
const poOnly = results.filter((r) => r.stage === "playoff");

/* game_stats rows, the EA-only metrics, for one regular game and one playoff game */
const row = (game_id, profile_id, is_goalie, toi, x) => Object.assign({ game_id, profile_id, is_goalie, time_on_ice_seconds: toi, pp_goals: 0, sh_goals: 0,
  passes_completed: 10, passes_attempted: 12, shot_attempts: 5, possession_seconds: 60, interceptions: 1, penalties_drawn: 0, deflections: 0, saucer_passes: 1,
  offense_rating: 70, defense_rating: 60, team_play_rating: 65, breakaway_shots: 1, breakaway_saves: 1, poke_checks: 2, diving_saves: 1 }, x || {});
const rows = [
  row(results[1].id, "sk", false, 1100, { pp_goals: 1 }), row(results[1].id, "gN", true, 3600),
  row(poOnly[0].id, "sk", false, 1300, { pp_goals: 1, sh_goals: 1 }), row(poOnly[0].id, "gone", false, 900),
  row(poOnly[1].id, "twoG", false, 1000), row(poOnly[1].id, "twoS", true, 3600),
  row(poOnly[2].id, "twoG", true, 3600),
];

const byTeam = {}; TEAMS.forEach((t) => (byTeam[t.code] = players.filter((p) => p.team === t.code)));
const weeks = { pre: 1, all: 3, reg: 2 };
const build = (res) => {
  const lg = { players, formerPlayers: former, byTeam, results: [] };
  const st = CG.splitStages(res);
  CG.aggregateStages(lg, st, weeks);
  CG.addEaMetrics(lg, lg.pstats, st.reg, rows, lg.posSplitRows = {});
  CG.addEaMetrics(lg, lg.playoff.pstats, st.po, rows, null);
  return lg;
};
/* what the site built before v4.09 for the regular season: one pass over the regular finals */
const baseline = (res) => {
  const lg = { players, formerPlayers: former, byTeam, results: res };
  CG.SEASON.completedWeeks = weeks.reg; CG.aggregate(lg, {});
  CG.addEaMetrics(lg, lg.pstats, res, rows, lg.posSplitRows = {});
  return lg;
};
const lg = build(results);
const weeksAfterBuild = CG.SEASON.completedWeeks;
const base = baseline(regOnly);
CG.lg = lg;
const po = lg.playoff.pstats;

console.log("— the stages split the season's finals once");
{
  const st = CG.splitStages(results);
  A("pre-season 1, regular 4, playoffs 3", st.pre.length === 1 && st.reg.length === 4 && st.po.length === 3 && st.all.length === 8);
  A("a game with no stage is a regular-season game", CG.splitStages([{ id: "x" }]).reg.length === 1);
  A("lg.results is the regular season alone after the build", lg.results.length === 4 && lg.results.every((r) => r.stage === "regular"));
}

console.log("\n— the regular season reads exactly as before");
{
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  A("every regular-season line is identical to a regular-only build", same(lg.pstats, base.pstats));
  A("...so is every regular-season game log", same(lg.glog, base.glog));
  A("...and the standings", same(lg.teams, base.teams));
  A("a playoff game adds nothing to a regular-season line (Sniper: 3 GP, 3G 3A)", lg.pstats.sk.gp === 2 && lg.pstats.sk.g === 3 && lg.pstats.sk.a === 3,
    JSON.stringify([lg.pstats.sk.gp, lg.pstats.sk.g, lg.pstats.sk.a]));
  A("...and nothing to the games played that the eligibility floor counts (Rule 8.3)", lg.pstats.twoG.gp === 1 && lg.pstats.gN.gp === 2);
  A("the playoff rental has a regular-season line of zeros, not one with his playoff games", lg.pstats.gone && lg.pstats.gone.gp === 0 && lg.pstats.gone.g === 0);
  A("playoff ice time stays out of the regular-season line", lg.pstats.sk.toi === 1100 && lg.pstats.sk.ppg === 1 && !lg.pstats.sk.shg);
  A("the By position rows are the regular season's alone", (lg.posSplitRows.sk || []).length === 1 && !lg.posSplitRows.gone);
  A("weekly honors come from regular weeks only", lg.potw.length === 2 && lg.potw.every((w) => w.week <= 2));
  A("the skater and goalie leaders read the regular season", CG.skaterLeaders(lg, "p")[0].id === "sk" && !CG.skaterLeaders(lg, "p").some((p) => p.id === "gone"));
}

console.log("\n— the playoff line: the one shape, from the playoff finals alone");
{
  const keys = Object.keys(CG.blankStatLine()).filter((k) => !/weekly/.test(k));
  const bad = [];
  CG.statPlayers(lg).forEach((p) => { const s = po[p.id]; if (!s) { bad.push(p.id + " missing"); return; } keys.forEach((k) => { if (typeof s[k] !== "number" || Number.isNaN(s[k])) bad.push(p.id + "." + k); }); if (s.gp !== s.sgp + s.gs) bad.push(p.id + ".gp"); });
  A("every player has a playoff line, every field a number, gp = sgp + gs", bad.length === 0, bad.join(", "));
  A("Sniper: 3 playoff games, 3G 4A on 15 shots", po.sk.gp === 3 && po.sk.sgp === 3 && po.sk.g === 3 && po.sk.a === 4 && po.sk.p === 7 && po.sk.shots === 15,
    JSON.stringify([po.sk.gp, po.sk.g, po.sk.a, po.sk.shots]));
  A("the NYI goalie: 2 starts, 57 saves on 61, 1-0-1", po.gN.gs === 2 && po.gN.sv === 57 && po.gN.sa === 61 && po.gN.w === 1 && po.gN.otl === 1);
  A("Bowman (registered G): one playoff game skated, one in goal, both counted", po.twoG.gp === 2 && po.twoG.sgp === 1 && po.twoG.gs === 1 && po.twoG.g === 1 && po.twoG.sv === 22 && po.twoG.so === 1);
  A("Easy pickins (registered RD): one game skated, one in goal (a win)", po.twoS.gp === 2 && po.twoS.sgp === 1 && po.twoS.gs === 1 && po.twoS.w === 1 && po.twoS.sv === 28);
  A("the player no longer rostered keeps his playoff games (2 GP, 1G 1A)", po.gone.gp === 2 && po.gone.g === 1 && po.gone.a === 1);
  A("a club out of the playoffs has a line of zeros", po.ssk.gp === 0 && po.bsk.gp === 0);
  A("the playoff ice time and advanced metrics go to the playoff line", po.sk.toi === 1300 && po.sk.skToi === 1300 && po.sk.ppg === 1 && po.sk.shg === 1 && po.sk._ratN === 1 && po.sk.ratOff === 70);
  A("...per role: Bowman 1000 s skating, 3600 s in goal", po.twoG.skToi === 1000 && po.twoG.gToi === 3600 && po.twoG.pokes === 2);
  A("the playoff game log holds only playoff games", lg.playoff.glog.sk.length === 3 && lg.playoff.glog.sk.every((e) => e.game[0] === "p"));
  const nyi = lg.playoff.teams.NYI, dal = lg.playoff.teams.DAL;
  A("the playoff club lines: NYI 2-0-1 in 3, DAL 1-2-0", nyi.gp === 3 && nyi.w === 2 && nyi.otl === 1 && dal.gp === 3 && dal.w === 1 && dal.l === 2, JSON.stringify([nyi.w, nyi.l, nyi.otl, dal.w, dal.l, dal.otl]));
  A("...and a club out of the playoffs has none", lg.playoff.teams.SEA.gp === 0);
  A("the boards read the playoff line through the same role rules", CG.skaterLeaders({ players, formerPlayers: former, pstats: po }, "p")[0].id === "sk" &&
    CG.skaterLeaders({ players, formerPlayers: former, pstats: po }, "p").some((p) => p.id === "gone"));
}

console.log("\n— the other stages and the ratings");
{
  A("the pre-season line is kept apart too", lg.pre && lg.pre.pstats.sk.gp === 1 && lg.pre.pstats.sk.g === 1 && lg.pre.results.length === 1);
  const all = { players, formerPlayers: former, byTeam, results };
  CG.SEASON.completedWeeks = weeks.all; CG.aggregate(all, {});
  A("the ratings see every stage (Rule 6.1: the overall uses regular-season and playoff box scores)", JSON.stringify(lg.ratings) === JSON.stringify(all.ratings));
  A("...which differ from regular-only ratings, so the playoff games really reach them", JSON.stringify(lg.ratings) !== JSON.stringify(base.ratings));
  A("CG.SEASON.completedWeeks ends on the regular season's weeks", weeksAfterBuild === weeks.reg, weeksAfterBuild);
}

console.log("\n— before the first playoff final");
{
  const pre = build(regOnly);
  A("lg.playoff exists, with a line of zeros for every player", pre.playoff && pre.playoff.results.length === 0 && CG.statPlayers(pre).every((p) => pre.playoff.pstats[p.id] && pre.playoff.pstats[p.id].gp === 0));
  A("...and the regular season is what a regular-only build gives", JSON.stringify(pre.pstats) === JSON.stringify(base.pstats) && JSON.stringify(pre.ratings) === JSON.stringify(base.ratings));
  A("...and no pre-season line is invented when there was no pre-season", !pre.pre);
}

console.log("\n— the profile");
{
  const card = CG.playoffCardHtml("twoG", true);
  A("a Playoffs card with the playoff games played", /<h3>Playoffs<\/h3><span class="chip">2 GP<\/span>/.test(card));
  A("...one grid per role, in goal first for a registered goalie", /In goal · 1 GP[\s\S]*Skating · 1 GP/.test(card));
  A("...that says the line is kept apart and what it never counts toward", /kept apart from the regular season/.test(card) && /Rule 9\.2/.test(card) && /Rule 8\.3/.test(card));
  A("...with no NaN or undefined", !/NaN|undefined/.test(card));
  A("no card for a player with no playoff games", CG.playoffCardHtml("ssk", false) === "" && CG.playoffCardHtml("nobody", false) === "");
  const log = CG.playoffLogHtml("twoG", true);
  A("the playoff game log: its own tables, in goal and skating, the round in the first column", /Playoff games, in goal/.test(log) && /Playoff games, skating/.test(log) && /<th>Rd<\/th>/.test(log) && !/<th>Wk<\/th>/.test(log));
  A("...each row links to its box score", (log.match(/data-go="#\/matchup\/p/g) || []).length === 2);
  A("...and nothing for a player with no playoff games", CG.playoffLogHtml("ssk", false) === "");
  A("the regular-season log still heads its first column Wk", /<th>Wk<\/th>/.test(CG.gameLogTables(lg.glog.sk, false, {})[0].head));
  const fh = CG.formerLeagueHtml("gone");
  A("a player no longer rostered with only playoff games: the record card, the Playoffs card and the playoff log", /no longer rostered/.test(fh) && /<h3>Playoffs<\/h3>/.test(fh) && /Playoff games/.test(fh) && !/NaN|undefined/.test(fh));
  A("the profile route puts the Playoffs card under the regular-season line and the playoff log after the season's",
    /\{ html: kpiStrip, wide: true \},\s*\{ html: archived \? "" : CG\.playoffCardHtml\(p\.id, isG\), wide: true \}/.test(pub) &&
    /if \(!archived\) body \+= CG\.playoffLogHtml\(p\.id, isG\);/.test(pub));
  A("...labels the regular-season line once a playoff line sits beside it", /poS && poS\.gp \? '<div class="eyebrow" style="margin:0 0 10px">Regular season<\/div>'/.test(pub));
  A("...and a player with games at any stage is never shown as yet to take a shift", /var anyGp = \(s\.gp\|\|0\) \+ \(\(preS && preS\.gp\)\|\|0\) \+ \(\(poS && poS\.gp\)\|\|0\);/.test(pub));
}

console.log("\n— Stat Central");
{
  const reg = CG.ROUTES.stats(null, { tab: "skaters", min: "1" }), pov = CG.ROUTES.stats(null, { tab: "skaters", stage: "playoff" });
  const row = (html, tag) => { const i = html.indexOf(tag + "</span>"); return i < 0 ? "" : html.slice(i, html.indexOf("</tr>", i)); };
  A("the stage switch, Regular season on by default", /aria-label="Stage"/.test(reg) && /class="on" aria-pressed="true" data-stage="regular">Regular season/.test(reg));
  A("...and Playoffs on in the Playoffs view", /class="on" aria-pressed="true" data-stage="playoff">Playoffs/.test(pov) && /<h1>Playoff statistics<\/h1>/.test(pov));
  A("the regular view shows Sniper's regular line (2 GP, 6 P)", /data-v="2">2<\/td>/.test(row(reg, "Sniper")) && /data-v="6" class="pts">6</.test(row(reg, "Sniper")), row(reg, "Sniper"));
  A("the Playoffs view shows his playoff line (3 GP, 7 P)", /data-v="3">3<\/td>/.test(row(pov, "Sniper")) && /data-v="7" class="pts">7</.test(row(pov, "Sniper")), row(pov, "Sniper"));
  A("the Playoffs view starts at 1 GP, so a one-game skater is listed (Bowman, G skating)", /Bowman/.test(pov) && /minimum 1 GP/.test(pov));
  A("...lists the player no longer rostered", /Playoff rental/.test(pov) && /no longer rostered/.test(row(pov, "Playoff rental")));
  A("...and leaves out clubs that did not play", !/Seattle skater|Boston skater/.test(pov));
  A("the regular view never lists the playoff rental (no regular games)", !/Playoff rental/.test(reg));
  const gov = CG.ROUTES.stats(null, { tab: "goalies", stage: "playoff", min: "1" });
  A("playoff goaltenders: a skater who played goal is listed under his starts", /Easy pickins/.test(gov) && /RD, in goal/.test(gov));
  const adv = CG.ROUTES.stats(null, { tab: "advanced", stage: "playoff" });
  A("playoff advanced metrics read the playoff ice time (1300 s over 3 games is 7:13 a game)", /data-v="433">7:13</.test(row(adv, "Sniper")), row(adv, "Sniper"));
  const tov = CG.ROUTES.stats(null, { tab: "teams", stage: "playoff" });
  A("playoff team table: only the clubs that played, by wins, with a win percentage", /NYI club[\s\S]*DAL club/.test(tov) && !/SEA club|BOS club/.test(tov) && /<th class="sortable">W%<\/th>/.test(tov) && /data-v="67">67%/.test(tov));
  const regT = CG.ROUTES.stats(null, { tab: "teams" });
  A("the regular team table is unchanged (every club, PTS%)", /SEA club/.test(regT) && /<th class="sortable">PTS%<\/th>/.test(regT));
  A("no NaN or undefined anywhere", ![reg, pov, gov, adv, tov, regT].some((h) => /NaN|undefined/.test(h)));
  CG.lg = build(regOnly);
  const empty = CG.ROUTES.stats(null, { tab: "skaters", stage: "playoff" });
  A("before the first playoff final the Playoffs view says the playoffs haven't started", /No playoff skater stats yet/.test(empty) && /The playoffs haven’t started/.test(empty));
  CG.lg = lg;
  A("the stage rides along with every tab and filter change", /var stg = qs\.stage === "playoff" \? "&stage=playoff" : "";/.test(pub) &&
    /location\.hash="#\/stats\?tab="\+b\.getAttribute\("data-tab"\)\+stg;/.test(pub) && /\+"&min="\+this\.value\+stg;/.test(pub));
}

console.log("\n— the live build runs the engine's one definition");
{
  A("buildLiveLeague splits the stages and aggregates them through CG.aggregateStages", /var stages = CG\.splitStages\(results\);/.test(live) &&
    /CG\.aggregateStages\(lg, stages, \{ pre: preWeeksDone, all: allWeeksDone, reg: regMaxWk \}\);/.test(live));
  A("...with no aggregate pass of its own that could overwrite a line", !/CG\.aggregate\(lg/.test(live));
  A("...and the EA metrics for the regular line and the playoff line", /CG\.addEaMetrics\(lg, lg\.pstats, regResults, gameStatsRows, lg\.posSplitRows\);/.test(live) &&
    /CG\.addEaMetrics\(lg, lg\.playoff\.pstats, poResults, gameStatsRows, null\);/.test(live));
  A("the statistical titles stay regular season only in the database (statistical_title_board)",
    /coalesce\(gm\.stage,'regular'\) = 'regular' and gm\.status = 'final'/.test(R("sql/2026-10-15-two-way-stats-v408.sql")));
}

console.log("\n— the rulebook and the changelog");
{
  const C = {}; new Function("CG", R("src/live/part3_content.js"))(C);
  const rb = C.CONTENT.rulebook;
  const sec = (id) => { for (const ch of rb.chapters) for (const s of (ch.sections || [])) if (s.id === id) return s; };
  const p61 = sec("6.1").paragraphs.find((p) => /^Playoff games are part of the official record/.test(p)) || "";
  A("Rule 6.1: each player has a playoff line, kept apart and never added into the regular season's", /Each player has a playoff line/.test(p61) && /never added into it/.test(p61));
  A("...regular-season totals, the titles (9.2) and the floor (8.3) count regular-season games only", /Regular-season totals, the statistical titles of Rule 9\.2 and the games-played floor of Rule 8\.3 count regular-season games only/.test(p61));
  A("...and the overall still counts the playoffs, as the rule's rating paragraph says", /playoff games count toward the overall rating/.test(p61) && /regular-season and playoff box scores/.test(sec("6.1").paragraphs[1]));
  const e = rb.changelog.find((c) => c.version === "4.09");
  A("the changelog has its 4.09 entry", !!e && /Playoffs view of Stat Central/.test(e.summary));
  A("no em dashes or spaced hyphens in the new copy", !/—| - /.test(JSON.stringify(e) + p61) &&
    !/—| - /.test(grab(pub, "playoffCardHtml") + grab(pub, "playoffLogHtml")));
  A("American spelling", !/practis|colour|centre|organis|defence|cancelled/i.test(JSON.stringify(e) + p61));
}

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
