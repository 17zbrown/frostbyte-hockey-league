const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The series limit on Team HQ's lineup sheet, on the real site (h0's live mode; every context opts in, so any mode runs it):
     node tools/ui/run.cjs --suite serieslimit --mode live
   Commissioner, 2026-11-06: "only base scheduling off box scores", "remove them from the lineup and send the team management
   a notification on the site"; 2026-11-24: "A player can play up to 4 games in a series, but can only play 2 of the first 4
   games in each series. Goalies included." SHIPPED v4.61 (Rule S2.7 para 2): the database counts both limits from the box
   scores (public.series_cap, series_early_games), set_game_lineup refuses a sheet past either in its own words, and
   _series_limit_sweep takes a player off the later sheets and tells the front office through the bell. The page cannot ask
   a player's count (neither function is granted to the API roles), so it says both limits and shows the refusal.
   Proves: the playoff game is one of the week's sheets with no sample series panel; the sheet says both limits, goaltenders
   included, from the box scores (Rule S2.7); a sheet past a limit is refused in the database's words with the six kept and
   nothing read as filed; no sideways scroll at 375; no page errors.
   The league is the recorded Season 1 turned back to the eve of week 5 (?season=1), with the gm persona's first game of
   that night made a playoff game. Nothing reaches Supabase, Netlify or Discord.
   Deleted with demo mode (i3c, 2026-11-25), each of which pinned only the demo's sample series (js/pages/hq.js
   seriesOf, playoffGame and the "po-box" button, now gone): the series head and its Game 3 to 7 rows, the count panel and
   its two-of-the-first-four marks, the capped bench chip and its refused tap, Fill skipping a capped player, a staff-only
   sample "EA import" moving the count and emptying later sheets, Seattle's full series to Game 7, the management notice
   in the demo inbox (the real notice is the database's, through the bell), the regular sheet's weekly count (Season 2 has
   no weekly limit, Rule S2.7) and the count rows at 375. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
let fails = 0, n = 0;
const A = (name, cond, more) => { n++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + JSON.stringify(more).slice(0, 600) + ")")); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Season 1 from the recording, turned back to the afternoon of Wed, Oct 21 (ET), the eve of week 5: every game from that
   night on is still to play, the season is still running, and the gm persona's first game that night is a playoff game */
const EVE = "2026-10-21T20:00:00Z", AHEAD = new Set(), CODE = mock.liveSessionOf("gm").teamCode;
let PO = null;
function eve(args) {
  if (!AHEAD.size) {
    const all = mock.league({ p_season: 1 }).games;
    all.forEach((g) => { if (Date.parse(g.scheduled_at) > Date.parse(EVE)) AHEAD.add(g.id); });
    PO = all.filter((g) => AHEAD.has(g.id) && g.stage === "regular" && (g.home === CODE || g.away === CODE)).sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))[0].id;
  }
  const b = mock.league(Object.assign({}, args, { p_season: 1 }));
  b.generated = EVE;
  (b.seasons || []).forEach((x) => { if (x.number === 1) x.status = "active"; });
  (b.games || []).forEach((g) => { if (AHEAD.has(g.id)) Object.assign(g, { status: "scheduled", home_score: null, away_score: null, forfeit: null, forfeit_team_id: null, went_ot: false, home_shots: null, away_shots: null, ea_match_id: null }); if (g.id === PO) g.stage = "playoff"; });
  if (b.box && b.box.byGame) AHEAD.forEach((id) => { delete b.box.byGame[id]; });
  return b;
}
const EMPTY = ["game_lineups", "availability", "market_pool_requests", "team_lines", "team_line_plan", "game_vetoes", "games_public",
  "team_mgmt_policy", "team_mgmt_moves", "management_applications", "club_notices", "trades", "action_requests", "action_messages"];

(async () => {
  const b = await chromium.launch(), errs = [];
  const open = async (hash, w, h) => {
    const ctx = await b.newContext({ viewport: { width: w || 1280, height: h || 900 } }), tables = {};
    EMPTY.forEach((t) => { tables[t] = []; });
    await mock.install(ctx, { live: true, persona: "gm", writes: {}, tables, rpcs: { s2_league: (a) => mock.ok(eve(a)) } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-24T00:00:00.000Z", from: "daily" })); } catch (e) { /* storage blocked */ } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|^S2\.market:/.test(m.text())) errs.push(m.text()); });
    await p.goto(S2_BASE + "?season=1" + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2._hq && S2.lineups && S2.auth && S2.auth.sub, null, { timeout: 20000 });
    /* the page clock two hours before the playoff game */
    await p.evaluate((gid) => { const g = S2.M.games.filter((x) => x.id === gid)[0]; window.__now = Date.parse(g.at) - 2 * 3600e3; Date.now = () => window.__now; S2.route(true); }, PO);
    await p.waitForSelector('[data-w="plan"] [data-act="sheet"]', { timeout: 10000 }).catch(() => {});
    await wait(400);
    return { p, ctx };
  };

  console.log("## the database counts the series");
  let { p, ctx } = await open("#/hq?tab=lineups");
  A("no sample series panel; the playoff game is one of the week's sheets", await p.evaluate((gid) => !S2.$('[data-w="poff"]') && !!S2.$('[data-act="sheet"][data-g="' + gid + '"]'), PO), PO);
  await p.click('[data-act="sheet"][data-g="' + PO + '"]'); await wait(500);
  A("the playoff sheet says both limits, goaltenders included, counted from the box scores (Rule S2.7)", await p.evaluate(() => /four games of a series and two of its first four, goaltenders included, counted from the box scores/.test(S2.$(".sheet").textContent) && /Rule S2\.7/.test(S2.$(".sheet").textContent)));
  /* the club's six, placed straight into the work in progress (the bench's own taps are proved in tools/ui/lineups.test.cjs) */
  const placed = await p.evaluate((o) => {
    const H2 = S2._hq, g = S2.M.games.filter((y) => y.id === o.gid)[0], r = S2.M.roster(o.code);
    const F = r.all.filter((p) => p.unit === "F"), D = r.all.filter((p) => p.unit === "D"), G = r.all.filter((p) => p.unit === "G"), Lu = H2.luOf(o.code, g);
    Lu.slots = { LW: F[0].id, C: F[1].id, RW: F[2].id, LD: D[0].id, RD: D[1].id, G: G[0].id }; S2._lineups.paintSheet();
    return { tag: G[0].tag, slots: Object.assign({}, Lu.slots) };
  }, { gid: PO, code: CODE });
  const MSG = placed.tag + " has already played 2 of the first 4 games of this series; a player may play 2 of them (Rule 8.3).";
  mock.respond(ctx, "set_game_lineup", () => mock.fail("22023", MSG));
  await p.click('.sheet [data-x="file"]'); await wait(500);
  const after = await p.evaluate(() => ({ err: S2.$(".sheet .hqx-err").textContent, slots: Object.fromEntries([...document.querySelectorAll(".sheet .hqx-slot")].map((x) => [x.dataset.slot, x.dataset.pid || null])) }));
  const sent = mock.calls(ctx).filter((c) => c.rpc === "set_game_lineup");
  A("the database's series-limit refusal is shown in its words, and the six stay on the sheet", after.err === MSG && JSON.stringify(after.slots) === JSON.stringify(placed.slots) && sent.length === 1 && sent[0].args.p_game === PO, { err: after.err, n: sent.length });
  A("nothing reads as filed after a refusal", await p.evaluate((gid) => !/Filed|Published/.test(S2.$('[data-act="sheet"][data-g="' + gid + '"]').textContent), PO));
  await ctx.close();

  console.log("## a phone");
  ({ p } = await open("#/hq?tab=lineups", 375, 812));
  A("no sideways scroll at 375", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.context().close();
  A("no page errors", errs.length === 0, errs.slice(0, 3));
  await b.close();
  console.log(fails ? fails + " of " + n + " FAILED" : "all " + n + " passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
