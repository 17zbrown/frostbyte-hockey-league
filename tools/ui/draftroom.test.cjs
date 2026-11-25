const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The live draft room (v5.00 swap, stream g4, 2026-11-24): node tools/ui/run.cjs draftroom
   The Season 2 draft (Saturday, December 12, 9 PM ET) runs on js/pages/draft.js's LIVE room when the switch lands first.
   This drives that room in headless Chromium against a minimal local stub of the client contract
   (~/Developer/cghl-private/contracts/client-api.md): S2.LIVE on, S2.session per reader, S2._writeImpl recording every
   door and answering as the database would (a confirmed pick, a refusal with the database's words, an Owner-approval
   queue), S2.ensureSb returning a fake client whose Realtime channel the suite pushes payloads through, and
   S2.load.sections recording each re-read. The fixture's Season 1 players stand in for the Season 2 sign-ups; every
   club keeps only its Owner and GM. Proves, for each door of the room: who sees it, the exact RPC and arguments, that
   nothing shows as made before the database answers, that a refusal shows the database's reason, the 3/2/1 mirror of
   draft_fits (D-SUPPLY included), the channel, the jittered reconcile, the safety re-read and the auto-advance (front
   offices, staff and commissioners only), the spread re-read when the draft completes, repaint in place (the room's node
   and a typed search survive), and no demo door (S2.override, S2.locked, S2.demo) and no sample copy in the live room.
   v5.00 swap (i3b, 2026-11-25): the mock room is gone (js/pages/draft.js runs only the live room), so every page boots as
   the site build ships it (stream h0's live mode, tools/ui/mock/index.cjs: supabase-js from vendor/, S2.LIVE by itself, the
   recorded production s2_league, no fixture), with install's page layer off so the room's own doubles above stand in for
   the client (page: false): the readings below are the same doors and payloads, now on the real boot. Deleted: "outside
   live mode the room is still the commissioner's mock" (there is no outside now). */
const PW = process.env.PLAYWRIGHT || "/Users/zackbrown/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright";
const { chromium } = require(PW);
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const S2_DET = "Red Wings";   /* the clock band names the club by its name (M.team(code).name), as the mock does */

const PERSONAS = {
  anon: { user: null, profileId: null, accessToken: null, isStaff: false, isCommissioner: false, teamId: null, teamCode: null, seat: null, committees: [] },
  gm: { user: { id: "u-gm" }, profileId: "u-gm", accessToken: "t", isStaff: false, isCommissioner: false, teamId: "team-DET", teamCode: "DET", seat: "gm", committees: [] },
  commish: { user: { id: "u-c" }, profileId: "u-c", accessToken: "t", isStaff: true, isCommissioner: true, teamId: null, teamCode: null, seat: null, committees: [] },
  manager: { user: { id: "u-m" }, profileId: "u-m", accessToken: "t", isStaff: true, isCommissioner: false, teamId: null, teamCode: null, seat: null, committees: ["draft"] },
  staff: { user: { id: "u-s" }, profileId: "u-s", accessToken: "t", isStaff: true, isCommissioner: false, teamId: null, teamCode: null, seat: null, committees: [] }
};
const MODE = process.env.S2_MODE || "fixture", PERSONA = process.env.S2_PERSONA || "anon";
const H = require(process.env.S2_MOCK);   /* the harness: every context boots the real site */
const mock = MODE === "mock" ? H : null;

/* runs in the page: turns the fixture into a Season 2 draft night and installs the stub client */
function setup(o) {
  const M = S2.M, now = Date.now();
  S2.LIVE = true;
  M.view = { season: 2 };
  M.teams.forEach((t) => { t.id = "team-" + t.code; });
  const row = M.control.season(2).settings;
  Object.assign(row, { id: "season-2", signup_deadline_at: "2026-12-12T04:59:00Z", roster_max: 12, draft_rounds: 10 });
  /* every club keeps only its Owner and GM; Detroit's are a forward and a defenseman */
  M.players.forEach((p) => { if (p.rostered && p.seat !== "Owner" && p.seat !== "GM") { p.rostered = false; p.seat = null; } });
  ["Owner", "GM"].forEach((seat, i) => { if (!M.players.some((p) => p.rostered && p.club === "DET" && p.seat === seat)) {
    const spare = M.players.filter((p) => !p.rostered && p.unit); Object.assign(spare[spare.length - 1 - i], { rostered: true, club: "DET", seat: seat, squad: "pro" }); } });
  M.players.filter((p) => p.rostered && p.club === "DET").forEach((p) => { if (p.seat === "Owner") { p.pos = "C"; p.unit = "F"; } if (p.seat === "GM") { p.pos = "LD"; p.unit = "D"; } p.squad = "pro"; p.salary = 0; });
  const free = M.players.filter((p) => !p.rostered && p.unit && p.pos);
  const take = (u, k) => free.filter((p) => p.unit === u).slice(0, k);
  let pool = take("F", 40).concat(take("D", 20), take("G", o.noGoalies ? 0 : 6));
  pool.forEach((p) => { p.tenures = []; });
  M.signups = pool.map((p) => ({ pid: p.id, tag: p.tag, pos: p.pos, status: "pending", at: "2026-12-01T00:00:00Z", player: p }));
  const late = free.filter((p) => p.unit === "F")[45];
  if (late) { late.tenures = []; M.signups.push({ pid: late.id, tag: late.tag, pos: late.pos, status: "pending", at: "2026-12-12T12:00:00Z", player: late }); window.__late = late.id; }
  window.__pool = { F: take("F", 40).map((p) => p.id), D: take("D", 20).map((p) => p.id), G: o.noGoalies ? [] : take("G", 6).map((p) => p.id) };
  const order = ["DET"].concat(M.teams.map((t) => t.code).filter((c) => c !== "DET")), nC = order.length, picks = [];
  for (let r = 1; r <= 10; r++) for (let s = 1; s <= nC; s++) {
    const c = r % 2 ? order[s - 1] : order[nC - s], ov = (r - 1) * nC + s;
    picks.push({ id: "pk-" + ov, round: r, overall_pick: ov, original_team: c, current_team: c, original_team_id: "team-" + c, current_team_id: "team-" + c, player_id: null, used: false, skipped: false, picked_at: null });
  }
  /* Detroit's first picks already made, with forwards, when a section needs a nearly full club */
  (o.detForwards ? picks.filter((k) => k.current_team === "DET").slice(0, o.detForwards) : []).forEach((k, i) => {
    k.used = true; k.player_id = window.__pool.F[i]; k.picked_at = new Date(now - 60000 + i).toISOString(); });
  const at = o.atDetPick ? picks.filter((k) => k.current_team === "DET" && !k.used)[0].overall_pick : o.current || 1;
  M.draft = o.empty ? { state: null, picks: [] } : {
    state: o.status === "none" ? null : { season_number: 2, status: o.status, pick_seconds: 120, current_overall: at,
      clock_ends_at: o.status === "live" ? new Date(now + (o.expired ? -2000 : 115000)).toISOString() : null,
      paused_remaining: o.status === "paused" ? 77 : null, order_meta: { snake: true }, updated_at: new Date(now).toISOString() },
    picks: picks };
  if (!o.mock) S2.session = JSON.parse(o.session);   /* in --mode mock the persona's session is j1's, and stays */
  Object.assign(S2._draftRoom, o.knobs || {});
  /* the stub client */
  window.__calls = []; window.__rereads = []; window.__demo = []; window.__toasts = [];
  /* every toast in the order it was raised (an error toast sits in its own lane, so the DOM order is not the time order) */
  const toast0 = S2.toast; S2.toast = function (m) { window.__toasts.push(String(m)); return toast0.apply(this, arguments); };
  window.__pickMode = o.pickMode || "confirm";
  const advance = () => { const st = M.draft.state; if (st) { const next = M.draft.picks.filter((k) => !k.used && !k.skipped && k.overall_pick > st.current_overall)[0]; st.current_overall = next ? next.overall_pick : st.current_overall; } };
  if (!o.mock) S2._writeImpl = (rpc, args, opts) => {
    window.__calls.push({ rpc: rpc, args: JSON.parse(JSON.stringify(args)), approval: opts.approval || null, sections: opts.sections || null, action: opts.action || null });
    return new Promise((res, rej) => setTimeout(() => {
      const fail = (code, message) => rej(Object.assign(new Error(message), { code: code, hint: null }));
      if (window.__refuse && window.__refuse[rpc]) return fail("P0001", window.__refuse[rpc]);
      if (rpc === "draft_make_pick") {
        if (window.__pickMode === "refuse") return fail("P0001", "That pick does not fit: after this pick the club would still need 1 goaltender to reach the roster minimums, with 1 pick left. Draft a player of another position.");
        if (window.__pickMode === "queue") return res({ data: "move-1", queued: true });
        if (window.__pickMode === "confirm") { const k = M.draft.picks.filter((x) => x.id === args.p_pick)[0]; k.used = true; k.player_id = args.p_player; k.picked_at = new Date().toISOString(); advance(); }
      }
      if (opts.repaint) opts.repaint({ data: null });
      res({ data: null });
    }, 120));
  };
  window.__rt = { joins: [], handlers: {}, cb: null, removed: 0, boardReads: [], rpcs: [] };
  window.__dept = o.dept == null ? false : o.dept;
  S2.ensureSb = () => ({
    channel(name) { const ch = { binds: [], on(ev, f, fn) { window.__rt.handlers[f.table] = fn; ch.binds.push(f.table + ":" + f.event); return ch; },
      subscribe(cb) { window.__rt.joins.push({ name: name, binds: ch.binds.slice() }); window.__rt.cb = cb; setTimeout(() => cb("SUBSCRIBED"), 0); return ch; } }; return ch; },
    removeChannel() { window.__rt.removed++; },
    /* has_department(p_key), the database's answer to "may this staffer run the draft room"; "error" refuses the read */
    rpc(name, args) { window.__rt.rpcs.push({ name: name, args: args }); const d = window.__dept;
      return Promise.resolve(d === "error" ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } : { data: d === true, error: null }); },
    /* draft_boards is the room's read; any other table (the real boot's own session reads, js/live.js) answers empty */
    from(t) { const q = { f: [], select(c) { q.sel = c; return q; }, eq(k, v) { q.f.push(k + "=" + v); return q; }, order(k) { q.o = k; return q; }, maybeSingle() { q.one = true; return q; },
      then(ok, bad) { if (t !== "draft_boards") return Promise.resolve({ data: q.one ? null : [], error: null }).then(ok, bad);
        window.__rt.boardReads.push({ t: t, f: q.f.slice(), sel: q.sel, o: q.o }); return Promise.resolve({ data: (window.__board || []).map((id, i) => ({ profile_id: id, rank: i + 1 })), error: null }).then(ok, bad); } }; return q; }
  });
  /* S2.reread, the one re-read (js/live.js), recorded: the fixture has no s2_league body to read again */
  S2.reread = (sections) => { window.__rereads.push(sections.join(",")); return Promise.resolve(true); };
  window.__push = (table, eventType, row) => window.__rt.handlers[table]({ eventType: eventType, new: row || {}, old: {} });
  /* every demo door, watched: the live room must never open one. Only a call from js/pages/draft.js counts (the shell's
     own inbox reads S2.demo.transactions; that is its owner's to wire, not the room's) */
  const fromRoom = () => /\/pages\/draft\.js/.test(new Error().stack || "");
  ["override", "locked"].forEach((k) => { const f = S2[k]; S2[k] = function () { if (fromRoom()) window.__demo.push(k); return f.apply(this, arguments); }; });
  if (S2.demo) Object.keys(S2.demo).forEach((k) => { const f = S2.demo[k]; if (typeof f === "function") S2.demo[k] = function () { if (fromRoom()) window.__demo.push("demo." + k); return f.apply(this, arguments); }; });
}

(async () => {
  const b = await chromium.launch(), errs = [];
  async function room(o) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }), p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    /* the two the room logs on purpose: a refused auto-advance and an unread draft key (both also said on the page) */
    p.on("console", (m) => { if (m.type() === "error" && !/draft_auto_advance failed|has_department\('draft'\) could not be read/.test(m.text())) errs.push(m.text()); });
    await p.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    /* main session 2026-11-25 (release check): --mode mock boots the real site too (i3f retired demo mode), so the context
       opts into live mode before the page loads, as the persona with its writes and the page layer (S2_MOCK, the session) */
    await H.install(ctx, mock ? { live: true, persona: PERSONA, writes: o.writes || {} } : { live: true, persona: "anon", page: false });
    await p.goto(S2_BASE + "#/season");
    await p.waitForFunction(() => window.S2 && S2.M && S2._draftRoom && S2.LIVE && S2.auth && S2.auth.sub, null, { timeout: 30000 });
    await p.evaluate(setup, Object.assign({ status: "live" }, o, { mock: !!mock, session: JSON.stringify(PERSONAS[o.persona || "anon"] || {}) }));
    await p.evaluate(() => { location.hash = "#/draft"; });
    await p.waitForSelector("#drRoom"); await wait(250);
    await p.evaluate(() => { document.getElementById("drRoom").__kept = 1; });
    return p;
  }
  const done = (p) => p.context().close();
  const calls = (p) => p.evaluate(() => window.__calls);
  const toast = (p) => p.evaluate(() => window.__toasts[window.__toasts.length - 1] || "");
  const kept = (p) => p.evaluate(() => document.getElementById("drRoom").__kept === 1);
  const cell = (p, n) => p.evaluate((x) => { const c = document.querySelector('[data-cell="' + x + '"]'); return c ? c.textContent + "|" + c.className : null; }, n);
  const poolIds = (p) => p.evaluate(() => [...document.querySelectorAll("#drPoolList .lg-dr-pr .lg-dr-pt")].map((a) => a.getAttribute("href").replace("#/player/", "")));

  const rpcs = (p) => p.evaluate(() => window.__rt.rpcs);
  if (mock) { await mockRun(); return; }

  console.log("## a spectator (signed out) watches the live board, read-only");
  let p = await room({ persona: "anon", knobs: { reconcile: [20, 40] } }), r;
  r = await p.evaluate(() => ({ drafts: document.querySelectorAll("[data-draft]").length, stars: document.querySelectorAll("[data-star]").length, cc: !!document.querySelector(".lg-dr-cc"),
    doors: [...document.querySelectorAll("[data-dr]")].map((x) => x.dataset.dr), clock: document.getElementById("drClock").textContent, head: document.getElementById("drHead").textContent,
    text: document.getElementById("app").textContent, joins: window.__rt.joins, rereads: window.__rereads.slice() }));
  A("no Draft button, no star, no controls: only the pool's Show more", r.drafts === 0 && r.stars === 0 && !r.cc && r.doors.every((d) => d === "more"), r);
  A("the clock runs from the league's clock_ends_at", /^1:5\d$/.test(r.clock), r.clock);
  A("Detroit is first on the clock", r.head === S2_DET, r.head);
  A("the room joins the draft-live channel on draft_state and draft_picks", r.joins.length === 1 && r.joins[0].name === "draft-live" && r.joins[0].binds.join() === "draft_state:*,draft_picks:*", r.joins);
  A("entering a running draft reads nothing more (the pulse and the channel keep it)", r.rereads.length === 0, r.rereads);
  A("no sample chip, no mock or demo copy in the live room", !/\(demo\)|\bsample\b|\bmock\b/i.test(r.text), (r.text.match(/.{40}(\(demo\)|\bsample\b|\bmock\b).{40}/i) || [""])[0]);
  const pid1 = (await poolIds(p))[0];
  await p.evaluate((pid) => { window.__push("draft_picks", "UPDATE", { id: "pk-1", season_number: 2, round: 1, overall_pick: 1, original_team_id: "team-DET", current_team_id: "team-DET", player_id: pid, used: true, skipped: false, picked_at: new Date().toISOString() });
    window.__push("draft_state", "UPDATE", { season_number: 2, status: "live", current_overall: 2, pick_seconds: 120, clock_ends_at: new Date(Date.now() + 120000).toISOString(), paused_remaining: null }); }, pid1);
  await wait(150);
  r = await p.evaluate(() => ({ head: document.getElementById("drHead").textContent, last: (document.querySelector(".lg-dr-last") || {}).textContent || "" }));
  A("a pick's payload lands at once: cell 1 names the player, the last pick line too", /made/.test(await cell(p, 1)) && r.last.length > 10, [await cell(p, 1), r.last]);
  A("the drafted player leaves the pool", (await poolIds(p)).indexOf(pid1) < 0);
  A("the next club is on the clock", /On the clock/.test(await cell(p, 2)) && r.head !== S2_DET && r.head.length > 0, r.head);
  /* QA motion 4 (2026-11-25): a pick that lands is marked where the eye is, its board cell and its row in the round list
     (when that round is shown), with a color fade from the accent (kept under Reduce Motion: color only) */
  const fading = (q, sel) => q.evaluate((sel) => sel.map((s) => { const el = document.querySelector(s); return el ? el.getAnimations().some((a) => a.playState === "running" && a.effect && a.effect.getKeyframes().some((k) => "backgroundColor" in k)) : null; }), sel);
  r = await fading(p, ['#drRoom [data-cell="1"]', "#drp1"]);
  A("the pick that landed fades from the accent on its board cell and its round row", r[0] === true && r[1] !== false, r);
  A("repainted in place: the room's node survives", await kept(p));
  await wait(150);
  A("a spectator does not reconcile after a pick (v2.71: the payload is enough)", (await p.evaluate(() => window.__rereads.length)) === 0);
  await p.evaluate(() => window.__push("draft_picks", "DELETE", { id: "pk-80" })); await wait(120);
  A("a DELETE (a board regenerated) re-reads the draft for everyone", (await p.evaluate(() => window.__rereads.slice(-1)[0])) === "draft");
  await p.evaluate(() => S2.live.emit("picks", { sections: ["draft"] })); await wait(80);
  A("a league pulse repaints the room in place", await kept(p));
  /* the rejoin is held back while the line is read, then let go (the tick joins at most every resub ms) */
  await p.evaluate(() => { S2._draftRoom.resub = 600000; window.__rt.cb("CHANNEL_ERROR"); }); await wait(150);
  r = await p.evaluate(() => ({ line: (document.querySelector('#drNow [role="status"]') || {}).textContent || "", removed: window.__rt.removed }));
  A("a dead channel is let go and said: the board refreshes itself every 90 seconds until it is back", r.removed === 1 && /Reconnecting to the live board\. Until it is back, the board refreshes itself every 90 seconds\./.test(r.line), r);
  await p.evaluate(() => { S2._draftRoom.resub = 0; }); await wait(400);
  r = await p.evaluate(() => ({ joins: window.__rt.joins.length, line: !!document.querySelector('#drNow [role="status"]') }));
  A("the tick joins a new channel, and the line goes", r.joins === 2 && !r.line, r);
  await p.evaluate(() => { const st = S2.M.draft.state; window.__push("draft_state", "UPDATE", { season_number: 2, status: "live", current_overall: st.current_overall, pick_seconds: 120, clock_ends_at: new Date(Date.now() - 3000).toISOString() }); });
  await wait(2200);
  A("a spectator never advances an expired clock", (await calls(p)).length === 0, await calls(p));
  A("no demo door was opened", (await p.evaluate(() => window.__demo)).length === 0, await p.evaluate(() => window.__demo));
  await done(p);

  console.log("## Detroit's GM on the clock");
  p = await room({ persona: "gm", pickMode: "silent", knobs: { boardSave: 100 } });
  r = await p.evaluate(() => ({ hot: document.querySelectorAll('#drPoolList [data-draft]:not(.secondary)').length, stars: document.querySelectorAll("#drPoolList [data-star]").length,
    cc: !!document.querySelector(".lg-dr-cc"), start: !!document.querySelector('[data-dr="start"]'), reads: window.__rt.boardReads, toast: window.__toasts.join(" | ") }));
  A("the pool's Draft buttons are live and every row has a star", r.hot > 10 && r.stars > 10, r);
  A("a GM sees no room controls, and is never asked for the draft key (not staff)", !r.cc && !r.start && (await rpcs(p)).length === 0);
  A("the club's board is read from draft_boards: this season, this club, by rank", r.reads.length === 1 && r.reads[0].t === "draft_boards" && r.reads[0].f.join() === "season_id=season-2,team_id=team-DET" && r.reads[0].o === "rank" && r.reads[0].sel === "profile_id,rank", r.reads);
  A("the GM is told they are on the clock", /You are on the clock: 120 seconds/.test(r.toast || ""), r.toast);
  let pid = (await poolIds(p))[0];
  await p.click('#drPoolList [data-draft="' + pid + '"]'); await wait(30);
  r = await p.evaluate((x) => { const b = document.querySelector('#drPoolList [data-draft="' + x + '"]'); return { t: b.textContent, d: b.disabled, others: [...document.querySelectorAll("#drPoolList [data-draft]")].every((y) => y.disabled) }; }, pid);
  A("while the pick is in flight its button says Drafting and every Draft button waits", r.t === "Drafting" && r.d && r.others, r);
  await wait(250);
  let c = (await calls(p))[0];
  A("the pick is draft_make_pick on the clock's pick, through the Owner-approval door, re-reading the draft and rosters",
    c.rpc === "draft_make_pick" && c.args.p_pick === "pk-1" && c.args.p_player === pid && c.approval === "owner" && c.sections.join() === "draft,rosters", c);
  A("a write that changed nothing on record shows nothing made: cell 1 still on the clock, the player still in the pool", /On the clock/.test(await cell(p, 1)) && (await poolIds(p)).indexOf(pid) >= 0, await cell(p, 1));
  await p.evaluate(() => { window.__pickMode = "refuse"; });
  await p.click('#drPoolList [data-draft="' + pid + '"]'); await wait(300);
  r = { toast: await toast(p), btn: await p.evaluate((x) => { const b = document.querySelector('#drPoolList [data-draft="' + x + '"]'); return b.textContent + "|" + b.disabled; }, pid) };
  A("a refused pick shows the database's own reason, and the button is back", r.toast === "Not drafted: That pick does not fit: after this pick the club would still need 1 goaltender to reach the roster minimums, with 1 pick left. Draft a player of another position." && r.btn === "Draft|false", r);
  A("refused: still nothing made", /On the clock/.test(await cell(p, 1)));
  await p.evaluate(() => { window.__pickMode = "queue"; });
  await p.click('#drPoolList [data-draft="' + pid + '"]'); await wait(300);
  A("a GM whose Owner approves draft moves is told the pick went to the Owner", /^Sent to your Owner for approval: .+ is drafted only if they approve it while your club is still on the clock$/.test(await toast(p)), await toast(p));
  await p.evaluate(() => { window.__pickMode = "confirm"; });
  await p.click('#drPoolList [data-draft="' + pid + '"]'); await wait(300);
  r = await p.evaluate(() => ({ sum: document.querySelector(".lg-dr-sum").textContent, roster: [...document.querySelectorAll(".lg-dr-roster li")].map((x) => x.textContent) }));
  A("confirmed: the pick shows as made, the player leaves the pool, the club card counts them", /made/.test(await cell(p, 1)) && (await poolIds(p)).indexOf(pid) < 0 && /^3 of 12 spots filled/.test(r.sum), r.sum);
  A("the club card lists the seated Owner and GM, then the pick at round one's pay", /^SeatedOwner/.test(r.roster[0]) && /^SeatedGeneral Manager/.test(r.roster[1]) && /R1.+\$3M$/.test(r.roster[2]), r.roster.slice(0, 3));
  A("the success toast names the player and the club", /to the Detroit Red Wings$/.test(await toast(p)), await toast(p));
  pid = (await poolIds(p))[0];
  await p.click('#drPoolList [data-draft="' + pid + '"]'); await wait(80);
  A("off the clock, Draft says whose turn it is and sends nothing", /are on the clock \(round 1, pick 2\)\. Your next selection is round 2, pick \d+, \d+th overall\./.test(await toast(p)) && (await calls(p)).length === 4, await toast(p));
  await p.click('#drPoolList [data-star="' + pid + '"]'); await wait(250);
  c = (await calls(p)).slice(-1)[0];
  A("a star saves the club's board whole: save_draft_board with the club and the ranked ids, Owner approval", c.rpc === "save_draft_board" && c.args.p_team === "team-DET" && JSON.stringify(c.args.p_players) === JSON.stringify([pid]) && c.approval === "owner" && c.action === "save_draft_board", c);
  A("the board lists the player", await p.evaluate((x) => !!document.querySelector('#drBoardHost a[href="#/player/' + x + '"]'), pid));
  await p.evaluate(() => { window.__refuse = { save_draft_board: "Only this club's management can edit its draft board." }; });
  await p.click('#drPoolList [data-star="' + pid + '"]'); await wait(300);
  r = await p.evaluate(() => window.__rt.boardReads.length);
  A("a refused board save says why and reads the board back from the league", /^Your board did not save: Only this club's management can edit its draft board\.$/.test(await toast(p)) && r === 2, [await toast(p), r]);
  A("no demo door was opened", (await p.evaluate(() => window.__demo)).length === 0, await p.evaluate(() => window.__demo));
  await done(p);

  console.log("## the 3/2/1 mirror of draft_fits (Rule S2.4)");
  p = await room({ persona: "gm", detForwards: 8, atDetPick: true });
  await p.evaluate(() => { let m, i = 0; while ((m = document.querySelector('[data-dr="more"]')) && i++ < 10) m.click(); }); await wait(80);
  r = await p.evaluate(() => {
    const row = (pid) => { const a = document.querySelector('#drPoolList a[href="#/player/' + pid + '"]'); if (!a) return null; const li = a.closest("li"), b = li.querySelector("[data-draft]"); return { text: li.textContent, cls: b.className, title: b.title }; };
    return { f: row(window.__pool.F[12]), g: row(window.__pool.G[0]), d: row(window.__pool.D[0]), sum: document.querySelector(".lg-dr-sum").textContent };
  });
  A("ten of twelve after eight forward picks; needs a defenseman and a goaltender", /^10 of 12 spots filled/.test(r.sum) && /Still needs one more defenseman and a goaltender/.test(r.sum), r.sum);
  A("a forward would leave Detroit short: the row says so and the button names the database's question",
    r.f && /would leave the club short of the minimums/.test(r.f.text) && /secondary/.test(r.f.cls) && r.f.title === "After this pick the Detroit Red Wings would still need one more defenseman and a goaltender to reach the minimums, with 1 pick left (Rule S2.4).", r.f);
  A("a goaltender and a defenseman fit", r.g && !/short/.test(r.g.text) && !/secondary/.test(r.g.cls) && r.d && !/short/.test(r.d.text), [r.g, r.d]);
  await done(p);
  p = await room({ persona: "gm", detForwards: 8, atDetPick: true, noGoalies: true });
  await p.evaluate(() => { let m, i = 0; while ((m = document.querySelector('[data-dr="more"]')) && i++ < 10) m.click(); }); await wait(80);
  r = await p.evaluate(() => { const a = document.querySelector('#drPoolList a[href="#/player/' + window.__pool.F[12] + '"]').closest("li"); return a.textContent; });
  A("D-SUPPLY: with no goaltender left to draft, a forward no longer counts as leaving the club short", !/short/.test(r), r);
  await done(p);

  console.log("## the commissioner runs the room");
  p = await room({ persona: "commish", status: "none" });
  r = await p.evaluate(() => ({ doors: [...document.querySelectorAll("[data-dr]")].map((x) => x.dataset.dr).filter((d) => d !== "more"), kick: (document.querySelector(".lg-dr-cc .kicker") || {}).textContent, secs: document.querySelectorAll("[data-sec]").length }));
  A("before the start: Start the draft, the seconds and Redraw the order, under Commissioner", JSON.stringify(r.doors) === '["start","redraw"]' && r.kick === "Commissioner" && r.secs === 4, r);
  A("a commissioner is never asked for the draft key", (await rpcs(p)).length === 0);
  A("entering before the start reads the draft once (draft_state is not on the league pulse)", JSON.stringify(await p.evaluate(() => window.__rereads)) === '["draft"]', await p.evaluate(() => window.__rereads));
  await p.click('[data-sec="60"]'); await wait(60);
  A("a seconds choice before the start is the room's, not a write", (await calls(p)).length === 0 && /starts with 60 seconds/.test(await toast(p)));
  await p.click('[data-dr="start"]'); await wait(300);
  A("Start asks first, naming the seats the league requires", await p.evaluate(() => /Owner and General Manager seated/.test(document.querySelector(".sheet").textContent)));
  await p.click('.sheet [data-cf="ok"]'); await wait(300);
  c = (await calls(p))[0];
  A("start_draft with the season and the chosen seconds", c.rpc === "start_draft" && c.args.p_season_number === 2 && c.args.p_pick_seconds === 60 && c.sections.join() === "draft", c);
  await p.click('[data-dr="redraw"]'); await wait(300); await p.click('.sheet [data-cf="ok"]'); await wait(300);
  c = (await calls(p)).slice(-1)[0];
  A("Redraw is generate_draft_board: ten rounds, random, no manual order (Season 2: fully random)", c.rpc === "generate_draft_board" && JSON.stringify(c.args) === '{"p_season_number":2,"p_rounds":10,"p_style":"random","p_manual":null}', c);
  await done(p);
  p = await room({ persona: "commish", status: "live", detForwards: 1, current: 2 });
  r = await p.evaluate(() => [...document.querySelectorAll("[data-dr]")].map((x) => x.dataset.dr).filter((d) => d !== "more"));
  A("live: Pause, Reset, Skip, Reverse the last pick, Conclude", JSON.stringify(r) === '["pause","reset","skip","undo","conclude"]', r);
  await p.click('[data-dr="pause"]'); await wait(20);
  A("a door in flight is disabled until the database answers", await p.evaluate(() => document.querySelector('[data-dr="pause"]').disabled));
  await wait(250);
  await p.click('[data-dr="reset"]'); await wait(250);
  await p.click('[data-sec="30"]'); await wait(250);
  c = await calls(p);
  A("pause, reset and a new clock: draft_pause, draft_reset_clock (null), draft_reset_clock (30)",
    c[0].rpc === "draft_pause" && JSON.stringify(c[0].args) === '{"p_season_number":2}' && c[1].rpc === "draft_reset_clock" && c[1].args.p_seconds === null && c[2].rpc === "draft_reset_clock" && c[2].args.p_seconds === 30, c);
  A("a new clock says it restarts the pick now too", /reset to 30 seconds, and every pick from now gets 30 seconds/.test(await toast(p)), await toast(p));
  await p.click('[data-dr="skip"]'); await wait(300);
  A("Skip asks first and says a skip cannot be reversed, and the fill at $750K", await p.evaluate(() => { const t = document.querySelector(".sheet").textContent; return /cannot be reversed/.test(t) && /\$750K/.test(t) && /Rule S2\.3/.test(t); }));
  await p.click('.sheet [data-cf="ok"]'); await wait(300);
  await p.click('[data-dr="undo"]'); await wait(300); await p.click('.sheet [data-cf="ok"]'); await wait(300);
  await p.click('[data-dr="conclude"]'); await wait(300); await p.click('.sheet [data-cf="ok"]'); await wait(300);
  c = (await calls(p)).slice(3);
  A("skip, reverse and conclude: draft_skip_pick, draft_reverse_pick on the last pick made, draft_conclude",
    c[0].rpc === "draft_skip_pick" && c[1].rpc === "draft_reverse_pick" && c[1].args.p_pick === "pk-1" && c[1].sections.join() === "draft,rosters" && c[2].rpc === "draft_conclude" && c[2].args.p_season_number === 2, c);
  await p.evaluate(() => { window.__refuse = { draft_pause: "The draft room is run by a commissioner or the draft department." }; });
  await p.click('[data-dr="pause"]'); await wait(300);
  A("a refused control shows the database's words", (await toast(p)) === "The draft room is run by a commissioner or the draft department.", await toast(p));
  await done(p);
  p = await room({ persona: "commish", status: "paused", current: 2 });
  A("paused: the clock shows the paused remainder", (await p.evaluate(() => document.getElementById("drClock").textContent)) === "1:17");
  pid = (await poolIds(p))[0];
  await p.click('#drPoolList [data-draft="' + pid + '"]'); await wait(300);
  c = (await calls(p))[0];
  A("the commissioner picks for the club on the clock while paused, with no Owner queue", c.rpc === "draft_make_pick" && c.args.p_pick === "pk-2" && c.approval === null && /picked on their behalf \(Rule 2\.8\)$/.test(await toast(p)), [c, await toast(p)]);
  await p.click('[data-dr="resume"]'); await wait(300);
  A("Resume is draft_resume", (await calls(p)).slice(-1)[0].rpc === "draft_resume");
  A("no demo door was opened", (await p.evaluate(() => window.__demo)).length === 0, await p.evaluate(() => window.__demo));
  await done(p);

  console.log("## who runs the clock: the database's own answer (has_department('draft')), asked once");
  const doorsOf = (p) => p.evaluate(() => ({ doors: [...document.querySelectorAll("[data-dr]")].map((x) => x.dataset.dr).filter((d) => d !== "more"),
    kick: (document.querySelector(".lg-dr-cc .kicker") || {}).textContent || null, note: (document.querySelector('#drNow .lg-dr-meta[role="status"]') || {}).textContent || "" }));
  p = await room({ persona: "manager", dept: true, detForwards: 1, current: 2 });
  r = await doorsOf(p);
  A("the seated Draft and Bidding manager: the database says yes, so the clock and a skip, never reverse, conclude or the order",
    JSON.stringify(r.doors) === '["pause","reset","skip"]' && r.kick === "Draft and Bidding manager", r);
  A("asked once: has_department with p_key draft", JSON.stringify(await rpcs(p)) === '[{"name":"has_department","args":{"p_key":"draft"}}]', await rpcs(p));
  await done(p);
  p = await room({ persona: "staff", dept: false, detForwards: 1, current: 2 });
  r = await doorsOf(p);
  A("an ordinary staffer: the database says no, so no controls (the flip keeps the draft key closed to them)", r.doors.length === 0 && !r.kick && !r.note, r);
  A("the staffer was asked, once", (await rpcs(p)).length === 1);
  await done(p);
  p = await room({ persona: "staff", dept: true, detForwards: 1, current: 2 });
  r = await doorsOf(p);
  A("a staffer the database lets in (the draft department, before the flip): the controls, headed Draft staff", JSON.stringify(r.doors) === '["pause","reset","skip"]' && r.kick === "Draft staff", r);
  await done(p);
  p = await room({ persona: "staff", dept: "error", detForwards: 1, current: 2 });
  r = await doorsOf(p);
  A("an answer that did not come is said, never read as no", r.doors.length === 0 && /Whether you may run the room could not be checked \(canceling statement due to statement timeout\)\. Reload the page to try again\./.test(r.note), r);
  await done(p);

  console.log("## the clock that ran out, the safety re-read, the reconcile");
  p = await room({ persona: "gm", expired: true, current: 2, knobs: { refire: 15000 } });
  await wait(1900);
  c = (await calls(p)).filter((x) => x.rpc === "draft_auto_advance");
  A("a front office's browser asks the league to advance an expired clock, once", c.length === 1 && c[0].args.p_season_number === 2, c);
  await done(p);
  p = await room({ persona: "gm", current: 2, knobs: { beat: [300, 600], reconcile: [20, 40] } });
  await wait(1300);
  r = await p.evaluate(() => window.__rereads.filter((x) => x === "draft").length);
  A("the safety re-read runs on its beat (45 s for a front office, turned down here)", r >= 3, r);
  await p.evaluate(() => { window.__rereads = []; S2._draftRoom.beat = [60000, 90000]; window.__push("draft_picks", "UPDATE", { id: "pk-2", season_number: 2, round: 1, overall_pick: 2, original_team_id: S2.M.draft.picks[1].original_team_id, current_team_id: S2.M.draft.picks[1].current_team_id, player_id: window.__pool.D[3], used: true, skipped: false, picked_at: new Date().toISOString() }); });
  await wait(120);
  A("a front office reconciles a pick with one jittered draft-only read", JSON.stringify(await p.evaluate(() => window.__rereads)) === '["draft"]', await p.evaluate(() => window.__rereads));
  await p.fill("#drQ", "a"); await wait(60);
  await p.evaluate(() => window.__push("draft_picks", "UPDATE", { id: "pk-3", season_number: 2, round: 1, overall_pick: 3, original_team_id: S2.M.draft.picks[2].original_team_id, current_team_id: S2.M.draft.picks[2].current_team_id, player_id: window.__pool.D[4], used: true, skipped: false, picked_at: new Date().toISOString() }));
  await wait(100);
  r = await p.evaluate(() => ({ v: document.getElementById("drQ").value, f: document.activeElement && document.activeElement.id }));
  A("a pick arriving while the reader types keeps the search and its focus", r.v === "a" && r.f === "drQ" && await kept(p), r);
  await p.evaluate(() => document.getElementById("drRoom").getAnimations({ subtree: true }).forEach((a) => { if (a.effect && a.effect.getComputedTiming().endTime !== Infinity) a.finish(); }));
  await p.evaluate(() => { S2._draftRoom.done = 50; window.__rereads = []; window.__push("draft_state", "UPDATE", { season_number: 2, status: "complete", current_overall: 80, pick_seconds: 120, clock_ends_at: null, paused_remaining: null }); });
  await wait(200);
  /* QA motion 4: a jump of many picks (here to the end) is a catch-up, not a pick landing: nothing is marked */
  A("a catch-up of many picks marks no cell", await p.evaluate(() => !document.getElementById("drRoom").getAnimations({ subtree: true }).some((a) => a.playState === "running" && a.effect && a.effect.getKeyframes().some((k) => "backgroundColor" in k))));
  r = await p.evaluate(() => ({ rr: window.__rereads, head: document.getElementById("drHead").textContent, meta: document.querySelector(".lg-dr-meta").textContent }));
  A("complete: the room says so, with the fill at $750K and the pool", r.head === "The draft is over" && /filled at random about ten minutes after the draft, at \$750K/.test(r.meta) && /training camp pool \(Rule S2\.5\)/.test(r.meta), r);
  A("complete: one spread re-read of the draft, the rosters, their stints and the sign-ups", r.rr.indexOf("draft,rosters,tenures,signups") >= 0, r.rr);
  await done(p);

  console.log("## no board yet");
  p = await room({ persona: "commish", empty: true });
  r = await p.evaluate(() => ({ empty: (document.querySelector("#drRoom .lg-empty .d-3") || {}).textContent, draw: !!document.querySelector('#drRoom [data-dr="redraw"]'), now: !!document.getElementById("drNow") }));
  A("the room says there is no board yet and offers the commissioner Draw the order", r.empty === "No draft board yet" && r.draw && !r.now, r);
  await p.evaluate(() => { S2.M.teams.forEach((t, i) => window.__push("draft_picks", "INSERT", { id: "n-" + i, season_number: 2, round: 1, overall_pick: i + 1, original_team_id: t.id, current_team_id: t.id, player_id: null, used: false, skipped: false })); });
  await wait(150);
  r = await p.evaluate(() => ({ now: !!document.getElementById("drNow"), cells: document.querySelectorAll("[data-cell]").length }));
  A("a board generated elsewhere appears in place: the room's body is drawn again, not the page", r.now && r.cells === (await p.evaluate(() => S2.M.teams.length)) && await kept(p), r);
  const before = await p.evaluate(() => document.getElementById("drPoolCount").textContent);
  await p.fill("#drQ", "zzzzqq"); await wait(80);
  A("the redrawn body's search is bound", (await p.evaluate(() => document.getElementById("drPoolCount").textContent)) !== before);
  await done(p);

  console.log("## the late sign-up");
  p = await room({ persona: "anon" });
  r = await p.evaluate(() => ({ late: [...document.querySelectorAll("#drPoolList a")].some((a) => a.getAttribute("href") === "#/player/" + window.__late), count: document.getElementById("drPoolCount").textContent }));
  A("a sign-up after the cutoff is not in the pool, and the count says where they go", !r.late && /1 player signed up after the cutoff and joins the training camp pool after the draft/.test(r.count), r.count);
  await done(p);
  A("no page errors", errs.length === 0, errs.slice(0, 4));
  await b.close();
  console.log(fails ? fails + " of " + n + " FAILED" : "all " + n + " passed");
  process.exit(fails ? 1 : 0);

  /* --mode mock (tools/ui/run.cjs --suite draftroom --mode mock --persona commissioner|member|...): the persona's session
     and j1's S2.write mock (tools/ui/mock), the fixture's league as above, and the room's own fake channel, because j1's
     Realtime socket stays quiet. Every write is read back from mock.calls; the network fence must see nothing */
  async function mockRun() {
    const W = {}; ["start_draft", "draft_pause", "draft_resume", "draft_skip_pick", "draft_reset_clock", "draft_reverse_pick", "draft_make_pick", "draft_auto_advance", "generate_draft_board", "save_draft_board"].forEach((k) => { W[k] = mock.ok(null); });
    W.draft_conclude = mock.fail("P0001", "Commissioners only.");
    const last = (p) => mock.calls(p.context()).slice(-1)[0] || null;
    const fence = async (p, who) => {
      A(who + ": no demo door from the room, nothing blocked, nothing past the fence",
        (await p.evaluate(() => window.__demo.length + S2_MOCK.blocked.length)) === 0 && mock.unexpected(p.context()).length === 0, [await p.evaluate(() => [window.__demo, S2_MOCK.blocked]), mock.unexpected(p.context())]);
    };
    if (PERSONA === "commissioner") {
      console.log("## --mode mock, the commissioner: every control through j1's write mock");
      let p = await room({ status: "none", writes: W }), r;
      r = await p.evaluate(() => ({ live: S2.LIVE, commish: S2.session.isCommissioner, doors: [...document.querySelectorAll("[data-dr]")].map((x) => x.dataset.dr).filter((d) => d !== "more") }));
      A("the persona is the commissioner's, and the room is live: Start and Redraw", r.live && r.commish && JSON.stringify(r.doors) === '["start","redraw"]', r);
      A("a commissioner is never asked for the draft key", (await rpcs(p)).length === 0);
      await p.click('[data-dr="start"]'); await wait(300); await p.click('.sheet [data-cf="ok"]'); await wait(400);
      r = last(p);
      A("Start: start_draft for Season 2 at 120 seconds, recorded by the mock", r && r.rpc === "start_draft" && JSON.stringify(r.args) === '{"p_season_number":2,"p_pick_seconds":120}' && r.approval === null, r);
      await fence(p, "idle");
      await done(p);
      p = await room({ status: "live", detForwards: 1, current: 2, writes: W });
      await p.click('[data-dr="pause"]'); await wait(300);
      A("Pause: draft_pause", (last(p) || {}).rpc === "draft_pause" && JSON.stringify(last(p).args) === '{"p_season_number":2}', last(p));
      await p.click('[data-dr="skip"]'); await wait(300); await p.click('.sheet [data-cf="ok"]'); await wait(400);
      A("Skip: draft_skip_pick", (last(p) || {}).rpc === "draft_skip_pick", last(p));
      await p.click('[data-dr="undo"]'); await wait(300); await p.click('.sheet [data-cf="ok"]'); await wait(400);
      A("Reverse: draft_reverse_pick on the last pick made", (last(p) || {}).rpc === "draft_reverse_pick" && last(p).args.p_pick === "pk-1", last(p));
      await p.click('[data-dr="conclude"]'); await wait(300); await p.click('.sheet [data-cf="ok"]'); await wait(400);
      A("a refusal from the mock shows the database's words", (await toast(p)) === "Commissioners only." && (last(p) || {}).rpc === "draft_conclude", await toast(p));
      await fence(p, "live");
      await done(p);
      p = await room({ status: "paused", current: 2, writes: W });
      const pid = (await poolIds(p))[0];
      await p.click('#drPoolList [data-draft="' + pid + '"]'); await wait(400);
      r = last(p);
      A("paused: the commissioner picks for the club on the clock, no Owner queue", r && r.rpc === "draft_make_pick" && r.args.p_pick === "pk-2" && r.args.p_player === pid && r.approval === null, r);
      await p.click('[data-dr="resume"]'); await wait(300);
      A("Resume: draft_resume", (last(p) || {}).rpc === "draft_resume", last(p));
      await fence(p, "paused");
      await done(p);
    } else {
      console.log("## --mode mock, " + PERSONA + ": the live board, read-only unless the database says otherwise");
      let p = await room({ status: "live", expired: true, current: 2, writes: W }), r;
      r = await p.evaluate(() => ({ s: S2.session, drafts: document.querySelectorAll("[data-draft]").length, stars: document.querySelectorAll("[data-star]").length, cc: !!document.querySelector(".lg-dr-cc"),
        joins: window.__rt.joins.length, rr: window.__rereads.slice() }));
      const staff = !!(r.s && r.s.isStaff), seat = !!(r.s && r.s.seat);
      A("the persona's session is j1's (" + PERSONA + "), and the room joins its channel, reading nothing more while the draft runs", r.joins === 1 && r.rr.length === 0, r);
      if (!seat) A("no Draft button, no star, no controls", r.drafts === 0 && r.stars === 0 && !r.cc, r);
      A(staff ? "a staffer is asked for the draft key once, and without it gets no controls" : "a member who is not staff is never asked for the draft key",
        staff ? (await rpcs(p)).length === 1 && !r.cc : (await rpcs(p)).length === 0, await rpcs(p));
      await wait(2200);
      const adv = mock.calls(p.context()).filter((x) => x.rpc === "draft_auto_advance").length;
      A(r.s && r.s.user && (seat || staff) ? "a front office or staffer advances the expired clock, once" : "a member or guest never advances an expired clock", r.s && r.s.user && (seat || staff) ? adv === 1 : adv === 0, adv);
      await fence(p, PERSONA);
      await done(p);
    }
    A("no page errors", errs.length === 0, errs.slice(0, 4));
    await b.close();
    console.log(fails ? fails + " of " + n + " FAILED" : "all " + n + " passed");
    process.exit(fails ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
