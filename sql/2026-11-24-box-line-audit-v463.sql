-- v463 (DRAFT, S2 swap stream g2, 2026-11-24; the main session rehearses, applies and ships it): a box-score line changed
-- Applied as migration v463f_box_line_audit on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
-- from the Season 2 Game desk writes its own audit row and moves the club's shot count with it.
--
-- Why. The Season 2 site's Game desk (src/s2/js/pages/gamedesk.js) is the first client of public.stats_game_row. The
-- classic Stats manager never called it: on the commissioner's order (2026-10-21, memory "removing goals from a box
-- score") goals were voided with hand-written SQL through this RPC, and the same SQL then wrote the admin_audit row
-- (box_score_goals_removed) and lowered games.home_shots / away_shots by the shots removed, because the RPC does neither
-- (v4.45: "a goal void must lower them"). A staffer now voids a goal from the desk, cell by cell, so the RPC does those
-- things itself, once, in the shared code:
--   1. every change writes ONE admin_audit row: 'box_score_line_changed' (the line, each column that changed, from and
--      to, and the shots moved) or 'box_score_line_added'. A destructive action gets an audit row (CLAUDE.md quality bar).
--   2. a change to a line's shots moves that club's EA shot count (games.home_shots or away_shots, v4.45) by the same
--      amount, never below zero, and only where the count is recorded (a null stays null). An ADDED line moves nothing:
--      EA's club count already holds the shots of a player its player list missed.
--   3. an update names its game: a line of another game is refused (22023; p_game was ignored on update), and a line that
--      does not exist raises P0002 instead of returning null (fail loud).
-- Unchanged: the gate (is_stats_staff(); every staffer once the Season 2 staff powers record opens it at the flip), the
-- insert and update columns and their jsonb-patch reading (a key absent keeps the value; profile_id '' unlinks), the
-- return type. A score change stays stats_game_set_result's (guarded for forfeits and voids, v3.52); nothing here posts
-- to Discord (a shots-only games update is neither a status nor a score change for notify_discord_game_final).
-- The function moves to search_path '' with every name qualified (protocol step 1). CREATE OR REPLACE keeps its grants
-- (authenticated and service_role; anon and PUBLIC hold none), and the self-checks below prove it.
--
-- Rehearsal: sql/2026-11-24-box-line-audit-v463.rehearsal.sql (results to be recorded here by the main session).
-- Test: tools/gamedesk-port-g2.test.cjs pins the client; tools/box-line-audit-v463.test.cjs pins this record.

create or replace function public.stats_game_row(p_row_id uuid, p_game uuid, p jsonb)
returns public.game_stats
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v public.game_stats;
  v_old public.game_stats;
  v_home uuid;
  v_away uuid;
  v_dshots integer;
  v_changed jsonb;
begin
  if not public.is_stats_staff() then raise exception 'Only statistics staff can manage games.' using errcode = '42501'; end if;
  if p_row_id is null then
    insert into public.game_stats(game_id, team_id, profile_id, skater_name, position, is_goalie,
      goals, assists, shots, hits, pim, plus_minus, saves, shots_against, goals_against)
      values (p_game, (p->>'team_id')::uuid, nullif(p->>'profile_id', '')::uuid, nullif(p->>'skater_name', ''),
        nullif(p->>'position', '')::public.hockey_position, coalesce((p->>'is_goalie')::boolean, false),
        coalesce((p->>'goals')::int, 0), coalesce((p->>'assists')::int, 0), coalesce((p->>'shots')::int, 0),
        coalesce((p->>'hits')::int, 0), coalesce((p->>'pim')::int, 0), coalesce((p->>'plus_minus')::int, 0),
        coalesce((p->>'saves')::int, 0), coalesce((p->>'shots_against')::int, 0), coalesce((p->>'goals_against')::int, 0))
      returning * into v;
    perform public.log_admin_action('box_score_line_added', 'game', p_game::text,
      jsonb_build_object('row', v.id, 'team', v.team_id, 'goalie', v.is_goalie));
    return v;
  end if;
  /* the line as it stood, locked: the audit row and the shot count read the same before */
  select * into v_old from public.game_stats where id = p_row_id for update;
  if not found then raise exception 'No such box-score line.' using errcode = 'P0002'; end if;
  if v_old.game_id is distinct from p_game then raise exception 'That box-score line belongs to another game.' using errcode = '22023'; end if;
  update public.game_stats set
    profile_id = case when p ? 'profile_id' then nullif(p->>'profile_id', '')::uuid else profile_id end,
    skater_name = coalesce(nullif(p->>'skater_name', ''), skater_name),
    is_goalie = coalesce((p->>'is_goalie')::boolean, is_goalie),
    goals = coalesce((p->>'goals')::int, goals), assists = coalesce((p->>'assists')::int, assists),
    shots = coalesce((p->>'shots')::int, shots), hits = coalesce((p->>'hits')::int, hits), pim = coalesce((p->>'pim')::int, pim),
    plus_minus = coalesce((p->>'plus_minus')::int, plus_minus), saves = coalesce((p->>'saves')::int, saves),
    shots_against = coalesce((p->>'shots_against')::int, shots_against), goals_against = coalesce((p->>'goals_against')::int, goals_against)
  where id = p_row_id returning * into v;
  /* v4.45: the club's shot count is EA's own figure; a shot taken off a line comes off it too (a goal void) */
  v_dshots := coalesce(v.shots, 0) - coalesce(v_old.shots, 0);
  if v_dshots <> 0 then
    select g.home_team_id, g.away_team_id into v_home, v_away from public.games g where g.id = p_game for update;
    update public.games set
      home_shots = case when v.team_id = v_home and home_shots is not null then greatest(0, home_shots + v_dshots) else home_shots end,
      away_shots = case when v.team_id = v_away and away_shots is not null then greatest(0, away_shots + v_dshots) else away_shots end
    where id = p_game;
  end if;
  select coalesce(jsonb_object_agg(o.k, jsonb_build_object('from', o.ov, 'to', n.nv)), '{}'::jsonb) into v_changed
    from jsonb_each(to_jsonb(v_old)) as o(k, ov) join jsonb_each(to_jsonb(v)) as n(k, nv) on n.k = o.k
    where o.ov is distinct from n.nv;
  perform public.log_admin_action('box_score_line_changed', 'game', p_game::text,
    jsonb_build_object('row', v.id, 'team', v.team_id, 'changed', v_changed, 'shots_moved', v_dshots));
  return v;
end
$function$;

/* self-checks: the shape the protocol asks for, and the grants CREATE OR REPLACE kept */
do $check$
declare v_p record;
begin
  select p.prosecdef, p.proconfig, p.prosrc into v_p from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stats_game_row' and pg_get_function_identity_arguments(p.oid) = 'p_row_id uuid, p_game uuid, p jsonb';
  if v_p is null then raise exception 'v463: stats_game_row(uuid, uuid, jsonb) is missing'; end if;
  if not v_p.prosecdef then raise exception 'v463: stats_game_row is not SECURITY DEFINER'; end if;
  if v_p.proconfig is distinct from array['search_path=""'] then raise exception 'v463: stats_game_row search_path is %', v_p.proconfig; end if;
  if position('box_score_line_changed' in v_p.prosrc) = 0 or position('box_score_line_added' in v_p.prosrc) = 0 then raise exception 'v463: the audit rows are missing'; end if;
  if position('home_shots' in v_p.prosrc) = 0 then raise exception 'v463: the shot count is not moved'; end if;
  if not has_function_privilege('authenticated', 'public.stats_game_row(uuid, uuid, jsonb)', 'execute') then raise exception 'v463: authenticated lost EXECUTE'; end if;
  if has_function_privilege('anon', 'public.stats_game_row(uuid, uuid, jsonb)', 'execute') then raise exception 'v463: anon can EXECUTE stats_game_row'; end if;
end
$check$;
