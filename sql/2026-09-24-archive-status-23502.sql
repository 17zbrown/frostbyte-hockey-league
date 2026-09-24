-- v3.08 — the EA archive status never moved off `unmatched`, and it never had.
--
-- FOUND while reconciling one game: both sittings of DAL v VAN still read `unmatched` hours
-- after the game was filed, correct and final. A sweep found the same on TEN of the night's
-- imports: every one of them read `unmatched` while OWNING its game (games.ea_match_id matched),
-- so the filing had plainly succeeded and only the status rewrite had not landed.
--
-- THE PROOF. last_attempt_at on all ten was earlier than the game_stats rows they filed — in
-- three cases by six minutes. The final archive(...'ingested') had never touched the row.
--
-- THE CAUSE. touchAttempt sent an UPSERT that deliberately omitted `payload`:
--     insert into ea_ingest_log (ea_match_id, status, reason, game_id, last_attempt_at)
--     values (...) on conflict (ea_match_id) do update set ...
-- `payload` is NOT NULL with no default, and Postgres checks NOT NULL against the PROPOSED
-- tuple BEFORE the ON CONFLICT arbiter resolves to an UPDATE. Run live against a row that
-- exists, that statement returns:
--     23502 / null value in column "payload" of relation "ea_ingest_log" violates not-null
-- The upsert was chosen OVER a PATCH, in a comment, on the grounds that "a PATCH on a row that
-- is not there affects nothing and says nothing". The upsert said nothing either: the throw was
-- caught and logged, so every status after the first archive was lost in silence.
--
-- WHAT IT COST. An `unmatched` row is precisely what bot/staff-alerts.mjs routes to the
-- Statistics desk as "EA import needs a match, link it by hand" — so a clean, fully automatic
-- import raised a false alarm every time. And the lag-out dedupe looks for status `merged`,
-- which could therefore never be found, leaving a second merge of the same sitting possible.
--
-- THE FIX (netlify/functions/ingest-stats.js): PATCH, with Prefer: return=representation, and
-- then LOOK. An UPDATE matching no row comes back 200 with an empty array and no error, which
-- is a false success; the representation is the only thing that tells the two apart. The
-- successful-filing call site no longer ignores the result either — a lost status now lands in
-- summary.errors instead of being swallowed.
--
-- BACKFILL. Every archive row whose match owns a final game is stamped with the truth.
begin;

update public.ea_ingest_log l
   set status  = 'ingested',
       game_id = g.id,
       reason  = 'filed '||g.home_score||'-'||g.away_score||
                 '; archive status reconciled (the status touch had been failing with 23502)'
  from public.games g
 where g.ea_match_id = l.ea_match_id
   and l.status = 'unmatched'
   and g.status = 'final';

do $chk$
declare n int;
begin
  select count(*) into n from public.ea_ingest_log l
    join public.games g on g.ea_match_id = l.ea_match_id
   where l.status = 'unmatched' and g.status = 'final';
  if n <> 0 then raise exception '% filed game(s) still read unmatched', n; end if;
end $chk$;

commit;

-- The two sittings of the lag-out game were stamped by hand to what the merge path writes:
--   1372621350197 -> ingested (it owns the game)   1374750190188 -> merged into it
-- Left afterwards: 11 ingested, 1 merged, 8 ignored, and 2 genuinely unmatched (Sep 10, from
-- clubs that are not registered) — the only two that are real work for the statistics desk.
