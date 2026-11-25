const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* A player's full history on the stats profile: node tools/ui/run.cjs career (any mode). Commissioner, 2026-11-20: "For
   the concept site, please build in the stats page that it should always show a player's full history on their player
   stats profile." The classic site's twin is the profile's Career card (v4.54).
   v5.00 swap (i3b, 2026-11-25): the suite runs the REAL site (stream h0's live mode, tools/ui/mock/index.cjs): every page
   boots as the site build ships it and reads the recorded production s2_league; Season 1 (?season=1) carries the lines,
   so every expectation is the recording's, worked out from the model, never a member named here. The pickup and market
   reads the profile makes are answered empty. Reads only; nothing reaches production. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const BASE = S2_BASE + "?season=1";
/* the profile's own reads beside the league's: a member's pickup lines (js/pages/pickups.js) and the market (js/market.js) */
const READS = { tables: { pickup_stats: [], market_waivers: [], market_pool_requests: [], market_boards: [], market_bid_nights: [], market_lots: [], market_bids: [] },
  rpcs: { market_calendar: mock.ok({}), market_pool: mock.ok([]), market_club_state: mock.ok(null) } };
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 400) + ")")); if (!cond) fails++; };

(async () => {
  const b = await chromium.launch();
  const errors = [];
  /* base: the address before the hash (Season 1, ?season=1, unless given: S2_BASE is the current season) */
  async function page(hash, width, base) {
    const ctx = await b.newContext(width ? { viewport: { width, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked: the page still renders */ } });
    await mock.install(ctx, Object.assign({ live: true, persona: "anon" }, READS));
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto((base || BASE) + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2.LIVE && S2.auth && S2.auth.sub && document.querySelector("#app section"), null, { timeout: 30000 });
    await p.waitForTimeout(300);
    return p;
  }
  const unexpected = [];
  const done = (p) => { unexpected.push(...mock.unexpected(p.context())); return p.context().close(); };
  const read = () => {
    const s = document.querySelector('[aria-labelledby="pfCarH"]');
    if (!s) return null;
    return { h: s.querySelector("h2").textContent, p: s.querySelector(".copy p").textContent,
      roles: [...s.querySelectorAll(".pf-car-role")].map((x) => x.textContent),
      tables: [...s.querySelectorAll("table")].map((t) => ({ label: t.getAttribute("aria-label"), head: [...t.querySelectorAll("thead th")].map((x) => x.textContent.replace(/[↑↓]/g, "").trim()),
        buttons: t.querySelectorAll("thead button").length,
        rows: [...t.querySelectorAll("tbody tr")].map((r) => [r.querySelector(".pf-car-s").textContent + " · " + r.querySelector(".pf-car-st").textContent,
          [...r.querySelectorAll(".pf-car-cd")].map((x) => x.textContent).join(" ")].concat([...r.children].slice(2).map((c) => c.textContent.trim()))) })),
      links: [...s.querySelectorAll("a.pf-car-club")].map((a) => a.getAttribute("href")),
      order: [...document.querySelectorAll("#pfBody > section, #pfBody > div")].map((x) => x.getAttribute("aria-labelledby") || x.id) };
  };
  let p, r;

  console.log("## the model: a row per season, kind of game and role, each the season line itself");
  p = await page("#/today");
  r = await p.evaluate(() => {
    const M = S2.M, bad = [];
    M.players.forEach((pl) => {
      const all = M.career(pl.id), rows = all.filter((x) => x.stage === "reg");
      if (rows.length !== pl.roles.length) bad.push([pl.id, "rows", rows.length, pl.roles.length]);
      /* a playoff row is the season's playoff line, one per role played there (v4.09) */
      all.filter((x) => x.stage !== "reg").forEach((x) => { if (x.stage !== "po" || x.season !== 1 || !x.line || !(x.line.gp > 0)) bad.push([pl.id, x.role, "playoff row", x.season, x.stage]); });
      rows.forEach((x) => {
        if (x.line !== pl.lines[x.role]) bad.push([pl.id, x.role, "not the season line"]);
        if (x.season !== 1) bad.push([pl.id, x.role, x.season, x.stage]);
        if (!x.clubs.length || x.clubs.some((c) => !M.team(c))) bad.push([pl.id, x.role, "clubs", x.clubs]);
        const logClubs = []; M.log(pl.id, x.role).forEach((g) => { if (logClubs.indexOf(g.club) < 0) logClubs.push(g.club); });
        if (logClubs.length && JSON.stringify(logClubs) !== JSON.stringify(x.clubs)) bad.push([pl.id, x.role, "club order", x.clubs, logClubs]);
      });
    });
    const two = M.players.filter((pl) => pl.roles.length === 2), none = M.players.filter((pl) => !pl.roles.length);
    const moved = M.players.filter((pl) => M.career(pl.id).some((x) => x.clubs.length > 1));
    const former = M.players.filter((pl) => pl.roles.length && !pl.rostered);
    /* v5.00 swap (e7): the goaltender is the model's busiest one, never a name written here (the repo is public) */
    const goalie = M.players.filter((pl) => pl.roles.length === 1 && pl.mainRole === "G").sort((a, b) => b.lines.G.gp - a.lines.G.gp)[0];
    /* ids, never gamertags: a failure line must not print a member's name (the repo is public) */
    return { bad: bad.slice(0, 5), nBad: bad.length, n: M.players.length, two: two.map((x) => x.id).slice(0, 3), none: none.map((x) => x.id).slice(0, 3),
      moved: moved.map((x) => x.id).slice(0, 3), former: former.map((x) => x.id).slice(0, 3), unknown: M.career("nobody-at-all").length, goalie: goalie && goalie.id, leader: M.examples.pointsLeader, season: M.view.season,
      /* QA round 2: the recording holds Season 1's games alone, so nobody has a game in another season: M.careerEarlier
         counts the season's games as career_games_played does (distinct, final, every stage), two-role players included */
      away: M.players.filter((pl) => M.careerEarlier(pl.id) > 0).map((pl) => [pl.id, pl.roles.join(""), M.careerEarlier(pl.id)]).slice(0, 5),
      careerN: Object.keys(M.careerGames).length };
  });
  A("on Season 1 (the recording's only season with games) nobody has games in another season, two-role and playoff players included", r.careerN > 0 && r.away.length === 0, { careerN: r.careerN, away: r.away });
  A("Season 1 is on screen (?season=1, read live)", r.season === 1, r.season);
  A("every player's regular-season career rows are their season lines, playoff rows their playoff lines, clubs in the order first played (" + r.n + " players)", r.nBad === 0, r.bad);
  A("an unknown player has no career, and no error", r.unknown === 0);
  A("the recording has a two-role player, a player with no games, a player who played for two clubs and one on no roster to check", r.two.length && r.none.length && r.moved.length && r.former.length,
    { two: r.two.length, none: r.none.length, moved: r.moved.length, former: r.former.length });
  A("the model names the points leader and a goaltender to open", !!r.leader && !!r.goalie, { leader: !!r.leader, goalie: !!r.goalie });
  const cases = r;
  await done(p);

  console.log("## the section on the profile");
  /* a bare #/player opens the season's points leader (M.examples.pointsLeader, v5.00 swap: it was a member named by hand) */
  p = await page("#/player");
  r = await p.evaluate((id) => ({ pid: (document.getElementById("pfRoot") || { dataset: {} }).dataset.pid, want: id }), cases.leader);
  A("a bare #/player opens the points leader", r.pid && r.pid === r.want, r);
  r = await p.evaluate(read);
  A("a skater: Career sits after the game log and before honors and clubs", r && JSON.stringify(r.order.slice(-3)) === JSON.stringify(["pfLogH", "pfCarH", "pfTail"]), r && r.order);
  A("the headline counts seasons and games; the copy says every season, on a roster or not", r && /^One season, \d+ games/.test(r.h) && /whether or not they are on a roster now/.test(r.p), r);
  const lead = await p.evaluate(() => { const M = S2.M, pl = M.player(M.examples.pointsLeader), rows = M.career(pl.id).filter((x) => x.role === pl.mainRole), clubs = [];
    M.career(pl.id).forEach((x) => x.clubs.forEach((c) => { if (clubs.indexOf(c) < 0) clubs.push(c); }));
    const roles = M.career(pl.id).map((x) => x.role).filter((x, i, a) => a.indexOf(x) === i).length;
    return { n: rows.length, roles: roles, club: rows[0].clubs[0], po: rows.some((x) => x.stage === "po"), one: clubs.length === 1 ? M.team(clubs[0]).city : null }; });
  A("a table per role played (the main role first): the season and its kind of game, the club and the line; headings are labels, not sort controls", r && r.tables.length === lead.roles && JSON.stringify(r.tables[0].head) === JSON.stringify(["Season", "Club", "GP", "G", "A", "P", "+/-", "PIM", "SOG"]) &&
    r.tables[0].buttons === 0 && r.tables[0].rows.length === lead.n && r.tables[0].rows[0][0] === "Season 1 · Regular season" && r.tables[0].rows[0][1] === lead.club &&
    (!lead.po || r.tables[0].rows[1][0] === "Season 1 · Playoffs"), r && { n: r.tables.length, head: r.tables[0] && r.tables[0].head, buttons: r.tables[0] && r.tables[0].buttons, rows: r.tables[0] && r.tables[0].rows.map((x) => x[0] + " " + x[1]), lead });
  A("the headline says where the games were played", r && /^One season, \d+ games/.test(r.h) && (lead.one ? r.h.endsWith(" for " + lead.one + ".") : / for \w+ clubs\.$/.test(r.h)), r && r.h);
  const sline = await p.evaluate(() => { const L = S2.M.player(S2.M.examples.pointsLeader).lines.S; return [L.gp, L.g, L.a, L.p].map(String); });
  A("the row is the season line", r && JSON.stringify(r.tables[0].rows[0].slice(2, 6)) === JSON.stringify(sline), { row: r && r.tables[0].rows[0], sline });
  A("the club opens the club page", r && r.links[0] === "#/club/" + lead.club, r && r.links[0]);
  /* the house rules (BRIEF.md): answered on pointer-down, 44px targets, the headline's number in bold, headings over their columns */
  r = await p.evaluate(() => { const t = document.querySelector(".pf-car"), a = t.querySelector("a.pf-car-club"), lead = t.querySelector("td.lead");
    const box = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const b = rg.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; };
    const hs = [...t.querySelectorAll("thead th")], cs = [...t.querySelector("tbody tr").children];
    const off = hs.map((h, i) => { const x = box(h), y = box(cs[i]); return i < 2 ? x[0] - y[0] : x[1] - y[1]; });
    a.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); const down = a.classList.contains("is-down"); a.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    return { press: a.classList.contains("pf-press"), down, h: Math.round(a.getBoundingClientRect().height), lead: lead && lead.previousElementSibling && getComputedStyle(lead).fontWeight, leadIdx: [...lead.parentNode.children].indexOf(lead), off }; });
  A("a club answers on pointer-down (.pf-press) and is a 44px target", r.press && r.down && r.h >= 44, r);
  A("the points column is set in bold", r.leadIdx === 5 && +r.lead >= 700, r);
  A("every heading sits over its column (text columns by their left edge, numbers by their right)", r.off.every((x) => Math.abs(x) <= 1), r.off);
  await done(p);

  p = await page("#/player/" + encodeURIComponent(cases.goalie));
  r = await p.evaluate(read);
  A("a goaltender: the goalie columns", r && r.tables.length === 1 && JSON.stringify(r.tables[0].head) === JSON.stringify(["Season", "Club", "GP", "W", "L", "OTL", "SV%", "GAA", "SO"]) && /^\.\d{3}$/.test(r.tables[0].rows[0][6]), r && r.tables.map((t) => t.head));
  await done(p);

  p = await page("#/player/" + encodeURIComponent(cases.two[0]));
  r = await p.evaluate(read);
  const main = await p.evaluate((t) => S2.M.player(t).mainRole, cases.two[0]);
  A("a two-role player: both tables, the main role first, each named", r && r.tables.length === 2 && r.roles.length === 2 &&
    r.roles[0] === (main === "G" ? "In goal" : "As a skater") && /in goal|as a skater/.test(r.tables[0].label), r && { roles: r.roles, main });
  /* the line switch repaints the body; the career is the same whichever line is on screen */
  const before = JSON.stringify(r.tables);
  const sw = await p.evaluate(() => { const on = document.querySelector('[data-seg="role"] [aria-pressed="true"]'), off = document.querySelector('[data-seg="role"] [aria-pressed="false"]');
    if (!on || !off) return null; const from = on.dataset.v; off.click(); return from; });
  await p.waitForTimeout(700);
  const now = await p.evaluate(() => (document.querySelector('[data-seg="role"] [aria-pressed="true"]') || {}).dataset.v);
  r = await p.evaluate(read);
  A("switching the season line (it did switch) leaves the career whole", sw && now && now !== sw && r && JSON.stringify(r.tables) === before, { sw, now, n: r && r.tables.length });
  await done(p);

  p = await page("#/player/" + encodeURIComponent(cases.former[0]));
  r = await p.evaluate(read);
  A("a player on no roster keeps their career", r && r.tables.length >= 1 && r.tables[0].rows.length >= 1, r && r.tables.length);
  await done(p);

  p = await page("#/player/" + encodeURIComponent(cases.none[0]));
  r = await p.evaluate(read);
  A("a player with no league games: the section says so, with no empty table", r && r.h === "No league games yet." && r.tables.length === 0 && r.p === "Every season they play will be listed here.", r);
  await done(p);

  p = await page("#/player/" + encodeURIComponent(cases.moved[0]));
  r = await p.evaluate(read);
  A("a player who played for two clubs: both clubs on the row, in the order first played", r && r.links.length >= 2 && /for two clubs\.$/.test(r.h), r && { h: r.h, links: r.links });
  await done(p);

  /* QA round 2 (2026-11-25, QA functional): on Season 2, before its first game, a Season 1 veteran's page read "No league
     games yet" beside a rating earned in Season 1. The hero and Career count the Season 1 games (M.careerEarlier) and
     Career links the player's Season 1 page (S2.seasonHref) */
  console.log("## a Season 1 veteran on Season 2");
  p = await page("#/today", null, S2_BASE);
  const vet = await p.evaluate(() => { const M = S2.M, v = M.players.filter((pl) => !pl.mainRole && M.careerGames[pl.id] > 0)[0];
    return v ? { id: v.id, n: M.careerGames[v.id], away: M.careerEarlier(v.id), season: M.view.season, name: M.view.name } : { season: M.view.season }; });
  A("Season 2 is on screen, and a member with no Season 2 games has Season 1 games (all of them in another season)", vet.season === 2 && vet.id && vet.away === vet.n, { season: vet.season, found: !!vet.id, n: vet.n, away: vet.away });
  await done(p);
  if (vet.id) {
    p = await page("#/player/" + encodeURIComponent(vet.id), null, S2_BASE);
    r = await p.evaluate(read);
    const hero = await p.evaluate(() => (document.querySelector("#pfHero .pfx-lede") || {}).textContent || "");
    const side = await p.evaluate(() => [...document.querySelectorAll('[aria-labelledby="pfCarH"] .sec-head > a.arrow')].map((a) => [a.getAttribute("href"), a.textContent.trim()]));
    const g = vet.n === 1 ? "1 game" : vet.n + " games";
    A("the hero says the games in Season 1 beside no Season 2 games yet", hero.indexOf("No Season 2 games yet, " + g + " in Season 1.") === 0, hero);
    A("Career counts them, none in Season 2 yet, never \"No league games yet\"", r && r.h === g + " in Season 1, none in Season 2 yet." && r.tables.length === 0 && /on that season's page\.$/.test(r.p), r && { h: r.h, p: r.p });
    A("Career links the player's Season 1 page (?season=1, the same player)", side.length === 1 && side[0][0] === "?season=1#/player/" + vet.id && side[0][1] === "Season 1 career", side);
    await done(p);
  }

  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    await mock.install(ctx, Object.assign({ live: true, persona: "anon" }, READS));
    const q = await ctx.newPage(); await q.goto(BASE + "#/player"); await q.waitForSelector(".pf-car a.pf-car-club", { timeout: 30000 });
    /* QA round 2 (2026-11-25): rewritten to read the scale property, where the press is now (it read transform, which a
       press no longer sets, so it would pass whatever Reduce Motion did) */
    r = await q.evaluate(() => { const a = document.querySelector(".pf-car a.pf-car-club"); a.classList.add("is-down"); const c = getComputedStyle(a), t = { scale: c.scale, transform: c.transform }; a.classList.remove("is-down"); return t; });
    A("reduced motion: a pressed club does not scale", r.scale === "none" && r.transform === "none", r);
    await ctx.close();
  }
  /* QA round 2 (A7, 2026-11-25): the profile's race places come from the model's one read of the title race (live they were
     missing: s2_league carries no race). Season 1 made a season in progress (active, its filed titles taken off), and a
     board that puts the points leader 2nd in the Scoring Title race: the player page's season sentence and Honors, and the
     club page's History, show the place once the read lands, in place; one read serves both pages */
  const S1B = JSON.parse(require("fs").readFileSync(require("path").join(require("os").homedir(), "Developer/cghl-private/fixtures/s2_league-anon-2026-11-24b-season1.json"), "utf8"));
  const racing = () => { const x = JSON.parse(JSON.stringify(S1B)); x.seasons.forEach((s) => { if (+s.number === 1) s.status = "active"; }); x.honors = x.honors.filter((h) => !/_title$/.test(h.category)); return x; };
  const board = [{ category: "points_title", place: 1, profile_id: cases.goalie, gamertag: null, gp: 30, total: 75, per_game: 2.5 },
    { category: "points_title", place: 2, profile_id: cases.leader, gamertag: null, gp: 30, total: 60, per_game: 2 }];
  console.log("## the title race on the profile and the club page");
  {
    const seen = [];
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    await mock.install(ctx, { live: true, persona: "anon", tables: READS.tables, rpcs: Object.assign({}, READS.rpcs, { s2_league: (a) => mock.ok(+a.p_season === 1 ? racing() : mock.league(a)),
      statistical_title_board: (a) => { seen.push(a); return mock.ok(board); } }) });
    const q = await ctx.newPage();
    q.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await q.goto(S2_BASE + "?season=1#/player/" + cases.leader);
    /* QA round 2 review: the race now lands after the page's entrance (the section below), so this waits for a race row,
       not for Honors (the player's other honors draw it at once, and a fixed 300 ms after that pinned the mid-entrance repaint) */
    await q.waitForFunction(() => [...document.querySelectorAll("#pfTail .pfx-hon b")].some((x) => / race$/.test(x.textContent)), null, { timeout: 30000 }).catch(() => {});
    await q.waitForTimeout(300);
    r = await q.evaluate(() => { const rows = [...document.querySelectorAll("#pfTail .pfx-hon li")].map((li) => [li.querySelector(".pfx-hon-n").textContent, li.querySelector("b").textContent]).filter((x) => / race$/.test(x[1]));
      const sent = (document.querySelector('[aria-labelledby="pfSeasonH"] .copy p') || {}).textContent || "", ab = [...document.querySelectorAll("#pfRoot > details.about")].pop();
      return { filed: S2.M.filedTitles(1).length, rows, sent: / 2nd in the Scoring Title race,/.test(sent), about: !!ab && /Statistical titles go to the best rate per game/.test(ab.textContent) && !ab.classList.contains("reveal") }; });
    A("a player's race place lands in place: Honors reads 2nd in the Scoring Title race, the season sentence says it, the about gives the race rule", r.filed === 0 && JSON.stringify(r.rows) === JSON.stringify([["2nd", "Scoring Title race"]]) && r.sent && r.about, r);
    /* QA round 2 review (nit): every rate to two decimals (audit 2026-11-09), as the club History row and Stats; it read 2.000 */
    r = await q.evaluate(() => [...document.querySelectorAll("#pfTail .pfx-hon li")].filter((li) => / race$/.test(li.querySelector("b").textContent)).map((li) => li.querySelector(".grow > span").textContent));
    A("the race row's rate has two decimals: 2.00 a game over 30 games", JSON.stringify(r) === JSON.stringify(["2.00 a game over 30 games"]), r);
    const club = await q.evaluate((id) => S2.M.player(id).club, cases.leader);
    await q.evaluate((c) => { location.hash = "#/club/" + c + "?tab=history"; }, club); await q.waitForTimeout(600);
    r = await q.evaluate((id) => { const col = (document.getElementById("pfcHonH") || { closest: () => null }).closest(".pfx-col");
      /* the player's Player of the Week rows link the same page, so the race row is the one that names a race */
      const a = col && [...col.querySelectorAll('a[href="#/player/' + id + '"]')].filter((x) => / race, /.test(x.querySelector(".grow > span").textContent))[0];
      return { row: !!a && /^Scoring Title race, 2\.00 per game$/.test(a.querySelector(".grow > span").textContent) && a.querySelector(".pfx-hon-n").textContent === "2nd" }; }, cases.leader);
    A("the club page's History lists its player's race place, and one read of the board served both pages", r.row && seen.length === 1, { row: r.row, reads: seen.length });
    await ctx.close();
  }

  /* QA round 2 review (2026-11-25): a race read that lands while the page is still entering (200 ms in; the reveals and
     the bars run about 700) waits for the entrance to end, and only what tells the race repaints: on the player page the
     season sentence's copy, Honors (#pfTail) and the about, never #pfBody; on the club page History's Honors column
     (#pfcHon), never the panel. So no running entrance is cut, and a link focused in Honors keeps focus. A complete season
     (Season 1 as recorded, its titles filed, the race hidden) reads no board and repaints nothing. Every repaint of those
     regions is logged with the entrance still under way at that moment: finite animations running, reveals not shown */
  console.log("## the race repaint waits for the entrance and touches only the race");
  {
    const swapLog = () => {
      const d = Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML"); window.__swaps = [];
      Object.defineProperty(Element.prototype, "outerHTML", { configurable: true, get: d.get, set: function (v) {
        const id = this.id || (this.matches && this.matches("#pfRoot > details.about") ? "about" : "");
        if (/^(pfBody|pfTail|pfSeasonHd|pfcPanel|pfcHon|about)$/.test(id)) {
          const root = document.getElementById("pfRoot") || document.getElementById("pfcRoot") || document.body;
          window.__swaps.push({ id, run: root.getAnimations({ subtree: true }).filter((a) => { const t = a.effect && a.effect.getComputedTiming(); return a.playState === "running" && t && isFinite(t.endTime); }).length,
            unshown: root.querySelectorAll(".reveal:not(.in)").length });
        }
        d.set.call(this, v);
      } });
    };
    const open = async (hash, rpcs) => {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
      await ctx.addInitScript(swapLog);
      await mock.install(ctx, { live: true, persona: "anon", tables: READS.tables, rpcs: Object.assign({}, READS.rpcs, rpcs) });
      const q = await ctx.newPage();
      q.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await q.goto(S2_BASE + "?season=1" + hash);
      return q;
    };
    const later = (ms, v) => new Promise((res) => setTimeout(() => res(v), ms));
    const racingLeague = (a) => mock.ok(+a.p_season === 1 ? racing() : mock.league(a));
    let seen = [];
    /* the player page, the board answering 200 ms after it is asked */
    let q = await open("#/player/" + cases.leader, { s2_league: racingLeague, statistical_title_board: async (a) => { seen.push(a); return later(200, mock.ok(board)); } });
    await q.waitForFunction(() => [...document.querySelectorAll("#pfTail .pfx-hon b")].some((x) => / race$/.test(x.textContent)), null, { timeout: 15000 }).catch(() => {});
    await q.waitForTimeout(200);
    r = await q.evaluate(() => ({ swaps: window.__swaps, race: [...document.querySelectorAll("#pfTail .pfx-hon b")].some((x) => / race$/.test(x.textContent)) }));
    A("a race landing 200 ms into the player page repaints after the entrance: no animation running and no reveal unshown at any repaint", seen.length === 1 && r.race && r.swaps.length > 0 && r.swaps.every((x) => x.run === 0 && x.unshown === 0), r);
    A("the race repaints the season sentence, Honors and the about, never the whole body", r.swaps.some((x) => x.id === "pfTail") && r.swaps.some((x) => x.id === "pfSeasonHd") && r.swaps.some((x) => x.id === "about") && !r.swaps.some((x) => x.id === "pfBody"), r.swaps.map((x) => x.id));
    const club = await q.evaluate((id) => S2.M.player(id).club, cases.leader);
    await q.context().close();
    /* a link focused in Honors or a club stint keeps focus when the race lands: the board waits until the reader has focused it */
    let release; const gate = new Promise((res) => { release = res; });
    q = await open("#/player/" + cases.leader, { s2_league: racingLeague, statistical_title_board: async () => { await gate; return mock.ok(board); } });
    await q.waitForSelector("#pfTail a[href]", { timeout: 30000 }).catch(() => {}); await q.waitForTimeout(900);
    const href = await q.evaluate(() => { const a = [...document.querySelectorAll("#pfTail a[href]")].pop(); if (!a) return null; a.focus(); return a.getAttribute("href"); });
    release();
    await q.waitForFunction(() => window.__swaps.some((x) => x.id === "pfTail"), null, { timeout: 10000 }).catch(() => {});
    r = await q.evaluate(() => { const f = document.activeElement; return { swapped: window.__swaps.some((x) => x.id === "pfTail"), inTail: !!f.closest("#pfTail"), href: f.getAttribute("href") }; });
    A("a link focused in Honors or a club stint keeps focus when the race repaints them", !!href && r.swapped && r.inTail && r.href === href, Object.assign(r, { want: href }));
    await q.context().close();
    /* the club page with History open, the board 200 ms late */
    q = await open("#/club/" + club + "?tab=history", { s2_league: racingLeague, statistical_title_board: async () => later(200, mock.ok(board)) });
    await q.waitForFunction(() => [...document.querySelectorAll("#pfcHon a")].some((x) => / race, /.test(x.textContent)), null, { timeout: 15000 }).catch(() => {});
    await q.waitForTimeout(200);
    r = await q.evaluate(() => ({ swaps: window.__swaps, race: [...document.querySelectorAll("#pfcHon a")].some((x) => / race, /.test(x.textContent)) }));
    A("the club page's History repaints its Honors column alone when the race lands, after the entrance", !!club && r.race && r.swaps.length > 0 && r.swaps.every((x) => x.id === "pfcHon" && x.run === 0 && x.unshown === 0), Object.assign(r, { club }));
    await q.context().close();
    /* a complete season: Season 1 as recorded, its titles filed, the race hidden everywhere */
    seen = [];
    q = await open("#/player/" + cases.leader, { statistical_title_board: async (a) => { seen.push(a); return later(250, mock.ok(board)); } });
    await q.waitForSelector("#pfBody", { timeout: 30000 }).catch(() => {}); await q.waitForTimeout(1500);
    r = await q.evaluate(() => ({ filed: S2.M.filedTitles(1).length, swaps: window.__swaps.map((x) => x.id) }));
    A("a complete season (its titles filed, the race hidden) reads no board and repaints nothing", r.filed > 0 && r.swaps.length === 0 && seen.length === 0, Object.assign(r, { reads: seen.length }));
    await q.context().close();
  }

  /* QA round 2 (2026-11-25): the rank bars grow inside the page's half second (480 ms, the stagger stopping at the eighth
     bar, 8 x 24 ms), and a repaint (a sort) settles through core's one S2.settle, never a copy of it */
  console.log("## the bars' entrance and the repaint's settle");
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ }
      const orig = Element.prototype.animate; window.__grow = [];
      Element.prototype.animate = function (k, o) { if (this.hasAttribute && this.hasAttribute("data-grow") && o && typeof o === "object") window.__grow.push({ d: o.duration, delay: o.delay || 0 }); return orig.apply(this, arguments); };
    });
    await mock.install(ctx, Object.assign({ live: true, persona: "anon" }, READS));
    const q = await ctx.newPage();
    q.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await q.goto(BASE + "#/player"); await q.waitForSelector("#pfBody [data-grow]", { timeout: 30000 }); await q.waitForTimeout(300);
    r = await q.evaluate(() => ({ n: window.__grow.length, d: Math.max.apply(null, window.__grow.map((x) => x.d)), delay: Math.max.apply(null, window.__grow.map((x) => x.delay)) }));
    A("the rank bars grow in 480 ms, the stagger capped at 8 x 24 ms (" + r.n + " bars)", r.n > 8 && r.d === 480 && r.delay === 192, r);
    r = await q.evaluate(() => {
      let n = 0; const s = S2.settle; S2.settle = function () { n++; return s.apply(this, arguments); };
      /* the Form chart's stat switch: a state change, repainted in place (a quiet swap) */
      const h = document.querySelector('#pfBody [data-seg="stat"] [aria-pressed="false"]'); if (!h) { S2.settle = s; return "no Form stat switch"; } h.click(); S2.settle = s; return n;
    });
    A("a Form stat switch repaints in place through S2.settle (core's one), not a copy of it", r >= 1, r);
    await ctx.close();
  }
  for (const w of [320, 375, 430]) {
    p = await page("#/player", w);
    r = await p.evaluate(() => { const s = document.querySelector('[aria-labelledby="pfCarH"]'); s.scrollIntoView(); const t = s.querySelector("table").getBoundingClientRect();
      return { over: document.documentElement.scrollWidth - innerWidth, wrap: s.querySelector(".tbl-wrap").scrollWidth >= s.querySelector(".tbl-wrap").clientWidth, top: t.top }; });
    A(w + " px: no sideways scroll on the page (the table scrolls inside its own wrap)", r.over <= 0, r);
    await done(p);
  }

  /* review 2026-11-25: the profile's claim door on the real path (hq-market pinned it on the demo's moves). A Season 2
     player on waivers from another club: the GM's claim goes through Team HQ's one door (S2.claimDoor) to market_claim,
     never the Owner's queue; once the database confirms, the market's own read
     (its "load" event, the only one the profile follows now) repaints the hero in place with the claim gone. The roster
     re-read itself is js/live.js's (the write mock resolves without one; tools/ui/live.test.cjs pins it) */
  console.log("## the profile's claim, read live (Season 2)");
  {
    const cur = mock.league({}), gm = mock.liveSessionOf("gm"), mineT = cur.teams.filter((t) => t.id === gm.teamId)[0], from = cur.teams.filter((t) => t.id !== gm.teamId)[0];
    const pid = cur.people.filter((x) => x.id !== gm.profileId && !(cur.rosters.spots || []).some((s) => s.profile_id === x.id))[0].id;
    const sid = cur.seasons.filter((x) => x.number === cur.season)[0].id, at = (ms) => new Date(Date.now() + ms).toISOString();
    const wv = { id: "00000000-0000-4000-8000-000000000701", season_id: sid, profile_id: pid, from_team_id: from.id, position: "C", salary: 1000000, waived_at: at(-3600e3), expires_at: at(20 * 3600e3), status: "open", claimed_team_id: null, claimed_at: null, cleared_at: null };
    const cs = { team_id: mineT.id, season_id: sid, counts: { F: 0, D: 0, G: 0 }, active: 0, limit: 12, mins: { F: 3, D: 2, G: 1 }, cap: 30000000, payroll: 0, room: 30000000, spots: 12, owed: 0, draft_done: true, moves_locked: false, leading: [], committed: 0, free_spots: 12, free_room: 30000000 };
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    await mock.install(ctx, { live: true, persona: "gm",
      tables: Object.assign({}, READS.tables, { market_waivers: () => [wv] }),
      rpcs: Object.assign({}, READS.rpcs, { market_club_state: mock.ok(cs) }),
      writes: { market_claim: (a) => { wv.status = "claimed"; wv.claimed_team_id = a.p_team; wv.claimed_at = at(0); return mock.ok({ ok: true }); } } });
    p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(S2_BASE + "#/player/" + pid);
    await p.waitForFunction(() => window.S2 && S2.M && S2.LIVE && S2.auth && S2.auth.sub && document.querySelector('#pfHero [data-act="claim"]'), null, { timeout: 30000 });
    r = await p.evaluate(() => { window.__pg = document.querySelector("#page > *"); return /On waivers until/.test(document.getElementById("pfHero").textContent); });
    A("a waived player's page says On waivers until and offers Claim off waivers (the market read live)", r);
    await p.click('#pfHero [data-act="claim"]'); await p.waitForSelector('.sheet [data-x="claim"]', { timeout: 5000 });
    await p.click('.sheet [data-x="claim"]');
    await p.waitForFunction(() => !document.querySelector('#pfHero [data-act="claim"]'), null, { timeout: 10000 }).catch(() => {});
    const c = mock.calls(ctx).filter((x) => x.rpc === "market_claim");
    r = await p.evaluate(() => ({ door: !!document.querySelector('#pfHero [data-act="claim"]'), same: document.querySelector("#page > *") === window.__pg,
      toast: [...document.querySelectorAll(".toast")].some((t) => /is claimed for the .+ at \$1/.test(t.textContent)) }));
    A("the claim is market_claim with the waiver and the GM's club, never through the Owner's queue", c.length === 1 && c[0].args.p_waiver === wv.id && c[0].args.p_team === mineT.id && c[0].approval === null, c.map((x) => [x.rpc, x.approval]));
    A("once the database confirms, the hero repaints in place: no claim door, the toast, same page", !r.door && r.same && r.toast, r);
    await done(p);
  }

  A("no console errors on any page", errors.length === 0, errors.slice(0, 5));
  A("every read the pages made was answered (nothing unexpected reached the fence)", unexpected.length === 0, unexpected.slice(0, 5));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL threw: " + (e && e.stack || e)); process.exit(1); });
