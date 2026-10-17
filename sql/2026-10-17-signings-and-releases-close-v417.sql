-- v4.17: Season 1's signings and releases close at the ORIGINAL movement deadline (midnight ET at the end of Friday,
-- Oct 16); only trades and the trade block keep the extended deadline (11:59 PM ET Sunday, Oct 18, v4.16).
-- Commissioner, 2026-10-17: "No new signings after the original deadline. Keep the trade offers cancelled as a clean
-- up tactic." Asked whether a club that loses a player after the original deadline may still sign one replacement
-- (Rule 2.4), the commissioner answered yes ("Rule 2.4 applies"). Asked whether releases stay open with trades:
-- "Teams still have their TC rosters so the players can be placed on their camp if there is no room on the active
-- rosters. Dont allow a team to complete a trade if the trade will result in the team going over their roster and
-- camp limits." So releases close with signings: a club has no need to waive to take a trade, because an arrival with
-- no active place joins training camp, and a trade that would take a club past its camp limit is refused. That trade
-- rule is already enforced, unchanged here: _place_trade_arrivals (v3.72) seats an arrival on the active roster only
-- where the 15-man total and the position group have room, sends the rest to camp, and raises "Nothing was traded"
-- when camp would pass camp_max (10 in Season 1); accept_trade and reverse_trade run it for both clubs.
--
-- Why a new gate: since v4.16 moves_locked() runs to the extended deadline, so every signing and release door that read
-- it was open until Sunday, against the ruling (no signing or release happened in between; checked before this ran).
-- Free-agent moves (a club signing a player from the free-agent pool, or releasing one into it) get their own close:
-- seasons.fa_moves_closed_at, read through public.fa_moves_closed(season) = moves locked OR that close has passed, and
-- public.fa_moves_close_at(season) = the earlier of that close and the movement deadline (the close in force). With no
-- fa_moves_closed_at set they are exactly the movement deadline, so every other season behaves as before (Rule 2.4).
-- The same pattern as public.placement_closed (v4.16). Doors moved onto it:
--   sign_free_agent (direct signings, and the replacement-signing path), offer_free_agent and respond_offer's accept
--   (the full-format offer route), reinstate_roster_spot (a signing in effect), guard_roster_waive (club waivers) and
--   office_withdraw_registration (a release by office staff; the commissioner stays exempt), mgmt_request_move (the
--   approval queue refuses queued waivers and offers at the close), _deadline_sweep (withdraws them at the close).
-- Replacement signings follow the free-agent close: _grant_replacement grants an allowance for a removal after it, and
-- sign_free_agent spends one granted at or after it (v4.16b's lapse rule now keys on this close). Dallas's allowance
-- (Simon Makienok left the league Discord at 8:34 AM ET on Oct 17, after the original deadline) counts again, and its
-- club notice is accurate again. The emergency-goaltender exemption in set_game_lineup keys on the same close.
-- Unchanged on purpose: trades, the trade block and their sweep keep moves_locked and the extended deadline; the 14
-- trade offers the sweep cancelled at the original deadline stay cancelled; Season 1 placement stays closed (v4.16);
-- Season 2 sign-ups and owner applications stay open. Nothing here posts to Discord.
--
-- REHEARSAL on production, 2026-10-17: the whole change (column, both helpers, the eleven patches, the Season 1 close,
-- every self-check) plus probes in ONE do-block ending in an uncaught raise; verified rolled back afterwards (no column,
-- no helper, sign_free_agent unchanged, one allowance). Probes signed in as club Owners (not commissioners):
--   S1: fa_moves_closed=t, close at 2026-10-17 04:00 UTC, moves_locked=f, placement_closed=t, deadline 2026-10-19 03:59 UTC
--   Boston (no allowance): sign_free_agent and offer_free_agent "free-agent signings have closed"; waive_player and a
--     direct roster delete "releases have closed"; a queued waiver refused; a queued trade passes the deadline gate
--     (it then failed its own validation, "Choose another club to trade with.")
--   Dallas (Simon Makienok's allowance): sign_free_agent spends it, then refuses the made-up registration
--     ("That player is not registered for this season."), so the replacement counts
--   _grant_replacement for a Boston removal now grants an allowance (1)
--   _deadline_sweep: proposed trades 4 -> 4 and trade-block listings 9 -> 9 (trades untouched until Sunday)
-- Applied as migration v417_signings_and_releases_close.

alter table public.seasons add column if not exists fa_moves_closed_at timestamptz;
comment on column public.seasons.fa_moves_closed_at is
  'v4.17: when club signings and releases close, if earlier than the movement deadline (trades and the trade block keep the deadline). Null = at the movement deadline (Rule 2.4).';

create or replace function public.fa_moves_closed(p_season uuid) returns boolean
  language sql stable set search_path to '' as $f$
  select coalesce(public.moves_locked(p_season), false)
      or coalesce((select s.fa_moves_closed_at is not null and now() >= s.fa_moves_closed_at
                     from public.seasons s where s.id = p_season), false)
$f$;
create or replace function public.fa_moves_close_at(p_season uuid) returns timestamptz
  language sql stable set search_path to '' as $f$
  select least(s.fa_moves_closed_at, public.movement_deadline_at(s.id)) from public.seasons s where s.id = p_season
$f$;
revoke all on function public.fa_moves_closed(uuid) from public, anon, authenticated;
revoke all on function public.fa_moves_close_at(uuid) from public, anon, authenticated;

-- every free-agent door reads the new gate (anchored text patches, each asserted to match exactly once)
do $p$
declare
  v_fn regprocedure[] := array[
    'public.sign_free_agent(uuid,bigint,uuid)', 'public.offer_free_agent(uuid,bigint,integer,text,uuid)',
    'public.respond_offer(uuid,text,bigint,integer)', 'public.reinstate_roster_spot(uuid)',
    'public.office_withdraw_registration(uuid,text)', 'public.mgmt_request_move(text,text,jsonb,text)',
    'public._deadline_sweep()', 'public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)',
    'public._grant_replacement(uuid,uuid,uuid,text)', 'public._grant_replacement(uuid,uuid,uuid,text)',
    'public.guard_roster_waive()']::regprocedure[];
  v_a text[] := array[
-- 1 sign_free_agent
$q$  /* v3.70 (Q11): past the deadline a club signs only to replace a player whose sign-up was removed after it,
     one signing per removal (replacement_signings); the allowance is spent by this signing */
  if public.moves_locked(v_season.id) and not public.is_commissioner() then
    update public.replacement_signings rsg set used_at = now(), used_registration_id = p_registration
     where rsg.id = (select x.id from public.replacement_signings x
                      where x.season_id = v_season.id and x.team_id = v_team.id and x.used_at is null
                        /* v4.16b: only an allowance granted at or after the deadline in force counts; one granted
                           before a later extension lapses at the new deadline (the club could sign freely until
                           then). During an office lock (override 'locked') every allowance counts. The site's
                           count in part_live.js applies the same test (Rule 2.4). */
                        and (v_season.moves_lock_override = 'locked'
                             or x.created_at >= public.movement_deadline_at(v_season.id))
                      order by x.created_at limit 1);
    if not found then
      raise exception 'Roster moves are locked — the deadline has passed.';
    end if;
  end if;$q$,
-- 2 offer_free_agent
$q$  if public.moves_locked(v_season.id) and not public.is_commissioner() then
    raise exception 'Roster moves are locked — the deadline has passed.';
  end if;

  select sr.* into v_reg from public.season_registrations sr$q$,
-- 3 respond_offer
$q$      if public.moves_locked(v_season.id) and not v_comm then
        raise exception 'Roster moves are locked — the deadline has passed.';
      end if;$q$,
-- 4 reinstate_roster_spot
$q$  /* v3.98: past the movement deadline this puts a player on a roster, which is a commissioner's decision (Rule 2.4, v3.79) */
  if public.moves_locked(r.season_id) and not public.is_commissioner() then
    raise exception 'Rule 2.4: the movement deadline has passed for this season, so only a commissioner can put a removed player back on a roster.'$q$,
-- 5 office_withdraw_registration
$q$  /* v3.98: past the movement deadline, taking a rostered player off a club is a commissioner's decision (Rule 2.4, v3.79) */
  if v_spot and public.moves_locked(v_reg.season_id) and not public.is_commissioner() then
    raise exception 'Rule 2.4: the movement deadline has passed, so only a commissioner can withdraw a rostered player''s sign-up (it takes the player off %).', v_club$q$,
-- 6 mgmt_request_move
$q$  /* v3.98: a move the movement deadline closed is refused when it is asked for, not when the Owner approves it */
  if public.moves_locked(public.current_season_id())
     and (p_action in ('waive_player', 'trade_propose', 'accept_trade', 'offer_free_agent')
          or (p_action = 'roster_block' and coalesce((p_args->>'on_block')::boolean, false))) then
    raise exception 'Rule 2.4: trades, signings, waivers and trade-block listings closed at the movement deadline.' using errcode = 'check_violation';
  end if;$q$,
-- 7 _deadline_sweep
$q$  end loop;
  insert into public.app_config(key, value) values ('rl_deadline_sweep', now()::text)$q$,
-- 8 set_game_lineup
$q$                                            and rs.created_at > coalesce(public.movement_deadline_at(v_game.season_id), 'infinity'::timestamptz))) then$q$,
-- 9 _grant_replacement gate
$q$  if p_team is null or not public.moves_locked(p_season) then return; end if;   -- before the deadline, sign as usual$q$,
-- 10 _grant_replacement notice
$q$    'The movement deadline has passed, but because '||v_name||'''s sign-up was removed ('||p_reason||'), you may sign one free agent to replace him (Rule 2.4). Sign him from the free-agent board in Team HQ.',$q$,
-- 11 guard_roster_waive
$q$  if public.moves_locked(old.season_id) and not public.is_commissioner() then
    raise exception 'Roster moves are locked — you cannot waive players right now.';
  end if;$q$];
  v_b text[] := array[
-- 1
$q$  /* v3.70 (Q11): past the deadline a club signs only to replace a player whose sign-up was removed after it,
     one signing per removal (replacement_signings); the allowance is spent by this signing.
     v4.17: the deadline that closes signings is the free-agent close (public.fa_moves_closed), which may come before
     the movement deadline. Season 1's signings closed at the original deadline while trades ran to the extended one
     (commissioner, 2026-10-17: "No new signings after the original deadline."; Rule 2.4 replacements still apply). */
  if public.fa_moves_closed(v_season.id) and not public.is_commissioner() then
    update public.replacement_signings rsg set used_at = now(), used_registration_id = p_registration
     where rsg.id = (select x.id from public.replacement_signings x
                      where x.season_id = v_season.id and x.team_id = v_team.id and x.used_at is null
                        /* v4.16b, v4.17: only an allowance granted at or after the free-agent close in force counts;
                           one granted before a later extension of that close lapses at the new close (the club could
                           sign freely until then). During an office lock (override 'locked') every allowance counts.
                           The site's count in part_live.js applies the same test (Rule 2.4). */
                        and (v_season.moves_lock_override = 'locked'
                             or x.created_at >= public.fa_moves_close_at(v_season.id))
                      order by x.created_at limit 1);
    if not found then
      raise exception 'Rule 2.4: free-agent signings have closed for this season. A club may sign only to replace a player whose sign-up was removed after they closed.';
    end if;
  end if;$q$,
-- 2
$q$  /* v4.17: a free-agent offer closes with signings (public.fa_moves_closed, Rule 2.4) */
  if public.fa_moves_closed(v_season.id) and not public.is_commissioner() then
    raise exception 'Rule 2.4: free-agent signings have closed for this season.';
  end if;

  select sr.* into v_reg from public.season_registrations sr$q$,
-- 3
$q$      /* v4.17: accepting a free-agent offer is a signing, so it closes with signings (public.fa_moves_closed, Rule 2.4) */
      if public.fa_moves_closed(v_season.id) and not v_comm then
        raise exception 'Rule 2.4: free-agent signings have closed for this season, so this offer can no longer be accepted.';
      end if;$q$,
-- 4
$q$  /* v3.98: past the deadline this puts a player on a roster, which is a commissioner's decision (Rule 2.4, v3.79).
     v4.17: it is a signing in effect, so it closes with signings (public.fa_moves_closed) */
  if public.fa_moves_closed(r.season_id) and not public.is_commissioner() then
    raise exception 'Rule 2.4: free-agent signings have closed for this season, so only a commissioner can put a removed player back on a roster.'$q$,
-- 5
$q$  /* v3.98: past the deadline, taking a rostered player off a club is a commissioner's decision (Rule 2.4, v3.79).
     v4.17: it is a release, so it closes with releases (public.fa_moves_closed) */
  if v_spot and public.fa_moves_closed(v_reg.season_id) and not public.is_commissioner() then
    raise exception 'Rule 2.4: releases have closed for this season, so only a commissioner can withdraw a rostered player''s sign-up (it takes the player off %).', v_club$q$,
-- 6
$q$  /* v3.98: a move the movement deadline closed is refused when it is asked for, not when the Owner approves it.
     v4.17: signings and releases have their own close (public.fa_moves_closed), which may come first (Rule 2.4) */
  if public.moves_locked(public.current_season_id())
     and (p_action in ('trade_propose', 'accept_trade')
          or (p_action = 'roster_block' and coalesce((p_args->>'on_block')::boolean, false))) then
    raise exception 'Rule 2.4: trades and trade-block listings closed at the movement deadline.' using errcode = 'check_violation';
  end if;
  if public.fa_moves_closed(public.current_season_id()) and p_action in ('waive_player', 'offer_free_agent') then
    raise exception 'Rule 2.4: signings and releases have closed for this season.' using errcode = 'check_violation';
  end if;$q$,
-- 7
$q$  end loop;
  /* v4.17: signings and releases may close before the movement deadline (seasons.fa_moves_closed_at). At that close,
     queued waivers and free-agent offers are withdrawn; trades are left to the deadline above, and the trade offers
     it cancelled stay cancelled (commissioner, 2026-10-17: "Keep the trade offers cancelled as a clean up tactic.").
     The queue serves the current season. */
  if public.fa_moves_closed(public.current_season_id()) then
    update public.team_mgmt_moves
       set status = 'withdrawn', result = 'closed when signings and releases closed (Rule 2.4)', decided_at = now()
     where status = 'pending' and action in ('waive_player', 'offer_free_agent');
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;
  insert into public.app_config(key, value) values ('rl_deadline_sweep', now()::text)$q$,
-- 8
$q$                                            and rs.created_at > coalesce(public.fa_moves_close_at(v_game.season_id), 'infinity'::timestamptz))) then   -- v4.17: seated after signings closed (Rule 2.4)$q$,
-- 9
$q$  if p_team is null or not public.fa_moves_closed(p_season) then return; end if;   -- v4.17: before signings close, sign as usual (they may close before the movement deadline, Rule 2.4)$q$,
-- 10
$q$    'Free-agent signings have closed, but because '||v_name||'''s sign-up was removed ('||p_reason||'), you may sign one free agent to replace them (Rule 2.4). Sign the replacement from the free-agent board in Team HQ.',$q$,
-- 11
$q$  /* v4.17: releases close with signings (public.fa_moves_closed), which may come before the movement deadline:
     Season 1's closed at the original deadline while trades ran to the extended one (Rule 2.4) */
  if public.fa_moves_closed(old.season_id) and not public.is_commissioner() then
    raise exception 'Rule 2.4: releases have closed for this season, so a club cannot waive players now.';
  end if;$q$];
  v_def text; v_n int; i int;
begin
  for i in 1 .. array_length(v_fn, 1) loop
    v_def := pg_get_functiondef(v_fn[i]);
    v_n := (length(v_def) - length(replace(v_def, v_a[i], ''))) / length(v_a[i]);
    if v_n <> 1 then raise exception 'patch % (%): anchor found % times', i, v_fn[i], v_n; end if;
    execute replace(v_def, v_a[i], v_b[i]);
  end loop;
end $p$;

-- Season 1: signings and releases closed at the original deadline, with automatic placement
do $d$
declare v_s1 uuid; v_pc timestamptz; v_orig constant timestamptz := timestamptz '2026-10-17 00:00:00 America/New_York'; v_bad text;
begin
  select id, placement_closed_at into v_s1, v_pc from public.seasons where number = 1;
  if v_pc is distinct from v_orig then raise exception 'Season 1 placement close reads %, expected the original deadline', v_pc; end if;
  update public.seasons set fa_moves_closed_at = v_orig where id = v_s1 and fa_moves_closed_at is null;
  perform public.log_admin_action('fa_moves_closed', 'season', v_s1::text, jsonb_build_object(
    'at', v_orig, 'movement_deadline', public.movement_deadline_at(v_s1),
    'ruling', 'Commissioner, 2026-10-17: no new signings after the original deadline; releases close with signings (arrivals by trade go to camp; a trade past roster and camp limits is refused); Rule 2.4 replacement signings still apply; the trade offers cancelled at the original deadline stay cancelled'));

  -- self-checks
  if public.fa_moves_close_at(v_s1) is distinct from v_orig then raise exception 'self-check: Season 1 free-agent close is %', public.fa_moves_close_at(v_s1); end if;
  if not public.fa_moves_closed(v_s1) then raise exception 'self-check: Season 1 signings and releases are open'; end if;
  if now() < public.movement_deadline_at(v_s1) and public.moves_locked(v_s1) then raise exception 'self-check: trades closed early'; end if;
  if public.movement_deadline_at(v_s1) is distinct from timestamptz '2026-10-18 23:59:00 America/New_York' then raise exception 'self-check: the trade deadline moved'; end if;
  if not public.placement_closed(v_s1) then raise exception 'self-check: Season 1 placement reopened'; end if;
  if not (select registration_open from public.seasons where number = 2) then raise exception 'self-check: Season 2 sign-ups closed'; end if;
  select string_agg(f, ', ') into v_bad from unnest(array['sign_free_agent', 'offer_free_agent', 'respond_offer', 'reinstate_roster_spot',
      'office_withdraw_registration', '_grant_replacement', 'guard_roster_waive']) f
   where position('public.fa_moves_closed(' in (select string_agg(pg_get_functiondef(p.oid), '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f)) = 0
      or position('public.moves_locked(' in (select string_agg(pg_get_functiondef(p.oid), '') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f)) > 0;
  if v_bad is not null then raise exception 'self-check: still on moves_locked or missing the free-agent gate: %', v_bad; end if;
  if position('public.fa_moves_close_at(v_season.id)' in pg_get_functiondef('public.sign_free_agent(uuid,bigint,uuid)'::regprocedure)) = 0
     or position('public.fa_moves_close_at(v_game.season_id)' in pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure)) = 0
     or position('public.fa_moves_closed(public.current_season_id())' in pg_get_functiondef('public._deadline_sweep()'::regprocedure)) = 0
     or position('p_action in (''waive_player'', ''offer_free_agent'')' in pg_get_functiondef('public.mgmt_request_move(text,text,jsonb,text)'::regprocedure)) = 0 then
    raise exception 'self-check: a free-agent door was not patched';
  end if;
  if has_function_privilege('anon', 'public.fa_moves_closed(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.fa_moves_closed(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.fa_moves_close_at(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.fa_moves_close_at(uuid)', 'EXECUTE') then
    raise exception 'self-check: a free-agent gate is callable by an API role';
  end if;
end $d$;
