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
  for (const decl of [/CG\.NA_VIEW_GROW = [\d.]+;/, /CG\.NA_GROW_KEEP = \d+;/,
                      /CG\.NA_GROW_KEEP_MUL = [\d.]+;/, /CG\.NA_GROW_KEEP_MAX = \d+;/, /CG\.NA_PIN_MIN = \d+;/,
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

/* The hero's height, mirroring .na-wrap in part1_head.html: taller on large screens, because a
   desktop plot far wider than the map's own shape forces a horizontal zoom-out that shrinks every
   crest. Kept in step with the CSS by the assertion at the end of this file. */
function plotHeight(w, h) {
  return w >= 1200 ? Math.max(560, Math.min(900, Math.round(h * 0.78)))
                   : Math.max(240, Math.min(740, Math.round(h * 0.66)));
}

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
    const boxH = plotHeight(w, h);
    const r = layout(w, boxH);
    A(`${label} (${w}x${boxH}) — no crest clipped`, r.clipped.length === 0, r.clipped.join(","));
    A(`  …no two crests touching`, r.overlaps.length === 0, r.overlaps.slice(0, 4).join(" "));
    A(`  …crest still legible`, r.size >= CG.NA_PIN_MIN, `${r.size}px`);
  }
}

console.log("\n— logos sit on the real city, and the map shows the continent");
{
  /* the explicit brief: true positions, more geography. Desktop and tablet must honour it exactly */
  for (const [label, w, h] of [["ultrawide", 2560, 1440], ["monitor", 1960, 1080],
                               ["laptop", 1440, 900], ["small laptop", 1024, 768], ["tablet", 768, 1024]]) {
    const r = layout(w, plotHeight(w, h));
    A(`${label}: every pin on its true coordinate`, r.drift === 0, `${r.drift.toFixed(1)}px drift`);
  }
  const wide = layout(1960, plotHeight(1960, 1080));
  /* not necessarily 100%: NA_GROW_KEEP holds a readable crest, and the last stretch of framing is
     empty ocean and Arctic. What matters is that it is far more than the old club-tight crop. */
  /* Commissioner ruling 2026-08-30: on a large screen the LOGOS matter more than the last
     stretch of empty ocean — the map was showing ~85% of the drawn continent while rendering 35px
     crests (1.8% of a 1920 screen, specks). The frame still carries most of the geography; it just
     no longer buys the final slice at the cost of legible logos. */
  A("a monitor still frames the bulk of the continent", wide.shown >= 70, `${wide.shown.toFixed(0)}%`);
  A("...at true positions", wide.drift === 0);
  A("...with nothing hidden", wide.clipped.length === 0 && wide.overlaps.length === 0);
  A("a bigger screen never shows less of the map",
    layout(2560, plotHeight(2560, 1440)).shown >= wide.shown);
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

console.log("\n— logos grow with the device (the 2026-08-30 ask)");
{
  /* the complaint was concrete: crests were ~2% of the screen on a big monitor and every club had
     been dragged off its city. Both are pinned here. */
  const sizes = [[1280,800],[1440,900],[1680,1050],[1920,1080],[2560,1440]]
    .map(([w,h]) => ({ w, r: layout(w, plotHeight(w, h)) }));
  sizes.forEach(({w,r}) => {
    A(`${w}px wide: the crest is a real logo, not a speck`, r.size / w >= 0.02, `${r.size}px = ${(100*r.size/w).toFixed(1)}%`);
    A(`  …every club on its own city`, r.drift === 0, `${r.drift.toFixed(1)}px`);
    A(`  …nothing clipped or touching`, r.clipped.length === 0 && r.overlaps.length === 0);
  });
  for (let i = 1; i < sizes.length; i++)
    A(`a wider screen never shrinks the crest (${sizes[i-1].w}→${sizes[i].w})`,
      sizes[i].r.size >= sizes[i-1].r.size, `${sizes[i-1].r.size} → ${sizes[i].r.size}`);
  /* the specific regression that started this: 1920 used to render 35px */
  const at1920 = sizes.find((x) => x.w === 1920).r;
  A("1920 is comfortably larger than the 35px it used to render", at1920.size >= 44, `${at1920.size}px`);
  /* ultrawide used to push clubs out of frame entirely, and the clamp then parked them off-city */
  const uw = layout(3440, plotHeight(3440, 1440));
  A("an ultrawide holds every club in frame, on its city", uw.clipped.length === 0 && uw.drift === 0,
    `clipped=${uw.clipped.join(",")||"none"} drift=${uw.drift.toFixed(1)}px`);
}

console.log("\n— the framing search behaves");
{
  A("geography is still bought wherever the crest can afford it",
    layout(1960, plotHeight(1960, 1080)).grow >= 0.1, `grow=${layout(1960, plotHeight(1960, 1080)).grow}`);
  A("a cramped screen pulls the frame in rather than overlap",
    layout(768, plotHeight(768, 1024)).grow < layout(1960, plotHeight(1960, 1080)).grow);
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

console.log("\n— the model matches the stylesheet");
{
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part1_head.html"), "utf8");
  A("the small-screen hero height is what plotHeight() models",
    /\.na-wrap\{--pin:54px;position:relative;min-height:clamp\(440px,66vh,740px\)/.test(css));
  A("...and large screens get the taller one",
    /@media\(min-width:1200px\)\{ \.na-wrap\{min-height:clamp\(560px,78vh,900px\)\} \}/.test(css));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
