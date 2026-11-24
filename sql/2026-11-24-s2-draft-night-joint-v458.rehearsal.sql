-- JOINT REHEARSAL, Season 2 draft night (the main session runs it; it is never applied).
-- Run as ONE execute_sql query, so it is one transaction, with the texts in this order:
--   1. sql/2026-11-24-s2-draft-night-guards-v458.sql   (db-guards: market_on, roster_min_gap, _unused_pick_fills, the
--      Season 2 season_rules keys, the Season 2 row at $30M and ten rounds, no depth or latecomer placement, fa_open, the
--      fill after the draft and its notices)
--   2. sql/2026-11-24-s2-waive-hold-v458.sql            (db-waivers: the waive hold; reported PENDING below when absent)
--   3. sql/2026-11-24-s2-draft-front-office-v458.sql    (db-draft: draft_fits, the nominee test at filing and at the vote,
--      team_cap_committed, the draft room's messages)
--   4. this file
-- A record in steps 1 to 3 that is already applied is left out (db-guards' record creates market_on with a plain CREATE,
-- so sending it twice fails at step 1). Numbering: map each record's file name (<slug>-v4.58) to its number first, then
-- the bare v4.58 in each file; nothing below matches on a version placeholder, so this file needs only the file names in
-- this header renamed.
-- It ends in an uncaught raise, so everything rolls back: the three records, the season rollover modeled in S0, the
-- synthetic world, every notification and every Discord request queued by pg_net (transactional, so nothing is sent).
-- The world is built from the real eight clubs and real Season 2 sign-ups on an empty Season 2 (no seats, board or
-- rosters yet); the real-shape rehearsal after the Dec 5 decisions is a separate run. A scenario that must not leak into
-- later cases runs in an inner block that ends by raising JR_UNDO, which only that block catches; any other error is
-- re-raised, so an unexpected failure still aborts the whole rehearsal. Before the closing raise every deferred
-- constraint is run, so the roster shape check judges the world the rehearsal built. No outer handler, no dblink, no http.
--
-- Cases:
--   S0  the three records are in; the season rollover step (start_next_season, see S0) skips, since the commissioner ran
--       it on production on 2026-11-23; before any seat the draft cannot start, and the refusal asks for the Owner and
--       the GM in Season 2 words; the world: Owner and GM seated on every club from Season 2 sign-ups; with the seats
--       filled and no board the draft still cannot start, refused in Season 2 words with no dash; a ten-round board
--       (checked: a random snake, as the basic format and the rulebook have it), pick salaries $3.00M down to $0.75M.
--   T7  before the draft: an AGM nomination is refused, a GM from the sign-ups is still accepted, a Media-only staffer is
--       refused, and a Season 1 role-conflict exemption holder would be (none is on file since the rollover).
--   T1  draft_fits and the pick door: a club that still needs 2 D and 1 G with 2 roster spots cannot draft a forward, can
--       draft a defenseman (paid round one's $3.00M); a full roster is refused; a club with fewer picks left than spots is
--       held to its picks; with no undrafted defenseman left the club may pick a forward (D-SUPPLY), and the refusal
--       names only groups someone is left to fill ("no picks left"); a late sign-up is refused in Season 2 words (T1h).
--   T2  a timed-out pick is skipped, the draft concludes in Season 2 words, and after the draft the club's owed picks are
--       filled at random at $750K so that it meets 3/2/1; nobody else is placed (no depth placement). T2b: a fill that
--       later leaves the club still counts as made (_unused_pick_fills), so it is not a pick still to come.
--   T3  a half draft (40 picks) through the real door keeps every club able to reach 3/2/1 while players are left; an AGM
--       nomination during the draft is refused; right after the draft a GM from the pool is refused (T5b); after the
--       draft the 40 owed picks meet a pool of about 31: picks stay empty, nothing raises, no club is left short of a
--       group someone is left to fill, and the commissioners are told (D-FILL).
--   T4  no goalie left at the fill: the fill goes on in the other groups, and the clubs left short of a goaltender are
--       recorded (D-SUPPLY).
--   T5  after the draft: an AGM from another roster is refused; an AGM from the club's own roster is accepted.
--   T6b the vote cannot seat that AGM once they have left the club's roster: nothing moves, the seat is held up, and the
--       commissioners are told the right next step (deny it, or approve it again only if they return), with no dash.
--   T6  the AGM is seated: $2M replaces the drafted salary, the same contract becomes the management row, the payroll and
--       the committed payroll agree, and nothing is counted twice under the $30M cap.

create temp table _jr_log (n serial primary key, line text not null) on commit drop;
create temp table _jr (k text primary key, v text not null) on commit drop;

create function pg_temp.jr_as(p uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $f$;

create function pg_temp.jr_log(p text) returns void language plpgsql as $f$
begin
  insert into _jr_log (line) values (p);
end $f$;

/* a random undrafted Season 2 sign-up who could be drafted: of group p_grp when given, fitting p_team when given, and with
   no league office role when p_plain (a nominee draw: an office holder is refused for that reason before the case being
   tried, so office holders are only tried on purpose, in T7c and T7d) */
create function pg_temp.jr_fit(p_team uuid, p_grp text, p_plain boolean default false) returns uuid language sql as $f$
  select sr.profile_id from public.season_registrations sr
   where sr.season_id = (select id from public.seasons where number = 2) and sr.status <> 'declined'
     and not exists (select 1 from public.roster_spots rs where rs.season_id = sr.season_id and rs.profile_id = sr.profile_id)
     and public.is_draft_eligible(sr.profile_id, sr.season_id)
     and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id)
     and (p_grp is null or public.pos_group(coalesce(sr.position::text, 'C')::public.hockey_position) = p_grp)
     and (not p_plain or (select p.role::text from public.profiles p where p.id = sr.profile_id) not in ('staff', 'commissioner'))
     and (p_team is null or public.draft_fits(sr.season_id, p_team, sr.profile_id) is null)
   order by random() limit 1
$f$;

/* one line per club: F/D/G on the active roster, then roster_min_gap's short and open */
create function pg_temp.jr_clubs() returns text language sql as $f$
  select string_agg(t.code || ' ' || coalesce(x.f, 0) || '/' || coalesce(x.d, 0) || '/' || coalesce(x.g, 0) ||
                    ' short ' || (public.roster_min_gap(s.id, t.id)->>'short') || ' open ' || (public.roster_min_gap(s.id, t.id)->>'open'), '; ' order by t.code)
    from public.teams t cross join public.seasons s
    left join lateral (select count(*) filter (where public.pos_group(rs.position) = 'F') f,
                              count(*) filter (where public.pos_group(rs.position) = 'D') d,
                              count(*) filter (where public.pos_group(rs.position) = 'G') g
                         from public.roster_spots rs
                        where rs.season_id = s.id and rs.team_id = t.id and rs.status = 'active' and coalesce(rs.squad, 'pro') = 'pro') x on true
   where s.number = 2
$f$;

/* the club's shortfall in the groups an undrafted player is still left to fill (D-SUPPLY, through the record's own
   _undrafted_left): the shortfall the club can still be held to */
create function pg_temp.jr_short_live(p_team uuid) returns int language sql as $f$
  select coalesce(sum((g.j->>x.grp)::int) filter (where public._undrafted_left(g.sid, x.grp, null)), 0)::int
    from (select s.id as sid, public.roster_min_gap(s.id, p_team) as j from public.seasons s where s.number = 2) g
    cross join unnest(array['F', 'D', 'G']) x(grp)
$f$;

-- S0: the records, the rollover and the world
do $s0$
declare v_s2 public.seasons; v_comm uuid; v_f uuid[]; t record; i int := 0; v_n int; v_note text := ''; v_meta jsonb; v_roll text; v_gate text;
begin
  select * into v_s2 from public.seasons where number = 2;
  if to_regprocedure('public.roster_min_gap(uuid,uuid,text,uuid)') is null or to_regprocedure('public._unused_pick_fills(uuid,uuid)') is null
     or not public.market_on(v_s2.id) then
    raise exception 'JOINT FAILED S0: db-guards'' record is not in this transaction (market_on, roster_min_gap, _unused_pick_fills)';
  end if;
  if position('to reach the roster minimums' in pg_get_functiondef('public.draft_fits(uuid,uuid,uuid)'::regprocedure)) = 0
     or to_regprocedure('public._mgmt_nominee_seat_block(uuid,text,uuid)') is null then
    raise exception 'JOINT FAILED S0: the db-draft record is not in this transaction (draft_fits, _mgmt_nominee_seat_block)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'waive_player'
                    and position('Season 2 waivers open when the draft completes' in pg_get_functiondef(p.oid)) > 0) then
    v_note := ' PENDING db-waivers: the waive hold is not in this transaction.';
  end if;
  if v_s2.salary_cap is distinct from 30000000 or v_s2.draft_rounds is distinct from 10
     or public.season_rules(v_s2.id)->'quota_min' is distinct from '{"F": 3, "D": 2, "G": 1}'::jsonb
     or (public.season_rules(v_s2.id)->>'camp_max')::int is distinct from 0
     or (public.season_rules(v_s2.id)->>'roster_max')::int is distinct from 12 then
    raise exception 'JOINT FAILED S0: Season 2 is cap % rounds %, rules %', v_s2.salary_cap, v_s2.draft_rounds, public.season_rules(v_s2.id);
  end if;
  if exists (select 1 from public.roster_spots where season_id = v_s2.id) or exists (select 1 from public.draft_picks where season_number = 2)
     or exists (select 1 from public.draft_state where season_number = 2)
     or exists (select 1 from public.teams where owner_profile_id is not null or gm_profile_id is not null or agm_profile_id is not null) then
    raise exception 'JOINT FAILED S0: Season 2 is not empty (seats, board, draft state or rosters exist); this rehearsal builds its own world';
  end if;
  select id into v_comm from public.profiles where role::text = 'commissioner' order by id limit 1;
  if v_comm is null then raise exception 'JOINT FAILED S0: no commissioner profile to act as'; end if;
  insert into _jr (k, v) values ('s2', v_s2.id::text), ('comm', v_comm::text);
  -- T7d tries a Season 1 role-conflict exemption holder; the rollover below ends the exemptions, so note one first
  insert into _jr (k, v)
    select 'exempt', e.profile_id::text from public.role_conflict_exemptions e join public.profiles p on p.id = e.profile_id
     where p.role::text in ('staff', 'commissioner') order by e.profile_id limit 1;
  perform pg_temp.jr_as(v_comm);

  /* The season rollover (main session decision D-ROLLOVER, 2026-11-23). Season 1's player contracts stay 'active' until
     the commissioner runs public.start_next_season for Season 2, which happens before any Season 2 seat or apply. Until
     it runs, contracts_one_active refuses the Season 2 roster spot of every sign-up still holding one (60 of the 87 on
     2026-11-23), so the draft modeled here would fail on data, not on code. The rehearsal models the rollover the way
     production will have it, through the real function as a commissioner, and only while it is still owed, so the
     same file passes after the real rollover. Contracts are never expired by hand here. The commissioner's rollover RAN
     on production on 2026-11-23 at about 10:30 PM ET (no Season 1 player contract is open and the role-conflict
     exemptions are gone), so this step now skips; it stays so the file still models the order production followed, and
     nothing below relies on a Season 1 contract. */
  if exists (select 1 from public.contracts c where c.status in ('active', 'signed') and not coalesce(c.is_manager, false)
                and c.start_season < v_s2.number) then
    v_roll := 'S0 rollover modeled: start_next_season(Season 2) ' || public.start_next_season(v_s2.id)::text || '.';
  else
    v_roll := 'S0 rollover already done in production: no Season 1 player contract is still open.';
  end if;
  perform pg_temp.jr_log(v_roll);
  select count(*) into v_n from public.teams;

  -- before any seat is filled the draft cannot start, and the refusal asks for the Owner and the GM only (no AGM)
  begin
    perform public.start_draft(2, 120);
    raise exception 'JOINT FAILED S0: the draft started with no seats filled';
  exception when others then
    if sqlerrm not like 'Every club needs its Owner and an approved General Manager seated before the draft can start. Still open: %(Owner, GM)%' then raise; end if;
    v_gate := sqlerrm;
  end;

  -- Owner and GM on every club: the earliest plain forward sign-ups (no office role, no suspension or ban)
  select array_agg(x.profile_id order by x.created_at, x.profile_id) into v_f from (
    select sr.profile_id, sr.created_at from public.season_registrations sr join public.profiles p on p.id = sr.profile_id
     where sr.season_id = v_s2.id and sr.status <> 'declined'
       and public.pos_group(coalesce(sr.position::text, 'C')::public.hockey_position) = 'F'
       and p.role::text not in ('staff', 'commissioner')
       and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id)
     order by sr.created_at, sr.profile_id limit 2 * v_n) x;
  if coalesce(array_length(v_f, 1), 0) < 2 * v_n then raise exception 'JOINT FAILED S0: only % plain forwards to seat % clubs', coalesce(array_length(v_f, 1), 0), v_n; end if;
  for t in select id from public.teams order by code loop
    i := i + 1;
    perform public._set_team_seat(t.id, 'owner', v_f[2 * i - 1], 'office');
    perform public._set_team_seat(t.id, 'gm', v_f[2 * i], 'office');
  end loop;
  if jsonb_array_length(public.draft_management_gaps()) <> 0 then raise exception 'JOINT FAILED S0: seats still open: %', public.draft_management_gaps(); end if;
  if exists (select 1 from public.roster_spots where season_id = v_s2.id and salary <> 0) or (select count(*) from public.roster_spots where season_id = v_s2.id) <> 2 * v_n then
    raise exception 'JOINT FAILED S0: the seats did not take $0 roster spots';
  end if;

  -- every seat filled but no board yet: the draft still cannot start, and the refusal is Season 2's, with no dash
  begin
    perform public.start_draft(2, 120);
    raise exception 'JOINT FAILED S0: the draft started with no board';
  exception when others then
    if sqlerrm <> 'Season 2 has no draft order yet. Build the board first: open the Draft manager and choose Build the board.' then raise; end if;
  end;

  -- the board: ten rounds, the basic format's random snake
  v_meta := public.generate_draft_board(2, 10, 'random');
  if (select count(*) from public.draft_picks where season_number = 2) <> 10 * v_n
     or (v_meta->>'snake')::boolean is not true
     or (select original_team_id from public.draft_picks where season_number = 2 and overall_pick = v_n + 1)
        is distinct from (select original_team_id from public.draft_picks where season_number = 2 and overall_pick = v_n) then
    raise exception 'JOINT FAILED S0: the board is not % picks in a snake: %', 10 * v_n, v_meta;
  end if;
  if public.draft_pick_salary(2, 1) <> 3000000 or public.draft_pick_salary(2, 10) <> 750000
     or (select sum(public.draft_pick_salary(2, r)) from generate_series(1, 10) r) <> 18750000 then
    raise exception 'JOINT FAILED S0: pick salaries are not sized for ten rounds';
  end if;
  perform pg_temp.jr_log('S0 world: ' || v_n || ' clubs, Owner and GM seated from Season 2 sign-ups at $0, cap $30M; board of ' || (10 * v_n) ||
    ' picks, a random snake (style ' || (v_meta->>'style') || ', round 2 reversed), pay $3.00M down to $0.75M, $18.75M a club. ' ||
    'Before the seats, the draft gate: "' || left(v_gate, 160) || '..."; with the seats and no board: "Season 2 has no draft order yet. Build the board first: ...".' || v_note);
end $s0$;

-- T7: before the draft
do $t7$
declare a record; v_x uuid; v_media uuid; v_exempt uuid := (select v::uuid from _jr where k = 'exempt'); v_msg text := ''; v_m text;
begin
  select t.id, t.code, t.owner_profile_id as o into a from public.teams t order by t.code limit 1;
  v_x := pg_temp.jr_fit(null, null, true);
  if v_x is null then raise exception 'JOINT FAILED T7: no plain sign-up to nominate'; end if;
  perform pg_temp.jr_as(a.o);
  begin
    insert into public.management_applications (team_id, role, submitted_by, nominee_id) values (a.id, 'agm', a.o, v_x);
    raise exception 'JOINT FAILED T7a: an AGM nomination before the draft was accepted';
  exception when others then
    if sqlerrm not like 'An Assistant GM is named only after the draft is complete, and only from the club''s own roster.%' then raise; end if;
    v_m := sqlerrm;
  end;
  v_msg := 'T7a AGM before the draft refused: "' || v_m || '".';
  begin
    insert into public.management_applications (team_id, role, submitted_by, nominee_id) values (a.id, 'gm', a.o, v_x);
    raise exception 'JR_UNDO';
  exception when others then
    if sqlerrm <> 'JR_UNDO' then raise; end if;
  end;
  v_msg := v_msg || ' T7b a GM from the sign-ups before the draft is still accepted (undone).';
  select p.id into v_media from public.profiles p where public.is_media_only_staff(p.id) order by p.id limit 1;
  if v_media is null then
    v_msg := v_msg || ' T7c PENDING: no Media-only staffer exists to try.';
  else
    begin
      insert into public.management_applications (team_id, role, submitted_by, nominee_id) values (a.id, 'gm', a.o, v_media);
      raise exception 'JOINT FAILED T7c: a Media-only staffer was accepted as a nominee';
    exception when others then
      if sqlerrm not like '%cannot hold a club management role. No league office seat, in any department, may be held together with a club seat.' then raise; end if;
    end;
    v_msg := v_msg || ' T7c a Media-only staffer refused.';
  end if;
  if v_exempt is null then
    v_msg := v_msg || ' T7d not tried: no role-conflict exemption is on file (the Season 2 rollover cleared them on 2026-11-23), and the nominee test reads none.';
  else
    begin
      insert into public.management_applications (team_id, role, submitted_by, nominee_id) values (a.id, 'gm', a.o, v_exempt);
      raise exception 'JOINT FAILED T7d: a Season 1 exemption holder was accepted as a nominee';
    exception when others then
      if sqlerrm not like '%cannot hold a club management role. No league office seat, in any department, may be held together with a club seat.' then raise; end if;
    end;
    v_msg := v_msg || ' T7d a Season 1 role-conflict exemption holder refused (' ||
             case when exists (select 1 from public.role_conflict_exemptions where profile_id = v_exempt) then 'exemption still on file'
                  else 'the rollover ended the exemptions' end || ').';
  end if;
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  perform pg_temp.jr_log(v_msg);
end $t7$;

-- T1: draft_fits and the pick door (undone)
do $t1$
declare v_s2 uuid := (select v::uuid from _jr where k = 's2'); a record; b record; c uuid; v_f uuid; v_d uuid; v_g uuid; v_p uuid;
        v_m1 text; v_m2 text; v_m3 text; v_m4 text; v_m5 text; v_m6 text; v_res text; i int; n_d int;
begin
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  begin
    perform public.start_draft(2, 120);
    select t.id, t.code into a from public.teams t join public.draft_picks dp on dp.current_team_id = t.id where dp.season_number = 2 and dp.overall_pick = 1;
    select t.id, t.code into b from public.teams t join public.draft_picks dp on dp.current_team_id = t.id where dp.season_number = 2 and dp.overall_pick = 2;
    select dp.current_team_id into c from public.draft_picks dp where dp.season_number = 2 and dp.overall_pick = 3;
    -- club A: seven forwards straight onto the roster, so with the Owner and GM it has 9 F and needs 2 D and 1 G with 3 spots
    for i in 1..7 loop
      v_p := pg_temp.jr_fit(null, 'F');
      insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary)
        select v_s2, a.id, v_p, (select min(n) from generate_series(1, 99) n where n not in (select jersey_number from public.roster_spots where season_id = v_s2 and team_id = a.id)),
               sr.position, 750000
          from public.season_registrations sr where sr.season_id = v_s2 and sr.profile_id = v_p;
    end loop;
    v_f := pg_temp.jr_fit(null, 'F'); v_d := pg_temp.jr_fit(null, 'D'); v_g := pg_temp.jr_fit(null, 'G');
    v_m1 := public.draft_fits(v_s2, a.id, v_f);
    if v_m1 is distinct from 'after this pick the club would still need 2 defensemen and 1 goaltender to reach the roster minimums, with only 2 roster spots left' then
      raise exception 'JOINT FAILED T1a: a tenth forward: %', coalesce(v_m1, 'fits');
    end if;
    if public.draft_fits(v_s2, a.id, v_d) is not null or public.draft_fits(v_s2, a.id, v_g) is not null then
      raise exception 'JOINT FAILED T1a: a defenseman or a goaltender was refused';
    end if;
    begin
      perform public.draft_make_pick((select id from public.draft_picks where season_number = 2 and overall_pick = 1), v_f);
      raise exception 'JOINT FAILED T1b: the pick door drafted the tenth forward';
    exception when others then
      if sqlerrm not like 'That pick does not fit: after this pick the club would still need 2 defensemen and 1 goaltender%' then raise; end if;
      v_m2 := sqlerrm;
    end;
    perform public.draft_make_pick((select id from public.draft_picks where season_number = 2 and overall_pick = 1), v_d);
    if (select salary from public.roster_spots where season_id = v_s2 and profile_id = v_d and team_id = a.id) is distinct from 3000000 then
      raise exception 'JOINT FAILED T1b: the round-one pick is not paid $3.00M';
    end if;
    -- A now has 9 F and 1 D with 2 spots: another forward is refused, a goaltender fits; then A is filled to 12
    if public.draft_fits(v_s2, a.id, pg_temp.jr_fit(null, 'F')) is null or public.draft_fits(v_s2, a.id, v_g) is not null then
      raise exception 'JOINT FAILED T1c: with 2 spots for 1 D and 1 G, the answers were wrong';
    end if;
    foreach v_p in array array[pg_temp.jr_fit(null, 'D'), v_g] loop
      insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary)
        select v_s2, a.id, v_p, (select min(n) from generate_series(1, 99) n where n not in (select jersey_number from public.roster_spots where season_id = v_s2 and team_id = a.id)),
               sr.position, 750000
          from public.season_registrations sr where sr.season_id = v_s2 and sr.profile_id = v_p;
    end loop;
    v_m3 := public.draft_fits(v_s2, a.id, pg_temp.jr_fit(null, 'G'));
    if v_m3 is distinct from 'the active roster is full (12 players, management included)' then raise exception 'JOINT FAILED T1c: a full roster: %', coalesce(v_m3, 'fits'); end if;
    -- club B: eight of its picks move to club C, and one forward joins it (3 F): it needs 2 D and 1 G with 2 picks left
    update public.draft_picks set current_team_id = c
     where id in (select id from public.draft_picks where season_number = 2 and current_team_id = b.id order by round desc limit 8);
    v_p := pg_temp.jr_fit(null, 'F');
    insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary)
      select v_s2, b.id, v_p, (select min(n) from generate_series(1, 99) n where n not in (select jersey_number from public.roster_spots where season_id = v_s2 and team_id = b.id)),
             sr.position, 750000
        from public.season_registrations sr where sr.season_id = v_s2 and sr.profile_id = v_p;
    v_m4 := public.draft_fits(v_s2, b.id, pg_temp.jr_fit(null, 'F'));
    if v_m4 is distinct from 'after this pick the club would still need 2 defensemen and 1 goaltender to reach the roster minimums, with 1 pick left'
       or public.draft_fits(v_s2, b.id, pg_temp.jr_fit(null, 'D')) is not null then
      raise exception 'JOINT FAILED T1d: picks left: %', coalesce(v_m4, 'fits');
    end if;
    -- D-SUPPLY: every undrafted defenseman leaves the pool, so B's defense shortfall no longer holds its picks: with 1 pick
    -- left for 1 G, a forward fits; with one more pick gone, the refusal names only the goaltender
    v_f := pg_temp.jr_fit(null, 'F');
    update public.season_registrations sr set status = 'declined'
     where sr.season_id = v_s2 and sr.status <> 'declined'
       and public.pos_group(coalesce(sr.position::text, 'C')::public.hockey_position) = 'D'
       and not exists (select 1 from public.roster_tenures rt where rt.season_id = v_s2 and rt.profile_id = sr.profile_id);
    get diagnostics n_d = row_count;
    if public._undrafted_left(v_s2, 'D', null) or not public._undrafted_left(v_s2, 'G', null) then
      raise exception 'JOINT FAILED T1e: _undrafted_left does not see the empty defense pool';
    end if;
    v_m5 := public.draft_fits(v_s2, b.id, v_f);
    if v_m5 is not null then raise exception 'JOINT FAILED T1e: with no defenseman left, a forward was refused: %', v_m5; end if;
    update public.draft_picks set current_team_id = c
     where id = (select id from public.draft_picks where season_number = 2 and current_team_id = b.id and not used order by round desc limit 1);
    v_m6 := public.draft_fits(v_s2, b.id, v_f);
    if v_m6 is distinct from 'after this pick the club would still need 1 goaltender to reach the roster minimums, with no picks left'
       or public.draft_fits(v_s2, b.id, pg_temp.jr_fit(null, 'G')) is not null then
      raise exception 'JOINT FAILED T1f: no picks left: %', coalesce(v_m6, 'fits');
    end if;
    v_res := 'T1 ' || a.code || ' at 9 F with 3 spots: a forward refused ("' || v_m2 || '"), a defenseman drafted at $3.00M; at 12: "' || v_m3 ||
             '"; ' || b.code || ' with 2 picks for 3 needs: "' || v_m4 || '"; with the ' || n_d || ' undrafted defensemen gone a forward fits, and with ' ||
             'no pick to spare: "' || v_m6 || '" (undone).';
    raise exception 'JR_UNDO';
  exception when others then
    if sqlerrm <> 'JR_UNDO' then raise; end if;
  end;
  perform pg_temp.jr_log(v_res);
end $t1$;

-- T1h: a late sign-up at the pick door (undone)
do $t1h$
declare v_s2 uuid := (select v::uuid from _jr where k = 's2'); v_p uuid; v_m text; v_res text;
begin
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  begin
    perform public.start_draft(2, 120);
    v_p := pg_temp.jr_fit(null, null);
    -- the sign-up cutoff moves before this player's sign-up, so they signed up late
    update public.seasons set signup_deadline_at = (select sr.created_at from public.season_registrations sr where sr.season_id = v_s2 and sr.profile_id = v_p) - interval '1 minute'
     where id = v_s2;
    if public.is_draft_eligible(v_p, v_s2) then raise exception 'JOINT FAILED T1h: the late sign-up still reads as draft-eligible'; end if;
    begin
      perform public.draft_make_pick((select id from public.draft_picks where season_number = 2 and overall_pick = 1), v_p);
      raise exception 'JOINT FAILED T1h: a late sign-up was drafted';
    exception when others then
      if sqlerrm <> 'That player isn''t draft-eligible: they signed up after the sign-up cutoff. They join the training camp pool after the draft.' then raise; end if;
      v_m := sqlerrm;
    end;
    v_res := 'T1h a late sign-up at the pick door: "' || v_m || '" (undone).';
    raise exception 'JR_UNDO';
  exception when others then
    if sqlerrm <> 'JR_UNDO' then raise; end if;
  end;
  perform pg_temp.jr_log(v_res);
end $t1h$;

-- T2: a timed-out pick, then the fill after the draft (undone)
do $t2$
declare v_s2 uuid := (select v::uuid from _jr where k = 's2'); a record; v_pick public.draft_picks; v_txt text; v_gap jsonb;
        n_fill int; n_depth int; n_left int; v_res text; v_p uuid; v_m text; n_g int := 0;
begin
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  begin
    perform public.start_draft(2, 120);
    select * into v_pick from public.draft_picks where season_number = 2 and overall_pick = 1;
    select id, code into a from public.teams where id = v_pick.current_team_id;
    update public.draft_state set clock_ends_at = now() - interval '1 second' where season_number = 2;
    perform public._draft_auto_advance(2);
    select description into v_txt from public.transactions
     where season_id = v_s2 and type = 'draft' and description like '%let the clock run out on pick 1 (R1)%' limit 1;
    if not (select skipped from public.draft_picks where id = v_pick.id) or v_txt is null
       or (select current_overall from public.draft_state where season_number = 2) <> 2 then
      raise exception 'JOINT FAILED T2: the timed-out pick was not skipped, recorded and passed';
    end if;
    -- only this club is owed players: the other clubs' picks leave the board for this scenario
    delete from public.draft_picks where season_number = 2 and current_team_id <> a.id;
    perform public.draft_conclude(2);
    if not exists (select 1 from public.transactions where season_id = v_s2 and type = 'draft'
                    and description = 'The commissioner concluded the draft with 9 picks unused.') then
      raise exception 'JOINT FAILED T2: the conclusion line is not the Season 2 one: %',
        (select string_agg(description, ' | ') from public.transactions where season_id = v_s2 and type = 'draft' and description like 'The commissioner concluded%');
    end if;
    perform public.distribute_unproven_rookies(true);
    select count(*) into n_fill from public.roster_spots where season_id = v_s2 and team_id = a.id and origin = 'postdraft_random';
    select count(*) into n_depth from public.roster_spots where season_id = v_s2 and origin = 'depth_random';
    select count(*) into n_left from public.season_registrations sr where sr.season_id = v_s2 and sr.status <> 'declined'
       and not exists (select 1 from public.roster_spots rs where rs.season_id = v_s2 and rs.profile_id = sr.profile_id);
    v_gap := public.roster_min_gap(v_s2, a.id);
    if n_fill <> 10 or public._unused_pick_fills(v_s2, a.id) <> 10 or (v_gap->>'short')::int <> 0 or (v_gap->>'open')::int <> 0 then
      raise exception 'JOINT FAILED T2: % received % of 10 owed players (% counted as fills) and ends at %', a.code, n_fill, public._unused_pick_fills(v_s2, a.id), v_gap;
    end if;
    if exists (select 1 from public.roster_spots where season_id = v_s2 and origin = 'postdraft_random' and salary <> 750000) then
      raise exception 'JOINT FAILED T2: a placed player is not paid $750K';
    end if;
    if n_depth <> 0 or exists (select 1 from public.roster_spots where season_id = v_s2 and team_id <> a.id
                                 and origin in ('postdraft_random', 'depth_random', 'latecomer_random', 'rookie_random')) then
      raise exception 'JOINT FAILED T2: other clubs received players (% by depth placement)', n_depth;
    end if;
    /* T2b: a fill that leaves the club still counts as made (_unused_pick_fills reads roster history). Every goaltender
       the fill gave the club is removed: it is short one goaltender with every owed pick already filled, so a forward
       must not fit as if a pick were still to come, and a goaltender still does. Counting the current roster instead
       would let the forward in whenever the fill had given it two or more goaltenders. */
    for v_p in select rs.profile_id from public.roster_spots rs
                where rs.season_id = v_s2 and rs.team_id = a.id and rs.origin = 'postdraft_random' and public.pos_group(rs.position) = 'G' loop
      perform public.admin_remove_from_roster(v_p, v_s2);
      n_g := n_g + 1;
    end loop;
    v_m := public.draft_fits(v_s2, a.id, pg_temp.jr_fit(null, 'F'));
    if n_g = 0 or public._unused_pick_fills(v_s2, a.id) <> 10
       or v_m is distinct from 'after this pick the club would still need 1 goaltender to reach the roster minimums, with no picks left'
       or public.draft_fits(v_s2, a.id, pg_temp.jr_fit(null, 'G')) is not null then
      raise exception 'JOINT FAILED T2b: with % filled goaltenders removed, fills counted %, a forward: %', n_g, public._unused_pick_fills(v_s2, a.id), coalesce(v_m, 'fits');
    end if;
    v_res := 'T2 ' || a.code || '''s pick 1 timed out: "' || v_txt || '"; the draft concluded in Season 2 words; its ten owed picks were filled at random at $750K and it meets 3/2/1 (' ||
             pg_temp.jr_clubs() || '); ' || n_left || ' sign-ups stayed unplaced, no depth placement. T2b with its ' || n_g ||
             ' filled goaltender(s) removed, the fills still count 10 and a forward is refused: "' || v_m || '" (undone).';
    raise exception 'JR_UNDO';
  exception when others then
    if sqlerrm <> 'JR_UNDO' then raise; end if;
  end;
  perform pg_temp.jr_log(v_res);
end $t2$;

-- T3a: half a draft through the real door, an AGM refused mid-draft, the draft concluded, a GM from the pool refused (kept)
do $t3a$
declare v_s2 uuid := (select v::uuid from _jr where k = 's2'); v_pick public.draft_picks; v_p uuid; i int; a record; v_m text; v_m5b text; t record;
begin
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  perform public.start_draft(2, 120);
  for i in 1..40 loop
    select dp.* into v_pick from public.draft_picks dp join public.draft_state ds on ds.season_number = dp.season_number and ds.current_overall = dp.overall_pick
     where dp.season_number = 2;
    v_p := pg_temp.jr_fit(v_pick.current_team_id, null);
    if v_p is null then raise exception 'JOINT FAILED T3: nobody fits pick %', v_pick.overall_pick; end if;
    perform public.draft_make_pick(v_pick.id, v_p);
  end loop;
  -- every club can still reach its minimums in every group someone is left to fill (D-SUPPLY)
  for t in select id, code from public.teams loop
    if pg_temp.jr_short_live(t.id) > least((public.roster_min_gap(v_s2, t.id)->>'open')::int,
         (select count(*) from public.draft_picks where season_number = 2 and current_team_id = t.id and not used)) then
      raise exception 'JOINT FAILED T3: % can no longer reach its minimums mid-draft: %', t.code, public.roster_min_gap(v_s2, t.id);
    end if;
  end loop;
  -- an AGM nomination while the draft runs is refused, even from the club's own drafted players
  select tm.id, tm.code, tm.owner_profile_id as o, tm.gm_profile_id as g into a from public.teams tm order by tm.code limit 1;
  select rs.profile_id into v_p from public.roster_spots rs join public.profiles p on p.id = rs.profile_id
   where rs.season_id = v_s2 and rs.team_id = a.id and rs.profile_id not in (a.o, a.g) and p.role::text not in ('staff', 'commissioner')
   order by rs.created_at, rs.profile_id limit 1;
  if v_p is null then raise exception 'JOINT FAILED T3: % drafted no plain player to nominate', a.code; end if;
  perform pg_temp.jr_as(a.o);
  begin
    insert into public.management_applications (team_id, role, submitted_by, nominee_id) values (a.id, 'agm', a.o, v_p);
    raise exception 'JOINT FAILED T3: an AGM nomination during the draft was accepted';
  exception when others then
    if sqlerrm not like 'An Assistant GM is named only after the draft is complete%' then raise; end if;
    v_m := sqlerrm;
  end;
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  perform public.draft_conclude(2);
  if (select status from public.draft_state where season_number = 2) <> 'complete' then raise exception 'JOINT FAILED T3: the draft did not conclude'; end if;
  insert into _jr (k, v) values ('owed', (select count(*) from public.draft_picks where season_number = 2 and not used)::text);
  -- T5b: right after the draft, while the pool is still full, a GM from the pool is refused
  v_p := pg_temp.jr_fit(null, null, true);
  if v_p is null then raise exception 'JOINT FAILED T5b: the pool was empty right after the draft'; end if;
  perform pg_temp.jr_as(a.o);
  begin
    insert into public.management_applications (team_id, role, submitted_by, nominee_id) values (a.id, 'gm', a.o, v_p);
    raise exception 'JOINT FAILED T5b: a GM from the pool was accepted after the draft';
  exception when others then
    if sqlerrm not like 'Once the draft starts, a General Manager or Assistant GM is named only from the club''s own active roster%' then raise; end if;
    v_m5b := sqlerrm;
  end;
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  perform pg_temp.jr_log('T3a 40 picks through draft_make_pick, every club still able to reach 3/2/1 (' || pg_temp.jr_clubs() ||
    '); an AGM mid-draft refused ("' || v_m || '"); the draft concluded with ' || (select v from _jr where k = 'owed') || ' picks owed. ' ||
    'T5b a GM from the pool right after the draft refused ("' || v_m5b || '").');
end $t3a$;

-- T4: no goalie left at the fill (undone)
do $t4$
declare v_s2 uuid := (select v::uuid from _jr where k = 's2'); n_g int; v_res text; t record; v_nog text := '';
begin
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  begin
    update public.season_registrations sr set status = 'declined'
     where sr.season_id = v_s2 and sr.status <> 'declined'
       and public.pos_group(coalesce(sr.position::text, 'C')::public.hockey_position) = 'G'
       and not exists (select 1 from public.roster_spots rs where rs.season_id = v_s2 and rs.profile_id = sr.profile_id);
    get diagnostics n_g = row_count;
    perform public.distribute_unproven_rookies(true);
    for t in select id, code from public.teams order by code loop
      if (public.roster_min_gap(v_s2, t.id)->>'open')::int < 0
         or pg_temp.jr_short_live(t.id) > (public.roster_min_gap(v_s2, t.id)->>'open')::int then
        raise exception 'JOINT FAILED T4: % was filled past the point of reaching its minimums in a group someone is left to fill: %', t.code, public.roster_min_gap(v_s2, t.id);
      end if;
      if (public.roster_min_gap(v_s2, t.id)->>'G')::int > 0 then v_nog := v_nog || t.code || ' '; end if;
    end loop;
    v_res := 'T4 with the ' || n_g || ' undrafted goaltenders gone, the fill raised nothing and went on in the other groups (D-SUPPLY); clubs left short of a goaltender, for the market to cover: ' ||
             coalesce(nullif(v_nog, ''), 'none') || '(' || pg_temp.jr_clubs() || '; ' ||
             (select count(*) from public.roster_spots where season_id = v_s2 and origin = 'postdraft_random') || ' placed) (undone).';
    raise exception 'JR_UNDO';
  exception when others then
    if sqlerrm <> 'JR_UNDO' then raise; end if;
  end;
  perform pg_temp.jr_log(v_res);
end $t4$;

-- T3b: the fill after the draft, with the pool too small for the picks owed (kept)
do $t3b$
declare v_s2 uuid := (select v::uuid from _jr where k = 's2'); v_owed int := (select v::int from _jr where k = 'owed'); n_pool int; n_fill int;
        n_depth int; t record; v_unfit text := ''; v_note0 uuid[]; v_titles text; n_note int;
begin
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  select count(*) into n_pool from public.season_registrations sr where sr.season_id = v_s2 and sr.status <> 'declined'
     and not exists (select 1 from public.roster_spots rs where rs.season_id = v_s2 and rs.profile_id = sr.profile_id)
     and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id);
  select coalesce(array_agg(id), '{}') into v_note0 from public.notifications where created_at >= now();
  perform public.distribute_unproven_rookies(true);
  select count(*) into n_fill from public.roster_spots where season_id = v_s2 and origin = 'postdraft_random';
  select count(*) into n_depth from public.roster_spots where season_id = v_s2 and origin = 'depth_random';
  if exists (select 1 from public.roster_spots where season_id = v_s2 and origin = 'postdraft_random' and salary <> 750000) then
    raise exception 'JOINT FAILED T3b: a placed player is not paid $750K';
  end if;
  if n_depth <> 0 then raise exception 'JOINT FAILED T3b: % players were placed as depth', n_depth; end if;
  for t in select id, code from public.teams order by code loop
    if (public.roster_min_gap(v_s2, t.id)->>'open')::int < 0
       or pg_temp.jr_short_live(t.id) > (public.roster_min_gap(v_s2, t.id)->>'open')::int then
      raise exception 'JOINT FAILED T3b: % ends over the roster or past reaching its minimums: %', t.code, public.roster_min_gap(v_s2, t.id);
    end if;
    -- a club still owed a pick got nobody only because nobody left fits it
    if (select count(*) from public.draft_picks where season_number = 2 and current_team_id = t.id and not used)
       > public._unused_pick_fills(v_s2, t.id)
       and pg_temp.jr_fit(t.id, null) is not null then
      v_unfit := v_unfit || t.code || ' ';
    end if;
  end loop;
  if v_unfit <> '' then raise exception 'JOINT FAILED T3b: % still owed and a fitting player was left in the pool', v_unfit; end if;
  /* D-FILL: an owed pick the first run cannot fill is told to the commissioners, never left silent. Read by recipient and
     kind (an office bell, notify_commissioners' 'flag'), not by title, so the guards record's wording can change; a
     commissioner who is also a placed player gets a roster notice of another kind, which does not count. The titles are
     logged for the main session to read. */
  select count(*), string_agg(distinct n.title, ' | ') into n_note, v_titles from public.notifications n
   where n.created_at >= now() and not (n.id = any(v_note0)) and n.title <> 'Unused draft picks filled' and n.type = 'flag'
     and n.profile_id in (select p.id from public.profiles p where p.role::text = 'commissioner');
  if v_owed > n_fill and n_note = 0 then
    raise exception 'JOINT FAILED T3b: % owed picks stayed empty and no commissioner was told', v_owed - n_fill;
  end if;
  perform pg_temp.jr_log('T3b after the draft: ' || v_owed || ' picks owed, ' || n_pool || ' in the pool, ' || n_fill || ' placed at $750K, ' ||
    (v_owed - n_fill) || ' picks left empty, nothing raised, no depth placement, no club short of a group someone is left to fill (' || pg_temp.jr_clubs() || '). ' ||
    'Commissioner notices: ' || n_note || ' (' || coalesce(v_titles, 'none') || '). Placement text: "' ||
    coalesce((select description from public.transactions where season_id = v_s2 and type = 'sign'
               and description like '%random placement for a draft pick%' limit 1), 'none') || '"');
end $t3b$;

-- T5, T6b and T6: after the draft, the AGM (kept until the closing raise, except T6b)
do $t56$
declare v_s2 uuid := (select v::uuid from _jr where k = 's2'); a record; v_other uuid; v_agm record; v_app uuid; v_m1 text; v_res text; v_note text;
        v_used0 bigint; v_comm0 bigint; v_used1 bigint; v_comm1 bigint; v_max bigint; v_c record; v_n int;
begin
  select tm.id, tm.code, tm.owner_profile_id as o, tm.gm_profile_id as g into a from public.teams tm order by tm.code limit 1;
  select rs.profile_id into v_other from public.roster_spots rs join public.teams tm on tm.id = rs.team_id join public.profiles p on p.id = rs.profile_id
   where rs.season_id = v_s2 and rs.team_id <> a.id and rs.profile_id not in (tm.owner_profile_id, tm.gm_profile_id)
     and p.role::text not in ('staff', 'commissioner')
   order by rs.created_at, rs.profile_id limit 1;
  select rs.profile_id, rs.salary into v_agm from public.roster_spots rs join public.profiles p on p.id = rs.profile_id
   where rs.season_id = v_s2 and rs.team_id = a.id and rs.profile_id not in (a.o, a.g) and p.role::text not in ('staff', 'commissioner')
   order by rs.salary desc, rs.profile_id limit 1;
  if v_other is null or v_agm.profile_id is null then raise exception 'JOINT FAILED T5: no plain player to nominate (other club %, own club %)', v_other, v_agm.profile_id; end if;
  perform pg_temp.jr_as(a.o);
  begin
    insert into public.management_applications (team_id, role, submitted_by, nominee_id) values (a.id, 'agm', a.o, v_other);
    raise exception 'JOINT FAILED T5a: an AGM from another club''s roster was accepted';
  exception when others then
    if sqlerrm not like 'Once the draft starts, a General Manager or Assistant GM is named only from the club''s own active roster%' then raise; end if;
    v_m1 := sqlerrm;
  end;
  insert into public.management_applications (team_id, role, submitted_by, nominee_id) values (a.id, 'agm', a.o, v_agm.profile_id) returning id into v_app;
  perform pg_temp.jr_log('T5 after the draft: an AGM from another roster refused ("' || v_m1 || '"); an AGM from ' || a.code || '''s own roster accepted.');

  -- T6b: the nominee leaves the club's roster while the vote is open; the vote then cannot seat them (undone)
  perform pg_temp.jr_as((select v::uuid from _jr where k = 'comm'));
  begin
    perform public.admin_remove_from_roster(v_agm.profile_id, v_s2);
    perform public.apply_application_decision('management', v_app, true);
    if (select agm_profile_id from public.teams where id = a.id) is not null then raise exception 'JOINT FAILED T6b: the vote seated an AGM who had left the roster'; end if;
    if exists (select 1 from public.roster_spots where season_id = v_s2 and profile_id = v_agm.profile_id) then
      raise exception 'JOINT FAILED T6b: the nominee was put back on a roster by the vote';
    end if;
    if (select status from public.management_applications where id = v_app) <> 'pending'
       or coalesce((select seat_block from public.management_applications where id = v_app), '')
          not like 'Once the draft starts, a General Manager or Assistant GM is named only from the club''s own active roster%' then
      raise exception 'JOINT FAILED T6b: the nomination is not held up with the reason: % / %',
        (select status from public.management_applications where id = v_app), (select seat_block from public.management_applications where id = v_app);
    end if;
    /* the commissioners' notice gives the next step that fits this block, not "vacate the seat", and has no dash */
    select n.body into v_note from public.notifications n
     where n.title = 'Appointment approved but not seated' and n.type = 'flag' and n.created_at >= now()
       and n.profile_id in (select p.id from public.profiles p where p.role::text = 'commissioner')
     limit 1;
    if v_note is null or position(chr(8212) in v_note) > 0 or position('Vacate the seat' in v_note) > 0
       or v_note not like '%Nothing was changed and the nomination is still open. Approve it again only if % returns to the club''s active roster; otherwise deny it so the club can nominate a player from its own roster.' then
      raise exception 'JOINT FAILED T6b: the commissioners were not told the right next step: %', coalesce(v_note, 'no notice');
    end if;
    v_res := 'T6b the AGM nominee removed from ' || a.code || ' before the vote: the vote seated nobody, moved nothing, and held the nomination: "' ||
             (select seat_block from public.management_applications where id = v_app) || '"; the commissioners were told: "' || v_note || '" (undone).';
    raise exception 'JR_UNDO';
  exception when others then
    if sqlerrm <> 'JR_UNDO' then raise; end if;
  end;
  perform pg_temp.jr_log(v_res);

  -- T6
  v_used0 := public.team_cap_used(v_s2, a.id);
  v_comm0 := public.team_cap_committed(a.id, 2);
  if v_used0 is distinct from v_comm0 then raise exception 'JOINT FAILED T6: before the seat, payroll % but committed %', v_used0, v_comm0; end if;
  perform public.apply_application_decision('management', v_app, true);
  if (select agm_profile_id from public.teams where id = a.id) is distinct from v_agm.profile_id then raise exception 'JOINT FAILED T6: the AGM was not seated'; end if;
  if (select salary from public.roster_spots where season_id = v_s2 and profile_id = v_agm.profile_id) is distinct from 2000000
     or (select pre_seat_salary from public.roster_spots where season_id = v_s2 and profile_id = v_agm.profile_id) is distinct from v_agm.salary then
    raise exception 'JOINT FAILED T6: the seat did not replace the drafted salary';
  end if;
  select count(*) into v_n from public.contracts where profile_id = v_agm.profile_id and status in ('active', 'signed');
  if v_n <> 1 or not exists (select 1 from public.contracts where profile_id = v_agm.profile_id and status = 'active' and is_manager and salary = 2000000 and team_id = a.id) then
    raise exception 'JOINT FAILED T6: % open contracts, or the drafted contract did not become the management row', v_n;
  end if;
  v_used1 := public.team_cap_used(v_s2, a.id);
  v_comm1 := public.team_cap_committed(a.id, 2);
  if v_used1 <> v_used0 - v_agm.salary + 2000000 or v_comm1 is distinct from v_used1 then
    raise exception 'JOINT FAILED T6: payroll % to %, committed %; the AGM is counted more than once', v_used0, v_used1, v_comm1;
  end if;
  for v_c in select id, code from public.teams loop
    if public.team_cap_committed(v_c.id, 2) is distinct from public.team_cap_used(v_s2, v_c.id) then
      raise exception 'JOINT FAILED T6: % committed % but payroll %', v_c.code, public.team_cap_committed(v_c.id, 2), public.team_cap_used(v_s2, v_c.id);
    end if;
  end loop;
  select max(public.team_cap_used(v_s2, tm.id)) into v_max from public.teams tm;
  if v_max > 30000000 then raise exception 'JOINT FAILED T6: a club is over the $30M cap (%)', v_max; end if;
  perform pg_temp.jr_log('T6 ' || a.code || '''s AGM (drafted at $' || to_char(v_agm.salary / 1e6, 'FM990.00') || 'M) is seated at $2.00M, the drafted figure kept in pre_seat_salary; ' ||
    'one contract, now the management row; payroll $' || to_char(v_used0 / 1e6, 'FM990.00') || 'M to $' || to_char(v_used1 / 1e6, 'FM990.00') ||
    'M and committed the same (before this record the committed figure would have added another $2.00M); the highest payroll in the league $' ||
    to_char(v_max / 1e6, 'FM990.00') || 'M under the $30M cap.');
end $t56$;

-- every deferred constraint (the roster shape check, check_roster_structure) judges the world built above
set constraints all immediate;

do $fin$
declare v text;
begin
  select string_agg(line, chr(10) order by n) into v from _jr_log;
  raise exception 'REHEARSAL OK (joint draft night): S0 T7 T1 T2 T3 T4 T5 T6b T6%', chr(10) || v;
end $fin$;
