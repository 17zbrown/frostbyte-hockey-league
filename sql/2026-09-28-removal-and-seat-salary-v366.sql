-- v3.66: a player the league office removes from a roster is a free agent; a player leaving a management
-- seat gets his old salary back when it is higher than the seat's.
-- Commissioner, 2026-09-28:
--   Q12 (what happens to a player the league office removes from a roster?): "Becomes a free agent."
--   Q28 (should a manager's old salary come back when he leaves the seat?): "yes the old salary should come
--        back only if it is higher than what the management seat offers."

/* ---- Q12 --------------------------------------------------------------------------------------------------
   admin_remove_from_roster reset the registration to 'pending' and nothing else, which is exactly the
   state of an undrafted registrant: the next placement sweep would draw him back onto a club at random
   (the v3.06 and v3.45 waiver bugs, by another door). Stamping waived_at makes him what a waiver makes
   him, a free agent any club may sign (Rule 2.2). A seat holder cannot be removed at all:
   protect_manager_spot refuses it, and the seat is vacated first (Rule 2.6). */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.admin_remove_from_roster(uuid,uuid)'::regprocedure);
  d := replace(d0,
'  update public.season_registrations set status = ''pending''
    where season_id = v_season.id and profile_id = p_profile;',
'  /* v3.66 (Q12): he is a free agent, exactly as a waiver leaves him (Rule 2.2) */
  perform set_config(''app.role_grant'', ''on'', true);
  update public.season_registrations set status = ''pending'', waived_at = now()
    where season_id = v_season.id and profile_id = p_profile;
  perform set_config(''app.role_grant'', '''', true);
  perform public.create_notification(p_profile, ''waive'', ''You are a free agent'',
    ''The league office removed you from ''||coalesce(v_club, ''your club'')||''. You are a free agent: any club may sign you, at the salary you were earning (Rule 2.2).'',
    ''manager'', ''freeagents'');');
  d := replace(d,
'      || coalesce('' from '' || v_club, ''''));',
'      || coalesce('' from '' || v_club, '''') || ''; he is a free agent (Rule 2.2)'');');
  if position('v3.66 (Q12)' in d) = 0 or position('he is a free agent (Rule 2.2)' in d) = 0 then
    raise exception 'admin_remove_from_roster patch did not land in full';
  end if;
  execute d;
end $mig$;

/* ---- Q28 ---------------------------------------------------------------------------------------------------
   The salary a player earned before his FIRST seat is kept beside his spot, and when his last seat ends he
   takes the greatest of that salary, the seat's figure and the league minimum. Moving between seats does not
   overwrite it: only a player who is not yet on a management contract has a pre-seat salary to keep. */
alter table public.roster_spots add column if not exists pre_seat_salary bigint;
comment on column public.roster_spots.pre_seat_salary is
  'v3.66 (Rule 2.6): the salary he earned before his first management seat; restored when the seat ends if it is higher than the seat''s figure.';

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.ensure_manager_rostered(uuid,uuid)'::regprocedure);
  d := replace(d0,
'declare v_season uuid; v_num int; v_pos hockey_position; v_snum int; v_spot uuid; v_sal bigint; v_grant text;',
'declare v_season uuid; v_num int; v_pos hockey_position; v_snum int; v_spot uuid; v_sal bigint; v_grant text; v_was_mgr boolean;');
  d := replace(d,
'  perform set_config(''app.mgr_sync'',''1'',true);
  if exists(select 1 from public.contracts where profile_id=p_profile and status=''active'') then',
'  perform set_config(''app.mgr_sync'',''1'',true);
  /* v3.66 (Q28): read before the contract below becomes a management one */
  v_was_mgr := exists(select 1 from public.contracts where profile_id=p_profile and status=''active'' and coalesce(is_manager,false));
  if exists(select 1 from public.contracts where profile_id=p_profile and status=''active'') then');
  d := replace(d,
'    update public.roster_spots set team_id=p_team, salary=v_sal where id=v_spot;',
'    /* v3.66 (Q28): keep what he earned before his first seat */
    if not v_was_mgr then
      update public.roster_spots set pre_seat_salary = coalesce(pre_seat_salary, salary) where id=v_spot;
    end if;
    update public.roster_spots set team_id=p_team, salary=v_sal where id=v_spot;');
  if position('v_was_mgr boolean' in d) = 0 or position('v_was_mgr := exists' in d) = 0 or position('pre_seat_salary = coalesce(pre_seat_salary, salary)' in d) = 0 then
    raise exception 'ensure_manager_rostered patch did not land in full';
  end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public._set_team_seat(uuid,text,uuid,text)'::regprocedure);
  d := replace(d0,
'    update public.roster_spots
       set salary = greatest(coalesce(salary,0), 750000)
     where season_id = v_season and profile_id = v_prev
    returning salary into v_sal;',
'    /* v3.66 (Q28): the salary he earned before the seat comes back when it is higher than the seat''s */
    update public.roster_spots
       set salary = greatest(coalesce(salary,0), coalesce(pre_seat_salary,0), 750000), pre_seat_salary = null
     where season_id = v_season and profile_id = v_prev
    returning salary into v_sal;');
  if d = d0 then raise exception '_set_team_seat patch matched nothing'; end if;
  execute d;
end $mig$;

/* the one sitting manager with an earlier salary: UTA's Owner, oKniesy, drafted in round 10 of Season 1
   ($1,250,000) before his seat. Every other seat holder was rostered by the seat itself. */
update public.roster_spots rs set pre_seat_salary = public.draft_pick_salary(1, dp.round)
  from public.draft_picks dp, public.teams t
 where dp.season_number = 1 and dp.used and dp.player_id = rs.profile_id
   and rs.season_id = public.current_season_id() and rs.team_id = t.id
   and rs.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id)
   and rs.pre_seat_salary is null;

/* REHEARSAL (2026-09-28, one transaction on the live database, rolled back by a closing raise; claims set
   to the commissioner):
   backfill  oKniesy (UTA Owner, drafted round 10) pre_seat_salary = 1,250,000.
   Q12  admin_remove_from_roster(biz, SEA): waived_at stamped, he was told "You are a free agent", the wire
        reads "...removed <b>biz</b> from Seattle; he is a free agent (Rule 2.2)", and _assign_reg_random on
        his registration placed nobody.
   Q28  Delco PAWXS ($3,500,000) named PIT GM (the seat pays $0): salary 0, pre_seat_salary 3,500,000. Seat
        emptied: salary 3,500,000, pre_seat_salary cleared. The GM he displaced, with no earlier salary, took
        the league minimum, 750,000.
   Result: REHEARSAL OK. Applied as migration v366_removal_and_seat_salary. */
