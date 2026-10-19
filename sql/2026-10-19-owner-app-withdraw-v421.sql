-- v4.21: an owner applicant may withdraw their application from the site.
-- Commissioner, 2026-10-18: "add a withdraw application button". Asked first: "can applicants withdraw their
-- application?" The answer was no. guard_app_decision (shared with staff_applications) quietly puts a non-office
-- status change back unless the new status is 'pending', so a direct write of status 'withdrawn' returned the row as
-- if it worked and changed nothing. The only working path was owner_app_follows_signup (a withdrawn sign-up takes a
-- pending application with it). Correction to the record: the v4.20 rehearsal line "the applicant withdrawing after
-- the edit: accepted" (sql/2026-10-18-owner-app-one-edit-v420.sql) meant only that no error was raised; the status
-- had been put back. This rehearsal re-reads the status after every write.
--
-- The rule (Rule 2.6):
--   * Only the applicant may withdraw, and only a PENDING or WAITLISTED application. An approved application holds a
--     seat, a held club (v4.19) or a handover, so giving it up goes through the league office; a denied application
--     is decided; a withdrawn one is done.
--   * It works at any time, including after applications close. Before the close a withdrawn application may be
--     filed again (the site's upsert back to 'pending'; it needs a live sign-up, and only a change spends the one
--     edit). After the close a withdrawal is final for the applicant: guard_owner_app_deadline refuses the refile.
--     The office can still restore one by hand (a commissioner's direct write passes every guard).
--   * Ballots already cast, waitlisted_at and awarded_club are kept: clearing them would destroy the record and
--     nothing reads them once the status is 'withdrawn' (resolve_application_if_ready acts only on 'pending').
--   * The Applications desk and the commissioners get a site bell (notify_department; no Discord post), and the
--     withdrawal is logged in admin_audit.
--
-- Also closed in this change:
--   * guard_owner_app_deadline let ANY update that set status 'withdrawn' through after the close, before
--     guard_app_decision put the status back. An applicant could send {status:'withdrawn', pitch: ...} after the
--     close and the pitch or picks change stuck. The carve-out is gone: the only legitimate withdrawals (this RPC and
--     owner_app_follows_signup) run under app.app_decide, which the guard already exempts. guard_owner_app_deadline
--     had no sql/ record before this file; the full text is here. Its PUBLIC/anon EXECUTE is revoked (a trigger
--     function needs none), and the em dash in its message is gone.
--   * decide_owner_application refuses a withdrawn application (it could approve one and seat the applicant).
--
-- REHEARSAL on production, 2026-10-19, in ONE transaction ending in an uncaught raise; verified rolled back (no
-- withdraw function, the old guard text still live). The first attempt stopped on its first probe: the applicant it
-- picked had already used their one edit (ONE_EDIT, a real v4.20 edit on Oct 18), so the run picks an applicant whose
-- edit is unused. Signed in as Season 2 applicants (members), every write re-read:
--   BEFORE the fix, after the close, {status:'withdrawn', pitch} as the applicant: still pending, but the pitch
--     changed and the edit was stamped (the hole)
--   1  withdraw while open: withdrawn, edit not stamped, 7 bells (3 commissioners + the Applications desk), 1 audit row
--   2  withdraw again: refused "This application is already withdrawn."
--   3  refile unchanged through the site's own upsert: accepted, back to pending, edit still unused
--   4  another member withdraws it: refused 42501 "Only the applicant may withdraw their owner application."
--   5  AFTER the fix, after the close, {status:'withdrawn', pitch}: refused 42501 (applications closed), pitch unchanged
--   6  a plain edit after the close: refused 42501
--   7  withdraw after the close: accepted, final = true, withdrawn
--   8  refile after the close: refused 42501, still withdrawn
--   9  the applicant of an approved application: refused "An approved application is not withdrawn. ..."
--   10 a Season 1 waitlisted application: withdrawn
--   11 a commissioner decides the withdrawn application: refused "... so there is nothing to decide."
--   12 signed out (anon): refused 42501, no EXECUTE
--   13 a third applicant withdraws their sign-up (withdraw_registration): their application withdrawn, as before
--   bells: 22 in all (7 for each of the three withdrawals, plus the sign-up path's own notice to the applicant)
-- Applied as migration v421_owner_app_withdraw.

-- 1) The deadline guard, without the withdrawn carve-out
create or replace function public.guard_owner_app_deadline() returns trigger
  language plpgsql security definer set search_path to '' as $f$
declare v_dl timestamptz;
begin
  if public.is_commissioner()
     or coalesce(current_setting('app.app_decide', true), '') = 'on'
     or coalesce(current_setting('app.app_award', true), '') = 'on' then
    return new;
  end if;
  /* v4.21: no carve-out for status 'withdrawn' any more. It let an applicant change their answers after the close
     (guard_app_decision put the status back, the rest stuck). An applicant withdraws through
     withdraw_owner_application, which runs under app.app_decide like every other office-approved write. */
  select s.owner_app_deadline into v_dl from public.seasons s
    where s.id = coalesce(new.season_id, public.registering_season_id());
  if v_dl is not null and now() >= v_dl then
    raise exception 'Owner applications closed on %. The window to apply to own a club has passed.',
      to_char(v_dl at time zone 'America/New_York', 'Mon DD, HH12:MI AM') || ' ET'
      using errcode = '42501';
  end if;
  return new;
end $f$;
revoke all on function public.guard_owner_app_deadline() from public, anon, authenticated;

-- 2) The one door an applicant withdraws through
create or replace function public.withdraw_owner_application(p_app uuid) returns jsonb
  language plpgsql security definer set search_path to '' as $f$
/* v4.21 (commissioner, 2026-10-18): "add a withdraw application button". The applicant's own pending or waitlisted
   owner application, at any time; final once applications have closed. */
declare
  v_uid uuid := auth.uid();
  v_app public.owner_applications;
  v_season public.seasons;
  v_name text; v_n int; v_final boolean;
begin
  if v_uid is null then raise exception 'WITHDRAW: Sign in first.' using errcode = '42501'; end if;
  select * into v_app from public.owner_applications where id = p_app for update;
  if v_app.id is null then raise exception 'WITHDRAW: That application was not found.'; end if;
  if v_app.profile_id <> v_uid then
    raise exception 'WITHDRAW: Only the applicant may withdraw their owner application.' using errcode = '42501';
  end if;
  if v_app.status = 'withdrawn' then raise exception 'WITHDRAW: This application is already withdrawn.'; end if;
  if v_app.status = 'approved' then
    raise exception 'WITHDRAW: An approved application is not withdrawn. To give up the club, message the league office from your application.';
  end if;
  if v_app.status not in ('pending', 'waitlisted') then
    raise exception 'WITHDRAW: This application was already decided, so there is nothing to withdraw.';
  end if;
  select * into v_season from public.seasons where id = v_app.season_id;
  v_final := v_season.owner_app_deadline is not null and now() >= v_season.owner_app_deadline;

  perform set_config('app.app_decide', 'on', true);   -- the decision guard lets the status move only under this flag
  update public.owner_applications set status = 'withdrawn', updated_at = now()
   where id = p_app and profile_id = v_uid and status in ('pending', 'waitlisted');
  get diagnostics v_n = row_count;
  perform set_config('app.app_decide', '', true);
  if v_n <> 1 then raise exception 'WITHDRAW: The application could not be withdrawn. Refresh the page and try again.'; end if;

  perform public.log_admin_action('owner_app_withdrawn', 'owner_application', p_app::text,
    jsonb_build_object('by', v_uid, 'from', v_app.status, 'season', v_app.season_id, 'after_close', v_final));
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'An applicant') into v_name from public.profiles p where p.id = v_uid;
  perform public.notify_department('applications', 'app', 'Owner application withdrawn',
    v_name || ' withdrew their ' || coalesce(v_season.name, 'season') || ' owner application'
      || case when v_final then ' after applications closed, so it cannot be filed again this season.' else '.' end,
    'application', 'id=' || p_app::text || '&type=owner');
  return jsonb_build_object('ok', true, 'id', p_app, 'status', 'withdrawn', 'final', v_final, 'season', v_season.name);
end $f$;
revoke all on function public.withdraw_owner_application(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_owner_application(uuid) to authenticated;

-- 3) A commissioner's decision refuses a withdrawn application (anchored patch, exactly once)
do $p$
declare v_def text; v_old text := $o$  if v_app.id is null then raise exception 'Application not found.'; end if;$o$;
        v_new text := $n$  if v_app.id is null then raise exception 'Application not found.'; end if;
  /* v4.21: a withdrawn application is not decided (approving one would seat an applicant who pulled out) */
  if v_app.status = 'withdrawn' then raise exception 'The applicant withdrew this application, so there is nothing to decide.'; end if;$n$;
begin
  select pg_get_functiondef('public.decide_owner_application(uuid, boolean, text)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'patch: decide_owner_application anchor matched % times', (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  end if;
  execute replace(v_def, v_old, v_new);
end $p$;

-- self-checks
do $c$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.guard_owner_app_deadline()'::regprocedure;
  if v_src ~ $r$new\.status\s*=\s*'withdrawn'$r$ then raise exception 'self-check: the deadline guard still lets a withdrawal through'; end if;
  if has_function_privilege('anon', 'public.withdraw_owner_application(uuid)', 'EXECUTE') then
    raise exception 'self-check: anon may withdraw';
  end if;
  if not has_function_privilege('authenticated', 'public.withdraw_owner_application(uuid)', 'EXECUTE') then
    raise exception 'self-check: members cannot reach the withdraw door';
  end if;
  if has_function_privilege('anon', 'public.guard_owner_app_deadline()', 'EXECUTE') then
    raise exception 'self-check: the deadline guard is still executable by anon';
  end if;
  if (select prosrc from pg_proc where oid = 'public.decide_owner_application(uuid, boolean, text)'::regprocedure)
     !~ 'so there is nothing to decide' then
    raise exception 'self-check: decide_owner_application still decides a withdrawn application';
  end if;
end $c$;
