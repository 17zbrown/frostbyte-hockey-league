/* v4.22 (2026-10-19). Commissioner: "add a withdraw button for staff applications. Waitlist applications should not
   fill automatically", and, asked whether earlier votes still count on a refiled application, "Fresh vote".
   A staff applicant withdraws through one door (withdraw_staff_application); filed_at marks when an application was
   last put before the reviewers and only ballots since then count; an applicant's own write never takes an
   application off the waitlist; waitlist_application runs under the decision flag; decide_staff_application is gone.
   Run: node tools/staff-app-withdraw-v422.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-10-19-staff-withdraw-and-waitlist-v422.sql"), body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const fn = (name) => { const i = body.indexOf("create or replace function public." + name); return i < 0 ? "" : body.slice(i, body.indexOf("end $f$;", i)); };

console.log("\n1. Fresh vote: filed_at, and only ballots since it count");
A("both tables get filed_at, backfilled from created_at under the decision flag", /alter table public\.owner_applications add column if not exists filed_at timestamptz;/.test(body) &&
  /alter table public\.staff_applications add column if not exists filed_at timestamptz;/.test(body) &&
  /perform set_config\('app\.app_decide', 'on', true\);\s+update public\.owner_applications set filed_at = created_at where filed_at is null;/.test(body));
const st = fn("stamp_app_filed_at");
A("the stamp: insert, or a move back to pending; every other write keeps it", /if tg_op = 'INSERT' then\s+new\.filed_at := now\(\);/.test(st) &&
  /elsif new\.status = 'pending' and old\.status is distinct from 'pending' then\s+new\.filed_at := now\(\);/.test(st) && /new\.filed_at := old\.filed_at;/.test(st));
A("...fires after every guard (zz_), on both tables, and nobody may call it", /create trigger zz_stamp_owner_app_filed_at before insert or update on public\.owner_applications/.test(body) &&
  /create trigger zz_stamp_staff_app_filed_at before insert or update on public\.staff_applications/.test(body) && /revoke all on function public\.stamp_app_filed_at\(\) from public, anon, authenticated;/.test(body));
A("resolve_application_if_ready counts only ballots since filed_at (management unchanged)", /select status, filed_at into v_status, v_filed from public\.owner_applications where id = p_id;/.test(body) &&
  /select status, filed_at into v_status, v_filed from public\.staff_applications where id = p_id;/.test(body) && /and \(v_filed is null or b\.updated_at >= v_filed\);/.test(body));

console.log("\n2. The waitlist never fills automatically");
A("an applicant's own write never takes an application off the waitlist", /if old\.status = 'waitlisted' then new\.status := old\.status;\s+elsif new\.status is distinct from old\.status and new\.status <> 'pending' then new\.status := old\.status; end if;/.test(body));
A("...and cannot move their queue position", /new\.waitlisted_at := old\.waitlisted_at;/.test(body));
A("the award branch runs on owner rows only and treats an unset flag as off", /if tg_table_name = 'owner_applications' and coalesce\(current_setting\('app\.app_award', true\), ''\) <> 'on' then/.test(body));
A("waitlisting runs under the decision flag (a reviewer's waitlist used to be put back)", /perform set_config\('app\.app_decide', 'on', true\);\$n\$/.test(body) && /perform set_config\('app\.app_decide', '', true\);\$n\$\]/.test(body));
A("every patch is anchored and matches exactly once", /anchor in % matched % times/.test(body) && /for i in 1 \.\. array_length\(v_fn, 1\) loop/.test(body));

console.log("\n3. The staff withdraw door");
const w = fn("withdraw_staff_application");
A("SECURITY DEFINER, empty search_path, signed-in applicant only", /returns jsonb\s+language plpgsql security definer set search_path to '' as \$f\$/.test(w) &&
  /if v_uid is null then raise exception 'WITHDRAW: Sign in first\.'/.test(w) && /raise exception 'WITHDRAW: Only the applicant may withdraw their staff application\.'/.test(w));
A("pending or waitlisted only; approved goes through the league office", /raise exception 'WITHDRAW: An approved staff application is not withdrawn\. To leave the staff, message the league office\.'/.test(w) &&
  /if v_app\.status not in \('pending', 'waitlisted'\) then/.test(w));
A("status, waitlist place and updated_at move under the flag; fail loud on no row", /update public\.staff_applications set status = 'withdrawn', waitlisted_at = null, updated_at = now\(\)/.test(w) &&
  /get diagnostics v_n = row_count;/.test(w) && /if v_n <> 1 then raise exception 'WITHDRAW: /.test(w));
A("an audit row (with the old queue position) and a site bell; no Discord post", /log_admin_action\('staff_app_withdrawn', 'staff_application'/.test(w) && /'waitlisted_at', v_app\.waitlisted_at/.test(w) &&
  /notify_department\('applications', 'app', 'Staff application withdrawn',/.test(w) && !/discord_http_post|notify_discord|_announce_once|club_notify\(/.test(body));
A("members may call it, nobody else; the audit list knows it", /revoke all on function public\.withdraw_staff_application\(uuid\) from public, anon, authenticated;\s+grant execute on function public\.withdraw_staff_application\(uuid\) to authenticated;/.test(body) &&
  /'withdraw_staff_application','withdraw_owner_application','statistical_title_board'\]\) c\(name\)/.test(R("tools/sql/grant-audit.sql")));
A("decide_staff_application is dropped (both overloads)", /drop function if exists public\.decide_staff_application\(uuid, boolean\);/.test(body) && /drop function if exists public\.decide_staff_application\(uuid, boolean, text\);/.test(body));
A("the rehearsal shows each hole before and fixed after", /BEFORE: 1 waitlisted, the applicant saves the form \(the site's upsert\): accepted -> PENDING/.test(sql) &&
  /AFTER:  1 -> stays WAITLISTED/.test(sql) && /refiled -> after the cron: PENDING/.test(sql) && /refused 42703 'record "new" has no field\s+--\s+"awarded_club"'/.test(sql) &&
  /13 pending owner applications: 11 of 11 ballots still count/.test(sql));

console.log("\n4. The site");
const live = R("src/live/part_live.js");
const route = live.slice(live.indexOf("CG.ROUTES.staffapply = function(){"), live.indexOf("CG.AFTER.staffapply = function(){"));
A("a Withdraw button for a pending or waitlisted staff application", /var staffWithdrawable = !!\(app && app\.id && \(app\.status==="pending" \|\| app\.status==="waitlisted"\)\);/.test(route) &&
  /\(staffWithdrawable \? '<button class="btn btn-ghost btn-sm" id="sa-withdraw" style="color:var\(--red-ink\)">Withdraw application<\/button>' : ''\)/.test(route));
A("a withdrawn or denied application offers Resubmit; withdrawn reads neutral", /\(app\.status==="withdrawn"\|\|app\.status==="denied"\)\?"Resubmit application":"Update application"/.test(route) &&
  /app\.status==="waitlisted"\?"chip-chrome":app\.status==="withdrawn"\?"":app\.status==="approved"\?"chip-win":"chip-loss"/.test(route) && /You withdrew your application\.<\/b> You may file it again at any time below; the reviewers then vote on it afresh\./.test(route));
A("the status note and form repaint in place; the chat is not wired twice", /<div id="sa-status">'\+staffNote\+statusNote\+'<\/div>'\+chat\+/.test(route) && /'<div id="sa-form"><div class="card">/.test(route) &&
  /\["sa-status","sa-form"\]\.forEach/.test(live) && /CG\.wireStaffForm = function\(\)\{/.test(live) && !/CG\.wireStaffForm = function\(\)\{[^}]*wireAppChat/.test(live));
const wd = live.slice(live.indexOf("CG.withdrawStaffApp = function(){"), live.indexOf("/* ================================================================\n   PARITY: DRAFT ROOM"));
A("the RPC is the only write, success is its confirmed status, and no page reset", /CG\.sb\.rpc\("withdraw_staff_application", \{ p_app: a\.id \}\)/.test(wd) &&
  /if \(r\.error \|\| !r\.data \|\| !r\.data\.ok \|\| r\.data\.status !== "withdrawn"\)\{/.test(wd) && /CG\.repaintStaffParts\(\);/.test(wd) && !/CG\.router\(\)/.test(wd) &&
  !/from\("staff_applications"\)\.update\(/.test(live));
A("typed answers and department picks survive the repaint (one toggle look)", /typed\[el\.id\] = el\.value;/.test(live) && /CG\.setStaffDept\(b, picked\.indexOf/.test(live) && /var set = CG\.setStaffDept;/.test(live));
A("saving a waitlisted application says it stays on the waitlist", /"Application updated\. You are still on the waitlist\."/.test(live) && /"Application filed again\. The reviewers will vote on it afresh\."/.test(live));
A("the dead staff decision client and its role-sync entry are gone", !/CG\.decideStaffApp = function/.test(live) && !/rpc\("decide_staff_application"/.test(live) && !/override_application_decision decide_staff_application/.test(live));
A("the office vote counts only ballots since filed_at, as the database does", /var f = a && a\.filed_at \? Date\.parse\(a\.filed_at\) : 0;\s+return CG\.appBallotsFor\(type, a\.id\)\.filter\(function\(v\)\{ return !f \|\| Date\.parse\(v\.updated_at\) >= f; \}\);/.test(live) && /earlier vote'\+\(earlier===1\?"":"s"\)\+', cast before it was last filed/.test(live));
A("a waitlisted application shows no vote or override buttons, and says why", /if \(!decided && !waitlisted && isReviewer\)\{/.test(live) && /if \(!decided && !waitlisted && isCommish\)\{/.test(live) &&
  /"On the waitlist, so the reviewers’ votes do not decide it\. Nobody is admitted automatically:/.test(live) && /a\.status==="waitlisted" \? '<span class="chip chip-chrome">Waitlisted<\/span>'/.test(live));
A("the hub chip links to the page, with no dash", /'" href="#\/staffapply" style="cursor:pointer">Join the staff: '\+esc\(sa\.status\)\+'<\/a>'/.test(live) && !/Join the staff — /.test(live));

console.log("\n5. Rule 2.6 and the changelog");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === "2.6") || {}, p3 = (sec.paragraphs || [])[3] || "";
A("Rule 2.6 [4]: staff withdraw at any time, refile at any time, an approved one through the office",
  /An applicant may withdraw a pending or waitlisted staff application at any time and may file a staff application again at any time; an approved staff application is not withdrawn, and a staff member who wishes to leave the staff asks the league office\./.test(p3));
A("...a refiled application is voted afresh", /An application filed again after it was withdrawn or denied goes before the reviewers afresh: votes cast before it was filed again are kept on the record but do not count\./.test(p3));
A("...and it follows the owner withdraw sentence", /given up through the league office\. An applicant may withdraw a pending or waitlisted staff application/.test(p3));
A("the rendered Rule 2.6 has no automatic fill", !/fills it automatically|automatic appointment/.test(JSON.stringify(sec)));
const e = rb.changelog.find((c) => c.version === "4.22") || {};
A("the changelog has its 4.22 entry, right before 4.21", e.version === "4.22" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.21");
A("...with no em dash or gendered pronoun", !/[—–]/.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)) && (e.items || []).some((i) => /Withdraw application button/.test(i)));

console.log("\n6. v4.22b: the review's confirmed findings");
const sqlb = R("sql/2026-10-19-fresh-vote-fixes-v422b.sql"), bodyb = sqlb.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
A("the server's clock stamps every ballot (the device clock never decides whether a vote counts)", /create trigger aa_stamp_ballot_time before insert or update on public\.application_ballots/.test(bodyb) &&
  /if tg_op = 'INSERT' then new\.created_at := now\(\); end if;\s+new\.updated_at := now\(\);/.test(bodyb) &&
  !/vote:v, note:\(note\|\|null\), updated_at:new Date\(\)\.toISOString\(\)/.test(live));
A("a refile rings the Applications desk (site bell only)", /if new\.status = 'pending' and old\.status in \('withdrawn', 'denied', 'approved'\) then/.test(bodyb) &&
  /create trigger on_owner_app_refiled after update of status on public\.owner_applications/.test(bodyb) && /create trigger on_staff_app_refiled after update of status on public\.staff_applications/.test(bodyb) &&
  !/discord_http_post|notify_discord|_announce_once|club_notify\(/.test(bodyb));
A("returning to pending gives up any old waitlist place", /new\.filed_at := now\(\);\s+new\.waitlisted_at := null;/.test(bodyb));
A("a reviewer waitlists only another member's pending application", /'Only a commissioner can waitlist this application \(it is your own, or it is no longer before the vote\)\.'/.test(bodyb) &&
  /o\.profile_id = auth\.uid\(\) or o\.status <> 'pending'/.test(bodyb) && /s\.profile_id = auth\.uid\(\) or s\.status <> 'pending'/.test(bodyb));
A("the rehearsal shows each fix", /1 a reviewer upserts a ballot sending created_at 2000 and updated_at 2099 -> stored created=now, updated=now/.test(sqlb) &&
  /pending, waitlisted_at cleared, 7 bells/.test(sqlb) && /5 the same reviewer waitlists their own staff application -> refused 42501/.test(sqlb));
A("one counting-ballots helper, read by the detail page, the Review Board and the Control Center", /CG\.appCountingBallots = function\(type, a\)\{/.test(live) &&
  /var counting = CG\.appCountingBallots\(type, a\)/.test(live) && /var vb = CG\.appCountingBallots\(type, a\)/.test(live) &&
  /function ballots\(type, a\)\{ return CG\.appCountingBallots\(type, a\) \|\| \[\]; \}/.test(R("src/live/part9_staffdesks.js")));
const sched = R("jobs/discord-scheduler.js");
A("the daily casework nudge counts only fresh votes too", /select=id,profile_id,season_id,filed_at/.test(sched) && /staff_applications\?status=eq\.pending&select=id,profile_id,filed_at/.test(sched) &&
  /application_ballots\?select=app_type,application_id,voter_id,updated_at/.test(sched) && /if \(filedAt\[key\] && Date\.parse\(b\.updated_at\) < filedAt\[key\]\) continue;/.test(sched));
A("an approved staff application reads green and offers Apply again; saving an existing one repaints in place", /app\.status==="approved"\?"chip-win":"chip-loss"/.test(live) &&
  /app\.status==="approved"\?"Apply again"/.test(live) && /if \(prevSt\) CG\.repaintStaffParts\(\); else CG\.router\(\);/.test(live));
A("a waitlisted application with no reviewers promises no override", /\} else if \(!decided && !waitlisted\)\{/.test(live));
A("Rule 2.6 says what owner admission does, and its full text matches the basic text (nothing shelved)", /an owner applicant who cannot then be seated under Rule 2\.7 is not seated as Owner until it is\./.test(p3) &&
  (sec.full || [])[3] === p3);

console.log("\n" + (n - fail) + "/" + n + " passed");
process.exit(fail ? 1 : 0);
