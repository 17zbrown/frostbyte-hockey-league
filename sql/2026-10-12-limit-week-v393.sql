-- v3.93 (2026-10-12): a moved game can count toward its ORIGINAL week for players' weekly game limits.
--
-- Commissioner, 2026-10-12, after Islanders at Stars (postponed from Fri Oct 9, Week 3) was moved to Wed Oct 14
-- at 8:25 PM ET: "that rescheduled game should not count towards week 4's player limits".
--
-- Rule 3.3 (v3.68, Q40) makes a game moved into another game-week count toward the week it is played, for every
-- weekly count, and ops_reschedule_game rewrites games.week to match. The ruling separates two things that were
-- one column: the week a game is PLAYED in (games.week: the schedule, availability, Players of the Week, the
-- movement deadline) and the week it counts toward for PLAYER LIMITS (Rule 5.2). games.limit_week holds the
-- second when the league office rules it differs; NULL means "the week it is played", so every other game is
-- unchanged.
--
-- Every reader of a player's week for the limit reads coalesce(limit_week, week): player_week_games (the one
-- count the lineup gate, the final-game review and the office exception all use), set_game_lineup and
-- clear_game_lineup (the per club-week filing lock), grant_cap_exception, review_game_records (the count and its
-- message), lineup_camp_warnings and tc_week_overages. The client mirrors it (CG.limitWeekOf).
-- The column is written through ops_set_limit_week (commissioner or operations, logged, public ledger line). The API
-- roles hold the games table's UPDATE privilege, but row security lets only a commissioner write a game row.

alter table public.games add column if not exists limit_week smallint;
comment on column public.games.limit_week is
  'v3.93 (Rule 3.3): the game-week this game counts toward for players'' weekly game limits (Rule 5.2), when the league office rules it differs from the week it is played (games.week). NULL = the week it is played. Set only by ops_set_limit_week.';
grant select (limit_week) on public.games to anon, authenticated;

create or replace function pg_temp.v393_patch(p_fn regprocedure, p_old text[], p_new text[]) returns void
language plpgsql as $f$
-- every anchor must occur exactly once; all of a function's replacements land in ONE create or replace,
-- because a sql function is validated as a whole (tc_week_overages' select and group by move together)
declare v_def text := pg_get_functiondef(p_fn); v_n int; i int;
begin
  for i in 1 .. array_length(p_old, 1) loop
    v_n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / length(p_old[i]);
    if v_n <> 1 then raise exception 'v3.93 patch: % anchor found % times: %', p_fn, v_n, p_old[i]; end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  execute v_def;
end $f$;

select pg_temp.v393_patch('public.player_week_games(uuid,text,integer,uuid,uuid)',
  array['and g.week = p_week'], array['and coalesce(g.limit_week, g.week) = p_week']);

select pg_temp.v393_patch('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)',
  array['v_game.stage || '':'' || v_game.week || '':'' || p_team',
        'public.player_week_games(v_game.season_id, v_game.stage, v_game.week, v_p, p_game)'],
  array['v_game.stage || '':'' || coalesce(v_game.limit_week, v_game.week) || '':'' || p_team',
        'public.player_week_games(v_game.season_id, v_game.stage, coalesce(v_game.limit_week, v_game.week), v_p, p_game)']);

select pg_temp.v393_patch('public.clear_game_lineup(uuid,uuid)',
  array['v_game.stage || '':'' || v_game.week || '':'' || p_team'],
  array['v_game.stage || '':'' || coalesce(v_game.limit_week, v_game.week) || '':'' || p_team']);

select pg_temp.v393_patch('public.grant_cap_exception(uuid,uuid,text)',
  array['public.player_week_games(g.season_id, g.stage, g.week, p_profile, p_game)'],
  array['public.player_week_games(g.season_id, g.stage, coalesce(g.limit_week, g.week), p_profile, p_game)']);

select pg_temp.v393_patch('public.review_game_records(uuid)',
  array['public.player_week_games(g.season_id, g.stage, g.week, r.profile_id, null)',
        'games in week '' || g.week ||',
        '''week'',g.week,''games'',v_n'],
  array['public.player_week_games(g.season_id, g.stage, coalesce(g.limit_week, g.week), r.profile_id, null)',
        'games in week '' || coalesce(g.limit_week, g.week) ||',
        '''week'',coalesce(g.limit_week, g.week),''games'',v_n']);

select pg_temp.v393_patch('public.lineup_camp_warnings(uuid,uuid)',
  array['and g2.week = v_g.week'], array['and coalesce(g2.limit_week, g2.week) = coalesce(v_g.limit_week, v_g.week)']);

select pg_temp.v393_patch('public.tc_week_overages(uuid)',
  array['), g.week, count(*)::int', 'p.gamertag, p.display_name, g.week'],
  array['), coalesce(g.limit_week, g.week), count(*)::int', 'p.gamertag, p.display_name, coalesce(g.limit_week, g.week)']);

-- the one door that writes it
create or replace function public.ops_set_limit_week(p_game uuid, p_week int, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.games; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not (public.is_commissioner() or public.has_department('operations')) then
    raise exception 'Only a commissioner or the operations department can rule which week a game counts toward.';
  end if;
  select * into g from public.games where id = p_game;
  if g.id is null then raise exception 'Game not found.'; end if;
  if coalesce(g.stage, 'regular') <> 'regular' then
    raise exception 'Only a regular-season game counts toward a game-week''s limits; a playoff game counts toward its series.';
  end if;
  if g.status = 'final' then
    raise exception 'That game is already final. Re-open it before changing the week it counts toward.';
  end if;
  if v_reason = '' then raise exception 'Give the reason for the ruling.'; end if;
  if p_week is not null and not exists (select 1 from public.games g2
       where g2.season_id = g.season_id and coalesce(g2.stage, 'regular') = 'regular' and g2.week = p_week and g2.id <> g.id) then
    raise exception 'Week % has no other regular-season games this season.', p_week;
  end if;
  -- NULL, or the week it is played, both mean "no ruling"
  update public.games set limit_week = case when p_week is null or p_week = g.week then null else p_week end
   where id = p_game;
  insert into public.transactions (season_id, type, description)
    values (g.season_id, 'other', format('League office ruling: %s at %s counts toward Week %s for players'' weekly game limits (Rule 3.3).',
      (select name from public.teams where id = g.away_team_id),
      (select name from public.teams where id = g.home_team_id),
      coalesce(p_week, g.week)));
  perform public.log_admin_action('game_limit_week', 'game', p_game::text,
    jsonb_build_object('played_week', g.week, 'limit_week', coalesce(p_week, g.week), 'was', g.limit_week, 'reason', left(v_reason, 1000)));
end $function$;
revoke execute on function public.ops_set_limit_week(uuid, int, text) from public, anon;
grant execute on function public.ops_set_limit_week(uuid, int, text) to authenticated;

do $chk$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('player_week_games','set_game_lineup','clear_game_lineup','grant_cap_exception','review_game_records','lineup_camp_warnings','tc_week_overages')
     and position('limit_week' in pg_get_functiondef(p.oid)) = 0;
  if v_bad is not null then raise exception 'v3.93: these limit readers do not read limit_week: %', v_bad; end if;
end $chk$;
