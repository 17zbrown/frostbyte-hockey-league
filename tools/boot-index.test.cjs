#!/usr/bin/env node
/* v2.72 — the boot array's tail is read by name, and the names match the array (v2.57 read the lobby
   codes from the career-games slot: codes blank on a full boot, careerGp wiped on every games delta). */
const fs = require("fs"), path = require("path");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
let fails = 0;
function A(name, cond, why){ console.log((cond ? "ok   " : "FAIL ") + name + (cond || !why ? "" : "  — " + why)); if (!cond) fails++; }
const i = live.indexOf('await Promise.all([\n    sb.from("teams")'), j = live.indexOf("\n  ]);", i);
let block = live.slice(i + "await Promise.all([".length, j).replace(/\/\*[\s\S]*?\*\//g, "");
let depth = 0, n = 1, str = null;
for (const ch of block){
  if (str){ if (ch === str) str = null; continue; }
  if (ch === '"' || ch === "'") { str = ch; continue; }
  if ("([{".includes(ch)) depth++; else if (")]}".includes(ch)) depth--; else if (ch === "," && depth === 0) n++;
}
const career = +(live.match(/CG\.BOOT_CAREER = (\d+)/) || [])[1], codes = +(live.match(/CG\.BOOT_CODES = (\d+)/) || [])[1];
A("the boot array has " + n + " entries", n >= 18);
A("career_games_played is the second-to-last entry and its name says so", /CG\.sb\.rpc\("career_games_played"\),\s*(\/\*[^*]*\*\/\s*)?CG\._codesToday\(\)\s*\]\);/.test(live) && career === n - 2);
A("the codes view is the last entry and its name says so", codes === n - 1);
A("nothing reads q[17] or q[18] by number any more", !/q\[1[78]\]/.test(live));
A("the delta writes the codes to the named slot and the builder reads career games from its own", /q\[CG\.BOOT_CODES\] = await CG\._codesToday\(\);/.test(live) && /q\[CG\.BOOT_CAREER\] && !q\[CG\.BOOT_CAREER\]\.error/.test(live) && /q\[CG\.BOOT_CODES\]&&!q\[CG\.BOOT_CODES\]\.error/.test(live));
console.log("\n— liveReload keeps its promises");
A("a queued full reload is never downgraded by a later delta", /else \{ CG\._liveFullOwed = true; \}/.test(live) && /var full = !!CG\._liveFullOwed, delta = full \? null : CG\._liveGames/.test(live));
A("...and a pending full keeps its spread-out timer when a delta arrives", /if \(CG\._liveT && CG\._liveFullOwed && \(opts\.game \|\| opts\.roster\)\) return;/.test(live));
A("a retry after a busy build runs what was queued, not a full boot", /if \(CG\._liveAgain\)\{ CG\._liveAgain = false; CG\._liveT = setTimeout\(run, 0\); \}/.test(live) && /if \(!full && !delta && !roster\) return;/.test(live));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
