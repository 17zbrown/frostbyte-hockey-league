-- Rehearsal for sql/2026-11-24-s2-staff-copy-v463.sql AND its reverse, sql/2026-11-24-s2-staff-copy-v463.reverse.sql.
-- The main session runs it on production as ONE transaction that ends in an uncaught raise, so everything rolls back
-- (CLAUDE.md, Database change protocol step 2). Agents never run it. It carries the texts byte for byte
-- (tools/s2-staff-copy-v463.test.cjs pins them): the copy record refuses to run before the staff powers and all-staff
-- voting records (the fixed apply order), and neither is live before the flip, so their texts come first, in that order.
--
-- Prerequisites: the committees record (v4.59) is live (it is since 2026-11-24). Run it after the staff powers and the
-- all-staff voting rehearsals.
--
-- After it (outside the transaction), these must all return nothing:
--   select 1 where position('the Draft and Bidding manager.' in pg_get_functiondef('public.draft_pause(integer)'::regprocedure)) > 0;
--   select id from public.staff_applications where pitch = 'Rehearsal copy pitch.';
--   select 1 where to_regprocedure('public.profile_has_department(uuid,text)') is not null;
--
-- People, picked inside the transaction by id order (no ids in this file): K the first commissioner; N the first staff
-- member who is not banned, not suspended from staff duties and holds no committee seat; X the first member who is not
-- banned; M the first member who is not banned, holds no club seat and has no staff application.
-- Cases:
--   C0 the twenty-five functions this record owns are fingerprinted before anything runs.
--   C1 X, a member, is refused by nine doors in the new words (the league staff or a commissioner).
--   C2 N, a staff member without the Draft and Bidding seat, is refused the draft room in the new words, and is told
--      that league staff vote on applications and only a commissioner overrides the staff vote.
--   C3 M files a staff application through the table door, K denies it alone, and M is told the league office did not
--      approve it (apply_application_decision's new words reach the member).
--   C4 after the copy reverse: the fingerprint is back and the draft room names the draft department again.

begin;

do $pre$
begin
  if to_regprocedure('public.is_committee_manager(uuid,text)') is null or to_regprocedure('public.is_staff_voter(uuid)') is null then
    raise exception 'REHEARSAL CANNOT RUN: the committees record (v4.59) must be live';
  end if;
end $pre$;

-- C0 and the people
do $p$
declare v_k uuid; v_n uuid; v_x uuid; v_m uuid;
begin
  perform set_config('rh.fp', md5((select string_agg(pg_get_functiondef(f::regprocedure), '|' order by f) from unnest(array['public.reverse_trade(uuid,text)', 'public.resend_trade(uuid)', 'public.guard_trade_status()',
      'public.apply_application_decision(text,uuid,boolean)', 'public.owner_remove_manager(text,text)', 'public.draft_pause(integer)',
      'public.draft_resume(integer)', 'public.draft_reset_clock(integer,integer)', 'public.draft_skip_pick(integer)',
      'public.declare_forfeit(uuid,uuid,boolean)', 'public.ops_exempt_game_limits(uuid,boolean,text)',
      'public.ops_reschedule_game(uuid,timestamptz)', 'public.ops_set_limit_week(uuid,integer,text)',
      'public.rankings_set_order(text[])', 'public.rankings_clear()', 'public.check_suspended_appearances(uuid)',
      'public.strip_roles_on_departure()', 'public.guard_mgmt_nominee()', 'public._mgmt_nominee_seat_block(uuid,text,uuid)',
      'public.staff_vote_cast(uuid,text,text)', 'public.set_owner_app_club(uuid,text)',
      'public.decide_owner_application(uuid,boolean,text)', 'public.guard_app_insert()',
      'public.override_application_decision(text,uuid,boolean)', 'public._owner_app_autoplace(uuid)']) f)), true);
  select p.id into v_k from public.profiles p where p.role = 'commissioner' order by p.id limit 1;
  select p.id into v_n from public.profiles p where p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id)
     and public.committee_of(p.id) = '{}'::text[] order by p.id limit 1;
  select p.id into v_x from public.profiles p where p.role = 'member' and not p.banned order by p.id limit 1;
  select p.id into v_m from public.profiles p where p.role = 'member' and not p.banned and not public.holds_club_seat(p.id)
     and not exists (select 1 from public.staff_applications sa where sa.profile_id = p.id) order by p.id limit 1;
  if v_k is null or v_n is null or v_x is null or v_m is null then
    raise exception 'REHEARSAL CANNOT RUN: the people are missing (K %, N %, X %, M %)', v_k is not null, v_n is not null, v_x is not null, v_m is not null;
  end if;
  perform set_config('rh.k', v_k::text, true);
  perform set_config('rh.n', v_n::text, true);
  perform set_config('rh.x', v_x::text, true);
  perform set_config('rh.m', v_m::text, true);
  perform set_config('rh.snum', (select se.number::text from public.seasons se where se.id = public.current_season_id()), true);
end $p$;

-- >>> staff powers record text: sql/2026-11-24-s2-staff-powers-v463.sql
-- v463 (DRAFT, 2026-11-24; apply at the flip, T+15, together with the all-staff voting record, never before): Season 2
-- staff powers. One staff group with committee managers in place of departments: every department gate opens to the whole
-- staff, the draft and bidding tools stay with the Draft and Bidding manager and the commissioners, only committee
-- managers and commissioners suspend (up to 14 days or 18 games; longer is applied for and a commissioner approves it),
-- every automated staff notice goes to one channel, and bans, unbans and lifts get a staff notice.
--
-- The rulings (memory s2-staffing-model.md, league law):
--  * Commissioner, 2026-10-19: "for Season 2, we will remove the different departments, and we will allow every staff
--    member to be a part of one big group. ... everyone can do any staff role for the most part."
--  * 2026-10-22: "remove the Media staff position from the concept since we will not have that role next season."
--    Stories are any staffer's; the awards ballot loses its Media clause.
--  * 2026-11-23: committee managers have NO extra powers, except the Draft and Bidding manager, who manages Saturday
--    bidding, pauses and resumes it, and has the draft and bidding page tools (commissioners too).
--  * 2026-11-23 (late), discipline from the swap: only COMMITTEE MANAGERS or COMMISSIONERS may issue any suspension. A
--    committee manager may issue up to 14 days, or up to 18 games for a rostered player ("2 weeks worth of games").
--    Anything longer is APPLIED FOR and must be approved by a commissioner. Other staff file a suspension request. Bans
--    stay commissioner only. Steps of three games are unchanged.
--  * 2026-11-23: all automated staff notifications go to ONE staff notifications channel, and bans, unbans and lifts get
--    a staff notice (suspensions, warnings and extensions already post).
--
-- Apply order at the flip (one owner per function, so the three records compose): 1. this record (staff powers),
-- 2. sql/2026-11-24-s2-all-staff-voting-v463.sql, 3. sql/2026-11-24-s2-staff-copy-v463.sql (it refuses to run before
-- the other two). Reverse in the opposite order: the copy reverse, the all-staff voting reverse, then this reverse (it
-- refuses to run while the copy record stands). This record owns has_department, _is_stats_staff, is_media_staff,
-- is_media_only_staff, notify_department, notify_staff_ch, _issue_suspension, extend_suspension, lift_suspension,
-- withdraw_registration, guard_appeal_decider, ban_player and unban_player; no other flip record patches them.
--
-- How, in the shared code (one change per concept, not one per caller):
--  1. The department test lives in ONE place, public.profile_has_department(profile, key): every staff member not
--     suspended from staff duties and not banned, and every commissioner, holds every key; the 'draft' key is held by a
--     commissioner or the seated Draft and Bidding manager (the per-profile form of can_run_market). has_department(key)
--     asks it for the signed-in member; the Netlify statistics gates ask it, with the service role, for a member found by
--     Discord id (main session, 2026-11-24: the gates follow the database's answer, not a second list). The
--     ban is read here because ban_player keeps the role and the department test was the only thing that stopped a
--     banned staffer (the main session ruled on 2026-11-24 that a banned member never votes or holds a seat; the
--     2026-11-24 rehearsal's staffer with no department was a banned one, and passed S1). That opens, with no
--     other edit: declare_forfeit, grant_cap_exception and revoke_cap_exception; guard_trade_insert, reverse_trade,
--     resend_trade, set_roster_squad and swap_roster_squad; ops_exempt_game_limits, ops_reschedule_game and
--     ops_set_limit_week; set_owner_app_club; rankings_set_order and rankings_clear; is_stats_staff and everything behind
--     it (the Stats manager RPCs, club substitutions, stat credits); guard_appeal_decider; the news write and edit
--     policies; "officials read discipline" and "transactions staff read trades". _is_stats_staff (forfeit_game) read
--     the departments column itself; it now asks has_department.
--  2. Media retired: is_media_staff and is_media_only_staff answer false, so the Media carve-outs end everywhere at once
--     (can_vote_awards, the application and case read policies, staff_vote_*, s2_desk).
--  3. Discipline: _issue_suspension, extend_suspension, lift_suspension and guard_appeal_decider are patched by exact
--     anchor. Any staff member may still WARN (a warning is not a suspension; Claude's reading, open with the
--     commissioner) and may withdraw a warning they gave; a suspension, an extension or a lift needs a committee manager
--     (is_any_committee_manager) or a commissioner, and so does deciding an appeal, so whoever grants an appeal can always
--     lift the suspension (Claude's reading, open with the commissioner: only "issue" was ruled). The date ceiling drops
--     from 30 days to 14 and is measured on the suspension's total length from its start (main session, 2026-11-24), in
--     ONE place, public.manager_date_ceiling(start): from now when issuing, from the day it was issued when extending, so
--     repeated extensions cannot roll past it. The 18-game ceiling and steps of three stay. public.suspension_requests
--     holds what other staff file and what a manager applies for: request_suspension, decide_suspension_request and
--     withdraw_suspension_request. A committee manager decides a request only inside the ceiling, never one about
--     themselves, one they filed, or one about league staff or a commissioner, approve AND deny (main session,
--     2026-11-24); a commissioner decides any. An approval issues the suspension through _issue_suspension under the
--     decider, so every other discipline rule is still checked there, and it issues EXACTLY the approved length
--     (p_keep_length: the 2026-11-24 rulebook review found a manager's approval of a 6-game request for a second
--     suspension became the rest of the season).
--     The second suspension of a season (Rule 7.2 paragraph 3: the rest of the season unless the official sets a
--     shorter length) is never imposed silently by a committee manager: the rest of the season is past 14 days or 18
--     games, so a manager either keeps the length they set, inside the limits (p_keep_length), or files a request for the
--     rest of the season and a commissioner decides it. A commissioner's second suspension is unchanged.
--     Extensions (Rule 7.2 paragraph 3: one suspension at a time): a request filed against a member already serving a
--     suspension is an EXTENSION request in that suspension's own terms (games to add in steps of three, or a later last
--     day), and approving it extends the running suspension by the approved amount through extend_suspension under the
--     decider, so the limits are read there; past them only a commissioner approves. Before this an approved request
--     went through _issue_suspension, which refuses a member already suspended, so the extension messages pointed at a
--     door that could never open.
--     Appeals: "an appeal by a member of league staff is decided by a commissioner" (Rule 7.6) is enforced in
--     guard_appeal_decider; it is true in every season, so it branches on nothing.
--  4. One staff channel: notify_staff_ch posts every channel name to #staff-casework (discord_staff_casework_webhook;
--     the general staff webhook stays the fallback), and notify_department bells every staff member who is not banned and
--     every commissioner.
--     withdraw_registration, the one automated poster that read the staff webhook itself, posts through notify_staff_ch
--     (main session, 2026-11-24), and a self-check refuses any other function that reads a staff webhook directly.
--  5. Notices: a trigger on ban_events posts every ban and unban, and a trigger on suspensions posts every lift (a
--     withdrawn warning says so), through notify_staff_ch (allowed_mentions empty, the staff channel only). First,
--     ban_events.by is renamed actor_id: BY is a reserved word in PL/pgSQL, so a trigger cannot read new.by (the
--     2026-11-24 production rehearsal failed in notify_ban_event with record "new" has no field "by"). ban_player and
--     unban_player, the column's only writers, follow by exact anchor; nothing else reads it (the site, the bot, the jobs,
--     the Netlify functions and every database function searched, 2026-11-24).
--
-- The Netlify statistics gates ask the database, in the same flip commit: netlify/functions/ingest-stats.js staffActor
-- calls rpc/is_stats_staff (has_department, so profile_has_department) under the member's own JWT, and
-- netlify/functions/discord-interactions.js sbIsStatsStaff calls rpc/profile_has_department with the service role
-- (tools/s2-staff-gates-v463.test.mjs). Both keep commissioners passing and banned members refused. The importer desk
-- follows this record to the minute and back with its reverse. The Discord lobby delete needs this record's door: until
-- it applies, only a commissioner can delete a pickup lobby channel from Discord (the gate fails closed), so apply this
-- record promptly after the flip deploy. The Discord department rooms and roles, bot/staff-alerts.mjs and the daily
-- vote nudge are the Discord stream's flip parts.
--
-- Season 1 history is untouched: profiles.departments, the ban_events rows (one column renamed), suspensions and every
-- decided case stay as they are; only the gates that read them change. Reverse:
-- sql/2026-11-24-s2-staff-powers-v463.reverse.sql (the same patch pairs, undone by exact anchor; the new doors and
-- triggers dropped; the column renamed back; the requests table kept, with no API access, as the record).
-- Rehearsal: sql/2026-11-24-s2-staff-powers-v463.rehearsal.sql. Prerequisite: the committees record is live (and with it
-- the bid-night record, which the committees record requires).

do $pre$
begin
  if to_regprocedure('public.is_committee_manager(uuid,text)') is null or to_regprocedure('public.can_run_market()') is null
     or to_regclass('public.committees') is null then
    raise exception 'v463 staff powers: the committees record (is_committee_manager, can_run_market) must be applied first';
  end if;
  if to_regprocedure('public.request_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,uuid)') is not null then
    raise exception 'v463 staff powers: already applied';
  end if;
end $pre$;

-- 1. a committee manager of any committee, with the seat's power (the discipline test)
create or replace function public.is_any_committee_manager(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  /* v463 (commissioner, 2026-11-23): only committee managers and commissioners suspend. A manager of any committee,
     counted only while the seat has its power (is_committee_manager: on the staff, not suspended from staff duties). */
  select exists (select 1 from public.committees c where public.is_committee_manager(p_profile, c.key));
$function$;
revoke all on function public.is_any_committee_manager(uuid) from public, anon, authenticated;
grant execute on function public.is_any_committee_manager(uuid) to anon, authenticated, service_role;

create or replace function public.manager_date_ceiling(p_start timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path to ''
as $function$
  /* v463 (commissioner, 2026-11-23): a committee manager suspends to a date at most 14 days from the suspension's start,
     measured on its total length (main session, 2026-11-24), with the day of slack the old 30-day ceiling had (31 days),
     so a last day picked at the end of day 14 passes. The ONE definition: _issue_suspension (start: now),
     extend_suspension (start: the day it was issued) and decide_suspension_request (start: now, when approval issues it). */
  select p_start + interval '15 days';
$function$;
revoke all on function public.manager_date_ceiling(timestamptz) from public, anon, authenticated;

create or replace function public.profile_has_department(p_profile uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  /* v463 (commissioner, 2026-10-19: "everyone can do any staff role for the most part"; 2026-11-23: no departments,
     and the Draft and Bidding manager alone holds the draft and bidding tools): the ONE department test. Every
     commissioner holds every key. Every staff member who is not suspended from staff duties (v3.51) and not banned
     (ban_player keeps the role, so the ban is read here) holds every key but 'draft', which among the staff only the
     seated Draft and Bidding manager holds (the per-profile form of can_run_market). has_department(key) asks it for
     the signed-in member; the Netlify statistics gates ask it, with the service role, for a member found by Discord id. */
  select p_profile is not null and exists (
    select 1 from public.profiles p
     where p.id = p_profile
       and (p.role = 'commissioner'
         or (p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id)
             and (p_key <> 'draft' or public.is_committee_manager(p.id, 'draft')))));
$function$;
revoke all on function public.profile_has_department(uuid, text) from public, anon, authenticated;
grant execute on function public.profile_has_department(uuid, text) to service_role;

-- 2. the gates, patched by exact anchor (the reverse record carries the same pairs and undoes them the same way)
do $fwd$
declare r record; v_def text; n int;
begin
  for r in select * from (values
-- >>> patch pairs
    (1, 'public.has_department(text)', $o$  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role = 'commissioner'
        or (role = 'staff'
            and not public.is_staff_suspended(auth.uid())
            and (p_key = any(departments)
                 or (p_key = 'community' and 'player-relations' = any(departments)))))
  );
$o$, $n$  /* v463 (commissioner, 2026-10-19 and 2026-11-23): no departments in Season 2, so every staff member holds every
     department's power, except the draft and bidding tools (the Draft and Bidding manager or a commissioner). The test
     lives in ONE place, profile_has_department, which also reads the ban (a ban keeps the role). */
  select public.profile_has_department(auth.uid(), p_key);
$n$),
    (2, 'public._is_stats_staff()', $o$'statistics' = any(coalesce(departments, '{}'))$o$,
        $n$public.has_department('statistics') /* v463: every staff member, by the one department test */$n$),
    (3, 'public.is_media_staff(uuid)', $o$      and p.role = 'staff'
      and exists (select 1 from unnest(coalesce(p.departments,'{}'::text[])) d
$o$, $n$      and p.role = 'staff'
      and false   /* v463 (commissioner, 2026-10-22): "we will not have that role next season" */
      and exists (select 1 from unnest(coalesce(p.departments,'{}'::text[])) d
$n$),
    (4, 'public.is_media_only_staff(uuid)', $o$      and p.role = 'staff'
      and coalesce(array_length(p.departments, 1), 0) > 0
$o$, $n$      and p.role = 'staff'
      and false   /* v463 (commissioner, 2026-10-22): no Media staff in Season 2 */
      and coalesce(array_length(p.departments, 1), 0) > 0
$n$),
    (5, 'public.notify_department(text,text,text,text,text,text)', $o$        or (role = 'staff' and departments is not null and p_dept = any(departments))
$o$, $n$        or (role = 'staff' and not banned)   /* v463 (commissioner, 2026-11-23): one staff group, so every staff member is told; a ban keeps the role, so the ban is read here */
$n$),
    (6, 'public.notify_staff_ch(text,text,boolean)', $o$  if p_channel is not null and p_channel <> '' then
    select value into v_url from public.app_config where key = 'discord_staff_'||p_channel||'_webhook' and value <> '';
  end if;
$o$, $n$  /* v463 (commissioner, 2026-11-23): ONE staff notifications channel for every automated staff post, whatever channel
     the caller names: #staff-casework. The general staff webhook stays the fallback it always was. */
  select value into v_url from public.app_config where key = 'discord_staff_casework_webhook' and value <> '';
$n$),
    (7, 'public._issue_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,boolean,uuid)', $o$    raise exception 'Only a commissioner, the officiating department or the community department can discipline members.';
  end if;
$o$, $n$    raise exception 'Only the league staff can discipline members.';
  end if;
  /* v463 (commissioner, 2026-11-23): only a committee manager or a commissioner suspends. Any staff member may still
     warn, and files a suspension request (request_suspension) for anything more. */
  if coalesce(p_mode, '') <> 'warning' and not v_commish and not public.is_any_committee_manager(v_uid) then
    raise exception 'Only a committee manager or a commissioner can suspend a member. File a suspension request instead, and a committee manager or a commissioner acts on it.';
  end if;
$n$),
    (8, 'public._issue_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,boolean,uuid)', $o$      raise exception 'Staff issue suspensions in steps of three games, up to 18 (3, 6, 9, 12, 15 or 18). Anything longer, or a ban, goes to the commissioner''s office (Rule 7.2).';$o$,
        $n$      raise exception 'A committee manager issues suspensions in steps of three games, up to 18 (3, 6, 9, 12, 15 or 18). Anything longer is applied for: file a suspension request and a commissioner approves it. A ban is a commissioner ruling (Rule 7.2).';$n$),
    (9, 'public._issue_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,boolean,uuid)', $o$      if v_end > now() + interval '31 days' then
        raise exception 'Staff can suspend to a date up to 30 days away. Anything longer goes to the commissioner''s office (Rule 7.2).';$o$,
        $n$      if v_end > public.manager_date_ceiling(now()) then   -- v463: 14 days (commissioner, 2026-11-23), one definition
        raise exception 'A committee manager can suspend to a date up to 14 days away. Anything longer is applied for: file a suspension request and a commissioner approves it (Rule 7.2).';$n$),
    (10, 'public.extend_suspension(uuid,integer,integer,text)', $o$    raise exception 'Only a commissioner, the officiating department or the community department can extend a suspension.';
  end if;
$o$, $n$    raise exception 'Only the league staff can extend a suspension.';
  end if;
  /* v463 (commissioner, 2026-11-23): only a committee manager or a commissioner suspends, so only they extend */
  if not v_commish and not public.is_any_committee_manager(auth.uid()) then
    raise exception 'Only a committee manager or a commissioner can extend a suspension. File a suspension request against the member instead: a request against a member who is serving a suspension asks to extend it.';
  end if;
$n$),
    (11, 'public.extend_suspension(uuid,integer,integer,text)', $o$      raise exception 'Staff extend in steps of three games, to a total of 18 at most. Anything longer goes to the commissioner''s office (Rule 7.2).';$o$,
        $n$      raise exception 'A committee manager extends in steps of three games, to a total of 18 at most. Anything longer is applied for: file a suspension request to extend it, and a commissioner approves it (Rule 7.2).';$n$),
    (12, 'public.extend_suspension(uuid,integer,integer,text)', $o$    if not v_commish and v_new > now() + interval '31 days' then
      raise exception 'Staff can suspend to a date up to 30 days away. Anything longer goes to the commissioner''s office (Rule 7.2).';$o$,
        $n$    if not v_commish and v_new > public.manager_date_ceiling(s.created_at) then   -- v463: 14 days from the day it was issued, not from today (main session, 2026-11-24), so repeated extensions cannot roll past it
      raise exception 'A committee manager can extend a dated suspension to at most 14 days from the day it was issued. Anything longer is applied for: file a suspension request to extend it, and a commissioner approves it (Rule 7.2).';$n$),
    (13, 'public.lift_suspension(uuid)', $o$  if not (public.is_commissioner() or public.has_department('officiating')
          or (public.has_department('community') and (s.created_by = auth.uid() or s.venue = 'discord'))) then
    raise exception 'Only a commissioner or the officiating department can lift this one. Community staff can lift a Discord-conduct suspension.';
  end if;
$o$, $n$  /* v463 (commissioner, 2026-11-23: only committee managers and commissioners suspend): only they lift a suspension, and
     only they decide an appeal (guard_appeal_decider), so whoever grants an appeal can lift it here. A warning, which any
     staff member may give, may also be withdrawn by the staff member who gave it. */
  if not (public.is_commissioner() or public.is_any_committee_manager(auth.uid())
          or (s.mode = 'warning' and s.created_by = auth.uid() and public.is_staff())) then
    raise exception 'Only a committee manager or a commissioner can lift a suspension. A staff member may withdraw a warning they gave.';
  end if;
$n$),
    (14, 'public.withdraw_registration(uuid)', $o$  select coalesce(
    (select value from public.app_config where key = 'discord_staff_webhook'),
    (select value from public.app_config where key = 'discord_updates_webhook')) into v_hook;
  if v_hook is not null then
    perform public.discord_http_post(url := v_hook, headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('content',
        '$o$ || chr(8617) || chr(65039) || $o$ **' || v_name || '** withdrew their ' || v_season.name || ' sign-up (position ' ||
        coalesce(v_reg.position::text,'$o$ || chr(8212) || $o$') || '). The pool count just went down by one.'));
  end if;
$o$, $n$  /* v463 (commissioner, 2026-11-23): "all automated staff notifications go to ONE staff notifications channel", so the
     withdrawal notice goes through notify_staff_ch like every other staff post (no pings, and no fallback to the
     changelog channel). v_hook stays declared and unused. */
  perform public.notify_staff_ch(null, '**Sign-up withdrawn**: ' || v_name || ' withdrew their ' || v_season.name
    || ' sign-up (position ' || coalesce(v_reg.position::text, 'none') || '). The pool count just went down by one.', false);
$n$),
    (15, 'public.guard_appeal_decider()', $o$  if coalesce(new.dept,'officiating') = 'community' and not public.has_department('community') then
    raise exception 'This appeal is about Discord conduct. The community department decides it (Rule 7.6).';
  end if;
  if coalesce(new.dept,'officiating') = 'officiating' and not public.has_department('officiating') then
    raise exception 'This appeal is about play on the ice. The officiating department decides it (Rule 7.6).';
  end if;
$o$, $n$  /* v463 (Rule 7.6: "an appeal by a member of league staff is decided by a commissioner"): enforced here, and true in
     every season, so it branches on nothing; the appellant or the suspended member holding a staff or commissioner role
     is enough. A commissioner returned above. */
  if exists (select 1 from public.profiles p
              where p.id in (new.profile_id, s.profile_id) and p.role::text in ('staff', 'commissioner')) then
    raise exception 'An appeal by a member of league staff is decided by a commissioner (Rule 7.6).';
  end if;
  /* v463 (commissioner, 2026-11-23: only committee managers and commissioners suspend, so only they lift): only they
     decide an appeal too, so whoever grants one can always lift the suspension (lift_suspension). Claude's reading of the
     ruling, open with the commissioner. */
  if not public.is_any_committee_manager(auth.uid()) then
    raise exception 'A committee manager or a commissioner decides an appeal (Rule 7.6).';
  end if;
$n$),
    (16, 'public._issue_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,boolean,uuid)', $o$      v_mode := 'seasons'; v_until := v_snum; v_auto := true;
$o$, $n$      /* v463 (commissioner, 2026-11-23: past 14 days or 18 games needs a commissioner's approval): the rest of the season
         (Rule 7.2 paragraph 3) is never imposed silently by a committee manager. They keep a length inside their limits
         (p_keep_length: the official sets a shorter length) or file a request for the rest of the season. */
      if not v_commish then
        raise exception '% was already suspended this season, so a second suspension runs for the rest of the season unless the official sets a shorter length (Rule 7.2). Keep the length you set, up to 14 days or 18 games, or file a suspension request for the rest of the season and a commissioner decides it.', v_gt;
      end if;
      v_mode := 'seasons'; v_until := v_snum; v_auto := true;
$n$),
    (17, 'public.extend_suspension(uuid,integer,integer,text)', $o$      raise exception 'This suspension is for conduct on the ice. The officiating department extends it.';$o$,
        $n$      raise exception 'This suspension is for conduct on the ice, so a committee manager or a commissioner extends it.';$n$),
    (18, 'public._issue_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,boolean,uuid)', $o$      raise exception 'A season-long suspension is a commissioner ruling. Issue a shorter one, or escalate.';$o$,
        $n$      raise exception 'A season-long suspension is a commissioner ruling. Issue a shorter one, or file a suspension request and a commissioner decides it (Rule 7.2).';$n$)
-- <<< patch pairs
  ) as x(ord, fn, old_text, new_text) order by x.ord loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then raise exception 'v463 staff powers: anchor % in % matched % times', r.ord, r.fn, n; end if;
    execute replace(v_def, r.old_text, r.new_text);
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text) <> 1 then
      raise exception 'v463 staff powers: patch % in % did not land once', r.ord, r.fn;
    end if;
  end loop;
end $fwd$;

-- 3. suspension requests: what other staff file, and what a manager applies for beyond the ceiling
create table if not exists public.suspension_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('date', 'games', 'seasons')),
  games integer check (games is null or games > 0),
  ends_at timestamptz,
  until_season integer,
  days integer check (days is null or days > 0),
  extends_id uuid references public.suspensions(id) on delete set null,
  reason text,
  reason_codes text[],
  scope text not null default 'play' check (scope in ('play', 'staff', 'both')),
  case_id uuid references public.action_requests(id) on delete set null,
  filed_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  suspension_id uuid references public.suspensions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.suspension_requests is
  'v463: suspension requests (commissioner, 2026-11-23: other staff file them; a committee manager applies for anything '
  'past 14 days or 18 games and a commissioner approves it). A request against a member already serving a suspension '
  'extends it (extends_id; games: the games to add; days: the days to add; Rule 7.2, one suspension at a time). Written '
  'only through request_suspension, decide_suspension_request and withdraw_suspension_request.';
alter table public.suspension_requests enable row level security;
revoke all on table public.suspension_requests from public, anon, authenticated;
grant select on table public.suspension_requests to authenticated;
drop policy if exists "staff read suspension requests" on public.suspension_requests;
create policy "staff read suspension requests" on public.suspension_requests for select to authenticated
  using (public.is_staff() or public.is_commissioner());

create or replace function public.request_suspension(p_profile uuid, p_mode text, p_games integer, p_ends_at timestamptz,
  p_until_season integer, p_reason text, p_codes text[] default null, p_scope text default 'play', p_case uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
/* v463 (commissioner, 2026-11-23): "other staff file suspension requests", and a committee manager applies for anything
   past the ceiling. Any staff member or commissioner files one; the committee managers and the commissioners are told.
   The terms are checked when a decider issues it (_issue_suspension or extend_suspension), the one place the rules live.
   A request against a member already serving a suspension is an extension of it (Rule 7.2 paragraph 3: one suspension
   at a time), in its own terms: p_games is the games to add, p_ends_at the new last day. */
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text;
  v_by text;
  v_terms text;
  v_scope text := coalesce(nullif(btrim(p_scope), ''), 'play');
  v_ext public.suspensions;
  v_days integer;
  r record;
begin
  if v_uid is null then raise exception 'SUSPENSION REQUEST: Sign in first.' using errcode = '42501'; end if;
  if not (public.is_staff() or public.is_commissioner()) then
    raise exception 'SUSPENSION REQUEST: Only the league staff can file a suspension request.' using errcode = '42501';
  end if;
  if p_profile is null then raise exception 'SUSPENSION REQUEST: Pick the member.'; end if;
  if p_profile = v_uid then raise exception 'SUSPENSION REQUEST: You can''t file one against yourself.'; end if;
  if coalesce(p_mode, '') not in ('date', 'games', 'seasons') then
    raise exception 'SUSPENSION REQUEST: Pick a suspension: games, to a date, or seasons.';
  end if;
  if coalesce(btrim(p_reason), '') = '' and coalesce(array_length(p_codes, 1), 0) = 0 then
    raise exception 'SUSPENSION REQUEST: Say why. A suspension has to state its grounds (Rule 7.6).';
  end if;
  if p_mode = 'games' and coalesce(p_games, 0) < 1 then raise exception 'SUSPENSION REQUEST: Enter how many games.'; end if;
  /* v463 (commissioner, 2026-11-23): suspensions go in steps of three games */
  if p_mode = 'games' and p_games % 3 <> 0 then
    raise exception 'SUSPENSION REQUEST: Ask in steps of three games (3, 6, 9 and so on; Rule 7.2).';
  end if;
  if p_mode = 'date' and (p_ends_at is null or p_ends_at <= now()) then
    raise exception 'SUSPENSION REQUEST: Pick a last day that has not passed.';
  end if;
  if p_mode = 'seasons' and p_until_season is null then raise exception 'SUSPENSION REQUEST: Pick the final season.'; end if;
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'A member') into v_name from public.profiles p where p.id = p_profile;
  if v_name is null then raise exception 'SUSPENSION REQUEST: That member no longer exists.'; end if;

  /* v463: the suspension the member is serving, if any. A departure suspension (Rule 7.2 paragraph 7) stands beside a
     shorter one and is never the one extended. Newest first, the id breaking a tie, so the pick is never arbitrary. */
  select * into v_ext from public.suspensions s
   where s.profile_id = p_profile and s.status = 'active' and s.mode <> 'warning'
     and coalesce(s.grounds, '') <> 'departure' and public.suspension_running_at(s, now())
   order by s.created_at desc, s.id desc
   limit 1;
  if v_ext.id is not null then
    if v_ext.mode = 'seasons' then
      raise exception 'SUSPENSION REQUEST: % is serving a suspension for the rest of a season, so there is nothing to extend. A commissioner rules on it (Rule 7.2).', v_name;
    end if;
    if p_mode <> v_ext.mode then
      raise exception 'SUSPENSION REQUEST: % is serving a suspension counted in %, so this request extends it (one suspension at a time, Rule 7.2): %.',
        v_name, case when v_ext.mode = 'games' then 'games' else 'days' end,
        case when v_ext.mode = 'games' then 'ask for the games to add' else 'pick the new last day' end;
    end if;
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'SUSPENSION REQUEST: Say why it should be extended. The member is told the reason.';
    end if;
    if v_ext.mode = 'date' then
      v_days := (p_ends_at at time zone 'America/New_York')::date - (v_ext.ends_at at time zone 'America/New_York')::date;
      if v_days < 1 then
        raise exception 'SUSPENSION REQUEST: Pick a last day after %, the day % is serving to.',
          to_char(v_ext.ends_at at time zone 'America/New_York', 'Mon DD'), v_name;
      end if;
    end if;
    v_scope := v_ext.scope;
  end if;

  /* v463: the terms _issue_suspension would refuse at approval are refused here in plain words, not as a raw constraint */
  if v_scope not in ('play', 'staff', 'both') then
    raise exception 'SUSPENSION REQUEST: Pick what it covers: play, staff duties, or both.';
  end if;
  if v_scope <> 'play' and not exists (select 1 from public.profiles p where p.id = p_profile and p.role::text in ('staff', 'commissioner')) then
    raise exception 'SUSPENSION REQUEST: A suspension from staff duties is only for a member of league staff.';
  end if;
  if p_case is not null and not exists (select 1 from public.action_requests c where c.id = p_case) then
    raise exception 'SUSPENSION REQUEST: That case was not found.';
  end if;

  insert into public.suspension_requests (profile_id, mode, games, ends_at, until_season, days, extends_id, reason,
                                          reason_codes, scope, case_id, filed_by)
  values (p_profile, p_mode, case when p_mode = 'games' then p_games end, case when p_mode = 'date' then p_ends_at end,
          case when p_mode = 'seasons' then p_until_season end, v_days, v_ext.id, nullif(btrim(p_reason), ''),
          nullif(p_codes, '{}'), v_scope, p_case, v_uid)
  returning id into v_id;
  perform public.log_admin_action('suspension_requested', 'suspension_request', v_id::text,
    jsonb_build_object('profile', p_profile, 'mode', p_mode, 'games', p_games, 'ends_at', p_ends_at,
                       'until_season', p_until_season, 'days', v_days, 'extends', v_ext.id, 'case', p_case, 'by', v_uid));
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'A staff member') into v_by from public.profiles p where p.id = v_uid;
  if v_ext.id is not null then
    v_terms := v_by || ' asks to extend the suspension of ' || v_name || ' by '
      || case when p_mode = 'games' then p_games || ' games'
              else v_days || ' days, through ' || to_char(p_ends_at at time zone 'America/New_York', 'Mon DD') end || '.';
  else
    v_terms := v_by || ' asks for a suspension of ' || v_name || ', '
      || case when p_mode = 'games' then p_games || ' games'
              when p_mode = 'date' then 'through ' || to_char(p_ends_at at time zone 'America/New_York', 'Mon DD')
              else 'through Season ' || p_until_season end || '.';
  end if;
  perform public.notify_commissioners(array[v_uid], 'flag', 'Suspension request', v_terms, 'staffdesk', null);
  for r in select distinct c.manager_profile_id as pid from public.committees c
            where c.manager_profile_id is not null and c.manager_profile_id <> v_uid
              and public.is_committee_manager(c.manager_profile_id, c.key) loop
    perform public.create_notification(r.pid, 'flag', 'Suspension request', v_terms, 'staffdesk', null);
  end loop;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending', 'extends', v_ext.id);
end $function$;

create or replace function public.decide_suspension_request(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
/* v463 (commissioner, 2026-11-23): a committee manager decides a request inside the ceiling (14 days, or 18 games in steps
   of three); anything longer "must be approved by a commissioner". Main session, 2026-11-24: a committee manager never
   decides a request about themselves, one they filed, one about league staff or a commissioner (Rule 7.2), or one past
   the ceiling, whether approving or denying; a commissioner decides any. An approval acts under the decider's own claims,
   so the grounds and every other discipline rule are checked by the door it calls: _issue_suspension for a new
   suspension, with p_keep_length true so it issues EXACTLY the approved length (never the rest of the season by itself),
   and extend_suspension for an extension, which adds exactly the approved games or days to the running suspension. A
   denial needs a reason, sent to the staff member who filed it. */
declare
  v_uid uuid := auth.uid();
  v_req public.suspension_requests;
  v_ext public.suspensions;
  v_susp uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name text;
  v_n int;
begin
  if v_uid is null then raise exception 'SUSPENSION REQUEST: Sign in first.' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'SUSPENSION REQUEST: Choose approve or deny.'; end if;
  if not (public.is_commissioner() or public.is_any_committee_manager(v_uid)) then
    raise exception 'SUSPENSION REQUEST: Only a committee manager or a commissioner decides a suspension request.' using errcode = '42501';
  end if;
  select * into v_req from public.suspension_requests q where q.id = p_id for update;
  if v_req.id is null then raise exception 'SUSPENSION REQUEST: That request was not found.'; end if;
  if v_req.status <> 'pending' then
    raise exception 'SUSPENSION REQUEST: This request is %, so it cannot be decided here.', v_req.status;
  end if;
  if v_req.extends_id is not null then
    select * into v_ext from public.suspensions s where s.id = v_req.extends_id;
  end if;
  if not public.is_commissioner() then
    if v_req.profile_id = v_uid then
      raise exception 'SUSPENSION REQUEST: This request is about you, so a commissioner decides it.' using errcode = '42501';
    end if;
    if v_req.filed_by = v_uid then
      raise exception 'SUSPENSION REQUEST: You filed this request, so another committee manager or a commissioner decides it.' using errcode = '42501';
    end if;
    if exists (select 1 from public.profiles p where p.id = v_req.profile_id and p.role::text in ('staff', 'commissioner')) then
      raise exception 'SUSPENSION REQUEST: Only a commissioner decides a request about league staff or a commissioner (Rule 7.2).' using errcode = '42501';
    end if;
    /* the ceiling on the suspension's total length from its start: for a new suspension the start is the approval (now),
       for an extension the day the running one was issued (as extend_suspension reads it); a date is read as its last
       day at 11:59 PM ET, as _issue_suspension and extend_suspension read it
       -- shortcut: the 18-game ceiling is written here as in _issue_suspension and extend_suspension, revisit if it changes */
    if (v_req.extends_id is null
        and (v_req.mode = 'seasons'
             or (v_req.mode = 'games' and coalesce(v_req.games, 0) > 18)
             or (v_req.mode = 'date'
                 and (((v_req.ends_at at time zone 'America/New_York')::date + time '23:59:59') at time zone 'America/New_York')
                     > public.manager_date_ceiling(now()))))
       or (v_req.extends_id is not null
           and (v_ext.mode = 'seasons'
                or (v_req.mode = 'games' and coalesce(v_ext.games_total, 0) + coalesce(v_req.games, 0) > 18)
                or (v_req.mode = 'date'
                    and ((((v_ext.ends_at at time zone 'America/New_York')::date + coalesce(v_req.days, 0)) + time '23:59:59')
                         at time zone 'America/New_York') > public.manager_date_ceiling(v_ext.created_at)))) then
      raise exception 'SUSPENSION REQUEST: This request is past a committee manager''s limit (14 days or 18 games), so a commissioner decides it.' using errcode = '42501';
    end if;
  end if;
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'the member') into v_name from public.profiles p where p.id = v_req.profile_id;

  if p_approve then
    if v_req.extends_id is not null then
      perform public.extend_suspension(v_req.extends_id, v_req.games, v_req.days, v_req.reason);
      v_susp := v_req.extends_id;
    else
      v_susp := public._issue_suspension(v_req.profile_id, v_req.mode, v_req.games, v_req.ends_at, v_req.until_season,
                                         v_req.reason, v_req.reason_codes, v_req.scope, true, v_req.case_id);
    end if;
    update public.suspension_requests
       set status = 'approved', decided_by = v_uid, decided_at = now(), decision_note = v_note, suspension_id = v_susp,
           updated_at = now()
     where id = p_id and status = 'pending';
  else
    if v_note is null then
      raise exception 'SUSPENSION REQUEST: Say why it is denied. The staff member who filed it is told.';
    end if;
    update public.suspension_requests
       set status = 'denied', decided_by = v_uid, decided_at = now(), decision_note = v_note, updated_at = now()
     where id = p_id and status = 'pending';
  end if;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'SUSPENSION REQUEST: The request could not be decided. Refresh the page and try again.'; end if;
  perform public.log_admin_action(case when p_approve then 'suspension_request_approved' else 'suspension_request_denied' end,
    'suspension_request', p_id::text, jsonb_build_object('profile', v_req.profile_id, 'by', v_uid, 'suspension', v_susp,
                                                         'extends', v_req.extends_id, 'note', v_note));
  if v_req.filed_by is not null and v_req.filed_by <> v_uid then
    perform public.create_notification(v_req.filed_by, 'flag', 'Suspension request decided',
      'Your request to ' || case when v_req.extends_id is not null then 'extend the suspension of ' else 'suspend ' end || v_name
      || case when p_approve then ' was approved, and it is in place.' else ' was denied: ' || v_note end, 'staffdesk', null);
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', case when p_approve then 'approved' else 'denied' end,
                            'suspension', v_susp, 'extends', v_req.extends_id);
end $function$;

create or replace function public.withdraw_suspension_request(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
/* v463: the staff member who filed a request may take it back while it is pending */
declare v_uid uuid := auth.uid(); v_req public.suspension_requests; v_n int;
begin
  if v_uid is null then raise exception 'SUSPENSION REQUEST: Sign in first.' using errcode = '42501'; end if;
  select * into v_req from public.suspension_requests q where q.id = p_id for update;
  if v_req.id is null then raise exception 'SUSPENSION REQUEST: That request was not found.'; end if;
  if v_req.filed_by is distinct from v_uid then
    raise exception 'SUSPENSION REQUEST: Only the staff member who filed it may withdraw it.' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'SUSPENSION REQUEST: This request is %, so there is nothing to withdraw.', v_req.status;
  end if;
  update public.suspension_requests set status = 'withdrawn', updated_at = now() where id = p_id and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'SUSPENSION REQUEST: The request could not be withdrawn. Refresh the page and try again.'; end if;
  perform public.log_admin_action('suspension_request_withdrawn', 'suspension_request', p_id::text, jsonb_build_object('by', v_uid));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'withdrawn');
end $function$;

-- 4. ban, unban and lift notices to the one staff channel
/* v463: ban_events.by becomes actor_id before any trigger reads it. BY is a reserved word in PL/pgSQL, so new.by cannot be
   read in a trigger (2026-11-24 rehearsal: record "new" has no field "by"); quoting it would leave the trap for the next
   trigger. Its only writers, ban_player and unban_player, change their insert's column list and nothing else, by exact
   anchor; the reverse record carries the same two strings and undoes it. */
alter table public.ban_events rename column by to actor_id;
do $ban$
declare
  v_f text; v_def text;
  v_old text := 'insert into public.ban_events(profile_id, action, reason, by) values (';
  v_new text := 'insert into public.ban_events(profile_id, action, reason, actor_id) values (';
begin
  foreach v_f in array array['public.ban_player(uuid,text)', 'public.unban_player(uuid)'] loop
    v_def := pg_get_functiondef(v_f::regprocedure);
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'v463 staff powers: the ban_events insert in % did not match once', v_f;
    end if;
    execute replace(v_def, v_old, v_new);
    v_def := pg_get_functiondef(v_f::regprocedure);
    if position(v_old in v_def) > 0 or (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new) <> 1 then
      raise exception 'v463 staff powers: the ban_events insert in % did not move to actor_id once', v_f;
    end if;
  end loop;
end $ban$;

create or replace function public.notify_ban_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
/* v463 (commissioner, 2026-11-23): bans and unbans get a staff notice. ban_player and unban_player record every one in
   ban_events, so one trigger covers both doors. The reason stays in the staff channel; notify_staff_ch sends no pings.
   Who acted is new.actor_id (the column renamed above: never new.by, a reserved word in PL/pgSQL). */
declare v_name text; v_by text;
begin
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'A member') into v_name from public.profiles p where p.id = new.profile_id;
  select coalesce(nullif(p.gamertag, ''), p.display_name) into v_by from public.profiles p where p.id = new.actor_id;
  perform public.notify_staff_ch(null,
    case when new.action = 'ban' then '**Member banned**: ' else '**Ban lifted**: ' end || coalesce(v_name, 'A member')
    || ', by ' || coalesce(v_by, 'the league office') || '.'
    || case when new.action = 'ban' and nullif(btrim(new.reason), '') is not null then ' Reason: ' || btrim(new.reason) else '' end,
    false);
  return null;
end $function$;

create or replace function public.notify_suspension_lifted()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
/* v463 (commissioner, 2026-11-23): a lifted suspension gets a staff notice (notify_suspension posts only new ones). Every
   door that lifts one sets status 'lifted', so one trigger covers them all. */
declare v_name text; v_by text;
begin
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'A member') into v_name from public.profiles p where p.id = new.profile_id;
  select coalesce(nullif(p.gamertag, ''), p.display_name) into v_by from public.profiles p where p.id = auth.uid();
  perform public.notify_staff_ch(null,
    case when new.mode = 'warning' then '**Warning withdrawn**: ' else '**Suspension lifted**: ' end || coalesce(v_name, 'A member')
    || ', by ' || coalesce(v_by, 'the league office') || '.', false);
  return null;
end $function$;

drop trigger if exists notify_ban_event_trg on public.ban_events;
create trigger notify_ban_event_trg after insert on public.ban_events
  for each row execute function public.notify_ban_event();
drop trigger if exists notify_suspension_lifted_trg on public.suspensions;
create trigger notify_suspension_lifted_trg after update of status on public.suspensions
  for each row when (old.status = 'active' and new.status = 'lifted')
  execute function public.notify_suspension_lifted();

-- 5. grants
revoke all on function public.request_suspension(uuid, text, integer, timestamptz, integer, text, text[], text, uuid) from public, anon, authenticated;
revoke all on function public.decide_suspension_request(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.withdraw_suspension_request(uuid) from public, anon, authenticated;
revoke all on function public.notify_ban_event() from public, anon, authenticated;
revoke all on function public.notify_suspension_lifted() from public, anon, authenticated;
grant execute on function public.request_suspension(uuid, text, integer, timestamptz, integer, text, text[], text, uuid) to authenticated, service_role;
grant execute on function public.decide_suspension_request(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.withdraw_suspension_request(uuid) to authenticated, service_role;

-- 6. self-checks
do $chk$
declare v_f text; v_staff uuid; v_banned uuid;
begin
  foreach v_f in array array['public.is_any_committee_manager(uuid)', 'public.manager_date_ceiling(timestamptz)',
      'public.profile_has_department(uuid,text)', 'public.request_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,uuid)',
      'public.decide_suspension_request(uuid,boolean,text)', 'public.withdraw_suspension_request(uuid)',
      'public.notify_ban_event()', 'public.notify_suspension_lifted()'] loop
    if not exists (select 1 from pg_proc p where p.oid = v_f::regprocedure and p.prosecdef
                     and 'search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))) then
      raise exception 'v463 staff powers: % must be SECURITY DEFINER with search_path ''''', v_f;
    end if;
    if has_function_privilege('public', v_f::regprocedure, 'EXECUTE') then raise exception 'v463 staff powers: PUBLIC can execute %', v_f; end if;
  end loop;
  if has_function_privilege('anon', 'public.request_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.decide_suspension_request(uuid,boolean,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.is_any_committee_manager(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.manager_date_ceiling(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.manager_date_ceiling(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.profile_has_department(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.profile_has_department(uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.profile_has_department(uuid,text)', 'EXECUTE') then
    raise exception 'v463 staff powers: a door carries the wrong EXECUTE grant';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.suspension_requests'::regclass)
     or has_table_privilege('anon', 'public.suspension_requests', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('authenticated', 'public.suspension_requests', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'v463 staff powers: suspension_requests carries the wrong API privileges';
  end if;
  if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled = 'O'
        and ((t.tgrelid = 'public.ban_events'::regclass and t.tgname = 'notify_ban_event_trg')
          or (t.tgrelid = 'public.suspensions'::regclass and t.tgname = 'notify_suspension_lifted_trg' and t.tgqual is not null))) <> 2 then
    raise exception 'v463 staff powers: a notice trigger is missing';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ban_events'::regclass and a.attname = 'by' and not a.attisdropped)
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.ban_events'::regclass and a.attname = 'actor_id' and not a.attisdropped)
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc like '%ban\_events(%, by)%') then
    raise exception 'v463 staff powers: ban_events.by was not renamed actor_id everywhere';
  end if;
  if position('discord_staff_casework_webhook' in pg_get_functiondef('public.notify_staff_ch(text,text,boolean)'::regprocedure)) = 0
     or position('''discord_staff_''||p_channel' in pg_get_functiondef('public.notify_staff_ch(text,text,boolean)'::regprocedure)) > 0 then
    raise exception 'v463 staff powers: notify_staff_ch still routes by channel';
  end if;
  /* the one staff channel holds only while every automated staff post goes through notify_staff_ch: no other function
     reads a staff webhook itself (the set, status and test tools and the two reports' "is it configured" gates aside) */
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc like '%discord\_staff\_%webhook%'
               and p.proname not in ('notify_staff_ch', 'set_staff_channel', 'set_staff_channels', 'staff_channel_status',
                                     'staff_channel_test', 'staff_briefing', 'weekly_staff_report')) then
    raise exception 'v463 staff powers: a function reads a staff webhook itself instead of posting through notify_staff_ch';
  end if;
  /* probe the opened gates under a staff member's claims (transaction-local): every key but draft */
  select p.id into v_staff from public.profiles p
   where p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id) and not public.is_any_committee_manager(p.id)
   order by p.id limit 1;
  if v_staff is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
    if not (public.has_department('statistics') and public.has_department('transactions') and public.has_department('operations')
            and public.has_department('media') and public.is_stats_staff() and public._is_stats_staff())
       or public.has_department('draft') then
      raise exception 'v463 staff powers: a staff member without a seat does not hold every key but draft';
    end if;
    perform set_config('request.jwt.claims', '', true);
    /* the Netlify gates' form of the same test answers the same for the same member */
    if not public.profile_has_department(v_staff, 'statistics') or public.profile_has_department(v_staff, 'draft') then
      raise exception 'v463 staff powers: profile_has_department disagrees with has_department';
    end if;
  end if;
  if public.is_media_staff(v_staff) or public.is_media_only_staff(v_staff) then
    raise exception 'v463 staff powers: the Media helpers still answer';
  end if;
  /* a banned staffer keeps the role (ban_player), so the opened gates must read the ban: no key at all */
  select p.id into v_banned from public.profiles p where p.role = 'staff' and p.banned order by p.id limit 1;
  if v_banned is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_banned, 'role', 'authenticated')::text, true);
    if public.has_department('statistics') or public.has_department('officiating') or public.has_department('community')
       or public.is_stats_staff() or public._is_stats_staff() or public.profile_has_department(v_banned, 'statistics') then
      raise exception 'v463 staff powers: a banned staffer holds a department key';
    end if;
    perform set_config('request.jwt.claims', '', true);
  end if;
  /* every commissioner holds every key, the draft key included */
  if exists (select 1 from public.profiles p where p.role = 'commissioner'
               and not (public.profile_has_department(p.id, 'statistics') and public.profile_has_department(p.id, 'draft'))) then
    raise exception 'v463 staff powers: a commissioner does not hold every key';
  end if;
  /* the request table carries the extension columns (a reapply after the reverse finds the table kept) */
  if (select count(*) from pg_attribute a where a.attrelid = 'public.suspension_requests'::regclass and not a.attisdropped
        and a.attname in ('days', 'extends_id')) <> 2 then
    raise exception 'v463 staff powers: suspension_requests lacks the extension columns';
  end if;
end $chk$;
-- Applied as migration v463_s2_staff_powers on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
-- <<< staff powers record text

-- >>> all-staff voting record text: sql/2026-11-24-s2-all-staff-voting-v463.sql
-- v463 (DRAFT, 2026-11-24; apply at the flip, T+15, together with the staff powers record
-- (sql/2026-11-24-s2-staff-powers-*.sql), never before): every staff member and every commissioner votes on owner, staff
-- and front-office (GM and AGM) applications, and more than half of all of them decides one.
--
-- The rulings (memory s2-staffing-model.md and season2-format-rulings.md, league law):
--  * 2026-11-23: "Every staff member votes on owner, staff and front-office (GM/AGM) applications, 50% + 1." Commissioners
--    vote too ("13 voters, 7 to pass"), and keep deciding an application alone ("Decide now") while also voting
--    (override_application_decision, unchanged). The ruled 13 counted a staffer banned since 2026-10-05; the electorate
--    excludes banned and staff-suspended members (main session, 2026-11-24), so on 2026-11-24 it is 11 (8 staff and 3
--    commissioners) and 6 pass a vote. The commissioner is asked to confirm the figure.
--  * 2026-11-23 (later): all-staff application voting switches "when the new site is posted". Owner applications are
--    never filled automatically, so the five-reviewer tally stands until then; the Dec 5 owner decisions come first.
--
-- What changes: is_app_reviewer(uid) becomes the staff electorate (public.is_staff_voter, the ONE definition the committee
-- seat vote already uses, the committees record), and app_reviewer_count() its size (public.staff_voter_count). Both move to an
-- empty search_path. resolve_application_if_ready's "50% + 1 of every reviewer" (v3.68, Q47) then follows by itself, as do
-- the three ballot write policies, waitlist_admit, waitlist_application and waitlist_remove (the waitlist is retired after
-- the flip by its own record, and holds no row). The owner_app_read and staff_app_read policies read "every voter" through
-- is_app_reviewer instead of "staff but not Media-only staff": a voter must be able to read what they vote on.
-- notify_mgmt_application, which bells the staff about a GM or AGM nomination from its own department loop (the
-- department bell the staff powers record opens never reached it), bells every voter on the staff instead, and its note to the nominee stops naming the Review
-- Board: two patch pairs by exact anchor, undone by the reverse the same way.
--
-- What does not change: ballots already cast stay and count (every reviewer is a voter); nothing is decided by this record
-- (it calls no resolve: the need rises from 3 to 6, so no pending application can newly pass, and one that reached the
-- old majority while the window was closed is decided by the office, not by this switch); the commissioner's own decision;
-- Season 1 records.
--
-- Outside the database, at the same flip (not in this record): jobs/discord-scheduler.js:628 builds the daily vote nudge;
-- since the Discord stream's flip part (released with this record in v4.63) it asks public.is_app_reviewer, so it follows
-- this record, and its reverse, with no deploy. The classic site counts reviewers in the browser
-- (src/live/part_live.js:5746 and 5760) and still names the department: after v4.63 it serves only the Season 1 fallback
-- site, which is never used for staff work.
--
-- Apply order at the flip (one owner per function, so the three records compose): 1. the staff powers record
-- (sql/2026-11-24-s2-staff-powers-v463.sql), 2. this record, 3. sql/2026-11-24-s2-staff-copy-v463.sql (it refuses to run
-- before the other two). Reverse in the opposite order: the copy reverse, this reverse, then the staff powers reverse.
-- This record owns is_app_reviewer, app_reviewer_count and notify_mgmt_application; no other flip record patches them.
--
-- Reverse: sql/2026-11-24-s2-all-staff-voting-v463.reverse.sql restores both functions, both policies and the nomination
-- bell byte for byte.
-- Rehearsal: sql/2026-11-24-s2-all-staff-voting-v463.rehearsal.sql (forward, cases, reverse, proof of the restore).
-- Prerequisite: the committees record (sql/2026-11-24-s2-committees-*.sql) is live.

do $pre$
begin
  if to_regprocedure('public.is_staff_voter(uuid)') is null or to_regprocedure('public.staff_voter_count()') is null then
    raise exception 'v463 all-staff voting: the committees record (is_staff_voter, staff_voter_count) must be applied first';
  end if;
  if pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure) <> $old$CREATE OR REPLACE FUNCTION public.is_app_reviewer(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.profiles
    where id = p_uid and role in ('staff','commissioner') and 'applications' = any(coalesce(departments, '{}')));
$function$
$old$
     or pg_get_functiondef('public.app_reviewer_count()'::regprocedure) <> $old$CREATE OR REPLACE FUNCTION public.app_reviewer_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.profiles
    where role in ('staff','commissioner') and 'applications' = any(coalesce(departments, '{}'));
$function$
$old$ then
    raise exception 'v463 all-staff voting: is_app_reviewer or app_reviewer_count changed since 2026-11-24, so the reverse would not restore them';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
        and ((tablename = 'owner_applications' and policyname = 'owner_app_read') or (tablename = 'staff_applications' and policyname = 'staff_app_read'))
        and qual = '((profile_id = ( SELECT auth.uid() AS uid)) OR (is_staff() AND (NOT is_media_only_staff(( SELECT auth.uid() AS uid)))) OR is_commissioner())') <> 2 then
    raise exception 'v463 all-staff voting: owner_app_read or staff_app_read changed since 2026-11-24';
  end if;
  if to_regprocedure('public.notify_mgmt_application()') is null then
    raise exception 'v463 all-staff voting: notify_mgmt_application is missing';
  end if;
end $pre$;

create or replace function public.is_app_reviewer(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  /* v463 (commissioner, 2026-11-23): every staff member and every commissioner votes on owner, staff and front-office
     applications. The reviewer set IS the staff electorate (is_staff_voter), no longer the applications department. */
  select public.is_staff_voter(p_uid);
$function$;

create or replace function public.app_reviewer_count()
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  /* v463: how many vote on an application: the whole staff electorate (staff_voter_count) */
  select public.staff_voter_count();
$function$;

alter policy owner_app_read on public.owner_applications
  using ((profile_id = (select auth.uid())) or public.is_app_reviewer((select auth.uid())));
alter policy staff_app_read on public.staff_applications
  using ((profile_id = (select auth.uid())) or public.is_app_reviewer((select auth.uid())));

-- the GM and AGM nomination bell: every voter on the staff, by exact anchor (the reverse carries the same pairs)
do $mgmt$
declare r record; v_def text; n int;
begin
  for r in select * from (values
-- >>> patch pairs
    (1, $o$           where role = 'staff'
             and 'applications' = any(coalesce(departments, '{}'))
             and id <> new.submitted_by and id is distinct from new.nominee_id
$o$, $n$           where role = 'staff'
             and public.is_staff_voter(id)   /* v463 (commissioner, 2026-11-23): every staff member votes on GM and AGM nominations, so every voter on the staff is told */
             and id <> new.submitted_by and id is distinct from new.nominee_id
$n$),
    (2, $o$      '. The Review Board votes on the appointment $o$ || chr(8212) || $o$ you''ll be notified of the decision.',
$o$, $n$      '. The league staff vote on the appointment, and you will be told the decision.',   /* v463: the whole staff votes from the flip */
$n$)
-- <<< patch pairs
  ) as x(ord, old_text, new_text) order by x.ord loop
    v_def := pg_get_functiondef('public.notify_mgmt_application()'::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then raise exception 'v463 all-staff voting: notify_mgmt_application anchor % matched % times', r.ord, n; end if;
    execute replace(v_def, r.old_text, r.new_text);
    v_def := pg_get_functiondef('public.notify_mgmt_application()'::regprocedure);
    if (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text) <> 1 then
      raise exception 'v463 all-staff voting: notify_mgmt_application patch % did not land once', r.ord;
    end if;
  end loop;
end $mgmt$;

do $chk$
declare v_bad int;
begin
  if not exists (select 1 from pg_proc p where p.oid = 'public.is_app_reviewer(uuid)'::regprocedure and p.prosecdef
                   and 'search_path=""' = any(coalesce(p.proconfig, '{}'::text[])))
     or not exists (select 1 from pg_proc p where p.oid = 'public.app_reviewer_count()'::regprocedure and p.prosecdef
                   and 'search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))) then
    raise exception 'v463 all-staff voting: a reviewer function is not SECURITY DEFINER with an empty search_path';
  end if;
  /* CREATE OR REPLACE keeps the grants: the ballot policies call is_app_reviewer as anon too; the count stays internal */
  if not has_function_privilege('anon', 'public.is_app_reviewer(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_app_reviewer(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.app_reviewer_count()', 'EXECUTE')
     or has_function_privilege('anon', 'public.app_reviewer_count()', 'EXECUTE') then
    raise exception 'v463 all-staff voting: the reviewer functions lost or gained a grant';
  end if;
  if public.app_reviewer_count() <> public.staff_voter_count() then
    raise exception 'v463 all-staff voting: app_reviewer_count is not the staff electorate';
  end if;
  select count(*) into v_bad from public.profiles p where public.is_app_reviewer(p.id) is distinct from public.is_staff_voter(p.id);
  if v_bad <> 0 then raise exception 'v463 all-staff voting: % members are reviewers but not voters, or the reverse', v_bad; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
        and ((tablename = 'owner_applications' and policyname = 'owner_app_read') or (tablename = 'staff_applications' and policyname = 'staff_app_read'))
        and position('is_app_reviewer' in qual) > 0 and position('is_media_only_staff' in qual) = 0) <> 2 then
    raise exception 'v463 all-staff voting: an application read policy does not read every voter';
  end if;
  if position('public.is_staff_voter(id)' in pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)) = 0
     or position('''applications'' = any' in pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)) > 0
     or position('Review Board' in pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)) > 0
     or position('perform public.notify_commissioners(array[new.submitted_by]' in pg_get_functiondef('public.notify_mgmt_application()'::regprocedure)) = 0 then
    raise exception 'v463 all-staff voting: the nomination bell does not reach every voter, or lost the commissioners';
  end if;
  raise notice 'v463 all-staff voting: % voters, % to pass; pending: % owner, % staff, % front office',
    public.app_reviewer_count(), public.app_reviewer_count() / 2 + 1,
    (select count(*) from public.owner_applications where status = 'pending'),
    (select count(*) from public.staff_applications where status = 'pending'),
    (select count(*) from public.management_applications where status = 'pending');
end $chk$;
-- Applied as migration v463b_s2_all_staff_voting on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
-- <<< all-staff voting record text

-- >>> record text: sql/2026-11-24-s2-staff-copy-v463.sql
-- v463 (DRAFT, 2026-11-24; apply at the flip, T+15, THIRD, after the staff powers and the all-staff voting records,
-- never before): Season 2 staff copy. After the flip there are no departments and no reviewers (commissioner,
-- 2026-10-19: "we will remove the different departments, and we will allow every staff member to be a part of one big
-- group"; 2026-10-22: no Media role; 2026-11-23: six committees, every staffer and commissioner votes on applications,
-- the Draft and Bidding manager runs the draft and bidding tools). Database text sent to members or staff that names a
-- department, the reviewers, the review board or the Media exemption becomes false at the flip, so this record rewrites
-- it. It changes words only: every pair below swaps a message (or, in staff_vote_cast, removes a Media check that the
-- staff powers record already made unreachable), and nothing a member or staffer may do changes here.
--
-- Apply order at the flip (one owner per function, so the three records compose): 1. the staff powers record
-- (sql/2026-11-24-s2-staff-powers-v463.sql), 2. the all-staff voting record (sql/2026-11-24-s2-all-staff-voting-v463.sql),
-- 3. this record, which refuses to run before the other two. Reverse in the opposite order: this reverse first, then the
-- all-staff voting reverse, then the staff powers reverse (which refuses to run while this record stands).
-- This record owns reverse_trade, resend_trade, guard_trade_status, apply_application_decision, owner_remove_manager,
-- draft_pause, draft_resume, draft_reset_clock, draft_skip_pick, declare_forfeit, ops_exempt_game_limits,
-- ops_reschedule_game, ops_set_limit_week, rankings_set_order, rankings_clear, check_suspended_appearances,
-- strip_roles_on_departure, guard_mgmt_nominee, _mgmt_nominee_seat_block, staff_vote_cast, set_owner_app_club,
-- decide_owner_application, guard_app_insert, override_application_decision and _owner_app_autoplace; no other flip
-- record patches them. extend_suspension's department message belongs to the staff powers record, which owns that
-- function. The last five were found by this record's own sweep (2026-11-24) beside the rulebook stream's list.
--
-- The words: "the league staff" for a power every staffer now holds; "the Draft and Bidding manager" for the draft room
-- (has_department('draft') is the seated manager or a commissioner); "the league office" for a decision the staff vote
-- or a commissioner made (a commissioner may still decide alone, so "the staff vote" would be wrong for an override);
-- "a committee manager or a commissioner" for an extension (only they suspend and extend). No message branches on the
-- season: from the flip the rules these messages describe hold in every season (guard_mgmt_nominee's old path is the
-- non-market path, and the Media exemption it named is gone in every season once is_media_only_staff answers no).
--
-- Left alone, on purpose: the retired waitlist functions (waitlist_admit, waitlist_application, waitlist_remove), which
-- the application waitlist's removal record retires and which hold no row; comments inside function bodies that record
-- history; the routing keys passed to notify_department (it bells the whole staff after the staff powers record);
-- staff_vote_cast's department-scoped ballots and staff_vote_board/staff_vote_create (the staff vote tools are retired,
-- 0 used in Season 1); apply_application_decision's Media-exclusive application check (a staff application carries no
-- department from Season 2, so it cannot fire).
--
-- Each pair anchors on the full exact text read from production with pg_get_functiondef on 2026-11-24 (an em dash in
-- the old text is built with chr(8212), never typed), is asserted to match once, to land once, and to leave the old text
-- nowhere in the function; the self-checks at the end repeat that for every pair.
-- Reverse: sql/2026-11-24-s2-staff-copy-v463.reverse.sql (the same pairs, undone by exact anchor).
-- Rehearsal: sql/2026-11-24-s2-staff-copy-v463.rehearsal.sql (the staff powers and all-staff voting records, then this
-- record, the cases, this reverse). Test: tools/s2-staff-copy-v463.test.cjs.

do $pre$
begin
  if to_regprocedure('public.profile_has_department(uuid,text)') is null
     or to_regprocedure('public.request_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,uuid)') is null then
    raise exception 'v463 staff copy: apply the staff powers record first (the apply order is staff powers, all-staff voting, copy)';
  end if;
  if position('public.is_staff_voter(p_uid)' in pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure)) = 0 then
    raise exception 'v463 staff copy: apply the all-staff voting record first (the apply order is staff powers, all-staff voting, copy)';
  end if;
  if position('the Draft and Bidding manager.' in pg_get_functiondef('public.draft_pause(integer)'::regprocedure)) > 0 then
    raise exception 'v463 staff copy: already applied';
  end if;
end $pre$;

do $fwd$
declare r record; v_def text; n int;
begin
  for r in select * from (values
-- >>> patch pairs
    (1, 'public.reverse_trade(uuid,text)', $o$    raise exception 'Only the transactions department or a commissioner can reverse a trade.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can reverse a trade.';
$n$),
    (2, 'public.reverse_trade(uuid,text)', $o$  select coalesce(nullif(gamertag,''),'the transactions department') into v_who
$o$, $n$  select coalesce(nullif(gamertag,''),'the league staff') into v_who
$n$),
    (3, 'public.reverse_trade(uuid,text)', $o$    values (t.season_id, 'trade', 'The transactions department reversed the trade between <b>'||
$o$, $n$    values (t.season_id, 'trade', 'The league office reversed the trade between <b>'||
$n$),
    (4, 'public.reverse_trade(uuid,text)', $o$    'Your trade with '||v_to||' was reversed by the transactions department: '||p_reason, 'transactions', null);
$o$, $n$    'Your trade with '||v_to||' was reversed by the league office: '||p_reason, 'transactions', null);
$n$),
    (5, 'public.reverse_trade(uuid,text)', $o$    'Your trade with '||v_from||' was reversed by the transactions department: '||p_reason, 'transactions', null);
$o$, $n$    'Your trade with '||v_from||' was reversed by the league office: '||p_reason, 'transactions', null);
$n$),
    (6, 'public.resend_trade(uuid)', $o$    raise exception 'Only the transactions department or a commissioner can resend a trade.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can resend a trade.';
$n$),
    (7, 'public.guard_trade_status()', $o$accepted in the Trade Hub, and reversed by the transactions department.',
$o$, $n$accepted in the Trade Hub, and reversed by the league office.',
$n$),
    (8, 'public.apply_application_decision(text,uuid,boolean)', $o$        'The reviewer vote approved your application $o$ || chr(8212) || $o$ you now own the ' || coalesce(v_label, v_placed) ||
$o$, $n$        'The league office approved your application: you now own the ' || coalesce(v_label, v_placed) ||
$n$),
    (9, 'public.apply_application_decision(text,uuid,boolean)', $o$               then 'The reviewer vote approved your application. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
$o$, $n$               then 'The league office approved your application. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
$n$),
    (10, 'public.apply_application_decision(text,uuid,boolean)', $o$             when p_approve then 'The reviewer vote approved your application to own a club. A commissioner will hand you your club shortly.'
             else 'The reviewer vote did not approve your application to own a club this time. You can reapply any time.' end, null, null);
$o$, $n$             when p_approve then 'The league office approved your application to own a club. A commissioner will hand you your club shortly.'
             else 'The league office did not approve your application to own a club this time. You can reapply any time.' end, null, null);
$n$),
    (11, 'public.apply_application_decision(text,uuid,boolean)', $o$        v_block := 'they own or manage a club, and only Media may be held alongside a club seat';
$o$, $n$        v_block := 'they own or manage a club, and no league staff role may be held alongside a club seat';
$n$),
    (12, 'public.apply_application_decision(text,uuid,boolean)', $o$          v_name || ' was approved by the reviewer vote but the staff role was NOT granted, because '||
          v_block || ' (Rule 2.7). Narrow them to Media alone, or resolve the other side, then grant '||
$o$, $n$          v_name || ' was approved by the league office but the staff role was NOT granted, because '||
          v_block || ' (Rule 2.7). Resolve the other side first, then grant '||
$n$),
    (13, 'public.apply_application_decision(text,uuid,boolean)', $o$          'The reviewer vote approved your application, but it can''t be granted as written: '||v_block||
$o$, $n$          'The league office approved your application, but it can''t be granted as written: '||v_block||
$n$),
    (14, 'public.apply_application_decision(text,uuid,boolean)', $o$        'The reviewer vote did not approve your staff application this time. You can reapply any time.', null, null);
$o$, $n$        'The league office did not approve your staff application this time. You can reapply any time.', null, null);
$n$),
    (15, 'public.apply_application_decision(text,uuid,boolean)', $o$            v_name || ' has the reviewers'' approval as ' || v_rolelabel || ' of ' || coalesce(v_team, 'a club') ||
$o$, $n$            v_name || ' has the league office''s approval as ' || v_rolelabel || ' of ' || coalesce(v_team, 'a club') ||
$n$),
    (16, 'public.apply_application_decision(text,uuid,boolean)', $o$            'The reviewers approved ' || v_name || ', but the appointment could not be applied yet: ' || v_block ||
$o$, $n$            'The league office approved ' || v_name || ', but the appointment could not be applied yet: ' || v_block ||
$n$),
    (17, 'public.apply_application_decision(text,uuid,boolean)', $o$        'The reviewer vote did not approve '||v_name||' as your club''s '||v_rolelabel||' this time.', null, null);
$o$, $n$        'The league office did not approve '||v_name||' as your club''s '||v_rolelabel||' this time.', null, null);
$n$),
    (18, 'public.owner_remove_manager(text,text)', $o$    ' (Rule 2.6). The seat stays vacant until the Owner nominates a successor and the reviewers approve.',
$o$, $n$    ' (Rule 2.6). The seat stays vacant until the Owner nominates a successor and the staff vote approves the nomination.',
$n$),
    (19, 'public.draft_pause(integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (20, 'public.draft_resume(integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (21, 'public.draft_reset_clock(integer,integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (22, 'public.draft_skip_pick(integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (23, 'public.declare_forfeit(uuid,uuid,boolean)', $o$    raise exception 'Only a commissioner or the officiating department can declare a forfeit.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can declare a forfeit.';
$n$),
    (24, 'public.ops_exempt_game_limits(uuid,boolean,text)', $o$    raise exception 'Only a commissioner or the operations department can exempt a game from the weekly game limits.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can exempt a game from the weekly game limits.';
$n$),
    (25, 'public.ops_reschedule_game(uuid,timestamptz)', $o$    raise exception 'Only a commissioner or the operations department can move a game.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can move a game.';
$n$),
    (26, 'public.ops_set_limit_week(uuid,integer,text)', $o$    raise exception 'Only a commissioner or the operations department can rule which week a game counts toward.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can rule which week a game counts toward.';
$n$),
    (27, 'public.rankings_set_order(text[])', $o$    raise exception 'Power rankings are set by a commissioner or the media department.';
$o$, $n$    raise exception 'Power rankings are set by the league staff or a commissioner.';
$n$),
    (28, 'public.rankings_clear()', $o$    raise exception 'Power rankings are set by a commissioner or the media department.';
$o$, $n$    raise exception 'Power rankings are set by the league staff or a commissioner.';
$n$),
    (29, 'public.check_suspended_appearances(uuid)', $o$      'forfeit loss for '||v_code||' and its management has been given a written warning. Decide whether to extend their '||
      'suspension (Rule 7.2): open it on the desk and add games in steps of three.', 'staffdesk', null);
$o$, $n$      'forfeit loss for '||v_code||' and its management has been given a written warning. A committee manager or a '||
      'commissioner decides whether to extend their suspension (Rule 7.2); any other staff member files a suspension request.', 'staffdesk', null);
$n$),
    (30, 'public.check_suspended_appearances(uuid)', $o$      'management warned; the '||v_dept||' department decides an extension.', false);
$o$, $n$      'management warned; a committee manager or a commissioner decides an extension.', false);
$n$),
    (31, 'public.strip_roles_on_departure()', $o$their staff role and departments were removed with it (Rule 1.1). If the member returns, restore the role and departments under Users & roles.',
$o$, $n$their staff role was removed with it (Rule 1.1). If the member returns, restore the role under Users & roles.',
$n$),
    (32, 'public.guard_mgmt_nominee()', $o$  -- office holders can't run a club (Rule 2.7), except staff whose only department is Media
$o$, $n$  -- office holders can't run a club (Rule 2.7); v463: no Media role from Season 2, so no department is exempt
$n$),
    (33, 'public.guard_mgmt_nominee()', $o$    raise exception '% is league % and cannot hold a club management role (Rule 2.7). Media is the only exempt department.', v_name, v_role;
$o$, $n$    raise exception '% is league % and cannot hold a club management role (Rule 2.7).', v_name, v_role;
$n$),
    (34, 'public._mgmt_nominee_seat_block(uuid,text,uuid)', $o$cannot hold a club management role. No league office seat, in any department, may be held together with a club seat.', v_name, v_role),
$o$, $n$cannot hold a club management role. No league office seat may be held together with a club seat.', v_name, v_role),
$n$),
    (35, 'public.staff_vote_cast(uuid,text,text)', $o$  /* checked first, and without reference to the vote's scope $o$ || chr(8212) || $o$ Media has no ballot */
  if public.is_media_staff(me) then
    raise exception 'Media staff don''t hold a ballot on staff votes (Rule 2.7) $o$ || chr(8212) || $o$ the department reports on the league rather than deciding for it.';
  end if;
$o$, $n$  /* v463 (commissioner, 2026-10-22: "we will not have that role next season"): no Media staff from Season 2, so
     every staff member holds a ballot, and the Media check that stood here is gone (is_media_staff answers no for
     everyone since the staff powers record). */
$n$),
    (36, 'public.set_owner_app_club(uuid,text)', $o$    raise exception 'Only the Applications review board can choose the club.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can choose the club.';
$n$),
    (37, 'public.decide_owner_application(uuid,boolean,text)', $o$    raise exception 'Only a commissioner decides an application alone. Reviewers cast their vote on the application instead.';
$o$, $n$    raise exception 'Only a commissioner decides an application alone. League staff cast their vote on the application instead.';
$n$),
    (38, 'public.guard_app_insert()', $o$    raise exception 'APPLICATION: A new application is filed as pending. Only the review board or the league office decides it.'
$o$, $n$    raise exception 'APPLICATION: A new application is filed as pending. Only the staff vote or a commissioner decides it.'
$n$),
    (39, 'public.override_application_decision(text,uuid,boolean)', $o$then raise exception 'Only a commissioner can override the reviewer vote.'; end if;
$o$, $n$then raise exception 'Only a commissioner can override the staff vote.'; end if;
$n$),
    (40, 'public._owner_app_autoplace(uuid)', $o$      v_who || ' was approved before the review board chose one of their three picks, so no club was assigned. ' ||
$o$, $n$      v_who || ' was approved before the league staff chose one of their three picks, so no club was assigned. ' ||
$n$)
-- <<< patch pairs
  ) as x(ord, fn, old_text, new_text) order by x.ord loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then raise exception 'v463 staff copy: anchor % in % matched % times', r.ord, r.fn, n; end if;
    execute replace(v_def, r.old_text, r.new_text);
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text) <> 1 or position(r.old_text in v_def) > 0 then
      raise exception 'v463 staff copy: patch % in % did not land once', r.ord, r.fn;
    end if;
  end loop;
end $fwd$;

-- self-checks: the words the flip makes false are gone from every message this record owns, and the functions keep
-- their security attributes (pg_get_functiondef carries them, so CREATE OR REPLACE from it keeps them)
do $chk$
declare v_f text; v_def text; v_bad text;
begin
  foreach v_f in array array['public.reverse_trade(uuid,text)', 'public.resend_trade(uuid)', 'public.guard_trade_status()',
      'public.apply_application_decision(text,uuid,boolean)', 'public.owner_remove_manager(text,text)', 'public.draft_pause(integer)',
      'public.draft_resume(integer)', 'public.draft_reset_clock(integer,integer)', 'public.draft_skip_pick(integer)',
      'public.declare_forfeit(uuid,uuid,boolean)', 'public.ops_exempt_game_limits(uuid,boolean,text)',
      'public.ops_reschedule_game(uuid,timestamptz)', 'public.ops_set_limit_week(uuid,integer,text)',
      'public.rankings_set_order(text[])', 'public.rankings_clear()', 'public.check_suspended_appearances(uuid)',
      'public.strip_roles_on_departure()', 'public.guard_mgmt_nominee()', 'public._mgmt_nominee_seat_block(uuid,text,uuid)',
      'public.staff_vote_cast(uuid,text,text)', 'public.set_owner_app_club(uuid,text)',
      'public.decide_owner_application(uuid,boolean,text)', 'public.guard_app_insert()',
      'public.override_application_decision(text,uuid,boolean)', 'public._owner_app_autoplace(uuid)'] loop
    v_def := lower(pg_get_functiondef(v_f::regprocedure));
    select string_agg(w, ', ') into v_bad
      from unnest(array['the transactions department', 'the draft department', 'the operations department',
                        'the officiating department', 'the media department', 'department decides an extension',
                        'reviewer vote', 'the reviewers approve', 'reviewers'''' approval', 'the reviewers approved',
                        'reviewers cast', 'review board can', 'review board or the league office', 'review board chose',
                        'only media may be held', 'narrow them to media', 'media is the only exempt',
                        'in any department, may be held', 'media staff don''''t hold a ballot',
                        'staff role and departments were removed', 'decide whether to extend their']) w
     where position(w in v_def) > 0;
    if v_bad is not null then raise exception 'v463 staff copy: % still says: %', v_f, v_bad; end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_f::regprocedure) then
      raise exception 'v463 staff copy: % lost SECURITY DEFINER', v_f;
    end if;
  end loop;
end $chk$;
-- Applied as migration v463c_s2_staff_copy on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
-- <<< record text

-- C1 as X, a member
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.x'), 'role', 'authenticated')::text, true);
do $c1$
begin
  begin
    perform public.reverse_trade(gen_random_uuid(), 'Rehearsal.');
    raise exception 'C1a failed: no refusal from public.reverse_trade';
  exception when others then
    if sqlerrm <> 'Only the league staff or a commissioner can reverse a trade.' then raise; end if;
  end;
  begin
    perform public.resend_trade(gen_random_uuid());
    raise exception 'C1b failed: no refusal from public.resend_trade';
  exception when others then
    if sqlerrm <> 'Only the league staff or a commissioner can resend a trade.' then raise; end if;
  end;
  begin
    perform public.declare_forfeit(gen_random_uuid(), gen_random_uuid(), false);
    raise exception 'C1c failed: no refusal from public.declare_forfeit';
  exception when others then
    if sqlerrm <> 'Only the league staff or a commissioner can declare a forfeit.' then raise; end if;
  end;
  begin
    perform public.ops_exempt_game_limits(gen_random_uuid(), true, 'Rehearsal.');
    raise exception 'C1d failed: no refusal from public.ops_exempt_game_limits';
  exception when others then
    if sqlerrm <> 'Only the league staff or a commissioner can exempt a game from the weekly game limits.' then raise; end if;
  end;
  begin
    perform public.ops_reschedule_game(gen_random_uuid(), now());
    raise exception 'C1e failed: no refusal from public.ops_reschedule_game';
  exception when others then
    if sqlerrm <> 'Only the league staff or a commissioner can move a game.' then raise; end if;
  end;
  begin
    perform public.ops_set_limit_week(gen_random_uuid(), 1, 'Rehearsal.');
    raise exception 'C1f failed: no refusal from public.ops_set_limit_week';
  exception when others then
    if sqlerrm <> 'Only the league staff or a commissioner can rule which week a game counts toward.' then raise; end if;
  end;
  begin
    perform public.rankings_set_order(array['XXX']);
    raise exception 'C1g failed: no refusal from public.rankings_set_order';
  exception when others then
    if sqlerrm <> 'Power rankings are set by the league staff or a commissioner.' then raise; end if;
  end;
  begin
    perform public.rankings_clear();
    raise exception 'C1h failed: no refusal from public.rankings_clear';
  exception when others then
    if sqlerrm <> 'Power rankings are set by the league staff or a commissioner.' then raise; end if;
  end;
  begin
    perform public.set_owner_app_club(gen_random_uuid(), 'XXX');
    raise exception 'C1i failed: no refusal from public.set_owner_app_club';
  exception when others then
    if sqlerrm <> 'Only the league staff or a commissioner can choose the club.' then raise; end if;
  end;
end $c1$;

-- C2 as N, staff without the Draft and Bidding seat
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
do $c2$
begin
  begin
    perform public.draft_pause(current_setting('rh.snum')::int);
    raise exception 'C2a failed: no refusal from public.draft_pause';
  exception when others then
    if sqlerrm <> 'The draft room is run by a commissioner or the Draft and Bidding manager.' then raise; end if;
  end;
  begin
    perform public.draft_skip_pick(current_setting('rh.snum')::int);
    raise exception 'C2b failed: no refusal from public.draft_skip_pick';
  exception when others then
    if sqlerrm <> 'The draft room is run by a commissioner or the Draft and Bidding manager.' then raise; end if;
  end;
  begin
    perform public.decide_owner_application(gen_random_uuid(), true, null);
    raise exception 'C2c failed: no refusal from public.decide_owner_application';
  exception when others then
    if sqlerrm <> 'Only a commissioner decides an application alone. League staff cast their vote on the application instead.' then raise; end if;
  end;
  begin
    perform public.override_application_decision('staff', gen_random_uuid(), true);
    raise exception 'C2d failed: no refusal from public.override_application_decision';
  exception when others then
    if sqlerrm <> 'Only a commissioner can override the staff vote.' then raise; end if;
  end;
end $c2$;

-- C3 a staff application denied by a commissioner alone
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.m'), 'role', 'authenticated')::text, true);
do $c3a$
declare v_id uuid;
begin
  insert into public.staff_applications (profile_id, pitch, departments)
  values (current_setting('rh.m')::uuid, 'Rehearsal copy pitch.', array['community'])
  returning id into v_id;
  perform set_config('rh.m_app', v_id::text, true);
end $c3a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $c3b$
begin
  perform public.override_application_decision('staff', current_setting('rh.m_app')::uuid, false);
end $c3b$;
reset role;
select set_config('request.jwt.claims', '', true);
do $c3c$
begin
  if (select sa.status from public.staff_applications sa where sa.id = current_setting('rh.m_app')::uuid) <> 'denied'
     or (select count(*) from public.notifications n where n.profile_id = current_setting('rh.m')::uuid
           and n.body = 'The league office did not approve your staff application this time. You can reapply any time.') <> 1 then
    raise exception 'C3 failed: the denial did not reach the member in the new words';
  end if;
end $c3c$;

-- >>> reverse text: sql/2026-11-24-s2-staff-copy-v463.reverse.sql
-- v463 REVERSE (DRAFT, 2026-11-24): undoes sql/2026-11-24-s2-staff-copy-v463.sql if the flip is rolled back (PLAN
-- section 8: restore the deploy, git revert, then the reverse migrations in the opposite order of the apply: this one
-- first, then the all-staff voting reverse, then the staff powers reverse, which refuses to run while this record stands).
-- The words come back exactly as they were on 2026-11-24 (the departments, the reviewers, the review board, the Media
-- exemption), because the powers they describe come back with the other two reverses: the forward record's pairs, byte
-- for byte, undone by exact anchor, last first (each new text asserted to stand once, and the old one to stand once
-- after), so a later change to another part of the same function survives the reverse. Apply as migration
-- v463_s2_staff_copy_reverse. Rehearsed inside sql/2026-11-24-s2-staff-copy-v463.rehearsal.sql.

do $pre$
begin
  if position('the Draft and Bidding manager.' in pg_get_functiondef('public.draft_pause(integer)'::regprocedure)) = 0 then
    raise exception 'v463 staff copy reverse: the staff copy is not applied, so there is nothing to reverse';
  end if;
end $pre$;

do $rev$
declare r record; v_def text; n int;
begin
  for r in select * from (values
-- >>> patch pairs
    (1, 'public.reverse_trade(uuid,text)', $o$    raise exception 'Only the transactions department or a commissioner can reverse a trade.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can reverse a trade.';
$n$),
    (2, 'public.reverse_trade(uuid,text)', $o$  select coalesce(nullif(gamertag,''),'the transactions department') into v_who
$o$, $n$  select coalesce(nullif(gamertag,''),'the league staff') into v_who
$n$),
    (3, 'public.reverse_trade(uuid,text)', $o$    values (t.season_id, 'trade', 'The transactions department reversed the trade between <b>'||
$o$, $n$    values (t.season_id, 'trade', 'The league office reversed the trade between <b>'||
$n$),
    (4, 'public.reverse_trade(uuid,text)', $o$    'Your trade with '||v_to||' was reversed by the transactions department: '||p_reason, 'transactions', null);
$o$, $n$    'Your trade with '||v_to||' was reversed by the league office: '||p_reason, 'transactions', null);
$n$),
    (5, 'public.reverse_trade(uuid,text)', $o$    'Your trade with '||v_from||' was reversed by the transactions department: '||p_reason, 'transactions', null);
$o$, $n$    'Your trade with '||v_from||' was reversed by the league office: '||p_reason, 'transactions', null);
$n$),
    (6, 'public.resend_trade(uuid)', $o$    raise exception 'Only the transactions department or a commissioner can resend a trade.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can resend a trade.';
$n$),
    (7, 'public.guard_trade_status()', $o$accepted in the Trade Hub, and reversed by the transactions department.',
$o$, $n$accepted in the Trade Hub, and reversed by the league office.',
$n$),
    (8, 'public.apply_application_decision(text,uuid,boolean)', $o$        'The reviewer vote approved your application $o$ || chr(8212) || $o$ you now own the ' || coalesce(v_label, v_placed) ||
$o$, $n$        'The league office approved your application: you now own the ' || coalesce(v_label, v_placed) ||
$n$),
    (9, 'public.apply_application_decision(text,uuid,boolean)', $o$               then 'The reviewer vote approved your application. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
$o$, $n$               then 'The league office approved your application. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
$n$),
    (10, 'public.apply_application_decision(text,uuid,boolean)', $o$             when p_approve then 'The reviewer vote approved your application to own a club. A commissioner will hand you your club shortly.'
             else 'The reviewer vote did not approve your application to own a club this time. You can reapply any time.' end, null, null);
$o$, $n$             when p_approve then 'The league office approved your application to own a club. A commissioner will hand you your club shortly.'
             else 'The league office did not approve your application to own a club this time. You can reapply any time.' end, null, null);
$n$),
    (11, 'public.apply_application_decision(text,uuid,boolean)', $o$        v_block := 'they own or manage a club, and only Media may be held alongside a club seat';
$o$, $n$        v_block := 'they own or manage a club, and no league staff role may be held alongside a club seat';
$n$),
    (12, 'public.apply_application_decision(text,uuid,boolean)', $o$          v_name || ' was approved by the reviewer vote but the staff role was NOT granted, because '||
          v_block || ' (Rule 2.7). Narrow them to Media alone, or resolve the other side, then grant '||
$o$, $n$          v_name || ' was approved by the league office but the staff role was NOT granted, because '||
          v_block || ' (Rule 2.7). Resolve the other side first, then grant '||
$n$),
    (13, 'public.apply_application_decision(text,uuid,boolean)', $o$          'The reviewer vote approved your application, but it can''t be granted as written: '||v_block||
$o$, $n$          'The league office approved your application, but it can''t be granted as written: '||v_block||
$n$),
    (14, 'public.apply_application_decision(text,uuid,boolean)', $o$        'The reviewer vote did not approve your staff application this time. You can reapply any time.', null, null);
$o$, $n$        'The league office did not approve your staff application this time. You can reapply any time.', null, null);
$n$),
    (15, 'public.apply_application_decision(text,uuid,boolean)', $o$            v_name || ' has the reviewers'' approval as ' || v_rolelabel || ' of ' || coalesce(v_team, 'a club') ||
$o$, $n$            v_name || ' has the league office''s approval as ' || v_rolelabel || ' of ' || coalesce(v_team, 'a club') ||
$n$),
    (16, 'public.apply_application_decision(text,uuid,boolean)', $o$            'The reviewers approved ' || v_name || ', but the appointment could not be applied yet: ' || v_block ||
$o$, $n$            'The league office approved ' || v_name || ', but the appointment could not be applied yet: ' || v_block ||
$n$),
    (17, 'public.apply_application_decision(text,uuid,boolean)', $o$        'The reviewer vote did not approve '||v_name||' as your club''s '||v_rolelabel||' this time.', null, null);
$o$, $n$        'The league office did not approve '||v_name||' as your club''s '||v_rolelabel||' this time.', null, null);
$n$),
    (18, 'public.owner_remove_manager(text,text)', $o$    ' (Rule 2.6). The seat stays vacant until the Owner nominates a successor and the reviewers approve.',
$o$, $n$    ' (Rule 2.6). The seat stays vacant until the Owner nominates a successor and the staff vote approves the nomination.',
$n$),
    (19, 'public.draft_pause(integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (20, 'public.draft_resume(integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (21, 'public.draft_reset_clock(integer,integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (22, 'public.draft_skip_pick(integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (23, 'public.declare_forfeit(uuid,uuid,boolean)', $o$    raise exception 'Only a commissioner or the officiating department can declare a forfeit.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can declare a forfeit.';
$n$),
    (24, 'public.ops_exempt_game_limits(uuid,boolean,text)', $o$    raise exception 'Only a commissioner or the operations department can exempt a game from the weekly game limits.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can exempt a game from the weekly game limits.';
$n$),
    (25, 'public.ops_reschedule_game(uuid,timestamptz)', $o$    raise exception 'Only a commissioner or the operations department can move a game.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can move a game.';
$n$),
    (26, 'public.ops_set_limit_week(uuid,integer,text)', $o$    raise exception 'Only a commissioner or the operations department can rule which week a game counts toward.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can rule which week a game counts toward.';
$n$),
    (27, 'public.rankings_set_order(text[])', $o$    raise exception 'Power rankings are set by a commissioner or the media department.';
$o$, $n$    raise exception 'Power rankings are set by the league staff or a commissioner.';
$n$),
    (28, 'public.rankings_clear()', $o$    raise exception 'Power rankings are set by a commissioner or the media department.';
$o$, $n$    raise exception 'Power rankings are set by the league staff or a commissioner.';
$n$),
    (29, 'public.check_suspended_appearances(uuid)', $o$      'forfeit loss for '||v_code||' and its management has been given a written warning. Decide whether to extend their '||
      'suspension (Rule 7.2): open it on the desk and add games in steps of three.', 'staffdesk', null);
$o$, $n$      'forfeit loss for '||v_code||' and its management has been given a written warning. A committee manager or a '||
      'commissioner decides whether to extend their suspension (Rule 7.2); any other staff member files a suspension request.', 'staffdesk', null);
$n$),
    (30, 'public.check_suspended_appearances(uuid)', $o$      'management warned; the '||v_dept||' department decides an extension.', false);
$o$, $n$      'management warned; a committee manager or a commissioner decides an extension.', false);
$n$),
    (31, 'public.strip_roles_on_departure()', $o$their staff role and departments were removed with it (Rule 1.1). If the member returns, restore the role and departments under Users & roles.',
$o$, $n$their staff role was removed with it (Rule 1.1). If the member returns, restore the role under Users & roles.',
$n$),
    (32, 'public.guard_mgmt_nominee()', $o$  -- office holders can't run a club (Rule 2.7), except staff whose only department is Media
$o$, $n$  -- office holders can't run a club (Rule 2.7); v463: no Media role from Season 2, so no department is exempt
$n$),
    (33, 'public.guard_mgmt_nominee()', $o$    raise exception '% is league % and cannot hold a club management role (Rule 2.7). Media is the only exempt department.', v_name, v_role;
$o$, $n$    raise exception '% is league % and cannot hold a club management role (Rule 2.7).', v_name, v_role;
$n$),
    (34, 'public._mgmt_nominee_seat_block(uuid,text,uuid)', $o$cannot hold a club management role. No league office seat, in any department, may be held together with a club seat.', v_name, v_role),
$o$, $n$cannot hold a club management role. No league office seat may be held together with a club seat.', v_name, v_role),
$n$),
    (35, 'public.staff_vote_cast(uuid,text,text)', $o$  /* checked first, and without reference to the vote's scope $o$ || chr(8212) || $o$ Media has no ballot */
  if public.is_media_staff(me) then
    raise exception 'Media staff don''t hold a ballot on staff votes (Rule 2.7) $o$ || chr(8212) || $o$ the department reports on the league rather than deciding for it.';
  end if;
$o$, $n$  /* v463 (commissioner, 2026-10-22: "we will not have that role next season"): no Media staff from Season 2, so
     every staff member holds a ballot, and the Media check that stood here is gone (is_media_staff answers no for
     everyone since the staff powers record). */
$n$),
    (36, 'public.set_owner_app_club(uuid,text)', $o$    raise exception 'Only the Applications review board can choose the club.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can choose the club.';
$n$),
    (37, 'public.decide_owner_application(uuid,boolean,text)', $o$    raise exception 'Only a commissioner decides an application alone. Reviewers cast their vote on the application instead.';
$o$, $n$    raise exception 'Only a commissioner decides an application alone. League staff cast their vote on the application instead.';
$n$),
    (38, 'public.guard_app_insert()', $o$    raise exception 'APPLICATION: A new application is filed as pending. Only the review board or the league office decides it.'
$o$, $n$    raise exception 'APPLICATION: A new application is filed as pending. Only the staff vote or a commissioner decides it.'
$n$),
    (39, 'public.override_application_decision(text,uuid,boolean)', $o$then raise exception 'Only a commissioner can override the reviewer vote.'; end if;
$o$, $n$then raise exception 'Only a commissioner can override the staff vote.'; end if;
$n$),
    (40, 'public._owner_app_autoplace(uuid)', $o$      v_who || ' was approved before the review board chose one of their three picks, so no club was assigned. ' ||
$o$, $n$      v_who || ' was approved before the league staff chose one of their three picks, so no club was assigned. ' ||
$n$)
-- <<< patch pairs
  ) as x(ord, fn, old_text, new_text) order by x.ord desc loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text);
    if n <> 1 then raise exception 'v463 staff copy reverse: patch % in % stands % times', r.ord, r.fn, n; end if;
    execute replace(v_def, r.new_text, r.old_text);
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text) <> 1 or position(r.new_text in v_def) > 0 then
      raise exception 'v463 staff copy reverse: anchor % in % did not come back once', r.ord, r.fn;
    end if;
  end loop;
end $rev$;

do $chk$
begin
  if position('the Draft and Bidding manager.' in pg_get_functiondef('public.draft_pause(integer)'::regprocedure)) > 0
     or position('the transactions department or a commissioner can reverse a trade' in pg_get_functiondef('public.reverse_trade(uuid,text)'::regprocedure)) = 0 then
    raise exception 'v463 staff copy reverse: the 2026-11-24 words did not come back';
  end if;
end $chk$;
-- <<< reverse text

-- C4 the reverse restores the words byte for byte
do $c4$
begin
  if md5((select string_agg(pg_get_functiondef(f::regprocedure), '|' order by f) from unnest(array['public.reverse_trade(uuid,text)', 'public.resend_trade(uuid)', 'public.guard_trade_status()',
      'public.apply_application_decision(text,uuid,boolean)', 'public.owner_remove_manager(text,text)', 'public.draft_pause(integer)',
      'public.draft_resume(integer)', 'public.draft_reset_clock(integer,integer)', 'public.draft_skip_pick(integer)',
      'public.declare_forfeit(uuid,uuid,boolean)', 'public.ops_exempt_game_limits(uuid,boolean,text)',
      'public.ops_reschedule_game(uuid,timestamptz)', 'public.ops_set_limit_week(uuid,integer,text)',
      'public.rankings_set_order(text[])', 'public.rankings_clear()', 'public.check_suspended_appearances(uuid)',
      'public.strip_roles_on_departure()', 'public.guard_mgmt_nominee()', 'public._mgmt_nominee_seat_block(uuid,text,uuid)',
      'public.staff_vote_cast(uuid,text,text)', 'public.set_owner_app_club(uuid,text)',
      'public.decide_owner_application(uuid,boolean,text)', 'public.guard_app_insert()',
      'public.override_application_decision(text,uuid,boolean)', 'public._owner_app_autoplace(uuid)']) f)) <> current_setting('rh.fp') then
    raise exception 'C4 failed: the copy reverse did not restore the twenty-five functions byte for byte';
  end if;
end $c4$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.x'), 'role', 'authenticated')::text, true);
do $c4b$
begin
  begin
    perform public.draft_pause(current_setting('rh.snum')::int);
    raise exception 'C4b failed: no refusal from public.draft_pause';
  exception when others then
    if sqlerrm <> 'The draft room is run by a commissioner or the draft department.' then raise; end if;
  end;
end $c4b$;
reset role;
select set_config('request.jwt.claims', '', true);

-- the verdict
do $v$
begin
  raise exception 'REHEARSAL OK: C0 C1a C1b C1c C1d C1e C1f C1g C1h C1i C2a C2b C2c C2d C3 C4 C4b (season %)', current_setting('rh.snum');
end $v$;
