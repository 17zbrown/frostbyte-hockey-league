/* v4.58 (2026-11-24): Season 2 draft-night guards (the db-guards stream of the Season 2 swap). Rulings (commissioner,
   2026-11-23): cap $30M, "10 round draft", roster 12, minimums of "3 forwards, 2 defensemen, and 1 goalie" with no
   maximums, no club camps, no weekly game limits, a skipped pick "filled with a random assignment following the end of
   the draft" at $750K, and no depth placement, no latecomer or automatic placement and no free agency in Season 2.
   The record adds public.market_on, public.roster_min_gap (the one 3/2/1 definition) and public._unused_pick_fills
   (the one count of fills already made), the Season 2 keys of season_rules, the Season 2 cap and rounds, and
   market-season branches in the placement jobs, fa_open, the roster wording and the weekly-cap readers. After the
   adversarial review (2026-11-23): the unused-pick fill runs once and a pick it cannot fill lapses with its true reason
   (main-session decision D-FILL, pending the commissioner's confirmation); the rehearsal models the commissioner's
   rollover (D-ROLLOVER) and proves the placement gates with a positive control. Contract:
   ~/Developer/cghl-private/contracts/season-rules.md.
   This test reads the record and its rehearsal; the rehearsal runs on production (rolled back) by the main session.
   Run: node tools/s2-draft-night-guards-v458.test.cjs */
const fs = require("fs"), path = require("path");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + got)); } };
const ROOT = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REC = "sql/2026-11-24-s2-draft-night-guards-v458.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC), reh = R(REH);
const cut = sql.indexOf("\n/* REHEARSAL");
const applied = sql.slice(0, cut + 1);                       /* what the migration runs; the rehearsal result is appended after it */
const body = applied.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const rows = [...body.matchAll(/\((\d+), '([^']+)',\s*\$a\$([\s\S]*?)\$a\$,\s*\$b\$([\s\S]*?)\$b\$\)/g)].map((m) => ({ ord: +m[1], fn: m[2], a: m[3], b: m[4] }));
const row = (ord) => rows.find((r) => r.ord === ord) || { a: "", b: "", fn: "" };
const rowsOf = (fn) => rows.filter((r) => r.fn === fn);
const added = (r) => (r.b.indexOf(r.a) >= 0 ? r.b.replace(r.a, "") : r.b);   /* the text this record writes */
const linesKept = (r) => { let at = 0; return r.a.split("\n").every((l) => { const i = r.b.indexOf(l.trim(), at); if (i < 0) return false; at = i; return true; }); };
const between = (s, a, b) => { const i = s.indexOf(a); return i < 0 ? "" : s.slice(i, s.indexOf(b, i + a.length) + b.length); };

console.log("# the record");
A("one record, located by its version (file -v458, label v4.58; numbered by the main session at ship time)", /-v458\.sql$/.test(REC) && cut > 0);
A("24 anchored patches across 18 functions", rows.length === 24 && new Set(rows.map((r) => r.fn)).size === 18, rows.length + " / " + new Set(rows.map((r) => r.fn)).size);
A("every anchor must match exactly once, and 18 functions are re-created",
  /if n <> 1 then raise exception 'v4.58: % anchor % found % times'/.test(body) && /if v_fns <> 18 then raise exception/.test(body) && /execute v_def;/.test(body));
A("an anchor that quotes a live em dash spells it {emdash}, replaced before matching (so the file carries no dash)",
  /v_a := replace\(r\.a, '\{emdash\}', chr\(8212\)\);/.test(body) && /length\(replace\(v_def, v_a, ''\)\)\) \/ length\(v_a\)/.test(body) &&
  /v_def := replace\(v_def, v_a, r\.b\);/.test(body) && rows.filter((r) => r.a.indexOf("{emdash}") >= 0).length === 1);
A("a contended roster_spots lock fails in five seconds instead of stalling the site (set before the ALTER)",
  body.indexOf("set local lock_timeout = '5s';") > 0 && body.indexOf("set local lock_timeout = '5s';") < body.indexOf("alter table public.roster_spots"));
A("the patch table lives only for the transaction", /create temp table _s2guards_patch .* on commit drop;/.test(body));

console.log("\n# the contract helpers");
const mo = between(body, "create function public.market_on(", "$fn$;");
A("market_on: stable, invoker, search_path '', the season_rules key with false as the default",
  /^create function public\.market_on\(p_season uuid\)\nreturns boolean\nlanguage sql\nstable\nset search_path to ''\nas \$fn\$/.test(mo) &&
  /select coalesce\(\(public\.season_rules\(p_season\)->>'market'\)::boolean, false\)/.test(mo) && !/security definer/.test(mo));
A("market_on keeps EXECUTE for anon and authenticated (a gate helper)",
  /revoke all on function public\.market_on\(uuid\) from public;\ngrant execute on function public\.market_on\(uuid\) to anon, authenticated, service_role;/.test(body));
const gap = between(body, "create function public.roster_min_gap(", "end $fn$;");
A("roster_min_gap has the exact contract signature",
  gap.startsWith("create function public.roster_min_gap(p_season uuid, p_team uuid, p_plus_group text default null, p_minus_profile uuid default null)\nreturns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path to ''"));
A("roster_min_gap has no client grant",
  /revoke all on function public\.roster_min_gap\(uuid, uuid, text, uuid\) from public, anon, authenticated;/.test(body) && !/grant execute on function public\.roster_min_gap/.test(body));
A("roster_min_gap counts the active roster as pro_roster_count does (camp and loans out, Owner and GM in)",
  /rs\.season_id = p_season and rs\.team_id = p_team and rs\.status = 'active'/.test(gap) && /coalesce\(rs\.squad, 'pro'\) <> 'tc'/.test(gap) &&
  /coalesce\(rs\.origin, ''\) not in \('preseason_random', 'latecomer_random'\)/.test(gap) && /rs\.profile_id is distinct from p_minus_profile/.test(gap));
A("roster_min_gap measures shortfall against season_rules quota_min, and open against roster_max after the hypothetical",
  ["F", "D", "G"].every((k) => gap.indexOf("greatest(coalesce((r->'quota_min'->>'" + k + "')::int, 0) - " + k.toLowerCase() + ", 0)") >= 0 &&
    gap.indexOf(k.toLowerCase() + " := " + k.toLowerCase() + " + case when p_plus_group = '" + k + "' then 1 else 0 end;") >= 0) &&
  /return jsonb_build_object\('F', sf, 'D', sd, 'G', sg, 'short', sf \+ sd \+ sg, 'open', v_max - \(f \+ d \+ g\)\);/.test(gap) &&
  /v_max := \(r->>'roster_max'\)::int;/.test(gap));
A("roster_min_gap fails loud on a missing season, a missing club or a group that is not F, D or G",
  /raise exception 'roster_min_gap: there is no season %'/.test(gap) && /raise exception 'roster_min_gap: there is no club %'/.test(gap) &&
  /p_plus_group not in \('F', 'D', 'G'\)/.test(gap));
A("both helpers are created before the patches that call them", body.indexOf("create function public.market_on(") < body.indexOf("insert into _s2guards_patch") &&
  body.indexOf("create function public.roster_min_gap(") < body.indexOf("insert into _s2guards_patch"));
const upf = between(body, "create function public._unused_pick_fills(", "$fn$;");
A("_unused_pick_fills: the one count of fills already made, a stable definer with search_path '' and no client grant",
  upf.startsWith("create function public._unused_pick_fills(p_season uuid, p_team uuid)\nreturns integer\nlanguage sql\nstable\nsecurity definer\nset search_path to ''\nas $fn$") &&
  /revoke all on function public\._unused_pick_fills\(uuid, uuid\) from public, anon, authenticated;/.test(body) && !/grant execute on function public\._unused_pick_fills/.test(body) &&
  body.indexOf("create function public._unused_pick_fills(") < body.indexOf("insert into _s2guards_patch"));
A("...counted from roster history (distinct members, joined as a fill), so a fill waived or traded away still counts",
  /select count\(distinct rt\.profile_id\)::int\n    from public\.roster_tenures rt\n   where rt\.season_id = p_season and rt\.team_id = p_team and rt\.joined_how = 'postdraft_random'/.test(upf));
A("...the self-check proves its attributes, its grants and that no club has a Season 2 fill at apply time",
  /'public\._unused_pick_fills\(uuid,uuid\)'::regprocedure and p\.prosecdef and p\.provolatile = 's'/.test(body) &&
  /has_function_privilege\('authenticated', 'public\._unused_pick_fills\(uuid,uuid\)', 'execute'\)/.test(body) && /public\._unused_pick_fills\(s2\.id, t\.id\) <> 0/.test(body));

console.log("\n# season_rules and the Season 2 row");
const sr = row(1);
A("season_rules gains the market keys from Season 2, basic format only, after the season's own settings",
  sr.fn === "public.season_rules(uuid)" && sr.b.startsWith(sr.a) && /where s\.id = p_season and s\.number >= 2 and public\.season_format\(p_season\) = 'basic'\), '\{\}'::jsonb\)$/.test(sr.b));
A("...market true, no position maximums, minimums 3/2/1, no camps, no weekly caps (JSON null), the market constants",
  /'market', true,/.test(sr.b) && /'quota', jsonb_build_object\('F', s\.roster_max, 'D', s\.roster_max, 'G', s\.roster_max\),/.test(sr.b) &&
  /'quota_min', jsonb_build_object\('F', 3, 'D', 2, 'G', 1\),/.test(sr.b) && /'camp_max', 0,/.test(sr.b) &&
  /'cap_skater', null, 'cap_goalie', null, 'cap_camp', null,/.test(sr.b) &&
  /'mk', jsonb_build_object\('bid_open', 750000, 'bid_step', 250000, 'lot_seconds', 300, 'waiver_hours', 24,\s+'bid_gp', 6, 'opens', '21:00', 'new_until', '22:00'\)\)/.test(sr.b));
A("the market keys are merged unstripped, so the null caps override the format's figures", !/jsonb_strip_nulls/.test(added(sr)));
A("Season 2 is set to $30M and ten rounds, and only Season 2", /update public\.seasons set salary_cap = 30000000, draft_rounds = 10 where number = 2 and status = 'upcoming';/.test(body));
{
  const lit = (body.match(/if public\.season_rules\(s1\.id\) is distinct from '(\{[^']+\})'::jsonb then/) || [])[1];
  let s1 = null; try { s1 = JSON.parse(lit); } catch (e) { /* reported below */ }
  const want = { flex: null, lines: null, quota: { D: 5, F: 7, G: 3 }, weeks: 6, format: "basic", rights: false, camp_max: 10, cap_camp: 3, fa_window: false,
    preseason: false, cap_goalie: 6, cap_skater: 6, extensions: false, roster_max: 15, salary_cap: 50000000, series_cap: 4, draft_snake: true, pick_trades: false,
    draft_rounds: 12, min_service_gp: 0, playoff_min_gp: 14, playoff_best_of: 7, playoff_per_div: 3, max_contract_years: 1, trade_deadline_week: 4 };
  const norm = (o) => JSON.stringify(o, Object.keys(o || {}).sort());
  A("the self-check compares season_rules(Season 1) to the literal captured on production before the change",
    s1 && norm(s1) === norm(want) && JSON.stringify(s1.quota) === JSON.stringify(want.quota) && !("market" in s1) && !("quota_min" in s1), lit);
}
A("the self-check proves Season 2's keys, its caps null, and the ten-round pay ($18.75M, $3.00M to $0.75M) with Season 1's twelve unchanged",
  /v_r->'quota_min' is distinct from '\{"F":3,"D":2,"G":1\}'::jsonb/.test(body) && /v_r->'cap_skater' is distinct from 'null'::jsonb/.test(body) &&
  /v_sum <> 18750000 or public\.draft_pick_salary\(2, 1\) <> 3000000 or public\.draft_pick_salary\(2, 10\) <> 750000/.test(body) &&
  /v_sum <> 25500000 or public\.draft_pick_salary\(1, 1\) <> 3500000/.test(body) && /s2\.salary_cap <> 30000000 or s2\.draft_rounds <> 10 or s2\.roster_max <> 12/.test(body));
A("the self-check refuses to run over an existing Season 2 board", /exists \(select 1 from public\.draft_picks where season_number = 2\)/.test(body));
A("the self-check checks roster_min_gap against pro_roster_count on every club, on Season 2 (its roster_max) and on Season 1's real rosters",
  /\(g->>'open'\)::int <> s2\.roster_max - public\.pro_roster_count\(s2\.id, t\.id\)/.test(body) && !/<> 12 - public\.pro_roster_count/.test(body) &&
  /g := public\.roster_min_gap\(s1\.id, t\.id\);\n    if \(g->>'short'\)::int <> 0\n       or \(g->>'open'\)::int <> \(public\.season_rules\(s1\.id\)->>'roster_max'\)::int - public\.pro_roster_count\(s1\.id, t\.id\) then/.test(body));
A("the self-check refuses to apply over a Season 2 that already records a post-draft run", /c\.key = 'postdraft_done_' \|\| s2\.id::text\) then\n    raise exception 'v4.58 check: Season 2 already records a post-draft run/.test(body));
A("draft_pick_salary: a board still sizes the scale; before one, the season's own rounds, not the format's",
  row(2).fn === "public.draft_pick_salary(integer,integer)" && /public\.format_rules\(public\.season_format_n\(p_season_number\)\)->>'draft_rounds'/.test(row(2).a) &&
  /\(public\.season_rules\(\(select s\.id from public\.seasons s where s\.number = p_season_number\)\)->>'draft_rounds'\)::int\)\);$/.test(row(2).b) && !/max\(round\)/.test(row(2).a));

console.log("\n# placement after the draft (D-FILL: one run, then the pick lapses)");
const dist = row(4);
A("distribute_unproven_rookies: a market season returns only AFTER the unused picks are filled, before the depth round",
  dist.fn === "public.distribute_unproven_rookies(boolean)" && dist.b.indexOf(dist.a) > 0 &&
  /if public\.market_on\(v_season\.id\) then\n    perform set_config\('app\.roster_notice', '', true\);/.test(dist.b.slice(dist.b.indexOf(dist.a))) && /return v_n;\n  end if;$/.test(dist.b));
A("...and each club is told about its fills in one notice", /_club_batch_notices\(v_season\.id, 'postdraft_random', now\(\), 'sign', 'Unused draft picks filled',/.test(dist.b));
A("...once the fill has run, the office's forced run is refused in words BEFORE the fill is asked, not answered with zero",
  dist.b.indexOf("if p_force and public.market_on(v_season.id)\n     and exists (select 1 from public.app_config c where c.key = 'postdraft_done_' || v_season.id::text) then") >= 0 &&
  dist.b.indexOf("raise exception 'The fill for unused draft picks already ran after the draft, and it runs once.") < dist.b.indexOf(dist.a));
const up = rowsOf("public._place_for_unused_picks(uuid,integer)");
A("_place_for_unused_picks: seven anchors, the Season 1 lines kept", up.length === 7 && up.filter((r) => r.ord !== 9).every(linesKept));
A("...it still pays 750000 and still asks draft_fits (no anchor touches the insert; the draft_fits line survives)",
  !up.some((r) => /750000, 'postdraft_random'\)/.test(r.a)) && up.filter((r) => /draft_fits\(/.test(r.a)).every((r) => r.b.indexOf("and public.draft_fits(p_season, v_team.id, sr.profile_id) is null") >= 0));
const r5 = row(5).b;
A("...the market flag and the run mark are read once, at entry; the mark is the house key postdraft_done_<season>",
  /v_market boolean := public\.market_on\(p_season\); v_why text; v_left int;/.test(r5) && /v_done text := 'postdraft_done_' \|\| p_season::text;/.test(r5));
A("...the fill runs ONCE: under a lock, a recorded run returns at once, and a run before the draft is complete is refused",
  /if v_market then\n    perform pg_advisory_xact_lock\(hashtext\(v_done\)\);\n    if exists \(select 1 from public\.app_config c where c\.key = v_done\) then return 0; end if;/.test(r5) &&
  /ds\.status = 'complete'\) then\n      raise exception 'The fill for unused draft picks runs only once the Season % draft is complete\.'/.test(r5) &&
  /D-FILL, 2026-11-23, pending the commissioner's confirmation/.test(r5));
A("...the run is recorded after the fill, in the same transaction, and never overwritten",
  /if v_market then\n    insert into public\.app_config \(key, value\) values \(v_done, to_char\(now\(\) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'\)\);\n  end if;$/.test(row(11).b) &&
  !/on conflict/.test(added(row(11))));
A("...fills already made are the ONE count, public._unused_pick_fills (draft_fits reads it too), in a market season only",
  /if v_market then v_have := public\._unused_pick_fills\(p_season, v_team\.id\); end if;/.test(row(6).b) && !/roster_tenures/.test(added(row(6))));
A("...the fill takes an undrafted player only (no roster spot held this season), never a waived one",
  /and not \(v_market and exists \(select 1 from public\.roster_tenures rt where rt\.season_id = p_season and rt\.profile_id = sr\.profile_id\)\)/.test(row(8).b));
A("...a full roster is its own reason, tested before the cap and the candidate search; a capped club lapses too in a market season",
  /if v_market and \(public\.roster_min_gap\(p_season, v_team\.id\)->>'open'\)::int <= 0 then\n        v_why := 'full';\n        exit;\n      end if;\n      if not public\.cap_has_room/.test(row(7).b) &&
  /if v_market then v_why := 'cap'; exit; end if;   -- v4.58: lapses below, with its reason\n        v_capped := array_append\(v_capped, v_team\.code\);/.test(row(7).b));
A("...no candidate is the third reason", /if v_reg\.id is null then\n        if v_market then v_why := 'dry'; end if;   -- v4.58: lapses below, with its reason\n        exit;\n      end if;/.test(row(9).b));
const lapse = row(10).b;
A("...what the run could not fill lapses: the commissioners are told once per club, with the true reason",
  /v_left := v_owed - v_have - v_i;\n    if v_market and v_left > 0 then/.test(lapse) &&
  /raise exception 'v4.58: the unused-pick fill stopped for % with no reason recorded'/.test(lapse) &&
  /perform public\.notify_commissioners\(null, 'flag',\n        case when v_left = 1 then 'Unused draft pick lapsed' else 'Unused draft picks lapsed' end,/.test(lapse) &&
  ["when 'full' then 'its active roster was already full (", "when 'cap' then 'a league-minimum salary of $750K would carry it over the salary cap'",
   "else 'no undrafted player was left who fits its roster and keeps it able to reach the minimums of three forwards, two defensemen and one goaltender' end"].every((x) => lapse.indexOf(x) >= 0) &&
  /The fill after the draft runs once, so ' \|\|/.test(lapse) && / by a waiver claim or at Saturday bidding\.',/.test(lapse) &&
  /\n    v_why := null;\n  end loop;$/.test(lapse));
A("...no market text promises a later fill: the old cap row and the 'until the movement deadline' bells are gone",
  !/until the movement deadline|tries again every few minutes|rl_unused-pick-dry|The pick stays open/.test(body) &&
  !up.some((r) => /Those players are placed on other clubs instead/.test(r.a)));
A("auto_assign_latecomers: a market season places nobody, and the office's forced run is told why instead of reading zero",
  row(12).b.endsWith(row(12).a) && /if public\.market_on\(v_season\.id\) then\n    if p_force then\n      raise exception 'There is no automatic placement this season\./.test(row(12).b) && /return 0;\n  end if;/.test(row(12).b));
A("the sign-up trigger places nobody in a market season (the contract return above it is left as it is)",
  row(13).fn === "public.trg_autoassign_new_reg()" && row(13).b.endsWith(row(13).a) && /if public\.market_on\(v_season\.id\) then return new; end if;/.test(row(13).b));
A("preseason_random_assign no longer promises depth placement after the draft in a market season",
  row(14).fn === "public.preseason_random_assign()" && row(14).b.startsWith(row(14).a) &&
  /if public\.market_on\(v_season\.id\) then\n    raise exception 'There is no automatic placement this season\. Everyone registered by the cutoff enters the draft; anyone undrafted joins the training camp pool, and clubs add players by a waiver claim or at Saturday bidding\.';/.test(row(14).b));

console.log("\n# free agency");
A("fa_open is false in a market season before any other branch", row(3).fn === "public.fa_open(uuid)" &&
  /select case when public\.market_on\(s\.id\) then false\n              when public\.season_is_basic\(s\.id\) then$/.test(row(3).b));
const NOFA = "There is no free agency this season. Players off a roster are in the training camp pool, and clubs add them by a waiver claim or at Saturday bidding.";
A("sign_free_agent and offer_free_agent say what replaces free agency, BEFORE the approval gate (mgmt_gate); Season 1 is untouched",
  [[19, "public.sign_free_agent(uuid,bigint,uuid)"], [20, "public.offer_free_agent(uuid,bigint,integer,text,uuid)"]].every(([o, fn]) => row(o).fn === fn &&
    row(o).a === "  perform public.mgmt_gate(v_team.id, 'freeagents');" && row(o).b.endsWith(row(o).a) &&
    row(o).b.indexOf("if public.market_on(public.current_season_id()) then\n    raise exception '" + NOFA + "';\n  end if;\n  perform public.mgmt_gate(") >= 0));
A("respond_offer refuses to accept an open-market offer in a market season (it never asked fa_open)",
  row(21).b.startsWith(row(21).a) && /if public\.market_on\(v_season\.id\) then\n        raise exception 'There is no free agency this season, so this offer can no longer be accepted\./.test(row(21).b));

console.log("\n# roster wording (camp_max 0)");
A("place_new_roster_spot: a full roster says so and says waive, not 'training camp is full (0 players)'",
  /if public\.market_on\(NEW\.season_id\) then\n          raise exception 'The active roster is full \(% of % players\)\. This season has no club training camps, so waive a player first\.', n_all, v_max/.test(row(15).b));
A("guard_squad_move: a send-down is refused with the market wording, before the freeze and the camp count",
  row(16).b.endsWith(row(16).a) && /if NEW\.squad = 'tc' and public\.market_on\(NEW\.season_id\) then\n    raise exception 'This season has no club training camps\. Put the player on waivers instead\.'/.test(row(16).b));
A("check_roster_structure: the total is what binds, with no '12 forwards, 12 defensemen and 12 goaltenders' maximums",
  linesKept(row(17)) && /if public\.market_on\(v_season\) then\n      raise exception 'The active roster holds at most % players, and this move would leave the club with % \(%, % and %\)\. This season has no club training camps, so waive a player first\.',/.test(row(17).b));
A("...each count takes its own singular or plural word (never '1 goaltenders')",
  ["f || case when f = 1 then ' forward' else ' forwards' end", "d || case when d = 1 then ' defenseman' else ' defensemen' end",
   "g || case when g = 1 then ' goaltender' else ' goaltenders' end"].every((x) => row(17).b.indexOf(x) >= 0) && !/% goaltenders\)/.test(added(row(17))));
A("swap_roster_squad: no camp, nothing to swap, refused BEFORE the approval gate",
  row(18).b.endsWith(row(18).a) && /if public\.market_on\(a\.season_id\) then\n    raise exception 'This season has no club training camps, so there is no camp player to swap\.';\n  end if;\n  perform public\.mgmt_gate\(a\.team_id, 'roster'\);$/.test(row(18).b));
A("_club_batch_notices joins a club notice title with a colon, not a spaced em dash (every season)",
  row(24).fn === "public._club_batch_notices(uuid,text,timestamptz,text,text,text)" && row(24).a.indexOf("p_title || ' {emdash} ' || rr.n || ' player'") >= 0 &&
  row(24).b.indexOf("p_title || ': ' || rr.n || ' player'") >= 0);
A("set_roster_squad is left alone: its send-down reaches guard_squad_move, the one definition (proved in the rehearsal)",
  !rows.some((r) => /set_roster_squad/.test(r.fn)) && /perform public\.set_roster_squad\(v_t3f1, 'tc'\);/.test(reh));
A("the origin check gains the three market origins, after asserting the old list",
  /is distinct from \$o\$CHECK \(\(origin = ANY \(ARRAY\['assigned'::text, 'preseason_random'::text, 'draft'::text, 'free_agency'::text, 'rookie_random'::text, 'latecomer_random'::text, 'contract'::text, 'postdraft_random'::text, 'depth_random'::text\]\)\)\)\$o\$/.test(body) &&
  /'waiver_claim', 'market_bid', 'market_placed'\]\)\);/.test(body));

console.log("\n# weekly-cap null-safety (null means no limit)");
A("grant_cap_exception refuses when there is no limit to excuse", row(22).b.startsWith(row(22).a) &&
  /if v_cap is null then\n    raise exception '% has no game limit to excuse this season, so no exception is needed\.', v_name using errcode = '22023';/.test(row(22).b));
A("lineup_camp_warnings reads a null limit as no limit", row(23).b === "            < coalesce(public.weekly_cap(v_g.season_id, 'pro', pos_group(rs.position), v_g.stage), 2147483647)   /* v4.58: a null limit is no limit */");
A("the record lists every weekly_cap caller and why the rest need no change",
  ["_limit_forfeit_check", "review_game_records", "set_game_lineup", "series_cap", "check_playoff_violations", "_series_limit_sweep", "has_cap_exception",
   "revoke_cap_exception", "_limit_forfeit_excuse", "check_weekly_cap_violations", "grant_cap_exception", "lineup_camp_warnings"].every((f) => sql.indexOf(f) >= 0));

console.log("\n# every Season 2 branch tests market_on; Season 1 keeps its path");
A("each patched function except the season-agnostic null-safety fixes and the pick-pay fallback branches on market_on",
  rows.filter((r) => ![1, 2, 22, 23, 24].includes(r.ord)).every((r) => /public\.market_on\(|v_market/.test(r.b)) && /public\.season_format\(p_season\) = 'basic'/.test(sr.b));
A("the additive patches keep every Season 1 line, in order", rows.filter((r) => ![2, 3, 9, 23, 24].includes(r.ord)).every(linesKept),
  rows.filter((r) => ![2, 3, 9, 23, 24].includes(r.ord) && !linesKept(r)).map((r) => r.ord).join(","));
A("not this stream's objects: draft_fits, _draft_auto_advance, waive_player, guard_roster_waive, accept_trade, _place_trade_arrivals, announce_lifecycle",
  !rows.some((r) => /draft_fits|_draft_auto_advance|waive_player|guard_roster_waive|accept_trade|_place_trade_arrivals|announce_lifecycle/.test(r.fn)) &&
  !/create (or replace )?function public\.(draft_fits|_draft_auto_advance|waive_player|accept_trade)/.test(body));

console.log("\n# writing rules in the new text");
const fresh = rows.map(added).join("\n") + mo + gap + upf;
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
A("no em or en dashes anywhere in the record or the rehearsal", !DASHES.test(sql) && !DASHES.test(reh));
A("no spaced hyphens as punctuation in the new text", !/\w - \w/.test(fresh.replace(/v_max - \(f \+ d \+ g\)|, 0\) - [fdg], 0\)|now\(\) - interval|v_owed - v_have - v_i/g, "")));
A("neutral pronouns in the new text", !/\b(he|him|his|himself)\b/i.test(fresh));
A("no Season 2 rule numbers cited before rule-numbers.md exists", !/Rule S2\./.test(fresh) && !/Rule S2\./.test(reh));
A("American spelling in the new text", !/\b(defence|centre|colour|cancelled|licence|favour)\b/i.test(fresh));

console.log("\n# shipping");
{
  const note = sql.slice(cut);
  A("the record says it ships in ONE apply with the waive hold and db-draft's record, and never without draft_fits' 3/2/1 check",
    /APPLY: one apply_migration together with the Season 2 waive hold \(db-waivers\) and the Season 2 draft and front office\n   record \(db-draft\)/.test(note) &&
    note.indexOf("select position('roster_min_gap' in pg_get_functiondef('public.draft_fits(uuid,uuid,uuid)'::regprocedure)) > 0") >= 0 &&
    note.indexOf("position('_unused_pick_fills' in pg_get_functiondef('public.draft_fits(uuid,uuid,uuid)'::regprocedure)) > 0") >= 0);
  A("...and that its v4.58 all take this record's own number (no other record anchors on its text)",
    /every v4.58 in this file, its rehearsal and its test takes this record's own number\. No other\n   record anchors on text this record writes/.test(note));
}

console.log("\n# the rehearsal");
A("one transaction that applies the record's text verbatim, then the cases", /\n\nbegin;\n\n/.test(reh) && reh.indexOf(applied) > reh.indexOf("\nbegin;\n") && reh.indexOf(applied) >= 0);
A("deferred roster checks fire at each statement in the cases", reh.indexOf("set constraints all immediate;") > reh.indexOf(applied) + applied.length - 1);
{
  const cases = reh.slice(reh.indexOf(applied) + applied.length);
  const tail = cases.trim().split("\n").slice(-2).join("\n");
  A("it ends in an uncaught raise exception 'REHEARSAL OK: ...' with no outer handler",
    /^  raise exception 'REHEARSAL OK: [^']+';\nend \$rh\$;$/.test(tail) && !/^(commit|end|rollback)\s*;/im.test(cases) && (cases.match(/^do \$rh\$/gm) || []).length === 1);
  const handlers = (cases.match(/exception when others then/g) || []).length;
  const rethrows = (cases.match(/exception when others then\n\s+if sqlerrm (?:not like|<>) '[^\n]+' then raise; end if;\n\s+end;/g) || []).length;
  A("every expected refusal sits in an inner block that re-raises anything unexpected (" + handlers + " blocks)", handlers > 0 && handlers === rethrows, rethrows + " of " + handlers);
  A("every expected refusal fails the rehearsal if it does not happen", (cases.match(/raise exception 'R\d+b? FAILED: [^']+';\n\s+exception when others then/g) || []).length === handlers);
  A("no dblink, no http, no hard-coded member or club ids", !/dblink|http_get|http_post|net\.http/i.test(cases) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i.test(cases));
  A("it proves fa_open(Season 2) false once the draft is complete", /insert into public\.draft_state \(season_number, status, updated_at\) values \(2, 'complete'/.test(cases) && /if public\.fa_open\(s2\) then raise exception 'R3 FAILED/.test(cases));
  A("it proves a late Season 2 sign-up is placed by nobody (the trigger and the sweep), with the old branch's conditions true",
    /insert into public\.season_registrations \(season_id, profile_id, position\) values \(s2, v_late, 'C'\)/.test(cases) && /R4 setup: the old placement branch would not have run either/.test(cases) &&
    /v_n := public\.auto_assign_latecomers\(\);/.test(cases) && /perform public\.auto_assign_latecomers\(true\);/.test(cases));
  A("it runs only on an empty Season 2 (no roster spot, no seat holder), and says so",
    /raise exception 'rehearsal setup: Season 2 already has roster spots or a club has a seat holder; this rehearsal runs only before the Dec 5 seating';/.test(cases));
  {
    const roll = cases.indexOf("perform public.start_next_season(s2);");
    const stale = "if exists (select 1 from public.contracts c where c.status in ('active', 'signed') and not coalesce(c.is_manager, false) and c.start_season < 2) then";
    A("D-ROLLOVER: the commissioner's rollover is modeled at the top of the cases, only while it is still owed, under a commissioner's claims",
      roll > 0 && cases.indexOf(stale) >= 0 && cases.indexOf(stale) < roll && roll < cases.indexOf("-- R1 ") &&
      /perform set_config\('request\.jwt\.claims', json_build_object\('sub', v_comm, 'role', 'authenticated'\)::text, true\);\n    perform public\.start_next_season\(s2\);\n    perform set_config\('request\.jwt\.claims', '', true\);/.test(cases) &&
      /raise exception 'rehearsal setup: the rollover left Season 1 player contracts active';/.test(cases));
    A("...and no contract is expired by hand", !/update public\.contracts/.test(cases));
  }
  A("R4 picks a member the OLD branch would place: never drafted in any season, no contract covering Season 2",
    /and not exists \(select 1 from public\.draft_picks dp where dp\.player_id = p\.id\)\n     and not exists \(select 1 from public\.contracts c where c\.profile_id = p\.id and c\.status in \('active', 'signed'\)/.test(cases));
  A("...its setup assertion holds every old condition, the draft pick, the contract and the ban included",
    /and not exists \(select 1 from public\.draft_picks dp where dp\.player_id = v_late\)/.test(cases) &&
    /c\.start_season <= s2row\.number and c\.end_season >= s2row\.number\)/.test(cases) &&
    /and not public\.placement_closed\(s2\) and not public\.is_suspended\(v_late\) and not public\.is_banned\(v_late\)\n            and public\.camp_max\(s2\) = 3\) then\n      raise exception 'R4 setup: the old placement branch would not have run either';/.test(cases));
  A("...camp_max 0 alone would starve the old path, so Season 2 is lent camp places inside a block its closing raise undoes",
    /create or replace function public\.camp_max\(p_season uuid\) returns integer language sql stable set search_path to 'public'\n      as \$lend\$ select 3 \$lend\$;/.test(cases) &&
    /raise exception 'R4 control: the old path seats this sign-up/.test(cases) && /if sqlerrm not like 'R4 control: %' then raise; end if;/.test(cases));
  A("...under the loan the trigger and the sweep place nobody, the trigger does not even try, and the old path itself DOES seat them (the positive control)",
    /\(select count\(\*\) from public\.notifications where title = 'Late sign-up not placed'\) <> v_cnt then/.test(cases) &&
    /if public\._assign_reg_random\(v_late_reg, 'latecomer_random', false, 'fill'\)\n       and exists \(select 1 from public\.roster_spots where season_id = s2 and profile_id = v_late and origin = 'depth_random'\) then/.test(cases) &&
    /raise exception 'R4 FAILED: the old placement path could not seat the late sign-up either, so R4 would prove nothing';\n  exception when others then/.test(cases));
  A("R5 (D-FILL): one run fills the one undrafted player at $750K, never the player let go, and no depth row",
    /update public\.seasons set signup_deadline_at = v_c_at where id = s2;/.test(cases) &&
    /v_n := public\.distribute_unproven_rookies\(\);/.test(cases) && /v_fill is distinct from v_c/.test(cases) && /rs\.salary = 750000 and rs\.squad = 'pro'/.test(cases) &&
    /origin = 'depth_random' or profile_id = v_w/.test(cases));
  A("...the full club and the dry club are each told once, with the true reason; the club notice title carries no dash",
    /because its active roster was already full \(12 of 12 players\)\. The fill after the draft runs once, so the pick lapses%/.test(cases) &&
    /because no undrafted player was left who fits its roster%/.test(cases) && /count\(distinct n\.body\)/.test(cases) &&
    /title = 'Unused draft picks filled: 1 player'/.test(cases));
  A("...a later run fills nothing (a waived fill, a lapsed pick, a reopened spot), the fill still counts, and the office's forced run is refused",
    /R5 FAILED: a lapsed pick or a waived fill was filled on a later run, or a lapse was reported twice/.test(cases) &&
    /R5 FAILED: the fill the club let go no longer counts as filling its pick/.test(cases) && /perform public\.distribute_unproven_rookies\(true\);/.test(cases) &&
    /if sqlerrm not like 'The fill for unused draft picks already ran after the draft, and it runs once\.%' then raise; end if;/.test(cases));
  A("it proves roster_min_gap: empty, minimums met, short a goalie, plus a player, minus a player",
    ['{"F":3,"D":2,"G":1,"short":6,"open":12}', '{"F":0,"D":0,"G":0,"short":0,"open":6}', '{"F":0,"D":0,"G":1,"short":1,"open":7}', '{"F":0,"D":1,"G":1,"short":2,"open":8}'].every((j) => cases.indexOf(j) >= 0) &&
    /roster_min_gap\(s2, t\[4\], 'G'\)/.test(cases) && /roster_min_gap\(s2, t\[4\], null, ds\[3\]\)/.test(cases));
  A("it proves the origin check accepts the three new origins and still refuses others",
    /'waiver_claim'\), \(s2, t\[3\], fs\[2\], 2, 'LW', 750000, 'market_bid'\),/.test(cases) && /'market_placed'\)/.test(cases) && /'bogus'/.test(cases));
  A("R8 pins the singular goaltender in the shape message", cases.indexOf("leave the club with 13 (10 forwards, 2 defensemen and 1 goaltender).%") >= 0 && cases.indexOf("1 goaltenders") < 0);
  A("R8b no longer claims coverage of lineup_camp_warnings (unreachable in a market season)", !/lineup_camp_warnings\(v_game/.test(cases) && /is defensive only/.test(cases));
  A("it proves the ten-round pay and Season 1 untouched", /draft_pick_salary\(2, 10\) <> 750000/.test(cases) && /R9 FAILED: Season 1 moved/.test(cases));
}

console.log("\n" + (n - fail) + "/" + n + " passed");
if (fail) process.exit(1);
