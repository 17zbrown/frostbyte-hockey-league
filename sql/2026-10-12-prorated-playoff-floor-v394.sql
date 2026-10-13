-- v3.94 (2026-10-12): the playoff eligibility floor is prorated for a player first placed after opening night.
--
-- Commissioner, 2026-10-12: "Are you making sure the late signups are getting the correct amount of prorated games for
-- the minimum game requirement to be playoff eligible?" Nothing prorated it: every player needed the season's flat
-- floor (16), so a late sign-up placed with half the season left needed 16 of at most 18 games he could still play
-- as an active-roster player, and a training-camp player (3 a week) at most 9, so about twenty late sign-ups could
-- never be playoff eligible. Rulings, same day: "Same share as the 16" and "Anyone placed after opening night".
--
-- The floor for a player = the season's floor, unless his FIRST roster spot this season (current spots and archived
-- ones, so a waived and re-signed player keeps his first date) was created after the season's first regular-season
-- puck drop. Then it is the floor times the share of his club's regular-season games (not voided) scheduled at or
-- after that moment, rounded up: 16 x 27 / 54 = 8 for a player placed with half the season left. Never more than the
-- floor. One definition, public.player_playoff_floor, read by the playoff lineup gate (set_game_lineup), award
-- eligibility (award_eligible: an award needs playoff eligibility, Rule 9.3), and the site (playoff_floors).

create or replace function public.player_playoff_floor(p_season uuid, p_profile uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_floor int; v_open timestamptz; v_joined timestamptz; v_club uuid; v_total int; v_left int;
begin
  v_floor := public.playoff_min_gp(p_season);
  if coalesce(v_floor, 0) <= 0 then return 0; end if;
  select min(g.scheduled_at) into v_open from public.games g
   where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular' and not coalesce(g.voided, false);
  select min(t) into v_joined from (
    select rs.created_at as t from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = p_profile
    union all
    select r.spot_created_at from public.roster_spot_removals r where r.season_id = p_season and r.profile_id = p_profile) x;
  if v_open is null or v_joined is null or v_joined <= v_open then return v_floor; end if;
  -- his club: the one he is on now, else the last one he was removed from
  select coalesce(
    (select rs.team_id from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = p_profile order by rs.created_at limit 1),
    (select r.team_id from public.roster_spot_removals r where r.season_id = p_season and r.profile_id = p_profile order by r.removed_at desc limit 1))
    into v_club;
  if v_club is null then return v_floor; end if;
  select count(*), count(*) filter (where g.scheduled_at >= v_joined) into v_total, v_left
    from public.games g
   where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular' and not coalesce(g.voided, false)
     and v_club in (g.home_team_id, g.away_team_id);
  if coalesce(v_total, 0) = 0 then return v_floor; end if;
  return least(v_floor, ceil(v_floor::numeric * v_left / v_total)::int);
end $function$;
revoke execute on function public.player_playoff_floor(uuid, uuid) from public;
grant execute on function public.player_playoff_floor(uuid, uuid) to anon, authenticated;

-- every rostered player's floor for a season, for Team HQ, the hub and the awards page (public record)
create or replace function public.playoff_floors(p_season uuid)
returns table(profile_id uuid, floor integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select rs.profile_id, public.player_playoff_floor(p_season, rs.profile_id)
    from (select distinct profile_id from public.roster_spots where season_id = p_season) rs
$function$;
revoke execute on function public.playoff_floors(uuid) from public;
grant execute on function public.playoff_floors(uuid) to anon, authenticated;

-- the playoff lineup gate reads the player's own floor
do $p$
declare v_def text := pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure);
        a1 text := '      if public.playoff_min_gp(v_game.season_id) > 0
         and public.regular_gp(v_game.season_id, v_p) < public.playoff_min_gp(v_game.season_id)';
        b1 text := '      if public.player_playoff_floor(v_game.season_id, v_p) > 0   -- v3.94: prorated for a player placed after opening night
         and public.regular_gp(v_game.season_id, v_p) < public.player_playoff_floor(v_game.season_id, v_p)';
        a2 text := '          v_name, public.regular_gp(v_game.season_id, v_p), public.playoff_min_gp(v_game.season_id) using errcode = ''22023'';';
        b2 text := '          v_name, public.regular_gp(v_game.season_id, v_p), public.player_playoff_floor(v_game.season_id, v_p) using errcode = ''22023'';';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then raise exception 'v3.94: set_game_lineup anchors'; end if;
  execute replace(replace(v_def, a1, b1), a2, b2);
end $p$;

-- award eligibility follows playoff eligibility (Rule 9.3), so it reads the same floor
do $p$
declare v_def text := pg_get_functiondef('public.award_eligible(uuid,uuid)'::regprocedure);
        a text := '  select public.regular_gp(p_season, p_profile) >= public.playoff_min_gp(p_season)';
        b text := '  select public.regular_gp(p_season, p_profile) >= public.player_playoff_floor(p_season, p_profile)   -- v3.94: prorated';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.94: award_eligible anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

do $chk$
begin
  if position('player_playoff_floor' in pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure)) = 0
     or position('player_playoff_floor' in pg_get_functiondef('public.award_eligible(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'v3.94: a floor reader does not read the prorated floor';
  end if;
end $chk$;
