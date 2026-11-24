/* v4.61: the Season 2 playoff rules. node tools/s2-playoff-rules-v461.test.cjs
   Commissioner, 2026-11-24: "A player can play up to 4 games in a series, but can only play 2 of the first 4 games in each
   series. Goalies included." And: "to be playoff eligible, a player must play at least 6 games at their signed up position
   group, so forward, defense, or goalie." Season 2 on only; Season 1 keeps every-position counting and its floor of 14.
   Pins the record (the count toward the floor, the first-four rule, the goaltender exemption, the four patched
   functions, the board twin, the self-checks) and its rehearsal. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");
const GENDERED = /\b(he|his|him|she|her|hers|himself|herself)\b/i;

const REC = "sql/2026-11-24-s2-playoff-rules-v461.sql";
const REH = REC.replace(/\.sql$/, ".rehearsal.sql");
const sql = R(REC);
const fn = (name) => { const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\$f\\$([\\s\\S]*?)\\$f\\$;")); return m ? m[1] : ""; };
const tag = (src, t) => { const m = src.match(new RegExp("\\$" + t + "\\$([\\s\\S]*?)\\$" + t + "\\$")); return m ? m[1] : ""; };
const before = (s, a, b) => s.indexOf(a) >= 0 && s.indexOf(b) >= 0 && s.indexOf(a) < s.indexOf(b);
const count = (s, a) => s.split(a).length - 1;
const patches = tag(sql, "p");
const board = (sql.match(/create or replace function public\.playoff_eligibility_board\(p_season uuid\)[\s\S]*?\$function\$([\s\S]*?)\$function\$;/) || [])[1] || "";
/* the line-group rule, written once in the count and restated per group by the board's filters */
const GROUP = "(case when coalesce(gs.is_goalie, false) then 'G' when public.pos_group(gs.position) = 'D' then 'D' else 'F' end)";

console.log("1. The rulings and the preconditions");
A("the header quotes the series ruling word for word", sql.includes('"A player can play up to 4 games in a series, but can only play 2 of the first 4 games in each series. Goalies\n--   included."'));
A("the header quotes the eligibility ruling word for word", sql.includes('"Remember, players sign up for a position and are expected to play there, but we allow players to play any position\n--   on any given night, but to be playoff eligible, a player must play at least 6 games at their signed up position\n--   group, so forward, defense, or goalie."'));
A("the kept rulings are named: box scores only (v4.47), six prorated (v3.94, v4.00), every line counts, the private adjustments",
  /only base scheduling off box\n-- scores/.test(sql) && /\(v3\.94, rounded at\n-- \.4 by v4\.00\)/.test(sql) && /every line counts/.test(sql) && /never shown to anyone outside the circle/.test(sql));
A("it refuses to run before v4.47, v4.57, v4.58 and the privacy fix, and on a Season 1 that reads as a market season",
  ["v4.47, v4.57 and v4.58 must be applied first", "Season 1 reads as a market season", "Season 2 is not a market season yet", "apply the 2026-11-24 privacy fix first"].every((t) => sql.includes(t)));

console.log("\n2. The registered group");
const rg = fn("_registered_group");
A("the season's sign-up first, then the roster spot, then the latest archived spot; never a null into pos_group (it reads a null as a forward)",
  before(rg, "from public.season_registrations r where r.season_id = p_season and r.profile_id = p_profile",
         "from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = p_profile")
  && before(rg, "from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = p_profile",
            "from public.roster_spot_removals rr where rr.season_id = p_season and rr.profile_id = p_profile")
  && /order by rr\.removed_at desc, rr\.id desc limit 1\)\) pos\) x/.test(rg)
  && /select public\.pos_group\(x\.pos\)/.test(rg) && /where x\.pos is not null\s*$/.test(rg));
A("the comment says the sign-up wins when it and the spot disagree", /When the sign-up and the spot disagree \(a\n\s+player rostered at another group\), the sign-up wins/.test(rg));

console.log("\n3. The count toward the floor (playoff_eligibility_gp)");
const gp = fn("playoff_eligibility_gp");
A("a season without the market reads regular_gp, unchanged", /select case when not public\.market_on\(p_season\) then public\.regular_gp\(p_season, p_profile\)/.test(gp));
A("from Season 2: regular-season finals, not voided, with a line at the registered group, the group read once",
  /coalesce\(g\.stage, 'regular'\) = 'regular'/.test(gp) && /g\.status = 'final' and not coalesce\(g\.voided, false\)/.test(gp)
  && gp.includes("and " + GROUP + "\n                           = (select public._registered_group(p_season, p_profile)))") && /count\(distinct g\.id\)::int/.test(gp));
A("in goal by game_stats.is_goalie, a skater by the recorded position (standing order: never the registered position for a line)",
  GROUP.indexOf("gs.is_goalie") < GROUP.indexOf("gs.position") && !/rs\.position|r\.position/.test(gp));
A("the office's adjustments are added as regular_gp adds them", /\+ coalesce\(\(select sum\(c\.games\)::int from public\.gp_credits c\n\s+where c\.season_id = p_season and c\.profile_id = p_profile\), 0\)/.test(gp));
A("SECURITY DEFINER with search_path '' (it reads gp_credits)", /create or replace function public\.playoff_eligibility_gp\(p_season uuid, p_profile uuid\)\n returns integer\n language sql\n stable\n security definer\n set search_path to ''/.test(sql));

console.log("\n4. Two of the first four (series_early_games)");
const se = fn("series_early_games");
/* the ruling's 2 is written once, here: a change to it is this one value (and this pin, which states the ruling) */
A("the ONE place the two and the four are written, behind market_on and the playoff stage; the ruling is 2",
  /\n\s+2 cap,\s+-- the ruling's 2 \("can only play 2 of the first 4"\): written here only; the gate, sweep and flag read it\n\s+4 first_n\s+-- the first 4\n\s+from g0\n\s+where g0\.stage = 'playoff' and public\.market_on\(g0\.season_id\)\n\s+and exists \(select 1 from first4 f where f\.id = g0\.id\)/.test(se)
  && !/v_early_n >= 2|v_early_n > 2|of the first 4 games|'first_games', 4|from game 5|game five/.test(patches.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "")));
A("a series is the round between the same two clubs; voided games take no number; numbered by puck drop then id",
  /g\.week = g0\.week/.test(se) && /least\(g\.home_team_id, g\.away_team_id\) = g0\.lo/.test(se) && /greatest\(g\.home_team_id, g\.away_team_id\) = g0\.hi/.test(se)
  && /where not coalesce\(g\.voided, false\)\n\s+order by g\.scheduled_at, g\.id\n\s+limit 4\)/.test(se));
A("counted the way player_week_games counts the series: final or held, not exempt, a box-score line, the excluded game left out",
  /\(f\.status = 'final' or \(f\.status = 'scheduled' and f\.ea_match_id is not null\)\)/.test(se) && /not coalesce\(f\.limits_exempt, false\)/.test(se)
  && /\(p_exclude_game is null or f\.id <> p_exclude_game\)/.test(se) && /exists \(select 1 from public\.game_stats gs where gs\.game_id = f\.id and gs\.profile_id = p_profile\)/.test(se)
  && /\(g\.status = 'final' or \(g\.status = 'scheduled' and g\.ea_match_id is not null\)\)/.test(R("sql/2026-10-15-review-at-game-time-v414.sql")));
A("no position exemption: a goaltender is counted like everyone else", !/is_goalie|'G'/.test(se) && /A goaltender is counted like everyone else/.test(se));
A("the four new helpers carry no client grant", ["_registered_group(uuid, uuid)", "playoff_eligibility_gp(uuid, uuid)", "series_early_games(uuid, uuid, uuid)", "_playoff_floor_exempt(uuid, uuid, uuid)"]
  .every((f) => sql.includes("revoke all on function public." + f + " from public, anon, authenticated;") && sql.includes("grant execute on function public." + f + " to service_role;"))
  && !/grant execute on function public\.(_registered_group|playoff_eligibility_gp|series_early_games|_playoff_floor_exempt)[^;]*(anon|authenticated)/.test(sql));

console.log("\n4b. The Rule 2.4 goaltender exemption (_playoff_floor_exempt)");
const ex = fn("_playoff_floor_exempt");
A("v4.17's test, the same rows: a goaltender's spot on that club made after signings closed",
  /where rs\.season_id = p_season and rs\.team_id = p_team and rs\.profile_id = p_profile and rs\.position = 'G'\n\s+and rs\.created_at > coalesce\(public\.fa_moves_close_at\(p_season\), 'infinity'::timestamptz\)\)/.test(ex)
  && /a season has one roster spot per player/.test(ex));
A("one definition: the gate and the flag both read it, and the gate's inline copy is gone",
  count(patches, "public._playoff_floor_exempt(") === 2 && /b := \$b\$         and not public\._playoff_floor_exempt\(v_game\.season_id, p_team, v_p\) then   -- v4\.17: seated after signings closed \(Rule 2\.4\); v4.61: one definition\n\$b\$;/.test(patches)
  && /a := \$a\$         and not \(v_pos = 'G' and exists \(select 1 from public\.roster_spots rs where rs\.season_id = v_game\.season_id/.test(patches));

console.log("\n5. The patches");
A("thirteen anchors, each asserted to match exactly once, executed once per function",
  count(patches, "times, expected exactly 1', n; end if;") === 13 && count(patches, "execute replace(v_def, a, b);") === 4);
A("award_eligible counts with playoff_eligibility_gp", /select public\.playoff_eligibility_gp\(p_season, p_profile\) >= public\.player_playoff_floor\(p_season, p_profile\)   -- v3\.94: prorated\n\$b\$;/.test(patches));
const sgl = patches.slice(patches.indexOf("-- 6. set_game_lineup"), patches.indexOf("-- 7. _series_limit_sweep"));
A("set_game_lineup: the first-four rule opens the playoff branch, before the floor, and a recorded office exception passes it",
  before(sgl, "if v_game.stage = 'playoff' then\n      /* v4.61 (commissioner, 2026-11-24)", "from public.series_early_games(p_game, v_p, p_game) e;")
  && before(sgl, "from public.series_early_games(p_game, v_p, p_game) e;", "      /* Rule 8.3: a games-played floor for the playoffs where the season publishes one (v2.67:\n$b$;")
  && /if v_early_cap is not null and v_early_n >= v_early_cap and not public\.has_cap_exception\(p_game, v_p\) then/.test(sgl));
A("set_game_lineup: the refusal names the count, the window and the cap from the one definition",
  /raise exception '% has already played % of the first % games of this series; a player may play % of them \(Rule 8\.3\)\.',\n\s+v_name, v_early_n, v_early_of, v_early_cap using errcode = '22023';/.test(sgl));
A("set_game_lineup: the floor gate counts with playoff_eligibility_gp (regular_gp in Season 1)",
  /a := \$a\$         and public\.regular_gp\(v_game\.season_id, v_p\) < public\.player_playoff_floor\(v_game\.season_id, v_p\)\n\$a\$;\n\s+b := \$b\$         and public\.playoff_eligibility_gp\(v_game\.season_id, v_p\) < public\.player_playoff_floor\(v_game\.season_id, v_p\)/.test(sgl));
A("set_game_lineup: in a market season the refusal names the registered group; the Season 1 sentence is left as it is",
  /if public\.market_on\(v_game\.season_id\) then\n\s+raise exception '% has % regular-season games %, their registered position group; the playoffs need % \(Rule 8\.3\)\.',/.test(sgl)
  && /\(case public\._registered_group\(v_game\.season_id, v_p\) when 'G' then 'in goal' when 'D' then 'at defense' else 'at forward' end\)/.test(sgl)
  && /\$b\$ \|\| a;/.test(sgl) && /a := \$a\$        raise exception '% has % regular-season games\$a\$;/.test(sgl));
A("the shortcut is marked: the office cannot yet record an exception for the first-four rule alone",
  /-- shortcut: the office cannot record an exception for the first-four rule alone \(grant_cap_exception counts toward the\n\s+-- cap of four, which nobody reaches before game five\), revisit when the commissioner rules whether the office may excuse it/.test(sgl)
  && /grant_cap_exception records one only at the cap of four/.test(sgl) && !/lets them past it/.test(sql));
const sw = patches.slice(patches.indexOf("-- 7. _series_limit_sweep"), patches.indexOf("-- 8. check_playoff_violations"));
A("the sweep: a player at two of the first four comes off the rest of those four, once, unless excused",
  /from public\.series_early_games\(s\.game_id, v_pid, null\) e;/.test(sw)
  && /if v_early_cap is not null and v_early_n >= v_early_cap and not \(v_pid = any\(v_out\)\)\n\s+and not public\.has_cap_exception\(s\.game_id, v_pid\) then/.test(sw)
  && /perform public\._notify_lineup_pulled\(s\.game_id, s\.team_id, array\[v_pid\],/.test(sw) && /'first_games', v_early_of/.test(sw)
  && /Sheets for games five to seven stay/.test(sw));
A("the sweep tells the first-four pull as itself, to the player and the club, with game five open",
  /v_early_names := coalesce\(v_early_names \|\| ', ', ''\)/.test(sw) && /v_early_k := v_early_k \+ 1;/.test(sw)
  && /b := a \|\| \$b\$    v_early_names := null; v_early_k := 0;\n\$b\$;/.test(sw)
  && /You may be dressed again from game ' \|\| \(v_early_of \+ 1\) \|\| ' \(Rule 8\.3\)\.'\);/.test(sw)
  && /'First games of the series: your lineup changed',/.test(sw) && /The limit is on those games only: they may be dressed again from game ' \|\| \(v_early_of \+ 1\)/.test(sw));
A("the cap of four's club notice keeps v4.47's sentence, its has/have counting only its own players",
  /if v_names is not null then   -- v4.61: the cap of four, v4\.47's sentence \(with the tail above\)\n\s+perform public\.club_notify\(s\.team_id, 'lineups', 'Series limit reached: your lineup changed',\n\s+v_names \|\| case when array_length\(v_out, 1\) - v_early_k = 1 then ' has' else ' have' end\n\s+\|\| ' reached the playoff series limit by the box scores and came off your lineup for ' \|\| v_fix \|\| '\.' \|\| v_tail,/.test(sw));
A("from Season 2, while the lock is ahead, the club refills by the lineup lock (the sheet is judged there); after it, by puck drop",
  /if public\.market_on\(p_season\) and now\(\) < s\.scheduled_at - interval '30 minutes' then\n\s+v_tail := ' Fill the open spot before the lineup lock at '/.test(sw)
  && /b := \$b\$                   else ' Fill the open spot before puck drop \(Rule 8\.3\)\.' end;/.test(sw));
A("the sweep keeps v4.47's model: no filed sheet is counted, the pull rides the same lock and audit row, and every club notice stays off Discord (p_room false)",
  !/game_lineups/.test(sw.replace(/\/\*[\s\S]*?\*\//g, "")) && !/log_admin_action/.test(sw)
  && (sw.match(/perform public\.club_notify\(/g) || []).length === 3
  && (sw.match(/null, 'lineup', s\.game_id::text, null, false\);/g) || []).length === 3);
const vi = patches.slice(patches.indexOf("-- 8. check_playoff_violations"));
A("a final among the first four past two flags the commissioners with an audit row, unless excused",
  /if v_early_cap is not null and v_early_n > v_early_cap and not public\.has_cap_exception\(new\.id, r\.profile_id\) then/.test(vi)
  && /perform public\.notify_commissioners\(null, 'flag', 'Playoff series limit: the first four games \(Rule 8\.3\)',/.test(vi)
  && /perform public\.log_admin_action\('playoff_violation_series_early','game',new\.id::text,/.test(vi));
A("from Season 2 a final flags a player below the floor at their registered group, unless exempt, with the gate's three definitions",
  /if public\.market_on\(new\.season_id\) then\n\s+v_floor := public\.player_playoff_floor\(new\.season_id, r\.profile_id\);\n\s+v_elig := public\.playoff_eligibility_gp\(new\.season_id, r\.profile_id\);\n\s+if v_floor > 0 and v_elig < v_floor and not public\._playoff_floor_exempt\(new\.season_id, r\.team_id, r\.profile_id\) then/.test(vi)
  && /perform public\.notify_commissioners\(null, 'flag', 'Playoff eligibility \(Rule 8\.3\)',/.test(vi)
  && /perform public\.log_admin_action\('playoff_violation_ineligible','game',new\.id::text,/.test(vi));
A("a failed check is heard: the commissioners are told, inside its own handler, as _series_limit_safe does",
  /raise warning 'check_playoff_violations failed for game %: %', new\.id, sqlerrm;\n\s+\/\* v4.61: fail loud/.test(vi)
  && /perform public\.notify_commissioners\(null, 'flag', 'The playoff violation check failed',/.test(vi)
  && /exception when others then\n\s+raise warning 'check_playoff_violations could not tell the commissioners: %', sqlerrm;\n\s+end;\n\s+end;\n\$b\$;/.test(vi));
A("the patches declare their variables", count(patches, "v_early_n int; v_early_cap int; v_early_of int;") === 3
  && /v_early_names text; v_early_k int := 0;/.test(sw) && /v_floor int; v_elig int;/.test(vi));

console.log("\n6. The board twin (playoff_eligibility_board)");
A("v4.57's comments stay, and the v4.00 ruling", board.includes("Change it together with those three.") && board.includes('"Round down at .4"'));
A("the market flag comes from market_on; a season without it counts as before", /public\.market_on\(p_season\) mk\)/.test(board) && /case when not se\.mk then l\.n/.test(board));
A("the per-group counts restate the count's rule, and only a market season calls pos_group",
  /filter \(where se\.mk and coalesce\(gs\.is_goalie, false\)\)\)::int n_g/.test(board)
  && /filter \(where se\.mk and not coalesce\(gs\.is_goalie, false\) and public\.pos_group\(gs\.position\) = 'D'\)\)::int n_d/.test(board)
  && /filter \(where se\.mk and not coalesce\(gs\.is_goalie, false\) and public\.pos_group\(gs\.position\) <> 'D'\)\)::int n_f/.test(board)
  && /when 'G' then l\.n_g when 'D' then l\.n_d when 'F' then l\.n_f end\), 0\)/.test(board));
A("every player with a line keeps a row (no group filter on the rows)", /from lines l cross join se\)/.test(board) && !/where[^\n]*_registered_group/.test(board));
const v457 = R("sql/2026-11-24-title-board-setbased-v457.sql");
const tail = (s) => { const i = s.indexOf("  -- player_playoff_floor: the FIRST roster spot this season"); return i >= 0 ? s.slice(i, s.indexOf("$function$;", i)) : null; };
A("the floor, proration, adjustments and suspension test are v4.57's text byte for byte", tail(board + "$function$;") !== null && tail(board + "$function$;") === tail(v457));
A("the board keeps no client grant", /revoke all on function public\.playoff_eligibility_board\(uuid\) from public, anon, authenticated;\ngrant execute on function public\.playoff_eligibility_board\(uuid\) to service_role;/.test(sql));

console.log("\n7. Self-checks");
const chk = tag(sql, "chk");
A("Season 1 reads as before: board, award eligibility, the count is regular_gp, rules, no first-four rule",
  ["the board changed for a season without the market", "award eligibility changed for a season without the market",
   "the count toward the floor is not regular_gp in a season without the market", "season_rules changed for a season without the market",
   "the first-four rule applies to a season without the market"].every((t) => chk.includes(t))
  && /create temp table _vnnn_board_before as/.test(sql) && /drop table _vnnn_board_before, _vnnn_award_before, _vnnn_rules_before;/.test(sql));
A("the twin agrees with the single-player definitions for every player of every season",
  /e\.gp is distinct from public\.playoff_eligibility_gp\(s\.id, e\.profile_id\)/.test(chk) && /e\.floor_gp is distinct from public\.player_playoff_floor\(s\.id, e\.profile_id\)/.test(chk)
  && /e\.eligible is distinct from public\.award_eligible\(s\.id, e\.profile_id\)/.test(chk));
A("the patches, the grants, search_path and the definer are checked", ["set_game_lineup is not as patched", "award_eligible is not as patched", "_series_limit_sweep is not as patched",
  "check_playoff_violations is not as patched", "is callable through the API", "must run with search_path", "a patched client door lost its grant",
  "playoff_eligibility_gp must be SECURITY DEFINER"].every((t) => chk.includes(t))
  && /'public\._playoff_floor_exempt\(uuid,uuid,uuid\)'/.test(chk) && /playoff_violation_ineligible/.test(chk) && /First games of the series: your lineup changed/.test(chk));
A("the search_path check cannot pass a null (no search_path at all)", /\(select p\.proconfig from pg_proc p where p\.oid = f::regprocedure\) is distinct from array\['search_path=""'\]/.test(chk)
  && !/proconfig from pg_proc p where p\.oid = f::regprocedure\) <>/.test(chk));

console.log("\n8. What it leaves alone");
A("no new text for the floor, games played, the cap, the series count, the floor read, the waive check or the exception door",
  ["player_playoff_floor", "regular_gp", "series_cap", "player_week_games", "playoff_floors", "can_move_player", "grant_cap_exception", "season_rules"]
    .every((f) => !new RegExp("create or replace function public\\." + f + "\\(").test(sql) && !patches.includes("pg_get_functiondef('public." + f + "(")));

console.log("\n9. Writing rules and doors");
/* the $a$ anchors are the live text being matched, not this record's prose; one of them (repeated at the end of its $b$)
   opens a comment it does not close, so a comment never runs across a $b$ boundary */
const own = sql.replace(/\$a\$[\s\S]*?\$a\$/g, "");
const prose = [(own.match(/^\s*--.*$/gm) || []).join("\n"), (own.match(/\/\*(?:(?!\$b\$)[\s\S])*?\*\//g) || []).join("\n"),
  (own.match(/'(?:[^'\n]|'')*'/g) || []).filter((s) => / \w+ /.test(s)).join("\n")].join("\n");
A("no dashes, no spaced hyphens, neutral pronouns, no Rule S2 number, nothing of the dormant work",
  !DASHES.test(sql) && !/ - /.test(prose) && !GENDERED.test(sql) && !/Rule S2/.test(sql) && !/abandon/i.test(sql));
A("no Discord door is opened here (only the existing site notices; club_notify only with p_room false)",
  !/net\.http_post|discord_http_post\(|notify_discord|_announce_once|notify_staff_ch/.test(sql)
  && (own.match(/club_notify\(/g) || []).length === 2 && (own.match(/null, 'lineup', s\.game_id::text, null, false\);/g) || []).length === 2);
A("no member is named and no id is written", !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(sql) && !/gp_credits[^;\n]*insert|insert into public\.gp_credits/.test(sql));

console.log("\n10. The rehearsal");
const reh = R(REH);
const embedded = (reh.match(/-- >>> record text: [^\n]*\n([\s\S]*?)-- <<< record text\n/) || [])[1] || "";
const applied = sql.slice(0, sql.indexOf("\n/* REHEARSAL") + 1);   // what the migration runs; the results are written after it
A("it carries the record's text byte for byte, up to the REHEARSAL note", sql.indexOf("\n/* REHEARSAL") > 0 && embedded === applied);
A("Season 1's reads are taken before the record runs", before(reh, "create temp table _rh_s1_board as", "-- >>> record text: ") && before(reh, "create temp table _rh_s1_titles as", "-- >>> record text: "));
A("one transaction: begins once and never commits", (reh.match(/^begin;$/gm) || []).length === 1 && !/^(commit|end)\s*;/im.test(reh));
A("its prerequisites are stated and checked: an empty Season 2, the rollover, the floor of 6 and the cap of 4",
  /Season 2 must still be empty: no games and no roster spots/.test(reh) && /This rehearsal needs an empty Season 2/.test(reh)
  && /the Season 2 rollover must run first/.test(reh) && /Season 2 is not at a floor of 6 and a series cap of 4 for everyone/.test(reh));
A("the world: every spot before every game (full floors), the restarted game, the office adjustment, a seven-game series",
  before(reh, "insert into public.roster_spots (season_id, team_id, profile_id", "insert into public.games (season_id, week, stage, home_team_id, away_team_id, scheduled_at, status, home_score, away_score)")
  && /v_day0 timestamptz := date_trunc\('day', now\(\)\) \+ interval '3 days';/.test(reh)
  && /\(v_t\[1\], v_g\[1\], 'C',  false, 6, 6\)/.test(reh) && /insert into public\.gp_credits/.test(reh) && /for k in 1\.\.7 loop/.test(reh));
A("every id comes from RETURNING or the world's settings, never a lookup by created_at",
  (reh.match(/returning id into v_id;/g) || []).length === 2 && !/order by [a-z.]*created_at desc/.test(reh.replace(embedded, "")));
A("the expected refusals sit in inner blocks that re-raise anything unexpected",
  (reh.match(/exception when others then\n\s+if sqlerrm not like '[^\n]*' then raise; end if;/g) || []).length === 9);
A("the refusals match the record's sentences", reh.includes("'% has 0 regular-season games at forward, their registered position group; the playoffs need 6 (Rule 8.3).'")
  && reh.includes("'% has 4 regular-season games in goal, their registered position group; the playoffs need 6 (Rule 8.3).'")
  && reh.includes("'% has already played 2 of the first 4 games of this series; a player may play 2 of them (Rule 8.3).'")
  && reh.includes("'% has 5 regular-season games at defense, their registered position group; the playoffs need 6 (Rule 8.3).'"));
A("a signed-out visitor's award_eligible answers, and the count is refused to them, with no table read under that role",
  /perform set_config\('role', 'anon', true\);\n\s+v_ok_fa := public\.award_eligible\(v_s2, v_fa\);\n\s+v_ok_fd := public\.award_eligible\(v_s2, v_fd\);\n\s+begin\n\s+perform public\.playoff_eligibility_gp\(v_s2, v_fa\);[\s\S]*?if sqlerrm not like '%permission denied%' then raise; end if;\n\s+end;\n\s+perform set_config\('role', 'none', true\);/.test(reh));
A("a recorded office exception lets a player past the first-four rule, and holds them past both limits",
  /insert into public\.weekly_cap_exceptions \(season_id, game_id, profile_id, team_id, reason, granted_by\)/.test(reh)
  && /T6 failed: a recorded office exception did not let FA onto the game 4 sheet/.test(reh) && /T7 failed: the office exception for game 4 did not hold FA/.test(reh));
A("the player is told it is the first-four rule and that game 5 is open", /nt\.body like '%The box scores show you have played 2 of the first 4 games of this playoff series, [^']*You may be dressed again from game 5 \(Rule 8\.3\)\.'\) <> 2 then/.test(reh));
A("the eligibility flag: FD below the floor is flagged, D1 and W are not, the Rule 2.4 goaltender is exempt; the commissioner is notified once of each",
  /update public\.seasons set fa_moves_closed_at = now\(\) - interval '1 minute' where id = v_s2;/.test(reh)
  && /x\.action = 'playoff_violation_ineligible' and x\.target_id = v_po3::text\) <> 1/.test(reh)
  && /x\.detail->>'games' = '0' and x\.detail->>'floor' = '6' and x\.detail->>'group' = 'F'/.test(reh)
  && /<> v_n_early \+ 1/.test(reh) && /<> v_n_elig \+ 1/.test(reh));
A("an exempt game is not counted and a voided game takes no number", /update public\.games set limits_exempt = true where id = current_setting\('rh\.po1'\)::uuid;/.test(reh)
  && /update public\.games set voided = true where id = current_setting\('rh\.po2'\)::uuid;/.test(reh) && /T9 failed: the voided game, or game 6 \(now the fifth\)/.test(reh));
A("Goalies included: the goaltender is pulled, refused and flagged with the skater",
  /jsonb_build_object\('profile_id', v_g1, 'games', 2, 'cap', 2, 'first_games', 4\)/.test(reh)
  && /a goaltender who played two of the first four was filed for game 4/.test(reh) && /the limit is 4 \(goaltender\)/.test(reh));
A("the after-the-fact flag runs on a real final", /update public\.games set status = 'final', home_score = 2, away_score = 1 where id = v_po3;/.test(reh)
  && /x\.action = 'playoff_violation_series_early' and x\.target_id = v_po3::text\) <> 1/.test(reh));
A("the lineup gate runs under a commissioner's claims", /perform set_config\('request\.jwt\.claims', json_build_object\('sub', current_setting\('rh\.c'\), 'role', 'authenticated'\)::text, true\);/.test(reh));
A("the verdict raises uncaught with every case named", /do \$v\$\nbegin\n  raise exception 'REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9';\nend \$v\$;\s*$/.test(reh));
A("no dblink, no http, no id written, no dashes, neutral pronouns", !/dblink|http_get|http_post\(/i.test(reh) && !/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/.test(reh)
  && !DASHES.test(reh) && !GENDERED.test(reh));

console.log("\nRulebook and changelog (v4.61)");
const vm = require("vm"); const rctx = { CG: {} }; vm.createContext(rctx);
vm.runInContext(fs.readFileSync(path.join(root, "src/live/part3_content.js"), "utf8"), rctx);
const rbk = rctx.CG.CONTENT.rulebook;
const s27 = rbk.chapters.find((c) => String(c.num) === "S2").sections.find((x) => x.id === "S2.7");
const s83 = rbk.chapters.find((c) => String(c.num) === "8").sections.find((x) => x.id === "8.3");
const s27t = s27.paragraphs.join(" ");
A("S2.7: the floor counts games at the signed-up position group", /six \(6\) regular-season games, prorated for a player first placed after opening night, at the position group they signed up for that season: forward, defense or goaltender\./.test(s27t));
A("S2.7: any position on a night, only the signed-up group counts", /may play any position on a given night, but only games at their signed-up group count toward the floor/.test(s27t));
A("S2.7: two of the first four, goaltenders included, beside the cap of four", s27t.indexOf("No player, goaltenders included, may play in more than four (4) games of a playoff series, nor in more than two (2) of its first four (4) games.") >= 0);
A("S2.7: the gate, the sweep, the refill by the lock and game five", /refuse a lineup that would dress a player for a third/.test(s27t) && /by that game's lineup lock \(by puck drop if the lock has passed\)/.test(s27t) && /may be dressed again from the fifth game/.test(s27t));
A("S2.7: a club that cannot set a full lineup forfeits under Rule 3.2 (the ruling kept, 2026-11-24)", /cannot set a full lineup within these limits forfeits the game under Rule 3\.2\./.test(s27t));
A("S2.7: the stale single-sentence cap is gone", s27t.indexOf("No player may play more than four (4) games of a playoff series.") < 0);
A("8.3 points to S2.7 for both changes", /two \(2\) of the first four \(4\) games of a series \(Rule S2\.7\)\.$/.test(s83.paragraphs[2]) && /signed-up position group count toward the floor \(Rule S2\.7\)\.$/.test(s83.paragraphs[3]));
const e461 = rbk.changelog.find((c) => c.version === "4.61");
A("the 4.61 changelog entry names S2.7 and keeps the house rules", !!e461 && /Rule S2\.7/.test(e461.summary) && !DASHES.test(JSON.stringify(e461)) && !GENDERED.test(JSON.stringify(e461)));
A("the record carries its rehearsal result and the kept ruling", /Result: REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9/.test(R(REC)) && /Keep 2 of the first 4/.test(R(REC)));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
