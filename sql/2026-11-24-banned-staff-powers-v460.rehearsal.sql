-- Rehearsal for sql/2026-11-24-banned-staff-powers-v460.sql. The main session runs it on production as ONE transaction
-- that ends in an uncaught raise, so everything rolls back (pg_net is transactional: the staff vote notice never
-- leaves). It carries the record byte for byte between the PRE and POST blocks (tools/banned-staff-powers-v460.test.cjs).
-- People, picked inside the transaction by id order (no ids in this file): B the first banned member with the staff role;
-- S the first staff member who is not banned and not suspended from staff duties; K the first commissioner.
-- Cases:
--   T0 before the record, B passes is_staff() and reads every case (the hole).
--   T1 after it, B fails is_staff() and reads only the cases B filed (ar_read lets a member read their own); S still
--      passes and reads what S read before.
--   T2 notify_staff_bell rings every staff member who is not banned, and not B.
--   T3 K opens a whole-office staff vote: its eligibleCount on the board counts the office minus banned and Media
--      members, B gets no "New staff vote" bell, and S does.

begin;

do $pre$
declare b uuid; s uuid; k uuid; n_all integer; n_b integer; n_s integer; ok boolean;
begin
  select id into b from public.profiles where role = 'staff' and banned order by id limit 1;
  select id into s from public.profiles where role = 'staff' and not banned and not public.is_staff_suspended(id) order by id limit 1;
  select id into k from public.profiles where role = 'commissioner' order by id limit 1;
  if b is null or s is null or k is null then raise exception 'rehearsal: B, S or K not found'; end if;
  perform set_config('rh.b', b::text, true); perform set_config('rh.s', s::text, true); perform set_config('rh.k', k::text, true);
  select count(*) into n_all from public.action_requests;
  perform set_config('rh.n_all', n_all::text, true);
  perform set_config('rh.n_own', (select count(*) from public.action_requests where profile_id = b)::text, true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  ok := public.is_staff(); select count(*) into n_b from public.action_requests;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  select count(*) into n_s from public.action_requests;
  execute 'reset role';
  if not ok then raise exception 'T0: B does not pass is_staff() before the record (nothing to fix?)'; end if;
  if n_b <> n_all then raise exception 'T0: B reads % of % cases before the record', n_b, n_all; end if;
  perform set_config('rh.n_s', n_s::text, true);
  perform set_config('rh.t0', format('T0 (B is staff, reads %s of %s cases)', n_b, n_all), true);
end $pre$;

-- v4.60 (2026-11-24): a banned member holds no staff powers. Security fix.
--
-- Found 2026-11-24 by the agent fixing the Season 2 staffing flip drafts: ban_player() sets profiles.banned and keeps
-- profiles.role (so an unban restores the member as they were), but is_staff() reads only the role and a staff
-- suspension. A staffer banned since 2026-10-05 therefore still passed is_staff(), the gate behind 39 row policies: they
-- could read and update cases (ar_read, ar_update), read staff and owner applications, and cast staff ballots, and
-- nothing stops a banned member signing in (they must, to appeal under Rule 7.6). The same staffer still received every
-- staff bell (notify_staff_bell) and was counted among the eligible voters of every staff vote, which raised the
-- "more than half" bar by one.
--
-- The department gates (has_department, _is_stats_staff, is_media_staff, is_media_only_staff, the department reviewers)
-- already refuse that member, who holds no department; the Season 2 flip records read the ban in their own versions
-- (has_department, notify_department, the nomination bell, is_staff_voter). This record closes what is live today:
--   1. is_staff(): "and not banned". One line, so every policy and RPC that calls it follows. search_path becomes ''
--      (house rule for SECURITY DEFINER); CREATE OR REPLACE keeps its grants (anon EXECUTE stays: policies call it).
--   2. notify_staff_bell(): skips banned members (a bell names the member and the case it is about).
--   3. staff_vote_board() eligibleCount and staff_vote_create() (the eligible count in its notice, and its bell loop):
--      "and not p.banned", by exact anchor (each count asserted).
-- Not changed, on purpose: the role conflict checks (a banned staffer is still staff for Rule 2.7, so they cannot hold a
-- club seat while the role stands) and staff_directory (a listing, not a power).
-- -- shortcut: is_commissioner() still ignores the ban (85 policies; no commissioner is banned on 2026-11-24, and
--    ban_player does not refuse one), revisit if a commissioner is ever banned or the commissioner seat gets a ban path.
--
-- Rulebook: Rule 7.2 paragraph 1 gains "An expelled member of league staff holds no desk or staff power while the
-- expulsion stands, receives no staff notices, and is not counted among the voters of any staff vote."

-- 1. is_staff
create or replace function public.is_staff()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  /* v4.60: a banned member holds no staff powers (Rule 7.2). ban_player keeps the role so an unban restores it, so the
     gate reads the ban; before this a staffer banned since 2026-10-05 still passed every staff policy. */
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff' and not banned)
     and not public.is_staff_suspended(auth.uid());
$function$;

-- 2. notify_staff_bell
create or replace function public.notify_staff_bell(p_exclude uuid[], p_type text, p_title text, p_body text,
  p_view text default null::text, p_param text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare s uuid;
begin
  /* v4.60: no staff bell reaches a banned member (Rule 7.2). */
  for s in select id from public.profiles where role = 'staff' and not banned
             and (p_exclude is null or id <> all(p_exclude)) loop
    perform public.create_notification(s, p_type, p_title, p_body, p_view, p_param);
  end loop;
end;$function$;

-- 3. the staff vote electorate
do $vote$
declare
  a constant text := $a$p.role in ('staff','commissioner')$a$;
  b constant text := $b$p.role in ('staff','commissioner') and not p.banned$b$;
  d text; n integer;
begin
  d := pg_get_functiondef('public.staff_vote_board()'::regprocedure);
  if position(b in d) > 0 then raise exception 'v4.60: staff_vote_board already reads the ban'; end if;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.60: staff_vote_board anchor matched % times, expected 1', n; end if;
  execute replace(d, a, b);

  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'staff_vote_create';
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = 'staff_vote_create') <> 1 then
    raise exception 'v4.60: expected exactly one staff_vote_create';
  end if;
  if position(b in d) > 0 then raise exception 'v4.60: staff_vote_create already reads the ban'; end if;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 2 then raise exception 'v4.60: staff_vote_create anchor matched % times, expected 2', n; end if;
  execute replace(d, a, b);
end $vote$;

-- Self-checks
do $chk$
declare d text;
begin
  d := pg_get_functiondef('public.is_staff()'::regprocedure);
  if position('and not banned' in d) = 0 or position('is_staff_suspended(auth.uid())' in d) = 0 then
    raise exception 'v4.60 check: is_staff does not read the ban and the staff suspension';
  end if;
  if not has_function_privilege('anon', 'public.is_staff()', 'execute')
     or not has_function_privilege('authenticated', 'public.is_staff()', 'execute') then
    raise exception 'v4.60 check: is_staff lost its EXECUTE grants (policies call it)';
  end if;
  if position('not banned' in pg_get_functiondef('public.notify_staff_bell(uuid[],text,text,text,text,text)'::regprocedure)) = 0 then
    raise exception 'v4.60 check: notify_staff_bell does not skip banned members';
  end if;
  d := pg_get_functiondef('public.staff_vote_board()'::regprocedure);
  if (length(d) - length(replace(d, 'and not p.banned', ''))) / length('and not p.banned') <> 1 then
    raise exception 'v4.60 check: staff_vote_board eligibleCount does not read the ban once';
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'staff_vote_create';
  if (length(d) - length(replace(d, 'and not p.banned', ''))) / length('and not p.banned') <> 2 then
    raise exception 'v4.60 check: staff_vote_create does not read the ban in its count and its bell loop';
  end if;
end $chk$;

do $post$
declare
  b uuid := current_setting('rh.b')::uuid; s uuid := current_setting('rh.s')::uuid; k uuid := current_setting('rh.k')::uuid;
  n_all integer := current_setting('rh.n_all')::integer; n_own integer := current_setting('rh.n_own')::integer;
  n_s0 integer := current_setting('rh.n_s')::integer;
  n_b integer; n_s integer; ok_b boolean; ok_s boolean; n_rung integer; n_want integer; vid uuid; board jsonb;
  elig integer; want_elig integer; bell_b integer; bell_s integer;
begin
  -- T1
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  ok_b := public.is_staff(); select count(*) into n_b from public.action_requests;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  ok_s := public.is_staff(); select count(*) into n_s from public.action_requests;
  execute 'reset role';
  if ok_b then raise exception 'T1: B still passes is_staff()'; end if;
  if n_b <> n_own then raise exception 'T1: B reads % cases, expected only the % B filed', n_b, n_own; end if;
  if not ok_s or n_s <> n_s0 then raise exception 'T1: S lost staff (is_staff %, reads % of the % before)', ok_s, n_s, n_s0; end if;

  -- T2
  perform public.notify_staff_bell(null, 'system', 'Rehearsal v4.60 bell', 'Rehearsal.', null, null);
  select count(*) into n_rung from public.notifications where title = 'Rehearsal v4.60 bell';
  select count(*) into n_want from public.profiles where role = 'staff' and not banned;
  if exists (select 1 from public.notifications where title = 'Rehearsal v4.60 bell' and profile_id = b) then
    raise exception 'T2: B was rung';
  end if;
  if n_rung <> n_want then raise exception 'T2: % staff bells, expected %', n_rung, n_want; end if;

  -- T3
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', k, 'role', 'authenticated')::text, true);
  vid := public.staff_vote_create('Rehearsal v4.60 vote', null, array['Yes','No'], null, null);
  board := public.staff_vote_board();
  execute 'reset role';
  select (x->>'eligibleCount')::integer into elig
    from jsonb_path_query(board, '$.** ? (@.type() == "object" && exists(@.eligibleCount))') x
   where x->>'id' = vid::text;
  select count(*) into want_elig from public.profiles p
   where p.role in ('staff','commissioner') and not p.banned and not public.is_media_staff(p.id);
  if elig is null then raise exception 'T3: the new vote is not on the board'; end if;
  if elig <> want_elig then raise exception 'T3: eligibleCount %, expected %', elig, want_elig; end if;
  select count(*) filter (where profile_id = b), count(*) filter (where profile_id = s) into bell_b, bell_s
    from public.notifications where title = 'New staff vote' and body like '%Rehearsal v4.60 vote%';
  if bell_b <> 0 then raise exception 'T3: B got the vote bell'; end if;
  if bell_s <> 1 and not public.is_media_staff(s) then raise exception 'T3: S got % vote bells, expected 1', bell_s; end if;

  raise exception 'REHEARSAL OK: % T1 (B reads % own) T2 (% bells) T3 (% eligible)', current_setting('rh.t0'), n_own, n_rung, elig;
end $post$;
