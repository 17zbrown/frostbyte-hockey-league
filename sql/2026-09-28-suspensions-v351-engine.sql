-- v3.51 (part 1 of the suspension overhaul): the engine. Applied 2026-09-28.
--
-- Commissioner, 2026-09-28 (rulebook audit answers):
--   "Lock a player in the team HQ by graying them out and locking them while they are suspended. If
--    they are suspended they cannot be moved between the roster and training camp as punishment to
--    the team. Suspensions shall end automatically at 11:59PM ET on the last day of their suspension.
--    Make sure it is only possible commissioners can suspend staff."
--   Q4: "For a staff officials, depending on the reason for the suspension, either they lose their
--    staffing duties during the suspension, or they lose their ability to be scheduled or play, or
--    both during the period."
--   Q5: "Game based suspensions can last into following seasons. Game suspensions can be issued in
--    intervals of 3, up to 18. Anything beyond that needs to pass through the commissioners office."
--   Q6: "A second suspension wouldn't be possible with the schedule lock for suspended players. If a
--    player does appear on a box score during a suspension, that player can receive a extra set of
--    games tacked onto the end of their current suspension as punishment. If a player is being
--    suspended for the 2nd time in the same season, their suspension is automatically set for the
--    remainder of the season unless otherwise specified by staff or commissioners."
--   Q7: "They are not allowed to be claimed, and for discord conduct, they will be in timeout for the
--    length of their suspension."
--
-- WHAT WAS WRONG (audit 2026-09-27, Part 1 items 3 to 6)
--   * suspensions.status could only be active or lifted: nothing ever became served, so every screen
--     kept a member suspended until someone lifted him by hand.
--   * a games suspension counted only the club he was on at issue, in that season, so it froze at
--     season end (never ending) and did not follow a trade.
--
-- THE ENGINE
--   suspensions gains scope (play | staff | both), venue (discord | ice) and served_at; status gains
--   'served'.
--   suspension_games records each game served, attributed to whichever club the player is rostered on
--   when the game goes final (trg_count_suspension_games on games), in any season, so a suspension
--   follows him and carries over. A voided game, or one reopened out of final, is un-counted.
--   suspension_running_at(s, ts) is the ONE definition: date ends at its ends_at (always 23:59:59 ET);
--   games runs until the count is met AND the ET day of the last counted game has passed; seasons
--   until the season completes.
--   is_suspended() reads it for scope play|both; is_staff_suspended() for staff|both, and
--   has_department() and is_staff() return false while a staff-scope suspension runs, so every desk
--   and staff read goes with it through the functions they already ask. A commissioner is never
--   switched off this way.
--   mark_served_suspensions() runs every five minutes (cron 'suspension-served'), marks served what no
--   longer runs, and tells the member and his club's management. flip_season_status now marks a
--   season-length suspension served (was: lifted).
--
-- EDGE FOUND BY THE SCENARIO BATTERY: with the count met and no counted game (a zero total), the
-- running test fell through to TRUE. An aggregate always returns one row, so the outer coalesce never
-- guarded it. The comparison itself now defaults to false: the engine never defaults a member to
-- suspended.

create or replace function public.suspension_running_at(s public.suspensions, ts timestamptz)
 returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select case
    when s.status <> 'active' or s.mode = 'warning' then false
    when ts < s.created_at then false
    when s.mode = 'date' then s.ends_at is null or ts < s.ends_at
    when s.mode = 'seasons' then s.until_season is null
      or not exists (select 1 from public.seasons where number >= s.until_season and status = 'complete')
    else (
      select case when count(*) < coalesce(s.games_total,0) then true
                  else coalesce((max(g.game_at) at time zone 'America/New_York')::date
                                = (ts at time zone 'America/New_York')::date, false) end
        from public.suspension_games g
       where g.suspension_id = s.id and g.game_at <= ts)
  end;
$fn$;
-- (the remaining engine objects are as applied: see the v3.51 notes above and the live definitions of
-- is_suspended, is_staff_suspended, has_department, is_staff, count_suspension_games,
-- mark_served_suspensions and the suspension_games table)
