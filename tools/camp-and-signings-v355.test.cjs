/* v3.55: training camp capped at eight; a signing or a trade that does not fit the active roster lands
   in camp; the book's waiver rule matches the site. The database half was rehearsed in Postgres
   (recorded at the foot of the SQL file); this pins the record, the site and the book. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-camp-and-signings-v355.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js");

console.log("\n— the rulings are quoted");
A("Q1", /Waived players should be a free agent immediately instead of the claim period/.test(sqlF));
A("Q2", /Allow a claimed player to be placed on the team's training camp if the team already has a full roster\. Cap the Training camps at 8 players each though/.test(sqlF));
A("trades", /If the active rosters are full, they can go to the training camp and the team management can bring them up to active roster if they choose/.test(sqlF));

console.log("\n— the database");
A("the basic format's camp limit is 8", /replace\(d0, '"camp_max":999', '"camp_max":8'\)/.test(sql));
A("every camp player counts toward it", /select count\(\*\) into n_tc from roster_spots\s+where season_id = NEW\.season_id and team_id = NEW\.team_id and status = ''active'' and squad = ''tc'';/.test(sql));
A("both full is refused in words", /its training camp is full \(% players\)\. Make room on one of them first/.test(sql));
A("depth placement draws only a camp with room", /v3\.55: only a club whose training camp has room/.test(sql));
A("a signing with a full active roster goes to camp", /v_to_camp := true;/.test(sql) && /case when v_to_camp then ''tc'' end/.test(sql) && /so is your training camp/.test(sql));
A("a trade overflows after EVERY move", /perform public\._overflow_to_camp\(t\.season_id, t\.to_team_id, t\.offered_profile_ids\);\s+perform public\._overflow_to_camp\(t\.season_id, t\.from_team_id, t\.requested_profile_ids\);/.test(sql));
A("...the over-full group first, the latest incoming first", /v_grp := case when f > qf then 'F' when d > qd then 'D' when g > qg then 'G' end;/.test(sql) && /order by array_position\(p_incoming, rs\.profile_id\) desc/.test(sql));
A("...as the league's own move, camp limit still applied", /set_config\('app\.role_grant', 'on', true\)/.test(sql) && /set_config\('app\.mgmt_approved', p_team::text, true\)/.test(sql));
A("...and the club is told", /'Traded into training camp: '/.test(sql));
A("...reversals too", /v3\.55: a player going back to a club that has since filled up joins its camp/.test(sql));
A("the overflow helper is not callable from the API", /revoke all on function public\._overflow_to_camp\(uuid, uuid, uuid\[\]\) from public, anon, authenticated;/.test(sql));
A("the rehearsal is recorded", /T4\s+DET sends two forwards to UTA for one: exactly one incoming forward is placed in UTA's camp/.test(sql) && /T6\s+DET sends two forwards to PIT \(camp 10\) for one: the trade is refused/.test(sql));

console.log("\n— the site");
A("the client mirror carries camp_max 8", /basic: \{ format:"basic", roster_max:15, quota:\{ F:9, D:7, G:5 \}, lines:2, flex:3, camp_max:8,/.test(live));
A("Sign stays open with a full active roster while camp has room", /var full = activeFull && campN >= \(CG\.CAMP_MAX\|\|8\);/.test(live) && /he would join your training camp \(Rule 2\.1\)/.test(live));
A("the sign dialog says he joins camp", /"He joins your "\+\(toCamp \? "training camp, because your active roster is full, " : "roster "\)/.test(live));
A("no 'league minimum' left in the waive dialog or the roster footer", !/sign them at the league minimum/.test(hub) && !/sign him at the league minimum/.test(hub));
A("...they say the salary travels", /at the "\+CG\.fmtMoney\(p\.salary\)\+" they were already earning/.test(hub) && /at the salary he was already earning, to the end of the season/.test(hub));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.55");
A("changelog records 3.55", !!e);
A("2.1.4: camp of eight", /up to eight \(8\) training-camp players/.test(secs["2.1"].paragraphs[3]) && !/camp is unlimited/.test(secs["2.1"].paragraphs[3]));
A("2.1.4: trades overflow to camp; like-for-like between full clubs does not", /he joins the club's training camp, its front office is told/.test(secs["2.1"].paragraphs[3]) && /two full clubs exchanging like for like send nobody to camp/.test(secs["2.1"].paragraphs[3]));
A("2.1.4: transactions staff in special circumstances", /in special circumstances the transactions department may make that move for a club/.test(secs["2.1"].paragraphs[3]));
A("2.2.3: signing into camp", /he joins its training camp, which must have room under Rule 2\.1/.test(secs["2.2"].paragraphs[2]));
A("2.5.4: no waiver period, no claim", /^Waiving a player removes his cap hit from the club immediately\. There is no waiver period and no claim/.test(secs["2.5"].paragraphs[3]));
A("2.5.1: sign, not claim", /complete a trade or sign a waived player/.test(secs["2.5"].paragraphs[0]));
A("no em dashes or spaced hyphens in the 3.55 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
