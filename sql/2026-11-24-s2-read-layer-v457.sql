-- v4.57 (2026-11-24): the Season 2 site's league read, public.s2_league, and the club-history reader it embeds,
-- public.league_tenures. Additive: nothing existing changes, and the current site does not call either.
--
-- Why one function: the Season 2 site boots from ONE body of league facts instead of the twenty keyset reads the current
-- site makes. One statement means one snapshot (no box score read half before and half after an import re-files it, the
-- residual gap CG.sbAll documents) and one jsonb scalar, which PostgREST's 1000-row ceiling never cuts (that ceiling
-- applies to set-returning results). It is SECURITY INVOKER, so the caller's own RLS and column grants decide what it can
-- read: it can never show anyone more than they can already read through the API.
--
-- What it returns is FACTS, never derived numbers. Standings and season lines are computed in the browser by the live
-- engine itself (a generated copy of CG.aggregate), so they keep one definition. It projects every column explicitly
-- (never to_jsonb of a row, never *): the column denylist below is enforced by tools/s2-read-layer-v4.57.test.cjs.
-- Never in the body: discord_*, ea_id, ea_player_id, skater_name, timezone, departments, preferred_server, game_code,
-- server, payloads, case text, suspension reasons or grounds, and the playoff floor reader (its credit column is private).
--
-- The body (the s2_league contract until contracts/s2-league.md is written; briefs/data_layer.md section 1 is its source):
--   always:   generated (now()), source 'live', season (the number on screen), sections (the ones returned),
--             pulse {v, d, site_build} from live_pulse, read in the same snapshot so no change between it and the data is
--             missed (the order bootLive keeps).
--   league    {leagues: [...], divisions: [...]}
--   teams     [{id, code, city, name, arena, division, conference, league_id, color, color2, logo_url, founded_season,
--              owner_profile_id, gm_profile_id, agm_profile_id}]   (teams has no season column: every club)
--   seasons   [every column of every season row, by number]
--   config    {site: {key: value} from site_config, flags: {key: enabled} from feature_flags}
--   games     [the season's games: CG.GAME_PUBLIC_COLS plus home, away and forfeit club codes]; p_game_ids narrows it
--   box       {cols: [42 names], byGame: {game id: [[42 values], ...]}}: every game_stats line of the season's games
--             (or p_game_ids) as compact arrays keyed by club code; club shots ride on games.home_shots/away_shots
--   pct       {min_gp: cghl_settle_gp()}
--   rosters   {spots: [roster_spots of the season], contracts: [contracts covering the season]}; seats come from teams
--   ratings   [player_position_overalls rows, each with v448: true (already on the v4.48 scale; the concept converts
--             only rows without it)]
--   people    [profiles: id, gamertag, display_name, avatar_url, role, jersey_number, platform, banned]
--   career    {profile id: games played in every season} from career_games_played()
--   honors    [every season's awards rows, with season number and club code]
--   tenures   [league_tenures(season)]: who was on which club when, with bucketed how_in and how_out
--   signups   [registration_pool() rows of the season, without ea_id]
--   suspensions [suspension_record rows, without reason, reason_codes, grounds, request_id or created_by]
--   draft     {state: draft_state of the season or null, picks: [draft_picks of the season]}
--   news, wire  (lazy: only when p_sections names them) the season's news and transactions, plus any with no season
-- Arguments: p_season is a season NUMBER (null = the current season, public.current_season_id()); p_sections names the
-- sections to return (null = every section but the lazy ones; an unknown name raises 22023); p_game_ids narrows games and
-- box to those games (the pulse's stats delta). A season that does not exist raises P0002: a missing input is an error,
-- never an empty page.
--
-- league_tenures is SECURITY DEFINER because roster_tenures is closed to the API (RLS on, no policy, no grant): its
-- joined_how and left_how are free text, up to 231 characters, some naming a ban or a suspension. The text never leaves the
-- database; it is bucketed here, in SQL, once, by two small functions (public._tenure_how_in and public._tenure_how_out)
-- so the self-checks can test the buckets on every value the writers produce, not only on the values Season 1 happens to
-- hold. Any office removal (a ban, a season-long suspension, a withdrawn sign-up) reads 'office', which says no more than
-- the public suspension record and the transaction wire already say. It is league record, like transactions, so anon and
-- authenticated may call it.
-- Who writes the text (read from production 2026-11-23): public._roster_tenure_track (v4.14) writes joined_how = the
-- spot's origin (roster_spots_origin_check, plus db-guards' 'waiver_claim', 'market_bid', 'market_placed'), and on a change
-- of club, squad, position or account a fixed phrase on both ends ('moved to another club' / 'moved from another club',
-- 'moved to training camp', 'moved up to the active roster', 'squad changed', 'position changed', 'spot passed to/from
-- another account'); a removal writes left_how = the reason its door set in app.roster_reason, or 'removed' when none was
-- set. The doors' reasons: waived (waive_player), left the league Discord (sweep_roster_departures), removed by the league
-- office (admin_remove_from_roster), banned (ban_player), suspended for the season (suspension_removes_for_season),
-- sign-up withdrawn by the league office (office_withdraw_registration), pick reversed (draft_reverse_pick), loan returned
-- (preseason_release_loans). The v4.14 backfill added 'traded', 'trade reversed' and 'rebuilt: ...' rows.
-- The draft doors (draft_make_pick, use_draft_pick) and the seat door (ensure_manager_rostered) insert the spot with no
-- origin, so a pick is born 'assigned', like a commissioner's add or a seat. A stint therefore reads 'drafted' when a used
-- pick of that season names the player on that club at that moment (93 of 93 Season 1 picks: the pick and the spot share
-- the transaction's now()), or when draft_reverse_pick ended it (that door clears the pick's player). Everything else
-- 'assigned' stays 'placed' (placed by the league: a commissioner's add, a seat holder's spot). Season 1, 2026-11-23:
-- 96 drafted (93 matched picks and 3 rebuilt rows) for 96 used picks. Season 1's 514 stints, read with these buckets as a
-- plain query: how_in placed 157, squad 118, drafted 96, traded 67, moved 58, signed 16, account 1, carried 1, other 0;
-- how_out open 139, squad 118, traded 67, moved 58, left 55, waived 52, office 24, account 1.
-- shortcut: called straight through PostgREST it is a set-returning result, so the 1000-row ceiling applies to it there;
-- a season has about 500 stints. Read it through s2_league (a scalar, never cut); if a direct reader ever needs it past
-- 1000 rows, page it by joined_at.

-- 1. league_tenures ---------------------------------------------------------------------------------------------------
create or replace function public._tenure_how_in(p_how text, p_drafted boolean)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  /* v4.57: how a stint began, bucketed (league_tenures; sql/2026-11-24-s2-read-layer-v457.sql). p_drafted: the stint is a
     draft pick (league_tenures decides it from public.draft_picks). drafted; signed (free agency, a contract, market_bid);
     claimed (waiver_claim); traded; moved (a club change on a roster row); squad (between the active roster and training
     camp); position (a position change closes one stint and opens the next); account (a spot passed between one member's
     accounts); carried (carried over from the season before); placed (placed by the league: assigned, any random
     placement, market_placed); other (a value no writer is known to produce: the self-checks raise on it). */
  select case
           when p_drafted or p_how = 'draft' or p_how like 'rebuilt: drafted%' then 'drafted'
           when p_how in ('free_agency', 'contract', 'market_bid') then 'signed'
           when p_how = 'waiver_claim' then 'claimed'
           when p_how in ('traded', 'trade reversed') then 'traded'
           when p_how = 'moved from another club' then 'moved'
           when p_how like 'moved to training camp%' or p_how like 'moved up to the active roster%' or p_how = 'squad changed' then 'squad'
           when p_how = 'position changed' then 'position'
           when p_how like 'spot passed from another account%' then 'account'
           when p_how like 'rebuilt: carried over%' then 'carried'
           when p_how in ('assigned', 'placed', 'market_placed') or p_how like '%\_random' or p_how like 'rebuilt: placed%' then 'placed'
           else 'other'
         end
$function$;
revoke all on function public._tenure_how_in(text, boolean) from public, anon, authenticated;

create or replace function public._tenure_how_out(p_how text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  /* v4.57: how a stint ended, bucketed (league_tenures; sql/2026-11-24-s2-read-layer-v457.sql). null while the stint is
     open; squad; position; traded; moved; waived; left (left the league Discord); account; loan (a pre-season loan
     returned); reversed (the office reversed the draft pick); office (every other removal). Why the last arm is 'office':
     a roster row leaves only through a SECURITY DEFINER door (v4.26, grant audit check 9), and every door a club uses
     names its own reason (waived; a trade or a loan), so any other reason is the league office's or a commissioner's:
     removed by the league office, banned, suspended for the season, sign-up withdrawn by the league office, a bare
     'removed' (no reason set) and hand-written office notes. The trigger's own fixed phrases never reach it: the
     self-checks pin every one of them to a named bucket. */
  select case
           when p_how is null then null
           when p_how like 'moved to training camp%' or p_how like 'moved up to the active roster%' or p_how = 'squad changed' then 'squad'
           when p_how = 'position changed' then 'position'
           when p_how in ('traded', 'trade reversed') then 'traded'
           when p_how = 'moved to another club' then 'moved'
           when p_how like 'waived%' then 'waived'
           when p_how like 'left the league Discord%' then 'left'
           when p_how like 'spot passed to another account%' then 'account'
           when p_how = 'loan returned' then 'loan'
           when p_how = 'pick reversed' then 'reversed'
           else 'office'
         end
$function$;
revoke all on function public._tenure_how_out(text) from public, anon, authenticated;

create or replace function public.league_tenures(p_season int)
 returns table(profile_id uuid, team text, team_id uuid, "position" text, squad text, joined_at timestamptz,
               left_at timestamptz, how_in text, how_out text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v4.57: one row per stint of the season (public.roster_tenures, v4.14), the free-text reasons bucketed by
     public._tenure_how_in and public._tenure_how_out (their comments list the buckets). A pick is born 'assigned' (the
     draft doors insert no origin), so it is a draft pick when a used pick of the season names the player on that club at
     that moment (the pick and the spot share the transaction's now()), or when draft_reverse_pick ended the stint (that
     door clears the pick's player); any other 'assigned' stint was placed by the league. */
  select rt.profile_id, t.code as team, rt.team_id, rt.position, rt.squad, rt.joined_at, rt.left_at,
         public._tenure_how_in(rt.joined_how,
           rt.joined_how = 'assigned'
           and (rt.left_how is not distinct from 'pick reversed'
                or exists (select 1 from public.draft_picks dp
                            where dp.used and dp.player_id = rt.profile_id and dp.season_number = s.number
                              and dp.current_team_id = rt.team_id and dp.picked_at = rt.joined_at))) as how_in,
         public._tenure_how_out(rt.left_how) as how_out
    from public.roster_tenures rt
    join public.seasons s on s.id = rt.season_id
    left join public.teams t on t.id = rt.team_id
   where s.number = p_season
   order by rt.joined_at, rt.profile_id, rt.left_at nulls last
$function$;
revoke all on function public.league_tenures(int) from public, anon, authenticated;
grant execute on function public.league_tenures(int) to anon, authenticated;

-- 2. s2_league --------------------------------------------------------------------------------------------------------
create or replace function public.s2_league(p_season int default null, p_sections text[] default null,
                                            p_game_ids uuid[] default null)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to ''
as $function$
/* v4.57: the Season 2 site's one league read (header of sql/2026-11-24-s2-read-layer-v457.sql). STABLE, so the season
   lookup and the one data statement share the calling query's snapshot. INVOKER: RLS and column grants decide. */
declare
  v_all  constant text[] := array['league','teams','seasons','config','games','box','pct','rosters','ratings','people',
                                  'career','honors','tenures','signups','suspensions','draft','news','wire'];
  v_lazy constant text[] := array['news','wire'];
  v_want text[];
  v_sid  uuid;
  v_num  int;
begin
  if exists (select 1 from unnest(p_sections) x where x is null or not (x = any (v_all))) then
    raise exception 's2_league: unknown section in % (known: %)', p_sections, v_all using errcode = '22023';
  end if;
  select s.id, s.number into v_sid, v_num from public.seasons s
   where s.number = coalesce(p_season, (select c.number from public.seasons c where c.id = public.current_season_id()));
  if v_sid is null then
    raise exception 's2_league: no season %', coalesce(p_season::text, '(no current season)') using errcode = 'P0002';
  end if;
  v_want := coalesce(p_sections, array(select x from unnest(v_all) x where not (x = any (v_lazy))));
  return (
    select jsonb_build_object('generated', now(), 'source', 'live', 'season', v_num, 'sections', to_jsonb(v_want),
             'pulse', (select jsonb_build_object('v', lp.v, 'd', lp.d, 'site_build', lp.site_build)
                         from public.live_pulse lp where lp.id = 1))
    || case when 'league' = any (v_want) then jsonb_build_object('league', jsonb_build_object(
         'leagues', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'name', l.name, 'tier', l.tier,
                        'inspiration', l.inspiration, 'sort_order', l.sort_order, 'emblem_url', l.emblem_url)
                        order by l.sort_order, l.id), '[]'::jsonb) from public.leagues l),
         'divisions', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'sort_order', d.sort_order)
                          order by d.sort_order, d.id), '[]'::jsonb) from public.divisions d)))
       else '{}'::jsonb end
    || case when 'teams' = any (v_want) then jsonb_build_object('teams', (
         select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'city', t.city, 'name', t.name,
                  'arena', t.arena, 'division', t.division, 'conference', t.conference, 'league_id', t.league_id,
                  'color', t.color, 'color2', t.color2, 'logo_url', t.logo_url, 'founded_season', t.founded_season,
                  'owner_profile_id', t.owner_profile_id, 'gm_profile_id', t.gm_profile_id, 'agm_profile_id', t.agm_profile_id)
                  order by t.created_at, t.id), '[]'::jsonb)
           from public.teams t))
       else '{}'::jsonb end
    || case when 'seasons' = any (v_want) then jsonb_build_object('seasons', (
         select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'number', s.number, 'name', s.name, 'status', s.status,
                  'format', s.format, 'registration_open', s.registration_open,
                  'registration_deadline', s.registration_deadline, 'signup_deadline_at', s.signup_deadline_at,
                  'owner_app_deadline', s.owner_app_deadline, 'preseason_starts_at', s.preseason_starts_at,
                  'draft_at', s.draft_at, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                  'playoffs_start_at', s.playoffs_start_at, 'offseason_starts_at', s.offseason_starts_at,
                  'free_agency_opens_at', s.free_agency_opens_at, 'free_agency_closes_at', s.free_agency_closes_at,
                  'trade_deadline_week', s.trade_deadline_week, 'moves_lock_override', s.moves_lock_override,
                  'movement_deadline_fixed', s.movement_deadline_fixed, 'placement_closed_at', s.placement_closed_at,
                  'fa_moves_closed_at', s.fa_moves_closed_at, 'roster_max', s.roster_max, 'salary_cap', s.salary_cap,
                  'owner_salary', s.owner_salary, 'gm_salary', s.gm_salary, 'agm_salary', s.agm_salary,
                  'draft_rounds', s.draft_rounds, 'playoff_min_gp', s.playoff_min_gp,
                  'playoff_floor_ruled', s.playoff_floor_ruled, 'position_locks', s.position_locks, 'weeks', s.weeks,
                  'nights_per_week', s.nights_per_week, 'night_slots', s.night_slots, 'div_games', s.div_games,
                  'nondiv_games', s.nondiv_games, 'skip_holidays', s.skip_holidays, 'created_at', s.created_at)
                  order by s.number), '[]'::jsonb)
           from public.seasons s))
       else '{}'::jsonb end
    || case when 'config' = any (v_want) then jsonb_build_object('config', jsonb_build_object(
         'site', (select coalesce(jsonb_object_agg(sc.key, sc.value), '{}'::jsonb) from public.site_config sc),
         'flags', (select coalesce(jsonb_object_agg(ff.key, ff.enabled), '{}'::jsonb) from public.feature_flags ff)))
       else '{}'::jsonb end
    || case when 'games' = any (v_want) then jsonb_build_object('games', (
         select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'season_id', g.season_id, 'week', g.week,
                  'stage', g.stage, 'status', g.status, 'home', h.code, 'away', a.code,
                  'home_team_id', g.home_team_id, 'away_team_id', g.away_team_id,
                  'scheduled_at', g.scheduled_at, 'rescheduled_from', g.rescheduled_from,
                  'home_score', g.home_score, 'away_score', g.away_score, 'went_ot', g.went_ot,
                  'home_ppg', g.home_ppg, 'home_ppo', g.home_ppo, 'away_ppg', g.away_ppg, 'away_ppo', g.away_ppo,
                  'home_shots', g.home_shots, 'away_shots', g.away_shots,
                  'forfeit_team_id', g.forfeit_team_id, 'forfeit', f.code, 'voided', g.voided,
                  'limit_week', g.limit_week, 'limits_exempt', g.limits_exempt,
                  'twitch_url', g.twitch_url, 'ea_match_id', g.ea_match_id, 'created_at', g.created_at)
                  order by g.scheduled_at, g.id), '[]'::jsonb)
           from public.games g
           left join public.teams h on h.id = g.home_team_id
           left join public.teams a on a.id = g.away_team_id
           left join public.teams f on f.id = g.forfeit_team_id
          where g.season_id = v_sid and (p_game_ids is null or g.id = any (p_game_ids))))
       else '{}'::jsonb end
    || case when 'box' = any (v_want) then jsonb_build_object('box', jsonb_build_object(
         /* v4.57: cols names each value of a line, in order; tools/s2-read-layer-v4.57.test.cjs checks the two lists agree */
         'cols', jsonb_build_array('id', 'team', 'profile_id', 'position', 'is_goalie',
                   'goals', 'assists', 'shots', 'hits', 'pim', 'plus_minus', 'takeaways', 'giveaways',
                   'faceoffs_won', 'faceoffs_lost', 'time_on_ice_seconds', 'offense_rating', 'defense_rating',
                   'team_play_rating', 'passes_completed', 'passes_attempted', 'blocked_shots', 'interceptions',
                   'breakaway_shots', 'breakaway_saves', 'pp_goals', 'sh_goals', 'gwg', 'shot_attempts',
                   'possession_seconds', 'penalties_drawn', 'deflections', 'saucer_passes', 'poke_checks',
                   'saves', 'shots_against', 'goals_against', 'shutout', 'diving_saves', 'shutout_periods',
                   'pen_shot_saves', 'pen_shots_against'),
         'byGame', (select coalesce(jsonb_object_agg(b.game_id, b.lines), '{}'::jsonb) from (
            select gs.game_id, jsonb_agg(jsonb_build_array(gs.id, bt.code, gs.profile_id, gs.position, gs.is_goalie,
                     gs.goals, gs.assists, gs.shots, gs.hits, gs.pim, gs.plus_minus, gs.takeaways, gs.giveaways,
                     gs.faceoffs_won, gs.faceoffs_lost, gs.time_on_ice_seconds, gs.offense_rating, gs.defense_rating,
                     gs.team_play_rating, gs.passes_completed, gs.passes_attempted, gs.blocked_shots, gs.interceptions,
                     gs.breakaway_shots, gs.breakaway_saves, gs.pp_goals, gs.sh_goals, gs.gwg, gs.shot_attempts,
                     gs.possession_seconds, gs.penalties_drawn, gs.deflections, gs.saucer_passes, gs.poke_checks,
                     gs.saves, gs.shots_against, gs.goals_against, gs.shutout, gs.diving_saves, gs.shutout_periods,
                     gs.pen_shot_saves, gs.pen_shots_against) order by gs.id) as lines
              from public.game_stats gs
              join public.games bg on bg.id = gs.game_id
              left join public.teams bt on bt.id = gs.team_id
             where bg.season_id = v_sid and (p_game_ids is null or bg.id = any (p_game_ids))
             group by gs.game_id) b)))
       else '{}'::jsonb end
    || case when 'pct' = any (v_want) then jsonb_build_object('pct', jsonb_build_object('min_gp', public.cghl_settle_gp()))
       else '{}'::jsonb end
    || case when 'rosters' = any (v_want) then jsonb_build_object('rosters', jsonb_build_object(
         'spots', (select coalesce(jsonb_agg(jsonb_build_object('id', rs.id, 'team', rt.code, 'team_id', rs.team_id,
                      'profile_id', rs.profile_id, 'position', rs.position, 'squad', rs.squad, 'status', rs.status,
                      'jersey_number', rs.jersey_number, 'salary', rs.salary, 'origin', rs.origin,
                      'on_block', rs.on_block, 'created_at', rs.created_at)
                      order by rt.code, rs.created_at, rs.id), '[]'::jsonb)
                     from public.roster_spots rs left join public.teams rt on rt.id = rs.team_id
                    where rs.season_id = v_sid),
         'contracts', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'profile_id', c.profile_id,
                          'team', ct.code, 'team_id', c.team_id, 'salary', c.salary, 'start_season', c.start_season,
                          'end_season', c.end_season, 'is_manager', c.is_manager, 'status', c.status,
                          'signed_at', c.signed_at)
                          order by ct.code, c.profile_id, c.id), '[]'::jsonb)
                         from public.contracts c left join public.teams ct on ct.id = c.team_id
                        where v_num between c.start_season and coalesce(c.end_season, c.start_season))))
       else '{}'::jsonb end
    || case when 'ratings' = any (v_want) then jsonb_build_object('ratings', (
         select coalesce(jsonb_agg(jsonb_build_object('profile_id', r.profile_id, 'pos_cat', r.pos_cat,
                  'overall', r.overall, 'gp', r.gp, 'headline', r.headline, 'categories', r.categories, 'v448', true)
                  order by r.profile_id, r.pos_cat), '[]'::jsonb)
           from public.player_position_overalls r))
       else '{}'::jsonb end
    || case when 'people' = any (v_want) then jsonb_build_object('people', (
         select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'gamertag', p.gamertag, 'display_name', p.display_name,
                  'avatar_url', p.avatar_url, 'role', p.role, 'jersey_number', p.jersey_number,
                  'platform', p.platform, 'banned', p.banned)
                  order by p.id), '[]'::jsonb)
           from public.profiles p))
       else '{}'::jsonb end
    || case when 'career' = any (v_want) then jsonb_build_object('career', (
         select coalesce(jsonb_object_agg(cg.profile_id, cg.gp), '{}'::jsonb) from public.career_games_played() cg))
       else '{}'::jsonb end
    || case when 'honors' = any (v_want) then jsonb_build_object('honors', (
         select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'season', ws.number, 'week', w.week,
                  'category', w.category, 'profile_id', w.profile_id, 'team', wt.code, 'team_id', w.team_id,
                  'stat_line', w.stat_line, 'created_at', w.created_at)
                  order by ws.number, w.week nulls last, w.category, w.id), '[]'::jsonb)
           from public.awards w
           left join public.seasons ws on ws.id = w.season_id
           left join public.teams wt on wt.id = w.team_id))
       else '{}'::jsonb end
    || case when 'tenures' = any (v_want) then jsonb_build_object('tenures', (
         select coalesce(jsonb_agg(jsonb_build_object('profile_id', tn.profile_id, 'team', tn.team,
                  'team_id', tn.team_id, 'position', tn.position, 'squad', tn.squad, 'joined_at', tn.joined_at,
                  'left_at', tn.left_at, 'how_in', tn.how_in, 'how_out', tn.how_out)
                  order by tn.joined_at, tn.profile_id, tn.left_at nulls last), '[]'::jsonb)
           from public.league_tenures(v_num) tn))
       else '{}'::jsonb end
    || case when 'signups' = any (v_want) then jsonb_build_object('signups', (
         select coalesce(jsonb_agg(jsonb_build_object('id', rp.id, 'profile_id', rp.profile_id,
                  'gamertag', rp.gamertag, 'status', rp.status, 'position', rp.position,
                  'created_at', rp.created_at, 'waived_at', rp.waived_at)
                  order by rp.created_at, rp.id), '[]'::jsonb)
           from public.registration_pool() rp where rp.season_id = v_sid))
       else '{}'::jsonb end
    || case when 'suspensions' = any (v_want) then jsonb_build_object('suspensions', (
         select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'profile_id', x.profile_id, 'season_id', x.season_id,
                  'team_id', x.team_id, 'mode', x.mode, 'scope', x.scope, 'venue', x.venue, 'status', x.status,
                  'running', x.running, 'games_total', x.games_total, 'games_served', x.games_served,
                  'ends_at', x.ends_at, 'until_season', x.until_season, 'served_at', x.served_at,
                  'lifted_at', x.lifted_at, 'created_at', x.created_at)
                  order by x.created_at desc, x.id), '[]'::jsonb)
           from public.suspension_record x))
       else '{}'::jsonb end
    || case when 'draft' = any (v_want) then jsonb_build_object('draft', jsonb_build_object(
         'state', (select jsonb_build_object('season_number', ds.season_number, 'status', ds.status,
                      'pick_seconds', ds.pick_seconds, 'current_overall', ds.current_overall,
                      'clock_ends_at', ds.clock_ends_at, 'paused_remaining', ds.paused_remaining,
                      'order_meta', ds.order_meta, 'updated_at', ds.updated_at)
                     from public.draft_state ds where ds.season_number = v_num),
         'picks', (select coalesce(jsonb_agg(jsonb_build_object('id', dp.id, 'round', dp.round,
                      'overall_pick', dp.overall_pick, 'original_team', ot.code, 'current_team', ct2.code,
                      'original_team_id', dp.original_team_id, 'current_team_id', dp.current_team_id,
                      'player_id', dp.player_id, 'used', dp.used, 'skipped', dp.skipped, 'picked_at', dp.picked_at)
                      order by dp.round, dp.overall_pick nulls last, dp.id), '[]'::jsonb)
                     from public.draft_picks dp
                     left join public.teams ot on ot.id = dp.original_team_id
                     left join public.teams ct2 on ct2.id = dp.current_team_id
                    where dp.season_number = v_num)))
       else '{}'::jsonb end
    || case when 'news' = any (v_want) then jsonb_build_object('news', (
         select coalesce(jsonb_agg(jsonb_build_object('id', nw.id, 'season_id', nw.season_id, 'category', nw.category,
                  'title', nw.title, 'body', nw.body, 'author', nw.author, 'published_at', nw.published_at)
                  order by nw.published_at desc, nw.id), '[]'::jsonb)
           from public.news nw where nw.season_id = v_sid or nw.season_id is null))
       else '{}'::jsonb end
    || case when 'wire' = any (v_want) then jsonb_build_object('wire', (
         select coalesce(jsonb_agg(jsonb_build_object('id', tx.id, 'season_id', tx.season_id, 'type', tx.type,
                  'description', tx.description, 'occurred_at', tx.occurred_at)
                  order by tx.occurred_at desc, tx.id), '[]'::jsonb)
           from public.transactions tx where tx.season_id = v_sid or tx.season_id is null))
       else '{}'::jsonb end
  );
end $function$;
revoke all on function public.s2_league(int, text[], uuid[]) from public, anon, authenticated;
grant execute on function public.s2_league(int, text[], uuid[]) to anon, authenticated;

-- 3. self-checks (they raise, so a wrong result rolls the migration back) ----------------------------------------------
do $chk$
declare
  v_s1 uuid := (select id from public.seasons where number = 1);
  b jsonb; ba jsonb; n int; v_bad text;
begin
  -- security mode, search_path and grants
  if (select prosecdef from pg_proc where oid = 'public.s2_league(int,text[],uuid[])'::regprocedure)
     or (select proconfig from pg_proc where oid = 'public.s2_league(int,text[],uuid[])'::regprocedure) <> array['search_path=""'] then
    raise exception 's2_league must be SECURITY INVOKER with search_path ''''';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.league_tenures(int)'::regprocedure)
     or (select proconfig from pg_proc where oid = 'public.league_tenures(int)'::regprocedure) <> array['search_path=""'] then
    raise exception 'league_tenures must be SECURITY DEFINER with search_path ''''';
  end if;
  if not (has_function_privilege('anon', 'public.s2_league(int,text[],uuid[])', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.s2_league(int,text[],uuid[])', 'EXECUTE')
          and has_function_privilege('anon', 'public.league_tenures(int)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.league_tenures(int)', 'EXECUTE')) then
    raise exception 'anon and authenticated must be able to call s2_league and league_tenures';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid in ('public.s2_league(int,text[],uuid[])'::regprocedure, 'public.league_tenures(int)'::regprocedure)
                and a.grantee = 0) then
    raise exception 'PUBLIC still holds EXECUTE on s2_league or league_tenures';
  end if;

  -- Season 1, every section (lazy ones too): counts equal direct reads
  b := public.s2_league(1, array['league','teams','seasons','config','games','box','pct','rosters','ratings','people',
                                 'career','honors','tenures','signups','suspensions','draft','news','wire']);
  if jsonb_array_length(b->'games') <> (select count(*) from public.games where season_id = v_s1) then
    raise exception 'games: % in the body, % in the table', jsonb_array_length(b->'games'),
      (select count(*) from public.games where season_id = v_s1);
  end if;
  select coalesce(sum(jsonb_array_length(e.value)), 0) into n from jsonb_each(b->'box'->'byGame') e;
  if n <> (select count(*) from public.game_stats gs join public.games g on g.id = gs.game_id where g.season_id = v_s1) then
    raise exception 'box: % lines in the body, % in the table', n,
      (select count(*) from public.game_stats gs join public.games g on g.id = gs.game_id where g.season_id = v_s1);
  end if;
  if exists (select 1 from jsonb_each(b->'box'->'byGame') e, jsonb_array_elements(e.value) l
              where jsonb_array_length(l) <> jsonb_array_length(b->'box'->'cols')) then
    raise exception 'box: a line does not have one value per column';
  end if;
  if jsonb_array_length(b->'rosters'->'spots') <> (select count(*) from public.roster_spots where season_id = v_s1) then
    raise exception 'rosters: spot count differs';
  end if;
  if jsonb_array_length(b->'tenures') <> (select count(*) from public.roster_tenures where season_id = v_s1) then
    raise exception 'tenures: % in the body, % in the table', jsonb_array_length(b->'tenures'),
      (select count(*) from public.roster_tenures where season_id = v_s1);
  end if;
  if jsonb_array_length(b->'people') <> (select count(*) from public.profiles) then
    raise exception 'people: count differs';
  end if;
  if jsonb_array_length(b->'seasons') <> (select count(*) from public.seasons) then
    raise exception 'seasons: count differs';
  end if;
  -- the same read as a signed-out visitor. s2_league is INVOKER, so one lost column grant or policy raises 42501 for every
  -- visitor at once, and the owner's calls here cannot see that; this one can
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  ba := public.s2_league(1);
  perform set_config('role', 'none', true);
  select coalesce(sum(jsonb_array_length(e.value)), 0) into n from jsonb_each(ba->'box'->'byGame') e;
  if jsonb_array_length(ba->'games') <> (select count(*) from public.games where season_id = v_s1)
     or n <> (select count(*) from public.game_stats gs join public.games g on g.id = gs.game_id where g.season_id = v_s1)
     or jsonb_array_length(ba->'rosters'->'spots') <> (select count(*) from public.roster_spots where season_id = v_s1)
     or jsonb_array_length(ba->'tenures') <> (select count(*) from public.roster_tenures where season_id = v_s1)
     or jsonb_array_length(ba->'people') <> (select count(*) from public.profiles) then
    raise exception 'a signed-out visitor reads different counts from s2_league(1) than the tables hold';
  end if;
  -- the buckets, on every value the writers produce (read from production 2026-11-23; the header lists the writers).
  -- tools/s2-read-layer-v4.57.test.cjs also checks these lists against the newest tenure trigger, every roster reason a
  -- sql/ record sets, and the origin check, so a writer's new phrase fails the tests until it is given a bucket here.
  select string_agg(format('%s gave %s, want %s', v.how, coalesce(public._tenure_how_in(v.how, false), 'null'), v.want), '; ') into v_bad
    from (values ('assigned', 'placed'), ('placed', 'placed'), ('preseason_random', 'placed'), ('rookie_random', 'placed'),
                 ('latecomer_random', 'placed'), ('postdraft_random', 'placed'), ('depth_random', 'placed'), ('market_placed', 'placed'),
                 ('draft', 'drafted'), ('free_agency', 'signed'), ('contract', 'signed'), ('market_bid', 'signed'),
                 ('waiver_claim', 'claimed'), ('moved from another club', 'moved'), ('moved to training camp', 'squad'),
                 ('moved up to the active roster', 'squad'), ('squad changed', 'squad'), ('position changed', 'position'),
                 ('spot passed from another account', 'account'), ('traded', 'traded'), ('trade reversed', 'traded'),
                 ('rebuilt: drafted', 'drafted'), ('rebuilt: placed by the league office after the draft', 'placed'),
                 ('rebuilt: carried over from an earlier account', 'carried')) v(how, want)
   where public._tenure_how_in(v.how, false) is distinct from v.want;
  if v_bad is not null or public._tenure_how_in('assigned', true) <> 'drafted' then
    raise exception 'league_tenures how_in buckets are wrong: %', coalesce(v_bad, 'a drafted assigned stint');
  end if;
  select string_agg(format('%s gave %s, want %s', coalesce(v.how, 'null'), coalesce(public._tenure_how_out(v.how), 'null'), coalesce(v.want, 'null')), '; ') into v_bad
    from (values ('moved to another club', 'moved'), ('moved to training camp', 'squad'), ('moved up to the active roster', 'squad'),
                 ('squad changed', 'squad'), ('position changed', 'position'), ('spot passed to another account', 'account'),
                 ('removed', 'office'), ('waived', 'waived'), ('left the league Discord (Rule 1.1)', 'left'),
                 ('loan returned', 'loan'), ('pick reversed', 'reversed'), ('removed by the league office', 'office'),
                 ('banned', 'office'), ('suspended for the season', 'office'), ('sign-up withdrawn by the league office', 'office'),
                 ('traded', 'traded'), ('trade reversed', 'traded'), (null, null)) v(how, want)
   where public._tenure_how_out(v.how) is distinct from v.want;
  if v_bad is not null then raise exception 'league_tenures how_out buckets are wrong: %', v_bad; end if;
  -- every fixed phrase the live tenure trigger writes is one of the values above (comments stripped; 'tc' and 'pro' are
  -- squad codes it compares, not phrases)
  select string_agg(distinct m[1], ', ') into v_bad
    from regexp_matches(regexp_replace(regexp_replace(pg_get_functiondef('public._roster_tenure_track()'::regprocedure),
                                                      '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g'),
                        '''((?:[^'']|'''')*)''', 'g') m
   where m[1] ~ '^[a-z][a-z ]*[a-z]$'
     and m[1] not in ('tc', 'pro', 'placed', 'removed', 'moved to another club', 'moved from another club',
                      'moved to training camp', 'moved up to the active roster', 'squad changed', 'position changed',
                      'spot passed to another account', 'spot passed from another account');
  if v_bad is not null then raise exception 'the tenure trigger writes phrases league_tenures has no bucket for: %', v_bad; end if;
  -- every origin the live origin check allows begins a stint in a named bucket
  select string_agg(m[1], ', ') into v_bad
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
   where c.conrelid = 'public.roster_spots'::regclass and c.conname = 'roster_spots_origin_check'
     and public._tenure_how_in(m[1], false) = 'other';
  if v_bad is not null then raise exception 'roster origins with no league_tenures bucket: %', v_bad; end if;
  -- on the data: no stint of any season reads 'other', and every used pick reads 'drafted' on the club that used it
  if exists (select 1 from public.seasons x, public.league_tenures(x.number) t where t.how_in = 'other') then
    raise exception 'league_tenures: a stint began in a way that has no bucket';
  end if;
  with t as (select x.number, lt.* from public.seasons x, public.league_tenures(x.number) lt)
  select count(*) into n from public.draft_picks dp
   where dp.used and not exists (select 1 from t where t.number = dp.season_number and t.profile_id = dp.player_id
                                   and t.team_id = dp.current_team_id and t.how_in = 'drafted');
  if n <> 0 then raise exception 'league_tenures: % used draft picks do not read drafted', n; end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid in ('public._tenure_how_in(text,boolean)'::regprocedure, 'public._tenure_how_out(text)'::regprocedure)
                and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)) then
    raise exception 'the tenure bucket helpers are callable through the API';
  end if;
  -- no denied column anywhere in the body, as a key or a box column (site_config's public discord_invite is allowed)
  v_bad := (select string_agg(distinct m[1], ', ') from regexp_matches(b::text,
             '"(ea_id|ea_player_id|skater_name|discord_id|discord_username|discord_role_id|discord_channel_id|ea_club_id|ea_club_name|timezone|departments|preferred_server|game_code|server|payload|subject|details|response|reason|reason_codes|grounds|credit|joined_how|left_how|command|ban_reason|banned_at|banned_by|is_admin|platform_gamertag)": ', 'g') m);
  if v_bad is not null then raise exception 's2_league returns denied columns: %', v_bad; end if;
  if (b->'box'->'cols') ?| array['ea_player_id', 'skater_name', 'season_id', 'created_at'] then
    raise exception 's2_league box carries a denied column';
  end if;
  -- the default sections leave out the lazy ones; a named delta returns only what it names
  b := public.s2_league(1);
  if b ? 'news' or b ? 'wire' or not (b ? 'box' and b ? 'tenures' and b ? 'pulse') then
    raise exception 's2_league default sections are wrong: %', (select array_agg(k) from jsonb_object_keys(b) k);
  end if;
  b := public.s2_league(1, array['games','box'], array[(select id from public.games where season_id = v_s1 order by scheduled_at limit 1)]);
  if jsonb_array_length(b->'games') <> 1 or (select count(*) from jsonb_object_keys(b->'box'->'byGame')) > 1 or b ? 'people' then
    raise exception 's2_league p_game_ids or p_sections did not narrow the body';
  end if;
  -- fail loud: an unknown section and a missing season are errors
  begin
    perform public.s2_league(1, array['standings']);
    raise exception 'an unknown section did not raise';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.s2_league(999);
    raise exception 'a missing season did not raise';
  exception when sqlstate 'P0002' then null;
  end;
end $chk$;

/* REHEARSAL on production, 2026-11-23 (main session), sql/2026-11-24-s2-read-layer-v457.rehearsal.sql: one transaction
   ended by an uncaught raise, rolled back. One rehearsal-only fix before it passed: T5 picked the earliest Season 1 final,
   a forfeit with no box score (several finals share that start), so it now picks a final that has box lines.
   Result: REHEARSAL OK: anon, member and media: counts equal direct reads for every season (S1 241 games, 2510 lines,
   139 spots, 514 tenures). T4 anon: roster_tenures 42501 (closed, as intended), league_tenures answers bucketed, 96 drafted
   for 96 used picks. T5 anon: one-game delta, lazy news and wire, unknown section 22023, missing season P0002. T6 staffer:
   same counts. Slowest s2_league call 272 ms. 
   Applied 2026-11-24 (main session) as migration v457_s2_league_reads; tools/sql/grant-audit.sql returned zero rows. */
