/* v2.39 — in pre-season games a club's Owner/GM/AGM may be dressed at any position (Rules 0.4, 2.1, 5.2);
   position groups are checked by the database at dress time (rehearsed in rollback on the live DB).
   Run: node tools/preseason-mgmt-flex.test.cjs */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const hub = R("src/live/part6_hub.js"), content = R("src/live/part3_content.js");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the per-game builder");
A("a pre-season game lets management fill any slot (camp players always could)", /var preGame = game\.stage==="preseason";\n  function flex\(p\)\{ return p\.squad==="tc" \|\| \(preGame && !!p\.mgmt\); \}/.test(hub));
A("...validate, the bench hint, the slot targets and auto-fill all use the one test", (hub.match(/flex\(p\)/g) || []).length >= 4);
A("...auto-fill ranks a rostered player at his own position first, then a borrowed manager, then camp (Rule 5.2 P2 kept)", /var rank = function\(p\)\{ return \(p\.squad==="tc"\?2:0\) \+ \(CG\.posGroup\(p\.pos\)!==CG\.posGroup\(pos\)\?1:0\); \};/.test(hub));
A("...the roster page's pre-season note names the exception too", /and in pre-season games so do your Owner, GM and AGM \(Rule 2\.1\)/.test(hub));
A("the owners' briefings carry the exception", /in \*\*pre-season games\*\* your Owner, GM and AGM can be dressed at any position/.test(R("CGHL-Season1-Owners-Briefing.md")) && /in \*\*pre-season games\*\* your Owner, GM and AGM can be dressed at any position/.test(R("CGHL-Season1-Owners-Briefing-DISCORD.txt")));
A("...and the refusal names the pre-season exception only when it applies", /Only training-camp players"\+\(preGame\?" and, in the pre-season, the Owner, GM and AGM":""\)\+" fill any position \(Rule 2\.1\)/.test(hub));
A("...with a note on the page for a pre-season game", /Pre-season game\.<\/b> No weekly caps, and your Owner, GM and AGM can be dressed at any position/.test(hub));

console.log("\n— the line creator");
A("while the club's next game is a pre-season game, management sits anywhere on a line", /var preAhead = !!\(CG\.preseasonOnlyAhead && CG\.preseasonOnlyAhead\(club\)\);/.test(hub) && /if \(p\.squad!=="tc" && !\(preAhead && p\.mgmt\)\)\{/.test(hub));
A("...and the bar says the line dresses in pre-season games only", /a line carrying one out of position dresses in pre-season games only \(Rule 5\.2\)/.test(hub));

console.log("\n— the rulebook says it (rendered JSON)");
{
  const rb = JSON.parse(content.match(/CG\.CONTENT = (\{[\s\S]*?\});\n/)[1]).rulebook;
  const sec = (id) => { for (const ch of rb.chapters) for (const s of ch.sections) if (s.id === id) return s.paragraphs.join(" "); };
  A("0.4: management may be dressed at any position in pre-season games, to get players into games", /in pre-season games its Owner, General Manager and Assistant General Manager may be dressed at any position/.test(sec("0.4")));
  A("2.1: two exceptions to the groups — camp, and management in the pre-season", /There are two exceptions/.test(sec("2.1")) && /in pre-season games only the club’s Owner, General Manager and Assistant General Manager may be dressed at any position/.test(sec("2.1")));
  A("5.2: the exception ends with the pre-season and a saved line will not dress into a regular-season game", /the exception ends with the pre-season, and a saved line that carries a manager out of his group will not dress into a regular-season or playoff game/.test(sec("5.2")));
  A("5.2: groups are applied when a lineup is filed, not only when built", /apply these groups when a lineup is filed, not only when it is built/.test(sec("5.2")));
  A("changelog 2.39", rb.changelog[0].version === "2.39" && /Pre-season flexibility for management/.test(rb.changelog[0].summary));
  A("...American spelling", !/practis|colour|centre|organis|defence/i.test(rb.changelog[0].summary + sec("5.2") + sec("2.1")));
}
console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
