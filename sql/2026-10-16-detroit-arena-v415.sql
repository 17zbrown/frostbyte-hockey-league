-- v4.15: Detroit's home arena is Little Caesars Arena.
-- Why: public.teams had arena = 'Scotiabank Arena' (Toronto's arena) for DET, so the Red Wings club header and every
-- page that prints the arena showed the wrong building. Found by the 2026-10-16 design audit (finding F93). The
-- commissioner, 2026-10-16: "Fix the Detroit arena to be Detroits actual arena."
-- This is the same write the Teams editor makes. The other seven clubs have no arena set (null); they are untouched.
-- Triggers on public.teams that fire on this update: live_mark_teams_upd (site refresh, intended) and rsq_teams,
-- which acts only on owner, GM and AGM seat changes, so nothing is queued and nothing posts to Discord.
--
-- Rehearsal on production, 2026-10-16, rolled back by an uncaught raise:
--   REHEARSAL (rolled back): 1 row changed, DET arena would read Little Caesars Arena

update public.teams set arena = 'Little Caesars Arena' where code = 'DET' and arena = 'Scotiabank Arena';

do $$ declare v text; begin
  select arena into v from public.teams where code = 'DET';
  if v is distinct from 'Little Caesars Arena' then
    raise exception 'v4.15 self-check: DET arena is %, expected Little Caesars Arena', v;
  end if;
end $$;
