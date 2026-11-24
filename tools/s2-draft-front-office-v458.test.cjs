/* v4.58 (2026-11-25): Season 2's draft and front office. Commissioner, 2026-11-23: "do 3 forwards, 2 defensemen, and 1
   goalie" (minimums, no maximums), "10 round draft" (the Owner and the GM seated before it, the GM required), a skipped
   pick filled after the draft at random at $750K ("750k works"), the Assistant GM named only after the draft and only
   from the club's own roster, a replacement GM in season only from the club's own roster ("Correct"), seat salaries Owner
   $0, GM $0, AGM $2M with the AGM's seat salary replacing the drafted salary, no Media role, and no latecomer placement.
   The go-ahead: "Yes, apply them". Decided for draft night, 2026-11-23: D-SUPPLY (a short group holds a club's picks only
   while an undrafted player of it is left), D-FILL (fills already made counted once, by _unused_pick_fills) and
   D-ROLLOVER (the joint rehearsal models start_next_season before it puts sign-ups on rosters; the commissioner ran it on
   production on 2026-11-23, so the step now skips and nothing relies on a Season 1 contract).
   draft_fits keeps every club able to reach 3/2/1 with the spots and picks it has left (through roster_min_gap, db-guards'
   one 3/2/1 definition, and _undrafted_left); _mgmt_nominee_seat_block is the one nominee test, asked by
   guard_mgmt_nominee when a nomination is filed and by apply_application_decision when the vote seats it, and it gives
   each reason with the office's next step, which the commissioners' held-up notice uses in a market season;
   team_cap_committed stops reserving the AGM salary on top of the roster in a market season; draft_make_pick, start_draft
   (its seat gate and its no-board refusal) and draft_conclude say what Season 2 does, with no dash. mgmt_salary_of, _draft_auto_advance and generate_draft_board are checked and
   left alone (the reasons are in the record).
   Pins the record (sql/2026-11-24-s2-draft-front-office-v458.sql) and the joint draft-night rehearsal.
   Run: node tools/s2-draft-front-office-v458.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REC = "sql/2026-11-24-s2-draft-front-office-v458.sql";
const sql = R(REC);
const joint = R("sql/2026-11-24-s2-draft-night-joint-v458.rehearsal.sql");
const body = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const rows = [...sql.matchAll(/\((\d+), '(public\.[^']+)', '(\w+)',\s*\$a\$([\s\S]*?)\$a\$,\s*\$s\$([\s\S]*?)\$s\$\)/g)].map((m) => ({ ord: +m[1], fn: m[2], mode: m[3], a: m[4], s2: m[5] }));
const row = (ord) => rows.find((r) => r.ord === ord) || { a: "", s2: "", fn: "", mode: "" };
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const lits = (s) => [...noComments(s).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
const fnBody = (name) => (sql.match(new RegExp("create function public\\." + name + "\\([\\s\\S]*?\\$fn\\$;")) || [""])[0];
const fits = row(1).s2, guard = row(2).s2, decide = row(5).s2, pick = row(6).s2, start = row(7).s2, conclude = row(8).s2,
  advice = row(9).s2, noBoard = row(10).s2;
const left = fnBody("_undrafted_left"), seat = fnBody("_mgmt_nominee_seat_block");

console.log("# the record");
const FNS = ["public.draft_fits(uuid,uuid,uuid)", "public.guard_mgmt_nominee()", "public.team_cap_committed(uuid,integer)",
  "public.apply_application_decision(text,uuid,boolean)", "public.draft_make_pick(uuid,uuid)", "public.start_draft(integer,integer)", "public.draft_conclude(integer)"];
A("ten anchored rows over exactly seven functions, every anchor matched once, seven functions re-created",
  rows.length === 10 && rows.every((r, i) => r.ord === i + 1) && [...new Set(rows.map((r) => r.fn))].join(",") === FNS.join(",") &&
  /if n <> 1 then raise exception 'v4.58: % anchor % found % times'/.test(body) && /if v_fns <> 7 then raise exception/.test(body), rows.map((r) => r.ord + ":" + r.fn).join(" "));
A("each patched function's live definition is saved before the patch", FNS.every((f) => body.includes("'" + f + "'")));
A("it refuses to apply without db-guards' market_on, roster_min_gap and _unused_pick_fills",
  /to_regprocedure\('public\.market_on\(uuid\)'\) is null or to_regprocedure\('public\.roster_min_gap\(uuid,uuid,text,uuid\)'\) is null\s+or to_regprocedure\('public\._unused_pick_fills\(uuid,uuid\)'\) is null then\s+raise exception/.test(body));
A("it creates exactly two functions, the helpers, and nothing outside its section (no season_rules, roster_min_gap, market_on, _unused_pick_fills, waive_player, mgmt_salary_of, _draft_auto_advance, generate_draft_board)",
  (body.match(/create (or replace )?function/gi) || []).length === 2 && /create function public\._undrafted_left\(/.test(body) && /create function public\._mgmt_nominee_seat_block\(/.test(body) &&
  !rows.some((r) => /season_rules\(uuid\)|roster_min_gap\(uuid|market_on\(uuid|_unused_pick_fills\(|waive_player|mgmt_salary_of|_draft_auto_advance|generate_draft_board/.test(r.fn)));
A("both helpers are definers on an empty search_path, revoked from public, anon and authenticated, with no grant",
  [left, seat].every((f) => /security definer\s+set search_path to ''/.test(f)) &&
  /revoke all on function public\._undrafted_left\(uuid, text, uuid\) from public, anon, authenticated;/.test(body) &&
  /revoke all on function public\._mgmt_nominee_seat_block\(uuid, text, uuid\) from public, anon, authenticated;/.test(body) && !/\bgrant execute\b/i.test(body));
A("both patch tables live only for the transaction",
  /create temp table _s2_front_office_before \(k text primary key, v text\) on commit drop;/.test(body) && /create temp table _s2_front_office_patch \([\s\S]*?\) on commit drop;/.test(body));
A("no anchor holds a version placeholder, so numbering the records cannot break a match", rows.every((r) => !/v(NNN|\d{3})\b/.test(r.a)));

console.log("\n# draft_fits");
A("inserted after the roster limit is read, so every other season runs the old text untouched",
  row(1).mode === "after" && row(1).a === "  v_max := (public.season_rules(p_season)->>'roster_max')::int;\n" && /^  \/\* v4.58/.test(fits) && /if public\.market_on\(p_season\) then/.test(fits));
A("the 3/2/1 test comes from roster_min_gap, with the pick's group as the hypothetical add",
  /v_gap := public\.roster_min_gap\(p_season, p_team, v_grp\);/.test(fits) && /public\.roster_min_gap\(p_season, p_team\)->>'short'/.test(fits));
A("a missing count from roster_min_gap is an error, never a silent fit", /if \(v_gap->>'short'\) is null or v_open is null then\s+raise exception/.test(fits));
A("a full roster is refused in the old words", /if v_open < 0 then return 'the active roster is full \(' \|\| v_max \|\| ' players, management included\)'; end if;/.test(fits));
A("a pick in a group that is still short always fits", /if \(v_gap->>'short'\)::int < \(public\.roster_min_gap\(p_season, p_team\)->>'short'\)::int then return null; end if;/.test(fits));
A("D-SUPPLY: a short group counts only while an undrafted player of it is left, the player being judged excluded; none left, the pick fits",
  /foreach v_g in array array\['F', 'D', 'G'\] loop/.test(fits) && /if v_n > 0 and public\._undrafted_left\(p_season, v_g, p_profile\) then\s+v_short := v_short \+ v_n;/.test(fits) &&
  /if v_short = 0 then return null; end if;/.test(fits));
A("D-FILL: the picks left are the unused picks less _unused_pick_fills (the fill's own count) less this one; the current roster is not recounted",
  /not coalesce\(dp\.used, false\)/.test(fits) && /v_picks := greatest\(v_picks - public\._unused_pick_fills\(p_season, p_team\) - 1, 0\);/.test(fits) &&
  !/postdraft_random/.test(noComments(fits)) && /if v_short <= least\(v_open, v_picks\) then return null; end if;/.test(fits));
A("the refusal names only the groups someone is left to fill, and says picks or roster spots by which one binds",
  /'after this pick the club would still need '/.test(fits) && /' to reach the roster minimums, with '/.test(fits) &&
  /case when v_picks <= v_open\s+then case v_picks when 0 then 'no picks left' when 1 then '1 pick left' else v_picks \|\| ' picks left' end\s+else 'only ' \|\| v_open \|\| case when v_open = 1 then ' roster spot left' else ' roster spots left' end end;/.test(fits) &&
  /' defenseman' else ' defensemen'/.test(fits) && /' goaltender' else ' goaltenders'/.test(fits) && /' forward' else ' forwards'/.test(fits) && !/Rule \d/.test(lits(fits).join(" ")));
A("draft_fits stays read-only: no insert, update or delete in the new branch", !/\b(insert|update|delete)\b/i.test(noComments(fits)));

console.log("\n# _undrafted_left (D-SUPPLY)");
A("the players the fill draws from: a sign-up not declined, with no roster history this season, draft-eligible, not suspended or banned, of the group",
  /sr\.season_id = p_season and sr\.status <> 'declined'/.test(left) && /sr\.profile_id is distinct from p_except/.test(left) &&
  /public\.pos_group\(coalesce\(sr\.position::text, 'C'\)::public\.hockey_position\) = p_group/.test(left) &&
  /not exists \(select 1 from public\.roster_tenures rt where rt\.season_id = p_season and rt\.profile_id = sr\.profile_id\)/.test(left) &&
  /public\.is_draft_eligible\(sr\.profile_id, p_season\)/.test(left) && /not public\.is_suspended\(sr\.profile_id\) and not public\.is_banned\(sr\.profile_id\)/.test(left) &&
  /\bstable\b/.test(left));

console.log("\n# the nominee test, at filing and at the vote");
A("one test: staff first, then an Assistant GM only once the draft is complete, then the club's own active non-camp roster from the draft on",
  /returns jsonb\s+language plpgsql/.test(seat) &&
  /if v_sid is null or not public\.market_on\(v_sid\) then return null; end if;/.test(seat) &&
  /if v_role in \('staff', 'commissioner'\) then\s+return jsonb_build_object\(\s+'why', format\('%s is league %s and cannot hold a club management role\. No league office seat, in any department, may be held together with a club seat\.'/.test(seat) &&
  /if p_role = 'agm' and not exists \(select 1 from public\.draft_state d where d\.season_number = v_snum and d\.status = 'complete'\) then\s+return jsonb_build_object\(\s+'why', format\('An Assistant GM is named only after the draft is complete, and only from the club''s own roster\. %s cannot be nominated before then\.'/.test(seat) &&
  /if public\.season_underway\(\) and not exists \(select 1 from public\.roster_spots rs\s+where rs\.season_id = v_sid and rs\.team_id = p_team and rs\.profile_id = p_nominee\s+and rs\.status = 'active' and coalesce\(rs\.squad, 'pro'\) <> 'tc'\) then\s+return jsonb_build_object\(\s+'why', format\('Once the draft starts, a General Manager or Assistant GM is named only from the club''s own active roster, and %s is not on it\.'/.test(seat) &&
  seat.indexOf("v_role in ('staff', 'commissioner')") < seat.indexOf("p_role = 'agm'") && seat.indexOf("p_role = 'agm'") < seat.indexOf("season_underway()"));
A("every reason carries the office's next step beside it, and the roster block's step is to deny it or approve it again only if they return, never to vacate a seat",
  (seat.match(/return jsonb_build_object\(\s+'why', format\(/g) || []).length === 3 && (seat.match(/\n\s+'fix', /g) || []).length === 3 &&
  /'fix', format\('Approve it again once %s has left the league office, or deny it so the club can nominate someone else\.', v_name\)\);/.test(seat) &&
  /'fix', format\('Approve it again once the draft is complete, if %s is then on the club''s own roster; otherwise deny it\.', v_name\)\);/.test(seat) &&
  /'fix', format\('Approve it again only if %s returns to the club''s active roster; otherwise deny it so the club can nominate a player from its own roster\.', v_name\)\);/.test(seat) &&
  !/vacate/i.test(lits(seat).join(" ")));
A("no Media exception and no Season 1 exemption in the test", !/is_media_only_staff|is_role_exempt/.test(noComments(seat) + noComments(guard)));
A("filing: guard_mgmt_nominee raises the test's answer as a check_violation, right after the nominee is read, ahead of the old checks",
  row(2).mode === "after" && /from public\.profiles where id = new\.nominee_id;\n$/.test(row(2).a) && /if public\.market_on\(v_sid\) then/.test(guard) &&
  /declare v_why text := public\._mgmt_nominee_seat_block\(new\.team_id, new\.role::text, new\.nominee_id\)->>'why';/.test(guard) &&
  /if v_why is not null then raise exception '%', v_why using errcode = 'check_violation'; end if;/.test(guard));
A("the vote: apply_application_decision asks the same test again before the seat_block path, only when nothing else blocks and only in a market season",
  row(5).mode === "before" && row(5).a === "      if v_block is not null then\n        v_was := v_app.seat_block;" &&
  /if v_block is null and public\.market_on\(public\.current_season_id\(\)\) then\s+v_block := public\._mgmt_nominee_seat_block\(v_app\.team_id, v_app\.role, v_app\.nominee_id\)->>'why';\s+end if;\n\n$/.test(decide));
A("the held-up notice: in a market season the commissioners get the next step of the nominee test's block, the seat blocks keep 'vacate the seat', no dash; the old sentence stays as the ELSE branch",
  row(9).fn === "public.apply_application_decision(text,uuid,boolean)" && row(9).mode === "replace" &&
  row(9).a === "' Nothing was changed and the nomination is still open \u2014 vacate the seat, then approve it again from the application.'" &&
  /^case when public\.market_on\(public\.current_season_id\(\)\)/.test(advice) && advice.endsWith("else " + row(9).a + " end") &&
  /then ' Nothing was changed and the nomination is still open\. ' \|\|\s+coalesce\(\(select x\.j->>'fix'\s+from \(select public\._mgmt_nominee_seat_block\(v_app\.team_id, v_app\.role, v_app\.nominee_id\) as j\) x\s+where x\.j->>'why' = v_block\),\s+'Vacate the seat, then approve it again from the application\.'\)/.test(advice) &&
  !DASHES.test(advice.replace(row(9).a, "")));
A("the record says why the vote asks again (ensure_manager_rostered moves a spot from any club) and leaves the commissioners' own door alone",
  /finds the nominee's spot on ANY club/.test(sql) && /set_team_manager, the commissioners'\s+(--\s+)?own door, is untouched/.test(sql));

console.log("\n# team_cap_committed");
A("both reservation lines stop reserving the AGM salary in a market season; Owner and GM stay reserved",
  row(3).mode === "replace" && row(4).mode === "replace" &&
  [row(3), row(4)].every((r) => /s\.owner_salary \+ s\.gm_salary \+ s\.agm_salary/.test(r.a) &&
    /s\.owner_salary \+ s\.gm_salary \+ case when public\.market_on\(s\.id\) then 0 else s\.agm_salary end/.test(r.s2)) &&
  /where s\.number = p_season_number\),$/.test(row(3).s2) && /where s\.id = public\.current_season_id\(\)\),$/.test(row(4).s2));
A("the record says why mgmt_salary_of needs no change and does the cap math with Owner $0, GM $0, AGM $2M",
  /mgmt_salary_of needs no change/.test(sql) && /at most \$20\.00M \(an AGM taken in round ten\)/.test(sql) && /\$18\.75M/.test(sql));
A("the board check is recorded: a basic season's board is a random snake, unchanged", /generate_draft_board: checked, unchanged\./.test(sql) && /draft_snake true/.test(sql));

console.log("\n# the draft room's own messages (market seasons only)");
A("draft_make_pick: a late sign-up joins the training camp pool, said before the old depth promise, which stays for other seasons",
  row(6).mode === "before" && /placed on a club as depth after the draft \(Rule 2\.8\)/.test(row(6).a) &&
  /if public\.market_on\(v_season\) then\s+raise exception 'That player isn''t draft-eligible: they signed up after the sign-up cutoff\. They join the training camp pool after the draft\.';\s+end if;\n$/.test(pick));
A("start_draft: the Owner and an approved General Manager, no AGM, with the same list of open seats",
  row(7).mode === "before" && /an Owner, a GM and an AGM/.test(row(7).a) &&
  /if public\.market_on\(\(select s\.id from public\.seasons s where s\.number = p_season_number\)\) then\s+raise exception 'Every club needs its Owner and an approved General Manager seated before the draft can start\. Still open: %',/.test(start) &&
  /from jsonb_array_elements\(public\.draft_management_gaps\(\)\) g\);/.test(start) && !/AGM/.test(lits(start).join(" ")));
A("start_draft with no board: a market season's refusal names the season and the Draft manager's Build the board, with no dash, said before the old words",
  row(10).fn === "public.start_draft(integer,integer)" && row(10).mode === "before" && /build the board first \(Draft manager/.test(row(10).a) &&
  /if public\.market_on\(\(select s\.id from public\.seasons s where s\.number = p_season_number\)\) then\s+raise exception 'Season % has no draft order yet\. Build the board first: open the Draft manager and choose Build the board\.', p_season_number;\s+end if;\n$/.test(noBoard) &&
  !DASHES.test(noBoard) && !/\u2192/.test(noBoard));
A("draft_conclude: a market season's public line has no dash; the old line stays as the ELSE branch",
  row(8).mode === "replace" && /^case when public\.market_on\(v_season\)/.test(conclude) && conclude.includes("else " + row(8).a + " end") &&
  /then case when v_open>0 then ' with '\|\|v_open\|\|' pick'\|\|case when v_open=1 then '' else 's' end\|\|' unused' else '' end/.test(conclude) &&
  !DASHES.test(conclude.replace(row(8).a, "")));

console.log("\n# self-checks");
A("removing the new text gives back each saved live definition exactly", /v_def := replace\(v_def, r\.b, r\.a\);/.test(body) && /changed outside its patch rows/.test(body));
A("SECURITY DEFINER, the search_path pin (with its shortcut marker) and the nominee trigger binding are kept",
  /lost SECURITY DEFINER or its search_path/.test(body) && /tgname = 'guard_mgmt_nominee_ins'/.test(body) &&
  /-- shortcut: these seven definers keep search_path public because their old bodies use unqualified names/.test(sql));
A("the helpers are checked: empty search_path, and no API role may execute them",
  /is not a definer on an empty search_path/.test(body) && /has_function_privilege\('anon', f, 'EXECUTE'\) or has_function_privilege\('authenticated', f, 'EXECUTE'\)/.test(body));
A("Season 1's committed payrolls and every Season 1 draft_fits answer are compared with the values captured before",
  /'cap1'/.test(body) && /'fits1'/.test(body) && /Season 1 committed payrolls changed/.test(body) && /Season 1 draft_fits answers changed/.test(body));
A("Season 2: the committed payroll equals the payroll the cap guard counts, for every club", /team_cap_committed\(c\.id, 2\) is distinct from public\.team_cap_used\(v_s2, c\.id\)/.test(body));
A("the new Season 2 draft_fits branch runs at apply time over every club and sign-up, and fits every pick for a club with no spot",
  /v_m := public\.draft_fits\(v_s2, c\.id, v_p\);/.test(body) && /has no Season 2 spot yet draft_fits refused a pick/.test(body) && /no Season 2 sign-up to try draft_fits on/.test(body));
A("the nominee test runs at apply time: an Assistant GM before the draft is refused, with the office's next step",
  /an Assistant GM before the draft was not refused with its reason and the office''s next step/.test(body) && /coalesce\(v_j->>'fix', ''\) not like 'Approve it again once the draft is complete%'/.test(body));

console.log("\n# the joint rehearsal");
const jbody = joint.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
/* file names may be renumbered and redated at apply time, so the run order is matched on the slug */
A("the run order is spelled out: db-guards, db-waivers' waive hold, this record, then the cases; an applied record is left out",
  /1\. sql\/\d{4}-\d{2}-\d{2}-s2-draft-night-guards-v(?:NNN|\d+)\.sql/.test(joint) && /2\. sql\/\d{4}-\d{2}-\d{2}-s2-waive-hold-v(?:NNN|\d+)\.sql/.test(joint) &&
  /3\. sql\/\d{4}-\d{2}-\d{2}-s2-draft-front-office-v(?:NNN|\d+)\.sql/.test(joint) && /4\. this file/.test(joint) &&
  /A record in steps 1 to 3 that is already applied is left out/.test(joint) && /nothing below matches on a version placeholder/.test(joint) && !/v(NNN|\d{3})\b/.test(jbody));
A("it runs every deferred constraint, then ends in an uncaught REHEARSAL OK raise",
  /\nset constraints all immediate;\n/.test(jbody) && jbody.indexOf("set constraints all immediate;") < jbody.indexOf("do $fin$") &&
  /raise exception 'REHEARSAL OK \(joint draft night\): S0 T7 T1 T2 T3 T4 T5 T6b T6%'/.test(jbody) && /end \$fin\$;\s*$/.test(jbody));
{
  const handlers = [...jbody.matchAll(/exception when others then\s+([^\n]*)/g)].map((m) => m[1]);
  A("every inner handler re-raises anything it did not expect (" + handlers.length + " handlers)",
    handlers.length >= 15 && handlers.every((h) => /^if sqlerrm (<> 'JR_UNDO'|<> '[^']*(?:''[^']*)*'|not like '[^']*(?:''[^']*)*') then raise; end if;$/.test(h)), handlers.filter((h) => !/then raise; end if;$/.test(h)).join(" | "));
}
A("no dblink, no http, no direct Discord call", !/dblink|http_get|net\.http_post|discord_http_post/i.test(jbody));
A("a missing db-waivers piece is reported PENDING, not failed", /PENDING db-waivers: the waive hold is not in this transaction\./.test(jbody));
A("D-ROLLOVER: before any seat, start_next_season runs as a commissioner only while a Season 1 player contract is still open; no contract is expired by hand",
  /if exists \(select 1 from public\.contracts c where c\.status in \('active', 'signed'\) and not coalesce\(c\.is_manager, false\)\s+and c\.start_season < v_s2\.number\) then\s+v_roll := 'S0 rollover modeled: start_next_season\(Season 2\) ' \|\| public\.start_next_season\(v_s2\.id\)::text/.test(jbody) &&
  jbody.indexOf("perform pg_temp.jr_as(v_comm);") < jbody.indexOf("public.start_next_season(v_s2.id)") &&
  jbody.indexOf("public.start_next_season(v_s2.id)") < jbody.indexOf("public._set_team_seat(") &&
  /D-ROLLOVER/.test(joint) && !/update public\.contracts/.test(jbody) && !/c\.status in \('active', 'signed'\)\)\s+order by sr\.created_at/.test(jbody));
A("the exemption holder is noted before the rollover ends the exemptions, and T7d says which way it went, or that none is on file since the rollover",
  jbody.indexOf("select 'exempt', e.profile_id::text") < jbody.indexOf("public.start_next_season(v_s2.id)") && /the rollover ended the exemptions/.test(jbody) &&
  /T7d not tried: no role-conflict exemption is on file \(the Season 2 rollover cleared them on 2026-11-23\)/.test(jbody) && !/T7d PENDING/.test(jbody) &&
  /The commissioner's rollover RAN\s+on production on 2026-11-23/.test(joint));
A("S0: with every seat filled and no board, the draft is refused in Season 2 words, before the board is built",
  /if sqlerrm <> 'Season 2 has no draft order yet\. Build the board first: open the Draft manager and choose Build the board\.' then raise; end if;/.test(jbody) &&
  jbody.indexOf("JOINT FAILED S0: the draft started with no board") > jbody.indexOf("public._set_team_seat(") &&
  jbody.indexOf("JOINT FAILED S0: the draft started with no board") < jbody.indexOf("public.generate_draft_board(2, 10, 'random')"));
A("S0 builds the world on an empty Season 2 only, tries the draft gate before any seat, seats Owner and GM, and checks the board is a ten-round snake paying $18.75M",
  /Season 2 is not empty/.test(jbody) && /Every club needs its Owner and an approved General Manager seated before the draft can start\. Still open: %\(Owner, GM\)%/.test(jbody) &&
  jbody.indexOf("JOINT FAILED S0: the draft started with no seats filled") < jbody.indexOf("public._set_team_seat(") &&
  /public\._set_team_seat\(t\.id, 'owner'/.test(jbody) && /public\._set_team_seat\(t\.id, 'gm'/.test(jbody) &&
  /public\.generate_draft_board\(2, 10, 'random'\)/.test(jbody) && /\(v_meta->>'snake'\)::boolean is not true/.test(jbody) && /<> 18750000/.test(jbody));
A("every nominee draw excludes office holders and fails loudly when empty (office holders are tried only on purpose)",
  /create function pg_temp\.jr_fit\(p_team uuid, p_grp text, p_plain boolean default false\)/.test(jbody) &&
  /v_x := pg_temp\.jr_fit\(null, null, true\);\s+if v_x is null then raise exception 'JOINT FAILED T7/.test(jbody) &&
  /v_p := pg_temp\.jr_fit\(null, null, true\);\s+if v_p is null then raise exception 'JOINT FAILED T5b/.test(jbody) &&
  (jbody.match(/p\.role::text not in \('staff', 'commissioner'\)/g) || []).length >= 4 &&
  /JOINT FAILED T3: % drafted no plain player to nominate/.test(jbody) && /JOINT FAILED T5: no plain player to nominate/.test(jbody));
A("T7: before the draft an AGM is refused, a GM from the sign-ups accepted, a Media-only staffer and an exemption holder refused",
  /JOINT FAILED T7a/.test(jbody) && /T7b a GM from the sign-ups/.test(jbody) && /is_media_only_staff/.test(jbody) && /role_conflict_exemptions/.test(jbody));
A("T1: the exact refusals at the pick door, the round-one salary, a full roster, and roster spots versus picks left",
  /with only 2 roster spots left'/.test(jbody) && /That pick does not fit: after this pick the club would still need 2 defensemen and 1 goaltender/.test(jbody) &&
  /is distinct from 3000000/.test(jbody) && /'the active roster is full \(12 players, management included\)'/.test(jbody) && /to reach the roster minimums, with 1 pick left'/.test(jbody));
A("T1e and T1f (D-SUPPLY): with no undrafted defenseman left a forward fits, and with no pick to spare the refusal names only the goaltender",
  /JOINT FAILED T1e: _undrafted_left does not see the empty defense pool/.test(jbody) && /JOINT FAILED T1e: with no defenseman left, a forward was refused/.test(jbody) &&
  /'after this pick the club would still need 1 goaltender to reach the roster minimums, with no picks left'/.test(jbody));
A("T1h: a late sign-up at the pick door is refused in the Season 2 words",
  /if sqlerrm <> 'That player isn''t draft-eligible: they signed up after the sign-up cutoff\. They join the training camp pool after the draft\.' then raise; end if;/.test(jbody));
A("T2: a timed-out pick is skipped, the draft concludes in Season 2 words, and the owed picks are filled at random at $750K, with no depth placement",
  /public\._draft_auto_advance\(2\)/.test(jbody) && /'The commissioner concluded the draft with 9 picks unused\.'/.test(jbody) && /public\.distribute_unproven_rookies\(true\)/.test(jbody) &&
  /n_fill <> 10 or public\._unused_pick_fills\(v_s2, a\.id\) <> 10/.test(jbody) && /origin = 'postdraft_random' and salary <> 750000/.test(jbody) && /origin = 'depth_random'/.test(jbody));
A("T2b: a fill that leaves the club still counts as made, so a forward is refused for the goaltender it lacks",
  /perform public\.admin_remove_from_roster\(v_p, v_s2\);/.test(jbody) && /JOINT FAILED T2b/.test(jbody));
A("T3 and T4: reachability counts only groups someone is left to fill; a short pool leaves picks empty without raising; the commissioners are told by recipient, not by title",
  /create function pg_temp\.jr_short_live\(p_team uuid\)/.test(jbody) && /public\._undrafted_left\(g\.sid, x\.grp, null\)/.test(jbody) &&
  (jbody.match(/pg_temp\.jr_short_live\(t\.id\) >/g) || []).length === 3 &&
  /picks left empty, nothing raised/.test(jbody) && /a fitting player was left in the pool/.test(jbody) && /undrafted goaltenders gone/.test(jbody) &&
  /owed picks stayed empty and no commissioner was told/.test(jbody) && /n\.profile_id in \(select p\.id from public\.profiles p where p\.role::text = 'commissioner'\)/.test(jbody) &&
  /public\._unused_pick_fills\(v_s2, t\.id\)/.test(jbody));
A("T5b runs right after the draft concludes, while the pool is still full, and before the fill",
  jbody.indexOf("perform public.draft_conclude(2);\n  if (select status") < jbody.indexOf("JOINT FAILED T5b: a GM from the pool was accepted") &&
  jbody.indexOf("JOINT FAILED T5b: a GM from the pool was accepted") < jbody.indexOf("do $t3b$"));
A("T6b: a nominee who left the roster while the vote was open is not seated, not moved back, and the nomination is held with the reason",
  /JOINT FAILED T6b: the vote seated an AGM who had left the roster/.test(jbody) && /JOINT FAILED T6b: the nominee was put back on a roster by the vote/.test(jbody) &&
  /JOINT FAILED T6b: the nomination is not held up with the reason/.test(jbody));
A("T6b: the commissioners' notice, read by recipient and kind, gives the roster block's next step, never 'Vacate the seat', and has no em dash",
  /n\.title = 'Appointment approved but not seated' and n\.type = 'flag' and n\.created_at >= now\(\)/.test(jbody) &&
  /position\(chr\(8212\) in v_note\) > 0 or position\('Vacate the seat' in v_note\) > 0/.test(jbody) &&
  /v_note not like '%Nothing was changed and the nomination is still open\. Approve it again only if % returns to the club''s active roster; otherwise deny it so the club can nominate a player from its own roster\.'/.test(jbody) &&
  /JOINT FAILED T6b: the commissioners were not told the right next step/.test(jbody));
A("T5 and T6: an AGM from another roster refused; the seat replaces the drafted salary and the payroll counts it once",
  /JOINT FAILED T5a/.test(jbody) && /apply_application_decision\('management', v_app, true\)/.test(jbody) &&
  /v_used1 <> v_used0 - v_agm\.salary \+ 2000000 or v_comm1 is distinct from v_used1/.test(jbody) && /pre_seat_salary/.test(jbody) && /> 30000000/.test(jbody));

console.log("\n# writing rules");
A("no em or en dash in the record outside the old text it anchors on (kept as the ELSE branch of each replace row), and none in the joint rehearsal",
  !DASHES.test(rows.filter((r) => r.mode === "replace").reduce((t, r) => t.split(r.a).join(""), sql.replace(/\$a\$[\s\S]*?\$a\$/g, ""))) && !DASHES.test(joint));
A("neutral pronouns in the new text", !/\b(he|his|him|she|her)\b/i.test(rows.map((r) => r.s2).join(" ") + left + seat));
A("American spelling (defensemen, goaltender) and no British forms", /defensemen/.test(fits) && !/\b(defence|centre|cancelled|colour)\b/i.test(sql + joint));
A("no rule numbers in any new message (Season 2 numbers are not settled)", !/Rule \d|Rule S2/.test(lits([fits, guard, pick, start, seat, noBoard, advice.replace(row(9).a, "")].join(" ")).join(" ")));

console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(fail ? 1 : 0);
