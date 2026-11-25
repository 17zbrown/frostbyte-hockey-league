const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* Team HQ's front office, trades, roster and market hand-offs on the real site, driven through the real UI:
     node tools/ui/run.cjs --suite hq-market --mode live      (every context opts in with live: true, so any mode runs it)
   The page runs as the site build ships it (tools/ui/mock, h0's live mode): supabase-js signs in as the gm persona seated
   (install's session option) as Detroit's Owner or GM, as a member, or as the commissioner previewing a club; the league
   is the recorded Season 1 (?season=1), its Detroit teams row carrying the seats each check needs, and, where a check
   needs a night to come, turned back to the eve of week 5 with the page clock pinned. Every front-office read is a table
   answered with PostgREST's semantics and recorded here (the filters as the page sent them); every write goes to the
   write mock, and core's S2.write is wrapped in the page to record the options the page passes (action, queueArgs,
   sections). The market's own doors are b4's (its live waiveDoor, claim and waiver are watched here at the market's
   boundary, answered as b4's live market answers: a Promise of { ok, problems, queued }); the lobby's savePick is e2's,
   watched the same way. Nothing reaches Supabase, Netlify or Discord.
   Commissioner, 2026-11-02: "I would like the team management to know how many of their own club games have been no-show
   forfeits." and 2026-11-23 (on the cutover list): bring back Team HQ management, the seats and the GM and AGM
   nominations; v4.52, 2026-11-17: "Keep the roster size at 12 for the full season".
   Deleted with demo mode (i3c, 2026-11-25), each pinning only the demo or the demo market (js/market.js's practice
   engine, b4's suites prove the live market): the Bidding tab and bid board on sample pool players, the demo waiver
   sheet with its inactive box and minimum lock, a claim by another club through the demo wire, the v4.43 lockout on the
   sample playoff game, the player page's market doors (js/pages/profile.js), the commissioner's demo claim sheet, a
   waived demo persona, the profile and club pages' words (e6 and e7's), an offer the demo market called off, the camp
   players by the game on demo sheets, the lineup-deadline forfeit (tools/ui/lineups.test.cjs proves the real one), the
   bid board's Promise answers on the demo pool, the playoff-floor readings of hq.js (floorShort, floorLock, lockout,
   seriesLock and seriesOf are gone: nothing on the page locks a player, set_game_lineup decides), and "17 forfeits have
   no box" (the Oct 19 snapshot's own count). */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 700) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const LEAGUE = mock.league({ p_season: 1 }), TIDS = {}; LEAGUE.teams.forEach((t) => { TIDS[t.code] = t.id; });
const SID = LEAGUE.seasons.filter((s) => s.number === 1)[0].id;
const TAG = {}; LEAGUE.people.forEach((x) => { TAG[x.id] = x.gamertag; });
const spotsOf = (code) => LEAGUE.rosters.spots.filter((s) => s.team === code && s.squad !== "tc").map((s) => s.profile_id);
/* Detroit's seats for these checks: the Owner and GM are two of its own players unless the persona holds the seat, the
   Assistant GM a third; R0 is a player who holds none */
const DETS = spotsOf("DET"), R0 = DETS[3];
/* QA nits 29 (2026-11-25): a signed-up member with no roster spot anywhere, to seat at another club before the draft */
const SPOTTED = new Set(LEAGUE.rosters.spots.map((s) => s.profile_id)), FREE = LEAGUE.signups.filter((s) => !SPOTTED.has(s.profile_id) && s.status !== "withdrawn" && s.status !== "declined").map((s) => s.profile_id)[0];
/* the no-show forfeits worked out by hand from the league read itself, never through the model: a forfeit, not voided,
   with no box-score line stored */
function handNoShows(code) {
  const ff = LEAGUE.games.filter((g) => g.forfeit && !g.voided && (g.home === code || g.away === code)), box = LEAGUE.box.byGame;
  const ns = ff.filter((g) => !(box[g.id] && box[g.id].length));
  return { n: ns.length, own: ns.filter((g) => g.forfeit === code).length, them: ns.filter((g) => g.forfeit !== code).length, total: ff.filter((g) => g.forfeit === code).length };
}
/* Season 1, turned back to the afternoon of Wed, Oct 21 (ET), the eve of week 5: every game from that night on is still to
   play (no score, no box score) and the season is still running */
const EVE = "2026-10-21T20:00:00Z", AHEAD = new Set();
LEAGUE.games.forEach((g) => { if (Date.parse(g.scheduled_at) > Date.parse(EVE)) AHEAD.add(g.id); });
const AT1 = Math.min.apply(null, LEAGUE.games.filter((g) => AHEAD.has(g.id) && (g.home === "DET" || g.away === "DET")).map((g) => Date.parse(g.scheduled_at)));
/* the league read for one check: o.eve turns it back; o.draft sets the draft's state; the Detroit row carries the seats */
function body(args, o, seats) {
  const b = mock.league(Object.assign({}, args, { p_season: 1 }));
  if (o.eve) {
    b.generated = EVE;
    (b.seasons || []).forEach((x) => { if (x.number === 1) x.status = "active"; });
    (b.games || []).forEach((g) => { if (AHEAD.has(g.id)) Object.assign(g, { status: "scheduled", home_score: null, away_score: null, forfeit: null, forfeit_team_id: null, went_ot: false, home_shots: null, away_shots: null, ea_match_id: null }); });
    if (b.box && b.box.byGame) AHEAD.forEach((id) => { delete b.box.byGame[id]; });
  }
  if (b.draft) b.draft.state = o.draft ? Object.assign({}, b.draft.state, { status: o.draft }) : null;
  /* the Season 2 cap as production holds it since v4.58 ($30M, the commissioner's ruling of 2026-11-09); the recorded
     league read predates v4.58 and still says $50M */
  (b.seasons || []).forEach((x) => { if (x.number === 2) x.salary_cap = 30000000; });
  (b.teams || []).forEach((t) => { if (t.code === "DET") Object.assign(t, { owner_profile_id: seats.owner, gm_profile_id: seats.gm, agm_profile_id: seats.agm }); });
  /* QA checks (2026-11-25): o.bosGm seats a member as Boston's GM; o.noGames takes every game out (a season before its
     schedule); o.noColor clears a club's color (teams.color is nullable) */
  if (o.bosGm) (b.teams || []).forEach((t) => { if (t.code === "BOS") t.gm_profile_id = o.bosGm; });
  if (o.noGames) { b.games = []; if (b.box) b.box.byGame = {}; }
  if (o.noColor) (b.teams || []).forEach((t) => { if (t.code === o.noColor) t.color = null; });
  return b;
}
/* each table's columns, so a row that leaves one out still answers the page's select (the mock answers 42703 otherwise) */
const COLS = { team_mgmt_policy: "team_id,policy,updated_at", team_mgmt_moves: "id,team_id,page,action,summary,requested_by,status,note,result,decided_at,created_at,requester",
  management_applications: "id,team_id,role,status,nominee_id,submitted_by,pitch,response,seat_block,created_at,decided_at,nominee", club_notices: "id,team_id,kind,title,body,created_at,posted_at",
  trades: "id,season_id,from_team_id,to_team_id,offered_profile_ids,requested_profile_ids,offered_pick_ids,requested_pick_ids,note,status,created_at,updated_at",
  action_requests: "id,team_id,route,type,profile_id,status,subject,details,response,created_at,updated_at,filer", action_messages: "id,request_id,author_id,body,created_at,deleted_at,author" };
const shaped = (t, rows) => rows.map((x) => { const o = {}; COLS[t].split(",").forEach((k) => { o[k] = k in x ? x[k] : null; }); return Object.assign(o, x); });
/* a filter as the page sent it, in one readable string: "eq:team_id:<id>", "neq:status:pending", "in:request_id:a,b",
   "or:from_team_id.eq.<id>,to_team_id.eq.<id>" (the URL's own order) */
function filtersOf(href) {
  const out = []; new URL(href).searchParams.forEach((v, k) => { if (["select", "order", "limit", "offset"].indexOf(k) >= 0) return;
    if (k === "or") return out.push("or:" + v.replace(/^\(|\)$/g, ""));
    const d = v.indexOf("."), op = v.slice(0, d), val = v.slice(d + 1); out.push(op + ":" + k + ":" + (op === "in" ? val.replace(/^\(|\)$/g, "") : val)); });
  return out;
}

/* runs in the page once it has booted: the toasts, every write's options, and the market's two doors watched */
function pageSetup() {
  window.__calls = []; window.__rereads = []; window.__toasts = []; window.__waive = [];
  const t0 = S2.toast; S2.toast = function (m, k) { window.__toasts.push((k || "") + ":" + String(m)); return t0.apply(this, arguments); };
  const w0 = S2.write; S2.write = function (rpc, args, o) { o = o || {};
    window.__calls.push({ rpc, args: JSON.parse(JSON.stringify(args || {})), approval: o.approval || null, action: o.action || null, queueArgs: o.queueArgs ? JSON.parse(JSON.stringify(o.queueArgs)) : null, sections: o.sections || [] });
    return w0.apply(this, arguments).then((res) => { window.__rereads.push((o.sections || []).join(",")); return res; }); };
  window.__idOf = (code) => (S2.data.body.teams.filter((t) => t.code === code)[0] || {}).id;
  if (S2.market) {
    const later = (v) => new Promise((res) => setTimeout(() => res(v), 200));
    S2.market.waiveDoor = (pid) => { window.__waive.push(["waive", pid]); return later(window.__waiveAns || { ok: true, queued: false, problems: [] }); };
    S2.market.claim = (pid, c) => { window.__waive.push(["claim", pid, c && c.club]); return later(window.__claimAns || { ok: true, queued: false, problems: [] }); };
    const w = S2.market.waiver; S2.market.waiver = (pid) => (window.__wire && window.__wire[pid]) || w(pid);
  }
}

async function liveSuite(b, errors) {
  const PERSONA = { owner: ["gm", { teamId: TIDS.DET, seat: "owner" }], gm: ["gm", { teamId: TIDS.DET, seat: "gm" }], member: ["member"], commissioner: ["commissioner"] };
  let H = null;
  /* mode-neutral answers: { rpc: { data } | { data, queued } | { error: { code, message, hint } } }, delayed by ms */
  const mockWrites = (ans, ms) => { const o = {}; Object.keys(ans || {}).forEach((k) => { const a = ans[k];
    o[k] = async () => { await wait(ms || 0); return a.error ? mock.fail(a.error.code, a.error.message, a.error.hint) : a.queued ? Object.assign(mock.ok(a.data), { queued: true }) : mock.ok(a.data); }; }); return o; };
  async function open(who, hash, o) {
    o = Object.assign({ draft: null }, o);
    const ctx = await b.newContext({ viewport: o.viewport || { width: 1280, height: 900 } });
    const me = PERSONA[who][1] ? mock.liveSessionOf(PERSONA[who][0], PERSONA[who][1]).profileId : null;
    const seats = { owner: DETS[0], gm: o.vacateGm ? null : who === "gm" ? me : DETS[1], agm: o.vacateAgm ? null : DETS[2] };
    const fill = (rows) => (rows || []).map((x) => Object.assign({ team_id: TIDS.DET, created_at: new Date(Date.now() - 7200000).toISOString() }, x,
      x.requested_by === "@gm" ? { requested_by: seats.gm } : x.requested_by === "@me" ? { requested_by: me } : {},
      x.nominee_id === "@roster0" ? { nominee_id: R0, nominee: { gamertag: TAG[R0] } } : {}));
    const pick = (code) => spotsOf(code).filter((id) => [seats.owner, seats.gm, seats.agm].indexOf(id) < 0)[0];
    H = { ctx, seats, delay: o.delay || 0, reads: [], fail: Object.assign({}, o.fail), T: {
      team_mgmt_policy: o.policy ? [{ team_id: TIDS.DET, policy: o.policy, updated_at: "2026-11-20T12:00:00Z" }] : [],
      team_mgmt_moves: fill(o.moves), management_applications: fill(o.apps), club_notices: fill(o.notices),
      action_requests: (o.reqs || []).map((x) => Object.assign({ team_id: TIDS.DET, route: "manager", type: "trade_request", created_at: new Date(Date.now() - 7200000).toISOString() }, x, x.profile_id === "@roster0" ? { profile_id: R0 } : {})),
      action_messages: (o.msgs || []).map((x) => Object.assign({ created_at: new Date(Date.now() - 3600000).toISOString(), deleted_at: null }, x)),
      trades: (o.trades || []).map((x) => { const mine = x.dir === "in";
        return { id: x.id, season_id: SID, status: x.status || "proposed", note: x.note || null, created_at: new Date(Date.now() - 5400000).toISOString(), updated_at: new Date(Date.now() - 3600000).toISOString(),
          from_team_id: mine ? TIDS[x.with] : TIDS.DET, to_team_id: mine ? TIDS.DET : TIDS[x.with], offered_profile_ids: [mine ? pick(x.with) : pick("DET")], requested_profile_ids: [mine ? pick("DET") : pick(x.with)],
          offered_pick_ids: [], requested_pick_ids: [] }; }) } };
    const tables = { game_lineups: [], availability: [], market_pool_requests: [], team_lines: [], team_line_plan: [], game_vetoes: [], games_public: [] };
    Object.keys(COLS).forEach((t) => { tables[t] = (q) => { H.reads.push({ t, f: filtersOf(q.url) }); return H.fail[t] ? mock.fail("42501", H.fail[t]) : shaped(t, H.T[t] || []); }; });
    await mock.install(ctx, { live: true, persona: PERSONA[who][0], session: PERSONA[who][1], writes: mockWrites(o.answers, o.delay), tables, rpcs: { s2_league: (a) => mock.ok(body(a, o, seats)) } });
    await ctx.addInitScript((q) => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" }));
      if (q.preview) localStorage.setItem("s2.previewClub", JSON.stringify(q.preview)); } catch (e) {}
      if (q.now) { window.__now = q.now; Date.now = () => window.__now; } }, { preview: who === "commissioner" ? o.preview || "DET" : null, now: o.eve ? AT1 - 2 * 3600e3 : null });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|^S2\.market:/.test(m.text())) errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(S2_BASE + "?season=1#/today", { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => window.S2 && S2.M && S2.auth && S2.auth.sub && S2.$("#page") && S2.$("#page").children.length > 0, null, { timeout: 20000 });
    await p.evaluate(pageSetup);
    H.reads = [];
    await p.evaluate((h) => { location.hash = h; }, hash);
    await wait(600);
    return { ctx, p };
  }
  const reads = () => H.reads.map((q) => q.t + "|" + q.f.join(","));
  const calls = (x) => x.p.evaluate(() => window.__calls.slice());
  const answer = (x, rpc, a) => Promise.resolve(mock.respond(x.ctx, rpc, mockWrites({ [rpc]: a }, H.delay)[rpc]));
  const toasts = (x) => x.p.evaluate(() => window.__toasts.slice());
  const sheetText = (x) => x.p.evaluate(() => { const s = [...document.querySelectorAll(".sheet")].pop(); return s ? s.textContent : ""; });
  const close = (x) => x.ctx.close();
  const MOVES = [{ id: "mv-1", page: "roster", action: "roster_block", summary: "put a winger on the trade block", requested_by: "@gm", status: "pending", requester: { gamertag: "The GM" } },
    { id: "mv-2", page: "lines", action: "set_game_lineup", summary: "file the 9:00 PM lineup", requested_by: "someone-else", status: "pending", requester: { gamertag: "The AGM" } },
    { id: "mv-0", page: "roster", action: "roster_block", summary: "take a defenseman off the block", requested_by: "@gm", status: "denied", note: "Not this week", decided_at: new Date(Date.now() - 3600000).toISOString(), requester: { gamertag: "The GM" } }];
  const NOTICES = [{ id: "cn-1", kind: "trade", title: "Trade completed", body: "A completed trade, as the club room read it.", posted_at: new Date().toISOString() },
    { id: "cn-2", kind: "waive", title: "On waivers", body: "A waiver, still to be posted.", posted_at: null }];
  let x, r;

  {
    console.log("## live: the Owner's front office");
    x = await open("owner", "#/hq?tab=office", { draft: null, vacateAgm: true, moves: MOVES, notices: NOTICES, delay: 400 });
    await x.p.waitForFunction(() => !document.querySelector('[data-w="approvals"] .empty-state'));
    r = await x.p.evaluate(() => ({ pane: S2.$(".hqx-pane").textContent, sample: !!S2.$(".hqx-pane .chip.sample"), tid: window.__idOf("DET"),
      seats: [...document.querySelectorAll('[data-w="seats"] .hqx-seat')].map((e) => e.dataset.seat + ":" + [...e.querySelectorAll("button")].map((b) => b.dataset.act).join("+")),
      ap: [...document.querySelectorAll('[data-w="approvals"] [data-act="mv-decide"]')].map((b) => b.dataset.id + b.dataset.v), seg: document.querySelectorAll('[data-w="perms"] .hqx-perm-seg').length }));
    r.reads = reads(x);
    A("the front office reads the club's own records: policy, pending and decided moves, nominations, notices, each by its team id",
      ["team_mgmt_policy", "team_mgmt_moves", "management_applications", "club_notices"].every((t) => r.reads.some((q) => q.indexOf(t + "|eq:team_id:" + r.tid) === 0)) &&
      r.reads.some((q) => /team_mgmt_moves\|.*eq:status:pending/.test(q)) && r.reads.some((q) => /team_mgmt_moves\|.*neq:status:pending/.test(q)), r.reads);
    A("no sample chip and no demo phase switch in the live front office", !r.sample && !/Before the draft\s*After the draft/.test(r.pane) && !/kept in this tab/.test(r.pane), r.pane.slice(0, 300));
    A("before the draft: the Owner may remove the GM, and the Assistant GM seat waits for the draft (no Nominate)", r.seats.join() === "Owner:,GM:seat-remove,AGM:" && /Named after the draft, .*from your active roster \(Rule S2\.3\)/.test(r.pane), r.seats);
    A("the Owner decides every pending move, the GM's and the AGM's", r.ap.join() === "mv-11,mv-10,mv-21,mv-20", r.ap);
    A("the decided move sits under Recent decisions with its note; the notices say what the club room got", /Recent decisions/.test(r.pane) && /Note: Not this week/.test(r.pane) && /In the club room/.test(r.pane) && /Not posted yet/.test(r.pane) && /never posted there: only a completed trade is public \(Rule 2\.3\)/.test(r.pane));
    A("the Owner edits the permissions (two seats by seven pages)", r.seg === 14, r.seg);
    A("seat pay is the season's own row: the GM's seat at $0 against the cap", /General Manager.*\$0 against the cap/.test(r.pane), r.pane.match(/[^.]*against the cap[^.]*/g));

    console.log("## live: approve a move (nothing shows as done until the database answers)");
    await x.p.evaluate(() => { window.__host = S2.$(".hqx"); });
    await answer(x, "mgmt_decide_move", { data: { status: "approved" } });
    await x.p.click('[data-act="mv-decide"][data-id="mv-1"][data-v="1"]'); await wait(450);
    await x.p.fill("#hqxDecNote", "Go ahead");
    await x.p.click('.sheet [data-x="go"]'); await wait(120);
    r = await x.p.evaluate(() => ({ open: !!document.querySelector(".sheet"), dis: document.querySelector('.sheet [data-x="go"]').disabled, toasts: window.__toasts.slice() }));
    A("while the database decides: the sheet stays, its button is disabled, and no success is said", r.open && r.dis && !r.toasts.some((t) => /^ok:Approved/.test(t)), r);
    await wait(800);
    r = await x.p.evaluate(() => ({ calls: window.__calls, open: !!document.querySelector(".sheet"), toasts: window.__toasts.slice(), same: window.__host === S2.$(".hqx"), rereads: window.__rereads.slice() }));
    r.reads = H.reads.filter((q) => q.t === "team_mgmt_moves").length;
    A("Approve calls mgmt_decide_move with the move, the verdict and the note, and re-reads the rosters", JSON.stringify(r.calls[0] && r.calls[0].args) === JSON.stringify({ p_id: "mv-1", p_approve: true, p_note: "Go ahead" }) && r.calls[0].rpc === "mgmt_decide_move" && r.rereads[0] === "rosters", r.calls);
    A("then the sheet closes, it says the move is made, the queue is read again, and Team HQ repainted in place", !r.open && r.toasts.some((t) => t === "ok:Approved. The move is made.") && r.reads >= 4 && r.same, r);
    await answer(x, "mgmt_decide_move", { error: { code: "P0001", message: "That move is no longer waiting for a decision." } });
    await x.p.click('[data-act="mv-decide"][data-id="mv-2"][data-v="0"]'); await wait(450);
    await x.p.fill("#hqxDecNote", "Not this week");
    await x.p.click('.sheet [data-x="go"]'); await wait(700);
    r = await x.p.evaluate(() => ({ open: !!document.querySelector(".sheet"), err: (document.querySelector(".sheet .hqx-err") || {}).textContent, note: (document.querySelector("#hqxDecNote") || {}).value, dis: document.querySelector('.sheet [data-x="go"]').disabled }));
    A("a refused decision shows the database's words in the sheet, keeps the note, and lets them try again", r.open && r.err === "That move is no longer waiting for a decision." && r.note === "Not this week" && !r.dis, r);
    await x.p.click('.sheet [data-x="keep"]'); await wait(300);
    await answer(x, "mgmt_decide_move", { data: { status: "failed", error: "The player is no longer on your roster." } });
    await x.p.click('[data-act="mv-decide"][data-id="mv-2"][data-v="1"]'); await wait(450);
    await x.p.click('.sheet [data-x="go"]'); await wait(800);
    A("an approval the league could not make is said as such, with its reason", (await toasts(x)).some((t) => t === "err:Approved, but it could not be made: The player is no longer on your roster."), await toasts(x));

    console.log("## live: the Owner's permissions (held while unsaved; Save, Discard)");
    await x.p.click('[data-w="perms"] .hqx-perm-seg[data-perm-seat="gm"][data-perm-page="roster"] button[data-v="approve"]'); await wait(200);
    r = await x.p.evaluate(() => ({ save: document.querySelector('[data-act="perm-save"]').disabled, said: document.querySelector("[data-perm-status]").textContent, busy: S2.holds.some((f) => f()) }));
    A("a press changes the draft only: Save opens, the line says unsaved, and automatic repaints are held", !r.save && r.said === "Unsaved changes." && r.busy, r);
    await x.p.evaluate(() => { window.__host = S2.$(".hqx"); });
    await x.p.evaluate(() => S2.live.emit("notifs", [])); await wait(600);
    r = await x.p.evaluate(() => ({ pressed: document.querySelector('.hqx-perm-seg[data-perm-seat="gm"][data-perm-page="roster"] button[aria-pressed="true"]').dataset.v, same: window.__host === S2.$(".hqx") }));
    A("a front-office re-read while unsaved leaves the editor as the Owner left it", r.pressed === "approve" && r.same, r);
    await answer(x, "set_team_mgmt_policy", { data: { gm: { roster: "approve" } } });
    await x.p.click('[data-act="perm-save"]'); await wait(800);
    r = await x.p.evaluate(() => ({ c: window.__calls.filter((q) => q.rpc === "set_team_mgmt_policy").pop(), said: document.querySelector("[data-perm-status]").textContent, save: document.querySelector('[data-act="perm-save"]').disabled }));
    A("Save sends set_team_mgmt_policy for the club with every cell of both seats", r.c && r.c.args.p_team_code === "DET" && r.c.args.p_policy.gm.roster === "approve" && r.c.args.p_policy.gm.management === "hidden" &&
      Object.keys(r.c.args.p_policy.agm).length === 7, r.c);
    A("after the database answers: saved, and the editor is clean", /^Saved just now/.test(r.said) && r.save, r);
    await x.p.click('[data-w="perms"] .hqx-perm-seg[data-perm-seat="agm"][data-perm-page="draft"] button[data-v="hidden"]'); await wait(150);
    await x.p.click('[data-act="perm-reset"]'); await wait(300);
    r = await x.p.evaluate(() => ({ pressed: document.querySelector('.hqx-perm-seg[data-perm-seat="agm"][data-perm-page="draft"] button[aria-pressed="true"]').dataset.v, said: document.querySelector("[data-perm-status]").textContent, busy: S2.holds.some((f) => f()) }));
    A("Discard puts the saved settings back and lets go of the hold", r.pressed === "full" && r.said === "Changes discarded." && !r.busy, r);

    console.log("## live: remove the GM (refused, then made)");
    await answer(x, "owner_remove_manager", { error: { code: "42501", message: "Only the club's Owner can remove its management." } });
    await x.p.click('[data-act="seat-remove"][data-seat="GM"]'); await wait(400);
    A("the confirm says the removed GM keeps their roster spot and the seat ends", /keeps their roster spot, position and number\. Only the seat ends/.test(await sheetText(x)));
    await x.p.click('.sheet [data-cf="ok"]'); await wait(700);
    r = await x.p.evaluate(() => ({ open: !!document.querySelector(".sheet"), err: (document.querySelector(".sheet .hqx-err") || {}).textContent }));
    A("a refused removal stays open with the database's words", r.open && r.err === "Only the club's Owner can remove its management.", r);
    /* the database answers and the seat is empty from then on (the re-read's Detroit row carries no GM). The write mock
       resolves without a re-read (tools/ui/mock), so here the write reads its sections again before the repaint, in the
       order js/live.js settle() keeps: the repaint then draws the open seat, as on the real site */
    await mock.respond(x.ctx, "owner_remove_manager", async () => { H.seats.gm = null; return mock.ok(null); });
    await x.p.evaluate(() => { const w = S2.write; S2.write = function (rpc, args, o) {
      if (rpc !== "owner_remove_manager" || !o || !o.repaint) return w.apply(this, arguments);
      return w.call(this, rpc, args, Object.assign({}, o, { repaint: null })).then((res) => S2.reread(o.sections).then(() => { o.repaint(res); return res; })); }; });
    await x.p.click('.sheet [data-cf="ok"]'); await wait(800);
    r = await x.p.evaluate(() => ({ c: window.__calls.filter((q) => q.rpc === "owner_remove_manager").pop(), open: !!document.querySelector(".sheet"), toasts: window.__toasts.slice(), rr: window.__rereads.slice() }));
    A("Remove calls owner_remove_manager for the club and the seat, then re-reads the teams and rosters", r.c && r.c.args.p_team_code === "DET" && r.c.args.p_role === "gm" && r.rr.indexOf("teams,rosters") >= 0 && !r.open && r.toasts.some((t) => /^ok:.* is no longer the General Manager\.$/.test(t)), r);
    /* moved from restored (i3f review, 2026-11-25), where the demo's seat removal reached it (review 2026-11-23) */
    r = await x.p.evaluate(() => (document.activeElement ? (document.activeElement.dataset.act || document.activeElement.tagName) + ":" + (document.activeElement.dataset.seat || "") : null));
    A("after removing the GM, focus lands on the seat's new Nominate button, not the page (review 2026-11-23)", r === "seat-nominate:GM", r);
    await close(x);

    /* moved from restored (i3f, 2026-11-25), which reached it through the demo's seat removal and phase switch */
    console.log("## live: before the draft, an open GM seat, nominated from anyone signed up");
    x = await open("owner", "#/hq?tab=office", { draft: null, vacateGm: true, vacateAgm: true, answers: {} });
    await x.p.waitForFunction(() => !!document.querySelector('[data-act="seat-nominate"][data-seat="GM"]'));
    r = await x.p.evaluate(() => (document.querySelector('.hqx-seat[data-seat="GM"] .sub') || {}).textContent || "");
    A("before the draft an open GM seat reads Required, with the draft's date and Rule S2.3", /^Required before the draft, .+ \(Rule S2\.3\)$/.test(r), r);
    await x.p.click('[data-act="seat-nominate"][data-seat="GM"]'); await wait(450);
    r = await x.p.evaluate(() => ({ h: (document.querySelector(".sheet h2") || {}).textContent, say: (document.querySelector(".sheet .t-body") || {}).textContent || "", q: !!document.querySelector('.sheet [data-x="q"]'),
      more: /more: keep typing/.test(document.querySelector(".sheet").textContent), seated: [...document.querySelectorAll(".sheet [data-pick]")].some((b) => { const p = S2.M.player(b.dataset.pick); return !!(p && p.seat); }) }));
    A("the GM may be anyone signed up who holds no club seat, with a search to narrow a long list", r.h === "Nominate a General Manager" && /Before the draft, anyone signed up for the season who holds no club seat/.test(r.say) && r.q && r.more && !r.seated, r);
    await x.p.fill('.sheet [data-x="q"]', "zzzz"); await wait(150);
    A("the search narrows the list without redrawing the field", await x.p.evaluate(() => /Nobody by that name/.test(document.querySelector('.sheet [data-x="list"]').textContent) && document.activeElement.dataset.x === "q"));
    await x.p.fill('.sheet [data-x="q"]', TAG[FREE]); await wait(150);
    A("a signed-up member with no seat anywhere is offered", !!FREE && await x.p.evaluate((id) => !!document.querySelector('.sheet [data-pick="' + id + '"]'), FREE));
    await close(x);
    x = await open("owner", "#/hq?tab=office", { draft: null, vacateGm: true, vacateAgm: true, answers: {}, bosGm: FREE });
    await x.p.waitForFunction(() => !!document.querySelector('[data-act="seat-nominate"][data-seat="GM"]'));
    await x.p.click('[data-act="seat-nominate"][data-seat="GM"]'); await wait(450);
    await x.p.fill('.sheet [data-x="q"]', TAG[FREE]); await wait(150);
    A("a member seated at another club before the draft, with no roster spot there, is never offered (Rule 2.6: one club seat league-wide)", !(await x.p.evaluate((id) => !!document.querySelector('.sheet [data-pick="' + id + '"]'), FREE)));
    await close(x);

    console.log("## live: after the draft, the Assistant GM from the club's own roster");
    x = await open("owner", "#/hq?tab=office", { draft: "complete", vacateAgm: true, answers: {} });
    await x.p.waitForFunction(() => !!document.querySelector('[data-act="seat-nominate"][data-seat="AGM"]'));
    await x.p.click('[data-act="seat-nominate"][data-seat="AGM"]'); await wait(450);
    /* moved from fixround (i3f, 2026-11-25): the live AGM sheet opens only here, after the draft */
    r = await x.p.evaluate(() => (document.querySelector(".sheet h2") || {}).textContent);
    A("Nominate an Assistant General Manager (an, before a vowel)", r === "Nominate an Assistant General Manager", r);
    r = await x.p.evaluate(() => { const ids = [...document.querySelectorAll(".sheet [data-pick]")].map((b) => b.dataset.pick), det = S2.M.roster("DET");
      return { n: ids.length, own: ids.every((id) => det.active.some((p) => p.id === id && !p.seat)), t: document.querySelector(".sheet").textContent }; });
    A("the nominee list is the club's own active roster, nobody seated, never another club or the pool", r.n > 0 && r.own && /never another club or the training camp pool \(Rule S2\.3\)/.test(r.t), r);
    await x.p.click('.sheet [data-x="go"]'); await wait(150);
    A("Submit with nobody picked says so in place, and nothing is sent", (await x.p.evaluate(() => document.querySelector(".sheet .hqx-err").textContent)) === "Pick a player first." && (await calls(x)).length === 0);
    const pick = await x.p.evaluate(() => document.querySelector(".sheet [data-pick]").dataset.pick);
    await x.p.click('.sheet [data-pick="' + pick + '"]'); await wait(150);
    await x.p.fill("#hqxPitch", "Runs our power play.");
    await x.p.evaluate(() => { document.querySelector("#hqxPitch").focus(); S2.live.emit("notifs", []); }); await wait(500);
    r = await x.p.evaluate(() => ({ v: document.querySelector("#hqxPitch").value, f: document.activeElement && document.activeElement.id, picked: !!document.querySelector('.sheet [data-pick][aria-pressed="true"]') }));
    A("a front-office re-read while the Owner types never touches the sheet: the pitch, its focus and the pick stay", r.v === "Runs our power play." && r.f === "hqxPitch" && r.picked, r);
    await answer(x, "management_applications.insert", { error: { code: "23514", message: "That player is not on your club's active roster, so they cannot be named Assistant General Manager (Rule S2.3)." } });
    await x.p.click('.sheet [data-x="go"]'); await wait(300);
    r = await x.p.evaluate(() => ({ err: document.querySelector(".sheet .hqx-err").textContent, v: document.querySelector("#hqxPitch").value, picked: !!document.querySelector('.sheet [data-pick][aria-pressed="true"]') }));
    A("a refused nomination shows the database's words and keeps the pick and the pitch", /cannot be named Assistant General Manager \(Rule S2\.3\)/.test(r.err) && r.v === "Runs our power play." && r.picked, r);
    await answer(x, "management_applications.insert", { data: [{ id: "app-9" }] });
    await x.p.click('.sheet [data-x="go"]'); await wait(700);
    r = await x.p.evaluate(() => ({ c: window.__calls.filter((q) => q.rpc === "management_applications.insert").pop(), me: S2.session.profileId, tid: window.__idOf("DET"), open: !!document.querySelector(".sheet"), toasts: window.__toasts.slice() }));
    A("Submit inserts the nomination: the club, the seat, the Owner as submitter, the nominee and the pitch", r.c && JSON.stringify(r.c.args.row) === JSON.stringify({ team_id: r.tid, role: "agm", submitted_by: r.me, nominee_id: pick, pitch: "Runs our power play." }) && !r.open &&
      r.toasts.some((t) => /^ok:.* is nominated as Assistant General Manager\. The league office votes on it\.$/.test(t)), r);
    await close(x);

    console.log("## live: a pending nomination, withdrawn; the nominations list");
    x = await open("owner", "#/hq?tab=office", { draft: "complete", vacateAgm: true, apps: [{ id: "app-1", role: "agm", status: "pending", nominee_id: "@roster0", seat_block: null },
      { id: "app-0", role: "gm", status: "denied", nominee_id: "@roster0", response: "Not this season.", decided_at: new Date().toISOString() }], answers: { "management_applications.update": { data: [{ id: "app-1" }] } } });
    await x.p.waitForFunction(() => !!document.querySelector('[data-act="nom-withdraw"]'));
    r = await x.p.evaluate(() => ({ seat: document.querySelector('[data-w="seats"] .hqx-seat[data-seat="AGM"]').textContent, noms: document.querySelector('[data-w="noms"]').textContent }));
    A("the seat names the nominee waiting for the vote, and Nominations lists the club's own with the office's answer", /Nominated: .*, waiting for the league office's vote/.test(r.seat) && /Waiting for the vote/.test(r.noms) && /Denied/.test(r.noms) && /Not this season\./.test(r.noms), r);
    await x.p.click('[data-act="nom-withdraw"]'); await wait(400); await x.p.click('.sheet [data-cf="ok"]'); await wait(700);
    r = await x.p.evaluate(() => window.__calls.pop());
    A("Withdraw updates that nomination to withdrawn, by its id", r && r.rpc === "management_applications.update" && r.args.set.status === "withdrawn" && !!r.args.set.updated_at && JSON.stringify(r.args.match) === JSON.stringify({ id: "app-1" }), r);
    await close(x);

    console.log("## live: the trade block from the player sheet; waivers go to the market");
    x = await open("owner", "#/hq?tab=roster", { draft: "complete", answers: { "roster_spots.update": { data: [{ id: "spot-1" }] } } });
    const pid = await x.p.evaluate(() => S2.M.roster("DET").active.filter((p) => !p.seat && !p.onBlock)[0].id);
    await x.p.click('[data-act="player"][data-pid="' + pid + '"]'); await wait(400);
    await x.p.click('.sheet [data-x="block"]'); await wait(500);
    r = await x.p.evaluate(() => ({ c: window.__calls.pop(), sid: S2.M.control.season(S2.M.view.season).settings.id, toasts: window.__toasts.slice() }));
    A("the block door is roster_spots.on_block for this season and player, queued for the Owner when the seat's Roster page asks",
      r.c && r.c.rpc === "roster_spots.update" && JSON.stringify(r.c.args) === JSON.stringify({ set: { on_block: true }, match: { season_id: r.sid, profile_id: pid } }) &&
      r.c.approval === "owner" && r.c.action === "roster_block" && JSON.stringify(r.c.queueArgs) === JSON.stringify({ p_profile: pid, on_block: true }) && r.c.sections.join() === "rosters", r.c);
    await x.p.click('[data-act="player"][data-pid="' + pid + '"]'); await wait(400);
    await x.p.click('.sheet [data-x="waive"]'); await wait(50);
    r = await x.p.evaluate(() => ({ w: window.__waive.slice(), n: window.__calls.length, ok: window.__toasts.filter((t) => /on waivers/.test(t)).length }));
    A("Put on waivers hands the player to the market's one waive door (its own ruled popup), and Team HQ writes nothing itself", JSON.stringify(r.w) === JSON.stringify([["waive", pid]]) && r.n === 0 && r.ok === 0, r);
    await wait(400);
    r = await x.p.evaluate(() => window.__toasts.slice());
    A("the waiver is said only once the market's door has answered that it was made", r.some((t) => /^ok:.+ is on waivers\. Any other club with an open spot and the cap room may claim them for 24 hours \(Rule S2\.5\)\.$/.test(t)), r);
    await x.p.evaluate(() => { window.__waiveAns = { ok: true, queued: true, problems: [] }; window.__toasts = []; });
    await x.p.click('[data-act="player"][data-pid="' + pid + '"]'); await wait(400); await x.p.click('.sheet [data-x="waive"]'); await wait(500);
    A("a waiver the database sends to the Owner is said as sent, not as made", (await toasts(x)).some((t) => /^ok:Sent to the Owner for approval: put .+ on waivers\.$/.test(t)), await toasts(x));
    await x.p.evaluate(() => { window.__waiveAns = { ok: false, canceled: true, problems: [] }; window.__toasts = []; });
    await x.p.click('[data-act="player"][data-pid="' + pid + '"]'); await wait(400); await x.p.click('.sheet [data-x="waive"]'); await wait(500);
    A("a waiver popup closed without a waiver says nothing more", (await toasts(x)).length === 0, await toasts(x));
    A("no club camp in Season 2: no call-up, send-down or signing door in the live roster", !/Call up|Send to training camp|Sign a free agent/.test(await x.p.evaluate(() => document.body.textContent)));
    await close(x);

    /* e1 review, 2026-11-24: the database has no guard against listing a manager (protect_manager_spot refuses only a
       delete or a team change) and notify_trade_block posts the listing publicly, so the page's door is the guard */
    console.log("## live: a manager is never put on the trade block (Rule 2.6): refused before anything is sent");
    x = await open("owner", "#/hq?tab=roster", { draft: "complete", answers: { "roster_spots.update": { data: [{ id: "spot-1" }] } } });
    const gmid = await x.p.evaluate(() => S2.M.roster("DET").seats.GM.id);
    await x.p.click('[data-act="player"][data-pid="' + gmid + '"]'); await wait(400);
    await x.p.click('.sheet [data-x="block"]'); await wait(300);
    r = await x.p.evaluate(() => ({ n: window.__calls.length, err: document.querySelector(".sheet .hqx-err").textContent, open: !!document.querySelector(".sheet"), toasts: window.__toasts.slice() }));
    A("Put on the trade block on the GM's own sheet is refused in place with Rule 2.6, the sheet stays, and no write is sent",
      r.n === 0 && r.open && / holds the GM seat\. An Owner, GM or AGM can't be put on the trade block \(Rule 2\.6\)\.$/.test(r.err) && !r.toasts.some((t) => /^ok:/.test(t)), r);
    await close(x);
    /* a holder seated by the teams row's pointer alone (no roster seat on the model, as an Owner or GM seated before the
       draft reads on the real page) is a manager too */
    x = await open("owner", "#/hq?tab=trades", { draft: "complete", answers: { "roster_spots.update": { data: [{ id: "spot-1" }] } } });
    const ptr = await x.p.evaluate(() => { const det = S2.M.roster("DET"), p = det.active.filter((q) => !q.seat && !q.onBlock)[0], q = det.active.filter((z) => !z.seat && !z.onBlock && z !== p)[0];
      S2.data.body.teams.forEach((t) => { if (t.code === "DET") { t.owner_profile_id = det.seats.Owner.id; t.gm_profile_id = p.id; t.agm_profile_id = null; } });
      return { held: p.id, free: q.id, owner: det.seats.Owner.id }; });
    await x.p.waitForFunction(() => !!document.querySelector('[data-act="block-list"]'));
    await x.p.click('[data-act="block-list"]'); await wait(400);
    r = await x.p.evaluate((o) => { const row = (id) => document.querySelector('.sheet [data-w="blks"] [data-x="' + id + '"]');
      return { heldAdd: !!row(o.held).querySelector(".hqx-add"), heldSub: row(o.held).textContent, ownerAdd: !!row(o.owner) && !!row(o.owner).querySelector(".hqx-add"), freeAdd: !!row(o.free).querySelector(".hqx-add") }; }, ptr);
    A("List a player draws no List control on a manager's row (the Owner's, and a GM seated by the teams row alone), and keeps it on the rest",
      !r.heldAdd && /GM: management can't be listed \(Rule 2\.6\)/.test(r.heldSub) && !r.ownerAdd && r.freeAdd, r);
    await x.p.click('.sheet [data-w="blks"] [data-x="' + ptr.held + '"]'); await wait(300);
    await x.p.click('.sheet [data-w="blks"] [data-x="' + ptr.owner + '"]'); await wait(300);
    r = await x.p.evaluate(() => ({ n: window.__calls.length, err: document.querySelector(".sheet .hqx-err").textContent }));
    A("pressing a manager's row sends no write and says why in place", r.n === 0 && / holds the Owner seat\. An Owner, GM or AGM can't be put on the trade block \(Rule 2\.6\)\.$/.test(r.err), r);
    await x.p.click('.sheet [data-w="blks"] [data-x="' + ptr.free + '"]'); await wait(500);
    r = await x.p.evaluate(() => window.__calls.slice());
    A("and a player who holds no seat is still listed through the door", r.length === 1 && r[0].rpc === "roster_spots.update" && r[0].args.match.profile_id === ptr.free && r[0].args.set.on_block === true, r);
    await close(x);

    console.log("## live: trade offers (accept, decline, withdraw; private to the two front offices)");
    x = await open("owner", "#/hq?tab=trades", { draft: "complete", trades: [{ id: "tr-in", dir: "in", with: "BOS", note: "Fair for both?" }, { id: "tr-out", dir: "out", with: "PIT" }, { id: "tr-old", dir: "in", with: "NYI", status: "declined" }],
      answers: { accept_trade: { error: { code: "23514", message: "After this trade the club would have 13 players, over the 12-player limit (Rule S2.4)." } }, "trades.update": { data: [{ id: "tr-out" }] } } });
    await x.p.waitForFunction(() => !!document.querySelector('[data-act="tr-accept"]'), null, { timeout: 5000 }).catch(() => {});
    r = await x.p.evaluate(() => ({ t: S2.$('[data-w="troffers"]').textContent, acts: [...document.querySelectorAll('[data-w="troffers"] [data-act^="tr-"]')].map((b) => b.dataset.act + ":" + b.dataset.id),
      sample: !!S2.$('[data-w="troffers"] .chip.sample') }));
    r.reads = H.reads.filter((q) => q.t === "trades").map((q) => q.f.join(","));
    A("the club's offers are read by club and season: the open ones, and the newest answered", r.reads.length >= 2 && r.reads.every((f) => /^or:from_team_id\.eq\..+,to_team_id\.eq\..+,eq:season_id:/.test(f)) && r.reads.some((f) => /eq:status:proposed/.test(f)) && r.reads.some((f) => /neq:status:proposed/.test(f)), r.reads);
    A("a received offer offers Accept and Decline, a sent one Withdraw, an answered one only its state; no sample", r.acts.join() === "tr-accept:tr-in,tr-decline:tr-in,tr-withdraw:tr-out" && /Declined/.test(r.t) && /Fair for both\?/.test(r.t) && !r.sample && /1 offer waiting for your answer/.test(r.t), r);
    await x.p.click('[data-act="tr-accept"][data-id="tr-in"]'); await wait(400); await x.p.click('.sheet [data-cf="ok"]'); await wait(600);
    r = await x.p.evaluate(() => ({ c: window.__calls.pop(), err: (document.querySelector(".sheet .hqx-err") || {}).textContent, open: !!document.querySelector(".sheet") }));
    A("Accept calls accept_trade under Owner approval, and a refusal stays in the sheet in the database's words", r.c && r.c.rpc === "accept_trade" && JSON.stringify(r.c.args) === JSON.stringify({ p_trade: "tr-in" }) && r.c.approval === "owner" && r.c.sections.join() === "rosters" &&
      r.open && /over the 12-player limit \(Rule S2\.4\)/.test(r.err), r);
    await x.p.click('.sheet [data-cf="no"]'); await wait(300);
    await x.p.click('[data-act="tr-withdraw"][data-id="tr-out"]'); await wait(400); await x.p.click('.sheet [data-cf="ok"]'); await wait(600);
    r = await x.p.evaluate(() => ({ c: window.__calls.pop(), open: !!document.querySelector(".sheet"), toasts: window.__toasts.slice() }));
    A("Withdraw sets the sent offer to cancelled by its id, named trade_cancel for the Owner's queue", r.c && r.c.rpc === "trades.update" && r.c.args.set.status === "cancelled" && JSON.stringify(r.c.args.match) === JSON.stringify({ id: "tr-out" }) &&
      r.c.approval === "owner" && r.c.action === "trade_cancel" && JSON.stringify(r.c.queueArgs) === JSON.stringify({ p_trade: "tr-out" }) && !r.open && r.toasts.some((t) => t === "ok:Offer withdrawn. Nothing moved."), r);
    await x.p.click('[data-act="tr-decline"][data-id="tr-in"]'); await wait(400); await x.p.click('.sheet [data-cf="ok"]'); await wait(600);
    r = await x.p.evaluate(() => window.__calls.pop());
    A("Decline sets the received offer to declined, named trade_decline", r && r.rpc === "trades.update" && r.args.set.status === "declined" && r.action === "trade_decline" && r.args.match.id === "tr-in", r);
    await close(x);

    /* gaps (2026-11-25): the league office's Reverse and Resend on Team HQ's answered offers, through the site's one
       reversal and resend doors (js/flows.js), with the trade's real id */
    console.log("## gaps: the league office reverses and resends from Team HQ's answered offers");
    const ACC = "00000000-0000-4000-8000-0000000000b1", DEC = "00000000-0000-4000-8000-0000000000b2";
    x = await open("commissioner", "#/hq?tab=trades", { draft: "complete", trades: [{ id: ACC, dir: "in", with: "BOS", status: "accepted" }, { id: DEC, dir: "out", with: "PIT", status: "declined" }],
      answers: { reverse_trade: { data: null }, resend_trade: { data: "00000000-0000-4000-8000-0000000000b9" } } });
    await x.p.waitForFunction(() => !!document.querySelector('[data-act="tr-reverse"]'), null, { timeout: 5000 }).catch(() => {});
    r = await x.p.evaluate(() => [...document.querySelectorAll('[data-w="troffers"] [data-act^="tr-"]')].map((b) => b.dataset.act + ":" + b.dataset.id.slice(-2)));
    A("gaps: a commissioner's answered offers carry Reverse on the completed trade and Resend on the declined one", r.join() === "tr-reverse:b1,tr-resend:b2", r);
    await x.p.click('[data-act="tr-reverse"]'); await x.p.waitForSelector(".sheet #rvWhy");
    await x.p.fill(".sheet #rvWhy", "Placeholder: not a natural deal."); await x.p.click('.sheet [data-cf="ok"]'); await wait(700);
    r = await x.p.evaluate(() => ({ c: window.__calls.filter((c) => c.rpc === "reverse_trade").pop(), open: !!document.querySelector(".sheet"), toasts: window.__toasts.slice() }));
    A("gaps: Reverse is reverse_trade with the trade's id and the reason as typed, never queued for an Owner", r.c && r.c.args.p_trade === ACC && r.c.args.p_reason === "Placeholder: not a natural deal." && !r.c.approval && !r.open && r.toasts.some((t) => /^ok:Trade reversed\./.test(t)), r);
    await x.p.click('[data-act="tr-resend"]'); await x.p.waitForSelector('.sheet [data-cf="ok"]'); await x.p.click('.sheet [data-cf="ok"]'); await wait(700);
    r = await x.p.evaluate(() => ({ c: window.__calls.filter((c) => c.rpc === "resend_trade").pop(), open: !!document.querySelector(".sheet"), toasts: window.__toasts.slice() }));
    A("gaps: Resend is resend_trade with the offer's id, and the toast names the receiving club", r.c && r.c.args.p_trade === DEC && !r.c.approval && !r.open && r.toasts.some((t) => /^ok:Offer resent to the .+\.$/.test(t) && !/receiving club/.test(t)), r);
    await close(x);

    console.log("## live: players' trade requests (Rule 2.3): reply, resolve and deny with the decision statement, no reopen");
    x = await open("owner", "#/hq?tab=trades", { draft: "complete",
      reqs: [{ id: "rq-1", profile_id: "@roster0", filer: { gamertag: "A player" }, status: "open", details: "I would like more ice time somewhere." },
        { id: "rq-0", profile_id: "@roster0", filer: { gamertag: "A player" }, status: "denied", details: "An older request.", response: "Not this season." },
        { id: "rq-other", team_id: TIDS.BOS, profile_id: "someone", status: "open", details: "Another club's request." }],
      msgs: [{ id: "m-1", request_id: "rq-1", author_id: "someone", body: "Any update?", author: { gamertag: "A player" } },
        { id: "m-2", request_id: "rq-1", author_id: "someone", body: "A deleted line.", deleted_at: new Date().toISOString() }],
      answers: { "action_requests.update": { error: { code: "S2_NO_ROWS", message: "no rows" } }, "action_messages.insert": { data: [{ id: "m-3" }] } } });
    await x.p.waitForFunction(() => !!document.querySelector('[data-w="treqs"] .hqx-req'), null, { timeout: 5000 }).catch(() => {});
    r = await x.p.evaluate(() => ({ t: S2.$('[data-w="treqs"]').textContent, acts: [...document.querySelectorAll('[data-w="treqs"] [data-act]')].map((b) => b.dataset.act + ":" + (b.dataset.v || "") + ":" + b.dataset.id) }));
    r.reads = H.reads.filter((q) => /^action_/.test(q.t)).map((q) => q.t + "|" + q.f.join(","));
    A("the requests are the club's own (route manager, this club), with their replies read by request", r.reads.some((q) => /^action_requests\|eq:route:manager,eq:team_id:/.test(q)) && r.reads.some((q) => /^action_messages\|in:request_id:rq-1,rq-0$/.test(q)), r.reads);
    A("an open request offers Reply, Resolve and Deny; an answered one only its state and statement; no Reopen; no other club's request; a deleted reply hidden",
      r.acts.join() === "rq-reply::rq-1,rq:resolved:rq-1,rq:denied:rq-1" && /1 player has asked to be traded/.test(r.t) && /A player: Any update\?/.test(r.t) && /Decision: Not this season\./.test(r.t) && /Denied/.test(r.t) &&
      !/Reopen|Another club's request|A deleted line/.test(r.t), r);
    await x.p.click('[data-act="rq"][data-v="resolved"][data-id="rq-1"]'); await wait(400);
    await x.p.click('.sheet [data-x="go"]'); await wait(200);
    r = await x.p.evaluate(() => ({ err: S2.$(".sheet .hqx-err").textContent, n: window.__calls.length }));
    A("Resolve asks for the final decision statement and sends nothing without it (Rule 1.4)", /decision statement first/.test(r.err) && r.n === 0, r);
    await x.p.fill(".sheet #hqxRq", "We will listen to offers for you."); await x.p.click('.sheet [data-x="go"]'); await wait(500);
    r = await x.p.evaluate(() => ({ c: window.__calls[window.__calls.length - 1], err: S2.$(".sheet .hqx-err").textContent, v: S2.$(".sheet #hqxRq").value, open: !!S2.$(".sheet") }));
    A("Resolve writes the status and the statement together on that request; a refusal stays in the sheet with the statement kept",
      r.c && r.c.rpc === "action_requests.update" && r.c.args.set.status === "resolved" && r.c.args.set.response === "We will listen to offers for you." && JSON.stringify(r.c.args.match) === JSON.stringify({ id: "rq-1" }) && !r.c.approval &&
      r.open && /did not let this seat answer/.test(r.err) && r.v === "We will listen to offers for you.", r);
    await answer(x, "action_requests.update", { data: [{ id: "rq-1" }] });
    await x.p.click('.sheet [data-x="go"]'); await wait(500);
    r = await x.p.evaluate(() => ({ open: !!S2.$(".sheet"), toasts: window.__toasts.slice() }));
    A("once the league confirms it, the sheet closes and the player is said to read the statement", !r.open && r.toasts.some((t) => /^ok:Request resolved\. A player reads your statement on the request\.$/.test(t)), r);
    await x.p.click('[data-act="rq-reply"][data-id="rq-1"]'); await wait(400);
    await x.p.fill(".sheet #hqxRq", "Thanks, we hear you."); await x.p.click('.sheet [data-x="go"]'); await wait(500);
    r = await x.p.evaluate(() => ({ c: window.__calls[window.__calls.length - 1], me: S2.session.profileId, open: !!S2.$(".sheet") }));
    A("Reply adds the seat's message to the request, never a staff-only note", r.c && r.c.rpc === "action_messages.insert" && JSON.stringify(r.c.args.row) === JSON.stringify({ request_id: "rq-1", author_id: r.me, body: "Thanks, we hear you.", internal: false }) && !r.open, r);
    await close(x);

    console.log("## live: the seats are the club's teams row (a holder with no roster spot is still seated)");
    x = await open("owner", "#/hq?tab=office", { draft: null });
    r = await x.p.evaluate(() => {
      const M = S2.M, row = S2.data.body.teams.filter((t) => t.code === "DET")[0], out = M.players.filter((p) => !p.rostered && p.tag)[0], own = M.roster("DET").seats.Owner;
      Object.assign(row, { owner_profile_id: own.id, gm_profile_id: out.id, agm_profile_id: null });
      location.hash = "#/hq?tab=roster"; return { tag: out.tag };
    });
    await wait(300); await x.p.evaluate((h) => { location.hash = h; }, "#/hq?tab=office");
    await x.p.waitForFunction(() => !!document.querySelector('[data-w="seats"] [data-act="seat-remove"][data-seat="GM"]'), null, { timeout: 5000 }).catch(() => {});
    const gmt = r.tag;
    r = await x.p.evaluate(() => ({ gm: (S2.$('[data-w="seats"] [data-seat="GM"]') || {}).textContent || "", agm: (S2.$('[data-w="seats"] [data-seat="AGM"]') || {}).textContent || "",
      acts: [...document.querySelectorAll('[data-w="seats"] [data-act]')].map((b) => b.dataset.act + ":" + b.dataset.seat) }));
    A("a General Manager seated without a roster spot reads as seated, with Remove, and the vacant Assistant GM waits for the draft", r.gm.indexOf(gmt) >= 0 && r.acts.join() === "seat-remove:GM" && /Named after the draft/.test(r.agm), r);
    await close(x);

    console.log("## live: e2's hand-over in Team HQ (the league's clock, real availability, the database's series limits, no weekly limit, no sample)");
    x = await open("owner", "#/hq", { draft: "complete", eve: true });
    r = await x.p.evaluate(() => {
      const H = S2._hq, M = S2.M, ps = M.roster("DET").active, g = H.weekGames("DET")[0], keep = S2.lineups, v0 = M.view.season;
      const out = { clock: Math.abs(H.now() - Date.now()) < 2000, none: H.availOf(ps[0], g) };
      S2.lineups = { availOf: (p, gg) => (p.id === ps[0].id && gg.id === g.id ? "yes" : "no") };
      out.yes = H.availOf(ps[0], g); out.no = H.availOf(ps[1], g); S2.lineups = keep;
      out.gates = ["seriesLock", "seriesOf", "lockout", "floorLock", "playoffGame", "seed", "sample"].filter((k) => k in H);
      M.view.season = 2; out.lim2 = H.limitOf(ps[0]) === Infinity; M.view.season = 1; out.lim1 = H.limitOf(ps[0]); M.view.season = v0;
      return out;
    });
    A("live Team HQ runs on the league's clock, never the demo's", r.clock, r);
    A("availability is e2's real answer for that player and game (S2.lineups.availOf), and none at all before it is read, never a sample answer", r.none === null && r.yes === "yes" && r.no === "no", r);
    A("no series limit, floor lock, sample playoff game or sample sheet is left on the page to guess with (the database counts and refuses, set_game_lineup)", r.gates.length === 0, r.gates);
    A("no weekly limit from Season 2 on (Rule S2.7); Season 1 kept its six", r.lim2 === true && r.lim1 === 6, r);
    for (const tab of ["overview", "roster", "trades", "bidding", "nights", "office"]) {
      await x.p.evaluate((h) => { location.hash = h; }, "#/hq?tab=" + tab); await wait(350);
      /* the market's own clock control ([data-mkclock]) is b4's: its live market hides it (S2.market.mountClock) */
      r = await x.p.evaluate(() => ({ n: [...document.querySelectorAll(".hqx .chip.sample")].filter((e) => !e.closest("[data-mkclock]")).length, about: (S2.$(".hqx-pane details.about") || {}).textContent || "" }));
      A("live " + tab + ": no sample chip, and About this data never calls the club's records samples or Season 1 data", r.n === 0 && !/sample|Season 1 data|stands Season 1 in/i.test(r.about), r);
    }
    await close(x);

    console.log("## live: server picks are the database's (S2.lobby.savePick), and the lobby repaints the block in place");
    x = await open("owner", "#/hq?tab=nights", { draft: "complete", eve: true });
    await x.p.evaluate(() => {
      window.__picks = []; window.__pickAns = null;
      S2.lobby.savePick = (g, side, key, v) => { window.__picks.push([g.id, side, key, v]); return new Promise((res, rej) => setTimeout(() => { const a = window.__pickAns; if (a && a.reject) rej(new Error(a.reject)); else res(a || { data: [{ game_id: g.id }] }); }, 300)); };
      location.hash = "#/hq?tab=roster";
    });
    await wait(300); await x.p.evaluate((h) => { location.hash = h; }, "#/hq?tab=nights"); await wait(400);
    r = await x.p.evaluate(() => [...document.querySelectorAll('[data-w="servers"] select[data-srv]')].map((e) => e.dataset.srv + "|" + e.dataset.side + "|" + e.dataset.key));
    A("before the night's freeze each game offers its picks", r.length >= 2, r);
    /* moved from restored (i3f review, 2026-11-25), which read them off the demo's sample night (review 2026-11-23): the
       freeze time is joined with no-break spaces so it never breaks, and each select is named after its game */
    r = await x.p.evaluate(() => ({ h: (document.querySelector('[data-w="servers"] h3, [data-w="servers"] h2') || {}).textContent || "",
      labels: [...document.querySelectorAll('[data-w="servers"] select[data-srv]')].map((e) => e.getAttribute("aria-label")) }));
    A("the head says when the picks freeze, the time joined so it never breaks", /^Picks freeze at \d{1,2}:\d{2}\u00a0[AP]M\u00a0ET$/.test(r.h), r.h);
    A("each server select is named after its game, so no two read the same (review 2026-11-23)",
      r.labels.length >= 2 && r.labels.every((l) => /^(First choice|Second choice|Veto|Preferred), (vs|at) \S.+$/.test(l || "")) && new Set(r.labels).size === r.labels.length, r.labels);
    const sel0 = '[data-w="servers"] select[data-srv]';
    const first = await x.p.evaluate((q) => { const e = document.querySelector(q); return { g: e.dataset.srv, side: e.dataset.side, key: e.dataset.key }; }, sel0);
    await x.p.evaluate(() => { window.__toasts = []; });
    await x.p.selectOption(sel0, "NA West"); await wait(60);
    r = await x.p.evaluate(() => ({ picks: window.__picks.slice(), ok: window.__toasts.filter((t) => /^ok:/.test(t)) }));
    A("a pick goes to S2.lobby.savePick with the game, the side, the key and the server, and reads as kept only after the answer", JSON.stringify(r.picks) === JSON.stringify([[first.g, first.side, first.key, "NA West"]]) && r.ok.length === 0, r);
    await wait(450);
    r = await x.p.evaluate(() => window.__toasts.slice());
    A("then it is said, in Team HQ's words", r.some((t) => /^ok:(First choice|Veto), (vs|at) .+: NA West$/.test(t)), r);
    await x.p.evaluate(() => { window.__toasts = []; window.__pickAns = { data: "move-9", queued: true }; });
    await x.p.selectOption(sel0, "NA Central"); await wait(500);
    A("a pick sent to the Owner is not said as kept (savePick says the queue)", (await toasts(x)).filter((t) => /^ok:/.test(t)).length === 0, await toasts(x));
    await x.p.evaluate(() => { window.__toasts = []; window.__pickAns = { reject: "Picks for this night are frozen." }; });
    await x.p.selectOption(sel0, "NA Northeast"); await wait(500);
    A("a refused pick adds no word of Team HQ's own (savePick says the refusal and puts the select back)", (await toasts(x)).length === 0, await toasts(x));
    await x.p.evaluate((q) => { document.activeElement && document.activeElement.blur(); window.__secN = S2.$('[data-w="servers"]'); window.__selN = document.querySelector(q); document.dispatchEvent(new CustomEvent("s2:lobby", { detail: { picks: [] } })); }, sel0);
    r = await x.p.evaluate((q) => ({ sec: window.__secN === S2.$('[data-w="servers"]'), sel: window.__selN !== document.querySelector(q), ws: !!S2.$(".hqx[data-ws=hq]") }), sel0);
    A("the lobby's re-read repaints the servers block in place: the section stays, its picks are drawn again", r.sec && r.sel && r.ws, r);
    await x.p.focus(sel0);
    await x.p.evaluate((q) => { window.__selN = document.querySelector(q); document.dispatchEvent(new CustomEvent("s2:lobby", { detail: { picks: [] } })); }, sel0);
    r = await x.p.evaluate((q) => window.__selN === document.querySelector(q) && document.activeElement === window.__selN, sel0);
    A("never under a select in use: the repaint waits while a pick is in hand", r);
    await x.p.evaluate(() => document.activeElement.blur()); await wait(100);
    A("and runs once the select is left", await x.p.evaluate((q) => window.__selN !== document.querySelector(q), sel0));
    await close(x);

    console.log("## live: one acting club for the commissioner: Team HQ, the market and the lobby's server picks (review 2026-11-25)");
    /* previewing a club other than Detroit (the club every other section opens), the server pick is saved for that club
       through the lobby's own door (S2.lobby.savePick, not stubbed here): the lobby reads Team HQ's acting club */
    x = await open("commissioner", "#/hq?tab=nights", { draft: "complete", eve: true, preview: "BOS" });
    mock.respond(x.ctx, "game_vetoes.upsert", (a) => mock.ok([a.row]));
    r = await x.p.evaluate(() => ({ hq: S2._hq.club(), market: S2.market.club(), banner: (S2.$(".hqx-banner") || {}).textContent || "" }));
    A("previewing Boston: Team HQ and the market act for Boston", r.hq === "BOS" && r.market === "BOS" && /Viewing Boston as its Owner/.test(r.banner), r);
    const bsel = '[data-w="servers"] select[data-srv]';
    const bg = await x.p.evaluate((q) => { const e = document.querySelector(q); return e ? { g: e.dataset.srv, side: e.dataset.side, key: e.dataset.key } : null; }, bsel);
    A("Boston's night offers its picks", !!bg, bg);
    if (bg) {
      await x.p.evaluate(() => { window.__toasts = []; });
      await x.p.selectOption(bsel, "NA West"); await wait(700);
      r = { up: (await calls(x)).filter((c) => c.rpc === "game_vetoes.upsert"), t: await toasts(x) };
      const row = r.up[0] && r.up[0].args.row, col = { first: "pref1", second: "pref2", veto: "veto", prefer: "preferred" }[bg.key];
      A("the pick is saved for Boston (game_vetoes, Boston's team id and game), never for the last club Team HQ showed", r.up.length === 1 && row.team_id === TIDS.BOS && row.game_id === bg.g && row[col] === "NA West", r.up);
      A("and is said as kept only after the database's answer, with no refusal", r.t.some((t) => /^ok:.*NA West$/.test(t)) && !r.t.some((t) => /^err:/.test(t)), r.t);
    }
    /* the club page's Open Team HQ sets the market's acting club and opens Team HQ (js/pages/profile.js): Team HQ draws that
       club, and this device remembers it */
    const other = Object.keys(TIDS).filter((c) => c !== "DET" && c !== "BOS")[0];
    await x.p.evaluate((c) => { S2.market.setClub(c); location.hash = "#/hq?tab=overview"; }, other); await wait(700);
    r = await x.p.evaluate(() => ({ hq: S2._hq.club(), market: S2.market.club(), kept: JSON.parse(localStorage.getItem("s2.previewClub")), ws: !!S2.$(".hqx[data-ws=hq]") }));
    A("a club the market acts for is the club Team HQ opens, and this device keeps it", r.hq === other && r.market === other && r.kept === other && r.ws, Object.assign({ want: other }, r));
    /* View as: one pick moves Team HQ, the market and the remembered club together */
    await x.p.evaluate(() => S2.$('[data-act="view-as"]').click()); await wait(400);
    await x.p.evaluate(() => [...document.querySelectorAll('.sheet [data-x="DET"]')].pop().click()); await wait(900);
    r = await x.p.evaluate(() => ({ hq: S2._hq.club(), market: S2.market.club(), kept: JSON.parse(localStorage.getItem("s2.previewClub")), banner: (S2.$(".hqx-banner") || {}).textContent || "" }));
    A("View as Detroit: Team HQ, the market and the remembered club all act for Detroit", r.hq === "DET" && r.market === "DET" && r.kept === "DET" && /Viewing Detroit as its Owner/.test(r.banner), r);
    await close(x);

    console.log("## live: a claim is the market's (S2.market.claim), said only once the database confirms it");
    x = await open("owner", "#/hq?tab=bidding", { draft: "complete" });
    const cl = await x.p.evaluate(() => { const p = S2.M.roster("BOS").active.filter((q) => !q.seat)[0];
      window.__wire = { [p.id]: { pid: p.id, tag: p.tag, player: p, from: "BOS", salary: 1000000, until: Date.now() + 36e5, left: 36e5, claimable: true } };
      window.__claimAns = { ok: false, queued: false, problems: [{ text: "The New York Islanders claimed them first (Rule S2.5).", hard: true }] }; S2.claimDoor(p.id); return p.id; });
    await wait(400);
    r = await x.p.evaluate(() => ({ t: (document.querySelector(".sheet") || {}).textContent || "", anyway: /anyway/i.test((document.querySelector(".sheet") || {}).textContent || "") }));
    A("the claim sheet names the waiver on the league's clock, with no sample mark", /on waivers from the Boston Bruins/.test(r.t) && !/\(sample\)/.test(r.t), r.t);
    await x.p.click('.sheet [data-x="claim"]'); await wait(50);
    r = await x.p.evaluate(() => ({ dis: document.querySelector('.sheet [data-x="claim"]').disabled, w: window.__waive.slice() }));
    A("Claim calls the market's claim for the club on screen and waits for its answer", r.dis && JSON.stringify(r.w) === JSON.stringify([["claim", cl, "DET"]]), r);
    await wait(400);
    r = await x.p.evaluate(() => ({ open: !!document.querySelector(".sheet"), err: (document.querySelector(".sheet .hqx-err") || {}).textContent, ok: window.__toasts.filter((t) => /^ok:/.test(t)), dis: (document.querySelector('.sheet [data-x="claim"]') || {}).disabled }));
    A("a refused claim stays in the sheet in the league's words, with no Try it anyway, and the button back", r.open && /claimed them first/.test(r.err) && r.ok.length === 0 && r.dis === false, r);
    await x.p.evaluate(() => { window.__claimAns = { ok: true, queued: false, problems: [] }; });
    await x.p.click('.sheet [data-x="claim"]'); await wait(500);
    r = await x.p.evaluate(() => ({ open: !!document.querySelector(".sheet"), ok: window.__toasts.filter((t) => /^ok:/.test(t)) }));
    A("a confirmed claim closes the sheet and says so", !r.open && r.ok.some((t) => /is claimed for the Detroit Red Wings at \$1(\.0)?M, onto the active roster \(Rule S2\.5\)\.$/.test(t)), r);
    await close(x);

    console.log("## live: a read that fails is said as a failure");
    x = await open("owner", "#/hq?tab=office", { fail: { club_notices: "permission denied for table club_notices" } });
    await wait(400);
    r = await x.p.evaluate(() => ({ t: document.querySelector('[data-w="notices"]').textContent, retry: !!document.querySelector('[data-w="notices"] [data-act="off-retry"]'), ap: document.querySelector('[data-w="approvals"]').textContent }));
    A("a refused read shows the error and Try again, never an empty queue or 'No club notices yet'", /could not be read/.test(r.t) && /permission denied/.test(r.t) && r.retry && !/No club notices yet|Nothing waiting/.test(r.t + r.ap), r);
    delete H.fail.club_notices;
    await x.p.click('[data-w="notices"] [data-act="off-retry"]'); await wait(600);
    A("Try again reads it once more and the widgets fill in place", await x.p.evaluate(() => /No club notices yet/.test(document.querySelector('[data-w="notices"]').textContent)));
    await close(x);
    await close(x);
  }

  console.log("## live: a General Manager");
  x = await open("gm", "#/hq?tab=office", { moves: MOVES, answers: { mgmt_withdraw_move: { data: null }, "roster_spots.update": { data: "move-7", queued: true } } });
  await x.p.waitForFunction(() => !!document.querySelector("[data-hidden-tab]"), null, { timeout: 5000 }).catch(() => {});
  r = await x.p.evaluate(() => ({ tabs: [...document.querySelectorAll(".hqx-nav .hqx-nav-t")].map((e) => e.textContent), pane: S2.$(".hqx-pane").textContent, office: !!document.querySelector('[data-w="seats"]') }));
  A("by default the Front office tab is the Owner's alone: a GM's nav lacks it and ?tab=office closes in place to say so", r.tabs.indexOf("Front office") < 0 && !r.office && /Not open to your seat/.test(r.pane) && /The Owner has not opened Front office to the General Manager/.test(r.pane), r);
  await x.p.evaluate((h) => { location.hash = h; }, "#/hq"); await wait(300);
  await x.p.waitForFunction(() => !!document.querySelector('[data-w="approvals"]') && !document.querySelector('[data-w="approvals"] .empty-state'));
  r = await x.p.evaluate(() => ({ ap: S2.$('[data-w="approvals"]').textContent, btn: [...document.querySelectorAll('[data-w="approvals"] button')].map((b) => b.dataset.act + ":" + b.dataset.id) }));
  A("the GM sees only their own waiting move, with Withdraw, and no Approve or Deny", r.btn.join() === "mv-withdraw:mv-1" && /1 move waiting for the Owner/.test(r.ap), r.btn);
  A("and is told what an approved page is, in words of their own seat (QA visual 37)", /When the Owner sets a page of moves to Owner approves, your moves there wait here until they decide/.test(r.ap), r.ap);
  await x.p.click('[data-act="mv-withdraw"][data-id="mv-1"]'); await wait(400); await x.p.click('.sheet [data-cf="ok"]'); await wait(800);
  r = await calls(x);
  A("Withdraw calls mgmt_withdraw_move with the move's id", r.length && r[r.length - 1].rpc === "mgmt_withdraw_move" && JSON.stringify(r[r.length - 1].args) === JSON.stringify({ p_id: "mv-1" }), r);
  const gpid = await x.p.evaluate(() => S2.M.roster("DET").active.filter((p) => !p.seat && !p.onBlock)[0].id);
  await x.p.evaluate((h) => { location.hash = h; }, "#/hq?tab=roster"); await wait(500);
  await x.p.click('[data-act="player"][data-pid="' + gpid + '"]'); await wait(400);
  await x.p.click('.sheet [data-x="block"]'); await wait(600);
  r = await calls(x);
  A("the GM's block goes through the same door under Owner approval", r[r.length - 1].rpc === "roster_spots.update" && r[r.length - 1].approval === "owner" && r[r.length - 1].args.match.profile_id === gpid, r[r.length - 1]);
  A("a move the Owner must approve is said as sent to the Owner, not as made", (await toasts(x)).some((t) => /^ok:Sent to the Owner for approval: put .* on the trade block\.$/.test(t)), await toasts(x));
  await close(x);
  x = await open("gm", "#/hq?tab=office", { policy: { gm: { management: "full", roster: "hidden" } } });
  await x.p.waitForFunction(() => !!document.querySelector('[data-w="seats"] .hqx-seat'));
  await wait(300);
  r = await x.p.evaluate(() => ({ tabs: [...document.querySelectorAll(".hqx-nav .hqx-nav-t")].map((e) => e.textContent), btns: document.querySelectorAll('[data-w="seats"] button, [data-w="perms"] button').length,
    segs: document.querySelectorAll(".hqx-perm-seg").length, t: S2.$(".hqx-pane").textContent }));
  A("opened by the Owner: the GM reads the front office, with no seat button and read-only permissions", r.tabs.indexOf("Front office") >= 0 && r.btns === 0 && r.segs === 0 && /Only the Owner nominates or removes/.test(r.t), r);
  A("a page the Owner hides from the GM leaves the GM's nav", r.tabs.indexOf("Roster & cap") < 0, r.tabs);
  await close(x);
  x = await open("gm", "#/hq?tab=roster", { policy: { gm: { roster: "approve" } }, moves: MOVES });
  await x.p.waitForFunction(() => !!document.querySelector(".hqx-apnote"), null, { timeout: 5000 }).catch(() => {});
  r = await x.p.evaluate(() => { const n = document.querySelector(".hqx-apnote"); return n ? { t: n.textContent, w: [...n.querySelectorAll("[data-act]")].map((b) => b.dataset.act + ":" + b.dataset.id) } : null; });
  A("on a page the Owner approves, the GM is told first, with their own waiting move and its Withdraw (the classic approval banner)",
    r && /The Owner approves roster moves\./.test(r.t) && /put a winger on the trade block/.test(r.t) && r.w.join() === "mv-withdraw:mv-1", r);
  r = await x.p.evaluate(() => { const H = S2._hq, c = H.club(); return { c: c, clock: Math.abs(H.now() - Date.now()) < 2000, chips: document.querySelectorAll(".hqx .chip.sample").length,
    stand: !!document.querySelector(".hqx-led-sec + .hqx-led-sec") }; });
  A("the GM's Team HQ is their own seat's club on the league's clock: no sample chip, no pool stand-ins", r.c === "DET" && r.clock && r.chips === 0 && !r.stand, r);
  await close(x);

  console.log("## live: a member reaches no front office");
  x = await open("member", "#/hq?tab=office", {});
  r = await x.p.evaluate(() => ({ hq: !!document.querySelector(".hqx"), t: S2.$("#page").textContent }));
  r.reads = H.reads.length;
  A("Team HQ is locked for a member: no workspace, no front-office read", !r.hq && r.reads === 0, r);
  A("and no write was sent", (await calls(x)).length === 0);
  await close(x);

  {
    console.log("## live: the league office acts for the Owner (the commissioner previewing Detroit)");
    x = await open("commissioner", "#/hq?tab=office", { draft: null, answers: { owner_remove_manager: { data: null } } });
    await x.p.waitForFunction(() => !!document.querySelector('[data-act="seat-remove"][data-seat="GM"]'));
    r = await x.p.evaluate(() => ({ t: S2.$('[data-w="seats"]').textContent, banner: !!S2.$(".hqx-banner"), segs: document.querySelectorAll(".hqx-perm-seg").length }));
    A("the commissioner's preview is the Owner's view: the seat doors, the editable permissions, and the office's note", r.banner && r.segs === 14 && /As the league office you act for the Owner here/.test(r.t), r);
    await x.p.click('[data-act="seat-remove"][data-seat="GM"]'); await wait(400); await x.p.click('.sheet [data-cf="ok"]'); await wait(800);
    r = await calls(x);
    A("the office's removal goes through owner_remove_manager for the previewed club", r.length === 1 && r[0].rpc === "owner_remove_manager" && JSON.stringify(r[0].args) === JSON.stringify({ p_team_code: "DET", p_role: "gm" }), r);
    await close(x);
  }


  console.log("## no-show forfeits for the club's own management");
  for (const code of ["DET", "BOS"]) {
    x = await open("commissioner", "#/hq?tab=overview", { preview: code });
    const got = await x.p.evaluate((c) => { const l = S2.$('[data-w="forfeits"] [data-noshow]'), t = S2.$("[data-fftotal]"); return { club: S2._hq.club(), n: +l.dataset.noshow, own: +l.dataset.own, them: +l.dataset.them, total: +t.dataset.fftotal, rows: document.querySelectorAll('[data-w="forfeits"] .hqx-ff').length, model: S2.M.games.filter((g) => g.forfeit && !g.hasBox && !g.voided && (g.home === c || g.away === c)).length }; }, code);
    const want = handNoShows(code);
    A(code + ": the no-show counts equal the league read's (" + want.n + ", " + want.own + " theirs, " + want.them + " the opponents')", got.club === code && got.n === want.n && got.own === want.own && got.them === want.them && got.rows === want.n && got.model === want.n, got);
    A(code + ": the season's forfeits against Rule 3.2's ten and sixteen", got.total === want.total && await x.p.evaluate(() => /10 · Review/.test(S2.$('[data-w="forfeits"]').textContent) && /16 · Management/.test(S2.$('[data-w="forfeits"]').textContent)), got.total + " vs " + want.total);
    await close(x);
  }

  console.log("## Roster & cap is the Season 2 view");
  x = await open("owner", "#/hq?tab=roster", { draft: "complete" });
  const rc = await x.p.evaluate(() => { const cs = S2.market && S2.market.clubState("DET"), cap = S2.$('[data-w="cap"]').textContent, pg = S2.$("#page").textContent;
    return { cs: !!cs, cap, room: cs && S2.M.money(cs.room), payroll: cs && S2.M.money(cs.payroll), pg, phase: !!S2.$("#hqxPhase"), head: S2.$(".hqx-gaugecard h2, .hqx-gaugecard h3") ? S2.$(".hqx-gaugecard h2, .hqx-gaugecard h3").textContent : null,
      lim: S2.$('[data-w="gauge"] .hqx-mark').dataset.lim, limit: S2.M.RULES.s2.limit, gaugeN: S2.$('[data-w="gauge"] .hqx-gauge-t .d-num').textContent, active: cs && cs.active.total,
      nav: [...document.querySelectorAll(".hqx-nav-row")].map((y) => y.textContent).filter((y) => /Roster/.test(y))[0] || "" }; });
  A("the cap card reads S2.market.clubState and says once how Season 2 cap room is counted", rc.cs && rc.cap.indexOf(rc.room + " of cap room") >= 0 && (rc.cap.match(/Season 2 cap room: \$30M less the active roster/g) || []).length === 1 && rc.cap.indexOf(rc.payroll) >= 0 && !/Camp/.test(rc.cap), rc.cap);
  A("the Roster & cap tab line says the same Season 2 room", rc.nav.indexOf(rc.room) >= 0, rc.nav);
  A("the S2.4 gauge has one limit all season, no Before/After the draft switch, and counts the active roster", !rc.phase && rc.lim === String(rc.limit) && new RegExp(rc.limit + " players all season", "i").test(rc.head || "") && +rc.gaugeN === rc.active, rc);
  A("the Season 1 composition card and its squad freeze are gone, and no pool stand-in is listed", !/Active roster in force|Squad moves are (open|frozen)|Standing in for the pool/.test(rc.pg), (rc.pg.match(/Standing in for the pool|Squad moves are \w+/g) || []).join(" | "));
  const act1 = await x.p.evaluate(() => S2.M.roster("DET").active.filter((y) => !y.seat)[0].id);
  await x.p.click('.hqx-led[data-pid="' + act1 + '"]'); await wait(450);
  A("an active player's sheet has Put on waivers and no Send to training camp or Call up", await x.p.evaluate(() => { const t = S2.$(".sheet").textContent; return !!S2.$('.sheet [data-x="waive"]') && !S2.$('.sheet [data-x="squad"]') && !/Call up|Send to training camp/.test(t); }));
  await close(x);

  /* QA visual 15, 32, 35 and 13, worst 1, 10 and 20 (2026-11-25): Team HQ before a season's first final drew a rank, a
     magic number and "0 games left" over a table of zeros, three red minimums before the draft, forfeits "so far" before a
     game, an empty form caption, "No all on the block", and its own About disclosure */
  console.log("## a season before its first final: no rank, race or verdict over zeros");
  x = await open("owner", "#/hq", { draft: null, noGames: true });
  r = await x.p.evaluate(() => ({ rec: (S2.$(".hqx-rec") || {}).textContent || "", po: ([...document.querySelectorAll(".hqx-block")].filter((s) => /Playoff picture/.test(s.textContent))[0] || {}).textContent || "",
    last5: !!S2.$(".hqx-last5"), ff: (S2.$('[data-w="forfeits"]') || {}).textContent || "", about: !!S2.$(".hqx-pane details.about"), old: !!S2.$(".hqx-about"), empty: S2.M.view.empty.finals }));
  A("the head names the season's start, never a record or a rank", r.empty && /starts/.test(r.rec) && !/\d(st|nd|rd|th) in the|points/.test(r.rec), r.rec);
  A("the playoff picture waits for the first final: no place, magic number, games left or empty form row", /The race starts at puck drop/.test(r.po) && !/Magic number|games? left|\d(st|nd|rd|th) in the/i.test(r.po) && !r.last5, r.po);
  A("the forfeits claim nothing before a game", /No games played yet/.test(r.ff) && !/so far|went ahead|Not one/.test(r.ff), r.ff);
  A("About this data is core's one disclosure (S2.about), not Team HQ's own", r.about && !r.old, r);
  await x.p.evaluate((h) => { location.hash = h; }, "#/hq?tab=roster"); await wait(500);
  r = await x.p.evaluate(() => ({ pre: document.querySelectorAll(".hqx-min.pre").length, short: document.querySelectorAll(".hqx-min.short").length, icons: document.querySelectorAll(".hqx-min .hqx-min-i").length, t: (S2.$(".hqx-mins") || {}).textContent || "" }));
  A("before the draft the minimums are quiet: no red rule, no x, From the draft on", r.pre === 3 && r.short === 0 && r.icons === 0 && (r.t.match(/From the draft on/g) || []).length === 3, r);
  await x.p.evaluate((h) => { location.hash = h; }, "#/hq?tab=trades"); await wait(500);
  r = await x.p.evaluate(() => ({ h: (S2.$('[data-w="tblockh"]') || {}).textContent || "", b: (S2.$('[data-w="tblock"]') || {}).textContent || "" }));
  A("an empty trade block says so in English under the All filter", /Nobody on the block/.test(r.h) && /Nobody is on the block right now\./.test(r.b) && !/No all/.test(r.b), r);
  await close(x);
  /* QA visual 21: the bid board's note field showed focus only as a 10% accent ring on its fill (about 1.1:1). The board is
     empty before the draft, so the field's own markup (hq.js boardRow: label.hqx-bd-note > input) is put in the pane */
  x = await open("owner", "#/hq?tab=bidding", { draft: null });
  r = await x.p.evaluate(() => { const box = document.createElement("div"); box.innerHTML = '<label class="hqx-bd-note"><input data-probe></label><i data-acc style="color:var(--accent)"></i>';
    S2.$(".hqx-pane").appendChild(box); const inp = box.querySelector("input"); inp.focus();
    const acc = getComputedStyle(box.querySelector("[data-acc]")).color, bs = getComputedStyle(box.querySelector(".hqx-bd-note")).boxShadow; box.remove(); return { acc, bs }; });
  A("the focused bid note carries the accent edge, the site's input focus", r.bs.indexOf(r.acc) >= 0 && /inset/.test(r.bs), r);
  await close(x);
  /* QA worst 9: teams.color is nullable; the band drew white type on the light canvas */
  x = await open("owner", "#/hq", { noColor: "DET" });
  r = await x.p.evaluate(() => { const h = S2.$(".hqx-band"); return { style: h.getAttribute("style"), bg: getComputedStyle(h).backgroundColor, ink: getComputedStyle(S2.$(".hqx-band h1")).color }; });
  A("a club with no color takes the ink band, never white type on the light canvas", /--club:\s*var\(--ink-band\)/.test(r.style) && r.bg !== "rgba(0, 0, 0, 0)" && r.ink === "rgb(255, 255, 255)", r);
  await close(x);

  console.log("## the phone");
  for (const tab of ["roster", "overview", "trades", "office"]) {
    x = await open("owner", "#/hq?tab=" + tab, { draft: "complete", viewport: { width: 375, height: 812 }, moves: MOVES, notices: NOTICES });
    A("no horizontal scroll at 375 on " + tab, await x.p.evaluate(() => document.documentElement.scrollWidth <= 375), await x.p.evaluate(() => document.documentElement.scrollWidth));
    await close(x);
  }
}

(async () => {
  const b = await chromium.launch(), liveErrors = [];
  await liveSuite(b, liveErrors);
  const ours = liveErrors.filter((e) => /\[hq\]|pageerror/i.test(e) && !/of DET could not be read/.test(e));
  A("no console errors from Team HQ but the one read failure the checks cause", ours.length === 0, ours.join(" | "));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
