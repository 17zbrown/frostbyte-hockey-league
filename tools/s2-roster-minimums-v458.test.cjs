/* v4.58: Season 2 roster minimums. node tools/s2-roster-minimums-v458.test.cjs
   Commissioner, 2026-11-23: "do 3 forwards, 2 defensemen, and 1 goalie"; an involuntary shortfall is a random draw of a
   pool player of that group at $750K; no placement after the deadline, nightly requests cover it. Pins the record (the
   deferred trigger, the draw step, the replacement, trade and arrival patches, the self-checks) and its rehearsal. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;

const REC = "sql/2026-11-24-s2-roster-minimums-v458.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
/* the waivers record, found by its slug so a renumbered or redated file is still found (review, 2026-11-23) */
const WAIVERS = (() => { const f = fs.readdirSync(path.join(root, "sql")).filter((n) => /^\d{4}-\d{2}-\d{2}-s2-waivers-v[0-9A-Za-z.]+\.sql$/.test(n) && !/\.rehearsal\.sql$/.test(n));
  if (f.length !== 1) throw new Error("expected one waivers record, found " + f.length); return "sql/" + f[0]; })();
const sql = R(REC);
const fn = (name) => { const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$f\\$([\\s\\S]*?)\\$f\\$;")); return m ? m[1] : ""; };
const tag = (src, t) => { const m = src.match(new RegExp("\\$" + t + "\\$([\\s\\S]*?)\\$" + t + "\\$")); return m ? m[1] : ""; };
const before = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0 && s.indexOf(a) < s.indexOf(b);
const messages = [(sql.match(/^\s*--.*$/gm) || []).join("\n"), (sql.match(/\/\*[\s\S]*?\*\//g) || []).join("\n"),
  (sql.match(/raise exception '(?:[^']|'')*'/g) || []).join("\n"),
  (sql.match(/'(?:[^'\n]|'')*'/g) || []).filter((s) => / \w+ /.test(s) && !/::|\(/.test(s)).join("\n")].join("\n");

console.log("1. The ruling and the preconditions");
A("the header quotes the minimums and the random-draw ruling", /\("do 3 forwards, 2 defensemen, and 1 goalie"\)/.test(sql) && /RANDOM DRAW of a\n--     pool player of that group at \$750K/.test(sql));
A("it refuses to run before the waivers record, the steps end line and the market_placed origin",
  ["the Season 2 waivers record must be applied first", "market_tick has no steps end line", "does not accept market_placed yet"].every((t) => sql.indexOf(t) >= 0));

console.log("\n2. The deferred trigger");
const tr = fn("check_roster_minimums");
A("a deferred constraint trigger on roster_spots: delete, and team, position, squad or status updates",
  /create constraint trigger check_roster_minimums_trg\n\s+after delete or update of team_id, position, squad, status on public\.roster_spots\n\s+deferrable initially deferred\n\s+for each row execute function public\.check_roster_minimums\(\);/.test(sql));
A("market seasons with the draft complete only; a spot still active on the same club, whatever group it now fills (a position change), is no departure: no draw, no refusal",
  before(tr, "if not public.market_on(v_season) or not public._market_draft_done(v_season) then return null; end if;", "roster_min_gap")
  && /if v_cur\.id is not null and v_cur\.team_id = v_team and v_cur\.season_id = v_season and v_cur\.status = 'active' then\n\s+return null;/.test(tr)
  && !/pos_group\(v_cur\.position\)/.test(tr) && !/'position changed'/.test(tr));
A("a move to another club inside a trade or its reversal is read from the transaction's app.trade_move mark",
  /v_trade := v_cur\.id is not null and v_cur\.team_id is distinct from v_team\n\s+and coalesce\(current_setting\('app\.trade_move', true\), ''\) = 'on';/.test(tr)
  && /when v_trade then 'traded'\n\s+when v_cur\.team_id is distinct from v_team then 'moved to another club'/.test(tr));
A("the club is judged at commit through roster_min_gap, the ONE 3/2/1 definition", /v_gap := public\.roster_min_gap\(v_season, v_team, null, null\);/.test(tr));
A("why the player left comes from the removal archive (the deleting doors reset app.roster_reason before commit)",
  /select r\.reason into v_reason from public\.roster_spot_removals r where r\.spot_id = old\.id order by r\.removed_at desc limit 1;/.test(tr));
A("any removal the club did not make itself owes the draw: only a club's own move is 'club', everything else 'draw' (no reason list, no office branch)",
  /\n\s+else 'draw' end;/.test(tr) && !/v_draws|'office'|any\(v_draws\)/.test(tr)
  && /Main session, 2026-11-23 \(review of this record\): any removal the club did not make itself owes the random shortfall\n--     draw/.test(sql));
A("a club's own move (a seat holder of either club, not a commissioner, not the service role) is refused through _market_min_breach, against the gaps a trade left",
  /when auth\.uid\(\) is not null and not public\.is_commissioner\(\)\n\s+and coalesce\(nullif\(current_setting\('request\.jwt\.claims', true\), ''\)::jsonb->>'role', ''\) <> 'service_role'\n\s+and \(public\.is_gm_of\(v_team\) or \(v_cur\.id is not null and public\.is_gm_of\(v_cur\.team_id\)\)\) then 'club'/.test(tr)
  && /v_why := public\._market_min_breach\(v_season, v_team, null, v_grp,\n\s+\(nullif\(current_setting\('app\.min_gap_before', true\), ''\)::jsonb\) -> \(v_team::text\)\);\n\s+if v_why is not null then raise exception '%', v_why using errcode = 'check_violation', hint = 'below_minimum'; end if;/.test(tr));
A("a commissioner's removal, a pick reversal or an office waiver owes the draw like a ban (no staff-only path)",
  !/place a player by hand if one is needed/.test(tr) && before(tr, "if v_kind = 'club' then", "insert into public.replacement_signings"));
A("D-INVOLUNTARY refined: a trade, whoever accepts or reverses it, never owes the draw; a club's own trade is still judged first",
  /second review, D-INVOLUNTARY refined\): "the random shortfall draw is owed ONLY when a\n--     player LEAVES the club's roster by an act the club did not make/.test(sql)
  && /A trade \(whoever\n--     accepts or processes it\) and a position change NEVER owe a draw\."/.test(sql)
  && before(tr, "if v_kind = 'club' then", "if v_trade then return null; end if;")
  && before(tr, "if v_trade then return null; end if;", "select count(*) into v_owed from public.replacement_signings x")
  && before(tr, "if v_trade then return null; end if;", "insert into public.replacement_signings"));
A("after the movement deadline: no draw, the seats are told to use nightly requests (never the club room)",
  /if public\.moves_locked\(v_season\) then[\s\S]*?Cover the gap with a nightly training camp request for each game night\.[\s\S]*?null, 'manager', null, null, false\);\n\s+return null;/.test(tr));
A("before it: one owed draw per missing player of the group, the staff channel and the seats told (room off)",
  /if v_owed >= v_short then return null; end if;/.test(tr)
  && /insert into public\.replacement_signings \(season_id, team_id, departed_profile_id, reason, pos_group\)/.test(tr)
  && /perform public\.notify_staff_ch\(null,/.test(tr) && /'A replacement is being drawn',[\s\S]*?null, 'manager', null, null, false\);/.test(tr));
A("missing Season 2 rules raise, never a skip", /if v_min is null or v_price is null then\n\s+raise exception/.test(tr));

console.log("\n3. The draw");
const dr = fn("_market_draw_shortfalls");
A("each open owed draw, oldest first, SKIP LOCKED", /where x\.season_id = p_season and x\.pos_group is not null and x\.used_at is null\n\s+order by x\.created_at for update skip locked/.test(dr));
A("after the deadline it lapses with a reason; a club back at the minimum lapses too",
  before(dr, "if public.moves_locked(p_season) then", "lapsed_why = 'The movement deadline passed") && /lapsed_why = 'The club is back at the minimum\.'/.test(dr));
A("a random unsuspended pool player of the group still in the Discord (random(), server side), from market_pool",
  /from public\.market_pool\(p_season\) mp join public\.profiles p on p\.id = mp\.profile_id\n\s+where mp\.pos_group = r\.pos_group and not mp\.suspended\n\s+and not \(p\.in_guild is false and not exists \(select 1 from public\.guild_members g where g\.profile_id = p\.id and g\.present\)\)\n\s+order by random\(\) limit 1;/.test(dr));
A("the club lock (tried once, skipped and retried when held) comes before the roster is read and before the lapse decision",
  /continue when not public\._market_club_lock\(r\.team_id, false\);/.test(dr)
  && before(dr, "continue when not public._market_club_lock(r.team_id, false);", "v_gap := public.roster_min_gap(p_season, r.team_id, null, null);")
  && before(dr, "continue when not public._market_club_lock(r.team_id, false);", "lapsed_why = 'The club is back at the minimum.'")
  && (dr.match(/_market_club_lock/g) || []).length === 1);
A("at the opening price from season_rules (mk.bid_open), origin market_placed, spot and cap checked first",
  /mk'->>'bid_open'/.test(dr) && /values \(p_season, r\.team_id, v_pick\.profile_id, v_jersey, v_pick\.position, v_price, 'market_placed', 'pro'\);/.test(dr)
  && before(dr, "no open roster spot", "insert into public.roster_spots") && before(dr, "cap_has_room(p_season, r.team_id, v_price)", "insert into public.roster_spots"));
A("the deferred roster check fires inside the draw's own block, by name, so one refused draw does not fail the tick and no other step's events are blamed on it",
  /execute 'set constraints public\.check_roster_structure_trg immediate';\n\s+execute 'set constraints public\.check_roster_structure_trg deferred';/.test(dr)
  && /exception when others then\n\s+v_err := sqlerrm;\n\s+execute 'set constraints public\.check_roster_structure_trg deferred';/.test(dr)
  && !/set constraints all/.test(dr) && /the deferred check_roster_structure_trg on roster_spots is missing/.test(sql));
A("the drawn player's sign-up update is row-counted", /get diagnostics v_reg = row_count;[\s\S]*?if v_reg <> 1 then raise exception/.test(dr));
A("a draw that cannot be made alerts staff and commissioners once (alerted_at) and retries; never dropped silently",
  /if r\.alerted_at is null then\n\s+update public\.replacement_signings set alerted_at = clock_timestamp\(\) where id = r\.id;\n\s+perform public\.notify_staff_ch/.test(dr)
  && /perform public\.notify_commissioners\(null, 'flag', 'Shortfall draw blocked: '/.test(dr));
A("a placed draw: the owed row used, the sign-up assigned, a 'placed' transaction, a DM",
  /used_registration_id = \(select sr\.id from public\.season_registrations sr/.test(dr) && /set status = 'assigned'/.test(dr)
  && /'placed', v_club \|\| ' received <b>'/.test(dr) && /public\._market_dm\(v_pick\.profile_id,/.test(dr));
const tk = tag(sql, "tick");
A("market_tick gains the step above the steps end line, in its own block", tag(tk, "a") === "    -- market-tick steps end\n"
  && /perform public\._market_draw_shortfalls\(v_season\);   -- v4.58: Season 2 shortfall draws\n\s+exception when others then\n\s+v_errors := v_errors \|\| \('shortfall draw: ' \|\| sqlerrm\);/.test(tk)
  && R(WAIVERS).indexOf("    -- market-tick steps end\n") >= 0);

console.log("\n4. The patches");
const p = tag(sql, "p");
A("_grant_replacement returns at once in a market season, before the Season 1 line", /if public\.market_on\(p_season\) then return; end if;\n\$b\$ \|\| a;/.test(p)
  && tag(p, "a").indexOf("  if p_team is null or not public.fa_moves_closed(p_season) then return; end if;") === 0);
A("accept_trade, before any player moves: both clubs' locks in id order, then both clubs' gaps into app.min_gap_before (kept to commit)",
  /a := \$a\$  foreach pid in array t\.offered_profile_ids loop perform public\.move_player\(pid, t\.season_id, t\.to_team_id\); end loop;\n\$a\$;/.test(p)
  && /if public\.market_on\(t\.season_id\) and public\._market_draft_done\(t\.season_id\) then\n\s+perform public\._market_club_lock\(least\(t\.from_team_id, t\.to_team_id\)\);\n\s+perform public\._market_club_lock\(greatest\(t\.from_team_id, t\.to_team_id\)\);\n\s+perform set_config\('app\.trade_move', 'on', true\);   -- v4.58 \(D-INVOLUNTARY refined\): a trade never owes a shortfall draw\n\s+perform set_config\('app\.min_gap_before', jsonb_build_object\(/.test(p)
  && /\)::text, true\);\n\s+end if;\n\$b\$ \|\| a;/.test(p));
A("accept_trade refuses only a trade that leaves a group shorter than before it and than the draws owed, after every move and before the cap, not before the draft, the office not bound",
  /b := a \|\| \$b\$/.test(p) && /if public\.market_on\(t\.season_id\) and public\._market_draft_done\(t\.season_id\) and not public\.is_commissioner\(\) then\n\s+declare v_why text; v_before jsonb := nullif\(current_setting\('app\.min_gap_before', true\), ''\)::jsonb;\n\s+begin\n\s+v_why := coalesce\(public\._market_min_breach\(t\.season_id, t\.from_team_id, null, null, v_before -> \(t\.from_team_id::text\)\),\n\s+public\._market_min_breach\(t\.season_id, t\.to_team_id, null, null, v_before -> \(t\.to_team_id::text\)\)\);/.test(p));
A("_place_trade_arrivals refuses an arrival with no active place in Season 2 words", /if public\.market_on\(p_season\) then\n\s+select name into v_club from public\.teams where id = p_team;\n\s+raise exception 'Season 2 rosters: this trade would leave the % with % players, over the %-player roster\. Season 2 has no training camps, so nothing was traded: that club must make room first\.'/.test(p));
const rv = p.slice(p.indexOf("pg_get_functiondef('public.reverse_trade(uuid,text)'"));
A("reverse_trade, before anyone moves back: both clubs' locks in id order and the trade mark, market seasons after the draft only",
  tag(rv, "a") === "  foreach pid in array coalesce(t.offered_profile_ids, '{}'::uuid[]) loop\n"
  && /if public\.market_on\(t\.season_id\) and public\._market_draft_done\(t\.season_id\) then\n\s+perform public\._market_club_lock\(least\(t\.from_team_id, t\.to_team_id\)\);\n\s+perform public\._market_club_lock\(greatest\(t\.from_team_id, t\.to_team_id\)\);\n\s+perform set_config\('app\.trade_move', 'on', true\);\n\s+end if;\n\$b\$ \|\| a;/.test(rv));
A("every anchor is asserted to match once", (sql.match(/if n <> 1 then raise exception 'v4.58 minimums: the [a-z_ ]+ anchor matched % times, expected exactly 1', n; end if;/g) || []).length === 6);
A("no DROP: CREATE OR REPLACE keeps every patched signature and grant", !/drop\s+function/i.test(sql));

console.log("\n5. Self-checks, writing, doors");
A("self-checks: the deferred trigger and its events, definers with no API grant, the tick step, the three patches, no overloads, Season 1 rules",
  ["must be a deferred constraint trigger on roster_spots", "the trigger must fire on delete and on team, position, squad or status updates",
   "must be SECURITY DEFINER with search_path", "an API role can execute %", "market_tick does not run the shortfall draw above the steps end line",
   "_grant_replacement still grants in market seasons", "accept_trade does not read the gaps before its moves and check the minimums after them",
   "the shortfall draw must take the club lock before it reads the roster", "_place_trade_arrivals has no Season 2 branch",
   "a trade or its reversal does not mark the transaction before its moves, or the trigger does not read the mark",
   "a patched function gained an overload", "season_rules(Season 1) changed"].every((t) => sql.indexOf(t) >= 0));
A("no em dashes, no spaced hyphens in what members read, no gendered pronouns, no S2 rule numbers, no dormant-rule word",
  !DASHES.test(sql) && !/ - /.test(messages) && !GENDERED.test(sql) && !/Rule S2/.test(sql) && !/abandon/i.test(sql));
A("Discord only through the doors; nothing posts straight to pg_net", !/net\.http_post|discord_http_post\(|_announce_once/.test(sql));

console.log("\n6. The rehearsal");
const reh = R(REH);
const embedded = (reh.match(/-- >>> record text: [^\n]*\n([\s\S]*?)-- <<< record text\n/) || [])[1] || "";
A("it carries the record's text byte for byte, after a marked place for the waivers record", embedded === sql.replace(/\n?$/, "\n")
  && before(reh, "-- >>> the Season 2 waivers record text goes here", "-- >>> record text: "));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("a voluntary move under a minimum is refused (trade and trigger), an involuntary one draws at $750K, after the deadline a club note only",
  ["T1 failed", "T2 failed: the trigger let a club go under the goaltender minimum", "T3 failed: no goaltender drawn at $750K",
   "T4 failed: a draw was owed after the deadline", "T4 failed: the seats were not told to use nightly requests",
   "T5 failed: a commissioner''s removal below the forward minimum did not owe exactly one forward draw", "T5 failed: the staff channel was not told",
   "T7 failed: the forward owed for the commissioner''s removal was not drawn at $750K", "T7 failed: the owed draw for a club at the minimum did not lapse",
   "T8 failed"].every((t) => reh.indexOf(t) >= 0));
const t5 = (reh.match(/do \$t5\$([\s\S]*?)end \$t5\$;/) || [])[1] || "";
A("T5 fires the commit check while the commissioner's claims are still set, and asserts the staff post was queued",
  before(t5, "json_build_object('sub', current_setting('rh.com')", "perform public.admin_remove_from_roster(")
  && before(t5, "perform public.admin_remove_from_roster(", "execute 'set constraints all immediate';")
  && before(t5, "execute 'set constraints all immediate';", "perform set_config('request.jwt.claims', '', true);")
  && /convert_from\(q\.body, 'UTF8'\) like '%is being drawn at random from the training camp pool%'/.test(t5));
const t9 = (reh.match(/do \$t9\$([\s\S]*?)end \$t9\$;/) || [])[1] || "";
A("T9: a club already short with nothing owed may swap like for like (D for D, F for F, through accept_trade and the commit check) and may not send its only defenseman away",
  /T9 failed: A should be one defenseman short with nothing owed before the trades/.test(reh)
  && /if sqlerrm not like 'Season 2 roster minimums: this would leave the % with 0 defensemen, under the minimum of 2\.%' then raise; end if;/.test(t9)
  && before(t9, "accept_trade(current_setting('rh.t9a')::uuid)", "execute 'set constraints all immediate';")
  && before(t9, "accept_trade(current_setting('rh.t9b')::uuid)", "execute 'set constraints all immediate';")
  && /T9 failed: the two swaps did not complete/.test(reh));
A("D-INVOLUNTARY refined in the rehearsal: a commissioner's trade, a position change and a trade reversal each leave a club short and owe no draw, and the tick draws nobody for them",
  ["T10 failed: a trade that left a club short owed a draw", "T10 failed: the staff channel was told a replacement is being drawn for a trade",
   "T11 failed: a position change that left a club short owed a draw", "T12 failed: a trade reversal that left a club short owed a draw",
   "verdict failed: the tick drew a player for a trade, a reversal or a position change"].every((t) => reh.indexOf(t) >= 0)
  && /perform public\.accept_trade\(current_setting\('rh\.t10'\)::uuid\);\n\s+execute 'set constraints all immediate';/.test(reh)
  && /perform public\.set_player_position\(r\.profile_id, 'C'\);/.test(reh)
  && /perform public\.reverse_trade\(current_setting\('rh\.t10'\)::uuid, /.test(reh)
  && before(reh, "json_build_object('sub', current_setting('rh.com')", "perform public.accept_trade(current_setting('rh.t10')::uuid);"));
/* main session, 2026-11-24: now() is fixed for the transaction, so every rehearsal trade shares one created_at; a lookup by
   offer found T1's offer too (21000), and "newest" then picked it (stale). Every id comes from RETURNING. */
A("every rehearsal trade id comes from RETURNING, never a lookup by offer or created_at",
  (reh.match(/insert into public\.trades \(/g) || []).length === 6
  && (reh.match(/\n\s+returning id into v_id;\n\s+perform set_config\('rh\.(trade1|trade2|t9c|t9a|t9b|t10)', v_id::text, true\);/g) || []).length === 6
  && !/select id::text from public\.trades/.test(reh));
const world = (reh.match(/do \$w\$([\s\S]*?)end \$w\$;/) || [])[1] || "";
A("the world models the commissioner's Season 2 rollover while it is owed, under a commissioner's claims, hand-expires nothing, and says why it needs an empty Season 2",
  /if exists \(select 1 from public\.contracts c where c\.status in \('active', 'signed'\) and not coalesce\(c\.is_manager, false\)\n\s+and c\.start_season < \(select s\.number from public\.seasons s where s\.id = v_s2\)\) then\n\s+perform set_config\('request\.jwt\.claims', json_build_object\('sub', v_c, 'role', 'authenticated'\)::text, true\);\n\s+perform public\.start_next_season\(v_s2\);/.test(world)
  && before(world, "start_next_season(v_s2)", "update public.teams set owner_profile_id") && !/update public\.contracts/.test(reh.replace(embedded, ""))
  && /rehearse and apply the waivers and minimums records before the Dec 5 seating/.test(world));
A("the involuntary case runs the real discipline door and the real tick", /perform public\._remove_for_discipline\(current_setting\('rh\.g1'\)::uuid, 'banned'\);/.test(reh)
  && /perform public\.market_tick\(\);/.test(reh));
A("the verdict raises uncaught with every case named", /raise exception 'REHEARSAL OK: T1 T2 T3 T4 T9 T5 T6 T7 T8 T10 T11 T12';\nend \$v\$;\s*$/.test(reh) && !/do \$v\$[\s\S]*exception when/.test(reh));
A("no dblink, no http, and no member named", !/dblink|http_get|http_post\(/i.test(reh.replace(embedded, "")) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
