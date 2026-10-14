-- v4.06 (2026-10-14): the five round-the-clock scheduled jobs move from Netlify to Supabase Edge Functions.
--
-- Commissioner, 2026-10-14: "I want to maximize the efficiency of this project so I dont use up all of our netlify usage",
-- then "Actually dont use the oracle bot" and, for the five jobs, "Supabase". discord-sync, twitch-live-sync and
-- lfg-timers (every 2 minutes) and discord-scheduler and discord-welcome (every 5) were about 82,000 Netlify runs a month.
-- They now run as Supabase Edge Functions (edge/, built from jobs/ by tools/edge/build.mjs and deployed with the
-- Supabase CLI; tools/edge/edge-deploy.yml is the GitHub workflow for it), fired by pg_cron through pg_net.
--
-- One host at a time. public.job_hosts names each job's host ('netlify' or 'edge'). Every run on either host first asks
-- public.job_lease, which hands out a run only to the named host and only when no run of that job is in progress, so a
-- job never runs twice at once and the switch is one UPDATE in either direction, with no deploy:
--     update public.job_hosts set host = 'edge' where fn = 'twitch-live-sync';
-- Netlify keeps its schedules as stand-ins (netlify/functions/<job>.js, jobs/host-gate.mjs) until every job has moved.
--
-- The cron key. pg_cron reaches the Edge Functions with a random key made here, kept only in Vault (edge_cron_key) and
-- never shown to anyone; the functions answer 404 to anything without it (job_lease checks it). Rotate with
--     select vault.update_secret((select id from vault.secrets where name = 'edge_cron_key'), encode(extensions.gen_random_bytes(32), 'hex'));
--
-- Part A (migration v406_edge_jobs) is everything below up to Part B. Part B (migration v406b_edge_jobs_cron) schedules
-- the five cron jobs and is applied after the first deploy, so no tick ever reaches a function that does not exist yet.

-- 1. where each job runs, and its current run ------------------------------------------------------------------------
create table if not exists public.job_hosts (
  fn           text primary key,
  host         text not null default 'netlify' check (host in ('netlify', 'edge')),
  every_min    int  not null check (every_min between 1 and 60),
  host_at      timestamptz not null default now(),    -- when host last changed (trigger below)
  holder       uuid,                                  -- the run in progress, if any
  lease_until  timestamptz,
  run_host     text,                                  -- the last run: where, which build, when, how it went
  run_build    text,
  run_started  timestamptz,
  run_ended    timestamptz,
  last_ok      boolean,
  last_error   text,
  last_ms      int,
  edge_build   text,                                  -- the build the Edge Function reported on its last call
  edge_seen    timestamptz,
  drift_since  timestamptz,                           -- the watchdog's clock for "deployed build is behind the repo"
  nudge_at     timestamptz                            -- request_discord_sync's debounce
);
alter table public.job_hosts enable row level security;
revoke all on public.job_hosts from public, anon, authenticated;

insert into public.job_hosts (fn, every_min) values
  ('discord-sync', 2), ('twitch-live-sync', 2), ('lfg-timers', 2), ('discord-scheduler', 5), ('discord-welcome', 5)
on conflict (fn) do nothing;

create or replace function public._job_hosts_host_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.host is distinct from old.host then
    new.host_at := now();
    new.drift_since := null;
  end if;
  return new;
end $function$;
revoke execute on function public._job_hosts_host_at() from public, anon, authenticated;
drop trigger if exists job_hosts_host_at on public.job_hosts;
create trigger job_hosts_host_at before update on public.job_hosts
  for each row execute function public._job_hosts_host_at();

-- the requests pg_cron sends, so the watchdog reads their answers and never mistakes one for a Discord webhook
create table if not exists public.edge_job_requests (
  id bigint primary key,
  fn text not null,
  at timestamptz not null default now()
);
create index if not exists edge_job_requests_at on public.edge_job_requests (at);
alter table public.edge_job_requests enable row level security;
revoke all on public.edge_job_requests from public, anon, authenticated;

-- 2. the cron key, made here and kept in Vault only ------------------------------------------------------------------
do $v$
begin
  if not exists (select 1 from vault.secrets where name = 'edge_cron_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'edge_cron_key',
      'v4.06: pg_cron to the Supabase Edge jobs; checked by public.job_lease');
  end if;
end $v$;

-- 3. the lease -------------------------------------------------------------------------------------------------------
-- Returns a holder id when the run is granted; 'standby' when this job's host is the other one; 'busy' while a run is in
-- progress; 'denied' for an unknown job, a bad argument or (on Supabase) a wrong key; 'ok' for a probe with a good key.
create or replace function public.job_lease(p_fn text, p_host text, p_build text, p_ttl_s int, p_key text default null,
                                            p_probe boolean default false)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare v public.job_hosts; v_holder uuid;
begin
  if p_host is null or p_host not in ('netlify', 'edge') or p_ttl_s is null or p_ttl_s < 10 or p_ttl_s > 900 then
    return 'denied';
  end if;
  if p_host = 'edge' and (p_key is null or p_key !~ '^[0-9a-f]{64}$'
      or p_key is distinct from (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'edge_cron_key')) then
    return 'denied';
  end if;
  select * into v from public.job_hosts h where h.fn = p_fn for update;
  if not found then return 'denied'; end if;
  if p_host = 'edge' then
    update public.job_hosts set edge_build = left(p_build, 40), edge_seen = now() where fn = p_fn;
  end if;
  if coalesce(p_probe, false) then return 'ok'; end if;
  if v.host <> p_host then return 'standby'; end if;
  if v.lease_until is not null and v.lease_until > now() then return 'busy'; end if;
  v_holder := gen_random_uuid();
  update public.job_hosts
     set holder = v_holder, lease_until = now() + make_interval(secs => p_ttl_s),
         run_host = p_host, run_build = left(p_build, 40), run_started = now()
   where fn = p_fn;
  return v_holder::text;
end $function$;

-- Hands a run back with how it went. Only the holder can; a stale holder (its lease already expired and re-granted) is
-- ignored, so a late answer never clears someone else's run.
create or replace function public.job_release(p_fn text, p_holder uuid, p_ok boolean, p_error text default null,
                                              p_ms int default null)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.job_hosts
     set holder = null, lease_until = null, run_ended = now(), last_ok = p_ok,
         last_error = case when p_ok then null else left(coalesce(p_error, 'no detail'), 300) end, last_ms = p_ms
   where fn = p_fn and holder = p_holder;
  return found;
end $function$;

revoke execute on function public.job_lease(text, text, text, int, text, boolean) from public, anon, authenticated;
revoke execute on function public.job_release(text, uuid, boolean, text, int) from public, anon, authenticated;
grant execute on function public.job_lease(text, text, text, int, text, boolean) to service_role;
grant execute on function public.job_release(text, uuid, boolean, text, int) to service_role;

-- 4. the trigger pg_cron pulls ---------------------------------------------------------------------------------------
-- Allowlisted by job_hosts. A probe (p_probe) asks the function to check its setup without running the job.
create or replace function public.invoke_edge_job(p_fn text, p_probe boolean default false)
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare v_key text; v_id bigint;
begin
  if not exists (select 1 from public.job_hosts h where h.fn = p_fn) then
    raise exception 'invoke_edge_job: unknown job %', p_fn;
  end if;
  /* a run still in progress would only answer busy */
  if not coalesce(p_probe, false) and exists (select 1 from public.job_hosts h where h.fn = p_fn and h.lease_until > now()) then
    return null;
  end if;
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'edge_cron_key';
  if v_key is null then raise exception 'invoke_edge_job: the edge_cron_key secret is missing from Vault'; end if;
  v_id := net.http_post(
    url := 'https://bzbuyclwdhmhdzujxeqd.supabase.co/functions/v1/' || p_fn,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', v_key)
               || case when coalesce(p_probe, false) then '{"x-cron-probe":"1"}'::jsonb else '{}'::jsonb end,
    timeout_milliseconds := 15000);
  insert into public.edge_job_requests (id, fn) values (v_id, p_fn) on conflict (id) do nothing;
  delete from public.edge_job_requests where at < now() - interval '1 day';
  return v_id;
end $function$;
revoke execute on function public.invoke_edge_job(text, boolean) from public, anon, authenticated, service_role;

-- The site's "put Discord in step now" after a role-affecting change (CG.pingDiscordSync), and discord-ops run=now once
-- the sweep has moved. Any signed-in member, as before; one Edge run per 10 seconds at most, and none while one is going.
create or replace function public.request_discord_sync()
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Sign in first';
  end if;
  update public.job_hosts
     set nudge_at = now()
   where fn = 'discord-sync' and host = 'edge'
     and (nudge_at is null or nudge_at < now() - interval '10 seconds')
     and (lease_until is null or lease_until < now());
  if not found then return false; end if;
  perform public.invoke_edge_job('discord-sync');
  return true;
end $function$;
revoke execute on function public.request_discord_sync() from public, anon;
grant execute on function public.request_discord_sync() to authenticated, service_role;

-- 5. the #rules card and the Edge build ids ride version.json --------------------------------------------------------
-- discord-scheduler cannot open the repo's files on Supabase, so the site build publishes the card it needs (current
-- version, chapter titles) in version.json, which this check already reads every 10 minutes, and the expected build id of
-- each Edge job beside it. Both are copied only when they change.
create or replace function public.live_site_build_check()
returns text
language plpgsql
security definer
set search_path to public, extensions, pg_temp
as $function$
declare v_req bigint; v_status int; v_body text; v_doc jsonb; v_build text; v_cur text; v_card jsonb; v_edge jsonb;
begin
  v_req := nullif((select value from public.app_config where key = 'live_site_req'), '')::bigint;
  if v_req is not null then
    select r.status_code, r.content into v_status, v_body from net._http_response r where r.id = v_req;
    if v_status = 200 then
      begin v_doc := v_body::jsonb; exception when others then v_doc := null; end;
      v_build := v_doc->>'build';
      if v_build ~ '^[0-9a-f]{12}$' then
        select site_build into v_cur from public.live_pulse where id = 1;
        if v_cur is distinct from v_build then
          update public.live_pulse set site_build = v_build, site_at = now(), at = now() where id = 1;
        end if;
        insert into public.app_config (key, value) values ('live_site_ok', now()::text)
          on conflict (key) do update set value = excluded.value;
        /* v4.06 */
        v_card := v_doc->'rulesCard';
        if jsonb_typeof(v_card) = 'object'
           and jsonb_typeof(v_card->'changelog') = 'array' and jsonb_array_length(v_card->'changelog') > 0
           and jsonb_typeof(v_card->'chapters') = 'array' and jsonb_array_length(v_card->'chapters') > 0 then
          insert into public.app_config (key, value) values ('rules_card', v_card::text)
            on conflict (key) do update set value = excluded.value, updated_at = now()
            where public.app_config.value is distinct from excluded.value;
        end if;
        v_edge := v_doc->'edge';
        if jsonb_typeof(v_edge) = 'object' then
          insert into public.app_config (key, value) values ('edge_expected_builds', v_edge::text)
            on conflict (key) do update set value = excluded.value, updated_at = now()
            where public.app_config.value is distinct from excluded.value;
        end if;
      end if;
    end if;
  end if;
  v_req := net.http_get(url := 'https://chelgamingleague.com/version.json', headers := '{"Cache-Control":"no-cache"}'::jsonb);
  /* its own requests, so the watchdog never mistakes a 404 here for a dead Discord webhook */
  insert into public.live_site_requests (id) values (v_req) on conflict (id) do nothing;
  delete from public.live_site_requests where at < now() - interval '1 day';
  insert into public.app_config (key, value) values ('live_site_req', v_req::text)
    on conflict (key) do update set value = excluded.value;
  return coalesce(v_build, 'asked');
end $function$;
revoke execute on function public.live_site_build_check() from public, anon, authenticated;

-- the card the live site publishes today (v4.05), so the scheduler has it before the first v4.06 build is read
-- (verified: it hashes to the live app_config.rules_sync_hash, so nothing in #rules changes)
insert into public.app_config (key, value) values ('rules_card', $card${"changelog":[{"version":"4.05","date":null,"dateIso":"2026-10-14"}],"chapters":[{"num":0,"title":"How our season works — and why"},{"num":1,"title":"Membership & conduct"},{"num":2,"title":"Rosters & player movement"},{"num":3,"title":"Scheduling, forfeits & reschedules"},{"num":4,"title":"Game settings & servers"},{"num":5,"title":"Availability & lineups"},{"num":6,"title":"Statistics & verification"},{"num":7,"title":"Discipline, suspensions & appeals"},{"num":8,"title":"Playoffs & seeding"},{"num":9,"title":"Awards & honors"},{"num":10,"title":"Definitions"},{"num":"S2","title":"Season 2: what changes"}]}$card$::jsonb::text)
  on conflict (key) do nothing;

-- 6. the watchdog --------------------------------------------------------------------------------------------------
create or replace function public._wd_alert(p_marker text, p_title text, p_text text)
returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_prev timestamptz; v_hook text;
begin
  select nullif(value, '')::timestamptz into v_prev from public.app_config where key = p_marker;
  if v_prev is not null and now() - v_prev < interval '6 hours' then return; end if;
  select coalesce((select value from public.app_config where key = 'discord_ops_webhook'),
                  (select value from public.app_config where key = 'discord_updates_webhook')) into v_hook;
  perform public.notify_commissioners(null, 'flag', p_title, p_text, 'automations', null);
  if v_hook is not null then
    perform public.discord_http_post(url := v_hook, headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('content', left('⚠️ ' || p_title || ': ' || p_text, 1800)));
  end if;
  insert into public.app_config (key, value) values (p_marker, now()::text)
    on conflict (key) do update set value = excluded.value;
end $function$;
revoke execute on function public._wd_alert(text, text, text) from public, anon, authenticated;

-- The jobs on Supabase: they answer pg_cron, they finish their runs, their runs succeed, and they run the build the repo
-- expects. A job still on Netlify is watched as before (section 1 heartbeats, section 2 results).
create or replace function public._watch_edge_jobs()
returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_n int; v_codes text; v_j record; v_expect jsonb; v_want text; v_ref timestamptz; v_stale interval;
begin
  -- a) pg_cron's calls that came back with anything but 200 (standby, busy) or 202 (started), or with no answer
  select count(*), string_agg(distinct r.fn || ' ' || coalesce(x.status_code::text, 'no answer'), ', ')
    into v_n, v_codes
    from public.edge_job_requests r join net._http_response x on x.id = r.id
   where x.created > now() - interval '40 minutes'
     and (x.status_code is null or x.status_code not in (200, 202) or coalesce(x.error_msg, '') <> '');
  if v_n > 0 then
    perform public._wd_alert('wd_edge_http', 'A scheduled job on Supabase is not answering',
      'Supabase answered ' || v_codes || '. Open the Supabase dashboard, Edge Functions, that job, Logs.');
  end if;

  begin v_expect := nullif((select value from public.app_config where key = 'edge_expected_builds'), '')::jsonb;
  exception when others then v_expect := null; end;

  for v_j in select * from public.job_hosts order by fn loop
    if v_j.host = 'edge' then
      -- b) a job that stopped finishing runs (a worker killed mid-run never hands its run back)
      v_stale := greatest(interval '30 minutes', make_interval(mins => 6 * v_j.every_min));
      v_ref := greatest(v_j.host_at, case when v_j.run_host = 'edge' then v_j.run_ended end);
      if v_ref < now() - v_stale then
        perform public._wd_alert('wd_edge_stale_' || v_j.fn, 'Automation down: ' || v_j.fn,
          v_j.fn || ' has not finished a run on Supabase since '
          || to_char(v_ref at time zone 'America/New_York', 'Mon DD HH12:MI AM') || ' ET. Open the Supabase dashboard, '
          || 'Edge Functions, ' || v_j.fn || ', Logs. To put it back on Netlify meanwhile: update public.job_hosts set host = '
          || '''netlify'' where fn = ''' || v_j.fn || '''.');
      -- c) the last run on Supabase crashed, answered 5xx, or had a secret missing
      elsif v_j.run_host = 'edge' and v_j.last_ok is false then
        perform public._wd_alert('wd_edge_fail_' || v_j.fn, 'Automation failing: ' || v_j.fn,
          v_j.fn || ' failed on Supabase: ' || coalesce(v_j.last_error, 'no detail') || '.');
      end if;
    end if;
    -- d) the deployed build is behind the repo for more than 30 minutes (Supabase does not redeploy on a push; the
    --    GitHub workflow does, and this is how a failed workflow gets noticed)
    v_want := v_expect ->> v_j.fn;
    if v_want is not null and v_j.edge_seen > now() - interval '1 hour' then
      if v_j.edge_build is distinct from v_want then
        if v_j.drift_since is null then
          update public.job_hosts set drift_since = now() where fn = v_j.fn;
        elsif v_j.drift_since < now() - interval '30 minutes' then
          perform public._wd_alert('wd_edge_drift_' || v_j.fn, 'Supabase job out of date: ' || v_j.fn,
            v_j.fn || ' on Supabase is running build ' || coalesce(v_j.edge_build, '?') || ' but the site expects ' || v_want
            || '. The deploy did not finish: run "Deploy Supabase Edge jobs" again on GitHub (Actions).');
        end if;
      elsif v_j.drift_since is not null then
        update public.job_hosts set drift_since = null where fn = v_j.fn;
      end if;
    end if;
  end loop;
end $function$;
revoke execute on function public._watch_edge_jobs() from public, anon, authenticated;

do $p$
declare v_def text := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
        -- section 1: a job that has moved to Supabase is checked there, not on Netlify
        a1 text := '                      else ''Check the Netlify function.'' end;';
        b1 text := '                      when exists (select 1 from public.job_hosts h where h.fn = v_hb.fn and h.host = ''edge'')
                      then ''It runs on Supabase: open the Supabase dashboard, Edge Functions, '' || v_hb.fn || '', Logs.''
                      else ''Check the Netlify function.'' end;';
        -- section 4: the five pg_cron triggers (checked only once they exist)
        a4 text := '      (''live-site-build'', interval ''1 hour''),';
        b4 text := '      (''live-site-build'', interval ''1 hour''),
      (''edge-discord-sync'', interval ''10 minutes''),
      (''edge-twitch-live-sync'', interval ''10 minutes''),
      (''edge-lfg-timers'', interval ''10 minutes''),
      (''edge-discord-scheduler'', interval ''20 minutes''),
      (''edge-discord-welcome'', interval ''20 minutes''),';
        -- section 5 (both queries): pg_cron's calls to the Edge jobs are not Discord webhooks
        a5 text := 'and id not in (select s.id from public.live_site_requests s)';
        b5 text := 'and id not in (select s.id from public.live_site_requests s) and id not in (select e.id from public.edge_job_requests e)';
        -- section 8
        a8 text := '  -- own heartbeat';
        b8 text := '  -- 8) v4.06: the scheduled jobs on Supabase answer, finish their runs and run the build the repo expects
  begin
    perform public._watch_edge_jobs();
  exception when others then
    perform public.notify_commissioners(null, ''flag'', ''Watchdog: the Supabase job check failed'', left(sqlerrm, 300), ''automations'', null);
  end;

  -- own heartbeat';
        n int;
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then raise exception 'v4.06: watchdog anchor 1'; end if;
  if (length(v_def) - length(replace(v_def, a4, ''))) / length(a4) <> 1 then raise exception 'v4.06: watchdog anchor 4'; end if;
  n := (length(v_def) - length(replace(v_def, a5, ''))) / length(a5);
  if n <> 2 then raise exception 'v4.06: watchdog anchor 5 matched % times, expected 2', n; end if;
  if (length(v_def) - length(replace(v_def, a8, ''))) / length(a8) <> 1 then raise exception 'v4.06: watchdog anchor 8'; end if;
  execute replace(replace(replace(replace(v_def, a1, b1), a4, b4), a5, b5), a8, b8);
end $p$;

-- 7. checks --------------------------------------------------------------------------------------------------------
do $chk$
begin
  if (select count(*) from public.job_hosts where host = 'netlify') <> 5 then raise exception 'v4.06: expected five jobs on Netlify'; end if;
  if not exists (select 1 from vault.secrets where name = 'edge_cron_key') then raise exception 'v4.06: no cron key'; end if;
  if exists (select 1 from information_schema.routine_privileges
              where grantee in ('anon', 'authenticated', 'PUBLIC') and routine_schema = 'public'
                and routine_name in ('job_lease', 'job_release', 'invoke_edge_job', '_watch_edge_jobs', '_wd_alert',
                                     '_job_hosts_host_at', 'live_site_build_check')) then
    raise exception 'v4.06: an internal function is executable by members';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where grantee in ('anon', 'PUBLIC') and routine_schema = 'public' and routine_name = 'request_discord_sync') then
    raise exception 'v4.06: request_discord_sync is open to signed-out callers';
  end if;
  if has_table_privilege('anon', 'public.job_hosts', 'SELECT') or has_table_privilege('authenticated', 'public.job_hosts', 'SELECT')
     or has_table_privilege('anon', 'public.edge_job_requests', 'SELECT') then
    raise exception 'v4.06: a job table is readable by members';
  end if;
  if not coalesce((select jsonb_array_length(value::jsonb->'chapters') > 0 and (value::jsonb->'changelog'->0->>'version') is not null
                     from public.app_config where key = 'rules_card'), false) then
    raise exception 'v4.06: rules_card seed';
  end if;
end $chk$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Part A2 (migration v406a2_edge_jobs_review), from a read-only review before anything was deployed:
--  * A worker killed mid-run (Supabase's CPU or time limit, a deploy) never handed its run back and the 420 s lease
--    blocked the job's next ticks with no record; discord-scheduler's two-tick posting windows could be lost. The lease
--    is now 90 s and renewed while the job works (job_renew); a grant over an unreturned run records it as lost and the
--    watchdog pages; the wrapper also hands runs back as failed when the platform announces a shutdown.
--  * Switching a job to Supabase is refused unless Netlify has run it through the host gate in the last 15 minutes (so
--    the gated stand-in is live and the job cannot end up on both hosts) and the Supabase function has answered with
--    every secret set (edge_ready). set_config('app.job_host_force', 'on', true) overrides, for emergencies only.
--  * Section 8 paged on any single bad answer, with one marker for all five jobs: it now pages per job, only when its
--    last four answers all failed over at least eight minutes. It no longer blames Supabase for a failure Netlify had
--    before the switch (last_host), and no longer pages twice when the job's own result row already reports the
--    failure (section 2). Section 1 leaves jobs on Supabase to section 8.
--  * The drift clock restarts whenever either build changes, and its message covers both directions.
--  * Section 4 gives newly scheduled edge-* triggers a quarter hour before calling them "never run".

alter table public.job_hosts
  add column if not exists last_host    text,
  add column if not exists edge_ready   boolean,
  add column if not exists lost_count   int not null default 0,
  add column if not exists last_lost_at timestamptz,
  add column if not exists lost_host    text,
  add column if not exists drift_pair   text;

create or replace function public._job_hosts_host_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.host is distinct from old.host then
    if old.host = 'netlify' and new.host = 'edge' and coalesce(current_setting('app.job_host_force', true), '') <> 'on' then
      if not (old.run_host = 'netlify' and old.run_ended > now() - interval '15 minutes') then
        raise exception 'Not moving %: Netlify has not run it through the host gate in the last 15 minutes, so its gated stand-in may not be live and the job could run on both hosts. Check the Netlify deploy first.', old.fn;
      end if;
      if not (old.edge_seen > now() - interval '15 minutes' and old.edge_ready is true) then
        raise exception 'Not moving %: its Supabase function has not answered with every secret set in the last 15 minutes. Deploy it, add its secrets, and probe it first.', old.fn;
      end if;
    end if;
    new.host_at := now();
    new.drift_since := null;
    new.drift_pair := null;
  end if;
  return new;
end $function$;
revoke execute on function public._job_hosts_host_at() from public, anon, authenticated;

drop function if exists public.job_lease(text, text, text, int, text, boolean);
create or replace function public.job_lease(p_fn text, p_host text, p_build text, p_ttl_s int, p_key text default null,
                                            p_probe boolean default false, p_ready boolean default null)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare v public.job_hosts; v_holder uuid; v_lost boolean;
begin
  if p_host is null or p_host not in ('netlify', 'edge') or p_ttl_s is null or p_ttl_s < 10 or p_ttl_s > 900 then
    return 'denied';
  end if;
  if p_host = 'edge' and (p_key is null or p_key !~ '^[0-9a-f]{64}$'
      or p_key is distinct from (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'edge_cron_key')) then
    return 'denied';
  end if;
  select * into v from public.job_hosts h where h.fn = p_fn for update;
  if not found then return 'denied'; end if;
  if p_host = 'edge' then
    update public.job_hosts set edge_build = left(p_build, 40), edge_seen = now(), edge_ready = coalesce(p_ready, edge_ready)
     where fn = p_fn;
  end if;
  if coalesce(p_probe, false) then return 'ok'; end if;
  if v.host <> p_host then return 'standby'; end if;
  if v.lease_until is not null and v.lease_until > now() then return 'busy'; end if;
  /* a holder still set here is a run that never handed itself back: killed mid-run, or its release failed */
  v_lost := v.holder is not null;
  v_holder := gen_random_uuid();
  update public.job_hosts
     set holder = v_holder, lease_until = now() + make_interval(secs => p_ttl_s),
         run_host = p_host, run_build = left(p_build, 40), run_started = now(),
         lost_count = lost_count + case when v_lost then 1 else 0 end,
         last_lost_at = case when v_lost then now() else last_lost_at end,
         lost_host = case when v_lost then v.run_host else lost_host end
   where fn = p_fn;
  return v_holder::text;
end $function$;

create or replace function public.job_renew(p_fn text, p_holder uuid, p_ttl_s int)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_ttl_s is null or p_ttl_s < 10 or p_ttl_s > 900 then return false; end if;
  update public.job_hosts set lease_until = now() + make_interval(secs => p_ttl_s)
   where fn = p_fn and holder = p_holder;
  return found;
end $function$;

create or replace function public.job_release(p_fn text, p_holder uuid, p_ok boolean, p_error text default null,
                                              p_ms int default null)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.job_hosts
     set holder = null, lease_until = null, run_ended = now(), last_ok = p_ok, last_host = run_host,
         last_error = case when p_ok then null else left(coalesce(p_error, 'no detail'), 300) end, last_ms = p_ms
   where fn = p_fn and holder = p_holder;
  return found;
end $function$;

revoke execute on function public.job_lease(text, text, text, int, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.job_renew(text, uuid, int) from public, anon, authenticated;
revoke execute on function public.job_release(text, uuid, boolean, text, int) from public, anon, authenticated;
grant execute on function public.job_lease(text, text, text, int, text, boolean, boolean) to service_role;
grant execute on function public.job_renew(text, uuid, int) to service_role;
grant execute on function public.job_release(text, uuid, boolean, text, int) to service_role;

create or replace function public._watch_edge_jobs()
returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare v_j record; v_expect jsonb; v_want text; v_ref timestamptz; v_stale interval; v_pair text;
        v_n int; v_bad int; v_codes text; v_oldest timestamptz; v_own boolean;
begin
  begin v_expect := nullif((select value from public.app_config where key = 'edge_expected_builds'), '')::jsonb;
  exception when others then v_expect := null; end;

  for v_j in select * from public.job_hosts order by fn loop
    -- a) this job's last four answers to pg_cron all failed, over at least eight minutes (one bad answer is a blip)
    select count(*), count(*) filter (where t.bad), string_agg(distinct t.code, ', ') filter (where t.bad), min(t.created)
      into v_n, v_bad, v_codes, v_oldest
      from (select x.created, coalesce(x.status_code::text, 'no answer') as code,
                   (x.status_code is null or x.status_code not in (200, 202) or coalesce(x.error_msg, '') <> '') as bad
              from public.edge_job_requests r join net._http_response x on x.id = r.id
             where r.fn = v_j.fn and x.created > now() - interval '40 minutes'
             order by x.created desc limit 4) t;
    if v_n = 4 and v_bad = 4 and v_oldest < now() - interval '8 minutes' then
      perform public._wd_alert('wd_edge_http_' || v_j.fn, 'A scheduled job on Supabase is not answering: ' || v_j.fn,
        v_j.fn || ' answered ' || coalesce(v_codes, '?') || ' to its last four calls. '
        || case when v_j.host = 'edge' then 'It is not running. ' else 'It still runs on Netlify, so nothing is missed yet. ' end
        || 'Open the Supabase dashboard, Edge Functions, ' || v_j.fn || ', Logs.');
    end if;

    if v_j.host = 'edge' then
      -- b) no run has finished on Supabase for a while
      v_stale := greatest(interval '30 minutes', make_interval(mins => 6 * v_j.every_min));
      v_ref := greatest(v_j.host_at, case when v_j.last_host = 'edge' then v_j.run_ended end);
      if v_ref < now() - v_stale then
        perform public._wd_alert('wd_edge_stale_' || v_j.fn, 'Automation down: ' || v_j.fn,
          v_j.fn || ' has not finished a run on Supabase since '
          || to_char(v_ref at time zone 'America/New_York', 'Mon DD HH12:MI AM') || ' ET. Open the Supabase dashboard, '
          || 'Edge Functions, ' || v_j.fn || ', Logs. To put it back on Netlify meanwhile: update public.job_hosts set host = '
          || '''netlify'' where fn = ''' || v_j.fn || '''.');
      -- c) the last run on Supabase crashed, answered 5xx, had a secret missing or was stopped mid-run, and the job's own
      --    result row does not already say so (section 2 pages on that one)
      elsif v_j.last_host = 'edge' and v_j.last_ok is false then
        begin
          select (value::jsonb ->> 'ok') = 'false' and (value::jsonb ->> 'at')::timestamptz >= v_j.run_started into v_own
            from public.app_config where key = 'rl_' || v_j.fn || '_result';
        exception when others then v_own := false; end;
        if not coalesce(v_own, false) then
          perform public._wd_alert('wd_edge_fail_' || v_j.fn, 'Automation failing: ' || v_j.fn,
            v_j.fn || ' failed on Supabase: ' || coalesce(v_j.last_error, 'no detail') || '.');
        end if;
      end if;
      -- d) a run on Supabase never handed itself back (the worker died without even the shutdown notice)
      if v_j.lost_host = 'edge' and v_j.last_lost_at > now() - interval '1 hour' then
        perform public._wd_alert('wd_edge_lost_' || v_j.fn, 'Automation interrupted: ' || v_j.fn,
          'A run of ' || v_j.fn || ' on Supabase never finished (' || v_j.lost_count || ' so far); the worker was most likely '
          || 'stopped at its CPU or time limit. Open the Supabase dashboard, Edge Functions, ' || v_j.fn || ', Logs.');
      end if;
    end if;

    -- e) the deployed build has differed from the one the site expects, unchanged, for 30 minutes. Either side moving
    --    restarts the clock, so a deploy that is simply catching up never pages.
    v_want := v_expect ->> v_j.fn;
    if v_want is not null and v_j.edge_seen > now() - interval '1 hour' then
      if v_j.edge_build is distinct from v_want then
        v_pair := coalesce(v_j.edge_build, '?') || '|' || v_want;
        if v_j.drift_since is null or v_j.drift_pair is distinct from v_pair then
          update public.job_hosts set drift_since = now(), drift_pair = v_pair where fn = v_j.fn;
        elsif v_j.drift_since < now() - interval '30 minutes' then
          perform public._wd_alert('wd_edge_drift_' || v_j.fn, 'Supabase job out of date: ' || v_j.fn,
            v_j.fn || ' on Supabase is running build ' || coalesce(v_j.edge_build, '?') || ' but the site expects ' || v_want
            || '. Either the Supabase deploy did not finish (run "Deploy Supabase Edge jobs" again on GitHub, Actions) or the '
            || 'site build for that commit did not publish (check the Netlify deploy).');
        end if;
      elsif v_j.drift_since is not null then
        update public.job_hosts set drift_since = null, drift_pair = null where fn = v_j.fn;
      end if;
    end if;
  end loop;
end $function$;
revoke execute on function public._watch_edge_jobs() from public, anon, authenticated;

do $p$
declare v_def text := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
        -- section 1: a job on Supabase is section 8's (it knows whether runs finish); undo the v4.06 text branch
        a1 text := '                      when exists (select 1 from public.job_hosts h where h.fn = v_hb.fn and h.host = ''edge'')
                      then ''It runs on Supabase: open the Supabase dashboard, Edge Functions, '' || v_hb.fn || '', Logs.''
                      else ''Check the Netlify function.'' end;';
        b1 text := '                      else ''Check the Netlify function.'' end;';
        a1b text := '    select nullif(value,'''')::timestamptz into v_last from public.app_config where key = ''rl_''||v_hb.fn;';
        b1b text := '    -- v4.06: a job running on Supabase is watched by section 8, which knows whether its runs finish
    continue when exists (select 1 from public.job_hosts h where h.fn = v_hb.fn and h.host = ''edge'');
    select nullif(value,'''')::timestamptz into v_last from public.app_config where key = ''rl_''||v_hb.fn;';
        -- section 4: a newly scheduled Edge trigger has no run yet
        a4 text := '      where j.jobname = v_stale.jobname and j.active;';
        b4 text := '      where j.jobname = v_stale.jobname and j.active;
    -- v4.06: an edge-* trigger scheduled minutes ago has not had its first run; give it a quarter hour
    continue when v_last is null and v_stale.jobname like ''edge-%''
      and nullif((select value from public.app_config where key = ''edge_cron_scheduled_at''), '''')::timestamptz > now() - interval ''15 minutes'';';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then raise exception 'v4.06a2: watchdog anchor 1'; end if;
  if (length(v_def) - length(replace(v_def, a1b, ''))) / length(a1b) <> 1 then raise exception 'v4.06a2: watchdog anchor 1b'; end if;
  if (length(v_def) - length(replace(v_def, a4, ''))) / length(a4) <> 1 then raise exception 'v4.06a2: watchdog anchor 4'; end if;
  execute replace(replace(replace(v_def, a1, b1), a1b, b1b), a4, b4);
end $p$;

do $chk$
begin
  if exists (select 1 from information_schema.routine_privileges
              where grantee in ('anon', 'authenticated', 'PUBLIC') and routine_schema = 'public'
                and routine_name in ('job_lease', 'job_renew', 'job_release', '_watch_edge_jobs', '_job_hosts_host_at')) then
    raise exception 'v4.06a2: an internal function is executable by members';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'job_lease') <> 1 then
    raise exception 'v4.06a2: expected exactly one job_lease';
  end if;
end $chk$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Part B (migration v406b_edge_jobs_cron), after the first deploy: the five triggers. Each tick costs one Edge
-- invocation (about 83,000 a month against the 2 million the Pro plan includes); a job still on Netlify answers standby.
-- select cron.unschedule(jobid) from cron.job where jobname like 'edge-%';
-- insert into public.app_config (key, value) values ('edge_cron_scheduled_at', now()::text)
--   on conflict (key) do update set value = excluded.value;
-- select cron.schedule('edge-discord-sync',      '*/2 * * * *', $$select public.invoke_edge_job('discord-sync')$$);
-- select cron.schedule('edge-twitch-live-sync',  '*/2 * * * *', $$select public.invoke_edge_job('twitch-live-sync')$$);
-- select cron.schedule('edge-lfg-timers',        '*/2 * * * *', $$select public.invoke_edge_job('lfg-timers')$$);
-- select cron.schedule('edge-discord-scheduler', '*/5 * * * *', $$select public.invoke_edge_job('discord-scheduler')$$);
-- select cron.schedule('edge-discord-welcome',   '*/5 * * * *', $$select public.invoke_edge_job('discord-welcome')$$);
