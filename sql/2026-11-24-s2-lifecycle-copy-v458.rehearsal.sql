-- REHEARSAL for sql/2026-11-24-s2-lifecycle-copy-v458.sql (the main session runs it; it is never applied).
-- Run as ONE execute_sql query, so it is one transaction, with the texts in this order:
--   1. sql/2026-11-24-s2-draft-night-guards-v458.sql (db-guards), unless it is already applied: it creates market_on and
--      the Season 2 season_rules keys this record branches on, and the record refuses to apply without them.
--      While that record does not exist yet, the stand-in below may take its place, and the result is PENDING db-guards.
--   2. sql/2026-11-24-s2-lifecycle-copy-v458.sql (the record)
--   3. this file
-- It ends in an uncaught raise, so everything rolls back: the patched function, the Season 2 dates moved for the test,
-- the announcement marks, the draft_state row, and every Discord request queued by pg_net (transactional, so nothing is
-- sent). No outer exception handler, no dblink, no http.
--
-- Stand-in for step 1, only while db-guards' record is unavailable (a copy of the contract's condition, rehearsal only):
--   create or replace function public.market_on(p_season uuid) returns boolean language sql stable set search_path to ''
--   as $f$ select coalesce((select s.number >= 2 and s.format = 'basic' from public.seasons s where s.id = p_season), false) $f$;
--
-- Cases:
--   T0 Season 2 is a market season and both registering and current; Season 1 is not a market season.
--   T1 upcoming windows: reg_open (fallback text, override removed), reg_close_24h, draft_tonight, season_tonight and
--      playoffs_tonight post once each, to their own channels, with no dash and no Season 1 promise; fa_close_6h does
--      not post.
--   T2 the reg_open override is still honored word for word.
--   T3 past windows with the draft complete: reg_closed and the training camp pool notice (fa_open, #free-agency) post;
--      fa_closed does not, since the movement deadline has not passed.
--   T4 the movement deadline passes: fa_closed posts the one deadline sentence to #free-agency, once; a second run posts
--      nothing.
--   T5 every queued request in this transaction is counted, and all of them roll back with it.
-- Every count reads only requests to the five lifecycle webhooks whose embed title is a lifecycle title, so a post another
-- job commits to the same channel while this runs is not counted (the body is parsed only for those webhooks).

do $reh$
declare
  s2 public.seasons;
  v_q0 bigint; v_qfirst bigint; r record; v_log text := ''; v_n int; v_keys text; v_txt text;
  v_ov_title text; v_ov_text text; v_total int := 0;
  v_dash text := '[' || chr(8212) || chr(8211) || ']';
  v_hooks text[] := array['discord_signup_webhook','discord_announcements_webhook','discord_freeagency_webhook','discord_default_webhook','discord_schedule_webhook'];
  v_titles text[] := array['Registration is OPEN', 'Draft-eligibility deadline is tomorrow', 'The draft class is set', 'Draft night is tonight',
                           'Puck drops tonight', 'The playoffs start tonight', 'The training camp pool is open', 'Roster movement is closed',
                           'Free agency is OPEN', 'Free agency closes soon', 'Free agency is closed'];
  v_deadline text := 'The movement deadline has passed. Waivers, claims and Saturday bidding are closed for the season. Clubs may still use up to three training camp pool players a night, with at least half of each game lineup from the club, until the regular season ends; pool players do not play in the playoffs.';
begin
  select * into s2 from public.seasons where number = 2;

  -- T0
  if not public.market_on(s2.id) then raise exception 'REHEARSAL FAILED T0: Season 2 is not a market season (db-guards first)'; end if;
  if public.market_on((select id from public.seasons where number = 1)) then raise exception 'REHEARSAL FAILED T0: Season 1 reads as a market season'; end if;
  if public.registering_season_id() is distinct from s2.id or public.current_season_id() is distinct from s2.id then
    raise exception 'REHEARSAL FAILED T0: Season 2 is not both the registering and the current season';
  end if;
  v_log := v_log || 'T0 Season 2 is a market season, registering and current; Season 1 is not a market season.';

  -- a clean slate inside this transaction: no Season 2 marks, and the reg_open override set aside for T1
  select value into v_ov_title from public.app_config where key = 'ann_title_2_reg_open';
  select value into v_ov_text from public.app_config where key = 'ann_text_2_reg_open';
  if v_ov_title is not null then v_titles := v_titles || v_ov_title; end if;
  delete from public.app_config where key like 'ann\_2\_%' or key in ('ann_title_2_reg_open', 'ann_text_2_reg_open');

  -- T1
  update public.seasons
     set registration_open = true,
         registration_deadline = now() + interval '2 hours',
         draft_at = now() + interval '3 hours',
         starts_at = now() + interval '4 hours',
         playoffs_start_at = now() + interval '5 hours',
         free_agency_closes_at = now() + interval '1 hour'
   where id = s2.id;
  v_q0 := coalesce((select max(id) from net.http_request_queue), 0);
  v_qfirst := v_q0;
  v_n := public.announce_lifecycle();
  select string_agg(replace(key, 'ann_2_', ''), ',' order by key) into v_keys from public.app_config where key like 'ann\_2\_%';
  if v_keys is distinct from 'draft_tonight,playoffs_tonight,reg_close_24h,reg_open,season_tonight' or v_n <> 5 then
    raise exception 'REHEARSAL FAILED T1: % posts, marks %', v_n, v_keys;
  end if;
  for r in select q.url, convert_from(q.body, 'UTF8')::jsonb->'embeds'->0 as e from net.http_request_queue q
            where q.id > v_q0 and q.url in (select value from public.app_config where key = any(v_hooks))
              and case when q.url in (select value from public.app_config where key = any(v_hooks)) then convert_from(q.body, 'UTF8')::jsonb->'embeds'->0->>'title' end = any(v_titles) order by q.id loop
    v_total := v_total + 1;
    v_txt := coalesce(r.e->>'title', '') || ' | ' || coalesce(r.e->>'description', '');
    if v_txt ~ v_dash or position(' - ' in v_txt) > 0 then raise exception 'REHEARSAL FAILED T1: a dash in: %', v_txt; end if;
    if v_txt ~* '(placed on a club|placed on clubs|as depth|free agen|offers from any club)' then
      raise exception 'REHEARSAL FAILED T1: Season 1 copy in: %', v_txt;
    end if;
    if (r.e->>'title' = 'Registration is OPEN' and (r.url is distinct from (select value from public.app_config where key = 'discord_signup_webhook')
                                                   or position('training camp pool' in r.e->>'description') = 0))
       or (r.e->>'title' = 'Draft-eligibility deadline is tomorrow' and (r.url is distinct from (select value from public.app_config where key = 'discord_signup_webhook')
                                                   or position('training camp pool' in r.e->>'description') = 0))
       or (r.e->>'title' = 'Draft night is tonight' and (r.url is distinct from (select value from public.app_config where key = 'discord_announcements_webhook')
                                                   or position('$750K' in r.e->>'description') = 0
                                                   or position((public.season_rules(s2.id)->>'roster_max') || '-player roster' in r.e->>'description') = 0
                                                   or position((public.season_rules(s2.id)->>'draft_rounds') || ' rounds in a snake order' in r.e->>'description') = 0))
       or (r.e->>'title' = 'Puck drops tonight' and position('training camp pool requests' in r.e->>'description') = 0) then
      raise exception 'REHEARSAL FAILED T1: wrong channel or copy for: %', v_txt;
    end if;
    v_log := v_log || chr(10) || '   ' || v_txt;
  end loop;
  if v_total <> 5 then raise exception 'REHEARSAL FAILED T1: % announcement requests queued, expected 5', v_total; end if;
  v_log := v_log || chr(10) || 'T1 five posts, one per key, each to its channel, no dash, no Season 1 promise; fa_close_6h held back.';

  -- T2
  if v_ov_text is null then
    v_log := v_log || chr(10) || 'T2 skipped: Season 2 has no reg_open override to honor.';
  else
    delete from public.app_config where key = 'ann_2_reg_open';
    insert into public.app_config (key, value) values ('ann_text_2_reg_open', v_ov_text);
    if v_ov_title is not null then insert into public.app_config (key, value) values ('ann_title_2_reg_open', v_ov_title); end if;
    v_q0 := coalesce((select max(id) from net.http_request_queue), 0);
    v_n := public.announce_lifecycle();
    v_total := 0;
    for r in select convert_from(q.body, 'UTF8')::jsonb->'embeds'->0 as e from net.http_request_queue q
              where q.id > v_q0 and q.url in (select value from public.app_config where key = any(v_hooks))
                and case when q.url in (select value from public.app_config where key = any(v_hooks)) then convert_from(q.body, 'UTF8')::jsonb->'embeds'->0->>'title' end = any(v_titles) loop
      if r.e->>'description' = v_ov_text and r.e->>'title' is not distinct from coalesce(v_ov_title, 'Registration is OPEN') then
        v_total := v_total + 1;
      end if;
    end loop;
    if v_n <> 1 or v_total <> 1 then raise exception 'REHEARSAL FAILED T2: the override was not posted word for word (% posts, % matching)', v_n, v_total; end if;
    v_log := v_log || chr(10) || 'T2 the reg_open override posted word for word.';
  end if;

  -- T3
  update public.seasons set registration_deadline = now() - interval '1 hour', free_agency_closes_at = now() - interval '1 hour' where id = s2.id;
  insert into public.draft_state (season_number, status, pick_seconds, current_overall, updated_at)
    values (2, 'complete', 120, 1, now())
    on conflict (season_number) do update set status = 'complete', updated_at = now();
  v_q0 := coalesce((select max(id) from net.http_request_queue), 0);
  v_n := public.announce_lifecycle();
  if v_n <> 2 or not exists (select 1 from public.app_config where key = 'ann_2_reg_closed')
     or not exists (select 1 from public.app_config where key = 'ann_2_fa_open')
     or exists (select 1 from public.app_config where key in ('ann_2_fa_closed', 'ann_2_fa_close_6h')) then
    raise exception 'REHEARSAL FAILED T3: % posts; marks %', v_n, (select string_agg(key, ',' order by key) from public.app_config where key like 'ann\_2\_%');
  end if;
  v_total := 0;
  for r in select q.url, convert_from(q.body, 'UTF8')::jsonb->'embeds'->0 as e from net.http_request_queue q
            where q.id > v_q0 and q.url in (select value from public.app_config where key = any(v_hooks))
              and case when q.url in (select value from public.app_config where key = any(v_hooks)) then convert_from(q.body, 'UTF8')::jsonb->'embeds'->0->>'title' end = any(v_titles) order by q.id loop
    v_total := v_total + 1;
    v_txt := coalesce(r.e->>'title', '') || ' | ' || coalesce(r.e->>'description', '');
    if v_txt ~ v_dash or position(' - ' in v_txt) > 0 then raise exception 'REHEARSAL FAILED T3: a dash in: %', v_txt; end if;
    if v_txt ~* '(placed on a club|placed on clubs|as depth|free agen|offers from any club)' then
      raise exception 'REHEARSAL FAILED T3: Season 1 copy in: %', v_txt;
    end if;
    if (r.e->>'title' = 'The training camp pool is open' and r.url is distinct from (select value from public.app_config where key = 'discord_freeagency_webhook'))
       or (r.e->>'title' = 'The draft class is set' and (r.url is distinct from (select value from public.app_config where key = 'discord_signup_webhook')
                                                       or position('training camp pool' in r.e->>'description') = 0)) then
      raise exception 'REHEARSAL FAILED T3: wrong channel or copy for: %', v_txt;
    end if;
    v_log := v_log || chr(10) || '   ' || v_txt;
  end loop;
  if v_total <> 2 then raise exception 'REHEARSAL FAILED T3: % announcement requests queued, expected 2', v_total; end if;
  v_log := v_log || chr(10) || 'T3 reg_closed and the training camp pool notice (#free-agency) posted; fa_closed held back until the movement deadline.';

  -- T4: the movement deadline passes (movement_deadline_at reads the fixed deadline first)
  update public.seasons set movement_deadline_fixed = now() - interval '1 hour' where id = s2.id;
  if public.movement_deadline_at(s2.id) is distinct from now() - interval '1 hour' then
    raise exception 'REHEARSAL FAILED T4: movement_deadline_at does not read the fixed deadline';
  end if;
  v_q0 := coalesce((select max(id) from net.http_request_queue), 0);
  v_n := public.announce_lifecycle();
  if v_n <> 1 or not exists (select 1 from public.app_config where key = 'ann_2_fa_closed')
     or exists (select 1 from public.app_config where key = 'ann_2_fa_close_6h') then
    raise exception 'REHEARSAL FAILED T4: % posts; marks %', v_n, (select string_agg(key, ',' order by key) from public.app_config where key like 'ann\_2\_%');
  end if;
  v_total := 0;
  for r in select q.url, convert_from(q.body, 'UTF8')::jsonb->'embeds'->0 as e from net.http_request_queue q
            where q.id > v_q0 and q.url in (select value from public.app_config where key = any(v_hooks))
              and case when q.url in (select value from public.app_config where key = any(v_hooks)) then convert_from(q.body, 'UTF8')::jsonb->'embeds'->0->>'title' end = any(v_titles) order by q.id loop
    v_total := v_total + 1;
    if r.e->>'title' is distinct from 'Roster movement is closed' or r.e->>'description' is distinct from v_deadline
       or r.url is distinct from (select value from public.app_config where key = 'discord_freeagency_webhook') then
      raise exception 'REHEARSAL FAILED T4: wrong post at the deadline: % | %', r.e->>'title', r.e->>'description';
    end if;
    v_log := v_log || chr(10) || '   ' || (r.e->>'title') || ' | ' || (r.e->>'description');
  end loop;
  if v_total <> 1 then raise exception 'REHEARSAL FAILED T4: % deadline requests queued, expected 1', v_total; end if;
  v_n := public.announce_lifecycle();
  if v_n <> 0 then raise exception 'REHEARSAL FAILED T4: a second run posted % more', v_n; end if;
  v_log := v_log || chr(10) || 'T4 the movement deadline post went to #free-agency once, word for word; a second run posted nothing.';

  -- T5
  select count(*) into v_total from net.http_request_queue q
   where q.id > v_qfirst and q.url in (select value from public.app_config where key = any(v_hooks))
     and case when q.url in (select value from public.app_config where key = any(v_hooks)) then convert_from(q.body, 'UTF8')::jsonb->'embeds'->0->>'title' end = any(v_titles);
  v_log := v_log || chr(10) || 'T5 ' || v_total || ' Discord requests were queued in this transaction; the closing raise rolls every one back.';

  raise exception 'REHEARSAL OK: T0 T1 T2 T3 T4 T5%', chr(10) || v_log;
end $reh$;
