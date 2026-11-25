-- Rehearsal for sql/2026-11-24-waitlist-dropped-v463.sql (the application waitlist leaves the database at the flip) and
-- its reverse, sql/2026-11-24-waitlist-dropped-v463.reverse.sql. The main session runs it on production as ONE
-- execute_sql call: one transaction that ends in an uncaught raise, so everything rolls back (CLAUDE.md, database change
-- protocol step 2). Agents never run it. The two ALTER TABLEs hold an exclusive lock on owner_applications and
-- staff_applications until the rollback, well under a second; run it outside a game night and outside the minutes when
-- an application vote is being cast.
--
-- Prerequisites: none beyond production as it stood on 2026-11-24 (the three functions as read that day, no waitlisted
-- application). The record and the reverse are carried below byte for byte between their markers (the record up to its
-- REHEARSAL note, where the result is written); tools/waitlist-dropped-v463.test.cjs pins both.
-- Nothing here posts or notifies: the record and the reverse write only the archive row and the catalog.
--
-- Cases:
--   T1 after the record: the three functions are gone, nothing calls them, both status checks leave 'waitlisted' out,
--      and a commissioner calling waitlist_application through the API gets "function does not exist" (42883).
--   T2 the archive row holds the three full definitions, and each one's md5 is the md5 the reverse is checked against.
--   T3 after the reverse (its own self-checks run too): the three functions are back byte for byte with their comments
--      and grants, and both status checks allow 'waitlisted' again, exactly as before the record.

begin;

do $w$
declare v_c uuid;
begin
  if to_regprocedure('public.waitlist_admit(text,uuid)') is null or to_regprocedure('public.waitlist_application(text,uuid)') is null
     or to_regprocedure('public.waitlist_remove(text,uuid,text)') is null then
    raise exception 'REHEARSAL CANNOT RUN: a waitlist function is already gone';
  end if;
  select p.id into v_c from public.profiles p where p.role::text = 'commissioner' and not coalesce(p.banned, false) order by p.id limit 1;
  if v_c is null then raise exception 'REHEARSAL CANNOT RUN: no commissioner'; end if;
  perform set_config('rh.c', v_c::text, true);
  perform set_config('rh.before', (select string_agg(md5(pg_get_functiondef(p.oid)) || ' ' || coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x), '') || ' ' || coalesce(obj_description(p.oid, 'pg_proc'), ''), ' | ' order by p.proname)
                                     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'waitlist\_%'), true);
  perform set_config('rh.checks', (select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.conname) from pg_constraint c
                                     where c.conname in ('owner_applications_status_check', 'staff_applications_status_check')), true);
end $w$;

-- >>> record text: sql/2026-11-24-waitlist-dropped-v463.sql
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

-- <<< record text

do $t1$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'waitlist\_%') then
    raise exception 'T1 failed: a waitlist function survived';
  end if;
  if exists (select 1 from pg_constraint c where c.conname in ('owner_applications_status_check', 'staff_applications_status_check')
              and pg_get_constraintdef(c.oid) like '%waitlisted%') then
    raise exception 'T1 failed: a status check still allows waitlisted';
  end if;
end $t1$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.c'), 'role', 'authenticated')::text, true);
do $t1c$
begin
  begin
    perform public.waitlist_application('owner', gen_random_uuid());
    raise exception 'T1 failed: waitlist_application still answers';
  exception when undefined_function then
    null;   -- the door is gone
  end;
end $t1c$;
reset role;
select set_config('request.jwt.claims', '', true);

do $t2$
declare d jsonb; k text;
begin
  select a.detail into d from public.admin_audit a where a.action = 'waitlist_dropped' order by a.created_at desc limit 1;
  if d is null then raise exception 'T2 failed: no archive row'; end if;
  foreach k in array array['waitlist_admit(text,uuid)', 'waitlist_application(text,uuid)', 'waitlist_remove(text,uuid,text)'] loop
    if md5(d->'definitions'->>k) is distinct from d->'md5'->>k then
      raise exception 'T2 failed: the archived definition of % is not the one the reverse recreates', k;
    end if;
  end loop;
end $t2$;

-- >>> reverse text: sql/2026-11-24-waitlist-dropped-v463.reverse.sql
-- v463 REVERSE (DRAFT, 2026-11-24): undoes sql/2026-11-24-waitlist-dropped-v463.sql if the flip is rolled back.
-- It puts the application waitlist's database objects back exactly as they stood on 2026-11-24: the three functions
-- byte for byte (the definitions below were read from production that day with pg_get_functiondef, and the self-checks
-- compare their md5s), their two comments, their grants (EXECUTE for authenticated and service_role, none for anon or
-- PUBLIC), and 'waitlisted' back in both application status checks. The definitions are carried as they were, so the
-- one em dash in waitlist_admit's refusal stays: this file restores old text, it does not write new copy.
-- Nothing is decided or moved by this record, and no application becomes waitlisted.
-- Apply as migration v463_waitlist_dropped_reverse. Rehearsed inside sql/2026-11-24-waitlist-dropped-v463.rehearsal.sql.

do $pre$
begin
  if to_regprocedure('public.waitlist_admit(text,uuid)') is not null
     or to_regprocedure('public.waitlist_application(text,uuid)') is not null
     or to_regprocedure('public.waitlist_remove(text,uuid,text)') is not null then
    raise exception 'v463 waitlist reverse: a waitlist function still exists, so the drop is not applied and there is nothing to reverse';
  end if;
end $pre$;

-- the status checks, as they were
alter table public.owner_applications drop constraint owner_applications_status_check,
  add constraint owner_applications_status_check
  check (status = any (array['pending'::text, 'approved'::text, 'denied'::text, 'waitlisted'::text, 'withdrawn'::text]));
alter table public.staff_applications drop constraint staff_applications_status_check,
  add constraint staff_applications_status_check
  check (status = any (array['pending'::text, 'approved'::text, 'denied'::text, 'waitlisted'::text, 'withdrawn'::text]));

-- the three functions, byte for byte as pg_get_functiondef printed them on 2026-11-24
CREATE OR REPLACE FUNCTION public.waitlist_admit(p_type text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_app record; v_placed text; v_label text; v_name text; v_block text;
begin
  if not (public.is_commissioner() or public.is_app_reviewer(auth.uid())) then
    raise exception 'Only the Review Board can admit from the waitlist.' using errcode = '42501';
  end if;

  if p_type = 'owner' then
    select * into v_app from public.owner_applications where id = p_id for update;
    if v_app.id is null then raise exception 'Application not found.' using errcode = 'P0002'; end if;
    if v_app.status <> 'waitlisted' then
      raise exception 'That application is not on the waitlist (it is %).', v_app.status using errcode = '22023';
    end if;
    if v_app.profile_id = auth.uid() and not public.is_commissioner() then
      raise exception 'You can''t admit your own application.' using errcode = '42501';
    end if;
    -- admitting with no club chosen creates nothing and reads as success; refuse it up front
    if nullif(btrim(coalesce(v_app.awarded_club,'')), '') is null then
      return jsonb_build_object('ok', false, 'message',
        'Choose their club first — admitting with no club picked would create nothing.');
    end if;

    perform set_config('app.app_decide', 'on', true);
    perform set_config('app.owner_notice', 'rpc', true);   -- v4.19b: this function sends the applicant's notice itself
    update public.owner_applications
       set status = 'approved', decided_at = now(), decided_by = auth.uid(), updated_at = now()
     where id = p_id;
    perform set_config('app.owner_notice', '', true);
    perform set_config('app.app_decide', 'off', true);

    v_placed := public._owner_app_autoplace(p_id);
    /* v4.19b: a placed owner hears from _owner_app_autoplace ("You now own the ..."); otherwise the applicant is told the
       go-ahead a new club waits for, or that a commissioner will hand them their club */
    if v_placed is null then
      perform public.create_notification(v_app.profile_id, 'flag', 'Owner application approved',
        case when public._owner_app_held_club(p_id) is not null
             then 'You were admitted from the waitlist. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
                  || 'it is added, and you are seated as its Owner, once a commissioner gives the go-ahead.'
             else 'You were admitted from the waitlist. A commissioner will hand you your club shortly.' end, null, null);
    end if;
    select coalesce(nullif(gamertag,''), display_name, 'The applicant') into v_name
      from public.profiles where id = v_app.profile_id;
    if v_placed is null then
      /* v4.19: admitted for a new club, which waits for a commissioner's go-ahead */
      if public._owner_app_held_club(p_id) is not null then
        return jsonb_build_object('ok', true, 'held', true, 'placed', null, 'message',
          'Approved. The ' || public._owner_app_held_club(p_id) || ' would be a new club, so it waits for a commissioner''s go-ahead.');
      end if;
      return jsonb_build_object('ok', false, 'placed', null, 'message',
        'Approved, but the club could not be handed over. The commissioners have been told why.');
    end if;
    select concat_ws(' ', nullif(btrim(city),''), name) into v_label
      from public.teams where upper(code) = upper(v_placed);
    return jsonb_build_object('ok', true, 'placed', v_placed,
      'message', v_name || ' now owns the ' || coalesce(v_label, v_placed) || '.');

  elsif p_type = 'staff' then
    select * into v_app from public.staff_applications where id = p_id for update;
    if v_app.id is null then raise exception 'Application not found.' using errcode = 'P0002'; end if;
    if v_app.status <> 'waitlisted' then
      raise exception 'That application is not on the waitlist (it is %).', v_app.status using errcode = '22023';
    end if;
    if v_app.profile_id = auth.uid() and not public.is_commissioner() then
      raise exception 'You can''t admit your own application.' using errcode = '42501';
    end if;

    -- the same Rule 2.7 gates the ordinary staff approval applies; do not let the waitlist route round them
    if not public.media_exclusive_ok('staff', v_app.departments) then
      v_block := 'their application mixes Media with other departments, and Media is exclusive';
    elsif public.holds_club_seat(v_app.profile_id)
          and not public.is_role_exempt(v_app.profile_id)
          and not public.is_media_only_list(v_app.departments) then
      v_block := 'they own or manage a club, and only Media may be held alongside a club seat';
    end if;
    if v_block is not null then
      return jsonb_build_object('ok', false, 'message',
        'Not admitted: ' || v_block || ' (Rule 2.7). Sort that first, then admit them.');
    end if;

    perform set_config('app.role_grant', 'on', true);
    update public.profiles
       set role = 'staff',
           departments = coalesce(v_app.departments, departments),
           timezone = coalesce(nullif(v_app.timezone,''), timezone)
     where id = v_app.profile_id and role = 'member';
    perform set_config('app.role_grant', 'off', true);

    perform set_config('app.app_decide', 'on', true);
    update public.staff_applications
       set status = 'approved', decided_at = now(), updated_at = now()
     where id = p_id;
    perform set_config('app.app_decide', 'off', true);

    select coalesce(nullif(gamertag,''), display_name, 'The applicant') into v_name
      from public.profiles where id = v_app.profile_id;
    perform public.create_notification(v_app.profile_id, 'role', 'Welcome to the league staff',
      'The Review Board admitted you from the waitlist. The Staff Desk is in your hub; the Discord Staff role lands within minutes.',
      'hub', 'staffdesk');
    return jsonb_build_object('ok', true, 'message', v_name || ' is now on the league staff.');
  end if;

  raise exception 'Unknown application type %', p_type using errcode = '22023';
end $function$
;

CREATE OR REPLACE FUNCTION public.waitlist_application(p_type text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (is_commissioner() or is_app_reviewer(auth.uid())) then
    raise exception 'Only the league office can waitlist an application.' using errcode = '42501';
  end if;
  /* v4.22b: like waitlist_admit and waitlist_remove, nobody but a commissioner moves their own application, and
     a reviewer who is not a commissioner waitlists only an application still before the vote */
  if not public.is_commissioner() then
    if exists (select 1 from public.owner_applications o where p_type = 'owner' and o.id = p_id and (o.profile_id = auth.uid() or o.status <> 'pending'))
       or exists (select 1 from public.staff_applications s where p_type = 'staff' and s.id = p_id and (s.profile_id = auth.uid() or s.status <> 'pending')) then
      raise exception 'Only a commissioner can waitlist this application (it is your own, or it is no longer before the vote).' using errcode = '42501';
    end if;
  end if;
  /* v4.22: the status move is the office's, so it runs under the decision flag (without it guard_app_decision quietly
     put the status back whenever a reviewer who is not a commissioner waitlisted an application) */
  perform set_config('app.app_decide', 'on', true);
  if p_type = 'owner' then
    update public.owner_applications
      set status = 'waitlisted', waitlisted_at = coalesce(waitlisted_at, now()), updated_at = now()
      where id = p_id and status in ('pending','waitlisted','approved') and awarded_at is null;
    if not found then raise exception 'That application cannot be waitlisted (already decided or awarded).' using errcode = '22023'; end if;
  elsif p_type = 'staff' then
    update public.staff_applications
      set status = 'waitlisted', waitlisted_at = coalesce(waitlisted_at, now()), updated_at = now()
      where id = p_id and status in ('pending','waitlisted');
    if not found then raise exception 'That application cannot be waitlisted (already decided).' using errcode = '22023'; end if;
  else
    raise exception 'Unknown application type %', p_type using errcode = '22023';
  end if;
  perform set_config('app.app_decide', '', true);
end;$function$
;

CREATE OR REPLACE FUNCTION public.waitlist_remove(p_type text, p_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_app record; v_name text; v_note text;
begin
  if not (public.is_commissioner() or public.is_app_reviewer(auth.uid())) then
    raise exception 'Only the Review Board can take someone off the waitlist.' using errcode = '42501';
  end if;
  v_note := nullif(btrim(coalesce(p_reason,'')), '');

  if p_type = 'owner' then
    select * into v_app from public.owner_applications where id = p_id for update;
  elsif p_type = 'staff' then
    select * into v_app from public.staff_applications where id = p_id for update;
  else
    raise exception 'Unknown application type %', p_type using errcode = '22023';
  end if;
  if v_app.id is null then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  if v_app.status <> 'waitlisted' then
    raise exception 'That application is not on the waitlist (it is %).', v_app.status using errcode = '22023';
  end if;
  if v_app.profile_id = auth.uid() and not public.is_commissioner() then
    raise exception 'You can''t decide your own application.' using errcode = '42501';
  end if;

  perform set_config('app.app_decide', 'on', true);
  if p_type = 'owner' then
    update public.owner_applications
       set status = 'denied', decided_at = now(), decided_by = auth.uid(), updated_at = now(),
           response = trim(coalesce(response,'') || ' ' || coalesce(v_note, 'Taken off the waitlist by the Review Board.'))
     where id = p_id;
  else
    update public.staff_applications
       set status = 'denied', decided_at = now(), updated_at = now(),
           response = trim(coalesce(response,'') || ' ' || coalesce(v_note, 'Taken off the waitlist by the Review Board.'))
     where id = p_id;
  end if;
  perform set_config('app.app_decide', 'off', true);

  perform public.create_notification(v_app.profile_id, 'flag',
    case when p_type = 'owner' then 'Owner application closed' else 'Staff application closed' end,
    'You are no longer on the waitlist. ' || coalesce(v_note, 'The Review Board closed the application.') ||
    ' You can apply again any time.', null, null);

  select coalesce(nullif(gamertag,''), display_name, 'The applicant') into v_name
    from public.profiles where id = v_app.profile_id;
  return jsonb_build_object('ok', true, 'message', v_name || ' was taken off the waitlist.');
end $function$
;

comment on function public.waitlist_admit(text, uuid) is 'Review Board admits a waitlisted applicant. Owner: approves and hands over the club already chosen (refuses if none is chosen). Staff: re-applies the Rule 2.7 gates, then grants the role. Replaces the retired fill_owner_vacancy / fill_staff_vacancy auto-appointment triggers.';
comment on function public.waitlist_remove(text, uuid, text) is 'Review Board takes a waitlisted applicant off the list, closing the application as denied with an optional reason the applicant sees.';

-- the grants, as they were: the Review Board's doors for signed-in members, never anon or PUBLIC (service_role is revoked
-- too, so its grant lands after authenticated's, in the order the live ACL had)
revoke all on function public.waitlist_admit(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.waitlist_application(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.waitlist_remove(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.waitlist_admit(text, uuid) to authenticated, service_role;
grant execute on function public.waitlist_application(text, uuid) to authenticated, service_role;
grant execute on function public.waitlist_remove(text, uuid, text) to authenticated, service_role;

-- self-checks: exactly what stood on 2026-11-24
do $chk$
declare v_bad text;
begin
  select string_agg(f.sig, ', ') into v_bad from (values
      ('public.waitlist_admit(text,uuid)', '7bec84439da5ab2bd27a47cde68744c7'),
      ('public.waitlist_application(text,uuid)', '21fbfa893e581923d8daf7ae51201558'),
      ('public.waitlist_remove(text,uuid,text)', '779b4cffffc9aee816af2fac25f1ff2b')) f(sig, md5)
   where to_regprocedure(f.sig) is null or md5(pg_get_functiondef(to_regprocedure(f.sig))) <> f.md5
      or has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE')
      or not has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')
      or not has_function_privilege('service_role', to_regprocedure(f.sig), 'EXECUTE')
      or exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = to_regprocedure(f.sig) and x.grantee = 0);
  if v_bad is not null then raise exception 'v463 waitlist reverse check: % is not as it stood on 2026-11-24', v_bad; end if;
  if obj_description('public.waitlist_admit(text,uuid)'::regprocedure, 'pg_proc') is distinct from 'Review Board admits a waitlisted applicant. Owner: approves and hands over the club already chosen (refuses if none is chosen). Staff: re-applies the Rule 2.7 gates, then grants the role. Replaces the retired fill_owner_vacancy / fill_staff_vacancy auto-appointment triggers.'
     or obj_description('public.waitlist_remove(text,uuid,text)'::regprocedure, 'pg_proc') is distinct from 'Review Board takes a waitlisted applicant off the list, closing the application as denied with an optional reason the applicant sees.'
     or obj_description('public.waitlist_application(text,uuid)'::regprocedure, 'pg_proc') is not null then
    raise exception 'v463 waitlist reverse check: a function comment is not as it was';
  end if;
  if (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.owner_applications'::regclass and c.conname = 'owner_applications_status_check')
       is distinct from 'CHECK ((status = ANY (ARRAY[''pending''::text, ''approved''::text, ''denied''::text, ''waitlisted''::text, ''withdrawn''::text])))'
     or (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.staff_applications'::regclass and c.conname = 'staff_applications_status_check')
       is distinct from 'CHECK ((status = ANY (ARRAY[''pending''::text, ''approved''::text, ''denied''::text, ''waitlisted''::text, ''withdrawn''::text])))' then
    raise exception 'v463 waitlist reverse check: a status check is not as it was';
  end if;
end $chk$;
-- <<< reverse text

do $t3$
begin
  if (select string_agg(md5(pg_get_functiondef(p.oid)) || ' ' || coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x), '') || ' ' || coalesce(obj_description(p.oid, 'pg_proc'), ''), ' | ' order by p.proname)
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'waitlist\_%') is distinct from current_setting('rh.before') then
    raise exception 'T3 failed: the functions, grants or comments differ from before the record';
  end if;
  if (select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.conname) from pg_constraint c
       where c.conname in ('owner_applications_status_check', 'staff_applications_status_check')) is distinct from current_setting('rh.checks') then
    raise exception 'T3 failed: the status checks differ from before the record';
  end if;
  raise exception 'REHEARSAL OK: T1 T2 T3 (3 functions dropped and restored byte for byte, grants and comments included)';
end $t3$;
