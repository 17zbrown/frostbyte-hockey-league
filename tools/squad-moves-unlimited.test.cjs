/* Rulebook v2.30 (2026-09-02): a player may be moved between the active roster and training camp
   freely, all season — the three-changes-a-season cap is abolished.
   Run: node tools/squad-moves-unlimited.test.cjs
   The database half (guard_squad_move no longer refuses a 4th change; set_roster_squad /
   swap_roster_squad no longer return moves_left; the 3-player camp limit still refuses a 4th camp
   player) was verified by a rolled-back rehearsal against production on 2026-09-02. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const hub = R("src/live/part6_hub.js"), live = R("src/live/part_live.js"), content = R("src/live/part3_content.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
const sec = {}; rb.chapters.forEach(c => c.sections.forEach(s => { sec[s.id] = s; }));
const p21 = sec["2.1"].paragraphs.join(" "), p24 = sec["2.4"].paragraphs.join(" ");

console.log("— the rulebook says it");
A("Rule 2.1 states squad changes are unlimited in number", /move a player between the active roster and training camp without limit, in either direction/.test(p21));
/* v3.40 added the ONE restriction: a weekly window, not a count. "at any time" had to go. */
A("...but not at any time: the weekly freeze is the one restriction",
  /the roster freezes each week from Wednesday at 7:30 PM Eastern Time/.test(p21) &&
  /until midnight Eastern at the end of Friday, and no player may be called up or sent down in that window/.test(p21));
A("...with the reason stated", /The week's games are played against the roster a club held when the week's first puck dropped/.test(p21));
A("...and a league-office door for a club that cannot ice a lineup",
  /The league office may move a player in the window where a club would otherwise be unable to ice a lineup/.test(p21));
A("...and no longer caps them at three", !/three \(3\) times/.test(p21) && !/swap cap/.test(p21));
A("...and camp itself is unlimited unless a camp limit is published (v2.51)", /may carry any number of training-camp players/.test(p21) && !/carries no more than three players in camp/.test(p21));
A("Rule 2.4 says the deadline never touches roster<->camp moves", /is not restricted by the deadline \(Rule 2\.1\)/.test(p24));
A("a v2.30 changelog entry exists (pinned by version, never by index)", rb.changelog.some(e => e.version === "2.30" && /unlimited/.test(e.summary)));

console.log("\n— Team HQ no longer rations moves");
A("no 'Squad locked' button", !/Squad locked/.test(hub));
A("no 'of 3 squad changes left' tooltip", !/of 3 squad changes left/.test(hub) && !/squadMovesLeft/.test(hub));
A("the squad button says changes are unlimited", /Squad changes are unlimited all season \(Rule 2\.1\)/.test(hub));
A("the Squads card copy says so too", /there is no limit on squad changes \(Rule 2\.1\)/.test(hub));
/* v2.48: the camp cap is no longer a hardcoded 3 in the meter — it reads CG.CAMP_MAX. v2.51: basic
   camp is unlimited (CAMP_MAX 999), so the meter draws no cap at all rather than "of 999". */
A("...and the camp meter reads the format's camp cap (CG.CAMP_MAX), not a hardcoded 3 — and no cap when camp is unlimited",
  /meter\("training camp",tcSq\.length,CG\.CAMP_MAX>=999\?null:CG\.CAMP_MAX\)/.test(hub));
A("no comment still claims a 3-swaps ceiling or the pre-v2.7 2/4/6 shape", !/3-swaps-a-season|2\/4\/6|2 G \/ 4 D \/ 6 F/.test(live + hub));
A("the Swap tooltip does not nest parentheses", !/\('\+title\+'\)/.test(hub) && /of the same position\. '\+title\+'"/.test(hub));

console.log("\n— the swap picker and call-up toast");
A("the picker no longer filters by swaps remaining", !/\(3-\(x\.squadMoves\|\|0\)\)>0/.test(live));
A("...and never says 'swaps left'", !/swaps left/.test(live) && !/three season swaps/.test(live));
A("the call-up toast no longer reads moves_left from the RPC", !/moves_left/.test(live));
A("the picker matches the position GROUP (v2.41 shape: a wing for a center, either side of defense; goalie for goalie)", /CG\.posGroup\(x\.pos\)===CG\.posGroup\(me\.pos\);/.test(live) && !/x\.pos===me\.pos;/.test(live));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
