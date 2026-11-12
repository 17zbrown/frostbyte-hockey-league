-- v4.50 (2026-11-12): a forfeit that keeps the played result on a game that is already FINAL posts its own line in
-- #game-scores.
--
-- Why. v4.50 lets statistics staff publish a decided game from the Stats manager at any game clock (Rule 4.3.3).
-- Commissioner, 2026-11-12: "If I manually file a game from multiple sittings on the stats manager desk, it should file
-- even if the time does not add up to 60 minutes excactly." A game ended by a third disconnection (Rule 4.3.7) is merged
-- first and ruled after. Before v4.50 a short merge was HELD, and forfeit_game's held branch made it final with the
-- forfeit in one write, so notify_discord_game_final posted "Final (forfeit)". Now the merge publishes a plain Final, and
-- the ruling lands on a final. That branch only set forfeit_team_id: the score does not change, so the trigger posts
-- nothing, and #game-scores never said the game was forfeited (the Stats manager called this "backend gap G1").
-- Commissioner, 2026-09-25 (v3.34): forfeits are announced in #game-scores.
--
-- What changes. The kept-result branch on a final posts one Forfeit line through public.notify_discord (the door, the
-- channel and the wording forfeit_abandoned_game uses for a final), only when the forfeit actually changes (a
-- commissioner re-ruling the same club posts nothing), with no pings. A failed post raises a warning and never undoes
-- the ruling, exactly as notify_discord_game_final and forfeit_abandoned_game do. The held branch and the no-show branch
-- are untouched. CREATE OR REPLACE keeps the grants (authenticated may execute; anon may not).

-- Part a: patch the kept-result-on-a-final branch by its exact text, asserted to match once.
do $patch$
declare v_def text; v_a text; v_b text; v_n int;
begin
  v_def := pg_get_functiondef('public.forfeit_game(uuid,uuid,text,boolean)'::regprocedure);
  v_a := $a$    update public.games set forfeit_team_id = p_forfeiting_team where id = p_game;
    perform public.log_admin_action('kept_result_forfeit', 'game', p_game::text,$a$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'v4.50: the forfeit_game anchor matched % times, expected exactly 1', v_n; end if;
  v_b := $b$    update public.games set forfeit_team_id = p_forfeiting_team where id = p_game;
    /* v4.50: the score does not change here, so notify_discord_game_final posts nothing; say the forfeit ourselves,
       once, when it changes (Rule 4.3.7 rulings land on a final since a decided hand filing publishes at any clock) */
    if v_g.forfeit_team_id is distinct from p_forfeiting_team then
      begin
        perform public.notify_discord('discord_scores_webhook',
          format('🏒 **Forfeit (Rule 4.3)**: %s %s-%s %s stands, and %s takes the forfeit loss (FFL). Every statistic earned in it counts.',
            public.team_mention(v_g.home_team_id), v_g.home_score, v_g.away_score,
            public.team_mention(v_g.away_team_id), public.team_mention(p_forfeiting_team)), false);
      exception when others then
        raise warning 'forfeit_game scores post failed for game %: %', p_game, sqlerrm;
      end;
    end if;
    perform public.log_admin_action('kept_result_forfeit', 'game', p_game::text,$b$;
  execute replace(v_def, v_a, v_b);
end $patch$;

-- Part b: self-checks. Raise when the result is not what was meant.
do $chk$
declare v text := pg_get_functiondef('public.forfeit_game(uuid,uuid,text,boolean)'::regprocedure);
begin
  if position('🏒 **Forfeit (Rule 4.3)**: %s %s-%s %s stands, and %s takes the forfeit loss (FFL). Every statistic earned in it counts.' in v) = 0
    then raise exception 'v4.50: the Forfeit line is missing from forfeit_game'; end if;
  if position('if v_g.forfeit_team_id is distinct from p_forfeiting_team then' in v) = 0
    then raise exception 'v4.50: the post is not limited to a forfeit that changes'; end if;
  if (length(v) - length(replace(v, 'notify_discord(', ''))) / length('notify_discord(') <> 1
    then raise exception 'v4.50: forfeit_game should post from exactly one place'; end if;
  if position('raise warning ''forfeit_game scores post failed for game %: %'', p_game, sqlerrm;' in v) = 0
    then raise exception 'v4.50: a failed post must warn, never undo the ruling'; end if;
  /* the other branches as they were */
  if position('''was_held'', true, ''by'', ''statistics''' in v) = 0 then raise exception 'v4.50: the held branch changed'; end if;
  if position('home_shots = null, away_shots = null,   /* v4.45: a no-show has no ice time, so no shots */' in v) = 0
    then raise exception 'v4.50: the no-show branch changed'; end if;
  if has_function_privilege('anon', 'public.forfeit_game(uuid,uuid,text,boolean)', 'execute') then raise exception 'v4.50: anon can run forfeit_game'; end if;
  if not has_function_privilege('authenticated', 'public.forfeit_game(uuid,uuid,text,boolean)', 'execute') then raise exception 'v4.50: the site lost forfeit_game'; end if;
end $chk$;

-- Rehearsal, 2026-11-12: one transaction on the live database, rolled back by a closing raise (pg_net is transactional,
-- so nothing reached Discord). Parts a and b ran as above, then a probe acting as a commissioner (request.jwt.claims)
-- ruled a kept-result forfeit on the newest unruled final with a box score, counting net.http_request_queue rows queued
-- to the discord_scores_webhook:
--   T1  the ruling queued exactly one #game-scores post;
--   T2  its body is the Forfeit (Rule 4.3) line with the game's score (4-2), "takes the forfeit loss (FFL)", and
--       allowed_mentions parse [] (no pings);
--   T3  the row stayed final with its score, the forfeit set;
--   T4  ruling the same club again (a commissioner) queued nothing more;
--   T5  ruling the other club (a commissioner's change) queued one more.
-- Result: REHEARSAL OK: T1 one scores post | T2 Forfeit line, score 4-2, FFL, no pings | T3 row final, score kept,
-- forfeit set | T4 same club silent | T5 other club posts again
-- Afterwards: forfeit_game still read as before (no v4.50 text), the 183 unruled finals were still unruled, and no
-- kept_result_forfeit audit row had been written.
-- Applied as migration v450_forfeit_kept_result_post; tools/sql/grant-audit.sql returned zero rows.
