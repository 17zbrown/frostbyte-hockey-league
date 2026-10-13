-- v3.93 (2026-10-12): automatic placement of a late sign-up closes at the movement deadline on every path.
--
-- Rule 2.4: the movement deadline "is also the moment automatic placement closes". The late-comer sweep
-- (auto_assign_latecomers) already stops at moves_locked(), but the sign-up trigger (trg_autoassign_new_reg) placed a
-- late registrant the moment he signed up, with no deadline check. Registration for the season closes when the
-- season-status cron opens the next one (every 10 minutes), so a sign-up in the minutes between the deadline and
-- that flip was still placed. Found answering the commissioner's question, 2026-10-12: "Do new joins still get
-- randomly assigned after the trade deadline?"
do $p$
declare v_def text := pg_get_functiondef('public.trg_autoassign_new_reg()'::regprocedure);
        a text := '     and not public.is_suspended(new.profile_id) and not public.is_banned(new.profile_id)
  then';
        b text := '     and not public.is_suspended(new.profile_id) and not public.is_banned(new.profile_id)
     and not public.moves_locked(v_season.id)   -- v3.93: placement closes at the movement deadline (Rule 2.4)
  then';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.93: trg_autoassign_new_reg anchor'; end if;
  execute replace(v_def, a, b);
end $p$;
