-- v3.92 (2026-10-10): the late sign-up rotation counts only the placements made UNDER the rotation.
--
-- Commissioner, 2026-10-10: "Mid season signups only seem to be going to Vancouver. Make sure each team gets
-- one before you give a 2nd one to any team."
--
-- Why it happened: v3.89 counted every league-office placement since the post-draft round, so the clubs with
-- the fewest of those (Boston and Vancouver, 2 each) were owed first. Boston's training camp is full (10 of 10,
-- Rule 2.1), so Boston is passed over, and three of the four placements since the rotation went live
-- (Oct 8 23:40, Oct 9 19:45 undone by the office, Oct 10 22:13 ET) went to Vancouver.
--
-- The fix: a placement made before the rotation took effect (the v3.89 migration, 2026-10-08 02:26:52 UTC) is
-- history, not a turn. random_assignments.in_rotation marks it, separately from `counts`, because the undo and
-- reinstate trigger (random_assignment_undone) owns `counts` and would hand a turn back to an old row on a
-- reinstatement. The draw counts rows that are both counted and in the rotation.
--
-- Result for Season 1: Vancouver 2, Utah 1, every other club 0. The next late sign-ups go one each to Dallas,
-- Detroit, the Islanders, Pittsburgh and Seattle (random order). Boston keeps its place at the front of the
-- line and receives the first one after its camp has room. Season 2 onward is unaffected: every row a later
-- season writes is in the rotation from the start.

alter table public.random_assignments add column if not exists in_rotation boolean not null default true;
comment on column public.random_assignments.in_rotation is
  'v3.92: false for a placement made before the late sign-up rotation took effect (Season 1, before 2026-10-08 02:26:52 UTC). Kept as history; never a turn. The draw counts rows where counts and in_rotation.';

update public.random_assignments
   set in_rotation = false
 where season_id = (select id from public.seasons where number = 1)
   and placed_at < timestamptz '2026-10-08 02:26:52+00';

drop index if exists public.random_assignments_turns;
create index random_assignments_turns on public.random_assignments (season_id, team_id) where counts and in_rotation;

-- the draw: count only turns taken in the rotation (anchored patch, asserted unique)
do $patch$
declare v_def text; v_old text := 'where ra.season_id = v_reg.season_id and ra.team_id = t.id and ra.counts)';
        v_new text := 'where ra.season_id = v_reg.season_id and ra.team_id = t.id and ra.counts and ra.in_rotation)';
begin
  select pg_get_functiondef('public._assign_reg_random(uuid,text,boolean,text)'::regprocedure) into v_def;
  if (select count(*) from regexp_matches(v_def, regexp_replace(v_old, '([().*])', '\\\1', 'g'), 'g')) <> 1 then
    raise exception 'v3.92 patch: the rotation count anchor was not found exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;

do $chk$
declare v_s uuid := (select id from public.seasons where number = 1); v_bad int;
begin
  if position('ra.counts and ra.in_rotation)' in pg_get_functiondef('public._assign_reg_random(uuid,text,boolean,text)'::regprocedure)) = 0 then
    raise exception 'v3.92: the draw does not read in_rotation';
  end if;
  select count(*) into v_bad from public.random_assignments
   where season_id = v_s and in_rotation and placed_at < timestamptz '2026-10-08 02:26:52+00';
  if v_bad <> 0 then raise exception 'v3.92: % pre-rotation rows still counted', v_bad; end if;
end $chk$;
