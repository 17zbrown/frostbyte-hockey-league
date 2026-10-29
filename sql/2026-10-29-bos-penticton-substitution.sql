-- 2026-10-29, commissioner: "Can you check the API for a game the bruins had to play with a club named "LGCHL Pentictan
-- vees" or something similar? I believe game 2 of the night for them specifically was the game they used that club."
-- Found and laid out (Boston's own club was used for game 3 the same night; Boston also played as SBHL Edmonton Oilers
-- on Oct 22), then asked: record the substitution and import it as Dallas's win, or rule first? Commissioner: "yes".
--
-- The night's three Boston fixtures, Wed Oct 28, as found:
--   9:00 PM  Bruins at Penguins (b85e7ab7)  FINAL: a no-show forfeit by Boston, Penguins 1 0, ruled 9:10 PM. Not touched.
--   9:35 PM  Stars at Bruins    (8094aa65)  open: played under the outside EASHL club "Lgchl Penticton Vees" (EA club
--            9552). EA match 3080886950295, ended 10:17 PM ET, inside the fixture's window (9:25 PM to 12:35 AM): Stars 7,
--            Penticton Vees 6, overtime (69:40 on the clock), six players a side. Every Penticton player is a Bruin
--            (pmister3, tthehorse, ItzKloudzy, LIL__Dark200, Chunkydunks21 as LSF_Chunkydunks, Delagray924); every Stars
--            player is a Star (Lokharov92 as "Lokharov l92l", a persona already on record). The importer held it as
--            unmatched (one club is not a league club). Substitution recorded below.
--   10:10 PM Bruins at Kraken   (8f7783f4)  FINAL under Boston's own club (CGHL Boston Bruins, 19122), Kraken 8 3.
--
-- Rule 4.6 club substitution through the v3.20 door (sql/2026-09-25-club-substitution.sql), as the commissioner:
-- set_game_club_substitution is gated to stats staff or a commissioner and logs log_admin_action itself. Called as
-- `perform * from`, never `(f()).*` (the six-audit-rows trap). Boston's own EA link (19122) is untouched. Guards: the
-- acting profile is a commissioner, the fixture is open and Boston's, EA club 9552 belongs to no league club, and exactly
-- one substitution exists for the fixture at the end; any failure raises and nothing is kept.
-- The fixture's window has closed, so the match files when a commissioner presses Re-ingest for EA match 3080886950295
-- in the Control Center (EA stats): that replay needs the commissioner's own sign-in and widens the window to a day.
do $sub$
declare
  v_bos uuid; v_n int;
  v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_game uuid := '8094aa65-f043-4e4f-a510-1522fd68ca1e';
begin
  select id into v_bos from public.teams where code = 'BOS';
  if v_bos is null then raise exception 'no BOS team'; end if;
  if not exists (select 1 from public.profiles where id = v_commish and role = 'commissioner') then raise exception 'acting profile is not a commissioner'; end if;
  if not exists (select 1 from public.games where id = v_game and status = 'scheduled' and not coalesce(voided, false)
                   and (home_team_id = v_bos or away_team_id = v_bos)) then raise exception 'the Boston fixture is not open'; end if;
  if exists (select 1 from public.teams where ea_club_id = '9552') then raise exception 'EA club 9552 belongs to a league club'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform * from public.set_game_club_substitution(v_game, '9552', v_bos,
    'Rule 4.6: Boston played its Oct 28 9:35 PM game against Dallas under the outside EASHL club Lgchl Penticton Vees (EA club 9552). Commissioner ruling, Oct 29: treat that club as Boston for this game only.');
  perform set_config('role', 'postgres', true);

  select count(*) into v_n from public.game_club_substitutions where game_id = v_game and ea_club_id = '9552' and team_id = v_bos;
  if v_n <> 1 then raise exception 'expected 1 substitution, found %', v_n; end if;
end
$sub$;
--
-- Rehearsed first (rolled back by a closing raise): REHEARSAL OK: subs=1 audit=game_club_substitution pg_net=0.
-- Result (Oct 29 morning): applied; one row in game_club_substitutions, EA 9552 as BOS on 8094aa65. The fixture files
-- when the commissioner presses Re-ingest for EA match 3080886950295 (the relaxed replay reaches a day either side of
-- the fixture, so before about 9:35 PM ET on Oct 29).
