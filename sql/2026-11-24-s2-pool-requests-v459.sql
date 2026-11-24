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
