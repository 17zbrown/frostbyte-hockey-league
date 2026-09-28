-- v3.70: a departure after the deadline can be replaced, and a member who leaves the Discord loses his staff role.
-- Commissioner, 2026-09-28 (answers to the rulebook audit):
--   Q11 (after the movement deadline, may a club fill the spot of a player removed for leaving the Discord?):
--        the club may fill it after the deadline, only once his sign-up is removed.
--   Q13: if a player leaves the Discord and has his sign-up removed, he loses ALL other roles too.
-- Read as: Q11 gives the club ONE signing of a free agent past the deadline for each player whose sign-up is
-- removed after it (by the Rule 1.1 departure sweep, or withdrawn by the league office). Q13 takes the staff role
-- and departments from a member whose sign-up is withdrawn for leaving; a club seat is never lost automatically
-- (the sweep refers seat holders to the office, Rule 2.6), and a commissioner is flagged rather than demoted.

/* ---- Q11: one replacement signing per post-deadline removal ------------------------------------------------ */
create table if not exists public.replacement_signings (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  departed_profile_id uuid,
  reason text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_registration_id uuid
);
alter table public.replacement_signings enable row level security;
drop policy if exists replacement_signings_read on public.replacement_signings;
create policy replacement_signings_read on public.replacement_signings for select to authenticated using (true);
revoke insert, update, delete on public.replacement_signings from anon, authenticated;
grant select on public.replacement_signings to authenticated;

create or replace function public._grant_replacement(p_season uuid, p_team uuid, p_departed uuid, p_reason text)
 returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_name text;
begin
  if p_team is null or not public.moves_locked(p_season) then return; end if;   -- before the deadline, sign as usual
  insert into public.replacement_signings(season_id, team_id, departed_profile_id, reason)
    values (p_season, p_team, p_departed, p_reason);
  select coalesce(nullif(gamertag,''), 'the player') into v_name from public.profiles where id = p_departed;
  perform public.club_notify(p_team, 'roster', 'You may sign a replacement for '||v_name,
    'The movement deadline has passed, but because '||v_name||'''s sign-up was removed ('||p_reason||'), you may sign one free agent to replace him (Rule 2.4). Sign him from the free-agent board in Team HQ.',
    null, 'manager', 'freeagents', null, false);
end $fn$;
revoke all on function public._grant_replacement(uuid, uuid, uuid, text) from public, anon, authenticated;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.sign_free_agent(uuid,bigint)'::regprocedure);
  d := replace(d0,
'  if public.moves_locked(v_season.id) and not public.is_commissioner() then
    raise exception ''Roster moves are locked — the deadline has passed.'';
  end if;',
'  /* v3.70 (Q11): past the deadline a club signs only to replace a player whose sign-up was removed after it,
     one signing per removal (replacement_signings); the allowance is spent by this signing */
  if public.moves_locked(v_season.id) and not public.is_commissioner() then
    update public.replacement_signings rsg set used_at = now(), used_registration_id = p_registration
     where rsg.id = (select x.id from public.replacement_signings x
                      where x.season_id = v_season.id and x.team_id = v_team.id and x.used_at is null
                      order by x.created_at limit 1);
    if not found then
      raise exception ''Roster moves are locked — the deadline has passed.'';
    end if;
  end if;');
  if d = d0 then raise exception 'sign_free_agent: the deadline check was not found'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.sweep_roster_departures(integer)'::regprocedure);
  d := replace(d0,
'      perform public.log_admin_action(''departure_removal'',''profile'',r.profile_id::text,',
'      perform public._grant_replacement(r.season_id, r.team_id, r.profile_id, ''he left the league Discord'');   -- v3.70 (Q11)
      perform public.log_admin_action(''departure_removal'',''profile'',r.profile_id::text,');
  if d = d0 then raise exception 'sweep_roster_departures: the anchor was not found'; end if;
  execute d;
  d0 := pg_get_functiondef('public.office_withdraw_registration(uuid,text)'::regprocedure);
  d := replace(d0,
'  return jsonb_build_object(''ok'', true, ''player'', v_name, ''club'', v_club, ''had_spot'', v_spot);',
'  if v_spot then   -- v3.70 (Q11)
    perform public._grant_replacement(v_reg.season_id, (select id from public.teams where code = v_club), v_reg.profile_id, ''withdrawn by the league office'');
  end if;
  return jsonb_build_object(''ok'', true, ''player'', v_name, ''club'', v_club, ''had_spot'', v_spot);');
  if d = d0 then raise exception 'office_withdraw_registration: the anchor was not found'; end if;
  execute d;
end $mig$;

/* ---- Q13: leaving the Discord takes the staff role with the sign-up ------------------------------------------
   Both departure paths archive the sign-up in season_registration_removals with reason 'left_discord' (the
   sweep of unplaced sign-ups and the rostered-player sweep), so the archive row is the one moment to act on. */
create or replace function public.strip_roles_on_departure()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_role text; v_name text;
begin
  if new.reason <> 'left_discord' then return new; end if;
  select role::text, coalesce(nullif(gamertag,''),'A member') into v_role, v_name from public.profiles where id = new.profile_id;
  if v_role = 'staff' then
    perform set_config('app.role_grant', 'on', true);
    update public.profiles set role = 'member', departments = '{}' where id = new.profile_id;
    perform set_config('app.role_grant', '', true);
    perform public.notify_commissioners(null, 'role', v_name||' is no longer league staff',
      v_name||' left the league Discord and his sign-up was withdrawn, so his staff role and departments were removed with it (Rule 1.1). Restore them under Users & roles if he returns.',
      'admin', null);
  elsif v_role = 'commissioner' then
    perform public.notify_commissioners(null, 'flag', v_name||' left the league Discord',
      v_name||' is a commissioner and his sign-up was withdrawn for leaving the Discord. A commissioner''s role is never removed automatically; decide it under Users & roles.',
      'admin', null);
  end if;
  return new;
end $fn$;
revoke all on function public.strip_roles_on_departure() from public, anon, authenticated;
drop trigger if exists strip_roles_on_departure_trg on public.season_registration_removals;
create trigger strip_roles_on_departure_trg after insert on public.season_registration_removals
  for each row execute function public.strip_roles_on_departure();

/* REHEARSAL (2026-09-28, one transaction on the live database, rolled back by a closing raise):
   Two SEA camp players were made free agents by office removal (v3.66). Season 1's movement lock was then forced
   on. The office withdrew a DAL camp player after the deadline: DAL got one replacement signing and was told. DAL's
   GM signed one of the free agents past the deadline (Plugzyyyyyyyyyyyy to DAL), spending the allowance; a second
   signing was refused, "Roster moves are locked". A staffer's left_discord removal row took his role (member) and
   departments (none) and told the commissioners; the commissioner's own row flagged him and left his role alone.
   Result: REHEARSAL OK. Applied as migration v370_departures. */
