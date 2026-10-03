/* v3.85: a suspension for the rest of a season or longer, or a ban, removes the member from his club and withdraws his
   sign-ups. Commissioner, 2026-10-02: "If a player is suspended for the season, or more, or banned, their signup should
   be removed and they should be removed from their roster." Pins the record (rehearsed in Postgres), the forms, the book. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + String(got).slice(0, 220))); } };
const sql = R("sql/2026-10-02-discipline-removes-v385.sql"), live = R("src/live/part_live.js");
A("one door, never the API's", /create or replace function public\._remove_for_discipline\(p_profile uuid, p_reason text\)/.test(sql) && /revoke all on function public\._remove_for_discipline\(uuid, text\) from public, anon, authenticated;/.test(sql));
A("seats first, then every spot of a season not completed, through the office's release flags", sql.indexOf("update public.teams set owner_profile_id = null") < sql.indexOf("delete from public.roster_spots where id = r.id") && /set_config\('app\.office_removal', '1', true\)/.test(sql) && /s\.status::text <> 'completed'/.test(sql));
A("the club may replace him; the contract ends; sign-ups archived before they go", /_grant_replacement\(r\.season_id, r\.team_id, p_profile, p_reason\)/.test(sql) && /set status = 'expired', team_id = null/.test(sql) && sql.indexOf("insert into public.season_registration_removals") < sql.indexOf("delete from public.season_registrations where id = r.id"));
A("only a running rest-of-season suspension that takes his play", /new\.mode = 'seasons' and coalesce\(new\.scope, 'play'\) in \('play', 'both'\) and new\.status = 'active'/.test(sql));
A("a ban calls the same door, and a banned member cannot sign up", /perform public\._remove_for_discipline\(p_profile, 'banned'\);/.test(sql) && /A member banned from the league cannot register \(Rule 7\.2\)/.test(sql));
A("applied to the members already covered", /the members it already covers/.test(sql));
A("rehearsed and applied", /REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7/.test(sql) && /APPLIED 2026-10-02 as migration v385_discipline_removes/.test(sql));
A("the discipline form says it before a season-long suspension", /A suspension through a season also takes him off his club\\u2019s roster/.test(live));
A("the ban form says it", /take him off his club\\u2019s roster and out of any front-office seat, and withdraw his sign-ups \(Rule 7\.2\)/.test(live));
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, s72 = rb.chapters.flatMap((c) => c.sections || []).find((x) => x.id === "7.2");
A("Rule 7.2 states it", /A member suspended for the remainder of a season or longer, or expelled, is not held in place but removed/.test(s72.paragraphs[1]));
A("changelog 3.85", !!rb.changelog.find((c) => c.version === "3.85"));
console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
