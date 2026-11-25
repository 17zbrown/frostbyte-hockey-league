/* v5.00 swap (c2, live-model): the Season 2 model built from a real s2_league body (no browser; tools/ui/run.cjs runs it
   with the suites). It reads two anon bodies recorded read-only on 2026-11-24 and the Oct 19 fixture, all private
   (~/Developer/cghl-private/fixtures, never in the repo); without them it FAILS rather than skips.
   What it pins:
   - Season 1's standings from S2.buildModel equal the classic engine's (CG.aggregateStages and CG.standings run straight
     on the body, as src/live's buildLiveLeague does), and its season lines count every line (every-line-counts);
   - the close it counts (final table, trophies, the twenty Cup names) equals what was read from production by hand;
   - the cap, the rounds and the calendar come from the season rows, with no overlay left in the model;
   - Season 2 empty states are flagged, the archive keeps Season 1's honors, a missing section is an error, and S2.M keeps
     its identity across a rebuild;
   - the loader's contract with the page (demo.html's script list, the read, the gate). */
const fs = require("fs"), path = require("path"), vm = require("vm"), os = require("os");
const REPO = path.resolve(__dirname, "../.."), JS = path.join(REPO, "src/s2/js"), FIX = path.join(os.homedir(), "Developer/cghl-private/fixtures");
let n = 0, fail = 0;
const A = (name, cond, info) => { n++; if (cond) console.log("PASS " + name); else { fail++; console.log("FAIL " + name + (info !== undefined ? " :: " + JSON.stringify(info).slice(0, 400) : "")); } };
const need = (f) => { const p = path.join(FIX, f); if (!fs.existsSync(p)) { console.log("FAIL missing private input " + p); process.exit(1); } return p; };
const S1 = JSON.parse(fs.readFileSync(need("s2_league-anon-2026-11-24b-season1.json"), "utf8"));
const CUR = JSON.parse(fs.readFileSync(need("s2_league-anon-2026-11-24b-current.json"), "utf8"));
const FIXTURE = fs.readFileSync(need("snapshot-2026-10-19.js"), "utf8");
const ENGINE = fs.readFileSync(path.join(JS, "cg-engine.js"), "utf8"), MODEL = fs.readFileSync(path.join(JS, "model.js"), "utf8");
const clone = (x) => JSON.parse(JSON.stringify(x));

function page(pre) {
  const ctx = { console: { log() {}, warn() {}, error: (...a) => ctx.errors.push(a.join(" ")) }, errors: [], Intl, Date, Math, Object, Array, String, Number, JSON, Set, Map };
  ctx.window = ctx; vm.createContext(ctx);
  pre(ctx);
  vm.runInContext(ENGINE, ctx, { filename: "cg-engine.js" });
  vm.runInContext(MODEL, ctx, { filename: "model.js" });
  return ctx;
}
const live = (body, archive) => page((c) => { c.S2 = { data: { source: "live", body: clone(body), archive: archive ? clone(archive) : null } }; });

console.log("## Season 1 from the live body equals the classic engine");
const L1 = live(S1), M1 = L1.S2.M, CG = L1.S2.CG;
A("Season 1 builds with no error logged", L1.errors.length === 0, L1.errors);
/* the classic path, step by step as src/live/part_live.js buildLiveLeague takes it, on the same body */
const classic = (() => {
  const teams = S1.teams, id2code = {}, code2id = {}; teams.forEach((t) => { id2code[t.id] = t.code; code2id[t.code] = t.id; });
  CG.TEAMS = teams.map((t) => ({ id: t.id, code: t.code, div: t.division })); CG.TEAM = {}; CG.TEAMS.forEach((t) => { CG.TEAM[t.code] = t; }); CG.SEASON = { completedWeeks: 0 };
  const rows = {}; Object.keys(S1.box.byGame).forEach((gid) => { rows[gid] = S1.box.byGame[gid].map((a) => { const r = {}; S1.box.cols.forEach((c, i) => { r[c] = a[i]; }); r.team_id = code2id[r.team]; return r; }); });
  const sched = S1.games.map((g) => CG.liveGame(g, id2code, null));
  const results = sched.filter(CG.countedFinal).map((g) => { const score = {}, shots = {}; score[g.home] = g.homeScore; score[g.away] = g.awayScore; shots[g.home] = g.homeShots; shots[g.away] = g.awayShots;
    return { id: g.id, week: g.week, stage: g.stage, home: g.home, away: g.away, at: g.at, ot: g.ot, score, box: CG.gameBox(g, rows[g.id], id2code), shots, forfeit: g.forfeit || null }; });
  const byTeam = {}; CG.TEAMS.forEach((t) => { byTeam[t.code] = []; });
  const players = S1.rosters.spots.map((s) => ({ id: s.profile_id, team: s.team, pos: s.position })); players.forEach((p) => byTeam[p.team].push(p));
  const lg = { players, byTeam, schedule: sched, results: [], formerPlayers: [] };
  const regMax = Math.max(...sched.filter((g) => g.stage === "regular" && g.status === "final").map((g) => g.week));
  CG.aggregateStages(lg, CG.splitStages(results), { pre: 0, all: 0, reg: regMax });
  return lg;
})();
for (const div of ["East", "West"]) {
  const want = CG.standings(classic, div).map((r) => [r.code, r.gp, r.w, r.l, r.otl, r.pts, r.rw, r.gf, r.ga]);
  const got = M1.standings().filter((d) => d.division === div)[0].rows.map((r) => [r.code, r.gp, r.w, r.l, r.otl, r.pts, r.rw, r.gf, r.ga]);
  A(div + ": the model's table is the classic engine's, club for club and in the same order", JSON.stringify(got) === JSON.stringify(want), { got, want });
}
const lgTable = M1.standings("league").map((r) => r.code), cl = CG.standings(classic).map((r) => r.code);
A("the league table's order is CG.standings' (Rule 8.1 points, Rule 8.2 tiebreakers)", JSON.stringify(lgTable) === JSON.stringify(cl), { lgTable, cl });
A("every regular-season final is counted (216), the 25 playoff games are not", M1.standings().reduce((a, d) => a + d.rows.reduce((b, r) => b + r.gp, 0), 0) === 2 * S1.games.filter((g) => g.stage === "regular" && g.status === "final" && !g.voided).length);
/* every line counts: the model's regular-season skating and goalie lines add up to every linked regular box line */
const regIds = new Set(S1.games.filter((g) => g.stage === "regular" && g.status === "final" && !g.voided).map((g) => g.id));
const col = (k) => S1.box.cols.indexOf(k);
let goals = 0, saves = 0, lines = 0; const twoRole = new Set(), roles = {};
Object.keys(S1.box.byGame).forEach((gid) => { if (!regIds.has(gid)) return; S1.box.byGame[gid].forEach((r) => { const pid = r[col("profile_id")]; if (!pid) return;
  lines++; if (r[col("is_goalie")]) saves += r[col("saves")]; else goals += r[col("goals")]; (roles[pid] = roles[pid] || new Set()).add(r[col("is_goalie")] ? "G" : "S"); }); });
Object.keys(roles).forEach((k) => { if (roles[k].size === 2) twoRole.add(k); });
const ml = M1.lines();
A("every linked regular-season goal is on a skating line (every line counts, any club, rostered or not)", ml.filter((l) => l.role === "S").reduce((a, l) => a + l.g, 0) === goals, [goals]);
A("every linked regular-season save is on a goalie line", ml.filter((l) => l.role === "G").reduce((a, l) => a + l.sv, 0) === saves, [saves]);
A("a player who played both roles has both lines (v4.08)", twoRole.size > 0 && [...twoRole].every((pid) => M1.player(pid).roles.length === 2), [...twoRole].length);
A("a former player's games count: lines exist for players on no Season 1 roster", ml.some((l) => l.former));
A("the season line equals the classic engine's for every player (games, goals, assists, points, saves)",
  ml.every((l) => { const s = classic.pstats[l.pid]; return !s || ((l.role === "G" ? s.gs : s.sgp) === l.gp && (l.role === "G" ? s.sv === l.sv && s.ga === l.ga : s.g === l.g && s.a === l.a && s.p === l.p)); }));
A("the playoff line is a career row of its own (v4.09)", M1.career(M1.examples.pointsLeader).some((r) => r.stage === "po") && M1.career(M1.examples.pointsLeader).some((r) => r.stage === "reg"));
const withMatch = S1.games.filter((g) => g.ea_match_id);
A("every game carries EA's match id as eaMatchId, null when EA has none (the game desk finds a held game by it)", withMatch.length > 0 &&
  S1.games.every((g) => { const m = M1.games.filter((x) => x.id === g.id)[0]; return m && m.eaMatchId === (g.ea_match_id || null); }) && M1.games.some((x) => x.eaMatchId === null), withMatch.length);
A("club shots are EA's count on the game (v4.45); time on attack is not recorded, never 0", (() => { const g = M1.games.filter((x) => x.hasBox)[0], gm = M1.game(g.id); return gm.totals[g.home].toa === null && M1.clubStats(g.home).toa_pg === null; })());

console.log("## Season 1's close equals the values read from production");
const fx = (() => { const c = { window: {} }; vm.runInNewContext(FIXTURE, c); return c.window.S2DATA; })();
const want = fx.close && fx.close[1], got = M1.seasonClose(1);
A("the fixture carries the close as data (fixture-additions-2026-11-24.cjs)", !!want);
A("the final table: record, points, goals and how each season ended", got && want && JSON.stringify(got.table.map((r) => [r.club, r.w, r.l, r.otl, r.pts, r.gf, r.ga, r.out])) === JSON.stringify(want.table.map((r) => [r.club, r.w, r.l, r.otl, r.pts, r.gf, r.ga, r.out])), got && got.table);
A("the seven trophies: holders, series and totals", JSON.stringify(M1.trophies(1).map((t) => [t.key, t.club, t.id || null, t.over || null, t.w == null ? null : t.w, t.l == null ? null : t.l, t.total == null ? null : t.total, t.gp == null ? null : t.gp]))
  === JSON.stringify(want.trophies.map((t) => [t.key, t.club, t.pid || null, t.over || null, t.w == null ? null : t.w, t.l == null ? null : t.l, t.total == null ? null : t.total, t.gp == null ? null : t.gp])), M1.trophies(1).map((t) => t.key + " " + t.club));
A("the Cup goes to the twenty on the champion's roster at the final", got && JSON.stringify(got.cup.slice().sort()) === JSON.stringify(want.cup.slice().sort()), got && got.cup.length);
A("the four statistical titles as filed, with games and totals", JSON.stringify(M1.filedTitles(1).map((t) => [t.category, t.club, t.gp, t.total, t.value])) ===
  JSON.stringify([["points_title", "VAN", 35, 172, 4.914], ["goals_title", "VAN", 35, 102, 2.914], ["assists_title", "BOS", 14, 36, 2.571], ["goaltending_title", "DET", 25, 67, 2.68]]));
A("every Player of the Week of the season, six weeks", M1.honors.potwSeason(1).length === S1.honors.filter((h) => h.season === 1 && /^potw_/.test(h.category)).length && Math.max(...M1.honors.potwSeason(1).map((h) => h.week)) === 6);

console.log("## the seasons come from their rows, with no overlay");
const row2 = S1.seasons.filter((s) => s.number === 2)[0];
A("the Season 2 row says $30M and ten rounds (v4.58), and the model reads both from it", row2.salary_cap === 30000000 && row2.draft_rounds === 10 && M1.RULES.s2.cap === row2.salary_cap && M1.RULES.s2.draftRounds === row2.draft_rounds && M1.RULES.s2.limit === row2.roster_max);
const moved = clone(S1); moved.seasons.forEach((s) => { if (s.number === 2) { s.salary_cap = 31000000; s.draft_rounds = 11; s.draft_at = "2026-12-14T02:00:00+00:00"; } });
const L2 = live(moved);
A("a changed row changes the model: cap, rounds and the draft night follow the row", L2.S2.M.RULES.s2.cap === 31000000 && L2.S2.M.RULES.s2.draftRounds === 11 && L2.S2.M.s2cal.draft === "2026-12-14T02:00:00.000Z");
A("the model holds no overlay and no hand-copied result (RULED, S1_FINAL, FILED_TITLES, SEASON_CLOSE, LATE_POTW are gone)", !/\b(RULED|S1_FINAL|FILED_TITLES|SEASON_CLOSE|LATE_POTW)\b/.test(MODEL) && !/30000000|30,000,000/.test(MODEL));
A("Season 1's floor is the row's 14 (v4.43)", M1.RULES.s1.floor === 14 && M1.playoffFormat.minGp === 14);
const cal = M1.s2cal;
A("Season 2's nights are CG.gameNights on the row: Dec 16, then Jan 6 to Feb 3, three nights a week", cal.nights.length === 18 && cal.nights[0].key === "2026-12-16" && cal.nights[3].key === "2027-01-06" && cal.nights[17].key === "2027-02-05");
A("bid nights are the Saturdays after the draft before the deadline, holiday weeks skipped", JSON.stringify(cal.bidNights.map((b) => b.key + (b.skipped ? "-" : ""))) === JSON.stringify(["2026-12-19", "2026-12-26-", "2027-01-02-", "2027-01-09", "2027-01-16"]), cal.bidNights.map((b) => b.key));
A("with no schedule yet, the deadline is projected from the planned week four (Rule 2.4), and says so", cal.deadlineProjected === true && cal.deadline === "2027-01-23T05:00:00.000Z", cal.deadline);
A("the clock is the read's own moment, never Oct 19", M1.now.toISOString() === new Date(S1.generated).toISOString());

console.log("## Season 2 on screen: empty is real, Season 1's honors stay");
const L3 = live(CUR, (() => { const a = clone(S1); return { generated: a.generated, source: "live", season: 1, sections: ["games", "box", "tenures"], games: a.games, box: a.box, tenures: a.tenures, pulse: a.pulse }; })()), M3 = L3.S2.M;
A("Season 2 builds with no error logged", L3.errors.length === 0, L3.errors);
A("the view says Season 2, upcoming, with no games, finals, rosters or lines, and its sign-ups", M3.view.season === 2 && M3.view.status === "upcoming" && M3.view.empty.games && M3.view.empty.finals && M3.view.empty.rosters && M3.view.empty.lines && M3.signups.length === CUR.signups.length && CUR.signups.length > 0);
A("the Season page's count of sign-ups is the body's, not a fixture's", M3.control.seasonReturn.signedUp === CUR.signups.length && M3.control.kpis.filter((k) => k.key === "s2_signups")[0].value === CUR.signups.length);
A("a signed-up member is a player at the position they signed up for", M3.signups.every((s) => s.player && s.player.signup && s.player.pos));
A("every club is in the table with a clean record", M3.standings().reduce((a, d) => a + d.rows.length, 0) === CUR.teams.length && M3.standings().every((d) => d.rows.every((r) => r.gp === 0)));
A("Season 1's close is counted from the archive read: the same table, trophies and Cup", JSON.stringify(M3.seasonClose(1)) === JSON.stringify(M1.seasonClose(1)) && JSON.stringify(M3.trophies(1).map((t) => t.key + t.club + t.id)) === JSON.stringify(M1.trophies(1).map((t) => t.key + t.club + t.id)));
A("the Cup is on all twenty profiles in the Season 2 view", M3.players.filter((p) => p.honors.some((h) => h.key === "stanley_cup")).length === 20);
A("what the body does not carry is named (desk, control, jobs, title race)", ["desk", "control", "jobs", "titles"].every((k) => typeof M3.partial[k] === "string"));
const L4 = live(CUR), M4 = L4.S2.M;
A("without the archive, Season 1's close is absent and M.partial.archive says how to open it", M4.seasonClose(1) === null && M4.trophies(1).length === 0 && /\?season=1/.test(M4.partial.archive || ""), M4.partial.archive);

console.log("## QA round 2: one definition of a complete draft (M.draftDone)");
{
  const pre = M4.draftDone(), st = M4.draft.state && M4.draft.state.status;
  L4.S2.market = { status: () => ({ loaded: false, draftDone: true }) }; const unread = M4.draftDone();
  L4.S2.market = { status: () => ({ loaded: true, draftDone: true }) }; const marketSays = M4.draftDone();
  delete L4.S2.market;
  const LD = live(Object.assign(clone(CUR), { draft: { state: { status: "complete", season_number: 2 }, picks: [] } })), MD = LD.S2.M;
  const live2 = MD.draftDone(); MD.draft.state = { status: "live", season_number: 2 }; const nowLive = MD.draftDone();
  A("before Season 2's draft is complete M.draftDone() is false, and a market not yet read cannot make it true", pre === false && st !== "complete" && unread === false, { pre, st, unread });
  A("the market's own draft_done, once read, makes it true", marketSays === true);
  A("draft_state complete in the league read makes it true, read as the draft stands when asked (the pulse and Realtime move it)", LD.errors.length === 0 && live2 === true && nowLive === false, { errors: LD.errors, live2, nowLive });
}

console.log("## QA round 2: the title race, read once in the model (M.readTitles)");
/* asynchronous: its lines print as it goes, and the loader's block below waits for it before the count */
const TITLES = (async () => {
  const S1ID = S1.seasons.filter((s) => s.number === 1)[0].id;
  /* S2.rd as js/live.js answers (the list form): the board, a refusal, or a read held open */
  const door = (L, answer) => { const calls = []; L.S2.rd = (q, o) => { let asked = null; q({ rpc: (name, args) => { asked = { name, args, list: !!(o && o.list) }; return null; } }); calls.push(asked); return answer(asked); }; return calls; };
  const LT = live(S1), MT = LT.S2.M, ids = MT.players.filter((p) => p.lines.S).slice(0, 2).map((p) => p.id), [PA, PB] = ids;
  /* js/live.js on the same page, so a re-read is the one the site runs (S2.reread: the pulse, a write, the draft room,
     load.js matchViewer), never a hand-made S2.buildModel with a new stamp. The league read is a stand-in that answers
     the sections asked for from the Season 1 body, stamped LT.at (QA round 2: the check that called S2.buildModel with
     a new generated passed while S2.reread kept the first read's moment for the life of the page) */
  Object.assign(LT, { document: { addEventListener() {}, querySelector() { return null; } }, location: { hash: "", search: "", hostname: "localhost" }, setTimeout, clearTimeout });
  Object.assign(LT.S2, { session: {}, live: { emit() {}, on() {} }, route() {} });
  vm.runInContext(fs.readFileSync(path.join(JS, "live.js"), "utf8"), LT, { filename: "live.js" });
  LT.S2.LIVE = true;
  const reads = [];
  LT.S2.load = { read: (season, want, gids) => { reads.push(season + ":" + want.join()); const part = { generated: LT.at, source: "live", season: S1.season, sections: want };
    want.forEach((k) => { part[k] = clone(S1[k]); }); return Promise.resolve(part); } };
  const board = (pts) => [{ category: "points_title", place: 2, profile_id: PB, gamertag: null, gp: 10, total: 15, per_game: "1.500" },
    { category: "points_title", place: 1, profile_id: PA, gamertag: "Tag A", gp: 10, total: pts, per_game: pts / 10 },
    { category: "goaltending_title", place: 1, profile_id: PA, gamertag: "Tag A", gp: 8, total: 20, per_game: 2.5 }, { category: "not_a_title", place: 1, profile_id: PA }];
  const pre = { partial: typeof MT.partial.titles, rows: MT.titles().length, needed: MT.titlesNeeded(), err: MT.titlesErr() };
  let calls = door(LT, () => Promise.resolve(board(20)));
  const first = await MT.readTitles();
  const pts = MT.titles("points_title"), g = MT.titles("goaltending_title");
  A("before the read the race is named as not carried, needed, and no error", pre.partial === "string" && pre.rows === 0 && pre.needed === true && pre.err === null, pre);
  A("one read of statistical_title_board for the season on screen, five a title, through S2.rd's list form", first === null && calls.length === 1 && calls[0].name === "statistical_title_board" && calls[0].args.p_season === S1ID && calls[0].args.p_top === 5 && calls[0].list, calls);
  A("the board lands where every page reads the race: M.titles in place order, M.honors.titles, M.leaders, and M.partial.titles goes",
    MT.partial.titles === undefined && pts.map((t) => t.rank).join() === "1,2" && pts[0].tag === "Tag A" && pts[1].tag === MT.player(PB).tag && pts[1].value === 1.5 && g[0].display === "2.50 GAA" &&
    MT.honors.titles.points_title.length === 2 && MT.leaders("points_title")[0].id === PA && MT.titles().every((t) => t.category !== "not_a_title"), pts);
  A("each player in the race carries it on their profile (title_race honors)", MT.player(PA).honors.filter((h) => h.kind === "title_race").map((h) => h.category + h.place).sort().join() === "goaltending_title1,points_title1" &&
    MT.player(PB).honors.some((h) => h.kind === "title_race" && h.place === 2));
  await MT.readTitles();
  A("read once: a second ask in the same league read asks nothing", calls.length === 1 && MT.titlesNeeded() === false);
  const gen0 = MT.generated;
  LT.at = "2026-11-25T00:00:00.000Z";
  const ok = await LT.S2.reread(["games"]);   /* what a final changes */
  const back = { ok, reads: reads.join("|"), gen: MT.generated, now: MT.now.toISOString(), body: LT.S2.data.body.generated, partial: MT.partial.titles, n: MT.titles("points_title").length,
    honor: MT.player(PA).honors.some((h) => h.kind === "title_race"), needed: MT.titlesNeeded() };
  A("a re-read of the league (S2.reread) moves the model's moment to the read's: M.generated, M.now and the body's stamp", gen0 === S1.generated && back.ok === true && back.reads === "1:games" &&
    back.gen === LT.at && back.now === LT.at && back.body === LT.at, back);
  A("after it the last board is back at once (no fall back to loading) and the race is read again", back.partial === undefined && back.n === 2 && back.honor && back.needed, back);
  LT.at = "2026-11-24T00:00:00.000Z"; const older = await LT.S2.reread(["games"]);
  A("a read stamped earlier than the body never moves the clock back", older === true && MT.generated === "2026-11-25T00:00:00.000Z" && MT.now.toISOString() === "2026-11-25T00:00:00.000Z", MT.generated);
  LT.at = null; const errs0 = LT.errors.length, unstamped = await LT.S2.reread(["games"]);
  A("a read with no moment is refused like a read missing a section: the re-read fails, is said, and the model stays", unstamped === false && MT.generated === "2026-11-25T00:00:00.000Z" &&
    LT.errors.slice(errs0).some((e) => /did not return generated/.test(e)), LT.errors.slice(errs0));
  /* a read that lands after another rebuild goes into the build on screen, not the one that asked */
  let release; calls = door(LT, () => new Promise((res) => { release = () => res(board(30)); }));
  const held = MT.readTitles(); await new Promise((r) => setTimeout(r, 0));   /* the read is asked on the next tick */
  LT.at = "2026-11-25T00:05:00.000Z"; await LT.S2.reread(["games"]);
  release(); await held;
  A("a read that lands after a rebuild fills the build on screen (its players too)", MT.titles("points_title")[0].total === 30 && MT.player(PA).honors.some((h) => h.kind === "title_race" && h.place === 1), MT.titles("points_title")[0]);
  /* a failure */
  const LF = live(S1), MF2 = LF.S2.M, boom = new Error("canceling statement due to statement timeout");
  calls = door(LF, () => Promise.reject(boom));
  const said = await MF2.readTitles();
  A("a failed read settles with the Error (never rejects), is said in the console, and M.titlesErr() holds it while the race stays 'not carried'",
    said === boom && MF2.titlesErr() === boom && typeof MF2.partial.titles === "string" && LF.errors.some((e) => /title race could not be read/.test(e)), { said: String(said), errs: LF.errors });
  await MF2.readTitles();
  A("a failure is not read again by itself (a page repainting on it never loops); Try again asks once more", calls.length === 1 && MF2.titlesNeeded() === false);
  calls.length = 0; LF.S2.rd = (q, o) => Promise.resolve(board(20)); await MF2.readTitles(true);
  A("Try again (M.readTitles(true)) reads, clears the error and fills the race", MF2.titlesErr() === null && MF2.titles("points_title").length === 2 && MF2.partial.titles === undefined);
  /* a throw while the rows are put (an unexpected row shape) is a failed read too, and Try again still runs */
  const put = MF2._titles.put, oops = new Error("the rows could not be put"); MF2._titles.put = () => { throw oops; };
  const thrown = await MF2.readTitles(true), heldErr = MF2.titlesErr(); MF2._titles.put = put;
  const retried = await MF2.readTitles(true);
  A("a throw while putting the rows settles like a failed read (the Error, said, kept), and Try again still reads after it",
    thrown === oops && heldErr === oops && retried === null && MF2.titlesErr() === null && MF2.titles("points_title").length === 2, { thrown: String(thrown), retried: String(retried) });
  /* the fixture carries its own race */
  const F2 = page((c) => { vm.runInContext(FIXTURE, c); }); let fx2 = 0; F2.S2.rd = () => { fx2++; return Promise.resolve([]); };
  A("the fixture's own race is never read (not live)", F2.S2.M.titlesNeeded() === false && (await F2.S2.M.readTitles()) === null && fx2 === 0);
})().catch((e) => { A("the title race checks ran", false, String(e && e.stack || e)); });

console.log("## nothing made up: the demo devices are gone from the model (i3a, 2026-11-25)");
A("no sample game night, no result writer, no stand-in Season 2 rosters", M4.gameNightDemo === undefined && M4.setResult === undefined && M4.restand === undefined && M4.s2Standins === undefined && M4.s2StandinNote === undefined);
A("Season 1 keeps its rosters as they were (the stand-in trimmed every club to twelve): no player is marked a stand-in", M1.players.every((p) => !p.s2Standin) && M1.teams.some((t) => M1.roster(t.code).active.length > 12),
  M1.teams.map((t) => M1.roster(t.code).active.length));
A("no placeholder staff, commissioners or staff activity", M4.desk.staff.length === 0 && M4.desk.commissioners.length === 0 && M4.desk.activity.length === 0);
A("every club carries its teams.id, which every door names", M4.teams.length > 0 && M4.teams.every((t) => /^[0-9a-f-]{36}$/.test(t.id || "")) && M1.teams.every((t) => !!t.id));
/* gaps (2026-11-25): this check pinned "The training camp pool from puck drop", wording the review found wrong (the pool
   forms at the draft; Rules S2.3 and S2.5) */
A("the camp pool and bidding step says what runs, never a build owed: the pool forms at the draft, requests are per game", /^The training camp pool forms at the draft, .+ Clubs request pool players one game at a time \(Rule S2\.5\)/.test(M4.control.setup.filter((x) => x.key === "pool")[0].detail) &&
  !/puck drop/.test(M4.control.setup.filter((x) => x.key === "pool")[0].detail) && M4.control.setup.filter((x) => x.key === "pool")[0].state === "todo", M4.control.setup.filter((x) => x.key === "pool")[0].detail);

console.log("## the trade reading lives with its renderer (js/trade.js), never in the demo kit");
{
  const TRADE = fs.readFileSync(path.join(JS, "trade.js"), "utf8");
  L1.S2.esc = (v) => String(v == null ? "" : v);
  vm.runInContext(TRADE, L1, { filename: "trade.js" });
  const T = L1.S2.trade, M = L1.S2.M;
  A("trade.js loads on the model with no error (its self-check against the live verdict passes)", L1.errors.length === 0 && typeof T.evaluate === "function" && typeof T.playerEval === "function" && typeof T.check === "function", L1.errors);
  A("trade.js never reaches into the demo kit", !/S2\.demo/.test(TRADE));
  const clubs = M.teams.filter((t) => M.roster(t.code) && M.roster(t.code).active.length >= 3).slice(0, 2);
  const a = clubs[0].code, b = clubs[1].code, send = M.roster(a).active.slice(0, 2).map((p) => p.id), get = M.roster(b).active.slice(0, 1).map((p) => p.id);
  const ev = T.evaluate({ from: a, to: b, send, get });
  A("a Season 1 trade reads both sides: what each club receives is the other side's value, and the shares add to one",
    ev.receives[a] === ev.sides[1].value && ev.receives[b] === ev.sides[0].value && Math.abs(ev.share[a] + ev.share[b] - 1) < 1e-9 && ev.sides[0].players.length === 2 && ev.sides[1].players.length === 1, ev.reading);
  A("each side's value is the sum of its players' (CG.tradeSide)", ev.sides[0].value === send.reduce((s, id) => s + T.tradeValue(id).value, 0));
  A("the check places every player on the club that receives them", ev.check && ev.check.placements.length === 3 && ev.check.placements.every((pl) => pl.club === (send.indexOf(pl.pid) >= 0 ? b : a)), ev.check && ev.check.placements);
  A("the reading has a headline and an Even, lean or lopsided verdict", !!ev.headline.lead && ["even", "favors"].indexOf(ev.reading.state) >= 0);
  A("an empty trade reads as empty, never as even", T.evaluate({}).reading.state === "empty");
}

console.log("## refilled in place, and a missing section is an error");
const before = L1.S2.M; L1.S2.buildModel(clone(CUR));
A("S2.buildModel refills the same S2.M object (pages keep M = S2.M from load)", L1.S2.M === before && L1.S2.M.view.season === 2 && L1.S2.M.lines().length === 0);
let msg = ""; try { const b = clone(S1); b.sections = b.sections.filter((s) => s !== "tenures"); delete b.tenures; L1.S2.buildModel(b); } catch (e) { msg = e.message; }
A("a body without a section is refused, naming it", /tenures/.test(msg), msg);

console.log("## the fixture still builds the same way");
const F = page((c) => { vm.runInContext(FIXTURE, c); }), MF = F.S2.M;
A("the Oct 19 fixture builds with no error logged", F.errors.length === 0, F.errors);
A("fixture mode reads the fixture's rows: $30M, ten rounds, the floor of 14", MF.RULES.s2.cap === 30000000 && MF.RULES.s2.draftRounds === 10 && MF.RULES.s1.floor === 14);
A("fixture mode's close is the fixture's data", JSON.stringify(MF.seasonClose(1).cup) === JSON.stringify(fx.close[1].cup));

console.log("## no member is named in the committed model, engine or loader");
const tags = Array.from(new Set(S1.people.map((p) => p.gamertag).filter((t) => t && t.length >= 5)));
const files = { "model.js": MODEL, "cg-engine.js": ENGINE, "load.js": fs.readFileSync(path.join(JS, "load.js"), "utf8") };
const named = []; Object.keys(files).forEach((f) => tags.forEach((t) => { if (new RegExp("(^|[^A-Za-z0-9_])" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^A-Za-z0-9_])").test(files[f])) named.push(f); }));
A("no gamertag of five or more letters appears in them (as written; M.examples names no member)", named.length === 0, named);

console.log("## the loader and the page");
const LOAD = files["load.js"], HTML = fs.readFileSync(path.join(REPO, "src/s2/demo.html"), "utf8");
const list = (HTML.match(/<template id="s2-scripts">([\s\S]*?)<\/template>/) || [])[1] || "";
const srcs = [...list.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
A("demo.html lists the scripts once, in a template the loader reads, the engine before the model", srcs.indexOf("js/cg-engine.js") >= 0 && srcs.indexOf("js/cg-engine.js") < srcs.indexOf("js/model.js") && srcs[0] === "js/core.js");
/* i3f (2026-11-25): the private fixture's tag left the shell with fixture mode, so the loader always reads s2_league */
A("outside the template the page runs only the loader and S2_START (no fixture tag)", (HTML.replace(/<template[\s\S]*?<\/template>/, "").match(/<script src="[^"]+"><\/script>/g) || []).join() === '<script src="js/load.js"></script>' && /window\.S2_START = function/.test(HTML) && !/snapshot\.js/.test(HTML));
A("live mode posts s2_league with the public key, and the member's token only when there is one", /\/rest\/v1\/rpc\/s2_league/.test(LOAD) && /apikey: KEY/.test(LOAD) && /if \(token\) headers\.Authorization = "Bearer " \+ token/.test(LOAD) && /S2\.session && S2\.session\.accessToken/.test(LOAD));
A("the archive read asks only for games, box scores and tenures", /\["games", "box", "tenures"\]/.test(LOAD));
A("a failed read stops at a message, never a half-drawn page (401, 42501, P0002, timeouts, network)", ["401", "42501", "P0002", "57014", "AbortError", "TypeError"].every((k) => LOAD.indexOf(k) >= 0) && /catch\(fail\)/.test(LOAD));
A("the key is the publishable one, never a secret or a JWT", /sb_publishable_/.test(LOAD) && !new RegExp("sb_" + "secret_|eyJ[A-Za-z0-9_-]{10,}").test(LOAD));

/* the loader itself, run in a vm with a stand-in page: localStorage, fetch and the template. Each run is one visit */
const UID = "00000000-0000-4000-8000-000000000001", TOKEN = "header.payload.sig";
function visit(o) {
  const calls = [], warns = [], errs = [], app = { innerHTML: "" }, store = Object.assign({}, o.store || {});
  const ctx = { console: { log() {}, warn: (...a) => warns.push(a.join(" ")), error: (...a) => errs.push(a.join(" ")) }, JSON, Date, Math, Object, Array, String, Number, Promise, URLSearchParams, setTimeout, clearTimeout,
    location: { search: "?source=live", reload() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { getElementById: (id) => (id === "app" ? app : id === "s2-scripts" ? { content: { querySelectorAll: () => [{ getAttribute: () => "js/core.js" }] } } : null),
      createElement: () => ({}), body: { appendChild() {} } },
    addEventListener() {}, removeEventListener() {},
    fetch: (url, init) => { const auth = init.headers.Authorization || null, args = JSON.parse(init.body); calls.push({ url, auth, args });
      const status = o.answer ? o.answer(auth, args) : 200, body = status === 200 ? Object.assign({ season: 2, games: [], seasons: [], sections: ["games", "box"] }, o.body || {}) : { code: "PGRST301", message: "JWT expired" };
      return Promise.resolve({ ok: status === 200, status, text: () => Promise.resolve(JSON.stringify(body)) }); } };
  ctx.window = ctx; vm.createContext(ctx);
  if (o.session) ctx.S2 = { session: o.session };
  vm.runInContext(LOAD, ctx, { filename: "load.js" });
  return { ctx, calls, warns, errs, app, store, S2: ctx.S2 };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const KEY = "sb-bzbuyclwdhmhdzujxeqd-auth-token", future = Math.floor(Date.now() / 1000) + 3600;
const stored = (exp) => ({ [KEY]: JSON.stringify({ access_token: TOKEN, refresh_token: "r", expires_at: exp, user: { id: UID } }) });

(async () => {
  console.log("## the loader: game ids, the stored sign-in, a refused one, and the read after sign-in");
  let v = visit({}); await settle();
  A("a visitor's first read goes out with the public key alone and is read as a visitor", v.calls.length === 1 && v.calls[0].auth === null && v.S2.data.readAs === null, v.calls);
  const ids = ["11111111-1111-4111-8111-111111111111"];
  await v.S2.load.read(1, ["games", "box"], ids);
  A("S2.load.read passes its third argument as p_game_ids (s2_league(integer, text[], uuid[]) on production, read 2026-11-24)", JSON.stringify(v.calls[1].args) === JSON.stringify({ p_season: 1, p_sections: ["games", "box"], p_game_ids: ids }), v.calls[1].args);
  await v.S2.load.read(1, ["box"], []);
  A("no game ids, no p_game_ids (an empty list is never sent)", !("p_game_ids" in v.calls[2].args));
  v = visit({ store: stored(future) }); await settle();
  A("the first read of a visit carries the stored sign-in's token (sb-<project>-auth-token, the current site's client)", v.calls[0].auth === "Bearer " + TOKEN && v.S2.data.readAs === UID, v.calls[0]);
  v = visit({ store: stored(Math.floor(Date.now() / 1000) - 60) }); await settle();
  A("an expired stored sign-in is not sent: a visitor's read, said in the console", v.calls[0].auth === null && v.S2.data.readAs === null && v.warns.some((w) => /expired/.test(w)));
  v = visit({ store: stored(future), answer: (auth) => (auth ? 401 : 200) }); await settle();
  A("a refused sign-in (401) reads again as a visitor, said in the console, never the error screen",
    v.calls.length === 2 && v.calls[0].auth && v.calls[1].auth === null && v.S2.data && v.S2.data.readAs === null && v.warns.some((w) => /refused/.test(w)) && !/role="alert"/.test(v.app.innerHTML), { calls: v.calls.map((c) => c.auth), app: v.app.innerHTML });
  v = visit({ answer: () => 503 }); await settle();
  A("a visitor's failed read still stops at the message", /did not answer/.test(v.app.innerHTML));
  /* sign-in: live.js fills S2.session and calls S2.load.matchViewer; the re-read goes through S2.reread, here a stand-in that reads */
  v = visit({}); await settle();
  let rereads = 0; v.S2.reread = (secs) => { rereads++; return v.S2.load.read(v.S2.data.body.season, secs).then(() => true); };
  v.S2.session = { profileId: UID, accessToken: "member.jwt.sig" };
  let changed = await v.S2.load.matchViewer();
  A("after sign-in the league is read again once, with the member's token, every section the body holds", changed === true && rereads === 1 && v.calls[1].auth === "Bearer member.jwt.sig" && JSON.stringify(v.calls[1].args.p_sections) === JSON.stringify(["games", "box"]) && v.S2.data.readAs === UID);
  changed = await v.S2.load.matchViewer();
  A("the same member again (a token refresh, a refocus) reads nothing", changed === false && rereads === 1);
  v.S2.session = { profileId: null, accessToken: null };
  changed = await v.S2.load.matchViewer();
  A("sign-out reads it again as a visitor, so a member's own fields go", changed === true && rereads === 2 && v.calls[2].auth === null && v.S2.data.readAs === null);
  A("live.js reads the league again as the member before it repaints after a session", /S2\.load\.matchViewer \? S2\.load\.matchViewer\(\)/.test(fs.readFileSync(path.join(JS, "live.js"), "utf8")));
  A("live.js merges named games by id, games and box alike (p_game_ids narrows both)", /if \(k === "games"\) \{ b\.games = \(b\.games \|\| \[\]\)\.filter\(function \(g\) \{ return ids\.indexOf\(g\.id\) < 0; \}\)\.concat\(part\.games\)/.test(fs.readFileSync(path.join(JS, "live.js"), "utf8")));

  await TITLES;
  console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL the loader checks threw: " + (e && e.stack || e)); process.exit(1); });
