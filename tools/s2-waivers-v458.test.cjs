/* v4.58: Season 2 waivers. node tools/s2-waivers-v458.test.cjs
   Commissioner, 2026-11-02: "Any team can pick up a player placed on waivers up to 24 hours after they have been waived,
   like real life." 2026-11-23: the first valid claim wins at once, the waiving club cannot claim back, the claiming club
   needs a roster spot and cap room. Pins the record (table, waive_player rebuild, claim, pool, club state, tick, watchdog,
   approval queue, notice copy, self-checks) and its rehearsal. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;

const REC = "sql/2026-11-24-s2-waivers-v458.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
/* the hold record, found by its slug so a renumbered or redated file is still found (review, 2026-11-23) */
const HOLD = (() => { const f = fs.readdirSync(path.join(root, "sql")).filter((n) => /^\d{4}-\d{2}-\d{2}-s2-waive-hold-v[0-9A-Za-z.]+\.sql$/.test(n) && !/\.rehearsal\.sql$/.test(n));
  if (f.length !== 1) throw new Error("expected one waive-hold record, found " + f.length); return "sql/" + f[0]; })();
const sql = R(REC);
const fn = (name) => { const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$f\\$([\\s\\S]*?)\\$f\\$;")); return m ? m[1] : ""; };
const tag = (src, t) => { const m = src.match(new RegExp("\\$" + t + "\\$([\\s\\S]*?)\\$" + t + "\\$")); return m ? m[1] : ""; };
const before = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0 && s.indexOf(a) < s.indexOf(b);
/* what a member or the office reads: comments, raise messages and one-line text literals (code with '::' is not text) */
const messages = [(sql.match(/^\s*--.*$/gm) || []).join("\n"), (sql.match(/\/\*[\s\S]*?\*\//g) || []).join("\n"),
  (sql.match(/raise exception '(?:[^']|'')*'/g) || []).join("\n"),
  (sql.match(/'(?:[^'\n]|'')*'/g) || []).filter((s) => / \w+ /.test(s) && !/::|\(/.test(s)).join("\n")].join("\n");

console.log("1. Rulings and preconditions");
A("the header quotes the waiver, inactive-player and bid-eligibility rulings",
  /"Rostered players can be sent down to the league training camps only after being placed on waivers\. Any\n--     team can pick up a player placed on waivers up to 24 hours after they have been waived, like real life\./.test(sql)
  && /"Teams must not waive inactive players but should report them to league staff/.test(sql)
  && /"Only training camp players with at least 6 games played can be bid on/.test(sql));
A("it refuses to run without db-guards' helpers, the hold, or the waiver_claim origin",
  ["db-guards'' market_on and roster_min_gap must be applied first", "the Season 2 waive hold is not applied",
   "roster_spots_origin_check does not accept waiver_claim yet"].every((t) => sql.indexOf(t) >= 0));

console.log("\n2. The waiver table");
A("market_waivers: the waiving club can never claim back, enforced in the table",
  /constraint market_waivers_no_claim_back check \(claimed_team_id is distinct from from_team_id\)/.test(sql));
A("...one open waiver per player per season, and the sweep's index", /create unique index market_waivers_one_open on public\.market_waivers \(season_id, profile_id\) where status = 'open';/.test(sql)
  && /create index market_waivers_due on public\.market_waivers \(expires_at\) where status = 'open';/.test(sql));
A("...a club's waiver carries its not-inactive confirmation, the office's need not", /check \(by_office or not_inactive_at is not null\)/.test(sql));
A("...a waiver ends claimed, cleared or void; a void one carries its reason and the time it closed",
  /status text not null default 'open' check \(status in \('open', 'claimed', 'cleared', 'void'\)\)/.test(sql)
  && /constraint market_waivers_cleared_shape check \(\(status in \('cleared', 'void'\)\) = \(cleared_at is not null\)\)/.test(sql)
  && /constraint market_waivers_void_shape check \(\(status = 'void'\) = \(void_why is not null\)\)/.test(sql));
A("...RLS on, every API grant revoked first, then SELECT on the columns that do not name who acted",
  before(sql, "alter table public.market_waivers enable row level security;", "revoke all on public.market_waivers from public, anon, authenticated;")
  && /grant select \(id, season_id, profile_id, from_team_id, position, salary, by_office, waived_at, expires_at, status,\n\s+claimed_team_id, claimed_at, cleared_at\) on public\.market_waivers to anon, authenticated;/.test(sql)
  && !/grant (select|insert|update|delete|all)[^;]*\b(waived_by|claimed_by|void_why)\b[^;]*to/i.test(sql) && !/grant (insert|update|delete|all)[^;]*market_waivers/i.test(sql));
A("...one SELECT policy and the three live pulse triggers ('market' domain)",
  /create policy "market waivers are public" on public\.market_waivers for select to anon, authenticated using \(true\);/.test(sql)
  && (sql.match(/execute function public\._live_mark\('market', '', ''\);/g) || []).length === 3);
A("replacement_signings gains the shortfall columns (additive)", /alter table public\.replacement_signings\n\s+add column pos_group text check \(pos_group in \('F', 'D', 'G'\)\),\n\s+add column alerted_at timestamptz,\n\s+add column lapsed_why text;/.test(sql));

console.log("\n3. waive_player");
const wp = tag(sql, "wp"), hold = tag(R(HOLD), "h");
A("DROP plus CREATE with p_not_inactive boolean default null, regranted to authenticated and service_role only",
  /drop function public\.waive_player\(uuid\);/.test(wp) && /p_not_inactive boolean DEFAULT NULL::boolean/.test(wp)
  && /revoke all on function public\.waive_player\(uuid, boolean\) from public, anon, authenticated;\ngrant execute on function public\.waive_player\(uuid, boolean\) to authenticated, service_role;/.test(sql));
A("the hold it removes is the hold record's block, byte for byte, with @HOLD@ where the hold's own number stands",
  hold.length > 0 && tag(wp, "h") === hold.replace(/\/\* v[0-9A-Za-z.]+ \(Season 2 waive hold\):/, "/* @HOLD@ (Season 2 waive hold):")
  && (tag(wp, "h").match(/@HOLD@/g) || []).length === 1);
A("...and the hold's number is read from the live body, so this file carries no other record's number",
  /v_ver := substring\(v_old from '\/\\\* \(v\[0-9A-Za-z\.\]\+\) \\\(Season 2 waive hold\\\):'\);/.test(wp)
  && /if v_ver is null then\n\s+raise exception/.test(wp)
  && /v_hold := replace\(v_hold, '@HOLD@', v_ver\);/.test(wp)
  && before(wp, "v_hold := replace(v_hold,", "foreach c in array array[v_hdr_old, v_hold, v_at] loop")
  && !/(waive-hold|roster-minimums|draft-night-guards|front-office|lifecycle-copy)-v4.58/.test(sql));
A("the market branch goes in just before the Season 1 roster delete",
  tag(wp, "a") === "  perform set_config('app.roster_reason', 'waived', true);\n"
  && /v_new := replace\(replace\(replace\(v_old, v_hdr_old, v_hdr_new\), v_hold, ''\), v_at, v_branch \|\| v_at\);/.test(wp)
  && /if public\.market_on\(v_season\.id\) then\n    return public\._market_waive\(v_team\.id, v_season\.id, p_profile, p_not_inactive\);\n  end if;/.test(tag(wp, "b")));
A("every anchor is asserted to match once and the Season 1 body is proved byte-identical",
  /foreach c in array array\[v_hdr_old, v_hold, v_at\] loop/.test(wp) && /if n <> 1 then raise exception/.test(wp)
  && /replace\(substr\(v_def, position\('AS \$function\$' in v_def\)\), v_branch, ''\)\n\s+<> replace\(substr\(v_old, position\('AS \$function\$' in v_old\)\), v_hold, ''\)/.test(wp));
const chk = fn("_market_waive_check");
A("the Season 2 checks run in order: draft, deadline, not-inactive confirmation, seat, minimums",
  before(chk, "_market_draft_done(p_season)", "moves_locked(p_season)") && before(chk, "moves_locked(p_season)", "p_not_inactive")
  && before(chk, "p_not_inactive", "seat and cannot be waived") && before(chk, "seat and cannot be waived", "_market_min_breach"));
A("...the office skips the club bars (deadline, confirmation, minimums) but never the seat (commissioner powers ruling)",
  /if public\.moves_locked\(p_season\) and not v_office then/.test(chk) && /if not coalesce\(p_not_inactive, false\) and not v_office then/.test(chk)
  && /if not v_office then\n\s+select public\.pos_group/.test(chk) && !/v_seat is not null and not v_office/.test(chk));
const wv = fn("_market_waive");
A("the Season 2 waiver deletes under 'waived', then writes the waiver for the season's waiver hours, the stamp, the transaction and a DM",
  before(wv, "perform set_config('app.roster_reason', 'waived', true);", "delete from public.roster_spots where id = v_spot.id;")
  && before(wv, "delete from public.roster_spots", "insert into public.market_waivers") && /make_interval\(hours => v_hours\)/.test(wv)
  && /mk'->>'waiver_hours'/.test(wv) && /waived_at = now\(\)/.test(wv) && /'waive', v_club \|\| ' placed <b>'/.test(wv) && /public\._market_dm\(p_profile,/.test(wv));
A("...under the club lock, the spot read FOR UPDATE", before(wv, "_market_club_lock(p_team)", "for update"));
A("...and a player with no sign-up is refused loudly (the tick would void the waiver at once), nothing committed",
  /waived_at = now\(\)\n\s+where season_id = p_season and profile_id = p_profile;\n\s+get diagnostics v_n = row_count;/.test(wv)
  && /if v_n <> 1 then\n\s+raise exception 'That player has no sign-up for this season, so they cannot go on waivers\./.test(wv) && /hint = 'no_signup'/.test(wv));
const lk = fn("_market_club_lock");
A("the club lock waits by default and tries once for the tick, on one key",
  /p_wait boolean default true\)\nreturns boolean/.test(sql) && /perform pg_advisory_xact_lock\(hashtext\('market:club:' \|\| p_team::text\)\);\n\s+return true;/.test(lk)
  && /return pg_try_advisory_xact_lock\(hashtext\('market:club:' \|\| p_team::text\)\);/.test(lk) && (sql.match(/hashtext\('market:club:'/g) || []).length === 2);
const mb = fn("_market_min_breach");
A("_market_min_breach refuses a group only when it ends shorter than before the move and than the draws owed (p_before)",
  /p_group text default null, p_before jsonb default null\)/.test(sql)
  && /if v_short > greatest\(v_owed, coalesce\(\(p_before->>v_g\)::int, 0\)\) then/.test(mb) && !/if v_short > v_owed then/.test(mb));

console.log("\n4. The claim");
const cl = fn("market_claim");
A("the gate the grant audit reads is in the body (is_commissioner or is_gm_of), then the shared market checks",
  /if not \(v_office or public\.is_gm_of\(p_team\)\) then/.test(cl) && before(cl, "is_gm_of(p_team)", "_market_ctx(p_team, 'freeagents')"));
A("refusals in order: approval seat, the post-draft fill, deadline, lock, waiver FOR UPDATE, claimed, unavailable, cleared or expired, own waiver, suspended, spot, cap, minimums",
  ["hint = 'owner_claims'", "_market_ctx(p_team, 'freeagents')", "hint = 'fill_pending'", "moves_locked(v_season)", "_market_club_lock(p_team)", "for update", "hint = 'already_claimed'", "hint = 'unavailable'",
   "hint = 'cleared'", "hint = 'own_waiver'", "hint = 'suspended'", "hint = 'no_spot'", "hint = 'over_cap'", "hint = 'minimums'", "insert into public.roster_spots"]
    .every((t, i, a) => i === 0 || before(cl, a[i - 1], t)));
A("claims open only once the post-draft fill for skipped picks has written the season's postdraft_done_ mark, for the office too",
  /if not exists \(select 1 from public\.app_config c where c\.key = 'postdraft_done_' \|\| v_season::text\) then\n\s+raise exception 'The post-draft fill for skipped picks runs first\. Claims open as soon as it has run\.'\n\s+using errcode = 'check_violation', hint = 'fill_pending';/.test(cl)
  && !/v_office[^\n]*postdraft_done_|postdraft_done_[^\n]*v_office/.test(cl));
A("a seat whose Owner approves its Free agents moves is told to ask the Owner (a claim cannot wait in the queue)",
  /if not v_office and public\.mgmt_access\(p_team, 'freeagents'\) = 'approve' then/.test(cl) && before(cl, "hint = 'owner_claims'", "_market_ctx(p_team, 'freeagents')"));
const vw = fn("_market_waiver_void_why");
A("the player is re-checked where the waiver is used: banned, on a roster this season, or no sign-up left (the pool's three tests)",
  /when coalesce\(\(select p\.banned from public\.profiles p where p\.id = p_profile\), false\) then 'banned from the league'/.test(vw)
  && /when exists \(select 1 from public\.roster_spots rs where rs\.season_id = p_season and rs\.profile_id = p_profile\)/.test(vw)
  && /r\.status <> 'declined'\) then 'sign-up for the season withdrawn'/.test(vw)
  && /if v_w\.status = 'void' or public\._market_waiver_void_why\(v_season, v_w\.profile_id\) is not null then\n\s+raise exception '% can no longer be claimed: they are no longer in the training camp pool\.', v_name/.test(cl)
  && /if public\.is_suspended\(v_w\.profile_id\) and not v_office then/.test(cl) && !/is_banned/.test(cl));
A("...the claim's sign-up update is row-counted, never silent", /set status = 'assigned' where season_id = v_season and profile_id = v_w\.profile_id;\n\s+get diagnostics v_n = row_count;\n\s+perform set_config\('app\.role_grant', '', true\);\n\s+if v_n <> 1 then raise exception/.test(cl));
A("expiry is judged on clock_timestamp(), never the transaction's now()",
  /clock_timestamp\(\) >= v_w\.expires_at/.test(cl) && !/now\(\) >= v_w\.expires_at/.test(cl)
  && /continue when r\.expires_at > clock_timestamp\(\);/.test(fn("_market_expire_waivers")) && !/expires_at[^\n]*now\(\)/.test(fn("_market_expire_waivers")));
A("spots and cap count the bids the club leads (_market_led), and reachability uses roster_min_gap with the claimed group",
  /from public\._market_led\(p_team\) l;/.test(cl) && /v_active \+ v_led_n \+ 1 > v_max/.test(cl) && /v_pay \+ v_led \+ v_w\.salary > v_cap/.test(cl)
  && /public\.roster_min_gap\(v_season, p_team, v_grp, null\)/.test(cl));
A("the claimed player keeps the waiver salary, origin waiver_claim, and the waiver is closed with a row-count check",
  /values \(v_season, p_team, v_w\.profile_id, v_jersey, v_w\.position, v_w\.salary, 'waiver_claim', 'pro'\)/.test(cl)
  && /where id = v_w\.id and status = 'open';\n\s+get diagnostics v_n = row_count;\n\s+if v_n <> 1 then raise exception/.test(cl));
A("_market_led is an empty placeholder marked for the bid-night build", /shortcut: no bid lots exist until the bid-night build/.test(fn("_market_led")));

console.log("\n5. The pool and the club state");
const pool = fn("market_pool");
A("market_pool counts box scores only (final, unvoided regular-season games), never regular_gp or gp_credits",
  /from public\.game_stats gs join public\.games g on g\.id = gs\.game_id/.test(pool) && /g\.status = 'final'/.test(pool)
  && /not coalesce\(g\.voided, false\)/.test(pool) && !/regular_gp\s*\(|gp_credits/.test(pool.replace(/\/\*[\s\S]*?\*\//g, "")));
A("...eligibility from season_rules mk.bid_gp, suspended players never eligible, available_next left to the pool-requests build",
  /mk'->>'bid_gp'/.test(pool) && /coalesce\(box\.n, 0\) >= v_bid_gp and not public\.is_suspended\(pool\.pid\)/.test(pool) && /shortcut: null until the pool-requests build/.test(pool));
const st = fn("market_club_state");
A("market_club_state shows leads and free room only to the club's front office and commissioners",
  /if public\.is_commissioner\(\) or public\.is_gm_of\(p_team\) then\n\s+select count\(\*\), coalesce\(sum\(l\.amount\), 0\) into v_led_n, v_led from public\._market_led\(p_team\) l;\n\s+v_out := v_out \|\| jsonb_build_object\(\n\s+'leading'/.test(st)
  && st.indexOf("'free_room'") > st.indexOf("if public.is_commissioner() or public.is_gm_of(p_team) then"));
A("grants: claim and club state to members, the pool to everyone, nothing internal to an API role",
  /grant execute on function public\.market_claim\(uuid, uuid\) to authenticated;/.test(sql) && /grant execute on function public\.market_club_state\(uuid\) to authenticated;/.test(sql)
  && /grant execute on function public\.market_pool\(uuid\) to anon, authenticated;/.test(sql) && !/grant execute on function public\._market/.test(sql));

console.log("\n6. The tick, the watchdog, the queue, the notices");
const tick = fn("market_tick");
A("market_tick runs every 10 seconds on pg_cron, exits unless the season is a market season, each step in its own block",
  /select cron\.schedule\('market-tick', '10 seconds', 'select public\.market_tick\(\)'\);/.test(sql)
  && /if v_season is not null and public\.market_on\(v_season\) then\n\s+begin\n\s+perform public\._market_expire_waivers\(v_season\);\n\s+exception when others then\n\s+v_errors := v_errors \|\| \('waiver expiry: ' \|\| sqlerrm\);/.test(tick));
A("...a failed step is recorded for the watchdog (rl_market-tick_result ok false), never swallowed; heartbeat every run",
  /perform public\._market_tick_result\(v_errors\);/.test(tick) && /'rl_market-tick_result', jsonb_build_object\('ok', false/.test(fn("_market_tick_result"))
  && /'rl_market-tick', to_char/.test(tick));
A("...every app_config upsert bumps updated_at (the office reads a heartbeat's age from it)",
  (sql.match(/on conflict \(key\) do update set value = excluded\.value, updated_at = now\(\);/g) || []).length === 3
  && !/on conflict \(key\) do update set value = excluded\.value;/.test(sql));
A("...later records add steps above one marked line", /-- market-tick steps end\n/.test(tick));
const ex = fn("_market_expire_waivers");
A("expiry: a waiver whose player left the pool's reach is voided at once with its reason and announced nowhere, before any clock test",
  /where x\.season_id = p_season and x\.status = 'open'\n\s+order by x\.expires_at for update skip locked/.test(ex)
  && /v_why := public\._market_waiver_void_why\(p_season, r\.profile_id\);\n\s+if v_why is not null then\n\s+update public\.market_waivers set status = 'void', void_why = v_why, cleared_at = clock_timestamp\(\) where id = r\.id;\n\s+continue;\n\s+end if;\n\s+continue when r\.expires_at > clock_timestamp\(\);/.test(ex)
  && before(ex, "continue;", "insert into public.transactions"));
A("expiry: SKIP LOCKED over open rows only; a clear transaction, the pool channel post (no pings), a bell and a DM",
  /for update skip locked/.test(ex) && /update public\.market_waivers set status = 'cleared', cleared_at = clock_timestamp\(\) where id = r\.id;/.test(ex)
  && /'clear', '<b>'/.test(fn("_market_expire_waivers")) && /public\.notify_discord\('discord_freeagency_webhook',[\s\S]*?, false\);/.test(fn("_market_expire_waivers"))
  && /create_notification\(r\.profile_id/.test(fn("_market_expire_waivers")) && /_market_dm\(r\.profile_id/.test(fn("_market_expire_waivers")));
A("the watchdog's section 4 list gains market-tick by an anchored patch", tag(tag(sql, "wd"), "a") === "      ('live-flush', interval '10 minutes'),\n"
  && /\('market-tick', interval '10 minutes'\),   -- v4.58/.test(tag(sql, "wd")));
A("the Owner-approval queue passes the confirmation and refuses a Season 2 waiver request that could only fail",
  /perform public\.waive_player\(\(a->>'p_profile'\)::uuid, \(a->>'p_not_inactive'\)::boolean\);/.test(sql)
  && /if p_action = 'waive_player' and public\.market_on\(public\.current_season_id\(\)\) then\n\s+perform public\._market_waive_check\(v_team/.test(sql));
A("notice copy for the three market origins and a Season 2 waiver or season suspension",
  /if new\.origin in \('waiver_claim', 'market_bid', 'market_placed'\) then/.test(sql) && /if public\.market_on\(old\.season_id\) then\n\s+if v_reason = 'waived' then/.test(sql)
  && /elsif v_reason = 'suspended for the season' then/.test(sql));
const nt = tag(sql, "nt");
A("...the season suspension notice promises no draw (the minimums record tells the seats whether one follows)",
  /suspended for the rest of the season\.';\n\s+end if;/.test(nt) && !/drawn at random to replace them/.test(nt));
A("...and a Season 2 waiver's own bell says waivers, not released; the Season 1 sentence is kept",
  /case when public\.market_on\(old\.season_id\) and current_setting\('app\.roster_reason', true\) = 'waived'\n\s+then 'You were placed on waivers by '/.test(nt)
  && /else 'You were released from '\|\|coalesce\(tn,'a club'\)\|\|'\.' end, null, null\);/.test(nt)
  && tag(nt.slice(nt.indexOf("the player's own bell")), "a") === "    'You were released from '||coalesce(tn,'a club')||'.', null, null);\n"
  && (nt.match(/anchor matched % times, expected exactly 1', n; end if;/g) || []).length === 3);

const fill = tag(sql, "fill");
A("the post-draft fill takes the club's market lock (waiting) before it reads the club's roster, market seasons only, anchored on db-guards' line with no record number",
  tag(fill, "a") === "      if v_market and (public.roster_min_gap(p_season, v_team.id)->>'open')::int <= 0 then\n" && !/v4.58|v\d{3}/.test(tag(fill, "a"))
  && /      if v_market then perform public\._market_club_lock\(v_team\.id\); end if;\n\$b\$ \|\| a;/.test(fill)
  && /if n <> 1 then raise exception 'v4.58 waivers: the _place_for_unused_picks anchor matched % times, expected exactly 1', n; end if;/.test(fill)
  && /shortcut: the fill takes club locks in team-scan order while a trade takes its two in id order/.test(fill)
  && /db-guards'' market fill in _place_for_unused_picks must be applied first/.test(sql));

console.log("\n7. Self-checks, writing, doors");
A("self-checks: one waive_player and its grants, definers with search_path '', anon and member grants, RLS and column grants, triggers, columns, cron, watchdog, queue, copy, Season 1 rules",
  ["expected exactly one waive_player(uuid, boolean)", "must be SECURITY DEFINER with search_path", "anon can execute %", "authenticated can execute the internal %",
   "a client RPC lost its grant", "market_waivers must have RLS on and exactly one (SELECT) policy", "market_waivers grants are wrong",
   "needs its three live_mark triggers", "replacement_signings is missing a shortfall column", "the market-tick job must exist exactly once",
   "market_waivers grants are wrong: % has %", "market_waivers grants are wrong: % reads %",
   "the watchdog does not watch market-tick", "the approval queue does not carry the confirmation", "the Season 2 notice copy is missing",
   "season_rules(Season 1) changed", "Season 1 must not be a market season", "market_claim does not wait for the post-draft fill",
   "the post-draft fill does not take the club lock once, before it reads the roster"].every((t) => sql.indexOf(t) >= 0));
A("the grant self-check covers both API roles and every write privilege, and the one policy must be SELECT",
  /foreach r in array array\['anon', 'authenticated'\] loop\n\s+foreach pr in array array\['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'\] loop/.test(sql)
  && /foreach pr in array array\['waived_by', 'claimed_by', 'void_why'\] loop/.test(sql)
  && /\(select cmd from pg_policies where schemaname = 'public' and tablename = 'market_waivers'\) <> 'SELECT'/.test(sql));
A("Season 1's rules are compared to the literal captured before the change",
  /s1_rules constant jsonb := '\{"flex": null, "lines": null, "quota": \{"D": 5, "F": 7, "G": 3\}[^']*"trade_deadline_week": 4\}'::jsonb;/.test(sql));
A("no em dashes, no spaced hyphens in messages, no gendered pronouns, no S2 rule numbers, no dormant-rule word",
  !DASHES.test(sql) && !/ - /.test(messages) && !GENDERED.test(sql) && !/Rule S2/.test(sql) && !/abandon/i.test(sql));
A("Discord only through the doors (transactions, notify_discord, the DM lane); nothing posts straight to pg_net",
  !/net\.http_post|discord_http_post\(/.test(sql) && !/_announce_once/.test(sql));
A("no new Netlify function", !fs.readdirSync(path.join(root, "netlify/functions")).some((f) => /market/i.test(f)));

console.log("\n8. The rehearsal");
const reh = R(REH);
const embedded = (reh.match(/-- >>> record text: [^\n]*\n([\s\S]*?)-- <<< record text\n/) || [])[1] || "";
A("it carries the record's text byte for byte", embedded === sql.replace(/\n?$/, "\n"));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("it acts as each club's Owner and a commissioner through the API role", (reh.match(/set local role authenticated;/g) || []).length >= 5
  && /set local role anon;/.test(reh));
A("no claim-back, the cap and full-roster refusals, expiry by the tick, the deadline, RLS",
  ["T5 failed", "T6 failed", "T7 failed", "T10 failed: the tick did not clear the waiver", "T14 failed: a club claimed after the deadline", "T15 failed: anon read waived_by"]
    .every((t) => reh.indexOf(t) >= 0));
const world = (reh.match(/do \$w\$([\s\S]*?)end \$w\$;/) || [])[1] || "";
A("the world models the commissioner's Season 2 rollover while it is owed, under a commissioner's claims, and hand-expires nothing",
  /if exists \(select 1 from public\.contracts c where c\.status in \('active', 'signed'\) and not coalesce\(c\.is_manager, false\)\n\s+and c\.start_season < \(select s\.number from public\.seasons s where s\.id = v_s2\)\) then\n\s+perform set_config\('request\.jwt\.claims', json_build_object\('sub', v_c, 'role', 'authenticated'\)::text, true\);\n\s+perform public\.start_next_season\(v_s2\);/.test(world)
  && before(world, "start_next_season(v_s2)", "update public.teams set owner_profile_id") && !/update public\.contracts/.test(reh.replace(embedded, "")));
A("...and says why it needs an empty Season 2 (apply before the Dec 5 seating)", /This rehearsal needs an empty Season 2: rehearse and apply the waivers and minimums records before the Dec 5 seating/.test(world));
A("...and no Season 2 draft board (T23 runs the real fill)", /if exists \(select 1 from public\.draft_picks where season_number = 2\) then\n\s+raise exception 'world: Season 2 already has a draft board\./.test(world));
const t23 = (reh.match(/do \$t23\$([\s\S]*?)end \$t23\$;/) || [])[1] || "";
A("a claim before the post-draft fill is refused (T22); the real fill then takes the lock of the one club it works on, no other, and writes the mark (T23)",
  /if sqlerrm <> 'The post-draft fill for skipped picks runs first\. Claims open as soon as it has run\.' then raise; end if;/.test(reh)
  && before(reh, "do $t22$", "do $t23$") && before(reh, "do $t23$", "do $t5$")
  && /v_n := public\._place_for_unused_picks\(v_s2, 2\);/.test(t23)
  && /if v_held is distinct from array\['A'\] then raise exception 'T23 failed: before the fill/.test(t23)
  && /if v_held is distinct from array\['A', 'C'\] then/.test(t23)
  && before(t23, "is distinct from array['A'] then", "_place_for_unused_picks(v_s2, 2)") && before(t23, "_place_for_unused_picks(v_s2, 2)", "array['A', 'C']")
  && /T23 failed: the fill wrote no mark/.test(t23));
A("a private gp_credits row never becomes a public game (T10), the heartbeat's updated_at is bumped",
  /insert into public\.gp_credits \(season_id, profile_id, games, reason\) values \(v_s2, v_f3, 6,/.test(reh)
  && before(reh, "insert into public.gp_credits", "select * into p from public.market_pool(v_s2) mp where mp.profile_id = v_f3;")
  && /value <> 'stale' and updated_at >= now\(\)/.test(reh));
A("a member cannot write a waiver or read void_why (T15)", /T15 failed: a member wrote a waiver/.test(reh) && /T15 failed: a member read void_why/.test(reh));
A("a withdrawn sign-up, a ban and an office placement during the window: each claim gets the sentence, and the tick voids all three silently",
  ["office_withdraw_registration(current_setting('rh.reg_f1')::uuid", "select public.ban_player(current_setting('rh.f2')::uuid,", "T19 failed: ban_player did not ban F2",
   "T18 failed: a player whose sign-up was withdrawn was claimed", "T19 failed: a banned player was claimed",
   "T20 failed: a player already on a roster was claimed", "T21 failed: the tick did not void the three waivers at once",
   "T21 failed: a voided waiver was announced"].every((t) => reh.indexOf(t) >= 0)
  && (reh.match(/if sqlerrm not like '% can no longer be claimed: they are no longer in the training camp pool\.' then raise; end if;/g) || []).length === 3
  && /\(select count\(\*\) from net\.http_request_queue\) <> v_net/.test(reh)
  /* main session, 2026-11-24: a bare UPDATE of profiles.banned outside a commissioner's claims is put back by guard_profile_role */
  && !/update public\.profiles set banned/.test(reh.replace(embedded, "")));
A("the verdict block raises uncaught with every case named", /do \$v\$[\s\S]*raise exception 'REHEARSAL OK: T1 T2 T3 T4 T22 T23 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19 T20 T21';\nend \$v\$;\s*$/.test(reh)
  && !/do \$v\$[\s\S]*exception when/.test(reh));
A("no dblink, no http, and no member named (players are picked inside the transaction)",
  !/dblink|http_get|http_post\(/i.test(reh.replace(embedded, "")) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
