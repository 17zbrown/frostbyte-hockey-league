-- v3.93, part three (2026-10-12): fixes from the read-only adversarial review of parts one and two.
--
--  1. A HELD game (box score on file, result withheld for a lag-out, Rule 4.3) counts as played, in the counter and
--     in the forfeit check's running count. Rule 5.2 says a game counts once its box score is on file with him in it;
--     before this, a club could be told a player had room while his held game was waiting, and lose the later game.
--  2. A weekly-limit exception can be granted before the night again: grant_cap_exception reads the games he has
--     played plus the sheets filed for him in this limit week's earlier games still to be played, not played alone.
--  3. The automatic forfeit and the overturn no longer write to transactions. A transactions row posts to
--     #transactions with club-role and player mentions; a forfeit is announced in #game-scores only (v3.34).
--  4. A commissioner's Undo forfeit (undo_forfeit, unforfeit_game) on an automatic forfeit records exceptions for the
--     players it named, as an overturn does, so the result filed again is not forfeited again.
--  5. The check also reads a game that is already a forfeit (an abandoned game ruled under Rule 4.3): if the OTHER
--     club played someone past his limit, the commissioners are told; nothing is written.
--  6. The trigger serializes a season's limit week (advisory lock), so two finals committed together cannot both miss
--     a player's over-limit appearance. The body moved to _limit_forfeit_recheck.
--  7. A rewrite of a final game's box score (a re-ingest, a merge, a stats-desk correction, a late link of a line)
--     re-checks that game and the later finals of its week: statement-level triggers on game_stats.
--  8. forfeit_game refuses to overwrite a forfeit already on a game unless a commissioner calls it (v3.52's rule for
--     reversals, applied to the overwrite door the review found).
--  9. The forfeit appeal: its type, game, club, filer and route are fixed once filed; one appeal per game is a unique
--     index (concurrent filings); decide_forfeit_appeal locks the case, and an appeal whose forfeit is gone or changed
--     is closed as moot instead of being told "the forfeit stands"; an appeal is only for the club the latest
--     automatic ruling named; the club's current Owner, GM and AGM can read and reply on it.
-- 10. ops_exempt_game_limits refuses a call that would change nothing (it used to publish a false ruling).

-- shared: excuse the players an automatic forfeit named, so the same game is never ruled again ----------------------
create or replace function public._limit_forfeit_excuse(p_game uuid, p_team uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_detail jsonb; x jsonb; g public.games; v_n int := 0;
begin
  select * into g from public.games where id = p_game;
  if g.id is null then return 0; end if;
  select a.detail into v_detail from public.admin_audit a
   where a.action = 'limit_forfeit' and a.target_id = p_game::text order by a.created_at desc limit 1;
  if v_detail is null or (v_detail->>'forfeited_by') is distinct from (select code from public.teams where id = p_team) then
    return 0;
  end if;
  for x in select * from jsonb_array_elements(coalesce(v_detail->'players', '[]'::jsonb)) loop
    if (x->>'team_id')::uuid = p_team then
      insert into public.weekly_cap_exceptions (season_id, game_id, profile_id, team_id, reason, granted_by)
        values (g.season_id, p_game, (x->>'profile_id')::uuid, p_team, left(p_reason, 500), auth.uid())
        on conflict (game_id, profile_id) do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $function$;
revoke execute on function public._limit_forfeit_excuse(uuid, uuid, text) from public, anon, authenticated;

-- 1. the counter: a held game counts --------------------------------------------------------------------------------
do $p$
declare v_def text := pg_get_functiondef('public.player_week_games(uuid,text,integer,uuid,uuid)'::regprocedure);
        a text := '     and g.status = ''final''
     and not coalesce(g.voided, false)';
        b text := '     and (g.status = ''final'' or (g.status = ''scheduled'' and g.ea_match_id is not null))   -- v3.93: a held game (box score on file) counts
     and not coalesce(g.voided, false)';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.93 fix: player_week_games anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- 2. exceptions before the night ----------------------------------------------------------------------------------
do $p$
declare v_def text := pg_get_functiondef('public.grant_cap_exception(uuid,uuid,text)'::regprocedure);
        a text := '  v_n := public.player_week_games(g.season_id, g.stage, coalesce(g.limit_week, g.week), p_profile, p_game);';
        b text := '  v_n := public.player_week_games(g.season_id, g.stage, coalesce(g.limit_week, g.week), p_profile, p_game)
         /* v3.93: plus the sheets filed for him in this week''s earlier games still to be played, so the office can
            excuse him before the night, as Rule 5.2 says, although only games played count toward the limit */
         + (select count(*)::int from public.games g2
             where g2.season_id = g.season_id and g2.stage = g.stage
               and coalesce(g2.limit_week, g2.week) = coalesce(g.limit_week, g.week)
               and g2.status = ''scheduled'' and g2.ea_match_id is null
               and not coalesce(g2.voided, false) and not coalesce(g2.limits_exempt, false) and g2.id <> p_game
               and (g2.scheduled_at < g.scheduled_at or (g2.scheduled_at = g.scheduled_at and g2.id < g.id))
               and exists (select 1 from public.game_lineups gl where gl.game_id = g2.id
                            and p_profile in (gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie)));';
        c text := 'raise exception ''% still has room: % of % games used, so no exception is needed.''';
        d text := 'raise exception ''% still has room: % of % games played or dressed for earlier this week, so no exception is needed.''';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1
     or (length(v_def) - length(replace(v_def, c, ''))) / length(c) <> 1 then raise exception 'v3.93 fix: grant_cap_exception anchors'; end if;
  execute replace(replace(v_def, a, b), c, d);
end $p$;

-- 3, 5, 6. the check, the recheck and the trigger ---------------------------------------------------------------------
create or replace function public._limit_forfeit_check(p_game uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.games; r record; v_week int; v_from timestamptz; v_squad text; v_pos text; v_cap int; v_n int;
        v_bad jsonb := '[]'::jsonb; v_teams uuid[] := '{}'; v_team uuid; v_opp uuid; v_name text;
        v_fix text; v_list text; v_tname text; v_oname text;
begin
  select * into g from public.games where id = p_game;
  if g.id is null or coalesce(g.stage, 'regular') <> 'regular' or g.status <> 'final'
     or coalesce(g.voided, false) or coalesce(g.limits_exempt, false) then
    return null;
  end if;
  v_from := coalesce((select value from public.app_config where key = 'limit_forfeit_from')::timestamptz, 'infinity'::timestamptz);
  if g.scheduled_at < v_from then return null; end if;
  v_week := coalesce(g.limit_week, g.week);

  for r in select gs.team_id, gs.profile_id, bool_or(coalesce(gs.is_goalie, false)) as is_goalie
             from public.game_stats gs where gs.game_id = g.id and gs.profile_id is not null
            group by gs.team_id, gs.profile_id loop
    select rs.squad, rs.position::text into v_squad, v_pos from public.roster_spots rs
     where rs.season_id = g.season_id and rs.team_id = r.team_id and rs.profile_id = r.profile_id limit 1;
    v_cap := public.weekly_cap(g.season_id, v_squad, coalesce(v_pos, case when r.is_goalie then 'G' else 'C' end), 'regular');
    -- his games of the week up to and including this one, in schedule order (Rule 5.2); a held game counts
    select count(*) into v_n from public.games g2
     where g2.season_id = g.season_id and coalesce(g2.stage, 'regular') = 'regular'
       and coalesce(g2.limit_week, g2.week) = v_week
       and (g2.status = 'final' or (g2.status = 'scheduled' and g2.ea_match_id is not null))
       and not coalesce(g2.voided, false) and not coalesce(g2.limits_exempt, false)
       and (g2.scheduled_at < g.scheduled_at or (g2.scheduled_at = g.scheduled_at and g2.id <= g.id))
       and exists (select 1 from public.game_stats gs where gs.game_id = g2.id and gs.profile_id = r.profile_id);
    if v_n > v_cap and not public.has_cap_exception(g.id, r.profile_id) then
      select coalesce(nullif(gamertag, ''), display_name, 'a player') into v_name from public.profiles where id = r.profile_id;
      v_bad := v_bad || jsonb_build_object('team_id', r.team_id, 'profile_id', r.profile_id, 'player', v_name, 'games', v_n, 'cap', v_cap);
      if not (r.team_id = any(v_teams)) then v_teams := v_teams || r.team_id; end if;
    end if;
  end loop;

  if coalesce(array_length(v_teams, 1), 0) = 0 then return null; end if;

  v_fix := (select name from public.teams where id = g.away_team_id) || ' at ' || (select name from public.teams where id = g.home_team_id)
           || ', ' || to_char(g.scheduled_at at time zone 'America/New_York', 'FMDy FMMon FMDD, FMHH12:MI AM') || ' ET';

  -- already a forfeit (an abandoned game, an earlier ruling): never written; the office hears if the OTHER club did it
  if g.forfeit_team_id is not null then
    if exists (select 1 from unnest(v_teams) t where t <> g.forfeit_team_id)
       and not exists (select 1 from public.admin_audit a where a.action = 'limit_forfeit_both' and a.target_id = g.id::text) then
      perform public.log_admin_action('limit_forfeit_both', 'game', g.id::text, jsonb_build_object('week', v_week, 'players', v_bad, 'already_forfeit', true));
      select string_agg((x->>'player') || ' (' || (x->>'games') || ' of ' || (x->>'cap') || ')', ', ') into v_list from jsonb_array_elements(v_bad) x;
      perform public.notify_commissioners(null, 'flag', 'A player went over the weekly limit in a game already ruled a forfeit',
        v_fix || ' is already a forfeit against ' || (select name from public.teams where id = g.forfeit_team_id) || ', and the other club played ' || v_list
        || ' past the weekly limit. A commissioner rules it (Rule 5.2).', 'admin', null);
      perform public.notify_department('officiating', 'flag', 'A player went over the weekly limit in a game already ruled a forfeit',
        v_fix || ': ' || v_list || '. A commissioner rules it (Rule 5.2).', 'staffdesk', null);
    end if;
    return null;
  end if;

  if array_length(v_teams, 1) > 1 then
    -- both clubs did it: no automatic ruling, once per game
    if not exists (select 1 from public.admin_audit a where a.action = 'limit_forfeit_both' and a.target_id = g.id::text) then
      perform public.log_admin_action('limit_forfeit_both', 'game', g.id::text, jsonb_build_object('week', v_week, 'players', v_bad));
      select string_agg((x->>'player') || ' (' || (x->>'games') || ' of ' || (x->>'cap') || ')', ', ') into v_list from jsonb_array_elements(v_bad) x;
      perform public.notify_commissioners(null, 'flag', 'Both clubs played a player over the weekly limit',
        v_fix || ': ' || v_list || '. No automatic forfeit is ruled when both clubs did it; a commissioner rules the game (Rule 5.2).', 'admin', null);
      perform public.notify_department('officiating', 'flag', 'Both clubs played a player over the weekly limit',
        v_fix || ': ' || v_list || '. A commissioner rules the game (Rule 5.2).', 'staffdesk', null);
    end if;
    return jsonb_build_object('ruled', false, 'both', true, 'players', v_bad);
  end if;

  v_team := v_teams[1];
  v_opp := case when v_team = g.home_team_id then g.away_team_id else g.home_team_id end;
  select name into v_tname from public.teams where id = v_team;
  select name into v_oname from public.teams where id = v_opp;
  select string_agg((x->>'player') || ' (game ' || (x->>'games') || ', limit ' || (x->>'cap') || ')', ', ') into v_list
    from jsonb_array_elements(v_bad) x;

  update public.games set forfeit_team_id = v_team where id = g.id;   -- the result as played stays on record
  perform public.log_admin_action('limit_forfeit', 'game', g.id::text,
    jsonb_build_object('forfeited_by', (select code from public.teams where id = v_team), 'week', v_week,
                       'score', g.home_score || '-' || g.away_score, 'players', v_bad));
  -- no transactions row: it would post to #transactions with mentions; a forfeit is announced in #game-scores (v3.34)
  perform public.club_notify(v_team, 'flag', 'Forfeit: a player went over the weekly game limit',
    v_fix || ' is ruled a forfeit loss for ' || v_tname || ': ' || v_list || ' played past the weekly game limit (Rule 5.2). '
    || 'The result as played stays on record and every statistic stands. If this is a mistake, your Owner, GM or AGM can appeal: '
    || 'file a case on the site, choose Forfeit appeal and pick this game. A commissioner decides it.',
    null, 'game', g.id::text, null, true);
  perform public.club_notify(v_opp, 'flag', 'Win by forfeit: ' || v_fix,
    v_tname || ' played ' || v_list || ' past the weekly game limit, so the game is ruled a forfeit win for ' || v_oname
    || ' (Rule 5.2). The result as played stays on record. ' || v_tname || ' may appeal it.',
    null, 'game', g.id::text, null, true);
  perform public.notify_department('officiating', 'flag', 'Automatic forfeit: over the weekly game limit',
    v_fix || ': ' || v_tname || ' played ' || v_list || ' past the limit, so the game is ruled a forfeit loss for it (Rule 5.2).', 'staffdesk', null);
  begin
    perform public.notify_discord('discord_scores_webhook',
      format('🏒 **Forfeit** (Rule 5.2): %s played a player over the weekly game limit, so %s goes to %s by forfeit. The result as played stays on record.',
        public.team_mention(v_team), v_fix, public.team_mention(v_opp)), false);
  exception when others then
    raise warning '_limit_forfeit_check scores post failed for game %: %', g.id, sqlerrm;
  end;
  return jsonb_build_object('ruled', true, 'forfeited_by', v_team, 'players', v_bad);
end $function$;
revoke execute on function public._limit_forfeit_check(uuid) from public, anon, authenticated;

create or replace function public._limit_forfeit_recheck(p_game uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.games; v_id uuid;
begin
  select * into g from public.games where id = p_game;
  if g.id is null or coalesce(g.stage, 'regular') <> 'regular' then return; end if;
  begin
    -- one limit week at a time, so two finals committed together cannot both miss an appearance
    perform pg_advisory_xact_lock(hashtext('limitweek'), hashtext(g.season_id::text || ':' || coalesce(g.limit_week, g.week)::text));
    perform public._limit_forfeit_check(g.id);
    -- the later finals of the week that share a player were counted without this game's lines; count them again
    for v_id in
      select g2.id from public.games g2
       where g2.season_id = g.season_id and coalesce(g2.stage, 'regular') = 'regular' and g2.status = 'final'
         and coalesce(g2.limit_week, g2.week) = coalesce(g.limit_week, g.week) and g2.id <> g.id
         and (g2.scheduled_at > g.scheduled_at or (g2.scheduled_at = g.scheduled_at and g2.id > g.id))
         and exists (select 1 from public.game_stats a join public.game_stats b on b.profile_id = a.profile_id
                      where a.game_id = g.id and b.game_id = g2.id and a.profile_id is not null)
       order by g2.scheduled_at, g2.id
    loop
      perform public._limit_forfeit_check(v_id);
    end loop;
  exception when others then
    raise warning '_limit_forfeit_recheck failed for game %: %', p_game, sqlerrm;
    begin
      perform public.notify_commissioners(null, 'flag', 'The automatic over-limit forfeit check failed',
        'A game''s weekly game limit check (Rule 5.2) failed: ' || sqlerrm || '. Check the game by hand.', 'admin', null);
    exception when others then null;
    end;
  end;
end $function$;
revoke execute on function public._limit_forfeit_recheck(uuid) from public, anon, authenticated;

create or replace function public.trg_limit_forfeit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._limit_forfeit_recheck(new.id);   -- never raises; a final is never blocked
  return null;
end $function$;
revoke execute on function public.trg_limit_forfeit() from public, anon, authenticated;

-- 7. a rewritten box score is checked again ---------------------------------------------------------------------------
-- statement triggers carry transition tables (a transition table cannot sit beside a column list), so one function
-- per shape: inserted rows, deleted rows, and an update's old and new rows (a line moved between games rechecks both)
create or replace function public.trg_limit_forfeit_stats_ins() returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_id uuid;
begin
  begin
    for v_id in select g.id from public.games g where g.status = 'final' and coalesce(g.stage, 'regular') = 'regular'
                  and g.id in (select distinct game_id from changed_new) order by g.scheduled_at, g.id loop
      perform public._limit_forfeit_recheck(v_id);
    end loop;
  exception when others then raise warning 'trg_limit_forfeit_stats_ins failed: %', sqlerrm;
  end;
  return null;
end $f$;
create or replace function public.trg_limit_forfeit_stats_del() returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_id uuid;
begin
  begin
    for v_id in select g.id from public.games g where g.status = 'final' and coalesce(g.stage, 'regular') = 'regular'
                  and g.id in (select distinct game_id from changed_old) order by g.scheduled_at, g.id loop
      perform public._limit_forfeit_recheck(v_id);
    end loop;
  exception when others then raise warning 'trg_limit_forfeit_stats_del failed: %', sqlerrm;
  end;
  return null;
end $f$;
create or replace function public.trg_limit_forfeit_stats_upd() returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare v_id uuid;
begin
  begin
    for v_id in select g.id from public.games g where g.status = 'final' and coalesce(g.stage, 'regular') = 'regular'
                  and g.id in (select game_id from changed_new union select game_id from changed_old) order by g.scheduled_at, g.id loop
      perform public._limit_forfeit_recheck(v_id);
    end loop;
  exception when others then raise warning 'trg_limit_forfeit_stats_upd failed: %', sqlerrm;
  end;
  return null;
end $f$;
revoke execute on function public.trg_limit_forfeit_stats_upd() from public, anon, authenticated;
revoke execute on function public.trg_limit_forfeit_stats_ins() from public, anon, authenticated;
revoke execute on function public.trg_limit_forfeit_stats_del() from public, anon, authenticated;
drop trigger if exists trg_limit_forfeit_stats_ins on public.game_stats;
drop trigger if exists trg_limit_forfeit_stats_upd on public.game_stats;
drop trigger if exists trg_limit_forfeit_stats_del on public.game_stats;
create trigger trg_limit_forfeit_stats_ins after insert on public.game_stats
  referencing new table as changed_new for each statement execute function public.trg_limit_forfeit_stats_ins();
create trigger trg_limit_forfeit_stats_upd after update on public.game_stats
  referencing old table as changed_old new table as changed_new for each statement execute function public.trg_limit_forfeit_stats_upd();
create trigger trg_limit_forfeit_stats_del after delete on public.game_stats
  referencing old table as changed_old for each statement execute function public.trg_limit_forfeit_stats_del();

-- 4. a commissioner's Undo forfeit excuses the named players ------------------------------------------------------------
do $p$
declare v_def text := pg_get_functiondef('public.undo_forfeit(uuid)'::regprocedure);
        a text := '    forfeit_team_id = null, voided = false, status = ''scheduled'' where id = p_game;';
        b text := '    forfeit_team_id = null, voided = false, status = ''scheduled'' where id = p_game;
  /* v3.93: an automatic over-limit forfeit undone by a commissioner is excused, so the result filed again is not
     forfeited again (Rule 5.2) */
  if g.forfeit_team_id is not null then
    perform public._limit_forfeit_excuse(p_game, g.forfeit_team_id, ''Automatic forfeit undone by a commissioner'');
  end if;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.93 fix: undo_forfeit anchor'; end if;
  execute replace(v_def, a, b);
end $p$;
do $p$
declare v_def text := pg_get_functiondef('public.unforfeit_game(uuid)'::regprocedure);
        a text := '    went_ot = false, forfeit_team_id = null
  where id = p_game;';
        b text := '    went_ot = false, forfeit_team_id = null
  where id = p_game;
  /* v3.93: an automatic over-limit forfeit undone by a commissioner is excused (Rule 5.2) */
  perform public._limit_forfeit_excuse(p_game, v_g.forfeit_team_id, ''Automatic forfeit undone by a commissioner'');';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.93 fix: unforfeit_game anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- 8. forfeit_game never overwrites a forfeit unless a commissioner calls it ---------------------------------------------
do $p$
declare v_def text := pg_get_functiondef('public.forfeit_game(uuid,uuid,text,boolean)'::regprocedure);
        a text := '  if p_forfeiting_team not in (v_g.home_team_id, v_g.away_team_id) then';
        b text := '  /* v3.93: a forfeit already on the game is changed by a commissioner only (v3.52) */
  if v_g.forfeit_team_id is not null and not public.is_commissioner() then
    raise exception ''This game already carries a forfeit ruling. Only a commissioner can change it: report the mistake to the commissioners from the game.'' using errcode = ''42501'';
  end if;
  if p_forfeiting_team not in (v_g.home_team_id, v_g.away_team_id) then';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.93 fix: forfeit_game anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- 9. the appeal -----------------------------------------------------------------------------------------------------
create unique index if not exists action_requests_one_forfeit_appeal on public.action_requests (game_id) where type = 'forfeit_appeal';

create or replace function public.guard_forfeit_appeal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.games;
begin
  if tg_op = 'UPDATE' then
    if old.type = 'forfeit_appeal' or new.type = 'forfeit_appeal' then
      -- fixed once filed (the game may only go null through its foreign key when the game is deleted)
      if new.type is distinct from old.type or new.profile_id is distinct from old.profile_id
         or new.route is distinct from old.route
         or (new.team_id is distinct from old.team_id and new.team_id is not null)
         or (new.game_id is distinct from old.game_id and new.game_id is not null) then
        raise exception 'A forfeit appeal''s game, club, filer and type are fixed once it is filed (Rule 5.2).' using errcode = '42501';
      end if;
      -- only decide_forfeit_appeal closes one, so a "resolved" appeal always means the forfeit was overturned
      if new.status is distinct from old.status and new.status in ('resolved','denied')
         and coalesce(current_setting('app.forfeit_appeal_decide', true), '') <> 'on' then
        raise exception 'A forfeit appeal is decided with Overturn or Deny on the case, by a commissioner.';
      end if;
    end if;
    return new;
  end if;
  if new.type <> 'forfeit_appeal' then return new; end if;
  select * into g from public.games where id = new.game_id;
  if g.id is null then raise exception 'Pick the game the forfeit was ruled in.'; end if;
  if g.forfeit_team_id is null then raise exception 'That game is not a forfeit.'; end if;
  if not exists (select 1 from public.teams t where t.id = g.forfeit_team_id
                  and new.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id)) then
    raise exception 'A forfeit appeal is filed by the Owner, GM or AGM of the club that forfeited.' using errcode = 'check_violation';
  end if;
  -- the latest automatic ruling must be the forfeit that stands now, against this club
  if coalesce((select a.detail->>'forfeited_by' from public.admin_audit a
                where a.action = 'limit_forfeit' and a.target_id = g.id::text order by a.created_at desc limit 1), '')
     <> coalesce((select code from public.teams where id = g.forfeit_team_id), '-') then
    raise exception 'Only an automatic forfeit for playing someone over the weekly game limit is appealed here (Rule 5.2). For any other ruling, file a complaint.';
  end if;
  if exists (select 1 from public.action_requests x where x.type = 'forfeit_appeal' and x.game_id = g.id) then
    raise exception 'This forfeit has already been appealed. Each forfeit may be appealed once.';
  end if;
  new.team_id := g.forfeit_team_id;
  new.route := 'commissioner';
  new.dept := 'officiating';
  new.season_id := g.season_id;
  new.subject := 'Forfeit appeal: ' || (select code from public.teams where id = g.away_team_id) || ' at '
                 || (select code from public.teams where id = g.home_team_id) || ', '
                 || to_char(g.scheduled_at at time zone 'America/New_York', 'Mon DD');
  return new;
end $function$;
revoke execute on function public.guard_forfeit_appeal() from public, anon, authenticated;

create or replace function public.decide_forfeit_appeal(p_request uuid, p_overturn boolean, p_response text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a public.action_requests; g public.games; v_resp text := btrim(coalesce(p_response, '')); v_me uuid := auth.uid();
        v_fix text;
begin
  if not public.is_commissioner() then
    raise exception 'Only a commissioner decides a forfeit appeal.' using errcode = '42501';
  end if;
  select * into a from public.action_requests where id = p_request for update;   -- two commissioners cannot both decide
  if a.id is null or a.type <> 'forfeit_appeal' then raise exception 'That is not a forfeit appeal.'; end if;
  if a.status in ('resolved','denied') then raise exception 'This appeal has already been decided.'; end if;
  if v_resp = '' then raise exception 'Give the reason for the decision; the club sees it.'; end if;
  select * into g from public.games where id = a.game_id for update;
  perform set_config('app.forfeit_appeal_decide', 'on', true);

  -- moot: the game is gone, or the forfeit against this club no longer stands (lifted or changed by the office)
  if g.id is null or g.forfeit_team_id is distinct from a.team_id then
    perform public.log_admin_action('limit_forfeit_appeal_moot', 'action_request', a.id::text,
      jsonb_build_object('game', a.game_id, 'reason', left(v_resp, 1000)));
    perform public.club_notify(a.team_id, 'flag', 'Forfeit appeal closed',
      'The forfeit this appeal was about no longer stands as ruled, so there is nothing left to decide. ' || v_resp, v_me,
      case when g.id is null then null else 'game' end, case when g.id is null then null else g.id::text end, null, false);
    update public.action_requests set status = 'resolved', response = 'Closed: the forfeit no longer stands as ruled. ' || v_resp, updated_at = now() where id = a.id;
    perform set_config('app.forfeit_appeal_decide', '', true);
    return;
  end if;

  v_fix := (select name from public.teams where id = g.away_team_id) || ' at ' || (select name from public.teams where id = g.home_team_id)
           || ', ' || to_char(g.scheduled_at at time zone 'America/New_York', 'FMMon FMDD');
  if coalesce(p_overturn, false) then
    -- the appearance is excepted, so a re-final of this game never rules it again (Rule 5.2)
    perform public._limit_forfeit_excuse(g.id, a.team_id, 'Forfeit appeal upheld: ' || v_resp);
    update public.games set forfeit_team_id = null where id = g.id;   -- final as played
    perform public.log_admin_action('limit_forfeit_overturned', 'game', g.id::text,
      jsonb_build_object('request', a.id, 'reason', left(v_resp, 1000)));
    begin
      perform public.notify_discord('discord_scores_webhook',
        format('🏒 **Overturned on appeal**: the forfeit against %s in %s no longer stands. The result as played stands.',
          public.team_mention(a.team_id), v_fix), false);
    exception when others then raise warning 'decide_forfeit_appeal scores post failed: %', sqlerrm;
    end;
    perform public.club_notify(a.team_id, 'flag', 'Forfeit overturned on appeal',
      'The forfeit in ' || v_fix || ' is overturned and the result as played stands. ' || v_resp, v_me, 'game', g.id::text, null, true);
    perform public.club_notify(case when a.team_id = g.home_team_id then g.away_team_id else g.home_team_id end, 'flag',
      'Forfeit overturned on appeal: ' || v_fix,
      'The forfeit ruled in ' || v_fix || ' was overturned on appeal, so the result as played stands. ' || v_resp, v_me, 'game', g.id::text, null, true);
    update public.action_requests set status = 'resolved', response = v_resp, updated_at = now() where id = a.id;
  else
    perform public.log_admin_action('limit_forfeit_appeal_denied', 'game', g.id::text,
      jsonb_build_object('request', a.id, 'reason', left(v_resp, 1000)));
    perform public.club_notify(a.team_id, 'flag', 'Forfeit appeal denied',
      'The appeal of the forfeit in ' || v_fix || ' is denied, so the forfeit stands. ' || v_resp, v_me, 'game', g.id::text, null, false);
    update public.action_requests set status = 'denied', response = v_resp, updated_at = now() where id = a.id;
  end if;
  perform set_config('app.forfeit_appeal_decide', '', true);
end $function$;
revoke execute on function public.decide_forfeit_appeal(uuid, boolean, text) from public, anon;
grant execute on function public.decide_forfeit_appeal(uuid, boolean, text) to authenticated;

-- the club's current seats can read and reply on its own forfeit appeal
alter policy ar_read on public.action_requests using (
  (profile_id = (select auth.uid())) or is_commissioner()
  or ((coalesce(route, '') <> 'manager') and is_staff() and (not is_media_only_staff((select auth.uid()))))
  or ((route = 'manager') and is_gm_of(team_id))
  or ((type = 'forfeit_appeal') and is_gm_of(team_id)));
create or replace function public.can_see_request(p_req uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from action_requests r where r.id = p_req and (
      r.profile_id = (select auth.uid())
      or is_commissioner()
      or is_staff()
      or (r.route = 'manager' and public.is_gm_of(r.team_id))
      or (r.type = 'forfeit_appeal' and public.is_gm_of(r.team_id))   -- v3.93: the club's own forfeit appeal
    )
  );
$function$;

-- 10. a ruling that changes nothing is refused ------------------------------------------------------------------------
do $p$
declare v_def text := pg_get_functiondef('public.ops_exempt_game_limits(uuid,boolean,text)'::regprocedure);
        a text := '  if v_reason = '''' then raise exception ''Give the reason for the ruling.''; end if;';
        b text := '  if v_reason = '''' then raise exception ''Give the reason for the ruling.''; end if;
  if coalesce(g.limits_exempt, false) = coalesce(p_exempt, false) then
    raise exception ''%'', case when coalesce(p_exempt, false) then ''That game is already exempt from the weekly game limits.''
                              else ''That game is not exempt from the weekly game limits; there is no exemption to lift.'' end;
  end if;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.93 fix: ops_exempt_game_limits anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

do $chk$
begin
  if position('g2.ea_match_id is not null' in pg_get_functiondef('public._limit_forfeit_check(uuid)'::regprocedure)) = 0
     or position('ea_match_id is not null' in pg_get_functiondef('public.player_week_games(uuid,text,integer,uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'v3.93 fix: held games are not counted';
  end if;
  if position('insert into public.transactions' in pg_get_functiondef('public._limit_forfeit_check(uuid)'::regprocedure)) > 0
     or position('insert into public.transactions' in pg_get_functiondef('public.decide_forfeit_appeal(uuid,boolean,text)'::regprocedure)) > 0 then
    raise exception 'v3.93 fix: a forfeit path still writes transactions';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.game_stats'::regclass and tgname like 'trg_limit_forfeit_stats_%') <> 3 then
    raise exception 'v3.93 fix: the box-score recheck triggers are missing';
  end if;
end $chk$;
