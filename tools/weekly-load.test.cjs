/* the weekly-load helpers the line creator shows: CG.weekUsedFor / weekLoad / weekLoadChip / weekLedger.
   v3.93 (commissioner, 2026-10-12): "In the scheduler, make sure to only count the games played from box scores and
   mid games forfeits as their counter. Do not count future games they are scheduled in as games played until you
   receive results with them tied to it." Every block below was re-pinned to that: a filed sheet for a game still to
   come is shown, never counted. The history each block guards (v2.83, v3.25, v3.30, v3.31) is kept in its header. */
const fs = require("fs"), path = require("path");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
/* v3.31: also lifts plain objects (CG.WEEK_VERDICT), not just functions */
const cut = (name) => {
  let i = live.indexOf("CG." + name + " = function");
  if (i < 0) i = live.indexOf("CG." + name + " = {");
  if (i < 0) throw new Error("cut(): no CG." + name + " in part_live.js");
  const j = live.indexOf("\n};", i);
  return live.slice(i, j + 3);
};
const line = (name) => { const i = live.indexOf("CG." + name + " = function"); return live.slice(i, live.indexOf("\n", i)) + "\n"; };
/* v4.11: forfeitNoIce reads every line of a box entry through the engine's CG.boxLines */
const eng = fs.readFileSync(path.join(__dirname, "..", "src/live/part2_engine.js"), "utf8");
const engCut = (name) => { const i = eng.indexOf("CG." + name + " = function"); return eng.slice(i, eng.indexOf("\n};", i) + 3) + "\n"; };
/* the real key names, as public.format_rules publishes them */
const CG = { FORMAT_RULES: { basic: { cap_skater: 6, cap_goalie: 6, cap_camp: 3, series_cap: 4 } }, seasonFormat: () => "basic" };
new Function("CG", "esc", "CG_ic", engCut("boxLines") + line("limitWeekOf") + cut("weeklyCap") + cut("seriesCap") + cut("boxSides") + cut("forfeitNoIce") + cut("WEEK_VERDICT") + cut("weekLedger") + cut("weekGamesFor") + cut("gameCapFor") + cut("weekUsedFor") + cut("weekLoad") + cut("weekLoadChip"))(CG,
  (s) => String(s), () => "");
const played = (id, home, away, pids) => {
  const box = {}; box[home] = {}; box[away] = {};
  (pids || []).forEach((p) => { box[home][p] = { toi: 3600 }; });
  return { id, entered: true, box };
};

/* ==========================================================================================
 * v2.83 / v3.93 — the number a manager needs BEFORE he builds a line is the games PLAYED.
 * ======================================================================================= */
console.log("— filed sheets are shown, never counted; played games are counted");
{
  const wk = (n) => ({ id: "g" + n, week: 1, stage: "regular", status: "scheduled", voided: false, home: "BOS", away: "NYI" });
  CG.lg = { schedule: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(wk), allResults: [], _lineups: {} };
  /* BOS filed him into six of the nine, the live case that refused Boston on game day under the old count */
  [1, 2, 3, 7, 8, 9].forEach((n) => { CG.lg._lineups["BOS:g" + n] = { center: null, lw: "p1", rw: null, ld: null, rd: null, goalie: null }; });
  const P = { id: "p1", pos: "LW", squad: "pro", tag: "YoungBlood" };
  A("six filed sheets, nothing played: nothing counts", CG.weekUsedFor("p1", "BOS", wk(4)) === 0, String(CG.weekUsedFor("p1", "BOS", wk(4))));
  let load = CG.weekLoad(P, "BOS", wk(4));
  A("the load reads 0 of 6, room for all six", load.used === 0 && load.cap === 6 && load.left === 6 && load.full === false, JSON.stringify(load).slice(0, 160));
  A("...and it still names the six filed sheets", load.filed === 6, String(load.filed));
  A("the chip shows the played total and the filed sheets beside it", /0\/6/.test(CG.weekLoadChip(load)) && /class="wk-split">\+6</.test(CG.weekLoadChip(load)), CG.weekLoadChip(load).slice(0, 220));
  A("...and says in words that they count only once played, and what going over costs",
    /6 more on a filed sheet, counted only once played/.test(CG.weekLoadChip(load)) && /forfeits the game/.test(CG.weekLoadChip(load)));

  /* five of the filed games are played with him in them */
  [1, 2, 3, 7, 8].forEach((n) => { CG.lg.schedule[n - 1].status = "final"; CG.lg.allResults.push(played("g" + n, "BOS", "NYI", ["p1"])); });
  load = CG.weekLoad(P, "BOS", wk(4));
  A("five played: 5 of 6, one left, one still filed", load.used === 5 && load.left === 1 && load.filed === 1, JSON.stringify({ u: load.used, l: load.left, f: load.filed }));
  A("...and the chip warns at one left", /chip-warn/.test(CG.weekLoadChip(load)));
  CG.lg.schedule[8].status = "final"; CG.lg.allResults.push(played("g9", "BOS", "NYI", ["p1"]));
  load = CG.weekLoad(P, "BOS", wk(4));
  A("the sixth played: at the limit", load.used === 6 && load.full === true && /chip-loss/.test(CG.weekLoadChip(load)));
  A("no game to measure against is null, not a crash", CG.weekLoad(P, "BOS", null) === null && CG.weekLoadChip(null) === "");
}

/* ==========================================================================================
 * v3.25 — a forfeit nobody skated in is not a game against anybody's week; a forfeit after
 * disconnections is (it keeps its box score, Rule 4.3).
 * ======================================================================================= */
console.log("\n— Rule 3.2 forfeit with nobody on the ice");
{
  const mk = (id, status, forfeit) => ({ id, week: 1, stage: "regular", status, voided: false, home: "BOS", away: "NYI", forfeit: forfeit || null });
  CG.lg = { schedule: [mk("g1", "final"), mk("g9", "final", "BOS")], allResults: [played("g1", "BOS", "NYI", ["p1"])], _lineups: {} };
  CG.lg._lineups["BOS:g9"] = { center: null, lw: "p1", rw: null, ld: null, rd: null, goalie: null };
  const ref = mk("gX", "scheduled");
  A("a forfeit with no box score at all does not count", CG.weekUsedFor("p1", "BOS", ref) === 1, String(CG.weekUsedFor("p1", "BOS", ref)));
  CG.lg.allResults.push({ id: "g9", entered: true, box: { BOS: { p1: { toi: 0 } }, NYI: {} } });
  A("...nor a forfeit whose box score has zero ice time", CG.weekUsedFor("p1", "BOS", ref) === 1, String(CG.weekUsedFor("p1", "BOS", ref)));
  CG.lg.allResults[1] = { id: "g9", entered: true, box: { BOS: { p1: { toi: 1800 } }, NYI: {} } };
  A("a forfeit that followed disconnections DOES count", CG.weekUsedFor("p1", "BOS", ref) === 2, String(CG.weekUsedFor("p1", "BOS", ref)));
  A("...by the BOX SCORE, so a player who did not skate in it is not charged", CG.weekUsedFor("pOther", "BOS", ref) === 0);

  console.log("\n— the helper itself");
  A("no forfeit flag means not a no-ice forfeit", CG.forfeitNoIce({ forfeit: null }, null) === false);
  A("a forfeit with no result row at all is a no-ice forfeit", CG.forfeitNoIce({ forfeit: "BOS" }, null) === true);
  A("a forfeit with an empty box is too", CG.forfeitNoIce({ forfeit: "BOS", home: "BOS", away: "NYI" }, { box: { BOS: {}, NYI: {} } }) === true);
  A("one second of ice time anywhere makes it a played game",
    CG.forfeitNoIce({ forfeit: "BOS", home: "BOS", away: "NYI" }, { box: { BOS: {}, NYI: { z: { toi: 1 } } } }) === false);
  A("a missing toi field reads as no ice time, not as a crash",
    CG.forfeitNoIce({ forfeit: "BOS", home: "BOS", away: "NYI" }, { box: { BOS: { z: {} }, NYI: {} } }) === true);
  A("a box keyed the old wrong way yields no sides at all",
    CG.boxSides({ home: "BOS", away: "NYI" }, { box: { home: { z: { toi: 3600 } }, away: {} } }).length === 0);
  A("a null game is not a forfeit", CG.forfeitNoIce(null, null) === false);
}

/* ==========================================================================================
 * v3.30 — THE BOX IS KEYED BY CLUB CODE. The Islanders' Team HQ once showed XxVaughnX36 at 6 of 6 while the
 * database had him at 5, because the counter read box.home and box.away. A final game counts by the box.
 * ======================================================================================= */
console.log("\n— a final game counts by the BOX SCORE, which means reading the box correctly");
{
  const V = "vaughn";
  const mk = (id, status, home, away, forfeit) => ({ id, week: 1, stage: "regular", status, voided: false, home, away, forfeit: forfeit || null });
  CG.lg = {
    schedule: [
      mk("g1", "final", "NYI", "SEA", "SEA"),   // forfeit, nobody skated
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
    const box = {}; box[home] = forfeited ? {} : six(id + "h"); box[away] = forfeited ? {} : six(id + "a");
    if (vaughnPlayed) box.NYI[V] = { toi: 3600 };
    CG.lg.allResults.push({ id, entered: true, box });
  };
  res("g1", "NYI", "SEA", false, true); res("g2", "VAN", "NYI", true); res("g3", "BOS", "NYI", false);
  res("g4", "NYI", "DAL", false, true); res("g5", "UTA", "NYI", true); res("g6", "NYI", "DET", true);
  ["g2", "g3", "g4", "g5", "g6", "g7", "g8"].forEach((id) => { CG.lg._lineups["NYI:" + id] = { center: V, lw: null, rw: null, ld: null, rd: null, goalie: null }; });
  const ref = CG.lg.schedule[6];
  A("the box is read by club code, not by the words home and away", CG.boxSides(CG.lg.schedule[1], CG.lg.allResults[1]).length === 2);
  A("...and a game with no result at all has no sides", CG.boxSides(CG.lg.schedule[6], null).length === 0);
  A("he counts 3: the three he played, and not the two filed sheets still to come", CG.weekUsedFor(V, "NYI", ref) === 3, String(CG.weekUsedFor(V, "NYI", ref)));
  A("...so he is NOT at his limit", CG.weekLoad({ id: V, pos: "C", squad: "pro" }, "NYI", ref).full === false);
  A("a player filed on a sheet he never dressed for is not charged",
    CG.weekGamesFor(V, CG.lg.schedule[2], "NYI", { excludeGame: "__none__" }) === CG.weekGamesFor(V, CG.lg.schedule[2], "NYI", { excludeGame: "g3" }));
}

/* ==========================================================================================
 * v3.31 — the number explains itself: the count is a filter over a LEDGER that carries a reason for
 * every game, so the number and the explanation cannot drift.
 * ======================================================================================= */
console.log("\n— every game of the week carries a reason");
{
  const V = "vaughn";
  const mk = (id, status, home, away, forfeit) => ({ id, week: 1, stage: "regular", status, voided: false, home, away, forfeit: forfeit || null, at: Number(id.slice(1)) * 1000 });
  CG.lg = {
    schedule: [
      mk("g1", "final", "NYI", "SEA", "SEA"), mk("g2", "final", "VAN", "NYI"), mk("g3", "final", "BOS", "NYI"),
      mk("g4", "final", "NYI", "DAL", "NYI"), mk("g5", "scheduled", "NYI", "PIT"), mk("g6", "scheduled", "SEA", "NYI"),
      { ...mk("g7", "scheduled", "NYI", "VAN"), voided: true },
      { ...mk("g8", "scheduled", "DAL", "NYI"), limitsExempt: true },
    ],
    allResults: [], _lineups: {},
  };
  const six = (t) => { const o = {}; for (let k = 0; k < 6; k++) o[t + k] = { toi: 3600 }; return o; };
  const res = (id, home, away, didPlay, forfeited) => {
    const box = {}; box[home] = forfeited ? {} : six(id + "h"); box[away] = forfeited ? {} : six(id + "a");
    if (didPlay) box.NYI[V] = { toi: 3600 };
    CG.lg.allResults.push({ id, entered: true, box });
  };
  res("g1", "NYI", "SEA", false, true); res("g2", "VAN", "NYI", true); res("g3", "BOS", "NYI", false); res("g4", "NYI", "DAL", false, true);
  ["g3", "g4", "g5", "g6", "g7", "g8"].forEach((id) => { CG.lg._lineups["NYI:" + id] = { center: V, lw: null, rw: null, ld: null, rd: null, goalie: null }; });
  const ref = CG.lg.schedule[4];
  const rows = CG.weekLedger(V, ref, "NYI", { excludeGame: "__none__" });
  const verdict = (id) => (rows.find((r) => r.id === id) || {}).verdict;
  A("every game of the week is on the ledger, none dropped", rows.length === 8, String(rows.length));
  A("a game he played reads 'played'", verdict("g2") === "played");
  A("a game he was FILED for but did not dress reads 'sat'", verdict("g3") === "sat", verdict("g3"));
  A("a forfeit nobody skated reads 'forfeit'", verdict("g1") === "forfeit" && verdict("g4") === "forfeit");
  A("a filed game still to play reads 'filed'", verdict("g5") === "filed" && verdict("g6") === "filed");
  A("a voided game reads 'voided'", verdict("g7") === "voided");
  A("v3.93: a game the office exempted reads 'exempt'", verdict("g8") === "exempt", verdict("g8"));
  A("the ledger is in time order", rows.every((r, i) => i === 0 || rows[i - 1].at <= r.at));
  A("the COUNT is exactly the rows that count", CG.weekUsedFor(V, "NYI", ref) === rows.filter((r) => r.counts).length);
  A("...and that is 1, the one game he played", CG.weekUsedFor(V, "NYI", ref) === 1, String(CG.weekUsedFor(V, "NYI", ref)));
  const load = CG.weekLoad({ id: V, pos: "C", squad: "pro", tag: "XxVaughnX36" }, "NYI", ref);
  A("the load: 1 played, 2 filed, 1 used, 1 exempt", load.played === 1 && load.filed === 2 && load.used === 1 && load.exempt === 1,
    JSON.stringify({ p: load.played, f: load.filed, u: load.used, x: load.exempt }));
  A("...the used number is exactly the played games", load.used === load.played);
  A("...and it names what did NOT count", load.sat === 1 && load.forfeit === 2);
  A("the game being edited is on the ledger but not counted",
    CG.weekLedger(V, ref, "NYI").find((r) => r.id === ref.id).verdict === "editing" && CG.weekLedger(V, ref, "NYI").find((r) => r.id === ref.id).counts === false);

  console.log("\n— the chip says what it is made of, and opens");
  const chip = CG.weekLoadChip(load);
  A("it shows the played total", /1\/6/.test(chip));
  A("...and the filed sheets beside it", /class="wk-split">\+2</.test(chip), chip.slice(0, 200));
  A("it is a real button, not a hover-only tooltip", /<button type="button" class="chip wk-chip/.test(chip));
  A("...carrying what the ledger needs to open", /data-weekledger="vaughn"/.test(chip) && /data-wl-club="NYI"/.test(chip) && /data-wl-game="g5"/.test(chip));
  A("...and names what was excluded", /did not play do not count/.test(chip) && /nobody took the ice for do not count/.test(chip));
  A("it is reachable by a screen reader", /aria-label="XxVaughnX36: /.test(chip));
  A("a player with nothing played or filed renders a plain chip",
    !/wk-split/.test(CG.weekLoadChip({ used: 0, cap: 6, left: 6, full: false, played: 0, filed: 0, pid: "x", club: "NYI", gameId: "g5" })));

  console.log("\n— every verdict declares whether it counts, in one table");
  A("the table covers every verdict the ledger can produce", rows.concat(CG.weekLedger(V, ref, "NYI")).every((r) => !!CG.WEEK_VERDICT[r.verdict]));
  A("v3.93: only played counts", Object.keys(CG.WEEK_VERDICT).filter((k) => CG.WEEK_VERDICT[k].counts).join(",") === "played");
  A("every verdict carries a reason a manager can read", Object.keys(CG.WEEK_VERDICT).every((k) => CG.WEEK_VERDICT[k].why && CG.WEEK_VERDICT[k].label));
}

/* ==========================================================================================
 * v3.93 — the limit week and the exemption (Rule 3.3)
 * ======================================================================================= */
console.log("\n— a moved game's limit week, and an exempt game");
{
  A("limitWeekOf reads the office's week when it set one", CG.limitWeekOf({ week: 4, limitWeek: 3 }) === 3);
  A("...and the week it is played otherwise", CG.limitWeekOf({ week: 4, limitWeek: null }) === 4 && CG.limitWeekOf(null) === null);
  A("an exempt regular-season game has no cap", CG.gameCapFor({ pos: "C", squad: "pro" }, { stage: "regular", limitsExempt: true }) === Infinity);
  A("...an ordinary one still has six", CG.gameCapFor({ pos: "C", squad: "pro" }, { stage: "regular" }) === 6);
  CG.lg = { schedule: [{ id: "a", week: 4, limitWeek: 3, stage: "regular", status: "final", home: "BOS", away: "NYI" },
                       { id: "b", week: 4, stage: "regular", status: "final", home: "BOS", away: "NYI" }],
            allResults: [played("a", "BOS", "NYI", ["p1"]), played("b", "BOS", "NYI", ["p1"])], _lineups: {} };
  A("a game ruled to Week 3 counts toward Week 3, not Week 4", CG.weekUsedFor("p1", "BOS", { id: "z", week: 4, stage: "regular" }) === 1
    && CG.weekUsedFor("p1", "BOS", { id: "z", week: 3, stage: "regular" }) === 1);
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
