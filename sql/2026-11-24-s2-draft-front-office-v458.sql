-- v4.58 (2026-11-25): Season 2's draft and front office: picks keep a club able to reach 3/2/1 while players of the short
-- group are left, the Assistant GM comes after the draft from the club's own roster (checked again when the staff vote
-- seats them), no staff department is exempt from the front-office bar, the AGM's money is counted once, and the draft
-- room's own messages say what Season 2 does.
--
-- Rulings (commissioner, 2026-11-23, league law):
--   "do 3 forwards, 2 defensemen, and 1 goalie" (position minimums, no maximums; db-guards puts them in season_rules and
--   roster_min_gap, the ONE 3/2/1 definition); "10 round draft" (the Owner and GM seated before the draft plus ten picks
--   make twelve; the GM is required before the draft); "A skipped draft pick will be filled with a random assignment
--   following the end of the draft" at $750K ("750k works"); the Assistant GM is nominated only after the draft completes
--   and must be a player on the club's current roster, never another roster or training camp; a replacement GM in season
--   comes only from the club's own roster ("Correct"); seat salaries stay Owner $0, GM $0, AGM $2M, and the AGM's seat
--   salary replaces their drafted salary, never both; no Media role in Season 2, so a staffer granted an owner seat loses
--   the staff role; no latecomer or automatic placement in Season 2. The go-ahead to apply Season 2 changes: "Yes, apply
--   them".
-- Decided 2026-11-23 for draft night (the review of this record): D-SUPPLY, a short group counts toward a club's 3/2/1
--   reachability only while an undrafted player of that group is left, so the draft never deadlocks and a club left short
--   is covered by the market; D-FILL (pending the commissioner's confirmation, owned by db-guards), the fill after the
--   draft runs once and an owed pick it cannot fill lapses, with "fills already made" counted by ONE definition,
--   public._unused_pick_fills, which both _place_for_unused_picks and draft_fits use.
--
-- 1. draft_fits: in a market season (public.market_on, db-guards) a pick fits when the active roster has room and, after
--    it, the club can still reach every minimum with the spots and the picks it has left (Owner and GM spots count).
--    A pick in a group that is still short always fits. A short group counts only while an undrafted, eligible player of
--    it is left (public._undrafted_left, new): once the last defenseman is drafted, a club short one may still pick in the
--    other groups instead of being refused on every pick until its clock runs out. The picks left are the unused picks
--    less public._unused_pick_fills (db-guards) less this one. The refusal says "picks left" when the picks are the limit
--    and "roster spots left" when the roster is. Today draft_fits refuses only a full roster or a group at its maximum,
--    and Season 2 has no maximums (quota = roster_max), so nothing would stop a club drafting ten forwards.
--    _draft_auto_advance needs no change: since v2.70 an expired clock skips the pick and never drafts, and the skipped
--    pick is filled after the draft by _place_for_unused_picks, which asks draft_fits, so the fill follows the new rule.
-- 2. guard_mgmt_nominee and apply_application_decision: one test, public._mgmt_nominee_seat_block (new), asked when the
--    nomination is filed and again when the staff vote seats it. In a market season an Assistant GM nomination is refused
--    until the draft is complete; from the start of the draft every GM or AGM nominee must hold an active, non-camp spot
--    on that club (the old in-season branch allowed a camp player and told members "the Owner may name anyone" between
--    seasons, which is false for an AGM in Season 2); and no staffer or commissioner may be nominated, with no Media
--    exception and no Season 1 role-conflict exemption (the 2026-07-16 grandfathering covered Season 1 only). Asked
--    again at the vote because the seat is applied later: ensure_manager_rostered finds the nominee's spot on ANY club and
--    moves it back, so a nominee traded, claimed or waived while the vote was open was pulled onto the club with no trade
--    and the other club lost a player silently. A failure at the vote takes the existing seat_block path (nothing
--    changes, the nomination stays open, the office and the submitter are told why). The test returns each reason with
--    the office's next step beside it, and in a market season the commissioners' "Appointment approved but not seated"
--    notice gives that step: the old "vacate the seat, then approve it again" (with its em dash) is wrong for a nominee
--    who left the club's roster, where the step is to deny it, or approve it again only if they return. The two seat
--    blocks keep "vacate the seat". Season 1's sentence is unchanged. set_team_manager, the commissioners'
--    own door, is untouched (commissioner powers ruling).
-- 3. team_cap_committed: in a market season the AGM's $2M is no longer reserved on top of the roster. The AGM comes from
--    the club's own roster, so their drafted contract is already counted among the players until the seat converts it
--    to the management row at the AGM salary (ensure_manager_rostered: same contract, salary set to the seat's, roster
--    spot salary set to the seat's, the drafted figure kept in pre_seat_salary). Reserving $2M as well counted that
--    player twice until they were seated. mgmt_salary_of needs no change: it already returns the seat salary (AGM $2M)
--    and every writer of a manager's spot and contract replaces the salary with it.
--    Cap math with Owner $0, GM $0, AGM $2M and ten rounds ($3.00M down to $0.75M, $18.75M): a full club carries $18.75M
--    before an AGM is named, and $18.75M - drafted + $2M after, at most $20.00M (an AGM taken in round ten), leaving at
--    least $10.00M under the $30M cap. (Market-engine 2.7 item 13 assumed two $3M seats, $24.75M; that is superseded.)
-- 4. The draft room's own messages, market seasons only: draft_make_pick no longer tells a manager that a late sign-up is
--    "placed on a club as depth after the draft" (they join the training camp pool); start_draft asks for the Owner and an
--    approved General Manager, not "an Owner, a GM and an AGM" (draft_management_gaps already checks only those two),
--    and its "build the board first" refusal loses its em dash; draft_conclude's public transactions line loses its em
--    dash. The first-year refusal is left alone: no basic season reaches it (the basic branch raises first).
-- 5. generate_draft_board: checked, unchanged. A basic season's board is a random snake: format_rules('basic') carries
--    draft_snake true, and since v3.62 (Q43, "fully random") the standings styles are refused for basic seasons. The
--    Aug 25 linear order with the NHL-style lottery now belongs to the full format only (the v2.48 and v2.51 basic
--    layout set "15 rounds SNAKE, random order each season"). Season 1's board was a random snake; the rulebook's basic
--    text says snake. The board does not contradict a ruling, so it is not changed.
-- Every other season takes the old path: the new branches are inserted beside the old text, and the self-checks prove
-- that removing them gives back each live definition byte for byte, and that Season 1's outputs are unchanged.
-- Patched by exact-anchor text replacement, each anchor asserted to match exactly once (CLAUDE.md, database change
-- protocol step 3). CREATE OR REPLACE keeps owner, grants, SECURITY DEFINER, search_path and the trigger binding.
-- No anchor here holds a version placeholder, so numbering the records (v4.58 to a real number) cannot break one.
-- Applied together with db-guards' record and db-waivers' waive hold (the joint draft-night rehearsal runs the three),
-- before any Season 2 board exists.

do $pre$
begin
  if to_regprocedure('public.market_on(uuid)') is null or to_regprocedure('public.roster_min_gap(uuid,uuid,text,uuid)') is null
     or to_regprocedure('public._unused_pick_fills(uuid,uuid)') is null then
    raise exception 'v4.58: public.market_on(uuid), public.roster_min_gap(uuid,uuid,text,uuid) or public._unused_pick_fills(uuid,uuid) is missing. Apply the Season 2 draft-night guards record (db-guards) first.';
  end if;
end $pre$;

-- the two helpers (new; called only by other definers, so no client grant)
create function public._undrafted_left(p_season uuid, p_group text, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path to ''
as $fn$
  /* v4.58 (D-SUPPLY, decided 2026-11-23): is a player of this group (F, D or G) still left to draft, or to fill a skipped
     pick with? An undrafted sign-up is one that is not declined, has held no roster spot this season (roster_tenures
     records every spot, so a drafted, filled or waived player is out), is draft-eligible, and is neither suspended nor
     banned: the players _place_for_unused_picks draws from. p_except is the player being judged, who cannot also be the
     one left. draft_fits counts a short group only while this is true, so the draft never deadlocks on a group nobody
     is left to fill. Suspended and banned sign-ups stay out even though a club may still draft a suspended player
     (decided by the main session, 2026-11-23): supply counts the players the fill could place. */
  select exists (
    select 1 from public.season_registrations sr
     where sr.season_id = p_season and sr.status <> 'declined'
       and sr.profile_id is distinct from p_except
       and public.pos_group(coalesce(sr.position::text, 'C')::public.hockey_position) = p_group
       and not exists (select 1 from public.roster_tenures rt where rt.season_id = p_season and rt.profile_id = sr.profile_id)
       and public.is_draft_eligible(sr.profile_id, p_season)
       and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id))
$fn$;
revoke all on function public._undrafted_left(uuid, text, uuid) from public, anon, authenticated;

create function public._mgmt_nominee_seat_block(p_team uuid, p_role text, p_nominee uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
/* v4.58 (commissioner, 2026-11-23): in a market season the Assistant GM is nominated only after the draft completes and
   must be a player on the club's current roster, never another roster or training camp; a replacement GM in season
   comes only from the club's own roster ("Correct"). From the start of the draft (season_underway) both seats are filled
   only from the club's active, non-camp roster. There is no Media role in Season 2, so no staff department is exempt,
   and the role-conflict exemptions were Season 1 grandfathering (2026-07-16), so they do not apply either.
   The ONE definition: guard_mgmt_nominee asks it when the nomination is filed, and apply_application_decision asks it
   again when the staff vote seats the nominee, since the nominee may have been traded, claimed or waived meanwhile.
   Returns null when the nominee can be seated, or when the current season is not a market season; otherwise
   {"why": the reason, shown to the member filing and kept as the nomination's seat_block, "fix": the office's next step,
   for the commissioner notice when the vote is held up}. Each reason sits beside its own next step, so the notice never
   gives the old "vacate the seat" advice for a block no seat causes (a nominee who left the club's roster). */
declare v_sid uuid := public.current_season_id(); v_snum int; v_name text; v_role text;
begin
  if v_sid is null or not public.market_on(v_sid) then return null; end if;
  select s.number into v_snum from public.seasons s where s.id = v_sid;
  select nullif(p.gamertag, ''), p.role::text into v_name, v_role from public.profiles p where p.id = p_nominee;
  v_name := coalesce(v_name, 'That member');
  if v_role in ('staff', 'commissioner') then
    return jsonb_build_object(
      'why', format('%s is league %s and cannot hold a club management role. No league office seat, in any department, may be held together with a club seat.', v_name, v_role),
      'fix', format('Approve it again once %s has left the league office, or deny it so the club can nominate someone else.', v_name));
  end if;
  if p_role = 'agm' and not exists (select 1 from public.draft_state d where d.season_number = v_snum and d.status = 'complete') then
    return jsonb_build_object(
      'why', format('An Assistant GM is named only after the draft is complete, and only from the club''s own roster. %s cannot be nominated before then.', v_name),
      'fix', format('Approve it again once the draft is complete, if %s is then on the club''s own roster; otherwise deny it.', v_name));
  end if;
  if public.season_underway() and not exists (select 1 from public.roster_spots rs
       where rs.season_id = v_sid and rs.team_id = p_team and rs.profile_id = p_nominee
         and rs.status = 'active' and coalesce(rs.squad, 'pro') <> 'tc') then
    return jsonb_build_object(
      'why', format('Once the draft starts, a General Manager or Assistant GM is named only from the club''s own active roster, and %s is not on it.', v_name),
      'fix', format('Approve it again only if %s returns to the club''s active roster; otherwise deny it so the club can nominate a player from its own roster.', v_name));
  end if;
  return null;
end $fn$;
revoke all on function public._mgmt_nominee_seat_block(uuid, text, uuid) from public, anon, authenticated;

create temp table _s2_front_office_before (k text primary key, v text) on commit drop;
insert into _s2_front_office_before (k, v)
  select 'def:' || f, pg_get_functiondef(f::regprocedure)
    from unnest(array['public.draft_fits(uuid,uuid,uuid)', 'public.guard_mgmt_nominee()', 'public.team_cap_committed(uuid,integer)',
                      'public.apply_application_decision(text,uuid,boolean)', 'public.draft_make_pick(uuid,uuid)',
                      'public.start_draft(integer,integer)', 'public.draft_conclude(integer)']) f
  union all
  select 'cap1', string_agg(t.code || '=' || public.team_cap_committed(t.id, 1), ',' order by t.code) from public.teams t
  union all
  select 'fits1', md5(string_agg(coalesce(public.draft_fits(s.id, t.id, sr.profile_id), '-'), '|' order by t.code, sr.profile_id))
    from public.seasons s cross join public.teams t join public.season_registrations sr on sr.season_id = s.id
   where s.number = 1;

create temp table _s2_front_office_patch (
  ord int primary key,
  fn text not null,
  mode text not null check (mode in ('after', 'before', 'replace')),
  a text not null,
  s2 text not null,
  b text
) on commit drop;

insert into _s2_front_office_patch (ord, fn, mode, a, s2) values
(1, 'public.draft_fits(uuid,uuid,uuid)', 'after',
 $a$  v_max := (public.season_rules(p_season)->>'roster_max')::int;
$a$,
 $s$  /* v4.58 (commissioner, 2026-11-23: "do 3 forwards, 2 defensemen, and 1 goalie", no position maximums, and "10 round
     draft"): in a market season a pick fits when the active roster has room and, after it, the club can still reach every
     minimum with the spots and the picks it has left. roster_min_gap is the ONE 3/2/1 definition and counts every active
     spot, the Owner's and the GM's included. A pick in a group that is still short always fits: it only brings the club
     closer. A short group counts only while an undrafted player of it is left (_undrafted_left): once the last
     defenseman is drafted, a club short one may still pick forwards and goaltenders instead of being refused on every
     pick until its clock runs out; the club stays short and the market covers it (D-SUPPLY, decided 2026-11-23). The
     picks left are the club's unused picks (a skipped pick is owed a player after the draft) less the fills already made
     for them (_unused_pick_fills, the one count _place_for_unused_picks uses, taken from roster history so a fill the
     club later waived or traded still counts) less this one. The live pick (draft_make_pick) and the fill after the draft
     ask the same question. Every other season takes the old path. */
  if public.market_on(p_season) then
    declare v_gap jsonb; v_g text; v_n int; v_short int := 0; v_open int; v_picks int; v_need text[] := '{}';
    begin
      v_gap := public.roster_min_gap(p_season, p_team, v_grp);
      v_open := (v_gap->>'open')::int;
      if (v_gap->>'short') is null or v_open is null then
        raise exception 'v4.58: roster_min_gap returned no short or open count for this club (%)', v_gap;
      end if;
      if v_open < 0 then return 'the active roster is full (' || v_max || ' players, management included)'; end if;
      if (v_gap->>'short')::int < (public.roster_min_gap(p_season, p_team)->>'short')::int then return null; end if;
      foreach v_g in array array['F', 'D', 'G'] loop
        v_n := coalesce((v_gap->>v_g)::int, 0);
        if v_n > 0 and public._undrafted_left(p_season, v_g, p_profile) then
          v_short := v_short + v_n;
          v_need := v_need || (v_n || case v_g when 'F' then case when v_n = 1 then ' forward' else ' forwards' end
                                               when 'D' then case when v_n = 1 then ' defenseman' else ' defensemen' end
                                               else case when v_n = 1 then ' goaltender' else ' goaltenders' end end);
        end if;
      end loop;
      if v_short = 0 then return null; end if;
      select count(*) into v_picks
        from public.draft_picks dp join public.seasons s on s.number = dp.season_number
       where s.id = p_season and dp.current_team_id = p_team and not coalesce(dp.used, false);
      v_picks := greatest(v_picks - public._unused_pick_fills(p_season, p_team) - 1, 0);
      if v_short <= least(v_open, v_picks) then return null; end if;
      return 'after this pick the club would still need ' ||
             case array_length(v_need, 1) when 1 then v_need[1]
                                          when 2 then v_need[1] || ' and ' || v_need[2]
                                          else v_need[1] || ', ' || v_need[2] || ' and ' || v_need[3] end ||
             ' to reach the roster minimums, with ' ||
             case when v_picks <= v_open
                  then case v_picks when 0 then 'no picks left' when 1 then '1 pick left' else v_picks || ' picks left' end
                  else 'only ' || v_open || case when v_open = 1 then ' roster spot left' else ' roster spots left' end end;
    end;
  end if;
$s$),
(2, 'public.guard_mgmt_nominee()', 'after',
 $a$  select coalesce(nullif(gamertag,''),'That member'), role::text into v_name, v_role
    from public.profiles where id = new.nominee_id;
$a$,
 $s$  /* v4.58 (commissioner, 2026-11-23: the Assistant GM after the draft from the club's own roster, a replacement GM in
     season only from the club's own roster, no Media role): in a market season the nominee is judged by
     _mgmt_nominee_seat_block, the one test the staff vote asks again when it seats them. Every other season takes the
     old path below, unchanged. */
  if public.market_on(v_sid) then
    declare v_why text := public._mgmt_nominee_seat_block(new.team_id, new.role::text, new.nominee_id)->>'why';
    begin
      if v_why is not null then raise exception '%', v_why using errcode = 'check_violation'; end if;
    end;
  end if;
$s$),
(3, 'public.team_cap_committed(uuid,integer)', 'replace',
 $a$      (select s.owner_salary + s.gm_salary + s.agm_salary from public.seasons s where s.number = p_season_number),$a$,
 $s$      /* v4.58 (ruling 2026-11-23: the AGM's seat salary replaces their drafted salary, never both): in a market season the
         Assistant GM comes from the club's own roster after the draft, so their drafted contract already counts among the
         players until the seat converts it to the management row at the AGM salary (ensure_manager_rostered). Reserving
         the AGM salary as well would count that player twice; only the Owner and GM seats are reserved. */
      (select s.owner_salary + s.gm_salary + case when public.market_on(s.id) then 0 else s.agm_salary end from public.seasons s where s.number = p_season_number),$s$),
(4, 'public.team_cap_committed(uuid,integer)', 'replace',
 $a$      (select s.owner_salary + s.gm_salary + s.agm_salary from public.seasons s where s.id = public.current_season_id()),$a$,
 $s$      (select s.owner_salary + s.gm_salary + case when public.market_on(s.id) then 0 else s.agm_salary end from public.seasons s where s.id = public.current_season_id()),$s$),
(5, 'public.apply_application_decision(text,uuid,boolean)', 'before',
 $a$      if v_block is not null then
        v_was := v_app.seat_block;$a$,
 $s$      /* v4.58 (commissioner, 2026-11-23: the Assistant GM comes after the draft from the club's own roster, and an
         in-season replacement GM only from the club's own roster): in a market season the vote is held to the test the
         nomination passed, asked again now (_mgmt_nominee_seat_block). The seat is applied by ensure_manager_rostered,
         which finds the nominee's spot on ANY club and moves it here, so a nominee traded, claimed or waived while the
         vote was open would otherwise be pulled back with no trade. A failure takes the seat_block path below: nothing
         changes, the nomination stays open, and the office and the submitter are told why. */
      if v_block is null and public.market_on(public.current_season_id()) then
        v_block := public._mgmt_nominee_seat_block(v_app.team_id, v_app.role, v_app.nominee_id)->>'why';
      end if;

$s$),
(6, 'public.draft_make_pick(uuid,uuid)', 'before',
 $a$      raise exception 'That player isn''t draft-eligible: they registered after the sign-up cutoff. They''ll be placed on a club as depth after the draft (Rule 2.8).';$a$,
 $s$      /* v4.58 (commissioner, 2026-11-23: no latecomer or automatic placement in Season 2): a market season places no
         late sign-up after the draft; they join the training camp pool, where clubs reach them by a claim or at bidding. */
      if public.market_on(v_season) then
        raise exception 'That player isn''t draft-eligible: they signed up after the sign-up cutoff. They join the training camp pool after the draft.';
      end if;
$s$),
(7, 'public.start_draft(integer,integer)', 'before',
 $a$    raise exception 'Every club needs an Owner, a GM and an AGM before the draft can start. Still open: %',$a$,
 $s$    /* v4.58 (ruling 2026-11-23: the Owner and the General Manager are seated before the draft, and the GM is required;
       the Assistant GM is named after the draft from the club's own roster): a market season does not ask for an AGM.
       draft_management_gaps already checks only the Owner and GM seats. */
    if public.market_on((select s.id from public.seasons s where s.number = p_season_number)) then
      raise exception 'Every club needs its Owner and an approved General Manager seated before the draft can start. Still open: %',
        (select string_agg(g->>'code' || ' (' || array_to_string(array(select jsonb_array_elements_text(g->'missing')), ', ') || ')', '; ')
           from jsonb_array_elements(public.draft_management_gaps()) g);
    end if;
$s$),
(8, 'public.draft_conclude(integer)', 'replace',
 $a$case when v_open>0 then ' — '||v_open||' unused pick'||case when v_open=1 then '' else 's' end||' released' else '' end$a$,
 $s$case when public.market_on(v_season)  /* v4.58: a market season's public line, with no dash (house writing rule) */
        then case when v_open>0 then ' with '||v_open||' pick'||case when v_open=1 then '' else 's' end||' unused' else '' end
        else case when v_open>0 then ' — '||v_open||' unused pick'||case when v_open=1 then '' else 's' end||' released' else '' end end$s$),
(9, 'public.apply_application_decision(text,uuid,boolean)', 'replace',
 $a$' Nothing was changed and the nomination is still open — vacate the seat, then approve it again from the application.'$a$,
 $s$case when public.market_on(public.current_season_id())
                 /* v4.58: in a market season the commissioners' advice fits the block. A block from the nominee test
                    (_mgmt_nominee_seat_block, asked again above) carries its own next step: a nominee who left the club's
                    roster is not cured by vacating a seat. The seat blocks above keep "vacate the seat". No dash (house
                    writing rule). Every other season keeps the old sentence. */
                 then ' Nothing was changed and the nomination is still open. ' ||
                      coalesce((select x.j->>'fix'
                                  from (select public._mgmt_nominee_seat_block(v_app.team_id, v_app.role, v_app.nominee_id) as j) x
                                 where x.j->>'why' = v_block),
                               'Vacate the seat, then approve it again from the application.')
                 else ' Nothing was changed and the nomination is still open — vacate the seat, then approve it again from the application.' end$s$),
(10, 'public.start_draft(integer,integer)', 'before',
 $a$    raise exception 'No generated draft order for season % — build the board first (Draft manager → Build the board).', p_season_number;$a$,
 $s$    /* v4.58: a market season's refusal, with no dash (house writing rule); every other season keeps the old words */
    if public.market_on((select s.id from public.seasons s where s.number = p_season_number)) then
      raise exception 'Season % has no draft order yet. Build the board first: open the Draft manager and choose Build the board.', p_season_number;
    end if;
$s$);

-- the patch: every anchor must match its live definition exactly once, or nothing is changed
do $patch$
declare f text; r record; v_def text; v_b text; n int; v_fns int := 0;
begin
  for f in select fn from _s2_front_office_patch group by fn order by min(ord) loop
    v_def := pg_get_functiondef(f::regprocedure);
    for r in select * from _s2_front_office_patch where fn = f order by ord loop
      n := (length(v_def) - length(replace(v_def, r.a, ''))) / length(r.a);
      if n <> 1 then raise exception 'v4.58: % anchor % found % times', f, r.ord, n; end if;
      v_b := case r.mode when 'after' then r.a || r.s2 when 'before' then r.s2 || r.a else r.s2 end;
      update _s2_front_office_patch set b = v_b where ord = r.ord;
      v_def := replace(v_def, r.a, v_b);
    end loop;
    execute v_def;
    v_fns := v_fns + 1;
  end loop;
  if v_fns <> 7 then raise exception 'v4.58: patched % functions, expected 7', v_fns; end if;
end $patch$;

-- self-checks
do $chk$
declare f text; r record; v_def text; v_s1 uuid; v_s2 uuid; c record; v_m text; v_p uuid; n int := 0; v_j jsonb;
begin
  select id into v_s1 from public.seasons where number = 1;
  select id into v_s2 from public.seasons where number = 2;
  /* removing the new text gives back each live definition exactly, so every other season reads the old code */
  for f in select fn from _s2_front_office_patch group by fn loop
    v_def := pg_get_functiondef(f::regprocedure);
    for r in select * from _s2_front_office_patch where fn = f order by ord desc loop
      if position(r.b in v_def) = 0 then raise exception 'v4.58 check: % lacks the new text of row %', f, r.ord; end if;
      v_def := replace(v_def, r.b, r.a);
    end loop;
    if v_def is distinct from (select v from _s2_front_office_before where k = 'def:' || f) then
      raise exception 'v4.58 check: % changed outside its patch rows', f;
    end if;
    -- shortcut: these seven definers keep search_path public because their old bodies use unqualified names (the new
    -- text is schema-qualified), revisit when one of them is rewritten in full
    if (select not prosecdef or proconfig is distinct from array['search_path=public'] from pg_proc where oid = f::regprocedure) then
      raise exception 'v4.58 check: % lost SECURITY DEFINER or its search_path', f;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'guard_mgmt_nominee_ins' and tgrelid = 'public.management_applications'::regclass
                   and tgfoid = 'public.guard_mgmt_nominee()'::regprocedure and tgenabled = 'O') then
    raise exception 'v4.58 check: guard_mgmt_nominee_ins is no longer bound';
  end if;
  /* the helpers: definers on an empty search_path, reachable by no API role */
  for f in select unnest(array['public._undrafted_left(uuid,text,uuid)', 'public._mgmt_nominee_seat_block(uuid,text,uuid)']) loop
    if (select not prosecdef or proconfig is distinct from array['search_path=""'] from pg_proc where oid = f::regprocedure) then
      raise exception 'v4.58 check: % is not a definer on an empty search_path', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or has_function_privilege('public', f, 'EXECUTE') then
      raise exception 'v4.58 check: an API role can execute %', f;
    end if;
  end loop;
  /* Season 1 is not a market season, and its cap and pick outputs are what they were */
  if public.market_on(v_s1) then raise exception 'v4.58 check: Season 1 reads as a market season'; end if;
  if not public.market_on(v_s2) then raise exception 'v4.58 check: Season 2 is not a market season (db-guards first)'; end if;
  if (select string_agg(t.code || '=' || public.team_cap_committed(t.id, 1), ',' order by t.code) from public.teams t)
     is distinct from (select v from _s2_front_office_before where k = 'cap1') then
    raise exception 'v4.58 check: Season 1 committed payrolls changed';
  end if;
  if (select md5(string_agg(coalesce(public.draft_fits(v_s1, t.id, sr.profile_id), '-'), '|' order by t.code, sr.profile_id))
        from public.teams t join public.season_registrations sr on sr.season_id = v_s1)
     is distinct from (select v from _s2_front_office_before where k = 'fits1') then
    raise exception 'v4.58 check: Season 1 draft_fits answers changed';
  end if;
  /* Season 2: the committed payroll is the payroll the cap guard counts, so nothing is counted twice */
  for c in select id, code from public.teams loop
    if public.team_cap_committed(c.id, 2) is distinct from public.team_cap_used(v_s2, c.id) then
      raise exception 'v4.58 check: % commits % for Season 2 but its payroll is %', c.code, public.team_cap_committed(c.id, 2), public.team_cap_used(v_s2, c.id);
    end if;
  end loop;
  /* the new Season 2 branch of draft_fits runs now, not first on draft night: every club against every Season 2 sign-up.
     A club with no Season 2 spot is short in every group, so every pick brings it closer and fits. */
  for c in select t.id, t.code, exists (select 1 from public.roster_spots rs where rs.season_id = v_s2 and rs.team_id = t.id) as has_spots
             from public.teams t loop
    for v_p in select sr.profile_id from public.season_registrations sr where sr.season_id = v_s2 and sr.status <> 'declined' loop
      v_m := public.draft_fits(v_s2, c.id, v_p);
      n := n + 1;
      if v_m is not null and not c.has_spots then
        raise exception 'v4.58 check: % has no Season 2 spot yet draft_fits refused a pick: %', c.code, v_m;
      end if;
    end loop;
  end loop;
  if n = 0 then raise exception 'v4.58 check: no Season 2 sign-up to try draft_fits on'; end if;
  /* the nominee test runs too: before the draft completes, a plain member is refused as an Assistant GM */
  if not exists (select 1 from public.draft_state d where d.season_number = 2 and d.status = 'complete') then
    select sr.profile_id into v_p from public.season_registrations sr join public.profiles p on p.id = sr.profile_id
     where sr.season_id = v_s2 and sr.status <> 'declined' and p.role::text not in ('staff', 'commissioner')
     order by sr.created_at, sr.profile_id limit 1;
    v_j := public._mgmt_nominee_seat_block((select id from public.teams order by code limit 1), 'agm', v_p);
    if v_p is not null and (coalesce(v_j->>'why', '') not like 'An Assistant GM is named only after the draft is complete, and only from the club''s own roster.%'
                            or coalesce(v_j->>'fix', '') not like 'Approve it again once the draft is complete%') then
      raise exception 'v4.58 check: an Assistant GM before the draft was not refused with its reason and the office''s next step (%)', v_j;
    end if;
  end if;
end $chk$;
