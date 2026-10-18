-- v4.18: a queued signing failed with "Unknown move: sign_free_agent". A GM or AGM whose Owner set free-agent moves to
-- "approve" presses Sign; the site queues it (CG.mgmtQueue("sign_free_agent")), and mgmt_request_move asks
-- _mgmt_describe to describe the move for the Owner. _mgmt_describe had no sign_free_agent case, so it raised, and since
-- sign_free_agent's mgmt_gate demands approval for that seat, the seat could not sign at all. mgmt_action_page already
-- maps the move to 'freeagents' and _mgmt_execute already runs it; only the description was missing. Found by the v4.17
-- completeness review; today it binds the Islanders' AGM (free agents: approve).
--
-- The fix, with one definition for each rule the description needs:
--  * public._fa_signing_salary(season, profile, salary): the salary a signing carries, moved out of sign_free_agent
--    unchanged (basic: the player's own salary for the season travels with them, floored at the minimum, v3.46; full:
--    the club's figure, floored). sign_free_agent and the description both read it, so the Owner approves the terms
--    the signing will actually carry.
--  * public._open_replacement_signing(season, team): the club's open replacement allowance (Rule 2.4), moved out of
--    sign_free_agent unchanged (v4.16b/v4.17 test: granted at or after the free-agent close in force, or any during an
--    office lock). sign_free_agent spends it with "and used_at is null" re-checked under the row lock, so two signings
--    at once can no longer spend one allowance. The description refuses a signing past the free-agent close when the
--    club holds none, when it is asked for instead of when the Owner approves (the v3.98 pattern); a replacement
--    signing stays queueable, so the queue intake itself does not refuse sign_free_agent.
--  * _mgmt_describe gets the sign_free_agent case: the player from the registration (never the client's text), the
--    salary from the helper, and a note when the signing uses the replacement allowance.
-- Nothing here posts to Discord. The site already queues the move; no site change is needed.
--
-- REHEARSAL on production, 2026-10-18: both helpers, the three patches and every self-check in ONE do-block ending in
-- an uncaught raise; verified rolled back (no helper, no new case, Dallas's allowance still open, Dallas's policy as it
-- was, AC unsigned). Probes, each signed in as the seat named:
--   salary helper vs the old inline rule, every registrant of both seasons: 0 mismatches (AC: $2,000,000)
--   Dallas GM (free agents set to approve inside the rehearsal) queues AC: QUEUED, the Owner reads
--     "sign AC at $2M to the end of the season, using the club's replacement signing (Rule 2.4)" (client text ignored)
--   Islanders AGM (approve today, no allowance): refused at once, "Rule 2.4: free-agent signings have closed ..."
--   Dallas Owner approves: approved, AC on Dallas at 2000000, the allowance spent, none left open
-- Applied as migration v418_queued_signings.

create or replace function public._fa_signing_salary(p_season uuid, p_profile uuid, p_salary bigint) returns bigint
  language plpgsql stable set search_path to '' as $f$
/* v4.18: the salary a free-agent signing carries; one definition for sign_free_agent and the approval queue's
   description, moved from sign_free_agent unchanged. v3.46 (commissioner, 2026-09-26): "players keep their salary for
   the whole season even if they are waived." Basic format: read from the player's own contract for this season
   (contract_on_waive leaves it, with its salary, when it expires the row), then from the roster-spot archive (v3.17);
   the minimum is a floor for a player with neither, never a reset. Full format: the club's figure, floored. */
declare v_prior bigint; v_num int;
begin
  if public.season_is_basic(p_season) then
    select s.number into v_num from public.seasons s where s.id = p_season;
    select c.salary into v_prior from public.contracts c
      where c.profile_id = p_profile and not coalesce(c.is_manager,false)
        and c.start_season <= v_num and c.end_season >= v_num
      order by c.updated_at desc limit 1;
    if v_prior is null then
      select rsr.salary into v_prior from public.roster_spot_removals rsr
        where rsr.profile_id = p_profile and rsr.season_id = p_season
        order by rsr.removed_at desc limit 1;
    end if;
    return greatest(coalesce(v_prior, 750000), 750000);
  end if;
  return greatest(coalesce(p_salary, 750000), 750000);
end $f$;

create or replace function public._open_replacement_signing(p_season uuid, p_team uuid) returns uuid
  language sql stable set search_path to '' as $f$
  /* v4.18: the club's oldest open replacement allowance (Rule 2.4), moved from sign_free_agent unchanged. v4.16b,
     v4.17: only an allowance granted at or after the free-agent close in force counts; one granted before a later
     extension of that close lapses at the new close. During an office lock (override 'locked') every allowance counts.
     The site's count (CG.lg._replacements, part_live.js) applies the same test. */
  select x.id from public.replacement_signings x join public.seasons s on s.id = x.season_id
   where x.season_id = p_season and x.team_id = p_team and x.used_at is null
     and (s.moves_lock_override = 'locked' or x.created_at >= public.fa_moves_close_at(p_season))
   order by x.created_at limit 1
$f$;
revoke all on function public._fa_signing_salary(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public._open_replacement_signing(uuid, uuid) from public, anon, authenticated;

do $p$
declare
  v_fn regprocedure[] := array['public.sign_free_agent(uuid,bigint,uuid)', 'public.sign_free_agent(uuid,bigint,uuid)',
    'public._mgmt_describe(uuid,text,jsonb)']::regprocedure[];
  v_a text[] := array[
-- 1 sign_free_agent: the allowance
$q$    update public.replacement_signings rsg set used_at = now(), used_registration_id = p_registration
     where rsg.id = (select x.id from public.replacement_signings x
                      where x.season_id = v_season.id and x.team_id = v_team.id and x.used_at is null
                        /* v4.16b, v4.17: only an allowance granted at or after the free-agent close in force counts;
                           one granted before a later extension of that close lapses at the new close (the club could
                           sign freely until then). During an office lock (override 'locked') every allowance counts.
                           The site's count in part_live.js applies the same test (Rule 2.4). */
                        and (v_season.moves_lock_override = 'locked'
                             or x.created_at >= public.fa_moves_close_at(v_season.id))
                      order by x.created_at limit 1);$q$,
-- 2 sign_free_agent: the salary
$q$  if public.season_is_basic(v_season.id) then
    select c.salary into v_prior from public.contracts c
      where c.profile_id = v_reg.profile_id and not coalesce(c.is_manager,false)
        and c.start_season <= v_season.number and c.end_season >= v_season.number
      order by c.updated_at desc limit 1;
    if v_prior is null then
      select rsr.salary into v_prior from public.roster_spot_removals rsr
        where rsr.profile_id = v_reg.profile_id and rsr.season_id = v_season.id
        order by rsr.removed_at desc limit 1;
    end if;
    v_salary := greatest(coalesce(v_prior, 750000), 750000);
  else
    v_salary := greatest(coalesce(p_salary, 750000), 750000);
  end if;
$q$,
-- 3 _mgmt_describe: the missing case
$q$  when 'respond_offer', 'respond_extension' then$q$];
  v_b text[] := array[
-- 1
$q$    /* v4.18: the open allowance has one definition, public._open_replacement_signing (the approval queue reads it too);
       used_at is null is re-checked under the row lock, so two signings at once cannot spend one allowance */
    update public.replacement_signings rsg set used_at = now(), used_registration_id = p_registration
     where rsg.id = public._open_replacement_signing(v_season.id, v_team.id) and rsg.used_at is null;$q$,
-- 2
$q$  /* v4.18: the signing salary has one definition, public._fa_signing_salary (the approval queue reads it too) */
  v_salary := public._fa_signing_salary(v_season.id, v_reg.profile_id, p_salary);
$q$,
-- 3
$q$  when 'sign_free_agent' then
    /* v4.18: a queued signing is described from the registration, never the client's text, with the salary
       sign_free_agent will charge (public._fa_signing_salary). Past the free-agent close only a replacement signing is
       possible (Rule 2.4), so a club without one is told when it asks, not when the Owner approves. */
    select r.profile_id into v_prof from public.season_registrations r
     where r.id = (a->>'p_registration')::uuid and r.season_id = v_season and r.status <> 'declined';
    if v_prof is null then raise exception 'That player is not registered for this season.'; end if;
    if exists (select 1 from public.roster_spots rs where rs.season_id = v_season and rs.profile_id = v_prof) then
      raise exception 'That player is already on a roster.'; end if;
    if public.fa_moves_closed(v_season) and public._open_replacement_signing(v_season, p_team) is null then
      raise exception 'Rule 2.4: free-agent signings have closed for this season. A club may sign only to replace a player whose sign-up was removed after they closed.';
    end if;
    v_sal := public._fa_signing_salary(v_season, v_prof, (a->>'p_salary')::bigint);
    o_summary := 'sign ' || public._mgmt_name(v_prof) || ' at ' || public._mgmt_money(v_sal) || ' to the end of the season'
                 || case when public.fa_moves_closed(v_season) then ', using the club''s replacement signing (Rule 2.4)' else '' end;
    o_target := 'sign:' || v_prof;
  when 'respond_offer', 'respond_extension' then$q$];
  v_def text; v_n int; i int;
begin
  for i in 1 .. array_length(v_fn, 1) loop
    v_def := pg_get_functiondef(v_fn[i]);
    v_n := (length(v_def) - length(replace(v_def, v_a[i], ''))) / length(v_a[i]);
    if v_n <> 1 then raise exception 'patch % (%): anchor found % times', i, v_fn[i], v_n; end if;
    execute replace(v_def, v_a[i], v_b[i]);
  end loop;

  -- self-checks
  if position('public._fa_signing_salary(v_season.id, v_reg.profile_id, p_salary)' in pg_get_functiondef('public.sign_free_agent(uuid,bigint,uuid)'::regprocedure)) = 0
     or position('public._open_replacement_signing(v_season.id, v_team.id) and rsg.used_at is null' in pg_get_functiondef('public.sign_free_agent(uuid,bigint,uuid)'::regprocedure)) = 0
     or position('select c.salary into v_prior' in pg_get_functiondef('public.sign_free_agent(uuid,bigint,uuid)'::regprocedure)) > 0 then
    raise exception 'self-check: sign_free_agent still carries its own salary or allowance rule';
  end if;
  if position($s$when 'sign_free_agent' then$s$ in pg_get_functiondef('public._mgmt_describe(uuid,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'self-check: _mgmt_describe has no sign_free_agent case';
  end if;
  if has_function_privilege('anon', 'public._fa_signing_salary(uuid,uuid,bigint)', 'EXECUTE') or has_function_privilege('authenticated', 'public._fa_signing_salary(uuid,uuid,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public._open_replacement_signing(uuid,uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public._open_replacement_signing(uuid,uuid)', 'EXECUTE') then
    raise exception 'self-check: a helper is callable by an API role';
  end if;
end $p$;
