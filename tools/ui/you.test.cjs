const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The You page (v5.00 swap, stream e3, 2026-11-24; on the harness's real-site mode since i3c, 2026-11-25):
     node tools/ui/run.cjs --suite you --mode live      (every context opts in with live: true, so any mode runs it)
   js/pages/you.js on the real site as the build ships it (tools/ui/mock, h0's live mode), signed in as the member persona,
   driven through the real UI. The league is the recorded Season 1 turned back to the eve of week 5 (?season=1, eve()
   below), so the member's own club (Seattle in the recording) has a week to answer; the page clock is pinned before any
   script runs. Every table and read RPC is answered here with PostgREST's semantics (the member's own profile row, the
   club's sheets and answers, the applications, my_discord_accounts), the auth calls Link, Continue with Discord and Sign
   out reach routes that record them, and every write is captured by the write mock, which answers as the database would:
   the row, or a refusal in the database's words. Nothing here reaches Supabase, Netlify or Discord. What is proved, for
   each action on the page: the door and its exact arguments; nothing shows as saved before the database answers; a
   refusal is shown in its words with the choice or the typing kept; the repaint is in place (the same widget, no route);
   and no sample mark reaches the page. No member's name is written here.
   Deleted with demo mode (i3c): the in-page stand-ins for S2.LIVE, S2.session, S2.ensureSb, S2.forms, the auth client and
   S2._writeImpl, and the model stand-in for the member. Also deleted, each needing a stand-in the real site has no seam for:
   the Your week run with the member missing from the club's roster read (the model and the club read are one source now;
   the member's own read, S2.lineups.loadMine, is still checked). "A different member signed in reads their own profile"
   runs on the real sign-in path: js/live.js owns S2.session (page: false) and a second member signs in through supabase-js's
   cross-tab broadcast, which live.js applies in place. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = mock.ok, no = (code, message, hint) => mock.fail(code, message, hint);

/* Season 1 from the recording, turned back to the afternoon of Wed, Oct 21 (ET), the eve of week 5: every game from that
   night on is still to play (no score, no box score), the season is still running, and the league read was taken then.
   o.noSignup leaves the member's own sign-up out */
const EVE = "2026-10-21T20:00:00Z", AHEAD = new Set();
function eve(args, o) {
  if (!AHEAD.size) mock.league({ p_season: 1 }).games.forEach((g) => { if (Date.parse(g.scheduled_at) > Date.parse(EVE)) AHEAD.add(g.id); });
  const b = mock.league(Object.assign({}, args, { p_season: 1 }));
  b.generated = EVE;
  (b.seasons || []).forEach((x) => { if (x.number === 1) x.status = "active"; });
  (b.games || []).forEach((g) => { if (AHEAD.has(g.id)) Object.assign(g, { status: "scheduled", home_score: null, away_score: null, forfeit: null, forfeit_team_id: null, went_ot: false, home_shots: null, away_shots: null, ea_match_id: null }); });
  if (b.box && b.box.byGame) AHEAD.forEach((id) => { delete b.box.byGame[id]; });
  if (o && o.noSignup && b.signups) b.signups = b.signups.filter((x) => x.profile_id !== ME);
  /* QA round 2 (2026-11-25): o.ownerClosed puts Season 2's owner application deadline a day before the read; o.regClosed
     closes Season 2's registration */
  (b.seasons || []).forEach((x) => { if (x.number !== 2) return;
    if (o && o.ownerClosed) x.owner_app_deadline = new Date(Date.parse(EVE) - 864e5).toISOString();
    if (o && o.regClosed) x.registration_open = false; });
  return b;
}
/* the fixture, worked out from the recording before any page opens: the member, their club's week and its players */
const ME = mock.liveSessionOf("member").profileId;
const FX = (() => {
  const b = eve({}), spot = b.rosters.spots.filter((s) => s.profile_id === ME)[0];
  if (!spot) throw new Error("you suite: the member persona holds no Season 1 roster spot in the recording");
  const code = spot.team, team = b.teams.filter((t) => t.code === code)[0], sid = b.seasons.filter((s) => s.number === 1)[0].id;
  const mine = b.games.filter((g) => AHEAD.has(g.id) && g.stage === "regular" && (g.home === code || g.away === code)).sort((x, y) => Date.parse(x.scheduled_at) - Date.parse(y.scheduled_at));
  const week = mine[0].week, wk = mine.filter((g) => g.week === week);
  const unit = (pos) => (pos === "G" ? "G" : pos === "LD" || pos === "RD" ? "D" : "F");
  const mates = b.rosters.spots.filter((s) => s.team === code && s.profile_id !== ME && s.squad !== "tc");
  const of = (u) => mates.filter((s) => unit(s.position) === u).map((s) => s.profile_id);
  const worn = b.rosters.spots.filter((s) => s.team === code).map((s) => +s.jersey_number);
  let free = null; for (let k = 20; k < 100 && free == null; k++) if (worn.indexOf(k) < 0) free = k;
  return { code, tid: team.id, sid, week, wk: wk.map((g) => g.id), g1: wk[0].id, at1: Date.parse(wk[0].scheduled_at), num: spot.jersey_number == null ? null : +spot.jersey_number, free,
    slot: { LW: "lw", C: "center", RW: "rw", LD: "ld", RD: "rd", G: "goalie" }[spot.position] || "center", pos: spot.position, F: of("F"), D: of("D"), G: of("G"),
    people: b.people.map((x) => ({ id: x.id, gamertag: x.gamertag, display_name: x.display_name, avatar_url: x.avatar_url, role: x.role, banned: !!x.banned, ban_reason: null, discord_id: null, discord_username: null, in_guild: true })) };
})();

(async () => {
  /* QA round 2 nit (2026-11-25): "the draft is complete" is the model's one definition (M.draftDone); You's unrostered line
     read draft_state itself. No club page tests a draft's status for "complete" on its own */
  { const fs = require("fs"), path = require("path"), hits = ["hq", "you", "lineups", "tradebuild"].map((f) => [f, fs.readFileSync(path.join(process.env.S2_ROOT, "js/pages/" + f + ".js"), "utf8")])
      .filter((x) => /\b(st|state|draft)\.status\s*===\s*"complete"/.test(x[1])).map((x) => x[0]);
    A("no club page (Team HQ, You, lineups, the trade page) tests the draft's completion itself: each asks M.draftDone", hits.length === 0, hits); }
  const b = await chromium.launch(), errs = [];
  let H = null;
  /* o: answered (false: no answer on file), late (the week row on file is stamped late), readFail ({table: message}), chosen (the number saved; "free"), inGuild,
     stash (back from Link), noSignup, ownerApp (null: none on file), writes (answers in place before the page boots),
     page (false: js/live.js builds S2.session from the network answers, as on the real site, instead of the mock) */
  async function open(hash, who, o, w) {
    o = o || {};
    const ctx = await b.newContext({ viewport: { width: w || 1280, height: 900 } });
    const yes = {}; yes[FX.g1] = "yes";
    const six = { lw: FX.F[0], center: FX.F[1], rw: FX.F[2], ld: FX.D[0], rd: FX.D[1], goalie: FX.G[0] }; six[FX.slot] = ME;
    H = { ctx, R: [], F: Object.assign({}, o.readFail), auth: [],
      apps: { owner: o.ownerApp === undefined ? { id: "oa1", status: "pending", ea_id: null, availability: null, experience: null, preferred_club: "Minnesota Wild", franchise_2: null, franchise_3: null, pitch: null, edited_at: null } : o.ownerApp, staff: null },
      dc: { current: "dc-old", in_guild: !!o.inGuild, invite: "https://discord.gg/example", accounts: [
        { discord_id: "dc-old", username: "OldName", linked_at: new Date(FX.at1 - 90 * 864e5).toISOString() },
        { discord_id: "dc-new", username: "NewName", linked_at: new Date(FX.at1 - 2 * 3600e3 + 1000).toISOString() }] },
      T: {
        game_lineups: [Object.assign({ game_id: FX.g1, team_id: FX.tid, updated_at: new Date(FX.at1 - 5 * 3600e3).toISOString(), post_lock: false, post_lock_at: null, post_lock_count: 0 }, six)],
        availability: o.answered !== false ? [{ profile_id: ME, season_id: FX.sid, week_key: "w" + FX.week, nights: { n1: { games: yes, st: "yes" } }, submitted_at: null, late: !!o.late }] : [],
        market_pool_requests: [], team_lines: [], team_line_plan: [], game_vetoes: [],
        /* o.notifs: that many unread alerts for the member (QA function 21) */
        notifications: Array.from({ length: o.notifs || 0 }, (_, i) => ({ id: "nt-" + (i + 1), type: "info", title: "League update " + (i + 1), body: "A league notice.", link_view: null, link_param: null, read: false,
          created_at: new Date(FX.at1 - (i + 3) * 3600e3).toISOString(), silent: false })),
        profiles: FX.people.map((x) => x.id === ME ? Object.assign({}, x, { discord_username: "OldName", in_guild: !!o.inGuild, ea_id: "EaOld", platform: "XSX", platform_gamertag: "TagOld", preferred_server: null,
          jersey_number: o.chosen === "free" ? FX.free : o.chosen === undefined ? FX.num : o.chosen, ea_player_id: null }) : x)
      } };
    const table = (t) => (q) => { H.R.push({ t, f: q.filters.slice(), sel: q.select }); return H.F[t] ? no("42501", H.F[t]) : H.T[t]; };
    const tables = {};
    Object.keys(H.T).forEach((t) => { tables[t] = table(t); });
    /* the applications S2.forms.mine reads: the member's own, for the season taking sign-ups (the filter's own season) */
    const app = (k) => (q) => { H.R.push({ t: k + "_applications", f: q.filters.slice() }); if (H.F[k]) return no("42501", H.F[k]); const s = q.filters.filter((f) => f[0] === "season_id")[0];
      return H.apps[k] ? [Object.assign({ profile_id: ME, season_id: s ? s[1].slice(3) : null }, H.apps[k])] : []; };
    tables.owner_applications = app("owner"); tables.staff_applications = app("staff");
    /* o.pfFail: the league profile's own read (Settings, its ea_player_id column) is refused with that message, as an
       unknown column answers (42703); the session's profile read is not touched */
    if (o.pfFail) { const t0 = tables.profiles; tables.profiles = (q) => /ea_player_id/.test(q.select || "") ? no("42703", o.pfFail) : t0(q); }
    const rec = (k, r) => (url, args) => { H.auth.push({ k, args, path: url.pathname }); return r(args); };
    await mock.install(ctx, { live: true, persona: who, page: o.page, writes: Object.assign({}, o.writes), tables,
      rpcs: { s2_league: (a) => ok(eve(a, o)), my_discord_accounts: () => ok(JSON.parse(JSON.stringify(H.dc))) },
      routes: {
        "GET /auth/v1/user/identities/authorize": rec("link", () => (H.linkErr ? { status: 422, json: { code: 422, error_code: "manual_linking_disabled", msg: H.linkErr } } : { status: 200, json: { url: "about:blank" } })),
        "GET /auth/v1/authorize": rec("oauth", () => ({ status: 200, json: { ok: true } })),
        "POST /auth/v1/logout": rec("out", () => ({ status: 204 })),
        /* the bell's door (js/live.js S2.notifs.seen): the member's unread alerts marked read, as RLS lets them */
        "PATCH /rest/v1/notifications": (url, args) => { H.patch = (H.patch || []).concat([{ q: url.search, args }]);
          const hit = H.T.notifications.filter((n) => !n.read); hit.forEach((n) => { n.read = true; }); return { status: 200, json: hit.map((n) => ({ id: n.id })) }; }
      } });
    /* the page clock, before any script runs: two hours before the club's first game of the week; a stash says Link was
       just pressed */
    await ctx.addInitScript((x) => { window.__now = x.now; Date.now = () => window.__now;
      try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" }));
        if (x.stash) localStorage.setItem("s2_dc_switch", JSON.stringify({ at: x.now - 1000 })); } catch (e) { /* storage blocked */ } }, { now: FX.at1 - 2 * 3600e3, stash: !!o.stash });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/could not be read|Failed to load resource|^S2\.market:|was refused/.test(m.text())) errs.push(m.text()); });
    await p.goto(S2_BASE + "?season=1" + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2._hq && S2._you && S2.lineups && S2.auth && S2.auth.sub, null, { timeout: 20000 });
    await p.evaluate(() => { window.__toasts = []; const t0 = S2.toast; S2.toast = function (m) { window.__toasts.push(String(m)); return t0.apply(this, arguments); }; });
    await wait(900);
    return p;
  }
  const answer = (rpc, fn) => mock.respond(H.ctx, rpc, async (args) => fn(args));
  /* the database keeps what is written, because each answer reads the member's row fresh before it writes
     (js/pages/lineups.js saveAvailability). QA nits 35 (2026-11-25): and it stamps the row as stamp_availability does:
     late once an answer lands after the week's deadline (H.pastDue, the page clock past it), and never cleared */
  const landed = async (a) => {
    const t = H.T.availability, i = t.findIndex((x) => x.profile_id === a.row.profile_id && x.week_key === a.row.week_key && x.season_id === a.row.season_id);
    const late = !!(i >= 0 && t[i].late) || !!H.pastDue;
    if (i >= 0) t[i] = Object.assign({}, t[i], a.row, { late }); else t.push(Object.assign({ submitted_at: null }, a.row, { late }));
    return ok([{ id: "av1", week_key: a.row.week_key, nights: a.row.nights, late }]);
  };
  const calls = () => mock.calls(H.ctx).map((c) => ({ rpc: c.rpc, args: c.args }));
  const last = (rpc) => calls().filter((c) => c.rpc === rpc).pop();
  const toasts = (p) => p.evaluate(() => window.__toasts.slice());
  const row = (p, gid) => p.evaluate((g) => { const r = S2.$('.hqx-g[data-g="' + g + '"]'); if (!r) return null;
    const bt = (v) => { const x = r.querySelector('[data-av="' + v + '"]'); return { pressed: x.getAttribute("aria-pressed") === "true", off: x.disabled, cls: x.className }; };
    return { text: r.textContent.replace(/\s+/g, " "), yes: bt("yes"), no: bt("no") }; }, gid);
  const click = (p, sel) => p.evaluate((s) => { const el = S2.$(s); if (!el) return false; el.click(); return true; }, sel);
  const text = (p, sel) => p.evaluate((s) => { const el = S2.$(s); return el ? el.textContent.replace(/\s+/g, " ") : null; }, sel);
  const sheetText = (p) => p.evaluate(() => { const s = S2.$(".sheet"); return s ? s.textContent.replace(/\s+/g, " ") : null; });
  const nightOf = (gid) => p.evaluate((g) => { const x = S2.M.games.filter((y) => y.id === g)[0], days = []; S2.M.games.forEach((y) => { if (y.week === x.week && (y.stage || "regular") === (x.stage || "regular") && days.indexOf(y.night) < 0) days.push(y.night); }); return "n" + (days.sort().indexOf(x.night) + 1); }, gid);
  const filt = (r, col, op, val) => r.f.some((f) => f[0] === col && (op === "in" ? f[1].indexOf("in.(") === 0 && val(f[1].slice(4, -1).split(",")) : f[1] === op + "." + val));
  let p, r, c;
  const who = "member", X = FX;

  console.log("## Your week: the member's own answers, read and saved through S2.lineups");
  p = await open("#/you?tab=week", who);
  const rl = H.R.filter((x) => x.t === "game_lineups")[0], mineRead = H.R.filter((x) => x.t === "availability" && filt(x, "profile_id", "eq", ME))[0];
  A("Your week reads the club's sheets for its own week (S2.lineups.load)", rl && filt(rl, "team_id", "eq", X.tid) && filt(rl, "game_id", "in", (l) => l.length === X.wk.length), rl);
  A("and the member's own answers, in a read of their own (S2.lineups.loadMine)", mineRead && filt(mineRead, "season_id", "eq", X.sid) && filt(mineRead, "week_key", "in", (l) => l.indexOf("w" + X.week) >= 0), H.R.filter((x) => x.t === "availability"));
  r = await row(p, X.g1);
  A("an answer on file shows as the database holds it (Available pressed)", r && r.yes.pressed && !r.no.pressed && !r.yes.off, r);
  A("the member's lineup status comes from the club's real sheet", r && new RegExp("Dressed at " + X.pos).test(r.text), r && r.text);
  r = await p.evaluate(() => ({ chip: !!S2.$("#page .chip.sample"), about: !!S2.$("#page details.about"), note: !!S2.$("#page [data-note]") }));
  A("no sample chip, no About-this-data note and no unsaved night-note box on the page", !r.chip && !r.about && !r.note, r);
  r = await text(p, '[data-w="due"]');
  A("the window counts the week's games still without an answer", r && new RegExp((X.wk.length - 1) + " games? to answer").test(r), r);

  const g2 = X.wk[1], g3 = X.wk[2];
  await p.evaluate(() => { window.__pane = S2.$('[data-w="yweek"]'); window.__hash = location.hash; });
  let release; answer("availability.upsert", (a) => new Promise((res) => { release = () => res(landed(a)); }));
  await click(p, '[data-av="no"][data-g="' + g2 + '"]'); await wait(300);
  r = await row(p, g2);
  A("while the database has not answered, nothing shows as chosen: Saving, both answers off", r && !r.no.pressed && /is-saving/.test(r.no.cls) && r.no.off && r.yes.off && /Saving Not available/.test(r.text), r);
  release(); await wait(500);
  r = await row(p, g2);
  c = last("availability.upsert");
  A("confirmed: Not available is pressed and the row is quiet", r && r.no.pressed && !r.yes.pressed && !/Saving/.test(r.text) && !r.no.off, r);
  A("the door is the member's week row: season, member, week key, the game's answer and the night's summary", c && c.args.onConflict === "season_id,profile_id,week_key" && c.args.row.season_id === X.sid &&
    c.args.row.profile_id === ME && c.args.row.week_key === "w" + X.week && c.args.row.nights[await nightOf(g2)].games[g2] === "no", c && c.args);
  A("the week row keeps the answer already on file", c && c.args.row.nights.n1 && c.args.row.nights.n1.games[X.g1] === "yes", c && c.args.row.nights);
  r = await p.evaluate(() => ({ same: S2.$('[data-w="yweek"]') === window.__pane && window.__pane.isConnected, hash: location.hash === window.__hash }));
  A("the pane repainted in place: the same widget, no route", r.same && r.hash, r);
  r = await text(p, '[data-w="due"]');
  A("the window's count follows the confirmed answer", r && new RegExp((X.wk.length - 2) + " games? to answer|Every game answered").test(r), r);

  const RLS = "new row violates row-level security policy for table \"availability\"";
  answer("availability.upsert", () => no("42501", RLS));
  await click(p, '[data-av="yes"][data-g="' + g3 + '"]'); await wait(500);
  r = await row(p, g3);
  A("a refusal keeps the choice on the row, unsaved, with the database's words and Try again", r && !r.yes.pressed && /is-unsaved/.test(r.yes.cls) && r.text.indexOf("Not saved: " + RLS) >= 0 && !!(await p.$('[data-ya="av-retry"][data-g="' + g3 + '"]')), r);
  A("and says so in a toast", (await toasts(p)).some((t) => t.indexOf(RLS) >= 0));
  answer("availability.upsert", landed);
  await click(p, '[data-ya="av-retry"][data-g="' + g3 + '"]'); await wait(500);
  r = await row(p, g3);
  A("Try again sends the same answer, and once confirmed the row is clean", r && r.yes.pressed && !/is-unsaved/.test(r.yes.cls) && !/Not saved/.test(r.text) && last("availability.upsert").args.row.nights[await nightOf(g3)].games[g3] === "yes", r);

  const before = calls().filter((x) => x.rpc === "availability.upsert").length;
  const open_ = await p.evaluate(() => S2.availability.week().filter((x) => !x.answer).map((x) => x.game.id));
  if (open_.length) {
    await click(p, '[data-ya="all-yes"]'); await wait(500 + open_.length * 300);
    const sent = calls().filter((x) => x.rpc === "availability.upsert").slice(before);
    const lastRow = sent.length ? sent[sent.length - 1].args.row.nights : {};
    const all = Object.keys(lastRow).reduce((o, k) => Object.assign(o, lastRow[k].games || {}), {});
    A("Available for the rest saves each open game, one after another, each row carrying the answers before it", sent.length === open_.length && open_.every((g) => all[g] === "yes") && all[g2] === "no" && all[X.g1] === "yes", { sent: sent.length, open: open_.length, all });
    r = await text(p, '[data-w="due"]');
    A("and the window says every game is answered", /Every game answered/.test(r || ""), r);
  } else A("Available for the rest: every game was already answered", true);

  r = await row(p, g2);
  A("an answer before the deadline carries no Late mark", r && !/Late/.test(r.text), r && r.text);
  await p.evaluate((t) => { window.__now = t; }, X.at1 - 3600e3);   /* 8 PM ET: past the 7:30 deadline, before the lock */
  H.pastDue = true;
  await click(p, '[data-av="no"][data-g="' + X.g1 + '"]'); await wait(500);
  r = await row(p, X.g1);
  A("an answer after the deadline is marked late (Rule 5.1)", r && r.no.pressed && /Late/.test(r.text), r && r.text);
  r = await text(p, '[data-w="due"]');
  A("and the week's head says the week is on file as late", /on file as late/.test(r || ""), r);
  await p.context().close();

  /* QA nits 35: the late mark is the database's row, so it survives a reload (it was this tab's guess and was lost) */
  console.log("## Your week: a week the database marked late reads late after a reload");
  p = await open("#/you?tab=week", who, { late: true });
  r = await text(p, '[data-w="due"]');
  const lateRead = H.R.filter((x) => x.t === "availability" && filt(x, "profile_id", "eq", ME))[0];
  A("the member's own read asks for the row's late flag, and the week's head says it", lateRead && /late/.test(lateRead.sel || "") && /on file as late/.test(r || ""), { sel: lateRead && lateRead.sel, r });
  await p.context().close();

  console.log("## Your week: a read that fails is never drawn as empty");
  p = await open("#/you?tab=week", who, { answered: false, readFail: { availability: "permission denied for table availability" } });
  r = await text(p, '[data-w="yweek"]');
  A("the reason and Try again, and no answer drawn", r && /Your answers could not be read/.test(r) && /permission denied/.test(r) && !!(await p.$('[data-ya="lu-reload"]')), r);
  r = await row(p, X.wk[0]);
  A("the answer buttons are off while nothing was read", r && r.yes.off && r.no.off && !r.yes.pressed, r);
  H.F = {};
  await click(p, '[data-ya="lu-reload"]'); await wait(800);
  r = await row(p, X.wk[0]);
  A("Try again reads it, and the buttons come on", r && !r.yes.off && !/could not be read/.test((await text(p, '[data-w="yweek"]')) || ""), r);
  await p.context().close();

  console.log("## Settings: the Discord accounts (my_discord_accounts, switch_discord_account, link)");
  p = await open("#/you?tab=settings", who);
  /* QA visual 2 (2026-11-25): a stray closing tag in Appearance dropped every later group out of the right column */
  r = await p.evaluate(() => { const st = S2.$(".hqx-pane .hqx-stack.hqx-tight"), hs = S2.$$(".hqx-pane .hqx-group-h");
    return { n: hs.length, inside: hs.filter((h) => st && st.contains(h)).length, lefts: hs.map((h) => Math.round(h.getBoundingClientRect().left)), out: !!(st && S2.$('.hqx-pane [data-ya="signout"]') && st.contains(S2.$('.hqx-pane [data-ya="signout"]'))) }; });
  A("Settings: every group (Appearance, Discord, League profile, Your data) and Sign out sit in the one column, on one left edge", r.n >= 4 && r.inside === r.n && r.out && r.lefts.every((x) => x === r.lefts[0]), r);
  r = await text(p, '[data-w="dc"]');
  A("the row reads the accounts: the one the league follows, and not in the server", r && /The league follows OldName/.test(r) && /Not in the server yet/.test(r), r);
  await click(p, '[data-act="discord"]'); await wait(500);
  r = await p.evaluate(() => { const s = S2.$('[data-w="dcs"]'); const a = s && s.querySelector('a.discord'); return s ? { t: s.textContent.replace(/\s+/g, " "), href: a && a.getAttribute("href"), tgt: a && a.target, use: !!s.querySelector('[data-x="use"][data-v="dc-new"]') } : null; });
  A("the sheet carries the invite (a new tab), the re-check and the Rule 1.1 warning", r && r.href === "https://discord.gg/example" && r.tgt === "_blank" && /I have joined, re-check/.test(r.t) && /Rule 1\.1/.test(r.t), r);
  A("and the other linked account with Use this account", r && r.use && /NewName/.test(r.t), r);
  answer("switch_discord_account", () => no("P0001", "That Discord account is not linked to your login. Link it first, then switch to it."));
  await click(p, '[data-x="use"][data-v="dc-new"]'); await wait(700);
  A("a refused switch says the database's words", (await toasts(p)).some((t) => /Could not switch: That Discord account is not linked to your login/.test(t)), await toasts(p));
  answer("switch_discord_account", () => ok({ changed: true, discord_id: "dc-new", previous: "dc-old", in_guild: true, display: "NewName" }));
  H.dc = Object.assign({}, H.dc, { current: "dc-new", in_guild: true });
  await click(p, '[data-x="use"][data-v="dc-new"]'); await wait(800);
  c = last("switch_discord_account");
  r = await p.evaluate(() => ({ s: (S2.$('[data-w="dcs"]') || {}).textContent || "", row: (S2.$('[data-w="dc"]') || {}).textContent || "" }));
  A("Use this account switches through switch_discord_account with that account's id", c && c.args.p_discord_id === "dc-new", c);
  A("and the sheet and the row are read again: the new account, in the server", /The league follows NewName/.test(r.s) && !/not in the league Discord yet/.test(r.s) && /In the server/.test(r.row), r);
  A("the switch is said", (await toasts(p)).some((t) => /Switched to NewName/.test(t)));
  H.linkErr = "Manual linking is disabled";
  await click(p, '[data-x="link"]'); await wait(600);
  r = { a: H.auth.filter((x) => x.k === "link").pop(), s: await p.evaluate(() => (S2.$('[data-w="dcs"]') || {}).textContent || "") };
  A("Link asks Discord for identify only and comes back to Settings", r.a && r.a.args.provider === "discord" && r.a.args.scopes === "identify" && /#\/you\?tab=settings|\/demo\.html|\?season=1/.test(String(r.a.args.redirect_to || "")), r.a);
  A("a link Supabase refuses is said in its words, in the sheet", /Could not start the link: Manual linking is disabled/.test(r.s), r.s);
  await p.context().close();

  /* QA nits 2026-11-25: "I have joined, re-check" had only its words checked. It reads my_discord_accounts again: in the
     server is said, the row and the member's profile follow; not yet is said; a failed read gives the button back */
  console.log("## Settings: I have joined, re-check (my_discord_accounts again)");
  p = await open("#/you?tab=settings", who);
  await click(p, '[data-act="discord"]'); await wait(500);
  H.dc = Object.assign({}, H.dc, { in_guild: false });
  await click(p, '[data-x="recheck"]'); await wait(700);
  r = { t: await toasts(p), s: await p.evaluate(() => (S2.$('[data-w="dcs"]') || {}).textContent || "") };
  A("still outside the server: said, and the re-check stays offered", r.t.some((x) => /Not seeing that account in the server yet/.test(x)) && /I have joined, re-check/.test(r.s), r);
  const door = () => p.evaluate(() => ((S2.$("[data-foot-door]") || {}).textContent || "").trim());
  r = await door();
  A("outside the server, the footer offers Join the Discord", /Join the Discord/.test(r), r);
  H.dc = Object.assign({}, H.dc, { in_guild: true });
  await click(p, '[data-x="recheck"]'); await wait(700);
  /* QA round 2 (2026-11-25): the re-check set in_guild but left the chrome as it was */
  r = await door();
  A("once the re-check finds the member in the server, the footer's Join the Discord door is gone, repainted in place (S2.paintChrome)", r === "", r);
  r = { t: await toasts(p), row: await p.evaluate(() => (S2.$('[data-w="dc"]') || {}).textContent || ""), inGuild: await p.evaluate(() => S2.auth.profile && S2.auth.profile.in_guild) };
  A("joined: You are in is said, the row reads In the server and the member's profile is in the guild", r.t.some((x) => /You are in/.test(x)) && /In the server/.test(r.row) && r.inGuild === true, r);
  await p.context().close();
  p = await open("#/you?tab=settings", who);
  await click(p, '[data-act="discord"]'); await wait(500);
  mock.respond(H.ctx, "rpc:my_discord_accounts", () => no("57014", "canceling statement due to statement timeout"));
  await click(p, '[data-x="recheck"]'); await wait(700);
  r = { t: await toasts(p), b: await p.evaluate(() => { const x = S2.$('[data-x="recheck"]'); return x ? { off: x.disabled, text: x.textContent } : null; }) };
  /* rewritten in QA round 2 (2026-11-25): this check pinned the raw form ("The check did not go through: canceling
     statement ..."), the database's words as the whole sentence; it now pins plain words first, with those words kept */
  A("a failed check is said in plain words with the database's own words kept, and the button comes back",
    r.t.some((x) => /^The check did not go through\. The league did not answer as expected\..*The league said: canceling statement due to statement timeout\.$/.test(x)) && r.b && !r.b.off && r.b.text === "I have joined, re-check", r);
  await p.context().close();

  p = await open("#/you?tab=settings", who, { stash: true, writes: { switch_discord_account: ok({ changed: true, discord_id: "dc-new", in_guild: false, display: "NewName" }) } });
  await p.evaluate(() => S2.route(true)); await wait(900);
  c = last("switch_discord_account");
  A("back from Link, the account linked since then is switched to once", c && c.args.p_discord_id === "dc-new" && calls().filter((x) => x.rpc === "switch_discord_account").length === 1, calls());
  await p.context().close();

  console.log("## Settings: the league profile (profiles.update, set_my_jersey_number)");
  p = await open("#/you?tab=settings", who);
  r = await p.evaluate(() => ({ ea: S2.$("#yxEa").value, plat: S2.$("#yxPlat").value, tag: S2.$("#yxTag").value, lbl: S2.$("#yxTagL").textContent, num: S2.$("#yxNum").value, was: S2.$("#yxNum").dataset.was, hint: S2.$('[data-w="jhint"]').textContent }));
  A("the form is the member's own row: EA ID, console, console name, and the number worn", r.ea === "EaOld" && r.plat === "XSX" && r.tag === "TagOld" && r.num === String(X.num) && r.was === String(X.num) && new RegExp("You wear #" + X.num + " for the ").test(r.hint), r);
  A("the console name's label follows the console (Xbox Gamertag)", r.lbl === "Xbox Gamertag", r.lbl);
  await p.evaluate(() => { const s = S2.$("#yxPlat"); s.value = "PS5"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  r = await p.evaluate(() => ({ lbl: S2.$("#yxTagL").textContent, tag: S2.$("#yxTag").value }));
  A("changing the console relabels the field and keeps what is typed in it", r.lbl === "PSN Name" && r.tag === "TagOld", r);
  await p.evaluate(() => { S2.$("#yxEa").value = "  EaNew "; S2.$("#yxTag").value = "TagNew"; window.__ea = S2.$("#yxEa"); });
  answer("profiles.update", () => ok([{ id: "x" }]));
  await click(p, '[data-ya="pf-save"]'); await wait(500);
  c = last("profiles.update");
  A("Save sends the four columns a member may edit, matched on their own id, asking for the id back", c && JSON.stringify(c.args.set) === JSON.stringify({ ea_id: "EaNew", platform: "PS5", platform_gamertag: "TagNew", preferred_server: null }) && c.args.match.id === ME, c && c.args);
  A("a save that leaves the number alone never sends it", !last("set_my_jersey_number"), calls());
  r = await p.evaluate(() => ({ same: S2.$("#yxEa") === window.__ea && window.__ea.isConnected, msg: S2.$('[data-w="pform"] .yx-msg').textContent, clean: S2.$("#yxEa").value === S2.$("#yxEa").defaultValue }));
  A("confirmed: Profile saved, the same fields (never redrawn under the typing), now clean", r.same && /Profile saved\./.test(r.msg) && r.clean, r);

  await p.evaluate(() => { S2.$("#yxNum").value = "7"; });
  answer("set_my_jersey_number", (a) => ok({ chosen: a.p_number, wearing: a.p_number, team_id: X.tid }));
  await click(p, '[data-ya="pf-save"]'); await wait(500);
  c = last("set_my_jersey_number");
  r = await p.evaluate(() => ({ num: S2.$("#yxNum").value, was: S2.$("#yxNum").dataset.was, hint: S2.$('[data-w="jhint"]').textContent, msg: S2.$('[data-w="pform"] .yx-msg').textContent }));
  A("a changed number goes through set_my_jersey_number", c && c.args.p_number === 7, c);
  A("and the page shows the number the database says is worn", r.num === "7" && r.was === "7" && /You wear #7 for the /.test(r.hint) && /You wear #7 for the /.test(r.msg), r);
  const TAKEN = "#12 is already worn by a teammate on your club. Pick another number.";
  answer("set_my_jersey_number", () => no("23505", TAKEN));
  await p.evaluate(() => { S2.$("#yxNum").value = "12"; });
  await click(p, '[data-ya="pf-save"]'); await wait(500);
  r = await p.evaluate(() => ({ num: S2.$("#yxNum").value, was: S2.$("#yxNum").dataset.was, msg: S2.$('[data-w="pform"] .yx-msg').textContent }));
  A("a refused number stays as typed, with the database's words", r.num === "12" && r.was === "7" && r.msg.indexOf("your number did not change: " + TAKEN) >= 0, r);
  answer("profiles.update", () => no("S2_NO_ROWS", "S2.write: profiles.update changed 0 rows"));
  await p.evaluate(() => { S2.$("#yxEa").value = "EaThird"; S2.$("#yxNum").value = "7"; });
  await click(p, '[data-ya="pf-save"]'); await wait(500);
  r = await p.evaluate(() => ({ ea: S2.$("#yxEa").value, msg: S2.$('[data-w="pform"] .yx-msg').textContent }));
  A("a profile update that changed no row is a failure (RLS filters silently), and the typing stays", r.ea === "EaThird" && /did not save\. Your sign-in may have expired/.test(r.msg), r);
  const n0 = calls().length;
  await p.evaluate(() => { S2.$("#yxNum").value = "100"; });
  await click(p, '[data-ya="pf-save"]'); await wait(300);
  r = await text(p, '[data-w="pform"] .yx-msg');
  A("a number outside 1 to 99 is refused before anything is sent", calls().length === n0 && /whole number from 1 to 99/.test(r || ""), r);
  await p.context().close();

  p = await open("#/you?tab=settings", who, { chosen: "free" });
  r = await text(p, '[data-w="jhint"]');
  A("a saved choice not worn, and free on the club, is offered: Wear #N", new RegExp("your saved choice is #" + X.free + ",").test(r || "") && !!(await p.$('[data-ya="wear"][data-n="' + X.free + '"]')), r);
  answer("set_my_jersey_number", (a) => ok({ chosen: a.p_number, wearing: a.p_number, team_id: X.tid }));
  await click(p, '[data-ya="wear"]'); await wait(500);
  r = await p.evaluate(() => ({ hint: S2.$('[data-w="jhint"]').textContent, num: S2.$("#yxNum").value }));
  c = last("set_my_jersey_number");
  A("Wear #N puts it on the club through set_my_jersey_number, and the field says so", c && c.args.p_number === X.free && new RegExp("You wear #" + X.free + " for the ").test(r.hint) && r.num === String(X.free), r);
  await p.context().close();

  console.log("## Settings: another member signs in in the same tab (js/live.js applies a new sign-in in place, no reload)");
  /* a sign-in in another tab reaches this one through supabase-js's broadcast; js/live.js onAuth takes the new member, re-reads
     who they are and repaints in place. Nothing the page read for the first member (you.js self() and forget()) may show
     to the second. The mock does not own S2.session here (page: false): live.js builds it, as on the real site */
  p = await open("#/you?tab=settings", who, { page: false });
  r = await p.evaluate(() => ({ id: S2.session.profileId, ea: (S2.$("#yxEa") || {}).value }));
  A("live.js signs the first member in (no injected session), and the form is their own row", r.id === ME && r.ea === "EaOld", r);
  const U2 = "00000000-0000-4000-8000-0000000000b2";
  H.T.profiles.push({ id: U2, gamertag: "Second member", display_name: "Second member", avatar_url: null, role: "member", banned: false, ban_reason: null, discord_id: null, discord_username: null, in_guild: true,
    ea_id: "EaTwo", platform: "PS5", platform_gamertag: "TagTwo", preferred_server: "NA West", jersey_number: null, ea_player_id: null });
  H.R = [];
  await p.evaluate((u) => { const bc = new BroadcastChannel("sb-bzbuyclwdhmhdzujxeqd-auth-token");
    bc.postMessage({ event: "SIGNED_IN", session: { access_token: "mock-second", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "mock-second",
      user: { id: u, aud: "authenticated", role: "authenticated", app_metadata: { provider: "discord" }, user_metadata: {} } } });
    bc.close(); }, U2);
  await p.waitForFunction((u) => S2.session.profileId === u && S2.$("#yxEa") && S2.$("#yxEa").value === "EaTwo", U2, { timeout: 8000 }).catch(() => {});
  r = await p.evaluate(() => ({ id: S2.session.profileId, ea: (S2.$("#yxEa") || {}).value, srv: (S2.$("#yxSrv") || {}).value, tag: (S2.$("#yxTag") || {}).value }));
  const read2 = H.R.filter((x) => x.t === "profiles" && /ea_id/.test(x.sel || "") && filt(x, "id", "eq", U2));
  A("a different member signed in reads their own profile, never the last member's", r.id === U2 && r.ea === "EaTwo" && r.srv === "NA West" && r.tag === "TagTwo" && read2.length >= 1, Object.assign({ reads: read2.length }, r));
  await p.context().close();

  console.log("## Your season: the member's own sign-up, from the league read");
  p = await open("#/you?tab=season", who);
  r = await text(p, '[data-w="s2reg"]');
  A("signed up: the checklist says so, from the model, with the form's door to change it", r && /You are signed up/.test(r) && !!(await p.$('[data-w="s2reg"] [data-flow="register"]')) && !/sample/i.test(r), r);
  r = await p.evaluate(() => ({ s1: /Season 1 line/.test(S2.$("#page").textContent) && S2.M.view.name !== "Season 1" }));
  A("the season is named from the season on screen, never a fixed Season 1", !r.s1, r);
  await p.context().close();
  p = await open("#/you?tab=season", who, { noSignup: true });
  r = await p.evaluate(() => { const s = S2.$('[data-w="s2reg"]'); return s ? { t: s.textContent.replace(/\s+/g, " "), todo: s.querySelectorAll(".hqx-ck.is-todo").length } : null; });
  A("not signed up: says so, and the steps not done are open rings", r && /You have not signed up/.test(r.t) && r.todo >= 1, r);
  await p.context().close();

  console.log("## Applications: read with S2.forms.mine, withdrawn with S2.forms (e5's doors)");
  p = await open("#/you?tab=applications", who);
  r = await text(p, '[data-w="apps"]');
  A("the owner application on file, in review, with the one edit (e5's form) and Withdraw", r && /Minnesota Wild, in review/.test(r) && !!(await p.$('[data-w="apps"] [data-flow="owner"]')) && !!(await p.$('[data-act="app-withdraw"][data-app="owner"]')), r);
  A("no staff application on file: the form's door to apply", r && /No staff application on file/.test(r) && !!(await p.$('[data-w="apps"] [data-flow="staff"]')), r);
  /* QA nits 36 (2026-11-25): with ?season=1 on screen the block read "Season 1" and a past Season 1 deadline */
  r = await p.evaluate(() => { const rs = S2.forms.regSeason(), k = (S2.$('[data-w="apps"] .hqx-app .kicker') || {}).textContent || "", ct = S2._hq.calText;
    return { view: S2.M.view.season, rs: rs && rs.number, name: rs && rs.name, k, want: rs && ct(rs.number, "owner_app_deadline"), old: ct(S2.M.view.season, "owner_app_deadline"), t: (S2.$('[data-w="apps"]') || {}).textContent.replace(/\s+/g, " ") }; });
  A("the owner application is labeled and dated by the season taking sign-ups, not the season on screen", r.rs && r.rs !== r.view && r.k.indexOf(r.name) >= 0 && !/Season 1/.test(r.k) &&
    r.t.indexOf(r.want) >= 0 && (r.old === r.want || r.t.indexOf(r.old) < 0), r);
  answer("withdraw_owner_application", () => no("P0001", "WITHDRAW: This application was already decided."));
  await click(p, '[data-act="app-withdraw"][data-app="owner"]'); await wait(400);
  await click(p, '.sheet [data-x="go"]'); await wait(500);
  r = await p.evaluate(() => ({ open: !!S2.$(".sheet"), err: (S2.$(".sheet .hqx-err") || {}).textContent || "" }));
  c = calls().filter((x) => x.rpc === "withdraw_owner_application");
  A("a refused withdrawal keeps the sheet open with the database's words", r.open && r.err === "This application was already decided." && c.length === 1 && c[0].args.p_app === "oa1", { r, c });
  answer("withdraw_owner_application", () => ok({ ok: true, status: "withdrawn", final: false }));
  await click(p, '.sheet [data-x="go"]'); await wait(600);
  r = await p.evaluate(() => ({ open: !!S2.$(".sheet"), t: (S2.$('[data-w="apps"]') || {}).textContent || "" }));
  A("confirmed: the sheet closes and the application reads Withdrawn, with File again", !r.open && /Withdrawn/.test(r.t) && /File again/.test(r.t), r);
  /* QA round 2 nit (2026-11-25): filing again updates the same row, so it is "file it again", never "a new one"; with the
     one edit unused nothing more is said */
  A("...and says it may be filed again until the deadline, not that a new one may be filed", /You may file it again until /.test(r.t) && !/a new one|one edit is used/.test(r.t), r.t);
  await p.context().close();
  /* with the one edit used, a changed refiling is refused (guard_owner_app_one_edit, v4.20): the block says so */
  p = await open("#/you?tab=applications", who, { ownerApp: { id: "oa1", status: "withdrawn", ea_id: null, availability: null, experience: null, preferred_club: "Minnesota Wild", franchise_2: null, franchise_3: null, pitch: null,
    edited_at: "2026-11-20T15:00:00Z" } });
  r = await text(p, '[data-w="apps"]');
  A("withdrawn after the one edit: it may be filed again only as it was", r && /You may file it again until /.test(r) && /Your one edit is used, so it can be filed again only as it was\./.test(r) && !!(await p.$('[data-w="apps"] [data-flow="owner"]')), r);
  await p.context().close();
  p = await open("#/you?tab=applications", who, { readFail: { owner: "permission denied for table owner_applications" } });
  r = await text(p, '[data-w="apps"]');
  A("an application that could not be read says so, with Try again", r && /Could not be read/.test(r) && /permission denied/.test(r) && !!(await p.$('[data-ya="ap-reload"]')), r);
  A("...in plain words first, the database's words kept after them (QA round 2)", /The league did not answer as expected\..*The league said: permission denied for table owner_applications\./.test(r), r);
  await p.context().close();
  /* QA round 2 (2026-11-25): the block offered Apply, the one edit and File again after owner applications closed, and the
     database refused each; it follows S2.forms.ownerAppsOpen now */
  p = await open("#/you?tab=applications", who, { ownerClosed: true, ownerApp: null });
  r = await p.evaluate(() => ({ open: S2.forms.ownerAppsOpen(), t: ((S2.$('[data-w="apps"] .hqx-app') || {}).textContent || "").replace(/\s+/g, " "), apply: !!S2.$('[data-w="apps"] [data-flow="owner"]'), staff: !!S2.$('[data-w="apps"] [data-flow="staff"]') }));
  A("owner applications closed and none on file: says they closed, and when, with no Apply (S2.forms.ownerAppsOpen)",
    !r.open && /Owner applications are closed/.test(r.t) && /Owner applications for Season 2 closed .* \(Rule 2\.6\)\./.test(r.t) && !r.apply && r.staff, r);
  await p.context().close();
  p = await open("#/you?tab=applications", who, { ownerClosed: true });
  r = await p.evaluate(() => ({ t: ((S2.$('[data-w="apps"] .hqx-app') || {}).textContent || "").replace(/\s+/g, " "), edit: !!S2.$('[data-w="apps"] [data-flow="owner"]'), wd: !!S2.$('[data-act="app-withdraw"][data-app="owner"]') }));
  A("closed with one in review: no one edit offered, Withdraw stays, and it says why", !r.edit && r.wd && /so it can no longer be changed\./.test(r.t), r);
  await p.context().close();

  /* QA function 21 (2026-11-25): the Inbox's Mark all read changed only this page, so the alerts came back unread on a
     reload, while the bell persisted it; both are the bell's door now */
  console.log("## Inbox: Mark all read is kept by the league (S2.notifs.seen)");
  p = await open("#/you?tab=inbox", who, { notifs: 2 });
  r = await p.evaluate(() => ({ doc: document.title, bar: (S2.$("#inlineTitle") || {}).textContent }));
  A("a You tab names its section and the page through S2.setTitle: \"Inbox · You · CGHL\" (QA round 2 A1)", r.doc === "Inbox · You · CGHL" && r.bar === "Inbox · You", r);
  r = await text(p, '[data-w="inboxh"]');
  A("two unread alerts read from the league", /2 unread items/.test(r || ""), r);
  await click(p, '[data-act="read-all"]'); await wait(700);
  c = H.patch || [];
  A("Mark all read marks the member's unread alerts read through the league, once", c.length === 1 && /read=eq\.false/.test(c[0].q) && /profile_id=eq\./.test(c[0].q) && c[0].args.read === true, c);
  r = await text(p, '[data-w="inboxh"]');
  A("and the Inbox says all caught up, from the league's answer", /All caught up/.test(r || "") && H.T.notifications.every((n) => n.read), r);
  await p.context().close();

  console.log("## Sign out");
  p = await open("#/you?tab=settings", who);
  await click(p, '[data-ya="signout"]'); await wait(400);
  A("Sign out asks first, and nothing is sent until it is confirmed", !H.auth.some((x) => x.k === "out") && /Sign out\?/.test((await sheetText(p)) || ""));
  await click(p, '.sheet [data-x="out"]'); await wait(800);
  A("then signs out through the client", H.auth.some((x) => x.k === "out"), H.auth.map((x) => x.k));
  await p.context().close();

  console.log("## a guest: Join with Discord signs in for real");
  p = await open("#/you", "anon");
  /* QA visual 1 (2026-11-25): the hero told every visitor "0 members are already in the league Discord" */
  r = await p.evaluate(() => ({ lede: ((S2.$(".hqx-jhero .lede-l") || {}).textContent || "").replace(/\s+/g, " "), partial: !!S2.M.partial.control }));
  A("a visitor never reads s2_control, so the join page prints no Discord count and never a zero it did not read", r.partial && r.lede.length > 0 && !/league Discord/.test(r.lede) && !/(^|\D)0 (members|have)/.test(r.lede), r);
  r = await text(p, ".hqx-jhero .kicker");
  A("while Season 2 takes sign-ups the join page's kicker says so", r === "Season 2 · Sign-ups open", r);
  await click(p, '[data-act="join"]'); await wait(400);
  r = await sheetText(p);
  A("the join sheet never promises an automatic server join (auto-join is retired)", r && /Join the CGHL server/.test(r) && !/You are added/.test(r) && !/sample player/.test(r), r);
  await click(p, '.sheet [data-x="go"]'); await wait(1200);
  r = H.auth.filter((x) => x.k === "oauth").pop();
  A("Continue with Discord is the real sign-in, identify only", r && r.args.provider === "discord" && r.args.scopes === "identify", r);
  await p.context().close();

  /* QA round 2 (2026-11-25): the kicker said "Sign-ups open" in every week of the year */
  p = await open("#/you", "anon", { regClosed: true });
  r = await text(p, ".hqx-jhero .kicker");
  A("once Season 2's sign-ups close the join page's kicker is the season alone", r === "Season 2", r);
  await p.context().close();
  /* QA function 22, round 2 (2026-11-25): Settings printed a refused read's raw words ("column ... does not exist") as the
     whole sentence */
  p = await open("#/you?tab=settings", who, { pfFail: "column profiles.ea_player_id does not exist" });
  r = await text(p, '[data-w="lprof"]');
  A("a league profile the league could not read is said in plain words, the database's words kept, with Try again",
    /Your league profile could not be read/.test(r || "") && /The league did not answer as expected\. Try again in a moment.*The league said: column profiles\.ea_player_id does not exist\./.test(r || "") && !!(await p.$('[data-ya="pf-reload"]')), r);
  await p.context().close();

  console.log("## a phone");
  for (const tab of ["week", "settings", "applications"]) {
    p = await open("#/you?tab=" + tab, who, {}, 375);
    A("You, " + tab + ": no sideways scroll at 375", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.context().close();
  }

  A("no page errors", errs.length === 0, errs.slice(0, 4));
  await b.close();
  console.log(fails ? fails + " of " + n + " FAILED" : "all " + n + " passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
