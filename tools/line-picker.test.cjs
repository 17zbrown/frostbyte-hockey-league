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
new Function("CG", cut("lcOpenGames") + cut("lcGameSlot") + cut("lcNightSlots") + cut("lcPerGameOpen") + cut("lcTogglePerGame"))(CG);

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

console.log("\n— the per-game selects are behind a toggle (v2.90)");
{
  CG._lcOpenNights = {};
  CG.lg._linePlan = { wed: 1 }; CG.lg._gameLinePlan = {};
  A("a night running ONE line starts collapsed, so the row stays a row", CG.lcPerGameOpen("BOS", "wed") === false);
  CG.lg._gameLinePlan = { b: 2 };
  A("...but a night already running more than one opens itself, or its state would be hidden",
    CG.lcPerGameOpen("BOS", "wed") === true);
  CG._lcOpenNights = {}; CG.lg._gameLinePlan = {};
  A("the toggle opens it", CG.lcTogglePerGame("BOS", "wed") === true && CG.lcPerGameOpen("BOS", "wed") === true);
  A("...and closes it again", CG.lcTogglePerGame("BOS", "wed") === false && CG.lcPerGameOpen("BOS", "wed") === false);
  A("one night's choice does not move another's", CG.lcPerGameOpen("BOS", "thu") === false && CG._lcOpenNights.thu === undefined);
  /* an explicit close must survive a night that would otherwise open itself */
  CG.lg._gameLinePlan = { b: 2 };
  CG._lcOpenNights = { wed: false };
  A("an explicit close beats the auto-open", CG.lcPerGameOpen("BOS", "wed") === false);
}

console.log("\n— the markup the toggle drives");
{
  const src6 = require("fs").readFileSync(require("path").join(__dirname, "..", "src/live/part6_hub.js"), "utf8");
  A("the selects render only when the night is open", /open\.length && perOpen \? '<div class="lc-gsel">'/.test(src6));
  A("the toggle only appears when there is more than one game to split", /open\.length > 1 \? '<button type="button" class="btn btn-ghost btn-sm lc-pergame"/.test(src6));
  A("...and it reports its state to assistive tech", /aria-expanded="'\+perOpen\+'"/.test(src6));
  A("...and says when the night runs more than one line", /distinct\.length > 1 \? ' · '\+distinct\.length\+' lines' : ''/.test(src6));
  const css = require("fs").readFileSync(require("path").join(__dirname, "..", "src/live/part1_head.html"), "utf8");
  A("the selects are a grid: three across on a desk", /\.lc-gsel\{flex-basis:100%;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(css));
  A("...one per row on a phone, with full-width controls and 44px targets",
    /@media\(max-width:720px\)\{[\s\S]{0,420}\.lc-gsel\{grid-template-columns:1fr/.test(css) &&
    /\.lc-nrow \.btn\{min-height:44px/.test(css) && /\.lc-all\{flex:1 1 100%\}/.test(css));
  A("the roster board drops to one column on a phone, so names are not cut to an initial",
    /@media\(max-width:560px\)\{\.lc-board\{grid-template-columns:1fr\}/.test(css));
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
