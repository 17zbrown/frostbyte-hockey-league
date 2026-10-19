-- v4.22b: four gaps a read-only review found in v4.22 (each verified against the live database by a second agent).
-- Commissioner, 2026-10-19: "add a withdraw button for staff applications. Waitlist applications should not fill
-- automatically", and "Fresh vote" (a refiled application counts only ballots cast since it was filed again).
--   1. A ballot's time came from the reviewer's device: the site sent updated_at = new Date() and nothing on the server
--      replaced it, while filed_at is the server's now(). A slow clock made a fresh vote not count; a fast clock (or a
--      PATCH of updated_at) kept an old vote counting after a refile. stamp_ballot_time now sets updated_at (and
--      created_at on insert) from the server's clock on every write; the site stops sending it. No ballot today is
--      dated in the future (checked), so no existing row needs correcting.
--   2. A refile alerted nobody (the office bell and the bot's desk alert fire on INSERT; a refile is an UPDATE of the
--      same row). Under Fresh vote every reviewer owes a new ballot, so notify_app_refiled rings the Applications desk
--      and the commissioners (site bell, no Discord) when an owner or staff application returns to pending from
--      withdrawn, denied or approved.
--   3. waitlisted_at survived a removal (waitlist_remove closes as denied) and a refile, so waitlisting the refile
--      again (waitlisted_at = coalesce(waitlisted_at, now())) restored the old queue place. stamp_app_filed_at now
--      clears it whenever an application returns to pending.
--   4. waitlist_application took effect for any reviewer from v4.22 on, with no own-application check (its siblings
--      waitlist_admit and waitlist_remove have one) and an owner branch that accepts an approved application. A reviewer
--      who is not a commissioner now waitlists only someone else's PENDING application; a commissioner keeps the rest.
-- Nothing here posts to Discord.
--
-- REHEARSAL on production, 2026-10-19, in ONE transaction ending in an uncaught raise (this migration, then the
-- probes, every write re-read):
--   1 a reviewer upserts a ballot sending created_at 2000 and updated_at 2099 -> stored created=now, updated=now
--   2 the staff applicant withdraws, then refiles -> pending, 7 'Staff application filed again' bells
--   3 a commissioner waitlists it (waitlisted_at set), takes it off the waitlist (denied, waitlisted_at kept); the
--     applicant refiles -> pending, waitlisted_at cleared, 7 bells
--   4 a reviewer who is not a commissioner waitlists another member's pending application -> waitlisted
--   5 the same reviewer waitlists their own staff application -> refused 42501
--   6 the same reviewer waitlists an approved owner application -> refused 42501, still approved
-- Applied as migration v422b_fresh_vote_fixes.

-- 1) The server's clock stamps every ballot
create or replace function public.stamp_ballot_time() returns trigger
  language plpgsql security definer set search_path to '' as $f$
/* v4.22b ("Fresh vote", commissioner 2026-10-19): whether a ballot counts depends on when it was cast against the
   application's filed_at, so the server's clock stamps it, never the reviewer's device */
begin
  if tg_op = 'INSERT' then new.created_at := now(); end if;
  new.updated_at := now();
  return new;
end $f$;
revoke all on function public.stamp_ballot_time() from public, anon, authenticated;
drop trigger if exists aa_stamp_ballot_time on public.application_ballots;
create trigger aa_stamp_ballot_time before insert or update on public.application_ballots
  for each row execute function public.stamp_ballot_time();

-- 2) A refile rings the Applications desk
create or replace function public.notify_app_refiled() returns trigger
  language plpgsql security definer set search_path to '' as $f$
/* v4.22b: a refiled application is voted afresh ("Fresh vote"), so every reviewer owes a new ballot and is told */
declare v_type text := case when tg_table_name = 'owner_applications' then 'owner' else 'staff' end; v_name text;
begin
  if new.status = 'pending' and old.status in ('withdrawn', 'denied', 'approved') then
    select coalesce(nullif(p.gamertag, ''), p.display_name, 'An applicant') into v_name from public.profiles p where p.id = new.profile_id;
    perform public.notify_department('applications', 'app',
      case when v_type = 'owner' then 'Owner application filed again' else 'Staff application filed again' end,
      v_name || ' filed their ' || v_type || ' application again. It is voted on afresh: votes cast before it was filed again do not count.',
      'application', 'id=' || new.id::text || '&type=' || v_type);
  end if;
  return null;
end $f$;
revoke all on function public.notify_app_refiled() from public, anon, authenticated;
drop trigger if exists on_owner_app_refiled on public.owner_applications;
create trigger on_owner_app_refiled after update of status on public.owner_applications
  for each row execute function public.notify_app_refiled();
drop trigger if exists on_staff_app_refiled on public.staff_applications;
create trigger on_staff_app_refiled after update of status on public.staff_applications
  for each row execute function public.notify_app_refiled();

-- 3) Returning to pending gives up any old waitlist place
create or replace function public.stamp_app_filed_at() returns trigger
  language plpgsql security definer set search_path to '' as $f$
/* v4.22 ("Fresh vote", commissioner 2026-10-19): an application is put before the reviewers when it is filed and
   whenever it returns to pending; no other write moves the stamp. Named zz_ so it fires after every guard, and so
   sees the status the guards settled on (a waitlisted application an applicant tried to re-pend stays waitlisted).
   v4.22b: returning to pending also gives up any old waitlist place (waitlist_remove keeps waitlisted_at, and
   waitlist_application coalesces it, so a refile re-waitlisted later took its old date back). */
begin
  if tg_op = 'INSERT' then
    new.filed_at := now();
  elsif new.status = 'pending' and old.status is distinct from 'pending' then
    new.filed_at := now();
    new.waitlisted_at := null;
  else
    new.filed_at := old.filed_at;
  end if;
  return new;
end $f$;

-- 4) A reviewer waitlists only someone else's pending application (anchored patch, exactly once)
do $p$
declare v_def text;
  v_old text := $o$  /* v4.22: the status move is the office's, so it runs under the decision flag$o$;
  v_new text := $n$  /* v4.22b: like waitlist_admit and waitlist_remove, nobody but a commissioner moves their own application, and
     a reviewer who is not a commissioner waitlists only an application still before the vote */
  if not public.is_commissioner() then
    if exists (select 1 from public.owner_applications o where p_type = 'owner' and o.id = p_id and (o.profile_id = auth.uid() or o.status <> 'pending'))
       or exists (select 1 from public.staff_applications s where p_type = 'staff' and s.id = p_id and (s.profile_id = auth.uid() or s.status <> 'pending')) then
      raise exception 'Only a commissioner can waitlist this application (it is your own, or it is no longer before the vote).' using errcode = '42501';
    end if;
  end if;
  /* v4.22: the status move is the office's, so it runs under the decision flag$n$;
begin
  select pg_get_functiondef('public.waitlist_application(text, uuid)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'patch: waitlist_application anchor matched % times', (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  end if;
  execute replace(v_def, v_old, v_new);
end $p$;

-- self-checks
do $c$
begin
  if not exists (select 1 from pg_trigger where tgname = 'aa_stamp_ballot_time' and tgrelid = 'public.application_ballots'::regclass) then
    raise exception 'self-check: ballots are not stamped by the server';
  end if;
  if (select count(*) from pg_trigger where tgname in ('on_owner_app_refiled', 'on_staff_app_refiled') and not tgisinternal) <> 2 then
    raise exception 'self-check: a refile bell trigger is missing';
  end if;
  if (select prosrc from pg_proc where oid = 'public.stamp_app_filed_at()'::regprocedure) !~ 'new\.waitlisted_at := null;' then
    raise exception 'self-check: a refile keeps its old waitlist place';
  end if;
  if (select prosrc from pg_proc where oid = 'public.waitlist_application(text, uuid)'::regprocedure) !~ 'Only a commissioner can waitlist this application' then
    raise exception 'self-check: a reviewer can still waitlist their own or a decided application';
  end if;
  if has_function_privilege('authenticated', 'public.notify_app_refiled()', 'EXECUTE') or has_function_privilege('authenticated', 'public.stamp_ballot_time()', 'EXECUTE') then
    raise exception 'self-check: a trigger function is callable';
  end if;
end $c$;
