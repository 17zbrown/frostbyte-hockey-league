/* v3.61: management stays on the active roster (Q29), and in season a GM or AGM comes from the Owner's
   own club (Q27). The database half was rehearsed in Postgres (recorded at the foot of the SQL file);
   this pins the record, the site and the book. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-09-28-management-roster-v361.sql"), sqlF = sql.replace(/\n--\s*/g, " ");
const live = R("src/live/part_live.js"), hub = R("src/live/part6_hub.js");

console.log("\n— the rulings are quoted");
A("Q29", /Management can never be sent to training camp, they must stay on the active roster/.test(sqlF));
A("Q27", /As long as the named player is on their roster\. If it is the off season between the end of playoffs, and the draft of the next season, they can freely sign anyone as their GM or AGM/.test(sqlF));
A("the 7/5/3 composition is left for clarification", /Q29's composition clause \(7 F \/ 5 D \/ 3 G\) is NOT applied here/.test(sqlF));

console.log("\n— the database");
A("one definition of the season window", /create or replace function public\.season_underway\(\)/.test(sql) && /where status = 'active'\)\s+or exists \(select 1 from public\.draft_state d\s+where d\.season_number = public\.current_season_num\(\)\s+and d\.status in \('live','paused','complete'\)\)/.test(sql));
A("...not callable from the API", /revoke all on function public\.season_underway\(\) from public, anon, authenticated;/.test(sql));
A("a seat holder is never sent to camp, by anyone", /if NEW\.squad = ''tc'' and exists \(select 1 from public\.teams t where t\.id = NEW\.team_id\s+and NEW\.profile_id in \(t\.owner_profile_id, t\.gm_profile_id, t\.agm_profile_id\)\) then/.test(sql) && !/tc''[^;]*is_commissioner/.test(sql));
A("...said in words", /Management is never sent to training camp\./.test(sql));
A("a new manager spot is never parked in camp", /if NEW\.squad = ''pro'' and coalesce\(current_setting\(''app\.mgr_sync'', true\), ''''\) = ''1'' then return NEW; end if;/.test(sql));
A("a camp manager comes up with the seat", /update public\.roster_spots set squad = ''pro'' where id = v_spot;/.test(sql));
A("...restoring the caller's trusted flag, not clearing it", /v_grant := coalesce\(current_setting\(''app\.role_grant'', true\), ''''\);/.test(sql) && /set_config\(''app\.role_grant'', v_grant, true\)/.test(sql));
A("in season: the club's own roster or camp", /if new\.role in \('gm','agm'\) and public\.season_underway\(\) then/.test(sql) && /rs\.team_id = new\.team_id and rs\.profile_id = new\.nominee_id/.test(sql));
A("...a camp nominee needs room on the active roster", /is in training camp, and a manager plays on the active roster, which has no room for him in his position group/.test(sql));
A("off-season: anyone signed up for the coming season", /is not signed up for the coming season/.test(sql));
A("the free-agent requirement is gone", !/must be a free agent/.test(sql));
A("Rule 2.7 still applies in every window", /cannot hold a club management role \(Rule 2\.7\)/.test(sql));
A("the rehearsal is recorded", /Result: REHEARSAL OK: 1 ok; 2 ok; 3 ok; 4 ok; 5 ok; 6 ok; 6b ok; 7 ok; 8 ok; 9 ok; 10 ok;/.test(sql));

console.log("\n— the site");
A("the client mirrors the season window", /CG\.seasonUnderway = function\(\)\{\s+if \(CG\.SEASON && CG\.SEASON\.status==="active"\) return true;/.test(live) && /\["live","paused","complete"\]\.indexOf\(st\.status\)>=0/.test(live));
A("in season the picker is the club's roster and camp", /var inSeason = CG\.seasonUnderway\(\);/.test(live) && /id="mgNomineeSel"/.test(live) && /x\.spotId && !x\.mgmt/.test(live));
A("off-season keeps the member picker", /if \(!inSeason\) CG\.wireMemberPicker\("mgNominee", \["seasonplayers"\]\);/.test(live));
A("no copy says the nominee must be a free agent", !/isn’t already under contract/.test(live) && !/they don’t have to be on your roster/.test(live));
A("the removed-manager note matches v3.27", !/a spot held only because of the seat is released with it/.test(live));
A("Team HQ locks To camp for a manager", /if \(p\.mgmt && p\.squad!=="tc"\)\{/.test(hub) && /is never sent to training camp \(Rule 2\.6\)/.test(hub));

console.log("\n— the book");
global.window = {}; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, secs = {};
rb.chapters.forEach((ch) => ch.sections.forEach((s) => { secs[s.id] = s; }));
const e = rb.changelog.find((c) => c.version === "3.61");
A("changelog records 3.61", !!e);
A("2.6.1: in season, from his own club; off-season, anyone signed up", ["paragraphs", "full"].every((k) => /the nominee must be on the club's active roster or in its training camp when he is nominated/.test(secs["2.6"][k][0]) && /the Owner may name anyone signed up for the coming season, on his club or not/.test(secs["2.6"][k][0])));
A("2.6.3: never sent to camp, both formats", ["paragraphs", "full"].every((k) => /no one, the league office included, may send a manager to the training camp/.test(secs["2.6"][k][2])));
A("2.1: the camp rule points to 2.6", /A manager is never sent to the training camp while he holds his seat \(Rule 2\.6\)\./.test(secs["2.1"].paragraphs[3]));
A("no em dashes or spaced hyphens in the 3.61 entry", !/—| - /.test(JSON.stringify(e)));

console.log("\n" + (fail ? fail + " of " + n + " FAILED" : "all " + n + " passed"));
process.exit(fail ? 1 : 0);
