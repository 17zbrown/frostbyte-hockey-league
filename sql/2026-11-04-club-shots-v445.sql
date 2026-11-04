-- v4.45 (2026-11-04): a club's shots become EA's own club count, stored per game.
-- Commissioner, asked whether to fix the team shot numbers: "fix them". Asked whether to fix them on the real site too: "yes".
--
-- Why. The site added up its skaters' shot lines for a club's shots for and against. Across the archive (400 club rows, 200
-- sittings) those lines total 6,343 against EA's club count of 7,128, about 11% low. EA's club count equals what the opposing
-- goaltender faced in 355 of the 400 rows and is within one in 397; the skater sum equals it in 74 and never passes it. A
-- goaltender's shots against always equal their saves plus goals against, so the club count is the one that fits the game.
-- No field explains the gap (deflections, goals, misses and blocks were checked): EA's player lines just fall short.
--
-- Parts:
--  1. games.home_shots and games.away_shots. SELECT on public.games is granted COLUMN BY COLUMN so anon can never read a
--     lobby code, so the two columns need their own grant or the site's select fails for every visitor.
--  2. reopen_game_final clears them with the rest of the result. The no-show branch of forfeit_game clears them too: a no-show
--     has no ice time and no shots. Both patched by anchored text replacement on the live definition.
--  3. Season 1 backfill from ea_ingest_log: ingested, merged and incomplete sittings added together, struck ones left out. Each
--     EA club is matched to the league club by its players' EA ids, not teams.ea_club_id, so a game played under an outside
--     club (Rule 4.6) lands on the right club. Only the two new columns change, so no result, forfeit, clinch, series or Discord
--     trigger has anything to act on; the statement-level live pulse fires once.
--  4. Self-checks.
--
-- REHEARSAL (2026-11-04, one transaction on the live database, rolled back by a closing raise; proved rolled back after):
--   T0 every result column unchanged (md5 over all games), nothing queued in net.http_request_queue, no discord_post_log or
--      transactions row, one live mark. T1 anon reads 185 games with shots through the real role. T2 games hold 7,128 shots, the
--      archive 7,128. T3 the 5 struck sittings are left out. T4 of 370 club rows in the 185 games, 324 equal the other goaltender's
--      shots against and 366 are within one; the skater lines equal the count in 55. T5 anon still cannot run either patched function.
--   T6 shots for and against per club over games with a box score: BOS 45g 865/863, DAL 38g 692/742, DET 48g 915/947,
--      NYI 50g 934/1104, PIT 40g 791/861, SEA 47g 1007/742, UTA 52g 883/992, VAN 50g 1041/877.
--   Result: REHEARSAL OK: T0 marks+1 | T1 | T2 total=7128 | T3 struck=5 | T4 rows=370 goalie_exact=324 goalie_within1=366 lines_exact=55 | T5 | T6.
-- Applied as migration v445_club_shots; tools/sql/grant-audit.sql returned zero rows.

alter table public.games
  add column if not exists home_shots integer,
  add column if not exists away_shots integer;
comment on column public.games.home_shots is 'v4.45: EA''s club shot count for the home club, every sitting added together. Null when a game has none (a no-show forfeit, a hand-filed box score): the site then adds up the skater lines.';
comment on column public.games.away_shots is 'v4.45: EA''s club shot count for the away club, every sitting added together. Null when a game has none (a no-show forfeit, a hand-filed box score): the site then adds up the skater lines.';
grant select (home_shots, away_shots) on public.games to anon, authenticated;

do $patch$
declare v_def text; v_a text; v_n int;
begin
  v_def := pg_get_functiondef('public.reopen_game_final(uuid)'::regprocedure);
  v_a := 'home_ppg=null, home_ppo=null, away_ppg=null, away_ppo=null,';
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'reopen_game_final anchor matched % times', v_n; end if;
  execute replace(v_def, v_a, v_a || ' home_shots=null, away_shots=null,   /* v4.45: EA''s club shot count goes with the result */');

  v_def := pg_get_functiondef('public.forfeit_game(uuid,uuid,text,boolean)'::regprocedure);
  v_a := 'home_ppg = 0, home_ppo = 0, away_ppg = 0, away_ppo = 0, ea_match_id = null';
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  if v_n <> 1 then raise exception 'forfeit_game anchor matched % times', v_n; end if;
  execute replace(v_def, v_a, 'home_ppg = 0, home_ppo = 0, away_ppg = 0, away_ppo = 0,
    home_shots = null, away_shots = null,   /* v4.45: a no-show has no ice time, so no shots */
    ea_match_id = null');
end $patch$;

with s as (
  select l.game_id, l.payload from public.ea_ingest_log l
   where l.game_id is not null and l.status in ('ingested', 'merged', 'incomplete') and l.payload ? 'clubs'),
c as (select s.game_id, x.cv, s.payload->'players'->x.cid as pl from s, jsonb_each(s.payload->'clubs') x(cid, cv)),
m as (
  select c.game_id, (c.cv->>'shots')::int as shots,
         (select gs.team_id from jsonb_object_keys(c.pl) pid
            join public.game_stats gs on gs.game_id = c.game_id and gs.ea_player_id = pid
           group by gs.team_id order by count(*) desc limit 1) as team_id
    from c),
a as (select game_id, team_id, sum(shots)::int as shots from m group by game_id, team_id)
update public.games g
   set home_shots = h.shots, away_shots = w.shots
  from a h, a w
 where h.game_id = g.id and h.team_id = g.home_team_id
   and w.game_id = g.id and w.team_id = g.away_team_id;

do $chk$
declare v_n int; v_src text;
begin
  /* the columns and their grants */
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'games' and column_name in ('home_shots', 'away_shots') and data_type = 'integer') <> 2 then
    raise exception 'the shot columns are missing or the wrong type'; end if;
  if not (has_column_privilege('anon', 'public.games', 'home_shots', 'SELECT') and has_column_privilege('anon', 'public.games', 'away_shots', 'SELECT')
      and has_column_privilege('authenticated', 'public.games', 'home_shots', 'SELECT') and has_column_privilege('authenticated', 'public.games', 'away_shots', 'SELECT')) then
    raise exception 'the shot columns are not readable by the site'; end if;
  if has_column_privilege('anon', 'public.games', 'game_code', 'SELECT') or has_column_privilege('anon', 'public.games', 'server', 'SELECT') then
    raise exception 'a lobby column became readable'; end if;
  /* the two patched functions */
  select prosrc into v_src from pg_proc where oid = 'public.reopen_game_final(uuid)'::regprocedure;
  if position('home_shots=null, away_shots=null' in v_src) = 0 then raise exception 'reopen_game_final does not clear the shots'; end if;
  select prosrc into v_src from pg_proc where oid = 'public.forfeit_game(uuid,uuid,text,boolean)'::regprocedure;
  if position('home_shots = null, away_shots = null' in v_src) = 0 then raise exception 'forfeit_game does not clear the shots'; end if;
  /* every game with a box score has both counts; a game without one has neither */
  select count(*) into v_n from public.games g where exists (select 1 from public.game_stats s where s.game_id = g.id) and (g.home_shots is null or g.away_shots is null);
  if v_n <> 0 then raise exception '% games with a box score have no club shots', v_n; end if;
  select count(*) into v_n from public.games g where not exists (select 1 from public.game_stats s where s.game_id = g.id) and (g.home_shots is not null or g.away_shots is not null);
  if v_n <> 0 then raise exception '% games with no box score have club shots', v_n; end if;
end $chk$;

-- Part b, migration v445b_voided_goal_shots (same day): the two games whose goals the commissioner voided on 2026-10-21.
-- Those voids removed each goal outright, "the goal, its shot, its assists, and the goalie's goal against and shot against"
-- (sql/2026-10-21-pit-uta-goals-removed.sql, sql/2026-10-21-bos-pit-goals-removed.sql), and left the raw EA payloads untouched. The
-- backfill above reads those payloads, so it put the voided shots back: one per club in each game, found by the pre-push review.
-- They are the only 2 of 185 games where the archive's skater lines differ from the box score, each by exactly 1 per side, and
-- admin_audit holds exactly two box_score_goals_removed rows, for the same two games. The games now hold 7,124 shots; 7,128 is the
-- raw archive. Per club after this part: BOS 864/862, PIT 789/859, UTA 882/991 (shots for/against, the rest as T6 above).
-- A future goal void must lower games.home_shots and away_shots too: stats_game_row and stats_game_set_result do not touch them.
update public.games set home_shots = home_shots - 1, away_shots = away_shots - 1
 where (id = '7dbccaf8-63fb-4189-8d33-02a3b00d5d26' and home_shots = 23 and away_shots = 20)
    or (id = '81a06b51-9718-40eb-a84c-f6f5e624e947' and home_shots = 29 and away_shots = 24);

do $chk$
begin
  if (select count(*) from public.games where (id = '7dbccaf8-63fb-4189-8d33-02a3b00d5d26' and home_shots = 22 and away_shots = 19)
        or (id = '81a06b51-9718-40eb-a84c-f6f5e624e947' and home_shots = 28 and away_shots = 23)) <> 2 then
    raise exception 'the two voided games do not hold their corrected shots'; end if;
  if (select sum(home_shots) + sum(away_shots) from public.games) <> 7124 then
    raise exception 'the games do not hold 7,124 shots'; end if;
end $chk$;
-- REHEARSAL of part b (2026-11-04, one transaction on the live database, rolled back by a closing raise): no request queued, no post
-- logged, no score changed, two box_score_goals_removed rows in admin_audit. Result: REHEARSAL OK: T0 | voids in audit=2 | BOS 864/862,
-- DAL 692/742, DET 915/947, NYI 934/1104, PIT 789/859, SEA 1007/742, UTA 882/991, VAN 1041/877.
-- Applied as migration v445b_voided_goal_shots; tools/sql/grant-audit.sql returned zero rows.
