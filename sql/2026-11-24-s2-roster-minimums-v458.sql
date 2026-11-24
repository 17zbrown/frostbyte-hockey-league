-- v4.58 (2026-12-03): Season 2 roster minimums. From the draft on, a club keeps at least 3 forwards, 2 defensemen and
-- 1 goaltender. A club cannot move itself further under a minimum; a club put under one when a player leaves its roster
-- by an act it did not make (a ban, a season suspension, a Discord departure, a sign-up withdrawn by the office, an
-- office or commissioner removal) gets a random training camp player of that group at $750K, until the movement
-- deadline; after it, nightly training camp requests cover the gap. A trade, whoever accepts or reverses it, and a
-- position change never owe that draw.
--
-- Rulings this builds (league law, quoted from the commissioner):
--   2026-11-23: minimums 3 F / 2 D / 1 G ("do 3 forwards, 2 defensemen, and 1 goalie"), no maximums.
--   2026-11-23 (evening, market package, recommended defaults accepted): an involuntary shortfall is a RANDOM DRAW of a
--     pool player of that group at $750K; no placement after the deadline, nightly requests cover it.
--   Season 2 format (2026-10-12): "If a club drops below involuntarily (ban, Discord departure, suspension removal)" the
--     club is made whole from the pool, to season's end (examples, not a closed list).
--   Main session, 2026-11-23 (review of this record): any removal the club did not make itself owes the random shortfall
--     draw: a ban, a season-long suspension, a Discord departure, a sign-up withdrawn by the office, or an office or
--     commissioner removal. A club's own waive, trade or release never does.
--   Main session, 2026-11-23 (second review, D-INVOLUNTARY refined): "the random shortfall draw is owed ONLY when a
--     player LEAVES the club's roster by an act the club did not make: a ban, a season-long suspension removal, a Discord
--     departure, a sign-up withdrawn by the office, or an office or commissioner removal of that player. A trade (whoever
--     accepts or processes it) and a position change NEVER owe a draw." (The first round drew for a commissioner-accepted
--     trade and for a staff position change, so a club the office left short by a trade was handed a random player.)
--
-- What changes (every Season 2 branch tests public.market_on(season); Season 1 paths are unchanged):
--   1. public.check_roster_minimums (new) and the deferred constraint trigger check_roster_minimums_trg on roster_spots
--      (AFTER DELETE OR UPDATE OF team_id, position, squad, status). It judges the club as it stands at commit, through
--      roster_min_gap (the ONE 3/2/1 definition), for market seasons whose draft is complete:
--        a club's own move (a signed-in seat holder of either club, not a commissioner, not the service role) that
--          leaves a group further under its minimum than before the move and than the league already owes it is refused
--          (_market_min_breach, the sentence waive_player uses; a trade hands over the clubs' gaps from before its moves
--          in the transaction setting app.min_gap_before, so a like-for-like swap by a club already short passes);
--        a position change (the spot stays active on the same club, whatever group it now fills) is no departure: no
--          draw and no refusal (the office makes it);
--        a trade or a trade reversal by the office (accept_trade and reverse_trade mark the transaction with
--          app.trade_move, kept to commit) owes nothing;
--        every other departure (a ban, a season suspension, a Discord departure, a withdrawn sign-up, a commissioner's
--          removal, a pick reversal, an office waiver, a seat move to another club, anything the service role or cron
--          does) owes the club one draw per missing player of the group (replacement_signings with pos_group), tells the
--          staff channel and the club's seats (never the club room); after the movement deadline it only tells the seats
--          to use nightly requests. The reason in those notices comes from the removal archive (the deleting doors reset
--          app.roster_reason before commit, so the deferred trigger cannot read it there).
--   2. public._market_draw_shortfalls, a market_tick step: each open owed draw, oldest first, takes the club lock first
--      (trying once; a club whose lock a claim, waiver or trade holds is retried on the next tick), then either lapses
--      (the club is back at the minimum, or the deadline passed) or places a random unsuspended pool player of the group
--      who is still in the Discord (random(), server side) at the opening price (season_rules mk.bid_open, $750K), origin
--      'market_placed', a contract to the end of the season. A draw that cannot be made (no player of the group, no
--      spot, no cap room) alerts the staff channel and the commissioners once and retries every tick.
--   3. public._grant_replacement returns at once in a market season: there is no free-agent signing to allow.
--   4. public.accept_trade: in a market season, once the draft is complete, it takes both clubs' locks (in id order),
--      marks the transaction as a trade (app.trade_move) and reads both clubs' gaps before any player moves; a trade that
--      leaves either club with a group shorter than before it and than the draws owed is refused before the cap checks
--      (the office is not bound, standing ruling 2026-10-21; the trigger is the backstop and judges against the same gaps).
--   5. public._place_trade_arrivals: in a market season an arrival with no active place refuses the trade in Season 2
--      words (no training camps), instead of "training camp is full (0 players)".
--   6. public.reverse_trade (the office's door): in a market season, once the draft is complete, it takes both clubs'
--      locks (in id order) and marks the transaction as a trade before anyone moves back, so a reversal that leaves a club
--      short owes no draw (D-INVOLUNTARY refined) and the shortfall draw never reads a roster the reversal is changing.
--
-- Doors only: transactions ('placed', posted to #transactions by notify_discord_transaction), notify_roster_add (club
-- notice, worded by the waivers record), club_notify with p_room false (seat notifications), notify_staff_ch (the staff
-- channel; it falls back to discord_staff_webhook until the single staff channel lands), notify_commissioners, and the DM
-- lane. A rehearsal sends nothing: pg_net and the discord_dms rows roll back.
--
-- Requires: the Season 2 waivers record applied: _market_min_breach (with the p_before baseline), _market_jersey,
-- _market_dm, _market_club_lock (with p_wait), market_pool, the replacement_signings shortfall columns and market_tick's
-- "steps end" line; db-guards' 'market_placed' origin.
-- When: rehearse and apply right after the waivers record, before the Sat Dec 5 seating (main session ruling,
-- 2026-11-23): the rehearsal builds its clubs on an empty Season 2.
-- Rehearsal: sql/2026-11-24-s2-roster-minimums-v458.rehearsal.sql (main session). Results are recorded at the end.

-- 0. preconditions
do $pre$
begin
  if to_regprocedure('public._market_min_breach(uuid,uuid,uuid,text,jsonb)') is null or to_regprocedure('public.market_pool(uuid)') is null
     or to_regprocedure('public._market_club_lock(uuid,boolean)') is null or to_regclass('public.market_waivers') is null then
    raise exception 'v4.58 minimums: the Season 2 waivers record must be applied first';
  end if;
  if position('    -- market-tick steps end' in pg_get_functiondef('public.market_tick()'::regprocedure)) = 0 then
    raise exception 'v4.58 minimums: market_tick has no steps end line';
  end if;
  if position('''market_placed''' in (select pg_get_constraintdef(oid) from pg_constraint
                                       where conrelid = 'public.roster_spots'::regclass and conname = 'roster_spots_origin_check')) = 0 then
    raise exception 'v4.58 minimums: roster_spots_origin_check does not accept market_placed yet (db-guards)';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.roster_spots'::regclass and tgname = 'check_roster_minimums_trg') then
    raise exception 'v4.58 minimums: check_roster_minimums_trg already exists';
  end if;
  /* the draw fires this one deferred check inside its own block, by name */
  if not exists (select 1 from pg_constraint where conrelid = 'public.roster_spots'::regclass and conname = 'check_roster_structure_trg'
                   and condeferrable) then
    raise exception 'v4.58 minimums: the deferred check_roster_structure_trg on roster_spots is missing';
  end if;
end $pre$;

-- 1. the minimums trigger
create or replace function public.check_roster_minimums()
returns trigger language plpgsql security definer set search_path to '' as $f$
/* v4.58 (commissioner, 2026-11-23: "do 3 forwards, 2 defensemen, and 1 goalie"; the involuntary shortfall is a random draw
   at $750K, and after the deadline nightly requests cover it). Deferred to commit, so a trade's moves are judged together
   and the club is judged as it stands. A deferred event carries the row as one statement left it (the v3.72 trap): an
   update whose row still fills the same group on the same club is not a departure.
   Main session, 2026-11-23 (review): any removal the club did not make itself owes the draw; only a club's own move is
   refused. The first draft drew only for four archived reasons, so a commissioner's removal of an inactive goaltender
   left the club at 0 G with nothing owed.
   Main session, 2026-11-23 (second review, D-INVOLUNTARY refined): the draw is owed only when a player LEAVES the roster
   by an act the club did not make. "A trade (whoever accepts or processes it) and a position change NEVER owe a draw." */
declare v_season uuid := old.season_id; v_team uuid := old.team_id; v_grp text := public.pos_group(old.position);
        v_cur public.roster_spots; v_reason text; v_kind text; v_gap jsonb; v_short int; v_owed int; v_why text;
        v_club text; v_name text; v_min int; v_words text; v_future boolean; v_price bigint; v_trade boolean := false;
begin
  if old.status <> 'active' then return null; end if;
  if not public.market_on(v_season) or not public._market_draft_done(v_season) then return null; end if;
  if tg_op = 'UPDATE' then
    select rs.* into v_cur from public.roster_spots rs where rs.id = old.id;
    /* v4.58 (D-INVOLUNTARY refined): a spot still active on the same club has not left the roster. That includes a
       position change, whatever group it now fills: it never owes a draw, and it is the office's act, never a club's. */
    if v_cur.id is not null and v_cur.team_id = v_team and v_cur.season_id = v_season and v_cur.status = 'active' then
      return null;
    end if;
    /* a move to another club inside a trade or its reversal (both mark the transaction, kept to commit) */
    v_trade := v_cur.id is not null and v_cur.team_id is distinct from v_team
               and coalesce(current_setting('app.trade_move', true), '') = 'on';
  end if;
  if not exists (select 1 from public.teams t where t.id = v_team) then return null; end if;   -- the club itself is being removed
  v_gap := public.roster_min_gap(v_season, v_team, null, null);
  v_short := coalesce((v_gap->>v_grp)::int, 0);
  if v_short <= 0 then return null; end if;

  /* why the player left: the removal archive holds the reason the deleting door set (app.roster_reason) at delete time */
  if tg_op = 'DELETE' then
    select r.reason into v_reason from public.roster_spot_removals r where r.spot_id = old.id order by r.removed_at desc limit 1;
  else
    v_reason := case when v_cur.id is null then 'removed'
                     when v_trade then 'traded'
                     when v_cur.team_id is distinct from v_team then 'moved to another club'
                     else 'status changed' end;
  end if;
  /* a club's own move: a signed-in seat holder of either club, not a commissioner, not the service role. Everything
     else (the office, a commissioner, the service role, cron, a staffer's door) is a removal the club did not make. */
  v_kind := case
    when auth.uid() is not null and not public.is_commissioner()
         and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') <> 'service_role'
         and (public.is_gm_of(v_team) or (v_cur.id is not null and public.is_gm_of(v_cur.team_id))) then 'club'
    else 'draw' end;

  if v_kind = 'club' then
    /* accept_trade leaves the clubs' gaps from before its moves in app.min_gap_before (transaction-local, kept to
       commit), so a swap that leaves the group no shorter than it was passes here as it passed there */
    v_why := public._market_min_breach(v_season, v_team, null, v_grp,
                                       (nullif(current_setting('app.min_gap_before', true), '')::jsonb) -> (v_team::text));
    if v_why is not null then raise exception '%', v_why using errcode = 'check_violation', hint = 'below_minimum'; end if;
    return null;
  end if;
  /* v4.58 (D-INVOLUNTARY refined): a trade the office accepted or reversed leaves the club short with nothing owed; the
     club fills the gap by a claim or at Saturday bidding */
  if v_trade then return null; end if;

  select count(*) into v_owed from public.replacement_signings x
   where x.season_id = v_season and x.team_id = v_team and x.pos_group = v_grp and x.used_at is null;
  if v_owed >= v_short then return null; end if;
  select t.name into v_club from public.teams t where t.id = v_team;
  select coalesce(nullif(p.gamertag, ''), 'A player') into v_name from public.profiles p where p.id = old.profile_id;
  v_min := (public.season_rules(v_season)->'quota_min'->>v_grp)::int;
  v_price := (public.season_rules(v_season)->'mk'->>'bid_open')::bigint;
  if v_min is null or v_price is null then
    raise exception 'The Season 2 rules carry no minimum or opening price (season_rules quota_min, mk.bid_open).';
  end if;
  v_words := public._market_group_word(v_grp, v_min - v_short) || ' of the ' || v_min || ' required';

  if public.moves_locked(v_season) then
    v_future := exists (select 1 from public.games g where g.season_id = v_season and coalesce(g.stage, 'regular') = 'regular'
                          and not coalesce(g.voided, false) and g.status <> 'final' and g.scheduled_at > now()
                          and v_team in (g.home_team_id, g.away_team_id));
    perform public.club_notify(v_team, 'roster', 'Below the Season 2 roster minimum',
      v_name || ' left the roster (' || coalesce(v_reason, 'removed') || '), so the club has ' || v_words || '. The movement deadline has passed, so the league office draws no replacement. '
      || case when v_future then 'Cover the gap with a nightly training camp request for each game night.'
              else 'Training camp players do not play in the playoffs.' end,
      null, 'manager', null, null, false);
    return null;
  end if;

  insert into public.replacement_signings (season_id, team_id, departed_profile_id, reason, pos_group)
    values (v_season, v_team, old.profile_id, coalesce(v_reason, 'removed'), v_grp);
  perform public.notify_staff_ch(null, '**' || v_club || '** is under a Season 2 roster minimum (' || v_words || ') after '
    || v_name || ' left (' || coalesce(v_reason, 'removed') || '). A ' || case v_grp when 'F' then 'forward' when 'D' then 'defenseman' else 'goaltender' end
    || ' is being drawn at random from the training camp pool at ' || public._money(v_price) || '.');
  perform public.club_notify(v_team, 'roster', 'A replacement is being drawn',
    v_name || ' left the roster (' || coalesce(v_reason, 'removed') || '), so the club has ' || v_words || '. A training camp player of that group is drawn at random and joins at '
    || public._money(v_price) || ' to the end of the season.',
    null, 'manager', null, null, false);
  return null;
end $f$;

create constraint trigger check_roster_minimums_trg
  after delete or update of team_id, position, squad, status on public.roster_spots
  deferrable initially deferred
  for each row execute function public.check_roster_minimums();

-- 2. the draw, a market_tick step
create or replace function public._market_draw_shortfalls(p_season uuid)
returns int language plpgsql volatile security definer set search_path to '' as $f$
/* v4.58 (commissioner, 2026-11-23: an involuntary shortfall is a RANDOM DRAW of a pool player of that group at $750K; no
   placement after the deadline). Each open owed draw, oldest first, SKIP LOCKED. A draw that cannot be made is told to the
   staff channel and the commissioners once (alerted_at) and retried every tick; it is never dropped silently.
   Review, 2026-11-23: the club lock comes BEFORE the roster is read, so a claim, waiver or trade holding it is seen
   committed and never answered with a second, unwanted player from a stale gap. */
declare r record; v_n int := 0; v_price bigint; v_gap jsonb; v_short int; v_open int; v_pick record; v_jersey int;
        v_club text; v_name text; v_clean text; v_word text; v_err text; v_reg int;
begin
  v_price := (public.season_rules(p_season)->'mk'->>'bid_open')::bigint;
  if v_price is null then raise exception 'The Season 2 rules carry no opening price (season_rules mk.bid_open).'; end if;
  for r in
    select x.* from public.replacement_signings x
     where x.season_id = p_season and x.pos_group is not null and x.used_at is null
     order by x.created_at for update skip locked
  loop
    select t.name into v_club from public.teams t where t.id = r.team_id;
    v_word := case r.pos_group when 'F' then 'forward' when 'D' then 'defenseman' else 'goaltender' end;
    if public.moves_locked(p_season) then
      update public.replacement_signings set used_at = clock_timestamp(),
             lapsed_why = 'The movement deadline passed before a player was drawn; nightly training camp requests cover the gap.'
       where id = r.id;
      perform public.club_notify(r.team_id, 'roster', 'No replacement after the deadline',
        'The movement deadline passed before a ' || v_word || ' could be drawn for the club, so the league office draws none. Cover the gap with a nightly training camp request for each game night.',
        null, 'manager', null, null, false);
      continue;
    end if;
    /* try once: a club whose lock is held is retried on the next tick, so the tick never waits while holding another
       club's lock (a trade takes two, in id order) */
    continue when not public._market_club_lock(r.team_id, false);
    v_gap := public.roster_min_gap(p_season, r.team_id, null, null);
    v_short := coalesce((v_gap->>r.pos_group)::int, 0);
    select count(*) into v_open from public.replacement_signings x
     where x.season_id = p_season and x.team_id = r.team_id and x.pos_group = r.pos_group and x.used_at is null;
    if v_short < v_open then
      update public.replacement_signings set used_at = clock_timestamp(), lapsed_why = 'The club is back at the minimum.' where id = r.id;
      continue;
    end if;
    begin
      if coalesce((v_gap->>'open')::int, 0) <= 0 then raise exception 'the club has no open roster spot'; end if;
      if not public.cap_has_room(p_season, r.team_id, v_price) then raise exception 'the club has no cap room for %', public._money(v_price); end if;
      /* a member out of the Discord is left out, read the way sweep_roster_departures reads it: that sweep would take
         them off the roster a day later, and the removal would owe a second draw */
      select mp.profile_id, mp.position into v_pick from public.market_pool(p_season) mp join public.profiles p on p.id = mp.profile_id
       where mp.pos_group = r.pos_group and not mp.suspended
         and not (p.in_guild is false and not exists (select 1 from public.guild_members g where g.profile_id = p.id and g.present))
       order by random() limit 1;
      if v_pick.profile_id is null then raise exception 'the training camp pool has no % to draw', v_word; end if;
      v_jersey := public._market_jersey(p_season, r.team_id);
      insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin, squad)
        values (p_season, r.team_id, v_pick.profile_id, v_jersey, v_pick.position, v_price, 'market_placed', 'pro');
      /* the deferred roster check fires inside this draw's own block, by name: 'all' would also fire (and blame on the
         draw) events other tick steps queued */
      execute 'set constraints public.check_roster_structure_trg immediate';
      execute 'set constraints public.check_roster_structure_trg deferred';
      update public.replacement_signings set used_at = clock_timestamp(),
             used_registration_id = (select sr.id from public.season_registrations sr where sr.season_id = p_season and sr.profile_id = v_pick.profile_id)
       where id = r.id;
      perform set_config('app.role_grant', 'on', true);
      update public.season_registrations set status = 'assigned' where season_id = p_season and profile_id = v_pick.profile_id;
      get diagnostics v_reg = row_count;
      perform set_config('app.role_grant', '', true);
      if v_reg <> 1 then raise exception 'the drawn player has no sign-up to mark assigned'; end if;
      select coalesce(nullif(p.gamertag, ''), p.display_name, 'a player') into v_name from public.profiles p where p.id = v_pick.profile_id;
      v_clean := replace(replace(v_name, '<', ''), '>', '');
      insert into public.transactions (season_id, type, description)
        values (p_season, 'placed', v_club || ' received <b>' || v_clean || '</b>, drawn at random from the training camp pool at '
                || public._money(v_price) || ' to restore the Season 2 roster minimum.');
      perform public._market_dm(v_pick.profile_id, 'You were drawn at random from the training camp pool and placed on the ' || v_club
        || ' at ' || public._money(v_price) || ', on a contract to the end of the season.');
      v_n := v_n + 1;
    exception when others then
      v_err := sqlerrm;
      execute 'set constraints public.check_roster_structure_trg deferred';
      if r.alerted_at is null then
        update public.replacement_signings set alerted_at = clock_timestamp() where id = r.id;
        perform public.notify_staff_ch(null, 'The Season 2 shortfall draw for the **' || v_club || '** (a ' || v_word || ') could not be made: '
          || v_err || '. It retries every 10 seconds; place a player by hand if it cannot be made.');
        perform public.notify_commissioners(null, 'flag', 'Shortfall draw blocked: ' || v_club,
          'The random draw of a ' || v_word || ' for the ' || v_club || ' could not be made: ' || v_err || '. It retries every 10 seconds.', 'automations', null);
      end if;
    end;
  end loop;
  return v_n;
end $f$;

do $tick$
declare v_def text := pg_get_functiondef('public.market_tick()'::regprocedure);
        a text := $a$    -- market-tick steps end
$a$;
        b text := $b$    begin
      perform public._market_draw_shortfalls(v_season);   -- v4.58: Season 2 shortfall draws
    exception when others then
      v_errors := v_errors || ('shortfall draw: ' || sqlerrm);
    end;
$b$ || a;
        n int;
begin
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 minimums: the market_tick anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $tick$;

do $grants$
begin
  revoke all on function public.check_roster_minimums() from public, anon, authenticated;
  revoke all on function public._market_draw_shortfalls(uuid) from public, anon, authenticated;
end $grants$;

-- 3, 4, 5, 6. patches by exact anchor
do $p$
declare v_def text; a text; b text; n int;
begin
  v_def := pg_get_functiondef('public._grant_replacement(uuid,uuid,uuid,text)'::regprocedure);
  a := $a$  if p_team is null or not public.fa_moves_closed(p_season) then return; end if;$a$;
  b := $b$  /* v4.58: a Season 2 club never signs a replacement; a club put under a minimum gets a random draw instead
     (public.check_roster_minimums) */
  if public.market_on(p_season) then return; end if;
$b$ || a;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 minimums: the _grant_replacement anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);

  v_def := pg_get_functiondef('public.accept_trade(uuid)'::regprocedure);
  a := $a$  foreach pid in array t.offered_profile_ids loop perform public.move_player(pid, t.season_id, t.to_team_id); end loop;
$a$;
  b := $b$  /* v4.58 (review, 2026-11-23): in a market season, once the draft is complete, both clubs' locks in id order (a claim,
     a waiver and the shortfall draw take the same lock, so none of them reads a roster this trade is changing), then
     both clubs' 3/2/1 gaps before anyone moves. The gaps stay in app.min_gap_before to commit, for the check after the
     moves and for check_roster_minimums. */
  if public.market_on(t.season_id) and public._market_draft_done(t.season_id) then
    perform public._market_club_lock(least(t.from_team_id, t.to_team_id));
    perform public._market_club_lock(greatest(t.from_team_id, t.to_team_id));
    perform set_config('app.trade_move', 'on', true);   -- v4.58 (D-INVOLUNTARY refined): a trade never owes a shortfall draw
    perform set_config('app.min_gap_before', jsonb_build_object(
      t.from_team_id::text, public.roster_min_gap(t.season_id, t.from_team_id, null, null),
      t.to_team_id::text, public.roster_min_gap(t.season_id, t.to_team_id, null, null))::text, true);
  end if;
$b$ || a;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 minimums: the accept_trade gap anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);
  a := $a$  perform public._place_trade_arrivals(t.season_id, t.from_team_id, t.requested_profile_ids, v_from_act,
                                       coalesce(cardinality(t.offered_profile_ids), 0));
$a$;
  b := a || $b$  /* v4.58 (commissioner, 2026-11-23: "do 3 forwards, 2 defensemen, and 1 goalie"): in a market season a club may not
     trade itself further under a minimum: a group may not end shorter than it was before the trade and than the draws
     the league already owes (review, 2026-11-23: a club already short with nothing owed may still swap like for like).
     Checked here, after every move and before the cap, so the clubs read why; the deferred check_roster_minimums is the
     backstop at commit. Not before the draft is complete, when every club is short. The office is not bound by a club
     bar (standing ruling 2026-10-21). */
  if public.market_on(t.season_id) and public._market_draft_done(t.season_id) and not public.is_commissioner() then
    declare v_why text; v_before jsonb := nullif(current_setting('app.min_gap_before', true), '')::jsonb;
    begin
      v_why := coalesce(public._market_min_breach(t.season_id, t.from_team_id, null, null, v_before -> (t.from_team_id::text)),
                        public._market_min_breach(t.season_id, t.to_team_id, null, null, v_before -> (t.to_team_id::text)));
      if v_why is not null then raise exception '%', v_why using errcode = 'check_violation', hint = 'below_minimum'; end if;
    end;
  end if;
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 minimums: the accept_trade anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);

  v_def := pg_get_functiondef('public._place_trade_arrivals(uuid,uuid,uuid[],text[],integer)'::regprocedure);
  a := $a$  if v_camp + v_n > v_campmax then
$a$;
  b := $b$  /* v4.58: Season 2 has no club training camps, so an arrival with no active place leaves the club over its roster */
  if public.market_on(p_season) then
    select name into v_club from public.teams where id = p_team;
    raise exception 'Season 2 rosters: this trade would leave the % with % players, over the %-player roster. Season 2 has no training camps, so nothing was traded: that club must make room first.',
      coalesce(v_club, 'receiving club'), f + d + g + v_n, v_max using errcode = 'check_violation', hint = 'no_spot';
  end if;
$b$ || a;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 minimums: the _place_trade_arrivals anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);

  v_def := pg_get_functiondef('public.reverse_trade(uuid,text)'::regprocedure);
  a := $a$  foreach pid in array coalesce(t.offered_profile_ids, '{}'::uuid[]) loop
$a$;
  b := $b$  /* v4.58 (D-INVOLUNTARY refined, main session 2026-11-23: "A trade (whoever accepts or processes it) and a position
     change NEVER owe a draw"): in a market season, once the draft is complete, both clubs' locks in id order (as
     accept_trade takes them, so the shortfall draw never reads a roster this reversal is changing), and the transaction
     is marked as a trade, so check_roster_minimums owes no draw for a club the reversal leaves short */
  if public.market_on(t.season_id) and public._market_draft_done(t.season_id) then
    perform public._market_club_lock(least(t.from_team_id, t.to_team_id));
    perform public._market_club_lock(greatest(t.from_team_id, t.to_team_id));
    perform set_config('app.trade_move', 'on', true);
  end if;
$b$ || a;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.58 minimums: the reverse_trade anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $p$;

-- 6. self-checks
do $chk$
declare f text;
  s1_rules constant jsonb := '{"flex": null, "lines": null, "quota": {"D": 5, "F": 7, "G": 3}, "weeks": 6, "format": "basic", "rights": false, "camp_max": 10, "cap_camp": 3, "fa_window": false, "preseason": false, "cap_goalie": 6, "cap_skater": 6, "extensions": false, "roster_max": 15, "salary_cap": 50000000, "series_cap": 4, "draft_snake": true, "pick_trades": false, "draft_rounds": 12, "min_service_gp": 0, "playoff_min_gp": 14, "playoff_best_of": 7, "playoff_per_div": 3, "max_contract_years": 1, "trade_deadline_week": 4}'::jsonb;
begin
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.roster_spots'::regclass and t.tgname = 'check_roster_minimums_trg'
                   and t.tgdeferrable and t.tginitdeferred and t.tgfoid = 'public.check_roster_minimums()'::regprocedure) then
    raise exception 'v4.58 minimums: check_roster_minimums_trg must be a deferred constraint trigger on roster_spots';
  end if;
  if position('AFTER DELETE OR UPDATE OF team_id, "position", squad, status' in
              (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid = 'public.roster_spots'::regclass and t.tgname = 'check_roster_minimums_trg')) = 0 then
    raise exception 'v4.58 minimums: the trigger must fire on delete and on team, position, squad or status updates';
  end if;
  foreach f in array array['public.check_roster_minimums()', 'public._market_draw_shortfalls(uuid)'] loop
    if not (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, '{}')) from pg_proc p where p.oid = f::regprocedure) then
      raise exception 'v4.58 minimums: % must be SECURITY DEFINER with search_path ''''', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'v4.58 minimums: an API role can execute %', f;
    end if;
  end loop;
  if position('perform public._market_draw_shortfalls(v_season);' in pg_get_functiondef('public.market_tick()'::regprocedure)) = 0
     or position('perform public._market_draw_shortfalls(v_season);' in pg_get_functiondef('public.market_tick()'::regprocedure))
        > position('    -- market-tick steps end' in pg_get_functiondef('public.market_tick()'::regprocedure)) then
    raise exception 'v4.58 minimums: market_tick does not run the shortfall draw above the steps end line';
  end if;
  if position('continue when not public._market_club_lock(r.team_id, false);' in pg_get_functiondef('public._market_draw_shortfalls(uuid)'::regprocedure)) = 0
     or position('continue when not public._market_club_lock(r.team_id, false);' in pg_get_functiondef('public._market_draw_shortfalls(uuid)'::regprocedure))
        > position('v_gap := public.roster_min_gap(p_season, r.team_id' in pg_get_functiondef('public._market_draw_shortfalls(uuid)'::regprocedure)) then
    raise exception 'v4.58 minimums: the shortfall draw must take the club lock before it reads the roster';
  end if;
  if position('if public.market_on(p_season) then return; end if;' in pg_get_functiondef('public._grant_replacement(uuid,uuid,uuid,text)'::regprocedure)) = 0 then
    raise exception 'v4.58 minimums: _grant_replacement still grants in market seasons';
  end if;
  if position('public._market_min_breach(t.season_id, t.from_team_id, null, null, v_before' in pg_get_functiondef('public.accept_trade(uuid)'::regprocedure)) = 0
     or position('perform set_config(''app.min_gap_before''' in pg_get_functiondef('public.accept_trade(uuid)'::regprocedure))
        > position('foreach pid in array t.offered_profile_ids loop perform public.move_player(' in pg_get_functiondef('public.accept_trade(uuid)'::regprocedure))
     or position('perform set_config(''app.min_gap_before''' in pg_get_functiondef('public.accept_trade(uuid)'::regprocedure)) = 0 then
    raise exception 'v4.58 minimums: accept_trade does not read the gaps before its moves and check the minimums after them';
  end if;
  if position('Season 2 rosters: this trade would leave the %' in pg_get_functiondef('public._place_trade_arrivals(uuid,uuid,uuid[],text[],integer)'::regprocedure)) = 0 then
    raise exception 'v4.58 minimums: _place_trade_arrivals has no Season 2 branch';
  end if;
  /* a trade and its reversal mark the transaction before anyone moves, so the trigger owes no draw for either */
  if position('perform set_config(''app.trade_move'', ''on'', true);' in pg_get_functiondef('public.accept_trade(uuid)'::regprocedure)) = 0
     or position('perform set_config(''app.trade_move'', ''on'', true);' in pg_get_functiondef('public.accept_trade(uuid)'::regprocedure))
        > position('foreach pid in array t.offered_profile_ids loop perform public.move_player(' in pg_get_functiondef('public.accept_trade(uuid)'::regprocedure))
     or position('perform set_config(''app.trade_move'', ''on'', true);' in pg_get_functiondef('public.reverse_trade(uuid,text)'::regprocedure)) = 0
     or position('perform set_config(''app.trade_move'', ''on'', true);' in pg_get_functiondef('public.reverse_trade(uuid,text)'::regprocedure))
        > position('perform public.move_player(pid, t.season_id, t.from_team_id);' in pg_get_functiondef('public.reverse_trade(uuid,text)'::regprocedure))
     or position('coalesce(current_setting(''app.trade_move'', true), '''') = ''on''' in pg_get_functiondef('public.check_roster_minimums()'::regprocedure)) = 0 then
    raise exception 'v4.58 minimums: a trade or its reversal does not mark the transaction before its moves, or the trigger does not read the mark';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('accept_trade', '_place_trade_arrivals', '_grant_replacement', 'reverse_trade')) <> 4 then
    raise exception 'v4.58 minimums: a patched function gained an overload';
  end if;
  if public.season_rules((select id from public.seasons where number = 1)) <> s1_rules then
    raise exception 'v4.58 minimums: season_rules(Season 1) changed';
  end if;
end $chk$;

/* Rehearsal on production, 2026-11-24 (main session), one transaction rolled back by its closing raise, with the
   draft-night records and the waivers record prepended: REHEARSAL OK: T1 T2 T3 T4 T9 T5 T6 T7 T8 T10 T11 T12 (after the
   rehearsal took every trade id from insert ... returning: in one transaction now() is constant, so a created_at
   lookup tied).
   Applied 2026-11-24 as migration v458e_s2_roster_minimums. */
