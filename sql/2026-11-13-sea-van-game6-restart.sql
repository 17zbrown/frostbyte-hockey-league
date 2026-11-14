-- 2026-11-13, commissioner, on the night's last two Kraken v Canucks playoff games (round 2, games 6 and 7):
-- "Help me sort the 2nd and third games tonight between the Kraken and Canucks. The game that ended at 10:14 PM ET was
-- the 9:35 game 2, and the game that ended at 10:44 PM ET was the 10:10 game 3." Then: "you can wipe that game that only
-- played for 2 minutes." Then: "you file them."
--
-- The night's three fixtures (Fri Nov 13), as found at 11:00 PM ET:
--   9:00 PM  Kraken at Canucks (14d58832)  FINAL, EA 3850521610220, Canucks 2 1. Not touched.
--   9:35 PM  Canucks at Kraken (6903a02b)  HELD on EA 3850898360277: a sitting that stopped after 2 minutes on a
--            disconnect (EA's 3-0 is its disconnect score; no goal was scored). The replay, EA 3854023800141 (ended
--            10:14 PM, Kraken 5 Canucks 2, full 60 minutes, Kraken the home side), sat UNMATCHED: an open same-pair slot
--            (10:10) also fit it, so the importer's probe sent it to the Stats manager, as designed (v4.50).
--   10:10 PM Kraken at Canucks (96e8d6fb)  open. EA 3854340840148 (ended 10:44 PM, Canucks 3 Kraken 1, Canucks the home
--            side) sat UNMATCHED for the same reason.
--
-- The ruling, applied through the importer's own code. Rule 4.3 (Q19): a game stopped inside the first ten minutes of
-- the first period restarts from the beginning, and the stopped sitting is struck with its statistics. The Stats manager
-- could not be used (no signed-in staff session was available to this session), so the replay was STAGED on the 9:35
-- game: its archive row keeps status unmatched and gains that game's id (stagedGame, v4.50). On the next poll
-- ingestContinuation reads it as staged, so the open 10:10 slot does not make it a desk question
-- (`if (cand.id === stagedOn) probe = false`); its tests pass (31 minutes after the stopped sitting, inside the 3 hour
-- resume window; no other opponent in between; 2 minutes stopped, inside EARLY_RESTART_S), and its restart branch
-- strikes 3850898360277 and files 3854023800141 on the 9:35 game. With the 9:35 game final at a full, decided clock,
-- 3854340840148 no longer has an unfinished candidate and files on the 10:10 slot by the window rule.
-- ORDER: game 6 must be final before game 7. Filed the other way round, trg_conclude_series would close the series at
-- 4-2 while game 6 still read held (it deletes only open games with no ea_match_id, so game 6 would survive, but the
-- automatic series news would say 4-2).
-- Series limit (Rule 8.3, box scores only): after both games every player on either club is at four series games or
-- fewer (checked against player_week_games before the change).
update public.ea_ingest_log
   set game_id = '6903a02b-37af-44de-b700-b5d72d4958e7',
       reason = 'staged by the commissioner''s ruling (2026-11-13): this sitting is the Rule 4.3 restart of the 9:35 PM SEA v VAN game, which stopped after 2 minutes; the importer restarts the game from it and strikes the stopped sitting'
 where ea_match_id = '3854023800141' and status = 'unmatched' and game_id is null
returning ea_match_id, status, game_id;
-- Applied 2026-11-13 at about 11:05 PM ET: one row.
-- Result: the 11:06 PM ET poll (the first after the staging) filed both, in order, through the importer:
--   3850898360277 struck ("the game stopped after 2 minutes ... restarted from the beginning (Rule 4.3)").
--   9:35 PM  6903a02b FINAL, Kraken 5 Canucks 2, ea_match_id 3854023800141, 12 lines, all linked.
--   10:10 PM 96e8d6fb FINAL, Canucks 3 Kraken 1, ea_match_id 3854340840148, 12 lines, all linked.
--   trg_conclude_series: "Canucks advance: division final series ends 4–3"; no open games left in the series.
--   The night recap (Game Night Recap: Nov 13) posted with all three games final. No player on either club is over
--   four series games.
