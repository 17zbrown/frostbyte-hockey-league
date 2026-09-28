/* v3.52: forfeit rulings. Only a commissioner reverses a forfeit or a void; staff report a mistake;
   the playoff series and clinch counters decide a game the way the standings do. The database half
   was rehearsed in Postgres (the battery is recorded at the foot of the SQL file); this pins the
   record, the client, the importer gate and the book. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-forfeit-rulings-v352.sql");
const live = R("src/live/part_live.js"), desks = R("src/live/part9_staffdesks.js");
const ingest = R("netlify/functions/ingest-stats.js");

console.log("\n— the ruling is quoted");
A("commissioner's words", /Do not allow a staffer to undo any forfeits, if there is a mistake\s*\n--\s*entered by staff, a commissioner must be notified/.test(sql));

console.log("\n— reversals are a commissioner's");
A("undo_forfeit gate", /d0 := pg_get_functiondef\('public\.undo_forfeit\(uuid\)'::regprocedure\)[\s\S]*?if not public\.is_commissioner\(\) then\s+raise exception ''Only a commissioner can reverse a forfeit or a void/.test(sql));
A("unforfeit_game gate", /d0 := pg_get_functiondef\('public\.unforfeit_game\(uuid\)'::regprocedure\)[\s\S]*?if not public\.is_commissioner\(\) then\s+raise exception ''Only a commissioner can reverse a forfeit\./.test(sql));
A("result correction refuses a ruled game", /forfeit_team_id is not null or coalesce\(voided, false\)\)\) then\s+raise exception ''This game carries a forfeit or void ruling/.test(sql));
A("every patch fails loud", (sql.match(/if d = d0 then raise exception/g) || []).length === 4);

console.log("\n— the report door");
A("staff only, with a real note", /if v_me is null or not \(public\.is_staff\(\) or public\.is_commissioner\(\)\) then/.test(sql) && /if length\(v_note\) < 10 then/.test(sql));
A("tells every commissioner and the casework channel", /perform public\.notify_commissioners\(array\[v_me\], 'flag', 'A ruling needs a commissioner'/.test(sql) && /notify_staff_ch\('casework', '\*\*Ruling mistake reported\*\*/.test(sql));
A("one report per staffer per game per hour", /a\.actor = v_me and a\.created_at > now\(\) - interval '1 hour'/.test(sql));
A("not callable signed out", /revoke all on function public\.report_ruling_mistake\(uuid, text\) from public, anon;/.test(sql));

console.log("\n— one definition of a winner");
A("game_winner: void, forfeit, goals", /when coalesce\(p_voided, false\) then null\s+when p_forfeit is not null then case when p_forfeit = p_home then p_away/.test(sql));
A("series counts by game_winner", /count\(\*\) filter \(where public\.game_winner\(g\.home_team_id, g\.away_team_id, g\.home_score, g\.away_score, g\.forfeit_team_id, g\.voided\) = new\.home_team_id\)/.test(sql));
A("series re-runs on a ruling change on a final", /old\.forfeit_team_id is not distinct from new\.forfeit_team_id\s+and old\.voided is not distinct from new\.voided/.test(sql));
A("series concluded once, keyed in app_config", /v_key := 'series_'\|\|v_num/.test(sql) && /on conflict \(key\) do nothing;/.test(sql));
A("a changed outcome goes to the commissioners", /'A ruling changed who won a playoff series'/.test(sql) && /'A concluded playoff series no longer has a winner'/.test(sql));
A("a held game is never trimmed", /g\.status = 'scheduled'\s+and g\.ea_match_id is null/.test(sql));
A("clinch points by game_winner, no OT point on a forfeit", /g\.forfeit_team_id is null and g\.went_ot then 1/.test(sql));
A("clinch re-runs on a ruling change", /or old\.forfeit_team_id is distinct from new\.forfeit_team_id/.test(sql));
A("the battery is recorded", /T5\s+a best-of-seven/.test(sql) && /T7\s+check_playoff_clinches/.test(sql));

console.log("\n— the site");
A("Stats manager: undo for commissioners, report for staff", /CG\.auth && CG\.auth\.role === "commish"\s*\n\s*\? '<button class="btn btn-ghost" id="smFfUndo">Undo a forfeit<\/button>'\s*\n\s*: '<button class="btn btn-ghost" id="smFfReport"/.test(live));
A("...and the report button is wired", /var rep = document\.getElementById\("smFfReport"\);[\s\S]{0,200}CG\.reportRulingPrompt\(gSel\.value\)/.test(live));
A("the forfeit dialog no longer says the loser burns a game", !/burns the game toward its weekly count/.test(live) && /counts toward no player’s weekly games on either club/.test(live));
A("no copy promises a later merge replaces a forfeit", !/replaces the forfeit ruling/.test(live) && !/A later lag-out merge of the real game replaces this ruling/.test(live));
A("Officials' desk lists forfeits (reads the mapped code)", /return g\.status==="final" && \(g\.forfeit \|\| g\.voided\);/.test(desks) && !/g\.forfeit_team_id \|\| g\.voided/.test(desks));
A("Officials' desk: Put it back for commissioners, Report for staff", /\(commishNow\s*\n\s*\? '<button class="btn btn-ghost btn-sm" data-desk-unforfeit=/.test(desks) && /data-desk-report=/.test(desks));
A("the report prompt calls the RPC", /CG\.reportRulingPrompt = function\(id\)\{[\s\S]*?CG\.sb\.rpc\("report_ruling_mistake", \{ p_game: id, p_note: note \}\)/.test(desks));

console.log("\n— the importer");
A("the commissioner is marked", /if \(prof\.role === "commissioner"\) return \{ ok: true, uid, who, via: "staff", commish: true \};/.test(ingest));
A("only a commissioner merges onto a ruled game", /if \(game\.forfeit_team_id != null && !actor\.commish\)/.test(ingest));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js").replace(/^CG\.CONTENT/m, "CG.CONTENT"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
/* by version, never by position: a later release takes changelog[0] */
const e352 = rb.changelog.find((c) => c.version === "3.52");
A("changelog records 3.52", !!e352);
A("3.2.4: only a commissioner reverses; staff report", /Once a forfeit has been recorded, only a commissioner may reverse it or change its score\./.test(secs["3.2"].paragraphs[3]));
A("3.2.5: officiating or a commissioner voids; only a commissioner lifts", /the officiating department or a commissioner voids it, and a voided game is kept out of the standings\. Only a commissioner lifts a void\./.test(secs["3.2"].paragraphs[4]));
A("7.1.2: involvement, case by case", /any matter that involves them or a club they play for or manage/.test(secs["7.1"].paragraphs[1]) && /the league's tools do not stop an official mechanically/.test(secs["7.1"].paragraphs[1]));
A("8.3.2: playoff forfeits count in the series", /a forfeit counts in the series as a win for the club that did not forfeit/.test(secs["8.3"].paragraphs[1]));
const e = JSON.stringify(e352);
A("no em dashes or spaced hyphens in the 3.52 entry", !/—| - /.test(e));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
