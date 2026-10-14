-- v4.05 (2026-10-14): the league pulse, so open pages update themselves.
--
-- Commissioner, 2026-10-14: "How can me make the entire website auto refresh changes so people dont have to go manually
-- refresh the page all the time?" and "I want to maximize the efficiency of this project so I dont use up all of our
-- netlify usage." (Approved: "Build it".)
--
-- How it works:
--  1. Statement-level triggers on the league's public tables write a small mark (a data "domain" such as scores or
--     rosters, and for box scores the game id) into public.live_marks, but only when a row really changed: an UPDATE is
--     compared row for row with its columns that do not matter left out, so the sweeps that rewrite unchanged rows every
--     few minutes mark nothing. A fault in a mark never fails the write it rides on (it is caught and raised as a warning).
--  2. Every 10 seconds the live-flush job (pg_cron) takes every mark and makes ONE update to the single row
--     public.live_pulse: each changed domain gets the new version number, and box scores keep a short log of which games
--     changed. That one row is the only new table in the realtime publication, readable by everyone, writable by no one.
--  3. Open pages listen to that row on the channel they already have, and fetch only the domains that changed, spread
--     over a few seconds, and only while the page is visible (see src/live/part_live.js, v4.05).
--  4. New site versions: the build writes /version.json with a build id. The live-site-build job asks for it every 10
--     minutes (about 4,300 tiny requests a month, from the database only; no member's page ever polls Netlify) and
--     copies the id into live_pulse.site_build. Pages compare it with the build they are running and pick up the new
--     version on their next click.
--  5. Housekeeping: cron.job_run_details had never been purged (82 MB, 356,000 rows); a daily job keeps three days.
--     The watchdog alerts the commissioners if marks sit unflushed for two minutes (the site would silently stop
--     updating) or if the build check stops answering.

-- 1. the tables ---------------------------------------------------------------------------------------------------------
create table if not exists public.live_pulse (
  id smallint primary key default 1 check (id = 1),
  v bigint not null default 0,
  d jsonb not null default '{}'::jsonb,
  site_build text,
  site_at timestamptz,
  at timestamptz not null default now()
);
insert into public.live_pulse (id) values (1) on conflict (id) do nothing;
alter table public.live_pulse enable row level security;
drop policy if exists live_pulse_read on public.live_pulse;
create policy live_pulse_read on public.live_pulse for select to anon, authenticated using (true);
revoke all on public.live_pulse from public, anon, authenticated;
grant select on public.live_pulse to anon, authenticated;
do $pub$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_pulse') then
    alter publication supabase_realtime add table public.live_pulse;
  end if;
end $pub$;

create table if not exists public.live_marks (
  id bigserial primary key,
  domain text not null,
  ref uuid,
  at timestamptz not null default clock_timestamp()
);
alter table public.live_marks enable row level security;
revoke all on public.live_marks from public, anon, authenticated;
revoke all on sequence public.live_marks_id_seq from public, anon, authenticated;

-- 2. the marking trigger ------------------------------------------------------------------------------------------------
-- tg_argv: [0] domain, [1] the column whose value names what changed ('' for none: one mark per transaction),
--          [2] comma-separated columns an UPDATE may change without it counting.
create or replace function public._live_mark()
returns trigger
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_domain text := tg_argv[0];
        v_ref text := nullif(coalesce(tg_argv[1], ''), '');
        v_ign text[] := case when coalesce(tg_argv[2], '') = '' then '{}'::text[] else string_to_array(tg_argv[2], ',') end;
        v_any boolean;
begin
  begin
    if v_ref is not null then
      if tg_op = 'INSERT' then
        execute format('insert into public.live_marks (domain, ref) select distinct $1, (to_jsonb(n)->>%L)::uuid from new_rows n', v_ref) using v_domain;
      elsif tg_op = 'DELETE' then
        execute format('insert into public.live_marks (domain, ref) select distinct $1, (to_jsonb(o)->>%L)::uuid from old_rows o', v_ref) using v_domain;
      else
        execute format('insert into public.live_marks (domain, ref) select distinct $1, (x.j->>%L)::uuid from ('
                    || 'select to_jsonb(n) - $2 as j from new_rows n except select to_jsonb(o) - $2 from old_rows o) x', v_ref)
          using v_domain, v_ign;
      end if;
      return null;
    end if;
    -- one mark per domain per transaction is enough
    if coalesce(current_setting('app.live_m_' || v_domain, true), '') = txid_current()::text then return null; end if;
    if tg_op = 'INSERT' then
      execute 'select exists (select 1 from new_rows)' into v_any;
    elsif tg_op = 'DELETE' then
      execute 'select exists (select 1 from old_rows)' into v_any;
    else
      execute 'select exists (select to_jsonb(n) - $1 from new_rows n except select to_jsonb(o) - $1 from old_rows o)'
        into v_any using v_ign;
    end if;
    if v_any then
      insert into public.live_marks (domain) values (v_domain);
      perform set_config('app.live_m_' || v_domain, txid_current()::text, true);
    end if;
  exception when others then
    raise warning 'live pulse mark (%, %) skipped: %', v_domain, tg_table_name, sqlerrm;
  end;
  return null;
end $function$;
revoke execute on function public._live_mark() from public, anon, authenticated;

-- lobby codes and server picks: their own domain, marked only when one of them changed
create or replace function public._live_mark_codes()
returns trigger
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_any boolean;
begin
  begin
    if coalesce(current_setting('app.live_m_codes', true), '') = txid_current()::text then return null; end if;
    execute 'select exists (select n.id, n.game_code, n.server from new_rows n except select o.id, o.game_code, o.server from old_rows o)' into v_any;
    if v_any then
      insert into public.live_marks (domain) values ('codes');
      perform set_config('app.live_m_codes', txid_current()::text, true);
    end if;
  exception when others then
    raise warning 'live pulse mark (codes) skipped: %', sqlerrm;
  end;
  return null;
end $function$;
revoke execute on function public._live_mark_codes() from public, anon, authenticated;

-- 3. the watched tables -------------------------------------------------------------------------------------------------
do $trg$
declare t record;
begin
  for t in select * from (values
      ('games',                'scores',     '',        'game_code,server'),
      ('game_stats',           'stats',      'game_id', ''),
      ('roster_spots',         'rosters',    '',        ''),
      ('contracts',            'rosters',    '',        'updated_at'),
      ('transactions',         'wire',       '',        ''),
      ('news',                 'news',       '',        ''),
      ('awards',               'news',       '',        ''),
      ('teams',                'league',     '',        ''),
      ('divisions',            'league',     '',        ''),
      ('seasons',              'league',     '',        ''),
      ('leagues',              'league',     '',        ''),
      ('site_config',          'league',     '',        'updated_at'),
      ('feature_flags',        'league',     '',        ''),
      ('season_registrations', 'signups',    '',        'scout_ovr'),
      ('suspensions',          'discipline', '',        ''),
      ('draft_picks',          'picks',      '',        ''),
      ('profiles',             'people',     '',        'discord_id,discord_username,ban_reason,banned_at,banned_by,is_admin,platform_gamertag')
    ) as x(tbl, dom, ref, ign)
  loop
    execute format('drop trigger if exists live_mark_%1$s_ins on public.%1$I', t.tbl);
    execute format('drop trigger if exists live_mark_%1$s_upd on public.%1$I', t.tbl);
    execute format('drop trigger if exists live_mark_%1$s_del on public.%1$I', t.tbl);
    execute format('create trigger live_mark_%1$s_ins after insert on public.%1$I referencing new table as new_rows '
                || 'for each statement execute function public._live_mark(%2$L, %3$L, %4$L)', t.tbl, t.dom, t.ref, t.ign);
    execute format('create trigger live_mark_%1$s_upd after update on public.%1$I referencing new table as new_rows old table as old_rows '
                || 'for each statement execute function public._live_mark(%2$L, %3$L, %4$L)', t.tbl, t.dom, t.ref, t.ign);
    execute format('create trigger live_mark_%1$s_del after delete on public.%1$I referencing old table as old_rows '
                || 'for each statement execute function public._live_mark(%2$L, %3$L, %4$L)', t.tbl, t.dom, t.ref, t.ign);
  end loop;
end $trg$;
drop trigger if exists live_mark_games_codes on public.games;
create trigger live_mark_games_codes after update on public.games referencing new table as new_rows old table as old_rows
  for each statement execute function public._live_mark_codes();

-- 4. the flush: every 10 seconds, one update to the pulse ---------------------------------------------------------------
create or replace function public.live_flush()
returns integer
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare r record; v_n int := 0; v_new bigint; v_d jsonb; v_log jsonb; v_entry jsonb;
begin
  select d, v + 1 into v_d, v_new from public.live_pulse where id = 1 for update;
  for r in
    with gone as (delete from public.live_marks returning domain, ref)
    select domain, count(distinct ref) as nref, jsonb_agg(distinct ref) filter (where ref is not null) as ids
      from gone group by domain
  loop
    v_n := v_n + 1;
    if r.domain = 'stats' then
      -- the games whose box scores changed, so a page fetches just those; null means "too many, re-read the season"
      v_entry := jsonb_build_array(v_new, case when r.nref > 40 or r.ids is null then 'null'::jsonb else r.ids end);
      v_log := coalesce(v_d->'stats'->'log', '[]'::jsonb);
      v_log := jsonb_path_query_array(jsonb_build_array(v_entry) || v_log, '$[0 to 23]');
      v_d := jsonb_set(v_d, '{stats}', jsonb_build_object('v', v_new, 'at', now(), 'log', v_log));
    else
      v_d := jsonb_set(v_d, array[r.domain], jsonb_build_object('v', v_new, 'at', now()));
    end if;
  end loop;
  if v_n > 0 then
    update public.live_pulse set v = v_new, d = v_d, at = now() where id = 1;
  end if;
  return v_n;
end $function$;
revoke execute on function public.live_flush() from public, anon, authenticated;

-- 5. the site build: asked once every 10 minutes by the database, never by members' pages --------------------------------
create or replace function public.live_site_build_check()
returns text
language plpgsql
security definer
set search_path to public, extensions, pg_temp
as $function$
declare v_req bigint; v_status int; v_body text; v_build text; v_cur text;
begin
  v_req := nullif((select value from public.app_config where key = 'live_site_req'), '')::bigint;
  if v_req is not null then
    select r.status_code, r.content into v_status, v_body from net._http_response r where r.id = v_req;
    if v_status = 200 then
      begin v_build := (v_body::jsonb)->>'build'; exception when others then v_build := null; end;
      if v_build ~ '^[0-9a-f]{12}$' then
        select site_build into v_cur from public.live_pulse where id = 1;
        if v_cur is distinct from v_build then
          update public.live_pulse set site_build = v_build, site_at = now(), at = now() where id = 1;
        end if;
        insert into public.app_config (key, value) values ('live_site_ok', now()::text)
          on conflict (key) do update set value = excluded.value;
      end if;
    end if;
  end if;
  v_req := net.http_get(url := 'https://chelgamingleague.com/version.json', headers := '{"Cache-Control":"no-cache"}'::jsonb);
  insert into public.app_config (key, value) values ('live_site_req', v_req::text)
    on conflict (key) do update set value = excluded.value;
  return coalesce(v_build, 'asked');
end $function$;
revoke execute on function public.live_site_build_check() from public, anon, authenticated;

-- 6. the jobs -----------------------------------------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname in ('live-flush', 'live-site-build', 'cron-history-purge');
select cron.schedule('live-flush', '10 seconds', 'select public.live_flush()');
select cron.schedule('live-site-build', '*/10 * * * *', 'select public.live_site_build_check()');
select cron.schedule('cron-history-purge', '23 4 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);

-- 7. the watchdog: the site must never stop updating silently -----------------------------------------------------------
create or replace function public._watch_live_pulse()
returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_why text; v_prev timestamptz; v_hook text; v_ok timestamptz;
begin
  if exists (select 1 from public.live_marks where at < now() - interval '2 minutes') then
    v_why := 'changes are waiting more than two minutes to reach open pages (the live-flush job is not running)';
  else
    v_ok := nullif((select value from public.app_config where key = 'live_site_ok'), '')::timestamptz;
    if v_ok is not null and v_ok < now() - interval '2 hours' then
      v_why := 'the site build check has not had an answer from the live site for two hours, so open pages will not pick up a new version';
    end if;
  end if;
  if v_why is null then return; end if;
  select nullif(value, '')::timestamptz into v_prev from public.app_config where key = 'wd_live_pulse';
  if v_prev is not null and now() - v_prev < interval '6 hours' then return; end if;
  select coalesce((select value from public.app_config where key = 'discord_ops_webhook'),
                  (select value from public.app_config where key = 'discord_updates_webhook')) into v_hook;
  perform public.notify_commissioners(null, 'flag', 'Live updates stalled', v_why || '.', 'automations', null);
  if v_hook is not null then
    perform public.discord_http_post(url := v_hook, headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('content', left('⚠️ Live updates: ' || v_why || '.', 1800)));
  end if;
  insert into public.app_config (key, value) values ('wd_live_pulse', now()::text)
    on conflict (key) do update set value = excluded.value;
end $function$;
revoke execute on function public._watch_live_pulse() from public, anon, authenticated;

do $p$
declare v_def text := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
        a text := '      (''deadline-sweep'', interval ''1 hour''),';
        b text := '      (''deadline-sweep'', interval ''1 hour''),
      (''live-flush'', interval ''10 minutes''),
      (''live-site-build'', interval ''1 hour''),';
        c text := '  -- own heartbeat';
        d text := '  -- 7) v4.05: the league pulse keeps flowing and the build check keeps answering
  begin
    perform public._watch_live_pulse();
  exception when others then
    perform public.notify_commissioners(null, ''flag'', ''Watchdog: the live update check failed'', left(sqlerrm, 300), ''automations'', null);
  end;

  -- own heartbeat';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1
     or (length(v_def) - length(replace(v_def, c, ''))) / length(c) <> 1 then raise exception 'v4.05: automation_watchdog anchors'; end if;
  execute replace(replace(v_def, a, b), c, d);
end $p$;

do $chk$
begin
  if (select count(*) from pg_trigger where tgname like 'live_mark_%') <> 17 * 3 + 1 then
    raise exception 'v4.05: expected 52 live_mark triggers, found %', (select count(*) from pg_trigger where tgname like 'live_mark_%');
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'live_pulse') then
    raise exception 'v4.05: live_pulse is not in the realtime publication';
  end if;
  if (select count(*) from cron.job where jobname in ('live-flush', 'live-site-build', 'cron-history-purge') and active) <> 3 then
    raise exception 'v4.05: a job is missing';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and grantee in ('PUBLIC', 'anon', 'authenticated')
                and routine_name in ('_live_mark', '_live_mark_codes', 'live_flush', 'live_site_build_check', '_watch_live_pulse')) then
    raise exception 'v4.05: an internal function is executable by members';
  end if;
end $chk$;

-- ---------------------------------------------------------------------------------------------------------------------
-- v4.05, second part (migration v405b_live_pulse_review), from a read-only review before the site half shipped:
--  * The build check's requests 404 until the new site deploys, and watchdog section 5 counts every non-2xx pg_net
--    response as a dead Discord webhook. It sent a false "A Discord webhook is failing" alert at 14:30 UTC and its marker
--    would then have hidden a real failure for six hours. The check now records its own request ids, section 5 leaves
--    them out, and the marker is cleared.
--  * The daily purge kept three days of cron history, so a weekly job's last run vanished and section 4 would have
--    reported it as never running. The purge now keeps each job's newest run.
--  * avatar_url flips between two writers through the day, which marked "people" every few minutes and sent every open
--    page back for the whole profiles list. A changed avatar now reaches pages with the next real change or load.

create table if not exists public.live_site_requests (id bigint primary key, at timestamptz not null default now());
alter table public.live_site_requests enable row level security;
revoke all on public.live_site_requests from public, anon, authenticated;

do $p$
declare v_def text := pg_get_functiondef('public.live_site_build_check()'::regprocedure);
        a text := '  v_req := net.http_get(url := ''https://chelgamingleague.com/version.json'', headers := ''{"Cache-Control":"no-cache"}''::jsonb);';
        b text := '  v_req := net.http_get(url := ''https://chelgamingleague.com/version.json'', headers := ''{"Cache-Control":"no-cache"}''::jsonb);
  /* its own requests, so the watchdog never mistakes a 404 here for a dead Discord webhook */
  insert into public.live_site_requests (id) values (v_req) on conflict (id) do nothing;
  delete from public.live_site_requests where at < now() - interval ''1 day'';';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v4.05b: live_site_build_check anchor'; end if;
  execute replace(v_def, a, b);
end $p$;
-- the requests the check already made: every 404 since it started (14:30 UTC) was one of them, verified beforehand
insert into public.live_site_requests (id)
  select r.id from net._http_response r
   where r.status_code = 404 and r.created >= timestamptz '2026-10-14 14:25:00+00'
  on conflict (id) do nothing;

do $p$
declare v_def text := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
        -- anchored on the lines before each query: the first query's last line is also a substring of the second's
        a text := '  select count(*) into v_n from net._http_response
    where created > now() - interval ''40 minutes''
      and (status_code in (401,403,404,410) or (error_msg is not null and error_msg <> ''''));';
        b text := '  select count(*) into v_n from net._http_response
    where created > now() - interval ''40 minutes''
      and (status_code in (401,403,404,410) or (error_msg is not null and error_msg <> ''''))
      and id not in (select s.id from public.live_site_requests s);   -- v4.05b: the build check is not a webhook';
        c text := '        from net._http_response
        where created > now() - interval ''40 minutes''
          and (status_code in (401,403,404,410) or (error_msg is not null and error_msg <> ''''));';
        d text := '        from net._http_response
        where created > now() - interval ''40 minutes''
          and (status_code in (401,403,404,410) or (error_msg is not null and error_msg <> ''''))
          and id not in (select s.id from public.live_site_requests s);';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1
     or (length(v_def) - length(replace(v_def, c, ''))) / length(c) <> 1 then raise exception 'v4.05b: watchdog section 5 anchors'; end if;
  execute replace(replace(v_def, a, b), c, d);
end $p$;
delete from public.app_config where key = 'wd_webhook_dead';

select cron.unschedule(jobid) from cron.job where jobname = 'cron-history-purge';
select cron.schedule('cron-history-purge', '23 4 * * *',
  $$delete from cron.job_run_details d where d.end_time < now() - interval '3 days'
      and d.runid not in (select max(x.runid) from cron.job_run_details x group by x.jobid)$$);

do $trg$
begin
  drop trigger if exists live_mark_profiles_ins on public.profiles;
  drop trigger if exists live_mark_profiles_upd on public.profiles;
  drop trigger if exists live_mark_profiles_del on public.profiles;
  create trigger live_mark_profiles_ins after insert on public.profiles referencing new table as new_rows
    for each statement execute function public._live_mark('people', '', 'discord_id,discord_username,ban_reason,banned_at,banned_by,is_admin,platform_gamertag,avatar_url');
  create trigger live_mark_profiles_upd after update on public.profiles referencing new table as new_rows old table as old_rows
    for each statement execute function public._live_mark('people', '', 'discord_id,discord_username,ban_reason,banned_at,banned_by,is_admin,platform_gamertag,avatar_url');
  create trigger live_mark_profiles_del after delete on public.profiles referencing old table as old_rows
    for each statement execute function public._live_mark('people', '', 'discord_id,discord_username,ban_reason,banned_at,banned_by,is_admin,platform_gamertag,avatar_url');
end $trg$;

do $chk$
begin
  if position('live_site_requests' in pg_get_functiondef('public.automation_watchdog()'::regprocedure)) = 0
     or position('live_site_requests' in pg_get_functiondef('public.live_site_build_check()'::regprocedure)) = 0 then
    raise exception 'v4.05b: the build check is still counted as a webhook';
  end if;
  if (select count(*) from pg_trigger where tgname like 'live_mark_%') <> 52 then raise exception 'v4.05b: trigger count changed'; end if;
  if not exists (select 1 from cron.job where jobname = 'cron-history-purge' and command like '%max(x.runid)%') then
    raise exception 'v4.05b: the purge still drops a job''s last run';
  end if;
end $chk$;
