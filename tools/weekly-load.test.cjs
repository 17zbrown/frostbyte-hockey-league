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
new Function("CG", cut("weeklyCap") + cut("seriesCap") + cut("boxSides") + cut("forfeitNoIce") + cut("weekGamesFor") + cut("gameCapFor") + cut("weekUsedFor") + cut("weekLoad") + cut("weekLoadChip"))(CG);
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

  /* v3.30: g9 needs real club codes. A result's box is keyed BY CLUB CODE, so a fixture with no
     home/away has nothing for the box to key on, and the original version of this block wrote
     `box: { home: ..., away: ... }`, which is the very mistake the counter was making. A test
     written from the same misunderstanding as the code is a test that cannot catch it. */
  CG.lg.schedule = CG.lg.schedule.map((g) => g.id === "g9" ? { ...g, status: "final", forfeit: "BOS", home: "BOS", away: "NYI" } : g);
  A("a forfeit with no box score at all stops counting", CG.weekUsedFor("p1", "BOS", wk(4)) === 5,
    String(CG.weekUsedFor("p1", "BOS", wk(4))));

  /* a forfeit whose box score exists but holds NO ice time is still not a game anybody played */
  CG.lg.allResults = [{ id: "g9", entered: true, box: { BOS: { p1: { toi: 0 } }, NYI: {} } }];
  A("...and so does a forfeit whose box score has zero ice time", CG.weekUsedFor("p1", "BOS", wk(4)) === 5,
    String(CG.weekUsedFor("p1", "BOS", wk(4))));

  /* Rule 4.3: a forfeit AFTER disconnections keeps every statistic, so it has real ice time */
  CG.lg.allResults = [{ id: "g9", entered: true, box: { BOS: { p1: { toi: 1800 } }, NYI: {} } }];
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
  CG.lg.schedule = CG.lg.schedule.map((g) => g.id === "g9" ? { ...g, status: "scheduled", forfeit: null, home: "BOS", away: "NYI" } : g);
  A("an ordinary scheduled game still counts", CG.weekUsedFor("p1", "BOS", wk(4)) === 6,
    String(CG.weekUsedFor("p1", "BOS", wk(4))));

  console.log("\n— the helper itself");
  A("no forfeit flag means not a no-ice forfeit", CG.forfeitNoIce({ forfeit: null }, null) === false);
  A("a forfeit with no result row at all is a no-ice forfeit", CG.forfeitNoIce({ forfeit: "BOS" }, null) === true);
  A("a forfeit with an empty box is too", CG.forfeitNoIce({ forfeit: "BOS", home: "BOS", away: "NYI" }, { box: { BOS: {}, NYI: {} } }) === true);
  A("one second of ice time anywhere makes it a played game",
    CG.forfeitNoIce({ forfeit: "BOS", home: "BOS", away: "NYI" }, { box: { BOS: {}, NYI: { z: { toi: 1 } } } }) === false);
  A("a missing toi field reads as no ice time, not as a crash",
    CG.forfeitNoIce({ forfeit: "BOS", home: "BOS", away: "NYI" }, { box: { BOS: { z: {} }, NYI: {} } }) === true);
  /* and the shape that USED to be written here reads as no box at all, rather than silently
     agreeing: a wrong-shaped box must not look like a valid empty one */
  A("a box keyed the old wrong way yields no sides at all",
    CG.boxSides({ home: "BOS", away: "NYI" }, { box: { home: { z: { toi: 3600 } }, away: {} } }).length === 0);
  A("a null game is not a forfeit", CG.forfeitNoIce(null, null) === false);
}

/* ============================================================================
 * v3.30 — THE BOX IS KEYED BY CLUB CODE.
 * The Islanders' Team HQ showed XxVaughnX36 at 6 of 6 while the database had him at 5. Cause: this
 * counter read `box.home` and `box.away`, which are undefined for every game ever played, because
 * the builder writes `box[g.home]` and `box[g.away]`. hasBox was therefore ALWAYS false, every
 * final game fell through to the filed-lineup branch, and a player who was dressed on a sheet but
 * never took a shift was charged a game anyway.
 * ========================================================================= */
console.log("\n— a final game counts by the BOX SCORE, which means reading the box correctly");
{
  const V = "vaughn";
  const mk = (id, status, home, away, forfeit) => ({ id, week: 1, stage: "regular", status, voided: false, home, away, forfeit: forfeit || null });
  /* NYI's real week 1, in order */
  CG.lg = {
    schedule: [
      mk("g1", "final", "NYI", "SEA", "SEA"),   // forfeit, nobody skated, he was not filed
      mk("g2", "final", "VAN", "NYI"),          // he played
      mk("g3", "final", "BOS", "NYI"),          // FILED BUT DID NOT DRESS
      mk("g4", "final", "NYI", "DAL", "NYI"),   // forfeit, nobody skated, he WAS filed
      mk("g5", "final", "UTA", "NYI"),          // he played
      mk("g6", "final", "NYI", "DET"),          // he played
      mk("g7", "scheduled", "NYI", "PIT"),      // filed, still to play
      mk("g8", "scheduled", "SEA", "NYI"),      // filed, still to play
      mk("g9", "scheduled", "NYI", "VAN"),      // not filed
    ],
    allResults: [], _lineups: {},
  };
  const six = (tag) => { const o = {}; for (let k = 0; k < 6; k++) o[tag + k] = { toi: 3600 }; return o; };
  const res = (id, home, away, vaughnPlayed, forfeited) => {
    const box = {};
    box[home] = forfeited ? {} : six(id + "h");
    box[away] = forfeited ? {} : six(id + "a");
    if (vaughnPlayed) box.NYI[V] = { toi: 3600 };
    CG.lg.allResults.push({ id, entered: true, box });
  };
  res("g1", "NYI", "SEA", false, true);
  res("g2", "VAN", "NYI", true);
  res("g3", "BOS", "NYI", false);
  res("g4", "NYI", "DAL", false, true);
  res("g5", "UTA", "NYI", true);
  res("g6", "NYI", "DET", true);
  ["g2", "g3", "g4", "g5", "g6", "g7", "g8"].forEach((id) => {
    CG.lg._lineups["NYI:" + id] = { center: V, lw: null, rw: null, ld: null, rd: null, goalie: null };
  });
  const ref = CG.lg.schedule[6];

  A("the box is read by club code, not by the words home and away",
    CG.boxSides(CG.lg.schedule[1], CG.lg.allResults[1]).length === 2,
    JSON.stringify(CG.boxSides(CG.lg.schedule[1], CG.lg.allResults[1]).map((s2) => Object.keys(s2).length)));
  A("...and a game with no result at all has no sides", CG.boxSides(CG.lg.schedule[6], null).length === 0);

  A("he counts 5, not 6: three played plus two filed", CG.weekUsedFor(V, "NYI", ref) === 5,
    String(CG.weekUsedFor(V, "NYI", ref)));
  A("...so he is NOT at his limit", CG.weekLoad({ id: V, pos: "C", squad: "pro" }, "NYI", ref).full === false);
  A("THE BUG ITSELF: a player filed on a sheet he never dressed for is not charged",
    CG.weekGamesFor(V, CG.lg.schedule[2], "NYI", { excludeGame: "__none__" }) ===
    CG.weekGamesFor(V, CG.lg.schedule[2], "NYI", { excludeGame: "g3" }),
    "g3 must contribute nothing either way");

  /* the two forfeits, which must behave oppositely */
  A("a Rule 3.2 forfeit with no player statistics is skipped",
    CG.forfeitNoIce(CG.lg.schedule[3], CG.lg.allResults[3]) === true);
  A("a Rule 4.3 forfeit WITH ice time is counted, which the club-code bug had also broken",
    CG.forfeitNoIce({ id: "gX", home: "DAL", away: "UTA", forfeit: "DAL" },
      { id: "gX", box: { DAL: { a: { toi: 3600 } }, UTA: { b: { toi: 3600 } } } }) === false);
  A("...and a forfeit box whose every line is zero ice time is still skipped",
    CG.forfeitNoIce({ id: "gY", home: "DAL", away: "UTA", forfeit: "DAL" },
      { id: "gY", box: { DAL: { a: { toi: 0 } }, UTA: { b: {} } } }) === true);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
