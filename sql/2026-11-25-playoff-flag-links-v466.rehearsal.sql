-- Rehearsal for sql/2026-11-25-playoff-flag-links-v466.sql (a playoff flag's link opens its game). The main session runs
-- it on production as ONE execute_sql call: one transaction that ends in an uncaught raise, so everything rolls back
-- (CLAUDE.md, Database change protocol step 2). Agents never run it.
--
-- The record's text is carried below byte for byte between the markers (tools/playoff-flag-links-v466.test.cjs pins it).
-- Naming the version replaces v466 in both files alike. Nothing here fires the trigger, so no notice is written and
-- nothing can leave; the trigger's notices themselves are exercised by the v4.61 rehearsal's T8 world
-- (sql/2026-11-24-s2-playoff-rules-v461.rehearsal.sql), whose flags would carry view game and the game's id after this.
--
-- Cases:
--   R1 before: the live function is the one read on 2026-11-25 (md5 d64e56625186953d128506d7380941ae), with three
--      'transactions', null) calls and no game view.
--   R2 the record runs (its own anchor and self-checks raise on anything else).
--   R3 after: three game views carrying new.id::text, no transactions view, the 'admin' failure notice unchanged, the old
--      body is the new one with the three views put back, and the grants (public, anon, authenticated, service_role)
--      are what they were.
-- REHEARSAL: not run yet (the main session writes the result here).

begin;

create temp table _pfl_before on commit drop as
select pg_get_functiondef('public.check_playoff_violations()'::regprocedure) as def,
       array[has_function_privilege('public', 'public.check_playoff_violations()', 'execute'),
             has_function_privilege('anon', 'public.check_playoff_violations()', 'execute'),
             has_function_privilege('authenticated', 'public.check_playoff_violations()', 'execute'),
             has_function_privilege('service_role', 'public.check_playoff_violations()', 'execute')] as grants;

do $r1$
declare d text := (select def from _pfl_before);
begin
  if md5(d) <> 'd64e56625186953d128506d7380941ae' then
    raise exception 'R1: check_playoff_violations changed since 2026-11-25 (md5 %); read it again before rehearsing', md5(d);
  end if;
  if (length(d) - length(replace(d, '''transactions'', null)', ''))) / length('''transactions'', null)') <> 3
     or position('''game'', new.id::text)' in d) > 0 then
    raise exception 'R1: the live function does not hold exactly three transactions notices and no game view';
  end if;
end
$r1$;

-- >>> record text: sql/2026-11-25-playoff-flag-links-v466.sql, from "do $patch$" to the end
do $patch$
declare
  v_old text := pg_get_functiondef('public.check_playoff_violations()'::regprocedure);
  a text := '''transactions'', null)';
  b text := '''game'', new.id::text)';
  n int;
  v_new text;
begin
  if to_regprocedure('public.notify_commissioners(uuid[],text,text,text,text,text)') is null then
    raise exception 'v466 playoff flag links: notify_commissioners(uuid[],text,text,text,text,text) is missing';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgname = 'trg_playoff_violations' and t.tgrelid = 'public.games'::regclass
                 and t.tgfoid = 'public.check_playoff_violations()'::regprocedure) then
    raise exception 'v466 playoff flag links: check_playoff_violations is no longer the games trigger, so new.id is not a game id; read it before applying';
  end if;
  n := (length(v_old) - length(replace(v_old, a, ''))) / length(a);
  if n <> 3 then raise exception 'v466 playoff flag links: the anchor % matched % times, expected exactly 3', a, n; end if;
  if position(b in v_old) > 0 then raise exception 'v466 playoff flag links: the function already names view game; nothing to do'; end if;
  execute replace(v_old, a, b);
  v_new := pg_get_functiondef('public.check_playoff_violations()'::regprocedure);
  if position(a in v_new) > 0 then raise exception 'v466 playoff flag links: a transactions notice is left'; end if;
  if (length(v_new) - length(replace(v_new, b, ''))) / length(b) <> 3 then
    raise exception 'v466 playoff flag links: the game view is not in the function exactly three times';
  end if;
  if replace(v_new, b, a) <> v_old then raise exception 'v466 playoff flag links: the function differs from its old body by more than the three views'; end if;
end
$patch$;

-- self-checks: still the trigger's definer, its search_path setting kept
do $check$
declare p record;
begin
  select p2.prosecdef, p2.proconfig into p from pg_proc p2 where p2.oid = 'public.check_playoff_violations()'::regprocedure;
  if not p.prosecdef then raise exception 'v466 playoff flag links: check_playoff_violations must stay SECURITY DEFINER'; end if;
  if p.proconfig is distinct from array['search_path=public'] then
    raise exception 'v466 playoff flag links: the search_path setting changed (is %)', p.proconfig;
  end if;
  if position('''transactions''' in pg_get_functiondef('public.check_playoff_violations()'::regprocedure)) > 0 then
    raise exception 'v466 playoff flag links: check_playoff_violations still names the transactions view';
  end if;
end
$check$;
-- <<< record text

do $r3$
declare d text := pg_get_functiondef('public.check_playoff_violations()'::regprocedure); b record;
begin
  select * into b from _pfl_before;
  if (length(d) - length(replace(d, '''game'', new.id::text)', ''))) / length('''game'', new.id::text)') <> 3 then raise exception 'R3: not three game views'; end if;
  if position('Check its box score by hand (Rule 8.3).'', ''admin'', null)' in d) = 0 then raise exception 'R3: the failure notice changed'; end if;
  if replace(d, '''game'', new.id::text)', '''transactions'', null)') <> b.def then raise exception 'R3: more than the three views changed'; end if;
  if array[has_function_privilege('public', 'public.check_playoff_violations()', 'execute'),
           has_function_privilege('anon', 'public.check_playoff_violations()', 'execute'),
           has_function_privilege('authenticated', 'public.check_playoff_violations()', 'execute'),
           has_function_privilege('service_role', 'public.check_playoff_violations()', 'execute')] is distinct from b.grants then
    raise exception 'R3: the grants changed (before %)', b.grants;
  end if;
  raise exception 'REHEARSAL OK (rolled back): R1 to R3 passed; the three playoff flags name view game with the game id';
end
$r3$;
