const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* Today's off-season scene: node tools/ui/run.cjs offseason (any mode)
   Commissioner, 2026-11-14: "Build it out using the same Apple design skills as the rest of the site to make the page look
   built in and not bolted on. Be methodical, check your work, make no mistakes, and try not to add any pointless
   information." The scene says three things, each once: who won Season 1 (the hero, REAL since the final was played on
   2026-11-20: the Bruins 4-0), the titles Season 1 filed (REAL), and how to be part of Season 2 (the closing band).
   v5.00 swap (i3b, 2026-11-25): the suite runs the REAL site (stream h0's live mode, tools/ui/mock/index.cjs) on the
   recorded production s2_league: Season 2 has no club seated yet, so Today is the off-season scene by itself, dated the
   day the league was read. The quiet-day widths read a Season 2 body moved to its first game week (quietBody). Deleted
   with the demo (each pinned only a demo device): the corrected demo result (S2.demo.result), the scene picker in the
   dock and its role switch (S2.setRole), and ?state=. Reads only; nothing reaches production. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const BASE = S2_BASE;
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)) + ")")); if (!cond) fails++; };
const clone = (x) => JSON.parse(JSON.stringify(x));
/* the recorded Season 2 body moved to its first game week, the day before it (today.test.cjs phaseBody's quiet day): two
   Season 1 roster spots per club, the draft complete, four Week 1 games at 9 PM ET on Wednesday, December 16 */
function quietBody() {
  const b = mock.league({}), S1 = mock.league({ p_season: 1 }), T = b.teams;
  b.rosters.spots = T.flatMap((t) => S1.rosters.spots.filter((s) => s.team === t.code).slice(0, 2).map((s) => Object.assign({}, s, { team_id: t.id })));
  b.draft = { state: { status: "complete", season_number: 2 }, picks: [] };
  b.games = [0, 1, 2, 3].map((i) => ({ id: "00000000-0000-4000-8000-00000000000" + i, week: 1, stage: "regular", status: "scheduled", voided: false, forfeit: null, went_ot: false,
    home: T[2 * i].code, away: T[2 * i + 1].code, home_team_id: T[2 * i].id, away_team_id: T[2 * i + 1].id, home_score: null, away_score: null, scheduled_at: "2026-12-17T02:00:00+00:00", rescheduled_from: null }));
  b.generated = "2026-12-15T17:00:00+00:00";
  return b;
}
const QUIET = { rpcs: { s2_league: (a) => mock.ok(+a.p_season === 1 ? mock.league({ p_season: 1 }) : clone(quietBody())) } };

(async () => {
  const b = await chromium.launch();
  const errors = [], unexpected = [];
  /* role: a persona (anon, member, ...); o: more for mock.install (the quiet day's league) */
  async function page(hash, persona, width, o) {
    const ctx = await b.newContext(width ? { viewport: { width, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-10-23T00:00:00.000Z", from: "daily" })); } catch (e) {} });
    await mock.install(ctx, Object.assign({ live: true, persona: persona || "anon" }, o || {}));
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2.LIVE && S2.auth && S2.auth.sub && document.querySelector("#tdBody, #app main, #app section"), null, { timeout: 30000 });
    await p.waitForTimeout(300);
    return p;
  }
  const done = (p) => { unexpected.push(...mock.unexpected(p.context())); return p.context().close(); };
  let p, r;

  console.log("## the model: the real champion, which changes nothing, and the titles as filed");
  p = await page("#/today", "commissioner");
  r = await p.evaluate(() => {
    const before = JSON.stringify(S2.M.standings("league")), a = S2.M.offseasonDemo(), b2 = S2.M.offseasonDemo();
    return { a, same: a === b2, untouched: before === JSON.stringify(S2.M.standings("league")), view: S2.M.view.season, rostered: S2.M.view.empty.rosters };
  });
  A("Season 2 is on screen and no club is seated yet (the recording), so Today is between seasons", r.view === 2 && r.rostered === true, r);
  /* 2026-11-20: the final was played. Commissioner: "With the Bruins winning the finals last night against vancouver" */
  A("the off-season scene is the real result (not sample) and the same object on every call", r.a && r.a.sample === false && r.same, r.a);
  A("the real final: the Bruins champions over the Canucks", r.a.champion === "BOS" && r.a.runnerUp === "VAN", r.a);
  A("the real series score: 4-0", r.a.w === 4 && r.a.l === 0, r.a);
  A("the model dates the final's week: the Saturday after it, noon ET", r.a.now === "2026-11-21T17:00:00.000Z", r.a.now);
  A("calling it changes no standings", r.untouched);
  /* v5.00 swap (e7): no member is named in this file (the repo is public); each title is pinned by its numbers, its club and
     its holder's own record in the model, and the scoring and goal-scoring titles by one holder */
  r = await p.evaluate(() => ({ one: S2.M.filedTitles(1).map((t) => [t.category, t.label, t.club, t.gp, t.total, t.value, !!t.id && !!t.tag && S2.M.player(t.id).tag === t.tag]),
    ids: S2.M.filedTitles(1).map((t) => t.id), two: S2.M.filedTitles(2) }));
  A("Season 1's four titles as filed, each on its player", JSON.stringify(r.one) === JSON.stringify([
    ["points_title", "Scoring Title", "VAN", 35, 172, 4.914, true], ["goals_title", "Goal-scoring Title", "VAN", 35, 102, 2.914, true],
    ["assists_title", "Playmaking Title", "BOS", 14, 36, 2.571, true], ["goaltending_title", "Goaltending Title", "DET", 25, 67, 2.68, true]]) &&
    r.ids[0] === r.ids[1] && new Set(r.ids).size === 3, r.one.map((x) => x.slice(0, 3).concat(x.slice(3, 7))));
  A("a season with no filed titles has none", Array.isArray(r.two) && r.two.length === 0);
  await done(p);

  console.log("## the page: hero, titles, Season 2, and nothing a member cannot use between seasons");
  for (const persona of ["anon", "member"]) {
    p = await page("#/today", persona);
    r = await p.evaluate(() => {
      const od = S2.M.offseasonDemo(), q = (s) => document.querySelector(s), t = (s) => (q(s) || {}).textContent || "", me = S2.session.profileId;
      return { od, champ: S2.M.team(od.champion).name, cityC: S2.M.team(od.champion).city, cityR: S2.M.team(od.runnerUp).city, now: S2.M.etLong(S2.M.now),
        signed: !!me && S2.M.signups.some((s) => s.pid === me), state: (q(".td") || { dataset: {} }).dataset.state,
        secs: [...document.querySelectorAll("#tdBody > *")].map((e) => e.className.replace(/ reveal| in/g, "")),
        gone: [".td-mc", ".td-nb", ".td-race", ".td-tx", ".td-txslot", ".td-clubs", ".td-potw", ".td-you"].filter((s) => q(s)),
        maps: document.querySelectorAll(".td-map").length, h1: t("#tdHeroH"), kicker: t(".td-hero .kicker"), lede: t(".td-hero .lede-l"),
        kchip: !!q(".td-hero .kicker .chip.sample"), chips: document.querySelectorAll(".chip.sample").length,
        btns: [...document.querySelectorAll(".td-hero .td-btns > *")].map((x) => ({ tag: x.tagName, t: x.textContent.trim(), href: x.getAttribute("href"), flow: x.dataset.flow || null })),
        band: t(".td-s2 .lede-l"), doors: [...document.querySelectorAll(".td-doors a")].map((a) => [a.querySelector(".td-door-t b").textContent, a.dataset.flow]),
        ends: q("#page").classList.contains("ends-band"),
        tips: document.querySelectorAll(".td-hero .td-pin-tip").length, pinPts: [...document.querySelectorAll(".td-hero .td-pin")].filter((a) => /points|\d(st|nd|rd|th) in/.test(a.getAttribute("aria-label"))).length,
        pins: document.querySelectorAll(".td-hero .td-pin").length };
    });
    A(persona + ": the scene is the off-season, by itself (no ?state=)", r.state === "offseason", r.state);
    A(persona + ": three sections, in order: hero, titles, Season 2", JSON.stringify(r.secs) === JSON.stringify(["hero td-hero", "band tint td-leaders", "band td-s2"]), r.secs);
    A(persona + ": no match center, race, rankings, transactions, club tiles, Players of the Week or Your week", r.gone.length === 0, r.gone);
    A(persona + ": the hero keeps the league map, once (ruling 2026-10-16: map first while no games are on)", r.maps === 1, r.maps);
    A(persona + ": the headline is the champion, from the model", r.h1 === "The " + r.champ + " are champions", r.h1);
    A(persona + ": the kicker dates the scene the day the league was read, and nothing on the page is sample (the champion and the titles are real)", r.kicker === "Off-season · " + r.now && !r.kchip && r.chips === 0, { kicker: r.kicker, now: r.now, chips: r.chips });
    /* 2026-11-21: the final is told with the trophy it won (the awards build; the headline keeps its tested size) */
    const res = r.od.l === 0 ? r.cityC + " swept " + r.cityR + " in the final to win the Stanley Cup." : r.cityC + " beat " + r.cityR + " four games to ";
    A(persona + ": the lede tells the final and the Stanley Cup, then the puck drop", r.lede.indexOf(res) === 0 && /to win the Stanley Cup\. Season 2 drops the puck Wednesday, December 16\.$/.test(r.lede), r.lede);
    A(persona + ": the puck drop is said once (not again in the Season 2 band)", r.band === "Everyone signs up again, Season 1 players included.", r.band);
    A(persona + ": one hero action, the Season 2 page's own (a member signed up for Season 2 goes to Your season)", persona === "anon"
      ? r.btns.length === 1 && r.btns[0].t === "Join with Discord" && r.btns[0].href === "#/you"
      : r.signed ? r.btns.length === 1 && r.btns[0].t === "See Your season" && r.btns[0].href === "#/you?tab=season"
        : r.btns.length === 1 && r.btns[0].tag === "BUTTON" && r.btns[0].t === "Register for Season 2" && r.btns[0].flow === "register", { btns: r.btns, signed: r.signed });
    A(persona + ": the doors open their forms", JSON.stringify(r.doors) === JSON.stringify([["Sign up", "register"], ["Own a club", "owner"], ["Join the staff", "staff"]]), r.doors);
    A(persona + ": the page runs into the footer", r.ends);
    A(persona + ": the map is bare: no record, points or place on any pin (it would read as the final table)", r.pins === 8 && r.tips === 0 && r.pinPts === 0, r);
    await done(p);
  }

  console.log("## the awards: the leaders' own design, the league's titles and the NHL's stat trophies as decided");
  p = await page("#/today", "member");
  r = await p.evaluate(() => ({ h: document.getElementById("tdTiH").textContent, p: document.querySelector(".td-leaders .sec-head p").textContent,
    link: !!document.querySelector(".td-leaders .sec-head .arrow"), linkHref: (document.querySelector(".td-leaders .sec-head .arrow") || { getAttribute: () => null }).getAttribute("href"), who: document.querySelector(".td-lead-who b").textContent,
    whoHref: document.querySelector(".td-lead-who").getAttribute("href"), me: S2.M.filedTitles(1)[0].href, top: S2.M.filedTitles(1)[0].tag,
    names: [S2.M.filedTitles(1)[2].tag, S2.M.filedTitles(1)[3].tag, (S2.M.trophies(1).filter((x) => x.key === "jennings")[0] || {}).tag],
    nums: [...document.querySelectorAll(".td-lead-n > div")].map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent]),
    rows: [...document.querySelectorAll(".td-lead-more a")].map((a) => [a.querySelector(".who b").textContent, a.querySelector(".who small").textContent, a.querySelector(".v b").textContent, a.querySelector(".v small").textContent]) }));
  /* commissioner, 2026-11-21: the NHL's stat trophies "beside the titles" (awards.test.cjs pins the model and the Stats tab) */
  A("the headline is the news", r.h === r.top + " wins four awards");
  A("the sentence names the titles, then the trophies, and carries the totals", r.p === r.top + " takes the Scoring and Goal-scoring Titles and the Art Ross and Rocket Richard Trophies, with 172 points and 102 goals in 35 games.");
  A("an arrow link to every award (Stats > Awards shows them as decided)", r.link && r.linkHref === "#/stats?tab=awards", r.linkHref);
  A("the statement is the scoring champion, linked to the profile, one number per stat: the total, the rate under it", r.who === r.top && r.whoHref === r.me && JSON.stringify(r.nums) === JSON.stringify([["Points, 4.91 a game", "172"], ["Goals, 2.91 a game", "102"]]), r.nums);
  A("one line for each other holder, by award name, in stat order", JSON.stringify(r.rows) === JSON.stringify([[r.names[0], "Playmaking Title · Boston Bruins", "2.57", "assists a game"], [r.names[1], "Goaltending Title · Detroit Red Wings", "2.68", "goals against a game"],
    [r.names[2], "Jennings Trophy · Seattle Kraken", "150", "Seattle allowed, the fewest"]]) && r.names.every(Boolean), r.rows.map((x) => x.slice(1)));

  console.log("## a sign-up the league confirmed turns the hero's button into the next step, in place");
  /* js/flows.js fires s2:filed only once the database has confirmed a filing (contracts/client-api.md, e5) */
  r = await p.evaluate(() => {
    const hero = document.querySelector(".td-hero"), was = document.querySelector(".td-hero .td-btns > *").textContent.trim();
    document.dispatchEvent(new CustomEvent("s2:flow", { detail: { flow: "register", data: {}, ctx: {} } }));   /* the concept's event moves nothing */
    const still = document.querySelector(".td-hero .td-btns > *").textContent.trim();
    document.dispatchEvent(new CustomEvent("s2:filed", { detail: { flow: "register", data: {}, ctx: {}, result: { data: null } } }));
    const btn = document.querySelector(".td-hero .td-btns > *");
    return { was, still, same: hero === document.querySelector(".td-hero"), t: btn.textContent, href: btn.getAttribute("href") };
  });
  A("an unconfirmed filing changes nothing; a confirmed one reads See Your season and goes there, with no re-render", r.still === r.was && r.same && r.t === "See Your season" && r.href === "#/you?tab=season", r);
  await done(p);

  p = await page("#/today", "member", undefined, QUIET);
  r = await p.evaluate(() => ({ state: document.querySelector(".td").dataset.state, tips: document.querySelectorAll(".td-hero .td-pin-tip").length }));
  /* QA nits 8 (2026-11-25): this check pinned a record tip on every pin of a quiet day with no final, which read "0-0-0, 0
     pts, 1st West" on all eight; before the first final the pins are bare, and from the first final they carry the record */
  A("a quiet day (Season 2's first game week) before its first final: the pins carry no record yet", r.state === "quiet" && r.tips === 0, r);
  await done(p);
  p = await page("#/today", "member", undefined, { rpcs: { s2_league: (a) => { if (+a.p_season === 1) return mock.ok(mock.league({ p_season: 1 })); const qb = clone(quietBody());
    Object.assign(qb.games[0], { status: "final", home_score: 3, away_score: 2, scheduled_at: "2026-12-10T02:00:00+00:00" }); return mock.ok(qb); } } });
  r = await p.evaluate(() => ({ state: document.querySelector(".td").dataset.state, tips: document.querySelectorAll(".td-hero .td-pin-tip").length }));
  A("a quiet day after the first final keeps the pins' records", r.state === "quiet" && r.tips === 8, r);
  await done(p);
  p = await page("#/today", "member", 320);
  r = await p.evaluate(() => { const k = document.querySelector(".td-hero .kicker"), kb = k.getBoundingClientRect();
    return { chip: !!k.querySelector(".chip"), fits: kb.right <= window.innerWidth, text: k.textContent.trim() }; });
  A("320 px: the kicker is text alone (no sample chip, the result is real) and fits", !r.chip && r.fits && /^Off-season · /.test(r.text), r);
  await done(p);

  console.log("## widths, and a long club name");
  /* the headline's widest line against its own column: .td-hero-copy sizes its children to their text (justify-items:
     start), so h1.scrollWidth never exceeds h1.clientWidth even when a word runs into the map */
  const spare = () => { const h = document.getElementById("tdHeroH"), rg = document.createRange(); rg.selectNodeContents(h);
    return Math.round(h.parentElement.getBoundingClientRect().right - Math.max(...[...rg.getClientRects()].map((x) => x.right))); };
  for (const w of [320, 375, 1000, 1280, 1440, 1920]) {
    for (const scene of ["offseason", "quiet"]) {
      p = await page("#/today", "member", w < 700 ? w : undefined, scene === "quiet" ? QUIET : undefined);
      if (w >= 700) await p.setViewportSize({ width: w, height: 900 });
      await p.waitForTimeout(200);
      r = await p.evaluate((fn) => { const s = (0, eval)("(" + fn + ")")(), bt = document.querySelector(".td-hero .td-btns > *").getBoundingClientRect();
        return { state: document.querySelector(".td").dataset.state, over: document.documentElement.scrollWidth - window.innerWidth, spare: s, btn: bt.left >= 0 && bt.right <= window.innerWidth }; }, spare.toString());
      A(w + " px, " + scene + ": no sideways scroll, the headline stays in its column, the button fits", r.state === scene && r.over <= 0 && r.spare >= 0 && r.btn, r);
      await done(p);
    }
  }
  for (const w of [375, 430, 1024, 1920]) {
    p = await page("#/today", "member", w < 700 ? w : undefined);
    if (w >= 700) await p.setViewportSize({ width: w, height: 900 });
    r = await p.evaluate(async (fn) => {
      const t = S2.M.team(S2.M.offseasonDemo().champion), keep = t.name, out = [];
      for (const nm of ["Hurricanes", "Blackhawks"]) {   /* the two ten-letter nicknames; BLACKHAWKS is the widest word any club could bring */
        t.name = nm; location.hash = "#/today?n=" + nm; await new Promise((res) => setTimeout(res, 450));
        const h = document.getElementById("tdHeroH"); out.push({ text: h.textContent, long: h.classList.contains("long"), spare: (0, eval)("(" + fn + ")")() });
      }
      t.name = keep; return out;
    }, spare.toString());
    A(w + " px: a ten-letter club name takes the smaller step and stays in its column", r.every((x) => /^The (Hurricanes|Blackhawks) are champions$/.test(x.text) && x.long && x.spare >= 0), r);
    await done(p);
  }

  A("no console errors on any page", errors.length === 0, errors.slice(0, 5));
  A("every read the pages made was answered (nothing unexpected reached the fence)", unexpected.length === 0, unexpected.slice(0, 5));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
