-- 2026-11-23: the ten open Season 1 trade requests removed, at the commissioner's request.
-- Commissioner, 2026-11-23: "Trade requests should be removed following the passing of the trade deadline so you can
-- delete all the season 1 trade requests."
--
-- What was there: ten action_requests rows of type 'trade_request', all Season 1, filed 2026-09-24 to 2026-11-08, all
-- still 'open'. Season 1's trade deadline passed long ago and every Season 1 front-office seat has ended (the v4.53 club
-- season close), so each request sat in a club queue that no one could act on.
-- What goes with them:
--   * their action_messages (the foreign key cascades; they are copied first);
--   * the 45 bells that point at them (notifications.link_param = the request id, link_view 'actions' or 'admin'),
--     which would otherwise open a case that no longer exists.
-- Nothing else references a trade request: suspensions.request_id and abandonment_watch.case_id point at other case
-- types (both ON DELETE SET NULL in any case). action_requests has no DELETE trigger, so nothing posts anywhere and no
-- one is notified. discord_dms already sent stay in Discord history.
-- Undo: before each delete the full request row, its messages and its bells are copied into admin_audit
-- (action 'trade_request_deleted', target 'action_request' and the request id, detail->'row', 'messages', 'bells'),
-- so any request can be re-inserted from there. This public record leaves the requests' text and names out on purpose:
-- a trade request is a club's private business (Rule 2.3).
-- The standing rule (trade requests are removed once the movement deadline passes) ships separately as a versioned
-- change with its rulebook text; this file only clears Season 1.
--
-- REHEARSAL on production, 2026-11-23, in one transaction ending in an uncaught raise (everything rolled back):
--   REHEARSAL OK: T1 trade requests left=0, T2 audit rows=10 (row kept=10), T3 bells archived=45, T4 messages
--   archived=3, T5 other cases still there=19. Checked after: 10 trade requests still present, 0 backup rows.
-- Run through execute_sql the same day (a data correction, no schema change): trade requests left 0, backup rows in
-- admin_audit 10, cases left 19 (1 open: the Season 2 complaint).

do $d$
declare r record; v_n int := 0; v_msgs int; v_bells int;
begin
  for r in select ar.* from public.action_requests ar
             join public.seasons se on se.id = ar.season_id
            where ar.type = 'trade_request' and se.number = 1
            order by ar.created_at
  loop
    perform public.log_admin_action('trade_request_deleted', 'action_request', r.id::text,
      jsonb_build_object(
        'reason', 'Season 1 trade request removed after the trade deadline, at the commissioner''s request (2026-11-23)',
        'row', (select to_jsonb(x) from public.action_requests x where x.id = r.id),
        'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.action_messages m where m.request_id = r.id), '[]'::jsonb),
        'bells', coalesce((select jsonb_agg(to_jsonb(n)) from public.notifications n where n.link_param = r.id::text and n.link_view in ('actions','admin')), '[]'::jsonb)));
    delete from public.notifications where link_param = r.id::text and link_view in ('actions','admin');
    delete from public.action_requests where id = r.id and type = 'trade_request';
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'expected to delete request %, deleted % rows', r.id, v_n; end if;
  end loop;
end $d$;

do $chk$
begin
  if exists (select 1 from public.action_requests ar join public.seasons se on se.id = ar.season_id
              where ar.type = 'trade_request' and se.number = 1) then
    raise exception 'self-check: a Season 1 trade request is still there';
  end if;
  if (select count(*) from public.admin_audit where action = 'trade_request_deleted') < 10 then
    raise exception 'self-check: fewer than ten backup rows in admin_audit';
  end if;
end $chk$;
