const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The Season 2 staff on the site: node tools/ui/run.cjs --suite staffing --mode live. Commissioner's rulings, 2026-11-23:
   six committees (Officiating, Statistics and imports, Applications, Community, Transactions, Draft and Bidding), Game
   Operations folded into Officiating, each with one manager who sets priorities and is the go-to person; every staffer's
   and every commissioner's vote counts the same (owner, staff, GM/AGM and committee manager applications, more than half
   of all of them); manager seats filled by staff applying and the others voting, never appointed; the ONLY extra powers
   are the Draft and Bidding manager's (or a commissioner's). Also: the Season page's staff door says a vote of all staff
   and commissioners, and no "reviewers" or department copy is left. Charters keep their capitals ("GM and AGM
   applications", "Players of the Week").
   i3d (2026-11-25): every page is the real site (the harness's live mode: tools/ui/mock with live: true); the Staff Desk
   opens on the league office tools/ui/desklive.cjs keeps. The concept's role switcher, its placeholder officials and
   seats, the demo market clock and its role locks, the demo draft room and S2.demo's committee seats are gone with demo
   mode, and so are the checks that pinned them (listed in the commit). Nothing here writes to the league. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const live = require("./desklive.cjs");
const BASE = S2_BASE;
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SIX = ["Officiating", "Statistics and imports", "Applications", "Community", "Transactions", "Draft and Bidding"];
/* who reads each page: the harness's personas, a committee manager being a staffer with a seat (the Draft and Bidding
   one, whose seat carries the only powers) */
const ROLE = { guest: ["anon"], player: ["member"], staff: ["staff"], manager: ["staff", { committees: ["draft"] }], commish: ["commissioner"] };
/* the reads a page meets here besides the league read: the member's own applications on file (js/flows.js, js/pages/you.js:
   none), and the Staff Desk's office (the Control Center asks the desk to read; an empty office) */
const DESK_RPCS = { season_survey_done: mock.ok(true), has_department: mock.ok(false), is_app_reviewer: mock.ok(true), staff_voter_count: mock.ok(11), can_vote_committee_app: mock.ok(false),
  is_any_committee_manager: Object.assign(mock.fail("PGRST202", "Could not find the function public.is_any_committee_manager(p_profile) in the schema cache"), { status: 404 }),
  s2_desk: mock.ok({ staff: [], suspensions: [], activity: [] }), season_survey_results: mock.ok({ responses: [] }) };
const DESK_TABLES = { action_requests: [], action_messages: [], owner_applications: [], staff_applications: [], management_applications: [], committee_applications: [], application_ballots: [],
  application_messages: [], suspension_record: [], committees: [], suspension_requests: Object.assign(mock.fail("PGRST205", "Could not find the table 'public.suspension_requests' in the schema cache"), { status: 404 }) };

(async () => {
  const b = await chromium.launch();
  const errors = [];
  async function page(hash, o) {
    o = o || {};
    const ctx = await b.newContext(Object.assign(o.w ? { viewport: { width: o.w, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } }, o.dark ? { colorScheme: "dark" } : {}));
    const as = ROLE[o.role || "staff"];
    /* the member's own applications on file (js/flows.js and js/pages/you.js read them): none */
    await mock.install(ctx, { live: true, persona: as[0], session: as[1], rpcs: DESK_RPCS, tables: DESK_TABLES });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    /* the browser logs every non-2xx answer as "Failed to load resource"; what the page itself says is what counts */
    /* o.theirs: another stream's page opened only for its layout (the bid room, the draft room); the harness carries no
       market or draft data, so the reads those pages make are refused, and their own suites (bidding, draftroom) own them */
    const sink = o.theirs ? [] : errors;
    p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) sink.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.LIVE && S2.M && document.querySelector("#app section, #app header"));
    await wait(450);
    return p;
  }
  const done = (p) => p.context().close();
  const go = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await wait(450); };
  const sheetGone = async (p) => { await p.waitForFunction(() => !document.querySelector(".sheet")); await wait(80); };
  const OLD = /Game operations|game operations|Officiating and discipline|reviewer/i;
  let p, r;

  console.log("## 1. six committees, one definition");
  p = await page("#/today");
  r = await p.evaluate(() => ({ names: S2.COMMITTEES, defs: S2.COMMITTEE_DEFS.map((c) => [c.key, c.charter]), cover: S2.committeeCovers(S2.COMMITTEE_DEFS[0]),
    covers: S2.COMMITTEE_DEFS.map((c) => S2.committeeCovers(c)) }));
  A("six committees, in the ruling's order and names", JSON.stringify(r.names) === JSON.stringify(SIX), r.names);
  const ch = {}; r.defs.forEach((d) => { ch[d[0]] = d[1].join(" | "); });
  A("Officiating took Game Operations' work: lineups, game-night problems, held games, reschedules and the schedule",
    /complaints and appeals \| forfeits \| warnings and suspensions \| lineups and late changes \| game-night problems \| held games \| reschedules and the schedule/.test(ch.officiating), ch.officiating);
  A("Statistics and imports: imports, unmatched players, outside clubs, the Stats manager, corrections, titles, trophies, ratings, Players of the Week",
    ["EA imports", "unmatched players", "games under an outside club", "the Stats manager", "corrections", "titles and trophies", "ratings", "Players of the Week"].every((x) => ch.statistics.indexOf(x) >= 0), ch.statistics);
  A("Applications keeps every staff vote moving, committee manager applications included", /committee manager applications/.test(ch.applications) && /keeping every staff vote moving/.test(ch.applications) && /GM and AGM applications/.test(ch.applications), ch.applications);
  A("Community: welcomes, questions, conduct reports, departures, news, the survey, pickup lobbies", ["Discord welcomes", "member questions", "Discord conduct reports", "departures", "news and announcements", "the survey", "pickup lobbies"].every((x) => ch.community.indexOf(x) >= 0), ch.community);
  A("Transactions has position changes and GM/AGM nominations", /position changes/.test(ch.transactions) && /GM and AGM nominations/.test(ch.transactions) && /the movement deadline/.test(ch.transactions), ch.transactions);
  A("Draft and Bidding: draft night, skipped picks at $750K (RULED), Saturday bidding, the pool", /draft night/.test(ch.draft) && /at \$750K, or lapsing when none fits/.test(ch.draft) && !/pick's salary/.test(ch.draft) && /Saturday bidding/.test(ch.draft) && /the training camp pool/.test(ch.draft), ch.draft);
  A("a charter reads as one sentence", /^Complaints and appeals, forfeits, warnings and suspensions, .* and reschedules and the schedule\.$/.test(r.cover), r.cover);
  A("a charter keeps its capitals in a sentence (review 2026-11-23: 'gM and AGM applications', 'players of the Week')",
    /^EA imports, unmatched players, .*, ratings and Players of the Week\.$/.test(r.covers[1]) && /^Owner applications, staff applications, GM and AGM applications, committee manager applications and keeping every staff vote moving\.$/.test(r.covers[2]) && /^Discord welcomes, member questions, Discord conduct reports/.test(r.covers[3]), r.covers);
  await done(p);

  let L = await live.open(b, BASE, { persona: "staff", hash: "#/desk?tab=committees" });
  p = L.p;
  r = await p.evaluate(() => ({ cards: [...document.querySelectorAll(".dk-ccard")].map((c) => c.querySelector(".d-3").textContent), you: [...document.querySelectorAll(".dk-ccard")].filter((c) => /\(you\)/.test(c.textContent)).length,
    covers: document.querySelector('.dk-ccard[data-committee="officiating"] .dk-ccard-covers').textContent, calls: document.getElementById("dkCallsH").textContent,
    callsT: document.querySelector(".dk-calls").textContent, page: document.getElementById("page").textContent }));
  A("the Staff Desk's committees are the six, each with its charter", JSON.stringify(r.cards) === JSON.stringify(SIX) && /Lineups and late changes|lineups and late changes/.test(r.covers), r);
  A("a plain staffer manages none of them", r.you === 0, r.you);
  A("the open decisions became the rulings", r.calls === "How the committees work" && /Every staffer and every commissioner, on owner, staff, GM or AGM and committee manager applications\. One passes when more than half of them approve, and a commissioner, who votes like everyone, may also decide one alone \(Rule 2\.6\)/.test(r.callsT) && /Staff apply for an open manager seat, and the other staff and the commissioners vote on it\. No one appoints a manager/.test(r.callsT) && !/is open\.|Your call/.test(r.callsT), r.callsT.slice(0, 300));
  A("no Game operations, no old name, no reviewers", !OLD.test(r.page), (r.page.match(OLD) || [])[0]);
  await p.click('#dkLineup [data-committee="statistics"]'); await p.waitForFunction(() => /Statistics and imports/.test((document.getElementById("dkFocusH") || {}).textContent || ""));
  A("Statistics' focus links its home (the Games pane) and the pickup tools (g5's hand-over)", await p.evaluate(() => !!document.querySelector('#dkFocus a[href^="#/desk?tab=games"]') && !!document.querySelector('#dkFocus a[href="#/pickups"]')));
  await p.evaluate(() => { location.hash = "#/desk?tab=games"; }); await p.waitForSelector("#dkGViews");
  A("the Games pane links statistics staff to the pickup games (g5's hand-over)", await p.evaluate(() => !!document.querySelector('#dkMain a[href="#/pickups"]')));
  await L.close();
  L = await live.open(b, BASE, { persona: "manager", hash: "#/desk?tab=committees" }); p = L.p;
  r = await p.evaluate(() => [...document.querySelectorAll(".dk-ccard")].filter((c) => /\(you\)/.test(c.textContent)).map((c) => c.dataset.committee));
  A("a committee manager's own committee is marked theirs, and its focus opens on it", JSON.stringify(r) === '["officiating"]' && await p.evaluate(() => /Officiating/.test(document.getElementById("dkFocusH").textContent)), r);
  A("and the rail carries You manage, a door into it", await p.evaluate(() => !!document.querySelector('.dk-side-you[href*="c=officiating"]')));
  await L.close();

  p = await page("#/control?tab=staff", { role: "commish" });
  r = await p.evaluate(() => ({ names: [...document.querySelectorAll(".cc-cmt-n")].map((x) => x.textContent), t: document.getElementById("page").textContent, count: (document.querySelector('[data-cc-tab="staff"] .count') || {}).textContent || "",
    btns: document.querySelectorAll("button.cc-mgr, [data-cc-mgr]").length }));
  A("the Control Center lists the six committees", JSON.stringify(r.names) === JSON.stringify(SIX), r.names);
  A("it states the rulings, not open questions", /six committees/.test(r.t) && /Your rulings, November 23/.test(r.t) && /On owner, staff, GM or AGM and committee manager applications\. One passes when more than half of them approve/.test(r.t) && /You vote like everyone, and may also decide one alone from its page on the Staff Desk \(Rule 2\.6\)/.test(r.t) && !/staffing questions are open|Your call/.test(r.t), r.t.slice(0, 200));
  /* qa (function 9): every manager suspends within Rule 7.2 and decides appeals (Rule 7.6); "powers for Draft and Bidding
     only" contradicted the "Who suspends" ruling on the same pane */
  A("what a manager adds: priorities, the go-to person, no extra vote, suspensions and appeals for every manager, and the bidding pause and draft room for Draft and Bidding",
    /The committee's priorities/.test(r.t) && /The go-to person/.test(r.t) && /No extra vote/.test(r.t) && /Every manager may suspend within Rule 7\.2 and decide appeals \(Rule 7\.6\)/.test(r.t) &&
    /pauses and resumes Saturday bidding and runs the draft room \(Rule S2\.8\)/.test(r.t) && !/Draft and Bidding only|Draft and Bidding seat only/.test(r.t), null);
  A("a seat is filled by a staff vote: the Control Center appoints no one", /A seat is filled by staff applying and all the other staff voting; the Control Center shows who holds each, and appoints no one/.test(r.t) &&
    r.btns === 0 && !/a commissioner names|Name managers/i.test(r.t), r);
  A("the Staff tab carries no open-questions count, and the page no old names", r.count === "" && !OLD.test(r.t), r.count);
  await done(p);

  p = await page("#/season", { role: "player" });
  await p.evaluate(() => S2.flow("staff")); await wait(450);
  r = await p.evaluate(() => ({ t: document.querySelector(".sheet").textContent, opts: [...document.querySelectorAll('.sheet [data-k="areas"] input')].map((i) => i.value) }));
  A("the staff form offers the six committees", JSON.stringify(r.opts) === JSON.stringify(SIX), r.opts);
  A("and says every staff vote counts, more than half", /Staff applications are decided by a vote of all staff and commissioners, and one passes when more than half of them approve/.test(r.t) && !OLD.test(r.t), r.t.slice(0, 300));
  await done(p);
  p = await page("#/today", { role: "staff" });
  r = await p.evaluate(() => ({ lineups: S2.search("late changes").reduce((a, g) => a.concat(g.items.map((i) => i.href)), []), bid: S2.search("draft and bidding").reduce((a, g) => a.concat(g.items.map((i) => i.href)), []) }));
  A("search finds the committees by their charters' words", r.lineups.indexOf("#/desk?tab=committees") >= 0 && r.bid.indexOf("#/desk?tab=committees") >= 0, r);
  await done(p);

  console.log("## the Draft and Bidding manager's hats, from the session");
  p = await page("#/today", { role: "manager" });
  r = await p.evaluate(() => ["member", "office", "staff", "manager", "draftbid", "commish"].map((h) => h + ":" + S2.has(h)));
  A("a Draft and Bidding manager wears every staff hat and the manager hats, not the commissioner's", r.join(",") === "member:true,office:false,staff:true,manager:true,draftbid:true,commish:false", r);
  await go(p, "#/control");
  A("the Control Center stays a commissioner's", await p.evaluate(() => !document.querySelector(".cc-head") && !/Control Center/.test((document.querySelector("#page h1") || {}).textContent || "")), await p.evaluate(() => (document.querySelector("#page h1") || {}).textContent));
  await done(p);
  p = await page("#/today", { role: "staff" });
  r = await p.evaluate(() => ["staff", "manager", "draftbid"].map((h) => h + ":" + S2.has(h)));
  A("a plain staffer holds neither manager hat", r.join(",") === "staff:true,manager:false,draftbid:false", r);
  await done(p);
  L = await live.open(b, BASE, { persona: "manager", hash: "#/desk" });
  A("the Staff Desk opens for a manager", await L.p.evaluate(() => document.querySelector("#page h1").textContent === "Staff Desk" && S2._desk.LV.state === "ready"));
  await L.close();

  console.log("## 3. the Season page and every vote: all staff, more than half");
  p = await page("#/season", { role: "guest" });
  r = await p.evaluate(() => { const d = [...document.querySelectorAll(".lg-door")].filter((x) => /Join the staff/.test(x.textContent))[0]; return d.textContent; });
  A("the staff door: decided by a vote of all staff, more than half", /Decided byA vote of all staff and commissioners, more than half/.test(r) && /CommitteesSix, from officiating to draft and bidding/.test(r) && !OLD.test(r), r);
  await p.click('[data-door="staff"]'); await wait(400);
  r = await p.evaluate(() => document.querySelector(".sheet").textContent);
  A("and its sheet says the same, with the six committees", /A staff application is decided by a vote of all staff and commissioners, and it passes when more than half of them approve \(Rule S2\.8\)/.test(r) && /each of the six committees has a manager/.test(r), r.slice(0, 300));
  await p.keyboard.press("Escape"); await sheetGone(p);
  A("no reviewers and no old committee names on the Season page", await p.evaluate((o) => !new RegExp(o, "i").test(document.getElementById("page").textContent), OLD.source));
  await done(p);
  p = await page("#/you?tab=applications", { role: "player" });
  A("the member's own applications say every staffer votes", await p.evaluate(() => { const t = document.getElementById("page").textContent; return /Every staffer and commissioner votes on each application/.test(t) && !/reviewer|Game operations/i.test(t); }));
  await done(p);

  /* v5.00 swap, the staffing flip (2026-11-25): #/rulebook renders the ONE live book (S2.RB, js/rulebook.js, built from
     src/live with the flip's amendment spliced in), so these checks pin S2.8, S2.2, 2.6 and 3.2 as the live book words
     them. Deleted as obsolete: the "proposed November 23" marks and notes (.lg-rb-p.prop, .lg-rb-prop-n) and the About's
     list of proposed sections, because the page shows the one live book with no proposal machinery; and the check that
     S2.8 carries every committee's charter, because the live S2.8 names the six committees without charters (the charters
     stay pinned on S2.COMMITTEE_DEFS and the Staff Desk, section 1 of this suite). */
  try {   /* i3d: the rulebook section is flipbook's (it is rewriting it for the switched book); a throw in it is a FAIL, not the end of this suite */
  console.log("## the rulebook: Rule S2.8 and no department or reviewer left");
  p = await page("#/rulebook?rule=S2.8", { role: "guest" });
  r = await p.evaluate(() => {
    const s = (id) => { const e = document.getElementById("rb-" + id); return e ? { p: [...e.querySelectorAll(".lg-rb-p")].map((x) => x.textContent.slice(1)) } : null; };
    const body = document.getElementById("rbBody").textContent, s28 = document.getElementById("rb-S2.8").textContent;
    return { s28: s("S2.8"), s22: s("S2.2"), s23: s("S2.3"), s26: s("2.6"), s92: s("9.2"), r32: s("3.2"), toc: !!document.querySelector('.lg-toc-a[data-rule="S2.8"]'),
      rev: /reviewer/i.test(body), media: /Media staffer/.test(body), dept: (body.replace(s28, "").match(/department/gi) || []).length,
      thirty: /thirty \(30\) days/.test(body) };
  });
  A("S2.8 is in the edition and the contents: two paragraphs", r.toc && !!r.s28 && r.s28.p.length === 2, r.s28 && r.s28.p.length);
  A("S2.8 names the six committees, one group with no departments, and the equal vote of every staffer and commissioner",
    /^Season 2 has six \(6\) staff committees: Officiating; Statistics and imports; Applications; Community; Transactions; and Draft and Bidding\./.test(r.s28.p[0]) &&
    /The league staff is one group, with no departments: every member of league staff may do the work of any committee, and every member of league staff and every commissioner votes on an owner, staff, General Manager or Assistant General Manager application \(Rule 2\.6\)\./.test(r.s28.p[0]) &&
    /Every automated notice to league staff, the notice of a ban, of the lifting of a ban and of the lifting of a suspension included, goes to one staff notifications channel in the league Discord\./.test(r.s28.p[0]), r.s28.p[0].slice(0, 300));
  A("S2.8: one manager each, chosen by a staff vote, powers only to suspend within 7.2 and the Draft and Bidding manager's",
    /Each committee has one committee manager, who prioritizes the committee's work and is the first point of contact for it\./.test(r.s28.p[0]) &&
    /A committee manager holds no power beyond that of any other member of league staff, save that a committee manager may issue a suspension within the limits of Rule 7\.2, extend or lift one, and decide a suspension request or an appeal \(Rules 7\.2 and 7\.6\), and save the manager of Draft and Bidding, who, like a commissioner, may pause and resume a Saturday bidding event \(Rule S2\.6\) and may pause and resume the draft, reset its clock, skip a selection and make the selection on the clock \(Rule 2\.8\); until a manager of Draft and Bidding is seated, only a commissioner may\./.test(r.s28.p[0]) &&
    /^A member of league staff may apply for a committee manager seat that is vacant\. The application is decided by a vote of the league staff and the commissioners, the applicant excepted: it is approved once more than half of all league staff and commissioners approve it/.test(r.s28.p[1]) && !/commissioner names/.test(r.s28.p.join(" ")), r.s28.p[1].slice(0, 300));
  A("S2.3: a skipped selection is filled at random after the draft, at its salary, keeping the minimums reachable",
    /filled once the draft ends by a random assignment: a player who registered for the draft and was not selected, drawn at random from those who keep the club able to meet the minimums of Rule S2\.4, and signed at the league minimum salary, \$750,000/.test(r.s23.p[1]), r.s23.p[1]);
  A("S2.2 and 2.6: every staffer and commissioner votes, more than half of all of them, never reviewers",
    /League staff and the commissioners may vote while applications are open;/.test(r.s22.p[1]) &&
    /a nomination goes to a vote of the league staff and the commissioners/.test(r.s26.p[0]) &&
    /An owner, staff, General Manager or Assistant General Manager application is decided by a vote of every member of league staff and every commissioner, each vote counting the same; a member who is banned, or suspended from staff duties, does not vote and is not counted\. The application is approved once more than half of all of them approve it/.test(r.s26.p[0]) &&
    /goes to the vote afresh/.test(r.s26.p[3]) && /without the staff vote/.test(r.s26.p[6]), [r.s22.p[1].slice(0, 200), r.s26.p[0].slice(0, 200)]);
  A("3.2: league staff void a game and review ten forfeits", /league staff or a commissioner void it/.test(r.r32.p[4]) && /refer the club to the league staff for review/.test(r.r32.p[5]), [r.r32.p[4].slice(0, 200), r.r32.p[5].slice(0, 200)]);
  A("9.2: no Media ballot clause; every rostered player and league staff vote", !/Media/.test(r.s92.p[0]) && /^Individual awards are decided by a vote the league office runs among every rostered player and league staff\./.test(r.s92.p[0]), r.s92.p[0].slice(0, 200));
  A("no reviewer, no Media staffer, no thirty-day staff limit and no department anywhere but S2.8's own 'no departments'", !r.rev && !r.media && !r.thirty && r.dept === 0, r);
  await done(p);

  } catch (e) { A("the rulebook section ran to its end", false, e.message); try { await done(p); } catch (e2) { /* already closed */ } }

  console.log("## phones and dark mode");
  L = await live.open(b, BASE, { persona: "manager", hash: "#/desk?tab=committees", w: 375, dark: true });
  A("#/desk?tab=committees (manager) at 375 in dark mode: no sideways scroll", await L.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await L.close();
  /* qa (phone 3): iOS zooms the page into a field under 16px; on a touch phone the desk's ballot reason and the chat box
     read 16px (their 15px font shorthand outranked ui.css's textarea.input) */
  L = await live.open(b, BASE, { persona: "staff", hash: "#/desk/application/staff-sa-1", w: 390 });
  await L.p.waitForSelector("#dkANote", { timeout: 8000 }).catch(() => null);
  r = await L.p.evaluate(() => ["#dkANote", "#dkAMsg"].map((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontSize : null; }));
  A("qa (phone 3): on a touch phone the ballot reason and the chat box are 16px, so iOS never zooms into them", r[0] === "16px" && r[1] === "16px", r);
  await L.close();
  L = await live.open(b, BASE, { persona: "staff", hash: "#/desk?tab=transactions" });
  r = await L.p.evaluate(() => ({ title: document.title, sub: (document.getElementById("dkSub") || {}).textContent || "", draft: !!S2.draftDone(),
    groupFlags: [...document.querySelectorAll("#dkTx table.dk-tx tbody tr")].reduce((n, tr) => n + [...tr.querySelectorAll("td")].slice(0, 3).filter((td) => td.classList.contains("dk-over")).length, 0),
    quiet: document.querySelectorAll("#dkTx td.dk-pre").length, rows: document.querySelectorAll("#dkTx table.dk-tx tbody tr").length }));
  A("qa (visual 19, function 15): before the draft no club's F, D or G count is flagged, the counts read quietly, and the lede names the draft day",
    !r.draft && r.rows > 0 && r.groupFlags === 0 && r.quiet === 3 * r.rows && /Rosters are built at the draft on .+; the minimums apply from the draft \(Rule S2\.4\)\./.test(r.sub) && !/short of a minimum/.test(r.sub), r);
  A("qa (visual 31): a desk pane's window title names the workspace", r.title === "Transactions · Staff Desk · CGHL", r.title);
  await L.p.evaluate(() => { location.hash = "#/desk"; }); await wait(400);
  r = await L.p.evaluate(() => ({ title: document.title, rep: (document.getElementById("dkReports") || {}).textContent || "", at: S2.M.etTime(new Date(S2._desk.LV.at).toISOString()) }));
  A("qa: Today keeps the workspace's own title", r.title === "Staff Desk · CGHL", r.title);
  A("qa (function 28): the Reports band is dated by the desk's own read", r.rep.replace(/\s+/g, " ").indexOf(", " + r.at + " ET.") > 0, r.rep.slice(0, 200));
  await L.close();
  for (const [role, hash] of [["commish", "#/control?tab=staff"], ["manager", "#/bidding"], ["manager", "#/draft"]]) {
    p = await page(hash, { role, w: 375, dark: true, theirs: hash !== "#/control?tab=staff" });
    A(hash + " (" + role + ") at 375 in dark mode: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await done(p);
  }

  /* ================= the LIVE desk (v5.00 swap, g1): the real doors, the database's gates, before and after the flip ================= */
  {
    const lerr = [];
    const txtOf = (p, sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
    const openCase = async (L, id) => { await L.p.click('#dkCaseRows [data-case="' + id + '"]'); await L.p.waitForFunction((i) => document.querySelector('[data-lv-case="' + i + '"]') && !document.querySelector("[data-lv-thread]"), id); await wait(120); };
    const sheetOk = async (p) => { await p.click('.sheet [data-cf="ok"]'); };
    const gone = async (p) => { await p.waitForFunction(() => !document.querySelector(".sheet"), null, { timeout: 8000 }); await wait(150); };

    console.log("## live: a staffer's case queue, read from action_requests (mode " + live.MODE + ")");
    L = await live.open(b, BASE, { persona: "staff", hash: "#/desk?tab=cases" });
    p = L.p;
    const ids = await p.$$eval("#dkCaseRows [data-case]", (l) => l.map((e) => e.dataset.case));
    A("live: the open queue lists the staff cases, never the club's trade request (Rule 2.3)", ids.indexOf("c-complaint-1") >= 0 && ids.indexOf("c-pos-1") >= 0 && ids.indexOf("c-trade-1") < 0 && ids.indexOf("c-closed-1") < 0, ids);
    A("live: no sample mark and no demo door on the live queue", (await p.$$("#dk .chip.sample")).length === 0 && !(await p.$('[data-act="escalate"], [data-act="tomgr"], [data-act="reopen"]')), await p.$$eval("#dk .chip.sample", (l) => l.length));
    A("live: the gates were asked of the database, the flip's door among them", ["rpc:is_commissioner", "rpc:is_staff", "rpc:has_department", "rpc:is_app_reviewer", "rpc:is_any_committee_manager"].every((x) => L.reads().indexOf(x) >= 0), L.reads());
    A("live: before the flip the desk says once, in the console's info, that the Season 2 doors are not there yet", await p.evaluate(() => S2._desk.LV.flip === false));
    await openCase(L, "c-complaint-1");
    A("live: the case shows the filing, the filer and the conversation, the staff-only note marked", /Placeholder details of the filing/.test(await txtOf(p, "#dkCaseDetail")) && /Member A/.test(await txtOf(p, "#dkCaseDetail")) && (await p.$$("#dkLvThread .dk-lv-msg.note")).length === 1);
    A("live: a staffer with the officiating gate sees Claim, Mark in review, Assign, Resolve, Deny and Issue discipline", (await p.$$eval("#dkCaseDetail .dk-toolbar [data-act]", (l) => l.map((e) => e.dataset.act))).join() === "claim,lv-review,assign,resolve,deny,lv-disc",
      await p.$$eval("#dkCaseDetail .dk-toolbar [data-act]", (l) => l.map((e) => e.dataset.act)));

    console.log("## live: claim through assign_case; nothing shows as claimed before the database answers");
    L.delay(700);
    await p.click('#dkCaseDetail [data-act="claim"]');
    await wait(150);
    A("live: while the write is out the button is busy and the case still reads unclaimed", (await p.getAttribute('#dkCaseDetail [data-act="claim"]', "aria-busy")) === "true" && /Nobody yet/.test(await txtOf(p, '#dkCaseDetail [data-swap="claimant"]')));
    await p.waitForFunction(() => /Official One/.test((document.querySelector('#dkCaseDetail [data-swap="claimant"]') || {}).textContent || ""), null, { timeout: 8000 });
    L.delay(120);
    let calls = await L.calls();
    A("live: the claim is assign_case with this staffer's own id", calls.some((c) => c.rpc === "assign_case" && c.args.p_request === "c-complaint-1" && c.args.p_assignee === L.me), calls.map((c) => c.rpc));
    A("live: claimed, the case repainted in place (the list kept its node)", await p.evaluate(() => !!document.querySelector('#dkCaseRows [data-case="c-complaint-1"]') && /Release/.test(document.querySelector('#dkCaseDetail [data-act="claim"]').textContent)));

    await p.click('#dkCaseDetail [data-act="lv-review"]');
    await p.waitForFunction(() => /In review/.test((document.querySelector('#dkCaseDetail [data-swap="status"]') || {}).textContent || ""), null, { timeout: 8000 });
    const rev = (await L.calls()).filter((c) => c.rpc === "action_requests.update").pop();
    A("live: Mark in review is a status update with no statement (not a decision)", rev && rev.args.set.status === "reviewing" && !("response" in rev.args.set) && rev.args.match.id === "c-complaint-1", rev);

    console.log("## live: a reply and a staff-only note (action_messages.insert)");
    await p.fill("#dkLvReply", "Placeholder reply from staff.");
    await p.check("#dkLvInternal");
    await p.click('[data-act="lv-reply"]');
    await p.waitForFunction(() => document.querySelectorAll("#dkLvThread .dk-lv-msg").length === 3, null, { timeout: 8000 });
    calls = await L.calls();
    const msg = calls.filter((c) => c.rpc === "action_messages.insert")[0];
    A("live: the note is one insert on the case, as this staffer, marked internal", msg && msg.args.row.request_id === "c-complaint-1" && msg.args.row.internal === true && msg.args.row.body === "Placeholder reply from staff." && msg.args.row.author_id === L.me, msg);

    console.log("## live: Resolve asks for the final decision statement (Rule 1.4) and keeps it when the database refuses");
    await p.click('#dkCaseDetail [data-act="resolve"]');
    await p.waitForSelector(".sheet #dkStmt");
    await sheetOk(p);
    A("live: a blank statement is refused in the sheet, nothing sent", /final decision statement/.test(await txtOf(p, ".sheet [data-lv-err]")) && !(await L.calls()).some((c) => c.rpc === "action_requests.update" && c.args.set.status === "resolved"));
    await p.fill(".sheet #dkStmt", "Placeholder statement: resolved after review.");
    L.refuse("action_requests.update", "S2_NO_ROWS", "Nothing was saved. The league's rules did not let this change through, or the record has changed. Reload the page and try again.");
    await sheetOk(p);
    await p.waitForFunction(() => /Nothing was saved/.test((document.querySelector(".sheet [data-lv-err]") || {}).textContent || ""), null, { timeout: 8000 });
    A("live: a refusal shows the database's own words and keeps the statement", (await p.inputValue(".sheet #dkStmt")) === "Placeholder statement: resolved after review." && !!(await p.$(".sheet")));
    L.unrefuse("action_requests.update");
    await sheetOk(p); await gone(p);
    calls = await L.calls();
    const upd = calls.filter((c) => c.rpc === "action_requests.update").pop();
    A("live: resolved in one update with the statement, matched on the case", upd && upd.args.set.status === "resolved" && upd.args.set.response === "Placeholder statement: resolved after review." && upd.args.match.id === "c-complaint-1", upd);
    await p.waitForFunction(() => !document.querySelector('#dkCaseRows [data-case="c-complaint-1"]'), null, { timeout: 8000 });
    A("live: the resolved case left the open list in place and the next case opened", !!(await p.$("[data-lv-case]")));

    console.log("## live: the case types that are decided, not closed");
    await openCase(L, "c-pos-1");
    A("live: a position change is approved or denied (decide_position_change), never Resolve", (await p.$$eval("#dkCaseDetail .dk-toolbar [data-act]", (l) => l.map((e) => e.dataset.act + (e.dataset.v ? ":" + e.dataset.v : "")))).join() === "claim,lv-review,assign,lv-pos:approve,lv-pos:deny");
    await p.click('[data-act="lv-pos"][data-v="approve"]'); await p.waitForSelector(".sheet #dkStmt");
    await p.fill(".sheet #dkStmt", "Placeholder: approved."); await sheetOk(p); await gone(p);
    calls = await L.calls();
    A("live: decide_position_change carries the request, the choice and the statement", calls.some((c) => c.rpc === "decide_position_change" && c.args.p_request === "c-pos-1" && c.args.p_approve === true && c.args.p_note === "Placeholder: approved."));
    await openCase(L, "c-ffa-1");
    A("live: a staffer meets no decision on a forfeit appeal, and is told a commissioner decides it", !(await p.$('[data-act="lv-ffa"]')) && /Only a commissioner decides a forfeit appeal/.test(await txtOf(p, "#dkCaseDetail")));
    await openCase(L, "c-mine-1");
    A("live: a case the staffer filed shows no ruling tools and says why (the conflict rule ar_update keeps)", !(await p.$("#dkCaseDetail .dk-toolbar")) && /You filed this case or you are named in it/.test(await txtOf(p, "#dkCaseDetail")) && !!(await p.$("#dkLvReply")));
    await openCase(L, "c-appeal-staff");
    A("live: before the flip an appeal is decided by the department it went to (here officiating)", (await p.$$('#dkCaseDetail [data-act="resolve"]')).length === 1);
    await p.evaluate(() => { location.hash = "#/desk?tab=committees&c=officiating"; }); await p.waitForSelector("#dkFocus");
    A("live: the committee seats come from public.committees", /Official Two/.test(await txtOf(p, '#dkLineup [data-committee="officiating"]')) && /Open: staff apply and vote/.test(await txtOf(p, '#dkLineup [data-committee="community"]')) &&
      !/Case titles are|Guidance notes/.test(await txtOf(p, "#dkFocus")));
    A("live: the sidebar's Games count is the Game desk's own list (S2._gamedesk.waiting)", await p.evaluate(() => +document.querySelector('[data-count-of="games"]').textContent === S2._gamedesk.waiting().length));
    lerr.push.apply(lerr, L.errors); await L.close();

    console.log("## live: after the flip, an appeal by a member of league staff goes to a commissioner (Rule 7.6)");
    L = await live.open(b, BASE, { persona: "manager", flip: true, hash: "#/desk?tab=cases" }); p = L.p;
    A("live: the flip's door answered, so the desk shows the Season 2 flow", await p.evaluate(() => S2._desk.LV.flip === true && S2._desk.may("suspend") === true));
    await openCase(L, "c-appeal-staff");
    A("live: a committee manager meets no decision on a staff member's appeal, and reads why", !(await p.$('#dkCaseDetail [data-act="resolve"]')) && /decided by a commissioner \(Rule 7\.6\)/.test(await txtOf(p, "#dkCaseDetail")));
    lerr.push.apply(lerr, L.errors); await L.close();

    console.log("## live: the commissioner");
    L = await live.open(b, BASE, { persona: "commissioner", flip: true, hash: "#/desk?tab=cases" }); p = L.p;
    await openCase(L, "c-appeal-staff");
    A("live: a commissioner decides a staff member's appeal", (await p.$$('#dkCaseDetail [data-act="resolve"]')).length === 1);
    await openCase(L, "c-ffa-1");
    await p.click('[data-act="lv-ffa"][data-v="deny"]'); await p.waitForSelector(".sheet #dkStmt");
    await p.fill(".sheet #dkStmt", "Placeholder: the forfeit stands."); await sheetOk(p); await gone(p);
    calls = await L.calls();
    A("live: a commissioner decides a forfeit appeal through decide_forfeit_appeal, with the statement", calls.some((c) => c.rpc === "decide_forfeit_appeal" && c.args.p_request === "c-ffa-1" && c.args.p_overturn === false && c.args.p_response === "Placeholder: the forfeit stands."));
    await openCase(L, "c-pos-1");
    /* qa (motion 15): a keyboard open never animates (the desk's rule: keyboard actions never animate); a pointer open grows
       out of its trigger */
    await p.focus('#dkCaseDetail [data-act="assign"]'); await p.keyboard.press("Enter"); await p.waitForSelector('.dk-pop [data-act="assign-to"]');
    r = await p.evaluate(() => ({ anims: document.querySelector(".dk-pop").getAnimations().length, focus: !!document.activeElement.closest(".dk-pop") }));
    A("qa (motion 15): the Assign menu opened from the keyboard does not animate, and lands on the first name", r.anims === 0 && r.focus, r);
    await p.keyboard.press("Escape"); await p.waitForFunction(() => !document.querySelector(".dk-pop"));
    await p.click('#dkCaseDetail [data-act="assign"]'); await p.waitForSelector('.dk-pop [data-act="assign-to"]');
    A("qa (motion 15): opened with the pointer it grows in (one short animation)", await p.evaluate(() => document.querySelector(".dk-pop").getAnimations().length === 1));
    A("live: Assign lists the league's staff (s2_desk), no sample names", (await p.$$eval('.dk-pop [data-act="assign-to"] .grow', (l) => l.map((e) => e.textContent))).join() === "Commissioner One,Official Two,Official Three" && !(await p.$(".dk-pop .chip.sample")));
    await p.click('.dk-pop [data-act="assign-to"][data-name="u-off2"]');
    await p.waitForFunction(() => /Official Two/.test((document.querySelector('#dkCaseDetail [data-swap="claimant"]') || {}).textContent || ""), null, { timeout: 8000 });
    calls = await L.calls();
    A("live: assigning is assign_case to that official's id", calls.some((c) => c.rpc === "assign_case" && c.args.p_request === "c-pos-1" && c.args.p_assignee === "u-off2"));
    await p.evaluate(() => { location.hash = "#/desk"; }); await wait(500);
    /* gaps (2026-11-25): this check pinned the Reports band's "not read live yet", engineering text the review flagged; the
       band now reads s2_desk()'s counts in plain words */
    A("live: Today lists what waits from the live records, with no sample", (await p.$$("#dkAtt .dk-arow")).length >= 2 && (await p.$$("#dk .chip.sample")).length === 0);
    const rep = await txtOf(p, "#dkReports");
    A("gaps: the Reports band reads s2_desk()'s counts in plain words: staff cases without the club's trade request, applications, discipline, imports, the office's actions",
      /2 cases are open, one unclaimed\. The oldest was filed /.test(rep) && /One case answered in all\./.test(rep) && /Waiting on the staff vote: one owner application, one staff application, one front office application\./.test(rep) &&
      /In force now: 2 suspensions counted in games, one season-long suspension\./.test(rep) && /2 warnings are on record\./.test(rep) && /One EA match could not be matched to a league game\./.test(rep) &&
      /3 recorded actions in the last seven days, 9 in the last thirty\./.test(rep), rep);
    A("gaps: and no engineering words in it", !/s2_league|s2_desk|not read live|staff read/.test(rep), rep);
    /* qa (visual 23): Recent activity says an audit key as a sentence-case label, never the key with its underscores */
    const act = await p.$$eval("#dk .dk-act .title", (l) => l.map((e) => e.textContent));
    A("qa: Recent activity titles are sentence-case labels (case_assign reads Case assigned), never a raw audit key", act.length >= 1 && act.every((t) => /^[A-Z]/.test(t) && !/_/.test(t)) && act.indexOf("Case assigned") >= 0, act);
    A("live: In force now counts the running suspensions (s2_desk's running count), never every active row (n)", /In force now: 2 suspensions counted in games, one season-long suspension\./.test(await txtOf(p, "#dkDiscCard")), await txtOf(p, "#dkDiscCard"));
    A("live: after the flip, Today holds the suspension requests waiting on a decision", (await p.$$("#dkDiscWait [data-wait]")).length === 1 && (await p.$$('#dkDiscWait [data-lv-req="approve"]')).length === 1);
    console.log("## live: the front page switches are feature_flags rows; the Transactions pane offers no trade action it cannot take");
    await p.evaluate(() => { location.hash = "#/desk?tab=newsroom"; }); await p.waitForSelector('[data-act="front"][data-k="recap"]');
    const sw = '[data-act="front"][data-k="recap"]', before = await p.getAttribute(sw, "aria-checked");
    L.delay(600);
    await p.click(sw); await wait(150);
    A("live: while the write is out the switch is busy and has not moved", (await p.getAttribute(sw, "aria-busy")) === "true" && (await p.getAttribute(sw, "aria-checked")) === before, before);
    await p.waitForFunction((s) => !document.querySelector(s).hasAttribute("aria-busy"), sw, { timeout: 8000 });
    L.delay(120);
    let ff = (await L.calls()).filter((c) => c.rpc === "feature_flags.upsert").pop();
    A("live: the switch is one feature_flags upsert on home_recap, the current site's homepage door, keyed on key", ff && ff.args.row.key === "home_recap" && ff.args.row.enabled === (before !== "true") && ff.args.onConflict === "key" && ff.args.select === "key", ff);
    A("live: the switch moves once the database has it", (await p.getAttribute(sw, "aria-checked")) === String(before !== "true"));
    L.refuse("feature_flags.upsert", "42501", "new row violates row-level security policy for table \"feature_flags\"");
    const mid = await p.getAttribute(sw, "aria-checked");
    await p.click(sw);
    await p.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => /front page did not change/.test(t.textContent)), null, { timeout: 8000 });
    A("live: a refused switch stays where it was and says the database's words", (await p.getAttribute(sw, "aria-checked")) === mid && !(await p.getAttribute(sw, "aria-busy")));
    L.unrefuse("feature_flags.upsert");
    A("live: the newsroom lists no session stories (they were the demo's)", !(await p.$("#dkStories")));
    await p.evaluate(() => { location.hash = "#/desk?tab=transactions"; }); await p.waitForSelector("#dkTx");
    /* gaps (2026-11-25): this check pinned "no trade action" while the desk had no door for reversing or resending; the
       classic Transactions desk's Trades on the table and Trade history with Reverse and Resend are ported now (the
       commissioner, 2026-11-25: every tool works natively on the new site before the switch) */
    A("live: the Transactions pane says where trades are made and keeps the roster table", /Trade Hub/.test(await txtOf(p, "#dkTx")) && !!(await p.$("#dkTx table.dk-tx")));
    await p.waitForSelector("#dkTrades .dk-trow", { timeout: 8000 }).catch(() => null);
    A("gaps: the commissioner reads the season's trades: the open offer on the table, Reverse on the completed trade, Resend on the declined one",
      (await p.$$("#dkTrades .dk-trow")).length === 3 && (await p.$$('#dkTrades [data-act="tx-reverse"][data-id$="a2"]')).length === 1 && (await p.$$('#dkTrades [data-act="tx-resend"][data-id$="a3"]')).length === 1 &&
      (await p.$$('#dkTrades [data-act^="tx-"][data-id$="a1"]')).length === 0 && L.reads().indexOf("from:trades") >= 0, await txtOf(p, "#dkTrades"));
    await p.click('#dkTrades [data-act="tx-reverse"]'); await p.waitForSelector(".sheet #rvWhy");
    await p.fill(".sheet #rvWhy", "short"); await sheetOk(p); await wait(150);
    A("gaps: a reason under ten characters is refused in the sheet before anything is sent", /at least ten characters/.test(await txtOf(p, ".sheet [data-rv-err]")) && !(await L.calls()).some((c) => c.rpc === "reverse_trade"));
    await p.fill(".sheet #rvWhy", "Placeholder: a lopsided deal between allied clubs."); await sheetOk(p); await gone(p);
    let tc = (await L.calls()).filter((c) => c.rpc === "reverse_trade");
    A("gaps: Reverse is reverse_trade with the trade's id and the reason as typed", tc.length === 1 && tc[0].args.p_trade === "00000000-0000-4000-8000-0000000000a2" && tc[0].args.p_reason === "Placeholder: a lopsided deal between allied clubs.", tc);
    await p.waitForFunction(() => !document.querySelector('#dkTrades [data-act="tx-reverse"]'), null, { timeout: 8000 }).catch(() => null);
    A("gaps: the ledger reads the trades again and repaints in place: the trade reads Reversed", /Reversed/.test(await txtOf(p, "#dkTrades")) && !(await p.$('#dkTrades [data-act="tx-reverse"]')) && !!(await p.$("#dkTx table.dk-tx")));
    await p.click('#dkTrades [data-act="tx-resend"]'); await p.waitForSelector('.sheet [data-cf="ok"]'); await sheetOk(p); await gone(p);
    tc = (await L.calls()).filter((c) => c.rpc === "resend_trade");
    A("gaps: Resend is resend_trade with the offer's id", tc.length === 1 && tc[0].args.p_trade === "00000000-0000-4000-8000-0000000000a3", tc);
    lerr.push.apply(lerr, L.errors); await L.close();

    /* gaps (2026-11-25): "Apply for an open seat" said it was not connected; it files through apply_committee_seat (v4.59)
       and the applicant may withdraw it (withdraw_committee_application), each confirmed by the door's own status */
    console.log("## gaps: a staffer applies for an open committee seat, and may withdraw the application");
    L = await live.open(b, BASE, { persona: "staff", hash: "#/desk?tab=committees", allow: /^S2\.flow: committee was refused/ }); p = L.p;   /* the flow logs the refusal it is asked to show */
    const shTxt = () => p.evaluate(() => { const s = [...document.querySelectorAll(".sheet")].pop(); return s ? s.textContent.replace(/\s+/g, " ") : ""; });
    await p.click('[data-flow="committee"]'); await p.waitForSelector(".sheet #flseat");
    const seatOpts = await p.$$eval(".sheet #flseat option", (l) => l.map((o) => o.value + "|" + o.textContent));
    A("gaps: the seat list names each holder or says the seat is open, from the desk's read of public.committees",
      seatOpts.indexOf("officiating|Officiating, managed by Official Two") >= 0 && seatOpts.indexOf("statistics|Statistics and imports, open") >= 0, seatOpts);
    A("gaps: the form is connected to the league", !/not connected/.test(await shTxt()));
    await p.selectOption(".sheet #flseat", "officiating"); await wait(200);
    A("gaps: a held seat is said first, in the door's own words", /The Officiating committee already has a manager\. A seat is applied for only while it is open\./.test(await shTxt()));
    await p.selectOption(".sheet #flseat", "statistics"); await p.fill(".sheet #flwhy", "Placeholder: the imports first.");
    await p.click('.sheet .fl-form button[type="submit"]'); await p.waitForSelector(".sheet [data-send]");
    L.refuse("apply_committee_seat", "P0001", "COMMITTEE: You already applied for this seat. Withdraw that application to file a new one.");
    await p.click(".sheet [data-send]"); await p.waitForSelector(".sheet .fl-senderr", { timeout: 8000 });
    A("gaps: a refusal shows the door's sentence without its machine prefix, and nothing reads as filed",
      (await txtOf(p, ".sheet .fl-senderr")) === "You already applied for this seat. Withdraw that application to file a new one." && !(await p.$(".sheet .fl-done")));
    L.unrefuse("apply_committee_seat");
    await p.click(".sheet [data-send]"); await p.waitForSelector(".sheet .fl-done", { timeout: 8000 });
    let cs = (await L.calls()).filter((c) => c.rpc === "apply_committee_seat");
    A("gaps: Apply is apply_committee_seat with the seat's key and the pitch as typed", cs.length === 2 && cs[1].args.p_committee === "statistics" && cs[1].args.p_pitch === "Placeholder: the imports first." && /Application filed/.test(await shTxt()), cs.map((c) => c.args));
    await p.click(".sheet [data-cancel]"); await gone(p);
    await p.waitForFunction(() => S2._desk.LV.apps.some((a) => a.uuid === "ca-new"), null, { timeout: 8000 }).catch(() => null);
    A("gaps: the desk reads the applications again once it is filed", await p.evaluate(() => S2._desk.LV.apps.some((a) => a.uuid === "ca-new" && a.type === "committee")));
    await p.evaluate(() => { location.hash = "#/desk/application/committee-ca-new"; }); await p.waitForSelector('[data-act="a-withdraw"]', { timeout: 8000 });
    await p.click('[data-act="a-withdraw"]'); await p.waitForSelector('.sheet [data-cf="ok"]'); await sheetOk(p); await gone(p);
    cs = (await L.calls()).filter((c) => c.rpc === "withdraw_committee_application");
    A("gaps: the applicant withdraws it through withdraw_committee_application", cs.length === 1 && cs[0].args.p_app === "ca-new", cs);
    await p.evaluate(() => { location.hash = "#/desk?tab=transactions"; }); await p.waitForSelector("#dkTrades");
    A("gaps: before the flip a staffer outside the transactions department is told trades are not shown to them, and none is read (never an empty ledger)",
      /transactions staff and the commissioners only/.test(await txtOf(p, "#dkTrades")) && L.reads().indexOf("from:trades") < 0 && !(await p.$("#dkTrades .dk-trow")));
    lerr.push.apply(lerr, L.errors); await L.close();

    console.log("## live: a member (the one who files a case) reaches no staff tools");
    L = await live.open(b, BASE, { persona: "member", locked: true, hash: "#/desk?tab=cases" }); p = L.p;
    A("live: a member meets the staff-only page, and no case list is read", /for the league's staff/.test(await txtOf(p, "#page")) && !(await p.$("#dkCaseRows")) && L.reads().indexOf("from:action_requests") < 0);
    lerr.push.apply(lerr, L.errors); await L.close();
    A("live: no console errors in the live desk", lerr.length === 0, lerr.slice(0, 5));
  }

  A("no console errors", errors.length === 0, errors.slice(0, 5));
  await b.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
