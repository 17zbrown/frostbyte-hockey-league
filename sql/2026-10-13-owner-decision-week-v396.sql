-- v3.96 (2026-10-13): the owner decision week, and no club founded by an application.
--
-- Commissioner, 2026-10-13: "Staff will reapprove everyone by the deadline for assigning owners." and "If we add
-- expansion clubs, we will do that manually as needed."
--
-- 1. Applicants choose among the league's CURRENT clubs. A pick that is not a CGHL club is refused where it is entered,
--    and _owner_app_autoplace no longer founds a club from a pick (it used to, from nhl_franchises): a new club is added
--    by the league office, and only then can it be chosen.
-- 2. In a season whose owners all reapply (app_config owners_reapply_<n> = 'on', set for Season 2), an approval hands
--    the club over: the applicant takes the seat through _set_team_seat (which vacates any other seat he holds, keeps
--    the previous Owner on his roster spot and tells him), unless the club was already awarded to someone approved for
--    that season. A sitting Owner approved for his own club simply keeps it.
-- 3. Ballots cast while applications were open resolve once they close: cron owner-app-resolve runs the existing
--    resolver every 15 minutes (it does nothing for an application whose season is still open, v3.95).
-- 4. The decision deadline (app_config owner_decision_by_<n>, Dec 19 for Season 2) is watched: two days before it and at
--    it, the commissioners and the applications department are told which owner applications are still pending and
--    which clubs' Owners have not been confirmed for the season. Nothing is vacated automatically.

insert into public.app_config (key, value) values ('owners_reapply_2', 'on')
  on conflict (key) do update set value = excluded.value;

-- 1. picks must be current clubs ---------------------------------------------------------------------------------------
create or replace function public.guard_owner_app_picks()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_bad text; v_list text;
begin
  if public.is_commissioner() then return new; end if;
  if tg_op = 'UPDATE' and new.preferred_club is not distinct from old.preferred_club
     and new.franchise_2 is not distinct from old.franchise_2 and new.franchise_3 is not distinct from old.franchise_3 then
    return new;
  end if;
  select string_agg(p, ', ') into v_bad
    from unnest(array[new.preferred_club, new.franchise_2, new.franchise_3]) p
   where nullif(btrim(p), '') is not null
     and not exists (select 1 from public.teams t
                      where lower(btrim(concat_ws(' ', nullif(btrim(t.city), ''), t.name))) = lower(btrim(p))
                         or lower(btrim(t.name)) = lower(btrim(p)));
  if v_bad is not null then
    select string_agg(concat_ws(' ', nullif(btrim(city), ''), name), ', ' order by 1) into v_list from public.teams;
    raise exception '% is not a CGHL club. Choose from the league''s clubs: %. New clubs are added by the league office.', v_bad, v_list
      using errcode = '22023';
  end if;
  return new;
end $function$;
revoke execute on function public.guard_owner_app_picks() from public, anon, authenticated;
drop trigger if exists guard_owner_app_picks_trg on public.owner_applications;
create trigger guard_owner_app_picks_trg before insert or update on public.owner_applications
  for each row execute function public.guard_owner_app_picks();

-- 2. placing an approved owner ---------------------------------------------------------------------------------------
create or replace function public._owner_app_autoplace(p_app uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_app record; v_prof record; t record;
  pick text; v_who text; v_reapply boolean; v_holder text; v_label text; v_owned uuid; v_taken text;
begin
  select * into v_app from public.owner_applications where id = p_app;
  if not found then return null; end if;
  select * into v_prof from public.profiles where id = v_app.profile_id;
  if not found then return null; end if;
  v_who := coalesce(nullif(v_prof.gamertag,''), v_prof.display_name, 'An approved owner');
  /* v3.96: in a season whose owners all reapply, an approval may hand a club over */
  v_reapply := coalesce((select a.value from public.app_config a, public.seasons s
                          where s.id = v_app.season_id and a.key = 'owners_reapply_' || s.number), '') = 'on';

  -- the league office can't hold a club seat (Rule 2.7)
  if v_prof.role in ('staff','commissioner') then
    perform public.notify_commissioners(null, 'flag', 'Approved owner is in the league office',
      v_who || ' was approved to own a club, but they hold a league-office role and can''t take a club seat. '||
      'Sort the role conflict first, then choose their club again.', 'admin', 'clubs');
    return null;
  end if;

  pick := nullif(btrim(coalesce(v_app.awarded_club,'')), '');
  select id into v_owned from public.teams where owner_profile_id = v_prof.id limit 1;
  if v_owned is not null and not v_reapply then return null; end if;   -- an owner who already runs a club keeps it

  if pick is null then
    perform public.notify_commissioners(null, 'flag', 'Approved owner has no club chosen',
      v_who || ' was approved before the review board chose one of their three picks, so no club was assigned. ' ||
      'Open their application and choose one; it is handed over straight away.', 'admin', 'clubs');
    return null;
  end if;
  if lower(pick) not in (lower(btrim(coalesce(v_app.preferred_club,''))),
                         lower(btrim(coalesce(v_app.franchise_2,''))),
                         lower(btrim(coalesce(v_app.franchise_3,'')))) then
    perform public.notify_commissioners(null, 'flag', 'Awarded club is not one of the applicant''s picks',
      v_who || ' has "' || pick || '" recorded as their awarded club, which is not one of the three they applied for. '||
      'Nothing was changed. Check the application.', 'admin', 'clubs');
    return null;
  end if;

  select * into t from public.teams
   where lower(btrim(concat_ws(' ', nullif(btrim(city),''), name))) = lower(pick) or lower(btrim(name)) = lower(pick)
   order by (lower(btrim(concat_ws(' ', nullif(btrim(city),''), name))) = lower(pick)) desc
   limit 1 for update;
  if not found then
    -- v3.96: an application never founds a club; the league office adds new clubs itself
    perform public.notify_commissioners(null, 'flag', 'Approved owner chose a club that does not exist',
      v_who || ' was approved for "' || pick || '", which is not a CGHL club. New clubs are added by the league office; '||
      'add it first, or choose another of their picks.', 'admin', 'clubs');
    return null;
  end if;
  v_label := concat_ws(' ', nullif(btrim(t.city),''), t.name);

  if t.owner_profile_id = v_prof.id then
    return t.code;                                   -- confirmed in the seat he already holds
  end if;

  if t.owner_profile_id is not null then
    if not v_reapply then
      perform public.notify_commissioners(null, 'flag', 'Approved owner needs a club',
        v_who || ' was approved for the ' || pick || ', but the ' || pick || ' already have an owner. Choose a different one of their picks, or assign them a club manually.',
        'admin', 'clubs');
      return null;
    end if;
    -- already awarded this season to the Owner who holds it now
    select coalesce(nullif(p.gamertag,''), p.display_name) into v_taken
      from public.owner_applications a2 join public.profiles p on p.id = a2.profile_id
     where a2.season_id = v_app.season_id and a2.id <> v_app.id and a2.status = 'approved'
       and lower(btrim(coalesce(a2.awarded_club,''))) = lower(pick) and a2.profile_id = t.owner_profile_id
     limit 1;
    if v_taken is not null then
      perform public.notify_commissioners(null, 'flag', 'Club already awarded this season',
        v_who || ' was approved for the ' || v_label || ', but it was already awarded to ' || v_taken ||
        ' for this season. Choose another of their picks.', 'admin', 'clubs');
      return null;
    end if;
    select coalesce(nullif(gamertag,''), display_name) into v_holder from public.profiles where id = t.owner_profile_id;
  end if;

  -- the seat moves through the one door that handles seats: other seats he holds are vacated, the previous Owner keeps
  -- his roster spot and is told, the transaction is recorded
  perform public._set_team_seat(t.id, 'owner', v_prof.id, 'office');
  if v_holder is not null then
    perform public.notify_commissioners(null, 'flag', 'Club handed over',
      'The ' || v_label || ' passed from ' || v_holder || ' to ' || v_who || ' on an approved owner application for the season.', 'admin', 'clubs');
  end if;
  perform public.create_notification(v_prof.id, 'role', 'You now own the ' || v_label,
    'Your owner application was approved and the club is yours. Open Team HQ to name your GM and build the roster.', 'manager', null);
  return t.code;
end $function$;
revoke execute on function public._owner_app_autoplace(uuid) from public, anon, authenticated;

-- set_owner_app_club refused a member who already owns a club; in a reapply season he may be awarded his own or another
do $p$
declare v_def text := pg_get_functiondef('public.set_owner_app_club(uuid,text)'::regprocedure);
        a text := '  if exists (select 1 from public.teams where owner_profile_id = v_app.profile_id) then';
        b text := '  if exists (select 1 from public.teams where owner_profile_id = v_app.profile_id)
     and coalesce((select c.value from public.app_config c, public.seasons s
                    where s.id = v_app.season_id and c.key = ''owners_reapply_'' || s.number), '''') <> ''on'' then   -- v3.96';
        c text := '''The '' || v_club || '' will be created when this application is approved.''';
        d text := '''The '' || v_club || '' is handed over when this application is approved.''';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1
     or (length(v_def) - length(replace(v_def, c, ''))) / length(c) <> 1 then raise exception 'v3.96: set_owner_app_club anchors'; end if;
  execute replace(replace(v_def, a, b), c, d);
end $p$;

-- 3. ballots resolve once applications close -----------------------------------------------------------------------------
select cron.unschedule('owner-app-resolve') where exists (select 1 from cron.job where jobname = 'owner-app-resolve');
select cron.schedule('owner-app-resolve', '*/15 * * * *', 'select public.resolve_all_pending_applications()');

-- 4. the decision deadline is watched ---------------------------------------------------------------------------------
create or replace function public.owner_decision_watch()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s record; v_by timestamptz; v_kind text; v_pend text; v_unconf text; v_sent int := 0;
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
    if v_pend is null and v_unconf is null then continue; end if;
    perform public.notify_commissioners(null, 'flag',
      case v_kind when 'due' then 'Owner decisions are due now' else 'Owner decisions are due in two days' end,
      coalesce(s.name, 'The season') || ': every owner application is decided by ' ||
      to_char(v_by at time zone 'America/New_York', 'FMDy FMMon FMDD, FMHH12:MI AM') || ' ET.' ||
      coalesce(' Still pending: ' || v_pend || '.', '') ||
      coalesce(' Clubs whose Owner is not yet approved for the season: ' || v_unconf || '.', ''), 'admin', 'clubs');
    perform public.notify_department('applications', 'flag',
      case v_kind when 'due' then 'Owner decisions are due now' else 'Owner decisions are due in two days' end,
      ltrim(coalesce('Still pending: ' || v_pend || '. ', '') || coalesce('Clubs not yet confirmed: ' || v_unconf || '.', '')), 'staffdesk', null);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $function$;
revoke execute on function public.owner_decision_watch() from public, anon, authenticated;
select cron.unschedule('owner-decision-watch') where exists (select 1 from cron.job where jobname = 'owner-decision-watch');
select cron.schedule('owner-decision-watch', '7 * * * *', 'select public.owner_decision_watch()');

do $chk$
begin
  if position('never founds a club' in pg_get_functiondef('public._owner_app_autoplace(uuid)'::regprocedure)) = 0 then
    raise exception 'v3.96: autoplace still founds clubs';
  end if;
  if (select count(*) from cron.job where jobname in ('owner-app-resolve','owner-decision-watch')) <> 2 then
    raise exception 'v3.96: a cron job is missing';
  end if;
end $chk$;
