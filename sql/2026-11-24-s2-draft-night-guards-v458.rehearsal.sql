-- REHEARSAL for sql/2026-11-24-s2-draft-night-guards-v458.sql (Season 2 draft-night guards, the db-guards stream).
-- The main session runs this whole file on production as ONE execute_sql call. It opens a transaction, applies the
-- record's text verbatim (copied below; tools/s2-draft-night-guards-v458.test.cjs fails if the copy drifts), runs the
-- cases against a synthetic Season 2 world built inside the same transaction, and ends in an UNCAUGHT
-- raise exception 'REHEARSAL OK: ...', so everything rolls back: roster rows, registrations, notices, app_config marks,
-- the modeled rollover and pg_net posts (pg_net is transactional, so nothing reaches Discord). Expected refusals sit in
-- inner blocks that re-raise anything unexpected. No outer handler, no dblink, no http.
-- Pass: the call fails with exactly "REHEARSAL OK: R1 rules R2 pick pay R3 fa_open R4 no late placement R5 one fill then
-- lapse R6 roster_min_gap R7 origins R8 wording R8b no-limit R9 Season 1 unchanged". Any other error is a failure.
-- When: on an empty Season 2 (no roster spot, no seat holder; the setup refuses otherwise), so before the Dec 5 seating.
-- The record's ALTER holds roster_spots exclusively until the closing raise, so site roster reads wait for the length
-- of the run: run it off game nights and outside a bid hour. If the commissioner's rollover (start_next_season) has not
-- run yet, the cases model it first, under a commissioner's claims; after the real rollover they skip that step.
-- The draft-night joint rehearsal (db-draft) applies this record's text first, then db-waivers' and db-draft's.

begin;

-- v4.58 (2026-11-24): Season 2 draft-night guards. The database learns that Season 2 runs the player market, so that the
-- Season 1 automations stop handing Season 2 players out after the Dec 12 draft, and the Season 2 row carries the ruled
-- cap and rounds. Rulings (commissioner, 2026-11-23): cap $30M; "10 round draft"; roster 12 all season; minimums of
-- "3 forwards, 2 defensemen, and 1 goalie" and no maximums; no club camps; "A skipped draft pick will be filled with a
-- random assignment following the end of the draft", at $750K ("750k works"); no depth placement, no latecomer or
-- automatic placement and no free agency in Season 2; no weekly game limits. Contract:
-- ~/Developer/cghl-private/contracts/season-rules.md (frozen 2026-11-23).
--
-- What changes (every Season 2 branch tests public.market_on(season); Season 1 keeps its path):
--  1. public.market_on(season) (new): true when season_rules says market. A gate helper, so anon and authenticated keep
--     EXECUTE.
--  2. public.roster_min_gap(season, team, plus_group, minus_profile) (new): the ONE definition of the 3/2/1 minimums.
--     Shortfalls against season_rules quota_min over the club's ACTIVE roster (the pro_roster_count set: Owner and GM
--     spots included, camp and pre-season loans not), after a hypothetical add of one player of a group or removal of
--     one profile. "open" is roster_max minus the active spots after the hypothetical; the club can still reach the
--     minimums when short <= open. SECURITY DEFINER, no client grant: draft_fits, the unused-pick fill, waive, claim,
--     trade arrivals and the shortfall draw call it. A season with no quota_min (Season 1) reports no shortfall.
--  2b. public._unused_pick_fills(season, team) (new): the ONE count of players already placed for a club's unused draft
--     picks this season, from roster_tenures (joined_how 'postdraft_random'), so a fill the club later waived or traded
--     away still counts and a fill traded TO a club does not. SECURITY DEFINER, no client grant. The market fill below
--     and db-draft's draft_fits (its "picks left") both read it; before the adversarial review they counted two ways
--     (tenures here, current roster_spots there) and disagreed by one once a fill left the club.
--  3. season_rules: from Season 2, a basic season adds market, quota (every group up to roster_max: no position
--     maximums), quota_min 3/2/1, camp_max 0, cap_skater/cap_goalie/cap_camp JSON null (no weekly game limits) and the
--     mk constants. Season 1 gets none of these keys; the self-check compares it to the literal captured on production
--     on 2026-11-23 before this change.
--  4. Season 2 row: salary_cap 30000000 and draft_rounds 10 (it read 50000000 and 9).
--  5. draft_pick_salary: before a board exists the scale is sized from the season's own rounds, not the format's
--     fifteen. Season 2's ten rounds pay $3.00M down to $0.75M, $18.75M in all. A board that exists still sizes the
--     scale (Season 1's twelve rounds are unchanged).
--  6. distribute_unproven_rookies (cron rookie-distribution, every 2 minutes): a market season fills the unused draft
--     picks (_place_for_unused_picks) and stops there. No depth placement. The clubs hear about the fills in one
--     notice each. Once the fill has run, the office's forced run is told so instead of reading zero.
--  7. _place_for_unused_picks, market seasons only (main-session decision D-FILL, 2026-11-23, pending the
--     commissioner's confirmation): the fill runs ONCE, on the first post-draft run, under a lock, and records that run
--     in the season's postdraft_done_ mark (the house key for "the season's first post-draft round is done", v3.89).
--     A pick it cannot fill then LAPSES: no later run places a player for it, and the club fills the spot by a waiver
--     claim or at Saturday bidding. The commissioners are told once per club with the true reason: the club's roster
--     was already full, a league-minimum salary would carry it over the cap, or no undrafted player was left who keeps
--     it able to reach 3/2/1. (Before the review an unfilled pick stayed open until the movement deadline, so a club
--     that filled its roster first got a random $750K player weeks into the season the next time it opened a spot,
--     and a full roster was reported as "no player fits".) Fills already made are counted by _unused_pick_fills (2b),
--     and the fill takes an undrafted player (no roster spot held this season), so a waived player is never filled
--     around the waiver. It still pays 750000 and still asks draft_fits (db-draft makes draft_fits 3/2/1-aware on
--     roster_min_gap; that is not in this record). Season 1's cap notice and its sentence are unchanged.
--  8. auto_assign_latecomers (cron latecomer-assign) and trg_autoassign_new_reg (the sign-up trigger): a market season
--     places nobody; a late sign-up joins the training camp pool. The contract-return branch (Rule 2.5) is a contract
--     right, not a placement, and is left as it is (no contract reaches Season 2). The office's forced run refuses in
--     words instead of reporting zero. preseason_random_assign's basic-format refusal promised depth placement after
--     the draft; a market season says what replaces it.
--  9. fa_open: false in a market season. That closes sign_free_agent and offer_free_agent; both now refuse market
--     seasons BEFORE the approval gate (mgmt_gate), so a manager whose seat needs the Owner's approval is not sent to
--     ask for a signing that cannot happen, and say there is no free agency this season and what replaces it.
--     respond_offer's acceptance of an open-market offer (which never asked fa_open) says the same. The office's own
--     roster tools are untouched (commissioner powers).
-- 10. Wording, market seasons only (camp_max 0 made the old messages say "training camp is full (0 players)" and
--     "at most 12 forwards, 12 defensemen and 12 goaltenders"): place_new_roster_spot, guard_squad_move,
--     check_roster_structure (singular or plural per count, never "1 goaltenders") and swap_roster_squad (refused
--     before the approval gate, as in 9). set_roster_squad needs no change: a send-down reaches guard_squad_move, whose
--     market message is the one definition (the rehearsal calls it through set_roster_squad).
--     _club_batch_notices joined every club notice title with a spaced em dash ("Unused draft picks filled <dash> 1
--     player"); it now uses a colon, in every season (the writing rules; the line is touched, so its dash is fixed).
--     The patch table spells that one anchor's dash as {emdash}, so this file carries none.
-- 11. roster_spots_origin_check gains 'waiver_claim', 'market_bid' and 'market_placed'.
-- 12. Weekly-cap null-safety (season_rules cap_* null means no limit). Every caller of weekly_cap, read on production
--     on 2026-11-23:
--     _limit_forfeit_check (v_n > v_cap), review_game_records (v_n > v_cap) and set_game_lineup (v_dressed >= v_cap)
--       compare with null and fall through: no forfeit, no flag, no refusal. Correct; unchanged.
--     series_cap coalesces the format's series_cap (basic: 4) before it asks weekly_cap, so check_playoff_violations
--       and _series_limit_sweep keep the series limit of four. Unchanged.
--     has_cap_exception, revoke_cap_exception and _limit_forfeit_excuse read no cap. Unchanged.
--     check_weekly_cap_violations only calls review_game_records. Unchanged.
--     grant_cap_exception: v_n < null fell through, so it granted an exception to nothing and wrote notices whose text
--       concatenated to null. It now refuses: there is no limit to excuse.
--     lineup_camp_warnings: "under the weekly cap" with a null cap read as false. It now reads null as no limit.
--       Defensive only: the patched line needs a dressed training-camp player, which a market season cannot have, so no
--       rehearsal case reaches it.
-- Not in this record: draft_fits and _draft_auto_advance (db-draft); waive_player, guard_roster_waive, accept_trade and
-- _place_trade_arrivals (db-waivers; _place_trade_arrivals reads camp_max, now 0 in Season 2); announce_lifecycle's
-- Season 2 copy (db-draft); the classic site's mirrors of season_rules and fa_open (part_live.js), which only change if
-- the commissioner rules Season 2 rules onto the current site for the gap. season_rules' salary_cap key still reports
-- the format's figure: nothing in the database reads it (cap_has_room and the cap guard read seasons.salary_cap).
-- Patched by exact-anchor text replacement on the live definitions, each anchor asserted to match exactly once
-- (CLAUDE.md, database change protocol step 3). CREATE OR REPLACE keeps owner, grants and trigger bindings.

/* v4.58: the ALTER of roster_spots below takes an ACCESS EXCLUSIVE lock. If a cron job or a slow site read holds
   roster_spots, fail in five seconds (and retry) instead of queueing every roster read on the site behind the wait. */
set local lock_timeout = '5s';

-- 1. the gate helper (season_rules is invoker, so this one needs no definer rights)
create function public.market_on(p_season uuid)
returns boolean
language sql
stable
set search_path to ''
as $fn$
  /* v4.58: is this season run by the Season 2 player market (waivers, the training camp pool, Saturday bidding)?
     season_rules is the one source; a season without the key is not */
  select coalesce((public.season_rules(p_season)->>'market')::boolean, false)
$fn$;
revoke all on function public.market_on(uuid) from public;
grant execute on function public.market_on(uuid) to anon, authenticated, service_role;

-- 2. the ONE 3/2/1 definition (exact contract signature)
create function public.roster_min_gap(p_season uuid, p_team uuid, p_plus_group text default null, p_minus_profile uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
/* v4.58 (commissioner, 2026-11-23: "do 3 forwards, 2 defensemen, and 1 goalie"): how far the club's ACTIVE roster is
   below the season's minimums (season_rules quota_min), after a hypothetical add of one player of p_plus_group or the
   removal of p_minus_profile. Counted over the set pro_roster_count counts: active spots, the Owner and GM spots
   included, training camp and pre-season loans not. Returns {"F","D","G": shortfall per group, "short": their sum,
   "open": roster_max minus the active spots after the hypothetical}. The club can still reach the minimums when
   short <= open. A season with no quota_min reports no shortfall; a p_minus_profile not counted on the club changes
   nothing. draft_fits, the unused-pick fill, waive, claim, trade arrivals and the shortfall draw all call this. */
declare r jsonb; v_max int; f int; d int; g int; sf int; sd int; sg int;
begin
  if p_season is null or not exists (select 1 from public.seasons s where s.id = p_season) then
    raise exception 'roster_min_gap: there is no season %', p_season using errcode = '22023';
  end if;
  if p_team is null or not exists (select 1 from public.teams t where t.id = p_team) then
    raise exception 'roster_min_gap: there is no club %', p_team using errcode = '22023';
  end if;
  if p_plus_group is not null and p_plus_group not in ('F', 'D', 'G') then
    raise exception 'roster_min_gap: p_plus_group is F, D or G, not %', p_plus_group using errcode = '22023';
  end if;
  r := public.season_rules(p_season);
  v_max := (r->>'roster_max')::int;
  select count(*) filter (where public.pos_group(rs.position) = 'F'),
         count(*) filter (where public.pos_group(rs.position) = 'D'),
         count(*) filter (where public.pos_group(rs.position) = 'G')
    into f, d, g
    from public.roster_spots rs
   where rs.season_id = p_season and rs.team_id = p_team and rs.status = 'active'
     and coalesce(rs.squad, 'pro') <> 'tc'
     and coalesce(rs.origin, '') not in ('preseason_random', 'latecomer_random')
     and rs.profile_id is distinct from p_minus_profile;
  f := f + case when p_plus_group = 'F' then 1 else 0 end;
  d := d + case when p_plus_group = 'D' then 1 else 0 end;
  g := g + case when p_plus_group = 'G' then 1 else 0 end;
  sf := greatest(coalesce((r->'quota_min'->>'F')::int, 0) - f, 0);
  sd := greatest(coalesce((r->'quota_min'->>'D')::int, 0) - d, 0);
  sg := greatest(coalesce((r->'quota_min'->>'G')::int, 0) - g, 0);
  return jsonb_build_object('F', sf, 'D', sd, 'G', sg, 'short', sf + sd + sg, 'open', v_max - (f + d + g));
end $fn$;
revoke all on function public.roster_min_gap(uuid, uuid, text, uuid) from public, anon, authenticated;

-- 2b. the ONE count of fills already made for a club's unused draft picks
create function public._unused_pick_fills(p_season uuid, p_team uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $fn$
  /* v4.58: how many players the league office has placed on this club for draft picks it did not use, this season.
     Counted from the club's roster history (roster_tenures opens a stint with joined_how = the spot's origin), not its
     current roster: a fill the club later waived or traded away has still filled its pick, so waiving it is not a free
     swap for a second random player, and a fill traded TO a club arrives as 'moved from another club' and does not
     count for the receiving club. Distinct members, so a fill's later stints never count twice. _place_for_unused_picks
     (fills already made) and draft_fits (the picks a club has left) both read this; nothing else may count fills. */
  select count(distinct rt.profile_id)::int
    from public.roster_tenures rt
   where rt.season_id = p_season and rt.team_id = p_team and rt.joined_how = 'postdraft_random'
$fn$;
revoke all on function public._unused_pick_fills(uuid, uuid) from public, anon, authenticated;

-- 3 to 10. the patches: every anchor must match its live definition exactly once, or nothing is changed
create temp table _s2guards_patch (ord int primary key, fn text not null, a text not null, b text not null) on commit drop;

insert into _s2guards_patch (ord, fn, a, b) values
(1, 'public.season_rules(uuid)',
 $a$                     'playoff_min_gp', case when public.season_format(p_season) = 'basic' then s.playoff_min_gp end))
                   from public.seasons s where s.id = p_season), '{}'::jsonb)$a$,
 $b$                     'playoff_min_gp', case when public.season_format(p_season) = 'basic' then s.playoff_min_gp end))
                   from public.seasons s where s.id = p_season), '{}'::jsonb)
      /* v4.58 (commissioner, 2026-11-23): from Season 2 a basic season runs the player market. No position maximums
         under the roster limit, minimums of "3 forwards, 2 defensemen, and 1 goalie", no club camps and no weekly game
         limits (cap_* are JSON null, which every reader takes as no limit), and the market's constants. Season 1 gets
         none of these keys. */
      || coalesce((select jsonb_build_object(
                     'market', true,
                     'quota', jsonb_build_object('F', s.roster_max, 'D', s.roster_max, 'G', s.roster_max),
                     'quota_min', jsonb_build_object('F', 3, 'D', 2, 'G', 1),
                     'camp_max', 0,
                     'cap_skater', null, 'cap_goalie', null, 'cap_camp', null,
                     'mk', jsonb_build_object('bid_open', 750000, 'bid_step', 250000, 'lot_seconds', 300, 'waiver_hours', 24,
                                              'bid_gp', 6, 'opens', '21:00', 'new_until', '22:00'))
                   from public.seasons s
                  where s.id = p_season and s.number >= 2 and public.season_format(p_season) = 'basic'), '{}'::jsonb)$b$),
(2, 'public.draft_pick_salary(integer,integer)',
 $a$                    (public.format_rules(public.season_format_n(p_season_number))->>'draft_rounds')::int));$a$,
 $b$                    /* v4.58: before a board exists, the season's own round count (Season 2: ten, so $3.00M down to
                       $0.75M), not the format's fifteen; a season that does not exist still reads the format's */
                    (public.season_rules((select s.id from public.seasons s where s.number = p_season_number))->>'draft_rounds')::int));$b$),
(3, 'public.fa_open(uuid)',
 $a$  select case when public.season_is_basic(s.id) then$a$,
 $b$  /* v4.58 (commissioner, 2026-11-23: no free agency in Season 2): a market season never opens free agency. Players off
     a roster are in the training camp pool and reach a club by a waiver claim or at Saturday bidding. This closes
     sign_free_agent and offer_free_agent. */
  select case when public.market_on(s.id) then false
              when public.season_is_basic(s.id) then$b$),
(4, 'public.distribute_unproven_rookies(boolean)',
 $a$  v_n := v_n + public._place_for_unused_picks(v_season.id, v_season.number);$a$,
 $b$  /* v4.58 (D-FILL): a market season's fill for unused picks runs once (_place_for_unused_picks records the run in the
     season's postdraft_done_ mark). After it has run, the office's button is told so instead of reading zero. */
  if p_force and public.market_on(v_season.id)
     and exists (select 1 from public.app_config c where c.key = 'postdraft_done_' || v_season.id::text) then
    raise exception 'The fill for unused draft picks already ran after the draft, and it runs once. A pick it could not fill has lapsed, and the club fills that spot by a waiver claim or at Saturday bidding.'
      using errcode = 'check_violation';
  end if;
  v_n := v_n + public._place_for_unused_picks(v_season.id, v_season.number);
  /* v4.58 (commissioner, 2026-11-23: "A skipped draft pick will be filled with a random assignment following the end
     of the draft", and no depth placement in Season 2): a market season stops here, once the unused picks are filled.
     Everyone else stays in the training camp pool for waivers and Saturday bidding. Each club hears about its fills
     in one notice, as it heard about the depth round. */
  if public.market_on(v_season.id) then
    perform set_config('app.roster_notice', '', true);
    perform public._club_batch_notices(v_season.id, 'postdraft_random', now(), 'sign', 'Unused draft picks filled',
      'Placed by the league office for draft picks the club did not use, each on a one-season contract at $750K:');
    return v_n;
  end if;$b$),
(5, 'public._place_for_unused_picks(uuid,integer)',
 $a$        v_capped text[] := '{}'; v_last text;
begin$a$,
 $b$        v_capped text[] := '{}'; v_last text;
        /* v4.58: the market-season branches below */
        v_market boolean := public.market_on(p_season); v_why text; v_left int;
        v_done text := 'postdraft_done_' || p_season::text;
begin
  /* v4.58 (commissioner, 2026-11-23: "A skipped draft pick will be filled with a random assignment following the end of
     the draft"; main-session decision D-FILL, 2026-11-23, pending the commissioner's confirmation): in a market season
     the fill runs ONCE, on the first post-draft run. A pick it cannot fill then LAPSES (reported per club below), and
     the club fills the spot by a waiver claim or at Saturday bidding. The run is recorded in v_done, the house key for
     "the season's first post-draft round is done" (v3.89; _assign_reg_random reads it too), and taken under a lock,
     so two runs at once (the cron and the office's button) cannot both fill. A run before the draft is complete would
     lapse every pick, so it is refused instead. */
  if v_market then
    perform pg_advisory_xact_lock(hashtext(v_done));
    if exists (select 1 from public.app_config c where c.key = v_done) then return 0; end if;
    if not exists (select 1 from public.draft_state ds where ds.season_number = p_season_number and ds.status = 'complete') then
      raise exception 'The fill for unused draft picks runs only once the Season % draft is complete.', p_season_number
        using errcode = 'check_violation';
    end if;
  end if;$b$),
(6, 'public._place_for_unused_picks(uuid,integer)',
 $a$    select count(*) into v_have from public.roster_spots rs
      where rs.season_id = p_season and rs.team_id = v_team.id and rs.origin = 'postdraft_random';$a$,
 $b$    select count(*) into v_have from public.roster_spots rs
      where rs.season_id = p_season and rs.team_id = v_team.id and rs.origin = 'postdraft_random';
    /* v4.58: in a market season the fills already made are the one count, public._unused_pick_fills (draft_fits reads
       it too): from the club's roster history, so a fill the club waived or traded away still filled its pick */
    if v_market then v_have := public._unused_pick_fills(p_season, v_team.id); end if;$b$),
(7, 'public._place_for_unused_picks(uuid,integer)',
 $a$      if not public.cap_has_room(p_season, v_team.id, 750000) then
        v_capped := array_append(v_capped, v_team.code);
        exit;
      end if;$a$,
 $b$      /* v4.58: in a market season a full roster is its own reason; draft_fits refused every candidate for it, so it was
         reported as "no player fits" */
      if v_market and (public.roster_min_gap(p_season, v_team.id)->>'open')::int <= 0 then
        v_why := 'full';
        exit;
      end if;
      if not public.cap_has_room(p_season, v_team.id, 750000) then
        if v_market then v_why := 'cap'; exit; end if;   -- v4.58: lapses below, with its reason
        v_capped := array_append(v_capped, v_team.code);
        exit;
      end if;$b$),
(8, 'public._place_for_unused_picks(uuid,integer)',
 $a$          and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id)
          and public.draft_fits(p_season, v_team.id, sr.profile_id) is null$a$,
 $b$          and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id)
          /* v4.58: in a market season the fill takes an UNDRAFTED player, one who has held no roster spot this season.
             A waived player (on waivers or cleared into the pool) is reached by a claim or at bidding, never by a fill. */
          and not (v_market and exists (select 1 from public.roster_tenures rt where rt.season_id = p_season and rt.profile_id = sr.profile_id))
          and public.draft_fits(p_season, v_team.id, sr.profile_id) is null$b$),
(9, 'public._place_for_unused_picks(uuid,integer)',
 $a$      if v_reg.id is null then exit; end if;$a$,
 $b$      if v_reg.id is null then
        if v_market then v_why := 'dry'; end if;   -- v4.58: lapses below, with its reason
        exit;
      end if;$b$),
(10, 'public._place_for_unused_picks(uuid,integer)',
 $a$      v_n := v_n + 1; v_i := v_i + 1;
    end loop;
  end loop;$a$,
 $b$      v_n := v_n + 1; v_i := v_i + 1;
    end loop;
    /* v4.58 (D-FILL): what the one run could not fill for this club lapses. The commissioners are told once per club,
       with the true reason. */
    v_left := v_owed - v_have - v_i;
    if v_market and v_left > 0 then
      if v_why is null then
        raise exception 'v4.58: the unused-pick fill stopped for % with no reason recorded', v_team.code;
      end if;
      perform public.notify_commissioners(null, 'flag',
        case when v_left = 1 then 'Unused draft pick lapsed' else 'Unused draft picks lapsed' end,
        coalesce(v_team.name, v_team.code) || ' (' || v_team.code || ') did not receive a player for ' ||
        case when v_left = 1 then 'a draft pick' else v_left || ' draft picks' end || ' it did not use, because ' ||
        case v_why
          when 'full' then 'its active roster was already full (' || public.pro_roster_count(p_season, v_team.id) || ' of ' ||
                           (public.season_rules(p_season)->>'roster_max') || ' players)'
          when 'cap' then 'a league-minimum salary of $750K would carry it over the salary cap'
          else 'no undrafted player was left who fits its roster and keeps it able to reach the minimums of three forwards, two defensemen and one goaltender' end ||
        '. The fill after the draft runs once, so ' ||
        case when v_left = 1 then 'the pick lapses and no player is placed for it later. The club fills the spot'
             else 'the picks lapse and no player is placed for them later. The club fills the spots' end ||
        ' by a waiver claim or at Saturday bidding.',
        'preseason', null);
    end if;
    v_why := null;
  end loop;$b$),
(11, 'public._place_for_unused_picks(uuid,integer)',
 $a$  insert into public.app_config (key, value) values ('rl_unused-pick-cap', array_to_string(v_capped, ','))
    on conflict (key) do update set value = excluded.value;$a$,
 $b$  insert into public.app_config (key, value) values ('rl_unused-pick-cap', array_to_string(v_capped, ','))
    on conflict (key) do update set value = excluded.value;
  /* v4.58 (D-FILL): the market fill has run, and never runs again this season (the lock above is held until commit, so
     a second run waits and then finds this mark) */
  if v_market then
    insert into public.app_config (key, value) values (v_done, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  end if;$b$),
(12, 'public.auto_assign_latecomers(boolean)',
 $a$  v_after := (exists (select 1 from public.draft_state ds$a$,
 $b$  /* v4.58 (commissioner, 2026-11-23: no latecomer or automatic placement in Season 2): a market season places nobody
     here; a late sign-up joins the training camp pool. The contract return above is a contract right, not a placement,
     and still runs (no contract reaches Season 2). The office's button is told so instead of reading zero. */
  if public.market_on(v_season.id) then
    if p_force then
      raise exception 'There is no automatic placement this season. Late sign-ups join the training camp pool, and clubs add players by a waiver claim or at Saturday bidding.'
        using errcode = 'check_violation';
    end if;
    return 0;
  end if;
  v_after := (exists (select 1 from public.draft_state ds$b$),
(13, 'public.trg_autoassign_new_reg()',
 $a$  if v_season.starts_at is not null and now() >= v_season.starts_at$a$,
 $b$  /* v4.58 (commissioner, 2026-11-23: no latecomer or automatic placement in Season 2): in a market season a late
     sign-up joins the training camp pool and is placed by nobody */
  if public.market_on(v_season.id) then return new; end if;
  if v_season.starts_at is not null and now() >= v_season.starts_at$b$),
(14, 'public.preseason_random_assign()',
 $a$  if v_season.id is null then raise exception 'No season is open.'; end if;$a$,
 $b$  if v_season.id is null then raise exception 'No season is open.'; end if;
  /* v4.58 (commissioner, 2026-11-23: no depth, latecomer or automatic placement in Season 2): the basic-format refusal
     below promises depth placement after the draft, which a market season never makes */
  if public.market_on(v_season.id) then
    raise exception 'There is no automatic placement this season. Everyone registered by the cutoff enters the draft; anyone undrafted joins the training camp pool, and clubs add players by a waiver claim or at Saturday bidding.';
  end if;$b$),
(15, 'public.place_new_roster_spot()',
 $a$      if n_tc < public.camp_max(NEW.season_id) then NEW.squad := 'tc';
      else$a$,
 $b$      if n_tc < public.camp_max(NEW.season_id) then NEW.squad := 'tc';
      else
        /* v4.58: a market season has no club camps (camp_max 0), so the full roster is the whole answer */
        if public.market_on(NEW.season_id) then
          raise exception 'The active roster is full (% of % players). This season has no club training camps, so waive a player first.', n_all, v_max
            using errcode = 'check_violation';
        end if;$b$),
(16, 'public.guard_squad_move()',
 $a$  /* v3.40: the weekly roster movement freeze (Rule 2.1).$a$,
 $b$  /* v4.58: a market season has no club camps (camp_max 0); say so before the freeze or the camp count does */
  if NEW.squad = 'tc' and public.market_on(NEW.season_id) then
    raise exception 'This season has no club training camps. Put the player on waivers instead.'
      using errcode = 'check_violation';
  end if;
  /* v3.40: the weekly roster movement freeze (Rule 2.1).$b$),
(17, 'public.check_roster_structure()',
 $a$  if v_cnt > v_cap or (f + d + g) > v_max then
    raise exception 'Rule 2.1: the active roster holds at most$a$,
 $b$  if v_cnt > v_cap or (f + d + g) > v_max then
    /* v4.58: a market season has no position maximums (every group's quota is roster_max) and no camps, so the total
       is what binds. Each count takes its own singular or plural word (never "1 goaltenders"). */
    if public.market_on(v_season) then
      raise exception 'The active roster holds at most % players, and this move would leave the club with % (%, % and %). This season has no club training camps, so waive a player first.',
        v_max, f + d + g,
        f || case when f = 1 then ' forward' else ' forwards' end,
        d || case when d = 1 then ' defenseman' else ' defensemen' end,
        g || case when g = 1 then ' goaltender' else ' goaltenders' end
        using errcode = 'check_violation';
    end if;
    raise exception 'Rule 2.1: the active roster holds at most$b$),
(18, 'public.swap_roster_squad(uuid,uuid)',
 $a$  perform public.mgmt_gate(a.team_id, 'roster');$a$,
 $b$  /* v4.58: a market season has no club camps, so there is never a camp player to swap. Refused before the approval
     gate, so a manager whose seat needs the Owner's approval is not sent to ask for a move that cannot happen. */
  if public.market_on(a.season_id) then
    raise exception 'This season has no club training camps, so there is no camp player to swap.';
  end if;
  perform public.mgmt_gate(a.team_id, 'roster');$b$),
(19, 'public.sign_free_agent(uuid,bigint,uuid)',
 $a$  perform public.mgmt_gate(v_team.id, 'freeagents');$a$,
 $b$  /* v4.58 (commissioner, 2026-11-23: no free agency in Season 2): fa_open is false in a market season. Say what
     replaces free agency, and say it before the approval gate, so a manager whose seat needs the Owner's approval is
     not sent to ask for a signing that cannot happen. */
  if public.market_on(public.current_season_id()) then
    raise exception 'There is no free agency this season. Players off a roster are in the training camp pool, and clubs add them by a waiver claim or at Saturday bidding.';
  end if;
  perform public.mgmt_gate(v_team.id, 'freeagents');$b$),
(20, 'public.offer_free_agent(uuid,bigint,integer,text,uuid)',
 $a$  perform public.mgmt_gate(v_team.id, 'freeagents');$a$,
 $b$  /* v4.58 (commissioner, 2026-11-23: no free agency in Season 2): fa_open is false in a market season. Say what
     replaces free agency, and say it before the approval gate, so a manager whose seat needs the Owner's approval is
     not sent to ask for an offer that cannot happen. */
  if public.market_on(public.current_season_id()) then
    raise exception 'There is no free agency this season. Players off a roster are in the training camp pool, and clubs add them by a waiver claim or at Saturday bidding.';
  end if;
  perform public.mgmt_gate(v_team.id, 'freeagents');$b$),
(21, 'public.respond_offer(uuid,text,bigint,integer)',
 $a$      select * into v_season from public.seasons where number = o.start_season;
      if v_season.id is null then raise exception 'That season no longer exists.'; end if;$a$,
 $b$      select * into v_season from public.seasons where number = o.start_season;
      if v_season.id is null then raise exception 'That season no longer exists.'; end if;
      /* v4.58: accepting an open-market offer is a free-agent signing, and a market season has no free agency
         (fa_open closes making one; this closes taking one made before) */
      if public.market_on(v_season.id) then
        raise exception 'There is no free agency this season, so this offer can no longer be accepted. Players off a roster are in the training camp pool, and clubs add them by a waiver claim or at Saturday bidding.';
      end if;$b$),
(22, 'public.grant_cap_exception(uuid,uuid,text)',
 $a$                else public.weekly_cap(g.season_id, v_squad, v_pos, g.stage) end;$a$,
 $b$                else public.weekly_cap(g.season_id, v_squad, v_pos, g.stage) end;
  /* v4.58: a null limit is no limit (a market season has no weekly game limits), so there is nothing to excuse.
     Without this the comparison below fell through and the notices concatenated to null. */
  if v_cap is null then
    raise exception '% has no game limit to excuse this season, so no exception is needed.', v_name using errcode = '22023';
  end if;$b$),
(23, 'public.lineup_camp_warnings(uuid,uuid)',
 $a$            < public.weekly_cap(v_g.season_id, 'pro', pos_group(rs.position), v_g.stage)$a$,
 $b$            < coalesce(public.weekly_cap(v_g.season_id, 'pro', pos_group(rs.position), v_g.stage), 2147483647)   /* v4.58: a null limit is no limit */$b$),
(24, 'public._club_batch_notices(uuid,text,timestamptz,text,text,text)',
 $a$    perform public.club_notify(rr.team_id, p_kind, p_title || ' {emdash} ' || rr.n || ' player' || case when rr.n = 1 then '' else 's' end,$a$,
 $b$    perform public.club_notify(rr.team_id, p_kind, p_title || ': ' || rr.n || ' player' || case when rr.n = 1 then '' else 's' end,   /* v4.58: a colon, not a spaced dash (writing rules) */$b$);

do $patch$
declare f text; r record; v_def text; v_a text; n int; v_fns int := 0;
begin
  for f in select fn from _s2guards_patch group by fn order by min(ord) loop
    v_def := pg_get_functiondef(f::regprocedure);
    for r in select * from _s2guards_patch where fn = f order by ord loop
      /* an anchor that quotes a live em dash spells it {emdash}, so this record carries none (the writing rules) */
      v_a := replace(r.a, '{emdash}', chr(8212));
      n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
      if n <> 1 then raise exception 'v4.58: % anchor % found % times', f, r.ord, n; end if;
      v_def := replace(v_def, v_a, r.b);
    end loop;
    execute v_def;
    v_fns := v_fns + 1;
  end loop;
  if v_fns <> 18 then raise exception 'v4.58: patched % functions, expected 18', v_fns; end if;
end $patch$;

-- 11. the market's roster origins. The old list is asserted first, so a change made elsewhere is not silently dropped
do $origin$
begin
  if (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.roster_spots'::regclass and c.conname = 'roster_spots_origin_check')
     is distinct from $o$CHECK ((origin = ANY (ARRAY['assigned'::text, 'preseason_random'::text, 'draft'::text, 'free_agency'::text, 'rookie_random'::text, 'latecomer_random'::text, 'contract'::text, 'postdraft_random'::text, 'depth_random'::text])))$o$ then
    raise exception 'v4.58: roster_spots_origin_check is not the definition this record was written against';
  end if;
end $origin$;
alter table public.roster_spots drop constraint roster_spots_origin_check,
  add constraint roster_spots_origin_check check (origin = any (array['assigned', 'preseason_random', 'draft', 'free_agency',
    'rookie_random', 'latecomer_random', 'contract', 'postdraft_random', 'depth_random',
    'waiver_claim', 'market_bid', 'market_placed']));

-- 4. Season 2's settings (commissioner, 2026-11-23: cap $30M, "10 round draft")
update public.seasons set salary_cap = 30000000, draft_rounds = 10 where number = 2 and status = 'upcoming';

-- self-checks
do $chk$
declare r record; v_def text; s1 record; s2 record; v_r jsonb; v_sum bigint; t record; g jsonb; v_n int; v_con text;
begin
  for r in select * from _s2guards_patch order by ord loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.b in v_def) = 0 then raise exception 'v4.58 check: % lacks the new text of row %', r.fn, r.ord; end if;
  end loop;
  select * into s1 from public.seasons where number = 1;
  select * into s2 from public.seasons where number = 2;
  /* Season 1's rules as production returned them on 2026-11-23, before this change */
  if public.season_rules(s1.id) is distinct from '{"flex": null, "lines": null, "quota": {"D": 5, "F": 7, "G": 3}, "weeks": 6, "format": "basic", "rights": false, "camp_max": 10, "cap_camp": 3, "fa_window": false, "preseason": false, "cap_goalie": 6, "cap_skater": 6, "extensions": false, "roster_max": 15, "salary_cap": 50000000, "series_cap": 4, "draft_snake": true, "pick_trades": false, "draft_rounds": 12, "min_service_gp": 0, "playoff_min_gp": 14, "playoff_best_of": 7, "playoff_per_div": 3, "max_contract_years": 1, "trade_deadline_week": 4}'::jsonb then
    raise exception 'v4.58 check: season_rules(Season 1) changed: %', public.season_rules(s1.id);
  end if;
  if public.market_on(s1.id) or not public.market_on(s2.id) then
    raise exception 'v4.58 check: market_on is % for Season 1 and % for Season 2', public.market_on(s1.id), public.market_on(s2.id);
  end if;
  if s2.id is null or s2.salary_cap <> 30000000 or s2.draft_rounds <> 10 or s2.roster_max <> 12 then
    raise exception 'v4.58 check: Season 2 is cap % rounds % roster %', s2.salary_cap, s2.draft_rounds, s2.roster_max;
  end if;
  v_r := public.season_rules(s2.id);
  if v_r->'quota_min' is distinct from '{"F":3,"D":2,"G":1}'::jsonb or v_r->'quota' is distinct from '{"F":12,"D":12,"G":12}'::jsonb
     or v_r->'camp_max' is distinct from '0'::jsonb or v_r->'market' is distinct from 'true'::jsonb
     or v_r->'cap_skater' is distinct from 'null'::jsonb or v_r->'cap_goalie' is distinct from 'null'::jsonb or v_r->'cap_camp' is distinct from 'null'::jsonb
     or v_r->'mk' is distinct from '{"bid_open":750000,"bid_step":250000,"lot_seconds":300,"waiver_hours":24,"bid_gp":6,"opens":"21:00","new_until":"22:00"}'::jsonb
     or v_r->'draft_rounds' is distinct from '10'::jsonb or v_r->'roster_max' is distinct from '12'::jsonb then
    raise exception 'v4.58 check: season_rules(Season 2) is %', v_r;
  end if;
  if public.weekly_cap(s2.id, 'pro', 'C', 'regular') is not null or public.weekly_cap(s2.id, 'pro', 'G', 'regular') is not null
     or public.series_cap(s2.id, 'pro', 'C') is distinct from 4 or public.camp_max(s2.id) is distinct from 0 then
    raise exception 'v4.58 check: Season 2 limits are weekly % series % camp %', public.weekly_cap(s2.id, 'pro', 'C', 'regular'), public.series_cap(s2.id, 'pro', 'C'), public.camp_max(s2.id);
  end if;
  if exists (select 1 from public.draft_picks where season_number = 2) then
    raise exception 'v4.58 check: a Season 2 draft board already exists and was built to the old round count';
  end if;
  select sum(public.draft_pick_salary(2, x)) into v_sum from generate_series(1, 10) x;
  if v_sum <> 18750000 or public.draft_pick_salary(2, 1) <> 3000000 or public.draft_pick_salary(2, 10) <> 750000 then
    raise exception 'v4.58 check: Season 2 picks pay % in all, % to %', v_sum, public.draft_pick_salary(2, 1), public.draft_pick_salary(2, 10);
  end if;
  select sum(public.draft_pick_salary(1, x)) into v_sum from generate_series(1, 12) x;
  if v_sum <> 25500000 or public.draft_pick_salary(1, 1) <> 3500000 then
    raise exception 'v4.58 check: Season 1 pick pay moved: % in all', v_sum;
  end if;
  if public.fa_open(s2.id) or not public.fa_open(s1.id) then
    raise exception 'v4.58 check: fa_open is % for Season 1 and % for Season 2', public.fa_open(s1.id), public.fa_open(s2.id);
  end if;
  select pg_get_constraintdef(c.oid) into v_con from pg_constraint c where c.conrelid = 'public.roster_spots'::regclass and c.conname = 'roster_spots_origin_check';
  select count(*) into v_n from unnest(array['assigned','preseason_random','draft','free_agency','rookie_random','latecomer_random','contract',
                                             'postdraft_random','depth_random','waiver_claim','market_bid','market_placed']) o
   where position('''' || o || '''::text' in v_con) > 0;
  if v_n <> 12 then raise exception 'v4.58 check: the origin check holds % of the 12 origins: %', v_n, v_con; end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.market_on(uuid)'::regprocedure and not p.prosecdef and p.provolatile = 's'
                   and p.proconfig = array['search_path=""'])
     or not has_function_privilege('anon', 'public.market_on(uuid)', 'execute') or not has_function_privilege('authenticated', 'public.market_on(uuid)', 'execute') then
    raise exception 'v4.58 check: market_on is not a stable invoker gate helper that anon and authenticated may call';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.roster_min_gap(uuid,uuid,text,uuid)'::regprocedure and p.prosecdef and p.provolatile = 's'
                   and p.proconfig = array['search_path=""'])
     or has_function_privilege('anon', 'public.roster_min_gap(uuid,uuid,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.roster_min_gap(uuid,uuid,text,uuid)', 'execute') then
    raise exception 'v4.58 check: roster_min_gap is not a stable definer with no client grant';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public._unused_pick_fills(uuid,uuid)'::regprocedure and p.prosecdef and p.provolatile = 's'
                   and p.proconfig = array['search_path=""'])
     or has_function_privilege('anon', 'public._unused_pick_fills(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._unused_pick_fills(uuid,uuid)', 'execute') then
    raise exception 'v4.58 check: _unused_pick_fills is not a stable definer with no client grant';
  end if;
  if exists (select 1 from public.app_config c where c.key = 'postdraft_done_' || s2.id::text) then
    raise exception 'v4.58 check: Season 2 already records a post-draft run, so its unused-pick fill would never run';
  end if;
  /* the one 3/2/1 definition agrees with the canonical active-roster count on every club: on Season 2 (empty at apply
     time) and on Season 1, whose real rosters exercise the count; and no club has a Season 2 fill yet */
  for t in select id from public.teams loop
    g := public.roster_min_gap(s2.id, t.id);
    if (g->>'short')::int <> (g->>'F')::int + (g->>'D')::int + (g->>'G')::int
       or (g->>'open')::int <> s2.roster_max - public.pro_roster_count(s2.id, t.id)
       or public._unused_pick_fills(s2.id, t.id) <> 0 then
      raise exception 'v4.58 check: roster_min_gap(Season 2, %) is %, fills %', t.id, g, public._unused_pick_fills(s2.id, t.id);
    end if;
    g := public.roster_min_gap(s1.id, t.id);
    if (g->>'short')::int <> 0
       or (g->>'open')::int <> (public.season_rules(s1.id)->>'roster_max')::int - public.pro_roster_count(s1.id, t.id) then
      raise exception 'v4.58 check: roster_min_gap(Season 1, %) is % against % counted', t.id, g, public.pro_roster_count(s1.id, t.id);
    end if;
  end loop;
end $chk$;



-- ===== the cases (the record above has been applied inside this transaction; its self-checks have passed) =====
-- Deferred roster checks fire at each statement from here on, so a shape violation cannot hide until commit.
set constraints all immediate;

do $rh$
declare
  s1 uuid; s2 uuid; v_comm uuid; t uuid[]; fs uuid[]; ds uuid[]; gs uuid[]; v_full uuid[];
  v_late uuid; v_late_reg uuid; v_any_reg uuid; v_n int; v_cnt int; v_g jsonb; v_r jsonb;
  v_spot uuid; v_fill uuid; v_fill_team uuid; v_dry_team uuid; v_w uuid; v_c uuid; v_c_at timestamptz;
  v_t3f1 uuid; v_t3f2 uuid; v_t4f1 uuid; v_game uuid; v_offer uuid;
  s2row public.seasons;
begin
  select id into s1 from public.seasons where number = 1;
  select id into s2 from public.seasons where number = 2;
  select p.id into v_comm from public.profiles p where p.role = 'commissioner' and not public.is_suspended(p.id) order by p.id limit 1;
  select array_agg(id order by code) into t from public.teams;
  if coalesce(array_length(t, 1), 0) < 6 or v_comm is null then
    raise exception 'rehearsal setup: % clubs, commissioner %', array_length(t, 1), v_comm;
  end if;
  /* every case builds its own Season 2 rosters, so this file runs only on an empty Season 2: before the Dec 5 seating
     (main-session order: this record ships with the waive hold and db-draft's record, before any seat) */
  if exists (select 1 from public.roster_spots where season_id = s2)
     or exists (select 1 from public.teams tm where coalesce(tm.owner_profile_id, tm.gm_profile_id, tm.agm_profile_id) is not null) then
    raise exception 'rehearsal setup: Season 2 already has roster spots or a club has a seat holder; this rehearsal runs only before the Dec 5 seating';
  end if;
  /* The commissioner's rollover, public.start_next_season(Season 2), has not run on 2026-11-23 (129 Season 1 player
     contracts still active, held by 60 of the 87 Season 2 sign-ups); it runs before any Season 2 seat (main-session
     decision D-ROLLOVER). Until it does, a member's active Season 1 contract makes contracts_one_active refuse their
     Season 2 roster insert. Model it here, under a commissioner's claims, only while it is still owed, so this file also
     passes after the real rollover. Contracts are never expired by hand. */
  if exists (select 1 from public.contracts c where c.status in ('active', 'signed') and not coalesce(c.is_manager, false) and c.start_season < 2) then
    perform set_config('request.jwt.claims', json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
    perform public.start_next_season(s2);
    perform set_config('request.jwt.claims', '', true);
    if exists (select 1 from public.contracts c where c.status in ('active', 'signed') and not coalesce(c.is_manager, false) and c.start_season < 2) then
      raise exception 'rehearsal setup: the rollover left Season 1 player contracts active';
    end if;
  end if;

  -- R1 the Season 2 rules (the self-check proved the full literal; restated here as the brief's list)
  v_r := public.season_rules(s2);
  if not public.market_on(s2) or v_r->'quota_min' is distinct from '{"F":3,"D":2,"G":1}'::jsonb or v_r->'camp_max' is distinct from '0'::jsonb
     or v_r->'cap_skater' is distinct from 'null'::jsonb or v_r->'cap_goalie' is distinct from 'null'::jsonb or v_r->'cap_camp' is distinct from 'null'::jsonb then
    raise exception 'R1 FAILED: season_rules(Season 2) is %', v_r;
  end if;

  -- R2 draft pick pay sized for ten rounds: $3.00M down to $0.75M, $18.75M in all
  if (select sum(public.draft_pick_salary(2, x)) from generate_series(1, 10) x) <> 18750000
     or public.draft_pick_salary(2, 1) <> 3000000 or public.draft_pick_salary(2, 2) <> 2750000 or public.draft_pick_salary(2, 10) <> 750000 then
    raise exception 'R2 FAILED: Season 2 picks pay % to %', public.draft_pick_salary(2, 1), public.draft_pick_salary(2, 10);
  end if;

  -- R3 fa_open stays false once the draft is complete (the old basic path opened signings at that moment)
  insert into public.draft_state (season_number, status, updated_at) values (2, 'complete', now() - interval '1 hour');
  if public.fa_open(s2) then raise exception 'R3 FAILED: fa_open(Season 2) is true after the draft'; end if;

  -- R4 a late Season 2 sign-up is placed by nobody: not the sign-up trigger, not the latecomer sweep.
  update public.seasons set starts_at = now() - interval '1 minute', signup_deadline_at = now() - interval '1 minute',
         registration_deadline = now() - interval '1 minute' where id = s2;
  /* a member the OLD trigger branch would place: in the Discord, not suspended or banned, not signed up, no seat, never
     drafted in any season (the old branch and the old sweep skip anyone with a draft_picks row) and no contract covering
     Season 2 (the contract-return branch runs first) */
  select p.id into v_late from public.profiles p
   where coalesce(p.in_guild, false) and p.role is distinct from 'commissioner'
     and not public.is_suspended(p.id) and not public.is_banned(p.id)
     and not exists (select 1 from public.season_registrations sr where sr.season_id = s2 and sr.profile_id = p.id)
     and not exists (select 1 from public.teams tm where p.id in (tm.owner_profile_id, tm.gm_profile_id, tm.agm_profile_id))
     and not exists (select 1 from public.draft_picks dp where dp.player_id = p.id)
     and not exists (select 1 from public.contracts c where c.profile_id = p.id and c.status in ('active', 'signed')
                       and not coalesce(c.is_manager, false) and c.team_id is not null and c.start_season <= 2 and c.end_season >= 2)
   order by p.id limit 1;
  if v_late is null then raise exception 'rehearsal setup: no member to sign up late'; end if;
  begin
    /* camp_max 0 (this record) already starves the old path on its own: a late sign-up in a basic season was placed as
       depth in training camp, and Season 2 has no camp. So that only the market gate can be what stops the trigger and
       the sweep, Season 2 is lent three camp places inside this block. Its closing raise undoes the loan and everything
       done below it. */
    create or replace function public.camp_max(p_season uuid) returns integer language sql stable set search_path to 'public'
      as $lend$ select 3 $lend$;
    select count(*) into v_cnt from public.notifications where title = 'Late sign-up not placed';
    perform set_config('request.jwt.claims', json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
    insert into public.season_registrations (season_id, profile_id, position) values (s2, v_late, 'C') returning id into v_late_reg;
    perform set_config('request.jwt.claims', '', true);
    select * into s2row from public.seasons where id = s2;
    if not (now() >= s2row.starts_at and (select created_at from public.season_registrations where id = v_late_reg) > s2row.signup_deadline_at
            and not exists (select 1 from public.draft_picks dp where dp.player_id = v_late)
            and not exists (select 1 from public.contracts c where c.profile_id = v_late and c.status in ('active', 'signed')
                              and not coalesce(c.is_manager, false) and c.team_id is not null
                              and c.start_season <= s2row.number and c.end_season >= s2row.number)
            and not public.placement_closed(s2) and not public.is_suspended(v_late) and not public.is_banned(v_late)
            and public.camp_max(s2) = 3) then
      raise exception 'R4 setup: the old placement branch would not have run either';
    end if;
    if exists (select 1 from public.roster_spots where season_id = s2 and profile_id = v_late)
       or (select count(*) from public.notifications where title = 'Late sign-up not placed') <> v_cnt then
      raise exception 'R4 FAILED: the sign-up trigger placed a late Season 2 registrant, or tried to';
    end if;
    v_n := public.auto_assign_latecomers();
    if v_n <> 0 or exists (select 1 from public.roster_spots where season_id = s2 and profile_id = v_late) then
      raise exception 'R4 FAILED: auto_assign_latecomers placed % player(s)', v_n;
    end if;
    /* the control: the old placement path, asked directly, seats this same sign-up in the lent camp */
    if public._assign_reg_random(v_late_reg, 'latecomer_random', false, 'fill')
       and exists (select 1 from public.roster_spots where season_id = s2 and profile_id = v_late and origin = 'depth_random') then
      raise exception 'R4 control: the old path seats this sign-up, so only the market gate kept the trigger and the sweep from it (undone with this block)';
    end if;
    raise exception 'R4 FAILED: the old placement path could not seat the late sign-up either, so R4 would prove nothing';
  exception when others then
    if sqlerrm not like 'R4 control: %' then raise; end if;
  end;
  begin
    perform public.auto_assign_latecomers(true);
    raise exception 'R4 FAILED: the forced latecomer run did not refuse';
  exception when others then
    if sqlerrm not like 'There is no automatic placement this season.%' then raise; end if;
  end;

  -- R5 the unused-pick fill (D-FILL): ONE run after the draft fills what it can; the rest lapses, with its true reason.
  -- t[1] and t[6] each skipped a pick and only one undrafted player is left; t[5] skipped a pick with a full roster.
  select sr.profile_id into v_w from public.season_registrations sr
   where sr.season_id = s2 and sr.status <> 'declined' order by sr.created_at, sr.profile_id limit 1;
  select sr.profile_id, sr.created_at into v_c, v_c_at from public.season_registrations sr
   where sr.season_id = s2 and sr.status <> 'declined' order by sr.created_at, sr.profile_id offset 1 limit 1;
  if (select count(*) from public.season_registrations sr where sr.season_id = s2 and sr.status <> 'declined' and sr.created_at <= v_c_at) <> 2
     or exists (select 1 from public.profiles p where p.id in (v_w, v_c)
                  and (p.role = 'commissioner' or public.is_suspended(p.id) or public.is_banned(p.id))) then
    raise exception 'rehearsal setup: the two earliest Season 2 sign-ups cannot serve as the fill pool';
  end if;
  /* the sign-up cutoff moves to the second sign-up, so exactly those two are draft-eligible (is_draft_eligible) */
  update public.seasons set signup_deadline_at = v_c_at where id = s2;
  /* v_w was on a club and was let go in the minutes before the fill (the market opens when the draft completes): a
     roster history but no spot. The fill leaves them to the waiver and the bidding, so v_c is the only player it may take. */
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
    values (s2, t[2], v_w, 1, 'C', 750000, 'draft') returning id into v_spot;
  perform set_config('app.roster_reason', 'waived', true);
  delete from public.roster_spots where id = v_spot;
  perform set_config('app.roster_reason', '', true);
  /* t[5] holds twelve, so its skipped pick finds the roster full */
  select array_agg(x.profile_id) into v_full from (
    select sr.profile_id from public.season_registrations sr join public.profiles p on p.id = sr.profile_id
     where sr.season_id = s2 and sr.status <> 'declined' and sr.profile_id not in (v_w, v_c) and p.role is distinct from 'commissioner'
       and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id)
     order by sr.created_at desc, sr.profile_id limit 12) x;
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
    select s2, t[5], sr.profile_id, row_number() over (order by sr.profile_id), coalesce(sr.position, 'C'), 750000, 'draft'
      from public.season_registrations sr where sr.season_id = s2 and sr.profile_id = any(v_full);
  if public.pro_roster_count(s2, t[5]) <> 12 then raise exception 'R5 setup: t5 holds %', public.pro_roster_count(s2, t[5]); end if;
  insert into public.draft_picks (season_number, round, original_team_id, current_team_id, used, skipped, overall_pick) values
    (2, 10, t[1], t[1], false, true, 73), (2, 10, t[5], t[5], false, true, 77), (2, 10, t[6], t[6], false, true, 78);
  v_n := public.distribute_unproven_rookies();
  select rs.id, rs.profile_id, rs.team_id into v_spot, v_fill, v_fill_team from public.roster_spots rs
   where rs.season_id = s2 and rs.origin = 'postdraft_random' and rs.salary = 750000 and rs.squad = 'pro';
  if v_n <> 1 or v_fill is distinct from v_c or v_fill_team is null or not (v_fill_team = any(array[t[1], t[6]]))
     or (select count(*) from public.roster_spots where season_id = s2 and origin = 'postdraft_random') <> 1 then
    raise exception 'R5 FAILED: % placed; the fill is % on % (expected the one undrafted player, on t1 or t6, active roster, $750K)', v_n, v_fill, v_fill_team;
  end if;
  v_dry_team := case when v_fill_team = t[1] then t[6] else t[1] end;
  if exists (select 1 from public.roster_spots where season_id = s2 and (origin = 'depth_random' or profile_id = v_w)) then
    raise exception 'R5 FAILED: a depth placement was made, or the player the club let go was filled around the waiver';
  end if;
  if not exists (select 1 from public.club_notices where team_id = v_fill_team and title = 'Unused draft picks filled: 1 player') then
    raise exception 'R5 FAILED: the club was not told about its fill, or the title still carries a dash';
  end if;
  if (select count(distinct n.body) from public.notifications n where n.title like 'Unused draft pick% lapsed') <> 2
     or not exists (select 1 from public.notifications n where n.title = 'Unused draft pick lapsed'
                      and n.body like '%(' || (select tm.code from public.teams tm where tm.id = t[5]) || ') did not receive a player for a draft pick it did not use, because its active roster was already full (12 of 12 players). The fill after the draft runs once, so the pick lapses%')
     or not exists (select 1 from public.notifications n where n.title = 'Unused draft pick lapsed'
                      and n.body like '%(' || (select tm.code from public.teams tm where tm.id = v_dry_team) || ') did not receive a player for a draft pick it did not use, because no undrafted player was left who fits its roster%') then
    raise exception 'R5 FAILED: the lapsed picks were not reported once per club with the true reason';
  end if;
  if not exists (select 1 from public.app_config c where c.key = 'postdraft_done_' || s2::text) or public._unused_pick_fills(s2, v_fill_team) <> 1 then
    raise exception 'R5 FAILED: the run was not recorded, or the fill is not counted';
  end if;
  -- the club lets its fill go and the full club opens a spot: the fill has run, so nothing is placed again and nobody is told twice
  select count(*) into v_cnt from public.notifications where title like 'Unused draft pick% lapsed';
  perform set_config('app.roster_reason', 'waived', true);
  delete from public.roster_spots where id = v_spot;
  delete from public.roster_spots where season_id = s2 and team_id = t[5] and profile_id = v_full[1];
  perform set_config('app.roster_reason', '', true);
  if public.distribute_unproven_rookies() <> 0
     or exists (select 1 from public.roster_spots where season_id = s2 and origin = 'postdraft_random')
     or (select count(*) from public.notifications where title like 'Unused draft pick% lapsed') <> v_cnt then
    raise exception 'R5 FAILED: a lapsed pick or a waived fill was filled on a later run, or a lapse was reported twice';
  end if;
  if public._unused_pick_fills(s2, v_fill_team) <> 1 then
    raise exception 'R5 FAILED: the fill the club let go no longer counts as filling its pick';
  end if;
  begin
    perform public.distribute_unproven_rookies(true);
    raise exception 'R5 FAILED: the forced run by the office filled again instead of refusing';
  exception when others then
    if sqlerrm not like 'The fill for unused draft picks already ran after the draft, and it runs once.%' then raise; end if;
  end;
  update public.seasons set signup_deadline_at = now() - interval '1 minute' where id = s2;

  /* pools, drawn after R5 so no case below meets its rows: Season 2 registrants with no roster spot, not suspended or
     banned, and not commissioners (the office keeps its own seat rules out of these cases) */
  select array_agg(sr.profile_id order by sr.created_at, sr.profile_id) into fs from public.season_registrations sr join public.profiles p on p.id = sr.profile_id
   where sr.season_id = s2 and sr.status <> 'declined' and public.pos_group(sr.position) = 'F' and p.role is distinct from 'commissioner'
     and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id)
     and not exists (select 1 from public.roster_spots rs where rs.season_id = s2 and rs.profile_id = sr.profile_id);
  select array_agg(sr.profile_id order by sr.created_at, sr.profile_id) into ds from public.season_registrations sr join public.profiles p on p.id = sr.profile_id
   where sr.season_id = s2 and sr.status <> 'declined' and public.pos_group(sr.position) = 'D' and p.role is distinct from 'commissioner'
     and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id)
     and not exists (select 1 from public.roster_spots rs where rs.season_id = s2 and rs.profile_id = sr.profile_id);
  select array_agg(sr.profile_id order by sr.created_at, sr.profile_id) into gs from public.season_registrations sr join public.profiles p on p.id = sr.profile_id
   where sr.season_id = s2 and sr.status <> 'declined' and public.pos_group(sr.position) = 'G' and p.role is distinct from 'commissioner'
     and not public.is_suspended(sr.profile_id) and not public.is_banned(sr.profile_id)
     and not exists (select 1 from public.roster_spots rs where rs.season_id = s2 and rs.profile_id = sr.profile_id);
  if coalesce(array_length(fs, 1), 0) < 16 or coalesce(array_length(ds, 1), 0) < 4 or coalesce(array_length(gs, 1), 0) < 1 then
    raise exception 'rehearsal setup: pools F % D % G %', array_length(fs, 1), array_length(ds, 1), array_length(gs, 1);
  end if;


  -- R6 roster_min_gap on synthetic rosters (t[2] empty; t[3] meets 3/2/1; t[4] is short a goalie).
  -- R7 rides along: t[3]'s three forwards carry the three new origins.
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin) values
    (s2, t[3], fs[1], 1, 'C', 750000, 'waiver_claim'), (s2, t[3], fs[2], 2, 'LW', 750000, 'market_bid'),
    (s2, t[3], fs[3], 3, 'RW', 750000, 'market_placed'), (s2, t[3], ds[1], 4, 'LD', 750000, 'draft'),
    (s2, t[3], ds[2], 5, 'RD', 750000, 'draft'), (s2, t[3], gs[1], 6, 'G', 750000, 'draft'),
    (s2, t[4], fs[4], 21, 'C', 750000, 'draft'), (s2, t[4], fs[5], 22, 'LW', 750000, 'draft'),
    (s2, t[4], fs[6], 23, 'RW', 750000, 'draft'), (s2, t[4], ds[3], 24, 'LD', 750000, 'draft'),
    (s2, t[4], ds[4], 25, 'RD', 750000, 'draft');
  select id into v_t3f1 from public.roster_spots where season_id = s2 and profile_id = fs[1];
  select id into v_t3f2 from public.roster_spots where season_id = s2 and profile_id = fs[2];
  select id into v_t4f1 from public.roster_spots where season_id = s2 and profile_id = fs[4];
  if (select count(*) from public.roster_spots where season_id = s2 and origin in ('waiver_claim', 'market_bid', 'market_placed')) <> 3 then
    raise exception 'R7 FAILED: the three market origins were not all stored';
  end if;
  v_g := public.roster_min_gap(s2, t[2]);
  if v_g is distinct from '{"F":3,"D":2,"G":1,"short":6,"open":12}'::jsonb then raise exception 'R6 FAILED: empty club %', v_g; end if;
  v_g := public.roster_min_gap(s2, t[3]);
  if v_g is distinct from '{"F":0,"D":0,"G":0,"short":0,"open":6}'::jsonb then raise exception 'R6 FAILED: minimums met %', v_g; end if;
  v_g := public.roster_min_gap(s2, t[4]);
  if v_g is distinct from '{"F":0,"D":0,"G":1,"short":1,"open":7}'::jsonb then raise exception 'R6 FAILED: short a goalie %', v_g; end if;
  v_g := public.roster_min_gap(s2, t[4], 'G');
  if v_g is distinct from '{"F":0,"D":0,"G":0,"short":0,"open":6}'::jsonb then raise exception 'R6 FAILED: short a goalie, plus a goalie %', v_g; end if;
  v_g := public.roster_min_gap(s2, t[4], 'F');
  if v_g is distinct from '{"F":0,"D":0,"G":1,"short":1,"open":6}'::jsonb then raise exception 'R6 FAILED: short a goalie, plus a forward %', v_g; end if;
  v_g := public.roster_min_gap(s2, t[4], null, ds[3]);
  if v_g is distinct from '{"F":0,"D":1,"G":1,"short":2,"open":8}'::jsonb then raise exception 'R6 FAILED: short a goalie, minus a defenseman %', v_g; end if;
  v_g := public.roster_min_gap(s2, t[3], 'F', gs[1]);
  if v_g is distinct from '{"F":0,"D":0,"G":1,"short":1,"open":6}'::jsonb then raise exception 'R6 FAILED: the goalie out, a forward in %', v_g; end if;
  v_g := public.roster_min_gap(s1, t[3]);
  if (v_g->>'short')::int <> 0 then raise exception 'R6 FAILED: Season 1 has no minimums but reports %', v_g; end if;
  begin
    perform public.roster_min_gap(s2, t[2], 'X');
    raise exception 'R6 FAILED: a bad group was accepted';
  exception when others then
    if sqlerrm not like 'roster_min_gap: p_plus_group is F, D or G%' then raise; end if;
  end;
  begin
    perform public.roster_min_gap(gen_random_uuid(), t[2]);
    raise exception 'R6 FAILED: a missing season was accepted';
  exception when others then
    if sqlerrm not like 'roster_min_gap: there is no season%' then raise; end if;
  end;
  if has_function_privilege('anon', 'public.roster_min_gap(uuid,uuid,text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.roster_min_gap(uuid,uuid,text,uuid)', 'execute') then
    raise exception 'R6 FAILED: a client role can call roster_min_gap';
  end if;

  -- R7 the origin check still refuses an origin it does not list
  begin
    insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
      values (s2, t[2], fs[16], 9, 'C', 750000, 'bogus');
    raise exception 'R7 FAILED: a bogus origin was accepted';
  exception when others then
    if sqlerrm not like '%roster_spots_origin_check%' then raise; end if;
  end;

  -- R8 market-season wording reaches the member
  begin   -- the squad trigger, directly
    update public.roster_spots set squad = 'tc' where id = v_t3f1;
    raise exception 'R8 FAILED: a send-down to camp went through';
  exception when others then
    if sqlerrm <> 'This season has no club training camps. Put the player on waivers instead.' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
  begin   -- set_roster_squad reaches the same one definition
    perform public.set_roster_squad(v_t3f1, 'tc');
    raise exception 'R8 FAILED: set_roster_squad sent a player to camp';
  exception when others then
    if sqlerrm <> 'This season has no club training camps. Put the player on waivers instead.' then raise; end if;
  end;
  begin
    perform public.swap_roster_squad(v_t3f1, v_t3f2);
    raise exception 'R8 FAILED: swap_roster_squad did not refuse';
  exception when others then
    if sqlerrm <> 'This season has no club training camps, so there is no camp player to swap.' then raise; end if;
  end;
  select sr.id into v_any_reg from public.season_registrations sr where sr.season_id = s2 and sr.profile_id = fs[14];
  begin
    perform public.sign_free_agent(v_any_reg, null, t[2]);
    raise exception 'R8 FAILED: sign_free_agent did not refuse';
  exception when others then
    if sqlerrm not like 'There is no free agency this season. Players off a roster are in the training camp pool%' then raise; end if;
  end;
  begin
    perform public.offer_free_agent(v_any_reg, 750000, 1, null, t[2]);
    raise exception 'R8 FAILED: offer_free_agent did not refuse';
  exception when others then
    if sqlerrm not like 'There is no free agency this season. Players off a roster are in the training camp pool%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into public.contract_offers (from_team_id, player_id, salary, years, start_season, immediate)
    values (t[2], fs[14], 750000, 1, 2, true) returning id into v_offer;
  perform set_config('request.jwt.claims', json_build_object('sub', fs[14], 'role', 'authenticated')::text, true);
  begin
    perform public.respond_offer(v_offer, 'accept', null, null);
    raise exception 'R8 FAILED: an open-market offer was accepted';
  exception when others then
    if sqlerrm not like 'There is no free agency this season, so this offer can no longer be accepted.%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  -- fill t[3] to twelve, then a thirteenth is refused by the placer with the market wording
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin) values
    (s2, t[3], fs[7], 7, 'C', 750000, 'draft'), (s2, t[3], fs[8], 8, 'LW', 750000, 'draft'),
    (s2, t[3], fs[9], 9, 'RW', 750000, 'draft'), (s2, t[3], fs[10], 10, 'C', 750000, 'draft'),
    (s2, t[3], fs[11], 11, 'LW', 750000, 'draft'), (s2, t[3], fs[12], 12, 'RW', 750000, 'draft');
  if public.pro_roster_count(s2, t[3]) <> 12 then raise exception 'R8 setup: t3 holds %', public.pro_roster_count(s2, t[3]); end if;
  begin
    insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
      values (s2, t[3], fs[13], 13, 'C', 750000, 'draft');
    raise exception 'R8 FAILED: a thirteenth player was placed';
  exception when others then
    if sqlerrm <> 'The active roster is full (12 of 12 players). This season has no club training camps, so waive a player first.' then raise; end if;
  end;
  begin   -- a move onto the full roster is refused by the shape check (immediate since the top of the cases)
    update public.roster_spots set team_id = t[3] where id = v_t4f1;
    raise exception 'R8 FAILED: a thirteenth player was moved onto a full roster';
  exception when others then
    if sqlerrm not like 'The active roster holds at most 12 players, and this move would leave the club with 13 (10 forwards, 2 defensemen and 1 goaltender).%' then raise; end if;
  end;

  -- R8b weekly-cap null-safety: no limit means nothing to excuse
  if public.weekly_cap(s2, 'pro', 'C', 'regular') is not null or public.series_cap(s2, 'pro', 'C') <> 4 then
    raise exception 'R8b FAILED: weekly % series %', public.weekly_cap(s2, 'pro', 'C', 'regular'), public.series_cap(s2, 'pro', 'C');
  end if;
  insert into public.games (season_id, home_team_id, away_team_id, week, scheduled_at, stage)
    values (s2, t[3], t[4], 1, now() + interval '2 days', 'regular') returning id into v_game;
  perform set_config('request.jwt.claims', json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
  begin
    perform public.grant_cap_exception(v_game, fs[2], 'rehearsal: Season 2 has no weekly game limit');
    raise exception 'R8b FAILED: an exception was granted to a limit that does not exist';
  exception when others then
    if sqlerrm not like '%has no game limit to excuse this season, so no exception is needed.' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  /* lineup_camp_warnings' null-cap line (patch row 23) is defensive only: it needs a dressed training-camp player, which a
     market season cannot have, so no case here can reach it */

  -- R9 Season 1 untouched (its season_rules literal is in the record's self-check)
  if public.market_on(s1) or not public.fa_open(s1) or public.draft_pick_salary(1, 1) <> 3500000 or public.draft_pick_salary(1, 12) <> 750000
     or public.camp_max(s1) <> 10 or public.weekly_cap(s1, 'pro', 'C', 'regular') <> 6 then
    raise exception 'R9 FAILED: Season 1 moved';
  end if;

  raise exception 'REHEARSAL OK: R1 rules R2 pick pay R3 fa_open R4 no late placement R5 one fill then lapse R6 roster_min_gap R7 origins R8 wording R8b no-limit R9 Season 1 unchanged';
end $rh$;
