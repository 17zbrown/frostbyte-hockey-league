/* v3.73: the game-incident log is retired (commissioner, 2026-09-29, Q58). The table, its function, the
   Stats manager card and the bot's instant-rulings lane all go, and Rule 4.3 says who counts disconnections
   instead. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-29-incident-log-retired-v373.sql"), live = R("src/live/part_live.js");
const bot = R("bot/chel-bot.mjs"), alerts = R("bot/staff-alerts.mjs"), handlers = R("bot/handlers.mjs"), pkg = R("bot/package.json");

A("the drop refuses a non-empty table", /if \(select count\(\*\) from public\.game_incidents\) > 0 then/.test(sql));
A("...and refuses while a Realtime subscriber still listens", /from realtime\.subscription where entity::text in \('game_incidents', 'public\.game_incidents'\)/.test(sql));
A("the function and the table go together, RESTRICT", /drop function public\.log_game_incident\(uuid, uuid, text, integer, integer, text, boolean, text, boolean\);\s+drop table public\.game_incidents;/.test(sql) && !/cascade/i.test(sql.split("drop function")[1]));
A("the bot module is deleted", !fs.existsSync(path.join(__dirname, "..", "bot", "incidents.mjs")));
A("chel-bot no longer imports, subscribes to or beats the incident lane",
  !/incidents\.mjs|createIncidentNotifier|INC\.|incidentsLive|"game-incidents"|"game_incidents"/.test(bot));
A("...and still wires the other four lanes", /key: "role-sync", sum: RS\.sum/.test(bot) && /key: "club-notices", sum: CLUB\.sum/.test(bot) && /key: "dms", sum: DMS\.sum/.test(bot) && /key: "staff-alerts", sum: DESK\.sum/.test(bot));
A("the staff-desk channel no longer binds the table", /const DESK_TABLES = \["action_requests", "owner_applications", "staff_applications",\s+"management_applications", "ea_ingest_log", "staff_votes"\];/.test(bot));
A("staff alerts no longer route, key or enrich it", !/game_incidents/.test(alerts));
A("bot comments and description no longer name it", !/incident/.test(handlers) && !/incident/.test(pkg));
A("the Stats manager card and its wiring are gone", !/incidentCard|log_game_incident|smInGo|Log a game incident/.test(live));
A("...and the other Stats manager cards remain", /body\.innerHTML = addCard \+ leagueCard \+ fixCard \+ forfeitCard \+ listCard;/.test(live));

global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const inForce = rb.chapters.map((ch) => ch.sections.map((s) => s.paragraphs.join(" ")).join(" ")).join(" ");
const e = rb.changelog.find((c) => c.version === "3.73");
A("changelog records 3.73", !!e && e.dateIso === "2026-09-29");
A("no in-force paragraph mentions the incident log", !/incident log/i.test(inForce) && !/game incident/i.test(inForce));
A("4.3.10 says who counts disconnections now", /The officiating department counts a club's disconnections in a game from the two clubs' reports and the game's own record of its sittings/.test(secs["4.3"].paragraphs[9]));
A("7.1.2 no longer lists a game incident", /whether it is a case, a forfeit, a void or the correction of a result\./.test(secs["7.1"].paragraphs[1]));
A("3.2.4: the office accepts a lateness waiver", /the league office accepts the outcome rather than second-guessing it/.test(secs["3.2"].paragraphs[3]));
A("history is left alone (3.52 and 3.53 still mention incidents)", rb.changelog.some((c) => c.version === "3.53"));
A("no em dashes or spaced hyphens in the 3.73 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
