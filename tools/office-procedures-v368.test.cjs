/* v3.68: Q42 forfeit flags; Q47 application votes; Q60 statistics corrections; resend trades; Q63 trade gate; Q40
   moved games. The database half was rehearsed in Postgres (recorded at the foot of the SQL file). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-office-procedures-v368.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js"), desks = R("src/live/part9_staffdesks.js");

console.log("\n— the rulings are quoted");
A("Q42", /10 games could be a good amount to flag at\. if a team\s+forfeits 16 games in a season, that is grounds for a management removal decided on by staff\./.test(sqlF));
A("Q47", /Only a commissioner can decide on a vote on their own\.\s+Staff can only place individual votes that need to add up to 50% \+1 out of all the voting staff\./.test(sqlF));
A("Q60, resend, Q63, Q40", /"yes"/.test(sqlF) && /just resending\./.test(sqlF) && /"in theory, yes\."/.test(sqlF) && /act of god circumstances/.test(sqlF));

console.log("\n— the database");
A("Q42: counted per season, flagged once at 10 and at 16", /foreach v_step in array array\[16, 10\] loop/.test(sql) && /'forfeit_flag_'\|\|v_num\|\|'_'\|\|v_team\|\|'_'\|\|v_step/.test(sql) && /after insert or update of forfeit_team_id, voided on public\.games/.test(sql));
A("Q47: majority of all reviewers, decided when certain", /v_need := \(v_e \/ 2\) \+ 1;/.test(sql) && /if v_a >= v_need then\s+perform public\.apply_application_decision\(p_type, p_id, true\);\s+elsif v_d > v_e - v_need then/.test(sql) && !/not every reviewer has voted yet/.test(sql));
A("...alone, only a commissioner", (sql.match(/Only a commissioner decides an application alone/g) || []).length === 2);
A("Q60: the type exists, a seat is required, it routes to statistics", /'stats_correction'\]\)\)/.test(sql) && /new\.dept := 'statistics';/.test(sql) && /filed by a club''s Owner, GM or AGM \(Rule 6\.3\)/.test(sql) && /notify_department\('statistics', 'request'/.test(sql));
A("resend: transactions or a commissioner; declined or withdrawn; players still in place", /create or replace function public\.resend_trade\(p_trade uuid\)/.test(sql) && /if t\.status not in \('declined', 'cancelled'\) then/.test(sql) && /is no longer with the club that offered him/.test(sql));
A("Q63: the service check runs on offers and acceptances", /if new\.status in \(''proposed'', ''accepted''\) then/.test(sql) && /v_why := public\.can_move_player\(new\.season_id, v_p\);/.test(sql) && /before he can be waived or traded/.test(sql));
A("Q40: a non-playoff game takes the week it is played in", /if coalesce\(g\.stage, ''regular''\) <> ''playoff'' then/.test(sql) && /week = coalesce\(v_week, week\)/.test(sql));
A("the rehearsal is recorded", /Result: REHEARSAL OK \(both parts\)/.test(sql));

console.log("\n— the site");
A("the Statistics correction is offered to managers only", /stats_correction:\{ label:"Statistics correction"[^\n]*mgmtOnly:true/.test(live) && /CG\.actionTypesFor = function\(\)\{/.test(live) && /CG\.actionTypesFor\(\)\.map\(function\(k\)\{/.test(live));
A("...with the club's games to pick from", /if \(type==="stats_correction"\)\{[\s\S]{0,400}g\.status==="final" && \(g\.home===mt\.code \|\| g\.away===mt\.code\)/.test(live));
A("the ballot says how many reviewers decide it", /"Cast your vote: "\+need\+" of "\+N\+" reviewers decide it"/.test(live) && !/until the last reviewer votes/.test(live));
A("the transactions desk offers Resend on a declined or withdrawn offer", /data-tx-resend="'\+t\.id/.test(desks) && /CG\.sb\.rpc\("resend_trade", \{ p_trade:id \}\)/.test(desks));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.68");
A("changelog records 3.68", !!e);
A("3.2.6: ten and sixteen", /ten \(10\) forfeits in a season refer the club to the officiating department/.test(secs["3.2"].paragraphs[5]) && /sixteen \(16\) forfeits in a season are grounds for removing the club's management/.test(secs["3.2"].paragraphs[5]));
A("3.3.1: the week it is played, almost never", /a game moved into another game-week counts toward the week in which it is played/.test(secs["3.3"].paragraphs[0]) && /That almost never happens/.test(secs["3.3"].paragraphs[0]));
A("2.6.1: majority of all reviewers; alone, a commissioner", /approved once more than half of all the reviewers approve it/.test(secs["2.6"].paragraphs[0]) && /Only a commissioner decides one alone\./.test(secs["2.6"].paragraphs[0]));
A("6.3.1: the Statistics correction", /the Statistics correction in the Action Center, which its Owner, GM or AGM files/.test(secs["6.3"].paragraphs[0]));
A("2.3.1: resend, and staff act otherwise only to reverse", /The transactions department may resend a declined or withdrawn offer as it was/.test(secs["2.3"].paragraphs[0]));
A("2.4: a season minimum gates trades too", /Where a season sets one, it applies to a trade as it does to a waiver\./.test(secs["2.4"].paragraphs[2]));
A("no em dashes or spaced hyphens in the 3.68 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
