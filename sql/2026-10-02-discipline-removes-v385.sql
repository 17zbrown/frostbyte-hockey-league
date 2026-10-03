-- v3.85: a suspension for the rest of a season or longer, or a ban, removes the member from his club and withdraws his
-- sign-ups. Commissioner, 2026-10-02: "If a player is suspended for the season, or more, or banned, their signup should
-- be removed and they should be removed from their roster."
-- Suspensions counted in games or to a date are unchanged (the player stays, locked in place, Rule 7.2); so is a
-- formal warning, and a suspension from staff duties alone.
-- One door, public._remove_for_discipline, for both: it vacates any front-office seat he holds (Rule 2.6; else
-- protect_manager_spot keeps the spot), releases every roster spot he holds in a season not yet completed through the
-- office's release flags (as office_withdraw_registration does: app.office_removal / app.mgmt_approved /
-- app.roster_reason, so the movement deadline and the approval queue do not refuse a ruling), grants his club a
-- replacement signing (_grant_replacement, Rule 2.4), ends his contract, archives and deletes every sign-up for a season
-- not yet completed (season_registration_removals), tells him, and records it. Called by:
--   * suspension_removes_for_season, AFTER INSERT OR UPDATE OF mode, status ON suspensions: a running 'seasons'
--     suspension that takes his play (scope play or both), including the automatic second-suspension conversion;
--   * ban_player, before its own clean-up (which then finds nothing left).
-- A banned member may no longer register (guard_registration_suspended); a suspended one already could not, for a
-- season the suspension covers. Lifting a suspension or a ban restores nothing by itself: the league office reinstates
-- a roster spot (reinstate_roster_spot) or a sign-up if it decides to.
-- Applied at once to the members it already covers: TSNGURR (suspended through Season 2) and Lekkerimaki1748 (banned)
-- each still held a sign-up.

create or replace function public._remove_for_discipline(p_profile uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path to 'public' as $f$
declare r record; v_name text; v_n int; v_seats text[] := '{}'; v_spots text[] := '{}'; v_regs text[] := '{}'; v_reg public.season_registrations;
begin
  if p_profile is null then return null; end if;
  select coalesce(nullif(gamertag,''), display_name, 'A player') into v_name from public.profiles where id = p_profile;

  /* 1. his front-office seats first (Rule 2.6); a manager's spot cannot be released while he holds one */
  for r in select id, code, owner_profile_id = p_profile is_o, gm_profile_id = p_profile is_g, agm_profile_id = p_profile is_a
             from public.teams where p_profile in (owner_profile_id, gm_profile_id, agm_profile_id) loop
    if r.is_o then update public.teams set owner_profile_id = null where id = r.id; v_seats := v_seats || (r.code || ' Owner'); end if;
    if r.is_g then update public.teams set gm_profile_id = null where id = r.id; v_seats := v_seats || (r.code || ' GM'); end if;
    if r.is_a then update public.teams set agm_profile_id = null where id = r.id; v_seats := v_seats || (r.code || ' AGM'); end if;
  end loop;

  /* 2. every roster spot in a season not yet completed, through the office's release flags */
  for r in select rs.id, rs.season_id, rs.team_id, t.code
             from public.roster_spots rs join public.teams t on t.id = rs.team_id join public.seasons s on s.id = rs.season_id
            where rs.profile_id = p_profile and s.status::text <> 'completed' loop
    perform set_config('app.roster_reason', p_reason, true);
    perform set_config('app.office_removal', '1', true);
    perform set_config('app.mgmt_approved', r.team_id::text, true);
    delete from public.roster_spots where id = r.id;
    get diagnostics v_n = row_count;
    perform set_config('app.mgmt_approved', '', true);
    perform set_config('app.office_removal', '', true);
    perform set_config('app.roster_reason', '', true);
    if v_n = 0 then raise exception 'the roster spot of % at % could not be released', v_name, r.code; end if;
    v_spots := v_spots || r.code;
    perform public._grant_replacement(r.season_id, r.team_id, p_profile, p_reason);
  end loop;

  /* 3. his contract ends with the spot */
  update public.contracts set status = 'expired', team_id = null, updated_at = now() where profile_id = p_profile and status = 'active';
  update public.contracts set status = 'voided', updated_at = now() where profile_id = p_profile and status = 'signed';

  /* 4. every sign-up for a season not yet completed, archived before it goes */
  for r in select sr.id, s.name sname from public.season_registrations sr join public.seasons s on s.id = sr.season_id
            where sr.profile_id = p_profile and s.status::text <> 'completed' loop
    select * into v_reg from public.season_registrations where id = r.id;
    insert into public.season_registration_removals (registration_id, profile_id, season_id, gamertag, reason, registration)
      values (v_reg.id, v_reg.profile_id, v_reg.season_id, v_name, p_reason, to_jsonb(v_reg));
    delete from public.season_registrations where id = r.id;
    v_regs := v_regs || coalesce(r.sname, 'a season');
  end loop;

  if cardinality(v_regs) > 0 or cardinality(v_spots) > 0 then
    perform public.create_notification(p_profile, 'role', 'Removed from the league''s rosters and sign-ups',
      'Because you were ' || p_reason || ', the league office removed you'
      || case when cardinality(v_spots) > 0 then ' from ' || array_to_string(v_spots, ', ') || '''s roster' else '' end
      || case when cardinality(v_regs) > 0 then case when cardinality(v_spots) > 0 then ' and withdrew' else ' and withdrew' end
         || ' your sign-up for ' || array_to_string(v_regs, ', ') else '' end || ' (Rule 7.2).', null, null);
  end if;
  perform public.log_admin_action('discipline_removal', 'profile', p_profile::text,
    jsonb_build_object('reason', p_reason, 'seats', v_seats, 'rosters', v_spots, 'signups', v_regs));
  return jsonb_build_object('seats', v_seats, 'rosters', v_spots, 'signups', v_regs);
end $f$;
revoke all on function public._remove_for_discipline(uuid, text) from public, anon, authenticated;

create or replace function public.suspension_removes_for_season() returns trigger
language plpgsql security definer set search_path = '' as $f$
begin
  if new.mode = 'seasons' and coalesce(new.scope, 'play') in ('play', 'both') and new.status = 'active'
     and (tg_op = 'INSERT' or old.mode is distinct from new.mode or old.status is distinct from new.status) then
    perform public._remove_for_discipline(new.profile_id, 'suspended for the season');
  end if;
  return null;
end $f$;
revoke all on function public.suspension_removes_for_season() from public, anon, authenticated;
drop trigger if exists suspension_removes_for_season_trg on public.suspensions;
create trigger suspension_removes_for_season_trg after insert or update of mode, status on public.suspensions
  for each row execute function public.suspension_removes_for_season();

do $mig$
declare r record; d0 text; d text;
begin
  for r in select * from (values
      ('ban_player',
       $a$if p_profile is null then raise exception 'No player specified.'; end if;$a$,
       $b$if p_profile is null then raise exception 'No player specified.'; end if;
  /* v3.85 (Rule 7.2): an expelled member leaves every roster and every sign-up for a season not yet completed */
  perform public._remove_for_discipline(p_profile, 'banned');$b$),
      ('guard_registration_suspended',
       $a$begin
  select number into v_num from seasons where id = new.season_id;$a$,
       $b$begin
  /* v3.85: an expelled member does not sign up (Rule 7.2) */
  if public.is_banned(new.profile_id) then
    raise exception 'A member banned from the league cannot register (Rule 7.2).' using errcode = '42501';
  end if;
  select number into v_num from seasons where id = new.season_id;$b$),
      ('notify_roster_remove',
       $a$when 'banned' then 'Removed (banned): ' || v_name$a$,
       $b$when 'banned' then 'Removed (banned): ' || v_name when 'suspended for the season' then 'Removed (suspended for the season): ' || v_name$b$),
      ('notify_roster_remove',
       $a$when 'banned' then 'was removed from the roster by the league office (banned).'$a$,
       $b$when 'banned' then 'was removed from the roster by the league office (banned).' when 'suspended for the season' then 'was removed from the roster by the league office: suspended for the rest of the season (Rule 7.2). Your club may sign a replacement (Rule 2.4).'$b$)
    ) v(fn, old, new)
  loop
    select pg_get_functiondef(p.oid) into d0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if d0 is null then raise exception '% not found', r.fn; end if;
    if (length(d0) - length(replace(d0, r.old, ''))) / length(r.old) <> 1 then
      raise exception '%: the text to patch is not there exactly once', r.fn; end if;
    d := replace(d0, r.old, r.new);
    execute d;
  end loop;
end $mig$;

/* the members it already covers */
do $now$
declare r record;
begin
  for r in select distinct s.profile_id from public.suspensions s
            where s.mode = 'seasons' and s.status = 'active' and coalesce(s.scope, 'play') in ('play', 'both')
           union select p.id from public.profiles p where p.banned loop
    perform public._remove_for_discipline(r.profile_id, case when public.is_banned(r.profile_id) then 'banned' else 'suspended for the season' end);
  end loop;
end $now$;

/* REHEARSED 2026-10-02 in one rolled-back transaction: "REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7".
     T1 the two members already covered lose their sign-ups, archived;
     T2 a rest-of-season suspension (as the commissioner, through suspend_player): off the roster, contract expired, sign-up
        withdrawn, spot archived, club told ("Removed (suspended for the season)");
     T3 a seat holder (an AGM): the seat goes first, then the spot;
     T4 a three-game suspension removes nothing;
     T5 a ban: off the roster and every sign-up gone, and a banned member's new sign-up is refused;
     T6 a staff-duties suspension removes nothing;  T7 the door is no API role's.
   APPLIED 2026-10-02 as migration v385_discipline_removes. Afterwards: TSNGURR's and Lekkerimaki1748's sign-ups withdrawn
   (archived in season_registration_removals); no banned or season-suspended member holds a sign-up or a roster spot. */
