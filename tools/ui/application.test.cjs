const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* One application, its own page, proved in headless Chromium: node tools/ui/run.cjs --suite application --mode live
   Commissioner, 2026-10-22: "opening up a staff or ownership application in the staff desk should open up its own page
   for the application where you can see the staff votes and their reasoning, as well as the chat box with the
   applications to ask questions and chat about the application as well, and also see the answers given when they
   filled out their application." (js/pages/desk.js, #/desk/application/<id>.)
   i3d (2026-11-25): every check runs on the real site (the harness's live mode, through tools/ui/desklive.cjs): the
   league's applications, ballots and messages are the office desklive keeps, the writes are the harness's write mock.
   The concept's sample board (seeded applications, a staff-only notes thread, the S2.carry of a ballot, the waitlist's
   old tabs, the role switcher) is gone with demo mode, and so are the checks that pinned it. Nothing here deploys,
   publishes or touches the database. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const live = require("./desklive.cjs");
const BASE = S2_BASE;
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more === undefined ? "" : "  (" + JSON.stringify(more) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch(), lerr = [];
  const T = (q, sel) => q.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
  /* the words as a reader meets them, one space between blocks; innerText also applies CSS uppercase, so only rows use it */
  const seen = (q, sel) => q.$eval(sel, (e) => e.innerText.replace(/\s+/g, " ").trim());
  const page = async (L, id) => { await L.p.evaluate((h) => { location.hash = h; }, "#/desk/application/" + id); await L.p.waitForFunction(() => document.querySelector("#dkAB") && !/Loading the conversation/.test((document.querySelector("#dkAThread") || {}).textContent || ""), null, { timeout: 8000 }); await wait(150); };
  const hash = async (q, h, sel) => { await q.evaluate((x) => { location.hash = x; }, h); await q.waitForSelector(sel || "#dk"); await wait(250); };
  const lastCall = async (L, rpc) => (await L.calls()).filter((c) => c.rpc === rpc).pop() || null;
  const closed = async (q) => { await q.waitForFunction(() => !document.querySelector(".sheet"), null, { timeout: 8000 }); await wait(200); };

  console.log("## live: the board, from the league's applications (mode " + live.MODE + ")");
  let L = await live.open(browser, BASE, { persona: "staff", hash: "#/desk?tab=applications" }), q = L.p;
  const tiles = await q.$$eval(".dk-lock", (l) => l.map((a) => [a.closest("[data-stage]").dataset.stage, a.getAttribute("href")]));
  A("live: every pending application is a tile linking to its own page", tiles.length === 4 && tiles.every((x) => /^#\/desk\/application\/(owner|staff|management|committee)-[\w-]+$/.test(x[1])), tiles);
  A("live: what waits on this reviewer's ballot is the database's answer (is_app_reviewer), a committee seat on its own gate", tiles.filter((x) => x[0] === "ballot").length === 3 && tiles.filter((x) => x[0] === "voting").map((x) => x[1]).join() === "#/desk/application/committee-ca-1", tiles);
  A("live: an application filed again still waits on a reviewer whose ballot predates the refiling (v4.22 Fresh vote)", tiles.some((x) => x[0] === "ballot" && x[1] === "#/desk/application/staff-sa-1"), tiles);
  A("live: an owner application stays a shape on the board, never a name", (await T(q, '.dk-lock[href="#/desk/application/owner-oa-1"]')).indexOf("Applicant One") < 0);
  A("live: decided applications are counted, never tiles", /Owners/.test(await T(q, '[data-stage="decided"]')) && !(await q.$('.dk-lock[href$="oa-old"]')));
  A("live: before the flip the lead says the applications reviewers vote", /applications reviewers vote/.test(await T(q, ".dk-lead")) && (await q.$$("#dk .chip.sample")).length === 0);
  A("the ballot sheet is gone: a tile opens the application's page", (await q.$$('[data-act="ballot"]')).length === 0);
  A("Admit and Remove are gone from the board (the waitlist is removed, commissioner 2026-11-04)", (await q.$$('[data-act="admit"], [data-act="unlist"], [data-stage="wait"], .dk-appcard, .dk-applink')).length === 0);
  await q.click('[data-apptype="owner"]'); await wait(150);
  A("the Owner filter holds only owner applications", (await q.$$('#dkBoard .dk-lock[href*="/owner-"]')).length === 1 && (await q.$$('#dkBoard .dk-lock:not([href*="/owner-"])')).length === 0);
  await q.click('[data-apptype="all"]'); await wait(150);

  console.log("## live: one application's page");
  await page(L, "owner-oa-1");
  A("live: titled by the applicant, the answers as the owner form asks them", (await T(q, "#dkTitle")) === "Applicant One" && /SampleEA1/.test(await T(q, "#dkAAns")) && /Detroit Red Wings/.test(await T(q, "#dkAAns")));
  A("with a breadcrumb back to Applications", /Staff Desk \/ Applications \/ Applicant One/.test(await seen(q, ".dk-crumbs")));
  const labels = await q.evaluate(() => S2.flows.owner.steps.map((s) => [s.t, s.fields.map((f) => String(f.label).replace(/ \(optional\)$/i, ""))]));
  const ans = await T(q, "#dkAAns");
  A("every step and question of the owner form is answered on the page", labels.every((s) => ans.includes(s[0]) && s[1].every((l) => ans.includes(l))), labels);
  const leak = await q.evaluate(() => { const t = S2.$("#dk").innerText; return S2.M.players.map((x) => x.tag).filter((g) => g && g.length >= 5 && t.includes(g)); });
  A("no member's gamertag from the league stands beside the office's records here (BRIEF privacy)", leak.length === 0, leak.length);
  /* follow-up, 2026-10-22: "can you spread the chat box out more to fill in the empty gap on the right" */
  A("the record runs down the wide column (answers, your ballot, ballots, history) and the conversation is the rail beside it",
    (await q.$$eval(".dk-gd-main > section", (l) => l.map((e) => e.id))).join() === "dkAAns,dkAMine,dkARoll,dkAHist" && (await q.$$eval(".dk-gd-aside > section", (l) => l.map((e) => e.id))).join() === "dkAThread");
  A("a thread opens with who it is with and what about, never as a message", (await T(q, "#dkALog > :first-child .title")) === "Applicant One" && /^Season 2 owner application · Filed /.test(await T(q, "#dkALog > :first-child .t-foot")) &&
    (await q.$$("#dkALog > .dk-chat-start.dk-msg")).length === 0);
  A("live: the band counts the ballots; before the flip it draws no meter (the reviewers' count is not the reader's to read)", (await T(q, '#dkAB [data-k="ap"]')) === "1" && (await T(q, '#dkAB [data-k="dn"]')) === "0" && (await q.$$(".dk-ab-slot")).length === 0);
  A("live: every ballot with its reason, and the conversation with the applicant", /Official Two/.test(await T(q, "#dkARoll")) && /Placeholder reason/.test(await T(q, "#dkARoll")) && /Placeholder question/.test(await T(q, "#dkAThread")) && !(await q.$(".dk-a-seg")));
  await q.click('[data-act="a-cast"]');
  A("live: casting with no choice says so and sends nothing", /Choose Approve or Deny first/.test(await T(q, "#dkAErr")) && !(await lastCall(L, "application_ballots.upsert")));
  await q.click('#dkAMine [data-v="deny"]');
  A("picking clears the message", (await T(q, "#dkAErr")) === "");
  await q.fill("#dkANote", "Placeholder: thin on availability.");
  L.delay(600);
  await q.click('[data-act="a-cast"]'); await wait(150);
  A("live: nothing counts until the database answers", (await T(q, '#dkAB [data-k="dn"]')) === "0" && (await q.getAttribute('[data-act="a-cast"]', "aria-busy")) === "true");
  await q.waitForFunction(() => (document.querySelector('#dkAB [data-k="dn"]') || {}).textContent === "1", null, { timeout: 8000 });
  L.delay(120);
  let c = await lastCall(L, "application_ballots.upsert");
  A("live: the ballot is one upsert on (app_type, application_id, voter_id), this reviewer's own", c && c.args.row.app_type === "owner" && c.args.row.application_id === "oa-1" && c.args.row.vote === "deny" && c.args.row.note === "Placeholder: thin on availability." && c.args.onConflict === "app_type,application_id,voter_id" && c.args.row.voter_id === L.me, c);
  A("live: the page says the ballot and offers to withdraw it", /You voted to deny/.test(await T(q, "#dkAMine")) && !!(await q.$('[data-act="a-retract"]')));
  A("your row leads the ballots, with your reason", /^\S+ You Deny .* Placeholder: thin on availability\.$/.test(await seen(q, ".dk-bal")) && /mine/.test(await q.$eval(".dk-bal", (e) => e.className)), await seen(q, ".dk-bal"));
  A("the button becomes Update ballot and History logs it", (await T(q, '[data-act="a-cast"]')) === "Update ballot" && /Voted to deny/.test(await T(q, "#dkAHist")));
  await q.click('[data-act="a-retract"]'); await q.waitForSelector('.sheet [data-cf="ok"]'); await q.click('.sheet [data-cf="ok"]'); await closed(q);
  c = await lastCall(L, "application_ballots.delete");
  A("live: withdrawing is application_ballots.delete on this reviewer's row", c && c.args.match.app_type === "owner" && c.args.match.application_id === "oa-1" && c.args.match.voter_id === L.me, c);
  await q.waitForFunction(() => /Cast your ballot/.test((document.querySelector("#dkAMine") || {}).textContent || ""), null, { timeout: 8000 });

  console.log("## live: the conversation");
  const before = await q.$$eval("#dkALog .dk-msg", (l) => l.length);
  await q.click('[data-act="a-send"]');
  A("an empty message is refused out loud, and nothing is sent", (await T(q, "#dkAMsgErr")) === "Write a message first." && !(await lastCall(L, "application_messages.insert")));
  await q.fill("#dkAMsg", "Placeholder: which nights could you cover?");
  L.refuse("application_messages.insert", "42501", "new row violates row-level security policy for table \"application_messages\"");
  await q.click('[data-act="a-send"]');
  await q.waitForFunction(() => /row-level security/.test((document.querySelector("#dkAMsgErr") || {}).textContent || ""), null, { timeout: 8000 });
  A("live: a refused message shows the database's words and keeps the text", (await q.inputValue("#dkAMsg")) === "Placeholder: which nights could you cover?");
  L.unrefuse("application_messages.insert");
  await q.press("#dkAMsg", "Control+Enter");
  await q.waitForFunction((b) => document.querySelectorAll("#dkALog .dk-msg").length === b + 1, before, { timeout: 8000 });
  c = await lastCall(L, "application_messages.insert");
  A("live: Control and Enter sends it: application_messages.insert on this application, as this staffer", c && c.args.row.app_type === "owner" && c.args.row.application_id === "oa-1" && c.args.row.body === "Placeholder: which nights could you cover?" && c.args.row.sender_id === L.me, c);
  A("it lands on your side of the thread, the box empties and keeps focus", /^You .*Placeholder: which nights could you cover\?$/.test(await seen(q, "#dkALog .dk-msg:last-child")) &&
    (await q.$eval("#dkAMsg", (e) => e.value)) === "" && (await q.evaluate(() => document.activeElement.id)) === "dkAMsg", await seen(q, "#dkALog .dk-msg:last-child"));
  A("live: a staffer meets no Decide now", !(await q.$('[data-act="a-decide"]')));
  await page(L, "committee-ca-1");
  A("live: on a committee seat the database gives this account no ballot, and the page says so; no message thread", /No ballot from this account/.test(await T(q, "#dkAMine")) && /No message thread/.test(await T(q, "#dkAThread")));
  await page(L, "staff-sa-1");
  A("live: ballots from before the application was filed again count for nothing in the band (resolve_application_if_ready's count)", (await T(q, '#dkAB [data-k="ap"]')) === "0" && (await T(q, '#dkAB [data-k="dn"]')) === "0", [await T(q, '#dkAB [data-k="ap"]'), await T(q, '#dkAB [data-k="dn"]')]);
  A("live: the reader is asked for a ballot again and told why, never told they voted", /Cast your ballot/.test(await T(q, "#dkAMine")) && /no longer counts/.test(await T(q, "#dkAMine")) && !/You voted/.test(await T(q, "#dkAMine")) && !(await q.$('[data-act="a-retract"]')));
  A("live: both earlier ballots stay on the roll, each marked as not counted", (await q.$$("#dkARoll .dk-bal.earlier")).length === 2 && /before it was filed again, so it does not count/.test(await T(q, "#dkARoll")));

  console.log("## the board's layout");
  /* Commissioner, 2026-11-04: "remove the application waitlists feature on the concept site. Make sure to blend it the newly free
     space from that removal. Make sure you think about your work and continue to make it feel intentional, and not as if it was
     bolted on or just removed." So this holds the layout as well as the absence */
  const boardAt = async (w, filter) => {
    await q.setViewportSize({ width: w, height: 900 }); await hash(q, "#/desk?tab=applications", "#dkBoard");
    /* a filter outlives an in-page move, so every measure names the one it wants */
    await q.click('[data-apptype="' + (filter || "all") + '"]'); await wait(200);
    await q.addStyleTag({ content: "#dk .reveal{transform:none!important;opacity:1!important;transition:none!important}" }); await wait(100);
    return q.evaluate(() => { const box = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width) }; }, $ = (x) => document.querySelector(x), $$ = (x) => [].slice.call(document.querySelectorAll(x));
      return { stages: $$("#dkBoard > section").map((e) => e.dataset.stage), board: box($("#dkBoard")), ballot: box($('[data-stage="ballot"]')), voting: box($('[data-stage="voting"]')), decided: box($('[data-stage="decided"]')),
        tallies: $$(".dk-tally").map(box), names: $$(".dk-tally .title").map((e) => e.textContent), over: document.documentElement.scrollWidth - window.innerWidth, gaps: $$(".dk-tally").map((e) => getComputedStyle(e).borderLeftWidth),
        figureLefts: $$(".dk-tally .t-stat-sm").map((e) => e.getBoundingClientRect().left), votingLeft: $('[data-stage="voting"]').getBoundingClientRect().left,
        firstTops: ["ballot", "voting"].map((k) => { const e = $('[data-stage="' + k + '"] .dk-col-b'); return e ? Math.round(e.getBoundingClientRect().top) : null; }) }; });
  };
  let bd = await boardAt(1280);
  A("the board is three parts in reading order: my ballot, voting, decided", bd.stages.join() === "ballot,voting,decided", bd.stages);
  A("the two working columns sit side by side at one width", bd.ballot.w === bd.voting.w && bd.ballot.t === bd.voting.t && bd.ballot.r < bd.voting.l, [bd.ballot, bd.voting]);
  A("Decided closes them across the full board, so no column sits beside a hole", bd.decided.l === bd.board.l && bd.decided.r === bd.board.r && bd.decided.t >= Math.max(bd.ballot.b, bd.voting.b), bd.decided);
  A("its four figures share one row at one width", bd.tallies.length === 4 && bd.tallies.every((x) => x.t === bd.tallies[0].t && Math.abs(x.w - bd.tallies[0].w) <= 1), bd.tallies);
  A("they fill the row edge to edge", bd.tallies[0].l === bd.decided.l && Math.abs(bd.tallies[3].r - bd.decided.r) <= 1, bd.tallies);
  A("a hairline parts them and none opens the row", bd.gaps[0] === "0px" && bd.gaps.slice(1).every((x) => x === "1px"), bd.gaps);
  A("the third figure starts exactly under the Voting column", Math.abs(bd.figureLefts[2] - bd.votingLeft) <= 1, [bd.figureLefts, bd.votingLeft]);
  A("the two working columns start their contents on one line", bd.firstTops[0] === bd.firstTops[1], bd.firstTops);
  const allPlaces = bd.tallies, names = bd.names;
  A("the figures are owners, staff, general managers and assistant GMs", names.join() === "Owners,Staff,General managers,Assistant GMs", names);
  bd = await boardAt(1280, "staff");
  A("a filter keeps a figure in a place the row already has: nothing jumps out of line", bd.tallies.length === 1 && bd.names[0] === "Staff" && bd.tallies[0].l === allPlaces[0].l && bd.tallies[0].w === allPlaces[0].w, bd.tallies);
  A("the first figure on a filter opens the row with no stray hairline", bd.gaps[0] === "0px", bd.gaps);
  bd = await boardAt(1280, "management");
  A("management keeps two places, in the same grid", bd.tallies.length === 2 && bd.tallies[0].w === allPlaces[0].w && bd.tallies[1].l === allPlaces[1].l, bd.tallies);
  bd = await boardAt(900);
  A("at 900px it still reads as one row, with no sideways scroll", bd.tallies.every((x) => x.t === bd.tallies[0].t) && bd.over <= 0, bd);
  bd = await boardAt(375);
  A("on a phone the parts stack and the figures become rows, with no sideways scroll", bd.ballot.b <= bd.voting.t && bd.voting.b <= bd.decided.t && bd.tallies.every((x, i) => !i || x.t >= bd.tallies[i - 1].b - 1) && bd.over <= 0, bd);
  for (const w of [1440, 1024, 768, 700]) { bd = await boardAt(w); A("at " + w + "px the third figure still starts under the Voting column", Math.abs(bd.figureLefts[2] - bd.votingLeft) <= 1, [bd.figureLefts[2], bd.votingLeft]); }
  await q.setViewportSize({ width: 1280, height: 900 });
  const words = await q.evaluate(async () => {
    const seen0 = {}, routes = ["#/desk", "#/desk?tab=cases", "#/desk?tab=games", "#/desk?tab=applications", "#/desk?tab=people", "#/desk?tab=transactions", "#/desk?tab=newsroom", "#/desk?tab=committees", "#/desk/application/owner-oa-1", "#/desk/application/staff-sa-1"];
    for (const r of routes) { location.hash = r; await new Promise((f) => setTimeout(f, 250)); if (/wait.?list/i.test(document.body.innerText)) seen0[r] = document.body.innerText.match(/.{0,50}wait.?list.{0,50}/i)[0]; }
    return seen0;
  });
  A("the word waitlist appears on no page of the desk", Object.keys(words).length === 0, words);
  await hash(q, "#/desk/application/w0");
  A("an old waitlist address reads as no such application, with a way back", /No application with that link/.test(await T(q, "#dk")) && !/undefined|NaN/.test(await T(q, "#dk")) && (await q.$$('#dk a[href*="tab=applications"]')).length >= 1, (await T(q, "#dk")).slice(0, 200));

  console.log("## the conversation rail fills the right side, whatever the record holds");
  /* geometry is measured with the entrance reveal off: its 6px rise is motion, not layout */
  const rail = async (Lr, id, css) => {
    const r0 = Lr.p; await page(Lr, id); await r0.addStyleTag({ content: "#dk .reveal{transform:none!important;opacity:1!important;transition:none!important}" }); if (css) await r0.addStyleTag({ content: css }); await wait(100);
    return r0.evaluate(async () => {
      const qq = (x) => document.querySelector(x), main = qq(".dk-gd-main"), aside = qq(".dk-a-rail"), pane = qq(".dk-a-pane"), nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h"));
      const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), top = main.getBoundingClientRect().top + scrollY;
      scrollTo(0, top - 200); await tick(); const start = Math.abs(qq("#dkAAns").getBoundingClientRect().top - qq("#dkAThread").getBoundingClientRect().top);
      scrollTo(0, top + 600); await tick(); const mid = pane.getBoundingClientRect();
      scrollTo(0, document.documentElement.scrollHeight); await tick(); const end = Math.abs(main.getBoundingClientRect().bottom - pane.getBoundingClientRect().bottom);
      return { sticky: getComputedStyle(pane).position, record: main.offsetHeight, rail: aside.offsetHeight, start, midTop: mid.top - nav, midBottom: innerHeight - mid.bottom, end, log: qq("#dkALog").clientHeight };
    });
  };
  await q.setViewportSize({ width: 1440, height: 900 });
  /* the record is made tall by hand where the office's few ballots leave it short of a screen, as a long record reads */
  const TALL = "#dkARoll{padding-bottom:900px}";
  for (const [id, css] of [["owner-oa-1", TALL], ["staff-sa-1", TALL], ["owner-oa-1", "#dkARoll{padding-bottom:1600px}"]]) {
    const m = await rail(L, id, css);
    A(id + (css === TALL ? "" : " (a longer record)") + ": the rail is the record's height, starts level with the answers, pins 20px under the nav, and ends on the record's last line",
      m.sticky === "sticky" && Math.abs(m.rail - m.record) <= 1 && m.start <= 1 && Math.abs(m.midTop - 20) <= 1 && m.end <= 1 && m.log >= 500, m);
  }
  await rail(L, "owner-oa-1", TALL);
  const midY = await q.evaluate(async () => { const t = document.querySelector(".dk-gd-main").getBoundingClientRect().top + scrollY; scrollTo(0, t + 600); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return scrollY; });
  const nm = await q.$$eval("#dkALog .dk-msg", (l) => l.length);
  await q.fill("#dkAMsg", "Placeholder: sent while the pane is pinned."); await q.press("#dkAMsg", "Control+Enter");
  await q.waitForFunction((k) => document.querySelectorAll("#dkALog .dk-msg").length === k + 1, nm, { timeout: 8000 }); await wait(250);
  const after = await q.evaluate(() => ({ y: scrollY, top: document.querySelector(".dk-a-pane").getBoundingClientRect().top, nav: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")), l: (({ scrollTop, clientHeight, scrollHeight }) => scrollHeight - scrollTop - clientHeight)(document.querySelector("#dkALog")) }));
  A("sending while pinned leaves the page where it was and shows the new message", after.y === midY && Math.abs(after.top - after.nav - 20) <= 1 && after.l <= 2, after);
  await q.setViewportSize({ width: 1600, height: 1000 }); await wait(300); await q.setViewportSize({ width: 1440, height: 760 }); await wait(400);
  const stay = await q.evaluate(() => { const l = document.querySelector("#dkALog"); return l.scrollHeight - l.scrollTop - l.clientHeight; });
  A("a reader at the newest message stays on it when the window resizes", stay <= 2, stay);
  await q.setViewportSize({ width: 1440, height: 900 }); await wait(300);
  for (const t of ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"]) { const k = await q.$$eval("#dkALog .dk-msg", (l) => l.length); await q.fill("#dkAMsg", "Placeholder filler " + t); await q.press("#dkAMsg", "Control+Enter"); await q.waitForFunction((x) => document.querySelectorAll("#dkALog .dk-msg").length === x + 1, k, { timeout: 8000 }); }
  await q.evaluate(() => { document.querySelector("#dkALog").scrollTop = 0; }); await wait(200);
  await q.setViewportSize({ width: 1150, height: 900 }); await wait(600);   /* crosses the desk's 1180 redraw width */
  const kept = await q.evaluate(() => { const l = document.querySelector("#dkALog"); return { top: l.scrollTop, room: l.scrollHeight - l.clientHeight }; });
  A("a reader scrolled up in the thread keeps their place when the window crosses a layout width (review 2026-10-22)", kept.room > 50 && kept.top <= 2, kept);
  await q.setViewportSize({ width: 1024, height: 800 }); await page(L, "owner-oa-1");
  const sectionOrder = () => q.$$eval(".dk-gsec", (l) => l.map((e) => [e.id, e.getBoundingClientRect().top]).sort((a, b) => a[1] - b[1]).map((x) => x[0]).join());
  /* one column reads in the page's own order, the record then the conversation, so the screen and a screen reader agree
     (review 2026-10-22: the earlier order rules showed Messages before History while a screen reader met History first) */
  A("below 1100px nothing pins: one column, the record then the conversation", (await q.$eval(".dk-a-pane", (e) => getComputedStyle(e).position)) === "static" &&
    (await sectionOrder()) === "dkAAns,dkAMine,dkARoll,dkAHist,dkAThread");
  await q.setViewportSize({ width: 1280, height: 560 }); await rail(L, "owner-oa-1", TALL);
  const short = await q.evaluate(() => ({ pos: getComputedStyle(document.querySelector(".dk-a-pane")).position, rail: document.querySelector(".dk-a-rail").offsetHeight, record: document.querySelector(".dk-gd-main").offsetHeight, log: document.querySelector("#dkALog").clientHeight }));
  A("a short desktop window (560px tall) still pins the chat beside the record", short.pos === "sticky" && Math.abs(short.rail - short.record) <= 1 && short.log >= 150, short);
  await q.setViewportSize({ width: 1280, height: 480 }); await wait(300);
  const tiny = await q.evaluate(() => ({ pos: getComputedStyle(document.querySelector(".dk-a-pane")).position, aside: getComputedStyle(document.querySelector(".dk-a-rail")).display }));
  A("under 500px tall it reads as one column instead of leaving the record beside a short chat (review 2026-10-22)", tiny.pos === "static" && tiny.aside === "contents" && (await sectionOrder()) === "dkAAns,dkAMine,dkARoll,dkAHist,dkAThread", tiny);

  console.log("## links and phones");
  await q.setViewportSize({ width: 1280, height: 900 });
  await hash(q, "#/desk/application/zz9");
  A("a bad link says so", /No application with that link/.test(await T(q, "#dk")));
  await q.setViewportSize({ width: 375, height: 812 });
  await page(L, "owner-oa-1"); await wait(300);
  const order = await q.$$eval(".dk-gsec", (l) => l.map((e) => [e.id, e.getBoundingClientRect().top]).sort((a, b) => a[1] - b[1]).map((x) => x[0]));
  A("a phone reads answers, your ballot, the ballots, the history, then the conversation (the page's own order)", order.join() === "dkAAns,dkAMine,dkARoll,dkAHist,dkAThread", order);
  A("no sideways scroll at 375", await q.evaluate(() => document.documentElement.scrollWidth <= 375));
  lerr.push.apply(lerr, L.errors); await L.close();

  console.log("## live: after the flip, every voter; the commissioner decides one now");
  L = await live.open(browser, BASE, { persona: "commissioner", flip: true, cmVote: ["ca-1"], hash: "#/desk?tab=applications" }); q = L.p;
  A("live: after the flip the lead says every staffer and commissioner votes, with the count", /Every staffer and every commissioner votes/.test(await T(q, ".dk-lead")) && /6 of 11/.test(await T(q, ".dk-lead")));
  await page(L, "staff-sa-1");
  A("live: the band's meter has one slot per voter and marks the deciding one", (await q.$$(".dk-ab-slot")).length === 11 && (await q.$$(".dk-ab-slot.line")).length === 1);
  A("a commissioner votes like everyone, and may decide one now (Rule 2.6)", !!(await q.$('[data-act="a-pick"]')) && !!(await q.$('[data-act="a-decide"][data-v="approve"]')));
  await q.setViewportSize({ width: 1440, height: 2200 });
  const tall = await rail(L, "staff-sa-1", TALL);
  A("on a very tall screen the rail still never runs past the record (commissioner)", Math.abs(tall.rail - tall.record) <= 1 && tall.end <= 1, tall);
  await q.setViewportSize({ width: 1280, height: 900 });
  await q.click('[data-act="a-decide"][data-v="approve"]'); await q.waitForSelector('.sheet [data-cf="ok"]'); await q.click('.sheet [data-cf="ok"]'); await closed(q);
  c = await lastCall(L, "override_application_decision");
  A("live: Decide now is override_application_decision with the type and the id", c && c.args.p_type === "staff" && c.args.p_id === "sa-1" && c.args.p_approve === true, c);
  await q.waitForFunction(() => /Approved/.test((document.querySelector('#dkAB [data-k="state"]') || {}).textContent || ""), null, { timeout: 8000 });
  A("live: the decision shows once the database has it", /Approved/.test(await T(q, "#dkAMine")));
  await q.click('.dk-crumbs [data-pane="applications"]'); await q.waitForSelector("#dkBoard"); await wait(250);
  A("the board counts it decided, and never tells a commissioner they voted", !(await q.$('.dk-lock[href="#/desk/application/staff-sa-1"]')) && !(await T(q, "#dkBoard")).includes("You voted"));
  await page(L, "committee-ca-1");
  A("live: where the seat vote's gate says yes, the ballot is there", !!(await q.$('#dkAMine [data-act="a-cast"]')));
  /* gaps (2026-11-25): a GM or AGM nomination names its club, found by teams.id (the league read's M.teams carries it since
     i3a); the review found the desk looked clubs up by an id the model did not carry */
  await page(L, "management-ma-1");
  const club = await q.evaluate(() => { const r = S2._desk.LV.apps.filter((a) => a.uuid === "ma-1")[0]; const t = r && S2.M.teams.filter((x) => x.id === r.row.team_id)[0]; return t ? t.full : null; });
  A("gaps: a front office nomination names its club in the record and in the page's line", !!club && (await T(q, "#dkAAns")).indexOf("Club" + club) >= 0 && (await T(q, "#dk")).indexOf("assistant general manager of the " + club) >= 0 && !/A club/.test(await T(q, "#dkAAns")), [club, await T(q, "#dkAAns")]);
  lerr.push.apply(lerr, L.errors); await L.close();

  console.log("## live: a member");
  L = await live.open(browser, BASE, { persona: "member", locked: true, hash: "#/desk?tab=applications" }); q = L.p;
  A("live: a member meets the staff-only page, and no application is read", /for the league's staff/.test(await T(q, "#page")) && !(await q.$("#dk")) && L.reads().indexOf("from:owner_applications") < 0);
  lerr.push.apply(lerr, L.errors); await L.close();
  A("live: no console errors on the live application pages", lerr.length === 0, lerr.slice(0, 5));

  await browser.close();
  console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\n" + n + "/" + n + " passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
