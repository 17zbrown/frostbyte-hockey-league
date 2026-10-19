-- v4.21b: the review of v4.21 (an owner applicant may withdraw) found four more gaps around the same doors.
-- Commissioner, 2026-10-18: "add a withdraw application button". A read-only review then adversarially verified each
-- finding against the live database; these four were confirmed:
--   1. PRE-EXISTING, both tables: an application could be INSERTED already decided. Every status guard
--      (guard_app_decision, guard_owner_app_hold) is BEFORE UPDATE only, authenticated holds table-level INSERT, and
--      the insert policies check only profile_id = auth.uid(). A signed-up member with no Season 2 row could POST
--      {status:'approved', awarded_club:...} and skip the review board (owner_decision_watch would then count it as
--      confirmed). No live function inserts into either table; the site's own upserts always send status 'pending'
--      and no decision columns. No Season 2 application is decided today, so nothing used it this season.
--      guard_app_insert now refuses, for anyone but the office, a new row that is not pending or carries a decision
--      (decided_by, decided_at, response, waitlisted_at, and on owner applications awarded_*). It raises instead of
--      quietly resetting: a guard that quietly undoes a write is how v4.21's bug hid.
--   2. Race: decide_owner_application read the row without a lock and updated "where id = p_id", so a commissioner's
--      Approve landing in the same instant as the applicant's Withdraw could approve (and seat) a withdrawn
--      application. The read now takes the row lock (FOR UPDATE), so it sees the committed withdrawal and refuses.
--   3. False success: the site's "Approve now"/"Deny now" calls override_application_decision, whose
--      apply_application_decision updates only a PENDING row and returns quietly otherwise, so overriding an
--      application that was withdrawn (or is waitlisted) toasted "Decision applied" and changed nothing. The override
--      now locks the owner or staff row and refuses with its real status when it is not pending. Management
--      nominations are unchanged (their seat-block path returns on purpose and notifies).
--   4. owner_app_follows_signup told the member "Sign up again and reapply before applications close." even after
--      the close (Season 2 registration stays open past the Dec 12 close), and told the commissioners on a failure to
--      "Withdraw it from the Staff Desk", a control that does not exist. Both texts are corrected.
-- Nothing here posts to Discord.
--
-- REHEARSAL on production, 2026-10-19, in ONE transaction ending in an uncaught raise (the probes ran first against
-- the old definitions, then this migration, then the probes again; every write re-read):
--   BEFORE: a member inserts their own owner application as APPROVED with a club: accepted, stored approved / Boston
--           Bruins; a member inserts their own staff application as APPROVED: accepted, stored approved; a
--           commissioner's override (approve) of a withdrawn owner application: "accepted", stored still withdrawn
--   AFTER:  1 the owner insert as approved: refused 42501 "APPLICATION: A new application is filed as pending. ...",
--             nothing stored
--           2 the staff insert as approved: refused 42501, nothing stored
--           3 the site's own owner upsert (pending): accepted, pending
--           4 the site's own staff upsert (pending): accepted, pending
--           5 an existing applicant refiles through the site's upsert: accepted
--           6 the override on a withdrawn application: refused "This application is withdrawn, so it cannot be decided
--             here.", still withdrawn
--           7 decide_owner_application on it: refused "... so there is nothing to decide."
--           8 after the close, a pending applicant withdraws their sign-up: application withdrawn, notice ends
--             "Applications have closed, so it cannot be filed again this season."
-- Applied as migration v421b_application_guards.

-- 1) An application is born pending
create or replace function public.guard_app_insert() returns trigger
  language plpgsql security definer set search_path to '' as $f$
/* v4.21b: a new owner or staff application is filed as pending and carries no decision; only the review board's vote,
   a commissioner or the office's RPCs (app.app_decide / app.app_award) decide one. */
declare v jsonb := to_jsonb(new);
begin
  if public.is_commissioner()
     or coalesce(current_setting('app.app_decide', true), '') = 'on'
     or coalesce(current_setting('app.app_award', true), '') = 'on' then
    return new;
  end if;
  if coalesce(v->>'status', 'pending') <> 'pending'
     or v->>'decided_by' is not null or v->>'decided_at' is not null or v->>'response' is not null
     or v->>'waitlisted_at' is not null
     or v->>'awarded_club' is not null or v->>'awarded_by' is not null or v->>'awarded_at' is not null then
    raise exception 'APPLICATION: A new application is filed as pending. Only the review board or the league office decides it.'
      using errcode = '42501';
  end if;
  return new;
end $f$;
revoke all on function public.guard_app_insert() from public, anon, authenticated;
drop trigger if exists guard_owner_app_insert on public.owner_applications;
create trigger guard_owner_app_insert before insert on public.owner_applications
  for each row execute function public.guard_app_insert();
drop trigger if exists guard_staff_app_insert on public.staff_applications;
create trigger guard_staff_app_insert before insert on public.staff_applications
  for each row execute function public.guard_app_insert();

-- 2) + 3) + 4) anchored patches, each matching exactly once
do $p$
declare
  v_def text; i int;
  v_fn  text[] := array[
    'public.decide_owner_application(uuid, boolean, text)',
    'public.override_application_decision(text, uuid, boolean)',
    'public.owner_app_follows_signup()',
    'public.owner_app_follows_signup()',
    'public.owner_app_follows_signup()',
    'public.owner_app_follows_signup()'];
  v_old text[] := array[
    $o$  select * into v_app from public.owner_applications where id = p_id;$o$,
    $o$  perform public.apply_application_decision(p_type, p_id, p_approve);$o$,
    $o$declare v_pid uuid; v_sid uuid; v_num int; v_n int := 0;$o$,
    $o$    select number into v_num from public.seasons where id = v_sid;$o$,
    $o$' was withdrawn with it: only a signed-up player can apply. Sign up again and reapply before applications close.',$o$,
    $o$'. Withdraw it from the Staff Desk.'$o$];
  v_new text[] := array[
    $n$  /* v4.21b: the row lock makes a concurrent withdrawal visible here, so it is refused below, never approved */
  select * into v_app from public.owner_applications where id = p_id for update;$n$,
    $n$  /* v4.21b: an owner or staff application that is no longer pending is refused out loud (apply_application_decision
     updates only a pending row and returned quietly, so the site toasted "Decision applied" and nothing changed) */
  if p_type in ('owner', 'staff') then
    declare v_st text;
    begin
      if p_type = 'owner' then
        select status into v_st from public.owner_applications where id = p_id for update;
      else
        select status into v_st from public.staff_applications where id = p_id for update;
      end if;
      if v_st is null then raise exception 'Application not found.'; end if;
      if v_st <> 'pending' then
        raise exception 'This application is %, so it cannot be decided here.', v_st;
      end if;
    end;
  end if;
  perform public.apply_application_decision(p_type, p_id, p_approve);$n$,
    $n$declare v_pid uuid; v_sid uuid; v_num int; v_n int := 0; v_dl timestamptz;$n$,
    $n$    select number, owner_app_deadline into v_num, v_dl from public.seasons where id = v_sid;$n$,
    $n$' was withdrawn with it: only a signed-up player can apply. ' ||
      /* v4.21b: after the close a withdrawn application cannot be filed again (Rule 2.6) */
      case when v_dl is not null and now() >= v_dl then 'Applications have closed, so it cannot be filed again this season.'
           else 'Sign up again and reapply before applications close.' end,$n$,
    $n$'. It is still pending: ask the member to withdraw it from their owner application page.'$n$];
begin
  for i in 1 .. array_length(v_fn, 1) loop
    select pg_get_functiondef(v_fn[i]::regprocedure) into v_def;
    if (length(v_def) - length(replace(v_def, v_old[i], ''))) / length(v_old[i]) <> 1 then
      raise exception 'patch %: anchor in % matched % times', i, v_fn[i], (length(v_def) - length(replace(v_def, v_old[i], ''))) / length(v_old[i]);
    end if;
    execute replace(v_def, v_old[i], v_new[i]);
  end loop;
end $p$;

-- self-checks
do $c$
begin
  if (select count(*) from pg_trigger where tgname in ('guard_owner_app_insert', 'guard_staff_app_insert') and not tgisinternal) <> 2 then
    raise exception 'self-check: an application table has no insert guard';
  end if;
  if has_function_privilege('anon', 'public.guard_app_insert()', 'EXECUTE') or has_function_privilege('authenticated', 'public.guard_app_insert()', 'EXECUTE') then
    raise exception 'self-check: the insert guard is callable';
  end if;
  if (select prosrc from pg_proc where oid = 'public.decide_owner_application(uuid, boolean, text)'::regprocedure) !~ 'where id = p_id for update;' then
    raise exception 'self-check: decide_owner_application reads without the row lock';
  end if;
  if (select prosrc from pg_proc where oid = 'public.override_application_decision(text, uuid, boolean)'::regprocedure) !~ 'so it cannot be decided here' then
    raise exception 'self-check: the override still decides a non-pending application quietly';
  end if;
  if (select prosrc from pg_proc where oid = 'public.owner_app_follows_signup()'::regprocedure) ~ 'Withdraw it from the Staff Desk' then
    raise exception 'self-check: the failure notice still names a control that does not exist';
  end if;
end $c$;
