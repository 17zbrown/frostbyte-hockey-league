-- v4.11 (2026-10-15): a player who skated in one sitting of a restarted game and played goal in another keeps BOTH lines.
-- (Built and applied as "v4.09" while two other releases took 4.09 (playoff statistics) and 4.10 (FO%) on main; the
-- migration is recorded as v409_two_role_lines and the comments and messages inside the applied functions below say
-- v4.09. Same change.)
--
-- Follow-up C3 of v4.08. A game restarted after a disconnection (Rule 4.3) arrives as two or more EA matches, and the
-- importer (mergeSegments, netlify/functions/ingest-stats.js) summed every sitting into ONE line per EA account with
-- is_goalie = either sitting in goal. A player who skated in one sitting and played goal in the other became a single
-- goalie line, and the site, the title board and every other reader credit a goalie line as goaltending only, so the
-- skating goals and assists were never shown. No such line exists yet (0 of 212 goalie lines carry any skating figure, and
-- no player of the 7 multi-sitting games changed role between sittings), but 19 players have played both roles this season.
--
-- Now: when the role differs across sittings the game keeps one skating line and one in-goal line for that player, each
-- summed from the sittings played that way (the importer half). This record:
--  * the two unique indexes on game_stats allow one line per player per game IN EACH ROLE;
--  * every reader counts the GAME once: gp = distinct games, games skated = games with a skating line, games in goal =
--    games with a goalie line (so gp <= skated + in goal). regular_gp, player_week_games, the limit-forfeit check,
--    check_playoff_violations, compute_potw and the player_season_stats view already counted distinct games. Fixed here:
--    career_games_played, is_draft_eligible, sign_free_agent (veteran and pre-season counts) and tc_week_overages counted
--    LINES; statistical_title_board grouped a game's lines into one with bool_or(is_goalie), crediting only the goaltending;
--  * _relink_member_lines links a member's second line of a game when it is the same EA account in the other role;
--  * withdraw_stat_credit clears every line of that EA account in the game (the withdrawal is kept by account, Rule 6.3);
--  * the night recap's three stars are one entry per player per game, naming both lines.

-- 1. one line per player per game in each role --------------------------------------------------------------------------
drop index if exists public.game_stats_one_credit_per_game;
create unique index game_stats_one_credit_per_game on public.game_stats (game_id, profile_id, is_goalie) where profile_id is not null;
drop index if exists public.game_stats_one_row_per_player;
create unique index game_stats_one_row_per_player on public.game_stats
  (game_id, team_id, is_goalie, coalesce(ea_player_id, profile_id::text, lower(coalesce(skater_name, ''))));

-- 2. the statistical titles (Rule 9.2): a game's lines are grouped PER ROLE --------------------------------------------
create or replace function public.statistical_title_board(p_season uuid, p_top int default 3)
 returns table(category text, place int, profile_id uuid, gamertag text, gp int, total int, per_game numeric)
 language sql stable security definer set search_path to 'public'
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
  who as (select x.profile_id, public.award_eligible(p_season, x.profile_id) ok,
                 greatest(1, public.player_playoff_floor(p_season, x.profile_id)) fl
            from (select distinct profile_id from cand) x),
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

-- 3. counters that counted LINES now count GAMES ------------------------------------------------------------------------
do $p$
declare
  v_def text;
  a text;
begin
  -- career games (Rule 2.8 veteran test on the site, the draft pool)
  v_def := pg_get_functiondef('public.career_games_played()'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'select gs.profile_id, count(*)::bigint as gp', ''))) / length('select gs.profile_id, count(*)::bigint as gp') <> 1 then
    raise exception 'v4.09: career_games_played anchor'; end if;
  execute replace(v_def, 'select gs.profile_id, count(*)::bigint as gp', 'select gs.profile_id, count(distinct gs.game_id)::bigint as gp');

  -- draft eligibility: 5+ career games
  v_def := pg_get_functiondef('public.is_draft_eligible(uuid,uuid)'::regprocedure);
  a := 'or (select count(*) from public.game_stats gs join public.games g on g.id = gs.game_id';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'v4.09: is_draft_eligible anchor'; end if;
  execute replace(v_def, a, 'or (select count(distinct gs.game_id) from public.game_stats gs join public.games g on g.id = gs.game_id');

  -- free agent signing: the veteran test (5+ career games) and the pre-season appearances
  v_def := pg_get_functiondef('public.sign_free_agent(uuid,bigint,uuid)'::regprocedure);
  a := '(select count(*) from public.game_stats gs where gs.profile_id = v_reg.profile_id) >= 5';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'v4.09: sign_free_agent anchor 1'; end if;
  v_def := replace(v_def, a, '(select count(distinct gs.game_id) from public.game_stats gs where gs.profile_id = v_reg.profile_id) >= 5');
  a := 'select count(*) into v_pre_gp from public.game_stats gs';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'v4.09: sign_free_agent anchor 2'; end if;
  execute replace(v_def, a, 'select count(distinct gs.game_id) into v_pre_gp from public.game_stats gs');

  -- training-camp weekly games (Rule 5.2, three a week)
  v_def := pg_get_functiondef('public.tc_week_overages(uuid)'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'count(*)', ''))) / length('count(*)') <> 2 then
    raise exception 'v4.09: tc_week_overages anchor'; end if;
  execute replace(v_def, 'count(*)', 'count(distinct gs.game_id)');
end $p$;

-- 4. relinking: a member's second line of a game is credited when it is the same EA account in the other role -----
do $p$
declare v_def text := pg_get_functiondef('public._relink_member_lines(uuid,text)'::regprocedure);
        a text := '    /* one credit per game */
    continue when exists (select 1 from public.game_stats x where x.game_id = r.game_id and x.profile_id = p_profile);';
        b text := '    /* one credit per game in each role (v4.09): a line of his already in this game blocks the link, unless it is the same
       EA account in the other role (he skated in one sitting of a restarted game and played goal in another) */
    continue when exists (select 1 from public.game_stats x where x.game_id = r.game_id and x.profile_id = p_profile
                             and (x.is_goalie = r.is_goalie or r.ea_player_id is null or x.ea_player_id is distinct from r.ea_player_id));';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v4.09: _relink_member_lines anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- 5. a withdrawal of personal credit (Rule 6.3) clears every line of that EA account in the game -----------------------
do $p$
declare v_def text := pg_get_functiondef('public.withdraw_stat_credit(uuid,text)'::regprocedure);
        a text := '  update public.game_stats gs set profile_id = null where gs.id = p_row_id returning 1 into v_hit;
  if v_hit is null then raise exception ''The stat line was not updated, so nothing was changed''; end if;';
        b text := '  /* v4.09: every line of that EA account in the game. A player who skated in one sitting of a restarted game and played
     goal in another has two, and the withdrawal is kept by account, so a re-import would clear both anyway. */
  update public.game_stats gs set profile_id = null
   where gs.game_id = v_game and gs.ea_player_id = v_ea and gs.profile_id is not null;
  get diagnostics v_hit = row_count;
  if coalesce(v_hit, 0) = 0 then raise exception ''The stat line was not updated, so nothing was changed''; end if;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v4.09: withdraw_stat_credit anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- 6. the night recap's three stars: one entry per player per game -------------------------------------------------------
do $p$
declare v_def text := pg_get_functiondef('public.post_night_recap(uuid,date)'::regprocedure);
        a text := 'for r in select coalesce(p.gamertag, gs.skater_name) as pname, t.name as team, gs.goals, gs.assists, gs.plus_minus, gs.is_goalie,';
        i0 int; n int; b text;
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v4.09: post_night_recap stars anchor'; end if;
  i0 := position(a in v_def);
  n := position('end loop;' in substr(v_def, i0)) + length('end loop;') - 1;   -- through the end of the stars loop
  b := $b$for r in select x.pname, x.team, x.txt from (
             /* v4.09: one entry per player per game. A player who played goal in one sitting of a restarted game and skated
                in another has two lines; the star counts both and names both. */
             select coalesce(max(p.gamertag), max(gs.skater_name)) as pname, t.name as team,
                    sum(case when gs.is_goalie then gs.saves * 0.25 + (case when gs.goals_against = 0 and gs.shots_against >= 8 then 8 else 0 end)
                             else gs.goals * 3 + gs.assists * 2 + gs.shots * 0.2 + gs.hits * 0.2 end) as star,
                    sum(case when gs.is_goalie then 0 else gs.goals end) as goals,
                    string_agg(case when gs.is_goalie then gs.saves || ' saves' || case when gs.goals_against = 0 then ', shutout' else '' end
                                    else gs.goals || 'G ' || gs.assists || 'A, ' || case when gs.plus_minus >= 0 then '+' else '' end || gs.plus_minus end,
                               ' and ' order by gs.is_goalie desc) as txt
               from public.game_stats gs left join public.profiles p on p.id = gs.profile_id
               join public.games g on g.id = gs.game_id and g.status = 'final' and not coalesce(g.voided, false)
               join public.teams t on t.id = gs.team_id
              where g.season_id = p_season and (g.scheduled_at at time zone 'America/New_York')::date = p_night
              group by gs.game_id, gs.team_id, t.name, coalesce(gs.profile_id::text, gs.ea_player_id, lower(gs.skater_name), gs.id::text)) x
            order by x.star desc, x.goals desc limit 3
  loop
    i := i + 1;
    v_stars := v_stars || format(E'%s. %s (%s), %s\n', i, r.pname, r.team, r.txt);
  end loop;$b$;
  execute overlay(v_def placing b from i0 for n);
end $p$;

-- 7. checks -------------------------------------------------------------------------------------------------------------
do $chk$
begin
  if pg_get_indexdef('public.game_stats_one_credit_per_game'::regclass) !~ '\(game_id, profile_id, is_goalie\) WHERE \(profile_id IS NOT NULL\)' then
    raise exception 'v4.09: one_credit_per_game is not per role'; end if;
  if pg_get_indexdef('public.game_stats_one_row_per_player'::regclass) !~ '\(game_id, team_id, is_goalie, COALESCE' then
    raise exception 'v4.09: one_row_per_player is not per role'; end if;
  if pg_get_functiondef('public.statistical_title_board(uuid,integer)'::regprocedure) ~ 'bool_or' then
    raise exception 'v4.09: the title board still folds a game''s lines into one'; end if;
  if pg_get_functiondef('public.career_games_played()'::regprocedure) ~ 'count\(\*\)'
     or pg_get_functiondef('public.tc_week_overages(uuid)'::regprocedure) ~ 'count\(\*\)'
     or pg_get_functiondef('public.sign_free_agent(uuid,bigint,uuid)'::regprocedure) ~ 'count\(\*\) (into v_pre_gp )?from public\.game_stats'
     or pg_get_functiondef('public.is_draft_eligible(uuid,uuid)'::regprocedure) ~ 'count\(\*\) from public\.game_stats' then
    raise exception 'v4.09: a games counter still counts lines'; end if;
  if position('x.is_goalie = r.is_goalie' in pg_get_functiondef('public._relink_member_lines(uuid,text)'::regprocedure)) = 0 then
    raise exception 'v4.09: relink is not per role'; end if;
  if position('gs.game_id = v_game and gs.ea_player_id = v_ea' in pg_get_functiondef('public.withdraw_stat_credit(uuid,text)'::regprocedure)) = 0 then
    raise exception 'v4.09: withdrawal does not clear every line of the account'; end if;
  if position('one entry per player per game' in pg_get_functiondef('public.post_night_recap(uuid,date)'::regprocedure)) = 0 then
    raise exception 'v4.09: night recap stars not per player'; end if;
  if exists (select 1 from information_schema.routine_privileges
              where grantee in ('anon', 'authenticated', 'PUBLIC') and routine_schema = 'public'
                and routine_name in ('_relink_member_lines', '_relink_all_unlinked')) then
    raise exception 'v4.09: an internal function is executable by members'; end if;
end $chk$;

/* REHEARSED 2026-10-15 in one rolled-back transaction (this file, then a second line in goal for Scorezov, today's scoring
   leader, in the latest skating game on that account): "REHEARSAL OK: T1 T2 T3 T4(gp 21, week 3) T5 T6 T7 T8".
     T1 today's title board, career games and camp overages are unchanged (no two-role line exists yet)
     T2 the second line, in goal on the same EA account, is accepted
     T3 a second line in the same role is refused by each index
     T4 the game counts once: regular_gp, career_games_played, player_week_games, is_draft_eligible unchanged
     T5 the points title still reads 21 GP and 110 points (bool_or would have made that game a goalie game)
     T6 the skating line, unlinked while the goalie line held the credit, relinks (same account, other role)
     T7 a withdrawal (as a commissioner) clears both lines; restore_stat_credit credits both again
     T8 the night recap names Scorezov once among the stars: with 100 saves on the goalie line,
        "1. Scorezov (Canucks), 100 saves and 3G 1A, -2"
   Applied as migration v409_two_role_lines. tools/sql/grant-audit.sql returned zero rows afterwards, and the title board
   leaders read as before (Scorezov 21 GP x3, the16thgunner 18 GP). */
