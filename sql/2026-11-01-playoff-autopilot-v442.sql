-- Built as v4.40 (migrations v440_playoff_autopilot, v440b_set_game_code_definer, v440c_playoff_review_fixes), ships as
-- v4.42: v4.41 went to another release while this one was in review. The applied parts keep their build numbers below.
-- v4.40 (2026-11-01): the playoffs draw themselves. Round 1 is seeded from the final table as soon as the last
-- regular-season game is final, and every later round is drawn once each series of the round before it is decided.
-- Commissioner, 2026-11-01: "generate the first round of season 1 playoffs and automatically generate the following rounds
-- when able. For the future, auto generate every playoff round."
-- Why: every round was built by hand in the browser (CG.generatePlayoffRound, Control Center > Schedule > Playoffs), so a
-- round existed only when a commissioner opened the page and pressed Generate. That draw now lives here, in one place:
-- public._draw_playoff_round. The pg_cron job playoff-autopilot runs it every five minutes for each season still in play,
-- and the Control Center's Draw now button calls the same function (draw_playoff_round), so the browser no longer carries
-- a second copy of the bracket. What it draws is unchanged from the browser version it replaces:
--   * seeds: the top playoff_per_div clubs of each division, ordered by points and then the Rule 8.2 tiebreakers exactly
--     as CG.standings orders them (head-to-head points among the clubs level on points, regulation wins, goal differential,
--     goals scored); site_config playoff_seeds_<n> freezes them, division-major, as before (Rule 8.1: seeding does not
--     change between rounds). A tie every tiebreaker leaves level, where it decides a berth or a seed, stops the draw and
--     tells the commissioners (Rule 8.2: a one-game play-in the league office schedules).
--   * round 1 per division: CG.playoffRound1's shape (basic: seed 2 v seed 3, seed 1 rests); later divisional rounds: the
--     winners plus the round-1 byes, best seed against worst; the final: the two division champions, the higher seed the
--     one higher in the league-wide table (Rule 8.3, v3.59 Q34).
--   * schedule: one game-week, 2-2-3 (Wednesday, Thursday, Friday), home by game 2-2-1-1-1 (v3.59 Q33), the season's
--     own puck-drop slots, every week holding a holiday the season observes stepped over (Rule 0.8). The week is the first
--     one on or after the season's playoff start, two days after the last playoff game, and tomorrow, whichever is latest.
--     All seven games are laid down; trg_conclude_series removes the ones a series never reaches, as before.
-- The holiday calendar is ported from the site (CG.HOLIDAYS, CG.holidayDate, CG.holidayWeek, CG.gameNights);
-- tools/playoff-autopilot-v440.test.cjs pins the two tables row for row, and the rehearsal below compared all twenty
-- holidays for 2026 to 2035 against the site's own dates.
-- shortcut: the bracket assumes exactly two divisions (Rule 8.1, the final between the two division champions), and the
-- draw refuses any other count; revisit if a third division is ever added.
-- shortcut: a tie no Rule 8.2 tiebreaker breaks stops the draw and asks the commissioners; there is no play-in tool, so
-- revisit if a play-in is ever needed.

-- Part 1: the league calendar. Every name schema-qualified, search_path '' (CLAUDE.md).

create or replace function public.holiday_rules()
 returns table(key text, kind text, m int, d int, weekday int, n int, ofs int, observed_by_default boolean)
 language sql
 immutable
 set search_path to ''
as $function$
  /* v4.40: the twin of CG.HOLIDAYS (src/live/part_live.js), row for row; tools/playoff-autopilot-v440.test.cjs pins the
     two. weekday counts as JavaScript's getUTCDay does: 0 is Sunday, 6 is Saturday. observed_by_default is CG's "on". */
  select * from (values
    ('new-years-day',    'fixed',       1,    1,    null::int, null::int, null::int, true),
    ('mlk-day',          'nth',         1,    null, 1,         3,         null,      false),
    ('family-day',       'nth',         2,    null, 1,         3,         null,      false),
    ('good-friday',      'easter',      null, null, null,      null,      -2,        false),
    ('easter',           'easter',      null, null, null,      null,      0,         false),
    ('victoria-day',     'onOrBefore',  5,    24,   1,         null,      null,      false),
    ('memorial-day',     'last',        5,    null, 1,         null,      null,      false),
    ('juneteenth',       'fixed',       6,    19,   null,      null,      null,      false),
    ('canada-day',       'fixed',       7,    1,    null,      null,      null,      true),
    ('independence-day', 'fixed',       7,    4,    null,      null,      null,      true),
    ('civic-holiday',    'nth',         8,    null, 1,         1,         null,      false),
    ('labor-day',        'nth',         9,    null, 1,         1,         null,      false),
    ('ca-thanksgiving',  'nth',         10,   null, 1,         2,         null,      false),
    ('halloween',        'fixed',       10,   31,   null,      null,      null,      false),
    ('remembrance-day',  'fixed',       11,   11,   null,      null,      null,      false),
    ('us-thanksgiving',  'nth',         11,   null, 4,         4,         null,      true),
    ('christmas-eve',    'fixed',       12,   24,   null,      null,      null,      true),
    ('christmas-day',    'fixed',       12,   25,   null,      null,      null,      true),
    ('boxing-day',       'fixed',       12,   26,   null,      null,      null,      true),
    ('new-years-eve',    'fixed',       12,   31,   null,      null,      null,      true)
  ) t(key, kind, m, d, weekday, n, ofs, observed_by_default)
$function$;

create or replace function public.holiday_date(p_key text, p_year int)
 returns date
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  r record; v date;
  a int; b int; c int; dd int; e int; f int; g int; h int; i int; k int; l int; mm int; mo int; da int;
begin
  /* v4.40: CG.holidayDate. The date a holiday falls on in a given year, or null for a key the league does not know. */
  select * into r from public.holiday_rules() x where x.key = p_key;
  if not found or p_year is null then return null; end if;
  if r.kind = 'fixed' then return make_date(p_year, r.m, r.d); end if;
  if r.kind = 'nth' then
    v := make_date(p_year, r.m, 1);
    return v + ((r.weekday - extract(dow from v)::int + 7) % 7) + (r.n - 1) * 7;
  end if;
  if r.kind = 'last' then
    v := (make_date(p_year, r.m, 1) + interval '1 month' - interval '1 day')::date;
    while extract(dow from v)::int <> r.weekday loop v := v - 1; end loop;
    return v;
  end if;
  if r.kind = 'onOrBefore' then
    v := make_date(p_year, r.m, r.d);
    while extract(dow from v)::int <> r.weekday loop v := v - 1; end loop;
    return v;
  end if;
  if r.kind = 'easter' then
    /* the Gregorian computus, line for line as CG.HOLIDAY_RULES.easter writes it (every term is non-negative, so
       integer division is the floor JavaScript takes) */
    a := p_year % 19; b := p_year / 100; c := p_year % 100; dd := b / 4; e := b % 4;
    f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - dd - g + 15) % 30;
    i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; mm := (a + 11 * h + 22 * l) / 451;
    mo := (h + l - 7 * mm + 114) / 31; da := ((h + l - 7 * mm + 114) % 31) + 1;
    return make_date(p_year, mo, da) + coalesce(r.ofs, 0);
  end if;
  raise exception 'holiday % has a rule kind (%) the calendar does not know', p_key, r.kind;
end $function$;

create or replace function public.season_holiday_keys(p_season uuid)
 returns text[]
 language sql
 stable
 set search_path to ''
as $function$
  /* v4.40: CG.seasonHolidayKeys. Never configured (null) means the league defaults; an empty list skips nothing, which is
     a real and different choice; a key the league does not know is ignored. */
  select case when s.skip_holidays is null
              then array(select x.key from public.holiday_rules() x where x.observed_by_default)
              else array(select u.k from unnest(s.skip_holidays) with ordinality u(k, o)
                          where exists (select 1 from public.holiday_rules() x where x.key = u.k) order by u.o)
         end
    from public.seasons s where s.id = p_season
$function$;

create or replace function public.holiday_week(p_wed date, p_keys text[])
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  /* v4.40: CG.holidayWeek. The observed holiday in the Monday to Sunday week around a game Wednesday, or null. */
  select u.k
    from generate_series(0, 6) i, unnest(p_keys) with ordinality u(k, o)
   where public.holiday_date(u.k, extract(year from p_wed - 2 + i)::int) = p_wed - 2 + i
   order by i, u.o
   limit 1
$function$;

create or replace function public.playoff_game_week(p_season uuid, p_anchor date)
 returns date[]
 language plpgsql
 stable
 set search_path to ''
as $function$
declare v_keys text[]; v_nights int; v_wed date := p_anchor; v_guard int := 0;
begin
  /* v4.40: CG.gameNights for one week. Snap to the Wednesday on or after the anchor, step over any week holding a holiday
     the season observes (Rule 0.8), and lay out the season's nights from that Wednesday. */
  if p_anchor is null then raise exception 'a game week needs an anchor date'; end if;
  select greatest(1, least(7, coalesce(nullif(s.nights_per_week, 0), 3))) into v_nights
    from public.seasons s where s.id = p_season;
  if v_nights is null then raise exception 'no such season %', p_season; end if;
  v_keys := coalesce(public.season_holiday_keys(p_season), '{}'::text[]);
  while extract(dow from v_wed)::int <> 3 loop v_wed := v_wed + 1; end loop;
  while public.holiday_week(v_wed, v_keys) is not null loop
    v_guard := v_guard + 1;
    if v_guard > 120 then raise exception 'no game week clear of holidays within 120 weeks of %', p_anchor; end if;
    v_wed := v_wed + 7;
  end loop;
  return array(select v_wed + i from generate_series(0, v_nights - 1) i order by i);
end $function$;

-- Part 2: the season table, ordered as the standings page orders it.

create or replace function public.standings_order(p_season uuid, p_division text default null)
 returns table(pos int, team_id uuid, code text, division text, pts int, h2h int, rw int, diff int, gf int, unbroken boolean)
 language sql
 stable
 set search_path to ''
as $function$
  /* v4.40: CG.standings (src/live/part2_engine.js) for one division, or the whole league when p_division is null, from the
     regular-season finals that count (not voided, a score on file) exactly as CG.aggregate scores them:
       - a win is two points and an overtime loss one; a forfeit decides the game whatever the goals say, is a regulation
         result and never earns the overtime point (Rules 8.1 and 8.2);
       - goals for and against are the goals on file, a forfeit's played goals included (Rule 8.2).
     Ties on points go to head-to-head points among EVERY club level on those points in the scope (CG.h2hPoints: a win two,
     an overtime loss by one goal one), then regulation wins, goal differential and goals scored. unbroken marks a club
     still level with another after all of them (Rule 8.2: a one-game play-in); its place then falls to division and
     code, the order the site's team list keeps. */
  with g as (
    select x.home_team_id, x.away_team_id, x.home_score, x.away_score, x.forfeit_team_id, x.went_ot as ot
      from public.games x
     where x.season_id = p_season and coalesce(x.stage, 'regular') = 'regular' and x.status = 'final'
       and not x.voided and x.home_score is not null and x.away_score is not null),
  side as (
    select g.home_team_id as tid, g.away_team_id as oid, g.home_score as mine, g.away_score as theirs, g.forfeit_team_id as ff, g.ot from g
    union all
    select g.away_team_id, g.home_team_id, g.away_score, g.home_score, g.forfeit_team_id, g.ot from g),
  res as (
    select s.*, case when s.ff is not null then s.ff <> s.tid else s.mine > s.theirs end as won from side s),
  club as (
    select t.id, t.code, coalesce(nullif(t.division, ''), 'East') as division from public.teams t
     where p_division is null or coalesce(nullif(t.division, ''), 'East') = p_division),
  tot as (
    select c.id, c.code, c.division,
           coalesce(sum(case when r.won then 2 when r.ff is null and r.ot then 1 else 0 end), 0)::int as pts,
           coalesce(sum(case when r.won and (r.ff is not null or not r.ot) then 1 else 0 end), 0)::int as rw,
           coalesce(sum(r.mine - r.theirs), 0)::int as diff,
           coalesce(sum(r.mine), 0)::int as gf
      from club c left join res r on r.tid = c.id
     group by c.id, c.code, c.division),
  hh as (
    select a.id,
           coalesce(sum(case when r.won then 2 when r.ff is null and r.ot and r.mine = r.theirs - 1 then 1 else 0 end), 0)::int as h2h
      from tot a
      left join res r on r.tid = a.id and r.oid in (select b.id from tot b where b.pts = a.pts and b.id <> a.id)
     group by a.id),
  ranked as (
    select t.id, t.code, t.division, t.pts, h.h2h, t.rw, t.diff, t.gf,
           row_number() over (order by t.pts desc, h.h2h desc, t.rw desc, t.diff desc, t.gf desc,
                                       t.division collate "C", t.code collate "C")::int as pos,
           count(*) over (partition by t.pts, h.h2h, t.rw, t.diff, t.gf) > 1 as unbroken
      from tot t join hh h on h.id = t.id)
  select r.pos, r.id, r.code, r.division, r.pts, r.h2h, r.rw, r.diff, r.gf, r.unbroken from ranked r order by r.pos
$function$;

-- Part 3: the draw.

create or replace function public._playoff_seed_draw(p_season uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
declare v_per int; v_div record; v_n int; v_tie text; v_out text[] := '{}'::text[]; v_divs int;
begin
  /* v4.40: the seeds the final table gives right now, division-major as site_config playoff_seeds_<n> stores them
     ({"seeds": [...]}), or {"error": "..."} when the table cannot seed a bracket. Divisions in the site's order
     (divisions.sort_order). */
  v_per := public.playoff_per_div(p_season);
  if v_per is null or v_per < 2 then return jsonb_build_object('error', 'the season''s format names no playoff field'); end if;
  select count(*) into v_divs from public.divisions;
  if v_divs <> 2 then
    return jsonb_build_object('error', format('the bracket needs exactly two divisions for its final, and the league has %s', v_divs));
  end if;
  for v_div in select d.name from public.divisions d order by d.sort_order, d.name loop
    select count(*) into v_n from public.teams t where coalesce(nullif(t.division, ''), 'East') = v_div.name;
    if v_n < v_per then
      return jsonb_build_object('error', format('the %s division has %s clubs and the bracket takes %s from each', v_div.name, v_n, v_per));
    end if;
    /* a tie every tiebreaker leaves level matters when it touches a berth or a seed */
    select string_agg(x.code, ', ' order by x.pos) into v_tie
      from public.standings_order(p_season, v_div.name) x
     where x.unbroken and (x.pts, x.h2h, x.rw, x.diff, x.gf) in
           (select y.pts, y.h2h, y.rw, y.diff, y.gf from public.standings_order(p_season, v_div.name) y
             where y.pos <= v_per and y.unbroken);
    if v_tie is not null then
      return jsonb_build_object('error', format('%s finish level in the %s division on points and on every Rule 8.2 tiebreaker '
        '(head-to-head, regulation wins, goal differential, goals scored), so the order between them needs the one-game play-in '
        'the league office schedules (Rule 8.2). The draw waits until the tie is settled.', v_tie, v_div.name));
    end if;
    v_out := v_out || array(select x.code from public.standings_order(p_season, v_div.name) x where x.pos <= v_per order by x.pos);
  end loop;
  return jsonb_build_object('seeds', to_jsonb(v_out));
end $function$;

create or replace function public._playoff_round_series(p_season uuid, p_round int)
 returns table(a uuid, b uuid, a_wins int, b_wins int, winner uuid)
 language sql
 stable
 set search_path to ''
as $function$
  /* v4.40: every series of a round and its winner, counted the way trg_conclude_series counts them (game_winner over the
     finals: a forfeit is a win for the club that did not forfeit, a void counts for nobody). winner is null until a club
     has more than half of best-of games. */
  with gm as (
    select least(g.home_team_id::text, g.away_team_id::text)::uuid as a,
           greatest(g.home_team_id::text, g.away_team_id::text)::uuid as b,
           case when g.status = 'final'
                then public.game_winner(g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.forfeit_team_id, g.voided) end as w
      from public.games g
     where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round),
  tally as (
    select gm.a, gm.b, (count(*) filter (where gm.w = gm.a))::int as aw, (count(*) filter (where gm.w = gm.b))::int as bw
      from gm group by gm.a, gm.b)
  select t.a, t.b, t.aw, t.bw,
         case when t.aw >= x.need then t.a when t.bw >= x.need then t.b end
    from tally t, (select public.playoff_best_of(p_season) / 2 + 1 as need) x
$function$;

create or replace function public._draw_playoff_round(p_season uuid, p_round int, p_by text, p_dry boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  s public.seasons; v_per int; v_best int; v_k int; v_divs int; v_name text;
  v_seeds text[]; v_seedj jsonb; v_hi text[] := '{}'::text[]; v_lo text[] := '{}'::text[];
  v_pow int; v_games1 int; v_byes int; v_s2 int; v_blk int; v_i int; v_block text[]; v_adv text[]; v_exp int; v_have int;
  v_champs text[]; v_left int; v_today date; v_last date; v_anchor date; v_nights date[]; v_slots text[];
  v_per_night int[]; v_gi int; v_ni int; v_kk int; v_day date; v_slot time; v_host text; v_away text; v_at timestamptz;
  v_plan jsonb := '[]'::jsonb; v_series jsonb := '[]'::jsonb; v_n int := 0; v_names text;
begin
  /* v4.40: draw one playoff round of one season (Rules 8.1 to 8.3), or say why it cannot be drawn yet. Returns
       {"ok": true, ...the plan}                      drawn (or, with p_dry, what would be drawn)
       {"ok": false, "wait": "..."}                   not ready yet; the autopilot tries again in five minutes
       {"ok": false, "error": "..."}                  needs a commissioner (an unbreakable tie, a broken bracket)
     Internal: the autopilot (playoff_autopilot) and the Control Center (draw_playoff_round) are its only callers. */
  select * into s from public.seasons where id = p_season;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'no such season'); end if;
  if s.status = 'complete' then return jsonb_build_object('ok', false, 'wait', 'the season is complete'); end if;
  v_per := public.playoff_per_div(p_season); v_best := public.playoff_best_of(p_season); v_k := public.playoff_rounds(p_season);
  if v_per is null or v_per < 2 or v_best is null or v_best < 1 or v_k is null then
    return jsonb_build_object('ok', false, 'error', 'the season''s format names no playoff bracket');
  end if;
  if p_round is null or p_round < 1 or p_round > v_k then
    return jsonb_build_object('ok', false, 'error', format('the bracket has rounds 1 to %s', v_k));
  end if;
  v_name := case when p_round >= v_k then 'final' else public.playoff_round_name(p_season, p_round) || 's' end;
  /* one draw at a time per season: the five-minute job and a commissioner's Draw now cannot both write a round */
  if not p_dry then perform pg_advisory_xact_lock(hashtextextended('playoff_draw:' || p_season::text, 0)); end if;
  if exists (select 1 from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round) then
    return jsonb_build_object('ok', false, 'wait', format('the %s are already drawn', v_name));
  end if;
  if exists (select 1 from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week > p_round) then
    return jsonb_build_object('ok', false, 'error', format('a later round is already drawn, so round %s cannot be drawn under it; clear the later round first', p_round));
  end if;
  if p_round > 1 and not exists (select 1 from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round - 1) then
    return jsonb_build_object('ok', false, 'wait', 'the round before it is not drawn yet');
  end if;
  select count(*) into v_divs from public.divisions;

  /* the shape of round 1 inside one division (CG.playoffRound1): the largest power of two that fits, a play-in among the
     lowest seeds when the field is not one, and the top seeds resting through it */
  v_pow := 1; while v_pow * 2 <= v_per loop v_pow := v_pow * 2; end loop;
  v_games1 := case when v_per = v_pow then v_per / 2 else v_per - v_pow end;
  v_byes := v_per - 2 * v_games1;
  v_s2 := v_games1 + v_byes;   -- the clubs left in a division for round 2; a later round halves it

  if p_round = 1 then
    if not exists (select 1 from public.games g where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular') then
      return jsonb_build_object('ok', false, 'wait', 'the season has no regular-season games yet');
    end if;
    select count(*) into v_left from public.games g
     where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular' and g.status <> 'final' and not g.voided;
    if v_left > 0 then
      return jsonb_build_object('ok', false, 'wait', format('%s regular-season game%s still to play', v_left, case when v_left = 1 then '' else 's' end));
    end if;
    v_seedj := public._playoff_seed_draw(p_season);
    if v_seedj ? 'error' then return jsonb_build_object('ok', false, 'error', v_seedj->>'error'); end if;
    v_seeds := array(select jsonb_array_elements_text(v_seedj->'seeds'));
    for v_blk in 0 .. v_divs - 1 loop
      v_block := v_seeds[v_blk * v_per + 1 : v_blk * v_per + v_per];
      for v_i in 0 .. v_games1 - 1 loop
        v_hi := v_hi || v_block[v_byes + v_i + 1];
        v_lo := v_lo || v_block[v_per - v_i];
      end loop;
    end loop;
  else
    /* later rounds read the seeds frozen with round 1, never the live table (Rule 8.1) */
    select array(select jsonb_array_elements_text(c.value)) into v_seeds
      from public.site_config c where c.key = 'playoff_seeds_' || s.number and jsonb_typeof(c.value) = 'array';
    if coalesce(array_length(v_seeds, 1), 0) <> v_per * v_divs then
      return jsonb_build_object('ok', false, 'error', format('the seeds frozen with round 1 (site_config playoff_seeds_%s) are missing or the wrong size', s.number));
    end if;
    /* every series of the round before must be decided, and that round must hold the series it should */
    if exists (select 1 from public._playoff_round_series(p_season, p_round - 1) x where x.winner is null) then
      return jsonb_build_object('ok', false, 'wait', 'a series of the round before is still being played');
    end if;
    select count(*) into v_have from public._playoff_round_series(p_season, p_round - 1);
    v_exp := case when p_round - 1 = 1 then v_divs * v_games1 else v_divs * (v_s2 / (2 ^ (p_round - 2))::int) end;
    if v_have <> v_exp then
      return jsonb_build_object('ok', false, 'error', format('round %s holds %s series where the bracket expects %s', p_round - 1, v_have, v_exp));
    end if;
    select array(select t.code from public._playoff_round_series(p_season, p_round - 1) x join public.teams t on t.id = x.winner)
      into v_adv;
    if p_round = 2 then
      for v_blk in 0 .. v_divs - 1 loop
        v_adv := v_adv || v_seeds[v_blk * v_per + 1 : v_blk * v_per + v_byes];
      end loop;
    end if;
    if p_round = v_k then
      /* the final: one champion from each division, the higher seed the one higher in the league-wide table (Rule 8.3) */
      v_champs := array(select x.code from public.standings_order(p_season, null) x where x.code = any(v_adv) order by x.pos);
      if coalesce(array_length(v_champs, 1), 0) <> 2 then
        return jsonb_build_object('ok', false, 'error', format('the final needs two division champions and the bracket has %s', coalesce(array_length(v_champs, 1), 0)));
      end if;
      v_hi := array[v_champs[1]]; v_lo := array[v_champs[2]];
    else
      /* a divisional round: the clubs still alive in each division (its block of the frozen seeds), best against worst */
      for v_blk in 0 .. v_divs - 1 loop
        v_block := array(select x.c from unnest(v_seeds[v_blk * v_per + 1 : v_blk * v_per + v_per]) with ordinality x(c, o)
                          where x.c = any(v_adv) order by x.o);
        if coalesce(array_length(v_block, 1), 0) <> v_s2 / (2 ^ (p_round - 2))::int then
          return jsonb_build_object('ok', false, 'error', format('a division has %s clubs left for round %s where the bracket expects %s',
            coalesce(array_length(v_block, 1), 0), p_round, v_s2 / (2 ^ (p_round - 2))::int));
        end if;
        for v_i in 0 .. array_length(v_block, 1) / 2 - 1 loop
          v_hi := v_hi || v_block[v_i + 1];
          v_lo := v_lo || v_block[array_length(v_block, 1) - v_i];
        end loop;
      end loop;
    end if;
  end if;
  if coalesce(array_length(v_hi, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'the round has no series to draw');
  end if;

  /* the week: the first game-week on or after the season's playoff start, two days after the last playoff game, and
     tomorrow, whichever comes last, stepping over the season's holiday weeks (Rule 0.8) */
  v_today := (now() at time zone 'America/New_York')::date;
  select max((g.scheduled_at at time zone 'America/New_York')::date) into v_last
    from public.games g where g.season_id = p_season and g.stage = 'playoff';
  v_anchor := greatest(coalesce((s.playoffs_start_at at time zone 'America/New_York')::date, v_today + 2),
                       coalesce(v_last + 2, v_today + 1), v_today + 1);
  v_nights := public.playoff_game_week(p_season, v_anchor);
  v_slots := array(select btrim(x) from unnest(string_to_array(coalesce(s.night_slots, ''), ',')) x where btrim(x) ~ '^\d{1,2}:\d{2}$');
  if coalesce(array_length(v_slots, 1), 0) = 0 then v_slots := array['21:00', '21:35', '22:10']; end if;
  /* 2-2-3: two games the first night, two the second, the rest the third (Rule 8.3) */
  v_per_night := array[least(2, v_best), least(2, greatest(0, v_best - 2)), greatest(0, v_best - 4)];

  for v_i in 1 .. array_length(v_hi, 1) loop
    v_series := v_series || jsonb_build_object('home', v_hi[v_i], 'away', v_lo[v_i]);
    v_gi := 0;
    for v_ni in 0 .. 2 loop
      v_kk := 0;
      while v_kk < v_per_night[v_ni + 1] and v_gi < v_best loop
        /* 2-2-1-1-1 by game: the higher seed hosts games 1, 2, 5 and 7 (CG.playoffHostHigher, Rule 8.3) */
        if v_gi < 2 or (v_gi >= 4 and (v_gi - 4) % 2 = 0) then v_host := v_hi[v_i]; v_away := v_lo[v_i];
        else v_host := v_lo[v_i]; v_away := v_hi[v_i]; end if;
        v_day := coalesce(v_nights[v_ni + 1], v_nights[array_length(v_nights, 1)] + (v_ni + 1) * 2);
        /* the season's own puck-drop slots; past the last one, 35 minutes apart (CG.playoffSlot) */
        v_slot := case when v_kk < array_length(v_slots, 1) then v_slots[v_kk + 1]::time
                       else v_slots[array_length(v_slots, 1)]::time + make_interval(mins => 35 * (v_kk - array_length(v_slots, 1) + 1)) end;
        v_at := (v_day + v_slot) at time zone 'America/New_York';
        v_plan := v_plan || jsonb_build_object('game', v_gi + 1, 'home', v_host, 'away', v_away, 'at', v_at);
        if not p_dry then
          insert into public.games (season_id, week, stage, home_team_id, away_team_id, scheduled_at, status)
          values (p_season, p_round, 'playoff',
                  (select t.id from public.teams t where t.code = v_host), (select t.id from public.teams t where t.code = v_away),
                  v_at, 'scheduled');
        end if;
        v_n := v_n + 1; v_gi := v_gi + 1; v_kk := v_kk + 1;
      end loop;
    end loop;
  end loop;

  if not p_dry then
    if p_round = 1 then
      /* the seeds freeze with round 1 (Rule 8.1); trg_seeds_end_seats ends the seats of the clubs out of it (Rule 2.6) */
      insert into public.site_config (key, value) values ('playoff_seeds_' || s.number, to_jsonb(v_seeds))
        on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
    perform public.log_admin_action('playoff_round_drawn', 'season', p_season::text,
      jsonb_build_object('round', p_round, 'by', p_by, 'series', v_series, 'games', v_n, 'first_night', v_nights[1]));
    select string_agg(h.name || ' vs. ' || l.name, '; ' order by x.o) into v_names
      from unnest(v_hi, v_lo) with ordinality x(hi, lo, o)
      join public.teams h on h.code = x.hi join public.teams l on l.code = x.lo;
    perform public.notify_commissioners(null, 'check',
      format('Season %s %s drawn', s.number, v_name),
      format('%s. Best of %s, %s to %s. %s (Rule 8.3). The Control Center can pause the draw or clear a round.',
        v_names, v_best, to_char(v_nights[1], 'FMDay, FMMonth FMDD'), to_char(v_nights[array_length(v_nights, 1)], 'FMDay, FMMonth FMDD'),
        case when p_by = 'autopilot' then 'Drawn automatically' else 'Drawn from the Control Center' end),
      'admin', 'schedule');
  end if;
  return jsonb_build_object('ok', true, 'dry', p_dry, 'round', p_round, 'name', v_name, 'best_of', v_best,
    'series', v_series, 'games', v_n, 'nights', to_jsonb(v_nights), 'plan', v_plan,
    'seeds', case when p_round = 1 then to_jsonb(v_seeds) end);
end $function$;

create or replace function public._playoff_flag(p_season uuid, p_num int, p_round int, p_msg text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_key text := 'po_flag_' || p_num || '_' || p_round; v_sig text := md5(coalesce(p_msg, ''));
begin
  /* v4.40: tell the commissioners once (per message) that the draw is waiting on them */
  if (select c.value from public.app_config c where c.key = v_key) is not distinct from v_sig then return; end if;
  perform public.notify_commissioners(null, 'flag', format('The Season %s playoff draw needs a commissioner', p_num),
    format('Round %s cannot be drawn: %s', p_round, p_msg), 'admin', 'schedule');
  insert into public.app_config (key, value) values (v_key, v_sig) on conflict (key) do update set value = excluded.value;
end $function$;

create or replace function public._playoff_seed_watch(p_season uuid, p_num int)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_frozen jsonb; v_live jsonb; v_key text := 'po_reseed_' || p_num; v_sig text;
begin
  /* v4.40: once round 1 is drawn and until its first game is final, a ruling that changes the final table changes the
     bracket the table would draw. Seeding does not move on its own (Rule 8.1), so the commissioners are told, once per
     new order, and clearing round 1 redraws it from the corrected table. */
  select c.value into v_frozen from public.site_config c where c.key = 'playoff_seeds_' || p_num and jsonb_typeof(c.value) = 'array';
  if v_frozen is null then return; end if;
  if not exists (select 1 from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week = 1) then return; end if;
  if exists (select 1 from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.status = 'final') then return; end if;
  v_live := public._playoff_seed_draw(p_season);
  if v_live->'seeds' = v_frozen then return; end if;
  v_sig := md5(coalesce(v_live::text, ''));
  if (select c.value from public.app_config c where c.key = v_key) is not distinct from v_sig then return; end if;
  perform public.notify_commissioners(null, 'flag', format('The Season %s standings changed after the bracket was seeded', p_num),
    format('The bracket was seeded %s. The final table now %s. Seeding does not move on its own (Rule 8.1): to reseed, clear the '
      'opening round in the Control Center and it is drawn again from the corrected table within five minutes.',
      (select string_agg(x, ', ') from jsonb_array_elements_text(v_frozen) x),
      case when v_live ? 'error' then 'cannot seed a bracket: ' || (v_live->>'error')
           else 'seeds ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_live->'seeds') x) end),
    'admin', 'schedule');
  insert into public.app_config (key, value) values (v_key, v_sig) on conflict (key) do update set value = excluded.value;
end $function$;

create or replace function public.playoff_autopilot()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare s record; v_round int; v_res jsonb; v_out jsonb := '[]'::jsonb; v_ok boolean := true; v_err text;
begin
  /* v4.40: the pg_cron job playoff-autopilot runs this every five minutes. For each season still in play, unless a
     commissioner paused it (site_config playoff_auto_<n> {"paused": true}), it draws the first round not yet drawn once
     that round can be drawn, and watches the frozen seeds. The Control Center's Run now calls it as the signed-in
     commissioner; the scheduler runs it with no request at all. */
  if not (public.is_commissioner() or public.trusted_writer() or coalesce(current_setting('request.jwt.claims', true), '') = '') then
    raise exception 'Only a commissioner can run the playoff draw.';
  end if;
  insert into public.app_config (key, value)
    values ('rl_playoff-autopilot', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict (key) do update set value = excluded.value;
  for s in select x.id, x.number from public.seasons x where x.status <> 'complete' order by x.number loop
    begin
      if coalesce((select c.value->>'paused' from public.site_config c where c.key = 'playoff_auto_' || s.number), '') = 'true' then
        v_out := v_out || jsonb_build_object('season', s.number, 'paused', true);
        continue;
      end if;
      select min(r) into v_round from generate_series(1, public.playoff_rounds(s.id)) r
       where not exists (select 1 from public.games g where g.season_id = s.id and g.stage = 'playoff' and g.week = r);
      if v_round is not null then
        v_res := public._draw_playoff_round(s.id, v_round, 'autopilot', false);
        v_out := v_out || jsonb_build_object('season', s.number, 'round', v_round, 'result',
                   jsonb_build_object('ok', v_res->'ok', 'wait', v_res->'wait', 'error', v_res->'error', 'games', v_res->'games'));
        if v_res ? 'error' then perform public._playoff_flag(s.id, s.number, v_round, v_res->>'error'); end if;
      end if;
      perform public._playoff_seed_watch(s.id, s.number);
    exception when others then
      /* one season's failure never stops another's draw; it is recorded below, where the automation watchdog reads it */
      v_ok := false; v_err := format('Season %s: %s', s.number, sqlerrm);
      v_out := v_out || jsonb_build_object('season', s.number, 'error', sqlerrm);
      raise warning 'playoff autopilot, season %: %', s.number, sqlerrm;
    end;
  end loop;
  insert into public.app_config (key, value)
    values ('rl_playoff-autopilot_result', jsonb_build_object('ok', v_ok, 'at', now(), 'lastError', v_err, 'seasons', v_out)::text)
    on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', v_ok, 'seasons', v_out);
end $function$;

create or replace function public.draw_playoff_round(p_season uuid, p_round int, p_dry boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  /* v4.40: the Control Center's Draw now, and its preview (p_dry). The same draw the autopilot runs; it works while the
     autopilot is paused. */
  if not public.is_commissioner() then
    raise exception 'Only a commissioner can draw a playoff round.';
  end if;
  return public._draw_playoff_round(p_season, p_round, 'commissioner', coalesce(p_dry, false));
end $function$;

revoke all on function public.holiday_rules() from public, anon, authenticated;
revoke all on function public.holiday_date(text, int) from public, anon, authenticated;
revoke all on function public.season_holiday_keys(uuid) from public, anon, authenticated;
revoke all on function public.holiday_week(date, text[]) from public, anon, authenticated;
revoke all on function public.playoff_game_week(uuid, date) from public, anon, authenticated;
revoke all on function public.standings_order(uuid, text) from public, anon, authenticated;
revoke all on function public._playoff_seed_draw(uuid) from public, anon, authenticated;
revoke all on function public._playoff_round_series(uuid, int) from public, anon, authenticated;
revoke all on function public._draw_playoff_round(uuid, int, text, boolean) from public, anon, authenticated;
revoke all on function public._playoff_flag(uuid, int, int, text) from public, anon, authenticated;
revoke all on function public._playoff_seed_watch(uuid, int) from public, anon, authenticated;
revoke all on function public.playoff_autopilot() from public, anon, authenticated;
revoke all on function public.draw_playoff_round(uuid, int, boolean) from public, anon, authenticated;
grant execute on function public.playoff_autopilot() to authenticated;
grant execute on function public.draw_playoff_round(uuid, int, boolean) to authenticated;

-- Part 4: the series news no longer sends anyone to the Control Center for the next round. Patched by exact anchor.
do $patch$
declare v_def text; v_old text := 'and the next round is set from the Control Center.'; v_n int;
begin
  v_def := pg_get_functiondef('public.trg_conclude_series()'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'v4.40 patch: trg_conclude_series holds the Control Center sentence % times, expected 1', v_n; end if;
  execute replace(v_def, v_old, 'and the next round is drawn automatically once every series in this round is decided (Rule 8.3).');
end $patch$;

-- Part 5: the watchdog knows the new job, and the job runs every five minutes.
do $patch$
declare v_def text; v_old text := '(''contract-enforcement'', interval ''1 hour''),'; v_n int;
begin
  v_def := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'v4.40 patch: automation_watchdog lists contract-enforcement % times, expected 1', v_n; end if;
  execute replace(v_def, v_old, v_old || E'\n      (''playoff-autopilot'', interval ''1 hour''),   -- v4.40: the playoff draw');
end $patch$;

select cron.schedule('playoff-autopilot', '*/5 * * * *', 'select public.playoff_autopilot()');

do $chk$
declare v_def text; v_f text;
begin
  foreach v_f in array array['holiday_rules()', 'holiday_date(text, integer)', 'season_holiday_keys(uuid)', 'holiday_week(date, text[])',
      'playoff_game_week(uuid, date)', 'standings_order(uuid, text)', '_playoff_seed_draw(uuid)', '_playoff_round_series(uuid, integer)',
      '_draw_playoff_round(uuid, integer, text, boolean)', '_playoff_flag(uuid, integer, integer, text)', '_playoff_seed_watch(uuid, integer)',
      'playoff_autopilot()', 'draw_playoff_round(uuid, integer, boolean)'] loop
    v_def := pg_get_functiondef(('public.' || v_f)::regprocedure);
    if position('search_path TO ''''' in v_def) = 0 then raise exception 'v4.40 check: % does not run with an empty search_path', v_f; end if;
    if v_f not in ('playoff_autopilot()', 'draw_playoff_round(uuid, integer, boolean)')
       and (has_function_privilege('anon', ('public.' || v_f)::regprocedure, 'EXECUTE')
            or has_function_privilege('authenticated', ('public.' || v_f)::regprocedure, 'EXECUTE')) then
      raise exception 'v4.40 check: % is callable from the API', v_f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.draw_playoff_round(uuid, integer, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.playoff_autopilot()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.draw_playoff_round(uuid, integer, boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.playoff_autopilot()', 'EXECUTE') then
    raise exception 'v4.40 check: the two client doors have the wrong grants';
  end if;
  if public.holiday_date('us-thanksgiving', 2026) <> date '2026-11-26' or public.holiday_date('easter', 2027) <> date '2027-03-28'
     or public.holiday_date('victoria-day', 2026) <> date '2026-05-18' or public.holiday_date('memorial-day', 2026) <> date '2026-05-25'
     or public.holiday_date('good-friday', 2026) <> date '2026-04-03' or public.holiday_date('nope', 2026) is not null then
    raise exception 'v4.40 check: the holiday calendar is wrong';
  end if;
  if public.holiday_week(date '2026-11-25', array['us-thanksgiving']) is distinct from 'us-thanksgiving'
     or public.holiday_week(date '2026-11-18', array['us-thanksgiving']) is not null then
    raise exception 'v4.40 check: the holiday week is wrong';
  end if;
  if position('drawn automatically once every series in this round is decided' in pg_get_functiondef('public.trg_conclude_series()'::regprocedure)) = 0
     or position('set from the Control Center' in pg_get_functiondef('public.trg_conclude_series()'::regprocedure)) > 0 then
    raise exception 'v4.40 check: the series news still sends the next round to the Control Center';
  end if;
  if position('playoff-autopilot' in pg_get_functiondef('public.automation_watchdog()'::regprocedure)) = 0 then
    raise exception 'v4.40 check: the watchdog does not watch playoff-autopilot';
  end if;
  if not exists (select 1 from cron.job where jobname = 'playoff-autopilot' and active and schedule = '*/5 * * * *'
                   and command = 'select public.playoff_autopilot()') then
    raise exception 'v4.40 check: the playoff-autopilot job is not scheduled';
  end if;
end $chk$;

/* REHEARSAL (2026-11-01): one transaction on the live database, rolled back by a closing raise. Parts 1 to 5 above ran
   first, then a probe that played a whole postseason on Season 1's real final table:
   T0  every function body installed matches this file (md5 of each prosrc against the file's text).
   T1  all twenty holidays, 2026 to 2035, land on the dates the site's own CG.holidayDate gives (md5 of the 200 dates).
   T2  the table: East BOS, NYI, DET, PIT; West VAN, SEA, UTA, DAL; the league VAN 88, SEA 84, BOS 58, NYI 57, DET 56,
       PIT 45, UTA 38, DAL 33; no unbroken tie anywhere.
   T3  the preview (p_dry) of round 1 writes nothing and shows NYI v DET and SEA v UTA, Wednesday November 4 to Friday
       November 6, fourteen games, seeds BOS NYI DET VAN SEA UTA.
   T4  paused (site_config playoff_auto_1), the autopilot draws nothing; resumed, it draws round 1 and freezes the seeds;
       the NYI v DET slate runs NYI, NYI (Wednesday 9:00 and 9:35 PM), DET, DET (Thursday), NYI, DET, NYI (Friday 9:00,
       9:35 and 10:10 PM); an audit row and an ok result are written.
   T5  running again draws nothing more, and round 2 waits on round 1.
   T6  a ruling that drops NYI below DET after seeding tells each commissioner once (two runs, one notice) and moves
       nothing.
   T7  round 1 played (NYI sweeps; SEA wins 4-1 after forfeiting game 1): the unneeded games come off, the series news
       carries the new sentence, and the autopilot draws BOS v NYI and VAN v SEA for November 11 to 13, BOS home in
       games 1, 2, 5 and 7.
   T8  the division finals played (BOS sweeps; SEA beats VAN 4-1, one game in overtime): the final is SEA at home (84
       points to 58), November 18 to 20; a second draw of it only waits.
   T9  the final played: champion, the season complete, and the autopilot leaves it alone.
   T10 a table that is all level (Season 2, no games) refuses to seed with the Rule 8.2 message, and its round 1 waits.
   T11 a signed-in member who is not a commissioner is refused at both doors; anon cannot execute either, and the
       internal draw is not callable from the API.
   Result: REHEARSAL OK: T0 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11
   (A first run stopped at T11: the championship triggers earlier in that one transaction had left its trusted-writer
   flag on, so the test caller was not plain. A request from the site starts fresh; the probe now clears the flag first.)
   Applied as migration v440_playoff_autopilot; the function bodies were checked against this file again after applying.
   The autopilot then drew Season 1's round 1 at once (NYI v DET, SEA v UTA, November 4 to 6, fourteen games, seeds
   BOS NYI DET VAN SEA UTA). Seeding ended the GM and AGM seats at PIT and DAL, as Rule 2.6 already provides.
   tools/sql/grant-audit.sql (check 4 now names draw_playoff_round) returned zero rows. */

-- Part 6 (v4.40b, same day). The commissioner, 2026-11-01, pressing the old Generate button before this shipped: "When I
-- try to manually generate round one, I get the following error: Couldn't generate: permission denied for table games".
-- Root cause: set_game_code (BEFORE INSERT on games) ran with the caller's rights, and it reads games.game_code to keep
-- each lobby code unique. The lobby code is a private column the API roles cannot read (grant audit check 2), so every
-- game a browser inserted was refused: the old playoff button, and the Control Center's season schedule generator, which
-- inserts the same way. The trigger now runs with its owner's rights. It is a trigger function, which no API role can
-- call, and it keeps its empty search_path.

alter function public.set_game_code() security definer;
revoke all on function public.set_game_code() from public, anon, authenticated;

do $chk$
begin
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.set_game_code'::regproc) then
    raise exception 'v4.40b check: set_game_code does not run with its owner''s rights';
  end if;
  if position('search_path TO ''''' in pg_get_functiondef('public.set_game_code'::regproc)) = 0 then
    raise exception 'v4.40b check: set_game_code lost its empty search_path';
  end if;
end $chk$;

/* REHEARSAL part 6 (2026-11-01): one transaction on the live database, rolled back by a closing raise.
   P0  signed in as a commissioner through the API role, an insert into games is refused with the commissioner's exact
       error, "permission denied for table games".
   P1  after part 6, the same insert goes in and set_game_code gives it a six-digit lobby code (with EXECUTE revoked).
   Result: REHEARSAL OK: P0 P1
   Applied as migration v440b_set_game_code_definer; tools/sql/grant-audit.sql returned zero rows. */

-- Part 7 (v4.40c, same day). An independent read-only review of parts 1 to 6 found eight real problems; none touches the
-- Season 1 round 1 already drawn. Fixed here:
--   * a round cleared after one of its series ended kept that series' result in app_config (series_<n>_<round>_<a>_<b>),
--     so the redrawn series never trimmed its spare games, never reported, and could raise a false "ruling changed"
--     alert: the draw now drops a round's stale results when it lays the round down, and clearing does too;
--   * clearing round 1 took two separate requests from the browser, so a five-minute tick between them could redraw the
--     round and then lose its frozen seeds: clear_playoff_round does it in one transaction under the draw's own lock;
--   * reseeding through clear-and-redraw ended the GM and AGM seats of the clubs out of the playoffs a second time, and
--     unseated anyone an Owner had named since: trg_seeds_end_seats now acts once per club per season (app_config
--     seeds_out_<n>), and a club that qualifies after all is taken off that list;
--   * a series level with no game left (a game voided) stalled the next round in silence: the draw now says so, and the
--     commissioners are told;
--   * a blocked draw showed green in Automations: the result now carries the reason as a warning (amber there);
--   * the seed watch did not run while the draw was paused: it runs either way;
--   * a playoff week is Wednesday, Thursday and Friday whatever the season's night count (Rule 8.3): with one or two
--     regular nights a week, games 3 to 7 fell on a Sunday or into the next, unchecked week;
--   * two division champions level on every Rule 8.2 tiebreaker for home ice in the final: still drawn, now flagged.
-- (The review also asked whether head-to-head for the final's home club should count only the two finalists; the
-- league-wide table is the v3.59 ruling (Q34) and stays. Nor does a same-day redraw on a playoff Wednesday keep that week:
-- the draw never lays a series into a night only hours away, by design.)

create or replace function public.playoff_game_week(p_season uuid, p_anchor date)
 returns date[]
 language plpgsql
 stable
 set search_path to ''
as $function$
declare v_keys text[]; v_wed date := p_anchor; v_guard int := 0;
begin
  /* v4.40: CG.gameNights for one week. Snap to the Wednesday on or after the anchor and step over any week holding a
     holiday the season observes (Rule 0.8). v4.40c: a playoff week is Wednesday, Thursday and Friday whatever the
     season's regular night count (Rule 8.3); with one or two nights a week the series used to spill onto a Sunday or
     into the next, unchecked week. */
  if p_anchor is null then raise exception 'a game week needs an anchor date'; end if;
  if not exists (select 1 from public.seasons s where s.id = p_season) then raise exception 'no such season %', p_season; end if;
  v_keys := coalesce(public.season_holiday_keys(p_season), '{}'::text[]);
  while extract(dow from v_wed)::int <> 3 loop v_wed := v_wed + 1; end loop;
  while public.holiday_week(v_wed, v_keys) is not null loop
    v_guard := v_guard + 1;
    if v_guard > 120 then raise exception 'no game week clear of holidays within 120 weeks of %', p_anchor; end if;
    v_wed := v_wed + 7;
  end loop;
  return array(select v_wed + i from generate_series(0, 2) i order by i);
end $function$;

create or replace function public._draw_playoff_round(p_season uuid, p_round int, p_by text, p_dry boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  s public.seasons; v_per int; v_best int; v_k int; v_divs int; v_name text;
  v_seeds text[]; v_seedj jsonb; v_hi text[] := '{}'::text[]; v_lo text[] := '{}'::text[];
  v_pow int; v_games1 int; v_byes int; v_s2 int; v_blk int; v_i int; v_block text[]; v_adv text[]; v_exp int; v_have int;
  v_champs text[]; v_left int; v_today date; v_last date; v_anchor date; v_nights date[]; v_slots text[];
  v_per_night int[]; v_gi int; v_ni int; v_kk int; v_day date; v_slot time; v_host text; v_away text; v_at timestamptz;
  v_plan jsonb := '[]'::jsonb; v_series jsonb := '[]'::jsonb; v_n int := 0; v_names text; v_stuck text; v_final_tie boolean := false;
begin
  /* v4.40: draw one playoff round of one season (Rules 8.1 to 8.3), or say why it cannot be drawn yet. Returns
       {"ok": true, ...the plan}                      drawn (or, with p_dry, what would be drawn)
       {"ok": false, "wait": "..."}                   not ready yet; the autopilot tries again in five minutes
       {"ok": false, "error": "..."}                  needs a commissioner (an unbreakable tie, a broken bracket)
     Internal: the autopilot (playoff_autopilot) and the Control Center (draw_playoff_round) are its only callers. */
  select * into s from public.seasons where id = p_season;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'no such season'); end if;
  if s.status = 'complete' then return jsonb_build_object('ok', false, 'wait', 'the season is complete'); end if;
  v_per := public.playoff_per_div(p_season); v_best := public.playoff_best_of(p_season); v_k := public.playoff_rounds(p_season);
  if v_per is null or v_per < 2 or v_best is null or v_best < 1 or v_k is null then
    return jsonb_build_object('ok', false, 'error', 'the season''s format names no playoff bracket');
  end if;
  if p_round is null or p_round < 1 or p_round > v_k then
    return jsonb_build_object('ok', false, 'error', format('the bracket has rounds 1 to %s', v_k));
  end if;
  v_name := case when p_round >= v_k then 'final' else public.playoff_round_name(p_season, p_round) || 's' end;
  /* one draw at a time per season: the five-minute job and a commissioner's Draw now cannot both write a round */
  if not p_dry then perform pg_advisory_xact_lock(hashtextextended('playoff_draw:' || p_season::text, 0)); end if;
  if exists (select 1 from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round) then
    return jsonb_build_object('ok', false, 'wait', format('the %s are already drawn', v_name));
  end if;
  if exists (select 1 from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week > p_round) then
    return jsonb_build_object('ok', false, 'error', format('a later round is already drawn, so round %s cannot be drawn under it; clear the later round first', p_round));
  end if;
  if p_round > 1 and not exists (select 1 from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round - 1) then
    return jsonb_build_object('ok', false, 'wait', 'the round before it is not drawn yet');
  end if;
  select count(*) into v_divs from public.divisions;

  /* the shape of round 1 inside one division (CG.playoffRound1): the largest power of two that fits, a play-in among the
     lowest seeds when the field is not one, and the top seeds resting through it */
  v_pow := 1; while v_pow * 2 <= v_per loop v_pow := v_pow * 2; end loop;
  v_games1 := case when v_per = v_pow then v_per / 2 else v_per - v_pow end;
  v_byes := v_per - 2 * v_games1;
  v_s2 := v_games1 + v_byes;   -- the clubs left in a division for round 2; a later round halves it

  if p_round = 1 then
    if not exists (select 1 from public.games g where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular') then
      return jsonb_build_object('ok', false, 'wait', 'the season has no regular-season games yet');
    end if;
    select count(*) into v_left from public.games g
     where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular' and g.status <> 'final' and not g.voided;
    if v_left > 0 then
      return jsonb_build_object('ok', false, 'wait', format('%s regular-season game%s still to play', v_left, case when v_left = 1 then '' else 's' end));
    end if;
    v_seedj := public._playoff_seed_draw(p_season);
    if v_seedj ? 'error' then return jsonb_build_object('ok', false, 'error', v_seedj->>'error'); end if;
    v_seeds := array(select jsonb_array_elements_text(v_seedj->'seeds'));
    for v_blk in 0 .. v_divs - 1 loop
      v_block := v_seeds[v_blk * v_per + 1 : v_blk * v_per + v_per];
      for v_i in 0 .. v_games1 - 1 loop
        v_hi := v_hi || v_block[v_byes + v_i + 1];
        v_lo := v_lo || v_block[v_per - v_i];
      end loop;
    end loop;
  else
    /* later rounds read the seeds frozen with round 1, never the live table (Rule 8.1) */
    select array(select jsonb_array_elements_text(c.value)) into v_seeds
      from public.site_config c where c.key = 'playoff_seeds_' || s.number and jsonb_typeof(c.value) = 'array';
    if coalesce(array_length(v_seeds, 1), 0) <> v_per * v_divs then
      return jsonb_build_object('ok', false, 'error', format('the seeds frozen with round 1 (site_config playoff_seeds_%s) are missing or the wrong size', s.number));
    end if;
    /* v4.40c: a series level with no game left to play (a game voided, say) never decides itself: the commissioners are
       told instead of the bracket waiting in silence */
    select string_agg(ta.name || ' v ' || tb.name, '; ') into v_stuck
      from public._playoff_round_series(p_season, p_round - 1) x
      join public.teams ta on ta.id = x.a join public.teams tb on tb.id = x.b
     where x.winner is null
       and not exists (select 1 from public.games g
                        where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round - 1
                          and g.status = 'scheduled' and not g.voided
                          and ((g.home_team_id = x.a and g.away_team_id = x.b) or (g.home_team_id = x.b and g.away_team_id = x.a)));
    if v_stuck is not null then
      return jsonb_build_object('ok', false, 'error', format('%s: no series winner and no game left to play, so the series needs a game '
        'scheduled by the league office before round %s can be drawn (Rule 8.3)', v_stuck, p_round));
    end if;
    /* every series of the round before must be decided, and that round must hold the series it should */
    if exists (select 1 from public._playoff_round_series(p_season, p_round - 1) x where x.winner is null) then
      return jsonb_build_object('ok', false, 'wait', 'a series of the round before is still being played');
    end if;
    select count(*) into v_have from public._playoff_round_series(p_season, p_round - 1);
    v_exp := case when p_round - 1 = 1 then v_divs * v_games1 else v_divs * (v_s2 / (2 ^ (p_round - 2))::int) end;
    if v_have <> v_exp then
      return jsonb_build_object('ok', false, 'error', format('round %s holds %s series where the bracket expects %s', p_round - 1, v_have, v_exp));
    end if;
    select array(select t.code from public._playoff_round_series(p_season, p_round - 1) x join public.teams t on t.id = x.winner)
      into v_adv;
    if p_round = 2 then
      for v_blk in 0 .. v_divs - 1 loop
        v_adv := v_adv || v_seeds[v_blk * v_per + 1 : v_blk * v_per + v_byes];
      end loop;
    end if;
    if p_round = v_k then
      /* the final: one champion from each division, the higher seed the one higher in the league-wide table (Rule 8.3) */
      v_champs := array(select x.code from public.standings_order(p_season, null) x where x.code = any(v_adv) order by x.pos);
      if coalesce(array_length(v_champs, 1), 0) <> 2 then
        return jsonb_build_object('ok', false, 'error', format('the final needs two division champions and the bracket has %s', coalesce(array_length(v_champs, 1), 0)));
      end if;
      v_hi := array[v_champs[1]]; v_lo := array[v_champs[2]];
      /* v4.40c: level on every Rule 8.2 tiebreaker, the order above falls to division and code; the final is still drawn
         (a stalled championship helps nobody) but the commissioners are told that home ice needs their ruling */
      v_final_tie := (select count(distinct (x.pts, x.h2h, x.rw, x.diff, x.gf)) from public.standings_order(p_season, null) x
                       where x.code = any(v_champs)) = 1;
    else
      /* a divisional round: the clubs still alive in each division (its block of the frozen seeds), best against worst */
      for v_blk in 0 .. v_divs - 1 loop
        v_block := array(select x.c from unnest(v_seeds[v_blk * v_per + 1 : v_blk * v_per + v_per]) with ordinality x(c, o)
                          where x.c = any(v_adv) order by x.o);
        if coalesce(array_length(v_block, 1), 0) <> v_s2 / (2 ^ (p_round - 2))::int then
          return jsonb_build_object('ok', false, 'error', format('a division has %s clubs left for round %s where the bracket expects %s',
            coalesce(array_length(v_block, 1), 0), p_round, v_s2 / (2 ^ (p_round - 2))::int));
        end if;
        for v_i in 0 .. array_length(v_block, 1) / 2 - 1 loop
          v_hi := v_hi || v_block[v_i + 1];
          v_lo := v_lo || v_block[array_length(v_block, 1) - v_i];
        end loop;
      end loop;
    end if;
  end if;
  if coalesce(array_length(v_hi, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'the round has no series to draw');
  end if;

  /* the week: the first game-week on or after the season's playoff start, two days after the last playoff game, and
     tomorrow, whichever comes last, stepping over the season's holiday weeks (Rule 0.8) */
  v_today := (now() at time zone 'America/New_York')::date;
  select max((g.scheduled_at at time zone 'America/New_York')::date) into v_last
    from public.games g where g.season_id = p_season and g.stage = 'playoff';
  v_anchor := greatest(coalesce((s.playoffs_start_at at time zone 'America/New_York')::date, v_today + 2),
                       coalesce(v_last + 2, v_today + 1), v_today + 1);
  v_nights := public.playoff_game_week(p_season, v_anchor);
  v_slots := array(select btrim(x) from unnest(string_to_array(coalesce(s.night_slots, ''), ',')) x where btrim(x) ~ '^\d{1,2}:\d{2}$');
  if coalesce(array_length(v_slots, 1), 0) = 0 then v_slots := array['21:00', '21:35', '22:10']; end if;
  /* 2-2-3: two games the first night, two the second, the rest the third (Rule 8.3) */
  v_per_night := array[least(2, v_best), least(2, greatest(0, v_best - 2)), greatest(0, v_best - 4)];

  for v_i in 1 .. array_length(v_hi, 1) loop
    v_series := v_series || jsonb_build_object('home', v_hi[v_i], 'away', v_lo[v_i]);
    v_gi := 0;
    for v_ni in 0 .. 2 loop
      v_kk := 0;
      while v_kk < v_per_night[v_ni + 1] and v_gi < v_best loop
        /* 2-2-1-1-1 by game: the higher seed hosts games 1, 2, 5 and 7 (CG.playoffHostHigher, Rule 8.3) */
        if v_gi < 2 or (v_gi >= 4 and (v_gi - 4) % 2 = 0) then v_host := v_hi[v_i]; v_away := v_lo[v_i];
        else v_host := v_lo[v_i]; v_away := v_hi[v_i]; end if;
        v_day := v_nights[v_ni + 1];   -- v4.40c: always the week's Wednesday, Thursday and Friday (Rule 8.3)
        /* the season's own puck-drop slots; past the last one, 35 minutes apart (CG.playoffSlot) */
        v_slot := case when v_kk < array_length(v_slots, 1) then v_slots[v_kk + 1]::time
                       else v_slots[array_length(v_slots, 1)]::time + make_interval(mins => 35 * (v_kk - array_length(v_slots, 1) + 1)) end;
        v_at := (v_day + v_slot) at time zone 'America/New_York';
        v_plan := v_plan || jsonb_build_object('game', v_gi + 1, 'home', v_host, 'away', v_away, 'at', v_at);
        if not p_dry then
          insert into public.games (season_id, week, stage, home_team_id, away_team_id, scheduled_at, status)
          values (p_season, p_round, 'playoff',
                  (select t.id from public.teams t where t.code = v_host), (select t.id from public.teams t where t.code = v_away),
                  v_at, 'scheduled');
        end if;
        v_n := v_n + 1; v_gi := v_gi + 1; v_kk := v_kk + 1;
      end loop;
    end loop;
  end loop;

  if not p_dry then
    /* v4.40c: the round had no games, so any series result kept for it belongs to a cleared draw; left in place it would
       stop trg_conclude_series from trimming, reporting and ending seats for the redrawn series. No game of the round
       can be final yet, so dropping them here, in the same transaction as the inserts, is safe. */
    delete from public.app_config c where c.key like 'series!_' || s.number || '!_' || p_round || '!_%' escape '!';
    if p_round = 1 then
      /* the seeds freeze with round 1 (Rule 8.1); trg_seeds_end_seats ends the seats of the clubs out of it (Rule 2.6) */
      insert into public.site_config (key, value) values ('playoff_seeds_' || s.number, to_jsonb(v_seeds))
        on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
    perform public.log_admin_action('playoff_round_drawn', 'season', p_season::text,
      jsonb_build_object('round', p_round, 'by', p_by, 'series', v_series, 'games', v_n, 'first_night', v_nights[1]));
    select string_agg(h.name || ' vs. ' || l.name, '; ' order by x.o) into v_names
      from unnest(v_hi, v_lo) with ordinality x(hi, lo, o)
      join public.teams h on h.code = x.hi join public.teams l on l.code = x.lo;
    perform public.notify_commissioners(null, 'check',
      format('Season %s %s drawn', s.number, v_name),
      format('%s. Best of %s, %s to %s. %s (Rule 8.3). The Control Center can pause the draw or clear a round.',
        v_names, v_best, to_char(v_nights[1], 'FMDay, FMMonth FMDD'), to_char(v_nights[array_length(v_nights, 1)], 'FMDay, FMMonth FMDD'),
        case when p_by = 'autopilot' then 'Drawn automatically' else 'Drawn from the Control Center' end),
      'admin', 'schedule');
    if v_final_tie then
      perform public.notify_commissioners(null, 'flag', format('Season %s final: home ice needs a ruling', s.number),
        format('%s and %s finish level on points and on every Rule 8.2 tiebreaker, so the final was drawn with %s at home by '
          'division order. Rule 8.2 calls for a one-game play-in scheduled by the league office; rule on home ice before game 1.',
          v_champs[1], v_champs[2], v_champs[1]), 'admin', 'schedule');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'dry', p_dry, 'round', p_round, 'name', v_name, 'best_of', v_best,
    'series', v_series, 'games', v_n, 'nights', to_jsonb(v_nights), 'plan', v_plan,
    'seeds', case when p_round = 1 then to_jsonb(v_seeds) end);
end $function$;

create or replace function public.playoff_autopilot()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare s record; v_round int; v_res jsonb; v_out jsonb := '[]'::jsonb; v_ok boolean := true; v_err text; v_warn text;
begin
  /* v4.40: the pg_cron job playoff-autopilot runs this every five minutes. For each season still in play, unless a
     commissioner paused it (site_config playoff_auto_<n> {"paused": true}), it draws the first round not yet drawn once
     that round can be drawn, and watches the frozen seeds. The Control Center's Run now calls it as the signed-in
     commissioner; the scheduler runs it with no request at all. */
  if not (public.is_commissioner() or public.trusted_writer() or coalesce(current_setting('request.jwt.claims', true), '') = '') then
    raise exception 'Only a commissioner can run the playoff draw.';
  end if;
  insert into public.app_config (key, value)
    values ('rl_playoff-autopilot', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict (key) do update set value = excluded.value;
  for s in select x.id, x.number from public.seasons x where x.status <> 'complete' order by x.number loop
    begin
      /* v4.40c: the seed watch runs whether or not the draw is paused */
      perform public._playoff_seed_watch(s.id, s.number);
      if coalesce((select c.value->>'paused' from public.site_config c where c.key = 'playoff_auto_' || s.number), '') = 'true' then
        v_out := v_out || jsonb_build_object('season', s.number, 'paused', true);
        continue;
      end if;
      select min(r) into v_round from generate_series(1, public.playoff_rounds(s.id)) r
       where not exists (select 1 from public.games g where g.season_id = s.id and g.stage = 'playoff' and g.week = r);
      if v_round is not null then
        v_res := public._draw_playoff_round(s.id, v_round, 'autopilot', false);
        v_out := v_out || jsonb_build_object('season', s.number, 'round', v_round, 'result',
                   jsonb_build_object('ok', v_res->'ok', 'wait', v_res->'wait', 'error', v_res->'error', 'games', v_res->'games'));
        if v_res ? 'error' then
          perform public._playoff_flag(s.id, s.number, v_round, v_res->>'error');
          /* v4.40c: the job ran, so it stays ok, but Automations shows the reason in amber (res.warning) */
          v_warn := coalesce(v_warn, format('Season %s round %s: %s', s.number, v_round, v_res->>'error'));
        end if;
      end if;
    exception when others then
      /* one season's failure never stops another's draw; it is recorded below, where the automation watchdog reads it */
      v_ok := false; v_err := format('Season %s: %s', s.number, sqlerrm);
      v_out := v_out || jsonb_build_object('season', s.number, 'error', sqlerrm);
      raise warning 'playoff autopilot, season %: %', s.number, sqlerrm;
    end;
  end loop;
  insert into public.app_config (key, value)
    values ('rl_playoff-autopilot_result', jsonb_build_object('ok', v_ok, 'at', now(), 'lastError', v_err, 'warning', v_warn, 'seasons', v_out)::text)
    on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', v_ok, 'seasons', v_out);
end $function$;

create or replace function public.clear_playoff_round(p_season uuid, p_round int)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare s public.seasons; v_games int; v_finals int; v_seeds int := 0;
begin
  /* v4.40c: the Control Center's Clear this round, in one transaction under the draw's own lock (it used to be two
     requests from the browser, and a five-minute tick between them could redraw the round and lose its seeds). Takes the
     round's games (their box scores go with them), the series results kept for the round, and for round 1 the frozen
     seeds, so the next draw starts clean. Refused while a later round exists. */
  if not public.is_commissioner() then
    raise exception 'Only a commissioner can clear a playoff round.';
  end if;
  select * into s from public.seasons where id = p_season;
  if s.id is null then raise exception 'no such season'; end if;
  perform pg_advisory_xact_lock(hashtextextended('playoff_draw:' || p_season::text, 0));
  if exists (select 1 from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week > p_round) then
    raise exception 'A later round is drawn. Clear the later rounds first, from the last one back.';
  end if;
  select count(*), count(*) filter (where g.status <> 'scheduled') into v_games, v_finals
    from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round;
  delete from public.games g where g.season_id = p_season and g.stage = 'playoff' and g.week = p_round;
  delete from public.app_config c where c.key like 'series!_' || s.number || '!_' || p_round || '!_%' escape '!';
  if p_round = 1 then
    delete from public.site_config c where c.key = 'playoff_seeds_' || s.number;
    get diagnostics v_seeds = row_count;
  end if;
  perform public.log_admin_action('playoff_clear', 'season', p_season::text,
    jsonb_build_object('round', p_round, 'games', v_games, 'played', v_finals, 'seeds_unlocked', v_seeds > 0));
  return jsonb_build_object('games', v_games, 'played', v_finals, 'seeds_unlocked', v_seeds > 0);
end $function$;

create or replace function public.trg_seeds_end_seats()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_codes text[]; t record; v_n int := 0; v_key text; v_done text[];
begin
  if new.key not like 'playoff\_seeds\_%' or jsonb_typeof(new.value) <> 'array' then return new; end if;
  if split_part(new.key, '_', 3) <> public.current_season_num()::text then return new; end if;
  select array_agg(x) into v_codes from jsonb_array_elements_text(new.value) x;
  if coalesce(array_length(v_codes, 1), 0) = 0 then return new; end if;
  /* v4.40c: once per club per season. A reseed (clear round 1, draw it again) used to end the seats of every club out of
     the playoffs a second time, unseating anyone its Owner had named for next season since. app_config seeds_out_<n>
     holds the clubs already handled; a club that qualifies after all comes off it, so dropping out again is handled. */
  v_key := 'seeds_out_' || split_part(new.key, '_', 3);
  select coalesce(array(select jsonb_array_elements_text(c.value::jsonb)), '{}'::text[]) into v_done
    from public.app_config c where c.key = v_key;
  v_done := coalesce(v_done, '{}'::text[]);
  for t in select tm.id from public.teams tm where not (tm.code = any(v_codes)) and not (tm.code = any(v_done)) loop
    v_n := v_n + public.end_season_mgmt_seats(t.id, 'did not qualify for the playoffs');
  end loop;
  insert into public.app_config (key, value)
    values (v_key, coalesce((select to_jsonb(array_agg(tm.code order by tm.code)) from public.teams tm where not (tm.code = any(v_codes))), '[]'::jsonb)::text)
    on conflict (key) do update set value = excluded.value;
  if v_n > 0 then
    perform public.notify_commissioners(null, 'flag', 'GM and AGM seats ended for the clubs out of the playoffs',
      v_n||' seat(s) ended when the bracket was seeded (Rule 2.6). If round 1 is cleared and reseeded, clubs that qualify after all need their management reseated under Teams.',
      'admin', null);
  end if;
  return new;
end $function$;

revoke all on function public.clear_playoff_round(uuid, int) from public, anon, authenticated;
grant execute on function public.clear_playoff_round(uuid, int) to authenticated;
revoke all on function public.trg_seeds_end_seats() from public, anon, authenticated;

-- the seasons already seeded record the clubs already handled, so a reseed of Season 1 leaves PIT and DAL alone
insert into public.app_config (key, value)
select 'seeds_out_' || split_part(c.key, '_', 3),
       coalesce((select to_jsonb(array_agg(tm.code order by tm.code)) from public.teams tm
                  where not (tm.code = any(array(select jsonb_array_elements_text(c.value))))), '[]'::jsonb)::text
  from public.site_config c
 where c.key like 'playoff\_seeds\_%' and jsonb_typeof(c.value) = 'array'
on conflict (key) do nothing;

do $chk$
begin
  if position('generate_series(0, 2)' in pg_get_functiondef('public.playoff_game_week(uuid, date)'::regprocedure)) = 0 then
    raise exception 'v4.40c check: a playoff week is not Wednesday to Friday';
  end if;
  if position('series!_' in pg_get_functiondef('public._draw_playoff_round(uuid, integer, text, boolean)'::regprocedure)) = 0
     or position('no series winner and no game left to play' in pg_get_functiondef('public._draw_playoff_round(uuid, integer, text, boolean)'::regprocedure)) = 0
     or position('v_final_tie' in pg_get_functiondef('public._draw_playoff_round(uuid, integer, text, boolean)'::regprocedure)) = 0 then
    raise exception 'v4.40c check: the draw is missing a fix';
  end if;
  if position('''warning'', v_warn' in pg_get_functiondef('public.playoff_autopilot()'::regprocedure)) = 0 then
    raise exception 'v4.40c check: the autopilot does not report a blocked draw';
  end if;
  if position('seeds_out_' in pg_get_functiondef('public.trg_seeds_end_seats()'::regprocedure)) = 0
     or position('search_path TO ''''' in pg_get_functiondef('public.trg_seeds_end_seats()'::regprocedure)) = 0 then
    raise exception 'v4.40c check: the seeds trigger does not act once per club';
  end if;
  if has_function_privilege('anon', 'public.clear_playoff_round(uuid, integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.clear_playoff_round(uuid, integer)', 'EXECUTE') then
    raise exception 'v4.40c check: clear_playoff_round has the wrong grants';
  end if;
  if exists (select 1 from public.site_config c where c.key like 'playoff\_seeds\_%'
               and not exists (select 1 from public.app_config a where a.key = 'seeds_out_' || split_part(c.key, '_', 3))) then
    raise exception 'v4.40c check: a seeded season has no seeds_out marker';
  end if;
end $chk$;

/* REHEARSAL part 7 (2026-11-01): one transaction on the live database, rolled back by a closing raise. Part 7 ran first,
   then a probe on Season 1 with round 1 drawn:
   R0  every function body installed matches this file.
   R1  with Season 2 set to one night a week inside the probe, its playoff week is still Wednesday to Friday.
   R2  seeds_out_1 records DAL and PIT, the clubs handled when round 1 was seeded.
   R3  with the draw paused, a ruling that drops NYI below DET still tells the commissioners.
   R4  clear_playoff_round refuses a member who is not a commissioner, refuses while a later round exists, and otherwise
       takes the fourteen games and the frozen seeds in one go.
   R5  the redraw reseeds BOS NYI DET VAN SEA UTA without ending anyone's seat again, drops a stale series result left
       for the round, and the redrawn NYI sweep trims its spare games.
   R6  a series level at 3-3 with game 7 voided tells the commissioners, the result stays ok with a warning, and round 2
       is not drawn.
   Result: REHEARSAL OK: R0 R1 R2 R3 R4 R5 R6
   (A first run stopped at R5 on the probe itself: inserting a stale series result to simulate one fired the real series
   trigger, which ended DET's seats inside the probe. The count now starts after that insert.)
   Applied as migration v440c_playoff_review_fixes; the installed bodies were checked against this file again afterwards, and
   tools/sql/grant-audit.sql (check 4 now also names clear_playoff_round) returned zero rows. */
