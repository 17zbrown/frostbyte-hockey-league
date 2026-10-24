-- 2026-10-23, commissioner: "The stars forfeit their game 1 tonight due to a no-show."
-- Oct 23, 9:00 PM, Stars at Penguins (f764542f). The record is not a no-show: EA match 2840105320235 (ended 9:18 PM ET)
-- holds 1,407 of 3,600 seconds between the two clubs' own EASHL clubs (Pittsburgh 22323, Dallas 14654), all twelve players
-- league members linked to their clubs. Three Dallas skaters are marked player_dnf (The May 7, TaaaylorSwift,
-- Lokharov l92l); no Pittsburgh player is. The players' goals and EA's raw goal counts agree: Penguins 3, Stars 1 (EA's
-- club scores, 3-0, are its automatic quit score). The importer HELD it at 9:20 PM ("23 of 60 minutes played and EA flagged
-- a disconnect", Rule 4.3, v3.18).
--
-- The ruling (commissioner, Oct 23, asked with that record in view, choosing "Abandoned, stats stand" over a 1-0 no-show):
-- Dallas forfeits; Pittsburgh's win stands on the 3-1 score as played; every statistic stands, and the game counts toward
-- each player's weekly total because it was played (Rule 4.3: "An abandoned game is a forfeit: the club ahead at the moment
-- play stopped is credited the win on the score as it stood, the club behind is recorded as forfeiting, and both clubs keep
-- every statistic"). That is what the importer would file by itself once either club played another opponent tonight; the
-- commissioner recorded it at once instead.
--
-- Through forfeit_game's keep-the-result branch (v3.53), acting as the commissioner: on a held game it sets the game final
-- with the forfeiting club and the score the box score adds up to, in one write, and logs 'abandoned_forfeit'. game_winner
-- gives a forfeited game to the club that did not forfeit. The final posts through notify_discord_game_final, as any filed
-- game does. Guards: the acting profile is a commissioner; the fixture is the held Stars at Penguins with this match and no
-- ruling; all 12 lines linked; the box reads Penguins 3, Stars 1; after the call the game is final 3-1, Dallas forfeiting,
-- Pittsburgh the winner. Any failure raises and nothing is kept.
do $rule$
declare
  v_game uuid := 'f764542f-da82-4c82-9958-831b94341c89';
  v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_dal uuid; v_pit uuid; v_res jsonb; v_g record;
begin
  select id into v_dal from public.teams where code = 'DAL';
  select id into v_pit from public.teams where code = 'PIT';
  if not exists (select 1 from public.profiles where id = v_commish and role = 'commissioner') then raise exception 'acting profile is not a commissioner'; end if;
  if not exists (select 1 from public.games where id = v_game and status = 'scheduled' and ea_match_id = '2840105320235' and not coalesce(voided, false)
        and home_team_id = v_pit and away_team_id = v_dal and forfeit_team_id is null) then raise exception 'the game is not the held Stars at Penguins expected'; end if;
  if (select count(*) from public.game_stats where game_id = v_game and profile_id is not null) <> 12 then raise exception 'not all 12 lines are linked'; end if;
  if (select sum(goals) from public.game_stats where game_id = v_game and team_id = v_pit) <> 3
     or (select sum(goals) from public.game_stats where game_id = v_game and team_id = v_dal) <> 1 then raise exception 'the box score does not read Penguins 3, Stars 1'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.forfeit_game(v_game, v_dal,
    'Commissioner ruling, Oct 23: Dallas left the game after 23 minutes (three skaters did not finish) with Pittsburgh leading 3-1, and is charged with the forfeit (Rule 4.3, abandoned game); the played score and every statistic stand.',
    true) into v_res;
  perform set_config('role', 'postgres', true);
  if not coalesce((v_res->>'ok')::boolean, false) then raise exception 'ruling refused: %', v_res; end if;

  select * into v_g from public.games where id = v_game;
  if v_g.status <> 'final' or v_g.home_score <> 3 or v_g.away_score <> 1 or v_g.forfeit_team_id <> v_dal
     or public.game_winner(v_g.home_team_id, v_g.away_team_id, v_g.home_score, v_g.away_score, v_g.forfeit_team_id, v_g.voided) <> v_pit then
    raise exception 'after the ruling the game reads % %-% forfeit %', v_g.status, v_g.home_score, v_g.away_score, v_g.forfeit_team_id; end if;
end
$rule$;
--
-- Result (9:44:23 PM ET): final, Penguins 3 Stars 1, forfeit charged to Dallas, winner Pittsburgh, 12 lines kept. Audit:
-- 'abandoned_forfeit' with score 3-1. The game counts toward every player's Week 5 total: NHL-Script (scriptnhl, Pittsburgh,
-- active roster) is at 5 of 6 after it.
