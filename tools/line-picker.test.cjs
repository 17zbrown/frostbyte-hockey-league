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

const CG = { _lcPick: null, now: () => 1000 };
const NIGHT = [
  { id: "a", at: 1000 + 5 * 3600000 },
  { id: "b", at: 1000 + 5 * 3600000 + 35 * 60000 },
  { id: "c", at: 1000 + 5 * 3600000 + 70 * 60000 },
];
CG.nightGames = () => NIGHT;
new Function("CG", cut("lcOpenGames") + cut("lcPicked") + cut("lcTogglePick"))(CG);

console.log("— picking games within a night");
A("unset means every open game, exactly as the button always behaved", CG.lcPicked("BOS", "wed").length === 3);
CG.lcTogglePick("BOS", "wed", "b");
A("dropping one leaves the other two", CG.lcPicked("BOS", "wed").map((g) => g.id).join("") === "ac", CG.lcPicked("BOS", "wed").map((g) => g.id).join(""));
CG.lcTogglePick("BOS", "wed", "c");
A("...and dropping another leaves one", CG.lcPicked("BOS", "wed").map((g) => g.id).join("") === "a");
CG.lcTogglePick("BOS", "wed", "b");
A("toggling one back on restores it, in the night's own order", CG.lcPicked("BOS", "wed").map((g) => g.id).join("") === "ab");
CG.lcTogglePick("BOS", "wed", "a"); CG.lcTogglePick("BOS", "wed", "b");
A("picking nothing means nothing (the button disables rather than silently dressing all three)", CG.lcPicked("BOS", "wed").length === 0);
A("another night is untouched by this one's picks", CG.lcPicked("BOS", "thu").length === 3);
{
  /* a game that locks while the tab is open must drop out of the selection on its own */
  const late = { ...CG, now: () => 1000 + 5 * 3600000 - 20 * 60000 };
  new Function("CG", cut("lcOpenGames") + cut("lcPicked"))(late);
  late._lcPick = { fri: ["a", "b", "c"] };
  A("a locked game leaves the picture even when it was picked", late.lcPicked("BOS", "fri").map((g) => g.id).join("") === "bc",
    late.lcPicked("BOS", "fri").map((g) => g.id).join(""));
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
