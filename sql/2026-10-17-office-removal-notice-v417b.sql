-- v4.17b: the league office's "Remove from roster" (admin_remove_from_roster) told the removed player "any club may sign
-- you". Once signings have closed for the season (public.fa_moves_closed, v4.17) that is false: no club may sign them
-- that season except as a replacement signing (Rule 2.4). The notice now says which applies, and the transaction-wire
-- line uses "they" (writing rules). Found by the v4.17 completeness review. The removal itself is unchanged: an office
-- roster removal grants the club no replacement signing (Rule 1.1 covers removed sign-ups only), as before.
-- Nothing here posts to Discord (create_notification is the site bell; the wire line was already written).
--
-- REHEARSAL on production, 2026-10-17: both patches in ONE do-block ending in an uncaught raise, then a commissioner
-- removing a Boston player (pawxs); verified rolled back (function unpatched, Boston still holds 24 spots):
--   notice: "The league office removed you from Bruins. You are a free agent, but signings have closed for the season,
--   so no club may sign you this season except as a replacement signing (Rule 2.4)."
--   wire: "League office removed <b>pawxs</b> from Bruins; they are a free agent (Rule 2.2)"
-- Applied as migration v417b_office_removal_notice.

do $p$
declare
  v_fn constant regprocedure := 'public.admin_remove_from_roster(uuid,uuid)';
  v_a text[] := array[
$q$    'The league office removed you from '||coalesce(v_club, 'your club')||'. You are a free agent: any club may sign you, at the salary you were earning (Rule 2.2).',$q$,
$q$      || coalesce(' from ' || v_club, '') || '; he is a free agent (Rule 2.2)');$q$];
  v_b text[] := array[
$q$    'The league office removed you from '||coalesce(v_club, 'your club')||'. You are a free agent'
      /* v4.17b: once signings have closed, no club may sign the player this season except as a replacement (Rule 2.4) */
      ||case when public.fa_moves_closed(v_season.id)
             then ', but signings have closed for the season, so no club may sign you this season except as a replacement signing (Rule 2.4).'
             else ': any club may sign you, at the salary you were earning (Rule 2.2).' end,$q$,
$q$      || coalesce(' from ' || v_club, '') || '; they are a free agent (Rule 2.2)');$q$];
  v_def text; v_n int; i int;
begin
  for i in 1 .. 2 loop
    v_def := pg_get_functiondef(v_fn);
    v_n := (length(v_def) - length(replace(v_def, v_a[i], ''))) / length(v_a[i]);
    if v_n <> 1 then raise exception 'admin_remove_from_roster patch %: anchor found % times', i, v_n; end if;
    execute replace(v_def, v_a[i], v_b[i]);
  end loop;
  if position('public.fa_moves_closed(v_season.id)' in pg_get_functiondef(v_fn)) = 0
     or position('''; he is a free agent (Rule 2.2)''' in pg_get_functiondef(v_fn)) > 0 then
    raise exception 'self-check: admin_remove_from_roster was not patched';
  end if;
end $p$;
