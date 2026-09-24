-- v2.99 (2026-09-23) — a player in a box score who is on neither the club's active roster nor its
-- training camp is reported to the desk that owns it.
-- Applied live through the MCP in gated transactions; this file is the record.
--
-- Commissioner: "If a team ever reports a box score with a player that does not appear anywhere on
-- their active roster or TC, please notify the correct staff for them to deal with it."
--
-- Rule 4.2 makes admitting a non-rostered player to a league lobby a conduct violation, so this is
-- not a stats curiosity: it is a ruling somebody has to make.
--
-- WHERE IT GOES, and why not the two obvious places:
--   game_incidents  bot/incidents.mjs announces EVERY row of that table into BOTH clubs' Discord
--                   rooms as a formal ruling, with penalties owed. Writing a suspicion there would
--                   tell both clubs a ruling had been made before any human had looked at it.
--   action_requests profile_id is NOT NULL (a case needs a filer) and the ar_update policy refuses
--                   whoever is named as filer. A system flag filed under a commissioner's name
--                   would lock that commissioner out of the case it created.
-- So it goes where its three siblings already live: public.review_game_records, which the
-- check_weekly_cap_violations trigger runs when a regular-season game goes final. It already
-- loops the box score, already looks the player up in roster_spots, and already dedups through
-- admin_audit. The gap was that it did nothing when the lookup found nothing.

begin;

-- "The correct staff" needs a notifier that means the DESK. The league had notify_commissioners
-- (commissioners only) and notify_staff_bell (every staffer, department or not).
create or replace function public.notify_department(p_dept text, p_type text, p_title text, p_body text,
                                                    p_view text default null, p_param text default null)
returns int language plpgsql security definer set search_path = public as $fn$
declare s uuid; n int := 0;
begin
  for s in
    select id from public.profiles
     where (role = 'commissioner')
        or (role = 'staff' and departments is not null and p_dept = any(departments))
  loop
    perform public.create_notification(s, p_type, p_title, p_body, p_view, p_param);
    n := n + 1;
  end loop;
  return n;
end $fn$;
revoke execute on function public.notify_department(text,text,text,text,text,text) from public, anon, authenticated;

commit;

-- public.review_game_records(uuid), spliced in four places (the rest of the function is unchanged):
--
-- 1. declare       + v_rostered boolean; v_elsewhere text; v_unknown text; v_dept text := 'transactions';
--
-- 2. after the existing roster lookup inside the per-player loop:
--
--      v_rostered := found;
--      if not v_rostered and not exists (<admin_audit dedup on action 'unrostered_player'>) then
--        <v_elsewhere := the clubs, if any, that DO roster him this season>
--        perform public.notify_department(v_dept, 'flag', 'Unrostered player in a box score (Rule 4.2)', ...);
--        perform public.notify_staff_ch('casework', ..., true);
--        perform public.log_admin_action('unrostered_player','game',g.id::text, ...);
--      end if;
--
--    The notice distinguishes two shapes, because they are different problems: "he is on no CGHL
--    roster at all this season" and "he is currently rostered by DAL". It also says the roster is
--    read as it stands NOW and points staff at the transaction log, because a player legitimately
--    dressed at puck drop could have been moved before anyone looks.
--
-- 3. a new loop at the end, for the other half of "not on their roster": every check in this
--    function skips a game_stats row whose profile_id is null, so a skater the league could not
--    match to ANY member was the one row nobody was told about. Grouped per club, reported as
--    'unidentified_player', and worded so staff check the EA ID first (usually it is that) before
--    reaching for Rule 4.2.
--
-- 4. five em dashes removed from this function's user-facing strings (the league's no-dash rule),
--    including two in the pre-existing weekly-cap and no-lineup notices.
--
-- REHEARSED with rollback against a real fixture, twice:
--   * a rostered-elsewhere player + an unidentifiable skater inserted into a game's box score, the
--     game set final: exactly 2 flags raised, and a second review_game_records() added none.
--   * the same after the dash sweep: still exactly 2.
--   pg_net is transactional, so the Discord calls made inside the rolled-back rehearsals were
--   never sent (net._http_response had no rows in the window; verified).
--
-- ALSO, in the same release (netlify/functions/ingest-stats.js): fuzzyProfile, the last-resort
-- matcher, built its pattern from the raw gamertag. `*` is the wildcard it wants; `_` is one by
-- accident, and gamertags are full of underscores, so "Dangle_47" could match "DangleX47" and weld
-- a stat line to the wrong human. The exact-match steps were fixed for exactly this and escape via
-- likeSafe; this one did not. Each token is escaped now and the tokens are still joined with `*`.
-- Without it the new check has a blind spot: a ringer quietly resolved to a rostered player looks
-- perfectly clean.

-- ---- Corrections applied the same evening, after a read-only audit of the above ----
--
-- 1. THE DEPARTMENT IS OFFICIATING, not transactions. I picked transactions for consistency with
--    the three sibling flags, without checking what the rulebook already says. It says this:
--      Rule 5.2  "Dressing an ineligible player results in forfeiture of the game in which the
--                 player dressed, without prejudice to further discipline under Chapter 7."
--      Rule 5.3  machine-detected lineup trouble is reported to the league office's officials desk.
--      Rule 7.1  a matter is routed to the department that must act on it.
--    Transactions holds neither the forfeit nor the discipline capability. v_dept := 'officiating'.
--
-- 2. EVERY ONE OF THESE NOTICES POINTED AT THE HOME PAGE. They passed link_view 'transactions',
--    and CG.notifRoute maps that to "#/home" (part_live.js: case "transactions": return "#/home").
--    A staffer got a flag with nothing to click through to. All five notices in this function now
--    pass link_view 'game' with the game id, which opens the box score. That fixes the three
--    pre-existing flags (weekly cap, off the filed lineup, no lineup filed) as well as the two new
--    ones: they had been dead-ending since they were written.
--
-- 3. public._staff_attention() gained 'ineligible_players_7d', so the Staff Desk triage card shows
--    the work instead of relying on a bell that scrolls away. A ROLLING SEVEN DAYS deliberately:
--    admin_audit is append-only with no resolved state, so a lifetime count would be a nag that
--    never clears and the card would stop meaning "outstanding". Resolving or dismissing a flag is
--    NOT built; the notice, which now links to the game, carries the case.
--
-- Re-rehearsed with rollback after all three: 2 flags, link_view 'game' with the game id, at least
-- one officiating staffer notified, and the unidentified check reaching somebody.
