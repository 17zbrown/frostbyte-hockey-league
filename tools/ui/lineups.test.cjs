const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The lineup sheet and the lobby (v5.00 swap, stream e2, 2026-11-24; on the harness's real-site mode since i3c, 2026-11-25):
     node tools/ui/run.cjs --suite lineups --mode live      (every context opts in with live: true, so any mode runs it)
   Team HQ's Lineups tab and the Game Center's lobby on the real site as the build ships it (tools/ui/mock, h0's live mode):
   supabase-js signs in as each persona, the league is the recorded s2_league, every table read is answered from this
   file's tables with PostgREST's semantics, and every write is captured by the write mock. The league is Season 1 as
   recorded, turned back to the afternoon before week 5's first night (?season=1, eve() below), so the persona's club
   (the gm persona's, Pittsburgh in the recording) has a week to play; the page clock is set where each check needs it.
   Nothing here reaches Supabase, Netlify or Discord. What is proved, for each action: the door and its exact arguments;
   nothing shows as filed before the database answers; a refusal is shown in its words with the sheet kept; repaint in
   place; and the rules the database holds (the full six by the lock, Rule 3.2; camp players for one game, Rule S2.5; no
   weekly limit, Rule S2.7; lobby codes only where can_view says so, Rule 4.2). No member's name is written here: the
   players are taken from the recording at run time.
   Deleted with demo mode (i3c): the fixture-mode stand-ins for S2.LIVE, S2.session, S2.ensureSb and S2._writeImpl (the
   harness answers the real client now), and the persona switch on the dock. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = mock.ok, no = (code, message, hint) => mock.fail(code, message, hint);

/* Season 1 from the recording, turned back to the afternoon of Wed, Oct 21 (ET), the eve of week 5: every game from that
   night on is still to play (no score, no box score), the season is still running, and the league read was taken then */
const EVE = "2026-10-21T20:00:00Z", AHEAD = new Set();
function eve(args) {
  if (!AHEAD.size) mock.league({ p_season: 1 }).games.forEach((g) => { if (Date.parse(g.scheduled_at) > Date.parse(EVE)) AHEAD.add(g.id); });
  const b = mock.league(Object.assign({}, args, { p_season: 1 }));
  b.generated = EVE;
  (b.seasons || []).forEach((x) => { if (x.number === 1) x.status = "active"; });
  (b.games || []).forEach((g) => { if (AHEAD.has(g.id)) Object.assign(g, { status: "scheduled", home_score: null, away_score: null, forfeit: null, forfeit_team_id: null, went_ot: false, home_shots: null, away_shots: null, ea_match_id: null }); });
  if (b.box && b.box.byGame) AHEAD.forEach((id) => { delete b.box.byGame[id]; });
  return b;
}
const PERSONA = { gm: "gm", staff: "staff", commish: "commissioner", anon: "anon" };
/* the front office Team HQ reads on every render (none on file here) */
const OFFICE = { team_mgmt_policy: [], team_mgmt_moves: [], management_applications: [], club_notices: [], trades: [], action_requests: [], action_messages: [] };

/* runs in the page once it has booted: the club's week from the model, the clock, and recorders for the writes' options and
   the toasts (S2.write is core's door, wrapped here to record what the page passes; the write mock still answers it) */
function setup() {
  const M = S2.M, H = S2._hq, code = S2.session.teamCode || "PIT";
  const wk = H.weekGames(code), night = H.byNight(wk)[0].games;
  const r = M.roster(code), act = r.active.filter((p) => p.pos && !p.suspended);
  const F = act.filter((p) => p.unit === "F"), D = act.filter((p) => p.unit === "D"), G = act.filter((p) => p.unit === "G");
  const other = M.players.filter((p) => !p.rostered && p.unit === "F" && p.pos)[0];
  const X = window.__fx = { code, g1: night[0].id, g2: night[1].id, g3: night[2].id, at1: Date.parse(night[0].at), at2: Date.parse(night[1].at), week: wk[0].week, wk: wk.map((g) => g.id),
    F: F.map((p) => p.id), D: D.map((p) => p.id), G: G.map((p) => p.id), act: act.map((p) => p.id), guest: other ? other.id : null,
    noAnswer: F[F.length - 1].id, tid: S2.lobby.teamId(code), sid: M.control.season(M.view.season).settings.id, night: night.map((g) => g.id),
    otherNight: M.games.filter((g) => g.night === night[0].night && g.home !== code && g.away !== code).map((g) => g.id),
    home: night.map((g) => g.home === code), me: S2.session.profileId };
  X.six1 = [F[0].id, F[1].id, F[2].id, D[0].id, D[1].id, G[0].id];
  window.__toasts = []; window.__opts = [];
  const toast0 = S2.toast; S2.toast = function (m) { window.__toasts.push(String(m)); return toast0.apply(this, arguments); };
  const write0 = S2.write; S2.write = function (rpc, args, opts) { window.__opts.push({ rpc, action: (opts && opts.action) || null, queueArgs: (opts && opts.queueArgs) || null }); return write0.apply(this, arguments); };
  window.__now = X.at1 - 2 * 3600e3; Date.now = () => window.__now;
  return X;
}
/* the club's tables, built from the fixture the page computed: two sheets on file (six, then five), everyone Available for
   the night but one forward who never answered (Fill must leave them off), one camp player who accepted the second game */
function tablesFor(X, staff) {
  const row = (gid, ids) => ({ game_id: gid, team_id: X.tid, lw: ids[0] || null, center: ids[1] || null, rw: ids[2] || null, ld: ids[3] || null, rd: ids[4] || null, goalie: ids[5] || null,
    updated_at: new Date(X.at1 - 5 * 3600e3).toISOString(), post_lock: false, post_lock_at: null, post_lock_count: 0 });
  const yes = {}; X.night.forEach((g) => { yes[g] = "yes"; });
  return {
    game_lineups: [row(X.g1, X.six1), row(X.g2, [X.F[0], X.F[1], X.F[2], X.D[0], X.D[1], null])],
    availability: X.act.filter((id) => id !== X.noAnswer).map((id) => ({ profile_id: id, season_id: X.sid, week_key: "w" + X.week, nights: { n1: { games: Object.assign({}, yes), st: "yes" } }, submitted_at: null, late: false })),
    market_pool_requests: X.guest ? [{ id: "q1", game_id: X.g2, team_id: X.tid, profile_id: X.guest, status: "accepted" }] : [],
    team_lines: [], team_line_plan: [], game_vetoes: [],
    games_public: X.night.concat(X.otherNight).map((g) => ({ id: g, game_code: g === X.g1 ? "482713" : "555000", server: g === X.g1 ? "NA Central" : null, can_view: X.night.indexOf(g) >= 0 || !!staff }))
  };
}

(async () => {
  const b = await chromium.launch(), errs = [];
  let H = null;
  /* a context on the real site as one persona; T holds the club's tables (filled from the page's fixture after boot), R
     records every table read, F names a table that answers with the database's refusal */
  async function open(hash, who, w, F0) {
    const ctx = await b.newContext({ viewport: { width: w || 1280, height: 900 } });
    H = { ctx, T: {}, R: [], F: Object.assign({}, F0) };
    const table = (t) => (q) => { H.R.push({ t, f: q.filters.slice(), sel: q.select }); return H.F[t] ? no("42501", H.F[t]) : (H.T[t] || []); };
    const tables = Object.assign({}, OFFICE);
    ["game_lineups", "availability", "market_pool_requests", "team_lines", "team_line_plan", "game_vetoes", "games_public"].forEach((t) => { tables[t] = table(t); });
    await mock.install(ctx, { live: true, persona: PERSONA[who], writes: {}, tables, rpcs: { s2_league: (a) => ok(eve(a)) } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/could not be read|Failed to load resource|^S2\.market:/.test(m.text())) errs.push(m.text()); });
    await p.goto(S2_BASE + "?season=1" + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2._hq && S2.lineups && S2.auth && S2.auth.sub, null, { timeout: 20000 });
    await wait(300);
    const X = await p.evaluate(setup);
    H.T = tablesFor(X, who === "staff" || who === "commish");
    /* the pulse: the club's sheets are read again with the tables in place, and the pane repaints at the set clock */
    await p.evaluate(() => S2.live.emit("rosters", {}));
    await wait(300); H.R = [];
    return p;
  }
  /* one answer table: a function (args) -> {data} | {error} | {queued, data} (the database sent the move to the Owner) */
  const answer = (rpc, fn) => mock.respond(H.ctx, rpc, async (args) => { const r = await fn(args); return r.queued ? Object.assign(ok(r.data), { queued: true }) : r; });
  const calls = () => mock.calls(H.ctx).map((c) => ({ rpc: c.rpc, args: c.args, approval: c.approval }));
  const opts = (p) => p.evaluate(() => window.__opts.slice());
  const route = async (p) => { await p.evaluate(() => S2.route(true)); await wait(400); };
  const plan = (p) => p.evaluate(() => { const w = S2.$('[data-w="plan"]'); if (!w) return null;
    return { text: w.textContent.replace(/\s+/g, " "), rows: Object.fromEntries([...w.querySelectorAll('[data-act="sheet"]')].map((r) => [r.dataset.g, (r.querySelector(".hqx-plan-s") || r).textContent.replace(/\s+/g, " ").trim()])) }; });
  const sheetOpen = async (p, gid) => { await p.click('[data-act="sheet"][data-g="' + gid + '"]'); await wait(500); };
  const sheet = (p) => p.evaluate(() => { const s = S2.$(".sheet.hqx-lineup"); if (!s) return null;
    return { text: s.textContent.replace(/\s+/g, " "), slots: Object.fromEntries([...s.querySelectorAll(".hqx-slot")].map((x) => [x.dataset.slot, x.dataset.pid || null])),
      bench: [...s.querySelectorAll(".hqx-chip")].map((c) => c.dataset.pid), err: (s.querySelector(".hqx-err") || {}).textContent || "",
      acts: [...s.querySelectorAll("[data-x]")].map((x) => x.dataset.x + (x.disabled ? ":off" : "")) }; });
  const close = async (p) => { await p.keyboard.press("Escape"); await wait(400); };
  const fx = (p) => p.evaluate(() => window.__fx);
  const toasts = (p) => p.evaluate(() => window.__toasts.slice());
  const sixOf = (X, gid, slots) => ({ p_game: gid, p_team: X.tid, p_lw: slots.LW, p_center: slots.C, p_rw: slots.RW, p_ld: slots.LD, p_rd: slots.RD, p_goalie: slots.G });
  const has = (args, want) => Object.keys(want).every((k) => args[k] === want[k]);
  /* a PostgREST filter the page sent: [column, "op.value"] */
  const filt = (r, col, op, val) => r.f.some((f) => f[0] === col && (op === "in" ? f[1].indexOf("in.(") === 0 && val(f[1].slice(4, -1).split(",")) : f[1] === op + "." + val));
  let p, X, s, r, c;

  console.log("## the club's week is read, and drawn as the database holds it (gm)");
  p = await open("#/hq?tab=lineups", "gm", 0, { game_lineups: "permission denied for table game_lineups" });
  X = await fx(p);
  await route(p);
  r = await plan(p);
  A("a sheet that could not be read is never drawn as empty: the reason and Try again", r && /The lineups could not be read/.test(r.text) && /permission denied/.test(r.text) && !!(await p.$('[data-lux="reload"]')), r && r.text);
  delete H.F.game_lineups; H.R = [];
  /* QA round 2 A10 (2026-11-25): the sheet's reads go through the site's one read door, S2.rd (lineups.js kept a copy) */
  await p.evaluate(() => { const r0 = S2.rd; window.__rd = []; S2.rd = function (q, o) { window.__rd.push(!!(o && o.list)); return r0.apply(this, arguments); }; });
  await p.click('[data-lux="reload"]'); await wait(600);
  r = await p.evaluate(() => window.__rd.slice());
  A("Try again reads the week through S2.rd, each as a list (QA round 2 A10)", r.length >= 5 && r.every(Boolean), r);
  const rl = H.R.filter((x) => x.t === "game_lineups")[0], ra = H.R.filter((x) => x.t === "availability")[0];
  A("the sheets are read for the club and its week's games only", rl && filt(rl, "team_id", "eq", X.tid) && filt(rl, "game_id", "in", (l) => l.length === X.wk.length), rl);
  A("availability is read for the season, the week and the club's own people (bounded, never a whole season)", ra && filt(ra, "season_id", "eq", X.sid) && filt(ra, "week_key", "in", (l) => l.join() === "w" + X.week) && ra.f.some((f) => f[0] === "profile_id"), ra);
  A("camp requests, lines and night plans are read too", ["market_pool_requests", "team_lines", "team_line_plan"].every((t) => H.R.some((x) => x.t === t)), H.R.map((x) => x.t));
  r = await plan(p);
  A("the plan is the database's: six on file is Filed, five is a draft, none is Not filed", /Filed/.test(r.rows[X.g1]) && /Draft 5\/6/.test(r.rows[X.g2]) && /Not filed/.test(r.rows[X.g3]), r.rows);
  A("the night's head counts sets, and says the no-lineup forfeit before the lock (Rule 3.2)", /1 of 3 set/.test(r.text) && /has not set a full lineup of six by a game's lock forfeits that game \(Rule 3\.2\)/.test(r.text), r.text);
  A("no sample mark, clock or series panel on the page", await p.evaluate(() => !S2.$("#page .chip.sample") && !S2.$("#hqxClock") && !S2.$('[data-w="poff"]')));

  console.log("## a sheet: fill, refuse short, file");
  const root = await p.evaluate(() => { const h = S2.$(".hqx"); h.__keep = 1; return !!h; });
  await sheetOpen(p, X.g3);
  s = await sheet(p);
  A("an empty game says it is not set and what the lock costs, before the lock", /Not set yet\./.test(s.text) && /A club that has not set a full lineup of six by the lock forfeits this game \(Rule 3\.2\)/.test(s.text), s.text.slice(0, 300));
  A("a camp player who accepted another game is not on this game's bench (Rule S2.5)", !X.guest || s.bench.indexOf(X.guest) < 0);
  A("the bench carries no weekly count (Season 2 has no weekly limit, Rule S2.7)", !/allowed games this week/.test(await p.evaluate(() => [...document.querySelectorAll(".sheet .hqx-chip")].map((c) => c.getAttribute("aria-label")).join("|"))));
  await p.click('.sheet [data-x="fill"]'); await wait(400);
  s = await sheet(p);
  const placed = Object.values(s.slots).filter(Boolean);
  A("Fill from ratings places only players who said Available; no answer counts as no", placed.length === 6 && placed.indexOf(X.noAnswer) < 0, s.slots);
  A("nothing is written by filling", calls().length === 0, calls());
  A("the sheet says nothing is on file yet", /Nothing here is on file until you file it/.test(s.text));
  await p.click('.sheet .hqx-slot[data-slot="G"]'); await wait(200);
  await p.click('.sheet [data-x="bench"]'); await wait(300);
  await p.click('.sheet [data-x="file"]'); await wait(300);
  s = await sheet(p);
  A("filing five is refused in place, naming the empty spot and the forfeit, with nothing sent", /Still empty: G/.test(s.err) && /forfeits the game \(Rule 3\.2\)/.test(s.err) && calls().length === 0, s.err);
  await p.click('.sheet [data-x="fill"]'); await wait(300);
  s = await sheet(p);
  const want = s.slots;
  answer("set_game_lineup", async (a) => { await wait(500); return ok({ game_id: a.p_game, team_id: a.p_team, center: a.p_center, lw: a.p_lw, rw: a.p_rw, ld: a.p_ld, rd: a.p_rd, goalie: a.p_goalie, updated_at: new Date(X.at1 - 3600e3).toISOString(), post_lock: false, post_lock_count: 0 }); });
  await p.click('.sheet [data-x="file"]'); await wait(150);
  s = await sheet(p); r = await plan(p);
  A("while the league answers, the sheet holds still and nothing reads as filed", s.acts.indexOf("file:off") >= 0 && !/Filed/.test(r.rows[X.g3]) && !/all six are on file/.test(s.text), { acts: s.acts, row: r.rows[X.g3] });
  await wait(700);
  s = await sheet(p); r = await plan(p); c = calls();
  A("File lineup sends set_game_lineup with the six on screen, for the club, through the Owner's gate", c.length === 1 && c[0].rpc === "set_game_lineup" && has(c[0].args, sixOf(X, X.g3, want)) && c[0].approval === "owner" && c[0].args.p_emergency === false, c);
  A("after the league answers, the sheet is set and the plan says Filed", /Set: all six are on file/.test(s.text) && /Filed/.test(r.rows[X.g3]) && /2 of 3 set/.test(r.text), { t: s.text.slice(0, 120), row: r.rows[X.g3] });
  A("the page was repainted in place (the workspace node is the same)", root && await p.evaluate(() => !!S2.$(".hqx").__keep));
  A("the toast said it after the answer", (await toasts(p)).some((t) => /Lineup filed/.test(t)));

  console.log("## a refusal keeps the sheet; discard; withdraw");
  const benchOne = s.bench[0];
  await p.click('.sheet .hqx-chip[data-pid="' + benchOne + '"]'); await wait(150);
  const swapSlot = "LW";
  await p.click('.sheet .hqx-slot[data-slot="' + swapSlot + '"]'); await wait(300);
  s = await sheet(p);
  r = await plan(p);
  /* review 2026-11-24: unsaved work never reads as a lost filing; the six on file stay the lineup of record */
  A("a change to a filed sheet is work in progress: Save changes and Discard; the plan still says Filed and names the unsaved change", s.acts.indexOf("file") >= 0 && s.acts.indexOf("discard") >= 0 && /Your changes are not saved yet/.test(s.text) &&
    /Filed/.test(r.rows[X.g3]) && /2 of 3 set/.test(r.text) && /Unsaved changes:/.test(r.text), { acts: s.acts, row: r.rows[X.g3], t: r.text.slice(-200) });
  const MSG = "At least half of a game lineup must be the club's own players: 4 training camp players in a lineup of 6 is too many (three at most in a full six).";
  answer("set_game_lineup", () => no("22023", MSG, "camp_half"));
  await p.click('.sheet [data-x="file"]'); await wait(400);
  s = await sheet(p);
  A("the database's refusal is shown in its own words, and the swap stays on the sheet", s.err === MSG && s.slots[swapSlot] === benchOne, { err: s.err, slot: s.slots[swapSlot] });
  await p.click('.sheet [data-x="discard"]'); await wait(300);
  s = await sheet(p);
  A("Discard puts back what is on file", JSON.stringify(s.slots) === JSON.stringify(want) && s.acts.indexOf("withdraw") >= 0, s.slots);
  answer("clear_game_lineup", () => ok(true));
  const before = calls().length;
  const confirmText = () => p.evaluate(() => { const c = [...document.querySelectorAll(".sheet")].filter((x) => x.querySelector("[data-cf]")).pop(); return c ? c.textContent.replace(/\s+/g, " ") : null; });
  await p.click('.sheet [data-x="withdraw"]'); await wait(400);
  const cf = await confirmText();
  A("Withdraw sheet asks first, naming the game, the lock and the forfeit (Rule 3.2), with nothing sent", cf && /Withdraw this lineup\?/.test(cf) && /forfeits the game \(Rule 3\.2\)/.test(cf) && /before it locks at \d/.test(cf) && calls().length === before, cf);
  await p.click('[data-cf="no"]'); await wait(400);
  A("Keep it sends nothing and leaves the sheet set", calls().length === before && /Set: all six are on file/.test((await sheet(p)).text));
  await p.click('.sheet [data-x="withdraw"]'); await wait(400);
  await p.click('[data-cf="ok"]'); await wait(500);
  c = calls().slice(before); s = await sheet(p); r = await plan(p);
  A("a confirmed withdrawal sends clear_game_lineup for the game and the club", c.length === 1 && c[0].rpc === "clear_game_lineup" && c[0].args.p_game === X.g3 && c[0].args.p_team === X.tid, c);
  A("the game is no longer set, and the six stay on screen as unsaved work to file again", !/Filed/.test(r.rows[X.g3]) && /Draft 6\/6/.test(r.rows[X.g3]) && /1 of 3 set/.test(r.text) &&
    JSON.stringify(s.slots) === JSON.stringify(want) && s.acts.indexOf("file") >= 0 && /Nothing here is on file until you file it/.test(s.text), { row: r.rows[X.g3], acts: s.acts });
  A("the toast says the six are still there and the lock to file them by", (await toasts(p)).some((t) => /Lineup withdrawn\. The six are still on screen/.test(t) && /forfeited \(Rule 3\.2\)/.test(t)));
  answer("set_game_lineup", (a) => ok({ game_id: a.p_game, team_id: a.p_team, center: a.p_center, lw: a.p_lw, rw: a.p_rw, ld: a.p_ld, rd: a.p_rd, goalie: a.p_goalie, updated_at: new Date(X.at1 - 3600e3).toISOString(), post_lock: false, post_lock_count: 0 }));
  await p.click('.sheet [data-x="file"]'); await wait(500);
  A("one tap files the six again", /Filed/.test((await plan(p)).rows[X.g3]) && /Set: all six are on file/.test((await sheet(p)).text));
  answer("clear_game_lineup", () => ok(false));
  await p.click('.sheet [data-x="withdraw"]'); await wait(400);
  await p.click('[data-cf="ok"]'); await wait(500);
  A("when the league had nothing on file, the page says so instead of claiming a withdrawal", (await toasts(p)).some((t) => /There was no lineup on file for this game/.test(t)) && !/Filed/.test((await plan(p)).rows[X.g3]));
  await p.click('.sheet [data-x="clear"]'); await wait(300);
  await close(p);

  console.log("## the Owner approves this seat's lineup moves");
  await sheetOpen(p, X.g3);
  await p.click('.sheet [data-x="fill"]'); await wait(300);
  answer("set_game_lineup", () => ({ queued: true, data: "move-1" }));
  await p.click('.sheet [data-x="file"]'); await wait(400);
  s = await sheet(p); r = await plan(p);
  A("a queued filing says it waits for the Owner and is not on file", /Sent to your Owner for approval at/.test(s.text) && /not on file until they approve/.test(s.text) && !/Filed/.test(r.rows[X.g3]) && (await toasts(p)).some((t) => /Sent to your Owner/.test(t)));
  await close(p);

  console.log("## a camp player who accepted THIS game, and the club's lines");
  await sheetOpen(p, X.g2);
  s = await sheet(p);
  A("the five on file read as not set", /On file with 5 of 6 named: not set yet\./.test(s.text), s.text.slice(0, 160));
  if (X.guest) {
    A("the camp player who accepted this game is on its bench, marked for this game", s.bench.indexOf(X.guest) >= 0 && await p.evaluate((id) => /camp, this game/.test(S2.$('.sheet .hqx-chip[data-pid="' + id + '"]').textContent), X.guest));
    A("the sheet names them and counts the night's camp players against three (Rule S2.5)", /Camp players who accepted this game:/.test(s.text) && /\(1 of 3 tonight\)/.test(s.text) && /at least three of each six must be its own players \(Rule S2\.5\)/.test(s.text));
  }
  await p.click('.sheet [data-x="save-line"]'); await wait(400);
  await p.selectOption('[data-ls="slot"]', "2"); await p.fill('[data-ls="name"]', "Top line");
  answer("set_team_line", (a) => ok({ slot: a.p_slot, name: a.p_name, lw: a.p_lw, center: a.p_center, rw: a.p_rw, ld: a.p_ld, rd: a.p_rd, goalie: a.p_goalie }));
  await p.click('[data-ls="save"]'); await wait(500);
  c = calls().filter((x) => x.rpc === "set_team_line").pop();
  A("Save as a line sends set_team_line: the season, the club, the slot, the name and the sheet's players", c && c.args.p_season === X.sid && c.args.p_team === X.tid && c.args.p_slot === 2 && c.args.p_name === "Top line" && c.args.p_center === s.slots.C && c.approval === "owner", c);
  A("the line is listed, and the sheet offers to fill from it", await p.evaluate(() => /Top line/.test(S2.$('[data-w="lulines"]').textContent) && !!S2.$('.sheet [data-x="line-fill"][data-n="2"]')));
  await close(p);
  answer("set_team_line_night", () => ok(null));
  await p.selectOption('[data-lux="night-line"]', "2"); await wait(400);
  c = calls().filter((x) => x.rpc === "set_team_line_night").pop();
  A("the night's line goes to set_team_line_night with the night's three letters", c && c.args.p_night === (await p.evaluate(() => S2.$('[data-lux="night-line"]').dataset.night)) && /^[a-z]{3}$/.test(c.args.p_night) && c.args.p_slot === 2 && c.args.p_season === X.sid, c);
  /* QA round 2 nit (2026-11-25): the lineup pane drew Fill, File all lineups, the sheet doors and the night's line select on
     an archive (each door then refused with S2_ARCHIVE). Season 1's archive has no nights, so this week is made an archive
     by closing Season 1 in place, as tradepage's archive check does */
  r = await p.evaluate(async () => {
    const s1 = S2.M.control.seasons.filter((s) => s.number === 1)[0].settings, was = s1.status; s1.status = "complete";
    try { S2.route(true); await new Promise((res) => setTimeout(res, 400)); const w = S2.$('[data-w="plan"]');
      return { arch: !!S2._hq.archErr(), rows: w ? w.querySelectorAll(".hqx-plan-r").length : 0, lines: /Top line/.test((S2.$('[data-w="lulines"]') || {}).textContent || ""),
        doors: [...document.querySelectorAll('.hqx [data-act="sheet"], .hqx [data-act="file-night"], .hqx [data-lux="fill-night"], .hqx select[data-lux="night-line"], .hqx button.hqx-plan-r')].map((e) => e.getAttribute("data-act") || e.getAttribute("data-lux") || e.className) };
    } finally { s1.status = was; S2.route(true); }
  });
  await wait(400);
  A("on an archive the night's sheets and lines still read, with no Fill, File all lineups, sheet door or night's line select", r.arch && r.rows > 0 && r.lines && r.doors.length === 0, r);
  A("...and back on the current season they return", await p.evaluate(() => !S2._hq.archErr() && !!S2.$('[data-lux="fill-night"]') && !!S2.$('select[data-lux="night-line"]') && !!S2.$('[data-act="sheet"]')));

  console.log("## the lock");
  await p.evaluate(() => { window.__now = window.__fx.at1 - 20 * 60000; });
  await route(p);
  await sheetOpen(p, X.g1);
  s = await sheet(p);
  A("past its lock a set sheet is published, with the price of a swap said (Rule 5.3)", /Published to/.test(s.text) && /A swap now is reported to/.test(s.text), s.text.slice(0, 200));
  await p.click('.sheet .hqx-slot[data-slot="RW"]'); await wait(150);
  A("a published sheet offers no Move to bench", !(await sheet(p)).acts.some((x) => /^bench/.test(x)));
  await p.click('.sheet [data-bench] h4'); await wait(300);
  s = await sheet(p);
  A("leaving a spot empty after the lock is refused in place (Rule 5.3), nothing sent", /keeps all six spots \(Rule 5\.3\)/.test(s.err) && s.slots.RW === X.six1[2], s.err);
  const spare = s.bench.filter((id) => X.F.indexOf(id) >= 0)[0];
  if (spare) {
    await p.click('.sheet .hqx-chip[data-pid="' + spare + '"]'); await wait(150);
    await p.click('.sheet .hqx-slot[data-slot="RW"]'); await wait(300);
    /* review 2026-11-24: an unsaved swap after the lock, left on screen, read as "Forfeit: no lineup" */
    await close(p);
    r = await plan(p);
    A("after the lock, an unsaved swap left on a closed sheet never reads as a forfeit: still Published, still set, the change named", !/Forfeit/.test(r.rows[X.g1]) && /Published/.test(r.rows[X.g1]) && /1 of 3 set/.test(r.text) && /Unsaved changes:/.test(r.text), { row: r.rows[X.g1], t: r.text.slice(-200) });
    await sheetOpen(p, X.g1);
    A("and the swap is still on the sheet when it opens again", (await sheet(p)).slots.RW === spare);
    const late = new Date(X.at1 - 20 * 60000).toISOString();
    answer("set_game_lineup", (a) => ok({ game_id: a.p_game, team_id: a.p_team, center: a.p_center, lw: a.p_lw, rw: a.p_rw, ld: a.p_ld, rd: a.p_rd, goalie: a.p_goalie, updated_at: late, post_lock: true, post_lock_at: late, post_lock_count: 1 }));
    await p.click('.sheet [data-x="file"]'); await wait(400);
    c = calls().filter((x) => x.rpc === "set_game_lineup").pop(); s = await sheet(p);
    A("a swap after the lock is filed with p_emergency, and the history says it was reported", c && c.args.p_emergency === true && c.args.p_rw === spare && /Changed after the lock, reported to the opponent/.test(s.text), c && c.args);
  }
  await close(p);
  await p.evaluate(() => { window.__now = window.__fx.at2 - 20 * 60000; });
  await route(p);
  r = await plan(p);
  A("a game whose lock passed with five on file reads as forfeited (Rule 3.2)", /Forfeit: no lineup/.test(r.rows[X.g2]), r.rows[X.g2]);
  await sheetOpen(p, X.g2);
  A("and its sheet says no full six was on file at the lock", /No full lineup of six was on file at the/.test((await sheet(p)).text));
  await close(p);

  console.log("## availability (You, Your week)");
  await p.evaluate(() => { window.__now = window.__fx.at1 - 2 * 3600e3; });
  H.T.availability = H.T.availability.filter((x) => x.profile_id !== X.me);   /* the member has not answered this week yet */
  /* the database keeps what is written, so a second answer reads the first (saveAvailability reads the member's row fresh) */
  const keepRow = (row) => { const t = H.T.availability, i = t.findIndex((x) => x.profile_id === row.profile_id && x.week_key === row.week_key && x.season_id === row.season_id); if (i >= 0) t[i] = Object.assign({}, t[i], row); else t.push(Object.assign({ submitted_at: null, late: false }, row)); };
  answer("availability.upsert", (a) => ok([{ id: "av1", week_key: a.row.week_key, nights: a.row.nights }]));
  r = await p.evaluate((g) => S2.lineups.saveAvailability(g, "no").then((x) => ({ ok: true, x }), (e) => ({ ok: false, m: e.message })), X.g3);
  c = calls().filter((x) => x.rpc === "availability.upsert").pop();
  A("an answer is the member's week row: season, member, week key, the game's answer and the night's summary", r.ok && c && c.args.onConflict === "season_id,profile_id,week_key" && c.args.row.season_id === X.sid && c.args.row.profile_id === X.me &&
    c.args.row.week_key === "w" + X.week && c.args.row.nights.n1.games[X.g3] === "no" && c.args.row.nights.n1.st === "no", c && c.args);
  answer("availability.upsert", () => no("42501", "new row violates row-level security policy for table \"availability\""));
  r = await p.evaluate((g) => S2.lineups.saveAvailability(g, "yes").then(() => ({ ok: true }), (e) => ({ ok: false, m: e.message })), X.g3);
  A("a refused answer rejects with the database's words (the caller keeps the choice on screen)", !r.ok && /row-level security/.test(r.m), r);

  /* review 2026-11-24: the upsert replaces nights whole, so the week must be built from the member's own row */
  console.log("## an answer keeps the rest of the member's week");
  H.T.availability = H.T.availability.filter((x) => x.profile_id !== X.me);
  H.T.availability.push({ profile_id: X.me, season_id: X.sid, week_key: "w" + X.week, nights: { n1: { games: { [X.g1]: "yes", [X.g2]: "no" }, st: "part", note: "on after nine" }, n2: { games: { "g-other": "yes" }, st: "yes", note: "late" } }, submitted_at: null, late: false });
  H.R = [];
  answer("availability.upsert", async (a) => { await wait(200); keepRow(a.row); return ok([{ id: "av1", week_key: a.row.week_key, nights: a.row.nights }]); });
  const ups = () => calls().filter((x) => x.rpc === "availability.upsert");
  r = await p.evaluate((g) => S2.lineups.saveAvailability(g, "yes").then(() => ({ ok: true }), (e) => ({ ok: false, m: e.message })), X.g3);
  c = ups().pop();
  const rdA = H.R.filter((x) => x.t === "availability")[0], nn = c && c.args.row.nights;
  A("the member's own row is read first: the season, the member and the week", r.ok && rdA && filt(rdA, "season_id", "eq", X.sid) && filt(rdA, "profile_id", "eq", X.me) && filt(rdA, "week_key", "eq", "w" + X.week), rdA);
  A("one answer keeps every other game, night and note of the week", nn && nn.n1.games[X.g1] === "yes" && nn.n1.games[X.g2] === "no" && nn.n1.games[X.g3] === "yes" && nn.n1.note === "on after nine" && nn.n1.st === "part" &&
    nn.n2 && nn.n2.games["g-other"] === "yes" && nn.n2.note === "late", nn);
  const u0 = ups().length;
  r = await p.evaluate((X) => Promise.all([S2.lineups.saveAvailability(X.g1, "no"), S2.lineups.saveAvailability(X.g2, "yes")]).then(() => true, (e) => e.message), X);
  c = ups().slice(u0);
  A("two answers in a row go one at a time, so the second keeps the first", r === true && c.length === 2 && c[1].args.row.nights.n1.games[X.g1] === "no" && c[1].args.row.nights.n1.games[X.g2] === "yes" && c[1].args.row.nights.n1.note === "on after nine", c.map((x) => x.args.row.nights.n1));
  H.F.availability = "permission denied for table availability";
  const u1 = ups().length;
  r = await p.evaluate((g) => S2.lineups.saveAvailability(g, "no").then(() => ({ ok: true }), (e) => ({ ok: false, m: e.message })), X.g3);
  A("if the member's row cannot be read, the answer is refused in words and nothing is written", !r.ok && /could not be read, so nothing was changed/.test(r.m) && /permission denied/.test(r.m) && ups().length === u1, r);
  delete H.F.availability;

  console.log("## the lobby: server picks and codes");
  answer("game_vetoes.upsert", (a) => ok([Object.assign({}, a.row)]));
  const homeIdx = X.night.indexOf(X.g3), home3 = X.home[homeIdx];
  r = await p.evaluate((o) => { const x = S2.M.games.filter((y) => y.id === o.g)[0], side = o.home ? "home" : "away", key = side === "home" ? "first" : "veto"; return S2.lobby.savePick(x, side, key, "NA West").then(() => ({ ok: true, side, key }), (e) => ({ ok: false, m: e.message })); }, { g: X.g3, home: home3 });
  c = calls().filter((x) => x.rpc === "game_vetoes.upsert").pop();
  const o1 = (await opts(p)).filter((x) => x.rpc === "game_vetoes.upsert").pop();
  A("a pick is the club's game_vetoes row, upserted on game and club through the Owner's gate", r.ok && c && c.args.onConflict === "game_id,team_id" && c.args.row.game_id === X.g3 && c.args.row.team_id === X.tid &&
    (r.side === "home" ? c.args.row.pref1 === "NA West" : c.args.row.veto === "NA West") && c.approval === "owner", c && c.args);
  A("the move is named schedule_pick with the four picks, so the Owner's queue can describe it", o1 && o1.action === "schedule_pick" && o1.queueArgs && o1.queueArgs.game_id === X.g3 && "pref1" in o1.queueArgs && "veto" in o1.queueArgs, o1);
  A("the page now holds the club's pick", await p.evaluate((g) => { const x = S2.M.games.filter((y) => y.id === g)[0], k = S2.lobby.picks(x); return k.home.first === "NA West" || k.away.veto === "NA West"; }, X.g3));
  const LOCKMSG = "Server picks lock 30 minutes before the night's first puck drop.";
  answer("game_vetoes.upsert", () => no("P0001", LOCKMSG));
  r = await p.evaluate((o) => { const x = S2.M.games.filter((y) => y.id === o.g)[0], side = o.home ? "home" : "away"; return S2.lobby.savePick(x, side, side === "home" ? "second" : "prefer", "NA Central").then(() => ({ ok: true }), (e) => ({ ok: false, m: e.message })); }, { g: X.g3, home: home3 });
  A("a pick the database refuses rejects in its words and is said in a toast", !r.ok && r.m === LOCKMSG && (await toasts(p)).some((t) => t === LOCKMSG), r);
  await p.context().close();

  console.log("## the Game Center lobby, after the night's lock");
  p = await open("#/game/" + X.g1, "gm");
  /* moved from restored (i3f review, 2026-11-25), which read it off a demo game (review 2026-11-23): two hours out, before
     the night's release, the time joined with no-break spaces so "8:30 PM ET" never breaks in the condensed headline */
  await route(p);
  r = await p.evaluate((g) => { const s = S2.$('.lb-sec[data-lb="' + g + '"]'); return s ? { h: (s.querySelector("#lbH") || {}).textContent || "", code: !!s.querySelector(".lb-code") } : null; }, X.g1);
  A("an upcoming game says when its code arrives, and shows none yet; the time never breaks", !!r && /^The code arrives at \d{1,2}:\d{2}\u00a0[AP]M\u00a0ET$/.test(r.h) && !r.code, r);
  await p.evaluate(() => { window.__now = window.__fx.at1 - 10 * 60000; });
  answer("resolve_game_server", () => ok("NA West"));
  H.R = [];
  await route(p); await wait(400);
  r = await p.evaluate((g) => { const s = S2.$('.lb-sec[data-lb="' + g + '"]'); return s ? s.textContent.replace(/\s+/g, " ") : null; }, X.g1);
  const reads2 = H.R.filter((x) => x.t === "games_public");
  A("the night's codes are read once, from games_public with can_view", reads2.length === 1 && reads2[0].sel === "id,game_code,server,can_view" && filt(reads2[0], "id", "in", (l) => l.indexOf(X.g1) >= 0), reads2);
  A("a club in the game sees its code and server, never a made-up one", r && /Lobby code/.test(r) && /482713/.test(r) && /NA Central/.test(r) && !/sample/.test(r), r);
  /* moved from restored (i3f review, 2026-11-25), where the demo night showed it */
  A("and is told to keep it inside the two clubs (Rule 4.2)", !!r && /Keep it inside the two clubs: posting a code anywhere public is a conduct violation \(Rule 4\.2\)/.test(r), r);
  if (X.otherNight[0]) {
    r = await p.evaluate((g) => { const x = S2.M.games.filter((y) => y.id === g)[0]; return S2.lobby.section(x).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); }, X.otherNight[0]);
    A("another club's game says the code went to the two clubs, and shows none", /The code is out to the two clubs/.test(r) && !/555000/.test(r), r);
  }
  await p.context().close();

  console.log("## a staffer: no lineup door; the league office sees the codes");
  p = await open("#/hq?tab=lineups", "staff");
  await route(p);
  A("Team HQ's lineups are not offered to a staffer (they are the front office's, Rule 2.6)", await p.evaluate(() => !S2.$('[data-w="plan"]') && !S2.$('[data-act="sheet"]')));
  await p.evaluate(() => { window.__now = window.__fx.at1 - 10 * 60000; });
  const gStaff = X.otherNight[0] || X.g1;
  await p.evaluate((g) => { location.hash = "#/game/" + g; }, gStaff); await wait(700);
  r = await p.evaluate((g) => { const s = S2.$('.lb-sec[data-lb="' + g + '"]'); return s ? s.textContent.replace(/\s+/g, " ") : null; }, gStaff);
  A("a staffer reads any game's code where the database says can_view", r && /Lobby code/.test(r) && /(555000|482713)/.test(r), r);
  A("and writes nothing to read it", calls().length === 0, calls());
  await p.context().close();

  console.log("## signed out: no code is ever asked for");
  p = await open("#/game/" + X.g1, "anon");
  await p.evaluate(() => { window.__now = window.__fx.at1 - 10 * 60000; });
  H.R = [];
  await route(p);
  r = await p.evaluate(() => (S2.$(".lb-sec") || {}).textContent || "");
  A("a visitor's page reads no code and says where codes go", H.R.filter((x) => x.t === "games_public").length === 0 && /The code is out to the two clubs/.test(r), r);
  await p.context().close();

  /* commissioner, 2026-11-09 (File all lineups: "yes"): one press files every ready sheet of the night, one at a time */
  console.log("## File all lineups");
  p = await open("#/hq?tab=lineups", "gm");
  await route(p);
  await p.click('[data-lux="fill-night"]'); await wait(400);
  answer("set_game_lineup", (a) => ok({ game_id: a.p_game, team_id: a.p_team, center: a.p_center, lw: a.p_lw, rw: a.p_rw, ld: a.p_ld, rd: a.p_rd, goalie: a.p_goalie, updated_at: new Date(X.at1 - 3600e3).toISOString(), post_lock: false, post_lock_count: 0 }));
  const fn0 = await plan(p);
  A("after filling, the night offers File all lineups, and nothing was written by filling", !!(await p.$('[data-act="file-night"]')) && calls().length === 0, fn0 && fn0.text.slice(0, 120));
  await p.click('[data-act="file-night"]'); await wait(900);
  c = calls().filter((x) => x.rpc === "set_game_lineup");
  r = await plan(p);
  const fnT = await toasts(p), fnFocus = await p.evaluate(() => document.activeElement && (document.activeElement.dataset.act || document.activeElement.dataset.lux));
  A("File all lineups sends each sheet not yet set, one door call each, through the Owner's gate", c.length === 2 && c.map((x) => x.args.p_game).sort().join() === [X.g2, X.g3].sort().join() && c.every((x) => x.approval === "owner"), c.map((x) => x.args.p_game));
  A("then the night reads all three set, the toast says how many, and the focus stays on the night's actions", /3 of 3 set/.test(r.text) && fnT.some((t) => /^Filed 2 lineups/.test(t)) && /night/.test(fnFocus || ""), { k: r.text.slice(0, 60), t: fnT.slice(-1), fnFocus });
  await p.context().close();

  /* QA motion 16 (2026-11-25): the drag ghost lifted 7% in one frame (scale(1.04) in its first transform write). Now the
     lift is a transition on the scale property from the pressed card's .97, the finger is tracked 1:1 on the translate
     property, and the card settles back to 1 on the spring home */
  console.log("## drag: the card lifts once, follows the finger 1:1 and springs home");
  p = await open("#/hq?tab=lineups", "gm");
  await route(p);
  await sheetOpen(p, X.g3);
  const chip = await p.evaluate(() => { const c = S2.$(".sheet .hqx-chip"); c.scrollIntoView({ block: "center" }); const r = (c.querySelector("[data-fpid]") || c).getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, hit: !!(at && at.closest(".hqx-chip") === c) }; });
  A("the bench card is under the pointer to grab", chip.hit, chip);
  await p.mouse.move(chip.x, chip.y); await p.mouse.down(); await p.mouse.move(chip.x + 2, chip.y + 1); await p.mouse.move(chip.x - 60, chip.y - 140);
  const lift = await p.evaluate(() => { const g = S2.$(".hqx-ghost"); if (!g) return null;
    const tr = g.getAnimations().filter((a) => a.transitionProperty === "scale")[0], kf = tr ? tr.effect.getKeyframes() : [];
    return { tr: !!tr, from: kf.length ? String(kf[0].scale) : null, to: kf.length ? String(kf[kf.length - 1].scale) : null, transform: g.style.transform, translate: getComputedStyle(g).translate }; });
  A("the lift is one transition on scale, from the pressed card's .97 to 1.04, never a jump in the first frame", lift && lift.tr && /^0?\.97$/.test(lift.from) && lift.to === "1.04" && !lift.transform, lift);
  A("the ghost follows the finger 1:1 on translate (the grab point stays under the finger)", lift && lift.translate === Math.round(chip.left - 60) + "px " + Math.round(chip.top - 140) + "px" ||
    lift && (() => { const m = /^(-?[\d.]+)px (-?[\d.]+)px$/.exec(lift.translate); return m && Math.abs(+m[1] - (chip.left - 60)) < 0.6 && Math.abs(+m[2] - (chip.top - 140)) < 0.6; })(), { lift, want: [chip.left - 60, chip.top - 140] });
  await wait(300);
  A("lifted, it rests at 1.04", (await p.evaluate(() => getComputedStyle(S2.$(".hqx-ghost")).scale)) === "1.04");
  await p.mouse.move(chip.x - 60, 4); await p.mouse.up(); await wait(60);
  A("let go over nothing, it settles back to the card's own size on the way home", (await p.evaluate(() => { const g = S2.$(".hqx-ghost"); return g ? g.style.scale : "gone"; })) === "1");
  await wait(1200);
  r = await p.evaluate(() => ({ ghost: !!S2.$(".hqx-ghost"), lifted: S2.$$(".sheet .is-lifted").length }));
  A("home: the ghost is gone and the card is whole again", !r.ghost && r.lifted === 0, r);
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.mouse.move(chip.x, chip.y); await p.mouse.down(); await p.mouse.move(chip.x + 2, chip.y + 1); await p.mouse.move(chip.x - 60, chip.y - 140);
  r = await p.evaluate(() => { const g = S2.$(".hqx-ghost"); return g ? { scale: getComputedStyle(g).scale, n: g.getAnimations().length } : null; });
  A("Reduce Motion: no scale and no transition, the shadow alone lifts it", r && (r.scale === "1" || r.scale === "none") && r.n === 0, r);
  await p.mouse.up(); await wait(400);
  await p.context().close();

  console.log("## a phone");
  p = await open("#/hq?tab=lineups", "gm", 375);
  await route(p);
  await sheetOpen(p, X.g2);
  A("the sheet has no sideways scroll at 375", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.context().close();

  A("no page errors", errs.length === 0, errs.slice(0, 4));
  await b.close();
  console.log(fails ? fails + " of " + n + " FAILED" : "all " + n + " passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
