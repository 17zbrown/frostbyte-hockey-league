-- 2026-10-23, commissioner: "Did Utah use that outside club the whole night? Check the other teams' on their schedule for the
-- night recent games to check." then, asked whether to file what was found: "File both".
-- Utah played all three of its Oct 22 games as Good hope lakers (EA club 16862); EA lists exactly three games for that club, one
-- per Utah fixture. The 9:00 at the Islanders was filed last night (sql/2026-10-22-uta-nyi-abandoned.sql). The other two:
--   9:35 PM  Stars at Mammoth (8a6772b2): EA match 2792848180369, ended 10:15 PM, 3,600 s, Lakers 4 Dallas 3. The importer had
--            archived it and refused it ("no open fixture between these clubs"), because the substitution covered only the 9:00.
--   10:10 PM Bruins at Mammoth (d3c5800a): EA match 2798069310152, ended 10:49 PM, 4,793 s (overtime), Edmonton (Boston, Rule 4.6
--            since last night) 4, Lakers 3. Both sides were borrowed clubs, so the poller (which reads only league-linked clubs)
--            never saw it; fetched read-only from EA's match history for club 16862 with the poller's own headers on 2026-10-23.
-- Both importer windows had closed (puck drop + 3 h), so each is filed by the league office the way the Oct 9 games were
-- (sql/2026-10-10-bos-dal-filed.sql): the Rule 4.6 substitution through its door, acting as the commissioner; the box score built
-- from the payload with that file's mapping, which reproduced the importer's own 12 lines for match 2792565940040 column for
-- column (42 columns, zero differences, checked 2026-10-23 before running); every line resolved to a profile; the goals checked
-- against EA's raw goals; the game set final with the fields the importer sets (status, score, went_ot, ea_match_id, power
-- plays). Each block is one transaction that raises on any mismatch. The finals post through notify_discord_game_final.

do $fileA$
declare v_game uuid := '8a6772b2-d32f-449e-af49-57a90765f11a'; v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_dal uuid; v_uta uuid; v_n int; v_hs int; v_as int;
begin
  select id into v_dal from public.teams where code = 'DAL';
  select id into v_uta from public.teams where code = 'UTA';
  if not exists (select 1 from public.profiles where id = v_commish and role = 'commissioner') then raise exception 'acting profile is not a commissioner'; end if;
  if not exists (select 1 from public.games where id = v_game and status = 'scheduled' and not coalesce(voided,false) and away_team_id = v_dal and home_team_id = v_uta
        and ea_match_id is null and forfeit_team_id is null) then raise exception 'Stars at Mammoth is not the open fixture expected'; end if;
  if exists (select 1 from public.game_stats where game_id = v_game) then raise exception 'the game already has lines'; end if;
  if not exists (select 1 from public.ea_ingest_log where ea_match_id = '2792848180369' and status = 'unmatched' and game_id is null) then raise exception 'match 2792848180369 is not the unmatched archive row expected'; end if;
  if exists (select 1 from public.teams where ea_club_id = '16862') then raise exception 'EA club 16862 belongs to a league club'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform * from public.set_game_club_substitution(v_game, '16862', v_uta,
    'Rule 4.6: Utah played its Oct 22 9:35 PM game under the outside EASHL club Good hope lakers (EA club 16862), as it did all night. Commissioner ruling, Oct 23: treat that club as Utah for this fixture only.');
  perform set_config('role', 'postgres', true);
  insert into public.game_stats (game_id, team_id, profile_id, skater_name, position, goals, assists, shots, hits, pim, is_goalie,
      saves, shots_against, goals_against, ea_player_id, plus_minus, takeaways, giveaways, faceoffs_won, faceoffs_lost,
      time_on_ice_seconds, pp_goals, sh_goals, gwg, blocked_shots, interceptions, passes_completed, passes_attempted,
      shot_attempts, possession_seconds, penalties_drawn, deflections, saucer_passes, offense_rating, defense_rating,
      team_play_rating, breakaway_shots, breakaway_saves, poke_checks, shutout, diving_saves, shutout_periods,
      pen_shot_saves, pen_shots_against)
  select v_game, case c.key when '14654' then v_dal when '16862' then v_uta end,
         (with pp as (select btrim(regexp_replace(p.value->>'playername', '[%,()*"]', '', 'g')) tag)
          select coalesce(
            (select case when count(*) = 1 then min(id::text) end from public.profiles where ea_player_id = p.key),
            (select gs.profile_id::text from public.game_stats gs where gs.ea_player_id = p.key and gs.profile_id is not null order by gs.created_at desc limit 1),
            (select case when count(*) = 1 then min(id::text) end from public.profiles, pp where lower(ea_id) = lower(pp.tag)))::uuid from pp),
         p.value->>'playername',
         (case when lower(p.value->>'position') like '%goalie%' then 'G' when lower(p.value->>'position') like '%center%' then 'C'
               when lower(p.value->>'position') like '%left%' and lower(p.value->>'position') like '%wing%' then 'LW'
               when lower(p.value->>'position') like '%right%' and lower(p.value->>'position') like '%wing%' then 'RW'
               when lower(p.value->>'position') like '%left%' and lower(p.value->>'position') like '%def%' then 'LD'
               when lower(p.value->>'position') like '%right%' and lower(p.value->>'position') like '%def%' then 'RD'
               when lower(p.value->>'position') like '%def%' then 'D' else 'C' end)::public.hockey_position,
         coalesce(nullif(p.value->>'skgoals',''),'0')::int, coalesce(nullif(p.value->>'skassists',''),'0')::int,
         coalesce(nullif(p.value->>'skshots',''),'0')::int, coalesce(nullif(p.value->>'skhits',''),'0')::int,
         coalesce(nullif(p.value->>'skpim',''),'0')::int, g.isg,
         case when g.isg then coalesce(nullif(p.value->>'glsaves',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glshots',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glga',''),'0')::int else 0 end,
         p.key, coalesce(nullif(p.value->>'skplusmin',''),'0')::int, coalesce(nullif(p.value->>'sktakeaways',''),'0')::int,
         coalesce(nullif(p.value->>'skgiveaways',''),'0')::int, coalesce(nullif(p.value->>'skfow',''),'0')::int,
         coalesce(nullif(p.value->>'skfol',''),'0')::int, coalesce(nullif(p.value->>'toiseconds',''),'0')::int,
         coalesce(nullif(p.value->>'skppg',''),'0')::int, coalesce(nullif(p.value->>'skshg',''),'0')::int,
         coalesce(nullif(p.value->>'skgwg',''),'0')::int, coalesce(nullif(p.value->>'skbs',''),'0')::int,
         coalesce(nullif(p.value->>'skinterceptions',''),'0')::int, coalesce(nullif(p.value->>'skpasses',''),'0')::int,
         coalesce(nullif(p.value->>'skpassattempts',''),'0')::int, coalesce(nullif(p.value->>'skshotattempts',''),'0')::int,
         coalesce(nullif(p.value->>'skpossession',''),'0')::int, coalesce(nullif(p.value->>'skpenaltiesdrawn',''),'0')::int,
         coalesce(nullif(p.value->>'skdeflections',''),'0')::int, coalesce(nullif(p.value->>'sksaucerpasses',''),'0')::int,
         coalesce(nullif(p.value->>'ratingOffense',''),'0')::numeric, coalesce(nullif(p.value->>'ratingDefense',''),'0')::numeric,
         coalesce(nullif(p.value->>'ratingTeamplay',''),'0')::numeric,
         case when g.isg then coalesce(nullif(p.value->>'glbrkshots',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glbrksaves',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glpokechecks',''),'0')::int else 0 end,
         g.isg and coalesce(nullif(p.value->>'glga',''),'0')::int = 0 and coalesce(nullif(p.value->>'glshots',''),'0')::int > 0,
         case when g.isg then coalesce(nullif(p.value->>'gldsaves',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glsoperiods',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glpensaves',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glpenshots',''),'0')::int else 0 end
    from public.ea_ingest_log l, jsonb_each(l.payload->'players') c, jsonb_each(c.value) p,
         lateral (select lower(coalesce(p.value->>'position','')) like '%goalie%' as isg) g
   where l.ea_match_id = '2792848180369';
  get diagnostics v_n = row_count;
  if v_n <> 12 then raise exception 'expected 12 lines, wrote %', v_n; end if;
  if exists (select 1 from public.game_stats where game_id = v_game and (profile_id is null or team_id is null)) then raise exception 'a line did not resolve'; end if;
  select coalesce(sum(goals) filter (where team_id = v_uta), 0), coalesce(sum(goals) filter (where team_id = v_dal), 0) into v_hs, v_as from public.game_stats where game_id = v_game;
  if v_hs <> 4 or v_as <> 3 then raise exception 'box score adds to % (UTA) to % (DAL), expected 4 to 3', v_hs, v_as; end if;
  update public.games set status = 'final', home_score = v_hs, away_score = v_as, went_ot = false, ea_match_id = '2792848180369',
         home_ppg = 0, home_ppo = 1, away_ppg = 0, away_ppo = 0 where id = v_game;
  update public.ea_ingest_log set status = 'ingested', game_id = v_game, last_attempt_at = now(),
         reason = 'filed by the league office 2026-10-23: Utah as Good hope lakers (Rule 4.6), Mammoth 4 Stars 3' where ea_match_id = '2792848180369';
  perform public.log_admin_action('ea_match_filed_by_office', 'game', v_game::text,
    jsonb_build_object('ea_match_id', '2792848180369', 'score', v_hs || '-' || v_as, 'clubs', 'UTA as Good hope lakers (16862)', 'by', 'commissioner'));
end $fileA$;

-- 10:10, step 1 (9:12 AM): archive EA's record as the poller would have, then confirm it arrived intact (per club: players,
-- goals, time on ice, possession, passes and saves all equal the local copy: 6/4/28614/1838/95/26 and 6/3/28715/1289/84/14).
do $arch$
begin
  if exists (select 1 from public.ea_ingest_log where ea_match_id = '2798069310152') then raise exception 'match 2798069310152 is already archived'; end if;
  insert into public.ea_ingest_log (ea_match_id, payload, et_day, ea_club_ids, status, reason, game_id)
    values ('2798069310152', $payload${"matchId":"2798069310152","timestamp":1792723781,"timeAgo":{"number":10,"unit":"hours"},"clubs":{"959":{"clubDivision":"9","cNhlOnlineGameType":"5","garaw":"3","gfraw":"4","losses":"0","memberString":"6 / 6","opponentClubId":"16862","opponentScore":"3","opponentTeamArtAbbr":"EASHL","passa":"134","passc":"100","ppg":"1","ppo":"1","result":"5","score":"4","scoreString":"4 - 3","shots":"18","teamArtAbbr":"DROP","teamSide":"1","toa":"918","winnerByDnf":"0","winnerByGoalieDnf":"0","details":{"name":"SBHL Edmonton Oilers","clubId":959,"regionId":6,"teamId":284,"customKit":{"isCustomTeam":"1","crestAssetId":"11","useBaseAsset":"0"}},"goals":"4","goalsAgainst":"3"},"16862":{"clubDivision":"4","cNhlOnlineGameType":"5","garaw":"4","gfraw":"3","losses":"0","memberString":"6 / 6","opponentClubId":"959","opponentScore":"4","opponentTeamArtAbbr":"DROP","passa":"113","passc":"87","ppg":"1","ppo":"1","result":"6","score":"3","scoreString":"3 - 4","shots":"29","teamArtAbbr":"EASHL","teamSide":"0","toa":"416","winnerByDnf":"0","winnerByGoalieDnf":"0","details":{"name":"Good hope lakers","clubId":16862,"regionId":7,"teamId":286,"customKit":{"isCustomTeam":"1","crestAssetId":"92","useBaseAsset":"1"}},"goals":"3","goalsAgainst":"4"}},"players":{"959":{"218071394":{"class":"3","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"1","opponentClubId":"16862","opponentScore":"3","opponentTeamId":"500","player_dnf":"0","playerLevel":"11","pNhlOnlineGameType":"5","position":"leftWing","posSorted":"4","ratingDefense":"80.00","ratingOffense":"100.00","ratingTeamplay":"85.00","score":"4","skassists":"1","skbs":"1","skdeflections":"0","skfol":"0","skfopct":"0.00","skfow":"0","skgiveaways":"21","skgoals":"2","skgwg":"1","skhits":"12","skinterceptions":"2","skpassattempts":"31","skpasses":"20","skpasspct":"64.52","skpenaltiesdrawn":"0","skpim":"0","skpkclearzone":"1","skplusmin":"1","skpossession":"476","skppg":"1","sksaucerpasses":"0","skshg":"0","skshotattempts":"4","skshotonnetpct":"50.00","skshotpct":"100.00","skshots":"2","sktakeaways":"2","teamId":"501","teamSide":"1","toi":"80","toiseconds":"4793","playername":"Delco PAWXS","clientPlatform":"xbsx"},"253166668":{"class":"14","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"1","opponentClubId":"16862","opponentScore":"3","opponentTeamId":"500","player_dnf":"1","playerLevel":"21","pNhlOnlineGameType":"5","position":"defenseMen","posSorted":"2","ratingDefense":"95.00","ratingOffense":"80.00","ratingTeamplay":"60.00","score":"4","skassists":"1","skbs":"6","skdeflections":"0","skfol":"0","skfopct":"0.00","skfow":"0","skgiveaways":"3","skgoals":"0","skgwg":"0","skhits":"0","skinterceptions":"3","skpassattempts":"34","skpasses":"31","skpasspct":"91.18","skpenaltiesdrawn":"0","skpim":"0","skpkclearzone":"0","skplusmin":"0","skpossession":"479","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"4","skshotonnetpct":"0.00","skshotpct":"0.00","skshots":"0","sktakeaways":"5","teamId":"501","teamSide":"1","toi":"78","toiseconds":"4694","playername":"xXevanvvXx","clientPlatform":"ps5"},"723977422":{"class":"1","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"1","opponentClubId":"16862","opponentScore":"3","opponentTeamId":"500","player_dnf":"0","playerLevel":"50","pNhlOnlineGameType":"5","position":"center","posSorted":"5","ratingDefense":"85.00","ratingOffense":"100.00","ratingTeamplay":"45.00","score":"4","skassists":"2","skbs":"6","skdeflections":"2","skfol":"17","skfopct":"37.04","skfow":"10","skgiveaways":"7","skgoals":"0","skgwg":"0","skhits":"2","skinterceptions":"1","skpassattempts":"23","skpasses":"16","skpasspct":"69.57","skpenaltiesdrawn":"0","skpim":"2","skpkclearzone":"0","skplusmin":"1","skpossession":"307","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"6","skshotonnetpct":"83.33","skshotpct":"0.00","skshots":"5","sktakeaways":"2","teamId":"501","teamSide":"1","toi":"79","toiseconds":"4748","playername":"wcTrickster","clientPlatform":"xbsx"},"1118374213":{"class":"21","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"1","gldsaves":"0","glga":"3","glgaa":"2.25","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.90","glsaves":"26","glshots":"29","glsoperiods":"1","isGuest":"0","opponentClubId":"16862","opponentScore":"3","opponentTeamId":"500","player_dnf":"0","playerLevel":"55","pNhlOnlineGameType":"5","position":"goalie","posSorted":"0","ratingDefense":"75.00","ratingOffense":"85.00","ratingTeamplay":"70.00","score":"4","skassists":"0","skbs":"0","skdeflections":"0","skfol":"0","skfopct":"0.00","skfow":"0","skgiveaways":"0","skgoals":"0","skgwg":"0","skhits":"0","skinterceptions":"0","skpassattempts":"0","skpasses":"0","skpasspct":"0.00","skpenaltiesdrawn":"0","skpim":"0","skpkclearzone":"0","skplusmin":"0","skpossession":"0","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"0","skshotonnetpct":"0.00","skshotpct":"0.00","skshots":"0","sktakeaways":"0","teamId":"501","teamSide":"1","toi":"80","toiseconds":"4793","playername":"ItzKloudzy","clientPlatform":"xbsx"},"1123662793":{"class":"4","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"1","opponentClubId":"16862","opponentScore":"3","opponentTeamId":"500","player_dnf":"0","playerLevel":"37","pNhlOnlineGameType":"5","position":"rightWing","posSorted":"3","ratingDefense":"75.00","ratingOffense":"85.00","ratingTeamplay":"65.00","score":"4","skassists":"0","skbs":"1","skdeflections":"1","skfol":"2","skfopct":"0.00","skfow":"0","skgiveaways":"22","skgoals":"2","skgwg":"0","skhits":"2","skinterceptions":"1","skpassattempts":"20","skpasses":"12","skpasspct":"60.00","skpenaltiesdrawn":"0","skpim":"0","skpkclearzone":"0","skplusmin":"1","skpossession":"320","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"11","skshotonnetpct":"63.64","skshotpct":"28.57","skshots":"7","sktakeaways":"2","teamId":"501","teamSide":"1","toi":"80","toiseconds":"4793","playername":"LIL__Dark200","clientPlatform":"ps5"},"1009321302098":{"class":"15","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"1","opponentClubId":"16862","opponentScore":"3","opponentTeamId":"500","player_dnf":"0","playerLevel":"80","pNhlOnlineGameType":"5","position":"defenseMen","posSorted":"1","ratingDefense":"90.00","ratingOffense":"65.00","ratingTeamplay":"65.00","score":"4","skassists":"0","skbs":"3","skdeflections":"0","skfol":"0","skfopct":"0.00","skfow":"0","skgiveaways":"6","skgoals":"0","skgwg":"0","skhits":"1","skinterceptions":"2","skpassattempts":"21","skpasses":"16","skpasspct":"76.19","skpenaltiesdrawn":"1","skpim":"0","skpkclearzone":"0","skplusmin":"1","skpossession":"256","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"2","skshotonnetpct":"50.00","skshotpct":"0.00","skshots":"1","sktakeaways":"2","teamId":"501","teamSide":"1","toi":"80","toiseconds":"4793","playername":"Delagray924","clientPlatform":"ps5"}},"16862":{"517312867":{"class":"6","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"0","opponentClubId":"959","opponentScore":"4","opponentTeamId":"501","player_dnf":"0","playerLevel":"23","pNhlOnlineGameType":"5","position":"center","posSorted":"5","ratingDefense":"100.00","ratingOffense":"85.00","ratingTeamplay":"60.00","score":"3","skassists":"2","skbs":"2","skdeflections":"0","skfol":"9","skfopct":"67.86","skfow":"19","skgiveaways":"8","skgoals":"0","skgwg":"0","skhits":"4","skinterceptions":"0","skpassattempts":"16","skpasses":"10","skpasspct":"62.50","skpenaltiesdrawn":"0","skpim":"2","skpkclearzone":"0","skplusmin":"-1","skpossession":"116","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"6","skshotonnetpct":"50.00","skshotpct":"0.00","skshots":"3","sktakeaways":"6","teamId":"500","teamSide":"0","toi":"79","toiseconds":"4750","playername":"Prohgrams","clientPlatform":"xbsx"},"1602453836":{"class":"14","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"1","opponentClubId":"959","opponentScore":"4","opponentTeamId":"501","player_dnf":"0","playerLevel":"17","pNhlOnlineGameType":"5","position":"defenseMen","posSorted":"2","ratingDefense":"85.00","ratingOffense":"70.00","ratingTeamplay":"65.00","score":"3","skassists":"1","skbs":"0","skdeflections":"0","skfol":"0","skfopct":"0.00","skfow":"0","skgiveaways":"9","skgoals":"0","skgwg":"0","skhits":"0","skinterceptions":"2","skpassattempts":"24","skpasses":"17","skpasspct":"70.83","skpenaltiesdrawn":"0","skpim":"0","skpkclearzone":"0","skplusmin":"-1","skpossession":"193","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"1","skshotonnetpct":"100.00","skshotpct":"0.00","skshots":"1","sktakeaways":"5","teamId":"500","teamSide":"0","toi":"80","toiseconds":"4793","playername":"TheCrazyIsh","clientPlatform":"xbsx"},"1732174937":{"class":"1","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"1","opponentClubId":"959","opponentScore":"4","opponentTeamId":"501","player_dnf":"0","playerLevel":"47","pNhlOnlineGameType":"5","position":"rightWing","posSorted":"3","ratingDefense":"90.00","ratingOffense":"75.00","ratingTeamplay":"65.00","score":"3","skassists":"1","skbs":"0","skdeflections":"0","skfol":"1","skfopct":"0.00","skfow":"0","skgiveaways":"4","skgoals":"1","skgwg":"0","skhits":"1","skinterceptions":"0","skpassattempts":"23","skpasses":"19","skpasspct":"82.61","skpenaltiesdrawn":"0","skpim":"0","skpkclearzone":"0","skplusmin":"-1","skpossession":"306","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"13","skshotonnetpct":"53.85","skshotpct":"14.29","skshots":"7","sktakeaways":"10","teamId":"500","teamSide":"0","toi":"80","toiseconds":"4793","playername":"Deadeye8014","clientPlatform":"xbsx"},"1843907431":{"class":"2","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"1","opponentClubId":"959","opponentScore":"4","opponentTeamId":"501","player_dnf":"0","playerLevel":"62","pNhlOnlineGameType":"5","position":"leftWing","posSorted":"4","ratingDefense":"75.00","ratingOffense":"80.00","ratingTeamplay":"65.00","score":"3","skassists":"1","skbs":"1","skdeflections":"0","skfol":"0","skfopct":"0.00","skfow":"0","skgiveaways":"6","skgoals":"0","skgwg":"0","skhits":"1","skinterceptions":"1","skpassattempts":"23","skpasses":"17","skpasspct":"73.91","skpenaltiesdrawn":"0","skpim":"0","skpkclearzone":"0","skplusmin":"-1","skpossession":"385","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"19","skshotonnetpct":"73.68","skshotpct":"0.00","skshots":"14","sktakeaways":"3","teamId":"500","teamSide":"0","toi":"80","toiseconds":"4793","playername":"YoungBlood9340","clientPlatform":"xbsx"},"1004486290545":{"class":"21","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"4","glga":"4","glgaa":"3.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.78","glsaves":"14","glshots":"18","glsoperiods":"0","isGuest":"1","opponentClubId":"959","opponentScore":"4","opponentTeamId":"501","player_dnf":"0","playerLevel":"5","pNhlOnlineGameType":"5","position":"goalie","posSorted":"0","ratingDefense":"95.00","ratingOffense":"65.00","ratingTeamplay":"55.00","score":"3","skassists":"0","skbs":"0","skdeflections":"0","skfol":"0","skfopct":"0.00","skfow":"0","skgiveaways":"0","skgoals":"0","skgwg":"0","skhits":"0","skinterceptions":"0","skpassattempts":"0","skpasses":"0","skpasspct":"0.00","skpenaltiesdrawn":"0","skpim":"0","skpkclearzone":"0","skplusmin":"0","skpossession":"0","skppg":"0","sksaucerpasses":"0","skshg":"0","skshotattempts":"0","skshotonnetpct":"0.00","skshotpct":"0.00","skshots":"0","sktakeaways":"0","teamId":"500","teamSide":"0","toi":"80","toiseconds":"4793","playername":"vDarkiee___","clientPlatform":"ps5"},"1008781110993":{"class":"12","glbrksavepct":"0.00","glbrksaves":"0","glbrkshots":"0","gldsaves":"0","glga":"0","glgaa":"0.00","glpensavepct":"0.00","glpensaves":"0","glpenshots":"0","glpkclearzone":"0","glpokechecks":"0","glsavepct":"0.00","glsaves":"0","glshots":"0","glsoperiods":"0","isGuest":"1","opponentClubId":"959","opponentScore":"4","opponentTeamId":"501","player_dnf":"0","playerLevel":"49","pNhlOnlineGameType":"5","position":"defenseMen","posSorted":"1","ratingDefense":"95.00","ratingOffense":"95.00","ratingTeamplay":"60.00","score":"3","skassists":"0","skbs":"1","skdeflections":"0","skfol":"0","skfopct":"0.00","skfow":"0","skgiveaways":"3","skgoals":"2","skgwg":"0","skhits":"0","skinterceptions":"0","skpassattempts":"24","skpasses":"21","skpasspct":"87.50","skpenaltiesdrawn":"1","skpim":"0","skpkclearzone":"0","skplusmin":"-1","skpossession":"289","skppg":"1","sksaucerpasses":"0","skshg":"0","skshotattempts":"7","skshotonnetpct":"42.86","skshotpct":"66.67","skshots":"3","sktakeaways":"4","teamId":"500","teamSide":"0","toi":"80","toiseconds":"4793","playername":"Doctor Shmoney","clientPlatform":"xbsx"}}},"aggregate":{"959":{"class":58,"glbrksavepct":0,"glbrksaves":0,"glbrkshots":1,"gldsaves":0,"glga":3,"glgaa":2.25,"glpensavepct":0,"glpensaves":0,"glpenshots":0,"glpkclearzone":0,"glpokechecks":0,"glsavepct":0.9,"glsaves":26,"glshots":29,"glsoperiods":1,"isGuest":5,"opponentClubId":101172,"opponentScore":18,"opponentTeamId":3000,"player_dnf":1,"playerLevel":254,"pNhlOnlineGameType":30,"position":0,"posSorted":15,"ratingDefense":500,"ratingOffense":515,"ratingTeamplay":390,"score":24,"skassists":4,"skbs":17,"skdeflections":3,"skfol":19,"skfopct":37.04,"skfow":10,"skgiveaways":59,"skgoals":4,"skgwg":1,"skhits":17,"skinterceptions":9,"skpassattempts":129,"skpasses":95,"skpasspct":361.46,"skpenaltiesdrawn":1,"skpim":2,"skpkclearzone":1,"skplusmin":4,"skpossession":1838,"skppg":1,"sksaucerpasses":0,"skshg":0,"skshotattempts":27,"skshotonnetpct":246.97,"skshotpct":128.57,"skshots":15,"sktakeaways":13,"teamId":3006,"teamSide":6,"toi":477,"toiseconds":28614},"16862":{"class":56,"glbrksavepct":0,"glbrksaves":0,"glbrkshots":0,"gldsaves":4,"glga":4,"glgaa":3,"glpensavepct":0,"glpensaves":0,"glpenshots":0,"glpkclearzone":0,"glpokechecks":0,"glsavepct":0.78,"glsaves":14,"glshots":18,"glsoperiods":0,"isGuest":5,"opponentClubId":5754,"opponentScore":24,"opponentTeamId":3006,"player_dnf":0,"playerLevel":203,"pNhlOnlineGameType":30,"position":0,"posSorted":15,"ratingDefense":540,"ratingOffense":470,"ratingTeamplay":370,"score":18,"skassists":5,"skbs":4,"skdeflections":0,"skfol":10,"skfopct":67.86,"skfow":19,"skgiveaways":30,"skgoals":3,"skgwg":0,"skhits":6,"skinterceptions":3,"skpassattempts":110,"skpasses":84,"skpasspct":377.35,"skpenaltiesdrawn":1,"skpim":2,"skpkclearzone":0,"skplusmin":-5,"skpossession":1289,"skppg":1,"sksaucerpasses":0,"skshg":0,"skshotattempts":46,"skshotonnetpct":320.39,"skshotpct":80.96,"skshots":28,"sktakeaways":28,"teamId":3000,"teamSide":0,"toi":479,"toiseconds":28715}}}$payload$::jsonb, date '2026-10-22', array['959','16862'],
      'unmatched', 'archived by the league office 2026-10-23: fetched from EA for club 16862; both clubs were borrowed (Rule 4.6), so the poller never saw it', null);
end $arch$;

-- 10:10, step 2 (9:13 AM): file it from the archive.
do $fileB$
declare v_game uuid := 'd3c5800a-8cdb-464d-9f7a-09df5283c113'; v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_bos uuid; v_uta uuid; v_n int; v_hs int; v_as int;
begin
  select id into v_bos from public.teams where code = 'BOS';
  select id into v_uta from public.teams where code = 'UTA';
  if not exists (select 1 from public.profiles where id = v_commish and role = 'commissioner') then raise exception 'acting profile is not a commissioner'; end if;
  if not exists (select 1 from public.games where id = v_game and status = 'scheduled' and not coalesce(voided,false) and away_team_id = v_bos and home_team_id = v_uta
        and ea_match_id is null and forfeit_team_id is null) then raise exception 'Bruins at Mammoth is not the open fixture expected'; end if;
  if not exists (select 1 from public.game_club_substitutions where game_id = v_game and ea_club_id = '959' and team_id = v_bos) then raise exception 'Boston''s Edmonton substitution is missing'; end if;
  if exists (select 1 from public.game_stats where game_id = v_game) then raise exception 'the game already has lines'; end if;
  if not exists (select 1 from public.ea_ingest_log where ea_match_id = '2798069310152' and status = 'unmatched' and game_id is null) then raise exception 'match 2798069310152 is not the archived row expected'; end if;
  if exists (select 1 from public.teams where ea_club_id = '16862') then raise exception 'EA club 16862 belongs to a league club'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform * from public.set_game_club_substitution(v_game, '16862', v_uta,
    'Rule 4.6: Utah played its Oct 22 10:10 PM game under the outside EASHL club Good hope lakers (EA club 16862), as it did all night. Commissioner ruling, Oct 23: treat that club as Utah for this fixture only.');
  perform set_config('role', 'postgres', true);
  insert into public.game_stats (game_id, team_id, profile_id, skater_name, position, goals, assists, shots, hits, pim, is_goalie,
      saves, shots_against, goals_against, ea_player_id, plus_minus, takeaways, giveaways, faceoffs_won, faceoffs_lost,
      time_on_ice_seconds, pp_goals, sh_goals, gwg, blocked_shots, interceptions, passes_completed, passes_attempted,
      shot_attempts, possession_seconds, penalties_drawn, deflections, saucer_passes, offense_rating, defense_rating,
      team_play_rating, breakaway_shots, breakaway_saves, poke_checks, shutout, diving_saves, shutout_periods,
      pen_shot_saves, pen_shots_against)
  select v_game, case c.key when '959' then v_bos when '16862' then v_uta end,
         (with pp as (select btrim(regexp_replace(p.value->>'playername', '[%,()*"]', '', 'g')) tag)
          select coalesce(
            (select case when count(*) = 1 then min(id::text) end from public.profiles where ea_player_id = p.key),
            (select gs.profile_id::text from public.game_stats gs where gs.ea_player_id = p.key and gs.profile_id is not null order by gs.created_at desc limit 1),
            (select case when count(*) = 1 then min(id::text) end from public.profiles, pp where lower(ea_id) = lower(pp.tag)))::uuid from pp),
         p.value->>'playername',
         (case when lower(p.value->>'position') like '%goalie%' then 'G' when lower(p.value->>'position') like '%center%' then 'C'
               when lower(p.value->>'position') like '%left%' and lower(p.value->>'position') like '%wing%' then 'LW'
               when lower(p.value->>'position') like '%right%' and lower(p.value->>'position') like '%wing%' then 'RW'
               when lower(p.value->>'position') like '%left%' and lower(p.value->>'position') like '%def%' then 'LD'
               when lower(p.value->>'position') like '%right%' and lower(p.value->>'position') like '%def%' then 'RD'
               when lower(p.value->>'position') like '%def%' then 'D' else 'C' end)::public.hockey_position,
         coalesce(nullif(p.value->>'skgoals',''),'0')::int, coalesce(nullif(p.value->>'skassists',''),'0')::int,
         coalesce(nullif(p.value->>'skshots',''),'0')::int, coalesce(nullif(p.value->>'skhits',''),'0')::int,
         coalesce(nullif(p.value->>'skpim',''),'0')::int, g.isg,
         case when g.isg then coalesce(nullif(p.value->>'glsaves',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glshots',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glga',''),'0')::int else 0 end,
         p.key, coalesce(nullif(p.value->>'skplusmin',''),'0')::int, coalesce(nullif(p.value->>'sktakeaways',''),'0')::int,
         coalesce(nullif(p.value->>'skgiveaways',''),'0')::int, coalesce(nullif(p.value->>'skfow',''),'0')::int,
         coalesce(nullif(p.value->>'skfol',''),'0')::int, coalesce(nullif(p.value->>'toiseconds',''),'0')::int,
         coalesce(nullif(p.value->>'skppg',''),'0')::int, coalesce(nullif(p.value->>'skshg',''),'0')::int,
         coalesce(nullif(p.value->>'skgwg',''),'0')::int, coalesce(nullif(p.value->>'skbs',''),'0')::int,
         coalesce(nullif(p.value->>'skinterceptions',''),'0')::int, coalesce(nullif(p.value->>'skpasses',''),'0')::int,
         coalesce(nullif(p.value->>'skpassattempts',''),'0')::int, coalesce(nullif(p.value->>'skshotattempts',''),'0')::int,
         coalesce(nullif(p.value->>'skpossession',''),'0')::int, coalesce(nullif(p.value->>'skpenaltiesdrawn',''),'0')::int,
         coalesce(nullif(p.value->>'skdeflections',''),'0')::int, coalesce(nullif(p.value->>'sksaucerpasses',''),'0')::int,
         coalesce(nullif(p.value->>'ratingOffense',''),'0')::numeric, coalesce(nullif(p.value->>'ratingDefense',''),'0')::numeric,
         coalesce(nullif(p.value->>'ratingTeamplay',''),'0')::numeric,
         case when g.isg then coalesce(nullif(p.value->>'glbrkshots',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glbrksaves',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glpokechecks',''),'0')::int else 0 end,
         g.isg and coalesce(nullif(p.value->>'glga',''),'0')::int = 0 and coalesce(nullif(p.value->>'glshots',''),'0')::int > 0,
         case when g.isg then coalesce(nullif(p.value->>'gldsaves',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glsoperiods',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glpensaves',''),'0')::int else 0 end,
         case when g.isg then coalesce(nullif(p.value->>'glpenshots',''),'0')::int else 0 end
    from public.ea_ingest_log l, jsonb_each(l.payload->'players') c, jsonb_each(c.value) p,
         lateral (select lower(coalesce(p.value->>'position','')) like '%goalie%' as isg) g
   where l.ea_match_id = '2798069310152';
  get diagnostics v_n = row_count;
  if v_n <> 12 then raise exception 'expected 12 lines, wrote %', v_n; end if;
  if exists (select 1 from public.game_stats where game_id = v_game and (profile_id is null or team_id is null)) then raise exception 'a line did not resolve'; end if;
  select coalesce(sum(goals) filter (where team_id = v_uta), 0), coalesce(sum(goals) filter (where team_id = v_bos), 0) into v_hs, v_as from public.game_stats where game_id = v_game;
  if v_hs <> 3 or v_as <> 4 then raise exception 'box score adds to % (UTA) to % (BOS), expected 3 to 4', v_hs, v_as; end if;
  update public.games set status = 'final', home_score = v_hs, away_score = v_as, went_ot = true, ea_match_id = '2798069310152',
         home_ppg = 1, home_ppo = 1, away_ppg = 1, away_ppo = 1 where id = v_game;
  update public.ea_ingest_log set status = 'ingested', game_id = v_game, last_attempt_at = now(),
         reason = 'filed by the league office 2026-10-23: Utah as Good hope lakers, Boston as SBHL Edmonton Oilers (Rule 4.6), Bruins 4 Mammoth 3 in overtime' where ea_match_id = '2798069310152';
  perform public.log_admin_action('ea_match_filed_by_office', 'game', v_game::text,
    jsonb_build_object('ea_match_id', '2798069310152', 'score', v_hs || '-' || v_as, 'went_ot', true,
      'clubs', 'UTA as Good hope lakers (16862), BOS as SBHL Edmonton Oilers (959)', 'by', 'commissioner'));
end $fileB$;

-- Results:
--   9:35 Stars at Mammoth: final, Mammoth 4 Stars 3, 12 lines, 12 linked (9:11 AM).
--   10:10 Bruins at Mammoth: final, Bruins 4 Mammoth 3 in overtime, 12 lines, 12 linked (9:13 AM).
-- Audit: a game_club_substitution and an ea_match_filed_by_office row on each; the stats review raised no finding on either.
-- Each final posts through notify_discord_game_final, as any filed game does.
