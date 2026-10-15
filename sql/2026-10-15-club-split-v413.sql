-- v4.13 (2026-10-15): a traded player's statistics, split by club.
--
-- Commissioner, 2026-10-15: "Split traded players' stats by club" and "But still show all the full season stats on their
-- main page but in their history tab it should show per team they have played with." The split itself is the site's
-- (CG.aggregate keeps a line per club for every player, src/live/part2_engine.js): every game_stats row already carries
-- the club it was filed for (team_id), so nothing in the record changes.
--
-- This record: the club a filed statistical title is credited to (awards.team_id). statistical_titles took it from the
-- winner's CURRENT roster spot, so a title went to a club the winner may never have played for (a player traded after
-- his last game) and to no club at all for a winner no longer rostered. It now takes the club of the winner's latest
-- regular-season line that season, the rule compute_potw already uses for Players of the Week (Rule 6.1: every line is
-- credited to the club the player played that game for).
-- Applied as migration v410_title_club_from_lines (built as v4.10; three parallel releases shipped first, so it ships
-- as v4.13). Rehearsed: today's four leaders and their clubs are unchanged (Scorezov VAN x3, the16thgunner DET).
create or replace function public.statistical_titles(p_season uuid)
 returns table(category text, profile_id uuid, team_id uuid, gp integer, total integer, per_game numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  /* v4.08: place 1 of public.statistical_title_board, the one definition of Rule 9.2 (file_statistical_titles files these).
     v4.13: credited to the club of the winner's latest regular-season line that season, not his current roster spot */
  select b.category, b.profile_id,
         (select gs.team_id from public.game_stats gs join public.games g on g.id = gs.game_id
           where gs.profile_id = b.profile_id and g.season_id = p_season and coalesce(g.stage,'regular') = 'regular'
             and g.status = 'final' and not coalesce(g.voided,false)
           order by g.scheduled_at desc, gs.id desc limit 1),
         b.gp, b.total, b.per_game
    from public.statistical_title_board(p_season, 1) b
$function$;
