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

/* REHEARSAL on production, 2026-11-24 (main session), sql/2026-11-24-s2-draft-night-guards-v458.rehearsal.sql, one
   transaction rolled back by its closing raise: REHEARSAL OK: R1 rules R2 pick pay R3 fa_open R4 no late placement R5 one
   fill then lapse R6 roster_min_gap R7 origins R8 wording R8b no-limit R9 Season 1 unchanged. (R4's positive control
   seats a late sign-up through the old path at a random club and missed once before passing; R4's gate assertions held
   on both runs.) The joint draft-night rehearsal (this record, the waive hold and the draft and front office record):
   REHEARSAL OK (joint draft night): S0 T7 T1 T2 T3 T4 T5 T6b T6. It needs an empty Season 2 (no roster
   spot, no seat holder), so it runs before the Dec 5 seating; it models the commissioner's rollover itself.
   APPLY: one apply_migration together with the Season 2 waive hold (db-waivers) and the Season 2 draft and front office
   record (db-draft), in that order, as their joint rehearsal runs them, so a failure in either rolls this one back too.
   This record lifts Season 2's position maximums to 12/12/12, and only db-draft's draft_fits puts the 3/2/1 minimums on
   a pick, so this record must never be live without it. Before generate_draft_board for Season 2 (Dec 5 runbook),
     select position('roster_min_gap' in pg_get_functiondef('public.draft_fits(uuid,uuid,uuid)'::regprocedure)) > 0
       and position('_unused_pick_fills' in pg_get_functiondef('public.draft_fits(uuid,uuid,uuid)'::regprocedure)) > 0;
   must return true. Applied 2026-11-24 as migration v458_s2_draft_night_guards, in one transaction with v458b_s2_waive_hold and
   v458c_s2_draft_front_office; then tools/sql/grant-audit.sql (zero rows).
   Version numbers: every v4.58 in this file, its rehearsal and its test takes this record's own number. No other
   record anchors on text this record writes; db-draft's records only check that market_on, roster_min_gap and
   _unused_pick_fills exist, by name. */
