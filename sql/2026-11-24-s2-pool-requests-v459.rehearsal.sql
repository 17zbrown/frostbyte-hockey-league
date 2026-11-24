-- Rehearsal for sql/2026-11-24-s2-pool-requests-v459.sql (market-engine Part 2, as the commissioner's 2026-11-23 and
-- 2026-11-24 rulings and the main session's 2026-11-24 review decisions rewrote it). The main session runs it on
-- production as ONE execute_sql call: one transaction that ends in an uncaught raise, so everything rolls back (CLAUDE.md,
-- Database change protocol step 2). Agents never run it.
--
-- Prerequisites: the v4.58 records live (draft-night guards, waivers with market_tick, minimums). Nothing else needs to be
-- prepended: this file carries the record's text byte for byte between the markers (tools/s2-pool-requests-v459.test.cjs
-- pins it up to the record's results comment). If the bid nights, committees or playoff records were applied first,
-- rehearse against that state: the ticks here then also run their steps. The rollback is the proof that nothing was
-- sent: pg_net queue rows and discord_dms rows written here roll back with everything else (counting those tables before
-- and after proves nothing, since live traffic changes them all the time).
--
-- When: any day before Season 2's first game night that has NO Season 2 game on it, and not in the fifteen minutes before
-- midnight ET (the world raises otherwise): the rehearsal moves its own games onto today, and the lineup deadline step
-- rules every Season 2 game past its lock. It works on an empty Season 2 and after the Dec 5 seating alike (it seats an
-- Owner only where a club has none, and dresses players who are on no roster), but not while a Season 2 shortfall draw is
-- open (the world raises: a draw inside a tick would place one of its camp players at random). Run it at a quiet time,
-- never near a game window or a Saturday bid night: creating the two tables takes SHARE ROW EXCLUSIVE locks on seasons,
-- games, teams and profiles until the rollback, so writes to them (sign-ups, the bot, discord-sync, lineup filings) wait,
-- and the real market tick waits on the heartbeat row this transaction's ticks hold. The run takes seconds, and must
-- finish inside four minutes (its first game drops the puck then).
--
-- The world, built inside the transaction from real Season 2 sign-ups (no names are written here): Season 2's draft
-- complete; the first three clubs by code, A, B and C, each with an Owner (the seated one, or a sign-up) and six rostered
-- players (3 F, 2 D, 1 G); training camp players P1 to P7, a control X and a suspended player S, all in the pool; games on
-- the first free night N1 at least three days out (G1 A v B 9:00, G2 A v C 9:35, G3 B v C 10:10 PM ET), on N1 + 1 (G4
-- A v B 9:00, G5 B v C 9:35) and a playoff game a week after N1.
-- Cases:
--   T1  requests: A asks P1, P2, P3 and P4 for G1, P1 and P5 for G2; B asks P1, P5 and P6 for G1, P7 for G3.
--   T2  refusals: a rostered player, a suspended player, a second ask, a playoff game, a game the club is not in, another
--       club's seat.
--   T3  visibility before the lock: anon sees none, C's Owner none, A's Owner A's six only, P1 their three.
--   T4  answers: P1 accepts A for G1 (B's G1 ask closes with a note), and A for G2 (same club, same night); P1 cannot take
--       B's closed ask; P2 declines and cannot answer twice; P3 cannot answer P4's; P3 and P4 accept (A's third camp
--       player closes A's open ask to P5); P5 accepts B for G1.
--   T5  the night rules: A cannot add a fourth camp player for N1; B cannot ask P3 (playing for A on N1); B asks P2 for
--       G1; on N2 B asks P1 for G4 and P1 accepts (a new night).
--   T6  withdraw and back out (before the lock): B withdraws its open ask to P6; A cannot withdraw B's; B dresses P1 for G4
--       and releases them (withdrawn, off B's sheet, P1 told); the freed P1 accepts A for G4, is dressed, then withdraws
--       the acceptance (declined, off A's sheet, A's seats told) and A cannot ask them again for that game.
--   T7  lineups: A's five-player sheet with three guests is refused (half the lineup); a declined player is refused with
--       the missing-request sentence; A dresses three guests and three of its own for G1 and its own six for G2; a guest
--       never enters a season line (set_team_line); B dresses its own six for G1; C files only five for G2; P5 cannot dress
--       for G3 (accepted for G1 only); once P5 is suspended B cannot dress them for G1.
--   T8  before the lock the guest cannot see the code.
--   T9  a sign-up made after the draft completed is in the pool (it does not prove the door stays open past a cutoff); B
--       asks it, P6 and P7 for G5, the first two accept, and B dresses both with four of its own.
--   T10 time moves past N1's lock: its games move onto today, a few minutes out, G3 first (locks passed, pucks not
--       dropped), the requests' game_at with them, and the N1 sheets are stamped as filed an hour ago (before the lock).
--       A request, an answer, a withdrawal, a release and a player's withdrawal are refused; C cannot complete its
--       five-player G2 sheet and B cannot file a first G3 sheet (the deadline); B may still change its full G1 six.
--   T11 the tick: C forfeits G2 1-0 (a five-player sheet; one #game-scores post), G3 is voided (one post), G1 stands, each
--       with one ruling row; the night's lock stays G3's although G3 is voided; B's open ask to P2 lapses, its G3 ask
--       closes, P5's accepted ask closes (suspended); P1, P3 and P4 each get G1's lobby code by DM and bell once; a second
--       tick rules and sends nothing. After the ruling B drops to five and a tick does not forfeit G1, then B refills its
--       six; G1 is delayed two minutes within its night and keeps its guests (game_at follows, P1 told), lock unchanged.
--   T12 after the lock: the guest sees the code, a lapsed player does not; anon sees every G1 request and never who asked.
--   T13 G1 is played: the guests' box lines raise no flag, an unrequested pool player's does; the guests' games count for
--       bid eligibility; P5's suspension serves one night for two final games, keeps it when the first is reopened, and
--       serves a second night on N2. The reopened G2 (a deadline forfeit) stays reopened across two ticks: no second
--       ruling, no second #game-scores post.
--   T14 P6, placed on C's roster, loses their accepted G5 ask and comes off B's G5 sheet (B told to refile); L, placed on
--       B's own roster, loses the ask but stays on B's sheet (the control); a moved game closes its open ask.
--   T15 Season 1: season_rules unchanged, not a market season.

begin;

-- >>> record text: sql/2026-11-24-s2-pool-requests-v459.sql
-- v4.59 (2026-11-24): Season 2 training camp requests, per game, and the lineup deadline forfeit. A club's front office
-- asks a training camp player to play ONE game; the player accepts or declines on the site; an accepted request is the
-- player's permission slip for that game. A club without a full lineup of six for a game at its lineup lock forfeits the
-- game.
--
-- Rulings this builds (league law, quoted from the commissioner):
--   2026-11-23 (late night), replacing "one pool request per club per night": "A team is allowed to play with up to 3
--     training camp players per night. The requirement is that at least half the game lineup should consist of players
--     on the club." (6v6: at most three training camp players in a game lineup, at least three of the club's own.)
--   2026-11-24: "management can informally ask training camp players if they can fill in for the night via the training
--     camp discord channel that is only accessible to staff, team management, and the training camp pool, but must
--     request them via the site to officially be able to temporarily add them to the lineup for the specific game, or
--     night." The camp player ACCEPTS or DECLINES the site request.
--   2026-11-24 (about 2 AM ET): "Can you do the requests per game instead of per night?" Readings stated to the
--     commissioner (memory season2-format-rulings): several clubs may request the same player and the player's first
--     acceptance wins; a camp player plays for only ONE club a night (once they accept a club's game, other clubs'
--     requests for that night close, and the same club may request them for more of its games that night); at most
--     three DIFFERENT camp players for a club across a night; requests and answers close at the lineup lock, and an
--     unanswered request lapses then; management may withdraw a request before it is accepted; the lobby code reaches the
--     player by bot DM for that game; no camp players in the playoffs. The one-night guest: no roster spot, no contract,
--     no cap or roster count; the request covers that game only.
--   2026-11-23 (late night): pool requests are visible to the club and staff until the lock, public after.
--   2026-11-24: "If a team does not set their initial lineup for that game before the deadline to set the lineups, that
--     team forfeits the game." (Season 2 and later market seasons only.)
--   Rule 3.2 as published: "The league does not record double forfeits. If neither club fields a lineup and no forfeit is
--     claimed, the game has no result: the officiating department or a commissioner voids it".
--   Season 2 default stated to the commissioner (2026-10-13), never reopened: "Pool-player suspensions are served per
--     league game night."
-- Decisions on the review of this record (main session, 2026-11-24, binding):
--   a lineup counts as set only when it names a full six; the forfeit is ruled ONCE per game, at that game's own lock
--     (puck drop minus 30 minutes), with a durable mark, never judged again on a later tick and never reversed by the tick;
--     it applies in every stage, playoffs included; ruling or voiding a game does not move that night's lock.
--   after acceptance and before the night's lock, the camp player may withdraw the acceptance and the club may release
--     the guest; either one takes the player off any filed sheet for that game (a sheet left short of six must be refiled
--     before the game's lock), tells the other side, and frees the slot. After the lock, neither.
--   a league pull after a game's lock (the playoff series sweeps, a roster removal, a suspension) never turns a lineup that
--     was legal at its lock into a forfeit: the forfeit is judged once, at the lock.
--
-- What changes (every Season 2 branch is a market season's; Season 1 paths are unchanged and proved byte-identical below):
--   1. public.market_pool_requests (new): one row per request, per game. RLS on, every API grant revoked, then SELECT on
--      the columns that do not name who acted; one SELECT policy: the requesting club's seats, the player and the league
--      office until the night's lock (night_lock_at), everyone after it. No client writes. Realtime and the 'market' pulse.
--   2. public.market_lineup_deadlines (new, office only): the lineup deadline ruling, one per game and night, the durable
--      mark that the game was ruled at its lock.
--   3. public.market_pool_request(p_game, p_team, p_profile), public.market_pool_answer(p_request, p_accept) and
--      public.market_pool_withdraw(p_request): the three doors, each refusing in plain league words with a hint. The
--      answer door also lets a player withdraw an acceptance (p_accept false) and the withdraw door also releases an
--      accepted guest, both until the night's lock; either takes the guest off the club's filed sheet
--      (public._market_guest_off_sheet).
--   4. public._market_guest(p_game, p_team, p_profile): THE test for a one-night guest (an accepted request for that game
--      and club, and no roster spot this season). public.lineup_slot_ok (DROP plus CREATE with p_game uuid default null)
--      passes a guest for that game only, and set_game_lineup skips a guest's contract test, passes the game to
--      lineup_slot_ok, and refuses a sheet where the club's own players are fewer than half. set_team_line passes no game,
--      so a guest never enters a season line. guard_lineup_suspended (unchanged) refuses a suspended guest.
--   5. set_game_lineup: in a market season, from a game's lineup lock until the game is ruled, a club whose sheet does not
--      name six cannot complete it (the league office may still file, v3.79), so the ruling reads the sheet that was on
--      file at the lock. A dressed player on no roster is told they have not accepted a request for this game.
--   6. public.can_see_match: a player who accepted a club's request for THIS game sees its code and server from the
--      night's lock, the same moment as the clubs (Rule 4.2). public.review_game_records: such a player is legitimate
--      for that game, never "on no squad".
--   7. public.count_suspension_games: a games suspension of a training camp pool player is served one league game night
--      at a time (public._market_pool_suspension_night), since a pool player has no club games to count.
--   8. public.market_tick gains two steps above its "steps end" line: public._market_lineup_forfeits (the lineup deadline,
--      ruled once per game at its lock: the forfeit, or the void where neither club had a full six) and
--      public._market_pool_sweep (closes requests for games no longer open, lapses unanswered ones at the lock, closes
--      live ones whose game moved or whose player left the pool or was suspended, takes a closed guest off the sheet, and
--      DMs each accepted player the lobby code once the night has locked).
--   9. public.night_lock_at(uuid, date): a night's lock that has passed stays where it was when a game of that night is
--      voided or moved (the earliest ruled lock of the night holds it). Season 1 proved unchanged, every night.
--  10. public.mgmt_request_move: in a market season the Owner's "Approval needed" bell for a queued lineup names that
--      game's lineup deadline, because an approval after it cannot set a missing lineup.
--
-- Doors only: the games row (its triggers post the one #game-scores line, notify_discord_game_final, and do the rest of
-- the forfeit bookkeeping), notify_staff_ch (the staff channel), create_notification and club_notify with p_room false
-- (bells, never a club room), and the DM lane (public._market_dm, discord_dms). A rehearsal sends nothing: pg_net and the
-- discord_dms rows roll back.
--
-- The late sign-up door needed no change: Season 2 keeps registration_open until its own movement deadline
-- (flip_season_status), trg_autoassign_new_reg places nobody in a market season (v4.58), and market_pool lists the
-- sign-up ('late' once the draft has begun). The rehearsal proves a sign-up made after the draft completes is in the pool.
--
-- Not here: market_pool.available_next stays null (the per-game answer replaced the availability gate for requests);
-- rule numbers (rule-numbers.md was not written when this record was); the rulebook text (Season 2 rules go to the
-- concept's rulebook only); the pages, and the classic site's "dressed when they approve" toast (whether the classic
-- site shows Season 2 rules in the gap is the commissioner's call).
--
-- Requires: the v4.58 records live (market_on, _market_ctx, _market_dm, _market_waiver_void_why, market_pool, market_tick
-- with its "steps end" line).
-- Rehearsal: sql/2026-11-24-s2-pool-requests-v459.rehearsal.sql (main session). Results are recorded at the end of this
-- file.

-- 0. preconditions
do $pre$
begin
  if to_regprocedure('public._market_ctx(uuid,text)') is null or to_regprocedure('public._market_dm(uuid,text)') is null
     or to_regprocedure('public._market_waiver_void_why(uuid,uuid)') is null or to_regprocedure('public.market_pool(uuid)') is null then
    raise exception 'v4.59 pool requests: the v4.58 market records must be applied first';
  end if;
  if position('    -- market-tick steps end' in pg_get_functiondef('public.market_tick()'::regprocedure)) = 0 then
    raise exception 'v4.59 pool requests: market_tick has no steps end line';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'lineup_slot_ok') <> 1
     or to_regprocedure('public.lineup_slot_ok(uuid,text,uuid,uuid,text)') is null then
    raise exception 'v4.59 pool requests: expected exactly one public.lineup_slot_ok(uuid, text, uuid, uuid, text)';
  end if;
  if to_regclass('public.market_pool_requests') is not null or to_regclass('public.market_lineup_deadlines') is not null then
    raise exception 'v4.59 pool requests: public.market_pool_requests or public.market_lineup_deadlines already exists';
  end if;
  /* night_lock_at now reads the office-only rulings: it must run as its owner, since anon reaches it through RLS */
  if not coalesce((select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.night_lock_at(uuid,date)')), false) then
    raise exception 'v4.59 pool requests: public.night_lock_at(uuid, date) must exist and be SECURITY DEFINER';
  end if;
end $pre$;

-- 1. the request table
create table public.market_pool_requests (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game_at timestamptz not null,   -- the game's puck drop when it was requested: a game moved since closes the request
  requested_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'closed', 'lapsed')),
  answered_at timestamptz,        -- when the player accepted or declined (or withdrew an acceptance)
  ended_at timestamptz,           -- when it was withdrawn, closed or lapsed
  ended_by uuid,                  -- who withdrew it or released the guest (null when the league closed it)
  note text,                      -- why it closed or lapsed, in words any member may read once the night locks
  code_dm_at timestamptz,         -- when the player was sent the game's lobby code
  constraint market_pool_requests_answered check (status not in ('accepted', 'declined') or answered_at is not null),
  constraint market_pool_requests_ended check ((status in ('withdrawn', 'closed', 'lapsed')) = (ended_at is not null)),
  constraint market_pool_requests_closed_note check (status <> 'closed' or note is not null)
);
comment on table public.market_pool_requests is 'v4.59: Season 2 training camp requests, one per club, player and game. pending until the player accepts or declines; declined also when the player withdraws an acceptance before the night''s lineup lock; withdrawn by the club before that lock (a pending request, or the release of an accepted guest); closed by the league (another club''s acceptance that night, the club''s three, the game moved or closed, the player left the pool or was suspended); lapsed when unanswered at the night''s lineup lock. An accepted request is the player''s permission to be dressed for that club in that game only (public._market_guest).';
/* the first acceptance wins, and a club asks a player once per game */
create unique index market_pool_requests_one_live on public.market_pool_requests (game_id, team_id, profile_id)
  where status in ('pending', 'accepted');
create unique index market_pool_requests_one_club on public.market_pool_requests (game_id, profile_id) where status = 'accepted';
create index market_pool_requests_season on public.market_pool_requests (season_id, status);
create index market_pool_requests_player on public.market_pool_requests (profile_id, status);

alter table public.market_pool_requests enable row level security;
revoke all on public.market_pool_requests from public, anon, authenticated;
/* who in the front office asked or withdrew, and the lobby DM stamp, stay with the office */
grant select (id, season_id, game_id, team_id, profile_id, game_at, created_at, status, answered_at, ended_at, note)
  on public.market_pool_requests to anon, authenticated;
/* commissioner, 2026-11-23: pool requests are visible to the club and staff until the lock, public after. The player
   asked sees their own. The lock is the night's (night_lock_at, the one definition, Rule 4.2). */
create policy "pool requests: club, player and office, everyone after the lock" on public.market_pool_requests
  for select to anon, authenticated
  using (public.is_commissioner() or public.is_staff() or public.is_gm_of(team_id) or profile_id = (select auth.uid())
         or now() >= public.night_lock_at(game_id));

create trigger live_mark_market_pool_requests_ins after insert on public.market_pool_requests
  referencing new table as new_rows for each statement execute function public._live_mark('market', '', '');
create trigger live_mark_market_pool_requests_upd after update on public.market_pool_requests
  referencing old table as old_rows new table as new_rows for each statement execute function public._live_mark('market', '', '');
create trigger live_mark_market_pool_requests_del after delete on public.market_pool_requests
  referencing old table as old_rows for each statement execute function public._live_mark('market', '', '');
/* the camp page and Team HQ follow a request's answer live; RLS and the column grants above filter what each viewer gets */
alter publication supabase_realtime add table public.market_pool_requests;

-- 1b. the lineup deadline rulings (office only: born writable by the API roles, so RLS on and every grant revoked first)
create table public.market_lineup_deadlines (
  game_id uuid not null references public.games(id) on delete cascade,
  night date not null,              -- the game's ET night when it was ruled; a game postponed to another night is ruled there
  season_id uuid not null references public.seasons(id) on delete cascade,
  lock_at timestamptz not null,     -- the lineup lock it was ruled at (puck drop minus 30 minutes); night_lock_at keeps it
  home_set boolean not null,        -- the home club had a full six at the lock
  away_set boolean not null,
  outcome text not null check (outcome in ('set', 'forfeit', 'void', 'officials')),
  ruled_at timestamptz not null default clock_timestamp(),
  primary key (game_id, night)
);
alter table public.market_lineup_deadlines enable row level security;
revoke all on public.market_lineup_deadlines from public, anon, authenticated;
comment on table public.market_lineup_deadlines is 'v4.59: the lineup deadline, ruled ONCE per game and night by market_tick at the game''s lineup lock (public._market_lineup_forfeits): whether each club had a full six, and what followed (set: both had one; forfeit; void: neither; officials: a box score was already in, so no result). The tick never rules a game again on that night, so a reversal or a reopen by the office stands and a sheet the league changes after the lock never forfeits a club. night_lock_at keeps each ruled lock, so voiding or moving a game after its lock never moves the night''s lock. Office only: RLS on, no policy, no API grant.';
create index market_lineup_deadlines_night on public.market_lineup_deadlines (season_id, night);

-- 2. helpers (definers, search_path '', no client grant)
create or replace function public._market_guest(p_game uuid, p_team uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path to '' as $f$
  /* v4.59 (commissioner, 2026-11-24): THE one-night guest test. A training camp player may be dressed for a club in ONE
     game when they accepted the club's request for that game and hold no roster spot this season. The accepted request
     is the permission slip: no roster spot, no contract, no cap or roster count, and it covers that game only.
     lineup_slot_ok and set_game_lineup both ask this. */
  select exists (select 1 from public.market_pool_requests q join public.games g on g.id = q.game_id
                  where q.game_id = p_game and q.team_id = p_team and q.profile_id = p_profile and q.status = 'accepted'
                    and not exists (select 1 from public.roster_spots rs
                                     where rs.season_id = g.season_id and rs.profile_id = p_profile))
$f$;

create or replace function public._market_guest_off_sheet(p_game uuid, p_team uuid, p_profile uuid)
returns int language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59 (decision, 2026-11-24): when a guest's accepted request ends (the club released them, the player withdrew, or the
   league closed it), the guest comes off that club's filed sheet for that game, the way clear_lineups_on_roster_remove
   takes a departed player off (the slot nulled, updated_at stamped). A player who now holds a roster spot on that same
   club this season is the club's own and stays. Returns the number of sheets changed (0 or 1); the caller tells the club
   to refile (a sheet short of six at the game's lineup lock forfeits the game). The one place this is written: the
   answer door, the withdraw door and the tick's sweep all call it. */
declare v_n int;
begin
  update public.game_lineups gl
     set center = nullif(gl.center, p_profile), lw = nullif(gl.lw, p_profile), rw = nullif(gl.rw, p_profile),
         ld = nullif(gl.ld, p_profile), rd = nullif(gl.rd, p_profile), goalie = nullif(gl.goalie, p_profile),
         updated_at = now()
   where gl.game_id = p_game and gl.team_id = p_team
     and p_profile in (gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie)
     and not exists (select 1 from public.roster_spots rs join public.games g on g.id = gl.game_id
                      where rs.season_id = g.season_id and rs.team_id = p_team and rs.profile_id = p_profile);
  get diagnostics v_n = row_count;
  return v_n;
end $f$;

create or replace function public._market_pool_game_words(p_game uuid, p_team uuid)
returns text language sql stable security definer set search_path to '' as $f$
  /* v4.59: "vs DAL on Wed, Dec 16, 9:00 PM ET" ("at DAL" away), the way set_game_lineup names a game to a player */
  select case when g.home_team_id = p_team then 'vs ' else 'at ' end
         || coalesce((select t.code from public.teams t
                       where t.id = case when g.home_team_id = p_team then g.away_team_id else g.home_team_id end), 'the opponent')
         || ' on ' || to_char(g.scheduled_at at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET'
    from public.games g where g.id = p_game
$f$;

create or replace function public._market_pool_night_check(p_team uuid, p_profile uuid, p_night date)
returns void language plpgsql stable security definer set search_path to '' as $f$
/* v4.59: the two night rules, counted over ACCEPTED requests on games of that ET date. A training camp player plays for one
   club a night (the reading stated to the commissioner, 2026-11-24: it keeps a player from facing a club they just
   played for), and a club uses at most three different camp players a night ("A team is allowed to play with up to 3
   training camp players per night", 2026-11-23). The request door and the answer door both ask it.
   shortcut: the three is written here and not in season_rules (the Season 2 contract is frozen), revisit when the
   contract next opens */
declare v_name text; v_club text; v_n int;
begin
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'That player') into v_name from public.profiles p where p.id = p_profile;
  if exists (select 1 from public.market_pool_requests q join public.games g on g.id = q.game_id
              where q.profile_id = p_profile and q.status = 'accepted' and q.team_id <> p_team
                and (g.scheduled_at at time zone 'America/New_York')::date = p_night) then
    raise exception '% is already playing for another club that night. A training camp player plays for one club a night.',
      coalesce(v_name, 'That player') using errcode = 'check_violation', hint = 'other_club';
  end if;
  select count(distinct q.profile_id) into v_n from public.market_pool_requests q join public.games g on g.id = q.game_id
   where q.team_id = p_team and q.status = 'accepted' and q.profile_id <> p_profile
     and (g.scheduled_at at time zone 'America/New_York')::date = p_night;
  if v_n >= 3 then
    select t.name into v_club from public.teams t where t.id = p_team;
    raise exception 'Three training camp players already play for the % that night, the most a club may use.', coalesce(v_club, 'club')
      using errcode = 'check_violation', hint = 'night_full';
  end if;
end $f$;

-- 3. the doors
create or replace function public.market_pool_request(p_game uuid, p_team uuid, p_profile uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59 (commissioner, 2026-11-24: "Can you do the requests per game instead of per night?"): a club's Owner, GM or AGM asks
   a training camp player to play ONE game for the club; the player accepts or declines (market_pool_answer). Several
   clubs may ask the same player; the first acceptance wins. Requests close at the night's lineup lock (night_lock_at,
   judged on clock_timestamp()). No camp players in the playoffs. */
declare v_office boolean := public.is_commissioner(); v_season uuid; v_g public.games; v_night date; v_lock timestamptz;
        v_name text; v_club text; v_id uuid; v_words text; v_text text;
begin
  if p_game is null or p_team is null or p_profile is null then
    raise exception 'Choose the game, the club and the player.' using errcode = '22023';
  end if;
  if not (v_office or public.is_gm_of(p_team)) then
    raise exception 'Only that club''s Owner, GM or AGM can request a training camp player for it.' using errcode = '42501';
  end if;
  /* the approval queue has no request move, and a request waits on the player anyway: the Owner asks */
  if not v_office and public.mgmt_access(p_team, 'lines') = 'approve' then
    raise exception 'Your Owner approves this seat''s lineup moves, so ask your Owner to make the request.'
      using errcode = '42501', hint = 'owner_requests';
  end if;
  v_season := public._market_ctx(p_team, 'lines');
  select g.* into v_g from public.games g where g.id = p_game;
  if not found or v_g.season_id <> v_season then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;
  if p_team not in (v_g.home_team_id, v_g.away_team_id) then
    raise exception 'That club is not playing in this game.' using errcode = '22023';
  end if;
  if coalesce(v_g.stage, 'regular') <> 'regular' then
    raise exception 'Training camp players do not play in the playoffs.' using errcode = 'check_violation', hint = 'playoffs';
  end if;
  if v_g.status <> 'scheduled' or coalesce(v_g.voided, false) or v_g.scheduled_at is null then
    raise exception 'That game is not open for lineups.' using errcode = 'check_violation', hint = 'game_closed';
  end if;
  v_lock := public.night_lock_at(p_game);
  if clock_timestamp() >= v_lock then
    raise exception 'Requests for that night closed at % ET, when the night''s lineups locked.',
      to_char(v_lock at time zone 'America/New_York', 'FMHH12:MI AM') using errcode = 'check_violation', hint = 'locked';
  end if;
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'That player') into v_name from public.profiles p where p.id = p_profile;
  v_name := coalesce(v_name, 'That player');
  if not exists (select 1 from public.market_pool(v_season) mp where mp.profile_id = p_profile) then
    raise exception '% is not in the training camp pool.', v_name using errcode = 'check_violation', hint = 'not_in_pool';
  end if;
  if public.is_suspended(p_profile) then
    raise exception '% is suspended and cannot play until the suspension is served.', v_name
      using errcode = 'check_violation', hint = 'suspended';
  end if;
  if exists (select 1 from public.market_pool_requests q where q.game_id = p_game and q.team_id = p_team
               and q.profile_id = p_profile and q.status = 'declined') then
    raise exception '% already declined this game.', v_name using errcode = 'check_violation', hint = 'declined';
  end if;
  v_night := (v_g.scheduled_at at time zone 'America/New_York')::date;
  /* the player's night, serialized with their answers (market_pool_answer takes the same lock first) */
  perform pg_advisory_xact_lock(hashtext('market:pool:' || p_profile::text || ':' || v_night::text));
  perform public._market_pool_night_check(p_team, p_profile, v_night);
  insert into public.market_pool_requests (season_id, game_id, team_id, profile_id, game_at, requested_by)
    values (v_season, p_game, p_team, p_profile, v_g.scheduled_at, auth.uid())
    on conflict (game_id, team_id, profile_id) where status in ('pending', 'accepted') do nothing
    returning id into v_id;
  if v_id is null then
    raise exception 'Your club already asked % to play this game.', v_name using errcode = 'check_violation', hint = 'duplicate';
  end if;

  select t.name into v_club from public.teams t where t.id = p_team;
  v_words := public._market_pool_game_words(p_game, p_team);
  v_text := 'The ' || coalesce(v_club, 'club') || ' asked you to play ' || v_words || '. Accept or decline on the CGHL site before '
    || to_char(v_lock at time zone 'America/New_York', 'FMHH12:MI AM') || ' ET, when that night''s lineups lock.';
  perform public.create_notification(p_profile, 'lineups', 'The ' || coalesce(v_club, 'club') || ' asked you to play', v_text, 'game', p_game::text);
  perform public._market_dm(p_profile, v_text);
  return jsonb_build_object('ok', true, 'request_id', v_id, 'status', 'pending', 'closes_at', v_lock);
end $f$;

create or replace function public.market_pool_answer(p_request uuid, p_accept boolean)
returns jsonb language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59 (commissioner, 2026-11-24): the training camp player accepts or declines a club's request for one game, until the
   night's lineup lock. The first acceptance wins: once a player accepts a club's game, every other club's open request for
   them that night closes with a note, and once a club has three different camp players for a night its other open
   requests for that night close.
   Decision (2026-11-24): a player who accepted may withdraw the acceptance until the same lock (p_accept false on an
   accepted request). The request becomes declined (so the club cannot ask them for that game again), the player comes off
   the club's filed sheet for that game (public._market_guest_off_sheet), the club's seats are told, and the slot frees.
   Review (2026-11-24): the player's night lock, then the club's night lock, are taken BEFORE the request row is locked,
   the order market_pool_withdraw takes them too, so two answers, or an answer and a release, wait on each other instead of
   deadlocking. */
declare v_q public.market_pool_requests; v_g public.games; v_night date; v_lock timestamptz; v_name text; v_club text;
        v_words text; v_n int; v_off int; r record;
begin
  if p_request is null or p_accept is null then raise exception 'Choose the request and your answer.' using errcode = '22023'; end if;
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select q.* into v_q from public.market_pool_requests q where q.id = p_request;
  if not found then raise exception 'That request does not exist.' using errcode = 'P0002'; end if;
  if v_q.profile_id <> auth.uid() then
    raise exception 'Only the player asked can answer this request.' using errcode = '42501';
  end if;
  if not public.market_on(v_q.season_id) then
    raise exception 'The Season 2 player market is not open this season.' using errcode = 'check_violation', hint = 'market_closed';
  end if;
  select g.* into v_g from public.games g where g.id = v_q.game_id;
  v_night := (v_g.scheduled_at at time zone 'America/New_York')::date;
  perform pg_advisory_xact_lock(hashtext('market:pool:' || v_q.profile_id::text || ':' || v_night::text));
  perform pg_advisory_xact_lock(hashtext('market:poolclub:' || v_q.team_id::text || ':' || v_night::text));
  select q.* into v_q from public.market_pool_requests q where q.id = p_request for update;   -- read again under the locks
  if v_q.status <> 'pending' and not (v_q.status = 'accepted' and not p_accept) then
    raise exception '%', (case v_q.status
        when 'accepted' then 'You already accepted this request.'
        when 'declined' then 'You already declined this request.'
        when 'withdrawn' then 'The club withdrew this request.'
        when 'lapsed' then 'This request lapsed when the night''s lineups locked.'
        else coalesce(v_q.note, 'This request is closed.') end)
      using errcode = 'check_violation', hint = 'answered';
  end if;
  v_lock := public.night_lock_at(v_q.game_id);
  if v_g.status <> 'scheduled' or coalesce(v_g.voided, false) or v_lock is null or clock_timestamp() >= v_lock then
    raise exception 'Answers for that night closed at % ET, when the night''s lineups locked.',
      coalesce(to_char(v_lock at time zone 'America/New_York', 'FMHH12:MI AM'), 'the lock') using errcode = 'check_violation', hint = 'locked';
  end if;
  select coalesce(nullif(p.gamertag, ''), p.display_name, 'A player') into v_name from public.profiles p where p.id = v_q.profile_id;
  select t.name into v_club from public.teams t where t.id = v_q.team_id;
  v_words := public._market_pool_game_words(v_q.game_id, v_q.team_id);

  if not p_accept then
    update public.market_pool_requests set status = 'declined', answered_at = clock_timestamp() where id = p_request;
    if v_q.status = 'accepted' then
      v_off := public._market_guest_off_sheet(v_q.game_id, v_q.team_id, v_q.profile_id);
      perform public.club_notify(v_q.team_id, 'lineups', v_name || ' withdrew from a game',
        v_name || ' withdrew from the game ' || v_words || ' after accepting your training camp request.'
        || case when v_off > 0 then ' They came off that game''s lineup: refile it with a full six before its lineup lock, or the club forfeits the game.'
                else '' end, null, 'game', v_q.game_id::text, null, false);
      return jsonb_build_object('ok', true, 'request_id', p_request, 'status', 'declined', 'withdrew', true);
    end if;
    perform public.club_notify(v_q.team_id, 'lineups', v_name || ' declined',
      v_name || ' declined your training camp request for the game ' || v_words || '.', null, 'game', v_q.game_id::text, null, false);
    return jsonb_build_object('ok', true, 'request_id', p_request, 'status', 'declined');
  end if;

  if not exists (select 1 from public.market_pool(v_q.season_id) mp where mp.profile_id = v_q.profile_id) then
    raise exception 'You are no longer in the training camp pool, so you cannot accept.' using errcode = 'check_violation', hint = 'not_in_pool';
  end if;
  if public.is_suspended(v_q.profile_id) then
    raise exception 'You are suspended and cannot play until the suspension is served.' using errcode = 'check_violation', hint = 'suspended';
  end if;
  perform public._market_pool_night_check(v_q.team_id, v_q.profile_id, v_night);
  update public.market_pool_requests set status = 'accepted', answered_at = clock_timestamp() where id = p_request;

  /* the first acceptance wins: other clubs' open requests for this player that night close (the note never names the
     club the player chose; before the lock a request is private to its own club) */
  for r in select q.id, q.team_id, q.game_id from public.market_pool_requests q join public.games g on g.id = q.game_id
            where q.profile_id = v_q.profile_id and q.team_id <> v_q.team_id and q.status = 'pending'
              and (g.scheduled_at at time zone 'America/New_York')::date = v_night
            for update of q
  loop
    update public.market_pool_requests set status = 'closed', ended_at = clock_timestamp(),
           note = 'The player accepted another club''s request for that night. A training camp player plays for one club a night.'
     where id = r.id;
    perform public.club_notify(r.team_id, 'lineups', v_name || ' is playing for another club',
      v_name || ' accepted another club''s request for that night, so your request for the game '
      || public._market_pool_game_words(r.game_id, r.team_id) || ' closed. A training camp player plays for one club a night.',
      null, 'game', r.game_id::text, null, false);
  end loop;

  /* a club's third camp player for the night closes its other open requests for that night, except more games of the
     players it already has */
  select count(distinct q.profile_id) into v_n from public.market_pool_requests q join public.games g on g.id = q.game_id
   where q.team_id = v_q.team_id and q.status = 'accepted' and (g.scheduled_at at time zone 'America/New_York')::date = v_night;
  if v_n >= 3 then
    update public.market_pool_requests q
       set status = 'closed', ended_at = clock_timestamp(),
           note = 'The club has three training camp players for that night, the most a club may use.'
      from public.games g
     where g.id = q.game_id and q.team_id = v_q.team_id and q.status = 'pending'
       and (g.scheduled_at at time zone 'America/New_York')::date = v_night
       and q.profile_id not in (select a.profile_id from public.market_pool_requests a join public.games ga on ga.id = a.game_id
                                 where a.team_id = v_q.team_id and a.status = 'accepted'
                                   and (ga.scheduled_at at time zone 'America/New_York')::date = v_night);
  end if;

  perform public.club_notify(v_q.team_id, 'lineups', v_name || ' accepted',
    v_name || ' accepted your training camp request for the game ' || v_words
    || '. Add them to that game''s lineup; the request covers that game only.', null, 'game', v_q.game_id::text, null, false);
  return jsonb_build_object('ok', true, 'request_id', p_request, 'status', 'accepted');
end $f$;

create or replace function public.market_pool_withdraw(p_request uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59 (commissioner, 2026-11-24): the club's front office may withdraw a request until the night's lineup lock.
   Decision (2026-11-24): until that same lock the club may also release the guest of an ACCEPTED request. The request
   becomes withdrawn (ended_by names who released), the player comes off the club's filed sheet for that game
   (public._market_guest_off_sheet; the club refiles, since a sheet short of six at the game's lock forfeits it), the
   player is told, and the slot frees for the club's night count and for the player. After the lock, neither.
   Review (2026-11-24): the player's night lock, then the club's, are taken before the row is locked (market_pool_answer's
   order), so a release and an answer never deadlock. */
declare v_office boolean := public.is_commissioner(); v_q public.market_pool_requests; v_lock timestamptz; v_night date;
        v_club text; v_words text; v_text text; v_n int; v_off int := 0;
begin
  if p_request is null then raise exception 'Choose the request.' using errcode = '22023'; end if;
  select q.* into v_q from public.market_pool_requests q where q.id = p_request;
  if not found then raise exception 'That request does not exist.' using errcode = 'P0002'; end if;
  if not (v_office or public.is_gm_of(v_q.team_id)) then
    raise exception 'Only that club''s Owner, GM or AGM can withdraw its request.' using errcode = '42501';
  end if;
  if not v_office and public.mgmt_access(v_q.team_id, 'lines') = 'approve' then
    raise exception 'Your Owner approves this seat''s lineup moves, so ask your Owner to withdraw the request.'
      using errcode = '42501', hint = 'owner_requests';
  end if;
  perform public._market_ctx(v_q.team_id, 'lines');
  select (g.scheduled_at at time zone 'America/New_York')::date into v_night from public.games g where g.id = v_q.game_id;
  perform pg_advisory_xact_lock(hashtext('market:pool:' || v_q.profile_id::text || ':' || v_night::text));
  perform pg_advisory_xact_lock(hashtext('market:poolclub:' || v_q.team_id::text || ':' || v_night::text));
  select q.* into v_q from public.market_pool_requests q where q.id = p_request for update;   -- read again under the locks
  if v_q.status not in ('pending', 'accepted') then
    raise exception 'That request is already closed.' using errcode = 'check_violation', hint = 'closed';
  end if;
  v_lock := public.night_lock_at(v_q.game_id);
  if v_lock is not null and clock_timestamp() >= v_lock then
    raise exception 'Requests can be withdrawn and guests released until % ET, when the night''s lineups lock.',
      to_char(v_lock at time zone 'America/New_York', 'FMHH12:MI AM') using errcode = 'check_violation', hint = 'locked';
  end if;
  update public.market_pool_requests set status = 'withdrawn', ended_at = clock_timestamp(), ended_by = auth.uid()
   where id = p_request and status = v_q.status;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'That request is already closed.' using errcode = 'check_violation', hint = 'closed'; end if;
  select t.name into v_club from public.teams t where t.id = v_q.team_id;
  v_words := public._market_pool_game_words(v_q.game_id, v_q.team_id);
  if v_q.status = 'accepted' then
    v_off := public._market_guest_off_sheet(v_q.game_id, v_q.team_id, v_q.profile_id);
    v_text := 'The ' || coalesce(v_club, 'club') || ' released you from the game ' || v_words || '. You are no longer set to play it'
      || case when v_off > 0 then ' and are off its lineup.' else '.' end;
    perform public.create_notification(v_q.profile_id, 'lineups', 'The ' || coalesce(v_club, 'club') || ' released you from a game',
      v_text, 'game', v_q.game_id::text);
  else
    v_text := 'The ' || coalesce(v_club, 'club') || ' withdrew the request for you to play ' || v_words || '.';
    perform public.create_notification(v_q.profile_id, 'lineups', 'A training camp request was withdrawn', v_text, 'game', v_q.game_id::text);
  end if;
  perform public._market_dm(v_q.profile_id, v_text);
  return jsonb_build_object('ok', true, 'request_id', p_request, 'status', 'withdrawn', 'released', v_q.status = 'accepted',
                            'off_sheet', v_off > 0);
end $f$;

-- 4. lineup_slot_ok: DROP plus CREATE with p_game (a new defaulted argument makes an overload otherwise, the club_notify
--    v3.11 trap); the Season 1 body is proved byte-identical by the helper below
create or replace function pg_temp.vnnn_patch(p_fn text, p_old text[], p_new text[], p_new_fn text default null) returns void
language plpgsql as $f$
-- v4.59: every anchor occurs exactly once; all of a function's replacements land in ONE create; then the patched body,
-- each change put back, must equal the old body byte for byte (the Season 1 path is unchanged). p_new_fn: the
-- signature after a DROP plus CREATE.
declare v_old text := pg_get_functiondef(p_fn::regprocedure); v_new text; v_back text; n int; i int;
begin
  v_new := v_old;
  for i in 1 .. array_length(p_old, 1) loop
    n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    if n <> 1 then raise exception 'v4.59 pool requests: a % anchor matched % times, expected exactly 1: %', p_fn, n, left(p_old[i], 80); end if;
    v_new := replace(v_new, p_old[i], p_new[i]);
  end loop;
  if p_new_fn is not null then execute 'drop function ' || p_fn; end if;
  execute v_new;
  v_back := pg_get_functiondef(coalesce(p_new_fn, p_fn)::regprocedure);
  for i in reverse array_length(p_old, 1) .. 1 loop
    n := (length(v_back) - length(replace(v_back, p_new[i], ''))) / length(p_new[i]);
    if n <> 1 then raise exception 'v4.59 pool requests: a % change is not in the new body exactly once: %', p_fn, left(p_new[i], 80); end if;
    v_back := replace(v_back, p_new[i], p_old[i]);
  end loop;
  if v_back <> v_old then
    raise exception 'v4.59 pool requests: % differs from its old body by more than this record''s changes', p_fn;
  end if;
end $f$;

select pg_temp.vnnn_patch('public.lineup_slot_ok(uuid,text,uuid,uuid,text)',
  array[$a$CREATE OR REPLACE FUNCTION public.lineup_slot_ok(p_pid uuid, p_want text, p_season uuid, p_team uuid, p_stage text DEFAULT NULL::text)$a$,
        $a$  if grp is null then
    select coalesce(gamertag, display_name, 'That player') into nm from profiles where id=p_pid;
$a$],
  array[$b$CREATE OR REPLACE FUNCTION public.lineup_slot_ok(p_pid uuid, p_want text, p_season uuid, p_team uuid, p_stage text DEFAULT NULL::text, p_game uuid DEFAULT NULL::uuid)$b$,
        $b$  if grp is null then
    /* v4.59 (commissioner, 2026-11-24): a training camp player who accepted the club's request for THIS game is its guest
       (public._market_guest) and fills any slot, for that game only. set_team_line passes no game, so a guest never
       enters a season line. */
    if p_game is not null and public._market_guest(p_game, p_team, p_pid) then return; end if;
    select coalesce(gamertag, display_name, 'That player') into nm from profiles where id=p_pid;
$b$],
  'public.lineup_slot_ok(uuid,text,uuid,uuid,text,uuid)');
/* no client calls it (set_game_lineup, set_team_line and guard_lineup_positions are definers); it now reads whether a
   player accepted a request, which stays private until the night's lock */
revoke all on function public.lineup_slot_ok(uuid, text, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.lineup_slot_ok(uuid, text, uuid, uuid, text, uuid) to service_role;

-- 5. set_game_lineup: the guest, the half-lineup rule, the game passed to lineup_slot_ok, the refusal that names a missing
--    request, and the deadline
select pg_temp.vnnn_patch('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)',
  array[$a$  foreach v_p in array v_players loop
    if not exists (select 1 from public.contracts c
$a$,
        $a$      raise exception 'A dressed player is not on this club''s active roster.' using errcode = '22023';
$a$,
        $a$  perform public.lineup_slot_ok(p_center, 'F', v_game.season_id, p_team, v_game.stage);
  perform public.lineup_slot_ok(p_lw,     'F', v_game.season_id, p_team, v_game.stage);
  perform public.lineup_slot_ok(p_rw,     'F', v_game.season_id, p_team, v_game.stage);
  perform public.lineup_slot_ok(p_ld,     'D', v_game.season_id, p_team, v_game.stage);
  perform public.lineup_slot_ok(p_rd,     'D', v_game.season_id, p_team, v_game.stage);
  perform public.lineup_slot_ok(p_goalie, 'G', v_game.season_id, p_team, v_game.stage);
$a$,
        $a$  select * into v_old from public.game_lineups where game_id = p_game and team_id = p_team;
$a$],
  array[$b$  /* v4.59 (commissioner, 2026-11-23: "A team is allowed to play with up to 3 training camp players per night. The
     requirement is that at least half the game lineup should consist of players on the club."; 2026-11-24: requests per
     game): in a market season a training camp player who accepted the club's request for THIS game is the game's guest
     (public._market_guest): no roster spot, no contract, no cap or roster count. At least half of the sheet is the
     club's own players, so a full six carries three guests at most. */
  if public.market_on(v_game.season_id) then
    declare v_guests int := (select count(*) from unnest(v_players) x where public._market_guest(p_game, p_team, x));
    begin
      if 2 * v_guests > cardinality(v_players) then
        raise exception 'At least half of a game lineup must be the club''s own players: % training camp players in a lineup of % is too many (three at most in a full six).',
          v_guests, cardinality(v_players) using errcode = '22023', hint = 'camp_half';
      end if;
    end;
  end if;
  foreach v_p in array v_players loop
    continue when public._market_guest(p_game, p_team, v_p);   -- v4.59: a training camp guest holds no contract
    if not exists (select 1 from public.contracts c
$b$,
        $b$      /* v4.59 (review, 2026-11-24): in a market season a dressed player on no roster can only be a guest, so the refusal
         names the player and the missing request; the Season 1 sentence below is unchanged */
      if public.market_on(v_game.season_id)
         and not exists (select 1 from public.roster_spots rs where rs.season_id = v_game.season_id and rs.profile_id = v_p) then
        select coalesce(nullif(gamertag, ''), 'That player') into v_name from public.profiles where id = v_p;
        raise exception '% is on no roster and has not accepted a training camp request to play this game for this club.', v_name
          using errcode = '22023', hint = 'not_a_guest';
      end if;
      raise exception 'A dressed player is not on this club''s active roster.' using errcode = '22023';
$b$,
        $b$  perform public.lineup_slot_ok(p_center, 'F', v_game.season_id, p_team, v_game.stage, p_game);   -- v4.59: the game, for a guest
  perform public.lineup_slot_ok(p_lw,     'F', v_game.season_id, p_team, v_game.stage, p_game);
  perform public.lineup_slot_ok(p_rw,     'F', v_game.season_id, p_team, v_game.stage, p_game);
  perform public.lineup_slot_ok(p_ld,     'D', v_game.season_id, p_team, v_game.stage, p_game);
  perform public.lineup_slot_ok(p_rd,     'D', v_game.season_id, p_team, v_game.stage, p_game);
  perform public.lineup_slot_ok(p_goalie, 'G', v_game.season_id, p_team, v_game.stage, p_game);
$b$,
        $b$  select * into v_old from public.game_lineups where game_id = p_game and team_id = p_team;
  /* v4.59 (commissioner, 2026-11-24: "If a team does not set their initial lineup for that game before the deadline to set
     the lineups, that team forfeits the game."; decisions, 2026-11-24: a lineup is set only when it names a full six, and
     the forfeit is ruled once, at the game's own lock): in a market season, from the game's lineup lock (v_lock, Rule
     5.3) until market_tick rules it (public._market_lineup_forfeits, seconds later), a club whose sheet does not name six
     cannot complete it, so the ruling reads the sheet that was on file at the lock. A club with six may still change
     players (Rule 5.3). Once the game is ruled this refuses nothing: a club ruled set may refill a spot the league pulled
     (a series limit, a roster move, a closed guest request) until puck drop, and a game the office returns to the
     schedule after a deadline forfeit is filed again as usual. The league office may always file (v3.79). */
  if v_locked and public.market_on(v_game.season_id) and not public.is_commissioner()
     and num_nonnulls(v_old.center, v_old.lw, v_old.rw, v_old.ld, v_old.rd, v_old.goalie) < 6
     and not exists (select 1 from public.market_lineup_deadlines d where d.game_id = p_game
                       and d.night = (v_game.scheduled_at at time zone 'America/New_York')::date) then
    raise exception 'The lineup deadline for this game passed at % ET. A club without a full lineup of six by then forfeits the game.',
      to_char(v_lock at time zone 'America/New_York', 'FMHH12:MI AM') using errcode = '42501', hint = 'lineup_deadline';
  end if;
$b$]);

-- 6. can_see_match and review_game_records: the guest is legitimate for that game
select pg_temp.vnnn_patch('public.can_see_match(uuid)',
  array[$a$                        where rs.profile_id = auth.uid()) ) ) )$a$],
  array[$b$                        where rs.profile_id = auth.uid())
            /* v4.59 (commissioner, 2026-11-24): a training camp player who accepted a club's request for THIS game gets
               its code and server at the night's lock too, and only for that game */
            or exists (select 1 from public.market_pool_requests q where q.game_id = p_game and q.profile_id = auth.uid()
                        and q.status = 'accepted') ) ) )$b$]);

select pg_temp.vnnn_patch('public.review_game_records(uuid)',
  array[$a$    v_rostered := found;
$a$],
  array[$b$    v_rostered := found;
    /* v4.59 (commissioner, 2026-11-24): a training camp player who accepted the club's request for this game was its guest:
       legitimate for that game, never "on no squad". A guest has no squad and no roster position, so v_squad stays null
       and the cap read below is the skater or goaltender cap, the one set_game_lineup and _limit_forfeit_check apply to
       them (review, 2026-11-24: one reading of a guest everywhere), and the position check below never reads them. */
    if not v_rostered and exists (select 1 from public.market_pool_requests q where q.game_id = p_game
                                    and q.team_id = r.team_id and q.profile_id = r.profile_id and q.status = 'accepted') then
      v_rostered := true;
    end if;
$b$]);

-- 7. suspensions: a pool player serves a games suspension one league game night at a time
create or replace function public._market_pool_suspension_night(p_season uuid, p_night date)
returns void language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59: a games suspension of a training camp pool player (signed up and not declined, on no roster this season) is served
   one LEAGUE GAME NIGHT at a time (the Season 2 default stated to the commissioner, 2026-10-13: "Pool-player suspensions
   are served per league game night"). count_suspension_games counts a club's games, and a pool player has none. A night
   counts once, on the first of its final, unvoided games that the suspension predates; suspension_running_at then keeps
   it running to the end of that night, as it does after a club game. Called when a game goes final, and again when one
   is reopened or voided, so the night moves to another final game of that night. */
declare r record;
begin
  if p_season is null or p_night is null then return; end if;
  for r in select g.id, g.scheduled_at from public.games g
            where g.season_id = p_season and g.status = 'final' and not coalesce(g.voided, false)
              and (g.scheduled_at at time zone 'America/New_York')::date = p_night
            order by g.scheduled_at, g.id
  loop
    insert into public.suspension_games (suspension_id, game_id, team_id, game_at)
    select s.id, r.id, null, r.scheduled_at
      from public.suspensions s
     where s.status = 'active' and s.mode = 'games' and s.created_at <= r.scheduled_at
       and exists (select 1 from public.season_registrations x where x.season_id = p_season and x.profile_id = s.profile_id
                     and x.status <> 'declined')
       and not exists (select 1 from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = s.profile_id)
       and not exists (select 1 from public.suspension_games sg where sg.suspension_id = s.id
                         and (sg.game_at at time zone 'America/New_York')::date = p_night)
       and (select count(*) from public.suspension_games sg where sg.suspension_id = s.id) < coalesce(s.games_total, 0)
    on conflict do nothing;
  end loop;
end $f$;

select pg_temp.vnnn_patch('public.count_suspension_games()',
  array[$a$    delete from public.suspension_games where game_id = new.id;
$a$,
        $a$    on conflict do nothing;
$a$],
  array[$b$    delete from public.suspension_games where game_id = new.id;
    /* v4.59: a pool player's night rode on this game; another final game of that night carries it now */
    if public.market_on(new.season_id) then
      perform public._market_pool_suspension_night(new.season_id, (new.scheduled_at at time zone 'America/New_York')::date);
    end if;
$b$,
        $b$    on conflict do nothing;
    /* v4.59: a training camp pool player serves per league game night (public._market_pool_suspension_night) */
    if public.market_on(new.season_id) then
      perform public._market_pool_suspension_night(new.season_id, (new.scheduled_at at time zone 'America/New_York')::date);
    end if;
$b$]);

-- 8. the tick: the lineup deadline, then the requests
create or replace function public._market_lineup_forfeits(p_season uuid)
returns text[] language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59 (commissioner, 2026-11-24: "If a team does not set their initial lineup for that game before the deadline to set the
   lineups, that team forfeits the game."): a market_tick step. Decisions (2026-11-24): the deadline is each game's own
   lineup lock, 30 minutes before its puck drop (the lock set_game_lineup applies, Rule 5.3); a lineup is set only when it
   names a full six; the forfeit applies in every stage, playoffs included; and each game is ruled ONCE, at that lock.
   The ruling is a row in public.market_lineup_deadlines (game and night), written in the same block as its result, and a
   game with a row for its night is never ruled again: a reversal or a reopen by the office stands (review, 2026-11-24:
   without the row the next tick forfeited a reversed game again), and a sheet the league changes after the ruling (a series limit pull,
   a roster removal, a suspension, a closed guest request) never forfeits a club that was set at the lock. A game
   postponed to another night is ruled again at its new lock; one moved within its night keeps its ruling.
   A club without a full six forfeits 1-0, the result declare_forfeit writes (Rule 3.2); where neither club had one, the
   game is voided (Rule 3.2: "The league does not record double forfeits."). The games row is the machinery: its
   triggers post the one #game-scores line ("Final (forfeit)" or "Voided", notify_discord_game_final), count suspensions,
   flag club forfeits and settle the standings. A game with a box score already in gets its row and no result: the
   officials rule it. Each game runs in its own block, and a failure is returned to the tick, which records it for the
   watchdog (the game is retried on the next tick: its row rolled back with it).
   A side is set when its sheet names six, or when the sheet changed after the lock (updated_at): from the lock until the
   ruling set_game_lineup lets a club change its sheet only if it named six, so a change after the lock is a club that had
   six at the lock, the league office filing (v3.79), or a league pull (every puller stamps updated_at), and none of those
   may cost the club a forfeit.
   The ruling waits 5 seconds past the lock: set_game_lineup judges the lock at its transaction's start, so a sheet saved
   just before the lock has committed before the ruling reads it.
   shortcut: a sheet short of six at the lock that a league pull touches in the seconds before the ruling counts as set
   (updated_at cannot tell the two apart), revisit if a lineup history is ever kept
   shortcut: a game is ruled only between its lock and its puck drop, so a tick down for that whole stretch rules nothing
   (no forfeit), revisit if the watchdog ever reports a market-tick outage on a game night
   shortcut: a game the office moves to start within 30 minutes is ruled at once, so the office files its sheets first
   (v3.79) or moves it at least 30 minutes out, revisit if same-night reschedules become routine */
declare r record; v_lock timestamptz; v_night date; v_home boolean; v_away boolean; v_box boolean; v_win uuid; v_lose uuid;
        v_hn text; v_an text; v_desc text; v_when text; v_err text[] := '{}';
begin
  for r in
    select g.id, g.home_team_id, g.away_team_id, g.scheduled_at, g.week, g.stage, g.ea_match_id from public.games g
     where g.season_id = p_season and g.status = 'scheduled' and not coalesce(g.voided, false) and g.scheduled_at is not null
       and clock_timestamp() >= g.scheduled_at - interval '30 minutes' + interval '5 seconds'
       and clock_timestamp() < g.scheduled_at
       and not exists (select 1 from public.market_lineup_deadlines d
                        where d.game_id = g.id and d.night = (g.scheduled_at at time zone 'America/New_York')::date)
     order by g.scheduled_at, g.id
     for update of g skip locked
  loop
    begin
      v_lock := r.scheduled_at - interval '30 minutes';
      v_night := (r.scheduled_at at time zone 'America/New_York')::date;
      v_home := exists (select 1 from public.game_lineups gl where gl.game_id = r.id and gl.team_id = r.home_team_id
                          and (num_nonnulls(gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie) = 6 or gl.updated_at > v_lock));
      v_away := exists (select 1 from public.game_lineups gl where gl.game_id = r.id and gl.team_id = r.away_team_id
                          and (num_nonnulls(gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie) = 6 or gl.updated_at > v_lock));
      v_box := r.ea_match_id is not null or exists (select 1 from public.game_stats s where s.game_id = r.id);
      insert into public.market_lineup_deadlines (game_id, night, season_id, lock_at, home_set, away_set, outcome)
        values (r.id, v_night, p_season, v_lock, v_home, v_away,
                case when v_box then 'officials' when v_home and v_away then 'set' when v_home or v_away then 'forfeit' else 'void' end);
      continue when v_box or (v_home and v_away);
      select t.name into v_hn from public.teams t where t.id = r.home_team_id;
      select t.name into v_an from public.teams t where t.id = r.away_team_id;
      v_when := to_char(r.scheduled_at at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM') || ' ET';
      if not v_home and not v_away then
        update public.games set home_score = 0, away_score = 0, went_ot = false, forfeit_team_id = null, voided = true,
               ea_match_id = null, status = 'final'
         where id = r.id;
        v_desc := 'Voided: neither the ' || coalesce(v_hn, 'home club') || ' nor the ' || coalesce(v_an, 'away club')
          || ' had a full lineup of six set by the deadline for the ' || v_when
          || ' game, so it has no result (the league does not record double forfeits).'
          /* review, 2026-11-24: nothing reschedules a playoff game, so the staff note says the series needs one */
          || case when r.stage = 'playoff' then ' This is a playoff game, so the series needs the league office to reschedule it.' else '' end;
      else
        v_win := case when v_home then r.home_team_id else r.away_team_id end;
        v_lose := case when v_home then r.away_team_id else r.home_team_id end;
        update public.games set home_score = case when home_team_id = v_win then 1 else 0 end,
               away_score = case when away_team_id = v_win then 1 else 0 end,
               went_ot = false, forfeit_team_id = v_lose, voided = false, ea_match_id = null, status = 'final'
         where id = r.id;
        v_desc := 'Forfeit: the ' || coalesce(case when v_home then v_hn else v_an end, 'club') || ' win 1-0 over the '
          || coalesce(case when v_home then v_an else v_hn end, 'club') || ', who had no full lineup of six set by the deadline for the '
          || v_when || ' game.';
      end if;
      perform public.log_admin_action('lineup_deadline_forfeit', 'game', r.id::text,
        jsonb_build_object('ruling', v_desc, 'voided', not v_home and not v_away, 'week', r.week, 'stage', r.stage,
                           'forfeited_by', case when v_home = v_away then null
                                                else (select t.code from public.teams t where t.id = v_lose) end));
      perform public.notify_staff_ch('casework', '**Lineup deadline** (automatic, at the lineup lock): ' || v_desc, false);
    exception when others then
      v_err := v_err || ('lineup deadline, game ' || r.id::text || ': ' || sqlerrm);
    end;
  end loop;
  return v_err;
end $f$;

create or replace function public._market_pool_sweep(p_season uuid)
returns int language plpgsql volatile security definer set search_path to '' as $f$
/* v4.59: a market_tick step for training camp requests. Every update is guarded by the state it expects, so a step that
   runs twice changes nothing twice.
   1. A pending request for a game no longer open (forfeited, voided, played) closes.
   2. Requests and answers close at the night's lineup lock (night_lock_at, the one definition); an unanswered request
      lapses then (commissioner, 2026-11-24).
   3. Before puck drop, a pending or accepted request closes when the player left the training camp pool (placed on a
      roster, banned, sign-up withdrawn) or was suspended, or when its game was moved (the player said yes to a time).
      Review (2026-11-24): an accepted request whose game moved within its night after the night's lock keeps its guest,
      since no request can be made then; the request follows the game to its new time and the player and the club's
      seats are told. When an accepted request closes, the guest comes off that club's filed sheet for the game
      (public._market_guest_off_sheet), and the club's seats and the player are told.
   4. Once the night has locked, each accepted player gets the game's lobby code by DM, once per game (commissioner,
      2026-11-23: "lobby codes to pool players by bot DM"), and a bell that points to the game page (_market_dm sends
      nothing to a member with no Discord link; the bell is how they hear). A code set later goes when it is set, and
      rotate_game_code never changes a code after the night's lock, so one DM per game is enough. The code is never kept
      on the request row, which any member may read after the lock. */
declare r record; v_n int := 0; v_k int; v_off int; v_name text; v_club text; v_words text;
begin
  update public.market_pool_requests q set status = 'closed', ended_at = clock_timestamp(), note = 'The game is no longer open for lineups.'
    from public.games g
   where g.id = q.game_id and q.season_id = p_season and q.status = 'pending' and (g.status <> 'scheduled' or coalesce(g.voided, false));
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  update public.market_pool_requests q set status = 'lapsed', ended_at = clock_timestamp(),
         note = 'Not answered before the night''s lineups locked.'
   where q.season_id = p_season and q.status = 'pending' and clock_timestamp() >= public.night_lock_at(q.game_id);
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  for r in
    select q.id, q.profile_id, q.team_id, q.game_id, q.status as was, q.game_at as old_at, g.scheduled_at as new_at,
           case when g.scheduled_at is distinct from q.game_at
                     and (q.status = 'pending' or clock_timestamp() < public.night_lock_at(q.game_id)
                          or (g.scheduled_at at time zone 'America/New_York')::date <> (q.game_at at time zone 'America/New_York')::date)
                  then 'The game was moved, so the request closed. The club may ask again until that night''s lineups lock.'
                when public._market_waiver_void_why(p_season, q.profile_id) is not null then 'The player is no longer in the training camp pool.'
                when public.is_suspended(q.profile_id) then 'The player is suspended.' end as why
      from public.market_pool_requests q join public.games g on g.id = q.game_id
     where q.season_id = p_season and q.status in ('pending', 'accepted') and g.status = 'scheduled'
       and not coalesce(g.voided, false) and g.scheduled_at > clock_timestamp()
     for update of q skip locked
  loop
    continue when r.why is null and not (r.was = 'accepted' and r.new_at is distinct from r.old_at);
    select coalesce(nullif(p.gamertag, ''), p.display_name, 'A player') into v_name from public.profiles p where p.id = r.profile_id;
    select t.name into v_club from public.teams t where t.id = r.team_id;
    v_words := public._market_pool_game_words(r.game_id, r.team_id);
    if r.why is null then
      /* an accepted guest's game moved within its night after the lock: the request follows the game */
      update public.market_pool_requests set game_at = r.new_at where id = r.id and status = 'accepted';
      get diagnostics v_k = row_count;
      if v_k = 1 then
        v_n := v_n + 1;
        perform public.create_notification(r.profile_id, 'lineups', 'Your game moved',
          'Your game for the ' || coalesce(v_club, 'club') || ' is now ' || v_words || '. You are still set to play it.', 'game', r.game_id::text);
        perform public._market_dm(r.profile_id, 'Your game for the ' || coalesce(v_club, 'club') || ' is now ' || v_words
          || '. You are still set to play it.');
        perform public.club_notify(r.team_id, 'lineups', 'A training camp guest''s game moved',
          v_name || ' is still set to play the game, now ' || v_words || '.', null, 'game', r.game_id::text, null, false);
      end if;
      continue;
    end if;
    update public.market_pool_requests set status = 'closed', ended_at = clock_timestamp(), note = r.why
     where id = r.id and status = r.was;
    get diagnostics v_k = row_count;
    continue when v_k = 0;
    v_n := v_n + 1;
    if r.was = 'accepted' then
      v_off := public._market_guest_off_sheet(r.game_id, r.team_id, r.profile_id);
      perform public.club_notify(r.team_id, 'lineups', 'A training camp request closed',
        v_name || ' was set to play ' || v_words || '. ' || r.why
        || case when v_off > 0 then ' They came off that game''s lineup, so refile it.' else '' end,
        null, 'game', r.game_id::text, null, false);
      perform public.create_notification(r.profile_id, 'lineups', 'A training camp request closed',
        'You were set to play for the ' || coalesce(v_club, 'club') || ' ' || v_words || '. ' || r.why
        || case when v_off > 0 then ' You are off that game''s lineup.' else '' end, 'game', r.game_id::text);
    end if;
  end loop;

  for r in
    select q.id, q.profile_id, q.team_id, q.game_id, g.game_code, g.server
      from public.market_pool_requests q join public.games g on g.id = q.game_id
     where q.season_id = p_season and q.status = 'accepted' and q.code_dm_at is null
       and g.status = 'scheduled' and not coalesce(g.voided, false) and g.game_code is not null
       and clock_timestamp() >= public.night_lock_at(g.id)
     for update of q skip locked
  loop
    select t.name into v_club from public.teams t where t.id = r.team_id;
    v_words := public._market_pool_game_words(r.game_id, r.team_id);
    perform public._market_dm(r.profile_id, 'Your game for the ' || coalesce(v_club, 'club') || ' ' || v_words || ': server '
      || coalesce(nullif(r.server, ''), 'still settling (check the game page on the site)') || ', lobby code ' || r.game_code
      || '. The code is for this game only; keep it to yourself.');
    perform public.create_notification(r.profile_id, 'lineups', 'Your game code is ready',
      'The lobby code and server for your game for the ' || coalesce(v_club, 'club') || ' ' || v_words
      || ' are on the game page. The code is for this game only; keep it to yourself.', 'game', r.game_id::text);
    update public.market_pool_requests set code_dm_at = clock_timestamp() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $f$;

select pg_temp.vnnn_patch('public.market_tick()',
  array[$a$    -- market-tick steps end
$a$],
  array[$b$    begin
      v_errors := v_errors || public._market_lineup_forfeits(v_season);   -- v4.59: Season 2 lineup deadline forfeits
    exception when others then
      v_errors := v_errors || ('lineup deadline: ' || sqlerrm);
    end;
    begin
      perform public._market_pool_sweep(v_season);   -- v4.59: training camp requests (close, lapse, lobby code DMs)
    exception when others then
      v_errors := v_errors || ('pool requests: ' || sqlerrm);
    end;
    -- market-tick steps end
$b$]);

-- 8b. night_lock_at: a lock that has passed stays; every Season 1 night's lock is compared before and after
do $nl$
declare v_s1 uuid := (select id from public.seasons where number = 1); v_before text; v_after text;
begin
  select md5(coalesce(string_agg(x.night_day::text || '=' || coalesce(public.night_lock_at(v_s1, x.night_day)::text, ''), ',' order by x.night_day), ''))
    into v_before
    from (select distinct (g.scheduled_at at time zone 'America/New_York')::date as night_day from public.games g
           where g.season_id = v_s1 and g.scheduled_at is not null) x;
  perform pg_temp.vnnn_patch('public.night_lock_at(uuid,date)',
    array[$a$  select min(scheduled_at) - interval '30 minutes'
$a$],
    array[$b$  /* v4.59 (decision, 2026-11-24: ruling or voiding a game must not move the night's lock): a lock that has passed
     stays. Each market-season game is ruled at its own lineup lock (public._market_lineup_forfeits) and the ruling keeps
     the lock it was ruled at; the earliest of a night's rulings holds the night's lock after a game is voided or moved,
     so requests and answers, the codes, the server picks and the night's settling all keep the first game's lock.
     Season 1 has no rulings, so its locks are unchanged. */
  select least(min(scheduled_at) - interval '30 minutes',
               (select min(d.lock_at) from public.market_lineup_deadlines d where d.season_id = p_season and d.night = p_day))
$b$]);
  select md5(coalesce(string_agg(x.night_day::text || '=' || coalesce(public.night_lock_at(v_s1, x.night_day)::text, ''), ',' order by x.night_day), ''))
    into v_after
    from (select distinct (g.scheduled_at at time zone 'America/New_York')::date as night_day from public.games g
           where g.season_id = v_s1 and g.scheduled_at is not null) x;
  if v_after is distinct from v_before then
    raise exception 'v4.59 pool requests: night_lock_at changed a Season 1 night''s lock';
  end if;
end $nl$;

-- 8c. mgmt_request_move: the Owner is told a queued lineup's deadline
select pg_temp.vnnn_patch('public.mgmt_request_move(text,text,jsonb,text)',
  array[$a$    v_who || ' wants to ' || left(d.o_summary, 240) || '. Approve or deny it from Team HQ → Management.', 'mgmtapprovals', null);
$a$],
  array[$b$    v_who || ' wants to ' || left(d.o_summary, 240) || '. Approve or deny it from Team HQ → Management.'
    /* v4.59 (review, 2026-11-24): in a market season a club without a full six at a game's lineup lock forfeits the game
       (public._market_lineup_forfeits), and an approval after that lock cannot set a missing lineup, so the Owner is told
       the deadline with the request. Season 1 adds nothing. */
    || coalesce((select ' The lineup deadline for that game is '
                        || to_char((g.scheduled_at - interval '30 minutes') at time zone 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM')
                        || ' ET: approve before then, because a club without a full lineup of six at the deadline forfeits the game.'
                   from public.games g
                  where p_action = 'set_game_lineup' and g.id::text = p_args->>'p_game' and public.market_on(g.season_id)), ''),
    'mgmtapprovals', null);
$b$]);

drop function pg_temp.vnnn_patch(text, text[], text[], text);

-- 9. grants
do $grants$
declare f text;
begin
  foreach f in array array['public._market_guest(uuid,uuid,uuid)', 'public._market_guest_off_sheet(uuid,uuid,uuid)',
    'public._market_pool_game_words(uuid,uuid)', 'public._market_pool_night_check(uuid,uuid,date)',
    'public.market_pool_request(uuid,uuid,uuid)', 'public.market_pool_answer(uuid,boolean)', 'public.market_pool_withdraw(uuid)',
    'public._market_pool_suspension_night(uuid,date)', 'public._market_lineup_forfeits(uuid)', 'public._market_pool_sweep(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $grants$;
grant execute on function public.market_pool_request(uuid, uuid, uuid) to authenticated;
grant execute on function public.market_pool_answer(uuid, boolean) to authenticated;
grant execute on function public.market_pool_withdraw(uuid) to authenticated;

-- 10. self-checks
do $chk$
declare f text; r text; pr text; v_def text;
  s1_rules constant jsonb := '{"flex": null, "lines": null, "quota": {"D": 5, "F": 7, "G": 3}, "weeks": 6, "format": "basic", "rights": false, "camp_max": 10, "cap_camp": 3, "fa_window": false, "preseason": false, "cap_goalie": 6, "cap_skater": 6, "extensions": false, "roster_max": 15, "salary_cap": 50000000, "series_cap": 4, "draft_snake": true, "pick_trades": false, "draft_rounds": 12, "min_service_gp": 0, "playoff_min_gp": 14, "playoff_best_of": 7, "playoff_per_div": 3, "max_contract_years": 1, "trade_deadline_week": 4}'::jsonb;
begin
  foreach f in array array['public._market_guest(uuid,uuid,uuid)', 'public._market_guest_off_sheet(uuid,uuid,uuid)',
    'public._market_pool_game_words(uuid,uuid)', 'public._market_pool_night_check(uuid,uuid,date)',
    'public.market_pool_request(uuid,uuid,uuid)', 'public.market_pool_answer(uuid,boolean)', 'public.market_pool_withdraw(uuid)',
    'public._market_pool_suspension_night(uuid,date)', 'public._market_lineup_forfeits(uuid)', 'public._market_pool_sweep(uuid)'] loop
    if not (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) from pg_proc p where p.oid = f::regprocedure) then
      raise exception 'v4.59 pool requests: % must be SECURITY DEFINER with search_path ''''', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'v4.59 pool requests: anon can execute %', f; end if;
    if has_function_privilege('authenticated', f, 'EXECUTE')
       and f not in ('public.market_pool_request(uuid,uuid,uuid)', 'public.market_pool_answer(uuid,boolean)', 'public.market_pool_withdraw(uuid)') then
      raise exception 'v4.59 pool requests: authenticated can execute the internal %', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.market_pool_request(uuid,uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.market_pool_answer(uuid,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.market_pool_withdraw(uuid)', 'EXECUTE') then
    raise exception 'v4.59 pool requests: a client RPC lost its grant';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'lineup_slot_ok') <> 1
     or to_regprocedure('public.lineup_slot_ok(uuid,text,uuid,uuid,text,uuid)') is null
     or has_function_privilege('anon', 'public.lineup_slot_ok(uuid,text,uuid,uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.lineup_slot_ok(uuid,text,uuid,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'v4.59 pool requests: expected exactly one lineup_slot_ok(uuid, text, uuid, uuid, text, uuid), not executable by the API roles';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('set_game_lineup', 'can_see_match', 'review_game_records', 'count_suspension_games', 'market_tick',
                        'mgmt_request_move')) <> 6
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'night_lock_at') <> 2 then
    raise exception 'v4.59 pool requests: a patched function gained an overload';
  end if;
  v_def := pg_get_functiondef('public.market_tick()'::regprocedure);
  if position('public._market_lineup_forfeits(v_season)' in v_def) = 0
     or position('public._market_lineup_forfeits(v_season)' in v_def) > position('public._market_pool_sweep(v_season)' in v_def)
     or position('public._market_pool_sweep(v_season)' in v_def) > position('    -- market-tick steps end' in v_def) then
    raise exception 'v4.59 pool requests: market_tick must rule the lineup deadline, then sweep the requests, above its steps end line';
  end if;
  if position('public.market_lineup_deadlines' in pg_get_functiondef('public.night_lock_at(uuid,date)'::regprocedure)) = 0
     or position('public.market_lineup_deadlines' in pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure)) = 0 then
    raise exception 'v4.59 pool requests: night_lock_at and set_game_lineup must read the deadline rulings';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.market_pool_requests'::regclass)
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'market_pool_requests') <> 1
     or (select cmd from pg_policies where schemaname = 'public' and tablename = 'market_pool_requests') <> 'SELECT' then
    raise exception 'v4.59 pool requests: market_pool_requests must have RLS on and exactly one (SELECT) policy';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.market_lineup_deadlines'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'market_lineup_deadlines') then
    raise exception 'v4.59 pool requests: market_lineup_deadlines must have RLS on and no policy (office only)';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    foreach pr in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, 'public.market_pool_requests', pr)
         or (case when pr in ('INSERT', 'UPDATE', 'REFERENCES') then has_any_column_privilege(r, 'public.market_pool_requests', pr) else false end) then   /* parenthesized: a bare CASE in a plpgsql IF ends the condition at its first THEN */
        raise exception 'v4.59 pool requests: market_pool_requests grants are wrong: % has %', r, pr;
      end if;
    end loop;
    foreach pr in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, 'public.market_lineup_deadlines', pr)
         or (case when pr in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') then has_any_column_privilege(r, 'public.market_lineup_deadlines', pr) else false end) then   /* parenthesized CASE, as above */
        raise exception 'v4.59 pool requests: market_lineup_deadlines is office only, but % has %', r, pr;
      end if;
    end loop;
    foreach pr in array array['requested_by', 'ended_by', 'code_dm_at'] loop
      if has_column_privilege(r, 'public.market_pool_requests', pr, 'SELECT') then
        raise exception 'v4.59 pool requests: market_pool_requests grants are wrong: % reads %', r, pr;
      end if;
    end loop;
    if not has_column_privilege(r, 'public.market_pool_requests', 'status', 'SELECT') then
      raise exception 'v4.59 pool requests: market_pool_requests grants are wrong: % cannot read the requests', r;
    end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid = 'public.market_pool_requests'::regclass and tgname like 'live_mark_market_pool_requests_%') <> 3
     or not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                      and tablename = 'market_pool_requests') then
    raise exception 'v4.59 pool requests: market_pool_requests needs its three live_mark triggers and Realtime';
  end if;
  if public.season_rules((select id from public.seasons where number = 1)) <> s1_rules then
    raise exception 'v4.59 pool requests: season_rules(Season 1) changed';
  end if;
  if public.market_on((select id from public.seasons where number = 1)) then
    raise exception 'v4.59 pool requests: Season 1 must not be a market season';
  end if;
end $chk$;

/* Rehearsal: on production, 2026-11-24 (main session), one transaction rolled back by its closing raise:
   REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15.
   Applied 2026-11-24 as migration v459c_s2_pool_requests (after v459_s2_bid_nights and v459b_s2_committees);
   tools/sql/grant-audit.sql returned zero rows. */
-- <<< record text

-- the world
do $w$
declare v_s2 uuid := (select id from public.seasons where number = 2); v_tz text := 'America/New_York';
        v_t uuid[]; v_f uuid[]; v_d uuid[]; v_g uuid[]; v_all uuid[]; v_pick uuid[]; v_rest uuid[]; v_k int := 1;
        v_o uuid; v_own uuid[] := '{}'; v_rt uuid[]; v_rp uuid[]; i int; v_n1 date; v_late uuid; v_id uuid; v_games uuid[] := '{}';
begin
  if public.current_season_id() is distinct from v_s2 or not public.market_on(v_s2) then
    raise exception 'world: Season 2 must be the current market season';
  end if;
  if exists (select 1 from public.games g where g.season_id = v_s2 and (g.scheduled_at at time zone v_tz)::date = (now() at time zone v_tz)::date) then
    raise exception 'world: Season 2 has a game today; run this rehearsal on a day without one (its games move onto today)';
  end if;
  if ((now() + interval '15 minutes') at time zone v_tz)::date <> (now() at time zone v_tz)::date then
    raise exception 'world: run this rehearsal outside the fifteen minutes before midnight ET (its games move onto today)';
  end if;
  if exists (select 1 from public.games g where g.season_id = v_s2 and g.status = 'scheduled' and not coalesce(g.voided, false)
               and g.scheduled_at - interval '30 minutes' <= now()) then
    raise exception 'world: a real Season 2 game is past its lineup lock, and the lineup deadline step would rule it';
  end if;
  if exists (select 1 from public.replacement_signings x where x.season_id = v_s2 and x.pos_group is not null and x.used_at is null) then
    raise exception 'world: a Season 2 shortfall draw is open, and a tick here would place a camp player of this world at random';
  end if;
  if exists (select 1 from public.draft_state where season_number = 2) then
    update public.draft_state set status = 'complete' where season_number = 2;
  else
    insert into public.draft_state (season_number, status) values (2, 'complete');
  end if;
  select array_agg(x.id order by x.code) into v_t from (select t.id, t.code from public.teams t order by t.code limit 3) x;
  select array_agg(r.profile_id order by r.created_at, r.profile_id) filter (where public.pos_group(r.position) = 'F'),
         array_agg(r.profile_id order by r.created_at, r.profile_id) filter (where public.pos_group(r.position) = 'D'),
         array_agg(r.profile_id order by r.created_at, r.profile_id) filter (where public.pos_group(r.position) = 'G'),
         array_agg(r.profile_id order by r.created_at, r.profile_id)
    into v_f, v_d, v_g, v_all
    from public.season_registrations r join public.profiles p on p.id = r.profile_id
   where r.season_id = v_s2 and r.status <> 'declined' and not coalesce(p.banned, false) and p.discord_id is not null
     and coalesce(p.role::text, '') not in ('staff', 'commissioner') and not public.is_suspended(r.profile_id)
     and not exists (select 1 from public.roster_spots rs where rs.season_id = v_s2 and rs.profile_id = r.profile_id)
     and not exists (select 1 from public.teams t where r.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id))
     and not exists (select 1 from public.market_waivers w where w.season_id = v_s2 and w.profile_id = r.profile_id and w.status = 'open');
  if coalesce(cardinality(v_f), 0) < 9 or coalesce(cardinality(v_d), 0) < 6 or coalesce(cardinality(v_g), 0) < 3 then
    raise exception 'world: not enough Season 2 sign-ups to build three rosters';
  end if;
  v_pick := v_f[1:9] || v_d[1:6] || v_g[1:3];
  select array_agg(u.x order by u.o) into v_rest from unnest(v_all) with ordinality u(x, o) where u.x <> all(v_pick);
  /* an Owner for each club: the seated one, or a sign-up seated here (the minimums rehearsal's way) */
  for i in 1 .. 3 loop
    select t.owner_profile_id into v_o from public.teams t where t.id = v_t[i];
    if v_o is null then
      v_o := v_rest[v_k]; v_k := v_k + 1;
      update public.teams set owner_profile_id = v_o where id = v_t[i];
    elsif public.is_suspended(v_o)
          or exists (select 1 from public.profiles p where p.id = v_o and coalesce(p.role::text, '') in ('staff', 'commissioner')) then
      raise exception 'world: a seated Owner of the first three clubs is staff, a commissioner or suspended';
    end if;
    v_own := v_own || v_o;
  end loop;
  if coalesce(cardinality(v_rest), 0) < v_k + 8 then raise exception 'world: not enough Season 2 sign-ups left for the camp players'; end if;
  /* six rostered players a club: 3 F, 2 D, 1 G */
  v_rt := array_fill(v_t[1], array[6]) || array_fill(v_t[2], array[6]) || array_fill(v_t[3], array[6]);
  v_rp := array[v_f[1], v_f[2], v_f[3], v_d[1], v_d[2], v_g[1], v_f[4], v_f[5], v_f[6], v_d[3], v_d[4], v_g[2],
                v_f[7], v_f[8], v_f[9], v_d[5], v_d[6], v_g[3]];
  for i in 1 .. 18 loop
    insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
      values (v_s2, v_rt[i], v_rp[i], public._market_jersey(v_s2, v_rt[i]),
              (select r.position from public.season_registrations r where r.season_id = v_s2 and r.profile_id = v_rp[i]), 750000, 'draft');
  end loop;
  perform set_config('rh.s2', v_s2::text, true);
  perform set_config('rh.a', v_t[1]::text, true); perform set_config('rh.b', v_t[2]::text, true); perform set_config('rh.c', v_t[3]::text, true);
  perform set_config('rh.oa', v_own[1]::text, true); perform set_config('rh.ob', v_own[2]::text, true); perform set_config('rh.oc', v_own[3]::text, true);
  perform set_config('rh.af1', v_f[1]::text, true); perform set_config('rh.af2', v_f[2]::text, true); perform set_config('rh.af3', v_f[3]::text, true);
  perform set_config('rh.ad1', v_d[1]::text, true); perform set_config('rh.ad2', v_d[2]::text, true); perform set_config('rh.ag1', v_g[1]::text, true);
  perform set_config('rh.bf1', v_f[4]::text, true); perform set_config('rh.bf2', v_f[5]::text, true); perform set_config('rh.bf3', v_f[6]::text, true);
  perform set_config('rh.bd1', v_d[3]::text, true); perform set_config('rh.bd2', v_d[4]::text, true); perform set_config('rh.bg1', v_g[2]::text, true);
  perform set_config('rh.cf1', v_f[7]::text, true); perform set_config('rh.cf2', v_f[8]::text, true); perform set_config('rh.cf3', v_f[9]::text, true);
  perform set_config('rh.cd1', v_d[5]::text, true); perform set_config('rh.cd2', v_d[6]::text, true); perform set_config('rh.cg1', v_g[3]::text, true);
  for i in 1 .. 7 loop perform set_config('rh.p' || i, v_rest[v_k + i - 1]::text, true); end loop;
  perform set_config('rh.x', v_rest[v_k + 7]::text, true);
  perform set_config('rh.s', v_rest[v_k + 8]::text, true);
  insert into public.suspensions (profile_id, reason, mode, games_total, scope, season_id)
    values (v_rest[v_k + 8], 'rehearsal', 'games', 3, 'play', v_s2);
  /* the late sign-up: a member in the Discord with their console details and no Season 2 sign-up */
  select p.id into v_late from public.profiles p
   where coalesce(p.in_guild, false) and not coalesce(p.banned, false) and p.discord_id is not null
     and coalesce(p.role::text, '') not in ('staff', 'commissioner') and not public.is_suspended(p.id)
     and coalesce(p.ea_id, '') <> '' and coalesce(p.platform, '') <> '' and coalesce(p.platform_gamertag, '') <> ''
     and not exists (select 1 from public.season_registrations r where r.season_id = v_s2 and r.profile_id = p.id)
     and not exists (select 1 from public.suspensions s where s.profile_id = p.id and s.status = 'active' and s.mode = 'seasons')
     and not exists (select 1 from public.teams t where p.id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id))
   order by p.created_at, p.id limit 1;
  if v_late is null then raise exception 'world: no member without a Season 2 sign-up to sign up late'; end if;
  perform set_config('rh.l', v_late::text, true);
  /* the games: N1 is the first night at least three days out with nothing on N1, N1 + 1 or N1 + 7 */
  v_n1 := (now() at time zone v_tz)::date + 3;
  while exists (select 1 from public.games g where g.season_id = v_s2 and (g.scheduled_at at time zone v_tz)::date in (v_n1, v_n1 + 1, v_n1 + 7)) loop
    v_n1 := v_n1 + 1;
  end loop;
  insert into public.games (season_id, week, home_team_id, away_team_id, scheduled_at, stage)
    values (v_s2, 1, v_t[1], v_t[2], (v_n1::text || ' 21:00')::timestamp at time zone v_tz, 'regular') returning id into v_id;
  perform set_config('rh.g1', v_id::text, true); v_games := v_games || v_id;
  insert into public.games (season_id, week, home_team_id, away_team_id, scheduled_at, stage)
    values (v_s2, 1, v_t[1], v_t[3], (v_n1::text || ' 21:35')::timestamp at time zone v_tz, 'regular') returning id into v_id;
  perform set_config('rh.g2', v_id::text, true); v_games := v_games || v_id;
  insert into public.games (season_id, week, home_team_id, away_team_id, scheduled_at, stage)
    values (v_s2, 1, v_t[2], v_t[3], (v_n1::text || ' 22:10')::timestamp at time zone v_tz, 'regular') returning id into v_id;
  perform set_config('rh.g3', v_id::text, true); v_games := v_games || v_id;
  insert into public.games (season_id, week, home_team_id, away_team_id, scheduled_at, stage)
    values (v_s2, 1, v_t[1], v_t[2], ((v_n1 + 1)::text || ' 21:00')::timestamp at time zone v_tz, 'regular') returning id into v_id;
  perform set_config('rh.g4', v_id::text, true); v_games := v_games || v_id;
  insert into public.games (season_id, week, home_team_id, away_team_id, scheduled_at, stage)
    values (v_s2, 1, v_t[2], v_t[3], ((v_n1 + 1)::text || ' 21:35')::timestamp at time zone v_tz, 'regular') returning id into v_id;
  perform set_config('rh.g5', v_id::text, true); v_games := v_games || v_id;
  insert into public.games (season_id, week, home_team_id, away_team_id, scheduled_at, stage)
    values (v_s2, 1, v_t[1], v_t[2], ((v_n1 + 7)::text || ' 21:00')::timestamp at time zone v_tz, 'playoff') returning id into v_id;
  perform set_config('rh.gpo', v_id::text, true); v_games := v_games || v_id;
  perform set_config('rh.games', v_games::text, true);
  if (select count(*) from public.market_pool(v_s2) mp
       where mp.profile_id = any(array[v_rest[v_k], v_rest[v_k + 1], v_rest[v_k + 2], v_rest[v_k + 3], v_rest[v_k + 4],
                                       v_rest[v_k + 5], v_rest[v_k + 6], v_rest[v_k + 7], v_rest[v_k + 8]])) <> 9 then
    raise exception 'world: a camp player of the world is not in the training camp pool';
  end if;
end $w$;

-- T1 requests: A asks P1 to P4 for G1, and P1 and P5 for G2
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t1a$
declare v_g1 uuid := current_setting('rh.g1')::uuid; v_g2 uuid := current_setting('rh.g2')::uuid; v_a uuid := current_setting('rh.a')::uuid;
        v_r jsonb;
begin
  v_r := public.market_pool_request(v_g1, v_a, current_setting('rh.p1')::uuid);
  if v_r->>'status' <> 'pending' or (v_r->>'closes_at') is null then raise exception 'T1 failed: the request did not answer pending with its closing time: %', v_r; end if;
  perform set_config('rh.q_a1_1', v_r->>'request_id', true);
  perform set_config('rh.q_a2_1', public.market_pool_request(v_g1, v_a, current_setting('rh.p2')::uuid)->>'request_id', true);
  perform set_config('rh.q_a3_1', public.market_pool_request(v_g1, v_a, current_setting('rh.p3')::uuid)->>'request_id', true);
  perform set_config('rh.q_a4_1', public.market_pool_request(v_g1, v_a, current_setting('rh.p4')::uuid)->>'request_id', true);
  perform set_config('rh.q_a1_2', public.market_pool_request(v_g2, v_a, current_setting('rh.p1')::uuid)->>'request_id', true);
  perform set_config('rh.q_a5_2', public.market_pool_request(v_g2, v_a, current_setting('rh.p5')::uuid)->>'request_id', true);
end $t1a$;

-- T2 refusals at the request door
do $t2$
declare v_g1 uuid := current_setting('rh.g1')::uuid; v_a uuid := current_setting('rh.a')::uuid;
begin
  begin
    perform public.market_pool_request(v_g1, v_a, current_setting('rh.af1')::uuid);
    raise exception 'T2 failed: a rostered player was requested';
  exception when others then
    if sqlerrm not like '% is not in the training camp pool.' then raise; end if;
  end;
  begin
    perform public.market_pool_request(v_g1, v_a, current_setting('rh.s')::uuid);
    raise exception 'T2 failed: a suspended player was requested';
  exception when others then
    if sqlerrm not like '% is suspended and cannot play until the suspension is served.' then raise; end if;
  end;
  begin
    perform public.market_pool_request(v_g1, v_a, current_setting('rh.p1')::uuid);
    raise exception 'T2 failed: a club asked the same player for the same game twice';
  exception when others then
    if sqlerrm not like 'Your club already asked % to play this game.' then raise; end if;
  end;
  begin
    perform public.market_pool_request(current_setting('rh.gpo')::uuid, v_a, current_setting('rh.p6')::uuid);
    raise exception 'T2 failed: a training camp player was requested for a playoff game';
  exception when others then
    if sqlerrm <> 'Training camp players do not play in the playoffs.' then raise; end if;
  end;
  begin
    perform public.market_pool_request(current_setting('rh.g3')::uuid, v_a, current_setting('rh.p6')::uuid);
    raise exception 'T2 failed: a club requested a player for a game it is not in';
  exception when others then
    if sqlerrm <> 'That club is not playing in this game.' then raise; end if;
  end;
end $t2$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oc'), 'role', 'authenticated')::text, true);
do $t2c$
begin
  perform public.market_pool_request(current_setting('rh.g1')::uuid, current_setting('rh.a')::uuid, current_setting('rh.p6')::uuid);
  raise exception 'T2 failed: another club''s Owner requested a player for A';
exception when others then
  if sqlerrm <> 'Only that club''s Owner, GM or AGM can request a training camp player for it.' then raise; end if;
end $t2c$;

-- T1 (continued): B asks P1, P5 and P6 for G1, and P7 for G3
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t1b$
declare v_g1 uuid := current_setting('rh.g1')::uuid; v_b uuid := current_setting('rh.b')::uuid;
begin
  perform set_config('rh.q_b1_1', public.market_pool_request(v_g1, v_b, current_setting('rh.p1')::uuid)->>'request_id', true);
  perform set_config('rh.q_b5_1', public.market_pool_request(v_g1, v_b, current_setting('rh.p5')::uuid)->>'request_id', true);
  perform set_config('rh.q_b6_1', public.market_pool_request(v_g1, v_b, current_setting('rh.p6')::uuid)->>'request_id', true);
  perform set_config('rh.q_b7_3', public.market_pool_request(current_setting('rh.g3')::uuid, v_b, current_setting('rh.p7')::uuid)->>'request_id', true);
end $t1b$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t1v$
declare v_games uuid[] := current_setting('rh.games')::uuid[];
begin
  if (select count(*) from public.market_pool_requests where game_id = any(v_games) and team_id = current_setting('rh.a')::uuid and status = 'pending') <> 6
     or (select count(*) from public.market_pool_requests where game_id = any(v_games) and team_id = current_setting('rh.b')::uuid and status = 'pending') <> 4
     or (select count(*) from public.market_pool_requests where game_id = any(v_games)) <> 10 then
    raise exception 'T1 failed: expected six pending requests from A and four from B';
  end if;
  if not exists (select 1 from public.discord_dms where profile_id = current_setting('rh.p1')::uuid and kind = 'market'
                   and content like 'The % asked you to play % ET. Accept or decline on the CGHL site before % ET, when that night''s lineups lock.')
     or not exists (select 1 from public.notifications where profile_id = current_setting('rh.p1')::uuid and title like 'The % asked you to play'
                      and created_at >= now()) then
    raise exception 'T1 failed: the player was not told of the request by DM and bell';
  end if;
end $t1v$;

-- T3 visibility before the lock: the requesting club's seats, the player and the office only
set local role anon;
do $t3a$
begin
  if (select count(id) from public.market_pool_requests where game_id = any(current_setting('rh.games')::uuid[])) <> 0 then
    raise exception 'T3 failed: anon read a request before the lock';
  end if;
end $t3a$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oc'), 'role', 'authenticated')::text, true);
do $t3c$
begin
  if (select count(id) from public.market_pool_requests where game_id = any(current_setting('rh.games')::uuid[])) <> 0 then
    raise exception 'T3 failed: another club read a request before the lock';
  end if;
end $t3c$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t3o$
begin
  if (select count(id) from public.market_pool_requests where game_id = any(current_setting('rh.games')::uuid[])) <> 6
     or (select count(id) from public.market_pool_requests where game_id = any(current_setting('rh.games')::uuid[])
           and team_id <> current_setting('rh.a')::uuid) <> 0 then
    raise exception 'T3 failed: A''s Owner should read A''s six requests and nothing of B''s';
  end if;
end $t3o$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p1'), 'role', 'authenticated')::text, true);
do $t3p$
begin
  if (select count(id) from public.market_pool_requests where game_id = any(current_setting('rh.games')::uuid[])) <> 3 then
    raise exception 'T3 failed: P1 should read the three requests made to them';
  end if;
end $t3p$;

-- T4 answers
do $t4p1$
declare v_r jsonb;
begin
  v_r := public.market_pool_answer(current_setting('rh.q_a1_1')::uuid, true);
  if v_r->>'status' <> 'accepted' then raise exception 'T4 failed: P1 could not accept A for G1: %', v_r; end if;
  perform public.market_pool_answer(current_setting('rh.q_a1_2')::uuid, true);   -- the same club, the same night: allowed
  begin
    perform public.market_pool_answer(current_setting('rh.q_b1_1')::uuid, true);
    raise exception 'T4 failed: P1 took a second club for the same night';
  exception when others then
    if sqlerrm not like 'The player accepted another club''s request for that night.%' then raise; end if;
  end;
end $t4p1$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p2'), 'role', 'authenticated')::text, true);
do $t4p2$
begin
  perform public.market_pool_answer(current_setting('rh.q_a2_1')::uuid, false);
  begin
    perform public.market_pool_answer(current_setting('rh.q_a2_1')::uuid, true);
    raise exception 'T4 failed: P2 answered twice';
  exception when others then
    if sqlerrm <> 'You already declined this request.' then raise; end if;
  end;
end $t4p2$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p3'), 'role', 'authenticated')::text, true);
do $t4p3$
begin
  begin
    perform public.market_pool_answer(current_setting('rh.q_a4_1')::uuid, true);
    raise exception 'T4 failed: P3 answered P4''s request';
  exception when others then
    if sqlerrm <> 'Only the player asked can answer this request.' then raise; end if;
  end;
  perform public.market_pool_answer(current_setting('rh.q_a3_1')::uuid, true);
end $t4p3$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p4'), 'role', 'authenticated')::text, true);
do $t4p4$ begin perform public.market_pool_answer(current_setting('rh.q_a4_1')::uuid, true); end $t4p4$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p5'), 'role', 'authenticated')::text, true);
do $t4p5$ begin perform public.market_pool_answer(current_setting('rh.q_b5_1')::uuid, true); end $t4p5$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t4v$
declare q record;
begin
  for q in select k, s from (values ('rh.q_a1_1', 'accepted'), ('rh.q_a1_2', 'accepted'), ('rh.q_a2_1', 'declined'),
                                   ('rh.q_a3_1', 'accepted'), ('rh.q_a4_1', 'accepted'), ('rh.q_b5_1', 'accepted'),
                                   ('rh.q_b1_1', 'closed'), ('rh.q_a5_2', 'closed')) v(k, s) loop
    if (select r.status from public.market_pool_requests r where r.id = current_setting(q.k)::uuid) is distinct from q.s then
      raise exception 'T4 failed: % should be %', q.k, q.s;
    end if;
  end loop;
  if (select note from public.market_pool_requests where id = current_setting('rh.q_b1_1')::uuid)
       <> 'The player accepted another club''s request for that night. A training camp player plays for one club a night.'
     or (select note from public.market_pool_requests where id = current_setting('rh.q_a5_2')::uuid)
       <> 'The club has three training camp players for that night, the most a club may use.' then
    raise exception 'T4 failed: a closed request does not carry its note';
  end if;
  if not exists (select 1 from public.notifications where profile_id = current_setting('rh.ob')::uuid and title like '% is playing for another club'
                   and created_at >= now())
     or not exists (select 1 from public.notifications where profile_id = current_setting('rh.oa')::uuid and title like '% declined'
                      and created_at >= now())
     or not exists (select 1 from public.notifications where profile_id = current_setting('rh.oa')::uuid and title like '% accepted'
                      and created_at >= now()) then
    raise exception 'T4 failed: the clubs'' seats were not told the answers';
  end if;
end $t4v$;

-- T5 the night rules
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t5a$
begin
  perform public.market_pool_request(current_setting('rh.g2')::uuid, current_setting('rh.a')::uuid, current_setting('rh.p6')::uuid);
  raise exception 'T5 failed: A asked a fourth camp player for N1';
exception when others then
  if sqlerrm not like 'Three training camp players already play for the % that night, the most a club may use.' then raise; end if;
end $t5a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t5b$
begin
  begin
    perform public.market_pool_request(current_setting('rh.g3')::uuid, current_setting('rh.b')::uuid, current_setting('rh.p3')::uuid);
    raise exception 'T5 failed: B asked a player who plays for A that night';
  exception when others then
    if sqlerrm not like '% is already playing for another club that night. A training camp player plays for one club a night.' then raise; end if;
  end;
  perform set_config('rh.q_b2_1', public.market_pool_request(current_setting('rh.g1')::uuid, current_setting('rh.b')::uuid,
                                                             current_setting('rh.p2')::uuid)->>'request_id', true);
  perform set_config('rh.q_b1_4', public.market_pool_request(current_setting('rh.g4')::uuid, current_setting('rh.b')::uuid,
                                                             current_setting('rh.p1')::uuid)->>'request_id', true);
end $t5b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p1'), 'role', 'authenticated')::text, true);
do $t5p$
declare v_r jsonb;
begin
  v_r := public.market_pool_answer(current_setting('rh.q_b1_4')::uuid, true);   -- a new night, a new club
  if v_r->>'status' <> 'accepted' then raise exception 'T5 failed: P1 could not accept B for a game on the next night: %', v_r; end if;
end $t5p$;

-- T6 withdraw, release and backing out, all before the lock
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t6b$
declare v_r jsonb;
begin
  v_r := public.market_pool_withdraw(current_setting('rh.q_b6_1')::uuid);
  if v_r->>'status' <> 'withdrawn' or (v_r->>'released')::boolean then raise exception 'T6 failed: B could not withdraw its open ask to P6: %', v_r; end if;
  /* B dresses its N2 guest P1 for G4 with five of its own, then releases them */
  perform public.set_game_lineup(current_setting('rh.g4')::uuid, current_setting('rh.b')::uuid, current_setting('rh.p1')::uuid,
    current_setting('rh.bf1')::uuid, current_setting('rh.bf2')::uuid, current_setting('rh.bd1')::uuid, current_setting('rh.bd2')::uuid,
    current_setting('rh.bg1')::uuid, false);
  v_r := public.market_pool_withdraw(current_setting('rh.q_b1_4')::uuid);
  if v_r->>'status' <> 'withdrawn' or not (v_r->>'released')::boolean or not (v_r->>'off_sheet')::boolean then
    raise exception 'T6 failed: B could not release its accepted guest P1 from G4, or P1 stayed on the sheet: %', v_r;
  end if;
end $t6b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t6a$
begin
  begin
    perform public.market_pool_withdraw(current_setting('rh.q_b7_3')::uuid);
    raise exception 'T6 failed: A withdrew B''s request';
  exception when others then
    if sqlerrm <> 'Only that club''s Owner, GM or AGM can withdraw its request.' then raise; end if;
  end;
  /* the release freed P1's night: another club may have them on N2 */
  perform set_config('rh.q_a1_4', public.market_pool_request(current_setting('rh.g4')::uuid, current_setting('rh.a')::uuid,
                                                             current_setting('rh.p1')::uuid)->>'request_id', true);
end $t6a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p1'), 'role', 'authenticated')::text, true);
do $t6p1$
declare v_r jsonb;
begin
  v_r := public.market_pool_answer(current_setting('rh.q_a1_4')::uuid, true);
  if v_r->>'status' <> 'accepted' then raise exception 'T6 failed: the released P1 could not accept A for the same night: %', v_r; end if;
end $t6p1$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t6a2$
begin
  perform public.set_game_lineup(current_setting('rh.g4')::uuid, current_setting('rh.a')::uuid, current_setting('rh.p1')::uuid,
    current_setting('rh.af1')::uuid, current_setting('rh.af2')::uuid, current_setting('rh.ad1')::uuid, current_setting('rh.ad2')::uuid,
    current_setting('rh.ag1')::uuid, false);
end $t6a2$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p1'), 'role', 'authenticated')::text, true);
do $t6p1w$
declare v_r jsonb;
begin
  v_r := public.market_pool_answer(current_setting('rh.q_a1_4')::uuid, false);
  if v_r->>'status' <> 'declined' or not coalesce((v_r->>'withdrew')::boolean, false) then
    raise exception 'T6 failed: P1 could not withdraw an acceptance before the lock: %', v_r;
  end if;
  begin
    perform public.market_pool_answer(current_setting('rh.q_a1_4')::uuid, true);
    raise exception 'T6 failed: P1 accepted a request they had withdrawn from';
  exception when others then
    if sqlerrm <> 'You already declined this request.' then raise; end if;
  end;
end $t6p1w$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t6a3$
begin
  perform public.market_pool_request(current_setting('rh.g4')::uuid, current_setting('rh.a')::uuid, current_setting('rh.p1')::uuid);
  raise exception 'T6 failed: A asked P1 again for a game P1 withdrew from';
exception when others then
  if sqlerrm not like '% already declined this game.' then raise; end if;
end $t6a3$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t6v$
declare gl public.game_lineups;
begin
  if (select status from public.market_pool_requests where id = current_setting('rh.q_b6_1')::uuid) <> 'withdrawn'
     or (select ended_by from public.market_pool_requests where id = current_setting('rh.q_b6_1')::uuid) is distinct from current_setting('rh.ob')::uuid then
    raise exception 'T6 failed: B''s request to P6 is not withdrawn by B''s Owner';
  end if;
  if (select status from public.market_pool_requests where id = current_setting('rh.q_b1_4')::uuid) <> 'withdrawn'
     or (select ended_by from public.market_pool_requests where id = current_setting('rh.q_b1_4')::uuid) is distinct from current_setting('rh.ob')::uuid then
    raise exception 'T6 failed: B''s release of P1 is not recorded as withdrawn by B''s Owner';
  end if;
  select * into gl from public.game_lineups where game_id = current_setting('rh.g4')::uuid and team_id = current_setting('rh.b')::uuid;
  if gl.center is not null or gl.lw is distinct from current_setting('rh.bf1')::uuid or gl.goalie is distinct from current_setting('rh.bg1')::uuid then
    raise exception 'T6 failed: the release did not take P1, and only P1, off B''s G4 sheet';
  end if;
  if not exists (select 1 from public.notifications where profile_id = current_setting('rh.p1')::uuid and title like 'The % released you from a game'
                   and created_at >= now()) then
    raise exception 'T6 failed: P1 was not told of the release';
  end if;
  if (select status from public.market_pool_requests where id = current_setting('rh.q_a1_4')::uuid) <> 'declined' then
    raise exception 'T6 failed: P1''s withdrawn acceptance is not declined';
  end if;
  select * into gl from public.game_lineups where game_id = current_setting('rh.g4')::uuid and team_id = current_setting('rh.a')::uuid;
  if gl.center is not null or gl.lw is distinct from current_setting('rh.af1')::uuid then
    raise exception 'T6 failed: P1''s withdrawal did not take them, and only them, off A''s G4 sheet';
  end if;
  if not exists (select 1 from public.notifications where profile_id = current_setting('rh.oa')::uuid and title like '% withdrew from a game'
                   and body like '%refile it with a full six%' and created_at >= now()) then
    raise exception 'T6 failed: A''s seats were not told that P1 withdrew';
  end if;
end $t6v$;

-- T7 lineups (A's Owner)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t7a$
declare v_g1 uuid := current_setting('rh.g1')::uuid; v_a uuid := current_setting('rh.a')::uuid;
        p1 uuid := current_setting('rh.p1')::uuid; p2 uuid := current_setting('rh.p2')::uuid; p3 uuid := current_setting('rh.p3')::uuid;
        p4 uuid := current_setting('rh.p4')::uuid; ad1 uuid := current_setting('rh.ad1')::uuid; ad2 uuid := current_setting('rh.ad2')::uuid;
        ag1 uuid := current_setting('rh.ag1')::uuid;
begin
  begin
    perform public.set_game_lineup(v_g1, v_a, p1, p3, p4, ad1, null, ag1, false);
    raise exception 'T7 failed: a sheet with more guests than club players was filed';
  exception when others then
    if sqlerrm not like 'At least half of a game lineup must be the club''s own players: 3 training camp players in a lineup of 5 is too many%' then raise; end if;
  end;
  begin
    perform public.set_game_lineup(v_g1, v_a, p1, p3, p2, ad1, ad2, ag1, false);
    raise exception 'T7 failed: a player who declined was dressed';
  exception when others then
    if sqlerrm not like '% is on no roster and has not accepted a training camp request to play this game for this club.' then raise; end if;
  end;
  perform public.set_game_lineup(v_g1, v_a, p1, p3, p4, ad1, ad2, ag1, false);
  perform public.set_game_lineup(current_setting('rh.g2')::uuid, v_a, current_setting('rh.af1')::uuid, current_setting('rh.af2')::uuid,
                                 current_setting('rh.af3')::uuid, ad1, ad2, ag1, false);
  begin
    perform public.set_team_line(current_setting('rh.s2')::uuid, v_a, 1, null, p3, current_setting('rh.af1')::uuid,
                                 current_setting('rh.af2')::uuid, ad1, ad2, ag1);
    raise exception 'T7 failed: a guest entered a season line';
  exception when others then
    if sqlerrm not like '%is not on this club''s active roster and cannot be dressed.' then raise; end if;
  end;
end $t7a$;
-- T7 (B's Owner)
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t7b$
declare v_b uuid := current_setting('rh.b')::uuid; bf1 uuid := current_setting('rh.bf1')::uuid; bf2 uuid := current_setting('rh.bf2')::uuid;
        bd1 uuid := current_setting('rh.bd1')::uuid; bd2 uuid := current_setting('rh.bd2')::uuid; bg1 uuid := current_setting('rh.bg1')::uuid;
begin
  perform public.set_game_lineup(current_setting('rh.g1')::uuid, v_b, bf1, bf2, current_setting('rh.bf3')::uuid, bd1, bd2, bg1, false);
  begin
    perform public.set_game_lineup(current_setting('rh.g3')::uuid, v_b, bf1, bf2, current_setting('rh.p5')::uuid, bd1, bd2, bg1, false);
    raise exception 'T7 failed: a guest was dressed for a game they did not accept';
  exception when others then
    if sqlerrm not like '% is on no roster and has not accepted a training camp request to play this game for this club.' then raise; end if;
  end;
end $t7b$;
-- T7 (C's Owner): five of its own for G2, before the lock (a partial sheet is allowed until the deadline)
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oc'), 'role', 'authenticated')::text, true);
do $t7cc$
begin
  perform public.set_game_lineup(current_setting('rh.g2')::uuid, current_setting('rh.c')::uuid, current_setting('rh.cf1')::uuid,
    current_setting('rh.cf2')::uuid, current_setting('rh.cf3')::uuid, current_setting('rh.cd1')::uuid, null,
    current_setting('rh.cg1')::uuid, false);
end $t7cc$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t7s$
declare v_id uuid;
begin
  insert into public.suspensions (profile_id, reason, mode, games_total, scope, season_id)
    values (current_setting('rh.p5')::uuid, 'rehearsal', 'games', 2, 'play', current_setting('rh.s2')::uuid)
    returning id into v_id;
  perform set_config('rh.susp5', v_id::text, true);
end $t7s$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t7c$
begin
  perform public.set_game_lineup(current_setting('rh.g1')::uuid, current_setting('rh.b')::uuid, current_setting('rh.bf1')::uuid,
    current_setting('rh.bf2')::uuid, current_setting('rh.p5')::uuid, current_setting('rh.bd1')::uuid, current_setting('rh.bd2')::uuid,
    current_setting('rh.bg1')::uuid, false);
  raise exception 'T7 failed: a suspended guest was dressed';
exception when others then
  if sqlerrm not like '% is suspended and cannot be scheduled until it is served (Rule 7.2).' then raise; end if;
end $t7c$;

-- T8 before the lock the guest does not see the code
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p3'), 'role', 'authenticated')::text, true);
do $t8$
begin
  if public.can_see_match(current_setting('rh.g1')::uuid) then raise exception 'T8 failed: a guest saw the code before the lock'; end if;
end $t8$;

-- T9 a sign-up made after the draft completed is in the pool
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.l'), 'role', 'authenticated')::text, true);
insert into public.season_registrations (season_id, profile_id, position)
  values (current_setting('rh.s2')::uuid, current_setting('rh.l')::uuid, 'C');
reset role;
select set_config('request.jwt.claims', '', true);
do $t7v$
declare v_g1 uuid := current_setting('rh.g1')::uuid; gl public.game_lineups;
begin
  select * into gl from public.game_lineups where game_id = v_g1 and team_id = current_setting('rh.a')::uuid;
  if gl.center is distinct from current_setting('rh.p1')::uuid or gl.lw is distinct from current_setting('rh.p3')::uuid
     or gl.rw is distinct from current_setting('rh.p4')::uuid or gl.goalie is distinct from current_setting('rh.ag1')::uuid then
    raise exception 'T7 failed: A''s G1 sheet does not carry its three guests and three of its own';
  end if;
  select * into gl from public.game_lineups where game_id = v_g1 and team_id = current_setting('rh.b')::uuid;
  if gl.rw is distinct from current_setting('rh.bf3')::uuid then raise exception 'T7 failed: B''s G1 sheet changed after a refused filing'; end if;
  if exists (select 1 from public.game_lineups where game_id = current_setting('rh.g3')::uuid)
     or not exists (select 1 from public.game_lineups where game_id = current_setting('rh.g2')::uuid and team_id = current_setting('rh.a')::uuid)
     or (select num_nonnulls(x.center, x.lw, x.rw, x.ld, x.rd, x.goalie) from public.game_lineups x
          where x.game_id = current_setting('rh.g2')::uuid and x.team_id = current_setting('rh.c')::uuid) is distinct from 5 then
    raise exception 'T7 failed: the G2 and G3 sheets are not as filed (A six, C five, nobody on G3)';
  end if;
  if not exists (select 1 from public.market_pool(current_setting('rh.s2')::uuid) mp where mp.profile_id = current_setting('rh.l')::uuid
                   and mp.source in ('late', 'undrafted'))
     or exists (select 1 from public.roster_spots where season_id = current_setting('rh.s2')::uuid and profile_id = current_setting('rh.l')::uuid) then
    raise exception 'T9 failed: the late sign-up is not in the training camp pool, or was placed on a roster';
  end if;
end $t7v$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t9b$
begin
  perform set_config('rh.q_bl_5', public.market_pool_request(current_setting('rh.g5')::uuid, current_setting('rh.b')::uuid,
                                                             current_setting('rh.l')::uuid)->>'request_id', true);
  perform set_config('rh.q_b6_5', public.market_pool_request(current_setting('rh.g5')::uuid, current_setting('rh.b')::uuid,
                                                             current_setting('rh.p6')::uuid)->>'request_id', true);
  perform set_config('rh.q_b7_5', public.market_pool_request(current_setting('rh.g5')::uuid, current_setting('rh.b')::uuid,
                                                             current_setting('rh.p7')::uuid)->>'request_id', true);
end $t9b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.l'), 'role', 'authenticated')::text, true);
do $t9l$ begin perform public.market_pool_answer(current_setting('rh.q_bl_5')::uuid, true); end $t9l$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p6'), 'role', 'authenticated')::text, true);
do $t9p6$ begin perform public.market_pool_answer(current_setting('rh.q_b6_5')::uuid, true); end $t9p6$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t9s$
begin
  perform public.set_game_lineup(current_setting('rh.g5')::uuid, current_setting('rh.b')::uuid, current_setting('rh.l')::uuid,
    current_setting('rh.p6')::uuid, current_setting('rh.bf1')::uuid, current_setting('rh.bd1')::uuid, current_setting('rh.bd2')::uuid,
    current_setting('rh.bg1')::uuid, false);
end $t9s$;
reset role;
select set_config('request.jwt.claims', '', true);

-- T10 time moves past N1's lock: its three games move onto today, a few minutes out, G3 first (locks passed, pucks not
--     dropped); the requests' game_at move with them (a real move would close them; T14 proves that); and the N1 sheets
--     are stamped as filed an hour ago, before the lock (the rehearsal compresses days into one transaction)
do $t10w$
declare v_g1 uuid := current_setting('rh.g1')::uuid; v_g2 uuid := current_setting('rh.g2')::uuid; v_g3 uuid := current_setting('rh.g3')::uuid;
begin
  update public.games set scheduled_at = now() + interval '4 minutes' where id = v_g3;
  update public.games set scheduled_at = now() + interval '5 minutes' where id = v_g1;
  update public.games set scheduled_at = now() + interval '8 minutes' where id = v_g2;
  update public.market_pool_requests q set game_at = g.scheduled_at from public.games g
   where g.id = q.game_id and q.game_id in (v_g1, v_g2, v_g3);
  update public.game_lineups set updated_at = now() - interval '1 hour' where game_id in (v_g1, v_g2, v_g3);
  perform set_config('rh.g1n', (select count(*) from public.market_pool_requests where game_id = v_g1)::text, true);
end $t10w$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oa'), 'role', 'authenticated')::text, true);
do $t10a$
begin
  perform public.market_pool_request(current_setting('rh.g1')::uuid, current_setting('rh.a')::uuid, current_setting('rh.p6')::uuid);
  raise exception 'T10 failed: a request went through after the lock';
exception when others then
  if sqlerrm not like 'Requests for that night closed at % ET, when the night''s lineups locked.' then raise; end if;
end $t10a$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p2'), 'role', 'authenticated')::text, true);
do $t10p$
begin
  perform public.market_pool_answer(current_setting('rh.q_b2_1')::uuid, true);
  raise exception 'T10 failed: an answer went through after the lock';
exception when others then
  if sqlerrm not like 'Answers for that night closed at % ET, when the night''s lineups locked.' then raise; end if;
end $t10p$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p1'), 'role', 'authenticated')::text, true);
do $t10p1$
begin
  perform public.market_pool_answer(current_setting('rh.q_a1_1')::uuid, false);
  raise exception 'T10 failed: a player withdrew an acceptance after the lock';
exception when others then
  if sqlerrm not like 'Answers for that night closed at % ET, when the night''s lineups locked.' then raise; end if;
end $t10p1$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t10b$
begin
  begin
    perform public.market_pool_withdraw(current_setting('rh.q_b2_1')::uuid);
    raise exception 'T10 failed: a withdrawal went through after the lock';
  exception when others then
    if sqlerrm not like 'Requests can be withdrawn and guests released until % ET, when the night''s lineups lock.' then raise; end if;
  end;
  begin
    perform public.market_pool_withdraw(current_setting('rh.q_b5_1')::uuid);
    raise exception 'T10 failed: a club released its guest after the lock';
  exception when others then
    if sqlerrm not like 'Requests can be withdrawn and guests released until % ET, when the night''s lineups lock.' then raise; end if;
  end;
  begin
    perform public.set_game_lineup(current_setting('rh.g3')::uuid, current_setting('rh.b')::uuid, current_setting('rh.bf1')::uuid,
      current_setting('rh.bf2')::uuid, current_setting('rh.bf3')::uuid, current_setting('rh.bd1')::uuid, current_setting('rh.bd2')::uuid,
      current_setting('rh.bg1')::uuid, false);
    raise exception 'T10 failed: a club filed its first sheet after the lineup deadline';
  exception when others then
    if sqlerrm not like 'The lineup deadline for this game passed at % ET. A club without a full lineup of six by then forfeits the game.' then raise; end if;
  end;
  /* a full six filed before the lock may still change players (Rule 5.3) */
  perform public.set_game_lineup(current_setting('rh.g1')::uuid, current_setting('rh.b')::uuid, current_setting('rh.bf2')::uuid,
    current_setting('rh.bf1')::uuid, current_setting('rh.bf3')::uuid, current_setting('rh.bd1')::uuid, current_setting('rh.bd2')::uuid,
    current_setting('rh.bg1')::uuid, false);
end $t10b$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.oc'), 'role', 'authenticated')::text, true);
do $t10c$
begin
  perform public.set_game_lineup(current_setting('rh.g2')::uuid, current_setting('rh.c')::uuid, current_setting('rh.cf1')::uuid,
    current_setting('rh.cf2')::uuid, current_setting('rh.cf3')::uuid, current_setting('rh.cd1')::uuid, current_setting('rh.cd2')::uuid,
    current_setting('rh.cg1')::uuid, false);
  raise exception 'T10 failed: a club completed a five-player sheet after the lineup deadline';
exception when others then
  if sqlerrm not like 'The lineup deadline for this game passed at % ET. A club without a full lineup of six by then forfeits the game.' then raise; end if;
end $t10c$;
reset role;
select set_config('request.jwt.claims', '', true);

-- T11 the tick
do $t11$
declare v_q0 bigint := coalesce((select max(id) from net.http_request_queue), 0);
        v_scores text := (select value from public.app_config where key = 'discord_scores_webhook');
        v_g1 uuid := current_setting('rh.g1')::uuid; v_g2 uuid := current_setting('rh.g2')::uuid; v_g3 uuid := current_setting('rh.g3')::uuid;
        g public.games; v_code text; v_dm bigint;
begin
  if coalesce(v_scores, '') = '' then raise exception 'T11: no discord_scores_webhook to count the #game-scores posts on'; end if;
  perform public.market_tick();
  if exists (select 1 from public.app_config where key = 'rl_market-tick_result' and (value::jsonb->>'ok') = 'false') then
    raise exception 'T11 failed: the tick recorded a failure: %', (select value from public.app_config where key = 'rl_market-tick_result');
  end if;
  select * into g from public.games where id = v_g2;
  if g.status <> 'final' or g.forfeit_team_id is distinct from current_setting('rh.c')::uuid or coalesce(g.voided, false)
     or g.home_score <> 1 or g.away_score <> 0 then
    raise exception 'T11 failed: C (five players at the lock) did not forfeit G2 1-0: %', to_jsonb(g) - 'game_code';
  end if;
  select * into g from public.games where id = v_g3;
  if g.status <> 'final' or not coalesce(g.voided, false) or g.forfeit_team_id is not null then
    raise exception 'T11 failed: G3 (no sheet from either club) was not voided: %', to_jsonb(g) - 'game_code';
  end if;
  if (select status from public.games where id = v_g1) <> 'scheduled' then raise exception 'T11 failed: G1 was ruled though both clubs set lineups'; end if;
  if (select count(*) from net.http_request_queue q where q.id > v_q0 and q.url = v_scores) <> 2
     or not exists (select 1 from net.http_request_queue q where q.id > v_q0 and q.url = v_scores and convert_from(q.body, 'UTF8') like '%Final (forfeit)%')
     or not exists (select 1 from net.http_request_queue q where q.id > v_q0 and q.url = v_scores and convert_from(q.body, 'UTF8') like '%Voided%') then
    raise exception 'T11 failed: expected exactly one #game-scores post for each ruled game';
  end if;
  if (select count(*) from public.admin_audit a where a.action = 'lineup_deadline_forfeit' and a.target_id in (v_g2::text, v_g3::text)) <> 2 then
    raise exception 'T11 failed: the rulings were not recorded in the audit log';
  end if;
  if (select string_agg(d.outcome || ':' || d.home_set || ':' || d.away_set, ',' order by d.lock_at)
        from public.market_lineup_deadlines d where d.game_id in (v_g1, v_g2, v_g3)) <> 'void:false:false,set:true:true,forfeit:true:false' then
    raise exception 'T11 failed: expected one ruling each, G3 void, G1 set, G2 forfeit: %',
      (select string_agg(d.outcome || ':' || d.home_set || ':' || d.away_set, ',' order by d.lock_at) from public.market_lineup_deadlines d
        where d.game_id in (v_g1, v_g2, v_g3));
  end if;
  /* the night's first game was voided, and the night's lock did not move (it would be G1's otherwise) */
  if public.night_lock_at(v_g1) is distinct from (select x.scheduled_at - interval '30 minutes' from public.games x where x.id = v_g3) then
    raise exception 'T11 failed: voiding the night''s first game moved the night''s lock';
  end if;
  if (select status from public.market_pool_requests where id = current_setting('rh.q_b2_1')::uuid) <> 'lapsed'
     or (select status || ': ' || note from public.market_pool_requests where id = current_setting('rh.q_b7_3')::uuid) <> 'closed: The game is no longer open for lineups.'
     or (select status || ': ' || note from public.market_pool_requests where id = current_setting('rh.q_b5_1')::uuid) <> 'closed: The player is suspended.'
     or (select status from public.market_pool_requests where id = current_setting('rh.q_a1_2')::uuid) <> 'accepted' then
    raise exception 'T11 failed: the requests were not lapsed and closed as expected';
  end if;
  v_code := (select game_code from public.games where id = v_g1);
  if v_code is null then raise exception 'T11: G1 has no lobby code to send'; end if;
  if (select count(*) from public.discord_dms d where d.kind = 'market' and position('lobby code ' || v_code in d.content) > 0) <> 3
     or (select count(distinct d.profile_id) from public.discord_dms d where d.kind = 'market' and position('lobby code ' || v_code in d.content) > 0
           and d.profile_id in (current_setting('rh.p1')::uuid, current_setting('rh.p3')::uuid, current_setting('rh.p4')::uuid)) <> 3
     or (select count(*) from public.market_pool_requests where game_id = v_g1 and status = 'accepted' and code_dm_at is not null) <> 3
     or (select count(distinct n.profile_id) from public.notifications n where n.title = 'Your game code is ready' and n.created_at >= now()
           and n.profile_id in (current_setting('rh.p1')::uuid, current_setting('rh.p3')::uuid, current_setting('rh.p4')::uuid)) <> 3 then
    raise exception 'T11 failed: each of the three guests should get G1''s lobby code by DM and a bell once';
  end if;
  /* a second tick rules nothing again and sends nothing again */
  v_q0 := coalesce((select max(id) from net.http_request_queue), 0);
  v_dm := (select count(*) from public.discord_dms where kind = 'market');
  perform public.market_tick();
  if (select count(*) from net.http_request_queue q where q.id > v_q0 and q.url = v_scores) <> 0
     or (select count(*) from public.discord_dms where kind = 'market') <> v_dm
     or (select count(*) from public.market_lineup_deadlines d where d.game_id in (v_g1, v_g2, v_g3)) <> 3 then
    raise exception 'T11 failed: a second tick posted, ruled or sent a DM again';
  end if;
end $t11$;
-- T11 (after the ruling): B drops below six, the tick does not rule G1 again, and B refills
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t11b$
begin
  perform public.set_game_lineup(current_setting('rh.g1')::uuid, current_setting('rh.b')::uuid, current_setting('rh.bf2')::uuid,
    current_setting('rh.bf1')::uuid, null, current_setting('rh.bd1')::uuid, current_setting('rh.bd2')::uuid,
    current_setting('rh.bg1')::uuid, false);
end $t11b$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t11c$
declare v_g1 uuid := current_setting('rh.g1')::uuid;
begin
  perform public.market_tick();
  if exists (select 1 from public.app_config where key = 'rl_market-tick_result' and (value::jsonb->>'ok') = 'false') then
    raise exception 'T11 failed: the tick recorded a failure: %', (select value from public.app_config where key = 'rl_market-tick_result');
  end if;
  if (select status from public.games where id = v_g1) <> 'scheduled'
     or (select count(*) from public.market_lineup_deadlines d where d.game_id = v_g1) <> 1
     or exists (select 1 from public.admin_audit a where a.action = 'lineup_deadline_forfeit' and a.target_id = v_g1::text) then
    raise exception 'T11 failed: a sheet that dropped below six after the ruling was ruled again';
  end if;
end $t11c$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.ob'), 'role', 'authenticated')::text, true);
do $t11d$
begin
  perform public.set_game_lineup(current_setting('rh.g1')::uuid, current_setting('rh.b')::uuid, current_setting('rh.bf2')::uuid,
    current_setting('rh.bf1')::uuid, current_setting('rh.bf3')::uuid, current_setting('rh.bd1')::uuid, current_setting('rh.bd2')::uuid,
    current_setting('rh.bg1')::uuid, false);   -- a club ruled set may refill (Rule 5.3)
end $t11d$;
reset role;
select set_config('request.jwt.claims', '', true);
-- T11 (a delay within the night, after the lock): G1 keeps its guests and its ruling, and the night's lock stays
do $t11e$
declare v_g1 uuid := current_setting('rh.g1')::uuid;
        v_lock timestamptz := (select x.scheduled_at - interval '30 minutes' from public.games x where x.id = current_setting('rh.g3')::uuid);
begin
  update public.games set scheduled_at = scheduled_at + interval '2 minutes' where id = v_g1;
  perform public.market_tick();
  if exists (select 1 from public.app_config where key = 'rl_market-tick_result' and (value::jsonb->>'ok') = 'false') then
    raise exception 'T11 failed: the tick recorded a failure: %', (select value from public.app_config where key = 'rl_market-tick_result');
  end if;
  if (select q.status from public.market_pool_requests q where q.id = current_setting('rh.q_a1_1')::uuid) <> 'accepted'
     or (select q.game_at from public.market_pool_requests q where q.id = current_setting('rh.q_a1_1')::uuid)
          is distinct from (select x.scheduled_at from public.games x where x.id = v_g1)
     or (select count(*) from public.market_pool_requests q where q.game_id = v_g1 and q.status = 'accepted') <> 3 then
    raise exception 'T11 failed: a game delayed within its night after the lock lost its guests, or their requests kept the old time';
  end if;
  if not exists (select 1 from public.notifications n where n.profile_id = current_setting('rh.p1')::uuid and n.title = 'Your game moved'
                   and n.created_at >= now()) then
    raise exception 'T11 failed: the guest was not told their game moved';
  end if;
  if public.night_lock_at(v_g1) is distinct from v_lock or (select count(*) from public.market_lineup_deadlines d where d.game_id = v_g1) <> 1 then
    raise exception 'T11 failed: the delay moved the night''s lock or ruled G1 again';
  end if;
end $t11e$;

-- T12 after the lock
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p3'), 'role', 'authenticated')::text, true);
do $t12p3$
begin
  if not public.can_see_match(current_setting('rh.g1')::uuid) then raise exception 'T12 failed: the guest cannot see their game''s code after the lock'; end if;
end $t12p3$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p2'), 'role', 'authenticated')::text, true);
do $t12p2$
begin
  if public.can_see_match(current_setting('rh.g1')::uuid) then raise exception 'T12 failed: a player who declined sees the code'; end if;
end $t12p2$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.p1'), 'role', 'authenticated')::text, true);
do $t12p1$
begin
  if public.can_see_match(current_setting('rh.g3')::uuid) then raise exception 'T12 failed: a guest sees the code of a game they did not accept'; end if;
end $t12p1$;
set local role anon;
select set_config('request.jwt.claims', '', true);
do $t12a$
begin
  if (select count(id) from public.market_pool_requests where game_id = current_setting('rh.g1')::uuid)::text <> current_setting('rh.g1n') then
    raise exception 'T12 failed: anon should read every G1 request once the night has locked';
  end if;
  begin
    perform count(requested_by) from public.market_pool_requests;
    raise exception 'T12 failed: anon read who asked';
  exception when others then
    if sqlerrm not like 'permission denied%' then raise; end if;
  end;
end $t12a$;
reset role;

-- T13 G1 is played: box lines, bid eligibility and the pool player's suspension nights; then a reopened deadline forfeit
do $t13$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_g1 uuid := current_setting('rh.g1')::uuid; v_g2 uuid := current_setting('rh.g2')::uuid;
        v_a uuid := current_setting('rh.a')::uuid; v_b uuid := current_setting('rh.b')::uuid; v_s5 uuid := current_setting('rh.susp5')::uuid;
        v_scores text := (select value from public.app_config where key = 'discord_scores_webhook'); v_q0 bigint;
begin
  insert into public.game_stats (game_id, team_id, profile_id, position, is_goalie) values
    (v_g1, v_a, current_setting('rh.p1')::uuid, 'C', false), (v_g1, v_a, current_setting('rh.p3')::uuid, 'LW', false),
    (v_g1, v_a, current_setting('rh.p4')::uuid, 'RW', false), (v_g1, v_a, current_setting('rh.ad1')::uuid, 'LD', false),
    (v_g1, v_a, current_setting('rh.ad2')::uuid, 'RD', false), (v_g1, v_a, current_setting('rh.ag1')::uuid, 'G', true),
    (v_g1, v_b, current_setting('rh.bf2')::uuid, 'C', false), (v_g1, v_b, current_setting('rh.bf1')::uuid, 'LW', false),
    (v_g1, v_b, current_setting('rh.x')::uuid, 'RW', false), (v_g1, v_b, current_setting('rh.bd1')::uuid, 'LD', false),
    (v_g1, v_b, current_setting('rh.bd2')::uuid, 'RD', false), (v_g1, v_b, current_setting('rh.bg1')::uuid, 'G', true);
  update public.games set status = 'final', home_score = 3, away_score = 2 where id = v_g1;
  /* the positive control: X played for B without a request and is the one flag; the three guests raise none */
  if (select count(*) from public.admin_audit a where a.action = 'unrostered_player' and a.target_id = v_g1::text) <> 1
     or not exists (select 1 from public.admin_audit a where a.action = 'unrostered_player' and a.target_id = v_g1::text
                      and a.detail->>'player' = (select coalesce(nullif(p.gamertag, ''), 'a player') from public.profiles p where p.id = current_setting('rh.x')::uuid)) then
    raise exception 'T13 failed: expected exactly one "on no squad" flag on G1, for the unrequested pool player';
  end if;
  if (select mp.gp from public.market_pool(v_s2) mp where mp.profile_id = current_setting('rh.p3')::uuid) is distinct from 1 then
    raise exception 'T13 failed: a guest''s game did not count toward their bid eligibility';
  end if;
  /* P5: suspended for two games, in the pool. G2 went final first (the forfeit in T11), so it carries tonight */
  if (select count(*) from public.suspension_games where suspension_id = v_s5) <> 1
     or (select game_id from public.suspension_games where suspension_id = v_s5) is distinct from v_g2 then
    raise exception 'T13 failed: P5 should serve tonight once, on the first game of the night to go final';
  end if;
  update public.games set status = 'scheduled', home_score = null, away_score = null, forfeit_team_id = null where id = v_g2;
  if (select count(*) from public.suspension_games where suspension_id = v_s5) <> 1
     or (select game_id from public.suspension_games where suspension_id = v_s5) is distinct from v_g1 then
    raise exception 'T13 failed: reopening G2 lost P5''s night instead of moving it to G1';
  end if;
  update public.games set status = 'final', home_score = 1, away_score = 0 where id = current_setting('rh.g4')::uuid;
  if (select count(*) from public.suspension_games where suspension_id = v_s5) <> 2 then
    raise exception 'T13 failed: a game on the next night did not serve P5''s second night';
  end if;
  /* the office reopened G2, a deadline forfeit, past its lock and with C's sheet still short: two ticks leave it reopened */
  v_q0 := coalesce((select max(id) from net.http_request_queue), 0);
  perform public.market_tick();
  perform public.market_tick();
  if (select status from public.games where id = v_g2) <> 'scheduled'
     or (select count(*) from public.admin_audit a where a.action = 'lineup_deadline_forfeit' and a.target_id = v_g2::text) <> 1
     or (select count(*) from public.market_lineup_deadlines d where d.game_id = v_g2) <> 1
     or exists (select 1 from net.http_request_queue q where q.id > v_q0 and q.url = v_scores
                  and convert_from(q.body, 'UTF8') like '%Final (forfeit)%') then
    raise exception 'T13 failed: the tick ruled the reopened G2 again';
  end if;
end $t13$;

-- T14 a guest placed on another club comes off the sheet; one placed on the club's own roster stays; a moved game
--     closes its ask
do $t14$
declare v_s2 uuid := current_setting('rh.s2')::uuid; v_b uuid := current_setting('rh.b')::uuid; v_c uuid := current_setting('rh.c')::uuid;
        v_p6 uuid := current_setting('rh.p6')::uuid; v_l uuid := current_setting('rh.l')::uuid; v_g5 uuid := current_setting('rh.g5')::uuid;
        gl public.game_lineups;
begin
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
    values (v_s2, v_c, v_p6, public._market_jersey(v_s2, v_c),
            (select r.position from public.season_registrations r where r.season_id = v_s2 and r.profile_id = v_p6), 750000, 'draft');
  perform public.market_tick();
  if exists (select 1 from public.app_config where key = 'rl_market-tick_result' and (value::jsonb->>'ok') = 'false') then
    raise exception 'T14 failed: the tick recorded a failure: %', (select value from public.app_config where key = 'rl_market-tick_result');
  end if;
  if (select status || ': ' || note from public.market_pool_requests where id = current_setting('rh.q_b6_5')::uuid)
       <> 'closed: The player is no longer in the training camp pool.'
     or (select status from public.market_pool_requests where id = current_setting('rh.q_bl_5')::uuid) <> 'accepted' then
    raise exception 'T14 failed: the rostered player''s ask did not close, or another closed with it';
  end if;
  select * into gl from public.game_lineups where game_id = v_g5 and team_id = v_b;
  if gl.lw is not null or gl.center is distinct from v_l or gl.goalie is distinct from current_setting('rh.bg1')::uuid then
    raise exception 'T14 failed: P6 did not come off B''s G5 sheet, or more than P6 did';
  end if;
  if not exists (select 1 from public.notifications n where n.profile_id = current_setting('rh.ob')::uuid and n.title = 'A training camp request closed'
                   and n.body like '%came off that game''s lineup, so refile it.' and n.created_at >= now()) then
    raise exception 'T14 failed: B was not told to refile';
  end if;
  /* the control: L, placed on B's own roster, loses the ask and stays on B's sheet as B's own player */
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
    values (v_s2, v_b, v_l, public._market_jersey(v_s2, v_b), 'C', 750000, 'draft');
  perform public.market_tick();
  if exists (select 1 from public.app_config where key = 'rl_market-tick_result' and (value::jsonb->>'ok') = 'false') then
    raise exception 'T14 failed: the tick recorded a failure: %', (select value from public.app_config where key = 'rl_market-tick_result');
  end if;
  select * into gl from public.game_lineups where game_id = v_g5 and team_id = v_b;
  if (select status || ': ' || note from public.market_pool_requests where id = current_setting('rh.q_bl_5')::uuid)
       <> 'closed: The player is no longer in the training camp pool.' or gl.center is distinct from v_l then
    raise exception 'T14 failed: L, now on B''s own roster, kept the ask or came off B''s sheet';
  end if;
  update public.games set scheduled_at = scheduled_at + interval '1 hour' where id = v_g5;
  perform public.market_tick();
  if exists (select 1 from public.app_config where key = 'rl_market-tick_result' and (value::jsonb->>'ok') = 'false') then
    raise exception 'T14 failed: the tick recorded a failure: %', (select value from public.app_config where key = 'rl_market-tick_result');
  end if;
  if (select status || ': ' || note from public.market_pool_requests where id = current_setting('rh.q_b7_5')::uuid)
       <> 'closed: The game was moved, so the request closed. The club may ask again until that night''s lineups lock.' then
    raise exception 'T14 failed: a moved game did not close its ask';
  end if;
end $t14$;

-- T15 Season 1, and the verdict
do $v$
declare s1_rules constant jsonb := '{"flex": null, "lines": null, "quota": {"D": 5, "F": 7, "G": 3}, "weeks": 6, "format": "basic", "rights": false, "camp_max": 10, "cap_camp": 3, "fa_window": false, "preseason": false, "cap_goalie": 6, "cap_skater": 6, "extensions": false, "roster_max": 15, "salary_cap": 50000000, "series_cap": 4, "draft_snake": true, "pick_trades": false, "draft_rounds": 12, "min_service_gp": 0, "playoff_min_gp": 14, "playoff_best_of": 7, "playoff_per_div": 3, "max_contract_years": 1, "trade_deadline_week": 4}'::jsonb;
begin
  if public.season_rules((select id from public.seasons where number = 1)) <> s1_rules
     or public.market_on((select id from public.seasons where number = 1)) then
    raise exception 'T15 failed: Season 1''s rules changed';
  end if;
  raise exception 'REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15';
end $v$;
