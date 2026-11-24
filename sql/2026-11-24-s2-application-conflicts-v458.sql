-- v4.58 (2026-11-24): Rule 2.7 at the application door. A commissioner or staff member cannot file an owner application,
-- and a club's Owner, General Manager or Assistant General Manager cannot file a staff application, until they step down
-- from the conflicting seat or are removed from it.
--
-- Commissioner, 2026-11-23: "Staffers cannot submit owner applications and team managers cannot submit staff
-- applications until they remove themselves or are removed from their seat." The ruling replaces "they choose" and the
-- conditional removal of the staff role from a staffer granted a club (the earlier Season 2 plan).
--
-- Why at the door: until now the conflict was caught only at the decision. The insert policies (owner_app_insert,
-- staff_app_insert) check only profile_id = auth.uid(), and guard_app_insert reads the decision fields only. The site's
-- owner form refuses a commissioner or staffer, but a direct API insert or upsert got past it; the staff form let a seat
-- holder file for Media alone; and at the decision _owner_app_autoplace and apply_application_decision only refuse to
-- seat or grant, after the reviewers have voted on an application the applicant was never allowed to file.
--
-- What is checked, and when:
--  1. owner_applications: the applicant's profiles.role is 'staff' or 'commissioner'. staff_applications: the applicant
--     holds a club seat, by public.holds_club_seat (teams.owner_profile_id, gm_profile_id, agm_profile_id), the one
--     definition apply_application_decision and waitlist_admit already use.
--  2. On every INSERT. The site files and saves through an upsert, and Postgres runs BEFORE INSERT triggers before it
--     looks for the conflicting row, so a save of an existing application is checked here too: a member who has since
--     joined the office (or taken a seat) cannot save changes to a pending application. They may still withdraw it, and
--     the decision doors still refuse to seat or grant them.
--  3. On an UPDATE only when the row ends pending and either it was not pending before (a withdrawn or denied
--     application filed again) or it moved to another member. Same trigger condition as guard_owner_app_signed_up (v3.99).
--     A decided Season 1 row, a waitlisted row, or a plain UPDATE of a pending row is never checked, so already filed
--     applications are left alone. None conflicts today (read 2026-11-23: 0 pending owner applications by staff or
--     commissioners, 0 pending staff applications, 0 seated clubs); the self-check below reports the count at apply time.
--  4. The check reads the applicant (new.profile_id), never the caller: a commissioner filing their own owner application
--     is refused like anyone else, although is_commissioner() passes every other application guard.
--  5. Only the league office's own doors pass, under app.app_decide or app.app_award (the flags guard_app_insert and
--     guard_owner_app_one_edit honor), so a deliberate office correction is never blocked. No client can set them.
--  6. No Media exception and no role_conflict_exemptions bypass. Season 2 has no Media role (commissioner, 2026-10-22:
--     "we will not have that role next season"), the ruling names no exception, and the Season 1 grandfathering ends at
--     the rollover (start_next_season deletes the three exemption rows).
--
-- Trigger order: Postgres fires a table's BEFORE triggers by name. guard_owner_app_role_conflict and
-- guard_staff_app_role_conflict sort after the decision guards (guard_owner_app_decision, guard_staff_app_decision), so
-- they see the status those guards settled on (an applicant's write never re-pends a waitlisted application), and before
-- zz_stamp_*_filed_at, which stamps only what survives. On owner_applications they also sort after
-- ab_guard_owner_app_signed_up, so a member who is not signed up hears "sign up first" before this.
--
-- Not Season-gated: staff applications have no season, Season 1 owner applications closed on Sep 10, and the ruling binds
-- every application filed from now on. Nothing here posts to Discord or writes a row. No rulebook text in this record:
-- live Rule 2.7 still carries the Media exception and "is not admitted" wording; the main session owns that edit.
--
-- Rehearsal: sql/2026-11-24-s2-application-conflicts-v458.rehearsal.sql (run by the main session; results recorded at the
-- end of this file).

do $pre$
begin
  if to_regprocedure('public.holds_club_seat(uuid)') is null then
    raise exception 'v4.58 application conflicts: public.holds_club_seat(uuid) is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.owner_applications'::regclass and tgname = 'guard_owner_app_decision')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.staff_applications'::regclass and tgname = 'guard_staff_app_decision') then
    raise exception 'v4.58 application conflicts: the decision guards this trigger must fire after are missing';
  end if;
end $pre$;

create or replace function public.guard_app_role_conflict()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
/* v4.58 (Rule 2.7, commissioner 2026-11-23): "Staffers cannot submit owner applications and team managers cannot submit
   staff applications until they remove themselves or are removed from their seat." Checked on every insert (the site's
   upsert included) and when an application returns to pending or moves to another member. Keyed on the applicant, never
   the caller. Only the office's doors (app.app_decide / app.app_award) pass. No Media exception: Season 2 has no Media
   role. */
declare v_role text;
begin
  if coalesce(current_setting('app.app_decide', true), '') = 'on'
     or coalesce(current_setting('app.app_award', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and not (new.status = 'pending'
       and (old.status is distinct from 'pending' or new.profile_id is distinct from old.profile_id)) then
    return new;   -- already filed: a decided, waitlisted or withdrawn row, or a pending one saved in place
  end if;
  if tg_table_name = 'owner_applications' then
    select p.role::text into v_role from public.profiles p where p.id = new.profile_id;
    if v_role = 'commissioner' then
      raise exception 'Commissioners cannot apply to own a club (Rule 2.7). Step down as commissioner first, then apply.'
        using errcode = '42501';
    elsif v_role = 'staff' then
      raise exception 'Members of the league staff cannot apply to own a club (Rule 2.7). Leave the staff first, then apply.'
        using errcode = '42501';
    end if;
  elsif public.holds_club_seat(new.profile_id) then
    raise exception 'Owners, General Managers and Assistant General Managers cannot apply to join the league staff (Rule 2.7). Step down from your club seat first, then apply.'
      using errcode = '42501';
  end if;
  return new;
end $function$;
revoke all on function public.guard_app_role_conflict() from public, anon, authenticated;

drop trigger if exists guard_owner_app_role_conflict on public.owner_applications;
create trigger guard_owner_app_role_conflict before insert or update on public.owner_applications
  for each row execute function public.guard_app_role_conflict();
drop trigger if exists guard_staff_app_role_conflict on public.staff_applications;
create trigger guard_staff_app_role_conflict before insert or update on public.staff_applications
  for each row execute function public.guard_app_role_conflict();

do $chk$
declare v_owner int; v_staff int;
begin
  if not (select prosecdef from pg_proc where oid = 'public.guard_app_role_conflict()'::regprocedure)
     or not ('search_path=""' = any(coalesce((select p.proconfig from pg_proc p where p.oid = 'public.guard_app_role_conflict()'::regprocedure), '{}'::text[]))) then
    raise exception 'v4.58 application conflicts: guard_app_role_conflict must be SECURITY DEFINER with search_path ''''';
  end if;
  if has_function_privilege('anon', 'public.guard_app_role_conflict()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_app_role_conflict()', 'EXECUTE') then
    raise exception 'v4.58 application conflicts: the API roles can execute guard_app_role_conflict';
  end if;
  /* read from the catalog, not pg_get_triggerdef text (which qualifies names by the session's search_path):
     tgtype 23 = ROW (1) + BEFORE (2) + INSERT (4) + UPDATE (16); no column list, no WHEN, enabled */
  if (select count(*) from pg_trigger
       where (tgrelid, tgname) in (('public.owner_applications'::regclass, 'guard_owner_app_role_conflict'),
                                   ('public.staff_applications'::regclass, 'guard_staff_app_role_conflict'))
         and tgfoid = 'public.guard_app_role_conflict()'::regprocedure and tgtype = 23 and tgenabled = 'O'
         and tgqual is null and tgattr = ''::int2vector) <> 2 then
    raise exception 'v4.58 application conflicts: a trigger is missing, disabled or not BEFORE INSERT OR UPDATE FOR EACH ROW';
  end if;
  /* the order the header relies on: after the decision guard (and the signed-up guard), before the filed_at stamp */
  if not ('guard_owner_app_role_conflict' collate "C" > 'guard_owner_app_decision' collate "C"
          and 'guard_owner_app_role_conflict' collate "C" > 'ab_guard_owner_app_signed_up' collate "C"
          and 'guard_owner_app_role_conflict' collate "C" < 'zz_stamp_owner_app_filed_at' collate "C"
          and 'guard_staff_app_role_conflict' collate "C" > 'guard_staff_app_decision' collate "C"
          and 'guard_staff_app_role_conflict' collate "C" < 'zz_stamp_staff_app_filed_at' collate "C")
     or not exists (select 1 from pg_trigger where tgrelid = 'public.owner_applications'::regclass and tgname = 'zz_stamp_owner_app_filed_at')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.staff_applications'::regclass and tgname = 'zz_stamp_staff_app_filed_at') then
    raise exception 'v4.58 application conflicts: the trigger order changed';
  end if;
  /* already filed applications are left alone; report any that conflict so the office can sort them out by hand */
  select count(*) into v_owner from public.owner_applications oa join public.profiles p on p.id = oa.profile_id
   where oa.status in ('pending', 'waitlisted') and p.role::text in ('staff', 'commissioner');
  select count(*) into v_staff from public.staff_applications sa
   where sa.status in ('pending', 'waitlisted') and public.holds_club_seat(sa.profile_id);
  raise notice 'v4.58 application conflicts: already filed and conflicting, left alone: % owner, % staff', v_owner, v_staff;
end $chk$;

/* Rehearsal on production, 2026-11-24 (main session), one transaction rolled back by its closing raise: REHEARSAL OK:
   T0 T1a T1b T2 T3 T4a T4b T5 T6 T7 (already filed and conflicting, left alone: 0 owner, 0 staff), after one fix to the
   self-check (any((select proconfig ...)) parses as a subquery; now any(coalesce((select ...), '{}'))).
   Applied 2026-11-24 as migration v458f_s2_application_conflicts. */
