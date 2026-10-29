-- v4.34 (2026-10-29): the site's EA club search and match lookups run through the bot's server.
-- Commissioner, 2026-10-29: "Also this box in the staff desk never works. Can you make sure you check regularly that it
-- works and functions so I can use it so I dont need to ask you each time?" (the Stats Manager's "Add an EA game").
-- Asked how it should reach EA, the commissioner chose "Through the bot's server": a deliberate, narrow exception to the
-- rule that no new work goes on the Oracle VM.
--
-- Why: proclubs.ea.com sits behind Akamai, which answers 403 "Access Denied" to Netlify's egress (since the paid
-- residential proxy lapsed on 2026-09-05) and to Supabase's (a pg_net probe, 2026-10-29), and a browser on
-- chelgamingleague.com is refused by CORS. Only the VM reaches EA, which is why box scores already import from it
-- (bot/ea-poll.mjs). Three site boxes asked EA from Netlify and had been dead since September: the Stats Manager's
-- "Add an EA game" and the #/pickup-import page (netlify/functions/pickup-import.js), and the club game stats desk's
-- EA club search and fetch (netlify/functions/ingest-stats.js leagueEaSearch / leagueEaFetch).
--
-- The shape (one request table, the bot as the only EA client):
--   1. A Netlify action that needs EA (after its own sign-in and club checks, unchanged) reads the newest answered
--      lookup for that question (shared/ea-relay.cjs). With none fresh enough it files a request row here with the
--      service role and answers the browser { eaPending: id }.
--   2. The bot's EA lane (bot/ea-lookup.mjs, in the chel-ea-poll process) hears the INSERT through Realtime, asks EA
--      with the poller's own browser headers, and writes EA's raw answer (or the reason it failed) onto the row.
--   3. The browser polls public.ea_lookup_state(id) about once a second, then calls the same action again, which now
--      finds the answer. No payload ever comes from the browser: imports read the raw match the bot stored.
-- Health: every 10 minutes the lane files its own self-test search and times it end to end (Realtime delivery, EA, the
-- write-back). It stamps rl_ea-lookup (the time) and rl_ea-lookup_result ({ok, lastError, latencyMs, ...}), the shape
-- the Automations panel and automation_watchdog already read: section 2 alerts on an ok:false result, and section 1
-- (one line added below) alerts when the lane goes silent for 30 minutes. public.ea_lookup_health() is the boxes'
-- status line, read from the same two keys, so the box, the panel and the alert cannot disagree.
--
-- This table:  RLS on with no policies, every privilege revoked from public, anon and authenticated: only the service
-- role (Netlify, the bot) reads or writes it, as with role_sync_queue. It joins supabase_realtime (the bot's INSERT
-- channel). Rows older than a day are deleted by the bot every hour.
-- REHEARSAL and the applied line: at the end of this file.

-- 1. the requests
create table public.ea_lookups (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('search', 'matches')),
  arg          text not null check (char_length(arg) between 1 and 40),
  source       text not null default 'site' check (source in ('site', 'selftest')),
  requested_by uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  ok           boolean,
  error        text,
  raw          jsonb,
  constraint ea_lookups_answer_whole check ((answered_at is null) = (ok is null))
);
create index ea_lookups_question on public.ea_lookups (kind, arg, id desc);
alter table public.ea_lookups enable row level security;
revoke all on table public.ea_lookups from public, anon, authenticated;
revoke all on sequence public.ea_lookups_id_seq from public, anon, authenticated;
do $pub$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ea_lookups') then
    alter publication supabase_realtime add table public.ea_lookups;
  end if;
end $pub$;

-- 2. every request is born unanswered and well formed, and the site cannot flood EA through it
create or replace function public.guard_ea_lookup()
 returns trigger language plpgsql set search_path to ''
as $function$
begin
  /* v4.34: the bot's server shares one address with the box-score poller, and a burst that draws an Akamai 403 stops
     box-score imports for five minutes; so the site's requests are capped here, whoever files them (Netlify files them
     with the service role, which passes RLS but not this trigger). The self-test is the bot's own and is not capped. */
  new.arg := btrim(coalesce(new.arg, ''));
  new.answered_at := null; new.ok := null; new.error := null; new.raw := null;
  if new.kind = 'search' and char_length(new.arg) < 2 then
    raise exception 'EA lookups: enter at least 2 characters of the club name.' using errcode = 'check_violation';
  end if;
  if new.kind = 'matches' and new.arg !~ '^[0-9]{1,20}$' then
    raise exception 'EA lookups: that is not an EA club id.' using errcode = 'check_violation';
  end if;
  if new.source = 'site' then
    if new.requested_by is not null and (select count(*) from public.ea_lookups l
          where l.requested_by = new.requested_by and l.created_at > now() - interval '10 minutes') >= 20 then
      raise exception 'EA lookups: that is 20 in ten minutes. Wait a few minutes and try again.' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.ea_lookups l where l.source = 'site' and l.created_at > now() - interval '1 minute') >= 12 then
      raise exception 'EA lookups: the bot server is busy. Try again in a minute.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $function$;
revoke all on function public.guard_ea_lookup() from public, anon, authenticated;
create trigger guard_ea_lookup_trg before insert on public.ea_lookups for each row execute function public.guard_ea_lookup();

-- 3. what the browser may read: one request's progress, and the lane's health
create or replace function public.ea_lookup_state(p_id bigint)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  /* v4.34: progress only (pending, ok, the failure in plain words), never EA's answer; signed-in members only */
  select case when auth.uid() is null then null else
    (select jsonb_build_object('pending', l.answered_at is null, 'ok', l.ok, 'error', l.error)
       from public.ea_lookups l where l.id = p_id) end;
$function$;
revoke all on function public.ea_lookup_state(bigint) from public, anon, authenticated;
grant execute on function public.ea_lookup_state(bigint) to authenticated;

create or replace function public.ea_lookup_health()
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_hb timestamptz; v_res jsonb;
begin
  /* v4.34: the boxes' status line, read from the lane's own self-test ledgers (rl_ea-lookup, rl_ea-lookup_result),
     the same keys automation_watchdog alerts on: silent after 30 minutes without a self-test, else the last result */
  if auth.uid() is null then return null; end if;
  begin v_hb := nullif((select c.value from public.app_config c where c.key = 'rl_ea-lookup'), '')::timestamptz;
  exception when others then v_hb := null; end;
  begin v_res := (select c.value from public.app_config c where c.key = 'rl_ea-lookup_result')::jsonb;
  exception when others then v_res := null; end;
  return jsonb_build_object(
    'state', case when v_hb is null or now() - v_hb > interval '30 minutes' then 'silent'
                  when coalesce((v_res->>'ok')::boolean, false) then 'working' else 'failing' end,
    'at', v_hb, 'error', v_res->>'lastError', 'latencyMs', v_res->'latencyMs');
end $function$;
revoke all on function public.ea_lookup_health() from public, anon, authenticated;
grant execute on function public.ea_lookup_health() to authenticated;

-- 4. the watchdog: the lane's heartbeat joins section 1 (a failing self-test is already section 2's)
do $wd$
declare v_def text; n int; i int; anchors text[]; repl text[];
begin
  v_def := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
  anchors := array[
    $a$      ('gateway-bot', interval '10 minutes')
    ) t(fn, max_age)$a$,
    $a$                      then 'Check the Oracle VM: ssh in and run systemctl status chel-bot. The sweeps are covering in the meantime.'
                      else 'Check the Netlify function.' end;$a$];
  repl := array[
    $a$      ('gateway-bot', interval '10 minutes'),
      ('ea-lookup', interval '30 minutes')   -- v4.34: the site's EA lookups, self-tested by the VM every 10 minutes
    ) t(fn, max_age)$a$,
    $a$                      then 'Check the Oracle VM: ssh in and run systemctl status chel-bot. The sweeps are covering in the meantime.'
                      when v_hb.fn = 'ea-lookup'
                      then 'Check the Oracle VM: ssh in and run systemctl status chel-ea-poll. The site''s EA club search is down until it runs.'
                      else 'Check the Netlify function.' end;$a$];
  for i in 1 .. array_length(anchors, 1) loop
    n := (length(v_def) - length(replace(v_def, anchors[i], ''))) / length(anchors[i]);
    if n <> 1 then raise exception 'v4.34: automation_watchdog anchor % found % times', i, n; end if;
    v_def := replace(v_def, anchors[i], repl[i]);
  end loop;
  execute v_def;
end $wd$;

-- 5. self-checks
do $chk$
declare v_def text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.ea_lookups'::regclass) then raise exception 'v4.34 check: RLS is off'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ea_lookups') then raise exception 'v4.34 check: a policy exists'; end if;
  if has_table_privilege('anon', 'public.ea_lookups', 'SELECT') or has_table_privilege('authenticated', 'public.ea_lookups', 'SELECT')
     or has_table_privilege('anon', 'public.ea_lookups', 'INSERT') or has_table_privilege('authenticated', 'public.ea_lookups', 'INSERT')
     or has_table_privilege('authenticated', 'public.ea_lookups', 'UPDATE') or has_table_privilege('authenticated', 'public.ea_lookups', 'DELETE') then
    raise exception 'v4.34 check: an API role can touch ea_lookups';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ea_lookups') then raise exception 'v4.34 check: not in Realtime'; end if;
  if not has_function_privilege('authenticated', 'public.ea_lookup_state(bigint)', 'EXECUTE') or has_function_privilege('anon', 'public.ea_lookup_state(bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.ea_lookup_health()', 'EXECUTE') or has_function_privilege('anon', 'public.ea_lookup_health()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_ea_lookup()', 'EXECUTE') then
    raise exception 'v4.34 check: a function grant is wrong';
  end if;
  v_def := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
  if position($a$('ea-lookup', interval '30 minutes')$a$ in v_def) = 0 or position('systemctl status chel-ea-poll' in v_def) = 0 then
    raise exception 'v4.34 check: the watchdog does not watch the lane';
  end if;
end $chk$;

/* REHEARSAL, 2026-10-29: one transaction on the live database (sections 1 to 5, then a probe), rolled back by the
   probe's closing raise. P1 a request is born unanswered and trimmed, whatever the insert claimed (ok, raw). P2 a
   one-character search and P3 a club id that is not digits are refused. P4 a member at 20 lookups in ten minutes is
   refused (counting the bot's own rows too). P5 the league-wide cap refuses the 13th site lookup in a minute. P6 the
   self-test is never capped. P7 ea_lookup_state answers nothing to a signed-out caller, "pending" to a member, then the
   failure in plain words once answered. P8 ea_lookup_health reads silent with no heartbeat, working on an ok result,
   failing with the error on an ok:false one, and silent again when the heartbeat is 31 minutes old. P9 it answers
   nothing to a signed-out caller.
   Result: REHEARSAL OK: P1 P2 P3 P4 P5 P6 P7 P8 P9
   Afterward: no ea_lookups table, no ea_lookup_health, the watchdog without the new line: nothing stuck.
   Applied as migration v434_ea_lookup_relay; tools/sql/grant-audit.sql returned zero rows. */
