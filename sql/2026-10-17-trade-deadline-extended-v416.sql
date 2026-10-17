-- v4.16: Season 1's movement deadline is extended to 11:59 PM ET Sunday, October 18, 2026, for club moves, while
-- automatic placement stays closed at the original deadline and Season 2 sign-ups and owner applications stay open.
-- Commissioner, 2026-10-17: "Keep the signups and applications open and lock the late signups for season 1, but
-- extend the trade deadline to 11:59PM on Sunday."
--
-- Why a new gate: one deadline did three jobs. moves_locked() closes club moves (trades, waivers, signings, the trade
-- block, the management queue), it ends automatic placement (auto_assign_latecomers and distribute_unproven_rookies
-- stop when it is true), and flip_season_status opens the next season's sign-ups when it turns true. Moving the
-- deadline alone would reopen placement for Season 1. So placement gets its own close, seasons.placement_closed_at,
-- read through public.placement_closed(): closed when moves are locked OR the placement close has passed. With no
-- placement_closed_at set it is exactly the movement deadline, so every other season behaves as before (Rule 2.4).
--
-- Unchanged on purpose:
--  * Season 2 sign-ups and owner applications: flip_season_status only acts on a season still taking sign-ups, and
--    Season 1 stopped at the original deadline (registration_open = false; Season 2 true), so nothing flips back.
--  * _deadline_sweep and automation_watchdog read the fixed deadline, so they run again at the new time: offers made
--    before 11:59 PM Sunday that are still open then close, and the trade block comes down again.
--  * The 14 offers the sweep cancelled at the original deadline stay cancelled; clubs may make them again.
-- Nothing here posts to Discord.
--
-- REHEARSAL on production, 2026-10-17, the whole change in ONE do-block ending in an uncaught raise (verified rolled back:
-- no column, no function, deadline unchanged, no audit row), which also ran both placement jobs:
--   S1 deadline 2026-10-17 04:00:00+00 -> 2026-10-19 03:59:00+00, placement closed 2026-10-17 04:00:00+00
--   (placement_closed=t), moves_locked=f, S1 reg open=f, S2 reg open=t, latecomer placed 0, post-draft placed 0
-- Applied as migration v416_trade_deadline_extended.

alter table public.seasons add column if not exists placement_closed_at timestamptz;
comment on column public.seasons.placement_closed_at is
  'v4.16: when automatic placement (late sign-ups, post-draft depth) closes, if earlier than the movement deadline. Null = at the movement deadline (Rule 2.4).';

create or replace function public.placement_closed(p_season uuid) returns boolean
  language sql stable set search_path to '' as $f$
  select coalesce(public.moves_locked(p_season), false)
      or coalesce((select s.placement_closed_at is not null and now() >= s.placement_closed_at
                     from public.seasons s where s.id = p_season), false)
$f$;
revoke all on function public.placement_closed(uuid) from public, anon, authenticated;

-- the two placement jobs read the placement gate (anchored text patches, each asserted to match exactly once)
do $p$
declare v_def text; v_a text; v_b text; v_n int;
begin
  v_def := pg_get_functiondef('public.auto_assign_latecomers(boolean)'::regprocedure);
  v_a := $q$  if public.moves_locked(v_season.id) and not p_force then return 0; end if;   -- Rule 2.4: one deadline for every move$q$;
  v_b := $q$  /* v4.16: placement has its own close (seasons.placement_closed_at), so the office can extend club moves without
     reopening automatic placement (commissioner, 2026-10-17: "lock the late signups for season 1"). With no close set
     it is the movement deadline, as before (Rule 2.4). */
  if public.placement_closed(v_season.id) and not p_force then return 0; end if;$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'auto_assign_latecomers: anchor found % times', v_n; end if;
  execute replace(v_def, v_a, v_b);

  v_def := pg_get_functiondef('public.distribute_unproven_rookies(boolean)'::regprocedure);
  v_a := $q$  if public.moves_locked(v_season.id) and not p_force then return 0; end if;
  perform set_config('app.roster_notice', 'batch', true);
  /* v2.70: one random player per pick$q$;
  v_b := $q$  /* v4.16: post-draft depth placement closes with automatic placement (public.placement_closed, Rule 2.4) */
  if public.placement_closed(v_season.id) and not p_force then return 0; end if;
  perform set_config('app.roster_notice', 'batch', true);
  /* v2.70: one random player per pick$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'distribute_unproven_rookies: anchor found % times', v_n; end if;
  execute replace(v_def, v_a, v_b);
end $p$;

-- Season 1: placement closed at the original deadline; club moves until 11:59 PM ET Sunday, Oct 18
do $d$
declare v_s1 uuid; v_orig timestamptz; v_new constant timestamptz := timestamptz '2026-10-18 23:59:00 America/New_York';
begin
  select id, movement_deadline_fixed into v_s1, v_orig from public.seasons where number = 1;
  if v_orig is distinct from timestamptz '2026-10-17 00:00:00 America/New_York' then
    raise exception 'Season 1 deadline reads %, expected Sat Oct 17 12:00 AM ET', v_orig;
  end if;
  update public.seasons set placement_closed_at = v_orig where id = v_s1 and placement_closed_at is null;
  update public.seasons set movement_deadline_fixed = v_new where id = v_s1;
  perform public.log_admin_action('movement_deadline_extended', 'season', v_s1::text, jsonb_build_object(
    'from', v_orig, 'to', v_new, 'placement_closed_at', v_orig,
    'ruling', 'Commissioner, 2026-10-17: trade deadline extended to 11:59 PM ET Sunday Oct 18; Season 1 late sign-ups stay locked; Season 2 sign-ups and owner applications stay open'));

  -- self-checks
  if public.movement_deadline_at(v_s1) is distinct from v_new then raise exception 'self-check: the deadline did not move'; end if;
  if now() < v_new and public.moves_locked(v_s1) then raise exception 'self-check: club moves are still locked'; end if;
  if not public.placement_closed(v_s1) then raise exception 'self-check: Season 1 placement reopened'; end if;
  if (select registration_open from public.seasons where id = v_s1) then raise exception 'self-check: Season 1 sign-ups reopened'; end if;
  if not (select registration_open from public.seasons where number = 2) then raise exception 'self-check: Season 2 sign-ups closed'; end if;
  if position('public.placement_closed(v_season.id)' in pg_get_functiondef('public.auto_assign_latecomers(boolean)'::regprocedure)) = 0
     or position('public.placement_closed(v_season.id)' in pg_get_functiondef('public.distribute_unproven_rookies(boolean)'::regprocedure)) = 0 then
    raise exception 'self-check: a placement job still reads only the movement deadline';
  end if;
  if has_function_privilege('anon', 'public.placement_closed(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.placement_closed(uuid)', 'EXECUTE') then
    raise exception 'self-check: placement_closed is callable by an API role';
  end if;
end $d$;
