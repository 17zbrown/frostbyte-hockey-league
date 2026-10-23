-- 2026-10-22, commissioner: "Can you import the Islanders v Mammoth game from their 9:00 game time? They have game stats
-- but Utah forfeits from abandoning the game." then "actually the good hope lakers were the mammoth."
-- Oct 22, 9:00 PM, Mammoth at Islanders (80dde669). Utah played under the outside EASHL club Good hope lakers (EA club
-- 16862). EA match 2792565940040 ended 9:20 PM after 1,200 seconds (one period): Islanders 3, Lakers 0, EA's win by DNF to
-- the Islanders, three Lakers skaters marked player_dnf (one after 1:56). All twelve players are league members rostered on
-- the club they played for (Utah: Deadeye8014, HiRolla, imCreeez113, Prohgrams, Rob, YoungBlood; Islanders: Vegas,
-- DaBallerTv, Hauntles, Suprèmêrüst, THERUTKING88, DosSiete). The importer had refused it: one club was not a league club.
--
-- What EA recorded when Utah left: Mammoth 4, Islanders 1. The players' goals, both goaltenders' goals against and EA's
-- raw goal counts (gfraw 4 and 1) agree; EA's club scores (Islanders 3, Lakers 0) are its automatic quit score, not goals.
--
-- The ruling (commissioner, Oct 22, asked and answered with that score in view): "Islanders win, Utah forfeits", and it is
-- a ONE-TIME ruling. Utah is charged with the forfeit and the Islanders get the win; every statistic counts and the score
-- shows what was played. Rule 4.3 as written (the club ahead keeps the win, the forfeit goes to the club behind) stays as
-- it is: this game only sets it aside, so forfeit_abandoned_game, which enforces that sentence, was not the door.
--
-- Part 1 (10:19 PM ET): the Rule 4.6 substitution, through the v3.20 door, acting as the commissioner. Guards: the
-- acting profile is a commissioner, the fixture is the open Mammoth at Islanders with no match and no ruling, EA club
-- 16862 belongs to no league club; exactly one substitution at the end. Called as `perform * from`.
do $sub$
declare
  v_uta uuid; v_nyi uuid; v_n int;
  v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_game uuid := '80dde669-626b-4fd9-a8ca-b514bcdbcc7e';
begin
  select id into v_uta from public.teams where code = 'UTA';
  select id into v_nyi from public.teams where code = 'NYI';
  if not exists (select 1 from public.profiles where id = v_commish and role = 'commissioner') then raise exception 'acting profile is not a commissioner'; end if;
  if not exists (select 1 from public.games where id = v_game and status = 'scheduled' and not coalesce(voided,false)
        and home_team_id = v_nyi and away_team_id = v_uta and ea_match_id is null and forfeit_team_id is null) then raise exception 'Mammoth at Islanders is not the open fixture expected'; end if;
  if exists (select 1 from public.teams where ea_club_id = '16862') then raise exception 'EA club 16862 belongs to a league club'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform * from public.set_game_club_substitution(v_game, '16862', v_uta,
    'Rule 4.6: Utah played its Oct 22 9:00 PM game against the Islanders under the outside EASHL club Good hope lakers (EA club 16862). Commissioner ruling, Oct 22: treat that club as Utah for this fixture only.');
  perform set_config('role', 'postgres', true);

  select count(*) into v_n from public.game_club_substitutions where game_id = v_game and ea_club_id = '16862' and team_id = v_uta;
  if v_n <> 1 then raise exception 'expected 1 substitution, found %', v_n; end if;
end
$sub$;
--
-- Part 2 (10:20:43 PM): the importer re-fetched the match inside its window and, the clock reading 1,200 of 3,600
-- seconds with a disconnect flagged, HELD it (v3.18): 12 lines written (Islanders 6, Utah 6, all 12 linked to their
-- members), the match stamped on the fixture, no status and no score, nothing announced.
--
-- Part 3 (10:24:40 PM): the ruling through forfeit_game's keep-the-result branch (v3.53), acting as the commissioner. On a
-- held game it sets the game final with Utah as the forfeiting club and the score the box score adds up to (Islanders 1,
-- Mammoth 4), in one write, and logs 'abandoned_forfeit'. game_winner gives the win of a forfeited game to the club that
-- did not forfeit, so the Islanders take it in the standings. The final posts through notify_discord_game_final, as any
-- filed game does. (A first attempt through forfeit_abandoned_game with 3-0 was stopped by its own guard, the box score
-- reading 1-4, and rolled back whole; nothing from it was kept.)
do $rule$
declare
  v_game uuid := '80dde669-626b-4fd9-a8ca-b514bcdbcc7e';
  v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_uta uuid; v_nyi uuid; v_res jsonb; v_g record;
begin
  select id into v_uta from public.teams where code = 'UTA';
  select id into v_nyi from public.teams where code = 'NYI';
  if not exists (select 1 from public.games where id = v_game and status = 'scheduled' and ea_match_id = '2792565940040'
        and home_team_id = v_nyi and away_team_id = v_uta and forfeit_team_id is null) then raise exception 'the game is not the held Mammoth at Islanders expected'; end if;
  if (select count(*) from public.game_stats where game_id = v_game and profile_id is not null) <> 12 then raise exception 'not all 12 lines are linked'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.forfeit_game(v_game, v_uta,
    'Commissioner ruling, Oct 22 (one-time): Utah abandoned the game after the first period, playing as Good hope lakers (Rule 4.6), while leading 4-1, and is charged with the forfeit; the Islanders get the win, and the played score and every statistic stand.',
    true) into v_res;
  perform set_config('role', 'postgres', true);
  if not coalesce((v_res->>'ok')::boolean, false) then raise exception 'ruling refused: %', v_res; end if;

  select * into v_g from public.games where id = v_game;
  if v_g.status <> 'final' or v_g.home_score <> 1 or v_g.away_score <> 4 or v_g.forfeit_team_id <> v_uta
     or public.game_winner(v_g.home_team_id, v_g.away_team_id, v_g.home_score, v_g.away_score, v_g.forfeit_team_id, v_g.voided) <> v_nyi then
    raise exception 'after the ruling the game reads % %-% forfeit %', v_g.status, v_g.home_score, v_g.away_score, v_g.forfeit_team_id; end if;
end
$rule$;
--
-- Result: final, Islanders 1 Mammoth 4, forfeit charged to Utah, winner the Islanders, 12 lines. Audit: the substitution
-- (10:19:20 PM), 'abandoned_forfeit' with score 1-4 (10:24:40 PM), and, written by the final's own review at the same moment,
-- 'lineup_not_filed' for Utah, week 5.
