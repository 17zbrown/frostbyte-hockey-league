-- 2026-11-25: the three July 9 test stories removed from public.news, at the commissioner's request.
-- Commissioner, 2026-11-25 (asked: "May I permanently delete those three stories"): "Yes, delete the three".
--
-- What was there: three news rows filed with no season (season_id null), all published 2026-07-10 03:15 UTC, seeded
-- before the league launched: a hat trick story, a five-point game story and a game night recap, about clubs that never
-- existed. The Season 2 site's News page (src/s2/js/pages/office.js) includes stories filed for no season, so these led
-- the public News page after the v4.63 switch (found by the 2026-11-25 live health check, finding [crawl 2]). The
-- `or season_id is null` reading in s2_league stays: a real staff story may be filed for no season.
-- What goes with them: nothing. No foreign key references public.news, no bell links to these rows (0 notifications
-- with their ids), and the only DELETE trigger is live_mark_news_del (it marks the live pulse so open News pages repaint).
-- on_news_notify_discord fires AFTER INSERT only, so nothing is posted anywhere.
-- Undo: each row is copied whole into admin_audit first (action 'news_deleted', target 'news' and the story id,
-- detail->'row'), so any story can be re-inserted from there. The stories' text stays out of this public record.
--
-- REHEARSAL on production, 2026-11-25, in one transaction ending in an uncaught raise (everything rolled back):
--   REHEARSAL OK: T1 season-less stories left=0, T2 backup rows=3, T3 stories left=398, T4 queued=0. Checked after:
--   3 season-less stories still present, 0 backup rows, 401 stories.
-- Run through the main session the same day (a data correction, no schema change): season-less stories left 0, backup
-- rows in admin_audit 3, stories 398, nothing queued for Discord.

do $d$
declare r record; v_n int; v_all int := 0;
begin
  for r in select n.* from public.news n
            where n.season_id is null and n.published_at = '2026-07-10 03:15:15.475329+00'
            order by n.id
  loop
    perform public.log_admin_action('news_deleted', 'news', r.id::text,
      jsonb_build_object(
        'reason', 'July 9 pre-launch test story removed at the commissioner''s request (2026-11-25)',
        'row', (select to_jsonb(x) from public.news x where x.id = r.id)));
    delete from public.news where id = r.id and season_id is null;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'expected to delete story %, deleted % rows', r.id, v_n; end if;
    v_all := v_all + 1;
  end loop;
  if v_all <> 3 then raise exception 'expected exactly three July 9 test stories, found %', v_all; end if;
end $d$;

do $chk$
begin
  if exists (select 1 from public.news where season_id is null and published_at = '2026-07-10 03:15:15.475329+00') then
    raise exception 'self-check: a July 9 test story is still there';
  end if;
  if (select count(*) from public.admin_audit where action = 'news_deleted' and detail ? 'row') < 3 then
    raise exception 'self-check: fewer than three backup rows in admin_audit';
  end if;
end $chk$;
