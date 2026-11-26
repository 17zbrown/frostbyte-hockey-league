const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* v5.00 swap (i2, 2026-11-24): the BUILT site, as Netlify would publish it, in headless Chromium: node tools/ui/run.cjs sitebuild
   Every other suite serves src/s2/demo.html; this one runs tools/site-build.cjs (mode "next", then the flip, mode "s2",
   whose demo guard now passes: i3f deleted demo mode) into a temp folder, serves that folder as the domain root (applying its
   _redirects as Netlify would), and opens /next/ and / with j1's network mock answering every Supabase request from the recorded production reads (signed out):
   nothing reaches production, Netlify or Discord. It proves the one-file page and its bundle boot as the real site
   (live mode, the real supabase-js from /vendor, the real js/live.js), that no demo chrome shows there, that an old link
   lands on its page, and that each mode's build id reaches the version check. Reads only.
   i3f (2026-11-25): deleted "a rule's refusal says the rule and closes: no Try it anyway on the real site" (S2.override
   is gone; S2.locked, the one lock sheet left, is checked in its place: who may and why, then Close, and nothing else). */
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const { chromium } = require(PW);
const mock = require(process.env.S2_MOCK);
const SB = require("../site-build.cjs");
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more === undefined ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 700) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = (f) => { const w = console.warn, l = console.log; console.warn = console.log = () => {}; try { return f(); } finally { console.warn = w; console.log = l; } };
void S2_BASE;   /* run.cjs serves src/s2 too; this suite serves the build instead */

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json" };
/* a static host shaped like Netlify's: a folder answers with its index.html, with or without the slash; the folder's
   _redirects rules apply to a path that is not a file (Netlify's default, unforced); anything else 404 */
function serve(dir) {
  const hits = [], misses = [], redirected = [];
  const rules = fs.existsSync(path.join(dir, "_redirects")) ? fs.readFileSync(path.join(dir, "_redirects"), "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/)) : [];
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split("?")[0]);
    const rule = !fs.existsSync(path.join(dir, u)) && rules.find(([from]) => from.endsWith("/*") ? u.startsWith(from.slice(0, -1)) : u === from);
    if (rule) { redirected.push(u + " " + rule[2]); res.writeHead(Number(rule[2]), { Location: rule[1] }); return res.end(); }
    let f = path.join(dir, u);
    if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) { misses.push(u); res.writeHead(404); return res.end("not found"); }
    hits.push(u);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, origin: "http://127.0.0.1:" + srv.address().port, hits, misses, redirected })));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cghl-sitebuild-"));
  const N = path.join(tmp, "next"), S = path.join(tmp, "s2"), F = path.join(tmp, "fallback");
  quiet(() => SB.build(N, { root: "next" }));
  quiet(() => SB.build(S, { root: "s2" }));   /* the guard on: demo mode is gone (i3f) */
  quiet(() => SB.fallback(F));
  const b = await chromium.launch();
  const errors = [], strays = [];
  /* the pulse row the live client reads on a catch-up (a table read the recording does not hold) */
  /* club crests come from Supabase storage, which the recording does not hold: a blank image stands in (a later route wins) */
  const LOGOS = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/team-logos\//;
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  const routes = { "GET /rest/v1/live_pulse": () => ({ status: 200, json: { v: 1, d: {}, site_build: null, at: new Date().toISOString() } }) };
  async function open(origin, url) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await mock.install(ctx, { persona: "anon", page: false, routes });
    await ctx.route(LOGOS, (rt) => rt.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push(url + ": " + m.text()); });
    p.on("pageerror", (e) => errors.push(url + ": pageerror: " + e.message));
    p.on("close", () => { mock.unexpected(ctx).forEach((x) => strays.push(url + ": " + x)); });
    await p.goto(origin + url);
    await p.waitForFunction(() => window.S2 && S2.M && document.querySelector("#app header") && document.querySelector("#page h1, #page section"), null, { timeout: 30000 });
    await wait(600);
    return p;
  }

  console.log("## mode next: /next/ is the Season 2 site, the root is untouched");
  let h = await serve(N), p, r;
  p = await open(h.origin, "/next/#/today");
  r = await p.evaluate(() => ({ live: S2.LIVE, source: S2.load && S2.load.source, sb: !!(window.supabase && window.supabase.createClient && S2.sb), title: document.title,
    dock: !!document.querySelector(".demo-dock"), foot: (document.querySelector(".site-foot") || {}).textContent || "", about: !!document.querySelector('.site-foot a[href="#/concept"]'),
    build: S2.updates && S2.updates.build(), robots: (document.querySelector('meta[name="robots"]') || {}).content, scripts: [...document.scripts].map((s) => s.getAttribute("src")).filter(Boolean) }));
  A("the built page boots as the real site: live data, live mode, the real supabase-js client", r.live === true && r.source === "live" && r.sb, r);
  A("no demo dock, no concept note or About link in the footer, and the tab title is the league's", !r.dock && !/Concept preview/.test(r.foot) && !r.about && / · CGHL$/.test(r.title) && !/concept/i.test(r.title), r);
  A("/next/ is noindex and carries no build id (testers reload by hand)", r.robots === "noindex" && r.build === null, r);
  A("its scripts are supabase-js from /vendor and the one bundle from /s2/", r.scripts.length === 2 && /^\/vendor\/supabase-js-[0-9.]+\.min\.js$/.test(r.scripts[0]) && /^\/s2\/app-[0-9a-f]{12}\.js$/.test(r.scripts[1]), r.scripts);
  A("nothing it asked our host for was missing", h.misses.filter((u) => u !== "/favicon.ico").length === 0, h.misses);
  r = await p.evaluate(() => { S2.locked({ title: "Bid on a player", who: "A club's front office", why: "Rule S2.6 closes this to anyone else." });
    var sh = document.querySelector(".lk"); var out = { btns: sh ? [...sh.querySelectorAll("button")].map((x) => x.textContent) : null, t: sh ? sh.textContent : "", gone: typeof S2.override + typeof S2.setRole };
    if (sh) sh.querySelector("button").click(); return out; });
  await wait(300);
  A("a door the reader does not hold says who may and why, then Close: no View as and no Try it anyway on the real site",
    Array.isArray(r.btns) && r.btns.join() === "Close" && /Who may do this/.test(r.t) && /Rule S2\.6/.test(r.t) && r.gone === "undefinedundefined" && !(await p.$(".lk")), r);
  await p.evaluate(() => { location.hash = "#/schedule"; }); await wait(500);
  A("an old link (#/schedule, the forfeit notices' link) becomes its page in place", await p.evaluate(() => location.hash === "#/games" && !!S2.pages[S2.parse().name]));
  await p.context().close();
  p = await open(h.origin, "/next#/hub/tradehub");
  r = await p.evaluate(() => ({ hash: location.hash, live: S2.LIVE }));
  A("/next without the slash loads the same page (every path in it is absolute), and #/hub/tradehub lands on Team HQ's trades", r.live && r.hash === "#/hq?tab=trades", r);
  await p.context().close();
  A("the root is still the classic page (its own title and build id)", /<title>Chel Gaming Hockey League — Competitive 6v6 EA NHL<\/title>/.test(fs.readFileSync(path.join(N, "index.html"), "utf8")) &&
    /<meta name="cg-build" content="[0-9a-f]{12}">/.test(fs.readFileSync(path.join(N, "index.html"), "utf8")));
  h.srv.close();

  console.log("## mode s2: the flip, the Season 2 site only (the demo guard on)");
  h = await serve(S);
  const ver = JSON.parse(fs.readFileSync(path.join(S, "version.json"), "utf8"));
  p = await open(h.origin, "/#/today");
  r = await p.evaluate(() => ({ live: S2.LIVE, build: S2.updates && S2.updates.build(), robots: !!document.querySelector('meta[name="robots"]') }));
  A("the root is the Season 2 site, and its version check reads the release id version.json carries", r.live === true && r.build === ver.build && !r.robots, [r, ver.build]);
  await p.context().close();
  for (const old of ["/classic/#/hub/staffdesk", "/next/#/hub/tradehub"]) {
    p = await open(h.origin, old);
    r = await p.evaluate(() => ({ path: location.pathname, hash: location.hash, live: S2.LIVE }));
    A("an old " + old.split("/")[1] + " address lands on the Season 2 root through a temporary redirect, its route kept and aliased", r.live && r.path === "/" && /^#\/(desk|hq)/.test(r.hash), r);
    await p.context().close();
  }
  A("both redirects were 302, never a cacheable 301", h.redirected.length >= 2 && h.redirected.every((x) => / 302$/.test(x)), h.redirected);

  /* loader (2026-11-25, commissioner: "can you make a nice looking loading wheel instead of the page just saying Loading
     the League?"): the boot screen of the BUILT page, with the s2_league read held, so the wheel is on screen as long as a
     slow phone network keeps it there. Light and dark, a stored look over the system's, Reduce Motion, then the page */
  console.log("## mode s2: the boot screen is the activity wheel while the league is read");
  {
    const built = fs.readFileSync(path.join(S, "index.html"), "utf8"), head = built.slice(0, built.indexOf("</head>\n<body>"));   /* a stylesheet comment names <body> too */
    A("the built page carries the wheel: ui.css's .spin rules inlined, S2.spinner in the inlined loader, the look set in the head",
      built.indexOf("</head>\n<body>") > 0 && /<style>\/\* css\/ui\.css \*\/[\s\S]*\.spin-w i \{[^}]*animation: spin-spoke[\s\S]*@keyframes spin-spoke[\s\S]*<\/style>/.test(head) &&
      /<script>\/\* src\/s2\/js\/load\.js \*\/[\s\S]*S2\.spinner = function/.test(built) && /r\.setAttribute\("data-theme"/.test(head));
    const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map((x) => { x = x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const mix = (c, b, a) => { const y = b.match(/[\d.]+/g); return "rgb(" + c.match(/[\d.]+/g).slice(0, 3).map((x, i) => x * a + y[i] * (1 - a)).join(", ") + ")"; };   /* c at opacity a over b */
    /* one visit with the read held: what the boot screen is, then the page once the read is let go */
    async function held(o) {
      const ctx = await b.newContext(Object.assign({ viewport: o.vp || { width: 1440, height: 900 }, colorScheme: o.scheme }, o.reduce ? { reducedMotion: "reduce" } : {}, o.vp ? { isMobile: true, hasTouch: true } : {}));
      await mock.install(ctx, { persona: "anon", page: false, routes });
      await ctx.route(LOGOS, (rt) => rt.fulfill({ status: 200, contentType: "image/png", body: PNG }));
      await ctx.addInitScript((look) => { try { localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); if (look) localStorage.setItem("s2.theme", JSON.stringify(look)); } catch (e) { /* storage blocked */ } }, o.look || null);
      let release; const gate = new Promise((r) => { release = r; });
      await ctx.route(/\/rest\/v1\/rpc\/s2_league/, async (rt) => { await gate;   /* a later route wins: the mock answers once the gate opens */
        return o.fail ? rt.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }) }) : rt.fallback(); });
      const pg = await ctx.newPage(), errs = [];
      pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
      pg.on("pageerror", (e) => errs.push("pageerror: " + e.message));
      const hit0 = h.hits.length, bundleIn = () => h.hits.slice(hit0).filter((u) => /^\/s2\/app-[0-9a-f]{12}\.js$/.test(u)).length;
      await pg.goto(h.origin + "/#/today", { waitUntil: "domcontentloaded" });
      await pg.waitForSelector(".boot .spin", { state: "attached", timeout: 15000 });
      /* health crawl 11: the loader's preload fetches the bundle while the read is still held */
      for (let i = 0; i < 50 && !bundleIn(); i++) await wait(100);
      const bundleHeld = bundleIn();
      const s = await pg.evaluate(() => {
        const spin = document.querySelector(".boot .spin"), wheel = spin.querySelector(".spin-w"), anims = document.getAnimations().filter((a) => a.effect && spin.contains(a.effect.target));
        const props = anims.map((a) => a.effect.getKeyframes().map((k) => Object.keys(k).filter((x) => ["offset", "computedOffset", "easing", "composite"].indexOf(x) < 0)).flat());
        const spokes = Array.from(wheel.querySelectorAll("i")), fade = anims.filter((a) => a.effect.target === spin)[0];
        const trail = anims.filter((a) => spokes.indexOf(a.effect.target) >= 0).sort((a, b) => spokes.indexOf(a.effect.target) - spokes.indexOf(b.effect.target));
        let early = null, late = null, delay = null;
        if (fade) { delay = fade.effect.getTiming().delay; fade.pause(); fade.currentTime = 150; early = getComputedStyle(spin).opacity; fade.finish(); late = getComputedStyle(spin).opacity; }
        /* Reduce Motion's breath: the brightest spoke's opacity at the bottom of it (the wheel's lowest, sampled over a cycle) */
        const calm = anims.filter((a) => a.effect.target === wheel)[0]; let trough = null;
        if (calm) { calm.pause(); const top = Math.max.apply(null, spokes.map((x) => +getComputedStyle(x).opacity)); trough = 1;
          for (let t = 0; t <= 2 * calm.effect.getTiming().duration; t += 50) { calm.currentTime = t; trough = Math.min(trough, top * getComputedStyle(wheel).opacity); } calm.play(); }
        const r = wheel.getBoundingClientRect(), sr = spin.getBoundingClientRect(), cap = spin.querySelector(".spin-t");
        return { theme: document.documentElement.getAttribute("data-theme"), mode: document.documentElement.getAttribute("data-mode"), meta: (document.querySelector('meta[name="theme-color"]') || {}).content,
          bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(wheel).color,
          role: spin.getAttribute("role"), live: spin.getAttribute("aria-live"), label: spin.getAttribute("aria-label"), cap: cap && cap.textContent, spokes: spokes.length,
          hidden: [wheel.getAttribute("aria-hidden"), cap && cap.getAttribute("aria-hidden")],
          deg: spokes.map((x) => { const m = new DOMMatrix(getComputedStyle(x).transform); return (Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI) + 360) % 360; }),
          props: Array.from(new Set(props.flat())).sort(), eases: anims.map((a) => a.effect.getKeyframes().map((k) => k.easing).concat(a.effect.getTiming().easing)).flat(),
          trail: trail.map((a) => ({ ms: a.effect.getTiming().duration, delay: a.effect.getTiming().delay, it: a.effect.getTiming().iterations, run: a.playState, ease: a.effect.getKeyframes().map((k) => k.easing).join() })),
          name: getComputedStyle(wheel).animationName, trough, delay, early, late, w: Math.round(r.width), top: r.top, h: sr.height, cx: r.left + r.width / 2, cy: sr.top + sr.height / 2, vw: innerWidth, vh: innerHeight, n: anims.length };
      });
      s.aria = await pg.locator(".boot .spin").ariaSnapshot();   /* what assistive technology gets: the status and its text */
      /* the compositor probe (review 2026-11-25: the first wheel, a rotation in steps(), froze while the main thread worked,
         which is exactly when it is on screen: the bundle parsing, the league building). The page's main thread is held
         busy for 1.2 s, and the screen must keep changing inside that block. The frames come from CDP's screencast, which
         copies each frame the compositor draws and needs nothing from the page; a screenshot cannot (Playwright's runs
         script in the page first, and in headless Chromium Page.captureScreenshot itself waits for the main thread: tried,
         both waited the block out). The wheel is the only thing on the boot screen that moves, so distinct frames stamped
         inside the block are the wheel turning without the main thread. Measured while writing it: the spoke trail draws
         about 48 distinct frames in the block, a spoke animating width (main thread) draws none, and the old stepped turn
         drew 8, one per step, because headless Chromium 155 composites steps(). WebKit does not (the no-steps check
         above), so this probe guards the Chromium half: an SVG-child, layout or script-driven wheel fails it */
      if (o.probe) {
        const cdp = await ctx.newCDPSession(pg), frames = [], acks = [];
        cdp.on("Page.screencastFrame", (f) => {
          frames.push({ at: f.metadata && f.metadata.timestamp ? f.metadata.timestamp * 1000 : Date.now(), png: f.data });
          cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch((e) => acks.push(e.message));   /* said in the probe's result */
        });
        await cdp.send("Page.startScreencast", { format: "png", maxWidth: 480, maxHeight: 480 });
        await wait(300);
        await pg.evaluate(() => { setTimeout(() => { window.__busy = { s: Date.now() }; const end = performance.now() + 1200; while (performance.now() < end); window.__busy.e = Date.now(); }, 0); });
        await pg.waitForFunction(() => window.__busy && window.__busy.e, null, { timeout: 10000 });   /* answers once the block is over */
        const busy = await pg.evaluate(() => window.__busy);
        await cdp.send("Page.stopScreencast");
        const inside = frames.filter((f) => f.at > busy.s + 50 && f.at < busy.e);
        s.probe = { frames: frames.length, inside: inside.length, distinct: new Set(inside.map((f) => f.png)).size, ms: busy.e - busy.s, acks: acks.slice(0, 2) };
      }
      release();
      if (o.fail) {   /* the read fails: the loader's error screen, where the wheel was */
        await pg.waitForSelector(".boot > .empty-state.err", { timeout: 15000 });
        s.err = await pg.evaluate(() => { const b = document.querySelector(".boot > .empty-state.err"), r = b.getBoundingClientRect(), t = b.querySelector(".t-head");
          return { role: b.getAttribute("role"), title: t.textContent, retry: !!b.querySelector("#s2Retry"), spin: !!document.querySelector(".spin"), cx: r.left + r.width / 2, cy: r.top + r.height / 2,
            top: t.getBoundingClientRect().top, align: getComputedStyle(t).textAlign, vw: innerWidth, vh: innerHeight }; });
        await ctx.close();
        return s;
      }
      const up = await pg.waitForFunction(() => window.S2 && S2.M && document.querySelector("#app header") && document.querySelector("#page h1, #page section"), null, { timeout: 30000 }).then(() => true, () => false);
      s.after = await pg.evaluate(() => ({ boot: !!document.querySelector(".boot, .spin"), theme: document.documentElement.getAttribute("data-theme"), state: S2.state.theme, bg: getComputedStyle(document.body).backgroundColor }));
      s.up = up; s.errs = errs.filter((e) => !/^Failed to load resource/.test(e));
      s.bundle = { held: bundleHeld, total: bundleIn() };
      await ctx.close();
      return s;
    }
    for (const scheme of ["light", "dark"]) {
      const s = await held({ scheme, probe: true });
      /* review 2026-11-25: the caption is the status's text, read once; the old aria-label over an aria-hidden caption gave
         assistive technology a status with no text inside it, so the snapshot (the accessibility tree) is checked, not a name */
      A(scheme + ": while the league is read, the boot screen is the wheel (eight spokes, hidden from assistive technology) in a status whose text is the caption Loading the league",
        s.spokes === 8 && s.role === "status" && s.live === null && s.label === null && s.hidden[0] === "true" && s.hidden[1] === null && s.cap === "Loading the league" &&
        /^- status:\s*\n\s+- paragraph: Loading the league\s*$/.test(s.aria), [s.aria, s.role, s.live, s.label, s.hidden, s.cap]);
      /* review 2026-11-25: html starts at data-mode site, so the boot screen is on the public pages' canvas and bar (white in
         light) and #/today, a site page, draws on the same canvas: no gray-to-white jump */
      A(scheme + ": the look is the system's from the first paint, on the public pages' canvas and status bar (" + (scheme === "dark" ? "black" : "white") + "), the same canvas the page then draws on",
        s.theme === scheme && s.mode === "site" && s.bg === (scheme === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)") && s.meta === (scheme === "dark" ? "#000000" : "#ffffff") && s.after.bg === s.bg, [s.theme, s.mode, s.bg, s.meta, s.after.bg]);
      A(scheme + ": the spokes clear 3:1 against the canvas (WCAG 1.4.11 for a graphic): " + ratio(s.ink, s.bg).toFixed(2) + ":1", ratio(s.ink, s.bg) >= 3, [s.ink, s.bg]);
      A(scheme + ": it is invisible for its first 150ms (a quick load shows nothing) and fully there once faded in", s.delay >= 150 && s.early === "0" && s.late === "1", [s.delay, s.early, s.late]);
      /* review 2026-11-25: the turn is one opacity trail per spoke, never a rotation in steps() (WebKit keeps steps() on the
         main thread, and every browser on an iPhone is WebKit; this suite's Chromium cannot show that, so the timing is
         pinned here and the probe below proves the Chromium half) */
      A(scheme + ": the turn is eight endless linear opacity trails, at most a second a turn, the brightest spoke moving clockwise (spoke k at k x 45 degrees, 100ms behind spoke k - 1), and only opacity animates",
        s.trail.length === 8 && s.trail.every((t) => t.it === Infinity && t.run === "running" && t.ms <= 1000 && /^linear(,linear)*$/.test(t.ease)) &&
        s.trail.every((t, k) => k === 0 || Math.round(t.delay - s.trail[k - 1].delay) === 100) && s.deg.join() === "0,45,90,135,180,225,270,315" && JSON.stringify(s.props) === '["opacity"]', [s.trail.slice(0, 3), s.deg, s.props]);
      A(scheme + ": no animation in the wheel runs in steps() (WebKit cannot composite one, so it would freeze while the bundle parses)", s.eases.length > 0 && !s.eases.some((e) => /steps/.test(e)), s.eases);
      A(scheme + ": it keeps moving while the main thread is busy (held 1.2 s; the compositor draws new frames of it inside the block)", s.probe && s.probe.distinct >= 3, s.probe);
      A(scheme + ": the wheel is centered in the viewport, on a whole pixel (the caption's line box is whole too)", Math.abs(s.cx - s.vw / 2) <= 1 && Math.abs(s.cy - s.vh / 2) <= 2 && Number.isInteger(s.top) && Number.isInteger(s.h), [s.cx, s.cy, s.vw, s.vh, s.top, s.h]);
      A(scheme + ": the page replaces it once the read lands, in the same look, with no console error", s.up && !s.after.boot && s.after.theme === scheme && s.after.state === scheme && s.errs.length === 0, [s.after, s.errs.slice(0, 3)]);
      /* health crawl 11 (2026-11-25): js/load.js inserts the bundle only after the league reads, so it waited for them; the
         loader preloads it once it has asked for the read, and the script it inserts uses that one response */
      A(scheme + ": the bundle downloads while the league is still being read, and only once (the inserted script uses the preload)", s.bundle.held === 1 && s.bundle.total === 1, s.bundle);
    }
    /* dark stored on a light system (review 2026-11-25): the old loader painted light at boot whatever was stored, so only
       this direction fails on it; light stored on a dark system passed there too and pinned nothing */
    let s = await held({ scheme: "light", look: "dark" });
    A("a look chosen in You, Settings wins over the system's from the first paint (dark on a light system), and the page keeps it",
      s.theme === "dark" && s.bg === "rgb(0, 0, 0)" && s.after.theme === "dark" && s.after.state === "dark", [s.theme, s.bg, s.after]);
    s = await held({ scheme: "light", reduce: true, vp: { width: 390, height: 844 } });
    A("Reduce Motion: the trail stands still (no spoke animates); the wheel breathes its opacity instead, still hidden for 150ms",
      s.trail.length === 0 && s.name === "spin-calm" && JSON.stringify(s.props) === '["opacity"]' && s.early === "0" && s.late === "1", [s.trail, s.name, s.props, s.early, s.late]);
    A("Reduce Motion: at the bottom of each breath the brightest spoke still clears 3:1 on the canvas (review 2026-11-25: 1.8:1 at a .45 dip): " + (s.trough ? ratio(mix(s.ink, s.bg, s.trough), s.bg).toFixed(2) : "?") + ":1",
      s.trough > 0 && s.trough < 1 && ratio(mix(s.ink, s.bg, s.trough), s.bg) >= 3, [s.trough, s.ink, s.bg]);
    A("Reduce Motion at 390: still centered on a whole pixel, the same size, and gone once the page draws", s.w === 32 && Math.abs(s.cx - s.vw / 2) <= 1 && Math.abs(s.cy - s.vh / 2) <= 2 && Number.isInteger(s.top) && s.up && !s.after.boot, [s.w, s.cx, s.cy, s.vw, s.vh, s.top, s.after]);
    /* review 2026-11-25: a failed read (here a 503; the 20 s timeout ends in the same screen) was drawn in .page, pinned to
       the top left with no top inset, under an iPhone's status bar; it now takes the wheel's place */
    s = await held({ scheme: "light", fail: true, vp: { width: 390, height: 844 } });
    A("a read that fails ends the wait where the wheel was: The league did not answer, with Try again, centered in the same frame at 390 (not pinned under the status bar)",
      s.err && s.err.role === "alert" && s.err.title === "The league did not answer" && s.err.retry && !s.err.spin && s.err.align === "center" &&
      Math.abs(s.err.cx - s.err.vw / 2) <= 1 && Math.abs(s.err.cy - s.err.vh / 2) <= 2 && s.err.top > 100, s.err);
  }

  /* i3f (2026-11-25): the switched site, as members get it. Each page is the built root signed in through its own
     supabase-js client (the harness seeds the persona's stored sign-in; page: false, so nothing is injected) and its reads
     answered as an empty league office would: no case, no application, no club move or notice, no lineup on file. No
     console error and no read the harness did not answer, on each page the switch must carry */
  console.log("## mode s2: the pages a visitor, a GM, a staffer and a commissioner open, signed in through the site's own client");
  const OFFICE = {
    rpcs: { has_department: mock.ok(false), is_app_reviewer: mock.ok(true), staff_voter_count: mock.ok(11), can_vote_committee_app: mock.ok(false), season_survey_results: mock.ok({ responses: [] }),
      is_any_committee_manager: Object.assign(mock.fail("PGRST202", "Could not find the function public.is_any_committee_manager(p_profile) in the schema cache"), { status: 404 }) },
    tables: { action_requests: [], action_messages: [], owner_applications: [], staff_applications: [], management_applications: [], committee_applications: [], application_ballots: [],
      application_messages: [], suspension_record: [], committees: [], team_mgmt_policy: [], team_mgmt_moves: [], club_notices: [], game_lineups: [], game_vetoes: [], trades: [],
      suspension_requests: Object.assign(mock.fail("PGRST205", "Could not find the table 'public.suspension_requests' in the schema cache"), { status: 404 }) }
  };
  /* a real profile (review, 2026-11-25): the current season has no games yet, so a bare #/player has no points leader and
     draws "No points leader yet". The member is one signed up for the season who played Season 1, taken from the
     recording at run time (no name is written here) */
  const L0 = mock.league({}), club = L0.teams[0].code, played = new Set(mock.league({ p_season: 1 }).rosters.spots.map((x) => x.profile_id));
  const su = L0.signups.filter((x) => played.has(x.profile_id))[0] || L0.signups[0], who = { id: su.profile_id, tag: ((L0.people.filter((x) => x.id === su.profile_id)[0] || su).gamertag || "").trim() };
  /* [persona, address, the address it settles on, the role the session must give (S2.roleOf), the profile it must draw] */
  for (const [persona, hash, ready, role, pf] of [["anon", "#/today", "#/today", "guest"], ["anon", "#/standings", "#/standings", "guest"], ["anon", "#/club/" + club, "#/club/", "guest"],
    ["anon", "#/player/" + who.id, "#/player/" + who.id, "guest", who], ["anon", "#/rulebook", "#/rulebook", "guest"], ["gm", "#/hq", "#/hq", "office"], ["staff", "#/desk", "#/desk", "staff"],
    ["commissioner", "#/control", "#/control", "commish"]]) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await mock.install(ctx, { live: true, persona, page: false, routes, rpcs: OFFICE.rpcs, tables: OFFICE.tables });
    await ctx.route(LOGOS, (rt) => rt.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); } catch (e) { /* storage blocked */ } });
    const pg = await ctx.newPage(), errs = [];
    pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    pg.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    await pg.goto(h.origin + "/" + hash);
    const up = await pg.waitForFunction((want) => window.S2 && S2.LIVE && S2.auth && S2.auth.sub && (want === "anon" ? !S2.session.user : !!S2.session.user) && document.querySelector("#app header") &&
      document.querySelector("#page h1, #page section"), persona, { timeout: 30000 }).then(() => true, () => false);
    await wait(2500);   /* the pages' own reads (the desk, the office, the market) land and repaint */
    r = await pg.evaluate(() => ({ hash: location.hash, role: S2.state.role, h1: ((document.querySelector("#page h1") || {}).textContent || "").trim(),
      failed: /could not be drawn/.test(document.body.textContent), dock: !!document.querySelector(".demo-dock"), lock: !!document.querySelector(".ws-lock"),
      pid: (document.querySelector("#pfRoot") || { dataset: {} }).dataset.pid || null, nf: !!document.querySelector(".pfx-nf") }));
    const stray = mock.unexpected(ctx);
    /* the workspace itself, never the S2.page("locked") hero a session without the seat or the power gets */
    const drawn = r.role === role && !r.lock && (!pf || (r.pid === pf.id && r.h1 === pf.tag && !r.nf));
    A(persona + " " + hash.replace(who.id, "<member>") + ": the switched site draws it signed in as " + persona + " (role " + role + (pf ? ", the member's own profile" : "") + "), with no console error and no unanswered read",
      up && drawn && r.hash.indexOf(ready) === 0 && !r.failed && !r.dock && errs.filter((e) => !/^Failed to load resource/.test(e)).length === 0 && stray.length === 0,
      { r: Object.assign({}, r, { h1: r.h1.slice(0, 60), pid: r.pid && r.pid === who.id ? "<member>" : r.pid }), errs: errs.slice(0, 4), stray: stray.slice(0, 6) });
    await ctx.close();
  }
  h.srv.close();

  console.log("## fallback: the frozen Season 1 site, served at its own origin");
  h = await serve(path.join(F, "_site"));
  {
    /* the classic page boots on reads the recording does not hold, so only what the fallback build changed is checked */
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await mock.install(ctx, { persona: "anon", page: false, routes });
    const fp = await ctx.newPage();
    await fp.goto(h.origin + "/#/home", { waitUntil: "domcontentloaded" });
    await fp.waitForFunction(() => window.CG && CG.oauthBack && CG._checkBuild && document.querySelector("#masthead"), null, { timeout: 20000 });
    r = await fp.evaluate(() => {
      var note = document.querySelector(".fallback-note"), box = note && note.getBoundingClientRect(), a = note && note.querySelector("a");
      CG._checkBuild("aaaaaaaaaaaa"); CG._checkBuild("bbbbbbbbbbbb");   /* the main site's pulse moving to a new build id */
      return { build: CG.BUILD, back: CG.oauthBack(), origin: location.origin, robots: (document.querySelector('meta[name="robots"]') || {}).content,
        note: note && note.textContent, top: box && Math.round(box.top), h: box && Math.round(box.height), href: a && a.getAttribute("href"), ready: CG._updateReady || null,
        first: document.body.firstElementChild.className, second: document.body.children[1] === note };
    });
    A("the page carries no build id, so a new id on the pulse offers no update (it never chases the Season 2 root)", r.build === null && r.ready === null, r);
    A("a Discord sign-in returns to the fallback's own origin, and the page is noindex", r.back === r.origin && r.robots === "noindex", r);
    A("one line under the skip link says it is the Season 1 backup and links to chelgamingleague.com",
      r.first === "skip" && r.second && r.top === 0 && r.h > 20 && r.h < 60 && /Season 1 site, kept as a backup/.test(r.note) && r.href === "https://chelgamingleague.com", r);
    A("nothing the page asked this host for was missing (the crawl copied every file it uses)", h.misses.filter((u) => u !== "/favicon.ico" && !/^\/api\//.test(u)).length === 0, h.misses);
    await ctx.close();
  }
  h.srv.close();

  const unexpected = errors.filter((e) => !/^\/classic/.test(e));
  A("no console errors on the Season 2 pages", unexpected.length === 0, unexpected.slice(0, 6));
  A("the Season 2 pages asked Supabase for nothing beyond the recorded reads (s2_league, auth, the pulse, crests)", strays.length === 0, strays.slice(0, 6));
  await b.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? fails + " FAILED" : "ALL PASSED (" + n + ")");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
