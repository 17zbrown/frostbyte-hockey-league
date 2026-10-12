-- v3.93, part two (2026-10-12): weekly game limits count only games PLAYED; playing a player over the limit is an
-- automatic forfeit loss, appealable by the club; the made-up Islanders at Stars game is exempt from the limits.
--
-- Commissioner, 2026-10-12: "remove the player games played limits for that rescheduled game. For all weeks moving
-- forward for the season. Any game played with a player over their limit of weekly games will be an automatic
-- forfeit loss for that team. The team management has the opportunity to appeal the forfeit if there is a mistake
-- of some kind. In the scheduler, make sure to only count the games played from box scores and mid games forfeits as
-- their counter. Do not count future games they are scheduled in as games played until you receive results with
-- them tied to it."
--
-- 1. games.limits_exempt: a game the league office rules counts toward no week's limits (Rule 3.3). Written only by
--    ops_exempt_game_limits. Islanders at Stars (Wed Oct 14, 8:25 PM ET) is exempted, and its earlier Week 3 ruling
--    (limit_week, part one) is cleared by the same door.
-- 2. player_week_games counts a FINAL game whose box score has a line for the player, nothing else. A game forfeited
--    after disconnections keeps its box score (Rule 4.3) and counts; a forfeit nobody skated in has no lines and
--    counts for no one; a filed lineup for a game still to come no longer counts. The lineup gate therefore refuses
--    only a player who has already PLAYED his limit that week.
-- 3. _limit_forfeit_check + trigger trg_a_limit_forfeit: when a regular-season game goes final (from Oct 12 2026,
--    app_config limit_forfeit_from), each player in its box score is counted over the games of that limit week he
--    played up to and including this one, in schedule order. If one club played anyone past his limit (no office
--    exception for him in this game), that club forfeits: forfeit_team_id is set and the result as played stays on
--    record (Rule 4.3's kept-result form). If both clubs did, nothing is ruled automatically and the commissioners
--    are told. A later game of the same week that already went final (a held game merged late) is re-checked when an
--    earlier one lands, because its running count just grew. The trigger name sorts first among the final triggers
--    so the forfeit is in place before the night recap and the officiating review read the game. Any failure is
--    caught, so a final is never blocked (the v3.01 lesson), and the commissioners are told.
-- 4. Appeal: action_requests type 'forfeit_appeal' with a game_id, filed by the forfeiting club's Owner, GM or AGM
--    against an automatic over-limit forfeit, once per game. Only decide_forfeit_appeal closes it: Overturn records an
--    exception for each player named in the ruling (so a re-final never re-forfeits), clears the forfeit, keeps the
--    result as played and announces it; Deny closes it with the reason. Both are commissioner only, like every
--    forfeit reversal (v3.52).

-- 1. exemption --------------------------------------------------------------------------------------------------
alter table public.games add column if not exists limits_exempt boolean not null default false;
comment on column public.games.limits_exempt is
  'v3.93 (Rule 3.3): true when the league office rules that this game counts toward no week''s player game limits (Rule 5.2): its appearances count for no one and it cannot be forfeited for an over-limit player. Set only by ops_exempt_game_limits.';
grant select (limits_exempt) on public.games to anon, authenticated;

create or replace function public.ops_exempt_game_limits(p_game uuid, p_exempt boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.games; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not (public.is_commissioner() or public.has_department('operations')) then
    raise exception 'Only a commissioner or the operations department can exempt a game from the weekly game limits.';
  end if;
  select * into g from public.games where id = p_game;
  if g.id is null then raise exception 'Game not found.'; end if;
  if coalesce(g.stage, 'regular') <> 'regular' then
    raise exception 'Only a regular-season game falls under the weekly game limits; a playoff game counts toward its series.';
  end if;
  if g.status = 'final' then
    raise exception 'That game is already final. Re-open it before changing whether it counts toward the limits.';
  end if;
  if v_reason = '' then raise exception 'Give the reason for the ruling.'; end if;
  -- an exempt game counts toward no week, so a week ruling on it means nothing and is cleared with it
  update public.games set limits_exempt = coalesce(p_exempt, false),
         limit_week = case when coalesce(p_exempt, false) then null else limit_week end
   where id = p_game;
  insert into public.transactions (season_id, type, description)
    values (g.season_id, 'other', format(
      case when coalesce(p_exempt, false)
           then 'League office ruling: %s at %s counts toward no week''s player game limits (Rule 3.3).'
           else 'League office ruling: %s at %s counts toward players'' weekly game limits again (Rule 3.3).' end,
      (select name from public.teams where id = g.away_team_id),
      (select name from public.teams where id = g.home_team_id)));
  perform public.log_admin_action('game_limits_exempt', 'game', p_game::text,
    jsonb_build_object('exempt', coalesce(p_exempt, false), 'week', g.week, 'was_limit_week', g.limit_week, 'reason', left(v_reason, 1000)));
end $function$;
revoke execute on function public.ops_exempt_game_limits(uuid, boolean, text) from public, anon;
grant execute on function public.ops_exempt_game_limits(uuid, boolean, text) to authenticated;

-- a week ruling on an exempt game is refused: lift the exemption first
do $p$
declare v_def text := pg_get_functiondef('public.ops_set_limit_week(uuid,integer,text)'::regprocedure);
        v_old text := '  if v_reason = '''' then raise exception ''Give the reason for the ruling.''; end if;';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'v3.93 patch: ops_set_limit_week anchor not found exactly once';
  end if;
  execute replace(v_def, v_old, v_old || E'\n  if g.limits_exempt then\n    raise exception ''That game is exempt from the weekly game limits. Lift the exemption before ruling which week it counts toward.'';\n  end if;');
end $p$;

-- 2. the counter: games PLAYED -----------------------------------------------------------------------------------
create or replace function public.player_week_games(p_season uuid, p_stage text, p_week integer, p_profile uuid, p_exclude_game uuid default null::uuid)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  /* Rule 5.2. v3.93 (commissioner, 2026-10-12): "only count the games played from box scores and mid games forfeits
     ... Do not count future games they are scheduled in as games played until you receive results with them tied
     to it." A player's week is the FINAL games whose box score has a line for him. A game forfeited after
     disconnections keeps its box score (Rule 4.3) and counts; a forfeit nobody skated in has no lines and counts for
     no one; a voided game never counts; a game the league office exempted (games.limits_exempt) counts for no one;
     a game counts toward its limit week (coalesce(limit_week, week), Rule 3.3). A filed lineup is NOT a game played:
     a game still to come, or played and not yet imported, counts once its result arrives with him in it.
     (v2.55 to v3.92 also counted filed lineups for games still to come.) */
  select count(*)::int from public.games g
   where g.season_id = p_season and g.stage = p_stage and coalesce(g.limit_week, g.week) = p_week
     and g.status = 'final'
     and not coalesce(g.voided, false)
     and not coalesce(g.limits_exempt, false)
     and (p_exclude_game is null or g.id <> p_exclude_game)
     and exists (select 1 from public.game_stats gs where gs.game_id = g.id and gs.profile_id = p_profile)
$function$;

-- the lineup gate: an exempt game checks no weekly limit, and the refusal says "played"
do $p$
declare v_def text := pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure);
        a1 text := 'v_dressed := public.player_week_games(v_game.season_id, v_game.stage, coalesce(v_game.limit_week, v_game.week), v_p, p_game);';
        b1 text := 'v_dressed := case when coalesce(v_game.limits_exempt, false) and v_game.stage = ''regular'' then 0   -- v3.93: exempt from the limits (Rule 3.3)
                  else public.player_week_games(v_game.season_id, v_game.stage, coalesce(v_game.limit_week, v_game.week), v_p, p_game) end;';
        a2 text := 'raise exception ''% has already played or been dressed in % games this % — the limit is % (%). Rule 5.2.'',';
        b2 text := 'raise exception ''% has already played % games this %; the limit is % (%). Playing him again would forfeit the game (Rule 5.2).'',';
        a3 text := 'already counted against it: played games by the box score, games still to come by the filed
       lineup (player_week_games). A club that plays a man it never filed still uses up his week. */';
        b3 text := 'already counted against it: games he has PLAYED, by the box score (player_week_games, v3.93). A filed
       lineup for a game still to come does not count; playing him past his limit forfeits that game (Rule 5.2). */';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1
     or (length(v_def) - length(replace(v_def, a3, ''))) / length(a3) <> 1 then
    raise exception 'v3.93 patch: set_game_lineup anchors not found exactly once';
  end if;
  execute replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3);
end $p$;

-- the officiating review's wording follows the counter
do $p$
declare v_def text := pg_get_functiondef('public.review_game_records(uuid)'::regprocedure);
        a1 text := ') has now played or been dressed in ''';
        b1 text := ') has now played ''';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then
    raise exception 'v3.93 patch: review_game_records wording anchor not found exactly once';
  end if;
  execute replace(v_def, a1, b1);
end $p$;

-- 3. the automatic forfeit -------------------------------------------------------------------------------------
insert into public.app_config (key, value) values ('limit_forfeit_from', '2026-10-12T04:00:00Z')
  on conflict (key) do update set value = excluded.value;

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
     or coalesce(g.voided, false) or coalesce(g.limits_exempt, false) or g.forfeit_team_id is not null then
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
    -- his games of the week up to and including this one, in schedule order (Rule 5.2)
    select count(*) into v_n from public.games g2
     where g2.season_id = g.season_id and coalesce(g2.stage, 'regular') = 'regular'
       and coalesce(g2.limit_week, g2.week) = v_week and g2.status = 'final'
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
  insert into public.transactions (season_id, type, description)
    values (g.season_id, 'other', format('Automatic forfeit (Rule 5.2): %s forfeits %s. It played %s over the weekly game limit. The result as played stays on record.',
      v_tname, v_fix, v_list));
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

create or replace function public.trg_limit_forfeit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  begin
    perform public._limit_forfeit_check(new.id);
    -- a later game of the same limit week that is already final, and shares a player with this one, was counted
    -- without this game; count it again now (a held game merged late, an out-of-order import)
    for v_id in
      select g2.id from public.games g2
       where g2.season_id = new.season_id and coalesce(g2.stage, 'regular') = 'regular' and g2.status = 'final'
         and coalesce(g2.limit_week, g2.week) = coalesce(new.limit_week, new.week) and g2.id <> new.id
         and (g2.scheduled_at > new.scheduled_at or (g2.scheduled_at = new.scheduled_at and g2.id > new.id))
         and exists (select 1 from public.game_stats a join public.game_stats b on b.profile_id = a.profile_id
                      where a.game_id = new.id and b.game_id = g2.id and a.profile_id is not null)
       order by g2.scheduled_at, g2.id
    loop
      perform public._limit_forfeit_check(v_id);
    end loop;
  exception when others then
    raise warning 'trg_limit_forfeit failed for game %: %', new.id, sqlerrm;
    begin
      perform public.notify_commissioners(null, 'flag', 'The automatic over-limit forfeit check failed',
        'A game went final but its weekly game limit check (Rule 5.2) failed: ' || sqlerrm || '. Check the game by hand.', 'admin', null);
    exception when others then null;
    end;
  end;
  return null;
end $function$;
revoke execute on function public.trg_limit_forfeit() from public, anon, authenticated;

drop trigger if exists trg_a_limit_forfeit on public.games;
create trigger trg_a_limit_forfeit after update of status on public.games
  for each row when (new.status = 'final' and old.status is distinct from new.status and new.stage = 'regular')
  execute function public.trg_limit_forfeit();

-- 4. the appeal ------------------------------------------------------------------------------------------------
alter table public.action_requests add column if not exists game_id uuid references public.games(id) on delete set null;
comment on column public.action_requests.game_id is 'v3.93: the game a forfeit appeal is about (type forfeit_appeal).';
alter table public.action_requests drop constraint action_requests_type_check;
alter table public.action_requests add constraint action_requests_type_check
  check (type = any (array['complaint','appeal','trade_request','position_change','stats_correction','abandonment','forfeit_appeal']));

create or replace function public.ar_label(t text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case t when 'complaint' then 'complaint' when 'appeal' then 'suspension/ban appeal'
    when 'trade_request' then 'trade request' when 'position_change' then 'position-change request'
    when 'stats_correction' then 'statistics correction' when 'abandonment' then 'abandonment review'
    when 'forfeit_appeal' then 'forfeit appeal' else 'request' end;
$function$;

create or replace function public.guard_forfeit_appeal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.games;
begin
  if tg_op = 'UPDATE' then
    -- only decide_forfeit_appeal closes one, so a "resolved" appeal always means the forfeit was overturned
    if new.type = 'forfeit_appeal' and new.status is distinct from old.status and new.status in ('resolved','denied')
       and coalesce(current_setting('app.forfeit_appeal_decide', true), '') <> 'on' then
      raise exception 'A forfeit appeal is decided with Overturn or Deny on the case, by a commissioner.';
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
  if not exists (select 1 from public.admin_audit a where a.action = 'limit_forfeit' and a.target_id = g.id::text) then
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
drop trigger if exists guard_forfeit_appeal_trg on public.action_requests;
create trigger guard_forfeit_appeal_trg before insert or update on public.action_requests
  for each row execute function public.guard_forfeit_appeal();

create or replace function public.decide_forfeit_appeal(p_request uuid, p_overturn boolean, p_response text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a public.action_requests; g public.games; v_resp text := btrim(coalesce(p_response, '')); v_me uuid := auth.uid();
        v_detail jsonb; v_fix text; x jsonb;
begin
  if not public.is_commissioner() then
    raise exception 'Only a commissioner decides a forfeit appeal.' using errcode = '42501';
  end if;
  select * into a from public.action_requests where id = p_request;
  if a.id is null or a.type <> 'forfeit_appeal' then raise exception 'That is not a forfeit appeal.'; end if;
  if a.status in ('resolved','denied') then raise exception 'This appeal has already been decided.'; end if;
  if v_resp = '' then raise exception 'Give the reason for the decision; the club sees it.'; end if;
  select * into g from public.games where id = a.game_id;
  if g.id is null then raise exception 'The game in this appeal no longer exists.'; end if;
  v_fix := (select name from public.teams where id = g.away_team_id) || ' at ' || (select name from public.teams where id = g.home_team_id)
           || ', ' || to_char(g.scheduled_at at time zone 'America/New_York', 'FMMon FMDD');

  perform set_config('app.forfeit_appeal_decide', 'on', true);
  if coalesce(p_overturn, false) then
    if g.forfeit_team_id is distinct from a.team_id then
      raise exception 'That game is no longer a forfeit against the appealing club.';
    end if;
    select a2.detail into v_detail from public.admin_audit a2
     where a2.action = 'limit_forfeit' and a2.target_id = g.id::text order by a2.created_at desc limit 1;
    -- the appearance is excepted, so a re-final of this game never rules it again (Rule 5.2)
    for x in select * from jsonb_array_elements(coalesce(v_detail->'players', '[]'::jsonb)) loop
      if (x->>'team_id')::uuid = a.team_id then
        insert into public.weekly_cap_exceptions (season_id, game_id, profile_id, team_id, reason, granted_by)
          values (g.season_id, g.id, (x->>'profile_id')::uuid, a.team_id, 'Forfeit appeal upheld: ' || left(v_resp, 500), v_me)
          on conflict (game_id, profile_id) do nothing;
      end if;
    end loop;
    update public.games set forfeit_team_id = null where id = g.id;   -- final as played
    perform public.log_admin_action('limit_forfeit_overturned', 'game', g.id::text,
      jsonb_build_object('request', a.id, 'reason', left(v_resp, 1000)));
    insert into public.transactions (season_id, type, description)
      values (g.season_id, 'other', format('Forfeit overturned on appeal: %s stands as played (Rule 5.2).', v_fix));
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

-- 5. the made-up game: exempt, by the office's own door, as the commissioner ------------------------------------
do $rule$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'fa5f47dc-5380-4965-9258-82ed954b6fa7', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.ops_exempt_game_limits('d6359d09-9414-4bea-9f67-9a153b01ee49', true,
    'Islanders at Stars, postponed from Fri Oct 9 and made up Wed Oct 14 at 8:25 PM ET: commissioner ruling of Oct 12 that it counts toward no week''s player game limits. Supersedes the same day''s Week 3 ruling.');
  perform set_config('role', 'postgres', true);
end $rule$;

do $chk$
declare v_bad text;
begin
  if not exists (select 1 from public.games where id = 'd6359d09-9414-4bea-9f67-9a153b01ee49' and limits_exempt and limit_week is null) then
    raise exception 'v3.93: the made-up game is not exempt';
  end if;
  if position('g.status = ''final''' in pg_get_functiondef('public.player_week_games(uuid,text,integer,uuid,uuid)'::regprocedure)) = 0
     or position('game_lineups' in pg_get_functiondef('public.player_week_games(uuid,text,integer,uuid,uuid)'::regprocedure)) > 0 then
    raise exception 'v3.93: player_week_games still counts filed lineups';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_a_limit_forfeit' and tgrelid = 'public.games'::regclass) then
    raise exception 'v3.93: the over-limit forfeit trigger is missing';
  end if;
end $chk$;
