-- v4.19b: gates on the commissioner's go-ahead (v4.19), found by the completeness review before the release shipped.
-- The go-ahead now refuses, with the reason, when:
--   * the applicant's sign-up for the season is gone (v3.99: only a member signed up for the season may own a club;
--     withdrawing a sign-up withdraws only a PENDING application, so a held approval outlives it), or the applicant
--     has left the league Discord, or is serving a suspension;
--   * the season has not been started (start_next_season, the rollover, writes season_owner_baseline). Before it runs
--     the applicant still holds their Season 1 contract, and seating them would turn it into the new club's
--     management deal (ensure_manager_rostered moves an active contract whatever its season);
--   * the season's draft order or schedule is already built: a club added then would have no picks and no games;
--   * the awarded club is not one of the applicant's three picks (checked BEFORE the insert, so the reason is real:
--     the old message said the commissioners had been told why, but that notice rolled back with everything else).
-- Also: waitlist_admit sends the applicant's notice itself, held wording included (it fell through to the generic
-- trigger text); the staff bell for a new owner application names the picks (team_choice is 'random' on every row);
-- owner_decision_watch runs with search_path '' (every name in it was already qualified).
-- A founded club starts with no second color; the go-ahead says so and the commissioner sets it in Clubs.
-- shortcut: no second color from the reference, revisit if go-aheads become common (add nhl_franchises.color2).
-- Nothing here posts to Discord.
--
-- REHEARSAL on production, 2026-10-18, in ONE do-block ending in an uncaught raise (rolled back), with v4.19 live and
-- the real season start this time (start_next_season, which expires earlier player contracts and writes the baseline):
--   held on the Toronto Maple Leafs after the board's approval (applications closed inside the rehearsal)
--   Season 1 complete, go-ahead before the season start: refused ("Start Season 2 first")
--   start_next_season(S2) ran (8 baseline rows); then, each in a rolled-back sub-block:
--     sign-up declined: refused ("no longer signed up for Season 2"); out of the Discord: refused; a Season 2 draft
--     pick present: refused ("draft order or schedule is already built")
--   go-ahead, West: the Toronto Maple Leafs, the applicant their Owner, a Season 2 roster spot, and their one active
--     contract is the club's management deal (their Season 1 player deal was closed by the season start)
-- Applied as migration v419b_owner_go_ahead_gates.

create or replace function public.office_found_owner_club(p_app uuid, p_division text) returns jsonb
  language plpgsql security definer set search_path to '' as $f$
/* v4.19 (commissioner, 2026-10-18): "do not automatically create the team until a commissioner gives the go ahead."
   The commissioner's go-ahead for an owner application the review board approved for an NHL franchise the league does
   not field yet: the club is created from public.nhl_franchises (code, city, name, primary color; the second color,
   logo and EA club are set afterwards in the Control Center) in the division the commissioner chooses, and the
   applicant is seated as its Owner through _owner_app_autoplace and _set_team_seat. All of it or none of it.
   v4.19b: eligibility is re-checked at appointment (Rule 2.6), and the go-ahead waits for the season's start and
   refuses once its draft order or schedule exists. */
declare v_app record; v_prof record; v_f record; v_club text; v_snum int; v_league uuid; v_placed text; v_div text;
begin
  if not public.is_commissioner() then
    raise exception 'Only a commissioner gives the go-ahead for a new club.' using errcode = '42501';
  end if;
  select * into v_app from public.owner_applications where id = p_app for update;
  if v_app.id is null then raise exception 'Application not found.' using errcode = 'P0002'; end if;
  v_club := public._owner_app_held_club(p_app);
  if v_club is null then
    raise exception 'That application is not waiting for a go-ahead. It must be approved, with an NHL franchise the league does not field yet as its club.'
      using errcode = '22023';
  end if;
  if v_app.season_id is distinct from public.current_season_id() then
    raise exception 'A new club joins the season being set up, and this application is for a later season. Give the go-ahead once the season before it is complete.'
      using errcode = '22023';
  end if;
  select number into v_snum from public.seasons where id = v_app.season_id;
  if not exists (select 1 from public.season_owner_baseline b where b.season_id = v_app.season_id) then
    raise exception 'Start Season % first (the season start closes the previous season''s contracts), then give the go-ahead.', v_snum
      using errcode = '22023';
  end if;
  if exists (select 1 from public.draft_picks dp where dp.season_number = v_snum)
     or exists (select 1 from public.games g where g.season_id = v_app.season_id) then
    raise exception 'Season %''s draft order or schedule is already built, so a club added now would have no picks and no games. Clear them first, then give the go-ahead.', v_snum
      using errcode = '22023';
  end if;
  select * into v_prof from public.profiles where id = v_app.profile_id;
  if v_prof.role in ('staff', 'commissioner') then
    raise exception 'The applicant holds a league-office role and cannot take a club seat (Rule 2.7). Sort that first.' using errcode = '22023';
  end if;
  if public.is_banned(v_prof.id) then
    raise exception 'The applicant is banned and cannot take a club seat.' using errcode = '22023';
  end if;
  if public.is_suspended(v_prof.id) then
    raise exception 'The applicant is serving a suspension. Give the go-ahead once it is served, or decide the application again.' using errcode = '22023';
  end if;
  if not coalesce(v_prof.in_guild, false) then
    raise exception 'The applicant is not in the league Discord, so they cannot run a club (Rule 1.1).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.season_registrations r
                  where r.profile_id = v_app.profile_id and r.season_id = v_app.season_id and r.status <> 'declined') then
    raise exception 'The applicant is no longer signed up for Season %, and only a member signed up for the season may own a club (Rule 2.6).', v_snum
      using errcode = '22023';
  end if;
  if lower(v_club) not in (lower(btrim(coalesce(v_app.preferred_club, ''))), lower(btrim(coalesce(v_app.franchise_2, ''))),
                           lower(btrim(coalesce(v_app.franchise_3, '')))) then
    raise exception 'The % is not one of the three franchises this applicant asked for. Choose their club again.', v_club using errcode = '22023';
  end if;
  select d.name into v_div from public.divisions d where lower(d.name) = lower(btrim(coalesce(p_division, '')));
  if v_div is null then
    raise exception 'Choose the new club''s division: %.', (select string_agg(name, ' or ' order by sort_order, name) from public.divisions)
      using errcode = '22023';
  end if;
  select * into v_f from public.nhl_franchises where lower(franchise) = lower(v_club);
  if exists (select 1 from public.teams where upper(code) = upper(v_f.code)) then
    raise exception 'A club with the code % already exists, so the % cannot be added under it. Check the Clubs page.', v_f.code, v_club
      using errcode = '23505';
  end if;
  select id into v_league from public.leagues order by tier, sort_order limit 1;

  insert into public.teams (code, name, city, division, color, founded_season, league_id)
    values (v_f.code, v_f.club_name, v_f.city, v_div, v_f.color, v_snum, v_league);
  v_placed := public._owner_app_autoplace(p_app);
  if v_placed is null then
    -- every reason _owner_app_autoplace returns null for is checked above, so this is a fault, not a refusal
    raise exception 'The applicant could not be seated as the %''s Owner, so the club was not created. Nothing changed.', v_club
      using errcode = 'P0001';
  end if;
  perform public.log_admin_action('owner_club_founded', 'owner_application', p_app::text,
    jsonb_build_object('club', v_club, 'code', v_f.code, 'division', v_div, 'season', v_snum, 'owner', v_prof.id));
  return jsonb_build_object('ok', true, 'placed', v_placed,
    'message', 'The ' || v_club || ' join the league in the ' || v_div || ' division, and ' ||
               coalesce(nullif(v_prof.gamertag, ''), v_prof.display_name, 'the applicant') || ' is their Owner. ' ||
               'Set their second color, logo and EA club in Clubs; their Discord role and room follow within minutes. ' ||
               'They need a General Manager approved before the draft.');
end $f$;

create or replace function public.owner_decision_watch() returns integer
  language plpgsql security definer set search_path to '' as $f$
declare s record; v_by timestamptz; v_kind text; v_pend text; v_unconf text; v_held text; v_sent int := 0;
begin
  insert into public.app_config (key, value)
    values ('rl_owner-decision-watch', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict (key) do update set value = excluded.value;
  for s in select * from public.seasons where status <> 'complete' and owner_app_deadline is not null loop
    v_by := (select value from public.app_config where key = 'owner_decision_by_' || s.number)::timestamptz;
    if v_by is null or now() < s.owner_app_deadline then continue; end if;
    v_kind := case when now() >= v_by then 'due' when now() >= v_by - interval '2 days' then 'two_days' else null end;
    if v_kind is null then continue; end if;
    if exists (select 1 from public.app_config where key = 'owner_decision_alert_' || s.number || '_' || v_kind) then continue; end if;
    insert into public.app_config (key, value) values ('owner_decision_alert_' || s.number || '_' || v_kind, now()::text);
    select string_agg(coalesce(nullif(p.gamertag,''), p.display_name, 'a member'), ', ' order by 1) into v_pend
      from public.owner_applications a join public.profiles p on p.id = a.profile_id
     where a.season_id = s.id and a.status = 'pending';
    select string_agg(t.code, ', ' order by t.code) into v_unconf
      from public.teams t
     where t.owner_profile_id is null
        or not exists (select 1 from public.owner_applications a where a.season_id = s.id and a.status = 'approved'
                        and a.profile_id = t.owner_profile_id);
    /* v4.19: an approval held for a new club is neither pending nor a club, so it is named on its own */
    select string_agg(public._owner_app_held_club(a.id) || ' (' || coalesce(nullif(p.gamertag,''), p.display_name, 'a member') || ')', ', ' order by 1) into v_held
      from public.owner_applications a join public.profiles p on p.id = a.profile_id
     where a.season_id = s.id and public._owner_app_held_club(a.id) is not null;
    if v_pend is null and v_unconf is null and v_held is null then continue; end if;
    perform public.notify_commissioners(null, 'flag',
      case v_kind when 'due' then 'Owner decisions are due now' else 'Owner decisions are due in two days' end,
      coalesce(s.name, 'The season') || ': every owner application is decided by ' ||
      to_char(v_by at time zone 'America/New_York', 'FMDy FMMon FMDD, FMHH12:MI AM') || ' ET.' ||
      coalesce(' Still pending: ' || v_pend || '.', '') ||
      coalesce(' New clubs awaiting your go-ahead: ' || v_held || '.', '') ||
      coalesce(' Clubs whose Owner is not yet approved for the season: ' || v_unconf || '.', ''), 'admin', 'clubs');
    perform public.notify_department('applications', 'flag',
      case v_kind when 'due' then 'Owner decisions are due now' else 'Owner decisions are due in two days' end,
      ltrim(coalesce('Still pending: ' || v_pend || '. ', '') || coalesce('New clubs awaiting the commissioner: ' || v_held || '. ', '') ||
            coalesce('Clubs not yet confirmed: ' || v_unconf || '.', '')), 'staffdesk', null);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $f$;

do $p$
declare
  v_fn regprocedure[] := array['public.waitlist_admit(text,uuid)', 'public.notify_owner_application()']::regprocedure[];
  v_a text[] := array[
-- 1 waitlist_admit: the applicant's notice
$q$    perform set_config('app.app_decide', 'on', true);
    update public.owner_applications
       set status = 'approved', decided_at = now(), decided_by = auth.uid(), updated_at = now()
     where id = p_id;
    perform set_config('app.app_decide', 'off', true);

    v_placed := public._owner_app_autoplace(p_id);$q$,
-- 2 notify_owner_application: name the picks
$q$  v_club := case new.team_choice
    when 'build' then 'a new franchise'||coalesce(' — '||nullif(new.proposed_name,''),'')
    when 'random' then 'any available club'
    else coalesce(nullif(new.proposed_name,''),'—') end;$q$];
  v_b text[] := array[
-- 1
$q$    perform set_config('app.app_decide', 'on', true);
    perform set_config('app.owner_notice', 'rpc', true);   -- v4.19b: this function sends the applicant's notice itself
    update public.owner_applications
       set status = 'approved', decided_at = now(), decided_by = auth.uid(), updated_at = now()
     where id = p_id;
    perform set_config('app.owner_notice', '', true);
    perform set_config('app.app_decide', 'off', true);

    v_placed := public._owner_app_autoplace(p_id);
    /* v4.19b: a placed owner hears from _owner_app_autoplace ("You now own the ..."); otherwise the applicant is told the
       go-ahead a new club waits for, or that a commissioner will hand them their club */
    if v_placed is null then
      perform public.create_notification(v_app.profile_id, 'flag', 'Owner application approved',
        case when public._owner_app_held_club(p_id) is not null
             then 'You were admitted from the waitlist. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
                  || 'it is added, and you are seated as its Owner, once a commissioner gives the go-ahead.'
             else 'You were admitted from the waitlist. A commissioner will hand you your club shortly.' end, null, null);
    end if;$q$,
-- 2
$q$  /* v4.19b: name the picks (any NHL franchise may be named, and team_choice is 'random' on every application) */
  v_club := coalesce('one of: ' || nullif(concat_ws(', ', nullif(btrim(new.preferred_club),''), nullif(btrim(new.franchise_2),''),
                                                          nullif(btrim(new.franchise_3),'')), ''), 'a club');$q$];
  v_def text; v_n int; i int;
begin
  for i in 1 .. array_length(v_fn, 1) loop
    v_def := pg_get_functiondef(v_fn[i]);
    v_n := (length(v_def) - length(replace(v_def, v_a[i], ''))) / length(v_a[i]);
    if v_n <> 1 then raise exception 'patch % (%): anchor found % times', i, v_fn[i], v_n; end if;
    execute replace(v_def, v_a[i], v_b[i]);
  end loop;
  -- self-checks
  if position('season_owner_baseline' in pg_get_functiondef('public.office_found_owner_club(uuid,text)'::regprocedure)) = 0
     or position('season_registrations' in pg_get_functiondef('public.office_found_owner_club(uuid,text)'::regprocedure)) = 0
     or position('have been told why' in pg_get_functiondef('public.office_found_owner_club(uuid,text)'::regprocedure)) > 0 then
    raise exception 'self-check: the go-ahead gates are missing';
  end if;
  if position('app.owner_notice' in pg_get_functiondef('public.waitlist_admit(text,uuid)'::regprocedure)) = 0 then
    raise exception 'self-check: waitlist_admit still leaves the applicant notice to the trigger';
  end if;
  if has_function_privilege('anon', 'public.office_found_owner_club(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.office_found_owner_club(uuid,text)', 'EXECUTE') then
    raise exception 'self-check: the go-ahead grants changed';
  end if;
end $p$;
