-- v4.23 (2026-10-20): Season 2 sign-ups close Friday, January 8, 2027 at 11:59 PM ET, the day before the draft.
-- Commissioner, 2026-10-20, asked whether the cutoff should move from Thursday, January 7 to Friday, January 8:
-- "Yes we can set that as the date. We may change it later though."
--
-- Why: the Season 2 ruling (v3.95) and Chapter S2 of the rulebook already say sign-ups close "Friday, January 8 at
-- 11:59 PM ET", but both deadline columns on the Season 2 row still held Thursday, January 7 at 11:59 PM ET (the
-- Season 1 pattern, the Thursday before the draft). The sign-up page reads signup_deadline_at first and then
-- registration_deadline (CG.ROUTES.register), the draft-eligibility functions read them too (is_draft_eligible,
-- auto_assign_latecomers, trg_autoassign_new_reg, enforce_unsigned_contracts, position_change_deadline,
-- announce_lifecycle), and the v4.23 survey stops at the same deadline. All of them read the stored value at call
-- time, and no cron job or app_config entry carries the date, so moving the two values moves every one of them.
-- Changing it again later is the same two guarded updates with the new value.
--
-- Rehearsal (2026-10-20): each update ran first in one transaction on the live database that ended in an uncaught
-- raise, so it rolled back:
--   registration_deadline: REHEARSAL OK: rows 1, before 2027-01-07 23:59:00 ET, after 2027-01-08 23:59:00 ET (Fri Jan 08)
--   signup_deadline_at:    REHEARSAL OK: rows 1, signup_deadline_at now 2027-01-08 23:59:00 ET, matches registration_deadline
-- Applied 2026-10-20 through execute_sql (a data change, no DDL); the read-back showed both columns at
-- Fri Jan 08, 2027 11:59 PM ET.

update public.seasons set registration_deadline = '2027-01-09 04:59:00+00'
 where number = 2 and registration_deadline = '2027-01-08 04:59:00+00';

update public.seasons set signup_deadline_at = '2027-01-09 04:59:00+00'
 where number = 2 and signup_deadline_at = '2027-01-08 04:59:00+00';

do $chk$
begin
  if (select registration_deadline from public.seasons where number = 2) <> timestamptz '2027-01-09 04:59:00+00'
     or (select signup_deadline_at from public.seasons where number = 2) <> timestamptz '2027-01-09 04:59:00+00' then
    raise exception 'self-check: the Season 2 sign-up deadline is not Friday, January 8, 2027 at 11:59 PM ET';
  end if;
end $chk$;
