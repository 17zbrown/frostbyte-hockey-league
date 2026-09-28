-- v3.69: a club's General Manager and Assistant GM seats end when its season ends; the Owner's seat continues.
-- Commissioner, 2026-09-28:
--   Q45: "management contracts end at the end of playoffs FOR THAT TEAM."
--   Asked whether the seats end then too: "Just the GM and AGM seats do. The Owner stays for now."
-- A club's season ends at one of three moments, each recorded by the league once:
--   * it misses the playoffs: the seeds are frozen when round 1 is generated (site_config playoff_seeds_<n>);
--   * it is eliminated: its series result is recorded (app_config series_<n>_<week>_<a>_<b>, first decision only);
--   * it plays the final: the season is marked complete.
-- The seat ends through _set_team_seat, so the manager keeps his roster spot and is told why, exactly as a
-- removal works (Rule 2.6); the Owner is told to name his management for next season. Between the end of the
-- playoffs and the next draft he may name anyone (Q27, v3.61).

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public._set_team_seat(uuid,text,uuid,text)'::regprocedure);
  d := replace(d0, 'if p_by not in (''office'',''owner'') then', 'if p_by not in (''office'',''owner'',''season'') then');
  d := replace(d,
'        case when p_by = ''owner'' then ''The club''''s Owner removed you from the seat (Rule 2.6).''',
'        case when p_by = ''owner'' then ''The club''''s Owner removed you from the seat (Rule 2.6).''
             when p_by = ''season'' then ''Your club''''s season is over, and the General Manager and Assistant GM seats end with it (Rule 2.6). The Owner may name you again for next season.''');
  if position('''office'',''owner'',''season''' in d) = 0 or position('seats end with it (Rule 2.6)' in d) = 0 then
    raise exception '_set_team_seat patch did not land in full';
  end if;
  execute d;
end $mig$;

create or replace function public.end_season_mgmt_seats(p_team uuid, p_why text)
 returns int language plpgsql security definer set search_path to 'public' as $fn$
declare t record; v_n int := 0; v_grant text;
begin
  select id, name, code, owner_profile_id, gm_profile_id, agm_profile_id into t from public.teams where id = p_team;
  if t.id is null then return 0; end if;
  v_grant := coalesce(current_setting('app.role_grant', true), '');
  perform set_config('app.role_grant', 'on', true);
  if t.gm_profile_id is not null then perform public._set_team_seat(p_team, 'gm', null, 'season'); v_n := v_n + 1; end if;
  if t.agm_profile_id is not null then perform public._set_team_seat(p_team, 'agm', null, 'season'); v_n := v_n + 1; end if;
  perform set_config('app.role_grant', v_grant, true);
  if v_n > 0 and t.owner_profile_id is not null then
    perform public.create_notification(t.owner_profile_id, 'role', 'Your club''s season is over',
      'The '||coalesce(t.name, t.code)||' '||p_why||', so the General Manager and Assistant GM seats have ended (Rule 2.6). Your seat continues. Name your management for next season from Team HQ; until the next draft you may name anyone signed up for it.',
      'manager', 'management');
  end if;
  return v_n;
end $fn$;
revoke all on function public.end_season_mgmt_seats(uuid, text) from public, anon, authenticated;

/* eliminated: the first recorded result of a series names its loser */
create or replace function public.trg_series_ends_seats()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_parts text[]; v_a uuid; v_b uuid; v_loser uuid;
begin
  if new.key not like 'series\_%' then return new; end if;
  v_parts := string_to_array(new.key, '_');          -- series, <n>, <week>, <a>, <b>
  if array_length(v_parts, 1) <> 5 then return new; end if;
  begin v_a := v_parts[4]::uuid; v_b := v_parts[5]::uuid; exception when others then return new; end;
  v_loser := case when new.value = v_a::text then v_b when new.value = v_b::text then v_a end;
  if v_loser is null then return new; end if;
  perform public.end_season_mgmt_seats(v_loser, 'were eliminated from the playoffs');
  return new;
end $fn$;
revoke all on function public.trg_series_ends_seats() from public, anon, authenticated;
drop trigger if exists series_ends_seats_trg on public.app_config;
create trigger series_ends_seats_trg after insert on public.app_config
  for each row when (new.key like 'series\_%') execute function public.trg_series_ends_seats();

/* missed the playoffs: the seeds frozen with round 1 leave them out */
create or replace function public.trg_seeds_end_seats()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_codes text[]; t record; v_n int := 0;
begin
  if new.key not like 'playoff\_seeds\_%' or jsonb_typeof(new.value) <> 'array' then return new; end if;
  if split_part(new.key, '_', 3) <> public.current_season_num()::text then return new; end if;
  select array_agg(x) into v_codes from jsonb_array_elements_text(new.value) x;
  if coalesce(array_length(v_codes, 1), 0) = 0 then return new; end if;
  for t in select id from public.teams where not (code = any(v_codes)) loop
    v_n := v_n + public.end_season_mgmt_seats(t.id, 'did not qualify for the playoffs');
  end loop;
  if v_n > 0 then
    perform public.notify_commissioners(null, 'flag', 'GM and AGM seats ended for the clubs out of the playoffs',
      v_n||' seat(s) ended when the bracket was seeded (Rule 2.6). If round 1 is cleared and reseeded, clubs that qualify after all need their management reseated under Teams.',
      'admin', null);
  end if;
  return new;
end $fn$;
revoke all on function public.trg_seeds_end_seats() from public, anon, authenticated;
drop trigger if exists seeds_end_seats_trg on public.site_config;
create trigger seeds_end_seats_trg after insert on public.site_config
  for each row when (new.key like 'playoff\_seeds\_%') execute function public.trg_seeds_end_seats();

/* the final is played: every seat still held ends with the season */
create or replace function public.trg_season_complete_ends_seats()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare t record;
begin
  if new.status <> 'complete' or old.status = 'complete' then return new; end if;
  for t in select id from public.teams where gm_profile_id is not null or agm_profile_id is not null loop
    perform public.end_season_mgmt_seats(t.id, 'finished the season');
  end loop;
  return new;
end $fn$;
revoke all on function public.trg_season_complete_ends_seats() from public, anon, authenticated;
drop trigger if exists season_complete_ends_seats_trg on public.seasons;
create trigger season_complete_ends_seats_trg after update of status on public.seasons
  for each row execute function public.trg_season_complete_ends_seats();

/* REHEARSAL (2026-09-28, one transaction on the live database, rolled back by a closing raise):
   seeds     site_config playoff_seeds_1 = NYI, PIT, SEA, DAL, UTA, DET: BOS and VAN lost their GM and AGM seats; their
             Owners kept theirs and were told ("Your club's season is over"); BOS's GM was told why and kept his roster
             spot; the seeded clubs were untouched.
   series    app_config series_1_1_<PIT>_<SEA> = PIT: SEA lost its GM and AGM; PIT kept its GM.
   complete  Season 1 marked complete: no club held a GM or AGM; every Owner kept his seat.
   Result: REHEARSAL OK. Applied as migration v369_season_end_seats. */
