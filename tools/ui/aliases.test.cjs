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
const live = require("./desklive.cjs");   /* the Staff Desk's league office (placeholder names), for the case and application links */
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
/* health links 0 (2026-11-25): this pinned the staffer's case link landing on the bare Cases tab, which dropped the case
   id, so the desk opened the first case in its list; rewritten to pin the case kept (#/desk?tab=cases&case=<id>) */
const DB_LINKS = [["#/hub/staffdesk", "#/desk"], ["#/schedule", "#/games"], ["#/hub/complaint?id=6a1d0d6e-0000-4000-8000-000000000001", "#/desk?tab=cases&case=6a1d0d6e-0000-4000-8000-000000000001", "staff"],
  ["#/hub/complaint?id=6a1d0d6e-0000-4000-8000-000000000001", "#/you?tab=inbox&show=cases", "player"], ["#/hub/availability", "#/you?tab=week"], ["#/hub/tradehub", "#/hq?tab=trades"],
  ["#/news", "#/news"], ["#/hub/actions", "#/you?tab=inbox&show=cases"], ["#/pickup-import", "#/pickup-import"],
  /* v5.00 swap (i2): the department desks bot/staff-alerts.mjs links (they fell through to You) */
  ["#/hub/reviewboard", "#/desk?tab=applications", "staff"], ["#/hub/opsdesk", "#/desk?tab=games", "staff"], ["#/hub/draftroom", "#/draft", "staff"],
  ["#/hub/transdesk", "#/desk?tab=transactions", "staff"], ["#/hub/community", "#/desk?tab=cases", "staff"],
  /* the Newsroom stayed (2026-10-22): its old desk link opens the Staff Desk pane for staff, the news page for anyone else */
  ["#/hub/newsroom", "#/desk?tab=newsroom", "staff"], ["#/hub/newsroom", "#/news", "player"],
  /* health links 1 and 3 (2026-11-25): an application link opens that application for staff; a club room's lineup notice
     opens Team HQ's Lineups for a front office and the player's own week for a player (Team HQ locked players out) */
  ["#/hub/application?id=6a1d0d6e-0000-4000-8000-000000000001&type=owner", "#/desk/application/owner-6a1d0d6e-0000-4000-8000-000000000001", "staff"],
  ["#/hub/application?id=6a1d0d6e-0000-4000-8000-000000000001&type=owner", "#/you?tab=applications", "player"],
  ["#/hub/lineups", "#/hq?tab=lineups", "office"], ["#/hub/lineups", "#/you?tab=week", "player"], ["#/hub/lineup?game=6a1d0d6e-0000-4000-8000-000000000001", "#/you?tab=week", "player"]];

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
  /* health links 3: this pinned a sheet link opening Team HQ's Lineups for everyone, a door that locks a player out (the
     page here is a player's); rewritten: a player reads their own week, and a front office's is checked below */
  A("a sheet link opens a player's own week, and Management opens the Front office tab", r.lineup === "#/you?tab=week" && r.mgmt === "#/hq?tab=office", r);
  A("an unknown hub page opens You, an unknown admin page the Control Center", r.unknownHub === "#/you" && r.unknownAdmin === "#/control", r);
  A("the old brand page opens Today, never the concept page (v5.00 swap)", r.brand === "#/today", r);
  A("a page the concept already has is left alone", r.page === null && r.nothing === null, r);
  /* health links 2: this pinned "#/news/7", an address no story has (a story's is n-<id>, js/pages/office.js); rewritten */
  A("an article opens its story (n-<id>), the retired forums land on Today, the legal page on Terms", r.news === "#/news/n-7" && r.forum === "#/today" && r.legal === "#/terms", r);
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
  /* health links 3 and 4: lineups pinned Team HQ for a player (locked to them) and transactions pinned Today (nothing about
     the trade); rewritten to a player's week and the league's trades */
  const want = { team: "#/club/BOS", game: "#/games", availability: "#/you?tab=week", lineups: "#/you?tab=week", mgmtapprovals: "#/hq?tab=office", stafftasks: "#/desk", actions: "#/you?tab=inbox&show=cases",
    rulebook: "#/rulebook", draft: "#/draft", forum: "#/today", ownerapp: "#/season", transactions: "#/clubs?view=moves&kind=trade", discord: /^https:\/\//.test(INVITE || "") ? INVITE : "#/you", teams: "#/control?tab=clubs" };
  A("each lands where the live one would", Object.keys(want).every((k) => (r.filter((x) => x.v === k)[0] || {}).h === want[k]), r.filter((x) => want[x.v] && want[x.v] !== x.h));
  /* health crawl 9 (2026-11-25): one uuid test, S2.isUuid in js/core.js, for every page that checks an id before it reads
     (the copies in core.js and js/trade.js are gone; today.js's is its page owner's to drop) */
  r = await p.evaluate(() => ({ fn: typeof S2.isUuid, yes: [S2.isUuid("6a1d0d6e-0000-4000-8000-000000000001"), S2.isUuid("6A1D0D6E-0000-4000-8000-00000000000A")],
    no: [S2.isUuid("abc"), S2.isUuid(""), S2.isUuid(null), S2.isUuid(undefined), S2.isUuid("6a1d0d6e-0000-4000-8000-00000000001"), S2.isUuid(" 6a1d0d6e-0000-4000-8000-000000000001"), S2.isUuid("6a1d0d6e-0000-4000-8000-000000000001/x")],
    trade: [S2.trade.isId("6a1d0d6e-0000-4000-8000-000000000001"), S2.trade.isId("x"), S2.trade.isId(null)], notif: [S2.notifRoute("actions", "abc"), S2.notifRoute("forum", "6a1d0d6e-0000-4000-8000-000000000001")] }));
  const UUID_RX = /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/g, src = (f) => require("fs").readFileSync(require("path").join(S2_ROOT, f), "utf8");
  A("S2.isUuid is the one uuid test: any case, and a short, padded, empty or missing id is not one", r.fn === "function" && r.yes.every(Boolean) && r.no.every((x) => x === false), r);
  A("the trade door and the notification switch use it: a non-id opens no case and no thread", r.trade.join() === "true,false,false" && r.notif[0] === "#/you?tab=inbox&show=cases" && r.notif[1] === "#/today", r);
  A("js/core.js holds the pattern once and js/trade.js not at all", (src("js/core.js").match(UUID_RX) || []).length === 1 && !(src("js/trade.js").match(UUID_RX) || []).length);
  await done(p);

  /* health links 0, 1, 3 and 4 (2026-11-25): the alias helper took no route, so a case link and an application link lost
     their ids; byHat passes the route through and keeps the role-guess hold (f.byRole, S2.route) */
  const U = "6a1d0d6e-0000-4000-8000-000000000001";
  p = await page("#/today", "staff");
  r = await p.evaluate((u) => ({ complaints: S2.notifRoute("complaints", u), actions: S2.notifRoute("actions", u), admin: S2.notifRoute("admin", u), bare: S2.alias("#/hub/complaints"), archive: S2.alias("#/hub/archive"),
    owner: S2.notifRoute("application", "id=" + u + "&type=owner"), mgmt: S2.notifRoute("application", "id=" + u + "&type=management"), staff: S2.notifRoute("staffdesk", "id=" + u + "&type=staff"),
    committee: S2.notifRoute("users", "id=" + u + "&type=committee"), odd: S2.notifRoute("application", "id=" + u + "&type=bogus"), noId: S2.alias("#/hub/application?type=owner"),
    trade: S2.notifRoute("transactions", ""), held: ["hub/complaint", "hub/complaints", "hub/application", "hub/lineups", "hub/lineup", "hub/lines", "hub/newsroom"].every((k) => typeof S2.ALIASES[k] === "function" && S2.ALIASES[k].byRole === true) }), U);
  A("staff: a case notification (complaints, actions, admin) opens that case on the desk; the id-less old pages open the Cases tab",
    [r.complaints, r.actions, r.admin].every((h) => h === "#/desk?tab=cases&case=" + U) && r.bare === "#/desk?tab=cases" && r.archive === "#/desk?tab=cases", r);
  A("staff: an application notification opens that application's desk page for each of the four types; an unknown type or no id stays on the board",
    r.owner === "#/desk/application/owner-" + U && r.mgmt === "#/desk/application/management-" + U && r.staff === "#/desk/application/staff-" + U && r.committee === "#/desk/application/committee-" + U &&
    r.odd === "#/desk?tab=applications" && r.noId === "#/desk?tab=applications", r);
  A("a trade notification opens the league's trades (public to every recipient)", r.trade === "#/clubs?view=moves&kind=trade", r.trade);
  A("every alias that depends on the reader is held until the role is known (the router's role-guess hold)", r.held, r.held);
  await done(p);
  p = await page("#/today", "office");
  r = await p.evaluate(() => ({ notif: S2.notifRoute("lineups", ""), lineup: S2.notifRoute("lineup", "6a1d0d6e-0000-4000-8000-000000000001"), lines: S2.alias("#/hub/lines"), mgr: S2.notifRoute("manager", "lineups"), roster: S2.alias("#/hub/roster") }));
  A("a front office: lineup notices and the old sheet links open Team HQ's Lineups", r.notif === "#/hq?tab=lineups" && r.lineup === "#/hq?tab=lineups" && r.lines === "#/hq?tab=lineups" && r.mgr === "#/hq?tab=lineups" && r.roster === "#/hq?tab=roster", r);
  await done(p);
  p = await page("#/today", "guest");
  r = await p.evaluate(() => ({ cases: S2.alias("#/hub/complaint?id=6a1d0d6e-0000-4000-8000-000000000001"), app: S2.alias("#/hub/application?id=6a1d0d6e-0000-4000-8000-000000000001&type=owner"), lineups: S2.alias("#/hub/lineups") }));
  A("a guest: a case opens the inbox's cases, an application You's applications, a lineup notice their week (each with the Join door)",
    r.cases === "#/you?tab=inbox&show=cases" && r.app === "#/you?tab=applications" && r.lineups === "#/you?tab=week", r);
  await done(p);

  console.log("## health: a case link and an application link open that case and that application on the Staff Desk");
  /* the desk's league office (tools/ui/desklive.cjs, placeholder names): c-pos-1 is not the first case in its list */
  const L = await live.open(b, BASE, { persona: "staff", hash: "#/hub/complaint?id=c-pos-1" });
  const deskAt = () => L.p.evaluate(() => ({ hash: location.hash, sel: S2.$$('#dkCaseRows [aria-selected="true"]').map((x) => x.getAttribute("data-case")),
    detail: (S2.$("#dkCaseDetail [data-lv-case]") || { getAttribute: () => null }).getAttribute("data-lv-case"), first: (S2.$("#dkCaseRows [data-case]") || { getAttribute: () => null }).getAttribute("data-case"),
    text: (S2.$("#dkCaseDetail") || {}).textContent || "", h1: (S2.$("#page h1") || {}).textContent || "", page: (S2.$("#page") || {}).textContent || "" }));
  r = await deskAt();
  A("a staffer's case link opens that case, not the first in the list", r.hash === "#/desk?tab=cases&case=c-pos-1" && r.first !== "c-pos-1" && r.sel.join() === "c-pos-1" && r.detail === "c-pos-1", r.hash + " " + r.first + " " + r.sel + " " + r.detail);
  await L.p.evaluate((u) => { location.hash = "#/hub/complaint?id=" + u; }, U); await wait(700);
  r = await deskAt();
  A("a link to a case the desk does not hold (deleted) opens none and says so, never another case", r.hash === "#/desk?tab=cases&case=" + U && r.sel.length === 0 && r.detail === null && /No case with that link/.test(r.text), r.sel.concat([r.detail, r.text.slice(0, 80)]));
  await L.p.evaluate(() => { location.hash = "#/hub/application?id=oa-1&type=owner"; }); await wait(700);
  r = await deskAt();
  A("a staffer's application link opens that application's own page", r.hash === "#/desk/application/owner-oa-1" && !/No application with that link/.test(r.page), r.hash);
  A("no console error on the desk", L.errors.length === 0, L.errors.slice(0, 3));
  await L.close();
  /* on a phone the list and a case are two screens: the not-found case shows on the case screen, with the way back */
  const LP = await live.open(b, BASE, { persona: "staff", w: 390, hash: "#/hub/complaint?id=" + U });
  r = await LP.p.evaluate(() => ({ detail: (S2.$("#dkMail") || { classList: { contains: () => false } }).classList.contains("show-detail"), text: (S2.$("#dkCaseDetail") || {}).textContent || "", back: !!S2.$("#dkCaseDetail .dk-back") }));
  A("on a phone, the deleted case's link opens the case screen saying No case with that link, with the way back to Cases", r.detail && /No case with that link/.test(r.text) && r.back, r);
  await LP.p.click("#dkCaseDetail .dk-back"); await wait(600);
  r = await LP.p.evaluate(() => ({ hash: location.hash, detail: S2.$("#dkMail").classList.contains("show-detail"), rows: S2.$$("#dkCaseRows [data-case]").length }));
  A("...and Cases returns to the list", r.hash === "#/desk?tab=cases" && !r.detail && r.rows > 0, r);
  A("no console error on the phone desk", LP.errors.length === 0, LP.errors.slice(0, 3));
  await LP.close();

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
