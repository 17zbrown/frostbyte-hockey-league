/* v4.11 (follow-up C3 of v4.08): a player who skated in one sitting of a restarted game (Rule 4.3) and played goal in
   another keeps BOTH lines. mergeSegments summed every sitting into one line per EA account and flagged it a goalie's,
   so the skating goals and assists sat on a line every reader counts as goaltending only and were never shown.
   This RUNS the importer's own normalizeMatch, mergeSegments, oneCreditPerGame and postGameRecaps, and the site's own
   CG.aggregate, boxPut, boxLines and glogGames, and pins the database record, the rulebook and the changelog.
   Run: node tools/two-role-lines-v411.test.cjs */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 300))); } };
const src = R("netlify/functions/ingest-stats.js");
const fn = (name) => { const i = src.indexOf("function " + name + "("); return src.slice(i, src.indexOf("\n}\n", i) + 2); };
const afn = (name) => { const i = src.indexOf("async function " + name + "("); return src.slice(i, src.indexOf("\n}\n", i) + 2); };
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const lib = new Function("etFmt", "const etDayUnix = (s) => etFmt.format(new Date(s * 1000));\n" + fn("mapPos") + fn("normalizeMatch") + fn("mergeSegments") +
  "\nreturn { normalizeMatch, mergeSegments };")(etFmt);

(async () => {
  console.log("— the importer: sittings add up per player AND role");
  /* sitting 1 (20 minutes): Swap skates at center (1G 1A, 3 shots), Net is in goal. Sitting 2 (40 minutes): Net drops
     out, Swap goes in goal (18 saves on 20) and Net skates at left wing. Wing skates both sittings. */
  const sk = (o) => Object.assign({ position: "center", skgoals: "0", skassists: "0", skshots: "0", skhits: "0", toiseconds: "1200",
    ratingOffense: "60", ratingDefense: "60", ratingTeamplay: "60" }, o);
  const gl = (o) => Object.assign({ position: "goalie", glsaves: "0", glshots: "0", glga: "0", toiseconds: "1200",
    ratingOffense: "50", ratingDefense: "70", ratingTeamplay: "60" }, o);
  const other = { "900": gl({ playername: "OppG", glsaves: "9", glshots: "10", glga: "1" }), "901": sk({ playername: "OppC", skgoals: "1" }) };
  const raw1 = { matchId: "M1", timestamp: 1760572800, clubs: { "1": { score: "1" }, "2": { score: "1" } },
    players: { "1": { "100": sk({ playername: "Swap", skgoals: "1", skassists: "1", skshots: "3" }), "101": gl({ playername: "Net", glsaves: "8", glshots: "9", glga: "1" }),
                      "102": sk({ playername: "Wing", position: "rightWing", skassists: "1", skshots: "2" }) }, "2": other } };
  const raw2 = { matchId: "M2", timestamp: 1760575800, clubs: { "1": { score: "3" }, "2": { score: "2" } },
    players: { "1": { "100": gl({ playername: "Swap", glsaves: "18", glshots: "20", glga: "2", toiseconds: "2400" }),
                      "101": sk({ playername: "Net", position: "leftWing", skgoals: "2", skshots: "4", toiseconds: "2400" }),
                      "102": sk({ playername: "Wing", position: "rightWing", skgoals: "1", skshots: "3", toiseconds: "2400" }) },
               "2": { "900": gl({ playername: "OppG", glsaves: "20", glshots: "22", glga: "2", toiseconds: "2400" }), "901": sk({ playername: "OppC", skgoals: "1", toiseconds: "2400" }) } } };
  const merged = lib.mergeSegments([lib.normalizeMatch(raw1), lib.normalizeMatch(raw2)]);
  const club = merged.clubs.find((c) => c.ea_club_id === "1");
  const lines = (id) => club.players.filter((p) => p.ea_player_id === id);
  const swap = lines("100"), swapS = swap.find((p) => !p.is_goalie), swapG = swap.find((p) => p.is_goalie);
  A("a player who skated one sitting and played goal in the other has TWO lines", swap.length === 2 && !!swapS && !!swapG, swap);
  A("...the skating line carries the skating (1G 1A, 3 shots, 20 minutes, at center)", swapS.goals === 1 && swapS.assists === 1 && swapS.shots === 3 &&
    swapS.time_on_ice_seconds === 1200 && swapS.position === "C" && swapS.saves === 0 && swapS.shots_against === 0, swapS);
  A("...the in-goal line carries the goaltending (18 of 20, 40 minutes, G)", swapG.saves === 18 && swapG.shots_against === 20 && swapG.goals_against === 2 &&
    swapG.time_on_ice_seconds === 2400 && swapG.position === "G" && swapG.goals === 0 && swapG.assists === 0, swapG);
  A("...each line keeps its own ratings (no blend across roles)", swapS.offense_rating === 60 && swapG.defense_rating === 70);
  const net = lines("101");
  A("the goalie who went out to skate also has both lines", net.length === 2 && net.find((p) => p.is_goalie).saves === 8 && net.find((p) => !p.is_goalie).goals === 2, net);
  const wing = lines("102");
  A("a player in one role in every sitting still has ONE summed line", wing.length === 1 && wing[0].goals === 1 && wing[0].assists === 1 && wing[0].shots === 5 &&
    wing[0].time_on_ice_seconds === 3600, wing);
  A("the club's score is the sittings' total, unchanged by the split (1 + 3)", club.score === 4, club.score);
  A("every goal is on a skating line (4, the club's score), none on a goalie line",
    club.players.filter((p) => !p.is_goalie).reduce((a, p) => a + p.goals, 0) === 4 && club.players.filter((p) => p.is_goalie).every((p) => p.goals === 0));
  const opp = merged.clubs.find((c) => c.ea_club_id === "2").players;
  A("the other club, one role each, is unchanged (one goalie line of 29 of 32)", opp.length === 2 && opp.find((p) => p.is_goalie).saves === 29 && opp.find((p) => p.is_goalie).shots_against === 32);
  A("the shutout is read per goalie line", swapG.shutout === false && !swapS.shutout);
  const solo = lib.mergeSegments([lib.normalizeMatch(raw1), lib.normalizeMatch(Object.assign({}, raw1, { matchId: "M3", timestamp: 1760576000 }))]);
  A("two sittings in the same roles: one line per player, as before", solo.clubs.find((c) => c.ea_club_id === "1").players.length === 3);
  A("the merge no longer ORs the goalie flag", !/prev\.is_goalie = prev\.is_goalie \|\| p\.is_goalie/.test(src) && /const key = `\$\{p\.ea_player_id\}\|\$\{p\.is_goalie \? "G" : "S"\}`;/.test(src));

  console.log("\n— the importer: one member, one line per game in each role");
  const body = afn("oneCreditPerGame");
  let looked = false;
  const make = (profiles) => new Function("sbGet", "console", body + "\nreturn oneCreditPerGame;")(
    async () => { looked = true; if (profiles instanceof Error) throw profiles; return profiles; }, { log: () => {} });
  let rows = [{ ea_player_id: "100", profile_id: "P", is_goalie: false }, { ea_player_id: "100", profile_id: "P", is_goalie: true }];
  await make([])(rows);
  A("the same EA account in two roles keeps both lines, with no lookup", rows.every((r) => r.profile_id === "P") && !looked, rows);
  looked = false;
  rows = [{ ea_player_id: "100", profile_id: "P", is_goalie: false }, { ea_player_id: "555", profile_id: "P", is_goalie: true }];
  await make([{ id: "P", ea_player_id: "100" }])(rows);
  A("two EA accounts on one member, one in each role: the v3.82 rule still keeps only the member's own persona", rows[0].profile_id === "P" && rows[1].profile_id === null && looked, rows);
  rows = [{ ea_player_id: "100", profile_id: "P", is_goalie: false }, { ea_player_id: "100", profile_id: "P", is_goalie: true }, { ea_player_id: "555", profile_id: "P", is_goalie: false }];
  await make([{ id: "P", ea_player_id: "100" }])(rows);
  A("...and keeps BOTH role lines of the member's own persona while dropping the other account", rows[0].profile_id === "P" && rows[1].profile_id === "P" && rows[2].profile_id === null, rows);
  rows = [{ ea_player_id: "100", profile_id: "P", is_goalie: false }, { ea_player_id: "100", profile_id: "P", is_goalie: false }];
  await make([{ id: "P", ea_player_id: "100" }])(rows);
  A("two lines in the SAME role are never both credited", rows.filter((r) => r.profile_id === "P").length <= 1, rows);
  rows = [{ ea_player_id: "100", profile_id: "P", is_goalie: false }, { ea_player_id: "555", profile_id: "P", is_goalie: true }];
  await make(new Error("down"))(rows);
  A("profiles unreadable: two accounts are credited to none (never a guess)", rows.every((r) => r.profile_id === null));

  console.log("\n— the post-game notification: one per player per game, both lines");
  const sent = [];
  const recaps = new Function("sbSend", "sbGet", afn("postGameRecaps") + "\nreturn postGameRecaps;")(
    async (m, p, b) => { sent.push({ m, p, b }); }, async () => [{ id: "H", name: "Home club", code: "HOM" }, { id: "A", name: "Away club", code: "AWY" }]);
  await recaps({ id: "G1", home_team_id: "H", away_team_id: "A" }, [
    { profile_id: "P", team_id: "H", is_goalie: false, goals: 1, assists: 1, shots: 3, hits: 0 },
    { profile_id: "P", team_id: "H", is_goalie: true, saves: 18, shots_against: 20, shutout: false },
    { profile_id: "Q", team_id: "A", is_goalie: false, goals: 0, assists: 0, shots: 2, hits: 1 }], 3, 2, null);
  const posted = (sent.find((x) => x.m === "POST") || {}).b || [];
  const p = posted.filter((x) => x.profile_id === "P");
  A("the two-role player gets ONE notification", posted.length === 2 && p.length === 1, posted);
  A("...naming both lines, the goaltending first", p[0] && /^In goal: 18 saves on 20\. Skating: 1G 1A, 2 points\./.test(p[0].body), p[0] && p[0].body);
  A("...and a one-role line reads as before, with no dash", /^2 shots, 1 hit\./.test(posted.find((x) => x.profile_id === "Q").body) && !posted.some((x) => /—/.test(x.body)));

  console.log("\n— the site: one box entry per player per game, every line counted");
  const eng = R("src/live/part2_engine.js");
  const grab = (s, f) => { const m = s.match(new RegExp("CG\\." + f + " = function[\\s\\S]*?\\n\\};")); if (!m) throw new Error("no CG." + f); return m[0]; };
  const ctx = { console, Math, Object, Array, String, Number, JSON };
  const TEAMS = ["VAN", "DAL"].map((code) => ({ code, name: code + " club" }));
  ctx.CG = { TEAMS, TEAM: Object.fromEntries(TEAMS.map((t) => [t.code, t])), SEASON: { completedWeeks: 1 },
    DEFAULT_WEIGHTS: { skater: { production: 1, efficiency: 1, defense: 1, discipline: 1, form: 1 }, goalie: { saves: 1, workload: 1, wins: 1, discipline: 1 },
      team: { record: 1, goalDiff: 1, goaltending: 1, depth: 1, form: 1 } } };
  vm.createContext(ctx);
  for (const f of ["boxLines", "boxPut", "glogGames", "boxStarText", "blankStatLine", "statPlayers", "addStatLine", "clubLine", "clubsPlayed", "aggregate", "roleLine", "lineRoles"]) vm.runInContext(grab(eng, f), ctx);
  const CG = ctx.CG;
  const S = (g, a, shots) => ({ goalie: false, pos: "C", g, a, shots, pm: 1, hits: 0, blk: 0, gv: 0, tk: 0, pim: 0, fow: 0, fot: 0, gwg: 0, toi: 1200 });
  const G = (sv, sa, ga, w) => ({ goalie: true, pos: "G", sv, sa, ga, w, l: w ? 0 : 1, otl: 0, so: 0, qs: 1, toi: 2400 });
  /* the live builder files lines in database order, either role first */
  const side1 = {}; CG.boxPut(side1, "swap", S(1, 1, 3), "ea:r1"); CG.boxPut(side1, "swap", G(18, 20, 2, 1), "ea:r2");
  const side2 = {}; CG.boxPut(side2, "swap", G(18, 20, 2, 1), "ea:r2"); CG.boxPut(side2, "swap", S(1, 1, 3), "ea:r1");
  A("boxPut: one entry for the player, the goalie line carrying the skating line, in either order",
    Object.keys(side1).length === 1 && side1.swap.goalie && side1.swap.skate.g === 1 && Object.keys(side2).length === 1 && side2.swap.goalie && side2.swap.skate.g === 1);
  const side3 = {}; CG.boxPut(side3, "x", S(1, 0, 1), "ea:a"); CG.boxPut(side3, "x", S(2, 0, 1), "ea:b");
  A("boxPut never lets one line overwrite another (a same-role duplicate is filed under its spare key)", side3.x.g === 1 && side3["ea:b"] && side3["ea:b"].g === 2);
  A("boxLines lists every line of an entry", CG.boxLines(side1.swap).length === 2 && CG.boxLines(side3.x).length === 1 && CG.boxLines(undefined).length === 0);
  A("the star caption names both lines", CG.boxStarText(side1.swap) === "18 saves and 1G 1A" && CG.boxStarText(S(2, 1, 1)) === "2G 1A");

  const players = [{ id: "swap", tag: "Swap", team: "VAN", pos: "C" }, { id: "wing", tag: "Wing", team: "VAN", pos: "RW" }, { id: "g2", tag: "Goalie", team: "VAN", pos: "G" }];
  const results = [
    { id: "g1", week: 1, home: "VAN", away: "DAL", score: { VAN: 3, DAL: 2 }, ot: false, box: { VAN: Object.assign({}, side1, { wing: S(1, 1, 5) }), DAL: { opp: S(2, 0, 4) } } },
    { id: "g2", week: 1, home: "DAL", away: "VAN", score: { VAN: 2, DAL: 1 }, ot: false, box: { VAN: { swap: S(0, 2, 2), g2: G(20, 21, 1, 1) }, DAL: {} } },
    { id: "g3", week: 1, home: "VAN", away: "DAL", score: { VAN: 1, DAL: 4 }, ot: false, box: { VAN: { swap: G(10, 14, 4, 0) }, DAL: {} } }];
  const lg = { players, formerPlayers: [], byTeam: { VAN: players, DAL: [] }, results };
  CG.aggregate(lg, {});
  const s = lg.pstats.swap;
  A("the two-role game counts ONCE as a game played: 3 games", s.gp === 3, s.gp);
  A("...and once in each role: 2 games skated, 2 in goal (gp <= sgp + gs)", s.sgp === 2 && s.gs === 2 && s.gp <= s.sgp + s.gs, [s.sgp, s.gs]);
  A("the skating goals and assists of the two-role game are counted (1G 3A)", s.g === 1 && s.a === 3 && s.p === 4 && s.shots === 5, [s.g, s.a, s.shots]);
  A("...and the goaltending too (28 saves on 34, 1-1)", s.sv === 28 && s.sa === 34 && s.ga === 6 && s.w === 1 && s.l === 1, [s.sv, s.sa]);
  A("per-game figures divide by each role's own games", (CG.roleLine(s, "S").p / CG.roleLine(s, "S").gp) === 2 && (CG.roleLine(s, "G").ga / CG.roleLine(s, "G").gp) === 3);
  A("roles: registered first, then the other", JSON.stringify(CG.lineRoles(s, false)) === '["S","G"]');
  A("a one-role player is unchanged (gp = sgp)", lg.pstats.wing.gp === 1 && lg.pstats.wing.sgp === 1 && lg.pstats.wing.gs === 0);
  A("club shots for count the goalie's skating line (3 + 5 + 2)", lg.teams.VAN.sf === 10, lg.teams.VAN.sf);
  A("club save totals count every goalie line (18 + 20 + 10 of 20 + 21 + 14)", lg.teams.VAN.gsv === 48 && lg.teams.VAN.gsa === 55);
  A("the opponent's shots against include the goalie's skating shots", lg.teams.DAL.sa === 10, lg.teams.DAL.sa);
  const log = lg.glog.swap;
  A("the game log has a line per role: 4 lines over 3 games", log.length === 4 && log.filter((e) => e.game === "g1").length === 2);
  const games = CG.glogGames(log);
  A("glogGames folds them back into games, both lines on the two-role game", games.length === 3 && games[0].game === "g1" && games[0].lines.length === 2 && games[2].lines.length === 1);

  console.log("\n— the site readers");
  const live = R("src/live/part_live.js"), pub = R("src/live/part5a_public.js"), pub2 = R("src/live/part5b_public2.js"), hub = R("src/live/part6_hub.js");
  A("the live builder files every line through boxPut, an unlinked line under its own row key", /CG\.boxPut\(box\[code\], key, r\.is_goalie \? eaGoalieLine\(r, gWon, forfeit \? false : g\.ot\) : eaSkaterLine\(r\), "ea:"\+r\.id\);/.test(live) &&
    !/box\[code\]\[key\] = r\.is_goalie/.test(live));
  A("...and its three stars weigh both lines", /CG\.boxLines\(box\[code\]\[pid\]\)\.forEach\(function\(b\)\{\s*val \+=/.test(live));
  A("pre-season games and the fallback career count are games, not lines", /if \(!careerRows && first\) careerGp/.test(live) && /if \(first\) pgo\.gp\+\+;/.test(live));
  A("a no-ice forfeit reads every line's ice time", /CG\.boxLines\(sides\[i\]\[ids\[j\]\]\)\.some\(function\(b\)\{ return \(\+b\.toi \|\| 0\) > 0; \}\)/.test(live));
  A("trade value weighs each role by role games, not by games played", /\/ Math\.max\(1, \(st\.sgp\|\|0\) \+ \(st\.gs\|\|0\)\);/.test(live) && !/\(sProd \* \(st\.sgp\|\|0\) \+ gProd \* \(st\.gs\|\|0\)\) \/ st\.gp;/.test(live));
  A("the box score page lists every line: skaters, and EVERY goaltender (not only the first)",
    /CG\.boxLines\(box\[pid\]\)\.forEach\(function\(b\)\{ \(b\.goalie \? gls : sk\)\.push\(/.test(pub2) && /gls\.map\(function\(gl\)\{/.test(pub2) && !/return box\[pid\]\.goalie; \}\)\.map\([^\n]*\)\[0\];/.test(pub2));
  A("the star captions name both lines", (pub2.match(/CG\.boxStarText\(b\)/g) || []).length === 2);
  A("the position-group lines count each line in its own group", /CG\.boxLines\(e\)\.forEach\(function\(b\)\{\s*var k = CG\.posViewGroup\(b\);/.test(pub));
  A("My last three games are three GAMES", /CG\.glogGames\(lg\.glog\[me\.id\]\)\.slice\(-3\)\.reverse\(\)/.test(hub));

  console.log("\n— the database record (rehearsed, applied as v409_two_role_lines)");
  const sql = R("sql/2026-10-15-two-role-lines-v411.sql");
  A("one credit per game IN EACH ROLE", /create unique index game_stats_one_credit_per_game on public\.game_stats \(game_id, profile_id, is_goalie\) where profile_id is not null;/.test(sql));
  A("one row per EA account per game in each role", /create unique index game_stats_one_row_per_player on public\.game_stats\s*\(game_id, team_id, is_goalie, coalesce\(ea_player_id, profile_id::text, lower\(coalesce\(skater_name, ''\)\)\)\);/.test(sql));
  const board = sql.slice(sql.indexOf("create or replace function public.statistical_title_board"), sql.indexOf("revoke all on function public.statistical_title_board"));
  A("the title board groups a game's lines PER ROLE (no bool_or)", /group by gs\.profile_id, gs\.game_id, gs\.is_goalie\)/.test(board) && !/bool_or/.test(board) &&
    /from lines l where not l\.g group by l\.profile_id/.test(board) && /from lines l where l\.g group by l\.profile_id/.test(board));
  A("...keeps the v4.08 floor at the position and tie order, and its grant", /where w\.ok and c\.gp >= w\.fl/.test(board) && /-c\.gp, pr\.gamertag, c\.profile_id/.test(board) &&
    /grant execute on function public\.statistical_title_board\(uuid, int\) to anon, authenticated, service_role;/.test(sql));
  A("career games, draft eligibility, the free-agent counts and camp weeks count distinct games",
    /count\(distinct gs\.game_id\)::bigint as gp/.test(sql) && /or \(select count\(distinct gs\.game_id\) from public\.game_stats gs join public\.games g/.test(sql) &&
    /\(select count\(distinct gs\.game_id\) from public\.game_stats gs where gs\.profile_id = v_reg\.profile_id\) >= 5/.test(sql) &&
    /select count\(distinct gs\.game_id\) into v_pre_gp/.test(sql) && /replace\(v_def, 'count\(\*\)', 'count\(distinct gs\.game_id\)'\)/.test(sql));
  A("every anchored patch refuses to run on an unexpected definition", (sql.match(/raise exception 'v4\.09: [a-z_ ]*anchor/g) || []).length >= 7);
  A("relinking allows the member's other-role line of the same EA account only",
    /and \(x\.is_goalie = r\.is_goalie or r\.ea_player_id is null or x\.ea_player_id is distinct from r\.ea_player_id\)\);/.test(sql));
  A("a withdrawal clears every line of the account in the game", /where gs\.game_id = v_game and gs\.ea_player_id = v_ea and gs\.profile_id is not null;/.test(sql) && /get diagnostics v_hit = row_count;/.test(sql));
  A("the recap's stars are one entry per player per game", /group by gs\.game_id, gs\.team_id, t\.name, coalesce\(gs\.profile_id::text, gs\.ea_player_id, lower\(gs\.skater_name\), gs\.id::text\)\) x/.test(sql) &&
    /string_agg\([\s\S]*' and ' order by gs\.is_goalie desc\) as txt/.test(sql));
  A("the record checks itself and that the internal functions stay closed", /do \$chk\$/.test(sql) && /an internal function is executable by members/.test(sql));
  A("the record says what was already right (no change needed there)", /regular_gp, player_week_games, the limit-forfeit check,\s*\n?--\s*check_playoff_violations, compute_potw and the player_season_stats view already counted distinct games/.test(sql));

  console.log("\n— the rulebook and the changelog");
  const C = {}; new Function("CG", R("src/live/part3_content.js"))(C);
  const rb = C.CONTENT.rulebook;
  const sec = (id) => { for (const ch of rb.chapters) for (const s2 of (ch.sections || [])) if (s2.id === id) return s2; };
  const r61 = sec("6.1").paragraphs[1];
  A("Rule 6.1: both lines inside one game, the game counted once in each role", /a player who skates in one sitting of a game restarted under Rule 4\.3 and plays goal in another keeps a skating line and an in-goal line for that game/.test(r61) &&
    /the game counts once among the player's games skated and once among the games in goal/.test(r61));
  A("...and once as a game played under Rules 2.4, 5.2 and 8.3", /Every game at any position counts once as a game played under Rules 2\.4, 5\.2 and 8\.3, however many lines the player has in it\./.test(r61));
  A("...keeping the v4.08 wording", /two season lines, one from the games skated and one from the games played in goal/.test(r61) && /including a line cut short by a disconnection/.test(r61));
  A("Rule 4.3: the combined record keeps a line per role", /A player who skated in one sitting and played goal in another keeps one line for each role in that record, and the game counts once \(Rule 6\.1\)\./.test(sec("4.3").paragraphs[2]));
  const cl = rb.changelog.find((c) => c.version === "4.11");
  /* by version, never by position: a later release takes changelog[0] (v4.12 did) */
  A("the changelog has its 4.11 entry, newer releases only in front of it", !!cl && rb.changelog.slice(0, rb.changelog.indexOf(cl)).every((c) => +c.version > 4.11));
  A("...no em dashes and no spaced hyphens", !/—| - /.test(JSON.stringify(cl)) && !/—| - /.test(r61));
  A("...and it does not claim a changed result (none existed)", /No game so far had such a player/.test(cl.items[0]));

  console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
