/* the weekly-load helpers the line creator now shows: CG.weekUsedFor / weekLoad / weekLoadChip */
const fs = require("fs"), path = require("path");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const cut = (name) => {
  const i = live.indexOf("CG." + name + " = function");
  const j = live.indexOf("\n};", i);
  return live.slice(i, j + 3);
};
/* the real key names, as public.format_rules publishes them */
const CG = { FORMAT_RULES: { basic: { cap_skater: 6, cap_goalie: 6, cap_camp: 3, series_cap: 4 } }, seasonFormat: () => "basic" };
new Function("CG", cut("weeklyCap") + cut("seriesCap") + cut("forfeitNoIce") + cut("weekGamesFor") + cut("gameCapFor") + cut("weekUsedFor") + cut("weekLoad") + cut("weekLoadChip"))(CG);
const wk = (n) => ({ id: "g" + n, week: 1, stage: "regular", status: "scheduled", voided: false });
CG.lg = {
  schedule: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(wk),
  allResults: [],
  _lineups: {},
};
/* BOS filed him into six of the nine, exactly the live case that refused Boston on game day */
[1, 2, 3, 7, 8, 9].forEach((n) => { CG.lg._lineups["BOS:g" + n] = { center: null, lw: "p1", rw: null, ld: null, rd: null, goalie: null }; });
const P = { id: "p1", pos: "LW", squad: "pro", tag: "YoungBlood" };

console.log("— the number a manager needs BEFORE he builds a line");
A("the whole week counts, including the game in hand", CG.weekUsedFor("p1", "BOS", wk(4)) === 6, String(CG.weekUsedFor("p1", "BOS", wk(4))));
A("...while weekGamesFor still excludes the game being edited", CG.weekGamesFor("p1", wk(1), "BOS") === 5, String(CG.weekGamesFor("p1", wk(1), "BOS")));
const load = CG.weekLoad(P, "BOS", wk(4));
A("the load reads 6 of 6, no room left", load.used === 6 && load.cap === 6 && load.left === 0 && load.full === true, JSON.stringify(load));
A("the chip says so and explains it counts FILED games", /6\/6/.test(CG.weekLoadChip(load)) && /counting games already filed/.test(CG.weekLoadChip(load)));
CG.lg._lineups["BOS:g9"] = { lw: null };
const load2 = CG.weekLoad(P, "BOS", wk(4));
A("dropping him from one night frees exactly one", load2.used === 5 && load2.left === 1 && load2.full === false, JSON.stringify(load2));
A("...and the chip warns at one left", /chip-warn/.test(CG.weekLoadChip(load2)));
A("no game to measure against is null, not a crash", CG.weekLoad(P, "BOS", null) === null && CG.weekLoadChip(null) === "");

/* ============================================================================
 * v3.25 — a forfeit nobody skated in is not a game against anybody's week.
 * Commissioner: "Make sure to not count games that were forfeited with no ice time towards the
 * player games per week cap... If a forfeit happens due to too many disconnects, those games do
 * count, but if there is a forfeit from a team being too late, that does not count."
 * ========================================================================= */
console.log("\n— Rule 3.2 forfeit with nobody on the ice");
{
  CG.lg._lineups["BOS:g9"] = { center: null, lw: "p1", rw: null, ld: null, rd: null, goalie: null };
  A("back to six filed", CG.weekUsedFor("p1", "BOS", wk(4)) === 6, String(CG.weekUsedFor("p1", "BOS", wk(4))));

  /* g9 is ruled a forfeit: final, no box score at all (Rule 3.2 records 1-0 and no player stats) */
  CG.lg.schedule = CG.lg.schedule.map((g) => g.id === "g9" ? { ...g, status: "final", forfeit: "BOS" } : g);
  A("a forfeit with no box score at all stops counting", CG.weekUsedFor("p1", "BOS", wk(4)) === 5,
    String(CG.weekUsedFor("p1", "BOS", wk(4))));

  /* a forfeit whose box score exists but holds NO ice time is still not a game anybody played */
  CG.lg.allResults = [{ id: "g9", entered: true, box: { home: { p1: { toi: 0 } }, away: {} } }];
  A("...and so does a forfeit whose box score has zero ice time", CG.weekUsedFor("p1", "BOS", wk(4)) === 5,
    String(CG.weekUsedFor("p1", "BOS", wk(4))));

  /* Rule 4.3: a forfeit AFTER disconnections keeps every statistic, so it has real ice time */
  CG.lg.allResults = [{ id: "g9", entered: true, box: { home: { p1: { toi: 1800 } }, away: {} } }];
  A("a forfeit that followed disconnections DOES count", CG.weekUsedFor("p1", "BOS", wk(4)) === 6,
    String(CG.weekUsedFor("p1", "BOS", wk(4))));
  A("...and it counts by the BOX SCORE, so a player who did not skate in it is not charged",
    CG.weekUsedFor("pOther", "BOS", wk(4)) === 0, String(CG.weekUsedFor("pOther", "BOS", wk(4))));

  /* the opponent's players are freed too: nobody played it, so it is nobody's game */
  CG.lg.allResults = [];
  CG.lg._lineups["NYI:g9"] = { center: "p2", lw: null, rw: null, ld: null, rd: null, goalie: null };
  A("the club that SHOWED UP is not charged either", CG.weekUsedFor("p2", "NYI", wk(4)) === 0,
    String(CG.weekUsedFor("p2", "NYI", wk(4))));

  /* and an ordinary game is untouched by any of this */
  CG.lg.schedule = CG.lg.schedule.map((g) => g.id === "g9" ? { ...g, status: "scheduled", forfeit: null } : g);
  A("an ordinary scheduled game still counts", CG.weekUsedFor("p1", "BOS", wk(4)) === 6,
    String(CG.weekUsedFor("p1", "BOS", wk(4))));

  console.log("\n— the helper itself");
  A("no forfeit flag means not a no-ice forfeit", CG.forfeitNoIce({ forfeit: null }, null) === false);
  A("a forfeit with no result row at all is a no-ice forfeit", CG.forfeitNoIce({ forfeit: "BOS" }, null) === true);
  A("a forfeit with an empty box is too", CG.forfeitNoIce({ forfeit: "BOS" }, { box: { home: {}, away: {} } }) === true);
  A("one second of ice time anywhere makes it a played game",
    CG.forfeitNoIce({ forfeit: "BOS" }, { box: { home: {}, away: { z: { toi: 1 } } } }) === false);
  A("a missing toi field reads as no ice time, not as a crash",
    CG.forfeitNoIce({ forfeit: "BOS" }, { box: { home: { z: {} }, away: {} } }) === true);
  A("a null game is not a forfeit", CG.forfeitNoIce(null, null) === false);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
