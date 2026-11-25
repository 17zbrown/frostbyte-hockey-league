-- v463 (DRAFT, 2026-11-24; apply at the flip, T+15, together with the staff powers record
-- (sql/2026-11-24-s2-staff-powers-*.sql), never before): every staff member and every commissioner votes on owner, staff
-- and front-office (GM and AGM) applications, and more than half of all of them decides one.
--
-- The rulings (memory s2-staffing-model.md and season2-format-rulings.md, league law):
--  * 2026-11-23: "Every staff member votes on owner, staff and front-office (GM/AGM) applications, 50% + 1." Commissioners
--    vote too ("13 voters, 7 to pass"), and keep deciding an application alone ("Decide now") while also voting
--    (override_application_decision, unchanged). The ruled 13 counted a staffer banned since 2026-10-05; the electorate
--    excludes banned and staff-suspended members (main session, 2026-11-24), so on 2026-11-24 it is 11 (8 staff and 3
--    commissioners) and 6 pass a vote. The commissioner is asked to confirm the figure.
--  * 2026-11-23 (later): all-staff application voting switches "when the new site is posted". Owner applications are
--    never filled automatically, so the five-reviewer tally stands until then; the Dec 5 owner decisions come first.
--
-- What changes: is_app_reviewer(uid) becomes the staff electorate (public.is_staff_voter, the ONE definition the committee
-- seat vote already uses, the committees record), and app_reviewer_count() its size (public.staff_voter_count). Both move to an
-- empty search_path. resolve_application_if_ready's "50% + 1 of every reviewer" (v3.68, Q47) then follows by itself, as do
-- the three ballot write policies, waitlist_admit, waitlist_application and waitlist_remove (the waitlist is retired after
-- the flip by its own record, and holds no row). The owner_app_read and staff_app_read policies read "every voter" through
-- is_app_reviewer instead of "staff but not Media-only staff": a voter must be able to read what they vote on.
-- notify_mgmt_application, which bells the staff about a GM or AGM nomination from its own department loop (the
-- department bell the staff powers record opens never reached it), bells every voter on the staff instead, and its note to the nominee stops naming the Review
-- Board: two patch pairs by exact anchor, undone by the reverse the same way.
--
-- What does not change: ballots already cast stay and count (every reviewer is a voter); nothing is decided by this record
-- (it calls no resolve: the need rises from 3 to 6, so no pending application can newly pass, and one that reached the
-- old majority while the window was closed is decided by the office, not by this switch); the commissioner's own decision;
-- Season 1 records.
--
-- Outside the database, at the same flip (not in this record): jobs/discord-scheduler.js:628 builds the daily vote nudge;
-- since the Discord stream's flip part (released with this record in v4.63) it asks public.is_app_reviewer, so it follows
-- this record, and its reverse, with no deploy. The classic site counts reviewers in the browser
-- (src/live/part_live.js:5746 and 5760) and still names the department: after v4.63 it serves only the Season 1 fallback
-- site, which is never used for staff work.
--
-- Apply order at the flip (one owner per function, so the three records compose): 1. the staff powers record
-- (sql/2026-11-24-s2-staff-powers-v463.sql), 2. this record, 3. sql/2026-11-24-s2-staff-copy-v463.sql (it refuses to run
-- before the other two). Reverse in the opposite order: the copy reverse, this reverse, then the staff powers reverse.
-- This record owns is_app_reviewer, app_reviewer_count and notify_mgmt_application; no other flip record patches them.
--
-- Reverse: sql/2026-11-24-s2-all-staff-voting-v463.reverse.sql restores both functions, both policies and the nomination
-- bell byte for byte.
-- Rehearsal: sql/2026-11-24-s2-all-staff-voting-v463.rehearsal.sql (forward, cases, reverse, proof of the restore).
-- Prerequisite: the committees record (sql/2026-11-24-s2-committees-*.sql) is live.

do $pre$
begin
  if to_regprocedure('public.is_staff_voter(uuid)') is null or to_regprocedure('public.staff_voter_count()') is null then
    raise exception 'v463 all-staff voting: the committees record (is_staff_voter, staff_voter_count) must be applied first';
  end if;
  if pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure) <> $old$CREATE OR REPLACE FUNCTION public.is_app_reviewer(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.profiles
    where id = p_uid and role in ('staff','commissioner') and 'applications' = any(coalesce(departments, '{}')));
$function$
$old$
     or pg_get_functiondef('public.app_reviewer_count()'::regprocedure) <> $old$CREATE OR REPLACE FUNCTION public.app_reviewer_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.profiles
    where role in ('staff','commissioner') and 'applications' = any(coalesce(departments, '{}'));
$function$
$old$ then
    raise exception 'v463 all-staff voting: is_app_reviewer or app_reviewer_count changed since 2026-11-24, so the reverse would not restore them';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
        and ((tablename = 'owner_applications' and policyname = 'owner_app_read') or (tablename = 'staff_applications' and policyname = 'staff_app_read'))
        and qual = '((profile_id = ( SELECT auth.uid() AS uid)) OR (is_staff() AND (NOT is_media_only_staff(( SELECT auth.uid() AS uid)))) OR is_commissioner())') <> 2 then
    raise exception 'v463 all-staff voting: owner_app_read or staff_app_read changed since 2026-11-24';
  end if;
  if to_regprocedure('public.notify_mgmt_application()') is null then
    raise exception 'v463 all-staff voting: notify_mgmt_application is missing';
  end if;
end $pre$;

create or replace function public.is_app_reviewer(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  /* v463 (commissioner, 2026-11-23): every staff member and every commissioner votes on owner, staff and front-office
     applications. The reviewer set IS the staff electorate (is_staff_voter), no longer the applications department. */
  select public.is_staff_voter(p_uid);
$function$;

create or replace function public.app_reviewer_count()
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  /* v463: how many vote on an application: the whole staff electorate (staff_voter_count) */
  select public.staff_voter_count();
$function$;

alter policy owner_app_read on public.owner_applications
  using ((profile_id = (select auth.uid())) or public.is_app_reviewer((select auth.uid())));
alter policy staff_app_read on public.staff_applications
  using ((profile_id = (select auth.uid())) or public.is_app_reviewer((select auth.uid())));

-- the GM and AGM nomination bell: every voter on the staff, by exact anchor (the reverse carries the same pairs)
do $mgmt$
declare r record; v_def text; n int;
begin
  for r in select * from (values
-- >>> patch pairs
    (1, $o$           where role = 'staff'
             and 'applications' = any(coalesce(departments, '{}'))
             and id <> new.submitted_by and id is distinct from new.nominee_id
$o$, $n$           where role = 'staff'
             and public.is_staff_voter(id)   /* v463 (commissioner, 2026-11-23): every staff member votes on GM and AGM nominations, so every voter on the staff is told */
             and id <> new.submitted_by and id is distinct from new.nominee_id
$n$),
    (2, $o$      '. The Review Board votes on the appointment $o$ || chr(8212) || $o$ you''ll be notified of the decision.',
$o$, $n$      '. The league staff vote on the appointment, and you will be told the decision.',   /* v463: the whole staff votes from the flip */
$n$)
-- <<< patch pairs
  ) as x(ord, old_text, new_text) order by x.ord loop
    v_def := pg_get_functiondef('public.notify_mgmt_application()'::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then raise exception 'v463 all-staff voting: notify_mgmt_application anchor % matched % times', r.ord, n; end if;
    execute replace(v_def, r.old_text, r.new_text);
    v_def := pg_get_functiondef('public.notify_mgmt_application()'::regprocedure);
    if (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text) <> 1 then
      raise exception 'v463 all-staff voting: notify_mgmt_application patch % did not land once', r.ord;
    end if;
  end loop;
end $mgmt$;

do $chk$
declare v_bad int;
begin
  if not exists (select 1 from pg_proc p where p.oid = 'public.is_app_reviewer(uuid)'::regprocedure and p.prosecdef
                   and 'search_path=""' = any(coalesce(p.proconfig, '{}'::text[])))
     or not exists (select 1 from pg_proc p where p.oid = 'public.app_reviewer_count()'::regprocedure and p.prosecdef
                   and 'search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))) then
    raise exception 'v463 all-staff voting: a reviewer function is not SECURITY DEFINER with an empty search_path';
  end if;
  /* CREATE OR REPLACE keeps the grants: the ballot policies call is_app_reviewer as anon too; the count stays internal */
  if not has_function_privilege('anon', 'public.is_app_reviewer(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_app_reviewer(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.app_reviewer_count()', 'EXECUTE')
     or has_function_privilege('anon', 'public.app_reviewer_count()', 'EXECUTE') then
    raise exception 'v463 all-staff voting: the reviewer functions lost or gained a grant';
  end if;
  if public.app_reviewer_count() <> public.staff_voter_count() then
    raise exception 'v463 all-staff voting: app_reviewer_count is not the staff electorate';
  end if;
  select count(*) into v_bad from public.profiles p where public.is_app_reviewer(p.id) is distinct from public.is_staff_voter(p.id);
  if v_bad <> 0 then raise exception 'v463 all-staff voting: % members are reviewers but not voters, or the reverse', v_bad; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
        and ((tablename = 'owner_applications' and policyname = 'owner_app_read') or (tablename = 'staff_applications' and policyname = 'staff_app_read'))
        and position('is_app_reviewer' in qual) > 0 and position('is_media_only_staff' in qual) = 0) <> 2 then
    raise exception 'v463 all-staff voting: an application read policy does not read every voter';
  end if;
  if position('public.is_staff_voter(id)' in pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)) = 0
     or position('''applications'' = any' in pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)) > 0
     or position('Review Board' in pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)) > 0
     or position('perform public.notify_commissioners(array[new.submitted_by]' in pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)) = 0 then
    raise exception 'v463 all-staff voting: the nomination bell does not reach every voter, or lost the commissioners';
  end if;
  raise notice 'v463 all-staff voting: % voters, % to pass; pending: % owner, % staff, % front office',
    public.app_reviewer_count(), public.app_reviewer_count() / 2 + 1,
    (select count(*) from public.owner_applications where status = 'pending'),
    (select count(*) from public.staff_applications where status = 'pending'),
    (select count(*) from public.management_applications where status = 'pending');
end $chk$;
-- Applied as migration v463b_s2_all_staff_voting on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
