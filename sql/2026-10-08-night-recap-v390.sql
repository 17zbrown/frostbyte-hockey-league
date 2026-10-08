-- v3.90: one game-night post instead of one per story.
-- Commissioner, 2026-10-08: "Make sure you combine the best stories of the night into one post instead of sending one out
-- for each game. It turns into a spam channel in its current format."
-- Before: trg_game_night_news wrote a 'Player Spotlight' news article for every shutout, 4-goal, hat-trick and 5-point line
-- as each game went final, and on_news_notify_discord posted every article to the news channel (14 posts on Oct 7). The
-- night's 'Game Recap' went out only once EVERY game of the night was final (a held game kept the Oct 7 recap back until
-- 10:47 the next morning) and was cut to 280 characters on the way to Discord.
-- Now:
--   * the spotlight articles stay on the site, one per story, but are no longer posted to Discord one at a time;
--   * ONE post per game night (post_night_recap): the best stories of the night ranked (as many as fit, the rest pointed to
--     on the site), the results and the three stars. The same text, with every story, is the night's Game Recap article;
--   * it goes out when the night's last game goes final, or from the night-recap sweep (cron, every 15 minutes) once four
--     hours have passed since the night's last puck drop, listing any game still undecided;
--   * night_recaps (primary key season, night) keeps it to one per night; the sweep reads only nights from Oct 8 on, so no
--     old night is posted late. Other news (staff articles, awards, series results) posts as before.

-- the night's stories, ranked: the same four milestones the spotlight articles mark
create or replace function public._night_stories(p_season uuid, p_night date)
returns table (score numeric, pts int, pname text, line text)
language sql stable security definer set search_path to 'public' as $function$
  with x as (
    select coalesce(p.gamertag, gs.skater_name) as pname, gs.goals, gs.assists, (gs.goals + gs.assists) as pts,
           gs.is_goalie, gs.goals_against, gs.shots_against,
           t.name as team, o.name as opp,
           case when gs.team_id = g.home_team_id then g.home_score else g.away_score end as ts,
           case when gs.team_id = g.home_team_id then g.away_score else g.home_score end as os,
           g.went_ot
      from public.game_stats gs
      join public.games g on g.id = gs.game_id
      join public.teams t on t.id = gs.team_id
      join public.teams o on o.id = case when gs.team_id = g.home_team_id then g.away_team_id else g.home_team_id end
      left join public.profiles p on p.id = gs.profile_id
     where g.season_id = p_season and (g.scheduled_at at time zone 'America/New_York')::date = p_night
       and g.status = 'final' and not coalesce(g.voided, false)),
  y as (
    select x.*,
           (case when coalesce(x.ts, 0) in (8, 11, 18) or coalesce(x.ts, 0) between 80 and 89 then 'an ' else 'a ' end)   -- an 8–7, an 11–4
             || coalesce(x.ts, 0) || '–' || coalesce(x.os, 0)
             || case when x.went_ot then ' overtime' else '' end
             || case when x.ts > x.os then ' win over the ' else ' loss to the ' end || x.opp as result
      from x)
  select s.score, s.pts, s.pname, s.line from (
    select (50 + coalesce(y.shots_against, 0) * 0.5)::numeric as score, 0 as pts, y.pname,
           '🧱 **' || y.pname || '** (' || y.team || ') stopped all ' || y.shots_against || ' shots in ' || y.result as line
      from y where y.is_goalie and y.goals_against = 0 and y.shots_against >= 8
    union all
    select (40 + y.goals * 6 + y.assists * 3)::numeric, y.pts, y.pname,
           '🚨 **' || y.pname || '** (' || y.team || ') scored ' || y.goals || ' goals'
             || case when y.assists > 0 then ' and added ' || y.assists || ' assist' || case when y.assists = 1 then '' else 's' end else '' end
             || ' in ' || y.result
      from y where not y.is_goalie and y.goals >= 4
    union all
    select (30 + y.goals * 6 + y.assists * 3)::numeric, y.pts, y.pname,
           '🎩 **' || y.pname || '** (' || y.team || ') hat trick'
             || case when y.assists > 0 then ' and ' || y.assists || ' assist' || case when y.assists = 1 then '' else 's' end else '' end
             || ' in ' || y.result
      from y where not y.is_goalie and y.goals = 3
    union all
    select (20 + y.goals * 6 + y.assists * 3)::numeric, y.pts, y.pname,
           '📈 **' || y.pname || '** (' || y.team || ') ' || y.pts || ' points (' || y.goals || 'G ' || y.assists || 'A) in ' || y.result
      from y where not y.is_goalie and y.goals < 3 and y.pts >= 5
  ) s
  order by s.score desc, s.pts desc, s.pname;
$function$;
revoke execute on function public._night_stories(uuid, date) from public, anon, authenticated;

-- the one post per night
create or replace function public.post_night_recap(p_season uuid, p_night date)
returns boolean
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_final int; v_open int; r record; i int := 0; v_more int := 0; v_room int;
  v_results text := ''; v_pending text := ''; v_stars text := ''; v_best text := ''; v_all text := '';
  v_day text; v_head text; v_post text; v_body text; v_tail text;
begin
  select count(*) filter (where g.status = 'final'), count(*) filter (where g.status <> 'final' and not coalesce(g.voided, false))
    into v_final, v_open
    from public.games g where g.season_id = p_season and (g.scheduled_at at time zone 'America/New_York')::date = p_night;
  if coalesce(v_final, 0) = 0 then return false; end if;   -- nothing played to report
  insert into public.night_recaps (season_id, night_date) values (p_season, p_night) on conflict do nothing;
  if not found then return false; end if;                  -- already posted: one per night

  v_day := to_char(p_night, 'FMMon FMDD');
  for r in select h.name as hn, g.home_score, a.name as an, g.away_score, g.went_ot, g.status, g.voided
             from public.games g join public.teams h on h.id = g.home_team_id join public.teams a on a.id = g.away_team_id
            where g.season_id = p_season and (g.scheduled_at at time zone 'America/New_York')::date = p_night
            order by g.scheduled_at, h.name
  loop
    if r.status = 'final' then
      v_results := v_results || format(E'• %s %s, %s %s%s\n', r.hn, coalesce(r.home_score, 0), r.an, coalesce(r.away_score, 0), case when r.went_ot then ' (OT)' else '' end);
    elsif not coalesce(r.voided, false) then
      v_pending := v_pending || format(E'• %s at %s: not decided yet\n', r.an, r.hn);
    end if;
  end loop;
  for r in select coalesce(p.gamertag, gs.skater_name) as pname, t.name as team, gs.goals, gs.assists, gs.plus_minus, gs.is_goalie, gs.saves, gs.goals_against,
             (case when gs.is_goalie then gs.saves * 0.25 + (case when gs.goals_against = 0 and gs.shots_against >= 8 then 8 else 0 end)
                   else gs.goals * 3 + gs.assists * 2 + gs.shots * 0.2 + gs.hits * 0.2 end) as star
             from public.game_stats gs left join public.profiles p on p.id = gs.profile_id
             join public.games g on g.id = gs.game_id and g.status = 'final' and not coalesce(g.voided, false)
             join public.teams t on t.id = gs.team_id
            where g.season_id = p_season and (g.scheduled_at at time zone 'America/New_York')::date = p_night
            order by star desc, gs.goals desc limit 3
  loop
    i := i + 1;
    v_stars := v_stars || format(E'%s. %s (%s), %s\n', i, r.pname, r.team,
      case when r.is_goalie then r.saves || ' saves' || case when r.goals_against = 0 then ', shutout' else '' end
           else r.goals || 'G ' || r.assists || 'A, ' || case when r.plus_minus >= 0 then '+' else '' end || r.plus_minus end);
  end loop;

  i := 0;
  v_head := format(E'🏒 **Game Night Recap · %s**\n%s game%s in the books%s.', v_day, v_final, case when v_final = 1 then '' else 's' end,
    case when v_open > 0 then format(', %s still to be decided', v_open) else '' end);
  v_tail := E'\n**Results**\n' || v_results || case when v_pending <> '' then v_pending else '' end
            || case when v_stars <> '' then E'\n**Three stars of the night**\n' || v_stars else '' end;
  /* the best of the night: one line per player (the player's biggest game, and how many standout games they had), the top eight
     that fit in one Discord message (1,900 characters, room kept for the pointer line); the article carries them all */
  v_room := 1780 - length(v_head) - length(v_tail);
  for r in select st.pname, (array_agg(st.line order by st.score desc, st.pts desc))[1]
                     || case when count(*) > 1 then ' (' || count(*) || ' standout games tonight)' else '' end as line,
                  max(st.score) + 5 * (count(*) - 1) as rank
             from public._night_stories(p_season, p_night) st
            group by st.pname order by rank desc, max(st.pts) desc, st.pname
  loop
    i := i + 1;
    v_all := v_all || r.line || E'\n';
    if i <= 8 and length(v_best) + length(r.line) + 1 <= v_room then v_best := v_best || r.line || E'\n'; else v_more := v_more + 1; end if;
  end loop;
  v_post := v_head || E'\n'
    || case when v_best <> '' then E'\n**Best of the night**\n' || v_best
         || case when v_more > 0 then format(E'…and %s more on the site: https://chelgamingleague.com/#/news\n', v_more) else '' end
       else '' end
    || v_tail;
  v_body := regexp_replace(v_post, '\*\*', '', 'g');
  v_body := regexp_replace(v_body, '^🏒 Game Night Recap · [^\n]*\n', '');
  if v_more > 0 then   -- the article carries every story
    v_body := replace(v_body, regexp_replace(v_best, '\*\*', '', 'g'), regexp_replace(v_all, '\*\*', '', 'g'));
    v_body := regexp_replace(v_body, E'…and [0-9]+ more on the site: [^\n]*\n', '');
  end if;

  perform set_config('app.news_quiet', 'on', true);   -- the article must not post itself as well
  insert into public.news (season_id, category, title, body, author)
    values (p_season, 'Game Recap', 'Game Night Recap: ' || v_day, v_body, 'CGHL Wire');
  perform set_config('app.news_quiet', '', true);
  perform public.notify_discord('discord_news_webhook', v_post, false);
  return true;
end $function$;
revoke execute on function public.post_night_recap(uuid, date) from public, anon, authenticated;

-- the safety net: a night with a held game still gets its post four hours after its last puck drop
create or replace function public.night_recap_sweep()
returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_n int := 0;
begin
  /* the Control Center's Run now calls this as the signed-in commissioner; the scheduler runs it with no request at all */
  if not (public.is_commissioner() or public.trusted_writer() or coalesce(current_setting('request.jwt.claims', true), '') = '') then
    raise exception 'Only a commissioner can run the game night recap.';
  end if;
  insert into public.app_config (key, value)
    values ('rl_night-recap', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict (key) do update set value = excluded.value;
  for r in
    select g.season_id, (g.scheduled_at at time zone 'America/New_York')::date as night
      from public.games g
     where g.scheduled_at > now() - interval '3 days' and g.scheduled_at <= now()
     group by 1, 2
    having count(*) filter (where g.status = 'final') > 0
       and (count(*) filter (where g.status <> 'final' and not coalesce(g.voided, false)) = 0
            or max(g.scheduled_at) < now() - interval '4 hours')
  loop
    if r.night < date '2026-10-08' then continue; end if;   -- nothing from before v3.90 is posted late
    if exists (select 1 from public.night_recaps nr where nr.season_id = r.season_id and nr.night_date = r.night) then continue; end if;
    if public.post_night_recap(r.season_id, r.night) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $function$;
revoke execute on function public.night_recap_sweep() from public, anon;
grant execute on function public.night_recap_sweep() to authenticated;   -- Run now (Control Center, Automations); guarded above

-- the news channel: spotlight articles stay on the site; the night recap posts itself in full
create or replace function public.notify_discord_news()
returns trigger
language plpgsql security definer set search_path to 'public', 'net', 'extensions' as $function$
begin
  /* v3.90: one post per game night (post_night_recap). A spotlight article is not posted on its own, and the night recap's
     article is posted by post_night_recap in full, so it is quiet here. */
  if new.category = 'Player Spotlight' or coalesce(current_setting('app.news_quiet', true), '') = 'on' then return new; end if;
  perform public.notify_discord('discord_news_webhook',
    format(E'📰 **%s** · %s\n%s',
      new.title, coalesce(new.category,'League News'),
      left(regexp_replace(coalesce(new.body,''), E'\\n+', ' ', 'g'), 280)));
  return new;
end;$function$;

-- the game-final trigger: the spotlights as before, the night's post through post_night_recap
do $patch$
declare d text; n int; i0 int; i1 int; a_old text; a_new text;
begin
  d := pg_get_functiondef('public.trg_game_night_news()'::regprocedure);
  i0 := position('  v_night := (new.scheduled_at at time zone ''America/New_York'')::date;' in d);
  i1 := position(E'  end if;\n  return new;\nend;' in d);
  if i0 = 0 or i1 = 0 or i1 < i0 then raise exception 'v3.90 patch: the recap block anchors were not found (% %)', i0, i1; end if;
  a_old := substr(d, i0, i1 - i0 + length(E'  end if;\n'));
  if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1 then raise exception 'v3.90 patch: the recap block is not unique'; end if;
  a_new := E'  /* v3.90: the night\'s one post (post_night_recap), once its last game is final; a held game is covered by the\n'
        || E'     night-recap sweep four hours after the last puck drop. A voided game is not waited for. */\n'
        || E'  v_night := (new.scheduled_at at time zone ''America/New_York'')::date;\n'
        || E'  select count(*) into cnt from public.games g where g.season_id=new.season_id and (g.scheduled_at at time zone ''America/New_York'')::date=v_night and g.status<>''final''::game_status and not coalesce(g.voided,false);\n'
        || E'  if cnt=0 then perform public.post_night_recap(new.season_id, v_night); end if;\n';
  execute replace(d, a_old, a_new);
end $patch$;

select cron.schedule('night-recap', '*/15 * * * *', 'select public.night_recap_sweep()');
