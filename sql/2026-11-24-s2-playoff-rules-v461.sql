-- v4.61 (2026-11-24): the Season 2 playoff rules. Two rulings for Season 2 and every later season, built into the
-- database; Season 1 keeps every rule it was played under.
--
-- Rulings this builds (league law, quoted from the commissioner, 2026-11-24 about 12 AM ET, answering whether one goalie
-- may play every game of a series):
--   "A player can play up to 4 games in a series, but can only play 2 of the first 4 games in each series. Goalies
--   included."
--   "Remember, players sign up for a position and are expected to play there, but we allow players to play any position
--   on any given night, but to be playoff eligible, a player must play at least 6 games at their signed up position
--   group, so forward, defense, or goalie."
-- Kept, not reopened: limits count box scores only, a filed sheet never, and a player at a limit comes off the club's
-- later sheets with a site notice to management (v4.47, commissioner, 2026-11-06: "only base scheduling off box
-- scores"); the floor is six games (v4.52), prorated for a player first rostered after opening night (v3.94, rounded at
-- .4 by v4.00); every game still counts for statistics at every position played (standing order "every line counts");
-- the office's private games-played adjustments (public.gp_credits) count toward the floor as they do today and are
-- never shown to anyone outside the circle the 2026-11-24 privacy fix set (sql/2026-11-24-playoff-floor-reads-scoped.sql).
--
-- What changes (every new rule branches on public.market_on(season), so Season 1 reads exactly as before; the two changes
-- that reach Season 1 change no result: the gate's goaltender exemption moves into a helper over the same rows, and a
-- failed violation check is now heard):
--   1. public._registered_group(season, profile) (new, internal): the position group a player signed up for that season,
--      F, D or G: their sign-up; else their roster spot's position; else the position of their latest archived spot that
--      season (a player placed without a sign-up and later removed or waived); null with none. When the sign-up and the
--      spot disagree (a player rostered at another group), the sign-up wins: the ruling says "signed up position group".
--   2. public.playoff_eligibility_gp(season, profile) (new, internal, no client grant): the ONE count toward the playoff
--      floor. Season 1 (no market): public.regular_gp, unchanged. Season 2 on: the regular-season finals in which the
--      player has a line at their registered group (in goal by game_stats.is_goalie; a skater's line by the position the
--      box score records: C, LW and RW forward, D, LD and RD defense), plus the office's adjustments as regular_gp adds
--      them. public.regular_gp itself is unchanged: it is games played, which every statistic still reads.
--   3. public.series_early_games(game, profile, exclude) (new, internal): the ONE definition of "2 of the first 4 games".
--      For a market-season playoff game that is one of the first four of its series it returns the cap (2), the window
--      (4) and the player's box-score games among those four, counted the way player_week_games counts the series.
--      For any other game, null: the rule does not apply. The 2 is written once, in its select list, and everything
--      below reads it from there, so a ruling that changes it is a one-value edit there.
--   4. public._playoff_floor_exempt(season, club, profile) (new, internal): v4.17's Rule 2.4 emergency goaltender
--      exemption from the floor, until now written inline in the lineup gate. The gate and the flag in 8 both read it.
--   5. public.award_eligible (Rule 9.3) counts with playoff_eligibility_gp.
--   6. public.set_game_lineup, the playoff branch: the first-four rule refuses a player at two of the first four unless a
--      league-office exception is recorded for that player in that game (has_cap_exception, as for the cap of four); the
--      floor gate counts with playoff_eligibility_gp and reads the exemption from _playoff_floor_exempt, and in a market
--      season its refusal names the registered group.
--   7. public._series_limit_sweep (v4.47): a player who reaches two of the first four comes off the sheets of the rest of
--      those four, with v4.47's audit row and lock. The player and the club are told it is the first-four rule and that
--      the player may be dressed again from game five; sheets for games five to seven stay. In a market season, while a
--      game's lineup lock is still ahead, the club is told to refill by that lock (the sheet is judged there); after it,
--      by puck drop, as v4.47 says. The cap of four's notice keeps v4.47's sentence.
--   8. public.check_playoff_violations: in a market season a final flags the commissioners, with an audit row, (a) when
--      it takes a player past two of the first four and (b) when a player in its box score is below the playoff floor at
--      their registered group and not exempt: a box score is who played, whatever the sheet said (Rule 5.3). For every
--      season, a failure of the check now tells the commissioners, not only the database log (fail loud).
--   9. public.playoff_eligibility_board (v4.57, the set-based twin read by the title board): gp is now the twin of
--      playoff_eligibility_gp. Same rows, same grants.
-- Not changed, and why:
--   a. public.player_playoff_floor: the floor is still six, prorated the same way; the ruling changes which games count,
--     not how many are needed. public.playoff_floors (the client's floor read) returns the floor and is unchanged.
--   b. public.can_move_player: it reads min_service_gp (Rule 2.4's games before a waiver), not the playoff floor, and that
--     minimum is 0 in both seasons.
--   c. public.series_cap and public.player_week_games: the cap of four ("up to 4 games in a series", goalies included) is
--     already the basic format's series_cap for everyone, counted from the box scores.
--   d. public.grant_cap_exception: it records an exception only for a player at the cap of four (played plus dressed
--     earlier that series), which nobody reaches before game five. So the office cannot record one for the first-four
--     rule alone, and the has_cap_exception test in the gate, sweep and flag binds only when the commissioner rules the
--     office may excuse that rule (marked as a shortcut at patch 6).
--   e. The site (CG.floorGp, CG.playoffLockout, the lineup builders, the audit labels for the two new flags) and the
--     rulebook text of Rules 8.3 and 9.3 are not in this record: they belong to the site and rulebook streams. Until they
--     land, the classic site would show a Season 2 player eligible by games at every position whom the database refuses.
--
-- With the lineup deadline (the training camp record, sql/2026-11-24-s2-pool-requests-v459.sql): a sweep can take a
-- player off a sheet after that game's lineup lock (the box score of a night's first game lands near the second game's
-- puck drop, after that game's lock). The deadline forfeit is ruled once per game, at the game's own lock, and never
-- re-judged, so such a pull cannot turn a sheet that was full at the lock into a forfeit; the club refills by puck drop.
-- A pull before the lock leaves the club until the lock to refile, and the notice says so. The joint case (a pull after
-- the lock, then the tick, and no forfeit) is rehearsed once both records are in, because it needs that record's ruling
-- step.
--
-- Raised with the commissioner, not ruled when this was written: games 1 to 4 of a series need 24 player-games, and at two
-- each a club needs all twelve rostered players eligible and available (Season 2 rosters are twelve, and training camp
-- players do not play in the playoffs). A club with eleven cannot fill one of those games. The rule is built as ruled;
-- if the ruling changes the two, it is the one value in series_early_games.
--
-- Requires (live): v4.57 (playoff_eligibility_board), the 2026-11-24 privacy fix (regular_gp with no client grant),
-- v4.58 (public.market_on; Season 2 a market season). Rehearsal: sql/2026-11-24-s2-playoff-rules-v461.rehearsal.sql
-- (main session), on an empty Season 2 (no games, no roster spots): before the Dec 5 seating. It carries this record's
-- text up to the REHEARSAL note at the end, where the results are recorded.

-- 0. preconditions, and what Season 1 reads today -----------------------------------------------------------------------
do $pre$
begin
  if to_regprocedure('public.market_on(uuid)') is null or to_regprocedure('public.playoff_eligibility_board(uuid)') is null
     or to_regprocedure('public._series_limit_sweep(uuid,integer)') is null then
    raise exception 'v4.61 playoffs: v4.47, v4.57 and v4.58 must be applied first';
  end if;
  if public.market_on((select s.id from public.seasons s where s.number = 1)) then
    raise exception 'v4.61 playoffs: Season 1 reads as a market season; nothing here may change it';
  end if;
  if not public.market_on((select s.id from public.seasons s where s.number = 2)) then
    raise exception 'v4.61 playoffs: Season 2 is not a market season yet (v4.58)';
  end if;
  if has_function_privilege('anon', 'public.regular_gp(uuid,uuid)', 'EXECUTE') then
    raise exception 'v4.61 playoffs: regular_gp is callable with the public key; apply the 2026-11-24 privacy fix first';
  end if;
end $pre$;

create temp table _vnnn_board_before as
  select s.id season_id, e.* from public.seasons s cross join lateral public.playoff_eligibility_board(s.id) e
   where not public.market_on(s.id);
create temp table _vnnn_award_before as
  select s.id season_id, x.profile_id, public.award_eligible(s.id, x.profile_id) ok
    from public.seasons s
    cross join lateral (select rs.profile_id from public.roster_spots rs where rs.season_id = s.id
                        union select gs.profile_id from public.game_stats gs join public.games g on g.id = gs.game_id
                                   where g.season_id = s.id and gs.profile_id is not null) x
   where not public.market_on(s.id);
create temp table _vnnn_rules_before as
  select s.id season_id, public.season_rules(s.id)::text rules from public.seasons s where not public.market_on(s.id);

-- 1. the registered position group ---------------------------------------------------------------------------------------
create or replace function public._registered_group(p_season uuid, p_profile uuid)
 returns text
 language sql
 stable
 set search_path to ''
as $f$
  /* v4.61: the position group a player signed up for in a season, F, D or G (Rule 2.1). In order: their sign-up for that
     season; else the position on their roster spot that season; else the position on their latest archived spot that
     season (roster_spot_removals, newest removal first, then id, so a tie always reads the same way), so a player the
     office placed without a sign-up and later removed or waived keeps a group. When the sign-up and the spot disagree (a
     player rostered at another group), the sign-up wins: the ruling counts games at "their signed up position group".
     Null when there is none of the three: public.pos_group reads a null as a forward, so it is never handed one.
     Commissioner, 2026-11-24: "players sign up for a position and are expected to play there". */
  select public.pos_group(x.pos)
    from (select coalesce(
            (select r.position from public.season_registrations r where r.season_id = p_season and r.profile_id = p_profile),
            (select rs.position from public.roster_spots rs where rs.season_id = p_season and rs.profile_id = p_profile),
            (select rr.position from public.roster_spot_removals rr where rr.season_id = p_season and rr.profile_id = p_profile
              order by rr.removed_at desc, rr.id desc limit 1)) pos) x
   where x.pos is not null
$f$;

-- 2. the count toward the playoff floor ---------------------------------------------------------------------------------
create or replace function public.playoff_eligibility_gp(p_season uuid, p_profile uuid)
 returns integer
 language sql
 stable
 security definer
 set search_path to ''
as $f$
  /* v4.61: the games a player has toward the playoff floor (Rule 8.3). The ONE count the playoff lineup gate
     (set_game_lineup), Rule 9.3 award eligibility (award_eligible) and the season board (playoff_eligibility_board, its
     set-based twin) read. Every game still counts for statistics: games played is public.regular_gp, and the season
     lines and titles read the box scores; this is only what counts toward eligibility.
     A season without the Season 2 market (Season 1): public.regular_gp, unchanged, every position counted.
     Season 2 on (public.market_on), commissioner, 2026-11-24: "to be playoff eligible, a player must play at least 6
     games at their signed up position group, so forward, defense, or goalie." The regular-season finals in which the
     player has a line at their registered group (public._registered_group): in goal by game_stats.is_goalie, a skater's
     line by the position the box score records (C, LW and RW forward; D, LD and RD defense). A restarted game with a line
     in each role counts once in each group (v4.11). The office's private adjustments (gp_credits) are added as
     regular_gp adds them; they are never shown, so this function has no client grant. */
  select case when not public.market_on(p_season) then public.regular_gp(p_season, p_profile)
              else (select count(distinct g.id)::int
                      from public.game_stats gs join public.games g on g.id = gs.game_id
                     where gs.profile_id = p_profile and g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular'
                       and g.status = 'final' and not coalesce(g.voided, false)
                       and (case when coalesce(gs.is_goalie, false) then 'G' when public.pos_group(gs.position) = 'D' then 'D' else 'F' end)
                           = (select public._registered_group(p_season, p_profile)))   -- read once, not per line
                   + coalesce((select sum(c.games)::int from public.gp_credits c
                                where c.season_id = p_season and c.profile_id = p_profile), 0)
         end
$f$;

-- 3. two of the first four games of a series ----------------------------------------------------------------------------
-- shortcut: a reschedule or a void that reorders a series runs no sweep (the sweep runs on each box score, the gate on each
-- filing, the flag on each final), revisit if the office starts reordering a series' games after sheets are filed
create or replace function public.series_early_games(p_game uuid, p_profile uuid, p_exclude_game uuid default null,
                                                     out played integer, out cap integer, out first_n integer)
 language sql
 stable
 set search_path to ''
as $f$
  /* v4.61 (commissioner, 2026-11-24): "A player can play up to 4 games in a series, but can only play 2 of the first 4
     games in each series. Goalies included." The ONE definition of the second half; the first half is the series cap of
     four (public.series_cap, the basic format's figure for everyone). For a playoff game of a Season 2 or later season
     (public.market_on) that is one of the first four (first_n) games of its series: cap is two, and played is the
     player's games among those four by the box scores, counted the way public.player_week_games counts the whole
     series (v3.93, v4.47: a held game counts; a voided or office-exempted game never does; a filed lineup is not a game
     played), with p_exclude_game left out. A goaltender is counted like everyone else. For any other game all three are
     null: the rule does not apply.
     A series is one round (games.week) between the same two clubs, as trg_conclude_series reads it. Its games are
     numbered by puck drop (then id, so a tie always numbers the same way), and a voided game takes no number. */
  with g0 as (
    select g.id, g.season_id, g.week, g.stage,
           least(g.home_team_id, g.away_team_id) lo, greatest(g.home_team_id, g.away_team_id) hi
      from public.games g where g.id = p_game),
  first4 as (
    select g.id, g.status, g.ea_match_id, g.limits_exempt
      from public.games g join g0 on g.season_id = g0.season_id and g.stage = 'playoff' and g.week = g0.week
                                 and least(g.home_team_id, g.away_team_id) = g0.lo
                                 and greatest(g.home_team_id, g.away_team_id) = g0.hi
     where not coalesce(g.voided, false)
     order by g.scheduled_at, g.id
     limit 4)
  select (select count(*)::int from first4 f
           where (f.status = 'final' or (f.status = 'scheduled' and f.ea_match_id is not null))
             and not coalesce(f.limits_exempt, false)
             and (p_exclude_game is null or f.id <> p_exclude_game)
             and exists (select 1 from public.game_stats gs where gs.game_id = f.id and gs.profile_id = p_profile)),
         2 cap,       -- the ruling's 2 ("can only play 2 of the first 4"): written here only; the gate, sweep and flag read it
         4 first_n    -- the first 4
    from g0
   where g0.stage = 'playoff' and public.market_on(g0.season_id)
     and exists (select 1 from first4 f where f.id = g0.id)
$f$;

-- 4. the Rule 2.4 goaltender exemption from the floor -----------------------------------------------------------------
create or replace function public._playoff_floor_exempt(p_season uuid, p_team uuid, p_profile uuid)
 returns boolean
 language sql
 stable
 set search_path to ''
as $f$
  /* v4.17 (Rule 2.4): a goaltender seated after signings closed, under the emergency provision, is exempt from the
     playoff floor; the provision exists for that case. v4.61: the one definition, moved out of the lineup gate's inline
     test with the same rows (a season has one roster spot per player, so the gate's position read and this one are the
     same spot), and read by the gate (set_game_lineup) and the after-the-game flag (check_playoff_violations). */
  select exists (select 1 from public.roster_spots rs
                  where rs.season_id = p_season and rs.team_id = p_team and rs.profile_id = p_profile and rs.position = 'G'
                    and rs.created_at > coalesce(public.fa_moves_close_at(p_season), 'infinity'::timestamptz))
$f$;

revoke all on function public._registered_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.playoff_eligibility_gp(uuid, uuid) from public, anon, authenticated;
revoke all on function public.series_early_games(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._playoff_floor_exempt(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public._registered_group(uuid, uuid) to service_role;
grant execute on function public.playoff_eligibility_gp(uuid, uuid) to service_role;
grant execute on function public.series_early_games(uuid, uuid, uuid) to service_role;
grant execute on function public._playoff_floor_exempt(uuid, uuid, uuid) to service_role;

-- 5 to 8. patches by exact anchor (CLAUDE.md step 3): each anchor must match exactly once -----------------------------
do $p$
declare v_def text; a text; b text; n int;
begin
  -- 5. award_eligible (Rule 9.3)
  v_def := pg_get_functiondef('public.award_eligible(uuid,uuid)'::regprocedure);
  a := $a$  select public.regular_gp(p_season, p_profile) >= public.player_playoff_floor(p_season, p_profile)   -- v3.94: prorated
$a$;
  b := $b$  /* v4.61: the games toward the floor are public.playoff_eligibility_gp: regular_gp in Season 1, and from Season 2 on only
     the games at the player's registered position group (commissioner, 2026-11-24) */
  select public.playoff_eligibility_gp(p_season, p_profile) >= public.player_playoff_floor(p_season, p_profile)   -- v3.94: prorated
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the award_eligible anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);

  -- 6. set_game_lineup: the variables, the first-four rule, the floor count, the goaltender exemption, the Season 2 refusal
  -- shortcut: the office cannot record an exception for the first-four rule alone (grant_cap_exception counts toward the
  -- cap of four, which nobody reaches before game five), revisit when the commissioner rules whether the office may excuse it
  v_def := pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure);
  a := $a$  v_diff int := 0;
begin
$a$;
  b := $b$  v_diff int := 0;
  v_early_n int; v_early_cap int; v_early_of int;   -- v4.61: two of the first four games of a series (series_early_games)
begin
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the set_game_lineup declare anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);

  a := $a$    if v_game.stage = 'playoff' then
      /* Rule 8.3: a games-played floor for the playoffs where the season publishes one (v2.67:
$a$;
  b := $b$    if v_game.stage = 'playoff' then
      /* v4.61 (commissioner, 2026-11-24): "A player can play up to 4 games in a series, but can only play 2 of the first 4
         games in each series. Goalies included." Season 2 on. The series cap above is the four; this is the two of the
         first four, counted from the box scores the same way (public.series_early_games): a filed sheet is not a game
         played. A league-office exception recorded for this player in this game (has_cap_exception) passes it, as it
         passes the cap; grant_cap_exception records one only at the cap of four (the record's shortcut at patch 6). */
      select e.played, e.cap, e.first_n into v_early_n, v_early_cap, v_early_of
        from public.series_early_games(p_game, v_p, p_game) e;
      if v_early_cap is not null and v_early_n >= v_early_cap and not public.has_cap_exception(p_game, v_p) then
        select coalesce(nullif(gamertag,''),'that player') into v_name from public.profiles where id = v_p;
        raise exception '% has already played % of the first % games of this series; a player may play % of them (Rule 8.3).',
          v_name, v_early_n, v_early_of, v_early_cap using errcode = '22023';
      end if;
      /* Rule 8.3: a games-played floor for the playoffs where the season publishes one (v2.67:
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the set_game_lineup playoff anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);

  a := $a$         and public.regular_gp(v_game.season_id, v_p) < public.player_playoff_floor(v_game.season_id, v_p)
$a$;
  b := $b$         and public.playoff_eligibility_gp(v_game.season_id, v_p) < public.player_playoff_floor(v_game.season_id, v_p)   -- v4.61: regular_gp in Season 1, the registered group from Season 2
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the set_game_lineup floor anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);

  a := $a$         and not (v_pos = 'G' and exists (select 1 from public.roster_spots rs where rs.season_id = v_game.season_id and rs.team_id = p_team and rs.profile_id = v_p
                                            and rs.created_at > coalesce(public.fa_moves_close_at(v_game.season_id), 'infinity'::timestamptz))) then   -- v4.17: seated after signings closed (Rule 2.4)
$a$;
  b := $b$         and not public._playoff_floor_exempt(v_game.season_id, p_team, v_p) then   -- v4.17: seated after signings closed (Rule 2.4); v4.61: one definition
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the set_game_lineup exemption anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);

  a := $a$        raise exception '% has % regular-season games$a$;
  b := $b$        /* v4.61: Season 2 on, the refusal names the group the games were counted at; the Season 1 sentence below is
           unchanged */
        if public.market_on(v_game.season_id) then
          raise exception '% has % regular-season games %, their registered position group; the playoffs need % (Rule 8.3).',
            v_name, public.playoff_eligibility_gp(v_game.season_id, v_p),
            (case public._registered_group(v_game.season_id, v_p) when 'G' then 'in goal' when 'D' then 'at defense' else 'at forward' end),
            public.player_playoff_floor(v_game.season_id, v_p) using errcode = '22023';
        end if;
$b$ || a;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the set_game_lineup refusal anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);

  -- 7. _series_limit_sweep (v4.47): the first-four rule takes a player off the rest of those four, and its notices
  v_def := pg_get_functiondef('public._series_limit_sweep(uuid,integer)'::regprocedure);
  a := $a$  v_out uuid[]; v_names text; v_players jsonb; v_fix text; v_tail text; v_total int := 0;
$a$;
  b := a || $b$  v_early_n int; v_early_cap int; v_early_of int;   -- v4.61: two of the first four games (series_early_games)
  v_early_names text; v_early_k int := 0;                          -- v4.61: this sheet's first-four pulls, told as such
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the sweep declare anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);

  a := $a$    v_out := '{}'; v_names := null; v_players := '[]'::jsonb;
$a$;
  b := a || $b$    v_early_names := null; v_early_k := 0;
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the sweep reset anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);

  a := $a$ || ' games a player may play in a playoff series, so your club has been told to fill your spot (Rule 8.3).');
      end if;
$a$;
  b := a || $b$      /* v4.61 (commissioner, 2026-11-24): "can only play 2 of the first 4 games in each series. Goalies included." The
         same box-score count over the first four games of the series (public.series_early_games): a player who has
         played two of them comes off the sheets of the rest of those four. Sheets for games five to seven stay, and the
         player and the club are told so, so nobody reads it as the end of the player's series. */
      select e.played, e.cap, e.first_n into v_early_n, v_early_cap, v_early_of
        from public.series_early_games(s.game_id, v_pid, null) e;
      if v_early_cap is not null and v_early_n >= v_early_cap and not (v_pid = any(v_out))
         and not public.has_cap_exception(s.game_id, v_pid) then
        select coalesce(nullif(gamertag, ''), display_name, 'A player') into v_name from public.profiles where id = v_pid;
        v_out := v_out || v_pid;
        v_early_k := v_early_k + 1;
        v_early_names := coalesce(v_early_names || ', ', '') || v_name || ' (' || v_early_n || ' of the first ' || v_early_of || ' games)';
        v_players := v_players || jsonb_build_object('profile_id', v_pid, 'player', v_name, 'games', v_early_n,
                                                     'cap', v_early_cap, 'first_games', v_early_of);
        perform public._notify_lineup_pulled(s.game_id, s.team_id, array[v_pid],
          'The box scores show you have played ' || v_early_n || ' of the first ' || v_early_of || ' games of this playoff series, the most a player may play of them, so your club has been told to fill your spot. You may be dressed again from game ' || (v_early_of + 1) || ' (Rule 8.3).');
      end if;
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the sweep pull anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);

  a := $a$                   else ' Fill the open spot before puck drop (Rule 8.3).' end;
    -- p_room false: the Owner, GM and AGM on the site, nothing in the club's Discord room
    perform public.club_notify(s.team_id, 'lineups', 'Series limit reached: your lineup changed',
      v_names || case when array_length(v_out, 1) = 1 then ' has' else ' have' end
      || ' reached the playoff series limit by the box scores and came off your lineup for ' || v_fix || '.' || v_tail,
      null, 'lineup', s.game_id::text, null, false);
$a$;
  b := $b$                   else ' Fill the open spot before puck drop (Rule 8.3).' end;
    /* v4.61: from Season 2 a club's sheet is judged at the game's lineup lock, 30 minutes before puck drop (the lineup
       deadline, ruled once per game at that lock, sql/2026-11-24-s2-pool-requests-v459.sql). While the lock is ahead it is
       the time to refill by; after it the sheet was already judged, and the spot may be filled until puck drop, as above. */
    if public.market_on(p_season) and now() < s.scheduled_at - interval '30 minutes' then
      v_tail := ' Fill the open spot before the lineup lock at '
        || to_char((s.scheduled_at - interval '30 minutes') at time zone 'America/New_York', 'FMHH12:MI AM') || ' ET (Rule 5.3).';
    end if;
    -- p_room false: the Owner, GM and AGM on the site, nothing in the club's Discord room
    if v_names is not null then   -- v4.61: the cap of four, v4.47's sentence (with the tail above)
      perform public.club_notify(s.team_id, 'lineups', 'Series limit reached: your lineup changed',
        v_names || case when array_length(v_out, 1) - v_early_k = 1 then ' has' else ' have' end
        || ' reached the playoff series limit by the box scores and came off your lineup for ' || v_fix || '.' || v_tail,
        null, 'lineup', s.game_id::text, null, false);
    end if;
    if v_early_names is not null then   -- v4.61: the first-four rule, told as itself
      perform public.club_notify(s.team_id, 'lineups', 'First games of the series: your lineup changed',
        v_early_names || case when v_early_k = 1 then ' has' else ' have' end
        || ' played as many of the first ' || v_early_of || ' games of this playoff series as a player may, by the box scores, and came off your lineup for '
        || v_fix || '. The limit is on those games only: they may be dressed again from game ' || (v_early_of + 1) || '.' || v_tail,
        null, 'lineup', s.game_id::text, null, false);
    end if;
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the sweep notice anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);

  -- 8. check_playoff_violations: the first-four flag, the eligibility flag, and a failure that is heard
  v_def := pg_get_functiondef('public.check_playoff_violations()'::regprocedure);
  a := $a$  r record; v_series_gp int; v_name text; v_team text; v_cap int; v_squad text;
$a$;
  b := a || $b$  v_early_n int; v_early_cap int; v_early_of int;   -- v4.61: two of the first four games (series_early_games)
  v_floor int; v_elig int;                           -- v4.61: the playoff floor and the games toward it
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the violations declare anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);

  a := $a$          jsonb_build_object('player',v_name,'club',v_team,'series_games',v_series_gp,'cap',v_cap));
      end if;
$a$;
  b := a || $b$      /* v4.61: Season 2 on, two of the first four games of the series (public.series_early_games), this final
         included. A box score is who played, whatever the sheet said, so a breach the lineup gate could not stop is
         caught here and the commissioners rule it. */
      select e.played, e.cap, e.first_n into v_early_n, v_early_cap, v_early_of
        from public.series_early_games(new.id, r.profile_id, null) e;
      if v_early_cap is not null and v_early_n > v_early_cap and not public.has_cap_exception(new.id, r.profile_id) then
        perform public.notify_commissioners(null, 'flag', 'Playoff series limit: the first four games (Rule 8.3)',
          v_name || ' (' || coalesce(v_team,'?') || ') has now played ' || v_early_n || ' of the first ' || v_early_of ||
          ' games of this playoff series; a player may play ' || v_early_cap || ' of them. Review the game.', 'transactions', null);
        perform public.log_admin_action('playoff_violation_series_early','game',new.id::text,
          jsonb_build_object('player',v_name,'club',v_team,'first_games',v_early_of,'played',v_early_n,'cap',v_early_cap));
      end if;
      /* v4.61 (commissioner, 2026-11-24): "to be playoff eligible, a player must play at least 6 games at their signed up
         position group". The lineup gate refuses an ineligible player at the sheet; one who played anyway is in the box
         score, which is who played (Rule 5.3), so the final flags them and the commissioners rule it (Rule 5.2). Season
         2 on; Season 1 keeps its sheet-only check. The gate's three definitions: the floor (player_playoff_floor), the
         games toward it (playoff_eligibility_gp) and the Rule 2.4 goaltender exemption (_playoff_floor_exempt). */
      if public.market_on(new.season_id) then
        v_floor := public.player_playoff_floor(new.season_id, r.profile_id);
        v_elig := public.playoff_eligibility_gp(new.season_id, r.profile_id);
        if v_floor > 0 and v_elig < v_floor and not public._playoff_floor_exempt(new.season_id, r.team_id, r.profile_id) then
          perform public.notify_commissioners(null, 'flag', 'Playoff eligibility (Rule 8.3)',
            v_name || ' (' || coalesce(v_team,'?') || ') played in this playoff game with ' || v_elig || ' regular-season games '
            || (case public._registered_group(new.season_id, r.profile_id) when 'G' then 'in goal' when 'D' then 'at defense' else 'at forward' end)
            || ', their registered position group; the playoffs need ' || v_floor || '. Review the game (Rule 5.2).', 'transactions', null);
          perform public.log_admin_action('playoff_violation_ineligible','game',new.id::text,
            jsonb_build_object('player',v_name,'club',v_team,'games',v_elig,'floor',v_floor,
                               'group',public._registered_group(new.season_id, r.profile_id)));
        end if;
      end if;
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the violations flag anchor matched % times, expected exactly 1', n; end if;
  v_def := replace(v_def, a, b);

  a := $a$  exception when others then
    raise warning 'check_playoff_violations failed for game %: %', new.id, sqlerrm;
  end;
$a$;
  b := $b$  exception when others then
    raise warning 'check_playoff_violations failed for game %: %', new.id, sqlerrm;
    /* v4.61: fail loud (CLAUDE.md quality bar). The final stands, but the commissioners hear that its playoff checks did
       not run, the way _series_limit_safe tells them about the sweep. Every season. */
    begin
      perform public.notify_commissioners(null, 'flag', 'The playoff violation check failed',
        'Checking the final of ' || coalesce((select t.code from public.teams t where t.id = new.away_team_id), '?') || ' at '
        || coalesce((select t.code from public.teams t where t.id = new.home_team_id), '?') || ', '
        || coalesce(to_char(new.scheduled_at at time zone 'America/New_York', 'FMMon FMDD, FMHH12:MI AM') || ' ET', 'unscheduled')
        || ' against the playoff limits and eligibility failed: ' || sqlerrm || '. Check its box score by hand (Rule 8.3).', 'admin', null);
    exception when others then
      raise warning 'check_playoff_violations could not tell the commissioners: %', sqlerrm;
    end;
  end;
$b$;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.61 playoffs: the violations handler anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_def, a, b);
end $p$;

-- 9. the season board (v4.57), its gp now the twin of playoff_eligibility_gp ------------------------------------------
create or replace function public.playoff_eligibility_board(p_season uuid)
 returns table(profile_id uuid, gp integer, floor_gp integer, eligible boolean)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v4.57: the set-based twin of public.regular_gp (gp), public.player_playoff_floor (floor_gp) and public.award_eligible
     (eligible), for every player with a regular-season line in the season (sql/2026-11-24-title-board-setbased-v457.sql).
     Change it together with those three. */
  /* v4.61: gp is now the twin of public.playoff_eligibility_gp, the games toward the floor: regular_gp's count in a season
     without the Season 2 market, and from Season 2 on the games at the player's registered position group, the office's
     adjustments added either way (sql/2026-11-24-s2-playoff-rules-v461.sql). The rows are unchanged: every player with a
     regular-season line, whatever group it was at. */
  -- MATERIALIZED: computed once; inlined, the planner repeats playoff_min_gp (season_rules) for every player (276 ms)
  with se as materialized (
    select public.playoff_min_gp(p_season) fl0,
           (select s.number from public.seasons s where s.id = p_season) num,
           (select min(g.scheduled_at) from public.games g
             where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular' and not coalesce(g.voided, false)) opened,
           public.market_on(p_season) mk),
  -- regular_gp's count: distinct regular-season finals with a line; v4.61: and the same count per group of the line, by
  -- playoff_eligibility_gp's rule (in goal by is_goalie, else defense when public.pos_group of the recorded position is
  -- D, else forward). se.mk comes first so a season without the market never calls pos_group (it is not inlined).
  lines as (
    select gs.profile_id, count(distinct g.id)::int n,
           (count(distinct g.id) filter (where se.mk and coalesce(gs.is_goalie, false)))::int n_g,
           (count(distinct g.id) filter (where se.mk and not coalesce(gs.is_goalie, false) and public.pos_group(gs.position) = 'D'))::int n_d,
           (count(distinct g.id) filter (where se.mk and not coalesce(gs.is_goalie, false) and public.pos_group(gs.position) <> 'D'))::int n_f
      from public.game_stats gs join public.games g on g.id = gs.game_id
      cross join se
     where gs.profile_id is not null and g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular'
       and g.status = 'final' and not coalesce(g.voided, false)
     group by gs.profile_id),
  -- v4.61: the count toward the floor; the group is read once per player (public._registered_group)
  played as (
    select l.profile_id,
           case when not se.mk then l.n
                else coalesce((case public._registered_group(p_season, l.profile_id)
                                 when 'G' then l.n_g when 'D' then l.n_d when 'F' then l.n_f end), 0)
           end n
      from lines l cross join se),
  -- player_playoff_floor: the FIRST roster spot this season, current or archived
  joined as (
    select x.profile_id, min(x.t) t from (
      select rs.profile_id, rs.created_at t from public.roster_spots rs where rs.season_id = p_season
      union all
      select r.profile_id, r.spot_created_at from public.roster_spot_removals r where r.season_id = p_season) x
     group by x.profile_id),
  -- player_playoff_floor: the player's club is the one they are on now, else the last one they were removed from
  club as (
    select distinct on (x.profile_id) x.profile_id, x.team_id from (
      select rs.profile_id, rs.team_id, 0 k, extract(epoch from rs.created_at) o
        from public.roster_spots rs where rs.season_id = p_season
      union all
      select r.profile_id, r.team_id, 1, -extract(epoch from r.removed_at)
        from public.roster_spot_removals r where r.season_id = p_season) x
     order by x.profile_id, x.k, x.o)
  select p.profile_id, p.n + coalesce(cr.g, 0), f.fl,
         p.n + coalesce(cr.g, 0) >= f.fl
         and not exists (select 1 from public.suspensions s where s.profile_id = p.profile_id and s.status = 'active'
                           and s.mode = 'seasons' and s.until_season >= se.num)
    from played p
    cross join se
    left join joined j on j.profile_id = p.profile_id
    left join club c on c.profile_id = p.profile_id
    left join lateral (select count(*) total, count(*) filter (where g.scheduled_at >= j.t) left_n
                         from public.games g
                        where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular'
                          and not coalesce(g.voided, false) and c.team_id in (g.home_team_id, g.away_team_id)) cg on true
    left join lateral (select sum(cc.games)::int g from public.gp_credits cc
                        where cc.season_id = p_season and cc.profile_id = p.profile_id) cr on true
    cross join lateral (select se.fl0::numeric * cg.left_n / nullif(cg.total, 0) x) sh
    /* v4.00 (commissioner, 2026-10-13): "Round down at .4". The share rounds to the nearest game, a fraction of .4
       or less down and anything above it up: 16 x 45 / 54 = 13.33 is 13; 16 x 50 / 54 = 14.81 is 15. */
    cross join lateral (select case
                                 when coalesce(se.fl0, 0) <= 0 then 0
                                 when se.opened is null or j.t is null or j.t <= se.opened then se.fl0
                                 when c.team_id is null or coalesce(cg.total, 0) = 0 then se.fl0
                                 else least(se.fl0, (case when sh.x - floor(sh.x) > 0.4 then ceil(sh.x) else floor(sh.x) end)::int)
                               end fl) f
$function$;
revoke all on function public.playoff_eligibility_board(uuid) from public, anon, authenticated;
grant execute on function public.playoff_eligibility_board(uuid) to service_role;

-- 10. self-checks -----------------------------------------------------------------------------------------------------
do $chk$
declare v_bad text; v_def text; f text;
begin
  -- Season 1 reads exactly as before: its board rows, award eligibility and rules
  if exists ((select * from _vnnn_board_before
              except all
              select s.id, e.* from public.seasons s cross join lateral public.playoff_eligibility_board(s.id) e where not public.market_on(s.id))
             union all
             (select s.id, e.* from public.seasons s cross join lateral public.playoff_eligibility_board(s.id) e where not public.market_on(s.id)
              except all
              select * from _vnnn_board_before)) then
    raise exception 'v4.61 playoffs: the board changed for a season without the market';
  end if;
  if exists (select 1 from _vnnn_award_before b where public.award_eligible(b.season_id, b.profile_id) is distinct from b.ok) then
    raise exception 'v4.61 playoffs: award eligibility changed for a season without the market';
  end if;
  if exists (select 1 from _vnnn_award_before b
              where public.playoff_eligibility_gp(b.season_id, b.profile_id) is distinct from public.regular_gp(b.season_id, b.profile_id)) then
    raise exception 'v4.61 playoffs: the count toward the floor is not regular_gp in a season without the market';
  end if;
  if exists (select 1 from _vnnn_rules_before b where public.season_rules(b.season_id)::text is distinct from b.rules) then
    raise exception 'v4.61 playoffs: season_rules changed for a season without the market';
  end if;
  if exists (select 1 from public.games g cross join lateral public.series_early_games(g.id, null, null) e
              where g.stage = 'playoff' and not public.market_on(g.season_id) and (e.cap is not null or e.played is not null)) then
    raise exception 'v4.61 playoffs: the first-four rule applies to a season without the market';
  end if;
  -- the twin agrees with the single-player definitions, for every player of every season
  select string_agg(format('season %s: %s players differ', x.number, x.n), '; ') into v_bad from (
    select s.number, count(*) n
      from public.seasons s cross join lateral public.playoff_eligibility_board(s.id) e
     where e.gp is distinct from public.playoff_eligibility_gp(s.id, e.profile_id)
        or e.floor_gp is distinct from public.player_playoff_floor(s.id, e.profile_id)
        or e.eligible is distinct from public.award_eligible(s.id, e.profile_id)
     group by s.number) x;
  if v_bad is not null then raise exception 'v4.61 playoffs: playoff_eligibility_board disagrees with the single-player definitions: %', v_bad; end if;
  -- the patches are in place
  v_def := pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure);
  if position('from public.series_early_games(p_game, v_p, p_game) e;' in v_def) = 0
     or position('and public.playoff_eligibility_gp(v_game.season_id, v_p) < public.player_playoff_floor(v_game.season_id, v_p)' in v_def) = 0
     or position('and public.regular_gp(v_game.season_id, v_p) < public.player_playoff_floor' in v_def) > 0
     or position('their registered position group; the playoffs need % (Rule 8.3).' in v_def) = 0
     or position('from public.series_early_games(p_game, v_p, p_game) e;' in v_def) > position('public.player_playoff_floor(v_game.season_id, v_p) > 0' in v_def)
     or position('and not public._playoff_floor_exempt(v_game.season_id, p_team, v_p) then' in v_def) = 0
     or position('rs.created_at > coalesce(public.fa_moves_close_at(v_game.season_id)' in v_def) > 0 then
    raise exception 'v4.61 playoffs: set_game_lineup is not as patched';
  end if;
  if position('public.playoff_eligibility_gp(p_season, p_profile) >= public.player_playoff_floor(p_season, p_profile)' in
              pg_get_functiondef('public.award_eligible(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'v4.61 playoffs: award_eligible is not as patched';
  end if;
  v_def := pg_get_functiondef('public._series_limit_sweep(uuid,integer)'::regprocedure);
  if position('from public.series_early_games(s.game_id, v_pid, null) e;' in v_def) = 0
     or position('First games of the series: your lineup changed' in v_def) = 0
     or position('Fill the open spot before the lineup lock at ' in v_def) = 0
     or position('v_early_names := null; v_early_k := 0;' in v_def) = 0 then
    raise exception 'v4.61 playoffs: _series_limit_sweep is not as patched';
  end if;
  v_def := pg_get_functiondef('public.check_playoff_violations()'::regprocedure);
  if position('playoff_violation_series_early' in v_def) = 0 or position('playoff_violation_ineligible' in v_def) = 0
     or position('The playoff violation check failed' in v_def) = 0 then
    raise exception 'v4.61 playoffs: check_playoff_violations is not as patched';
  end if;
  -- grants: the new helpers and the board have no client grant (the count carries the office's adjustments); the
  -- patched client doors keep theirs
  foreach f in array array['public._registered_group(uuid,uuid)', 'public.playoff_eligibility_gp(uuid,uuid)',
                           'public.series_early_games(uuid,uuid,uuid)', 'public._playoff_floor_exempt(uuid,uuid,uuid)',
                           'public.playoff_eligibility_board(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = f::regprocedure and x.grantee = 0) then
      raise exception 'v4.61 playoffs: % is callable through the API', f;
    end if;
    -- is distinct from: a function created with no search_path has a null proconfig, which <> would let through
    if (select p.proconfig from pg_proc p where p.oid = f::regprocedure) is distinct from array['search_path=""'] then
      raise exception 'v4.61 playoffs: % must run with search_path ''''', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.award_eligible(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.award_eligible(uuid,uuid)', 'EXECUTE') then
    raise exception 'v4.61 playoffs: a patched client door lost its grant';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.playoff_eligibility_gp(uuid,uuid)'::regprocedure) then
    raise exception 'v4.61 playoffs: playoff_eligibility_gp must be SECURITY DEFINER (it reads gp_credits, which has no policy)';
  end if;
end $chk$;
drop table _vnnn_board_before, _vnnn_award_before, _vnnn_rules_before;

/* REHEARSAL: sql/2026-11-24-s2-playoff-rules-v461.rehearsal.sql, run by the main session on production on 2026-11-24 as one
   transaction rolled back by a closing raise: first as vNNN on v4.58, then on v4.60 (after the v4.59 camp requests, bid
   nights and committees and the v4.60 ban fix) unstamped and again stamped v4.61. T1 Season 1 reads exactly as before;
   T2 grants; T3 the count toward the floor is the registered group's while games played counts every line; T4 the gate
   names the registered group; T5 two of the first four take a skater and the goaltender off games 3 and 4, game 5 kept;
   T6 the gate refuses game 4 and an office exception admits it; T7 the cap of four on game 7; T8 a final flags the
   commissioners once for a first-four breach and once for a player below the floor, nobody else; T9 an exempt or voided
   game takes no place among the first four.
   Result: REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9
   The commissioner kept the ruling on 2026-11-24 when shown that a twelve-player roster then has no spare in games 1 to
   4 (answer: "Keep 2 of the first 4"; a club that cannot set a full lineup forfeits under Rule 3.2). */
-- Applied as migration v461_s2_playoff_rules on 2026-11-24; tools/sql/grant-audit.sql returned zero rows.
