-- v4.07 (2026-10-14): a rescheduled game is played ON TOP of a club's normal week.
--
-- Commissioner, 2026-10-14: "It looks like the Stars and Islanders had their Friday 10:10 PM games removed from this week
-- because of their reschedule. They should still have all their normal games, just the rescheduled game tacked on after
-- the fact."
--
-- Nothing was removed from the database: Islanders at Stars, postponed from Fri Oct 9 9:00 PM, was made up Wed Oct 14
-- 8:25 PM (ops_reschedule_game, Oct 12), so both clubs have ten games in Week 4 and all ten exist. The Team HQ game
-- lineup page built its game buttons from a club's next NINE games, so the tenth (Fri 10:10 PM) had no button; the site
-- half of v4.07 lists the club's whole week instead.
--
-- This record: games.rescheduled_from, the original puck drop of a game the league office moved, so the site can tell a
-- make-up from the regular schedule. The Control Center's schedule check had read the 8:25 PM make-up as a schedule
-- that "does not match the season shape" and told the office to clear and regenerate a season with 107 finals in it.
-- ops_reschedule_game keeps the FIRST original time when a game moves twice, and clears the mark when a game is moved
-- back to that time. Only the database writes it.

alter table public.games add column if not exists rescheduled_from timestamptz;
comment on column public.games.rescheduled_from is
  'v4.07: the original puck drop of a game the league office rescheduled (ops_reschedule_game); null for a game on its scheduled time.';
-- games is read through column grants (v2.57 keeps game_code and server private), so a new column is invisible to the
-- site until it is granted; the site selects it from v4.07 on, and an ungranted column would fail the whole boot query.
grant select (rescheduled_from) on public.games to anon, authenticated;

do $p$
declare v_def text := pg_get_functiondef('public.ops_reschedule_game(uuid, timestamptz)'::regprocedure);
        a text := '  update public.games set scheduled_at = p_at, week = coalesce(v_week, week) where id = p_game;';
        b text := '  /* v4.07: remember the original puck drop (the first one, if the game moves again); a game moved back to it is not a make-up */
  update public.games
     set scheduled_at = p_at, week = coalesce(v_week, week),
         rescheduled_from = case when p_at = coalesce(g.rescheduled_from, g.scheduled_at) then null
                                 else coalesce(g.rescheduled_from, g.scheduled_at) end
   where id = p_game;';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v4.07: ops_reschedule_game anchor'; end if;
  execute replace(v_def, a, b);
end $p$;

-- the games the office has moved so far, from its own audit trail: the earliest "from" of each
update public.games g
   set rescheduled_from = x.first_from
  from (select a.target_id::uuid as game_id, min((a.detail->>'from')::timestamptz) as first_from
          from public.admin_audit a
         where a.action = 'reschedule_game' and a.target_id ~ '^[0-9a-f-]{36}$'
         group by 1) x
 where g.id = x.game_id and g.rescheduled_from is null and x.first_from is distinct from g.scheduled_at;

do $chk$
begin
  if not has_column_privilege('anon', 'public.games', 'rescheduled_from', 'SELECT')
     or not has_column_privilege('authenticated', 'public.games', 'rescheduled_from', 'SELECT') then
    raise exception 'v4.07: the site cannot read games.rescheduled_from';
  end if;
  if position('rescheduled_from' in pg_get_functiondef('public.ops_reschedule_game(uuid, timestamptz)'::regprocedure)) = 0 then
    raise exception 'v4.07: ops_reschedule_game does not set rescheduled_from';
  end if;
  if (select rescheduled_from from public.games where id = 'd6359d09-9414-4bea-9f67-9a153b01ee49') is distinct from timestamptz '2026-10-10 01:00:00+00' then
    raise exception 'v4.07: the Oct 9 make-up was not marked';
  end if;
end $chk$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Part 2 (migration v407b_reschedule_text), from a read-only review before the site shipped: ops_reschedule_game's
-- messages used spaced hyphens as punctuation (house style: none), and every Control Center reschedule now reaches the
-- public transactions feed through it.
do $p$
declare v_def text := pg_get_functiondef('public.ops_reschedule_game(uuid, timestamptz)'::regprocedure);
        a1 text := 'That date has passed - pick a slot the clubs can actually play.';
        b1 text := 'That date has passed. Pick a slot the clubs can actually play.';
        a2 text := 'Rescheduled - %s at %s moved to %s ET.';
        b2 text := 'Rescheduled: %s at %s moved to %s ET.';
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1
     or (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then
    raise exception 'v4.07b: ops_reschedule_game text anchors';
  end if;
  execute replace(replace(v_def, a1, b1), a2, b2);
end $p$;
