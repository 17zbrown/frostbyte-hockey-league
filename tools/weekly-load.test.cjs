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
new Function("CG", cut("weeklyCap") + cut("seriesCap") + cut("weekGamesFor") + cut("gameCapFor") + cut("weekUsedFor") + cut("weekLoad") + cut("weekLoadChip"))(CG);
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

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
