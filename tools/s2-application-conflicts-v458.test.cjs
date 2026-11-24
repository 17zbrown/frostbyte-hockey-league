/* v4.58: Rule 2.7 at the application door. node tools/s2-application-conflicts-v458.test.cjs
   Commissioner, 2026-11-23: "Staffers cannot submit owner applications and team managers cannot submit staff applications
   until they remove themselves or are removed from their seat." One SECURITY DEFINER trigger function on
   owner_applications (refuses a staff or commissioner applicant) and staff_applications (refuses a club seat holder), on
   every insert (the site's upsert included) and on a move back to pending. Pins the record (the guard, its triggers and
   their order, the self-checks) and its rehearsal (the cases, the modeled rollover, the record text byte for byte). */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;
const count = (s, needle) => s.split(needle).length - 1;

const REC = "sql/2026-11-24-s2-application-conflicts-v458.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC);
const fn = (sql.match(/create or replace function public\.guard_app_role_conflict\(\)\n([\s\S]*?)\nend \$function\$;/) || [])[1] || "";
const MSG_COMMISH = "Commissioners cannot apply to own a club (Rule 2.7). Step down as commissioner first, then apply.";
const MSG_STAFF = "Members of the league staff cannot apply to own a club (Rule 2.7). Leave the staff first, then apply.";
const MSG_SEAT = "Owners, General Managers and Assistant General Managers cannot apply to join the league staff (Rule 2.7). Step down from your club seat first, then apply.";

console.log("1. The record");
A("the header quotes the commissioner's ruling of 2026-11-23",
  /Commissioner, 2026-11-23: "Staffers cannot submit owner applications and team managers cannot submit staff\n-- applications until they remove themselves or are removed from their seat\."/.test(sql));
A("one function, SECURITY DEFINER with an empty search_path, EXECUTE revoked from public, anon and authenticated",
  /returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path to ''\nas \$function\$/.test(fn)
  && sql.indexOf("revoke all on function public.guard_app_role_conflict() from public, anon, authenticated;") > 0);
A("only the office's doors pass (app.app_decide, app.app_award); no caller bypass, no exemption, no Media carve-out",
  /if coalesce\(current_setting\('app\.app_decide', true\), ''\) = 'on'\n     or coalesce\(current_setting\('app\.app_award', true\), ''\) = 'on' then\n    return new;/.test(fn)
  && !/is_commissioner|auth\.uid|is_role_exempt|role_conflict_exemptions|is_media_only|media_exclusive/.test(fn.replace(/\/\*[\s\S]*?\*\//g, "")));
A("an UPDATE is checked only when the row ends pending after not being pending, or moves to another member",
  fn.indexOf("if tg_op = 'UPDATE' and not (new.status = 'pending'\n       and (old.status is distinct from 'pending' or new.profile_id is distinct from old.profile_id)) then\n    return new;") > 0);
A("owner side: keyed on the applicant's profiles.role (staff or commissioner), never the caller",
  fn.indexOf("select p.role::text into v_role from public.profiles p where p.id = new.profile_id;") > 0
  && /if v_role = 'commissioner' then/.test(fn) && /elsif v_role = 'staff' then/.test(fn));
A("staff side: reuses public.holds_club_seat, the one seat definition the decision doors use",
  fn.indexOf("elsif public.holds_club_seat(new.profile_id) then") > 0 && !/owner_profile_id|gm_profile_id|agm_profile_id/.test(fn.replace(/\/\*[\s\S]*?\*\//g, "")));
A("three refusals in plain league language, each citing Rule 2.7, each 42501",
  [MSG_COMMISH, MSG_STAFF, MSG_SEAT].every((m) => fn.indexOf("raise exception '" + m + "'\n" + (m === MSG_SEAT ? "      " : "        ") + "using errcode = '42501';") > 0));
A("two triggers, BEFORE INSERT OR UPDATE, FOR EACH ROW, on the one function (dropped first, so the record re-runs)",
  sql.indexOf("drop trigger if exists guard_owner_app_role_conflict on public.owner_applications;\ncreate trigger guard_owner_app_role_conflict before insert or update on public.owner_applications\n  for each row execute function public.guard_app_role_conflict();") > 0
  && sql.indexOf("drop trigger if exists guard_staff_app_role_conflict on public.staff_applications;\ncreate trigger guard_staff_app_role_conflict before insert or update on public.staff_applications\n  for each row execute function public.guard_app_role_conflict();") > 0);
/* Postgres fires BEFORE triggers in name order (byte order, as JavaScript compares ASCII strings) */
A("trigger order: after the decision guards and the signed-up guard, before the filed_at stamps",
  "guard_owner_app_role_conflict" > "guard_owner_app_decision" && "guard_owner_app_role_conflict" > "guard_owner_app_picks_trg"
  && "guard_owner_app_role_conflict" > "ab_guard_owner_app_signed_up" && "guard_owner_app_role_conflict" < "zz_stamp_owner_app_filed_at"
  && "guard_staff_app_role_conflict" > "guard_staff_app_decision" && "guard_staff_app_role_conflict" > "guard_staff_app_insert"
  && "guard_staff_app_role_conflict" < "trg_staff_app_department_cap" && "guard_staff_app_role_conflict" < "zz_stamp_staff_app_filed_at");
A("...the stamps it must precede are the v4.22 triggers, and the signed-up guard is v3.99's",
  /create trigger zz_stamp_owner_app_filed_at before insert or update on public\.owner_applications/.test(R("sql/2026-10-19-staff-withdraw-and-waitlist-v422.sql"))
  && /create trigger zz_stamp_staff_app_filed_at before insert or update on public\.staff_applications/.test(R("sql/2026-10-19-staff-withdraw-and-waitlist-v422.sql"))
  && /create trigger ab_guard_owner_app_signed_up before insert or update on public\.owner_applications/.test(R("sql/2026-10-13-owner-applicants-signed-up-v399.sql")));
A("...and the record re-checks the order and the decision guards on the live database",
  sql.indexOf("raise exception 'v4.58 application conflicts: the trigger order changed';") > 0
  && sql.indexOf("raise exception 'v4.58 application conflicts: the decision guards this trigger must fire after are missing';") > 0);
A("self-checks: definer and search_path, no API EXECUTE, both triggers by catalog (tgtype 23, enabled, no WHEN, no column list)",
  ["must be SECURITY DEFINER with search_path", "the API roles can execute guard_app_role_conflict", "tgtype = 23 and tgenabled = 'O'",
   "tgqual is null and tgattr = ''::int2vector) <> 2 then"].every((t) => sql.indexOf(t) >= 0));
A("already filed applications are left alone: the record reports the conflicting count and writes no row",
  /raise notice 'v4.58 application conflicts: already filed and conflicting, left alone: % owner, % staff'/.test(sql)
  && !/\b(insert\s+into|delete\s+from|truncate)\b/i.test(sql) && !/\bupdate\s+public\./i.test(sql));
A("the record posts nothing and rings nobody", !/discord_http_post|notify_|create_notification|_announce_once|net\.http/.test(sql));
A("the record has no dashes and no gendered pronouns", !DASHES.test(sql) && !/ - /.test(sql) && !GENDERED.test(sql));

console.log("\n2. The rehearsal");
const reh = R(REH);
const marker = "-- >>> record text: " + REC + "\n";
const embedded = (reh.split(marker)[1] || "").split("-- <<< record text\n")[0];
A("it carries the record's text byte for byte", embedded === sql.replace(/\n?$/, "\n"));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("T0: the applications are fingerprinted before the record and compared after it",
  reh.indexOf("select set_config('rh.apps_before',") < reh.indexOf(marker)
  && reh.indexOf("raise exception 'T0 failed: applying the record changed an application row';") > reh.indexOf("-- <<< record text"));
const roll = (reh.match(/\/\* D-ROLLOVER[\s\S]*?\n  end if;\n/) || [""])[0];
A("D-ROLLOVER: the commissioner's rollover is modeled under a commissioner's claims, only while Season 1 deals are open",
  /if exists \(select 1 from public\.contracts c\n\s+where c\.status in \('active', 'signed'\) and not coalesce\(c\.is_manager, false\)/.test(roll)
  && /perform set_config\('request\.jwt\.claims', json_build_object\('sub', v_k, 'role', 'authenticated'\)::text, true\);\n    perform public\.start_next_season\(v_s2\);/.test(roll)
  && /also passes after the real rollover/.test(roll));
A("...before anyone is seated, and no contract is expired by hand",
  reh.indexOf("perform public.start_next_season(v_s2);") < reh.indexOf("perform public._assign_team_role(") && !/update\s+public\.contracts/i.test(reh));
A("the office changes roles and seats through the production doors (set_member_role, _assign_team_role)",
  count(reh, "perform public.set_member_role(") === 3 && count(reh, "perform public._assign_team_role(") === 1);
A("expected refusals sit in inner blocks that re-raise anything else, with the record's exact sentences",
  count(reh, "if sqlerrm <> '" + MSG_STAFF + "' then raise; end if;") === 2
  && count(reh, "if sqlerrm <> '" + MSG_COMMISH + "' then raise; end if;") === 1
  && count(reh, "if sqlerrm <> '" + MSG_SEAT + "' then raise; end if;") === 2
  && count(reh, "exception when others then\n    if sqlerrm <> '") === 5);
A("every case is there: T1a T1b (staffer), T2 (commissioner), T3 (member), T4a T4b (seat holder), T5 (non-holder), T6 (Season 1), T7 (office)",
  ["T1a failed", "T1b failed", "T2 failed", "T3 failed", "T4a failed", "T4b failed", "T5 failed", "T6 failed", "T7 failed"].every((t) => reh.indexOf(t) > 0));
A("T1 and T4 go through the site's upsert (BEFORE INSERT runs first) and through a direct move back to pending",
  /on conflict \(profile_id, season_id\) do update set status = excluded\.status/.test(reh) && /on conflict \(profile_id\) do update set status = excluded\.status/.test(reh)
  && /update public\.owner_applications set status = 'pending', updated_at = now\(\) where id = current_setting\('rh\.a_app'\)::uuid;/.test(reh)
  && /update public\.staff_applications set status = 'pending', updated_at = now\(\) where id = current_setting\('rh\.b_app'\)::uuid;/.test(reh));
A("T4a files for Media alone, so no Media exception survives", /values \(current_setting\('rh\.b'\)::uuid, array\['media'\]/.test(reh));
A("the applicants act as API users (RLS on), the office as the database", count(reh, "set local role authenticated;") === 2 && count(reh, "reset role;") === 2);
A("the verdict block has no handler and ends in the uncaught REHEARSAL OK",
  /do \$v\$\n(?:(?!exception when)[\s\S])*raise exception 'REHEARSAL OK: T0 T1a T1b T2 T3 T4a T4b T5 T6 T7 \(already filed and conflicting, left alone: %\)',\n    current_setting\('rh\.conflicts'\);\nend \$v\$;\n$/.test(reh));
A("no dblink, no http", !/dblink|http_get|http_post\(/i.test(reh));
A("the rehearsal names no member (people are picked inside the transaction)", !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));
A("the rehearsal has no dashes and no gendered pronouns", !DASHES.test(reh) && !GENDERED.test(reh));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
