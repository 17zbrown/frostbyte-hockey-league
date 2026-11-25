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
