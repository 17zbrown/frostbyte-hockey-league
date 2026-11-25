const S2_BASE = process.env.S2_BASE || (() => { throw new Error("S2_BASE unset: run through tools/ui/run.cjs") })();
/* The stats the commissioner asked for on 2026-11-04, driven in headless Chromium: node tools/ui/run.cjs stats
   Needs the s2-concept server on S2_BASE (tools/ui/run.cjs).
   The commissioner: "I will list the stats I would like added in the concept site for next season and beyond. Team: Time on
   Attack, passing percentage, hits, blocks, takeaways, giveaways, interceptions, PIM, face off percentage. Players:
   Desperation saves, shutout periods, penalty shot save percentage, Shots on net percentage, faceoff percentage only
   calculated from games where the player played at center."
   Every figure is worked out here from the raw box lines, never through the model, then compared with the model and with
   the rendered pages. Then, on the same day, the commissioner's answers to two questions. Cap shots on net % at 100%:
   "Yes". Use EA's club count for the team shot numbers, which read about 11% low from the skaters' lines: "fix them".
   v5.00 swap (i3b, 2026-11-25): the suite runs the REAL site (stream h0's live mode, tools/ui/mock/index.cjs) on the
   recorded production s2_league, Season 1 on screen (?season=1), and the raw lines are that recording's box scores (the
   whole season now, where the Oct 19 snapshot stopped at 127 games). A GAP the swap leaves open, said in the checks and in
   i3b's report: s2_league carries no EA club figures for time on attack or passing (model.js builds clubByGame from the
   games' club shots alone), so on the real site both read as a dash until the league read carries them. Deleted with the
   snapshot (each pinned the fixture's own data against the database, not the site): the 127-game club totals and the
   seven two-sitting games, the snapshot's goalie totals, its second witness (the season lines' dives) and the fixture
   mode's own caption check. Reads only; nothing reaches production. */
const mock = require(process.env.S2_MOCK);
const { chromium } = require(mock.PW);
const fs = require("fs"), path = require("path");
const BASE = S2_BASE + "?season=1";
let fails = 0;
const A = (name, cond, more) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond || more == null ? "" : "  (" + (typeof more === "string" ? more : JSON.stringify(more)) + ")")); if (!cond) fails++; };
const near = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.0011);

/* the raw lines: the recorded Season 1 s2_league box scores, one row per player per game (box[g.home], never box.home) */
const D = mock.league({ p_season: 1 }), ix = {}; D.box.cols.forEach((k, i) => { ix[k] = i; });
const GAMES = {}; D.games.forEach((g) => { GAMES[g.id] = g; });
const FINAL = (g) => g && g.status === "final" && !g.voided;
const boxed = Object.keys(D.box.byGame).filter((g) => FINAL(GAMES[g]) && GAMES[g].stage === "regular"), rows = [];
const v = (r, k) => r[ix[k]] == null ? 0 : r[ix[k]];
boxed.forEach((gid) => D.box.byGame[gid].forEach((r) => rows.push({ gid, pid: r[ix.profile_id], club: r[ix.team], goalie: !!r[ix.is_goalie], pos: r[ix.position], fow: v(r, "faceoffs_won"), fot: v(r, "faceoffs_won") + v(r, "faceoffs_lost"),
  hits: v(r, "hits"), blk: v(r, "blocked_shots"), tk: v(r, "takeaways"), gv: v(r, "giveaways"), int: v(r, "interceptions"), pim: v(r, "pim"), dsv: v(r, "diving_saves"), sop: v(r, "shutout_periods"),
  psv: v(r, "pen_shot_saves"), psa: v(r, "pen_shots_against"), sog: v(r, "shots"), sat: v(r, "shot_attempts"), sa: v(r, "shots_against") })));
const sum = (list, k) => list.reduce((a, x) => a + (x[k] || 0), 0);
/* QA visual 3 (2026-11-25): the Leaders tab reads the title race from statistical_title_board (league.js tbRead). The
   harness answers it with a board worked out here from a body's own box scores in the function's shape (category, place,
   profile_id, gamertag, gp, total, per_game), top N a title over the season's games-played floor; the page must show
   exactly what the board says. TBCALLS records each read's arguments */
const TBCALLS = [];
function titleBoard(B, top) {
  const bx = {}; B.box.cols.forEach((k, i) => { bx[k] = i; });
  const G = {}; B.games.forEach((g) => { G[g.id] = g; });
  const floor = (B.seasons.filter((x) => x.number === B.season)[0] || {}).playoff_min_gp || 1;
  const tag = {}; (B.people || []).forEach((x) => { tag[x.id] = x.gamertag; });
  const sk = {}, gl = {};
  Object.keys(B.box.byGame).forEach((gid) => { const g = G[gid]; if (!g || g.status !== "final" || g.voided || (g.stage || "regular") !== "regular") return;
    const seen = {}; B.box.byGame[gid].forEach((r) => { const pid = r[bx.profile_id]; if (!pid) return; const goalie = !!r[bx.is_goalie], o = goalie ? (gl[pid] = gl[pid] || { gp: 0, t: 0 }) : (sk[pid] = sk[pid] || { gp: 0, g: 0, a: 0 });
      if (!seen[pid + goalie]) { o.gp++; seen[pid + goalie] = 1; } if (goalie) o.t += r[bx.goals_against] || 0; else { o.g += r[bx.goals] || 0; o.a += r[bx.assists] || 0; } }); });
  const out = [], add = (cat, src, tot, high) => Object.keys(src).filter((x) => src[x].gp >= floor).map((x) => ({ x, gp: src[x].gp, t: tot(src[x]) }))
    .sort((a, b) => (high ? b.t / b.gp - a.t / a.gp : a.t / a.gp - b.t / b.gp) || b.gp - a.gp).slice(0, top)
    .forEach((r, i) => out.push({ category: cat, place: i + 1, profile_id: r.x, gamertag: tag[r.x] || null, gp: r.gp, total: r.t, per_game: Math.round(r.t / r.gp * 1000) / 1000 }));
  add("points_title", sk, (o) => o.g + o.a, true); add("goals_title", sk, (o) => o.g, true); add("assists_title", sk, (o) => o.a, true); add("goaltending_title", gl, (o) => o.t, false);
  return out;
}
const CLUBS = D.teams.map((t) => t.code);

console.log("## the data");
A("the recording holds the regular season's box scores, keyed by club code", boxed.length > 127 && boxed.every((g) => D.box.byGame[g].every((r) => r[ix.team] === GAMES[g].home || r[ix.team] === GAMES[g].away)), boxed.length);
A("no skater line carries a goalie figure", rows.filter((r) => !r.goalie).every((r) => !r.dsv && !r.sop && !r.psv && !r.psa));

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const unexpected = [];
  const READS = { tables: { pickup_stats: [], market_waivers: [], market_pool_requests: [], market_boards: [], market_bid_nights: [], market_lots: [], market_bids: [], game_lineups: [] },
    rpcs: { market_calendar: mock.ok({}), market_pool: mock.ok([]), market_club_state: mock.ok(null), statistical_title_board: (a) => { TBCALLS.push(a); return mock.ok(titleBoard(D, a.p_top)); } } };
  async function page(hash, width, rpcs) {
    const ctx = await b.newContext(width ? { viewport: { width, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("s2.introSeen", "true"); localStorage.setItem("s2.survey", JSON.stringify({ done: "2026-10-23T00:00:00.000Z", from: "daily" })); } catch (e) {} });
    await mock.install(ctx, { live: true, persona: "anon", tables: READS.tables, rpcs: Object.assign({}, READS.rpcs, rpcs || {}) });
    ctx.on("close", () => unexpected.push(...mock.unexpected(ctx)));
    const p = await ctx.newPage();
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p.goto((rpcs ? S2_BASE : BASE) + hash);
    await p.waitForFunction(() => window.S2 && S2.M && S2.LIVE && S2.auth && S2.auth.sub && document.querySelector("#app main, #app .page, #app section"), null, { timeout: 30000 });
    await p.waitForTimeout(250);
    return p;
  }
  const heads = (p, sel) => p.$$eval(sel + " thead th", (t) => t.map((x) => (x.getAttribute("data-label") || x.textContent).replace(/\s+/g, " ").replace(/[▲▼↑↓]/g, "").trim()));

  console.log("## clubs, against the raw lines");
  let p = await page("#/stats?tab=teams");
  const model = await p.evaluate(() => { const M = S2.M, o = {}; M.teams.forEach((t) => { o[t.code] = M.clubStats(t.code); }); return o; });
  CLUBS.forEach((c) => {
    const mine = rows.filter((r) => r.club === c), a = model[c], g = boxed.filter((x) => D.box.byGame[x].some((r) => r[ix.team] === c)).length, per = (k) => sum(mine, k) / g;
    A(c + ": hits, blocks, takeaways, giveaways, interceptions and PIM per game add up every line", a.bx === g && ["hits", "blk", "tk", "gv", "int", "pim"].every((k) => near(a[k + "_pg"], per(k))), { bx: a.bx, g });
    /* GAP: EA's club figures are not in s2_league, so the real site has none to show; never the players' possession */
    A(c + ": time on attack and passing are EA's club figures, which the league read does not carry (a dash until it does)", a.toa_pg == null && a.pass_pct == null, [a.toa_pg, a.pass_pct]);
    A(c + ": the club's faceoff percentage counts every line at every position", near(a.fo_pct, sum(mine, "fow") / sum(mine, "fot")), a.fo_pct);
  });
  const rankChk = await p.evaluate(() => { const M = S2.M, codes = M.teams.map((t) => t.code), pick = (k) => codes.map((c) => M.clubRank(c, k));
    return { gv: pick("gv_pg"), hits: pick("hits_pg"), toa: pick("toa_pg"), none: M.clubRank("BOS", "nope"), nobody: M.clubRank("XXX", "hits_pg"), disp: M.clubDisplay("toa_pg", 501), dash: M.clubDisplay("hits_pg", null) }; });
  const first = (list) => list.filter((x) => x.rank === 1)[0];
  A("clubs rank best first: most hits is 1st", first(rankChk.hits).value === Math.max.apply(null, rankChk.hits.map((x) => x.value)), first(rankChk.hits));
  A("fewest giveaways is 1st, and says fewer is better", first(rankChk.gv).value === Math.min.apply(null, rankChk.gv.map((x) => x.value)) && first(rankChk.gv).better === "low");
  A("a rank says its place among 8 clubs", /^(Tied for )?\d+(st|nd|rd|th) of 8$/.test(rankChk.hits[0].text), rankChk.hits[0].text);
  A("time on attack reads minutes and seconds; a missing figure reads as a dash", rankChk.disp === "8:21" && rankChk.dash === "–", rankChk.disp);
  A("a stat or club the model does not know returns null, not a throw", rankChk.none === null && rankChk.nobody === null);

  console.log("## club shots, EA's count");
  /* EA's club count is the games' own shots (games.home_shots and away_shots, v4.45) */
  const clubShots = (g, c) => GAMES[g][c === GAMES[g].home ? "home_shots" : "away_shots"];
  A("every regular-season game with a box score has EA's club shots for both clubs", boxed.every((g) => clubShots(g, GAMES[g].home) != null && clubShots(g, GAMES[g].away) != null));
  CLUBS.forEach((c) => {
    const own = boxed.filter((g) => GAMES[g].home === c || GAMES[g].away === c), sf = own.reduce((n, g) => n + clubShots(g, c), 0), against = own.reduce((n, g) => n + clubShots(g, c === GAMES[g].home ? GAMES[g].away : GAMES[g].home), 0);
    A(c + ": shots for are EA's club counts, and shots against the opponents'", model[c].sog === sf && model[c].sa === against, [model[c].sog, sf, model[c].sa, against]);
  });
  const faced = (g, c) => rows.filter((r) => r.gid === g && r.club !== c && r.goalie).length ? sum(rows.filter((r) => r.gid === g && r.club !== c && r.goalie), "sa") : null;
  let same = 0, within = 0, all = 0, linesSame = 0, over = 0;
  boxed.forEach((g) => [GAMES[g].home, GAMES[g].away].forEach((c) => { const v = clubShots(g, c), f = faced(g, c), ls = sum(rows.filter((r) => r.gid === g && r.club === c && !r.goalie), "sog"); all++; if (v === f) same++; if (Math.abs(v - f) <= 1) within++; if (v === ls) linesSame++; if (ls > v) over++; }));
  A("a club's shots agree with what the other goaltender faced, far better than the skaters' shots do", same / all > 0.85 && within / all > 0.98 && linesSame / all < 0.3, { same, within, linesSame, all });
  A("the skaters' shots never add up to more than the club's", over === 0, over);

  console.log("## players, against the raw lines");
  const lines = await p.evaluate(() => S2.M.lines({}).map((l) => ({ pid: l.pid, tag: l.tag, role: l.role, group: l.group, gp: l.gp, fow: l.fow, fot: l.fot, fo_pct: l.fo_pct, fo_games: l.fo_games, onnet_pct: l.onnet_pct, sog: l.sog, sat: l.sat, dsv: l.dsv, sop: l.sop, psv: l.psv, psa: l.psa, dsv_pg: l.dsv_pg, sop_pg: l.sop_pg, psv_pct: l.psv_pct, foRank: S2.M.rank(l, "fo_pct") })));
  const sk = lines.filter((l) => l.role === "S"), gl = lines.filter((l) => l.role === "G");
  const off = sk.filter((l) => { const c = rows.filter((r) => r.pid === l.pid && !r.goalie && r.pos === "C"), fot = sum(c, "fot"), fow = sum(c, "fow");
    return l.fow !== fow || l.fot !== fot || l.fo_games !== (c.length || undefined) && !(c.length === 0 && !l.fo_games) || !near(l.fo_pct, fot ? fow / fot : null); });
  A("every skater's faceoffs and FO% come from their games at center alone", off.length === 0, off.slice(0, 4));
  /* the line before the center rule: every faceoff a skater took, at every position */
  const raw = {}; rows.filter((r) => !r.goalie).forEach((r) => { const o = raw[r.pid] = raw[r.pid] || { fot: 0, sog: 0, sat: 0 }; o.fot += r.fot; o.sog += r.sog; o.sat += r.sat; });
  const cut = sk.filter((l) => raw[l.pid] && raw[l.pid].fot > 0 && raw[l.pid].fot !== l.fot);
  A("the rule changes real lines: players who took faceoffs away from center lose those faceoffs", cut.length > 0, cut.length);
  const wing = sk.filter((l) => raw[l.pid] && raw[l.pid].fot > 0 && !l.fot);
  A("a player who never played center has no FO%, however many faceoffs they took elsewhere", wing.length > 0 && wing.every((l) => l.fo_pct === null && l.foRank === null), wing.length);
  A("FO% ranks only among centers", sk.filter((l) => l.foRank).length > 0 && sk.filter((l) => l.foRank).every((l) => l.group === "C"));
  A("a club's faceoffs still include what its players took away from center", CLUBS.some((c) => { const mine = rows.filter((r) => r.club === c); return sum(mine.filter((r) => r.pos === "C"), "fot") !== sum(mine, "fot"); }));
  A("shots on net is shots on goal out of shot attempts, up to 100%", sk.every((l) => near(l.onnet_pct, l.sat ? Math.min(1, l.sog / l.sat) : null)));
  const outrun = sk.filter((l) => l.sat && l.sog > l.sat);
  A("the commissioner's cap: nobody reads over 100%, and every line whose shots outrun its attempts reads exactly 100%", sk.every((l) => l.onnet_pct == null || l.onnet_pct <= 1) && outrun.every((l) => l.onnet_pct === 1), outrun.length);
  A("the cap does not touch a player's shots or attempts", sk.filter((l) => raw[l.pid]).every((l) => l.sog === raw[l.pid].sog && l.sat === raw[l.pid].sat));
  const gOff = gl.filter((l) => { const c = rows.filter((r) => r.pid === l.pid && r.goalie); return l.dsv !== sum(c, "dsv") || l.sop !== sum(c, "sop") || l.psv !== sum(c, "psv") || l.psa !== sum(c, "psa"); });
  A("every goaltender's desperation saves, shutout periods and penalty shots add up their games", gOff.length === 0, gOff.slice(0, 3));
  A("the per-game rates and the penalty shot percentage follow", gl.every((l) => near(l.dsv_pg, l.gp ? l.dsv / l.gp : null) && near(l.sop_pg, l.gp ? l.sop / l.gp : null) && near(l.psv_pct, l.psa ? l.psv / l.psa : null)));
  A("a skater's line carries none of the goalie rates", sk.every((l) => l.dsv_pg === null && l.sop_pg === null && l.psv_pct === null));

  console.log("## Stats: the tables");
  const tm = await p.evaluate(() => { const T = document.querySelector("#clT") || document.querySelector("table.lg-st"), hs = [].map.call(T.querySelectorAll("thead th"), (x) => x.textContent.replace(/\s+/g, " ").trim()), row = T.querySelector("tbody tr");
    return { hs, cells: [].map.call(row.children, (x) => x.textContent.trim()), name: row.querySelector("a").getAttribute("href"), lead: document.querySelector("#hcl2") && document.querySelector("#hcl2").closest("section").textContent.replace(/\s+/g, " ").slice(0, 200) }; });
  const want = ["TOA/GP", "PASS%", "FO%", "HIT/GP", "BLK/GP", "TK/GP", "INT/GP", "GV/GP", "PIM/GP"];
  A("the club table has all nine team stats", want.every((h) => tm.hs.some((x) => x.indexOf(h) === 0)), tm.hs);
  const c0 = tm.name.split("/").pop(), at = (h) => tm.cells[tm.hs.findIndex((x) => x.indexOf(h) === 0)];
  const exp = await p.evaluate((c) => { const M = S2.M, a = M.clubStats(c), o = {}; [["TOA/GP", "toa_pg"], ["PASS%", "pass_pct"], ["FO%", "fo_pct"], ["HIT/GP", "hits_pg"], ["BLK/GP", "blk_pg"], ["TK/GP", "tk_pg"], ["INT/GP", "int_pg"], ["GV/GP", "gv_pg"], ["PIM/GP", "pim_pg"]].forEach((x) => { o[x[0]] = M.clubDisplay(x[1], a[x[1]]); }); return o; }, c0);
  A("each cell prints the model's figure for that club", want.every((h) => at(h) === exp[h]), { cells: tm.cells, exp });
  await p.click('#clT thead th:has-text("PIM/GP") button, #clT thead th:has-text("PIM/GP")');
  await p.waitForTimeout(150);
  const pimSort = await p.evaluate(() => { const T = document.querySelector("#clT"), hs = [].map.call(T.querySelectorAll("thead th"), (x) => x.textContent.trim()), i = hs.findIndex((x) => x.indexOf("PIM/GP") === 0); return [].map.call(T.querySelectorAll("tbody tr"), (r) => parseFloat(r.children[i].textContent)); });
  A("sorting by PIM/GP puts the fewest first", pimSort.every((v, i) => !i || pimSort[i - 1] <= v), pimSort);
  await p.context().close();

  p = await page("#/stats?tab=skaters");
  const skh = await p.$$eval("#skT thead th", (t) => t.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  A("the skater table adds NET% and keeps FO%", skh.some((x) => x.indexOf("NET%") === 0) && skh.some((x) => x.indexOf("FO%") === 0), skh);
  const foTitle = await p.$$eval("#skT thead th", (t) => { const h = t.filter((x) => x.textContent.indexOf("FO%") === 0)[0]; return (h.getAttribute("title") || (h.querySelector("[title]") || {}).title || "") + h.innerHTML; });
  A("the FO% heading says center games only", /games played at center/.test(foTitle), foTitle.slice(0, 200));
  await p.click('#skT thead button:has-text("FO%")'); await p.waitForTimeout(150);
  const foSort = await p.evaluate(() => { const T = document.querySelector("#skT"), hs = [].map.call(T.querySelectorAll("thead th"), (x) => x.textContent.trim()), i = hs.findIndex((x) => x.indexOf("FO%") === 0), by = {}; S2.M.lines({ role: "S" }).forEach((l) => { by[l.tag] = l; });
    return [].map.call(T.querySelectorAll("tbody tr"), (r) => { const l = by[r.children[0].querySelector(".lg-tag") ? r.children[0].querySelector("a").firstChild.textContent : r.children[0].textContent.trim()] || S2.M.lines({ role: "S" }).filter((x) => r.children[0].textContent.indexOf(x.tag) === 0)[0]; return { tag: l.tag, games: l.fo_games || 0, pct: l.fo_pct, gray: r.children[i].classList.contains("lg-un"), title: r.children[i].getAttribute("title") }; }); });
  const lastSettled = foSort.map((x) => x.games >= 6).lastIndexOf(true), firstUn = foSort.findIndex((x) => x.games < 6);
  A("sorted by FO%, every line with 6 games at center comes before the rest, however few it took elsewhere", lastSettled >= 0 && firstUn === lastSettled + 1, foSort.slice(0, 3));
  A("the top of the column is a real center, with no three-game sample above them", foSort[0].games >= 6, foSort[0]);
  const un6 = foSort.filter((x) => x.games < 6 && x.pct != null);
  A("a line under 6 games at center reads gray and says why", un6.length > 0 && un6.every((x) => x.gray && /games at center/.test(x.title)), un6.slice(0, 2));
  A("a settled line in that column carries no gray", foSort.filter((x) => x.games >= 6).every((x) => !x.gray));
  A("About this data explains FO% and NET%", await p.evaluate(() => /FO% counts only games played at center/.test(document.body.textContent) && /NET% is shots on goal out of shot attempts, capped at 100%/.test(document.body.textContent)));
  await p.context().close();

  p = await page("#/stats?tab=goalies");
  const gkh = await p.$$eval("#gkT thead th", (t) => t.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  A("the goaltender table adds DS, SOP and PS%", ["DS", "SOP", "PS%"].every((h) => gkh.some((x) => x.indexOf(h) === 0)), gkh);
  const gkc = await p.evaluate(() => { const M = S2.M, T = document.querySelector("#gkT"), hs = [].map.call(T.querySelectorAll("thead th"), (x) => x.textContent.trim()), at = (r, h) => r.children[hs.findIndex((x) => x.indexOf(h) === 0)];
    const lines = M.lines({ role: "G" }), byTag = {}; lines.forEach((l) => { byTag[l.tag] = l; });
    return [].map.call(T.querySelectorAll("tbody tr"), (r) => { const l = byTag[r.querySelector("a").textContent.replace(/Skater$/, "").trim()] || lines.filter((x) => r.querySelector("a").textContent.indexOf(x.tag) === 0)[0]; return { tag: l && l.tag, ds: at(r, "DS").textContent.trim(), sop: at(r, "SOP").textContent.trim(), ps: at(r, "PS%").textContent.trim(), want: l && [String(l.dsv), String(l.sop), l.psa ? M.display("psv_pct", l.psv_pct) : "–"] }; }); });
  A("each goaltender's row prints their DS, SOP and PS%", gkc.length > 10 && gkc.every((r) => r.want && r.ds === r.want[0] && r.sop === r.want[1] && r.ps === r.want[2]), gkc.filter((r) => !r.want || r.ds !== r.want[0] || r.sop !== r.want[1] || r.ps !== r.want[2]).slice(0, 3));
  A("a goaltender who faced no penalty shot reads a dash, one who did reads a save percentage", gkc.some((r) => r.ps === "–") && gkc.some((r) => /^(1\.000|\.\d{3})$/.test(r.ps)));
  const psTips = await p.$$eval('#gkT td span[title*="penalty shot"]', (s) => s.map((x) => x.getAttribute("title")));
  A("the PS% tooltip counts the shots in good English, one for each goaltender who faced one", psTips.length === gl.filter((l) => l.psa).length && psTips.every((x) => /^\d+ of (1 penalty shot|\d+ penalty shots) stopped$/.test(x)), psTips);
  await p.context().close();

  console.log("## the club page");
  p = await page("#/club/BOS?tab=stats");
  await p.waitForSelector("#pfcTsH");
  const cl = await p.evaluate(() => { const s = document.querySelector("#pfcTsH").closest("section"), M = S2.M;
    return { h: document.querySelector("#pfcTsH").textContent.trim(), labels: [].map.call(s.querySelectorAll(".pf-pb-l"), (x) => x.textContent.trim()), vals: [].map.call(s.querySelectorAll(".pf-pb-v b"), (x) => x.textContent.trim()),
      groups: [].map.call(s.querySelectorAll(".pfx-sub"), (x) => x.textContent.trim()), order: [].map.call(document.querySelectorAll("#pfcPanel section[aria-labelledby]"), (x) => x.getAttribute("aria-labelledby")), text: s.innerText, want: ["toa_pg", "pass_pct", "fo_pct", "hits_pg", "blk_pg", "tk_pg", "int_pg", "gv_pg", "pim_pg"].map((k) => M.clubRank("BOS", k)) }; });
  /* GAP (above): a stat the league read carries no figure for has no bar (time on attack and passing on the real site today) */
  const NINE = ["Time on attack", "Passing", "Faceoffs won", "Hits", "Blocks", "Takeaways", "Interceptions", "Giveaways", "Penalty minutes"], has = cl.want.map((x) => !!x);
  A("the club page shows the nine stats it has a figure for, grouped, in their order", cl.labels.join() === NINE.filter((x, i) => has[i]).join() && has.slice(2).every(Boolean) && cl.groups.length === 3, cl.labels);
  A("each prints the model's value", cl.vals.join() === cl.want.filter(Boolean).map((x) => x.display).join(), { got: cl.vals, want: cl.want.filter(Boolean).map((x) => x.display) });
  A("the headline names a real rank", /(Boston leads the league in|of 8 in)/.test(cl.h), cl.h);
  A("it says what the bars count, and fewer is better on giveaways and penalty minutes", cl.text.indexOf("counting the " + model.BOS.bx + " games with a box score") >= 0 && (cl.text.match(/fewer is better/g) || []).length === 2, cl.text.slice(0, 300));
  A("no undefined or NaN in the section", !/undefined|NaN/.test(cl.text), cl.text);
  await p.click('[data-stats="G"], [data-v="G"], button:has-text("Goaltenders")');
  await p.waitForTimeout(200);
  const cgh = await p.$$eval("#pfcStatsB thead th", (t) => t.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  A("the club's goaltender lines add DS, SOP and PS", ["DS", "SOP", "PS"].every((h) => cgh.some((x) => x.indexOf(h) === 0)), cgh);
  await p.context().close();

  console.log("## the game page");
  const gid = boxed.filter((g) => rows.some((r) => r.gid === g && r.goalie && r.psa > 0 && r.psv > 0))[0];
  p = await page("#/game/" + gid);
  await p.waitForSelector(".td-tape-game");
  const gp = await p.evaluate((id) => { const g = S2.M.game(id), T = document.querySelector(".td-tape-game"), row = (k) => [].filter.call(T.querySelectorAll(".td-tape-r"), (r) => r.querySelector(".k").textContent.trim() === k)[0], val = (r) => (r ? [].map.call(r.querySelectorAll(".v"), (x) => x.textContent.trim()) : null);
    return { labels: [].map.call(T.querySelectorAll(".td-tape-r .k"), (x) => x.textContent.trim()), toa: val(row("Time on attack")), pim: val(row("Penalty minutes")), blk: val(row("Blocks")), int: val(row("Interceptions")), pass: val(row("Passing")),
      A: g.totals[g.away], H: g.totals[g.home], about: document.body.textContent, gkh: [].map.call(document.querySelectorAll(".td-box"), (t) => [].map.call(t.querySelectorAll("thead th"), (x) => x.textContent.trim()).join()), cells: [].map.call(document.querySelectorAll(".td-box tbody tr"), (r) => r.innerText) }; }, gid);
  A("the game's club stats list faceoffs, hits, blocks, takeaways, interceptions, giveaways and penalty minutes", ["Faceoffs won", "Hits", "Blocks", "Takeaways", "Interceptions", "Giveaways", "Penalty minutes"].every((k) => gp.labels.indexOf(k) >= 0), gp.labels);
  const ga = GAMES[gid].away, gh = GAMES[gid].home, cs = (c) => clubShots(gid, c);
  /* GAP (above): no EA club figure in the league read, never the players' possession. QA visual 33 (2026-11-25): a row
     neither club has a figure for is not drawn (it read "- Time on attack -" on every game), so while the league read
     carries none the two rows are absent, and they return by themselves once it does */
  A("time on attack and passing are EA's club figures: no row while the league read carries none for either club", gp.A.toa == null && gp.H.toa == null && gp.A.pass_pct == null && gp.H.pass_pct == null && gp.toa === null && gp.pass === null, [gp.toa, gp.pass]);
  A("blocks, interceptions and penalty minutes add up the lines", gp.blk[0] === String(gp.A.blk) && gp.int[1] === String(gp.H.int) && gp.pim[0] === String(gp.A.pim), [gp.blk, gp.int, gp.pim]);
  const footer = await p.evaluate((id) => { const g = S2.M.game(id); return [g.away, g.home].map((c) => { const box = [].filter.call(document.querySelectorAll(".td-boxclub"), (x) => x.dataset.club === c)[0], T = box.querySelector(".td-box"), hs = [].map.call(T.querySelectorAll("thead th"), (x) => x.textContent.trim()), i = hs.indexOf("SOG"), td = T.querySelector("tfoot tr").children[i]; return { c, shown: td.textContent.trim(), title: td.getAttribute("title"), model: g.totals[c].sog }; }); }, gid);
  A("the Shots row is EA's club count for that game", (await p.evaluate(() => { const r = [].filter.call(document.querySelectorAll(".td-tape-game .td-tape-r"), (x) => x.querySelector(".k").textContent.trim() === "Shots")[0]; return [].map.call(r.querySelectorAll(".v"), (x) => x.textContent.trim()).join(); })) === cs(ga) + "," + cs(gh), [cs(ga), cs(gh)]);
  A("the box score's Totals row prints the same count and says why it can pass the lines", footer.every((x) => x.shown === String(cs(x.c)) && /club count/.test(x.title)), footer);
  A("the headline uses the same count", await p.evaluate((n) => document.querySelector("#tdCsH").textContent.indexOf(n) >= 0, Math.max(cs(ga), cs(gh)) + ""), gp.toa);
  A("About this data says a club's shots can pass its players'", /Shots, time on attack and passing are EA's own club figures/.test(gp.about) && /can run above what its players' shots add up to/.test(gp.about));
  A("the goaltender table adds DS, SOP and PS", gp.gkh.some((h) => /Goaltenders/.test(h) && /DS,SOP,PS/.test(h)), gp.gkh);
  A("the game with a stopped penalty shot prints it", gp.cells.some((c) => /\b1\/1\b/.test(c)), gp.cells.filter((c) => /\//.test(c)).slice(0, 4));
  await p.context().close();

  console.log("## the player page");
  const topG = gl.filter((l) => l.gp >= 6 && l.dsv > 0).sort((x, y) => y.gp - x.gp)[0];
  p = await page("#/player/" + topG.pid);
  await p.waitForFunction(() => document.body.textContent.indexOf("Desperation saves per game") >= 0);
  const pg = await p.evaluate(() => ({ labels: [].map.call(document.querySelectorAll(".pf-pb-l"), (x) => x.textContent.trim()), text: document.body.textContent }));
  A("a goaltender's ranks add desperation saves and shutout periods per game", pg.labels.indexOf("Desperation saves per game") >= 0 && pg.labels.indexOf("Shutout periods per game") >= 0, pg.labels);
  A("the season sentence says the counts", pg.text.indexOf(topG.dsv + " desperation save") >= 0, topG);
  await p.context().close();
  const psG = gl.filter((l) => l.psv > 0)[0];
  p = await page("#/player/" + psG.pid);
  A("a goaltender who faced a penalty shot sees how many they stopped", await p.evaluate((n) => document.body.textContent.indexOf(n + " penalty shot") >= 0, psG.psv + " of " + psG.psa), psG);
  await p.context().close();
  const center = sk.filter((l) => l.foRank && !l.foRank.few)[0];
  p = await page("#/player/" + center.pid);
  await p.waitForFunction(() => document.body.textContent.indexOf("Faceoff win rate at center") >= 0);
  A("a center's ranks show the faceoff rate at center and shots on net", await p.evaluate(() => { const l = [].map.call(document.querySelectorAll(".pf-pb-l"), (x) => x.textContent.trim()); return l.indexOf("Faceoff win rate at center") >= 0 && l.indexOf("Shots on net") >= 0; }), center.tag);
  await p.context().close();
  const w = wing.filter((l) => l.gp >= 6)[0];
  if (w) { p = await page("#/player/" + w.pid); await p.waitForFunction(() => document.querySelector(".pf-pb-l"));
    A("a player with no games at center shows no faceoff rate", await p.evaluate(() => [].every.call(document.querySelectorAll(".pf-pb-l"), (x) => !/Faceoff/.test(x.textContent))), w.tag); await p.context().close(); }

  const lineNoRank = sk.filter((l) => l.gp >= 6 && l.fot > 0 && !l.foRank)[0];
  p = await page("#/player/" + lineNoRank.pid);
  await p.waitForFunction(() => document.querySelector(".pf-pb-l"));
  A("a player with faceoffs at center but no rank still reads their figure on their page", await p.evaluate((w) => document.body.textContent.indexOf(w) >= 0, "At center, " + lineNoRank.fow + " of " + lineNoRank.fot + " faceoff"), lineNoRank);
  await p.context().close();

  console.log("## a phone");
  for (const hash of ["#/stats?tab=teams", "#/stats?tab=goalies", "#/club/BOS?tab=stats", "#/game/" + gid]) {
    p = await page(hash, 375);
    await p.waitForTimeout(250);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    A("at 375px " + hash.slice(0, 22) + " never scrolls sideways", over <= 0, over);
    await p.context().close();
  }

  /* v5.00 swap (e6): the league pages in live mode (?source=live), Season 2 on screen with no game yet. The s2_league read is
     answered from the two anon bodies recorded read-only on 2026-11-24 (~/Developer/cghl-private/fixtures, never in the
     repo), so the checks hold whatever production says today; S2_LIVE_NET=1 lets the real read through instead. */
  console.log("## live mode: an empty Season 2 says so on every league page");
  let r;
  const FIX = path.join(require("os").homedir(), "Developer/cghl-private/fixtures");
  const BODY = { cur: fs.readFileSync(path.join(FIX, "s2_league-anon-2026-11-24b-current.json"), "utf8"), s1: JSON.parse(fs.readFileSync(path.join(FIX, "s2_league-anon-2026-11-24b-season1.json"), "utf8")) };
  /* Season 2 on screen (the private current body, after v4.58), Season 1 at ?season=1 (and the archive read) */
  const LEAGUE2 = { s2_league: (a) => mock.ok(+a.p_season === 1 ? JSON.parse(JSON.stringify(BODY.s1)) : JSON.parse(BODY.cur)) };
  const livePage = (hash, season) => page((season ? "?season=" + season : "") + hash, null, LEAGUE2);
  const look = (pg) => pg.evaluate(() => { const t = (s) => ((document.querySelector(s) || {}).textContent || "").trim();
    return { view: S2.M.view.name, kicker: t(".lg-hero .kicker"), h1: t(".lg-hero h1"), lede: t(".lg-hero .lede-l"), empty: t(".empty-state:not(#mvHost .empty-state) .t-head"), emptyFoot: t(".empty-state:not(#mvHost .empty-state) .t-foot"),   /* QA visual 6: the moves log's own empty is S2.empty too; this reads the page's */
      back: [...document.querySelectorAll(".empty-state .empty-acts a")].map((a) => [a.textContent, a.getAttribute("href")]), tables: document.querySelectorAll("#page .lg-tbl").length,
      tabs: !!document.querySelector("#stSeg"), zeroRow: /leads the league on 0 points|0 points in 0 games/.test(document.getElementById("page").textContent), page: document.getElementById("page").textContent }; });
  p = await livePage("#/standings");
  r = await look(p);
  A("live: the season on screen is Season 2, read from s2_league", r.view === "Season 2", r.view);
  A("live standings: the hero names Season 2 and its puck drop, never a table of zeros", r.kicker === "Standings, Season 2" && /^Season 2 starts December \d+$/.test(r.h1) && r.tables === 0 && !r.tabs && !r.zeroRow, r);
  A("live standings: the empty state says nothing is played yet, when play starts, and opens Season 1's final standings", r.empty === "No Season 2 games played yet" && /Puck drop is \w+, December \d+\./.test(r.emptyFoot) &&
    r.back.length === 1 && r.back[0][0] === "Season 1 final standings" && /[?&]season=1(&|#|$)/.test(r.back[0][1]) && /#\/standings$/.test(r.back[0][1]), r.back);
  await p.context().close();
  for (const tab of ["leaders", "skaters", "goalies", "teams"]) {
    p = await livePage("#/stats" + (tab === "leaders" ? "" : "?tab=" + tab));
    r = await look(p);
    A("live stats, " + tab + ": the hero names Season 2 and the tab shows its empty state, no table", r.kicker === "Stats, Season 2" && r.h1 === "Season 2 stats start with the first game" && r.empty === "No Season 2 games played yet" && r.tables === 0 && r.back.length === 1, r);
    await p.context().close();
  }
  p = await livePage("#/stats?tab=players");
  r = await p.evaluate(() => ({ signed: S2.M.players.filter((x) => !x.seat && !x.rostered && x.signup && !x.signup.waivedAt && x.signup.status !== "declined").length, chips: [...document.querySelectorAll("#dirSeg button")].map((x) => x.textContent.replace(/\s+/g, " ").trim()),
    rows: document.querySelectorAll(".lg-dir-row").length, all: S2.M.players.length, about: ((document.querySelector("#lgAboutB") || {}).textContent || "") }));
  A("live players: every member in the records, the season's sign-ups labeled Signed up (not Not signed up)", r.rows === r.all && r.signed > 0 && r.chips.indexOf("Signed up " + r.signed) >= 0 && /for Season 2/.test(r.about) && !/Source: all 0/.test(r.about), r.chips);
  await p.context().close();
  p = await livePage("#/stats?tab=awards");
  r = await p.evaluate(() => ({ kicker: ((document.querySelector(".lg-hero .kicker") || {}).textContent || ""), cup: !!document.querySelector(".lg-sc"), stars: !!document.getElementById("hstars"), note: ((document.querySelector(".lg-rec-note") || {}).textContent || "") }));
  A("live awards: Season 1's trophy room stays (the archive read), and no empty Three Stars board for Season 2", r.kicker === "Awards, Season 1" && r.cup && !r.stars && /Season 1’s have not been awarded yet/.test(r.note), r);
  await p.context().close();
  p = await livePage("#/clubs");
  r = await p.evaluate(() => ({ kicker: document.querySelector(".lg-hero .kicker").textContent, h1: document.querySelector(".lg-hero h1").textContent, lede: document.querySelector(".lg-hero .lede-l").textContent,
    recs: document.querySelectorAll(".lg-ct .lg-ct-rec, .lg-ct .lg-ct-rk").length, tiles: document.querySelectorAll(".lg-cdiv .lg-ct").length, moves: document.querySelector("#mvHead p").textContent }));
  A("live clubs: Season 2's clubs with no rank or record yet, and the moves log waiting for the draft", r.kicker === "Clubs, Season 2" && r.h1 === "Eight clubs" && r.tiles === 8 && r.recs === 0 &&
    /Records start with Season 2’s first final\./.test(r.lede) && /^Moves appear here from the draft on Sat, Dec \d+\. Only completed moves are public\.$/.test(r.moves) && !/\b0 (trades|signings|waivers|placements)\b|since the draft/.test(r.moves) && /after the draft on Sat, Dec \d+ lands below/.test(r.lede), r);   /* QA worst 11 and visual 30 (2026-11-25): no row of zeros, no "since" a draft still to come */
  await p.context().close();
  p = await livePage("#/season");
  r = await p.evaluate(() => ({ k: document.querySelector("#hnow").closest(".sec-head").querySelector(".kicker").textContent, h: document.querySelector("#hnow").textContent, seg: [...document.querySelectorAll("#snSeg button")].map((x) => x.textContent) }));
  A("live season page: Season 2 has not started, never that its regular season is complete", r.k === "Season 2 now" && r.h === "Season 2 has not started" && JSON.stringify(r.seg) === JSON.stringify(["Season 2", "Season 1"]), r);
  await p.context().close();
  /* the first final of Season 2 reaches an open tab: S2.reread (a scores pulse) rebuilds S2.M in place and the page repaints
     through S2.route(true) (live.js quietRepaint). The league pages read the season again at render (league.js sync()),
     so the empty state goes with no reload (review 2026-11-24: it was read once at load and stayed all night) */
  for (const hash of ["#/standings", "#/stats?tab=skaters", "#/clubs"]) {
    p = await livePage(hash);
    const before = await look(p);
    r = await p.evaluate(() => {
      const body = JSON.parse(JSON.stringify(S2.data.body)), t = body.teams, at = new Date(Date.now() - 3 * 3600e3).toISOString();
      body.games = [{ id: "00000000-0000-4000-8000-0000000000f1", home: t[0].code, away: t[1].code, home_team_id: t[0].id, away_team_id: t[1].id, week: 1, stage: "regular", status: "final",
        voided: false, forfeit: null, forfeit_team_id: null, went_ot: false, home_score: 3, away_score: 2, scheduled_at: at, created_at: at }];
      S2.buildModel(body, S2.data.archive); S2.route(true);
      return { home: t[0].code, finals: S2.M.view.finals };
    });
    await p.waitForTimeout(400);
    const after = await look(p);
    const tiles = await p.evaluate(() => document.querySelectorAll(".lg-ct .lg-ct-rec").length);
    A("live " + hash + ": the first final, rebuilt in place, takes the empty state away with no reload", before.empty === "No Season 2 games played yet" || /Records start with/.test(before.lede) ? (r.finals === 1 && !after.empty && !/Records start with/.test(after.lede) &&
      (hash === "#/clubs" ? tiles === 8 : after.tables > 0)) : false, { before: [before.empty, before.tables], after: [after.empty, after.tables, after.kicker, after.h1], tiles, r });
    await p.context().close();
  }
  p = await livePage("#/standings", 1);
  r = await look(p);
  A("live, ?season=1: Season 1's tables are back, every label naming Season 1", r.view === "Season 1" && r.tables === 2 && /^Standings, /.test(r.kicker) && !r.empty, r);
  await p.context().close();
  p = await livePage("#/stats?tab=skaters", 1);
  r = await p.evaluate(() => ({ cap: (document.querySelector("#skT caption") || {}).textContent, about: document.querySelector("#lgAboutB").textContent }));
  A("live, ?season=1: the skater table and its source name Season 1", r.cap === "Skater lines, Season 1" && /^Season 1 regular season/.test(r.about) && /Season 1 finals/.test(r.about), r);
  await p.context().close();
  /* QA visual 3 (2026-11-25, a blocker): this check used to pin "The title race is not loaded on this page." in all four
     columns, because no page read the race. The finding's ruling: never show that sentence; the page reads the league's
     one definition, statistical_title_board, for the season on screen, five a title */
  const S1ID = BODY.s1.seasons.filter((x) => x.number === 1)[0].id, B1 = titleBoard(BODY.s1, 5), seen = [];
  p = await page("?season=1#/stats", null, Object.assign({}, LEAGUE2, { statistical_title_board: (a) => { seen.push(a); return mock.ok(titleBoard(BODY.s1, a.p_top)); } }));
  await p.waitForFunction(() => document.querySelectorAll(".lg-tt-hero").length === 4 || document.querySelector(".lg-tt [role=alert]"), null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1500);   /* the first board enters with its numbers counting up (S2.countUp): read them where they land */
  r = await p.evaluate(() => ({ partial: !!S2.M.partial.titles, old: /not loaded on this page/.test(document.getElementById("page").textContent),
    cols: [...document.querySelectorAll(".lg-tt")].map((c) => ({ h: c.querySelector("h3").textContent, tag: (c.querySelector(".lg-tt-tag") || {}).textContent || null, v: (c.querySelector(".lg-tt-val .d-num") || {}).textContent || null, n: c.querySelectorAll(".lg-tt-list li").length })) }));
  const tbWant = ["points_title", "goals_title", "assists_title", "goaltending_title"].map((k) => { const rows = B1.filter((x) => x.category === k); return { tag: rows[0] && rows[0].gamertag, v: rows[0] && rows[0].per_game.toFixed(2), n: rows.length - 1 }; });
  A("live, ?season=1: the Leaders tab reads statistical_title_board once, for Season 1's id, five a title", seen.length === 1 && seen[0].p_season === S1ID && seen[0].p_top === 5, seen);
  A("live, ?season=1: each title column is the board's: its leader, the rate to two decimals and the chasers", !r.partial && !r.old && r.cols.length === 4 && r.cols.every((c, i) => c.tag === tbWant[i].tag && c.v === tbWant[i].v && c.n === tbWant[i].n), { cols: r.cols.map((c) => [c.v, c.n]), want: tbWant.map((w) => [w.v, w.n]) });
  await p.click('#sxSeg button[data-v="goalies"]'); await p.waitForTimeout(300); await p.click('#sxSeg button[data-v="leaders"]'); await p.waitForTimeout(400);
  A("live, ?season=1: a tab switch keeps the board without reading it again", seen.length === 1 && (await p.evaluate(() => document.querySelectorAll(".lg-tt-hero").length)) === 4, seen.length);
  await p.context().close();
  const errsBefore = errors.length;
  p = await page("?season=1#/stats", null, Object.assign({}, LEAGUE2, { statistical_title_board: mock.fail("57014", "canceling statement due to statement timeout") }));
  await p.waitForTimeout(600);
  r = await p.evaluate(() => ({ said: [...document.querySelectorAll(".lg-tt [role=alert]")].map((x) => x.textContent), retry: document.querySelectorAll('.lg-tt [data-tb="retry"]').length, old: /not loaded on this page/.test(document.getElementById("page").textContent) }));
  A("live, ?season=1: a failed read says so in each column with the reason and a Try again, never the old sentence", r.said.length === 4 && r.said.every((t) => t === "The title race did not load. canceling statement due to statement timeout") && r.retry === 4 && !r.old, r);
  await p.context().close();
  /* that failure was the point of the check: its console lines (the 400 and the page's own fail-loud line) are expected */
  errors.splice(errsBefore, errors.length - errsBefore, ...errors.slice(errsBefore).filter((e) => !/status of 400|the title race could not be read/.test(e)));

  console.log("## QA 2026-11-25: the type floor, the tag's contrast and fingertips (visual 28, phone 1, 2, 10, 11, 13)");
  const TINY = () => [...document.querySelectorAll("#page *")].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getClientRects().length &&
    getComputedStyle(el).visibility !== "hidden" && parseFloat(getComputedStyle(el).fontSize) < 10.99).map((el) => el.tagName + "." + String(el.getAttribute("class") || "").replace(/ /g, "."));
  for (const hash of ["#/stats?tab=skaters", "#/stats", "#/standings", "#/standings?view=race", "#/clubs?view=moves", "#/today"]) {
    p = await page(hash, 390);
    r = await p.evaluate(TINY);
    A(hash + " at 390: no text under the type scale's 11 px floor", r.length === 0, r.slice(0, 6));
    await p.context().close();
  }
  p = await page("#/stats?tab=skaters");
  r = await p.evaluate(() => { const t = document.querySelector("#skT .lg-tag"); if (!t) return null; const c = getComputedStyle(t);
    const ch = (s) => s.match(/[\d.]+/g).map(Number), fg = ch(c.color), bg = ch(c.backgroundColor), a = bg[3] == null ? 1 : bg[3];
    const under = ch(getComputedStyle(t.closest("th, td") || document.body).backgroundColor), mix = [0, 1, 2].map((i) => bg[i] * a + (under[3] === 0 ? 255 : under[i]) * (1 - a));
    const L = (v) => { const x = v.map((u) => { u /= 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }); return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]; };
    const r1 = L(fg.slice(0, 3)), r2 = L(mix); return { size: parseFloat(c.fontSize), ratio: (Math.max(r1, r2) + 0.05) / (Math.min(r1, r2) + 0.05) }; });
  A("a stat tag (.lg-tag) is 11 px or more and reads at AA on its fill", !!r && r.size >= 11 && r.ratio >= 4.5, r);
  await p.context().close();
  p = await page("#/stats", 375);
  r = await p.evaluate(() => {
    const out = { deadGaps: 0, stolen: 0, gaps: 0 };
    [...document.querySelectorAll(".lg-utabs")].filter((x) => x.getClientRects().length).forEach((row) => {
      row.scrollIntoView({ block: "center" });
      const bs = [...row.querySelectorAll("button")], sc = (row.closest(".lg-hscroll") || row).getBoundingClientRect();
      bs.forEach((b, i) => { const r1 = b.getBoundingClientRect(), y = r1.top + r1.height / 2; if (r1.left < sc.left || r1.right > sc.right) return;
        [r1.left + 1, r1.right - 1].forEach((x) => { const e = document.elementFromPoint(x, y); if (!e || e.closest("button") !== b) out.stolen++; });
        const n = bs[i + 1]; if (!n) return; const r2 = n.getBoundingClientRect(); if (r2.right > sc.right) return; out.gaps++;
        const e = document.elementFromPoint((r1.right + r2.left) / 2, y); if (!e || !e.closest("button")) out.deadGaps++; });
    });
    const map = document.querySelector("#mapHost svg"); map.scrollIntoView({ block: "center" }); const mr = map.getBoundingClientRect();
    out.labelsOut = [...map.querySelectorAll("a > text")].filter((t) => { const b = t.getBoundingClientRect(); return b.left < mr.left - 0.5 || b.right > mr.right + 0.5; }).length;
    out.corner = [...document.querySelectorAll(".lg-q-n a")].map((a) => Math.round(a.getBoundingClientRect().height));
    return out; });
  A("375: a tap in the gap between two underline tabs lands on a tab, and no label loses a tap to its neighbor", r.gaps > 0 && r.deadGaps === 0 && r.stolen === 0, r);
  A("375: no play style map label leaves the plot", r.labelsOut === 0, r.labelsOut);
  A("375: each corner name is its own row, 44 px tall under a finger", r.corner.length > 0 && r.corner.every((h) => h >= 44), r.corner);
  await p.context().close();
  p = await page("#/stats?tab=skaters", 375);
  r = await p.evaluate(() => [...document.querySelectorAll("#skT thead th > button")].map((b) => Math.round(b.getBoundingClientRect().width)));
  A("375: every skater table sort heading is at least 44 px wide under a finger", r.length > 5 && r.every((w) => w >= 44), r);
  await p.context().close();
  p = await page("#/club/BOS?tab=stats", 390);
  r = await p.evaluate(() => { const a = document.querySelector(".pf-tbl tbody th a"); a.scrollIntoView({ block: "center" }); const th = a.closest("th").getBoundingClientRect(), ar = a.getBoundingClientRect();
    const at = (x, y) => { const e = document.elementFromPoint(x, y); return e === a || (e && e.closest("a") === a); };
    return { above: at(ar.left + 4, th.top + 3), below: at(ar.left + 4, th.bottom - 3), right: at(th.right - 4, ar.top + ar.height / 2), heads: [...document.querySelectorAll(".pf-tbl thead button")].map((b) => Math.round(b.getBoundingClientRect().width)) }; });
  A("390: the club Stats name cell is the player link's target, and its sort headings are 44 px wide", r.above && r.below && r.right && r.heads.every((w) => w >= 44), r);
  await p.context().close();
  A("no console errors on any page", errors.length === 0, errors.slice(0, 5));
  A("every read the pages made was answered (nothing unexpected reached the fence)", unexpected.length === 0, unexpected.slice(0, 5));
  await b.close();
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
