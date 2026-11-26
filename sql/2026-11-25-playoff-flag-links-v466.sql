-- v466 (2026-11-25, drafted by the core health fixer of the Season 2 swap; the main session numbers, rehearses and
-- applies it): a playoff flag's link opens the game it is about.
--
-- Why. public.check_playoff_violations (the trg_playoff_violations trigger on public.games) sends the commissioners up
-- to three flags when a playoff final breaks a limit: the series cap, the first four games of a series and playoff
-- eligibility (Rule 8.3). Each ends "Review the game." but names the view 'transactions' with no parameter, so the bell
-- opened the classic site's home page and now opens the league's trades list (src/s2/js/core.js S2.notifRoute,
-- transactions; health links 4, 2026-11-25). Neither is the game. The game's id (new.id) went only to log_admin_action.
-- No such notice exists yet (read-only SELECT, 2026-11-25); Season 2's playoffs from Feb 10 will write them.
--
-- What changes. The three calls name view 'game' with the game's id, which both sites open as that game: the new site
-- through S2.notifRoute ('game' -> #/matchup/<id> -> #/game/<id>), the classic site through CG.notifRoute's matchup.
-- Patched by exact anchor: the string `'transactions', null)` must occur exactly three times in the function (asserted;
-- read-only SELECT on 2026-11-25 found three), and nothing else in the body changes (proved below). The 'transactions'
-- view itself is untouched: accept_trade and reverse_trade keep it, and it still opens the trades list. The fourth
-- call ("The playoff violation check failed", view 'admin') is left as it is.
-- CREATE OR REPLACE (pg_get_functiondef's own text) keeps the signature, SECURITY DEFINER, the function's search_path
-- setting (public, as live; not changed here) and its grants.
--
-- Requires: check_playoff_violations() and notify_commissioners(uuid[],text,text,text,text,text) as live on
-- 2026-11-25 (md5 of pg_get_functiondef(check_playoff_violations) d64e56625186953d128506d7380941ae).
-- Rehearsal: sql/2026-11-25-playoff-flag-links-v466.rehearsal.sql (main session). Test: tools/playoff-flag-links-v466.test.cjs.
-- Posts nothing and writes no row.
-- Rehearsed on production 2026-11-25 by the main session (R1 to R3 OK, rolled back; the function's md5 unchanged after);
-- applied as migration v466_playoff_flag_links the same day at the commissioner's yes; tools/sql/grant-audit.sql returned zero rows.

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
