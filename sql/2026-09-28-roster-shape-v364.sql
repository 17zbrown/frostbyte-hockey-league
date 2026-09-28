-- v3.64: the active roster is at most 7 forwards, 5 defensemen and 3 goaltenders (15).
-- Commissioner, 2026-09-28, Q29: "composition: 7 forwards (any sub-position), 5 defensemen, 3 goalies."
-- Asked whether that is a maximum, an exact shape or a minimum: "Set it, and send a notice to all teams who
-- are over the requirement on any of the 3 position groups with a reminder to fix it before the roster/tc
-- weekly lock." So each figure is the most a group may hold, and the three sum to the roster's fifteen.
-- Clubs over on the day (DET 9 F, NYI 8 F, PIT 8 F, SEA 9 F, UTA 6 D) are told, and so is the transactions
-- department.

/* ---- the format: one token (the basic quota), and the "lines plus flex" wording goes with it ------------ */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.format_rules(text)'::regprocedure);
  d := replace(d0, '"quota":{"F":9,"D":7,"G":5},"lines":2,"flex":3', '"quota":{"F":7,"D":5,"G":3},"lines":null,"flex":null');
  if d = d0 then raise exception 'format_rules: the basic quota 9/7/5 was not found'; end if;
  execute d;
end $mig$;

/* ---- the shape check judges the player who ENTERS the counted roster, not the whole club ---------------
   Before v3.64 every change to any roster row re-tested the whole active roster, which was harmless while no
   club could be over. With a smaller shape published mid-season, five clubs start over it, and that test
   would refuse every one of their moves, including the send-down that fixes the problem (nine forwards to
   eight is still over seven). Now a row is tested only when it enters a club's counted active roster: an
   insert onto the active roster, a call-up, a trade or reinstatement onto it, or a position change into
   another group. It must fit its own group and the roster total. A club over in one group may still send
   players down, waive, trade them away, and move players in other groups; it may not add to the group it is
   over in, and a like-for-like swap in that group is refused until it is back within the limit. */
create or replace function public.check_roster_structure()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_season uuid; v_team uuid; f int; d int; g int; qf int; qd int; qg int; v_max int;
        v_grp text; v_cnt int; v_cap int;
        v_loans constant text[] := array['preseason_random','latecomer_random'];
begin
  if tg_op = 'DELETE' then return null; end if;
  /* not counted: camp, an inactive row, a pre-season loan */
  if not (NEW.squad = 'pro' and NEW.status = 'active' and not (coalesce(NEW.origin,'') = any(v_loans))) then
    return null;
  end if;
  /* already counted in the same group of the same club: nothing entered */
  if tg_op = 'UPDATE' and OLD.squad = 'pro' and OLD.status = 'active' and not (coalesce(OLD.origin,'') = any(v_loans))
     and OLD.team_id = NEW.team_id and OLD.season_id = NEW.season_id
     and public.pos_group(OLD.position) = public.pos_group(NEW.position) then
    return null;
  end if;
  v_season := NEW.season_id; v_team := NEW.team_id;
  qf := public.group_cap_of('F', v_season); qd := public.group_cap_of('D', v_season); qg := public.group_cap_of('G', v_season);
  v_max := (public.season_rules(v_season)->>'roster_max')::int;
  select
    count(*) filter (where squad='pro' and public.pos_group(position)='F' and not (coalesce(origin,'') = any(v_loans))),
    count(*) filter (where squad='pro' and public.pos_group(position)='D' and not (coalesce(origin,'') = any(v_loans))),
    count(*) filter (where squad='pro' and public.pos_group(position)='G' and not (coalesce(origin,'') = any(v_loans)))
    into f, d, g
    from roster_spots where season_id = v_season and team_id = v_team and status = 'active';
  v_grp := public.pos_group(NEW.position);
  v_cnt := case v_grp when 'F' then f when 'D' then d else g end;
  v_cap := case v_grp when 'F' then qf when 'D' then qd else qg end;
  if v_cnt > v_cap or (f + d + g) > v_max then
    raise exception 'Rule 2.1: the active roster holds at most % players: % forwards, % defensemen and % goaltenders. This move would leave the club with % forwards, % defensemen and % goaltenders. Make room in that group first; training camp and pre-season loans do not count.', v_max, qf, qd, qg, f, d, g
      using errcode = 'check_violation';
  end if;
  return null;
end $fn$;

/* ---- the notice: every club over in any group, and the transactions department ----------------------- */
do $mig$
declare v_season uuid := public.current_season_id(); t record; v_lock timestamp; v_when text; v_over text; v_list text[] := '{}';
        qf int; qd int; qg int;
begin
  qf := public.group_cap_of('F', v_season); qd := public.group_cap_of('D', v_season); qg := public.group_cap_of('G', v_season);
  /* the next weekly freeze: Wednesday 7:30 PM Eastern (Rule 2.1) */
  v_lock := date_trunc('week', now() at time zone 'America/New_York') + interval '2 days 19 hours 30 minutes';
  if v_lock <= (now() at time zone 'America/New_York') then v_lock := v_lock + interval '7 days'; end if;
  v_when := trim(to_char(v_lock, 'FMDay, FMMonth FMDD "at" FMHH12:MI AM')) || ' Eastern';
  for t in
    select tm.id, tm.code, tm.name,
      count(*) filter (where public.pos_group(rs.position)='F') f,
      count(*) filter (where public.pos_group(rs.position)='D') d,
      count(*) filter (where public.pos_group(rs.position)='G') g
    from public.teams tm join public.roster_spots rs on rs.team_id = tm.id and rs.season_id = v_season
     and rs.status = 'active' and rs.squad = 'pro' and not (coalesce(rs.origin,'') = any(array['preseason_random','latecomer_random']))
    group by tm.id, tm.code, tm.name
    having count(*) filter (where public.pos_group(rs.position)='F') > qf
        or count(*) filter (where public.pos_group(rs.position)='D') > qd
        or count(*) filter (where public.pos_group(rs.position)='G') > qg
    order by tm.code
  loop
    v_over := array_to_string(array_remove(array[
      case when t.f > qf then (t.f - qf)||' forward'||case when t.f - qf = 1 then '' else 's' end end,
      case when t.d > qd then (t.d - qd)||' defense'||case when t.d - qd = 1 then 'man' else 'men' end end,
      case when t.g > qg then (t.g - qg)||' goaltender'||case when t.g - qg = 1 then '' else 's' end end], null), ' and ');
    perform public.club_notify(t.id, 'flag', 'Roster over the new limits: fix by '||v_when,
      'The commissioner has set the active roster at no more than '||qf||' forwards, '||qd||' defensemen and '||qg||' goaltenders (Rule 2.1). '||
      'Yours has '||t.f||' forwards, '||t.d||' defensemen and '||t.g||' goaltenders, so you are over by '||v_over||'. '||
      'Please fix it before the roster freezes on '||v_when||': send players to training camp (it holds 10), waive them, or trade them. '||
      'Until you are within the limits you can still send players down, waive and trade, but you cannot add to a group you are over in.',
      null, 'manager', 'roster', null, false);
    v_list := v_list || (t.code||' '||t.f||'F/'||t.d||'D/'||t.g||'G');
  end loop;
  if coalesce(array_length(v_list,1),0) > 0 then
    perform public.notify_department('transactions', 'flag', 'Clubs over the new roster limits',
      'The active roster is now at most '||qf||' forwards, '||qd||' defensemen and '||qg||' goaltenders (Rule 2.1). Over today: '||
      array_to_string(v_list, ', ')||'. Each club was told to fix it before the roster freezes on '||v_when||'.', 'staffdesk', null);
  end if;
  raise notice 'v3.64 notices: %', array_to_string(v_list, ', ');
end $mig$;

/* REHEARSAL (2026-09-28, one transaction on the live database, rolled back by a closing raise):
   format_rules('basic') quota {"F":7,"D":5,"G":3}, lines null; group_cap_of('F', Season 1) = 7.
   Notices: 12 front-office notices (the seat holders of DET, NYI, PIT, SEA and UTA), each naming the club's
   counts, the excess and the freeze ("Wednesday, September 30 at 7:30 PM Eastern"), plus one to the
   transactions department. Sample: "Yours has 9 forwards, 4 defensemen and 2 goaltenders, so you are over
   by 2 forwards."
   DET (9 forwards): toggling a pro forward's block flag passed; sending a forward down (9 to 8, still over)
   passed; calling a camp forward up was refused, "Rule 2.1: the active roster holds at most 15 players: 7
   forwards, 5 defensemen and 3 goaltenders."
   Applied as migration v364_roster_shape; the notices went out on apply. */
