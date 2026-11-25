/* v463 (DRAFT, applied at the flip, third): the Season 2 staff copy. node tools/s2-staff-copy-v463.test.cjs
   Rulings (memory s2-staffing-model.md): no departments, one staff group (2026-10-19); no Media (2026-10-22); committees,
   every staffer and commissioner votes, the Draft and Bidding manager runs the draft tools (2026-11-23). After the flip
   the database text that names a department, the reviewers, the review board or the Media exemption is false; this
   record rewrites it. Pins the record (40 pairs, words only, one owner per function, the apply order), its reverse (the
   same pairs undone) and the rehearsal (the staff powers and all-staff voting texts first, then this one). */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;
const comments = (s) => (s.match(/--[^\n]*|\/\*[\s\S]*?\*\//g) || []).join("\n");
const count = (s, needle) => s.split(needle).length - 1;

const REC = "sql/2026-11-24-s2-staff-copy-v463.sql";
const REV = REC.replace(/\.sql$/, ".reverse.sql");
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const SP = "sql/2026-11-24-s2-staff-powers-v463.sql", VO = "sql/2026-11-24-s2-all-staff-voting-v463.sql";
const sql = R(REC), rev = R(REV), reh = R(REH), sp = R(SP), vo = R(VO);
const pairsOf = (s) => (s.split("-- >>> patch pairs\n")[1] || "").split("-- <<< patch pairs\n")[0];
const pairs = pairsOf(sql);
/* a pair's old and new text as Postgres sees them: '$o$ || chr(8212) || $o$' joins an em dash the file never types */
const EM = String.fromCharCode(0x2014);
const all = [...pairs.matchAll(/    \((\d+), '([^']+)', \$o\$([\s\S]*?)\$o\$, \$n\$([\s\S]*?)\$n\$\)/g)]
  .map((m) => ({ n: +m[1], fn: m[2], o: m[3].split("$o$ || chr(8212) || $o$").join(EM), n2: m[4] }));
const byN = (k) => all.find((p) => p.n === k) || { fn: "", o: "", n2: "" };
/* the code a message pair must leave alone: everything outside string literals and comments */
const skeleton0 = (s) => s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''").replace(/\s+/g, " ").trim();
/* an anchor that starts inside a string literal (an odd count of quotes) is read with that literal opened */
const skeleton = (s) => skeleton0(((s.match(/'/g) || []).length % 2 ? "'" : "") + s);
const literals = (s) => (s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").match(/'(?:[^']|'')*'/g) || []).join(" ");

console.log("1. The record");
A("a DRAFT for the flip, applied third and never before", /^-- v463 \(DRAFT, 2026-11-24; apply at the flip, T\+15, THIRD, after the staff powers and the all-staff voting records,\n-- never before\)/.test(sql));
A("the apply order and the reverse order are written in the header",
  /-- Apply order at the flip \(one owner per function, so the three records compose\): 1\. the staff powers record\n-- \(sql\/2026-11-24-s2-staff-powers-v463\.sql\), 2\. the all-staff voting record \(sql\/2026-11-24-s2-all-staff-voting-v463\.sql\),\n-- 3\. this record/.test(sql)
  && /Reverse in the opposite order: this reverse first, then the\n-- all-staff voting reverse, then the staff powers reverse/.test(sql));
A("it refuses to run before the staff powers and the all-staff voting records, and a second time",
  /'v463 staff copy: apply the staff powers record first \(the apply order is staff powers, all-staff voting, copy\)'/.test(sql)
  && /'v463 staff copy: apply the all-staff voting record first \(the apply order is staff powers, all-staff voting, copy\)'/.test(sql)
  && /'v463 staff copy: already applied'/.test(sql));
A("the retired waitlist functions are left alone, and the header says so", /Left alone, on purpose: the retired waitlist functions \(waitlist_admit, waitlist_application, waitlist_remove\)/.test(sql)
  && !/waitlist_/.test(pairs));

console.log("\n2. The pairs");
A("forty pairs, in order", all.map((p) => p.n).join(",") === Array.from({ length: 40 }, (_, i) => i + 1).join(","), all.map((p) => p.n).join(","));
const SP_OWNS = ["has_department", "_is_stats_staff", "is_media_staff", "is_media_only_staff", "notify_department", "notify_staff_ch",
  "_issue_suspension", "extend_suspension", "lift_suspension", "withdraw_registration", "guard_appeal_decider", "ban_player", "unban_player"];
const VO_OWNS = ["is_app_reviewer", "app_reviewer_count", "notify_mgmt_application"];
const owned = [...new Set(all.map((p) => p.fn.replace(/^public\.|\(.*$/g, "")))];
A("one owner per function: no pair here touches a function the staff powers or the all-staff voting record patches",
  owned.every((f) => !SP_OWNS.includes(f) && !VO_OWNS.includes(f)) && owned.length === 25, owned.join(","));
A("...and the header lists exactly the functions the pairs touch", owned.every((f) => sql.split("\n-- This record owns ")[1].split("no other flip")[0].indexOf(f) >= 0));
A("each anchor is asserted to match once, to land once, and to be gone after",
  /if n <> 1 then raise exception 'v463 staff copy: anchor % in % matched % times', r\.ord, r\.fn, n; end if;/.test(sql)
  && /<> 1 or position\(r\.old_text in v_def\) > 0 then\n      raise exception 'v463 staff copy: patch % in % did not land once', r\.ord, r\.fn;/.test(sql));
const MESSAGE_ONLY = all.filter((p) => ![30, 32, 35].includes(p.n));
A("every pair but two changes words only: the code outside strings and comments is untouched",
  MESSAGE_ONLY.every((p) => skeleton(p.o) === skeleton(p.n2)), MESSAGE_ONLY.filter((p) => skeleton(p.o) !== skeleton(p.n2)).map((p) => p.n).join(","));
A("...pair 30 drops only the department name from the message (v_dept still routes the bell above it, untouched)",
  skeleton(byN(30).o) === "''||v_dept||'', false);" && skeleton(byN(30).n2) === "'', false);");
A("...pair 32 changes a comment only, and pair 35 removes only the Media check (is_media_staff answers no for everyone)",
  skeleton0(byN(32).o) === "" && skeleton0(byN(32).n2) === "" && /^ *--/.test(byN(32).o) && /^ *--/.test(byN(32).n2)
  && skeleton0(byN(35).o) === "if public.is_media_staff(me) then raise exception ''; end if;" && skeleton0(byN(35).n2) === "");
A("the old em dashes are built with chr(8212), never typed, and both are matched", count(pairs, "$o$ || chr(8212) || $o$") === 3 && !DASHES.test(sql));
A("no new message names a department, the reviewers, the review board or Media",
  all.every((p) => !/department|reviewer|review board|\bmedia\b/i.test(literals(p.n2))), all.filter((p) => /department|reviewer|review board|\bmedia\b/i.test(literals(p.n2))).map((p) => p.n).join(","));
A("...and every old text did (or carried the Media exemption), but pair 29, which told every staffer to extend a suspension only a committee manager or a commissioner may now extend",
  all.filter((p) => p.n !== 29).every((p) => /department|reviewer|review board|\bmedia\b/i.test(p.o)) && /Decide whether to extend their/.test(byN(29).o));
A("the words: the league staff, the Draft and Bidding manager, the league office, a committee manager or a commissioner",
  /'Only the league staff or a commissioner can reverse a trade\.'/.test(byN(1).n2) && /the Draft and Bidding manager\.'/.test(byN(19).n2)
  && [19, 20, 21, 22].every((k) => byN(k).n2 === byN(19).n2) && /'The league office approved your application: you now own the '/.test(byN(8).n2)
  && /a committee manager or a commissioner decides an extension/.test(byN(30).n2) && /staff vote approves the nomination/.test(byN(18).n2));
const sweep = ((sql.match(/from unnest\(array\[([\s\S]*?)\]\) w/) || [])[1] || "").match(/'(?:[^']|'')*'/g) || [];
const phrases = sweep.map((q) => q.slice(1, -1).replace(/''/g, "'"));
A("the self-check sweeps a phrase from every old text but the comment pair, and none from any new text",
  all.filter((p) => p.n !== 32).every((p) => phrases.some((w) => p.o.toLowerCase().indexOf(w) >= 0))
  && all.every((p) => !phrases.some((w) => p.n2.toLowerCase().indexOf(w) >= 0)) && phrases.length >= 15,
  all.filter((p) => p.n !== 32 && !phrases.some((w) => p.o.toLowerCase().indexOf(w) >= 0)).map((p) => p.n).join(","));
A("...over the same twenty-five functions, and they stay SECURITY DEFINER",
  owned.every((f) => (sql.split("do $chk$")[1] || "").indexOf("'public." + f + "(") >= 0) && /lost SECURITY DEFINER/.test(sql));
A("every new text that is more than a message carries the version", /v463/.test(byN(32).n2) && /v463/.test(byN(35).n2));

console.log("\n3. The reverse");
A("the reverse carries the forward record's pairs byte for byte", pairsOf(rev) === pairs && pairs.length > 5000);
A("...undone last first, new to old, each asserted once both ways", /\) as x\(ord, fn, old_text, new_text\) order by x\.ord desc loop/.test(rev)
  && /execute replace\(v_def, r\.new_text, r\.old_text\);/.test(rev) && /'v463 staff copy reverse: anchor % in % did not come back once'/.test(rev));
A("it refuses when the copy is not applied, and checks the old words are back", /'v463 staff copy reverse: the staff copy is not applied, so there is nothing to reverse'/.test(rev)
  && /'v463 staff copy reverse: the 2026-11-24 words did not come back'/.test(rev));
A("the staff powers reverse refuses to run while this record stands (the fixed order)",
  /if position\('the Draft and Bidding manager\.' in pg_get_functiondef\('public\.draft_pause\(integer\)'::regprocedure\)\) > 0 then\n    raise exception 'v463 staff powers reverse: the staff copy record still stands; apply its reverse first';/.test(R("sql/2026-11-24-s2-staff-powers-v463.reverse.sql")));

console.log("\n4. The rehearsal");
const part = (m1, m2) => (reh.split(m1)[1] || "").split(m2)[0];
A("it carries the staff powers, the all-staff voting and this record byte for byte, in the apply order",
  part("-- >>> staff powers record text: " + SP + "\n", "-- <<< staff powers record text\n") === sp
  && part("-- >>> all-staff voting record text: " + VO + "\n", "-- <<< all-staff voting record text\n") === vo
  && part("-- >>> record text: " + REC + "\n", "-- <<< record text\n") === sql
  && reh.indexOf("-- >>> staff powers record text") < reh.indexOf("-- >>> all-staff voting record text")
  && reh.indexOf("-- >>> all-staff voting record text") < reh.indexOf("-- >>> record text"));
A("it carries the reverse byte for byte, after the cases", part("-- >>> reverse text: " + REV + "\n", "-- <<< reverse text\n") === rev
  && reh.indexOf("-- >>> reverse text") > reh.indexOf("C3 failed"));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("the fingerprint is taken before any record and compared after the reverse", reh.indexOf("perform set_config('rh.fp'") < reh.indexOf("-- >>> staff powers record text")
  && reh.indexOf("<> current_setting('rh.fp') then") > reh.indexOf("-- <<< reverse text"));
A("the refusals are checked word for word and re-raise anything else", count(reh, "exception when others then\n    if sqlerrm <> '") === 14
  && count(reh, "exception when others then") === count(reh, "exception when others then\n    if sqlerrm <> '") + count(sp, "exception when others then") + count(vo, "exception when others then"));
A("every case is checked", ["C1a failed", "C1i failed", "C2a failed", "C2d failed", "C3 failed", "C4 failed", "C4b failed"].every((t) => reh.indexOf(t) > 0));
A("C3 runs a real staff application through the table door and a commissioner's own decision",
  /insert into public\.staff_applications \(profile_id, pitch, departments\)/.test(reh) && /perform public\.override_application_decision\('staff', current_setting\('rh\.m_app'\)::uuid, false\);/.test(reh)
  && /n\.body = 'The league office did not approve your staff application this time\. You can reapply any time\.'/.test(reh));
A("the verdict block has no handler and ends in the uncaught REHEARSAL OK",
  /do \$v\$\nbegin\n  raise exception 'REHEARSAL OK: [^']*',[^;]*;\nend \$v\$;\n$/.test(reh));
A("no dblink, no http call, no member named", !/dblink|http_get|http_post\(/i.test(reh.replace(/\$o\$[\s\S]*?\$o\$/g, "")) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));

console.log("\n5. Words");
A("no dashes in any of the three files", !DASHES.test(sql) && !DASHES.test(rev) && !DASHES.test(reh));
A("no spaced hyphens or gendered pronouns in their comments", [sql, rev].every((s) => !/ - /.test(comments(s)) && !GENDERED.test(comments(s))));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
