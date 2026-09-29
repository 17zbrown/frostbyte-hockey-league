-- v3.73: the game-incident log is retired.
-- Commissioner, 2026-09-29 (Q58): "You can remove the game-incident log. I dont think that will be used."
-- It never was: public.game_incidents held 0 rows, against the seven forfeits the league has ruled.
--
-- ORDER (the always-on VM bot subscribed to this table over Realtime, twice):
--   1. Ship the bot, site and tests without it (commit v3.73). The VM's update timer restarts chel-bot within
--      about five minutes of a push that touches bot/.
--   2. Confirm the new bot is running: app_config rl_gateway-bot_result has no incidentsLive field and its
--      uptimeMin has reset, and realtime.subscription holds no row for game_incidents.
--   3. Only then run this file. Dropping the table under the old bot would 404 its ten-minute catch-up (the
--      heartbeat flips ok:false and the watchdog pages) and could break the seven-table staff-desk channel
--      on its next join.
-- log_game_incident is plpgsql, so dropping the table alone would leave a function that fails when CALLED,
-- not when dropped: both go in one transaction. RESTRICT (the default) proves nothing else depends on them.

do $mig$
begin
  if (select count(*) from public.game_incidents) > 0 then
    raise exception 'game_incidents is not empty: % row(s). Nothing was dropped.', (select count(*) from public.game_incidents);
  end if;
  if exists (select 1 from realtime.subscription where entity::text in ('game_incidents', 'public.game_incidents')) then
    raise exception 'a Realtime subscriber still listens to game_incidents: wait for the bot to restart. Nothing was dropped.';
  end if;
end $mig$;

drop function public.log_game_incident(uuid, uuid, text, integer, integer, text, boolean, text, boolean);
drop table public.game_incidents;

/* APPLIED 2026-09-29 13:48 UTC as migration v373_incident_log_retired, after the push of v3.73 (4c8fa1c):
   the VM bot had restarted at 13:47 (rl_gateway-bot_result uptimeMin 0, no incidentsLive field), and
   realtime.subscription held no game_incidents row while the staff-desk channel had rejoined its six tables.
   Afterwards: to_regclass('public.game_incidents') is null, log_game_incident is gone, and no public function
   body mentions game_incident. */
