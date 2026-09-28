-- v3.51 (part 4 of the suspension overhaul): playing while suspended, appeals, the public record,
-- and the Discord timeout. Applied 2026-09-28. The rulings quoted are the commissioner's, 2026-09-28.

-- 1. PLAYING WHILE SUSPENDED (Q8): "Any time a player is under a playing suspension, and is read on
--    a team's box score, that will be a team forfeit loss and the suspended player is subject to
--    suspension extension, and the team's management will be given a written warning about the
--    situation."
--    public.check_suspended_appearances(game): for each box-score line whose player had a playing
--    suspension running at the game's scheduled time (suspension_running_at, the one definition),
--    once per (game, player) via admin_audit 'suspended_appearance':
--      * the club's Owner, GM and AGM each get a written warning (a 'warning' suspensions row);
--      * the department that issued it (community for venue discord, else officiating) is flagged
--        to decide an extension, and #staff-casework is told;
--      * the game gets forfeit_team_id = that club, score and every statistic standing (the Rule 4.3
--        kept-result shape), announced in #game-scores like every other forfeit (v3.34).
--    Both clubs offending: no automatic forfeit; officiating is flagged to rule.
--    Runs from trg_check_suspended_appearances (entering final) and from
--    review_records_on_stats_write (box scores landing on a game already final, e.g. a merge).
--    Rehearsed against a real final: forfeit on the offending club, 2 warnings (its 2 seat holders),
--    1 audit row, 4 posts queued; a second run ruled nothing.

-- 2. APPEALS (Q9, Q62): "Discord appeals go through community staff, and on ice appeals go through
--    whoever handles gameplay suspensions." "1 per suspension."
--    action_requests gains suspension_id and dept. trg_link_appeal (BEFORE INSERT) links an appeal to
--    the member's running suspension (or one issued in the last 48 hours), refuses a second appeal of
--    the same suspension, and sets dept from its venue. It replaces cap_suspended_appeals (2 per).
--    trg_guard_appeal_decider (BEFORE UPDATE): the official who imposed it never decides it, and it
--    is decided by its own department or a commissioner. discipline_from_case refuses the issuer on
--    the appeal case; lift_suspension lets community lift any Discord-conduct suspension (to grant an
--    appeal), not only its own.
--    Rehearsed: A1 linked + dept community; A2 second appeal refused; A3 issuer refused; A4 an
--    officiating-only official refused on a Discord appeal.

-- 3. THE PUBLIC RECORD (Q61): "Length and headings only."
--    The suspensions table WAS readable by anyone, signed in or not, reason and issuing official
--    included. SELECT is revoked from anon and authenticated; the site reads public.suspension_record,
--    which gives everyone the length, headings, state (running, from suspension_running_at) and
--    games served, gives the member and staff the reason, gives staff the issuer, and drops lifted
--    (vacated) suspensions and warnings from the public view. Verified as a signed-out visitor
--    (rows visible, reason and issuer null) and as staff (reason visible).

-- 4. THE DISCORD TIMEOUT (Q7): "for discord conduct, they will be in timeout for the length of their
--    suspension." netlify/functions/discord-sync.js times out a linked member with a running
--    Discord-conduct suspension to a date until its end (11:59 PM ET), renewing past Discord's 28-day
--    cap, and clears only the timeouts it set (app_config.discord_timeouts_applied).

-- Bans (Q10: "Bans should happen on the site, and should be mirrored in discord, but the ban should be
-- inputted from the site") already worked this way: discord-sync puts a site ban into the Discord and
-- lifts a Discord-only ban on a linked member. Rule 7.7 now says so.

-- The function bodies are the live definitions: check_suspended_appearances,
-- trg_check_suspended_appearances, review_records_on_stats_write, link_appeal, guard_appeal_decider,
-- lift_suspension, discipline_from_case, and the view suspension_record.
