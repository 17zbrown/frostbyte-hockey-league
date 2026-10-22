-- Data fix (2026-10-21): two goals removed from Pittsburgh 7, Utah 3 (game 7dbccaf8-63fb-4189-8d33-02a3b00d5d26, Wed Oct 21,
-- 9:00 PM ET), by the commissioner's ruling.
-- Commissioner, 2026-10-21: "In tonights Penguins v Mammoth game, can you remove the goal scored by Kantaja along with the
-- assists on that goal, and can you also remove the goal by Makweer and the assist that came with that." Then: "It was the
-- first goal from each team in the 2nd game session." The game was played in two sittings after a disconnect (Rule 4.3:
-- EA match 2748776260404, 882 s, then 2746855800194, 3600 s), merged by the importer. EA records only per-player totals,
-- so the commissioner named the players (2026-10-21): Pittsburgh's first goal of the second sitting was CerealTiger3269's,
-- assisted by All Of Toxic; Utah's was Natsubi87's, assisted by YoungBlood9340 and Deadeye8014. Kantaja and Makweer are
-- in-game names EA does not send.
-- Each goal is voided outright: the goal, its shot, its assists, and the goalie's goal against and shot against (saves
-- unchanged). Plus/minus is unchanged: each club loses one even-strength goal (neither was a power-play goal), so every
-- skater stays +2 or -2. The final becomes 6-2 (commissioner's choice, "Save, score 6-2"); Pittsburgh still wins in
-- regulation. The raw EA payloads in ea_ingest_log are not touched. The score change posts the league's standard
-- "Corrected ... (was 7-3)" line to #game-scores (notify_discord_game_final, v3.18).
-- Written through the stats office's own doors (stats_game_row, stats_game_set_result) as the commissioner, with an
-- admin_audit row. Every line is checked against the values the commissioner reviewed first; any difference raises and
-- nothing is written.

do $fix$
declare
  v_game uuid := '7dbccaf8-63fb-4189-8d33-02a3b00d5d26';
  v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_row jsonb; v_bad text := '';
  -- id, expected (goals, assists, shots, goals_against, shots_against, saves), new values
  v_lines jsonb := '[
    {"id":"2436e0da-9c3c-4e77-af4d-3a6be171caef","who":"CerealTiger3269","before":{"goals":1,"assists":0,"shots":1},"after":{"goals":0,"shots":0}},
    {"id":"e49fdff7-5800-4a76-85ec-32be8f984c95","who":"All Of Toxic","before":{"goals":2,"assists":3},"after":{"assists":2}},
    {"id":"18520b5b-f6a0-45fa-bb5c-4c716085e386","who":"Natsubi87","before":{"goals":1,"assists":2,"shots":6},"after":{"goals":0,"shots":5}},
    {"id":"6a9ae7d9-e6c4-438e-80f6-5dbc7fbd4758","who":"YoungBlood9340","before":{"goals":1,"assists":2},"after":{"assists":1}},
    {"id":"78cd172a-d797-4e90-b0fa-3705883d1494","who":"Deadeye8014","before":{"goals":0,"assists":1},"after":{"assists":0}},
    {"id":"6fdd08ac-dd47-4257-b3eb-58fac03cff1d","who":"xBarDownx87 (PIT goalie)","before":{"goals_against":3,"shots_against":20,"saves":17},"after":{"goals_against":2,"shots_against":19}},
    {"id":"3a8e0097-574a-4c43-9b75-ad9bffcaf759","who":"SuprTroopr99 (UTA goalie)","before":{"goals_against":7,"shots_against":23,"saves":16},"after":{"goals_against":6,"shots_against":22}}
  ]';
  l jsonb; k text;
begin
  -- 1) everything is still exactly what the commissioner reviewed
  if not exists (select 1 from public.games where id = v_game and status = 'final' and home_score = 7 and away_score = 3
                 and not coalesce(went_ot, false) and forfeit_team_id is null and not coalesce(voided, false)) then
    raise exception 'data fix refused: the game is no longer final 7-3 in regulation';
  end if;
  for l in select * from jsonb_array_elements(v_lines) loop
    select to_jsonb(gs) into v_row from public.game_stats gs where gs.id = (l->>'id')::uuid and gs.game_id = v_game;
    if v_row is null then raise exception 'data fix refused: line % (%) is gone', l->>'who', l->>'id'; end if;
    for k in select jsonb_object_keys(l->'before') loop
      if (v_row->>k) is distinct from (l->'before'->>k) then
        v_bad := v_bad || format('%s %s is %s, expected %s; ', l->>'who', k, v_row->>k, l->'before'->>k);
      end if;
    end loop;
  end loop;
  if v_bad <> '' then raise exception 'data fix refused: %', v_bad; end if;

  -- 2) the change, through the stats office's doors, as the commissioner
  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);
  for l in select * from jsonb_array_elements(v_lines) loop
    perform public.stats_game_row((l->>'id')::uuid, v_game, l->'after');
  end loop;
  perform public.stats_game_set_result(v_game, 6, 2, true, null);

  -- 3) the record
  insert into public.admin_audit (actor, action, target_type, target_id, detail)
  values (v_commish, 'box_score_goals_removed', 'game', v_game::text, jsonb_build_object(
    'ruling', 'Commissioner, 2026-10-21: remove the first goal from each team in the second sitting, with their assists',
    'record', 'sql/2026-10-21-pit-uta-goals-removed.sql',
    'score', jsonb_build_object('before', '7-3', 'after', '6-2'),
    'goals', jsonb_build_array(
      jsonb_build_object('team', 'PIT', 'scorer', 'CerealTiger3269', 'assists', jsonb_build_array('All Of Toxic')),
      jsonb_build_object('team', 'UTA', 'scorer', 'Natsubi87', 'assists', jsonb_build_array('YoungBlood9340', 'Deadeye8014'))),
    'lines', v_lines));

  -- 4) self-check: the box score now adds up to the score
  if (select sum(goals) from public.game_stats where game_id = v_game and team_id = (select home_team_id from public.games where id = v_game)) <> 6
     or (select sum(goals) from public.game_stats where game_id = v_game and team_id = (select away_team_id from public.games where id = v_game)) <> 2
     or (select home_score::text || '-' || away_score::text from public.games where id = v_game) <> '6-2' then
    raise exception 'data fix check: the box score does not add up to 6-2';
  end if;
end $fix$;

/* REHEARSAL (2026-10-21, 9:52 PM ET, one transaction on the live database, rolled back by a closing raise): the block
   above ran in full; the probe read score 6-2; CerealTiger3269 0 G 0 A 0 shots, All Of Toxic 2 G 2 A, Natsubi87 0 G 2 A
   5 shots, YoungBlood9340 1 G 1 A, Deadeye8014 0 A, xBarDownx87 2 GA on 19 (17 saves), SuprTroopr99 6 GA on 22 (16 saves),
   every skater's plus/minus unchanged (+2 PIT, -2 UTA); one admin_audit row; one queued post (the "Corrected" line),
   which rolled back with it. Afterward the game still read 7-3 with no audit row, so nothing stuck.
   APPLIED (2026-10-21, about 9:55 PM ET) with execute_sql: the game reads 6-2, the seven lines match the rehearsal, one
   admin_audit row (action box_score_goals_removed), and the "Corrected ... (was 7-3)" line went to #game-scores (204). */
