/* v463 (DRAFT, applied at the flip): Season 2 staff powers. node tools/s2-staff-powers-v463.test.cjs
   Rulings (memory s2-staffing-model.md): no departments, one staff group (2026-10-19); no Media (2026-10-22); only the
   Draft and Bidding manager has extra powers (2026-11-23); only committee managers and commissioners suspend, up to 14 days
   or 18 games, longer applied for and approved by a commissioner, other staff file requests, bans commissioner only
   (2026-11-23); one staff notifications channel, and ban, unban and lift notices (2026-11-23). Pins the record (the
   patch pairs, the doors, the notices), its reverse (the same pairs undone; the requests kept as the record) and the
   rehearsal that runs both. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;
const comments = (s) => (s.match(/--[^\n]*|\/\*[\s\S]*?\*\//g) || []).join("\n");
const count = (s, needle) => s.split(needle).length - 1;

const REC = "sql/2026-11-24-s2-staff-powers-v463.sql";
const REV = REC.replace(/\.sql$/, ".reverse.sql");
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC), rev = R(REV), reh = R(REH);
const pairsOf = (s) => (s.split("-- >>> patch pairs\n")[1] || "").split("-- <<< patch pairs\n")[0];
const pairs = pairsOf(sql);
const pair = (n) => { const m = pairs.match(new RegExp("\\(" + n + ", '([^']+)', \\$o\\$([\\s\\S]*?)\\$o\\$,\\s*\\$n\\$([\\s\\S]*?)\\$n\\$\\)")); return m ? { fn: m[1], o: m[2], n: m[3] } : { fn: "", o: "", n: "" }; };
const fn = (name) => (sql.match(new RegExp("create or replace function public\\." + name + "\\([^)]*\\)\\n([\\s\\S]*?)\\nend \\$function\\$;")) || [])[1] || "";

console.log("1. The record and the rulings");
A("a DRAFT for the flip, with the all-staff voting record, never before", /^-- v463 \(DRAFT, 2026-11-24; apply at the flip, T\+15, together with the all-staff voting record, never before\)/.test(sql));
A("the rulings are quoted or stated: one group, no Media, the one Draft and Bidding power, the discipline ceilings, one channel",
  /"for Season 2, we will remove the different departments, and we will allow every staff\n--    member to be a part of one big group\./.test(sql) && /"remove the Media staff position from the concept since we will not have that role next season\."/.test(sql)
  && /committee manager may issue up to 14 days, or up to 18 games for a rostered player \("2 weeks worth of games"\)/.test(sql)
  && /Bans\n--    stay commissioner only/.test(sql) && /ONE staff notifications channel/.test(sql));
A("the Netlify statistics gates ask the database, as the note says (tools/s2-staff-gates-v463.test.mjs walks them)",
  /netlify\/functions\/ingest-stats\.js staffActor\n-- calls rpc\/is_stats_staff/.test(sql) && /discord-interactions\.js sbIsStatsStaff calls rpc\/profile_has_department/.test(sql)
  && /rest\/v1\/rpc\/is_stats_staff/.test(R("netlify/functions/ingest-stats.js")) && /sbRpc\("profile_has_department"/.test(R("netlify/functions/discord-interactions.js"))
  && !/departments/.test((R("netlify/functions/ingest-stats.js").match(/async function staffActor\(jwt\) \{[\s\S]*?\n\}/) || [""])[0]));
A("the apply order of the three flip records is written in the header, with the reverse order",
  /-- Apply order at the flip \(one owner per function, so the three records compose\): 1\. this record \(staff powers\),\n-- 2\. sql\/2026-11-24-s2-all-staff-voting-v463\.sql, 3\. sql\/2026-11-24-s2-staff-copy-v463\.sql/.test(sql)
  && /the staff\n-- copy reverse first, the all-staff voting reverse second, and this one last/.test(rev)
  && /'v463 staff powers reverse: the staff copy record still stands; apply its reverse first'/.test(rev));
A("it needs the committees record and refuses a second run", /'v463 staff powers: the committees record \(is_committee_manager, can_run_market\) must be applied first'/.test(sql)
  && /'v463 staff powers: already applied'/.test(sql));

console.log("\n2. The patch pairs");
const nums = [...pairs.matchAll(/^    \((\d+), '/gm)].map((m) => +m[1]);
A("eighteen pairs, in order", nums.join(",") === "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18", nums.join(","));
A("each anchor is asserted to match once and each patch to land once", /if n <> 1 then raise exception 'v463 staff powers: anchor % in % matched % times', r\.ord, r\.fn, n; end if;/.test(sql)
  && /raise exception 'v463 staff powers: patch % in % did not land once', r\.ord, r\.fn;/.test(sql));
const door = (sql.match(/create or replace function public\.profile_has_department\(p_profile uuid, p_key text\)\n[\s\S]*?\n\$function\$;/) || [""])[0];
A("has_department asks the ONE department test, profile_has_department, for the signed-in member (its whole old body is the anchor)",
  pair(1).fn === "public.has_department(text)" && /^  select exists \(\n[\s\S]*p_key = any\(departments\)[\s\S]*\n  \);\n$/.test(pair(1).o)
  && /\n  select public\.profile_has_department\(auth\.uid\(\), p_key\);\n$/.test(pair(1).n) && !/departments/.test(pair(1).n.replace(/\/\*[\s\S]*?\*\//g, "")));
A("profile_has_department: every commissioner, and every staff member not banned and not suspended from staff duties, holds every key but draft, which only the Draft and Bidding manager holds among the staff",
  /\(p\.role = 'commissioner'\n\s+or \(p\.role = 'staff' and not p\.banned and not public\.is_staff_suspended\(p\.id\)\n\s+and \(p_key <> 'draft' or public\.is_committee_manager\(p\.id, 'draft'\)\)\)\)\);/.test(door)
  && /select p_profile is not null and exists \(/.test(door) && /set search_path to ''/.test(door)
  && /revoke all on function public\.profile_has_department\(uuid, text\) from public, anon, authenticated;\ngrant execute on function public\.profile_has_department\(uuid, text\) to service_role;/.test(sql));
A("...its parentheses still balance", (() => { const bal = (s) => (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length; return bal(pair(1).o) === bal(pair(1).n.replace(/\/\*[\s\S]*?\*\//g, "")); })());
A("_is_stats_staff asks has_department instead of reading the departments column", pair(2).fn === "public._is_stats_staff()" && /^public\.has_department\('statistics'\)/.test(pair(2).n));
A("the Media helpers answer false, and nothing else in them changes", pair(3).fn === "public.is_media_staff(uuid)" && pair(4).fn === "public.is_media_only_staff(uuid)"
  && [3, 4].every((i) => pair(i).n.replace(/      and false   \/\*[^\n]*\*\/\n/, "") === pair(i).o));
A("notify_department bells every staff member who is not banned, and every commissioner",
  pair(5).fn === "public.notify_department(text,text,text,text,text,text)" && /^        or \(role = 'staff' and not banned\)   \/\*/.test(pair(5).n));
A("the department test reads the ban: a banned staffer keeps the role but holds no key",
  /not p\.banned/.test(door) && /or public\.profile_has_department\(v_banned, 'statistics'\) then/.test(sql)
  && /'v463 staff powers: a banned staffer holds a department key'/.test(sql) && /where p\.role = 'staff' and not p\.banned and not public\.is_staff_suspended\(p\.id\) and not public\.is_any_committee_manager\(p\.id\)/.test(sql));
A("notify_staff_ch posts every channel name to #staff-casework, the general webhook still the fallback",
  pair(6).fn === "public.notify_staff_ch(text,text,boolean)" && /key = 'discord_staff_casework_webhook' and value <> ''/.test(pair(6).n) && !/p_channel/.test(pair(6).n.replace(/\/\*[\s\S]*?\*\//g, "")));
A("_issue_suspension: a suspension needs a committee manager or a commissioner; a warning does not",
  pair(7).fn.startsWith("public._issue_suspension(") && /if coalesce\(p_mode, ''\) <> 'warning' and not v_commish and not public\.is_any_committee_manager\(v_uid\) then/.test(pair(7).n));
A("...18 games in steps of three stays; the date ceiling drops to 14 days (15 with the old day of slack)",
  /in steps of three games, up to 18 \(3, 6, 9, 12, 15 or 18\)\. Anything longer is applied for: file a suspension request and a commissioner approves it\./.test(pair(8).n)
  && /if v_end > public\.manager_date_ceiling\(now\(\)\) then/.test(pair(9).n) && /interval '31 days'/.test(pair(9).o));
A("the 14-day ceiling has ONE definition, measured from the suspension's start (15 days with the old day of slack)",
  /create or replace function public\.manager_date_ceiling\(p_start timestamptz\)\n[\s\S]*?  select p_start \+ interval '15 days';\n\$function\$;/.test(sql)
  && count(sql.replace(/\$o\$[\s\S]*?\$o\$/g, ""), "interval '15 days'") === 1);
A("extend_suspension: the same gate and the same ceilings", pair(10).fn.startsWith("public.extend_suspension(") && /if not v_commish and not public\.is_any_committee_manager\(auth\.uid\(\)\) then/.test(pair(10).n)
  && /to a total of 18 at most\. Anything longer is applied for/.test(pair(11).n)
  && /if not v_commish and v_new > public\.manager_date_ceiling\(s\.created_at\) then/.test(pair(12).n)
  && /'A committee manager can extend a dated suspension to at most 14 days from the day it was issued\./.test(pair(12).n));
A("lift_suspension: a committee manager or a commissioner, and a staff member withdraws a warning they gave",
  pair(13).fn === "public.lift_suspension(uuid)"
  && /if not \(public\.is_commissioner\(\) or public\.is_any_committee_manager\(auth\.uid\(\)\)\n\s+or \(s\.mode = 'warning' and s\.created_by = auth\.uid\(\) and public\.is_staff\(\)\)\) then/.test(pair(13).n));
A("withdraw_registration posts through notify_staff_ch (the one staff channel), its direct post anchored with chr() for the emoji and dash",
  pair(14).fn === "public.withdraw_registration(uuid)" && /discord_http_post\(url := v_hook/.test(pair(14).o)
  && /\$o\$ \|\| chr\(8617\) \|\| chr\(65039\) \|\| \$o\$/.test(pairs) && /'\$o\$ \|\| chr\(8212\) \|\| \$o\$'/.test(pairs)
  && /  perform public\.notify_staff_ch\(null, '\*\*Sign-up withdrawn\*\*: ' \|\| v_name/.test(pair(14).n) && !/discord_http_post|v_hook is not null/.test(pair(14).n));
A("guard_appeal_decider: only a committee manager (or a commissioner, who returned earlier) decides an appeal",
  pair(15).fn === "public.guard_appeal_decider()" && /has_department\('community'\)/.test(pair(15).o) && /has_department\('officiating'\)/.test(pair(15).o)
  && /  if not public\.is_any_committee_manager\(auth\.uid\(\)\) then\n    raise exception 'A committee manager or a commissioner decides an appeal \(Rule 7\.6\)\.';/.test(pair(15).n));
A("a self-check refuses any other function that reads a staff webhook itself",
  /p\.prosrc like '%discord\\_staff\\_%webhook%'/.test(sql) && /'v463 staff powers: a function reads a staff webhook itself instead of posting through notify_staff_ch'/.test(sql));
A("every new text carries the version and none keeps an em dash", nums.every((i) => /v463/.test(pair(i).n) || [8, 11, 17, 18].includes(i)) && !DASHES.test(pairs));
A("a committee manager's second suspension of a season never becomes the rest of the season silently: refused unless the length is kept; a commissioner's is unchanged",
  pair(16).fn.startsWith("public._issue_suspension(") && pair(16).o === "      v_mode := 'seasons'; v_until := v_snum; v_auto := true;\n"
  && /      if not v_commish then\n        raise exception '% was already suspended this season, so a second suspension runs for the rest of the season unless the official sets a shorter length \(Rule 7\.2\)\. Keep the length you set, up to 14 days or 18 games, or file a suspension request for the rest of the season and a commissioner decides it\.', v_gt;\n      end if;\n      v_mode := 'seasons'; v_until := v_snum; v_auto := true;\n$/.test(pair(16).n));
A("an appeal by a member of league staff is a commissioner's (Rule 7.6), with no season branch",
  /  if exists \(select 1 from public\.profiles p\n\s+where p\.id in \(new\.profile_id, s\.profile_id\) and p\.role::text in \('staff', 'commissioner'\)\) then\n    raise exception 'An appeal by a member of league staff is decided by a commissioner \(Rule 7\.6\)\.';/.test(pair(15).n)
  && !/season/.test(pair(15).n.replace(/\/\*[\s\S]*?\*\//g, "")));
A("the extension refusals point at the extension request, which now exists; no department named in any new message",
  /file a suspension request to extend it, and a commissioner approves it \(Rule 7\.2\)/.test(pair(11).n) && /file a suspension request to extend it, and a commissioner approves it \(Rule 7\.2\)/.test(pair(12).n)
  && /a request against a member who is serving a suspension asks to extend it/.test(pair(10).n)
  && /The officiating department extends it/.test(pair(17).o) && /a committee manager or a commissioner extends it/.test(pair(17).n)
  && nums.every((i) => !/department/.test((pair(i).n.match(/'[^']*'/g) || []).join(" "))));
A("the bans stay a commissioner's: no gate pair touches ban_player or unban_player", !/ban_player|unban_player/.test(pairs));

console.log("\n3. The doors and the notices");
A("is_any_committee_manager rests on is_committee_manager (the seat with its power)",
  /select exists \(select 1 from public\.committees c where public\.is_committee_manager\(p_profile, c\.key\)\);/.test(sql));
const req = fn("request_suspension"), dec = fn("decide_suspension_request"), wd = fn("withdraw_suspension_request");
A("request: the scope and the case are checked in plain words, and a staff-duties request names a staffer",
  /if v_scope not in \('play', 'staff', 'both'\) then/.test(req) && /'SUSPENSION REQUEST: That case was not found\.'/.test(req)
  && /'SUSPENSION REQUEST: A suspension from staff duties is only for a member of league staff\.'/.test(req));
A("request: any staff member or commissioner, never against themselves, grounds required; managers and commissioners told",
  /if not \(public\.is_staff\(\) or public\.is_commissioner\(\)\) then/.test(req) && /You can''t file one against yourself\./.test(req)
  && /'SUSPENSION REQUEST: Say why\. A suspension has to state its grounds \(Rule 7\.6\)\.'/.test(req)
  && /perform public\.notify_commissioners\(array\[v_uid\], 'flag', 'Suspension request',/.test(req) && /public\.is_committee_manager\(c\.manager_profile_id, c\.key\)/.test(req));
A("decide: a committee manager or a commissioner; the suspension is issued by _issue_suspension under the decider",
  /if not \(public\.is_commissioner\(\) or public\.is_any_committee_manager\(v_uid\)\) then/.test(dec)
  && /v_susp := public\._issue_suspension\(v_req\.profile_id, v_req\.mode, v_req\.games, v_req\.ends_at, v_req\.until_season,\n\s+v_req\.reason, v_req\.reason_codes, v_req\.scope, true, v_req\.case_id\);/.test(dec)
  && !/interval '1[45] days'/.test(dec));
A("decide: a manager never decides a request about themselves, one they filed, one about staff or a commissioner, or one past the ceiling, approve AND deny",
  ["'SUSPENSION REQUEST: This request is about you, so a commissioner decides it.'",
   "'SUSPENSION REQUEST: You filed this request, so another committee manager or a commissioner decides it.'",
   "'SUSPENSION REQUEST: Only a commissioner decides a request about league staff or a commissioner (Rule 7.2).'",
   "'SUSPENSION REQUEST: This request is past a committee manager''s limit (14 days or 18 games), so a commissioner decides it.'"].every((m) => dec.indexOf(m) > 0)
  && dec.indexOf("if not public.is_commissioner() then") < dec.indexOf("if p_approve then")
  && /> public\.manager_date_ceiling\(now\(\)\)\)\)\)\n/.test(dec) && /-- shortcut: the 18-game ceiling is written here as in _issue_suspension and extend_suspension/.test(dec)
  && /if p_approve is null then raise exception 'SUSPENSION REQUEST: Choose approve or deny\.'; end if;/.test(dec));
A("decide: a denial needs a reason; every decision checks its row count and writes an audit row",
  /'SUSPENSION REQUEST: Say why it is denied\. The staff member who filed it is told\.'/.test(dec) && /get diagnostics v_n = row_count;\n  if v_n <> 1 then raise exception/.test(dec)
  && /'suspension_request_approved' else 'suspension_request_denied'/.test(dec));
A("decide: an approval issues EXACTLY the approved length (p_keep_length true), and an extension request extends the running suspension through extend_suspension",
  /, v_req\.scope, true, v_req\.case_id\);/.test(dec) && !/, v_req\.scope, false, /.test(dec)
  && /    if v_req\.extends_id is not null then\n      perform public\.extend_suspension\(v_req\.extends_id, v_req\.games, v_req\.days, v_req\.reason\);\n      v_susp := v_req\.extends_id;/.test(dec));
A("decide: an extension past the ceiling (18 games in all, or 14 days from the day the running one was issued) is a commissioner's",
  /or \(v_req\.mode = 'games' and coalesce\(v_ext\.games_total, 0\) \+ coalesce\(v_req\.games, 0\) > 18\)/.test(dec)
  && /at time zone 'America\/New_York'\) > public\.manager_date_ceiling\(v_ext\.created_at\)\)\)\) then/.test(dec));
A("request: against a member serving a suspension it is an extension in that suspension's terms (one at a time), never of a departure suspension, picked by a unique sort",
  /and coalesce\(s\.grounds, ''\) <> 'departure' and public\.suspension_running_at\(s, now\(\)\)\n   order by s\.created_at desc, s\.id desc\n   limit 1;/.test(req)
  && /is serving a suspension counted in %, so this request extends it \(one suspension at a time, Rule 7\.2\): %\./.test(req)
  && /v_days := \(p_ends_at at time zone 'America\/New_York'\)::date - \(v_ext\.ends_at at time zone 'America\/New_York'\)::date;/.test(req)
  && /'SUSPENSION REQUEST: Say why it should be extended\. The member is told the reason\.'/.test(req)
  && /days integer check \(days is null or days > 0\),\n  extends_id uuid references public\.suspensions\(id\) on delete set null,/.test(sql));
A("request: games go in steps of three (commissioner, 2026-11-23)", /if p_mode = 'games' and p_games % 3 <> 0 then\n    raise exception 'SUSPENSION REQUEST: Ask in steps of three games \(3, 6, 9 and so on; Rule 7\.2\)\.';/.test(req));
A("withdraw: only the filer, only while pending", /'SUSPENSION REQUEST: Only the staff member who filed it may withdraw it\.'/.test(wd) && /This request is %, so there is nothing to withdraw\./.test(wd));
A("suspension_requests: RLS on, staff and commissioners read, written only through the doors",
  /alter table public\.suspension_requests enable row level security;\nrevoke all on table public\.suspension_requests from public, anon, authenticated;\ngrant select on table public\.suspension_requests to authenticated;/.test(sql)
  && /using \(public\.is_staff\(\) or public\.is_commissioner\(\)\);/.test(sql));
A("ban, unban and lift notices: one trigger each, through notify_staff_ch (no pings), the lift only on active to lifted",
  /create trigger notify_ban_event_trg after insert on public\.ban_events\n  for each row execute function public\.notify_ban_event\(\);/.test(sql)
  && /create trigger notify_suspension_lifted_trg after update of status on public\.suspensions\n  for each row when \(old\.status = 'active' and new\.status = 'lifted'\)/.test(sql)
  && count(sql, "perform public.notify_staff_ch(null,") === 3 && !/discord_http_post|net\.http/.test(sql.replace(/\$o\$[\s\S]*?\$o\$/g, "")));
const banBlock = (s) => (s.match(/do \$ban\$\n([\s\S]*?)\nend \$ban\$;/) || [])[1] || "";
const codeOf = (s) => s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "");
A("ban_events.by is renamed actor_id before the notice trigger reads it (BY is reserved in PL/pgSQL: the 2026-11-24 rehearsal)",
  sql.indexOf("alter table public.ban_events rename column by to actor_id;") > 0
  && sql.indexOf("alter table public.ban_events rename column by to actor_id;") < sql.indexOf("create or replace function public.notify_ban_event()")
  && /where p\.id = new\.actor_id;/.test(fn("notify_ban_event")) && !/\bnew\.by\b/.test(codeOf(sql)) && !/\bnew\.by\b/.test(codeOf(reh)));
A("...ban_player and unban_player change only their insert's column list, asserted once each way, and the reverse undoes it with the same strings",
  /v_old text := 'insert into public\.ban_events\(profile_id, action, reason, by\) values \(';\n  v_new text := 'insert into public\.ban_events\(profile_id, action, reason, actor_id\) values \(';/.test(banBlock(sql))
  && banBlock(sql).split("begin\n")[0] === banBlock(rev).split("begin\n")[0]
  && /foreach v_f in array array\['public\.ban_player\(uuid,text\)', 'public\.unban_player\(uuid\)'\] loop/.test(banBlock(sql))
  && /execute replace\(v_def, v_old, v_new\);/.test(banBlock(sql)) && /execute replace\(v_def, v_new, v_old\);/.test(banBlock(rev))
  && rev.indexOf("alter table public.ban_events rename column actor_id to by;") > rev.indexOf("end $ban$;")
  && rev.indexOf("end $ban$;") > rev.indexOf("drop trigger if exists notify_ban_event_trg on public.ban_events;")
  && /'v463 staff powers: ban_events\.by was not renamed actor_id everywhere'/.test(sql) && /'v463 staff powers reverse: ban_events\.actor_id did not go back to by'/.test(rev));
const PLPGSQL_RESERVED = "all|begin|by|case|declare|else|end|execute|for|foreach|from|if|in|into|loop|not|null|or|strict|then|to|using|when|while";
A("no PL/pgSQL reserved word is read as a record field in the three files (new.by was the 2026-11-24 failure)",
  [sql, rev, reh].every((t) => !new RegExp("\\b(new|old|v_req|r|s)\\.(" + PLPGSQL_RESERVED + ")\\b", "i").test(codeOf(t).replace(/'[^']*'/g, "''"))));
A("the doors have no anon grant; the internals and trigger functions no client grant", /grant execute on function public\.request_suspension\([^)]*\) to authenticated, service_role;/.test(sql)
  && !/grant execute on function public\.notify_(ban_event|suspension_lifted)/.test(sql));
A("self-checks cover the definers, the grants, the table, the triggers, the channel and a staff member's keys",
  ["must be SECURITY DEFINER with search_path", "a door carries the wrong EXECUTE grant", "suspension_requests carries the wrong API privileges",
   "a notice trigger is missing", "notify_staff_ch still routes by channel", "does not hold every key but draft", "the Media helpers still answer"].every((t) => sql.indexOf(t) > 0));

console.log("\n4. The reverse");
A("the reverse carries the forward record's patch pairs byte for byte", pairsOf(rev) === pairs && pairs.length > 1000);
A("...undone by exact anchor, last first, each asserted once both ways", /\) as x\(ord, fn, old_text, new_text\) order by x\.ord desc loop/.test(rev)
  && /execute replace\(v_def, r\.new_text, r\.old_text\);/.test(rev) && /'v463 staff powers reverse: anchor % in % did not come back once'/.test(rev));
A("the notices and the doors are dropped, and is_any_committee_manager and profile_has_department last (after has_department reads departments again)", rev.indexOf("drop function public.notify_ban_event();") > 0
  && rev.indexOf("drop function public.is_any_committee_manager(uuid);") > rev.indexOf("end $rev$;")
  && rev.indexOf("drop function public.profile_has_department(uuid, text);") > rev.indexOf("end $rev$;"));
A("the requests are kept as the record, with no API access", /revoke all on table public\.suspension_requests from anon, authenticated;/.test(rev) && !/drop table/i.test(rev)
  && /'v463 staff powers reverse: suspension_requests is still reachable through the API'/.test(rev));

console.log("\n5. The rehearsal");
const part = (m1, m2) => (reh.split(m1)[1] || "").split(m2)[0];
A("it carries the record byte for byte", part("-- >>> record text: " + REC + "\n", "-- <<< record text\n") === sql.replace(/\n?$/, "\n"));
A("it carries the reverse byte for byte, after the cases", part("-- >>> reverse text: " + REV + "\n", "-- <<< reverse text\n") === rev.replace(/\n?$/, "\n")
  && reh.indexOf("-- >>> reverse text") > reh.indexOf("S9a failed"));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("its prerequisites are stated and checked first", /^-- Prerequisites: the committees record/m.test(reh)
  && reh.indexOf("'REHEARSAL CANNOT RUN: the committees record must be live, or its text pasted right after begin'") < reh.indexOf("-- >>> record text"));
A("the fingerprint is taken before the record and compared after the reverse", reh.indexOf("perform set_config('rh.fp'") < reh.indexOf("-- >>> record text")
  && reh.indexOf("<> current_setting('rh.fp') then") > reh.indexOf("-- <<< reverse text"));
A("the people are picked without banned staffers, and S10 counts every staff member who is not banned",
  /select p\.id into v_n from public\.profiles p where p\.role = 'staff' and not p\.banned and not public\.is_staff_suspended\(p\.id\)/.test(reh)
  && /select p\.id into v_g from public\.profiles p where p\.role = 'staff' and not p\.banned and not public\.is_staff_suspended\(p\.id\) and p\.id <> v_n/.test(reh)
  && /where p\.role = 'commissioner' or \(p\.role = 'staff' and not p\.banned\)\)::text, true\);/.test(reh));
A("the fingerprint covers ban_player, unban_player and the ban_events columns, before and after",
  count(reh, "'public.ban_player(uuid,text)', 'public.unban_player(uuid)']) f)") === 2
  && count(reh, "where a.attrelid = 'public.ban_events'::regclass and a.attnum > 0 and not a.attisdropped)") === 2);
A("the ban goes through ban_player and the role seat through the committee doors (the real doors)",
  /perform public\.ban_player\(current_setting\('rh\.x1'\)::uuid, 'Rehearsal ban reason\.'\);/.test(reh) && /public\.apply_committee_seat\(current_setting\('rh\.key'\)/.test(reh)
  && /public\.override_application_decision\('committee', current_setting\('rh\.g_app'\)::uuid, true\)/.test(reh));
A("expected refusals re-raise anything else", count(reh, "exception when others then\n    if sqlerrm") + count(reh, "exception when others then\n  if sqlerrm") === count(reh, "exception when others then")
  && count(reh, "exception when others then") === 22
  && !/when others then\s*\n\s*null/.test(reh));
A("webhook URLs are compared in SQL and never printed", !/raise (exception|notice)[^;]*(v_cw|v_wel|v_gen)/.test(reh));
A("every case is checked", ["S1 failed", "S2a failed", "S2b failed", "S5a failed", "S5b failed", "S5c failed", "S6a failed", "S7a failed", "S7b failed",
  "S7c failed", "S7d failed", "S7e failed", "S7f failed", "S7g failed", "S7h failed", "S9a failed", "S9b failed", "S9c failed", "S10 failed",
  "S11 failed", "S12a failed", "S12b failed", "S12c failed", "S5d failed", "S7i failed", "S7j failed", "S7k failed", "S7l failed", "S7m failed",
  "S13a failed", "S13b failed", "S9d failed", "S6c or S13 failed", "S8 failed", "S14 failed", "S14a failed", "S14b or S15b failed",
  "S15a failed", "S15b failed", "S16a failed", "S16b failed", "S16c failed", "S16d failed", "S16e failed", "S17a failed", "S17b failed",
  "S18 failed", "S12d failed"].every((t) => reh.indexOf(t) > 0));
A("S14 to S18 run as the real people through the real doors, and the fixes are proved on the rows",
  /public\.suspend_player\(current_setting\('rh\.x1'\)::uuid, 'date', now\(\) \+ interval '5 days', null,\n    'Rehearsal: second, length kept\.', null, 'play', true\)/.test(reh)
  && /public\.decide_suspension_request\(current_setting\('rh\.r10'\)::uuid, true, null\)/.test(reh)
  && /values \(current_setting\('rh\.n'\)::uuid, 'appeal', 'commissioner', 'Rehearsal staff appeal\.', current_setting\('rh\.s6'\)::uuid\)/.test(reh)
  && /from public\.suspensions s where s\.id = current_setting\('rh\.s2'\)::uuid\) <> 7/.test(reh)
  && reh.indexOf("-- S14 to S18") > reh.indexOf("S9a failed") && reh.indexOf("-- S14 to S18") < reh.indexOf("-- >>> reverse text"));
A("S13 runs the appeal through the table door under RLS, then lifts it as the deciding manager",
  /insert into public\.action_requests \(profile_id, type, route, details, suspension_id\)/.test(reh) && /perform public\.lift_suspension\(current_setting\('rh\.s3'\)::uuid\);/.test(reh));
A("the verdict block has no handler and ends in the uncaught REHEARSAL OK",
  /do \$v\$\nbegin\n(?:(?!exception when)[\s\S])*raise exception 'REHEARSAL OK: [^']*',\n[^;]*;\nend \$v\$;\n$/.test(reh));
A("no dblink, no http call, no member named (a patch's old text aside)", !/dblink|http_get|http_post\(/i.test(reh.replace(/\$o\$[\s\S]*?\$o\$/g, "")) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));
A("S9c and S9d find their queued rows by their own text, never by the newest id", !/select max\(q\.id\) into/.test(reh)
  && /like '%Rehearsal: one channel\.%'/.test(reh) && /like '%Sign-up withdrawn%'/.test(reh));

console.log("\n6. Words");
A("no dashes in any of the three files", !DASHES.test(sql) && !DASHES.test(rev) && !DASHES.test(reh));
A("no spaced hyphens or gendered pronouns in the new comments and messages",
  [sql, rev, reh].every((s) => !/ - /.test(comments(s)) && !GENDERED.test(comments(s))) && !GENDERED.test(pairs.replace(/\$o\$[\s\S]*?\$o\$/g, "")));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
