-- Data fix (2026-10-21): two goals removed from Boston 11, Pittsburgh 7 (game 81a06b51-9718-40eb-a84c-f6f5e624e947, Wed Oct 21,
-- 10:10 PM ET), by the commissioner's ruling.
-- Commissioner, 2026-10-21: "In the Penguins v Bruins game, in the 2nd session, remove the Boston goal from Chunkydunks,
-- assisted by Monahan, and Kloudzy. Remove the Penguins goal from Makweer." Then: "Monahan is Prod." The game was played
-- in two sittings after a disconnect (Rule 4.3: EA match 2758423210301, 1516 s, then 2756644990068, 2400 s), merged by
-- the importer. Names: Chunkydunks = LSF_Chunkydunks, Kloudzy = ItzKloudzy, Monahan = Prod (EA name Fantilli 19, the line
-- is linked to Prod's profile), Makweer = CerealTiger3269 (the commissioner's PIT v UTA ruling the same night). The
-- commissioner answered the rest (2026-10-21): Makweer's goal was unassisted; Chunkydunks' removed goal was even strength
-- (he scored 3 in the second sitting, one shorthanded, none on the power play), so his shorthanded count stays 1; the
-- final becomes 10-6 ("Save, score 10-6"). Boston still wins in regulation.
-- Each goal is voided outright: the goal, its shot, its assists, and the goalie's goal against and shot against (saves
-- unchanged). Makweer's goal was scored on BeLchy01, Boston's goalie in the second sitting. Plus/minus is unchanged: one
-- even-strength goal comes off each club. The raw EA payloads in ea_ingest_log are not touched. The score change posts the
-- league's standard "Corrected ... (was 11-7)" line to #game-scores (notify_discord_game_final, v3.18).
-- Same method as sql/2026-10-21-pit-uta-goals-removed.sql: the stats office's own doors as the commissioner, every line
-- checked against the reviewed values first (any difference raises and nothing is written), an admin_audit row.

do $fix$
declare
  v_game uuid := '81a06b51-9718-40eb-a84c-f6f5e624e947';
  v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_row jsonb; v_bad text := '';
  v_lines jsonb := '[
    {"id":"e8a8f2be-998a-4222-9837-7214deb2d69d","who":"LSF_Chunkydunks","before":{"goals":6,"assists":3,"shots":8,"sh_goals":1},"after":{"goals":5,"shots":7}},
    {"id":"82a22414-b6e7-4dba-b608-793b06e0ca0a","who":"Fantilli 19 (Prod)","before":{"goals":4,"assists":6},"after":{"assists":5}},
    {"id":"7213c470-2df3-430c-bc8f-c175b8ee2382","who":"ItzKloudzy","before":{"goals":1,"assists":8},"after":{"assists":7}},
    {"id":"8a20f292-b514-4f9d-a91d-0d8f6ddacf3d","who":"CerealTiger3269","before":{"goals":1,"assists":1,"shots":2},"after":{"goals":0,"shots":1}},
    {"id":"d9a088e0-c0b4-4e8b-a77d-50cb3b30d23e","who":"BeLchy01 (BOS goalie, second sitting)","before":{"goals_against":5,"shots_against":11,"saves":6},"after":{"goals_against":4,"shots_against":10}},
    {"id":"e5963049-56a8-4911-b5b0-c107291373ee","who":"xBarDownx87 (PIT goalie)","before":{"goals_against":11,"shots_against":28,"saves":17},"after":{"goals_against":10,"shots_against":27}}
  ]';
  l jsonb; k text;
begin
  -- 1) everything is still exactly what the commissioner reviewed
  if not exists (select 1 from public.games where id = v_game and status = 'final' and home_score = 11 and away_score = 7
                 and not coalesce(went_ot, false) and forfeit_team_id is null and not coalesce(voided, false)) then
    raise exception 'data fix refused: the game is no longer final 11-7 in regulation';
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
  perform public.stats_game_set_result(v_game, 10, 6, true, null);

  -- 3) the record
  insert into public.admin_audit (actor, action, target_type, target_id, detail)
  values (v_commish, 'box_score_goals_removed', 'game', v_game::text, jsonb_build_object(
    'ruling', 'Commissioner, 2026-10-21: in the second sitting, remove the Boston goal by Chunkydunks (assists Monahan = Prod, Kloudzy) and the Penguins goal by Makweer',
    'record', 'sql/2026-10-21-bos-pit-goals-removed.sql',
    'score', jsonb_build_object('before', '11-7', 'after', '10-6'),
    'goals', jsonb_build_array(
      jsonb_build_object('team', 'BOS', 'scorer', 'LSF_Chunkydunks', 'assists', jsonb_build_array('Fantilli 19 (Prod)', 'ItzKloudzy'), 'strength', 'even'),
      jsonb_build_object('team', 'PIT', 'scorer', 'CerealTiger3269', 'assists', jsonb_build_array(), 'strength', 'even')),
    'lines', v_lines));

  -- 4) self-check: the box score now adds up to the score
  if (select sum(goals) from public.game_stats where game_id = v_game and team_id = (select home_team_id from public.games where id = v_game)) <> 10
     or (select sum(goals) from public.game_stats where game_id = v_game and team_id = (select away_team_id from public.games where id = v_game)) <> 6
     or (select home_score::text || '-' || away_score::text from public.games where id = v_game) <> '10-6' then
    raise exception 'data fix check: the box score does not add up to 10-6';
  end if;
end $fix$;

/* REHEARSAL (2026-10-21, about 11:15 PM ET, one transaction on the live database, rolled back by a closing raise): the
   block above ran in full; the probe read score 10-6; LSF_Chunkydunks 5 G 3 A 7 shots (shorthanded 1), Fantilli 19 4 G
   5 A, ItzKloudzy 1 G 7 A, CerealTiger3269 0 G 1 A 1 shot, BeLchy01 4 GA on 10 (6 saves), xBarDownx87 10 GA on 27 (17
   saves), every skater's plus/minus unchanged; one admin_audit row; one queued post (the "Corrected" line), rolled back.
   APPLIED right after with execute_sql: the game reads 10-6, the six lines match the rehearsal, one admin_audit row
   (action box_score_goals_removed), and the "Corrected ... (was 11-7)" line went to #game-scores (204). */
