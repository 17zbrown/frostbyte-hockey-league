const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* Season 2 discipline on the site: node tools/ui/run.cjs --suite discipline --mode live. Commissioner's rulings,
   2026-11-23: only committee managers or commissioners issue a suspension; a manager issues up to 14 days, or up to 18
   games for a rostered player in steps of three; anything longer is applied for and a commissioner approves it; other
   staff may file a suspension request for a manager or a commissioner to act on; bans stay a commissioner's. The live
   split stays (games for a rostered member, a date for a member with no roster spot).
   i3d (2026-11-25): every page is the real site (the harness's live mode: tools/ui/mock with live: true); the Staff Desk
   opens on the league office tools/ui/desklive.cjs keeps, and every discipline tool is the database's door, before and
   after the Season 2 staffing flip. The concept's in-page discipline model and form (S2.discipline over S2.demo's
   filings, the sample answers, the role switcher, the carry between tabs) are gone with demo mode, and so are the
   checks that pinned them (listed in the commit). The rulebook section is stream flipbook's. Nothing here writes to the
   league. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const live = require("./desklive.cjs");
const BASE = S2_BASE;
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* who reads each page: the harness's personas, a committee manager being a staffer with a seat */
const ROLE = { guest: ["anon"], player: ["member"], staff: ["staff"], manager: ["staff", { committees: ["officiating"] }], commish: ["commissioner"] };

(async () => {
  const b = await chromium.launch();
  const errors = [];
  async function page(hash, o) {
    o = o || {};
    const ctx = await b.newContext(Object.assign(o.w ? { viewport: { width: o.w, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } }, o.dark ? { colorScheme: "dark" } : {}));
    const as = ROLE[o.role || "staff"];
    await mock.install(ctx, { live: true, persona: as[0], session: as[1], rpcs: { season_survey_done: mock.ok(true) } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    /* the browser logs every non-2xx answer as "Failed to load resource"; what the page itself says is what counts */
    p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.LIVE && S2.M && document.querySelector("#app section, #app header"));
    await wait(450);
    return p;
  }
  const done = (p) => p.context().close();
  let p, r;

  /* v5.00 swap, the staffing flip (2026-11-25): #/rulebook renders the ONE live book (S2.RB, js/rulebook.js, built from
     src/live with the flip's amendment spliced in), so these checks pin the switched Rules 7.2 and 7.7 as the page shows
     them. The concept's "proposed November 23" marks (.lg-rb-p.prop, the note) are gone with its abridged copy: the page
     has no proposal machinery, so that check was deleted. Where the live wording differs from the concept's copy (a
     commissioner may also impose a longer suspension directly; paragraph 7's transitional departure suspension stays
     the one exception), the live wording is the rule. */
  try {   /* i3d: the rulebook section is flipbook's (it is rewriting it for the switched book); a throw in it is a FAIL, not the end of this suite */
  console.log("## the rulebook: Rules 7.2 and 7.7");
  p = await page("#/rulebook?rule=7.2", { role: "guest" });
  r = await p.evaluate(() => {
    const s = (id) => { const e = document.getElementById("rb-" + id); return { p: [...e.querySelectorAll(".lg-rb-p")].map((x) => x.textContent.slice(1)) }; };
    return { r72: s("7.2"), r77: s("7.7"), ch: !!document.getElementById("rbc-7"), body: document.getElementById("rbBody").textContent };
  });
  A("Chapter 7 is in the edition with 7.2 and 7.7", r.ch && r.r72.p.length === 7 && r.r77.p.length === 4, [r.r72.p.length, r.r77.p.length]);
  A("7.2: warnings by any staffer, suspensions by a manager or a commissioner, 18 games or 14 days, longer approved, requests, expulsion a commissioner's",
    /Any member of league staff may issue a formal warning\. Only a committee manager \(Rule S2\.8\) or a commissioner may issue a suspension\. A committee manager suspends a rostered member for a number of games in steps of three \(3\), from three \(3\) to eighteen \(18\) games, and a member who holds no roster spot to a date no more than fourteen \(14\) days from the start of the suspension\./.test(r.r72.p[0]) &&
    /An expulsion, and any sanction against a commissioner or a member of league staff, are imposed only by a commissioner\. A member of league staff who is not a committee manager and believes a case warrants a suspension files a suspension request stating its grounds\./.test(r.r72.p[0]) &&
    /only a commissioner decides a request beyond those limits or one about a commissioner or a member of league staff\. An approved request imposes exactly the suspension approved, and a request is denied only with a reason/.test(r.r72.p[0]), r.r72.p[0].slice(0, 400));
  A("7.2: anything longer, and the rest of a season, only a commissioner imposes or approves (the departure suspension of paragraph 7 aside)", /A longer suspension, and any suspension for the remainder of a season other than under paragraph 7 of this rule, is imposed by a commissioner, or is applied for by a suspension request and takes effect only when a commissioner approves it\./.test(r.r72.p[0]) && /^No member is suspended for leaving the league Discord\./.test(r.r72.p[6]), r.r72.p[0].slice(0, 300));
  A("7.2: a manager's second suspension in a season stays within the limits or goes to a commissioner as a request", /A committee manager imposing a second suspension in a season must set its length within the limits of paragraph 1 of this rule, or file a suspension request for the remainder of the season, which only a commissioner may approve; a commissioner's second suspension runs for the remainder of the season unless the commissioner sets a shorter length\./.test(r.r72.p[3]), r.r72.p[3].slice(0, 300));
  A("7.7: a longer or season-long suspension under it is approved the same way", /A longer suspension, and any suspension for the remainder of a season, takes effect only when a commissioner approves it \(Rule 7\.2\)/.test(r.r77.p[1]), r.r77.p[1].slice(0, 300));
  A("7.2's extensions follow the same limits, in the suspension's own terms", /extending it, in the suspension's own terms: games added in steps of three \(3\) to a suspension counted in games, or a later last day for a suspension to a date\. A committee manager may extend a suspension to a total of eighteen \(18\) games, or to a last day no more than fourteen \(14\) days from the day the suspension was issued; an extension past those limits is made only by a commissioner\./.test(r.r72.p[3]), r.r72.p[3].slice(0, 300));
  A("7.2: a request against a member already serving is an extension request, with a written reason", /A suspension request filed against a member who is serving a suspension is a request to extend it: it states in writing why the suspension should be extended, the member is told that reason, and its approval extends the running suspension by exactly the games or days approved\. A committee manager may approve such a request only within those limits; past them, only a commissioner may\./.test(r.r72.p[3]), r.r72.p[3].slice(0, 300));
  A("7.7: league staff rule on conduct in league spaces, suspending as 7.2 provides, with the same limits", /is ruled on by the league staff \(Rule 7\.1\)/.test(r.r77.p[0]) && /A suspension under this rule is imposed as Rule 7\.2 provides: a committee manager suspends a rostered member for three \(3\) to eighteen \(18\) games in steps of three \(3\), and a member who holds no roster spot to a date no more than fourteen \(14\) days from the start of the suspension\./.test(r.r77.p[1]), r.r77.p[1].slice(0, 300));
  A("no thirty-day staff limit, no department, no ten-game cap anywhere in the book", !/thirty \(30\) days|department role|officiating department|community department|up to 10 games/.test(r.body) && (r.body.match(/department/gi) || []).length === 1 && /with no departments/.test(r.body));
  await done(p);

  } catch (e) { A("the rulebook section ran to its end", false, e.message); try { await done(p); } catch (e2) { /* already closed */ } }

  console.log("## phones and dark mode");
  {
    const L = await live.open(b, BASE, { persona: "manager", hash: "#/desk", w: 375, dark: true });
    A("#/desk at 375 in dark mode: no sideways scroll", await L.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await L.close();
    p = await page("#/rulebook?rule=7.2", { role: "manager", w: 375, dark: true });
    A("#/rulebook?rule=7.2 at 375 in dark mode: no sideways scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await done(p);
  }

  /* ================= the LIVE discipline tools (v5.00 swap, g1): the real doors, before and after the staffing flip ================= */
  {
    const lerr = [];
    const T = (p, sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
    const record = async (L) => {
      const id = L.subject;
      await L.p.evaluate((i) => { location.hash = "#/desk/person/" + i; }, id);
      await L.p.waitForSelector(".sheet #dkPsTabs"); await L.p.click('.sheet #dkPsTabs [data-v="discipline"]');
      await L.p.waitForFunction(() => { const b = document.querySelector(".sheet [data-lv-rec]"); return b && !/Loading the record/.test(b.textContent); }, null, { timeout: 8000 });
      await wait(120); return id;
    };
    const ok = (p) => p.click('.sheet [data-cf="ok"]');
    const closed = async (p) => { await p.waitForFunction(() => !document.querySelector(".sheet"), null, { timeout: 8000 }); await wait(200); };
    const lastCall = async (L, rpc) => (await L.calls()).filter((c) => c.rpc === rpc).pop() || null;

    console.log("## live: a staffer with the officiating gate, before the flip (mode " + live.MODE + ")");
    let L = await live.open(b, BASE, { persona: "staff", subject: "rostered", hash: "#/desk?tab=people" }), p = L.p;
    let sid = await record(L);
    const acts = await p.$$eval(".sheet [data-lv-tool]", (l) => l.map((e) => e.dataset.lvTool + (e.dataset.id ? ":" + e.dataset.id : "")));
    A("live: the record lists what is on file, the running suspension with Extend and Lift, the warning with Withdraw", acts.indexOf("extend:sr-run") >= 0 && acts.indexOf("lift:sr-run") >= 0 && acts.indexOf("lift:sr-warn") >= 0, acts);
    A("live: a member serving a suspension is extended, never suspended twice (one at a time, Rule 7.2)", acts.indexOf("games") < 0 && acts.indexOf("date") < 0 && /serving a suspension now/.test(await T(p, ".sheet [data-lv-rec]")));
    A("live: a staffer meets Warn and no Ban (bans are a commissioner's)", acts.indexOf("warn") >= 0 && acts.indexOf("ban") < 0);
    await p.click('.sheet [data-lv-tool="warn"]'); await p.waitForSelector(".sheet #dkLvWhy");
    await p.fill(".sheet #dkLvWhy", "Placeholder grounds for a warning.");
    L.refuse("suspend_player", "P0001", "Only a commissioner, the officiating department or the community department can discipline members.");
    await ok(p);
    await p.waitForFunction(() => /community department can discipline/.test((document.querySelector(".sheet [data-lv-err]") || {}).textContent || ""), null, { timeout: 8000 });
    A("live: a refused warning shows the database's own words and keeps the grounds", (await p.inputValue(".sheet #dkLvWhy")) === "Placeholder grounds for a warning.");
    L.unrefuse("suspend_player");
    await ok(p); await closed(p);
    let c = await lastCall(L, "suspend_player");
    A("live: a warning is suspend_player with mode warning, the member and the grounds", c && c.args.p_mode === "warning" && c.args.p_profile === sid && c.args.p_reason === "Placeholder grounds for a warning." && c.args.p_games === null, c);
    sid = await record(L);
    await p.click('.sheet [data-lv-tool="extend"][data-id="sr-run"]'); await p.waitForSelector(".sheet #dkLvGames");
    A("live: Extend asks for games to add, in steps of three, in the suspension's own terms", /Games to add/.test(await T(p, ".sheet .dk-lv-form")) && !(await p.$(".sheet #dkLvDate")));
    await p.fill(".sheet #dkLvGames", "3"); await p.fill(".sheet #dkLvWhy", "Placeholder: a second incident.");
    await ok(p); await closed(p);
    c = await lastCall(L, "extend_suspension");
    A("live: the extension is extend_suspension on that suspension, games added", c && c.args.p_id === "sr-run" && c.args.p_games === 3 && c.args.p_days === null, c);
    sid = await record(L);
    await p.click('.sheet [data-lv-tool="lift"][data-id="sr-run"]'); await p.waitForSelector('.sheet [data-cf="ok"]');
    await ok(p); await closed(p);
    c = await lastCall(L, "lift_suspension");
    A("live: Lift is lift_suspension on that row", c && c.args.p_id === "sr-run", c);
    lerr.push.apply(lerr, L.errors); await L.close();

    console.log("## live: a member with no roster spot is suspended to a date");
    L = await live.open(b, BASE, { persona: "staff", subject: "free", hash: "#/desk?tab=people" }); p = L.p;
    L.db.suspension_record = L.db.suspension_record.filter((r) => r.id !== "sr-run");
    sid = await record(L);
    A("live: the tool is Suspend until a date (the live split: games for a rostered member, a date otherwise)", !!(await p.$('.sheet [data-lv-tool="date"]')) && !(await p.$('.sheet [data-lv-tool="games"]')));
    await p.click('.sheet [data-lv-tool="date"]'); await p.waitForSelector(".sheet #dkLvDate");
    await ok(p);
    A("live: no last day is said, nothing sent", /Pick the last day/.test(await T(p, ".sheet [data-lv-err]")) && !(await lastCall(L, "suspend_player")));
    await p.fill(".sheet #dkLvDate", "2026-12-20"); await p.fill(".sheet #dkLvWhy", "Placeholder date grounds.");
    A("live: the keep-length choice is offered for a second suspension in a season (Rule 7.2)", !!(await p.$(".sheet #dkLvKeep")));
    await ok(p); await closed(p);
    c = await lastCall(L, "suspend_player");
    A("live: suspend_player to a date ends 11:59 PM ET that day, keep-length as chosen", c && c.args.p_mode === "date" && /^2026-12-21T04:59:00/.test(c.args.p_ends_at) && c.args.p_keep_length === false, c);
    lerr.push.apply(lerr, L.errors); await L.close();

    console.log("## live: after the flip, a staffer who manages no committee requests (request_suspension)");
    L = await live.open(b, BASE, { persona: "staff", flip: true, subject: "rostered", hash: "#/desk?tab=people" }); p = L.p;
    sid = await record(L);
    const a2 = await p.$$eval(".sheet [data-lv-tool]", (l) => l.map((e) => e.dataset.lvTool + (e.dataset.id ? ":" + e.dataset.id : "")));
    A("live: no Lift and no Extend on a running suspension, a Request an extension instead; a warning they gave they may withdraw", a2.indexOf("lift:sr-run") < 0 && a2.indexOf("extend:sr-run") < 0 && a2.indexOf("extend-request:sr-run") >= 0 && a2.indexOf("lift:sr-warn") >= 0, a2);
    await p.click('.sheet [data-lv-tool="extend-request"]'); await p.waitForSelector(".sheet #dkLvGames");
    await ok(p);
    A("live: an extension request needs a written reason, and nothing is sent without one", /Write the grounds/.test(await T(p, ".sheet [data-lv-err]")) && !(await lastCall(L, "request_suspension")));
    await p.fill(".sheet #dkLvGames", "3"); await p.fill(".sheet #dkLvWhy", "Placeholder: missed the next game too.");
    await ok(p); await closed(p);
    c = await lastCall(L, "request_suspension");
    A("live: the extension request is request_suspension in the suspension's own terms (games to add)", c && c.args.p_profile === sid && c.args.p_mode === "games" && c.args.p_games === 3 && c.args.p_reason === "Placeholder: missed the next game too.", c);
    A("live: the answer's extends field names it an extension request", await p.evaluate(() => [...document.querySelectorAll(".toast")].some((t) => /Extension request filed/.test(t.textContent))));
    L.db.suspension_record = L.db.suspension_record.filter((r) => r.id !== "sr-run"); await p.evaluate((s) => { delete S2._desk.LV.rec[s]; }, L.subject);
    sid = await record(L);
    await p.click('.sheet [data-lv-tool="request"]'); await p.waitForSelector(".sheet #dkLvMode");
    await p.selectOption(".sheet #dkLvMode", "games"); await p.fill(".sheet #dkLvGames", "6"); await p.fill(".sheet #dkLvWhy", "Placeholder request grounds.");
    await ok(p); await closed(p);
    c = await lastCall(L, "request_suspension");
    A("live: a new request carries its own terms, in steps of three", c && c.args.p_mode === "games" && c.args.p_games === 6, c);
    await p.evaluate(() => { location.hash = "#/desk?tab=cases&case=c-complaint-1"; }); await p.waitForSelector('[data-lv-case="c-complaint-1"]');
    A("live: on a complaint a staffer who manages no committee may warn or request a suspension", !!(await p.$('[data-act="lv-disc"]')) && !!(await p.$('[data-act="lv-disc-req"]')));
    await p.click('[data-act="lv-disc-req"]'); await p.waitForSelector(".sheet #dkLvMode");
    await p.selectOption(".sheet #dkLvMode", "games"); await p.fill(".sheet #dkLvGames", "3"); await p.fill(".sheet #dkLvWhy", "Placeholder grounds from the case.");
    await ok(p); await closed(p);
    c = await lastCall(L, "request_suspension");
    A("live: a request from a case names the case and the member it is about", c && c.args.p_case === "c-complaint-1" && c.args.p_profile === "u-memb" && c.args.p_games === 3, c);
    lerr.push.apply(lerr, L.errors); await L.close();

    console.log("## live: after the flip, a committee manager: the keep-length choice and the requests");
    L = await live.open(b, BASE, { persona: "manager", flip: true, subject: "free", hash: "#/desk?tab=people" }); p = L.p;
    L.db.suspension_record = L.db.suspension_record.filter((r) => r.id !== "sr-run");
    sid = await record(L);
    await p.click('.sheet [data-lv-tool="date"]'); await p.waitForSelector(".sheet #dkLvDate");
    A("live: a manager's form keeps the length set by default", await p.isChecked(".sheet #dkLvKeep"));
    await p.uncheck(".sheet #dkLvKeep"); await p.fill(".sheet #dkLvDate", "2026-12-18"); await p.fill(".sheet #dkLvWhy", "Placeholder second suspension.");
    L.refuse("suspend_player", "P0001", "Member S was already suspended this season, so a second suspension runs for the rest of the season unless the official sets a shorter length (Rule 7.2). Keep the length you set, up to 14 days or 18 games, or file a suspension request for the rest of the season and a commissioner decides it.");
    await ok(p);
    await p.waitForSelector(".sheet [data-lv-apply]", { timeout: 8000 });
    A("live: the database's second-suspension refusal offers the ruled way out: ask a commissioner for the rest of the season", /already suspended this season/.test(await T(p, ".sheet [data-lv-err]")));
    L.unrefuse("suspend_player");
    /* qa (nits 19): two requests a committee manager may not decide (decide_suspension_request in the staff powers record):
       one about a member of league staff, and one past the manager's ceiling of 18 games; the re-read after the request
       below brings them onto the waiting list */
    L.db.suspension_requests.push({ id: "rq-staff", profile_id: "u-off3", mode: "games", games: 3, filed_by: "u-off2", status: "pending", created_at: L.db.iso(2), reason: "Placeholder request about staff.", member: L.db.P("Official Three", "staff"), filer: L.db.P("Official Two", "staff") },
      { id: "rq-long", profile_id: "u-memh", mode: "games", games: 21, filed_by: "u-off2", status: "pending", created_at: L.db.iso(1), reason: "Placeholder long request.", member: L.db.P("Member H"), filer: L.db.P("Official Two", "staff") });
    await p.click(".sheet [data-lv-apply]"); await closed(p);
    c = await lastCall(L, "request_suspension");
    A("live: that request is request_suspension through the season on screen", c && c.args.p_mode === "seasons" && c.args.p_until_season === (await p.evaluate(() => S2.M.view.season)) && c.args.p_profile === sid, c);
    await p.evaluate(() => { location.hash = "#/desk"; }); await p.waitForSelector("#dkDiscWait");
    await p.waitForSelector('#dkDiscWait [data-wait="rq-long"]', { timeout: 8000 }).catch(() => null);
    A("qa: a manager is offered no decision on a request about league staff or past 14 days or 18 games (a commissioner decides those)",
      !!(await p.$('#dkDiscWait [data-wait="rq-staff"]')) && !!(await p.$('#dkDiscWait [data-wait="rq-long"]')) &&
      !(await p.$('#dkDiscWait [data-wait="rq-staff"] [data-lv-req="approve"], #dkDiscWait [data-wait="rq-staff"] [data-lv-req="deny"]')) &&
      !(await p.$('#dkDiscWait [data-wait="rq-long"] [data-lv-req="approve"], #dkDiscWait [data-wait="rq-long"] [data-lv-req="deny"]')));
    A("live: a manager may decide a request filed by someone else, and only withdraw the one they filed", !!(await p.$('#dkDiscWait [data-wait="rq-1"] [data-lv-req="approve"]')) && !(await p.$('#dkDiscWait [data-wait="rq-2"] [data-lv-req="approve"]')) && !!(await p.$('#dkDiscWait [data-wait="rq-2"] [data-lv-req="withdraw"]')));
    await p.click('#dkDiscWait [data-wait="rq-1"] [data-lv-req="deny"]'); await p.waitForSelector(".sheet #dkLvNote");
    await ok(p);
    A("live: a denial needs its reason before anything is sent", /Say why it is denied/.test(await T(p, ".sheet [data-lv-err]")) && !(await lastCall(L, "decide_suspension_request")));
    await p.click('.sheet [data-cf="no"]'); await closed(p);
    await p.click('#dkDiscWait [data-wait="rq-1"] [data-lv-req="approve"]'); await p.waitForSelector('.sheet [data-cf="ok"]');
    await ok(p); await closed(p);
    c = await lastCall(L, "decide_suspension_request");
    A("live: approving is decide_suspension_request on that request", c && c.args.p_id === "rq-1" && c.args.p_approve === true, c);
    await p.waitForFunction(() => !document.querySelector('#dkDiscWait [data-wait="rq-1"]'), null, { timeout: 8000 });
    A("live: the decided request leaves the waiting list in place", !!(await p.$('#dkDiscWait [data-wait="rq-2"]')));
    lerr.push.apply(lerr, L.errors); await L.close();

    console.log("## live: after the flip, a committee manager over their limits applies for it (Rule 7.2: anything longer is applied for)");
    L = await live.open(b, BASE, { persona: "manager", flip: true, subject: "rostered", hash: "#/desk?tab=people" }); p = L.p;
    sid = await record(L);
    const a3 = await p.$$eval(".sheet [data-lv-tool]", (l) => l.map((e) => e.dataset.lvTool + (e.dataset.id ? ":" + e.dataset.id : "")));
    A("live: on a running suspension a manager has Extend inside the limits and Request an extension past them", a3.indexOf("extend:sr-run") >= 0 && a3.indexOf("extend-request:sr-run") >= 0 && a3.indexOf("lift:sr-run") >= 0, a3);
    await p.click('.sheet [data-lv-tool="extend"][data-id="sr-run"]'); await p.waitForSelector(".sheet #dkLvGames");
    await p.fill(".sheet #dkLvGames", "15"); await p.fill(".sheet #dkLvWhy", "Placeholder: a long extension.");
    L.refuse("extend_suspension", "P0001", "A committee manager extends in steps of three games, to a total of 18 at most. Anything longer is applied for: file a suspension request to extend it, and a commissioner approves it (Rule 7.2).");
    await ok(p);
    await p.waitForSelector(".sheet [data-lv-apply]", { timeout: 8000 });
    A("live: the extension refusal offers to apply for the same extension", /Anything longer is applied for/.test(await T(p, ".sheet [data-lv-err]")) && (await T(p, ".sheet [data-lv-apply]")) === "Apply for this extension");
    L.unrefuse("extend_suspension");
    await p.click(".sheet [data-lv-apply]"); await closed(p);
    c = await lastCall(L, "request_suspension");
    A("live: applying files request_suspension in the suspension's own terms, with the grounds written", c && c.args.p_profile === sid && c.args.p_mode === "games" && c.args.p_games === 15 && c.args.p_reason === "Placeholder: a long extension.", c);
    L.db.suspension_record = L.db.suspension_record.filter((r) => r.id !== "sr-run"); await p.evaluate((s) => { delete S2._desk.LV.rec[s]; }, L.subject);
    sid = await record(L);
    const a4 = await p.$$eval(".sheet [data-lv-tool]", (l) => l.map((e) => e.dataset.lvTool));
    A("live: with nothing running a manager may suspend for games and also request a suspension, never a season on their own", a4.indexOf("games") >= 0 && a4.indexOf("request") >= 0 && a4.indexOf("seasons") < 0 && a4.indexOf("ban") < 0, a4);
    await p.click('.sheet [data-lv-tool="games"]'); await p.waitForSelector(".sheet #dkLvGames");
    await p.fill(".sheet #dkLvGames", "21"); await p.fill(".sheet #dkLvWhy", "Placeholder: past the limit.");
    L.refuse("suspend_player", "P0001", "A committee manager issues suspensions in steps of three games, up to 18 (3, 6, 9, 12, 15 or 18). Anything longer is applied for: file a suspension request and a commissioner approves it. A ban is a commissioner ruling (Rule 7.2).");
    await ok(p);
    await p.waitForSelector(".sheet [data-lv-apply]", { timeout: 8000 });
    A("live: a 21-game suspension is refused and the same terms are offered as a request", (await T(p, ".sheet [data-lv-apply]")) === "Apply for these terms" && (await p.inputValue(".sheet #dkLvWhy")) === "Placeholder: past the limit.");
    L.unrefuse("suspend_player");
    await p.click(".sheet [data-lv-apply]"); await closed(p);
    c = await lastCall(L, "request_suspension");
    A("live: that request carries the 21 games and the grounds", c && c.args.p_profile === sid && c.args.p_mode === "games" && c.args.p_games === 21 && c.args.p_reason === "Placeholder: past the limit.", c);
    sid = await record(L);
    await p.click('.sheet [data-lv-tool="request"]'); await p.waitForSelector(".sheet #dkLvMode");
    A("live: a manager's request form explains a commissioner approves it and offers a season-long suspension", /a commissioner approves it/.test(await T(p, ".sheet")) && (await p.$$eval(".sheet #dkLvMode option", (l) => l.map((o) => o.value))).indexOf("seasons") >= 0);
    await p.selectOption(".sheet #dkLvMode", "seasons"); await p.fill(".sheet #dkLvWhy", "Placeholder: the rest of the season.");
    await ok(p); await closed(p);
    c = await lastCall(L, "request_suspension");
    A("live: a season-long request names the final season", c && c.args.p_mode === "seasons" && c.args.p_until_season === (await p.evaluate(() => +S2.M.view.season)) && c.args.p_profile === sid, c);
    lerr.push.apply(lerr, L.errors); await L.close();

    console.log("## live: the commissioner: a ban, its lift, and discipline from a case");
    L = await live.open(b, BASE, { persona: "commissioner", subject: "rostered", hash: "#/desk?tab=people" }); p = L.p;
    sid = await record(L);
    await p.click('.sheet [data-lv-tool="ban"]'); await p.waitForSelector(".sheet #dkLvWhy");
    await ok(p);
    A("live: a ban needs its grounds", /grounds for the ban/.test(await T(p, ".sheet [data-lv-err]")) && !(await lastCall(L, "ban_player")));
    await p.fill(".sheet #dkLvWhy", "Placeholder ban grounds."); await ok(p); await closed(p);
    c = await lastCall(L, "ban_player");
    A("live: ban_player with the member and the grounds", c && c.args.p_profile === sid && c.args.p_reason === "Placeholder ban grounds.", c);
    sid = await record(L);
    A("live: the record now says banned and offers Lift the ban", /Banned/.test(await T(p, ".sheet [data-lv-rec]")) && !!(await p.$('.sheet [data-lv-tool="unban"]')));
    await p.click('.sheet [data-lv-tool="unban"]'); await p.waitForSelector('.sheet [data-cf="ok"]'); await ok(p); await closed(p);
    A("live: unban_player for that member", ((await lastCall(L, "unban_player")) || { args: {} }).args.p_profile === sid);
    await p.evaluate(() => { location.hash = "#/desk?tab=cases&case=c-complaint-1"; }); await p.waitForSelector('[data-lv-case="c-complaint-1"]');
    await p.click('[data-act="lv-disc"]'); await p.waitForSelector(".sheet #dkLvKind");
    A("live: from a case the sanction is chosen in the form, a commissioner's season-long one among them", (await p.$$eval(".sheet #dkLvKind option", (l) => l.map((o) => o.value))).join() === "warn,games,date,seasons");
    await p.selectOption(".sheet #dkLvKind", "games"); await p.fill(".sheet #dkLvGames", "6"); await p.fill(".sheet #dkLvWhy", "Placeholder case grounds.");
    await ok(p);
    A("live: discipline from a case needs the final decision statement", /final decision statement/.test(await T(p, ".sheet [data-lv-err]")) && !(await lastCall(L, "discipline_from_case")));
    await p.fill(".sheet #dkStmt", "Placeholder: the complaint was upheld."); await ok(p); await closed(p);
    c = await lastCall(L, "discipline_from_case");
    A("live: discipline_from_case names the case, the member, the length and the statement", c && c.args.p_request === "c-complaint-1" && c.args.p_profile === "u-memb" && c.args.p_mode === "games" && c.args.p_games === 6 && c.args.p_statement === "Placeholder: the complaint was upheld.", c);
    lerr.push.apply(lerr, L.errors); await L.close();
    A("live: no console errors in the live discipline tools", lerr.length === 0, lerr.slice(0, 5));
  }

  A("no console errors", errors.length === 0, errors.slice(0, 5));
  await b.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
