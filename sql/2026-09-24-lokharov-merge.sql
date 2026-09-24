-- v3.08 — a compromised account removed, and its EA record handed to the member's live account.
--
-- Commissioner: "remove this player from the database as they were banned. Their new account is
-- 'Lokharov14' but still holds the original EA ID of 'Lokharovl14l'. Make sure to give the
-- Lokharovl14l EA stats to the 'Lokharov14' display name."
--
-- WHAT WAS THERE. Two profiles, and the banned one was holding the stats:
--   a5907e9b… "Lokharov l14l"  ea_id ".."           persona 1007278735277  banned, no club, 3 lines
--   24bfa579… "Lokharov14"     ea_id "Lokharovl14l" persona NULL           staff, DAL,      0 lines
-- The old row's ban_reason is "compromised account" (2026-09-10), so the member is in good
-- standing and only the dead row needed to go. This is the v3.02 Lokharov case resolved the
-- other way round: the credit was landing on the duplicate because the duplicate held the
-- EA persona id, which resolveProfile asks for first and trusts above every name.
--
-- ORDER MATTERS. A unique partial index gives one persona to one profile, so the banned row has
-- to release 1007278735277 before the live row can take it. Moving the persona is the whole
-- point: from here the member matches on the id, so no rename or mistyped EA ID can cost him
-- his stats again, and nothing has to be repaired a second time.
begin;

update public.profiles set ea_player_id = null
 where id = 'a5907e9b-0997-4a4d-bff8-041fe47e4205';
update public.profiles set ea_player_id = '1007278735277'
 where id = '24bfa579-4cad-48ac-8cda-52fbf663cc06';
update public.game_stats set profile_id = '24bfa579-4cad-48ac-8cda-52fbf663cc06'
 where profile_id = 'a5907e9b-0997-4a4d-bff8-041fe47e4205';
update public.player_position_overalls o set profile_id = '24bfa579-4cad-48ac-8cda-52fbf663cc06'
 where o.profile_id = 'a5907e9b-0997-4a4d-bff8-041fe47e4205'
   and not exists (select 1 from public.player_position_overalls y
                    where y.profile_id = '24bfa579-4cad-48ac-8cda-52fbf663cc06'
                      and y.pos_cat = o.pos_cat);

commit;

-- Then the row itself, checked before it went: no stat lines, no roster spot, no contract left
-- on it, and the three lines confirmed on the live account first.
--   delete from public.profiles where id = 'a5907e9b-0997-4a4d-bff8-041fe47e4205';
--   delete from auth.users   where id = 'a5907e9b-0997-4a4d-bff8-041fe47e4205';
--
-- WHAT A PROFILE DELETE TAKES WITH IT, checked before deleting rather than after:
--   game_stats, guild_departures, draft_picks, awards  -> ON DELETE SET NULL (kept, unlinked)
--   ban_events, notifications, contracts, roster_spots -> ON DELETE CASCADE (gone)
-- So deleting a banned profile destroys the ban record, and ban_events is keyed on profile_id
-- with no Discord-id ban list anywhere: the profile row IS the enforcement. That costs nothing
-- here (the account was compromised, not the member, and the member is already back on a new
-- Discord id) but it is the thing to weigh before deleting any OTHER banned profile.
-- The auth.users row went too, so no login is left without a profile. on_auth_user_created
-- fires on INSERT only, so an existing login never re-creates a profile by signing in.
--
-- Result: Lokharov14 holds 8G 5A over the night's three games (6G 2A in the 9:00 PM PIT v DAL),
-- and W 84 over 3 GP, recomputed by the overalls trigger when the lines moved.
