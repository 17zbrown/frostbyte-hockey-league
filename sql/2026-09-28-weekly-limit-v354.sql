-- v3.54: the weekly limit is hard, with a rare, recorded exception; the line builder warns instead of refusing.
--
-- Commissioner, 2026-09-28: "there is a hard limit of 6 games per week for roster players and 3 for
-- training camp players. This limit can be overruled by staff or the commissioners, but very rarely."
-- And: "Instead of not allowing a player to be scheduled in the lineup builder on more than 2 lines,
-- give the submitter a warning that they may be over their game limit and make the player's box outline
-- yellow. If they are already over their limit based on their games played for the week, outline their
-- box red."
-- The limit itself (weekly_cap: 6 active, 3 camp in Season 1) is unchanged and is still enforced where a
-- lineup is filed (set_game_lineup). What is new: an exception for ONE player in ONE game, granted by an
-- officiating official or a commissioner with a reason, and told to every commissioner; and the line
-- saver no longer refuses a goaltender on a third line (the builder outlines him instead).

create table if not exists public.weekly_cap_exceptions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  reason text not null,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (game_id, profile_id)
);
alter table public.weekly_cap_exceptions enable row level security;
drop policy if exists "cap exceptions are read by members" on public.weekly_cap_exceptions;
create policy "cap exceptions are read by members" on public.weekly_cap_exceptions for select to authenticated using (true);
revoke all on public.weekly_cap_exceptions from public, anon;
grant select on public.weekly_cap_exceptions to authenticated;
grant all on public.weekly_cap_exceptions to service_role;

create or replace function public.has_cap_exception(p_game uuid, p_profile uuid)
 returns boolean language sql stable set search_path to 'public' as $fn$
  select exists (select 1 from public.weekly_cap_exceptions e where e.game_id = p_game and e.profile_id = p_profile)
$fn$;
grant execute on function public.has_cap_exception(uuid, uuid) to authenticated, service_role;

create or replace function public.grant_cap_exception(p_game uuid, p_profile uuid, p_reason text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare g public.games; v_me uuid := auth.uid(); v_team uuid; v_squad text; v_pos text; v_cap int; v_n int;
        v_name text; v_code text; v_fx text; v_id uuid; v_reason text := btrim(coalesce(p_reason, '')); v_who text; m uuid;
begin
  if v_me is null or not (public.is_commissioner() or public.has_department('officiating')) then
    raise exception 'Only an officiating official or a commissioner can grant an exception to the weekly limit.' using errcode = '42501';
  end if;
  if length(v_reason) < 10 then
    raise exception 'Say why this player must play past his limit. Exceptions are rare, and the commissioners read every one.' using errcode = '22023';
  end if;
  select * into g from public.games where id = p_game;
  if g.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if g.status <> 'scheduled' or coalesce(g.voided, false) then
    raise exception 'An exception is granted before a game is played, not after.' using errcode = '22023';
  end if;
  select rs.team_id, rs.squad, rs.position::text into v_team, v_squad, v_pos
    from public.roster_spots rs
   where rs.season_id = g.season_id and rs.profile_id = p_profile and rs.status = 'active'
     and rs.team_id in (g.home_team_id, g.away_team_id)
   limit 1;
  if v_team is null then raise exception 'That player is not on either club in this game.' using errcode = '22023'; end if;
  select coalesce(nullif(gamertag, ''), 'That player') into v_name from public.profiles where id = p_profile;
  v_cap := case when g.stage = 'playoff' then public.series_cap(g.season_id, v_squad, v_pos)
                else public.weekly_cap(g.season_id, v_squad, v_pos, g.stage) end;
  v_n := public.player_week_games(g.season_id, g.stage, g.week, p_profile, p_game);
  if v_n < v_cap then
    raise exception '% still has room: % of % games used, so no exception is needed.', v_name, v_n, v_cap using errcode = '22023';
  end if;
  insert into public.weekly_cap_exceptions (season_id, game_id, profile_id, team_id, reason, granted_by)
    values (g.season_id, p_game, p_profile, v_team, v_reason, v_me)
    on conflict (game_id, profile_id) do nothing
    returning id into v_id;
  if v_id is null then raise exception '% already has an exception for this game.', v_name using errcode = '22023'; end if;
  select code into v_code from public.teams where id = v_team;
  v_fx := (select code from public.teams where id = g.away_team_id)||' @ '||(select code from public.teams where id = g.home_team_id)||', '||
          to_char(g.scheduled_at at time zone 'America/New_York', 'FMDay Mon DD, FMHH12:MI AM')||' ET';
  select coalesce(gamertag, display_name, 'A staffer') into v_who from public.profiles where id = v_me;
  perform public.notify_commissioners(array[v_me], 'flag', 'A weekly limit exception was granted',
    v_who||' allowed '||v_name||' ('||coalesce(v_code,'?')||') to be dressed in '||v_fx||' past his limit: '||v_n||' of '||v_cap||' games already used. Reason: "'||left(v_reason, 400)||'" (Rule 5.2)',
    'game', p_game::text);
  for m in select distinct x from (select unnest(array[t.owner_profile_id, t.gm_profile_id, t.agm_profile_id]) x from public.teams t where t.id = v_team) s where x is not null loop
    perform public.create_notification(m, 'lineups', 'Weekly limit exception granted',
      'The league office has allowed '||v_name||' to be dressed in '||v_fx||' although he has used '||v_n||' of his '||v_cap||' games. It applies to that game only (Rule 5.2).',
      'game', p_game::text);
  end loop;
  perform public.log_admin_action('cap_exception_granted', 'game', p_game::text,
    jsonb_build_object('player', v_name, 'club', v_code, 'week', g.week, 'used', v_n, 'cap', v_cap, 'reason', left(v_reason, 1000)));
  perform public.notify_staff_ch('casework', '**Weekly limit exception**: '||v_who||' allowed '||v_name||' ('||coalesce(v_code,'?')||') to be dressed in '||v_fx||
    ' past his limit ('||v_n||' of '||v_cap||' used). Reason: "'||left(v_reason, 300)||'"', false);
  return jsonb_build_object('ok', true, 'player', v_name, 'used', v_n, 'cap', v_cap, 'fixture', v_fx);
end $fn$;
revoke all on function public.grant_cap_exception(uuid, uuid, text) from public, anon;
grant execute on function public.grant_cap_exception(uuid, uuid, text) to authenticated, service_role;

create or replace function public.revoke_cap_exception(p_game uuid, p_profile uuid)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare g public.games; v_n int; v_name text;
begin
  if auth.uid() is null or not (public.is_commissioner() or public.has_department('officiating')) then
    raise exception 'Only an officiating official or a commissioner can withdraw an exception to the weekly limit.' using errcode = '42501';
  end if;
  select * into g from public.games where id = p_game;
  if g.id is null then raise exception 'Game not found.' using errcode = 'P0002'; end if;
  if g.status <> 'scheduled' then raise exception 'That game has been played; its exception is part of the record.' using errcode = '22023'; end if;
  delete from public.weekly_cap_exceptions where game_id = p_game and profile_id = p_profile;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'There is no exception for that player in that game.' using errcode = 'P0002'; end if;
  select coalesce(nullif(gamertag,''),'a player') into v_name from public.profiles where id = p_profile;
  perform public.log_admin_action('cap_exception_withdrawn', 'game', p_game::text, jsonb_build_object('player', v_name, 'week', g.week));
  return jsonb_build_object('ok', true, 'player', v_name,
    'still_dressed', exists (select 1 from public.game_lineups gl where gl.game_id = p_game
                             and p_profile in (gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie)));
end $fn$;
revoke all on function public.revoke_cap_exception(uuid, uuid) from public, anon;
grant execute on function public.revoke_cap_exception(uuid, uuid) to authenticated, service_role;

/* The filer honors an exception: both limit checks (the week or series count, and the playoff series
   count by filed sheets) pass a player excepted for THIS game. Nothing else about the gate changes. */
do $mig$ declare d text; d0 text; n int; begin
  d0 := pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure);
  /* the six-space series check contains the four-space week check as a substring: patch the longer
     one first, then exactly one four-space check must remain */
  n := (length(d0) - length(replace(d0, '      if v_dressed >= v_cap then', ''))) / length('      if v_dressed >= v_cap then');
  if n <> 1 then raise exception 'set_game_lineup: expected one series check, found %', n; end if;
  d := replace(d0, '      if v_dressed >= v_cap then',
    '      if v_dressed >= v_cap and not public.has_cap_exception(p_game, v_p) then');
  n := (length(d) - length(replace(d, '    if v_dressed >= v_cap then', ''))) / length('    if v_dressed >= v_cap then');
  if n <> 1 then raise exception 'set_game_lineup: expected one week check, found %', n; end if;
  d := replace(d, '    if v_dressed >= v_cap then',
    '    /* v3.54: a recorded exception for this player in this game (grant_cap_exception) lets him past the limit */
    if v_dressed >= v_cap and not public.has_cap_exception(p_game, v_p) then');
  if d = d0 then raise exception 'set_game_lineup patch matched nothing'; end if;
  execute d;
end $mig$;

/* The post-game review does not report a limit the league office itself lifted for that game. */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.review_game_records(uuid)'::regprocedure);
  d := replace(d0,
    '    if v_n > v_cap and not exists (select 1 from public.admin_audit a where a.action=''weekly_cap_violation''',
    '    if v_n > v_cap and not public.has_cap_exception(p_game, r.profile_id)
       and not exists (select 1 from public.admin_audit a where a.action=''weekly_cap_violation''');
  if d = d0 then raise exception 'review_game_records patch matched nothing'; end if;
  execute d;
end $mig$;

/* The line saver stops refusing a goaltender on more lines than his week allows. A line is a plan,
   not a dressing: the builder outlines him (yellow, red) and the limit is enforced when a lineup is
   actually filed. Every other check in set_team_line is unchanged. */
do $mig$ declare d text; d0 text; i int; j int; begin
  d0 := pg_get_functiondef('public.set_team_line(uuid,uuid,integer,text,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  i := position('  if p_goalie is not null then' in d0);
  j := position('  insert into public.team_lines as tl' in d0);
  if i = 0 or j = 0 or j < i then raise exception 'set_team_line: goalie block not found'; end if;
  if position('already backstops' in substr(d0, i, j - i)) = 0 then raise exception 'set_team_line: that block is not the goalie refusal'; end if;
  d := substr(d0, 1, i - 1) ||
'  /* v3.54 (commissioner, 2026-09-28): no refusal for a goaltender on more lines than his week allows.
     The lineup builder outlines him in yellow or red, and set_game_lineup enforces the limit when a
     lineup is filed. */

' || substr(d0, j);
  execute d;
end $mig$;

/* REHEARSAL (2026-09-28, one transaction, rolled back): every check passed.
   T1  set_team_line saves the same goaltender on all three of a club's lines (no refusal).
   T2  set_game_lineup still refuses a training-camp player at his fourth game of the week ("limit is 3"),
       after three filings, with player_week_games reading 3.
   T3  grant_cap_exception: a statistics-only staffer is refused; a short reason is refused; a player
       with room left is refused ("still has room"); an officiating official's grant rings all three
       commissioners and tells the club's front office; a second grant for the same game is refused.
   T4  the excepted game files; the NEXT game is still refused (the exception is for one game).
   T5  revoke_cap_exception withdraws it and reports that the filed sheet still carries the player.
   Found by the patch guard, not the battery: the four-space week check is a substring of the six-space
   series check, so the longer one is patched first and each is then counted exactly once. */
