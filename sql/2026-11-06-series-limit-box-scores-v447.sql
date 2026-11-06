-- v4.47 (2026-11-06): the playoff series limit counts box scores only, and a player who reaches it comes off the
-- club's remaining sheets of that series with a site notice to its management.
--
-- Commissioner, 2026-11-06: "The red wings are trying to submit lineups but getting an error that certain players are
-- scheduled for more than 4 games. Remember, only base scheduling off box scores. If a team has played one of their
-- players in 4 games in a series and is scheduled in more games for that series, remove them from the lineup and send
-- the team management a notification on the site. You should only act on scheduling players based on box score
-- results." Then: "You should also only count box scores as games played in the regular season as well."
--
-- Root cause: v3.93 moved player_week_games to box scores, but set_game_lineup kept a SECOND playoff block that counted
-- filed game_lineups rows. Porky and Mortalis Ares (0 games in the box scores) were refused as "already dressed in 4".
--
-- Part 1: set_game_lineup loses that block. Its first block (player_week_games against series_cap) is the one gate.
--         A round's games all carry games.week = the round (_draw_playoff_round), so a playoff "week" is the club's series.
-- Part 2: lineup_camp_warnings reads the same counter instead of filed rows (regular season request; nothing calls it
--         from the site today, so this is the last filed count in a limit reader that binds a club).
-- Part 3: _series_limit_sweep, the removal. It is idempotent and reads ONLY the box scores: a player whose count has
--         reached the cap leaves every sheet of a game with no box score yet. Nothing goes to Discord: club_notify runs
--         with p_room false (the commissioner asked for a site notice).
-- Part 4: triggers. A box score reaches a game in either order (lines then final, or final then lines), so both paths
--         run the sweep. trg_series_limit_games sorts after trg_playoff_series on purpose: games canceled because a series
--         just ended are gone before the sweep looks, so nobody is told to fill a sheet for a game that will not happen.
--         A failed sweep never blocks a final; the commissioners hear about it.
-- Part 5: the sweep runs once now for the games already on file.
--
-- Deliberately unchanged:
--   grant_cap_exception still adds sheets filed for earlier unplayed games when it decides whether an exception is
--   needed. Only the league office calls it, it never refuses a club, and removing them would stop the office excusing
--   a player before the night (Rule 5.2).
--   A corrected box score that lowers a count does not put a player back; the club refiles them.
-- shortcut: a player past the cap in a game already under way is removed from the sheet but still flagged only by
-- check_playoff_violations, not ruled a forfeit automatically; revisit if the commissioner wants the Rule 8.3 forfeit
-- automated in the playoffs.

/* REHEARSAL (2026-11-06, one transaction on the live database, rolled back by a closing raise):
   T1 the backfill took the16thgunner (4 in the box scores) off the Red Wings' 9:35 PM sheet; the other five stayed.
   T2 management got the site notice with the game link, the player got one notice, no club_notices row (no Discord),
      one audit row, and a second sweep changed and told nobody.
   T3 as Red Wings management, Porky (0 box games, 4 sheets) was filed onto a fifth sheet: the reported refusal is gone.
   T4 as Red Wings management, the16thgunner was refused with "has already played 4 games this series" and Rule 8.3.
   T5 the live path: a line for Kohlmanator (3 games) in the 9:00 PM game plus a final took them off both later sheets.
   Result: REHEARSAL OK: T1 T2 T3 T4 T5. Afterward: the sweep did not exist, the old gate was live, nothing stuck.
   Applied as migration v447_series_limit_box_scores; tools/sql/grant-audit.sql returned zero rows. */

-- ---------------------------------------------------------------- part 1: set_game_lineup
do $patch$
declare
  v_src text := pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure);
  a text; b text;
begin
  a := $a$      v_cap := public.series_cap(v_game.season_id, v_squad, v_pos);   -- Rule 8.3, by format
      select count(*) into v_dressed
        from public.game_lineups gl
        join public.games g on g.id = gl.game_id
        where g.season_id = v_game.season_id and g.stage = 'playoff' and g.week = v_game.week
          and g.id <> p_game and not coalesce(g.voided, false)
          and ((g.home_team_id = v_game.home_team_id and g.away_team_id = v_game.away_team_id)
            or (g.home_team_id = v_game.away_team_id and g.away_team_id = v_game.home_team_id))
          and v_p in (gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie);
      if v_dressed >= v_cap and not public.has_cap_exception(p_game, v_p) then
        select coalesce(nullif(gamertag,''),'that player') into v_name from public.profiles where id = v_p;
        raise exception '% is already dressed in % games of this series — the series limit is %. Rule 8.3.',
          v_name, v_dressed, v_cap using errcode = '22023';
      end if;
$a$;
  b := $b$      /* v4.47 (commissioner, 2026-11-06): "only base scheduling off box scores." The block that counted filed sheets
         here is gone; the count above (player_week_games) is the one series count (Rule 8.3). */
$b$;
  if (length(v_src) - length(replace(v_src, a, ''))) / length(a) <> 1 then
    raise exception 'set_game_lineup: the filed-sheet block did not match exactly once';
  end if;
  v_src := replace(v_src, a, b);

  a := $a$raise exception '% has already played % games this %; the limit is % (%). Playing them again would forfeit the game (Rule 5.2).',
        v_name, v_dressed, case when v_game.stage = 'playoff' then 'series' else 'week' end, v_cap,
        case when v_squad='tc' then 'training camp' when v_pos='G' then 'goaltender' else 'skater' end
$a$;
  b := $b$raise exception '% has already played % games this %; the limit is % (%). Playing them again would forfeit the game (Rule %).',
        v_name, v_dressed, case when v_game.stage = 'playoff' then 'series' else 'week' end, v_cap,
        case when v_squad='tc' then 'training camp' when v_pos='G' then 'goaltender' else 'skater' end,
        case when v_game.stage = 'playoff' then '8.3' else '5.2' end
$b$;
  if (length(v_src) - length(replace(v_src, a, ''))) / length(a) <> 1 then
    raise exception 'set_game_lineup: the refusal did not match exactly once';
  end if;
  execute replace(v_src, a, b);
end $patch$;

-- ---------------------------------------------------------------- part 2: lineup_camp_warnings
do $patch$
declare
  v_src text := pg_get_functiondef('public.lineup_camp_warnings(uuid,uuid)'::regprocedure);
  a text; b text;
begin
  a := $a$(select count(*) from public.game_lineups gl2
             join public.games g2 on g2.id = gl2.game_id
             where g2.season_id = v_g.season_id and g2.stage = v_g.stage and coalesce(g2.limit_week, g2.week) = coalesce(v_g.limit_week, v_g.week)
               and not coalesce(g2.voided,false) and gl2.team_id = p_team
               and rs.profile_id in (gl2.center, gl2.lw, gl2.rw, gl2.ld, gl2.rd, gl2.goalie))
$a$;
  b := $b$public.player_week_games(v_g.season_id, v_g.stage, coalesce(v_g.limit_week, v_g.week), rs.profile_id, p_game)   /* v4.47: box scores only */
$b$;
  if (length(v_src) - length(replace(v_src, a, ''))) / length(a) <> 1 then
    raise exception 'lineup_camp_warnings: the filed-sheet count did not match exactly once';
  end if;
  execute replace(v_src, a, b);
end $patch$;

-- ---------------------------------------------------------------- part 3: the sweep
create or replace function public._series_limit_sweep(p_season uuid, p_week integer)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v4.47 (Rule 8.3): take every player whose box scores have reached the series limit off the sheets of the games of
   that series that have no box score yet. Safe to run any number of times: a player already off a sheet is not told
   twice. A league-office exception for that game keeps the player on it (has_cap_exception). */
declare
  s record; v_team uuid; v_pid uuid; v_squad text; v_pos text; v_cap int; v_n int; v_name text;
  v_out uuid[]; v_names text; v_players jsonb; v_fix text; v_tail text; v_total int := 0;
begin
  if p_season is null or p_week is null then
    raise exception 'The series limit sweep needs a season and a week.' using errcode = '22023';
  end if;
  -- the same per-club lock set_game_lineup holds, so a filing in flight cannot slip a player back on after the count
  for v_team in
    select distinct gl.team_id from public.game_lineups gl join public.games g on g.id = gl.game_id
     where g.season_id = p_season and g.stage = 'playoff' and coalesce(g.limit_week, g.week) = p_week
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtext('lineup:' || p_season || ':playoff:' || p_week || ':' || v_team));
  end loop;

  for s in
    select gl.game_id, gl.team_id, gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie, g.scheduled_at, g.home_team_id, g.away_team_id
      from public.game_lineups gl join public.games g on g.id = gl.game_id
     where g.season_id = p_season and g.stage = 'playoff' and coalesce(g.limit_week, g.week) = p_week
       and g.status = 'scheduled' and g.ea_match_id is null and not coalesce(g.voided, false)
     order by g.scheduled_at, g.id, gl.team_id
  loop
    v_out := '{}'; v_names := null; v_players := '[]'::jsonb;
    foreach v_pid in array array_remove(array[s.center, s.lw, s.rw, s.ld, s.rd, s.goalie], null) loop
      select rs.squad, rs.position::text into v_squad, v_pos from public.roster_spots rs
       where rs.season_id = p_season and rs.profile_id = v_pid and rs.team_id = s.team_id limit 1;
      v_cap := public.series_cap(p_season, v_squad, v_pos);
      v_n := public.player_week_games(p_season, 'playoff', p_week, v_pid, null);
      if v_n >= v_cap and not public.has_cap_exception(s.game_id, v_pid) then
        select coalesce(nullif(gamertag, ''), display_name, 'A player') into v_name from public.profiles where id = v_pid;
        v_out := v_out || v_pid;
        v_names := coalesce(v_names || ', ', '') || v_name || ' (' || v_n || ' of ' || v_cap || ' games)';
        v_players := v_players || jsonb_build_object('profile_id', v_pid, 'player', v_name, 'games', v_n, 'cap', v_cap);
        perform public._notify_lineup_pulled(s.game_id, s.team_id, array[v_pid],
          'The box scores show you have played ' || v_n || ' of the ' || v_cap || ' games a player may play in a playoff series, so your club has been told to fill your spot (Rule 8.3).');
      end if;
    end loop;
    if array_length(v_out, 1) is null then continue; end if;

    update public.game_lineups gl set
        center = case when gl.center = any(v_out) then null else gl.center end,
        lw     = case when gl.lw     = any(v_out) then null else gl.lw end,
        rw     = case when gl.rw     = any(v_out) then null else gl.rw end,
        ld     = case when gl.ld     = any(v_out) then null else gl.ld end,
        rd     = case when gl.rd     = any(v_out) then null else gl.rd end,
        goalie = case when gl.goalie = any(v_out) then null else gl.goalie end,
        updated_at = now()
     where gl.game_id = s.game_id and gl.team_id = s.team_id;
    if not found then
      raise exception 'The series limit sweep found no sheet to change for game %.', s.game_id;
    end if;

    v_fix := (select t.name from public.teams t where t.id = s.away_team_id) || ' at ' || (select t.name from public.teams t where t.id = s.home_team_id)
             || ', ' || to_char(s.scheduled_at at time zone 'America/New_York', 'FMDy FMMon FMDD, FMHH12:MI AM') || ' ET';
    v_tail := case when now() >= s.scheduled_at + interval '10 minutes'
                   then ' That game was already under way, so the sheet can no longer be changed. Who played is read from the box score (Rule 8.3).'
                   else ' Fill the open spot before puck drop (Rule 8.3).' end;
    -- p_room false: the Owner, GM and AGM on the site, nothing in the club's Discord room
    perform public.club_notify(s.team_id, 'lineups', 'Series limit reached: your lineup changed',
      v_names || case when array_length(v_out, 1) = 1 then ' has' else ' have' end
      || ' reached the playoff series limit by the box scores and came off your lineup for ' || v_fix || '.' || v_tail,
      null, 'lineup', s.game_id::text, null, false);
    perform public.log_admin_action('series_limit_pull', 'game', s.game_id::text,
      jsonb_build_object('club', (select t.code from public.teams t where t.id = s.team_id), 'week', p_week, 'players', v_players));
    v_total := v_total + array_length(v_out, 1);
  end loop;
  return v_total;
end $function$;

-- the door the triggers use: a sweep that fails rolls back alone, a final is never blocked, and the commissioners hear
create or replace function public._series_limit_safe(p_season uuid, p_week integer)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform public._series_limit_sweep(p_season, p_week);
exception when others then
  raise warning '_series_limit_safe failed for season % week %: %', p_season, p_week, sqlerrm;
  begin
    perform public.notify_commissioners(null, 'flag', 'The playoff series limit check failed',
      'Taking players who reached the series limit off later lineups failed: ' || sqlerrm || '. Check the series'' lineups by hand (Rule 8.3).', 'admin', null);
  exception when others then
    raise warning '_series_limit_safe could not tell the commissioners: %', sqlerrm;
  end;
end $function$;

-- ---------------------------------------------------------------- part 4: the triggers
create or replace function public.trg_series_limit_games()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if (new.status = 'final' or (new.status = 'scheduled' and new.ea_match_id is not null)) and not coalesce(new.voided, false) then
    perform public._series_limit_safe(new.season_id, coalesce(new.limit_week, new.week));
  end if;
  return null;
end $function$;

create or replace function public.trg_series_limit_stats()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r record;
begin
  for r in
    select distinct g.season_id, coalesce(g.limit_week, g.week) as wk from public.games g
     where g.id in (select c.game_id from changed_new c) and g.stage = 'playoff'
       and (g.status = 'final' or (g.status = 'scheduled' and g.ea_match_id is not null)) and not coalesce(g.voided, false)
  loop
    perform public._series_limit_safe(r.season_id, r.wk);
  end loop;
  return null;
end $function$;

drop trigger if exists trg_series_limit_games on public.games;
create trigger trg_series_limit_games after update of status, ea_match_id on public.games
  for each row when (new.stage = 'playoff' and (old.status is distinct from new.status or old.ea_match_id is distinct from new.ea_match_id))
  execute function public.trg_series_limit_games();
drop trigger if exists trg_series_limit_stats_ins on public.game_stats;
create trigger trg_series_limit_stats_ins after insert on public.game_stats
  referencing new table as changed_new for each statement execute function public.trg_series_limit_stats();
drop trigger if exists trg_series_limit_stats_upd on public.game_stats;
create trigger trg_series_limit_stats_upd after update on public.game_stats
  referencing new table as changed_new for each statement execute function public.trg_series_limit_stats();

revoke all on function public._series_limit_sweep(uuid, integer) from public, anon, authenticated;
revoke all on function public._series_limit_safe(uuid, integer) from public, anon, authenticated;
revoke all on function public.trg_series_limit_games() from public, anon, authenticated;
revoke all on function public.trg_series_limit_stats() from public, anon, authenticated;

-- ---------------------------------------------------------------- part 5: the games already on file
do $now$
declare w int;
begin
  for w in select distinct coalesce(g.limit_week, g.week) from public.games g
            where g.season_id = public.current_season_id() and g.stage = 'playoff' and g.status = 'scheduled' loop
    perform public._series_limit_sweep(public.current_season_id(), w);
  end loop;
end $now$;

-- ---------------------------------------------------------------- self-checks
do $chk$
declare v_src text := pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure); v_n int;
begin
  if position('is already dressed in' in v_src) > 0 or position('from public.game_lineups gl' in v_src) > 0 then
    raise exception 'chk: set_game_lineup still counts filed sheets';
  end if;
  if position('from public.game_lineups gl2' in pg_get_functiondef('public.lineup_camp_warnings(uuid,uuid)'::regprocedure)) > 0 then
    raise exception 'chk: lineup_camp_warnings still counts filed sheets';
  end if;
  select count(*) into v_n from pg_trigger where not tgisinternal and tgname in ('trg_series_limit_games', 'trg_series_limit_stats_ins', 'trg_series_limit_stats_upd');
  if v_n <> 3 then raise exception 'chk: expected 3 triggers, found %', v_n; end if;
  if has_function_privilege('authenticated', 'public._series_limit_sweep(uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public._series_limit_sweep(uuid,integer)', 'EXECUTE') then
    raise exception 'chk: members can run the sweep';
  end if;
  select count(*) into v_n
    from public.game_lineups gl join public.games g on g.id = gl.game_id
    cross join lateral unnest(array_remove(array[gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie], null)) p(pid)
    left join public.roster_spots rs on rs.season_id = g.season_id and rs.profile_id = p.pid and rs.team_id = gl.team_id
   where g.season_id = public.current_season_id() and g.stage = 'playoff' and g.status = 'scheduled' and g.ea_match_id is null
     and public.player_week_games(g.season_id, 'playoff', coalesce(g.limit_week, g.week), p.pid, null) >= public.series_cap(g.season_id, rs.squad, rs.position::text)
     and not public.has_cap_exception(g.id, p.pid);
  if v_n <> 0 then raise exception 'chk: % players at the series limit are still on an unplayed sheet', v_n; end if;
end $chk$;
