-- Rehearsal for sql/2026-11-24-s2-application-conflicts-v458.sql. The main session runs it on production as ONE
-- transaction that ends in an uncaught raise, so everything rolls back (CLAUDE.md, Database change protocol step 2).
-- Agents never run it. It stands alone: no other record of the Season 2 batch has to be applied first.
--
-- How to run: this whole file in one execute_sql call. It carries the record's text byte for byte
-- (tools/s2-application-conflicts-v458.test.cjs pins it).
--
-- Before and after (outside the transaction): count net.http_request_queue, notifications and discord_dms rows; all three
-- must be unchanged. pg_net is transactional and the bot sees only committed discord_dms rows, so nothing leaves.
--
-- The people are real members picked inside the transaction (no ids in this file), and every change to them rolls back:
--   A, D, B: Season 2 sign-ups who are members with no club seat, no Season 2 owner application, no staff application and
--            no Season 2 roster spot; K: a commissioner (the office's caller); P: a Season 1 approved Owner applicant.
-- Cases:
--   T0 applying the record changes no application row (already filed applications are left alone); the count of
--      already filed conflicting applications rides out in the verdict.
--   T3 a member (A) files an owner application: allowed. A then withdraws it.
--   T5 a member with no club seat (B) files a staff application: allowed. The office then declines it.
--   (the office) K makes A a staffer and D a commissioner through set_member_role, P a staffer, and seats B on a club
--      through _assign_team_role, the doors production uses.
--   T1 the staffer (A) is refused: a fresh filing through the site's upsert, and a direct move back to pending.
--   T2 the commissioner (D) is refused, although as a commissioner D passes every other application guard.
--   T4 the seat holder (B) is refused on a staff application: the site's upsert (for Media alone, so no Media exception
--      survives), and a direct move back to pending.
--   T6 Season 1 rows untouched: P's approved Season 1 owner application, now a staffer's, is saved by a commissioner
--      without a refusal, and stays approved.
--   T7 the office's own door (app.app_decide) passes: a deliberate correction is never blocked.

begin;

-- the applications as they stand before the record (T0 compares)
select set_config('rh.apps_before',
  (select md5(coalesce(string_agg(to_jsonb(oa)::text, '|' order by oa.id), '')) from public.owner_applications oa) || '/' ||
  (select md5(coalesce(string_agg(to_jsonb(sa)::text, '|' order by sa.id), '')) from public.staff_applications sa), true);

-- >>> record text: sql/2026-11-24-s2-application-conflicts-v458.sql
-- v4.58 (2026-11-24): Rule 2.7 at the application door. A commissioner or staff member cannot file an owner application,
-- and a club's Owner, General Manager or Assistant General Manager cannot file a staff application, until they step down
-- from the conflicting seat or are removed from it.
--
-- Commissioner, 2026-11-23: "Staffers cannot submit owner applications and team managers cannot submit staff
-- applications until they remove themselves or are removed from their seat." The ruling replaces "they choose" and the
-- conditional removal of the staff role from a staffer granted a club (the earlier Season 2 plan).
--
-- Why at the door: until now the conflict was caught only at the decision. The insert policies (owner_app_insert,
-- staff_app_insert) check only profile_id = auth.uid(), and guard_app_insert reads the decision fields only. The site's
-- owner form refuses a commissioner or staffer, but a direct API insert or upsert got past it; the staff form let a seat
-- holder file for Media alone; and at the decision _owner_app_autoplace and apply_application_decision only refuse to
-- seat or grant, after the reviewers have voted on an application the applicant was never allowed to file.
--
-- What is checked, and when:
--  1. owner_applications: the applicant's profiles.role is 'staff' or 'commissioner'. staff_applications: the applicant
--     holds a club seat, by public.holds_club_seat (teams.owner_profile_id, gm_profile_id, agm_profile_id), the one
--     definition apply_application_decision and waitlist_admit already use.
--  2. On every INSERT. The site files and saves through an upsert, and Postgres runs BEFORE INSERT triggers before it
--     looks for the conflicting row, so a save of an existing application is checked here too: a member who has since
--     joined the office (or taken a seat) cannot save changes to a pending application. They may still withdraw it, and
--     the decision doors still refuse to seat or grant them.
--  3. On an UPDATE only when the row ends pending and either it was not pending before (a withdrawn or denied
--     application filed again) or it moved to another member. Same trigger condition as guard_owner_app_signed_up (v3.99).
--     A decided Season 1 row, a waitlisted row, or a plain UPDATE of a pending row is never checked, so already filed
--     applications are left alone. None conflicts today (read 2026-11-23: 0 pending owner applications by staff or
--     commissioners, 0 pending staff applications, 0 seated clubs); the self-check below reports the count at apply time.
--  4. The check reads the applicant (new.profile_id), never the caller: a commissioner filing their own owner application
--     is refused like anyone else, although is_commissioner() passes every other application guard.
--  5. Only the league office's own doors pass, under app.app_decide or app.app_award (the flags guard_app_insert and
--     guard_owner_app_one_edit honor), so a deliberate office correction is never blocked. No client can set them.
--  6. No Media exception and no role_conflict_exemptions bypass. Season 2 has no Media role (commissioner, 2026-10-22:
--     "we will not have that role next season"), the ruling names no exception, and the Season 1 grandfathering ends at
--     the rollover (start_next_season deletes the three exemption rows).
--
-- Trigger order: Postgres fires a table's BEFORE triggers by name. guard_owner_app_role_conflict and
-- guard_staff_app_role_conflict sort after the decision guards (guard_owner_app_decision, guard_staff_app_decision), so
-- they see the status those guards settled on (an applicant's write never re-pends a waitlisted application), and before
-- zz_stamp_*_filed_at, which stamps only what survives. On owner_applications they also sort after
-- ab_guard_owner_app_signed_up, so a member who is not signed up hears "sign up first" before this.
--
-- Not Season-gated: staff applications have no season, Season 1 owner applications closed on Sep 10, and the ruling binds
-- every application filed from now on. Nothing here posts to Discord or writes a row. No rulebook text in this record:
-- live Rule 2.7 still carries the Media exception and "is not admitted" wording; the main session owns that edit.
--
-- Rehearsal: sql/2026-11-24-s2-application-conflicts-v458.rehearsal.sql (run by the main session; results recorded at the
-- end of this file).

do $pre$
begin
  if to_regprocedure('public.holds_club_seat(uuid)') is null then
    raise exception 'v4.58 application conflicts: public.holds_club_seat(uuid) is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.owner_applications'::regclass and tgname = 'guard_owner_app_decision')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.staff_applications'::regclass and tgname = 'guard_staff_app_decision') then
    raise exception 'v4.58 application conflicts: the decision guards this trigger must fire after are missing';
  end if;
end $pre$;

create or replace function public.guard_app_role_conflict()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
/* v4.58 (Rule 2.7, commissioner 2026-11-23): "Staffers cannot submit owner applications and team managers cannot submit
   staff applications until they remove themselves or are removed from their seat." Checked on every insert (the site's
   upsert included) and when an application returns to pending or moves to another member. Keyed on the applicant, never
   the caller. Only the office's doors (app.app_decide / app.app_award) pass. No Media exception: Season 2 has no Media
   role. */
declare v_role text;
begin
  if coalesce(current_setting('app.app_decide', true), '') = 'on'
     or coalesce(current_setting('app.app_award', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and not (new.status = 'pending'
       and (old.status is distinct from 'pending' or new.profile_id is distinct from old.profile_id)) then
    return new;   -- already filed: a decided, waitlisted or withdrawn row, or a pending one saved in place
  end if;
  if tg_table_name = 'owner_applications' then
    select p.role::text into v_role from public.profiles p where p.id = new.profile_id;
    if v_role = 'commissioner' then
      raise exception 'Commissioners cannot apply to own a club (Rule 2.7). Step down as commissioner first, then apply.'
        using errcode = '42501';
    elsif v_role = 'staff' then
      raise exception 'Members of the league staff cannot apply to own a club (Rule 2.7). Leave the staff first, then apply.'
        using errcode = '42501';
    end if;
  elsif public.holds_club_seat(new.profile_id) then
    raise exception 'Owners, General Managers and Assistant General Managers cannot apply to join the league staff (Rule 2.7). Step down from your club seat first, then apply.'
      using errcode = '42501';
  end if;
  return new;
end $function$;
revoke all on function public.guard_app_role_conflict() from public, anon, authenticated;

drop trigger if exists guard_owner_app_role_conflict on public.owner_applications;
create trigger guard_owner_app_role_conflict before insert or update on public.owner_applications
  for each row execute function public.guard_app_role_conflict();
drop trigger if exists guard_staff_app_role_conflict on public.staff_applications;
create trigger guard_staff_app_role_conflict before insert or update on public.staff_applications
  for each row execute function public.guard_app_role_conflict();

do $chk$
declare v_owner int; v_staff int;
begin
  if not (select prosecdef from pg_proc where oid = 'public.guard_app_role_conflict()'::regprocedure)
     or not ('search_path=""' = any(coalesce((select p.proconfig from pg_proc p where p.oid = 'public.guard_app_role_conflict()'::regprocedure), '{}'::text[]))) then
    raise exception 'v4.58 application conflicts: guard_app_role_conflict must be SECURITY DEFINER with search_path ''''';
  end if;
  if has_function_privilege('anon', 'public.guard_app_role_conflict()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_app_role_conflict()', 'EXECUTE') then
    raise exception 'v4.58 application conflicts: the API roles can execute guard_app_role_conflict';
  end if;
  /* read from the catalog, not pg_get_triggerdef text (which qualifies names by the session's search_path):
     tgtype 23 = ROW (1) + BEFORE (2) + INSERT (4) + UPDATE (16); no column list, no WHEN, enabled */
  if (select count(*) from pg_trigger
       where (tgrelid, tgname) in (('public.owner_applications'::regclass, 'guard_owner_app_role_conflict'),
                                   ('public.staff_applications'::regclass, 'guard_staff_app_role_conflict'))
         and tgfoid = 'public.guard_app_role_conflict()'::regprocedure and tgtype = 23 and tgenabled = 'O'
         and tgqual is null and tgattr = ''::int2vector) <> 2 then
    raise exception 'v4.58 application conflicts: a trigger is missing, disabled or not BEFORE INSERT OR UPDATE FOR EACH ROW';
  end if;
  /* the order the header relies on: after the decision guard (and the signed-up guard), before the filed_at stamp */
  if not ('guard_owner_app_role_conflict' collate "C" > 'guard_owner_app_decision' collate "C"
          and 'guard_owner_app_role_conflict' collate "C" > 'ab_guard_owner_app_signed_up' collate "C"
          and 'guard_owner_app_role_conflict' collate "C" < 'zz_stamp_owner_app_filed_at' collate "C"
          and 'guard_staff_app_role_conflict' collate "C" > 'guard_staff_app_decision' collate "C"
          and 'guard_staff_app_role_conflict' collate "C" < 'zz_stamp_staff_app_filed_at' collate "C")
     or not exists (select 1 from pg_trigger where tgrelid = 'public.owner_applications'::regclass and tgname = 'zz_stamp_owner_app_filed_at')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.staff_applications'::regclass and tgname = 'zz_stamp_staff_app_filed_at') then
    raise exception 'v4.58 application conflicts: the trigger order changed';
  end if;
  /* already filed applications are left alone; report any that conflict so the office can sort them out by hand */
  select count(*) into v_owner from public.owner_applications oa join public.profiles p on p.id = oa.profile_id
   where oa.status in ('pending', 'waitlisted') and p.role::text in ('staff', 'commissioner');
  select count(*) into v_staff from public.staff_applications sa
   where sa.status in ('pending', 'waitlisted') and public.holds_club_seat(sa.profile_id);
  raise notice 'v4.58 application conflicts: already filed and conflicting, left alone: % owner, % staff', v_owner, v_staff;
end $chk$;

/* Rehearsal on production, 2026-11-24 (main session), one transaction rolled back by its closing raise: REHEARSAL OK:
   T0 T1a T1b T2 T3 T4a T4b T5 T6 T7 (already filed and conflicting, left alone: 0 owner, 0 staff), after one fix to the
   self-check (any((select proconfig ...)) parses as a subquery; now any(coalesce((select ...), '{}'))).
   Applied 2026-11-24 as migration v458f_s2_application_conflicts. */
-- <<< record text

-- T0: the record wrote no row
do $t0$
begin
  if (select md5(coalesce(string_agg(to_jsonb(oa)::text, '|' order by oa.id), '')) from public.owner_applications oa) || '/' ||
     (select md5(coalesce(string_agg(to_jsonb(sa)::text, '|' order by sa.id), '')) from public.staff_applications sa)
     <> current_setting('rh.apps_before') then
    raise exception 'T0 failed: applying the record changed an application row';
  end if;
  perform set_config('rh.conflicts',
    (select count(*) from public.owner_applications oa join public.profiles p on p.id = oa.profile_id
      where oa.status in ('pending', 'waitlisted') and p.role::text in ('staff', 'commissioner'))::text || ' owner, ' ||
    (select count(*) from public.staff_applications sa
      where sa.status in ('pending', 'waitlisted') and public.holds_club_seat(sa.profile_id))::text || ' staff', true);
end $t0$;

-- the world
do $w$
declare
  v_s2 uuid := (select id from public.seasons where registration_open and status <> 'complete' order by number desc limit 1);
  v_k uuid := (select id from public.profiles where role = 'commissioner' order by created_at limit 1);
  v_pool uuid[];
  v_p uuid; v_p_app uuid; v_team uuid; v_seat text;
begin
  if v_s2 is null or v_k is null then raise exception 'world: no season is taking applications, or there is no commissioner'; end if;
  /* D-ROLLOVER (main session, 2026-11-23): Season 1's player contracts stay active until the commissioner runs the
     rollover, public.start_next_season(Season 2), which happens before any Season 2 seat. Seating B below puts a Season 2
     sign-up on a roster (ensure_manager_rostered), so the rollover is modeled first, under a commissioner's claims. It is
     conditional, so this rehearsal also passes after the real rollover. Contracts are never expired by hand. */
  if exists (select 1 from public.contracts c
              where c.status in ('active', 'signed') and not coalesce(c.is_manager, false)
                and c.start_season < (select number from public.seasons where id = v_s2)) then
    perform set_config('request.jwt.claims', json_build_object('sub', v_k, 'role', 'authenticated')::text, true);
    perform public.start_next_season(v_s2);
    perform set_config('request.jwt.claims', '', true);
  end if;
  /* owner applications close Nov 28 at 11:59 PM ET; run later, the deadline guard would refuse A and hide what this
     record does, so the window is reopened inside this transaction only. An open window also keeps the reviewer
     resolver that set_member_role sets off (profiles_reviewer_resolve) from deciding any real owner application
     (_owner_app_decidable is false before the close). */
  if now() >= (select owner_app_deadline from public.seasons where id = v_s2) then
    update public.seasons set owner_app_deadline = now() + interval '1 day' where id = v_s2;
  end if;
  select array_agg(x.profile_id order by x.created_at) into v_pool from (
    select r.profile_id, r.created_at from public.season_registrations r join public.profiles p on p.id = r.profile_id
     where r.season_id = v_s2 and r.status <> 'declined' and p.role = 'member' and not coalesce(p.banned, false)
       and not public.is_suspended(r.profile_id) and not public.holds_club_seat(r.profile_id)
       and not exists (select 1 from public.owner_applications oa where oa.profile_id = r.profile_id and oa.season_id = v_s2)
       and not exists (select 1 from public.staff_applications sa where sa.profile_id = r.profile_id)
       and not exists (select 1 from public.roster_spots rs where rs.season_id = v_s2 and rs.profile_id = r.profile_id)
     order by r.created_at limit 3) x;
  if coalesce(array_length(v_pool, 1), 0) < 3 then raise exception 'world: fewer than three eligible Season 2 sign-ups'; end if;
  select oa.id, oa.profile_id into v_p_app, v_p from public.owner_applications oa join public.profiles p on p.id = oa.profile_id
   where oa.season_id = (select id from public.seasons where number = 1) and oa.status = 'approved' and p.role = 'member'
     and oa.profile_id <> all(v_pool)
   order by oa.created_at limit 1;
  if v_p_app is null then raise exception 'world: no approved Season 1 owner application by a member'; end if;
  select t.id, case when t.owner_profile_id is null then 'owner' when t.gm_profile_id is null then 'gm' else 'agm' end
    into v_team, v_seat from public.teams t
   where t.owner_profile_id is null or t.gm_profile_id is null or t.agm_profile_id is null
   order by (t.owner_profile_id is null)::int + (t.gm_profile_id is null)::int + (t.agm_profile_id is null)::int desc, t.code
   limit 1;
  if v_team is null then raise exception 'world: no club has an empty seat'; end if;
  perform set_config('rh.s2', v_s2::text, true);
  perform set_config('rh.k', v_k::text, true);
  perform set_config('rh.a', v_pool[1]::text, true);
  perform set_config('rh.d', v_pool[2]::text, true);
  perform set_config('rh.b', v_pool[3]::text, true);
  perform set_config('rh.p', v_p::text, true);
  perform set_config('rh.p_app', v_p_app::text, true);
  perform set_config('rh.team', v_team::text, true);
  perform set_config('rh.seat', v_seat, true);
end $w$;

-- T3: a member files an owner application (allowed), then withdraws it
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.a'), 'role', 'authenticated')::text, true);
do $t3$
declare v_id uuid;
begin
  insert into public.owner_applications (profile_id, team_choice, pitch, status)
    values (current_setting('rh.a')::uuid, 'random', 'Rehearsal: a member files an owner application.', 'pending')
    returning id into v_id;
  if v_id is null then raise exception 'T3 failed: the member''s owner application was not filed'; end if;
  perform set_config('rh.a_app', v_id::text, true);
  perform public.withdraw_owner_application(v_id);
end $t3$;

-- T5: a member with no club seat files a staff application (allowed)
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
do $t5$
declare v_id uuid;
begin
  insert into public.staff_applications (profile_id, departments, pitch, status)
    values (current_setting('rh.b')::uuid, array['community'], 'Rehearsal: a member with no club seat files a staff application.', 'pending')
    returning id into v_id;
  if v_id is null then raise exception 'T5 failed: the member''s staff application was not filed'; end if;
  perform set_config('rh.b_app', v_id::text, true);
end $t5$;

-- the office: A joins the staff, D becomes a commissioner, P joins the staff, B's staff application is declined, B is seated
reset role;
select set_config('request.jwt.claims', '', true);
do $office$
declare v_n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
  perform public.set_member_role(current_setting('rh.a')::uuid, 'staff');
  perform public.set_member_role(current_setting('rh.d')::uuid, 'commissioner');
  perform public.set_member_role(current_setting('rh.p')::uuid, 'staff');
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.app_decide', 'on', true);   -- the review board's decision door runs under this flag
  update public.staff_applications set status = 'denied', decided_at = now(), updated_at = now()
   where id = current_setting('rh.b_app')::uuid and status = 'pending';
  get diagnostics v_n = row_count;
  perform set_config('app.app_decide', '', true);
  if v_n <> 1 then raise exception 'world: B''s staff application was not declined'; end if;
  perform public._assign_team_role(current_setting('rh.team')::uuid, current_setting('rh.seat'), current_setting('rh.b')::uuid);
  if not public.holds_club_seat(current_setting('rh.b')::uuid) then raise exception 'world: B was not seated'; end if;
  if (select role::text from public.profiles where id = current_setting('rh.a')::uuid) <> 'staff'
     or (select role::text from public.profiles where id = current_setting('rh.d')::uuid) <> 'commissioner' then
    raise exception 'world: set_member_role did not change the roles';
  end if;
end $office$;

-- T1: the staffer is refused, through the site's upsert and through a direct move back to pending
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.a'), 'role', 'authenticated')::text, true);
do $t1$
begin
  begin
    insert into public.owner_applications (profile_id, team_choice, pitch, status)
      values (current_setting('rh.a')::uuid, 'random', 'Rehearsal: filed again as a staffer.', 'pending')
      on conflict (profile_id, season_id) do update set status = excluded.status, pitch = excluded.pitch, updated_at = now();
    raise exception 'T1a failed: a staffer filed an owner application through the site''s upsert';
  exception when others then
    if sqlerrm <> 'Members of the league staff cannot apply to own a club (Rule 2.7). Leave the staff first, then apply.' then raise; end if;
  end;
  begin
    update public.owner_applications set status = 'pending', updated_at = now() where id = current_setting('rh.a_app')::uuid;
    raise exception 'T1b failed: a staffer moved a withdrawn owner application back to pending';
  exception when others then
    if sqlerrm <> 'Members of the league staff cannot apply to own a club (Rule 2.7). Leave the staff first, then apply.' then raise; end if;
  end;
end $t1$;

-- T2: the commissioner is refused (as a commissioner, D passes the deadline, picks, one-edit and insert guards)
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.d'), 'role', 'authenticated')::text, true);
do $t2$
begin
  begin
    insert into public.owner_applications (profile_id, team_choice, pitch, status)
      values (current_setting('rh.d')::uuid, 'random', 'Rehearsal: a commissioner files an owner application.', 'pending');
    raise exception 'T2 failed: a commissioner filed an owner application';
  exception when others then
    if sqlerrm <> 'Commissioners cannot apply to own a club (Rule 2.7). Step down as commissioner first, then apply.' then raise; end if;
  end;
end $t2$;

-- T4: the seat holder is refused on a staff application, for Media alone too
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.b'), 'role', 'authenticated')::text, true);
do $t4$
begin
  begin
    insert into public.staff_applications (profile_id, departments, pitch, status)
      values (current_setting('rh.b')::uuid, array['media'], 'Rehearsal: a seat holder files again, for Media alone.', 'pending')
      on conflict (profile_id) do update set status = excluded.status, departments = excluded.departments,
        pitch = excluded.pitch, updated_at = now();
    raise exception 'T4a failed: a seat holder filed a staff application through the site''s upsert';
  exception when others then
    if sqlerrm <> 'Owners, General Managers and Assistant General Managers cannot apply to join the league staff (Rule 2.7). Step down from your club seat first, then apply.' then raise; end if;
  end;
  begin
    update public.staff_applications set status = 'pending', updated_at = now() where id = current_setting('rh.b_app')::uuid;
    raise exception 'T4b failed: a seat holder moved a declined staff application back to pending';
  exception when others then
    if sqlerrm <> 'Owners, General Managers and Assistant General Managers cannot apply to join the league staff (Rule 2.7). Step down from your club seat first, then apply.' then raise; end if;
  end;
end $t4$;

-- T6: a Season 1 row, now a staffer's, saved by a commissioner without a status move
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $t6$
declare v_n int;
begin
  update public.owner_applications set updated_at = now() where id = current_setting('rh.p_app')::uuid and status = 'approved';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'T6 failed: the Season 1 owner application was not saved (% rows)', v_n; end if;
end $t6$;

reset role;
select set_config('request.jwt.claims', '', true);

-- T7 and the verdict
do $v$
declare v_n int;
begin
  if (select status from public.owner_applications where id = current_setting('rh.a_app')::uuid) <> 'withdrawn' then
    raise exception 'T1 failed: the staffer''s owner application moved';
  end if;
  if exists (select 1 from public.owner_applications
              where profile_id = current_setting('rh.d')::uuid and season_id = current_setting('rh.s2')::uuid) then
    raise exception 'T2 failed: the commissioner holds a Season 2 owner application';
  end if;
  if (select status from public.staff_applications where id = current_setting('rh.b_app')::uuid) <> 'denied'
     or (select departments from public.staff_applications where id = current_setting('rh.b_app')::uuid) <> array['community'] then
    raise exception 'T4 failed: the seat holder''s staff application moved';
  end if;
  if (select status from public.owner_applications where id = current_setting('rh.p_app')::uuid) <> 'approved' then
    raise exception 'T6 failed: the Season 1 owner application changed status';
  end if;
  perform set_config('app.app_decide', 'on', true);
  update public.owner_applications set status = 'pending', updated_at = now()
   where id = current_setting('rh.a_app')::uuid and status = 'withdrawn';
  get diagnostics v_n = row_count;
  perform set_config('app.app_decide', '', true);
  if v_n <> 1 then raise exception 'T7 failed: the office''s own door was refused'; end if;
  raise exception 'REHEARSAL OK: T0 T1a T1b T2 T3 T4a T4b T5 T6 T7 (already filed and conflicting, left alone: %)',
    current_setting('rh.conflicts');
end $v$;
