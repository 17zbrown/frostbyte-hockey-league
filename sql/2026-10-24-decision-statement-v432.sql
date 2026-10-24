/* v4.32 (2026-10-24): every Action Center decision carries a final decision statement.
   Commissioner, 2026-10-24: "Can you add a 'final decision statement' box for all action center decisions that are
   attached to the decision statement?"
   action_requests.response IS the final decision statement, written in the same write as the decision, by the decider,
   word for word. ONE rule enforces it for every door (guard_decision_statement): the site's Resolve and Deny (a direct
   PostgREST update by the league office or a club's front office; ar_update has no WITH CHECK, so only a trigger holds
   this door), decide_position_change, discipline_from_case, decide_forfeit_appeal (already required one) and
   abandonment_rule (dormant Rule 7.8 work, untouched: it always writes a composed statement, so it passes).
   - A move to resolved or denied needs a statement: not blank, at most 2,000 characters (the club-room embed that
     carries an overturned forfeit appeal stays under Discord's 4,096), and NEW for this decision: a filer's reply
     reopens a decided case (notify_action_message) and leaves the old statement, so deciding again needs a fresh one.
   - A statement is written only with a decision; the site's Respond is retired.
   - A filing is born open with no statement: ar_insert checks only the filer, so a member could otherwise file a
     request already resolved with a "decision" of their own.
   No unattended closure exists (2026-10-24: the bodies that write action_requests are the five doors above, assign_case
   and notify_action_message's reopen; no cron, job, Edge function or bot closes one). The moot close in
   decide_forfeit_appeal writes its own system sentence first. A future automatic closure must write its own statement;
   the guard refuses it otherwise. A data fix run through SQL that closes a request must write one too.
   Existing rows are not touched: the guard checks changes only.
   notify_action_status (no earlier sql/ record; live text read 2026-10-24): the decision notice's body is the statement.
   discipline_from_case gains p_statement (DROP + CREATE: a new defaulted argument would make an overload). The sanction
   and its grounds leave response and the public thread line (now staff-only): Rule 7.2 shows them only to the member
   sanctioned and league staff, and the filer of a complaint is neither.
   decide_position_change (no earlier sql/ record): the statement word for word; its own extra notice is gone (the filer
   got three for one decision).
   A statistics correction is the club's (Rule 6.3): its Owner, GM and AGM read it and are told its decision, like a
   forfeit appeal (v3.93).
   REHEARSAL: recorded at the end of this file. */

-- 1. the rule
create or replace function public.guard_decision_statement()
 returns trigger language plpgsql set search_path to ''
as $function$
begin
  /* v4.32 (commissioner, 2026-10-24): response is the final decision statement: written with the decision, by the
     decider, never blank, fresh for each decision (Rule 1.4). */
  if tg_op = 'INSERT' then
    if new.status is distinct from 'open' or new.response is not null then
      raise exception 'A request is filed open, with no decision on it.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status is not distinct from old.status and new.response is not distinct from old.response then
    return new;
  end if;
  if new.status not in ('resolved', 'denied') then
    if new.response is distinct from old.response then
      raise exception 'A final decision statement is written with the decision itself.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if btrim(coalesce(new.response, '')) = '' then
    raise exception 'Write the final decision statement. The member who filed sees it with the decision.' using errcode = 'check_violation';
  end if;
  if new.response is not distinct from old.response then
    raise exception 'Write a new final decision statement. The one on the request belongs to the earlier decision.' using errcode = 'check_violation';
  end if;
  if char_length(new.response) > 2000 then
    raise exception 'Keep the final decision statement to 2,000 characters (this one has %).', char_length(new.response) using errcode = 'check_violation';
  end if;
  return new;
end $function$;
revoke all on function public.guard_decision_statement() from public, anon, authenticated;
drop trigger if exists trg_guard_decision_statement on public.action_requests;
-- sorts after aa_guard_abandonment_case_upd, guard_forfeit_appeal_trg and trg_guard_appeal_decider: who may decide is refused first
create trigger trg_guard_decision_statement before insert or update of status, response on public.action_requests
  for each row execute function public.guard_decision_statement();

-- 2. one notice door carries the statement
create or replace function public.notify_action_status()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_title text;
begin
  /* v4.32 (commissioner, 2026-10-24): a decision's notice carries its final decision statement, which
     guard_decision_statement makes present and fresh, so the old fallback body is gone. A response changes only with a
     decision now, so the notice for a bare response went with the retired Respond, and the acknowledged branch (no door
     writes that status) with it. */
  if new.status not in ('resolved', 'denied') then return new; end if;
  if new.status is distinct from old.status then
    v_title := 'Your ' || public.ar_label(new.type) || ' was ' || new.status;
  elsif new.response is distinct from old.response then
    v_title := 'The decision on your ' || public.ar_label(new.type) || ' was updated';
  else
    return new;
  end if;
  perform public.create_notification(new.profile_id, 'request', v_title, new.response, 'actions', new.id::text);
  /* a statistics correction is the club's (Rule 6.3): the seats that did not file it hear the decision too. A forfeit
     appeal's seats are told by decide_forfeit_appeal (club_notify), so it is not repeated here. */
  if new.type = 'stats_correction' and new.team_id is not null then
    perform public.create_notification(x.pid, 'request', v_title, new.response, 'actions', new.id::text)
       from (select distinct unnest(array[t.owner_profile_id, t.gm_profile_id, t.agm_profile_id]) as pid
               from public.teams t where t.id = new.team_id) x
      where x.pid is not null and x.pid <> new.profile_id;
  end if;
  return new;
end $function$;

-- 3. discipline from a case: the statement is its own argument
drop function public.discipline_from_case(uuid, uuid, text, integer, timestamptz, integer, text, text[], text, boolean);
create function public.discipline_from_case(p_request uuid, p_profile uuid, p_mode text, p_games integer default null,
  p_ends_at timestamptz default null, p_until_season integer default null, p_reason text default null,
  p_codes text[] default null, p_scope text default 'play', p_keep_length boolean default false,
  p_statement text default null)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_target uuid; v_filer uuid; v_id uuid; s public.suspensions; v_len text;
begin
  select target_profile_id, profile_id into v_target, v_filer from public.action_requests where id = p_request;
  if not found then raise exception 'That case no longer exists.'; end if;
  if not public.is_commissioner()
     and (v_target = auth.uid() or v_filer = auth.uid() or p_profile = auth.uid()) then
    raise exception 'This case involves you. A commissioner has to rule on it.';
  end if;
  if not public.is_commissioner() and exists (
       select 1 from public.action_requests a join public.suspensions x on x.id = a.suspension_id
        where a.id = p_request and a.type = 'appeal' and x.created_by = auth.uid()) then
    raise exception 'You imposed the suspension this appeal contests, so another official rules on it (Rule 7.6).';
  end if;
  v_id := public._issue_suspension(p_profile, p_mode, p_games, p_ends_at, p_until_season, p_reason, p_codes,
                                   p_scope, p_keep_length, p_request);
  select * into s from public.suspensions where id = v_id;
  v_len := case s.mode when 'warning' then 'a formal warning'
    when 'games' then s.games_total||'-game suspension'
    when 'seasons' then 'a suspension for the rest of Season '||s.until_season
    else 'a suspension through '||to_char(s.ends_at at time zone 'America/New_York','Mon DD')||' (11:59 PM ET)' end;
  /* v4.32 (commissioner, 2026-10-24): response is the decider's final decision statement, word for word;
     guard_decision_statement refuses a blank one, which rolls back the suspension above with it. The sanction and its
     grounds stay out of response and the public thread: Rule 7.2 shows them only to the member sanctioned (told by
     _issue_suspension) and league staff, and the member who filed a complaint is neither. */
  update public.action_requests
     set status='resolved', assigned_to=coalesce(assigned_to, auth.uid()),
         response = nullif(btrim(p_statement), ''),
         updated_at=now()
   where id = p_request;
  insert into public.action_messages(request_id, author_id, body, internal)
    values (p_request, auth.uid(), 'Discipline issued: '||v_len||coalesce('. '||s.reason,'')||'.', true);
  perform public.log_admin_action('discipline_from_case','suspension',v_id::text,
    jsonb_build_object('profile',p_profile,'mode',s.mode,'request',p_request));
  return v_id;
end $function$;
revoke all on function public.discipline_from_case(uuid, uuid, text, integer, timestamptz, integer, text, text[], text, boolean, text) from public, anon, authenticated;
grant execute on function public.discipline_from_case(uuid, uuid, text, integer, timestamptz, integer, text, text[], text, boolean, text) to authenticated, service_role;

-- 4. position change: the statement word for word, one notice door (patched on the live text; no earlier sql/ record)
do $patch$
declare v_def text; v_old text[]; v_new text[]; i int; v_n int;
begin
  v_def := pg_get_functiondef('public.decide_position_change(uuid, boolean, text)'::regprocedure);
  v_old := array[
$o1$         response = coalesce(nullif(response,'')||E'\n','')
                  || case when p_approve then 'Position change approved: '||v_line
                          else 'Position change denied.' end
                  || coalesce(' - '||v_resp,''),$o1$,
$o2$            case when p_approve then 'Approved — registered position is now '||req.requested_position::text||'.'
                 else 'Denied — the registered position stays '||coalesce(req.current_position::text,'as it is')||'.' end
            || coalesce(E'\n'||v_resp,''), false);$o2$,
$o3$  perform public.create_notification(req.profile_id, 'users',
    case when p_approve then 'Position change approved' else 'Position change denied' end,
    case when p_approve then 'You are now registered at '||req.requested_position::text||' for the season. Your Discord position role follows within a few minutes.'
         else 'The league office kept your registration at '||coalesce(req.current_position::text,'your current position')||'.'
    end || coalesce(E'\n\nFrom the office: '||v_resp,''), null, null);$o3$];
  v_new := array[
$n1$         response = v_resp,   -- v4.32: the decider's final decision statement, word for word (guard_decision_statement)$n1$,
$n2$            case when p_approve then 'Approved: the registered position is now '||req.requested_position::text||'. The Discord position role follows within a few minutes.'
                 else 'Denied: the registered position stays '||coalesce(req.current_position::text,'as it is')||'.' end, false);$n2$,
$n3$  -- v4.32: the decision notice is notify_action_status's, carrying the final decision statement; this one repeated it$n3$];
  for i in 1..3 loop
    v_n := (length(v_def) - length(replace(v_def, v_old[i], ''))) / length(v_old[i]);
    if v_n <> 1 then raise exception 'patch: decide_position_change anchor % matched % times', i, v_n; end if;
    v_def := replace(v_def, v_old[i], v_new[i]);
  end loop;
  execute v_def;
end $patch$;

-- 5. (D2) a statistics correction is read by its club's front office, like a forfeit appeal (v3.93)
alter policy ar_read on public.action_requests using (
  (profile_id = (select auth.uid())) or public.is_commissioner()
  or ((coalesce(route, '') <> 'manager') and public.is_staff() and not public.is_media_only_staff((select auth.uid())))
  or ((route = 'manager') and public.is_gm_of(team_id))
  or ((type = 'forfeit_appeal') and public.is_gm_of(team_id))
  or ((type = 'stats_correction') and public.is_gm_of(team_id)));
create or replace function public.can_see_request(p_req uuid)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1 from public.action_requests r where r.id = p_req and (
      r.profile_id = (select auth.uid())
      or public.is_commissioner()
      or public.is_staff()
      or (r.route = 'manager' and public.is_gm_of(r.team_id))
      or (r.type in ('forfeit_appeal', 'stats_correction') and public.is_gm_of(r.team_id))   -- v3.93 forfeit appeal; v4.32 statistics correction
    )
  );
$function$;

-- 6.
notify pgrst, 'reload schema';

-- 7. self-checks
do $check$
declare v_src text; v_sig text := 'public.discipline_from_case(uuid, uuid, text, integer, timestamptz, integer, text, text[], text, boolean, text)';
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_decision_statement'
                  and tgrelid = 'public.action_requests'::regclass and tgenabled = 'O') then
    raise exception 'self-check: the decision-statement guard is not on action_requests'; end if;
  if (select count(*) from pg_proc where proname = 'discipline_from_case' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'self-check: discipline_from_case must have exactly one signature'; end if;
  if has_function_privilege('anon', v_sig, 'execute') or not has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'self-check: discipline_from_case grants are wrong'; end if;
  if has_function_privilege('authenticated', 'public.guard_decision_statement()', 'execute') then
    raise exception 'self-check: the guard is callable through the API'; end if;
  select prosrc into v_src from pg_proc where oid = 'public.decide_position_change(uuid, boolean, text)'::regprocedure;
  if v_src !~ 'response = v_resp,' or v_src ~ 'From the office' or v_src ~ 'Position change approved: ' then
    raise exception 'self-check: decide_position_change still composes its own response or notice'; end if;
  select prosrc into v_src from pg_proc where oid = v_sig::regprocedure;
  if v_src ~ '''Ruling: ''' or v_src !~ 'nullif\(btrim\(p_statement\)' then
    raise exception 'self-check: discipline_from_case does not write the statement'; end if;
  select prosrc into v_src from pg_proc where oid = 'public.notify_action_status()'::regprocedure;
  if v_src ~ 'A reviewer updated' or v_src ~ '= ''acknowledged''' or v_src !~ 'v_title, new\.response' then
    raise exception 'self-check: notify_action_status does not carry the statement'; end if;
  if (select qual from pg_policies where schemaname = 'public' and tablename = 'action_requests' and policyname = 'ar_read') !~ 'stats_correction' then
    raise exception 'self-check: ar_read does not let a club read its statistics correction'; end if;
end $check$;

/* REHEARSAL, 2026-10-24: one transaction on the live database (sections 1 to 7 above, then the probe below, acting as a
   commissioner through request.jwt.claims), rolled back by the probe's closing raise. Subjects picked at run time: the
   first commissioner, the earliest plain member (filer) and another (named in the complaint), and a club whose Owner holds
   one seat and has a second seat holder.
   P1 a filing born resolved with a "decision" is refused. P3 to P6 Resolve with no statement, a statement with no
   decision, a blank one and one over 2,000 characters are refused. P7 a decision with a statement sends one notice whose
   body is the statement. P8 the filer's reply reopens the case and keeps the old statement. P9 deciding again with the
   old statement is refused; P10 a new one is accepted. P11a decide_position_change with no statement is refused; P11 with
   one, response is the statement word for word, one decision notice carries it and the old "Position change denied"
   notice is gone. P12a discipline with no statement is refused and the warning it issued is rolled back with it; P12 with
   one, response is the statement, the "Discipline issued" thread line is staff-only, and the filer is never shown the
   grounds. P12b editing the statement on a decided case sends "The decision on your complaint was updated". P13 the open
   forfeit appeal denied through decide_forfeit_appeal carries the statement. P14 a statistics correction's decision
   reaches every seat of the club, and its second seat can read it under ar_read as role authenticated.
   Result: REHEARSAL OK (rolled back): P1 P3 P4 P5 P6 P7 P8 P9 P10 P11a P11 P12a P12 P12b P13 P14
   Afterward: no trg_guard_decision_statement, guard_decision_statement absent, discipline_from_case still the
   10-argument signature, ar_read without stats_correction: nothing stuck.
   Two earlier runs stopped and rolled back whole: coalesce(p.role, '') casts '' to the user_role enum (now p.role::text),
   and P11 expected two notices for the filer where three is right: the filing receipt and the thread line's reply notice
   are unchanged, so the probe now asserts the one decision notice and the absence of the duplicate.
   Applied as migration v432_decision_statement; tools/sql/grant-audit.sql returned zero rows. */

/* ---- REHEARSAL PROBE (main session only; never part of the applied migration) ------------------------------------
do $rehearsal$
declare v_com uuid; v_mem uuid; v_tgt uuid; v_case uuid; v_pos uuid; v_sc uuid; v_ffa uuid;
        v_team uuid; v_filer uuid; v_other uuid; v_n int; v_out text := '';
begin
  select id into v_com from public.profiles where role = 'commissioner' order by created_at limit 1;
  select p.id into v_mem from public.profiles p where coalesce(p.role::text,'') not in ('staff','commissioner') and not coalesce(p.banned,false)
     and not exists (select 1 from public.teams x where p.id in (x.owner_profile_id, x.gm_profile_id, x.agm_profile_id)) order by p.created_at limit 1;
  select p.id into v_tgt from public.profiles p where coalesce(p.role::text,'') not in ('staff','commissioner') and not coalesce(p.banned,false) and p.id <> v_mem
     and not exists (select 1 from public.suspensions x where x.profile_id = p.id and public.suspension_running_at(x, now())) order by p.created_at limit 1;
  select t.id, t.owner_profile_id, coalesce(nullif(t.gm_profile_id, t.owner_profile_id), nullif(t.agm_profile_id, t.owner_profile_id))
    into v_team, v_filer, v_other from public.teams t
   where t.owner_profile_id is not null and coalesce(nullif(t.gm_profile_id, t.owner_profile_id), nullif(t.agm_profile_id, t.owner_profile_id)) is not null
     and (select count(*) from public.teams y where t.owner_profile_id in (y.owner_profile_id, y.gm_profile_id, y.agm_profile_id)) = 1 limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_com, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_com::text, true);
  begin insert into public.action_requests(profile_id, type, route, details, status, response) values (v_mem,'complaint','commissioner','REHEARSAL','resolved','forged');
    raise exception 'P1 FAIL: a filing born resolved was accepted'; exception when check_violation then v_out := v_out||'P1 '; end;
  insert into public.action_requests(profile_id, type, route, details, target_profile_id) values (v_mem,'complaint','commissioner','REHEARSAL complaint',v_tgt) returning id into v_case;
  insert into public.action_requests(profile_id, type, route, details, current_position, requested_position) values (v_mem,'position_change','commissioner','REHEARSAL','C','LW') returning id into v_pos;
  insert into public.action_requests(profile_id, type, route, details) values (v_filer,'stats_correction','commissioner','REHEARSAL correction') returning id into v_sc;
  begin update public.action_requests set status='resolved', updated_at=now() where id=v_case; raise exception 'P3 FAIL: Resolve with no statement'; exception when check_violation then v_out := v_out||'P3 '; end;
  begin update public.action_requests set response='REHEARSAL early' where id=v_case; raise exception 'P4 FAIL: statement without a decision'; exception when check_violation then v_out := v_out||'P4 '; end;
  begin update public.action_requests set status='resolved', response='   ' where id=v_case; raise exception 'P5 FAIL: blank'; exception when check_violation then v_out := v_out||'P5 '; end;
  begin update public.action_requests set status='resolved', response=repeat('x',2001) where id=v_case; raise exception 'P6 FAIL: over 2000'; exception when check_violation then v_out := v_out||'P6 '; end;
  update public.action_requests set status='resolved', response='REHEARSAL statement one' where id=v_case;
  select count(*) into v_n from public.notifications where profile_id=v_mem and created_at=now() and title='Your complaint was resolved' and body='REHEARSAL statement one' and link_param=v_case::text;
  if v_n <> 1 then raise exception 'P7 FAIL: % decision notices', v_n; end if; v_out := v_out||'P7 ';
  perform set_config('request.jwt.claims', json_build_object('sub', v_mem, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_mem::text, true);
  insert into public.action_messages(request_id, author_id, body) values (v_case, v_mem, 'REHEARSAL reply');
  perform set_config('request.jwt.claims', json_build_object('sub', v_com, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_com::text, true);
  if (select status <> 'reviewing' or response <> 'REHEARSAL statement one' from public.action_requests where id=v_case) then raise exception 'P8 FAIL: reopen'; end if; v_out := v_out||'P8 ';
  begin update public.action_requests set status='denied' where id=v_case; raise exception 'P9 FAIL: stale statement accepted'; exception when check_violation then v_out := v_out||'P9 '; end;
  update public.action_requests set status='denied', response='REHEARSAL statement two' where id=v_case; v_out := v_out||'P10 ';
  begin perform public.decide_position_change(v_pos, false, null); raise exception 'P11 FAIL: no note accepted'; exception when check_violation then v_out := v_out||'P11a '; end;
  perform public.decide_position_change(v_pos, false, 'REHEARSAL position statement');
  if (select response from public.action_requests where id=v_pos) is distinct from 'REHEARSAL position statement' then raise exception 'P11 FAIL: response'; end if;
  /* the decision notice carries the statement; the old 'Position change denied' notice is gone (the filing receipt and
     the thread line's reply notice are unchanged) */
  select count(*) into v_n from public.notifications where profile_id=v_mem and created_at=now() and link_param=v_pos::text
     and title='Your position-change request was denied' and body='REHEARSAL position statement';
  if v_n <> 1 or exists (select 1 from public.notifications where profile_id=v_mem and created_at=now() and title like 'Position change%')
    then raise exception 'P11 FAIL: % decision notices, or the duplicate is back', v_n; end if; v_out := v_out||'P11 ';
  begin perform public.discipline_from_case(v_case, v_tgt, 'warning', p_reason => 'REHEARSAL grounds'); raise exception 'P12 FAIL: no statement accepted'; exception when check_violation then v_out := v_out||'P12a '; end;
  if exists (select 1 from public.suspensions where request_id=v_case) then raise exception 'P12 FAIL: the warning survived the refusal'; end if;
  perform public.discipline_from_case(v_case, v_tgt, 'warning', p_reason => 'REHEARSAL grounds', p_statement => 'REHEARSAL statement three');
  if (select response from public.action_requests where id=v_case) is distinct from 'REHEARSAL statement three'
     or (select bool_and(internal) from public.action_messages where request_id=v_case and body like 'Discipline issued:%') is not true then raise exception 'P12 FAIL'; end if;
  if exists (select 1 from public.notifications where profile_id=v_mem and created_at=now() and body like '%REHEARSAL grounds%') then raise exception 'P12 FAIL: filer shown the grounds'; end if;
  v_out := v_out||'P12 ';
  update public.action_requests set response='REHEARSAL statement four' where id=v_case;
  if not exists (select 1 from public.notifications where profile_id=v_mem and created_at=now() and title='The decision on your complaint was updated' and body='REHEARSAL statement four') then raise exception 'P12b FAIL'; end if; v_out := v_out||'P12b ';
  select id into v_ffa from public.action_requests where type='forfeit_appeal' and status not in ('resolved','denied') limit 1;
  if v_ffa is null then v_out := v_out||'P13-skipped '; else
    perform public.decide_forfeit_appeal(v_ffa, false, 'REHEARSAL forfeit statement');
    if (select status not in ('resolved','denied') or response not like '%REHEARSAL forfeit statement' from public.action_requests where id=v_ffa) then raise exception 'P13 FAIL'; end if;
    v_out := v_out||'P13 '; end if;
  if (select team_id from public.action_requests where id=v_sc) is distinct from v_team then raise exception 'P14 setup: correction routed to another club'; end if;
  update public.action_requests set status='resolved', response='REHEARSAL correction statement' where id=v_sc;
  select count(*) into v_n from public.notifications where created_at=now() and link_param=v_sc::text and body='REHEARSAL correction statement';
  if v_n <> (select count(distinct s) from public.teams x cross join lateral unnest(array[x.owner_profile_id, x.gm_profile_id, x.agm_profile_id]) s where x.id=v_team and s is not null)
    then raise exception 'P14 FAIL: % seat notices', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_other::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.action_requests where id=v_sc;
  execute 'reset role';
  if v_n <> 1 then raise exception 'P14 FAIL: the other seat cannot read the correction'; end if; v_out := v_out||'P14 ';
  raise exception 'REHEARSAL OK (rolled back): %', v_out;
end $rehearsal$;
*/
