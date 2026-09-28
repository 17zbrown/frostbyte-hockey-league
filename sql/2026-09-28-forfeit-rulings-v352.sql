-- v3.52: forfeit rulings. Only a commissioner reverses one; staff report a mistake instead; the
-- playoff series and clinch counters decide a game the way the standings do.
--
-- Commissioner, 2026-09-28: "Do not allow a staffer to undo any forfeits, if there is a mistake
-- entered by staff, a commissioner must be notified to step in to fix the problem." And: "Forfeits
-- can happen in playoffs and will be entered by staff similar to regular season games."
-- Q22: officiating and a commissioner may both void a game. Undoing a void is a reversal, so it is
-- a commissioner's alone, like undoing a forfeit.

/* ONE definition of who won a game, shared by every counter in the database. A void has no winner.
   A forfeit decides the game outright whatever the goals say (a Rule 4.3 or Rule 7.2 forfeit keeps
   the played score, so the forfeiting club can have more goals). Otherwise the higher score wins,
   and a level score has no winner. The site's standings builder (part2_engine.js) reads a game the
   same way. */
create or replace function public.game_winner(p_home uuid, p_away uuid, p_hs integer, p_as integer,
                                              p_forfeit uuid, p_voided boolean)
 returns uuid language sql immutable set search_path to 'public' as $fn$
  select case
    when coalesce(p_voided, false) then null
    when p_forfeit is not null then case when p_forfeit = p_home then p_away
                                         when p_forfeit = p_away then p_home end
    when p_hs is null or p_as is null then null
    when p_hs > p_as then p_home
    when p_as > p_hs then p_away
  end
$fn$;
grant execute on function public.game_winner(uuid,uuid,integer,integer,uuid,boolean) to anon, authenticated, service_role;

/* ---- Reversals are a commissioner's ---------------------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.undo_forfeit(uuid)'::regprocedure);
  d := replace(d0,
    '  if not (public.is_commissioner() or public.has_department(''officiating'')) then
    raise exception ''Only a commissioner or the officiating department can undo a forfeit.'';
  end if;',
    '  /* v3.52 (commissioner, 2026-09-28): no staffer undoes a forfeit or a void. A ruling entered in
     error is reported to the commissioners (report_ruling_mistake), and a commissioner fixes it. */
  if not public.is_commissioner() then
    raise exception ''Only a commissioner can reverse a forfeit or a void. If it was entered in error, report it to the commissioners from the game.''
      using errcode = ''42501'';
  end if;');
  if d = d0 then raise exception 'undo_forfeit patch matched nothing'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.unforfeit_game(uuid)'::regprocedure);
  d := replace(d0,
    '  if not public._is_stats_staff() then
    raise exception ''Only statistics staff can undo a forfeit.'';
  end if;',
    '  /* v3.52: a commissioner''s alone, as undo_forfeit. */
  if not public.is_commissioner() then
    raise exception ''Only a commissioner can reverse a forfeit. If it was entered in error, report it to the commissioners from the game.''
      using errcode = ''42501'';
  end if;');
  if d = d0 then raise exception 'unforfeit_game patch matched nothing'; end if;
  execute d;
end $mig$;

/* The result-correction card cannot rewrite the score of a ruled game: on a forfeit the score is the
   ruling, and on a void there is none. A commissioner still can. */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.stats_game_set_result(uuid,integer,integer,boolean,boolean)'::regprocedure);
  d := replace(d0,
    '  if not is_stats_staff() then raise exception ''Only statistics staff can manage games.'' using errcode=''42501''; end if;',
    '  if not is_stats_staff() then raise exception ''Only statistics staff can manage games.'' using errcode=''42501''; end if;
  /* v3.52: a forfeit or a void is a ruling; only a commissioner changes it. */
  if not public.is_commissioner() and exists (select 1 from public.games
       where id = p_game and (forfeit_team_id is not null or coalesce(voided, false))) then
    raise exception ''This game carries a forfeit or void ruling. Only a commissioner can change it: report the mistake to the commissioners from the game.''
      using errcode = ''42501'';
  end if;');
  if d = d0 then raise exception 'stats_game_set_result patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- Staff report a mistake; the commissioners are told -------------------------------------- */
create or replace function public.report_ruling_mistake(p_game uuid, p_note text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare g record; v_me uuid := auth.uid(); v_who text; v_what text; v_note text := btrim(coalesce(p_note, ''));
        v_fixture text; v_n int;
begin
  if v_me is null or not (public.is_staff() or public.is_commissioner()) then
    raise exception 'Only league staff can report a ruling mistake.' using errcode = '42501';
  end if;
  if length(v_note) < 10 then
    raise exception 'Say what is wrong and what the ruling should have been, so the commissioner can fix it without asking.'
      using errcode = '22023';
  end if;
  select * into g from public.games where id = p_game;
  if g.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.admin_audit a where a.action = 'ruling_mistake_reported'
              and a.target_id = p_game::text and a.actor = v_me and a.created_at > now() - interval '1 hour') then
    raise exception 'You reported this game within the last hour. The commissioners already have it.' using errcode = '22023';
  end if;
  select coalesce(gamertag, display_name, 'A staffer') into v_who from public.profiles where id = v_me;
  v_fixture := (select code from public.teams where id = g.away_team_id)||' @ '||(select code from public.teams where id = g.home_team_id)||
               ', '||to_char(g.scheduled_at at time zone 'America/New_York', 'Mon DD');
  v_what := case when coalesce(g.voided, false) then 'the void'
                 when g.forfeit_team_id is not null then 'the forfeit against '||(select code from public.teams where id = g.forfeit_team_id)
                 when g.status = 'final' then 'the filed result '||coalesce(g.home_score::text,'?')||'-'||coalesce(g.away_score::text,'?')
                 else 'this game' end;
  perform public.notify_commissioners(array[v_me], 'flag', 'A ruling needs a commissioner',
    v_who||' reports a mistake in '||v_what||' on '||v_fixture||': "'||left(v_note, 400)||'". Only a commissioner can reverse or change a ruling (Rule 3.2).',
    'game', p_game::text);
  get diagnostics v_n = row_count;
  perform public.log_admin_action('ruling_mistake_reported', 'game', p_game::text,
    jsonb_build_object('what', v_what, 'note', left(v_note, 1000), 'fixture', v_fixture));
  perform public.notify_staff_ch('casework', '**Ruling mistake reported**: '||v_who||' says '||v_what||' on '||v_fixture||
    ' is wrong. "'||left(v_note, 300)||'" A commissioner fixes it. https://chelgamingleague.com/#/matchup/'||p_game::text, false);
  return jsonb_build_object('ok', true, 'what', v_what, 'fixture', v_fixture);
end $fn$;
revoke all on function public.report_ruling_mistake(uuid, text) from public, anon;
grant execute on function public.report_ruling_mistake(uuid, text) to authenticated, service_role;

/* ---- The playoff series counter ---------------------------------------------------------------
   Before v3.52 a series was decided on goals alone and only when a game first went final, so a
   Rule 4.3 forfeit in which the forfeiting club scored more counted as ITS win, and a forfeit ruled
   on a game already final never re-ran the count. Now each game is decided by game_winner, the
   count re-runs whenever a playoff final's ruling or score changes, and a series is concluded once:
   the outcome is recorded in app_config, so a re-run with the same winner does nothing and a re-run
   that changes the winner of a series already concluded goes to the commissioners instead of
   rewriting news, the bracket or a championship on its own. */
create or replace function public.trg_conclude_series()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_best int; v_need int; v_hw int; v_aw int; v_key text; v_prev text;
  v_winner uuid; v_loser uuid; v_wname text; v_lname text; v_round text; v_num int;
  v_wwins int; v_lwins int; v_trimmed int;
begin
  if new.stage <> 'playoff' or new.status <> 'final' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'final'
     and old.forfeit_team_id is not distinct from new.forfeit_team_id
     and old.voided is not distinct from new.voided
     and old.home_score is not distinct from new.home_score
     and old.away_score is not distinct from new.away_score then
    return new;
  end if;
  v_best := public.playoff_best_of(new.season_id);
  v_need := v_best/2 + 1;
  select number into v_num from public.seasons where id = new.season_id;

  select count(*) filter (where public.game_winner(g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.forfeit_team_id, g.voided) = new.home_team_id),
         count(*) filter (where public.game_winner(g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.forfeit_team_id, g.voided) = new.away_team_id)
    into v_hw, v_aw
  from public.games g
  where g.season_id = new.season_id and g.stage = 'playoff' and g.week = new.week and g.status = 'final'
    and ((g.home_team_id = new.home_team_id and g.away_team_id = new.away_team_id)
      or (g.home_team_id = new.away_team_id and g.away_team_id = new.home_team_id));

  v_key := 'series_'||v_num||'_'||new.week||'_'||least(new.home_team_id::text, new.away_team_id::text)||'_'||greatest(new.home_team_id::text, new.away_team_id::text);
  select value into v_prev from public.app_config where key = v_key;

  if greatest(v_hw, v_aw) < v_need then
    if v_prev is not null then
      /* a ruling changed after the series ended and nobody has the wins any more */
      perform public.notify_commissioners(null, 'flag', 'A concluded playoff series no longer has a winner',
        'A ruling on a '||public.playoff_round_name(new.season_id, new.week)||' game changed after the series ended, and neither club now has '||v_need||' wins. The series, the bracket and any games already removed need a commissioner.',
        'game', new.id::text);
      perform public.log_admin_action('series_outcome_changed', 'game', new.id::text,
        jsonb_build_object('series', v_key, 'was', v_prev, 'now', null));
    end if;
    return new;
  end if;
  if v_hw >= v_need then v_winner := new.home_team_id; v_loser := new.away_team_id; v_wwins := v_hw; v_lwins := v_aw;
  else v_winner := new.away_team_id; v_loser := new.home_team_id; v_wwins := v_aw; v_lwins := v_hw; end if;

  if v_prev is not null then
    if v_prev <> v_winner::text then
      perform public.notify_commissioners(null, 'flag', 'A ruling changed who won a playoff series',
        'A ruling on a '||public.playoff_round_name(new.season_id, new.week)||' game changed after the series ended: '||
        (select name from public.teams where id = v_winner)||' now hold '||v_wwins||' wins. The bracket, the news and anything already set for the next round were written for the other club and need a commissioner.',
        'game', new.id::text);
      perform public.log_admin_action('series_outcome_changed', 'game', new.id::text,
        jsonb_build_object('series', v_key, 'was', v_prev, 'now', v_winner));
    end if;
    return new;
  end if;
  insert into public.app_config(key, value) values (v_key, v_winner::text) on conflict (key) do nothing;

  delete from public.games g
  where g.season_id = new.season_id and g.stage = 'playoff' and g.week = new.week and g.status = 'scheduled'
    and g.ea_match_id is null
    and ((g.home_team_id = new.home_team_id and g.away_team_id = new.away_team_id)
      or (g.home_team_id = new.away_team_id and g.away_team_id = new.home_team_id));
  get diagnostics v_trimmed = row_count;

  select name into v_wname from public.teams where id = v_winner;
  select name into v_lname from public.teams where id = v_loser;
  v_round := public.playoff_round_name(new.season_id, new.week);

  if new.week >= public.playoff_rounds(new.season_id) then
    if not exists (select 1 from public.app_config where key = 'champion_'||v_num) then
      insert into public.app_config(key, value) values ('champion_'||v_num, now()::text);
      insert into public.awards (season_id, week, category, team_id, stat_line, decided_by)
        values (new.season_id, null, 'champion', v_winner,
                'Won the final ' || v_wwins || '–' || v_lwins || ' over the ' || v_lname, 'auto')
        on conflict (season_id, week, category) do nothing;
      update public.seasons set status = 'complete' where id = new.season_id;
      insert into public.news (season_id, category, title, author, published_at, body)
        values (new.season_id, 'League News',
          v_wname || ' win the championship', 'CGHL Wire', now(),
          'It''s over. The ' || v_wname || ' take the final ' || v_wwins || '–' || v_lwins ||
          ' over the ' || v_lname || ' and are champions of the league.' || E'\n\n' ||
          'Every goal, save, and box score from the run is on the site. Congratulations to the ' || v_wname || ', and to every club that made the season what it was.');
      insert into public.transactions (season_id, type, description)
        values (new.season_id, 'award', 'The ' || v_wname || ' win the championship, ' || v_wwins || '–' || v_lwins || ' in the final');
    end if;
  else
    insert into public.news (season_id, category, title, author, published_at, body)
      values (new.season_id, 'Game Recap',
        v_wname || ' advance: ' || v_round || ' series ends ' || v_wwins || '–' || v_lwins, 'CGHL Wire', now(),
        'The ' || v_wname || ' close out their ' || v_round || ' series against the ' || v_lname || ', ' ||
        v_wwins || '–' || v_lwins || case when v_trimmed > 0 then '. The unneeded game' || case when v_trimmed=1 then '' else 's' end || ' came off the schedule automatically' else '' end ||
        '. The bracket on the standings page is updated, and the next round is set from the Control Center.');
  end if;
  return new;
end $fn$;
revoke all on function public.trg_conclude_series() from public, anon, authenticated;

/* ---- The clinch counter reads a game the way the standings do -------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.check_playoff_clinches(uuid)'::regprocedure);
  d := replace(d0,
'    coalesce(sum(case
      when g.status=''final'' and ((g.home_team_id=tm.id and g.home_score>g.away_score) or (g.away_team_id=tm.id and g.away_score>g.home_score)) then 2
      when g.status=''final'' and g.went_ot then 1
      else 0 end),0)::int,
    coalesce(sum(case when g.status=''final'' and ((g.home_team_id=tm.id and g.home_score>g.away_score) or (g.away_team_id=tm.id and g.away_score>g.home_score)) then 1 else 0 end),0)::int,
    coalesce(sum(case when g.status=''final'' and not g.went_ot and ((g.home_team_id=tm.id and g.home_score<g.away_score) or (g.away_team_id=tm.id and g.away_score<g.home_score)) then 1 else 0 end),0)::int,
    coalesce(sum(case when g.status=''final'' and g.went_ot and ((g.home_team_id=tm.id and g.home_score<g.away_score) or (g.away_team_id=tm.id and g.away_score<g.home_score)) then 1 else 0 end),0)::int,',
'    /* v3.52: decided by game_winner, as the standings are: a forfeit decides a game whatever the
       goals say and never earns the overtime point; a void counts for nobody. */
    coalesce(sum(case
      when g.status=''final'' and not coalesce(g.voided,false) and public.game_winner(g.home_team_id,g.away_team_id,g.home_score,g.away_score,g.forfeit_team_id,g.voided) = tm.id then 2
      when g.status=''final'' and not coalesce(g.voided,false) and g.forfeit_team_id is null and g.went_ot then 1
      else 0 end),0)::int,
    coalesce(sum(case when g.status=''final'' and not coalesce(g.voided,false) and public.game_winner(g.home_team_id,g.away_team_id,g.home_score,g.away_score,g.forfeit_team_id,g.voided) = tm.id then 1 else 0 end),0)::int,
    coalesce(sum(case when g.status=''final'' and not coalesce(g.voided,false) and public.game_winner(g.home_team_id,g.away_team_id,g.home_score,g.away_score,g.forfeit_team_id,g.voided) is distinct from tm.id and (g.forfeit_team_id is not null or not g.went_ot) then 1 else 0 end),0)::int,
    coalesce(sum(case when g.status=''final'' and not coalesce(g.voided,false) and public.game_winner(g.home_team_id,g.away_team_id,g.home_score,g.away_score,g.forfeit_team_id,g.voided) is distinct from tm.id and g.forfeit_team_id is null and g.went_ot then 1 else 0 end),0)::int,');
  if d = d0 then raise exception 'check_playoff_clinches patch matched nothing'; end if;
  execute d;
end $mig$;

/* The clinch check re-runs when a regular-season ruling or score changes on a final, not only on
   the transition into final, so a forfeit ruled later is counted. check_playoff_clinches is
   idempotent (a clinch is recorded once per club). */
create or replace function public.trg_check_clinches()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if new.status = 'final' and new.stage = 'regular' and (
       old.status is distinct from new.status
    or old.forfeit_team_id is distinct from new.forfeit_team_id
    or old.voided is distinct from new.voided
    or old.home_score is distinct from new.home_score
    or old.away_score is distinct from new.away_score) then
    perform public.check_playoff_clinches(new.season_id);
  end if;
  return new;
end $fn$;
revoke all on function public.trg_check_clinches() from public, anon, authenticated;

/* REHEARSAL (2026-09-28, one transaction, rolled back): every check passed.
   T0  a commissioner declares a forfeit on a future regular fixture.
   T1  an officiating staffer's undo_forfeit is refused ("Only a commissioner ...").
   T2  a statistics staffer's unforfeit_game is refused, and so is stats_game_set_result on the ruled game.
   T3  report_ruling_mistake: a note under 10 characters is refused; a real one rings all three
       commissioners' bells and writes the audit row; the same staffer reporting again within the
       hour is refused; a player (no staff role) is refused.
   T4  a commissioner's undo_forfeit returns the game to scheduled with no ruling.
   T5  a best-of-seven: three wins for A on goals, then a game A leads 4-2 on the ice but is charged
       the forfeit in the same write. The series is NOT concluded on goals. A's fourth real win then
       concludes it for A, the unneeded games come off the schedule, and one news item is written;
       a later score change with the same winner writes no second item.
   T6  a forfeit stamped on an already-final game re-runs the count: the concluded series no longer
       has a winner and all three commissioners are told.
   T7  check_playoff_clinches: charging a real regular-season winner with the forfeit moves two
       points from him to his opponent.
   T8  game_winner truth table: level none, forfeit decides, void none, away wins on goals. */
