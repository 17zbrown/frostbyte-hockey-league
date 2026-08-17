/* The club map: every crest fully on screen, none touching another, at any window shape.
   Run: node tools/na-map.test.cjs

   The report was "the Seattle Kraken logo is clipped". Measuring the live page found something
   broader: the separation pass ASKED for only 86% of a crest horizontally and 72% vertically, so
   it accepted overlap by the remainder — Seattle sat 14px inside Vancouver on a 1440px monitor and
   six pairs touched on a phone, every one of them "passing". Seattle and Vancouver share a
   longitude to two decimal places, so they are the pair that always fails first, and a short wide
   hero squeezes latitude hardest.

   naMapView + naSeparate are pure geometry, so the whole invariant is checkable here across more
   window shapes than anyone would click through by hand. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part5a_public.js"), "utf8");

let ok = true;
const A = (l, p, x) => { if (!p) ok = false; console.log(`${p ? "ok  " : "FAIL"} ${l}${x ? "  — " + x : ""}`); };

const ctx = { console, Math, Object, Array, String, Number, Boolean, JSON, parseFloat, parseInt, isFinite, Infinity };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.CG = {};
vm.createContext(ctx);
/* the coordinate table and the two pure functions — not the DOM-driven layout around them */
{
  const map = src.match(/CG\.NA_MAP = \{[\s\S]*?\n\};/);
  if (!map) { A("located CG.NA_MAP", false); process.exit(1); }
  vm.runInContext(map[0], ctx);
  for (const decl of [/CG\.NA_PIN_MIN = \d+;/, /CG\.NA_NUDGE_CAP = \d+;/, /CG\.NA_PIN_GAP = \d+;/]) {
    const m = src.match(decl); if (!m) { A("located " + decl, false); process.exit(1); }
    vm.runInContext(m[0], ctx);
  }
  for (const fn of ["naMapView", "naSeparateAt", "naSeparate"]) {
    const m = src.match(new RegExp("CG\\." + fn + " = function[\\s\\S]*?\\n\\};"));
    if (!m) { A("located CG." + fn, false); process.exit(1); }
    vm.runInContext(m[0], ctx);
  }
}
const CG = ctx.CG;

/* the twelve clubs actually in the league, Seattle included */
const CLUBS = ["BOS", "MTL", "NYI", "PIT", "TOR", "COL", "DAL", "SEA", "SJS", "UTA", "VAN", "VGK"];
CG.TEAMS = CLUBS.map((c) => ({ code: c }));

/* Reproduce what the browser does: fit the window, place each pin at its mapped centre, then hand
   the measured rects to naSeparate exactly as naMapLayout does. */
function layout(boxW, boxH, base) {
  const box = { width: boxW, height: boxH };
  const v = CG.naMapView(box, 58);
  const m = CG.NA_MAP;
  const p = CLUBS.map((code) => {
    const at = m.at[code];
    const bx = (at[0] / 100 * m.w - v.x) * v.sx;
    const by = (at[1] / 100 * m.h - v.y) * v.sy;
    return { code, x: bx, y: by, ox: bx, oy: by, w: base, h: base, bx, by };
  });
  const size = CG.naSeparate(p, box, base);
  return { p, size, box };
}

function audit(boxW, boxH, base) {
  const { p, size, box } = layout(boxW, boxH, base);
  const half = size / 2;
  const clipped = p.filter((q) => q.fx - half < -0.5 || q.fy - half < -0.5 ||
                                  q.fx + half > box.width + 0.5 || q.fy + half > box.height + 0.5)
                   .map((q) => q.code);
  const overlaps = [];
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const dx = Math.abs(p[j].fx - p[i].fx), dy = Math.abs(p[j].fy - p[i].fy);
    if (dx < size && dy < size) overlaps.push(`${p[i].code}/${p[j].code}`);
  }
  return { size, clipped, overlaps };
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
    /* the stylesheet's crest size at that width: 38px under the phone breakpoint, else 54 */
    const base = w <= 560 ? 38 : 54;
    const boxH = Math.max(240, Math.round(h * 0.66));
    const r = audit(w, boxH, base);
    A(`${label} (${w}x${boxH}) — nothing clipped`, r.clipped.length === 0, r.clipped.join(","));
    A(`  …nothing overlapping`, r.overlaps.length === 0, r.overlaps.slice(0, 4).join(" "));
    A(`  …crest stays legible (>=${CG.NA_PIN_MIN}px)`, r.size >= CG.NA_PIN_MIN, `${r.size}px`);
  }
}

console.log("\n— the pair that always fails first");
{
  /* Seattle and Vancouver are 0.05% apart in longitude; if any pair is going to collide it is
     these two, so pin them explicitly rather than trusting the sweep to have covered it */
  const { p, size } = layout(1440, 594, 54);
  const sea = p.find((q) => q.code === "SEA"), van = p.find((q) => q.code === "VAN");
  const sep = Math.max(Math.abs(sea.fx - van.fx), Math.abs(sea.fy - van.fy));
  A("Seattle clears Vancouver", sep >= size, `${sep.toFixed(1)}px apart, ${size}px crests`);
  const { p: p2, size: s2 } = layout(390, 346, 38);
  const sea2 = p2.find((q) => q.code === "SEA"), van2 = p2.find((q) => q.code === "VAN");
  const sep2 = Math.max(Math.abs(sea2.fx - van2.fx), Math.abs(sea2.fy - van2.fy));
  A("...on a phone too", sep2 >= s2, `${sep2.toFixed(1)}px apart, ${s2}px crests`);
}

console.log("\n— the shrink is a last resort, not the usual answer");
{
  A("a roomy desktop keeps full-size crests", audit(1920, 713, 54).size === 54);
  A("a cramped phone shrinks rather than overlap", audit(320, 288, 38).size < 38);
  A("...but never below the legibility floor", audit(280, 200, 38).size >= CG.NA_PIN_MIN);
}

console.log("\n— separation is measured on boxes, not circles");
{
  /* two crests 40px apart on each axis are ~57px apart as circles but their squares overlap;
     this is the bug that left Boston inside the Islanders after the first attempt */
  const box = { width: 600, height: 600 };
  const mk = (x, y, c) => ({ code: c, x, y, ox: x, oy: y, w: 54, h: 54, bx: x, by: y });
  const p = [mk(200, 200, "A"), mk(240, 239, "B")];
  const size = CG.naSeparate(p, box, 54);
  const dx = Math.abs(p[1].fx - p[0].fx), dy = Math.abs(p[1].fy - p[0].fy);
  A("a diagonal near-miss is separated, not passed", Math.max(dx, dy) >= size,
    `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} size=${size}`);
}

console.log("\n— the CSS lets the layout own the crest size");
{
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "live", "part1_head.html"), "utf8");
  A("--pin is declared on .na-wrap, where JS can override it", /\.na-wrap\{--pin:54px;/.test(css));
  A("...and the phone breakpoint sets it there too, not on the crest",
    /\.na-wrap\{--pin:38px\}/.test(css) && !/\.na-pin \.crest,\.na-pin img,\.na-pin svg\{--pin:38px\}/.test(css));
  A("the layout resets it each pass, so shrinks cannot ratchet",
    /card\.style\.removeProperty\("--pin"\)/.test(src));
}

console.log(`\n${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
