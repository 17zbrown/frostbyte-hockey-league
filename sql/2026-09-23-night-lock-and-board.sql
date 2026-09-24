-- v2.97 (2026-09-23) — one definition of when a game night locks, and the board the office posts from.
-- Applied live through the MCP in gated transactions; this file is the record.
--
-- Commissioner's complaint: "you sent out the games and codes to the teams a little early. Make
-- sure you wait to send it out till the vetos are finalized so everything can be in 1 message."
--
-- What was actually wrong. Rule 4.2 says a night's codes release together, and its server picks
-- freeze, thirty minutes before THE NIGHT'S first scheduled puck drop. That moment was written out
-- three different ways and two of them were wrong:
--
--   can_see_match ........ the NIGHT's first puck drop  (right: this is what masks codes from clients)
--   resolve_game_server .. each GAME's own puck drop    (wrong: the 9:35 and 10:10 games of a night
--                                                        stayed unsettled for an hour after the
--                                                        schedule desk had told both clubs the
--                                                        night's picks were frozen)
--   guard_veto_deadline .. each GAME's own puck drop    (wrong: the database would still accept a
--                                                        change to a late game's pick an hour after
--                                                        the desk stopped offering it)
--
-- And the Discord scheduler had a fourth idea entirely: it posted each club at T-75 from that
-- club's own first game, with the private lobby codes already in it — 45 minutes before Rule 4.2
-- releases them, and while the picks were still open, so it could not name a server at all.

begin;

-- ONE definition. Everything else reads it.
create or replace function public.night_lock_at(p_season uuid, p_day date) returns timestamptz
language sql stable security definer set search_path = public as $fn$
  select min(scheduled_at) - interval '30 minutes'
    from public.games
   where season_id = p_season and not coalesce(voided, false)
     and (scheduled_at at time zone 'America/New_York')::date = p_day
$fn$;

create or replace function public.night_lock_at(p_game uuid) returns timestamptz
language sql stable security definer set search_path = public as $fn$
  select public.night_lock_at(g.season_id, (g.scheduled_at at time zone 'America/New_York')::date)
    from public.games g where g.id = p_game
$fn$;
grant execute on function public.night_lock_at(uuid, date) to authenticated, anon, service_role;
grant execute on function public.night_lock_at(uuid) to authenticated, anon, service_role;

-- can_see_match keeps the same behavior, but stops carrying its own copy of the rule.
create or replace function public.can_see_match(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  with g as (select * from public.games where id = p_game)
  select exists (select 1 from g) and (
    public.is_commissioner() or public.is_staff()
    or ( now() >= (select public.night_lock_at(g.season_id, (g.scheduled_at at time zone 'America/New_York')::date) from g)
         and ( exists (select 1 from g join public.teams t on t.id in (g.home_team_id, g.away_team_id)
                        where auth.uid() in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id))
            or exists (select 1 from g join public.roster_spots rs on rs.season_id = g.season_id and rs.team_id in (g.home_team_id, g.away_team_id)
                        where rs.profile_id = auth.uid()) ) ) )
$fn$;

commit;

begin;

-- resolve_game_server, two splices:
--
--   permission  BEFORE  ... and not (public.is_commissioner() or public.is_staff() or public.can_see_match(p_game))
--               AFTER   ... and not (public.trusted_writer() or public.is_commissioner() or ...)
--   Without trusted_writer the scheduler is refused: it calls with the service key, so
--   request.jwt.claims is non-empty (role service_role) while auth.uid() is null, which means
--   is_commissioner(), is_staff() and can_see_match() are all false.
--
--   timing      BEFORE  if v_at is null or now() < v_at - interval '30 minutes' then return null; end if;
--               AFTER   if v_at is null or now() < public.night_lock_at(p_game) then return null; end if;

-- guard_veto_deadline: the whole night freezes together, which is what the schedule desk and
-- Rule 4.2 have always said.
create or replace function public.guard_veto_deadline() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_lock timestamptz;
begin
  v_lock := public.night_lock_at(new.game_id);
  if v_lock is not null and now() > v_lock and not public.is_commissioner() then
    raise exception 'Server picks lock 30 minutes before the night''s first puck drop.';
  end if;
  return new;
end;$fn$;

commit;

begin;

-- The board the game-night post is built from. It is the GATE as well as the data: no rows until
-- the night has locked, so the post cannot go out early even if the scheduler's own clock were
-- wrong. It also settles each game's server on the way through, so a game no longer waits for a
-- manager to open the site before it has one.
create or replace function public.night_board(p_day date)
returns table(game_id uuid, scheduled_at timestamptz, home_team_id uuid, away_team_id uuid,
              game_code text, server text, lineup_lock_at timestamptz)
language plpgsql security definer set search_path = public as $fn$
declare v_season uuid; v_lock timestamptz; r record;
begin
  if not (public.trusted_writer() or public.is_commissioner() or public.is_staff()) then
    raise exception 'The night board belongs to the league office.' using errcode = '42501';
  end if;
  v_season := public.current_season_id();
  v_lock := public.night_lock_at(v_season, p_day);
  if v_lock is null or now() < v_lock then return; end if;

  for r in select g.id from public.games g
            where g.season_id = v_season and not coalesce(g.voided, false)
              and (g.scheduled_at at time zone 'America/New_York')::date = p_day
            order by g.scheduled_at
  loop
    perform public.resolve_game_server(r.id);
  end loop;

  return query
    select g.id, g.scheduled_at, g.home_team_id, g.away_team_id, g.game_code, g.server,
           -- Rule 5.3: a LINEUP locks 30 minutes before its OWN puck drop, which is not the night's
           -- lock for anything but the first game.
           g.scheduled_at - interval '30 minutes'
      from public.games g
     where g.season_id = v_season and not coalesce(g.voided, false)
       and (g.scheduled_at at time zone 'America/New_York')::date = p_day
     order by g.scheduled_at;
end $fn$;
revoke execute on function public.night_board(date) from public, anon;
grant execute on function public.night_board(date) to authenticated, service_role;

commit;

-- Rehearsed with rollback against tonight's real fixture:
--   before the lock ...... night_board returns 0 rows
--   with no claims ....... night_board raises 42501 (the guard is real)
--   past the lock ........ 12 games, every one with a settled server and a code, and each
--                          lineup_lock_at at its own puck drop minus 30
--   night_lock_at(last game of the night) = min(scheduled_at that ET day) - 30 min
