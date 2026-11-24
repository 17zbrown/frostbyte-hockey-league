-- Rehearsal for sql/2026-11-24-s2-waive-hold-v458.sql. The main session runs it on production as ONE transaction that
-- ends in an uncaught raise, so everything rolls back (CLAUDE.md, Database change protocol step 2). Agents never run it.
--
-- How to run (one execute_sql call):
--   1. this file from "begin;" down to the db-guards marker;
--   2. db-guards' record text (the s2-draft-night-guards record) where the marker says, unless it is applied
--      already (it creates public.market_on and the Season 2 season_rules keys this hold reads);
--   3. the rest of this file, which carries the hold record's text byte for byte (tools/s2-waive-hold-v458.test.cjs pins
--      it) and then the cases.
-- The joint draft-night rehearsal (db-draft, sql/2026-11-24-s2-draft-night-joint-v458.rehearsal.sql) does the same with
-- db-draft's record after this one.
--
-- Before and after (outside the transaction): count net.http_request_queue and discord_dms rows; both must be unchanged.
-- pg_net is transactional and the bot sees only committed discord_dms rows, so nothing leaves.
--
-- The world: the commissioner's Season 2 rollover (start_next_season) modeled while it is still owed, then one club,
-- its Owner and one rostered player, all real Season 2 sign-ups inside this transaction only.
-- Cases:
--   T1 Season 2 is a market season, Season 1 is not (db-guards is in place).
--   T2 a synthetic Season 2 roster: the club's Owner, signed in as an API user, is refused with the hold sentence.
--   T3 a commissioner is refused the same way (the door is not built; the office removes through
--      admin_remove_from_roster).
--   T4 nothing moved: the roster spot is still there, no 'waive' transaction, no waived_at stamp.
--   T5 the Season 1 path is the old text plus the hold block only (proved inside the record's own patch block).

begin;

-- >>> db-guards record text goes here when it is not applied yet
-- <<< db-guards record text

-- >>> record text: sql/2026-11-24-s2-waive-hold-v458.sql
-- v4.58 (2026-11-24): the Season 2 waive hold. In a market season (public.market_on), public.waive_player refuses every
-- waiver with "Season 2 waivers open when the draft completes." until the Season 2 waivers record (db-waivers, applied
-- before the Dec 5 seating) replaces this hold with the 24-hour claim market.
--
-- Numbering: the block below carries this record's own number in its first comment line. The waivers record finds that
-- number in the live waive_player body, so no other file needs it.
--
-- Why: the live waive_player is the Season 1 door. It deletes the roster spot and leaves the player a free agent any club
-- may sign. Season 2 waivers are a claim window instead (commissioner, 2026-11-02: "Any team can pick up a player placed
-- on waivers up to 24 hours after they have been waived, like real life."; the three readings confirmed 2026-11-23: the
-- first valid claim wins at once, the waiving club cannot claim back, and the claiming club needs a roster spot and cap
-- room). current_season_id() is already Season 2, so the classic Team HQ Waive button acts on Season 2 rosters the moment
-- they exist (the draft, Sat Dec 12). Run on a Season 2 roster, the old door would skip the claim window and hand the
-- player to the free-agent path that Season 2 does not have.
--
-- Scope: market seasons only. market_on(season) comes from db-guards' record in the same joint draft-night apply, which
-- runs first; it is false for Season 1, so the Season 1 path is unchanged (the self-check proves the new body is the old
-- body plus this one block). The hold binds the league office too: the door itself is not built yet, and the office
-- removes a player through admin_remove_from_roster, which this does not touch.
--
-- Patched by exact text replacement on the live definition (anchor asserted to match once), so CREATE OR REPLACE keeps
-- the signature and the grants (authenticated and service_role; never anon). Nothing here posts to Discord. No rulebook
-- text: the rulebook stream owns the Season 2 chapter.
--
-- Rehearsal: sql/2026-11-24-s2-waive-hold-v458.rehearsal.sql, run by the main session inside the joint draft-night
-- rehearsal (db-guards' record text, then this record, then db-draft's). Results are recorded at the end of this file.

do $pre$
begin
  if to_regprocedure('public.market_on(uuid)') is null then
    raise exception 'v4.58 waive hold: public.market_on(uuid) does not exist. Apply the db-guards record first (same joint apply).';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'waive_player') <> 1 then
    raise exception 'v4.58 waive hold: expected exactly one public.waive_player before the patch';
  end if;
end $pre$;

do $patch$
declare
  v_old text := pg_get_functiondef('public.waive_player(uuid)'::regprocedure);
  v_new text;
  v_anchor text := $a$  if v_season.id is null then raise exception 'No active season.'; end if;
$a$;
  v_hold text := $h$  /* v4.58 (Season 2 waive hold): in a market season the Season 1 waiver below would delete the spot and leave the
     player a free agent any club may sign, skipping the 24-hour claim window the commissioner ruled ("Any team can pick
     up a player placed on waivers up to 24 hours after they have been waived, like real life.", 2026-11-02). The Season 2
     waivers record replaces this hold with the claim market; until then nobody waives on a Season 2 roster, the league
     office included (it removes a player through admin_remove_from_roster). */
  if public.market_on(v_season.id) then
    raise exception 'Season 2 waivers open when the draft completes.' using errcode = 'check_violation', hint = 'waivers_not_open';
  end if;
$h$;
  v_n int;
begin
  v_n := (length(v_old) - length(replace(v_old, v_anchor, ''))) / length(v_anchor);
  if v_n <> 1 then raise exception 'v4.58 waive hold: the season anchor matched % times, expected exactly 1', v_n; end if;
  if position('Season 2 waivers open when the draft completes.' in v_old) > 0 then
    raise exception 'v4.58 waive hold: waive_player already holds Season 2 waivers';
  end if;
  execute replace(v_old, v_anchor, v_anchor || v_hold);
  v_new := pg_get_functiondef('public.waive_player(uuid)'::regprocedure);
  /* the Season 1 path is byte-identical: take the one new block out and the old definition comes back */
  if replace(v_new, v_hold, '') <> v_old then
    raise exception 'v4.58 waive hold: the patched body differs from the old one by more than the hold block';
  end if;
end $patch$;

do $chk$
declare v_def text;
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'waive_player') <> 1 then
    raise exception 'v4.58 waive hold: expected exactly one public.waive_player';
  end if;
  v_def := pg_get_functiondef('public.waive_player(uuid)'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'if public.market_on(v_season.id) then', ''))) / length('if public.market_on(v_season.id) then') <> 1 then
    raise exception 'v4.58 waive hold: the market branch is not in waive_player exactly once';
  end if;
  if position('if public.market_on(v_season.id) then' in v_def) > position('delete from public.roster_spots' in v_def) then
    raise exception 'v4.58 waive hold: the hold must come before the roster delete';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.waive_player(uuid)'::regprocedure)
     or not ('search_path=""' = any(coalesce((select p.proconfig from pg_proc p where p.oid = 'public.waive_player(uuid)'::regprocedure), '{}'::text[]))) then
    raise exception 'v4.58 waive hold: waive_player must stay SECURITY DEFINER with search_path ''''';
  end if;
  if has_function_privilege('anon', 'public.waive_player(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.waive_player(uuid)', 'EXECUTE') then
    raise exception 'v4.58 waive hold: waive_player grants changed (authenticated yes, anon no)';
  end if;
  if public.market_on((select id from public.seasons where number = 1)) then
    raise exception 'v4.58 waive hold: Season 1 must not be a market season';
  end if;
end $chk$;

/* Rehearsal on production, 2026-11-24 (main session), each one transaction rolled back by its closing raise: this file's
   rehearsal, REHEARSAL OK: T1 T2 T3 T4 (T5 proved by the record's patch block), after one fix to the self-check (it read
   proconfig with any((select ...)), which parses as a subquery and refused with 22P02); and the joint draft-night
   rehearsal, REHEARSAL OK (joint draft night): S0 T7 T1 T2 T3 T4 T5 T6b T6.
   Applied 2026-11-24 as migration v458b_s2_waive_hold, in one transaction with v458_s2_draft_night_guards and
   v458c_s2_draft_front_office. */
-- <<< record text

-- the world: one club, its Owner, one rostered player, all real Season 2 sign-ups inside this transaction only
do $w$
declare v_s2 uuid := (select id from public.seasons where number = 2);
        v_team uuid := (select id from public.teams order by code limit 1);
        v_o uuid; v_p uuid; v_c uuid;
begin
  if not public.market_on(v_s2) then raise exception 'T1 failed: Season 2 is not a market season'; end if;
  if public.market_on((select id from public.seasons where number = 1)) then raise exception 'T1 failed: Season 1 is a market season'; end if;
  select id into v_c from public.profiles where role = 'commissioner' order by created_at limit 1;
  if v_c is null then raise exception 'world: no commissioner to act as'; end if;
  /* The commissioner runs the Season 2 rollover (public.start_next_season) before any Season 2 seat or apply (main
     session, 2026-11-23). Before it ran, 129 Season 1 player contracts were still active, and for their holders
     contracts_one_active refused the Season 2 roster insert that seating an Owner or rostering a player makes. It ran on
     production on 2026-11-23 at about 10:30 PM ET, so this step now skips; it stays, under a commissioner's claims and
     only while the rollover is still owed, so the rehearsal also models it on a copy taken before. No case relies on a
     Season 1 contract. Nothing it posts leaves the transaction. */
  if exists (select 1 from public.contracts c where c.status in ('active', 'signed') and not coalesce(c.is_manager, false)
               and c.start_season < (select s.number from public.seasons s where s.id = v_s2)) then
    perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
    perform public.start_next_season(v_s2);
    perform set_config('request.jwt.claims', '', true);
  end if;
  select r.profile_id into v_o from public.season_registrations r join public.profiles p on p.id = r.profile_id
   where r.season_id = v_s2 and r.status <> 'declined' and not public.is_suspended(r.profile_id) and not coalesce(p.banned, false)
     and not exists (select 1 from public.roster_spots rs where rs.season_id = v_s2 and rs.profile_id = r.profile_id)
     and not exists (select 1 from public.teams t where r.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id))
   order by r.created_at limit 1;
  select r.profile_id into v_p from public.season_registrations r join public.profiles p on p.id = r.profile_id
   where r.season_id = v_s2 and r.status <> 'declined' and r.profile_id <> v_o and r.position = 'C'
     and not public.is_suspended(r.profile_id) and not coalesce(p.banned, false)
     and not exists (select 1 from public.roster_spots rs where rs.season_id = v_s2 and rs.profile_id = r.profile_id)
   order by r.created_at limit 1;
  if v_o is null or v_p is null or v_c is null then raise exception 'world: could not pick an Owner, a player and a commissioner'; end if;
  update public.teams set owner_profile_id = v_o where id = v_team;
  insert into public.roster_spots (season_id, team_id, profile_id, jersey_number, position, salary, origin)
    values (v_s2, v_team, v_p, 91, 'C', 750000, 'draft');
  perform set_config('rh.team', v_team::text, true);
  perform set_config('rh.o', v_o::text, true);
  perform set_config('rh.p', v_p::text, true);
  perform set_config('rh.c', v_c::text, true);
  perform set_config('rh.tx', (select count(*) from public.transactions where type = 'waive')::text, true);
end $w$;

-- T2: the Owner, as an API user
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.o'), 'role', 'authenticated')::text, true);
do $t2$
begin
  begin
    perform public.waive_player(current_setting('rh.p')::uuid);
    raise exception 'T2 failed: the Owner waived a Season 2 player';
  exception when others then
    if sqlerrm <> 'Season 2 waivers open when the draft completes.' then raise; end if;
  end;
end $t2$;

-- T3: a commissioner
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.c'), 'role', 'authenticated')::text, true);
do $t3$
begin
  begin
    perform public.waive_player(current_setting('rh.p')::uuid);
    raise exception 'T3 failed: a commissioner waived a Season 2 player through the Season 1 door';
  exception when others then
    if sqlerrm <> 'Season 2 waivers open when the draft completes.' then raise; end if;
  end;
end $t3$;

reset role;
select set_config('request.jwt.claims', '', true);

-- T4 and the verdict
do $v$
declare v_s2 uuid := (select id from public.seasons where number = 2);
begin
  if not exists (select 1 from public.roster_spots where season_id = v_s2 and profile_id = current_setting('rh.p')::uuid
                   and team_id = current_setting('rh.team')::uuid) then
    raise exception 'T4 failed: the roster spot is gone';
  end if;
  if (select count(*) from public.transactions where type = 'waive')::text <> current_setting('rh.tx') then
    raise exception 'T4 failed: a waive transaction was written';
  end if;
  if exists (select 1 from public.season_registrations where season_id = v_s2 and profile_id = current_setting('rh.p')::uuid
               and waived_at is not null) then
    raise exception 'T4 failed: the player was stamped waived';
  end if;
  raise exception 'REHEARSAL OK: T1 T2 T3 T4 (T5 proved by the record''s patch block)';
end $v$;
