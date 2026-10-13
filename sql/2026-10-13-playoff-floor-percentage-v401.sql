-- v4.01 (2026-10-13): the playoff eligibility floor is thirty percent of the season's regular-season schedule, always.
--
-- Commissioner, 2026-10-13, asked whether Season 2's floor of 17 (30% of 54 = 16.2, rounded up) should become 16 under the
-- .4 rule of v4.00: "Keep the same percentage no matter what we end up making the season length to be."
-- So the floor is no longer a figure set by hand for each season. It is 30% of a club's regular-season games, rounded the
-- v4.00 way (a fraction of .4 or less down, above .4 up), and it follows the season's length by itself: change the weeks,
-- the nights a week or the puck-drop times and the floor moves with them.
--   Season 1: 6 weeks x 3 nights x 3 slots = 54 games, 16.2 -> 16 (unchanged)
--   Season 2: 54 games, 16.2 -> 16 (was 17)
-- The length is read exactly as the site's CG.seasonShape reads it (weeks x nights a week x puck-drop times, the same
-- defaults), so the schedule generator, the published rulebook and the floor cannot disagree. Integer arithmetic, so a
-- season whose share lands exactly on .4 (48 games: 14.4) rounds down on both sides.
-- seasons.playoff_min_gp stays the column every reader already reads (season_rules, playoff_min_gp(), the site); a trigger
-- now writes it, for the basic format. The full format, held in reserve, has no floor (v2.7) and is left alone.

create or replace function public.season_games_per_club(p_weeks int, p_nights int, p_slots text)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  /* the mirror of CG.seasonShape: puck-drop times parsed from the comma list (three by default), nights a week clamped
     to 1..7 (three by default), weeks as set, else what 72 games need at that shape */
  with sl as (select count(*)::int as n from unnest(string_to_array(coalesce(p_slots, ''), ',')) t
               where btrim(t) ~ '^\d{1,2}:\d{2}$'),
       sh as (select case when sl.n > 0 then sl.n else 3 end as slots,
                     greatest(1, least(7, coalesce(nullif(p_nights, 0), 3))) as nights from sl)
  select greatest(1, coalesce(nullif(p_weeks, 0), ceil(72.0 / sh.slots / sh.nights)::int)) * sh.nights * sh.slots from sh
$function$;

create or replace function public.playoff_floor_of_length(p_games int)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  /* Rule 8.3 (v4.01): thirty percent of the regular-season schedule, a fraction of .4 or less down (v4.00) */
  select case when (coalesce(p_games, 0) * 30) % 100 > 40 then (coalesce(p_games, 0) * 30) / 100 + 1
              else (coalesce(p_games, 0) * 30) / 100 end
$function$;

create or replace function public.season_playoff_floor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(new.format, 'basic') = 'basic' then
    /* a row without weeks reads the format's weeks (6 in the basic format), as the site does */
    new.playoff_min_gp := public.playoff_floor_of_length(
      public.season_games_per_club(coalesce(nullif(new.weeks, 0), (public.format_rules('basic')->>'weeks')::int),
                                   new.nights_per_week, new.night_slots));
  end if;
  return new;
end $function$;
revoke execute on function public.season_playoff_floor() from public, anon, authenticated;
drop trigger if exists season_playoff_floor_trg on public.seasons;
create trigger season_playoff_floor_trg before insert or update on public.seasons
  for each row execute function public.season_playoff_floor();

-- every basic season not yet complete takes its floor from its length now (Season 1 stays 16; Season 2 becomes 16)
update public.seasons set playoff_min_gp = playoff_min_gp where coalesce(format, 'basic') = 'basic' and status <> 'complete';

do $chk$
begin
  if public.playoff_floor_of_length(54) <> 16 or public.playoff_floor_of_length(48) <> 14 or public.playoff_floor_of_length(60) <> 18
     or public.playoff_floor_of_length(45) <> 14 or public.playoff_floor_of_length(42) <> 13 then
    raise exception 'v4.01: the percentage rounds wrongly';
  end if;
  if (select playoff_min_gp from public.seasons where number = 1) <> 16 then raise exception 'v4.01: Season 1 moved'; end if;
  if (select playoff_min_gp from public.seasons where number = 2) <> 16 then raise exception 'v4.01: Season 2 is not 16'; end if;
end $chk$;

-- ---------------------------------------------------------------------------------------------------------------------
-- v4.01, second part (migration v401_playoff_floor_schedule_length), after a read-only review:
--  * The floor follows the season's ACTUAL schedule once it exists: thirty percent of the most regular-season games any
--    club has (voided games aside, as the prorated floor counts them). Before the schedule is built it is read from the
--    season's shape. So a "Save shape" on a season already being played (Control Center, Schedule) no longer moves its
--    floor while its games stay as they are, and an odd number of clubs (each club plays fewer games, a bye every slot)
--    gets thirty percent of what is really played.
--  * Building or removing games refreshes the floor (statement triggers on games, insert and delete only, so a score
--    import never touches the season row).
--  * The shape is read exactly as the generator reads it (CG.seasonShape): no weeks means what 72 games need, slots are
--    trimmed of any whitespace and must be ASCII digits.
--  * Capped at 200, the seasons check constraint, so an absurd shape can never fail the status-flip job's writes.

create or replace function public.season_games_per_club(p_weeks int, p_nights int, p_slots text)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  /* the mirror of CG.seasonShape (the generator's own reading): puck-drop times parsed from the comma list, trimmed of
     any whitespace, three by default; nights a week clamped to 1..7, three by default; weeks as set, else what 72
     games need at that shape */
  with sl as (select count(*)::int as n from unnest(string_to_array(coalesce(p_slots, ''), ',')) t
               where regexp_replace(t, '^[\s\u00a0\ufeff]+|[\s\u00a0\ufeff]+$', '', 'g') ~ '^[0-9]{1,2}:[0-9]{2}$'),
       sh as (select case when sl.n > 0 then sl.n else 3 end as slots,
                     greatest(1, least(7, coalesce(nullif(p_nights, 0), 3))) as nights from sl)
  select greatest(1, coalesce(nullif(p_weeks, 0), ceil(72.0 / sh.slots / sh.nights)::int)) * sh.nights * sh.slots from sh
$function$;

create or replace function public.season_schedule_length(p_season uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  /* the most regular-season games any club has in the season's schedule, voided games aside; null before it is built */
  select max(c)::int from (
    select v.t, count(*) as c
      from public.games g cross join lateral (values (g.home_team_id), (g.away_team_id)) v(t)
     where g.season_id = p_season and coalesce(g.stage, 'regular') = 'regular' and not coalesce(g.voided, false) and v.t is not null
     group by v.t) x
$function$;
revoke execute on function public.season_schedule_length(uuid) from public, anon, authenticated;

create or replace function public.season_playoff_floor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_len int;
begin
  if coalesce(new.format, 'basic') = 'basic' then
    /* Rule 8.3 (v4.01): thirty percent of the season's length, the schedule once it is built, else the season's shape */
    v_len := public.season_schedule_length(new.id);
    if v_len is null then
      v_len := public.season_games_per_club(new.weeks, new.nights_per_week, new.night_slots);
    end if;
    new.playoff_min_gp := least(200, public.playoff_floor_of_length(v_len));
  end if;
  return new;
end $function$;
revoke execute on function public.season_playoff_floor() from public, anon, authenticated;

create or replace function public.games_refresh_playoff_floor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  /* a schedule built, extended or cut: the seasons it touched take their floor from it (season_playoff_floor_trg) */
  if tg_op = 'INSERT' then
    update public.seasons s set playoff_min_gp = s.playoff_min_gp
     where s.id in (select distinct n.season_id from new_rows n) and coalesce(s.format, 'basic') = 'basic';
  else
    update public.seasons s set playoff_min_gp = s.playoff_min_gp
     where s.id in (select distinct o.season_id from old_rows o) and coalesce(s.format, 'basic') = 'basic';
  end if;
  return null;
end $function$;
revoke execute on function public.games_refresh_playoff_floor() from public, anon, authenticated;
drop trigger if exists games_playoff_floor_ins on public.games;
drop trigger if exists games_playoff_floor_del on public.games;
create trigger games_playoff_floor_ins after insert on public.games
  referencing new table as new_rows for each statement execute function public.games_refresh_playoff_floor();
create trigger games_playoff_floor_del after delete on public.games
  referencing old table as old_rows for each statement execute function public.games_refresh_playoff_floor();

update public.seasons set playoff_min_gp = playoff_min_gp where coalesce(format, 'basic') = 'basic' and status <> 'complete';

do $chk$
begin
  if (select playoff_min_gp from public.seasons where number = 1) <> 16 then raise exception 'v4.01b: Season 1 moved'; end if;
  if (select playoff_min_gp from public.seasons where number = 2) <> 16 then raise exception 'v4.01b: Season 2 is not 16'; end if;
  if public.season_schedule_length((select id from public.seasons where number = 1)) <> 54 then raise exception 'v4.01b: Season 1 is not 54 games'; end if;
  if public.season_games_per_club(null, 3, '21:00,21:35,22:10') <> 72 or public.season_games_per_club(6, 3, E' 21:00\r\n,21:35\t,22:10 ') <> 54 then
    raise exception 'v4.01b: the shape is not read as the generator reads it';
  end if;
end $chk$;
