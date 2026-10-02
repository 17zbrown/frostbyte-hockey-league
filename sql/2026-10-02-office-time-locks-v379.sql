-- v3.79: the league office is held to no clock in a club's Team HQ (Rule 2.6).
-- Commissioner, 2026-10-02: "The freeze should remain for regular team managers, but commissioners viewing each
-- team's Team HQ should be able to freely use any function."
-- v3.76 lifted the freeze on squad moves, the movement deadline and the Owner-approval queue for a commissioner.
-- An audit of every Team HQ action (client and database) found the time limits still standing. Each is lifted here
-- for a commissioner only; every club's own Owner, GM and AGM keeps them. What a rule says a roster may hold (group
-- caps, the camp limit, the cap, one seat one holder, suspensions, position groups, a finished game's box score) is
-- not a clock and is untouched.
--   1. set_game_lineup: a sheet closes 10 minutes after puck drop. The office may still file or change it while the
--      game is scheduled (a delayed or restarted game).
--   2. waive_player: Rule 2.4's minimum service before a waiver binds the club, not the office.
--   3. guard_trade_insert: the same minimum before a trade skips a trade the office proposed or accepts. The trigger
--      fires again when the other club accepts, so "proposed by a commissioner" is read from the row, not the caller.
--   4. _extendable_contract: the extension window (full format: the cap year must have begun) is skipped for an
--      extension the office offers, both when it is offered (offer_extension) and when the player accepts it
--      (respond_offer re-checks it under the player's own session). Only the office's own terms carry it: a club GM
--      accepting a counter is held to the window, and a club's revision of the terms records the club as their author
--      (from_profile_id), so the player accepting the club's terms is held to it too. The re-sign window for held rights is not a
--      clock to lift: it is what makes the rights held (Rule 2.2).
--   5. notify_mgmt_application: a GM or AGM nomination the office makes takes effect at once instead of waiting for
--      the reviewers' vote. If the seat cannot be filled (Rule 2.6: held by someone else, or the nominee holds another
--      seat) the nomination is refused outright, so nothing is left pending for a vote that cannot apply it.
--   6. game_vetoes: server picks lock at the night lock for the clubs. guard_veto_deadline already let the office
--      save one later, but the server had been settled by then and resolve_game_server returns early once it is set,
--      so a late pick was saved and silently ignored. Now a pick the office saves after the lock settles the server
--      again at once, and when it changes both clubs are told (their front offices and Discord rooms) and it is
--      logged.
-- Everything else in Team HQ already let the office through (audit 2026-10-02): the freeze (guard_squad_move,
-- place_new_roster_spot), the movement deadline (guard_roster_waive, guard_trade_insert, accept_trade, the free-agent
-- doors), the Owner-approval queue (mgmt_gate 'office'), clear_game_lineup at any time while scheduled, the draft
-- pause in draft_make_pick, and the game stats desk.

create or replace function public._is_commissioner_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $f$
  select exists (select 1 from public.profiles where id = p_profile and role = 'commissioner');
$f$;
revoke all on function public._is_commissioner_profile(uuid) from public, anon, authenticated;

/* 4. one definition with the office's exemption; the two-argument form keeps every other caller as it was */
create or replace function public._extendable_contract(p_profile uuid, p_season public.seasons, p_office boolean)
returns public.contracts
language sql stable security definer set search_path to 'public' as $function$
  select c.* from public.contracts c
   where c.profile_id = p_profile and not coalesce(c.is_manager,false) and c.team_id is not null
     and p_season.format = 'full'   -- Rule 2.5: no extensions or held rights in the basic format
     and (
       (c.status = 'active' and c.start_season <= p_season.number and c.end_season = p_season.number
        and (coalesce(p_office, false) or public.extension_window_open(p_season.id))   -- v3.79: the office is held to no window
        and not exists (select 1 from public.roster_spots rs where rs.season_id = p_season.id and rs.profile_id = p_profile
                          and rs.team_id <> c.team_id and coalesce(rs.origin,'') <> 'preseason_random'))
       or
       (c.status = 'expired' and c.end_season = p_season.number - 1
        and p_season.free_agency_opens_at is not null and now() < p_season.free_agency_opens_at
        -- nothing real has happened to him this season: no deal of his own on any club (a
        -- pre-season placement's contract is looked through), and no seat on another club except
        -- the pre-season's temporary one
        and not exists (select 1 from public.contracts c2
                         where c2.profile_id = p_profile and not coalesce(c2.is_manager,false) and c2.team_id is not null
                           and c2.status in ('active','signed')
                           and c2.start_season <= p_season.number and c2.end_season >= p_season.number
                           and not exists (select 1 from public.roster_spots rs where rs.season_id = p_season.id
                                             and rs.profile_id = p_profile and rs.team_id = c2.team_id
                                             and coalesce(rs.origin,'') = 'preseason_random'))
        and not exists (select 1 from public.roster_spots rs where rs.season_id = p_season.id and rs.profile_id = p_profile
                          and rs.team_id <> c.team_id and coalesce(rs.origin,'') <> 'preseason_random'))
     )
   order by c.status = 'active' desc, c.end_season desc limit 1;
$function$;

create or replace function public._extendable_contract(p_profile uuid, p_season public.seasons)
returns public.contracts
language sql stable security definer set search_path to 'public' as $function$
  select * from public._extendable_contract(p_profile, p_season, false);
$function$;
/* neither is called over the API (the client mirrors the rule in CG.extendableContractOf); the two-argument form
   had been executable by every API role since it was written */
revoke all on function public._extendable_contract(uuid, public.seasons, boolean) from public, anon, authenticated;
revoke all on function public._extendable_contract(uuid, public.seasons) from public, anon, authenticated;

/* 6. a late server pick by the office settles the server again and tells both clubs */
create or replace function public.office_late_server_pick() returns trigger
language plpgsql security definer set search_path = '' as $f$
declare v_game public.games; v_lock timestamptz; v_new text; v_club text; v_when text; v_t uuid; v_opp text;
begin
  if not public.is_commissioner() then return null; end if;
  select * into v_game from public.games where id = new.game_id;
  if v_game.id is null or v_game.status <> 'scheduled' or v_game.server is null then return null; end if;
  v_lock := public.night_lock_at(new.game_id);
  /* before the lock the resolver settles the night as usual; nothing to redo */
  if v_lock is null or now() < v_lock then return null; end if;
  update public.games set server = null where id = new.game_id;
  v_new := public.resolve_game_server(new.game_id);
  if v_new is not distinct from v_game.server then return null; end if;
  select name into v_club from public.teams where id = new.team_id;
  v_when := to_char(v_game.scheduled_at at time zone 'America/New_York', 'FMDy FMMon FMDD, FMHH12:MI AM') || ' ET';
  foreach v_t in array array[v_game.home_team_id, v_game.away_team_id] loop
    select name into v_opp from public.teams
     where id = case when v_t = v_game.home_team_id then v_game.away_team_id else v_game.home_team_id end;
    perform public.club_notify(v_t, 'schedule',
      'Server changed: ' || coalesce(v_new, 'none'),
      'The league office changed ' || coalesce(v_club, 'a club') || '''s server pick after the night locked, so the server for your '
      || v_when || ' game vs ' || coalesce(v_opp, 'your opponent') || ' is now ' || coalesce(v_new, 'not settled')
      || ' (it was ' || coalesce(v_game.server, 'not settled') || '). Rule 4.2.',
      auth.uid(), 'game', new.game_id::text);
  end loop;
  perform public.log_admin_action('server_resettled', 'game', new.game_id::text,
    jsonb_build_object('from', v_game.server, 'to', v_new, 'club', v_club, 'by', auth.uid()));
  return null;
end $f$;
revoke all on function public.office_late_server_pick() from public, anon, authenticated;
drop trigger if exists office_late_server_pick_trg on public.game_vetoes;
create trigger office_late_server_pick_trg after insert or update on public.game_vetoes
  for each row execute function public.office_late_server_pick();

/* 1, 2, 3, 4 (the two callers) and 5: surgical patches, each matching its text exactly once */
do $mig$
declare r record; d0 text; d text;
begin
  for r in select * from (values
      ('set_game_lineup',
       $a$if v_locked and now() >= v_game.scheduled_at + interval '10 minutes' then$a$,
       $b$/* v3.79: the league office may still file or change a sheet while the game is scheduled (Rule 2.6) */
  if v_locked and now() >= v_game.scheduled_at + interval '10 minutes' and not public.is_commissioner() then$b$),
      ('waive_player',
       $a$  v_why := public.can_move_player(v_season.id, p_profile);   /* Rule 2.4 minimum service (v2.74) */
  if v_why is not null then raise exception '%', v_why; end if;$a$,
       $b$  /* Rule 2.4 minimum service (v2.74); v3.79: it binds the club's own management, never the league office */
  if not public.is_commissioner() then
    v_why := public.can_move_player(v_season.id, p_profile);
    if v_why is not null then raise exception '%', v_why; end if;
  end if;$b$),
      ('guard_trade_insert',
       $a$  if new.status in ('proposed', 'accepted') then
    declare v_p uuid; v_why text;$a$,
       $b$  /* v3.79: never for a trade the league office proposed (read from the row, because this runs again when the
     other club accepts) or accepts */
  if new.status in ('proposed', 'accepted')
     and not (public.is_commissioner() or public._is_commissioner_profile(new.from_profile_id)) then
    declare v_p uuid; v_why text;$b$),
      ('offer_extension',
       $a$v_ct := public._extendable_contract(p_profile, v_season);$a$,
       $b$v_ct := public._extendable_contract(p_profile, v_season, public.is_commissioner());   /* v3.79: the office is held to no window */$b$),
      ('respond_offer',
       $a$v_hold := public._extendable_contract(o.player_id, v_season);$a$,
       $b$v_hold := public._extendable_contract(o.player_id, v_season,
          v_comm or (v_isplayer and public._is_commissioner_profile(o.from_profile_id)));   /* v3.79: the office acting, or the player accepting terms the office wrote; never the club's own GM */$b$),
      /* v3.79: a club's revision makes the terms the club's, so an office offer's exemption does not ride along */
      ('respond_offer',
       $a$update public.contract_offers set salary=p_salary, years=p_years, status='pending',
        last_actor='team', updated_at=now() where id=o.id;$a$,
       $b$update public.contract_offers set salary=p_salary, years=p_years, status='pending',
        last_actor='team', updated_at=now(), from_profile_id=auth.uid() where id=o.id;$b$),
      ('notify_mgmt_application',
       $a$declare v_owner text; v_nom text; v_club text; v_role text; v_link text; s uuid;
begin$a$,
       $b$declare v_owner text; v_nom text; v_club text; v_role text; v_link text; s uuid; v_status text; v_block text;
begin
  /* v3.79: a nomination the league office makes takes effect at once (no reviewers' vote, Rule 2.6). If the seat
     cannot be filled the insert is refused with the reason, so nothing waits on a vote that could not apply it. */
  if public.is_commissioner() and new.submitted_by = auth.uid() then
    perform public.apply_application_decision('management', new.id, true);
    select status, seat_block into v_status, v_block from public.management_applications where id = new.id;
    if v_status is distinct from 'approved' then
      raise exception '%', coalesce(v_block, 'The appointment could not be applied.') using errcode = 'check_violation';
    end if;
    return new;
  end if;$b$)
    ) v(fn, old, new)
  loop
    select pg_get_functiondef(p.oid) into d0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if d0 is null then raise exception '% not found', r.fn; end if;
    if (length(d0) - length(replace(d0, r.old, ''))) / length(r.old) <> 1 then
      raise exception '%: the text to patch is not there exactly once', r.fn; end if;
    d := replace(d0, r.old, r.new);
    execute d;
  end loop;
end $mig$;

/* REHEARSED 2026-10-02 in one rolled-back transaction (a temporary min_service_gp of 99 so Rule 2.4 bites):
   "REHEARSAL OK: R1 R2 R3 R4 R5 R6 R7".
     R1 a club's sheet 20 minutes after puck drop is refused ("already under way"); the office files the same sheet;
     R2 a club's waive is held to Rule 2.4; the office's waive of the same player goes through;
     R3 a club's trade is held to Rule 2.4; a club cannot insert a trade in a commissioner's name (RLS); the office's
        trade goes in, and the other club ACCEPTING it is not held to Rule 2.4 either;
     R4 with the season taken as full format and the window closed: the club form finds no extendable deal, the office
        form does, the two-argument form is unchanged, basic leaks nothing; offer_extension passes the office,
        respond_offer passes only the office acting or the player accepting the office's own terms, a club's revision
        records the club as author, request_extension is untouched, exactly two overloads;
     R5 an office GM nomination is seated at once (approved); one for a filled seat is refused with the reason and
        leaves nothing pending; an Owner's nomination still waits for the vote;
     R6 a club's pick after the night lock is refused; the office's re-settles the server (NA Central -> NA West), tells
        both clubs (2 'schedule' club notices) and is logged ('server_resettled'); a later office save that changes
        nothing tells nobody;
     R7 no new function is an API role's; the patched doors keep their grants.
   The first rehearsal (before review) passed the same seven; the review then found the respond_offer carry-over (a
   club GM accepting a counter on an office offer, or the player accepting a club's revision of it, inherited the
   exemption) and it was narrowed as above and rehearsed again.
   APPLIED 2026-10-02 as migration v379_office_time_locks. Afterwards: all six patches are live, the trigger is on
   game_vetoes, min_service_gp is the season setting again, and tools/sql/grant-audit.sql returns zero rows. */
