-- Rehearsal for sql/2026-11-24-s2-committees-v459.sql. The main session runs it on production as ONE transaction that
-- ends in an uncaught raise, so everything rolls back (CLAUDE.md, Database change protocol step 2). Agents never run it.
--
-- Prerequisites: v4.58 live (it is) and the bid-night record (sql/2026-11-24-s2-bid-nights-*.sql) applied, or its text
-- pasted right after "begin;" (main session, 2026-11-24: bid nights apply first and create can_run_market; this record
-- only widens it, and the first block below refuses to run without it).
--
-- How to run: this whole file in one execute_sql call. It carries the record's text byte for byte
-- (tools/s2-committees-v459.test.cjs pins it). The application tables are locked in SHARE mode for the few seconds it
-- runs, so a member's edit or a reviewer's ballot cannot land between the T0 fingerprint and its check.
--
-- After it (outside the transaction), these must all return nothing (row counts move on their own on production, so the
-- check is on what this rehearsal alone would have left):
--   select to_regclass('public.committees'), to_regclass('public.committee_applications') where to_regclass('public.committees') is not null;
--   select id from public.notifications where link_param like '%type=committee%' or title like 'Committee manager%';
--   select id from public.role_sync_queue where reason = 'committees:seat';
--   select id from public.admin_audit where action like 'committee\_%';
--
-- The people are real members picked inside the transaction by id order (no ids in this file), and every change to them
-- rolls back: K the first commissioner; A, B the first two staff members not banned and not suspended from staff duties;
-- C the next one outside the applications department (so their role change moves no owner, staff or front-office
-- reviewer); R the first applications reviewer (any of them, A or B included); M the first member who is not banned.
-- Cases:
--   T0  applying the record changes no application and no ballot; the electorate count agrees with a direct count.
--   T1  a member (M) and a commissioner (K) cannot apply for a seat.
--   T2  A applies for Draft and Bidding; a second pending filing, a Media committee (none in Season 2) and an empty pitch
--       are refused; every other voter is belled. B applies for Draft and Bidding and for Statistics and imports; C for
--       Community and for Applications.
--   T3  ballot policies: the applicant cannot vote on their own seat (A), a member cannot vote (M); the reviewers' branch
--       is intact: a staffer outside the applications department cannot cast an owner ballot (C), a reviewer can and
--       retracts it (R); T3e (after T4) the candidate reads none of the ballots on their own seat, B reads them all.
--   T4  the staff vote seats A: one approval short of more than half of ALL voters it stays pending, the next approval
--       seats A; B's application for the same seat lapses; audit row and role sync request.
--   T5  can_run_market(): the seated Draft and Bidding manager (A) and a commissioner (K) yes; B and anon no.
--   T6  the staff vote denies B's Statistics application the moment the voters left cannot pass it, not one ballot before;
--       T6d the patched resolve_all_pending_applications (the 15-minute cron and every role change) runs, leaves C's
--       pending applications pending and moves no owner, staff or front-office application.
--   T7  a commissioner decides alone: C seated on Community by K; a decided application is refused out loud; a
--       non-commissioner cannot decide; a commissioner's denial is recorded as theirs.
--   T8  withdraw: only the applicant, only while pending; a new filing is a new application; one member may hold two
--       seats (committee_of in committee order).
--   T9  vacate: nobody else opens a seat; a commissioner needs a reason and the manager is told; the manager steps down;
--       the seat test and can_run_market follow.
--   T10 C leaves the staff through set_member_role: C's Community seat opens and C's pending application lapses. The
--       role change runs with app.app_decide on, so profiles_reviewer_resolve does not re-ask the twelve pending owner
--       votes this record does not touch (it would decide any that passed before applications closed on Nov 28).
--   T11 a ban: B is seated on Statistics and applies for Officiating, then K bans B (the column ban_player writes, under
--       K's claims, read back): the seat opens, the application lapses, B is no voter, the count drops, and B cannot
--       apply. T0 also checks that no banned member is a voter.

begin;

do $pre$
begin
  if to_regprocedure('public.can_run_market()') is null then
    raise exception 'REHEARSAL CANNOT RUN: the bid-night record must be live, or its text pasted right after begin (it creates can_run_market)';
  end if;
end $pre$;

lock table public.owner_applications, public.staff_applications, public.management_applications, public.application_ballots in share mode;

-- the applications and ballots as they stand before the record (T0 compares)
select set_config('rh.apps_before',
  (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.owner_applications x) || '/' ||
  (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.staff_applications x) || '/' ||
  (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.management_applications x) || '/' ||
  (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.application_ballots x), true);

-- >>> record text: sql/2026-11-24-s2-committees-v459.sql
-- v4.59 (2026-11-24): Season 2 staffing groundwork, ADDITIVE. The six staff committees, one manager seat on each, staff
-- applications for an open seat voted by every staff member and commissioner, the seat tests is_committee_manager() and
-- committee_of(), and can_run_market() widened to the seated Draft and Bidding manager. Nothing a department, a
-- reviewer or a staffer can do today changes: the department gates, the discipline ceilings, the staff channels and the
-- owner, staff and front-office vote stay as they are until the flip records (staff powers, all-staff voting).
--
-- The rulings (memory s2-staffing-model.md, league law):
--  * Commissioner, 2026-10-19: "for Season 2, we will remove the different departments, and we will allow every staff
--    member to be a part of one big group. We want to appoint committee managers that have more knowledge and focus in
--    more on a specific topic, but everyone can do any staff role for the most part."
--  * 2026-11-23 (late): SIX committees. Officiating (renamed from "Officiating and discipline"; it also takes all of the
--    removed Game Operations work: lineups and late changes, game-night problems, held games, reschedules and the
--    schedule), Statistics and imports, Applications, Community, Transactions (also position changes), Draft and Bidding
--    (draft night, skipped picks filled at random after the draft, Saturday bidding, the training camp pool).
--  * 2026-11-23: each committee has one manager who prioritizes its topics and is the go-to person. Every staffer has the
--    same vote. Seats have no names yet: current staff APPLY for an unfilled seat and all other staff vote. Commissioners
--    vote too (13 voters, 7 to pass, as ruled), and keep deciding an application alone ("Decide now") while also voting.
--    The ruled 13 counted a staffer banned since 2026-10-05. Main session, 2026-11-24: the electorate excludes banned and
--    staff-suspended members, so on 2026-11-24 it is 11 (8 staff and 3 commissioners) and 6 pass a vote; the commissioner
--    is asked to confirm the figure.
--  * 2026-11-23 (evening): the ONE exception to "no extra powers": the Draft and Bidding manager manages Saturday bidding,
--    may pause and resume it (only they and commissioners), and gets the draft and bidding page tools. Commissioners
--    alone pause and resume until that seat is filled.
--
-- What this record builds:
--  1. public.committees: six rows keyed officiating, statistics, applications, community, transactions and draft (the
--     department keys they replace, so the flip maps has_department('draft') to the 'draft' seat with no translation
--     table; Game Operations has no committee). One manager seat per row (manager_profile_id). Readable by everyone,
--     like the staff directory; written only through the doors below.
--  2. public.committee_applications: a staffer's application for an open seat. A new row per filing, so every filing is
--     voted afresh with no filed_at stamp (the v4.22 "Fresh vote" rule holds by construction). Read by the applicant,
--     the staff and the commissioners; written only through the doors below.
--  3. The vote reuses public.application_ballots with app_type 'committee' (the check constraint widened). Its three
--     write policies keep is_app_reviewer for owner, staff and front-office ballots, byte for byte in effect, and admit a
--     committee ballot from any staff voter who is not the applicant (can_vote_committee_app). trg_ballot_resolve,
--     resolve_application_if_ready (patched: one branch) and resolve_all_pending_applications (patched: one line) carry
--     a committee ballot to _committee_app_resolve. The site's ballot upsert and delete therefore work unchanged.
--  4. The electorate, ONE definition: public.is_staff_voter(uid) and public.staff_voter_count(): every commissioner, and
--     every staff member not suspended from staff duties (is_staff_suspended, the v3.51 rule is_staff() and
--     has_department() apply; a commissioner is never switched off this way), and nobody banned (ban_player keeps the
--     role, so the predicate reads profiles.banned itself). The flip's all-staff vote reuses them.
--  5. The tally, _committee_app_resolve: need = more than half of ALL voters, commissioners included
--     (staff_voter_count() / 2 + 1), over ballots from voters other than the applicant. Approved the moment the approvals
--     reach it; denied the moment so many deny that the voters left cannot reach it. With too few voters to ever reach it
--     the vote never decides, and a commissioner does.
--  6. The decision, _committee_app_decide (vote or commissioner): approval seats the applicant only on an open seat and
--     only while they are on the staff, else the application lapses with the reason; the other pending applications for
--     that seat lapse; bells to the applicant, the staff and the commissioners; an admin_audit row; a Discord role sync
--     request (role_sync_queue) so the committee manager role follows the seat once the flip adds it.
--  7. Doors for the client: apply_committee_seat, withdraw_committee_application, vacate_committee_seat (the holder steps
--     down, or a commissioner opens the seat with a reason). override_application_decision gains the committee type
--     (commissioners decide alone). A staffer who leaves the staff, or is banned, loses their seats and their pending
--     applications lapse (trigger committee_seat_role_change on profiles). A seat candidate cannot read the ballots on
--     their own seat (the owner, staff and front-office applicants never could read theirs); every other voter still can.
--  8. public.is_committee_manager(profile, committee): the POWER test, true only while the holder is on the staff, not
--     suspended from staff duties and not banned. public.committee_of(profile): the SEATS a member holds, in committee
--     order (the staff directory and the Discord roles read it).
--  9. public.can_run_market(): pause, resume, void and the live bids. Main session, 2026-11-24: the bid-night record
--     CREATES it (commissioners only, with the contract's shortcut marker) and applies FIRST; this record only WIDENS it to
--     the seated Draft and Bidding manager, by exact anchor (the marker and "select public.is_commissioner()", each
--     asserted to match exactly once), never creates it, and refuses to apply when it is missing or is any other text.
--     The bids read policy calls it, so the seated manager reads live bidders too (main session, 2026-11-24: identities
--     stay hidden until the lot ends from everyone but whoever can_run_market() allows; the office runs the room).
--
-- Not Season-gated: committees are the staff's structure, not a season's, and nothing here changes a Season 1 path (the
-- patched functions are proven byte-identical but for the committee branch). Nothing posts to Discord: bells only, and
-- the role sync request changes no role until the Discord roles learn the committee seats. No rulebook text: Season 2
-- rules go to the concept's rulebook only (commissioner, 2026-11-23: "Since it is a rule for season 2 and beyond, only
-- add that to the rulings and the site layout for the concept site"); the rulebook stream owns that text.
--
-- Rehearsal: sql/2026-11-24-s2-committees-v459.rehearsal.sql (run by the main session; results recorded at the end of
-- this file). Prerequisites: v4.58 live (it is) and the bid-night record (sql/2026-11-24-s2-bid-nights-*.sql) applied
-- first; apply order: bid nights, then this record.

do $pre$
begin
  if to_regclass('public.committees') is not null or to_regclass('public.committee_applications') is not null then
    raise exception 'v4.59 committees: public.committees or public.committee_applications already exists';
  end if;
  /* v4.59 (main session, 2026-11-24): the bid-night record creates can_run_market and applies first; this one widens it */
  if to_regprocedure('public.can_run_market()') is null then
    raise exception 'v4.59 committees: can_run_market() is missing; apply the bid-night record first (it creates it, this record widens it)';
  end if;
  if to_regprocedure('public.is_staff_suspended(uuid)') is null or to_regprocedure('public.is_staff()') is null
     or to_regprocedure('public.is_commissioner()') is null or to_regprocedure('public.is_app_reviewer(uuid)') is null
     or to_regprocedure('public.log_admin_action(text,text,text,jsonb)') is null
     or to_regprocedure('public.notify_commissioners(uuid[],text,text,text,text,text)') is null
     or to_regprocedure('public.notify_staff_bell(uuid[],text,text,text,text,text)') is null
     or to_regprocedure('public.create_notification(uuid,text,text,text,text,text)') is null
     or to_regprocedure('public._rsq(uuid,text)') is null or to_regprocedure('public.is_banned(uuid)') is null
     or to_regprocedure('public.trg_profiles_resolve()') is null then
    raise exception 'v4.59 committees: a helper this record calls is missing';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.application_ballots'::regclass and conname = 'application_ballots_app_type_check')
     is distinct from $c$CHECK ((app_type = ANY (ARRAY['owner'::text, 'staff'::text, 'management'::text])))$c$ then
    raise exception 'v4.59 committees: application_ballots_app_type_check is not the one this record widens';
  end if;
  /* the three ballot write policies as read on 2026-11-24; the record rewrites them, so they must be what it read */
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'application_ballots'
        and ((policyname = 'reviewer casts own app ballot' and cmd = 'INSERT' and qual is null
              and with_check = '((voter_id = auth.uid()) AND is_app_reviewer(auth.uid()))')
          or (policyname = 'reviewer retracts own app ballot' and cmd = 'DELETE' and with_check is null
              and qual = '((voter_id = auth.uid()) AND is_app_reviewer(auth.uid()))')
          or (policyname = 'reviewer updates own app ballot' and cmd = 'UPDATE' and qual = '(voter_id = auth.uid())'
              and with_check = '((voter_id = auth.uid()) AND is_app_reviewer(auth.uid()))'))) <> 3
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'application_ballots' and cmd <> 'SELECT') <> 3 then
    raise exception 'v4.59 committees: the application_ballots write policies changed since this record was written';
  end if;
  /* the one ballot read policy, as read on 2026-11-24; section 7 narrows it for a seat candidate */
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'application_ballots' and cmd = 'SELECT') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'application_ballots' and cmd = 'SELECT'
                      and policyname = 'office reads app ballots' and qual = '(is_staff() OR is_commissioner())') then
    raise exception 'v4.59 committees: the application_ballots read policy changed since this record was written';
  end if;
end $pre$;

-- 1. the committees and their seats
create table public.committees (
  key text primary key check (key ~ '^[a-z_]+$'),
  name text not null unique check (btrim(name) <> ''),
  sort smallint not null unique,
  charter text not null check (btrim(charter) <> ''),
  manager_profile_id uuid references public.profiles(id) on delete set null,
  manager_since timestamptz
);
comment on table public.committees is
  'v4.59: the Season 2 staff committees (commissioner, 2026-11-23), one manager seat each. Written only through '
  'apply_committee_seat, the vote, override_application_decision and vacate_committee_seat.';
alter table public.committees enable row level security;
revoke all on table public.committees from anon, authenticated;
grant select on table public.committees to anon, authenticated;
create policy "committees are public" on public.committees for select using (true);

/* v4.59: the charters are the rulings' own scope (2026-11-23); the commissioner may reword them in a later record */
insert into public.committees (key, name, sort, charter) values
  ('officiating', 'Officiating', 1,
   'Officiating and discipline, and all game operations: lineups and late changes, game-night problems, held games, reschedules and the schedule.'),
  ('statistics', 'Statistics and imports', 2,
   'Box scores, the EA imports and the Stats manager.'),
  ('applications', 'Applications', 3,
   'Owner, staff and front-office applications.'),
  ('community', 'Community', 4,
   'The league community and its members.'),
  ('transactions', 'Transactions', 5,
   'Trades, waivers and roster moves, and position changes.'),
  ('draft', 'Draft and Bidding', 6,
   'Draft night, skipped picks filled at random after the draft, Saturday bidding and the training camp pool. Its manager may pause and resume bidding and has the draft and bidding page tools.');

-- 2. applications for a seat
create table public.committee_applications (
  id uuid primary key default gen_random_uuid(),
  committee_key text not null references public.committees(key),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pitch text not null check (btrim(pitch) <> '' and length(pitch) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'withdrawn', 'lapsed')),
  response text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.committee_applications is
  'v4.59: a staffer''s application for an open committee manager seat, voted by every staff member and commissioner '
  '(application_ballots, app_type committee). A new row per filing. Written only through the committee doors.';
create unique index committee_applications_one_pending on public.committee_applications (committee_key, profile_id)
  where status = 'pending';
create index committee_applications_profile on public.committee_applications (profile_id);
alter table public.committee_applications enable row level security;
revoke all on table public.committee_applications from anon, authenticated;
grant select on table public.committee_applications to authenticated;
create policy "committee applications read" on public.committee_applications for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_staff() or public.is_commissioner());

-- 3. the electorate and the seat tests
create or replace function public.is_staff_voter(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  /* v4.59 (commissioner, 2026-11-23): every staffer has the same vote, and commissioners vote too. The ONE definition of
     the staff electorate: every commissioner, and every staff member not suspended from staff duties (the v3.51 rule
     is_staff() and has_department() apply; a commissioner is never switched off this way), and nobody banned (main
     session, 2026-11-24; ban_player keeps the role, so the ban is read here). */
  select p_uid is not null and exists (
    select 1 from public.profiles p
     where p.id = p_uid and not p.banned
       and (p.role = 'commissioner' or (p.role = 'staff' and not public.is_staff_suspended(p.id))));
$function$;

create or replace function public.staff_voter_count()
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  /* v4.59: how many are in the staff electorate (is_staff_voter, the same predicate) */
  select count(*)::int from public.profiles p
   where not p.banned and (p.role = 'commissioner' or (p.role = 'staff' and not public.is_staff_suspended(p.id)));
$function$;

create or replace function public.is_committee_manager(p_profile uuid, p_committee text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  /* v4.59: the POWER test of a committee manager seat. True only while the holder is on the staff, not suspended from
     staff duties and not banned, so a seat never outlives the staff role it rests on. A commissioner holds no seat:
     callers ask is_commissioner() beside it. */
  select exists (
    select 1 from public.committees c join public.profiles p on p.id = c.manager_profile_id
     where c.key = p_committee and c.manager_profile_id = p_profile
       and p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id));
$function$;

create or replace function public.committee_of(p_profile uuid)
returns text[]
language sql
stable
security definer
set search_path to ''
as $function$
  /* v4.59: the SEATS a member holds, in committee order (empty when none). The staff directory and the Discord committee
     manager roles read it; is_committee_manager is the power test. */
  select coalesce(array_agg(c.key order by c.sort), '{}'::text[]) from public.committees c where c.manager_profile_id = p_profile;
$function$;

create or replace function public.can_vote_committee_app(p_app uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  /* v4.59: the ballot policies' test for a committee ballot. Any staff voter except the applicant ("all other staff
     vote", 2026-11-23). */
  select public.is_staff_voter(p_uid)
     and exists (select 1 from public.committee_applications a where a.id = p_app and a.profile_id <> p_uid);
$function$;

-- 4. the decision and the tally (internal: no client grant)
create or replace function public._committee_app_decide(p_id uuid, p_approve boolean, p_by uuid)
returns text
language plpgsql
volatile
security definer
set search_path to ''
as $function$
/* v4.59: the ONE decision of a committee manager seat application, by the staff vote (_committee_app_resolve, p_by null)
   or by a commissioner alone (override_application_decision, p_by is that commissioner; ruled 2026-11-23: commissioners
   keep deciding an application alone while also voting). Every door locks the committee row before the application row,
   so a ballot, a decision and a role change never deadlock; the vote and the decision first take the applicant's profile
   row (FOR SHARE), so a role change or a ban that lands at the same moment either finishes first (and the applicant is
   not seated) or waits for the seat and then opens it (committee_seat_role_change). Returns the status it left.
   -- shortcut: two role changes committed in the same instant can deadlock through resolve_all_pending_applications
   (Postgres aborts one, loudly, and the commissioner repeats it); revisit if role changes are ever made in bulk. */
declare
  v_key text;
  v_pid uuid;
  v_c public.committees;
  v_app public.committee_applications;
  v_name text;
  v_why text;
  v_n int;
  v_link text := 'id=' || p_id::text || '&type=committee';
  r record;
begin
  if p_approve is null then raise exception 'Choose approve or deny.'; end if;
  select a.committee_key, a.profile_id into v_key, v_pid from public.committee_applications a where a.id = p_id;
  if v_key is null then raise exception 'Application not found.'; end if;
  perform 1 from public.profiles p where p.id = v_pid for share;
  select * into v_c from public.committees c where c.key = v_key for update;
  select * into v_app from public.committee_applications a where a.id = p_id for update;
  if v_app.status <> 'pending' then
    raise exception 'This application is %, so it cannot be decided here.', v_app.status;
  end if;
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'The applicant') into v_name
    from public.profiles p where p.id = v_app.profile_id;

  if not p_approve then
    update public.committee_applications set status = 'denied', decided_by = p_by, decided_at = now(), updated_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'The committee application could not be decided. Refresh and try again.'; end if;
    perform public.log_admin_action('committee_app_denied', 'committee_application', p_id::text,
      jsonb_build_object('committee', v_key, 'profile', v_app.profile_id, 'by', p_by));
    perform public.create_notification(v_app.profile_id, 'app', 'Committee manager application decision',
      case when p_by is null then 'The staff vote did not seat you' else 'A commissioner decided not to seat you' end
      || ' as manager of the ' || v_c.name || ' committee this time. You may apply again while the seat is open.',
      'application', v_link);
    return 'denied';
  end if;

  /* approval seats only a staff member, and only on an open seat; anything else closes the application with the reason */
  if v_c.manager_profile_id is not null then
    v_why := 'the seat was already filled';
  elsif not exists (select 1 from public.profiles p where p.id = v_app.profile_id and p.role = 'staff') then
    v_why := 'the applicant is no longer on the league staff';
  elsif exists (select 1 from public.profiles p where p.id = v_app.profile_id and p.banned) then
    v_why := 'the applicant is banned';
  end if;
  if v_why is not null then
    update public.committee_applications
       set status = 'lapsed', response = 'Approved but not seated: ' || v_why || '.', decided_by = p_by,
           decided_at = now(), updated_at = now()
     where id = p_id and status = 'pending';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'The committee application could not be closed. Refresh and try again.'; end if;
    perform public.log_admin_action('committee_app_lapsed', 'committee_application', p_id::text,
      jsonb_build_object('committee', v_key, 'profile', v_app.profile_id, 'by', p_by, 'why', v_why));
    perform public.create_notification(v_app.profile_id, 'app', 'Committee manager application closed',
      'Your application to manage the ' || v_c.name || ' committee was approved but could not be applied: ' || v_why || '.',
      'application', v_link);
    perform public.notify_commissioners(null, 'flag', 'Committee seat not filled',
      v_name || '''s application to manage the ' || v_c.name || ' committee was approved but not applied: ' || v_why || '.',
      'application', v_link);
    return 'lapsed';
  end if;

  update public.committees set manager_profile_id = v_app.profile_id, manager_since = now()
   where key = v_key and manager_profile_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'The committee seat could not be filled. Refresh and try again.'; end if;
  update public.committee_applications set status = 'approved', decided_by = p_by, decided_at = now(), updated_at = now()
   where id = p_id and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'The committee application could not be decided. Refresh and try again.'; end if;
  perform public.log_admin_action('committee_seat_filled', 'committee', v_key,
    jsonb_build_object('profile', v_app.profile_id, 'application', p_id, 'by', p_by,
                       'how', case when p_by is null then 'vote' else 'commissioner' end));
  perform public._rsq(v_app.profile_id, 'committees:seat');

  /* the seat is filled, so every other pending application for it closes */
  for r in update public.committee_applications a
              set status = 'lapsed', response = 'The seat was filled by ' || v_name || '.', decided_at = now(), updated_at = now()
            where a.committee_key = v_key and a.status = 'pending' and a.id <> p_id
          returning a.id, a.profile_id loop
    perform public.log_admin_action('committee_app_lapsed', 'committee_application', r.id::text,
      jsonb_build_object('committee', v_key, 'profile', r.profile_id, 'why', 'seat filled'));
    perform public.create_notification(r.profile_id, 'app', 'Committee manager application closed',
      'The ' || v_c.name || ' committee seat was filled by ' || v_name || ', so your application for it is closed.',
      'application', 'id=' || r.id::text || '&type=committee');
  end loop;

  perform public.create_notification(v_app.profile_id, 'role', 'Committee manager seat',
    'You are now the manager of the ' || v_c.name || ' committee'
    || case when p_by is null then ', by the staff vote.' else ', by a commissioner''s decision.' end,
    'staffdesk', null);
  perform public.notify_staff_bell(array[v_app.profile_id], 'role', 'Committee manager seated',
    v_name || ' is now the manager of the ' || v_c.name || ' committee.', 'staffdesk', null);
  perform public.notify_commissioners(case when p_by is null then null else array[p_by] end, 'role', 'Committee manager seated',
    v_name || ' is now the manager of the ' || v_c.name || ' committee.', 'staffdesk', null);
  return 'approved';
end $function$;

create or replace function public._committee_app_resolve(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
/* v4.59: the staff vote on a committee manager seat (commissioner, 2026-11-23: "all other staff vote"; more than half of
   all staff, commissioners included, to pass). Called for every ballot written or retracted (trg_ballot_resolve through
   resolve_application_if_ready) and when the staff changes (resolve_all_pending_applications). Decided the moment it is
   certain, like the v3.68 tally (Q47, "50% +1 out of all the voting staff"): approved when the approvals reach the
   majority of every voter, denied when the voters left can no longer reach it. The applicant counts toward "all staff"
   but casts no ballot (can_vote_committee_app), and a ballot from someone no longer in the electorate does not count.
   -- shortcut: a staff suspension or a ban that starts or ends changes the electorate without a ballot, so the vote is
   asked again at the next ballot, role change or commissioner decision, or by the owner-app-resolve cron
   (resolve_all_pending_applications every 15 minutes), so at most 15 minutes late; revisit if that is ever too slow. */
declare
  v_key text;
  v_pid uuid;
  v_app public.committee_applications;
  v_all int; v_need int; v_pool int; v_yes int; v_no int;
begin
  select a.committee_key, a.profile_id into v_key, v_pid from public.committee_applications a where a.id = p_id;
  if v_key is null then return; end if;
  perform 1 from public.profiles p where p.id = v_pid for share;   -- the applicant's row first, as in _committee_app_decide
  perform 1 from public.committees c where c.key = v_key for update;
  select * into v_app from public.committee_applications a where a.id = p_id for update;
  if v_app.status <> 'pending' then return; end if;
  v_all := public.staff_voter_count();
  v_need := (v_all / 2) + 1;
  v_pool := v_all - (case when public.is_staff_voter(v_app.profile_id) then 1 else 0 end);
  if v_pool < v_need then return; end if;   -- too few voters to ever pass: a commissioner decides it
  select count(*) filter (where b.vote = 'approve'), count(*) filter (where b.vote = 'deny')
    into v_yes, v_no
    from public.application_ballots b
   where b.app_type = 'committee' and b.application_id = p_id
     and b.voter_id <> v_app.profile_id and public.is_staff_voter(b.voter_id);
  if v_yes >= v_need then
    perform public._committee_app_decide(p_id, true, null);
  elsif v_no > v_pool - v_need then
    perform public._committee_app_decide(p_id, false, null);
  end if;
end $function$;

-- 5. the doors
create or replace function public.apply_committee_seat(p_committee text, p_pitch text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
/* v4.59 (commissioner, 2026-11-23): "current staff APPLY for an unfilled seat and all other staff vote". A staff member
   not suspended from staff duties, for an open seat, one pending application per seat. Every other voter is belled. */
declare
  v_uid uuid := auth.uid();
  v_c public.committees;
  v_pitch text := btrim(coalesce(p_pitch, ''));
  v_id uuid;
  v_name text;
  v_link text;
begin
  if v_uid is null then raise exception 'COMMITTEE: Sign in first.' using errcode = '42501'; end if;
  if public.is_commissioner() then
    raise exception 'COMMITTEE: Commissioners already hold every committee power, so they do not apply for a seat.' using errcode = '42501';
  end if;
  if not public.is_staff() then
    raise exception 'COMMITTEE: Only members of the league staff may apply for a committee manager seat.' using errcode = '42501';
  end if;
  if public.is_banned(v_uid) then   -- v4.59: a ban keeps the staff role, so it is asked here (main session, 2026-11-24)
    raise exception 'COMMITTEE: A banned member may not apply for a committee manager seat.' using errcode = '42501';
  end if;
  select * into v_c from public.committees c where c.key = p_committee for update;
  if v_c.key is null then raise exception 'COMMITTEE: That committee was not found.'; end if;
  if v_c.manager_profile_id = v_uid then
    raise exception 'COMMITTEE: You already manage the % committee.', v_c.name;
  end if;
  if v_c.manager_profile_id is not null then
    raise exception 'COMMITTEE: The % committee already has a manager. A seat is applied for only while it is open.', v_c.name;
  end if;
  if v_pitch = '' then raise exception 'COMMITTEE: Tell the staff why you want the seat.'; end if;
  if length(v_pitch) > 2000 then raise exception 'COMMITTEE: Keep it to 2,000 characters.'; end if;
  if exists (select 1 from public.committee_applications a
              where a.committee_key = v_c.key and a.profile_id = v_uid and a.status = 'pending') then
    raise exception 'COMMITTEE: You already applied for this seat. Withdraw that application to file a new one.';
  end if;
  insert into public.committee_applications (committee_key, profile_id, pitch)
  values (v_c.key, v_uid, v_pitch)
  returning id into v_id;
  perform public.log_admin_action('committee_app_filed', 'committee_application', v_id::text,
    jsonb_build_object('committee', v_c.key, 'profile', v_uid));
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'A staff member') into v_name from public.profiles p where p.id = v_uid;
  v_link := 'id=' || v_id::text || '&type=committee';
  perform public.notify_staff_bell(array[v_uid], 'app', 'Committee manager application',
    v_name || ' applied to manage the ' || v_c.name || ' committee. It passes with the approval of more than half of all staff members and commissioners.',
    'application', v_link);
  perform public.notify_commissioners(null, 'app', 'Committee manager application',
    v_name || ' applied to manage the ' || v_c.name || ' committee. It passes with the approval of more than half of all staff members and commissioners.',
    'application', v_link);
  return jsonb_build_object('ok', true, 'id', v_id, 'committee', v_c.key, 'status', 'pending');
end $function$;

create or replace function public.withdraw_committee_application(p_app uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
/* v4.59: the applicant's own pending committee application, at any time; they may file again while the seat is open, and
   the new filing is a new application voted afresh */
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_app public.committee_applications;
  v_cname text;
  v_name text;
  v_n int;
begin
  if v_uid is null then raise exception 'WITHDRAW: Sign in first.' using errcode = '42501'; end if;
  select a.committee_key into v_key from public.committee_applications a where a.id = p_app;
  if v_key is null then raise exception 'WITHDRAW: That application was not found.'; end if;
  select c.name into v_cname from public.committees c where c.key = v_key for update;
  select * into v_app from public.committee_applications a where a.id = p_app for update;
  if v_app.profile_id <> v_uid then
    raise exception 'WITHDRAW: Only the applicant may withdraw their committee application.' using errcode = '42501';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'WITHDRAW: This application is %, so there is nothing to withdraw.', v_app.status;
  end if;
  update public.committee_applications set status = 'withdrawn', updated_at = now()
   where id = p_app and profile_id = v_uid and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'WITHDRAW: The application could not be withdrawn. Refresh the page and try again.'; end if;
  perform public.log_admin_action('committee_app_withdrawn', 'committee_application', p_app::text,
    jsonb_build_object('committee', v_key, 'profile', v_uid));
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'An applicant') into v_name from public.profiles p where p.id = v_uid;
  perform public.notify_staff_bell(array[v_uid], 'app', 'Committee manager application withdrawn',
    v_name || ' withdrew their application to manage the ' || v_cname || ' committee.',
    'application', 'id=' || p_app::text || '&type=committee');
  perform public.notify_commissioners(null, 'app', 'Committee manager application withdrawn',
    v_name || ' withdrew their application to manage the ' || v_cname || ' committee.',
    'application', 'id=' || p_app::text || '&type=committee');
  return jsonb_build_object('ok', true, 'id', p_app, 'status', 'withdrawn');
end $function$;

create or replace function public.vacate_committee_seat(p_committee text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
/* v4.59: a seat opens when its manager steps down, or when a commissioner opens it, with a reason kept on the record and
   sent to the manager. Nobody else opens a seat. A seat is filled again only by a new application and its vote. */
declare
  v_uid uuid := auth.uid();
  v_c public.committees;
  v_holder uuid;
  v_hname text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_self boolean;
  v_n int;
begin
  if v_uid is null then raise exception 'COMMITTEE: Sign in first.' using errcode = '42501'; end if;
  select * into v_c from public.committees c where c.key = p_committee for update;
  if v_c.key is null then raise exception 'COMMITTEE: That committee was not found.'; end if;
  v_holder := v_c.manager_profile_id;
  if v_holder is null then raise exception 'COMMITTEE: The % committee seat is already open.', v_c.name; end if;
  v_self := (v_holder = v_uid);
  if not v_self and not public.is_commissioner() then
    raise exception 'COMMITTEE: Only the committee manager or a commissioner may open this seat.' using errcode = '42501';
  end if;
  if not v_self and v_reason is null then
    raise exception 'COMMITTEE: Give a reason. It is kept on the record and sent to the manager.';
  end if;
  update public.committees set manager_profile_id = null, manager_since = null
   where key = v_c.key and manager_profile_id = v_holder;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'COMMITTEE: The seat could not be opened. Refresh the page and try again.'; end if;
  perform public.log_admin_action('committee_seat_vacated', 'committee', v_c.key,
    jsonb_build_object('profile', v_holder, 'by', v_uid, 'since', v_c.manager_since, 'reason', v_reason,
                       'how', case when v_self then 'stepped down' else 'commissioner' end));
  perform public._rsq(v_holder, 'committees:seat');
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'The manager') into v_hname from public.profiles p where p.id = v_holder;
  if not v_self then
    perform public.create_notification(v_holder, 'role', 'Committee manager seat',
      'A commissioner opened the ' || v_c.name || ' committee seat you held. Reason: ' || v_reason, 'staffdesk', null);
  end if;
  perform public.notify_commissioners(array[v_uid], 'role', 'Committee manager seat open',
    v_hname || case when v_self then ' stepped down as manager of the ' else ' was removed as manager of the ' end
    || v_c.name || ' committee.', 'staffdesk', null);
  perform public.notify_staff_bell(array[v_holder], 'role', 'Committee manager seat open',
    'The ' || v_c.name || ' committee manager seat is open. Any staff member may apply.', 'staffdesk', null);
  return jsonb_build_object('ok', true, 'committee', v_c.key, 'vacated', v_holder);
end $function$;

-- 6. a staffer who leaves the staff, or is banned, leaves their seats, and their pending applications close
create or replace function public.committee_seat_role_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
/* v4.59: a seat rests on the staff role. When a staffer becomes a member (or an Owner through Rule 2.7, or a
   commissioner), or is banned (ban_player keeps the role, so the ban is its own trigger event; main session,
   2026-11-24: a seat must not outlive a ban), their seats open and their pending seat applications lapse, with an audit
   row and a bell to the commissioners. Fires before profiles_reviewer_resolve (name order), so the re-run vote never
   sees them as applicants. */
declare
  v_name text;
  v_left boolean := new.role is distinct from 'staff';
  r record;
begin
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'A former staff member') into v_name from public.profiles p where p.id = new.id;
  for r in update public.committees c set manager_profile_id = null, manager_since = null
            where c.manager_profile_id = new.id
          returning c.key, c.name loop
    perform public.log_admin_action('committee_seat_vacated', 'committee', r.key,
      jsonb_build_object('profile', new.id, 'by', auth.uid(), 'how', case when v_left then 'left the staff' else 'banned' end,
                         'role', new.role));
    perform public.notify_commissioners(null, 'role', 'Committee manager seat open',
      v_name || case when v_left then ' left the league staff' else ' was banned' end
      || ', so the ' || r.name || ' committee manager seat is open.', 'staffdesk', null);
  end loop;
  for r in update public.committee_applications a
              set status = 'lapsed',
                  response = case when v_left then 'The applicant left the league staff.' else 'The applicant was banned.' end,
                  decided_at = now(), updated_at = now()
            where a.profile_id = new.id and a.status = 'pending'
          returning a.id, a.committee_key loop
    perform public.log_admin_action('committee_app_lapsed', 'committee_application', r.id::text,
      jsonb_build_object('committee', r.committee_key, 'profile', new.id,
                         'why', case when v_left then 'left the staff' else 'banned' end));
  end loop;
  return null;
end $function$;

drop trigger if exists committee_seat_role_change on public.profiles;
create trigger committee_seat_role_change after update of role, banned on public.profiles
  for each row when (old.role = 'staff' and (new.role is distinct from 'staff' or (new.banned and not old.banned)))
  execute function public.committee_seat_role_change();

-- 7. the ballots: the committee type, and its voters in the three write policies
alter table public.application_ballots drop constraint application_ballots_app_type_check;
alter table public.application_ballots add constraint application_ballots_app_type_check
  check (app_type = any (array['owner'::text, 'staff'::text, 'management'::text, 'committee'::text]));

alter policy "reviewer casts own app ballot" on public.application_ballots
  with check (voter_id = auth.uid()
              and (case when app_type = 'committee' then public.can_vote_committee_app(application_id, auth.uid())
                        else public.is_app_reviewer(auth.uid()) end));
alter policy "reviewer retracts own app ballot" on public.application_ballots
  using (voter_id = auth.uid()
         and (case when app_type = 'committee' then public.can_vote_committee_app(application_id, auth.uid())
                   else public.is_app_reviewer(auth.uid()) end));
alter policy "reviewer updates own app ballot" on public.application_ballots
  with check (voter_id = auth.uid()
              and (case when app_type = 'committee' then public.can_vote_committee_app(application_id, auth.uid())
                        else public.is_app_reviewer(auth.uid()) end));
/* v4.59: a seat candidate is a staff member, so the office read policy would show them every colleague's ballot on their
   own seat. No applicant of any other type can read the ballots on their application; a seat candidate cannot either.
   Owner, staff and front-office ballots read exactly as before. */
alter policy "office reads app ballots" on public.application_ballots
  using ((public.is_staff() or public.is_commissioner())
         and not (app_type = 'committee'
                  and exists (select 1 from public.committee_applications a
                               where a.id = application_id and a.profile_id = (select auth.uid()))));

-- 8. the vote and the commissioner's decision reach a committee application (patches by exact anchor)
do $patch$
declare
  v_old text; v_def text; a text; b text; v_blk text; n int;
begin
  /* resolve_application_if_ready: one branch before "else return" */
  v_old := pg_get_functiondef('public.resolve_application_if_ready(text,uuid)'::regprocedure);
  a := $a$  elsif p_type = 'management' then select status into v_status from public.management_applications where id = p_id;
  else return; end if;
$a$;
  v_blk := $k$  /* v4.59: a committee manager seat application is voted by every staff member and commissioner, not by the
     reviewers below (commissioner, 2026-11-23): its own tally */
  elsif p_type = 'committee' then perform public._committee_app_resolve(p_id); return;
$k$;
  b := replace(a, '  else return; end if;' || chr(10), v_blk || '  else return; end if;' || chr(10));
  n := (length(v_old) - length(replace(v_old, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.59 committees: resolve_application_if_ready anchor matched % times', n; end if;
  execute replace(v_old, a, b);
  v_def := pg_get_functiondef('public.resolve_application_if_ready(text,uuid)'::regprocedure);
  if replace(v_def, v_blk, '') <> v_old then
    raise exception 'v4.59 committees: resolve_application_if_ready changed by more than the committee branch';
  end if;

  /* resolve_all_pending_applications: committee applications are re-asked when the staff changes */
  v_old := pg_get_functiondef('public.resolve_all_pending_applications()'::regprocedure);
  a := $a$    union all select 'management', id from public.management_applications where status='pending'
  loop
$a$;
  v_blk := $k$    union all select 'committee', id from public.committee_applications where status='pending'   -- v4.59
$k$;
  b := replace(a, '  loop' || chr(10), v_blk || '  loop' || chr(10));
  n := (length(v_old) - length(replace(v_old, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.59 committees: resolve_all_pending_applications anchor matched % times', n; end if;
  execute replace(v_old, a, b);
  v_def := pg_get_functiondef('public.resolve_all_pending_applications()'::regprocedure);
  if replace(v_def, v_blk, '') <> v_old then
    raise exception 'v4.59 committees: resolve_all_pending_applications changed by more than the committee line';
  end if;

  /* override_application_decision: a commissioner decides a committee application alone; the branch goes before the
     v4.21b owner and staff block (and its comment) */
  v_old := pg_get_functiondef('public.override_application_decision(text,uuid,boolean)'::regprocedure);
  a := $a$  /* v4.21b: an owner or staff application that is no longer pending is refused out loud (apply_application_decision
$a$;
  v_blk := $k$  /* v4.59: a committee manager seat application (commissioner, 2026-11-23: commissioners keep deciding alone);
     _committee_app_decide refuses one that is no longer pending, out loud */
  if p_type = 'committee' then
    perform public._committee_app_decide(p_id, p_approve, auth.uid());
    return;
  end if;
$k$;
  b := v_blk || a;
  n := (length(v_old) - length(replace(v_old, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.59 committees: override_application_decision anchor matched % times', n; end if;
  execute replace(v_old, a, b);
  v_def := pg_get_functiondef('public.override_application_decision(text,uuid,boolean)'::regprocedure);
  if replace(v_def, v_blk, '') <> v_old then
    raise exception 'v4.59 committees: override_application_decision changed by more than the committee branch';
  end if;
end $patch$;

-- 9. can_run_market: widened on the bid-night record's text by exact anchor; never created here
do $crm$
declare
  v_old_def text; v_def text; n1 int; n2 int;
  v_marker text := '-- shortcut: commissioners only until a Draft and Bidding manager is seated, widen when committee seats exist';
  v_now text := '/* v4.59: widened to the seated Draft and Bidding manager (commissioner, 2026-11-23) */';
  v_old text := 'select public.is_commissioner()';
  v_new text := 'select (public.is_commissioner() or public.is_committee_manager(auth.uid(), ''draft''))';
begin
  v_old_def := pg_get_functiondef('public.can_run_market()'::regprocedure);
  n1 := (length(v_old_def) - length(replace(v_old_def, v_marker, ''))) / length(v_marker);
  n2 := (length(v_old_def) - length(replace(v_old_def, v_old, ''))) / length(v_old);
  if n1 <> 1 or n2 <> 1 or position('is_committee_manager' in v_old_def) > 0 then
    raise exception 'v4.59 committees: can_run_market() is not the bid-night record''s text (marker %, is_commissioner %); stop and ask', n1, n2;
  end if;
  execute replace(replace(v_old_def, v_marker, v_now), v_old, v_new);
  v_def := pg_get_functiondef('public.can_run_market()'::regprocedure);
  if replace(replace(v_def, v_now, v_marker), v_new, v_old) <> v_old_def then
    raise exception 'v4.59 committees: can_run_market() changed by more than the widening';
  end if;
end $crm$;

-- 10. grants: gate helpers keep anon (policies call them), the doors are for signed-in members, the internals for nobody
revoke all on function public.is_staff_voter(uuid) from public, anon, authenticated;
revoke all on function public.staff_voter_count() from public, anon, authenticated;
revoke all on function public.is_committee_manager(uuid, text) from public, anon, authenticated;
revoke all on function public.committee_of(uuid) from public, anon, authenticated;
revoke all on function public.can_vote_committee_app(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_run_market() from public, anon, authenticated;
revoke all on function public._committee_app_decide(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public._committee_app_resolve(uuid) from public, anon, authenticated;
revoke all on function public.apply_committee_seat(text, text) from public, anon, authenticated;
revoke all on function public.withdraw_committee_application(uuid) from public, anon, authenticated;
revoke all on function public.vacate_committee_seat(text, text) from public, anon, authenticated;
revoke all on function public.committee_seat_role_change() from public, anon, authenticated;
grant execute on function public.is_staff_voter(uuid) to anon, authenticated, service_role;
grant execute on function public.is_committee_manager(uuid, text) to anon, authenticated, service_role;
grant execute on function public.committee_of(uuid) to anon, authenticated, service_role;
grant execute on function public.can_vote_committee_app(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.can_run_market() to anon, authenticated, service_role;
grant execute on function public.staff_voter_count() to authenticated, service_role;
grant execute on function public.apply_committee_seat(text, text) to authenticated, service_role;
grant execute on function public.withdraw_committee_application(uuid) to authenticated, service_role;
grant execute on function public.vacate_committee_seat(text, text) to authenticated, service_role;

-- 11. the staff desk follows seats and applications live, like staff_applications
alter publication supabase_realtime add table public.committees, public.committee_applications;

-- 12. self-checks
do $chk$
declare v_f text;
begin
  if (select string_agg(c.key || ':' || c.name, ',' order by c.sort) from public.committees c)
     <> 'officiating:Officiating,statistics:Statistics and imports,applications:Applications,community:Community,transactions:Transactions,draft:Draft and Bidding'
     or exists (select 1 from public.committees c where c.manager_profile_id is not null) then
    raise exception 'v4.59 committees: the six committees are not as ruled, or a seat is filled';
  end if;
  if exists (select 1 from public.committee_applications) then
    raise exception 'v4.59 committees: committee_applications is not empty';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.committees'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.committee_applications'::regclass) then
    raise exception 'v4.59 committees: row level security is off on a new table';
  end if;
  if has_table_privilege('anon', 'public.committees', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated', 'public.committees', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('anon', 'public.committee_applications', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated', 'public.committee_applications', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or not has_table_privilege('anon', 'public.committees', 'SELECT')
     or not has_table_privilege('authenticated', 'public.committee_applications', 'SELECT') then
    raise exception 'v4.59 committees: a new table carries the wrong API privileges';
  end if;
  foreach v_f in array array['public.is_staff_voter(uuid)', 'public.staff_voter_count()', 'public.is_committee_manager(uuid,text)',
      'public.committee_of(uuid)', 'public.can_vote_committee_app(uuid,uuid)', 'public.can_run_market()',
      'public._committee_app_decide(uuid,boolean,uuid)', 'public._committee_app_resolve(uuid)',
      'public.apply_committee_seat(text,text)', 'public.withdraw_committee_application(uuid)',
      'public.vacate_committee_seat(text,text)', 'public.committee_seat_role_change()'] loop
    if not exists (select 1 from pg_proc p where p.oid = v_f::regprocedure and p.prosecdef
                     and 'search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))) then
      raise exception 'v4.59 committees: % must be SECURITY DEFINER with search_path ''''', v_f;
    end if;
    if has_function_privilege('public', v_f::regprocedure, 'EXECUTE') then
      raise exception 'v4.59 committees: PUBLIC can execute %', v_f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public._committee_app_decide(uuid,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._committee_app_decide(uuid,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public._committee_app_resolve(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._committee_app_resolve(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.apply_committee_seat(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.staff_voter_count()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.apply_committee_seat(text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.withdraw_committee_application(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.vacate_committee_seat(text,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.is_committee_manager(uuid,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.can_run_market()', 'EXECUTE')
     or not has_function_privilege('anon', 'public.can_vote_committee_app(uuid,uuid)', 'EXECUTE') then
    raise exception 'v4.59 committees: a function carries the wrong EXECUTE grant';
  end if;
  if position('committee' in (select pg_get_constraintdef(oid) from pg_constraint
                                where conrelid = 'public.application_ballots'::regclass and conname = 'application_ballots_app_type_check')) = 0 then
    raise exception 'v4.59 committees: application_ballots does not accept a committee ballot';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'application_ballots' and cmd <> 'SELECT'
        and position('can_vote_committee_app(application_id, auth.uid())' in coalesce(with_check, qual)) > 0
        and position('is_app_reviewer(auth.uid())' in coalesce(with_check, qual)) > 0) <> 3 then
    raise exception 'v4.59 committees: a ballot write policy lacks the committee voters or lost the reviewers';
  end if;
  if position('perform public._committee_app_resolve(p_id); return;' in pg_get_functiondef('public.resolve_application_if_ready(text,uuid)'::regprocedure)) = 0
     or position('from public.committee_applications where status=''pending''' in pg_get_functiondef('public.resolve_all_pending_applications()'::regprocedure)) = 0
     or position('perform public._committee_app_decide(p_id, p_approve, auth.uid());' in pg_get_functiondef('public.override_application_decision(text,uuid,boolean)'::regprocedure)) = 0 then
    raise exception 'v4.59 committees: a patch is missing';
  end if;
  if position('public.is_committee_manager(auth.uid(), ''draft'')' in pg_get_functiondef('public.can_run_market()'::regprocedure)) = 0 then
    raise exception 'v4.59 committees: can_run_market() is not widened to the Draft and Bidding manager';
  end if;
  /* AFTER triggers fire in name order: the seat trigger must run before the re-run vote, whatever it is named */
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'committee_seat_role_change'
                   and t.tgfoid = 'public.committee_seat_role_change()'::regprocedure and t.tgenabled = 'O' and t.tgqual is not null)
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal
                      and t.tgfoid = 'public.trg_profiles_resolve()'::regprocedure)
     or exists (select 1 from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and not t.tgisinternal
                  and t.tgfoid = 'public.trg_profiles_resolve()'::regprocedure
                  and t.tgname::text collate "C" <= 'committee_seat_role_change' collate "C") then
    raise exception 'v4.59 committees: the role change trigger is missing or would fire after the re-run vote (trg_profiles_resolve)';
  end if;
  if exists (select 1 from public.profiles p where p.banned and public.is_staff_voter(p.id))
     or public.staff_voter_count() <> (select count(*) from public.profiles p where public.is_staff_voter(p.id)) then
    raise exception 'v4.59 committees: a banned member is a voter, or the count and the predicate disagree';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'application_ballots' and cmd = 'SELECT'
                   and policyname = 'office reads app ballots' and position('committee_applications' in qual) > 0
                   and position('is_staff()' in qual) > 0 and position('is_commissioner()' in qual) > 0) then
    raise exception 'v4.59 committees: the ballot read policy does not keep a seat candidate off their own ballots';
  end if;
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in ('committees', 'committee_applications')) <> 2 then
    raise exception 'v4.59 committees: the new tables are not in supabase_realtime';
  end if;
  /* probes: no seat is filled, so the widened gate is still commissioners only */
  if public.is_committee_manager(null, 'draft') or public.committee_of(null) <> '{}'::text[]
     or public.staff_voter_count() < 1 or public.is_staff_voter(null) then
    raise exception 'v4.59 committees: a seat test answers wrongly on an empty seat';
  end if;
  raise notice 'v4.59 committees: % staff voters, % to pass a seat', public.staff_voter_count(), public.staff_voter_count() / 2 + 1;
end $chk$;

/* REHEARSAL on production, 2026-11-24 (main session), one transaction rolled back by its closing raise, with the bid-nights
   record prepended: REHEARSAL OK: T0 to T11 (11 voters, 6 to pass, 5 denials to fail).
   Applied 2026-11-24 as migration v459b_s2_committees, after v459_s2_bid_nights; tools/sql/grant-audit.sql returned zero rows. */
-- <<< record text

-- T0 and the people
do $p$
declare
  v_k uuid; v_a uuid; v_b uuid; v_c uuid; v_r uuid; v_m uuid; v_all int; v_need int;
begin
  if (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.owner_applications x) || '/' ||
     (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.staff_applications x) || '/' ||
     (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.management_applications x) || '/' ||
     (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.application_ballots x)
     <> current_setting('rh.apps_before') then
    raise exception 'T0 failed: applying the record changed an application or a ballot';
  end if;
  select p.id into v_k from public.profiles p where p.role = 'commissioner' order by p.id limit 1;
  select p.id into v_a from public.profiles p where p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id)
   order by p.id limit 1;
  select p.id into v_b from public.profiles p where p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id)
     and p.id <> v_a order by p.id limit 1;
  select p.id into v_c from public.profiles p where p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id)
     and p.id <> v_a and p.id <> v_b and not ('applications' = any(coalesce(p.departments, '{}'::text[]))) order by p.id limit 1;
  select p.id into v_r from public.profiles p where p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id)
     and 'applications' = any(coalesce(p.departments, '{}'::text[])) order by p.id limit 1;
  select p.id into v_m from public.profiles p where p.role = 'member' and not coalesce(p.banned, false) order by p.id limit 1;
  if v_k is null or v_a is null or v_b is null or v_c is null or v_r is null or v_m is null then
    raise exception 'REHEARSAL CANNOT RUN: the people are missing (K %, A %, B %, C %, R %, M %)',
      v_k is not null, v_a is not null, v_b is not null, v_c is not null, v_r is not null, v_m is not null;
  end if;
  v_all := public.staff_voter_count();
  v_need := v_all / 2 + 1;
  if v_all <> (select count(*) from public.profiles p
                where not p.banned and (p.role = 'commissioner' or (p.role = 'staff' and not public.is_staff_suspended(p.id)))) then
    raise exception 'T0 failed: staff_voter_count disagrees with a direct count';
  end if;
  if exists (select 1 from public.profiles p where p.banned and public.is_staff_voter(p.id)) then
    raise exception 'T0 failed: a banned member is in the staff electorate';
  end if;
  if v_all - 1 < v_need + 1 then
    raise exception 'REHEARSAL CANNOT RUN: % voters are too few for the vote cases', v_all;
  end if;
  perform set_config('rh.k', v_k::text, true);
  perform set_config('rh.a', v_a::text, true);
  perform set_config('rh.b', v_b::text, true);
  perform set_config('rh.c', v_c::text, true);
  perform set_config('rh.r', v_r::text, true);
  perform set_config('rh.m', v_m::text, true);
  perform set_config('rh.all', v_all::text, true);
  perform set_config('rh.need', v_need::text, true);
  perform set_config('rh.va', (select string_agg(p.id::text, ',' order by p.id) from public.profiles p
                                where public.is_staff_voter(p.id) and p.id <> v_a), true);
  perform set_config('rh.vb', (select string_agg(p.id::text, ',' order by p.id) from public.profiles p
                                where public.is_staff_voter(p.id) and p.id <> v_b), true);
  perform set_config('rh.bells', ((select count(*) from public.profiles p where p.role = 'staff' and p.id <> v_a)
                                  + (select count(*) from public.profiles p where p.role = 'commissioner'))::text, true);
end $p$;

-- T1: a member and a commissioner cannot apply; a member cannot vote (T3b) once A has applied
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.m'), 'role', 'authenticated')::text, true);
do $t1a$
begin
  perform public.apply_committee_seat('draft', 'Rehearsal pitch.');
  raise exception 'T1a failed: a member applied for a seat';
exception when others then
  if sqlerrm <> 'COMMITTEE: Only members of the league staff may apply for a committee manager seat.' then raise; end if;
end $t1a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $t1b$
begin
  perform public.apply_committee_seat('draft', 'Rehearsal pitch.');
  raise exception 'T1b failed: a commissioner applied for a seat';
exception when others then
  if sqlerrm <> 'COMMITTEE: Commissioners already hold every committee power, so they do not apply for a seat.' then raise; end if;
end $t1b$;

-- T2: the applications
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.a'), 'role', 'authenticated')::text, true);
do $t2a$
declare j jsonb;
begin
  j := public.apply_committee_seat('draft', 'Rehearsal pitch: I want to run bid nights.');
  if j->>'status' is distinct from 'pending' or j->>'committee' is distinct from 'draft' then
    raise exception 'T2a failed: %', j;
  end if;
  perform set_config('rh.a_draft', j->>'id', true);
  begin
    perform public.apply_committee_seat('draft', 'Again.');
    raise exception 'T2b failed: a second pending application for one seat';
  exception when others then
    if sqlerrm <> 'COMMITTEE: You already applied for this seat. Withdraw that application to file a new one.' then raise; end if;
  end;
  begin
    perform public.apply_committee_seat('media', 'Rehearsal pitch.');
    raise exception 'T2c failed: a Media committee took an application';
  exception when others then
    if sqlerrm <> 'COMMITTEE: That committee was not found.' then raise; end if;
  end;
  begin
    perform public.apply_committee_seat('statistics', '   ');
    raise exception 'T2d failed: an empty pitch was filed';
  exception when others then
    if sqlerrm <> 'COMMITTEE: Tell the staff why you want the seat.' then raise; end if;
  end;
  /* T3a: the applicant cannot vote on their own seat */
  begin
    insert into public.application_ballots (app_type, application_id, voter_id, vote)
    values ('committee', current_setting('rh.a_draft')::uuid, current_setting('rh.a')::uuid, 'approve');
    raise exception 'T3a failed: the applicant voted on their own seat';
  exception when others then
    if sqlerrm not like 'new row violates row-level security policy%' then raise; end if;
  end;
end $t2a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
do $t2e$
begin
  perform set_config('rh.b_draft', public.apply_committee_seat('draft', 'Rehearsal pitch: draft night.')->>'id', true);
  perform set_config('rh.b_stats', public.apply_committee_seat('statistics', 'Rehearsal pitch: box scores.')->>'id', true);
end $t2e$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.c'), 'role', 'authenticated')::text, true);
do $t2f$
begin
  perform set_config('rh.c_comm', public.apply_committee_seat('community', 'Rehearsal pitch: the community.')->>'id', true);
  perform set_config('rh.c_apps', public.apply_committee_seat('applications', 'Rehearsal pitch: applications.')->>'id', true);
  /* T3c: the reviewers' branch is intact: a staffer outside the applications department casts no owner ballot */
  begin
    insert into public.application_ballots (app_type, application_id, voter_id, vote)
    values ('owner', gen_random_uuid(), current_setting('rh.c')::uuid, 'approve');
    raise exception 'T3c failed: a staffer outside the applications department cast an owner ballot';
  exception when others then
    if sqlerrm not like 'new row violates row-level security policy%' then raise; end if;
  end;
end $t2f$;

-- T3b: a member cannot vote; T3d: a reviewer still casts and retracts an owner ballot
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.m'), 'role', 'authenticated')::text, true);
do $t3b$
begin
  insert into public.application_ballots (app_type, application_id, voter_id, vote)
  values ('committee', current_setting('rh.a_draft')::uuid, current_setting('rh.m')::uuid, 'approve');
  raise exception 'T3b failed: a member voted on a committee seat';
exception when others then
  if sqlerrm not like 'new row violates row-level security policy%' then raise; end if;
end $t3b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.r'), 'role', 'authenticated')::text, true);
do $t3d$
declare v_id uuid; v_n int;
begin
  insert into public.application_ballots (app_type, application_id, voter_id, vote)
  values ('owner', gen_random_uuid(), current_setting('rh.r')::uuid, 'approve')
  returning id into v_id;
  delete from public.application_ballots where id = v_id and voter_id = current_setting('rh.r')::uuid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'T3d failed: a reviewer could not retract their owner ballot'; end if;
end $t3d$;

-- T4: the staff vote seats A
do $t4a$
declare v text[] := string_to_array(current_setting('rh.va'), ','); i int; v_need int := current_setting('rh.need')::int;
begin
  for i in 1 .. v_need - 1 loop
    perform set_config('request.jwt.claims', json_build_object('sub', v[i], 'role', 'authenticated')::text, true);
    insert into public.application_ballots (app_type, application_id, voter_id, vote)
    values ('committee', current_setting('rh.a_draft')::uuid, v[i]::uuid, 'approve');
  end loop;
end $t4a$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t4b$
begin
  if (select a.status from public.committee_applications a where a.id = current_setting('rh.a_draft')::uuid) <> 'pending'
     or (select c.manager_profile_id from public.committees c where c.key = 'draft') is not null then
    raise exception 'T4b failed: the seat was decided one approval short of the majority of all voters';
  end if;
end $t4b$;
set local role authenticated;
do $t4c$
declare v text[] := string_to_array(current_setting('rh.va'), ','); v_need int := current_setting('rh.need')::int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v[v_need], 'role', 'authenticated')::text, true);
  insert into public.application_ballots (app_type, application_id, voter_id, vote)
  values ('committee', current_setting('rh.a_draft')::uuid, v[v_need]::uuid, 'approve');
end $t4c$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t4d$
declare v_a uuid := current_setting('rh.a')::uuid;
begin
  if (select a.status from public.committee_applications a where a.id = current_setting('rh.a_draft')::uuid) <> 'approved'
     or (select a.decided_by from public.committee_applications a where a.id = current_setting('rh.a_draft')::uuid) is not null
     or (select c.manager_profile_id from public.committees c where c.key = 'draft') is distinct from v_a
     or (select c.manager_since from public.committees c where c.key = 'draft') is null then
    raise exception 'T4d failed: the majority of all voters did not seat A';
  end if;
  if (select a.status from public.committee_applications a where a.id = current_setting('rh.b_draft')::uuid) <> 'lapsed'
     or (select a.response from public.committee_applications a where a.id = current_setting('rh.b_draft')::uuid) not like 'The seat was filled by %.'
     or (select a.status from public.committee_applications a where a.id = current_setting('rh.b_stats')::uuid) <> 'pending' then
    raise exception 'T4e failed: B''s application for the filled seat did not lapse, or another seat''s did';
  end if;
  if not public.is_committee_manager(v_a, 'draft') or public.is_committee_manager(v_a, 'statistics')
     or public.committee_of(v_a) <> array['draft'] then
    raise exception 'T4f failed: the seat tests do not see A on Draft and Bidding';
  end if;
  if (select count(*) from public.admin_audit au where au.action = 'committee_seat_filled' and au.target_id = 'draft'
        and au.detail->>'profile' = v_a::text and au.detail->>'how' = 'vote') <> 1
     or not exists (select 1 from public.role_sync_queue q where q.profile_id = v_a and q.reason = 'committees:seat') then
    raise exception 'T4g failed: no audit row or role sync request for the seat';
  end if;
  if (select count(*) from public.notifications n
       where n.link_param = 'id=' || current_setting('rh.a_draft') || '&type=committee' and n.title = 'Committee manager application')
     <> current_setting('rh.bells')::int then
    raise exception 'T2g failed: the application did not bell every other staff member and commissioner once';
  end if;
end $t4d$;

-- T3e: the candidate reads none of the ballots on their own seat; another staffer reads them all
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.a'), 'role', 'authenticated')::text, true);
select set_config('rh.ballots_a', (select count(*) from public.application_ballots b
                                    where b.application_id = current_setting('rh.a_draft')::uuid)::text, true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
select set_config('rh.ballots_b', (select count(*) from public.application_ballots b
                                    where b.application_id = current_setting('rh.a_draft')::uuid)::text, true);

-- T5: can_run_market
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.a'), 'role', 'authenticated')::text, true);
select set_config('rh.crm_a', public.can_run_market()::text, true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
select set_config('rh.crm_b', public.can_run_market()::text, true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
select set_config('rh.crm_k', public.can_run_market()::text, true);
set local role anon;
select set_config('request.jwt.claims', '', true);
select set_config('rh.crm_anon', public.can_run_market()::text, true);
set local role authenticated;

-- T6: the staff vote denies B's Statistics application the moment it cannot pass
do $t6a$
declare v text[] := string_to_array(current_setting('rh.vb'), ','); i int;
        v_d int := (current_setting('rh.all')::int - 1) - current_setting('rh.need')::int + 1;
begin
  perform set_config('rh.deny', v_d::text, true);
  for i in 1 .. v_d - 1 loop
    perform set_config('request.jwt.claims', json_build_object('sub', v[i], 'role', 'authenticated')::text, true);
    insert into public.application_ballots (app_type, application_id, voter_id, vote)
    values ('committee', current_setting('rh.b_stats')::uuid, v[i]::uuid, 'deny');
  end loop;
end $t6a$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t6b$
begin
  if (select a.status from public.committee_applications a where a.id = current_setting('rh.b_stats')::uuid) <> 'pending' then
    raise exception 'T6b failed: denied while the voters left could still pass it';
  end if;
end $t6b$;
set local role authenticated;
do $t6c$
declare v text[] := string_to_array(current_setting('rh.vb'), ','); v_d int := current_setting('rh.deny')::int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v[v_d], 'role', 'authenticated')::text, true);
  insert into public.application_ballots (app_type, application_id, voter_id, vote)
  values ('committee', current_setting('rh.b_stats')::uuid, v[v_d]::uuid, 'deny');
end $t6c$;

-- T6d: the patched resolve_all_pending_applications runs (the cron and every role change call it)
reset role;
select set_config('request.jwt.claims', '', true);
do $t6d$
declare v_fp text;
begin
  v_fp := (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.owner_applications x) || '/' ||
          (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.staff_applications x) || '/' ||
          (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.management_applications x);
  perform public.resolve_all_pending_applications();
  if (select a.status from public.committee_applications a where a.id = current_setting('rh.c_comm')::uuid) <> 'pending'
     or (select a.status from public.committee_applications a where a.id = current_setting('rh.c_apps')::uuid) <> 'pending' then
    raise exception 'T6d failed: resolve_all_pending_applications decided a committee application with no ballots';
  end if;
  if (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.owner_applications x) || '/' ||
     (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.staff_applications x) || '/' ||
     (select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.management_applications x) <> v_fp then
    raise exception 'T6d failed: resolve_all_pending_applications decided an owner, staff or front-office application (the 15-minute cron would decide it too; rerun after it has)';
  end if;
end $t6d$;
set local role authenticated;

-- T7: a commissioner decides alone
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.a'), 'role', 'authenticated')::text, true);
do $t7a$
begin
  perform public.override_application_decision('committee', current_setting('rh.c_comm')::uuid, true);
  raise exception 'T7a failed: a staffer decided a committee application alone';
exception when others then
  if sqlerrm <> 'Only a commissioner can override the reviewer vote.' then raise; end if;
end $t7a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $t7b$
begin
  perform public.override_application_decision('committee', current_setting('rh.c_comm')::uuid, true);
  begin
    perform public.override_application_decision('committee', current_setting('rh.c_comm')::uuid, false);
    raise exception 'T7c failed: a decided committee application was decided again';
  exception when others then
    if sqlerrm <> 'This application is approved, so it cannot be decided here.' then raise; end if;
  end;
end $t7b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
do $t7d$
begin
  perform set_config('rh.b_off', public.apply_committee_seat('officiating', 'Rehearsal pitch: officiating.')->>'id', true);
end $t7d$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $t7e$
begin
  perform public.override_application_decision('committee', current_setting('rh.b_off')::uuid, false);
end $t7e$;

-- T8: withdraw, a new filing, two seats
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.a'), 'role', 'authenticated')::text, true);
do $t8a$
begin
  perform set_config('rh.a_tx', public.apply_committee_seat('transactions', 'Rehearsal pitch: trades.')->>'id', true);
end $t8a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
do $t8b$
begin
  perform public.withdraw_committee_application(current_setting('rh.a_tx')::uuid);
  raise exception 'T8b failed: someone else withdrew an application';
exception when others then
  if sqlerrm <> 'WITHDRAW: Only the applicant may withdraw their committee application.' then raise; end if;
end $t8b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.a'), 'role', 'authenticated')::text, true);
do $t8c$
declare j jsonb;
begin
  j := public.withdraw_committee_application(current_setting('rh.a_tx')::uuid);
  if j->>'status' is distinct from 'withdrawn' then raise exception 'T8c failed: %', j; end if;
  begin
    perform public.withdraw_committee_application(current_setting('rh.a_tx')::uuid);
    raise exception 'T8d failed: a withdrawn application was withdrawn again';
  exception when others then
    if sqlerrm <> 'WITHDRAW: This application is withdrawn, so there is nothing to withdraw.' then raise; end if;
  end;
  perform set_config('rh.a_tx2', public.apply_committee_seat('transactions', 'Rehearsal pitch: trades, again.')->>'id', true);
  if current_setting('rh.a_tx2') = current_setting('rh.a_tx') then raise exception 'T8e failed: a new filing reused the old application'; end if;
end $t8c$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $t8f$
begin
  perform public.override_application_decision('committee', current_setting('rh.a_tx2')::uuid, true);
  if public.committee_of(current_setting('rh.a')::uuid) <> array['transactions', 'draft'] then
    raise exception 'T8f failed: committee_of is not the two seats in committee order';
  end if;
end $t8f$;

-- T9: vacate
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
do $t9a$
begin
  perform public.vacate_committee_seat('draft', 'Rehearsal.');
  raise exception 'T9a failed: a staffer opened another manager''s seat';
exception when others then
  if sqlerrm <> 'COMMITTEE: Only the committee manager or a commissioner may open this seat.' then raise; end if;
end $t9a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $t9b$
begin
  begin
    perform public.vacate_committee_seat('draft', '  ');
    raise exception 'T9b failed: a commissioner opened a seat with no reason';
  exception when others then
    if sqlerrm <> 'COMMITTEE: Give a reason. It is kept on the record and sent to the manager.' then raise; end if;
  end;
  perform public.vacate_committee_seat('draft', 'Rehearsal: opened by a commissioner.');
end $t9b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.a'), 'role', 'authenticated')::text, true);
select set_config('rh.crm_a2', public.can_run_market()::text, true);
do $t9c$
begin
  perform public.vacate_committee_seat('transactions', null);
  begin
    perform public.vacate_committee_seat('transactions', null);
    raise exception 'T9d failed: an open seat was opened again';
  exception when others then
    if sqlerrm <> 'COMMITTEE: The Transactions committee seat is already open.' then raise; end if;
  end;
end $t9c$;

-- T10: C leaves the staff through the commissioner's door
reset role;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $t10$
begin
  perform set_config('app.app_decide', 'on', true);
  perform public.set_member_role(current_setting('rh.c')::uuid, 'member');
  perform set_config('app.app_decide', '', true);
end $t10$;

-- T11: a ban opens the seat and closes the application, and the banned staffer is no voter and cannot apply
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
do $t11a$
begin
  perform set_config('rh.b_stats2', public.apply_committee_seat('statistics', 'Rehearsal pitch: box scores, again.')->>'id', true);
  perform set_config('rh.b_off2', public.apply_committee_seat('officiating', 'Rehearsal pitch: officiating, again.')->>'id', true);
end $t11a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $t11b$
begin
  perform public.override_application_decision('committee', current_setting('rh.b_stats2')::uuid, true);
  if not public.is_committee_manager(current_setting('rh.b')::uuid, 'statistics') then
    raise exception 'T11 failed: B was not seated on Statistics before the ban';
  end if;
end $t11b$;
reset role;
do $t11c$
declare v_n int;
begin
  /* the column ban_player writes, under K's claims (guard_profile_role keeps a commissioner's write), read back */
  update public.profiles set banned = true, banned_at = now(), banned_by = current_setting('rh.k')::uuid
   where id = current_setting('rh.b')::uuid and not banned;
  get diagnostics v_n = row_count;
  if v_n <> 1 or not (select p.banned from public.profiles p where p.id = current_setting('rh.b')::uuid) then
    raise exception 'T11 failed: the ban did not stand on B''s profile';
  end if;
end $t11c$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
do $t11d$
begin
  perform public.apply_committee_seat('community', 'Rehearsal pitch: banned.');
  raise exception 'T11 failed: a banned staffer applied for a seat';
exception when others then
  if sqlerrm <> 'COMMITTEE: A banned member may not apply for a committee manager seat.' then raise; end if;
end $t11d$;
reset role;
select set_config('request.jwt.claims', '', true);

-- the verdict
do $v$
declare v_a uuid := current_setting('rh.a')::uuid; v_c uuid := current_setting('rh.c')::uuid; v_k uuid := current_setting('rh.k')::uuid;
begin
  if current_setting('rh.crm_a') <> 'true' or current_setting('rh.crm_k') <> 'true'
     or current_setting('rh.crm_b') <> 'false' or current_setting('rh.crm_anon') <> 'false' then
    raise exception 'T5 failed: can_run_market A %, K %, B %, anon %', current_setting('rh.crm_a'), current_setting('rh.crm_k'),
      current_setting('rh.crm_b'), current_setting('rh.crm_anon');
  end if;
  if (select a.status from public.committee_applications a where a.id = current_setting('rh.b_stats')::uuid) <> 'denied'
     or (select a.decided_by from public.committee_applications a where a.id = current_setting('rh.b_stats')::uuid) is not null
     or (select c.manager_profile_id from public.committees c where c.key = 'statistics') is not null then
    raise exception 'T6c failed: the vote did not deny B the moment it could no longer pass';
  end if;
  if (select a.status from public.committee_applications a where a.id = current_setting('rh.c_comm')::uuid) <> 'approved'
     or (select a.decided_by from public.committee_applications a where a.id = current_setting('rh.c_comm')::uuid) is distinct from v_k then
    raise exception 'T7b failed: the commissioner''s decision did not seat C or is not recorded as theirs';
  end if;
  if (select a.status from public.committee_applications a where a.id = current_setting('rh.b_off')::uuid) <> 'denied'
     or (select a.decided_by from public.committee_applications a where a.id = current_setting('rh.b_off')::uuid) is distinct from v_k then
    raise exception 'T7e failed: the commissioner''s denial is not recorded as theirs';
  end if;
  if (select a.status from public.committee_applications a where a.id = current_setting('rh.a_tx')::uuid) <> 'withdrawn' then
    raise exception 'T8c failed: the withdrawn application moved';
  end if;
  if current_setting('rh.crm_a2') <> 'false' or public.is_committee_manager(v_a, 'draft')
     or public.committee_of(v_a) <> '{}'::text[]
     or exists (select 1 from public.committees c where c.key in ('draft', 'transactions') and c.manager_profile_id is not null) then
    raise exception 'T9 failed: a vacated seat still answers for A';
  end if;
  if (select count(*) from public.notifications n where n.profile_id = v_a and n.title = 'Committee manager seat'
        and n.body = 'A commissioner opened the Draft and Bidding committee seat you held. Reason: Rehearsal: opened by a commissioner.') <> 1
     or (select count(*) from public.admin_audit au where au.action = 'committee_seat_vacated' and au.detail->>'profile' = v_a::text) <> 2 then
    raise exception 'T9e failed: the manager was not told, or the openings are not on the record';
  end if;
  if (select c.manager_profile_id from public.committees c where c.key = 'community') is not null
     or (select a.status from public.committee_applications a where a.id = current_setting('rh.c_apps')::uuid) <> 'lapsed'
     or (select a.response from public.committee_applications a where a.id = current_setting('rh.c_apps')::uuid)
        <> 'The applicant left the league staff.'
     or public.is_staff_voter(v_c)
     or (select count(*) from public.admin_audit au where au.action = 'committee_seat_vacated' and au.target_id = 'community'
           and au.detail->>'how' = 'left the staff') <> 1 then
    raise exception 'T10 failed: leaving the staff did not open C''s seat and close C''s application';
  end if;
  if current_setting('rh.ballots_a') <> '0' or current_setting('rh.ballots_b') <> current_setting('rh.need') then
    raise exception 'T3e failed: the candidate read % ballots on their own seat, another staffer read % of %',
      current_setting('rh.ballots_a'), current_setting('rh.ballots_b'), current_setting('rh.need');
  end if;
  if (select c.manager_profile_id from public.committees c where c.key = 'statistics') is not null
     or public.committee_of(current_setting('rh.b')::uuid) <> '{}'::text[]
     or (select a.status from public.committee_applications a where a.id = current_setting('rh.b_off2')::uuid) <> 'lapsed'
     or (select a.response from public.committee_applications a where a.id = current_setting('rh.b_off2')::uuid) <> 'The applicant was banned.'
     or public.is_staff_voter(current_setting('rh.b')::uuid)
     or public.staff_voter_count() <> (select count(*) from public.profiles p
                                         where not p.banned and (p.role = 'commissioner' or (p.role = 'staff' and not public.is_staff_suspended(p.id))))
     or public.staff_voter_count() <> current_setting('rh.all')::int - 2
     or (select count(*) from public.admin_audit au where au.action = 'committee_seat_vacated' and au.target_id = 'statistics'
           and au.detail->>'how' = 'banned' and au.detail->>'profile' = current_setting('rh.b')) <> 1 then
    raise exception 'T11 failed: the ban did not open B''s seat, close B''s application and take B out of the electorate';
  end if;
  raise exception 'REHEARSAL OK: T0 T1a T1b T2a T2b T2c T2d T2e T2f T2g T3a T3b T3c T3d T3e T4a T4b T4c T4d T4e T4f T4g T5 T6a T6b T6c T6d T7a T7b T7c T7d T7e T8a T8b T8c T8d T8e T8f T9a T9b T9c T9d T9e T10 T11 (% voters, % to pass, % denials to fail)',
    current_setting('rh.all'), current_setting('rh.need'), current_setting('rh.deny');
end $v$;
