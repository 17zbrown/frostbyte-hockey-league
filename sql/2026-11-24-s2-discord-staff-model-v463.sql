-- v463 (DRAFT, 2026-11-24; apply at the flip, right after sql/2026-11-24-s2-staff-powers-v463.sql, never before): the
-- Discord half of the Season 2 staffing flip switches on. One app_config key, staff_model = 'committees', read by the
-- three Discord lanes that still know about departments:
--  * the role sweep (jobs/discord-sync.js, Supabase Edge) and the gateway bot's instant role sync (bot/role-sync.mjs),
--    through the one rule in shared/roles.mjs: every staffer and commissioner wears Staff (the Media-only exception reads
--    departments, so it ends), the eight department roles come off everyone (UNASSIGNED, never deleted; the rooms stay,
--    unbuilt and untouched), and a seated committee manager (public.committees.manager_profile_id) wears
--    "<committee name> Manager", one role per committee, created by the sweep;
--  * the bot's staff alerts (bot/staff-alerts.mjs): no department rooms; an owner, staff or front-office application is
--    announced in the one staff channel through public.notify_staff_ch (which the staff powers record points at
--    #staff-casework for every caller) with the Staff role tagged, and a new case or staff vote is left to the
--    database's own post there (notify_action_request, staff_vote_create), so nothing is announced twice.
--
-- The rulings (memory s2-staffing-model.md, league law):
--  * Commissioner, 2026-10-19: "for Season 2, we will remove the different departments, and we will allow every staff
--    member to be a part of one big group."
--  * 2026-11-23: "every staffer wears the plain Staff role (Media and the department roles go); only committee managers
--    also wear their committee manager role." "There should be a staff notifications channel in the discord which is
--    where all the automated notifications should go that the bot sends out for staff. But create a notification for
--    suspensions and bans as well." (The ban, unban and lift notices are the staff powers record's triggers.)
--
-- Absent, or 'departments', is Season 1's model, exactly as before: the code ships ahead of this record and changes
-- nothing until it applies. Any other value is refused by every lane (shared/roles.mjs committeesLive throws), so a typo
-- leaves roles and alerts as they are rather than guessing. Two things follow the database with no key at all and are
-- already right on either side of the flip: the daily vote nudge asks public.is_app_reviewer (the all-staff voting
-- record makes it every staff voter), and the Training Camp role and #free-agency follow public.market_on and
-- public.market_pool.
--
-- Deleting the department roles and rooms is the commissioner's later call (Phase C), by explicit ids through
-- app_config.discord_reap; nothing here deletes anything.
--
-- Reverse: sql/2026-11-24-s2-discord-staff-model-v463.reverse.sql (run it FIRST when the staffing flip is reversed, before
-- the staff copy, all-staff voting and staff powers reverses). Rehearsal: sql/2026-11-24-s2-discord-staff-model-v463.rehearsal.sql.
-- After applying: the next discord-sync tick (2 minutes) moves every staffer's roles; the bot follows within 60 seconds
-- of its next sync. Edge jobs must already run the build that knows the key (discord-sync); the VM bot must have pulled it.
-- Recommended instead of a separate apply: fold the insert below into the staff powers record and the delete into its
-- reverse, so the database and Discord can never disagree about the model.

do $pre$
declare d text;
begin
  if to_regprocedure('public.profile_has_department(uuid,text)') is null
     or to_regprocedure('public.is_any_committee_manager(uuid)') is null or to_regclass('public.committees') is null then
    raise exception 'v463 Discord staff model: the staff powers record (sql/2026-11-24-s2-staff-powers-v463.sql) must be applied first';
  end if;
  d := pg_get_functiondef('public.notify_staff_ch(text,text,boolean)'::regprocedure);
  if position('discord_staff_casework_webhook' in d) = 0 or position('''discord_staff_''||p_channel' in d) > 0 then
    raise exception 'v463 Discord staff model: notify_staff_ch does not post to the one staff channel yet (apply the staff powers record first)';
  end if;
  if (select count(*) from public.committees) <> 6 then
    raise exception 'v463 Discord staff model: expected the six committees, found %', (select count(*) from public.committees);
  end if;
end $pre$;

insert into public.app_config (key, value, updated_at) values ('staff_model', 'committees', now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

do $chk$
begin
  if (select value from public.app_config where key = 'staff_model') is distinct from 'committees' then
    raise exception 'v463 check: app_config.staff_model is not committees';
  end if;
end $chk$;
-- Applied as migration v463d_s2_discord_staff_model on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
