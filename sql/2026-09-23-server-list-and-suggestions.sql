-- v2.96 (2026-09-23) — the league's server list, the standard server, and a player's suggestion.
-- Applied live through the MCP in small gated transactions; this file is the record.
--
-- Commissioner's rulings, same day:
--   1. The server options are NA Northeast, NA Southeast, NA Central and NA West. NA East is out.
--   2. Where neither club names one, the game is played on NA Central.
--   3. On a game night the office asks any club that has not filed its picks, 90 minutes before
--      the night's first puck drop (7:30 PM for a 9:00 start), an hour before the picks freeze.
--      That half lives in netlify/functions/discord-scheduler.js (serverPickReminder).
--
-- The list had been hardcoded inside resolve_game_server, so changing it meant editing a function
-- body. It is a league setting, so it gets its own definition and the resolver reads it.

begin;

create or replace function public.server_options() returns text[]
language sql immutable set search_path = public as $fn$
  /* THE league's server list, in preference order. The browser mirrors it as CG.SERVERS and the
     scheduler as SERVER_LIST; change this and change those. */
  select array['NA Northeast','NA Southeast','NA Central','NA West']
$fn$;
grant execute on function public.server_options() to authenticated, anon, service_role;

create or replace function public.default_server() returns text
language sql immutable set search_path = public as $fn$
  /* The standard server: what a game lands on when NEITHER club names one. It must be one of
     server_options(); resolve_game_server skips it only when it is the away club's veto. */
  select 'NA Central'::text
$fn$;
grant execute on function public.default_server() to authenticated, anon, service_role;

-- resolve_game_server's safety net, spliced in place (the rest of the resolver is unchanged):
--
--   BEFORE  if v_res is null then          -- safety net: default NA East, skip the veto
--             select s into v_res from unnest(array['NA East','NA Northeast','NA Central'])
--               with ordinality as u(s, ord) where s is distinct from v_veto order by ord limit 1;
--           end if;
--
--   AFTER   if v_res is null then          -- nobody named one: the standard server, unless vetoed
--             if public.default_server() is distinct from v_veto then
--               v_res := public.default_server();
--             else
--               select s into v_res from unnest(public.server_options())
--                 with ordinality as u(s, ord) where s is distinct from v_veto order by ord limit 1;
--             end if;
--           end if;
--
-- Rehearsed with rollback against a real fixture, all three paths:
--   no picks            -> NA Central
--   veto on NA Central  -> the first listed server that is not the veto
--   home 1st choice     -> the home club's first choice, standard server ignored
-- (the T-30 guard trigger refuses a pick inside the lock, so the rehearsal filed its picks while
--  the fixture was still days out and moved the clock afterwards)

-- A player's own suggestion. guard_profile_role reverts role/banned/overall/departments/discord_id
-- and friends; it does not touch new columns, so the profile's owner can set this one himself.
alter table public.profiles add column if not exists preferred_server text;
comment on column public.profiles.preferred_server is
  'v2.96: the server this member plays best on, set by the member in Settings. Advisory only: club management reads it when choosing server picks and vetoes (Rule 4.2). One of public.server_options(), or null for no preference.';

-- The league load is ONE query for guests and members alike, so a column anon cannot read would
-- 400 the whole boot. authenticated already had it through the table-level grant.
grant select (preferred_server) on public.profiles to anon;

-- The 12 picks naming NA East (BOS and DAL, Wednesday and Thursday) could no longer be honored.
-- Cleared rather than reassigned: moving a club to a server it did not choose is worse than asking
-- it to choose again, and both clubs were told in their rooms with the freeze still an hour away.
update public.game_vetoes set
  veto      = case when veto      = 'NA East' then null else veto      end,
  pref1     = case when pref1     = 'NA East' then null else pref1     end,
  pref2     = case when pref2     = 'NA East' then null else pref2     end,
  preferred = case when preferred = 'NA East' then null else preferred end
where 'NA East' in (coalesce(veto,''), coalesce(pref1,''), coalesce(pref2,''), coalesce(preferred,''));

commit;
