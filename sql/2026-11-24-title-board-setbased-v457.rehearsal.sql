-- REHEARSAL for sql/2026-11-24-title-board-setbased-v457.sql (the main session runs it; it ends in an uncaught raise, so
-- everything rolls back). The record's text sits below verbatim (tools/title-board-setbased-v4.57.test.cjs checks it
-- byte for byte). The record's own self-checks compare the new board with the old one (every season, p_top null, 0, 1,
-- 3, 5, 10, 11), statistical_titles, and the twin with regular_gp, player_playoff_floor and award_eligible for every
-- player; this adds timing, the anon view and the twin's grants.

begin;

-- 0. the old board's time, before the change
do $before$
declare t0 timestamptz; s record; ms numeric := 0;
begin
  for s in select id from public.seasons loop
    t0 := clock_timestamp();
    perform count(*) from public.statistical_title_board(s.id, 10);
    ms := ms + extract(epoch from clock_timestamp() - t0) * 1000;
  end loop;
  perform set_config('cghl.r_old_ms', round(ms)::text, true);
  perform set_config('cghl.r_old_board', (select md5(coalesce(string_agg(x::text, '|' order by x.sid, x.category, x.place), ''))
    from (select se.id sid, b.* from public.seasons se cross join lateral public.statistical_title_board(se.id, 10) b) x), true);   /* se, not s: s is this block's loop record (42702 on the first run) */
end $before$;

-- 1. the record ------------------------------------------------------------------------------------------------------
-- >>> record text: sql/2026-11-24-title-board-setbased-v457.sql
-- v4.57 (2026-11-24): public.statistical_title_board, set-based. Same rows, same order, same grants; 843 ms became about
-- 24 ms on Season 1, so a race card can reach every visitor (briefs/data_layer.md section 1, honors). Measured 2026-11-23
-- read-only, as a plain query with the new text: 179 of 179 players' games, floors and eligibility equal the three
-- single-player definitions, and the top 10 of every title for every season is row-for-row the same as today's.
--
-- Why it was slow: Rule 9.3 eligibility and the player's own floor were function calls per player. For each of about 180
-- players the board called public.award_eligible (which calls public.regular_gp and public.player_playoff_floor) and then
-- public.player_playoff_floor again, and each call re-read the season's floor (season_rules), the season's first puck
-- drop and the club's schedule. Measured 2026-11-23 on Season 1: 843 ms for the board, 128 ms for 179 floor calls alone.
--
-- What changes: the eligibility inputs are computed once for the season by a new internal function,
-- public.playoff_eligibility_board(season): one row per player with a regular-season line, carrying the games counted
-- toward the floor (public.regular_gp's count, the office's adjustments included), the player's floor
-- (public.player_playoff_floor's proration, .4 rounding and all) and Rule 9.3 eligibility (public.award_eligible). It is
-- a set-based twin of those three, which stay the definitions every single-player reader uses (the playoff lineup gate,
-- can_move_player, finalize_season_award). This stream owns the title board, not those three, so it does not rewrite
-- them; instead the self-checks below compare the twin with them for every player of every season, here at apply time
-- and in the rehearsal. shortcut: two texts of the floor rule (player_playoff_floor and this twin), until someone owns
-- player_playoff_floor and award_eligible and makes them read the twin; any change to one must change the other, and
-- tools/title-board-setbased-v4.57.test.cjs pins the shared rules.
-- The twin returns the full count, adjustments included, so it gets NO client grant (the same reason regular_gp has none).
-- The board's own text is unchanged except the "who" step, and the comments recording the v4.09 two-role rule and the
-- 2026-10-15 ruling stay.

-- 0. the board's output before the change, for the self-check at the end ----------------------------------------------
create temp table _stb_before as
  select s.id season_id, t.top, b.*
    from public.seasons s
    cross join (values (null::int), (0), (1), (3), (5), (10), (11)) t(top)
    cross join lateral public.statistical_title_board(s.id, t.top) b;
create temp table _stt_before as
  select s.id season_id, x.* from public.seasons s cross join lateral public.statistical_titles(s.id) x;

-- 1. the eligibility inputs, once per season ---------------------------------------------------------------------------
create or replace function public.playoff_eligibility_board(p_season uuid)
 returns table(profile_id uuid, gp integer, floor_gp integer, eligible boolean)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v4.57: the set-based twin of public.regular_gp (gp), public.player_playoff_floor (floor_gp) and public.award_eligible
     (eligible), for every player with a regular-season line in the season (sql/2026-11-24-title-board-setbased-v457.sql).
     Change it together with those three. */
  -- MATERIALIZED: computed once; inlined, the planner repeats playoff_min_gp (season_rules) for every player (276 ms)
  with se as materialized (
    select public.playoff_min_gp(p_season) fl0,
           (select s.number from public.seasons s where s.id = p_season) num,
           (select min(g.scheduled_at) from public.games g
             where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular' and not coalesce(g.voided, false)) opened),
  -- regular_gp's count: distinct regular-season finals with a line
  played as (
    select gs.profile_id, count(distinct g.id)::int n
      from public.game_stats gs join public.games g on g.id = gs.game_id
     where gs.profile_id is not null and g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular'
       and g.status = 'final' and not coalesce(g.voided, false)
     group by gs.profile_id),
  -- player_playoff_floor: the FIRST roster spot this season, current or archived
  joined as (
    select x.profile_id, min(x.t) t from (
      select rs.profile_id, rs.created_at t from public.roster_spots rs where rs.season_id = p_season
      union all
      select r.profile_id, r.spot_created_at from public.roster_spot_removals r where r.season_id = p_season) x
     group by x.profile_id),
  -- player_playoff_floor: the player's club is the one they are on now, else the last one they were removed from
  club as (
    select distinct on (x.profile_id) x.profile_id, x.team_id from (
      select rs.profile_id, rs.team_id, 0 k, extract(epoch from rs.created_at) o
        from public.roster_spots rs where rs.season_id = p_season
      union all
      select r.profile_id, r.team_id, 1, -extract(epoch from r.removed_at)
        from public.roster_spot_removals r where r.season_id = p_season) x
     order by x.profile_id, x.k, x.o)
  select p.profile_id, p.n + coalesce(cr.g, 0), f.fl,
         p.n + coalesce(cr.g, 0) >= f.fl
         and not exists (select 1 from public.suspensions s where s.profile_id = p.profile_id and s.status = 'active'
                           and s.mode = 'seasons' and s.until_season >= se.num)
    from played p
    cross join se
    left join joined j on j.profile_id = p.profile_id
    left join club c on c.profile_id = p.profile_id
    left join lateral (select count(*) total, count(*) filter (where g.scheduled_at >= j.t) left_n
                         from public.games g
                        where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular'
                          and not coalesce(g.voided, false) and c.team_id in (g.home_team_id, g.away_team_id)) cg on true
    left join lateral (select sum(cc.games)::int g from public.gp_credits cc
                        where cc.season_id = p_season and cc.profile_id = p.profile_id) cr on true
    cross join lateral (select se.fl0::numeric * cg.left_n / nullif(cg.total, 0) x) sh
    /* v4.00 (commissioner, 2026-10-13): "Round down at .4". The share rounds to the nearest game, a fraction of .4
       or less down and anything above it up: 16 x 45 / 54 = 13.33 is 13; 16 x 50 / 54 = 14.81 is 15. */
    cross join lateral (select case
                                 when coalesce(se.fl0, 0) <= 0 then 0
                                 when se.opened is null or j.t is null or j.t <= se.opened then se.fl0
                                 when c.team_id is null or coalesce(cg.total, 0) = 0 then se.fl0
                                 else least(se.fl0, (case when sh.x - floor(sh.x) > 0.4 then ceil(sh.x) else floor(sh.x) end)::int)
                               end fl) f
$function$;
revoke all on function public.playoff_eligibility_board(uuid) from public, anon, authenticated;
grant execute on function public.playoff_eligibility_board(uuid) to service_role;

-- 2. the board ----------------------------------------------------------------------------------------------------------
create or replace function public.statistical_title_board(p_season uuid, p_top integer default 3)
 returns table(category text, place integer, profile_id uuid, gamertag text, gp integer, total integer, per_game numeric)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v4.09: one line per player per game in each role. A player who skated in one sitting of a restarted game and played
     goal in another has a skating line and an in-goal line, and the game counts once for each title kind it belongs to
     (games skated for the scoring titles, games in goal for the Goaltending Title). */
  with lines as (
    select gs.profile_id, gs.game_id, gs.is_goalie g,
           sum(coalesce(gs.goals,0)) goals, sum(coalesce(gs.assists,0)) assists, sum(coalesce(gs.goals_against,0)) ga
      from public.game_stats gs join public.games gm on gm.id = gs.game_id
     where gm.season_id = p_season and coalesce(gm.stage,'regular') = 'regular' and gm.status = 'final'
       and not coalesce(gm.voided,false) and gs.profile_id is not null
     group by gs.profile_id, gs.game_id, gs.is_goalie),
  sk as (select l.profile_id, count(*)::int gp, sum(l.goals)::int goals, sum(l.assists)::int assists
           from lines l where not l.g group by l.profile_id),
  gl as (select l.profile_id, count(*)::int gp, sum(l.ga)::int ga from lines l where l.g group by l.profile_id),
  cand as (
    select 'points_title'::text c, profile_id, gp, goals + assists tot, (goals + assists)::numeric / gp pg, true high from sk
    union all select 'goals_title', profile_id, gp, goals, goals::numeric / gp, true from sk
    union all select 'assists_title', profile_id, gp, assists, assists::numeric / gp, true from sk
    union all select 'goaltending_title', profile_id, gp, ga, ga::numeric / gp, false from gl),
  -- Rule 9.3 eligibility and the player's own floor (prorated, Rule 8.3), once per player
  -- v4.57: for the whole season at once (public.playoff_eligibility_board), not three function calls per player
  who as (select e.profile_id, e.eligible ok, greatest(1, e.floor_gp) fl
            from public.playoff_eligibility_board(p_season) e),
  ranked as (
    select c.*, pr.gamertag tag, row_number() over (partition by c.c
             order by case when c.high then -c.pg else c.pg end, -c.gp, pr.gamertag, c.profile_id) rn
      from cand c join who w on w.profile_id = c.profile_id left join public.profiles pr on pr.id = c.profile_id
     -- the games-played floor counted AT the title's position (commissioner ruling, 2026-10-15)
     where w.ok and c.gp >= w.fl)
  select r.c, r.rn::int, r.profile_id, r.tag, r.gp, r.tot::int, round(r.pg, 3)
    from ranked r where r.rn <= greatest(1, least(coalesce(p_top, 3), 10))
$function$;
revoke all on function public.statistical_title_board(uuid, int) from public;
grant execute on function public.statistical_title_board(uuid, int) to anon, authenticated, service_role;

-- 3. self-checks --------------------------------------------------------------------------------------------------------
do $chk$
declare v_bad text;
begin
  -- the twin agrees with the three definitions it stands in for, for every player of every season
  select string_agg(format('season %s: %s players differ', x.number, x.n), '; ') into v_bad from (
    select s.number, count(*) n
      from public.seasons s cross join lateral public.playoff_eligibility_board(s.id) e
     where e.gp is distinct from public.regular_gp(s.id, e.profile_id)
        or e.floor_gp is distinct from public.player_playoff_floor(s.id, e.profile_id)
        or e.eligible is distinct from public.award_eligible(s.id, e.profile_id)
     group by s.number) x;
  if v_bad is not null then raise exception 'playoff_eligibility_board disagrees with the single-player definitions: %', v_bad; end if;
  -- the twin covers every player the board can rank
  if exists (select 1 from public.seasons s
              cross join lateral (select distinct gs.profile_id from public.game_stats gs join public.games g on g.id = gs.game_id
                                   where g.season_id = s.id and coalesce(g.stage,'regular') = 'regular' and g.status = 'final'
                                     and not coalesce(g.voided,false) and gs.profile_id is not null) p
              where not exists (select 1 from public.playoff_eligibility_board(s.id) e where e.profile_id = p.profile_id)) then
    raise exception 'playoff_eligibility_board misses a player with a regular-season line';
  end if;
  -- the board: the same rows, places and values as before, for every season and every p_top the site or a caller uses
  select string_agg(distinct format('season %s top %s', x.season_id, x.top), ', ') into v_bad from (
    (select season_id, top, category, place, profile_id, gamertag, gp, total, per_game from _stb_before
     except all
     select s.id, t.top, b.* from public.seasons s cross join (values (null::int), (0), (1), (3), (5), (10), (11)) t(top)
       cross join lateral public.statistical_title_board(s.id, t.top) b)
    union all
    (select s.id, t.top, b.* from public.seasons s cross join (values (null::int), (0), (1), (3), (5), (10), (11)) t(top)
       cross join lateral public.statistical_title_board(s.id, t.top) b
     except all
     select season_id, top, category, place, profile_id, gamertag, gp, total, per_game from _stb_before)) x;
  if v_bad is not null then raise exception 'statistical_title_board output changed: %', v_bad; end if;
  if exists ((select * from _stt_before except all select s.id, x.* from public.seasons s cross join lateral public.statistical_titles(s.id) x)
             union all
             (select s.id, x.* from public.seasons s cross join lateral public.statistical_titles(s.id) x except all select * from _stt_before)) then
    raise exception 'statistical_titles output changed';
  end if;
  -- grants: the board keeps its client grant (grant audit check 4); the twin has none
  if not has_function_privilege('anon', 'public.statistical_title_board(uuid,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.statistical_title_board(uuid,integer)', 'EXECUTE') then
    raise exception 'statistical_title_board lost its client grant';
  end if;
  if has_function_privilege('anon', 'public.playoff_eligibility_board(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.playoff_eligibility_board(uuid)', 'EXECUTE')
     or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.playoff_eligibility_board(uuid)'::regprocedure and a.grantee = 0) then
    raise exception 'playoff_eligibility_board is callable through the API (it carries the full count)';
  end if;
  if (select proconfig from pg_proc where oid = 'public.statistical_title_board(uuid,integer)'::regprocedure) <> array['search_path=""']
     or (select proconfig from pg_proc where oid = 'public.playoff_eligibility_board(uuid)'::regprocedure) <> array['search_path=""'] then
    raise exception 'both definers must run with search_path ''''';
  end if;
end $chk$;
drop table _stb_before, _stt_before;

-- <<< record text

-- 2. the cases -------------------------------------------------------------------------------------------------------
do $r$
declare t0 timestamptz; s record; ms numeric := 0; n int; v_out text;
begin
  -- T1 time: every season's board, new text
  for s in select id from public.seasons loop
    t0 := clock_timestamp();
    perform count(*) from public.statistical_title_board(s.id, 10);
    ms := ms + extract(epoch from clock_timestamp() - t0) * 1000;
  end loop;
  if ms >= 200 then raise exception 'T1 the set-based board took % ms (old %)', round(ms), current_setting('cghl.r_old_ms'); end if;
  v_out := format('T1 every season''s board: %s ms, was %s ms. ', round(ms), current_setting('cghl.r_old_ms'));

  -- T2 a signed-out visitor reads the same board as before
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  if (select md5(coalesce(string_agg(x::text, '|' order by x.sid, x.category, x.place), ''))
        from (select s2.id sid, b.* from public.seasons s2 cross join lateral public.statistical_title_board(s2.id, 10) b) x)
     is distinct from current_setting('cghl.r_old_board') then
    raise exception 'T2 anon reads a different board';
  end if;
  select count(*) into n from public.statistical_titles((select id from public.seasons where number = 1));
  v_out := v_out || format('T2 anon: same board, %s Season 1 titles. ', n);

  -- T3 the twin carries the full count, so the API roles cannot call it
  begin
    perform count(*) from public.playoff_eligibility_board((select id from public.seasons where number = 1));
    raise exception 'T3 anon could call playoff_eligibility_board';
  exception when others then if sqlstate <> '42501' then raise; end if;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role = 'commissioner' order by created_at limit 1),
                                                             'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform count(*) from public.playoff_eligibility_board((select id from public.seasons where number = 1));
    raise exception 'T3 a signed-in commissioner could call playoff_eligibility_board through the API role';
  exception when others then if sqlstate <> '42501' then raise; end if;
  end;
  perform set_config('role', 'none', true);
  v_out := v_out || 'T3 playoff_eligibility_board: 42501 for anon and authenticated. ';

  -- T4 a season with no games yet (Season 2 today) gives an empty board and an empty twin, without error
  select count(*) into n from public.seasons s2 cross join lateral public.statistical_title_board(s2.id, 3) b
   where not exists (select 1 from public.games g where g.season_id = s2.id and g.status = 'final');
  if n <> 0 then raise exception 'T4 a season with no finals has % board rows', n; end if;
  v_out := v_out || 'T4 a season with no finals: empty board.';

  raise exception 'REHEARSAL OK: %', v_out;
end $r$;
