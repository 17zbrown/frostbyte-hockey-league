-- 2026-10-10, commissioner: "you entered the Utah Dallas game as a no-show forfeit. Fix it to show the regular score and give
-- everyone their stats from that game."
-- Oct 9, 10:10 PM, Stars at Mammoth. Dallas played as LG Sherbrooke Phoenix (EA club 8910, Rule 4.6 substitution). EA match
-- 2170940290483 ran 1,801 seconds (30 minutes): Utah's goaltender Hellesic and JAKE_2G2D left (player_dnf), EA ended the game
-- with winnerByDnf/winnerByGoalieDnf to Sherbrooke, Dallas leading 8-1. The commissioner ruled a forfeit win for the Stars,
-- and I first filed it as a no-show forfeit (Rule 3.2: 1-0, no stats). Corrected to the abandoned/three-disconnections kind
-- (Rule 4.3): the played result and every stat line stand, Utah is still the forfeiting club.
-- The box score is built from the archived payload with the importer's own mapping (normalizeMatch + leagueBoxRows) and
-- resolveProfile's order: 11 lines by EA persona, BlakeCx4 by EA ID; all 12 rostered on the club they played for. The re-ingest
-- path needs a commissioner's session, and a forfeit-ruled game is not an import target, so it is filed here directly.
-- The game stays final; the score change posts the "Corrected" line in #game-scores (notify_discord_game_final).
do $fix$
declare v_game uuid := '4dfe5284-ae1f-42a2-a3a6-e9505663631a'; v_dal uuid; v_uta uuid; v_n int; v_hs int; v_as int;
begin
  select id into v_dal from public.teams where code = 'DAL';
  select id into v_uta from public.teams where code = 'UTA';
  if not exists (select 1 from public.games where id = v_game and status = 'final' and forfeit_team_id = v_uta and away_team_id = v_dal and home_team_id = v_uta) then
    raise exception 'the game is not the 1-0 Utah forfeit expected';
  end if;
  if exists (select 1 from public.game_stats where game_id = v_game) then raise exception 'the game already has a box score'; end if;

  insert into public.game_stats (game_id, team_id, profile_id, skater_name, position, goals, assists, shots, hits, pim, is_goalie,
      saves, shots_against, goals_against, ea_player_id, plus_minus, takeaways, giveaways, faceoffs_won, faceoffs_lost,
      time_on_ice_seconds, pp_goals, sh_goals, gwg, blocked_shots, interceptions, passes_completed, passes_attempted,
      shot_attempts, possession_seconds, penalties_drawn, deflections, saucer_passes, offense_rating, defense_rating,
      team_play_rating, breakaway_shots, breakaway_saves, poke_checks, shutout, diving_saves, shutout_periods,
      pen_shot_saves, pen_shots_against)
  select v_game, case c.key when '8910' then v_dal when '17957' then v_uta end,
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
   where l.ea_match_id = '2170940290483';
  get diagnostics v_n = row_count;
  if v_n <> 12 then raise exception 'expected 12 lines, wrote %', v_n; end if;
  if exists (select 1 from public.game_stats where game_id = v_game and profile_id is null) then raise exception 'a line did not resolve to a profile'; end if;

  select coalesce(sum(goals) filter (where team_id = v_uta), 0), coalesce(sum(goals) filter (where team_id = v_dal), 0)
    into v_hs, v_as from public.game_stats where game_id = v_game;
  if v_hs <> 1 or v_as <> 8 then raise exception 'box score adds to % (UTA) - % (DAL), expected 1-8', v_hs, v_as; end if;

  update public.games set home_score = v_hs, away_score = v_as, went_ot = false, ea_match_id = '2170940290483',
         home_ppg = 0, home_ppo = 0, away_ppg = 0, away_ppo = 1
   where id = v_game;
  update public.ea_ingest_log set status = 'ingested', game_id = v_game,
         reason = 'filed by the league office 2026-10-10: Utah forfeit with the played result kept (Rule 4.3), Stars 8 Mammoth 1 after 30 minutes; Dallas as LG Sherbrooke Phoenix (Rule 4.6)'
   where ea_match_id = '2170940290483';
  perform public.log_admin_action('abandoned_forfeit', 'game', v_game::text,
    jsonb_build_object('forfeited_by', 'UTA', 'score', v_hs || '-' || v_as, 'was_held', false, 'by', 'commissioner',
      'reason', 'Commissioner ruling 2026-10-10: forfeit win for the Stars with the regular score and every stat line kept; corrects the no-show forfeit entered earlier'));
end $fix$;
