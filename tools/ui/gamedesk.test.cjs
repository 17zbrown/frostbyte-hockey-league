const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* The Game desk is the classic Stats manager, on the Season 2 site (S2 swap, stream g2, 2026-11-24):
     node tools/ui/run.cjs --suite gamedesk --mode live
   Season 2's first game night is December 16. Every check here drives the page the way a statistics staffer would and
   reads what the page sent: the write door (S2.write), the staff reads and the two Netlify functions (ingest-stats and
   pickup-import, through the EA relay). i3d (2026-11-25): every page is the real site (the harness's live mode,
   tools/ui/mock with live: true): js/live.js's own client reads, and the harness answers it from this file's tables and
   RPCs; a write the table does not name is refused (MOCK1); the two functions are stubbed here and nothing leaves the
   browser context. The league on screen is the recorded Season 1 (Season 2 has no game played yet), with one fixture
   moved to next week so a game is still open; no member's name is written here.
   What is checked, for each action: the door and its exact arguments, that nothing shows as done before the league
   confirms it, that a refusal is shown in place with the staffer's input kept, and that the page repaints in place. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* the league on screen: the recorded Season 1, plus its last regular game copied a week ahead as an open fixture */
const UPID = "00000000-0000-4000-8000-00000000f1f1";
function league(a) {
  const b = mock.league(Object.assign({}, a, { p_season: 1 }));
  if (b.games && (!a.p_game_ids || a.p_game_ids.indexOf(UPID) >= 0)) {
    const g = b.games.filter((x) => x.stage === "regular").slice(-1)[0] || mock.league({ p_season: 1, p_sections: ["games"] }).games.slice(-1)[0];
    b.games.push(Object.assign({}, g, { id: UPID, status: "scheduled", scheduled_at: new Date(Date.now() + 7 * 86400000).toISOString(), home_score: null, away_score: null, went_ot: false,
      forfeit: null, forfeit_team_id: null, ea_match_id: null, home_shots: null, away_shots: null, voided: false }));
  }
  return b;
}
/* what the Staff Desk's own reads find (the desk loads them on every #/desk page): an office with nothing in it */
const DESK = {
  rpcs: { has_department: mock.ok(false), is_app_reviewer: mock.ok(false), staff_voter_count: mock.ok(11), can_vote_committee_app: mock.ok(false), season_survey_done: mock.ok(true),
    is_any_committee_manager: Object.assign(mock.fail("PGRST202", "Could not find the function public.is_any_committee_manager(p_profile) in the schema cache"), { status: 404 }),
    s2_desk: mock.ok({ staff: [], suspensions: [], activity: [] }) },
  tables: { action_requests: [], action_messages: [], owner_applications: [], staff_applications: [], management_applications: [], committee_applications: [], application_ballots: [],
    application_messages: [], suspension_record: [], committees: [], suspension_requests: Object.assign(mock.fail("PGRST205", "Could not find the table 'public.suspension_requests' in the schema cache"), { status: 404 }) }
};

(async () => {
  const b = await chromium.launch();
  const errors = [], unexpected = [];
  let H = null;   /* the current page's doubles (tables and call logs) */
  async function page(hash, o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    H = { ctx: ctx, reads: [], posts: [], ans: o.ans || {}, get writes() { return mock.calls(ctx).map((c) => ({ rpc: c.rpc, args: c.args })); } };
    const Hh = H;
    /* the page's reads, answered from this check's own table (a function of the filters, as the old in-page client was) */
    const asTable = (name, fn) => (q) => {
      const f = {}; q.filters.forEach((x) => { f[x[0]] = String(x[1]).replace(/^eq\./, ""); });
      Hh.reads.push({ kind: "from", name: name, f: f, filters: q.filters });
      const r = fn({ f: f, sel: q.select });
      if (r.error) return mock.fail(r.error.code || "P0001", r.error.message);
      const d = r.data;
      return (Array.isArray(d) ? d : d ? [d] : []).map((x) => (f.id && !("id" in x) ? Object.assign({ id: f.id }, x) : x));
    };
    const asRpc = (name, fn) => (args) => { Hh.reads.push({ kind: "rpc", name: name, args: args }); const r = fn(args || {}); return r.error ? mock.fail(r.error.code || "P0001", r.error.message) : mock.ok(r.data); };
    const tables = Object.assign({}, DESK.tables), rpcs = Object.assign({ s2_league: (a) => mock.ok(league(a)) }, DESK.rpcs), writes = {};
    Object.keys(H.ans.read || {}).forEach((k) => { const kind = k.split(":")[0], name = k.slice(kind.length + 1); if (kind === "from") tables[name] = asTable(name, H.ans.read[k]); else rpcs[name] = asRpc(name, H.ans.read[k]); });
    Object.keys(H.ans.write || {}).forEach((k) => { writes[k] = (args) => H.ans.write[k](args); });
    await mock.install(ctx, { live: true, persona: o.commish ? "commissioner" : "staff", writes: writes, tables: tables, rpcs: rpcs });
    await ctx.route("**/api/ingest-stats", async (r) => { const body = JSON.parse(r.request().postData() || "{}"); Hh.posts.push({ fn: "ingest-stats", body, auth: r.request().headers().authorization });
      const out = await (Hh.ans.ingest || (() => ({ error: "no answer in this check" })))(body); r.fulfill({ status: out.status || 200, contentType: "application/json", body: JSON.stringify(out.json || out) }); });
    await ctx.route("**/api/pickup-import", async (r) => { const body = JSON.parse(r.request().postData() || "{}"); Hh.posts.push({ fn: "pickup-import", body });
      const out = await (Hh.ans.pickup || (() => ({ error: "no answer in this check" })))(body); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) }); });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    /* the browser logs every non-2xx answer as "Failed to load resource"; what the page itself says is what counts */
    p.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(S2_BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.LIVE && S2.M && document.querySelector("#app section, #app header"));
    await wait(400);
    return p;
  }
  const done = (p) => { unexpected.push.apply(unexpected, mock.unexpected(p.context())); return p.context().close(); };
  const soon = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await wait(50); } return fn(); };
  const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 5000 }).then(() => true, () => false);
  const txt = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
  const sheetOk = async (p) => { await p.waitForSelector(".sheet [data-cf=\"ok\"]"); await p.click(".sheet [data-cf=\"ok\"]"); };

  /* the fixtures, from the league on screen at run time: a final with a box score and no forfeit, and a forfeit */
  let p = await page("#/today");
  const F = await p.evaluate(() => {
    const fin = S2.M.games.filter((g) => g.isFinal && g.hasBox && !g.forfeit && !g.voided && !g.ot);
    const g = fin[fin.length - 1], ff = S2.M.games.filter((x) => x.forfeit && x.isFinal).slice(-1)[0];
    return { id: g.id, home: g.home, away: g.away, hs: g.hs, as: g.as, at: g.at, ff: ff ? { id: ff.id, home: ff.home, away: ff.away, club: ff.forfeit, kept: !!ff.kept } : null,
      old: Date.now() - Date.parse(g.at) >= 9 * 86400000 };
  });
  await done(p);
  /* the clubs' own rows (js/live.js reads them too), each given a made-up EA club id */
  const ROWS = mock.league({ p_season: 1, p_sections: ["teams"] }).teams;
  const EA = {}, TID = {}; ROWS.forEach((t, i) => { EA[t.code] = String(9100 + i); TID[t.code] = t.id; });
  const teamsRead = () => ({ data: ROWS.map((t) => Object.assign({}, t, { ea_club_id: EA[t.code] || null })) });
  const fx = (o) => Object.assign({ gameId: F.id, home: F.home, away: F.away, at: F.at, status: "final", held: false, forfeit: null, inWindow: true }, o || {});
  const sit = (o) => Object.assign({ source: "archive", onGame: false, struck: false, canMerge: true, canPickup: false, alternatives: [], ambiguous: false, kind: "league", fixture: fx(),
    clubs: [{ eaId: EA[F.away], team: F.away, score: F.as, via: "linked" }, { eaId: EA[F.home], team: F.home, score: F.hs, via: "linked" }] }, o);
  const end = (min) => new Date(Date.parse(F.at) + min * 60000).toISOString();
  const rows = () => [
    { id: "r1", game_id: F.id, team_id: TID[F.home], profile_id: null, skater_name: "Line One", position: "C", is_goalie: false, goals: F.hs, assists: 0, plus_minus: 1, shots: 5, hits: 1, saves: 0, shots_against: 0, goals_against: 0, time_on_ice_seconds: 3600 },
    { id: "r2", game_id: F.id, team_id: TID[F.home], profile_id: null, skater_name: "Line Two", position: "G", is_goalie: true, goals: 0, assists: 0, plus_minus: 0, shots: 0, hits: 0, saves: 20, shots_against: 20 + F.as, goals_against: F.as, time_on_ice_seconds: 3600 },
    { id: "r3", game_id: F.id, team_id: TID[F.away], profile_id: null, skater_name: "Line Three", position: "LW", is_goalie: false, goals: F.as, assists: 1, plus_minus: -1, shots: 4, hits: 2, saves: 0, shots_against: 0, goals_against: 0, time_on_ice_seconds: 3600 }];
  const baseRead = (extra) => Object.assign({ "from:teams": teamsRead, "from:game_stats": () => ({ data: rows() }), "rpc:ea_lookup_health": () => ({ data: { state: "working", at: new Date().toISOString(), latencyMs: 1200 } }) }, extra || {});
  const S1 = sit({ matchId: "s1", onGame: true, minutes: 40, length: "short", endedAt: end(45) }), S2s = sit({ matchId: "s2", minutes: 20, length: "short", endedAt: end(70) });
  let r;

  console.log("## sittings: the staff read, the classic two phases, and a merge previewed, confirmed, then sent once");
  let merges = 0;
  p = await page("#/desk/game/" + F.id, { ans: { read: baseRead(), write: {},
    ingest: (body) => {
      if (body.leagueSessions) return { sessions: [JSON.parse(JSON.stringify(S1)), JSON.parse(JSON.stringify(S2s))], archiveFrom: "2026-10-01", ea: body.leagueSessions.ea ? { ok: true } : { ok: false, skipped: true } };
      if (body.leagueMerge && body.leagueMerge.preview) return { ok: true, score: (F.hs + 1) + "-" + F.as, posts: "corrected", current: { score: F.hs + "-" + F.as }, wentOt: false, sittings: 2 };
      if (body.leagueMerge) { merges++; return { ok: true, score: (F.hs + 1) + "-" + F.as, sittings: 2, players: 12, linked: 12, wentOt: false }; }
      return { error: "unexpected" };
    } } });
  A("the fixture's sittings are read for the home club's EA club, the archive first", await until(p, () => document.querySelectorAll('#dkSit input[name="gdSit"]').length === 2));
  const ls = H.posts.filter((x) => x.body && x.body.leagueSessions);
  A("phase one is the archive (ea false) for that club, with the staffer's token", ls[0] && ls[0].body.leagueSessions.clubId === EA[F.home] && ls[0].body.leagueSessions.ea === false && ls[0].auth === "Bearer " + mock.sessionOf("staff").accessToken, ls[0]);
  A(F.old ? "an older game is read from its own archive page (before), with no EA phase" : "a recent game then asks EA through the bot server",
    F.old ? !!ls[0].body.leagueSessions.before && !ls.some((x) => x.body.leagueSessions.ea) : await until(p, () => /EA checked just now/.test(document.getElementById("dkSit").textContent)), ls.map((x) => x.body));
  r = await p.evaluate(() => [...document.querySelectorAll('#dkSit input[name="gdSit"]')].map((x) => ({ v: x.value, on: x.checked, off: x.disabled })));
  A("the sitting on the game is ticked and locked; the other can be ticked", r[0].on && r[0].off && !r[1].on && !r[1].off, r);
  A("no action bar until something is ticked", !(await p.$("#gdBarBox")));
  await p.click('#dkSit input[value="s2"]'); await wait(150);
  A("ticking it brings the bar, worded for exactly that: merge two sittings into this game", /Merge 2 sittings into /.test(await txt(p, "#gdBarBox")) && /1 already on the game, 1 you ticked/.test(await txt(p, "#gdBarBox")), await txt(p, "#gdBarBox"));
  A("the tick survived the repaint (the box is still ticked, in place)", await p.evaluate(() => document.querySelector('#dkSit input[value="s2"]').checked));
  await p.click('#gdBarBox [data-gd="go"]');
  await p.waitForSelector(".sheet");
  const pv = H.posts.filter((x) => x.body && x.body.leagueMerge);
  A("the preview went first, nothing else", pv.length === 1 && pv[0].body.leagueMerge.preview === true && JSON.stringify(pv[0].body.leagueMerge.matchIds) === '["s1","s2"]' && pv[0].body.leagueMerge.restart === false && pv[0].body.leagueMerge.gameId === F.id, pv.map((x) => x.body));
  r = await txt(p, ".sheet");
  A("the confirm says what it will file and what posts", /files as final/.test(r) && /a Corrected line posts in #game-scores/.test(r) && /Merge 2 sittings into/.test(r), r);
  A("nothing is shown as merged before the confirm", !(await p.$("#gdSitRes")));
  await sheetOk(p);
  A("the merge is sent once, without the preview flag", await until(p, () => !!document.getElementById("gdSitRes")) && merges === 1 && !H.posts.filter((x) => x.body && x.body.leagueMerge)[1].body.leagueMerge.preview);
  A("then it says Merged, with the score the server gave", /Merged\./.test(await txt(p, "#gdSitRes")) && /2 sittings, 12 player lines, 12 matched to profiles/.test(await txt(p, "#gdSitRes")), await txt(p, "#gdSitRes"));
  A("and the sittings are read again", await soon(() => H.posts.filter((x) => x.body && x.body.leagueSessions).length > ls.length));
  A("the page was never reset: the scoreboard is the same element family, the hash unchanged", await p.evaluate((id) => location.hash === "#/desk/game/" + id && !!document.getElementById("dkSB"), F.id));
  await done(p);

  console.log("## a refused preview stays beside the button, and nothing is merged");
  p = await page("#/desk/game/" + F.id, { ans: { read: baseRead(), write: {},
    ingest: (body) => body.leagueSessions ? { sessions: [JSON.parse(JSON.stringify(S1)), JSON.parse(JSON.stringify(S2s))], ea: { ok: true } } : body.leagueMerge && body.leagueMerge.preview ? { status: 409, json: { error: "Level 2-2 after 60 of 60 minutes: a game can't end level (Rule 4.1)." } } : { error: "should not be sent" } } });
  await until(p, () => document.querySelectorAll('#dkSit input[name="gdSit"]').length === 2);
  await p.click('#dkSit input[value="s2"]'); await wait(120);
  await p.click('#gdBarBox [data-gd="go"]');
  A("the server's words show in place", await until(p, () => /can't end level/.test((document.getElementById("gdSitErr") || {}).textContent || "")), await txt(p, "#dkSit"));
  A("no sheet opened and no merge was sent", !(await p.$(".sheet")) && H.posts.filter((x) => x.body && x.body.leagueMerge && !x.body.leagueMerge.preview).length === 0);
  A("the tick is kept", await p.evaluate(() => document.querySelector('#dkSit input[value="s2"]').checked));
  await done(p);

  console.log("## an outside EA club (Rule 4.6): searched through the bot server's relay, matched to this game, recorded");
  let polls = 0;
  const OUT = sit({ matchId: "o1", kind: "needs-substitution", canMerge: false, minutes: 60, length: "full", endedAt: end(65), source: "ea",
    clubs: [{ eaId: EA[F.home], team: F.home, score: F.hs, via: "linked" }, { eaId: "555", team: null, name: "Outside Club A", score: F.as }],
    subCandidates: [{ gameId: F.id, home: F.home, away: F.away, at: F.at, inWindow: true }] });
  p = await page("#/desk/game/" + F.id, { ans: {
    read: baseRead({ "rpc:ea_lookup_state": () => { polls++; return { data: { pending: polls < 2 } }; } }),
    write: { set_game_club_substitution: (a) => ({ data: { game_id: a.p_game, ea_club_id: a.p_ea_club_id, team_id: a.p_team } }) },
    pickup: (body) => body.eaLookup ? { clubs: [{ clubId: "555", name: "Outside Club A", memberCount: 8 }] } : { eaPending: 77 },
    ingest: (body) => body.leagueSessions ? (body.leagueSessions.clubId === "555" ? { sessions: [JSON.parse(JSON.stringify(OUT))], ea: { ok: true } } : { sessions: [], ea: { ok: true } }) : { error: "x" } } });
  await until(p, () => /No sittings for this game/.test(document.getElementById("dkSit").textContent));
  A("with no sitting on the fixture, the desk says so and points at the search", /search that club below \(Rule 4\.6\)/.test(await txt(p, "#dkSit")), await txt(p, "#dkSit"));
  await p.click('#dkSit [data-gd="switch"]');
  A("Look under the other club reads the other club's EA record instead", await soon(() => H.posts.some((x) => x.body && x.body.leagueSessions && x.body.leagueSessions.clubId === EA[F.away])) &&
    await until(p, () => /No sittings for this game/.test(document.getElementById("dkSit").textContent)));
  await p.fill("#dkEaQ", "Outside Club A"); await p.press("#dkEaQ", "Enter");
  A("the search waits on the bot server (eaPending), then asks again with the lookup's id", await until(p, () => !!document.querySelector('#dkEaOut [data-gd="ea-club"]'), null, 8000) &&
    H.posts.filter((x) => x.fn === "pickup-import").length === 2 && H.posts.filter((x) => x.fn === "pickup-import")[1].body.eaLookup === 77 && H.posts[H.posts.length - 1].body.action === "search", H.posts.filter((x) => x.fn === "pickup-import").map((x) => x.body));
  A("and the status line was painted from the bot server's self-test", /EA search is working/.test(await txt(p, "#dkEa [data-ea-status]")), await txt(p, "#dkEa [data-ea-status]"));
  await p.click('#dkEaOut [data-gd="ea-club"]');
  A("using the club reads its sittings, and the outside sitting appears near this game with a way to match it", await until(p, () => !!document.querySelector('#dkSit [data-gd="m-open"]')) &&
    H.posts.some((x) => x.body && x.body.leagueSessions && x.body.leagueSessions.clubId === "555"));
  await p.click('#dkSit [data-gd="m-open"]'); await wait(150);
  A("the match panel opens on this game, already picked", await p.evaluate((id) => (document.querySelector('#gdMatch input[name="gdMatchGame"]:checked') || {}).value === id, F.id));
  await p.click('#gdMatch [data-gd="m-go"]'); await wait(150);
  A("Record with nothing chosen says what is missing, in place, and writes nothing", /Pick the club that played as Outside Club A/.test(await txt(p, "#gdMatch")) && !H.writes.length, await txt(p, "#gdMatch"));
  await p.click('#gdMatch [data-gd="m-side"][data-club="' + F.away + '"]'); await wait(120);
  await p.fill("#gdMatchWhy", "Their club would not load");
  await p.click('#gdMatch [data-gd="m-go"]');
  await p.waitForSelector(".sheet"); r = await txt(p, ".sheet");
  A("the confirm names the club, the game and Rule 4.6, and says nothing is filed by this step", /played .* as Outside Club A/.test(r) && /Rule 4\.6/.test(r) && /Nothing is filed by this step/.test(r), r);
  await sheetOk(p);
  A("set_game_club_substitution gets the classic arguments: this game, the EA club, the club's id, the reason", await until(p, () => !!document.getElementById("gdSitRes")) &&
    JSON.stringify(H.writes[0]) === JSON.stringify({ rpc: "set_game_club_substitution", args: { p_game: F.id, p_ea_club_id: "555", p_team: TID[F.away], p_reason: "Their club would not load" } }), H.writes);
  A("Recorded shows only after the league's answer, and the sittings are read again", /Recorded\./.test(await txt(p, "#gdSitRes")) && H.posts.filter((x) => x.body && x.body.leagueSessions).length >= 4);
  await done(p);

  console.log("## a substitution recorded before puck drop can be removed while the game is open (clear_game_club_substitution)");
  p = await page("#/today");
  const U = await p.evaluate(() => { const g = S2.M.games.filter((x) => x.state === "upcoming")[0]; return g ? { id: g.id, home: g.home, away: g.away, at: g.at } : null; });
  A("(the league on screen holds an open fixture)", !!U && U.id === UPID, U);
  await done(p);
  if (U) {
    const SUB = { matchId: "u1", kind: "league", source: "archive", onGame: false, struck: false, canMerge: true, alternatives: [], ambiguous: false, minutes: 60, length: "full", endedAt: U.at,
      fixture: { gameId: U.id, home: U.home, away: U.away, at: U.at, status: "scheduled", held: false, forfeit: null, inWindow: true },
      clubs: [{ eaId: EA[U.home], team: U.home, score: 2, via: "linked" }, { eaId: "555", team: U.away, name: "Outside Club A", score: 1, via: "substitution", subGame: U.id }] };
    let subOn = true;
    p = await page("#/desk/game/" + U.id, { ans: { read: baseRead(), write: { clear_game_club_substitution: () => { subOn = false; return { data: null }; } },
      /* after the removal the same sitting comes back with its outside club unresolved (the server reads no substitution) */
      ingest: (body) => body.leagueSessions ? { sessions: [subOn ? JSON.parse(JSON.stringify(SUB)) : Object.assign(JSON.parse(JSON.stringify(SUB)), { kind: "needs-substitution", canMerge: false,
        clubs: [SUB.clubs[0], { eaId: "555", team: null, name: "Outside Club A", score: 1 }] })], ea: { ok: true } } : { error: "x" } } });
    A("the substitution on record is named on its game, with Remove while the game is open", await until(p, () => !!document.querySelector('#dkSit [data-gd="unsub"]')) && /Outside Club A counts as .* in this game only \(Rule 4\.6\)/.test(await txt(p, "#dkSit")), await txt(p, "#dkSit"));
    await p.click('#dkSit [data-gd="unsub"]'); await sheetOk(p);
    A("clear_game_club_substitution gets the game and the EA club (not a reason: the trap in memory)", await until(p, () => /Removed\./.test((document.getElementById("gdSitRes") || {}).textContent || "")) &&
      JSON.stringify(H.writes[0]) === JSON.stringify({ rpc: "clear_game_club_substitution", args: { p_game: U.id, p_ea_club_id: "555" } }), H.writes);
    A("and the sittings are read again, now without it", await until(p, () => !document.querySelector('#dkSit [data-gd="unsub"]')));
    await done(p);
  }

  console.log("## the Games pane: what waits on the desk, from the league's own games");
  p = await page("#/desk?tab=games&view=ruling", { ans: { read: baseRead() } });
  r = await p.evaluate(() => ({ n: S2._gamedesk.waiting().length, rows: document.querySelectorAll('#dkGList a[href^="#/desk/game/"]').length, chip: ((document.querySelector('[data-gview="ruling"] .dk-chipn') || {}).textContent || "").trim(),
    final: S2._gamedesk.waiting().some((g) => g.status === "final" || g.forfeit || g.voided) }));
  A("Needs a ruling lists every game waiting (held, or no result two hours after puck drop), each opening its Game desk, and never a final", r.rows === r.n && (r.n === 0 || r.chip === String(r.n)) && !r.final, r);
  await done(p);

  console.log("## correcting a result: stats_game_set_result, then the games row read back");
  let back = null;
  /* steps that give a score the guards accept or refuse whatever the fixture's own score is */
  let up = 1; while (Math.abs(F.hs + up - F.as) < 2) up++;
  const aUp = F.as + 1 === F.hs ? 2 : 1;
  const corr = (readBack) => page("#/desk/game/" + F.id, { ans: { write: { stats_game_set_result: () => ({ data: null }) },
    read: baseRead({ "from:games": (a) => ({ data: readBack(a) }) }), ingest: () => ({ sessions: [], ea: { ok: true } }) } });
  p = await corr(() => back);
  await p.click('#dkRes [data-act="res-edit"]'); await wait(120);
  await p.click('#dkRes [data-act="ot"]'); for (let i = 0; i < up; i++) await p.click('#dkRes [data-act="step"][data-side="hs"][data-d="1"]'); await wait(80);
  await p.click('#dkRes [data-act="res-save"]'); await wait(150);
  A("an overtime game won by two is refused in place, before anything is sent", /decided by one goal/.test(await txt(p, "#gdFixErr")) && !H.writes.length && !(await p.$(".sheet")), await txt(p, "#dkRes"));
  await p.click('#dkRes [data-act="ot"]'); await wait(60);
  back = { status: "final", home_score: F.hs + up, away_score: F.as, went_ot: false };
  await p.click('#dkRes [data-act="res-save"]');
  await p.waitForSelector(".sheet"); r = await txt(p, ".sheet");
  A("the confirm shows now and after, and that a Corrected line posts", /Now: /.test(r) && /After: /.test(r) && /A Corrected line posts in #game-scores/.test(r), r);
  await sheetOk(p);
  A("the door gets the classic arguments", await until(p, () => !!document.getElementById("gdFixRes")) &&
    JSON.stringify(H.writes[0].args) === JSON.stringify({ p_game: F.id, p_home: F.hs + up, p_away: F.as, p_final: true, p_ot: false }), H.writes);
  A("the row is read back (games, by id)", H.reads.some((x) => x.kind === "from" && x.name === "games" && x.f.id === F.id));
  A("Corrected shows only because the row read back says so", /Corrected\./.test(await txt(p, "#gdFixRes")), await txt(p, "#gdFixRes"));
  await done(p);
  p = await corr(() => ({ status: "final", home_score: F.hs, away_score: F.as, went_ot: false }));
  await p.click('#dkRes [data-act="res-edit"]'); await wait(100);
  for (let i = 0; i < aUp; i++) await p.click('#dkRes [data-act="step"][data-side="as"][data-d="1"]'); await wait(60);
  await p.click('#dkRes [data-act="res-save"]'); await sheetOk(p);
  A("a row that still reads the old score is a failure, said plainly, and the editor stays open", await until(p, () => /did not save/.test((document.getElementById("gdFixRes") || {}).textContent || "")) && !!(await p.$("#dkRes .dk-reseditor")), await txt(p, "#dkRes"));
  await done(p);

  console.log("## a forfeit: the classic two kinds, the club's id, the ruling's own answer");
  let ffAns = null;
  p = await page("#/desk/game/" + F.id, { ans: { write: { forfeit_game: () => ffAns }, read: baseRead(), ingest: () => ({ sessions: [], ea: { ok: true } }) } });
  await p.click('#dkRul [data-gd="ff-open"]'); await wait(120);
  r = await p.evaluate(() => [...document.querySelectorAll('#dkRul input[name="gdFfKind"]')].map((x) => ({ v: x.value, on: x.checked, off: x.disabled })));
  A("a played game (it has a box score) cannot be a no-show; the kept-result kind is chosen", JSON.stringify(r) === JSON.stringify([{ v: "noshow", on: false, off: true }, { v: "dc3", on: true, off: false }]), r);
  await p.click('#dkRul [data-gd="ff-go"]'); await wait(100);
  A("ruling with no club says so in place, and writes nothing", /Pick the club/.test(await txt(p, "#gdFfState")) && !H.writes.length);
  await p.click('#dkRul [data-gd="ff-who"][data-club="' + F.home + '"]'); await wait(80);
  await p.fill("#gdFfWhy", "Third disconnection in the third period");
  await p.click('#dkRul [data-gd="ff-go"]'); await p.waitForSelector(".sheet");
  r = await txt(p, ".sheet");
  A("the confirm says what it records and what posts, and that only a commissioner can undo it", /stands with every stat line/.test(r) && /takes the forfeit loss/.test(r) && /Only a commissioner can undo a forfeit/.test(r), r);
  ffAns = { error: { code: "42501", message: "Only statistics staff can rule a forfeit." } };
  await sheetOk(p);
  A("a refusal shows the league's words in place, and the form keeps the club and the note", await until(p, () => /Only statistics staff/.test((document.getElementById("gdFfState") || {}).textContent || "")) &&
    await p.evaluate((c) => document.querySelector('#dkRul [data-gd="ff-who"][data-club="' + c + '"]').getAttribute("aria-pressed") === "true" && document.getElementById("gdFfWhy").value === "Third disconnection in the third period", F.home), await txt(p, "#dkRul"));
  A("and nothing shows a forfeit on the scoreboard", !/Forfeit/.test(await txt(p, "#dkSB")));
  ffAns = { data: { ok: true, kept_result: true, score: F.hs + "-" + F.as, winner: TID[F.away] } };
  await p.click('#dkRul [data-gd="ff-go"]'); await sheetOk(p);
  A("forfeit_game gets the classic arguments: the game, the club's id, the note, kept result", await until(p, () => !!document.getElementById("gdFfRes")) &&
    JSON.stringify(H.writes[H.writes.length - 1].args) === JSON.stringify({ p_game: F.id, p_forfeiting_team: TID[F.home], p_reason: "Third disconnection in the third period", p_keep_result: true }), H.writes);
  A("Forfeit ruled, from the ruling's own answer", /Forfeit ruled\./.test(await txt(p, "#gdFfRes")) && /takes the forfeit loss/.test(await txt(p, "#gdFfRes")), await txt(p, "#gdFfRes"));
  await done(p);

  if (F.ff) {
    console.log("## a forfeit on record: staff report it to the commissioners; a commissioner undoes it");
    p = await page("#/desk/game/" + F.ff.id, { ans: { write: { report_ruling_mistake: () => ({ data: { ok: true } }) }, read: baseRead(), ingest: () => ({ sessions: [], ea: { ok: true } }) } });
    A("a staffer sees no Undo and no Correct the result, only Report a mistake", !(await p.$('#dkRul [data-gd="ff-undo"]')) && !(await p.$('#dkRes [data-act="res-edit"]')) && !!(await p.$('#dkRul [data-gd="report"]')));
    await p.click('#dkRul [data-gd="report"]'); await p.waitForSelector("#gdRrNote");
    await p.fill("#gdRrNote", "wrong"); await p.click('.sheet [data-cf="ok"]'); await wait(100);
    A("a note too short to act on is refused in the sheet, which stays open", /Say what is wrong/.test(await txt(p, "#gdRrErr")) && !!(await p.$(".sheet")) && !H.writes.length);
    await p.fill("#gdRrNote", "The away club showed; the home club did not."); await p.click('.sheet [data-cf="ok"]');
    A("report_ruling_mistake gets the game and the note, and the sheet closes on the league's answer", await until(p, () => !document.querySelector(".sheet")) &&
      JSON.stringify(H.writes[0]) === JSON.stringify({ rpc: "report_ruling_mistake", args: { p_game: F.ff.id, p_note: "The away club showed; the home club did not." } }), H.writes);
    await done(p);
    p = await page("#/desk/game/" + F.ff.id, { commish: true, ans: { write: { unforfeit_game: () => ({ data: { ok: true } }) }, read: baseRead(), ingest: () => ({ sessions: [], ea: { ok: true } }) } });
    await p.click('#dkRul [data-gd="ff-undo"]'); r = await txt(p, ".sheet");
    A("the commissioner's undo says a Reversed line posts", /Reversed line posts/.test(r), r);
    await sheetOk(p);
    A("unforfeit_game gets the game, and Forfeit undone shows on its answer", await until(p, () => /Forfeit undone/.test((document.getElementById("gdFfRes") || {}).textContent || "")) && JSON.stringify(H.writes[0]) === JSON.stringify({ rpc: "unforfeit_game", args: { p_game: F.ff.id } }), H.writes);
    await done(p);
  }

  console.log("## a box-score line (a goal voided on the commissioner's order): stats_game_row, confirmed by the row it returns");
  let rowOk = true;
  p = await page("#/desk/game/" + F.id, { ans: { read: baseRead(), ingest: () => ({ sessions: [], ea: { ok: true } }),
    write: { stats_game_row: (a) => { if (!rowOk) return { error: { code: "42501", message: "Only statistics staff can manage games." } }; const x = rows().find((y) => y.id === a.p_row_id); return { data: Object.assign({}, x, a.p) }; } } } });
  const X = F.hs >= 1 ? { club: F.home, row: "r1" } : { club: F.away, row: "r3" };   /* the club that scored: its skater line has a goal to void */
  await p.click('#dkBox [data-act="club"][data-club="' + X.club + '"]').catch(() => {});
  A("the lines are the league's rows (each editable cell carries a row)", await until(p, () => document.querySelectorAll("#dkBox .dk-ed").length > 0));
  const cell = await p.evaluate(() => { const td = [...document.querySelectorAll("#dkBox .dk-ed")].filter((x) => /\|g$/.test(x.dataset.cell))[0]; return { key: td.dataset.cell, v: td.textContent }; });
  await p.click('[data-cell="' + cell.key + '"]'); await p.keyboard.type(String(+cell.v - 1)); await p.keyboard.press("Enter");
  A("stats_game_row gets the row, the game and only the changed column", await until(p, () => /changes? this session/.test((document.getElementById("dkBoxMsg") || {}).textContent || "")) &&
    JSON.stringify(H.writes[0]) === JSON.stringify({ rpc: "stats_game_row", args: { p_row_id: X.row, p_game: F.id, p: { goals: +cell.v - 1 } } }), H.writes);
  A("the cell shows the league's new number", (await txt(p, '[data-cell="' + cell.key + '"]')) === String(+cell.v - 1));
  A("the box now disagrees with the result and says so", /total/.test(await txt(p, "#dkBox .dk-warnbar")), await txt(p, "#dkBox"));
  await p.click('#dkBox [data-act="undo"]');
  A("Undo writes the old number back the same way", await until(p, () => /Select a number|0 changes|One change/.test(document.getElementById("dkBoxMsg").textContent) && !document.querySelector("#dkBox .dk-warnbar")) &&
    JSON.stringify(H.writes[1].args.p) === JSON.stringify({ goals: +cell.v }), H.writes.map((w) => w.args));
  rowOk = false;
  await p.click('[data-cell="' + cell.key + '"]'); await p.keyboard.type("0"); await p.keyboard.press("Enter");
  A("a refused change keeps the league's number and says why", await until(p, () => /Not saved/.test(document.getElementById("dkBoxMsg").textContent)) && (await txt(p, '[data-cell="' + cell.key + '"]')) === cell.v, await txt(p, "#dkBoxMsg"));
  await done(p);

  console.log("## the import exceptions: read from ea_import_issues, cleared through ea_dismiss_import, confirmed by reading again");
  let issues = [{ match_id: "777", reason: "No league fixture matched", clubs: [EA[F.home], "555"], day: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(F.at)), at: F.at }];
  p = await page("#/desk?tab=games&view=imports", { ans: { read: baseRead({ "rpc:ea_import_issues": () => ({ data: { unmatched: issues, missing_stats: [] } }) }), write: { ea_dismiss_import: () => { issues = []; return { data: null }; } } } });
  A("the exception is listed by club, with a way to its fixture and to clear it", await until(p, () => !!document.querySelector('#dkImp [data-act="clear-imp"]')) && new RegExp(F.home + " against an outside club").test(await txt(p, "#dkImp")) &&
    !!(await p.$('#dkImp a[href^="#/desk/game/"]')), await txt(p, "#dkGWrap"));
  await p.click('#dkImp [data-act="clear-imp"]');
  A("ea_dismiss_import gets the match id, and the list is read again before it says so", await until(p, () => /Every import is checked/.test(document.getElementById("dkGWrap").textContent)) &&
    JSON.stringify(H.writes[0]) === JSON.stringify({ rpc: "ea_dismiss_import", args: { p_match_id: "777" } }) && H.reads.filter((x) => x.name === "ea_import_issues").length === 2, H.writes);
  await done(p);

  /* i3d: the old check opened the page with no read client (the demo and fixture page); the site always has one, so the
     failure a staffer can meet is a read the league refuses, and the desk says it the same way */
  console.log("## a read the league refuses: the desk says so; it never shows an empty desk as a fact");
  p = await page("#/desk/game/" + F.id, { ans: { read: baseRead({ "from:teams": () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }) }), ingest: () => ({ sessions: [], ea: { ok: true } }) } });
  r = await txt(p, "#dkSit");
  A("the sittings say they could not be read, and why (the league's words)", /Couldn’t read the clubs’ EA records: canceling statement due to statement timeout/.test(r), r);
  A("no write is offered as done, and the page drew everything else", !!(await p.$("#dkSB")) && !!(await p.$("#dkRes")) && !!(await p.$("#dkRul")));
  await done(p);

  console.log("## the Games pane and a pickup sitting link the pickup tools (g5's hand-over)");
  p = await page("#/desk?tab=games&view=ruling", { ans: { read: baseRead() } });
  A("the Games pane links #/pickups", await p.evaluate(() => !!document.querySelector('#dkMain a[href="#/pickups"]')));
  await done(p);
  p = await page("#/desk/game/" + F.id, { ans: { read: baseRead(), write: {}, ingest: (body) => body.leagueSessions ? { sessions: [sit({ matchId: "pk1", kind: "not-league", canMerge: false, canPickup: false, pickupGameId: "00000000-0000-4000-8000-0000000000a1", minutes: 60, length: "full", endedAt: end(65), source: "archive",
    clubs: [{ eaId: EA[F.home], team: F.home, score: 2, via: "linked" }, { eaId: "777", team: null, name: "Outside Club B", score: 1 }] })], ea: { ok: true } } : { error: "x" } } });
  A("a sitting imported as a pickup game says so and links to that game", await until(p, () => !!document.querySelector('#dkSit a[href="#/pickups/00000000-0000-4000-8000-0000000000a1"]'), null, 8000) && /Imported as a pickup game/.test(await txt(p, "#dkSit")), await txt(p, "#dkSit"));
  await done(p);

  /* QA round 2 (A10): the Game desk reads through S2.rd (js/live.js), the one read door, and keeps no copy of it */
  const gdSrc = require("fs").readFileSync(require("path").join(S2_ROOT, "js/pages/gamedesk.js"), "utf8");
  A("qa2: gamedesk.js reads through S2.rd and keeps no read door of its own", /function rd\(q\) \{ return S2\.rd\(q\); \}/.test(gdSrc) && !/r\.error\.message \|\| "The league did not answer\."/.test(gdSrc) && !/S2\.ensureSb/.test(gdSrc));

  A("no page error, no console error and no request past the harness's answers in any check", errors.length === 0 && unexpected.length === 0, { errors: errors.slice(0, 5), unexpected: unexpected.slice(0, 5) });
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
