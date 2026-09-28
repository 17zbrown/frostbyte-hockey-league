-- v3.50: the Rule 1.1 departure sweep runs again, and nobody outside the league office can post
-- into a club's room.
-- 2026-09-28
--
-- Commissioner, 2026-09-28: "fix the dead sweep." The security revoke was flagged first in the
-- 2026-09-27 rulebook audit (docs/audits/2026-09-27-rulebook-audit.md, Part 1 items 1 and 2).
--
-- 1. THE SWEEP HAD BEEN DEAD SINCE 2026-09-25 23:49 ET
--
-- public.sweep_roster_departures ran notice, rejoin and removal in one transaction. Phase A skipped
-- only OPEN notices, so a player noticed on Sep 24, back inside the window on Sep 25, and gone again
-- at 23:49 ET that night met his own closed notice on the (profile_id, season_id) primary key. The
-- 23505 rolled back the entire sweep on every discord-sync tick: no club was told of any departure
-- and no window closed for anyone. discord-sync reported ok:false each time. Three rostered players
-- left the Discord in that span (a DAL camp player, a PIT camp player who has since returned, and a
-- UTA active player); two were still out.
--
-- Fixes:
--   a. A second departure REOPENS the notice with a fresh 24-hour window (ON CONFLICT DO UPDATE),
--      because the rule is per departure and the notice is the clock.
--   b. Every row runs in its own savepoint (BEGIN ... EXCEPTION). A bad row returns action 'error'
--      with its SQLSTATE, and discord-sync now counts an 'error' row as a failure, so it surfaces on
--      the watchdog without taking the rest of the league down with it.
--   c. A window that closes on a player who is no longer rostered (waived during it) used to raise
--      'touched no roster spot' and abort the sweep the same way. It now closes the notice and
--      leaves the sign-up to Rule 1.1.4 (remove_departed_signups).
--
-- Rehearsed in a rolled-back transaction against the live data: 3 notices queued, exactly the three
-- players still out of the server; the returned player got none.
--
-- 2. ANYONE COULD POST INTO ANY CLUB'S DISCORD ROOM
--
-- public.club_notify and the three lineup-notice helpers (_post_lineup_notice,
-- _notify_lineup_pulled, _notify_lineup_moves) are SECURITY DEFINER, were executable by anon and
-- authenticated through PUBLIC, and check no caller. With the site's public key anyone could insert
-- a club_notices row with any title, body and role to ping; the bot posts those into the club's
-- private room, and club_notify also rings the Owner, GM and AGM bells. Every caller is itself a
-- SECURITY DEFINER function owned by postgres (17 of them, listed in the audit), and nothing on the
-- site, in the Netlify functions or in the bot calls these through the API, so revoking breaks
-- nothing.
--
-- Also revoked from anon only: six writers that refuse a caller without a session anyway
-- (offer_extension, offer_free_agent, request_extension, reverse_trade, waitlist_admit,
-- waitlist_remove). Their only call sites are signed-in pages.
--
-- 3. WHY grant-audit.sql SAID ALL CLEAR
--
-- tools/sql/grant-audit.sql check 1 excused any function mentioning auth.uid() (club_notify uses it
-- only as the DEFAULT for the actor column), and it only saw functions containing a direct
-- insert/update/delete, so helpers that write THROUGH club_notify were invisible. Check 5 now lists
-- the internal notice writers that must never be callable from the API, by name.

-- the function as applied is the rehearsed text; see the live definition
-- (select pg_get_functiondef('public.sweep_roster_departures(integer)'::regprocedure))

revoke execute on function public.club_notify(uuid,text,text,text,uuid,text,text,text,boolean) from public, anon, authenticated;
revoke execute on function public._post_lineup_notice(uuid,uuid,game_lineups,uuid[],integer,uuid,boolean) from public, anon, authenticated;
revoke execute on function public._notify_lineup_pulled(uuid,uuid,uuid[],text) from public, anon, authenticated;
revoke execute on function public._notify_lineup_moves(uuid,uuid,game_lineups) from public, anon, authenticated;
grant  execute on function public.club_notify(uuid,text,text,text,uuid,text,text,text,boolean) to service_role;
grant  execute on function public._post_lineup_notice(uuid,uuid,game_lineups,uuid[],integer,uuid,boolean) to service_role;
grant  execute on function public._notify_lineup_pulled(uuid,uuid,uuid[],text) to service_role;
grant  execute on function public._notify_lineup_moves(uuid,uuid,game_lineups) to service_role;

revoke execute on function public.offer_extension(uuid,bigint,integer,text) from public, anon;
revoke execute on function public.offer_free_agent(uuid,bigint,integer,text) from public, anon;
revoke execute on function public.request_extension(bigint,integer,text) from public, anon;
revoke execute on function public.reverse_trade(uuid,text) from public, anon;
revoke execute on function public.waitlist_admit(text,uuid) from public, anon;
revoke execute on function public.waitlist_remove(text,uuid,text) from public, anon;
grant  execute on function public.offer_extension(uuid,bigint,integer,text) to authenticated, service_role;
grant  execute on function public.offer_free_agent(uuid,bigint,integer,text) to authenticated, service_role;
grant  execute on function public.request_extension(bigint,integer,text) to authenticated, service_role;
grant  execute on function public.reverse_trade(uuid,text) to authenticated, service_role;
grant  execute on function public.waitlist_admit(text,uuid) to authenticated, service_role;
grant  execute on function public.waitlist_remove(text,uuid,text) to authenticated, service_role;
