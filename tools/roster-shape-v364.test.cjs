/* v3.64: the basic active roster is at most 7 forwards, 5 defensemen and 3 goaltenders (Q29); the shape check
   judges the player entering the counted roster, so an over club can fix itself; clubs over were told. The
   database half was rehearsed in Postgres (recorded at the foot of the SQL file). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-roster-shape-v364.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js");

console.log("\n— the ruling is quoted");
A("Q29", /composition: 7 forwards \(any sub-position\), 5 defensemen, 3 goalies/.test(sqlF) && /Set it, and send a notice to all teams who are over the requirement on any of the 3 position groups with a reminder to fix it before the roster\/tc weekly lock/.test(sqlF));

console.log("\n— the database");
A("the basic quota becomes 7/5/3 and lines/flex go", /'"quota":\{"F":9,"D":7,"G":5\},"lines":2,"flex":3', '"quota":\{"F":7,"D":5,"G":3\},"lines":null,"flex":null'/.test(sql));
A("the check ignores a delete and anything not counted", /if tg_op = 'DELETE' then return null; end if;/.test(sql) && /if not \(NEW\.squad = 'pro' and NEW\.status = 'active' and not \(coalesce\(NEW\.origin,''\) = any\(v_loans\)\)\) then\s+return null;/.test(sql));
A("...and a row already counted in the same group of the same club", /OLD\.team_id = NEW\.team_id and OLD\.season_id = NEW\.season_id\s+and public\.pos_group\(OLD\.position\) = public\.pos_group\(NEW\.position\) then\s+return null;/.test(sql));
A("...an entering row must fit its own group and the total", /if v_cnt > v_cap or \(f \+ d \+ g\) > v_max then/.test(sql));
A("every club over is told, with the freeze named, and the department too", /'Roster over the new limits: fix by '\|\|v_when/.test(sql) && /interval '2 days 19 hours 30 minutes'/.test(sql) && /notify_department\('transactions', 'flag', 'Clubs over the new roster limits'/.test(sql));
A("...privately to the front office", /null, 'manager', 'roster', null, false\);/.test(sql));
A("the table in force is recorded", /"quota":\{"F":7,"D":5,"G":3\},"lines":null,"flex":null,"camp_max":10/.test(R("sql/2026-09-15-season-format.sql")));
A("the rehearsal is recorded", /calling a camp forward up was refused/.test(sql));

console.log("\n— the site");
A("the client quota is 7/5/3", /basic: \{ format:"basic", roster_max:15, quota:\{ F:7, D:5, G:3 \}, lines:null, flex:null,/.test(live));
A("Team HQ warns a club over the limits", /Over the roster limits\./.test(hub) && /you can’t add to a group you’re over in/.test(hub));
A("...and locks Call up into an over group", /if \(ocap!=null && on > ocap\)\{/.test(hub));
A("the roster page no longer calls salaries confidential", !/Confidential — management only\./.test(hub) && /Salaries and cap hits are public \(Rule 2\.5\)/.test(hub));
A("the Sign handler declares what it reads", /var lg = CG\.lg \|\| \{\};\s+var reg = \(lg\._registrationsRaw\|\|\[\]\)\.find\(function\(x\)\{ return x\.id===regId; \}\) \|\| \{\};\s+var pid = reg\.profile_id \|\| null;/.test(live));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.64");
A("changelog records 3.64", !!e);
A("2.1.1: 7/5/3 in force, and what an over club may do", /seven \(7\) forwards, five \(5\) defensemen and three \(3\) goaltenders, fifteen \(15\) in all/.test(secs["2.1"].paragraphs[0]) && /it may not add a player to a group it is over in/.test(secs["2.1"].paragraphs[0]));
A("no 'complete lines plus additional players' left in 2.1 or 10.1", !/complete lines/.test(secs["2.1"].paragraphs[0]) && !/complete lines plus additional players/.test(secs["10.1"].paragraphs[2]));
A("no em dashes or spaced hyphens in the 3.64 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
