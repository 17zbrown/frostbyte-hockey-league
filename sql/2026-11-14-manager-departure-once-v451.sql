-- v4.51 (2026-11-14): the league office is told ONCE when a club manager leaves the league Discord, not every 2 minutes.
-- Commissioner, 2026-11-13: "Why has the website sent me the same notification multiple times of someone leaving the
-- league? I only need one notification that."
--
-- Cause: sweep_roster_departures (Rule 1.1) runs on every discord-sync tick, about every 2 minutes. For a player it
-- writes a roster_departure_notices row, and that open notice keeps the next tick from warning the club again. A seat
-- holder (Owner, GM, AGM) is never removed automatically, so the manager branch told the office ("A club manager has
-- left the Discord") and wrote nothing at all. Every tick found the same manager and told the office again, until the
-- manager came back or lost the seat. The site bell (commissioners plus Operations staff, four people) got 416 copies
-- for Marchenko (UTA) on Oct 1, 96 for HungryXCIX (PIT) on Oct 3 and 56 for SmokiestTitan34 (SEA) on Nov 13 before
-- this fix, which was still running. Nothing reached Discord: notify_department writes site notifications only.
--
-- Fix: the manager branch marks the flag with an admin_audit row ('manager_departure_flagged', target the profile) and
-- tells the office only when no mark is newer than the member's last sighting in the server (max guild_members.
-- last_seen). One departure is one notice; a manager who rejoins and later leaves again is seen after the old mark, so
-- the office hears about the new departure too, as Rule 1.1 does for players ("Each departure starts its own window").
-- The mark is also the office's record of when it was told. A manager holding spots in two open seasons is told once:
-- the first row's mark covers the second in the same tick.
-- Backfill: a manager the office was already told about for the departure under way (a flag notification newer than
-- their last sighting) gets a mark now, so the first tick after this fix does not send one more copy.
-- Patched by exact text replacement on the live definition (anchor asserted to match once), so CREATE OR REPLACE keeps
-- the signature and grants (authenticated, service_role). The Edge discord-sync job reads the same row shapes: no
-- redeploy. Nothing here posts to Discord. Rule 1.1 already says the office "is told instead"; no rule text changes.

do $patch$
declare
  v_def text;
  v_old text := $old$      if r.is_mgr then
        perform public.notify_department('operations','flag','A club manager has left the Discord',
          r.gt||' holds a seat on '||r.tc||' and is no longer in the server. A manager is never removed '||
          'automatically, so the league office has to decide this one.','team',r.tc);
        action:='manager_flagged'; gamertag:=r.gt; club:=r.tc; detail:='seat holder, left to the office';
        return next; continue;
      end if;$old$;
  v_new text := $new$      if r.is_mgr then
        /* v4.51 (commissioner, 2026-11-13): "Why has the website sent me the same notification multiple times of
           someone leaving the league? I only need one notification that." A seat holder gets no notice row (they are
           never removed), so nothing told the next tick the office had already heard, and every 2-minute sweep told it
           again (104 copies each for one departure on Oct 1). Once per departure now: the admin_audit mark records the
           flag, and a departure is new when the member was last seen in the server after the newest mark. */
        if not exists (select 1 from public.admin_audit a
                        where a.action = 'manager_departure_flagged' and a.target_type = 'profile'
                          and a.target_id = r.profile_id::text
                          and a.created_at > coalesce((select max(g.last_seen) from public.guild_members g
                                                        where g.profile_id = r.profile_id), '-infinity'::timestamptz)) then
          perform public.notify_department('operations','flag','A club manager has left the Discord',
            r.gt||' holds a seat on '||r.tc||' and is no longer in the server. A manager is never removed '||
            'automatically, so the league office has to decide this one.','team',r.tc);
          perform public.log_admin_action('manager_departure_flagged','profile',r.profile_id::text,
            jsonb_build_object('player',r.gt,'club',r.tc));
          action:='manager_flagged'; gamertag:=r.gt; club:=r.tc; detail:='seat holder, left to the office';
          return next;
        end if;
        continue;
      end if;$new$;
  v_n int;
begin
  v_def := pg_get_functiondef('public.sweep_roster_departures(integer)'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'v4.51 patch: the manager branch matched % times, expected exactly 1', v_n; end if;
  execute replace(v_def, v_old, v_new);
end $patch$;

-- Backfill: managers already told about the departure under way.
insert into public.admin_audit(action, target_type, target_id, detail)
select 'manager_departure_flagged', 'profile', p.id::text,
       jsonb_build_object('player', p.gamertag, 'club', t.code, 'backfill', true,
                          'first_told', (select min(n.created_at) from public.notifications n
                                          where n.title = 'A club manager has left the Discord'
                                            and n.body like p.gamertag || ' holds a seat on %'))
  from public.profiles p
  join public.teams t on p.id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id)
 where p.in_guild = false
   and not exists (select 1 from public.guild_members g where g.profile_id = p.id and g.present)
   and exists (select 1 from public.notifications n
                where n.title = 'A club manager has left the Discord'
                  and n.body like p.gamertag || ' holds a seat on %'
                  and n.created_at > coalesce((select max(g.last_seen) from public.guild_members g where g.profile_id = p.id),
                                              '-infinity'::timestamptz));

do $chk$
declare v_def text := pg_get_functiondef('public.sweep_roster_departures(integer)'::regprocedure);
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'sweep_roster_departures') <> 1 then
    raise exception 'v4.51 check: expected exactly one sweep_roster_departures';
  end if;
  if position('a.action = ''manager_departure_flagged''' in v_def) = 0
     or position('perform public.log_admin_action(''manager_departure_flagged''' in v_def) = 0
     or position(E'detail:=''seat holder, left to the office'';\n        return next; continue;' in v_def) > 0 then
    raise exception 'v4.51 check: the manager branch is not the once-per-departure form';
  end if;
  if not has_function_privilege('authenticated', 'public.sweep_roster_departures(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.sweep_roster_departures(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sweep_roster_departures(integer)', 'EXECUTE') then
    raise exception 'v4.51 check: sweep_roster_departures grants changed';
  end if;
end $chk$;

/* REHEARSAL (2026-11-14, one transaction on the live database, rolled back by a closing raise): the patch, the backfill
   and the self-checks above, then a probe. By then SmokiestTitan34 no longer held the SEA seat (the copies stopped at
   04:06 UTC, 60 in all, 15 to each of the four recipients), so no manager was out of the server and the probe used a
   stand-in: a club Owner in the server with a spot in an open season, marked gone (profiles.in_guild false,
   guild_members.present false) inside a pass undone with SQLSTATE ZZ001.
   T1 no manager out of the server, so the backfill wrote no mark.
   T2 the stand-in leaves: the sweep returns one 'manager_flagged' row, four notifications are written (the commissioners
      and Operations staff), one 'manager_departure_flagged' mark is written; the second and third ticks return no
      manager row and write no notification.
   T3 the stand-in is seen in the server after the mark (last_seen moved past it) and is gone again: told again, once.
   T4 the stand-in pass left nothing behind (in_guild back, no mark).
   net.http_request_queue held 0 rows before and after (nothing posted).
   Result: REHEARSAL OK: T1 T2 T3 T4 (recipients 4, pg_net queue 0 before, 0 after)
   Afterward the live definition still had the old md5 (2b0133addbe3801f9c8fc1a4cd3511d5) and no mark existed. */

-- Applied as migration v451_manager_departure_once; tools/sql/grant-audit.sql returned zero rows. Read back: the new
-- definition is live, grants unchanged (authenticated, service_role), no backfill mark (no manager was out of the server).
