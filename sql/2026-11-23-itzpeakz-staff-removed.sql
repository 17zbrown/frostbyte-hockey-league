-- Data fix (2026-11-23): ItzPeakz is removed from the league staff, at the commissioner's order.
-- Commissioner, 2026-11-23, ruling that staff may not hold an owner application ("Staffers cannot submit owner
-- applications and team managers cannot submit staff applications until they remove themselves or are removed from
-- their seat"), on ItzPeakz's pending Season 2 owner application: "remove him from the staff right now".
--
-- State before (read 2026-11-23): profile a3d624fe (ItzPeakz) role staff, departments {media}; one pending Season 2
-- owner application. The only staffer with an owner application in; no club seat was held by anyone that day.
--
-- What this does: the role, through the commissioner's own door (set_member_role, the Users & roles screen):
-- staff -> member. That logs role_change, sends the standard "Role updated / Your role is now Member." site
-- notification, and queues the Discord role sync, which removes the Staff and Media roles. notify_role_change posts to
-- Discord only when someone is MADE staff, so nothing is posted. The owner application is untouched and stays pending.
--
-- REHEARSAL on production, 2026-11-23, one transaction ended by an uncaught raise (rolled back):
--   REHEARSAL OK: T1 role now=member, T2 new notifications=1, T3 http posts queued=0, T4 role sync rows added=1,
--   T5 S2 owner app still=pending.
-- Run through execute_sql the same day: role member, one role_change audit row, one role sync row, owner application
-- pending.

do $fix$
declare v_who uuid := 'a3d624fe-4d5f-4af5-acda-4348bcf58df0'; v_comm uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
begin
  if (select role::text from public.profiles where id = v_who) is distinct from 'staff' then raise exception 'precondition: ItzPeakz is not staff'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_comm::text, 'role', 'authenticated')::text, true);
  perform public.set_member_role(v_who, 'member', null);
  if (select role::text from public.profiles where id = v_who) is distinct from 'member' then raise exception 'self-check: role did not change'; end if;
end $fix$;
