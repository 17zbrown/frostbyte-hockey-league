-- v3.87: Players of the Week are a forward, a defenseman and a goaltender.
-- Commissioner, 2026-10-06: "for player of the week posts, can you choose one forward, one defenseman, and 1 goalie? They
-- need to have played at least 3 games that week and they also can only have played that position for that week."
-- compute_potw (cron weekly-potw, Mondays 15:00 UTC) named a skater (points) and a goaltender (save %), with no games
-- minimum and no position rule (Scorezov took Weeks 1 and 2 on six games each). Now, per week:
--   * eligible: at least 3 regular-season games that week (final, not voided), and EVERY line that week in one position
--     group (forward, defense, or goal); a player who played two groups that week is eligible for neither;
--   * Forward of the Week: points, then goals, then plus-minus;
--   * Defenseman of the Week: points, then plus-minus, then blocked shots plus takeaways;
--   * Goaltender of the Week: save percentage, then saves (at least one shot faced);
--   * ties after those break on the profile id, so a re-run names the same player;
--   * a group with nobody eligible is simply not named that week; the others still are (the old rule skipped the whole
--     week when either pick was missing);
--   * the club named is the one he played his last game of the week for (a trade mid-week).
-- Weeks already named (any potw_ row) are never re-minted, so Weeks 1 and 2 keep their skater and goaltender.
-- The awards category check gains potw_forward and potw_defense; potw_skater stays for the weeks it named.

alter table public.awards drop constraint if exists awards_category_check;
alter table public.awards add constraint awards_category_check check (category = any (array[
  'potw_skater', 'potw_forward', 'potw_defense', 'potw_goalie',
  'champion', 'mvp', 'best_goalie', 'best_defenseman', 'rookie_of_year', 'points_title', 'goals_title', 'assists_title', 'goaltending_title']));

create or replace function public.compute_potw() returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare
  s record; w record; r record; v_minted int := 0; v_line text; v_sent text[]; v_name text; v_team text;
begin
  insert into public.app_config (key, value)
    values ('rl_weekly-potw', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict (key) do update set value = excluded.value;

  select * into s from public.seasons where id = public.current_season_id();
  if s.id is null then
    select * into s from public.seasons order by number desc limit 1;
    if s.id is null then return 0; end if;
  end if;

  for w in
    select g.week
      from public.games g
     where g.season_id = s.id and g.stage = 'regular'
     group by g.week
    having count(*) filter (where g.status = 'final' and not g.voided) > 0
       and max(g.scheduled_at) < now() - interval '12 hours'
       and not exists (select 1 from public.awards a where a.season_id = s.id and a.week = g.week and a.category like 'potw\_%')
     order by g.week
  loop
    v_sent := '{}';
    for r in
      with lines as (
        select gs.profile_id, gs.team_id, gg.scheduled_at, gs.game_id,
               case when gs.is_goalie then 'G' else public.pos_group(gs.position) end as grp,
               coalesce(gs.goals, 0) as goals, coalesce(gs.assists, 0) as assists, coalesce(gs.plus_minus, 0) as plus_minus,
               coalesce(gs.blocked_shots, 0) + coalesce(gs.takeaways, 0) as dplay,
               coalesce(gs.saves, 0) as saves, coalesce(gs.shots_against, 0) as shots_against
          from public.game_stats gs join public.games gg on gg.id = gs.game_id
         where gg.season_id = s.id and gg.stage = 'regular' and gg.week = w.week
           and gg.status = 'final' and not gg.voided and gs.profile_id is not null),
      per as (
        select profile_id, min(grp) as grp, count(distinct grp) as ngrp, count(distinct game_id) as gp,
               (array_agg(team_id order by scheduled_at desc))[1] as team_id,
               sum(goals) as g, sum(assists) as a, sum(plus_minus) as pm, sum(dplay) as dplay,
               sum(saves) as sv, sum(shots_against) as sa
          from lines group by profile_id),
      elig as (select * from per where ngrp = 1 and gp >= 3)
      (select 1 as ord, 'potw_forward' as cat, e.* from elig e where e.grp = 'F'
        order by e.g + e.a desc, e.g desc, e.pm desc, e.profile_id limit 1)
      union all
      (select 2, 'potw_defense', e.* from elig e where e.grp = 'D'
        order by e.g + e.a desc, e.pm desc, e.dplay desc, e.profile_id limit 1)
      union all
      (select 3, 'potw_goalie', e.* from elig e where e.grp = 'G' and e.sa > 0
        order by e.sv::numeric / e.sa desc, e.sv desc, e.profile_id limit 1)
      order by ord
    loop
      v_line := case r.cat
        when 'potw_goalie' then trim(to_char(r.sv::numeric / nullif(r.sa, 0), '0.999')) || ' SV% · ' || r.sv || ' saves in ' || r.gp || ' games'
        when 'potw_defense' then r.g || 'G ' || r.a || 'A, ' || case when r.pm >= 0 then '+' else '' end || r.pm || ' across ' || r.gp || ' games'
        else r.g || 'G ' || r.a || 'A across ' || r.gp || ' games' end;
      insert into public.awards (season_id, week, category, profile_id, team_id, stat_line, decided_by)
        values (s.id, w.week, r.cat, r.profile_id, r.team_id, v_line, 'auto')
        on conflict do nothing;
      select coalesce(nullif(gamertag, ''), 'a player') into v_name from public.profiles where id = r.profile_id;
      select name into v_team from public.teams where id = r.team_id;
      v_sent := v_sent || (case r.cat when 'potw_forward' then 'Forward of the Week: ' when 'potw_defense' then 'Defenseman of the Week: '
                                      else 'Goaltender of the Week: ' end || v_name || ' (' || coalesce(v_team, 'a club') || '), ' || v_line || '.');
    end loop;

    if cardinality(v_sent) = 0 then continue; end if;   -- nobody played three games at one position: nothing to name
    insert into public.news (season_id, category, title, author, published_at, body)
      values (s.id, 'Awards', 'Players of the Week: Week ' || w.week, 'CGHL Wire', now(),
        array_to_string(v_sent, ' ') || ' To be named, a player must play at least three games in the week, all at that position. '
        || 'Weekly honors are computed straight from the imported box scores every Monday.');
    v_minted := v_minted + 1;
  end loop;
  return v_minted;
end $function$;
