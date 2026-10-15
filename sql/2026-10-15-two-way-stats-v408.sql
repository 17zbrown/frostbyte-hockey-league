-- v4.08 (2026-10-15): every player's statistics count for every game, at every position played.
--
-- Commissioner, 2026-10-14: "Why are Bowman's stats not being tracked", "He also may have played other positions so
-- check with that as well.", "Make sure to count every player's stats of every game. Even if they disconnect."
-- The database already kept every line and already split skating from goaltending (statistical_titles, the cghl_*
-- rating engine, Players of the Week). The site's season totals did not; that fix is the site half of v4.08
-- (CG.aggregate keeps a skating line and an in-goal line for every player, src/live/part2_engine.js).
--
-- This record: Rule 9.2 as ruled by the commissioner on 2026-10-15 ("Floor at that position"). A statistical title is
-- a per-game rate, and statistical_titles admitted any playoff-eligible player however few games he had at the title's
-- position: SmokiestTitan34 (a goaltender) had 9 goals in 3 skating games and GOJE7SGO (a center) a 1.667 GA/GP over 3
-- games in goal, each two appearances from eligibility and from the titles. A title now also needs the player's own
-- games-played floor (public.player_playoff_floor, prorated for a late placement, Rule 8.3) counted at that position:
-- games skated for the Scoring, Goal-scoring and Playmaking Titles, games in goal for the Goaltending Title.
-- Rehearsed: today's four leaders (Scorezov x3, the16thgunner) are unchanged.

do $p$
declare v_def text := pg_get_functiondef('public.statistical_titles(uuid)'::regprocedure);
        a text := '      from cand c where public.award_eligible(p_season, c.profile_id) and c.gp > 0)';
        b text := '      from cand c where public.award_eligible(p_season, c.profile_id) and c.gp > 0
       /* v4.08 (commissioner ruling, 2026-10-15): the games-played floor counted AT the title''s position (Rule 9.2) */
       and c.gp >= greatest(1, public.player_playoff_floor(p_season, c.profile_id)))';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v4.08: statistical_titles anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

do $chk$
begin
  if position('player_playoff_floor(p_season, c.profile_id)' in pg_get_functiondef('public.statistical_titles(uuid)'::regprocedure)) = 0 then
    raise exception 'v4.08: statistical_titles has no floor at the position';
  end if;
end $chk$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Part 2 (migration v408_link_rum_sparky88), applied 2026-10-15: six Oct 14 lines were credited to nobody (Rum's 3 as
-- GeneralBaconEggs at UTA, Sparky88's 3 as SparkyMark88 at DET) because neither EA name matched a member when the games
-- were filed; both members corrected their EA identity afterwards, and nothing re-links a line already filed. Linked under
-- the four-way check (training camp counts as the club's roster), personas stamped (BlakeCx4's too), rulings logged.
-- Rehearsed: 3 + 3 rows, each now 3 games in Week 4, no forfeit, no notification.

-- ---------------------------------------------------------------------------------------------------------------------
-- Part 3 (migration v408b_count_every_line): so it cannot happen again, and so a played box score can never be erased.
--  * public._relink_member_lines(profile): links that member's unlinked lines this season under the four-way check
--    (exactly one member matches the line's EA persona or name, lower() equality, never ilike; the member is on the club
--    the line was recorded for, any squad; same position group unless training camp; no line of his already in that
--    game; Rule 6.3 withdrawals stay uncredited through enforce_stat_credit_withdrawal). Runs when a member's EA identity
--    changes (profiles, season_registrations) and every 15 minutes over every unlinked line (cron relink-unlinked-lines).
--  * forfeit_game refuses the no-show branch (which deletes the box score) on a game that was played and imported:
--    a forfeit on a played game keeps its statistics (keep the result). Every branch is logged.
--  * one credit per game in the database: a member can hold at most one line in a game.

create or replace function public._relink_member_lines(p_profile uuid, p_why text default 'identity changed')
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare v_season uuid; v_names text[]; v_eapid text; r record; n int := 0; v_cands int;
        v_pos text; v_squad text; v_grp text; v_rowgrp text;
begin
  select s.id into v_season from public.seasons s where s.status = 'active' order by s.number limit 1;
  if v_season is null or p_profile is null then return 0; end if;
  select array_remove(array[lower(nullif(trim(p.ea_id), '')), lower(nullif(trim(p.platform_gamertag), '')), lower(nullif(trim(p.gamertag), ''))], null),
         nullif(trim(p.ea_player_id), '')
    into v_names, v_eapid from public.profiles p where p.id = p_profile;
  if not found then return 0; end if;
  v_names := coalesce(v_names, '{}') || coalesce((select array_agg(distinct lower(x.v)) from (
      select nullif(trim(sr.ea_id), '') v from public.season_registrations sr where sr.profile_id = p_profile and sr.season_id = v_season
      union all
      select nullif(trim(sr.platform_gamertag), '') from public.season_registrations sr where sr.profile_id = p_profile and sr.season_id = v_season) x
    where x.v is not null), '{}');
  for r in
    select gs.id, gs.game_id, gs.team_id, gs.ea_player_id, gs.skater_name, coalesce(gs.is_goalie, false) as is_goalie, gs.position
      from public.game_stats gs join public.games g on g.id = gs.game_id
     where gs.profile_id is null and g.season_id = v_season
       and ((v_eapid is not null and gs.ea_player_id = v_eapid) or lower(coalesce(gs.skater_name, '')) = any(v_names))
  loop
    /* exactly one member matches this line's persona or name */
    select count(distinct p.id) into v_cands from public.profiles p
     where (r.ea_player_id is not null and p.ea_player_id = r.ea_player_id)
        or lower(coalesce(r.skater_name, '')) in (lower(coalesce(p.ea_id, '')), lower(coalesce(p.platform_gamertag, '')), lower(coalesce(p.gamertag, '')))
        or exists (select 1 from public.season_registrations sr where sr.profile_id = p.id and sr.season_id = v_season
                    and lower(coalesce(r.skater_name, '')) in (lower(coalesce(sr.ea_id, '')), lower(coalesce(sr.platform_gamertag, ''))));
    continue when v_cands <> 1;
    /* on the club the line was recorded for, in the position group he played (a camp player fills any position) */
    select rs.position::text, rs.squad into v_pos, v_squad from public.roster_spots rs
     where rs.profile_id = p_profile and rs.season_id = v_season and rs.team_id = r.team_id limit 1;
    continue when not found;
    v_rowgrp := case when r.is_goalie then 'G' when r.position in ('D', 'LD', 'RD') then 'D' else 'F' end;
    v_grp := case when v_pos = 'G' then 'G' when v_pos in ('D', 'LD', 'RD') then 'D' else 'F' end;
    continue when coalesce(v_squad, '') <> 'tc' and v_grp <> v_rowgrp;
    /* one credit per game */
    continue when exists (select 1 from public.game_stats x where x.game_id = r.game_id and x.profile_id = p_profile);
    update public.game_stats set profile_id = p_profile where id = r.id and profile_id is null;
    if (select x.profile_id from public.game_stats x where x.id = r.id) = p_profile then   /* a Rule 6.3 withdrawal keeps it null */
      n := n + 1;
      if r.ea_player_id is not null then
        update public.profiles set ea_player_id = r.ea_player_id where id = p_profile and ea_player_id is null;
      end if;
    end if;
  end loop;
  if n > 0 then
    perform public.log_admin_action('box_lines_linked', 'profile', p_profile::text,
      jsonb_build_object('lines', n, 'why', p_why, 'how', 'automatic four-way check (v4.08)'));
  end if;
  return n;
end $function$;
revoke execute on function public._relink_member_lines(uuid, text) from public, anon, authenticated;

create or replace function public._relink_all_unlinked()
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare v_season uuid; v_p uuid; n int := 0;
begin
  select s.id into v_season from public.seasons s where s.status = 'active' order by s.number limit 1;
  if v_season is null then return 0; end if;
  for v_p in
    select distinct p.id from public.game_stats gs join public.games g on g.id = gs.game_id
      join public.profiles p on (gs.ea_player_id is not null and p.ea_player_id = gs.ea_player_id)
        or lower(coalesce(gs.skater_name, '')) in (lower(coalesce(p.ea_id, '')), lower(coalesce(p.platform_gamertag, '')), lower(coalesce(p.gamertag, '')))
     where gs.profile_id is null and g.season_id = v_season
    union
    select distinct sr.profile_id from public.game_stats gs join public.games g on g.id = gs.game_id
      join public.season_registrations sr on sr.season_id = v_season
        and lower(coalesce(gs.skater_name, '')) in (lower(coalesce(sr.ea_id, '')), lower(coalesce(sr.platform_gamertag, '')))
     where gs.profile_id is null and g.season_id = v_season
  loop
    n := n + public._relink_member_lines(v_p, 'periodic sweep of unlinked lines');
  end loop;
  return n;
end $function$;
revoke execute on function public._relink_all_unlinked() from public, anon, authenticated;

create or replace function public._relink_on_identity_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_pid uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;   /* the persona stamp inside the link must not re-enter; the sweep covers the rest */
  v_pid := (case when tg_table_name = 'profiles' then to_jsonb(new)->>'id' else to_jsonb(new)->>'profile_id' end)::uuid;
  begin
    perform public._relink_member_lines(v_pid, 'the member''s EA identity changed');
  exception when others then
    /* a member's own save must never fail on this; the failure is recorded for the office, never swallowed */
    perform public.log_admin_action('box_relink_failed', 'profile', v_pid::text, jsonb_build_object('error', left(sqlerrm, 300)));
  end;
  return null;
end $function$;
revoke execute on function public._relink_on_identity_change() from public, anon, authenticated;

drop trigger if exists profiles_relink_lines on public.profiles;
create trigger profiles_relink_lines after update of ea_id, platform_gamertag, gamertag, ea_player_id on public.profiles
  for each row when (old.ea_id is distinct from new.ea_id or old.platform_gamertag is distinct from new.platform_gamertag
                     or old.gamertag is distinct from new.gamertag or old.ea_player_id is distinct from new.ea_player_id)
  execute function public._relink_on_identity_change();
drop trigger if exists registrations_relink_lines on public.season_registrations;
create trigger registrations_relink_lines after insert or update of ea_id, platform_gamertag on public.season_registrations
  for each row execute function public._relink_on_identity_change();

-- a forfeit never erases a played box score
do $p$
declare v_def text := pg_get_functiondef('public.forfeit_game(uuid,uuid,text,boolean)'::regprocedure);
        a text := '  delete from public.game_stats where game_id = p_game;
  update public.games set
    status = ''final'',';
        b text := '  /* v4.08 (commissioner, 2026-10-14: "count every player''s stats of every game"): this branch is the no-show forfeit,
     which carries no statistics (Rule 3.2), so it deletes the box score. A game that was PLAYED and imported keeps its
     statistics: refuse here and point at the keep-the-result forfeit. */
  if v_g.ea_match_id is not null or exists (select 1 from public.game_stats s where s.game_id = p_game)
     or exists (select 1 from public.ea_ingest_log l where l.game_id = p_game and l.status in (''ingested'', ''merged'', ''incomplete'')) then
    raise exception ''This game was played and its box score is in. A forfeit here keeps the played statistics: rule it with the result kept (Rule 4.3).''
      using errcode = ''22023'';
  end if;
  perform public.log_admin_action(''noshow_forfeit'', ''game'', p_game::text,
    jsonb_build_object(''forfeited_by'', (select code from public.teams where id = p_forfeiting_team), ''reason'', coalesce(p_reason, ''forfeit ruled'')));
  delete from public.game_stats where game_id = p_game;
  update public.games set
    status = ''final'',';
        a2 text := '    update public.games set forfeit_team_id = p_forfeiting_team where id = p_game;
    return jsonb_build_object(''ok'', true, ''winner'', v_winner, ''kept_result'', true,';
        b2 text := '    update public.games set forfeit_team_id = p_forfeiting_team where id = p_game;
    perform public.log_admin_action(''kept_result_forfeit'', ''game'', p_game::text,
      jsonb_build_object(''forfeited_by'', (select code from public.teams where id = p_forfeiting_team),
                         ''score'', v_g.home_score || ''-'' || v_g.away_score, ''reason'', coalesce(p_reason, ''forfeit on three disconnections (Rule 4.3)'')));
    return jsonb_build_object(''ok'', true, ''winner'', v_winner, ''kept_result'', true,';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v4.08: forfeit_game anchor 1'; end if;
  if (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then raise exception 'v4.08: forfeit_game anchor 2'; end if;
  execute replace(replace(v_def, a, b), a2, b2);
end $p$;

-- one credit per game: a member holds at most one line in a game (0 violations when this was built)
create unique index if not exists game_stats_one_credit_per_game on public.game_stats (game_id, profile_id) where profile_id is not null;

-- the sweep, and the watchdog's stale list (section 4) watches it
do $p$
declare v_def text := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
        a text := '      (''live-site-build'', interval ''1 hour''),';
        b text := '      (''live-site-build'', interval ''1 hour''),
      (''relink-unlinked-lines'', interval ''1 hour''),';
begin
  if position('relink-unlinked-lines' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v4.08b: watchdog anchor'; end if;
  execute replace(v_def, a, b);
end $p$;
select cron.unschedule(jobid) from cron.job where jobname = 'relink-unlinked-lines';
select cron.schedule('relink-unlinked-lines', '*/15 * * * *', 'select public._relink_all_unlinked()');

do $chk$
begin
  if exists (select 1 from information_schema.routine_privileges
              where grantee in ('anon', 'authenticated', 'PUBLIC') and routine_schema = 'public'
                and routine_name in ('_relink_member_lines', '_relink_all_unlinked', '_relink_on_identity_change')) then
    raise exception 'v4.08b: an internal function is executable by members';
  end if;
end $chk$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Part 4 (migration v408c_title_board): ONE definition of the statistical titles (Rule 9.2).
-- The awards page ranked the title leaders itself, copying statistical_titles by hand, and the copies had drifted: the page
-- counted every line where the filing skipped a line with no ice time recorded (a Stats manager line has none), the page
-- did not know a former player's prorated floor or a season-long suspension, and the filing broke a tie at the same
-- goals-against average toward FEWER games in goal while the published rule says the higher total. statistical_title_board
-- now ranks the leaders, statistical_titles files place 1 from it, and the page reads it, so the three cannot disagree.
--   Every line counts (Rule 6.1): a line is a game at its position whatever ice time it carries.
--   Order: the rate, then more games played at that position (Rule 9.2 as published), then gamertag.
-- Rehearsed: today's four leaders (Scorezov x3, the16thgunner) are unchanged and place 1 of the board equals the filing.
create or replace function public.statistical_title_board(p_season uuid, p_top int default 3)
 returns table(category text, place int, profile_id uuid, gamertag text, gp int, total int, per_game numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  with lines as (
    select gs.profile_id, gs.game_id, bool_or(coalesce(gs.is_goalie,false)) g,
           sum(coalesce(gs.goals,0)) goals, sum(coalesce(gs.assists,0)) assists, sum(coalesce(gs.goals_against,0)) ga
      from public.game_stats gs join public.games gm on gm.id = gs.game_id
     where gm.season_id = p_season and coalesce(gm.stage,'regular') = 'regular' and gm.status = 'final'
       and not coalesce(gm.voided,false) and gs.profile_id is not null
     group by gs.profile_id, gs.game_id),
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

create or replace function public.statistical_titles(p_season uuid)
 returns table(category text, profile_id uuid, team_id uuid, gp integer, total integer, per_game numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  /* v4.08: place 1 of public.statistical_title_board, the one definition of Rule 9.2 (file_statistical_titles files these) */
  select b.category, b.profile_id,
         (select rs.team_id from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = b.profile_id limit 1),
         b.gp, b.total, b.per_game
    from public.statistical_title_board(p_season, 1) b
$function$;
