/* v3.57: trade status transitions, reversal after the deadline, Away's preferred server, streaming,
   draft at 9 PM, and book rulings. Rehearsed in Postgres (recorded at the foot of the SQL file). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-small-fixes-v357.sql"), live = R("src/live/part_live.js"), pub2 = R("src/live/part5b_public2.js"), sched = R("netlify/functions/discord-scheduler.js");
console.log("\n— the database");
A("status moves only through the Trade Hub's own doors", /create trigger guard_trade_status_trg before update of status on public\.trades/.test(sql)
  && /old\.status = 'proposed' and new\.status = 'declined'\s+and \(public\.is_gm_of\(old\.to_team_id\)/.test(sql)
  && /old\.status = 'proposed' and new\.status = 'cancelled'\s+and \(public\.is_gm_of\(old\.from_team_id\)/.test(sql)
  && /new\.status = 'accepted' and v_op = 'accept'/.test(sql) && /new\.status = 'reversed' and v_op = 'reverse'/.test(sql));
A("accept_trade and reverse_trade open their own door", /set_config\(''app\.trade_op'', ''accept'', true\)/.test(sql) && /set_config\(''app\.trade_op'', ''reverse'', true\)/.test(sql));
A("Q36: the department reverses after the deadline", /new\.status = ''reversed'' and coalesce\(current_setting\(''app\.trade_op'', true\), ''''\) = ''reverse''\s+and public\.has_department\(''transactions''\)/.test(sql));
A("Q25: Away's preferred before the standard server", /if v_res is null and v_apref is not null and v_apref is distinct from v_veto then/.test(sql));
A("Q35: the announcement no longer requires streaming", /Streaming is not required, but a stream of every playoff game is recommended/.test(sql));
A("the rehearsal is recorded", /T6\s+with moves locked, a transactions staffer reverses it/.test(sql));
console.log("\n— the site");
A("Auto-space puts the draft at 9 PM in both formats", (live.match(/put\("ssDraft",\s+CG\.etISO\(draftDay,"21:00"\)\);/g) || []).length === 2 && !/put\("ssDraft",\s+CG\.etISO\(draftDay,"19:00"\)\)/.test(live));
A("the match page says streaming is recommended", /"Recommended, not required"/.test(pub2) && !/require at least one stream/.test(pub2));
A("...and states the basic series cap from the format", /no player may be dressed in more than '\+\(CG\.seriesCap \? CG\.seriesCap\(\{\}\) : 4\)\+' games of this series/.test(pub2));
A("the availability reminder states the fixed hour", /Rule 5\.1: 7:30 PM Eastern on the week's first game day/.test(sched));
console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.57");
A("changelog records 3.57", !!e);
A("Appendix A: the draft at 9:00 PM", /held live on the site at 9:00 PM Eastern/.test(secs["0.5"].full[0]));
A("2.3.1: status changes", /An offer is declined only by the club that received it and withdrawn only by the club that made it/.test(secs["2.3"].paragraphs[0]));
A("2.3.3: reversal before or after the deadline", /The transactions department, or a commissioner, may thereafter review any completed trade and reverse it, before or after the movement deadline/.test(secs["2.3"].paragraphs[2]));
A("3.2.6, 3.3.1, 5.1.2, 5.1.4: reschedules only in special circumstances", /not entitled to a reschedule/.test(secs["3.2"].paragraphs[5]) && /only in special circumstances/.test(secs["3.3"].paragraphs[0]) && /approved only in special circumstances \(Rule 3\.3\)/.test(secs["5.1"].paragraphs[1]) && /approved only in special circumstances \(Rule 3\.3\)/.test(secs["5.1"].paragraphs[3]));
A("5.1.1: the fixed hour", /Game times do not change, so the deadline is always that fixed hour/.test(secs["5.1"].paragraphs[0]) && !/90 minutes before the first puck drop/.test(secs["5.1"].paragraphs[0]));
A("5.2.1: positions are preferences", /the positions a player lists are his preferred spots rather than limits/.test(secs["5.2"].paragraphs[0]));
A("4.2.6: Away's preferred", /or had its only choice vetoed with no second choice left standing, the Away club's preferred server/.test(secs["4.2"].paragraphs[5]));
A("6.2.2 and 8.3.2: streaming recommended", /Streaming is not required, in the regular season or the playoffs, but it is recommended/.test(secs["6.2"].paragraphs[1]) && /Streaming a playoff game is recommended, not required/.test(secs["8.3"].paragraphs[1]));
A("no em dashes or spaced hyphens in the 3.57 entry", !/—| - /.test(JSON.stringify(e)));
console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
