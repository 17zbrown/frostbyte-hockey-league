-- v4.20: an owner applicant may edit a submitted application once.
-- Commissioner, 2026-10-18: "Can you also allow applicants to edit their application one time?" Until now an applicant
-- could resubmit as often as they liked until applications closed. Now the first change to what they wrote (EA ID,
-- time zone, availability, experience, the three franchise picks, the pitch, a proposed name or location, the club
-- choice) is their one edit: the database stamps owner_applications.edited_at and refuses a second change.
-- Not an edit: withdrawing (a status change only), a resubmit that changes nothing, and every office write (decisions
-- under app.app_decide, the review board's award under app.app_award, a commissioner). The applicants already in
-- (six for Season 2) each get their one edit from now on; edits made before today do not count.
-- The window is unchanged: guard_owner_app_deadline still refuses edits once applications close.
-- Owner applications only: a staff application is one permanent row per member, so a single lifetime edit would lock
-- a member out for good. Nothing here posts to Discord.
--
-- REHEARSAL on production, 2026-10-18, in ONE do-block ending in an uncaught raise; verified rolled back (no column,
-- no trigger, the application still pending). Signed in as a Season 2 applicant (a member):
--   a resubmit that changes nothing: edit not used
--   first change (the pitch): accepted, edit stamped
--   second change (a pick): refused "ONE_EDIT: You already used your one edit to this application, on Oct 18 ..."
--   second change through the site's own upsert (insert ... on conflict do update): refused the same way
--   setting edited_at back to null: ignored, still used
--   a commissioner's correction: accepted; the applicant withdrawing after the edit: accepted
-- Applied as migration v420_owner_app_one_edit.

alter table public.owner_applications add column if not exists edited_at timestamptz;
comment on column public.owner_applications.edited_at is
  'v4.20: when the applicant used their one edit (null = not yet). Set only by guard_owner_app_one_edit.';

create or replace function public.guard_owner_app_one_edit() returns trigger
  language plpgsql security definer set search_path to '' as $f$
/* v4.20 (commissioner, 2026-10-18): "allow applicants to edit their application one time." */
begin
  if public.is_commissioner()
     or coalesce(current_setting('app.app_decide', true), '') = 'on'
     or coalesce(current_setting('app.app_award', true), '') = 'on' then
    return new;                                    -- the office's own writes are never the applicant's edit
  end if;
  if tg_op = 'INSERT' then
    new.edited_at := null;                         -- a new application starts with its edit unused
    return new;
  end if;
  new.edited_at := old.edited_at;                  -- only this trigger moves it
  if new.ea_id is not distinct from old.ea_id and new.timezone is not distinct from old.timezone
     and new.availability is not distinct from old.availability and new.experience is not distinct from old.experience
     and new.preferred_club is not distinct from old.preferred_club and new.franchise_2 is not distinct from old.franchise_2
     and new.franchise_3 is not distinct from old.franchise_3 and new.pitch is not distinct from old.pitch
     and new.proposed_location is not distinct from old.proposed_location and new.proposed_name is not distinct from old.proposed_name
     and new.team_choice is not distinct from old.team_choice then
    return new;                                    -- a withdrawal, or a resubmit that changes nothing
  end if;
  if old.edited_at is not null then
    raise exception 'ONE_EDIT: You already used your one edit to this application, on %. To change anything else, message the league office from your application.',
      to_char(old.edited_at at time zone 'America/New_York', 'FMMon FMDD at FMHH12:MI AM "ET"')
      using errcode = 'check_violation';
  end if;
  new.edited_at := now();
  return new;
end $f$;
revoke all on function public.guard_owner_app_one_edit() from public, anon, authenticated;
drop trigger if exists guard_owner_app_one_edit_trg on public.owner_applications;
create trigger guard_owner_app_one_edit_trg before insert or update on public.owner_applications
  for each row execute function public.guard_owner_app_one_edit();

-- self-checks
do $c$
begin
  if not exists (select 1 from pg_trigger where tgname = 'guard_owner_app_one_edit_trg' and tgrelid = 'public.owner_applications'::regclass) then
    raise exception 'self-check: the one-edit trigger is missing';
  end if;
  if has_column_privilege('authenticated', 'public.owner_applications', 'edited_at', 'UPDATE') then
    raise exception 'self-check: an applicant could reset their own edit';
  end if;
  if exists (select 1 from public.owner_applications where edited_at is not null) then
    raise exception 'self-check: an application already shows its edit used';
  end if;
end $c$;
