/* v3.56: missed availability escalates (Q15). Rehearsed in Postgres (recorded at the foot of the SQL
   file); this pins the record and the book. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-availability-escalation-v356.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
A("the ruling is quoted", /flag 1 week of missed availability to the team management, then flag the 2nd week to both management and staff/.test(sqlF));
A("the front office gets a bell, not the room only", /perform public\.club_notify\(v_p\.team_id, ''availability'',/.test(sql) && /null, ''availability'', null, null, false\);/.test(sql));
A("a second week reads the previous week's ledger", /n2\.week_key = ''w'' \|\| \(v_wk\.week - 1\)/.test(sql));
A("operations is flagged, with the casework room and the audit log", /notify_department\(''operations'', ''flag'', ''Two weeks without availability: ''/.test(sql) && /notify_staff_ch\(''casework'', ''\*\*Two weeks without availability\*\*/.test(sql) && /''availability_second_week''/.test(sql));
A("the club notices use the players told in THIS run, never a clock window", /where am\.profile_id = any\(v_new\)/.test(sql) && /v_new := v_new \|\| v_p\.profile_id;/.test(sql));
A("every patch is asserted", /raise exception 'availability_nudge_tick: a patch matched nothing'/.test(sql));
A("the rehearsal is recorded", /68 players told; 20 front-office bells/.test(sql));
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.56");
A("changelog records 3.56", !!e);
A("5.1.4: front office told; second week referred", /tells his club's front office\. A player who has now missed two weeks in a row/.test(secs["5.1"].paragraphs[3]) && /referred to the league office's staff at the same time/.test(secs["5.1"].paragraphs[3]));
A("5.1.4: the comma splice is fixed", !/not yet in, Lineups/.test(secs["5.1"].paragraphs[3]));
A("no em dashes or spaced hyphens in the 3.56 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
