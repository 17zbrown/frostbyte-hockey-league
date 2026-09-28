-- v3.67: the league office is bound by the salary cap; overalls are the ratings engine's alone; combining a
-- lagged-out game's sittings is statistics staff's.
-- Commissioner, 2026-09-28:
--   Q52 (may a commissioner's own action, accepting a trade, entering a player or appointing a manager,
--        push a club over the salary cap?): "no."
--   Q59 (should a commissioner's hand correction of a player's overall stick?): "commissioners should not
--        be able to edit player or team overalls."
--   Q23 (who may combine a lagged-out game's sittings from the club game-stats desk?): "Only the specific
--        staff for that and commissioners." Enforced in netlify/functions/ingest-stats.js (leagueMerge):
--        a club's management attaches one sitting; two or more are a statistics-staff merge.

/* ---- Q52: no commissioner exemption from the cap ---------------------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_roster_cap()'::regprocedure);
  d := replace(d0,
'  if public.is_commissioner() then return new; end if;',
'  /* v3.67 (Q52): a commissioner''s own entry is bound by the cap like any club''s ("no"); the exemption
     that stood here is gone. mgr_sync stays, because ensure_manager_rostered checks the appointment
     itself; contract_activation stays, because the rollover restores deals already signed. */');
  if d = d0 then raise exception 'guard_roster_cap: the commissioner exemption was not found'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; v_n int; begin
  d0 := pg_get_functiondef('public.accept_trade(uuid)'::regprocedure);
  v_n := (length(d0) - length(replace(d0, 'if not public.is_commissioner() then
    select salary_cap into v_cap', ''))) / length('if not public.is_commissioner() then
    select salary_cap into v_cap');
  if v_n < 1 then raise exception 'accept_trade: the commissioner cap exemption was not found'; end if;
  d := replace(d0, 'if not public.is_commissioner() then
    select salary_cap into v_cap', 'if true then   /* v3.67 (Q52): a commissioner''s acceptance is bound by the cap too */
    select salary_cap into v_cap');
  execute d;
  raise notice 'accept_trade: % cap exemption(s) removed', v_n;
end $mig$;

/* an appointment that raises a salary is checked here, where the new figure is known: a new spot goes through
   guard_roster_cap anyway, but a player already on the club whose seat pays more than he earned changes his
   salary by UPDATE, which no cap guard sees */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.ensure_manager_rostered(uuid,uuid)'::regprocedure);
  d := replace(d0,
'  v_sal := coalesce(public.mgmt_salary_of(p_team, p_profile), 3000000);',
'  v_sal := coalesce(public.mgmt_salary_of(p_team, p_profile), 3000000);
  /* v3.67 (Q52): the appointment may not carry the club over the cap. The rise is the seat''s figure less
     what he already counts on this club (nothing if he is not on it). */
  declare v_now bigint;
  begin
    select case when rs.team_id = p_team then coalesce(rs.salary,0) else 0 end into v_now
      from public.roster_spots rs where rs.season_id = v_season and rs.profile_id = p_profile limit 1;
    if v_sal - coalesce(v_now,0) > 0 and not public.cap_has_room(v_season, p_team, v_sal - coalesce(v_now,0)) then
      raise exception ''Rule 2.5: this appointment would carry % over the salary cap: the seat counts %, and the club has % of room. Clear cap space first.'',
        (select name from public.teams where id = p_team), ''$''||to_char(v_sal/1000000.0,''FM999990.00'')||''M'',
        ''$''||to_char(greatest(0, coalesce((select salary_cap from public.seasons where id = v_season),0) - public.team_cap_used(v_season, p_team))/1000000.0,''FM999990.00'')||''M''
        using errcode = ''check_violation'';
    end if;
  end;');
  if d = d0 then raise exception 'ensure_manager_rostered: the salary line was not found'; end if;
  execute d;
end $mig$;

/* ---- Q59: overalls are the engine's alone ------------------------------------------------------------------
   profiles.overall changes only while refresh_player_overall holds app.ovr_engine; any other write, a
   commissioner's or the service role's included, keeps the old figure (the guard's existing silent-revert
   pattern, so an unrelated profile save carrying a stale overall is not refused). The hand-entered scouting
   rating (season_registrations.scout_ovr) is frozen for everyone; none was ever entered (0 of 182). */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_profile_role()'::regprocedure);
  d := replace(d0,
'begin
  if public.trusted_writer() or public.is_commissioner() then return new; end if;',
'begin
  /* v3.67 (Q59): an overall is written by the ratings engine and by nothing else */
  if new.overall is distinct from old.overall and coalesce(current_setting(''app.ovr_engine'', true), '''') <> ''on'' then
    new.overall := old.overall;
  end if;
  if public.trusted_writer() or public.is_commissioner() then return new; end if;');
  if d = d0 then raise exception 'guard_profile_role: the opening line was not found'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.refresh_player_overall(uuid)'::regprocedure);
  d := replace(d0,
'  update public.profiles set overall=v_ov where id=p_profile;',
'  perform set_config(''app.ovr_engine'', ''on'', true);   -- v3.67 (Q59): the one writer of an overall
  update public.profiles set overall=v_ov where id=p_profile;
  perform set_config(''app.ovr_engine'', '''', true);');
  if d = d0 then raise exception 'refresh_player_overall: the update was not found'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_registration_columns()'::regprocedure);
  d := replace(d0,
'begin
  if public.trusted_writer() or public.is_commissioner() or public.is_staff() then return new; end if;',
'begin
  /* v3.67 (Q59): no one hand-enters an overall, the scouting rating included */
  if tg_op = ''INSERT'' then new.scout_ovr := null;
  elsif new.scout_ovr is distinct from old.scout_ovr then new.scout_ovr := old.scout_ovr; end if;
  if public.trusted_writer() or public.is_commissioner() or public.is_staff() then return new; end if;');
  if d = d0 then raise exception 'guard_registration_columns: the opening line was not found'; end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-09-28, transactions on the live database, each rolled back by a closing raise; claims set to
   the commissioner):
   Q52 trade  BOS ($3.5M forward) for DAL ($0.75M forward), like for like so nobody overflows to camp. With the
              cap set to DAL's resulting payroll less $1, the commissioner's accept_trade was refused ("Trade
              rejected, it would put a club over the salary cap"); with the cap at exactly that payroll it went
              through.
   Q52 entry  a commissioner inserting a player onto SEA ($35.25M) under a $35.5M cap: "Over the salary cap".
   Q52 seat   a $0.75M SEA player named AGM ($2M) with $0.25M of room: "Rule 2.5: this appointment would carry
              Kraken over the salary cap: the seat counts $2.00M, and the club has $0.25M of room."
   Q59        a commissioner's and a service-role write of profiles.overall were both reverted; refresh_player_overall
              wrote the engine's figure and cleared its flag; a commissioner's scout_ovr write was reverted.
   (A first pass traded a PIT player, whose full training camp refused the overflow before the cap check ran;
   the like-for-like BOS and DAL trade replaced it.)
   Applied as migration v367_office_limits. */
