-- v3.95 (2026-10-13): Season 2 opens on the commissioner's off-season timeline, with owner applications per season.
-- SUPERSEDED IN PART by v4.01: playoff_min_gp is no longer set by hand. The season_playoff_floor_trg trigger writes 30% of
-- the season's length (16 for Season 2), so the 17 below and its check would fail if this record were run again.
--
-- Commissioner, 2026-10-12/13: the off-season after Season 1 runs "final round of playoffs end; the next week's Saturday
-- is when Ownership applications close; the next week after that is when owners are decided on and assigned to their
-- teams; the next week after that is the draft night. Season signups should close at 11:59PM the day before the draft."
-- Rulings: the Saturday of the FOLLOWING week; a draft or cut-off that lands in an observed holiday week moves to the
-- next clear week; EVERYONE REAPPLIES (every club is decided again, sitting Owners included); the Season 2 format is
-- published when sign-ups open. Defaults the commissioner left standing: owner applications close at 11:59 PM ET, no
-- owner application is decided before they close, and the Season 2 playoff floor is 17 (30% of 54, rounded up).
--
-- With Season 1's final scheduled Wed Dec 2 to Fri Dec 4 (Remembrance Day and US Thanksgiving weeks skipped):
--   owner applications close  Sat Dec 12 2026, 11:59 PM ET
--   owners decided            the week of Dec 14, by Sat Dec 19
--   draft                     the week of Dec 21 is Christmas, the week of Dec 28 New Year's: Sat Jan 9 2027, 9:00 PM ET
--   sign-ups close            Fri Jan 8 2027, 11:59 PM ET
--   puck drop                 Wed Jan 13 2027, 9:00 PM ET
-- If Season 1's final moves, these move by the same rule.
--
-- What this changes:
--  1. The Season 2 row: those dates, draft_rounds 10 (the Season 2 spec), playoff_min_gp 17.
--  2. Owner applications are per season. owner_applications was UNIQUE(profile_id) and the site stamped the
--     application with the season being PLAYED, so from the Oct 17 flip every Season 2 application would have been
--     refused against Season 1's Sep 9 deadline, and a Season 1 applicant re-applying would have overwritten his
--     Season 1 row and kept its ballots. Now UNIQUE(profile_id, season_id); the database stamps the season taking
--     registrations on insert and never moves an application to another season.
--  3. No owner application is decided before its season's applications close: the ballot resolver waits, and every
--     other path (a commissioner's decision, waitlisting, a direct update) is refused with the date.
--  4. The Season 2 opening post in #signups says what Season 2 is: announce_lifecycle reads an optional per-season
--     title and text from app_config (ann_title_<n>_reg_open, ann_text_<n>_reg_open).

-- 1. the Season 2 row ------------------------------------------------------------------------------------------------
update public.seasons set
  owner_app_deadline    = timestamptz '2026-12-12 23:59:00 America/New_York',
  signup_deadline_at    = timestamptz '2027-01-08 23:59:00 America/New_York',
  registration_deadline = timestamptz '2027-01-08 23:59:00 America/New_York',
  draft_at              = timestamptz '2027-01-09 21:00:00 America/New_York',
  starts_at             = timestamptz '2027-01-13 21:00:00 America/New_York',
  draft_rounds          = 10,
  playoff_min_gp        = 17
 where number = 2 and status = 'upcoming';
insert into public.app_config (key, value) values ('owner_decision_by_2', '2026-12-19T23:59:00-05:00')
  on conflict (key) do update set value = excluded.value;

-- 2. owner applications per season ----------------------------------------------------------------------------------
alter table public.owner_applications drop constraint if exists owner_applications_profile_id_key;
create unique index if not exists owner_applications_profile_season on public.owner_applications (profile_id, season_id);

create or replace function public.stamp_owner_app_season()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    -- the application is for the season taking registrations, whatever the page sent (a commissioner may file for any)
    if not public.is_commissioner() or new.season_id is null then
      new.season_id := (select id from public.seasons where registration_open and status <> 'complete' order by number desc limit 1);
    end if;
    if new.season_id is null then
      raise exception 'Owner applications are not open right now.' using errcode = '22023';
    end if;
  elsif new.season_id is distinct from old.season_id and not public.is_commissioner() then
    new.season_id := old.season_id;   -- an application never moves to another season
  end if;
  return new;
end $function$;
revoke execute on function public.stamp_owner_app_season() from public, anon, authenticated;
drop trigger if exists aa_stamp_owner_app_season on public.owner_applications;
create trigger aa_stamp_owner_app_season before insert or update on public.owner_applications
  for each row execute function public.stamp_owner_app_season();

-- 3. decided only after applications close ------------------------------------------------------------------------------
create or replace function public._owner_app_decidable(p_app uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select s.owner_app_deadline is null or now() >= s.owner_app_deadline
                     from public.owner_applications a join public.seasons s on s.id = a.season_id where a.id = p_app), true)
$function$;
revoke execute on function public._owner_app_decidable(uuid) from public, anon, authenticated;

create or replace function public.guard_owner_app_hold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_dl timestamptz;
begin
  if new.status is distinct from old.status and new.status in ('approved','denied','waitlisted') then
    select s.owner_app_deadline into v_dl from public.seasons s where s.id = new.season_id;
    if v_dl is not null and now() < v_dl then
      raise exception 'Owner applications for this season are decided after they close on %, not before.',
        to_char(v_dl at time zone 'America/New_York', 'FMDy FMMon FMDD at FMHH12:MI AM') || ' ET'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $function$;
revoke execute on function public.guard_owner_app_hold() from public, anon, authenticated;
drop trigger if exists guard_owner_app_hold_trg on public.owner_applications;
create trigger guard_owner_app_hold_trg before update on public.owner_applications
  for each row execute function public.guard_owner_app_hold();

-- the ballot resolver waits quietly instead of failing the ballot
do $p$
declare v_def text := pg_get_functiondef('public.resolve_application_if_ready(text,uuid)'::regprocedure);
        a text := '  if v_status is null or v_status <> ''pending'' then return; end if;';
        b text := '  if v_status is null or v_status <> ''pending'' then return; end if;
  /* v3.95: an owner application is decided only after its season''s applications close */
  if p_type = ''owner'' and not public._owner_app_decidable(p_id) then return; end if;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.95: resolve_application_if_ready anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- 4. the opening post can carry the season's own words ------------------------------------------------------------------
do $p$
declare v_def text := pg_get_functiondef('public.announce_lifecycle()'::regprocedure);
        a text := 'if public._announce_once(s.number, ''reg_open'', ''discord_signup_webhook'', ''Registration is OPEN'',';
        b text := 'if public._announce_once(s.number, ''reg_open'', ''discord_signup_webhook'',
      coalesce((select value from public.app_config where key = ''ann_title_'' || s.number || ''_reg_open''), ''Registration is OPEN''),
      coalesce((select value from public.app_config where key = ''ann_text_'' || s.number || ''_reg_open''),';
        c text := ''' to be draft-eligible — join later and you''''ll still play, you''''ll just be placed on a club automatically after the draft.'') then v_sent := v_sent + 1; end if;';
        d text := ''' to be draft-eligible — join later and you''''ll still play, you''''ll just be placed on a club automatically after the draft.'')) then v_sent := v_sent + 1; end if;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1
     or (length(v_def) - length(replace(v_def, c, ''))) / length(c) <> 1 then raise exception 'v3.95: announce_lifecycle anchors'; end if;
  execute replace(replace(v_def, a, b), c, d);
end $p$;

insert into public.app_config (key, value) values
  ('ann_title_2_reg_open', 'Season 2 sign-ups and owner applications are open'),
  ('ann_text_2_reg_open',
   'Sign up to play: https://chelgamingleague.com/#/register' || E'\n' ||
   'Sign up by Fri, Jan 8 at 11:59 PM ET to be in the draft on Sat, Jan 9 at 9:00 PM ET. Puck drops Wed, Jan 13.' || E'\n\n' ||
   'Owner applications are open until Sat, Dec 12 at 11:59 PM ET: https://chelgamingleague.com/#/owner' || E'\n' ||
   'Every club is decided again for Season 2, so current Owners apply too. Owners are decided by Sat, Dec 19.' || E'\n\n' ||
   'What changes in Season 2 (10-round draft, a league-wide training camp, Saturday bidding, no weekly game limits): https://chelgamingleague.com/#/rulebook?rule=S2.1')
  on conflict (key) do update set value = excluded.value;

do $chk$
declare v_s record;
begin
  select * into v_s from public.seasons where number = 2;
  if v_s.draft_rounds <> 10 or v_s.playoff_min_gp <> 17
     or v_s.owner_app_deadline <> timestamptz '2026-12-12 23:59:00 America/New_York'
     or v_s.draft_at <> timestamptz '2027-01-09 21:00:00 America/New_York' then
    raise exception 'v3.95: the Season 2 row is not as set';
  end if;
  if exists (select 1 from pg_constraint where conname = 'owner_applications_profile_id_key') then
    raise exception 'v3.95: owner applications are still one per member';
  end if;
  if position('ann_text_' in pg_get_functiondef('public.announce_lifecycle()'::regprocedure)) = 0 then
    raise exception 'v3.95: the opening post does not read its season text';
  end if;
end $chk$;
