const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* Today for a member, and the public pages that now know who is reading: node tools/ui/run.cjs today (any mode)
   Audit 2026-11-09: posting availability is the most used member action on the live site, and Today knew nothing about
   the member. The commissioner, 2026-11-09: "availability should sit beside it on desktop width and above it on the
   phone. Allow for an easy 1 button way to mark yourself available for every game night of the week."
   Commissioner, 2026-11-14: "fix this part of the page on the top of the 'Today' page in the player view and just add a
   shortcut button to the players' 'Your week' page ... You can swap it out with the 'week 5 schedule' button next to the
   'standings' button." So Today has no availability block now: the hero's first button opens You, Your week, and the
   one-tap answer and the one store are checked on that page (you.test.cjs). Then: "The 'Your week' button on the front
   page should also show for managers, staff, and commissioners." So every signed-in role with a week gets it; a guest,
   or a member with no games, keeps the week's schedule.
   Also pinned here: the member's club row in Standings, Games opening on the member's club, Find me on Stats, the
   Players headline that agrees with its filters, the club roster whose columns add up to its headline, a tied box-score
   lead said as a tie, and no club-color strip on the match room.
   v5.00 swap (e7, 2026-11-24): Today follows the season on screen. Season 2 before its schedule shows the phase it is in
   (before clubs exist, before the draft, before the schedule), then game nights, each from the model's own Season 2
   calendar; it never says "The regular season is complete" of a season that has not started. Checked on s2_league bodies
   recorded read-only on 2026-11-24 (private, ~/Developer/cghl-private/fixtures; FAIL without them), each moved to its
   phase and dated by its own clock. A club page (Season 2 and ?season=1) tells its own season's roster shape and has no
   Oct 19, no sample clock and no stand-ins (review 2026-11-24).
   v5.00 swap (i3b, 2026-11-25): the suite runs the REAL site only (stream h0's live mode, tools/ui/mock/index.cjs): every
   page boots as the site build ships it, signed in as a persona, on a recorded body (Season 1 at ?season=1, or Season 2
   moved to a phase). A member and a seat holder are put on a Season 2 club in the phase bodies (rosterMe), as the
   database's rosters would have them. New: the Game Center's lineups are the clubs' filed sheets, read once they lock.
   Deleted with the demo, each pinning only a demo device: the persona waived through S2.demo.waive, the demo game night
   (its live tiles' sample period and clock, its sample clock chip and its ?night=demo links), the fixture's preview note on
   the club About, and the one-tap answer on Your week (you.test.cjs pins it on the real door). Staff and commissioners
   with no club of their own keep the week's schedule, by the ruling's own rule (a reader with no games). Reads only;
   nothing reaches production (the opt-in real read at the end aside, S2_REAL_READ=1). */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const BASE = S2_BASE;
const fs = require("fs"), os = require("os"), path = require("path");
const FIX = path.join(os.homedir(), "Developer/cghl-private/fixtures");
const need = (f) => { const p = path.join(FIX, f); if (!fs.existsSync(p)) { console.log("FAIL missing private input " + p); process.exit(1); } return JSON.parse(fs.readFileSync(p, "utf8")); };
const CUR = need("s2_league-anon-2026-11-24b-current.json"), S1 = need("s2_league-anon-2026-11-24b-season1.json");
const clone = (x) => JSON.parse(JSON.stringify(x));
/* the current-season body moved to a Season 2 phase. Seats put their holders on the club's roster (ensure_manager_rostered),
   so "clubs exist" is two Season 1 spots per club; the draft is draft_state complete; game nights are four Week 1 games at
   9 PM ET on Wed, Dec 16. generated is the moment the league was read, which the model's clock follows */
function phaseBody(phase) {
  const b = clone(CUR); b.generated = "2026-11-24T18:00:00+00:00";
  if (phase === "offseason") return b;
  b.rosters.spots = b.teams.flatMap((t) => S1.rosters.spots.filter((s) => s.team === t.code).slice(0, 2).map((s) => Object.assign({}, s, { team_id: t.id })));
  b.generated = "2026-12-06T17:00:00+00:00";
  if (phase === "draft") return b;
  b.draft = { state: { status: "complete", season_number: 2 }, picks: Array.from({ length: 80 }, (_, i) => ({ id: "pick" + i, used: true, round: 1 + Math.floor(i / 8), overall_pick: i + 1 })) };
  b.generated = "2026-12-14T17:00:00+00:00";
  if (phase === "schedule") return b;
  const T = b.teams;
  b.games = [0, 1, 2, 3].map((i) => ({ id: "00000000-0000-4000-8000-00000000000" + i, week: 1, stage: "regular", status: "scheduled", voided: false, forfeit: null, went_ot: false,
    home: T[2 * i].code, away: T[2 * i + 1].code, home_team_id: T[2 * i].id, away_team_id: T[2 * i + 1].id, home_score: null, away_score: null, scheduled_at: "2026-12-17T02:00:00+00:00", rescheduled_from: null }));
  b.generated = phase === "quiet" ? "2026-12-15T17:00:00+00:00" : "2026-12-17T02:10:00+00:00";   /* tonight: 9:10 PM ET, ten minutes in */
  return b;
}
/* a persona on a club in the body (a member's roster spot; a seat holder on their seat's club, ensure_manager_rostered):
   the database's rosters, as the phase would hold them. The ids stay in memory; nothing here prints one */
function rosterMe(b, persona) {
  const s = mock.liveSessionOf(persona); if (!s.profileId) return b;
  const t = s.teamId ? b.teams.filter((x) => x.id === s.teamId)[0] : b.teams[0], src = b.rosters.spots[0] || S1.rosters.spots[0];
  b.rosters.spots = b.rosters.spots.filter((x) => x.profile_id !== s.profileId).concat([Object.assign({}, src, { id: "mock-me", profile_id: s.profileId, team_id: t.id, team: t.code, squad: "pro", status: "active", position: "C", salary: 0 })]);
  return b;
}
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)) + ")")); if (!cond) fails++; };
const AS = { guest: "anon", player: "member", office: "gm", staff: "staff", commish: "commissioner" };

(async () => {
  const b = await chromium.launch();
  const errors = [], unexpected = [];
  /* the side reads the pages make, answered empty unless a section says otherwise: the market (a profile), a member's
     pickup lines, the Game Center's lineups and lobby codes, You's own reads */
  const READS = { tables: { pickup_stats: [], game_lineups: [], market_waivers: [], market_pool_requests: [], market_boards: [], market_bid_nights: [], market_lots: [], market_bids: [], availability: [], owner_applications: [], staff_applications: [] },
    rpcs: { statistical_title_board: mock.ok([]), market_calendar: mock.ok({}), market_pool: mock.ok([]), market_club_state: mock.ok(null), has_department: mock.ok(false), is_app_reviewer: mock.ok(false), is_any_committee_manager: mock.ok(false), staff_voter_count: mock.ok(11) } };
  /* hash: the page; o.phase: Season 2 moved to a phase (Season 1 answers ?season=1 and the archive read); o.persona; o.width;
     o.me: put the persona on a club in the phase body; o.tables, o.rpcs: more answers */
  async function open(hash, o) {
    o = o || {};
    const persona = o.persona || "anon";
    const ctx = await b.newContext(o.width ? { viewport: { width: o.width, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-10-23T00:00:00.000Z", from: "daily" })); } catch (e) {} });
    const rpcs = Object.assign({}, READS.rpcs, o.phase ? { s2_league: (a) => mock.ok(+a.p_season === 1 ? clone(S1) : o.me ? rosterMe(phaseBody(o.phase), persona) : phaseBody(o.phase)) } : {}, o.rpcs || {});
    await mock.install(ctx, { live: true, persona, rpcs, tables: Object.assign({}, READS.tables, o.tables || {}) });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push((o.phase || "rec") + ": " + m.text()); });
    p.on("pageerror", (e) => errors.push((o.phase || "rec") + " pageerror: " + e.message));
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2.LIVE && S2.auth && S2.auth.sub && document.querySelector("#page > :not(.empty-state)"), null, { timeout: 30000 });
    await p.waitForTimeout(400);
    return p;
  }
  const done = (p) => { unexpected.push(...mock.unexpected(p.context())); return p.context().close(); };
  const todayRead = () => { const q = (s) => document.querySelector(s), t = (s) => ((q(s) || {}).textContent || "").trim();
    return { state: (q(".td") || { dataset: {} }).dataset.state, h1: t("h1"), kicker: t(".td-hero .kicker, .td-nb .kicker"), lede: t(".td-hero .lede-l, .td-nb .lede-l"),
      secs: [...document.querySelectorAll("#tdBody > *")].map((e) => e.className.replace(/ reveal| in/g, "")), complete: /regular season is complete/i.test(document.body.textContent),
      doors: [...document.querySelectorAll(".td-s2 .td-doors a")].map((a) => a.querySelector(".td-door-t b").textContent), band: t("#tdS2H"),
      cal: [...document.querySelectorAll(".td-cal .td-doors a")].map((a) => ({ t: a.querySelector(".td-door-t b").firstChild.textContent.trim(), chip: ((a.querySelector(".chip") || {}).textContent || "") })),
      calH: t("#tdCalH"), pins: document.querySelectorAll(".td-hero .td-pin").length, tips: document.querySelectorAll(".td-hero .td-pin-tip").length,
      sample: document.querySelectorAll(".chip.sample").length, dock: document.querySelectorAll(".demo-dock, .td-dock, .td-watch").length, pw: !!document.getElementById("tdPwH"), view: S2.M.view.season, now: S2.M.etLong(S2.M.now) }; };

  let p, r;
  console.log("## Your week: a shortcut in the hero, the answers on the member's own page (Season 2's first game week)");
  const heroBtns = (p) => p.evaluate(() => ({ state: document.querySelector(".td").dataset.state, you: !!document.querySelector("#tdYou, .td-you"), week: S2.availability.week().length,
    btns: [...document.querySelectorAll(".td-hero .td-btns a")].map((a) => ({ t: a.textContent.trim(), h: a.getAttribute("href") })) }));
  /* a reader with no games this week keeps the week's schedule: a guest, and a staffer or commissioner with no club of their own */
  for (const role of ["guest", "staff", "commish"]) {
    p = await open("#/today", { phase: "quiet", persona: AS[role] });
    r = await heroBtns(p);
    A(role + ": no availability block on Today", r.state === "quiet" && !r.you, r);
    A(role + ": with no games of their own, the hero keeps the week's schedule next to Standings", r.week === 0 && r.btns.length === 2 && r.btns[0].t === "Week 1 schedule" && r.btns[0].h === "#/games?week=1" && r.btns[1].t === "Standings", r);
    await done(p);
  }
  /* commissioner, 2026-11-14: "The 'Your week' button on the front page should also show for managers, staff, and commissioners." */
  for (const role of ["player", "office"]) {
    p = await open("#/today", { phase: "quiet", persona: AS[role], me: true });
    r = await heroBtns(p);
    A(role + ": no availability block on Today", r.state === "quiet" && !r.you, r);
    A(role + ": Your week replaces the week's schedule, next to Standings", r.week > 0 && r.btns.length === 2 && r.btns[0].t === "Your week" && r.btns[0].h === "#/you?tab=week" && r.btns[1].t === "Standings" && r.btns[1].h === "#/standings", r);
    await p.click('.td-hero .td-btns a[href="#/you?tab=week"]');
    await p.waitForFunction(() => location.hash === "#/you?tab=week" && document.querySelector("#page > *"), null, { timeout: 10000 });
    A(role + ": the shortcut opens You, Your week", await p.evaluate(() => location.hash === "#/you?tab=week" && S2.parse().name === "you"));
    await done(p);
  }
  p = await open("#/today", { phase: "tonight", persona: "member", me: true });
  A("game night: no availability block on Today either", !(await p.$("#tdYou, .td-you")));
  await done(p);
  p = await open("#/today", { phase: "quiet", persona: "member", me: true, width: 375 });
  r = await p.evaluate(() => { const bs = [...document.querySelectorAll(".td-hero .td-btns a")].map((a) => a.getBoundingClientRect()); return { over: document.documentElement.scrollWidth - window.innerWidth, fit: bs.every((x) => x.right <= window.innerWidth && x.left >= 0), n: bs.length }; });
  A("phone: both hero buttons fit and Today never scrolls sideways", r.n === 2 && r.fit && r.over <= 0, r);
  await done(p);

  console.log("## the league pages know the member (Season 1, where the member played)");
  p = await open("?season=1#/standings", { persona: "member" });
  r = await p.evaluate(() => ({ me: (S2.mine() || {}).club, rows: [...document.querySelectorAll("tr.lg-me")].map((x) => x.querySelector(".lg-club").getAttribute("href")) }));
  A("Standings marks the member's club row", !!r.me && r.rows.length > 0 && r.rows.every((h) => h.indexOf(r.me) >= 0), r);
  await done(p);
  p = await open("?season=1#/games", { persona: "member" });
  r = await p.evaluate(() => ({ me: S2.mine().club, label: document.getElementById("tdClub").textContent, full: S2.M.team(S2.mine().club).full, rows: [...document.querySelectorAll(".td-mx")].length }));
  A("Games opens on the member's club", r.rows > 0 && r.label.indexOf(r.full) >= 0, { rows: r.rows, opened: r.label.indexOf(r.full) >= 0 });
  await done(p);
  p = await open("?season=1#/games?club=all", { persona: "member" });
  r = await p.evaluate(() => document.getElementById("tdClub").textContent);
  A("?club=all keeps the whole league for a member", /All clubs/.test(r), r);
  await done(p);
  p = await open("?season=1#/stats?tab=" + "skaters", { persona: "member" });
  const role1 = await p.evaluate(() => { const me = S2.mine(); return me && me.mainRole; });
  if (role1 === "G") { await p.evaluate(() => { location.hash = "#/stats?tab=goalies"; }); await p.waitForTimeout(500); }
  const T = role1 === "G" ? { q: "#gkQ", me: "#gkMe", t: "#gkT" } : { q: "#skQ", me: "#skMe", t: "#skT" };
  await p.fill(T.q, "zzzz");
  await p.waitForTimeout(150);
  await p.click(T.me);
  await p.waitForTimeout(700);
  r = await p.evaluate((T) => ({ ok: document.querySelector(T.t + " tr.lg-me") && document.querySelector(T.t + " tr.lg-me").textContent.indexOf(S2.mine().tag) === 0, focus: document.activeElement && document.activeElement.closest("tr.lg-me") !== null, q: document.querySelector(T.q).value }), T);
  A("Find me clears the filter and lands focus on the member's own line", r.ok && r.focus && r.q === "", r);
  await done(p);
  p = await open("?season=1#/stats?tab=players");
  r = await p.evaluate(() => ({ h: document.querySelector(".lg-hero h1").textContent, segs: [...document.querySelectorAll("#dirSeg button")].map((b) => b.textContent.replace(/\s+/g, " ").trim()), me: !!document.getElementById("dirMe") }));
  const num = (label) => +((r.segs.filter((x) => x.indexOf(label) === 0)[0] || "").match(/(\d+)$/) || [0, -1])[1];
  A("the Players headline counts as its filters do (rostered and front office)", r.h.indexOf(num("Rostered") + " players on rosters") === 0 && r.h.indexOf(num("Management") + " in front offices") > 0, r);
  A("a guest has no Find me", !r.me);
  await done(p);

  console.log("## club page, box score, the match room and its lineups");
  p = await open("?season=1#/club/VAN");
  r = await p.evaluate(() => { const h = document.getElementById("pfcRosH").textContent, n = +(h.match(/(\d+) players? on the active roster/) || [0, -1])[1];
    const cols = [...document.querySelectorAll(".pfc-depth .pfc-col-h .num")].reduce((a, x) => a + +x.textContent, 0), camp = document.querySelector(".pfc-camp .pfc-col-h .num");
    return { n, cols, camp: camp ? +camp.textContent : 0 }; });
  A("the club's position columns add up to its active-roster headline", r.n === r.cols && r.n > 0, r);
  await done(p);
  /* game night, read live: a live game's room */
  const liveId = "00000000-0000-4000-8000-000000000000";
  p = await open("#/game/" + liveId, { phase: "tonight" });
  r = await p.evaluate(() => { const room = document.querySelector(".td-room"); if (!room) return "no room"; const a = getComputedStyle(room, "::before"), c = getComputedStyle(room, "::after"); return [a.content, c.content]; });
  A("the match room has no club-color strip", Array.isArray(r) && r.every((x) => x === "none" || x === "normal"), r);
  r = await p.evaluate(() => ({ live: !!document.querySelector(".td-room-live"), sub: (document.querySelector(".td-room-sub") || {}).textContent || "", sample: document.querySelectorAll(".chip.sample").length }));
  A("a live match room says it is live and its puck drop, never Upcoming, a minute count or a sample mark", r.live && /^Puck drop 9:00 PM/.test(r.sub) && !/Upcoming|min in/.test(r.sub) && r.sample === 0, r);
  await done(p);
  /* the lineups (Rule 5.3): before the lock, nobody; from the lock, the clubs' filed sheets (game_lineups), read once */
  p = await open("#/game/" + liveId, { phase: "quiet" });
  r = await p.evaluate(() => ({ h: (document.getElementById("tdLuH") || {}).textContent, bars: document.querySelectorAll(".td-lineups .td-lu-bar").length, names: document.querySelectorAll(".td-lineups .td-lu-l a").length, btn: !!document.querySelector("[data-lu]") }));
  A("before the lock the lineups say when they lock, show nobody, and offer no Show anyway", /^Lineups lock at 8:30\sPM\sET$/.test(r.h) && r.bars === 12 && r.names === 0 && !r.btn, r);
  await done(p);
  const QB = phaseBody("tonight"), G0 = QB.games[0], fill = (code) => { const pl = S1.rosters.spots.filter((s) => s.team === code).slice(0, 6).map((s) => s.profile_id);
    return { game_id: G0.id, team_id: QB.teams.filter((t) => t.code === code)[0].id, lw: pl[0], center: pl[1], rw: pl[2], ld: pl[3], rd: pl[4], goalie: pl[5], post_lock: false, post_lock_count: 0 }; };
  const seen = [];
  p = await open("#/game/" + liveId, { phase: "tonight", tables: { game_lineups: (q) => { seen.push(q.select); return [Object.assign(fill(G0.home), { post_lock: true, post_lock_count: 1 })]; } } });
  await p.waitForFunction(() => !/Reading the lineup/.test((document.querySelector(".td-lineups") || {}).textContent || "x"), null, { timeout: 8000 }).catch(() => null);
  r = await p.evaluate((codes) => { const cols = [...document.querySelectorAll(".td-lineups .td-lu")];
    return { h: (document.getElementById("tdLuH") || {}).textContent, away: cols[0] && cols[0].textContent, home: cols[1] && [...cols[1].querySelectorAll(".td-lu-l a")].map((a) => a.getAttribute("href")),
      late: !!(cols[1] && cols[1].querySelector(".td-late")), want: codes }; }, [G0.away, G0.home]);
  const wantHome = (() => { const x = fill(G0.home); return [x.lw, x.center, x.rw, x.ld, x.rd, x.goalie].map((id) => "#/player/" + id); })();
  A("from the lock the Game Center reads both clubs' filed sheets once (game_lineups, the classic matchup read)", seen.length === 1 && /center/.test(seen[0]) && /goalie/.test(seen[0]), seen);
  A("the home club's six in rink order, each linked to their page, a change after the lock marked", r.h === "The lineups are locked" && JSON.stringify(r.home) === JSON.stringify(wantHome) && r.late, { h: r.h, n: r.home && r.home.length, late: r.late });
  A("a club with no sheet on file says so, never a guess", /No lineup on file/.test(r.away || ""), r.away);
  await done(p);
  p = await open("#/game/" + liveId, { phase: "tonight", tables: { game_lineups: () => mock.fail("57014", "canceling statement due to statement timeout") } });
  await p.waitForTimeout(800);
  r = await p.evaluate(() => ({ p: (document.querySelector(".td-lineups .sec-head p") || {}).textContent || "", retry: !!document.querySelector('.td-lineups [data-lu="retry"]') }));
  A("a failed read says the league's words, with Try again", /canceling statement due to statement timeout/.test(r.p) && r.retry, r);
  errors.splice(0, errors.length, ...errors.filter((e) => !/lineups of .* could not be read|status of 400/.test(e)));
  await done(p);
  /* a final whose two top skaters share the most points: the headline says they shared the lead */
  p = await open("?season=1#/today");
  r = await p.evaluate(() => {
    const M = S2.M;
    for (const g0 of M.games.filter((g) => g.isFinal && g.hasBox)) {
      const g = M.game(g0.id), sk = [g.away, g.home].flatMap((c) => (g.box[c] || []).filter((o) => o.role === "S"));
      const top = Math.max(...sk.map((o) => o.p)), level = sk.filter((o) => o.p === top), goals = Math.max(...level.map((o) => o.g));
      if (top > 0 && level.length > 1 && (goals < 2 || level.filter((o) => o.g === goals).length > 1)) return { href: g0.href, n: level.length };
    }
    return null; });
  if (r) {
    const want = r.n;
    await p.evaluate((h) => { location.hash = h; }, r.href); await p.waitForTimeout(500);
    const h = await p.evaluate(() => (document.getElementById("tdBoxH") || document.querySelector(".td-box, #tdBox") || {}).textContent || document.body.textContent);
    A("a tied box-score lead is said as a tie (" + want + " level)", /shared the lead/.test(h), h.slice(0, 40));
  } else A("(the recording has a final with a tied lead on points)", false);
  await done(p);

  /* review 2026-11-25: the demo cleanup (0382aab) took the box score's and the power rankings' rules with the demo's, and
     no check saw the layout go. A phone shows one club's box at a time and the switch swaps it; a desktop stacks both
     clubs on one column plan and hides the switch; the rankings rows are a grid of crest, club and rating */
  const boxRead = () => { const cs = (e) => getComputedStyle(e), seg = document.getElementById("tdBoxSeg"), th = document.querySelector(".td-box tbody th");
    return { clubs: [...document.querySelectorAll(".td-boxclub")].filter((e) => cs(e).display !== "none").map((e) => e.dataset.club), seg: !!seg && cs(seg).display !== "none",
      min: cs(document.querySelector(".td-box")).minWidth, layout: cs(document.querySelector(".td-box")).tableLayout, sticky: th ? cs(th).position : "" }; };
  const finalHref = () => (S2.M.games.filter((g) => g.isFinal && g.hasBox)[0] || {}).href;
  for (const w of [375, 0]) {
    p = await open("?season=1#/today", w ? { width: w } : {});
    const href = await p.evaluate(finalHref);
    await p.evaluate((h) => { location.hash = h; }, href);
    await p.waitForFunction(() => document.querySelectorAll(".td-boxclub").length === 2, null, { timeout: 15000 });
    r = await p.evaluate(boxRead);
    const g = await p.evaluate(() => { const g = S2.M.game(S2.parse().arg); return { away: g.away, home: g.home }; });
    if (w) {
      A("phone box score: one club at a time (the away club first), the switch shown, a 600 px table with a sticky name column", JSON.stringify(r.clubs) === JSON.stringify([g.away]) && r.seg && r.min === "600px" && r.sticky === "sticky", r);
      await p.click('#tdBoxSeg button[data-v="' + g.home + '"]'); await p.waitForTimeout(300);
      r = await p.evaluate(boxRead);
      A("phone box score: the switch swaps to the other club", JSON.stringify(r.clubs) === JSON.stringify([g.home]), r);
    } else A("desktop box score: both clubs stacked on one fixed column plan, no switch", r.clubs.length === 2 && !r.seg && r.layout === "fixed" && r.sticky === "sticky", r);
    await done(p);
  }
  const s1Active = () => { const x = clone(S1); x.seasons.forEach((s) => { if (+s.number === 1) s.status = "active"; }); return x; };
  p = await open("?season=1#/today", { rpcs: { s2_league: (a) => mock.ok(+a.p_season === 1 ? s1Active() : mock.league(a)) } });
  r = await p.evaluate(() => { const li = [...document.querySelectorAll(".td-txl li")], c = li[0] && li[0].querySelector(".td-tx-cr .crest");
    return { state: document.querySelector(".td").dataset.state, n: li.length, grid: li.every((e) => getComputedStyle(e).display === "grid"), crest: c ? Math.round(c.getBoundingClientRect().width) : 0,
      areas: li[0] ? getComputedStyle(li[0]).gridTemplateAreas : "" }; });
  A("Today's power rankings: three rows, each a grid of crest (32 px), club and rating on one line at desktop width", r.state === "quiet" && r.n === 3 && r.grid && r.crest === 32 && /"cr t at"/.test(r.areas), r);
  await done(p);

  console.log("## Season 2 on Today, read live: each phase before the schedule, then game nights");
  p = await open("#/today", { phase: "offseason" });
  r = await p.evaluate(todayRead);
  const champ = await p.evaluate(() => { const od = S2.M.offseasonDemo(); return od && S2.M.team(od.champion).name; });
  A("before clubs exist: the off-season scene, dated the day the league was read, Season 2 on screen", r.view === 2 && r.state === "offseason" && r.kicker === "Off-season · " + r.now && r.h1 === "The " + champ + " are champions", r);
  A("before clubs exist: the champion, the awards of Season 1 (the archive read), the Season 2 band, and no regular-season copy", JSON.stringify(r.secs) === JSON.stringify(["hero td-hero", "band tint td-leaders", "band td-s2"]) && !r.complete &&
    (await p.evaluate(() => document.querySelector(".td-leaders .kicker").textContent)) === "Season 1 awards", r);
  A("before clubs exist: every door is open (owner applications close Nov 28)", JSON.stringify(r.doors) === JSON.stringify(["Sign up", "Own a club", "Join the staff"]) && r.band === "Sign up. Own a club. Join the staff.", r);
  A("before clubs exist: the lede gives Season 2's puck drop from M.s2cal", /Season 2 drops the puck Wednesday, December 16\.$/.test(r.lede), r.lede);
  A("no demo device on the page: no dock, no scene button, no Watch, nothing sample", r.dock === 0 && r.sample === 0, r);
  await done(p);

  p = await open("#/today", { phase: "draft", persona: "member" });
  r = await p.evaluate(todayRead);
  A("before the draft: the draft is the news, six days out it is named by its weekday", r.state === "draft" && r.h1 === "The draft is Saturday" && r.kicker === "Season 2 · Sunday, December 6" && !r.complete, r);
  A("before the draft: the lede counts the seated clubs, the rounds and the sign-ups, then puck drop (the sign-up close is the calendar's and the band's)", /^Eight clubs pick ten rounds from the \d+ players signed up so far, Saturday, December 12 at 9:00\sPM\sET\. The puck drops Wednesday, December 16\.$/.test(r.lede), r.lede);
  const signed = await p.evaluate(() => S2.M.signups.some((s) => s.pid === S2.session.profileId));
  A("before the draft: the hero offers sign-up (or Your season to a member signed up) and the Draft room", JSON.stringify(await p.evaluate(() => [...document.querySelectorAll(".td-hero .td-btns > *")].map((x) => x.textContent.trim()))) === JSON.stringify([signed ? "See Your season" : "Register for Season 2", "Draft room"]), signed);
  A("before the draft: the map shows the seated clubs, bare (no Season 1 records on the pins)", r.pins === 8 && r.tips === 0, r);
  A("before the draft: the calendar starts at the next date and ends at the playoffs, in order", r.calH === "Next: sign-ups close, December 11" &&
    JSON.stringify(r.cal.map((x) => x.t)) === JSON.stringify(["Sign-ups close", "The draft", "Puck drop", "Saturday bidding opens", "Movement deadline", "The regular season ends", "The playoffs begin"]), r.cal);
  A("before the draft: the movement deadline is marked projected (no schedule yet), and nothing else is", r.cal.filter((x) => x.chip).map((x) => x.t + ":" + x.chip).join() === "Movement deadline:projected", r.cal);
  A("before the draft: owner applications have closed, so the band offers sign-up and the staff", JSON.stringify(r.doors) === JSON.stringify(["Sign up", "Join the staff"]) && r.band === "Sign up. Join the staff.", r);
  A("before the draft: nothing on the page is sample", r.sample === 0, r);
  await done(p);

  p = await open("#/today", { phase: "schedule" });
  r = await p.evaluate(todayRead);
  A("before the schedule: puck drop is the news, the draft is done", r.state === "schedule" && r.h1 === "Puck drop Wednesday" && /^The draft is done: 80 picks to eight clubs\. Game nights are Wednesday, Thursday and Friday from 9:00\sPM\sET, six weeks, starting Wednesday, December 16\./.test(r.lede) && !r.complete, r);
  A("before the schedule: sign-ups have closed, so no Season 2 band; the calendar starts at puck drop", r.doors.length === 0 && !r.secs.some((c) => /td-s2/.test(c)) && r.cal[0] && r.cal[0].t === "Puck drop", r);
  await done(p);
  p = await open("#/games", { phase: "schedule" });
  r = await p.evaluate(() => ({ k: document.querySelector(".td-ghero .kicker").textContent, h: document.getElementById("tdGH").textContent, lede: document.querySelector(".td-ghero .lede-l").textContent, e: (document.querySelector(".td-gempty .t-head") || {}).textContent }));   /* QA visual 6: the list's empty is S2.empty, its title the box's t-head */
  A("Games, before the schedule: the season on screen, no games said as such", r.k === "Season 2 · Schedule and results" && r.h === "No games scheduled yet" && /first game night, Wednesday, December 16/.test(r.lede) && r.e === "Season 2 has no games yet", r);
  await done(p);
  p = await open("#/player", { phase: "schedule" });
  r = await p.evaluate(() => ({ h: document.querySelector("#pfRoot h1").textContent, p: document.querySelector("#pfRoot .lede-l").textContent }));
  A("a bare #/player in a season with no games: no points leader yet, said as such", r.h === "No points leader yet" && /^Season 2 has no games yet/.test(r.p), r);
  await done(p);

  p = await open("#/today", { phase: "quiet" });
  r = await p.evaluate(todayRead);
  A("game nights, the day before: a quiet day for Season 2's Week 1", r.state === "quiet" && r.h1 === "Week 1 starts tomorrow" && /^Week 1 · Tuesday, December 15$/.test(r.kicker) && !r.complete, r);
  /* QA nits 8 (2026-11-25): this check pinned a record on every pin of a quiet day with no final, which read "0-0-0, 0 pts,
     1st West" on all eight; before the first final the pins are bare, and they carry the record from the first final */
  A("a quiet day before the first final: the map's pins carry no record yet", r.pins === 8 && r.tips === 0, r);
  await done(p);
  {
    const fb = phaseBody("quiet"); Object.assign(fb.games[0], { status: "final", home_score: 3, away_score: 2, scheduled_at: "2026-12-10T02:00:00+00:00" });
    p = await open("#/today", { rpcs: { s2_league: (a) => mock.ok(+a.p_season === 1 ? clone(S1) : clone(fb)) } });
    r = await p.evaluate(todayRead);
    A("a quiet day after the first final: the map's pins carry each club's record", r.state === "quiet" && r.pins === 8 && r.tips === 8, r);
  }
  await done(p);
  p = await open("#/today", { phase: "tonight" });
  r = await p.evaluate(todayRead);
  const tiles = await p.evaluate(() => [...document.querySelectorAll(".td-nb .td-tile")].map((x) => ({ href: x.querySelector(".td-tile-link").getAttribute("href"), right: ((x.querySelector(".td-ts-r") || {}).textContent || ""), watch: !!x.querySelector(".td-watch") })));
  A("game night, read live: tonight's real games, all four live, nothing sample", r.state === "tonight" && r.h1 === "Four games live" && r.lede === "Every game tonight is under way." && r.sample === 0 && /^Game night · Week 1 · Wednesday, December 16$/.test(r.kicker), r);
  A("game night before the season's first final: no race and no power rankings (every club is level at zero)", !r.secs.some((c) => /td-race/.test(c)) && !r.pw, r.secs);
  A("game night, read live: each tile opens its own Game Center (no demo night), names no clock it does not have, and offers no pretend Watch", tiles.length === 4 && tiles.every((x) => /^#\/game\/[0-9a-f-]+$/.test(x.href) && x.right === "" && !x.watch), tiles);
  await done(p);

  console.log("## Season 1 at ?season=1, read live: its archive keeps working");
  p = await open("?season=1#/today", { phase: "offseason" });
  r = await p.evaluate(todayRead);
  A("?season=1: a complete season is its off-season, with its champion and awards", r.view === 1 && r.state === "offseason" && /are champions$/.test(r.h1) && !r.complete, r);
  await done(p);
  p = await open("?season=1#/games", { phase: "offseason" });
  r = await p.evaluate(() => ({ k: document.querySelector(".td-ghero .kicker").textContent, h: document.getElementById("tdGH").textContent }));
  A("?season=1: Games is Season 1's, every game played", r.k === "Season 1 · Schedule and results" && /^All \d+ games played$/.test(r.h), r);
  await done(p);
  p = await open("?season=1#/club/BOS", { phase: "offseason" });
  r = await p.evaluate(() => ({ lede: document.querySelector("#pfcHero .pfx-lede").textContent, k: document.querySelector('[aria-labelledby="pfcSzH"] .kicker').textContent }));
  A("?season=1: a club page tells Season 1 as it finished", /^Boston finished Season 1 \d+-\d+-\d+ with \d+ points/.test(r.lede) && /^Season 1/.test(r.k), r);
  /* review 2026-11-24: read live, the club page's roster and its About told of a fixed "Season 1 (Oct 19)" roster, the
     "sample Season 2 clock" and camp players standing in "in this preview". Read live there is no sample: the roster is
     the season on screen's, by that season's rules (Season 1: group limits and a camp; Season 2: twelve, minimums, no camps) */
  const clubRead = () => { const t = (s) => ((document.querySelector(s) || {}).textContent || "").trim();
    /* the roster section's own words, without the players' names (the columns, the camp and the seats) */
    const sec = document.querySelector('[aria-labelledby="pfcRosH"]'), words = sec ? sec.cloneNode(true) : null;
    if (words) words.querySelectorAll(".pfc-depth, .pfc-camp, .pfc-seats").forEach((e) => e.remove());
    return { about: t(".pfc details.about .about-b"), ros: words ? words.textContent.trim() : "", rosH: t("#pfcRosH"), pay: t(".pfc-pay .pf-pb-l"),
      cols: [...document.querySelectorAll(".pfc-depth .pfc-col-h .num")].reduce((a, x) => a + +x.textContent, 0), campH: t("#pfcPcamp span"), camp: +(t("#pfcPcamp .num") || 0) }; };
  const want1 = { pro: S1.rosters.spots.filter((s) => s.team === "BOS" && s.squad !== "tc").length, tc: S1.rosters.spots.filter((s) => s.team === "BOS" && s.squad === "tc").length };
  r = await p.evaluate(clubRead);
  A("?season=1 club About: Season 1's own roster shape, no Oct 19 and no sample clock", r.about.indexOf("Season 1 roster shape: up to 7 forwards, 5 defense and 3 goaltenders, 15 in all, per Rule 2.1") >= 0 &&
    !/Oct 19|sample|preview/i.test(r.about) && /\(active roster and camp\)/.test(r.about), r.about);
  A("?season=1 club roster: every Season 1 active in the columns and its camp as training camp, against Season 1's limits, nothing sample",
    r.cols === want1.pro && r.rosH.indexOf(want1.pro + " players on the active roster") === 0 && r.camp === want1.tc && r.campH === "Training camp" && r.pay === "Season 1 payroll" &&
    /against Season 1 limits of 7, 5 and 3 per Rule 2\.1/.test(r.ros) && /in training camp, which had no limit/.test(r.ros) && !/sample|preview|stand in|Season 2/i.test(r.ros), { r, want1 });
  await done(p);
  p = await open("#/club/BOS", { phase: "draft" });
  r = await p.evaluate(clubRead);
  A("Season 2 club About, read live: twelve all season, the minimums, no camps, no Oct 19 and no sample", r.about.indexOf("Season 2 roster shape: 12 players all season") >= 0 && /at least 3 forwards, 2 defense and 1 goaltender and no maximums \(Rule S2\.4\); clubs keep no training camp/.test(r.about) &&
    !/Oct 19|sample|preview|Season 1 roster shape|\(active roster and camp\)/i.test(r.about), r.about);
  A("Season 2 club roster, read live: the seated players against Season 2's minimums, no camp and nothing sample", r.cols === 2 && r.rosH.indexOf("2 players on the active roster") === 0 && !r.campH && r.pay === "Season 2 payroll" &&
    /against Season 2 minimums of 3, 2 and 1 \(Rule S2\.4\)/.test(r.ros) && !/sample|preview|stand in|camp/i.test(r.ros) &&
    /* the twelve and the cap room, as hq-market pinned them on the demo's Season 2 (review 2026-11-25) */
    r.ros.indexOf("2 of 12 active spots") >= 0 && /leaving \$[\d.]+M \(Season 2 cap room: \$30M less the active roster\)/.test(r.ros), r);
  /* review 2026-11-24: before the season's first final the club hero said "holds a playoff spot, with 0 points" and a
     division rank drawn from tiebreakers, while Today hides its race until the first final. The hero agrees with Today */
  const heroRead = () => ({ lede: ((document.querySelector("#pfcHero .pfx-lede") || {}).textContent || ""), nums: document.querySelectorAll("#pfcHero .pfc-nums > div").length, flags: document.querySelectorAll("#pfcHero .pfx-flag").length });
  r = await p.evaluate(heroRead);
  A("Season 2 club hero, no games yet: the club's last closed season as it finished, never a playoff spot at zero points", /^Boston finished Season 1 \d+-\d+-\d+ with \d+ points/.test(r.lede) && !/holds a playoff spot|with 0 points/.test(r.lede), r);
  await done(p);
  {
    const qb = phaseBody("quiet"), home = qb.teams[0], away = qb.teams[1];
    p = await open("#/club/" + home.code, { phase: "quiet" });
    r = await p.evaluate(heroRead);
    A("Season 2 club hero, games scheduled and none final: the first game, never a playoff spot", r.lede === home.city + " opens Season 2 Wednesday, December 16 at home to " + away.city + "." && r.nums === 0 && r.flags === 0 && !/playoff|point/.test(r.lede), r);
    await done(p);
  }

  console.log("## QA 2026-11-25: the map's pins, the clubs before a first final, the Season page's doors by the clock, News");
  /* QA motion 11: the hover lift and the press had one specificity, the lift came later, and a mouse always hovers what it
     presses, so the press never showed on a desktop. QA visual 34: the pin disc is a white crest plate in both themes */
  p = await open("?season=1#/today");
  {
    const pin = await p.$(".td-hero .td-pin"); await pin.scrollIntoViewIfNeeded(); await p.waitForTimeout(700); const bx = await pin.boundingBox();
    await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.waitForTimeout(250);
    const lift = await p.evaluate(() => getComputedStyle(document.querySelector(".td-hero .td-pin:hover .td-pin-disc")).transform);
    await p.mouse.down(); await p.waitForTimeout(250);
    const press = await p.evaluate(() => getComputedStyle(document.querySelector(".td-hero .td-pin:hover .td-pin-disc")).transform);
    await p.mouse.move(2, 880); await p.mouse.up();   /* released away from the pin, so the press opens no club page */
    A("a Today map pin lifts under a mouse and still shows its press (scale .93) when pressed", /matrix\(1, 0, 0, 1, 0, -2\)/.test(lift) && /^matrix\(0\.93, 0, 0, 0\.93, 0, 0\)$/.test(press), { lift, press });
    r = await p.evaluate(() => { const d = document.querySelector(".td-hero .td-pin-disc"), light = getComputedStyle(d).backgroundColor; document.documentElement.setAttribute("data-theme", "dark"); const dark = getComputedStyle(d).backgroundColor; return { light, dark }; });
    A("the pin's crest plate is white in both themes", r.light === "rgb(255, 255, 255)" && r.dark === "rgb(255, 255, 255)", r);
  }
  await done(p);
  /* QA nits 8: before a season's first final the tiles and the pins rank no club ("1st East, 0-0-0, 0 pts") */
  for (const phase of ["quiet", "tonight"]) {
    p = await open("#/today", { phase });
    r = await p.evaluate(() => ({ state: document.querySelector(".td").dataset.state, finals: S2.M.view.finals, tiles: document.querySelectorAll(".td-clubs .lg-ct").length, ranked: document.querySelectorAll(".td-clubs .lg-ct-rk, .td-clubs .lg-ct-rec").length,
      tips: document.querySelectorAll(".td-pin-tip").length, labels: [...document.querySelectorAll(".td-pin")].filter((a) => /points|\d(st|nd|rd|th) in/.test(a.getAttribute("aria-label"))).length }));
    A(phase + ", no final yet: the club tiles and the map pins carry no rank, record or points", r.finals === 0 && r.tiles === 8 && r.ranked === 0 && r.tips === 0 && r.labels === 0, r);
    await done(p);
  }
  /* QA function 5 and visual 8: the Season page's doors, hero and Register button follow the model's clock (the league
     read's own moment) and the reader's own sign-up; a staffer is offered neither Own a club nor Join the staff */
  const seasonRead = () => ({ lede: document.querySelector(".hero .lede-l").textContent, cta: [...document.querySelectorAll(".hero .btn")].map((x) => x.textContent),
    doors: [...document.querySelectorAll(".lg-door")].map((d) => [d.querySelector("h3").textContent, d.querySelector(".lg-door-st").textContent, (d.querySelector(".btn") || {}).textContent || ""]),
    text: document.getElementById("hdoors").closest(".sec-head").querySelector("p").textContent, signed: !!S2.session.profileId && S2.M.signups.some((x) => x.pid === S2.session.profileId && x.status !== "declined") });
  const door = (r, t) => (r.doors.filter((d) => d[0] === t)[0] || []);
  p = await open("#/season", { phase: "offseason" });
  r = await p.evaluate(seasonRead);
  A("Season page, Nov 24: sign-ups and owner applications open, a guest joins first", /Sign-ups are open until Friday, December 11/.test(r.lede) && door(r, "Register")[1] === "Open now" && door(r, "Own a club")[1] === "Closes Sat, Nov 28" &&
    door(r, "Register")[2] === "Join with Discord" && /^Three are open today\./.test(r.text), r);
  await done(p);
  p = await open("#/season", { phase: "draft", persona: "member" });
  r = await p.evaluate(seasonRead);
  A("Season page, Dec 6: owner applications have closed, and a member is offered Register only if not signed up", door(r, "Own a club")[1] === "Closed Sat, Nov 28" && /^Two are open today\./.test(r.text) &&
    (r.signed ? r.cta[0] === "You are signed up" && door(r, "Register")[2] === "You are signed up" && r.cta.indexOf("Register for Season 2") < 0 : r.cta[0] === "Register for Season 2"), r);
  await done(p);
  p = await open("#/season", { phase: "schedule", persona: "member" });
  r = await p.evaluate(seasonRead);
  A("Season page, Dec 14: sign-ups closed, nobody is offered Register, and the draft is done", /Sign-ups closed Friday, December 11/.test(r.lede) && !/are open until/.test(r.lede) && door(r, "Register")[1] === "Closed Fri, Dec 11" &&
    door(r, "Register")[2] === "Details" && r.cta.join() === "See the dates" && door(r, "Draft room")[1] === "Done" && !/draft room opens/.test(r.text), r);
  await done(p);
  p = await open("#/season", { phase: "offseason", persona: "staff" });
  r = await p.evaluate(seasonRead);
  A("Season page: a staffer is offered neither Own a club nor Join the staff (Rule 2.7)", !door(r, "Own a club").length && !door(r, "Join the staff").length && door(r, "Register").length === 3, r.doors);
  await done(p);
  p = await open("#/today", { persona: "staff" });
  r = await p.evaluate(todayRead);
  A("Today's Season 2 band: a staffer is offered neither Own a club nor Join the staff", r.doors.indexOf("Own a club") < 0 && r.doors.indexOf("Join the staff") < 0, r.doors);
  await done(p);
  /* QA visual 16, worst 7 and worst 15: News keeps its hero when its read fails, wraps a member's longest tag on a phone, and
     one story is the lead alone */
  const newsRpc = (rows) => ({ s2_league: (a) => ((a.p_sections || []).indexOf("news") >= 0 ? (rows ? mock.ok({ season: 2, sections: a.p_sections, news: rows }) : mock.fail("57014", "canceling statement due to statement timeout")) : mock.ok(mock.league(a))) });
  const errsNews = errors.length;
  p = await open("#/news", { rpcs: newsRpc(null) });
  await p.waitForTimeout(400);
  r = await p.evaluate(() => ({ h1: (document.querySelector("#ofNews h1") || {}).textContent, err: (document.querySelector("#ofNews .empty-state.err .t-foot") || {}).textContent, retry: !!document.querySelector('#ofNews [data-news="retry"]') }));
  A("News, a failed read: the page keeps its heading, says why and offers Try again", r.h1 === "League news" && /canceling statement due to statement timeout/.test(r.err || "") && r.retry, r);
  await done(p);
  errors.splice(errsNews, errors.length - errsNews, ...errors.slice(errsNews).filter((e) => !/status of 400|News:/.test(e)));
  p = await open("#/news", { rpcs: newsRpc([{ id: 1, title: "MaximumLengthGamertag021 scores four in a win", body: "First paragraph.\n\nSecond paragraph.", category: "Night recap", published_at: "2026-11-20T03:00:00Z" }]), width: 390 });
  await p.waitForTimeout(400);
  r = await p.evaluate(() => ({ heads: [...document.querySelectorAll("#ofNews h1, #ofNews h2")].map((x) => x.textContent), more: !!document.getElementById("ofMoreH"), hscroll: document.documentElement.scrollWidth - innerWidth }));
  A("News with one story: the lead alone, no '0 more stories', and a 25-character tag in its title stays on a 390 px page", r.heads.length === 2 && !r.more && r.hscroll <= 0, r);
  await done(p);

  /* main session, 2026-11-25: the sections below read PRODUCTION (public s2_league and news, read only). A network drop timed
     the whole suite out at 45 s after every offline check had passed (Nov 24, ECONNRESET night), so the default run stays
     offline and repeatable; the go/no-go runs them on purpose: S2_REAL_READ=1 node tools/ui/run.cjs --suite today */
  if (process.env.S2_REAL_READ === "1") {
  /* the opt-in real read: production's public s2_league and news, read only, with no mock (fixture mode only) */
  const livePage = async (hash) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-10-23T00:00:00.000Z", from: "daily" })); } catch (e) {} });
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push("live real: " + m.text()); });
    p.on("pageerror", (e) => errors.push("live real pageerror: " + e.message));
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2.M.view && S2.M.view.live && document.querySelector("#page > :not(.empty-state)"), null, { timeout: 45000 });
    await p.waitForTimeout(400);
    return p;
  };
  console.log("## the real read (public s2_league, read only)");
  p = await livePage("?source=live#/today");
  r = await p.evaluate(todayRead);
  const want = await p.evaluate(() => { const v = S2.M.view; if (v.season === 2 && !v.games) return v.empty.rosters ? "offseason" : S2.M.draft.state && S2.M.draft.state.status === "complete" ? "schedule" : "draft";
    return v.status === "complete" ? "offseason" : null; });
  A("live: Today shows the phase the season on screen is in" + (want ? " (" + want + ")" : ""), (want ? r.state === want : /^(quiet|tonight)$/.test(r.state)) && !r.complete && r.h1, r);
  await done(p);

  /* News read live (office.js): the league's own news table, the season's lazy news section, never recaps counted again here */
  p = await livePage("?source=live&season=1#/news");
  await p.waitForFunction(() => document.querySelector("#ofNews .of-lead-a, #ofNews .empty-state.err"), null, { timeout: 45000 });
  r = await p.evaluate(() => ({ lead: document.querySelector("#ofNews .of-lead-a") && document.querySelector("#ofNews .of-lead-a").getAttribute("href"), rows: [...document.querySelectorAll("#ofNews .of-n-row")].map((a) => a.getAttribute("href")),
    sample: document.querySelectorAll("#ofNews .chip.sample").length, err: !!document.querySelector("#ofNews .empty-state.err") }));
  A("live News: Season 1's stories from the news table, newest first, none sample", !r.err && /^#\/news\/n-[0-9a-f-]+$/.test(r.lead || "") && r.rows.length > 0 && r.rows.every((h) => /^#\/news\/n-[0-9a-f-]+$/.test(h)) && r.sample === 0, { lead: r.lead, n: r.rows.length, err: r.err });
  if (r.lead) {
    const title = await p.evaluate(() => document.querySelector("#ofNews .of-lead-t").textContent);
    await p.click("#ofNews .of-lead-a"); await p.waitForTimeout(500);
    r = await p.evaluate(() => ({ h1: document.querySelector("#page h1").textContent, paras: document.querySelectorAll(".of-art-b .of-p").length }));
    A("live News: a story opens with its own title and body", r.h1 === title && r.paras > 0, r);
    /* the pulse's news kind (a story published or taken down): the rows are read again and News repaints in place; the
       list is drawn from the rows on hand meanwhile, never "Loading" (s2_league's news section is lazy, so S2.reread cannot) */
    await p.evaluate(() => { location.hash = "#/news"; });
    await p.waitForFunction(() => document.querySelector("#ofNews .of-lead-a"), null, { timeout: 15000 });
    r = await p.evaluate(async () => {
      const real = S2.load.read, asked = []; let blank = null;
      S2.load.read = function (n, secs) { asked.push(secs.join()); return real.apply(this, arguments); };
      S2.live.emit("news", { sections: ["news", "honors"] }); S2.route(true);
      blank = !document.querySelector("#ofNews .of-lead-a");
      for (let i = 0; i < 150 && !asked.includes("news"); i++) await new Promise((res) => setTimeout(res, 100));
      await new Promise((res) => setTimeout(res, 1500));
      S2.load.read = real;
      return { asked, blank, lead: !!document.querySelector("#ofNews .of-lead-a"), err: !!document.querySelector("#ofNews .empty-state.err") };
    });
    A("live News: the pulse's news kind reads the stories again and repaints in place, never blank", r.asked.filter((x) => x === "news").length === 1 && !r.blank && r.lead && !r.err, r);
  }
  await done(p);
  /* a story opened by its address: the router titles the page before the read lands, so its own title follows the read */
  if (r.lead) {
    p = await livePage("?source=live&season=1#/news");
    await p.waitForFunction(() => document.querySelector("#ofNews .of-lead-a"), null, { timeout: 45000 });
    const href = await p.evaluate(() => document.querySelector("#ofNews .of-lead-a").getAttribute("href"));
    await done(p);
    p = await livePage("?source=live&season=1" + href);
    await p.waitForFunction(() => document.querySelector(".of-art h1, #ofNews .empty-state.err"), null, { timeout: 45000 });
    r = await p.evaluate(() => ({ h1: (document.querySelector(".of-art h1") || {}).textContent, doc: document.title, inline: (document.getElementById("inlineTitle") || {}).textContent }));
    A("live News: a story opened by its address takes its own title once the read lands", !!r.h1 && r.doc.indexOf(r.h1 + " · ") === 0 && r.inline === r.h1, r);
    await done(p);
  }

  } else console.log("## the real read: skipped (production reads run only with S2_REAL_READ=1)");

  A("no console errors on any page", errors.length === 0, errors.slice(0, 5));
  A("every read the pages made was answered (nothing unexpected reached the fence)", unexpected.length === 0, unexpected.slice(0, 5));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
