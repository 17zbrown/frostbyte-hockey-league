-- Rehearsal for sql/2026-11-24-box-line-audit-v463.sql (S2 swap stream g2, 2026-11-24). The main session runs it on
-- production as ONE transaction that ends in an uncaught raise, so everything rolls back (pg_net is transactional: nothing
-- posts). Agents never run it. It carries the record byte for byte between the RECORD markers
-- (tools/box-line-audit-v463.test.cjs pins that). Before and after, outside the transaction, count net.http_request_queue:
-- it must be unchanged.
-- People and rows, picked inside the transaction by id order (no ids or names in this file): K the first commissioner;
-- P the first member who is neither staff nor a commissioner; G the most recent final game with a recorded home shot count
-- and a home skater line L holding at least one goal and one shot; G2 any other game.
-- Cases:
--   T1 K lowers L's goals and shots by one (a goal void's scorer line): the line holds the new numbers, G's home shot count
--      drops by one and its away count is unchanged, exactly one admin_audit row 'box_score_line_changed' names the line,
--      exactly the columns goals and shots, and shots_moved -1; nothing is queued for Discord.
--   T2 K changes L's hits only: the shot counts do not move (shots_moved 0).
--   T3 K names G2 for L: refused 22023, nothing written.
--   T4 K names a line that does not exist: refused P0002.
--   T5 P calls it: refused 42501.
--   T6 K adds a line to G: 'box_score_line_added', the shot counts do not move.
-- Results: (the main session records them here)

begin;

do $pre$
declare k uuid; p uuid; g uuid; g2 uuid; l uuid;
begin
  select id into k from public.profiles where role = 'commissioner' and not coalesce(banned, false) order by id limit 1;
  select id into p from public.profiles where role not in ('staff', 'commissioner') and not coalesce(banned, false) order by id limit 1;
  select gm.id, gs.id into g, l from public.games gm join public.game_stats gs on gs.game_id = gm.id and gs.team_id = gm.home_team_id
    where gm.status = 'final' and gm.home_shots is not null and gm.forfeit_team_id is null and not coalesce(gm.voided, false)
      and not gs.is_goalie and gs.goals >= 1 and gs.shots >= 1
    order by gm.scheduled_at desc, gs.id limit 1;
  select id into g2 from public.games where id <> g order by scheduled_at desc limit 1;
  if k is null or p is null or g is null or l is null or g2 is null then raise exception 'rehearsal: K, P, G, L or G2 not found'; end if;
  perform set_config('rh.k', k::text, true); perform set_config('rh.p', p::text, true);
  perform set_config('rh.g', g::text, true); perform set_config('rh.g2', g2::text, true); perform set_config('rh.l', l::text, true);
  perform set_config('rh.q', (select count(*) from net.http_request_queue)::text, true);
end
$pre$;

-- ===== RECORD (byte for byte) =====
-- v463 (DRAFT, S2 swap stream g2, 2026-11-24; the main session rehearses, applies and ships it): a box-score line changed
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
-- ===== END RECORD =====

do $post$
declare k uuid := current_setting('rh.k')::uuid; p uuid := current_setting('rh.p')::uuid; g uuid := current_setting('rh.g')::uuid;
  g2 uuid := current_setting('rh.g2')::uuid; l uuid := current_setting('rh.l')::uuid;
  o public.game_stats; v public.game_stats; hs0 integer; as0 integer; hs1 integer; as1 integer; a0 bigint; a1 bigint; d jsonb; n uuid; ok boolean; seen uuid[];
begin
  select * into o from public.game_stats where id = l;
  select home_shots, away_shots into hs0, as0 from public.games where id = g;
  select count(*) into a0 from public.admin_audit where action like 'box_score_line_%';
  /* 2026-11-24 (main session): now() is constant inside one transaction and admin_audit.id is a random uuid, so
     "newest by created_at" ties; each step's row is the one id not seen before it (the first run picked T1's row in T2) */
  select coalesce(array_agg(id), '{}') into seen from public.admin_audit where action like 'box_score_line_%';
  perform set_config('request.jwt.claims', json_build_object('sub', k, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- T1: a goal void's scorer line
  v := public.stats_game_row(l, g, jsonb_build_object('goals', o.goals - 1, 'shots', o.shots - 1));
  perform set_config('role', 'postgres', true);
  select home_shots, away_shots into hs1, as1 from public.games where id = g;
  select count(*) into a1 from public.admin_audit where action like 'box_score_line_%';
  select detail into d from public.admin_audit where action = 'box_score_line_changed' and target_id = g::text and id <> all(seen);
  select seen || array_agg(id) into seen from public.admin_audit where action like 'box_score_line_%' and id <> all(seen);
  if v.goals <> o.goals - 1 or v.shots <> o.shots - 1 then raise exception 'T1: the line holds % goals and % shots', v.goals, v.shots; end if;
  if hs1 <> greatest(0, hs0 - 1) or as1 is distinct from as0 then raise exception 'T1: home shots % -> %, away % -> %', hs0, hs1, as0, as1; end if;
  if a1 <> a0 + 1 then raise exception 'T1: % audit rows written, expected 1', a1 - a0; end if;
  if (d->>'row')::uuid <> l or (select array_agg(x order by x) from jsonb_object_keys(d->'changed') x) <> array['goals', 'shots'] or (d->>'shots_moved')::int <> -1 then
    raise exception 'T1: the audit row reads %', d; end if;
  raise notice 'T1 ok: goals % -> %, shots % -> %, home shots % -> %, audit %', o.goals, v.goals, o.shots, v.shots, hs0, hs1, d->'changed';

  -- T2: hits only, the shot count stays
  perform set_config('role', 'authenticated', true);
  v := public.stats_game_row(l, g, jsonb_build_object('hits', o.hits + 1));
  perform set_config('role', 'postgres', true);
  if (select home_shots from public.games where id = g) <> hs1 then raise exception 'T2: the shot count moved on a hits change'; end if;
  select detail into d from public.admin_audit where action = 'box_score_line_changed' and target_id = g::text and id <> all(seen);
  select seen || array_agg(id) into seen from public.admin_audit where action like 'box_score_line_%' and id <> all(seen);
  if (d->>'shots_moved')::int <> 0 or (select array_agg(x) from jsonb_object_keys(d->'changed') x) <> array['hits'] then raise exception 'T2: the audit row reads %', d; end if;
  raise notice 'T2 ok';

  -- T3: another game's line is refused, nothing written
  perform set_config('role', 'authenticated', true);
  ok := false;
  begin perform public.stats_game_row(l, g2, jsonb_build_object('goals', 0));
  exception when sqlstate '22023' then ok := true; end;
  perform set_config('role', 'postgres', true);
  if not ok or (select goals from public.game_stats where id = l) <> o.goals - 1 then raise exception 'T3: another game was not refused'; end if;
  raise notice 'T3 ok';

  -- T4: a line that does not exist
  perform set_config('role', 'authenticated', true);
  ok := false;
  begin perform public.stats_game_row(gen_random_uuid(), g, jsonb_build_object('goals', 0));
  exception when sqlstate 'P0002' then ok := true; end;
  if not ok then raise exception 'T4: a missing line was not refused'; end if;
  raise notice 'T4 ok';

  -- T5: a member who is not staff
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.stats_game_row(l, g, jsonb_build_object('goals', 0));
  exception when sqlstate '42501' then ok := true; end;
  if not ok then raise exception 'T5: a member was not refused'; end if;
  raise notice 'T5 ok';

  -- T6: an added line moves no shot count
  perform set_config('request.jwt.claims', json_build_object('sub', k, 'role', 'authenticated')::text, true);
  v := public.stats_game_row(null, g, jsonb_build_object('team_id', (select home_team_id from public.games where id = g), 'skater_name', 'Rehearsal line', 'position', 'C', 'shots', 3));
  perform set_config('role', 'postgres', true);
  if (select home_shots from public.games where id = g) <> hs1 then raise exception 'T6: an added line moved the shot count'; end if;
  if not exists (select 1 from public.admin_audit where action = 'box_score_line_added' and target_id = g::text and (detail->>'row')::uuid = v.id) then raise exception 'T6: no audit row for the added line'; end if;
  raise notice 'T6 ok';

  if (select count(*) from net.http_request_queue) <> current_setting('rh.q')::bigint then raise exception 'rehearsal: something was queued for Discord'; end if;
  raise exception 'REHEARSAL OK (rolled back): T1 to T6 passed';
end
$post$;
