-- v463 reverse (DRAFT, 2026-11-24): the Discord half of the Season 2 staffing flip switches off. Run it FIRST when the
-- staffing flip is reversed (before the staff copy, all-staff voting and staff powers reverses). With the key gone every
-- lane is back on Season 1's department model (shared/roles.mjs committeesLive): the next discord-sync tick puts the
-- department roles back on the staffers who picked them, takes Staff off Media-only staffers and takes the committee
-- manager roles off (they stay managed in both models, so nobody keeps one); the bot's staff alerts post to the
-- department rooms again. The committee manager roles themselves are not deleted (the office reaps them by id).

delete from public.app_config where key = 'staff_model';

do $chk$
begin
  if exists (select 1 from public.app_config where key = 'staff_model') then
    raise exception 'v463 reverse check: app_config.staff_model is still set';
  end if;
end $chk$;
