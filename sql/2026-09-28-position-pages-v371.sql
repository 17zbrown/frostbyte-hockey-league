-- v3.71: per-position stat pages on the profile (client), and overall tables written only by the engine.
-- Commissioner, 2026-09-28:
--   Q30: "split-position players: separate stat pages per position group via dropdown on the profile; show C vs W
--        difference." Built in the client (src/live/part5a_public.js: CG.posGroupLines, the Position picker, the
--        center-against-wing line): each group's line is summed from the same box-score lines as the season line.
--   Q59 (defense in depth): player_position_overalls kept the API roles' INSERT/UPDATE/DELETE grants; row security
--        refused the writes, but an overall is the engine's alone (v3.67), so the grants go too.
revoke insert, update, delete, truncate, trigger, references on public.player_position_overalls from anon, authenticated;
