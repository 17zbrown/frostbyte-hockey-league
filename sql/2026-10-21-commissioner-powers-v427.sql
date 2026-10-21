-- v4.27 (2026-10-21): a commissioner may waive a suspended player. The v4.25 waiver bar binds the club only.
-- Commissioner, 2026-10-21, on v4.25 binding the league office to the waiver bar: "Commissioners may move remove or
-- edit any player at any time. Commissioners always have more ability that team managers, even in the team HQ."
--
-- Before (v4.25): waive_player refused a suspended player for everyone, and guard_roster_waive refused any waiver of
-- one (app.roster_reason 'waived') whoever made it, the league office included.
-- After: both let a commissioner (and the league's own automation, trusted_writer) through. A club's management is
-- still refused, by the RPC and by the delete trigger. mgmt_request_move needs no change: a commissioner never queues a
-- move for an Owner's approval, so its waiver refusal only ever meets club management.
-- Both are CREATE OR REPLACE (grants kept), search_path '' as before.

-- 1) the waiver RPC ------------------------------------------------------------------------------------------------
create or replace function public.waive_player(p_profile uuid)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_team record; v_season record; v_name text; v_n int; v_why text;
begin
  /* v3.76: a commissioner acts for the club the player is on (Team HQ, any club); a manager for his own seat */
  if public.is_commissioner() then
    select t.* into v_team from public.teams t join public.roster_spots rs on rs.team_id = t.id
     where rs.season_id = public.current_season_id() and rs.profile_id = p_profile
     limit 1;
    if v_team.id is null then raise exception 'That player is not on a club''s roster this season.'; end if;
  else
    select t.* into v_team from public.teams t
      where t.owner_profile_id = auth.uid() or t.gm_profile_id = auth.uid() or t.agm_profile_id = auth.uid()
      limit 1;
    if v_team.id is null then raise exception 'Only club management can waive players.'; end if;
  end if;
  perform public.mgmt_gate(v_team.id, 'roster');
  if public.is_suspended(auth.uid()) then raise exception 'Suspended managers cannot make roster moves.'; end if;
  select * into v_season from public.seasons where id = public.current_season_id();
  if v_season.id is null then raise exception 'No active season.'; end if;
  if not exists (select 1 from public.roster_spots rs where rs.season_id = v_season.id and rs.team_id = v_team.id and rs.profile_id = p_profile) then
    raise exception 'That player is not on your roster.';
  end if;
  /* v4.25 (commissioner, 2026-10-21: "allow suspended players to be moved between training camp and the active
     roster, or traded but not waived"): a club cannot waive a player whose playing suspension is running, so it
     cannot shed the player and the suspension together.
     v4.27 (commissioner, 2026-10-21: "Commissioners may move remove or edit any player at any time. Commissioners
     always have more ability that team managers, even in the team HQ."): the bar is the club's, never the office's. */
  if public.is_suspended(p_profile) and not public.is_commissioner() then
    raise exception 'Rule 7.2: % is suspended and cannot be waived until the suspension is served. The club may still move them between the active roster and training camp, or trade them.',
      coalesce((select nullif(gamertag, '') from public.profiles where id = p_profile), 'This player')
      using errcode = 'check_violation';
  end if;
  /* Rule 2.4 minimum service (v2.74); v3.79: it binds the club's own management, never the league office */
  if not public.is_commissioner() then
    v_why := public.can_move_player(v_season.id, p_profile);
    if v_why is not null then raise exception '%', v_why; end if;
  end if;

  perform set_config('app.roster_reason', 'waived', true);
  delete from public.roster_spots
    where season_id = v_season.id and team_id = v_team.id and profile_id = p_profile;
  get diagnostics v_n = row_count;
  perform set_config('app.roster_reason', '', true);
  if v_n = 0 then raise exception 'That player is not on your roster.'; end if;

  perform set_config('app.role_grant','on',true);
  /* v3.06: stamp the waiver. Without it a waived player is indistinguishable from an undrafted
     one, and the post-draft sweep hands him straight back to a club (it did, twice, within
     seconds). He is a free agent now and waits for a club to sign him (Rule 2.2). */
  update public.season_registrations set status = 'pending', waived_at = now()
    where season_id = v_season.id and profile_id = p_profile;

  select coalesce(gamertag, display_name, 'a player') into v_name from public.profiles where id = p_profile;
  perform set_config('app.role_grant','',true);
  insert into public.transactions (season_id, type, description)
    values (v_season.id, 'waive', v_team.name || ' waived <b>' || replace(replace(v_name,'<',''),'>','') || '</b>');
  return v_name;
end $function$;

-- 2) the roster delete trigger -------------------------------------------------------------------------------------
create or replace function public.guard_roster_waive()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v3.11 — a league-office removal is not a club waive. This guard exists to stop CLUBS shedding
   players once moves are locked; it let a commissioner through and nothing else, so the Rule 1.1
   departure sweep (which runs as the service role, not as a person) would have been blocked at
   the trade deadline, silently leaving departed members on rosters exactly when a spot matters
   most. The bypass is one named, transaction-local flag, set only by that sweep. */
begin
  if coalesce(current_setting('app.office_removal', true), '') = '1' then return old; end if;
  /* v4.25 (commissioner, 2026-10-21: "allow suspended players to be moved between training camp and the active
     roster, or traded but not waived"): a club cannot waive a suspended player. The bar is here as well as in
     waive_player so every door that deletes a roster row is covered by one definition.
     v4.27 (commissioner, 2026-10-21: "Commissioners may move remove or edit any player at any time. Commissioners
     always have more ability that team managers, even in the team HQ."): only a signed-in member who is neither a
     commissioner nor the league's automation is refused; the office and unattended jobs pass. */
  if public.is_suspended(old.profile_id)
     and auth.uid() is not null and not (public.is_commissioner() or public.trusted_writer()) then
    raise exception 'Rule 7.2: % is suspended and cannot be waived until the suspension is served. The club may still move them between the active roster and training camp, or trade them.',
      coalesce((select nullif(gamertag, '') from public.profiles where id = old.profile_id), 'This player')
      using errcode = 'check_violation';
  end if;
  /* v4.17: releases close with signings (public.fa_moves_closed), which may come before the movement deadline:
     Season 1's closed at the original deadline while trades ran to the extended one (Rule 2.4) */
  if public.fa_moves_closed(old.season_id) and not public.is_commissioner() then
    raise exception 'Rule 2.4: releases have closed for this season, so a club cannot waive players now.';
  end if;
  return old;
end $function$;

-- 3) self-checks ---------------------------------------------------------------------------------------------------
do $chk$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.waive_player(uuid)'::regprocedure);
  if position('if public.is_suspended(p_profile) and not public.is_commissioner() then' in v_def) = 0 then
    raise exception 'v4.27 check: waive_player does not exempt a commissioner';
  end if;
  if position('is_suspended(p_profile)' in v_def) > position('delete from public.roster_spots' in v_def) then
    raise exception 'v4.27 check: the club bar must still run before the delete';
  end if;
  v_def := pg_get_functiondef('public.guard_roster_waive()'::regprocedure);
  if position('= ''waived''' in v_def) > 0
     or position('and auth.uid() is not null and not (public.is_commissioner() or public.trusted_writer())' in v_def) = 0 then
    raise exception 'v4.27 check: guard_roster_waive still binds the office';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.roster_spots'::regclass and tgfoid = 'public.guard_roster_waive()'::regprocedure
                 and not tgisinternal and (tgtype & 2) = 2 and (tgtype & 8) = 8) then
    raise exception 'v4.27 check: guard_roster_waive is not a BEFORE DELETE trigger on roster_spots';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('waive_player', 'guard_roster_waive')
             and not ('search_path=""' = any(proconfig))) then
    raise exception 'v4.27 check: search_path';
  end if;
  if not has_function_privilege('authenticated', 'public.waive_player(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.waive_player(uuid)', 'EXECUTE') then
    raise exception 'v4.27 check: waive_player grants changed';
  end if;
end $chk$;

/* REHEARSAL (2026-10-21, one transaction on the live database with both functions and the $chk$ block, rolled back by a
   closing raise; releases are closed for Season 1):
   T0 preconditions: Tager x 72 (NYI) suspended, Pip (NYI) not.
   T1 the NYI Owner (a member) still cannot waive Tager: "cannot be waived until the suspension is served".
   T2 a commissioner waives Tager: the roster row is deleted (through the trigger, app.roster_reason 'waived'), waived_at
      is stamped and the transaction is logged (pass undone with ZZ001).
   T3 control: the Owner waiving Pip meets only the release close ("Rule 2.4: releases have closed for this season"),
      never Rule 7.2.
   Result: REHEARSAL OK: T0 T1 T2 T3.
   Afterward both functions still held their v4.25 definitions and Tager was still rostered with no waived_at, so
   nothing stuck.
   Applied as migration v427_commissioner_powers; tools/sql/grant-audit.sql (all nine checks) returned zero rows. */
