-- REHEARSAL for sql/2026-11-24-playoff-floor-reads-scoped.sql (the main session runs it; it ends in an uncaught
-- raise, so everything rolls back). The record's text sits below verbatim (tools/playoff-floor-reads-Privacy fix 2026-11-24.test.cjs checks
-- it byte for byte, so a pasted older copy fails the test). It names nobody: the player is found from the office table,
-- and only counts are reported.
--
-- The circle it proves: the player, league staff, commissioners, and the CURRENT front office of the player's club (today's
-- seats on the club the player is rostered on in the current season, for that season only). Never "that season's" front
-- office: teams carry over and have no season column.
--
-- What it writes inside the transaction (all rolled back, nothing sent: pg_net is transactional):
--   T0  the commissioner's rollover, public.start_next_season(Season 2), modeled only while Season 1's player contracts are
--       still active (it runs before any Season 2 seat; see T0).
--   T3  two teammates of the player seated as Owner and GM of the player's Season 1 club, with app.mgmt_quiet on (v4.53)
--       and no signed-in actor. trg_team_manager_sync then calls ensure_manager_rostered, which rosters both on the CURRENT
--       season with a management contract; that adds their tenure rows, roster notices, role_sync_queue rows and live
--       marks. Run it before the Season 2 seating: it refuses a club that is already seated.
--   T7  one gp_credits row for the current season on the seated Owner, so the current front office has a credit to read.
-- Apply order: this record ships before the Season 2 seating (Dec 5), while Season 2 is empty.

begin;

-- 0. before the change: what the database callers answer today
do $before$
begin
  perform set_config('cghl.r_before', (
    select jsonb_build_object(
      'eligible', (select jsonb_object_agg(c.season_id || ':' || c.profile_id, public.award_eligible(c.season_id, c.profile_id))
                     from (select distinct season_id, profile_id from public.gp_credits) c),
      'gp', (select jsonb_object_agg(c.season_id || ':' || c.profile_id, public.regular_gp(c.season_id, c.profile_id))
               from (select distinct season_id, profile_id from public.gp_credits) c),
      'board', (select jsonb_object_agg(s.number, (select md5(coalesce(string_agg(b::text, '|' order by b.category, b.place), ''))
                                                     from public.statistical_title_board(s.id, 10) b))
                  from public.seasons s),
      'floors', (select jsonb_object_agg(s.number, (select md5(coalesce(string_agg(f.profile_id || '=' || f.floor, '|' order by f.profile_id), ''))
                                                      from public.playoff_floors(s.id) f))
                   from public.seasons s)))::text, true);
end $before$;

-- 1. the record (verbatim) -------------------------------------------------------------------------------------------
-- >>> record text: sql/2026-11-24-playoff-floor-reads-scoped.sql
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

-- <<< record text

-- 2. the cases -------------------------------------------------------------------------------------------------------
do $r$
declare
  v_before jsonb := current_setting('cghl.r_before')::jsonb;
  v_cur uuid := public.current_season_id();
  v_s uuid; v_p uuid; v_c int; v_team uuid; v_other uuid; v_mate uuid; v_mate2 uuid; v_staff uuid; v_comm uuid; v_media uuid;
  v_s2 uuid; v_roll jsonb; v_rows int; n int; v_out text := '';
  /* the credited (season, player) pairs, read as the rehearsal's own role: under anon the office-only table is refused,
     so T1's eligibility comparison walks this list instead (main session, 2026-11-23: the first run failed 42501) */
  v_pairs jsonb := (select coalesce(jsonb_agg(jsonb_build_object('season_id', z.season_id, 'profile_id', z.profile_id)), '[]'::jsonb)
                      from (select distinct season_id, profile_id from public.gp_credits) z);
begin
  select p.id into v_comm from public.profiles p where p.role = 'commissioner' order by p.created_at limit 1;

  -- T0 D-ROLLOVER (main session, 2026-11-23): Season 1's player contracts stay active until the commissioner's rollover,
  -- public.start_next_season(Season 2), runs, and it runs before any Season 2 seat. T3 seats two members, which rosters
  -- them on Season 2 through ensure_manager_rostered; with a live Season 1 contract that call would rewrite the Season 1
  -- deal into a Season 2 management one, a state the real seating never meets. So model the rollover first, as a
  -- commissioner, only while it has not run for real (the rehearsal passes before and after it). Contracts are never
  -- expired by hand.
  select s.id into v_s2 from public.seasons s where s.number = 2;
  if exists (select 1 from public.contracts c where c.status in ('active', 'signed') and not coalesce(c.is_manager, false)
              and c.start_season < 2) then
    perform set_config('request.jwt.claims', json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
    v_roll := public.start_next_season(v_s2);
    perform set_config('request.jwt.claims', '', true);
    v_out := v_out || format('T0 rollover modeled: %s. ', v_roll);
  else
    v_out := v_out || 'T0 rollover already run. ';
  end if;

  -- an adjusted player still on a roster (playoff_floors lists rostered players only) and the season, from the office
  -- table (never named)
  select c.season_id, c.profile_id, sum(c.games)::int into v_s, v_p, v_c
    from public.gp_credits c
   where exists (select 1 from public.roster_spots r where r.season_id = c.season_id and r.profile_id = c.profile_id)
   group by 1, 2 order by min(c.created_at) limit 1;
  if v_p is null then raise exception 'no rostered adjusted player to rehearse with'; end if;
  if v_s = v_cur then
    raise exception 'the adjusted player''s season is the current season; T3 needs a past season, so rewrite T3 before rehearsing';
  end if;
  select rs.team_id into v_team from public.roster_spots rs where rs.season_id = v_s and rs.profile_id = v_p order by rs.created_at limit 1;
  if exists (select 1 from public.teams t where t.id = v_team
              and coalesce(t.owner_profile_id, t.gm_profile_id, t.agm_profile_id) is not null) then
    raise exception 'T3 expects the player''s club unseated: rehearse before the Season 2 seating';
  end if;
  select count(*) into v_rows from public.playoff_floors(v_s);
  -- a plain member of another club, two teammates (the stand-in Owner and GM), a staffer, a media-only staffer
  select rs.profile_id into v_other from public.roster_spots rs join public.profiles p on p.id = rs.profile_id
   where rs.season_id = v_s and rs.team_id <> v_team and p.role not in ('staff', 'commissioner') order by rs.created_at limit 1;
  select rs.profile_id into v_mate from public.roster_spots rs join public.profiles p on p.id = rs.profile_id
   where rs.season_id = v_s and rs.team_id = v_team and rs.profile_id <> v_p and p.role not in ('staff', 'commissioner')
     and not coalesce(p.banned, false)
     and not exists (select 1 from public.teams t where rs.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id))
   order by rs.created_at limit 1;
  select rs.profile_id into v_mate2 from public.roster_spots rs join public.profiles p on p.id = rs.profile_id
   where rs.season_id = v_s and rs.team_id = v_team and rs.profile_id not in (v_p, v_mate) and p.role not in ('staff', 'commissioner')
     and not coalesce(p.banned, false)
     and not exists (select 1 from public.teams t where rs.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id))
   order by rs.created_at limit 1;
  if v_other is null or v_mate is null or v_mate2 is null then raise exception 'not enough members to rehearse with'; end if;
  select p.id into v_staff from public.profiles p where p.role = 'staff' and not public.is_media_only_staff(p.id)
     and not public.is_staff_suspended(p.id) order by p.created_at limit 1;
  select p.id into v_media from public.profiles p where p.role = 'staff' and public.is_media_only_staff(p.id)
     and not public.is_staff_suspended(p.id) order by p.created_at limit 1;

  -- T1 a signed-out visitor: floors for everyone, no credit for anyone; regular_gp and can_move_player are refused
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  select count(*) filter (where credit is not null), count(*) filter (where floor is not null) into n, v_rows from public.playoff_floors(v_s);
  if n <> 0 then raise exception 'T1 anon sees % credits', n; end if;
  begin
    perform public.regular_gp(v_s, v_p);
    raise exception 'T1 anon could call regular_gp';
  exception when others then if sqlerrm not like '%permission denied%' then raise; end if;
  end;
  begin
    perform public.can_move_player(v_s, v_p);
    raise exception 'T1 anon could call can_move_player';
  exception when others then if sqlerrm not like '%permission denied%' then raise; end if;
  end;
  -- definer callers answer exactly as before, for the signed-out visitor too
  if (select jsonb_object_agg(c.season_id || ':' || c.profile_id, public.award_eligible(c.season_id, c.profile_id))
        from jsonb_to_recordset(v_pairs) as c(season_id uuid, profile_id uuid)) is distinct from v_before->'eligible' then
    raise exception 'T1 award_eligible changed';
  end if;
  if (select jsonb_object_agg(s.number, (select md5(coalesce(string_agg(b::text, '|' order by b.category, b.place), ''))
                                           from public.statistical_title_board(s.id, 10) b)) from public.seasons s)
     is distinct from v_before->'board' then
    raise exception 'T1 statistical_title_board changed';
  end if;
  if (select jsonb_object_agg(s.number, (select md5(coalesce(string_agg(f.profile_id || '=' || f.floor, '|' order by f.profile_id), ''))
                                           from public.playoff_floors(s.id) f)) from public.seasons s)
     is distinct from v_before->'floors' then
    raise exception 'T1 a floor changed';
  end if;
  v_out := v_out || format('T1 anon: %s floors, 0 credits, regular_gp and can_move_player refused, eligibility, title boards and floors unchanged. ', v_rows);

  -- T2 a member of another club: no credit on the adjusted player's row; their own row shows theirs (0 when none)
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if (select f.credit from public.playoff_floors(v_s) f where f.profile_id = v_p) is not null then
    raise exception 'T2 a member of another club sees the credit';
  end if;
  if (select f.credit from public.playoff_floors(v_s) f where f.profile_id = v_other) is null then
    raise exception 'T2 a member cannot see their own row';
  end if;
  select count(*) into n from public.playoff_floors(v_s) f where f.credit is not null;
  if n <> 1 then raise exception 'T2 a member sees % rows with a credit (expected only their own)', n; end if;
  begin
    perform public.regular_gp(v_s, v_p);
    raise exception 'T2 a member could call regular_gp';
  exception when others then if sqlerrm not like '%permission denied%' then raise; end if;
  end;
  begin
    perform public.can_move_player(v_s, v_p);
    raise exception 'T2 a member could call can_move_player';
  exception when others then if sqlerrm not like '%permission denied%' then raise; end if;
  end;
  v_out := v_out || 'T2 member of another club: own row only, regular_gp and can_move_player refused. ';

  -- T3 a seat filled today on the player's club does not read a PAST season's credit: two teammates seated as Owner and
  -- GM (the league's change, so no signed-in actor; app.mgmt_quiet keeps the management-moves post from being queued)
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.mgmt_quiet', 'on', true);
  update public.teams set owner_profile_id = v_mate2 where id = v_team;
  update public.teams set gm_profile_id = v_mate where id = v_team;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mate, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if not public.is_gm_of(v_team) then raise exception 'T3 setup: the stand-in GM is not seated'; end if;
  if (select f.credit from public.playoff_floors(v_s) f where f.profile_id = v_p) is not null then
    raise exception 'T3 a seat filled today reads the past season''s credit';
  end if;
  select count(*) into n from public.playoff_floors(v_s) f where f.credit is not null and f.profile_id <> v_mate;
  if n <> 0 then raise exception 'T3 the GM sees % past-season credits besides their own row', n; end if;
  v_out := v_out || 'T3 a seat filled today on the player''s club: no past-season credit, own row only. ';

  -- T4 a staffer, and a media-only staffer: every row
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if (select f.credit from public.playoff_floors(v_s) f where f.profile_id = v_p) is distinct from v_c
     or exists (select 1 from public.playoff_floors(v_s) f where f.credit is null) then
    raise exception 'T4 a staffer does not see every credit';
  end if;
  if v_media is not null then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_media, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    if exists (select 1 from public.playoff_floors(v_s) f where f.credit is null) then
      raise exception 'T4 a media-only staffer does not see every credit';
    end if;
    v_out := v_out || 'T4 staffer and media-only staffer: every row. ';
  else
    v_out := v_out || 'T4 staffer: every row (no media-only staffer to try). ';
  end if;

  -- T5 the player: their own credit, nobody else's (strict: the front office arm is shut for a past season)
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if (select f.credit from public.playoff_floors(v_s) f where f.profile_id = v_p) is distinct from v_c then
    raise exception 'T5 the player does not see their own credit';
  end if;
  select count(*) into n from public.playoff_floors(v_s) f where f.credit is not null;
  if n <> 1 then raise exception 'T5 the player sees % rows with a credit (expected only their own)', n; end if;
  v_out := v_out || 'T5 the player: own row only. ';

  -- T6 a commissioner: every row; the definer path still counts the full figure
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from public.playoff_floors(v_s) f where f.credit is null) then
    raise exception 'T6 a commissioner does not see every credit';
  end if;
  perform set_config('role', 'none', true);
  if (select jsonb_object_agg(c.season_id || ':' || c.profile_id, public.regular_gp(c.season_id, c.profile_id))
        from (select distinct season_id, profile_id from public.gp_credits) c) is distinct from v_before->'gp' then
    raise exception 'T6 regular_gp changed for database callers';
  end if;
  v_out := v_out || 'T6 commissioner: every row; regular_gp unchanged for database callers. ';

  -- T7 the CURRENT front office reads its current-season player's credit; nobody outside the circle does. A credit for the
  -- seated Owner on the current season (rolled back), read by the GM.
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  if not exists (select 1 from public.roster_spots r where r.season_id = v_cur and r.profile_id = v_mate2 and r.team_id = v_team) then
    raise exception 'T7 setup: the seated Owner is not on the club''s current-season roster';
  end if;
  insert into public.gp_credits (season_id, profile_id, games, reason) values (v_cur, v_mate2, 1, 'rehearsal stand-in, rolled back');
  perform set_config('request.jwt.claims', json_build_object('sub', v_mate, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if (select f.credit from public.playoff_floors(v_cur) f where f.profile_id = v_mate2) is distinct from 1 then
    raise exception 'T7 the current GM does not see their current-season player''s credit';
  end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if (select f.credit from public.playoff_floors(v_cur) f where f.profile_id = v_mate2) is not null then
    raise exception 'T7 a member of another club sees the current-season credit';
  end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  if exists (select 1 from public.playoff_floors(v_cur) f where f.credit is not null) then
    raise exception 'T7 anon sees a current-season credit';
  end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_mate2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if (select f.credit from public.playoff_floors(v_cur) f where f.profile_id = v_mate2) is distinct from 1 then
    raise exception 'T7 the player does not see their own current-season credit';
  end if;
  perform set_config('role', 'none', true);
  v_out := v_out || 'T7 current front office: the GM reads the current-season credit; another club''s member and anon do not.';

  raise exception 'REHEARSAL OK: %', v_out;
end $r$;
