/* v4.57: public.statistical_title_board, set-based (sql/2026-11-24-title-board-setbased-v457.sql). The board's text is
   unchanged except its "who" step, which now reads public.playoff_eligibility_board once per season instead of calling
   award_eligible and player_playoff_floor for every player. The twin restates three single-player definitions, so this
   test pins the rules they share against those definitions' own records, and the record's self-checks compare their
   results for every player. Also pins the grants, the kept ruling comments and the rehearsal. */
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let fail = 0, n = 0;
const A = (name, cond, got) => { n++; if (cond) console.log("ok   " + name); else { fail++; console.log("FAIL " + name + (got === undefined ? "" : "  got: " + JSON.stringify(got).slice(0, 220))); } };
const REC = "sql/2026-11-24-title-board-setbased-v457.sql";
const sql = R(REC), reh = R(REC.replace(/\.sql$/, ".rehearsal.sql"));
const norm = (s) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const fnText = (src, head) => { const i = src.indexOf(head); return i < 0 ? "" : src.slice(i, src.indexOf("$function$;", i) + 11); };
const board = fnText(sql, "create or replace function public.statistical_title_board(");
const twin = fnText(sql, "create or replace function public.playoff_eligibility_board(");
const old = fnText(R("sql/2026-10-15-two-role-lines-v411.sql"), "create or replace function public.statistical_title_board(");
const cte = (s, from, to) => { const a = s.indexOf(from), b = s.indexOf(to, a); return a < 0 || b < 0 ? null : norm(s.slice(a, b)); };

// the board
A("found the new board, the twin and the previous board", !!board && !!twin && !!old);
A("same signature and return table, SECURITY DEFINER, now search_path ''", /public\.statistical_title_board\(p_season uuid, p_top integer default 3\)\n returns table\(category text, place integer, profile_id uuid, gamertag text, gp integer, total integer, per_game numeric\)\n language sql\n stable\n security definer\n set search_path to ''/.test(board));
A("lines, sk, gl and cand are the previous text, word for word", cte(board, "with lines as (", "-- Rule 9.3 eligibility") === cte(old, "with lines as (", "-- Rule 9.3 eligibility"));
A("ranked and the final select are the previous text, word for word", cte(board, "ranked as (", "$function$") === cte(old, "ranked as (", "$function$"));
A("who: once per season from the twin, the floor floored at 1 as before", /who as \(select e\.profile_id, e\.eligible ok, greatest\(1, e\.floor_gp\) fl\n\s+from public\.playoff_eligibility_board\(p_season\) e\)/.test(board));
A("no call per player is left in the board", !/award_eligible|player_playoff_floor|regular_gp/.test(board.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "")));
A("the comments recording the v4.09 rule and the 2026-10-15 ruling stay", /\/\* v4\.09: one line per player per game in each role\./.test(board) &&
  /-- the games-played floor counted AT the title's position \(commissioner ruling, 2026-10-15\)/.test(board) &&
  /-- Rule 9\.3 eligibility and the player's own floor \(prorated, Rule 8\.3\), once per player/.test(board));
A("the board keeps its client grants", /revoke all on function public\.statistical_title_board\(uuid, int\) from public;\ngrant execute on function public\.statistical_title_board\(uuid, int\) to anon, authenticated, service_role;/.test(sql));

// the twin: internal, and the same rules as the definitions it stands in for
A("twin: SQL, STABLE, SECURITY DEFINER, search_path ''", /returns table\(profile_id uuid, gp integer, floor_gp integer, eligible boolean\)\n language sql\n stable\n security definer\n set search_path to ''/.test(twin));
A("twin: no client grant (it carries the office's adjustments)", /revoke all on function public\.playoff_eligibility_board\(uuid\) from public, anon, authenticated;\ngrant execute on function public\.playoff_eligibility_board\(uuid\) to service_role;/.test(sql));
A("twin: the season floor read once (playoff_min_gp, MATERIALIZED)", /with se as materialized \(\n\s+select public\.playoff_min_gp\(p_season\) fl0,/.test(twin) && (twin.replace(/--[^\n]*/g, "").match(/playoff_min_gp/g) || []).length === 1);
const gpRec = R("sql/2026-10-19-playoff-gp-credits.sql");
A("regular_gp's rule: distinct regular-season finals, not voided, plus the office's adjustments", /coalesce\(g\.stage,'regular'\) = 'regular'\s+and g\.status = 'final' and not coalesce\(g\.voided,false\)/.test(gpRec) &&
  /count\(distinct g\.id\)::int n/.test(twin) && /coalesce\(g\.stage, 'regular'\) = 'regular'\s+and g\.status = 'final' and not coalesce\(g\.voided, false\)/.test(twin) &&
  /from public\.gp_credits cc\s+where cc\.season_id = p_season and cc\.profile_id = p\.profile_id/.test(twin) && /p\.n \+ coalesce\(cr\.g, 0\)/.test(twin));
const ppf = R("sql/2026-10-12-prorated-playoff-floor-v394.sql"), rnd = R("sql/2026-10-13-floor-rounding-v400.sql");
A("player_playoff_floor's first spot: current or archived, earliest", /select rs\.created_at as t from public\.roster_spots rs where rs\.season_id = p_season and rs\.profile_id = p_profile\s+union all\s+select r\.spot_created_at from public\.roster_spot_removals r/.test(ppf) &&
  /select rs\.profile_id, rs\.created_at t from public\.roster_spots rs where rs\.season_id = p_season\s+union all\s+select r\.profile_id, r\.spot_created_at from public\.roster_spot_removals r where r\.season_id = p_season\) x\s+group by x\.profile_id/.test(twin));
A("player_playoff_floor's club: the current spot (earliest), else the last removal", /order by rs\.created_at limit 1\),\s+\(select r\.team_id from public\.roster_spot_removals r where r\.season_id = p_season and r\.profile_id = p_profile order by r\.removed_at desc limit 1\)/.test(ppf) &&
  /0 k, extract\(epoch from rs\.created_at\) o/.test(twin) && /1, -extract\(epoch from r\.removed_at\)/.test(twin) && /order by x\.profile_id, x\.k, x\.o\)/.test(twin));
A("player_playoff_floor's branches: no floor, joined by opening night, no club or no games, else the share", /if coalesce\(v_floor, 0\) <= 0 then return 0; end if;/.test(ppf) &&
  /if v_open is null or v_joined is null or v_joined <= v_open then return v_floor; end if;/.test(ppf) &&
  /when coalesce\(se\.fl0, 0\) <= 0 then 0\n\s+when se\.opened is null or j\.t is null or j\.t <= se\.opened then se\.fl0\n\s+when c\.team_id is null or coalesce\(cg\.total, 0\) = 0 then se\.fl0/.test(twin));
A("player_playoff_floor's club schedule: regular, not voided, either side, games left from the join", /coalesce\(g\.stage, 'regular'\) = 'regular' and not coalesce\(g\.voided, false\)\s+and v_club in \(g\.home_team_id, g\.away_team_id\)/.test(ppf) &&
  /count\(\*\) filter \(where g\.scheduled_at >= v_joined\)/.test(ppf) && /count\(\*\) filter \(where g\.scheduled_at >= j\.t\) left_n/.test(twin) &&
  /not coalesce\(g\.voided, false\) and c\.team_id in \(g\.home_team_id, g\.away_team_id\)\) cg on true/.test(twin));
A("v4.00 \"Round down at .4\", the same expression and the ruling comment", /case when v_x - floor\(v_x\) > 0\.4 then ceil\(v_x\) else floor\(v_x\) end\)::int\)/.test(rnd) &&
  /least\(se\.fl0, \(case when sh\.x - floor\(sh\.x\) > 0\.4 then ceil\(sh\.x\) else floor\(sh\.x\) end\)::int\)/.test(twin) &&
  /v4\.00 \(commissioner, 2026-10-13\): "Round down at \.4"/.test(twin) && /se\.fl0::numeric \* cg\.left_n \/ nullif\(cg\.total, 0\) x/.test(twin));
A("award_eligible's rule: games toward the floor reach it, and no season-long suspension", /and s\.mode = 'seasons' and s\.until_season >= \(select number from public\.seasons where id = p_season\)/.test(R("sql/2026-09-28-awards-v360.sql")) &&
  /p\.n \+ coalesce\(cr\.g, 0\) >= f\.fl\n\s+and not exists \(select 1 from public\.suspensions s where s\.profile_id = p\.profile_id and s\.status = 'active'\n\s+and s\.mode = 'seasons' and s\.until_season >= se\.num\)/.test(twin));
A("the twin names its shortcut and the trigger to revisit it", /-- and in the rehearsal\. shortcut: two texts of the floor rule \(player_playoff_floor and this twin\), until someone owns/.test(sql));

// self-checks and rehearsal
A("self-checks: the twin equals the three definitions for every player of every season", /e\.gp is distinct from public\.regular_gp\(s\.id, e\.profile_id\)/.test(sql) &&
  /e\.floor_gp is distinct from public\.player_playoff_floor\(s\.id, e\.profile_id\)/.test(sql) && /e\.eligible is distinct from public\.award_eligible\(s\.id, e\.profile_id\)/.test(sql));
A("self-checks: the twin covers every player the board can rank", /playoff_eligibility_board misses a player with a regular-season line/.test(sql));
A("self-checks: the board and statistical_titles are row-for-row what they were, every season, every p_top", /create temp table _stb_before as/.test(sql) &&
  (sql.match(/\(values \(null::int\), \(0\), \(1\), \(3\), \(5\), \(10\), \(11\)\)/g) || []).length === 3 && /statistical_title_board output changed/.test(sql) && /statistical_titles output changed/.test(sql));
A("self-checks: grants and search_path", /statistical_title_board lost its client grant/.test(sql) && /playoff_eligibility_board is callable through the API/.test(sql) && /both definers must run with search_path/.test(sql));
A("rehearsal: old and new timed, anon reads the same board, the twin refused to anon and authenticated, an empty season",
  /cghl\.r_old_ms/.test(reh) && /T2 anon reads a different board/.test(reh) && (reh.match(/if sqlstate <> '42501' then raise; end if;/g) || []).length === 2 && /T4 a season with no finals/.test(reh));
const applied = sql.slice(0, sql.indexOf("\n/* REHEARSAL") + 1);   // what the migration runs; results are appended after it
A("rehearsal: the record's text verbatim, inside the transaction", reh.indexOf(applied) > reh.indexOf("\nbegin;\n"));
A("rehearsal: the time is the old board's before the record, then the new one's after", reh.indexOf("cghl.r_old_ms', round(ms)") < reh.indexOf(applied) &&
  reh.indexOf(applied) + applied.length <= reh.indexOf("T1 every season"));
A("neutral pronouns in the record (the twin's comment paraphrases player_playoff_floor's)", !/\b(he|him|his|himself)\b/i.test(sql) &&
  /-- player_playoff_floor: the player's club is the one they are on now, else the last one they were removed from/.test(sql));
A("rehearsal: ends in an uncaught REHEARSAL OK; no dblink, http or commit", /raise exception 'REHEARSAL OK: %', v_out;\nend \$r\$;\s*$/.test(reh) && !/exception when others then null/.test(reh) &&
  !/dblink|http_post|http_get|\bcommit\b/i.test(reh.replace(/--.*$/gm, "")));
A("the record carries its rehearsal block", /\/\* REHEARSAL/.test(sql));

console.log(`\n${n - fail}/${n} passed`);
if (fail) process.exit(1);
