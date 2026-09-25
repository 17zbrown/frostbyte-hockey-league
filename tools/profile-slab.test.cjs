/* v3.22 — the player profile is ONE box the width of the page.
 *
 * Commissioner, 2026-09-25, with a screenshot: "Move these boxes around in the player profile so
 * they are next to each other if there is space for it. Clean up the player profiles so all the
 * smaller module boxes fit into one larger box the size of the page. I dont want any gaps in the
 * middle of the boxes and I do not want any boxes to stick out lower, higher, or more to the side
 * than any other box on the page."
 *
 * The layout itself was measured in a real browser (see the record). This file pins the two things
 * that decide the geometry: the row-filling algorithm, and the CSS that removes the seams.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 220))); }
}
const pub = R("src/live/part5a_public.js"), head = R("src/live/part1_head.html"),
      rec = R("sql/2026-09-25-profile-slab.sql");
const flat = rec.replace(/\n--\s?/g, " ").replace(/\s+/g, " ");

/* run the real CG.slab, not a copy of it: a reimplementation here would pass while the shipped
   one is broken, which is the whole failure mode this file exists to catch */
const CG = {};
const src = pub.slice(pub.indexOf("CG.slab = function(mods){"), pub.indexOf("CG.ROUTES.player = function"));
new Function("CG", src)(CG);

console.log("\n— every row is filled, whatever modules exist");
{
  const rowsOf = (html) => {
    const rows = [];
    const re = /<div class="pmod" style="grid-column:span (\d+)"([^>]*)>/g;
    let m, cur = null;
    while ((m = re.exec(html))) {
      if (/data-col0/.test(m[2])) { cur = []; rows.push(cur); }
      cur.push(+m[1]);
    }
    return rows;
  };
  const mods = (n, wideAt = []) => Array.from({ length: n }, (_, i) => ({ html: "<i>" + i + "</i>", wide: wideAt.includes(i) }));

  for (let count = 1; count <= 10; count++) {
    for (const wide of [[], [0], [count - 1], [0, count - 1], Array.from({length: count}, (_, i) => i)]) {
      const rows = rowsOf(CG.slab(mods(count, wide)));
      const bad = rows.filter((r) => r.reduce((a, b) => a + b, 0) !== 12);
      A(`${count} modules, ${wide.length} wide: every row sums to 12`, bad.length === 0,
        JSON.stringify(rows));
    }
  }
  A("an empty list renders nothing at all, not an empty box", CG.slab([]) === "" && CG.slab(null) === "");
  A("a missing module is dropped so the rest re-pair, instead of leaving a hole",
    rowsOf(CG.slab([{html:"a"},{html:""},{html:"c"}])).every((r) => r.reduce((x,y)=>x+y,0) === 12));
  A("only the FIRST row is marked data-row0", (CG.slab(mods(6)).match(/data-row0/g) || []).length === 2);
  A("...and exactly one panel per row is marked data-col0",
    (CG.slab(mods(6)).match(/data-col0/g) || []).length === rowsOf(CG.slab(mods(6))).length);
  A("a lone leftover takes the whole row rather than sitting beside a gap",
    rowsOf(CG.slab(mods(3))).map((r) => r.join("+")).join(" | ") === "6+6 | 12",
    rowsOf(CG.slab(mods(3))).map((r) => r.join("+")).join(" | "));
  A("a wide module never shares a row", rowsOf(CG.slab(mods(3, [1]))).every((r) => r.length === 1 || !r.includes(12)));
}

console.log("\n— the CSS that removes the seams");
{
  A("the slab is a 12-column grid with NO gap", /\.pslab\{display:grid;grid-template-columns:repeat\(12,1fr\);gap:0/.test(head));
  A("...clipping its children to one rounded frame", /\.pslab\{[\s\S]{0,200}overflow:hidden/.test(head));
  A("panels divide with hairlines, not margins", /\.pslab>\.pmod\{[\s\S]{0,140}border-top:1px solid var\(--line-soft\);border-left:1px solid var\(--line-soft\)/.test(head));
  A("the top row and left edge do not double the slab's own border",
    /\.pslab>\.pmod\[data-row0\]\{border-top:0\}/.test(head) && /\.pslab>\.pmod\[data-col0\]\{border-left:0\}/.test(head));
  A("a card inside the slab gives up its own frame", /\.pslab>\.pmod>\.card[^{]*\{border:0;border-radius:0/.test(head));
  A("...and stretches, which is what makes a row end level", /\.pslab>\.pmod>\.card>\.card-b[^{]*\{flex:1\}/.test(head));
  A("one panel per row on a phone, because a half panel is narrower than its contents",
    /@media \(max-width:880px\)\{[\s\S]{0,220}\.pslab>\.pmod\{grid-column:span 12 !important/.test(head));
}

console.log("\n— the profile is assembled as modules, not two columns");
{
  A("the old two-column rail is gone from the player route",
    !/body \+= '<div class="grid g23"><div>'\+ leftTop/.test(pub) && !/var leftTop/.test(pub));
  A("the two viz panels are separate modules now", /var vizDna = "", vizEff = "";/.test(pub));
  /* scoped to the player route: the PICKUP stats section has its own vizCards pair that still
     uses grid g2 legitimately, and a repo-wide check would fail on that unrelated code */
  const route = pub.slice(pub.indexOf("CG.ROUTES.player = function"), pub.indexOf("CG.posSplitTable = function"));
  /* strip comments: the note explaining what this USED to be mentions grid g2 on purpose */
  const routeCode = route.replace(/\/\*[\s\S]*?\*\//g, "");
  A("...so neither is wrapped in its own grid g2 any more inside the player route",
    !/grid g2/.test(routeCode), (routeCode.split("\n").find((l) => /grid g2/.test(l)) || "").trim());
  A("and the player route no longer builds a stack rail at all", !/class="stack"/.test(routeCode));
  A("the KPI strip is a full-width module", /\{ html: kpiStrip, wide: true \}/.test(pub));
  A("the rating sits beside the contract", /\{ html: sideCard \}, \{ html: contractCard \}/.test(pub));
  A("the scouting text sits beside the broadcast card", /\{ html: scoutCard \}, \{ html: CG\.broadcastCard\(p\) \}/.test(pub));
  A("the tables and strips are wide", /\{ html: posCard, wide: true \}[\s\S]{0,120}\{ html: preCard, wide: true \}[\s\S]{0,120}\{ html: advCard, wide: true \}/.test(pub));
  A("the empty-state profile is a slab too", /body \+= CG\.slab\(isEmpty/.test(pub));
  A("the wide cards lost the top margin that would show as a gap inside a slab",
    !/var advCard = hasAdv \? '<div class="card" style="margin-top:18px"/.test(pub)
    && !/var preCard = \(ps && ps\.gp>0\) \? '<div class="card" style="margin-top:18px"/.test(pub));
}

console.log("\n— the record");
{
  A("it quotes the instruction", /I do not want any boxes to stick out lower, higher, or more to the side/.test(flat));
  A("it carries the MEASUREMENT that identified the defect", /741px/.test(flat));
  A("...taken in a real browser at a real width", /1440/.test(flat));
  A("it explains why a grid row fixes it for free", /A grid ROW makes its cells equal height/.test(flat));
  A("it records the after-measurements", /zero problems/i.test(flat));
  A("...including the phone", /390/.test(flat));
  A("the hidden-pane trap is recorded", /visibilityState/.test(flat) && /hidden/.test(flat));
  A("no em dash or spaced hyphen in the record", !/—/.test(rec) && !/ - /.test(rec));
}

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
