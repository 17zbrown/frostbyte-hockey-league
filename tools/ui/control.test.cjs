const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The Control Center on its real doors (S2 swap, stream g3, 2026-11-24): node tools/ui/run.cjs --suite control --mode live
   Every check drives the page as the commissioner would and reads what it sent. i3d (2026-11-25): every page is the real
   site (the harness's live mode, tools/ui/mock with live: true): js/live.js's own client reads, and the harness answers it
   from this file's tables and read RPCs (the s2_control and ops_job_health bodies are the commissioner's recorded reads,
   private, never in git); writes go to the harness's write mock (an unknown write is refused MOCK1, never faked). Nothing
   reaches the league. For each action: the door and its exact arguments, nothing shown as done before the league
   confirms it, a refusal shown in place with the input kept, and the page repainted in place (never re-routed).
   A staffer opens the Control Center to the locked page: no Control Center read is made and no control is offered. */
const fs = require("fs"), path = require("path"), os = require("os");
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const REC = path.join(os.homedir(), "Developer/cghl-private/fixtures/personas");
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* what the Staff Desk's own reads find (the Overview, Staff and setup tabs ask the desk to read): an office with nothing in it */
const DESK = {
  rpcs: { has_department: mock.ok(false), is_app_reviewer: mock.ok(true), staff_voter_count: mock.ok(11), can_vote_committee_app: mock.ok(false), season_survey_done: mock.ok(true),
    is_any_committee_manager: Object.assign(mock.fail("PGRST202", "Could not find the function public.is_any_committee_manager(p_profile) in the schema cache"), { status: 404 }),
    s2_desk: mock.ok({ staff: [], suspensions: [], activity: [] }), season_survey_results: mock.ok({ responses: [] }) },
  tables: { action_requests: [], action_messages: [], owner_applications: [], staff_applications: [], management_applications: [], committee_applications: [], application_ballots: [],
    application_messages: [], suspension_record: [], committees: [], suspension_requests: Object.assign(mock.fail("PGRST205", "Could not find the table 'public.suspension_requests' in the schema cache"), { status: 404 }) }
};

(async () => {
  const b = await chromium.launch();
  const errors = [];
  let H = null;
  async function page(hash, o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    if (o.at) await ctx.clock.setFixedTime(new Date(o.at));   /* a check that needs the league clock at one instant (Tonight's game night); timers keep running */
    H = { reads: [], ans: o.read || {} };
    const Hh = H;
    /* the check's answers keep their old shape: a function of {sel, f, one, lim}, f holding each filter's value (eq) or
       "ilike:<col>"; the harness applies the query to the rows it returns. js/live.js's own sign-in lookup of the club
       seats (teams with an or filter) is answered from the recording and is not a Control Center read */
    const asTable = (name, fn) => (q) => {
      const u = new URL(q.url), f = {};
      if (name === "teams" && u.searchParams.has("or")) return mock.league().teams;
      q.filters.forEach((x) => { const v = String(x[1]); if (v.indexOf("ilike.") === 0) f["ilike:" + x[0]] = v.slice(6); else f[x[0]] = v.replace(/^eq\./, ""); });
      const args = { sel: q.select, f: f, one: q.single, lim: u.searchParams.has("limit") ? +u.searchParams.get("limit") : null };
      Hh.reads.push({ kind: "from", name: name, args: args });
      const r = fn(args);
      if (r.error) return mock.fail(r.error.code || "P0001", r.error.message);
      return Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
    };
    const asRpc = (name, fn) => async (args) => { Hh.reads.push({ kind: "rpc", name: name, args: args || {} }); const r = await fn(args || {}); return r.error ? mock.fail(r.error.code || "P0001", r.error.message) : mock.ok(r.data); };
    const tables = Object.assign({}, DESK.tables), rpcs = Object.assign({}, DESK.rpcs);
    Object.keys(H.ans).forEach((k) => { const kind = k.split(":")[0], name = k.slice(kind.length + 1); if (kind === "from") tables[name] = asTable(name, H.ans[k]); else rpcs[name] = asRpc(name, H.ans[k]); });
    await mock.install(ctx, { live: true, persona: o.persona || "commissioner", writes: o.writes || {}, tables: tables, rpcs: rpcs });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    /* o.quiet: the console error a check causes on purpose (a refused read the page logs as well as says), on that page only */
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text()) && !(o.quiet && o.quiet.test(m.text()))) errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    /* the real site reads the league (s2_league, answered by the harness from the recorded body), so the season rows and
       clubs carry their ids; ?season=1 opens the season with games played */
    await p.goto(S2_BASE + (o.season ? "?season=" + o.season : "") + hash);
    await p.waitForFunction(() => window.S2 && S2.LIVE && S2.M && document.querySelector("#app section, #app header"));
    await wait(350);
    return p;
  }
  const done = (p) => p.context().close();
  const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 5000 }).then(() => true, () => false);
  /* a ".sheet" selector reads the newest sheet: the one closing behind it is still in the page for its exit */
  const txt = (p, sel) => p.evaluate((s) => { const all = [...document.querySelectorAll(s)], e = /^\.sheet\b/.test(s) ? all[all.length - 1] : all[0]; return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
  const calls = (p) => mock.calls(p.context());
  const step = async (p, n) => { await p.click('[data-cc-step="' + n + '"]'); await p.waitForSelector(".sheet"); await wait(250); };
  const ok = async (p) => { await p.click('.sheet [data-cf="ok"]'); };
  const toastSaid = (p, re) => until(p, (src) => [...document.querySelectorAll(".toast-root *")].some((e) => new RegExp(src).test(e.textContent)), re.source);

  /* i3d: the fixture section opened the page with no session and no write door (the concept's role switch); the site
     always has both, so its write check is gone (the refusals below are the league's own) and its layout checks run here */
  console.log("## the setup tab: its ten steps, and the holiday step's calendar");
  let p = await page("#/control?tab=setup", { persona: "commissioner" });
  A("the setup tab renders its ten steps", (await p.$$('[data-cc-step]')).length === 10);
  await step(p, 2);
  A("the holiday step lists the classic calendar's twenty holidays, each a switch", (await p.$$(".sheet [data-cc-hol]")).length === 20, (await p.$$(".sheet [data-cc-hol]")).length);
  await done(p);

  /* the league as the live read holds it (the recorded Season 2 body), read from a wired page once */
  p = await page("#/control?tab=setup", { persona: "commissioner" });
  const F = await p.evaluate(() => ({ row: JSON.parse(JSON.stringify(S2.M.control.season(2).settings)), teams: S2.M.teams.map((t) => ({ code: t.code, division: t.division })), view: S2.M.view.season }));
  await done(p);
  A("the wired pages read the live-shaped league: Season 2 on screen, its row with an id", F.view === 2 && !!F.row.id, { view: F.view, id: F.row.id });
  const TEAMS = F.teams.map((t, i) => ({ id: "team-" + t.code, code: t.code, division: t.division }));
  const SID = F.row.id;
  const seasonRead = (over) => () => ({ data: Object.assign({}, F.row, over || {}) });
  const baseRead = (over) => Object.assign({ "from:seasons": seasonRead(), "from:teams": () => ({ data: TEAMS }), "from:games": () => ({ data: [] }) }, over || {});
  const genOk = { "games.insert": (args) => mock.ok((args.row || []).map((r, i) => ({ id: "g" + i }))), "seasons.update": (args) => mock.ok([Object.assign({ id: SID }, args.set)]) };

  console.log("## the schedule generator: the classic rows, previewed, then written once");
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: genOk });
  A("the commissioner's session opens the Control Center", !!(await p.$("#ccPane")));
  await step(p, 8);
  await p.click(".sheet [data-cc-sgen]");
  A("Generate reads the season, the clubs and the season's regular games fresh", await until(p, () => !!document.querySelector(".sheet [data-cc-genprev]")) &&
    ["from:seasons", "from:teams", "from:games"].every((k) => H.reads.some((r) => r.kind + ":" + r.name === k)), H.reads.map((r) => r.kind + ":" + r.name));
  const g = H.reads.filter((r) => r.name === "games")[0];
  A("the games read asks only whether a regular schedule exists for this season", g && g.args.f.season_id === SID && g.args.f.stage === "regular" && g.args.lim === 1, g && g.args);
  let r = await txt(p, ".sheet");
  A("the preview says what it builds before anything is written", /8 clubs, 54 games each, 3 a night and 9 a week/.test(r) && /216 games are written in one go/.test(r) && /playoffs begin/.test(r), r.slice(0, 400));
  A("and shows it a week at a time (the week picker and a grid of games)", (await p.$$(".sheet [data-cc-schedweek] button")).length >= 6 && (await p.$$(".sheet #ccSchedGrid li")).length === 36, (await p.$$(".sheet #ccSchedGrid li")).length);
  await p.click('.sheet [data-cc-schedweek] button[data-v="2"]'); await wait(200);
  A("the week picker repaints the grid in place, the sheet stays", /Week 2/.test(await txt(p, ".sheet [data-cc-schedwk]")) && !!(await p.$(".sheet [data-cc-genprev]")));
  A("nothing is written by the preview", calls(p).length === 0, calls(p));
  const want = await p.evaluate((a) => S2._control.genRun(a.row, a.teams, []), { row: F.row, teams: TEAMS });
  await ok(p);
  A("Generate writes the generator's own rows in ONE insert", await until(p, () => !document.querySelector(".sheet [data-cc-genprev]")) && calls(p)[0] && calls(p)[0].rpc === "games.insert" &&
    JSON.stringify(calls(p)[0].args.row) === JSON.stringify(want.rows) && want.rows.length === 216, calls(p).map((c) => c.rpc));
  A("then the generator's season patch: ends_at and playoffs_start_at on this season's row", calls(p)[1] && calls(p)[1].rpc === "seasons.update" &&
    JSON.stringify(calls(p)[1].args.set) === JSON.stringify(want.patch.set) && calls(p)[1].args.match.id === SID && calls(p).length === 2, calls(p)[1] && calls(p)[1].args);
  A("the commissioner is told, once the league confirmed both", await toastSaid(p, /216 games generated: 54 a club over 6 weeks/));
  A("the step reads done, from what the league confirmed, repainted in place", await until(p, () => { const b = document.querySelector('[data-cc-step="8"]'); return b && /216 games/.test(b.textContent) && b.closest(".is-done"); }) && (await p.evaluate(() => location.hash)) === "#/control?tab=setup");
  A("the schedule band shows the written weeks", !!(await p.$("#ccSched")) && /216 games over 6 weeks/.test(await txt(p, "#ccSched")), await txt(p, "#ccSched"));
  await done(p);

  console.log("## the standing order: no schedule before the holidays are set");
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead({ "from:seasons": seasonRead({ skip_holidays: null }) }), writes: genOk });
  await step(p, 8); await p.click(".sheet [data-cc-sgen]");
  A("a season whose holidays were never set (NULL) is refused before the generator runs", await until(p, () => /Set the holidays first/.test(document.querySelector(".sheet") && document.querySelector(".sheet").textContent || "")) &&
    /never generated before its holidays are set/.test(await txt(p, ".sheet")) && !(await p.$(".sheet [data-cc-genprev]")));
  A("and nothing is written", calls(p).length === 0, calls(p));
  await done(p);

  console.log("## a schedule that already exists, and a refused insert");
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead({ "from:games": () => ({ data: [{ id: "x", season_id: SID, stage: "regular" }] }) }), writes: genOk });
  await step(p, 8); await p.click(".sheet [data-cc-sgen]");
  A("the classic's own reason, without its dash", await until(p, () => /A regular-season schedule already exists: clear it first/.test((document.querySelector(".sheet") || {}).textContent || "")) && calls(p).length === 0);
  await done(p);
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: { "games.insert": mock.fail("42501", "permission denied for table games"), "seasons.update": genOk["seasons.update"] } });
  await step(p, 8); await p.click(".sheet [data-cc-sgen]"); await p.waitForSelector(".sheet [data-cc-genprev]"); await ok(p);
  A("a refused insert shows the league's words in the sheet, which stays open with its button back", await until(p, () => { const e = document.querySelector(".sheet [data-cc-err]"); return e && !e.hidden && /permission denied for table games/.test(e.textContent); }) &&
    !!(await p.$(".sheet [data-cc-genprev]")) && !(await p.getAttribute('.sheet [data-cf="ok"]', "disabled")));
  A("and the season patch is never sent", calls(p).length === 1 && calls(p)[0].rpc === "games.insert");
  A("the step is not shown as done", !(await p.$('.is-done [data-cc-step="8"]')));
  await done(p);

  console.log("## holidays: each switch saves skip_holidays, and shows only what the league confirmed");
  const holWrites = { "seasons.update": (args) => mock.ok([{ id: SID, skip_holidays: args.set.skip_holidays }]) };
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: holWrites });
  await step(p, 2);
  const on0 = await p.getAttribute('.sheet [data-cc-hol="halloween"]', "aria-checked");
  await p.click('.sheet [data-cc-hol="halloween"]');
  const hc = calls(p)[0];
  A("one seasons.update of this season's row, the full list with the holiday added", hc && hc.rpc === "seasons.update" && hc.args.match.id === SID && hc.args.set.skip_holidays.indexOf("halloween") >= 0 &&
    hc.args.set.skip_holidays.length === (F.row.skip_holidays || []).length + 1, hc && hc.args);
  A("the switch turns on once the league confirmed it, and keeps focus", await until(p, () => { const s = document.querySelector('.sheet [data-cc-hol="halloween"]'); return s && s.getAttribute("aria-checked") === "true" && document.activeElement === s; }) && on0 === "false");
  await p.click('.sheet [data-cc-hol="halloween"]');
  A("switching it back sends the list without it", await until(p, () => true) && calls(p)[1] && calls(p)[1].args.set.skip_holidays.indexOf("halloween") < 0);
  await done(p);
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: { "seasons.update": mock.fail("42501", "new row violates row-level security policy for table seasons") } });
  await step(p, 2); await p.click('.sheet [data-cc-hol="halloween"]');
  A("a refused switch says the league's words and stays off", await until(p, () => /row-level security/.test((document.querySelector(".sheet [data-cc-holerr]") || {}).textContent || "")) &&
    (await p.getAttribute('.sheet [data-cc-hol="halloween"]', "aria-checked")) === "false");
  await done(p);

  console.log("## playoffs: Draw now previews (p_dry), then draws; the pause switch is site_config");
  const dry = { ok: true, series: [{ home: "BOS", away: "DET" }, { home: "SEA", away: "DAL" }], best_of: 7, games: 14, plan: [{ at: "2027-02-11T02:00:00Z" }, { at: "2027-02-20T03:10:00Z" }] };
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: {
    draw_playoff_round: (args) => mock.ok(args.p_dry ? dry : { ok: true, games: 14 }),
    "site_config.upsert": (args) => mock.ok([{ key: args.row.key, value: args.row.value }]) } });
  await step(p, 9);
  await p.click(".sheet #ccPoSw");
  const pc = calls(p)[0];
  A("the switch upserts site_config playoff_auto_2 {paused: true} on the key", pc && pc.rpc === "site_config.upsert" && pc.args.row.key === "playoff_auto_2" && pc.args.row.value.paused === true && pc.args.onConflict === "key", pc && pc.args);
  A("and reads paused once confirmed, in place", await until(p, () => { const s = document.querySelector(".sheet #ccPoSw"); return s && s.getAttribute("aria-checked") === "false"; }) && /Paused for Season 2/.test(await txt(p, ".sheet #ccPoAuto")));
  await p.click('.sheet [data-cc-po="draw"]');
  A("Draw now asks for the preview first (p_dry), for this season's round 1", await until(p, () => /Draw the division semi-finals now\?/.test((document.querySelector(".sheet") || {}).textContent || "")) &&
    calls(p)[1].rpc === "draw_playoff_round" && calls(p)[1].args.p_dry === true && calls(p)[1].args.p_round === 1 && calls(p)[1].args.p_season === SID, calls(p)[1]);
  A("the confirm names the series from the preview", /BOS v DET, SEA v DAL: best of 7, 14 games/.test(await txt(p, ".sheet")));
  await ok(p);
  A("then the same draw, without p_dry", await until(p, () => !/Draw the division/.test((document.querySelector(".sheet .cf") || {}).textContent || "")) && calls(p)[2] && calls(p)[2].rpc === "draw_playoff_round" && calls(p)[2].args.p_dry === undefined && calls(p)[2].args.p_round === 1);
  A("and says so", await toastSaid(p, /Round 1 drawn: 14 games/));
  await done(p);
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: { draw_playoff_round: mock.ok({ ok: false, wait: "the regular season is not over yet" }) } });
  await step(p, 9); await p.click('.sheet [data-cc-po="draw"]');
  A("a draw the league holds says its reason, and no draw is sent", await until(p, () => /The regular season is not over yet\./.test((document.querySelector(".sheet") || {}).textContent || "")) && calls(p).length === 1);
  await done(p);

  console.log("## qa (nits 20, nits 22): a failed re-read after a draw is said; Clear round and Clear schedule, their exact doors, a refusal kept in the sheet");
  const PO = [{ id: "po-1", season_id: SID, week: 1, stage: "playoff", scheduled_at: "2027-02-11T02:00:00Z", home_team_id: TEAMS[0].id, away_team_id: TEAMS[1].id, status: "scheduled" }];
  const po = { fail: true, clr: 0 };
  p = await page("#/control?tab=setup", { persona: "commissioner", quiet: /playoff games could not be read again/, read: baseRead({ "from:games": (a) => (a.f.stage !== "playoff" ? { data: [] } : po.fail ? { error: { code: "57014", message: "canceling statement due to statement timeout" } } : { data: PO }) }), writes: {
    draw_playoff_round: (args) => mock.ok(args.p_dry ? dry : { ok: true, games: 1 }),
    clear_playoff_round: (args) => (po.clr++ === 0 ? mock.fail("P0001", "PLAYOFFS: round 1 has a final; reopen it on its Game desk first") : mock.ok({ games: 1, seeds_unlocked: true })) } });
  await step(p, 9); await p.click('.sheet [data-cc-po="draw"]'); await until(p, () => /Draw the division semi-finals now\?/.test((document.querySelector(".sheet") || {}).textContent || "")); await ok(p);
  A("qa (nits 20): drawn, but the playoff games could not be read again: said in a toast, and the step still reopens", await toastSaid(p, /could not be read again/) &&
    await until(p, () => !!document.querySelector('.sheet [data-cc-po="draw"]'), null, 6000));
  po.fail = false;
  await p.click('.sheet [data-cc-po="draw"]'); await until(p, () => /Draw the division semi-finals now\?/.test((document.querySelector(".sheet") || {}).textContent || "")); await ok(p);
  A("once the games read back, the step offers Clear round 1", await until(p, () => !!document.querySelector('.sheet [data-cc-po="clear"]'), null, 6000), await txt(p, ".sheet"));
  await p.click('.sheet [data-cc-po="clear"]'); await until(p, () => /Clear round 1\?/.test((document.querySelector(".sheet") || {}).textContent || "")); await ok(p);
  A("qa (nits 22): Clear round is clear_playoff_round for this season's round 1, and a refusal stays in the sheet in the league's words",
    await until(p, () => /round 1 has a final/.test((document.querySelector(".sheet [data-cc-err]") || {}).textContent || "")) && !!(await p.$('.sheet [data-cf="ok"]:not([disabled])')) &&
    JSON.stringify(calls(p).filter((c) => c.rpc === "clear_playoff_round")[0].args) === JSON.stringify({ p_season: SID, p_round: 1 }), calls(p).filter((c) => c.rpc === "clear_playoff_round"));
  await ok(p);
  A("then cleared, said once the league confirmed it", await toastSaid(p, /Round 1 cleared: 1 game, seeding unlocked/) && calls(p).filter((c) => c.rpc === "clear_playoff_round").length === 2);
  await done(p);
  const del = { n: 0 };
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: Object.assign({}, genOk, {
    "games.delete": (args) => (del.n++ === 0 ? mock.fail("42501", "permission denied for table games") : mock.ok([{ id: "g0" }, { id: "g1" }])) }) });
  await step(p, 8); await p.click(".sheet [data-cc-sgen]"); await until(p, () => !!document.querySelector(".sheet [data-cc-genprev]")); await ok(p);
  await until(p, () => { const b = document.querySelector('[data-cc-step="8"]'); return b && /216 games/.test(b.textContent); });
  await step(p, 8); await p.click(".sheet [data-cc-sclear]"); await until(p, () => /Clear the regular-season schedule\?/.test((document.querySelector(".sheet") || {}).textContent || "")); await ok(p);
  A("qa (nits 22): Clear schedule is games.delete matching this season's regular stage, and a refusal stays in the sheet",
    await until(p, () => /permission denied/.test((document.querySelector(".sheet [data-cc-err]") || {}).textContent || "")) &&
    JSON.stringify(calls(p).filter((c) => c.rpc === "games.delete")[0].args) === JSON.stringify({ match: { season_id: SID, stage: "regular" } }), calls(p).filter((c) => c.rpc === "games.delete"));
  await ok(p);
  A("then cleared, said once the league confirmed it", await toastSaid(p, /Regular season cleared: 2 games removed/) && calls(p).filter((c) => c.rpc === "games.delete").length === 2);
  await done(p);

  console.log("## the rollover is start_next_season on this season's row");
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: { start_next_season: mock.ok({ expired: 3, activated: 2, holds: 1 }) } });
  await step(p, 10); await p.click(".sheet [data-cc-roll]"); await p.waitForSelector('.sheet [data-cf="ok"]'); await ok(p);
  A("start_next_season with p_new_season = Season 2's id", await until(p, () => true) && calls(p)[0] && calls(p)[0].rpc === "start_next_season" && calls(p)[0].args.p_new_season === SID, calls(p));
  A("the result is reported from the league's answer", await toastSaid(p, /Rollover done: 3 expired, 2 seated, 1 awaiting sign-up/));
  await done(p);

  console.log("## season settings: seasons.update of what changed; a new season is seasons.insert");
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: { "seasons.update": (args) => mock.ok([Object.assign({}, F.row, args.set)]), "seasons.insert": (args) => mock.ok([Object.assign({ id: "new-season" }, args.row)]) } });
  await step(p, 1); await p.click('.sheet [data-cc-season="edit"]'); await p.waitForSelector(".sheet #ccSs_weeks");
  await p.fill(".sheet #ccSs_night_slots", "21:00,25:61");
  await p.click(".sheet [data-cc-ssave]");
  A("an unreadable puck drop is refused in place, its field focused, and nothing is written", /24-hour times/.test(await txt(p, ".sheet .cc-ed-err")) && (await p.evaluate(() => document.activeElement && document.activeElement.id)) === "ccSs_night_slots" && calls(p).length === 0);
  await p.fill(".sheet #ccSs_night_slots", F.row.night_slots);
  await p.fill(".sheet #ccSs_weeks", "7"); await p.fill(".sheet #ccSs_salary_cap", "31");
  await p.click(".sheet [data-cc-ssave]");
  A("Save sends only what changed (weeks, the cap in dollars) on this season's row", await until(p, () => !document.querySelector(".sheet #ccSs_weeks")) && calls(p)[0] && calls(p)[0].rpc === "seasons.update" &&
    JSON.stringify(calls(p)[0].args.set) === JSON.stringify({ weeks: 7, salary_cap: 31000000 }) && calls(p)[0].args.match.id === SID, calls(p)[0] && calls(p)[0].args);
  A("it says so once confirmed", await toastSaid(p, /Saved .*: 2 settings/));
  await step(p, 1);
  A("and step 1 shows the row the league returned", /Weeks ?7/.test(await txt(p, ".sheet")) && /\$31/.test(await txt(p, ".sheet")), await txt(p, ".sheet"));
  await done(p);
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead(), writes: { "seasons.insert": (args) => mock.ok([Object.assign({ id: "new-season" }, args.row)]) } });
  await step(p, 1); await p.click('.sheet [data-cc-season="new"]'); await p.waitForSelector(".sheet #ccSs_number");
  await p.click(".sheet [data-cc-ssave]");
  const ins = calls(p)[0];
  A("New season inserts the next number, basic format, upcoming, sign-ups closed", await until(p, () => !document.querySelector(".sheet #ccSs_number")) && ins && ins.rpc === "seasons.insert" && ins.args.row.number === 3 && ins.args.row.format === "basic" &&
    ins.args.row.status === "upcoming" && ins.args.row.registration_open === false && ins.args.row.name === "Season 3", ins && ins.args);
  await done(p);

  console.log("## clubs: the club row, its seats (set_team_manager) and its EA link");
  const TROWS = TEAMS.map((t, i) => ({ id: t.id, code: t.code, ea_club_id: i ? String(500 + i) : null, ea_club_name: i ? "Club " + i : null, discord_role_id: "r" + i, discord_channel_id: "c" + i, owner_profile_id: null, gm_profile_id: null, agm_profile_id: null }));
  const clubRead = baseRead({ "from:teams": () => ({ data: TROWS }), "rpc:ea_lookup_health": () => ({ data: { state: "working", at: new Date().toISOString(), latencyMs: 900 } }) });
  const C0 = TEAMS[0].code, member = await (async () => { const q = await page("#/control?tab=clubs", { persona: "commissioner", read: clubRead }); const m = await q.evaluate(() => (S2.M.signups[0] || {}).pid || null); await done(q); return m; })();
  p = await page("#/control?tab=clubs", { persona: "commissioner", read: clubRead, writes: { "teams.update": (args) => mock.ok([Object.assign({ id: args.match.id }, args.set)]), set_team_manager: mock.ok(null) } });
  A("the clubs tab reads each club's row for its links and seats", await until(p, () => /linked to EA/.test((document.getElementById("ccPane") || {}).textContent || "")) && H.reads.some((r) => r.name === "teams" && /discord_role_id/.test(r.args.sel)), H.reads.map((r) => r.name));
  A("a club with no EA link reads Not linked; the ids never show", /7 linked to EA/.test(await txt(p, "#ccPane")) && !/r1|c1|501/.test(await txt(p, ".cc-clubs")), await txt(p, "#ccPane"));
  await p.click('[data-cc-club="' + C0 + '"]'); await p.waitForSelector(".sheet #ccEdCity");
  await p.evaluate(() => { const a = document.querySelector("#ccEdC1"), b = document.querySelector("#ccEdC2"); b.value = a.value; b.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.click(".sheet [data-cc-save]");
  A("the two-color rule refuses a save with the same primary and secondary, and nothing is written", /secondary color too/.test(await txt(p, ".sheet .cc-ed-err")) && calls(p).length === 0);
  await p.evaluate(() => { const b = document.querySelector("#ccEdC2"); b.value = "#123456"; b.dispatchEvent(new Event("input", { bubbles: true })); });
  await p.fill(".sheet #ccEdName", "Testers");
  if (member) await p.selectOption(".sheet #ccEdSeatGM", member);
  await p.click(".sheet [data-cc-save]");
  A("the club row is updated with only what changed, by its id", await until(p, () => !document.querySelector(".sheet #ccEdCity")) && calls(p)[0] && calls(p)[0].rpc === "teams.update" && calls(p)[0].args.match.id === "team-" + C0 &&
    calls(p)[0].args.set.name === "Testers" && calls(p)[0].args.set.color2 === "#123456" && !("city" in calls(p)[0].args.set), calls(p)[0]);
  A("then the seat: set_team_manager for the GM", !member || (calls(p)[1] && calls(p)[1].rpc === "set_team_manager" && calls(p)[1].args.p_team_code === C0 && calls(p)[1].args.p_role === "gm" && calls(p)[1].args.p_profile === member), calls(p)[1]);
  A("saved is said after the league confirmed both", await toastSaid(p, /^Saved /));
  await done(p);
  p = await page("#/control?tab=clubs", { persona: "commissioner", read: clubRead, writes: { "teams.update": mock.ok([{ id: "x" }]), set_team_manager: mock.fail("P0001", "That member already holds a seat on another club (Rule 2.6)") } });
  await until(p, () => /linked to EA/.test((document.getElementById("ccPane") || {}).textContent || ""));
  await p.click('[data-cc-club="' + C0 + '"]'); await p.waitForSelector(".sheet #ccEdCity");
  if (member) {
    await p.selectOption(".sheet #ccEdSeatOwner", member); await p.click(".sheet [data-cc-save]");
    A("a refused seat says the league's words and that the club itself was not the problem; the pick is kept", await until(p, () => /front office change was refused: That member already holds a seat/.test((document.querySelector(".sheet .cc-ed-err") || {}).textContent || "")) &&
      (await p.$eval(".sheet #ccEdSeatOwner", (e) => e.value)) === member);
  }
  await done(p);
  p = await page("#/control?tab=clubs", { persona: "commissioner", read: clubRead, writes: { "teams.update": (args) => mock.ok([Object.assign({ id: args.match.id }, args.set)]) } });
  const eaPosts = [];
  await p.context().route("**/api/pickup-import", async (rt) => { const body = JSON.parse(rt.request().postData() || "{}"); eaPosts.push({ body, auth: rt.request().headers().authorization }); rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ clubs: [{ clubId: 778899, name: "Test EA Club", memberCount: 9 }] }) }); });
  await until(p, () => /linked to EA/.test((document.getElementById("ccPane") || {}).textContent || ""));
  await p.click('[data-cc-club="' + C0 + '"]'); await p.waitForSelector(".sheet #ccEaQ");
  A("the EA status line is painted from the bot server's self-test", await until(p, () => /EA search is working/.test((document.querySelector(".sheet [data-ea-status]") || {}).textContent || "")));
  await p.fill(".sheet #ccEaQ", "Test EA"); await p.click(".sheet [data-cc-ea]");
  A("Search EA asks pickup-import's search with the commissioner's token", await until(p, () => !!document.querySelector(".sheet [data-cc-ea-link]")) && eaPosts[0] && eaPosts[0].body.action === "search" && eaPosts[0].body.clubName === "Test EA" && /^Bearer /.test(eaPosts[0].auth || ""), eaPosts);
  await p.click('.sheet [data-cc-ea-link="0"]');
  A("This is us links it: teams.update of ea_club_id and ea_club_name on the club's row", await until(p, () => /Linked to Test EA Club/.test((document.querySelector(".sheet #ccEaRow") || {}).textContent || "")) &&
    calls(p)[0].rpc === "teams.update" && calls(p)[0].args.set.ea_club_id === "778899" && calls(p)[0].args.set.ea_club_name === "Test EA Club" && calls(p)[0].args.match.id === "team-" + C0, calls(p)[0]);
  await done(p);

  console.log("## the commissioner's reads: s2_control() and ops_job_health(), drawn from what they return");
  const SC = JSON.parse(fs.readFileSync(path.join(REC, "s2_control-commissioner.json"), "utf8")), JH = JSON.parse(fs.readFileSync(path.join(REC, "ops_job_health-commissioner.json"), "utf8"));
  const liveRead = baseRead({ "rpc:s2_control": () => ({ data: SC }), "rpc:ops_job_health": () => ({ data: JH }) });
  p = await page("#/control?tab=system", { persona: "commissioner", read: liveRead });
  /* qa (visual 17): a job counts healthy only when it is running on time: a database job that did not fail AND is not late
     (past twice its schedule and at least five minutes past it), an Edge Function with a clean last run AND a fresh
     rl_<fn> heartbeat. The pg_cron schedule read here mirrors control.js's cadence() */
  const cad = (sch) => { if (!sch) return null; if (/second/.test(sch)) return 1; const q = sch.split(" "); if (q.length !== 5) return null; if (/^\*\/(\d+)$/.test(q[0])) return +q[0].slice(2); if (q[0] === "*") return 1; if (q[1] === "*") return 60; if (q[4] !== "*") return 10080; return 1440; };
  const late = (c, ago) => !!c && ago != null && ago > Math.max(2 * c, c + 5), minsAgo = (iso) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : 1e9);
  const beat = (fn) => JH.heartbeats.filter((h) => h.key === "rl_" + fn || h.key === fn)[0];
  const okJobs = JH.cron.filter((c) => c.active && c.last_status !== "failed" && !late(cad(c.schedule), minsAgo(c.last_started))).length +
    JH.hosts.filter((h) => { const b = beat(h.fn), age = b ? Math.round((+b.age_seconds || 0) / 60) : null; return h.last_ok && !h.failing && !h.lost_count && h.edge_ready !== false && (b ? age <= Math.max(2 * h.every_min, h.every_min + 5) : !late(h.every_min, minsAgo(h.run_started || h.edge_seen))); }).length;
  A("both reads are made once the page opens", await until(p, () => /jobs healthy|Job health/.test((document.getElementById("ccPane") || {}).textContent || "")) && H.reads.some((r) => r.name === "s2_control") && H.reads.some((r) => r.name === "ops_job_health"), H.reads.map((r) => r.name));
  r = await txt(p, "#ccPane");
  A("the System head counts the jobs the read returned (" + okJobs + " of " + (JH.cron.length + JH.hosts.length) + " healthy)", new RegExp("(All " + (JH.cron.length + JH.hosts.length) + "|" + okJobs + " of " + (JH.cron.length + JH.hosts.length) + ") jobs healthy").test(r) && new RegExp(JH.hosts.length + " Edge Functions and " + JH.cron.length + " database jobs").test(r), r.slice(0, 300));
  A("Run now is offered for discord-sync alone, the one job with a door", (await p.$$("[data-cc-run]")).length === (JH.hosts.some((h) => h.fn === "discord-sync") ? 1 : 0) && (!JH.hosts.some((h) => h.fn === "discord-sync") || !!(await p.$('[data-cc-run="discord-sync"]'))));
  A("every heartbeat the read returned is listed behind Show all", (await p.$$("#ccHbs tbody tr")).length === JH.heartbeats.length, (await p.$$("#ccHbs tbody tr")).length);
  r = await txt(p, "#ccPane");
  const lateRows = await p.$$eval("#ccPane .cc-auto .sub", (xs) => xs.filter((x) => /^Late: /.test(x.textContent)).length);
  A("qa (visual 17): the headline never says all jobs are healthy while a database job is listed Late", !(lateRows && /All \d+ jobs healthy/.test(r)), { lateRows, head: r.slice(0, 160) });
  /* qa (function 23): a heartbeat is counted only for an Edge Function or a worker on the bot server; a pg_cron job's key is
     judged by that job's run, and a key nothing schedules is listed as retired. Keys read by their job's name */
  const watched = JH.heartbeats.filter((h) => { const base = h.key.replace(/^rl_/, "").replace(/_(result|started)$/, ""); return JH.hosts.some((x) => x.fn === base) || ["ea-poll-vm", "ea-poll", "gateway-bot", "ea-lookup"].indexOf(base) >= 0; }).length;
  A("qa (function 23): the heartbeat lead counts the " + watched + " Edge and bot-server workers, not all " + JH.heartbeats.length + " keys", new RegExp("\\d+ of " + watched + " heartbeats fresh").test(r) && watched < JH.heartbeats.length, r.match(/\d+ of \d+ heartbeats fresh/));
  const hbNames = await p.$$eval("#ccPane .cc-auto .title.mono, #ccHbs tbody td .mono", (xs) => xs.map((x) => x.textContent));
  A("qa (function 23): no heartbeat reads as a raw rl_ key, and none of a pg_cron job is in the needs-a-look list", hbNames.length > 0 && hbNames.every((t) => !/^rl_/.test(t)) &&
    !(await p.$$eval("#ccPane .cc-auto .sub", (xs) => xs.some((x) => /^(Stale|Close to stale): /.test(x.textContent) && /rookie-distribution|lifecycle-announcements|latecomer-assign/.test(x.parentElement.textContent)))), hbNames.slice(0, 8));
  await p.click('[data-cc-tab="growth"]'); await wait(400);
  A("Growth draws the members line from s2_control: " + SC.pop.days[SC.pop.days.length - 1].members + " members today", new RegExp(SC.pop.days[SC.pop.days.length - 1].members + " members").test(await txt(p, "#ccPane")) && !!(await p.$('[data-cc-draw="members"] svg')), (await txt(p, "#ccPane")).slice(0, 200));
  A("and names what s2_control does not return instead of drawing the fixture's", /Not in this read/.test(await p.evaluate(() => document.getElementById("ccPane").innerHTML)) && !/played three or more weeks/.test(await txt(p, "#ccPane")));
  await done(p);
  p = await page("#/control?tab=system", { persona: "commissioner", read: baseRead({ "rpc:s2_control": () => ({ data: SC }), "rpc:ops_job_health": () => ({ data: null, error: { message: "commissioners only", code: "42501" } }) }) });
  A("a refused job read is said, and no job is called healthy", await until(p, () => /refused the job read \(commissioners only\)/.test((document.getElementById("ccPane") || {}).textContent || "")) && /Job health could not be read/.test(await txt(p, "#ccPane")) && !/(All \d+|\d+ of \d+) jobs healthy/.test(await txt(p, "#ccPane")), await txt(p, "#ccPane"));
  await done(p);

  console.log("## office tools: news, site features, award ballots, member roles, a game moved or re-opened");
  const officeRead = baseRead({ "from:award_ballots": () => ({ data: [] }), "from:profiles": (a) => ({ data: [{ id: "p-target", gamertag: "TestMember", display_name: null, role: "member" }] }) });
  p = await page("#/control", { persona: "commissioner", read: officeRead, writes: {
    "news.insert": (args) => mock.ok([{ id: "n1" }]), "feature_flags.update": (args) => mock.ok([{ key: args.match.key, enabled: args.set.enabled }]),
    "award_ballots.upsert": mock.ok([{ id: "b1" }]), finalize_season_award: mock.ok("TestWinner") } });
  /* review 2026-11-24: an INSERT on news fires notify_discord_news, which posts every category but the automatic Player
     Spotlight to the Discord news channel; the form must say so, offer the classic six categories (CG.NEWS_CATS, copied
     into S2.CG) and ask before it publishes */
  await p.waitForSelector("#ccNwCat option", { timeout: 8000 }).catch(() => null);   /* the real site paints once it has signed in */
  const cats = await p.$$eval("#ccNwCat option", (os) => os.map((o) => o.value));
  A("the categories are the classic newsroom's six, from S2.CG.NEWS_CATS, with no Player Spotlight", JSON.stringify(cats) === JSON.stringify(["League News", "Game Recap", "Transactions", "Awards", "Commissioner Update", "Team Feature"]) &&
    JSON.stringify(cats) === JSON.stringify(await p.evaluate(() => S2.CG.NEWS_CATS)), cats);
  r = await txt(p, "#ccNews");
  A("the form says a story also posts to the Discord news channel", /also posts to the Discord news channel/.test(r) && !/nothing posts to Discord/i.test(r), r);
  await p.click("[data-cc-nwpost]");
  A("Publish with no headline is refused in place, nothing written", /Give the story a headline/.test(await txt(p, "#ccNews [data-cc-nwerr]")) && calls(p).length === 0);
  await p.fill("#ccNwTitle", "Draft night is set"); await p.click("[data-cc-nwpost]");
  A("and with no story, as the classic newsroom refuses it", /Write the story/.test(await txt(p, "#ccNews [data-cc-nwerr]")) && calls(p).length === 0);
  await p.fill("#ccNwBody", "Saturday, 9 PM ET."); await p.selectOption("#ccNwCat", "Commissioner Update");
  await p.click("[data-cc-nwpost]"); await p.waitForSelector('.sheet [data-cf="ok"]');
  r = await txt(p, ".sheet");
  A("Publish asks first, naming the headline and saying it posts to the Discord news channel", /Publish this story\?/.test(r) && /Draft night is set/.test(r) && /posts to the Discord news channel/.test(r) && calls(p).length === 0, r);
  await ok(p);
  const nw = await until(p, () => true) && calls(p)[0];
  A("then one news.insert: the season on screen, the category as stored, headline, story and the author line", nw && nw.rpc === "news.insert" && nw.args.row.season_id === SID && nw.args.row.category === "Commissioner Update" &&
    nw.args.row.title === "Draft night is set" && nw.args.row.body === "Saturday, 9 PM ET." && /, Commissioner$/.test(nw.args.row.author), nw && nw.args);
  A("the fields clear only once the league has it", await until(p, () => document.getElementById("ccNwTitle").value === "") && await toastSaid(p, /Published: Draft night is set/));
  const fk = await p.getAttribute("[data-cc-flag]", "data-cc-flag"), fon = await p.getAttribute("[data-cc-flag]", "aria-checked");
  await p.click('[data-cc-flag="' + fk + '"]');
  /* review 2026-11-24: feature_flags.label is NOT NULL with no default, so an upsert of {key, enabled} is refused 23502
     before ON CONFLICT; the switch updates the existing row, and asks for key and enabled back (the table has no id) */
  A("a feature switch updates feature_flags.enabled on its key, the other way round, asking for key and enabled back", await until(p, () => true) && calls(p)[1] && calls(p)[1].rpc === "feature_flags.update" &&
    calls(p)[1].args.match.key === fk && Object.keys(calls(p)[1].args.match).length === 1 && calls(p)[1].args.set.enabled === (fon !== "true") && Object.keys(calls(p)[1].args.set).join() === "enabled" &&
    calls(p)[1].args.select === "key,enabled" && !calls(p)[1].args.row, calls(p)[1]);
  A("and never a bare upsert, which the NOT NULL label refuses", !calls(p).some((c) => c.rpc === "feature_flags.upsert"));
  A("and moves once confirmed, keeping focus", await until(p, (a) => { const b = document.querySelector('[data-cc-flag="' + a.k + '"]'); return b && b.getAttribute("aria-checked") === String(a.on !== "true") && document.activeElement === b; }, { k: fk, on: fon }));
  A("the ballots are read for the season on screen", await until(p, () => !!document.querySelector('[data-cc-vote="mvp"]')) && H.reads.some((x) => x.name === "award_ballots" && x.args.f.season_id === SID));
  const cand = await p.evaluate(() => { const o = document.querySelector('[data-cc-vote="mvp"] option[value]:not([value=""])'); return o ? o.value : null; });
  await p.click('[data-cc-votesave="mvp"]');
  A("Save vote with no pick is refused in place, nothing written", /Pick a player first/.test(await txt(p, "#ccAwards [data-cc-awerr]")) && calls(p).length === 2);
  if (cand) {
    await p.selectOption('[data-cc-vote="mvp"]', cand); await p.click('[data-cc-votesave="mvp"]');
    A("a vote is award_ballots.upsert on season, category and voter, the commissioner's own", await until(p, () => true) && calls(p)[2] && calls(p)[2].rpc === "award_ballots.upsert" && calls(p)[2].args.row.category === "mvp" &&
      calls(p)[2].args.row.profile_id === cand && calls(p)[2].args.row.season_id === SID && !!calls(p)[2].args.row.voter_id && calls(p)[2].args.onConflict === "season_id,category,voter_id", calls(p)[2]);
  }
  await p.waitForSelector('[data-cc-final="mvp"]'); await p.click('[data-cc-final="mvp"]'); await p.waitForSelector('.sheet [data-cf="ok"]'); await ok(p);
  A("Finalize is finalize_season_award for this season and category, after a confirm", await until(p, () => true) && calls(p).some((c) => c.rpc === "finalize_season_award" && c.args.p_season === SID && c.args.p_category === "mvp") && await toastSaid(p, /TestWinner wins Most Valuable Player/));
  await done(p);
  p = await page("#/control", { persona: "commissioner", read: officeRead, writes: { "feature_flags.update": mock.fail("S2_NO_ROWS", "Nothing was saved: the league wrote no row (signed out, or not allowed)"),
    "news.insert": mock.fail("42501", "new row violates row-level security policy for table news") } });
  const rk = await p.getAttribute("[data-cc-flag]", "data-cc-flag"), ron = await p.getAttribute("[data-cc-flag]", "aria-checked");
  await p.click('[data-cc-flag="' + rk + '"]');
  A("a refused switch says the league's words in place and stays as saved", await until(p, () => { const e = document.querySelector("#ccFlags [data-cc-flerr]"); return e && !e.hidden && /Not saved: Nothing was saved/.test(e.textContent); }) &&
    (await p.getAttribute('[data-cc-flag="' + rk + '"]', "aria-checked")) === ron && !(await p.getAttribute('[data-cc-flag="' + rk + '"]', "disabled")), await txt(p, "#ccFlags [data-cc-flerr]"));
  await p.fill("#ccNwTitle", "A refused story"); await p.fill("#ccNwBody", "Kept as typed."); await p.click("[data-cc-nwpost]"); await p.waitForSelector('.sheet [data-cf="ok"]'); await ok(p);
  A("a refused story shows the league's words in the sheet and keeps what was typed", await until(p, () => { const e = [...document.querySelectorAll(".sheet [data-cc-err]")].pop(); return e && !e.hidden && /row-level security policy for table news/.test(e.textContent); }) &&
    (await p.$eval("#ccNwTitle", (e) => e.value)) === "A refused story" && (await p.$eval("#ccNwBody", (e) => e.value)) === "Kept as typed.");
  await done(p);
  p = await page("#/control?tab=staff", { persona: "commissioner", read: officeRead, writes: { set_member_role: mock.ok(null) } });
  await p.fill("#ccRoleQ", "Test"); await p.press("#ccRoleQ", "Enter");
  A("the member search reads profiles by gamertag, repainting only the results", await until(p, () => !!document.querySelector('[data-cc-role="p-target"]')) && H.reads.some((x) => x.name === "profiles" && x.args.f["ilike:gamertag"] === "%Test%") && (await p.$eval("#ccRoleQ", (e) => e.value)) === "Test");
  await p.selectOption('[data-cc-role="p-target"]', "staff");
  A("choosing a role asks first and the list keeps the saved role meanwhile", await until(p, () => /Make TestMember Staff\?/.test((document.querySelector(".sheet") || {}).textContent || "")) && (await p.$eval('[data-cc-role="p-target"]', (e) => e.value)) === "member");
  await ok(p);
  A("then set_member_role with the member, the role and no club", await until(p, () => true) && calls(p)[0] && calls(p)[0].rpc === "set_member_role" && calls(p)[0].args.p_target === "p-target" && calls(p)[0].args.p_role === "staff" && calls(p)[0].args.p_team_code === null, calls(p)[0]);
  await done(p);
  p = await page("#/control?tab=tonight", { persona: "commissioner", season: 1, read: officeRead, writes: { reopen_game_final: mock.ok(null), ops_reschedule_game: mock.ok(null) } });
  await p.waitForSelector("#ccFix #ccFixG", { timeout: 8000 }).catch(() => null);
  const fin = await p.evaluate(() => { const g = S2.M.games.filter((x) => x.isFinal && x.stage !== "preseason").slice(-1)[0]; return g ? { id: g.id, home: g.home, away: g.away } : null; });
  A("the Tonight tab offers the game tools over the season on screen", !!(await p.$("#ccFix #ccFixG")) && !!fin);
  await p.selectOption("#ccFixG", fin.id); await p.click("[data-cc-move]");
  A("a final cannot be moved: refused in place, nothing written", /A final cannot be moved/.test(await txt(p, "#ccFix [data-cc-fixerr]")) && calls(p).length === 0);
  await p.click("[data-cc-reopen]"); await p.waitForSelector('.sheet [data-cf="ok"]');
  A("Re-open asks first, naming the game", new RegExp("Re-open " + fin.away + " at " + fin.home + "\\?").test(await txt(p, ".sheet")));
  await ok(p);
  A("then reopen_game_final for that game", await until(p, () => true) && calls(p)[0] && calls(p)[0].rpc === "reopen_game_final" && calls(p)[0].args.p_game === fin.id, calls(p)[0]);
  /* a game still to play: one is added to the model in the page, so the move's door can be driven */
  await p.evaluate((f) => { S2.M.games.push({ id: "g-up", week: 9, stage: "regular", at: "2026-12-17T02:00:00.000Z", home: f.home, away: f.away, isFinal: false, status: "scheduled" }); }, fin);
  await p.click('[data-cc-tab="overview"]'); await wait(200); await p.click('[data-cc-tab="tonight"]'); await p.waitForSelector("#ccFixG");
  await p.selectOption("#ccFixG", "g-up");
  A("picking a game fills its current time, in Eastern", (await p.$eval("#ccFixAt", (e) => e.value)) === "2026-12-16T21:00");
  await p.fill("#ccFixAt", "2026-12-18T22:10"); await p.click("[data-cc-move]"); await p.waitForSelector('.sheet [data-cf="ok"]'); await ok(p);
  A("Move is ops_reschedule_game with the game and the new instant (10:10 PM ET is 03:10 UTC)", await until(p, () => true) && calls(p)[1] && calls(p)[1].rpc === "ops_reschedule_game" && calls(p)[1].args.p_game === "g-up" && calls(p)[1].args.p_at === "2026-12-19T03:10:00.000Z", calls(p)[1]);
  await done(p);

  console.log("## the live read repaints only what it feeds: nothing typed is wiped when it answers");
  /* review 2026-11-24: the answer to s2_control() and ops_job_health() rebuilt the whole pane, wiping a headline being
     typed, a gamertag search or a game picker. Here the two reads answer 1.5 seconds late, after the reader has started */
  const slow = (body) => () => new Promise((res) => setTimeout(() => { H.slowDone = (H.slowDone || 0) + 1; res({ data: body }); }, 1500));
  const slowRead = baseRead({ "rpc:s2_control": slow(SC), "rpc:ops_job_health": slow(JH), "from:award_ballots": () => ({ data: [] }),
    "from:profiles": () => ({ data: [{ id: "p-target", gamertag: "TestMember", display_name: null, role: "member" }] }) });
  const bothAnswered = async () => { for (let i = 0; i < 80 && (H.slowDone || 0) < 2; i++) await wait(100); await wait(300); return (H.slowDone || 0) >= 2; };
  p = await page("#/control", { persona: "commissioner", read: slowRead });
  await p.fill("#ccNwTitle", "Half a headline"); await p.click("#ccNwBody"); await p.keyboard.type("Still typing");
  A("the reads answer while a story is being typed", (H.slowDone || 0) < 2 && await bothAnswered());
  A("the league-today sentence takes the read's " + SC.pop.present + " members", await until(p, (n) => (document.getElementById("ccToday") || {}).textContent.replace(/\s+/g, " ").indexOf(n + " members") >= 0, Number(SC.pop.present).toLocaleString("en-US")), await txt(p, "#ccToday"));
  A("and the headline, the story and the focus stay where the reader left them", (await p.$eval("#ccNwTitle", (e) => e.value)) === "Half a headline" && (await p.$eval("#ccNwBody", (e) => e.value)) === "Still typing" &&
    await p.evaluate(() => document.activeElement && document.activeElement.id === "ccNwBody"));
  await done(p);
  p = await page("#/control?tab=staff", { persona: "commissioner", read: slowRead });
  await p.fill("#ccRoleQ", "Test");
  A("a gamertag search and its results survive the reads answering", (H.slowDone || 0) < 2 && await bothAnswered() && (await p.$eval("#ccRoleQ", (e) => e.value)) === "Test" &&
    await until(p, () => !!document.querySelector('[data-cc-role="p-target"]')) && await p.evaluate(() => document.activeElement && document.activeElement.id === "ccRoleQ"));
  await done(p);
  p = await page("#/control?tab=tonight", { persona: "commissioner", season: 1, read: slowRead });
  await p.waitForSelector("#ccHealth", { timeout: 8000 }).catch(() => null);
  r = await txt(p, "#ccHealth");
  A("before ops_job_health() answers, Tonight's health lines say they are reading it, never missing (review 2026-11-25)", (H.slowDone || 0) < 1 && /Reading the job health/.test(r || "") && !/missing|Not found/.test(r || ""), { said: r, answered: H.slowDone || 0 });
  await p.waitForSelector('#ccFixG option:not([value=""])', { timeout: 8000, state: "attached" }).catch(() => null);
  const fx = await p.evaluate(() => { const o = document.querySelector('#ccFixG option:not([value=""])'); return o ? o.value : null; });
  if (fx) { await p.selectOption("#ccFixG", fx); await p.fill("#ccFixAt", "2026-12-18T22:10"); }
  A("a game picked and a new time typed on Tonight survive the reads answering", !!fx && (H.slowDone || 0) < 2 && await bothAnswered() &&
    (await p.$eval("#ccFixG", (e) => e.value)) === fx && (await p.$eval("#ccFixAt", (e) => e.value)) === "2026-12-18T22:10", fx);
  A("and once it answers, the lines are the read's", await until(p, () => /EA poller on the VM/.test((document.getElementById("ccHealth") || {}).textContent || "")), await txt(p, "#ccHealth"));
  await done(p);

  /* i3d (2026-11-25): the parts that read the league instead of the concept's samples */
  console.log("## what the page shows when a read is refused, and what it reads in place of the old samples");
  p = await page("#/control", { persona: "commissioner", read: baseRead({ "rpc:s2_control": () => ({ data: null, error: { code: "42501", message: "commissioners only" } }), "rpc:ops_job_health": () => ({ data: JH }) }) });
  A("a refused s2_control() is said in the league-today sentence, with no figure shown (review: it showed the model's numbers)",
    await until(p, () => /could not be read/.test((document.getElementById("ccToday") || {}).textContent || ""), null, 8000) && /commissioners only/.test(await txt(p, "#ccToday")) && !/\d\s*members|signed up/.test(await txt(p, "#ccToday")), await txt(p, "#ccToday"));
  A("the Staff Desk column is the desk's own queue, read for this page (empty office: clear)", await until(p, () => /The Staff Desk is clear/.test((document.getElementById("ccAttn") || {}).textContent || ""), null, 8000), await txt(p, "#ccAttn"));
  A("no Transactions band from the demo", !(await p.$("#ccTx")) && !(await p.$("[data-cc-rev]")));
  A("gaps: the overview sends a reversal or a resend to the one trade ledger, the Staff Desk's Transactions pane", !!(await p.$('#ccPane a.arrow[href="#/desk?tab=transactions"]')));
  await done(p);
  /* review 2026-11-25: with s2_control answering and ops_job_health refused, the sentence showed the model's 0 members as
     the league's count, and Tonight said "Heartbeat missing" and "Not found" */
  p = await page("#/control", { persona: "commissioner", read: baseRead({ "rpc:s2_control": () => ({ data: SC }), "rpc:ops_job_health": () => ({ data: null, error: { code: "42501", message: "commissioners only" } }) }) });
  A("a refused ops_job_health() leaves s2_control()'s " + SC.pop.present + " members standing, and the sentence says the job read was refused",
    await until(p, (n) => ((document.getElementById("ccToday") || {}).textContent || "").replace(/\s+/g, " ").indexOf(n + " members") >= 0, Number(SC.pop.present).toLocaleString("en-US"), 8000) &&
    /refused ops_job_health\(\) \(commissioners only\)/.test(await txt(p, "#ccToday")), await txt(p, "#ccToday"));
  await p.click('[data-cc-tab="tonight"]');
  A("and Tonight's health lines say the job read was refused, in the league's words, never missing or not found", await until(p, () => /could not be read/.test((document.getElementById("ccHealth") || {}).textContent || "")) &&
    /refused ops_job_health\(\) \(commissioners only\)/.test(await txt(p, "#ccHealth")) && !/missing|Not found/.test(await txt(p, "#ccHealth")), await txt(p, "#ccHealth"));
  await done(p);
  const ANS = [{ answers: { positions: "Keep positions open", nights: ["Monday"], perWeek: "3", xfGoldNone: true, wish: "Placeholder wish." }, source: "daily", finished_at: "2026-11-20T02:00:00Z" },
    { answers: { positions: "Keep positions open", nights: ["Tuesday"] }, source: "signup", finished_at: "2026-11-21T02:00:00Z" }];
  p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead({ "rpc:season_survey_results": (a) => ({ data: { responses: ANS } }) }) });
  if (await p.evaluate(() => !!(S2.survey && S2.SURVEY_ON))) {
    A("the survey counts the league's answers (season_survey_results), never a sample set or a switch", await until(p, () => /2 answers so far/.test((document.getElementById("ccSvHead") || {}).textContent || ""), null, 8000) &&
      H.reads.some((x) => x.name === "season_survey_results" && x.args.p_survey) && !(await p.$("[data-cc-svsample]")) && !(await p.$("#ccSv .chip.sample")), await txt(p, "#ccSv"));
    await done(p);
    p = await page("#/control?tab=setup", { persona: "commissioner", read: baseRead({ "rpc:season_survey_results": () => ({ data: null, error: { code: "42501", message: "SURVEY: commissioners only" } }) }) });
    A("a refused survey read is said in the league's words, with Try again", await until(p, () => /could not be read/.test((document.getElementById("ccSvHead") || {}).textContent || ""), null, 8000) &&
      /commissioners only/.test(await txt(p, "#ccSv")) && !!(await p.$("[data-cc-svretry]")), await txt(p, "#ccSv"));
  }
  await done(p);
  p = await page("#/control?tab=staff", { persona: "commissioner" });
  A("the Staff tab reads the seats and the staff list from the Staff Desk's reads, never placeholder officials", await until(p, () => /committees have a manager/.test((document.getElementById("ccMgrHead") || {}).textContent || ""), null, 8000) &&
    !/Official [A-J]\b/.test(await txt(p, "#ccPane")) && !(await p.$("#ccPane .chip.sample")) && /0 of 6 committees have a manager/.test(await txt(p, "#ccMgrHead")), await txt(p, "#ccMgrHead"));
  await done(p);
  /* gaps (2026-11-25): the review saw 0 staff and a threshold computed from 0. The pane counts s2_desk()'s staff list (its
     staff_directory) and the vote from staff_voter_count(), the real electorate (11 voters, 6 to pass on 2026-11-24) */
  const STAFF = [{ id: "u-c1", gamertag: "Commissioner A", role: "commissioner" }, { id: "u-s1", gamertag: "Staffer B", role: "staff" }, { id: "u-s2", gamertag: "Staffer C", role: "staff" }, { id: "u-s3", gamertag: "Staffer D", role: "staff" }];
  p = await page("#/control?tab=staff", { persona: "commissioner", read: { "rpc:s2_desk": () => ({ data: { staff: STAFF, suspensions: [], activity: [] } }), "rpc:staff_voter_count": () => ({ data: 11 }) } });
  A("gaps: the Staff tab counts s2_desk()'s staff list and lists every member of it", await until(p, () => /^3 staff, six committees$/.test((document.getElementById("ccStaffHead") || {}).textContent || ""), null, 8000) &&
    (await p.$$("#ccStaffList li")).length === 4 && /Commissioner A/.test(await txt(p, "#ccStaffList")) && /3 staffers and one commissioner in one list/.test(await txt(p, "#ccPane")), await txt(p, "#ccStaffHead"));
  A("gaps: the vote threshold comes from staff_voter_count(), more than half of 11: 6 of 11 today", /: 6 of 11 today\./.test(await txt(p, "#ccPane .cc-decs")) && H.reads.some((q) => q.kind === "rpc" && q.name === "staff_voter_count"), await txt(p, "#ccPane .cc-decs"));
  await done(p);
  p = await page("#/control?tab=tonight", { persona: "commissioner" });
  A("Tonight draws the league's own night under the real clock, with no made-up lineup, import or door rows", await until(p, () => !!document.getElementById("ccClock"), null, 8000) &&
    !(await p.$("[data-cc-lineup], [data-cc-ingest], [data-cc-door]")) && !(await p.$("#ccPane .chip.sample")) && !!(await p.$("#ccHealth")), await txt(p, ".cc-night"));
  await done(p);

  /* review 2026-11-25: Tonight counted and labeled only final, live and upcoming, so from 30 minutes after puck drop until
     the result arrived a game was counted nowhere, its slot said "Up next" and it showed its start time. The night here has
     every state M.gameState gives, read at 10:20 PM ET: a final at 9:00, a game past its live window with no final at
     9:35, a live one at 10:10 and one up next at 11:00 (the Season 2 recording has no games, so these are added to it) */
  const NIGHT_AT = "2026-12-16T03:20:00Z";
  const nightLeague = (a) => {
    const body = mock.league(a);
    if (!body.games) return body;
    const t = mock.league({ p_sections: ["teams"] }).teams, row = mock.league({ p_season: 1, p_sections: ["games"] }).games[0];
    const game = (n, hm, status, hs, as) => Object.assign({}, row, { id: "00000000-0000-4000-8000-0000000c0de" + n, season_id: SID, stage: "regular", week: 1, status: status,
      home: t[2 * n].code, away: t[2 * n + 1].code, home_team_id: t[2 * n].id, away_team_id: t[2 * n + 1].id, home_score: hs, away_score: as, went_ot: false, forfeit: null, forfeit_team_id: null,
      voided: false, ea_match_id: null, home_shots: null, away_shots: null, rescheduled_from: null, scheduled_at: "2026-12-16T" + hm + ":00+00:00" });
    body.games = body.games.concat([game(0, "02:00", "final", 3, 2), game(1, "02:35", "scheduled", null, null), game(2, "03:10", "scheduled", null, null), game(3, "04:00", "scheduled", null, null)]);
    body.generated = NIGHT_AT;   /* the model's clock (M.now) is the read's moment */
    return body;
  };
  /* gaps (2026-11-25): tonight's filed sheets (game_lineups): the 11:00 game's home club has its full six, the 10:10 game's
     home club four of six, nobody else any */
  const LT = mock.league({ p_sections: ["teams"] }).teams, GID = (n) => "00000000-0000-4000-8000-0000000c0de" + n;
  const LU = [{ game_id: GID(3), team_id: LT[6].id, center: "a", lw: "b", rw: "c", ld: "d", rd: "e", goalie: "f" }, { game_id: GID(2), team_id: LT[4].id, center: "a", lw: "b", rw: "c", ld: "d", rd: null, goalie: null }];
  p = await page("#/control?tab=tonight", { persona: "commissioner", at: NIGHT_AT, read: { "rpc:s2_league": (a) => ({ data: nightLeague(a) }), "from:game_lineups": () => ({ data: LU }) } });
  await until(p, () => document.querySelectorAll(".cc-slot").length === 4, null, 8000);
  r = await txt(p, ".cc-night-s");
  A("Tonight counts every game's state, a result pending included", /^1 final, 1 live, 1 result pending, and 1 up next\./.test(r || ""), r);
  const slotSay = await p.$$eval(".cc-slot-h", (hs) => hs.map((h) => [...h.children].map((c) => c.textContent.trim()).join(" ")));
  A("a slot whose game is past its live window reads In progress, never Up next", JSON.stringify(slotSay) === JSON.stringify(["9:00 PM ET Final, 1 game", "9:35 PM ET In progress, 1 game", "10:10 PM ET In progress, 1 game", "11:00 PM ET Up next, 1 game"]), slotSay);
  const fxSay = await p.$$eval(".cc-fx .cc-fx-s", (xs) => xs.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  A("that game reads Result pending, not its start time; only the game up next shows a time", fxSay[0] === "Final" && fxSay[1] === "Result pending" && /^Live ?10 min in$/.test(fxSay[2]) && fxSay[3] === "11:00 PM", fxSay);
  /* gaps (2026-11-25): the classic Schedule desk's "Tonight's lineups" (CG.renderLineupReadiness), ported: each game still to
     be decided says, per club, whether its full six is on file and the minutes to that game's lock; read-only */
  await until(p, () => !/Reading the lineups/.test(document.querySelector("#ccPane").textContent), null, 8000);
  const lu = await p.$$eval(".cc-fx", (xs) => xs.map((x) => [...x.querySelectorAll("[data-cc-lu] .cc-fx-c")].map((c) => [...c.children].map((k) => k.textContent.trim()).join(" "))));
  A("gaps: tonight's lineups, per club: full six on file, how many of six, and the minutes to the game's lock; the final shows none",
    JSON.stringify(lu) === JSON.stringify([[], [LT[3].code + " lineup Locked, none filed", LT[2].code + " lineup Locked, none filed"], [LT[5].code + " lineup Locked, none filed", LT[4].code + " lineup Locked with 4 of six"],
      [LT[7].code + " lineup None filed, 10 min to the lock", LT[6].code + " lineup Full six on file"]]), lu);
  A("gaps: the lineups are one read of game_lineups for the games still to be decided, nothing written", H.reads.filter((q) => q.name === "game_lineups").length >= 1 && calls(p).length === 0, H.reads.filter((q) => q.name === "game_lineups"));
  await done(p);

  console.log("## qa: the Overview's seats and season line, the club editor's lede and a refused links read, a one-reading chart");
  p = await page("#/control", { persona: "commissioner", read: baseRead({ "rpc:s2_control": () => ({ data: SC }), "rpc:ops_job_health": () => ({ data: JH }) }) });
  await until(p, () => /Staff Desk is clear|Reading the Staff Desk/.test((document.getElementById("ccAttn") || {}).textContent || ""), null, 8000);
  const seatRows = await p.$$eval("#ccAttn .cc-arow .title", (xs) => xs.map((x) => x.textContent).filter((t) => /: no (Owner|GM|AGM)/.test(t)));
  const ovCount = await p.evaluate(() => (document.querySelector('[data-cc-tab="overview"] .count') || {}).textContent);
  const allRows = (await p.$$("#ccAttn .cc-arow")).length;
  A("qa (visual 18, function 14): one row per club at most, and no AGM row before the draft (the recording's draft is not done)",
    seatRows.length > 0 && seatRows.length <= F.teams.length && seatRows.every((t) => !/AGM/.test(t)) && !/is seated for the/.test(await txt(p, "#ccAttn")), seatRows);
  A("qa: the Overview tab's count is the rows it lists", ovCount === String(allRows), { ovCount, allRows });
  A("qa (function 14): a club with no Owner points to the owner applications on the Staff Desk", !!(await p.$('#ccAttn a.cc-arow[href="#/desk?tab=applications"]')) && /owner applications on the Staff Desk/.test(await txt(p, "#ccAttn")));
  const band = await p.$$eval("#ccPane .sec-head", (xs) => (xs.filter((x) => /regular season/.test(x.textContent))[0] || {}).textContent || "");
  A("qa (function 13): the season band's playoff line is the season on screen's, never Season 1's past date", !/days ago/.test(band) && !/November 4/.test(band), band.replace(/\s+/g, " ").slice(0, 240));
  await done(p);
  p = await page("#/control?tab=clubs", { persona: "commissioner", read: clubRead });
  await until(p, () => /linked to EA/.test((document.getElementById("ccPane") || {}).textContent || ""));
  r = await txt(p, "#ccPane .sec-head");
  A("qa (visual 27): more than two seat gaps read as a count of clubs, with no AGM gap before the draft", /Front office seats are open at \d+ clubs; each row shows which\./.test(r) && !/; the /.test(r) && !/no AGM/.test(r), r);
  await done(p);
  const tFail = { on: true };
  p = await page("#/control?tab=clubs", { persona: "commissioner", quiet: /links could not be read/, read: baseRead({ "from:teams": () => (tFail.on ? { error: { code: "42703", message: "column teams.ea_club_id does not exist" } } : { data: TROWS }) }) });
  A("qa (function 22): a refused links read says so in plain words with Try again, and the link cells read Not read, never Reading",
    await until(p, () => /links could not be read/.test((document.getElementById("ccPane") || {}).textContent || ""), null, 8000) && !/does not exist/.test(await txt(p, "#ccPane")) &&
    !!(await p.$("[data-cc-txretry]")) && !(await p.$$eval(".cc-clubs .t-foot", (xs) => xs.some((x) => x.textContent === "Reading"))) && (await p.$$eval(".cc-clubs .t-foot", (xs) => xs.filter((x) => x.textContent === "Not read").length)) === 2 * F.teams.length, await txt(p, "#ccPane .sec-head"));
  tFail.on = false;
  await p.click("[data-cc-txretry]");
  A("qa: Try again reads the links again, in place", await until(p, () => /7 linked to EA/.test((document.getElementById("ccPane") || {}).textContent || ""), null, 8000) && !(await p.$("[data-cc-txretry]")), await txt(p, "#ccPane .sec-head"));
  await done(p);
  const SC1 = JSON.parse(JSON.stringify(SC)); SC1.pop.days = SC1.pop.days.slice(-1);
  p = await page("#/control?tab=growth", { persona: "commissioner", read: baseRead({ "rpc:s2_control": () => ({ data: SC1 }), "rpc:ops_job_health": () => ({ data: JH }) }) });
  A("qa (visual 26): a members series of one reading draws its point, never an empty grid", await until(p, () => !!document.querySelector('[data-cc-draw="members"] svg circle.cc-end'), null, 8000), await p.evaluate(() => (document.querySelector('[data-cc-draw="members"]') || {}).innerHTML.slice(0, 200)));
  await done(p);

  /* QA round 2 (staff, 2026-11-25): the Control Center on core's shared helpers, one definition each */
  console.log("## QA round 2 (staff): the Control Center on the shared helpers");
  const ccSrc = fs.readFileSync(path.join(process.env.S2_ROOT, "js/pages/control.js"), "utf8");
  A("qa2: control.js keeps no copy of the avatar initials; its avatars call S2.initials (js/core.js)", !/function initials\(/.test(ccSrc) && /S2\.initials\(name\)/.test(ccSrc));
  A("qa2: control.js reads through S2.rd (js/live.js), the one read door, and keeps no copy of it", /function rd\(q\) \{ return S2\.rd\(q\); \}/.test(ccSrc) && !/r\.error\.message \|\| "The league did not answer\."/.test(ccSrc));
  A("qa2: the Overview's seats and the club editor ask M.draftDone (js/model.js), not the Staff Desk's forwarder", (ccSrc.match(/!Mm\.draftDone\(\)/g) || []).length === 2 && !/S2\.draftDone/.test(ccSrc));
  p = await page("#/control", { persona: "commissioner", read: baseRead({ "rpc:s2_control": () => ({ data: SC }), "rpc:ops_job_health": () => ({ data: JH }) }) });
  await until(p, () => /Staff Desk is clear|Reading the Staff Desk/.test((document.getElementById("ccAttn") || {}).textContent || ""), null, 8000);
  await p.click('[data-cc-tab="growth"]');
  r = await p.evaluate(() => { const pane = document.getElementById("ccPane"), marks = [...pane.querySelectorAll(".c-bar, .c-draw, .c-area")];
    return { tab: pane.dataset.tab, marks: marks.length, running: marks.reduce((n, e) => n + e.getAnimations().filter((a) => a.playState === "running").length, 0) }; });
  A("qa2: a tab switch draws its charts settled, no draw-in replayed: hydrateQuiet is S2.charts.hydrate, then S2.settle (no borrowed Reduce Motion answer)",
    r.tab === "growth" && r.marks > 0 && r.running === 0 && /function hydrateQuiet\(root\) \{ S2\.charts\.hydrate\(root\); S2\.settle\(root\); \}/.test(ccSrc) && !/S2\.reduce = \{ matches: true \}/.test(ccSrc), r);
  /* every style rule on the page, with its media (the walk fixround uses for the presses) */
  const sheetRules = (pg) => pg.evaluate(() => { const out = [], walk = (list, media) => { for (const x of list) { if (x.cssRules && x.media) walk(x.cssRules, x.media.mediaText); else if (x.selectorText) out.push({ sel: x.selectorText, media: media || "",
    anim: x.style.getPropertyValue("animation") || x.style.animationName || "", t: x.style.transform || "", s: x.style.getPropertyValue("scale"), tr: x.style.getPropertyValue("transition") }); } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules, ""); } catch (e) { /* cross-origin font sheet */ } } return out; });
  const rules = await sheetRules(p);
  A("qa2: no rule names the old 'pulse' animation (no keyframes carry that name); the live dot's ring is ui.css's live-ring",
    !rules.some((x) => /(^|,\s*)pulse(\s|,|$)/.test(x.anim)) && rules.some((x) => /\.cc-dot\.live::after/.test(x.sel) && /\blive-ring\b/.test(x.anim)), rules.filter((x) => /cc-dot/.test(x.sel)));
  const ccPress = rules.filter((x) => /\.cc-[\w-]+:active/.test(x.sel)), ccMoved = [".cc-fx", ".cc-step-b", "a.cc-cr"].map((sel) => (rules.filter((x) => x.sel === sel && !x.media && x.tr)[0] || {}).tr || "");
  A("qa2: every Control Center press is the scale property (.cc-fx, .cc-step-b, a.cc-cr), none a transform, and the read-only seat card keeps no press transition",
    ccPress.length >= 3 && ccPress.every((x) => !x.t) && [".cc-fx:active", ".cc-step-b:active", "a.cc-cr:active"].every((sel) => ccPress.some((x) => x.sel === sel && /^0\.9\d*$/.test(x.s))) &&
    ccMoved.every((tr) => /\bscale\b/.test(tr) && !/\btransform\b/.test(tr)) && !rules.some((x) => x.sel === ".cc-mgr" && /\b(transform|scale)\b/.test(x.tr)), { press: ccPress.map((x) => [x.sel, x.t, x.s]), moved: ccMoved });
  await done(p);
  p = await page("#/control?tab=setup", { persona: "commissioner" });
  await wait(1500);   /* the league reads land and repaint the steps in place; a press on a step they replace reads as no press */
  const stepAt = await p.$eval('[data-cc-step="2"]', (e) => { e.scrollIntoView({ block: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
  await p.mouse.move(stepAt[0], stepAt[1]); await p.mouse.down(); await wait(250);
  r = await p.$eval('[data-cc-step="2"]', (e) => ({ scale: getComputedStyle(e).scale, transform: getComputedStyle(e).transform }));
  await p.mouse.up();
  A("qa2: a setup step presses to .99 on the scale property", r.scale === "0.99" && r.transform === "none", r);
  await done(p);
  /* A2's Control Center part: the clubs step and the club editor count the clubs and divisions from the league read, in words */
  const W = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"], divN = [...new Set(F.teams.map((t) => t.division))];
  const perDiv = divN.map((d) => F.teams.filter((t) => t.division === d).length), shape = W[F.teams.length].replace(/^./, (c) => c.toUpperCase()) + " clubs in " + W[divN.length] + " divisions" + (perDiv.every((k) => k === perDiv[0]) ? " of " + W[perDiv[0]] : "");
  p = await page("#/control?tab=setup", { persona: "commissioner" });
  const clubsStep = await p.$$eval("[data-cc-step]", (xs) => (xs.filter((x) => /Clubs/.test(x.textContent))[0] || {}).dataset.ccStep);
  await step(p, clubsStep);
  r = { sheet: await txt(p, ".sheet"), caps: await p.$$eval(".sheet .cc-divs .t-cap", (xs) => xs.map((x) => x.textContent)) };
  A("qa2: the clubs step says the league's shape from the read (" + shape + "), its divisions from the read, never typed in", r.sheet.indexOf(shape + ", one league, no tiers.") >= 0 && JSON.stringify(r.caps.slice().sort()) === JSON.stringify(divN.slice().sort()) &&
    !/>Eight clubs in two divisions/.test(ccSrc) && !/\["East", "West"\]\.map/.test(ccSrc), r);
  await done(p);
  /* a ninth club approved but not yet placed in a division: the divisions still hold four each, but the league is not
     "two divisions of four" (QA round 2 review: the even test counted the listed divisions only) */
  p = await page("#/control?tab=setup", { persona: "commissioner" });
  await p.evaluate(() => { const t = S2.M.teams[0]; S2.M.teams.push(Object.assign({}, t, { code: "ZZZ", full: "Placeholder Club", division: null })); });
  await step(p, clubsStep);
  r = await txt(p, ".sheet");
  const nine = W[F.teams.length + 1].replace(/^./, (c) => c.toUpperCase()) + " clubs in " + W[divN.length] + " divisions, one league, no tiers.";
  A("qa2: with a club in no division the clubs step names no per-division count (" + nine + ")", r.indexOf(nine) >= 0 && !/ divisions of /.test(r), r);
  await done(p);
  p = await page("#/control?tab=clubs", { persona: "commissioner", read: clubRead });
  r = await txt(p, "#ccPane .cc-cols");
  const cap = (w) => w.replace(/^./, (c) => c.toUpperCase());
  A("qa2: the club editor's league band counts the divisions and the clubs in words, as the clubs step does", (r || "").indexOf("One league, " + W[divN.length] + " divisions" + cap(W[F.teams.length]) + " clubs in the ") >= 0 && !/\d+ clubs/.test(r || ""), (r || "").slice(0, 160));
  await done(p);

  console.log("## a staffer: the Control Center is the commissioners' alone");
  p = await page("#/control?tab=setup", { persona: "staff", read: baseRead() });
  A("the staffer gets the locked page, no Control Center", !(await p.$("#ccPane")) && !(await p.$("[data-cc-step]")));
  A("no Control Center read is made and nothing is written", H.reads.length === 0 && calls(p).length === 0, { reads: H.reads, calls: calls(p) });
  await done(p);

  A("no page error or console error on the way", errors.length === 0, errors);
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL the suite crashed: " + (e && e.stack || e)); process.exit(1); });
