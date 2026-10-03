-- v3.83: two commissioner rulings on the season box-score audit's last questions (2026-10-02).
-- 1. DET v NYI, Oct 1 9:00 PM (game 6a71983a): "7-1 + fix importer". Filed 6-1 from the players' goals; EA's official
--    result (club score 7, goals 7, scoreString '7 - 1'), and the Islanders' goaltender's 7 goals against, say 7-1. A
--    clean sitting (3600 s, no DNF flag): the seventh goal is one no player in the payload holds (own goal, or a player
--    who left). The score is corrected; no player line changes. The importer now files a clean sitting on EA's score
--    (netlify/functions/ingest-stats.js normalizeMatch, noteUnattributed; tools/official-score-v383.test.cjs).
--    notify_discord_game_final posts its Corrected line for the score change, as designed.
-- 2. SEA v NYI, Sep 25 9:35 PM (game 8a4a7577): "Regulation win". 2400 s (SEA 5-4) plus a 1512 s reload (SEA 4-1); never
--    level at sixty minutes, so it cannot be a sudden-death overtime result. It stands as filed, 9-5 in regulation, and
--    the review closes the overlong_game_flagged item raised by the v3.53 backfill.

do $r$
declare v_n int;
begin
  update public.games set home_score = 7
   where id = '6a71983a-2f6a-462a-9def-311f09d6baf5' and status = 'final' and home_score = 6 and away_score = 1;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'DET v NYI is not as audited'; end if;
  perform public.log_admin_action('result_corrected', 'game', '6a71983a-2f6a-462a-9def-311f09d6baf5',
    jsonb_build_object('from', '6-1', 'to', '7-1', 'why',
      'EA official result 7-1 (match 1776840490314) and the Islanders goaltender''s 7 goals against; one goal no player holds',
      'ruling', 'commissioner 2026-10-02'));
  perform public.log_admin_action('overlong_game_reviewed', 'game', '8a4a7577-2e4e-4247-8e1a-7c7f9a5ba8b9',
    jsonb_build_object('ruling', 'regulation win as filed, 9-5', 'by', 'commissioner 2026-10-02',
      'why', 'never level at sixty minutes (5-4 after 40:00, 4-1 in the reload), so not a sudden-death overtime result'));
end $r$;

/* APPLIED 2026-10-02 as migration v383_rulings_det_nyi_7_1_sea_nyi_regulation (each update refuses to run on a row that
   is not as audited). The importer change shipped in the same commit. */
