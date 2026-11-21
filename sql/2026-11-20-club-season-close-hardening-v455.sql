-- v4.55 (2026-11-20): the v4.53 club closing, hardened after an adversarial review (70 agents, two skeptics per finding).
-- None of these could bite yet (Season 1 is closed and Season 2 has not started); each would have from Season 2's playoffs.
--
-- The ruling it serves (commissioner, 2026-11-20): "As soon as that specific team's season is over i.e. missed playoffs
-- after the regular season ends, or loses their series in the playoffs, that management and roster should have their team
-- roles removed since they no longer play any games. Give it 24 hours to remove the roles for the future though."
-- Chosen the same morning: the closing is quiet ("End quietly").
--
-- 1. QUIET, all of it. A club closed while its season is still being played (eliminated in round 1) has managers with a
--    roster spot in the season in play, and _set_team_seat's "Off the front office" club_notify posted into the club's
--    Discord room for each. Skipped under app.mgmt_quiet, like the other three posts v4.53 silenced.
-- 2. ONLY THE SEATS OF THE SEASON THAT ENDED. club_season_ends keeps who held each seat when the club's season ended
--    (owner_id, gm_id, agm_id); the closing 24 hours later ends a seat only if the same person still holds it, so a seat
--    filled in between (an Owner naming next season's management, Rule 2.6) is not ended with the old one.
-- 3. A CORRECTED RESULT MOVES THE CLOCK. A ruling that reverses a series: the club now advancing loses its unclosed
--    "eliminated" row and the club now out is recorded. A ruling that leaves a concluded series with no winner: both
--    clubs' unclosed rows go. Clearing a playoff round (Control Center): its clubs' unclosed "eliminated" rows go, and for
--    round 1 the unclosed "missed_playoffs" rows with the seeds. A club already closed is reopened by
--    public.reopen_club_season (internal: the league office asks; its seats are reseated under Teams).
-- 4. A CLOSED CLUB'S PLAYERS ARE NOT FREE AGENTS. discord_links.season_over: the member's roster spot in a season still in
--    play is on a closed club. shared/roles.mjs gives no Free Agent or Restricted Free Agent role then (they are under
--    contract for that season); the club role stays off. jobs/discord-sync.js and bot/role-sync.mjs read the column.

-- 1. quiet: no club-room post for a seat that ends with its club's season --------------------------------------------
do $mig$ declare d0 text; d text; a text; n int;
begin
  d0 := pg_get_functiondef('public._set_team_seat(uuid,text,uuid,text)'::regprocedure);
  a := $a$      perform public.club_notify(p_team, 'roster', 'Off the front office: '||v_who,
        v_who||' is no longer the '||v_seat||'. They keep their roster spot and their position; their cap hit is now $'||
        to_char(v_sal/1000000.0,'FM999990.00')||'M (Rule 2.6).', null, null, null, null);$a$;
  n := (length(d0) - length(replace(d0, a, ''))) / length(a);
  if n <> 1 then raise exception '_set_team_seat club_notify anchor matched % times', n; end if;
  d := replace(d0, a, $b$      /* v4.55: a seat that ends with its club's season (app.mgmt_quiet, _close_club_season) posts nothing */
      if coalesce(current_setting('app.mgmt_quiet', true), '') <> 'on' then
      perform public.club_notify(p_team, 'roster', 'Off the front office: '||v_who,
        v_who||' is no longer the '||v_seat||'. They keep their roster spot and their position; their cap hit is now $'||
        to_char(v_sal/1000000.0,'FM999990.00')||'M (Rule 2.6).', null, null, null, null);
      end if;$b$);
  execute d;
end $mig$;

-- 2. who held each seat when the club's season ended ----------------------------------------------------------------
alter table public.club_season_ends add column if not exists owner_id uuid, add column if not exists gm_id uuid, add column if not exists agm_id uuid;
comment on column public.club_season_ends.owner_id is 'v4.55: the Owner when the club''s season ended; the closing ends the seat only if they still hold it';

create or replace function public._club_season_over(p_season uuid, p_team uuid, p_reason text)
 returns void language plpgsql security definer set search_path to '' as $fn$
begin
  if p_season is null or p_team is null then raise exception '_club_season_over: a season and a club are required'; end if;
  /* v4.55: with who held each seat at this moment, so the closing ends those seats and no seat filled since */
  insert into public.club_season_ends (season_id, team_id, reason, owner_id, gm_id, agm_id)
    select p_season, p_team, p_reason, t.owner_profile_id, t.gm_profile_id, t.agm_profile_id from public.teams t where t.id = p_team
    on conflict (season_id, team_id) do nothing;   -- the first moment stands: a reseed or a re-run never moves the clock
end $fn$;
revoke all on function public._club_season_over(uuid, uuid, text) from public, anon, authenticated;

do $mig$ declare d0 text; d text; a text; n int;
begin
  d0 := pg_get_functiondef('public._close_club_season(uuid,uuid)'::regprocedure);
  d := d0;
  foreach a in array array[
    $a$  if t.agm_profile_id   is not null then perform public._set_team_seat(p_team, 'agm',   null, 'season'); v_n := v_n + 1; end if;$a$,
    $a$  if t.gm_profile_id    is not null then perform public._set_team_seat(p_team, 'gm',    null, 'season'); v_n := v_n + 1; end if;$a$,
    $a$  if t.owner_profile_id is not null then perform public._set_team_seat(p_team, 'owner', null, 'season'); v_n := v_n + 1; end if;$a$]
  loop
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    if n <> 1 then raise exception '_close_club_season seat anchor matched % times: %', n, left(a, 60); end if;
  end loop;
  d := replace(d, $a$  if t.agm_profile_id   is not null then perform public._set_team_seat(p_team, 'agm',   null, 'season'); v_n := v_n + 1; end if;$a$,
    $b$  /* v4.55: only a seat its holder held when the club's season ended (every row from before v4.55 is a Season 1 row, closed) */
  if t.agm_profile_id   is not null and e.agm_id is not distinct from t.agm_profile_id
    then perform public._set_team_seat(p_team, 'agm',   null, 'season'); v_n := v_n + 1; end if;$b$);
  d := replace(d, $a$  if t.gm_profile_id    is not null then perform public._set_team_seat(p_team, 'gm',    null, 'season'); v_n := v_n + 1; end if;$a$,
    $b$  if t.gm_profile_id    is not null and e.gm_id is not distinct from t.gm_profile_id
    then perform public._set_team_seat(p_team, 'gm',    null, 'season'); v_n := v_n + 1; end if;$b$);
  d := replace(d, $a$  if t.owner_profile_id is not null then perform public._set_team_seat(p_team, 'owner', null, 'season'); v_n := v_n + 1; end if;$a$,
    $b$  if t.owner_profile_id is not null and e.owner_id is not distinct from t.owner_profile_id
    then perform public._set_team_seat(p_team, 'owner', null, 'season'); v_n := v_n + 1; end if;$b$);
  execute d;
end $mig$;

-- 3. a corrected series result, or a cleared round, moves the clock; a closed club can be reopened --------------------
do $mig$ declare d0 text; d text; a text; n int;
begin
  d0 := pg_get_functiondef('public.trg_conclude_series()'::regprocedure);
  d := d0;
  a := $a$        jsonb_build_object('series', v_key, 'was', v_prev, 'now', null));$a$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'trg_conclude_series no-winner anchor matched % times', n; end if;
  d := replace(d, a, a || $b$
      /* v4.55: neither club is out now, so neither club's season-end clock runs (a club already closed is reopened by the
         league office, public.reopen_club_season) */
      delete from public.club_season_ends e where e.season_id = new.season_id and e.closed_at is null and e.reason = 'eliminated'
        and e.team_id in (new.home_team_id, new.away_team_id);$b$);
  a := $a$        jsonb_build_object('series', v_key, 'was', v_prev, 'now', v_winner));$a$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'trg_conclude_series reversal anchor matched % times', n; end if;
  d := replace(d, a, a || $b$
      /* v4.55: the club now advancing is back in play; the club now out is recorded at this moment (Rule 2.6) */
      delete from public.club_season_ends e where e.season_id = new.season_id and e.closed_at is null and e.reason = 'eliminated'
        and e.team_id = v_winner;
      perform public._club_season_over(new.season_id, v_loser, 'eliminated');$b$);
  execute d;

  d0 := pg_get_functiondef('public.clear_playoff_round(uuid,integer)'::regprocedure);
  a := $a$  delete from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round;$a$;
  n := (length(d0) - length(replace(d0, a, ''))) / length(a);
  if n <> 1 then raise exception 'clear_playoff_round anchor matched % times', n; end if;
  d := replace(d0, a, $b$  /* v4.55: the round's clubs are back in play, so their season-end clocks stop (round 1: the seeds go too) */
  delete from public.club_season_ends e where e.season_id = p_season and e.closed_at is null
    and (e.reason = 'eliminated' and e.team_id in (select x from public.games g, unnest(array[g.home_team_id, g.away_team_id]) x
                                                   where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round)
         or (p_round = 1 and e.reason = 'missed_playoffs'));
$b$ || a);
  execute d;
end $mig$;

create or replace function public.reopen_club_season(p_season uuid, p_team uuid, p_why text)
 returns void language plpgsql security definer set search_path to '' as $fn$
declare e record;
begin
  if coalesce(trim(p_why), '') = '' then raise exception 'reopen_club_season: say why (it goes in the audit)'; end if;
  delete from public.club_season_ends where season_id = p_season and team_id = p_team returning * into e;
  if e.team_id is null then raise exception 'reopen_club_season: that club''s season is not recorded as over'; end if;
  /* the club role comes back with discord_links; the seats ended at the closing are reseated by the office under Teams */
  perform public._rsq(rs.profile_id, 'club_reopened') from public.roster_spots rs where rs.season_id = p_season and rs.team_id = p_team;
  perform public.log_admin_action('club_season_reopened', 'team', p_team::text,
    jsonb_build_object('season', p_season, 'reason', e.reason, 'ended_at', e.ended_at, 'closed_at', e.closed_at, 'why', p_why));
end $fn$;
revoke all on function public.reopen_club_season(uuid, uuid, text) from public, anon, authenticated;

-- the seeds notice names the door
do $mig$ declare d0 text; a text; n int;
begin
  d0 := pg_get_functiondef('public.trg_seeds_end_seats()'::regprocedure);
  a := $a$Reseat its management under Teams, and have its closing undone so its roster wears the club role again.$a$;
  n := (length(d0) - length(replace(d0, a, ''))) / length(a);
  if n <> 1 then raise exception 'trg_seeds_end_seats notice anchor matched % times', n; end if;
  execute replace(d0, a, $b$Ask for its closing to be undone (reopen_club_season), so its roster wears the club role again, and reseat its management under Teams.$b$);
end $mig$;

-- 4. a closed club's players, while their season is still played, are under contract: no Free Agent role -------------
create or replace view public.discord_links as
 select p.id as profile_id,
    p.gamertag,
    p.role,
    coalesce(nullif(p.discord_id, ''::text), u.raw_user_meta_data ->> 'provider_id'::text) as discord_id,
    (select rs.team_id
       from public.roster_spots rs
       join public.seasons s on s.id = rs.season_id
      where rs.profile_id = p.id
        and not exists (select 1 from public.club_season_ends e
                         where e.season_id = rs.season_id and e.team_id = rs.team_id and e.closed_at is not null)
      order by (s.status = 'active'::public.season_status) desc, s.number desc
      limit 1) as team_id,
    p.discord_username,
    /* v4.55: the member's roster spot in a season still being played is on a closed club (shared/roles.mjs) */
    exists (select 1 from public.roster_spots rs
              join public.seasons s on s.id = rs.season_id and s.status <> 'complete'::public.season_status
              join public.club_season_ends e on e.season_id = rs.season_id and e.team_id = rs.team_id and e.closed_at is not null
             where rs.profile_id = p.id) as season_over
   from public.profiles p
   join auth.users u on u.id = p.id;

-- 5. self-checks ----------------------------------------------------------------------------------------------------
do $chk$
begin
  if position('if coalesce(current_setting(''app.mgmt_quiet'', true), '''') <> ''on'' then' in pg_get_functiondef('public._set_team_seat(uuid,text,uuid,text)'::regprocedure)) = 0 then
    raise exception 'the club-room notice is not quiet';
  end if;
  if position('e.owner_id is not distinct from t.owner_profile_id' in pg_get_functiondef('public._close_club_season(uuid,uuid)'::regprocedure)) = 0
     or position('t.owner_profile_id, t.gm_profile_id, t.agm_profile_id' in pg_get_functiondef('public._club_season_over(uuid,uuid,text)'::regprocedure)) = 0 then
    raise exception 'the seat snapshot is not in place';
  end if;
  if position('_club_season_over(new.season_id, v_loser, ''eliminated'')' in pg_get_functiondef('public.trg_conclude_series()'::regprocedure)) = 0
     or position('club_season_ends' in pg_get_functiondef('public.clear_playoff_round(uuid,integer)'::regprocedure)) = 0 then
    raise exception 'a corrected result does not move the clock';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'discord_links' and column_name = 'season_over') <> 1 then
    raise exception 'discord_links has no season_over';
  end if;
  if has_function_privilege('authenticated', 'public.reopen_club_season(uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.reopen_club_season(uuid,uuid,text)', 'execute') then
    raise exception 'reopen_club_season is reachable by an API role';
  end if;
  if exists (select 1 from public.club_season_ends where closed_at is null and ended_at < now() - interval '1 day') then
    raise exception 'an unclosed row is older than its 24 hours';
  end if;
  if exists (select 1 from public.discord_links where season_over) then
    raise exception 'season_over is true for someone, but no club is closed in a season still being played';
  end if;
end $chk$;

/* REHEARSAL (2026-11-20, one transaction on the live database, rolled back by a closing raise; three Season 2 sign-ups with
   no active contract stood in as managers, because a Season 1 player's deal stays active until the rollover and seating one
   for Season 2 trips contracts_one_active, a known trap that is not this change's):
   T1  quiet: a club closed while its GM holds a roster spot in the season in play: the GM's seat ended, 0 club_notices rows,
       0 requests queued for Discord; discord_links.season_over true and team_id null for that GM; reopen_club_season put
       the club role back and season_over false.
   T2  an Owner seated after the club's season ended (the seat holder recorded at the end was another member) kept the seat
       when the club closed 24 hours later; the club still closed.
   T3  a best-of-seven played through trg_conclude_series: Detroit four wins, so Pittsburgh recorded; a ruling flipping one
       game left no winner, so neither club's clock ran; three more rulings gave Pittsburgh four wins, so Detroit recorded
       and Pittsburgh not.
   T4  clear_playoff_round(Season 2, 1) as a commissioner removed every running clock, the round's and the missed-playoffs one.
   Result: REHEARSAL OK. */
-- Applied as migration v455_club_season_close_hardening; tools/sql/grant-audit.sql returned zero rows. The jobs/ and bot/
-- readers of discord_links.season_over ship in the same version (the column existed first, so the deployed code was never
-- asked for a column it did not have).
