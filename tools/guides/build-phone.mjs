#!/usr/bin/env node
/* The PHONE edition of the member guides (2026-09-16).
     node tools/guides/build-phone.mjs [topic …]        (no topics = every topic with a shot list)
   For each topic: derive a phone shot list from tools/guides/shots/<topic>.json (same URLs, steps,
   clips and marks — a 520 px touch viewport), shoot it into tools/guides/shots-phone/<topic>/,
   write tools/guides/src-phone/<topic>.html from the desktop poster (guide-phone.css appended,
   screenshot paths re-pointed, every puck re-based on the phone capture so it sits beside the
   control it names), then render docs/guides/phone/<topic>.png at 560 CSS px wide.
   SHOOT_PORT=N picks the DevTools port; NO_SHOOT=1 skips the screenshot pass (re-layout only). */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = path.join(HERE, "src"), SRC_PHONE = path.join(HERE, "src-phone");
const SHOTS = path.join(HERE, "shots"), SHOTS_PHONE = path.join(HERE, "shots-phone");
const OUT = path.join(ROOT, "docs/guides/phone");
const PORT = process.env.SHOOT_PORT || "9375";
const PHONE_W = 520, CANVAS_W = 560;
for (const d of [SRC_PHONE, SHOTS_PHONE, OUT]) fs.mkdirSync(d, { recursive: true });

const want = process.argv.slice(2);
/* every poster source; a topic without a shot list (a rules poster with no screenshots) is
   laid out for the phone without a screenshot pass */
const topics = fs.readdirSync(SRC).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""))
  .filter((t) => !want.length || want.includes(t));
if (!topics.length) { console.error("no topics"); process.exit(2); }

function shoot(listPath, port) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/demo/shoot.mjs"), listPath, "--port", String(port)], { stdio: "inherit" });
  if (r.status) throw new Error("shoot failed for " + listPath);
}

/* the puck rule on a phone: a ring around the control and the puck sitting just OUTSIDE the
   ring's top-right corner (below the bottom-right corner when the control touches the top of the
   image). Phone controls are packed edge to edge, so a puck beside or on the control always
   covers a label; a ring says "this one" without covering anything. Figures in % of the image;
   the puck is 42 CSS px, so its half-width is converted from the capture's own size. */
const PUCK = 32, COL_W = 516;   /* the phone puck, and the poster column the image fills, CSS px */
function puckAt(box, img) {
  /* centered on the ring's top-right corner: half the puck sits on the control's own corner
     padding, half outside — the smallest footprint that still reads as "this one" */
  const scale = COL_W / img.width;
  const rx = PUCK / 2 / (img.width * scale) * 100, ry = PUCK / 2 / (img.height * scale) * 100;
  let left = box.left + box.width + 0.8, top = box.top - 1;
  left = Math.min(100 - rx, Math.max(rx, left));
  top = Math.max(ry, top);
  return { left: +left.toFixed(1), top: +top.toFixed(1) };
}
function ringAt(box) {
  return `<span class="ring" style="left:${(box.left - 0.8).toFixed(1)}%;top:${(box.top - 1).toFixed(1)}%;width:${(box.width + 1.6).toFixed(1)}%;height:${(box.height + 2).toFixed(1)}%"></span>`;
}

for (const topic of topics) {
  console.log("\n=== " + topic);
  const hasShots = fs.existsSync(path.join(SHOTS, topic + ".json"));
  const list = hasShots ? JSON.parse(fs.readFileSync(path.join(SHOTS, topic + ".json"), "utf8")) : { shots: [] };
  const outDir = path.join(SHOTS_PHONE, topic);
  fs.mkdirSync(outDir, { recursive: true });
  if (!process.env.NO_SHOOT && hasShots) {
    const phone = { base: list.base, out: outDir, shots: list.shots.map((s) => {
      const p = { ...s, width: PHONE_W, height: s.height ? Math.max(s.height, 900) : 900, mobile: true, scale: 2 };
      /* a desktop crop trimmed a wide strip, or cut a card at a paragraph that sits elsewhere on a
         phone; only the drawer's height trim (empty space below the list) still applies */
      if (p.crop && !/drawer/.test(p.name)) delete p.crop;
      /* a bottom sheet slides in; give it time to settle before a fixed-element capture */
      if (p.fixed) p.beforeShot = Math.max(p.beforeShot || 0, 900);
      /* tables scroll sideways on a phone: bring each marked control into its table's view, and
         scroll any other table to its action column (the end) so a button row is never cut */
      p.steps = (p.steps || []).concat([{ eval: `(function(){ var m=${JSON.stringify(p.marks || {})}; var seen=[];
        Object.keys(m).forEach(function(k){ var el=document.querySelector(m[k]); var w=el&&el.closest('.tblwrap'); if(!w) return; seen.push(w); w.scrollLeft=Math.max(0, el.offsetLeft + el.offsetWidth - w.clientWidth + 12); });
        document.querySelectorAll('.tblwrap').forEach(function(w){ if(seen.indexOf(w)<0 && w.scrollWidth>w.clientWidth) w.scrollLeft=w.scrollWidth; }); })()`, after: 200 }]);
      /* the hub sidebar is a horizontal rail of chips on a phone: scroll it so the chip the step
         points at (or the Team HQ end of it) is in the frame before the clip is taken */
      if (p.clip === ".hub-side") {
        p.pad = 0;   /* the rail already spans the viewport edge to edge — padding past it captures black */
        const sel = p.marks && Object.values(p.marks)[0];
        p.steps = (p.steps || []).concat([{ eval: sel
          ? `(function(){ var a=document.querySelector(${JSON.stringify(sel)}); var r=document.querySelector('.hub-side'); if(a&&r){ r.scrollLeft = Math.max(0, a.offsetLeft - r.clientWidth/2 + a.offsetWidth/2); } })()`
          : `(function(){ var r=document.querySelector('.hub-side'); if(r) r.scrollLeft = r.scrollWidth; })()`, after: 250 }]);
      }
      return p;
    }) };
    const lp = path.join(outDir, "_shots.json");
    fs.writeFileSync(lp, JSON.stringify(phone, null, 1));
    shoot(lp, PORT);
  }
  const report = fs.existsSync(path.join(outDir, "_report.json")) ? JSON.parse(fs.readFileSync(path.join(outDir, "_report.json"), "utf8")) : [];
  const byName = {}; report.forEach((r) => { byName[r.name] = r; });

  /* the phone poster: the desktop source with the phone sheet appended and every frame re-pointed
     at its phone capture; pucks re-based from the phone report where the shot list names them */
  let html = fs.readFileSync(path.join(SRC, topic + ".html"), "utf8");
  html = html.replace("</head>", '<link rel="stylesheet" href="../guide-phone.css"></head>');
  html = html.replace(/\.\.\/shots\//g, "../shots-phone/");
  html = html.replace(/<div class="frame"([^>]*)>(<img src="\.\.\/shots-phone\/[^/]+\/([^"]+)\.png"[^>]*>)((?:<span class="mark[^>]*>\d+<\/span>)*)/g, (m, attrs, img, name, marks) => {
    const rep = byName[name];
    if (!rep || !rep.ok) console.warn("  ! no phone capture for " + name + " — poster keeps the desktop marks");
    const cap = rep && rep.clipCss ? { width: rep.clipCss.width, height: rep.clipCss.height } : null;
    const out = marks.replace(/<span class="mark([^"]*)" style="left:([\d.]+)%;top:([\d.]+)%">(\d+)<\/span>/g, (mm, cls, l, t, n) => {
      const box = rep && rep.marks && rep.marks[n];
      if (!box || !cap) return mm;
      const at = puckAt(box, cap);
      return `${ringAt(box)}<span class="mark${cls}" style="left:${at.left}%;top:${at.top}%">${n}</span>`;
    });
    return `<div class="frame"${attrs}>${img}${out}`;
  });
  html = html.replace(/<title>([^<]*)<\/title>/, "<title>$1 (phone)</title>");
  fs.writeFileSync(path.join(SRC_PHONE, topic + ".html"), html);

  /* render */
  const rl = { base: "file://" + SRC_PHONE + "/", out: OUT,
    shots: [{ name: topic, url: topic + ".html", width: CANVAS_W, height: 900, scale: 2, settle: 1500, full: true, maxHeight: 12000, colorScheme: "light" }] };
  const rlp = path.join(OUT, "_render-" + topic + ".json");
  fs.writeFileSync(rlp, JSON.stringify(rl, null, 1));
  shoot(rlp, +PORT + 1);
  fs.rmSync(rlp, { force: true });
}
