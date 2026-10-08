-- v3.88: the held-game reminder learns the Rule 4.3.6 office hold.
-- A reload after a stop in the final five minutes with no disconnection behind it is combined as played but held for the
-- league office (ingest-stats.js, officeHold). review_held_games (v3.18/v3.53) reminds the Statistics desk of every held
-- game three hours after puck drop, but read any held game of sixty minutes or more as "level after 60 and its overtime
-- never arrived". A held game played to the end and NOT level is the office hold: say so. The officiating desk was already
-- belled when the hold began (noteFinalStretch); this is the durable second reminder.
do $patch$
declare d text; n int;
  a_old text := $a$           (select max(gs.time_on_ice_seconds) from public.game_stats gs where gs.game_id=g.id) as toi
      from public.games g$a$;
  a_new text := $a$           (select max(gs.time_on_ice_seconds) from public.game_stats gs where gs.game_id=g.id) as toi,
           (select coalesce(sum(gs.goals),0) from public.game_stats gs where gs.game_id=g.id and gs.team_id=g.home_team_id) as hg,
           (select coalesce(sum(gs.goals),0) from public.game_stats gs where gs.game_id=g.id and gs.team_id=g.away_team_id) as ag
      from public.games g$a$;
  b_old text := $b$      case when v_min >= 60
        then ' was level after '$b$;
  b_new text := $b$      case when v_min >= 60 and r.hg <> r.ag
        then ' was played to the end but stopped in the final five minutes with no disconnection behind it, so it is held for the league office''s ruling (Rule 4.3.6) and no result has been published. Publish it by merging its sittings in the Stats manager, or rule it there. '
        when v_min >= 60
        then ' was level after '$b$;
begin
  d := pg_get_functiondef('public.review_held_games(integer)'::regprocedure);
  n := (length(d) - length(replace(d, a_old, ''))) / length(a_old);
  if n <> 1 then raise exception 'v3.88 patch: the select anchor matched % times', n; end if;
  n := (length(d) - length(replace(d, b_old, ''))) / length(b_old);
  if n <> 1 then raise exception 'v3.88 patch: the message anchor matched % times', n; end if;
  execute replace(replace(d, a_old, a_new), b_old, b_new);
end $patch$;
