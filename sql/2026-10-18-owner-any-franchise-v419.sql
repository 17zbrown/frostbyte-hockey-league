-- v4.19: owner applications may name any NHL franchise, and a new club waits for a commissioner's go-ahead.
-- Commissioner, 2026-10-18: "Allow people filling out owner applications to pick from any team in the NHL. If a the
-- review board staff all vote on an application, do not automatically create the team until a commissioner gives the
-- go ahead." This reverses the v3.96 ruling (2026-10-13) that applicants choose only among the league's current clubs.
--
-- (a) Picks. guard_owner_app_picks checked each pick against public.teams. It now accepts any of the thirty-two (32)
--     public.nhl_franchises (the reference table the site's CG.NHL_FRANCHISES mirrors name for name; the self-check
--     below pins the list), or a current club's own name (a rebranded club stays selectable).
-- (b) The go-ahead. "All vote" is the existing ballot rule (resolve_application_if_ready: more than half of all the
--     reviewers, v3.68 Q47, a standing ruling). Since v3.96 an approval never creates a club: _owner_app_autoplace finds
--     no club, flags the commissioners and returns null, so the application stays approved with nothing created. That
--     is now the HOLD, derived rather than a new status: approved, awarded an NHL franchise, and no CGHL club by that
--     name (public._owner_app_held_club). The hold gets its own wording everywhere it surfaces (the commissioners'
--     flag, the applicant's notice, the review board's award, admit and choose-club replies), a place in the decision
--     watchdog and the Staff Desk count, and one door out: public.office_found_owner_club(application, division),
--     commissioner only, which creates the club from public.nhl_franchises and seats the applicant through the existing
--     _owner_app_autoplace and _set_team_seat. It refuses unless the application's season is the current one, so a club
--     can never appear in Season 1 (current_season_id() becomes Season 2 when Season 1 is marked complete, before owner
--     decisions on Dec 12 to 19). Discord follows on its own: the next discord-sync sweep gives any new teams row its
--     role and room, which is what Rule 2.6 promises; nothing here posts.
--     Unchanged on purpose: handing over a club the league already has (the v3.96 reapply handover, a ruling) still
--     happens on approval; the ballot rule; the application statuses.
--
-- REHEARSAL on production, 2026-10-18, in ONE do-block ending in an uncaught raise; verified rolled back (no new
-- function, 8 clubs, Season 1 active, the applicant's picks as they were). The first run's self-check caught that four
-- Season 1 approvals from July and August for withdrawn clubs (COL, MTL, TBL, VGK) read as held, and a go-ahead on one
-- would have created a club inside Season 1, so the hold is limited to a season still 'upcoming'. The second run hit
-- contracts_one_active: seating the Owner gives them a Season 2 roster spot and contract, which needs Season 1's
-- contracts closed. The automatic rollover after Season 1's final does that (Season 2 build, due Dec 1, not built yet);
-- the existing handover of a current club depends on the same step. The third run modeled it and passed:
--   Season 1 withdrawn-club approvals held: 0
--   a member names the Toronto Maple Leafs: accepted; "Quebec Nordiques": refused ("is not an NHL franchise")
--   choosing Toronto before approval: "would be a new club: it is added only when a commissioner gives the go-ahead"
--   the board's vote approves (applications closed): approved, held on the Toronto Maple Leafs, no TOR club, the
--     commissioners flagged "New club awaits your go-ahead", the applicant told it waits for the go-ahead, Staff Desk 1
--   a reviewer's go-ahead: refused ("Only a commissioner"); the commissioner's while Season 1 is current: refused
--   Season 1 completes and its contracts close (modeled): current season 2; division "North": refused
--   the go-ahead, "east": the Toronto Maple Leafs (TOR, East, #00205b, founded Season 2) with the applicant as Owner,
--     "You now own the Toronto Maple Leafs", an admin_audit row, a Season 2 roster spot; no longer held
--   a second go-ahead: refused ("not waiting for a go-ahead")
-- Applied as migration v419_owner_any_franchise.

-- does a CGHL club go by this name (its "city name", or its name alone)
create or replace function public._owner_club_exists(p_name text) returns boolean
  language sql stable set search_path to '' as $f$
  select exists (select 1 from public.teams t
                  where lower(btrim(concat_ws(' ', nullif(btrim(t.city), ''), t.name))) = lower(btrim(p_name))
                     or lower(btrim(t.name)) = lower(btrim(p_name)))
$f$;
-- the franchise an approved owner application is held on, waiting for a commissioner's go-ahead; null when not held.
-- Only for a season that has not started: Season 1 still carries four approvals from July and August for clubs that
-- were withdrawn before the season (COL, MTL, TBL, VGK). Those are history, never a go-ahead (the rehearsal's self-check
-- caught them), and no club is added to a season already being played.
create or replace function public._owner_app_held_club(p_app uuid) returns text
  language sql stable set search_path to '' as $f$
  select f.franchise from public.owner_applications a
    join public.seasons s on s.id = a.season_id and s.status = 'upcoming'
    join public.nhl_franchises f on lower(f.franchise) = lower(btrim(a.awarded_club))
   where a.id = p_app and a.status = 'approved' and not public._owner_club_exists(a.awarded_club)
$f$;
revoke all on function public._owner_club_exists(text) from public, anon, authenticated;
revoke all on function public._owner_app_held_club(uuid) from public, anon, authenticated;

-- (a) any NHL franchise may be picked
create or replace function public.guard_owner_app_picks() returns trigger
  language plpgsql security definer set search_path to '' as $f$
/* v4.19 (commissioner, 2026-10-18): "Allow people filling out owner applications to pick from any team in the NHL."
   A pick is one of the thirty-two NHL franchises (public.nhl_franchises), or a current club's own name. This replaces
   v3.96's "current clubs only" (2026-10-13). A commissioner may record anything. */
declare v_bad text;
begin
  if public.is_commissioner() then return new; end if;
  if tg_op = 'UPDATE' and new.preferred_club is not distinct from old.preferred_club
     and new.franchise_2 is not distinct from old.franchise_2 and new.franchise_3 is not distinct from old.franchise_3 then
    return new;
  end if;
  select string_agg(p, ', ') into v_bad
    from unnest(array[new.preferred_club, new.franchise_2, new.franchise_3]) p
   where nullif(btrim(p), '') is not null
     and not exists (select 1 from public.nhl_franchises f where lower(f.franchise) = lower(btrim(p)))
     and not public._owner_club_exists(p);
  if v_bad is not null then
    raise exception '% is not an NHL franchise. Choose from the thirty-two (32) NHL franchises.', v_bad using errcode = '22023';
  end if;
  return new;
end $f$;

-- (b) the go-ahead: the one door that creates a club from an owner application
create or replace function public.office_found_owner_club(p_app uuid, p_division text) returns jsonb
  language plpgsql security definer set search_path to '' as $f$
/* v4.19 (commissioner, 2026-10-18): "do not automatically create the team until a commissioner gives the go ahead."
   The commissioner's go-ahead for an owner application the review board approved for an NHL franchise the league does
   not field yet: the club is created from public.nhl_franchises (code, city, name, primary color; the second color,
   logo and EA club are set afterwards in the Control Center) in the division the commissioner chooses, and the
   applicant is seated as its Owner through _owner_app_autoplace and _set_team_seat. All of it or none of it. */
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
  select * into v_prof from public.profiles where id = v_app.profile_id;
  if v_prof.role in ('staff', 'commissioner') then
    raise exception 'The applicant holds a league-office role and cannot take a club seat (Rule 2.7). Sort that first.' using errcode = '22023';
  end if;
  if public.is_banned(v_prof.id) then
    raise exception 'The applicant is banned and cannot take a club seat.' using errcode = '22023';
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
  select number into v_snum from public.seasons where id = v_app.season_id;
  select id into v_league from public.leagues order by tier, sort_order limit 1;

  insert into public.teams (code, name, city, division, color, founded_season, league_id)
    values (v_f.code, v_f.club_name, v_f.city, v_div, v_f.color, v_snum, v_league);
  v_placed := public._owner_app_autoplace(p_app);
  if v_placed is null then
    raise exception 'The applicant could not be seated, so the % was not created. The commissioners have been told why.', v_club
      using errcode = '22023';
  end if;
  perform public.log_admin_action('owner_club_founded', 'owner_application', p_app::text,
    jsonb_build_object('club', v_club, 'code', v_f.code, 'division', v_div, 'season', v_snum, 'owner', v_prof.id));
  return jsonb_build_object('ok', true, 'placed', v_placed,
    'message', 'The ' || v_club || ' join the league in the ' || v_div || ' division, and ' ||
               coalesce(nullif(v_prof.gamertag, ''), v_prof.display_name, 'the applicant') || ' is their Owner. ' ||
               'Set their second color, logo and EA club in the Control Center; their Discord role and room follow within minutes.');
end $f$;
revoke all on function public.office_found_owner_club(uuid, text) from public, anon;
grant execute on function public.office_found_owner_club(uuid, text) to authenticated;

-- the decision watchdog names held applications too (reporting only)
create or replace function public.owner_decision_watch() returns integer
  language plpgsql security definer set search_path to 'public' as $f$
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

-- the hold's wording wherever it surfaces (anchored text patches, each asserted to match exactly once)
do $p$
declare
  v_fn regprocedure[] := array['public._owner_app_autoplace(uuid)', 'public.apply_application_decision(text,uuid,boolean)',
    'public.decide_owner_application(uuid,boolean,text)', 'public.set_owner_app_club(uuid,text)', 'public.set_owner_app_club(uuid,text)',
    'public.waitlist_admit(text,uuid)', 'public._staff_attention()']::regprocedure[];
  v_a text[] := array[
-- 1 _owner_app_autoplace: the hold
$q$  if not found then
    -- v3.96: an application never founds a club; the league office adds new clubs itself
    perform public.notify_commissioners(null, 'flag', 'Approved owner chose a club that does not exist',
      v_who || ' was approved for "' || pick || '", which is not a CGHL club. New clubs are added by the league office; '||
      'add it first, or choose another of their picks.', 'admin', 'clubs');
    return null;
  end if;$q$,
-- 2 apply_application_decision: the applicant's notice
$q$        case when p_approve then 'The reviewer vote approved your application to own a club. A commissioner will hand you your club shortly.'$q$,
-- 3 decide_owner_application: the applicant's notice
$q$  elsif p_approve then
    v_note := 'Your application to own a club was approved. A commissioner will hand you your club shortly.';$q$,
-- 4 set_owner_app_club: approved and held
$q$    return jsonb_build_object('ok', false, 'awarded', v_club, 'placed', null,
      'message', 'Saved, but the club could not be created — the commissioners have been told why.');$q$,
-- 5 set_owner_app_club: chosen before approval
$q$                    else 'The ' || v_club || ' is handed over when this application is approved.' end);$q$,
-- 6 waitlist_admit: admitted and held
$q$    if v_placed is null then
      return jsonb_build_object('ok', false, 'placed', null, 'message',
        'Approved, but the club could not be handed over — the commissioners have been told why.');
    end if;$q$,
-- 7 _staff_attention: the count
$q$    'pending_owner_apps', (select count(*) from owner_applications where status='pending'),$q$];
  v_b text[] := array[
-- 1
$q$  if not found then
    -- v3.96: an application never founds a club; the league office adds new clubs itself.
    /* v4.19 (commissioner, 2026-10-18): "do not automatically create the team until a commissioner gives the go ahead."
       An approval for an NHL franchise the league does not field yet is HELD: nothing is created, and the commissioners
       are asked for the go-ahead (public.office_found_owner_club, the one door that creates a club from an application). */
    if exists (select 1 from public.nhl_franchises f where lower(f.franchise) = lower(pick)) then
      perform public.notify_commissioners(null, 'flag', 'New club awaits your go-ahead',
        v_who || ' was approved for the ' || pick || ', which is not yet a CGHL club. Nothing was created. Open their application '||
        'to give the go-ahead, which adds the club and seats them as its Owner, or choose another of their picks.', 'admin', 'clubs');
    else
      perform public.notify_commissioners(null, 'flag', 'Approved owner chose a club that does not exist',
        v_who || ' was approved for "' || pick || '", which is neither a CGHL club nor an NHL franchise. Choose another of their picks.', 'admin', 'clubs');
    end if;
    return null;
  end if;$q$,
-- 2
$q$        case when p_approve and public._owner_app_held_club(p_id) is not null
               then 'The reviewer vote approved your application. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
                    || 'it is added, and you are seated as its Owner, once a commissioner gives the go-ahead. You will be told the moment it is yours.'
             when p_approve then 'The reviewer vote approved your application to own a club. A commissioner will hand you your club shortly.'$q$,
-- 3
$q$  elsif p_approve and public._owner_app_held_club(p_id) is not null then
    /* v4.19: held for a commissioner's go-ahead */
    v_note := 'Your application to own a club was approved. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
              || 'it is added, and you are seated as its Owner, once a commissioner gives the go-ahead.';
  elsif p_approve then
    v_note := 'Your application to own a club was approved. A commissioner will hand you your club shortly.';$q$,
-- 4
$q$    /* v4.19: a new club waits for a commissioner's go-ahead; that is the intended outcome, not a failure */
    if public._owner_app_held_club(p_id) is not null then
      return jsonb_build_object('ok', true, 'held', true, 'awarded', v_club, 'placed', null,
        'message', 'Saved. The ' || v_club || ' would be a new club, so it waits for a commissioner''s go-ahead.');
    end if;
    return jsonb_build_object('ok', false, 'awarded', v_club, 'placed', null,
      'message', 'Saved, but the club could not be handed over. The commissioners have been told why.');$q$,
-- 5
$q$                    when not public._owner_club_exists(v_club)
                    then 'The ' || v_club || ' would be a new club: it is added only when a commissioner gives the go-ahead after this application is approved.'
                    else 'The ' || v_club || ' is handed over when this application is approved.' end);$q$,
-- 6
$q$    if v_placed is null then
      /* v4.19: admitted for a new club, which waits for a commissioner's go-ahead */
      if public._owner_app_held_club(p_id) is not null then
        return jsonb_build_object('ok', true, 'held', true, 'placed', null, 'message',
          'Approved. The ' || public._owner_app_held_club(p_id) || ' would be a new club, so it waits for a commissioner''s go-ahead.');
      end if;
      return jsonb_build_object('ok', false, 'placed', null, 'message',
        'Approved, but the club could not be handed over. The commissioners have been told why.');
    end if;$q$,
-- 7
$q$    'pending_owner_apps', (select count(*) from owner_applications where status='pending'),
    /* v4.19: approved for a new club, waiting for a commissioner's go-ahead */
    'owner_apps_awaiting_go_ahead', (select count(*) from owner_applications a where public._owner_app_held_club(a.id) is not null),$q$];
  v_def text; v_n int; i int;
begin
  for i in 1 .. array_length(v_fn, 1) loop
    v_def := pg_get_functiondef(v_fn[i]);
    v_n := (length(v_def) - length(replace(v_def, v_a[i], ''))) / length(v_a[i]);
    if v_n <> 1 then raise exception 'patch % (%): anchor found % times', i, v_fn[i], v_n; end if;
    execute replace(v_def, v_a[i], v_b[i]);
  end loop;
end $p$;

-- self-checks
do $c$
declare v_names text;
begin
  select string_agg(franchise, '|' order by franchise) into v_names from public.nhl_franchises;
  if v_names is distinct from 'Anaheim Ducks|Boston Bruins|Buffalo Sabres|Calgary Flames|Carolina Hurricanes|Chicago Blackhawks|Colorado Avalanche|Columbus Blue Jackets|Dallas Stars|Detroit Red Wings|Edmonton Oilers|Florida Panthers|Los Angeles Kings|Minnesota Wild|Montreal Canadiens|Nashville Predators|New Jersey Devils|New York Islanders|New York Rangers|Ottawa Senators|Philadelphia Flyers|Pittsburgh Penguins|San Jose Sharks|Seattle Kraken|St. Louis Blues|Tampa Bay Lightning|Toronto Maple Leafs|Utah Mammoth|Vancouver Canucks|Vegas Golden Knights|Washington Capitals|Winnipeg Jets' then
    raise exception 'self-check: public.nhl_franchises differs from the list the site mirrors (CG.NHL_FRANCHISES): %', v_names;
  end if;
  if exists (select 1 from public.nhl_franchises where franchise <> concat_ws(' ', city, club_name)) then
    raise exception 'self-check: a franchise name is not its city and club name, so a founded club would not match its pick';
  end if;
  if position('is not a CGHL club' in pg_get_functiondef('public.guard_owner_app_picks()'::regprocedure)) > 0
     or position('public.nhl_franchises' in pg_get_functiondef('public.guard_owner_app_picks()'::regprocedure)) = 0 then
    raise exception 'self-check: the pick guard still reads only the current clubs';
  end if;
  if position('insert into public.teams' in pg_get_functiondef('public._owner_app_autoplace(uuid)'::regprocedure)) > 0 then
    raise exception 'self-check: an approval would create a club by itself';
  end if;
  if position('New club awaits your go-ahead' in pg_get_functiondef('public._owner_app_autoplace(uuid)'::regprocedure)) = 0 then
    raise exception 'self-check: the hold is not flagged';
  end if;
  if exists (select 1 from public.owner_applications a where public._owner_app_held_club(a.id) is not null) then
    raise exception 'self-check: an application is already held (there should be none before the Dec 12 close)';
  end if;
  if has_function_privilege('anon', 'public.office_found_owner_club(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.office_found_owner_club(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._owner_app_held_club(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._owner_club_exists(text)', 'EXECUTE') then
    raise exception 'self-check: grants are wrong';
  end if;
end $c$;
