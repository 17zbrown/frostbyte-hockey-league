/* v3.62: the draft rules. Q43 every basic-format order is random; Q44 a skipped pick goes empty and is
   replaced after the draft; Q49 a placement never carries a club over the cap. The database half was
   rehearsed in Postgres (recorded at the foot of the SQL file); this pins the record, the site and the book. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-draft-rules-v362.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js");

console.log("\n— the rulings are quoted");
A("Q43", /Season 2 draft: fully random \(no keepers between seasons\)/.test(sqlF));
A("Q44", /a skipped pick goes empty; the club gets one random extra player per missed pick at the end \(no make-up picks\)/.test(sqlF));
A("Q49", /Q49 \(a placement that would carry the drawn club over the cap\): "redraw\."/.test(sqlF));

console.log("\n— the database");
A("Q43: the standings styles are refused in a basic season", /if v_fmt = ''basic'' and p_style in \(''reverse_standings'',''lottery'',''nhl_lottery''\) then/.test(sql));
A("...and so is keeping a standings order", /coalesce\(v_prev_meta->>''fallback'', v_prev_meta->>''style''\) in \(''reverse_standings'',''lottery'',''nhl_lottery''\)/.test(sql));
A("Q44: the desk refuses a skipped pick", /elsif coalesce\(v_pick\.skipped,false\) then[\s\S]{0,300}a skipped pick goes empty and cannot be made up/.test(sql));
A("...the office's tool too", /use_draft_pick[\s\S]{0,600}if coalesce\(v_pick\.skipped,false\) then/.test(sql));
A("...the 'make-up pick' wire text is gone", /position\('else '', make-up pick''' in d\) > 0/.test(sql));
A("...an expired clock says the pick goes empty", /the pick goes empty\. The club receives one player at random for it once the draft is over \(Rule 2\.8\)\./.test(sql));
A("Q49: one cap test, from the cap guard's own payroll", /create or replace function public\.cap_has_room\(p_season uuid, p_team uuid, p_salary bigint\)/.test(sql) && /public\.team_cap_used\(p_season, p_team\) \+ coalesce\(p_salary, 0\)/.test(sql));
A("...not callable from the API", /revoke all on function public\.cap_has_room\(uuid, uuid, bigint\) from public, anon, authenticated;/.test(sql));
A("...every club draw in _assign_reg_random reads only clubs with room", /if v_n <> 5 then raise exception '_assign_reg_random: expected 5 club draws/.test(sql) && /'from \(select \* from public\.teams tt where public\.cap_has_room\(v_reg\.season_id, tt\.id, 750000\)\) t'/.test(sql));
A("...unused-pick placement skips a club it would carry over, and tells the office once", /if not public\.cap_has_room\(p_season, v_team\.id, 750000\) then/.test(sql) && /'Unused draft picks not replaced: no cap room'/.test(sql) && /rl_unused-pick-cap/.test(sql));
A("...a late sign-up is never failed by its placement", /exception when others then\s+perform public\.notify_commissioners\(null, ''flag'', ''Late sign-up not placed''/.test(sql));
A("the rehearsal is recorded", /Result: REHEARSAL OK: Q43 standings styles refused/.test(sql) && /cap room: skipped, office told, run not aborted;/.test(sql));

console.log("\n— the site");
A("the desk offers only non-standings styles in basic", /CG\.DRAFT_STANDINGS_STYLES = \["nhl_lottery","reverse_standings","lottery"\];/.test(live) && /CG\.draftStylesOffered\(\)\.map\(function\(s\)\{/.test(live));
A("...and defaults to Pure random", /offered\.indexOf\("random"\) >= 0 \? "random"/.test(live) && !/\|\|"nhl_lottery"\)/.test(live) && !/\|\| "nhl_lottery";/.test(live));
A("no make-up button or copy is left", !/Make-up picks/.test(live) && !/MAKE-UP WAITING/.test(live) && !/Use this pick/.test(live) && !/keeps the pick as a make-up/.test(live) && !/Skipped picks stay recoverable/.test(live));
A("the office cannot pick for a skipped slot from the table", /: isCur&&running\?'<button class="btn btn-ghost btn-sm" data-openpick=/.test(live));
A("a skipped pick is no trade asset", /return p\.ownerCode===code && !p\.used && !p\.skipped/.test(live));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.62");
A("changelog records 3.62", !!e);
A("0.5.2: a skipped selection goes empty", /the selection is skipped and goes empty/.test(secs["0.5"].paragraphs[1]) && !/remains the club's to use/.test(secs["0.5"].paragraphs[1]));
A("2.8.3: no standings order, no lottery", /No order based on standings, and no lottery weighted by a previous season, is used\./.test(secs["2.8"].paragraphs[2]));
A("2.8.5: no deferred selection used later", !/deferred/.test(secs["2.8"].paragraphs[4]));
A("2.8.6: no one makes a skipped selection later", /no one, the league office included, makes a skipped selection later in the draft/.test(secs["2.8"].paragraphs[5]));
A("2.8.8: self-concluding, skip not defer, random depth, cap redraw", /concludes by itself when no selection is left on the clock/.test(secs["2.8"].paragraphs[7]) && !/defer a selection/.test(secs["2.8"].paragraphs[7]) && /drawn at random from those whose camp has room/.test(secs["2.8"].paragraphs[7]) && /A club without room under the salary cap for the league minimum is never drawn for a placement/.test(secs["2.8"].paragraphs[7]));
A("no em dashes or spaced hyphens in the 3.62 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
