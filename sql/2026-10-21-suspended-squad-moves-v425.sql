-- v4.25 (2026-10-21): a suspended player moves between the active roster and training camp like any other player, and
-- may be traded, but may not be waived while the suspension runs.
-- Commissioner, 2026-10-21: "allow suspended players to be moved between training camp and the active roster, or
-- traded but not waived."
--
-- Before: v3.51 locked a running playing suspension in place on the roster (guard_squad_move refused any squad change
-- for a non-commissioner), v4.18 already let a suspended player be traded (no change needed here), and nothing stopped
-- a club from waiving one (waive_player only checked whether the MANAGER was suspended).
-- After:
--   1. guard_squad_move no longer refuses a suspended player. Every other check on the trigger stays: management never
--      goes to camp (Rule 2.6), the weekly freeze (Rule 2.1), the camp limit, the move counter.
--   2. waive_player refuses a player whose playing suspension is running (public.is_suspended, the one definition). It
--      binds the league office too: Rule 2.6 says a commissioner in Team HQ makes "any move the club could make", and a
--      limit on the player is not a clock. The office keeps its own removal doors (Rule 7.2 removal for a season-long
--      suspension or a ban, the office's roster removal), which are not waivers.
--   3. mgmt_request_move refuses the same waiver when it is asked for, not when the Owner approves it (the v3.98
--      pattern), so a GM never queues a move that can only fail. The approval executor still runs waive_player, so the
--      guard in (2) binds that path; part c below puts the same bar on the delete trigger for every other door.
-- All three are CREATE OR REPLACE (grants kept) and move to search_path '' (every name was already schema-qualified).
-- A season-long suspension or a ban still removes the player from the roster (v3.85, _remove_for_discipline); this
-- change is about game-count and date suspensions, the ones that leave the player on the roster.

-- 1) the squad trigger: the suspension lock is lifted --------------------------------------------------------------
create or replace function public.guard_squad_move()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_camp int;
begin
  if NEW.squad is not distinct from OLD.squad then return NEW; end if;
  /* v3.61 (Q29): an Owner, GM or AGM holds an active-roster spot for as long as he holds the seat. No one,
     the league office included, sends him to camp; the seat ends first (Rule 2.6). */
  if NEW.squad = 'tc' and exists (select 1 from public.teams t where t.id = NEW.team_id
       and NEW.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id)) then
    raise exception 'Rule 2.6: % holds a management seat and stays on the active roster. Management is never sent to training camp.',
      coalesce((select gamertag from public.profiles where id = NEW.profile_id), 'This player')
      using errcode = 'check_violation';
  end if;
  /* v3.51 (commissioner, 2026-09-28) locked a suspended player where he was on the roster, as a punishment to the
     club, until the suspension was served. v4.25 (commissioner, 2026-10-21: "allow suspended players to be moved
     between training camp and the active roster, or traded but not waived") lifts that lock: a suspended player is
     called up and sent down like any other, and the bar moved to the waiver (public.waive_player). The suspension
     still keeps him off every lineup and line (guard_lineup_suspended). */
  /* v3.40: the weekly roster movement freeze (Rule 2.1). It sits on the TRIGGER, not on
     set_roster_squad and swap_roster_squad, so both doors and any added later are covered by one
     definition. A commissioner and the league's own automation pass: the freeze is a rule for clubs,
     and an automated release or placement must not be blocked by the day of the week. */
  if public.roster_freeze_at() and not (public.is_commissioner() or public.trusted_writer()) then
    raise exception 'Rule 2.1: the roster is frozen from Wednesday 7:30 PM until Friday midnight ET. Call-ups and send-downs reopen % ET.',
      to_char(public.roster_freeze_ends_at() at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM')
      using errcode = 'check_violation';
  end if;
  -- Rule 2.1: the camp limit (camp_max: 10 in the basic format since v3.58)
  if NEW.squad = 'tc' then
    select count(*) into v_camp from public.roster_spots rs
      where rs.season_id = NEW.season_id and rs.team_id = NEW.team_id
        and rs.squad = 'tc' and rs.status = 'active' and rs.id <> NEW.id;
    if v_camp >= public.camp_max(NEW.season_id) then
      raise exception 'Rule 2.1: training camp is full. A club carries at most % players in camp, so call someone up or waive a camp player first.', public.camp_max(NEW.season_id)
        using errcode = 'check_violation';
    end if;
  end if;
  -- v2.30: squad changes are unlimited. The counter is a record of the season, not a limit.
  NEW.squad_moves := coalesce(OLD.squad_moves,0) + 1;
  insert into public.squad_move_history(season_id, team_id, profile_id, moves)
    values (NEW.season_id, NEW.team_id, NEW.profile_id, NEW.squad_moves)
    on conflict (season_id, team_id, profile_id) do update set moves = excluded.moves;
  return NEW;
end $function$;

-- 2) the waiver: a suspended player cannot be waived ---------------------------------------------------------------
create or replace function public.waive_player(p_profile uuid)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_team record; v_season record; v_name text; v_n int; v_why text;
begin
  /* v3.76: a commissioner acts for the club the player is on (Team HQ, any club); a manager for his own seat */
  if public.is_commissioner() then
    select t.* into v_team from public.teams t join public.roster_spots rs on rs.team_id = t.id
     where rs.season_id = public.current_season_id() and rs.profile_id = p_profile
     limit 1;
    if v_team.id is null then raise exception 'That player is not on a club''s roster this season.'; end if;
  else
    select t.* into v_team from public.teams t
      where t.owner_profile_id = auth.uid() or t.gm_profile_id = auth.uid() or t.agm_profile_id = auth.uid()
      limit 1;
    if v_team.id is null then raise exception 'Only club management can waive players.'; end if;
  end if;
  perform public.mgmt_gate(v_team.id, 'roster');
  if public.is_suspended(auth.uid()) then raise exception 'Suspended managers cannot make roster moves.'; end if;
  select * into v_season from public.seasons where id = public.current_season_id();
  if v_season.id is null then raise exception 'No active season.'; end if;
  if not exists (select 1 from public.roster_spots rs where rs.season_id = v_season.id and rs.team_id = v_team.id and rs.profile_id = p_profile) then
    raise exception 'That player is not on your roster.';
  end if;
  /* v4.25 (commissioner, 2026-10-21: "allow suspended players to be moved between training camp and the active
     roster, or traded but not waived"): a player whose playing suspension is running cannot be waived, so a club
     cannot shed the player and the suspension together. It binds the league office as well (Rule 2.6: the office
     makes any move the club could make, and this is a limit on the player, not a clock). */
  if public.is_suspended(p_profile) then
    raise exception 'Rule 7.2: % is suspended and cannot be waived until the suspension is served. The club may still move them between the active roster and training camp, or trade them.',
      coalesce((select nullif(gamertag, '') from public.profiles where id = p_profile), 'This player')
      using errcode = 'check_violation';
  end if;
  /* Rule 2.4 minimum service (v2.74); v3.79: it binds the club's own management, never the league office */
  if not public.is_commissioner() then
    v_why := public.can_move_player(v_season.id, p_profile);
    if v_why is not null then raise exception '%', v_why; end if;
  end if;

  perform set_config('app.roster_reason', 'waived', true);
  delete from public.roster_spots
    where season_id = v_season.id and team_id = v_team.id and profile_id = p_profile;
  get diagnostics v_n = row_count;
  perform set_config('app.roster_reason', '', true);
  if v_n = 0 then raise exception 'That player is not on your roster.'; end if;

  perform set_config('app.role_grant','on',true);
  /* v3.06: stamp the waiver. Without it a waived player is indistinguishable from an undrafted
     one, and the post-draft sweep hands him straight back to a club (it did, twice, within
     seconds). He is a free agent now and waits for a club to sign him (Rule 2.2). */
  update public.season_registrations set status = 'pending', waived_at = now()
    where season_id = v_season.id and profile_id = p_profile;

  select coalesce(gamertag, display_name, 'a player') into v_name from public.profiles where id = p_profile;
  perform set_config('app.role_grant','',true);
  insert into public.transactions (season_id, type, description)
    values (v_season.id, 'waive', v_team.name || ' waived <b>' || replace(replace(v_name,'<',''),'>','') || '</b>');
  return v_name;
end $function$;

-- 3) the approval queue: the same waiver is refused when it is asked for -------------------------------------------
create or replace function public.mgmt_request_move(p_team_code text, p_action text, p_args jsonb, p_summary text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_team uuid; v_club text; v_owner uuid; v_page text; v_mode text; v_id uuid; v_who text; d record;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if public.is_suspended(auth.uid()) then raise exception 'Suspended managers cannot make roster moves.'; end if;
  select id, name, owner_profile_id into v_team, v_club, v_owner from public.teams where upper(code) = upper(p_team_code);
  if v_team is null then raise exception 'Club not found: %', p_team_code; end if;
  if public.mgmt_access(v_team, 'roster') = 'none' then raise exception 'Only this club''s management can make its moves.'; end if;
  /* v4.25 (Rule 7.2): a suspended player cannot be waived, so the request is refused now rather than queued for an
     Owner whose approval could only fail in waive_player */
  if p_action = 'waive_player' and public.is_suspended(nullif(p_args->>'p_profile', '')::uuid) then
    raise exception 'Rule 7.2: % is suspended and cannot be waived until the suspension is served. The club may still move them between the active roster and training camp, or trade them.',
      coalesce((select nullif(gamertag, '') from public.profiles where id = nullif(p_args->>'p_profile', '')::uuid), 'This player')
      using errcode = 'check_violation';
  end if;
  select * into d from public._mgmt_describe(v_team, p_action, coalesce(p_args, '{}'::jsonb));
  /* v3.98: a move the movement deadline closed is refused when it is asked for, not when the Owner approves it.
     v4.17: signings and releases have their own close (public.fa_moves_closed), which may come first (Rule 2.4) */
  if public.moves_locked(public.current_season_id())
     and (p_action in ('trade_propose', 'accept_trade')
          or (p_action = 'roster_block' and coalesce((p_args->>'on_block')::boolean, false))) then
    raise exception 'Rule 2.4: trades and trade-block listings closed at the movement deadline.' using errcode = 'check_violation';
  end if;
  if public.fa_moves_closed(public.current_season_id()) and p_action in ('waive_player', 'offer_free_agent') then
    raise exception 'Rule 2.4: signings and releases have closed for this season.' using errcode = 'check_violation';
  end if;
  v_page := d.o_page;
  v_mode := public.mgmt_access(v_team, v_page);
  if v_mode = 'hidden' then raise exception 'The Owner has not given your seat access to %.', public.mgmt_page_label(v_page); end if;
  if v_mode <> 'approve' then raise exception 'This move does not need the Owner''s approval — make it directly.'; end if;
  if v_owner is null then raise exception 'This club has no Owner to approve moves — the league office has been asked to seat one.'; end if;
  -- a newer request for the same thing (this lineup, this line, this player's block flag, the board…) replaces the older one still waiting
  if d.o_target is not null then
    update public.team_mgmt_moves set status = 'withdrawn', result = 'superseded by a newer request', decided_at = now()
      where team_id = v_team and status = 'pending' and requested_by = auth.uid() and target = d.o_target;
  end if;
  insert into public.team_mgmt_moves(team_id, page, action, args, summary, requested_by, target)
    values (v_team, v_page, p_action, coalesce(p_args, '{}'::jsonb), d.o_summary, auth.uid(), d.o_target) returning id into v_id;
  select coalesce(nullif(gamertag,''), display_name, 'Your manager') into v_who from public.profiles where id = auth.uid();
  perform public.create_notification(v_owner, 'request', 'Approval needed — ' || left(d.o_summary, 120),
    v_who || ' wants to ' || left(d.o_summary, 240) || '. Approve or deny it from Team HQ → Management.', 'mgmtapprovals', null);
  return v_id;
end $function$;

-- 4) self-checks: raise when the result is not what this file meant ------------------------------------------------
do $chk$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.guard_squad_move()'::regprocedure);
  if position('is_suspended' in v_def) > 0 then raise exception 'v4.25 check: guard_squad_move still reads is_suspended'; end if;
  if position('Management is never sent to training camp' in v_def) = 0 or position('roster_freeze_at()' in v_def) = 0
     or position('camp_max(NEW.season_id)' in v_def) = 0 or position('squad_move_history' in v_def) = 0 then
    raise exception 'v4.25 check: guard_squad_move lost one of its other checks';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'guard_squad_move_trg' and tgrelid = 'public.roster_spots'::regclass and not tgisinternal) then
    raise exception 'v4.25 check: guard_squad_move_trg is not on roster_spots';
  end if;
  v_def := pg_get_functiondef('public.waive_player(uuid)'::regprocedure);
  if position('if public.is_suspended(p_profile) then' in v_def) = 0 then raise exception 'v4.25 check: waive_player has no suspended-player guard'; end if;
  if position('is_suspended(p_profile)' in v_def) > position('delete from public.roster_spots' in v_def) then
    raise exception 'v4.25 check: the waive guard must run before the delete';
  end if;
  v_def := pg_get_functiondef('public.mgmt_request_move(text,text,jsonb,text)'::regprocedure);
  if position('p_action = ''waive_player'' and public.is_suspended' in v_def) = 0 then raise exception 'v4.25 check: mgmt_request_move has no waive guard'; end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('guard_squad_move', 'waive_player', 'mgmt_request_move')) <> 3 then
    raise exception 'v4.25 check: an overload appeared';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('guard_squad_move', 'waive_player', 'mgmt_request_move')
             and not ('search_path=""' = any(proconfig))) then
    raise exception 'v4.25 check: a function kept a non-empty search_path';
  end if;
  if not has_function_privilege('authenticated', 'public.waive_player(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.mgmt_request_move(text,text,jsonb,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.waive_player(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mgmt_request_move(text,text,jsonb,text)', 'EXECUTE') then
    raise exception 'v4.25 check: waive_player or mgmt_request_move grants changed';
  end if;
end $chk$;

/* REHEARSAL (2026-10-21, 1:10 PM ET, one transaction on the live database, rolled back by a closing raise; outside the
   weekly freeze). Subjects: Tager x 72 (NYI LW on the active roster, a games suspension running), DaBallerTv (NYI camp
   LW), the NYI Owner (a member, not a commissioner), a commissioner, and Pip (NYI RW, not suspended) as the control.
   T0 preconditions: Tager suspended and on the active roster, the control not suspended, no freeze, Owner not office.
   T1 as the Owner, set_roster_squad(Tager -> camp) is refused with "training camp is full" (NYI camp 10 of 10) and
      never with Rule 7.2: the suspension lock is gone and the camp limit still binds.
   T2 as the Owner, swap_roster_squad(Tager, DaBallerTv) goes through: Tager in camp, DaBallerTv on the active roster,
      Tager's squad_moves counter +1.
   T3 as the Owner, waive_player(Tager) is refused: "cannot be waived until the suspension is served"; spot kept.
   T4 as a commissioner, waive_player(Tager) is refused the same way.
   T5 as the Owner, mgmt_request_move('NYI', 'waive_player', {p_profile: Tager}) is refused the same way, before
      anything is queued.
   T6 control: a commissioner waives Pip (not suspended): the spot is deleted and waived_at stamped (pass undone with
      ZZ001).
   T7 guard_lineup_suspended still reads is_suspended: a suspended player still cannot be scheduled.
   The $chk$ block passed inside the same transaction.
   Result: REHEARSAL OK: T0 T1 T2 T3 T4 T5 T6 T7.
   Afterward: guard_squad_move and waive_player still held their old definitions, Tager was still on the active roster,
   DaBallerTv still in camp and Pip still rostered, so nothing stuck.
   Applied as migration v425_suspended_squad_moves; tools/sql/grant-audit.sql returned zero rows. */

-- ================================================================================================================
-- Part b (migration v425b_suspension_notice_text): the two notices a suspension sends still described the lifted
-- lock. notify_suspension told the member "your club cannot move you between its roster and training camp", and
-- pull_suspended_from_lineups told the club "he is locked where he is on your roster: he cannot be called up or sent
-- down meanwhile". Both now say what Rule 7.2 says: the club may still move or trade the player but may not waive them.
-- Patched by text replacement on the live definitions, each anchor asserted to match exactly once.
do $patch$
declare v_def text; v_new text; a text; b text; n int; i int;
  anchors text[]; repl text[];
begin
  v_def := pg_get_functiondef('public.notify_suspension()'::regprocedure);
  a := ', and your club cannot move you between its roster and training camp.''';
  b := '. Your club may still move you between its roster and training camp or trade you, but may not waive you while it runs.''';
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.25b: notify_suspension anchor found % times', n; end if;
  execute replace(v_def, a, b);

  v_new := pg_get_functiondef('public.pull_suspended_from_lineups()'::regprocedure);
  anchors := array[
    ''' may not be scheduled or play until his suspension is served, and he is locked where he is on ''||',
    '''your roster: he cannot be called up or sent down meanwhile (Rule 7.2).''||',
    'then '' He was taken off ''||'];
  repl := array[
    ''' may not be scheduled or play until their suspension is served. They may still be called up, sent down ''||',
    '''or traded, but your club may not waive them until it is served (Rule 7.2).''||',
    'then '' They were taken off ''||'];
  for i in 1 .. array_length(anchors, 1) loop
    n := (length(v_new) - length(replace(v_new, anchors[i], ''))) / length(anchors[i]);
    if n <> 1 then raise exception 'v4.25b: pull_suspended_from_lineups anchor % found % times', i, n; end if;
    v_new := replace(v_new, anchors[i], repl[i]);
  end loop;
  execute v_new;
end $patch$;

do $chk$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.notify_suspension()'::regprocedure);
  if position('cannot move you between its roster' in v_def) > 0 or position('but may not waive you while it runs' in v_def) = 0 then
    raise exception 'v4.25b check: notify_suspension text';
  end if;
  v_def := pg_get_functiondef('public.pull_suspended_from_lineups()'::regprocedure);
  if position('locked where he is' in v_def) > 0 or position('cannot be called up or sent down' in v_def) > 0
     or position('your club may not waive them until it is served (Rule 7.2)' in v_def) = 0 then
    raise exception 'v4.25b check: pull_suspended_from_lineups text';
  end if;
  if (select count(*) from pg_trigger where tgfoid in ('public.notify_suspension()'::regprocedure, 'public.pull_suspended_from_lineups()'::regprocedure)
        and tgrelid = 'public.suspensions'::regclass and not tgisinternal) < 2 then
    raise exception 'v4.25b check: a suspension trigger is missing';
  end if;
end $chk$;

/* REHEARSAL (part b, 2026-10-21, one transaction on the live database with the patch and the $chk$ block, rolled back
   by a closing raise): as a commissioner, _issue_suspension gave Pip (NYI, not suspended) a 3-game playing suspension.
   T1 the suspension started (is_suspended true).
   T2 Pip's site notice reads "... Your club may still move you between its roster and training camp or trade you, but
      may not waive you while it runs." and no longer "cannot move you".
   T3 the queued Discord DM (discord_dms, kind suspension) carries the same sentence.
   T4 the managers' notice (club_notify with the room off lands in the seats' notifications, here the NYI Owner's)
      reads: "Pip may not be scheduled or play until their suspension is served. They may still be called up, sent down
      or traded, but your club may not waive them until it is served (Rule 7.2)." with no "locked".
   Result: REHEARSAL OK: T1 T2 T3 T4(owner notification).
   Afterward both functions still held their old text, Pip was not suspended, and no rehearsal suspension or DM row
   existed, so nothing stuck and nothing was sent (pg_net and the bot's queues only see committed rows).
   Applied as migration v425b_suspension_notice_text; tools/sql/grant-audit.sql returned zero rows. */

-- ================================================================================================================
-- Part c (migration v425c_waiver_bar_on_the_trigger), from the read-only review of parts a and b:
--   1. The waiver bar lived only in the RPCs. A seat holder's own JWT can still DELETE a roster row through the RLS
--      policy "gm deletes own team roster" (audit F-2-18, still open), which skips waive_player. Every BEFORE DELETE
--      trigger let a suspended player go. The bar now also sits on guard_roster_waive, the delete trigger, so every
--      door is covered by one definition (the v3.40 freeze pattern). A waiver (app.roster_reason 'waived') is refused
--      for everyone; any other delete is refused when a signed-in member who is neither a commissioner nor the league's
--      automation makes it. The office's removal doors (app.office_removal, or a commissioner: admin_remove_from_roster,
--      draft_reverse_pick, ban_player) and unattended jobs (no signed-in user: preseason_release_loans) are not waivers
--      and pass. Cascades from deleting a profile, season or club are office or system acts and pass the same way.
--   2. notify_suspension's part b sentence ("Your club may still move you ... or trade you, but may not waive you")
--      was wrong for two members: one suspended for the rest of a season, who is removed from the roster (the notice
--      fires before the removal trigger, so it cannot read the roster), and one who holds no roster spot. Each now
--      gets its own sentence.
--   3. guard_squad_move's v4.25 comment used he/him for a player; re-created with they/them (no behavior change).
create or replace function public.guard_roster_waive()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v3.11 — a league-office removal is not a club waive. This guard exists to stop CLUBS shedding
   players once moves are locked; it let a commissioner through and nothing else, so the Rule 1.1
   departure sweep (which runs as the service role, not as a person) would have been blocked at
   the trade deadline, silently leaving departed members on rosters exactly when a spot matters
   most. The bypass is one named, transaction-local flag, set only by that sweep. */
begin
  if coalesce(current_setting('app.office_removal', true), '') = '1' then return old; end if;
  /* v4.25 (commissioner, 2026-10-21: "allow suspended players to be moved between training camp and the active
     roster, or traded but not waived"): a suspended player cannot be waived. The bar is here as well as in
     waive_player because a seat holder's own JWT can delete a roster row directly (policy "gm deletes own team
     roster"), which skips the RPC. A waiver is refused for everyone, the league office included (Rule 2.6); any other
     delete only when a signed-in member who is neither a commissioner nor the league's automation makes it, so the
     office's removal doors and unattended jobs (no signed-in user) still work. */
  if public.is_suspended(old.profile_id)
     and (coalesce(current_setting('app.roster_reason', true), '') = 'waived'
          or (auth.uid() is not null and not (public.is_commissioner() or public.trusted_writer()))) then
    raise exception 'Rule 7.2: % is suspended and cannot be waived until the suspension is served. The club may still move them between the active roster and training camp, or trade them.',
      coalesce((select nullif(gamertag, '') from public.profiles where id = old.profile_id), 'This player')
      using errcode = 'check_violation';
  end if;
  /* v4.17: releases close with signings (public.fa_moves_closed), which may come before the movement deadline:
     Season 1's closed at the original deadline while trades ran to the extended one (Rule 2.4) */
  if public.fa_moves_closed(old.season_id) and not public.is_commissioner() then
    raise exception 'Rule 2.4: releases have closed for this season, so a club cannot waive players now.';
  end if;
  return old;
end $function$;

do $patch$
declare v_def text; a text; b text; n int;
begin
  v_def := pg_get_functiondef('public.notify_suspension()'::regprocedure);
  a := $a$else 'While it runs you may not be scheduled, dress or play, appear in a league lobby, or act as your club''s point of contact. Your club may still move you between its roster and training camp or trade you, but may not waive you while it runs.' end end;$a$;
  b := $b$when new.mode = 'seasons'
                   then 'While it runs you may not be scheduled, dress or play, or appear in a league lobby. A suspension for the rest of a season also takes you off your club''s roster and out of any front-office seat, and withdraws your sign-ups (Rule 7.2).'
                   when not exists (select 1 from public.roster_spots rs where rs.profile_id = new.profile_id and rs.season_id = public.current_season_id())
                   then 'While it runs you may not be scheduled, dress or play, or appear in a league lobby, and no club may sign you (Rule 7.2).'
                   else 'While it runs you may not be scheduled, dress or play, appear in a league lobby, or act as your club''s point of contact. Your club may still move you between its roster and training camp or trade you, but may not waive you while it runs.' end end;$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.25c: notify_suspension anchor found % times', n; end if;
  execute replace(v_def, a, b);
end $patch$;

do $patch2$
declare v_def text; a text; b text; n int;
begin
  v_def := pg_get_functiondef('public.guard_squad_move()'::regprocedure);
  a := $a$  /* v3.51 (commissioner, 2026-09-28) locked a suspended player where he was on the roster, as a punishment to the
     club, until the suspension was served. v4.25 (commissioner, 2026-10-21: "allow suspended players to be moved
     between training camp and the active roster, or traded but not waived") lifts that lock: a suspended player is
     called up and sent down like any other, and the bar moved to the waiver (public.waive_player). The suspension
     still keeps him off every lineup and line (guard_lineup_suspended). */$a$;
  b := $b$  /* v3.51 (commissioner, 2026-09-28) locked a suspended player where they were on the roster, as a punishment to the
     club, until the suspension was served. v4.25 (commissioner, 2026-10-21: "allow suspended players to be moved
     between training camp and the active roster, or traded but not waived") lifts that lock: a suspended player is
     called up and sent down like any other, and the bar moved to the waiver (public.waive_player and the delete
     trigger public.guard_roster_waive). The suspension still keeps them off every lineup and line
     (guard_lineup_suspended). */$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.25c: guard_squad_move comment anchor found % times', n; end if;
  execute replace(v_def, a, b);
end $patch2$;

do $chk$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.guard_roster_waive()'::regprocedure);
  if position('if public.is_suspended(old.profile_id)' in v_def) = 0
     or position('if public.is_suspended(old.profile_id)' in v_def) > position('public.fa_moves_closed(old.season_id)' in v_def)
     or position('app.office_removal' in v_def) > position('if public.is_suspended(old.profile_id)' in v_def) then
    raise exception 'v4.25c check: guard_roster_waive order (office bypass, suspended bar, release close)';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.roster_spots'::regclass and tgfoid = 'public.guard_roster_waive()'::regprocedure
                 and not tgisinternal and (tgtype & 2) = 2 and (tgtype & 8) = 8) then
    raise exception 'v4.25c check: guard_roster_waive is not a BEFORE DELETE trigger on roster_spots';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.guard_roster_waive()'::regprocedure and 'search_path=""' = any(proconfig)) then
    raise exception 'v4.25c check: guard_roster_waive search_path';
  end if;
  v_def := pg_get_functiondef('public.notify_suspension()'::regprocedure);
  if position('when new.mode = ''seasons''' in v_def) = 0 or position('no club may sign you (Rule 7.2)' in v_def) = 0
     or position('but may not waive you while it runs' in v_def) = 0 then
    raise exception 'v4.25c check: notify_suspension branches';
  end if;
  v_def := pg_get_functiondef('public.guard_squad_move()'::regprocedure);
  if position('where he was' in v_def) > 0 or position('keeps him off' in v_def) > 0 or position('is_suspended' in v_def) > 0 then
    raise exception 'v4.25c check: guard_squad_move comment or lock';
  end if;
end $chk$;

/* REHEARSAL (part c, 2026-10-21, one transaction on the live database with the three changes and the $chk$ block,
   rolled back by a closing raise; releases are closed for Season 1, which T2 and T5 use as their control):
   T0 preconditions: Tager suspended, Pip not, releases closed.
   T1 as the NYI Owner, a direct DELETE of Tager's roster row through RLS (the door that skips waive_player) is refused
      by the trigger: "cannot be waived until the suspension is served"; the row stays.
   T2 control: the same direct DELETE of Pip meets only the release close ("releases have closed"), never Rule 7.2.
   T3 a commissioner deleting Tager's row as a waiver (app.roster_reason 'waived') is refused at the trigger.
   T4 a commissioner's removal (no waiver reason, the admin_remove_from_roster shape) still deletes the row (undone).
   T5 an unattended job (no claims) is not refused for the suspension, only by the pre-existing release close.
   T6 a season-long suspension (Pip) sends "... also takes you off your club's roster and out of any front-office seat,
      and withdraws your sign-ups (Rule 7.2)." and not "may still move you" (undone).
   T7 a date suspension of a member with no roster spot (Emilio963) sends "... and no club may sign you (Rule 7.2)."
      with no club sentence (undone).
   T8 a games suspension of a rostered player (Pip) keeps the part b sentence (undone).
   Result: REHEARSAL OK: T0 T1 T2 T3 T4 T5 T6 T7 T8.
   Afterward guard_roster_waive, notify_suspension and guard_squad_move still held their old definitions, Tager was
   still rostered, Pip and Emilio963 were not suspended, and no rehearsal suspension row existed.
   Applied as migration v425c_waiver_bar_on_the_trigger; tools/sql/grant-audit.sql returned zero rows. */
