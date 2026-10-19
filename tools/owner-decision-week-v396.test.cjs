/* v3.96 (2026-10-13): the owner decision week. Commissioner: "Staff will reapprove everyone by the deadline for
   assigning owners." and "If we add expansion clubs, we will do that manually as needed."
   Rehearsed on production rolled back: a pick that is not a CGHL club was refused; approving a member for Boston handed
   it over (the Season 1 Owner lost the seat and kept his roster spot); a second approval for Boston was refused as
   already awarded; Dallas's sitting Owner, re-approved, kept Dallas; the deadline watch sent its alert. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const sql = R("sql/2026-10-13-owner-decision-week-v396.sql"), live = R("src/live/part_live.js");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 240))); } };

console.log("— the database");
A("picks must be current clubs, refused where entered", /is not a CGHL club\. Choose from the league''s clubs: %\. New clubs are added by the league office\./.test(sql) && /create trigger guard_owner_app_picks_trg before insert or update on public\.owner_applications/.test(sql));
A("an application never founds a club", /-- v3\.96: an application never founds a club; the league office adds new clubs itself/.test(sql) && !/insert into public\.teams/.test(sql));
A("Season 2 owners all reapply, and an approval hands the club over through the seat door", /\('owners_reapply_2', 'on'\)/.test(sql) && /perform public\._set_team_seat\(t\.id, 'owner', v_prof\.id, 'office'\);/.test(sql));
A("a club is awarded to one applicant a season; a sitting Owner re-approved keeps it", /'Club already awarded this season'/.test(sql) && /return t\.code;                                   -- confirmed in the seat he already holds/.test(sql));
A("votes resolve once applications close (cron every 15 minutes)", /cron\.schedule\('owner-app-resolve', '\*\/15 \* \* \* \*', 'select public\.resolve_all_pending_applications\(\)'\)/.test(sql));
A("the decision deadline is watched two days out and at it, nothing vacated automatically", /when now\(\) >= v_by - interval '2 days' then 'two_days'/.test(sql) && /cron\.schedule\('owner-decision-watch'/.test(sql) && !/owner_profile_id = null/.test(sql.slice(sql.indexOf("owner_decision_watch()"))));

console.log("— the site");
/* v4.19 (commissioner, 2026-10-18): "Allow people filling out owner applications to pick from any team in the NHL."
   That reverses the v3.96 "current clubs only" form, so its pin moved to tools/owner-any-franchise-v419.test.cjs, which
   pins the opposite (all thirty-two franchises). */
A("the review board says a held club passes over in a reapply season", /Held now: passes to them if approved/.test(live) && /CG\.ownerAppClubStatus\(name, a\)/.test(live));
A("the Control Center lists the deadline watch", /key:"owner-decision-watch", noRun:true, staleAfterMin:120/.test(live));

console.log("— the rulebook and changelog");
global.CG = {}; vm.runInThisContext(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, s2 = rb.chapters.find((c) => c.num === "S2");
A("Chapter S2 marks owners reapplying, and S2.2 says how", s2.ownersReapply === true && /hands the club over: the previous Owner's seat ends, and that member keeps their roster spot/.test(s2.sections[1].paragraphs[1]) && /by Saturday, December 19/.test(s2.sections[1].paragraphs[1]));
const cl = rb.changelog.find((c) => c.version === "3.96");
A("changelog 3.96 is in the book", !!cl);
A("no em dash in what v3.96 wrote", !/—/.test(JSON.stringify(cl)) && !/—/.test(sql) && !/—/.test(JSON.stringify(s2)));

console.log(fail ? "\n" + fail + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fail ? 1 : 0);
