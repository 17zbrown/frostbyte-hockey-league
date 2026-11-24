-- REHEARSAL for sql/2026-11-24-s2-staff-reads-v457.sql (the main session runs it; it ends in an uncaught raise, so
-- everything rolls back). The record's text sits below verbatim (tools/s2-staff-reads-v4.57.test.cjs checks it byte for
-- byte). It writes nothing outside the record's own DDL.

begin;

-- 1. the record ------------------------------------------------------------------------------------------------------
-- >>> record text: sql/2026-11-24-s2-staff-reads-v457.sql
-- v4.57 (2026-11-24): the Season 2 site's three office reads. Additive: the current site calls none of them.
--   public.s2_desk()         staff and commissioners: the Staff Desk's counts, plus the staff readers it already has.
--   public.s2_control()      commissioners: the Control Center's membership counts.
--   public.ops_job_health()  commissioners: the scheduled jobs' health, which no API role can read today.
-- (briefs/data_layer.md sections 1 and 2.) The league's public facts come from public.s2_league
-- (sql/2026-11-24-s2-read-layer-v4.57.sql); these carry only what the office reads.
--
-- Fail loud, never zeros. Each one's FIRST statement is its gate, raising 42501. A reader that does not gate first shows
-- "0 open cases" to the wrong person: anon reads 0 rows from action_requests and guild_members today, with no error, only
-- because RLS filters them (measured 2026-11-23).
--
-- s2_desk and s2_control are SECURITY INVOKER: past the gate, RLS decides which rows each office member counts, exactly as
-- the current Staff Desk and Control Center read them. So the desk's case and application counts differ by staffer while
-- the department policies stand (a media-only staffer is kept out of cases and applications, and the officiating
-- department reads discipline); s2_desk returns media_only so the page can say "not visible to you" instead of showing a
-- smaller number as the whole. They return COUNTS and the existing staff readers only: never a case's subject, details or
-- response, an audit row's detail, an application's text, or a Discord name. The counts are grouped by the facts the pages
-- filter on, so the page does the arithmetic and the database keeps one reading of each row.
--
-- ops_job_health is SECURITY DEFINER because the cron schema, public.job_hosts and public.app_config are closed to the API
-- roles. It returns names, schedules, statuses, durations and ages: never a cron command, a run's return message, a job's
-- error text, or any app_config value (the table also holds webhooks). Heartbeats are the rl_% keys' updated_at ages.

-- 1. s2_desk ---------------------------------------------------------------------------------------------------------
create or replace function public.s2_desk()
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to ''
as $function$
begin
  if not (public.is_staff() or public.is_commissioner()) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  /* v4.57: counts only, grouped by the facts the desk filters on; RLS decides which rows this staffer counts */
  return (
    select jsonb_build_object(
      'generated', now(),
      'media_only', public.is_media_only_staff(auth.uid()),
      'cases', (select coalesce(jsonb_agg(jsonb_build_object('type', x.type, 'status', x.status, 'route', x.route,
                   'n', x.n, 'assigned', x.assigned, 'oldest', x.oldest, 'updated', x.updated)
                   order by x.type, x.status, x.route), '[]'::jsonb)
                  from (select ar.type, ar.status, ar.route, count(*) n, count(ar.assigned_to) assigned,
                               min(ar.created_at) oldest, max(ar.updated_at) updated
                          from public.action_requests ar group by ar.type, ar.status, ar.route) x),
      'applications', (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'season', x.season, 'role', x.role,
                          'status', x.status, 'n', x.n) order by x.kind, x.season, x.role, x.status), '[]'::jsonb)
                         from (select 'owner'::text kind, s.number season, null::text role, oa.status, count(*) n
                                 from public.owner_applications oa left join public.seasons s on s.id = oa.season_id
                                group by s.number, oa.status
                               union all
                               select 'staff', null, null, sa.status, count(*) from public.staff_applications sa group by sa.status
                               union all
                               select 'management', null, ma.role, ma.status, count(*)
                                 from public.management_applications ma group by ma.role, ma.status) x),
      'ballots', (select coalesce(jsonb_agg(jsonb_build_object('app_type', x.app_type, 'application_id', x.application_id,
                     'approve', x.approve, 'deny', x.deny) order by x.app_type, x.application_id), '[]'::jsonb)
                    from (select b.app_type, b.application_id, count(*) filter (where b.vote = 'approve') approve,
                                 count(*) filter (where b.vote = 'deny') deny
                            from public.application_ballots b group by b.app_type, b.application_id) x),
      'audit', (select coalesce(jsonb_agg(jsonb_build_object('action', x.action, 'n_7d', x.n7, 'n_30d', x.n30, 'last', x.last)
                   order by x.last desc, x.action), '[]'::jsonb)
                  from (select au.action, count(*) filter (where au.created_at > now() - interval '7 days') n7,
                               count(*) filter (where au.created_at > now() - interval '30 days') n30, max(au.created_at) last
                          from public.admin_audit au group by au.action) x),
      'suspensions', (select coalesce(jsonb_agg(jsonb_build_object('status', x.status, 'mode', x.mode, 'scope', x.scope,
                         'n', x.n, 'running', x.running) order by x.status, x.mode, x.scope), '[]'::jsonb)
                        from (select sr.status, sr.mode, sr.scope, count(*) n, count(*) filter (where sr.running) running
                                from public.suspension_record sr group by sr.status, sr.mode, sr.scope) x),
      'ea_import', public.ea_import_issues(),
      'attention', public.staff_needs_attention(),
      'staff', public.staff_directory(),
      'activity', public.staff_activity(20))
  );
end $function$;
revoke all on function public.s2_desk() from public, anon, authenticated;
grant execute on function public.s2_desk() to authenticated;

-- 2. s2_control ------------------------------------------------------------------------------------------------------
create or replace function public.s2_control()
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to ''
as $function$
begin
  if not public.is_commissioner() then
    raise exception 'commissioners only' using errcode = '42501';
  end if;
  /* v4.57: counts only, by league day (America/New_York); never a Discord name or id */
  return (
    select jsonb_build_object(
      'generated', now(),
      'pop', public.member_pop_stats(),
      'accounts_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', x.day, 'n', x.n) order by x.day), '[]'::jsonb)
                            from (select (p.created_at at time zone 'America/New_York')::date as day, count(*) n
                                    from public.profiles p group by 1) x),
      'guild', jsonb_build_object(
        'present', (select count(*) from public.guild_members gm where gm.present and not coalesce(gm.is_bot, false)),
        'linked', (select count(*) from public.guild_members gm where gm.present and not coalesce(gm.is_bot, false)
                                                                 and gm.profile_id is not null),
        'joined_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', x.day, 'n', x.n) order by x.day), '[]'::jsonb)
                            from (select (gm.joined_guild_at at time zone 'America/New_York')::date as day, count(*) n
                                    from public.guild_members gm
                                   where not coalesce(gm.is_bot, false) and gm.joined_guild_at is not null group by 1) x),
        'departures_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', x.day, 'n', x.n, 'registered', x.reg)
                                 order by x.day), '[]'::jsonb)
                                from (select (gd.left_at at time zone 'America/New_York')::date as day, count(*) n,
                                             count(*) filter (where gd.was_registered) reg
                                        from public.guild_departures gd where gd.left_at is not null group by 1) x),
        'departures_by_club', (select coalesce(jsonb_agg(jsonb_build_object('club', x.club, 'n', x.n) order by x.club), '[]'::jsonb)
                                 from (select gd.club, count(*) n from public.guild_departures gd
                                        where gd.club is not null group by gd.club) x),
        'days_in_server', (select jsonb_build_object('n', count(*),
                                    'median', percentile_cont(0.5) within group (order by gd.days_in_server))
                             from public.guild_departures gd where gd.days_in_server is not null)),
      'signups', (select coalesce(jsonb_agg(jsonb_build_object('season', x.season, 'status', x.status, 'position', x.position,
                     'n', x.n) order by x.season, x.status, x.position), '[]'::jsonb)
                    from (select s.number season, r.status, r.position, count(*) n
                            from public.season_registrations r join public.seasons s on s.id = r.season_id
                           group by s.number, r.status, r.position) x),
      'active_by_week', (select coalesce(jsonb_agg(jsonb_build_object('week', x.wk, 'players', x.players, 'games', x.games)
                            order by x.wk), '[]'::jsonb)
                           from (select date_trunc('week', g.scheduled_at at time zone 'America/New_York')::date wk,
                                        count(distinct gs.profile_id) players, count(distinct g.id) games
                                   from public.game_stats gs join public.games g on g.id = gs.game_id
                                  where g.status = 'final' and not coalesce(g.voided, false) and g.scheduled_at is not null
                                  group by 1) x))
  );
end $function$;
revoke all on function public.s2_control() from public, anon, authenticated;
grant execute on function public.s2_control() to authenticated;

-- 3. ops_job_health --------------------------------------------------------------------------------------------------
create or replace function public.ops_job_health()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not public.is_commissioner() then
    raise exception 'commissioners only' using errcode = '42501';
  end if;
  /* v4.57: names, schedules, statuses, durations and ages only: never a command, a return message, an error text or an
     app_config value. The latest run of a job is its highest runid (runids only grow; job_run_details has no jobid index). */
  return (
    select jsonb_build_object(
      'generated', now(),
      'cron', (select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule, 'active', j.active,
                  'last_status', d.status, 'last_started', d.start_time,
                  'last_seconds', round(extract(epoch from d.end_time - d.start_time)::numeric, 3))
                  order by j.jobname), '[]'::jsonb)
                 from cron.job j
                 left join (select x.jobid, max(x.runid) runid from cron.job_run_details x group by x.jobid) l on l.jobid = j.jobid
                 left join cron.job_run_details d on d.runid = l.runid),
      'hosts', (select coalesce(jsonb_agg(jsonb_build_object('fn', h.fn, 'host', h.host, 'every_min', h.every_min,
                   'last_ok', h.last_ok, 'failing', h.last_error is not null, 'last_ms', h.last_ms,
                   'run_started', h.run_started, 'run_ended', h.run_ended, 'edge_ready', h.edge_ready,
                   'edge_seen', h.edge_seen, 'lost_count', h.lost_count, 'last_lost_at', h.last_lost_at)
                   order by h.fn), '[]'::jsonb)
                  from public.job_hosts h),
      'heartbeats', (select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'age_seconds',
                        round(extract(epoch from now() - c.updated_at))) order by c.key), '[]'::jsonb)
                       from public.app_config c where c.key like 'rl\_%'))
  );
end $function$;
revoke all on function public.ops_job_health() from public, anon, authenticated;
grant execute on function public.ops_job_health() to authenticated;

-- 4. self-checks -------------------------------------------------------------------------------------------------------
do $chk$
declare f text; v_src text;
begin
  foreach f in array array['s2_desk', 's2_control', 'ops_job_health'] loop
    if has_function_privilege('anon', ('public.' || f || '()')::regprocedure, 'EXECUTE')
       or not has_function_privilege('authenticated', ('public.' || f || '()')::regprocedure, 'EXECUTE')
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = ('public.' || f || '()')::regprocedure and a.grantee = 0) then
      raise exception '%: authenticated only', f;
    end if;
    if (select proconfig from pg_proc where oid = ('public.' || f || '()')::regprocedure) <> array['search_path=""'] then
      raise exception '%: search_path must be ''''', f;
    end if;
    -- the gate is the first statement
    v_src := (select prosrc from pg_proc where oid = ('public.' || f || '()')::regprocedure);
    if v_src !~ '^\s*begin\s+if not \(?public\.is_(staff|commissioner)\(\)' then
      raise exception '%: the gate is not the first statement', f;
    end if;
    -- a caller who is nobody (no signed-in user, as here) is refused, never shown zeros
    begin
      perform set_config('request.jwt.claims', '', true);
      execute 'select public.' || f || '()';
      raise exception '%: a caller who is nobody was not refused', f;
    exception when insufficient_privilege then null;
    end;
  end loop;
  if (select prosecdef from pg_proc where oid = 'public.s2_desk()'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.s2_control()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.ops_job_health()'::regprocedure) then
    raise exception 's2_desk and s2_control must be SECURITY INVOKER, ops_job_health SECURITY DEFINER';
  end if;
  if (select prosrc from pg_proc where oid = 'public.ops_job_health()'::regprocedure) ~ '\m(j|d)\.(command|return_message|username|database)\M|c\.value|last_error,|h\.last_error\)' then
    raise exception 'ops_job_health reads a command, a message or a value';
  end if;
end $chk$;

-- <<< record text

-- 2. the cases -------------------------------------------------------------------------------------------------------
do $r$
declare
  v_member uuid; v_staff uuid; v_media uuid; v_comm uuid;
  v_who text; f text; b jsonb; t0 timestamptz; v_ms numeric; v_slow numeric := 0; v_out text := '';
  v_staff_cases int; v_media_cases int;
  v_expect jsonb := '{"anon":       {"s2_desk": false, "s2_control": false, "ops_job_health": false},
                      "member":     {"s2_desk": false, "s2_control": false, "ops_job_health": false},
                      "staff":      {"s2_desk": true,  "s2_control": false, "ops_job_health": false},
                      "media":      {"s2_desk": true,  "s2_control": false, "ops_job_health": false},
                      "commissioner": {"s2_desk": true, "s2_control": true, "ops_job_health": true}}';
begin
  select p.id into v_member from public.profiles p where p.role not in ('staff', 'commissioner') and not coalesce(p.banned, false)
     and exists (select 1 from public.roster_spots rs where rs.profile_id = p.id) order by p.created_at limit 1;
  select p.id into v_staff from public.profiles p where p.role = 'staff' and not public.is_media_only_staff(p.id)
     and not public.is_staff_suspended(p.id) order by p.created_at limit 1;
  select p.id into v_media from public.profiles p where p.role = 'staff' and public.is_media_only_staff(p.id)
     and not public.is_staff_suspended(p.id) order by p.created_at limit 1;
  select p.id into v_comm from public.profiles p where p.role = 'commissioner' order by p.created_at limit 1;

  foreach v_who in array array['anon', 'member', 'staff', 'media', 'commissioner'] loop
    perform set_config('role', 'none', true);
    if v_who = 'anon' then
      perform set_config('request.jwt.claims', '', true);
      perform set_config('role', 'anon', true);
    else
      if (case v_who when 'member' then v_member when 'staff' then v_staff when 'media' then v_media else v_comm end) is null then
        v_out := v_out || v_who || ' pending (nobody to sign in as). ';
        continue;
      end if;
      perform set_config('request.jwt.claims', json_build_object('sub',
        case v_who when 'member' then v_member when 'staff' then v_staff when 'media' then v_media else v_comm end,
        'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
    end if;
    foreach f in array array['s2_desk', 's2_control', 'ops_job_health'] loop
      b := null;
      begin
        t0 := clock_timestamp();
        execute 'select public.' || f || '()' into b;
        v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
        v_slow := greatest(v_slow, v_ms);
        if not (v_expect->v_who->>f)::boolean then raise exception '% read % (expected 42501)', v_who, f; end if;
        if v_ms >= 1000 then raise exception '% % took % ms', v_who, f, round(v_ms); end if;
      exception when others then
        if sqlstate <> '42501' or (v_expect->v_who->>f)::boolean then raise; end if;
      end;
      -- what comes back never carries case text, audit detail, commands, messages, values or Discord names
      if b is not null and f <> 's2_desk' and b::text ~ '"(subject|details|response|detail|command|return_message|value|last_error|username|discord_id|display_name)": ' then
        raise exception '% % returned a denied key', v_who, f;
      end if;
      if b is not null and f = 's2_desk' and ((b->'cases')::text ~ '"(subject|details|response)": ' or (b->'audit')::text ~ '"detail": ') then
        raise exception '% s2_desk returned case text or audit detail', v_who;
      end if;
      if b is not null and f = 's2_desk' then
        if (b->>'media_only')::boolean is distinct from (v_who = 'media') then
          raise exception '% s2_desk media_only is %', v_who, b->>'media_only';
        end if;
        if v_who = 'staff' then select coalesce(sum((c->>'n')::int), 0) into v_staff_cases from jsonb_array_elements(b->'cases') c; end if;
        if v_who = 'media' then select coalesce(sum((c->>'n')::int), 0) into v_media_cases from jsonb_array_elements(b->'cases') c; end if;
      end if;
      if b is not null and f = 'ops_job_health' then
        if jsonb_array_length(b->'cron') = 0 or jsonb_array_length(b->'hosts') = 0
           or jsonb_array_length(b->'heartbeats') <> (select count(*) from public.app_config where key like 'rl\_%') then
          raise exception 'ops_job_health is missing jobs, hosts or heartbeats';
        end if;
      end if;
    end loop;
    v_out := v_out || v_who || ': as expected. ';
  end loop;

  perform set_config('role', 'none', true);
  raise exception 'REHEARSAL OK: % Cases a staffer counts: %; a media-only staffer: %. Slowest call % ms.',
    v_out, coalesce(v_staff_cases::text, 'n/a'), coalesce(v_media_cases::text, 'n/a'), round(v_slow);
end $r$;
