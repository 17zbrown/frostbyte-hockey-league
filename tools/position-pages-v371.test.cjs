/* v3.71: Q30 the profile's Position picker (per-group season lines, center against wing), Q46 in the book.
   RUNS the group builder against a stub league. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 240))); } };
const pub = R("src/live/part5a_public.js"), live = R("src/live/part_live.js"), sql = R("sql/2026-09-28-position-pages-v371.sql");
A("Q30 quoted", /separate stat pages per position group via dropdown on the profile; show C vs W\s*(-- )?difference/.test(sql.replace(/\n--\s*/g, " ")));
A("the per-position overall table is read-only for the API roles", /revoke insert, update, delete, truncate, trigger, references on public\.player_position_overalls from anon, authenticated;/.test(sql));
A("the ratings note no longer offers an override", !/A commissioner CAN override a single rating/.test(live) && /Nobody hand-edits a rating, the commissioner included/.test(live));

const grab = (re, what) => { const m = pub.match(re); if (!m) { console.log("FAIL located " + what); process.exit(1); } return m[0]; };
const src = [/CG\.POS_VIEW_GROUPS = [^\n]+/, /CG\.posViewGroup = function\(b\)\{[\s\S]*?\n\};/, /CG\.posGroupLines = function\(pid\)\{[\s\S]*?\n\};/,
  /CG\.profileStatCells = function\(s, goalie\)\{[\s\S]*?\n\};/, /CG\.statCellsHtml = function\(cells\)\{[\s\S]*?\n\};/, /CG\.centerWingLine = function\(lines\)\{[\s\S]*?\n\};/]
  .map((re, i) => grab(re, "piece " + i)).join("\n");
const sk = (pos, g, a, shots) => ({ goalie:false, pos, g, a, pm:0, shots, hits:1, blk:0, tk:0, pim:0, gwg:0 });
const ctx = { CG: { lg: { results: [
  { home:"DAL", away:"BOS", box:{ DAL:{ p1: sk("C", 2, 1, 4) }, BOS:{} } },
  { home:"BOS", away:"DAL", box:{ BOS:{}, DAL:{ p1: sk("LW", 0, 1, 2) } } },
  { home:"DAL", away:"SEA", box:{ DAL:{ p1: sk("C", 1, 0, 3) }, SEA:{} } },
  { home:"PIT", away:"DAL", box:{ PIT:{}, DAL:{ p1: { goalie:true, pos:"G", sa:20, sv:18, ga:2, w:1, l:0, otl:0, so:0, qs:1 } } } }
] } }, esc: (v) => String(v) };
vm.createContext(ctx); vm.runInContext(src, ctx);
const L = ctx.CG.posGroupLines("p1");
A("center and wing are separate groups", L.C && L.C.gp === 2 && L.W && L.W.gp === 1, JSON.stringify(L));
A("...the groups add up (C 3 goals, W 0; one game in goal)", L.C.g === 3 && L.W.g === 0 && L.G && L.G.gp === 1 && L.G.w === 1);
A("a goaltender group uses the goaltender cells", /SV%/.test(ctx.CG.statCellsHtml(ctx.CG.profileStatCells(L.G, true))) && /Record/.test(ctx.CG.statCellsHtml(ctx.CG.profileStatCells(L.G, true))));
const cw = ctx.CG.centerWingLine(L);
A("center against wing, per game", /Center against wing, per game:<\/b> 2\.00 against 1\.00 points, 1\.50 against 0\.00 goals, 3\.50 against 2\.00 shots \(2 games at center, 1 on the wing\)/.test(cw), cw);
A("no comparison without both", ctx.CG.centerWingLine({ C: L.C }) === "");
A("the picker appears for two or more groups and re-renders in place", /var posPick = posKeys\.length >= 2/.test(pub) && /box\.innerHTML = CG\.statCellsHtml\(CG\.profileStatCells\(CG\.posGroupLines\(id\)\[v\], v === "G"\)\);/.test(pub));

global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = global.CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.71");
A("changelog records 3.71", !!e);
A("6.1.2: per-position season lines", /for each position group he has played, center, wing, defense and goal/.test(secs["6.1"].paragraphs[1]));
A("2.6.4 (Q46): an award may admit a new club", /the award admits it as a new club/.test(secs["2.6"].paragraphs[3]));
A("no em dashes or spaced hyphens in the 3.71 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
