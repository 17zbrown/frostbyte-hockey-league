/* v2.84 — dressing a line into SOME of a night's games, and the order a week is dressed in.
   Run: node tools/line-picker.test.cjs

   Boston hit both of these the night before Season 1's first games. A six-game week does not
   divide evenly into three-game nights, so a club must be able to put a line in one or two games
   of a night, not only all three. And moving a player from one night to another was refused even
   when the club removed him first: the week dressed in clock order, so the night that ADDED him
   was submitted while he was still filed in the night that was about to give him back. */
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src/live/part6_hub.js"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const cut = (name) => { const i = src.indexOf("CG." + name + " = function"); return src.slice(i, src.indexOf("\n};", i) + 3); };

const CG = { now: () => 1000, lg: { _gameLinePlan: {}, _linePlan: {} } };
const NIGHT = [
  { id: "a", at: 1000 + 5 * 3600000 },
  { id: "b", at: 1000 + 5 * 3600000 + 35 * 60000 },
  { id: "c", at: 1000 + 5 * 3600000 + 70 * 60000 },
];
CG.nightGames = () => NIGHT;
new Function("CG", cut("lcOpenGames") + cut("lcGameSlot") + cut("lcNightSlots"))(CG);

console.log("— a line per game, up to three a night");
{
  const NIGHT_IDS = ["a", "b", "c"];
  const slots = () => NIGHT_IDS.map((id) => CG.lcGameSlot("BOS", "wed", id));
  CG.lg._linePlan = {}; CG.lg._gameLinePlan = {};
  A("with nothing planned at all, no game dresses anything", slots().every((s) => s === null), JSON.stringify(slots()));
  CG.lg._linePlan.wed = 1;
  A("the night's default covers every game of it", slots().join(",") === "1,1,1", slots().join(","));
  CG.lg._gameLinePlan.b = 2;
  A("a per-game line overrides the night for THAT game only", slots().join(",") === "1,2,1", slots().join(","));
  CG.lg._gameLinePlan.c = 3;
  A("...so a night can run three different lines", slots().join(",") === "1,2,3", slots().join(","));
  A("the night summary reports them in game order", CG.lcNightSlots("BOS", "wed").join(",") === "1,2,3");
  CG.lg._linePlan = {};
  A("clearing the night default leaves the per-game ones standing",
    slots()[0] === null && slots()[1] === 2 && slots()[2] === 3, JSON.stringify(slots()));
  CG.lg._gameLinePlan = { a: 2 };
  CG.lg._linePlan = { wed: 1 };
  A("a game with no line of its own still falls back to the night", slots().join(",") === "2,1,1", slots().join(","));
}

console.log("\n— the week dresses in an order that frees before it fills");
A("Dress the week sorts its nights by what they add minus what they give back",
  /jobs\.sort\(function \(?a, b\)? \{ return netOf\(a\) - netOf\(b\)/.test(src.replace(/\s+/g, " ").replace(/function \(/g, "function(")) ||
  /jobs\.sort\(function\(a, b\)\{ return netOf\(a\) - netOf\(b\) \|\| a\.game\.at - b\.game\.at; \}\);/.test(src));
A("...with a tie broken by the clock, so a plain week still dresses in order",
  /netOf\(a\) - netOf\(b\) \|\| a\.game\.at - b\.game\.at/.test(src));
A("netOf counts adds minus drops against what is FILED right now",
  /var adds = six\.filter\(function\(pid\)\{ return on\.indexOf\(pid\) < 0; \}\)\.length;/.test(src) &&
  /var drops = on\.filter\(function\(pid\)\{ return six\.indexOf\(pid\) < 0; \}\)\.length;/.test(src));
A("the pre-flight applies a night's drops before its adds, so a swap is not predicted as a conflict",
  /Object\.keys\(drops\)\.forEach\(function\(pid\)\{ used\[pid\] = Math\.max\(0, loadOfPid\(pid\) - drops\[pid\]\); \}\);/.test(src) &&
  src.indexOf("Object.keys(drops).forEach") < src.indexOf("Object.keys(adds).forEach"));
A("dressing still goes through set_game_lineup only", !/from\("game_lineups"\)/.test(src));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
