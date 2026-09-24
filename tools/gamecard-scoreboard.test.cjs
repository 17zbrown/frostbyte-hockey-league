/* v3.10 — a night of games reads as a scoreboard, and a wide screen shows more than one.
 *
 * Commissioner, with a screenshot of the club schedule: "Can you make the visuals look more
 * organized and increase the use of the space given?"
 *
 * MEASURED, not guessed. On the club schedule at 1440px one card was 1228px wide with 326px of
 * dead space between the date column and the away club and 322px between the home club and the
 * status chip: 53% of the row was empty. Rows were also 100px tall and the score was glued to its
 * club's name, so "Mammoth" and "0" read as "Mammoth0".
 * After: two columns of 609px, 55px of slack a side at 1920px, every row exactly 75px, and 0 of
 * 108 club names truncated.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}
const css = R("src/live/part1_head.html");
const pub = R("src/live/part5a_public.js");
const hub = R("src/live/part6_hub.js");
const prev = R("src/live/preview_layer.js");

console.log("\n— the list is a grid, so width buys more games rather than more whitespace");
{
  A("the game lists use .gamelist, not a single column",
    /\.gamelist\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(540px,100%\),1fr\)\)/.test(css));
  A("...at every call site", (pub.match(/class="gamelist"/g) || []).length === 2 && /class="gamelist"/.test(hub),
    String((pub.match(/class="gamelist"/g) || []).length));
  A("no game list is still a plain stack",
    !/class="stack"[^>]*>'\+\w+\.map\(CG\.gameCard\)/.test(pub) && !/class="stack"[^>]*>'\+\w+\.map\(CG\.gameCard\)/.test(hub));
  /* the bug this guards: minmax() treats its first argument as a HARD minimum, so a bare 540px
     laid every card out 540px wide inside a 375px phone and pushed the scores off-screen */
  A("the track can shrink below its own minimum on a narrow phone", /minmax\(min\(540px,100%\),1fr\)/.test(css));
  A("...and the reason is recorded next to the rule",
    /minmax\(\) treats its first argument as a hard minimum/.test(css.replace(/\s+/g, " ")));
}

console.log("\n— the card is a scoreboard: two clubs flanking one centred score");
{
  A("five tracks, so crests and numbers line up down the list",
    /\.gamecard \.gc-match\{display:grid;grid-template-columns:minmax\(0,1fr\) auto auto auto minmax\(0,1fr\)/.test(css));
  A("a fixture with no result gets its own three-track template",
    /\.gamecard\.upcoming \.gc-match\{grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)\}/.test(css));
  A("...and the card is marked when there is no result", /'<div class="gamecard'\+\(res\?"":" upcoming"\)/.test(pub));
  A("the away club reads name then crest, the home club crest then name",
    /which==="away" \? nm\+CG\.crest\(code,19\) : CG\.crest\(code,19\)\+nm/.test(pub));
  A("each score is its OWN element, so the phone can move it beside its club",
    /<span class="gc-score num '\+which/.test(pub));
  A("the score is no longer glued to the club name",
    !/esc\(CG\.TEAM\[g\.(away|home)\]\.name\)\+\s*\n?\s*\(res\?'<span class="gc-score/.test(pub));
}

console.log("\n— nothing in the row can silently change its height");
{
  A("the date column cannot wrap", /\.gamecard \.gc-when span\{[^}]*white-space:nowrap\}/.test(css));
  A("...and the reason the track is 92px is recorded",
    /"10:10 PM ET" is the longest string it holds/.test(css.replace(/\s+/g, " ")));
  A("the status chip cannot wrap", /\.gamecard \.gc-tag \.chip\{white-space:nowrap\}/.test(css));
  A("the crest cannot be squashed by a long club name", /\.gamecard \.gc-match \.crest\{width:34px;height:34px;flex:0 0 auto\}/.test(css));
  A("digits are tabular, so a 1 and a 4 hold the same column", /font-variant-numeric:tabular-nums/.test(css));
}

console.log("\n— the status lane sizes to its own chip, not to the widest in the league");
{
  A("no fixed reservation on the chip lane", /\.gamecard \.gc-tag\{justify-self:end;display:flex;justify-content:flex-end;min-width:0\}/.test(css));
  A("...and why is written down, with what it cost",
    /stole 66px from the club names on every FINAL card/.test(css.replace(/\s+/g, " ")));
}

console.log("\n— the borrowed .gamecard rows elsewhere are not disturbed");
{
  /* the trade picker, holiday toggles, department filters and the complaints list all reuse
     .gamecard with their own inline grid-template-columns; the fixture-only tightening is
     scoped to .gamelist so it cannot reach them */
  A("the tighter padding is scoped to the fixture lists", /\.gamelist \.gamecard\{padding:11px 18px;gap:18px\}/.test(css));
  A("...and the base card keeps its original padding and gap",
    /\.gamecard\{display:grid;grid-template-columns:92px minmax\(0,1fr\) auto;gap:16px/.test(css) &&
    /border-radius:var\(--r-m\);padding:14px 18px/.test(css));
  A("the reason is recorded where the scope is", /borrowed as a generic clickable row/.test(css.replace(/\s+/g, " ")));
}

console.log("\n— the winner carries the weight, and the preview layer still finds it");
{
  A("the loser is dimmed rather than the winner shouted", /\.gamecard \.gc-score\.lose\{color:var\(--steel\)\}/.test(css));
  A("...and a tie leaves both level", /mine<other\?" lose":""/.test(pub));
  A("the preview override targets the side, not the number", /gc-score num ' \+ side/.test(prev));
  A("...and records why matching on the number was wrong",
    /two clubs can score the same/.test(prev.replace(/\s+/g, " ")));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
