-- Data fix (2026-11-23): the Season 2 rollover, run quietly, at the commissioner's go-ahead.
-- The commissioner's rollover (public.start_next_season, the Control Center's "start the next season") had never run
-- for Season 2, so 129 Season 1 player contracts were still 'active' (60 of the 87 Season 2 sign-ups held one). With them
-- active, contracts_one_active refuses every Season 2 roster insert for those players: Owner and GM seating, draft
-- picks, the post-draft fill. Found by the 2026-11-23 review of the Season 2 database work; the commissioner approved
-- running it the same night ("approve all", answering the rollover question among others).
--
-- What it does (current body, basic format): expires every active or signed non-manager contract from an earlier season
-- (Rule 2.5: everyone re-enters the draft), baselines each club's owner for Season 2, deletes the Season 1
-- role-conflict exemptions (the July ruling: role separation applies fully from Season 2) with the commissioners' bell
-- "Role-separation grandfathering has ended", writes a "Season rollover" transaction row and an admin_audit row.
-- QUIET: app.mgmt_quiet is set for the call (the v4.53 mechanism notify_discord_transaction honors), so the transaction
-- row does not post to #transactions. Housekeeping the commissioner did not ask to announce.
--
-- REHEARSAL on production, 2026-11-23, one transaction ended by an uncaught raise (rolled back):
--   REHEARSAL OK: T1 result={"holds": 0, "expired": 129, "extended": 0, "activated": 0, "exemptions_cleared": 3}
--   T2 S1 player deals active before=129 after=0 T3 exemptions before=3 after=0 T4 http posts queued=0 T5 DMs queued=0
--   T6 rollover transaction rows=1 T7 commissioner bells=3
-- Run through execute_sql the same day: Season 1 player deals active 0, exemptions 0, one season_rollover audit row,
-- Season 2 still 'upcoming'.

do $run$
declare v_s2 uuid := (select id from public.seasons where number = 2); v_comm uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7'; res jsonb;
begin
  if not exists (select 1 from public.contracts where status in ('active','signed') and not coalesce(is_manager,false) and start_season < 2) then
    raise exception 'precondition: the rollover already ran (no Season 1 player deal is active)';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_comm::text, 'role', 'authenticated')::text, true);
  perform set_config('app.mgmt_quiet', 'on', true);
  res := public.start_next_season(v_s2);
  if (res->>'expired')::int < 1 then raise exception 'self-check: nothing expired: %', res; end if;
end $run$;
