/* v2.93 — every completed game shows a box score, and says WHY when it has none.
   Run: node tools/matchup-boxscore.test.cjs
 *
 * A final with no lines is a real state: a Rule 3.2 forfeit carries no individual statistics at
 * all, and a final that has not imported yet has none for a different reason. Both used to render
 * as a table of column headers with no rows and no explanation, which reads as a broken page.
 */
const fs = require("fs"), path = require("path");
const pub = fs.readFileSync(path.join(__dirname, "..", "src/live/part5b_public2.js"), "utf8");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— a final always has a box object, so the page cannot throw");
A("both clubs' boxes are initialized before any stat row is placed",
  /var box=\{\}; box\[g\.home\]=\{\}; box\[g\.away\]=\{\};/.test(live));

console.log("\n— an empty box explains itself");
{
  A("a forfeit says the rule that empties it", /No individual statistics are applied to a forfeited game \(Rule 3\.2\)/.test(pub));
  A("...and anything else says it has not imported yet, and what happens next",
    /The box score has not been imported yet[\s\S]{0,140}Rule 6\.2/.test(pub) &&
    /the statistics staff can attach it by hand/.test(pub));
  A("the note is chosen by whether the game was forfeited", /var emptyNote = res\.forfeit\s*\n?\s*\? /.test(pub));
  A("...and shown only when the club has no skaters AND no goalie",
    /\(!sk\.length && !gl \? '<div class="card-b"[^']*'\+emptyNote/.test(pub));
  A("Three Stars is replaced by the same explanation rather than rendering empty",
    pub.includes("(res.stars.length") &&
    pub.includes('<h3>Three Stars<\/h3><\/div><div class="card-b"><span class="caption">\'+emptyNote'.replace(/\\\//g, "/")));
}

console.log("\n— what must not have changed");
{
  A("a game with lines still renders the full skater table",
    pub.includes('<th class="tleft">Skater</th><th>G</th><th>A</th><th>P</th>'));
  A("...and the goalie line beneath it", pub.includes("G: '+esc(gl.p.tag)"));
  A("the box still reads from the imported result, never from a guess", /var box = res\.box\[code\];/.test(pub));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
