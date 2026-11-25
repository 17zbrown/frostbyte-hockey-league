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
