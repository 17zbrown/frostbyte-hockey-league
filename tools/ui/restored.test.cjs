const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* The live features the concept had left out, brought back: node tools/ui/run.cjs restored (needs the s2-concept
   server on S2_BASE (tools/ui/run.cjs)). Commissioner, 2026-11-23, on the cutover list ("go ahead on all of these"): lobby
   codes and servers at T-30 with server picks and vetoes, Team HQ management (seats, GM and AGM nominations), news, the
   award ballot, Terms and Privacy, pickup import; forums and staff tasks stay retired. Each is pinned here as the live
   site has it (Rules 2.6, 4.2 and 9.2) and as a page of this site: real data where the record holds it, the sample mark
   where it does not, phones, dark mode, reduced motion. Reads only; every change is the demo's own in-page state.
   v5.00 swap (i3f, 2026-11-25): on the real site (the harness's live mode, tools/ui/mock): each page is signed in as the
   persona that holds its role, and News reads the suite's own two placeholder stories (s2_league's lazy news section,
   which the recording lacks). Deleted with demo mode, each with where the real behavior is pinned now: the generated
   recaps, one per game night (News reads the news table since e06a523; today.test.cjs pins live News) and a story the
   demo published (now a story from the news table, below); the award ballot (awards.test.cjs, i3b: the four awards, the
   voter's own pool, the vote kept and read back, a guest's way to join); the lobby's sample codes, its local server
   settling, the demo game night and Team HQ's sample server picks (the codes, the picks and the settled server are the
   database's: lineups.test.cjs pins the live lobby and picks); the Front office's sample phase switch and seat removal
   (hq-market.test.cjs pins the live office tab: the seat doors before and after the draft, the open GM seat's nominee
   pool and search, moved there from here); the pickup import's sample club search (the live importer is g5's,
   pickups.test.cjs). The lobby's server list, its refusal of a server off the list and the night's one release time stay
   here, on Season 1's nights. */
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const { chromium } = require(PW);
const mock = require(process.env.S2_MOCK);
/* the role a page is opened as, signed in as the harness persona that holds it */
const PERSONA = { guest: "anon", player: "member", office: "gm", staff: "staff", commish: "commissioner" };
/* the news table's rows as s2_league's news section returns them: two placeholder stories, newest first */
const NEWS = [{ id: "00000000-0000-4000-8000-0000000000a2", title: "A placeholder story", body: "First paragraph.\n\nSecond paragraph.", category: "League news", published_at: new Date(Date.now() - 3600e3).toISOString() },
  { id: "00000000-0000-4000-8000-0000000000a1", title: "An earlier placeholder story", body: "One paragraph.", category: "League news", published_at: new Date(Date.now() - 86400e3).toISOString() }];
const league = (a) => ((a.p_sections || []).indexOf("news") >= 0 ? mock.ok({ season: 2, sections: a.p_sections, news: NEWS }) : mock.ok(mock.league(a)));
const BASE = S2_BASE;
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const errors = [];
  async function page(hash, o) {
    o = o || {};
    const ctx = await b.newContext(Object.assign(o.w ? { viewport: { width: o.w, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } },
      o.dark ? { colorScheme: "dark" } : {}, o.reduce ? { reducedMotion: "reduce" } : {}));
    await mock.install(ctx, { live: true, persona: PERSONA[o.role || "guest"], rpcs: { s2_league: league } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(BASE + (o.query || "") + hash);
    await p.waitForFunction(() => window.S2 && S2.M && document.querySelector("#app section, #app header"));
    await wait(450);
    return p;
  }
  const done = (p) => p.context().close();
  const go = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await wait(450); };
  const sheetGone = async (p) => { await p.waitForFunction(() => !document.querySelector(".sheet")); await wait(80); };
  const noDash = (t) => !/—|–| - /.test(t);
  let p, r;

  console.log("## Terms and Privacy");
  p = await page("#/today");
  r = await p.evaluate(() => [...document.querySelectorAll(".foot-small a")].map((a) => [a.textContent, a.getAttribute("href")]));
  A("the footer links Terms and Privacy on every page", JSON.stringify(r).indexOf('["Terms","#/terms"]') >= 0 && JSON.stringify(r).indexOf('["Privacy","#/privacy"]') >= 0, r);
  await p.click('.foot-small a[href="#/terms"]'); await wait(450);
  r = await p.evaluate(() => ({ h1: document.querySelector("#page h1").textContent, t: document.getElementById("page").textContent, rb: !!document.querySelector('#page a[href="#/rulebook"]'), next: !!document.querySelector('#page a[href="#/privacy"]') }));
  A("Terms of play: the live text, the rulebook linked, Privacy next", r.h1 === "Terms of play" && /free, community-run competitive EA Sports NHL league/.test(r.t) && /not affiliated with EA Sports, the NHL, Discord, or Twitch/.test(r.t) && r.rb && r.next, r.h1);
  A("no em dashes, en dashes or spaced hyphens in its copy", noDash(r.t));
  await go(p, "#/privacy");
  r = await p.evaluate(() => ({ h2: [...document.querySelectorAll("#page h2")].map((x) => x.textContent), t: document.getElementById("page").textContent }));
  A("Privacy: what we store, where it lives, deleting your data", JSON.stringify(r.h2) === '["What we store","Where it lives","Deleting your data"]' && /Last updated July 16, 2026/.test(r.t) && noDash(r.t), r.h2);
  await done(p);

  console.log("## News");
  p = await page("#/today");
  r = await p.evaluate(() => [...document.querySelectorAll("#navbar a, #siteMenu a")].some((a) => a.getAttribute("href") === "#/news") || S2.NAV.some((g) => (g.cols || []).some((c) => Array.isArray(c.links) && c.links.some((l) => l.href === "#/news"))));
  A("News is in the League menu", r);
  await go(p, "#/news");
  await p.waitForFunction(() => !!document.querySelector(".of-lead-a"), null, { timeout: 5000 }).catch(() => {});
  r = await p.evaluate(() => ({ lead: (document.querySelector(".of-lead-a") || {}).textContent || "", rows: [...document.querySelectorAll(".of-n-row")].map((a) => a.getAttribute("href")),
    sample: document.querySelectorAll("#page .chip.sample").length, here: document.querySelector('#navbar [aria-current]') && document.querySelector('#navbar [aria-current]').textContent }));
  A("the news table's stories, newest first: the newer leads, the older is listed under it, none sample", /A placeholder story/.test(r.lead) && JSON.stringify(r.rows) === JSON.stringify(["#/news/n-" + NEWS[1].id]) && r.sample === 0, r);
  A("the League menu lights up on News", /League/i.test(r.here || ""), r.here);
  await p.click(".of-lead-a"); await wait(450);
  r = await p.evaluate(() => ({ crumbs: [...document.querySelectorAll(".crumbs a")].map((a) => a.getAttribute("href")), h1: document.querySelector("#page h1").textContent, paras: document.querySelectorAll(".of-art-b .of-p").length }));
  A("a story: back to News, its own headline, and its body as two paragraphs", r.crumbs[0] === "#/news" && r.h1 === "A placeholder story" && r.paras === 2, r);
  await go(p, "#/news/nothing");
  A("an unknown story says so and links back", await p.evaluate(() => /Story not found/.test(document.querySelector("#page h1").textContent) && !!document.querySelector('#page a[href="#/news"]')));
  await done(p);

  console.log("## lobby servers and the night's release (Rule 4.2), on Season 1's nights");
  p = await page("#/today", { role: "player", query: "?season=1" });
  r = await p.evaluate(() => {
    const L = S2.lobby, g = S2.M.games[0], out = { list: L.SERVERS.join(","), std: L.STANDARD };
    out.rel = (() => { const n = S2.M.games.filter((x) => x.night === g.night).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); return n.length > 1 && n.map((x) => L.releaseAt(x)).every((t) => t === Date.parse(n[0].at) - 30 * 60000); })();
    try { L.setPick(g, "home", "first", "NA East"); out.offList = false; } catch (e) { out.offList = true; }
    return out;
  });
  A("the four servers, NA Central the standard", r.list === "NA Northeast,NA Southeast,NA Central,NA West" && r.std === "NA Central", r);
  A("a server off the list is refused loudly", r.offList);
  A("one release for the whole night: 30 minutes before its first puck drop", r.rel);
  await done(p);

  console.log("## pickup import");
  p = await page("#/pickup-import");
  A("a guest is asked to join: importing is tied to an account", await p.evaluate(() => !document.querySelector("#ofPuQ") && /Join to import a game/.test(document.getElementById("page").textContent)));
  await done(p);
  p = await page("#/pickup-import", { role: "player" });
  A("the page says pickup lines never touch the league record", await p.evaluate(() => /never count toward eligibility, standings, ratings or awards/.test(document.getElementById("page").textContent)));
  r = await p.evaluate(() => S2.NAV.filter((g) => g.id === "season")[0].cols[1].links.some((l) => l.href === "#/pickup-import"));
  A("Season's Take part offers Import a pickup game to members", r);
  await done(p);

  console.log("## retired: forums and staff tasks");
  p = await page("#/forums", { role: "staff" });
  r = await p.evaluate(() => ({ hash: location.hash, body: document.getElementById("app").textContent }));
  A("an old forum link lands on Today, and nothing offers forums or staff tasks", r.hash === "#/today" && !/\bforums?\b|staff tasks?/i.test(r.body), r.hash);
  await done(p);

  console.log("## phones, dark mode, reduced motion");
  for (const [role, hash] of [["guest", "#/news"], ["guest", "#/terms"], ["player", "#/pickup-import"], ["player", "#/stats?tab=awards"], ["office", "#/hq?tab=nights"], ["office", "#/hq?tab=office"]]) {
    for (const w of [320, 375]) {
      p = await page(hash, { role, w, dark: w === 375 });
      A(hash + " at " + w + (w === 375 ? " in dark mode" : "") + ": no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await done(p);
    }
  }
  p = await page("#/news", { dark: true });
  r = await p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.querySelector(".of-lead-t")).color }));
  A("dark mode: light headlines on the dark page", r.bg !== "rgb(255, 255, 255)" && /rgb\((2[0-9]{2}), (2[0-9]{2}), (2[0-9]{2})\)/.test(r.ink), r);
  await done(p);
  p = await page("#/news", { reduce: true });
  const row1 = await p.$(".of-n-row"); await row1.scrollIntoViewIfNeeded(); await wait(200); const box = await row1.boundingBox();
  await p.mouse.move(box.x + 20, box.y + 20); await p.mouse.down(); await wait(200);
  /* QA round 2 (2026-11-25): these two read the scale property now, where every press is (they read transform, which a
     press no longer sets, so the Reduce Motion one would pass whatever happened) */
  r = await p.evaluate(() => { const a = document.querySelector(".of-n-row:active"); if (!a) return "not pressed"; const c = getComputedStyle(a); return { scale: c.scale, transform: c.transform, opacity: +c.opacity }; });
  await p.mouse.up();
  A("reduced motion: a pressed story row does not scale (it dims)", r.scale === "none" && r.transform === "none" && r.opacity < 1, r);
  await done(p);
  p = await page("#/news");
  const row2 = await p.$(".of-n-row"); await row2.scrollIntoViewIfNeeded(); await wait(200); const box2 = await row2.boundingBox();
  await p.mouse.move(box2.x + 20, box2.y + 20); await p.mouse.down(); await wait(220);
  r = await p.evaluate(() => { const a = document.querySelector(".of-n-row:active"); return a ? getComputedStyle(a).scale : "not pressed"; });
  await p.mouse.up();
  A("a story row answers the press on pointer-down (the scale property, .985)", r === "0.985", r);
  await done(p);

  A("no console errors", errors.length === 0, errors.slice(0, 5));
  await b.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
