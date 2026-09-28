-- v3.55: training camp is capped at eight; a signing or a trade that does not fit the active roster lands in camp.
--
-- Commissioner, 2026-09-28:
--   Q1: "Waived players should be a free agent immediately instead of the claim period." (What the system
--       already does; the book's 2.5.4 still described a 24-hour claim window. Book only.)
--   Q2: "Allow a claimed player to be placed on the team's training camp if the team already has a full
--       roster. Cap the Training camps at 8 players each though."
--   Mid-build: "If the active rosters are full, they can go to the training camp and the team management
--       can bring them up to active roster if they choose." (trades)
-- Camp capacity was already wired through camp_max() (guard_squad_move, place_new_roster_spot,
-- _assign_reg_random); the basic format set it to 999. It becomes 8. A club already carrying more keeps
-- them (PIT carries 10 today) and adds nobody to camp until it is below the limit.

/* ---- 1. The basic format's camp limit ------------------------------------------------------------ */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.format_rules(text)'::regprocedure);
  d := replace(d0, '"camp_max":999', '"camp_max":8');
  if d = d0 then raise exception 'format_rules: basic camp_max 999 not found'; end if;
  if (length(d0) - length(replace(d0, '"camp_max":999', ''))) / length('"camp_max":999') <> 1 then raise exception 'format_rules: more than one camp_max 999'; end if;
  execute d;
end $mig$;

/* ---- 2. Every way into camp counts every camp player ------------------------------------------------
   place_new_roster_spot parked a player who did not fit the active roster in camp "while camp has room",
   but counted camp WITHOUT the league-office depth placements, which are camp players like any other. With
   a real limit that undercount would let a club past it. And when camp was full it silently left him on
   the active roster for check_roster_structure to refuse with advice ("send someone to training camp")
   that cannot be followed. Now: counted in full, and refused in words that say both are full. */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.place_new_roster_spot()'::regprocedure);
  d := replace(d0,
'      select count(*) into n_tc from roster_spots
        where season_id = NEW.season_id and team_id = NEW.team_id and status = ''active'' and squad = ''tc''
          and coalesce(origin,'''') not in (''preseason_random'',''latecomer_random'',''depth_random'');
      if n_tc < public.camp_max(NEW.season_id) then NEW.squad := ''tc''; end if;',
'      /* v3.55: every camp player counts, depth placements included (camp is camp), and a club with no
         room in either is told so in terms it can act on */
      select count(*) into n_tc from roster_spots
        where season_id = NEW.season_id and team_id = NEW.team_id and status = ''active'' and squad = ''tc'';
      if n_tc < public.camp_max(NEW.season_id) then NEW.squad := ''tc'';
      else
        raise exception ''Rule 2.1: this club''''s active roster has no room for him and its training camp is full (% players). Make room on one of them first.'', public.camp_max(NEW.season_id)
          using errcode = ''check_violation'';
      end if;');
  if d = d0 then raise exception 'place_new_roster_spot patch matched nothing'; end if;
  execute d;
end $mig$;

/* A league-office depth placement goes to a random club's camp; only a club whose camp has room is drawn. */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public._assign_reg_random(uuid,text,boolean,text)'::regprocedure);
  d := replace(d0,
'      if v_origin = ''depth_random'' then
        select t.id into v_team from public.teams t
          order by',
'      if v_origin = ''depth_random'' then
        select t.id into v_team from public.teams t
          /* v3.55: only a club whose training camp has room (Rule 2.1, camp limit) */
          where (select count(*) from public.roster_spots rs
                   where rs.season_id = v_reg.season_id and rs.team_id = t.id
                     and rs.status = ''active'' and rs.squad = ''tc'') < public.camp_max(v_reg.season_id)
          order by');
  if d = d0 then raise exception '_assign_reg_random patch matched nothing'; end if;
  execute d;
end $mig$;

/* The send-down refusal, in words (and without the dash). */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_squad_move()'::regprocedure);
  d := replace(d0,
'  -- Rule 2.1: a club carries at most three training-camp players
  if NEW.squad = ''tc'' then',
'  -- Rule 2.1: the camp limit (camp_max: 8 in the basic format since v3.55)
  if NEW.squad = ''tc'' then');
  d := replace(d,
'      raise exception ''Rule 2.1 — training camp is full: a club may carry at most % camp players.'', public.camp_max(NEW.season_id)',
'      raise exception ''Rule 2.1: training camp is full. A club carries at most % players in camp, so call someone up or waive a camp player first.'', public.camp_max(NEW.season_id)');
  if d = d0 then raise exception 'guard_squad_move patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- 3. Signing a waived player into camp when the active roster is full (Q2) --------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.sign_free_agent(uuid,bigint)'::regprocedure);
  d := replace(d0, '  v_prior bigint;', '  v_prior bigint; v_to_camp boolean := false; v_camp_n int;');
  d := replace(d,
'  if v_count >= v_max then
    raise exception ''Your active roster is full (% of % spots). Training-camp players do not use an active spot.'', v_count, v_max;
  end if;',
'  /* v3.55 (commissioner, 2026-09-28, Q2): "Allow a claimed player to be placed on the team''s training
     camp if the team already has a full roster. Cap the Training camps at 8 players each though."
     A full active roster sends him to camp; only a full camp as well refuses the signing. */
  if v_count >= v_max then
    select count(*) into v_camp_n from public.roster_spots
      where season_id = v_season.id and team_id = v_team.id and status = ''active'' and squad = ''tc'';
    if v_camp_n >= public.camp_max(v_season.id) then
      raise exception ''Your active roster is full (% of %) and so is your training camp (% players). Make room on one of them first (Rule 2.1).'', v_count, v_max, public.camp_max(v_season.id);
    end if;
    v_to_camp := true;
  end if;');
  d := replace(d,
'  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
    values (v_season.id, v_team.id, v_reg.profile_id, coalesce(v_jersey, 0), coalesce(v_reg.position, ''C''), v_salary, ''free_agency'');',
'  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin, squad)
    values (v_season.id, v_team.id, v_reg.profile_id, coalesce(v_jersey, 0), coalesce(v_reg.position, ''C''), v_salary, ''free_agency'',
            case when v_to_camp then ''tc'' end);');
  d := replace(d,
'      to_char(v_salary/1000000.0,''FM999990.00'') || ''M)'');
  return v_name || '' → '' || v_team.code;',
'      to_char(v_salary/1000000.0,''FM999990.00'') || ''M)'' || case when v_to_camp then '' into training camp, the active roster being full'' else '''' end);
  return v_name || '' → '' || v_team.code || case when v_to_camp then '' (training camp)'' else '''' end;');
  if position('v_to_camp := true' in d) = 0 or position('case when v_to_camp then ''tc'' end' in d) = 0
     or position('(training camp)' in d) = 0 or position('v_camp_n int' in d) = 0 then
    raise exception 'sign_free_agent: a patch matched nothing';
  end if;
  execute d;
end $mig$;

/* ---- 4. A traded player who does not fit goes to camp (mid-build ruling) ----------------------------
   A player acquired by trade joined his new club on the active roster, and when that roster was full the
   deferred shape check refused the WHOLE trade at commit ("send someone to training camp first"). Now,
   after every move of a trade, a club left over its composition sends the players it just received to
   camp, the over-full group first, and its front office is told it can call them up when it chooses.
   It runs after ALL the moves, so a one-for-one swap between two full clubs never overflows anyone. The
   squad change is the league's own (freeze and approval gates are not a club's move here); the camp
   limit still applies, and a full camp refuses the trade in words. */
create or replace function public._overflow_to_camp(p_season uuid, p_team uuid, p_incoming uuid[])
 returns int language plpgsql security definer set search_path to 'public' as $fn$
declare f int; d int; g int; qf int; qd int; qg int; v_max int; v_grp text; v_pid uuid; n int := 0;
        v_names text[] := '{}'; v_name text;
begin
  if p_team is null or coalesce(cardinality(p_incoming), 0) = 0 then return 0; end if;
  qf := public.group_cap_of('F', p_season); qd := public.group_cap_of('D', p_season); qg := public.group_cap_of('G', p_season);
  v_max := (public.season_rules(p_season)->>'roster_max')::int;
  loop
    select count(*) filter (where squad='pro' and public.pos_group(position)='F' and coalesce(origin,'') not in ('preseason_random','latecomer_random')),
           count(*) filter (where squad='pro' and public.pos_group(position)='D' and coalesce(origin,'') not in ('preseason_random','latecomer_random')),
           count(*) filter (where squad='pro' and public.pos_group(position)='G' and coalesce(origin,'') not in ('preseason_random','latecomer_random'))
      into f, d, g
      from public.roster_spots where season_id = p_season and team_id = p_team and status = 'active';
    exit when not (f > qf or d > qd or g > qg or (f + d + g) > v_max);
    v_grp := case when f > qf then 'F' when d > qd then 'D' when g > qg then 'G' end;
    select rs.profile_id into v_pid from public.roster_spots rs
     where rs.season_id = p_season and rs.team_id = p_team and rs.status = 'active' and rs.squad = 'pro'
       and rs.profile_id = any(p_incoming) and (v_grp is null or public.pos_group(rs.position) = v_grp)
     order by array_position(p_incoming, rs.profile_id) desc
     limit 1;
    exit when v_pid is null;   -- nothing this trade brought in can make room; the shape check says why
    perform set_config('app.role_grant', 'on', true);
    perform set_config('app.mgmt_approved', p_team::text, true);
    perform set_config('app.mgr_sync', '1', true);
    update public.roster_spots set squad = 'tc' where season_id = p_season and team_id = p_team and profile_id = v_pid;
    perform set_config('app.mgr_sync', '', true);
    perform set_config('app.mgmt_approved', '', true);
    perform set_config('app.role_grant', '', true);
    select coalesce(nullif(gamertag,''), 'A player') into v_name from public.profiles where id = v_pid;
    v_names := v_names || v_name; n := n + 1;
  end loop;
  if n > 0 then
    perform public.club_notify(p_team, 'roster',
      'Traded into training camp: ' || array_to_string(v_names, ', '),
      array_to_string(v_names, ', ') || case when n = 1 then ' joined' else ' joined' end ||
      ' your training camp because the active roster had no room for ' || case when n = 1 then 'him' else 'them' end ||
      '. Call ' || case when n = 1 then 'him' else 'them' end || ' up from Team HQ whenever you choose and have room (Rule 2.1).',
      null, 'manager', null);
  end if;
  return n;
end $fn$;
revoke all on function public._overflow_to_camp(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public._overflow_to_camp(uuid, uuid, uuid[]) to service_role;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.accept_trade(uuid)'::regprocedure);
  d := replace(d0,
'  foreach pid in array t.requested_profile_ids loop perform public.move_player(pid, t.season_id, t.from_team_id); end loop;',
'  foreach pid in array t.requested_profile_ids loop perform public.move_player(pid, t.season_id, t.from_team_id); end loop;
  /* v3.55: after EVERY move, so a like-for-like swap between full clubs overflows nobody */
  perform public._overflow_to_camp(t.season_id, t.to_team_id, t.offered_profile_ids);
  perform public._overflow_to_camp(t.season_id, t.from_team_id, t.requested_profile_ids);');
  if d = d0 then raise exception 'accept_trade patch matched nothing'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; i int; begin
  d0 := pg_get_functiondef('public.reverse_trade(uuid,text)'::regprocedure);
  i := position('  /* Picks go back too' in d0);
  if i = 0 then raise exception 'reverse_trade: anchor not found'; end if;
  d := substr(d0, 1, i - 1) ||
'  /* v3.55: a player going back to a club that has since filled up joins its camp, as on a trade */
  perform public._overflow_to_camp(t.season_id, t.from_team_id, t.offered_profile_ids);
  perform public._overflow_to_camp(t.season_id, t.to_team_id, t.requested_profile_ids);

' || substr(d0, i);
  execute d;
end $mig$;

/* REHEARSAL (2026-09-28, one transaction, rolled back): every check passed.
   T1  camp_max(Season 1) reads 8.
   T2  UTA (15 active, 6 in camp) signs a waived player as its Owner: he lands in camp ("B Bunny -> UTA
       (training camp)"), camp goes 6 -> 7, the active roster stays 15.
   T3  PIT (15 active, 10 in camp) is refused in words: "... and so is your training camp (8 players)".
   T4  DET sends two forwards to UTA for one: exactly one incoming forward is placed in UTA's camp, UTA
       ends at 15 active, the trade is accepted, UTA's room is told "Traded into training camp: ...", and
       the deferred shape check passes when forced.
   T5  SEA and UTA, both full, swap forward for forward: nobody goes to camp.
   T6  DET sends two forwards to PIT (camp 10) for one: the trade is refused, "training camp is full".
   Found by the battery: SET CONSTRAINTS ALL IMMEDIATE stays in force for the rest of the transaction,
   so a test that forces the shape check must set it back to DEFERRED before the next trade, or the
   check fires mid-trade, before the overflow step, and reads as a bug in the trade. */
-- The format table in force after v3.55 is recorded with every earlier version in
-- sql/2026-09-15-season-format.sql, whose LAST literal tools/season-format.test.cjs compares against
-- the client's CG.FORMAT_RULES.
