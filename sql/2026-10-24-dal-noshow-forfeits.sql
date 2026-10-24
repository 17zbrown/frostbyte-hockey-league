-- 2026-10-24, commissioner: "The stars no-show forfeited all 3 games last night."
-- Dallas's three Oct 23 fixtures:
--   9:00 PM  Stars at Penguins   (f764542f)  already FINAL: played 23 minutes, then three Dallas skaters left; ruled the
--            night before as an abandoned game, Dallas forfeiting, 3-1 as played with every statistic kept
--            (sql/2026-10-23-dal-pit-abandoned.sql, the commissioner's own choice with that record in view). Not touched.
--   9:35 PM  Stars at Kraken     (692da69c)  open, no match: recorded below.
--   10:10 PM Canucks at Stars    (b3054d0b)  open, no match: recorded below.
-- Checked first: Dallas's EASHL club (14654) has no match after 9:18 PM on Oct 23 or since, and the opponents played other
-- clubs in those windows (Seattle 4566 v 17688 at 9:27 and v 17957 at 10:38; Vancouver 21726 v 19122 at 9:30 and v 17688
-- at 9:59). Nobody took the ice in either fixture, so each is a Rule 3.2 forfeit: a 1-0 win for the club that was ready,
-- no individual statistics, and it counts toward no player's weekly total on either club.
--
-- Through forfeit_game's no-show branch, acting as the commissioner. That branch refuses a game with a match or a box
-- score, so a played game can never be struck this way. Guards: the acting profile is a commissioner; both fixtures are
-- open, Dallas's, with no match and no lines; after the calls each is final, 1-0 to the opponent, Dallas forfeiting. Any
-- failure raises and nothing is kept.
do $ns$
declare
  v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_games uuid[] := array['692da69c-1ba9-42dc-8fa4-562f6ae78d42', 'b3054d0b-5cf7-49c0-a9a3-fc50e6dda041']::uuid[];
  v_dal uuid; v_g uuid; v_res jsonb; v_row record;
begin
  select id into v_dal from public.teams where code = 'DAL';
  if not exists (select 1 from public.profiles where id = v_commish and role = 'commissioner') then raise exception 'acting profile is not a commissioner'; end if;
  if (select count(*) from public.games g where g.id = any(v_games) and g.status = 'scheduled' and not coalesce(g.voided, false) and g.ea_match_id is null
        and g.forfeit_team_id is null and (g.home_team_id = v_dal or g.away_team_id = v_dal)
        and not exists (select 1 from public.game_stats s where s.game_id = g.id)) <> 2 then raise exception 'the two Dallas fixtures are not both open and unplayed'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  foreach v_g in array v_games loop
    select public.forfeit_game(v_g, v_dal, 'Commissioner ruling, Oct 24: Dallas did not show for its Oct 23 game (Rule 3.2, no-show forfeit).', false) into v_res;
    if not coalesce((v_res->>'ok')::boolean, false) then raise exception 'ruling refused for %: %', v_g, v_res; end if;
  end loop;
  perform set_config('role', 'postgres', true);

  for v_row in select g.* from public.games g where g.id = any(v_games) loop
    if v_row.status <> 'final' or v_row.forfeit_team_id <> v_dal
       or (v_row.home_team_id = v_dal and (v_row.home_score, v_row.away_score) <> (0, 1))
       or (v_row.away_team_id = v_dal and (v_row.home_score, v_row.away_score) <> (1, 0)) then
      raise exception 'after the ruling % reads % %-% forfeit %', v_row.id, v_row.status, v_row.home_score, v_row.away_score, v_row.forfeit_team_id; end if;
  end loop;
end
$ns$;
--
-- Result (Oct 24, 9:41:19 AM ET): Kraken 1 Stars 0 and Stars 0 Canucks 1, both final, forfeits charged to Dallas, audit
-- 'noshow_forfeit' on each. All three of Dallas's Oct 23 games are now Dallas forfeits; Dallas has 13 forfeits this
-- season, past Rule 3.2's automatic referral at ten and three short of sixteen.
