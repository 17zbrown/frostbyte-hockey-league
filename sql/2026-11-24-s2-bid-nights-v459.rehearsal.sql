-- Rehearsal for sql/2026-11-24-s2-bid-nights-v459.sql (market-engine Part 3, Saturday bidding). The main session runs it
-- on production as ONE execute_sql call: one transaction that ends in an uncaught raise, so everything rolls back
-- (CLAUDE.md, Database change protocol step 2). Agents never run it.
--
-- Prerequisites: v4.58 live (db-guards, the waivers and minimums records: market_on, roster_min_gap, the Season 2 mk keys,
-- market_pool, market_tick with its shortfall draw step, the 'market_bid' origin). Nothing else needs prepending: the
-- record's own text sits between the markers below, byte for byte (tools/s2-bid-nights-v459.test.cjs pins it).
-- When: on today's production data, before the Sat Dec 5 seating and before the Season 2 schedule exists. The world needs
-- an empty Season 2 (no roster spots, no games, no bid night) and stops at its first check otherwise.
-- Before and after, outside the transaction, count net.http_request_queue and discord_dms rows: both must be unchanged.
-- pg_net is transactional and the bot only sees committed discord_dms rows.
--
-- The world, built inside the transaction from real Season 2 sign-ups (members only, no names written here): Season 2's
-- draft marked complete and its post-draft fill mark set; five clubs (the first five by code), each with an Owner seated
-- the ordinary way (a teams update, so ensure_manager_rostered gives the seat its spot):
--   A: Owner (F) + 3 F, 2 D, 1 G.        B: the same.        C: Owner + 7 F, 3 D, 1 G (12 of 12).
--   D: Owner + 3 F, 2 D, 1 G whose salaries leave $1M of cap room.
--   E: Owner + 6 F, 3 D and no goaltender (10 of 12, one goaltender short of the 3/2/1 minimums).
-- A Season 2 schedule on the real calendar: week 1 Wed Dec 16 to Fri Dec 18 (two games a night, all six final), then no
-- games over Christmas and New Year, weeks 2 to 6 from Jan 6 (one game a night, Wednesday to Friday), the movement
-- deadline week being week 4 (Jan 20 to 22). Five pool players (three forwards Pf1 to Pf3, a defenseman Pd1, a goaltender
-- Pg1) have box-score lines in all six final games; a sixth forward P6 has five (one short of bid eligibility).
-- Cases:
--   T1  market_calendar (as anon): bid nights Dec 19, Jan 9, Jan 16; Dec 26 and Jan 2 skipped (no games); nothing after
--       the Jan 23 deadline; the deadline is midnight ET after Fri Jan 22; the next bid night is Dec 19.
--   T2  the open step: nothing at 8:59 PM on Dec 19; at 9:01 PM one night and five open lots, exactly the eligible pool
--       players, in rating order, P6 and every rostered player left out; a second open adds nothing; the pulse marks (a
--       'market' mark newer than any before the open).
--   T3  bidding on Pf1: A opens at $750K (countdown five minutes, one DM to the player); A again: own_top; B at the old
--       price: price_moved; B $1M; A $1.25M; B jumps to $2M: price_moved; three bids, one DM.
--   T4  C (12 of 12) bids on Pf2: no_spot.
--   T5  D leads Pf2 at $750K; D on Pf3: over_cap, counting the bid it leads.
--   T6  E leads Pg1 (the goaltender it lacks), then bids on Pf3 and is accepted: the led goaltender counts toward the
--       minimums (a count that ignored led lots' groups would refuse it).
--   T7  hidden bidders: anon and C read no bid on Pf1, A reads its own two, a commissioner reads all three; the lot shows
--       the price and the count and no club; nobody reads placed_by.
--   T8  market_club_state: A's own Owner sees A's lead and committed money; B's Owner sees no lead of A's.
--   T9  void: a club Owner cannot void; a commissioner voids Pg1 (E's lead): everyone now reads that lot's bid; E's bid
--       on Pd1 is refused under the minimums (its forward lead fills no goaltender spot); a bid on the void lot: void.
--   T10 pause and resume: a club Owner cannot pause; a commissioner pauses: running countdowns freeze; a bid: paused;
--       after a two-minute pause the resume restores each countdown's time and moves the 10 PM cut two minutes later.
--   T11 sale: Pf1's countdown runs out and market_tick signs Pf1 to A at $1.25M (origin market_bid, a contract for this
--       season only, sign-up assigned, a 'bid' transaction, a DM); the tick records no failure; anon now reads all bids.
--   T12 a sale the cap guard refuses: D gets a player by hand at $750K (the contract floor apply_contract_on_roster sets),
--       leaving about $250K of room, then Pf2's countdown runs out at $750K: the lot is void with the cap error for the
--       office, no roster spot, the staff channel (its own message, counted by text) and D's seats are told, the tick
--       goes on.
--   T13 the 10 PM cut: B outbids E on Pf3; past 10 PM a bid on the open Pd1 is refused; the tick makes Pd1 unsold and the
--       night 'closing'; E's raise on the running Pf3 still lands.
--   T14 close: Pf3 sells to E; the night closes and its recap posts once (the _announce_once mark, recap_at, the recap's
--       own request counted by its title, naming Jan 9 as the next bid night for the unbid player); a second tick posts
--       no second recap; a bid on the unsold Pd1: over.
--   T15 market_calendar after: Dec 19 closed, the next bid night Jan 9.
--   T16 boards: A saves a two-player board; B cannot read it; a ceiling off the bid steps, a rostered player, a player
--       listed twice, a malformed player id and a malformed ceiling are refused in plain words; anon cannot read boards.
--   T17 no client writes: a member cannot insert a bid or update a lot; anon cannot call market_bid (refused by the
--       grant, not by the seat check); a member cannot read placed_by or void_detail.
--   T18 the open step's edges: nothing on a holiday Saturday (Dec 26), nothing after the deadline (Jan 23), nothing while
--       the office holds moves locked; Jan 9 then opens with the three players still eligible (unbid and void lots stay
--       eligible), P6 still out. Then the office pauses Jan 9 and leaves it on: Jan 16 opens with no lot for a player
--       still up for auction on Jan 9, and the staff channel is told the paused night holds them.
--   T19 Season 1: no market, no calendar, season_rules unchanged (the record's self-checks also run above).

begin;

-- >>> record text: sql/2026-11-24-s2-bid-nights-v459.sql
-- v4.59: Season 2 Saturday bidding (market-engine Part 3). A live event from 9 to 10 PM ET on the Saturday of every week
-- with league games, until the movement deadline: every training camp pool player with six games is up for auction at
-- 9 PM, each bid starts or resets a five-minute countdown, and the last bidder signs the player at that price to the end
-- of the season.
--
-- Rulings this builds (league law, quoted from the commissioner):
--   Season 2 format (2026-10-12/13, Chapter S2): the first bid on a player is $750K and every raise is exactly +$250K;
--     every bid starts a five-minute countdown and a raise resets it; when it expires the last bidder wins at that price on
--     a contract to season's end; bidder identities stay hidden until the player's auction ends; ties are impossible; no
--     new auctions open after 10 PM, but a running countdown finishes; unbid players stay eligible for the next event;
--     events stop at the movement deadline; bids are limited to the club's roster and cap room.
--   2026-11-02: "Only training camp players with at least 6 games played can be bid on at the saturday bidding events."
--   2026-11-02: "bids always start at 750k and can only be raised by 250k at a time. a team cannot place two bids in a row
--     on the same player. They need to wait for another team to bid in order to raise their own bid on a player."
--   2026-11-02: "a team cannot place a bid on a player that would take them over their salary cap." (Read as: the next
--     price plus every bid the club currently leads must fit its cap room; the same for roster spots.)
--   2026-11-17 (confirmed): "Stop at the deadline but training camp players can fill in for teams even past the deadline".
--   2026-11-23 (evening, market package, every recommended default accepted): no automatic bidding; the office pause
--     freezes and resumes every countdown; pause and resume belong ONLY to the Draft and Bidding manager or a
--     commissioner. (Late night) commissioners pause and resume bidding until a Draft and Bidding manager is seated.
--   2026-11-23 (night): "Every week should have a bidding if games are played up until after the deadline" (every Saturday
--     of a game week until the movement deadline; Dec 19 stays the first bid night).
--
-- What changes (every new RPC tests the market season first; Season 1 has no market and nothing it runs is touched):
--   1. Four tables, RLS on, every API grant revoked first, no client write of any kind (every write is a definer RPC):
--      market_bid_nights (one row per night once it opens; Realtime; public except who paused and why),
--      market_lots (one auction per eligible player per night, the list fixed at 9 PM in rating order; Realtime; public
--        except the office's void detail and who voided; the leading club is never stored on the lot while it runs),
--      market_bids (Realtime; a club reads only its own bids while a lot runs, whoever runs the room reads all
--        (can_run_market), everyone reads the whole history once the lot is over; who placed a bid is office only),
--      market_boards (a club's private plan: its own front office and the commissioners read it; never a proxy bidder).
--      The 'market' pulse domain marks on nights and on lot state changes (a raise moves only price, bids and the clock,
--      which Realtime carries, so it does not wake every page).
--   2. public.can_run_market(): who runs Saturday bidding (pause, resume, void, and reading live bids). Commissioners
--      only for now; the committees record widens it to the seated Draft and Bidding manager (contracts/season-rules.md).
--      Created FIRST, before any policy or function that calls it (CREATE POLICY resolves its functions when it runs).
--   3. public._market_bid_nights(season): the ONE definition of the bid nights, computed from the schedule and
--      public.movement_deadline_at, never hard-coded. A Saturday is a bid night when its Sunday to Saturday week holds a
--      regular-season game, its 9 PM ET is after the draft and before the movement deadline. Saturdays between the first
--      and the last bid night with no games are listed as skipped (holiday weeks).
--   4. public.market_calendar(season) (anon and authenticated): the game nights, the bid nights with their state, the
--      next bid night, the deadline.
--   5. public.market_bid(lot, team, expect) (authenticated): the bid, refusals in the concept's order (js/market.js),
--      each with a hint the client branches on.
--   6. market_tick steps, each in its own block above the "steps end" line: close lots (a lot whose player left the pool
--      or is suspended is void at once; a countdown that ran out sells the player; open lots past 10 PM become unsold),
--      close the night, post the recap once (public._announce_once to the news channel), open the night at 9 PM.
--   7. public.market_pause, public.market_resume, public.market_void_lot (the office tools, can_run_market) and
--      public.save_market_board (a club's plan).
--   8. public._market_led: the real read replaces the waivers record's placeholder, so the waiver claim, the club state
--      and the bid all count the bids a club leads.
--   9. public._market_draw_shortfalls (the minimums record's random draw): never draws a player up for auction tonight.
--  10. public._market_min_blocked(season, team, group): the ONE test that the 3/2/1 minimums stay reachable after one more
--      player of a group plus every lot the club leads (each led lot fills a spot of its own group). market_bid calls
--      it, and market_claim (the waivers record) is patched by exact anchor to call it in place of its own formula,
--      which ignored the groups of the led lots and would refuse a claim a bid allows.
--
-- Apply order (main session, 2026-11-24, binding): this record BEFORE the committees record. This record creates
-- can_run_market and refuses to run if it already exists; the committees record only patches it by the shortcut marker
-- and requires it to exist. Live bidder identities are visible to whoever can_run_market allows (commissioners, and the
-- seated Draft and Bidding manager once committees land) and to nobody else until the lot ends ("identities hidden
-- until the auction ends; the office runs the room").
--
-- Concurrency (every race has one winner; the main session proves them on a one-day Supabase branch):
--   two bids on one lot: the lot row lock (FOR UPDATE) serializes them, and the second's expected price no longer
--     matches ("price moved"); backstops unique (lot_id, seq) and unique (lot_id, amount), so a tie cannot be stored;
--   one club bidding on two lots at once: the club advisory lock comes first, then the led-bid sum is read in a fresh
--     statement snapshot, so the second bid counts the first;
--   a bid landing as the countdown closes: both need the lot row; the bid tests clock_timestamp() >= ends_at AFTER the
--     lock, and the tick's settle re-evaluates ends_at <= clock_timestamp() on the locked row (SKIP LOCKED), so a lot
--     whose clock a bid just reset is left running;
--   a bid on an open lot at 9:59:59.9 PM: the lot lock, then new_until judged on clock_timestamp();
--   the settle and the same club's next bid: the tick locks the lot, then only TRIES the winner's club lock (skips and
--     retries on the next tick), so the tick never waits on a bid while holding a lot a bid waits for;
--   the tick and a pause: the tick takes nights with SKIP LOCKED and never waits on one, and the pause locks only running
--     lots, which the 10 PM cut (open lots only) never touches;
--   a bid and a pause (review, 2026-11-24): every door takes the night before the lot. A bid holds its night FOR SHARE
--     (bids never block each other) before it locks the lot; the pause and the resume take the night FOR UPDATE, then
--     the running lots. So a bid in flight commits before the pause scans the lots (a first bid's new countdown is
--     frozen with the rest), a bid that arrives during the pause waits and then reads the night as paused, and the two
--     can never deadlock (taking the lot first and the night through the bid's foreign key would);
--   opening a night twice: unique (season_id, night) with ON CONFLICT DO NOTHING; the lots go in only on a real insert.
--
-- Doors only: transactions ('bid', posted to #transactions by notify_discord_transaction), notify_roster_add (the club
-- notice for origin 'market_bid', worded by the waivers record), club_notify with p_room false (the leading club's seats
-- when its lot is withdrawn or its sale fails), notify_staff_ch (the staff channel), _announce_once (the recap, once per
-- night, discord_news_webhook), the DM lane (_market_dm). Every Discord post goes through discord_http_post. A rehearsal
-- sends nothing: pg_net and the discord_dms rows roll back.
--
-- Hints market_bid raises with (branch on error.hint, never on the message): owner_bids, market_closed, manager_suspended,
-- draft_not_done, deadline, over, paused, void, new_closed, price_moved, own_top, unavailable, suspended, no_spot,
-- over_cap, minimums; plus errcode 22023 (a missing argument), 42501 (not that club's seat, or the Owner has not given the
-- seat Free agents access), 28000 (not signed in) and P0002 (no such auction this season).
--
-- Not here: the bid-night load scenario (tools/loadtest.mjs), the site's pulse handling of the 'market' domain and the
-- bid room screens (the concept adapter), the committees record's widening of can_run_market (applied after this one,
-- so a seated Draft and Bidding manager reading live bids and pausing is proved there, not here).
-- Requires: v4.58 live (market_on, roster_min_gap, the Season 2 season_rules mk keys, 'market_bid' in
-- roster_spots_origin_check, the waivers record's market_tick and helpers, the minimums record's _market_draw_shortfalls).
-- When: live before Sat Dec 19, 9 PM ET, the first bid night.
-- Rehearsal: sql/2026-11-24-s2-bid-nights-v459.rehearsal.sql (main session). Results are recorded at the end of this file.

-- 0. preconditions
do $pre$
begin
  if to_regprocedure('public.market_on(uuid)') is null or to_regprocedure('public.roster_min_gap(uuid,uuid,text,uuid)') is null
     or to_regprocedure('public._market_ctx(uuid,text)') is null or to_regprocedure('public._market_dm(uuid,text)') is null
     or to_regprocedure('public._market_jersey(uuid,uuid)') is null or to_regprocedure('public.market_pool(uuid)') is null
     or to_regprocedure('public._market_waiver_void_why(uuid,uuid)') is null
     or to_regprocedure('public._market_draw_shortfalls(uuid)') is null or to_regprocedure('public.market_claim(uuid,uuid)') is null then
    raise exception 'v4.59 bid nights: the v4.58 Season 2 records (db-guards, waivers, minimums) must be applied first';
  end if;
  if position('select null::uuid, null::bigint where false' in pg_get_functiondef('public._market_led(uuid)'::regprocedure)) = 0 then
    raise exception 'v4.59 bid nights: _market_led is no longer the waivers record''s placeholder; read its live body before replacing it';
  end if;
  if position('    -- market-tick steps end' in pg_get_functiondef('public.market_tick()'::regprocedure)) = 0 then
    raise exception 'v4.59 bid nights: market_tick has no steps end line';
  end if;
  if position('''market_bid''' in (select pg_get_constraintdef(oid) from pg_constraint
                                    where conrelid = 'public.roster_spots'::regclass and conname = 'roster_spots_origin_check')) = 0 then
    raise exception 'v4.59 bid nights: roster_spots_origin_check does not accept market_bid (db-guards)';
  end if;
  if to_regclass('public.market_bid_nights') is not null or to_regclass('public.market_lots') is not null
     or to_regclass('public.market_bids') is not null or to_regclass('public.market_boards') is not null then
    raise exception 'v4.59 bid nights: a bid-night table already exists';
  end if;
  /* the main session's apply order (2026-11-24): bid nights first, then committees. A can_run_market that already exists
     means the committees record or a hand edit ran first; replacing it would silently undo a widening, so stop */
  if to_regprocedure('public.can_run_market()') is not null then
    raise exception 'v4.59 bid nights: can_run_market already exists (this record creates it and applies BEFORE the committees record, which only widens it)';
  end if;
  if not coalesce((select public.season_rules(s.id)->'mk' ?& array['bid_open', 'bid_step', 'lot_seconds', 'bid_gp', 'opens', 'new_until']
                     from public.seasons s where s.number = 2), false) then
    raise exception 'v4.59 bid nights: season_rules(Season 2) carries no bidding constants (mk)';
  end if;
end $pre$;

-- 1. who runs Saturday bidding: created before the market_bids policy that calls it (review, 2026-11-24: CREATE POLICY
--    resolves the functions in its USING expression when it runs, so the policy first would stop the record at 42883)
create or replace function public.can_run_market()
returns boolean language sql stable security definer set search_path to '' as $f$
  /* v4.59 (commissioner, 2026-11-23): pause and resume of Saturday bidding belong only to the Draft and Bidding manager or
     a commissioner, and commissioners pause and resume until a Draft and Bidding manager is seated. Also gates voiding a
     lot and reading live bids (main session, 2026-11-24: identities stay hidden until the auction ends, and the office
     runs the room, so whoever this allows reads them). */
  -- shortcut: commissioners only until a Draft and Bidding manager is seated, widen when committee seats exist
  select public.is_commissioner()
$f$;

-- 2. the tables
create table public.market_bid_nights (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  night date not null,                       -- the Saturday, Eastern
  opens_at timestamptz not null,
  new_until timestamptz not null,            -- no new auction after it; a resume moves it later by the pause
  state text not null default 'live' check (state in ('live', 'closing', 'closed')),
  paused_at timestamptz,
  paused_by uuid,
  pause_reason text check (char_length(pause_reason) <= 300),
  closed_at timestamptz,
  recap_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint market_bid_nights_one unique (season_id, night),
  constraint market_bid_nights_window check (new_until > opens_at),
  constraint market_bid_nights_closed_shape check ((state = 'closed') = (closed_at is not null)),
  constraint market_bid_nights_pause_shape check ((paused_at is null) = (paused_by is null) and (state <> 'closed' or paused_at is null)),
  constraint market_bid_nights_recap_shape check (recap_at is null or state = 'closed')
);
comment on table public.market_bid_nights is 'v4.59: Season 2 Saturday bidding. One row per bid night, written when the night opens (market_tick); upcoming and skipped nights come from public.market_calendar.';

create table public.market_lots (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.market_bid_nights(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  position public.hockey_position not null,
  ord int not null check (ord >= 1),         -- rating order, fixed at 9 PM
  gp_at_open int not null check (gp_at_open >= 0),
  state text not null default 'open' check (state in ('open', 'running', 'sold', 'unsold', 'void')),
  price bigint check (price > 0),            -- the top bid
  bids int not null default 0 check (bids >= 0),
  last_bid_at timestamptz,
  ends_at timestamptz,
  paused_remaining interval,
  sold_team_id uuid references public.teams(id) on delete cascade,
  sold_at timestamptz,
  ended_at timestamptz,
  why text,                                  -- public: why a lot is void
  void_detail text,                          -- office only
  voided_by uuid,                            -- office only
  created_at timestamptz not null default clock_timestamp(),
  constraint market_lots_one unique (night_id, profile_id),
  constraint market_lots_ord unique (night_id, ord),
  constraint market_lots_sold_shape check ((state = 'sold') = (sold_team_id is not null) and (state = 'sold') = (sold_at is not null)),
  constraint market_lots_ended_shape check ((state in ('sold', 'unsold', 'void')) = (ended_at is not null)),
  constraint market_lots_void_shape check ((state = 'void') = (why is not null)),
  constraint market_lots_unbid_shape check (state not in ('open', 'unsold') or (bids = 0 and price is null)),
  constraint market_lots_bid_shape check (state not in ('running', 'sold') or (bids >= 1 and price is not null)),
  /* a running countdown either ticks (ends_at) or is frozen by a pause (paused_remaining), never both, never neither */
  constraint market_lots_clock_shape check (state <> 'running' or ((ends_at is null) <> (paused_remaining is null)))
);
comment on table public.market_lots is 'v4.59: one auction per eligible training camp pool player per bid night. The leading club is never stored here while the lot runs (bidders stay hidden until the auction ends); sold_team_id is written at the sale.';
comment on column public.market_lots.void_detail is 'v4.59: the office''s reason a lot was voided (a withdrawal reason, a refused sale''s error, a ban). Office only: no client grant.';
create index market_lots_running on public.market_lots (ends_at) where state = 'running';
create index market_lots_night on public.market_lots (night_id, state);

create table public.market_bids (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.market_lots(id) on delete cascade,
  night_id uuid not null references public.market_bid_nights(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  seq int not null check (seq >= 1),
  amount bigint not null check (amount > 0),
  placed_by uuid not null,                   -- office only
  placed_at timestamptz not null default clock_timestamp(),
  /* the Season 2 format: "ties are impossible", enforced in the table */
  constraint market_bids_seq unique (lot_id, seq),
  constraint market_bids_amount unique (lot_id, amount)
);
create index market_bids_team on public.market_bids (team_id);

create table public.market_boards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null check (rank >= 1),
  ceiling bigint check (ceiling > 0),
  note text check (char_length(note) <= 200),
  updated_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  constraint market_boards_one unique (season_id, team_id, profile_id)
);
comment on table public.market_boards is 'v4.59: a club''s private bid plan (targets, ceilings, notes). No rule effect and never a proxy bidder (commissioner, 2026-11-23: no automatic bidding). Written only through public.save_market_board.';

alter table public.market_bid_nights enable row level security;
alter table public.market_lots enable row level security;
alter table public.market_bids enable row level security;
alter table public.market_boards enable row level security;
revoke all on public.market_bid_nights from public, anon, authenticated;
revoke all on public.market_lots from public, anon, authenticated;
revoke all on public.market_bids from public, anon, authenticated;
revoke all on public.market_boards from public, anon, authenticated;

/* the room is public; who paused, why, who voided and the office's void detail stay with the office (admin_audit holds the
   pause and void reasons for it) */
grant select (id, season_id, night, opens_at, new_until, state, paused_at, closed_at, recap_at, created_at)
  on public.market_bid_nights to anon, authenticated;
grant select (id, night_id, season_id, profile_id, position, ord, gp_at_open, state, price, bids, last_bid_at, ends_at,
              paused_remaining, sold_team_id, sold_at, ended_at, why, created_at)
  on public.market_lots to anon, authenticated;
grant select (id, lot_id, night_id, team_id, seq, amount, placed_at) on public.market_bids to anon, authenticated;
grant select on public.market_boards to authenticated;

create policy "bid nights are public" on public.market_bid_nights for select to anon, authenticated using (true);
create policy "bid lots are public" on public.market_lots for select to anon, authenticated using (true);
/* v4.59 (the Season 2 format: "bidder identities stay hidden until the player's auction ends"): while a lot runs a club
   reads only its own bids (it knows it leads when its newest bid equals the lot's price); whoever runs the room reads
   every bid (can_run_market: commissioners, and the seated Draft and Bidding manager once the committees record widens
   it; main session ruling, 2026-11-24: "the office runs the room"); once the lot is over everyone reads the whole
   history. Realtime applies this policy to every subscriber. */
create policy "bids: own club, the office, or everyone once the auction is over" on public.market_bids for select to anon, authenticated
  using (public.can_run_market() or public.is_gm_of(team_id)
         or exists (select 1 from public.market_lots l where l.id = lot_id and l.state in ('sold', 'unsold', 'void')));
/* the draft_boards pattern: the club's own front office, and the office reads */
create policy "bid boards: own club and the office" on public.market_boards for select to authenticated
  using (public.is_gm_of(team_id) or public.is_commissioner());

/* the league pulse (v4.05): other pages refresh within 10 s. A raise changes only price, bids and the clock, which the
   room gets from Realtime, so it does not mark */
create trigger live_mark_market_bid_nights_ins after insert on public.market_bid_nights
  referencing new table as new_rows for each statement execute function public._live_mark('market', '', '');
create trigger live_mark_market_bid_nights_upd after update on public.market_bid_nights
  referencing old table as old_rows new table as new_rows for each statement execute function public._live_mark('market', '', '');
create trigger live_mark_market_lots_ins after insert on public.market_lots
  referencing new table as new_rows for each statement execute function public._live_mark('market', '', '');
create trigger live_mark_market_lots_upd after update on public.market_lots
  referencing old table as old_rows new table as new_rows for each statement execute function public._live_mark('market', '', 'price,bids,last_bid_at,ends_at,paused_remaining');

/* the room needs sub-second updates, as the draft room does (draft_state, draft_picks) */
alter publication supabase_realtime add table public.market_bid_nights, public.market_lots, public.market_bids;

-- 3. the bid nights: the ONE definition
create or replace function public._market_bid_nights(p_season uuid)
returns table (night date, opens_at timestamptz, new_until timestamptz, skipped boolean)
language sql stable security definer set search_path to '' as $f$
  /* v4.59 (commissioner, 2026-11-23: "Every week should have a bidding if games are played up until after the deadline";
     the Season 2 format: events stop at the movement deadline). Computed from the season's schedule and
     public.movement_deadline_at, never hard-coded: a Saturday is a bid night when its Sunday to Saturday week holds a
     regular-season game that is not voided, and its opening (season_rules mk.opens, Eastern) is after the draft and before
     the movement deadline. Saturdays between the first and the last such week with no games are returned skipped
     (holiday weeks). No schedule, or no deadline yet: no nights. */
  with s as (
    select x.id, x.draft_at, public.movement_deadline_at(x.id) as deadline,
           (public.season_rules(x.id)->'mk'->>'opens')::time as t_open,
           (public.season_rules(x.id)->'mk'->>'new_until')::time as t_new
      from public.seasons x
     where x.id = p_season and public.market_on(x.id)
  ), wk as (
    select distinct (gd.d + (6 - extract(dow from gd.d)::int))::date as sat
      from (select (g.scheduled_at at time zone 'America/New_York')::date as d
              from public.games g
             where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular'
               and not coalesce(g.voided, false) and g.scheduled_at is not null) gd
  ), span as (
    select gs::date as sat
      from (select min(wk.sat) as a, max(wk.sat) as b from wk) m, generate_series(m.a, m.b, interval '7 days') gs
  )
  select sp.sat, (sp.sat + s.t_open) at time zone 'America/New_York', (sp.sat + s.t_new) at time zone 'America/New_York',
         not exists (select 1 from wk where wk.sat = sp.sat)
    from span sp cross join s
   where (sp.sat + s.t_open) at time zone 'America/New_York' < s.deadline
     and (s.draft_at is null or (sp.sat + s.t_open) at time zone 'America/New_York' > s.draft_at)
   order by sp.sat
$f$;

-- 4. the calendar (a read)
create or replace function public.market_calendar(p_season uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $f$
/* v4.59: the market's calendar for a season: game nights (Eastern date, week, stage, games, first puck drop, the T-30 lock),
   bid nights from public._market_bid_nights with their state ('upcoming', 'live', 'closing', 'closed', 'missed' when the
   hour passed with no night opened, or 'skipped' for a week with no games), the next bid night and the movement
   deadline. A season with no schedule returns no nights: the deadline and the nights derive from it. */
declare v_out jsonb;
begin
  if p_season is null then raise exception 'Choose the season.' using errcode = '22023'; end if;
  if not exists (select 1 from public.seasons s where s.id = p_season) then raise exception 'That season does not exist.' using errcode = 'P0002'; end if;
  if not public.market_on(p_season) then
    return jsonb_build_object('season_id', p_season, 'market', false);
  end if;
  select jsonb_build_object(
    'season_id', p_season, 'market', true,
    'deadline', public.movement_deadline_at(p_season),
    'moves_locked', public.moves_locked(p_season),
    'draft_done', public._market_draft_done(p_season),
    'game_nights', coalesce((
      select jsonb_agg(jsonb_build_object('night', gn.gd, 'week', gn.wk, 'stage', gn.st, 'games', gn.cnt, 'first_puck', gn.fp,
                                          'lock_at', public.night_lock_at(p_season, gn.gd)) order by gn.gd, gn.st)
        from (select (g.scheduled_at at time zone 'America/New_York')::date as gd, min(g.week) as wk,
                     coalesce(g.stage, 'regular') as st, count(*)::int as cnt, min(g.scheduled_at) as fp
                from public.games g
               where g.season_id = p_season and not coalesce(g.voided, false) and g.scheduled_at is not null
               group by 1, 3) gn), '[]'::jsonb),
    /* review, 2026-11-24: a night that opened always reports its stored state, even after its week lost every game to a
       move or a void (the schedule would now call that Saturday skipped, or leave it out) */
    'bid_nights', coalesce((
      select jsonb_agg(jsonb_build_object('night', coalesce(n.night, b.night), 'skipped', n.id is null and b.skipped,
               'why', case when n.id is null and b.skipped then 'No league games that week, so no bidding.' end,
               'opens_at', coalesce(n.opens_at, b.opens_at), 'new_until', coalesce(n.new_until, b.new_until), 'id', n.id,
               'state', case when n.id is not null then n.state when b.skipped then 'skipped'
                             when now() >= b.new_until then 'missed' else 'upcoming' end,
               'paused', n.paused_at is not null) order by coalesce(n.night, b.night))
        from public._market_bid_nights(p_season) b
        full join (select x.* from public.market_bid_nights x where x.season_id = p_season) n on n.night = b.night), '[]'::jsonb),
    'next_bid_night', (
      select min(coalesce(n.night, b.night)) from public._market_bid_nights(p_season) b
        full join (select x.* from public.market_bid_nights x where x.season_id = p_season) n on n.night = b.night
       where (n.id is not null and n.state <> 'closed') or (n.id is null and not b.skipped and now() < b.new_until)))
    into v_out;
  return v_out;
end $f$;

-- 5. the bids a club leads: the real read replaces the waivers record's placeholder
create or replace function public._market_led(p_team uuid)
returns table (lot_id uuid, amount bigint) language sql stable security definer set search_path to '' as $f$
  /* v4.58: the running lots whose newest bid is this club's. The cap and spot checks count them ("a team cannot place a
     bid on a player that would take them over their salary cap", commissioner, 2026-11-02).
     v4.59: the real read. A lot past its countdown that the tick has not settled yet is still running, and still led:
     the club has won it. */
  select l.id, b.amount
    from public.market_lots l
    cross join lateral (select x.team_id, x.amount from public.market_bids x where x.lot_id = l.id order by x.seq desc limit 1) b
   where l.state = 'running' and b.team_id = p_team
$f$;

-- 5b. the minimums test the bid and the claim share
create or replace function public._market_min_blocked(p_season uuid, p_team uuid, p_group text)
returns boolean language plpgsql stable security definer set search_path to '' as $f$
/* v4.59 (commissioner, 2026-11-23: "do 3 forwards, 2 defensemen, and 1 goalie"): true when one more player of p_group
   (a bid's lot or a claim's waiver) plus every lot the club leads would leave the 3/2/1 minimums out of reach. Each led
   lot fills a spot of its own group, so it lowers that group's shortfall and the open spots by one. roster_min_gap is
   the one count of the roster; this is the one test of the leads on top of it, called by market_bid and market_claim
   (review, 2026-11-24: the claim's own formula ignored the led lots' groups and refused claims a bid allowed). */
declare v_gap jsonb := public.roster_min_gap(p_season, p_team, p_group, null); v_short int; v_led_n int;
begin
  select count(*)::int into v_led_n from public._market_led(p_team);
  select coalesce(sum(greatest(coalesce((v_gap->>grp.g)::int, 0) - coalesce(led.n, 0), 0)), 0)::int into v_short
    from unnest(array['F', 'D', 'G']) as grp(g)
    left join (select public.pos_group(l.position) as lg, count(*)::int as n
                 from public._market_led(p_team) x join public.market_lots l on l.id = x.lot_id
                group by 1) led on led.lg = grp.g;
  return v_short > coalesce((v_gap->>'open')::int, 0) - v_led_n;
end $f$;

-- 6. the bid
create or replace function public.market_bid(p_lot uuid, p_team uuid, p_expect bigint)
returns jsonb language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59 (the Season 2 format and the 2026-11-02 rulings): "bids always start at 750k and can only be raised by 250k at a
   time. a team cannot place two bids in a row on the same player." The engine sets the amount (the opening price, else
   the top bid plus one step); p_expect is the price the page showed, and any other price is refused, so a jump bid or a
   bid on a moved price cannot land. "a team cannot place a bid on a player that would take them over their salary cap":
   the next price plus every bid the club leads must fit its cap room, and the same for roster spots and the 3/2/1
   minimums (_market_min_blocked over roster_min_gap, the ONE definition). Each bid starts or resets the countdown
   (mk.lot_seconds).
   The refusals follow the concept's order (js/market.js: closed, paused, void, no new auction after 10 PM, over, price,
   own top, eligibility, spot, cap). Races: the club lock, then the night FOR SHARE, then the lot row FOR UPDATE (the
   pause's order: night, then lot); every clock test reads clock_timestamp() after the lock, never the transaction's
   start. guard_roster_cap and the deferred roster checks stay the final authority at the sale.
   A commissioner may bid for a club past the movement deadline, as market_claim lets the office claim (commissioner,
   2026-10-21: "Commissioners may move remove or edit any player at any time"). A countdown already running when the
   office locks moves by hand finishes and sells at the tick; the office pauses or withdraws a lot to stop it. */
declare v_office boolean := public.is_commissioner(); v_season uuid; v_l public.market_lots; v_n public.market_bid_nights;
        v_rules jsonb; v_open bigint; v_step bigint; v_secs int; v_next bigint; v_top uuid; v_name text;
        v_max int; v_cap bigint; v_pay bigint; v_led_n int; v_led bigint; v_active int;
        v_bid uuid; v_ends timestamptz; v_night uuid;
begin
  if p_lot is null or p_team is null or p_expect is null then
    raise exception 'Choose the player, the club and the price you are bidding.' using errcode = '22023';
  end if;
  if not (v_office or public.is_gm_of(p_team)) then
    raise exception 'Only that club''s Owner, GM or AGM can bid for it.' using errcode = '42501';
  end if;
  /* a live bid cannot wait in the Owner's approval queue (mgmt_gate would send it there): open detail 14, accepted */
  if not v_office and public.mgmt_access(p_team, 'freeagents') = 'approve' then
    raise exception 'Your Owner approves this seat''s Free agents moves, and a live bid cannot wait for approval, so ask your Owner to bid.'
      using errcode = '42501', hint = 'owner_bids';
  end if;
  v_season := public._market_ctx(p_team, 'freeagents');
  if public.moves_locked(v_season) and not v_office then
    raise exception 'Bidding closed at the movement deadline.' using errcode = 'check_violation', hint = 'deadline';
  end if;
  perform public._market_club_lock(p_team);
  /* v4.59 (review, 2026-11-24): the night before the lot, as the pause and the resume take them. The night is held FOR
     SHARE (bids never wait on each other; a pause waits for this bid, and a bid waits for a pause and then reads it), and
     a lot never changes night, so its night is read first without a lock */
  select l.night_id into v_night from public.market_lots l where l.id = p_lot and l.season_id = v_season;
  if not found then raise exception 'That auction does not exist.' using errcode = 'P0002'; end if;
  select n.* into v_n from public.market_bid_nights n where n.id = v_night for share;
  select l.* into v_l from public.market_lots l where l.id = p_lot for update;
  if not found or v_l.season_id <> v_season then raise exception 'That auction does not exist.' using errcode = 'P0002'; end if;
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'This player') into v_name from public.profiles p where p.id = v_l.profile_id;

  if v_n.state = 'closed' then
    raise exception 'The bidding on % is over.', v_name using errcode = 'check_violation', hint = 'over';
  end if;
  if v_n.paused_at is not null then
    raise exception 'The league office paused bidding at % ET. Countdowns resume when the pause lifts.',
      to_char(v_n.paused_at at time zone 'America/New_York', 'FMHH12:MI AM') using errcode = 'check_violation', hint = 'paused';
  end if;
  if v_l.state = 'void' then
    raise exception '% is no longer up for bidding tonight.', v_name using errcode = 'check_violation', hint = 'void';
  end if;
  /* the Season 2 format: no new auctions open after 10 PM, but a running countdown finishes */
  if v_l.state = 'open' and clock_timestamp() >= v_n.new_until then
    raise exception 'No bidding opens on a new player after % ET. Countdowns already running finish.',
      to_char(v_n.new_until at time zone 'America/New_York', 'FMHH12:MI AM') using errcode = 'check_violation', hint = 'new_closed';
  end if;
  if v_l.state in ('sold', 'unsold') or (v_l.state = 'running' and v_l.ends_at <= clock_timestamp()) then
    raise exception 'The bidding on % is over.', v_name using errcode = 'check_violation', hint = 'over';
  end if;

  v_rules := public.season_rules(v_season);
  v_open := (v_rules->'mk'->>'bid_open')::bigint;
  v_step := (v_rules->'mk'->>'bid_step')::bigint;
  v_secs := (v_rules->'mk'->>'lot_seconds')::int;
  if v_open is null or v_step is null or v_secs is null then
    raise exception 'The Season 2 rules carry no bidding constants (season_rules mk.bid_open, bid_step, lot_seconds).';
  end if;
  v_next := case when v_l.price is null then v_open else v_l.price + v_step end;
  if p_expect <> v_next then
    raise exception 'The price moved to %. Check it and bid again.', public._money(v_next) using errcode = 'check_violation', hint = 'price_moved';
  end if;
  select b.team_id into v_top from public.market_bids b where b.lot_id = v_l.id order by b.seq desc limit 1;
  if v_top = p_team then
    raise exception 'Your club holds the top bid on %. Another club must bid before yours can bid on them again.', v_name
      using errcode = 'check_violation', hint = 'own_top';
  end if;
  if public._market_waiver_void_why(v_season, v_l.profile_id) is not null then
    raise exception '% is no longer in the training camp pool.', v_name using errcode = 'check_violation', hint = 'unavailable';
  end if;
  if public.is_suspended(v_l.profile_id) then
    raise exception '% is suspended and cannot be bid on while the suspension runs.', v_name using errcode = 'check_violation', hint = 'suspended';
  end if;

  v_max := (v_rules->>'roster_max')::int;
  select s.salary_cap into v_cap from public.seasons s where s.id = v_season;
  if v_max is null or v_cap is null then raise exception 'This season has no roster limit or salary cap set.'; end if;
  /* a fresh statement after the club lock: a bid this club placed a moment ago on another lot is counted */
  select count(*), coalesce(sum(x.amount), 0) into v_led_n, v_led from public._market_led(p_team) x;
  select count(*) into v_active from public.roster_spots rs where rs.season_id = v_season and rs.team_id = p_team and rs.status = 'active';
  if v_active + v_led_n + 1 > v_max then
    raise exception '%', 'Your roster is full (' || (v_active + v_led_n) || ' of ' || v_max
      || case when v_led_n > 0 then ', counting the ' || v_led_n || ' bid' || case when v_led_n = 1 then '' else 's' end || ' your club leads tonight' else '' end
      || '). Waive a player first.'
      using errcode = 'check_violation', hint = 'no_spot';
  end if;
  v_pay := public.team_cap_used(v_season, p_team);
  if v_pay + v_led + v_next > v_cap then
    raise exception '%', 'A bid of ' || public._money(v_next) || ' would take your club over the ' || public._money(v_cap) || ' cap: '
      || public._money(v_pay) || ' in salaries' || case when v_led > 0 then ' plus ' || public._money(v_led) || ' in bids your club leads' else '' end || '.'
      using errcode = 'check_violation', hint = 'over_cap';
  end if;
  /* the 3/2/1 minimums must stay reachable after the club wins this lot AND every lot it leads (the ONE test, shared
     with market_claim) */
  if public._market_min_blocked(v_season, p_team, public.pos_group(v_l.position)) then
    raise exception '%', 'Winning ' || v_name || ' would leave your club no room to reach the Season 2 roster minimums of '
      || public._market_group_word('F', (v_rules->'quota_min'->>'F')::int) || ', '
      || public._market_group_word('D', (v_rules->'quota_min'->>'D')::int) || ' and '
      || public._market_group_word('G', (v_rules->'quota_min'->>'G')::int)
      || ', counting the bids your club leads. Bid on a player of the group your club is short instead.'
      using errcode = 'check_violation', hint = 'minimums';
  end if;

  insert into public.market_bids (lot_id, night_id, team_id, seq, amount, placed_by)
    values (v_l.id, v_l.night_id, p_team, v_l.bids + 1, v_next, auth.uid())
    returning id into v_bid;
  update public.market_lots
     set state = 'running', price = v_next, bids = bids + 1, last_bid_at = clock_timestamp(),
         ends_at = clock_timestamp() + make_interval(secs => v_secs), paused_remaining = null
   where id = v_l.id
   returning ends_at into v_ends;
  /* the player hears when bidding opens on them, never who bid (open detail 10: first bid and result only) */
  if v_l.bids = 0 then
    perform public._market_dm(v_l.profile_id, 'Bidding opened on you at Saturday bidding. The clubs bidding stay hidden until your auction ends.');
  end if;
  return jsonb_build_object('ok', true, 'lot_id', v_l.id, 'bid_id', v_bid, 'seq', v_l.bids + 1, 'amount', v_next,
                            'ends_at', v_ends, 'next', v_next + v_step);
end $f$;

-- 7. the tick steps
create or replace function public._market_close_lots(p_season uuid)
returns int language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59: market_tick's lot step, in three parts.
   a. A lot whose player left the training camp pool (banned, placed on a roster, sign-up withdrawn: the waivers record's
      _market_waiver_void_why) or was suspended is void at once: the public reason is plain, the detail stays with the
      office, and a club leading it is told (never its room).
   b. A countdown that ran out sells the player to the last bidder at that price, on a contract to the end of the season
      (origin 'market_bid'; apply_contract_on_roster writes this season only). Each sale is its own block: the lot is
      locked (SKIP LOCKED, re-evaluated on the locked row, so a lot a bid just reset is left running), then the winner's
      club lock is only TRIED (a busy club is retried on the next tick; no new bid can land meanwhile, the countdown is
      over). The deferred roster check fires inside the block, by name ('all' would also fire events other steps queued).
      A sale a trigger refuses (the roster or the cap no longer had room after a later move, a suspension) voids the lot
      with the error for the office, tells the staff channel and the winning club's seats: recorded and alerted, never
      silent, and the tick goes on (open detail 16, accepted: the player stays eligible). A paused night sells nothing:
      the office may review a countdown that ran out just before it paused.
   c. The 10 PM cut: open lots of an unpaused night past new_until become unsold; running countdowns finish. */
declare r record; w record; v_n int := 0; v_why text; v_err text; v_name text; v_clean text; v_club text; v_night text;
        v_jersey int; v_cnt int;
begin
  -- a. withdrawals: the player is no longer eligible
  for r in
    select l.id, l.profile_id, l.state, l.night_id from public.market_lots l
     where l.season_id = p_season and l.state in ('open', 'running')
       and (public._market_waiver_void_why(p_season, l.profile_id) is not null or public.is_suspended(l.profile_id))
     order by l.id for update skip locked
  loop
    /* the waivers record's reason, read for a lot (its "placed on a roster while on waivers" names the waiver window) */
    v_why := replace(public._market_waiver_void_why(p_season, r.profile_id), ' while on waivers', '');
    update public.market_lots
       set state = 'void', ended_at = clock_timestamp(), void_detail = coalesce(v_why, 'suspended'),
           why = case when v_why is null then 'The player is suspended.' else 'The player left the training camp pool.' end
     where id = r.id and state in ('open', 'running');
    select coalesce(nullif(p.gamertag, ''), p.display_name, 'a player') into v_name from public.profiles p where p.id = r.profile_id;
    select to_char(n.night, 'Dy, Mon FMDD') into v_night from public.market_bid_nights n where n.id = r.night_id;
    perform public.notify_staff_ch(null, 'Saturday bidding (' || v_night || '): **' || v_name || '** was taken out of the bidding: '
      || coalesce(v_why, 'suspended') || '.');
    if r.state = 'running' then
      select b.team_id, b.amount into w from public.market_bids b where b.lot_id = r.id order by b.seq desc limit 1;
      perform public.club_notify(w.team_id, 'roster', 'Saturday bidding: ' || v_name || ' is no longer up for bidding',
        v_name || ' is no longer eligible, so the bidding on them ended without a sale. Your club''s top bid of '
        || public._money(w.amount) || ' no longer counts.', null, 'manager', null, null, false);
    end if;
  end loop;

  -- b. sales
  for r in
    select l.* from public.market_lots l
     where l.season_id = p_season and l.state = 'running' and l.ends_at <= clock_timestamp()
       and not exists (select 1 from public.market_bid_nights n where n.id = l.night_id and n.paused_at is not null)
     order by l.ends_at, l.id for update of l skip locked
  loop
    select b.team_id, b.amount into w from public.market_bids b where b.lot_id = r.id order by b.seq desc limit 1;
    select coalesce(nullif(p.gamertag, ''), p.display_name, 'a player') into v_name from public.profiles p where p.id = r.profile_id;
    v_clean := replace(replace(v_name, '<', ''), '>', '');
    select t.name into v_club from public.teams t where t.id = w.team_id;
    begin
      if w.team_id is null or w.amount is distinct from r.price then
        raise exception 'the auction has no top bid at its price of %', public._money(r.price);
      end if;
      continue when not public._market_club_lock(w.team_id, false);
      v_jersey := public._market_jersey(p_season, w.team_id);
      insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin, squad)
        values (p_season, w.team_id, r.profile_id, v_jersey, r.position, r.price, 'market_bid', 'pro');
      execute 'set constraints public.check_roster_structure_trg immediate';
      execute 'set constraints public.check_roster_structure_trg deferred';
      update public.market_lots set state = 'sold', sold_team_id = w.team_id, sold_at = clock_timestamp(), ended_at = clock_timestamp()
       where id = r.id and state = 'running';
      get diagnostics v_cnt = row_count;
      if v_cnt <> 1 then raise exception 'the auction changed while it was being settled'; end if;
      perform set_config('app.role_grant', 'on', true);
      update public.season_registrations set status = 'assigned' where season_id = p_season and profile_id = r.profile_id;
      get diagnostics v_cnt = row_count;
      perform set_config('app.role_grant', '', true);
      if v_cnt <> 1 then raise exception 'the player has no sign-up for the season to mark assigned'; end if;
      insert into public.transactions (season_id, type, description)
        values (p_season, 'bid', v_club || ' won <b>' || v_clean || '</b> at Saturday bidding for ' || public._money(r.price)
                || ', on a contract to the end of the season.');
      perform public._market_dm(r.profile_id, 'The ' || v_club || ' won you at Saturday bidding for ' || public._money(r.price)
        || ', on a contract to the end of the season.');
      v_n := v_n + 1;
    exception when others then
      v_err := sqlerrm;
      execute 'set constraints public.check_roster_structure_trg deferred';
      update public.market_lots
         set state = 'void', ended_at = clock_timestamp(), why = 'The sale could not be completed.', void_detail = left(v_err, 500)
       where id = r.id and state = 'running';
      perform public.notify_staff_ch(null, 'Saturday bidding: the sale of **' || v_name || '** to the ' || coalesce(v_club, 'winning club')
        || ' at ' || public._money(r.price) || ' could not be completed: ' || v_err || '. The player stays in the training camp pool.');
      perform public.club_notify(w.team_id, 'roster', 'Saturday bidding: sale not completed',
        'Your club''s winning bid of ' || public._money(r.price) || ' on ' || v_name || ' could not be completed: the roster or the cap no longer had room, or the player could no longer be signed. The player stays in the training camp pool, and the league office was told.',
        null, 'manager', null, null, false);
    end;
  end loop;

  -- c. the 10 PM cut
  update public.market_lots l set state = 'unsold', ended_at = clock_timestamp()
    from public.market_bid_nights n
   where n.id = l.night_id and n.season_id = p_season and n.state in ('live', 'closing') and n.paused_at is null
     and clock_timestamp() >= n.new_until and l.state = 'open';
  return v_n;
end $f$;

create or replace function public._market_close_night(p_season uuid)
returns int language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59: past 10 PM (new_until) an unpaused night goes to 'closing' while countdowns run, then to 'closed' once no
   auction is open or running. Nights are taken with SKIP LOCKED: an office pause in flight holds its night, and the tick
   never waits on it. */
declare r record; v_n int := 0;
begin
  for r in
    select n.id, n.state from public.market_bid_nights n
     where n.season_id = p_season and n.state in ('live', 'closing') and n.paused_at is null and clock_timestamp() >= n.new_until
     order by n.night for update skip locked
  loop
    if exists (select 1 from public.market_lots l where l.night_id = r.id and l.state in ('open', 'running')) then
      if r.state = 'live' then update public.market_bid_nights set state = 'closing' where id = r.id; end if;
    else
      update public.market_bid_nights set state = 'closed', closed_at = clock_timestamp() where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $f$;

create or replace function public._market_post_recaps(p_season uuid)
returns int language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59: the night recap, posted once per night through public._announce_once (its app_config mark makes it at most once)
   to the news channel, after the night closes: who was signed, by which club, at what price (bidders are public once an
   auction is over), and how many players went unbid and where they go next. An embed: nothing in it can ping. A recap
   that cannot be posted (no news or default webhook) fails this step every tick, which the watchdog reports.
   Review, 2026-11-24: the text says only what is true. Unbid players stay eligible for the next bid night when the
   calendar has one, else they stay in the training camp pool (the last night before the movement deadline has no next
   one); a night with no auction says so without guessing why (no player with six games, suspensions, an empty pool). */
declare r record; v_num int; v_key text; v_title text; v_body text; v_sold text; v_unsold int; v_void int; v_next date; v_n int := 0;
begin
  select s.number into v_num from public.seasons s where s.id = p_season;
  for r in
    select n.id, n.night from public.market_bid_nights n
     where n.season_id = p_season and n.state = 'closed' and n.recap_at is null
     order by n.night for update skip locked
  loop
    select string_agg('**' || regexp_replace(coalesce(nullif(p.gamertag, ''), p.display_name, 'a player'), '([*_~`|\\])', '\\\1', 'g')
                      || '** (' || public._pos_word(l.position) || ') to the ' || t.name || ' for ' || public._money(l.price),
                      E'\n' order by l.sold_at, l.id)
      into v_sold
      from public.market_lots l join public.profiles p on p.id = l.profile_id join public.teams t on t.id = l.sold_team_id
     where l.night_id = r.id and l.state = 'sold';
    select count(*) filter (where l.state = 'unsold'), count(*) filter (where l.state = 'void') into v_unsold, v_void
      from public.market_lots l where l.night_id = r.id;
    select min(b.night) into v_next from public._market_bid_nights(p_season) b where not b.skipped and b.night > r.night;
    v_title := 'Saturday bidding: ' || to_char(r.night, 'FMMonth FMDD');
    v_body := case
      when v_sold is null and v_unsold = 0 and v_void = 0 then
        'No training camp player was up for bidding.'
      else coalesce(v_sold, 'No player was signed.')
        || case when v_unsold > 0 then E'\n\n' || v_unsold
                  || case when v_unsold = 1 then ' player had no bids and stays' else ' players had no bids and stay' end
                  || case when v_next is not null then ' eligible for the next bid night, ' || to_char(v_next, 'FMMonth FMDD') || '.'
                          else ' in the training camp pool.' end
                else '' end
        || case when v_void > 0 then E'\n' || v_void
                  || case when v_void = 1 then ' auction ended without a sale.' else ' auctions ended without a sale.' end else '' end
      end;
    v_key := 'market-recap-' || to_char(r.night, 'YYYY-MM-DD');
    perform public._announce_once(v_num, v_key, 'discord_news_webhook', v_title, left(v_body, 4000));
    if not exists (select 1 from public.app_config c where c.key = 'ann_' || v_num || '_' || v_key) then
      raise exception 'the recap of Saturday bidding on % was not posted: no news or default webhook is set', r.night;
    end if;
    update public.market_bid_nights set recap_at = clock_timestamp() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $f$;

create or replace function public._market_open_night(p_season uuid, p_now timestamptz default clock_timestamp())
returns int language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59: market_tick's open step. When a bid night is due (its opening has passed and new auctions are still allowed, by
   public._market_bid_nights), the night is inserted once (unique (season_id, night), ON CONFLICT DO NOTHING) and, only on
   that real insert, one open lot per eligible training camp pool player (market_pool: six box-score games, not suspended;
   commissioner, 2026-11-02: "Only training camp players with at least 6 games played can be bid on"), in rating order,
   fixed for the night. A player out of the Discord is left out, read the way the shortfall draw reads it. Nothing opens
   after the movement deadline. p_now is the moment judged (the tick passes none; a rehearsal passes the night's hour).
   A player still up for auction on an earlier night (only a pause left on can hold one that long) gets no second lot,
   the shortfall draw's own filter: two lots on one player could sell them twice. Review, 2026-11-24: a pause left on
   across a week also keeps its leads counting against those clubs' spots and cap, so the staff channel is told when the
   next night opens without its players.
   shortcut: no catch-up night: a tick outage across the whole bid hour loses that night (market_calendar shows it as
   missed and the watchdog alerts), revisit if a tick outage ever spans a bid hour */
declare v_b record; v_id uuid; v_held text;
begin
  if not public._market_draft_done(p_season) or public.moves_locked(p_season) then return 0; end if;
  select b.* into v_b from public._market_bid_nights(p_season) b
   where not b.skipped and b.opens_at <= p_now and p_now < b.new_until;
  if not found then return 0; end if;
  if exists (select 1 from public.market_bid_nights n where n.season_id = p_season and n.night = v_b.night) then return 0; end if;
  /* the post-draft fill for skipped picks runs first (main session, 2026-11-23); a bid night that finds it missing is a
     broken draft night, and the tick says so every run until the office looks */
  if not exists (select 1 from public.app_config c where c.key = 'postdraft_done_' || p_season::text) then
    raise exception 'Saturday bidding for % could not open: the post-draft fill for skipped picks has not run', v_b.night;
  end if;
  insert into public.market_bid_nights (season_id, night, opens_at, new_until, state)
    values (p_season, v_b.night, v_b.opens_at, v_b.new_until, 'live')
    on conflict (season_id, night) do nothing
    returning id into v_id;
  if v_id is null then return 0; end if;
  insert into public.market_lots (night_id, season_id, profile_id, position, ord, gp_at_open, state)
  select v_id, p_season, mp.profile_id, mp.position,
         row_number() over (order by (select max(o.overall) from public.player_position_overalls o
                                        where o.profile_id = mp.profile_id and o.headline) desc nulls last,
                                     mp.gp desc, mp.profile_id),
         mp.gp, 'open'
    from public.market_pool(p_season) mp join public.profiles p on p.id = mp.profile_id
   where mp.eligible
     and not (p.in_guild is false and not exists (select 1 from public.guild_members g where g.profile_id = p.id and g.present))
     and not exists (select 1 from public.market_lots ml where ml.profile_id = mp.profile_id and ml.state in ('open', 'running'));
  select string_agg(to_char(n.night, 'Mon FMDD'), ', ' order by n.night) into v_held
    from public.market_bid_nights n where n.season_id = p_season and n.id <> v_id and n.paused_at is not null;
  if v_held is not null then
    perform public.notify_staff_ch(null, 'Saturday bidding (' || to_char(v_b.night, 'Dy, Mon FMDD') || ') opened while the bidding of '
      || v_held || ' is still paused. Those players stay out of tonight''s bidding, and the bids clubs lead on them still count against their roster spots and cap, until the league office resumes that night or withdraws them.');
  end if;
  return 1;
end $f$;

-- 8. the office's tools
create or replace function public.market_pause(p_night uuid, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59 (commissioner, 2026-11-23): the office pause freezes every countdown, and only the Draft and Bidding manager or a
   commissioner may pause (can_run_market). The draft_pause pattern: each running lot keeps the time it had left
   (paused_remaining) and its clock stops (ends_at null). A countdown that had already run out is left to settle after
   the resume. Running lots are locked in id order. */
declare v_n public.market_bid_nights; v_at timestamptz := clock_timestamp(); v_frozen int; v_reason text := nullif(btrim(p_reason), '');
begin
  if not public.can_run_market() then
    raise exception 'Only a commissioner or the Draft and Bidding manager can pause Saturday bidding.' using errcode = '42501';
  end if;
  if p_night is null then raise exception 'Choose the bid night.' using errcode = '22023'; end if;
  select n.* into v_n from public.market_bid_nights n where n.id = p_night for update;
  if not found then raise exception 'That bid night does not exist.' using errcode = 'P0002'; end if;
  if not public.market_on(v_n.season_id) then
    raise exception 'The Season 2 player market is not open this season.' using errcode = 'check_violation', hint = 'market_closed';
  end if;
  if v_n.state = 'closed' then raise exception 'That bid night is over.' using errcode = 'check_violation', hint = 'over'; end if;
  if v_n.paused_at is not null then raise exception 'Bidding is already paused.' using errcode = 'check_violation', hint = 'paused'; end if;
  perform 1 from public.market_lots l where l.night_id = p_night and l.state = 'running' order by l.id for update;
  update public.market_lots set paused_remaining = ends_at - v_at, ends_at = null
   where night_id = p_night and state = 'running' and ends_at > v_at;
  get diagnostics v_frozen = row_count;
  update public.market_bid_nights set paused_at = v_at, paused_by = auth.uid(), pause_reason = left(v_reason, 300) where id = p_night;
  perform public.log_admin_action('market_pause', 'market_bid_night', p_night::text,
    jsonb_build_object('night', v_n.night, 'reason', v_reason, 'frozen', v_frozen));
  perform public.notify_staff_ch(null, 'Saturday bidding (' || to_char(v_n.night, 'Dy, Mon FMDD') || ') is paused by the league office'
    || coalesce(': ' || v_reason, '') || '. Every countdown is frozen until it resumes.');
  return jsonb_build_object('ok', true, 'night_id', p_night, 'paused_at', v_at, 'frozen', v_frozen);
end $f$;

create or replace function public.market_resume(p_night uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59: the resume gives every frozen countdown the time it had left, and moves the 10 PM cut later by the length of the
   pause when the pause began before it (open detail 2, accepted), so a pause never eats the hour. */
declare v_n public.market_bid_nights; v_at timestamptz := clock_timestamp(); v_len interval; v_until timestamptz; v_resumed int;
begin
  if not public.can_run_market() then
    raise exception 'Only a commissioner or the Draft and Bidding manager can resume Saturday bidding.' using errcode = '42501';
  end if;
  if p_night is null then raise exception 'Choose the bid night.' using errcode = '22023'; end if;
  select n.* into v_n from public.market_bid_nights n where n.id = p_night for update;
  if not found then raise exception 'That bid night does not exist.' using errcode = 'P0002'; end if;
  if not public.market_on(v_n.season_id) then
    raise exception 'The Season 2 player market is not open this season.' using errcode = 'check_violation', hint = 'market_closed';
  end if;
  if v_n.paused_at is null then raise exception 'Bidding is not paused.' using errcode = 'check_violation', hint = 'not_paused'; end if;
  v_len := v_at - v_n.paused_at;
  v_until := case when v_n.paused_at < v_n.new_until then v_n.new_until + v_len else v_n.new_until end;
  perform 1 from public.market_lots l where l.night_id = p_night and l.state = 'running' and l.paused_remaining is not null
   order by l.id for update;
  update public.market_lots set ends_at = v_at + paused_remaining, paused_remaining = null
   where night_id = p_night and state = 'running' and paused_remaining is not null;
  get diagnostics v_resumed = row_count;
  update public.market_bid_nights set paused_at = null, paused_by = null, pause_reason = null, new_until = v_until where id = p_night;
  perform public.log_admin_action('market_resume', 'market_bid_night', p_night::text,
    jsonb_build_object('night', v_n.night, 'paused_for_seconds', round(extract(epoch from v_len)), 'resumed', v_resumed, 'new_until', v_until));
  perform public.notify_staff_ch(null, 'Saturday bidding (' || to_char(v_n.night, 'Dy, Mon FMDD') || ') resumed. Every countdown picks up where it stopped'
    || case when v_until <> v_n.new_until then ', and new auctions now close at ' || to_char(v_until at time zone 'America/New_York', 'FMHH12:MI AM') || ' ET' else '' end || '.');
  return jsonb_build_object('ok', true, 'night_id', p_night, 'resumed', v_resumed, 'new_until', v_until);
end $f$;

create or replace function public.market_void_lot(p_lot uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59: the office withdraws one player from tonight's bidding (an open or running lot). The public reads "Withdrawn by
   the league office."; the reason stays in the lot's office detail and the audit row; the club that led it is told its
   bid no longer counts (its seats only, never its room). The player stays in the pool and eligible for the next night.
   A completed sale is undone with the office's roster removal instead. */
declare v_l public.market_lots; v_reason text := nullif(btrim(p_reason), ''); v_name text; v_night date; w record;
begin
  if not public.can_run_market() then
    raise exception 'Only a commissioner or the Draft and Bidding manager can withdraw a player from Saturday bidding.' using errcode = '42501';
  end if;
  if p_lot is null or v_reason is null then raise exception 'Choose the auction and give the reason for withdrawing the player.' using errcode = '22023'; end if;
  select l.* into v_l from public.market_lots l where l.id = p_lot for update;
  if not found then raise exception 'That auction does not exist.' using errcode = 'P0002'; end if;
  if not public.market_on(v_l.season_id) then
    raise exception 'The Season 2 player market is not open this season.' using errcode = 'check_violation', hint = 'market_closed';
  end if;
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'This player') into v_name from public.profiles p where p.id = v_l.profile_id;
  if v_l.state = 'sold' then
    raise exception 'The bidding on % ended in a sale. Undo a completed sale with the league office''s roster removal.', v_name
      using errcode = 'check_violation', hint = 'sold';
  end if;
  if v_l.state in ('unsold', 'void') then
    raise exception 'The bidding on % is already over.', v_name using errcode = 'check_violation', hint = 'over';
  end if;
  select b.team_id, b.amount into w from public.market_bids b where b.lot_id = v_l.id order by b.seq desc limit 1;
  update public.market_lots
     set state = 'void', ended_at = clock_timestamp(), why = 'Withdrawn by the league office.', void_detail = left(v_reason, 300),
         voided_by = auth.uid()
   where id = v_l.id;
  select n.night into v_night from public.market_bid_nights n where n.id = v_l.night_id;
  perform public.log_admin_action('market_void_lot', 'market_lot', v_l.id::text,
    jsonb_build_object('profile_id', v_l.profile_id, 'night', v_night, 'reason', v_reason, 'top_bid', w.amount, 'top_team_id', w.team_id));
  perform public.notify_staff_ch(null, 'The league office withdrew **' || v_name || '** from Saturday bidding ('
    || to_char(v_night, 'Dy, Mon FMDD') || '): ' || v_reason || '.');
  if w.team_id is not null then
    perform public.club_notify(w.team_id, 'roster', 'Saturday bidding: ' || v_name || ' withdrawn',
      'The league office withdrew ' || v_name || ' from Saturday bidding. Your club''s top bid of ' || public._money(w.amount)
      || ' no longer counts.', null, 'manager', null, null, false);
  end if;
  return jsonb_build_object('ok', true, 'lot_id', v_l.id, 'state', 'void');
end $f$;

-- 9. a club's bid board
create or replace function public.save_market_board(p_team uuid, p_rows jsonb)
returns int language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59: replaces the club's bid board for the season (the save_draft_board pattern). p_rows is an ordered array of
   {profile_id, ceiling, note}; the rank is the order. A player must be in the training camp pool or on waivers; a ceiling
   is null or the opening price and up in whole bid steps, at most the cap; a note is at most 200 characters. A plan only:
   no rule effect and never a bid (commissioner, 2026-11-23: no automatic bidding). */
declare v_season uuid := public.current_season_id(); v_rules jsonb; v_open bigint; v_step bigint; v_cap bigint;
        v_pool uuid[]; v_seen uuid[] := '{}'; v_row jsonb; v_pid uuid; v_ceil bigint; v_note text; v_name text; i int := 0;
begin
  if p_team is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Choose the club and send the board as a list.' using errcode = '22023';
  end if;
  if not (public.is_gm_of(p_team) or public.is_commissioner()) then
    raise exception 'Only that club''s Owner, GM or AGM can edit its bid board.' using errcode = '42501';
  end if;
  if v_season is null or not public.market_on(v_season) then
    raise exception 'The Season 2 player market is not open this season.' using errcode = 'check_violation', hint = 'market_closed';
  end if;
  /* review, 2026-11-24: a board is a plan with no rule effect, and the Owner's approval queue has no board move, so a seat
     whose Owner approves its Free agents moves saves its plan; every other access mode goes through mgmt_gate */
  if public.mgmt_access(p_team, 'freeagents') is distinct from 'approve' then
    perform public.mgmt_gate(p_team, 'freeagents');
  end if;
  if jsonb_array_length(p_rows) > 60 then raise exception 'The bid board caps at 60 players.' using errcode = 'check_violation', hint = 'too_many'; end if;
  v_rules := public.season_rules(v_season);
  v_open := (v_rules->'mk'->>'bid_open')::bigint;
  v_step := (v_rules->'mk'->>'bid_step')::bigint;
  select s.salary_cap into v_cap from public.seasons s where s.id = v_season;
  select coalesce(array_agg(mp.profile_id), '{}') into v_pool from public.market_pool(v_season) mp;
  delete from public.market_boards where season_id = v_season and team_id = p_team;
  for v_row in select e.value from jsonb_array_elements(p_rows) e loop
    i := i + 1;
    /* a malformed id or ceiling is a plain refusal, never a raw cast error */
    begin
      v_pid := nullif(v_row->>'profile_id', '')::uuid;
    exception when invalid_text_representation then
      v_pid := null;
    end;
    if v_pid is null then raise exception 'Row % of the board names no player.', i using errcode = '22023'; end if;
    select coalesce(nullif(p.gamertag, ''), p.display_name, 'That player') into v_name from public.profiles p where p.id = v_pid;
    if v_pid = any(v_seen) then
      raise exception '% is on the board twice.', coalesce(v_name, 'A player') using errcode = 'check_violation', hint = 'duplicate';
    end if;
    v_seen := v_seen || v_pid;
    if not (v_pid = any(v_pool)) and not exists (select 1 from public.market_waivers w where w.season_id = v_season
                                                   and w.profile_id = v_pid and w.status = 'open') then
      raise exception '% is not in the training camp pool or on waivers.', coalesce(v_name, 'That player')
        using errcode = 'check_violation', hint = 'not_in_pool';
    end if;
    begin
      v_ceil := nullif(v_row->>'ceiling', '')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_ceil := -1;
    end;
    if v_ceil is not null and (v_ceil < v_open or (v_ceil - v_open) % v_step <> 0 or v_ceil > v_cap) then
      raise exception 'A ceiling is the opening price of % or more, in steps of %, and at most the % cap.',
        public._money(v_open), public._money(v_step), public._money(v_cap) using errcode = 'check_violation', hint = 'ceiling';
    end if;
    v_note := nullif(btrim(v_row->>'note'), '');
    if char_length(v_note) > 200 then
      raise exception 'A note is at most 200 characters.' using errcode = 'check_violation', hint = 'note';
    end if;
    insert into public.market_boards (season_id, team_id, profile_id, rank, ceiling, note, updated_by, updated_at)
      values (v_season, p_team, v_pid, i, v_ceil, v_note, auth.uid(), clock_timestamp());
  end loop;
  return i;
end $f$;

-- 10. the tick runs the bid-night steps (anchored on the steps end line, asserted once)
do $tick$
declare v_def text := pg_get_functiondef('public.market_tick()'::regprocedure);
        a text := $a$    -- market-tick steps end
$a$;
        b text := $b$    begin
      perform public._market_close_lots(v_season);   -- v4.59: Saturday bidding: withdrawals, sales and the 10 PM cut
    exception when others then
      v_errors := v_errors || ('bid lots: ' || sqlerrm);
    end;
    begin
      perform public._market_close_night(v_season);   -- v4.59: a bid night closes when no auction is left
    exception when others then
      v_errors := v_errors || ('bid night close: ' || sqlerrm);
    end;
    begin
      perform public._market_post_recaps(v_season);   -- v4.59: the night recap, once, through _announce_once
    exception when others then
      v_errors := v_errors || ('bid night recap: ' || sqlerrm);
    end;
    begin
      perform public._market_open_night(v_season);   -- v4.59: a bid night opens at 9 PM ET, its auctions fixed
    exception when others then
      v_errors := v_errors || ('bid night open: ' || sqlerrm);
    end;
$b$ || a;
        n int;
begin
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.59 bid nights: the market_tick anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $tick$;

-- 11. the shortfall draw never takes a player up for auction (the minimums record's draw, anchored on its pool filter)
do $draw$
declare v_def text := pg_get_functiondef('public._market_draw_shortfalls(uuid)'::regprocedure);
        a text := $a$       where mp.pos_group = r.pos_group and not mp.suspended
$a$;
        b text := $b$       where mp.pos_group = r.pos_group and not mp.suspended
         /* v4.59: never a player up for auction tonight: the draw would take them out from under the clubs bidding */
         and not exists (select 1 from public.market_lots ml where ml.profile_id = mp.profile_id and ml.state in ('open', 'running'))
$b$;
        n int;
begin
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.59 bid nights: the _market_draw_shortfalls anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $draw$;

-- 11b. the claim's minimums test becomes the one the bid uses (the waivers record's claim, anchored on its own formula)
do $claim$
declare v_def text := pg_get_functiondef('public.market_claim(uuid,uuid)'::regprocedure);
        a text := $a$  v_gap := public.roster_min_gap(v_season, p_team, v_grp, null);
  if coalesce((v_gap->>'short')::int, 0) > coalesce((v_gap->>'open')::int, 0) - v_led_n then
$a$;
        b text := $b$  /* v4.59 (review, 2026-11-24): the one minimums test the bid shares; each led lot fills a spot of its own group */
  if public._market_min_blocked(v_season, p_team, v_grp) then
$b$;
        n int;
begin
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.59 bid nights: the market_claim anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $claim$;

-- 12. grants: the client calls market_bid, the office tools, save_market_board and market_calendar; can_run_market is a
--     gate helper an anon-readable policy calls, so anon keeps EXECUTE on it
do $grants$
declare f text;
begin
  foreach f in array array['public.can_run_market()', 'public._market_bid_nights(uuid)', 'public.market_calendar(uuid)',
    'public._market_led(uuid)', 'public._market_min_blocked(uuid,uuid,text)', 'public.market_bid(uuid,uuid,bigint)', 'public._market_close_lots(uuid)',
    'public._market_close_night(uuid)', 'public._market_post_recaps(uuid)', 'public._market_open_night(uuid,timestamp with time zone)',
    'public.market_pause(uuid,text)', 'public.market_resume(uuid)', 'public.market_void_lot(uuid,text)',
    'public.save_market_board(uuid,jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $grants$;
grant execute on function public.can_run_market() to anon, authenticated;
grant execute on function public.market_calendar(uuid) to anon, authenticated;
grant execute on function public.market_bid(uuid, uuid, bigint) to authenticated;
grant execute on function public.market_pause(uuid, text) to authenticated;
grant execute on function public.market_resume(uuid) to authenticated;
grant execute on function public.market_void_lot(uuid, text) to authenticated;
grant execute on function public.save_market_board(uuid, jsonb) to authenticated;

-- 13. self-checks
do $chk$
declare f text; v_def text; r text; pr text; t text;
  s1_rules constant jsonb := '{"flex": null, "lines": null, "quota": {"D": 5, "F": 7, "G": 3}, "weeks": 6, "format": "basic", "rights": false, "camp_max": 10, "cap_camp": 3, "fa_window": false, "preseason": false, "cap_goalie": 6, "cap_skater": 6, "extensions": false, "roster_max": 15, "salary_cap": 50000000, "series_cap": 4, "draft_snake": true, "pick_trades": false, "draft_rounds": 12, "min_service_gp": 0, "playoff_min_gp": 14, "playoff_best_of": 7, "playoff_per_div": 3, "max_contract_years": 1, "trade_deadline_week": 4}'::jsonb;
begin
  foreach f in array array['public.can_run_market()', 'public._market_bid_nights(uuid)', 'public.market_calendar(uuid)',
    'public._market_led(uuid)', 'public._market_min_blocked(uuid,uuid,text)', 'public.market_bid(uuid,uuid,bigint)', 'public._market_close_lots(uuid)',
    'public._market_close_night(uuid)', 'public._market_post_recaps(uuid)', 'public._market_open_night(uuid,timestamp with time zone)',
    'public.market_pause(uuid,text)', 'public.market_resume(uuid)', 'public.market_void_lot(uuid,text)',
    'public.save_market_board(uuid,jsonb)', 'public.market_tick()', 'public._market_draw_shortfalls(uuid)'] loop
    if not (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) from pg_proc p where p.oid = f::regprocedure) then
      raise exception 'v4.59 bid nights: % must be SECURITY DEFINER with search_path ''''', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') and f not in ('public.can_run_market()', 'public.market_calendar(uuid)') then
      raise exception 'v4.59 bid nights: anon can execute %', f;
    end if;
    if has_function_privilege('authenticated', f, 'EXECUTE')
       and f not in ('public.can_run_market()', 'public.market_calendar(uuid)', 'public.market_bid(uuid,uuid,bigint)',
                     'public.market_pause(uuid,text)', 'public.market_resume(uuid)', 'public.market_void_lot(uuid,text)',
                     'public.save_market_board(uuid,jsonb)') then
      raise exception 'v4.59 bid nights: authenticated can execute the internal %', f;
    end if;
  end loop;
  if not has_function_privilege('anon', 'public.can_run_market()', 'EXECUTE') or not has_function_privilege('anon', 'public.market_calendar(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.market_bid(uuid,uuid,bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.market_pause(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.market_resume(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.market_void_lot(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.save_market_board(uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.market_claim(uuid,uuid)', 'EXECUTE') then
    raise exception 'v4.59 bid nights: a client RPC or the gate helper lost its grant';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'can_run_market') <> 1
     or position('-- shortcut: commissioners only until a Draft and Bidding manager is seated, widen when committee seats exist'
                 in pg_get_functiondef('public.can_run_market()'::regprocedure)) = 0
     or position('select public.is_commissioner()' in pg_get_functiondef('public.can_run_market()'::regprocedure)) = 0 then
    raise exception 'v4.59 bid nights: can_run_market must be one function, is_commissioner() with its shortcut marker';
  end if;
  /* RLS on, exactly one SELECT policy each, and no client write of any kind for either API role */
  foreach t in array array['market_bid_nights', 'market_lots', 'market_bids', 'market_boards'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass)
       or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t) <> 1
       or (select p.cmd from pg_policies p where p.schemaname = 'public' and p.tablename = t) <> 'SELECT' then
      raise exception 'v4.59 bid nights: % must have RLS on and exactly one (SELECT) policy', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      foreach pr in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(r, 'public.' || t, pr)
           or (case when pr in ('INSERT', 'UPDATE', 'REFERENCES') then has_any_column_privilege(r, 'public.' || t, pr) else false end) then
          raise exception 'v4.59 bid nights: % grants are wrong: % has %', t, r, pr;
        end if;
      end loop;
    end loop;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if has_column_privilege(r, 'public.market_bid_nights', 'paused_by', 'SELECT') or has_column_privilege(r, 'public.market_bid_nights', 'pause_reason', 'SELECT')
       or has_column_privilege(r, 'public.market_lots', 'void_detail', 'SELECT') or has_column_privilege(r, 'public.market_lots', 'voided_by', 'SELECT')
       or has_column_privilege(r, 'public.market_bids', 'placed_by', 'SELECT') then
      raise exception 'v4.59 bid nights: % reads an office-only column', r;
    end if;
    if not has_column_privilege(r, 'public.market_lots', 'price', 'SELECT') or not has_column_privilege(r, 'public.market_bids', 'team_id', 'SELECT')
       or not has_column_privilege(r, 'public.market_bid_nights', 'state', 'SELECT') then
      raise exception 'v4.59 bid nights: % cannot read the room', r;
    end if;
  end loop;
  if has_any_column_privilege('anon', 'public.market_boards', 'SELECT') then
    raise exception 'v4.59 bid nights: anon reads the bid boards';
  end if;
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename in ('market_bid_nights', 'market_lots', 'market_bids')) <> 3
     or exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                  and tablename in ('market_boards', 'market_waivers')) then
    raise exception 'v4.59 bid nights: Realtime must carry exactly the three room tables';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.market_bid_nights'::regclass and tgname like 'live_mark_market_bid_nights_%') <> 2
     or (select count(*) from pg_trigger where tgrelid = 'public.market_lots'::regclass and tgname like 'live_mark_market_lots_%') <> 2 then
    raise exception 'v4.59 bid nights: the market pulse triggers are missing';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.market_bids'::regclass and contype = 'u'
        and conname in ('market_bids_seq', 'market_bids_amount')) <> 2
     or not exists (select 1 from pg_constraint where conrelid = 'public.market_bid_nights'::regclass and conname = 'market_bid_nights_one' and contype = 'u')
     or not exists (select 1 from pg_constraint where conrelid = 'public.market_lots'::regclass and conname = 'market_lots_one' and contype = 'u') then
    raise exception 'v4.59 bid nights: a race backstop (unique constraint) is missing';
  end if;
  v_def := pg_get_functiondef('public.market_tick()'::regprocedure);
  if not (position('perform public._market_close_lots(v_season);' in v_def) > position('perform public._market_draw_shortfalls(v_season);' in v_def)
          and position('perform public._market_close_night(v_season);' in v_def) > position('perform public._market_close_lots(v_season);' in v_def)
          and position('perform public._market_post_recaps(v_season);' in v_def) > position('perform public._market_close_night(v_season);' in v_def)
          and position('perform public._market_open_night(v_season);' in v_def) > position('perform public._market_post_recaps(v_season);' in v_def)
          and position('    -- market-tick steps end' in v_def) > position('perform public._market_open_night(v_season);' in v_def)
          and position('perform public._market_expire_waivers(v_season);' in v_def) > 0) then
    raise exception 'v4.59 bid nights: market_tick does not run the four bid-night steps in order, above the steps end line';
  end if;
  if position('select null::uuid, null::bigint where false' in pg_get_functiondef('public._market_led(uuid)'::regprocedure)) > 0 then
    raise exception 'v4.59 bid nights: _market_led is still the placeholder';
  end if;
  if position('ml.state in (''open'', ''running'')' in pg_get_functiondef('public._market_draw_shortfalls(uuid)'::regprocedure)) = 0 then
    raise exception 'v4.59 bid nights: the shortfall draw can still take a player up for auction';
  end if;
  v_def := pg_get_functiondef('public.market_claim(uuid,uuid)'::regprocedure);
  if position('if public._market_min_blocked(v_season, p_team, v_grp) then' in v_def) = 0
     or position('coalesce((v_gap->>''short'')::int, 0) >' in v_def) > 0
     or position('if public._market_min_blocked(v_season, p_team, public.pos_group(v_l.position)) then'
                 in pg_get_functiondef('public.market_bid(uuid,uuid,bigint)'::regprocedure)) = 0 then
    raise exception 'v4.59 bid nights: the bid and the claim must share _market_min_blocked';
  end if;
  v_def := pg_get_functiondef('public.market_bid(uuid,uuid,bigint)'::regprocedure);
  if position('market_bid_nights n where n.id = v_night for share;' in v_def) = 0
     or position('market_bid_nights n where n.id = v_night for share;' in v_def) > position('market_lots l where l.id = p_lot for update;' in v_def) then
    raise exception 'v4.59 bid nights: market_bid must hold the night before it locks the lot';
  end if;
  if (select count(*) from cron.job where jobname = 'market-tick' and active and schedule = '10 seconds'
        and command = 'select public.market_tick()') <> 1 then
    raise exception 'v4.59 bid nights: the market-tick job must exist exactly once';
  end if;
  if public.season_rules((select id from public.seasons where number = 1)) <> s1_rules then
    raise exception 'v4.59 bid nights: season_rules(Season 1) changed';
  end if;
  if public.market_on((select id from public.seasons where number = 1)) then
    raise exception 'v4.59 bid nights: Season 1 must not be a market season';
  end if;
  if (public.market_calendar((select id from public.seasons where number = 1))->>'market')::boolean then
    raise exception 'v4.59 bid nights: Season 1 has a market calendar';
  end if;
end $chk$;

/* REHEARSAL on production, 2026-11-24 (main session), sql/2026-11-24-s2-bid-nights-v459.rehearsal.sql, one transaction
   rolled back by its closing raise: REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19.
   Applied 2026-11-24 as migration v459_s2_bid_nights; tools/sql/grant-audit.sql returned zero rows. */
-- <<< record text

-- the world
do $w$
declare v_s2 uuid := (select id from public.seasons where number = 2);
        v_t uuid[] := (select array_agg(x.id order by x.code) from (select id, code from public.teams order by code limit 5) x);
        v_cap bigint := (select salary_cap from public.seasons where number = 2);
        v_f uuid[]; v_d uuid[]; v_g uuid[]; v_c uuid; v_ids uuid[]; v_p uuid; v_each bigint; i int; k int;
        v_games uuid[] := '{}'; v_gid uuid; v_day date;
begin
  if not public.market_on(v_s2) then raise exception 'world: Season 2 is not a market season'; end if;
  if v_cap <> 30000000 then raise exception 'world: the Season 2 cap is %, expected $30M', v_cap; end if;
  if cardinality(v_t) <> 5 then raise exception 'world: fewer than five clubs'; end if;
  if exists (select 1 from public.roster_spots where season_id = v_s2) then
    raise exception 'world: Season 2 already has roster spots. This rehearsal needs an empty Season 2: run it before the Dec 5 seating.';
  end if;
  if exists (select 1 from public.games where season_id = v_s2) then
    raise exception 'world: Season 2 already has games. This rehearsal builds its own schedule: run it before the Season 2 schedule is generated.';
  end if;
  if exists (select 1 from public.market_bid_nights where season_id = v_s2) then raise exception 'world: Season 2 already has a bid night'; end if;
  select id into v_c from public.profiles where role = 'commissioner' order by created_at, id limit 1;
  if v_c is null then raise exception 'world: no commissioner to act as'; end if;
  if exists (select 1 from public.draft_state where season_number = 2) then
    update public.draft_state set status = 'complete' where season_number = 2;
  else
    insert into public.draft_state (season_number, status) values (2, 'complete');
  end if;
  /* the post-draft fill for skipped picks has run (its mark opens claims and bid nights) */
  insert into public.app_config (key, value) values ('postdraft_done_' || v_s2::text, now()::text) on conflict (key) do nothing;
  select array_agg(r.profile_id order by r.created_at, r.profile_id) filter (where public.pos_group(r.position) = 'F'),
         array_agg(r.profile_id order by r.created_at, r.profile_id) filter (where public.pos_group(r.position) = 'D'),
         array_agg(r.profile_id order by r.created_at, r.profile_id) filter (where public.pos_group(r.position) = 'G')
    into v_f, v_d, v_g
    from public.season_registrations r join public.profiles p on p.id = r.profile_id
   where r.season_id = v_s2 and r.status <> 'declined' and p.role = 'member' and not coalesce(p.banned, false)
     and p.discord_id is not null and not public.is_suspended(r.profile_id)
     and not (p.in_guild is false and not exists (select 1 from public.guild_members gm where gm.profile_id = p.id and gm.present))
     and not exists (select 1 from public.teams t where r.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id));
  if coalesce(cardinality(v_f), 0) < 32 or coalesce(cardinality(v_d), 0) < 13 or coalesce(cardinality(v_g), 0) < 5 then
    raise exception 'world: not enough Season 2 sign-ups (% F, % D, % G; 32, 13 and 5 needed)', cardinality(v_f), cardinality(v_d), cardinality(v_g);
  end if;
  -- Owners: F1..F5 on clubs A..E
  for i in 1..5 loop update public.teams set owner_profile_id = v_f[i] where id = v_t[i]; end loop;
  -- rosters: A F6..F8 D1 D2 G1; B F9..F11 D3 D4 G2; C F12..F18 D5..D7 G3 (12 of 12); D F19..F21 D8 D9 G4 ($1M of room);
  -- E F22..F27 D10..D12 and no goaltender
  for k in 1..5 loop
    v_ids := case k when 1 then v_f[6:8] || v_d[1:2] || v_g[1:1]
                    when 2 then v_f[9:11] || v_d[3:4] || v_g[2:2]
                    when 3 then v_f[12:18] || v_d[5:7] || v_g[3:3]
                    when 4 then v_f[19:21] || v_d[8:9] || v_g[4:4]
                    else v_f[22:27] || v_d[10:12] end;
    v_each := case when k = 4 then (v_cap - 1000000 - public.team_cap_used(v_s2, v_t[4])) / cardinality(v_ids) else 750000 end;
    foreach v_p in array v_ids loop
      insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
        values (v_s2, v_t[k], v_p, public._market_jersey(v_s2, v_t[k]),
                (select r.position from public.season_registrations r where r.season_id = v_s2 and r.profile_id = v_p), v_each, 'draft');
    end loop;
  end loop;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  if (select count(*) from public.roster_spots where season_id = v_s2 and team_id = v_t[3] and status = 'active') <> 12 then raise exception 'world: C is not 12 of 12'; end if;
  if (select count(*) from public.roster_spots where season_id = v_s2 and team_id = v_t[5] and status = 'active') <> 10
     or exists (select 1 from public.roster_spots where season_id = v_s2 and team_id = v_t[5] and public.pos_group(position) = 'G') then
    raise exception 'world: E is not 10 players with no goaltender';
  end if;
  if v_cap - public.team_cap_used(v_s2, v_t[4]) not between 1000000 and 1000005 then
    raise exception 'world: D has % of cap room, expected $1M', v_cap - public.team_cap_used(v_s2, v_t[4]);
  end if;
  -- the schedule: week 1 Dec 16 to 18, 9:00 and 9:35 PM ET, all six final; no games the weeks of Dec 26 and Jan 2;
  -- weeks 2 to 6 from Jan 6, Wednesday to Friday at 9:00 PM ET (week 4, Jan 20 to 22, is the movement deadline week)
  for i in 0..5 loop
    v_day := date '2026-12-16' + (i / 2);
    insert into public.games (season_id, home_team_id, away_team_id, scheduled_at, stage, week, status, home_score, away_score)
      values (v_s2, v_t[1 + (i % 2)], v_t[3 + (i % 2)],
              (v_day + case when i % 2 = 0 then time '21:00' else time '21:35' end) at time zone 'America/New_York',
              'regular', 1, 'final', 3, 2)
      returning id into v_gid;
    v_games := v_games || v_gid;
  end loop;
  for k in 2..6 loop
    for i in 0..2 loop
      insert into public.games (season_id, home_team_id, away_team_id, scheduled_at, stage, week, status)
        values (v_s2, v_t[1], v_t[2], ((date '2027-01-06' + (k - 2) * 7 + i) + time '21:00') at time zone 'America/New_York',
                'regular', k, 'scheduled');
    end loop;
  end loop;
  -- box scores: Pf1..Pf3 (F28..F30), Pd1 (D13) and Pg1 (G5) in all six final games; P6 (F31) in five
  for i in 1..6 loop
    insert into public.game_stats (game_id, team_id, profile_id, is_goalie)
    select v_games[i], (select g.home_team_id from public.games g where g.id = v_games[i]), x.pid, x.pid = v_g[5]
      from unnest(array[v_f[28], v_f[29], v_f[30], v_d[13], v_g[5]] || case when i <= 5 then array[v_f[31]] else '{}'::uuid[] end) as x(pid);
  end loop;
  if (select count(*) from public.market_pool(v_s2) mp where mp.eligible) <> 5
     or (select mp.gp from public.market_pool(v_s2) mp where mp.profile_id = v_f[31]) <> 5 then
    raise exception 'world: the pool should hold exactly five bid-eligible players and P6 at five games';
  end if;
  perform set_config('rh.s2', v_s2::text, true);
  perform set_config('rh.a', v_t[1]::text, true); perform set_config('rh.b', v_t[2]::text, true);
  perform set_config('rh.c', v_t[3]::text, true); perform set_config('rh.d', v_t[4]::text, true);
  perform set_config('rh.e', v_t[5]::text, true);
  perform set_config('rh.oa', v_f[1]::text, true); perform set_config('rh.ob', v_f[2]::text, true);
  perform set_config('rh.oc', v_f[3]::text, true); perform set_config('rh.od', v_f[4]::text, true);
  perform set_config('rh.oe', v_f[5]::text, true);
  perform set_config('rh.pf1', v_f[28]::text, true); perform set_config('rh.pf2', v_f[29]::text, true);
  perform set_config('rh.pf3', v_f[30]::text, true); perform set_config('rh.pd1', v_d[13]::text, true);
  perform set_config('rh.pg1', v_g[5]::text, true); perform set_config('rh.p6', v_f[31]::text, true);
  perform set_config('rh.fx', v_f[32]::text, true);
  perform set_config('rh.com', v_c::text, true);
  perform set_config('rh.dm_pf1', (select count(*) from public.discord_dms where profile_id = v_f[28] and kind = 'market')::text, true);
  perform set_config('rh.dm_pf3', (select count(*) from public.discord_dms where profile_id = v_f[30] and kind = 'market')::text, true);
end $w$;

-- T1 the calendar, as anon
set local role anon;
select set_config('request.jwt.claims', '', true);
do $t1$
declare c jsonb := public.market_calendar(current_setting('rh.s2')::uuid); v text;
begin
  select string_agg(b->>'night', ',' order by b->>'night') into v from jsonb_array_elements(c->'bid_nights') b where not (b->>'skipped')::boolean;
  if v is distinct from '2026-12-19,2027-01-09,2027-01-16' then raise exception 'T1 failed: the bid nights are %', coalesce(v, 'none'); end if;
  select string_agg(b->>'night', ',' order by b->>'night') into v from jsonb_array_elements(c->'bid_nights') b where (b->>'skipped')::boolean;
  if v is distinct from '2026-12-26,2027-01-02' then raise exception 'T1 failed: the skipped Saturdays are %', coalesce(v, 'none'); end if;
  if (c->>'deadline')::timestamptz is distinct from timestamptz '2027-01-23 00:00 America/New_York' then
    raise exception 'T1 failed: the deadline is %', c->>'deadline';
  end if;
  if c->>'next_bid_night' is distinct from '2026-12-19' then raise exception 'T1 failed: the next bid night is %', c->>'next_bid_night'; end if;
  if exists (select 1 from jsonb_array_elements(c->'bid_nights') b where not (b->>'skipped')::boolean and b->>'state' <> 'upcoming')
     or exists (select 1 from jsonb_array_elements(c->'bid_nights') b where (b->>'skipped')::boolean and b->>'state' <> 'skipped') then
    raise exception 'T1 failed: the night states are wrong: %', c->'bid_nights';
  end if;
  if (select (b->>'opens_at')::timestamptz from jsonb_array_elements(c->'bid_nights') b where b->>'night' = '2026-12-19')
       is distinct from timestamptz '2026-12-19 21:00 America/New_York'
     or (select (b->>'new_until')::timestamptz from jsonb_array_elements(c->'bid_nights') b where b->>'night' = '2026-12-19')
       is distinct from timestamptz '2026-12-19 22:00 America/New_York' then
    raise exception 'T1 failed: Dec 19 does not run 9 to 10 PM ET';
  end if;
  if jsonb_array_length(c->'game_nights') <> 18 or not (c->>'draft_done')::boolean or (c->>'moves_locked')::boolean then
    raise exception 'T1 failed: game nights %, draft_done %, moves_locked %', jsonb_array_length(c->'game_nights'), c->>'draft_done', c->>'moves_locked';
  end if;
end $t1$;
reset role;
select set_config('request.jwt.claims', '', true);

-- T2 the open step
do $t2$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_night uuid; v_n int; v_set text; v_exp text; v_bad int;
        v_mark bigint := (select coalesce(max(id), 0) from public.live_marks);
begin
  if public._market_open_night(v_s2, timestamptz '2026-12-19 20:59 America/New_York') <> 0
     or exists (select 1 from public.market_bid_nights where season_id = v_s2) then
    raise exception 'T2 failed: a bid night opened before 9 PM';
  end if;
  v_n := public._market_open_night(v_s2, timestamptz '2026-12-19 21:01 America/New_York');
  select id into v_night from public.market_bid_nights where season_id = v_s2 and night = date '2026-12-19' and state = 'live';
  if v_n <> 1 or v_night is null then raise exception 'T2 failed: the Dec 19 night did not open (%)', v_n; end if;
  select string_agg(l.profile_id::text, ',' order by l.profile_id) into v_set from public.market_lots l
   where l.night_id = v_night and l.state = 'open' and l.gp_at_open = 6 and l.bids = 0 and l.price is null and l.season_id = v_s2;
  select string_agg(x::text, ',' order by x) into v_exp
    from unnest(array[current_setting('rh.pf1'), current_setting('rh.pf2'), current_setting('rh.pf3'),
                      current_setting('rh.pd1'), current_setting('rh.pg1')]::uuid[]) x;
  if v_set is distinct from v_exp or (select count(*) from public.market_lots where night_id = v_night) <> 5 then
    raise exception 'T2 failed: the lots are not exactly the five eligible pool players';
  end if;
  if (select string_agg(ord::text, ',' order by ord) from public.market_lots where night_id = v_night) <> '1,2,3,4,5' then
    raise exception 'T2 failed: the lot order is not 1 to 5';
  end if;
  select count(*) into v_bad from (
    select z.rt, lag(z.rt) over (order by z.ord) as prev, lag(z.ord) over (order by z.ord) as prev_ord
      from (select l.ord, (select max(o.overall) from public.player_position_overalls o where o.profile_id = l.profile_id and o.headline) as rt
              from public.market_lots l where l.night_id = v_night) z) q
   where q.prev_ord is not null and coalesce(q.rt, -1) > coalesce(q.prev, -1);
  if v_bad > 0 then raise exception 'T2 failed: the lots are not in rating order'; end if;
  if public._market_open_night(v_s2, timestamptz '2026-12-19 21:02 America/New_York') <> 0
     or (select count(*) from public.market_lots where night_id = v_night) <> 5
     or (select count(*) from public.market_bid_nights where season_id = v_s2) <> 1 then
    raise exception 'T2 failed: a second open added a night or lots';
  end if;
  if not exists (select 1 from public.live_marks where domain = 'market' and id > v_mark) then raise exception 'T2 failed: the market pulse did not mark'; end if;
  perform set_config('rh.night', v_night::text, true);
  perform set_config('rh.l_pf1', (select id from public.market_lots where night_id = v_night and profile_id = current_setting('rh.pf1')::uuid)::text, true);
  perform set_config('rh.l_pf2', (select id from public.market_lots where night_id = v_night and profile_id = current_setting('rh.pf2')::uuid)::text, true);
  perform set_config('rh.l_pf3', (select id from public.market_lots where night_id = v_night and profile_id = current_setting('rh.pf3')::uuid)::text, true);
  perform set_config('rh.l_pd1', (select id from public.market_lots where night_id = v_night and profile_id = current_setting('rh.pd1')::uuid)::text, true);
  perform set_config('rh.l_pg1', (select id from public.market_lots where night_id = v_night and profile_id = current_setting('rh.pg1')::uuid)::text, true);
end $t2$;

-- T3 to T6 as each club's Owner
set local role authenticated;
do $t3$
declare v_lot uuid := current_setting('rh.l_pf1')::uuid; v_a uuid := current_setting('rh.a')::uuid; v_b uuid := current_setting('rh.b')::uuid;
        j jsonb; v_h text; l record; v_ends timestamptz;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  j := public.market_bid(v_lot, v_a, 750000);
  if not coalesce((j->>'ok')::boolean, false) or (j->>'amount')::bigint <> 750000 or (j->>'next')::bigint <> 1000000 then
    raise exception 'T3 failed: the opening bid returned %', j;
  end if;
  /* named columns only: this block runs as authenticated, which has no grant on the office's void_detail and voided_by */
  select state, price, bids, ends_at into l from public.market_lots where id = v_lot;
  if l.state <> 'running' or l.price <> 750000 or l.bids <> 1 or abs(extract(epoch from (l.ends_at - clock_timestamp())) - 300) > 5 then
    raise exception 'T3 failed: the lot after the opening bid is %', to_jsonb(l);
  end if;
  v_ends := l.ends_at;
  begin
    perform public.market_bid(v_lot, v_a, 1000000);
    raise exception 'T3 failed: A bid twice in a row on the same player';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'own_top' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
  begin
    perform public.market_bid(v_lot, v_b, 750000);
    raise exception 'T3 failed: B bid at a price that had moved';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'price_moved' or sqlerrm <> 'The price moved to $1M. Check it and bid again.' then raise; end if;
  end;
  j := public.market_bid(v_lot, v_b, 1000000);
  select price, bids, ends_at into l from public.market_lots where id = v_lot;
  if l.price <> 1000000 or l.bids <> 2 or l.ends_at <= v_ends or abs(extract(epoch from (l.ends_at - clock_timestamp())) - 300) > 5 then
    raise exception 'T3 failed: the raise did not reset the countdown: %', to_jsonb(l);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  j := public.market_bid(v_lot, v_a, 1250000);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
  begin
    perform public.market_bid(v_lot, v_b, 2000000);
    raise exception 'T3 failed: a jump bid went through';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'price_moved' then raise; end if;
  end;
  select price, bids, state, sold_team_id into l from public.market_lots where id = v_lot;
  if l.price <> 1250000 or l.bids <> 3 or l.state <> 'running' or l.sold_team_id is not null then
    raise exception 'T3 failed: the lot after three bids is %', to_jsonb(l);
  end if;
end $t3$;

do $t4$
declare v_h text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oc'), 'role', 'authenticated')::text, true);
  perform public.market_bid(current_setting('rh.l_pf2')::uuid, current_setting('rh.c')::uuid, 750000);
  raise exception 'T4 failed: a club at 12 of 12 bid';
exception when others then
  get stacked diagnostics v_h = pg_exception_hint;
  if v_h is distinct from 'no_spot' or sqlerrm not like 'Your roster is full (12 of 12). Waive a player first.' then raise; end if;
end $t4$;

do $t5$
declare v_h text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.od'), 'role', 'authenticated')::text, true);
  perform public.market_bid(current_setting('rh.l_pf2')::uuid, current_setting('rh.d')::uuid, 750000);
  begin
    perform public.market_bid(current_setting('rh.l_pf3')::uuid, current_setting('rh.d')::uuid, 750000);
    raise exception 'T5 failed: D bid past its cap room, counting the bid it leads';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'over_cap' or sqlerrm not like 'A bid of $0.75M would take your club over the $30M cap: % plus $0.75M in bids your club leads.' then raise; end if;
  end;
end $t5$;

do $t6$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oe'), 'role', 'authenticated')::text, true);
  perform public.market_bid(current_setting('rh.l_pg1')::uuid, current_setting('rh.e')::uuid, 750000);
  /* E is one goaltender short with two open spots: a forward is accepted only because the goaltender it leads counts */
  perform public.market_bid(current_setting('rh.l_pf3')::uuid, current_setting('rh.e')::uuid, 750000);
  if (select price from public.market_lots where id = current_setting('rh.l_pf3')::uuid) <> 750000 then raise exception 'T6 failed: E''s bid on Pf3 did not land'; end if;
end $t6$;

-- T7 hidden bidders
set local role anon;
select set_config('request.jwt.claims', '', true);
do $t7a$
declare l record;
begin
  if (select count(*) from public.market_bids) <> 0 then raise exception 'T7 failed: anon read a live bid'; end if;
  select id, price, bids, sold_team_id, state into l from public.market_lots where id = current_setting('rh.l_pf1')::uuid;
  if l.price <> 1250000 or l.bids <> 3 or l.sold_team_id is not null or l.state <> 'running' then raise exception 'T7 failed: anon reads the lot as %', to_jsonb(l); end if;
end $t7a$;
set local role authenticated;
do $t7b$
declare v_lot uuid := current_setting('rh.l_pf1')::uuid; v_state text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oc'), 'role', 'authenticated')::text, true);
  if (select count(*) from public.market_bids where lot_id = v_lot) <> 0 then raise exception 'T7 failed: C read another club''s live bid'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  if (select count(*) from public.market_bids where lot_id = v_lot) <> 2
     or exists (select 1 from public.market_bids where lot_id = v_lot and team_id <> current_setting('rh.a')::uuid) then
    raise exception 'T7 failed: A does not read exactly its own two bids';
  end if;
  begin
    perform (select placed_by from public.market_bids where lot_id = v_lot limit 1);
    raise exception 'T7 failed: a member read placed_by';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.com'), 'role', 'authenticated')::text, true);
  if (select count(*) from public.market_bids where lot_id = v_lot) <> 3 then raise exception 'T7 failed: the office does not read every live bid'; end if;
end $t7b$;

-- T8 the club state counts and shows leads to the club's own front office only
do $t8$
declare s jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  s := public.market_club_state(current_setting('rh.a')::uuid);
  if jsonb_array_length(s->'leading') <> 1 or (s->'leading'->0->>'amount')::bigint <> 1250000 or (s->>'committed')::bigint <> 1250000
     or (s->>'free_spots')::int <> (s->>'spots')::int - 1 then
    raise exception 'T8 failed: A''s own state is %', s;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
  s := public.market_club_state(current_setting('rh.a')::uuid);
  if s ? 'leading' or s ? 'committed' then raise exception 'T8 failed: B read A''s leads'; end if;
end $t8$;

-- T9 void
do $t9$
declare v_h text; j jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  begin
    perform public.market_void_lot(current_setting('rh.l_pg1')::uuid, 'not mine to void');
    raise exception 'T9 failed: a club Owner voided a lot';
  exception when others then
    if sqlerrm not like 'Only a commissioner or the Draft and Bidding manager can withdraw a player%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.com'), 'role', 'authenticated')::text, true);
  j := public.market_void_lot(current_setting('rh.l_pg1')::uuid, 'rehearsal: withdrawn');
  if (select state from public.market_lots where id = current_setting('rh.l_pg1')::uuid) <> 'void'
     or (select why from public.market_lots where id = current_setting('rh.l_pg1')::uuid) <> 'Withdrawn by the league office.' then
    raise exception 'T9 failed: the lot is not void';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oe'), 'role', 'authenticated')::text, true);
  begin
    perform public.market_bid(current_setting('rh.l_pd1')::uuid, current_setting('rh.e')::uuid, 750000);
    raise exception 'T9 failed: E bid a defenseman with no room left for the goaltender it lacks';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'minimums' then raise; end if;
  end;
  begin
    perform public.market_bid(current_setting('rh.l_pg1')::uuid, current_setting('rh.e')::uuid, 1000000);
    raise exception 'T9 failed: a bid on a void lot went through';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'void' then raise; end if;
  end;
end $t9$;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $t9b$
begin
  if (select count(*) from public.market_bids where lot_id = current_setting('rh.l_pg1')::uuid) <> 1
     or (select count(*) from public.market_bids where lot_id = current_setting('rh.l_pf1')::uuid) <> 0 then
    raise exception 'T9 failed: once a lot is over its bids are public, and only then';
  end if;
end $t9b$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t9c$
declare l record;
begin
  select void_detail, voided_by into l from public.market_lots where id = current_setting('rh.l_pg1')::uuid;
  if l.void_detail is distinct from 'rehearsal: withdrawn' or l.voided_by is distinct from current_setting('rh.com')::uuid then
    raise exception 'T9 failed: the office detail is %', to_jsonb(l);
  end if;
  if not exists (select 1 from public.admin_audit where action = 'market_void_lot' and target_id = current_setting('rh.l_pg1')) then
    raise exception 'T9 failed: no audit row for the void';
  end if;
  if not exists (select 1 from public.notifications where profile_id = current_setting('rh.oe')::uuid and title like 'Saturday bidding: % withdrawn') then
    raise exception 'T9 failed: the club that led the lot was not told';
  end if;
end $t9c$;

-- T10 pause and resume
set local role authenticated;
do $t10$
declare v_h text; j jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  begin
    perform public.market_pause(current_setting('rh.night')::uuid, 'not mine to pause');
    raise exception 'T10 failed: a club Owner paused bidding';
  exception when others then
    if sqlerrm not like 'Only a commissioner or the Draft and Bidding manager can pause Saturday bidding.' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.com'), 'role', 'authenticated')::text, true);
  j := public.market_pause(current_setting('rh.night')::uuid, 'rehearsal');
  if (j->>'frozen')::int <> 3
     or exists (select 1 from public.market_lots where night_id = current_setting('rh.night')::uuid and state = 'running'
                  and (ends_at is not null or paused_remaining is null)) then
    raise exception 'T10 failed: the pause did not freeze the three running countdowns: %', j;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
  begin
    perform public.market_bid(current_setting('rh.l_pf1')::uuid, current_setting('rh.b')::uuid, 1500000);
    raise exception 'T10 failed: a bid landed during the pause';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'paused' then raise; end if;
  end;
end $t10$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t10b$
begin
  /* a two-minute pause */
  update public.market_bid_nights set paused_at = paused_at - interval '120 seconds' where id = current_setting('rh.night')::uuid;
  perform set_config('rh.nu0', (select new_until from public.market_bid_nights where id = current_setting('rh.night')::uuid)::text, true);
  perform set_config('rh.rem', (select extract(epoch from paused_remaining) from public.market_lots where id = current_setting('rh.l_pf1')::uuid)::text, true);
end $t10b$;
set local role authenticated;
do $t10c$
declare j jsonb; l record;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.com'), 'role', 'authenticated')::text, true);
  j := public.market_resume(current_setting('rh.night')::uuid);
  if abs(extract(epoch from ((select new_until from public.market_bid_nights where id = current_setting('rh.night')::uuid)
                             - current_setting('rh.nu0')::timestamptz)) - 120) > 5
     or (select paused_at from public.market_bid_nights where id = current_setting('rh.night')::uuid) is not null then
    raise exception 'T10 failed: the resume did not move the 10 PM cut by the pause: %', j;
  end if;
  select ends_at, paused_remaining into l from public.market_lots where id = current_setting('rh.l_pf1')::uuid;
  if l.paused_remaining is not null or abs(extract(epoch from (l.ends_at - clock_timestamp())) - current_setting('rh.rem')::numeric) > 5 then
    raise exception 'T10 failed: the countdown did not get its time back: %', to_jsonb(l);
  end if;
end $t10c$;
reset role;
select set_config('request.jwt.claims', '', true);

-- T11 a countdown runs out: the tick sells Pf1 to A at $1.25M
do $t11$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_pf1 uuid := current_setting('rh.pf1')::uuid; l record; s record; c record; v_res text;
begin
  update public.market_lots set ends_at = clock_timestamp() - interval '1 second' where id = current_setting('rh.l_pf1')::uuid;
  perform public.market_tick();
  select * into l from public.market_lots where id = current_setting('rh.l_pf1')::uuid;
  if l.state <> 'sold' or l.sold_team_id <> current_setting('rh.a')::uuid or l.price <> 1250000 or l.sold_at is null or l.ended_at is null then
    raise exception 'T11 failed: the lot is %', to_jsonb(l);
  end if;
  select * into s from public.roster_spots where season_id = v_s2 and profile_id = v_pf1;
  if s.team_id is distinct from current_setting('rh.a')::uuid or s.origin <> 'market_bid' or s.salary <> 1250000 or s.status <> 'active' then
    raise exception 'T11 failed: the roster spot is %', to_jsonb(s);
  end if;
  select * into c from public.contracts where profile_id = v_pf1 and status = 'active' and not coalesce(is_manager, false);
  if c.salary is distinct from 1250000 or c.start_season <> 2 or c.end_season <> 2 or c.team_id <> current_setting('rh.a')::uuid then
    raise exception 'T11 failed: the contract is %', to_jsonb(c);
  end if;
  if (select status from public.season_registrations where season_id = v_s2 and profile_id = v_pf1) <> 'assigned' then
    raise exception 'T11 failed: the sign-up is not assigned';
  end if;
  if (select count(*) from public.transactions where season_id = v_s2 and type = 'bid' and description like '% won <b>% at Saturday bidding for $1.25M, on a contract to the end of the season.') <> 1 then
    raise exception 'T11 failed: no bid transaction';
  end if;
  if (select count(*) from public.discord_dms where profile_id = v_pf1 and kind = 'market') <> current_setting('rh.dm_pf1')::int + 2 then
    raise exception 'T11 failed: Pf1 should have two market DMs (bidding opened, signed)';
  end if;
  select value into v_res from public.app_config where key = 'rl_market-tick_result';
  if v_res is not null and (v_res::jsonb->>'ok') = 'false' then raise exception 'T11 failed: the tick recorded a failure: %', v_res; end if;
  if not exists (select 1 from public.app_config where key = 'rl_market-tick' and updated_at >= now()) then raise exception 'T11 failed: no heartbeat'; end if;
end $t11$;
set local role anon;
do $t11b$
begin
  if (select count(*) from public.market_bids where lot_id = current_setting('rh.l_pf1')::uuid) <> 3 then
    raise exception 'T11 failed: the sold lot''s bids are not public';
  end if;
end $t11b$;
reset role;

-- T12 a sale the cap guard refuses voids the lot and does not fail the tick
do $t12$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_d uuid := current_setting('rh.d')::uuid; l record; v_res text;
begin
  /* $750K: apply_contract_on_roster lifts any new contract to at least $750K, so D keeps about $250K of room, below the
     $750K Pf2 sells for */
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
    values (v_s2, v_d, current_setting('rh.fx')::uuid, public._market_jersey(v_s2, v_d),
            (select r.position from public.season_registrations r where r.season_id = v_s2 and r.profile_id = current_setting('rh.fx')::uuid), 750000, 'draft');
  if (select salary_cap from public.seasons where id = v_s2) - public.team_cap_used(v_s2, v_d) >= 750000 then
    raise exception 'T12 failed: D still has room for Pf2 (%)', (select salary_cap from public.seasons where id = v_s2) - public.team_cap_used(v_s2, v_d);
  end if;
  update public.market_lots set ends_at = clock_timestamp() - interval '1 second' where id = current_setting('rh.l_pf2')::uuid;
  perform public.market_tick();
  select * into l from public.market_lots where id = current_setting('rh.l_pf2')::uuid;
  if l.state <> 'void' or l.why <> 'The sale could not be completed.' or l.void_detail not like 'Over the salary cap%' then
    raise exception 'T12 failed: the lot is %', to_jsonb(l);
  end if;
  if exists (select 1 from public.roster_spots where season_id = v_s2 and profile_id = current_setting('rh.pf2')::uuid) then
    raise exception 'T12 failed: Pf2 joined a roster';
  end if;
  if not exists (select 1 from public.market_pool(v_s2) mp where mp.profile_id = current_setting('rh.pf2')::uuid and mp.eligible) then
    raise exception 'T12 failed: Pf2 left the pool';
  end if;
  select value into v_res from public.app_config where key = 'rl_market-tick_result';
  if v_res is not null and (v_res::jsonb->>'ok') = 'false' then raise exception 'T12 failed: the refused sale failed the tick: %', v_res; end if;
  /* this transaction's own request, by its text: production traffic moves the table's total while the case runs. Staff
     posts pass through _pillify, which turns a gamertag or club name into a mention; no gamertag or club name equals a
     word these patterns use (read-only probe, 2026-11-24) */
  if (select count(*) from net.http_request_queue q where convert_from(q.body, 'UTF8') like '%Saturday bidding: the sale of%could not be completed%') <> 1 then
    raise exception 'T12 failed: the staff channel was not told';
  end if;
  if not exists (select 1 from public.notifications where profile_id = current_setting('rh.od')::uuid and title = 'Saturday bidding: sale not completed') then
    raise exception 'T12 failed: D''s seats were not told';
  end if;
end $t12$;

-- T13 the 10 PM cut
set local role authenticated;
do $t13$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
  perform public.market_bid(current_setting('rh.l_pf3')::uuid, current_setting('rh.b')::uuid, 1000000);
end $t13$;
reset role;
select set_config('request.jwt.claims', '', true);
update public.market_bid_nights set opens_at = clock_timestamp() - interval '1 hour', new_until = clock_timestamp() - interval '1 second'
 where id = current_setting('rh.night')::uuid;
set local role authenticated;
do $t13b$
declare v_h text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  perform public.market_bid(current_setting('rh.l_pd1')::uuid, current_setting('rh.a')::uuid, 750000);
  raise exception 'T13 failed: a new auction opened after 10 PM';
exception when others then
  get stacked diagnostics v_h = pg_exception_hint;
  if v_h is distinct from 'new_closed' then raise; end if;
end $t13b$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t13c$
begin
  perform public.market_tick();
  if (select state from public.market_lots where id = current_setting('rh.l_pd1')::uuid) <> 'unsold' then raise exception 'T13 failed: Pd1 is not unsold'; end if;
  if (select state from public.market_bid_nights where id = current_setting('rh.night')::uuid) <> 'closing' then
    raise exception 'T13 failed: the night is not closing while Pf3 runs';
  end if;
  if (select state from public.market_lots where id = current_setting('rh.l_pf3')::uuid) <> 'running' then raise exception 'T13 failed: Pf3 stopped running'; end if;
end $t13c$;
set local role authenticated;
do $t13d$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oe'), 'role', 'authenticated')::text, true);
  perform public.market_bid(current_setting('rh.l_pf3')::uuid, current_setting('rh.e')::uuid, 1250000);
  if (select price from public.market_lots where id = current_setting('rh.l_pf3')::uuid) <> 1250000 then
    raise exception 'T13 failed: a raise on a running countdown after 10 PM did not land';
  end if;
end $t13d$;
reset role;
select set_config('request.jwt.claims', '', true);

-- T14 the last countdown runs out: the night closes and the recap posts once
do $t14$
declare v_s2 uuid := current_setting('rh.s2')::uuid; n record;
begin
  update public.market_lots set ends_at = clock_timestamp() - interval '1 second' where id = current_setting('rh.l_pf3')::uuid;
  perform public.market_tick();
  if (select state from public.market_lots where id = current_setting('rh.l_pf3')::uuid) <> 'sold'
     or (select team_id from public.roster_spots where season_id = v_s2 and profile_id = current_setting('rh.pf3')::uuid) is distinct from current_setting('rh.e')::uuid
     or (select salary from public.roster_spots where season_id = v_s2 and profile_id = current_setting('rh.pf3')::uuid) <> 1250000 then
    raise exception 'T14 failed: Pf3 did not sell to E at $1.25M';
  end if;
  select * into n from public.market_bid_nights where id = current_setting('rh.night')::uuid;
  if n.state <> 'closed' or n.closed_at is null or n.recap_at is null then raise exception 'T14 failed: the night is %', to_jsonb(n); end if;
  if (select count(*) from public.app_config where key = 'ann_2_market-recap-2026-12-19') <> 1 then raise exception 'T14 failed: no recap mark'; end if;
  /* the recap's own request, by its title (the sale's 'bid' transaction post alone would move a table count) */
  if (select count(*) from net.http_request_queue q where convert_from(q.body, 'UTF8') like '%Saturday bidding: December 19%') <> 1 then
    raise exception 'T14 failed: the recap was not posted once';
  end if;
  if (select count(*) from net.http_request_queue q where convert_from(q.body, 'UTF8') like '%Saturday bidding: December 19%'
        and convert_from(q.body, 'UTF8') like '%1 player had no bids and stays eligible for the next bid night, January 9.%') <> 1 then
    raise exception 'T14 failed: the recap does not name Jan 9 as the next bid night for the unbid player';
  end if;
  if (select count(*) from public.discord_dms where profile_id = current_setting('rh.pf3')::uuid and kind = 'market') <> current_setting('rh.dm_pf3')::int + 2 then
    raise exception 'T14 failed: Pf3 should have two market DMs';
  end if;
  perform public.market_tick();
  if (select count(*) from net.http_request_queue q where convert_from(q.body, 'UTF8') like '%Saturday bidding: December 19%') <> 1
     or (select count(*) from public.app_config where key like 'ann_2_market-recap-%') <> 1 then
    raise exception 'T14 failed: a second tick posted again';
  end if;
end $t14$;
set local role authenticated;
do $t14b$
declare v_h text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  perform public.market_bid(current_setting('rh.l_pd1')::uuid, current_setting('rh.a')::uuid, 750000);
  raise exception 'T14 failed: a bid landed on a closed night';
exception when others then
  get stacked diagnostics v_h = pg_exception_hint;
  if v_h is distinct from 'over' then raise; end if;
end $t14b$;

-- T15 the calendar after the night
set local role anon;
select set_config('request.jwt.claims', '', true);
do $t15$
declare c jsonb := public.market_calendar(current_setting('rh.s2')::uuid);
begin
  if (select b->>'state' from jsonb_array_elements(c->'bid_nights') b where b->>'night' = '2026-12-19') is distinct from 'closed'
     or (select b->>'id' from jsonb_array_elements(c->'bid_nights') b where b->>'night' = '2026-12-19') is distinct from current_setting('rh.night')
     or c->>'next_bid_night' is distinct from '2027-01-09' then
    raise exception 'T15 failed: the calendar reads %', c->'bid_nights';
  end if;
end $t15$;

-- T16 bid boards
set local role authenticated;
do $t16$
declare v_h text; v_n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  v_n := public.save_market_board(current_setting('rh.a')::uuid,
    jsonb_build_array(jsonb_build_object('profile_id', current_setting('rh.pf2'), 'ceiling', 1500000, 'note', 'first target'),
                      jsonb_build_object('profile_id', current_setting('rh.pd1'))));
  if v_n <> 2 or (select count(*) from public.market_boards where team_id = current_setting('rh.a')::uuid) <> 2
     or (select rank from public.market_boards where team_id = current_setting('rh.a')::uuid and profile_id = current_setting('rh.pd1')::uuid) <> 2 then
    raise exception 'T16 failed: A''s board did not save';
  end if;
  begin
    perform public.save_market_board(current_setting('rh.a')::uuid, jsonb_build_array(jsonb_build_object('profile_id', current_setting('rh.pf2'), 'ceiling', 1100000)));
    raise exception 'T16 failed: a ceiling off the bid steps saved';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'ceiling' then raise; end if;
  end;
  begin
    perform public.save_market_board(current_setting('rh.a')::uuid, jsonb_build_array(jsonb_build_object('profile_id', current_setting('rh.pf1'))));
    raise exception 'T16 failed: a rostered player went on a board';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'not_in_pool' then raise; end if;
  end;
  begin
    perform public.save_market_board(current_setting('rh.a')::uuid,
      jsonb_build_array(jsonb_build_object('profile_id', current_setting('rh.pd1')), jsonb_build_object('profile_id', current_setting('rh.pd1'))));
    raise exception 'T16 failed: a player listed twice saved';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'duplicate' then raise; end if;
  end;
  begin
    perform public.save_market_board(current_setting('rh.a')::uuid, jsonb_build_array(jsonb_build_object('profile_id', 'not a player')));
    raise exception 'T16 failed: a malformed player id saved';
  exception when others then
    if sqlerrm <> 'Row 1 of the board names no player.' then raise; end if;
  end;
  begin
    perform public.save_market_board(current_setting('rh.a')::uuid, jsonb_build_array(jsonb_build_object('profile_id', current_setting('rh.pd1'), 'ceiling', 'lots')));
    raise exception 'T16 failed: a malformed ceiling saved';
  exception when others then
    get stacked diagnostics v_h = pg_exception_hint;
    if v_h is distinct from 'ceiling' then raise; end if;
  end;
  if (select count(*) from public.market_boards where team_id = current_setting('rh.a')::uuid) <> 2 then
    raise exception 'T16 failed: a refused save changed the board';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
  if (select count(*) from public.market_boards where team_id = current_setting('rh.a')::uuid) <> 0 then raise exception 'T16 failed: B read A''s board'; end if;
end $t16$;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $t16b$
declare v_state text;
begin
  perform (select count(*) from public.market_boards);
  raise exception 'T16 failed: anon read the bid boards';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  if v_state <> '42501' then raise; end if;
end $t16b$;

-- T17 no client writes
do $t17a$
declare v_state text;
begin
  perform public.market_bid(current_setting('rh.l_pd1')::uuid, current_setting('rh.a')::uuid, 750000);
  raise exception 'T17 failed: anon called market_bid';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  /* the grant refuses, not market_bid's own seat check (which also raises 42501) */
  if v_state <> '42501' or sqlerrm not like 'permission denied for function market_bid%' then raise; end if;
end $t17a$;
set local role authenticated;
do $t17b$
declare v_state text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
  begin
    insert into public.market_bids (lot_id, night_id, team_id, seq, amount, placed_by)
      values (current_setting('rh.l_pd1')::uuid, current_setting('rh.night')::uuid, current_setting('rh.a')::uuid, 1, 750000, current_setting('rh.oa')::uuid);
    raise exception 'T17 failed: a member wrote a bid';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise; end if;
  end;
  begin
    update public.market_lots set price = 1 where id = current_setting('rh.l_pd1')::uuid;
    raise exception 'T17 failed: a member updated a lot';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise; end if;
  end;
  begin
    perform (select void_detail from public.market_lots where id = current_setting('rh.l_pg1')::uuid);
    raise exception 'T17 failed: a member read void_detail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise; end if;
  end;
end $t17b$;
reset role;
select set_config('request.jwt.claims', '', true);

-- T18 the open step's edges
do $t18$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_night uuid; v_set text; v_exp text;
begin
  if public._market_open_night(v_s2, timestamptz '2026-12-26 21:01 America/New_York') <> 0 then raise exception 'T18 failed: a holiday Saturday opened'; end if;
  if public._market_open_night(v_s2, timestamptz '2027-01-23 21:01 America/New_York') <> 0 then raise exception 'T18 failed: a night opened after the deadline'; end if;
  update public.seasons set moves_lock_override = 'locked' where id = v_s2;
  if public._market_open_night(v_s2, timestamptz '2027-01-09 21:01 America/New_York') <> 0 then raise exception 'T18 failed: a night opened while moves are locked'; end if;
  update public.seasons set moves_lock_override = 'auto' where id = v_s2;
  if (select count(*) from public.market_bid_nights where season_id = v_s2) <> 1 then raise exception 'T18 failed: an edge opened a night'; end if;
  if public._market_open_night(v_s2, timestamptz '2027-01-09 21:01 America/New_York') <> 1 then raise exception 'T18 failed: Jan 9 did not open'; end if;
  select id into v_night from public.market_bid_nights where season_id = v_s2 and night = date '2027-01-09';
  select string_agg(profile_id::text, ',' order by profile_id) into v_set from public.market_lots where night_id = v_night;
  select string_agg(x::text, ',' order by x) into v_exp
    from unnest(array[current_setting('rh.pf2'), current_setting('rh.pd1'), current_setting('rh.pg1')]::uuid[]) x;
  if v_set is distinct from v_exp then raise exception 'T18 failed: Jan 9 should hold Pf2, Pd1 and Pg1 only'; end if;
  /* a pause left on: the office pauses Jan 9 (as the commissioner) and never resumes it */
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.com'), 'role', 'authenticated')::text, true);
  perform public.market_pause(v_night, 'rehearsal: left on');
  perform set_config('request.jwt.claims', '', true);
  if public._market_open_night(v_s2, timestamptz '2027-01-16 21:01 America/New_York') <> 1 then raise exception 'T18 failed: Jan 16 did not open'; end if;
  select id into v_night from public.market_bid_nights where season_id = v_s2 and night = date '2027-01-16';
  if v_night is null or exists (select 1 from public.market_lots where night_id = v_night) then
    raise exception 'T18 failed: Jan 16 auctioned a player still up for auction on the paused Jan 9';
  end if;
  if (select count(*) from net.http_request_queue q
       where convert_from(q.body, 'UTF8') like '%opened while the bidding of Jan 9 is still paused%') <> 1 then
    raise exception 'T18 failed: the staff channel was not told the paused Jan 9 holds its players';
  end if;
end $t18$;

-- T19 Season 1
do $t19$
declare v_s1 uuid := (select id from public.seasons where number = 1);
begin
  if public.market_on(v_s1) or public.market_calendar(v_s1) <> jsonb_build_object('season_id', v_s1, 'market', false)
     or exists (select 1 from public._market_bid_nights(v_s1)) then
    raise exception 'T19 failed: Season 1 has a market';
  end if;
end $t19$;

-- verdict (uncaught: everything above rolls back)
do $v$
begin
  raise exception 'REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19';
end $v$;
