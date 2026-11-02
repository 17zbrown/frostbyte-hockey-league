-- Built as v4.41 (migration v441_season1_playoff_floor_14), ships as v4.43: v4.41 and v4.42 went to other releases first.
-- v4.41 (2026-11-01): Season 1's playoff eligibility floor is fourteen games, by the commissioner's ruling, and every
-- prorated floor is the same share of fourteen.
-- Commissioner, 2026-11-01: "Edit the season 1 post season eligibility game requirements from 16 GP to 14 GP and edit the
-- prorated player's numbers accordingly to match the percentage as well."
-- Why a column and not an edit of seasons.playoff_min_gp: season_playoff_floor_trg rewrites playoff_min_gp as thirty
-- percent of the season's length (v4.01) on every update of the row, and games_refresh_playoff_floor touches the row each
-- time games are added or removed, the playoff draw (v4.40) included, so a hand-set 14 would turn back into 16 at the
-- next round. seasons.playoff_floor_ruled holds a floor the commissioner set for one season, and the trigger keeps it over
-- the thirty percent rule. Every reader already goes through the season's floor: player_playoff_floor prorates from
-- playoff_min_gp (so 16 x 45/54 = 13.33, 13, becomes 14 x 45/54 = 11.67, 12, by the same v4.00 rounding), and
-- set_game_lineup's playoff gate, award_eligible (Rule 9.3) and the site's playoff_floors all read that.
-- shortcut: the ruled floor has no Control Center field; it is set by a migration like this one. Revisit if a
-- commissioner wants to set it from the Seasons editor.

alter table public.seasons add column if not exists playoff_floor_ruled int
  check (playoff_floor_ruled is null or playoff_floor_ruled between 0 and 200);
comment on column public.seasons.playoff_floor_ruled is
  'v4.41: a playoff eligibility floor the commissioner set for this season (Rule 8.3); when set, season_playoff_floor keeps it over thirty percent of the season''s length';

create or replace function public.season_playoff_floor()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_len int;
begin
  if coalesce(new.format, 'basic') = 'basic' then
    /* v4.41: a floor the commissioner ruled for this season stands (Season 1: fourteen) */
    if new.playoff_floor_ruled is not null then
      new.playoff_min_gp := new.playoff_floor_ruled;
      return new;
    end if;
    /* Rule 8.3 (v4.01): thirty percent of the season's length, the schedule once it is built, else the season's shape */
    v_len := public.season_schedule_length(new.id);
    if v_len is null then
      v_len := public.season_games_per_club(new.weeks, new.nights_per_week, new.night_slots);
    end if;
    new.playoff_min_gp := least(200, public.playoff_floor_of_length(v_len));
  end if;
  return new;
end $function$;
revoke all on function public.season_playoff_floor() from public, anon, authenticated;

update public.seasons set playoff_floor_ruled = 14 where number = 1;

do $chk$
begin
  if (select playoff_min_gp from public.seasons where number = 1) <> 14 then
    raise exception 'v4.41 check: Season 1''s floor is not fourteen';
  end if;
  if (select playoff_min_gp from public.seasons where number = 2) <> 16 then
    raise exception 'v4.41 check: Season 2''s floor moved';
  end if;
  if exists (select 1 from public.seasons s join public.roster_spots rs on rs.season_id = s.id
              where s.number = 1 and public.player_playoff_floor(s.id, rs.profile_id) > 14) then
    raise exception 'v4.41 check: a Season 1 player still needs more than fourteen';
  end if;
  if position('search_path TO ''''' in pg_get_functiondef('public.season_playoff_floor()'::regprocedure)) = 0
     or position('playoff_floor_ruled' in pg_get_functiondef('public.season_playoff_floor()'::regprocedure)) = 0 then
    raise exception 'v4.41 check: the floor trigger does not keep a ruled floor';
  end if;
end $chk$;

/* REHEARSAL (2026-11-01): one transaction on the live database, rolled back by a closing raise. Each Season 1 player's
   floor and games were kept first, then the migration ran, then a probe:
   F1  a playoff game added (as the draw adds them) and the row touched again leave the floor at fourteen.
   F2  no player's floor is above fourteen, and every prorated floor is the same share of fourteen by the v4.00 rounding:
       KwikTripJesus 13 to 12, Sparky88 11 to 9, Chief 8 to 7, SadlyiClxmp stays 6.
   Newly eligible on the six playoff clubs: BOS Ferdzyyyyyyyyyyyy (15 of 14), ItzPeakz (14), xXevanvvXx (15); DET Sparky88
   (10 of 9); NYI Chief (7 of 7), Šuprèmêrüst¥ (14 of 13), Vegas (14); SEA Kaz Kanada (15); UTA Prohgrams (14); VAN
   lxlbmac24lxl (15), xHutson-48x (8 of 8). Still short: 43.
   Result: REHEARSAL OK: F1 F2
   Applied as migration v441_season1_playoff_floor_14. tools/sql/grant-audit.sql returned zero rows afterwards, and the
   site's own lockout (CG.playoffLockout, v4.43) was checked on the live data: it locks out exactly the 43 players the
   database refuses. */
