const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* The Season 2 market as the older pages read it (the ports), on the REAL site, in headless Chromium:
   node tools/ui/run.cjs --suite ports --mode live   (any mode works: every context opts into the real site itself)
   Review of 2026-11-03, the ports fixer's findings: the Staff Desk measures Season 2 (S2.market.clubState: 12 active, at
   least 3 F, 2 D and 1 G since 2026-11-23, payroll is the active roster, cap room is the season's cap less that, $30M in
   Season 2), so legal rosters are never flagged as Season 1 violations and a club short of a minimum is; Season setup
   step 7 counts six games this season at any club and keeps its labels readable at 375px; the Season page names each
   closed door's own opening day; and no shipped comment names the inactive-player rule.
   v5.00 swap (i3e, 2026-11-25): the pages run on the league's data (tools/ui/market-world.cjs over tools/ui/mock's live
   mode; nothing reaches production). Deleted with the demo (each pinned only demo behavior): the desk's scene of demo
   waivers, a demo claim and a demo bid night (S2.demo.waive, S2.market.claim and skip in page state), the desk's repaint
   on those demo events, and its log of demo transactions (desk.js still reads S2.demo.transactions; its owner moves it). */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const fs = require("fs");
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const X = require("./market-world.cjs")(mock);
  const { MINE, CA, CD, L2 } = X;
  /* the Staff Desk's own reads (the staff gates and its panes), answered empty: these checks read its transactions pane */
  const DESK = { rpcs: { has_department: mock.ok(false), is_app_reviewer: mock.ok(false), is_any_committee_manager: mock.ok(false), staff_voter_count: mock.ok(11) },
    tables: { action_requests: [], owner_applications: [], staff_applications: [], management_applications: [], committee_applications: [], application_ballots: [], suspension_requests: [],
      trades: [] } };   /* gaps (2026-11-25): the transactions pane reads the season's trades (the classic desk's ledger) */
  const go = async (p, h) => { await p.evaluate((x) => { location.hash = x; }, h); await wait(700); };
  /* the desk's transactions table, row by row, with the flagged cells and the figures as printed */
  const deskRows = (p) => p.evaluate(() => [...document.querySelectorAll("#dkTx table.dk-tx tbody tr")].map((tr) => ({ club: tr.querySelector("th").innerText.trim(),
    cells: [...tr.querySelectorAll("td")].map((td) => td.innerText.trim()), over: [...tr.querySelectorAll("td.dk-over")].map((td) => td.innerText.trim()) })));
  const desk = async (w) => {
    const o = await X.open(b, "commissioner", "#/desk?tab=transactions", Object.assign({ wait: false }, DESK, w || {}));
    await o.p.waitForSelector("#dkTx table.dk-tx", { timeout: 10000 }).catch(() => null);
    return o;
  };

  console.log("## the Staff Desk measures Season 2 (findings 18 and 19, desk part)");
  /* every club a legal Season 2 roster (four forwards, two defense, a goaltender); one club carries eight forwards, over
     Season 1's seven, which Season 2 allows (no group maximums) */
  X.reset(); X.fill(4, 2, 1, { [CA]: { F: 8 } });
  let { ctx, p } = await desk();
  let r = await p.evaluate(() => ({ sub: S2.$("#dkSub").innerText, sec: S2.$("#dkTx section").innerText,
    heads: [...document.querySelectorAll("#dkTx table.dk-tx thead th")].map((th) => th.innerText.trim()) }));
  A("the table is headed by the Season 2 limits and says how cap room is counted", /Season 2 limits in force: 12 active, with at least 3 forwards, 2 defense and 1 goaltender/.test(r.sec)   /* minimums 3/2/1 since 2026-11-23 */ && /Season 2 cap room: \$30M less the active roster/.test(r.sec)   /* commissioner, 2026-11-09: "For now, set it at 30 Million for season 2" */, r.sec.slice(0, 400));
  A("no Season 1 group limit and no camp-inclusive payroll on the desk", !/Season 1 limit|7 forwards, 5 defense|camp contracts/i.test(r.sec + r.sub) && r.heads.indexOf("Camp") < 0, r.heads);
  A("the lede is a Season 2 sentence: every club inside the roster limit", /^All 8 clubs sit inside the Season 2 roster limit of 12/.test(r.sub), r.sub);
  let rows = await deskRows(p);
  const states = await p.evaluate(() => { const o = {}; S2.M.teams.forEach((t) => { const s = S2.market.clubState(t.code); o[t.code] = { F: s.active.F, D: s.active.D, G: s.active.G, total: s.active.total, pay: S2.M.money(s.payroll), room: S2.M.money(s.room) }; }); return o; });
  const match = rows.length === 8 && rows.every((x) => { const s = states[x.club]; return s && x.cells[0] === String(s.F) && x.cells[1] === String(s.D) && x.cells[2] === String(s.G) && x.cells[3] === s.total + " of 12" && x.cells[4] === s.pay && x.cells[5] === s.room; });
  A("every row matches S2.market.clubState (active F, D, G, total, payroll, room)", match, { rows: rows.length });
  const ca = rows.filter((x) => x.club === CA)[0];
  A("a club at eight forwards (over Season 1's seven) is not flagged: Season 2 has no group maximums", ca && ca.cells[0] === "8" && ca.over.length === 0 && rows.every((x) => x.over.length === 0), ca);
  /* a commissioner acting for a club that leads a lot: the desk reads room BEFORE leads, never freeRoom (Rule S2.6) */
  X.w.bids.push(X.bid(598, X.w.lots.find((l) => l.profile_id === L2).id, MINE, 3, 1250000, Date.now() - 30e3)); Object.assign(X.w.lots.find((l) => l.profile_id === L2), { price: 1250000, bids: 3 });
  await go(p, "#/camp"); await p.waitForFunction(() => S2.market.status().loaded);
  await p.evaluate((c) => S2.market.setClub(c), MINE); await p.waitForFunction((c) => S2.market.clubState(c).leading.length === 1, MINE);
  r = await p.evaluate((c) => { const cs = S2.market.clubState(c); return { room: S2.M.money(cs.room), free: S2.M.money(cs.freeRoom) }; }, MINE);
  await go(p, "#/desk?tab=transactions");
  rows = await deskRows(p);
  const det = rows.filter((x) => x.club === MINE)[0];
  A("while the club acted for leads a lot, its cap room on the desk is the room before leads", det && det.cells[5] === r.room && det.cells[5] !== r.free, [r, det && det.cells[5]]);
  await ctx.close();
  /* one club with no goaltender: flagged in red and in words */
  X.reset(); X.fill(4, 2, 1, { [CD]: { G: 0 } });
  ({ ctx, p } = await desk());
  rows = await deskRows(p);
  const shortRow = rows.filter((x) => x.club === CD)[0];
  const sr = await p.evaluate((code) => { const tr = [...document.querySelectorAll("#dkTx table.dk-tx tbody tr")].filter((t) => t.querySelector("th").innerText.trim() === code)[0]; return tr ? [...tr.querySelectorAll("td.dk-over .sr")].map((x) => x.textContent) : []; }, CD);
  const sub = await p.evaluate(() => S2.$("#dkSub").innerText);
  A("a club short of the goaltender minimum is flagged on its G cell, with \"short\" for a screen reader, and counted in the lede", shortRow && shortRow.over.length === 1 && /^0/.test(shortRow.over[0]) && sr.join() === " (short)" && /^One club is outside a Season 2 limit/.test(sub), [shortRow, sr, sub]);
  /* fail loud: without the market there is nothing true to show, so the pane says so (never Season 1 figures) */
  await go(p, "#/desk?tab=today");
  await p.evaluate(() => { window.__K = S2.market; S2.market = null; });
  await go(p, "#/desk?tab=transactions");
  r = await p.evaluate(() => { const o = { sub: (S2.$("#dkSub") || {}).innerText, err: !!S2.$("#dkTx .empty-state.err"), table: !!S2.$("#dkTx table.dk-tx") }; S2.market = window.__K; return o; });
  A("without S2.market the desk shows an error state and an honest lede, no table", r.err && !r.table && /did not load/.test(r.sub), r);
  await ctx.close();

  console.log("## Season setup step 7 (finding 5, control part, and the 375px label overlap)");
  for (const w of [1280, 375, 320]) {
    X.reset();
    /* the market is read first (the camp page asks for it): control.js reads S2.market.bidNights() but does not ask for
       the market itself, so a cold load shows "Saturdays after the draft" until another page has read it (handed to g3) */
    ({ ctx, p } = await X.open(b, "commissioner", "#/camp", { width: w, height: 900 }));
    await go(p, "#/control?tab=setup");
    await p.waitForSelector('[data-cc-step="7"]');
    await p.click('[data-cc-step="7"]'); await wait(800);
    r = await p.evaluate(() => {
      const rows = [...document.querySelectorAll(".cc-kv .row")], o = { n: rows.length, text: rows.map((x) => x.innerText.replace(/\s+/g, " ")).join(" | "), bad: [] };
      rows.forEach((row) => { const g = row.querySelector(".grow"), t = row.querySelector(".trail"), a = g.getBoundingClientRect(), c = t.getBoundingClientRect(), rr = row.getBoundingClientRect();
        if (a.right > c.left + 0.5 || c.right > rr.right + 0.5 || a.width < 40 || g.scrollWidth > g.clientWidth + 1 || t.scrollWidth > t.clientWidth + 1) o.bad.push(g.innerText); });
      return o;
    });
    if (w === 1280) {
      A("step 7 counts six games this season at any club, not games in the pool", /To be bid on Six games played this season, at any club/.test(r.text) && !/in the pool/.test(r.text), r.text.length);
      A("step 7 keeps the bid nights' time together (no-break spaces)", /9 to 10\u00a0PM\u00a0ET/.test(await p.evaluate(() => document.querySelector(".cc-kv .row .trail").textContent)));
    }
    A("step 7 at " + w + "px: every label keeps its own width and no value runs into it (Every bid, Waivers included)", r.n === 9 && r.bad.length === 0, r.bad);
    await ctx.close();
  }

  console.log("## the Season page's doors (finding 7)");
  /* QA round 2 (A9): this check ran in a world whose market said the draft was done while the league read said it was
     still to come; with ONE world (market-world.cjs: the league read's draft follows the calendar), the draft room's
     opening day is said only before the draft, so the check now sets that world honestly: the schedule set, the draft
     still to come (draftDone false), and the first bid night a week after draft night, as Saturday bidding follows it,
     with the movement deadline two weeks after that night (round 2 nit: the world's deadline came before bidding opened) */
  X.reset(); X.w.draftDone = false;
  X.before(Math.max(0, Date.parse(X.S2B.seasons.find((s) => s.number === 2).draft_at) - Date.now()) + 7 * 86400e3);
  X.w.deadline = X.w.opens + 14 * 86400e3;
  ({ ctx, p } = await X.open(b, "anon", "#/camp"));
  const nb = await p.evaluate(() => S2.market.nextBidNight().label), order = await p.evaluate(() => ({ opens: S2.market.nextBidNight().opens, deadline: S2.market.deadline }));
  A("the world is one the rules allow: its first bid night opens before the movement deadline", order.deadline > order.opens, order);
  await go(p, "#/season");
  r = await p.evaluate(() => S2.$("#hdoors").closest("section").querySelector(".sec-head p, p").innerText);
  A("each closed door names its own opening: the draft room on Dec 12, Saturday bidding on the market's next bid night", /The draft room opens on Saturday, December 12\./.test(r) && r.indexOf("Saturday bidding opens on " + nb + ".") >= 0 && !/once the draft begins/.test(r), r);
  await ctx.close();

  console.log("## copy rules in the ports' files (finding 8, league.js part)");
  /* e0's hand-over (2026-11-24): draft.js and gamedesk.js moved out of league.js and desk.js, so the scan follows them */
  const mine = ["js/pages/league.js", "css/league.css", "js/pages/control.js", "css/control.css", "js/pages/desk.js", "css/desk.css", "js/pages/today.js", "js/pages/draft.js"];
  /* the banned words are built from pieces, so this file never carries them either */
  const banned = new RegExp(["Rule 7\\.", "8|ab", "andon|cancel", "led"].join(""), "i");
  const hits = mine.map((f) => [f, fs.readFileSync(S2_ROOT + "/" + f, "utf8")]).filter((x) => banned.test(x[1])).map((x) => x[0]);
  A("no shipped comment or copy names the inactive-player rule or its word, and canceled is spelled the American way", hits.length === 0, hits);
  /* v5.00 swap (b4, 2026-11-24): gamedesk.js (g2's port of the classic forfeit sheet) names Rule 4.3's "abandoned" game,
     the live rulebook's own term for an unfinished game (part_live.js says it word for word), so its scan bans the
     inactive-player rule's own noun and number rather than the bare stem; everything else is the same ban */
  const bannedDesk = new RegExp(["Rule 7\\.", "8|ab", "andonment|cancel", "led"].join(""), "i");
  const deskSrc = fs.readFileSync(S2_ROOT + "/js/pages/gamedesk.js", "utf8");
  A("js/pages/gamedesk.js names neither the inactive-player rule nor its noun, and spells canceled the American way", !bannedDesk.test(deskSrc), (deskSrc.match(bannedDesk) || [])[0]);

  const ours = X.errs.filter((e) => /desk|control|league|season|market|pageerror/i.test(e) && !/Failed to load resource/.test(e));
  A("no console errors from these pages", ours.length === 0, ours.join(" | "));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
