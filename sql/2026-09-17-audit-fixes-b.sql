-- 2026-09-17 — audit fixes, part B (continues 2026-09-17-audit-fixes.sql; v2.57).

-- ==== I-11c · set_game_lineup: penalties count players changed, not slots; the camp-only notice block is replaced by the helper ====
-- Regex splices over pg_get_functiondef — every one asserts it matched, so a drifted body fails loudly.
begin;
do $x$ declare d text; d0 text; begin
  select pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure) into d; d0 := d;
  d := regexp_replace(d, 'v_diff := \(case when v_old\.center is distinct from p_center then 1 else 0 end\).*?then 1 else 0 end\);',
    'v_diff := greatest(
        (select count(*) from unnest(v_players) x where x <> all(array_remove(array[v_old.center, v_old.lw, v_old.rw, v_old.ld, v_old.rd, v_old.goalie], null))),
        (select count(*) from unnest(array_remove(array[v_old.center, v_old.lw, v_old.rw, v_old.ld, v_old.rd, v_old.goalie], null)) x where x <> all(v_players)))::int;   -- players changed, not slots (Rule 5.3)');
  if d = d0 then raise exception 'diff block not found'; end if; d0 := d;
  d := regexp_replace(d, '  -- Post-lock TC call-up notice\..*?\n  return v_row;',
    '  -- Rule 5.3 (v2.57): every post-lock change is told to the opponent''s front office and room, the
  -- commissioners and the officials desk — who came out, who went in, the penalties owed.
  if v_locked and v_diff > 0 then
    perform public._post_lock_notices(p_game, p_team, v_old, v_players, v_diff, v_uid);
  end if;

  return v_row;');
  if d = d0 then raise exception 'notice block not found'; end if; d0 := d;
  d := replace(d, '  v_opp uuid; v_tc_names text; v_club text; v_oppname text; v_opprole text; v_mgr uuid;
', '');
  if d = d0 then raise exception 'declare line not found'; end if;
  execute d;
end $x$;
commit;

-- ==== I-12 · the Rule 5.2/5.3 review runs on every box-score write of a final game, once per finding ====
begin;
create or replace function public.review_game_records(p_game uuid) returns void language plpgsql security definer set search_path = public as $$
declare g public.games; r record; v_n int; v_cap int; v_name text; v_team text; v_squad text; v_pos text; v_lu public.game_lineups; v_filed boolean; v_dressed boolean;
begin
  select * into g from public.games where id = p_game;
  if g.id is null or g.stage <> 'regular' or g.status <> 'final' or coalesce(g.voided,false) then return; end if;
  for r in select gs.profile_id, gs.team_id, bool_or(coalesce(gs.is_goalie,false)) as is_goalie
             from public.game_stats gs where gs.game_id = g.id and gs.profile_id is not null
            group by gs.profile_id, gs.team_id loop
    select coalesce(nullif(gamertag,''),'a player') into v_name from public.profiles where id = r.profile_id;
    select code into v_team from public.teams where id = r.team_id;
    select rs.squad, rs.position::text into v_squad, v_pos from public.roster_spots rs
      where rs.season_id = g.season_id and rs.team_id = r.team_id and rs.profile_id = r.profile_id limit 1;
    v_cap := public.weekly_cap(g.season_id, v_squad, coalesce(v_pos, case when r.is_goalie then 'G' else 'C' end), g.stage);
    v_n := public.player_week_games(g.season_id, g.stage, g.week, r.profile_id, null);
    if v_n > v_cap and not exists (select 1 from public.admin_audit a where a.action = 'weekly_cap_violation' and a.target_id = g.id::text and a.detail->>'player' = v_name) then
      perform public.notify_commissioners(null, 'flag', 'Weekly cap exceeded (Rule 5.2)',
        v_name || ' (' || coalesce(v_team,'?') || ') has now played or been dressed in ' || v_n || ' games in week ' || g.week ||
        ' — the limit is ' || v_cap || '. Review the game.', 'transactions', null);
      perform public.log_admin_action('weekly_cap_violation','game',g.id::text,
        jsonb_build_object('player',v_name,'club',v_team,'week',g.week,'games',v_n,'cap',v_cap));
    end if;
    select * into v_lu from public.game_lineups gl where gl.game_id = g.id and gl.team_id = r.team_id limit 1;
    v_filed := found;
    v_dressed := v_filed and r.profile_id in (v_lu.center, v_lu.lw, v_lu.rw, v_lu.ld, v_lu.rd, v_lu.goalie);
    if v_filed and not coalesce(v_dressed, false)
       and not exists (select 1 from public.admin_audit a where a.action = 'lineup_discrepancy' and a.target_id = g.id::text and a.detail->>'player' = v_name) then
      perform public.notify_commissioners(null, 'flag', 'Played off the filed lineup (Rule 5.3)',
        v_name || ' (' || coalesce(v_team,'?') || ') appears in the box score but was not in the lineup his club filed for this game. Review the game.', 'transactions', null);
      perform public.log_admin_action('lineup_discrepancy','game',g.id::text, jsonb_build_object('player',v_name,'club',v_team,'week',g.week));
    end if;
  end loop;
  for r in select t.id, t.code from public.teams t where t.id in (g.home_team_id, g.away_team_id)
            and not exists (select 1 from public.game_lineups gl where gl.game_id = g.id and gl.team_id = t.id)
            and exists (select 1 from public.game_stats gs where gs.game_id = g.id and gs.team_id = t.id and gs.profile_id is not null)
            and not exists (select 1 from public.admin_audit a where a.action = 'lineup_not_filed' and a.target_id = g.id::text and a.detail->>'club' = t.code) loop
    perform public.notify_commissioners(null, 'flag', 'No lineup filed (Rule 5.3)',
      r.code || ' played this game without filing a lineup — the box score is the only record of who dressed. Review the game.', 'transactions', null);
    perform public.log_admin_action('lineup_not_filed','game',g.id::text, jsonb_build_object('club',r.code,'week',g.week));
  end loop;
end $$;
revoke execute on function public.review_game_records(uuid) from public, anon, authenticated;
create or replace function public.check_weekly_cap_violations() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (new.stage = 'regular' and new.status = 'final' and old.status is distinct from new.status) then return new; end if;
  begin perform public.review_game_records(new.id);
  exception when others then raise warning 'check_weekly_cap_violations failed for game %: %', new.id, sqlerrm; end;
  return new;
end $$;
create or replace function public.review_records_on_stats_write() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct game_id from inserted where game_id is not null loop
    begin perform public.review_game_records(r.game_id);
    exception when others then raise warning 'review_records_on_stats_write failed for game %: %', r.game_id, sqlerrm; end;
  end loop;
  return null;
end $$;
drop trigger if exists review_records_on_stats_write_trg on public.game_stats;
create trigger review_records_on_stats_write_trg after insert on public.game_stats
  referencing new table as inserted for each statement execute function public.review_records_on_stats_write();
commit;

-- ==== I-13 · availability: the record is stamped by the server and says whether it was late (Rule 5.1) ====
begin;
alter table public.availability add column if not exists first_submitted_at timestamptz;
alter table public.availability add column if not exists late boolean not null default false;
alter table public.availability add column if not exists late_at timestamptz;
create or replace function public.week_availability_deadline(p_season uuid, p_week_key text) returns timestamptz
language sql stable set search_path = public as $$
  /* the first game night of the week at 7:30 PM ET — the same rule the site shows (Rule 5.1) */
  with k as (select case when p_week_key like 'pre%' then 'preseason' when p_week_key like 'po%' then 'playoff' else 'regular' end as stage,
                    nullif(regexp_replace(p_week_key, '\D', '', 'g'), '')::int as week),
       first as (select min(g.scheduled_at) as at from public.games g, k
                  where g.season_id = p_season and coalesce(g.stage,'regular') = k.stage and g.week = k.week and not coalesce(g.voided,false))
  select ((first.at at time zone 'America/New_York')::date + time '19:30') at time zone 'America/New_York' from first where first.at is not null $$;
create or replace function public.stamp_availability() returns trigger language plpgsql security definer set search_path = public as $$
declare v_dl timestamptz;
begin
  new.submitted_at := now();
  if tg_op = 'INSERT' then new.first_submitted_at := now(); new.late := false; new.late_at := null;
  else new.first_submitted_at := coalesce(old.first_submitted_at, now()); new.late := old.late; new.late_at := old.late_at; end if;
  v_dl := public.week_availability_deadline(new.season_id, new.week_key);
  if v_dl is not null and now() > v_dl and not (public.trusted_writer() or public.is_commissioner() or public.is_staff()) then
    new.late := true; new.late_at := coalesce(new.late_at, now());
  end if;
  return new;
end $$;
drop trigger if exists stamp_availability_trg on public.availability;
create trigger stamp_availability_trg before insert or update on public.availability for each row execute function public.stamp_availability();
commit;

-- ==== I-14 · server picks resolve on their own clock, not at the tail of the Discord sweep ====
select cron.schedule('resolve-servers', '*/2 * * * *', 'select public.resolve_due_servers()')
  where not exists (select 1 from cron.job where jobname = 'resolve-servers');

-- ==== I-15 · the basic format signs a waived player directly: the approval executor and page map know sign_free_agent ====
begin;
select public._splice_fn('public._mgmt_execute(public.team_mgmt_moves)', variadic array[
  'when ''draft_make_pick''    then',
  'when ''sign_free_agent''    then perform public.sign_free_agent((a->>''p_registration'')::uuid, coalesce((a->>''p_salary'')::bigint, 750000));
    when ''draft_make_pick''    then', '1']);
select public._splice_fn('public.mgmt_action_page(text)', variadic array[
  'when ''offer_free_agent'' then ''freeagents''',
  'when ''offer_free_agent'' then ''freeagents'' when ''sign_free_agent'' then ''freeagents''', '1']);
commit;

-- ==== I-16 · the watchdog knows the new cron job ====
begin;
select public._splice_fn('public.automation_watchdog()', variadic array[
  '(''draft-watchdog'', interval ''1 hour''),',
  '(''draft-watchdog'', interval ''1 hour''),
      (''resolve-servers'', interval ''1 hour''),', '1']);
commit;

-- ==== I-17 · hygiene: the new trigger functions are not executable through the API ====
revoke execute on function public.move_registration_note() from public, anon, authenticated;
revoke execute on function public.clear_lineups_on_roster_remove() from public, anon, authenticated;
revoke execute on function public.guard_trade_assets() from public, anon, authenticated;
revoke execute on function public.guard_roster_identity() from public, anon, authenticated;
revoke execute on function public.stamp_availability() from public, anon, authenticated;
revoke execute on function public.review_records_on_stats_write() from public, anon, authenticated;

-- ==== v2.59 (2026-09-18) · a registration carries the player's EA ID (Rule 1.1) ====
create or replace function public.require_guild_membership() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.profile_id and in_guild) then
    raise exception 'JOIN_DISCORD: You must be in the Chel Gaming Discord server to register.' using errcode = 'P0001';
  end if;
  /* v2.59: the EA ID is the identity the box scores are matched on and it is shown on every
     profile — a sign-up without one is not a player the league can score. The office can still
     register someone by hand (trusted_writer / commissioner) and fix the ID after. */
  if not (public.trusted_writer() or public.is_commissioner())
     and not exists (select 1 from public.profiles where id = new.profile_id and coalesce(btrim(ea_id), '') <> '') then
    raise exception 'EA_ID: Add your EA ID before registering — it is the name the box scores are matched on.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ==== v2.62 (2026-09-19) · Rule 2.8: Owner + GM seat the club for the draft (AGM optional); Rule 2.6 pay Owner 0 / GM 0 / AGM 2M ====
create or replace function public.draft_management_gaps() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', t.id, 'code', t.code, 'name', t.name,
    'missing', array_remove(array[
      case when t.owner_profile_id is null then 'Owner' end,
      case when t.gm_profile_id is null then 'GM' end], null)) order by t.code), '[]'::jsonb)
  from public.teams t where t.owner_profile_id is null or t.gm_profile_id is null $$;
update public.seasons set owner_salary = 0, gm_salary = 0, agm_salary = 2000000 where name in ('Season 1','Season 2');
select public.apply_mgmt_salaries();   -- re-seats every management contract at the new pay
