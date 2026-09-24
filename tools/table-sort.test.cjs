/* v3.12 — every table heading is a sort control, and positions read in rink order everywhere.
 *
 * Commissioner: "make the filter function less clunky and just allow each column header to be
 * clickable and sorted that way" and "automatically list positions from top to bottom in all
 * places this would apply in the following order? LW, C, RW, LD, RD, G".
 *
 * Verified in a browser before this file was written: the club roster table shows 6 sortable
 * headers; clicking POS gives LW,LW,LW,C,C,RW,RW,RW,RW,LD,LD,RD,RD,G,G in the active block and
 * LW,C,C,RW,RW,RW,LD in the camp block, with both separator rows still in place; OVR sorts
 * 60,63,63,67,67,70 ascending and 89,79,77,70,70,70 descending; Stat Central sorts goals 0..9
 * and 9..7 with one ordering per click.
 */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
function A(name, cond, got) {
  n++;
  if (cond) console.log("ok   " + name);
  else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  — got: " + String(got).slice(0, 200))); }
}
const live = R("src/live/part_live.js");
const eng  = R("src/live/part2_engine.js");
const ui   = R("src/live/part4_ui.js");
const pub  = R("src/live/part5a_public.js");
const hub  = R("src/live/part6_hub.js");
const css  = R("src/live/part1_head.html");

console.log("\n— one sorting system, not two");
{
  A("the old per-table sorter is gone", !/CG\.sortTable = function/.test(ui));
  A("...and nothing calls it any more", !/CG\.sortTable\(/.test(pub) && !/CG\.sortTable\(/.test(live));
  A("...with the reason recorded where it used to live", /wired up in exactly\s+ONE place/.test(ui.replace(/\s+/g, " ")));
  A("...including the nine headers that advertised sorting and did nothing",
    /did nothing at all/.test(ui.replace(/\s+/g, " ")));
  A("the survivor honours the old sorter's data-v override too", /cell\.getAttribute\("data-v"\)/.test(live));
}

console.log("\n— every heading is a control");
{
  A("headings are made sortable", /th\.classList\.add\("tbl-sort"\)/.test(live));
  A("...clickable", /th\.addEventListener\("click", function\(\)\{ sortBy\(col\); \}\)/.test(live));
  A("...and reachable from the keyboard", /e\.key === "Enter" \|\| e\.key === " "/.test(live));
  A("...announcing the sort to assistive tech", /setAttribute\("aria-sort"/.test(live));
  A("first click ascending, then it toggles", /var asc = dir\[col\] !== "asc";/.test(live));
  A("a table that arrives pre-sorted is adopted, not fought",
    /if \(th\.classList\.contains\("sorted"\)\)\{\s*\n?\s*dir\[col\] = "desc";/.test(live));
}

console.log("\n— the things that make a sort correct rather than merely present");
{
  A("a POSITION column sorts in rink order", /if \(kind === "pos"\) return CG\.POS_RANK/.test(live));
  A("...recognising the long names too", /CG\.POS_RANK_LONG/.test(live));
  A("blanks sink in both directions", /if \(va === null\) return 1;/.test(live) && /if \(vb === null\) return -1;/.test(live));
  A("the sort is stable", /idx\.get\(a\) - idx\.get\(b\)/.test(live));
  A("money and percentages sort as numbers", /replace\(\/\[\$,%\\s\]\/g,""\)/.test(live));
  A("a record like 2-1-0 sorts by its parts", /if \(REC\.test\(t\)\)/.test(live));
  /* the bug that made the flagship table unsortable on the first attempt */
  A("a table with separator rows sorts WITHIN sections", /segs\.push\(cur\); cur = \{ sep: rw2, rows: \[\] \}/.test(live));
  A("...and the separators stay put", /if \(g\.sep\) frag\.appendChild\(g\.sep\);/.test(live));
  A("...with the reason recorded", /would fling those to one end and merge the two squads/.test(live.replace(/\s+/g, " ")));
}

console.log("\n— the filter is one box, not one per column");
{
  A("a single search input", /placeholder = "Search this table…"/.test(live));
  A("...matched against the whole row", /fold\(row\.textContent\)\.indexOf\(want\)/.test(live));
  A("...and it no longer builds an input per column", !/data-fcol/.test(live));
  A("clicking it does not also sort the heading it sits in", /e\.stopPropagation\(\);\s+\/\* the heading it sits in must not sort \*\//.test(live));
  A("the reason for the change is recorded", /a whole row of boxes to answer a question a click on a heading answers/.test(live.replace(/\s+/g, " ")));
}

console.log("\n— rink order, LW C RW LD RD G, where it applies");
{
  A("the rank lives in the engine, beside the names", /CG\.POS_RANK = \{ LW:1, C:2, RW:3, LD:4, RD:5, G:6 \};/.test(eng));
  A("...and not in part_live, which loads after its callers", !/CG\.POS_RANK = \{/.test(live));
  A("...with that load-order reason written down", /part_live\.js loads after both/.test(eng.replace(/\s+/g, " ")));
  A("a shared comparator exists", /CG\.byPosition = function/.test(eng));
  A("both squads come out of the shared splitter in rink order",
    /out\.active\.sort\(CG\.byPosition\(\)\);/.test(live) && /out\.camp\.sort\(CG\.byPosition\(\)\);/.test(live));
  A("the club roster array agrees with it", /var ord = CG\.POS_RANK;/.test(pub));
  A("the registrations chart starts at left wing", /\[\["LW","LW"\],\["C","C"\],\["RW","RW"\]/.test(pub));
  A("the by-position split table too", /var order = \["LW","C","RW","LD","RD","D","G"\];/.test(pub));
  A("the position dropdown too", /\["LW","C","RW","LD","RD","G"\]\.map\(function\(p\)\{ return '<option/.test(live));
  A("the overview chart too", /POSN = \["LW","C","RW","LD","RD","G"\]/.test(live));
}

console.log("\n— the three lists that were ordered WRONG, not merely differently");
{
  A("the availability grid no longer sorts positions alphabetically",
    !/isCamp\(b\)\?1:0\) \|\| a\.pos\.localeCompare\(b\.pos\); \}\);/.test(hub));
  A("...and says what that cost", /put the goaltender second in every availability grid/.test(hub.replace(/\s+/g, " ")));
  A("the lineup bench no longer does either", !/a\.pos\.localeCompare\(b\.pos\)\|\|a\.depth/.test(hub));
  A("the Control Center rosters no longer open on goaltenders", !/var o=\{G:0,LD:1,RD:2,C:3,LW:4,RW:5\}/.test(live));
  A("...with the reason recorded", /ran goalies FIRST/.test(live.replace(/\s+/g, " ")));
}

console.log("\n— a leaderboard is never re-sorted by position");
{
  /* a list ranked by a statistic must keep its ranking; sorting is offered by the header instead */
  A("the skater leaderboard still ranks by its stat", /lg\.pstats\[b\.id\]\[key\]-lg\.pstats\[a\.id\]\[key\]/.test(eng));
  A("the goalie leaderboard still ranks by save percentage", /\(B\.sv\/Math\.max\(1,B\.sa\)\) - \(A\.sv\/Math\.max\(1,A\.sa\)\)/.test(eng));
}

console.log("\n— the heading looks like a control");
{
  A("it shows a pointer", /\.tbl th\.tbl-sort\{cursor:pointer/.test(css));
  A("the arrow cannot reflow the heading", /\.tbl th\.tbl-sort::after\{content:"";position:absolute/.test(css));
  A("...and flips when descending", /\.tbl th\.tbl-sort\.sorted\.desc::after\{border-bottom:0;border-top/.test(css));
  A("keyboard focus is visible", /\.tbl th\.tbl-sort:focus-visible\{outline/.test(css));
}

console.log("\n" + (fail ? "FAIL " + fail + " of " + n : "PASS " + n));
process.exit(fail ? 1 : 0);
