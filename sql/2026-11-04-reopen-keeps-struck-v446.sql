-- v4.46 (2026-11-04): re-opening a final no longer un-strikes a struck sitting.
-- Standing order (CLAUDE.md, commissioner): "A struck early-restart sitting stays struck." The commissioner's go-ahead to fix this,
-- after the v4.45 review found it: "Do this task here: Stop re-opening a final from un-striking sittings".
--
-- Why. reopen_game_final cleared every archive row of the game with no status filter, so a struck sitting became an ordinary
-- 'skipped' one, lost the reason that said why, and lost its game_id. Every guard reads the status (ingest-stats.js: the poll's skip
-- at "stays struck", the candidate list, the Stats manager's refusal), so all of them then passed: EA re-serving the match, or a
-- staffer or a club's front office ticking it, could file those statistics again. Five sittings on four games are struck today.
--
-- The fix: the clearing update leaves struck rows alone, status, reason and game_id, by anchored text replacement on the live
-- definition (v4.45 patched this function last). Nothing assumes a re-opened game holds no archive rows: the no-show branch of
-- forfeit_game reads only ingested, merged and incomplete rows, and a merge's priors skip struck ones.

do $patch$
declare v_def text; v_a text; v_n int;
begin
  v_def := pg_get_functiondef('public.reopen_game_final(uuid)'::regprocedure);
  v_a := 'game_id=null' || chr(10) || '    where game_id = p_game;';
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'reopen_game_final anchor matched % times', v_n; end if;
  execute replace(v_def, v_a, 'game_id=null' || chr(10) ||
    '    where game_id = p_game and status <> ''struck'';   /* v4.46: "A struck early-restart sitting stays struck." */');
end $patch$;

do $chk$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.reopen_game_final(uuid)'::regprocedure;
  if position('where game_id = p_game and status <> ''struck''' in v_src) = 0 then raise exception 'reopen_game_final still clears struck rows'; end if;
  if position('home_shots=null, away_shots=null' in v_src) = 0 then raise exception 'the v4.45 patch was lost'; end if;
  if has_function_privilege('anon', 'public.reopen_game_final(uuid)', 'EXECUTE') then raise exception 'anon can run reopen_game_final'; end if;
  if not has_function_privilege('authenticated', 'public.reopen_game_final(uuid)', 'EXECUTE') then raise exception 'the site lost reopen_game_final'; end if;
end $chk$;

-- REHEARSAL (2026-11-04, one transaction on the live database, rolled back by a closing raise; proved rolled back after):
--   T1 a non-commissioner is still refused. T2 a commissioner re-opens d6359d09, a game with two struck sittings: all five struck rows
--   in the archive keep their status, reason and game_id, and two stay on the game. T3 its one counted sitting goes to skipped with its
--   game_id cleared, as before. T4 the game is scheduled with no box score and no shots. T5 the no-show door sees no played sitting.
--   Result: REHEARSAL OK: T1 | T2 | T3 cleared=1 | T4 | T5 | queued=1 (the re-open's own notice, never sent, pg_net is transactional).
-- Applied as migration v446_reopen_keeps_struck; tools/sql/grant-audit.sql returned zero rows.
