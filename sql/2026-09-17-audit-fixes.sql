-- 2026-09-17 — fixes from docs/audits/2026-09-17-stress-test.md (v2.57).
-- Applied live in gated sections (each rehearsed with a trailing `raise exception` first).
-- The client change that goes with I-2 (explicit games columns, codes through games_public)
-- deploys BEFORE I-2 runs.

-- ==== I-1 · grants: the public helpers, respond_offer, and the default for new functions ====
begin;
grant execute on function public.respond_offer(uuid,text,bigint,integer) to authenticated;
revoke execute on function public._assign_reg_random(uuid,text,boolean,text) from public, anon, authenticated;
revoke execute on function public.preseason_release_loans(uuid,text) from public, anon, authenticated;
revoke execute on function public._mgmt_move_send(uuid,text,boolean) from public, anon, authenticated;
revoke execute on function public.lfg_form_lobby(uuid,timestamptz,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.lfg_open_lobby(text,text) from public, anon, authenticated;
revoke execute on function public.lineup_camp_warnings(uuid,uuid) from public, anon, authenticated;
-- new functions are no longer executable by PUBLIC or anon until granted on purpose
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
do $chk$ begin
  if has_function_privilege('anon','public._assign_reg_random(uuid,text,boolean,text)','EXECUTE') then raise exception 'anon still executes _assign_reg_random'; end if;
  if has_function_privilege('authenticated','public.preseason_release_loans(uuid,text)','EXECUTE') then raise exception 'authenticated still executes preseason_release_loans'; end if;
  if not has_function_privilege('authenticated','public.respond_offer(uuid,text,bigint,integer)','EXECUTE') then raise exception 'respond_offer not granted'; end if;
  if not has_function_privilege('service_role','public.lfg_form_lobby(uuid,timestamptz,jsonb,jsonb)','EXECUTE') then raise exception 'service_role lost lfg_form_lobby'; end if;
end $chk$;
commit;

-- ==== I-2 · private lobby codes: column grants on games, games_public as the read path, can_see_match by night ====
begin;
revoke select on table public.games from anon, authenticated;
grant select (id, season_id, week, home_team_id, away_team_id, scheduled_at, home_score, away_score, went_ot, status,
              twitch_url, created_at, ea_match_id, home_ppg, home_ppo, away_ppg, away_ppo, stage, forfeit_team_id, voided)
  on public.games to anon, authenticated;
alter view public.games_public set (security_invoker = false);
revoke insert, update, delete, truncate, references, trigger on public.games_public from anon, authenticated;
-- a function called inside a view runs with the CALLER's execute privilege, whatever the view's
-- security mode — so the masking predicate itself must be executable by the API roles
grant execute on function public.can_see_match(uuid) to anon, authenticated;
create or replace function public.can_see_match(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  /* Rule 4.2 (v2.57): the private lobby code and server pick are released 30 minutes before the
     night's FIRST game, to the two clubs' rosters and front offices only. The league office sees
     them at any time. */
  with g as (select * from public.games where id = p_game),
       night as (select min(x.scheduled_at) as first_at from public.games x, g
                  where x.season_id = g.season_id and not coalesce(x.voided,false)
                    and (x.scheduled_at at time zone 'America/New_York')::date = (g.scheduled_at at time zone 'America/New_York')::date)
  select exists (select 1 from g) and (
    public.is_commissioner() or public.is_staff()
    or ( now() >= (select first_at from night) - interval '30 minutes'
         and ( exists (select 1 from g join public.teams t on t.id in (g.home_team_id, g.away_team_id)
                        where auth.uid() in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id))
            or exists (select 1 from g join public.roster_spots rs on rs.season_id = g.season_id and rs.team_id in (g.home_team_id, g.away_team_id)
                        where rs.profile_id = auth.uid()) ) ) )
$$;
do $chk$ begin
  if has_column_privilege('anon','public.games','game_code','SELECT') then raise exception 'anon still reads game_code'; end if;
  if not has_column_privilege('anon','public.games','scheduled_at','SELECT') then raise exception 'anon lost scheduled_at'; end if;
  if not has_table_privilege('anon','public.games_public','SELECT') then raise exception 'anon lost games_public'; end if;
end $chk$;
commit;

-- ==== I-3 · filed lineups: readable by the two clubs, the office, and everyone once the game locks ====
begin;
drop policy if exists game_lineups_read on public.game_lineups;
create policy game_lineups_read on public.game_lineups for select using (
  public.is_commissioner() or public.is_staff() or public.is_gm_of(team_id)
  or exists (select 1 from public.roster_spots rs where rs.season_id = game_lineups.season_id and rs.team_id = game_lineups.team_id and rs.profile_id = auth.uid())
  or exists (select 1 from public.games g where g.id = game_lineups.game_id and g.scheduled_at is not null and now() >= g.scheduled_at - interval '30 minutes')
);
drop policy if exists lineups_read on public.lineups;
create policy lineups_read on public.lineups for select using (public.is_commissioner() or public.is_staff() or public.is_gm_of(team_id));
commit;

-- ==== I-4 · trades: assets are fixed once proposed; roster rows: identity columns pinned; profiles.is_admin pinned ====
begin;
create or replace function public.guard_trade_assets() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.trusted_writer() or public.is_commissioner() then return new; end if;
  raise exception 'A trade''s assets cannot be edited once it is proposed — decline it and propose again (Rule 2.3).' using errcode = '42501';
end $$;
drop trigger if exists guard_trade_assets_trg on public.trades;
create trigger guard_trade_assets_trg before update of offered_profile_ids, requested_profile_ids, retention,
  offered_pick_ids, requested_pick_ids, from_team_id, to_team_id, from_profile_id, season_id
  on public.trades for each row when (
    old.offered_profile_ids is distinct from new.offered_profile_ids or old.requested_profile_ids is distinct from new.requested_profile_ids
    or old.retention is distinct from new.retention or old.offered_pick_ids is distinct from new.offered_pick_ids
    or old.requested_pick_ids is distinct from new.requested_pick_ids or old.from_team_id is distinct from new.from_team_id
    or old.to_team_id is distinct from new.to_team_id or old.from_profile_id is distinct from new.from_profile_id
    or old.season_id is distinct from new.season_id)
  execute function public.guard_trade_assets();
create or replace function public.guard_roster_identity() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.trusted_writer() or public.is_commissioner() then return new; end if;
  raise exception 'A roster row''s player, season and origin are set by the league — sign, trade or waive instead.' using errcode = '42501';
end $$;
drop trigger if exists a_guard_roster_identity_trg on public.roster_spots;
create trigger a_guard_roster_identity_trg before update of profile_id, season_id, origin on public.roster_spots
  for each row when (old.profile_id is distinct from new.profile_id or old.season_id is distinct from new.season_id or old.origin is distinct from new.origin)
  execute function public.guard_roster_identity();
select public._splice_fn('public.guard_profile_role()', variadic array[
  'end if;
  return new;
end;',
  'end if;
  if new.is_admin is distinct from old.is_admin then new.is_admin := old.is_admin; end if;
  return new;
end;', '1']);
commit;

-- ==== I-5 · sign-ups: the guard covers INSERT; notes move to their own table ====
begin;
create or replace function public.guard_registration_columns() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.trusted_writer() or public.is_commissioner() or public.is_staff() then return new; end if;
  if tg_op = 'INSERT' then
    new.created_at := now(); new.status := 'pending'; new.scout_ovr := null;
    return new;
  end if;
  if new.created_at is distinct from old.created_at then new.created_at := old.created_at; end if;
  if new.scout_ovr  is distinct from old.scout_ovr  then new.scout_ovr  := old.scout_ovr;  end if;
  if new.status     is distinct from old.status     then new.status     := old.status;     end if;
  if new.season_id  is distinct from old.season_id  then new.season_id  := old.season_id;  end if;
  if new.profile_id is distinct from old.profile_id then new.profile_id := old.profile_id; end if;
  return new;
end $$;
drop trigger if exists guard_registration_columns_insert on public.season_registrations;
create trigger guard_registration_columns_insert before insert on public.season_registrations
  for each row execute function public.guard_registration_columns();
create table if not exists public.registration_notes (
  registration_id uuid primary key references public.season_registrations(id) on delete cascade deferrable initially deferred,
  profile_id uuid not null, note text, updated_at timestamptz not null default now());
alter table public.registration_notes enable row level security;
drop policy if exists registration_notes_read on public.registration_notes;
create policy registration_notes_read on public.registration_notes for select using (profile_id = auth.uid() or public.is_commissioner() or public.is_staff());
grant select on public.registration_notes to authenticated;
create or replace function public.move_registration_note() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.note is not null then
    insert into public.registration_notes(registration_id, profile_id, note) values (new.id, new.profile_id, new.note)
      on conflict (registration_id) do update set note = excluded.note, updated_at = now();
    new.note := null;
  end if;
  return new;
end $$;
drop trigger if exists zz_move_registration_note on public.season_registrations;
create trigger zz_move_registration_note before insert or update of note on public.season_registrations
  for each row execute function public.move_registration_note();
insert into public.registration_notes(registration_id, profile_id, note)
  select id, profile_id, note from public.season_registrations where note is not null
  on conflict (registration_id) do nothing;
update public.season_registrations set note = null where note is not null;
commit;

-- ==== I-6 · waive_player: the dead guard, and the registration flip that never landed ====
begin;
select public._splice_fn('public.waive_player(uuid)', variadic array[
  'perform set_config(''app.roster_reason'', '''', true);
  get diagnostics v_n = row_count;',
  'get diagnostics v_n = row_count;
  perform set_config(''app.roster_reason'', '''', true);', '1',
  'update public.season_registrations set status = ''pending''',
  'perform set_config(''app.role_grant'',''on'',true);
  update public.season_registrations set status = ''pending''', '1',
  'insert into public.transactions (season_id, type, description)',
  'perform set_config(''app.role_grant'','''',true);
  insert into public.transactions (season_id, type, description)', '1']);
commit;

-- ==== I-7 · sign_free_agent: the basic format signs a waived player directly at the minimum ====
begin;
select public._splice_fn('public.sign_free_agent(uuid,bigint)', variadic array[
  'v_salary := greatest(coalesce(p_salary, 750000), 750000);',
  'v_salary := greatest(coalesce(p_salary, 750000), 750000);
  if public.season_is_basic(v_season.id) then v_salary := 750000; end if;   -- Rule 2.2: the one deal in the basic format', '1',
  'v_team.name || '' signed free agent <b>''',
  'v_team.name || case when public.season_is_basic(v_season.id) then '' signed waived player <b>'' else '' signed free agent <b>'' end', '1']);
commit;

-- ==== I-8 · resolve_game_server guard; latecomer/rookie placement: anon is not the league office ====
begin;
select public._splice_fn('public.resolve_game_server(uuid)', variadic array[
  'if v_server is not null then return v_server; end if;',
  'if coalesce(current_setting(''request.jwt.claims'', true), '''') <> '''' and not (public.is_commissioner() or public.is_staff() or public.can_see_match(p_game)) then
    raise exception ''Only the two clubs and the league office can resolve a server.'' using errcode = ''42501'';
  end if;
  if v_server is not null then return v_server; end if;', '1']);
select public._splice_fn('public.auto_assign_latecomers(boolean)', variadic array[
  'if auth.uid() is not null and not public.is_commissioner() then',
  'if not (public.is_commissioner() or public.trusted_writer() or coalesce(current_setting(''request.jwt.claims'', true), '''') = '''') then', '1']);
select public._splice_fn('public.distribute_unproven_rookies(boolean)', variadic array[
  'if auth.uid() is not null and not public.is_commissioner() then',
  'if not (public.is_commissioner() or public.trusted_writer() or coalesce(current_setting(''request.jwt.claims'', true), '''') = '''') then', '1']);
commit;

-- ==== I-9 · staff who move players between roster and camp are the transactions desk ====
begin;
select public._splice_fn('public.set_roster_squad(uuid,text)', variadic array[
  'if not (is_team_manager(r.team_id) or is_commissioner() or is_staff()) then',
  'if not (is_team_manager(r.team_id) or is_commissioner() or has_department(''transactions'')) then', '1']);
select public._splice_fn('public.swap_roster_squad(uuid,uuid)', variadic array[
  'if not (is_team_manager(a.team_id) or is_commissioner() or is_staff()) then',
  'if not (is_team_manager(a.team_id) or is_commissioner() or has_department(''transactions'')) then', '1']);
commit;

-- ==== I-10 · box scores: one row per player per game; a waived or traded player leaves every filed lineup ====
begin;
create unique index if not exists game_stats_one_row_per_player
  on public.game_stats (game_id, team_id, coalesce(ea_player_id, profile_id::text, lower(coalesce(skater_name,''))));
create or replace function public.clear_lineups_on_roster_remove() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_pid uuid; v_team uuid; v_season uuid; v_name text; v_n int := 0;
begin
  v_pid := old.profile_id; v_team := old.team_id; v_season := old.season_id;   -- the club he LEFT
  for r in select gl.id, gl.game_id, g.scheduled_at, gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie
             from public.game_lineups gl join public.games g on g.id = gl.game_id
            where gl.season_id = v_season and gl.team_id = v_team and g.status = 'scheduled'
              and v_pid in (gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie) loop
    update public.game_lineups set
      center = case when center = v_pid then null else center end, lw = case when lw = v_pid then null else lw end,
      rw = case when rw = v_pid then null else rw end, ld = case when ld = v_pid then null else ld end,
      rd = case when rd = v_pid then null else rd end, goalie = case when goalie = v_pid then null else goalie end,
      updated_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    select coalesce(nullif(gamertag,''),'A player') into v_name from public.profiles where id = v_pid;
    perform public.club_notify(v_team, 'lineup', v_name || ' pulled from ' || v_n || ' filed lineup' || case when v_n = 1 then '' else 's' end,
      v_name || ' is no longer on your roster, so his slot in ' || v_n || ' upcoming filed lineup' || case when v_n = 1 then '' else 's' end ||
      ' is empty. Re-file before the lock (Rule 5.3).', null, 'lineup', null);
  end if;
  return null;
end $$;
drop trigger if exists clear_lineups_on_roster_remove_trg on public.roster_spots;
drop trigger if exists clear_lineups_on_roster_delete_trg on public.roster_spots;
drop trigger if exists clear_lineups_on_roster_move_trg on public.roster_spots;
create trigger clear_lineups_on_roster_delete_trg after delete on public.roster_spots
  for each row execute function public.clear_lineups_on_roster_remove();
create trigger clear_lineups_on_roster_move_trg after update of team_id on public.roster_spots
  for each row when (old.team_id is distinct from new.team_id) execute function public.clear_lineups_on_roster_remove();
commit;

-- ==== I-11 · post-lock lineup changes: bounded to the game's start, counted per player, and told to the opponent + officials ====
begin;
create or replace function public._post_lock_notices(p_game uuid, p_team uuid, p_old public.game_lineups, p_new uuid[], p_diff integer, p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_game public.games; v_opp uuid; v_club text; v_oppname text; v_opprole text; v_out text; v_in text; v_old uuid[]; v_when text; v_mgr uuid; v_st record;
begin
  select * into v_game from public.games where id = p_game;
  v_opp := case when p_team = v_game.home_team_id then v_game.away_team_id else v_game.home_team_id end;
  select name into v_club from public.teams where id = p_team;
  select name, discord_role_id into v_oppname, v_opprole from public.teams where id = v_opp;
  v_old := array_remove(array[p_old.center, p_old.lw, p_old.rw, p_old.ld, p_old.rd, p_old.goalie], null);
  select string_agg(coalesce(nullif(pr.gamertag,''),'a player'), ', ') into v_out from unnest(v_old) o(pid) join public.profiles pr on pr.id = o.pid where not (o.pid = any(p_new));
  select string_agg(coalesce(nullif(pr.gamertag,''),'a player'), ', ') into v_in  from unnest(p_new) n(pid) join public.profiles pr on pr.id = n.pid where not (n.pid = any(v_old));
  v_when := to_char(v_game.scheduled_at at time zone 'America/New_York', 'Dy HH12:MI AM') || ' ET';
  -- the opposing club: every seat of its front office on the site, and its own Discord room
  perform public.club_notify(v_opp, 'flag', coalesce(v_club,'Your opponent') || ' changed its lineup after the lock',
    coalesce(v_club,'The other club') || ' changed its lineup for your ' || v_when || ' game after the 30-minute lock: out ' || coalesce(v_out,'—') ||
    ', in ' || coalesce(v_in,'—') || '. Under Rule 5.3 they serve ' || p_diff || ' in-game penalt' || case when p_diff = 1 then 'y' else 'ies' end ||
    ' — coordinate before puck drop so it is applied on the ice.', p_uid, 'lineup', p_game::text);
  -- the officials desk and the commissioners
  perform public.notify_commissioners(null, 'flag', 'Post-lock lineup change (Rule 5.3)',
    coalesce(v_club,'A club') || ' vs ' || coalesce(v_oppname,'?') || ' (' || v_when || '): out ' || coalesce(v_out,'—') || ', in ' || coalesce(v_in,'—') ||
    '. ' || p_diff || ' in-game penalt' || case when p_diff = 1 then 'y' else 'ies' end || ' owed. Verify against the box score.', 'officiating', p_game::text);
  for v_mgr in select id from public.profiles where role = 'staff' and 'officiating' = any(departments) loop
    perform public.create_notification(v_mgr, 'flag', 'Post-lock lineup change (Rule 5.3)',
      coalesce(v_club,'A club') || ' vs ' || coalesce(v_oppname,'?') || ' (' || v_when || '): out ' || coalesce(v_out,'—') || ', in ' || coalesce(v_in,'—') ||
      '. ' || p_diff || ' in-game penalt' || case when p_diff = 1 then 'y' else 'ies' end || ' owed. Verify against the box score.', 'officiating', p_game::text);
  end loop;
  perform public.log_admin_action('post_lock_change', 'game', p_game::text,
    jsonb_build_object('club', v_club, 'opponent', v_oppname, 'out', v_out, 'in', v_in, 'penalties', p_diff, 'by', p_uid));
  begin
    perform public.notify_discord('discord_mgmt_moves_webhook',
      '⚠️ **Post-lock lineup change** — ' || coalesce(v_club,'A club') || ' vs ' || coalesce(v_oppname,'their opponent') || ' (' || v_when || '): out ' ||
      coalesce(v_out,'—') || ', in ' || coalesce(v_in,'—') || '. ' || case when v_opprole is not null then '<@&' || v_opprole || '> ' else '' end ||
      'This costs ' || p_diff || ' in-game penalt' || case when p_diff = 1 then 'y' else 'ies' end || ' (Rule 5.3) — coordinate so it is served on the ice.', true);
  exception when others then raise warning '_post_lock_notices: discord post failed — %', sqlerrm;
  end;
end $$;
revoke execute on function public._post_lock_notices(uuid,uuid,public.game_lineups,uuid[],integer,uuid) from public, anon, authenticated;
commit;

-- I-11b · set_game_lineup: the splices (advisory lock, the window, per-player count, the new notices)
begin;
select public._splice_fn('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)', variadic array[
  'perform public.mgmt_gate(p_team, ''lines'');',
  'perform public.mgmt_gate(p_team, ''lines'');
  perform pg_advisory_xact_lock(hashtext(''lineup:'' || v_game.season_id || '':'' || v_game.stage || '':'' || v_game.week || '':'' || p_team));   -- one filing at a time per club-week (Rule 5.2)', '1',
  'if v_locked and not coalesce(p_emergency, false) then',
  'if v_locked and now() >= v_game.scheduled_at + interval ''10 minutes'' then
    raise exception ''This game has started — the lineup on file is the record now. A player who dresses without being on it is reviewed by the officials against the box score (Rule 5.3).'' using errcode = ''42501'';
  end if;
  if v_locked and not coalesce(p_emergency, false) then', '1']);
commit;
