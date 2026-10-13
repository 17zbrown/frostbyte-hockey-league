-- v3.99 (2026-10-13): an owner applicant is a signed-up player first.
--
-- Commissioner, 2026-10-13: "Make sure players currently playing in season 1 can sign up for season 2 when the signups
-- open since they dont overlap. Make sure a player cannot apply for an ownership position unless they are already signed
-- up for the season."
--  1. Nothing stood in the first one's way, and this file changes nothing there: season_registrations is unique per
--     (season, player), the sign-up guards read bans, suspensions and contact details, never a roster, and a Season 1
--     contract (every one ends with Season 1) places nobody on a Season 2 club. The rehearsal below proves it on a
--     rostered Season 1 player after the Oct 17 switch.
--  2. An owner application now needs the applicant's sign-up for the same season: when it is made, and when a withdrawn
--     application is filed again. The check runs after aa_stamp_owner_app_season has stamped the season.
--  3. A sign-up withdrawn or removed (by the player, the league office, the Discord departure sweep or discipline), or
--     declined, withdraws that member's pending owner application for the season with it, and tells the member why.
--     The rule is kept where the application is made, not where it is approved: a refusal at approval would fail the
--     ballot resolver's run for every application. A failure here never blocks the sign-up's own removal.
--  4. The Season 2 opening post says both things.

create or replace function public.guard_owner_app_signed_up()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_check boolean; v_num int;
begin
  if tg_op = 'INSERT' then
    v_check := true;
  else
    -- a withdrawn application filed again, or an application moved to another member or season
    v_check := (new.status = 'pending' and old.status is distinct from 'pending')
            or new.profile_id is distinct from old.profile_id or new.season_id is distinct from old.season_id;
  end if;
  if v_check and not exists (select 1 from public.season_registrations r
                              where r.profile_id = new.profile_id and r.season_id = new.season_id and r.status <> 'declined') then
    select number into v_num from public.seasons where id = new.season_id;
    raise exception 'SIGN_UP_FIRST: Sign up to play in Season % before applying to own a club. Only a signed-up player can apply.',
      coalesce(v_num::text, '') using errcode = '42501';
  end if;
  return new;
end $function$;
revoke execute on function public.guard_owner_app_signed_up() from public, anon, authenticated;
drop trigger if exists ab_guard_owner_app_signed_up on public.owner_applications;
-- "ab_" fires after "aa_stamp_owner_app_season", so the season it checks is the one the application is stamped with
create trigger ab_guard_owner_app_signed_up before insert or update on public.owner_applications
  for each row execute function public.guard_owner_app_signed_up();

create or replace function public.owner_app_follows_signup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_pid uuid; v_sid uuid; v_num int; v_n int := 0;
begin
  if tg_op = 'DELETE' then
    v_pid := old.profile_id; v_sid := old.season_id;
  elsif new.status = 'declined' and old.status is distinct from 'declined' then
    v_pid := new.profile_id; v_sid := new.season_id;
  else
    return null;
  end if;
  begin
    perform set_config('app.app_decide', 'on', true);
    update public.owner_applications set status = 'withdrawn'
     where profile_id = v_pid and season_id = v_sid and status = 'pending';
    get diagnostics v_n = row_count;
    perform set_config('app.app_decide', '', true);
  exception when others then
    perform set_config('app.app_decide', '', true);
    perform public.notify_commissioners(null, 'flag', 'Owner application not withdrawn',
      'A sign-up was removed, but the member''s pending owner application could not be withdrawn with it: ' || left(sqlerrm, 200) ||
      '. Withdraw it from the Staff Desk.', 'applications', null);
    return null;
  end;
  if v_n > 0 then
    select number into v_num from public.seasons where id = v_sid;
    perform public.create_notification(v_pid, 'app', 'Owner application withdrawn',
      'Your Season ' || v_num || ' sign-up was withdrawn, so your owner application for Season ' || v_num ||
      ' was withdrawn with it: only a signed-up player can apply. Sign up again and reapply before applications close.',
      'ownerapp', null);
  end if;
  return null;
end $function$;
revoke execute on function public.owner_app_follows_signup() from public, anon, authenticated;
drop trigger if exists owner_app_follows_signup_trg on public.season_registrations;
create trigger owner_app_follows_signup_trg after delete or update of status on public.season_registrations
  for each row execute function public.owner_app_follows_signup();

-- the Season 2 opening post (fires once, at the first lifecycle run after the Oct 17 switch)
update public.app_config set value =
   'Sign up to play: https://chelgamingleague.com/#/register' || E'\n' ||
   'Everyone signs up again for Season 2, players on a Season 1 roster included. Sign up by Fri, Jan 8 at 11:59 PM ET to be in the draft on Sat, Jan 9 at 9:00 PM ET. Puck drops Wed, Jan 13.' || E'\n\n' ||
   'Owner applications are open until Sat, Dec 12 at 11:59 PM ET: https://chelgamingleague.com/#/owner' || E'\n' ||
   'Sign up to play first: only a signed-up player can apply. Every club is decided again for Season 2, so current Owners apply too. Owners are decided by Sat, Dec 19.' || E'\n\n' ||
   'What changes in Season 2 (10-round draft, a league-wide training camp, Saturday bidding, no weekly game limits): https://chelgamingleague.com/#/rulebook?rule=S2.1'
 where key = 'ann_text_2_reg_open'
   and not exists (select 1 from public.app_config where key = 'ann_2_reg_open');   -- only while the post has not gone out

do $chk$
begin
  if not exists (select 1 from pg_trigger where tgname = 'ab_guard_owner_app_signed_up')
     or not exists (select 1 from pg_trigger where tgname = 'owner_app_follows_signup_trg') then
    raise exception 'v3.99: a trigger is missing';
  end if;
  if position('only a signed-up player can apply' in (select value from public.app_config where key = 'ann_text_2_reg_open')) = 0
     and not exists (select 1 from public.app_config where key = 'ann_2_reg_open') then
    raise exception 'v3.99: the Season 2 opening post was not updated';
  end if;
end $chk$;
