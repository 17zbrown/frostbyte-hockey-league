const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* New site versions reach open tabs, proved in headless Chromium: node tools/ui/run.cjs autoupdate
   Rewritten 2026-11-24 (v5.00 swap, stream f) for the real site's update path, which replaced the concept's own
   (js/share.js, build.json and the "concept-build" broadcast, retired with the demo). The site build stamps a content id
   into the page (meta cg-build); the database reads /version.json every 10 minutes into live_pulse.site_build, and every
   tab hears it on the league pulse, so no tab ever polls Netlify (memories live-pulse-v405 and netlify-usage-efficiency:
   "never make every open tab reload the page at the same moment"). js/live.js S2.updates is the port of the current site's
   CG._checkBuild and CG._applyUpdate. The page is opened at https://chelgamingleague.com/demo.html, and Playwright answers
   every request to that host from this checkout's local server (the real host is never contacted; a plain http mapping
   does not work, because the domain is on the HSTS preload list), with the build id written into the page as it is
   served, against an in-page stand-in for supabase-js: nothing here reaches Supabase, Netlify or Discord.
   v5.00 swap (i3f, 2026-11-25): fixture mode is retired, so the league is the recorded s2_league read (tools/ui/mock,
   signed out), answered with no site build in its pulse: the database had no build id yet, so the first pulse a page
   hears is its baseline, as the checks below expect (the read's own baseline is pinned at the end of the run). */
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const { chromium } = require(PW);
const mock = require(process.env.S2_MOCK);
/* the recorded league read, its pulse naming no build */
const noBuild = (a) => { const b = mock.league(a); if (b.pulse) b.pulse = Object.assign({}, b.pulse, { site_build: null }); return mock.ok(b); };
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more === undefined ? "" : "  (" + JSON.stringify(more).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCAL = S2_BASE, LOCAL_ORIGIN = new URL(S2_BASE).origin, LIVE = "https://chelgamingleague.com/demo.html";
const B1 = "aaaaaaaaaaa1", B2 = "bbbbbbbbbbb2", B3 = "ccccccccccc3";

/* the stand-in: no session, one league-live channel the test can push pulse rows into, Date.now that the test can move */
function stand() {
  window.S2_MODE = "live";
  try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); } catch (e) {}
  var real = Date.now; window.__skew = 0; Date.now = function () { return real() + window.__skew; };
  window.__vis = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: function () { return window.__vis; } });
  var F = window.__sb = { channels: [] };
  function q() { var b = { select: function () { return b; }, eq: function () { return b; }, order: function () { return b; }, limit: function () { return b; }, maybeSingle: function () { return b; },
    then: function (res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej); } }; return b; }
  window.supabase = { createClient: function () { return {
    auth: { getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); }, onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; } },
    from: q, rpc: function () { return Promise.resolve({ data: null, error: null }); },
    channel: function (name) { var ch = { name: name, subs: [], on: function (t, f, cb) { ch.subs.push(cb); return ch; }, subscribe: function (cb) { if (cb) setTimeout(function () { cb("SUBSCRIBED"); }, 10); return ch; } };
      F.channels.push(ch); return ch; },
    removeChannel: function () {}
  }; } };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  /* one browser context = one visitor; s.build is the build the server hands out now (null: a page with no build id, as
     /next is built); every document load is counted */
  async function visitor(build) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const s = { ctx, build, loads: 0 };
    await mock.install(ctx, { live: true, persona: "anon", rpcs: { s2_league: noBuild } });
    await ctx.addInitScript(`(${stand.toString()})()`);
    /* main session, 2026-11-24: this suite reloads pages on purpose, and a request the page abandoned by reloading
       leaves its fetched response disposed, so answering it threw "Fetch response has been disposed" as an unhandled
       rejection that ended the suite after 14 of 20 checks (about one run in two under three parallel slots). A request
       the page itself abandoned has nobody to answer; any other failure still throws. */
    const abandoned = (e) => /has been disposed|Target page, context or browser has been closed|Request context disposed|Route is already handled/.test(String(e && e.message));
    await ctx.route((u) => u.hostname === "chelgamingleague.com" || u.pathname.endsWith("/demo.html"), async (route) => {
      try {
        const u = new URL(route.request().url()), res = await route.fetch({ url: LOCAL_ORIGIN + u.pathname + u.search });
        if (!u.pathname.endsWith("/demo.html")) return await route.fulfill({ response: res });
        let body = await res.text();
        if (s.build) body = body.replace("<head>", '<head>\n<meta name="cg-build" content="' + s.build + '">');
        s.loads++;
        await route.fulfill({ response: res, body, headers: Object.assign({}, res.headers(), { "content-type": "text/html; charset=utf-8" }) });
      } catch (e) {
        if (!abandoned(e)) throw e;
      }
    });
    return s;
  }
  async function open(s, url, hash) {
    const p = await s.ctx.newPage();
    p.on("pageerror", (e) => errors.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await p.goto(url + (hash || "#/today"));
    try { await booted(p); } catch (e) { throw new Error("the page at " + url + " never booted: " + JSON.stringify(errors.slice(-4))); }
    return p;
  }
  const booted = (p) => p.waitForFunction(() => window.S2 && S2.updates && S2.$("#page") && S2.$("#page").children.length > 0 && __sb.channels.some((c) => c.name === "league-live"));
  const pulse = (p, site) => p.evaluate((b) => __sb.channels.filter((c) => c.name === "league-live")[0].subs.forEach((f) => f({ new: { d: {}, site_build: b } })), site);
  const nextLoad = (p, ms) => p.waitForEvent("load", { timeout: ms || 8000 }).then(() => true, () => false);
  let s, p, r;

  console.log("## the build the league had at load is only a baseline");
  s = await visitor(B2); p = await open(s, LIVE);
  r = await p.evaluate(() => ({ mine: S2.updates.build(), host: S2.updates.liveHost() }));
  A("the page reads its own build id and knows it is on the league's host", r.mine === "bbbbbbbbbbb2" && r.host, r);
  await pulse(p, B1); await wait(200);
  A("the database still naming the OLD build (it reads version.json every 10 minutes) changes nothing", await p.evaluate(() => S2.updates.ready === null && S2.updates.seen === "aaaaaaaaaaa1"));
  await pulse(p, B2); await wait(200);
  A("when it catches up to this page's own build, still nothing", await p.evaluate(() => S2.updates.ready === null) && s.loads === 1);
  await p.evaluate(() => { location.hash = "#/standings"; }); await wait(400);
  A("and a click after that is just a click", s.loads === 1);
  await s.ctx.close();

  console.log("## a new version waits for the next click, then lands where the reader was");
  s = await visitor(B1); p = await open(s, LIVE, "#/standings");
  await pulse(p, B1); s.build = B2; await pulse(p, B2); await wait(200);
  r = await p.evaluate(() => ({ ready: S2.updates.ready, toast: S2.$$(".toast").length }));
  A("a CHANGE after load marks the new build ready, and nothing reloads by itself", r.ready === "bbbbbbbbbbb2" && s.loads === 1, r);
  await p.evaluate(() => window.scrollTo(0, 400));
  const loaded = nextLoad(p);
  await p.evaluate(() => { location.hash = "#/clubs"; });
  A("the next click takes the new version", await loaded && s.loads === 2);
  await booted(p); await wait(300);
  r = await p.evaluate(() => ({ hash: location.hash, mine: S2.updates.build(), st: sessionStorage.getItem("s2_update"), sc: sessionStorage.getItem("s2_scroll") }));
  A("the new page runs the new build on the page clicked to, and the try is cleared", r.hash === "#/clubs" && r.mine === "bbbbbbbbbbb2" && r.st === null && r.sc === null, r);
  await s.ctx.close();

  console.log("## never while something is open, half typed, held, or during a draft");
  s = await visitor(B1); p = await open(s, LIVE);
  await pulse(p, B1); await pulse(p, B2); await wait(200);
  r = await p.evaluate(() => {
    const out = {};
    const sh = S2.sheet({ title: "Open", html: "<p>x</p>" }); out.sheet = S2.updates.apply("nav"); sh.close();
    S2.holds.push(() => window.__hold); window.__hold = true; out.held = S2.updates.apply("nav"); window.__hold = false;
    S2.M.draft = { state: { status: "paused" } }; out.draft = S2.updates.apply("nav"); S2.M.draft = null;
    const i = document.createElement("input"); S2.$("#page").appendChild(i); i.value = "half typed"; out.idleTyping = S2.updates.apply("idle"); out.returnTyping = S2.updates.apply("return"); i.remove();
    return out;
  });
  await wait(300);
  A("an open sheet, a page's held work and a paused draft all hold the reload, even on a click", r.sheet === false && r.held === false && r.draft === false && s.loads === 1, r);
  A("half-typed text holds the idle and return reloads", r.idleTyping === false && r.returnTyping === false && s.loads === 1, r);
  await s.ctx.close();

  console.log("## an idle tab offers it, and the offer always works");
  s = await visitor(B1); p = await open(s, LIVE);
  await pulse(p, B1); s.build = B3; await pulse(p, B3);
  await wait(31000);
  r = await p.evaluate(() => S2.$$(".toast").map((t) => t.textContent).join(" | "));
  A("half a minute later the reader is offered the new version, and nothing reloaded yet", /The site was updated/.test(r) && /Refresh/.test(r) && s.loads === 1, r);
  await p.evaluate(() => { const i = document.createElement("input"); S2.$("#page").appendChild(i); i.value = "typed"; i.focus(); });
  const l2 = nextLoad(p);
  await p.click(".toast .toast-act");
  A("pressing Refresh reloads even mid-form: the reader chose it", await l2 && s.loads === 2);
  await booted(p);
  A("and the new page is the new build", await p.evaluate(() => S2.updates.build() === "ccccccccccc3"));
  await s.ctx.close();

  console.log("## coming back after half an hour away");
  s = await visitor(B1); p = await open(s, LIVE);
  await pulse(p, B1); s.build = B2; await pulse(p, B2);
  await p.evaluate(() => { window.__vis = "hidden"; document.dispatchEvent(new Event("visibilitychange")); window.__skew += 10 * 60000; });
  await p.evaluate(() => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); }); await wait(400);
  A("back after ten minutes: nothing reloads", s.loads === 1);
  await p.evaluate(() => { window.__vis = "hidden"; document.dispatchEvent(new Event("visibilitychange")); window.__skew += 31 * 60000; });
  const l3 = nextLoad(p);
  await p.evaluate(() => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  A("back after thirty-one minutes away: the new version loads as it is looked at", await l3 && s.loads === 2);
  await s.ctx.close();

  console.log("## the loop breaker, a copy off the league's host, and a page with no build id");
  s = await visitor(B1); p = await open(s, LIVE);
  await p.evaluate(() => sessionStorage.setItem("s2_update", JSON.stringify({ target: "bbbbbbbbbbb2", tries: 2, at: Date.now() })));
  await pulse(p, B1); await pulse(p, B2); await wait(200);
  A("two tries at the same build in ten minutes: the edge has not caught up, so no third", await p.evaluate(() => S2.updates.ready === null));
  await s.ctx.close();
  s = await visitor(B1); p = await open(s, LOCAL);
  await pulse(p, B1); await pulse(p, B2); await wait(200);
  A("a local or preview copy never reloads itself", await p.evaluate(() => !S2.updates.liveHost() && S2.updates.ready === null));
  await s.ctx.close();
  s = await visitor(null); p = await open(s, LIVE);
  await pulse(p, B1); await pulse(p, B2); await wait(200);
  A("a page built with no id (the /next rehearsal) never reloads", await p.evaluate(() => S2.updates.build() === null && S2.updates.ready === null));
  await s.ctx.close();
  s = await visitor(B1); p = await open(s, LIVE);
  r = await p.evaluate(() => { S2.pulse.baseline({ d: {}, site_build: "aaaaaaaaaaa1" }); return S2.updates.seen; });
  await pulse(p, B2); await wait(200);
  A("the pulse that came with the league read is the baseline, so the very next change counts", r === "aaaaaaaaaaa1" && await p.evaluate(() => S2.updates.ready === "bbbbbbbbbbb2"), r);
  await s.ctx.close();

  console.log("## nothing here asks Netlify");
  s = await visitor(B1); const hosts = new Set();
  s.ctx.on("request", (q) => { const u = new URL(q.url()); if (q.resourceType() !== "document") hosts.add(u.hostname + u.pathname.replace(/[^/]+$/, "")); });
  p = await open(s, LIVE); await pulse(p, B1); await pulse(p, B2); await wait(500);
  A("the page never fetches version.json or any build file", ![...hosts].some((h) => /version|build/.test(h)), [...hosts]);
  await s.ctx.close();

  A("no console errors", errors.length === 0, errors.slice(0, 6));
  await browser.close();
  console.log(n + " checks, " + (fails ? fails + " FAILED" : "ALL PASSED"));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
