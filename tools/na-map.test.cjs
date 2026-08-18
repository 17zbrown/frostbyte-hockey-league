/* The club map: every crest whole, none touching another, sitting on its own city, at any window.
   Run: node tools/na-map.test.cjs

   History, because each rule here was paid for:
     · "Seattle is clipped" turned out to be broader — the old separation pass asked for 86% of a
       crest across and 72% down, so it ACCEPTED overlap by the remainder. Seattle sat 14px inside
       Vancouver on a monitor and six pairs touched on a phone, all of it passing.
     · Crest size came from a CSS breakpoint, so it was 54px on a laptop and 54px on a 1960px
       monitor — 2.7% of the map, specks.
     · Then the brief became explicit: show the continent, put each logo on the real city, hide
       none of it. Pins stopped being nudged, so the only remaining lever is how wide the frame is
       and how big the crests are — and those two trade directly against each other.

   Seattle and Vancouver share a longitude to two decimal places, so they are always the binding
   pair. Everything below is pure geometry, checkable without a browser. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part5a_public.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, parseFloat, parseInt, isFinite, Infinity };
ctx.window = ctx; ctx.globalThis = ctx; ctx.CG = {};
vm.createContext(ctx);
{
  const map = src.match(/CG\.NA_MAP = \{[\s\S]*?\n\};/);
  if (!map) { A("located CG.NA_MAP", false); process.exit(1); }
  vm.runInContext(map[0], ctx);
  for (const decl of [/CG\.NA_VIEW_GROW = [\d.]+;/, /CG\.NA_GROW_KEEP = \d+;/, /CG\.NA_PIN_MIN = \d+;/,
                      /CG\.NA_PIN_GAP = \d+;/, /CG\.NA_PIN_SPAN = \d+;/, /CG\.NA_PIN_FLOOR = \d+;/,
                      /CG\.NA_PIN_CEIL = \d+;/, /CG\.NA_PIN_USABLE = \d+;/]) {
    const m = src.match(decl);
    if (!m) { A("located " + decl, false); process.exit(1); }
    vm.runInContext(m[0], ctx);
  }
  for (const fn of ["naPinBase", "naMapView", "naPinPoints", "naNudge", "naCrestRaw", "naCrestFit", "naMapGrow"]) {
    const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};"));
    if (!m) { A("located CG." + fn, false); process.exit(1); }
    vm.runInContext(m[0], ctx);
  }
}
const CG = ctx.CG, M = CG.NA_MAP;
const CLUBS = ["BOS", "MTL", "NYI", "PIT", "TOR", "COL", "DAL", "SEA", "SJS", "UTA", "VAN", "VGK"];
CG.TEAMS = CLUBS.map((c) => ({ code: c }));

/* exactly what naMapLayout does, minus the DOM */
function layout(w, h) {
  const box = { width: w, height: h };
  const base = CG.naPinBase(box);
  const grow = CG.naMapGrow(box, 58, base);
  const view = CG.naMapView(box, 58, grow);
  const p = CG.naPinPoints(box, 58, grow);
  const truth = p.map((q) => ({ bx: q.bx, by: q.by }));
  const raw = CG.naCrestRaw(p);
  let moved = false;
  if (raw < Math.max(CG.NA_PIN_USABLE, CG.NA_PIN_MIN)) {
    moved = true;
    const t = Math.max(CG.NA_PIN_MIN, Math.min(base, CG.NA_PIN_USABLE));
    CG.naNudge(p, box, t + CG.NA_PIN_GAP, Math.max(12, base * 0.6), base / 2 + 1);
  }
  const edge = base / 2 + 1;
  p.forEach((q) => {
    q.bx = Math.max(edge, Math.min(box.width - edge, q.bx));
    q.by = Math.max(edge, Math.min(box.height - edge, q.by));
  });
  const size = CG.naCrestFit(p, base);
  const clipped = p.filter((q) => q.bx - size / 2 < -0.5 || q.by - size / 2 < -0.5 ||
                                  q.bx + size / 2 > w + 0.5 || q.by + size / 2 > h + 0.5).map((q) => q.code);
  const overlaps = [];
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++)
    if (Math.abs(p[j].bx - p[i].bx) < size && Math.abs(p[j].by - p[i].by) < size)
      overlaps.push(`${p[i].code}/${p[j].code}`);
  const drift = Math.max(...p.map((q, i) => Math.hypot(q.bx - truth[i].bx, q.by - truth[i].by)));
  const shown = Math.min(100, view.w / (M.bl[2] - M.bl[0]) * 100);
  return { size, grow, clipped, overlaps, drift, shown, moved, p };
}

console.log("— every window shape a member might open the site in");
{
  const SHAPES = [
    ["ultrawide", 2560, 1080], ["desktop 1920", 1920, 1080], ["laptop 1440", 1440, 900],
    ["laptop 1280", 1280, 800], ["small laptop", 1024, 768], ["tablet landscape", 1024, 600],
    ["tablet portrait", 768, 1024], ["large phone", 430, 932], ["iPhone", 390, 844],
    ["android", 360, 740], ["small phone", 320, 568], ["very short hero", 1440, 320],
    ["tall narrow", 380, 1200], ["near square", 700, 700],
  ];
  for (const [label, w, h] of SHAPES) {
    const boxH = Math.max(240, Math.round(h * 0.66));
    const r = layout(w, boxH);
    A(`${label} (${w}x${boxH}) — no crest clipped`, r.clipped.length === 0, r.clipped.join(","));
    A(`  …no two crests touching`, r.overlaps.length === 0, r.overlaps.slice(0, 4).join(" "));
    A(`  …crest still legible`, r.size >= CG.NA_PIN_MIN, `${r.size}px`);
  }
}

console.log("\n— logos sit on the real city, and the map shows the continent");
{
  /* the explicit brief: true positions, more geography. Desktop and tablet must honour it exactly */
  for (const [label, w, h] of [["ultrawide", 2560, 900], ["monitor", 1960, 740],
                               ["laptop", 1440, 594], ["small laptop", 1024, 507], ["tablet", 768, 676]]) {
    const r = layout(w, h);
    A(`${label}: every pin on its true coordinate`, r.drift === 0, `${r.drift.toFixed(1)}px drift`);
  }
  const wide = layout(1960, 740);
  /* not necessarily 100%: NA_GROW_KEEP holds a readable crest, and the last stretch of framing is
     empty ocean and Arctic. What matters is that it is far more than the old club-tight crop. */
  A("a monitor frames most of the continent", wide.shown >= 85, `${wide.shown.toFixed(0)}%`);
  A("...at true positions", wide.drift === 0);
  A("...with nothing hidden", wide.clipped.length === 0 && wide.overlaps.length === 0);
  A("a bigger screen never shows less of the map", layout(2560, 900).shown >= wide.shown);
}

console.log("\n— a phone cannot have both, and says so by degrading the right thing");
{
  /* 12 clubs at true positions inside 390px fit about a 9px crest. Rather than ship something
     unreadable, the pins drift a little — but only there, and only a little. */
  const box = { width: 390, height: 346 };
  const base = CG.naPinBase(box);
  const grow = CG.naMapGrow(box, 58, base);
  const trueFit = CG.naCrestRaw(CG.naPinPoints(box, 58, grow));
  A("true positions on a phone would be unreadable", trueFit < CG.NA_PIN_USABLE, `${trueFit}px`);
  const r = layout(390, 346);
  A("...so the phone trades a little accuracy for a legible crest", r.moved && r.size >= CG.NA_PIN_MIN,
    `${r.size}px`);
  A("...and the drift stays small", r.drift <= 20, `${r.drift.toFixed(0)}px`);
  A("...while still hiding nothing", r.clipped.length === 0 && r.overlaps.length === 0);
  A("desktop never takes that trade", layout(1440, 594).moved === false);
}

console.log("\n— the framing search behaves");
{
  A("geography is preferred while crests stay legible",
    layout(1960, 740).grow >= 0.4, `grow=${layout(1960, 740).grow}`);
  A("a cramped screen pulls the frame in rather than overlap",
    layout(768, 676).grow < layout(1960, 740).grow);
  A("the raw fit is kept separate from the legibility floor, so the search can tell them apart",
    /CG\.naCrestRaw = function/.test(src) && /RAW, not the floored size/.test(src));
}

console.log("\n— separation is measured on boxes, not circles");
{
  /* two crests 40px apart on each axis are ~57px apart as circles but their squares overlap */
  const p = [{ code: "A", bx: 200, by: 200 }, { code: "B", bx: 240, by: 239 }];
  A("a diagonal near-miss is not mistaken for clearance", CG.naCrestRaw(p) <= 40, `${CG.naCrestRaw(p)}px`);
}

console.log("\n— the CSS lets the layout own the crest size");
{
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part1_head.html"), "utf8");
  A("--pin is declared on .na-wrap, where JS can override it", /\.na-wrap\{--pin:54px;/.test(css));
  A("...and the phone breakpoint sets it there too, not on the crest",
    /\.na-wrap\{--pin:38px\}/.test(css) && !/\.na-pin \.crest,\.na-pin img,\.na-pin svg\{--pin:38px\}/.test(css));
  A("the layout resets it each pass, so shrinks cannot ratchet",
    /card\.style\.removeProperty\("--pin"\)/.test(src));
  A("...and always writes the computed size, never only on a change",
    /card\.style\.setProperty\("--pin", size \+ "px"\);/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
