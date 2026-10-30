-- Data fix (2026-10-30): FakeTaxi is removed from the league staff, and their staff application goes back to pending with
-- the ballots it carried before the commissioner approved it.
-- Commissioner, 2026-10-30: "remove fake taxi from staff but keep [their] application with the staff votes that were on it
-- before I approved it."
--
-- State before (read 2026-10-30): profile ebad4253 (FakeTaxi, DET Owner) role staff, departments {media}. Staff
-- application ab3bea9d (departments {media}) approved 2026-10-30 14:47 UTC by the commissioner's override
-- (override_application_decision -> apply_application_decision, which records no decided_by). filed_at 2026-10-19
-- 18:19 UTC (the v4.22 "Fresh vote" stamp). Five approve ballots: Alegator, Some Fat Kid 85 and Anthony-_- (Aug 30-31,
-- before filed_at, so "earlier votes" that do not count) and KwikTripJesus and Lokharov92 (Oct 20-21, counting). Four
-- reviewers, so a decision needs three counting approvals; it had two, which is why it was still pending until the
-- override.
--
-- What this does:
--   1. The role, through the commissioner's own door (set_member_role, the Users & roles screen): staff -> member. That
--      logs role_change, sends FakeTaxi the standard "Role updated / Your role is now Member." site notification, and
--      queues the Discord role sync, which removes the staff and department roles (the bot reads departments only for
--      staff and commissioners, so the {media} list left on the profile is inert, as with the site's own door).
--   2. The application back to pending with decided_at cleared, and with filed_at KEPT at 2026-10-19 so the two Oct 20-21
--      ballots still count, exactly as before the approval. A move back to pending normally re-stamps filed_at
--      (zz_stamp_staff_app_filed_at, which would turn every ballot into an "earlier vote") and rings the Applications desk
--      with "filed again ... voted afresh" (on_staff_app_refiled, which would be false: FakeTaxi filed nothing). Both
--      triggers are disabled for this one statement and re-enabled in the same transaction. No ballot is touched.
--   3. An admin_audit row (staff_app_reopened) records the reopening and the kept filed_at.
-- With two counting approvals of the three needed, the */15 owner-app-resolve job leaves it pending. Nothing is posted to
-- Discord; the approval's staff-channel welcome (notify_role_change, 14:47) already went out and is not retracted.

do $fix$
declare
  v_app   uuid := 'ab3bea9d-b1a4-4b0d-b686-d803326a433f';
  v_who   uuid := 'ebad4253-c14c-4a2f-afba-1f2b01fc6cb5';
  v_comm  uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';   -- zackbrown17, the commissioner who ordered it
  v_filed timestamptz; v_ballots int; v_n int;
begin
  select filed_at into v_filed from public.staff_applications where id = v_app and profile_id = v_who and status = 'approved';
  if v_filed is null then raise exception 'precondition: the application is not approved (or not FakeTaxi''s)'; end if;
  if (select role::text from public.profiles where id = v_who) is distinct from 'staff' then raise exception 'precondition: FakeTaxi is not staff'; end if;
  select count(*) into v_ballots from public.application_ballots where app_type = 'staff' and application_id = v_app;

  -- 1) the role, through the commissioner's door
  perform set_config('request.jwt.claims', json_build_object('sub', v_comm::text, 'role', 'authenticated')::text, true);
  perform public.set_member_role(v_who, 'member', null);

  -- 2) the application back to pending, filed_at kept, no refile notice
  perform set_config('app.app_decide', 'on', true);
  alter table public.staff_applications disable trigger zz_stamp_staff_app_filed_at;
  alter table public.staff_applications disable trigger on_staff_app_refiled;
  update public.staff_applications set status = 'pending', decided_at = null, decided_by = null, updated_at = now()
   where id = v_app and status = 'approved';
  get diagnostics v_n = row_count;
  alter table public.staff_applications enable trigger zz_stamp_staff_app_filed_at;
  alter table public.staff_applications enable trigger on_staff_app_refiled;
  perform set_config('app.app_decide', 'off', true);
  if v_n <> 1 then raise exception 'the application update touched % rows', v_n; end if;

  -- 3) the record
  perform public.log_admin_action('staff_app_reopened', 'staff_application', v_app::text,
    jsonb_build_object('profile', v_who, 'from', 'approved', 'to', 'pending', 'filed_at_kept', v_filed,
      'why', 'Commissioner removed FakeTaxi from staff and kept the application with the ballots it had before the approval (2026-10-30).'));

  -- self-checks
  if (select role::text from public.profiles where id = v_who) <> 'member' then raise exception 'check: role is not member'; end if;
  if not exists (select 1 from public.staff_applications where id = v_app and status = 'pending' and filed_at = v_filed
                 and decided_at is null and waitlisted_at is null) then
    raise exception 'check: application not pending with its filed_at (a guard reverted it?)';
  end if;
  if (select count(*) from public.application_ballots where app_type = 'staff' and application_id = v_app) <> v_ballots then
    raise exception 'check: ballots changed';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.staff_applications'::regclass
             and tgname in ('zz_stamp_staff_app_filed_at', 'on_staff_app_refiled') and tgenabled <> 'O') then
    raise exception 'check: a staff_applications trigger was left disabled';
  end if;
  perform public.resolve_application_if_ready('staff', v_app);
  if (select status from public.staff_applications where id = v_app) <> 'pending' then
    raise exception 'check: the vote resolver decided it again';
  end if;
end $fix$;

/* REHEARSAL (2026-10-30, one transaction on the live database with the block above and a probe, rolled back by a closing
   raise): the role went to member (departments {media} left, as the site's door leaves them); the application went to
   pending with filed_at 2026-10-19 18:19:00.918295+00 kept, decided_at null, all five ballots in place and two counting;
   resolve_all_pending_applications (what the */15 job runs) left it pending; the only notification written was FakeTaxi's
   "Role updated / Your role is now Member."; no Applications desk "filed again" notice; zero rows added to
   net.http_request_queue (nothing posted to Discord); audit rows role_change and staff_app_reopened.
   Result: REHEARSAL OK. Afterward FakeTaxi was still staff, the application still approved, both triggers enabled ('O'),
   and no staff_app_reopened row existed.
   Applied 2026-10-30 through execute_sql (a data fix, not a migration). Read back: role member, application pending,
   filed_at kept, five ballots, two counting, both triggers 'O', audit role_change + staff_app_reopened. */
