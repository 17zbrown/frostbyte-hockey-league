-- Rehearsal for sql/2026-11-24-s2-all-staff-voting-v463.sql AND its reverse, sql/2026-11-24-s2-all-staff-voting-v463.reverse.sql.
-- The main session runs it on production as ONE transaction that ends in an uncaught raise, so everything rolls back
-- (CLAUDE.md, Database change protocol step 2). Agents never run it. It carries both texts byte for byte
-- (tools/s2-all-staff-voting-v463.test.cjs pins them).
--
-- Prerequisites: the committees record (sql/2026-11-24-s2-committees-*.sql) is live, or its text is pasted right after
-- "begin;" (the first block refuses to run without is_staff_voter). Nothing else.
--
-- After it (outside the transaction), these must all return nothing (row counts move on their own on production):
--   select id from public.staff_applications where pitch = 'Rehearsal pitch.';
--   select n.id from public.notifications n where n.title = 'New General Manager nomination'
--     and not exists (select 1 from public.management_applications m where n.link_param = 'id=' || m.id::text || '&type=management');
--   select 1 where position('public.is_staff_voter(p_uid)' in pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure)) > 0;
--
-- People, picked inside the transaction by id order (no ids in this file): N the first staff voter (is_staff_voter: not
-- banned, not suspended from staff duties) outside the applications department; V the first Media-only staff voter (none
-- may exist: R3 then reports "skipped"). 2026-11-24: N was picked as "staff, not suspended" and was a staffer banned since
-- 2026-10-05, who is rightly not a voter, so R1 failed ("the reviewers are not the staff electorate") while the record's
-- own self-checks passed; N and V now come from the electorate itself. M the first member who is not banned, holds no
-- club seat and has no staff application; O and P the next two such members and T the first club (R6 only: a nomination
-- row on a scratch copy of the table, so no club rule is involved).
-- Cases:
--   R0 the reviewer functions and the application and ballot policies are fingerprinted before anything runs.
--   R1 after the record: every member is a reviewer exactly when they are in the staff electorate, and the count matches.
--   R2 a staffer outside the applications department casts an owner ballot through the table door (RLS) and retracts it.
--   R3 a Media-only staffer reads every owner application (before, they read only their own).
--   R4 the vote: M files a staff application through the table door; one approval short of more than half of ALL
--      voters it stays pending; the next approval grants the staff role (the whole staff and commissioners vote).
--   R6 a GM nomination (O nominates P for T) bells N, who is outside the applications department, and no banned
--      staffer; the nominee's note no longer names the Review Board. The trigger function runs on a temporary copy of
--      management_applications, so the nomination guards (seasons, rosters) are not part of the case.
--   R5 after the reverse: the fingerprint is the one taken in R0 (the nomination bell included), the department count is
--      back, the staffer outside the department is refused an owner ballot again, and a second nomination bells N no
--      more (R5d).

begin;

do $pre$
begin
  if to_regprocedure('public.is_staff_voter(uuid)') is null then
    raise exception 'REHEARSAL CANNOT RUN: the committees record must be live, or its text pasted right after begin';
  end if;
end $pre$;

-- R0 and the people
do $p$
declare v_n uuid; v_v uuid; v_m uuid;
begin
  perform set_config('rh.fp', md5(pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure)
    || pg_get_functiondef('public.app_reviewer_count()'::regprocedure)
    || pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)
    || (select string_agg(x.tablename || ':' || x.policyname || ':' || coalesce(x.qual, '') || ':' || coalesce(x.with_check, ''), '|'
                          order by x.tablename, x.policyname)
          from pg_policies x where x.schemaname = 'public' and x.tablename in ('owner_applications', 'staff_applications', 'application_ballots'))), true);
  perform set_config('rh.count0', public.app_reviewer_count()::text, true);
  perform set_config('rh.oa_total', (select count(*) from public.owner_applications)::text, true);
  select p.id into v_n from public.profiles p where p.role = 'staff' and public.is_staff_voter(p.id)
     and not ('applications' = any(coalesce(p.departments, '{}'::text[]))) order by p.id limit 1;
  select p.id into v_v from public.profiles p where p.role = 'staff' and public.is_staff_voter(p.id) and p.departments = array['media']
   order by p.id limit 1;
  select p.id into v_m from public.profiles p where p.role = 'member' and not coalesce(p.banned, false)
     and not public.holds_club_seat(p.id)
     and not exists (select 1 from public.staff_applications sa where sa.profile_id = p.id) order by p.id limit 1;
  if v_n is null or v_m is null then
    raise exception 'REHEARSAL CANNOT RUN: the people are missing (N %, M %)', v_n is not null, v_m is not null;
  end if;
  perform set_config('rh.o', (select p.id::text from public.profiles p where p.role = 'member' and not p.banned and p.id <> v_m
                                order by p.id limit 1), true);
  perform set_config('rh.p', (select p.id::text from public.profiles p where p.role = 'member' and not p.banned and p.id <> v_m
                                order by p.id offset 1 limit 1), true);
  perform set_config('rh.t', (select t.id::text from public.teams t order by t.id limit 1), true);
  perform set_config('rh.n', v_n::text, true);
  perform set_config('rh.v', coalesce(v_v::text, ''), true);
  perform set_config('rh.m', v_m::text, true);
  perform set_config('rh.voters', (select string_agg(p.id::text, ',' order by p.id) from public.profiles p where public.is_staff_voter(p.id)), true);
  perform set_config('rh.need', (public.staff_voter_count() / 2 + 1)::text, true);
end $p$;

-- >>> record text: sql/2026-11-24-s2-all-staff-voting-v463.sql
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
-- <<< record text

-- R1
do $r1$
begin
  if public.app_reviewer_count() <> public.staff_voter_count()
     or exists (select 1 from public.profiles p where public.is_app_reviewer(p.id) is distinct from public.is_staff_voter(p.id))
     or not public.is_app_reviewer(current_setting('rh.n')::uuid) then
    raise exception 'R1 failed: the reviewers are not the staff electorate';
  end if;
end $r1$;

-- R2 and R3 as API users
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
do $r2$
declare v_id uuid; v_n int;
begin
  insert into public.application_ballots (app_type, application_id, voter_id, vote)
  values ('owner', gen_random_uuid(), current_setting('rh.n')::uuid, 'approve')
  returning id into v_id;
  delete from public.application_ballots where id = v_id and voter_id = current_setting('rh.n')::uuid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'R2 failed: the staffer could not retract their owner ballot'; end if;
end $r2$;
select set_config('request.jwt.claims', json_build_object('sub', coalesce(nullif(current_setting('rh.v'), ''), current_setting('rh.n')), 'role', 'authenticated')::text, true);
select set_config('rh.oa_seen', (select count(*) from public.owner_applications)::text, true);

-- R4: the vote on a staff application
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.m'), 'role', 'authenticated')::text, true);
do $r4a$
declare v_id uuid;
begin
  insert into public.staff_applications (profile_id, pitch, departments)
  values (current_setting('rh.m')::uuid, 'Rehearsal pitch.', array['community'])
  returning id into v_id;
  perform set_config('rh.m_app', v_id::text, true);
end $r4a$;
do $r4b$
declare v text[] := string_to_array(current_setting('rh.voters'), ','); i int; v_need int := current_setting('rh.need')::int;
begin
  for i in 1 .. v_need - 1 loop
    perform set_config('request.jwt.claims', json_build_object('sub', v[i], 'role', 'authenticated')::text, true);
    insert into public.application_ballots (app_type, application_id, voter_id, vote)
    values ('staff', current_setting('rh.m_app')::uuid, v[i]::uuid, 'approve');
  end loop;
end $r4b$;
reset role;
select set_config('request.jwt.claims', '', true);
do $r4c$
begin
  if (select sa.status from public.staff_applications sa where sa.id = current_setting('rh.m_app')::uuid) <> 'pending' then
    raise exception 'R4c failed: decided one approval short of more than half of all voters';
  end if;
end $r4c$;
set local role authenticated;
do $r4d$
declare v text[] := string_to_array(current_setting('rh.voters'), ','); v_need int := current_setting('rh.need')::int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v[v_need], 'role', 'authenticated')::text, true);
  insert into public.application_ballots (app_type, application_id, voter_id, vote)
  values ('staff', current_setting('rh.m_app')::uuid, v[v_need]::uuid, 'approve');
end $r4d$;
reset role;
select set_config('request.jwt.claims', '', true);
do $r4e$
begin
  if (select sa.status from public.staff_applications sa where sa.id = current_setting('rh.m_app')::uuid) <> 'approved'
     or (select p.role::text from public.profiles p where p.id = current_setting('rh.m')::uuid) <> 'staff' then
    raise exception 'R4e failed: more than half of all voters did not grant the staff role';
  end if;
  if nullif(current_setting('rh.v'), '') is not null and current_setting('rh.oa_seen') <> current_setting('rh.oa_total') then
    raise exception 'R3 failed: the Media-only staffer read % of % owner applications', current_setting('rh.oa_seen'), current_setting('rh.oa_total');
  end if;
end $r4e$;

-- R6: a nomination bells every voter on the staff (the trigger function on a temporary copy of the table)
create temp table rh_mgmt (like public.management_applications including defaults) on commit drop;
create trigger rh_mgmt_notify after insert on rh_mgmt for each row execute function public.notify_mgmt_application();
do $r6$
declare v_id uuid;
begin
  insert into rh_mgmt (team_id, role, submitted_by, nominee_id)
  values (current_setting('rh.t')::uuid, 'gm', current_setting('rh.o')::uuid, current_setting('rh.p')::uuid)
  returning id into v_id;
  perform set_config('rh.nom1', v_id::text, true);
  if (select count(*) from public.notifications n where n.profile_id = current_setting('rh.n')::uuid
        and n.title = 'New General Manager nomination' and n.link_param = 'id=' || v_id::text || '&type=management') <> 1
     or exists (select 1 from public.notifications n join public.profiles p on p.id = n.profile_id
                 where p.banned and n.link_param = 'id=' || v_id::text || '&type=management')
     or (select count(*) from public.notifications n where n.profile_id = current_setting('rh.p')::uuid and n.title = 'You were nominated'
           and n.body like '%. The league staff vote on the appointment, and you will be told the decision.') <> 1 then
    raise exception 'R6 failed: the nomination did not bell N once, belled a banned staffer, or the nominee''s note is stale';
  end if;
end $r6$;

-- >>> reverse text: sql/2026-11-24-s2-all-staff-voting-v463.reverse.sql
-- v463 REVERSE (DRAFT, 2026-11-24): undoes sql/2026-11-24-s2-all-staff-voting-v463.sql if the flip is rolled back
-- (PLAN section 8: restore the deploy, git revert, then the reverse migrations in the opposite order of the apply: the
-- staff copy reverse first, this one second, the staff powers reverse last). The applications department reviews again, as it did on 2026-11-24: is_app_reviewer,
-- app_reviewer_count, owner_app_read and staff_app_read come back byte for byte (the definitions below are the ones read
-- from production that day, and the self-checks compare them), and notify_mgmt_application's two patch pairs are undone
-- by exact anchor (the forward record's pairs, byte for byte). Ballots cast while every staffer voted stay on the record;
-- the department tally counts only the reviewers' ones, exactly as before. Nothing is decided by this record.
-- Apply as migration v463_s2_all_staff_voting_reverse. Rehearsed inside sql/2026-11-24-s2-all-staff-voting-v463.rehearsal.sql.

do $pre$
begin
  if position('public.is_staff_voter(p_uid)' in pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure)) = 0
     or position('public.staff_voter_count()' in pg_get_functiondef('public.app_reviewer_count()'::regprocedure)) = 0 then
    raise exception 'v463 all-staff voting reverse: the all-staff vote is not applied, so there is nothing to reverse';
  end if;
end $pre$;

do $rev$
declare
  v_rev text := $old$CREATE OR REPLACE FUNCTION public.is_app_reviewer(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.profiles
    where id = p_uid and role in ('staff','commissioner') and 'applications' = any(coalesce(departments, '{}')));
$function$
$old$;
  v_cnt text := $old$CREATE OR REPLACE FUNCTION public.app_reviewer_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.profiles
    where role in ('staff','commissioner') and 'applications' = any(coalesce(departments, '{}'));
$function$
$old$;
begin
  execute v_rev;
  execute v_cnt;
  if pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure) <> v_rev
     or pg_get_functiondef('public.app_reviewer_count()'::regprocedure) <> v_cnt then
    raise exception 'v463 all-staff voting reverse: a reviewer function did not come back byte for byte';
  end if;
end $rev$;

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
  ) as x(ord, old_text, new_text) order by x.ord desc loop
    v_def := pg_get_functiondef('public.notify_mgmt_application()'::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text);
    if n <> 1 then raise exception 'v463 all-staff voting reverse: notify_mgmt_application patch % stands % times', r.ord, n; end if;
    execute replace(v_def, r.new_text, r.old_text);
    v_def := pg_get_functiondef('public.notify_mgmt_application()'::regprocedure);
    if (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text) <> 1 then
      raise exception 'v463 all-staff voting reverse: notify_mgmt_application anchor % did not come back once', r.ord;
    end if;
  end loop;
end $mgmt$;

alter policy owner_app_read on public.owner_applications
  using ((profile_id = (select auth.uid())) or (public.is_staff() and not public.is_media_only_staff((select auth.uid()))) or public.is_commissioner());
alter policy staff_app_read on public.staff_applications
  using ((profile_id = (select auth.uid())) or (public.is_staff() and not public.is_media_only_staff((select auth.uid()))) or public.is_commissioner());

do $chk$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
        and ((tablename = 'owner_applications' and policyname = 'owner_app_read') or (tablename = 'staff_applications' and policyname = 'staff_app_read'))
        and qual = '((profile_id = ( SELECT auth.uid() AS uid)) OR (is_staff() AND (NOT is_media_only_staff(( SELECT auth.uid() AS uid)))) OR is_commissioner())') <> 2 then
    raise exception 'v463 all-staff voting reverse: an application read policy did not come back byte for byte';
  end if;
  if not has_function_privilege('anon', 'public.is_app_reviewer(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.app_reviewer_count()', 'EXECUTE') then
    raise exception 'v463 all-staff voting reverse: the reviewer functions lost or gained a grant';
  end if;
  raise notice 'v463 all-staff voting reverse: % reviewers (the applications department)', public.app_reviewer_count();
end $chk$;
-- <<< reverse text

-- R5: the reverse restores everything
do $r5$
begin
  if md5(pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure)
    || pg_get_functiondef('public.app_reviewer_count()'::regprocedure)
    || pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)
    || (select string_agg(x.tablename || ':' || x.policyname || ':' || coalesce(x.qual, '') || ':' || coalesce(x.with_check, ''), '|'
                          order by x.tablename, x.policyname)
          from pg_policies x where x.schemaname = 'public' and x.tablename in ('owner_applications', 'staff_applications', 'application_ballots')))
     <> current_setting('rh.fp') then
    raise exception 'R5a failed: the reverse did not restore the functions and policies byte for byte';
  end if;
  if public.app_reviewer_count()::text <> current_setting('rh.count0') then
    raise exception 'R5b failed: the department count is % after the reverse, % before', public.app_reviewer_count(), current_setting('rh.count0');
  end if;
end $r5$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
do $r5c$
begin
  insert into public.application_ballots (app_type, application_id, voter_id, vote)
  values ('owner', gen_random_uuid(), current_setting('rh.n')::uuid, 'approve');
  raise exception 'R5c failed: after the reverse a staffer outside the applications department still cast an owner ballot';
exception when others then
  if sqlerrm not like 'new row violates row-level security policy%' then raise; end if;
end $r5c$;
reset role;
select set_config('request.jwt.claims', '', true);
do $r5d$
declare v_id uuid; v_old int;
begin
  select count(*) into v_old from public.notifications n where n.profile_id = current_setting('rh.p')::uuid
     and n.title = 'You were nominated' and n.body like '%Review Board votes on the appointment%';
  insert into rh_mgmt (team_id, role, submitted_by, nominee_id)
  values (current_setting('rh.t')::uuid, 'gm', current_setting('rh.o')::uuid, current_setting('rh.p')::uuid)
  returning id into v_id;
  if exists (select 1 from public.notifications n where n.profile_id = current_setting('rh.n')::uuid
               and n.link_param = 'id=' || v_id::text || '&type=management')
     or (select count(*) from public.notifications n where n.profile_id = current_setting('rh.p')::uuid
           and n.title = 'You were nominated' and n.body like '%Review Board votes on the appointment%') <> v_old + 1 then
    raise exception 'R5d failed: after the reverse the nomination bell still reaches N, or the nominee''s old note is not back';
  end if;
end $r5d$;

-- the verdict
do $v$
begin
  raise exception 'REHEARSAL OK: R0 R1 R2 R3 % R4c R4e R6 R5a R5b R5c R5d (% voters, % to pass, % department reviewers before and after)',
    case when nullif(current_setting('rh.v'), '') is null then '(skipped: no Media-only staffer)' else '(' || current_setting('rh.oa_seen') || ' of ' || current_setting('rh.oa_total') || ')' end,
    array_length(string_to_array(current_setting('rh.voters'), ','), 1), current_setting('rh.need'), current_setting('rh.count0');
end $v$;
