/* v3.53: when a game is a result. The importer's behavior is driven end to end in
   tools/game-window.test.mjs, tools/ingest-batch.test.mjs and tools/league-merge.test.mjs; the
   database half was rehearsed in Postgres (recorded at the foot of the SQL file). This pins the
   rulings, the one shared test, the site, the bot and the book. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-game-length-v353.sql"), ing = R("netlify/functions/ingest-stats.js");
const sqlF = sql.replace(/\n--\s*/g, " ");   // the quoted rulings wrap across comment lines
const live = R("src/live/part_live.js"), bot = R("bot/incidents.mjs");

console.log("\n— the rulings are quoted");
A("Q18", /Once it reaches a full game but keep in mind there may be a simulated/.test(sqlF) && /Flag any games that go over the 60 minutes but is more than a 1 goal/.test(sqlF));
A("Q19", /the game shall just be restarted from the beginning of the first period/.test(sqlF));
A("Q20", /resume their new overtime starting in the first period/.test(sqlF));

console.log("\n— the database");
A("the archive may say incomplete and struck", /'ingested','merged','unmatched','skipped','error','ignored','incomplete','struck'/.test(sql));
A("incidents record an early first-period drop", /add column if not exists early_first boolean not null default false/.test(sql));
A("the overtime ruling", /when v_ot then ' Overtime: the clubs reload and play the first period of the new game as sudden-death overtime/.test(sql));
A("the early restart ruling, only in the first period", /v_e1 boolean := coalesce\(p_early_first, false\) and coalesce\(p_period, 0\) = 1;/.test(sql));
A("the abandoned ruling takes a held game and its score", /p_home_score integer default null, p_away_score integer default null/.test(sql) && /v_held := v_g\.status = 'scheduled' and v_g\.ea_match_id is not null;/.test(sql));
A("...and never charges the club ahead", /The club ahead keeps the win under Rule 4\.3; the forfeit is charged to the club behind/.test(sql));
A("...importer only", /grant execute on function public\.forfeit_abandoned_game\(uuid,uuid,text,integer,integer\) to service_role;/.test(sql) && /from public, anon, authenticated;\s*\ngrant execute on function public\.forfeit_abandoned_game/.test(sql));
A("staff's keep-the-result forfeit works on a held game", /v3\.53: a HELD game \(sittings in, no result yet\) is ruled on the score its box score adds up to/.test(sql));
A("the held-game notice names Rule 4.3.9, not the no-show forfeit", /three-disconnections kind/.test(sql) && /Do not use the no-show forfeit, which deletes them/.test(sql));
A("the rehearsal is recorded", /T3\s+forfeit_abandoned_game on a HELD game/.test(sql));

console.log("\n— the importer's one test");
A("finished = full clock and a decided score", /finished: reachedFull && margin > 0/.test(ing));
A("overtime read from the clock at one goal past sixty", /const inferredOt = !eaOt && total > REGULATION_S && margin === 1;/.test(ing));
A("overlong = past sixty by more than a goal", /overlong: total > REGULATION_S && margin > 1/.test(ing));
A("ten minutes is the early-restart line", /const EARLY_RESTART_S = 600;/.test(ing));
A("used by the fresh filing, the continuation, the manual merge and the sweep",
  /const st1 = sittingsState\(\[norm\]\);/.test(ing) && /const stp = sittingsState\(ps\);/.test(ing) && /const st = sittingsState\(norms\);/.test(ing) && /const stA = sittingsState\(ps\);/.test(ing));
A("the sweep reads held games", /status=in\.\(final,scheduled\)&ea_match_id=not\.is\.null&voided=not\.is\.true&forfeit_team_id=is\.null&select=id,status,home_team_id/.test(ing));
A("a struck sitting stays struck", /if \(row && row\.status === "struck"\)/.test(ing));
A("the level-merge double loss is gone", !/Resumed game ended level/.test(ing));

console.log("\n— the site and the bot");
A("Stats manager: the Restarted option", /id="smLgRestart"/.test(live) && /leagueMerge: \{ gameId: gid, matchIds: ids, restart: restart \}/.test(live));
A("both desks say when a merge is held", /Merged and held\./.test(live) && /Combined and held\./.test(live));
A("the incident form sends the early first-period flag", /p_early_first: dc && document\.getElementById\("smInPeriod"\)\.value === "1"/.test(live));
A("the bot's overtime and early-restart notes", /first period of the new game as sudden-death overtime/.test(bot) && /restart the game from the beginning of the first period/.test(bot));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.53");
A("changelog records 3.53", !!e);
A("4.2.3: regular season reviewed; playoffs by the series cap; suspensions everywhere", /^Every completed regular-season game is checked/.test(secs["4.2"].paragraphs[2]) && /Every game, playoffs included, is checked for a suspended player/.test(secs["4.2"].paragraphs[2]));
A("4.2.3: the position check only where the lock is in force", /Where the position lock is in force \(Rule 2\.1\)/.test(secs["4.2"].paragraphs[2]));
A("4.3.2: the early restart", /within the first ten \(10\) minutes of the first period, the game is not resumed/.test(secs["4.3"].paragraphs[1]));
A("4.3.3: published only at a full, decided game", /published as a result only once its sittings together make a full game of sixty \(60\) minutes of game clock with a decided score/.test(secs["4.3"].paragraphs[2]));
A("4.3.6: the overtime drop", /A disconnection in overtime is dealt with the same way/.test(secs["4.3"].paragraphs[5]));
A("4.3.9: a commissioner reverses", /a commissioner reverses the ruling/.test(secs["4.3"].paragraphs[8]) && !/the officials reverse the ruling/.test(secs["4.3"].paragraphs[8]));
A("4.5: restart from the beginning, stats removed", /restarted from the beginning, the statistics of the stopped sitting are removed/.test(secs["4.5"].paragraphs[0]) && /re-file the game from the restarted sitting alone/.test(secs["4.5"].paragraphs[4]));
A("8.3.2: held in the playoffs too", /A playoff game split by a disconnection is held/.test(secs["8.3"].paragraphs[1]));
const mine = JSON.stringify(e) + [secs["4.2"].paragraphs[2], secs["4.3"].paragraphs[8]].join(" ");
A("no em dashes or spaced hyphens in what v3.53 wrote", !/—| - /.test(mine));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
