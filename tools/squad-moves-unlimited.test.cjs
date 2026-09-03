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
A("Rule 2.1 states squad changes are unlimited", /There is no limit on how many times a player may change squads/.test(p21));
A("...and no longer caps them at three", !/three \(3\) times/.test(p21) && !/swap cap/.test(p21));
A("...while camp itself is still capped at three", /carries no more than three players in camp/.test(p21));
A("Rule 2.4 says the deadline never touches roster<->camp moves", /the deadline does not restrict it \(Rule 2\.1\)/.test(p24));
A("a v2.30 changelog entry exists (pinned by version, never by index)", rb.changelog.some(e => e.version === "2.30" && /unlimited/.test(e.summary)));

console.log("\n— Team HQ no longer rations moves");
A("no 'Squad locked' button", !/Squad locked/.test(hub));
A("no 'of 3 squad changes left' tooltip", !/of 3 squad changes left/.test(hub) && !/squadMovesLeft/.test(hub));
A("the squad button says changes are unlimited", /Squad changes are unlimited all season \(Rule 2\.1\)/.test(hub));
A("the Squads card copy says so too", /there is no limit on squad changes \(Rule 2\.1\)/.test(hub));
A("...and the camp meter is still 3", /meter\("training camp",tcSq\.length,3\)/.test(hub));

console.log("\n— the swap picker and call-up toast");
A("the picker no longer filters by swaps remaining", !/\(3-\(x\.squadMoves\|\|0\)\)>0/.test(live));
A("...and never says 'swaps left'", !/swaps left/.test(live) && !/three season swaps/.test(live));
A("the call-up toast no longer reads moves_left from the RPC", !/moves_left/.test(live));
A("the picker still matches the EXACT position (v2.7 shape)", /x\.pos===me\.pos;/.test(live));

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
