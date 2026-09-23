/* v2.87 — the Schedule desk shows the whole game week, and every game box carries its lineup.
   Run: node tools/schedule-desk-lineups.test.cjs
 *
 * Two things the commissioner asked for on game-day eve: management could see codes and server
 * picks on the desk but never WHO WAS DRESSED (it meant opening the builder game by game), and the
 * desk stopped after two nights, so a three-night week hid Friday's three games entirely.
 * Also pinned: the roster's own "This week's lineups" page fetches the whole week, not six games.
 */
const fs = require("fs"), path = require("path");
const live = fs.readFileSync(path.join(__dirname, "..", "src/live/part_live.js"), "utf8");
const hub = fs.readFileSync(path.join(__dirname, "..", "src/live/part6_hub.js"), "utf8");
let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };
const cut = (name) => { const i = live.indexOf("CG." + name + " = function"); return live.slice(i, live.indexOf("\n};", i) + 3); };

console.log("— CG.lineupStrip, the six on file");
{
  const CG = {
    _pubLineups: {}, lg: { _lineups: {}, players: [] },
    playerById: (lg, id) => ({ p1: { tag: "Frostbyte" }, p2: { tag: "GlassEater" }, p3: { tag: "BarDownBo" },
      p4: { tag: "Mitts McGee" }, p5: { tag: "SauceBoss77" }, p6: { tag: "ClapBombCarl" } })[id] || null,
    store: { get: () => ({}) },
  };
  global.esc = (s) => String(s);
  new Function("CG", "esc", cut("plannedLineup") + cut("lineupStrip"))(CG, global.esc);
  const g = { id: "g1", at: 0 };
  A("no lineup on file renders nothing at all", CG.lineupStrip(g, "BOS") === "");
  CG.lg._lineups["BOS:g1"] = { lw: "p1", center: "p2", rw: "p3", ld: "p4", rd: "p5", goalie: "p6" };
  const s = CG.lineupStrip(g, "BOS");
  A("a filed lineup names all six, in position order",
    /LW[\s\S]*Frostbyte[\s\S]*C<\/span>|LW/.test(s) && ["Frostbyte","GlassEater","BarDownBo","Mitts McGee","SauceBoss77","ClapBombCarl"].every((n) => s.includes(n)));
  A("...with the positions labelled", ["LW","C","RW","LD","RD","G"].every((p) => s.includes(">" + p + "<")));
  CG.lg._lineups["BOS:g1"] = { lw: "p1", center: null, rw: "p3", ld: "p4", rd: "p5", goalie: "p6" };
  A("a hole in the sheet reads 'not set', never a blank", /not set/.test(CG.lineupStrip(g, "BOS")));
  A("the reader can highlight one player", /chrome-tint/.test(CG.lineupStrip(g, "BOS", { highlight: "p1" })));
  A("...and does not when nobody is named", !/chrome-tint/.test(CG.lineupStrip(g, "BOS")));
}

console.log("\n— the desk draws the whole week");
{
  A("it keeps every night of the current week, not the first two",
    /var wkNo = \(upcoming\[0\] && upcoming\[0\]\.week\) \|\| null;/.test(live) &&
    /order\.filter\(function\(day\)\{ return nights\[day\]\.some\(function\(g\)\{ return \(g\.week\|\|1\) === wkNo; \}\); \}\)/.test(live));
  A("...with a fallback when the week is unknown, so it can never render nothing",
    /if \(!thisWeek\.length\) thisWeek = order\.slice\(0,2\);/.test(live));
  A("the tail note counts what is left over, not a hard-coded two",
    /if \(order\.length>thisWeek\.length\)/.test(live) && /\(order\.length-thisWeek\.length\)\+' more game night'/.test(live));
}

console.log("\n— every game box carries its sheet");
{
  A("the strip is drawn in the box, above the server picks",
    /var strip = CG\.lineupStrip \? CG\.lineupStrip\(g, club, \{ highlight: me && me\.id \}\) : "";/.test(live) &&
    live.indexOf("var strip = CG.lineupStrip") < live.indexOf("CG.serverVetoControls(g, me, lockAt);"));
  A("a set sheet says Set before its lock and Locked after", /\(past\?"Locked":"Set"\)/.test(live));
  A("an unset one says when it is due, and after the lock what that cost (Rule 3.2)",
    /Due by "\+CG\.fmtTime\(gLock\)\+", when it locks\./.test(live) &&
    /locked at "\+CG\.fmtTime\(gLock\)\+" with no sheet on file \(Rule 3\.2\)/.test(live));
  A("...and each box links to THAT game's builder", /href="#\/hub\/lineup\?game='\+g\.id\+'"/.test(live));
}

console.log("\n— the roster's own week page has the whole week to read");
{
  const m = live.match(/\}\)\.sort\(function\(a,b\)\{ return a\.at-b\.at; \}\)\.slice\(0,(\d+)\);/);
  A("loadMyLineups fetches a full week of games, not six", m && Number(m[1]) >= 9, m ? m[1] : "no match");
  A("the page itself is still gated on a roster spot", /if \(section==="lineups"\) return \(CG\.can\("lineup\.viewOwn"\) && CG\.me\(\) && CG\.me\(\)\.team\)/.test(hub));
  A("...and is in My Hub's nav for every rostered player", /mine\.push\(\["lineups","Lineups","grid"\]\)/.test(hub));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
