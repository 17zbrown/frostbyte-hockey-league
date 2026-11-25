-- Rehearsal for sql/2026-11-24-s2-staff-powers-v463.sql AND its reverse, sql/2026-11-24-s2-staff-powers-v463.reverse.sql.
-- The main session runs it on production as ONE transaction that ends in an uncaught raise, so everything rolls back
-- (CLAUDE.md, Database change protocol step 2). Agents never run it. It carries both texts byte for byte
-- (tools/s2-staff-powers-v463.test.cjs pins them).
--
-- Prerequisites: the committees record (sql/2026-11-24-s2-committees-*.sql) is live, or its text is pasted right after
-- "begin;" (the first block refuses to run without it; the committees record itself needs the bid-night record), and at
-- least one committee seat is open. The all-staff voting record is not needed.
--
-- pg_net is transactional: the notices this rehearsal queues (S9) never leave, and the checks read them only inside the
-- transaction, comparing webhook URLs in SQL without printing them. After it (outside the transaction), these must all
-- return nothing (row counts move on their own on production, so the check is on what this rehearsal alone would leave):
--   select 1 where to_regprocedure('public.request_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,uuid)') is not null;
--   select id from public.ban_events where reason = 'Rehearsal ban reason.';
--   select id from public.suspensions where reason like 'Rehearsal%';
--   select id from public.action_requests where details = 'Rehearsal appeal.';
--   select 1 from pg_attribute a where a.attrelid = 'public.ban_events'::regclass and a.attname = 'actor_id';
--
-- People, picked inside the transaction by id order (no ids in this file): K the first commissioner; N the first staff
-- member, not banned, outside the statistics and transactions departments with no seat; G the next staff member, not
-- banned, with no seat and no pending seat application, seated in S4 on the first open committee (2026-11-24: N was
-- picked without the ban and was a banned staffer, and S1 passed, which showed the opened gates handed a banned staffer
-- every key; the record now reads the ban, and its self-check proves a banned staffer holds none); X1, X2, X3 the first
-- three members who are not banned, have never held a roster spot or a club seat, and have no suspension running or
-- served this season; V the first staff member with Media among their departments (none may exist: S11 then reports
-- "skipped"); W the first pending registrant of the newest season not yet complete with no active roster spot and no
-- owner application (S9d; the season's sign-up is opened inside the transaction if it has closed).
-- Cases:
--   S0  the nine gate functions, the notice triggers and the discipline, news and trade policies are fingerprinted.
--   S1  after the record, N (no department for it) holds statistics, transactions and operations, and is_stats_staff and
--       _is_stats_staff answer yes; the draft key and can_run_market answer no.
--   S2  N cannot suspend X1, and can still warn X1.
--   S3  N files suspension requests: X2 for 10 days, X3 for 20, X1 for 3 and 4 (r1 to r4); against G, against K, X1 for
--       the season and X1 for 21 games (r6 to r9).
--   S4  G is seated as a committee manager through the committee doors (a commissioner's decision).
--   S5  G cannot suspend past 14 days, suspends X1 for 10, and cannot extend that past 14; S5d with the suspension
--       moved back nine days, G cannot extend it 5 more days (past 14 from the day it was issued) but can extend it 1.
--   S6  N cannot lift it; G can; S6c N withdraws the warning N gave.
--   S7  requests: G approves X2's 10 days; G can neither approve nor deny X3's 20, nor the season or 21 games, nor the
--       request about G, nor the one about K, nor one G filed (r5), and a null choice is refused; N cannot decide at all;
--       K approves the 20 days and denies r5; K's denial needs a reason; only the filer withdraws.
--   S13 X3 appeals K's suspension through the table door: N (no seat) cannot decide it; G decides it and lifts it.
--   S8  K bans and unbans X1 through the real doors; both ban_events rows name K in actor_id (2026-11-24: the first run
--       failed here, record "new" has no field "by", because BY is reserved in PL/pgSQL; the record renames the column).
--   S9  the two lifts, the withdrawn warning, the ban and the unban queued their staff notices, every staff notice went to
--       #staff-casework, a post named for the welcome channel goes there too (found by its own text), and W's sign-up
--       withdrawal (S9d) posts to #staff-casework through notify_staff_ch, not to the general staff webhook.
--   S10 a department bell reaches every staff member who is not banned and every commissioner.
--   S11 the Media helpers answer no for a Media staffer.
--   S14 a committee manager's second suspension of a member this season is refused unless the length they set is kept
--       (p_keep_length), and with it kept it stands as set, never the rest of the season (X1's lifted suspension is
--       marked served first, as the table owner, so X1 has one this season).
--   S15 N's request for X3 (also marked served) for 6 days, approved by G, issues exactly 6 days, not the rest of the season.
--   S16 extensions: a request against X2, who serves G's 10 days, in games is refused (it must be in days), one off the
--       steps of three is refused, two in days are filed as extensions of the running one; G approves 2 more days, G
--       cannot approve 5 more (past 14 days from the day it was issued), K approves them; X2 still has one suspension,
--       7 days longer, and both requests point at it.
--   S17 an appeal by a member of league staff: K suspends N, N appeals, G (a committee manager) cannot decide it, K can.
--   S18 profile_has_department, the door the Netlify statistics gates ask, answers as has_department: N holds
--       statistics and not draft, K holds draft, a member and a banned staffer hold nothing.
--   S12 after the reverse: the S0 fingerprint is back (ban_player, unban_player and the ban_events columns included), N
--       holds no department power again, the requests table is kept with no API access, and the suspensions issued while
--       the powers ran stay.

begin;

do $pre$
begin
  if to_regprocedure('public.is_committee_manager(uuid,text)') is null then
    raise exception 'REHEARSAL CANNOT RUN: the committees record must be live, or its text pasted right after begin';
  end if;
end $pre$;

-- S0 and the people
do $p$
declare v_k uuid; v_n uuid; v_g uuid; v_x uuid[]; v_v uuid; v_key text; v_s uuid := public.current_season_id(); v_w uuid; v_ws uuid;
begin
  perform set_config('rh.fp', md5(
    (select string_agg(pg_get_functiondef(f::regprocedure), '|' order by f)
       from unnest(array['public.has_department(text)', 'public._is_stats_staff()', 'public.is_media_staff(uuid)',
                         'public.is_media_only_staff(uuid)', 'public.notify_department(text,text,text,text,text,text)',
                         'public.notify_staff_ch(text,text,boolean)',
                         'public._issue_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,boolean,uuid)',
                         'public.extend_suspension(uuid,integer,integer,text)', 'public.lift_suspension(uuid)',
                         'public.guard_appeal_decider()', 'public.withdraw_registration(uuid)',
                         'public.ban_player(uuid,text)', 'public.unban_player(uuid)']) f)
    || (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
         where a.attrelid = 'public.ban_events'::regclass and a.attnum > 0 and not a.attisdropped)
    || (select coalesce(string_agg(t.tgname, ',' order by t.tgname), '') from pg_trigger t
         where not t.tgisinternal and t.tgrelid in ('public.ban_events'::regclass, 'public.suspensions'::regclass))
    || (select string_agg(x.tablename || ':' || x.policyname || ':' || coalesce(x.qual, '') || ':' || coalesce(x.with_check, ''), '|'
                          order by x.tablename, x.policyname)
          from pg_policies x where x.schemaname = 'public' and x.tablename in ('suspensions', 'ban_events', 'news', 'trades'))), true);
  perform set_config('rh.q0', coalesce((select max(q.id) from net.http_request_queue q), 0)::text, true);
  select p.id into v_k from public.profiles p where p.role = 'commissioner' order by p.id limit 1;
  select p.id into v_n from public.profiles p where p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id)
     and not ('statistics' = any(coalesce(p.departments, '{}'::text[]))) and not ('transactions' = any(coalesce(p.departments, '{}'::text[])))
     and public.committee_of(p.id) = '{}'::text[] order by p.id limit 1;
  select p.id into v_g from public.profiles p where p.role = 'staff' and not p.banned and not public.is_staff_suspended(p.id) and p.id <> v_n
     and public.committee_of(p.id) = '{}'::text[]
     and not exists (select 1 from public.committee_applications a where a.profile_id = p.id and a.status = 'pending')
   order by p.id limit 1;
  select c.key into v_key from public.committees c where c.manager_profile_id is null order by c.sort limit 1;
  select array_agg(z.id order by z.id) into v_x from (
    select p.id from public.profiles p
     where p.role = 'member' and not coalesce(p.banned, false)
       and not exists (select 1 from public.roster_spots rs where rs.profile_id = p.id)
       and not public.holds_club_seat(p.id)
       and not exists (select 1 from public.suspensions s where s.profile_id = p.id
                         and ((s.status = 'active' and public.suspension_running_at(s, now()))
                           or (s.mode <> 'warning' and s.status in ('active', 'served') and s.season_id = v_s)))
     order by p.id limit 3) z;
  select p.id into v_v from public.profiles p where p.role = 'staff' and 'media' = any(coalesce(p.departments, '{}'::text[])) order by p.id limit 1;
  if v_k is null or v_n is null or v_g is null or v_key is null or coalesce(array_length(v_x, 1), 0) < 3 then
    raise exception 'REHEARSAL CANNOT RUN: the people or an open seat are missing (K %, N %, G %, seat %, X %)',
      v_k is not null, v_n is not null, v_g is not null, v_key, coalesce(array_length(v_x, 1), 0);
  end if;
  perform set_config('rh.k', v_k::text, true);
  perform set_config('rh.n', v_n::text, true);
  perform set_config('rh.g', v_g::text, true);
  perform set_config('rh.key', v_key, true);
  perform set_config('rh.x1', v_x[1]::text, true);
  perform set_config('rh.x2', v_x[2]::text, true);
  perform set_config('rh.x3', v_x[3]::text, true);
  perform set_config('rh.v', coalesce(v_v::text, ''), true);
  select r.profile_id, r.season_id into v_w, v_ws from public.season_registrations r join public.seasons se on se.id = r.season_id
   where r.status::text = 'pending' and se.status::text <> 'complete'
     and r.profile_id <> all (array[v_k, v_n, v_g] || v_x)
     and not exists (select 1 from public.roster_spots rs where rs.season_id = r.season_id and rs.profile_id = r.profile_id and rs.status = 'active')
     and not exists (select 1 from public.owner_applications oa where oa.profile_id = r.profile_id)
   order by se.number desc, r.profile_id limit 1;
  if v_w is null then raise exception 'REHEARSAL CANNOT RUN: no pending registrant for S9d'; end if;
  perform set_config('rh.w', v_w::text, true);
  perform set_config('rh.ws', v_ws::text, true);
  perform set_config('rh.snum', (select se.number::text from public.seasons se where se.id = v_s), true);
  perform set_config('rh.voters', (select count(*) from public.profiles p
                                    where p.role = 'commissioner' or (p.role = 'staff' and not p.banned))::text, true);
end $p$;

-- >>> record text: sql/2026-11-24-s2-staff-powers-v463.sql
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
-- <<< record text

-- S1 to S3 as N
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
do $s1$
begin
  if not (public.has_department('statistics') and public.has_department('transactions') and public.has_department('operations')
          and public.is_stats_staff() and public._is_stats_staff()) then
    raise exception 'S1 failed: a staff member outside the departments does not hold their powers';
  end if;
  if public.has_department('draft') or public.can_run_market() then
    raise exception 'S1 failed: a staff member without the Draft and Bidding seat holds the draft tools';
  end if;
end $s1$;
do $s2$
declare v_w uuid;
begin
  begin
    perform public.suspend_player(current_setting('rh.x1')::uuid, 'date', now() + interval '5 days', null, 'Rehearsal reason.');
    raise exception 'S2a failed: a staff member without a seat suspended a member';
  exception when others then
    if sqlerrm <> 'Only a committee manager or a commissioner can suspend a member. File a suspension request instead, and a committee manager or a commissioner acts on it.' then raise; end if;
  end;
  v_w := public.suspend_player(current_setting('rh.x1')::uuid, 'warning', null, null, 'Rehearsal warning.');
  if v_w is null then raise exception 'S2b failed: a staff member could not warn'; end if;
  perform set_config('rh.warn', v_w::text, true);
end $s2$;
do $s3$
begin
  perform set_config('rh.r1', public.request_suspension(current_setting('rh.x2')::uuid, 'date', null, now() + interval '10 days', null, 'Rehearsal: ten days.')->>'id', true);
  perform set_config('rh.r2', public.request_suspension(current_setting('rh.x3')::uuid, 'date', null, now() + interval '20 days', null, 'Rehearsal: twenty days.')->>'id', true);
  perform set_config('rh.r3', public.request_suspension(current_setting('rh.x1')::uuid, 'date', null, now() + interval '3 days', null, 'Rehearsal: three days.')->>'id', true);
  perform set_config('rh.r4', public.request_suspension(current_setting('rh.x1')::uuid, 'date', null, now() + interval '4 days', null, 'Rehearsal: withdraw me.')->>'id', true);
  perform set_config('rh.r6', public.request_suspension(current_setting('rh.g')::uuid, 'date', null, now() + interval '3 days', null, 'Rehearsal: about G.')->>'id', true);
  perform set_config('rh.r7', public.request_suspension(current_setting('rh.k')::uuid, 'date', null, now() + interval '3 days', null, 'Rehearsal: about K.')->>'id', true);
  perform set_config('rh.r8', public.request_suspension(current_setting('rh.x1')::uuid, 'seasons', null, null, current_setting('rh.snum')::int, 'Rehearsal: the season.')->>'id', true);
  perform set_config('rh.r9', public.request_suspension(current_setting('rh.x1')::uuid, 'games', 21, null, null, 'Rehearsal: 21 games.')->>'id', true);
end $s3$;

-- S4: G is seated through the committee doors
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.g'), 'role', 'authenticated')::text, true);
do $s4a$
begin
  perform set_config('rh.g_app', public.apply_committee_seat(current_setting('rh.key'), 'Rehearsal pitch.')->>'id', true);
end $s4a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $s4b$
begin
  perform public.override_application_decision('committee', current_setting('rh.g_app')::uuid, true);
end $s4b$;

-- S5 and S6
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.g'), 'role', 'authenticated')::text, true);
do $s5$
declare v_s uuid;
begin
  if not public.is_any_committee_manager(current_setting('rh.g')::uuid) then raise exception 'S5a failed: G is not a committee manager'; end if;
  begin
    perform public.suspend_player(current_setting('rh.x1')::uuid, 'date', now() + interval '20 days', null, 'Rehearsal: too long.');
    raise exception 'S5b failed: a committee manager suspended past 14 days';
  exception when others then
    if sqlerrm not like 'A committee manager can suspend to a date up to 14 days away.%' then raise; end if;
  end;
  v_s := public.suspend_player(current_setting('rh.x1')::uuid, 'date', now() + interval '10 days', null, 'Rehearsal: ten days.');
  perform set_config('rh.s1', v_s::text, true);
  begin
    perform public.extend_suspension(v_s, null, 10, 'Rehearsal extension.');
    raise exception 'S5c failed: a committee manager extended past 14 days';
  exception when others then
    if sqlerrm not like 'A committee manager can extend a dated suspension to at most 14 days from the day it was issued.%' then raise; end if;
  end;
end $s5$;
/* S5d: the ceiling counts from the day it was issued, not from today; the suspension is moved back nine days (as the
   table owner, inside the rolled-back transaction) and four days are left on it */
reset role;
do $s5d0$
declare v_n int;
begin
  update public.suspensions set created_at = now() - interval '9 days', ends_at = now() + interval '4 days'
   where id = current_setting('rh.s1')::uuid and status = 'active';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'S5d failed: the suspension could not be moved back nine days'; end if;
end $s5d0$;
set local role authenticated;
do $s5d$
begin
  begin
    perform public.extend_suspension(current_setting('rh.s1')::uuid, null, 5, 'Rehearsal: past 14 days from the start.');
    raise exception 'S5d failed: a committee manager extended past 14 days from the day it was issued';
  exception when others then
    if sqlerrm not like 'A committee manager can extend a dated suspension to at most 14 days from the day it was issued.%' then raise; end if;
  end;
  perform public.extend_suspension(current_setting('rh.s1')::uuid, null, 1, 'Rehearsal: inside 14 days from the start.');
end $s5d$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
do $s6a$
begin
  perform public.lift_suspension(current_setting('rh.s1')::uuid);
  raise exception 'S6a failed: a staff member without a seat lifted a suspension';
exception when others then
  if sqlerrm <> 'Only a committee manager or a commissioner can lift a suspension. A staff member may withdraw a warning they gave.' then raise; end if;
end $s6a$;
do $s6c$
begin
  perform public.lift_suspension(current_setting('rh.warn')::uuid);
end $s6c$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.g'), 'role', 'authenticated')::text, true);
do $s6b$
begin
  perform public.lift_suspension(current_setting('rh.s1')::uuid);
end $s6b$;

-- S7: the requests
do $s7a$
declare j jsonb;
begin
  j := public.decide_suspension_request(current_setting('rh.r1')::uuid, true, null);
  if j->>'status' is distinct from 'approved' or j->>'suspension' is null then raise exception 'S7a failed: %', j; end if;
  perform set_config('rh.s2', j->>'suspension', true);
  begin
    perform public.decide_suspension_request(current_setting('rh.r2')::uuid, true, null);
    raise exception 'S7b failed: a committee manager approved 20 days';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: This request is past a committee manager''s limit (14 days or 18 games), so a commissioner decides it.' then raise; end if;
  end;
  begin
    perform public.decide_suspension_request(current_setting('rh.r2')::uuid, false, 'Rehearsal: no.');
    raise exception 'S7i failed: a committee manager denied 20 days';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: This request is past a committee manager''s limit (14 days or 18 games), so a commissioner decides it.' then raise; end if;
  end;
  begin
    perform public.decide_suspension_request(current_setting('rh.r8')::uuid, false, 'Rehearsal: no.');
    raise exception 'S7i failed: a committee manager denied a season-long request';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: This request is past a committee manager''s limit (14 days or 18 games), so a commissioner decides it.' then raise; end if;
  end;
  begin
    perform public.decide_suspension_request(current_setting('rh.r9')::uuid, false, 'Rehearsal: no.');
    raise exception 'S7i failed: a committee manager denied 21 games';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: This request is past a committee manager''s limit (14 days or 18 games), so a commissioner decides it.' then raise; end if;
  end;
  begin
    perform public.decide_suspension_request(current_setting('rh.r6')::uuid, false, 'Rehearsal: no.');
    raise exception 'S7j failed: a committee manager denied a request about themselves';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: This request is about you, so a commissioner decides it.' then raise; end if;
  end;
  begin
    perform public.decide_suspension_request(current_setting('rh.r7')::uuid, false, 'Rehearsal: no.');
    raise exception 'S7k failed: a committee manager denied a request about a commissioner';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: Only a commissioner decides a request about league staff or a commissioner (Rule 7.2).' then raise; end if;
  end;
  begin
    perform public.decide_suspension_request(current_setting('rh.r3')::uuid, null, null);
    raise exception 'S7m failed: a null choice was taken as a decision';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: Choose approve or deny.' then raise; end if;
  end;
  perform set_config('rh.r5', public.request_suspension(current_setting('rh.x3')::uuid, 'date', null, now() + interval '3 days', null, 'Rehearsal: filed by G.')->>'id', true);
  begin
    perform public.decide_suspension_request(current_setting('rh.r5')::uuid, false, 'Rehearsal: no.');
    raise exception 'S7l failed: a committee manager denied a request they filed';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: You filed this request, so another committee manager or a commissioner decides it.' then raise; end if;
  end;
  begin
    perform public.withdraw_suspension_request(current_setting('rh.r4')::uuid);
    raise exception 'S7f failed: someone other than the filer withdrew a request';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: Only the staff member who filed it may withdraw it.' then raise; end if;
  end;
end $s7a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
do $s7c$
declare j jsonb;
begin
  begin
    perform public.decide_suspension_request(current_setting('rh.r2')::uuid, true, null);
    raise exception 'S7c failed: a staff member without a seat decided a request';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: Only a committee manager or a commissioner decides a suspension request.' then raise; end if;
  end;
  j := public.withdraw_suspension_request(current_setting('rh.r4')::uuid);
  if j->>'status' is distinct from 'withdrawn' then raise exception 'S7g failed: %', j; end if;
end $s7c$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $s7d$
declare j jsonb;
begin
  j := public.decide_suspension_request(current_setting('rh.r2')::uuid, true, null);
  if j->>'status' is distinct from 'approved' then raise exception 'S7d failed: %', j; end if;
  perform set_config('rh.s3', j->>'suspension', true);
  begin
    perform public.decide_suspension_request(current_setting('rh.r3')::uuid, false, '  ');
    raise exception 'S7e failed: a denial went through with no reason';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: Say why it is denied. The staff member who filed it is told.' then raise; end if;
  end;
  j := public.decide_suspension_request(current_setting('rh.r3')::uuid, false, 'Rehearsal: not needed.');
  if j->>'status' is distinct from 'denied' then raise exception 'S7e failed: %', j; end if;
  j := public.decide_suspension_request(current_setting('rh.r5')::uuid, false, 'Rehearsal: a commissioner decides it.');
  if j->>'status' is distinct from 'denied' then raise exception 'S7l failed: a commissioner could not deny a manager''s own request: %', j; end if;
end $s7d$;

-- S13: an appeal is decided by a committee manager or a commissioner, who can then lift the suspension
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.x3'), 'role', 'authenticated')::text, true);
do $s13a$
declare v_id uuid;
begin
  insert into public.action_requests (profile_id, type, route, details, suspension_id)
  values (current_setting('rh.x3')::uuid, 'appeal', 'commissioner', 'Rehearsal appeal.', current_setting('rh.s3')::uuid)
  returning id into v_id;
  perform set_config('rh.ap', v_id::text, true);
end $s13a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
do $s13b$
begin
  update public.action_requests set status = 'resolved', response = 'Rehearsal: granted.' where id = current_setting('rh.ap')::uuid;
  raise exception 'S13a failed: a staff member without a seat decided an appeal';
exception when others then
  if sqlerrm <> 'A committee manager or a commissioner decides an appeal (Rule 7.6).' then raise; end if;
end $s13b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.g'), 'role', 'authenticated')::text, true);
do $s13c$
declare v_n int;
begin
  update public.action_requests set status = 'resolved', response = 'Rehearsal: granted.' where id = current_setting('rh.ap')::uuid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'S13b failed: a committee manager could not decide the appeal'; end if;
  perform public.lift_suspension(current_setting('rh.s3')::uuid);
end $s13c$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);

-- S8: a ban and an unban through the real doors
reset role;
do $s8$
begin
  perform public.ban_player(current_setting('rh.x1')::uuid, 'Rehearsal ban reason.');
  perform public.unban_player(current_setting('rh.x1')::uuid);
  if (select count(*) from public.ban_events e where e.profile_id = current_setting('rh.x1')::uuid
        and e.reason = 'Rehearsal ban reason.' and e.actor_id = current_setting('rh.k')::uuid and e.action in ('ban', 'unban')) <> 2 then
    raise exception 'S8 failed: the ban and the unban are not both recorded with the commissioner in actor_id';
  end if;
end $s8$;
select set_config('request.jwt.claims', '', true);

-- S9d: W withdraws their sign-up through the real door (the season's sign-up opened inside the transaction if closed)
do $s9d0$
begin
  update public.seasons set registration_open = true where id = current_setting('rh.ws')::uuid and not registration_open;
end $s9d0$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.w'), 'role', 'authenticated')::text, true);
do $s9d$
declare j jsonb;
begin
  j := public.withdraw_registration(current_setting('rh.ws')::uuid);
  if (j->>'ok')::boolean is distinct from true then raise exception 'S9d failed: %', j; end if;
end $s9d$;
reset role;
select set_config('request.jwt.claims', '', true);

-- S9 to S11
do $s9$
declare v_cw text; v_wel text; v_gen text; v_q0 bigint := current_setting('rh.q0')::bigint;
begin
  select a.value into v_cw from public.app_config a where a.key = 'discord_staff_casework_webhook';
  select a.value into v_wel from public.app_config a where a.key = 'discord_staff_welcome_webhook';
  select a.value into v_gen from public.app_config a where a.key = 'discord_staff_webhook';
  if (select count(*) from net.http_request_queue q where q.id > v_q0 and left(q.url, length(v_cw)) = v_cw
        and convert_from(q.body, 'UTF8') like '%Suspension lifted%') <> 2
     or (select count(*) from net.http_request_queue q where q.id > v_q0 and left(q.url, length(v_cw)) = v_cw
        and convert_from(q.body, 'UTF8') like '%Warning withdrawn%') <> 1
     or (select count(*) from net.http_request_queue q where q.id > v_q0 and left(q.url, length(v_cw)) = v_cw
        and convert_from(q.body, 'UTF8') like '%Member banned%' and convert_from(q.body, 'UTF8') like '%Rehearsal ban reason.%') <> 1
     or (select count(*) from net.http_request_queue q where q.id > v_q0 and left(q.url, length(v_cw)) = v_cw
        and convert_from(q.body, 'UTF8') like '%Ban lifted%') <> 1 then
    raise exception 'S9a failed: the two lifts, the withdrawn warning, the ban and the unban did not reach the staff channel as expected';
  end if;
  /* pg_net keeps the webhook URL as given (no query parameters are passed), so a prefix match is exact */
  if exists (select 1 from net.http_request_queue q where q.id > v_q0 and left(q.url, length(v_cw)) is distinct from v_cw
               and (left(q.url, length(v_wel)) = v_wel or (left(q.url, length(v_gen)) = v_gen and v_gen is distinct from v_cw))) then
    raise exception 'S9b failed: a staff notice went to a channel other than the one staff channel';
  end if;
  perform public.notify_staff_ch('welcome', 'Rehearsal: one channel.', false);
  /* found by its own text: other transactions keep queueing pg_net rows, so the newest row is not necessarily this one */
  if (select count(*) from net.http_request_queue q where q.id > v_q0 and convert_from(q.body, 'UTF8') like '%Rehearsal: one channel.%') <> 1
     or (select count(*) from net.http_request_queue q where q.id > v_q0 and convert_from(q.body, 'UTF8') like '%Rehearsal: one channel.%'
           and left(q.url, length(v_cw)) = v_cw) <> 1 then
    raise exception 'S9c failed: a post named for the welcome channel did not go to the staff channel';
  end if;
  if (select count(*) from net.http_request_queue q where q.id > v_q0 and convert_from(q.body, 'UTF8') like '%Sign-up withdrawn%') <> 1
     or (select count(*) from net.http_request_queue q where q.id > v_q0 and convert_from(q.body, 'UTF8') like '%Sign-up withdrawn%'
           and left(q.url, length(v_cw)) = v_cw) <> 1
     or exists (select 1 from net.http_request_queue q where q.id > v_q0 and convert_from(q.body, 'UTF8') like '%withdrew their%sign-up%'
                  and convert_from(q.body, 'UTF8') not like '%Sign-up withdrawn%')
     or exists (select 1 from public.season_registrations r where r.season_id = current_setting('rh.ws')::uuid
                  and r.profile_id = current_setting('rh.w')::uuid) then
    raise exception 'S9d failed: the sign-up withdrawal did not post once to the staff channel through notify_staff_ch';
  end if;
  if (select s.status from public.suspensions s where s.id = current_setting('rh.warn')::uuid) <> 'lifted'
     or (select s.status from public.suspensions s where s.id = current_setting('rh.s3')::uuid) <> 'lifted'
     or (select a.status from public.action_requests a where a.id = current_setting('rh.ap')::uuid) <> 'resolved' then
    raise exception 'S6c or S13 failed: the withdrawn warning, the granted appeal or its lift is not on the record';
  end if;
  if public.notify_department('statistics', 'flag', 'Rehearsal', 'Rehearsal body.', null, null) <> current_setting('rh.voters')::int then
    raise exception 'S10 failed: a department bell did not reach every staff member and commissioner';
  end if;
  if nullif(current_setting('rh.v'), '') is not null
     and (public.is_media_staff(current_setting('rh.v')::uuid) or public.is_media_only_staff(current_setting('rh.v')::uuid)) then
    raise exception 'S11 failed: the Media helpers still answer';
  end if;
  if (select s.status from public.suspensions s where s.id = current_setting('rh.s1')::uuid) <> 'lifted'
     or (select s.created_by from public.suspensions s where s.id = current_setting('rh.s2')::uuid) <> current_setting('rh.g')::uuid
     or (select s.created_by from public.suspensions s where s.id = current_setting('rh.s3')::uuid) <> current_setting('rh.k')::uuid
     or (select q.status from public.suspension_requests q where q.id = current_setting('rh.r3')::uuid) <> 'denied'
     or (select q.suspension_id from public.suspension_requests q where q.id = current_setting('rh.r1')::uuid) <> current_setting('rh.s2')::uuid then
    raise exception 'S7h failed: the requests and suspensions are not on the record as decided';
  end if;
end $s9$;

-- S14 to S18: the 2026-11-24 rulebook review's fixes (second suspensions, exact approvals, extensions, staff appeals)
/* as the table owner: X1's and X3's lifted suspensions are marked served, so each is a member already suspended this
   season (a lifted one does not count toward the second suspension; a served one does); X2's last day is noted */
do $s14o$
declare v_n int;
begin
  update public.suspensions set status = 'served'
   where id in (current_setting('rh.s1')::uuid, current_setting('rh.s3')::uuid) and status = 'lifted';
  get diagnostics v_n = row_count;
  if v_n <> 2 then raise exception 'S14 failed: the two lifted suspensions could not be marked served'; end if;
  perform set_config('rh.s2_end', (select s.ends_at::text from public.suspensions s where s.id = current_setting('rh.s2')::uuid), true);
end $s14o$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.g'), 'role', 'authenticated')::text, true);
do $s14$
begin
  begin
    perform public.suspend_player(current_setting('rh.x1')::uuid, 'date', now() + interval '5 days', null, 'Rehearsal: second, length not kept.');
    raise exception 'S14a failed: a committee manager''s second suspension went through without a kept length';
  exception when others then
    if sqlerrm not like '% was already suspended this season, so a second suspension runs for the rest of the season unless the official sets a shorter length (Rule 7.2).%' then raise; end if;
  end;
  perform set_config('rh.s4', public.suspend_player(current_setting('rh.x1')::uuid, 'date', now() + interval '5 days', null,
    'Rehearsal: second, length kept.', null, 'play', true)::text, true);
end $s14$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
do $s15a$
declare j jsonb;
begin
  j := public.request_suspension(current_setting('rh.x3')::uuid, 'date', null, now() + interval '6 days', null, 'Rehearsal: second, six days.');
  if j->>'extends' is not null then raise exception 'S15a failed: a request against a member not serving one was taken as an extension: %', j; end if;
  perform set_config('rh.r10', j->>'id', true);
  begin
    perform public.request_suspension(current_setting('rh.x2')::uuid, 'games', 3, null, null, 'Rehearsal: wrong terms.');
    raise exception 'S16a failed: an extension in games was filed against a suspension counted in days';
  exception when others then
    if sqlerrm not like 'SUSPENSION REQUEST: % is serving a suspension counted in days, so this request extends it (one suspension at a time, Rule 7.2): pick the new last day.' then raise; end if;
  end;
  begin
    perform public.request_suspension(current_setting('rh.x1')::uuid, 'games', 4, null, null, 'Rehearsal: not a step of three.');
    raise exception 'S16b failed: a request off the steps of three was filed';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: Ask in steps of three games (3, 6, 9 and so on; Rule 7.2).' then raise; end if;
  end;
  j := public.request_suspension(current_setting('rh.x2')::uuid, 'date', null, current_setting('rh.s2_end')::timestamptz + interval '2 days', null, 'Rehearsal: two more days.');
  if j->>'extends' is distinct from current_setting('rh.s2') then raise exception 'S16c failed: the request did not extend the running suspension: %', j; end if;
  perform set_config('rh.r11', j->>'id', true);
  j := public.request_suspension(current_setting('rh.x2')::uuid, 'date', null, current_setting('rh.s2_end')::timestamptz + interval '5 days', null, 'Rehearsal: five more days.');
  if j->>'extends' is distinct from current_setting('rh.s2') then raise exception 'S16d failed: the second extension request did not extend it: %', j; end if;
  perform set_config('rh.r12', j->>'id', true);
end $s15a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.g'), 'role', 'authenticated')::text, true);
do $s15b$
declare j jsonb;
begin
  j := public.decide_suspension_request(current_setting('rh.r10')::uuid, true, null);
  if j->>'status' is distinct from 'approved' then raise exception 'S15b failed: %', j; end if;
  perform set_config('rh.s5', j->>'suspension', true);
  j := public.decide_suspension_request(current_setting('rh.r11')::uuid, true, null);
  if j->>'suspension' is distinct from current_setting('rh.s2') then raise exception 'S16c failed: the approval did not extend the running suspension: %', j; end if;
  begin
    perform public.decide_suspension_request(current_setting('rh.r12')::uuid, true, null);
    raise exception 'S16d failed: a committee manager approved an extension past 14 days from the day it was issued';
  exception when others then
    if sqlerrm <> 'SUSPENSION REQUEST: This request is past a committee manager''s limit (14 days or 18 games), so a commissioner decides it.' then raise; end if;
  end;
end $s15b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $s16k$
declare j jsonb;
begin
  j := public.decide_suspension_request(current_setting('rh.r12')::uuid, true, null);
  if j->>'suspension' is distinct from current_setting('rh.s2') then raise exception 'S16d failed: a commissioner could not approve the long extension: %', j; end if;
  /* S17: a staff member's appeal is a commissioner's to decide; K suspends N to have one (a commissioner rules on staff) */
  perform set_config('rh.s6', public.suspend_player(current_setting('rh.n')::uuid, 'date', now() + interval '3 days', null,
    'Rehearsal: staff appeal.', null, 'play', true)::text, true);
end $s16k$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
do $s17a$
declare v_id uuid;
begin
  insert into public.action_requests (profile_id, type, route, details, suspension_id)
  values (current_setting('rh.n')::uuid, 'appeal', 'commissioner', 'Rehearsal staff appeal.', current_setting('rh.s6')::uuid)
  returning id into v_id;
  perform set_config('rh.ap2', v_id::text, true);
end $s17a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.g'), 'role', 'authenticated')::text, true);
do $s17b$
begin
  update public.action_requests set status = 'resolved', response = 'Rehearsal: granted.' where id = current_setting('rh.ap2')::uuid;
  raise exception 'S17a failed: a committee manager decided an appeal by a member of league staff';
exception when others then
  if sqlerrm <> 'An appeal by a member of league staff is decided by a commissioner (Rule 7.6).' then raise; end if;
end $s17b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.k'), 'role', 'authenticated')::text, true);
do $s17c$
declare v_n int;
begin
  update public.action_requests set status = 'resolved', response = 'Rehearsal: granted.' where id = current_setting('rh.ap2')::uuid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'S17b failed: a commissioner could not decide a staff member''s appeal'; end if;
end $s17c$;
reset role;
select set_config('request.jwt.claims', '', true);
do $s18$
declare v_b uuid;
begin
  /* S14b, S15b: the kept length and the approved length stand exactly; nothing became the rest of the season */
  if (select s.mode from public.suspensions s where s.id = current_setting('rh.s4')::uuid) is distinct from 'date'
     or (select s.until_season from public.suspensions s where s.id = current_setting('rh.s4')::uuid) is not null
     or (select s.mode from public.suspensions s where s.id = current_setting('rh.s5')::uuid) is distinct from 'date'
     or (select s.ends_at from public.suspensions s where s.id = current_setting('rh.s5')::uuid) > now() + interval '7 days' then
    raise exception 'S14b or S15b failed: a second suspension did not keep the length that was set or approved';
  end if;
  /* S16c, S16d: one suspension at a time, extended by exactly the approved days (2, then 5) */
  if (select (s.ends_at at time zone 'America/New_York')::date - (current_setting('rh.s2_end')::timestamptz at time zone 'America/New_York')::date
        from public.suspensions s where s.id = current_setting('rh.s2')::uuid) <> 7
     or (select count(*) from public.suspensions s where s.profile_id = current_setting('rh.x2')::uuid
           and s.status = 'active' and s.mode <> 'warning') <> 1
     or (select count(*) from public.suspension_requests q where q.id in (current_setting('rh.r11')::uuid, current_setting('rh.r12')::uuid)
           and q.status = 'approved' and q.suspension_id = current_setting('rh.s2')::uuid and q.extends_id = current_setting('rh.s2')::uuid) <> 2 then
    raise exception 'S16e failed: the extensions did not add exactly the approved days to the one running suspension';
  end if;
  if (select a.status from public.action_requests a where a.id = current_setting('rh.ap2')::uuid) <> 'resolved' then
    raise exception 'S17b failed: the staff appeal is not on the record as decided';
  end if;
  /* S18: the door the Netlify gates ask answers as has_department does */
  if not public.profile_has_department(current_setting('rh.n')::uuid, 'statistics')
     or public.profile_has_department(current_setting('rh.n')::uuid, 'draft')
     or not public.profile_has_department(current_setting('rh.k')::uuid, 'draft')
     or public.profile_has_department(current_setting('rh.x1')::uuid, 'statistics')
     or public.profile_has_department(null, 'statistics') then
    raise exception 'S18 failed: profile_has_department does not answer as the department test';
  end if;
  select p.id into v_b from public.profiles p where p.role = 'staff' and p.banned order by p.id limit 1;
  if v_b is not null and public.profile_has_department(v_b, 'statistics') then
    raise exception 'S18 failed: a banned staffer holds a key through profile_has_department';
  end if;
end $s18$;

-- >>> reverse text: sql/2026-11-24-s2-staff-powers-v463.reverse.sql
-- v463 REVERSE (DRAFT, 2026-11-24): undoes sql/2026-11-24-s2-staff-powers-v463.sql if the flip is rolled back (PLAN
-- section 8: restore the deploy, git revert, then the reverse migrations in the opposite order of the apply: the staff
-- copy reverse first, the all-staff voting reverse second, and this one last; it refuses to run while the copy stands).
-- The departments, the Media carve-outs, the 30-day staff ceiling, the department bells and the per-channel staff webhooks
-- come back exactly as they were on 2026-11-24, as do the department appeal deciders, the department lift and the sign-up
-- withdrawal's own post to the general staff webhook: the same patch pairs the forward record applied, undone by exact anchor
-- (each new text asserted to stand exactly once, and the old one to stand exactly once after), so a later change to
-- another part of the same function survives the reverse. The ban and lift notices, the suspension request doors and
-- is_any_committee_manager, manager_date_ceiling and profile_has_department are dropped (has_department reads the
-- departments column again, so the Netlify statistics gates that ask the database follow it back), and
-- ban_events.actor_id is renamed back to by, with
-- ban_player and unban_player's insert column lists undone by the same exact anchor (the rows stay).
--
-- Kept on purpose: public.suspension_requests and its rows, as the record of what was filed and decided while the powers
-- ran (every approved one points at its suspension, which stays). It loses its API grant and its read policy, so nothing
-- reads or writes it until the forward record is applied again (it creates the table only if missing).
-- Suspensions issued while the powers ran stay in force; a commissioner lifts any that should not. Apply as migration
-- v463_s2_staff_powers_reverse. Rehearsed inside sql/2026-11-24-s2-staff-powers-v463.rehearsal.sql.

do $pre$
begin
  if to_regprocedure('public.request_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,uuid)') is null then
    raise exception 'v463 staff powers reverse: the staff powers are not applied, so there is nothing to reverse';
  end if;
  /* the copy record's text describes these powers, so it is reversed first (one fixed order) */
  if position('the Draft and Bidding manager.' in pg_get_functiondef('public.draft_pause(integer)'::regprocedure)) > 0 then
    raise exception 'v463 staff powers reverse: the staff copy record still stands; apply its reverse first';
  end if;
end $pre$;

-- 1. the notices and the doors
drop trigger if exists notify_ban_event_trg on public.ban_events;
drop trigger if exists notify_suspension_lifted_trg on public.suspensions;
drop function public.notify_ban_event();
drop function public.notify_suspension_lifted();
drop function public.request_suspension(uuid, text, integer, timestamptz, integer, text, text[], text, uuid);
drop function public.decide_suspension_request(uuid, boolean, text);
drop function public.withdraw_suspension_request(uuid);
drop policy if exists "staff read suspension requests" on public.suspension_requests;
revoke all on table public.suspension_requests from anon, authenticated;

/* v463: ban_events.actor_id back to by (the forward record renamed it because BY is a reserved word in PL/pgSQL, and the
   notice trigger that read it is dropped above); ban_player and unban_player write by again, by the forward's two strings */
do $ban$
declare
  v_f text; v_def text;
  v_old text := 'insert into public.ban_events(profile_id, action, reason, by) values (';
  v_new text := 'insert into public.ban_events(profile_id, action, reason, actor_id) values (';
begin
  foreach v_f in array array['public.ban_player(uuid,text)', 'public.unban_player(uuid)'] loop
    v_def := pg_get_functiondef(v_f::regprocedure);
    if (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new) <> 1 then
      raise exception 'v463 staff powers reverse: the ban_events insert in % does not stand once', v_f;
    end if;
    execute replace(v_def, v_new, v_old);
    v_def := pg_get_functiondef(v_f::regprocedure);
    if position(v_new in v_def) > 0 or (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'v463 staff powers reverse: the ban_events insert in % did not come back once', v_f;
    end if;
  end loop;
end $ban$;
alter table public.ban_events rename column actor_id to by;

-- 2. the gates, back by exact anchor (the forward record's pairs, byte for byte)
do $rev$
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
  ) as x(ord, fn, old_text, new_text) order by x.ord desc loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text);
    if n <> 1 then raise exception 'v463 staff powers reverse: patch % in % stands % times', r.ord, r.fn, n; end if;
    execute replace(v_def, r.new_text, r.old_text);
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text) <> 1 then
      raise exception 'v463 staff powers reverse: anchor % in % did not come back once', r.ord, r.fn;
    end if;
  end loop;
end $rev$;

-- 3. the discipline test, the date ceiling and the department door go last: nothing calls them any more
drop function public.is_any_committee_manager(uuid);
drop function public.manager_date_ceiling(timestamptz);
drop function public.profile_has_department(uuid, text);

-- 4. self-checks
do $chk$
begin
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname = 'public' and p.proname in ('is_any_committee_manager', 'manager_date_ceiling', 'profile_has_department',
                                                         'request_suspension', 'decide_suspension_request',
                                                         'withdraw_suspension_request', 'notify_ban_event', 'notify_suspension_lifted'))
     or exists (select 1 from pg_trigger t where t.tgname in ('notify_ban_event_trg', 'notify_suspension_lifted_trg')) then
    raise exception 'v463 staff powers reverse: a staff powers door or notice is still there';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname = 'public' and (p.prosrc like '%is_any_committee_manager%' or p.prosrc like '%manager_date_ceiling%'
                                              or p.prosrc like '%profile_has_department%')) then
    raise exception 'v463 staff powers reverse: a function still calls is_any_committee_manager, manager_date_ceiling or profile_has_department';
  end if;
  if position('''discord_staff_''||p_channel||''_webhook''' in pg_get_functiondef('public.notify_staff_ch(text,text,boolean)'::regprocedure)) = 0
     or position('p_key = any(departments)' in pg_get_functiondef('public.has_department(text)'::regprocedure)) = 0 then
    raise exception 'v463 staff powers reverse: the department gates or the channel routing did not come back';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.ban_events'::regclass and a.attname = 'actor_id' and not a.attisdropped)
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.ban_events'::regclass and a.attname = 'by' and not a.attisdropped) then
    raise exception 'v463 staff powers reverse: ban_events.actor_id did not go back to by';
  end if;
  if has_table_privilege('authenticated', 'public.suspension_requests', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.suspension_requests', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'v463 staff powers reverse: suspension_requests is still reachable through the API';
  end if;
  raise notice 'v463 staff powers reverse: departments back; % suspension requests kept as the record',
    (select count(*) from public.suspension_requests);
end $chk$;
-- <<< reverse text

-- S12: the reverse restores the gates
do $s12a$
begin
  if md5(
    (select string_agg(pg_get_functiondef(f::regprocedure), '|' order by f)
       from unnest(array['public.has_department(text)', 'public._is_stats_staff()', 'public.is_media_staff(uuid)',
                         'public.is_media_only_staff(uuid)', 'public.notify_department(text,text,text,text,text,text)',
                         'public.notify_staff_ch(text,text,boolean)',
                         'public._issue_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,boolean,uuid)',
                         'public.extend_suspension(uuid,integer,integer,text)', 'public.lift_suspension(uuid)',
                         'public.guard_appeal_decider()', 'public.withdraw_registration(uuid)',
                         'public.ban_player(uuid,text)', 'public.unban_player(uuid)']) f)
    || (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
         where a.attrelid = 'public.ban_events'::regclass and a.attnum > 0 and not a.attisdropped)
    || (select coalesce(string_agg(t.tgname, ',' order by t.tgname), '') from pg_trigger t
         where not t.tgisinternal and t.tgrelid in ('public.ban_events'::regclass, 'public.suspensions'::regclass))
    || (select string_agg(x.tablename || ':' || x.policyname || ':' || coalesce(x.qual, '') || ':' || coalesce(x.with_check, ''), '|'
                          order by x.tablename, x.policyname)
          from pg_policies x where x.schemaname = 'public' and x.tablename in ('suspensions', 'ban_events', 'news', 'trades')))
     <> current_setting('rh.fp') then
    raise exception 'S12a failed: the reverse did not restore the gates, triggers and policies byte for byte';
  end if;
  if (select count(*) from public.suspension_requests q
       where q.id in (current_setting('rh.r1')::uuid, current_setting('rh.r2')::uuid, current_setting('rh.r3')::uuid, current_setting('rh.r4')::uuid)) <> 4
     or has_table_privilege('authenticated', 'public.suspension_requests', 'SELECT')
     or (select s.status from public.suspensions s where s.id = current_setting('rh.s2')::uuid) <> 'active' then
    raise exception 'S12b failed: the requests are not kept as the record, are still readable, or an issued suspension moved';
  end if;
end $s12a$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.n'), 'role', 'authenticated')::text, true);
select set_config('rh.n_after', (public.has_department('transactions') or public.has_department('statistics') or public.is_stats_staff())::text, true);
reset role;
select set_config('request.jwt.claims', '', true);

-- the verdict
do $v$
begin
  if current_setting('rh.n_after') <> 'false' then
    raise exception 'S12c failed: after the reverse a staff member outside the departments still holds their powers';
  end if;
  if to_regprocedure('public.profile_has_department(uuid,text)') is not null then
    raise exception 'S12d failed: the department door is still there after the reverse';
  end if;
  raise exception 'REHEARSAL OK: S0 S1 S2a S2b S3 S4 S5a S5b S5c S5d S6a S6b S6c S7a S7b S7c S7d S7e S7f S7g S7h S7i S7j S7k S7l S7m S13a S13b S8 S9a S9b S9c S9d S10 S11 % S14a S14b S15a S15b S16a S16b S16c S16d S16e S17a S17b S18 S12a S12b S12c S12d (seat %, % told by a department bell)',
    case when nullif(current_setting('rh.v'), '') is null then '(skipped: no Media staffer)' else '(checked)' end,
    current_setting('rh.key'), current_setting('rh.voters');
end $v$;
