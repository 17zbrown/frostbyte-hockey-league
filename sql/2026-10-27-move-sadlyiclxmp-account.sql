-- 2026-10-27, commissioner: "We had another member get hacked and need to make a new account and just joined the league
-- with his new discord. I need you to remove and permanently ban "sadlyiclxmp" and give all of their previous stats and
-- roles to "sadlyiclxmp." which is their new account. Please note the new account has the "." at the end of the
-- username where as the old account did not have that." The plan was confirmed with the commissioner before any change,
-- and the new account signed in to the site first ("The new account has signed in today.").
--
-- The two accounts (read 2026-10-27):
--   old  c60bd0b1-641f-4e92-b375-b71a2e37f957  SadlyiClxmp, Discord sadlyiclxmp (358023188795359232), joined Oct 15.
--        Placed on Boston by the late sign-up rotation on Oct 16, traded to Detroit Oct 17 (for LIL__Dark200). Holds:
--        the Detroit Season 1 roster spot (active roster, LW, #1), the $750,000 contract to the end of Season 1, the
--        Season 1 sign-up (LW), a Season 2 sign-up (C) made Oct 27 4:42 PM, the random-placement record (counts toward
--        the rotation), two weeks of availability (Season 1 weeks 4 and 5), the squad-move count at Detroit (2), four
--        roster stints, and the EA ID SadlyiClxmp on Xbox Series X|S.
--   new  00b2b99c-6802-4e4c-a92b-40b465a0a618  Discord sadlyiclxmp. (1564066735965995038), joined the server Oct 27
--        4:41 PM, signed in to the site 4:54 PM. Holds nothing.
-- No game statistics exist to move: Detroit has 15 final games since Oct 16 and no box-score line, linked or not, carries
-- this player (by profile, by EA ID or by name). Pickup statistics: none.
--
-- What this does, in one transaction, acting as the commissioner (the roster, sign-up and profile guards admit a
-- commissioner, and is_commissioner() reads auth.uid() from the claims below):
--   1. The old profile gives up its league name and EA ID (gamertag "SadlyiClxmp (old account)", ea_id null): the
--      gamertag is unique and the Discord sync never renames a profile onto a name another profile holds, and the box-score
--      importer matches on the EA ID first (netlify/functions/ingest-stats.js resolveProfile), so a future line must
--      reach the new profile and only it.
--   2. The new profile takes the name SadlyiClxmp, the EA ID, the console and the console gamertag.
--   3. The roster spot, contract, both sign-ups, random-placement record, availability and squad-move count move to the
--      new profile in place (UPDATE profile_id): nobody is released or signed, so Detroit's roster, cap and the movement
--      deadline are untouched. roster_tenures closes the old stint as "spot passed to another account" and opens the new
--      one; the earlier stints then move too, so the new profile carries the whole path (Boston, Detroit, camp, active).
--   4. ban_player bans the old profile (permanent until a commissioner lifts it). With everything moved first, its
--      removal step finds nothing left. The Discord sync then bans the old Discord account from the server on its next
--      pass (jobs/discord-sync.js, banned profiles are banned in the guild), and the new account is dressed from the
--      moved roster spot and sign-ups (role_sync_queue, the rsq triggers).
--   5. admin_audit 'account_moved'.
-- Guards: the acting profile is a commissioner; both profiles read exactly as mapped above; every move hits exactly the
-- rows expected; after the moves the old profile holds no roster spot, sign-up, active contract or EA ID and is banned, and
-- the new profile holds the Detroit spot (LW, #1, active roster), the active contract and both sign-ups. Any failure
-- raises and nothing is kept.
do $mv$
declare
  v_old uuid := 'c60bd0b1-641f-4e92-b375-b71a2e37f957';
  v_new uuid := '00b2b99c-6802-4e4c-a92b-40b465a0a618';
  v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_det uuid; v_s1 uuid; v_n int;
begin
  select id into v_det from public.teams where code = 'DET';
  select id into v_s1 from public.seasons where number = 1;
  if not exists (select 1 from public.profiles where id = v_commish and role::text = 'commissioner') then raise exception 'acting profile is not a commissioner'; end if;
  if not exists (select 1 from public.profiles where id = v_old and discord_id = '358023188795359232' and gamertag = 'SadlyiClxmp' and not coalesce(banned, false))
     or not exists (select 1 from public.profiles where id = v_new and discord_id = '1564066735965995038' and not coalesce(banned, false)) then
    raise exception 'the two profiles are not as mapped';
  end if;
  if (select count(*) from public.roster_spots where profile_id = v_old and team_id = v_det and season_id = v_s1 and squad = 'pro' and position::text = 'LW') <> 1
     or (select count(*) from public.roster_spots where profile_id = v_old) <> 1
     or (select count(*) from public.season_registrations where profile_id = v_old) <> 2
     or (select count(*) from public.contracts where profile_id = v_old and status = 'active' and team_id = v_det) <> 1
     or exists (select 1 from public.roster_spots where profile_id = v_new)
     or exists (select 1 from public.season_registrations where profile_id = v_new)
     or exists (select 1 from public.contracts where profile_id = v_new)
     or exists (select 1 from public.game_stats where profile_id in (v_old, v_new)) then
    raise exception 'the holdings are not as mapped';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);

  -- 1 and 2: the league name and the EA identity
  update public.profiles set gamertag = 'SadlyiClxmp (old account)', ea_id = null where id = v_old;
  update public.profiles set gamertag = 'SadlyiClxmp', ea_id = 'SadlyiClxmp', platform = 'XSX', platform_gamertag = 'SadlyiClxmp' where id = v_new;
  if not exists (select 1 from public.profiles where id = v_new and gamertag = 'SadlyiClxmp' and ea_id = 'SadlyiClxmp' and platform = 'XSX')
     or not exists (select 1 from public.profiles where id = v_old and gamertag = 'SadlyiClxmp (old account)' and ea_id is null) then
    raise exception 'the name and EA ID did not move (a guard reverted them)';
  end if;

  -- 3: the holdings, in place
  update public.roster_spots set profile_id = v_new where profile_id = v_old;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'roster spot: % rows', v_n; end if;
  update public.contracts set profile_id = v_new where profile_id = v_old;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'contract: % rows', v_n; end if;
  update public.season_registrations set profile_id = v_new where profile_id = v_old;
  get diagnostics v_n = row_count; if v_n <> 2 then raise exception 'sign-ups: % rows', v_n; end if;
  update public.random_assignments set profile_id = v_new where profile_id = v_old;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'random assignment: % rows', v_n; end if;
  update public.availability set profile_id = v_new where profile_id = v_old;
  get diagnostics v_n = row_count; if v_n <> 2 then raise exception 'availability: % rows', v_n; end if;
  update public.squad_move_history set profile_id = v_new where profile_id = v_old;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'squad moves: % rows', v_n; end if;
  update public.roster_tenures set profile_id = v_new where profile_id = v_old;
  get diagnostics v_n = row_count; if v_n <> 4 then raise exception 'roster stints: % rows (expected 4: the 3 earlier and the 1 just closed)', v_n; end if;
  /* the rating, by the ratings engine itself (profiles.overall is the engine's alone): the roster trigger refreshed the
     new profile before its sign-ups arrived, so it found no position; refresh both now, as trg_game_final_overall does */
  perform set_config('app.role_grant', 'on', true);
  perform public.refresh_player_overall(v_new);
  perform public.refresh_player_overall(v_old);
  perform set_config('app.role_grant', '', true);
  if not exists (select 1 from public.player_position_overalls where profile_id = v_new and headline)
     or (select overall from public.profiles where id = v_new) is null then
    raise exception 'the new profile has no rating after the engine refresh';
  end if;

  -- 4: the ban
  perform public.ban_player(v_old, 'Hacked account. The member moved to a new Discord account, sadlyiclxmp., which now holds their roster spot, contract and sign-ups.');

  -- 5: the record
  perform public.log_admin_action('account_moved', 'profile', v_new::text,
    jsonb_build_object('from', v_old, 'to', v_new, 'old_discord', '358023188795359232', 'new_discord', '1564066735965995038',
                       'moved', jsonb_build_array('roster spot', 'contract', 'sign-ups', 'random placement', 'availability', 'squad moves', 'roster stints', 'EA ID'),
                       'reason', 'hacked account; commissioner, 2026-10-27'));

  -- read back
  if exists (select 1 from public.roster_spots where profile_id = v_old) or exists (select 1 from public.season_registrations where profile_id = v_old)
     or exists (select 1 from public.contracts where profile_id = v_old and status in ('active', 'signed'))
     or not exists (select 1 from public.profiles where id = v_old and banned and ea_id is null) then
    raise exception 'the old profile still holds something, or is not banned';
  end if;
  if not exists (select 1 from public.roster_spots where profile_id = v_new and team_id = v_det and season_id = v_s1 and squad = 'pro' and position::text = 'LW' and jersey_number = 1)
     or (select count(*) from public.season_registrations where profile_id = v_new) <> 2
     or not exists (select 1 from public.contracts where profile_id = v_new and status = 'active' and team_id = v_det and salary = 750000)
     or (select count(*) from public.roster_tenures where profile_id = v_new and left_at is null and team_id = v_det) <> 1 then
    raise exception 'the new profile does not hold what moved';
  end if;
end
$mv$;
--
-- Rehearsed first (2026-10-27, one transaction on the live database, rolled back by a closing raise): REHEARSAL OK: new:
-- SadlyiClxmp ea=SadlyiClxmp XSX ovr=70 | ovr rows new: W=70* | old: SadlyiClxmp (old account) banned=true | notices:
-- none | club notices: none | transactions: none | audit: discipline_removal, account_moved | pg_net: none.
-- Two earlier rehearsal runs stopped and rolled back whole: the stint count was 4, not 5 (the stint the move closes is one
-- of the old profile's 4 rows), and the roster trigger refreshed the new profile's rating before its sign-ups arrived (no
-- position yet), so the engine refresh is now called explicitly after the moves.
-- Result (Oct 27, 5:02 PM ET): applied; every guard passed. Read back: the new profile is SadlyiClxmp (Discord
-- sadlyiclxmp.), EA ID SadlyiClxmp on XSX, overall 70, DET active roster LW #1, contract active $750,000, sign-ups S1 LW
-- and S2 C (both pending). The old profile is "SadlyiClxmp (old account)", banned with the reason above, and holds no
-- roster spot, sign-up, contract or EA ID. The Discord sync bans the old Discord account and dresses the new one on its
-- next pass.
