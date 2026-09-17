-- Grant audit — run after any function or policy change (2026-09-17, docs/audits/2026-09-17-stress-test.md).
-- Every row returned is a finding. An empty result is the pass.
--
-- 1) SECURITY DEFINER functions the API roles can execute that write and carry no auth check.
select 'public-writer-without-guard' as finding, p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and p.prorettype <> 'trigger'::regtype   -- trigger functions cannot be called through the API
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and lower(p.prosrc) ~ '(^|[^a-z_])(insert into|update |delete from)'
  and not (lower(p.prosrc) ~ '(auth\.uid|auth\.jwt|request\.jwt|_is_stats|is_stats_staff|is_commissioner|is_staff\(|is_gm_of|is_team_manager|has_department|assert_|mgmt_gate|trusted_writer|raise exception ''only)')
union all
-- 2) private columns readable by the API roles
select 'private-column-readable', 'games.' || c, '', true
from unnest(array['game_code','server']) c
where has_column_privilege('anon', 'public.games', c, 'SELECT') or has_column_privilege('authenticated', 'public.games', c, 'SELECT')
union all
-- 3) tables with RLS on but a SELECT policy of `true` that should not be public
select 'open-read-policy', tablename || '.' || policyname, '', true
from pg_policies where schemaname = 'public' and cmd = 'SELECT' and qual = 'true'
  and tablename in ('game_lineups','lineups','trades','contract_offers','availability','registration_notes')
union all
-- 4) client RPCs that lost their grant (paste the current list from `grep -oh 'rpc("[a-z_0-9]*"' src/live/*.js | sort -u`)
select 'client-rpc-not-executable', c.name, '', false
from unnest(array['respond_offer','sign_free_agent','offer_free_agent','set_game_lineup','draft_make_pick','waive_player','accept_trade','set_roster_squad','swap_roster_squad','resolve_game_server','registration_pool','career_games_played','can_see_match']) c(name)
where not coalesce((select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = c.name), false);
