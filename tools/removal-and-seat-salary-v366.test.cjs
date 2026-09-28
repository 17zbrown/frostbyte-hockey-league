/* v3.66: Q12 an office removal makes a free agent; Q28 a manager's old salary comes back when higher. The
   database half was rehearsed in Postgres (recorded at the foot of the SQL file). */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-removal-and-seat-salary-v366.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js");

console.log("\n— the rulings are quoted");
A("Q12", /"Becomes a free agent\."/.test(sqlF));
A("Q28", /yes the old salary should come back only if it is higher than what the management seat offers/.test(sqlF));

console.log("\n— the database");
A("Q12: the removal stamps waived_at like a waiver", /update public\.season_registrations set status = ''pending'', waived_at = now\(\)/.test(sql));
A("...tells the player and the wire", /''You are a free agent''/.test(sql) && /he is a free agent \(Rule 2\.2\)/.test(sql));
A("Q28: the pre-seat salary has its own column", /add column if not exists pre_seat_salary bigint/.test(sql));
A("...kept only from a player not already on a management contract", /v_was_mgr := exists\(select 1 from public\.contracts where profile_id=p_profile and status=''active'' and coalesce\(is_manager,false\)\);/.test(sql) && /if not v_was_mgr then\s+update public\.roster_spots set pre_seat_salary = coalesce\(pre_seat_salary, salary\)/.test(sql));
A("...and restored as the greatest of it, the seat's figure and the minimum", /set salary = greatest\(coalesce\(salary,0\), coalesce\(pre_seat_salary,0\), 750000\), pre_seat_salary = null/.test(sql));
A("the drafted manager is backfilled from the draft scale", /pre_seat_salary = public\.draft_pick_salary\(1, dp\.round\)/.test(sql));
A("the rehearsal is recorded", /Seat\s+emptied: salary 3,500,000, pre_seat_salary cleared/.test(sql));

console.log("\n— the site");
A("the removal dialog says free agent", /He becomes a free agent: his roster spot and cap hit clear, any club may sign him at the salary he was earning \(Rule 2\.2\)/.test(live));
A("...and refuses a seat holder before the call", /holds a front-office seat, so the seat is vacated under Teams first \(Rule 2\.6\)/.test(live));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.66");
A("changelog records 3.66", !!e);
A("2.5.4: an office removal is a free agent", /A player the league office removes from a club's roster is a free agent on the same terms as a waived player/.test(secs["2.5"].paragraphs[3]));
A("2.6.3: the old salary comes back when higher", /has that salary back when the seat ends, if it is higher than the seat's figure/.test(secs["2.6"].paragraphs[2]));
A("no em dashes or spaced hyphens in the 3.66 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
