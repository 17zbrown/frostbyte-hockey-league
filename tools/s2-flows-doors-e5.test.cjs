/* v5.00 swap (stream e5, 2026-11-24): the Season 2 site's filed forms and survey use the current site's own doors.
   Reads src/s2/js/flows.js and js/survey.js beside the classic reference (src/live) and the SQL records, and pins: each
   form's door and conflict target, the case types against action_requests_type_check, the Rule 2.7 sentences against the
   database's (v4.58), the trade deadline hint, the survey's key and answer words against the live site's and
   submit_season_survey's, that every write goes through S2.write (no direct table call), and that the waitlist is gone.
   The browser half is tools/ui/flows.test.cjs (node tools/ui/run.cjs flows, and --mode mock).
   Run: node tools/s2-flows-doors-e5.test.cjs */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got))); } };

const flows = R("src/s2/js/flows.js"), survey = R("src/s2/js/survey.js"), live = R("src/live/part_live.js"), liveSv = R("src/live/part11_survey.js");
const conflicts = R("sql/2026-11-24-s2-application-conflicts-v458.sql"), svSql = R("sql/2026-10-20-season2-survey-v423.sql");
const typeSql = R("sql/2026-10-12-over-limit-forfeit-v393.sql");

console.log("## the doors, as the current site files each form");
const door = (re, label) => A(label, re.test(flows));
door(/S2\.write\("profiles\.update", \{ set: \{ ea_id: trim\(d\.ea\), platform: d\.console, platform_gamertag: trim\(d\.tag\) \}, match: \{ id: id \} \}\)/, "sign-up: the three details on the profile first (CG.savePlayerDetails)");
door(/S2\.write\("season_registrations\.upsert", \{ row: \{ season_id: s\.id, profile_id: id, position: d\.pos \}, onConflict: "season_id,profile_id" \}, \{ sections: \["signups"\] \}\)/, "sign-up: then the registration, one per member and season, re-read (CG.registerForSeason)");
A("the classic site keys the same two conflicts", /upsert\(payload,\{onConflict:"season_id,profile_id"\}\)/.test(live) && /owner_applications"\)\.upsert\(payload,\{onConflict:"profile_id,season_id"\}\)/.test(live) && /staff_applications"\)\.upsert\(payload,\{onConflict:"profile_id"\}\)/.test(live));
door(/S2\.write\("owner_applications\.upsert", \{[\s\S]*?onConflict: "profile_id,season_id", select: "id,status,edited_at" \}\)/, "owner application: one per member and season (v3.95)");
door(/S2\.write\("staff_applications\.upsert", \{[\s\S]*?departments: keys[\s\S]*?onConflict: "profile_id", select: "id,status" \}\)/, "staff application: one per member, committees as keys in departments");
door(/S2\.write\("action_requests\.insert", \{ row: row \}\)/, "cases: one action_requests row (CG.fileActionRequest)");
door(/route: t === "trade_request" \? "manager" : "commissioner"/, "a trade request goes to the club's front office, everything else to the league office (Rule 2.3)");
door(/row\.team_id = S2\.session\.teamId/, "a trade request names the filer's club");
door(/S2\.write\("direct_messages\.insert", \{ row: \{ sender_id: id, recipient_id: to\.id, body: trim\(d\.body\) \} \}\)/, "messages: one direct_messages row (CG.dmSend)");
door(/S2\.write\("set_my_jersey_number", \{ p_number: \+d\.num \}/, "the jersey number through its own door (CG.saveMyJersey)");
/* review 2026-11-24: the League profile form opened empty and its save wrote preferred_server null over a saved one */
const flowDef = (k) => (flows.split("\n    " + k + ": {")[1] || "").split("\n    },")[0];
A("the sign-up and the League profile both start from the profile on file (no row is an error, never an empty form)",
  /prep: function \(d, ctx\) \{ return mine\("profile"\)/.test(flowDef("register")) && /prep: function \(d, ctx\) \{\s*return mine\("profile"\)[\s\S]*?d\.server = p\.preferred_server/.test(flowDef("profile"))
  && /kind === "profile" \? sb\.from\("profiles"\)\.select\(PROFILE_COLS\)\.eq\("id", id\)/.test(flows) && /if \(kind === "profile" && !r\.data\) throw/.test(flows));
A("the sign-up writes the details only when one is missing or changed (CG.regMissing), and the number only when changed (v3.78)",
  /p && !detailsChanged\(d, p\) \? Promise\.resolve\(\)/.test(flowDef("register")) && /num === "" \|\| num === \(was\.jersey_number == null/.test(flowDef("profile")));
A("the classic Settings card fills the server from the profile", /\(p\.preferred_server\|\|""\)===x\?" selected":""/.test(live));
door(/kind === "owner" \? "withdraw_owner_application" : "withdraw_staff_application", \{ p_app: appId \}/, "withdrawals through their doors (v4.21, v4.22)");
door(/function confirmed\(r, status\)[\s\S]*?if \(!d \|\| !d\.ok \|\| d\.status !== status\)/, "a withdrawal is a success only on its confirmed status");
door(/S2\.write\("management_applications\.insert", \{ row: \{ team_id: o\.teamId, role: o\.role, submitted_by: id, nominee_id: o\.nomineeId, pitch: orNull\(o\.pitch\) \}/, "GM and AGM nominations (CG.submitMgmtApp)");
door(/S2\.write\("management_applications\.update", \{ set: \{ status: "withdrawn"/, "a nomination's withdrawal");
A("no write leaves flows.js or survey.js except through S2.write (no direct insert, upsert, update or delete)", !/\.(insert|upsert|update|delete)\(/.test(flows) && !/\.(insert|upsert|update|delete)\(/.test(survey));
A("nothing fetches", !/\bfetch\(/.test(flows) && !/\bfetch\(/.test(survey));
A("a filing shows as done only after the door resolves", /def\.send\(d, ctx\); \}\)\.then\(function \(res\) \{\s*sending = false; phase = "done";/.test(flows));
A("a refusal keeps the answers and shows the database's words", /sending = false; sendErr = said\(e\);/.test(flows) && /function said\(e\)/.test(flows));

console.log("## the case types are the database's");
const check = (/add constraint action_requests_type_check\s+check \(type = any \(array\[([^\]]*)\]\)\)/.exec(typeSql) || [])[1] || "";
const dbTypes = check.split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
const caseBlock = (/var CASE_TYPES = \[([\s\S]*?)\n  \];/.exec(flows) || [])[1] || "";
const formTypes = [...caseBlock.matchAll(/^\s*\["([a-z_]+)"/gm)].map((m) => m[1]);
A("the database's type check was read", dbTypes.indexOf("stats_correction") >= 0 && dbTypes.length >= 6, dbTypes);
A("every type the form files is one the database accepts", formTypes.length === 6 && formTypes.every((t) => dbTypes.indexOf(t) >= 0), formTypes);
A("stat_fix is gone from the form", formTypes.indexOf("stat_fix") < 0);

console.log("## Rule 2.7: the page says the database's own sentences");
for (const sentence of ["Commissioners cannot apply to own a club (Rule 2.7). Step down as commissioner first, then apply.",
  "Members of the league staff cannot apply to own a club (Rule 2.7). Leave the staff first, then apply.",
  "Owners, General Managers and Assistant General Managers cannot apply to join the league staff (Rule 2.7). Step down from your club seat first, then apply."]) {
  A("in the database and on the form: " + sentence.slice(0, 60), conflicts.indexOf(sentence) >= 0 && flows.indexOf(sentence) >= 0);
}
/* i3a (2026-11-25): the demo's seat and rule locks (def.gate, def.block and their "anyway" overrides) are gone, so a
   conflict can only be a note: pinned as no lock device at all, and the notes above saying the database's words */
A("a conflict is a note, never a lock (no gate, block or override in the forms)", !/\b(gate|block): function/.test(flows) && !/S2\.override|ctx\.anyway/.test(flows) && /notes: function \(d, ctx\)/.test(flows));

console.log("## the trade deadline (ruling 2026-11-23)");
A("the database's trade_requests_closed refusal closes the door for the visit", /e && e\.hint === "trade_requests_closed"\) tradeClosedSaid = true/.test(flows));
A("the door goes once the movement deadline passes", /c\[0\] !== "trade_request" \|\| !tradeRequestsClosed\(\)/.test(flows));
/* QA round 2 (A5): a trade request is a rostered player's (Rule 2.3), so the door is offered only to a member on a club */
A("the door is offered only to a member on a club this season (S2.session.teamId), as the filing requires", /c\[0\] !== "trade_request" \|\| !!\(S2\.session && S2\.session\.teamId\)/.test(flows) && /if \(!S2\.session\.teamId\) return Promise\.reject/.test(flows));

console.log("## the survey is the live site's survey");
const liveKey = (/SV\.KEY = "([^"]+)"/.exec(liveSv) || [])[1];
A("the same key as the live site", !!liveKey && survey.indexOf('var KEY = "' + liveKey + '"') >= 0, liveKey);
A("saved through submit_season_survey with the live sources", /S2\.write\("submit_season_survey", \{ p_survey: KEY, p_answers: payload\(a\), p_source: o\.from === "signup" \? "signup" : "daily" \}\)/.test(survey));
A("finished is asked of season_survey_done, failing closed", /sb\.rpc\("season_survey_done", \{ p_survey: KEY \}\)/.test(survey) && /so it stays shut/.test(survey));
const keysOf = (name) => ((new RegExp(name + " constant [^:]*:= ([^;]+);").exec(svSql) || [])[1] || "");
const dbKeys = (keysOf("c_text") + keysOf("c_one") + keysOf("c_list") + keysOf("c_flag")).match(/[A-Za-z]+(?=["'])/g) || [];
const sent = ["worked", "fix", "positions", "nights", "perWeek", "wish"].concat(["xfGold", "xfBlue", "xfRed"]);
A("submit_season_survey's keys were read", dbKeys.length >= 12, dbKeys);
A("every key the survey sends is one the database takes", sent.every((k) => dbKeys.indexOf(k) >= 0) && /out\[LIVE_TIER\[t\] \+ "None"\] = true/.test(survey) && dbKeys.indexOf("xfGoldNone") >= 0, sent.filter((k) => dbKeys.indexOf(k) < 0));
A("and each is in the payload", sent.every((k) => k.indexOf("xf") === 0 ? survey.indexOf('"' + k + '"') >= 0 : new RegExp("out\\." + k + " = ").test(survey)));
const liveLocks = (/id: "positions"[\s\S]*?options: \[\["([^"]+)"[\s\S]*?\["([^"]+)"[\s\S]*?\["([^"]+)"/.exec(liveSv) || []).slice(1);
A("position locks are sent in the live site's words", liveLocks.length === 3 && liveLocks.every((w) => survey.indexOf('"' + w + '"') >= 0), liveLocks);
A("nights a week too (4 or more)", /\["4\+", "4 or more"\]/.test(survey) && /options: \["1", "2", "3", "4 or more"\]/.test(liveSv));

console.log("## no waitlist, no dashes");
A("the waitlist is gone from the forms and the survey (removed 2026-11-04)", !/waitlist/i.test(flows) && !/waitlist/i.test(survey));
for (const f of ["src/s2/js/flows.js", "src/s2/js/survey.js", "src/s2/css/flows.css", "src/s2/css/survey.css", "tools/ui/flows.test.cjs"]) A(f + ": no em dash", R(f).indexOf("—") < 0);

console.log("\n" + (n - fail) + "/" + n + " passed");
process.exit(fail ? 1 : 0);
