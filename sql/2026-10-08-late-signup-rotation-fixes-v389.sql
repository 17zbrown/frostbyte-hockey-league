-- v3.89 fixes, from the review of sql/2026-10-07-late-signup-rotation-v389.sql (applied 2026-10-07).
--
-- 1. THE POST-DRAFT CRON PLACES MID-SEASON TOO. distribute_unproven_rookies runs every 2 minutes (cron rookie-distribution)
--    for the whole season once the draft is complete, and seats ANY unplaced registration with origin postdraft_random.
--    The */5 latecomer sweep and the registration trigger were the only callers the rotation read, so most mid-season
--    placements skipped it (Replays, UTA, Oct 2, was placed by the 2-minute cron). The rotation now follows the
--    commissioner's words, "mid-season", not the caller: once the season's FIRST post-draft round is done (app_config
--    postdraft_done_<season id>, written by that round), every depth placement goes round the league, whichever job made
--    it. The first round itself keeps its straight draw ("No, mid-season only").
-- 2. A TURN COMES BACK ONLY FOR A CORRECTION. An office removal voided the turn however long the club had the player. Now
--    only within 24 hours of the placement (every Season 1 correction came within 2 h 17 min); later, the player was the
--    club's, like a waiver or a departure.
-- 3. The seven Season 1 corrections that exist as removal rows are linked to them, so reinstating one restores the turn.
-- 4. Season 1's first post-draft round was the batch at 10:23 PM ET on Sep 19.

-- 1a. the first round marks itself done
do $patch$
declare d text; n int;
  a_old text := $a$  perform set_config('app.roster_notice', '', true);
  perform public._club_batch_notices(v_season.id, case when public.season_is_basic(v_season.id) then 'depth_random' else 'postdraft_random' end, now(), 'sign', 'Post-draft placements',$a$;
  a_new text := $a$  perform set_config('app.roster_notice', '', true);
  /* v3.89: the season's first post-draft round is done; every later depth placement goes round the league (Rule 2.8) */
  insert into public.app_config (key, value) values ('postdraft_done_' || v_season.id::text, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict (key) do nothing;
  perform public._club_batch_notices(v_season.id, case when public.season_is_basic(v_season.id) then 'depth_random' else 'postdraft_random' end, now(), 'sign', 'Post-draft placements',$a$;
begin
  d := pg_get_functiondef('public.distribute_unproven_rookies(boolean)'::regprocedure);
  n := (length(d) - length(replace(d, a_old, ''))) / length(a_old);
  if n <> 1 then raise exception 'v3.89 fix: the post-draft anchor matched % times', n; end if;
  execute replace(d, a_old, a_new);
end $patch$;

-- 1b. the rotation reads "mid-season", not the caller
do $patch$
declare d text; n int;
  a_old text := $a$                       case when p_origin = 'latecomer_random'
                            then (select count(*) from public.random_assignments ra$a$;
  a_new text := $a$                       case when p_origin = 'latecomer_random'
                              or exists (select 1 from public.app_config ac where ac.key = 'postdraft_done_' || v_reg.season_id::text)
                            then (select count(*) from public.random_assignments ra$a$;
  b_old text := $b$  if v_origin = 'depth_random' and p_origin = 'latecomer_random' then
    insert into public.random_assignments$b$;
  b_new text := $b$  /* v3.89 fix: every depth placement after the season's first post-draft round, whichever job made it */
  if v_origin = 'depth_random' and (p_origin = 'latecomer_random'
       or exists (select 1 from public.app_config ac where ac.key = 'postdraft_done_' || v_reg.season_id::text)) then
    insert into public.random_assignments$b$;
begin
  d := pg_get_functiondef('public._assign_reg_random(uuid,text,boolean,text)'::regprocedure);
  n := (length(d) - length(replace(d, a_old, ''))) / length(a_old);
  if n <> 1 then raise exception 'v3.89 fix: the turns anchor matched % times', n; end if;
  n := (length(d) - length(replace(d, b_old, ''))) / length(b_old);
  if n <> 1 then raise exception 'v3.89 fix: the log anchor matched % times', n; end if;
  execute replace(replace(d, a_old, a_new), b_old, b_new);
end $patch$;

-- 2. a correction is within a day of the placement
create or replace function public.random_assignment_undone() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    if new.origin = 'depth_random'
       and coalesce(new.reason, '') ~* '(by the league office|^league office: revers|^reversing a placement)' then
      update public.random_assignments ra
         set counts = false, voided_by_removal = new.id,
             note = 'undone by the league office: ' || new.reason
       where ra.id = (select r2.id from public.random_assignments r2
                       where r2.season_id = new.season_id and r2.profile_id = new.profile_id
                         and r2.team_id = new.team_id and r2.counts
                         and r2.placed_at > coalesce(new.removed_at, now()) - interval '24 hours'   -- v3.89 fix: a correction, not a removal weeks later
                       order by r2.placed_at desc limit 1);
    end if;
  elsif new.reinstated_at is not null and old.reinstated_at is null then
    update public.random_assignments set counts = true, voided_by_removal = null, note = null
     where voided_by_removal = new.id;
  end if;
  return null;
end $function$;
revoke execute on function public.random_assignment_undone() from public, anon, authenticated;

-- 3. link the Season 1 corrections to their removal rows
do $link$
declare n int;
begin
  update public.random_assignments ra set voided_by_removal = r.id
    from public.roster_spot_removals r
   where ra.season_id = r.season_id and ra.profile_id = r.profile_id and ra.team_id = r.team_id
     and not ra.counts and ra.voided_by_removal is null and r.spot_created_at = ra.placed_at and r.reinstated_at is null
     and coalesce(r.reason, '') ~* '(by the league office|^league office: revers|^reversing a placement)';
  get diagnostics n = row_count;
  if n <> 7 then raise exception 'v3.89 fix: expected to link 7 Season 1 corrections, linked %', n; end if;
end $link$;

-- 4. Season 1's first post-draft round (the batch at 02:23 UTC on Sep 20)
insert into public.app_config (key, value)
  select 'postdraft_done_' || s.id::text, '2026-09-20T02:23:28Z' from public.seasons s where s.number = 1
  on conflict (key) do nothing;
