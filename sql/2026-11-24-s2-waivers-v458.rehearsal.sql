-- Rehearsal for sql/2026-11-24-s2-waivers-v458.sql (market-engine 6, Part 1). The main session runs it on production as
-- ONE transaction that ends in an uncaught raise, so everything rolls back (CLAUDE.md, Database change protocol step 2).
-- Agents never run it. Requires the joint draft-night apply (db-guards, the waive hold, db-draft) to be live already.
--
-- Run this whole file as one execute_sql call. It carries the record's text byte for byte between the markers
-- (tools/s2-waivers-v458.test.cjs pins it). Before and after, outside the transaction, count net.http_request_queue and
-- discord_dms rows: both must be unchanged. pg_net is transactional and the bot only sees committed discord_dms rows.
--
-- The world, built inside the transaction from real Season 2 sign-ups (no names are written here): Season 2's draft
-- marked complete; four clubs (the first four by code), each with an Owner seated the ordinary way (teams update, so
-- ensure_manager_rostered gives the seat its roster spot):
--   A: Owner (F) + F1..F5, D1, D2, G1 (exactly 2 defensemen); F4 earns $3M.
--   B: Owner (F) + 2 F, 1 D, 1 G (room and cap to spare).
--   C: Owner (F) + 11 players (12 of 12).
--   D: Owner (F) + 3 F, 1 G whose salaries leave $1M of cap room.
-- First, the commissioner's Season 2 rollover (start_next_season) is modeled while it is still owed (see the world).
-- When: run it before the Sat Dec 5 seating (main session ruling, 2026-11-23). The world needs an empty Season 2 and
-- stops at its first check once an Owner or GM is seated.
-- Cases:
--   T1 a waiver without the not-inactive confirmation is refused.
--   T2 waiving A's D1 is refused: 1 defenseman, under the minimum of 2.
--   T3 an Owner cannot waive their own seat.
--   T4 A waives F4: the spot goes, an open waiver at $3M for 24 hours, waived_at stamped, the contract expired, a 'waive'
--      transaction, one DM row; guard_roster_waive and the delete triggers let it through.
--   T22 before the post-draft fill has run, B's claim on F4 is refused in plain words (main session, 2026-11-23).
--   T23 the real fill (_place_for_unused_picks) runs with one skipped pick owed to C (12 of 12, so it lapses): it takes C's
--       market lock and no other club's, tells the commissioners the pick lapsed, and writes the season's postdraft_done_
--       mark, which opens claims.
--   T5 A cannot claim F4 back.   T6 C (12 of 12) is refused for the spot.   T7 D is refused for the cap.
--   T8 B claims F4: roster spot 'waiver_claim' at $3M, a contract for this season only, the waiver claimed, the sign-up
--      assigned, a 'claim' transaction.   T9 D's claim after B's is told B already claimed.
--   T10 A waives F3; with its window moved into the past, market_tick clears it: 'clear' transaction, heartbeat stamped,
--      no failed result; F3 is in market_pool as source 'waivers' with box-score games only.
--   T11 a claim on the cleared waiver is refused.
--   T12 the v4.25 bar holds: a suspended player cannot be waived by the club.
--   T13 a commissioner waives F1 with no confirmation (the office is not bound by a club bar): by_office, no stamp.
--   T14 after the movement deadline (override 'locked'): a club waiver and a club claim are refused.
--   T15 RLS: anon reads waivers but not who acted, cannot write, cannot call market_claim; a member cannot read claimed_by.
--   T16 market_club_state: the club's own Owner sees leads, another club's Owner does not.
--   T17 market_pool: the claimed, the rostered and the open-waiver players are not in it.
--   T18 the office withdraws F1's sign-up during F1's open waiver: B's claim is refused in plain words.
--   T19 the commissioner waives F2, then bans them (ban_player, the real door): D's claim is refused the same way,
--       never past the ban.
--   T20 the commissioner waives B's F10, then places them on D by hand: A's claim gets the sentence, not a raw 23505.
--   T21 the tick voids all three at once (before their 24 hours), with the reason, and announces none of them: no
--       'clear' transaction, no pool post, no bell, no DM.
--   T10 also proves a private gp_credits row never becomes a public game in market_pool.
-- The world also needs Season 2 to have no draft board yet: T23 runs the real fill, which would fill every unused pick.

begin;

-- >>> record text: sql/2026-11-24-s2-waivers-v458.sql
-- v4.58 (2026-12-02): Season 2 waivers. In a market season a club's waiver is a 24-hour claim window, then the
-- training camp pool. Replaces the Season 2 waive hold (the waive-hold record, db-waivers, applied with the draft-night
-- records).
--
-- Rulings this builds (league law, quoted from the commissioner):
--   2026-11-02: "Rostered players can be sent down to the league training camps only after being placed on waivers. Any
--     team can pick up a player placed on waivers up to 24 hours after they have been waived, like real life. Their
--     salary cap and roster space needs to comply to be able to be waived."
--   2026-11-02: "Teams must not waive inactive players but should report them to league staff" (the ruling goes on to
--     name the discipline; the confirmation below says "inactive" only).
--   2026-11-02: "Only training camp players with at least 6 games played can be bid on at the saturday bidding events."
--   2026-11-23: the three waiver readings confirmed: the first valid claim wins at once; the waiving club cannot claim back;
--     the claiming club needs a roster spot and cap room. A cleared player goes to Saturday bidding, where the waiving club
--     may bid. Minimums 3 F / 2 D / 1 G ("do 3 forwards, 2 defensemen, and 1 goalie"), no maximums.
--   2026-11-23 (late night): "#free-agency becomes the training camp pool channel".
--
-- What changes (every Season 2 branch tests public.market_on(season); Season 1 paths are unchanged):
--   1. public.market_waivers (new): one row per waiver; the waiving club can never claim back (a table check). RLS on,
--      SELECT for everyone on every column except who acted (waived_by, claimed_by) and why a waiver was voided
--      (void_why), no client writes. A waiver ends 'claimed', 'cleared' (into the pool) or 'void' (the player left the
--      pool's reach while it ran: banned, placed on a roster by the office, or the sign-up withdrawn).
--   2. public.replacement_signings gains pos_group, alerted_at and lapsed_why (additive) for the Season 2 shortfall draws
--      of the minimums record; _market_min_breach reads pos_group already.
--   3. public.waive_player: DROP plus CREATE with p_not_inactive boolean default null (a new defaulted argument makes an
--      overload otherwise, the club_notify v3.11 trap), regranted to authenticated and service_role. The hold block comes
--      out; the market branch goes in just before the roster delete, so the existing checks (on the roster, the v4.25
--      suspended-player bar, minimum service) still run first. The Season 1 body is proved byte-identical.
--   4. public._market_waive and public._market_waive_check: the Season 2 waiver (draft complete, before the movement
--      deadline, the not-inactive confirmation, no seat holder, the 3/2/1 minimums through roster_min_gap), then the
--      delete under app.roster_reason 'waived' (guard_roster_waive, contract_on_waive, the archive and notify_roster_remove
--      run as they do today), the waiver row, the waived_at stamp, the 'waive' transaction and a DM.
--   5. public.market_claim(p_waiver, p_team): the first valid claim wins at once (club advisory lock, then the waiver row
--      FOR UPDATE, re-checked against clock_timestamp()); no claim-back; a spot and cap room counting the bids the club
--      leads; the club must still be able to reach the minimums. The claimed player keeps the waiver salary on a contract
--      to the end of the season (origin 'waiver_claim'). The player's state is re-checked at the claim
--      (_market_waiver_void_why: still signed up, on no roster, not banned), so no removal door needs a hook of its own.
--      A seat whose Owner approves its Free agents moves is told to ask the Owner: the first claim wins at once, so a
--      claim cannot wait in the approval queue. Claims open only once the post-draft fill for skipped picks has run (the
--      season's postdraft_done_ mark; main session, 2026-11-23), so a claim can never take the spot a skipped pick is
--      owed. That holds for the office too.
--   6. public.market_pool(p_season): the training camp pool. Games played come from box scores only (game_stats on final,
--      unvoided regular-season games), never regular_gp, whose private credits must not become public games or bid
--      eligibility (critic 1.2 #7).
--   7. public.market_club_state(p_team): roster counts, limit, minimums, cap, payroll, room and the 3/2/1 gap for anyone
--      signed in; leads, committed money and free room only to that club's front office and commissioners.
--   8. Helpers (definers, no client grant): _market_draft_done, _market_ctx, _market_club_lock (waits, or tries once
--      for the tick), _market_led (empty until the bid-night build replaces its body), _market_group_word,
--      _market_min_breach (a move is refused only when it leaves a group further short than before the move and than
--      the draws already owed), _market_waiver_void_why, _market_jersey, _market_dm, _market_expire_waivers,
--      _market_tick_result.
--   9. public.market_tick(), pg_cron 'market-tick' every 10 seconds: waiver expiry (cleared players join the pool, a
--      'clear' transaction, one post to #free-agency through notify_discord, a bell and a DM; a waiver whose player
--      left the pool's reach is voided at once and announced nowhere), then a heartbeat (rl_market-tick, updated_at
--      bumped) and a result row (rl_market-tick_result) the watchdog already reads (section 2). Every step runs in its
--      own block; a failing step is recorded as ok:false, never swallowed.
--  10. public.automation_watchdog: 'market-tick' joins the section 4 list of jobs that must keep firing.
--  11. public._mgmt_execute passes p_not_inactive through on an Owner-approved waiver, and public.mgmt_request_move refuses
--      a Season 2 waiver request that would fail anyway (the same _market_waive_check) before it reaches the Owner.
--  12. public.notify_roster_add and public.notify_roster_remove: Season 2 copy for the three market origins, for a
--      Season 2 waiver (the club notice and the player's own bell) and for a season suspension (Season 1 told the club
--      it "may sign a replacement"; the minimums record tells the seats whether a draw follows).
--  13. public._place_for_unused_picks (db-guards' market fill, patched by exact anchor): before the fill reads a club's
--      roster it takes that club's market lock (main session, 2026-11-23), so a waiver or a trade in flight for the club
--      (they take the same lock) is seen committed, never read half done.
--
-- Doors only: the transactions wire (notify_discord_transaction), notify_roster_add/remove (club_notify), discord_dms
-- (the bot's DM lane) and notify_discord for the #free-agency pool post. Every Discord post goes through
-- discord_http_post. A rehearsal sends nothing: pg_net and the discord_dms rows roll back.
--
-- Not here: bid nights, lots, bids and boards (the bid-night stream; it replaces _market_led's body and adds its steps to
-- market_tick above the "steps end" line); pool requests and availability (the pool-requests stream fills
-- market_pool.available_next); the minimums trigger and the shortfall draw (the minimums record, next).
--
-- Requires: db-guards' record (market_on, roster_min_gap, the Season 2 season_rules keys incl. mk.waiver_hours and
-- mk.bid_gp, 'waiver_claim' in roster_spots_origin_check, and the market fill in _place_for_unused_picks with its
-- postdraft_done_ mark) and the waive hold, both applied.
-- When: rehearse and apply this record and the minimums record before the Sat Dec 5 seating (main session ruling,
-- 2026-11-23): both rehearsals build their clubs on an empty Season 2, and seating an Owner or GM gives Season 2 its
-- first roster spots.
-- Numbering: the waive hold's block is found in the live waive_player by its "(Season 2 waive hold)" comment, whatever
-- number it shipped under; this file holds no other record's number.
-- Rehearsal: sql/2026-11-24-s2-waivers-v458.rehearsal.sql (main session). Results are recorded at the end of this file.

-- 0. preconditions
do $pre$
begin
  if to_regprocedure('public.market_on(uuid)') is null
     or to_regprocedure('public.roster_min_gap(uuid,uuid,text,uuid)') is null then
    raise exception 'v4.58 waivers: db-guards'' market_on and roster_min_gap must be applied first';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'waive_player') <> 1
     or to_regprocedure('public.waive_player(uuid)') is null then
    raise exception 'v4.58 waivers: expected exactly one public.waive_player(uuid) before the change';
  end if;
  if position('Season 2 waivers open when the draft completes.' in pg_get_functiondef('public.waive_player(uuid)'::regprocedure)) = 0 then
    raise exception 'v4.58 waivers: the Season 2 waive hold is not applied';
  end if;
  if position('''waiver_claim''' in (select pg_get_constraintdef(oid) from pg_constraint
                                      where conrelid = 'public.roster_spots'::regclass and conname = 'roster_spots_origin_check')) = 0 then
    raise exception 'v4.58 waivers: roster_spots_origin_check does not accept waiver_claim yet (db-guards)';
  end if;
  if to_regclass('public.market_waivers') is not null then
    raise exception 'v4.58 waivers: public.market_waivers already exists';
  end if;
  if position($a$      if v_market and (public.roster_min_gap(p_season, v_team.id)->>'open')::int <= 0 then
$a$ in pg_get_functiondef('public._place_for_unused_picks(uuid,integer)'::regprocedure)) = 0 then
    raise exception 'v4.58 waivers: db-guards'' market fill in _place_for_unused_picks must be applied first';
  end if;
end $pre$;

-- 1. the waiver table
create table public.market_waivers (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  from_team_id uuid not null references public.teams(id) on delete cascade,
  position public.hockey_position not null,
  salary bigint not null check (salary > 0),
  waived_by uuid not null,
  by_office boolean not null default false,
  not_inactive_at timestamptz,
  waived_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'claimed', 'cleared', 'void')),
  claimed_team_id uuid references public.teams(id) on delete cascade,
  claimed_by uuid,
  claimed_at timestamptz,
  cleared_at timestamptz,   -- when the window closed without a claim: cleared into the pool, or void
  void_why text,
  /* v4.58 (commissioner, 2026-11-23, confirmed reading): the waiving club cannot claim back, enforced in the table */
  constraint market_waivers_no_claim_back check (claimed_team_id is distinct from from_team_id),
  constraint market_waivers_claimed_shape check ((status = 'claimed') = (claimed_team_id is not null)
                                                 and (status = 'claimed') = (claimed_at is not null)),
  constraint market_waivers_cleared_shape check ((status in ('cleared', 'void')) = (cleared_at is not null)),
  /* v4.58 (review, 2026-11-23): a removal door that runs while the waiver is open (a ban, an office withdrawal of the
     sign-up, an office placement) leaves the row open; the tick closes it as void, with the reason, and never announces
     a player who cannot join the pool */
  constraint market_waivers_void_shape check ((status = 'void') = (void_why is not null)),
  /* a club confirms the player is not being waived for being inactive (commissioner, 2026-11-02); the league office
     is not bound by a club-side bar (standing ruling 2026-10-21) */
  constraint market_waivers_confirmed check (by_office or not_inactive_at is not null),
  constraint market_waivers_window check (expires_at > waived_at)
);
comment on table public.market_waivers is 'v4.58: Season 2 waivers. One row per waiver: open for the waiver period (season_rules mk.waiver_hours), then claimed by the first valid claim, cleared into the training camp pool by market_tick, or void when the player left the pool''s reach while it ran.';
comment on column public.market_waivers.void_why is 'v4.58: why a waiver closed as void (public._market_waiver_void_why). Office reading only: no client grant, because the reason can name a ban.';
create unique index market_waivers_one_open on public.market_waivers (season_id, profile_id) where status = 'open';
create index market_waivers_due on public.market_waivers (expires_at) where status = 'open';
create index market_waivers_season on public.market_waivers (season_id, status);

alter table public.market_waivers enable row level security;
revoke all on public.market_waivers from public, anon, authenticated;
/* a waiver is a completed public move (it posts to #transactions); who in the front office acted stays private */
grant select (id, season_id, profile_id, from_team_id, position, salary, by_office, waived_at, expires_at, status,
              claimed_team_id, claimed_at, cleared_at) on public.market_waivers to anon, authenticated;
create policy "market waivers are public" on public.market_waivers for select to anon, authenticated using (true);

/* the league pulse (v4.05): pages refresh within 10 s without polling */
create trigger live_mark_market_waivers_ins after insert on public.market_waivers
  referencing new table as new_rows for each statement execute function public._live_mark('market', '', '');
create trigger live_mark_market_waivers_upd after update on public.market_waivers
  referencing old table as old_rows new table as new_rows for each statement execute function public._live_mark('market', '', '');
create trigger live_mark_market_waivers_del after delete on public.market_waivers
  referencing old table as old_rows for each statement execute function public._live_mark('market', '', '');

-- 2. shortfall draw columns (read by _market_min_breach now, written by the minimums record)
alter table public.replacement_signings
  add column pos_group text check (pos_group in ('F', 'D', 'G')),
  add column alerted_at timestamptz,
  add column lapsed_why text;
comment on column public.replacement_signings.pos_group is 'v4.58: Season 2 only. The position group a random shortfall draw must fill (3 F / 2 D / 1 G minimums). Null on Season 1 replacement allowances.';
comment on column public.replacement_signings.alerted_at is 'v4.58: Season 2 only. When the league office was told a draw could not be made (no pool player of the group, no spot, no cap room); the draw keeps retrying.';
comment on column public.replacement_signings.lapsed_why is 'v4.58: Season 2 only. Why an owed draw closed without a player (the club got back to the minimum, or the movement deadline passed).';

-- 3. helpers (definers, search_path '', no client grant)
create or replace function public._market_draft_done(p_season uuid)
returns boolean language sql stable security definer set search_path to '' as $f$
  /* v4.58: the market opens when the season's draft is complete (draft_state, keyed by season number) */
  select exists (select 1 from public.draft_state d join public.seasons s on s.number = d.season_number
                  where s.id = p_season and d.status = 'complete')
$f$;

create or replace function public._market_ctx(p_team uuid, p_page text)
returns uuid language plpgsql stable security definer set search_path to '' as $f$
/* v4.58: the checks every Season 2 market action makes, in order. The CALLER checks the seat itself
   (public.is_commissioner() or public.is_gm_of(p_team)) in its own body, where the grant audit (checks 1 and 6) reads it.
   Returns the market season. */
declare v_season uuid := public.current_season_id();
begin
  if v_season is null or not public.market_on(v_season) then
    raise exception 'The Season 2 player market is not open this season.' using errcode = 'check_violation', hint = 'market_closed';
  end if;
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  perform public.mgmt_gate(p_team, p_page);
  if public.is_suspended(auth.uid()) and not public.is_commissioner() then
    raise exception 'Suspended managers cannot make roster moves.' using errcode = 'check_violation', hint = 'manager_suspended';
  end if;
  if not public._market_draft_done(v_season) then
    raise exception 'The market opens when the draft is complete.' using errcode = 'check_violation', hint = 'draft_not_done';
  end if;
  return v_season;
end $f$;

create or replace function public._market_club_lock(p_team uuid, p_wait boolean default true)
returns boolean language plpgsql volatile security definer set search_path to '' as $f$
/* v4.58: every action that spends a club's spots or cap takes this first, so two of them serialize. The tick passes
   p_wait false: it tries once and skips a club whose lock is held, so it never waits behind a trade that holds two
   clubs' locks while holding one of them itself (no deadlock), and the next tick retries. */
begin
  if coalesce(p_wait, true) then
    perform pg_advisory_xact_lock(hashtext('market:club:' || p_team::text));
    return true;
  end if;
  return pg_try_advisory_xact_lock(hashtext('market:club:' || p_team::text));
end $f$;

create or replace function public._market_led(p_team uuid)
returns table (lot_id uuid, amount bigint) language sql stable security definer set search_path to '' as $f$
  /* v4.58: the running lots whose newest bid is this club's. The cap and spot checks count them ("a team cannot place a
     bid on a player that would take them over their salary cap", commissioner, 2026-11-02).
     shortcut: no bid lots exist until the bid-night build, which replaces this body with the real read */
  select null::uuid, null::bigint where false
$f$;

create or replace function public._market_group_word(p_group text, p_n int)
returns text language sql immutable set search_path to '' as $f$
  select p_n::text || ' ' || case p_group
    when 'F' then case when p_n = 1 then 'forward' else 'forwards' end
    when 'D' then case when p_n = 1 then 'defenseman' else 'defensemen' end
    else case when p_n = 1 then 'goaltender' else 'goaltenders' end end
$f$;

create or replace function public._market_min_breach(p_season uuid, p_team uuid, p_minus_profile uuid default null,
                                                     p_group text default null, p_before jsonb default null)
returns text language plpgsql stable security definer set search_path to '' as $f$
/* v4.58: the refusal sentence when a voluntary move would leave the club further under a Season 2 minimum than the league
   already owes it (commissioner, 2026-11-23: "do 3 forwards, 2 defensemen, and 1 goalie"), else null. The counting is
   roster_min_gap's, the ONE 3/2/1 definition; an open shortfall draw of the group (replacement_signings.pos_group) is
   already owed to the club, so a club waiting on a draw is not refused for that gap. p_group limits the test to one group
   (a waiver touches only the waived player's).
   p_before (review, 2026-11-23) is the club's roster_min_gap read before the move (a trade passes it): a club already
   short with nothing owed (a skipped pick that lapsed with no player to fill it) may still make a move that leaves the
   group no shorter than it was, such as a like-for-like swap. Refused only when a group ends shorter than both its
   shortfall before the move and the draws owed for it. A waiver passes null: removing a player of a group at or under
   its minimum always makes that group shorter. */
declare v_gap jsonb; v_min jsonb; v_g text; v_short int; v_owed int; v_club text;
begin
  v_gap := public.roster_min_gap(p_season, p_team, null, p_minus_profile);
  v_min := public.season_rules(p_season)->'quota_min';
  if v_gap is null or v_min is null then
    raise exception 'Season 2 roster minimums are not set for this season (season_rules quota_min).';
  end if;
  foreach v_g in array array['F', 'D', 'G'] loop
    continue when p_group is not null and v_g <> p_group;
    v_short := coalesce((v_gap->>v_g)::int, 0);
    continue when v_short <= 0;
    select count(*) into v_owed from public.replacement_signings x
     where x.season_id = p_season and x.team_id = p_team and x.pos_group = v_g and x.used_at is null;
    if v_short > greatest(v_owed, coalesce((p_before->>v_g)::int, 0)) then
      select t.name into v_club from public.teams t where t.id = p_team;
      return 'Season 2 roster minimums: this would leave the ' || coalesce(v_club, 'club') || ' with '
        || public._market_group_word(v_g, (v_min->>v_g)::int - v_short) || ', under the minimum of '
        || (v_min->>v_g)::int || '. Add '
        || case v_g when 'F' then 'a forward' when 'D' then 'a defenseman' else 'a goaltender' end
        || ' first, or make the move with a player from another group.';
    end if;
  end loop;
  return null;
end $f$;

create or replace function public._market_waiver_void_why(p_season uuid, p_profile uuid)
returns text language sql stable security definer set search_path to '' as $f$
  /* v4.58 (review, 2026-11-23): why a waived player can no longer be claimed or join the training camp pool, else null.
     The three tests market_pool makes (banned, on a roster this season, no sign-up left that is not declined), read where
     the waiver is used (the claim and the tick), so every removal door that runs during a waiver (ban_player,
     office_withdraw_registration, the departure sweeps, the player's own withdrawal, an office placement) is covered
     without a hook of its own.
     The ban is tested first: ban_player withdraws the sign-up (_remove_for_discipline) before it sets profiles.banned,
     but in one transaction, and this read sees all of it or none of it, so a banned player's waiver always reads
     "banned from the league", whatever order the ban takes its steps in (main session, 2026-11-24). */
  select case
    when coalesce((select p.banned from public.profiles p where p.id = p_profile), false) then 'banned from the league'
    when exists (select 1 from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = p_profile)
      then 'placed on a roster while on waivers'
    when not exists (select 1 from public.season_registrations r where r.season_id = p_season and r.profile_id = p_profile
                       and r.status <> 'declined') then 'sign-up for the season withdrawn'
  end
$f$;

create or replace function public._market_jersey(p_season uuid, p_team uuid)
returns int language plpgsql stable security definer set search_path to '' as $f$
/* v4.58: the lowest number the club is not wearing, the way sign_free_agent picks it; apply_jersey_preference may then
   give the player their own number */
declare v_n int;
begin
  select min(n) into v_n from generate_series(1, 99) n
   where not exists (select 1 from public.roster_spots rs where rs.season_id = p_season and rs.team_id = p_team and rs.jersey_number = n);
  if v_n is null then raise exception 'The club has no free jersey number (1 to 99).'; end if;
  return v_n;
end $f$;

create or replace function public._market_dm(p_profile uuid, p_text text)
returns void language sql volatile security definer set search_path to '' as $f$
  /* v4.58: one DM through the bot's lane (bot/dms.mjs sends committed rows once). A member with no Discord link gets the
     site notification the caller writes; nothing is queued for them here. */
  insert into public.discord_dms (profile_id, discord_id, kind, content)
  select p.id, p.discord_id, 'market', left(p_text, 1900) from public.profiles p
   where p.id = p_profile and p.discord_id is not null
$f$;

-- 4. the Season 2 waiver
create or replace function public._market_waive_check(p_team uuid, p_season uuid, p_profile uuid, p_not_inactive boolean)
returns void language plpgsql stable security definer set search_path to '' as $f$
/* v4.58: every refusal a Season 2 waiver can meet before it touches the roster, in order. waive_player runs it, and
   mgmt_request_move runs it when a seat asks the Owner to approve a waiver, so a request that could only fail is refused
   when it is made. */
declare v_office boolean := public.is_commissioner(); v_seat text; v_grp text; v_why text; v_name text;
begin
  if p_profile is null then raise exception 'Choose the player to waive.' using errcode = '22023'; end if;
  if not public._market_draft_done(p_season) then
    raise exception 'Season 2 waivers open when the draft completes.' using errcode = 'check_violation', hint = 'waivers_not_open';
  end if;
  if public.moves_locked(p_season) and not v_office then
    raise exception 'Waivers closed at the movement deadline.' using errcode = 'check_violation', hint = 'deadline';
  end if;
  /* commissioner, 2026-11-02: "Teams must not waive inactive players but should report them to league staff" */
  if not coalesce(p_not_inactive, false) and not v_office then
    raise exception 'Confirm that this player is not being waived for being inactive. Report an inactive player to the league office instead.'
      using errcode = 'check_violation', hint = 'confirm_not_inactive';
  end if;
  select coalesce(nullif(p.gamertag, ''), 'This player') into v_name from public.profiles p where p.id = p_profile;
  select case when t.owner_profile_id = p_profile then 'Owner' when t.gm_profile_id = p_profile then 'GM'
              when t.agm_profile_id = p_profile then 'AGM' end into v_seat
    from public.teams t where t.id = p_team;
  if v_seat is not null then
    raise exception '% holds the club''s % seat and cannot be waived.', v_name, v_seat using errcode = 'check_violation', hint = 'seat';
  end if;
  if not v_office then
    select public.pos_group(rs.position) into v_grp from public.roster_spots rs
     where rs.season_id = p_season and rs.team_id = p_team and rs.profile_id = p_profile;
    if v_grp is null then raise exception 'That player is not on your roster.'; end if;
    v_why := public._market_min_breach(p_season, p_team, p_profile, v_grp);
    if v_why is not null then raise exception '%', v_why using errcode = 'check_violation', hint = 'below_minimum'; end if;
  end if;
end $f$;

create or replace function public._market_waive(p_team uuid, p_season uuid, p_profile uuid, p_not_inactive boolean)
returns text language plpgsql volatile security definer set search_path to '' as $f$
/* v4.58: the Season 2 waiver, reached only from waive_player's market branch after its own checks (seat or commissioner,
   mgmt_gate 'roster', the suspended manager, on the roster, the v4.25 suspended-player bar, minimum service). */
declare v_office boolean := public.is_commissioner(); v_spot public.roster_spots; v_w public.market_waivers;
        v_hours int; v_n int; v_name text; v_clean text; v_club text; v_when text;
begin
  perform public._market_waive_check(p_team, p_season, p_profile, p_not_inactive);
  v_hours := (public.season_rules(p_season)->'mk'->>'waiver_hours')::int;
  if v_hours is null or v_hours <= 0 then
    raise exception 'The Season 2 rules carry no waiver period (season_rules mk.waiver_hours).';
  end if;
  perform public._market_club_lock(p_team);
  select rs.* into v_spot from public.roster_spots rs
   where rs.season_id = p_season and rs.team_id = p_team and rs.profile_id = p_profile for update;
  if not found then raise exception 'That player is not on your roster.'; end if;

  /* the same delete the Season 1 door makes: guard_roster_waive, protect_manager_spot, contract_on_waive (the contract
     expires and keeps its salary), the removal archive and notify_roster_remove all run on it */
  perform set_config('app.roster_reason', 'waived', true);
  delete from public.roster_spots where id = v_spot.id;
  get diagnostics v_n = row_count;
  perform set_config('app.roster_reason', '', true);
  if v_n = 0 then raise exception 'That player is not on your roster.'; end if;

  insert into public.market_waivers (season_id, profile_id, from_team_id, position, salary, waived_by, by_office,
                                     not_inactive_at, expires_at)
    values (p_season, p_profile, p_team, v_spot.position, v_spot.salary, auth.uid(), v_office,
            case when coalesce(p_not_inactive, false) then clock_timestamp() end,
            clock_timestamp() + make_interval(hours => v_hours))
    returning * into v_w;

  /* v3.06: the stamp keeps every automatic placement path from handing the player back */
  perform set_config('app.role_grant', 'on', true);
  update public.season_registrations set status = 'pending', waived_at = now()
   where season_id = p_season and profile_id = p_profile;
  get diagnostics v_n = row_count;
  perform set_config('app.role_grant', '', true);
  /* a waived player with no sign-up could never reach the pool, and the tick would void the waiver at once: refuse
     loudly instead (nothing above commits) */
  if v_n <> 1 then
    raise exception 'That player has no sign-up for this season, so they cannot go on waivers. Ask the league office to remove them instead.'
      using errcode = 'check_violation', hint = 'no_signup';
  end if;

  select coalesce(nullif(p.gamertag, ''), p.display_name, 'a player') into v_name from public.profiles p where p.id = p_profile;
  v_clean := replace(replace(v_name, '<', ''), '>', '');
  select t.name into v_club from public.teams t where t.id = p_team;
  v_when := to_char(v_w.expires_at at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET';
  insert into public.transactions (season_id, type, description)
    values (p_season, 'waive', v_club || ' placed <b>' || v_clean || '</b> on waivers. Any other club may claim them at '
            || public._money(v_w.salary) || ' until ' || v_when || '.');
  perform public._market_dm(p_profile, 'You were placed on waivers by the ' || v_club || '. Any other club may claim you until '
    || v_when || '. If no club claims you, you join the training camp pool.');
  return v_name;
end $f$;

-- 5. waive_player: DROP plus CREATE with the confirmation argument; the hold comes out, the market branch goes in
do $wp$
declare
  v_old text := pg_get_functiondef('public.waive_player(uuid)'::regprocedure);
  v_hdr_old text := 'CREATE OR REPLACE FUNCTION public.waive_player(p_profile uuid)';
  v_hdr_new text := 'CREATE OR REPLACE FUNCTION public.waive_player(p_profile uuid, p_not_inactive boolean DEFAULT NULL::boolean)';
  /* the hold record's block, byte for byte, with @HOLD@ where the hold's own version stands; the version is read from
     the live body below, so this file never carries another record's number (review, 2026-11-23) */
  v_hold text := $h$  /* @HOLD@ (Season 2 waive hold): in a market season the Season 1 waiver below would delete the spot and leave the
     player a free agent any club may sign, skipping the 24-hour claim window the commissioner ruled ("Any team can pick
     up a player placed on waivers up to 24 hours after they have been waived, like real life.", 2026-11-02). The Season 2
     waivers record replaces this hold with the claim market; until then nobody waives on a Season 2 roster, the league
     office included (it removes a player through admin_remove_from_roster). */
  if public.market_on(v_season.id) then
    raise exception 'Season 2 waivers open when the draft completes.' using errcode = 'check_violation', hint = 'waivers_not_open';
  end if;
$h$;
  v_at text := $a$  perform set_config('app.roster_reason', 'waived', true);
$a$;
  v_branch text := $b$  /* v4.58 (commissioner, 2026-11-02: "Any team can pick up a player placed on waivers up to 24 hours after they have
     been waived, like real life."): in a market season the waiver is a claim window, not a release. The checks above
     still run first; public._market_waive makes the Season 2 checks, the delete, the waiver row and the notices. The
     Season 1 path below is unchanged. */
  if public.market_on(v_season.id) then
    return public._market_waive(v_team.id, v_season.id, p_profile, p_not_inactive);
  end if;
$b$;
  v_new text; v_def text; v_ver text;
  c text; n int;
begin
  v_ver := substring(v_old from '/\* (v[0-9A-Za-z.]+) \(Season 2 waive hold\):');
  if v_ver is null then
    raise exception 'v4.58 waivers: no "(Season 2 waive hold)" block in waive_player. The live line is: %',
      coalesce(substring(v_old from '[^\n]*Season 2 waive hold[^\n]*'), 'none');
  end if;
  v_hold := replace(v_hold, '@HOLD@', v_ver);   -- @HOLD@ stands once in the block, in its first comment line
  foreach c in array array[v_hdr_old, v_hold, v_at] loop
    n := (length(v_old) - length(replace(v_old, c, ''))) / length(c);
    if n <> 1 then raise exception 'v4.58 waivers: a waive_player anchor matched % times, expected exactly 1: %', n, left(c, 60); end if;
  end loop;
  v_new := replace(replace(replace(v_old, v_hdr_old, v_hdr_new), v_hold, ''), v_at, v_branch || v_at);
  drop function public.waive_player(uuid);
  execute v_new;
  v_def := pg_get_functiondef('public.waive_player(uuid,boolean)'::regprocedure);
  /* the Season 1 path is byte-identical: the new body less the market branch is the old body less the hold */
  if replace(substr(v_def, position('AS $function$' in v_def)), v_branch, '')
     <> replace(substr(v_old, position('AS $function$' in v_old)), v_hold, '') then
    raise exception 'v4.58 waivers: the new waive_player body differs from the old one by more than the market branch';
  end if;
end $wp$;
revoke all on function public.waive_player(uuid, boolean) from public, anon, authenticated;
grant execute on function public.waive_player(uuid, boolean) to authenticated, service_role;

-- 6. the claim
create or replace function public.market_claim(p_waiver uuid, p_team uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $f$
/* v4.58 (commissioner, 2026-11-02 and 2026-11-23): any other club may claim a waived player for 24 hours; the first valid
   claim wins at once; the waiving club cannot claim back; the claiming club needs a roster spot and the cap room for the
   salary. The claimed player keeps the waiver salary, on a contract to the end of the season (apply_contract_on_roster).
   Races: the club lock, then the waiver row FOR UPDATE; the second of two claims reads the committed row and is told who
   won. Expiry is judged on clock_timestamp(), never the transaction's start. guard_roster_cap and the deferred roster
   checks stay the final authority on the insert. */
declare v_office boolean := public.is_commissioner(); v_season uuid; v_w public.market_waivers; v_rules jsonb;
        v_max int; v_cap bigint; v_pay bigint; v_led_n int; v_led bigint; v_active int; v_gap jsonb; v_grp text;
        v_bid_gp int; v_name text; v_clean text; v_club text; v_from text; v_jersey int; v_spot uuid; v_n int;
begin
  if p_waiver is null or p_team is null then raise exception 'Choose the waiver and the club.' using errcode = '22023'; end if;
  if not (v_office or public.is_gm_of(p_team)) then
    raise exception 'Only that club''s Owner, GM or AGM can claim for it.' using errcode = '42501';
  end if;
  /* v4.58 (review, 2026-11-23): the first valid claim wins at once, so a claim cannot wait in the Owner's approval queue
     (mgmt_gate would tell the seat to send it there, and the queue has no claim move) */
  if not v_office and public.mgmt_access(p_team, 'freeagents') = 'approve' then
    raise exception 'Your Owner approves this seat''s Free agents moves, and the first claim on a waiver wins at once, so ask your Owner to make the claim.'
      using errcode = '42501', hint = 'owner_claims';
  end if;
  v_season := public._market_ctx(p_team, 'freeagents');
  /* v4.58 (main session, 2026-11-23): claims open after the post-draft fill for skipped picks, so a claim can never take
     the spot a skipped pick is owed. The fill writes the season's postdraft_done_ mark in the same transaction as its
     last placement (the house key, v3.89), so a claim that sees the mark sees every fill. The office waits too: the fill
     runs once. */
  if not exists (select 1 from public.app_config c where c.key = 'postdraft_done_' || v_season::text) then
    raise exception 'The post-draft fill for skipped picks runs first. Claims open as soon as it has run.'
      using errcode = 'check_violation', hint = 'fill_pending';
  end if;
  if public.moves_locked(v_season) and not v_office then
    raise exception 'Claims closed at the movement deadline.' using errcode = 'check_violation', hint = 'deadline';
  end if;
  perform public._market_club_lock(p_team);
  select w.* into v_w from public.market_waivers w where w.id = p_waiver for update;
  if not found or v_w.season_id <> v_season then raise exception 'That waiver does not exist.' using errcode = 'P0002'; end if;
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'This player') into v_name from public.profiles p where p.id = v_w.profile_id;
  v_rules := public.season_rules(v_season);
  v_bid_gp := (v_rules->'mk'->>'bid_gp')::int;
  if v_w.status = 'claimed' then
    select t.name into v_club from public.teams t where t.id = v_w.claimed_team_id;
    raise exception 'The % already claimed % at % ET. The first claim wins.', v_club, v_name,
      to_char(v_w.claimed_at at time zone 'America/New_York', 'FMHH12:MI AM') using errcode = 'check_violation', hint = 'already_claimed';
  end if;
  /* v4.58 (review, 2026-11-23): re-check the player where the waiver is used, so a ban, a withdrawn sign-up or an office
     placement during the window is never claimed past (the reason stays with the office: it can name a ban) */
  if v_w.status = 'void' or public._market_waiver_void_why(v_season, v_w.profile_id) is not null then
    raise exception '% can no longer be claimed: they are no longer in the training camp pool.', v_name
      using errcode = 'check_violation', hint = 'unavailable';
  end if;
  if v_w.status = 'cleared' or clock_timestamp() >= v_w.expires_at then
    raise exception '% cleared waivers and joined the training camp pool.', v_name using errcode = 'check_violation', hint = 'cleared';
  end if;
  if v_w.from_team_id = p_team then
    raise exception 'Your club placed % on waivers, so it cannot claim them back. Once they clear waivers and have played % games, your club may bid on them on a Saturday.',
      v_name, coalesce(v_bid_gp::text, 'enough') using errcode = 'check_violation', hint = 'own_waiver';
  end if;
  if public.is_suspended(v_w.profile_id) and not v_office then
    raise exception '% is suspended and cannot join a roster until the suspension is served.', v_name
      using errcode = 'check_violation', hint = 'suspended';
  end if;
  v_max := (v_rules->>'roster_max')::int;
  select s.salary_cap into v_cap from public.seasons s where s.id = v_season;
  if v_max is null or v_cap is null then raise exception 'This season has no roster limit or salary cap set.'; end if;
  select count(*), coalesce(sum(l.amount), 0) into v_led_n, v_led from public._market_led(p_team) l;
  select count(*) into v_active from public.roster_spots rs where rs.season_id = v_season and rs.team_id = p_team and rs.status = 'active';
  if v_active + v_led_n + 1 > v_max then
    raise exception '%', 'Your roster is full (' || (v_active + v_led_n) || ' of ' || v_max
      || case when v_led_n > 0 then ', counting the ' || v_led_n || ' bid' || case when v_led_n = 1 then '' else 's' end || ' your club leads tonight' else '' end
      || '). Waive a player first.'
      using errcode = 'check_violation', hint = 'no_spot';
  end if;
  v_pay := public.team_cap_used(v_season, p_team);
  if v_pay + v_led + v_w.salary > v_cap then
    raise exception 'Claiming % at % would put your club at %, over the % cap%.', v_name, public._money(v_w.salary),
      public._money(v_pay + v_led + v_w.salary), public._money(v_cap),
      case when v_led > 0 then ', counting the ' || public._money(v_led) || ' in bids your club leads tonight' else '' end
      using errcode = 'check_violation', hint = 'over_cap';
  end if;
  v_grp := public.pos_group(v_w.position);
  v_gap := public.roster_min_gap(v_season, p_team, v_grp, null);
  if coalesce((v_gap->>'short')::int, 0) > coalesce((v_gap->>'open')::int, 0) - v_led_n then
    raise exception '%', 'Claiming ' || v_name || ' would leave your club no room to reach the Season 2 roster minimums of '
      || public._market_group_word('F', (v_rules->'quota_min'->>'F')::int) || ', '
      || public._market_group_word('D', (v_rules->'quota_min'->>'D')::int) || ' and '
      || public._market_group_word('G', (v_rules->'quota_min'->>'G')::int) || '. Claim a player of the group your club is short instead.'
      using errcode = 'check_violation', hint = 'minimums';
  end if;

  v_jersey := public._market_jersey(v_season, p_team);
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin, squad)
    values (v_season, p_team, v_w.profile_id, v_jersey, v_w.position, v_w.salary, 'waiver_claim', 'pro')
    returning id into v_spot;
  update public.market_waivers set status = 'claimed', claimed_team_id = p_team, claimed_by = auth.uid(), claimed_at = clock_timestamp()
   where id = v_w.id and status = 'open';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'The claim could not be recorded. Nothing was claimed; try again.'; end if;
  perform set_config('app.role_grant', 'on', true);
  update public.season_registrations set status = 'assigned' where season_id = v_season and profile_id = v_w.profile_id;
  get diagnostics v_n = row_count;
  perform set_config('app.role_grant', '', true);
  if v_n <> 1 then raise exception 'The claim could not be recorded: % has no sign-up for the season. Nothing was claimed.', v_name; end if;

  v_clean := replace(replace(v_name, '<', ''), '>', '');
  select t.name into v_club from public.teams t where t.id = p_team;
  select t.name into v_from from public.teams t where t.id = v_w.from_team_id;
  insert into public.transactions (season_id, type, description)
    values (v_season, 'claim', v_club || ' claimed <b>' || v_clean || '</b> off waivers from the ' || v_from || ' at '
            || public._money(v_w.salary) || '.');
  perform public._market_dm(v_w.profile_id, 'The ' || v_club || ' claimed you off waivers at ' || public._money(v_w.salary)
    || ', on a contract to the end of the season.');
  return jsonb_build_object('ok', true, 'waiver_id', v_w.id, 'spot_id', v_spot, 'team_id', p_team,
                            'profile_id', v_w.profile_id, 'salary', v_w.salary);
end $f$;

-- 7. the training camp pool
create or replace function public.market_pool(p_season uuid)
returns table (profile_id uuid, "position" public.hockey_position, pos_group text, gp int, needs int, eligible boolean,
               suspended boolean, source text, last_team_id uuid, available_next boolean)
language plpgsql stable security definer set search_path to '' as $f$
/* v4.58: the season's training camp pool once its draft is complete: sign-ups not declined, on no roster, not on open
   waivers, not banned. gp counts BOX SCORES only (game_stats on final, unvoided regular-season games, any club), never
   regular_gp: its gp_credits are private and must not become public games or bid eligibility (critic 1.2 #7). Bid
   eligibility: commissioner, 2026-11-02: "Only training camp players with at least 6 games played can be bid on" (the
   number is season_rules mk.bid_gp). source: 'waivers' (cleared a Season 2 waiver), 'late' (signed up after the draft
   began), else 'undrafted'. */
#variable_conflict use_column
declare v_bid_gp int;
begin
  if p_season is null then raise exception 'Choose the season.' using errcode = '22023'; end if;
  if not public.market_on(p_season) or not public._market_draft_done(p_season) then return; end if;
  v_bid_gp := (public.season_rules(p_season)->'mk'->>'bid_gp')::int;
  if v_bid_gp is null then raise exception 'The Season 2 rules carry no bid eligibility (season_rules mk.bid_gp).'; end if;
  return query
  with pool as (
    select r.profile_id as pid, r.position as pos, r.created_at as reg_at
      from public.season_registrations r join public.profiles p on p.id = r.profile_id
     where r.season_id = p_season and r.status <> 'declined' and not coalesce(p.banned, false)
       and not exists (select 1 from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = r.profile_id)
       and not exists (select 1 from public.market_waivers w where w.season_id = p_season and w.profile_id = r.profile_id and w.status = 'open')
  ), box as (
    select gs.profile_id as pid, count(distinct g.id)::int as n
      from public.game_stats gs join public.games g on g.id = gs.game_id
     where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular' and g.status = 'final'
       and not coalesce(g.voided, false) and gs.profile_id in (select pool.pid from pool)
     group by gs.profile_id
  )
  select pool.pid, pool.pos, public.pos_group(pool.pos), coalesce(box.n, 0),
         greatest(v_bid_gp - coalesce(box.n, 0), 0),
         coalesce(box.n, 0) >= v_bid_gp and not public.is_suspended(pool.pid),
         public.is_suspended(pool.pid),
         case when exists (select 1 from public.market_waivers w where w.season_id = p_season and w.profile_id = pool.pid and w.status = 'cleared') then 'waivers'
              when s.draft_at is not null and pool.reg_at >= s.draft_at then 'late'
              else 'undrafted' end,
         (select rt.team_id from public.roster_tenures rt where rt.season_id = p_season and rt.profile_id = pool.pid
           order by rt.joined_at desc limit 1),
         /* shortcut: null until the pool-requests build reads availability for the caller's club's next game night, and
            only for a front office or the office (availability is private today) */
         null::boolean
    from pool left join box on box.pid = pool.pid cross join public.seasons s
   where s.id = p_season
   order by public.pos_group(pool.pos), coalesce(box.n, 0) desc, pool.pid;
end $f$;

-- 8. a club's market state
create or replace function public.market_club_state(p_team uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $f$
/* v4.58: what every signed-in member may see about a club's room (counts, limit, minimums, cap, payroll, room, spots and
   the 3/2/1 gap), plus, only for that club's front office and commissioners, the bids it leads and the room left after
   them. The concept's privacy rule (js/market.js:116-120): leads are never shown to another club. */
declare v_season uuid := public.current_season_id(); v_rules jsonb; v_max int; v_cap bigint; v_pay bigint;
        f int; d int; g int; v_gap jsonb; v_owed int; v_led_n int; v_led bigint; v_out jsonb;
begin
  if p_team is null then raise exception 'Choose the club.' using errcode = '22023'; end if;
  if v_season is null or not public.market_on(v_season) then
    raise exception 'The Season 2 player market is not open this season.' using errcode = 'check_violation', hint = 'market_closed';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team) then raise exception 'That club does not exist.' using errcode = 'P0002'; end if;
  v_rules := public.season_rules(v_season);
  v_max := (v_rules->>'roster_max')::int;
  select s.salary_cap into v_cap from public.seasons s where s.id = v_season;
  select count(*) filter (where public.pos_group(rs.position) = 'F'), count(*) filter (where public.pos_group(rs.position) = 'D'),
         count(*) filter (where public.pos_group(rs.position) = 'G')
    into f, d, g from public.roster_spots rs where rs.season_id = v_season and rs.team_id = p_team and rs.status = 'active';
  v_pay := public.team_cap_used(v_season, p_team);
  v_gap := public.roster_min_gap(v_season, p_team, null, null);
  select count(*) into v_owed from public.replacement_signings x
   where x.season_id = v_season and x.team_id = p_team and x.pos_group is not null and x.used_at is null;
  v_out := jsonb_build_object('team_id', p_team, 'season_id', v_season, 'counts', jsonb_build_object('F', f, 'D', d, 'G', g),
    'active', f + d + g, 'limit', v_max, 'mins', v_rules->'quota_min', 'cap', v_cap, 'payroll', v_pay, 'room', v_cap - v_pay,
    'spots', v_max - (f + d + g), 'gap', v_gap, 'owed', v_owed, 'draft_done', public._market_draft_done(v_season),
    'moves_locked', public.moves_locked(v_season));
  if public.is_commissioner() or public.is_gm_of(p_team) then
    select count(*), coalesce(sum(l.amount), 0) into v_led_n, v_led from public._market_led(p_team) l;
    v_out := v_out || jsonb_build_object(
      'leading', (select coalesce(jsonb_agg(jsonb_build_object('lot_id', l.lot_id, 'amount', l.amount)), '[]'::jsonb) from public._market_led(p_team) l),
      'committed', v_led, 'free_spots', v_max - (f + d + g) - v_led_n, 'free_room', v_cap - v_pay - v_led);
  end if;
  return v_out;
end $f$;

-- 9. the tick: waiver expiry, then the heartbeat and the result the watchdog reads
create or replace function public._market_expire_waivers(p_season uuid)
returns int language plpgsql volatile security definer set search_path to '' as $f$
/* v4.58: open waivers past their window become 'cleared' and the player joins the training camp pool (commissioner,
   2026-11-02: "Any team can pick up a player placed on waivers up to 24 hours after they have been waived"). SKIP LOCKED,
   so a claim holding the row at the same moment decides it and the sweep moves on. A waiver still running at the
   movement deadline cannot be claimed after it and clears here at its 24 hours.
   Review, 2026-11-23: an open waiver whose player left the pool's reach while it ran (_market_waiver_void_why: banned,
   placed on a roster, sign-up withdrawn) is closed as 'void' at once, whatever its clock, with the reason for the
   office, and announced nowhere: the pool post, the bell and the DM would tell members something false. */
declare r record; v_n int := 0; v_name text; v_clean text; v_club text; v_why text;
begin
  for r in
    select x.id, x.profile_id, x.from_team_id, x.position, x.expires_at from public.market_waivers x
     where x.season_id = p_season and x.status = 'open'
     order by x.expires_at for update skip locked
  loop
    v_why := public._market_waiver_void_why(p_season, r.profile_id);
    if v_why is not null then
      update public.market_waivers set status = 'void', void_why = v_why, cleared_at = clock_timestamp() where id = r.id;
      continue;
    end if;
    continue when r.expires_at > clock_timestamp();
    update public.market_waivers set status = 'cleared', cleared_at = clock_timestamp() where id = r.id;
    select coalesce(nullif(p.gamertag, ''), p.display_name, 'a player') into v_name from public.profiles p where p.id = r.profile_id;
    v_clean := replace(replace(v_name, '<', ''), '>', '');
    select t.name into v_club from public.teams t where t.id = r.from_team_id;
    insert into public.transactions (season_id, type, description)
      values (p_season, 'clear', '<b>' || v_clean || '</b> cleared waivers from the ' || coalesce(v_club, 'club')
              || ' and joined the training camp pool.');
    /* commissioner, 2026-11-23: "#free-agency becomes the training camp pool channel"; no pings */
    perform public.notify_discord('discord_freeagency_webhook',
      '**' || v_clean || '** (' || public._pos_word(r.position) || ') cleared waivers and joined the training camp pool.', false);
    perform public.create_notification(r.profile_id, 'waive', 'You cleared waivers',
      'No club claimed you, so you are in the training camp pool. Clubs may request you for a game night, and once you have played enough games you can be bid on at Saturday bidding.',
      null, null);
    perform public._market_dm(r.profile_id, 'No club claimed you off waivers, so you are in the training camp pool. Clubs may request you for a game night, and once you have played enough games you can be bid on at Saturday bidding.');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $f$;

create or replace function public._market_tick_result(p_errors text[])
returns void language plpgsql volatile security definer set search_path to '' as $f$
/* v4.58: the per-run result automation_watchdog section 2 reads (rl_<job>_result, ok false = alert, at most every 6 hours).
   Written on a failure, and once when a failure clears, never on every quiet run. */
declare v_prev text;
begin
  select a.value into v_prev from public.app_config a where a.key = 'rl_market-tick_result';
  if coalesce(cardinality(p_errors), 0) > 0 then
    insert into public.app_config (key, value)
      values ('rl_market-tick_result', jsonb_build_object('ok', false, 'lastError', left(array_to_string(p_errors, ' | '), 500),
                                                          'at', clock_timestamp())::text)
      on conflict (key) do update set value = excluded.value, updated_at = now();
  elsif v_prev is null or (v_prev::jsonb->>'ok') = 'false' then
    insert into public.app_config (key, value)
      values ('rl_market-tick_result', jsonb_build_object('ok', true, 'at', clock_timestamp())::text)
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $f$;

create or replace function public.market_tick()
returns void language plpgsql volatile security definer set search_path to '' as $f$
/* v4.58: pg_cron 'market-tick', every 10 seconds. Exits at once unless the current season is a market season. Each step
   runs in its own block: a step that fails is recorded (rl_market-tick_result ok false, which the watchdog posts) and the
   other steps still run. Later records add their steps above the "steps end" line. */
declare v_season uuid := public.current_season_id(); v_errors text[] := '{}';
begin
  if v_season is not null and public.market_on(v_season) then
    begin
      perform public._market_expire_waivers(v_season);
    exception when others then
      v_errors := v_errors || ('waiver expiry: ' || sqlerrm);
    end;
    -- market-tick steps end
    perform public._market_tick_result(v_errors);
  end if;
  /* updated_at too: nothing maintains it on app_config, and the office reads a heartbeat's age from it (review,
     2026-11-23: rl_watchdog, written without it, still shows 2026-07-17) */
  insert into public.app_config (key, value) values ('rl_market-tick', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict (key) do update set value = excluded.value, updated_at = now();
end $f$;

do $grants$
declare f text;
begin
  foreach f in array array['public._market_draft_done(uuid)', 'public._market_ctx(uuid,text)', 'public._market_club_lock(uuid,boolean)',
    'public._market_led(uuid)', 'public._market_group_word(text,integer)', 'public._market_min_breach(uuid,uuid,uuid,text,jsonb)',
    'public._market_waiver_void_why(uuid,uuid)', 'public._market_jersey(uuid,uuid)', 'public._market_dm(uuid,text)',
    'public._market_waive_check(uuid,uuid,uuid,boolean)',
    'public._market_waive(uuid,uuid,uuid,boolean)', 'public._market_expire_waivers(uuid)', 'public._market_tick_result(text[])',
    'public.market_tick()', 'public.market_claim(uuid,uuid)', 'public.market_pool(uuid)', 'public.market_club_state(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $grants$;
grant execute on function public.market_claim(uuid, uuid) to authenticated;
grant execute on function public.market_club_state(uuid) to authenticated;
grant execute on function public.market_pool(uuid) to anon, authenticated;

select cron.schedule('market-tick', '10 seconds', 'select public.market_tick()');

-- 10. the watchdog watches the new job (the v4.05 anchor method)
do $wd$
declare v_def text := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
        a text := $a$      ('live-flush', interval '10 minutes'),
$a$;
        b text := $b$      ('live-flush', interval '10 minutes'),
      ('market-tick', interval '10 minutes'),   -- v4.58: Season 2 waiver expiry, every 10 seconds
$b$;
        n int;
begin
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 waivers: the watchdog anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $wd$;

-- 11. the Owner-approval queue knows the confirmation
do $mg$
declare v_def text; a text; b text; n int;
begin
  v_def := pg_get_functiondef('public._mgmt_execute(public.team_mgmt_moves)'::regprocedure);
  a := $a$    when 'waive_player'       then perform public.waive_player((a->>'p_profile')::uuid);
$a$;
  b := $b$    when 'waive_player'       then perform public.waive_player((a->>'p_profile')::uuid, (a->>'p_not_inactive')::boolean);   -- v4.58: the requester's Season 2 confirmation
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 waivers: the _mgmt_execute anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);

  v_def := pg_get_functiondef('public.mgmt_request_move(text,text,jsonb,text)'::regprocedure);
  a := $a$  select * into d from public._mgmt_describe(v_team, p_action, coalesce(p_args, '{}'::jsonb));
$a$;
  b := $b$  /* v4.58: a Season 2 waiver that could only fail (before the draft, after the deadline, unconfirmed, a seat holder,
     under a minimum) is refused when it is asked for, not when the Owner approves it */
  if p_action = 'waive_player' and public.market_on(public.current_season_id()) then
    perform public._market_waive_check(v_team, public.current_season_id(), nullif(p_args->>'p_profile', '')::uuid,
                                       coalesce((p_args->>'p_not_inactive')::boolean, false));
  end if;
$b$ || a;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 waivers: the mgmt_request_move anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $mg$;

-- 12. club and player notices: Season 2 copy
do $nt$
declare v_def text; a text; b text; n int;
begin
  v_def := pg_get_functiondef('public.notify_roster_add()'::regprocedure);
  a := $a$  if new.origin = 'preseason_random' then
    v_kind := 'loan';
$a$;
  b := $b$  if new.origin in ('waiver_claim', 'market_bid', 'market_placed') then
    /* v4.58: the three Season 2 market doors (a waiver claim, a Saturday bid, a random shortfall draw from the training camp
       pool); each is a contract to the end of the season at the salary the door set */
    v_title := case new.origin when 'waiver_claim' then 'Claimed off waivers: ' when 'market_bid' then 'Won at Saturday bidding: '
                 else 'Placed from the training camp pool: ' end || v_name || ' (' || v_pos || ')';
    v_body := v_name || case new.origin
        when 'waiver_claim' then ' joins the roster, claimed off waivers'
        when 'market_bid' then ' joins the roster, won at Saturday bidding'
        else ' was drawn at random from the training camp pool to restore a Season 2 roster minimum, and joins the roster' end
      || ' at ' || public._money(new.salary) || ' to the end of the season (#' || new.jersey_number || ').';
  elsif new.origin = 'preseason_random' then
    v_kind := 'loan';
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 waivers: the notify_roster_add anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);

  v_def := pg_get_functiondef('public.notify_roster_remove()'::regprocedure);
  a := $a$  perform public.club_notify(old.team_id, v_kind, v_title, v_body, null, 'manager', null);
$a$;
  b := $b$  /* v4.58: Season 2 copy. A waiver is a claim window, then the training camp pool. A season suspension promises no
     signing: Season 2 has none. A club left under a minimum gets a random draw, not a signing (commissioner, 2026-11-23),
     and the minimums record tells the seats whether the draw follows (before the movement deadline) or nightly requests
     cover the gap (after it) */
  if public.market_on(old.season_id) then
    if v_reason = 'waived' then
      v_body := v_name || ' (' || public._pos_word(old.position) || ') was placed on waivers: their cap hit clears, and any other club may claim them for the next '
        || coalesce(public.season_rules(old.season_id)->'mk'->>'waiver_hours', '24')
        || ' hours. If no club claims them, they join the training camp pool, where any club, yours included, may bid on them on a Saturday once they have played '
        || coalesce(public.season_rules(old.season_id)->'mk'->>'bid_gp', '6') || ' games.';
    elsif v_reason = 'suspended for the season' then
      v_body := v_name || ' (' || public._pos_word(old.position) || ') was removed from the roster by the league office: suspended for the rest of the season.';
    end if;
  end if;
$b$ || a;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 waivers: the notify_roster_remove anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);
  /* the player's own bell: a Season 2 waiver is not a release (review, 2026-11-23); the Season 1 sentence is kept as it was */
  a := $a$    'You were released from '||coalesce(tn,'a club')||'.', null, null);
$a$;
  b := $b$    case when public.market_on(old.season_id) and current_setting('app.roster_reason', true) = 'waived'
         then 'You were placed on waivers by ' || coalesce(tn, 'a club') || '. Any other club may claim you for the next '
              || coalesce(public.season_rules(old.season_id)->'mk'->>'waiver_hours', '24') || ' hours; if none does, you join the training camp pool.'
         else 'You were released from '||coalesce(tn,'a club')||'.' end, null, null);   -- v4.58: Season 2 waiver bell
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 waivers: the notify_roster_remove bell anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $nt$;

-- 13. the post-draft fill takes the club lock (db-guards' market branch of _place_for_unused_picks, anchored on a line
--     that carries no record number)
do $fill$
declare v_def text := pg_get_functiondef('public._place_for_unused_picks(uuid,integer)'::regprocedure);
        a text := $a$      if v_market and (public.roster_min_gap(p_season, v_team.id)->>'open')::int <= 0 then
$a$;
        b text := $b$      /* v4.58 (main session, 2026-11-23): the club's market lock before the fill reads its roster (spots, cap, the
         3/2/1 gap), so a waiver or a trade in flight for the club (both take this lock) is seen committed. Held to
         commit, like every advisory transaction lock. Claims wait for the fill's postdraft_done_ mark instead.
         shortcut: the fill takes club locks in team-scan order while a trade takes its two in id order, so the two can
         deadlock; Postgres then aborts one of them within deadlock_timeout. The fill writes its mark last, so it reruns
         on the next rookie-distribution run; a trade returns the error and can be accepted again. Order the fill's
         clubs by id if a deadlock is ever logged on draft night. */
      if v_market then perform public._market_club_lock(v_team.id); end if;
$b$ || a;
        n int;
begin
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 waivers: the _place_for_unused_picks anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $fill$;

-- 14. self-checks
do $chk$
declare f text; v_def text; r text; pr text;
  s1_rules constant jsonb := '{"flex": null, "lines": null, "quota": {"D": 5, "F": 7, "G": 3}, "weeks": 6, "format": "basic", "rights": false, "camp_max": 10, "cap_camp": 3, "fa_window": false, "preseason": false, "cap_goalie": 6, "cap_skater": 6, "extensions": false, "roster_max": 15, "salary_cap": 50000000, "series_cap": 4, "draft_snake": true, "pick_trades": false, "draft_rounds": 12, "min_service_gp": 0, "playoff_min_gp": 14, "playoff_best_of": 7, "playoff_per_div": 3, "max_contract_years": 1, "trade_deadline_week": 4}'::jsonb;
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'waive_player') <> 1
     or to_regprocedure('public.waive_player(uuid,boolean)') is null then
    raise exception 'v4.58 waivers: expected exactly one waive_player(uuid, boolean)';
  end if;
  v_def := pg_get_functiondef('public.waive_player(uuid,boolean)'::regprocedure);
  if position('Season 2 waivers open when the draft completes.' in v_def) > 0 then raise exception 'v4.58 waivers: the hold is still in waive_player'; end if;
  if (length(v_def) - length(replace(v_def, 'return public._market_waive(', ''))) / length('return public._market_waive(') <> 1 then
    raise exception 'v4.58 waivers: the market branch is not in waive_player exactly once';
  end if;
  if has_function_privilege('anon', 'public.waive_player(uuid,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.waive_player(uuid,boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.waive_player(uuid,boolean)', 'EXECUTE') then
    raise exception 'v4.58 waivers: waive_player grants are wrong (authenticated and service_role yes, anon no)';
  end if;
  foreach f in array array['public.waive_player(uuid,boolean)', 'public._market_draft_done(uuid)', 'public._market_ctx(uuid,text)',
    'public._market_club_lock(uuid,boolean)', 'public._market_led(uuid)', 'public._market_min_breach(uuid,uuid,uuid,text,jsonb)',
    'public._market_waiver_void_why(uuid,uuid)', 'public._market_jersey(uuid,uuid)', 'public._market_dm(uuid,text)',
    'public._market_waive_check(uuid,uuid,uuid,boolean)',
    'public._market_waive(uuid,uuid,uuid,boolean)', 'public._market_expire_waivers(uuid)', 'public._market_tick_result(text[])',
    'public.market_tick()', 'public.market_claim(uuid,uuid)', 'public.market_pool(uuid)', 'public.market_club_state(uuid)'] loop
    if not (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) from pg_proc p where p.oid = f::regprocedure) then
      raise exception 'v4.58 waivers: % must be SECURITY DEFINER with search_path ''''', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') and f <> 'public.market_pool(uuid)' then
      raise exception 'v4.58 waivers: anon can execute %', f;
    end if;
    if has_function_privilege('authenticated', f, 'EXECUTE')
       and f not in ('public.waive_player(uuid,boolean)', 'public.market_claim(uuid,uuid)', 'public.market_pool(uuid)', 'public.market_club_state(uuid)') then
      raise exception 'v4.58 waivers: authenticated can execute the internal %', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.market_claim(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.market_club_state(uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.market_pool(uuid)', 'EXECUTE') then
    raise exception 'v4.58 waivers: a client RPC lost its grant';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.market_waivers'::regclass)
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'market_waivers') <> 1
     or (select cmd from pg_policies where schemaname = 'public' and tablename = 'market_waivers') <> 'SELECT' then
    raise exception 'v4.58 waivers: market_waivers must have RLS on and exactly one (SELECT) policy';
  end if;
  /* no client write of any kind, for either API role (a forged row would bind no club or seat) */
  foreach r in array array['anon', 'authenticated'] loop
    foreach pr in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, 'public.market_waivers', pr)
         or (case when pr in ('INSERT', 'UPDATE', 'REFERENCES') then has_any_column_privilege(r, 'public.market_waivers', pr) else false end) then   /* parenthesized: a bare CASE in a plpgsql IF ends the condition at its first THEN (main session, 2026-11-24) */
        raise exception 'v4.58 waivers: market_waivers grants are wrong: % has %', r, pr;
      end if;
    end loop;
    foreach pr in array array['waived_by', 'claimed_by', 'void_why'] loop
      if has_column_privilege(r, 'public.market_waivers', pr, 'SELECT') then
        raise exception 'v4.58 waivers: market_waivers grants are wrong: % reads %', r, pr;
      end if;
    end loop;
    if not has_column_privilege(r, 'public.market_waivers', 'profile_id', 'SELECT') then
      raise exception 'v4.58 waivers: market_waivers grants are wrong: % cannot read the waivers', r;
    end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid = 'public.market_waivers'::regclass and tgname like 'live_mark_market_waivers_%') <> 3 then
    raise exception 'v4.58 waivers: market_waivers needs its three live_mark triggers';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'replacement_signings'
        and column_name in ('pos_group', 'alerted_at', 'lapsed_why')) <> 3 then
    raise exception 'v4.58 waivers: replacement_signings is missing a shortfall column';
  end if;
  if (select count(*) from cron.job where jobname = 'market-tick' and active and schedule = '10 seconds'
        and command = 'select public.market_tick()') <> 1 then
    raise exception 'v4.58 waivers: the market-tick job must exist exactly once';
  end if;
  if position($w$('market-tick', interval '10 minutes')$w$ in pg_get_functiondef('public.automation_watchdog()'::regprocedure)) = 0 then
    raise exception 'v4.58 waivers: the watchdog does not watch market-tick';
  end if;
  if position('(a->>''p_not_inactive'')::boolean' in pg_get_functiondef('public._mgmt_execute(public.team_mgmt_moves)'::regprocedure)) = 0
     or position('public._market_waive_check(v_team' in pg_get_functiondef('public.mgmt_request_move(text,text,jsonb,text)'::regprocedure)) = 0 then
    raise exception 'v4.58 waivers: the approval queue does not carry the confirmation';
  end if;
  if position('''waiver_claim'', ''market_bid'', ''market_placed''' in pg_get_functiondef('public.notify_roster_add()'::regprocedure)) = 0
     or position('if public.market_on(old.season_id) then' in pg_get_functiondef('public.notify_roster_remove()'::regprocedure)) = 0
     or position('You were placed on waivers by' in pg_get_functiondef('public.notify_roster_remove()'::regprocedure)) = 0 then
    raise exception 'v4.58 waivers: the Season 2 notice copy is missing';
  end if;
  if position('hint = ''fill_pending''' in pg_get_functiondef('public.market_claim(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'v4.58 waivers: market_claim does not wait for the post-draft fill';
  end if;
  v_def := pg_get_functiondef('public._place_for_unused_picks(uuid,integer)'::regprocedure);
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = '_place_for_unused_picks') <> 1
     or (length(v_def) - length(replace(v_def, 'perform public._market_club_lock(v_team.id);', ''))) / length('perform public._market_club_lock(v_team.id);') <> 1
     or position('if v_market then perform public._market_club_lock(v_team.id); end if;' in v_def)
        > position('if v_market and (public.roster_min_gap(p_season, v_team.id)->>''open'')::int <= 0 then' in v_def) then
    raise exception 'v4.58 waivers: the post-draft fill does not take the club lock once, before it reads the roster';
  end if;
  if public.season_rules((select id from public.seasons where number = 1)) <> s1_rules then
    raise exception 'v4.58 waivers: season_rules(Season 1) changed';
  end if;
  if public.market_on((select id from public.seasons where number = 1)) then
    raise exception 'v4.58 waivers: Season 1 must not be a market season';
  end if;
end $chk$;

/* Rehearsal on production, 2026-11-24 (main session), one transaction rolled back by its closing raise, with the three
   draft-night records prepended: REHEARSAL OK: T1 T2 T3 T4 T22 T23 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19
   T20 T21. Fixed on the way: a self-check had a bare CASE inside a plpgsql IF condition (it ends the condition at its
   first THEN), now parenthesized; and T19 now bans through ban_player (a bare update of profiles.banned is reverted by
   guard_profile_role, so T21 read the wrong reason).
   Applied 2026-11-24 as migration v458d_s2_waivers. */
-- <<< record text

-- the world
do $w$
declare v_s2 uuid := (select id from public.seasons where number = 2);
        v_t uuid[] := (select array_agg(id order by code) from (select id, code from public.teams order by code limit 4) x);
        v_cap bigint := (select salary_cap from public.seasons where number = 2);
        v_f uuid[]; v_d uuid[]; v_g uuid[]; v_each bigint; i int; v_c uuid;
begin
  if not public.market_on(v_s2) then raise exception 'world: Season 2 is not a market season'; end if;
  if v_cap <> 30000000 then raise exception 'world: the Season 2 cap is %, expected $30M (db-guards)', v_cap; end if;
  if exists (select 1 from public.roster_spots where season_id = v_s2) then
    raise exception 'world: Season 2 already has roster spots. This rehearsal needs an empty Season 2: rehearse and apply the waivers and minimums records before the Dec 5 seating (main session ruling, 2026-11-23).';
  end if;
  if exists (select 1 from public.draft_picks where season_number = 2) then
    raise exception 'world: Season 2 already has a draft board. T23 runs the real post-draft fill, which would fill every unused pick: rehearse before the board is generated.';
  end if;
  select id into v_c from public.profiles where role = 'commissioner' order by created_at limit 1;
  if v_c is null then raise exception 'world: no commissioner to act as'; end if;
  /* The commissioner runs the Season 2 rollover (public.start_next_season) before any Season 2 seat or apply (main
     session, 2026-11-23). Before it ran, 129 Season 1 player contracts were still active, and for their holders
     contracts_one_active refused every Season 2 roster insert (a seat, a pick, a claim, a draw). It ran on production on
     2026-11-23 at about 10:30 PM ET, so this step now skips; it stays, under a commissioner's claims and only while the
     rollover is still owed, so the rehearsal also models it on a copy taken before. No case relies on a Season 1
     contract. Nothing it posts leaves the transaction. */
  if exists (select 1 from public.contracts c where c.status in ('active', 'signed') and not coalesce(c.is_manager, false)
               and c.start_season < (select s.number from public.seasons s where s.id = v_s2)) then
    perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
    perform public.start_next_season(v_s2);
    perform set_config('request.jwt.claims', '', true);
  end if;
  if exists (select 1 from public.draft_state where season_number = 2) then
    update public.draft_state set status = 'complete' where season_number = 2;
  else
    insert into public.draft_state (season_number, status) values (2, 'complete');
  end if;
  select array_agg(r.profile_id order by r.created_at) filter (where public.pos_group(r.position) = 'F'),
         array_agg(r.profile_id order by r.created_at) filter (where public.pos_group(r.position) = 'D'),
         array_agg(r.profile_id order by r.created_at) filter (where public.pos_group(r.position) = 'G')
    into v_f, v_d, v_g
    from public.season_registrations r join public.profiles p on p.id = r.profile_id
   where r.season_id = v_s2 and r.status <> 'declined' and not coalesce(p.banned, false) and p.discord_id is not null
     and not public.is_suspended(r.profile_id)
     and not exists (select 1 from public.teams t where r.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id));
  if cardinality(v_f) < 19 or cardinality(v_d) < 7 or cardinality(v_g) < 5 then raise exception 'world: not enough sign-ups'; end if;
  -- Owners: F[1..4]
  for i in 1..4 loop update public.teams set owner_profile_id = v_f[i] where id = v_t[i]; end loop;
  -- A: F5..F9 = F1..F5 (F4 = v_f[8] at $3M), D1 D2 = v_d[1..2], G1 = v_g[1]
  for i in 5..9 loop
    insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
      values (v_s2, v_t[1], v_f[i], 10 + i, (select position from public.season_registrations where season_id = v_s2 and profile_id = v_f[i]),
              case when i = 8 then 3000000 else 750000 end, 'draft');
  end loop;
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin) values
    (v_s2, v_t[1], v_d[1], 31, (select position from public.season_registrations where season_id = v_s2 and profile_id = v_d[1]), 750000, 'draft'),
    (v_s2, v_t[1], v_d[2], 32, (select position from public.season_registrations where season_id = v_s2 and profile_id = v_d[2]), 750000, 'draft'),
    (v_s2, v_t[1], v_g[1], 33, 'G', 750000, 'draft');
  -- B: F10 F11, D3, G2
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin) values
    (v_s2, v_t[2], v_f[10], 21, (select position from public.season_registrations where season_id = v_s2 and profile_id = v_f[10]), 750000, 'draft'),
    (v_s2, v_t[2], v_f[11], 22, (select position from public.season_registrations where season_id = v_s2 and profile_id = v_f[11]), 750000, 'draft'),
    (v_s2, v_t[2], v_d[3], 23, (select position from public.season_registrations where season_id = v_s2 and profile_id = v_d[3]), 750000, 'draft'),
    (v_s2, v_t[2], v_g[2], 24, 'G', 750000, 'draft');
  -- C: F12..F16, D4..D7, G3 G4 (11 players + the Owner = 12)
  for i in 12..16 loop
    insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
      values (v_s2, v_t[3], v_f[i], 30 + i, (select position from public.season_registrations where season_id = v_s2 and profile_id = v_f[i]), 750000, 'draft');
  end loop;
  for i in 4..7 loop
    insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
      values (v_s2, v_t[3], v_d[i], 50 + i, (select position from public.season_registrations where season_id = v_s2 and profile_id = v_d[i]), 750000, 'draft');
  end loop;
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin) values
    (v_s2, v_t[3], v_g[3], 61, 'G', 750000, 'draft'), (v_s2, v_t[3], v_g[4], 62, 'G', 750000, 'draft');
  -- D: F17..F19, G5, salaries that leave $1M of room
  v_each := (v_cap - 1000000 - public.team_cap_used(v_s2, v_t[4])) / 4;   -- whatever the Owner's seat already counts
  for i in 17..19 loop
    insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
      values (v_s2, v_t[4], v_f[i], 50 + i, (select position from public.season_registrations where season_id = v_s2 and profile_id = v_f[i]), v_each, 'draft');
  end loop;
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
    values (v_s2, v_t[4], v_g[5], 75, 'G', v_each, 'draft');
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  if (select count(*) from public.roster_spots where season_id = v_s2 and team_id = v_t[3]) <> 12 then raise exception 'world: C is not 12 of 12'; end if;
  if public.team_cap_used(v_s2, v_t[4]) <> v_cap - 1000000 then raise exception 'world: D payroll is %', public.team_cap_used(v_s2, v_t[4]); end if;
  if (select salary from public.roster_spots where season_id = v_s2 and profile_id = v_f[8]) <> 3000000 then raise exception 'world: F4 does not earn $3M'; end if;
  perform set_config('rh.s2', v_s2::text, true);
  perform set_config('rh.a', v_t[1]::text, true); perform set_config('rh.b', v_t[2]::text, true);
  perform set_config('rh.c', v_t[3]::text, true); perform set_config('rh.d', v_t[4]::text, true);
  perform set_config('rh.oa', v_f[1]::text, true); perform set_config('rh.ob', v_f[2]::text, true);
  perform set_config('rh.oc', v_f[3]::text, true); perform set_config('rh.od', v_f[4]::text, true);
  perform set_config('rh.f1', v_f[5]::text, true); perform set_config('rh.f2', v_f[6]::text, true);
  perform set_config('rh.f3', v_f[7]::text, true); perform set_config('rh.f4', v_f[8]::text, true);
  perform set_config('rh.f5', v_f[9]::text, true); perform set_config('rh.d1', v_d[1]::text, true);
  perform set_config('rh.f10', v_f[10]::text, true);
  perform set_config('rh.com', v_c::text, true);
  perform set_config('rh.dm0', (select count(*) from public.discord_dms)::text, true);
end $w$;

-- T1 to T5 as A's Owner
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $a$
begin
  begin
    perform public.waive_player(current_setting('rh.f4')::uuid);
    raise exception 'T1 failed: an unconfirmed waiver went through';
  exception when others then
    if sqlerrm not like 'Confirm that this player is not being waived for being inactive.%' then raise; end if;
  end;
  begin
    perform public.waive_player(current_setting('rh.d1')::uuid, true);
    raise exception 'T2 failed: a waiver under the defense minimum went through';
  exception when others then
    if sqlerrm not like 'Season 2 roster minimums: this would leave the % with 1 defenseman, under the minimum of 2.%' then raise; end if;
  end;
  begin
    perform public.waive_player(current_setting('rh.oa')::uuid, true);
    raise exception 'T3 failed: an Owner waived their own seat';
  exception when others then
    if sqlerrm not like '% holds the club''s Owner seat and cannot be waived.' then raise; end if;
  end;
  perform public.waive_player(current_setting('rh.f4')::uuid, true);
end $a$;

-- T22 claims wait for the post-draft fill
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t22$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f4')::uuid and status = 'open'),
                              current_setting('rh.b')::uuid);
  raise exception 'T22 failed: a claim went through before the post-draft fill';
exception when others then
  if sqlerrm <> 'The post-draft fill for skipped picks runs first. Claims open as soon as it has run.' then raise; end if;
end $t22$;

reset role;
select set_config('request.jwt.claims', '', true);
do $t4$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_f4 uuid := current_setting('rh.f4')::uuid; w record;
begin
  select * into w from public.market_waivers where profile_id = v_f4;
  if w.id is null or w.status <> 'open' or w.salary <> 3000000 or w.from_team_id <> current_setting('rh.a')::uuid
     or w.by_office or w.not_inactive_at is null
     or abs(extract(epoch from (w.expires_at - w.waived_at)) - 86400) > 1 then
    raise exception 'T4 failed: the waiver row is wrong: %', to_jsonb(w);
  end if;
  if exists (select 1 from public.roster_spots where season_id = v_s2 and profile_id = v_f4) then raise exception 'T4 failed: the spot is still there'; end if;
  if not exists (select 1 from public.season_registrations where season_id = v_s2 and profile_id = v_f4 and waived_at is not null) then
    raise exception 'T4 failed: waived_at not stamped';
  end if;
  if exists (select 1 from public.contracts where profile_id = v_f4 and status = 'active' and not coalesce(is_manager, false)) then
    raise exception 'T4 failed: the contract is still active';
  end if;
  if not exists (select 1 from public.transactions where season_id = v_s2 and type = 'waive' and description like '% placed <b>% on waivers. Any other club may claim them at $3M until % ET.') then
    raise exception 'T4 failed: no waive transaction';
  end if;
  if (select count(*) from public.discord_dms where profile_id = v_f4 and kind = 'market') <> 1 then raise exception 'T4 failed: expected one DM row'; end if;
  if not exists (select 1 from public.roster_spot_removals where season_id = v_s2 and profile_id = v_f4 and reason = 'waived') then
    raise exception 'T4 failed: the removal was not archived as waived';
  end if;
end $t4$;

-- T23 the real post-draft fill: one skipped pick owed to C (12 of 12, so it lapses), run as the cron runs it
do $t23$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_c uuid := current_setting('rh.c')::uuid; v_held text[]; v_n int;
        v_note int := (select count(*) from public.notifications where title = 'Unused draft pick lapsed');
begin
  /* which of the four clubs' market locks this transaction holds (pg_locks shows a bigint advisory key as its high and
     low 32 bits, objsubid 1). A holds its own from T4's waiver; B's T22 claim was refused before the lock. */
  select array_agg(x.k order by x.k) into v_held
    from (values ('A', current_setting('rh.a')::uuid), ('B', current_setting('rh.b')::uuid), ('C', v_c), ('D', current_setting('rh.d')::uuid)) x(k, t)
   where exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
                   and l.classid = ((hashtext('market:club:' || x.t::text)::bigint >> 32) & 4294967295)::oid
                   and l.objid = (hashtext('market:club:' || x.t::text)::bigint & 4294967295)::oid);
  if v_held is distinct from array['A'] then raise exception 'T23 failed: before the fill the market locks held were %, expected {A}', v_held; end if;
  if exists (select 1 from public.app_config where key = 'postdraft_done_' || v_s2::text) then raise exception 'T23 failed: the fill mark already exists'; end if;
  insert into public.draft_picks (season_number, round, original_team_id, current_team_id, used, skipped) values (2, 10, v_c, v_c, false, true);
  v_n := public._place_for_unused_picks(v_s2, 2);
  if v_n <> 0 then raise exception 'T23 failed: the fill placed % players on a full club', v_n; end if;
  select array_agg(x.k order by x.k) into v_held
    from (values ('A', current_setting('rh.a')::uuid), ('B', current_setting('rh.b')::uuid), ('C', v_c), ('D', current_setting('rh.d')::uuid)) x(k, t)
   where exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
                   and l.classid = ((hashtext('market:club:' || x.t::text)::bigint >> 32) & 4294967295)::oid
                   and l.objid = (hashtext('market:club:' || x.t::text)::bigint & 4294967295)::oid);
  if v_held is distinct from array['A', 'C'] then
    raise exception 'T23 failed: after the fill the market locks held were %, expected {A,C} (the fill locks only the club it works on)', v_held;
  end if;
  if (select count(*) from public.notifications where title = 'Unused draft pick lapsed') <= v_note then
    raise exception 'T23 failed: the commissioners were not told C''s pick lapsed';
  end if;
  if not exists (select 1 from public.app_config where key = 'postdraft_done_' || v_s2::text) then raise exception 'T23 failed: the fill wrote no mark'; end if;
  delete from public.draft_picks where season_number = 2 and current_team_id = v_c and round = 10;
end $t23$;

-- T5 claims are open: the waiving club still cannot claim back
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t5$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f4')::uuid and status = 'open'),
                              current_setting('rh.a')::uuid);
  raise exception 'T5 failed: the waiving club claimed its player back';
exception when others then
  if sqlerrm not like 'Your club placed % on waivers, so it cannot claim them back.%' then raise; end if;
end $t5$;
reset role;
select set_config('request.jwt.claims', '', true);

-- T6 C is full, T7 D is over the cap, T8 B claims, T9 D is late
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oc'), 'role', 'authenticated')::text, true);
do $t6$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f4')::uuid), current_setting('rh.c')::uuid);
  raise exception 'T6 failed: a full club claimed';
exception when others then
  if sqlerrm <> 'Your roster is full (12 of 12). Waive a player first.' then raise; end if;
end $t6$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.od'), 'role', 'authenticated')::text, true);
do $t7$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f4')::uuid), current_setting('rh.d')::uuid);
  raise exception 'T7 failed: a club without cap room claimed';
exception when others then
  if sqlerrm not like 'Claiming % at $3M would put your club at $32M, over the $30M cap.' then raise; end if;
end $t7$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t8$
declare r jsonb;
begin
  r := public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f4')::uuid), current_setting('rh.b')::uuid);
  if not coalesce((r->>'ok')::boolean, false) or (r->>'salary')::bigint <> 3000000 then raise exception 'T8 failed: %', r; end if;
end $t8$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.od'), 'role', 'authenticated')::text, true);
do $t9$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f4')::uuid), current_setting('rh.d')::uuid);
  raise exception 'T9 failed: a second claim went through';
exception when others then
  if sqlerrm not like 'The % already claimed % at % ET. The first claim wins.' then raise; end if;
end $t9$;

reset role;
select set_config('request.jwt.claims', '', true);
do $t8v$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_f4 uuid := current_setting('rh.f4')::uuid; v_b uuid := current_setting('rh.b')::uuid;
begin
  if not exists (select 1 from public.roster_spots where season_id = v_s2 and team_id = v_b and profile_id = v_f4
                   and origin = 'waiver_claim' and salary = 3000000 and squad = 'pro') then
    raise exception 'T8 failed: no waiver_claim spot at $3M on B';
  end if;
  if not exists (select 1 from public.contracts where profile_id = v_f4 and team_id = v_b and status = 'active'
                   and salary = 3000000 and start_season = 2 and end_season = 2) then
    raise exception 'T8 failed: no Season 2 contract at $3M';
  end if;
  if not exists (select 1 from public.market_waivers where profile_id = v_f4 and status = 'claimed' and claimed_team_id = v_b and claimed_by is not null) then
    raise exception 'T8 failed: the waiver is not claimed by B';
  end if;
  if not exists (select 1 from public.season_registrations where season_id = v_s2 and profile_id = v_f4 and status = 'assigned') then
    raise exception 'T8 failed: the sign-up is not assigned';
  end if;
  if not exists (select 1 from public.transactions where season_id = v_s2 and type = 'claim' and description like '% claimed <b>% off waivers from the % at $3M.') then
    raise exception 'T8 failed: no claim transaction';
  end if;
  execute 'set constraints all immediate';   -- the deferred roster checks pass on the claim
  execute 'set constraints all deferred';
end $t8v$;

-- T10 expiry by the tick
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
select public.waive_player(current_setting('rh.f3')::uuid, true);
reset role;
select set_config('request.jwt.claims', '', true);
do $t10$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_f3 uuid := current_setting('rh.f3')::uuid; p record;
begin
  update public.market_waivers set waived_at = clock_timestamp() - interval '25 hours', expires_at = clock_timestamp() - interval '1 hour'
   where profile_id = v_f3 and status = 'open';
  /* a stale heartbeat, so the tick must bump updated_at on the conflict path (the office reads a heartbeat's age from it) */
  insert into public.app_config (key, value, updated_at) values ('rl_market-tick', 'stale', now() - interval '1 day')
    on conflict (key) do update set value = 'stale', updated_at = now() - interval '1 day';
  perform public.market_tick();
  if not exists (select 1 from public.market_waivers where profile_id = v_f3 and status = 'cleared' and cleared_at is not null) then
    raise exception 'T10 failed: the tick did not clear the waiver';
  end if;
  if not exists (select 1 from public.transactions where season_id = v_s2 and type = 'clear' and description like '<b>%</b> cleared waivers from the % and joined the training camp pool.') then
    raise exception 'T10 failed: no clear transaction';
  end if;
  if not exists (select 1 from public.app_config where key = 'rl_market-tick' and value <> 'stale' and updated_at >= now()) then
    raise exception 'T10 failed: no heartbeat, or its updated_at was not bumped';
  end if;
  if exists (select 1 from public.app_config where key = 'rl_market-tick_result' and (value::jsonb->>'ok') = 'false') then
    raise exception 'T10 failed: the tick recorded a failure: %', (select value from public.app_config where key = 'rl_market-tick_result');
  end if;
  /* a private credit (gp_credits, the 2026-10 PRIVATE credits ruling) must never become a public game or bid eligibility:
     with six credited games F3 still shows 0 games and is not eligible */
  insert into public.gp_credits (season_id, profile_id, games, reason) values (v_s2, v_f3, 6, 'rehearsal: a private credit');
  select * into p from public.market_pool(v_s2) mp where mp.profile_id = v_f3;
  if p.profile_id is null or p.source <> 'waivers' or p.gp <> 0 or p.eligible or p.needs <> 6 then
    raise exception 'T10 failed: market_pool row for the cleared player is wrong: %', to_jsonb(p);
  end if;
end $t10$;

-- T11 a claim on the cleared waiver, T12 the suspended bar
insert into public.suspensions (profile_id, reason, mode, ends_at, scope, season_id)
  values (current_setting('rh.f5')::uuid, 'rehearsal', 'date', now() + interval '1 day', 'play', current_setting('rh.s2')::uuid);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t11$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f3')::uuid), current_setting('rh.b')::uuid);
  raise exception 'T11 failed: a cleared waiver was claimed';
exception when others then
  if sqlerrm not like '% cleared waivers and joined the training camp pool.' then raise; end if;
end $t11$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t12$
begin
  perform public.waive_player(current_setting('rh.f5')::uuid, true);
  raise exception 'T12 failed: a suspended player was waived by the club';
exception when others then
  if sqlerrm not like 'Rule 7.2: % is suspended and cannot be waived until the suspension is served.%' then raise; end if;
end $t12$;

-- T13 the office waives with no confirmation
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.com'), 'role', 'authenticated')::text, true);
select public.waive_player(current_setting('rh.f1')::uuid);
reset role;
select set_config('request.jwt.claims', '', true);
do $t13$
begin
  if not exists (select 1 from public.market_waivers where profile_id = current_setting('rh.f1')::uuid and status = 'open'
                   and by_office and not_inactive_at is null) then
    raise exception 'T13 failed: the office waiver row is wrong';
  end if;
end $t13$;

-- T14 after the movement deadline
update public.seasons set moves_lock_override = 'locked' where id = current_setting('rh.s2')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t14a$
begin
  perform public.waive_player(current_setting('rh.f2')::uuid, true);
  raise exception 'T14 failed: a club waived after the deadline';
exception when others then
  if sqlerrm <> 'Waivers closed at the movement deadline.' then raise; end if;
end $t14a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t14b$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f1')::uuid and status = 'open'),
                              current_setting('rh.b')::uuid);
  raise exception 'T14 failed: a club claimed after the deadline';
exception when others then
  if sqlerrm <> 'Claims closed at the movement deadline.' then raise; end if;
end $t14b$;
reset role;
select set_config('request.jwt.claims', '', true);
update public.seasons set moves_lock_override = 'auto' where id = current_setting('rh.s2')::uuid;

-- T15 RLS and grants as anon, then as a member
set local role anon;
do $t15a$
declare n int;
begin
  select count(*) into n from public.market_waivers;
  if n < 3 then raise exception 'T15 failed: anon sees % waivers, expected at least 3', n; end if;
  begin
    perform (select waived_by from public.market_waivers limit 1);
    raise exception 'T15 failed: anon read waived_by';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.market_waivers (season_id, profile_id, from_team_id, position, salary, waived_by, by_office, expires_at)
      values (current_setting('rh.s2')::uuid, current_setting('rh.f2')::uuid, current_setting('rh.a')::uuid, 'C', 750000,
              current_setting('rh.oa')::uuid, true, now() + interval '1 day');
    raise exception 'T15 failed: anon wrote a waiver';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.market_claim(gen_random_uuid(), current_setting('rh.b')::uuid);
    raise exception 'T15 failed: anon called market_claim';
  exception when insufficient_privilege then null;
  end;
end $t15a$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t15b$
begin
  begin
    perform (select claimed_by from public.market_waivers limit 1);
    raise exception 'T15 failed: a member read claimed_by';
  exception when insufficient_privilege then null;
  end;
  begin
    perform (select void_why from public.market_waivers limit 1);
    raise exception 'T15 failed: a member read void_why';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.market_waivers (season_id, profile_id, from_team_id, position, salary, waived_by, by_office, expires_at)
      values (current_setting('rh.s2')::uuid, current_setting('rh.f2')::uuid, current_setting('rh.a')::uuid, 'C', 750000,
              current_setting('rh.ob')::uuid, true, now() + interval '1 day');
    raise exception 'T15 failed: a member wrote a waiver';
  exception when insufficient_privilege then null;
  end;
end $t15b$;

-- T16 market_club_state
do $t16$
declare s jsonb;
begin
  s := public.market_club_state(current_setting('rh.b')::uuid);
  if not (s ? 'leading') or (s->>'committed')::bigint <> 0 or (s->'counts'->>'F')::int <> 4 or (s->>'active')::int <> 6 then
    raise exception 'T16 failed: B''s own view is wrong: %', s;
  end if;
end $t16$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t16b$
declare s jsonb;
begin
  s := public.market_club_state(current_setting('rh.b')::uuid);
  if s ? 'leading' or s ? 'free_room' then raise exception 'T16 failed: another club sees B''s leads: %', s; end if;
end $t16b$;
reset role;
select set_config('request.jwt.claims', '', true);

-- T18 to T21: a waiver whose player leaves the pool's reach while it runs (review, 2026-11-23)
select set_config('rh.reg_f1', (select id::text from public.season_registrations
                                  where season_id = current_setting('rh.s2')::uuid and profile_id = current_setting('rh.f1')::uuid), true);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.com'), 'role', 'authenticated')::text, true);
select public.office_withdraw_registration(current_setting('rh.reg_f1')::uuid, 'rehearsal');   -- T18: F1's office waiver is open
select public.waive_player(current_setting('rh.f2')::uuid);                                     -- T19: the office waives F2
select public.waive_player(current_setting('rh.f10')::uuid);                                    -- T20: the office waives B's F10
select public.ban_player(current_setting('rh.f2')::uuid, 'Rehearsal: banned while on waivers.'); -- T19: then bans F2 through the real door
reset role;
select set_config('request.jwt.claims', '', true);
do $t19$
begin
  /* T19's ban took: the flag is set and the sign-up is gone. The first run modeled the ban here (the discipline removal,
     then a bare UPDATE of profiles.banned under no claims); guard_profile_role silently put the flag back (neither a
     trusted writer nor a commissioner), so T21 read "sign-up for the season withdrawn" for F2. The ban now goes through
     ban_player under the commissioner's claims (main session, 2026-11-24). */
  if not public.is_banned(current_setting('rh.f2')::uuid)
     or exists (select 1 from public.season_registrations where season_id = current_setting('rh.s2')::uuid
                  and profile_id = current_setting('rh.f2')::uuid) then
    raise exception 'T19 failed: ban_player did not ban F2 and withdraw their Season 2 sign-up';
  end if;
  /* T20: the office places F10 on D by hand while F10's waiver is open */
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary)
    values (current_setting('rh.s2')::uuid, current_setting('rh.d')::uuid, current_setting('rh.f10')::uuid, 88,
            (select position from public.season_registrations where season_id = current_setting('rh.s2')::uuid
                and profile_id = current_setting('rh.f10')::uuid), 750000);
  if (select count(*) from public.market_waivers where status = 'open'
        and profile_id in (current_setting('rh.f1')::uuid, current_setting('rh.f2')::uuid, current_setting('rh.f10')::uuid)) <> 3 then
    raise exception 'T18 failed: expected the three waivers still open before the claims and the tick';
  end if;
end $t19$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t18$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f1')::uuid and status = 'open'),
                              current_setting('rh.b')::uuid);
  raise exception 'T18 failed: a player whose sign-up was withdrawn was claimed';
exception when others then
  if sqlerrm not like '% can no longer be claimed: they are no longer in the training camp pool.' then raise; end if;
end $t18$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.od'), 'role', 'authenticated')::text, true);
do $t19b$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f2')::uuid and status = 'open'),
                              current_setting('rh.d')::uuid);
  raise exception 'T19 failed: a banned player was claimed';
exception when others then
  if sqlerrm not like '% can no longer be claimed: they are no longer in the training camp pool.' then raise; end if;
end $t19b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t20$
begin
  perform public.market_claim((select id from public.market_waivers where profile_id = current_setting('rh.f10')::uuid and status = 'open'),
                              current_setting('rh.a')::uuid);
  raise exception 'T20 failed: a player already on a roster was claimed';
exception when others then
  if sqlerrm not like '% can no longer be claimed: they are no longer in the training camp pool.' then raise; end if;
end $t20$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t21$
declare v_s2 uuid := current_setting('rh.s2')::uuid;
        v_three uuid[] := array[current_setting('rh.f1')::uuid, current_setting('rh.f2')::uuid, current_setting('rh.f10')::uuid];
        v_clear int; v_dm int; v_net bigint; v_bell int;
begin
  v_clear := (select count(*) from public.transactions where season_id = v_s2 and type = 'clear');
  v_dm := (select count(*) from public.discord_dms where profile_id = any(v_three));
  v_bell := (select count(*) from public.notifications where profile_id = any(v_three) and title = 'You cleared waivers');
  v_net := (select count(*) from net.http_request_queue);
  perform public.market_tick();
  if (select count(*) from public.market_waivers where profile_id = any(v_three) and status = 'void' and void_why is not null
        and cleared_at is not null and expires_at > clock_timestamp()) <> 3 then
    raise exception 'T21 failed: the tick did not void the three waivers at once: %',
      (select jsonb_agg(jsonb_build_object('status', status, 'why', void_why)) from public.market_waivers where profile_id = any(v_three));
  end if;
  if (select void_why from public.market_waivers where profile_id = current_setting('rh.f1')::uuid) <> 'sign-up for the season withdrawn'
     or (select void_why from public.market_waivers where profile_id = current_setting('rh.f2')::uuid) <> 'banned from the league'
     or (select void_why from public.market_waivers where profile_id = current_setting('rh.f10')::uuid) <> 'placed on a roster while on waivers' then
    raise exception 'T21 failed: a void reason is wrong: f1 %, f2 %, f10 %',
      (select void_why from public.market_waivers where profile_id = current_setting('rh.f1')::uuid),
      (select void_why from public.market_waivers where profile_id = current_setting('rh.f2')::uuid),
      (select void_why from public.market_waivers where profile_id = current_setting('rh.f10')::uuid);
  end if;
  if (select count(*) from public.transactions where season_id = v_s2 and type = 'clear') <> v_clear
     or (select count(*) from public.discord_dms where profile_id = any(v_three)) <> v_dm
     or (select count(*) from public.notifications where profile_id = any(v_three) and title = 'You cleared waivers') <> v_bell
     or (select count(*) from net.http_request_queue) <> v_net then
    raise exception 'T21 failed: a voided waiver was announced';
  end if;
  if exists (select 1 from public.app_config where key = 'rl_market-tick_result' and (value::jsonb->>'ok') = 'false') then
    raise exception 'T21 failed: the tick recorded a failure: %', (select value from public.app_config where key = 'rl_market-tick_result');
  end if;
end $t21$;

-- T17 and the verdict
do $v$
declare v_s2 uuid := current_setting('rh.s2')::uuid;
begin
  if exists (select 1 from public.market_pool(v_s2) mp
              where mp.profile_id in (current_setting('rh.f4')::uuid, current_setting('rh.f1')::uuid, current_setting('rh.f2')::uuid)) then
    raise exception 'T17 failed: a claimed, open-waiver or rostered player is in the pool';
  end if;
  if (select count(*) from public.discord_dms)::int - current_setting('rh.dm0')::int < 4 then
    raise exception 'T17 failed: expected the waive, claim, clear and office-waive DMs in this transaction';
  end if;
  raise exception 'REHEARSAL OK: T1 T2 T3 T4 T22 T23 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19 T20 T21';
end $v$;
