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
-- 4) client RPCs that lost their grant (the hand list; 4b below holds every other RPC either site calls)
select 'client-rpc-not-executable', c.name, '', false
from unnest(array['edit_message','delete_message','ea_lookup_state','ea_lookup_health','draw_playoff_round','clear_playoff_round','set_game_club_substitution','clear_game_club_substitution','respond_offer','sign_free_agent','offer_free_agent','set_game_lineup','draft_make_pick','waive_player','accept_trade','set_roster_squad','swap_roster_squad','resolve_game_server','registration_pool','career_games_played','playoff_floors','can_see_match','set_my_jersey_number','submit_season_survey','season_survey_done','season_survey_results','withdraw_staff_application','withdraw_owner_application','statistical_title_board']) c(name)
where not coalesce((select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = c.name), false)
union all
-- 4b) (v5.00 swap) the same check for every other RPC src/live or src/s2 calls. Generated: node tools/sql/client-rpcs.cjs --write
-- adds what the two sites call and 4 does not list (it never drops a name); tools/s2-site-modes.test.cjs pins it
select 'client-rpc-not-executable', c.name, '', false
from unnest(array['admin_remove_from_roster','apply_committee_seat','apply_mgmt_salaries','assign_case','auto_assign_latecomers','ban_player','clear_game_lineup','create_league','current_season_id','decide_forfeit_appeal','decide_position_change','decide_suspension_request','declare_forfeit','discipline_from_case','distribute_unproven_rookies','draft_auto_advance','draft_conclude','draft_management_gaps','draft_pause','draft_reset_clock','draft_resume','draft_reverse_pick','draft_skip_pick','ea_dismiss_import','ea_import_issues','extend_suspension','finalize_season_award','forfeit_game','forum_board_list','forum_moderate','forum_post_create','forum_post_edit','forum_thread_create','forum_thread_edit','forum_thread_get','forum_thread_list','generate_draft_board','grant_cap_exception','has_department','is_commissioner','is_staff','is_stats_staff','lift_suspension','mark_dm_read','market_claim','member_pop_stats','mgmt_decide_move','mgmt_request_move','mgmt_withdraw_move','my_discord_accounts','offer_extension','office_found_owner_club','office_withdraw_registration','ops_job_health','ops_reschedule_game','override_application_decision','owner_remove_manager','player_rap_sheet','player_rating','preseason_random_assign','preseason_release_now','rankings_clear','rankings_set_order','reopen_game_final','report_ruling_mistake','request_extension','request_suspension','resend_trade','reverse_trade','revoke_cap_exception','s2_control','s2_league','save_draft_board','season_rules','set_jersey_number','set_league_emblem','set_member_role','set_owner_app_club','set_player_position','set_staff_channels','set_staff_profile','set_team_game_line','set_team_line','set_team_line_night','set_team_manager','set_team_mgmt_policy','staff_activity','staff_channel_status','staff_channel_test','staff_directory','staff_needs_attention','staff_vote_board','staff_vote_cast','staff_vote_close','staff_vote_create','staff_vote_delete','start_draft','start_next_season','stats_game_row','stats_game_set_result','stats_pickup_delete','stats_pickup_row','stats_pickup_row_delete','stats_pickup_update_game','suspend_player','switch_discord_account','team_cap_outlook','unban_player','undo_forfeit','unforfeit_game','withdraw_committee_application','withdraw_registration','withdraw_suspension_request']) c(name)
where not coalesce((select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = c.name), false)
union all
-- 5) internal notice writers (v3.50). These post into club rooms, ring bells and page staff, and check
--    no caller by design: only other SECURITY DEFINER functions may reach them. Checked BY NAME,
--    because check 1 cannot see them: club_notify mentions auth.uid() only as the DEFAULT for its
--    actor column (which check 1 mistakes for a guard), and the lineup helpers write THROUGH
--    club_notify rather than with a direct insert.
select 'internal-writer-callable', p.proname, pg_get_function_identity_arguments(p.oid),
       has_function_privilege('anon', p.oid, 'EXECUTE')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('club_notify','_post_lineup_notice','_notify_lineup_pulled','_notify_lineup_moves',
                    '_post_lock_notices','_club_batch_notices','_announce_once','_mgmt_move_send',
                    'create_notification','notify_department','notify_discord','notify_staff',
                    'notify_staff_ch','notify_staff_bell','notify_commissioners',
                    '_place_trade_arrivals','discord_http_post')
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
union all
-- 6) (v3.50) a SECURITY DEFINER function the API roles can execute that calls a notice writer and whose
--    only "guard" is a mention of auth.uid(). An auth.uid() default is not a gate.
select 'notice-writer-caller-without-gate', p.proname, pg_get_function_identity_arguments(p.oid),
       has_function_privilege('anon', p.oid, 'EXECUTE')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and p.prorettype <> 'trigger'::regtype
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and p.prosrc ~ '(club_notify|create_notification|notify_department|notify_discord|notify_staff|notify_commissioners|discord_dms)'
  and not (lower(p.prosrc) ~ '(is_commissioner|trusted_writer|is_gm_of|is_team_manager|has_department|is_staff\(|_is_stats|is_stats_staff|mgmt_gate|assert_|raise exception ''only|raise exception ''not_authorized|if v_uid is null|auth\.uid\(\) is null)')
union all
-- 7) (v3.77) a function that posts to Discord straight through net.http_post. Every database post to Discord
--    goes through public.discord_http_post, which suppresses link previews (commissioner, 2026-10-01: "always
--    remove the embed when you use a link in any text on the server"). sql/2026-10-01-no-link-previews-v377.sql.
select 'discord-post-without-no-previews', p.proname, pg_get_function_identity_arguments(p.oid), false
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname <> 'discord_http_post'
  and p.prosrc ~ 'net\.http_post\s*\(' and p.prosrc ~* '(discord|webhook)'
union all
-- 8) (2026-10-02) an updatable view that runs with its owner's privileges (security_invoker = false) and that an API
--    role can write: every write through it skips RLS and every RPC check. suspension_record was one; games_public is
--    the model (SELECT only). sql/2026-10-02-suspension-record-read-only.sql.
select 'definer-view-writable', c.relname, '', has_table_privilege('anon', c.oid, 'UPDATE')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false)
  and (has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
    or has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE'))
union all
-- 9) (v4.26) a club release that skips the waiver. Audit F-2-18: the policy "gm deletes own team roster" let a seat holder
--    delete a roster row through the API, so the release reached neither the transaction log nor the waived_at stamp
--    (Rule 2.2). A roster row leaves only through a SECURITY DEFINER door (waive_player, the office's removal doors):
--    no DELETE policy on roster_spots, and no DELETE or TRUNCATE (which RLS never sees) for the API roles.
--    sql/2026-10-21-roster-delete-door-v426.sql.
select 'roster-delete-door-open', 'policy ' || policyname, cmd, false
from pg_policies where schemaname = 'public' and tablename = 'roster_spots' and cmd = 'DELETE'
union all
select 'roster-delete-door-open', r.role || ' ' || pv.priv, '', r.role = 'anon'
from unnest(array['anon','authenticated']) r(role), unnest(array['DELETE','TRUNCATE']) pv(priv)
where has_table_privilege(r.role, 'public.roster_spots', pv.priv);
