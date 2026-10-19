-- v4.22: a staff applicant may withdraw; the waitlist never fills automatically; a refiled application is voted afresh.
-- Commissioner, 2026-10-19: "add a withdraw button for staff applications. Waitlist applications should not fill
-- automaticall[y]". Asked "When an applicant withdraws and refiles, or reapplies after a denial, should the reviewers'
-- earlier votes still count?", the commissioner answered "Fresh vote".
--
-- What a read-only map of the live database found, and what changes:
--   1. filed_at (owner_applications, staff_applications): when the application was last put before the reviewers.
--      Stamped by stamp_app_filed_at on insert and whenever the status moves back to 'pending' (a refile after a
--      withdrawal or a denial, or an office reopen); every other write keeps it. Backfilled from created_at, so every
--      application before the reviewers today counts its ballots exactly as before.
--   2. resolve_application_if_ready counts, for owner and staff applications, only ballots cast or changed since
--      filed_at. Older ballots stay on the record and do not count (the Fresh vote ruling). Before this, a denied
--      applicant who reapplied was denied again within 15 minutes by the votes that denied them (the
--      owner-app-resolve cron), and a waitlisted applicant who withdrew and refiled could be approved by old votes,
--      past the waitlist. Management nominations are unchanged (no refile path).
--   3. guard_app_decision (shared by both tables, patched by anchored replacement):
--      a. an applicant's own write never takes a waitlisted application off the waitlist. Saving the staff form sent
--         status 'pending', which the guard allowed, and the reviewer vote could then approve it: an automatic way
--         past the waitlist. The status now stays 'waitlisted'; the office's doors (waitlist_admit, waitlist_remove)
--         and the withdraw doors run under app.app_decide and still move it.
--      b. waitlisted_at is the office's: an applicant could forge their queue position (authenticated holds UPDATE on
--         every staff_applications column).
--      c. the awarded_* branch runs only on owner_applications and treats an unset flag as off. It compared
--         current_setting('app.app_award', true) <> 'on': NULL on a fresh connection (the branch skipped), '' on a
--         pooled connection after set_owner_app_club ran (the branch ran), and on a staff row that raised 'record
--         "new" has no field "awarded_club"', so a staff applicant's save would have failed now and then from Season
--         2 decision week on.
--   4. waitlist_application never set app.app_decide, so when a reviewer who is not a commissioner waitlisted an
--      application, guard_app_decision quietly put the status back (and kept the new waitlisted_at). It now runs
--      its update under the flag, like waitlist_admit and waitlist_remove.
--   5. withdraw_staff_application: the staff twin of withdraw_owner_application (v4.21). The applicant's own pending
--      or waitlisted staff application; approved is refused (leaving the staff goes through the league office),
--      denied and withdrawn are refused. Staff applications have no window, so a withdrawal is never final: the
--      applicant may file again at any time, and the refile is voted afresh (2.). Withdrawing gives up a waitlist
--      place (waitlisted_at cleared; the old value is kept in the audit row).
--   6. decide_staff_application (both overloads) is dropped. It was commissioner-only with no status check or lock,
--      so it could approve a withdrawn or waitlisted application and grant the role past waitlist_admit's Rule 2.7
--      checks. No function calls it; its only client, CG.decideStaffApp, was never called and is removed too.
--      Commissioners decide through the override (override_application_decision, v4.21b) and the waitlist doors.
-- The waitlist itself already admitted nobody automatically (fill_owner_vacancy and fill_staff_vacancy were dropped
-- 2026-09-07); Rule 2.6 and four site captions still promised it and are corrected in the same version.
-- Nothing here posts to Discord.
--
-- REHEARSAL on production, 2026-10-19, in ONE transaction ending in an uncaught raise: the same scenarios against
-- the old definitions, then this migration, then again (every write re-read), on the one pending staff application:
--   BEFORE: 1 waitlisted, the applicant saves the form (the site's upsert): accepted -> PENDING (off the waitlist)
--           2 a reviewer who is not a commissioner waitlists it: "accepted" -> still pending, waitlisted_at set
--           3 on a connection where app.app_award is '' the applicant saves: refused 42703 'record "new" has no field
--             "awarded_club"'
--           4 two reviewers deny it -> denied; the applicant refiles -> after the cron: DENIED again on the old votes
--   AFTER:  1 -> stays WAITLISTED          2 -> waitlisted, waitlisted_at set          3 -> accepted
--           4 -> denied; refiled -> after the cron: PENDING (old votes kept, not counted)
--           5 the applicant withdraws a pending application: withdrawn, 7 bells (3 commissioners + the Applications
--             desk), 1 audit row       6 withdraw again: refused "already withdrawn"
--           7 another member: refused 42501       8 the applicant of an approved application: refused, still approved
--           9 the applicant files again: pending, filed_at reset to now
--           10 a waitlisted application withdrawn: withdrawn, waitlisted_at cleared       11 signed out: refused 42501
--           12 decide_staff_application overloads left: 0
--           13 pending owner applications: 11 of 11 ballots still count (the backfill changed nothing for them)
-- Applied as migration v422_staff_withdraw_and_waitlist.

-- 1) filed_at, backfilled before its trigger exists (the backfill runs under app.app_decide so no guard refuses it)
alter table public.owner_applications add column if not exists filed_at timestamptz;
alter table public.staff_applications add column if not exists filed_at timestamptz;
comment on column public.owner_applications.filed_at is
  'v4.22: when the application was last put before the reviewers (insert, or a move back to pending). Only ballots cast or changed since count.';
comment on column public.staff_applications.filed_at is
  'v4.22: when the application was last put before the reviewers (insert, or a move back to pending). Only ballots cast or changed since count.';
do $bf$
begin
  perform set_config('app.app_decide', 'on', true);
  update public.owner_applications set filed_at = created_at where filed_at is null;
  update public.staff_applications set filed_at = created_at where filed_at is null;
  perform set_config('app.app_decide', '', true);
end $bf$;

create or replace function public.stamp_app_filed_at() returns trigger
  language plpgsql security definer set search_path to '' as $f$
/* v4.22 ("Fresh vote", commissioner 2026-10-19): an application is put before the reviewers when it is filed and
   whenever it returns to pending; no other write moves the stamp. Named zz_ so it fires after every guard, and so
   sees the status the guards settled on (a waitlisted application an applicant tried to re-pend stays waitlisted). */
begin
  if tg_op = 'INSERT' then
    new.filed_at := now();
  elsif new.status = 'pending' and old.status is distinct from 'pending' then
    new.filed_at := now();
  else
    new.filed_at := old.filed_at;
  end if;
  return new;
end $f$;
revoke all on function public.stamp_app_filed_at() from public, anon, authenticated;
drop trigger if exists zz_stamp_owner_app_filed_at on public.owner_applications;
create trigger zz_stamp_owner_app_filed_at before insert or update on public.owner_applications
  for each row execute function public.stamp_app_filed_at();
drop trigger if exists zz_stamp_staff_app_filed_at on public.staff_applications;
create trigger zz_stamp_staff_app_filed_at before insert or update on public.staff_applications
  for each row execute function public.stamp_app_filed_at();

-- 2) + 3) + 4) anchored patches, each matching exactly once
do $p$
declare
  v_def text; i int;
  v_fn  text[] := array[
    'public.resolve_application_if_ready(text, uuid)',
    'public.resolve_application_if_ready(text, uuid)',
    'public.resolve_application_if_ready(text, uuid)',
    'public.resolve_application_if_ready(text, uuid)',
    'public.guard_app_decision()',
    'public.guard_app_decision()',
    'public.waitlist_application(text, uuid)',
    'public.waitlist_application(text, uuid)'];
  v_old text[] := array[
    $o$declare v_status text; v_e int; v_need int; v_a int; v_d int;$o$,
    $o$select status into v_status from public.owner_applications where id = p_id;$o$,
    $o$select status into v_status from public.staff_applications where id = p_id;$o$,
    $o$    into v_a, v_d from public.application_ballots b where b.app_type = p_type and b.application_id = p_id;$o$,
    $o$  if new.status is distinct from old.status and new.status <> 'pending' then new.status := old.status; end if;$o$,
    $o$  if current_setting('app.app_award', true) <> 'on' then$o$,
    $o$    raise exception 'Only the league office can waitlist an application.' using errcode = '42501';
  end if;$o$,
    $o$    raise exception 'Unknown application type %', p_type using errcode = '22023';
  end if;$o$];
  v_new text[] := array[
    $n$declare v_status text; v_e int; v_need int; v_a int; v_d int; v_filed timestamptz;$n$,
    $n$select status, filed_at into v_status, v_filed from public.owner_applications where id = p_id;$n$,
    $n$select status, filed_at into v_status, v_filed from public.staff_applications where id = p_id;$n$,
    $n$    into v_a, v_d from public.application_ballots b where b.app_type = p_type and b.application_id = p_id
      /* v4.22 ("Fresh vote", commissioner 2026-10-19): only ballots cast or changed since the application was last
         filed count; older ones stay on the record. Management nominations have no filed_at and count every ballot. */
      and (v_filed is null or b.updated_at >= v_filed);$n$,
    $n$  /* v4.22 (commissioner, 2026-10-19): "Waitlist applications should not fill automatically." An applicant's own
     write never takes a waitlisted application off the waitlist (saving it went back to the vote, which could approve
     it); only the office's doors and the withdraw doors, under app.app_decide, move it. */
  if old.status = 'waitlisted' then new.status := old.status;
  elsif new.status is distinct from old.status and new.status <> 'pending' then new.status := old.status; end if;
  new.waitlisted_at := old.waitlisted_at;   -- v4.22: the queue position is the office's, never the applicant's$n$,
    $n$  /* v4.22: owner rows only (a staff row has no awarded_* and raised on them), and an unset flag counts as off
     (current_setting(..., true) is NULL on a fresh connection and '' after set_owner_app_club ran on it) */
  if tg_table_name = 'owner_applications' and coalesce(current_setting('app.app_award', true), '') <> 'on' then$n$,
    $n$    raise exception 'Only the league office can waitlist an application.' using errcode = '42501';
  end if;
  /* v4.22: the status move is the office's, so it runs under the decision flag (without it guard_app_decision quietly
     put the status back whenever a reviewer who is not a commissioner waitlisted an application) */
  perform set_config('app.app_decide', 'on', true);$n$,
    $n$    raise exception 'Unknown application type %', p_type using errcode = '22023';
  end if;
  perform set_config('app.app_decide', '', true);$n$];
begin
  for i in 1 .. array_length(v_fn, 1) loop
    select pg_get_functiondef(v_fn[i]::regprocedure) into v_def;
    if (length(v_def) - length(replace(v_def, v_old[i], ''))) / length(v_old[i]) <> 1 then
      raise exception 'patch %: anchor in % matched % times', i, v_fn[i], (length(v_def) - length(replace(v_def, v_old[i], ''))) / length(v_old[i]);
    end if;
    execute replace(v_def, v_old[i], v_new[i]);
  end loop;
end $p$;

-- 5) The staff withdraw door
create or replace function public.withdraw_staff_application(p_app uuid) returns jsonb
  language plpgsql security definer set search_path to '' as $f$
/* v4.22 (commissioner, 2026-10-19): "add a withdraw button for staff applications". The applicant's own pending or
   waitlisted staff application, at any time. Never final: staff applications have no window, so the applicant may
   file again whenever they like, and the refile is voted afresh (filed_at). */
declare
  v_uid uuid := auth.uid();
  v_app public.staff_applications;
  v_name text; v_n int;
begin
  if v_uid is null then raise exception 'WITHDRAW: Sign in first.' using errcode = '42501'; end if;
  select * into v_app from public.staff_applications where id = p_app for update;
  if v_app.id is null then raise exception 'WITHDRAW: That application was not found.'; end if;
  if v_app.profile_id <> v_uid then
    raise exception 'WITHDRAW: Only the applicant may withdraw their staff application.' using errcode = '42501';
  end if;
  if v_app.status = 'withdrawn' then raise exception 'WITHDRAW: This application is already withdrawn.'; end if;
  if v_app.status = 'approved' then
    raise exception 'WITHDRAW: An approved staff application is not withdrawn. To leave the staff, message the league office.';
  end if;
  if v_app.status not in ('pending', 'waitlisted') then
    raise exception 'WITHDRAW: This application was already decided, so there is nothing to withdraw. You may file a new one at any time.';
  end if;

  perform set_config('app.app_decide', 'on', true);   -- the decision guard lets the status move only under this flag
  update public.staff_applications set status = 'withdrawn', waitlisted_at = null, updated_at = now()
   where id = p_app and profile_id = v_uid and status in ('pending', 'waitlisted');
  get diagnostics v_n = row_count;
  perform set_config('app.app_decide', '', true);
  if v_n <> 1 then raise exception 'WITHDRAW: The application could not be withdrawn. Refresh the page and try again.'; end if;

  perform public.log_admin_action('staff_app_withdrawn', 'staff_application', p_app::text,
    jsonb_build_object('by', v_uid, 'from', v_app.status, 'waitlisted_at', v_app.waitlisted_at));
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'An applicant') into v_name from public.profiles p where p.id = v_uid;
  perform public.notify_department('applications', 'app', 'Staff application withdrawn',
    v_name || ' withdrew their staff application' || case when v_app.status = 'waitlisted' then ' and gave up their waitlist place.' else '.' end,
    'application', 'id=' || p_app::text || '&type=staff');
  return jsonb_build_object('ok', true, 'id', p_app, 'status', 'withdrawn');
end $f$;
revoke all on function public.withdraw_staff_application(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_staff_application(uuid) to authenticated;

-- 6) The dead staff decision door
drop function if exists public.decide_staff_application(uuid, boolean);
drop function if exists public.decide_staff_application(uuid, boolean, text);

-- self-checks
do $c$
declare v_src text;
begin
  if exists (select 1 from public.owner_applications where filed_at is null) or exists (select 1 from public.staff_applications where filed_at is null) then
    raise exception 'self-check: an application has no filed_at';
  end if;
  if (select count(*) from pg_trigger where tgname in ('zz_stamp_owner_app_filed_at', 'zz_stamp_staff_app_filed_at') and not tgisinternal) <> 2 then
    raise exception 'self-check: a filed_at stamp trigger is missing';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.resolve_application_if_ready(text, uuid)'::regprocedure;
  if v_src !~ 'b\.updated_at >= v_filed' then raise exception 'self-check: old ballots still count'; end if;
  select prosrc into v_src from pg_proc where oid = 'public.guard_app_decision()'::regprocedure;
  if v_src !~ $r$if old\.status = 'waitlisted' then new\.status := old\.status;$r$ or v_src !~ 'new\.waitlisted_at := old\.waitlisted_at'
     or v_src !~ $r$tg_table_name = 'owner_applications' and coalesce\(current_setting\('app\.app_award', true\), ''\) <> 'on'$r$ then
    raise exception 'self-check: guard_app_decision was not patched';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.waitlist_application(text, uuid)'::regprocedure;
  if v_src !~ $r$perform set_config\('app\.app_decide', 'on', true\);$r$ then raise exception 'self-check: waitlisting still runs without the flag'; end if;
  if has_function_privilege('anon', 'public.withdraw_staff_application(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.withdraw_staff_application(uuid)', 'EXECUTE') then
    raise exception 'self-check: the staff withdraw door has the wrong grants';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'decide_staff_application') then
    raise exception 'self-check: decide_staff_application still exists';
  end if;
end $c$;
