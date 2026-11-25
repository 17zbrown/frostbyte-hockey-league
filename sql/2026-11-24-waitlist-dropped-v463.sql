-- v463 (DRAFT, 2026-11-24; apply at the flip, once the Season 2 site is live): the application waitlist leaves the
-- database.
--
-- Ruling (commissioner, 2026-11-23): "remove the waitlist entirely from the website and rulebook." The website and the
-- rulebook dropped it in v4.58 (the Review Board's Waitlist card and its Admit and Remove buttons, the Waitlist button,
-- Rule 2.6's waitlist sentences), and the Season 2 concept has had none since 2026-11-04. The database objects stayed
-- so the switch could not break mid-season; this record removes them at the flip.
--
-- What still calls or references each object, read by SELECT on production and by grep on 2026-11-24:
--  * The functions waitlist_application(text, uuid), waitlist_admit(text, uuid) and waitlist_remove(text, uuid, text):
--    SECURITY DEFINER; EXECUTE for authenticated and service_role only (no anon, no PUBLIC). No other function calls
--    them (no function body has a call to waitlist_application, waitlist_admit or waitlist_remove), and no policy, view,
--    trigger, index or cron job names them.
--  * Tables: none. The waitlist was a status on owner_applications and staff_applications ('waitlisted', allowed by
--    owner_applications_status_check and staff_applications_status_check) plus a waitlisted_at column on each. Rows: 0
--    waitlisted owner applications of 32 and 0 waitlisted staff applications of 12; waitlisted_at is set on 3 denied
--    owner applications (waitlist_remove kept the date) and on no staff application. No cron job and no grant belongs to
--    the waitlist beyond the three functions' own.
--  * Seven functions mention the status or the column in passing: guard_owner_app_hold, stamp_app_filed_at,
--    guard_app_role_conflict, guard_app_decision, guard_app_insert, withdraw_owner_application and
--    withdraw_staff_application. None calls a waitlist function; each keeps working once no row can be waitlisted.
--  * Code: src/live (since v4.58) and src/s2 call none of the three (tools/waitlist.test.cjs pins it for src/live);
--    bot/, jobs/, edge/, netlify/functions and shared/ never mention the waitlist; grant-audit check 4 lists none of
--    them. Only comments in src/live (part9_staffdesks.js and part_live.js) still describe the objects.
--
-- What this record does:
--  1. Refuses to run if any application is still waitlisted (the office decides it first), or if any of the three
--     functions differs from the definition the reverse recreates (md5 of pg_get_functiondef, read 2026-11-24), so the
--     reverse always puts back exactly what was dropped.
--  2. Keeps one admin_audit row, action 'waitlist_dropped': the three full definitions, their md5s and the row counts.
--  3. Drops the three functions, without CASCADE (anything that came to depend on one stops the drop). Their grants go
--     with them.
--  4. Takes 'waitlisted' out of both status checks, so no door can waitlist an application again.
-- Kept on purpose:
--  * the waitlisted_at columns and their 3 dates: history on decided applications that nothing acts on. Dropping them
--    would break the seven functions above and the classic site's reads for no gain, and lose the dates.
--  * the seven functions' 'waitlisted' branches: dead once no row can hold the status, and harmless. Rewriting seven live
--    functions at the flip for no change in behavior is not worth the risk.
-- shortcut: dead 'waitlisted' branches stay in seven application functions, remove them when each is next rewritten
-- No table holds rows that this record drops, so nothing else needs archiving.
-- Reverse: sql/2026-11-24-waitlist-dropped-v463.reverse.sql recreates the three functions byte for byte (md5-checked),
-- their comments and grants, and both status checks as they were. Apply as migration v463_waitlist_dropped. Rehearsal (the
-- record, then the reverse, in one rolled-back transaction): sql/2026-11-24-waitlist-dropped-v463.rehearsal.sql.

do $pre$
declare v_o int; v_s int; v_bad text;
begin
  select count(*) into v_o from public.owner_applications where status = 'waitlisted';
  select count(*) into v_s from public.staff_applications where status = 'waitlisted';
  if v_o + v_s > 0 then
    raise exception 'v463 waitlist: % owner and % staff applications are still waitlisted. Decide each one first (approve, deny or return it to pending), then apply this record.', v_o, v_s;
  end if;
  select string_agg(f.sig, ', ') into v_bad from (values
      ('public.waitlist_admit(text,uuid)', '7bec84439da5ab2bd27a47cde68744c7'),
      ('public.waitlist_application(text,uuid)', '21fbfa893e581923d8daf7ae51201558'),
      ('public.waitlist_remove(text,uuid,text)', '779b4cffffc9aee816af2fac25f1ff2b')) f(sig, md5)
   where to_regprocedure(f.sig) is null or md5(pg_get_functiondef(to_regprocedure(f.sig))) <> f.md5;
  if v_bad is not null then
    raise exception 'v463 waitlist: % is missing or changed since 2026-11-24, so the reverse would not put it back exactly. Regenerate the reverse first.', v_bad;
  end if;
  if (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.owner_applications'::regclass and c.conname = 'owner_applications_status_check')
       is distinct from 'CHECK ((status = ANY (ARRAY[''pending''::text, ''approved''::text, ''denied''::text, ''waitlisted''::text, ''withdrawn''::text])))'
     or (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.staff_applications'::regclass and c.conname = 'staff_applications_status_check')
       is distinct from 'CHECK ((status = ANY (ARRAY[''pending''::text, ''approved''::text, ''denied''::text, ''waitlisted''::text, ''withdrawn''::text])))' then
    raise exception 'v463 waitlist: an application status check changed since 2026-11-24, so the reverse would not put it back exactly';
  end if;
end $pre$;

-- the archive: what is dropped, in full, before it goes
select public.log_admin_action('waitlist_dropped', 'database', 'application waitlist', jsonb_build_object(
  'reason', 'The application waitlist removed at the flip (commissioner, 2026-11-23: "remove the waitlist entirely from the website and rulebook")',
  'definitions', jsonb_build_object(
    'waitlist_admit(text,uuid)', pg_get_functiondef('public.waitlist_admit(text,uuid)'::regprocedure),
    'waitlist_application(text,uuid)', pg_get_functiondef('public.waitlist_application(text,uuid)'::regprocedure),
    'waitlist_remove(text,uuid,text)', pg_get_functiondef('public.waitlist_remove(text,uuid,text)'::regprocedure)),
  'md5', jsonb_build_object(
    'waitlist_admit(text,uuid)', '7bec84439da5ab2bd27a47cde68744c7',
    'waitlist_application(text,uuid)', '21fbfa893e581923d8daf7ae51201558',
    'waitlist_remove(text,uuid,text)', '779b4cffffc9aee816af2fac25f1ff2b'),
  'waitlisted_rows', 0,
  'waitlisted_at_kept', jsonb_build_object(
    'owner', (select count(*) from public.owner_applications where waitlisted_at is not null),
    'staff', (select count(*) from public.staff_applications where waitlisted_at is not null)),
  'reverse', 'sql/2026-11-24-waitlist-dropped-v463.reverse.sql'));

drop function public.waitlist_admit(text, uuid);
drop function public.waitlist_application(text, uuid);
drop function public.waitlist_remove(text, uuid, text);

alter table public.owner_applications drop constraint owner_applications_status_check,
  add constraint owner_applications_status_check
  check (status = any (array['pending'::text, 'approved'::text, 'denied'::text, 'withdrawn'::text]));
alter table public.staff_applications drop constraint staff_applications_status_check,
  add constraint staff_applications_status_check
  check (status = any (array['pending'::text, 'approved'::text, 'denied'::text, 'withdrawn'::text]));

-- self-checks
do $chk$
declare v_left text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_left from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'waitlist\_%';
  if v_left is not null then raise exception 'v463 waitlist check: still there: %', v_left; end if;
  select string_agg(p.proname, ', ') into v_left from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'waitlist_(admit|application|remove)\s*\(';
  if v_left is not null then raise exception 'v463 waitlist check: % still calls a dropped waitlist function', v_left; end if;
  if (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.owner_applications'::regclass and c.conname = 'owner_applications_status_check')
       is distinct from 'CHECK ((status = ANY (ARRAY[''pending''::text, ''approved''::text, ''denied''::text, ''withdrawn''::text])))'
     or (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.staff_applications'::regclass and c.conname = 'staff_applications_status_check')
       is distinct from 'CHECK ((status = ANY (ARRAY[''pending''::text, ''approved''::text, ''denied''::text, ''withdrawn''::text])))' then
    raise exception 'v463 waitlist check: a status check still allows waitlisted, or reads differently';
  end if;
  if not exists (select 1 from public.admin_audit a where a.action = 'waitlist_dropped' and a.detail->'definitions' ? 'waitlist_admit(text,uuid)') then
    raise exception 'v463 waitlist check: the archive row is missing';
  end if;
  raise notice 'v463 waitlist: dropped 3 functions; waitlisted_at kept on % owner and % staff applications',
    (select count(*) from public.owner_applications where waitlisted_at is not null),
    (select count(*) from public.staff_applications where waitlisted_at is not null);
end $chk$;

/* REHEARSAL: pending. The main session runs sql/2026-11-24-waitlist-dropped-v463.rehearsal.sql on production as one
   transaction that ends in an uncaught raise, and records the result here. */
-- Applied as migration v463e_waitlist_dropped on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
