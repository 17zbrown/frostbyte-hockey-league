-- v4.52 (2026-11-17): Season 2's roster is twelve all season, its draft is nine rounds, and the playoff eligibility floor
-- is six games. Commissioner, 2026-11-17, while revising the Season 2 recruiting graphic:
--   "Keep the roster size at 12 for the full season"
--   "The draft should be 9 rounds since owners can select their GMs and AGMs pre-draft."
--   "The playoff eligibility game number should be 6 games since that is how many games it takes to generate a more
--    accurate player rating."
-- (The fourth ruling, that the AGM may be named before the draft, needs nothing here: guard_mgmt_nominee lets an Owner
-- name a GM or an AGM from anyone signed up for the coming season until the season is underway, and nothing ever enforced
-- the old "AGM only after the draft" text. It is a rulebook change only.)
--
-- 1. The roster limit becomes a season setting the database honors (Season 2: twelve). Before, guard_season_format
--    required every basic season's roster_max to equal the format's fifteen, and season_rules took roster_max from the
--    format alone, so check_roster_structure, draft_fits, place_new_roster_spot, guard_mgmt_nominee and
--    _place_trade_arrivals all read fifteen whatever the season said. Now a season's roster may be smaller than its
--    format's, never larger, and never under nine (the 5 F, 3 D and 1 G minimums of Rule S2.4); season_rules returns the
--    season's own figure. Season 1 keeps fifteen while its playoffs finish: its row already carries fifteen, and the
--    guard still allows it.
-- 2. The playoff floor is six games for every basic season without a ruled floor, replacing v4.01's thirty percent of
--    the season's length (Season 2 was sixteen of fifty-four). It is six because a rating is held toward the middle
--    until a player's sixth game at a position (Rule 6.1). The one figure is format_rules('basic') playoff_min_gp, which
--    season_playoff_floor now writes onto the season; a ruled floor still wins (Season 1 stays fourteen, v4.43), and
--    player_playoff_floor still prorates it for a player first placed after opening night (v3.94, rounded per v4.00).
--    playoff_floor_of_length, season_games_per_club and season_schedule_length stay in place (nothing else calls them).
-- 3. Season 2's row: roster_max 12, draft_rounds 9 (the three seats named before the draft and nine picks make twelve).
-- 4. The draft-night announcement (announce_lifecycle) took the round count from the format's default (fifteen), not
--    the season's own draft_rounds, so it would have announced the wrong number of rounds for Season 2's draft. It reads
--    season_rules now, as every other draft reader does. Its "placed on a club as depth" sentence is still Season 1's
--    wording; that belongs to the Season 2 training camp build and is unchanged here.
-- Patched by exact-anchor text replacement on the live definitions, each anchor asserted to match exactly once
-- (CLAUDE.md, database change protocol step 3). CREATE OR REPLACE keeps owner, grants and trigger bindings.

create temp table _v452_patch (ord int primary key, fn text not null, a text not null, b text not null) on commit drop;

insert into _v452_patch (ord, fn, a, b) values
(1, 'public.guard_season_format()',
 $a$  v_max := (r->>'roster_max')::int;
  if new.roster_max is distinct from v_max then
    raise exception 'A % season carries a %-man active roster (Rule 2.1); roster_max % does not fit the format.', new.format, v_max, new.roster_max using errcode = 'check_violation';
  end if;$a$,
 $b$  v_max := (r->>'roster_max')::int;
  /* v4.52 (commissioner, 2026-11-17: "Keep the roster size at 12 for the full season"): a season's roster may be
     smaller than its format's, never larger, and never under the nine the minimums need (5 F, 3 D, 1 G, Rule S2.4) */
  if new.roster_max is null or new.roster_max > v_max or new.roster_max < 9 then
    raise exception 'A % season carries an active roster of 9 to % players (Rule 2.1); roster_max % does not fit the format.', new.format, v_max, new.roster_max using errcode = 'check_violation';
  end if;$b$),
(2, 'public.season_rules(uuid)',
 $a$                     'draft_rounds', s.draft_rounds,$a$,
 $b$                     'draft_rounds', s.draft_rounds,
                     /* v4.52: the season's own roster limit (Season 2: twelve, all season), which guard_season_format keeps
                        within the format's; every roster reader takes it from here */
                     'roster_max', s.roster_max,$b$),
(3, 'public.format_rules(text)',
 $a$  else
    /* v3.41 (commissioner, 2026-09-26)$a$,
 $b$  else
    /* v4.52 (commissioner, 2026-11-17): the playoff floor is six games, "since that is how many games it takes to
       generate a more accurate player rating" (Rule 8.3); it was sixteen, thirty percent of fifty-four (v4.01) */
    /* v3.41 (commissioner, 2026-09-26)$b$),
(4, 'public.format_rules(text)',
 $a$"series_cap":4,"playoff_min_gp":16,$a$,
 $b$"series_cap":4,"playoff_min_gp":6,$b$),
(5, 'public.season_playoff_floor()',
 $a$declare v_len int;
begin$a$,
 $b$begin$b$),
(6, 'public.season_playoff_floor()',
 $a$    /* Rule 8.3 (v4.01): thirty percent of the season's length, the schedule once it is built, else the season's shape */
    v_len := public.season_schedule_length(new.id);
    if v_len is null then
      v_len := public.season_games_per_club(new.weeks, new.nights_per_week, new.night_slots);
    end if;
    new.playoff_min_gp := least(200, public.playoff_floor_of_length(v_len));$a$,
 $b$    /* Rule 8.3 (v4.52, commissioner, 2026-11-17): "The playoff eligibility game number should be 6 games since that is
       how many games it takes to generate a more accurate player rating." Six whatever the season's length; it
       replaces v4.01's thirty percent of the schedule. The one figure is format_rules('basic') */
    new.playoff_min_gp := (public.format_rules('basic')->>'playoff_min_gp')::int;$b$),
(7, 'public.announce_lifecycle()',
 $a$(public.format_rules(s.format)->>'draft_rounds')::int)$a$,
 $b$(public.season_rules(s.id)->>'draft_rounds')::int)$b$);

-- the patch: every anchor must match its live definition exactly once, or nothing is changed
do $patch$
declare f text; r record; v_def text; n int; v_fns int := 0;
begin
  for f in select fn from _v452_patch group by fn order by min(ord) loop
    v_def := pg_get_functiondef(f::regprocedure);
    for r in select * from _v452_patch where fn = f order by ord loop
      n := (length(v_def) - length(replace(v_def, r.a, ''))) / length(r.a);
      if n <> 1 then raise exception 'v4.52: % anchor % found % times', f, r.ord, n; end if;
      v_def := replace(v_def, r.a, r.b);
    end loop;
    execute v_def;
    v_fns := v_fns + 1;
  end loop;
  if v_fns <> 5 then raise exception 'v4.52: patched % functions, expected 5', v_fns; end if;
end $patch$;

-- Season 2's settings. The floor trigger writes six onto the row as it saves (season_playoff_floor_trg)
update public.seasons set roster_max = 12, draft_rounds = 9 where number = 2 and status = 'upcoming';

-- self-checks
do $chk$
declare r record; v_def text; s1 record; s2 record;
begin
  for r in select * from _v452_patch order by ord loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.b in v_def) = 0 then raise exception 'v4.52 check: % lacks the new text of row %', r.fn, r.ord; end if;
  end loop;
  select * into s1 from public.seasons where number = 1;
  select * into s2 from public.seasons where number = 2;
  if s2.id is null or s2.roster_max <> 12 or s2.draft_rounds <> 9 or s2.playoff_min_gp <> 6 or s2.playoff_floor_ruled is not null then
    raise exception 'v4.52 check: Season 2 is roster % rounds % floor % ruled %', s2.roster_max, s2.draft_rounds, s2.playoff_min_gp, s2.playoff_floor_ruled;
  end if;
  if s1.roster_max <> 15 or s1.playoff_min_gp <> 14 or s1.draft_rounds <> 12 then
    raise exception 'v4.52 check: Season 1 moved: roster % floor % rounds %', s1.roster_max, s1.playoff_min_gp, s1.draft_rounds;
  end if;
  if (public.season_rules(s2.id)->>'roster_max')::int <> 12 or (public.season_rules(s1.id)->>'roster_max')::int <> 15
     or (public.season_rules(s2.id)->>'draft_rounds')::int <> 9 or public.playoff_min_gp(s2.id) <> 6 or public.playoff_min_gp(s1.id) <> 14 then
    raise exception 'v4.52 check: season_rules does not read the seasons';
  end if;
  if (public.format_rules('basic')->>'playoff_min_gp')::int <> 6 or (public.format_rules('full')->>'playoff_min_gp')::int <> 0 then
    raise exception 'v4.52 check: format_rules floor is wrong';
  end if;
  if exists (select 1 from public.draft_picks where season_number = 2) then
    raise exception 'v4.52 check: a Season 2 draft board already exists and was built to the old round count';
  end if;
end $chk$;

/* REHEARSAL (2026-11-17, one transaction on the live database, rolled back by a closing raise). Before the migration the
   call snapshotted every public function (source, ACL, SECURITY DEFINER, search_path, owner, trigger count). The patch
   matched all seven anchors exactly once and re-created five functions; the $chk$ block passed.
   T1 exactly five public functions changed source, and all five kept owner, grants, SECURITY DEFINER, search_path and
      trigger bindings.
   T2 Season 1, touched the way a playoff game insert touches it (games_refresh_playoff_floor), kept a roster of 15 and
      its ruled floor of 14.
   T3 the guard refused a Season 2 roster of 16 (above the basic format) and of 8 (under the minimums), and accepted 9 and
      15 (that pass undone with ZZ001); Season 2 read 12 afterward.
   T4 an 8-week Season 2 kept a floor of 6: the floor no longer follows the season's length (undone with ZZ001).
   T5 a Season 2 registrant's own floor (player_playoff_floor) is 6; nobody is prorated before Season 2 has games.
   T6 the draft-night announcement's round count for Season 2 reads 9.
   Result: REHEARSAL OK: T1 T2 T3 T4 T5 T6.
   Afterward: Season 1 15/12/14 and Season 2 15/10/16 (roster, rounds, floor), guard_season_format unpatched and the
   format floor 16, so nothing stuck.
   Applied as migration v452_season2_rulings; tools/sql/grant-audit.sql returned zero rows. */
