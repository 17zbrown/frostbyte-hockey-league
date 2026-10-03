-- v3.81: the four goaltending stats the ratings engine reads are imported, and the lines that missed them are rebuilt.
-- Found by the season box-score audit the commissioner asked for on 2026-10-02 ("Sift through each game played in the
-- league so far to make sure players' stats are fully up to date and not missing anything").
--
-- v3.49 (sql/2026-09-26-cghl-ratings-engine.sql) added game_stats.diving_saves, shutout_periods, pen_shot_saves and
-- pen_shots_against, backfilled them from the archived payloads, and said "the ingest path stores them for every game
-- from here on". It did not: netlify/functions/ingest-stats.js never mapped EA's gldsaves, glsoperiods, glpensaves and
-- glpenshots. Every goalie line imported from the Sep 30 game night on carried nulls, so every goaltender's rating
-- (refresh_rating_norms, cghl_rates) was computed without them. The importer now maps and merges all four
-- (tools/goalie-fields-v381.test.cjs).
--
-- The backfill rebuilds each line from ea_ingest_log, every sitting filed to that game (ingested, merged, incomplete;
-- never struck or ignored), goalie-only values per sitting exactly as the importer sums them, and writes a line ONLY
-- where the rebuilt saves, shots against and goals against equal the stored ones, which proves the sittings are the
-- ones the line was built from. It touches nothing but the four null columns, and is safe to run again (the second
-- run finds nothing). Then the league's rating norms and every player's overall are refreshed, as a final does.

with tgt as (
  select gs.id, gs.game_id, gs.ea_player_id, gs.saves, gs.shots_against, gs.goals_against
  from public.game_stats gs join public.games g on g.id = gs.game_id
  where gs.is_goalie and gs.ea_player_id is not null
    and (gs.diving_saves is null or gs.shutout_periods is null or gs.pen_shot_saves is null or gs.pen_shots_against is null)
),
src as (
  select t.id,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glsaves')::int, 0) else 0 end) sv,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glshots')::int, 0) else 0 end) sa,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glga')::int, 0) else 0 end) ga,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'gldsaves')::int, 0) else 0 end) dsv,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glsoperiods')::int, 0) else 0 end) sop,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glpensaves')::int, 0) else 0 end) pss,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glpenshots')::int, 0) else 0 end) psa
  from tgt t
  join public.ea_ingest_log l on l.game_id = t.game_id and l.status in ('ingested', 'merged', 'incomplete')
  cross join lateral jsonb_each(l.payload->'players') cl
  cross join lateral jsonb_each(cl.value) pp
  where pp.key = t.ea_player_id
  group by t.id
)
update public.game_stats gs
   set diving_saves = s.dsv, shutout_periods = s.sop, pen_shot_saves = s.pss, pen_shots_against = s.psa
  from src s join tgt t on t.id = s.id
 where gs.id = s.id and s.sv = t.saves and s.sa = t.shots_against and s.ga = t.goals_against;

do $refresh$
declare r record;
begin
  perform set_config('app.role_grant', 'on', true);
  perform public.refresh_rating_norms();
  for r in select distinct gs.profile_id as pid from public.game_stats gs join public.games gm on gm.id = gs.game_id
            where gm.status = 'final' and gm.stage in ('regular', 'playoff') and gs.profile_id is not null loop
    perform public.refresh_player_overall(r.pid);
  end loop;
end $refresh$;

/* DRY RUN 2026-10-02: 52 of 52 goalie lines with nulls had a source, and every one rebuilt to exactly the stored saves,
   shots against and goals against (no mismatch, so no line was left out by the guard): 34 diving saves, 33 shutout
   periods, no penalty shots.
   REHEARSED in one rolled-back transaction: afterwards no goalie line was null, and 17 goaltenders' position ratings
   moved by one to three points (ItzPeakz 70->67, CorRye 69->72, XxVaughnX36 60->57, SmokiestTitan34 74->71, ...).
   APPLIED 2026-10-02 as migration v381_goalie_fields_backfill, after the importer fix (e2097db) was pushed, during that
   night's games. Afterwards: 112 goalie lines this season, none null (56 diving saves, 86 shutout periods in all). */
