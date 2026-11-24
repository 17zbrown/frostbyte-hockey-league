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

-- Rehearsal (2026-11-24): sql/2026-11-24-banned-staff-powers-v460.rehearsal.sql, one transaction on the live database,
-- rolled back by a closing raise. T0: before the record the banned staffer passes is_staff() and reads all 19 cases.
-- T1: after it they fail is_staff() and read only the 1 case they filed; the other staffer reads what they read before.
-- T2: notify_staff_bell rings the 8 staff who are not banned, not the banned one. T3: a commissioner's whole-office vote
-- shows 9 eligible voters (staff and commissioners, minus banned and Media), and the banned staffer gets no vote bell.
-- Result: REHEARSAL OK: T0 (B is staff, reads 19 of 19 cases) T1 (B reads 1 own) T2 (8 bells) T3 (9 eligible)
-- Applied as migration v460_banned_staff_powers on 2026-11-24, at the commissioner's go-ahead; tools/sql/grant-audit.sql returned
-- zero rows.
