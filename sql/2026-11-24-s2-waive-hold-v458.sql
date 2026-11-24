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
