-- 2026-10-19: league office games-played credits toward the playoff floor (Rule 8.3).
-- A credit adds regular-season games to the count the playoff floor is judged against (public.regular_gp), so it reaches
-- every reader of that one definition: the playoff lineup gate (set_game_lineup), award eligibility (award_eligible)
-- and the waiver minimum (can_move_player). It adds no statistics: box scores, season lines, Stat Central and the
-- statistical titles (statistical_title_board counts lines at a position) still count only games played.
-- The table is office-only: RLS on, no policy, no grant. Only the SECURITY DEFINER readers below see it. Team HQ's
-- Road card and a player's eligibility card read the per-player total through playoff_floors.

create table if not exists public.gp_credits (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid not null references public.seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  games      int  not null check (games between 1 and 82),
  reason     text not null check (length(btrim(reason)) > 0),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists gp_credits_season_profile on public.gp_credits (season_id, profile_id);
alter table public.gp_credits enable row level security;
revoke all on public.gp_credits from public, anon, authenticated;

-- games played toward the floor: distinct regular-season finals with a line, plus the office's credits
create or replace function public.regular_gp(p_season uuid, p_profile uuid)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select (select count(distinct g.id)::int from public.game_stats gs join public.games g on g.id = gs.game_id
           where gs.profile_id = p_profile and g.season_id = p_season and coalesce(g.stage,'regular') = 'regular'
             and g.status = 'final' and not coalesce(g.voided,false))
       + coalesce((select sum(c.games)::int from public.gp_credits c
                    where c.season_id = p_season and c.profile_id = p_profile), 0) $function$;

-- the return type gains a column, so the function is dropped and recreated (with its grants) in this one transaction
drop function if exists public.playoff_floors(uuid);
create function public.playoff_floors(p_season uuid)
 returns table(profile_id uuid, floor integer, credit integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select rs.profile_id, public.player_playoff_floor(p_season, rs.profile_id),
         coalesce((select sum(c.games)::int from public.gp_credits c
                    where c.season_id = p_season and c.profile_id = rs.profile_id), 0)
    from (select distinct profile_id from public.roster_spots where season_id = p_season) rs
$function$;
revoke all on function public.playoff_floors(uuid) from public;
grant execute on function public.playoff_floors(uuid) to anon, authenticated, service_role;

do $chk$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.gp_credits'::regclass) then
    raise exception 'gp_credits: RLS is off'; end if;
  if has_table_privilege('anon', 'public.gp_credits', 'SELECT') or has_table_privilege('authenticated', 'public.gp_credits', 'SELECT')
     or has_table_privilege('authenticated', 'public.gp_credits', 'INSERT') then
    raise exception 'gp_credits: an API role can reach the table'; end if;
  if position('gp_credits' in pg_get_functiondef('public.regular_gp(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'regular_gp does not add the credits'; end if;
  if not has_function_privilege('anon', 'public.playoff_floors(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.playoff_floors(uuid)', 'EXECUTE') then
    raise exception 'playoff_floors lost its grant'; end if;
end $chk$;

/* REHEARSAL (2026-10-19, one transaction on the live database, rolled back by a closing raise), on a Season 1 goaltender
   with three regular-season games and a floor of 16:
   T1 before any credit: regular_gp 3, and no player in playoff_floors carries a credit.
   T2 a one-game credit: regular_gp 4, the floor stays 16, playoff_floors carries credit 1 for that player and 0 for
      everyone else.
   T3 award_eligible stays false at 4 of 16; playoff_floors still lists every rostered player.
   T4 as an authenticated member: reading gp_credits is refused (insufficient_privilege); playoff_floors still answers
      with the credit.
   T5 a zero-game credit and a blank reason are refused by the checks.
   Result: REHEARSAL OK: T1 T2 T3 T4 T5. Afterwards gp_credits did not exist, regular_gp was the old definition and
   playoff_floors still returned (profile_id, floor).
   Applied as migration playoff_gp_credits; tools/sql/grant-audit.sql (with playoff_floors added to check 4) returned
   zero rows. Credits are granted by the league office with a reason, as data, never in this file. */
