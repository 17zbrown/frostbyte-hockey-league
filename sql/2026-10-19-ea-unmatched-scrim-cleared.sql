-- 2026-10-19: the one unmatched EA import, cleared as not a league game.
-- Commissioner, 2026-10-19: "can you fix the 1 unmatched EA import?"
--
-- EA match 2418135570484 (archived 2026-10-14) was refused as 'unmatched': "one club in this match is not a league
-- club". What it was:
--   * CGHL New York Islanders (EA 17688) 1, The BotFlys (EA 8845) 3; it ended 8:22 PM ET on Wednesday Oct 14.
--   * The BotFlys players (x SMP 7, Mr Vezina 20, o Toeyy, Peteypipes05, l51lzeus, Xirox_88) have no CGHL profile
--     under that EA name or gamertag, so they are no league club playing under an outside club (not a Rule 4.6
--     substitution) and no unlinked league club.
--   * NYI's first fixture that night was DAL vs NYI at 8:25 PM ET. That game was played by Dallas's own six players
--     in three sittings ending 8:31 and 8:37 PM (both struck as early restarts, Rule 4.3) and 9:08 PM (filed, DAL 6
--     NYI 1). The BotFlys match ended before the league game began.
-- So it was a warm-up against an outside club: not a league game, and nothing in it counts toward any CGHL line
-- (every-line-counts covers every league game; this was none). Nothing is deleted: the row stays archived with its
-- payload and is still replayable with Re-ingest; its status moves to 'ignored' (the importer's own status for a
-- match that is not league business) with the reason, so it leaves the staff queue (Stats manager "Unmatched EA
-- matches", the staff briefing and the Control Center to-do count status 'unmatched' only).
-- ea_ingest_log has no triggers; nothing here posts anywhere.
--
-- REHEARSAL on production, 2026-10-19, in one transaction ending in an uncaught raise: rows=1, status now=ignored,
-- unmatched or error rows left=0. Applied through execute_sql the same day (a data correction, no schema change).

update public.ea_ingest_log
   set status = 'ignored',
       reason = 'not a league game: a warm-up against an outside club (The BotFlys, EA 8845; none of its players is a CGHL member) that ended at 8:22 PM ET, before NYI''s first fixture (DAL vs NYI, 8:25 PM). Cleared by the league office on 2026-10-19 at the commissioner''s request.',
       last_attempt_at = now()
 where ea_match_id = '2418135570484' and status = 'unmatched';

do $c$
begin
  if (select status from public.ea_ingest_log where ea_match_id = '2418135570484') is distinct from 'ignored' then
    raise exception 'self-check: the scrim is not cleared';
  end if;
end $c$;
