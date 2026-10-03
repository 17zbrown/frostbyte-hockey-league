-- Commissioner rulings, 2026-10-02, on two questions the season box-score audit (v3.82) left open.
--
-- 1. "Correct": the Dallas player in the box scores as vDarkiee___ (EA persona 1004486290545) is Rob
--    (39f0c077, EA ID imdarkkkk), on Dallas's training camp as a goaltender since 2026-09-20. His three lines are his:
--    Sep 23 9:00 PM PIT v DAL in goal, and Oct 1 9:00 PM UTA v DAL and 9:35 PM DAL v DET on defense (a camp player fills
--    any position, Rule 2.1). His profile records vDarkiee___ as his platform gamertag and the persona, so the importer
--    matches him on the persona from now on (step 1 of resolveProfile). Linking him raised no new finding for him
--    (rehearsed: review_game_records over the three games).
-- 2. "Count the games as if he was rostered. He was intended to be on that team at the time.": Rhegain played the whole
--    Oct 1 9:00 PM UTA v DAL game for Utah while a free agent, and was signed into Utah's camp 79 seconds before it
--    ended. The game counts for him as a rostered Utah player: his line and credit stand (they already did), and the
--    ruling is recorded as an 'unrostered_cleared' row keyed on his gamertag, so review_game_records never raises it.
--    Counted, it is his 4th game of week 2 as a camp player (limit 3, Rule 5.2): the reviewer's weekly_cap_violation
--    on Utah's Oct 2 9:35 PM game stands for the league office to rule on; this ruling does not decide it.
-- The reviewer is NOT re-run here: it reads rosters as they stand now and would raise a fresh unrostered_player for
-- PghReaper (traded after the game, on the club at the time) and a repeat of Roadamerica04's existing weekly-cap flag.

do $r$
declare v_rob uuid := '39f0c077-b34b-4ce5-a805-4929caad437b'; v_n int;
begin
  update public.profiles set platform_gamertag = 'vDarkiee___', ea_player_id = '1004486290545'
   where id = v_rob and platform_gamertag is null and ea_player_id is null;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'Rob''s profile is not as audited'; end if;
  update public.game_stats set profile_id = v_rob where ea_player_id = '1004486290545' and profile_id is null;
  get diagnostics v_n = row_count; if v_n <> 3 then raise exception 'expected the 3 vDarkiee___ lines, got %', v_n; end if;
  perform public.log_admin_action('identity_ruled', 'profile', v_rob::text,
    jsonb_build_object('ea_name', 'vDarkiee___', 'ea_player_id', '1004486290545', 'lines', 3,
      'ruling', 'commissioner 2026-10-02: vDarkiee___ is Rob'));
  perform public.log_admin_action('unrostered_cleared', 'game', 'd2891f3a-3885-4b41-8e53-1d9db4ad407d',
    jsonb_build_object('player', 'Rhegain', 'club', 'UTA',
      'cleared_because', 'commissioner 2026-10-02: count the game as if he was rostered; he was intended to be on Utah at the time (signed 79 s before the end)'));
end $r$;
