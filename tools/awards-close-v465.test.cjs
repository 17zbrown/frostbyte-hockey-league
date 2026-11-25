/* v465: the voted awards close, and are decided and announced, at the next season's owner application deadline.
   node tools/awards-close-v465.test.cjs
   Commissioner, 2026-11-25: "set the award announcement date to be the same date as the owner application deadline".
   Pins the record (awards_close_at, the ballot guard's close, the one decision shared by Finalize and the close, the close
   and its once-only commissioner bell, the refusals before the close and of a decided award, the every-minute awards-close
   job and its watchdog line, the grants and the self-checks), its
   rehearsal (the record byte for byte, the cases, the uncaught verdict), Rule 9.2 as the rendered book reads it, the swept
   copies of the old wording, and the Season 2 site copy (M.awardsCloseAt, the ballot's close, the Control Center). The
   pages themselves are driven in tools/ui/awards.test.cjs, control.test.cjs and fixround.test.cjs. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;
const count = (s, a) => s.split(a).length - 1;
const before = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0 && s.indexOf(a) < s.indexOf(b);

const REC = "sql/2026-11-25-awards-close-v465.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC), reh = R(REH);
const fn = (name) => { const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([^)]*\\)\\n([\\s\\S]*?)\\$function\\$\\n([\\s\\S]*?)\\$function\\$;")); return m ? { head: m[1], body: m[2] } : { head: "", body: "" }; };
const DEFINER = (f) => /security definer\n set search_path to ''\nas $/.test(f.head);

console.log("1. The ruling");
A("the header quotes the commissioner word for word", sql.includes('"set the award announcement date to be the same date as the owner application deadline"'));
A("the header names the kept rulings: the most eligible votes wins, a commissioner decides only a tie (Q37, Q38)", /v3\.60, Q37/.test(sql) && /\(Q38, Rule 9\.2\)/.test(sql));
A("the header says why its own job and not a deadline-sweep step", /Its own job, not a step of\n--\s+deadline-sweep/.test(sql) && /an awards failure would roll back the deadline's trade cancellations/.test(sql));

console.log("\n2. awards_close_at: the ONE time");
const close = fn("awards_close_at");
A("a stable SQL function, SECURITY DEFINER with search_path ''", /^ returns timestamptz\n language sql\n stable\n/.test(close.head) && DEFINER(close));
A("it reads the next season's owner_app_deadline and nothing else", /select n\.owner_app_deadline\n\s+from public\.seasons s join public\.seasons n on n\.number = s\.number \+ 1\n\s+where s\.id = p_season/.test(close.body));
A("revoked from every client role, then granted to anon and authenticated (the site may show it)",
  sql.includes("revoke all on function public.awards_close_at(uuid) from public, anon, authenticated;\ngrant execute on function public.awards_close_at(uuid) to anon, authenticated;"));
const words = fn("_awards_close_words");
A("_awards_close_words: the close said once, '11:59 PM ET on Saturday, November 28', no client grant",
  /^ returns text\n language sql\n stable\n set search_path to ''\nas $/.test(words.head)
  && words.body.includes("select to_char(p_at at time zone 'America/New_York', 'FMHH12:MI AM') || ' ET on '\n      || to_char(p_at at time zone 'America/New_York', 'FMDay, FMMonth FMDD')")
  && sql.includes("revoke all on function public._awards_close_words(timestamptz) from public, anon, authenticated;") && !/grant execute on function public\._awards_close_words/.test(sql));

console.log("\n3. The ballot guard closes the vote");
const guard = fn("guard_award_ballot");
A("the trigger function is SECURITY DEFINER with search_path '' and no client grant", DEFINER(guard) && sql.includes("revoke all on function public.guard_award_ballot() from public, anon, authenticated;") && !/grant execute on function public\.guard_award_ballot/.test(sql));
A("after the close no vote is cast or changed, saying when the vote closed and citing Rule 9.2 (true for a tie still waiting too), errcode 22023",
  /v_close := public\.awards_close_at\(new\.season_id\);\n\s+if v_close is not null and now\(\) >= v_close then/.test(guard.body)
  && guard.body.includes("raise exception 'The Season % vote closed at % (Rule 9.2).', v_num, public._awards_close_words(v_close)\n      using errcode = '22023';")
  && !/; the awards are decided\./.test(sql));
A("the close is checked right after the category, before every other refusal",
  before(guard.body, "That award is not decided by a vote (Rule 9.2).", "v_close := public.awards_close_at") && before(guard.body, "vote closed at % (Rule 9.2).", "That award has been decided; the vote is closed."));
/* before the close, unchanged: every refusal the production guard raised (read 2026-11-25) is still there, word for word */
["'That award has been decided; the vote is closed.'", "'A vote for yourself is not counted (Rule 9.2).'", "'Only a player on a club this season can be voted for.'",
  "'% plays for your own club; a vote goes to a player on another club (Rule 9.2).'", "'% is not rostered as a goaltender.'", "'% is not rostered as a defenseman.'",
  "'% is not in their first CGHL season (Rule 9.1).'"].forEach((m) => A("before the close, unchanged: " + m, count(guard.body, m) === 1));
A("every name the guard reads is schema-qualified", !/\bfrom (?!public\.)[a-z_]+\b/.test(guard.body.replace(/from \(\n/g, "")) && /new\.updated_at := now\(\);\n\s+return new;/.test(guard.body));

console.log("\n4. One decision, shared by Finalize and the close");
const leaders = fn("_award_leaders"), label = fn("_award_label"), fin = fn("_finalize_season_award"), door = fn("finalize_season_award"), cls = fn("close_season_awards");
A("_award_leaders: the playoff-eligible players with the most votes (Rule 9.3), no client grant",
  DEFINER(leaders) && /public\.award_eligible\(p_season, b\.profile_id\)/.test(leaders.body) && /select t\.profile_id, t\.n from t where t\.n = \(select max\(t2\.n\) from t t2\)/.test(leaders.body)
  && sql.includes("revoke all on function public._award_leaders(uuid, text) from public, anon, authenticated;"));
A("_award_label: the four names written once, no client grant", /'mvp' then 'Most Valuable Player' when 'best_goalie' then 'Best Goaltender'/.test(label.body)
  && /'best_defenseman' then 'Best Defenseman' when 'rookie_of_year' then 'Rookie of the Year'/.test(label.body) && sql.includes("revoke all on function public._award_label(text) from public, anon, authenticated;"));
A("_finalize_season_award: SECURITY DEFINER, search_path '', revoked from every client role", DEFINER(fin) && sql.includes("revoke all on function public._finalize_season_award(uuid, text, uuid, text) from public, anon, authenticated;")
  && !/grant execute on function public\._finalize_season_award/.test(sql));
A("it knows two deciders, the commissioner and the close", fin.body.includes("if p_by is null or p_by not in ('commissioner', 'close') then"));
A("no award is decided before its vote closes, by either caller: a season with no next owner deadline and an open vote are refused 22023, saying when (Rule 9.2)",
  fin.body.includes("v_close := public.awards_close_at(p_season);")
  && fin.body.includes("raise exception 'The Season % vote closes when Season % owner applications close, and that deadline is not set yet; no award is decided before then (Rule 9.2).',")
  && fin.body.includes("raise exception 'The Season % vote closes at %; no award is decided before then (Rule 9.2).', v_num, public._awards_close_words(v_close)")
  && before(fin.body, "Unknown award category", "v_close := public.awards_close_at(p_season);") && before(fin.body, "if now() < v_close then", "pg_advisory_xact_lock"));
A("one decision at a time per award, and once: the close leaves a decided award, a commissioner is refused it (never a second story)",
  fin.body.includes("perform pg_advisory_xact_lock(hashtext('award ' || p_season::text || ' ' || p_category));")
  && before(fin.body, "pg_advisory_xact_lock", "if exists (select 1 from public.awards a where a.season_id = p_season and a.week is null and a.category = p_category) then\n    if p_by = 'close' then return null; end if;\n    raise exception 'That award has been decided.' using errcode = '22023';")
  && before(fin.body, "raise exception 'That award has been decided.'", "public._award_leaders(p_season, p_category)") && !/if p_by = 'close' and exists/.test(fin.body));
A("the decision reads the one leader list and keeps every message of the production door",
  count(fin.body, "public._award_leaders(p_season, p_category)") === 3
  && fin.body.includes("raise exception 'Unknown award category: %', p_category;")
  && fin.body.includes("raise exception 'No votes for an eligible player in % yet.', p_category;")
  && fin.body.includes("raise exception 'The % vote is tied at the top; pick one of the tied players to break it.', p_category;")
  && fin.body.includes("raise exception 'The winner is the eligible player with the most votes; a commissioner picks only to break a tie.';"));
A("the awards row by the ballot, the story in the production words, the audit row with who decided",
  fin.body.includes("values (p_season, null, p_category, v_winner, v_team, 'ballot')") && fin.body.includes("on conflict (season_id, week, category) do update")
  && fin.body.includes("v_name || ' wins ' || v_label || ', decided by a vote of the league''s players and staff. Season hardware lives on the Awards page.'")
  && fin.body.includes("jsonb_build_object('winner',v_name,'season',p_season,'by',p_by)") && fin.body.includes("v_label := public._award_label(p_category);"));
A("finalize_season_award: same signature, the commissioner check and its message, then the one decision",
  /^ returns text\n/.test(door.head) && DEFINER(door) && sql.includes("create or replace function public.finalize_season_award(p_season uuid, p_category text, p_winner uuid default null)")
  && before(door.body, "if not public.is_commissioner() then raise exception 'Only a commissioner can finalize an award.'; end if;", "return public._finalize_season_award(p_season, p_category, p_winner, 'commissioner');"));
A("finalize_season_award keeps its grant: authenticated only", sql.includes("revoke all on function public.finalize_season_award(uuid, text, uuid) from public, anon, authenticated;\ngrant execute on function public.finalize_season_award(uuid, text, uuid) to authenticated;"));

console.log("\n5. The close");
A("close_season_awards: SECURITY DEFINER, search_path '', revoked from every client role", DEFINER(cls) && sql.includes("revoke all on function public.close_season_awards() from public, anon, authenticated;") && !/grant execute on function public\.close_season_awards/.test(sql));
A("it acts only on a season whose vote has closed, by awards_close_at", cls.body.includes("public.awards_close_at(x.id) as close_at from public.seasons x") && cls.body.includes("continue when s.close_at is null or s.close_at > now();"));
A("a decided award is skipped (a second run changes nothing)", cls.body.includes("continue when exists (select 1 from public.awards a where a.season_id = s.id and a.week is null and a.category = c);"));
A("one leader: decided by the vote through the one decision", /if v_n = 1 then\n\s+if public\._finalize_season_award\(s\.id, c, null, 'close'\) is not null then v_done := v_done \+ 1; end if;/.test(cls.body));
A("a tie or no eligible vote: every commissioner told once per award and close, through notify_commissioners",
  cls.body.includes("v_key := 'awards_wait_' || s.number || '_' || c;") && cls.body.includes("v_sig := to_char(s.close_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') || case when v_n = 0 then ' none' else ' tie' end;")
  && cls.body.includes("continue when (select k.value from public.app_config k where k.key = v_key) is not distinct from v_sig;")
  && count(cls.body, "perform public.notify_commissioners(null, 'flag', ") === 2 && count(cls.body, "'admin', null);") === 2
  && before(cls.body, "notify_commissioners", "insert into public.app_config (key, value) values (v_key, v_sig) on conflict (key) do update set value = excluded.value;"));
A("the notices say what waits and why, and name Finalize for a tie", /is tied: a commissioner decides/.test(cls.body) && /A commissioner breaks the tie with Finalize, picking one of them \(Rule 9\.2\)\./.test(cls.body)
  && /with no vote for a playoff-eligible player for %s, so it was not decided\. It waits for a commissioner \(Rule 9\.2\)\./.test(cls.body) && count(cls.body, "public._fmt_et(s.close_at)") === 2);
A("its heartbeat and its answer", cls.body.includes("values ('rl_awards-close', to_char(now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'))") && cls.body.includes("return format('%s decided, %s waiting for a commissioner', v_done, v_wait);"));
A("it fails loud: no exception handler anywhere in the record's functions", !/exception when/.test(sql));
A("the job: awards-close every minute, so the awards are posted at the deadline's own minute and date (11:59 PM ET, not 12:00 AM the next day)",
  sql.includes("select cron.schedule('awards-close', '* * * * *', 'select public.close_season_awards()');") && !/\*\/5/.test(sql)
  && /-- shortcut: decided at the first minute tick at or after the deadline/.test(sql));
A("the watchdog line, patched by an anchor that must match once",
  sql.includes("v_old text := E'      (''playoff-autopilot'', interval ''1 hour''),   -- v4.40: the playoff draw\\n';")
  && sql.includes("|| E'      (''awards-close'', interval ''1 hour''),   -- v465: the voted awards, decided at the next owner deadline\\n';")
  && sql.includes("if v_n <> 1 then raise exception 'v465 awards close: the automation_watchdog anchor matched % times, want 1', v_n; end if;"));

console.log("\n6. The self-checks");
const chk = (sql.match(/do \$chk\$\n([\s\S]*?)end \$chk\$;/) || [])[1] || "";
A("every SECURITY DEFINER function, search_path '' (is distinct from), and the two helpers' search_path",
  /foreach f in array array\['public\._award_label\(text\)', 'public\._awards_close_words\(timestamptz\)'\] loop/.test(chk) && /'public\.awards_close_at\(uuid\)', 'public\.guard_award_ballot\(\)', 'public\._award_leaders\(uuid,text\)',\n\s+'public\._finalize_season_award\(uuid,text,uuid,text\)', 'public\.finalize_season_award\(uuid,text,uuid\)', 'public\.close_season_awards\(\)'\]/.test(chk)
  && /is distinct from array\['search_path=""'\]/.test(chk));
A("the internal functions callable by no API role, PUBLIC included", /has_function_privilege\('public', f, 'EXECUTE'\)/.test(chk) && /'public\._award_label\(text\)',\n\s+'public\._awards_close_words\(timestamptz\)'/.test(chk));
A("the client doors: awards_close_at for anon and authenticated, Finalize for authenticated and never anon",
  /not has_function_privilege\('anon', 'public\.awards_close_at\(uuid\)', 'EXECUTE'\)/.test(chk) && /has_function_privilege\('anon', 'public\.finalize_season_award\(uuid,text,uuid\)', 'EXECUTE'\)/.test(chk));
A("Season 1 closes at Season 2's owner deadline, and every season at the next one's (a check that can fail, not the newest season's tautology)",
  /public\.awards_close_at\(v_s1\) is distinct from v_s2/.test(chk) && !/v_last/.test(chk)
  && chk.includes("where public.awards_close_at(s.id) is distinct from n.owner_app_deadline) then"));
A("the words read 11:59 PM ET on Saturday, November 28 for the real close", chk.includes("if public._awards_close_words('2026-11-29 04:59:00+00'::timestamptz) is distinct from '11:59 PM ET on Saturday, November 28' then"));
A("the wiring: the guard reads the close, Finalize is the check and the decision, the trigger, the job and the watchdog",
  /the ballot guard does not read awards_close_at/.test(chk) && /finalize_season_award is not the commissioner check and the internal decision/.test(chk)
  && /t\.tgname = 'guard_award_ballot_trg'/.test(chk) && /j\.jobname = 'awards-close' and j\.active and j\.schedule = '\* \* \* \* \*'/.test(chk) && /does not watch awards-close exactly once/.test(chk)
  && /the decision does not wait for the close or decides an award twice/.test(chk));
A("every self-check raises", (chk.match(/raise exception 'v465 awards close: /g) || []).length >= 12);

console.log("\n7. The house rules in the record");
const prose = [(sql.match(/^\s*--.*$/gm) || []).join("\n"), (sql.match(/\/\*[\s\S]*?\*\//g) || []).join("\n"), (sql.match(/'(?:[^'\n]|'')*'/g) || []).filter((s) => / \w+ /.test(s)).join("\n")].join("\n");
A("no dashes, no spaced hyphens in prose, neutral pronouns", !DASHES.test(sql) && !/ - /.test(prose) && !GENDERED.test(sql));
A("Discord only through the news table's own trigger: no post door opened here", !/net\.http_post|discord_http_post\(|notify_discord\(|_announce_once|notify_staff_ch/.test(sql));
A("no member is named and no id is written", !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(sql));
A("v465 until the main session stamps it", /^-- v465 \(2026-11-25\)/.test(sql));

console.log("\n8. The rehearsal");
const embedded = (reh.match(/-- >>> record text: [^\n]*\n([\s\S]*?)-- <<< record text\n/) || [])[1] || "";
const applied = sql.slice(0, sql.indexOf("\n/* REHEARSAL") + 1);
A("it carries the record's text byte for byte, up to the REHEARSAL note", sql.indexOf("\n/* REHEARSAL") > 0 && embedded.length > 1000 && embedded === applied);
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh) && before(reh, "\nbegin;\n", "-- >>> record text: "));
A("cases T1 to T7 in order, after the record", ["$t1$", "$t2$", "$t3$", "$t4$", "$t5$", "$t6$", "$t7$"].every((t, i, a) => before(reh, "-- <<< record text", "do " + t) && (i === 0 || before(reh, "do " + a[i - 1], "do " + t))));
A("T1: the vote open (deadline a day ahead), nothing to close, a vote through the API role accepted",
  reh.includes("update public.seasons set owner_app_deadline = now() + interval '1 day' where id = v_s2;") && reh.includes("if v_res is distinct from '0 decided, 0 waiting for a commissioner' then")
  && /perform set_config\('role', 'authenticated', true\);\n\s+insert into public\.award_ballots \(season_id, category, voter_id, profile_id\) values \(v_s1, 'mvp', v_c, v_k\)/.test(reh));
A("T1: a commissioner's Finalize before the close, and for the newest season (no next deadline), refused 22023 in the decision's words, writing nothing",
  reh.includes("v_want1 := format('The Season 1 vote closes at %s; no award is decided before then (Rule 9.2).', public._awards_close_words(now() + interval '1 day'));")
  && reh.includes("v_want2 := format('The Season %s vote closes when Season %s owner applications close, and that deadline is not set yet; no award is decided before then (Rule 9.2).', v_lastn, v_lastn + 1);")
  && reh.includes("if v_state <> '22023' or v_msg is distinct from v_want1 then raise; end if;") && reh.includes("if v_state <> '22023' or v_msg is distinct from v_want2 then raise; end if;")
  && reh.includes("T1 failed: a refused Finalize wrote an awards row, a story, a queued post or an audit row"));
A("T2: the close passed, read by a signed-out visitor; a change and a cast refused 22023 in the guard's exact words; the real deadline's words",
  reh.includes("update public.seasons set owner_app_deadline = now() - interval '1 minute' where id = v_s2;") && /perform set_config\('role', 'anon', true\);\n\s+v_read := public\.awards_close_at\(v_s1\);/.test(reh)
  && count(reh, "if v_state <> '22023' or v_msg is distinct from v_want then raise; end if;") === 2
  && reh.includes("v_want := 'The Season 1 vote closed at ' || public._awards_close_words(now() - interval '1 minute') || ' (Rule 9.2).';")
  && reh.includes("or public._awards_close_words('2026-11-29 04:59+00'::timestamptz) is distinct from '11:59 PM ET on Saturday, November 28' then"));
A("T3: a tie built, the close decides each one-leader award: rows, stories, queued posts and audit rows counted; every commissioner told once",
  reh.includes("delete from public.award_ballots b where b.season_id = v_s1 and b.category = v_x") && reh.includes("('queue', (select count(*) from net.http_request_queue)),")
  && reh.includes("the close did not write one awards row, one story, one queued post and one audit row per award decided") && reh.includes("the commissioners were not each told once of the tie")
  && reh.includes("the tie was decided without a commissioner") && reh.includes("the heartbeat rl_awards-close was not stamped")
  && reh.includes("is distinct from to_char((now() - interval '1 minute') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') || ' tie' then"));
A("T4: a second run adds nothing", reh.includes("if v_res is distinct from format('0 decided, %s waiting for a commissioner', v_wait) then") && reh.includes("T4 failed: the second run added an award, a story, a post, an audit row or a bell"));
A("T5: the door refuses anon and a member, refuses a tie without a leader's pick, and takes a tied leader",
  reh.includes("if sqlerrm is distinct from 'Only a commissioner can finalize an award.' then raise; end if;") && count(reh, "if sqlerrm is distinct from format('The %s vote is tied at the top; pick one of the tied players to break it.', v_x) then raise; end if;") === 2
  && reh.includes("v_name := public.finalize_season_award(v_s1, v_x, v_a);") && reh.includes("format('0 decided, %s waiting for a commissioner', v_wait - 1)"));
A("T6: the internal doors closed to the API roles; a moved deadline reopens the vote and a decided award refuses in its own words",
  reh.includes("'public.close_season_awards()', 'public._finalize_season_award(uuid,text,uuid,text)', 'public._award_leaders(uuid,text)'")
  && reh.includes("v_msg is distinct from 'That award has been decided; the vote is closed.' then raise; end if;"));
A("T7: with the vote closed, a Finalize on an award the close decided and on the tie already picked is refused 22023, changing and adding nothing",
  reh.includes("perform set_config('rh.done', v_done, true);") && reh.includes("foreach c in array array[v_done, v_x] loop")
  && reh.includes("if v_state <> '22023' or v_msg is distinct from 'That award has been decided.' then raise; end if;")
  && reh.includes("T7 failed: a refused Finalize changed an award or added a story, a queued post or an audit row"));
A("every expected refusal sits in an inner block that re-raises anything else", (reh.match(/exception when others then\n/g) || []).length === count(reh.replace(embedded, ""), "exception when others then") && !/exception when others then\n\s+null;/.test(reh));
A("the verdict raises uncaught with every case named", /do \$v\$\nbegin\n  raise exception 'REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7';\nend \$v\$;\s*$/.test(reh));
A("no id written, no name printed, no dashes, neutral pronouns, the queue counted outside", !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh)
  && !/raise (notice|info|log|warning)/i.test(reh) && !DASHES.test(reh) && !GENDERED.test(reh) && /Before and after, outside the transaction, count net\.http_request_queue: it must be unchanged/.test(reh));

console.log("\n9. Rule 9.2, as the book renders it");
const ctx = { CG: { ROUTES: {}, AFTER: {} } }; vm.createContext(ctx);
vm.runInContext(R("src/live/part3_content.js"), ctx);
const pub2 = R("src/live/part5b_public2.js");
const rff = (pub2.match(/CG\.rulebookForFormat = function\(rb, fmt\)\{[\s\S]*?\n\};/) || [])[0];
A("the live renderer is found once", !!rff && count(pub2, "CG.rulebookForFormat = function(rb, fmt){") === 1);
vm.runInContext(rff || "", ctx);
const book = ctx.CG.rulebookForFormat(ctx.CG.CONTENT.rulebook, "basic"), bookT = JSON.stringify(book.chapters);
const s92 = (book.chapters.find((c) => String(c.num) === "9") || { sections: [] }).sections.find((x) => x.id === "9.2") || { paragraphs: [] };
const raw92 = ctx.CG.CONTENT.rulebook.chapters.find((c) => String(c.num) === "9").sections.find((x) => x.id === "9.2");
const p92 = s92.paragraphs[0] || "";
A("9.2: the vote can be changed until it closes", p92.includes("may change it until the vote closes."));
A("9.2: it closes when owner applications for the following season close, citing Rule S2.1, which sets that moment (and holds Season 2's date)",
  p92.includes("The vote closes when owner applications for the following season close (Rule S2.1). At that moment") && !/S2\.2 for Season 2/.test(bookT)
  && /owner applications close Saturday, November 28, 2026 at 11:59 PM/.test(JSON.stringify(ctx.CG.CONTENT.rulebook)));
A("9.2 keeps no second copy of the date S2.1 publishes", !/28 November 2026/.test(p92));
A("9.2: the league office then decides and announces each award, to the eligible player with the most votes", p92.includes("At that moment the league office decides and announces each award: the award goes to the playoff-eligible player with the most votes."));
A("9.2: a tie, or no eligible vote, waits for a commissioner, who decides nothing else", p92.includes("A tie among the leaders, or an award with no vote for a playoff-eligible player, waits for a commissioner, and a commissioner decides only such an award."));
A("9.2: the stale sentences are gone from the rendered book", !/until the award is decided/.test(bookT) && !bookT.includes("The league office announces each winner with the award."));
A("9.2 carries no full-format text (the basic paragraphs are the whole rule)", !raw92.full && !(book.chapters.find((c) => c.num === "A") || { sections: [] }).sections.some((x) => x.of === "9.2"));
A("9.2 keeps the house register: no dashes, neutral pronouns, the rule's second paragraph untouched",
  !DASHES.test(raw92.paragraphs.join(" ")) && !GENDERED.test(raw92.paragraphs.join(" ")) && /^The statistical titles are decided directly from the official record/.test(raw92.paragraphs[1]));
const s2book = R("src/s2/js/rulebook.js");
A("the Season 2 site's book is rebuilt with the new 9.2", s2book.includes("The vote closes when owner applications for the following season close (Rule S2.1). At that moment") && !s2book.includes("S2.2 for Season 2")
  && !s2book.includes("The league office announces each winner with the award."));

console.log("\n10. The copies swept");
A("the classic ballot says the vote closes, never \"until the award is decided\"", !/until the award is decided/.test(pub2)
  && pub2.includes("and can change it until the vote closes, when owner applications for the following season close and the winners are announced. ")
  && pub2.includes("You can change a vote until the vote closes, when owner applications for the following season close.") && pub2.includes("Vote saved. You can change it until the vote closes"));
const lg = R("src/s2/js/pages/league.js"), cc = R("src/s2/js/pages/control.js"), model = R("src/s2/js/model.js"), classic = R("src/live/part_live.js");
A("no copy says a vote may change \"any time\": both Control Centers' toasts say until the vote closes (Rule 9.2)", !/change it any time/.test(cc + classic)
  && cc.includes("S2.toast(\"Vote saved. You can change it until the vote closes (Rule 9.2).\", \"ok\");") && classic.includes("CG.toast(\"Vote saved. You can change it until the vote closes (Rule 9.2).\",\"ok\");"));
A("the classic Control Center offers no Finalize (it sends no tie pick and targets the season in play), and says how the awards are decided",
  !/data-ballot-final|rpc\("finalize_season_award"|A tied vote stops and asks you/.test(classic)
  && classic.includes("The vote closes when owner applications for the following season close; then each award goes by itself to the playoff-eligible player with the most votes, and a commissioner breaks a tie in the Control Center at chelgamingleague.com (Rule 9.2)."));
A("the Season 2 ballot, its toast and its pinned check say the vote closes", !/until the award is decided/.test(lg) && lg.includes("you may change it until the vote closes (\" + rule(\"9.2\") + \"). Nobody sees the tally. \"")
  && lg.includes("You can change it until the vote closes.") && !/until the award is decided/.test(R("tools/ui/fixround.test.cjs")));

console.log("\n11. The Season 2 site");
A("M.awardsCloseAt: the next season's owner_app_deadline from its row, naming public.awards_close_at as the authority",
  model.includes("M.awardsCloseAt = (n) => { const r = rowOf(num(n) + 1); return r && r.owner_app_deadline ? iso(r.owner_app_deadline) : null; };")
  && /The authority is the database's public\.awards_close_at/.test(model));
A("M.votedAwards: the four voted categories from the awards rows, a winner the body does not hold named from the members",
  model.includes('const VOTED = ["mvp", "best_goalie", "best_defenseman", "rookie_of_year"];') && /a\.week == null && VOTED\.indexOf\(a\.category\) >= 0/.test(model) && /M\.members\.filter\(\(x\) => x\.id === a\.pid\)/.test(model));
A("the ballot reads the close and the winners from the model, never a second copy of the date",
  lg.includes("var at = M.awardsCloseAt(n), won = M.votedAwards(n)") && !/November 28|11:59 PM ET/.test(lg));
A("the ballot's three states: the close said, the close passed, the winners",
  lg.includes("\"Voting closes at \" + closeWords(V.at) + \", when the winners are announced.\"")
  && lg.includes("\"Voting closes when owner applications for Season \" + (VIEW.season + 1) + \" close, when the winners are announced.\"")
  && lg.includes("V.all ? \"The winners\" : \"The vote has closed\"") && lg.includes("\"The vote closed at \" + esc(closeWords(V.at)) + \". \"")
  && lg.includes("\"The winners are being announced. A tie at the top, or an award with no vote for a playoff-eligible player, goes to a commissioner (\"")
  && lg.includes("w ? \"Winner: \"") && lg.includes(": V.over ? \"Being announced\" : \"Voting is open\""));
A("a decided award takes no vote: its line, not the select", /function ballotRow\(cat\) \{\n\s+var V = voteNow\(VIEW\.season\); if \(V\.won\[cat\[0\]\]\) return votedRow\(cat, V\);/.test(lg));
A("the record board's note follows the decisions", lg.includes("\"). \" + votedNote(AW) + \"</p></section>\"") && lg.includes("\"Season \" + n + \"&rsquo;s have not been awarded yet.\"") && lg.includes("\"Season \" + n + \"&rsquo;s are with the vote below.\""));
A("the Control Center reads the same close and says the awards decide themselves and a tie comes to the commissioner",
  cc.includes("var at = M().awardsCloseAt(n)") && cc.includes("owner applications close, and each award is then decided by itself. ")
  && cc.includes("\"A tie at the top, or an award with no vote for a playoff-eligible player, comes to you\"") && cc.includes("owner applications closed; each award with one leader is decided by itself at that minute. "));
A("Finalize only for an undecided award once the vote has closed (never before it, nor with no next deadline, as the database refuses); the vote only while it is open",
  cc.includes("(!won && W.shut ? '<button class=\"btn sm\" data-cc-final=\"'") && !/W\.shut \|\| !W\.at/.test(cc) && cc.includes("(won || W.shut ? \"\" : '<select class=\"input cc-sel\""));
A("with no next deadline the block says the vote closes at it, not set yet", cc.includes("\"The Season \" + n + \" vote closes when Season \" + (n + 1) + \" owner applications close, and that deadline is not set yet; each award is then decided by itself. \"")
  && !/nothing closes the vote by itself/.test(cc));
A("the Finalize sheet takes the pick that breaks a tie, sent as p_winner only when made",
  cc.includes("id=\"ccAwWin\"") && cc.includes("check: function (sh) { return S2.$(\"#ccAwWin\", sh.el).value || null; }") && cc.includes("if (pick) args.p_winner = pick;"));
/* every region this change wrote, whole: each from its opening anchor to its closing one (each anchor found exactly once) */
const region = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + 1); return count(s, a) === 1 && i >= 0 && j > i ? s.slice(i, j) : null; };
const REGIONS = [[lg, "/* v465 (commissioner, 2026-11-25", "function sxAwards() {"], [lg, "recBoard(AW) + '<p class=\"lg-rec-note\">", "ballotSec() +"],
  [cc, "-- season awards: the commissioner's own ballot", "function loadBallots(root) {"], [cc, "var host = S2.$(\"#ccAwards\", root);", "done: function (r) {"],
  [model, "/* v465 (commissioner, 2026-11-25", "/* ---------- positions"], [model, "/* a season's voted awards AS DECIDED", "/* ---------- trophies"],
  [classic, "/* season award ballots: staff vote until the vote closes.", "CG.AFTER._complaints = function(){"],
  [pub2, "Voted awards are decided by the league", "(Rules 9.2 and 9.3).</div>"], [pub2, "CG.awardBallotCard = function(lg){", "/* ---------- POWER RANKINGS"]].map((x) => region(x[0], x[1], x[2]));
const NEW_LINES = (s) => s.split("\n").filter((l) => /v465|vote closes|vote closed|awardsCloseAt|votedAwards|voteNow|votedRow|votedNote|awardsWhen|ccAwWin/.test(l)).join("\n");
A("the site copy keeps the house rules: every region found, and no dash, spaced hyphen or gendered pronoun in the lines this change wrote",
  REGIONS.every((x) => !!x) && !REGIONS.some((x) => DASHES.test(NEW_LINES(x)) || / - /.test(NEW_LINES(x).replace(/ - \d|\d - /g, "")) || GENDERED.test(NEW_LINES(x))), REGIONS.map((x) => !!x).join());

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
