/* v4.20 (2026-10-18). Commissioner: "Can you also allow applicants to edit their application one time?" An owner
   applicant could resubmit as often as they liked; now the first change to what they wrote is their one edit
   (owner_applications.edited_at, stamped by guard_owner_app_one_edit) and a second is refused. Withdrawing, an
   unchanged resubmit and every office write are not edits. Run: node tools/owner-app-one-edit-v420.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-10-18-owner-app-one-edit-v420.sql"), body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

console.log("\n1. The database counts the edit");
A("edited_at is added, and only the trigger moves it", /alter table public\.owner_applications add column if not exists edited_at timestamptz;/.test(body) && /new\.edited_at := old\.edited_at;\s+-- only this trigger moves it/.test(body));
A("a new application starts with its edit unused", /if tg_op = 'INSERT' then\s+new\.edited_at := null;/.test(body));
A("the office's writes never count (commissioner, decisions, awards)", /if public\.is_commissioner\(\)\s+or coalesce\(current_setting\('app\.app_decide', true\), ''\) = 'on'\s+or coalesce\(current_setting\('app\.app_award', true\), ''\) = 'on' then\s+return new;/.test(body));
for (const c of ["ea_id", "timezone", "availability", "experience", "preferred_club", "franchise_2", "franchise_3", "pitch", "proposed_location", "proposed_name", "team_choice"])
  A("an edit is a change to " + c, new RegExp("new\\." + c + " is not distinct from old\\." + c).test(body));
A("status alone (a withdrawal) is not an edit", !/new\.status is not distinct from old\.status/.test(body));
A("the second change is refused with the date of the first", /if old\.edited_at is not null then\s+raise exception 'ONE_EDIT: You already used your one edit to this application, on %\./.test(body) && /using errcode = 'check_violation';/.test(body));
A("the trigger fires on insert and update, and nobody can call it", /create trigger guard_owner_app_one_edit_trg before insert or update on public\.owner_applications/.test(body) && /revoke all on function public\.guard_owner_app_one_edit\(\) from public, anon, authenticated;/.test(body));
A("self-check: an applicant cannot reset their own edit", /has_column_privilege\('authenticated', 'public\.owner_applications', 'edited_at', 'UPDATE'\)/.test(body));
A("the rolled-back rehearsal is recorded, the site's upsert path included", /second change through the site's own upsert \(insert \.\.\. on conflict do update\): refused/.test(sql) && /a commissioner's correction: accepted; the applicant withdrawing after the edit: accepted/.test(sql));
A("nothing posts to Discord", !/discord_http_post|notify_discord|_announce_once|club_notify\(/.test(body));

console.log("\n2. The site");
const live = R("src/live/part_live.js");
A("the status card says whether the edit is still there", /You used your one edit on '\+esc\(CG\.fmtFull\(Date\.parse\(a\.edited_at\)\)\)\+'\. To change anything else, message the league office below\./.test(live) && /You may edit it once before applications close\./.test(live) && !/Resubmit below to update it\./.test(live));
A("the form locks once it is used (a withdrawn one may be refiled unchanged)", /var editUsed = !!\(CG\.auth\.ownerApp && a\.edited_at\), refileOnly = editUsed && a\.status === "withdrawn";/.test(live) && /:\(editUsed&&!refileOnly\)\?" disabled":""\)/.test(live) && /lk\.querySelectorAll\("input,select,textarea"\)\.forEach\(function\(el\)\{ el\.disabled = true; \}\);/.test(live));
A("the submit asks before spending the edit, and reports the refusal plainly", /CG\.confirm\("Use your one edit\?"/.test(live) && /\/ONE_EDIT:\/\.test\(em\) \? em\.replace\(\/\^\.\*ONE_EDIT:\\s\*\/,""\)/.test(live) && /"Application updated\. That was your one edit\."/.test(live));
A("the office sees when the edit was used", /fields \+= row\("Edited", a\.edited_at \?/.test(live));

console.log("\n3. Rule 2.6 and the changelog");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, p3 = (([].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === "2.6") || {}).paragraphs || [])[3] || "";
A("Rule 2.6 [4]: one edit while applications are open; a withdrawal is not an edit", /An applicant may edit a submitted owner application once while applications are open; withdrawing it is not an edit, and after the one edit only the league office may change it\./.test(p3) && /^An owner application is made for one season, and only a member signed up to play in that season may make one;/.test(p3) && /the award admits it as a new club/.test(p3));
const e = rb.changelog.find((c) => c.version === "4.20") || {};
A("the changelog has its 4.20 entry, right before 4.19", e.version === "4.20" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.19");
A("...with no em dash or gendered pronoun", !/[—–]/.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)) && (e.items || []).some((i) => /may change it once while applications are open/.test(i)));

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
