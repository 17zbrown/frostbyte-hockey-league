-- v3.72: a traded player takes the place of the player his new club sent away.
-- Commissioner's announcement to the clubs, 2026-09-29:
--   "Movement between your active rosters and training camps are locked from 7:30PM tomorrow to 11:59PM on
--    Friday. Trades are still open, but you cannot move people up and down on your roster during that time.
--    Players on incoming trades will just replace the outgoing players' spots. If you trade for more players
--    than you give up, the extra spots will be sent to your training camp depending on if you have space on
--    your active roster for them or not."
--
-- The freeze itself (Wed 7:30 PM to Fri midnight ET, guard_squad_move) and trades staying open were already
-- true. What was not:
--   1. Placement. Every incoming player landed on the active roster first (reset_squad_on_team_change), and
--      _overflow_to_camp sent the LAST-LISTED arrivals of an over group back to camp. Nothing looked at the
--      place the departing player held, so a club could trade away a camp player and receive an active one:
--      a call-up by trade, inside the freeze.
--   2. Refusals the announcement does not foresee. _overflow_to_camp relieved only the FIRST over group, so a
--      club already over forwards could not take an extra defenseman into camp; and the deferred shape check
--      judged a queued row as the move left it, so a player placed in camp later in the same transaction was
--      still counted as entering the active roster (PIT's camp-for-camp swap with NYI was refused).
-- The rule below is the same whether or not the roster is frozen: one definition, and a trade accepted at
-- 7:29 PM places its players exactly as one accepted at 7:31 PM.

/* ---- The placement rule ---------------------------------------------------------------------------------- */
create or replace function public._place_trade_arrivals(
  p_season uuid, p_team uuid, p_incoming uuid[], p_vacated_active text[], p_departing int)
 returns integer language plpgsql security definer set search_path to 'public' as $fn$
/* Places the players a trade brought to p_team, after every player in it has moved.
   p_vacated_active: the position group of each departing player who was on p_team's ACTIVE roster.
   p_departing:      how many players p_team sent in the trade (active and camp).
   Rule 2.1 (v3.72): each arrival takes the place of a departing player, an active place for an active place
   and a camp place for a camp place; an arrival beyond the number sent joins the active roster if the roster
   and his position group have room, and the camp if not. Nobody is placed on the active roster past the
   composition or the total, and active places go first to arrivals of the same position group as a departing
   active player, then in the order the trade lists them. Returns how many arrivals went to camp. */
declare
  v_loans constant text[] := array['preseason_random','latecomer_random'];
  qf int; qd int; qg int; v_max int; v_campmax int;
  f int; d int; g int; v_camp int;
  v_allow int; v_tokens text[]; v_pid uuid; v_grp text; v_pass int; v_idx int;
  v_active uuid[] := '{}'; v_tc uuid[] := '{}'; v_names text[];
  v_role text; v_mgmt text; v_sync text; v_club text; v_n int;
begin
  if p_team is null or coalesce(cardinality(p_incoming), 0) = 0 then return 0; end if;
  if exists (select 1 from unnest(p_incoming) as u(pid)
             where not exists (select 1 from public.roster_spots rs where rs.season_id = p_season
                               and rs.team_id = p_team and rs.profile_id = u.pid and rs.status = 'active')) then
    raise exception 'Trade placement: a player in this trade is not on the club receiving him. Nothing was traded.';
  end if;
  qf := public.group_cap_of('F', p_season); qd := public.group_cap_of('D', p_season); qg := public.group_cap_of('G', p_season);
  v_max := (public.season_rules(p_season)->>'roster_max')::int;
  v_campmax := public.camp_max(p_season);

  -- the club as it stands after every move, without the arrivals
  select count(*) filter (where public.pos_group(position) = 'F'),
         count(*) filter (where public.pos_group(position) = 'D'),
         count(*) filter (where public.pos_group(position) = 'G')
    into f, d, g
    from public.roster_spots
   where season_id = p_season and team_id = p_team and status = 'active' and squad = 'pro'
     and not (coalesce(origin, '') = any(v_loans)) and not (profile_id = any(p_incoming));

  v_allow := coalesce(cardinality(p_vacated_active), 0) + greatest(0, cardinality(p_incoming) - coalesce(p_departing, 0));
  v_tokens := coalesce(p_vacated_active, '{}'::text[]);

  -- pass 1: an arrival of a departing active player's group takes that place; pass 2: the trade's order
  for v_pass in 1..2 loop
    foreach v_pid in array p_incoming loop
      continue when v_pid = any(v_active);
      select public.pos_group(position) into v_grp from public.roster_spots
       where season_id = p_season and team_id = p_team and profile_id = v_pid and status = 'active';
      continue when v_pass = 1 and not (v_grp = any(v_tokens));
      if v_allow > 0 and (f + d + g) < v_max
         and (case v_grp when 'F' then f < qf when 'D' then d < qd else g < qg end) then
        v_active := v_active || v_pid;
        v_allow := v_allow - 1;
        if v_grp = 'F' then f := f + 1; elsif v_grp = 'D' then d := d + 1; else g := g + 1; end if;
        if v_pass = 1 then
          v_idx := array_position(v_tokens, v_grp);
          v_tokens := v_tokens[1:v_idx - 1] || v_tokens[v_idx + 1:];
        end if;
      end if;
    end loop;
  end loop;

  select coalesce(array_agg(u.pid order by u.ord), '{}'::uuid[]) into v_tc
    from unnest(p_incoming) with ordinality as u(pid, ord) where not (u.pid = any(v_active));
  v_n := coalesce(cardinality(v_tc), 0);
  if v_n = 0 then return 0; end if;

  select count(*) into v_camp from public.roster_spots
   where season_id = p_season and team_id = p_team and status = 'active' and squad = 'tc';
  if v_camp + v_n > v_campmax then
    select name into v_club from public.teams where id = p_team;
    raise exception 'Rule 2.1: this trade would place % player% in the % training camp, which already holds % of its %. Nothing was traded: that club must make room in its camp first.',
      v_n, case when v_n = 1 then '' else 's' end, coalesce(v_club, 'receiving club''s'), v_camp, v_campmax
      using errcode = 'check_violation';
  end if;

  /* The league's own placement, not a club's send-down: it passes the weekly freeze and the suspension lock
     (trusted_writer), the management gate and the roster-immutability guard. The camp limit still applies. */
  v_role := coalesce(current_setting('app.role_grant', true), '');
  v_mgmt := coalesce(current_setting('app.mgmt_approved', true), '');
  v_sync := coalesce(current_setting('app.mgr_sync', true), '');
  perform set_config('app.role_grant', 'on', true);
  perform set_config('app.mgmt_approved', p_team::text, true);
  perform set_config('app.mgr_sync', '1', true);
  update public.roster_spots set squad = 'tc'
   where season_id = p_season and team_id = p_team and status = 'active' and squad = 'pro' and profile_id = any(v_tc);
  perform set_config('app.mgr_sync', v_sync, true);
  perform set_config('app.mgmt_approved', v_mgmt, true);
  perform set_config('app.role_grant', v_role, true);

  select array_agg(coalesce(nullif(p.gamertag, ''), 'A player') order by array_position(v_tc, p.id)) into v_names
    from public.profiles p where p.id = any(v_tc);
  perform public.club_notify(p_team, 'roster',
    'Traded into training camp: ' || array_to_string(v_names, ', '),
    array_to_string(v_names, ', ') || ' joined your training camp: a player acquired by trade takes the place of one you sent, '
      || 'an active place for an active place and a camp place for a camp place, and an extra player joins the active roster only '
      || 'where it and his position group have room (Rule 2.1). Call ' || case when v_n = 1 then 'him' else 'them' end
      || ' up from Team HQ when you have room, outside the weekly roster freeze (Wednesday 7:30 PM to Friday midnight ET).',
    null, 'manager', null);
  return v_n;
end $fn$;
revoke all on function public._place_trade_arrivals(uuid, uuid, uuid[], text[], int) from public, anon, authenticated;

/* ---- accept_trade: record the places the departing players hold, then place the arrivals --------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.accept_trade(uuid)'::regprocedure);
  d := replace(d0, '        v_moved int;
begin', '        v_moved int; v_from_act text[]; v_to_act text[];
begin');
  if d = d0 then raise exception 'accept_trade declare patch matched nothing'; end if;
  d0 := d;
  d := replace(d0,
'  foreach pid in array t.offered_profile_ids loop perform public.move_player(pid, t.season_id, t.to_team_id); end loop;
  foreach pid in array t.requested_profile_ids loop perform public.move_player(pid, t.season_id, t.from_team_id); end loop;
  /* v3.55: after EVERY move, so a like-for-like swap between full clubs overflows nobody */
  perform public._overflow_to_camp(t.season_id, t.to_team_id, t.offered_profile_ids);
  perform public._overflow_to_camp(t.season_id, t.from_team_id, t.requested_profile_ids);',
'  /* v3.72 (Rule 2.1): each arrival takes the place of a departing player, so record which departing
     players hold ACTIVE places, by position group, before anyone moves. */
  select coalesce(array_agg(public.pos_group(rs.position)), ''{}''::text[]) into v_from_act
    from public.roster_spots rs
   where rs.season_id = t.season_id and rs.team_id = t.from_team_id and rs.status = ''active'' and rs.squad = ''pro''
     and not (coalesce(rs.origin, '''') = any(array[''preseason_random'',''latecomer_random'']))
     and rs.profile_id = any(coalesce(t.offered_profile_ids, ''{}''::uuid[]));
  select coalesce(array_agg(public.pos_group(rs.position)), ''{}''::text[]) into v_to_act
    from public.roster_spots rs
   where rs.season_id = t.season_id and rs.team_id = t.to_team_id and rs.status = ''active'' and rs.squad = ''pro''
     and not (coalesce(rs.origin, '''') = any(array[''preseason_random'',''latecomer_random'']))
     and rs.profile_id = any(coalesce(t.requested_profile_ids, ''{}''::uuid[]));
  foreach pid in array t.offered_profile_ids loop perform public.move_player(pid, t.season_id, t.to_team_id); end loop;
  foreach pid in array t.requested_profile_ids loop perform public.move_player(pid, t.season_id, t.from_team_id); end loop;
  /* after EVERY move, so a like-for-like swap between full clubs sends nobody to camp */
  perform public._place_trade_arrivals(t.season_id, t.to_team_id, t.offered_profile_ids, v_to_act,
                                       coalesce(cardinality(t.requested_profile_ids), 0));
  perform public._place_trade_arrivals(t.season_id, t.from_team_id, t.requested_profile_ids, v_from_act,
                                       coalesce(cardinality(t.offered_profile_ids), 0));');
  if d = d0 then raise exception 'accept_trade placement patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- reverse_trade: the same rule, run backwards --------------------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.reverse_trade(uuid,text)'::regprocedure);
  d := replace(d0, '  v_from_gm uuid; v_to_gm uuid; v_who text;
begin', '  v_from_gm uuid; v_to_gm uuid; v_who text; v_from_act text[]; v_to_act text[];
begin');
  if d = d0 then raise exception 'reverse_trade declare patch matched nothing'; end if;
  d0 := d;
  d := replace(d0,
'  /* Players go back the way they came. move_player filters on profile only, so a player who has',
'  /* v3.72 (Rule 2.1): a reversal places its players by the trade rule, so record the ACTIVE places the
     players leaving each club hold, by position group, before anyone moves. */
  select coalesce(array_agg(public.pos_group(rs.position)), ''{}''::text[]) into v_from_act
    from public.roster_spots rs
   where rs.season_id = t.season_id and rs.team_id = t.from_team_id and rs.status = ''active'' and rs.squad = ''pro''
     and not (coalesce(rs.origin, '''') = any(array[''preseason_random'',''latecomer_random'']))
     and rs.profile_id = any(coalesce(t.requested_profile_ids, ''{}''::uuid[]));
  select coalesce(array_agg(public.pos_group(rs.position)), ''{}''::text[]) into v_to_act
    from public.roster_spots rs
   where rs.season_id = t.season_id and rs.team_id = t.to_team_id and rs.status = ''active'' and rs.squad = ''pro''
     and not (coalesce(rs.origin, '''') = any(array[''preseason_random'',''latecomer_random'']))
     and rs.profile_id = any(coalesce(t.offered_profile_ids, ''{}''::uuid[]));

  /* Players go back the way they came. move_player filters on profile only, so a player who has');
  if d = d0 then raise exception 'reverse_trade capture patch matched nothing'; end if;
  d0 := d;
  d := replace(d0,
'  /* v3.55: a player going back to a club that has since filled up joins its camp, as on a trade */
  perform public._overflow_to_camp(t.season_id, t.from_team_id, t.offered_profile_ids);
  perform public._overflow_to_camp(t.season_id, t.to_team_id, t.requested_profile_ids);',
'  /* v3.72: each player going back takes the place of one leaving, as on a trade (Rule 2.1) */
  perform public._place_trade_arrivals(t.season_id, t.from_team_id, t.offered_profile_ids, v_from_act,
                                       coalesce(cardinality(t.requested_profile_ids), 0));
  perform public._place_trade_arrivals(t.season_id, t.to_team_id, t.requested_profile_ids, v_to_act,
                                       coalesce(cardinality(t.offered_profile_ids), 0));');
  if d = d0 then raise exception 'reverse_trade placement patch matched nothing'; end if;
  execute d;
end $mig$;

-- _overflow_to_camp had exactly two callers, both replaced above.
do $mig$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc ilike '%_overflow_to_camp%') then
    raise exception '_overflow_to_camp still has a caller';
  end if;
end $mig$;
drop function if exists public._overflow_to_camp(uuid, uuid, uuid[]);

/* ---- check_roster_structure: judge the row as the transaction LEAVES it --------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.check_roster_structure()'::regprocedure);
  d := replace(d0,
'  if tg_op = ''DELETE'' then return null; end if;',
'  if tg_op = ''DELETE'' then return null; end if;
  /* v3.72: the check is deferred to commit, but the queued event carries the row as ONE statement left it.
     A player a trade moved onto the active roster and the same transaction then placed in camp was still
     judged as entering it. Judge an event only while its row is still in that state; a later change that
     leaves the row entering the roster queues an event of its own, which is judged instead. */
  if not exists (select 1 from public.roster_spots cur
                  where cur.id = NEW.id and cur.squad = NEW.squad and cur.status = NEW.status
                    and cur.team_id = NEW.team_id and cur.season_id = NEW.season_id
                    and cur.position is not distinct from NEW.position
                    and coalesce(cur.origin, '''') = coalesce(NEW.origin, '''')) then
    return null;
  end if;');
  if d = d0 then raise exception 'check_roster_structure patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- guard_squad_move: the camp count reads only players on the club -------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_squad_move()'::regprocedure);
  d := replace(d0,
'        and rs.squad = ''tc'' and rs.id <> NEW.id;',
'        and rs.squad = ''tc'' and rs.status = ''active'' and rs.id <> NEW.id;');
  if d = d0 then raise exception 'guard_squad_move camp-count patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- swap_roster_squad: call up first, so a full camp can still swap ----------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.swap_roster_squad(uuid,uuid)'::regprocedure);
  d := replace(d0,
'  update roster_spots set squad = ''tc''  where id = a.id;
  update roster_spots set squad = ''pro'' where id = b.id;',
'  /* v3.72: the camp player comes up FIRST. Sending the active player down first counted the camp player
     still in camp, so a club with a full camp (ten) could never swap. The roster shape is checked at
     commit, when both moves have been made. */
  update roster_spots set squad = ''pro'' where id = b.id;
  update roster_spots set squad = ''tc''  where id = a.id;');
  if d = d0 then raise exception 'swap_roster_squad patch matched nothing'; end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-09-29, one transaction on the live database, rolled back by a closing raise). Every accept
   ran as the receiving club's Owner (none is a commissioner), and each scenario forced the deferred shape check
   with SET CONSTRAINTS ALL IMMEDIATE before asserting, then rolled itself back:
   T1 07e7316d DET active F for UTA camp G: the F takes UTA's camp place; the G takes DET's active place.
   T2 eebe1091 NYI camp F for PIT camp F (PIT over forwards, camp 10/10): both land in camp. REFUSED before v3.72.
   T3 51b2ff1f stale offer: still refused as stale.
   T4 37d378f6 NYI active F for UTA active D: UTA's forwards are full, so the F goes to camp; the D is active at NYI.
   T5 bd92f88e NYI gets 5 for 1 active F: F takes the F place, the D is an extra with room, three F go to camp.
   T6 8cbad194 NYI gets 4 for 1: all four active (one place, three extras with room).
   S1 with roster_freeze_at stubbed TRUE: NYI camp F for VAN active D. The D takes NYI's CAMP place although NYI has
      defense room (no call-up by trade); the camp F takes VAN's active place; the club's own call-up is refused
      as frozen; the commissioner's reversal puts both back where they were.
   S2 two camp forwards into PIT's full camp for one: refused, "Nothing was traded".
   S3 PIT (camp 10/10) swaps an active D for a camp D: succeeds. REFUSED before v3.72.
   S4 _place_trade_arrivals is not executable by anon or authenticated.
   Result: REHEARSAL OK: T1 ok; T2 ok; T3 ok; T4 ok; T5 ok; T6 ok; S1 ok; S2 ok; S3 ok; S4 ok.
   Applied as migration v372_trade_placement; tools/sql/grant-audit.sql returned zero rows. */
