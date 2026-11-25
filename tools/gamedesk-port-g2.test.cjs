/* S2 swap, stream g2 (2026-11-24): the Season 2 Game desk (src/s2/js/pages/gamedesk.js) is a PORT of the classic Stats
   manager (src/live/part_live.js, CG._smS to CG._smFixGo: v4.36, v4.37, v4.50), not a rewrite. Statistics staff need on the
   new site, from Season 2's first game night (December 16), everything the classic desk does.
   1. The helpers that decide (which sittings are one game, what is ticked, what the action bar does, which forfeit a game
      allows, what a correction or a forfeit will record and post, which outside club is which) are lifted out of BOTH files
      and run on the same inputs: their answers must agree. Text differs only where the new site words it differently
      (" at " for " @ ", no "(FFL)", "switch" for "box"); the decisions may not.
   2. Every door the desk writes through is the classic site's own door, with the classic call's argument names, and goes
      through S2.write (contracts/client-api.md); reads are the staff reads the classic desk makes. No demo device is left.
   Plain Node, no browser: node tools/gamedesk-port-g2.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "src/s2/js/pages/gamedesk.js"), "utf8");
const LIVE = fs.readFileSync(path.join(ROOT, "src/live/part_live.js"), "utf8");
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 700) + ")")); if (!cond) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- the league the two copies read: one schedule, as the classic desk's CG.lg.schedule and the new site's S2.M ---------- */
const T = Date.parse("2026-12-16T23:00:00Z");   /* game night one, 6 PM ET: tests never read the clock */
const ET = (iso) => Date.parse(iso);
const etDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(ts);
/* model games (S2.M.games): the new site's own shape */
const MODEL = [
  { id: "gA", home: "PIT", away: "DAL", at: "2026-12-17T02:00:00Z", status: "scheduled", hs: null, as: null, ot: false, forfeit: null, voided: false, week: 1, stage: "regular", lines: 12, eaMatchId: "m1" },
  { id: "gB", home: "DAL", away: "PIT", at: "2026-12-17T02:35:00Z", status: "scheduled", hs: null, as: null, ot: false, forfeit: null, voided: false, week: 1, stage: "regular", lines: 0, eaMatchId: null },
  { id: "gC", home: "BOS", away: "SEA", at: "2026-12-17T02:00:00Z", status: "final", hs: 3, as: 2, ot: true, forfeit: null, voided: false, week: 1, stage: "regular", lines: 12, eaMatchId: "m9", isFinal: true },
  { id: "gD", home: "NYI", away: "UTA", at: "2026-12-17T02:00:00Z", status: "final", hs: 1, as: 0, ot: false, forfeit: "UTA", voided: false, week: 1, stage: "regular", lines: 0, eaMatchId: null, isFinal: true },
  { id: "gE", home: "VAN", away: "DET", at: "2026-12-17T03:10:00Z", status: "scheduled", hs: null, as: null, ot: false, forfeit: null, voided: false, week: 1, stage: "regular", lines: 0, eaMatchId: null }
];

/* ---------- load the new site's file with the smallest page it needs ---------- */
function loadNew(commish) {
  const listeners = [];
  const M = { games: MODEL, now: new Date(T), etDay: (d) => etDay(d), sittings: () => [], game: (id) => MODEL.find((g) => g.id === id) || null, etTime: () => "9:00 PM", etDate: () => "Wed, Dec 16", etDateTime: () => "Wed, Dec 16, 9:00 PM ET" };
  const S2 = { session: { user: null }, _desk: { $: () => null, $$: () => [], M, MAC: true, TICKS: "", clock: String, comName: String, confirmSheet: () => {}, cur: () => null, esc: (x) => String(x),
    fadeBox: () => {}, ghostOut: () => {}, gs: () => null, ic: () => "", landOn: () => {}, manager: () => null, me: () => ({ commish: !!commish }), mgrBadge: () => "", nextNight: () => ({}),
    plural: (k, one, many) => (k === 1 ? one : k + " " + many), secHead: () => "", st: {}, stateBox: () => "", sum: (a) => a.reduce((x, y) => x + (+y || 0), 0), tag: () => "", teamName: String, R: "" } };
  const win = { S2, addEventListener: (t) => listeners.push(t) };
  const ctx = vm.createContext({ window: win, document: { addEventListener: (t) => listeners.push(t), activeElement: null }, location: { hash: "" }, setTimeout, Promise, Intl, Date, JSON, Math, Object, String, Array, Number, isNaN, parseInt, console });
  vm.runInContext(SRC, ctx, { filename: "gamedesk.js" });
  return { S2, P: S2._gamedesk.pure, listeners };
}

/* ---------- lift the classic helpers out of part_live.js by their exact names ---------- */
function classic(names, CG) {
  const ctx = vm.createContext({ CG, Date, JSON, Math, Object, String, Array, Intl, console });
  for (const nm of names) {
    const at = LIVE.indexOf("\nCG." + nm + " = function"); if (at < 0) throw new Error("part_live.js has no CG." + nm);
    const end = LIVE.indexOf("\n};\n", at); if (end < 0) throw new Error("CG." + nm + " never closes");
    vm.runInContext(LIVE.slice(at + 1, end + 3), ctx, { filename: "part_live.js CG." + nm });
  }
  return CG;
}
function loadClassic(commish, find) {
  const CG = { now: () => T, auth: { role: commish ? "commish" : "staff" }, fmtFull: () => "", fmtTime: () => "", fmtDay: () => "", isMakeUp: () => false, boxSides: () => [], boxLines: (x) => x,
    lg: { schedule: null, results: [] } };
  const st = { find: find };
  CG._smS = () => st;
  classic(["_smEtDay", "_smFx", "_smCommish", "_smScoreText", "_smHA", "_smGame", "_smKinds", "_smFfPosts", "_smFfWill", "_smFixCheck", "_smUnion", "_smWith", "_smFxGame",
    "_smGroups", "_smSelection", "_smMatchInfo", "_smMatchMap", "_smLengthText", "_smSitScore", "_smBar", "_smApplyTicks", "_smDropTicks"], CG);
  return { CG, st };
}
const wordsNew = (t) => String(t);
const wordsOld = (t) => String(t).replace(/ @ /g, " at ").replace(/ \(FFL\)/g, "").replace(/overtime box/g, "overtime switch").replace(/merge its sittings first/g, "file its sittings first");

/* the sittings the staff read (ingest-stats leagueSessions) answers, built to reach every branch */
const S = (o) => Object.assign({ source: "archive", clubs: [], onGame: false, struck: false, canMerge: true, canPickup: false, alternatives: [], ambiguous: false }, o);
const FX = (g, o) => Object.assign({ gameId: g, home: (MODEL.find((x) => x.id === g) || {}).home, away: (MODEL.find((x) => x.id === g) || {}).away, at: (MODEL.find((x) => x.id === g) || {}).at, status: "scheduled", held: false, forfeit: null, inWindow: true }, o || {});
const CLUBS = (a, b) => [{ eaId: "101", team: a, score: 2, via: "linked" }, { eaId: "102", team: b, score: 1, via: "linked" }];
const SESS = () => [
  S({ matchId: "m1", kind: "league", fixture: FX("gA"), endedAt: "2026-12-17T02:42:00Z", minutes: 40, length: "short", onGame: true, canMerge: true, clubs: CLUBS("DAL", "PIT") }),
  S({ matchId: "m2", kind: "league", fixture: FX("gA"), endedAt: "2026-12-17T03:05:00Z", minutes: 20, length: "short", canMerge: true, clubs: CLUBS("DAL", "PIT"), alternatives: [FX("gB")], ambiguous: true }),
  S({ matchId: "m3", kind: "league", fixture: FX("gA", { inWindow: false }), endedAt: "2026-12-17T01:20:00Z", minutes: 3, length: "short", struck: true, canMerge: false, clubs: CLUBS("DAL", "PIT") }),
  S({ matchId: "m4", kind: "needs-substitution", fixture: FX("gE"), endedAt: "2026-12-17T04:10:00Z", minutes: 60, length: "full", canMerge: false, source: "ea",
    clubs: [{ eaId: "101", team: "DET", score: 4, via: "linked" }, { eaId: "555", team: null, name: "Outside Club A", score: 3 }],
    subCandidates: [{ gameId: "gE", home: "VAN", away: "DET", at: MODEL[4].at, inWindow: true, borrower: "VAN" }] }),
  S({ matchId: "m5", kind: "not-league", fixture: null, endedAt: "2026-12-17T05:00:00Z", minutes: 60, length: "full", canMerge: false, canPickup: true, source: "ea",
    clubs: [{ eaId: "556", team: null, name: "Outside Club B", score: 1 }, { eaId: "557", team: null, name: "Outside Club C", score: 2 }],
    subCandidates: [{ gameId: "gE", home: "VAN", away: "DET", at: MODEL[4].at, inWindow: false }, { gameId: "gB", home: "DAL", away: "PIT", at: MODEL[1].at, inWindow: true }] }),
  S({ matchId: "m6", kind: "league", fixture: FX("gC", { status: "final" }), endedAt: "2026-12-17T03:01:00Z", minutes: 60, length: "full-ot", onGame: true, clubs: CLUBS("SEA", "BOS") }),
  S({ matchId: "m7", kind: "league", fixture: FX("gD", { status: "final", forfeit: "UTA" }), endedAt: "2026-12-17T02:30:00Z", minutes: 30, length: "short", canMerge: true, clubs: CLUBS("UTA", "NYI") })
];
const FIND = (o) => Object.assign({ focus: "gA", picked: {}, restart: false, moved: {}, tickAfter: null, sess: null }, o || {});
const shapeGroups = (grs) => grs.map((g) => ({ key: g.key, kind: g.kind, gameId: g.gameId, focus: g.focus, locked: g.locked, complete: g.complete, game: g.game && g.game.id, ks: g.sessions.map((s) => s.matchId + ":" + s._k) }));
const shapeSel = (s) => ({ ticked: s.ticked, groups: s.groups.map((g) => g.key), one: s.one && s.one.key, locked: s.locked, sel: s.sel, reFile: s.reFile, restartable: s.restartable });
const shapeBar = (b, words) => b && { err: !!b.err, mode: b.mode || null, restart: !!b.restart, title: words(b.title), caption: words(b.caption), btn: b.btn, act: b.act || null };

for (const commish of [false, true]) {
  const who = commish ? "a commissioner" : "a staffer";
  console.log("## the decisions, as " + who);
  const N = loadNew(commish);
  const sched = MODEL.map(N.P.sched);
  A("the schedule adapter reads the model's game as the classic schedule row", same(sched[0], { id: "gA", home: "PIT", away: "DAL", at: ET(MODEL[0].at), status: "scheduled", forfeit: null, voided: false, eaMatchId: "m1",
    homeScore: null, awayScore: null, ot: false, week: 1, stage: "regular", makeup: false, lines: 12, kept: false }), sched[0]);
  const cases = [
    ["nothing ticked, the focused held game", FIND()],
    ["a sitting ticked into the held game", FIND({ picked: { m2: true } })],
    ["a struck sitting ticked (never counts)", FIND({ picked: { m3: true } })],
    ["ticks under two games", FIND({ picked: { m2: true, m7: true } })],
    ["a restart with the on-game sitting unticked", FIND({ picked: { m2: true }, restart: true })],
    ["a sitting moved to the sibling game", FIND({ picked: { m2: true }, moved: { m2: "gB" } })],
    ["a not-league pair ticked", FIND({ picked: { m5: true }, focus: null })],
    ["a forfeit-ruled game's sitting ticked", FIND({ picked: { m7: true }, focus: "gD" })],
    ["five ticks (the four-sitting limit)", FIND({ picked: { m2: true, m1: true, m3: true, m7: true, m6: true } })]
  ];
  for (const [name, f0] of cases) {
    const fN = JSON.parse(JSON.stringify(f0)), fC = JSON.parse(JSON.stringify(f0));
    const C = loadClassic(commish, fC); C.CG.lg.schedule = sched.map((x) => Object.assign({}, x));
    const gN = N.P.groups(SESS(), fN), gC = C.CG._smGroups(SESS(), C.st);
    A(name + ": the same groups", same(shapeGroups(gN), shapeGroups(gC)), { new: shapeGroups(gN), classic: shapeGroups(gC) });
    const sN = N.P.selection(fN, gN), sC = C.CG._smSelection(C.st, gC);
    A(name + ": the same selection", same(shapeSel(sN), shapeSel(sC)), { new: shapeSel(sN), classic: shapeSel(sC) });
    const bN = N.P.bar(fN, gN, sN), bC = C.CG._smBar(C.st, gC, sC);
    A(name + ": the same action bar", same(shapeBar(bN, wordsNew), shapeBar(bC, wordsOld)), { new: shapeBar(bN, wordsNew), classic: shapeBar(bC, wordsOld) });
    for (const gr of gN) {
      const grC = gC.find((x) => x.key === gr.key), iN = N.P.matchInfo(gr), iC = C.CG._smMatchInfo(grC);
      A(name + ": the same outside clubs and candidate games for " + gr.key, same(iN, iC), { new: iN, classic: iC });
      for (const m of [{ gameId: "gE" }, { gameId: "gE", side: "VAN" }, { gameId: "gB", side: "PIT" }, { gameId: "gB", side: "BOS" }, { gameId: "zz" }])
        A(name + ": the same club map for " + gr.key + " " + JSON.stringify(m), same(N.P.matchMap(iN, m), C.CG._smMatchMap(iC, m)), { new: N.P.matchMap(iN, m), classic: C.CG._smMatchMap(iC, m) });
    }
  }
  /* forfeits and corrections, on every game */
  const C = loadClassic(commish, FIND()); C.CG.lg.schedule = sched.map((x) => Object.assign({}, x));
  C.CG._smLines = (g) => (MODEL.find((x) => x.id === g.id) || {}).lines || 0;   /* the classic counts the box lines; the new site reads the count */
  for (const g of sched) {
    const kN = N.P.kinds(g), kC = C.CG._smKinds(g);
    A("forfeit kinds agree on " + g.id, same({ n: kN.noshow.ok, d: kN.dc3.ok, pre: kN.pre }, { n: kC.noshow.ok, d: kC.dc3.ok, pre: kC.pre }) && wordsOld(kC.dc3.why || "") === (kN.dc3.why || "") && (kC.noshow.why || "") === (kN.noshow.why || ""), { new: kN, classic: kC });
    for (const kind of ["noshow", "dc3"]) {
      A("the #game-scores sentence agrees on " + g.id + " " + kind, N.P.ffPosts(g, kind) === C.CG._smFfPosts(g, kind));
      for (const code of [g.home, g.away]) A("what a forfeit records agrees on " + g.id + " " + kind + " " + code, N.P.ffWill(g, kind, code) === wordsOld(C.CG._smFfWill(g, kind, code)), [N.P.ffWill(g, kind, code), C.CG._smFfWill(g, kind, code)]);
    }
    for (const f of [{ h: "3", a: "2" }, { h: "3", a: "2", ot: true }, { h: 2, a: 2 }, { h: "4", a: "1", ot: true }, { h: "", a: "1" }, { h: "3", a: "2", ot: false }, { h: "5", a: "4", ot: true }, { h: "123", a: "1" }]) {
      const xN = N.P.fixCheck(g, f), xC = C.CG._smFixCheck(g, f);
      A("the correction check agrees on " + g.id + " " + JSON.stringify(f), xN.ok === xC.ok && xN.bad === xC.bad && xN.msg === wordsOld(xC.msg), { new: xN, classic: xC });
    }
  }
  /* the newer answer wins per sitting; an EA-only sitting survives an archive reload */
  const prev = SESS().map((s) => Object.assign({}, s, { source: s.matchId === "m5" ? "ea" : s.source }));
  const next = [S({ matchId: "m5", kind: "not-league", source: "archive", archive: { status: "ignored" }, canPickup: false, why: "x", endedAt: "2026-12-17T05:00:00Z" }), S({ matchId: "m8", kind: "league", fixture: FX("gB"), endedAt: "2026-12-17T03:30:00Z" })];
  const uN = N.P.union(JSON.parse(JSON.stringify(prev)), JSON.parse(JSON.stringify(next))), uC = C.CG._smUnion(JSON.parse(JSON.stringify(prev)), JSON.parse(JSON.stringify(next)));
  A("the union of two answers agrees, order and pickup door included", same(uN, uC), { new: uN.map((x) => x.matchId), classic: uC.map((x) => x.matchId) });
  A("a merge request adds the preview flag the classic way", same(N.P.withMerge({ leagueMerge: { gameId: "gA", matchIds: ["m1"], restart: false } }, { preview: true }), C.CG._smWith({ leagueMerge: { gameId: "gA", matchIds: ["m1"], restart: false } }, { preview: true })));
  for (const s of SESS()) {
    A("the length words agree for " + s.matchId, N.P.lengthText(s) === C.CG._smLengthText(s));
    A("the sitting score agrees for " + s.matchId, N.P.sitScore(s, sched[0]) === C.CG._smSitScore(s, sched[0]) && N.P.sitScore(s, null) === C.CG._smSitScore(s, null));
  }
  /* a recorded substitution ticks the sittings it matched, unless they hold a restart or a second game (v4.37 review) */
  for (const [name, sess] of [
    ["a plain lag-out", [S({ matchId: "x1", kind: "league", fixture: FX("gE"), canMerge: true, endedAt: "2026-12-17T03:40:00Z", minutes: 35, length: "short" }), S({ matchId: "x2", kind: "league", fixture: FX("gE"), canMerge: true, endedAt: "2026-12-17T04:10:00Z", minutes: 25, length: "short" })]],
    ["a stub then a game (a restart)", [S({ matchId: "x1", kind: "league", fixture: FX("gE"), canMerge: true, endedAt: "2026-12-17T03:20:00Z", minutes: 4, length: "short" }), S({ matchId: "x2", kind: "league", fixture: FX("gE"), canMerge: true, endedAt: "2026-12-17T04:30:00Z", minutes: 60, length: "full" })]],
    ["two full games", [S({ matchId: "x1", kind: "league", fixture: FX("gE"), canMerge: true, endedAt: "2026-12-17T04:10:00Z", minutes: 60, length: "full" }), S({ matchId: "x2", kind: "league", fixture: FX("gE"), canMerge: true, endedAt: "2026-12-17T05:10:00Z", minutes: 60, length: "full" })]]]) {
    for (const done of [false, true]) {
      const tick = { gameId: "gE", ids: ["x1", "x2"] };
      const fN = { picked: { x9: true }, moved: {}, tickAfter: tick, sess: JSON.parse(JSON.stringify(sess)) }, fC = { picked: { x9: true }, moved: {}, tickAfter: tick, sess: JSON.parse(JSON.stringify(sess)) };
      const CC = loadClassic(commish, fC);
      N.P.applyTicks(fN, done, tick); CC.CG._smApplyTicks(done, tick);
      A("ticks after a substitution agree: " + name + (done ? ", last phase" : ""), same(fN.picked, fC.picked) && same(!!fN.tickAfter, !!fC.tickAfter), { new: fN.picked, classic: fC.picked });
      const fN2 = { picked: Object.assign({}, fN.picked), tickAfter: fN.tickAfter }, fC2 = { picked: Object.assign({}, fC.picked), tickAfter: fC.tickAfter };
      const CC2 = loadClassic(commish, fC2);
      A("a failed phase takes back the same ticks: " + name + (done ? ", last phase" : ""), N.P.dropTicks(fN2, fN.tickAfter) === CC2.CG._smDropTicks(fC.tickAfter) && same(fN2.picked, fC2.picked));
    }
  }
}

console.log("## the doors: the classic site's own, with its argument names, through S2.write");
const writes = [...SRC.matchAll(/S2\.write\("(\w+)", \{([^}]*)\}/g)].map((m) => ({ rpc: m[1], keys: [...m[2].matchAll(/\b(p\w*):/g)].map((k) => k[1]).sort() }));
const rpcs = [...new Set(writes.map((w) => w.rpc))].sort();
A("the desk writes through exactly the Stats manager's doors", same(rpcs, ["clear_game_club_substitution", "ea_dismiss_import", "forfeit_game", "report_ruling_mistake", "set_game_club_substitution", "stats_game_row", "stats_game_set_result", "unforfeit_game"]), rpcs);
const LIVEALL = fs.readdirSync(path.join(ROOT, "src/live")).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(ROOT, "src/live", f), "utf8")).join("\n");
for (const w of writes) {
  if (w.rpc === "stats_game_row") {
    /* the classic client never called it (a box line was changed in SQL, memory: removing goals); the database's own
       signature, read 2026-11-24: stats_game_row(p_row_id uuid, p_game uuid, p jsonb) */
    A("stats_game_row takes the database's three arguments", same(w.keys, ["p", "p_game", "p_row_id"]), w.keys);
    continue;
  }
  const m = new RegExp("sb\\.rpc\\(\"" + w.rpc + "\",\\s*\\{([^}]*)\\}").exec(LIVEALL);
  const ck = m ? [...m[1].matchAll(/\b(p\w*)\s*:/g)].map((k) => k[1]).sort() : null;
  A(w.rpc + " is called with the classic call's arguments " + JSON.stringify(ck), !!ck && same(w.keys, ck), { new: w.keys, classic: ck });
}
const reads = [...SRC.matchAll(/c\.rpc\("(\w+)"/g)].map((m) => m[1]).sort();
A("the only RPCs called outside S2.write are the reads", same([...new Set(reads)], ["ea_import_issues", "ea_lookup_health", "ea_lookup_state"]), reads);
A("table reads are the staff reads the classic desk makes (teams, games, game_stats), never a write", same([...new Set([...SRC.matchAll(/c\.from\("(\w+)"\)\.(\w+)/g)].map((m) => m[1] + "." + m[2]))].sort(), ["game_stats.select", "games.select", "teams.select"]));
A("one fetch, the EA relay's (S2.ea.post), and nothing calls supabase-js to write", (SRC.match(/\bfetch\(/g) || []).length === 1 && !/\.(insert|update|upsert|delete)\(/.test(SRC));
A("the Netlify doors are the classic ones and take these payloads", /body\.leagueSessions/.test(fs.readFileSync(path.join(ROOT, "netlify/functions/ingest-stats.js"), "utf8")) && /body\.leagueMerge/.test(fs.readFileSync(path.join(ROOT, "netlify/functions/ingest-stats.js"), "utf8")) &&
  /action\s*===?\s*"search"/.test(fs.readFileSync(path.join(ROOT, "netlify/functions/pickup-import.js"), "utf8")) && /"\/api\/ingest-stats"/.test(SRC) && /"\/api\/pickup-import"/.test(SRC));
A("a merge is previewed before it is sent, and sent once (never one call per sitting)", /withMerge\(req, \{ preview: true \}\)/.test(SRC) && (SRC.match(/leagueApi\(r\.unpublish \? withMerge\(req, \{ unpublish: true \}\) : req\)/g) || []).length === 1);
A("a correction is read back from the games row before the desk says it worked (v3.42)", /stats_game_set_result[\s\S]{0,400}from\("games"\)\.select\("status,home_score,away_score,went_ot"\)/.test(SRC));
A("a forfeit is confirmed by the ruling's own answer (data.ok)", /forfeit_game[\s\S]{0,300}if \(!d \|\| !d\.ok\)/.test(SRC));
A("a box line is confirmed by the row the database returns", /row\.id !== l\.id \|\| row\[COL\[k\]\] !== to/.test(SRC));
A("a cleared exception is confirmed by reading the exceptions again", /ea_dismiss_import[\s\S]{0,200}ea_import_issues/.test(SRC));

console.log("## the gate: no demo device is left");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "");   /* the code without its comments, which may name what was removed */
A("no S2.demo, S2.override or demo filing", !/S2\.demo|S2\.override|\bD\.file\(|\bD\.on\(/.test(SRC));
A("no sample chips, sample candidates or sample clubs", !/chip sample|SAMPLE_L|showcase|S2\.eaSearch\(/.test(SRC));
A("no forfeit type the database does not have (the concept's five kinds and 'both clubs')", !/limit_forfeit|noshow_forfeit|forfeit_declared|club === "both"|both clubs/.test(CODE));
A("no S2.locked View-as detour: staff report a mistake instead (v3.52)", !/S2\.locked/.test(SRC) && /report_ruling_mistake/.test(SRC));
A("no dash used as punctuation in the desk's words", !/ — | – /.test(CODE));
A("Rule 7.1 is a warning, never a block", /function involved\(g\)/.test(SRC) && !/involved\([^)]*\)\)\s*return/.test(SRC));

console.log("## loading the file on a page");
const N = loadNew(false);
A("it exports what desk.js forwards to", ["clearImport", "eaSearch", "editCell", "focusCell", "gameList", "neighbor", "openResEdit", "paneGame", "paneGames", "repaintGame", "reverseForfeit", "saveResult", "undoEdit"].every((k) => typeof N.S2._gamedesk[k] === "function"));
A("S2.ea is the one EA door (post, status line, status paint)", typeof N.S2.ea.post === "function" && typeof N.S2.ea.statusLine === "function" && typeof N.S2.ea.paintStatus === "function" && N.S2.ea.WAIT_MS === 25000);
A("its listeners are delegated once (click, change, input, toggle, focusout, hashchange)", ["click", "change", "input", "toggle", "focusout", "hashchange"].every((t) => N.listeners.indexOf(t) >= 0) && N.listeners.length === 6, N.listeners);
const wait = N.S2._gamedesk.waiting();
A("Needs a ruling lists the held game and the late one, never a final, a forfeit or a future game", same(wait.map((g) => g.id), ["gA", "gB", "gE"].filter((id) => { const g = MODEL.find((x) => x.id === id); return g.eaMatchId || Date.parse(g.at) < T - 2 * 3600000; })), wait.map((g) => g.id));
N.S2.session = { user: null };
return Promise.resolve(N.S2.ea.post("/api/ingest-stats", { leagueSessions: { clubId: "1" } })).then(() => A("with no sign-in the EA door refuses, loudly", false), (e) => A("with no sign-in the EA door refuses, loudly", /Sign in again/.test(e.message), e.message))
  .then(() => { console.log("\n" + (n - fails) + "/" + n + " checks passed"); if (fails) { console.log(fails + " FAILED"); process.exit(1); } });
