/* v4.21 (2026-10-19). Commissioner: "add a withdraw application button" (after asking "can applicants withdraw their
   application?"; they could not: guard_app_decision quietly put a direct status write back). An owner applicant
   withdraws a pending or waitlisted application through one door, withdraw_owner_application, before or after the
   close; the deadline guard's 'withdrawn' carve-out (an edit hole after the close) is gone; a withdrawn application is
   not decided; the office screens name a withdrawal. Run: node tools/owner-app-withdraw-v421.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sql = R("sql/2026-10-19-owner-app-withdraw-v421.sql"), body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const fn = (name) => { const i = body.indexOf("create or replace function public." + name); return i < 0 ? "" : body.slice(i, body.indexOf("end $f$;", i)); };

console.log("\n1. The withdraw door");
const w = fn("withdraw_owner_application");
A("a SECURITY DEFINER function with an empty search_path", /returns jsonb\s+language plpgsql security definer set search_path to '' as \$f\$/.test(w));
A("signed-in only, and only the applicant", /if v_uid is null then raise exception 'WITHDRAW: Sign in first\.'/.test(w) &&
  /if v_app\.profile_id <> v_uid then\s+raise exception 'WITHDRAW: Only the applicant may withdraw their owner application\.'/.test(w));
A("only a pending or waitlisted application; an approved one goes through the office", /if v_app\.status = 'approved' then\s+raise exception 'WITHDRAW: An approved application is not withdrawn\. To give up the club, message the league office/.test(w) &&
  /if v_app\.status not in \('pending', 'waitlisted'\) then/.test(w) && /where id = p_app and profile_id = v_uid and status in \('pending', 'waitlisted'\);/.test(w));
A("the status moves under app.app_decide, which is cleared again, and only status and updated_at change", /perform set_config\('app\.app_decide', 'on', true\);/.test(w) &&
  /update public\.owner_applications set status = 'withdrawn', updated_at = now\(\)\s+where/.test(w) && /perform set_config\('app\.app_decide', '', true\);/.test(w));
A("fail loud: a write that did not land raises", /get diagnostics v_n = row_count;/.test(w) && /if v_n <> 1 then raise exception 'WITHDRAW: /.test(w));
A("an audit row and a site bell to the Applications desk, no Discord post", /public\.log_admin_action\('owner_app_withdrawn', 'owner_application'/.test(w) &&
  /public\.notify_department\('applications', 'app', 'Owner application withdrawn',/.test(w) && !/discord_http_post|notify_discord|_announce_once|club_notify\(/.test(body));
A("the result names whether the withdrawal was after the close", /'final', v_final/.test(w) && /v_final := v_season\.owner_app_deadline is not null and now\(\) >= v_season\.owner_app_deadline;/.test(w));
A("members may call it, nobody else", /revoke all on function public\.withdraw_owner_application\(uuid\) from public, anon, authenticated;\s+grant execute on function public\.withdraw_owner_application\(uuid\) to authenticated;/.test(body));
A("the grant audit knows the client calls it", /'withdraw_owner_application','statistical_title_board'\]\) c\(name\)/.test(R("tools/sql/grant-audit.sql")));

console.log("\n2. The holes closed with it");
const g = fn("guard_owner_app_deadline");
A("the deadline guard has no 'withdrawn' carve-out any more", g.length > 0 && !/new\.status\s*=\s*'withdrawn'/.test(g) && /'Owner applications closed on %\. The window to apply/.test(g) && !/[—–]/.test(g));
A("...it still lets the office through and nobody may call it", /if public\.is_commissioner\(\)\s+or coalesce\(current_setting\('app\.app_decide', true\), ''\) = 'on'/.test(g) &&
  /revoke all on function public\.guard_owner_app_deadline\(\) from public, anon, authenticated;/.test(body));
A("a commissioner cannot decide a withdrawn application (anchored patch, exactly once)", /if v_app\.status = 'withdrawn' then raise exception 'The applicant withdrew this application, so there is nothing to decide\.'/.test(body) &&
  /anchor matched % times/.test(body));
A("self-checks raise when the result is wrong", /self-check: the deadline guard still lets a withdrawal through/.test(body) && /self-check: anon may withdraw/.test(body) && /self-check: decide_owner_application still decides/.test(body));
A("the rehearsal re-read every write, the hole before and after included", /BEFORE the fix, after the close, \{status:'withdrawn', pitch\} as the applicant: still pending, but the pitch\s+--\s+changed and the edit was stamped/.test(sql) &&
  /5  AFTER the fix, after the close, \{status:'withdrawn', pitch\}: refused 42501/.test(sql) && /7  withdraw after the close: accepted, final = true/.test(sql) &&
  /13 a third applicant withdraws their sign-up/.test(sql));
A("...and the v4.20 record's 'withdrawing ... accepted' is corrected here, not rewritten there", /meant only that no error was raised/.test(sql) &&
  /the applicant withdrawing after the edit: accepted/.test(R("sql/2026-10-18-owner-app-one-edit-v420.sql")));

console.log("\n3. The site");
const live = R("src/live/part_live.js"), desk = R("src/live/part9_staffdesks.js");
const route = live.slice(live.indexOf("CG.ROUTES.owner = function(){"), live.indexOf("CG.submitOwnerApp = async function"));
A("a Withdraw button for a pending or waitlisted application, whatever the close says", /var ownWithdrawable = !!\(CG\.auth\.ownerApp && a\.id && \(a\.status === "pending" \|\| a\.status === "waitlisted"\)\);/.test(route) &&
  /\(ownWithdrawable \? '<button class="btn btn-ghost btn-sm" id="ow-withdraw" style="color:var\(--red-ink\);margin-left:8px">Withdraw application<\/button>' : ''\)/.test(route));
A("the closed note's promise is true now, with no dash", /You can still withdraw it below, but a withdrawn application cannot be filed again this season\./.test(route) && !/you can still withdraw it below\./.test(live) && !/stays with the commissioners for review/.test(live));
A("a withdrawn application says so and whether it can be filed again", /var withdrawnNote = deadlineClosed \? 'You withdrew it, and applications have closed, so it cannot be filed again this season\.'/.test(route) &&
  /: a\.status === "withdrawn" \? withdrawnNote : editNote\)/.test(route) && /\(refileOnly \|\| a\.status === "withdrawn"\) \? "Resubmit application"/.test(route));
A("the RPC is the only write, and success is its confirmed status", /CG\.sb\.rpc\("withdraw_owner_application", \{ p_app: a\.id \}\)/.test(live) &&
  /if \(r\.error \|\| !r\.data \|\| !r\.data\.ok \|\| r\.data\.status !== "withdrawn"\)\{/.test(live) && !/from\("owner_applications"\)\.update\(/.test(live));
A("it asks first, and says when the withdrawal is final", /CG\.confirm\("Withdraw your owner application\?",/.test(live) && /Applications have closed, so a withdrawn application cannot be filed again this season\./.test(live));
const wd = live.slice(live.indexOf("CG.withdrawOwnerApp = function(){"), live.indexOf("CG.submitOwnerApp = async function"));
A("seamless: the status card and the form repaint in place, never the whole page", /CG\.repaintOwnerParts\(\);/.test(wd) && !/CG\.router\(\)/.test(wd) &&
  /<div id="ow-status">'\+statusCard\+'<\/div>'\+chat\+'<div id="ow-form">'\+body\+'<\/div>/.test(route) && /\["ow-status","ow-form"\]\.forEach/.test(live));
A("...and the chat keeps its wiring (it is not wired again on a repaint)", /CG\.wireOwnerForm = function\(\)\{/.test(live) && !/CG\.wireOwnerForm = function\(\)\{[^}]*wireAppChat/.test(live));
A("withdrawing a sign-up marks the pending application withdrawn, as the database did", /if \(CG\.auth\.ownerApp && CG\.auth\.ownerApp\.status === "pending" && CG\.auth\.ownerApp\.season_id === sReg\.id\) CG\.auth\.ownerApp\.status = "withdrawn";/.test(live));
A("the dead writer that reported success while the guard put the status back is gone", !/CG\.setOwnerAppStatus/.test(live));
A("the office: a withdrawal is not a decision", /"Withdrawn by the applicant, so it was not decided\. The votes cast before the withdrawal stay on the record\."/.test(live) &&
  /a\.status==="withdrawn"\?"":"chip-loss"/.test(live));
A("the review board names WITHDRAWN and WAITLISTED, and counts neither as decided-by-withdrawal", /a\.status==="withdrawn" \? \["","WITHDRAWN"\]/.test(desk) && /\["chip-warn","WAITLISTED"\]/.test(desk) &&
  /a\.status!=="pending" && a\.status!=="withdrawn"/.test(desk) && !/\(ok\?"APPROVED":"DENIED"\)/.test(desk));
A("the hub chip links back to the page, with no dash", /'" href="#\/owner" style="cursor:pointer">Own a club: '\+esc\(oa\.status\)\+'<\/a>'/.test(live) && !/Own a club — /.test(live));

console.log("\n4. Rule 2.6 and the changelog");
global.window = global; global.CG = {}; eval(R("src/live/part3_content.js"));
const rb = CG.CONTENT.rulebook, sec = [].concat(...rb.chapters.map((c) => c.sections || [])).find((x) => x.id === "2.6") || {}, p3 = (sec.paragraphs || [])[3] || "";
A("Rule 2.6 [4]: withdraw at any time; filed again only while open; an approved one is given up through the office",
  /An applicant may withdraw a pending or waitlisted owner application at any time, including after applications close; a withdrawn application may be filed again only while applications are open, and an approved application is not withdrawn but given up through the league office\./.test(p3) &&
  /withdrawing it is not an edit, and after the one edit only the league office may change it\. An applicant may withdraw/.test(p3));
const e = rb.changelog.find((c) => c.version === "4.21") || {};
A("the changelog has its 4.21 entry, right before 4.20", e.version === "4.21" && (rb.changelog[rb.changelog.indexOf(e) + 1] || {}).version === "4.20");
A("...with no em dash or gendered pronoun", !/[—–]/.test(JSON.stringify(e)) && !/\b(he|his|him|she|her)\b/i.test(JSON.stringify(e)) && (e.items || []).some((i) => /Withdraw application button/.test(i)));

console.log("\n5. v4.21b: the review's confirmed findings");
const sqlb = R("sql/2026-10-19-application-guards-v421b.sql"), bodyb = sqlb.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
A("a new owner or staff application is born pending and undecided, or refused out loud", /create or replace function public\.guard_app_insert\(\) returns trigger\s+language plpgsql security definer set search_path to ''/.test(bodyb) &&
  /if coalesce\(v->>'status', 'pending'\) <> 'pending'/.test(bodyb) && /v->>'awarded_club' is not null/.test(bodyb) && /raise exception 'APPLICATION: A new application is filed as pending\./.test(bodyb) &&
  /create trigger guard_owner_app_insert before insert on public\.owner_applications/.test(bodyb) && /create trigger guard_staff_app_insert before insert on public\.staff_applications/.test(bodyb) &&
  /revoke all on function public\.guard_app_insert\(\) from public, anon, authenticated;/.test(bodyb));
A("a commissioner's decision takes the row lock, so a concurrent withdrawal is refused, never approved", /select \* into v_app from public\.owner_applications where id = p_id for update;\$n\$/.test(bodyb));
A("the vote override refuses an owner or staff application that is not pending, out loud", /raise exception 'This application is %, so it cannot be decided here\.', v_st;/.test(bodyb) && /if p_type in \('owner', 'staff'\) then/.test(bodyb));
A("the sign-up withdrawal notice says when the application cannot be filed again, and names no missing control", /'Applications have closed, so it cannot be filed again this season\.'/.test(bodyb) &&
  /'\. It is still pending: ask the member to withdraw it from their owner application page\.'/.test(bodyb));
A("every patch is anchored and matches exactly once", /anchor in % matched % times/.test(bodyb) && /for i in 1 \.\. array_length\(v_fn, 1\) loop/.test(bodyb));
A("the rehearsal shows each hole before and closed after", /BEFORE: a member inserts their own owner application as APPROVED with a club: accepted/.test(sqlb) &&
  /1 the owner insert as approved: refused 42501/.test(sqlb) && /3 the site's own owner upsert \(pending\): accepted, pending/.test(sqlb) && /6 the override on a withdrawn application: refused/.test(sqlb));
A("the sign-up note no longer says the sign-up withdrawal caused it", !/your application was withdrawn when your sign-up was/.test(live) && /', and your owner application is withdrawn'/.test(live));
A("withdrawing keeps typed-but-unsaved answers in the form", /typed\[el\.id\] = el\.value;/.test(live) && /Object\.keys\(typed\)\.forEach/.test(live));
A("withdrawing a sign-up warns that a pending owner application goes with it", /Your pending owner application is withdrawn with it/.test(live) && /your spot in line is simply gone, not banked\."\+/.test(live) && !/registration is open — your spot/.test(live));

console.log("\n" + (n - fail) + "/" + n + " passed");
process.exit(fail ? 1 : 0);
