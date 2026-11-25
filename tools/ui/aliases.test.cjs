const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* Old live addresses land on their page: node tools/ui/run.cjs aliases (needs the s2-concept server on
   S2_BASE (tools/ui/run.cjs)). Commissioner, 2026-11-23, on the cutover list's "permanent aliases for old links": "go ahead and
   fix". Discord posts, twelve database functions, the LFG bot and about 18,500 notification rows point at the live
   site's addresses; S2.ALIASES (js/core.js) is the one table that sends each to its page here, and S2.notifRoute turns a
   notification's link_view and link_param into an address the way the live CG.notifRoute does. This walks every entry.
   Reads only.
   v5.00 swap (i3f, 2026-11-25): on the real site (the harness's live mode, tools/ui/mock): the role is the signed-in
   persona's (mock.install), never a stored "s2.role", and a game link opens Season 1, which has finals (Season 2 has none
   yet). Every Supabase request is answered by the mock. */
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const { chromium } = require(PW);
const mock = require(process.env.S2_MOCK);
/* the role a link is opened as, signed in as the harness persona that holds it */
const PERSONA = { guest: "anon", player: "member", office: "gm", staff: "staff", commish: "commissioner" };
/* the league read, and its lazy news section (the recording lacks it) answered with no story: #/news is one of the links */
const league = (a) => ((a.p_sections || []).indexOf("news") >= 0 ? mock.ok({ season: 2, sections: a.p_sections, news: [] }) : mock.ok(mock.league(a)));
/* the server invite the league read carries (site_config.discord_invite): a "discord" notification opens it (f, v5.00) */
const INVITE = (mock.league({}).config.site || {}).discord_invite;
const BASE = S2_BASE;
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* the twelve database functions' hard-coded routes (read from pg_proc 2026-11-23) and where each must land */
const DB_LINKS = [["#/hub/staffdesk", "#/desk"], ["#/schedule", "#/games"], ["#/hub/complaint?id=6a1d0d6e-0000-4000-8000-000000000001", "#/desk?tab=cases", "staff"],
  ["#/hub/complaint?id=6a1d0d6e-0000-4000-8000-000000000001", "#/you?tab=inbox&show=cases", "player"], ["#/hub/availability", "#/you?tab=week"], ["#/hub/tradehub", "#/hq?tab=trades"],
  ["#/news", "#/news"], ["#/hub/actions", "#/you?tab=inbox&show=cases"], ["#/pickup-import", "#/pickup-import"],
  /* v5.00 swap (i2): the department desks bot/staff-alerts.mjs links (they fell through to You) */
  ["#/hub/reviewboard", "#/desk?tab=applications", "staff"], ["#/hub/opsdesk", "#/desk?tab=games", "staff"], ["#/hub/draftroom", "#/draft", "staff"],
  ["#/hub/transdesk", "#/desk?tab=transactions", "staff"], ["#/hub/community", "#/desk?tab=cases", "staff"],
  /* the Newsroom stayed (2026-10-22): its old desk link opens the Staff Desk pane for staff, the news page for anyone else */
  ["#/hub/newsroom", "#/desk?tab=newsroom", "staff"], ["#/hub/newsroom", "#/news", "player"]];

(async () => {
  const b = await chromium.launch();
  const errors = [];
  async function page(hash, role, query, tables) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await mock.install(ctx, Object.assign({ live: true, persona: PERSONA[role || "player"], rpcs: { s2_league: league } }, tables ? { tables } : {}));
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    /* the browser's own line for any non-2xx answer is not the page's error (the staffing flip's tables answer 404 before it lands) */
    p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(BASE + (query || "") + hash);
    await p.waitForFunction(() => window.S2 && S2.M && document.querySelector("#app section, #app header"));
    await wait(350);
    return p;
  }
  const done = (p) => p.context().close();
  let p, r;

  console.log("## the database functions' links, opened cold");
  for (const [from, to, role] of DB_LINKS) {
    p = await page(from, role || "player");
    r = await p.evaluate(() => ({ hash: location.hash, name: S2.parse().name, page: !!S2.pages[S2.parse().name], err: /could not be drawn/.test(document.body.textContent) }));
    A(from + (role ? " (" + role + ")" : "") + " lands on " + to, r.hash === to && r.page && !r.err, r);
    await done(p);
  }
  p = await page("#/matchup/" + "x", "player", "?season=1");
  const gid = await p.evaluate(() => S2.M.games.filter((g) => g.isFinal)[0].id);
  await done(p);
  p = await page("#/matchup/" + gid, "player", "?season=1");
  r = await p.evaluate(() => ({ hash: location.hash, h1: document.querySelector("#page h1").textContent }));
  A("#/matchup/<id> opens that game's Game Center", r.hash === "#/game/" + gid && !/not found/i.test(r.h1), r);
  await done(p);
  /* QA function 3 (2026-11-25): the model holds the season on screen only, so from the current season's view a Season 1
     game's link (a saved link, a notification's link_view game, #/matchup) said "Game not found ... rescheduled". The page
     asks which season holds the game (games.season_id) and opens it there; an id no season holds is not found, plainly */
  const S1 = mock.league({ p_season: 1 }), S1ID = S1.seasons.filter((s) => s.number === 1)[0].id, GAMES = S1.games.map((g) => ({ id: g.id, season_id: S1ID }));
  for (const hash of ["#/matchup/" + gid, "#/game/" + gid]) {
    p = await page(hash, "player", "", { games: GAMES });
    await p.waitForFunction(() => /season=1/.test(location.search) && document.querySelector("#page .td-room, #page h1"), null, { timeout: 15000 }).catch(() => {});
    await wait(400);
    r = await p.evaluate(() => ({ search: location.search, hash: location.hash, h1: (document.querySelector("#page h1") || {}).textContent }));
    A(hash.replace(gid, "<Season 1 id>") + " from the current season opens that game in Season 1", r.search === "?season=1" && r.hash === "#/game/" + gid && !/not found|Opening/i.test(r.h1), r);
    await done(p);
  }
  p = await page("#/game/00000000-0000-4000-8000-000000000999", "player", "", { games: GAMES });
  await wait(600);
  r = await p.evaluate(() => ({ search: location.search, h1: document.querySelector("#page h1").textContent, lede: document.querySelector("#page .lede-l").textContent }));
  A("an id no season holds is not found, with no word of a reschedule", r.search === "" && r.h1 === "Game not found" && r.lede === "No game has this address.", r);

  console.log("## every alias in the table");
  r = await p.evaluate(() => {
    const out = [], keys = Object.keys(S2.ALIASES);
    keys.forEach((k) => {
      const parts = k.split("/"), old = "#/" + k + (typeof S2.ALIASES[k] === "function" && parts.length === 1 ? "/BOS" : "");
      const to = S2.alias(old), name = to && to.replace(/^#\//, "").split(/[?\/]/)[0];
      out.push({ k, old, to, ok: !!to && !!S2.pages[name] && name !== parts[0] });
    });
    return { n: keys.length, bad: out.filter((x) => !x.ok), sample: out.slice(0, 3) };
  });
  A("all " + r.n + " aliases resolve to a page the concept has, never to themselves", r.n >= 50 && r.bad.length === 0, r.bad);
  r = await p.evaluate(() => ({ team: S2.alias("#/team/det"), teams: S2.alias("#/teams"), lineup: S2.alias("#/hub/lineup?game=abc"), mgmt: S2.alias("#/hub/management"), unknownHub: S2.alias("#/hub/somethingnew"),
    unknownAdmin: S2.alias("#/admin/newtab"), brand: S2.alias("#/brand"), page: S2.alias("#/standings?view=race"), news: S2.alias("#/article/7"), forum: S2.alias("#/thread?id=1"), legal: S2.alias("#/legal"), nothing: S2.alias("#/nopage"),
    pickup: S2.alias("#/pickup/6a1d0d6e-0000-4000-8000-000000000001"), pickups: S2.alias("#/pickup") }));
  A("a club link keeps its club, in the concept's upper case", r.team === "#/club/DET" && r.teams === "#/clubs", r);
  /* g5's hand-over (owners.json), i3f: the classic #/pickup/<id> (a pickup game's box score, linked from profiles and the LFG
     bot's posts) opens that game on the pickups page; a bare #/pickup opens the list */
  A("an old pickup game link opens that game on the pickups page, a bare one the list", r.pickup === "#/pickups/6a1d0d6e-0000-4000-8000-000000000001" && r.pickups === "#/pickups", r);
  A("a sheet link opens Lineups, and Management opens the Front office tab", r.lineup === "#/hq?tab=lineups" && r.mgmt === "#/hq?tab=office", r);
  A("an unknown hub page opens You, an unknown admin page the Control Center", r.unknownHub === "#/you" && r.unknownAdmin === "#/control", r);
  A("the old brand page opens Today, never the concept page (v5.00 swap)", r.brand === "#/today", r);
  A("a page the concept already has is left alone", r.page === null && r.nothing === null, r);
  A("an article opens its story, the retired forums land on Today, the legal page on Terms", r.news === "#/news/7" && r.forum === "#/today" && r.legal === "#/terms", r);
  await done(p);

  console.log("## notifications: link_view and link_param, as the live CG.notifRoute reads them");
  p = await page("#/today", "player");
  r = await p.evaluate(() => S2.NOTIF_VIEWS.map((v) => {
    const h = S2.notifRoute(v, v === "team" ? "BOS" : v === "actions" || v === "admin" ? "6a1d0d6e-0000-4000-8000-000000000001" : v === "application" ? "id=1&type=owner" : "");
    const name = h.replace(/^#\//, "").split(/[?\/]/)[0];
    return { v, h, ok: !!S2.pages[name] || (v === "discord" && /^https:\/\//.test(h)) };
  }));
  A("every link_view the live site writes (" + r.length + ", teams included) opens a page here, or the server invite for discord", r.length === 26 && r.some((x) => x.v === "teams") && r.every((x) => x.ok), r.filter((x) => !x.ok));
  /* i3f: the league read carries the server invite, so discord opens it (You only when site_config has none) */
  const want = { team: "#/club/BOS", game: "#/games", availability: "#/you?tab=week", lineups: "#/hq?tab=lineups", mgmtapprovals: "#/hq?tab=office", stafftasks: "#/desk", actions: "#/you?tab=inbox&show=cases",
    rulebook: "#/rulebook", draft: "#/draft", forum: "#/today", ownerapp: "#/season", transactions: "#/today", discord: /^https:\/\//.test(INVITE || "") ? INVITE : "#/you", teams: "#/control?tab=clubs" };
  A("each lands where the live one would", Object.keys(want).every((k) => (r.filter((x) => x.v === k)[0] || {}).h === want[k]), r.filter((x) => want[x.v] && want[x.v] !== x.h));
  await done(p);

  console.log("## a broken percent escape never stops the router (review 2026-11-23)");
  p = await page("#/hub/complaint?id=%E0%A4%A", "player");
  r = await p.evaluate(() => { let threw = false, q = null; try { q = S2.parse().q; } catch (e) { threw = true; } return { hash: location.hash, threw, q, err: /could not be drawn/.test(document.body.textContent), page: !!S2.pages[S2.parse().name] }; });
  A("an old link with a malformed escape resolves, and S2.parse keeps the value as typed instead of throwing", !r.threw && r.page && !r.err && r.hash.indexOf("#/hub/") !== 0, r);
  await done(p);

  console.log("## history: an alias replaces the old address, so Back never returns to it");
  p = await page("#/today", "player");
  await p.evaluate(() => { location.hash = "#/hub/tradehub"; }); await wait(400);
  r = await p.evaluate(() => ({ hash: location.hash, len: history.length }));
  await p.goBack(); await wait(400);
  A("the old address became #/hq?tab=trades in place, and Back goes to Today", r.hash === "#/hq?tab=trades" && await p.evaluate(() => location.hash) === "#/today", r);
  await done(p);

  A("no console errors", errors.length === 0, errors.slice(0, 5));
  await b.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
