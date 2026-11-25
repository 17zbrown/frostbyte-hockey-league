const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
const S2_ROOT = process.env.S2_ROOT || (() => { throw new Error("S2_ROOT unset: run through tools/ui/run.cjs") })();
/* Season 1's trophies and awards: node tools/ui/run.cjs awards (needs the s2-concept server on S2_BASE (tools/ui/run.cjs)).
   Commissioner, 2026-11-21: "In the concept site, can you add team awards for winning the Presidents' Trophy, Stanley Cup
   trophy, and any other stat based awards that are handed out in real life? Can you add awards to players who won the
   stanley cup and any other stat awards. Make sure everything is built in with purpose on the site so nothing looks out of
   place or bolted on." Rulings that day: the NHL's stat trophies sit beside the league's titles, counted the NHL's way
   (season totals); the Cup goes to everyone "On Boston's roster at the final". The data is real (model.js SEASON_CLOSE,
   read 2026-11-21 from the live Season 1 archive).
   v5.00 swap (i3b, 2026-11-25): the suite runs the REAL site (stream h0's live mode, tools/ui/mock/index.cjs) on the
   recorded production s2_league, Season 1 on screen (?season=1): the trophies, titles and Players of the Week are the
   league's records, and a figure counted from box scores (a season line, the Three Stars, "through" a date) is worked out
   from the model, since the whole season is read now where the Oct 19 snapshot stopped. The pickup and market reads a
   profile makes are answered empty. Reads only; nothing reaches production. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const BASE = S2_BASE + "?season=1";
const READS = { tables: { pickup_stats: [], market_waivers: [], market_pool_requests: [], market_boards: [], market_bid_nights: [], market_lots: [], market_bids: [] },
  rpcs: { market_calendar: mock.ok({}), market_pool: mock.ok([]), market_club_state: mock.ok(null) } };
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)).slice(0, 500) + ")")); if (!cond) fails++; };
/* v5.00 swap (e6, privacy): no member is named in a committed file (COMMON.md). The members these checks follow are held by
   id, each by the part they play, and their gamertags are read from the league read itself (T, filled on the first page) */
const ID = { scorer: "77331d2c-f61c-4d15-99b1-c63c82a86513", playmaker: "01018fa5-8240-481a-9e98-e5b44f5c9712", jennings: "f382bbac-8cc8-47cb-94e0-fa15bbd26227",
  goalieTitle: "4b326dee-ab07-4123-a4f7-381e89e5abf2", cupOnly: "716136ec-98e2-4fd1-8149-599437ad1795", cupOnly2: "a74c14c5-3451-43eb-b36d-9c2b205a31a1",
  potwOnly: "78a5f844-adfe-468a-8dea-2a816dbadf04", firstOnCup: "89330ea4-aea6-4e5c-8b13-618256a68b00", bosW6: "e26a156c-d761-4ba0-83d9-25e9600ee694", bosW5d: "7f730171-0b6e-486d-8a8e-db80b211dae6" };
let T = null;
const CUP = ["eefd9d4e-cd51-4747-8251-90244e1d9379", "a367a693-c97b-4d8d-98fa-45fa9735dbe5", "74264f3c-a566-4c17-9d31-91fc2a90e66a", "48c572a7-2857-42fd-9963-7a5df708c665",
  "99ed0734-b668-4789-a07b-3e2abf53aebb", "dbb0fe9f-53c6-4ce4-8556-4f8a0032f909", "6dc4dc32-8501-4771-9494-07221d5d6ac3", "a74c14c5-3451-43eb-b36d-9c2b205a31a1",
  "a3d624fe-4d5f-4af5-acda-4348bcf58df0", "57b9d472-7e56-4fe7-baae-f4dd480ef1b5", "7f730171-0b6e-486d-8a8e-db80b211dae6", "716136ec-98e2-4fd1-8149-599437ad1795",
  "e26a156c-d761-4ba0-83d9-25e9600ee694", "7fc93ed9-e7ea-42ca-8c58-524c4aa362ef", "a57f3fde-7234-460e-bb70-3b3d802d607b", "fa254491-aa9e-4fde-b66f-650f58d1e1cf",
  "4ba09a6e-752a-453f-80cc-861b65d5e571", "01018fa5-8240-481a-9e98-e5b44f5c9712", "89330ea4-aea6-4e5c-8b13-618256a68b00", "333968e1-1db7-4910-9f2e-61e222de2ff4"];

(async () => {
  const b = await chromium.launch();
  const errors = [];
  async function page(hash, width, opts) {
    const o = opts || {};
    const ctx = await b.newContext(Object.assign(width ? { viewport: { width, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } },
      o.dark ? { colorScheme: "dark" } : {}, o.reduce ? { reducedMotion: "reduce" } : {}));
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked: the page still renders */ } });
    await mock.install(ctx, Object.assign({ live: true, persona: "anon" }, READS));
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto(BASE + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2.LIVE && S2.auth && S2.auth.sub && document.querySelector("#app section, #app header"), null, { timeout: 30000 });
    await p.waitForTimeout(350);
    return p;
  }
  const unexpected = [];
  const done = (p) => { unexpected.push(...mock.unexpected(p.context())); return p.context().close(); };
  /* the last final on screen, as a page says it ("Nov 20"): a profile's line runs through it (profile.js thru) */
  const lastFinal = () => { const f = S2.M.games.filter((g) => g.isFinal).map((g) => g.at).sort(); return S2.M.etMonthDay(f[f.length - 1]); };
  let p, r;

  console.log("## the model: Season 1's trophies, its final table, the names on the Cup");
  p = await page("#/today");
  T = await p.evaluate((id) => { const o = {}; Object.keys(id).forEach((k) => { const pl = S2.M.player(id[k]); o[k] = pl ? pl.tag : null; }); return o; }, ID);
  A("every member the checks follow is in the league read (Season 1)", Object.keys(T).every((k) => !!T[k]), Object.keys(T).filter((k) => !T[k]));
  r = await p.evaluate(([cup, id]) => {
    const M = S2.M, tr = M.trophies(1), close = M.seasonClose(1);
    const holders = M.players.filter((pl) => pl.honors.some((h) => h.kind === "trophy" || h.kind === "title"));
    const cupIds = M.players.filter((pl) => pl.honors.some((h) => h.key === "stanley_cup")).map((pl) => pl.id).sort();
    const keys = (tag) => (M.player(tag) || { honors: [] }).honors.filter((h) => h.kind === "trophy" || h.kind === "title").sort((a, b) => M.honorRank(a) - M.honorRank(b)).map((h) => h.key || h.category);
    const minGA = Math.min.apply(null, close.table.map((x) => x.ga)), maxPts = Math.max.apply(null, close.table.map((x) => x.pts));
    return {
      tr: tr.map((x) => [x.key, x.name, x.team, x.club, x.tag || null, x.total == null ? null : x.total, x.gp == null ? null : x.gp, x.href]),
      over: tr.filter((x) => x.over).map((x) => [x.key, x.over]), noNext: tr.every((x) => !("next" in x)),
      cupOk: JSON.stringify(cupIds) === JSON.stringify(cup.slice().sort()), nCup: cupIds.length,
      rosterBos: cup.every((id) => (M.player(id) || {}).club === "BOS"),
      holders: holders.map((pl) => pl.id).filter((x) => cup.indexOf(x) < 0).sort(),
      scz: keys(id.scorer), play: keys(id.playmaker), smk: keys(id.jennings), gun: keys(id.goalieTitle), dark: keys(id.cupOnly),
      table: close.table.map((x) => [x.club, x.w + "-" + x.l + "-" + x.otl, x.pts, x.divRank, x.out]),
      presidents: tr.filter((x) => x.key === "presidents_trophy")[0].club === close.table.filter((x) => x.pts === maxPts)[0].club,
      jenningsClub: close.table.filter((x) => x.ga === minGA)[0].club, jenningsTotal: tr.filter((x) => x.key === "jennings")[0].total === minGA,
      champ: M.offseasonDemo().champion, none2: M.trophies(2).length === 0 && M.seasonClose(2) === null,
      ptsWins: close.table.reduce((a, x) => a + x.w, 0) === close.table.reduce((a, x) => a + x.l + x.otl, 0),
      rank: ["potw", "title_race"].map((k) => M.honorRank({ kind: k, week: 4, place: 1 })).concat([M.honorRank({ key: "stanley_cup" }), M.honorRank({ category: "goaltending_title" })])
    };
  }, [CUP, ID]);
  A("seven trophies in honor order: the Cup, the three team trophies, then the NHL's three by the numbers", JSON.stringify(r.tr) === JSON.stringify([
    ["stanley_cup", "Stanley Cup", true, "BOS", null, null, null, "#/club/BOS"], ["presidents_trophy", "Presidents' Trophy", true, "VAN", null, null, null, "#/club/VAN"],
    ["wales_trophy", "Prince of Wales Trophy", true, "BOS", null, null, null, "#/club/BOS"], ["campbell_bowl", "Clarence S. Campbell Bowl", true, "VAN", null, null, null, "#/club/VAN"],
    ["art_ross", "Art Ross Trophy", false, "VAN", T.scorer, 172, 35, "#/player/" + ID.scorer],
    ["rocket_richard", "Maurice \"Rocket\" Richard Trophy", false, "VAN", T.scorer, 102, 35, "#/player/" + ID.scorer],
    ["jennings", "William M. Jennings Trophy", false, "SEA", T.jennings, 150, 17, "#/player/" + ID.jennings]]), r.tr);
  A("no trophy carries a runner-up (commissioner, 2026-11-23)", r.noNext, r.noNext);
  A("the Cup over Vancouver, the East over New York, the West over Seattle", JSON.stringify(r.over) === JSON.stringify([["stanley_cup", "VAN"], ["wales_trophy", "NYI"], ["campbell_bowl", "SEA"]]), r.over);
  A("the Cup's champion is the off-season scene's champion (one fact, S1_FINAL)", r.champ === "BOS", r.champ);
  A("the Cup is on all twenty on Boston's roster at the final, and on nobody else", r.cupOk && r.nCup === 20 && r.rosterBos, r);
  A("the only other award holders are the trophy and title winners", JSON.stringify(r.holders) === JSON.stringify([ID.scorer, ID.jennings, ID.goalieTitle].sort()), r.holders);
  A("the scoring champion: Art Ross, Rocket Richard, then the Scoring and Goal-scoring Titles", JSON.stringify(r.scz) === JSON.stringify(["art_ross", "rocket_richard", "points_title", "goals_title"]), r.scz);
  A("the playmaker: the Cup, then the Playmaking Title", JSON.stringify(r.play) === JSON.stringify(["stanley_cup", "assists_title"]), r.play);
  A("Seattle's goaltender: the Jennings; the Goaltending Title's holder: that title; a Cup winner with nothing else: the Cup", JSON.stringify([r.smk, r.gun, r.dark]) === JSON.stringify([["jennings"], ["goaltending_title"], ["stanley_cup"]]), [r.smk, r.gun, r.dark]);
  A("the final table, with division places and how each season ended", JSON.stringify(r.table) === JSON.stringify([
    ["VAN", "43-9-2", 88, 1, "final"], ["SEA", "42-12-0", 84, 2, "division"], ["BOS", "26-22-6", 58, 1, "cup"], ["NYI", "27-24-3", 57, 2, "division"],
    ["DET", "26-24-4", 56, 3, "first"], ["PIT", "20-29-5", 45, 4, "none"], ["UTA", "16-32-6", 38, 3, "first"], ["DAL", "16-37-1", 33, 4, "none"]]), r.table);
  A("the table adds up: every win is someone's loss", r.ptsWins);
  A("the Presidents' Trophy is the most points; the Jennings is the fewest goals against (Seattle, 150)", r.presidents && r.jenningsClub === "SEA" && r.jenningsTotal, r);
  A("a season not yet closed has no trophies and no table", r.none2);
  A("one honor order: trophies and titles before Players of the Week before a race", r.rank[2] < r.rank[3] && r.rank[3] < r.rank[0] && r.rank[0] < r.rank[1], r.rank);
  await done(p);

  console.log("## Stats > Awards: the season's trophy room");
  p = await page("#/stats?tab=awards");
  r = await p.evaluate(() => {
    const q = (s) => document.querySelector(s), t = (s) => ((q(s) || {}).textContent || "").trim(), all = (s) => [...document.querySelectorAll(s)];
    const cup = q(".lg-sc");
    return { kicker: t(".lg-hero .kicker"), h1: t(".lg-hero h1"), lede: t(".lg-hero .lede-l"), cta: [t(".lg-hero .lg-cta a"), (q(".lg-hero .lg-cta a") || {}).getAttribute && q(".lg-hero .lg-cta a").getAttribute("href")],
      secs: all("#sxBody > section, .lg-sec").map((s) => s.getAttribute("aria-labelledby")).filter((x, i, a) => x && a.indexOf(x) === i),
      heads: ["htt", "hrec", "hpotw", "hstars"].map((id) => t("#" + id)),
      cupName: t(".lg-sc-t .d-1"), cupKick: t(".lg-sc-t .lg-ct-rk"), cupReg: t(".lg-sc-l"), cupHref: cup && cup.querySelector(".lg-sc-id").getAttribute("href"),
      path: all(".lg-sc-path li").map((li) => [li.children[0].textContent, li.children[1].textContent]),
      names: all(".lg-sc-n li a").map((a) => [a.textContent, a.getAttribute("href")]), namesH: t(".lg-sc-n h3"),
      ink: cup && getComputedStyle(cup).color, bg: cup && getComputedStyle(cup).backgroundColor,
      tiles: all(".lg-trs .lg-ct").map((a) => [a.querySelector(".lg-ct-rk").textContent, a.querySelector(".lg-ct-name").textContent, a.querySelector(".lg-ct-rec").textContent, a.getAttribute("href")]),
      rec: all(".lg-rec-r:not(.lg-rec-h)").map((r) => [r.querySelector(".lg-rec-k").textContent].concat([...r.querySelectorAll(".lg-rec-c")].map((c) => c.classList.contains("none") ? c.textContent
        : [".lg-rec-a", ".lg-rec-w b", ".lg-rec-v b", ".lg-rec-v small"].map((s) => c.querySelector(s).textContent).join(" ")))),
      recHead: all(".lg-rec-h span").map((x) => x.textContent), roles: [q(".lg-rec").getAttribute("role"), all(".lg-rec [role=row]").length, all(".lg-rec [role=cell]").length, all(".lg-rec [role=rowheader]").length],
      recLinks: all(".lg-rec-c a").map((a) => a.getAttribute("href")),
      weeks: [t(".lg-wk")].concat(all(".lg-wk-n").map((x) => x.textContent)), potwP: t('[aria-labelledby="hpotw"] .sec-head p'), starsP: t('[aria-labelledby="hstars"] .sec-head p'),
      note: t(".lg-rec-note"), sample: all(".lg-sec .chip.sample").length,
      through: (() => { const n = S2.M.nights({ when: "past" })[0]; return n ? "runs through " + S2.M.etMonthDay(n.games[0].at) + "." : null; })(),
      star1: (() => { const li = q(".lg-stars li"); return li ? [li.querySelector(".lg-stars-n").textContent, +li.querySelector(".lg-st1 b").textContent] : null; })(),
      /* QA round 2 (2026-11-25): a Three Stars name cuts with an ellipsis on one line, so each carries its full tag as its title */
      starsTitled: all(".lg-stars .lg-stars-n").length > 0 && all(".lg-stars .lg-stars-n").every((a) => a.getAttribute("title") === a.textContent),
      stale: /Leading today|Four by vote, four by the record|Voted after the regular season/.test(document.body.textContent),
      cols: (() => { const xs = new Set(all(".lg-sc-n li").map((li) => Math.round(li.getBoundingClientRect().left))); return xs.size; })() };
  });
  A("the hero is the season's lead story, the Cup", r.kicker === "Awards, Season 1" && r.h1 === "The Bruins win the Stanley Cup", [r.kicker, r.h1]);
  A("the hero sentence: the final, then the Presidents' Trophy", r.lede === "Boston swept Vancouver in the final, 4-0. Vancouver's 88 points won the Presidents' Trophy, the best record in the league.", r.lede);
  A("the hero's one link opens Boston's honors", r.cta[0] === "Boston's honors" && r.cta[1] === "#/club/BOS?tab=history", r.cta);
  /* 2026-11-23: the award ballot came back (the cutover list, "go ahead on all of these"), right after the awards by the record */
  A("five sections in order of weight: team trophies, by the record, the vote, Players of the Week, Three Stars", JSON.stringify(r.secs) === JSON.stringify(["htt", "hrec", "hvote", "hpotw", "hstars"]), r.secs);
  A("Players of the Week run all six weeks, newest first; the Three Stars board says the last game night it counts", JSON.stringify(r.weeks) === JSON.stringify(["Week 6", "Week 5", "Week 4", "Week 3", "Week 2", "Week 1"]) && /All six weeks of the regular season\.$/.test(r.potwP) && !!r.through && r.starsP.endsWith(r.through), { weeks: r.weeks, through: r.through });
  A("each section states its finding (the Three Stars headline is the board's leader and their first stars)", JSON.stringify(r.heads.slice(0, 3)) === JSON.stringify(["Two for Boston, two for Vancouver", T.scorer + " takes four of the seven", T.scorer + ", three times"]) &&
    !!r.star1 && r.heads[3] === r.star1[0] + " has " + r.star1[1] + " first star" + (r.star1[1] === 1 ? "" : "s"), r.heads.slice(0, 2).length);
  A("every Three Stars name carries its full tag as its title (the name cuts with an ellipsis)", r.starsTitled, r.starsTitled);
  A("the Cup panel: the trophy, the club, its regular season, linked to the club", r.cupKick === "Stanley Cup" && r.cupName === "Boston Bruins" && r.cupReg === "26-22-6 and 58 points in the regular season, 1st in the East." && r.cupHref === "#/club/BOS", r);
  A("the run to the Cup, round by round, the final's score said once", JSON.stringify(r.path) === JSON.stringify([["Opening round", "A bye, first in the East"], ["East Division final", "Swept New York, 4-0"], ["Final", "Swept Vancouver, 4-0"]]), r.path);
  A("twenty names on the Cup, each a link to the player", r.namesH === "On the Cup, 20 names" && r.names.length === 20 && r.names.every((n) => /^#\/player\/[0-9a-f-]{36}$/.test(n[1])), r.names.length);
  /* review 2026-11-23: grouped by position with no labels the list read as an alphabet restarting, so it is one alphabet */
  A("the names run in one alphabet", JSON.stringify(r.names.map((n) => n[0])) === JSON.stringify(r.names.map((n) => n[0]).slice().sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) && r.names[0][0] === T.firstOnCup, r.names.map((n) => n[0]));
  A("the names sit in columns (two or more)", r.cols >= 2, r.cols);
  A("the panel is the club's own color with the readable ink (Boston gold, black text)", r.bg === "rgb(255, 184, 28)" && r.ink === "rgb(0, 0, 0)", [r.bg, r.ink]);
  A("the other three are the Clubs page's tile, the trophy where the rank goes", JSON.stringify(r.tiles) === JSON.stringify([["Presidents' Trophy", "VancouverCanucks", "88points, 43-9-2", "#/club/VAN"], ["Prince of Wales Trophy", "BostonBruins", "Eastover New York", "#/club/BOS"], ["Clarence S. Campbell Bowl", "VancouverCanucks", "Westover Seattle", "#/club/VAN"]]), r.tiles);
  A("the record board: one row per stat, the league's title beside the NHL's trophy", JSON.stringify(r.rec) === JSON.stringify([
    ["Points", "Scoring Title " + T.scorer + " 4.91 a game", "Art Ross Trophy " + T.scorer + " 172 points"], ["Goals", "Goal-scoring Title " + T.scorer + " 2.91 a game", "Rocket Richard Trophy " + T.scorer + " 102 goals"],
    ["Assists", "Playmaking Title " + T.playmaker + " 2.57 a game", "The NHL gives no trophy for assists"], ["Goaltending", "Goaltending Title " + T.goalieTitle + " 2.68 goals against a game", "Jennings Trophy " + T.jennings + " 150 Seattle allowed"]]), r.rec);
  A("the board's columns are named for how each is decided", JSON.stringify(r.recHead) === JSON.stringify(["Stat", "League title, the best rate", "NHL trophy, the best total"]), r.recHead);
  A("the board is a table to a screen reader: 5 rows, 4 row headers, 8 cells", JSON.stringify(r.roles) === JSON.stringify(["table", 5, 8, 4]), r.roles);
  A("every winner on the board links to the player", r.recLinks.length === 7 && r.recLinks.every((h) => /^#\/player\//.test(h)), r.recLinks);
  A("the voted awards are named once, and said not yet awarded", r.note === "Four more are decided by vote: Most Valuable Player, Best Goaltender, Best Defenseman and Rookie of the Year (Rule 9.2). Season 1’s have not been awarded yet.", r.note);
  A("nothing is sample (every trophy is real), and the Oct 19 race wording is gone", r.sample === 0 && !r.stale, r);
  await done(p);

  /* v5.00 swap (i3b, 2026-11-25): the ballot is the league's (award_ballots, the classic CG.AFTER.awards door). The write mock
     answers every vote as the database would; nothing is shown as saved before it answers, and a refusal keeps the vote on file */
  console.log("## the award ballot: the voter's own ballot read from the league, each vote an upsert through S2.write");
  const ballot = async (persona, o, width) => {
    const ctx = await b.newContext(width ? { viewport: { width, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-11-01" })); } catch (e) { /* storage blocked */ } });
    await mock.install(ctx, Object.assign({ live: true, persona }, READS, o, { tables: Object.assign({}, READS.tables, (o || {}).tables || {}) }));
    const pg = await ctx.newPage();
    pg.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    pg.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await pg.goto(BASE + "#/stats?tab=awards");
    await pg.waitForFunction(() => window.S2 && S2.M && S2.LIVE && S2.auth && S2.auth.sub && document.querySelector('[aria-labelledby="hvote"]'), null, { timeout: 30000 });
    await pg.waitForTimeout(400);
    return pg;
  };
  const balRead = () => ({ note: [...document.querySelectorAll('[aria-labelledby="hvote"] .lg-rec-note')].map((x) => x.textContent).join(" | "),
    rows: [...document.querySelectorAll("[data-bal-row]")].map((r) => ({ k: r.dataset.balRow, say: r.querySelector("[data-bal-say]").textContent, empty: !!r.querySelector('option[value=""]'), v: r.querySelector("select").value, n: r.querySelectorAll("option").length })),
    sid: (S2.M.control.season(1).settings || {}).id, me: S2.session.profileId });
  p = await ballot("anon");
  r = await p.evaluate(balRead);
  A("a guest reads who votes, with the way to join, and no ballot", r.rows.length === 0 && /The ballot opens to members when they join/.test(r.note), r.note);
  await done(p);
  p = await ballot("member", { tables: { award_ballots: [] } });
  r = await p.evaluate((fn) => Object.assign({ mine: !!(S2.mine && S2.mine()) }, (0, eval)("(" + fn + ")")()), balRead.toString());
  A("a member rostered in Season 1 gets a ballot; one with no roster spot and no staff seat would be told when it opens (the database decides)", r.mine ? r.rows.length === 4 : r.rows.length === 0 && /Your ballot opens once you hold a roster spot in Season 1, or join the staff\./.test(r.note), { mine: r.mine, rows: r.rows.length });
  await done(p);
  const ids0 = await (async () => { const pg = await ballot("staff", { tables: { award_ballots: [] } });
    const x = await pg.evaluate(() => ({ picks: [...document.querySelectorAll('[data-bal="mvp"] option')].map((o) => o.value).filter(Boolean).slice(0, 2), sid: (S2.M.control.season(1).settings || {}).id, me: S2.session.profileId }));
    await done(pg); return x; })(), pick0 = ids0.picks;
  p = await ballot("staff", { tables: { award_ballots: [] }, writes: { "award_ballots.upsert": mock.ok([{ id: "ballot-1" }]) } });
  r = await p.evaluate(balRead);
  A("a staffer's ballot: four awards read from the league, no vote yet, each offering an empty choice and the season's rostered players", r.rows.length === 4 && r.rows.every((x) => x.say === "No vote yet" && x.empty && x.n > 1) && JSON.stringify(r.rows.map((x) => x.k)) === JSON.stringify(["mvp", "best_goalie", "best_defenseman", "rookie_of_year"]), r.rows.map((x) => [x.k, x.say, x.empty]));
  /* review 2026-11-23, pinned in fixround on the demo's role switch until 2026-11-25: the choices are this voter's own pool,
     never a player of their own club and never themselves (Rule 9.2.1). The staff persona played for a club in Season 1,
     and S2.mine() answers null for a staffer, so the ballot reads the voter's own profile (review 2026-11-25) */
  r = await p.evaluate(() => { const club = (S2.M.player(S2.session.profileId) || {}).club, ids = [...document.querySelectorAll("[data-bal] option")].map((o) => o.value).filter(Boolean);
    return { club, n: ids.length, own: ids.filter((id) => (S2.M.player(id) || {}).club === club).length, self: ids.indexOf(S2.session.profileId) >= 0, ofClub: S2.M.players.filter((pl) => pl.rostered && pl.club === club).length }; });
  A("the ballot offers this voter's own pool: no player of their own club, never themselves", !!r.club && r.ofClub > 1 && r.n > 0 && r.own === 0 && !r.self, r);
  await p.selectOption('[data-bal="mvp"]', pick0[0]);
  await p.waitForFunction(() => /^Your vote: /.test((document.querySelector('[data-bal-say="mvp"]') || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  const c1 = mock.calls(p.context()), w = c1[c1.length - 1] || {};
  r = await p.evaluate(balRead);
  A("a vote is one upsert on (season, award, voter) through S2.write, for the season on screen", c1.length === 1 && w.rpc === "award_ballots.upsert" && w.args.onConflict === "season_id,category,voter_id" &&
    w.args.row.season_id === r.sid && !!r.sid && w.args.row.category === "mvp" && w.args.row.voter_id === r.me && w.args.row.profile_id === pick0[0] && !!w.args.row.updated_at, c1.map((x) => x.rpc));
  const mvp = r.rows.filter((x) => x.k === "mvp")[0];
  A("once the league confirms it, the line says the vote and the ballot offers no empty choice (a vote is changed, never withdrawn)", /^Your vote: /.test(mvp.say) && !mvp.empty && mvp.v === pick0[0], mvp);
  await done(p);
  p = await ballot("staff", { tables: { award_ballots: [{ category: "mvp", profile_id: pick0[0], season_id: ids0.sid, voter_id: ids0.me }] },
    writes: { "award_ballots.upsert": mock.fail("22023", "That award has been decided; the vote is closed.") } });
  r = await p.evaluate(balRead);
  const had = r.rows.filter((x) => x.k === "mvp")[0];
  A("a vote on file is read back: the line names it, the select holds it, no empty choice", /^Your vote: /.test(had.say) && had.v === pick0[0] && !had.empty, had);
  await p.selectOption('[data-bal="mvp"]', pick0[1]);
  await p.waitForTimeout(500);
  r = await p.evaluate(balRead);
  const ref = r.rows.filter((x) => x.k === "mvp")[0];
  A("a refusal shows the league's own words, keeps the vote on file and says so", ref.v === pick0[0] && /^That award has been decided; the vote is closed\. Your vote stays /.test(ref.say) && mock.calls(p.context()).length === 1, ref.say.slice(0, 60));
  await done(p);

  /* review 2026-11-23 (fixround's check on the demo ballot until 2026-11-25): at 375 px each award's name keeps its width
     and its select drops below it */
  p = await ballot("staff", { tables: { award_ballots: [] } }, 375);
  r = await p.evaluate(() => [...document.querySelectorAll(".lg-bal-r")].map((x) => ({ t: Math.round(x.querySelector(".grow").getBoundingClientRect().width), s: Math.round(x.querySelector("select").getBoundingClientRect().top - x.querySelector(".grow").getBoundingClientRect().top) })));
  A("the ballot rows wrap at 375: each award's name keeps its width and its select drops below it", r.length === 4 && r.every((x) => x.t >= 200 && x.s > 10), r);
  await done(p);

  console.log("## press, hover and reduced motion (BRIEF): pressables answer on pointer-down; hover only with a fine pointer");
  p = await page("#/stats?tab=awards");
  r = await p.evaluate(() => {
    const rules = []; for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch (e) { continue; } const walk = (list, media) => { for (const x of list) { if (x.cssRules && x.media) walk(x.cssRules, x.media.mediaText); else if (x.selectorText) rules.push([media || "", x.selectorText, x.style.cssText]); } }; walk(rs); }
    const find = (sel, media) => rules.filter((x) => x[1].split(",").map((s) => s.trim()).indexOf(sel) >= 0 && (media == null ? !x[0] : x[0].indexOf(media) >= 0));
    const press = [".lg-sc-id:active", ".lg-rec-c > a:active"].map((s) => (find(s)[0] || [])[2] || "");
    const hover = rules.filter((x) => /:hover/.test(x[1]) && /lg-sc|lg-rec/.test(x[1]) && !/reduced-motion/.test(x[0])).map((x) => x[0]);
    const rm = [".lg-sc-id:hover .lg-ct-medal"].map((s) => (find(s, "reduce")[0] || [])[2] || "");
    const tr = [".lg-sc-id", ".lg-rec-c > a"].map((s) => (find(s)[0] || [])[2] || "");
    /* QA round 2: a press is the scale property, which the kit's ONE reduce rule removes everywhere (ui.css) */
    const kit = rules.some((x) => /reduce/.test(x[0]) && /^\*, (\*)?::before, (\*)?::after$/.test(x[1]) && /scale: none !important/.test(x[2]));
    const undo = [".lg-sc-id:active", ".lg-rec-c > a:active"].filter((s) => find(s, "reduce").length);
    return { press, hover, rm, tr, kit, undo };
  });
  /* QA round 2 (2026-11-25): these three are rewritten. They pinned the press on transform (and its hand-written Reduce
     Motion undo); every press is the independent scale property now, as ui.css's .btn, and the kit's one reduce rule
     (scale: none) removes it */
  A("the Cup link and the board's links press in (the scale property, .985), never from or to nothing", r.press.every((x) => /(^|; )scale: 0\.985;/.test(x) && !/transform/.test(x)), r.press);
  A("their transitions name the property (scale), never all", r.tr.every((x) => /transition: scale/.test(x) && !/transition: all/.test(x)), r.tr);
  A("every new hover sits behind (hover: hover) and (pointer: fine)", r.hover.length >= 2 && r.hover.every((m) => /hover: hover/.test(m) && /pointer: fine/.test(m)), r.hover);
  A("reduced motion keeps the states without the movement (the medal's hover lift undone here, every press by the kit's one rule)", r.rm.every((x) => /transform: none/.test(x)) && r.kit && !r.undo.length, { rm: r.rm, kit: r.kit, undo: r.undo });
  await done(p);

  console.log("## a profile: the honors column and the hero's one flag");
  const prof = async (tag) => {
    const pg = await page("#/player/" + tag);
    const out = await pg.evaluate((lf) => {
      const col = [...document.querySelectorAll("#pfTail .pfx-col")].filter((c) => c.querySelector("#pfHonH"))[0];
      return { flags: [...document.querySelectorAll(".pfx-hero .pfx-flag")].map((f) => [f.className, f.textContent.trim(), !!f.querySelector("svg[aria-hidden=true]")]),
        h: col ? col.querySelector("#pfHonH").textContent : null, p: col ? col.querySelector(".copy p").textContent : null,
        rows: col ? [...col.querySelectorAll(".pfx-hon li")].map((li) => [li.querySelector(".pfx-hon-n").textContent, li.querySelector("b").textContent, li.querySelector(".grow > span").textContent]) : [],
        season: (document.querySelector('[aria-labelledby="pfSeasonH"] .copy p, #pfBody section .copy p') || {}).textContent || "",
        kick: ((document.querySelector('[aria-labelledby="pfSeasonH"] .kicker') || {}).textContent || ""), lede: ((document.querySelector(".pfx-hero .pfx-lede") || {}).textContent || ""),
        about: [...document.querySelectorAll(".about p, details p")].map((x) => x.textContent).join(" "),
        thru: (0, eval)("(" + lf + ")")(), line: (() => { const pl = S2.M.player(location.hash.split("/")[2]), L = pl && pl.lines.S; return L ? [L.p, L.gp] : null; })() };
    }, lastFinal.toString());
    await done(pg); return out;
  };
  r = await prof(ID.playmaker);
  A("the playmaker: the hero flags the Stanley Cup, with the trophy glyph", JSON.stringify(r.flags[0]) === JSON.stringify(["pfx-flag honor", "Stanley Cup champion", true]), r.flags);
  A("the playmaker: the column names both awards", r.h === "Stanley Cup and Playmaking Title.", r.h);
  A("the playmaker: the sentence says who shares the Cup, how titles are decided, and the week they were named", r.p === "The Stanley Cup goes to every player on the champion's roster or in its training camp when the final is decided. Titles go to the best rate per game among playoff-eligible players (Rule 9.2). Also Player of the Week in Week 5.", r.p);   /* the Cup's sharing (review 2026-11-23); QA nits 9, 2026-11-25: no Rule 9.1 on it while the live book's 9.1 does not carry it */
  /* commissioner, 2026-11-23: "do not add runner ups to them, just a quick description of what the award is, and the stats
     that mattered for it": every award row is what it is, a colon, then the numbers that won it */
  A("the playmaker: one row each, what the award is and the numbers that won it, then Week 5 (named after the snapshot)", JSON.stringify(r.rows) === JSON.stringify([["S1", "Stanley Cup", "The playoff champion: Boston swept Vancouver 4-0 in the final."], ["S1", "Playmaking Title", "The best assists per game in the regular season: 2.57 over 14 games."],
    ["W5", "Player of the Week, Week 5", "Forward, 13G 23A across 6 games"]]), r.rows);
  A("the playmaker: the season's figures say where they stop (hero line and season kicker), so the trophy above them never reads as their total", !!r.line && r.lede.indexOf(r.line[0] + " points in " + r.line[1] + " games through " + r.thru) === 0 && r.kick === "Season 1 through " + r.thru, [r.lede, r.kick, r.thru]);
  A("the playmaker: About explains the trophies and the weekly honor, nothing else", /Trophies and titles are Season 1's as decided/.test(r.about) && /Players of the Week are picked/.test(r.about) && !/until then this is the race/.test(r.about), r.about.slice(0, 300));
  r = await prof(ID.scorer);
  A("the scoring champion: one flag, the highest award", r.flags.filter((f) => /honor/.test(f[0])).length === 1 && r.flags[0][1] === "Art Ross Trophy", r.flags);
  A("the scoring champion: four awards, trophies before titles, then Players of the Week; no race rows once titles are filed", r.h === "Four awards in Season 1." &&
    JSON.stringify(r.rows.slice(0, 4).map((x) => x[1])) === JSON.stringify(["Art Ross Trophy", "Maurice \"Rocket\" Richard Trophy", "Scoring Title", "Goal-scoring Title"]) &&
    r.rows.slice(4).every((x) => /^W\d$/.test(x[0])) && !r.rows.some((x) => / race$/.test(x[1])), r);
  A("the scoring champion: each award says what it is and the numbers that won it, never a runner-up", JSON.stringify(r.rows.slice(0, 4).map((x) => x[2])) === JSON.stringify(["The most points in the regular season: 172 in 35 games.",
    "The most goals in the regular season: 102 in 35 games.", "The best points per game in the regular season: 4.91 over 35 games.", "The best goals per game in the regular season: 2.91 over 35 games."]) && !r.rows.some((x) => /was next|runner/i.test(x[2])), r.rows);
  A("the scoring champion: the season sentence no longer runs the Scoring Title race once the title is filed", !/Title race/.test(r.season), r.season);
  A("the scoring champion: the sentence explains totals against rates and mentions the weekly honors", /^Trophies count season totals, the NHL's way; titles go to the best rate per game \(Rule 9\.2\)\. Also Player of the Week three times\.$/.test(r.p), r.p);
  r = await prof(ID.jennings);
  A("Seattle's goaltender: the Jennings, flagged and explained by the club's goals against", r.flags[0][1] === "Jennings Trophy" && r.h === "William M. Jennings Trophy." && r.rows[0][2] === "The goaltender of the club that allowed the fewest goals: Seattle allowed 150; 17 games in goal.", r);
  r = await prof(ID.goalieTitle);
  A("the Goaltending Title's holder: the title, with the rate it was won at", r.flags[0][1] === "Goaltending Title" && r.rows[0][2] === "The fewest goals against per game in the regular season: 2.68 over 25 games in goal." && JSON.stringify(r.rows.slice(1).map((x) => x[0])) === JSON.stringify(["W6", "W4"]), r);
  r = await prof(ID.cupOnly2);
  A("a Cup winner with nothing else: the flag, one row, and an About with no Player of the Week note", r.flags[0][1] === "Stanley Cup champion" && r.h === "Stanley Cup champion." && r.rows.length === 1 && !/Players of the Week are picked/.test(r.about), r);
  r = await prof(ID.potwOnly);
  A("a Player of the Week with no trophy: no honor flag, the column as before", !r.flags.some((f) => /honor/.test(f[0])) && /Player of the Week/.test(r.h || ""), r);

  console.log("## a club: the hero flag, the honors column and Season 1 as it finished");
  const club = async (code) => {
    const pg = await page("#/club/" + code + "?tab=history");
    /* the hero's numbers count up on arrival (S2.countUp); read them once they land (2026-11-23: at 350 ms the points
       could still read 57 on the way to 58, as the bundle grew) */
    await pg.waitForTimeout(700);
    const out = await pg.evaluate((lf) => {
      const t = (s) => ((document.querySelector(s) || {}).textContent || "").trim();
      const col = document.querySelector("#pfcHonH").closest(".pfx-col"), by = document.querySelector("#pfcBySH").closest(".pfx-col");
      return { flags: [...document.querySelectorAll("#pfcHero .pfx-flag")].map((f) => f.textContent.trim()), h: t("#pfcHonH"), hp: t("#pfcHonH + p"),
        lede: t("#pfcHero .pfx-lede"), nums: [...document.querySelectorAll("#pfcHero .pfc-nums dd")].map((d) => d.textContent), next: !!document.querySelector(".pfc-mc, .pfc-next"),
        kick: t('[aria-labelledby="pfcSzH"] .kicker'), byP: t("#pfcBySH + p"),
        rows: [...col.querySelectorAll(".pfx-hon li")].map((li) => [li.querySelector(".pfx-hon-n").textContent, li.querySelector("b").textContent, li.querySelector(".grow > span").textContent, !!li.querySelector("a")]),
        s1: [...by.querySelectorAll("li")].map((li) => li.querySelector(".grow").textContent)[0], thru: (0, eval)("(" + lf + ")")() };
    }, lastFinal.toString());
    await done(pg); return out;
  };
  r = await club("BOS");
  A("Boston: the hero flags the Cup; the column leads with it", JSON.stringify(r.flags) === JSON.stringify(["Stanley Cup champions"]) && r.h === "Stanley Cup champions.", r);
  A("Boston: the hero tells the season as it finished, with its final numbers and no next game (review 2026-11-23)", r.lede === "Boston finished Season 1 26-22-6 with 58 points, 1st in the East, and won the Stanley Cup." &&
    JSON.stringify(r.nums) === JSON.stringify(["26-22-6", "1st", "58", "+9"]) && !r.next, r);
  A("Boston: the season's results say where they stop; By season names the draft's real date", r.kick === "Season 1 through " + r.thru && r.byP === "Every player reapplies, and rosters are rebuilt at the draft on Dec 12.", [r.kick, r.byP]);
  A("Boston: the whole season's Players of the Week, newest first", JSON.stringify(r.rows.slice(3).map((x) => x[0] + " " + x[1])) === JSON.stringify(["W6 " + T.bosW6, "W5 " + T.playmaker, "W5 " + T.bosW5d]), r.rows.slice(3));
  A("Boston: the club's trophies as rows, then its player's title as a link", JSON.stringify(r.rows.slice(0, 3)) === JSON.stringify([["S1", "Stanley Cup", "The playoff champion: Boston swept Vancouver 4-0 in the final.", false],
    ["S1", "Prince of Wales Trophy", "The East Division's playoff champion: Boston swept New York 4-0 in the East Division final.", false], ["S1", T.playmaker, "Playmaking Title, the best assists per game in the regular season: 2.57 over 14 games.", true]]), r.rows);
  A("Boston: Season 1 as it finished, not in progress", r.s1 === "Season 126-22-6, 58 points, 1st in the East. Won the Stanley Cup.", r.s1);
  r = await club("VAN");
  A("Vancouver: the Presidents' Trophy flagged alone (no Clinched over a closed season), both trophies named", JSON.stringify(r.flags) === JSON.stringify(["Presidents' Trophy"]) && r.h === "Presidents' Trophy and Campbell Bowl.", r);
  A("Vancouver: the trophies, then its scoring champion's two trophies and two titles", JSON.stringify(r.rows.slice(0, 6).map((x) => x[1] + " | " + x[2])) === JSON.stringify(["Presidents' Trophy | The best regular-season record: 88 points, 43-9-2.",
    "Clarence S. Campbell Bowl | The West Division's playoff champion: Vancouver beat Seattle 4-3 in the West Division final.", T.scorer + " | Art Ross Trophy, the most points in the regular season: 172 in 35 games.",
    T.scorer + " | Rocket Richard Trophy, the most goals in the regular season: 102 in 35 games.", T.scorer + " | Scoring Title, the best points per game in the regular season: 4.91 over 35 games.",
    T.scorer + " | Goal-scoring Title, the best goals per game in the regular season: 2.91 over 35 games."]), r.rows.slice(0, 6));
  A("Vancouver: Season 1 ended in the final", r.s1 === "Season 143-9-2, 88 points, 1st in the West. Lost the final.", r.s1);
  r = await club("SEA");
  A("Seattle: no flag at all; its goaltender's Jennings", r.flags.length === 0 && r.h === "Jennings Trophy for " + T.jennings + ".", r);
  A("Seattle: lost the West Division championship", r.s1 === "Season 142-12-0, 84 points, 2nd in the West. Lost the West Division championship.", r.s1);
  r = await club("PIT");
  A("Pittsburgh: no honors, said for a closed season; missed the playoffs", r.rows.length === 0 && r.h === "No Season 1 honors." && r.hp === "Season 1's trophies, titles and Players of the Week went to other clubs." && r.s1 === "Season 120-29-5, 45 points, 4th in the East. Missed the playoffs.", r);
  r = await club("DAL");
  A("Dallas: its two Players of the Week (weeks 5 and 6), and no race wording", r.h === "Two Players of the Week." && r.hp === "Players of the Week for this club's players. Season 1's trophies and titles went to other clubs." && JSON.stringify(r.rows.map((x) => x[0])) === JSON.stringify(["W6", "W5"]), r);
  r = await club("DET");
  A("Detroit: the Goaltending Title for its goaltender; out in the opening round", r.h === "Goaltending Title for " + T.goalieTitle + "." && r.s1 === "Season 126-24-4, 56 points, 3rd in the East. Lost in the opening round.", r);

  /* v5.00 swap (e6, one book, main session 2026-11-24): the rulebook page shows the live book (S2.RB, js/rulebook.js). The
     concept's copy carried the November 21 trophy rulings as proposed text in 9.1 and 9.2; the live book does not carry them
     yet, so they are no longer on the page until they are published. QA nits 9 (2026-11-25): the awards copy said the Cup's
     sharing and the Presidents', Wales and Campbell trophies under "(Rule 9.1)", which the book's 9.1 does not say; the
     copy cites no rule for them now, and the check below holds it there until the book carries them (the question of
     publishing the November 21 rulings in 9.1 is the main session's to put to the commissioner) */
  console.log("## the rulebook is the live book: Rules 9.1 and 9.2 word for word, nothing marked proposed");
  p = await page("#/rulebook?rule=9.1");
  r = await p.evaluate(() => {
    const sec = (id) => { const s = document.getElementById("rb-" + id); return s ? [...s.querySelectorAll(".lg-rb-p")].map((x) => x.textContent.slice(x.querySelector(".lg-rb-pn").textContent.length)) : null; };
    const book = (id) => { for (const c of S2.RB.chapters) for (const s of c.sections) if (s.id === id) return s.paragraphs; return null; };
    return { r91: sec("9.1"), r92: sec("9.2"), b91: book("9.1"), b92: book("9.2"), prop: document.querySelectorAll(".lg-rb-p.prop, .lg-rb-prop-n").length };
  });
  A("9.1 and 9.2 are the live book's, word for word", !!r.b91 && !!r.b92 && JSON.stringify(r.r91) === JSON.stringify(r.b91) && JSON.stringify(r.r92) === JSON.stringify(r.b92), [r.r91, r.b91]);
  A("no paragraph is marked proposed: a ruling reaches this page by being published", r.prop === 0, r.prop);
  A("no dash in the awards rules", !/[\u2013\u2014]| - /.test(r.r91.join(" ") + r.r92.join(" ")));
  await done(p);
  /* QA nits 9: a citation of Rule 9.1 says only what 9.1 says. While the book's 9.1 carries no word of the Cup's sharing
     (training camp) or the Presidents' Trophy, no sentence that says either cites it, on the Awards tab or a profile */
  if (!/training camp|Presidents/.test(r.b91.join(" "))) for (const hash of ["#/stats?tab=awards", "#/player/" + ID.playmaker]) {
    p = await page(hash);
    const cites = await p.evaluate(() => [...document.querySelectorAll("#page p, #page .about-b p")].map((x) => x.textContent).filter((t) => /Rule 9\.1\b/.test(t) && /training camp|Presidents/.test(t)));
    A(hash + ": no sentence on the Cup's sharing or the Presidents' Trophy cites Rule 9.1, which does not say it", cites.length === 0, cites);
    await done(p);
  }

  console.log("## search, the focus ring on a club color, and a flag with no club behind it");
  p = await page("#/stats?tab=awards");
  r = await p.evaluate(() => {
    const hits = ["stanley cup", "presidents", "art ross", "jennings"].map((q) => (S2.search(q) || []).some((g) => g.items.some((h) => h.href === "#/stats?tab=awards")));
    const a = document.querySelector(".lg-sc-n a"); a.focus(); const cs = getComputedStyle(a);
    const box = document.createElement("div"); box.className = "band club"; box.innerHTML = '<span class="pfx-flag honor"><span>Stanley Cup champion</span></span>'; document.body.appendChild(box);
    const f = box.querySelector(".pfx-flag"), fs = getComputedStyle(f), ts = getComputedStyle(f.firstChild);
    return { hits, ring: [cs.outlineStyle, cs.outlineColor, cs.color], flag: [fs.backgroundColor, ts.color] };
  });
  A("search finds the trophies by name", r.hits.every(Boolean), r.hits);
  A("a focused name on the Cup is ringed in the panel's own ink (WCAG 1.4.11 on a club color)", r.ring[0] === "solid" && r.ring[1] === r.ring[2], r.ring);
  A("an honor flag on a band with no club color still reads (its text is never its fill)", r.flag[0] !== r.flag[1], r.flag);
  await done(p);

  console.log("## phones, dark mode and reduced motion");
  for (const w of [320, 375, 430]) {
    for (const hash of ["#/stats?tab=awards", "#/club/BOS?tab=history", "#/player/" + ID.playmaker, "#/player/" + ID.scorer, "#/today"]) {
      p = await page(hash, w);
      r = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth,
        cols: (() => { const xs = new Set([...document.querySelectorAll(".lg-sc-n li")].map((li) => Math.round(li.getBoundingClientRect().left))); return xs.size; })(),
        split: [...document.querySelectorAll(".lg-sc-n a")].filter((a) => { const rg = document.createRange(); rg.selectNodeContents(a); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size > 1; }).map((a) => a.textContent),
        clipped: [...document.querySelectorAll(".lg-sc-n a, .lg-rec-w b, .pfx-flag.honor")].filter((a) => a.scrollWidth > a.clientWidth + 1 && getComputedStyle(a).textOverflow !== "ellipsis").map((a) => a.textContent) }));
      A(w + " px " + hash + ": no sideways scroll" + (hash.indexOf("awards") > 0 ? ", the Cup's names in two columns" : ""), r.over <= 0 && (hash.indexOf("awards") < 0 || r.cols === 2) && !r.clipped.length && !r.split.length, r);
      await done(p);
    }
  }
  p = await page("#/stats?tab=awards", null, { dark: true });
  r = await p.evaluate(() => { const c = getComputedStyle(document.querySelector(".lg-sc")); const v = getComputedStyle(document.querySelector(".lg-rec-v b")); return { bg: c.backgroundColor, ink: c.color, num: v.color, page: getComputedStyle(document.body).backgroundColor }; });
  A("dark mode: the Cup keeps Boston's gold and black; the board's numbers read on the dark page", r.bg === "rgb(255, 184, 28)" && r.ink === "rgb(0, 0, 0)" && r.num !== r.page, r);
  await done(p);
  p = await page("#/stats?tab=awards", null, { reduce: true });
  r = await p.evaluate(() => ({ on: matchMedia("(prefers-reduced-motion: reduce)").matches, secs: document.querySelectorAll(".lg-sec").length, medal: getComputedStyle(document.querySelector(".lg-sc .lg-ct-medal")).transitionDuration }));
  A("reduced motion: every section renders and the Cup's medallion has no movement to make", r.on && r.secs === 5 && /^0s/.test(r.medal), r);   /* five with the ballot, 2026-11-23 */
  await done(p);

  A("no console errors on any page", errors.length === 0, errors.slice(0, 5));
  A("every read the pages made was answered (nothing unexpected reached the fence)", unexpected.length === 0, unexpected.slice(0, 5));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL threw: " + (e && e.stack || e)); process.exit(1); });
