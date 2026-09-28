-- v3.68: forfeit thresholds, application votes, statistics corrections, resent trades, the trade service gate,
-- and rescheduled games counting in the week they are played.
-- Commissioner, 2026-09-28 (answers to my follow-up questions):
--   Q42 (should a set number of forfeits flag a club?): "10 games could be a good amount to flag at. if a team
--        forfeits 16 games in a season, that is grounds for a management removal decided on by staff."
--   Q47 (may one Applications reviewer decide alone?): "Only a commissioner can decide on a vote on their own.
--        Staff can only place individual votes that need to add up to 50% +1 out of all the voting staff."
--   Q60 (a "Statistics correction" request to the statistics department, management only?): "yes"
--   Resend trades: "just resending. Teams are free to send offers and deny other teams offers as they wish. It
--        only becomes the staff's problem when they spot a suspicious trade that would require a rescind."
--   Q63 (if a season sets a minimum number of games before a waiver, does it apply to trades?): "in theory, yes."
--   Q40 (does a game moved into a later week count toward the week it is played?): "Yes, however specify that
--        this will almost never happen unless act of god circumstances permit it."

/* ---- Q42: forfeits flag the league office at 10, and 16 are grounds for removing management -------------- */
create or replace function public.flag_club_forfeits()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_team uuid := new.forfeit_team_id; v_n int; v_name text; v_step int; v_key text; v_num int;
begin
  if v_team is null or coalesce(new.voided, false) then return new; end if;
  if tg_op = 'UPDATE' and old.forfeit_team_id is not distinct from new.forfeit_team_id
     and coalesce(old.voided,false) = coalesce(new.voided,false) then return new; end if;
  select count(*) into v_n from public.games g
   where g.season_id = new.season_id and g.forfeit_team_id = v_team and not coalesce(g.voided, false);
  select number into v_num from public.seasons where id = new.season_id;
  select coalesce(name, code) into v_name from public.teams where id = v_team;
  foreach v_step in array array[16, 10] loop
    if v_n >= v_step then
      v_key := 'forfeit_flag_'||v_num||'_'||v_team||'_'||v_step;
      if not exists (select 1 from public.app_config where key = v_key) then
        insert into public.app_config(key, value) values (v_key, now()::text);
        if v_step = 16 then
          perform public.notify_department('officiating', 'flag', v_name||': sixteen forfeits this season',
            v_name||' has forfeited '||v_n||' games in Season '||v_num||'. Sixteen forfeits in a season are grounds for removing the club''s management, a decision for the league staff (Rule 3.2).',
            'staffdesk', null);
          perform public.notify_commissioners(null, 'flag', v_name||': sixteen forfeits this season',
            v_name||' has forfeited '||v_n||' games this season: grounds for removing its management, decided by the staff (Rule 3.2).', 'admin', null);
        else
          perform public.notify_department('officiating', 'flag', v_name||': ten forfeits this season',
            v_name||' has forfeited '||v_n||' games in Season '||v_num||'. Ten forfeits flag a club for review (Rule 3.2); at sixteen its management may be removed.',
            'staffdesk', null);
        end if;
        exit;   -- the higher threshold says everything the lower one would
      end if;
    end if;
  end loop;
  return new;
end $fn$;
revoke all on function public.flag_club_forfeits() from public, anon, authenticated;
drop trigger if exists flag_club_forfeits_trg on public.games;
create trigger flag_club_forfeits_trg after insert or update of forfeit_team_id, voided on public.games
  for each row execute function public.flag_club_forfeits();

/* ---- Q47: a reviewer vote decides at a majority of ALL reviewers; alone, only a commissioner ------------- */
create or replace function public.resolve_application_if_ready(p_type text, p_id uuid)
 returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_status text; v_e int; v_need int; v_a int; v_d int;
begin
  if    p_type = 'owner'      then select status into v_status from public.owner_applications where id = p_id;
  elsif p_type = 'staff'      then select status into v_status from public.staff_applications where id = p_id;
  elsif p_type = 'management' then select status into v_status from public.management_applications where id = p_id;
  else return; end if;
  if v_status is null or v_status <> 'pending' then return; end if;

  v_e := public.app_reviewer_count();
  if v_e < 1 then return; end if;   -- no reviewers assigned; a commissioner decides it
  /* v3.68 (Q47): "50% +1 out of all the voting staff". It is decided the moment it is certain: approved
     when the approvals reach the majority of every reviewer, denied when so many deny that the majority
     can no longer be reached. Waiting on every last reviewer is gone. */
  v_need := (v_e / 2) + 1;
  select count(*) filter (where b.vote = 'approve' and public.is_app_reviewer(b.voter_id)),
         count(*) filter (where b.vote = 'deny'    and public.is_app_reviewer(b.voter_id))
    into v_a, v_d from public.application_ballots b where b.app_type = p_type and b.application_id = p_id;
  if v_a >= v_need then
    perform public.apply_application_decision(p_type, p_id, true);
  elsif v_d > v_e - v_need then
    perform public.apply_application_decision(p_type, p_id, false);
  end if;
end $fn$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.decide_owner_application(uuid,boolean,text)'::regprocedure);
  d := replace(d0,
'  if not public.has_department(''applications'') then
    raise exception ''Owner applications are decided by the Applications review board.'';
  end if;',
'  /* v3.68 (Q47): "Only a commissioner can decide on a vote on their own." Reviewers vote (application_ballots). */
  if not public.is_commissioner() then
    raise exception ''Only a commissioner decides an application alone. Reviewers cast their vote on the application instead.'';
  end if;');
  if d = d0 then raise exception 'decide_owner_application: the gate was not found'; end if;
  execute d;
  d0 := pg_get_functiondef('public.decide_staff_application(uuid,boolean,text)'::regprocedure);
  d := replace(d0,
'  if not public.has_department(''applications'') then
    raise exception ''Staff applications are decided by the Applications review board.'';
  end if;',
'  /* v3.68 (Q47): "Only a commissioner can decide on a vote on their own." Reviewers vote (application_ballots). */
  if not public.is_commissioner() then
    raise exception ''Only a commissioner decides an application alone. Reviewers cast their vote on the application instead.'';
  end if;');
  if d = d0 then raise exception 'decide_staff_application: the gate was not found'; end if;
  execute d;
end $mig$;

/* ---- Q60: a Statistics correction goes from a club's front office to the statistics department ---------- */
alter table public.action_requests drop constraint if exists action_requests_type_check;
alter table public.action_requests add constraint action_requests_type_check
  check (type = any (array['complaint','appeal','trade_request','position_change','stats_correction']));

create or replace function public.ar_label(t text)
 returns text language sql immutable set search_path to 'public' as $fn$
  select case t when 'complaint' then 'complaint' when 'appeal' then 'suspension/ban appeal'
    when 'trade_request' then 'trade request' when 'position_change' then 'position-change request'
    when 'stats_correction' then 'statistics correction' else 'request' end;
$fn$;

create or replace function public.guard_stats_correction()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_team uuid;
begin
  if new.type <> 'stats_correction' then return new; end if;
  select t.id into v_team from public.teams t
   where new.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id) limit 1;
  if v_team is null then
    raise exception 'A statistics correction is filed by a club''s Owner, GM or AGM (Rule 6.3). A player raises it with his front office.'
      using errcode = 'check_violation';
  end if;
  new.team_id := v_team;
  new.route := 'commissioner';
  new.dept := 'statistics';
  new.subject := coalesce(nullif(btrim(new.subject), ''), 'Statistics correction');
  return new;
end $fn$;
revoke all on function public.guard_stats_correction() from public, anon, authenticated;
drop trigger if exists guard_stats_correction_trg on public.action_requests;
create trigger guard_stats_correction_trg before insert on public.action_requests
  for each row execute function public.guard_stats_correction();

create or replace function public.notify_stats_correction()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_club text; v_who text;
begin
  if new.type <> 'stats_correction' then return new; end if;
  select coalesce(name, code) into v_club from public.teams where id = new.team_id;
  select coalesce(nullif(gamertag,''), 'A manager') into v_who from public.profiles where id = new.profile_id;
  perform public.notify_department('statistics', 'request', 'Statistics correction from '||coalesce(v_club,'a club'),
    v_who||' ('||coalesce(v_club,'a club')||') asks for a correction: '||coalesce(new.subject,'')||'. '||left(coalesce(new.details,''), 280),
    'complaints', new.id::text);
  return new;
end $fn$;
revoke all on function public.notify_stats_correction() from public, anon, authenticated;
drop trigger if exists notify_stats_correction_trg on public.action_requests;
create trigger notify_stats_correction_trg after insert on public.action_requests
  for each row execute function public.notify_stats_correction();

/* ---- resending a trade: the transactions department re-sends an offer as it was ------------------------- */
create or replace function public.resend_trade(p_trade uuid)
 returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare t public.trades; v_new uuid; pid uuid; v_season uuid;
begin
  if not (public.is_commissioner() or public.has_department('transactions')) then
    raise exception 'Only the transactions department or a commissioner can resend a trade.';
  end if;
  select * into t from public.trades where id = p_trade;
  if not found then raise exception 'Trade not found.'; end if;
  if t.status not in ('declined', 'cancelled') then
    raise exception 'Only a declined or withdrawn offer can be resent (this one is %).', t.status;
  end if;
  v_season := public.current_season_id();
  if t.season_id is distinct from v_season then raise exception 'That offer is from an earlier season.'; end if;
  foreach pid in array coalesce(t.offered_profile_ids, '{}'::uuid[]) loop
    if not exists (select 1 from public.roster_spots rs where rs.season_id = v_season and rs.team_id = t.from_team_id and rs.profile_id = pid and rs.status = 'active') then
      raise exception '% is no longer with the club that offered him, so the offer cannot be resent as it was.',
        coalesce((select gamertag from public.profiles where id = pid), 'A player');
    end if;
  end loop;
  foreach pid in array coalesce(t.requested_profile_ids, '{}'::uuid[]) loop
    if not exists (select 1 from public.roster_spots rs where rs.season_id = v_season and rs.team_id = t.to_team_id and rs.profile_id = pid and rs.status = 'active') then
      raise exception '% is no longer with the club asked for him, so the offer cannot be resent as it was.',
        coalesce((select gamertag from public.profiles where id = pid), 'A player');
    end if;
  end loop;
  insert into public.trades(season_id, from_team_id, to_team_id, from_profile_id, offered_profile_ids, requested_profile_ids,
                            offered_pick_ids, requested_pick_ids, retention, note, status)
    values (t.season_id, t.from_team_id, t.to_team_id, t.from_profile_id, t.offered_profile_ids, t.requested_profile_ids,
            t.offered_pick_ids, t.requested_pick_ids, coalesce(t.retention, '{}'::jsonb),
            'Resent by the league office'||coalesce(': '||nullif(btrim(t.note),''), ''), 'proposed')
    returning id into v_new;
  perform public.log_admin_action('trade_resent', 'trade', v_new::text, jsonb_build_object('from_trade', p_trade));
  return v_new;
end $fn$;
revoke all on function public.resend_trade(uuid) from public, anon;
grant execute on function public.resend_trade(uuid) to authenticated;

/* ---- Q63: a season's service minimum gates trades as well as waivers ------------------------------------ */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.can_move_player(uuid,uuid)'::regprocedure);
  d := replace(d0, 'regular-season games a player needs this season before he can be waived.''',
                   'regular-season games a player needs this season before he can be waived or traded.''');
  if position('waived or traded' in d) = 0 then raise exception 'can_move_player: message not updated'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_trade_insert()'::regprocedure);
  d := replace(d0,
'  /* v3.40 (commissioner announcement, 2026-09-26):',
'  /* v3.68 (Q63): a season that sets a service minimum applies it to a trade as it does to a waiver ("in
     theory, yes"). can_move_player returns nothing while the minimum is zero, as it is today. */
  if new.status in (''proposed'', ''accepted'') then
    declare v_p uuid; v_why text;
    begin
      foreach v_p in array coalesce(new.offered_profile_ids, ''{}''::uuid[]) || coalesce(new.requested_profile_ids, ''{}''::uuid[]) loop
        v_why := public.can_move_player(new.season_id, v_p);
        if v_why is not null then raise exception ''%'', v_why using errcode = ''check_violation''; end if;
      end loop;
    end;
  end if;
  /* v3.40 (commissioner announcement, 2026-09-26):');
  if d = d0 then raise exception 'guard_trade_insert: the v3.40 anchor was not found'; end if;
  execute d;
end $mig$;

/* ---- Q40: a game moved into another week counts in the week it is played --------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.ops_reschedule_game(uuid,timestamp with time zone)'::regprocedure);
  d := replace(d0,
'  update public.games set scheduled_at = p_at where id = p_game;',
'  /* v3.68 (Q40): a regular-season or pre-season game moved into another game-week counts toward the week
     it is played in (Rule 3.3): its week becomes the week of the league''s other games on that calendar week.
     A playoff game keeps its week, because a playoff week is its series. Moving a game across weeks is
     reserved for circumstances beyond anyone''s control. */
  if coalesce(g.stage, ''regular'') <> ''playoff'' then
    select g2.week into v_week from public.games g2
     where g2.season_id = g.season_id and coalesce(g2.stage,''regular'') = coalesce(g.stage,''regular'') and g2.id <> g.id
       and date_trunc(''week'', g2.scheduled_at at time zone ''America/New_York'') = date_trunc(''week'', p_at at time zone ''America/New_York'')
     group by g2.week order by count(*) desc limit 1;
  end if;
  update public.games set scheduled_at = p_at, week = coalesce(v_week, week) where id = p_game;');
  d := replace(d, 'declare g record;', 'declare g record; v_week int;');
  d := replace(d,
'      to_char(p_at at time zone ''America/New_York'', ''Mon DD, HH12:MI AM'')));',
'      to_char(p_at at time zone ''America/New_York'', ''Mon DD, HH12:MI AM''))
      || case when v_week is not null and v_week is distinct from g.week
              then format('' It now counts toward Week %s, the week it is played (Rule 3.3).'', v_week) else '''' end);');
  if position('v_week int' in d) = 0 or position('week = coalesce(v_week, week)' in d) = 0 or position('the week it is played (Rule 3.3)' in d) = 0 then
    raise exception 'ops_reschedule_game patch did not land in full';
  end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-09-28, two transactions on the live database, each rolled back by a closing raise):
   Q42  With the other game triggers disabled inside the transaction, twelve of DAL's scheduled games were marked
        DAL forfeits (4 already on record): the officiating department was flagged once at 10 and once at 16, and
        the commissioners at 16; app_config keys forfeit_flag_1_<DAL>_10 and _16 recorded it.
   Q47  A staff application: pending at 2 approvals of 5 reviewers, approved at the 3rd. A second one: pending at 2
        denials, denied at the 3rd. A reviewer calling decide_owner_application alone was refused ("Only a
        commissioner decides an application alone").
   Q60  DAL's GM filed a stats_correction: team set to DAL, dept statistics, subject "Statistics correction", the
        statisticians notified. A member with no club seat was refused.
   resend  An officiating staffer's resend_trade was refused; the transactions staffer's re-sent the declined BOS-DAL
        offer as a new proposed trade noted "Resent by the league office: forwards swap".
   Q63  With min_service_gp stubbed to 99, a new offer was refused "...before he can be waived or traded."
   Q40  A week-2 game moved to a week-3 slot took week 3, and the wire read "It now counts toward Week 3, the week it
        is played (Rule 3.3)."
   (The first attempt used an owner application, which the owner-application deadline refused; a second staff
   application replaced it.)
   Result: REHEARSAL OK (both parts). Applied as migration v368_office_procedures. */
