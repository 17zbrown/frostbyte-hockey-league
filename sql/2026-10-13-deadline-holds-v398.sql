-- v3.98 (2026-10-13): the movement deadline holds once it passes, and nothing it closed stays open.
--
-- Commissioner, 2026-10-13: "Make sure the locks for the season 1 deadline are ready to automatically launch at the
-- deadline." A read-only audit found every Rule 2.4 gate in place and switching on by time alone at Sat Oct 17 12:00 AM
-- ET (trades, signings, offers, waivers, direct deletes, late and post-draft placement), with the sign-up switch and the
-- opening post on active jobs. It also found what this file closes:
--  1. The deadline was recomputed from the week-4 schedule on every check. Rescheduling a week-4 game moved it, and doing
--     that after midnight would have reopened trades, signings and waivers. The deadline is now FIXED
--     (seasons.movement_deadline_fixed) the first time a job runs after it passes, and every reader uses that instant.
--  2. Once the deadline passed, an open offer could be neither declined nor withdrawn (the lock refused every status
--     change). Neither moves a player, so both stay open. An offer made before the deadline that nobody answered closes
--     at it, with an on-site notice to both front offices (not the club rooms, as for any declined or withdrawn offer).
--  3. The trade block stayed open and kept posting "Management can open talks". New listings are refused after the
--     deadline, and the season's listings come down at it without a post.
--  4. The Owner-approval queue took trades, waivers, offers and listings after the deadline and failed them on approval.
--     It refuses them when asked; any still waiting at the deadline are withdrawn with the reason.
--  5. Any staff member could put a removed player back on a roster, or withdraw a rostered player's sign-up, after the
--     deadline. Past it both are a commissioner's (v3.79: the office's exemption from the clocks is a commissioner's).
--  6. A club could edit the date a player joined the roster (read by the prorated playoff floor and the emergency
--     goaltender exception) and the salary a manager held before the seat. Both are the league's to write.
--  7. Nothing alerted anyone if the midnight switch silently did nothing. The watchdog checks the fixed deadline, the
--     sign-up switch, the opening post and the closed offers 20 minutes after a deadline.
-- The sweep that closes offers, listings and queued requests runs as its own job (deadline-sweep, every 5 minutes), never
-- inside the sign-up switch, so nothing it touches can hold the switch back.

-- 1. the deadline, fixed when it passes ---------------------------------------------------------------------------------
alter table public.seasons add column if not exists movement_deadline_fixed timestamptz;
comment on column public.seasons.movement_deadline_fixed is
  'v3.98: the movement deadline (Rule 2.4) as fixed when it passed. movement_deadline_at() reads it before the schedule.';

create or replace function public.movement_deadline_at(p_season uuid)
returns timestamptz
language sql
stable security definer
set search_path to 'public'
as $function$
  /* midnight at the END of the Friday of the deadline week: take the last scheduled regular-season
     game of that week, truncate to its Eastern calendar day, add one day. Null when the season has
     no deadline week or that week has not been generated yet, in which case nothing is locked.
     v3.98: once it has passed it is fixed (movement_deadline_fixed), so a game rescheduled afterwards
     can neither move the deadline nor reopen movement. */
  select coalesce(s.movement_deadline_fixed, case when s.trade_deadline_week is null then null else (
    select (date_trunc('day', max(g.scheduled_at at time zone 'America/New_York')) + interval '1 day')
             at time zone 'America/New_York'
    from public.games g
    where g.season_id = s.id
      and coalesce(g.stage,'regular') = 'regular'
      and g.week = s.trade_deadline_week
  ) end)
  from public.seasons s where s.id = p_season;
$function$;

create or replace function public._latch_movement_deadlines()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_s record; v_n int := 0;
begin
  for v_s in
    select s.id, public.movement_deadline_at(s.id) as dl from public.seasons s
     where s.movement_deadline_fixed is null and s.status <> 'complete' and s.trade_deadline_week is not null
  loop
    if v_s.dl is not null and now() >= v_s.dl then
      update public.seasons set movement_deadline_fixed = v_s.dl where id = v_s.id and movement_deadline_fixed is null;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $function$;
revoke execute on function public._latch_movement_deadlines() from public, anon, authenticated;

-- the sign-up switch fixes the deadline in the same transaction that closes the season's sign-ups
do $p$
declare v_def text := pg_get_functiondef('public.flip_season_status()'::regprocedure);
        a text := 'begin
  update public.seasons set status = ''active''';
        b text := 'begin
  /* v3.98: fix any movement deadline that has passed before anything reads it */
  perform public._latch_movement_deadlines();
  update public.seasons set status = ''active''';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.98: flip_season_status anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- 2. open offers: declined or withdrawn at any time; closed at the deadline if nobody answered ----------------------------
do $p$
declare v_def text := pg_get_functiondef('public.guard_trade_insert()'::regprocedure);
        a text := '     and not (tg_op = ''UPDATE'' and new.status = ''reversed''';
        b text := '     /* v3.98: declining or withdrawing an open offer moves nobody, so the deadline never refuses it */
     and not (tg_op = ''UPDATE'' and new.status in (''declined'', ''cancelled''))
     and not (tg_op = ''UPDATE'' and new.status = ''reversed''';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.98: guard_trade_insert anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

do $p$
declare v_def text := pg_get_functiondef('public.guard_trade_status()'::regprocedure);
        a text := '  if old.status = ''proposed'' and new.status = ''accepted'' and v_op = ''accept'' then return new; end if;';
        b text := '  /* v3.98: an offer nobody answered closes at the movement deadline (_deadline_sweep) */
  if old.status = ''proposed'' and new.status = ''cancelled'' and v_op = ''deadline'' then return new; end if;
  if old.status = ''proposed'' and new.status = ''accepted'' and v_op = ''accept'' then return new; end if;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.98: guard_trade_status anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

do $p$
declare v_def text := pg_get_functiondef('public.notify_trade_status()'::regprocedure);
        a text := '  elsif new.status = ''cancelled'' then';
        b text := '  elsif new.status = ''cancelled'' and coalesce(current_setting(''app.trade_op'', true), '''') = ''deadline'' then
    /* v3.98: closed at the movement deadline, not withdrawn by anybody; on the site only, like any closed offer */
    perform public.club_notify(new.from_team_id, ''trade'', ''Offer to the '' || coalesce(v_to,''other club'') || '' closed at the deadline'',
      ''Your offer of '' || v_off || '' for '' || v_req || '' was still open when the movement deadline passed, so it has closed (Rule 2.4).'', null, ''manager'', null, null, false);
    perform public.club_notify(new.to_team_id, ''trade'', ''Offer from the '' || coalesce(v_from,''other club'') || '' closed at the deadline'',
      ''Their offer of '' || v_off || '' for '' || v_req || '' was still open when the movement deadline passed, so it has closed (Rule 2.4).'', null, ''manager'', null, null, false);
  elsif new.status = ''cancelled'' then';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.98: notify_trade_status anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- 3 and 6. the trade block closes at the deadline; the join date and the pre-seat salary are the league's ----------------
create or replace function public.guard_roster_after_deadline()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  /* v3.98: the date a player joined the roster (the prorated playoff floor, the emergency goaltender exception) and the
     salary a manager held before the seat (Rule 2.6) are the league's record. The seat machinery writes the second
     under app.mgr_sync. */
  if (new.created_at is distinct from old.created_at or new.pre_seat_salary is distinct from old.pre_seat_salary)
     and not (public.is_commissioner() or public.trusted_writer() or coalesce(current_setting('app.mgr_sync', true), '') = '1') then
    raise exception 'A roster spot''s join date and pre-seat salary are kept by the league.' using errcode = '42501';
  end if;
  /* v3.98: the trade block closes with trades at the movement deadline (Rule 2.4). Taking a player off it never waits. */
  if new.on_block and not coalesce(old.on_block, false) and public.moves_locked(new.season_id)
     and not (public.is_commissioner() or public.trusted_writer()) then
    raise exception 'Rule 2.4: the trade block closed at the movement deadline, with trades. Listings reopen next season.'
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;
revoke execute on function public.guard_roster_after_deadline() from public, anon, authenticated;
drop trigger if exists a_guard_roster_after_deadline_trg on public.roster_spots;
create trigger a_guard_roster_after_deadline_trg
  before update of created_at, pre_seat_salary, on_block on public.roster_spots
  for each row
  when (old.created_at is distinct from new.created_at or old.pre_seat_salary is distinct from new.pre_seat_salary
        or (new.on_block and not coalesce(old.on_block, false)))
  execute function public.guard_roster_after_deadline();

-- 4. the approval queue refuses what the deadline closed --------------------------------------------------------------------
do $p$
declare v_def text := pg_get_functiondef('public.mgmt_request_move(text,text,jsonb,text)'::regprocedure);
        a text := '  v_page := d.o_page;';
        b text := '  /* v3.98: a move the movement deadline closed is refused when it is asked for, not when the Owner approves it */
  if public.moves_locked(public.current_season_id())
     and (p_action in (''waive_player'', ''trade_propose'', ''accept_trade'', ''offer_free_agent'')
          or (p_action = ''roster_block'' and coalesce((p_args->>''on_block'')::boolean, false))) then
    raise exception ''Rule 2.4: trades, signings, waivers and trade-block listings closed at the movement deadline.'' using errcode = ''check_violation'';
  end if;
  v_page := d.o_page;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.98: mgmt_request_move anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- 5. past the deadline, restoring or withdrawing a rostered player is a commissioner's ------------------------------------
do $p$
declare v_def text := pg_get_functiondef('public.reinstate_roster_spot(uuid)'::regprocedure);
        a text := '  if r.reinstated_at is not null then raise exception ''That removal has already been reinstated''; end if;';
        b text := '  if r.reinstated_at is not null then raise exception ''That removal has already been reinstated''; end if;
  /* v3.98: past the movement deadline this puts a player on a roster, which is a commissioner''s decision (Rule 2.4, v3.79) */
  if public.moves_locked(r.season_id) and not public.is_commissioner() then
    raise exception ''Rule 2.4: the movement deadline has passed for this season, so only a commissioner can put a removed player back on a roster.''
      using errcode = ''P0001'';
  end if;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.98: reinstate_roster_spot anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

do $p$
declare v_def text := pg_get_functiondef('public.office_withdraw_registration(uuid,text)'::regprocedure);
        a text := '  v_spot := v_club is not null;';
        b text := '  v_spot := v_club is not null;
  /* v3.98: past the movement deadline, taking a rostered player off a club is a commissioner''s decision (Rule 2.4, v3.79) */
  if v_spot and public.moves_locked(v_reg.season_id) and not public.is_commissioner() then
    raise exception ''Rule 2.4: the movement deadline has passed, so only a commissioner can withdraw a rostered player''''s sign-up (it takes the player off %).'', v_club
      using errcode = ''P0001'';
  end if;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v3.98: office_withdraw_registration anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- the sweep: what the deadline closed comes down, on its own job ------------------------------------------------------------
create or replace function public._deadline_sweep()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_s record; v_n int := 0; v_k int;
begin
  perform public._latch_movement_deadlines();
  for v_s in
    select s.id, s.movement_deadline_fixed as dl from public.seasons s
     where s.movement_deadline_fixed is not null and now() >= s.movement_deadline_fixed
       and s.status <> 'complete' and coalesce(s.moves_lock_override, 'auto') <> 'open'
  loop
    -- offers made before the deadline that nobody answered (an office trade made after it is left alone)
    perform set_config('app.trade_op', 'deadline', true);
    update public.trades set status = 'cancelled', updated_at = now()
     where season_id = v_s.id and status = 'proposed' and created_at < v_s.dl;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
    perform set_config('app.trade_op', '', true);
    -- the season's trade-block listings come down without a post (app.mgr_sync: a sync, not a member's move)
    perform set_config('app.mgr_sync', '1', true);
    update public.roster_spots set on_block = false where season_id = v_s.id and on_block;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
    perform set_config('app.mgr_sync', '', true);
    -- approval requests for moves the deadline closed (the queue serves the current season)
    if v_s.id = public.current_season_id() then
      update public.team_mgmt_moves
         set status = 'withdrawn', result = 'closed at the movement deadline (Rule 2.4)', decided_at = now()
       where status = 'pending'
         and (action in ('waive_player', 'trade_propose', 'accept_trade', 'offer_free_agent')
              or (action = 'roster_block' and coalesce((args->>'on_block')::boolean, false)));
      get diagnostics v_k = row_count; v_n := v_n + v_k;
    end if;
  end loop;
  insert into public.app_config(key, value) values ('rl_deadline_sweep', now()::text)
    on conflict (key) do update set value = excluded.value;
  return v_n;
end $function$;
revoke execute on function public._deadline_sweep() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'deadline-sweep';
select cron.schedule('deadline-sweep', '*/5 * * * *', 'select public._deadline_sweep()');

-- 7. the watchdog checks that the switch happened -------------------------------------------------------------------------
create or replace function public._watch_season_switch()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_s record; v_next record; v_dl timestamptz; v_why text; v_marker text; v_prev timestamptz; v_hook text;
begin
  select coalesce((select value from public.app_config where key = 'discord_ops_webhook'),
                  (select value from public.app_config where key = 'discord_updates_webhook')) into v_hook;
  for v_s in select * from public.seasons s where s.status = 'active' and s.trade_deadline_week is not null loop
    v_dl := public.movement_deadline_at(v_s.id);
    if v_dl is null or now() < v_dl + interval '20 minutes' then continue; end if;
    if coalesce(v_s.moves_lock_override, 'auto') = 'open' then continue; end if;   -- the office reopened movement on purpose
    select * into v_next from public.seasons n where n.number = v_s.number + 1;
    v_why := case
      when v_s.movement_deadline_fixed is null
        then 'the movement deadline passed but was not fixed, so moving a game could still move it'
      when v_s.registration_open
        then v_s.name || ' is still taking sign-ups after its movement deadline'
      when v_next.id is null or not v_next.registration_open
        then 'sign-ups for Season ' || (v_s.number + 1) || ' did not open at the movement deadline'
      when not exists (select 1 from public.app_config where key = 'ann_' || v_next.number || '_reg_open')
        then 'the Season ' || v_next.number || ' sign-ups post has not gone out to #signups'
      when exists (select 1 from public.trades t where t.season_id = v_s.id and t.status = 'proposed' and t.created_at < v_dl)
        then 'trade offers made before the movement deadline are still open'
      end;
    if v_why is null then continue; end if;
    v_marker := 'wd_season_switch_' || v_s.number;
    select nullif(value, '')::timestamptz into v_prev from public.app_config where key = v_marker;
    if v_prev is null or now() - v_prev > interval '6 hours' then
      perform public.notify_commissioners(null, 'flag', 'Movement deadline: the switch is incomplete',
        v_why || '. Check the Seasons page and #signups.', 'automations', null);
      if v_hook is not null then
        perform public.discord_http_post(url := v_hook, headers := '{"Content-Type":"application/json"}'::jsonb,
          body := jsonb_build_object('content', left('⚠️ Movement deadline: ' || v_why || '.', 1800)));
      end if;
      insert into public.app_config(key, value) values (v_marker, now()::text)
        on conflict (key) do update set value = excluded.value;
    end if;
  end loop;
end $function$;
revoke execute on function public._watch_season_switch() from public, anon, authenticated;

do $p$
declare v_def text := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
        a text := '      (''season-status-flip'', interval ''1 hour''),';
        b text := '      (''season-status-flip'', interval ''1 hour''),
      (''deadline-sweep'', interval ''1 hour''),';
        c text := '  -- own heartbeat';
        d text := '  -- 6) v3.98: the movement deadline switch actually happened (fixed, sign-ups switched, post out, offers closed)
  begin
    perform public._watch_season_switch();
  exception when others then
    perform public.notify_commissioners(null, ''flag'', ''Watchdog: the season switch check failed'', left(sqlerrm, 300), ''automations'', null);
  end;

  -- own heartbeat';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1
     or (length(v_def) - length(replace(v_def, c, ''))) / length(c) <> 1 then raise exception 'v3.98: automation_watchdog anchors'; end if;
  execute replace(replace(v_def, a, b), c, d);
end $p$;

do $chk$
begin
  if position('movement_deadline_fixed' in pg_get_functiondef('public.movement_deadline_at(uuid)'::regprocedure)) = 0
     or position('_latch_movement_deadlines' in pg_get_functiondef('public.flip_season_status()'::regprocedure)) = 0
     or position('_watch_season_switch' in pg_get_functiondef('public.automation_watchdog()'::regprocedure)) = 0
     or not exists (select 1 from cron.job where jobname = 'deadline-sweep' and active) then
    raise exception 'v3.98: not every piece is in place';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and grantee in ('PUBLIC', 'anon', 'authenticated')
                and routine_name in ('_latch_movement_deadlines', '_deadline_sweep', '_watch_season_switch', 'guard_roster_after_deadline')) then
    raise exception 'v3.98: an internal function is executable by members';
  end if;
end $chk$;
