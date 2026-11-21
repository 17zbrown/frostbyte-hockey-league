/* v4.54 (commissioner, 2026-11-20): "Make sure player stats still appear on player profiles even if they're not on a team
   at the moment", and ruling "Profiles + Season 1 archive". Pins the season on screen (one build path for every season),
   the season switch, the career card, Rule 6.1 and the changelog, and RUNS the shipped career definitions (CG.liveGame,
   CG.countedFinal, CG.gameBox, CG.eaGoalieLine, CG.careerLines with the engine's CG.addStatLine) on made-up games. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 260))); } };

const live = R("src/live/part_live.js"), ui = R("src/live/part4_ui.js"), pub = R("src/live/part5a_public.js"), head = R("src/live/part1_head.html");

/* ---- the season on screen: one build path for every season ---- */
A("the ruling is quoted", /Make sure player stats still appear on player profiles even if they're not on a team\s+at the moment/.test(live) && /Profiles \+ Season 1 archive/.test(live));
A("the league pages that follow the season on screen", /CG\.SEASON_VIEW_ROUTES = \{ standings:1, stats:1, schedule:1, teams:1, team:1, players:1, player:1, awards:1, matchup:1 \};/.test(live));
A("pickCurrentSeason keeps the season in play apart and builds the completed season on screen as the build began", /CG\.LIVE_SEASON = live;/.test(live) &&
  /var _viewUsed = CG\._viewSeasonId \|\| null;/.test(live) && /var v = rows\.find\(function\(s\)\{ return s\.id===_viewUsed && s\.status==="complete"; \}\);/.test(live) &&
  /if \(CG\._viewSeasonId === _viewUsed\) CG\._viewSeasonId = null;\n    \}\n    return live;/.test(live));
A("the box scores are read for the season on screen", /if \(CG\._viewSeasonId && CG\._UUID_RE\.test\(CG\._viewSeasonId\)\) return CG\._viewSeasonId;/.test(live));
A("the stored hint is only ever the season in play", /if \(!CG\._viewSeasonId && CG\.SEASON\.id && CG\._UUID_RE\.test\(CG\.SEASON\.id\)\) localStorage\.setItem/.test(live));
A("a switch runs through the pulse's single-flight rebuild, box scores re-read, and later jittered calls cannot postpone it", /CG\.viewSeason = function\(id\)\{[\s\S]*?CG\.liveReload\(\{ slots: \[\], statsAll: true \}\);\n  CG\._liveUrgent = true;/.test(live) &&
  /if \(CG\._liveT && CG\._liveUrgent\) return;/.test(live) && /CG\._liveT = null; CG\._liveUrgent = false;/.test(live));
A("the box scores remember their season, and a league is ready only when both are the season asked for", /if \(all && !all\.error\)\{ q\[12\] = all; CG\._bootStatsSeason = hint \|\| null; \}/.test(live) &&
  /_statsSeason: CG\._bootStatsSeason \|\| null \}/.test(live) && /return have === want && \(!stats \|\| stats === want\);/.test(live));
A("a rebuild that changed the season carries nothing across and re-reads the office's data", /var changed = !!\(prev && prev\.season && lg\.season && prev\.season\.id !== lg\.season\.id\);/.test(live) &&
  /if \(!full && !changed\) CG\._carryLg\(prev, lg, skipCarry\);/.test(live) && /if \(full \|\| changed\) return Promise\.all\(\[CG\.loadManagerData\(\), CG\.loadAvailability\(\), CG\.loadTrades\(\)\]\);/.test(live));
A("a completed season lists only the clubs that played it", /if \(season && season\.status === "complete"\)\{\n    var _played = \{\};/.test(live) && /shortcut: names, colors and divisions are today's/.test(live));
A("the hold's watchdog re-asks when nothing is queued and fails only a switch asked 30 visible seconds ago", /if \(!CG\._liveBusy && !CG\._liveT\)\{ CG\.liveReload\(\{ slots: \[\], statsAll: true \}\); CG\._liveUrgent = true; \}/.test(live) &&
  /CG\.viewStalled = function\(\)\{ return !!CG\._viewAskedAt && Date\.now\(\) - CG\._viewAskedAt > 30000; \};/.test(live) &&
  /if \(document\.visibilityState === "visible" && CG\._viewAskedAt && CG\.viewReady && !CG\.viewReady\(\)\) CG\._viewAskedAt = Date\.now\(\);/.test(live));
A("the history entry remembers its season, and a completed season is always in the address", /history\.replaceState\(Object\.assign\(\{\}, history\.state \|\| \{\}, \{ cgSeason: _onNum \}\), "", location\.pathname \+ location\.search \+ _addr\)/.test(ui) &&
  /var _entrySeason = \(history\.state && history\.state\.cgSeason != null\) \? history\.state\.cgSeason : null;/.test(ui));
A("a past season's links name it as they are drawn, and a pressed link or data-go row too", /if \(CG\._viewSeasonId && CG\.carryLinks\) CG\.carryLinks\(app\);/.test(ui) &&
  /location\.hash = CG\.carrySeason\(go\.getAttribute\("data-go"\)\); return;/.test(ui) && /e\.target\.closest\('#app a\[href\^="#\/"\]'\)/.test(ui) && /location\.hash = CG\.carrySeason\(e\.target\.getAttribute\("data-go"\)\);/.test(ui));
A("a switch pulls forward a rebuild already on the clock", /if \(CG\._liveT\)\{ clearTimeout\(CG\._liveT\); CG\._liveT = null; \}\n  CG\.liveReload\(\{ slots: \[\], statsAll: true \}\);/.test(live));
A("the menu lights its item by route, whatever the address carries", /var routeOf = function\(x\)\{ return String\(x \|\| ""\)\.replace/.test(ui));
A("the router asks for the season (a repaint keeps it) and holds a league page until it is that season, any page while a switch is under way",
  /var wantSeason = CG\._lastRoutedHash === h \? \(CG\._viewSeasonId \|\| null\) : CG\.seasonViewFor\(name, qs, param, _entrySeason\);/.test(ui) &&
  /if \(CG\.SEASON_VIEW_ROUTES\[name\] \? !CG\.viewReady\(\) : !CG\.viewSeasonBuilt\(\)\)\{/.test(ui) && /app\.innerHTML = CG\.viewStalled\(\) \? CG\.seasonLoadFailedCard\(\) : CG\.bootScreen\(\);/.test(ui) && /That season could not be loaded/.test(live));
A("an expired management contract is no seat", /else if \(c && c\.is_manager && c\.status==="active"\) mgmt="agm";/.test(live));

/* ---- one definition of a game, a box, a goalie line ---- */
A("buildLiveLeague uses the shared game mapping, final test and box", /return CG\.liveGame\(g, id2code, codeById\[g\.id\]\);/.test(live) && /\.filter\(CG\.countedFinal\)/.test(live) && /var box = CG\.gameBox\(g, statsByGame\[g\.id\], id2code\);/.test(live));
A("the inline goalie line and box loop are gone from buildLiveLeague", !/function eaGoalieLine\(r, won, ot\)/.test(live) && (live.match(/CG\.boxPut\(box\[code\], key,/g) || []).length === 1);
A("the forfeit and the Rule 4.3 comments travel with the box", /a forfeit decides the goalie's W\/L too/.test(live) && /a forfeit decides the result no matter what the goals say \(Rule 4\.3\)/.test(live));

/* ---- the switch and the career on the page ---- */
A("the switch is in every page head and both dark heroes", /\(CG\.seasonSwitch \? CG\.seasonSwitch\(false\) : ""\)\+/.test(pub) && (pub.match(/CG\.seasonSwitch\(true\)\+/g) || []).length === 2);
A("the old select picker is gone", !/CG\.seasonPicker|#seasonPick|seasonPick"/.test(pub));
A("the switch is links that name the season", /'<a href="'\+esc\(CG\.hashWithSeason\(s\.number\)\)\+'"'/.test(pub) && /aria-current="page"/.test(pub) && /Final and read-only/.test(pub));
A("a player off every roster gets the full profile, with a Not on a roster chip and no contract", /var p = lg\.players\.find\(function\(x\)\{ return x\.id===pid; \}\) \|\| \(lg\.formerPlayers\|\|\[\]\)\.find\(function\(x\)\{ return x\.id===pid; \}\);/.test(pub) &&
  /\(p\.former\?'<span class="chip chip-ink" style="border-color:#39434B">'\+\(CG\.viewingPast\(\) \? 'Not on a roster at the season’s end' : 'Not on a roster'\)/.test(pub) && /\(archived \|\| CG\.viewingPast\(\) \|\| p\.former\) \? "" : \(/.test(pub));
A("a former defenseman's side comes from the roster spot or sign-up (EA files D)", /if \(CG\.POS_NAME\[r\.position\]\) return r\.position;/.test(live) && /pos: _formerPos\(r\), former: true,/.test(live));
A("a past season's rookies are counted against EARLIER seasons only", /if \(_builtNum && \(_sNum\[rs\.season_id\] \|\| 0\) >= _builtNum\) return;/.test(live));
A("the career maps every club the league has had, and is read at most once a minute on repaints", /\(\(CG\._bootCache && CG\._bootCache\[0\] && CG\._bootCache\[0\]\.data\) \|\| CG\.TEAMS \|\| \[\]\)\.forEach/.test(live) &&
  /if \(had && Date\.now\(\) - \(CG\._careerAt\[pid\] \|\| 0\) < 60000\) return;/.test(pub));
A("former players carry every field the profile reads, a rating and the rookie flag", /banned: !!pr\.banned, salary: 0, term: 0, mgmt: null, status: "former", squad: "pro"/.test(live) &&
  /CG\.statPlayers\(lg\)\.forEach\(function\(p\)\{\n    lg\.ratings\[p\.id\] = lg\.ratings\[p\.id\] \|\| \{ parts:\{\} \};/.test(live) && /CG\.statPlayers\(lg\)\.forEach\(function\(p\)\{ p\.rookie = /.test(live));
A("a removed player with lines but no roster spot opens their last season from the career", /CG\.careerOpenLast = function\(pid, lines\)\{/.test(pub) && /if \(b && b\.getAttribute\("data-pid"\) === pid && CG\.careerOpenLast\(pid, lines\)\) return;/.test(pub));
A("a completed season is told in the past tense, with no ballot and no sign-up pool", /No league games this season/.test(pub) && /did not play a league game in /.test(pub) &&
  /\(CG\.viewingPast\(\) \? "" : CG\.awardBallotCard\(lg\)\)/.test(R("src/live/part5b_public2.js")) && /var unrostered = pastSeason \? \[\] :/.test(pub) && /no longer on one by its end/.test(pub));
A("a returning player's overall carries over, in the copy", (pub.match(/overall carries over from earlier seasons and is recomputed after every final/g) || []).length === 2);
A("a completed season shows no seats, no contract, no Live pill", /CG\.viewingPast\(\) \? '' : '<div style="display:flex;gap:8px;margin-top:20px/.test(pub) && /\(archived \|\| CG\.viewingPast\(\) \|\| p\.former\) \? "" : \(/.test(pub) && /:CG\.viewingPast\(\)\?''/.test(pub));
A("the career card on the full profile and on the unrostered page, filled after render", (pub.match(/<div id="careerCard" data-pid="'\+esc\(/g) || []).length === 2 && /CG\.AFTER\.player = function\(pid, qs\)\{\n  if \(CG\.paintCareer\) CG\.paintCareer\(pid\);/.test(pub));
A("a failed career read says so", /The career totals could not be loaded\. Refresh the page to try again\./.test(pub) && /console\.error\("career for "/.test(pub));
A("the unrostered caption no longer says only pickup stats show", !/so only pickup game stats show here/.test(pub) && /Not on a league roster right now\./.test(pub));
A("the switch styles follow the house control, hover only on a pointer", /\.seg a\{display:inline-flex/.test(head) && /@media \(hover:hover\) and \(pointer:fine\)\{\.seg a:not\(\.on\):hover/.test(head) && /\.career tr\.tot td\{/.test(head));

/* ---- RUN the shipped career definitions ---- */
const grab = (src, name) => {
  const i = src.indexOf("CG." + name + " = function");
  if (i < 0) throw new Error("missing CG." + name);
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++){ if (src[k] === "{") d++; else if (src[k] === "}"){ d--; if (d === 0) return src.slice(i, k + 1) + ";"; } }
  throw new Error("unbalanced CG." + name);
};
/* eval runs this repository's own shipped source (the house pattern: tests execute the real definitions, not copies) */
global.window = {}; global.CG = {};
const engine = R("src/live/part2_engine.js");
["blankStatLine", "boxLines", "boxPut", "addStatLine"].forEach((f) => eval(grab(engine, f)));
["eaSkaterLine", "eaGoalieLine", "liveGame", "countedFinal", "gameBox", "careerLines"].forEach((f) => eval(grab(live, f)));
CG.TEAMS = [{ id: "a", code: "BOS" }, { id: "b", code: "VAN" }, { id: "c", code: "DAL" }];
CG.SEASONS = [{ id: "s1", number: 1 }, { id: "s2", number: 2 }];
const game = (id, season, home, away, hs, as, extra) => Object.assign({ id, season_id: season, week: 1, stage: "regular", home_team_id: home, away_team_id: away,
  scheduled_at: "2026-10-01T00:00:00Z", status: "final", home_score: hs, away_score: as, went_ot: false, forfeit_team_id: null, voided: false }, extra || {});
CG._bootCache = []; CG._bootCache[6] = { data: [
  game("g1", "s1", "a", "b", 3, 2),
  game("g2", "s1", "a", "b", 1, 4, { forfeit_team_id: "b" }),            // VAN forfeits, BOS's goalie takes the win
  game("g3", "s1", "c", "a", 2, 2, { status: "scheduled", home_score: null, away_score: null }),
  game("g4", "s1", "a", "c", 5, 1, { voided: true }),
  game("g5", "s1", "b", "a", 2, 3, { stage: "playoff", went_ot: true }),
  game("g6", "s1", "a", "c", 2, 1, { stage: "preseason" }),
  game("g7", "s2", "c", "b", 4, 0),                                        // Season 2, for another club
  game("g8", "s1", "a", "b", 2, 3, { went_ot: true }) ], error: null };
const sk = (gid, team, g, a, extra) => Object.assign({ id: gid + team + "s", game_id: gid, team_id: team, profile_id: "p", is_goalie: false, goals: g, assists: a, plus_minus: 1, shots: 3, pim: 2 }, extra || {});
const gl = (gid, team, sa, sv, extra) => Object.assign({ id: gid + team + "g", game_id: gid, team_id: team, profile_id: "p", is_goalie: true, shots_against: sa, saves: sv, goals_against: sa - sv, shutout: false }, extra || {});
const rows = [
  sk("g1", "a", 1, 1), gl("g2", "a", 20, 16),            // a skater line, then a goalie line in a forfeit
  sk("g3", "a", 5, 5), sk("g4", "a", 5, 5),              // not final, voided: not counted
  sk("g5", "a", 2, 0), sk("g6", "a", 0, 1),              // playoff, pre-season: kept apart
  sk("g7", "c", 3, 1),                                   // Season 2, another club
  gl("g8", "a", 30, 27), sk("g8", "a", 0, 1, { id: "g8as" }),   // one game in both roles: one game played
  Object.assign(sk("g1", "a", 9, 9), { id: "other", profile_id: "q" }) ];   // someone else's line
const lines = CG.careerLines("p", rows);
const L = (season, stage) => lines.find((x) => x.season === season && x.stage === stage);
const r1 = L(1, "reg");
A("the season lines come out in season and stage order", lines.map((x) => x.season + x.stage).join(",") === "1pre,1reg,1po,2reg", lines.map((x) => x.season + x.stage));
A("regular season: unfinished and voided games are not counted; a two-role game is one game", r1 && r1.gp === 3 && r1.sgp === 2 && r1.gs === 2, r1);
A("regular season skating totals", r1 && r1.g === 1 && r1.a === 2 && r1.p === 3 && r1.shots === 6 && r1.pim === 4, r1);
A("the forfeit decides the goalie's win, the overtime game's loss is an OTL", r1 && r1.w === 1 && r1.l === 0 && r1.otl === 1 && r1.sa === 50 && r1.sv === 43 && r1.ga === 7, r1);
A("playoffs and pre-season are kept apart", L(1, "po") && L(1, "po").gp === 1 && L(1, "po").g === 2 && L(1, "pre") && L(1, "pre").a === 1);
A("a later season, another club", L(2, "reg") && L(2, "reg").clubs.join() === "DAL" && L(2, "reg").g === 3 && r1.clubs.join() === "BOS");
A("another player's line never counts", lines.every((x) => x.g < 9));
{
  /* game ids sort the other way from their dates, as uuids from different days do */
  CG._bootCache[6] = { data: [game("z1", "s1", "a", "b", 3, 2, { scheduled_at: "2026-09-25T00:00:00Z" }), game("a9", "s1", "c", "b", 3, 2, { scheduled_at: "2026-10-23T00:00:00Z" })], error: null };
  const moved = CG.careerLines("p", [sk("a9", "c", 1, 0), sk("z1", "a", 0, 1)]);
  A("a traded player's clubs read in the order they first played for them, not row order", moved.length === 1 && moved[0].clubs.join() === "BOS,DAL", moved[0] && moved[0].clubs);
}
let threw = false; CG._bootCache[6] = { data: null, error: { message: "x" } };
try { CG.careerLines("p", rows); } catch (e) { threw = /games are not loaded/.test(e.message); }
A("no games loaded is an error, never an empty career", threw);

/* ---- RUN the season rules as shipped ---- */
{
  const H = { s1: "11111111-1111-4111-8111-111111111111", s2: "22222222-2222-4222-8222-222222222222", s0: "00000000-0000-4000-8000-000000000000" };
  global.CG = { _UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    SEASON_VIEW_ROUTES: { standings: 1, stats: 1, schedule: 1, teams: 1, team: 1, players: 1, player: 1, awards: 1, matchup: 1 },
    SEASONS: [{ id: H.s0, number: 0, status: "complete" }, { id: H.s1, number: 1, status: "complete" }, { id: H.s2, number: 2, status: "upcoming" }],
    LIVE_SEASON: { id: H.s2, number: 2 }, SEASON: { id: H.s1, number: 1 }, _viewSeasonId: null };
  global.localStorage = { getItem: () => null };
  ["_seasonHint", "pastSeasons", "seasonViewFor", "playerLastSeason", "carrySeason", "viewStalled", "viewSeasonBuilt"].forEach((f) => eval(grab(live, f)));
  A("with no past season on screen the box scores are the season in play's, even right after Season 1 was built", CG._seasonHint() === H.s2);
  CG._viewSeasonId = H.s1;
  A("with Season 1 on screen they are Season 1's", CG._seasonHint() === H.s1);
  CG._viewSeasonId = null;
  A("completed seasons, newest first, never the season in play", CG.pastSeasons().map((s) => s.number).join() === "1,0");
  A("?season=1 opens Season 1; ?season=2 or an unknown number is the season in play", CG.seasonViewFor("stats", { season: "1" }) === H.s1 && CG.seasonViewFor("stats", { season: "2" }) === null && CG.seasonViewFor("stats", { season: "9" }) === null);
  A("a page that is not a league page is always the season in play", CG.seasonViewFor("home", { season: "1" }) === null);
  CG._bootCache = []; CG._bootCache[4] = { data: [{ profile_id: "a", season_id: H.s1 }, { profile_id: "b", season_id: H.s2 }, { profile_id: "c", season_id: H.s0 }, { profile_id: "c", season_id: H.s1 }] };
  CG._bootCache[6] = { data: [{ id: "g1", season_id: H.s1 }, { id: "g2", season_id: H.s2 }] };
  A("a player on no roster in the season in play opens the last season they played", CG.seasonViewFor("player", {}, "a") === H.s1 && CG.seasonViewFor("player", {}, "c") === H.s1);
  A("a player on a roster in the season in play stays in it; one with no spot anywhere too", CG.seasonViewFor("player", {}, "b") === null && CG.seasonViewFor("player", {}, "zz") === null);
  A("a bare game link opens the game's own season", CG.seasonViewFor("matchup", {}, "g1") === H.s1 && CG.seasonViewFor("matchup", {}, "g2") === null);
  CG._viewSeasonId = H.s1; CG._viewRoute = "standings"; CG._viewParam = null;
  A("a tab or filter on the page on screen keeps its season; another league page with no ?season is the season in play",
    CG.seasonViewFor("standings", { view: "league" }, null) === H.s1 && CG.seasonViewFor("stats", {}, null) === null);
  A("Back to the page's own Season 2 entry returns to Season 2 (the entry remembers it); Forward to a Season 1 entry, Season 1",
    CG.seasonViewFor("standings", {}, null, 2) === null && CG.seasonViewFor("standings", {}, null, 1) === H.s1);
  CG._viewRoute = "player"; CG._viewParam = "a";
  A("only the same player keeps the season: a notification or the palette opening another player opens that player's own",
    CG.seasonViewFor("player", { tab: "log" }, "a") === H.s1 && CG.seasonViewFor("player", {}, "b") === null);
  CG._viewAskedAt = 0;
  A("a hold with no switch asked (a stored hint from before a rollover) never shows the failure card", CG.viewStalled() === false);
  CG._viewAskedAt = Date.now() - 31000;
  A("a switch asked more than 30 visible seconds ago does", CG.viewStalled() === true);
  CG.lg = { season: { id: H.s1 } };
  A("a non-league page draws once the league is the season asked for", CG.viewSeasonBuilt() === true);
  CG._viewSeasonId = null;
  A("...and holds while it is the other one", CG.viewSeasonBuilt() === false);
  CG._viewSeasonId = H.s1;
  A("a link from a Season 1 page carries the season; one that names a season, or leaves the league pages, is untouched",
    CG.carrySeason("#/team/BOS") === "#/team/BOS?season=1" && CG.carrySeason("#/stats?tab=goalies") === "#/stats?tab=goalies&season=1" &&
    CG.carrySeason("#/team/BOS?season=2") === "#/team/BOS?season=2" && CG.carrySeason("#/hub/messages") === "#/hub/messages" && CG.carrySeason("https://x.y/") === "https://x.y/");
  CG._viewSeasonId = null;
  A("with the season in play on screen nothing is rewritten", CG.carrySeason("#/team/BOS") === "#/team/BOS");
}

/* ---- Rule 6.1 and the changelog ---- */
global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const p61 = secs["6.1"].paragraphs[secs["6.1"].paragraphs.length - 1];
A("Rule 6.1: a completed season stays published, final and read-only", /A completed season remains part of the official record and stays published, final and read-only, after the next season becomes the season in play/.test(p61));
A("Rule 6.1: every profile lists every season, on a roster or not", /A player’s profile lists every season the player played, with the regular season, the playoffs and the pre-season kept apart and career totals across seasons, whether or not the player is on a roster at the time\./.test(p61));
const e = rb.changelog.find((c) => c.version === "4.54");
A("changelog records 4.54, keys in order", !!e && Object.keys(e).join(",") === "version,dateIso,summary,items");
A("4.54 names the switch, the Career card and Rule 6.1", !!e && /Season switch/.test(e.summary + e.items.join(" ")) && /Career card/.test(e.items.join(" ")) && /Rule 6\.1/.test(e.items.join(" ")));
A("no em dashes or spaced hyphens in 4.54 or the new rule text", !/—|–| - /.test(JSON.stringify(e)) && !/—| - /.test(p61));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
