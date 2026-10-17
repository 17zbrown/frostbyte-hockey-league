-- v4.16b: two loose ends of the Season 1 deadline extension (v4.16), found in review before the release shipped.
--
-- 1. The third placement path. v4.16 moved auto_assign_latecomers and distribute_unproven_rookies onto
--    public.placement_closed(), but trg_autoassign_new_reg (the trigger that places a late sign-up the moment it is
--    made) still read moves_locked(). With the deadline extended, a Season 1 sign-up made before 11:59 PM Sunday would
--    have been placed on a club, against the ruling (commissioner, 2026-10-17: "lock the late signups for season 1").
--    It now reads the same gate as the two jobs.
--
-- 2. Replacement signings granted before the deadline now in force. Past the deadline a club may sign only to
--    replace a player whose sign-up was removed after it (Rule 2.4; _grant_replacement writes the allowance,
--    sign_free_agent spends it). Dallas was granted one at 8:34 AM ET on Oct 17 (Simon Makienok left the league
--    Discord), after the original deadline. The extension put that removal BEFORE the deadline, and Dallas may sign
--    freely until then, so the allowance must lapse at the new deadline instead of granting an extra signing after it.
--    Durable rule, so any later extension behaves the same: an allowance counts only if it was granted at or after
--    the deadline in force. When the office has locked moves early (moves_lock_override = 'locked'), allowances
--    granted during that lock still count. The site's count (part_live.js, CG.lg._replacements) applies the same
--    test. No allowance row is changed or deleted.
-- Nothing here posts to Discord.
--
-- REHEARSAL on production, 2026-10-17: both patches plus three probes in ONE do-block ending in an uncaught raise
-- (verified rolled back: neither function changed, Season 1 deadline still 2026-10-19 03:59 UTC override auto, Dallas's
-- allowance still open). Signed in as the Dallas Owner (not a commissioner), with a made-up registration id:
--   current season = S1, moves_locked=f, placement_closed=t
--   A, deadline moved to a minute ago (the Monday case, grant before it): "Roster moves are locked" (allowance lapsed)
--   B, deadline before the 8:34 AM grant: allowance spent, then "That player is not registered for this season."
--   C, office lock (override 'locked') before the deadline: allowance counts, same refusal as B
-- Applied as migration v416b_placement_trigger_and_replacements.

do $p$
declare v_def text; v_a text; v_b text; v_n int;
begin
  v_def := pg_get_functiondef('public.trg_autoassign_new_reg()'::regprocedure);
  v_a := $q$     and not public.moves_locked(v_season.id)   -- v3.93: placement closes at the movement deadline (Rule 2.4)$q$;
  v_b := $q$     and not public.placement_closed(v_season.id)   -- v4.16b: the placement gate, as in the two placement jobs (Rule 2.4)$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'trg_autoassign_new_reg: anchor found % times', v_n; end if;
  execute replace(v_def, v_a, v_b);

  v_def := pg_get_functiondef('public.sign_free_agent(uuid,bigint,uuid)'::regprocedure);
  v_a := $q$                      where x.season_id = v_season.id and x.team_id = v_team.id and x.used_at is null
                      order by x.created_at limit 1);$q$;
  v_b := $q$                      where x.season_id = v_season.id and x.team_id = v_team.id and x.used_at is null
                        /* v4.16b: only an allowance granted at or after the deadline in force counts; one granted
                           before a later extension lapses at the new deadline (the club could sign freely until
                           then). During an office lock (override 'locked') every allowance counts. The site's
                           count in part_live.js applies the same test (Rule 2.4). */
                        and (v_season.moves_lock_override = 'locked'
                             or x.created_at >= public.movement_deadline_at(v_season.id))
                      order by x.created_at limit 1);$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'sign_free_agent: anchor found % times', v_n; end if;
  execute replace(v_def, v_a, v_b);

  -- self-checks
  if position('public.moves_locked' in pg_get_functiondef('public.trg_autoassign_new_reg()'::regprocedure)) > 0
     or position('public.placement_closed(v_season.id)' in pg_get_functiondef('public.trg_autoassign_new_reg()'::regprocedure)) = 0 then
    raise exception 'self-check: trg_autoassign_new_reg does not read the placement gate';
  end if;
  if position('x.created_at >= public.movement_deadline_at(v_season.id)' in pg_get_functiondef('public.sign_free_agent(uuid,bigint,uuid)'::regprocedure)) = 0 then
    raise exception 'self-check: sign_free_agent still spends allowances granted before the deadline';
  end if;
end $p$;
