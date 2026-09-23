/* v2.91 — a club sets its own players' jersey numbers, and the line-creator card stops clipping.
   Run: node tools/jersey-numbers.test.cjs
 *
 * The number lives on the ROSTER SPOT (club + season), the column is NOT NULL with CHECK (1..99)
 * so there is no "unset", and no two players on a club may share one. The field commits on blur or
 * Enter and is put back to what the league holds if the write is refused, because a page showing a
 * number the club does not have is worse than one that never offered the edit.
 */
const fs = require("fs"), path = require("path");
const hub = fs.readFileSync(path.join(__dirname, "..", "src/live/part6_hub.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "src/live/part1_head.html"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

console.log("— the column");
{
  A("the roster table carries a # column, between the player and his position",
    /<th class="tleft sortable">Player<\/th><th class="sortable" title="Jersey number[^"]*">#<\/th><th class="sortable">POS<\/th>/.test(hub));
  A("...and the section headers span it", !/colspan="8"/.test(hub) && (hub.match(/colspan="9"/g) || []).length >= 2);
  A("management gets a field, everyone else the number", /canEditNum \? /.test(hub.replace(/\s+/g, " ")) || /\(canEditNum && !loan && !isDepth\(p\)\)/.test(hub));
  A("...gated on the same permission as the page's other roster moves",
    /var canEditNum = CG\.can\("roster\.manage"\) && \(!CG\.mgmtAccess \|\| CG\.mgmtAccess\("roster"\) !== "hidden"\);/.test(hub));
  A("a pre-season loan is not the club's to renumber", /\(canEditNum && !loan && !isDepth\(p\)\)/.test(hub));
  A("the field is bounded in the markup too, not only on the server",
    /type="number" min="1" max="99" step="1"/.test(hub));
  A("the cell still sorts on the number", /data-l="#" data-v="'\+\(p\.jersey\|\|0\)\+'"/.test(hub));
}

console.log("\n— committing a change");
{
  A("it writes through set_jersey_number and nothing else",
    /CG\.sb\.rpc\("set_jersey_number", \{ p_team: tid, p_profile: pid, p_number: n \}\)/.test(hub) &&
    !/from\("roster_spots"\)[\s\S]{0,60}\.update\(\s*\{\s*jersey/.test(hub));
  A("on blur or Enter, never on every keystroke",
    /el\.addEventListener\("change", commit\);/.test(hub) &&
    /if \(e\.key === "Enter"\)\{ e\.preventDefault\(\); el\.blur\(\); \}/.test(hub) &&
    !/addEventListener\("input", commit\)/.test(hub));
  A("an unchanged field writes nothing", /if \(el\.value === was\) return;/.test(hub));
  A("a refusal shows the rule's own words and puts the field back",
    /if \(r\.error\)\{ CG\.toast\(r\.error\.message, "err"\); el\.value = was; return; \}/.test(hub));
  A("...and nothing claims success before the server answers",
    hub.indexOf('CG.sb.rpc("set_jersey_number"') < hub.indexOf('was = String(n);'));
  A("the league in memory follows, so the table and the crests agree",
    /var pl = CG\.playerById\(CG\.lg, pid\); if \(pl\) pl\.jersey = n;/.test(hub));
  A("an out-of-range number is refused before it leaves the page",
    /if \(!\(n >= 1 && n <= 99\)\)\{ CG\.toast\("A jersey number is 1 to 99","err"\)/.test(hub));
}

console.log("\n— the line-creator card stops clipping");
{
  A("the name owns the top row: the chips moved into the meta row",
    /<span class="ln2">[\s\S]{0,400}weekLoadChip\(loadOf\(p\),"xs"\)[\s\S]{0,40}<\/span><\/span>/.test(hub));
  A("...on the camp board too", (hub.match(/weekLoadChip\(loadOf\(p\),"xs"\)\)\+\s*\n\s*'<\/span><\/span>'/g) || []).length >= 1 ||
    (hub.match(/weekLoadChip/g) || []).length >= 2);
  A("the name line is its own row and ellipses only as a last resort",
    /\.lc-pc \.two b\{font-size:12\.5px;line-height:1\.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap/.test(css));
  A("the position never breaks mid-word", /\.lc-pc \.two \.ps\{[^}]*white-space:nowrap\}/.test(css));
  A("the meta row wraps with room between rows", /\.lc-pc \.two \.ln2\{[^}]*row-gap:3px[^}]*flex-wrap:wrap/.test(css));
  A("...and its chips do not shrink", /\.lc-pc \.two \.ln2 \.chip\{flex:0 0 auto\}/.test(css));
  /* v2.92: the rating belongs on the NAME's line. Centered against the card it landed beside the
     meta row and crowded the position. */
  A("the rating sits on the name's line, not centered against the card",
    /\.lc-pc \.ov\{[^}]*align-self:flex-start;margin-top:3px;flex:0 0 auto\}/.test(css));
}

console.log("\n— the field on a phone");
{
  A("a coarse pointer gets a bigger target", /@media\(pointer:coarse\)\{\.jersey-in\{width:64px;padding:8px 6px;font-size:15px\}\}/.test(css));
  A("the field reads like the number it replaces", /\.jersey-in\{width:56px;[^}]*text-align:center;font-family:var\(--f-mono\)/.test(css));
  A("...with a visible focus ring", /\.jersey-in:focus\{outline:2px solid var\(--chrome-deep\)/.test(css));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
