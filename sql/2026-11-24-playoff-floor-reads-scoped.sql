-- 2026-11-24: read scoping for the playoff floor readers.
--
-- public.playoff_floors(season) is SECURITY DEFINER and anyone holding the public key may call it. It returns every
-- rostered player's playoff floor (public record: Rule 8.3, prorated for late joiners) and a third column, credit, read
-- straight from the office-only table public.gp_credits. That column is not public record. public.regular_gp(season,
-- profile) was also callable with the public key and returns games played with the same office adjustment folded in, and
-- public.can_move_player(season, profile) printed that same figure in its refusal text.
--
-- 1. playoff_floors keeps its floor column for everyone. Its credit column goes only to this circle, and is null for
--    everyone else:
--      - the player;
--      - league staff and commissioners (every season);
--      - the CURRENT front office of the player's club: today's Owner, GM and AGM (public.is_gm_of) of the club the player
--        is rostered on in the current season (public.current_season_id()), and only for that season.
--    Why the front office is current-season only: seats live on public.teams, which has no season column, and a club's
--    team row carries over from season to season (a new Owner is seated on the same row). So is_gm_of can only say who
--    holds the franchise today, never who held it in an earlier season; without the season test, a Season 2 Owner would
--    read the Season 1 credit of every player that franchise had in Season 1. The front office loses nothing it uses:
--    the credit matters for the season being played (the Road card, the playoff lineup lockout), and a past season's
--    credit stays visible to the player, staff and commissioners.
--    The return type is unchanged, so CREATE OR REPLACE keeps its grants (client RPC: CG.loadPlayoffFloors, grant audit
--    check 4). The current site reads credit only through CG.loadPlayoffFloors into lg.gpCredits, and CG.floorGp and
--    CG.playoffLockout add it only when present, so the Road card, the player's own eligibility card and the playoff
--    lineup lockout stay exactly as they are for the player and their club's current front office; everyone else sees
--    games played, as the box scores say.
-- 2. regular_gp loses its API grants. Nothing outside the database calls it (src/live, netlify, jobs, edge, bot and shared
--    were searched), and every database caller is SECURITY DEFINER and runs as the owner: award_eligible, can_move_player,
--    set_game_lineup and statistical_title_board (through award_eligible). They are unaffected and still count the full
--    figure. A gate inside regular_gp could not do the same: auth.uid() is the API caller's even inside a definer chain,
--    so a gate would change the lineup gate and the title board for whoever happened to call them.
-- 3. can_move_player (Rule 2.4, the minimum-service check) returns a refusal TEXT, not true or false, and that text said
--    "has played <regular_gp> of the <need> games": the credited figure. guard_trade_insert raises the text to a club that
--    proposes a trade for ANOTHER club's player, which is outside the circle above. The text now names the minimum only;
--    the comparison still uses the full figure. It also loses its API grants: its only callers are waive_player and the
--    trades trigger guard_trade_insert, both SECURITY DEFINER, and the site never calls it (src/live/part_live.js keeps a
--    local mirror, CG.minServiceGp). Exposure today is nil (min_service_gp is 0 in both seasons, so it returns null), but
--    a season that sets a minimum would have printed the figure to anyone with the public key.
--
-- Not changed here, and why: award_eligible (callable with the public key) answers true or false from the full figure.
-- That boolean is the adjustment's intended public effect (eligibility, which the title board shows anyway), not the
-- figure itself. A refusal from can_move_player says the same yes or no, and no more.

-- 1. playoff_floors --------------------------------------------------------------------------------------------------
create or replace function public.playoff_floors(p_season uuid)
 returns table(profile_id uuid, floor integer, credit integer)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* Privacy fix 2026-11-24: the floor is public record. The credit column goes only to the player, league staff, commissioners and the
     CURRENT front office (today's seats, public.is_gm_of) of the club the player is rostered on in the current season,
     for that season only: teams carry over between seasons and have no season column, so today's seats cannot stand for
     an earlier season's front office. Null for everyone else (sql/2026-11-24-playoff-floor-reads-scoped.sql). */
  select rs.profile_id, public.player_playoff_floor(p_season, rs.profile_id),
         case when rs.profile_id = auth.uid() or public.is_staff() or public.is_commissioner()
                   or (p_season = public.current_season_id()
                       and exists (select 1 from public.roster_spots f
                                    where f.season_id = p_season and f.profile_id = rs.profile_id and public.is_gm_of(f.team_id)))
              then coalesce((select sum(c.games)::int from public.gp_credits c
                              where c.season_id = p_season and c.profile_id = rs.profile_id), 0)
         end
    from (select distinct r.profile_id from public.roster_spots r where r.season_id = p_season) rs
$function$;
revoke all on function public.playoff_floors(uuid) from public;
grant execute on function public.playoff_floors(uuid) to anon, authenticated, service_role;

-- 2. regular_gp: database callers only ---------------------------------------------------------------------------------
revoke all on function public.regular_gp(uuid, uuid) from public, anon, authenticated;
grant execute on function public.regular_gp(uuid, uuid) to service_role;

-- 3. can_move_player: the minimum only, never the count; database callers only ------------------------------------------
create or replace function public.can_move_player(p_season uuid, p_profile uuid)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare v_need int; v_gp int; v_name text;
begin
  /* v3.40: this is now the WAIVE check only. The commissioner's announcement of 2026-09-26 removed
     the minimum before a trade and kept it before a waiver, so the two call sites in accept_trade
     and guard_trade_insert were deleted rather than this function being loosened: a club may trade
     a player the day they sign, and still may not waive one it has not played. */
  /* Privacy fix 2026-11-24: v3.68 (Q63) put the call back in guard_trade_insert, so this text can reach a club proposing a trade for another
     club's player. It names the minimum and never the count: regular_gp folds in the office's private adjustment
     (sql/2026-11-24-playoff-floor-reads-scoped.sql). The comparison still uses the full figure. */
  v_need := public.min_service_gp(p_season);
  if v_need <= 0 then return null; end if;
  v_gp := public.regular_gp(p_season, p_profile);
  if v_gp >= v_need then return null; end if;
  select coalesce(nullif(p.gamertag, ''), 'That player') into v_name from public.profiles p where p.id = p_profile;
  return 'Rule 2.4: ' || v_name || ' has not yet played the ' || v_need || ' regular-season games a player needs this season before they can be waived.';
end $function$;
revoke all on function public.can_move_player(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_move_player(uuid, uuid) to service_role;

-- 4. self-checks -------------------------------------------------------------------------------------------------------
do $chk$
declare n int; v_bad text;
begin
  if not (select prosecdef from pg_proc where oid = 'public.playoff_floors(uuid)'::regprocedure)
     or (select proconfig from pg_proc where oid = 'public.playoff_floors(uuid)'::regprocedure) <> array['search_path=""'] then
    raise exception 'playoff_floors must stay SECURITY DEFINER, now with search_path ''''';
  end if;
  if not has_function_privilege('anon', 'public.playoff_floors(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.playoff_floors(uuid)', 'EXECUTE') then
    raise exception 'playoff_floors lost its client grant (CG.loadPlayoffFloors, grant audit check 4)';
  end if;
  -- the front office arm is limited to the current season (teams carry over; today's seats are not a past season's)
  if position('p_season = public.current_season_id()' in pg_get_functiondef('public.playoff_floors(uuid)'::regprocedure)) = 0 then
    raise exception 'playoff_floors: the front office arm is not limited to the current season';
  end if;
  -- regular_gp and can_move_player: no API grant, PUBLIC included
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.oid in ('public.regular_gp(uuid,uuid)'::regprocedure, 'public.can_move_player(uuid,uuid)'::regprocedure)
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0));
  if v_bad is not null then raise exception 'still callable through the API: %', v_bad; end if;
  -- every database caller of regular_gp runs as the owner, so revoking the API grants cannot break one
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname = 'public' and p.prosrc ~ 'regular_gp' and not p.prosecdef and p.proname <> 'regular_gp') then
    raise exception 'an invoker function calls regular_gp: %', (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.prosrc ~ 'regular_gp' and not p.prosecdef and p.proname <> 'regular_gp');
  end if;
  -- ...and of can_move_player (a call, not a mention: format_rules and guard_trade_insert also name it in comments)
  select string_agg(p.proname, ', ') into v_bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosrc ~ 'can_move_player\s*\(' and not p.prosecdef and p.proname <> 'can_move_player';
  if v_bad is not null then raise exception 'an invoker function calls can_move_player: %', v_bad; end if;
  if exists (select 1 from pg_policies where qual ~ '(regular_gp|can_move_player)' or with_check ~ '(regular_gp|can_move_player)')
     or exists (select 1 from pg_views where schemaname = 'public' and definition ~ '(regular_gp|can_move_player)') then
    raise exception 'a policy or view calls regular_gp or can_move_player';
  end if;
  if (select prosrc from pg_proc where oid = 'public.can_move_player(uuid,uuid)'::regprocedure) ~ 'has played|\|\| v_gp'
     or not (select prosecdef from pg_proc where oid = 'public.can_move_player(uuid,uuid)'::regprocedure)
     or (select proconfig from pg_proc where oid = 'public.can_move_player(uuid,uuid)'::regprocedure) <> array['search_path=""'] then
    raise exception 'can_move_player must be SECURITY DEFINER with search_path '''' and must not print the games-played count';
  end if;
  -- with no signed-in caller (as here) no credit is returned; the floors still are
  select count(*) into n from public.seasons s, public.playoff_floors(s.id) f where f.credit is not null;
  if n <> 0 then raise exception 'playoff_floors returned % credits to a caller who is nobody', n; end if;
  if not exists (select 1 from public.seasons s, public.playoff_floors(s.id) f where f.floor is not null) then
    raise exception 'playoff_floors returned no floors';
  end if;
  -- the definer path still counts the full figure: games played plus the office's adjustment
  if exists (select 1 from (select c.season_id, c.profile_id, sum(c.games)::int g from public.gp_credits c group by 1, 2) c
              where public.regular_gp(c.season_id, c.profile_id) <>
                    c.g + (select count(distinct gm.id)::int from public.game_stats gs join public.games gm on gm.id = gs.game_id
                            where gs.profile_id = c.profile_id and gm.season_id = c.season_id
                              and coalesce(gm.stage, 'regular') = 'regular' and gm.status = 'final' and not coalesce(gm.voided, false))) then
    raise exception 'regular_gp no longer counts the full figure for its database callers';
  end if;
end $chk$;

/* REHEARSAL on production, 2026-11-23 (main session), sql/2026-11-24-playoff-floor-reads-scoped.rehearsal.sql: one
   transaction ended by an uncaught raise, rolled back. Two rehearsal-only fixes before it passed (neither touches this
   record): a missing closing parenthesis in the "before" snapshot, and T1's eligibility comparison read the office-only
   credit table after switching to anon (42501), so it now walks a list taken before the switch.
   Result: REHEARSAL OK: T0 rollover already run. T1 anon: 139 floors, 0 credits, regular_gp and can_move_player refused,
   eligibility, title boards and floors unchanged. T2 member of another club: own row only, regular_gp and can_move_player
   refused. T3 a seat filled today on the player's club: no past-season credit, own row only. T4 staffer and media-only
   staffer: every row. T5 the player: own row only. T6 commissioner: every row; regular_gp unchanged for database callers.
   T7 current front office: the GM reads the current-season credit; another club's member and anon do not. 
   Applied 2026-11-24 (main session) as migration privacy_playoff_floor_reads_scoped; tools/sql/grant-audit.sql returned zero rows. */
