/* v4.59: Season 2 staffing groundwork, additive. node tools/s2-committees-v459.test.cjs
   Rulings 2026-11-23 (memory s2-staffing-model.md): six committees with one manager each; current staff apply for an open
   seat and all other staff vote, more than half of all staff with commissioners included; commissioners keep deciding
   alone; the Draft and Bidding manager (or a commissioner) pauses and resumes bidding. Pins the record (tables, RLS,
   grants, the electorate without banned or staff-suspended members, the tally, the decision, the doors, the patches and
   their byte-identity checks, can_run_market widened on the bid-night record's text and never created here) and its
   rehearsal (the record byte for byte, every case, no handler around the verdict). */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;
const count = (s, needle) => s.split(needle).length - 1;

const REC = "sql/2026-11-24-s2-committees-v459.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC);
const fn = (name) => (sql.match(new RegExp("create or replace function public\\." + name + "\\([^)]*\\)\\n([\\s\\S]*?)\\n(?:end )?\\$function\\$;")) || [])[1] || "";
const comments = (s) => (s.match(/--[^\n]*|\/\*[\s\S]*?\*\//g) || []).join("\n");

console.log("1. The rulings and the scope");
A("the header quotes the commissioner's 2026-10-19 ruling on one staff group",
  sql.indexOf('for Season 2, we will remove the different departments, and we will allow every staff\n--    member to be a part of one big group.') > 0);
A("the header carries the six committees, the vote, the commissioner's own decision and the one Draft and Bidding power",
  /SIX committees/.test(sql) && /all other staff vote/.test(sql) && /\("Decide now"\)/.test(sql)
  && /may pause and resume it \(only they and commissioners\)/.test(sql));
A("additive: the header says what does not change until the flip records", /Nothing a department, a\n-- reviewer or a staffer can do today changes/.test(sql));
A("no rulebook text, with the commissioner's reason quoted",
  /"Since it is a rule for season 2 and beyond, only\n-- add that to the rulings and the site layout for the concept site"/.test(sql));

console.log("\n2. The committees and the applications");
const ins = (sql.match(/insert into public\.committees \(key, name, sort, charter\) values\n([\s\S]*?\));\n/) || [])[1] || "";
const rows = [...ins.matchAll(/\('([a-z_]+)', '([^']+)', (\d)/g)].map((m) => m[1] + ":" + m[2] + ":" + m[3]);
A("six committees, in the ruled order, keyed on the department keys they replace (no Game Operations, no Media)",
  rows.join(",") === "officiating:Officiating:1,statistics:Statistics and imports:2,applications:Applications:3,community:Community:4,transactions:Transactions:5,draft:Draft and Bidding:6",
  rows.join(","));
A("Officiating takes the game operations work; Transactions takes position changes; Draft and Bidding names its powers",
  /'Officiating and discipline, and all game operations: lineups and late changes, game-night problems, held games, reschedules and the schedule\.'/.test(ins)
  && /position changes/.test(ins) && /Its manager may pause and resume bidding and has the draft and bidding page tools\./.test(ins));
A("committees: RLS on, every API privilege revoked, then SELECT for everyone through a true policy",
  sql.indexOf("alter table public.committees enable row level security;\nrevoke all on table public.committees from anon, authenticated;\ngrant select on table public.committees to anon, authenticated;\ncreate policy \"committees are public\" on public.committees for select using (true);") > 0);
A("committee_applications: RLS on, revoked, SELECT to the applicant, the staff and the commissioners only",
  sql.indexOf("alter table public.committee_applications enable row level security;\nrevoke all on table public.committee_applications from anon, authenticated;\ngrant select on table public.committee_applications to authenticated;") > 0
  && /using \(profile_id = \(select auth\.uid\(\)\) or public\.is_staff\(\) or public\.is_commissioner\(\)\);/.test(sql));
A("one pending application per member per seat; statuses pending, approved, denied, withdrawn, lapsed; a pitch is required",
  /create unique index committee_applications_one_pending on public\.committee_applications \(committee_key, profile_id\)\n  where status = 'pending';/.test(sql)
  && /check \(status in \('pending', 'approved', 'denied', 'withdrawn', 'lapsed'\)\)/.test(sql)
  && /pitch text not null check \(btrim\(pitch\) <> '' and length\(pitch\) <= 2000\)/.test(sql));
A("a seat survives a deleted profile as an open seat, and an application goes with its applicant",
  /manager_profile_id uuid references public\.profiles\(id\) on delete set null/.test(sql)
  && /profile_id uuid not null references public\.profiles\(id\) on delete cascade/.test(sql));

console.log("\n3. The electorate and the seat tests");
A("is_staff_voter: every commissioner, and every staff member not suspended from staff duties",
  /\(p\.role = 'commissioner' or \(p\.role = 'staff' and not public\.is_staff_suspended\(p\.id\)\)\)\);/.test(fn("is_staff_voter")));
A("staff_voter_count counts the same predicate", /where not p\.banned and \(p\.role = 'commissioner' or \(p\.role = 'staff' and not public\.is_staff_suspended\(p\.id\)\)\);/.test(fn("staff_voter_count")));
A("nobody banned is in the electorate (main session, 2026-11-24): the voter test and the count read profiles.banned",
  /where p\.id = p_uid and not p\.banned\n/.test(fn("is_staff_voter")) && /where not p\.banned and/.test(fn("staff_voter_count")));
A("is_committee_manager is the power test: the seat, held by a staffer not banned and not suspended from staff duties",
  /where c\.key = p_committee and c\.manager_profile_id = p_profile\n\s+and p\.role = 'staff' and not p\.banned and not public\.is_staff_suspended\(p\.id\)\);/.test(fn("is_committee_manager")));
A("committee_of lists the seats held, in committee order, empty when none",
  /coalesce\(array_agg\(c\.key order by c\.sort\), '\{\}'::text\[\]\) from public\.committees c where c\.manager_profile_id = p_profile;/.test(fn("committee_of")));
A("can_vote_committee_app: any staff voter except the applicant",
  /select public\.is_staff_voter\(p_uid\)\n\s+and exists \(select 1 from public\.committee_applications a where a\.id = p_app and a\.profile_id <> p_uid\);/.test(fn("can_vote_committee_app")));

console.log("\n4. The tally and the decision");
const tally = fn("_committee_app_resolve");
A("need = more than half of ALL voters, commissioners included", /v_all := public\.staff_voter_count\(\);\n  v_need := \(v_all \/ 2\) \+ 1;/.test(tally));
A("the applicant counts toward all staff but casts no counted ballot; a ballot from outside the electorate does not count",
  /v_pool := v_all - \(case when public\.is_staff_voter\(v_app\.profile_id\) then 1 else 0 end\);/.test(tally)
  && /and b\.voter_id <> v_app\.profile_id and public\.is_staff_voter\(b\.voter_id\);/.test(tally));
A("decided the moment it is certain, and never by the vote when too few could ever pass it",
  /if v_yes >= v_need then\n    perform public\._committee_app_decide\(p_id, true, null\);\n  elsif v_no > v_pool - v_need then\n    perform public\._committee_app_decide\(p_id, false, null\);/.test(tally)
  && /if v_pool < v_need then return; end if;/.test(tally));
A("the suspension and ban limit is marked as a shortcut, bounded by the 15-minute owner-app-resolve cron",
  /-- shortcut: a staff suspension or a ban that starts or ends changes the electorate without a ballot/.test(tally)
  && /owner-app-resolve cron\n\s+\(resolve_all_pending_applications every 15 minutes\)/.test(tally));
const dec = fn("_committee_app_decide");
const lockOrder = (body) => body.indexOf("from public.committees c where c.key = v_key for update") > 0
  && body.search(/from public\.committee_applications a where a\.id = p_[a-z]+ for update/) > body.indexOf("from public.committees c where c.key = v_key for update");
A("every path locks the committee row before the application row (no deadlock between a ballot and a role change)",
  lockOrder(dec) && lockOrder(tally) && lockOrder(fn("withdraw_committee_application")));
A("the vote and the decision take the applicant's profile row before the committee row (a role change or ban at the same moment)",
  [dec, tally].every((b) => b.indexOf("perform 1 from public.profiles p where p.id = v_pid for share;") > 0
    && b.indexOf("perform 1 from public.profiles p where p.id = v_pid for share;") < b.indexOf("from public.committees c where c.key = v_key for update")));
A("a null choice is refused, never read as an approval", /begin\n  if p_approve is null then raise exception 'Choose approve or deny\.'; end if;/.test(dec));
A("a banned applicant whose vote passes is not seated", /elsif exists \(select 1 from public\.profiles p where p\.id = v_app\.profile_id and p\.banned\) then\n    v_why := 'the applicant is banned';/.test(dec));
A("a decided application is refused out loud", /raise exception 'This application is %, so it cannot be decided here\.', v_app\.status;/.test(dec));
A("approval seats only a staff member on an open seat; anything else lapses with the reason and tells the office",
  /if v_c\.manager_profile_id is not null then\n    v_why := 'the seat was already filled';\n  elsif not exists \(select 1 from public\.profiles p where p\.id = v_app\.profile_id and p\.role = 'staff'\) then/.test(dec)
  && /'Committee seat not filled'/.test(dec));
A("every write in the decision checks its row count (no success without a confirmed write)", count(dec, "get diagnostics v_n = row_count;") === 4);
A("the seat's other pending applications lapse and each applicant is told",
  /where a\.committee_key = v_key and a\.status = 'pending' and a\.id <> p_id/.test(dec) && /so your application for it is closed\./.test(dec));
A("audit rows and a Discord role sync request on every seat change", /'committee_seat_filled'/.test(dec) && /public\._rsq\(v_app\.profile_id, 'committees:seat'\);/.test(dec)
  && /public\._rsq\(v_holder, 'committees:seat'\);/.test(fn("vacate_committee_seat")));

console.log("\n5. The doors");
const app = fn("apply_committee_seat");
A("apply: signed in, not a commissioner, on the staff and not suspended, an open seat, a pitch, one pending filing",
  ["'COMMITTEE: Sign in first.'", "'COMMITTEE: Commissioners already hold every committee power, so they do not apply for a seat.'",
   "if not public.is_staff() then", "'COMMITTEE: That committee was not found.'", "A seat is applied for only while it is open.'",
   "'COMMITTEE: Tell the staff why you want the seat.'", "'COMMITTEE: You already applied for this seat. Withdraw that application to file a new one.'",
   "if public.is_banned(v_uid) then", "'COMMITTEE: A banned member may not apply for a committee manager seat.'"].every((t) => app.indexOf(t) > 0));
A("apply bells every other voter (staff and commissioners) and writes an audit row",
  /perform public\.notify_staff_bell\(array\[v_uid\], 'app', 'Committee manager application',/.test(app)
  && /perform public\.notify_commissioners\(null, 'app', 'Committee manager application',/.test(app) && /'committee_app_filed'/.test(app));
A("withdraw: only the applicant, only while pending", /'WITHDRAW: Only the applicant may withdraw their committee application\.'/.test(fn("withdraw_committee_application"))
  && /'WITHDRAW: This application is %, so there is nothing to withdraw\.'/.test(fn("withdraw_committee_application")));
const vac = fn("vacate_committee_seat");
A("vacate: the manager steps down, or a commissioner opens the seat with a reason that is kept and sent",
  /if not v_self and not public\.is_commissioner\(\) then/.test(vac) && /'COMMITTEE: Give a reason\. It is kept on the record and sent to the manager\.'/.test(vac)
  && /'A commissioner opened the ' \|\| v_c\.name \|\| ' committee seat you held\. Reason: ' \|\| v_reason/.test(vac));
const trg = fn("committee_seat_role_change");
A("leaving the staff, or a ban, opens the seats and lapses the pending applications, on the record",
  /where c\.manager_profile_id = new\.id/.test(trg)
  && /response = case when v_left then 'The applicant left the league staff\.' else 'The applicant was banned\.' end,/.test(trg)
  && sql.indexOf("create trigger committee_seat_role_change after update of role, banned on public.profiles\n  for each row when (old.role = 'staff' and (new.role is distinct from 'staff' or (new.banned and not old.banned)))\n  execute function public.committee_seat_role_change();") > 0);
A("...and fires before profiles_reviewer_resolve (name order), checked against the live trigger, not two constants",
  "committee_seat_role_change" < "profiles_reviewer_resolve" && !/'committee_seat_role_change' collate "C" < 'profiles_reviewer_resolve'/.test(sql)
  && /t\.tgfoid = 'public\.trg_profiles_resolve\(\)'::regprocedure\n\s+and t\.tgname::text collate "C" <= 'committee_seat_role_change' collate "C"\) then/.test(sql));

console.log("\n6. The ballots");
const pol = "(case when app_type = 'committee' then public.can_vote_committee_app(application_id, auth.uid())\n";
A("the committee type joins the app_type check, after a pre-check that it is the constraint this record read",
  /check \(app_type = any \(array\['owner'::text, 'staff'::text, 'management'::text, 'committee'::text\]\)\);/.test(sql)
  && sql.indexOf("CHECK ((app_type = ANY (ARRAY['owner'::text, 'staff'::text, 'management'::text])))") > 0);
A("all three write policies keep is_app_reviewer for every other type and admit a committee ballot from its voters",
  count(sql, pol) === 3 && count(sql, "else public.is_app_reviewer(auth.uid()) end));\n") === 3
  && /alter policy "reviewer casts own app ballot"/.test(sql) && /alter policy "reviewer retracts own app ballot"/.test(sql) && /alter policy "reviewer updates own app ballot"/.test(sql));
A("the CASE in each policy is parenthesized (a bare CASE in a condition is the wave 1 trap)", !/and case when app_type/.test(sql));
A("a seat candidate cannot read the ballots on their own seat; every other reader keeps the old test, pre-checked and self-checked",
  sql.indexOf("alter policy \"office reads app ballots\" on public.application_ballots\n  using ((public.is_staff() or public.is_commissioner())\n         and not (app_type = 'committee'\n                  and exists (select 1 from public.committee_applications a\n                               where a.id = application_id and a.profile_id = (select auth.uid()))));") > 0
  && /policyname = 'office reads app ballots' and qual = '\(is_staff\(\) OR is_commissioner\(\)\)'\) then/.test(sql)
  && /'v4.59 committees: the ballot read policy does not keep a seat candidate off their own ballots'/.test(sql));
A("the policies are pre-checked against the text read on 2026-11-24 before they are rewritten",
  count(sql, "'((voter_id = auth.uid()) AND is_app_reviewer(auth.uid()))'") === 3 && /'v4.59 committees: the application_ballots write policies changed since this record was written'/.test(sql));

console.log("\n7. The patches");
A("resolve_application_if_ready: one committee branch before 'else return', anchored once, the rest byte-identical",
  sql.indexOf("  elsif p_type = 'committee' then perform public._committee_app_resolve(p_id); return;\n") > 0
  && /if n <> 1 then raise exception 'v4.59 committees: resolve_application_if_ready anchor matched % times', n; end if;/.test(sql)
  && /'v4.59 committees: resolve_application_if_ready changed by more than the committee branch'/.test(sql));
A("resolve_all_pending_applications: committee applications re-asked when the staff changes, the rest byte-identical",
  sql.indexOf("    union all select 'committee', id from public.committee_applications where status='pending'   -- v4.59\n") > 0
  && /'v4.59 committees: resolve_all_pending_applications changed by more than the committee line'/.test(sql));
A("override_application_decision: the commissioner decides a committee application alone, after the commissioner check",
  sql.indexOf("  if p_type = 'committee' then\n    perform public._committee_app_decide(p_id, p_approve, auth.uid());\n    return;\n  end if;\n") > 0
  && sql.indexOf("a := $a$  /* v4.21b: an owner or staff application that is no longer pending is refused out loud (apply_application_decision\n$a$;") > 0
  && /'v4.59 committees: override_application_decision changed by more than the committee branch'/.test(sql));
A("each patch is proven byte-identical but for its block (replace(v_def, v_blk, '') <> v_old)", count(sql, "if replace(v_def, v_blk, '') <> v_old then") === 3);

console.log("\n8. can_run_market");
const crm = (sql.match(/do \$crm\$\n([\s\S]*?)\nend \$crm\$;/) || [])[1] || "";
A("never created here: the bid-night record creates it and applies first, and the record refuses to run without it",
  !/create (or replace )?function public\.can_run_market/.test(sql)
  && /if to_regprocedure\('public\.can_run_market\(\)'\) is null then\n    raise exception 'v4.59 committees: can_run_market\(\) is missing; apply the bid-night record first/.test(sql)
  && /apply order: bid nights, then this record\./.test(sql));
A("widened on the contract's marker and 'select public.is_commissioner()', each exactly once, else refused",
  crm.indexOf("v_marker text := '-- shortcut: commissioners only until a Draft and Bidding manager is seated, widen when committee seats exist';") > 0
  && crm.indexOf("v_old text := 'select public.is_commissioner()';") > 0
  && crm.indexOf("v_new text := 'select (public.is_commissioner() or public.is_committee_manager(auth.uid(), ''draft''))';") > 0
  && /if n1 <> 1 or n2 <> 1 or position\('is_committee_manager' in v_old_def\) > 0 then/.test(crm)
  && /execute replace\(replace\(v_old_def, v_marker, v_now\), v_old, v_new\);/.test(crm));
A("...and proven byte-identical but for the widening", /if replace\(replace\(v_def, v_now, v_marker\), v_new, v_old\) <> v_old_def then/.test(crm));
A("the header records the apply order and the live-bidder ruling (whoever can_run_market allows reads live bids)",
  /the bid-night record\n--     CREATES it/.test(sql) && /identities\n--     stay hidden until the lot ends from everyone but whoever can_run_market\(\) allows/.test(sql));
A("gate helpers keep anon EXECUTE (policies call them); can_run_market is checked widened by a self-check",
  /grant execute on function public\.can_run_market\(\) to anon, authenticated, service_role;/.test(sql)
  && /'v4.59 committees: can_run_market\(\) is not widened to the Draft and Bidding manager'/.test(sql));

console.log("\n9. Definers, grants and self-checks");
const defs = [...sql.matchAll(/create or replace function (public\.[a-z_]+)\([^)]*\)\n([\s\S]*?)\nas \$function\$/g)];
A("every new function is SECURITY DEFINER with an empty search_path (" + defs.length + ")",
  defs.length === 11 && defs.every((m) => /\nsecurity definer\nset search_path to ''$/.test(m[2])), defs.map((m) => m[1]).join(" "));
A("every new function has its EXECUTE revoked from public, anon and authenticated",
  defs.every((m) => sql.indexOf("revoke all on function " + m[1] + "(") > 0) && /revoke all on function public\.can_run_market\(\) from public, anon, authenticated;/.test(sql));
A("the internals have no client grant; the doors are for signed-in members only",
  !/grant execute on function public\._committee_app_(decide|resolve)/.test(sql) && !/grant execute on function public\.committee_seat_role_change/.test(sql)
  && ["apply_committee_seat(text, text)", "withdraw_committee_application(uuid)", "vacate_committee_seat(text, text)"].every((f) => sql.indexOf("grant execute on function public." + f + " to authenticated, service_role;") > 0));
A("the new tables join supabase_realtime (the staff desk follows them live)", /alter publication supabase_realtime add table public\.committees, public\.committee_applications;/.test(sql));
A("the self-checks cover the rows, RLS, privileges, definers, grants, the ballots, the patches, the trigger and the publication",
  ["the six committees are not as ruled", "row level security is off", "carries the wrong API privileges", "must be SECURITY DEFINER",
   "carries the wrong EXECUTE grant", "does not accept a committee ballot", "lacks the committee voters", "a patch is missing",
   "the role change trigger is missing", "are not in supabase_realtime", "a seat test answers wrongly"].every((t) => sql.indexOf(t) > 0));
A("the proconfig check is an array expression, not a subquery (the wave 1 any((select ...)) trap)",
  /'search_path=""' = any\(coalesce\(p\.proconfig, '\{\}'::text\[\]\)\)/.test(sql) && !/any\(\(select/.test(sql));
A("every UPDATE in the record names its rows (pg_safeupdate)",
  (sql.match(/\bupdate public\.[a-z_]+(?: [a-z])?\s+set [\s\S]*?;/g) || []).every((u) => /\bwhere\b/.test(u)));

console.log("\n10. Doors and words");
A("the record posts nothing to Discord (bells and the role sync request only)", !/discord_http_post|notify_staff_ch|notify_department|_announce_once|net\.http|club_notify/.test(sql));
A("the record has no em or en dashes", !DASHES.test(sql));
A("no spaced hyphens and no gendered pronouns in the record's comments and member-facing text",
  !/ - /.test(comments(sql)) && !GENDERED.test(comments(sql)) && !GENDERED.test((sql.match(/'[^'\n]*'/g) || []).join(" ")));
A("bells and errors speak of they/them ('withdrew their application')", /withdrew their application to manage the/.test(sql));

console.log("\n11. The rehearsal");
const reh = R(REH);
const marker = "-- >>> record text: " + REC + "\n";
const embedded = (reh.split(marker)[1] || "").split("-- <<< record text\n")[0];
A("it carries the record's text byte for byte", embedded === sql.replace(/\n?$/, "\n"));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("its prerequisites are stated and checked first (the bid-night record live or pasted after begin)",
  /^-- Prerequisites: v4\.58 live \(it is\) and the bid-night record/m.test(reh)
  && reh.indexOf("'REHEARSAL CANNOT RUN: the bid-night record must be live, or its text pasted right after begin (it creates can_run_market)'") < reh.indexOf("-- >>> record text"));
A("the application tables are locked in SHARE mode before the T0 fingerprint (no concurrent edit can fail T0)",
  reh.indexOf("lock table public.owner_applications, public.staff_applications, public.management_applications, public.application_ballots in share mode;")
    < reh.indexOf("select set_config('rh.apps_before',") && reh.indexOf("lock table") > reh.indexOf("begin;"));
A("the after-checks are targeted at what the rehearsal alone would leave, not row counts that move on their own",
  /where link_param like '%type=committee%'/.test(reh) && /where reason = 'committees:seat'/.test(reh) && !/count net\.http_request_queue/.test(reh));
A("T11 bans a seated staffer under a commissioner's claims and reads the ban back (a protected column is never written blind)",
  /update public\.profiles set banned = true, banned_at = now\(\), banned_by = current_setting\('rh\.k'\)::uuid/.test(reh)
  && /if v_n <> 1 or not \(select p\.banned from public\.profiles p where p\.id = current_setting\('rh\.b'\)::uuid\) then/.test(reh));
A("T6d runs the patched resolve_all_pending_applications and proves nothing else moved", /perform public\.resolve_all_pending_applications\(\);/.test(reh)
  && /'T6d failed: resolve_all_pending_applications decided an owner, staff or front-office application/.test(reh));
A("T0: applications and ballots are fingerprinted before the record and compared after it",
  reh.indexOf("select set_config('rh.apps_before',") < reh.indexOf(marker)
  && reh.indexOf("raise exception 'T0 failed: applying the record changed an application or a ballot';") > reh.indexOf("-- <<< record text"));
const tail = reh.split("-- <<< record text\n")[1] || "";
A("expected refusals re-raise anything else, with the record's exact sentences",
  ["COMMITTEE: Only members of the league staff may apply for a committee manager seat.",
   "COMMITTEE: Commissioners already hold every committee power, so they do not apply for a seat.",
   "COMMITTEE: You already applied for this seat. Withdraw that application to file a new one.",
   "COMMITTEE: That committee was not found.", "COMMITTEE: Tell the staff why you want the seat.",
   "WITHDRAW: Only the applicant may withdraw their committee application.",
   "COMMITTEE: Only the committee manager or a commissioner may open this seat.",
   "COMMITTEE: Give a reason. It is kept on the record and sent to the manager."].every((m) => tail.indexOf("if sqlerrm <> '" + m + "' then raise; end if;") > 0 && sql.indexOf("'" + m + "'") > 0)
  && count(tail, "if sqlerrm not like 'new row violates row-level security policy%' then raise; end if;") === 3);
A("the vote is walked ballot by ballot through the table door under RLS, one short and then the deciding one",
  count(tail, "for i in 1 .. v_need - 1 loop") === 1 && /v\[v_need\]::uuid, 'approve'\);/.test(tail)
  && /for i in 1 \.\. v_d - 1 loop/.test(tail) && /v\[v_d\]::uuid, 'deny'\);/.test(tail)
  && count(tail, "set local role authenticated;") >= 4 && /set local role anon;/.test(tail));
A("every case is checked", ["T1a failed", "T1b failed", "T2a failed", "T2b failed", "T2c failed", "T2d failed", "T2g failed", "T3a failed", "T3b failed",
  "T3c failed", "T3d failed", "T4b failed", "T4d failed", "T4e failed", "T4f failed", "T4g failed", "T5 failed", "T6b failed", "T6c failed",
  "T7a failed", "T7b failed", "T7c failed", "T7e failed", "T8b failed", "T8c failed", "T8d failed", "T8e failed", "T8f failed", "T9a failed",
  "T9b failed", "T9d failed", "T9 failed", "T9e failed", "T10 failed", "T3e failed", "T6d failed", "T11 failed"].every((t) => tail.indexOf(t) > 0)
  && /T0 failed: a banned member is in the staff electorate/.test(tail));
A("T10 goes through the commissioner's door (set_member_role) with app.app_decide on, so no owner vote is re-asked",
  /perform set_config\('app\.app_decide', 'on', true\);\n  perform public\.set_member_role\(current_setting\('rh\.c'\)::uuid, 'member'\);/.test(tail));
A("the verdict block has no handler and ends in the uncaught REHEARSAL OK",
  /do \$v\$\n(?:(?!exception when)[\s\S])*raise exception 'REHEARSAL OK: T0 [^']*\(% voters, % to pass, % denials to fail\)',\n    current_setting\('rh\.all'\), current_setting\('rh\.need'\), current_setting\('rh\.deny'\);\nend \$v\$;\n$/.test(reh));
A("no dblink, no http", !/dblink|http_get|http_post\(/i.test(reh));
A("the rehearsal names no member (people are picked inside the transaction)", !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));
A("no row is looked up by created_at (now() is constant in one transaction)", !/created_at\s*(=|>|<)/.test(tail));
A("the rehearsal has no dashes and no gendered pronouns", !DASHES.test(reh) && !GENDERED.test(comments(reh)));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
