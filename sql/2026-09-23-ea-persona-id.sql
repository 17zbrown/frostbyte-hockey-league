-- v3.04 (2026-09-23, game night one) — the league learns EA's persona id and stops matching on names.
--
-- Commissioner: "Check EA IDs for box scores, not usernames. You are showing a no match for
-- 'YoungBlood9340' when their EA ID is 'Devildog9897'."
--
-- THE THING I HAD TO CORRECT: matching on the stored ea_id cannot work, because EA never sends
-- that string. Read from a real archived payload, an EA player object carries exactly one name
-- field, `playername`, plus the persona id that keys it:
--
--   playername      "YoungBlood9340"      <- the CONSOLE persona
--   (object key)    1843907431            <- EA's persona id
--   profiles.ea_id  "Devildog9897"        <- what the member typed: his EA ACCOUNT name
--
-- Those are two different identifiers for one human, and no string comparison bridges them. It is
-- not a mistake the member made in any obvious sense. The same pattern held for six members:
--   Mr Riley Sauce / 183987727      vs ea_id Riley2161
--   I Kolosov I    / 1883618070     vs ea_id RedDevil9217
--   l Setty l      / 186209497      vs ea_id Setkells18
--   Maniac x98     / 385937586      vs ea_id Slehur
--   Dmb Dex225     / 1004693596770  vs ea_id hockey_godd24
--
-- THE FIX: store the persona id, which is the only identifier EA sends that is not a display name.
-- It is stable, it survives any rename, and it makes the EA ID box stop mattering once it has
-- worked once.

begin;

alter table public.profiles add column if not exists ea_player_id text;
comment on column public.profiles.ea_player_id is
  'v3.04: EA''s stable persona id, as it keys the players object in an EA match payload. Learned automatically the first time a box-score row resolves to this member by any means, and matched on FIRST from then on.';

-- one persona is one human. Two profiles claiming it is a duplicate account (exactly what happened
-- to Lokharov, who had two), and it must fail loudly rather than silently split a season's stats.
create unique index if not exists profiles_ea_player_id_key
  on public.profiles (ea_player_id) where ea_player_id is not null;

grant select (ea_player_id) on public.profiles to anon, authenticated;

commit;

-- Backfill from the games already filed. No inference: each of these box-score rows had ALREADY
-- resolved to that profile, so the persona it carried is that member's by definition.
--   with pick as (select distinct on (profile_id) profile_id, ea_player_id from game_stats
--                  where profile_id is not null and ea_player_id is not null
--                  order by profile_id, ea_player_id)
--   update profiles p set ea_player_id = pick.ea_player_id
--     from pick where p.id = pick.profile_id and p.ea_player_id is null;
-- Result: 43 members linked, 0 personas claimed twice.
--
-- Then two links the filed lineup FORCES, which is elimination on a closed set of six rather than
-- a name guess: exactly one unmatched box-score row and exactly one dressed player unaccounted for.
--   BOS  YoungBlood9340 / 1843907431  ->  YøungBløød  (ea_id on file: Devildog9897)
--   DET  Mr Riley Sauce / 183987727   ->  CorRye      (ea_id on file: Riley2161)
-- Their game_stats rows were re-pointed too, so both got their two goals back.
--
-- LEFT FOR A HUMAN, because each club had several dressed players unaccounted for and a wrong link
-- is worse than no link. The name each one probably is, for whoever picks:
--   DAL  vDarkiee___  / 1004486290545   (5 candidates)
--   NYI  Dmb Dex225   / 1004693596770   probably "dmbdex255"
--   NYI  Itz_Pidgeon  / 1009015295480   probably "Chase Pidgeon"
--   NYI  N0Tsurprised / 1005173977114   (3 candidates)
--   SEA  Maniac x98   / 385937586       probably "Maniac"
--   UTA  I Kolosov I  / 1883618070      probably "Kolosov"
--   UTA  l Setty l    / 186209497       probably "Bad News Kells" (ea_id Setkells18)
--
-- The application side (netlify/functions/ingest-stats.js) does two things with this column:
--   1. asks it FIRST, before any name, via liveLookups.profilePersona / gameLookups.profilePersona;
--   2. learnPersonas(rows) writes it onto any profile that has none, every time a row resolves by
--      any route, so the league only ever has to recognise a member once. It fills a NULL only
--      (`ea_player_id=is.null` in the filter, so a concurrent writer cannot be clobbered), logs a
--      409 rather than throwing, and can never fail an import.
