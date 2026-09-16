#!/usr/bin/env node
/* Headless screenshot driver for the demo build (2026-09-14, member guides).
   Drives the locally installed Chrome over the DevTools protocol with Node's built-in WebSocket —
   no Playwright/Puppeteer install. Takes a JSON shot list and writes PNGs.

     node tools/demo/shoot.mjs <shots.json> [--chrome <path>] [--port 9333]

   shots.json = { "base": "file:///…/demo.html", "out": "/dir", "shots": [ {
       "name": "roster",                      → out/roster.png
       "url": "?as=owner&theme=light#/hub/roster",   (joined to base)
       "width": 1440, "height": 1000,         viewport (device metrics), default 1440×1000
       "scale": 2,                            device scale factor (default 2 → crisp retina PNGs)
       "settle": 1200,                        ms to wait after load before acting (fonts, boot)
       "steps": [                             ordered, each waits ~150 ms after
         { "click": "#someBtn" },             element.click() by selector (scrolls into view first)
         { "eval": "CG.toast('hi','ok')" },   any JS in page
         { "type": ["#input", "text"] },      set value + dispatch input/change
         { "wait": 800 },                     ms
         { "scroll": 600 }                    window.scrollTo(0, n)
       ],
       "clip": "#selector",                   capture just this element (padding via "pad": 16)
       "fixed": true,                         with clip: the element is position:fixed (toast/modal) — capture it in the viewport
       "viewport": true                       capture the current viewport as-is (fixed elements included)
       "full": true,                          capture the full scrollable page
       "marks": { "1": "#avSubmit" }          → _report.json gets each element's box in % of this image (for pucks/rings)
   } ] }
   Every step is fail-loud: a selector that does not exist stops that shot with a clear message
   (and the run continues to the next shot), so a silently-blank guide screenshot cannot happen. */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const listPath = args[0];
if (!listPath) { console.error("usage: shoot.mjs <shots.json>"); process.exit(2); }
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const CHROME = opt("--chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const PORT = +opt("--port", 9333);
const list = JSON.parse(fs.readFileSync(listPath, "utf8"));
const OUT = list.out || path.dirname(listPath);
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync("/tmp/shoot-profile-");
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking", "--allow-file-access-from-files",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = ""; chrome.stderr.on("data", (d) => { stderr += d; });

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs = await r.json();
      const page = tabs.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a DevTools page in 15 s\n" + stderr.slice(-800));
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; this.waiters = [];
    ws.onmessage = (m) => { const j = JSON.parse(m.data);
      if (j.id) { const p = this.pending.get(j.id); this.pending.delete(j.id); if (!p) return; j.error ? p.rej(new Error(j.error.message)) : p.res(j.result); }
      else { this.events.push(j); this.waiters = this.waiters.filter((w) => !w(j)); } };
  }
  send(method, params = {}) { return new Promise((res, rej) => { const id = ++this.id; this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  waitFor(method, timeout = 15000) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout waiting for " + method)), timeout);
    this.waiters.push((j) => { if (j.method === method) { clearTimeout(t); res(j.params); return true; } return false; }); }); }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("page error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

function connect(url) { return new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(new CDP(ws)); ws.onerror = (e) => rej(new Error("ws error " + (e.message || ""))); }); }

const q = (s) => JSON.stringify(s);
async function runStep(cdp, step) {
  if (step.click) {
    const ok = await cdp.eval(`(function(){ var el=document.querySelector(${q(step.click)}); if(!el) return false; el.scrollIntoView({block:"center"}); el.click(); return true; })()`);
    if (!ok) throw new Error(`click: no element matches ${step.click}`);
  } else if (step.clickText) {
    const ok = await cdp.eval(`(function(){ var want=${q(step.clickText)}.trim(); var els=[].slice.call(document.querySelectorAll(${q(step.within || "button, a, [role=button], .btn, .seg-b, label, .tab, .chip")}));
      var el=els.find(function(e){ return e.textContent.trim()===want; }) || els.find(function(e){ return e.textContent.trim().indexOf(want)===0; }); if(!el) return false; el.scrollIntoView({block:"center"}); el.click(); return true; })()`);
    if (!ok) throw new Error(`clickText: nothing reads "${step.clickText}"`);
  } else if (step.type) {
    const [sel, val] = step.type;
    const ok = await cdp.eval(`(function(){ var el=document.querySelector(${q(sel)}); if(!el) return false; el.focus(); el.value=${q(val)}; el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`);
    if (!ok) throw new Error(`type: no element matches ${sel}`);
  } else if (step.eval) {
    await cdp.eval(step.eval);
  } else if (step.wait) {
    await sleep(step.wait);
  } else if (step.scroll !== undefined) {
    await cdp.eval(`window.scrollTo(0, ${+step.scroll})`);
  } else if (step.hash) {
    await cdp.eval(`location.hash = ${q(step.hash)}`);
    await sleep(600);
  } else throw new Error("unknown step " + JSON.stringify(step));
  await sleep(step.after ?? 150);
}

async function shoot(cdp, shot) {
  const width = shot.width || 1440, height = shot.height || 1000, scale = shot.scale || 2;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: !!shot.mobile });
  /* a phone shot is a touch device too: the site's pointer:coarse rules (tap targets, the rail
     hints) only apply with touch emulation on, and Chrome reports pointer:coarse from it */
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: !!shot.mobile, maxTouchPoints: shot.mobile ? 5 : 1 });
  if (shot.colorScheme) await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: shot.colorScheme }] });
  const url = /^[a-z]+:/.test(shot.url) ? shot.url : list.base + shot.url;
  /* every shot starts clean: what a previous shot saved in this origin's storage must not leak
     into the next one (a submitted form reappearing as "already submitted") */
  if (!shot.keepStorage) { try { await cdp.eval(`(function(){ try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return true; })()`); } catch { /* about:blank */ } }
  /* a URL that differs from the previous shot's only by its #hash would be a same-document
     navigation — the old page, with everything the last shot clicked, would still be there */
  await cdp.send("Page.navigate", { url: "about:blank" });
  await sleep(120);
  await cdp.send("Page.navigate", { url });
  await cdp.waitFor("Page.loadEventFired", 20000).catch(() => {});
  await sleep(shot.settle ?? 1200);
  /* the demo boots asynchronously — wait until the router has painted something */
  for (let i = 0; i < 40; i++) { const ready = await cdp.eval(`!!(document.querySelector("#view, main, .hub, .shell") && document.body.innerText.trim().length > 40)`); if (ready) break; await sleep(150); }
  for (const step of shot.steps || []) await runStep(cdp, step);
  await cdp.eval(`document.fonts && document.fonts.ready`);
  await sleep(shot.beforeShot ?? 250);
  let params = { format: "png", captureBeyondViewport: true };
  let fixedCrop = null;
  if (shot.clip) {
    const pad = shot.pad ?? 0;
    const rect = await cdp.eval(`(function(){ var el=document.querySelector(${q(shot.clip)}); if(!el) return null; el.scrollIntoView({block:"start"}); var r=el.getBoundingClientRect(); return { x:r.left+window.scrollX, y:r.top+window.scrollY, w:r.width, h:r.height }; })()`);
    if (!rect) throw new Error(`clip: no element matches ${shot.clip}`);
    if (shot.fixed) {
      /* a position:fixed element (toast, modal): Chrome paints fixed boxes relative to whatever
         viewport it captures, so shoot the real viewport and crop the element's box out of it */
      const vr = await cdp.eval(`(function(){ var r=document.querySelector(${q(shot.clip)}).getBoundingClientRect(); return { x:r.left, y:r.top, w:r.width, h:r.height }; })()`);
      params.captureBeyondViewport = false; delete params.clip;
      fixedCrop = { x: Math.max(0, vr.x - pad), y: Math.max(0, vr.y - pad), w: vr.w + pad * 2, h: vr.h + pad * 2 };
      params._clipCss = { width: Math.round(fixedCrop.w), height: Math.round(fixedCrop.h) };
    } else {
      const hh = Math.min(await cdp.eval(`Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))`), 12000);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: hh, deviceScaleFactor: scale, mobile: !!shot.mobile });
      await sleep(200);
      await cdp.eval(`window.scrollTo(0, 0)`);
      params.clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2, scale: 1 };
    }
  } else if (shot.full) {
    /* grow the viewport to the whole document first: sticky mastheads and sidebars then sit at
       their natural place instead of being painted mid-page where the last scroll left them */
    await cdp.eval(`window.scrollTo(0, 0)`);
    const h = Math.min(await cdp.eval(`Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))`), shot.maxHeight || 12000);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: scale, mobile: !!shot.mobile });
    await sleep(250);
    await cdp.eval(`window.scrollTo(0, 0)`);
    params.clip = { x: 0, y: 0, width, height: h, scale: 1 };
  } else if (shot.viewport) {
    /* exactly what is on screen right now, fixed elements included (toasts, modals) */
    params.captureBeyondViewport = false;
    delete params.clip;
  } else {
    params.clip = { x: 0, y: 0, width, height, scale: 1 };
  }
  const clipCssMeta = params._clipCss; delete params._clipCss;
  const file = path.join(OUT, shot.name + ".png");
  /* Chrome never returns a single capture much taller than ~12,000 device px (the call simply
     hangs), so a tall full-page poster is captured in tiles and stitched with PIL */
  const TILE = 4000;
  if (params.clip && params.clip.height * scale > 12000) {
    const parts = [];
    for (let y0 = 0; y0 < params.clip.height; y0 += TILE) {
      const hPart = Math.min(TILE, params.clip.height - y0);
      const r = await cdp.send("Page.captureScreenshot", { ...params, clip: { ...params.clip, y: params.clip.y + y0, height: hPart } });
      const pf = path.join(OUT, `${shot.name}.part${parts.length}.png`);
      fs.writeFileSync(pf, Buffer.from(r.data, "base64")); parts.push(pf);
    }
    const st = spawnSync("python3", ["-c", `from PIL import Image; import sys; out=sys.argv[1]; ims=[Image.open(p) for p in sys.argv[2:]]; W=max(i.width for i in ims); H=sum(i.height for i in ims); s=Image.new("RGB",(W,H),"white"); y=0
for i in ims: s.paste(i,(0,y)); y+=i.height
s.save(out)`, file, ...parts]);
    if (st.status !== 0) throw new Error("tile stitch failed: " + String(st.stderr));
    parts.forEach((pf) => fs.rmSync(pf, { force: true }));
  } else {
    const shotRes = await cdp.send("Page.captureScreenshot", params);
    fs.writeFileSync(file, Buffer.from(shotRes.data, "base64"));
  }
  if (fixedCrop) {
    const r = spawnSync("python3", ["-c", `from PIL import Image; import sys; im=Image.open(sys.argv[1]); s=float(sys.argv[6]); x,y,w,h=[float(v)*s for v in sys.argv[2:6]]; im.crop((int(x),int(y),int(x+w),int(y+h))).save(sys.argv[1])`, file, String(fixedCrop.x), String(fixedCrop.y), String(fixedCrop.w), String(fixedCrop.h), String(scale)]);
    if (r.status !== 0) throw new Error("fixed crop failed: " + String(r.stderr));
  }
  /* "crop": [left%, top%, width%, height%] — trim the finished capture (a masthead's right half,
     a page's central column) so a poster can show the control large instead of the whole width;
     marks below are reported against the trimmed image */
  let cropPct = null;
  if (shot.crop) {
    cropPct = shot.crop;
    const r = spawnSync("python3", ["-c", `from PIL import Image; import sys; im=Image.open(sys.argv[1]); W,H=im.size; l,t,w,h=[float(v)/100 for v in sys.argv[2:6]]; im.crop((int(W*l),int(H*t),int(W*(l+w)),int(H*(t+h)))).save(sys.argv[1])`, file, ...cropPct.map(String)]);
    if (r.status !== 0) throw new Error("crop failed: " + String(r.stderr));
  }
  const errs = await cdp.eval(`(window.__shootErrors||[]).slice(0,5)`);
  /* "marks": { "1": "#avSubmit", … } → where each element sits inside THIS capture, in % of the
     image, so a poster can drop its numbered pucks and rings exactly on the control */
  let marks = null;
  if (shot.marks) {
    const c = fixedCrop ? { x: fixedCrop.x, y: fixedCrop.y, width: fixedCrop.w, height: fixedCrop.h } : (params.clip || { x: 0, y: 0, width, height });
    marks = await cdp.eval(`(function(){ var out={}, m=${JSON.stringify(shot.marks)}, c=${JSON.stringify({ x: c.x, y: c.y, w: c.width, h: c.height })}, fixed=${!!(shot.fixed || shot.viewport)};
      Object.keys(m).forEach(function(k){ var el=document.querySelector(m[k]); if(!el){ out[k]=null; return; } var r=el.getBoundingClientRect();
        var x=r.left+(fixed?0:window.scrollX), y=r.top+(fixed?0:window.scrollY);
        out[k]={ left:+((x-c.x)/c.w*100).toFixed(2), top:+((y-c.y)/c.h*100).toFixed(2), width:+(r.width/c.w*100).toFixed(2), height:+(r.height/c.h*100).toFixed(2), cx:+((x+r.width/2-c.x)/c.w*100).toFixed(2), cy:+((y+r.height/2-c.y)/c.h*100).toFixed(2) }; });
      return out; })()`);
    if (cropPct && marks) {
      const [l, t, w, h] = cropPct;
      Object.keys(marks).forEach((k) => { const m = marks[k]; if (!m) return;
        const f = (v, o, sc) => +((v - o) / sc * 100).toFixed(2);
        marks[k] = { left: f(m.left, l, w), top: f(m.top, t, h), width: +(m.width / w * 100).toFixed(2), height: +(m.height / h * 100).toFixed(2), cx: f(m.cx, l, w), cy: f(m.cy, t, h) }; });
    }
  }
  return { file, bytes: fs.statSync(file).size, pageErrors: errs, clipCss: clipCssMeta || (params.clip ? { width: Math.round(params.clip.width), height: Math.round(params.clip.height) } : { width, height }), marks };
}

(async () => {
  const cdp = await connect(await endpoint());
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__shootErrors=[]; window.addEventListener("error",function(e){ window.__shootErrors.push(String(e.message)); }); window.addEventListener("unhandledrejection",function(e){ window.__shootErrors.push("rejection: "+String(e.reason&&e.reason.message||e.reason)); });` });
  const report = [];
  for (const shot of list.shots) {
    try { const r = await shoot(cdp, shot); report.push({ name: shot.name, ok: true, ...r }); console.log(`✓ ${shot.name}  ${r.bytes} B${r.pageErrors.length ? "  page errors: " + r.pageErrors.join(" | ") : ""}`); }
    catch (e) { report.push({ name: shot.name, ok: false, error: e.message }); console.log(`✗ ${shot.name}  ${e.message}`); }
  }
  fs.writeFileSync(path.join(OUT, "_report.json"), JSON.stringify(report, null, 1));
  chrome.kill("SIGTERM");
  await new Promise((r) => chrome.once("exit", r));
  for (let i = 0; i < 5; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(300); } }
  const bad = report.filter((r) => !r.ok).length;
  console.log(`${report.length - bad}/${report.length} shots written to ${OUT}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); chrome.kill("SIGTERM"); process.exit(1); });
