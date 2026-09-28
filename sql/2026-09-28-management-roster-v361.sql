-- v3.61: a club's management stays on its active roster, and a GM or AGM comes from the Owner's roster.
-- Commissioner, 2026-09-28:
--   Q29: "Management can never be sent to training camp, they must stay on the active roster."
--   Q27: (may the Owner name anyone as GM or AGM?) "As long as the named player is on their roster. If it
--        is the off season between the end of playoffs, and the draft of the next season, they can freely
--        sign anyone as their GM or AGM."
-- Q29's composition clause (7 F / 5 D / 3 G) is NOT applied here; it is out with the commissioner for
-- clarification, because no club's active roster matches it today.

/* ---- the season window, one definition ----------------------------------------------------------------
   "In season" runs from the start of a season's entry draft to the end of its playoffs: a season is being
   played (status active), or the current season's draft has started (live, paused or complete). Everything
   else is the off-season. current_season_id() moves to the next season the moment a season completes, so
   the window closes with the final and reopens with the next draft. The site mirrors this in
   CG.seasonUnderway(). */
create or replace function public.season_underway()
 returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select exists (select 1 from public.seasons where status = 'active')
      or exists (select 1 from public.draft_state d
                  where d.season_number = public.current_season_num()
                    and d.status in ('live','paused','complete'));
$fn$;
revoke all on function public.season_underway() from public, anon, authenticated;

/* ---- nobody sends a seat holder to camp ------------------------------------------------------------ */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_squad_move()'::regprocedure);
  d := replace(d0,
'  if NEW.squad is not distinct from OLD.squad then return NEW; end if;',
'  if NEW.squad is not distinct from OLD.squad then return NEW; end if;
  /* v3.61 (Q29): an Owner, GM or AGM holds an active-roster spot for as long as he holds the seat. No one,
     the league office included, sends him to camp; the seat ends first (Rule 2.6). */
  if NEW.squad = ''tc'' and exists (select 1 from public.teams t where t.id = NEW.team_id
       and NEW.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id)) then
    raise exception ''Rule 2.6: % holds a management seat and stays on the active roster. Management is never sent to training camp.'',
      coalesce((select gamertag from public.profiles where id = NEW.profile_id), ''This player'')
      using errcode = ''check_violation'';
  end if;');
  d := replace(d, '-- Rule 2.1: the camp limit (camp_max: 8 in the basic format since v3.55)',
                  '-- Rule 2.1: the camp limit (camp_max: 10 in the basic format since v3.58)');
  if d = d0 then raise exception 'guard_squad_move patch matched nothing'; end if;
  if position('v3.61 (Q29)' in d) = 0 then raise exception 'guard_squad_move: the Q29 block did not land'; end if;
  execute d;
end $mig$;

/* ---- an appointment seats him on the active roster, never in camp ---------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.place_new_roster_spot()'::regprocedure);
  d := replace(d0,
'  if NEW.squad = ''pro'' then
    -- Rule 2.1: the group cap',
'  /* v3.61 (Q29): a manager being seated (ensure_manager_rostered sets app.mgr_sync) is never parked in
     camp. Where his group or the roster is full, the shape check refuses the appointment instead, and the
     club makes room first. */
  if NEW.squad = ''pro'' and coalesce(current_setting(''app.mgr_sync'', true), '''') = ''1'' then return NEW; end if;
  if NEW.squad = ''pro'' then
    -- Rule 2.1: the group cap');
  if d = d0 then raise exception 'place_new_roster_spot patch matched nothing'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.ensure_manager_rostered(uuid,uuid)'::regprocedure);
  d := replace(d0,
'declare v_season uuid; v_num int; v_pos hockey_position; v_snum int; v_spot uuid; v_sal bigint;',
'declare v_season uuid; v_num int; v_pos hockey_position; v_snum int; v_spot uuid; v_sal bigint; v_grant text;');
  d := replace(d,
'    update public.roster_spots set team_id=p_team, salary=v_sal where id=v_spot;',
'    update public.roster_spots set team_id=p_team, salary=v_sal where id=v_spot;
    /* v3.61 (Q29): a manager in this club''s camp comes up to the active roster with his seat. It is the
       league''s own move, so the weekly freeze does not hold it; the shape check still applies. The
       caller''s trusted flag is restored, not cleared. */
    if (select squad from public.roster_spots where id = v_spot) = ''tc'' then
      v_grant := coalesce(current_setting(''app.role_grant'', true), '''');
      perform set_config(''app.role_grant'', ''on'', true);
      update public.roster_spots set squad = ''pro'' where id = v_spot;
      perform set_config(''app.role_grant'', v_grant, true);
    end if;');
  if position('v_grant text' in d) = 0 or position('v3.61 (Q29)' in d) = 0 then
    raise exception 'ensure_manager_rostered patch did not land in full';
  end if;
  execute d;
end $mig$;

/* ---- Q27: who the Owner may name ------------------------------------------------------------------------
   Replaces the v2.38 rule that a GM or AGM had to be a free agent. In season the nominee must be on the
   Owner's own club, and a player on the club is under a player contract by definition, so that rule is
   gone. The Rule 2.7 separation check is unchanged and applies in every window. */
create or replace function public.guard_mgmt_nominee()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_sid uuid; v_snum int; v_fmt text; v_role text; v_ok boolean; v_name text;
        v_spot_id uuid; v_squad text; v_pos public.hockey_position; v_cap int; v_max int; n_grp int; n_all int;
begin
  select id, number, format into v_sid, v_snum, v_fmt from public.seasons where id = public.current_season_id();
  select coalesce(nullif(gamertag,''),'That member'), role::text into v_name, v_role
    from public.profiles where id = new.nominee_id;
  -- office holders can't run a club (Rule 2.7), except staff whose only department is Media
  if v_role in ('staff','commissioner')
     and not public.is_role_exempt(new.nominee_id)
     and not public.is_media_only_staff(new.nominee_id) then
    raise exception '% is league % and cannot hold a club management role (Rule 2.7). Media is the only exempt department.', v_name, v_role;
  end if;

  if new.role in ('gm','agm') and public.season_underway() then
    /* v3.61 (Q27): in season, the club's own roster or its training camp */
    select rs.id, rs.squad, rs.position into v_spot_id, v_squad, v_pos from public.roster_spots rs
     where rs.season_id = v_sid and rs.team_id = new.team_id and rs.profile_id = new.nominee_id
       and rs.status = 'active'
     limit 1;
    if v_spot_id is null then
      raise exception 'Rule 2.6: during the season a General Manager or Assistant GM is named from the club''s own roster, and % is not on it. Between the end of the playoffs and the next draft the Owner may name anyone.', v_name
        using errcode = 'check_violation';
    end if;
    /* Q29: a manager stays on the active roster, so a camp player named to a seat comes up with it; say so
       now if the active roster has no room in his group, rather than at the reviewers' vote */
    if v_squad = 'tc' then
      v_cap := public.group_cap(v_pos, v_sid);
      v_max := (public.season_rules(v_sid)->>'roster_max')::int;
      select count(*) filter (where public.pos_group(position) = public.pos_group(v_pos)), count(*)
        into n_grp, n_all from public.roster_spots
       where season_id = v_sid and team_id = new.team_id and status = 'active' and squad = 'pro'
         and coalesce(origin,'') not in ('preseason_random','latecomer_random');
      if n_grp >= v_cap or n_all >= v_max then
        raise exception 'Rule 2.6: % is in training camp, and a manager plays on the active roster, which has no room for him in his position group. Make room on the active roster first, then nominate him.', v_name
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  /* the off-season: anyone signed up for the coming season */
  select exists(select 1 from public.season_registrations r
                 where r.profile_id = new.nominee_id
                   and (r.season_id = v_sid or r.season_id is null)
                   and (r.status is null or r.status::text <> 'declined'))
      or exists(select 1 from public.roster_spots s
                 where s.profile_id = new.nominee_id and s.season_id = v_sid)
    into v_ok;
  if not v_ok then
    raise exception '% is not signed up for the coming season. A General Manager or Assistant GM named in the off-season must be signed up for it.', v_name;
  end if;
  /* a player deal that carries into the coming season with ANOTHER club still binds him. In the basic
     format every player deal closes at the rollover (Rule 2.5), so nothing carries and anyone may be named. */
  if coalesce(v_fmt,'basic') <> 'basic' and exists(select 1 from public.contracts c
             where c.profile_id = new.nominee_id
               and coalesce(c.is_manager, false) = false
               and coalesce(c.status, 'active') = 'active'
               and c.team_id is distinct from new.team_id
               and coalesce(c.start_season, v_snum) <= v_snum
               and coalesce(c.end_season, v_snum) >= v_snum) then
    raise exception '% is under contract with another club for the coming season and cannot be named to this club''s front office.', v_name;
  end if;
  return new;
end $fn$;
revoke all on function public.guard_mgmt_nominee() from public, anon, authenticated;

/* REHEARSAL (2026-09-28, one transaction on the live database, rolled back by a closing raise):
   1   PIT's GM sent to camp by a trusted writer: refused, "Management is never sent to training camp".
   2   In season, PIT's Owner nominates a PIT active-roster player as AGM: accepted.
   3   PIT's Owner nominates a SEA roster player: refused, "not on it".
   4   PIT (15 of 15 active) nominates a camp center: refused, "in training camp ... no room".
   5   DAL (14 of 15 active, 4 defensemen) nominates a camp right defenseman: accepted.
   6   ensure_manager_rostered(DAL, that defenseman): his squad becomes pro, the shape check passes at
       once, and no trusted flag leaks. 6b: a caller's own trusted flag survives the call.
   7   ensure_manager_rostered(PIT, a camp player): refused at the shape check (Rule 2.1).
   8   ensure_manager_rostered(PIT, a member with no spot): the new spot is NOT parked in camp, and the
       shape check refuses it (Rule 2.1).
   9   Season 1 marked complete, no Season 2 draft: season_underway() is false. A SEA player not signed up
       for Season 2 is refused ("not signed up for the coming season"); once signed up, PIT may name him.
   10  A Season 2 draft goes live: season_underway() is true again.
   Result: REHEARSAL OK: 1 ok; 2 ok; 3 ok; 4 ok; 5 ok; 6 ok; 6b ok; 7 ok; 8 ok; 9 ok; 10 ok;
   Applied as migration v361_management_roster. After it: 0 managers in any club's camp. */
