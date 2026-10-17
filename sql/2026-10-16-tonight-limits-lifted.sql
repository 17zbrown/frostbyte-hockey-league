-- 2026-10-16: the weekly game limits are lifted for the night of Friday, October 16, and the night's automatic
-- over-limit forfeits are lifted, so each of those games stands as played.
-- Commissioner, 2026-10-16: "Remove the games played limits for the players just for tonight and fix the forfeits
-- given to teams for players being over the weekly limit from only tonight. Score the games based on if the limits
-- were not imposed only for tonight."
--
-- What it does (an office ruling under Rule 3.3 and the commissioner's forfeit authority, Rule 5.2):
--  1. Every regular-season game of the night (12) gets limits_exempt = true, so none of them counts toward any week's
--     player game limits and the automatic check (_limit_forfeit_check returns at once for an exempt game) can never
--     rule on them again. No week-4 game is scheduled after tonight, so no other game's count moves.
--  2. The seven automatic limit forfeits of the night are lifted exactly as an overturned appeal is
--     (decide_forfeit_appeal): _limit_forfeit_excuse writes weekly_cap_exceptions for the named players, and
--     forfeit_team_id is cleared while the game stays final with its score, so the standings read the result as played.
--  3. Untouched: UTA at DAL (9:00 PM) is an ABANDONED-game forfeit (Rule 4.3, forfeit_abandoned_game), not a limit
--     forfeit, and earlier nights' limit forfeits stand.
-- Why not the office doors: ops_exempt_game_limits refuses a final game and writes a transactions row (each posts to
-- #transactions with team-role mentions); undo_forfeit and unforfeit_game return a game to 'scheduled' and erase its
-- score. Nothing here posts to Discord: no status or score changes (notify_discord_game_final stays silent),
-- flag_club_forfeits returns on a cleared forfeit, and trg_check_clinches re-reads the clinch state.
--
-- The seven games (ET, away at home, as played, forfeited by, players over the cap):
--   9:00  DET 3 at NYI 4      NYI  THERUTKING88 (4 of 3)    -> NYI win stands
--   9:00  BOS 4 at SEA 5 OT   SEA  Aussie (4 of 3)          -> SEA overtime win stands
--   9:35  UTA 2 at BOS 4      UTA  Marran                    -> BOS win, now a plain loss for UTA
--   9:35  PIT 6 at NYI 2      NYI  THERUTKING88 (5 of 3)    -> PIT win, plain loss for NYI
--   9:35  SEA 3 at VAN 4      SEA  Aussie (5 of 3)          -> VAN win, plain loss for SEA
--  10:10  NYI 3 at SEA 7      SEA  Aussie (6 of 3)          -> SEA win stands
--  10:10  DET 3 at UTA 10     UTA  Marran (6 of 3)          -> UTA win stands
--
-- REHEARSAL on production, 2026-10-16 ~11:00 PM ET, the same block ending in an uncaught raise (rolled back, nothing sent):
--   REHEARSAL (rolled back): tonight exempt 12, limit forfeits lifted 7, cap exceptions 7, standings now read:
--   VAN 4-2 PIT; UTA 7-0 DAL FFL:DAL; DET 3-4 NYI; BOS 4-5 SEA; UTA 2-4 BOS; SEA 3-4 VAN; PIT 6-2 NYI; DAL 4-6 DET;
--   DET 3-10 UTA; BOS 6-7 VAN; NYI 3-7 SEA; PIT 6-5 DAL
--   (every guard and self-check passed; the only forfeit left on the night is the abandoned UTA at DAL)
-- Applied as migration v415_tonight_limits_lifted.

do $$
declare
  v_ruling constant text := 'Commissioner ruling 2026-10-16: weekly game limits lifted for the night of Fri Oct 16; the result as played stands';
  v_games constant uuid[] := array[
    '7491cfba-ddc0-4ce8-8932-a2f171c6f476', '872095e4-acb1-4754-8871-aa24c6344e19', '0370676a-0d81-4cc8-a809-2869660bb221',
    '0ed8e782-5e2d-45dc-bbb8-84c3b1e1a2fb', 'bdbb110e-ec62-441d-9bc9-7f8a0953db07', 'a1867a4a-ea34-40af-b2c3-8067b4c0dc38',
    '6a8da445-bab0-48ef-b387-625fa38f9967']::uuid[];
  v_abandoned constant uuid := '1bf9e6a2-ff9b-4d88-8886-aeae390cf078';
  v_night uuid[]; v_id uuid; g public.games; v_code text; v_aud jsonb; v_exc int; v_n int; v_total_exc int := 0;
begin
  select array_agg(id order by scheduled_at, id) into v_night from public.games
   where (scheduled_at at time zone 'America/New_York')::date = date '2026-10-16'
     and coalesce(stage, 'regular') = 'regular' and not coalesce(voided, false);
  if coalesce(array_length(v_night, 1), 0) <> 12 then
    raise exception 'expected the 12 games of Fri Oct 16, found %', coalesce(array_length(v_night, 1), 0);
  end if;
  if exists (select 1 from public.games g2 where coalesce(g2.limit_week, g2.week) = 4 and g2.season_id = (select season_id from public.games where id = v_night[1])
              and g2.scheduled_at > (select max(scheduled_at) from public.games where id = any(v_night))) then
    raise exception 'a week-4 game is scheduled after tonight; exempting tonight would change its count';
  end if;

  -- guards: each game is tonight's, final, and its forfeit is the automatic limit forfeit and no other kind
  foreach v_id in array v_games loop
    select * into g from public.games where id = v_id;
    if g.id is null or not (g.id = any(v_night)) then raise exception 'game % is not one of tonight''s games', v_id; end if;
    if g.status <> 'final' or g.forfeit_team_id is null then raise exception 'game % is not a final forfeit', v_id; end if;
    select code into v_code from public.teams where id = g.forfeit_team_id;
    select a.detail into v_aud from public.admin_audit a where a.action = 'limit_forfeit' and a.target_id = v_id::text
     order by a.created_at desc limit 1;
    if v_aud is null or (v_aud->>'forfeited_by') is distinct from v_code then
      raise exception 'game %: the forfeit on file (%) is not the automatic limit forfeit', v_id, v_code;
    end if;
    if exists (select 1 from public.admin_audit a where a.target_id = v_id::text and a.action ilike '%forfeit%'
                and a.action not in ('limit_forfeit', 'limit_forfeit_both')) then
      raise exception 'game % also carries another kind of forfeit ruling; not touched', v_id;
    end if;
  end loop;

  -- 1. the night counts toward no week's player game limits
  update public.games set limits_exempt = true, limit_week = null where id = any(v_night) and not coalesce(limits_exempt, false);
  perform public.log_admin_action('game_limits_exempt', 'night', '2026-10-16',
    jsonb_build_object('exempt', true, 'week', 4, 'games', to_jsonb(v_night), 'reason', v_ruling));

  -- 2. lift the seven limit forfeits; the games stay final with their scores
  foreach v_id in array v_games loop
    select * into g from public.games where id = v_id;
    select code into v_code from public.teams where id = g.forfeit_team_id;
    v_exc := public._limit_forfeit_excuse(v_id, g.forfeit_team_id, v_ruling);
    if v_exc < 1 then raise exception 'no cap exception was written for game %', v_id; end if;
    v_total_exc := v_total_exc + v_exc;
    update public.games set forfeit_team_id = null where id = v_id and forfeit_team_id = g.forfeit_team_id and status = 'final';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'game % was not updated', v_id; end if;
    perform public.log_admin_action('limit_forfeit_lifted', 'game', v_id::text,
      jsonb_build_object('forfeited_by', v_code, 'score', g.away_score || '-' || g.home_score, 'week', g.week, 'ruling', v_ruling));
  end loop;

  -- self-checks
  if (select count(*) from public.games where id = any(v_night) and limits_exempt) <> 12 then raise exception 'self-check: not all 12 games are exempt'; end if;
  if exists (select 1 from public.games where id = any(v_games) and (forfeit_team_id is not null or status <> 'final' or home_score is null or away_score is null)) then
    raise exception 'self-check: a lifted game is not final with its score and no forfeit';
  end if;
  if (select forfeit_team_id from public.games where id = v_abandoned) is distinct from (select id from public.teams where code = 'DAL') then
    raise exception 'self-check: the abandoned UTA at DAL forfeit changed';
  end if;
  foreach v_id in array v_night loop
    if public._limit_forfeit_check(v_id) is not null then raise exception 'self-check: the automatic check still rules on game %', v_id; end if;
  end loop;
  if (select count(distinct game_id) from public.weekly_cap_exceptions where game_id = any(v_games)) <> 7 then
    raise exception 'self-check: cap exceptions missing';
  end if;
  raise notice 'tonight exempt: 12 games; limit forfeits lifted: 7; cap exceptions written: %', v_total_exc;
end $$;
