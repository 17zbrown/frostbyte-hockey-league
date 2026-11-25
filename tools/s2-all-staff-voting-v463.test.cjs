/* v463 (DRAFT, applied at the flip): every staff member and commissioner votes on applications.
   node tools/s2-all-staff-voting-v463.test.cjs
   Rulings 2026-11-23 (memory s2-staffing-model.md and season2-format-rulings.md): "Every staff member votes on owner,
   staff and front-office (GM/AGM) applications, 50% + 1"; commissioners vote too and keep deciding alone; the switch comes
   "when the new site is posted". Pins the record (the reviewer set IS the staff electorate, the read policies follow
   it, nothing is decided by the switch), its reverse (the 2026-11-24 definitions byte for byte) and the rehearsal that
   runs both. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;
const comments = (s) => (s.match(/--[^\n]*|\/\*[\s\S]*?\*\//g) || []).join("\n");

const REC = "sql/2026-11-24-s2-all-staff-voting-v463.sql";
const REV = REC.replace(/\.sql$/, ".reverse.sql");
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC), rev = R(REV), reh = R(REH);

console.log("1. The record");
A("a DRAFT for the flip, applied with the staff powers record and never before",
  /^-- v463 \(DRAFT, 2026-11-24; apply at the flip, T\+15, together with the staff powers record\n-- \(sql\/2026-11-24-s2-staff-powers-\*\.sql\), never before\)/.test(sql));
A("the rulings are quoted: every staff member votes, commissioners too, the switch at the new site",
  /"Every staff member votes on owner, staff and front-office \(GM\/AGM\) applications, 50% \+ 1\."/.test(sql)
  && /"when the new site is posted"/.test(sql) && /\("Decide now"\)/.test(sql));
A("is_app_reviewer IS the staff electorate, and app_reviewer_count its size, both definers with an empty search_path",
  /create or replace function public\.is_app_reviewer\(p_uid uuid\)\nreturns boolean\nlanguage sql\nstable\nsecurity definer\nset search_path to ''\nas \$function\$\n[\s\S]*?  select public\.is_staff_voter\(p_uid\);\n\$function\$;/.test(sql)
  && /create or replace function public\.app_reviewer_count\(\)\nreturns integer\nlanguage sql\nstable\nsecurity definer\nset search_path to ''\nas \$function\$\n[\s\S]*?  select public\.staff_voter_count\(\);\n\$function\$;/.test(sql));
A("the two application read policies read every voter (no Media-only carve-out)",
  (sql.match(/using \(\(profile_id = \(select auth\.uid\(\)\)\) or public\.is_app_reviewer\(\(select auth\.uid\(\)\)\)\);/g) || []).length === 2
  && /alter policy owner_app_read on public\.owner_applications/.test(sql) && /alter policy staff_app_read on public\.staff_applications/.test(sql));
A("it refuses to run before the committees record, or on definitions other than the ones its reverse restores",
  /'v463 all-staff voting: the committees record \(is_staff_voter, staff_voter_count\) must be applied first'/.test(sql)
  && /'v463 all-staff voting: is_app_reviewer or app_reviewer_count changed since 2026-11-24, so the reverse would not restore them'/.test(sql)
  && /'v463 all-staff voting: owner_app_read or staff_app_read changed since 2026-11-24'/.test(sql));
A("self-checks: definers, grants kept, the count, every member, the policies", ["is not SECURITY DEFINER with an empty search_path",
  "lost or gained a grant", "app_reviewer_count is not the staff electorate", "are reviewers but not voters", "does not read every voter"].every((t) => sql.indexOf(t) > 0));
A("nothing is decided by the switch: no resolve call, no write", !/resolve_|apply_application_decision|insert into|update public\.|delete from/.test(sql.replace(/--[^\n]*/g, "")));
A("the outside-the-database flip parts are named (the vote nudge and the classic site's reviewer count)",
  /jobs\/discord-scheduler\.js:628/.test(sql) && /src\/live\/part_live\.js:5746 and 5760/.test(sql));
/* v4.63 (release): the Discord stream's flip part moved the vote nudge onto the database's answer, so the note says the
   scheduler follows this record and only the classic fallback still names the department. */
A("...and the note is current: the nudge asks the database, the classic fallback still names the department",
  /sbRpc\("is_app_reviewer"/.test(R("jobs/discord-scheduler.js")) && !/p\.departments\.includes\("applications"\)/.test(R("jobs/discord-scheduler.js"))
  && /indexOf\("applications"\)>=0/.test(R("src/live/part_live.js")) && /it asks public\.is_app_reviewer, so it follows/.test(sql));

const mpairs = (s) => (s.split("-- >>> patch pairs\n")[1] || "").split("-- <<< patch pairs\n")[0];
A("the GM and AGM nomination bell reaches every voter on the staff, not the applications department, anchored exactly once",
  /\(1, \$o\$           where role = 'staff'\n             and 'applications' = any\(coalesce\(departments, '\{\}'\)\)\n/.test(mpairs(sql))
  && /\$n\$           where role = 'staff'\n             and public\.is_staff_voter\(id\)   \/\* v463/.test(mpairs(sql))
  && /if n <> 1 then raise exception 'v463 all-staff voting: notify_mgmt_application anchor % matched % times', r\.ord, n; end if;/.test(sql));
A("the nominee's note stops naming the Review Board; the old em dash is built with chr(8212), never typed",
  /\$o\$      '\. The Review Board votes on the appointment \$o\$ \|\| chr\(8212\) \|\| \$o\$ you''ll be notified of the decision\.',/.test(mpairs(sql))
  && /'\. The league staff vote on the appointment, and you will be told the decision\.',/.test(mpairs(sql)));
A("a self-check proves the bell reads the electorate and keeps the commissioners' bell",
  /'v463 all-staff voting: the nomination bell does not reach every voter, or lost the commissioners'/.test(sql));
A("the apply order of the three flip records is written in the header and the reverse",
  /-- Apply order at the flip \(one owner per function, so the three records compose\): 1\. the staff powers record\n-- \(sql\/2026-11-24-s2-staff-powers-v463\.sql\), 2\. this record, 3\. sql\/2026-11-24-s2-staff-copy-v463\.sql/.test(sql)
  && /the\n-- staff copy reverse first, this one second, the staff powers reverse last\)/.test(rev));
A("the header gives today's electorate without the banned staffer (11 voters, 6 to pass)", /it is 11 \(8 staff and 3\n--    commissioners\) and 6 pass a vote/.test(sql));

console.log("\n2. The reverse");
A("the reverse undoes the same nomination bell pairs, byte for byte, last first",
  mpairs(rev) === mpairs(sql) && mpairs(sql).length > 300 && /\) as x\(ord, old_text, new_text\) order by x\.ord desc loop/.test(rev)
  && /execute replace\(v_def, r\.new_text, r\.old_text\);/.test(rev));
const lit = (s) => (s.match(/\$old\$CREATE OR REPLACE FUNCTION[\s\S]*?\$old\$/g) || []);
A("the reverse restores the exact definitions the forward record checks before it runs", lit(sql).length === 2 && lit(rev).length === 2
  && lit(sql)[0] === lit(rev)[0] && lit(sql)[1] === lit(rev)[1]);
A("...the 2026-11-24 definitions: the applications department, search_path public",
  lit(rev).every((s) => /'applications' = any\(coalesce\(departments, '\{\}'\)\)/.test(s) && /SET search_path TO 'public'/.test(s)));
A("the reverse compares the restored definitions byte for byte", /if pg_get_functiondef\('public\.is_app_reviewer\(uuid\)'::regprocedure\) <> v_rev\n     or pg_get_functiondef\('public\.app_reviewer_count\(\)'::regprocedure\) <> v_cnt then/.test(rev));
A("the reverse restores both read policies to the rendering read on 2026-11-24, and checks it",
  (rev.match(/using \(\(profile_id = \(select auth\.uid\(\)\)\) or \(public\.is_staff\(\) and not public\.is_media_only_staff\(\(select auth\.uid\(\)\)\)\) or public\.is_commissioner\(\)\);/g) || []).length === 2
  && rev.indexOf("qual = '((profile_id = ( SELECT auth.uid() AS uid)) OR (is_staff() AND (NOT is_media_only_staff(( SELECT auth.uid() AS uid)))) OR is_commissioner())'") > 0
  && sql.indexOf("qual = '((profile_id = ( SELECT auth.uid() AS uid)) OR (is_staff() AND (NOT is_media_only_staff(( SELECT auth.uid() AS uid)))) OR is_commissioner())'") > 0);
A("the reverse refuses to run when the vote is not applied", /'v463 all-staff voting reverse: the all-staff vote is not applied, so there is nothing to reverse'/.test(rev));

console.log("\n3. The rehearsal");
const part = (m1, m2) => (reh.split(m1)[1] || "").split(m2)[0];
A("it carries the record byte for byte", part("-- >>> record text: " + REC + "\n", "-- <<< record text\n") === sql.replace(/\n?$/, "\n"));
A("it carries the reverse byte for byte, after the cases", part("-- >>> reverse text: " + REV + "\n", "-- <<< reverse text\n") === rev.replace(/\n?$/, "\n")
  && reh.indexOf("-- >>> reverse text") > reh.indexOf("R4e failed"));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("its prerequisite is stated and checked first", /^-- Prerequisites: the committees record/m.test(reh)
  && reh.indexOf("'REHEARSAL CANNOT RUN: the committees record must be live, or its text pasted right after begin'") < reh.indexOf("-- >>> record text"));
A("the fingerprint is taken before the record and compared after the reverse", reh.indexOf("perform set_config('rh.fp'") < reh.indexOf("-- >>> record text")
  && reh.indexOf("<> current_setting('rh.fp') then") > reh.indexOf("-- <<< reverse text"));
A("the vote is walked ballot by ballot through the table door under RLS: one short, then the deciding one",
  /for i in 1 \.\. v_need - 1 loop/.test(reh) && /values \('staff', current_setting\('rh\.m_app'\)::uuid, v\[v_need\]::uuid, 'approve'\);/.test(reh)
  && /insert into public\.staff_applications \(profile_id, pitch, departments\)/.test(reh));
A("N and V are picked from the staff electorate (2026-11-24: the first non-suspended staffer was banned, not a voter, and R1 failed)",
  /select p\.id into v_n from public\.profiles p where p\.role = 'staff' and public\.is_staff_voter\(p\.id\)\n/.test(reh)
  && /select p\.id into v_v from public\.profiles p where p\.role = 'staff' and public\.is_staff_voter\(p\.id\) and p\.departments = array\['media'\]/.test(reh));
A("every case is checked", ["R1 failed", "R2 failed", "R3 failed", "R4c failed", "R4e failed", "R5a failed", "R5b failed", "R5c failed",
  "R6 failed", "R5d failed"].every((t) => reh.indexOf(t) > 0));
A("R6 and R5d run the real trigger function on a temporary copy of the table, and the fingerprint covers it",
  /create temp table rh_mgmt \(like public\.management_applications including defaults\) on commit drop;\ncreate trigger rh_mgmt_notify after insert on rh_mgmt for each row execute function public\.notify_mgmt_application\(\);/.test(reh)
  && (reh.match(/\|\| pg_get_functiondef\('public\.notify_mgmt_application\(\)'::regprocedure\)/g) || []).length === 2);
A("the verdict block has no handler and ends in the uncaught REHEARSAL OK",
  /do \$v\$\nbegin\n  raise exception 'REHEARSAL OK: [^']*',\n[^;]*;\nend \$v\$;\n$/.test(reh));
A("no dblink, no http, no member named", !/dblink|http_get|http_post\(/i.test(reh) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));

console.log("\n4. Words");
A("no dashes in any of the three files", !DASHES.test(sql) && !DASHES.test(rev) && !DASHES.test(reh));
A("no spaced hyphens or gendered pronouns in their comments", [sql, rev, reh].every((s) => !/ - /.test(comments(s)) && !GENDERED.test(comments(s))));
A("nothing posts to Discord", ![sql, rev].some((s) => /discord_http_post|notify_staff|notify_department|net\.http/.test(s)));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
