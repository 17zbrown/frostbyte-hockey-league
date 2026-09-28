-- v3.51 (part 2 of the suspension overhaul): issuing, extending and telling.
-- Applied after the engine (sql/2026-09-28-suspensions-v351-engine.sql). See that file's header for
-- the commissioner's rulings of 2026-09-28 this implements.

/* ONE definition of every rule about issuing discipline. suspend_player (the Moderation card) and
   discipline_from_case (a ruling on a case) are thin doors onto it. Before v3.51 the two doors held
   their own copies, and the community 3, 6 or 9 scale lived only on the first, so a community
   moderator ruling from a case could issue any 1 to 10 games or 30 days in free prose. */
create or replace function public._issue_suspension(
  p_profile uuid, p_mode text, p_games integer, p_ends_at timestamptz, p_until_season integer,
  p_reason text, p_codes text[], p_scope text, p_keep_length boolean, p_request uuid)
 returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_uid uuid := auth.uid(); v_commish boolean; v_off boolean; v_com boolean; v_comonly boolean;
        v_role text; v_gt text; v_scope text; v_text text; v_bad text; v_team uuid; v_season uuid;
        v_snum int; v_mode text := p_mode; v_until int := p_until_season; v_end timestamptz;
        v_auto boolean := false; v_venue text; v_id uuid; v_depts text[];
begin
  v_commish := public.is_commissioner();
  v_off := public.has_department('officiating');
  v_com := public.has_department('community');
  v_comonly := v_com and not (v_commish or v_off);
  if not (v_commish or v_off or v_com) then
    raise exception 'Only a commissioner, the officiating department or the community department can discipline members.';
  end if;
  if p_profile is null then raise exception 'Pick the member.'; end if;
  if v_mode not in ('warning','date','games','seasons') then raise exception 'Pick a discipline type.'; end if;
  select role::text, coalesce(gamertag, display_name, 'This member') into v_role, v_gt
    from public.profiles where id = p_profile;
  if v_role is null then raise exception 'That member no longer exists.'; end if;

  /* who may discipline whom (Rule 7.2; commissioner, 2026-09-28: "Make sure it is only possible
     commissioners can suspend staff") */
  if not v_commish then
    if p_profile = v_uid then
      raise exception 'You can''t rule on yourself. A commissioner has to.';
    end if;
    if v_role in ('staff','commissioner') then
      raise exception 'Only a commissioner can discipline a member of league staff or a commissioner (Rule 7.2).';
    end if;
  end if;
  v_scope := coalesce(nullif(btrim(p_scope),''),'play');
  if v_scope not in ('play','staff','both') then raise exception 'Unknown suspension scope: %', v_scope; end if;
  if v_scope <> 'play' and v_mode <> 'warning' and not (v_commish and v_role in ('staff','commissioner')) then
    raise exception 'A suspension from staff duties is a commissioner ruling, and only for a member of league staff.';
  end if;

  /* the grounds */
  if p_codes is not null then
    select string_agg(c, ', ') into v_bad from unnest(p_codes) c
     where c not in (select code from public.conduct_reasons());
    if v_bad is not null then raise exception 'Not a conduct heading: %', v_bad; end if;
  end if;
  v_text := case when coalesce(array_length(p_codes,1),0) > 0
                 then public.conduct_reason_text(p_codes, p_reason)
                 else nullif(btrim(p_reason),'') end;
  if v_comonly then
    if coalesce(array_length(p_codes,1),0) = 0 then
      raise exception 'Pick at least one heading: what was it about the chat that broke the rules?';
    end if;
    if 'other' = any(p_codes) and coalesce(btrim(p_reason),'') = '' then
      raise exception '"Other" says nothing on its own. Write what happened.';
    end if;
  end if;
  if v_mode <> 'warning' and coalesce(btrim(v_text),'') = '' then
    raise exception 'Say why. A suspension has to state its grounds: the member has 48 hours to appeal them (Rule 7.6).';
  end if;

  v_season := public.current_season_id();
  select number into v_snum from public.seasons where id = v_season;
  select rs.team_id into v_team from public.roster_spots rs
   where rs.profile_id = p_profile and rs.season_id = v_season and rs.status = 'active' limit 1;

  if v_mode <> 'warning' then
    /* one suspension at a time. A further offense while one runs extends it (commissioner,
       2026-09-28): the lineup lock makes a second, overlapping suspension meaningless. */
    if exists (select 1 from public.suspensions s
                where s.profile_id = p_profile and s.status = 'active' and s.mode <> 'warning'
                  and public.suspension_running_at(s, now())) then
      raise exception '% is already suspended. Extend the suspension he is serving instead of issuing a new one (Rule 7.2).', v_gt;
    end if;
    /* a second suspension in the same season runs for the rest of the season, unless the official
       issuing it keeps the length he chose (commissioner, 2026-09-28) */
    if not coalesce(p_keep_length,false)
       and exists (select 1 from public.suspensions s
                    where s.profile_id = p_profile and s.mode <> 'warning'
                      and s.status in ('active','served') and s.season_id = v_season) then
      v_mode := 'seasons'; v_until := v_snum; v_auto := true;
    end if;
  end if;

  if v_mode = 'games' then
    if v_team is null then
      raise exception '% has no roster spot this season, so a suspension counted in games could never be served. Suspend him to a date instead (Rule 7.2).', v_gt;
    end if;
    if coalesce(p_games,0) < 1 then raise exception 'Enter how many games.'; end if;
    if not v_commish and (p_games % 3 <> 0 or p_games > 18) then
      raise exception 'Staff issue suspensions in steps of three games, up to 18 (3, 6, 9, 12, 15 or 18). Anything longer, or a ban, goes to the commissioner''s office (Rule 7.2).';
    end if;
  elsif v_mode = 'date' then
    if p_ends_at is null then raise exception 'Pick the last day of the suspension.'; end if;
    /* it ends at 11:59 PM Eastern on its last day (commissioner, 2026-09-28) */
    v_end := (((p_ends_at at time zone 'America/New_York')::date + time '23:59:59') at time zone 'America/New_York');
    if v_end <= now() then raise exception 'That last day has already passed.'; end if;
    if not v_commish then
      if v_end > now() + interval '31 days' then
        raise exception 'Staff can suspend to a date up to 30 days away. Anything longer goes to the commissioner''s office (Rule 7.2).';
      end if;
      if v_comonly and v_team is not null then
        raise exception '% is on a roster, so a community suspension is counted in games (3 to 18). A date is for a member with no roster spot (Rule 7.2).', v_gt;
      end if;
    end if;
  elsif v_mode = 'seasons' then
    if not v_commish and not v_auto then
      raise exception 'A season-long suspension is a commissioner ruling. Issue a shorter one, or escalate.';
    end if;
    if v_until is null then raise exception 'Pick the final season.'; end if;
  end if;

  v_venue := case when coalesce(array_length(p_codes,1),0) > 0 or v_comonly then 'discord' else 'ice' end;
  insert into public.suspensions(profile_id, reason, reason_codes, mode, ends_at, games_total, team_id,
                                 start_game_count, season_id, status, created_by, until_season, request_id,
                                 scope, venue)
    values (p_profile, v_text, nullif(p_codes,'{}'), v_mode,
            case when v_mode = 'date' then v_end end,
            case when v_mode = 'games' then p_games end,
            v_team, null, v_season, 'active', v_uid,
            case when v_mode = 'seasons' then v_until end, p_request,
            case when v_mode = 'warning' then 'play' else v_scope end, v_venue)
    returning id into v_id;
  select departments into v_depts from public.profiles where id = v_uid;
  perform public.log_admin_action(case when v_mode='warning' then 'warning_issued' else 'suspension_issued' end,
    'suspension', v_id::text,
    jsonb_build_object('profile',p_profile,'mode',v_mode,'games',p_games,'ends_at',v_end,'until_season',v_until,
                       'scope',v_scope,'venue',v_venue,'reason',v_text,'codes',to_jsonb(coalesce(p_codes,'{}'::text[])),
                       'second_in_season_rest_of_season',v_auto,'request',p_request,
                       'issuer_departments',to_jsonb(coalesce(v_depts,'{}'::text[]))));
  return v_id;
end $fn$;
revoke all on function public._issue_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,boolean,uuid) from public, anon, authenticated;

drop function if exists public.suspend_player(uuid,text,timestamptz,integer,text,text[]);
create function public.suspend_player(p_profile uuid, p_mode text, p_ends_at timestamptz, p_games integer,
  p_reason text, p_codes text[] default null, p_scope text default 'play', p_keep_length boolean default false)
 returns uuid language plpgsql security definer set search_path to 'public' as $fn$
begin
  return public._issue_suspension(p_profile, p_mode, p_games, p_ends_at, null, p_reason, p_codes,
                                  p_scope, p_keep_length, null);
end $fn$;
revoke all on function public.suspend_player(uuid,text,timestamptz,integer,text,text[],text,boolean) from public, anon;
grant execute on function public.suspend_player(uuid,text,timestamptz,integer,text,text[],text,boolean) to authenticated, service_role;

drop function if exists public.discipline_from_case(uuid,uuid,text,integer,timestamptz,integer,text);
create function public.discipline_from_case(p_request uuid, p_profile uuid, p_mode text,
  p_games integer default null, p_ends_at timestamptz default null, p_until_season integer default null,
  p_reason text default null, p_codes text[] default null, p_scope text default 'play',
  p_keep_length boolean default false)
 returns uuid language plpgsql security definer set search_path to 'public' as $fn$
declare v_target uuid; v_filer uuid; v_id uuid; s public.suspensions; v_len text;
begin
  select target_profile_id, profile_id into v_target, v_filer from public.action_requests where id = p_request;
  if not found then raise exception 'That case no longer exists.'; end if;
  if not public.is_commissioner()
     and (v_target = auth.uid() or v_filer = auth.uid() or p_profile = auth.uid()) then
    raise exception 'This case involves you. A commissioner has to rule on it.';
  end if;
  v_id := public._issue_suspension(p_profile, p_mode, p_games, p_ends_at, p_until_season, p_reason, p_codes,
                                   p_scope, p_keep_length, p_request);
  select * into s from public.suspensions where id = v_id;
  v_len := case s.mode when 'warning' then 'a formal warning'
    when 'games' then s.games_total||'-game suspension'
    when 'seasons' then 'a suspension for the rest of Season '||s.until_season
    else 'a suspension through '||to_char(s.ends_at at time zone 'America/New_York','Mon DD')||' (11:59 PM ET)' end;
  update public.action_requests
     set status='resolved', assigned_to=coalesce(assigned_to, auth.uid()),
         response = coalesce(nullif(response,'')||E'\n','')||'Ruling: '||v_len||coalesce('. '||s.reason,'')||'.',
         updated_at=now()
   where id = p_request;
  insert into public.action_messages(request_id, author_id, body, internal)
    values (p_request, auth.uid(), 'Discipline issued: '||v_len||coalesce('. '||s.reason,'')||'.', false);
  perform public.log_admin_action('discipline_from_case','suspension',v_id::text,
    jsonb_build_object('profile',p_profile,'mode',s.mode,'request',p_request));
  return v_id;
end $fn$;
revoke all on function public.discipline_from_case(uuid,uuid,text,integer,timestamptz,integer,text,text[],text,boolean) from public, anon;
grant execute on function public.discipline_from_case(uuid,uuid,text,integer,timestamptz,integer,text,text[],text,boolean) to authenticated, service_role;

/* A further offense while a suspension runs is added to the end of it (commissioner, 2026-09-28:
   "that player can receive an extra set of games tacked onto the end of their current suspension"). */
create or replace function public.extend_suspension(p_id uuid, p_games integer default null,
  p_days integer default null, p_reason text default null)
 returns void language plpgsql security definer set search_path to 'public' as $fn$
declare s public.suspensions; v_commish boolean; v_off boolean; v_com boolean; v_role text; v_gt text; v_new timestamptz; v_what text;
begin
  v_commish := public.is_commissioner(); v_off := public.has_department('officiating'); v_com := public.has_department('community');
  if not (v_commish or v_off or v_com) then
    raise exception 'Only a commissioner, the officiating department or the community department can extend a suspension.';
  end if;
  select * into s from public.suspensions where id = p_id for update;
  if s.id is null then raise exception 'That suspension no longer exists.'; end if;
  if s.status <> 'active' or not public.suspension_running_at(s, now()) then
    raise exception 'That suspension is not running any more. Issue a new one instead.';
  end if;
  select role::text, coalesce(gamertag, display_name, 'He') into v_role, v_gt from public.profiles where id = s.profile_id;
  if not v_commish then
    if s.profile_id = auth.uid() then raise exception 'You can''t rule on yourself.'; end if;
    if v_role in ('staff','commissioner') then
      raise exception 'Only a commissioner can discipline a member of league staff or a commissioner (Rule 7.2).';
    end if;
    if v_com and not v_off and coalesce(s.venue,'ice') <> 'discord' then
      raise exception 'This suspension is for conduct on the ice. The officiating department extends it.';
    end if;
  end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Say why it is being extended.'; end if;
  if s.mode = 'games' then
    if coalesce(p_games,0) < 1 then raise exception 'Enter how many games to add.'; end if;
    if not v_commish and (p_games % 3 <> 0 or s.games_total + p_games > 18) then
      raise exception 'Staff extend in steps of three games, to a total of 18 at most. Anything longer goes to the commissioner''s office (Rule 7.2).';
    end if;
    update public.suspensions set games_total = games_total + p_games,
           reason = reason||E'\nExtended by '||p_games||' games: '||btrim(p_reason) where id = p_id;
    v_what := p_games||' more game'||case when p_games=1 then '' else 's' end;
  elsif s.mode = 'date' then
    if coalesce(p_days,0) < 1 then raise exception 'Enter how many days to add.'; end if;
    v_new := ((((s.ends_at at time zone 'America/New_York')::date + p_days) + time '23:59:59') at time zone 'America/New_York');
    if not v_commish and v_new > now() + interval '31 days' then
      raise exception 'Staff can suspend to a date up to 30 days away. Anything longer goes to the commissioner''s office (Rule 7.2).';
    end if;
    update public.suspensions set ends_at = v_new,
           reason = reason||E'\nExtended by '||p_days||' days: '||btrim(p_reason) where id = p_id;
    v_what := p_days||' more day'||case when p_days=1 then '' else 's' end||', through '||
              to_char(v_new at time zone 'America/New_York','Mon DD')||' at 11:59 PM ET';
  else
    raise exception 'A suspension for the rest of a season cannot be extended by staff. A commissioner rules on it.';
  end if;
  perform public.create_notification(s.profile_id, 'flag', 'Your suspension has been extended',
    'It now runs '||v_what||'. Reason: '||btrim(p_reason)||'. You may appeal within 48 hours (Rule 7.6).', 'rulebook', null);
  perform public.notify_staff_ch('casework', '**Suspension extended**: '||v_gt||', '||v_what||'. Reason: '||btrim(p_reason)||'.', false);
  perform public.log_admin_action('suspension_extended','suspension',p_id::text,
    jsonb_build_object('profile',s.profile_id,'games',p_games,'days',p_days,'reason',p_reason));
end $fn$;
revoke all on function public.extend_suspension(uuid,integer,integer,text) from public, anon;
grant execute on function public.extend_suspension(uuid,integer,integer,text) to authenticated, service_role;

/* When a playing suspension is issued, the player is taken off every lineup and line his club has
   filed for games not yet played, and the club is told once. From then on the lineup guards refuse
   him, and he is locked where he is on the roster until it is served (commissioner, 2026-09-28). */
create or replace function public.pull_suspended_from_lineups()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_games int := 0; v_lines int := 0; v_team uuid; v_gt text; n int;
begin
  if new.status <> 'active' or new.mode = 'warning' or new.scope not in ('play','both') then return null; end if;
  select coalesce(gamertag, display_name, 'A player') into v_gt from public.profiles where id = new.profile_id;
  update public.game_lineups gl set
      center = nullif(center, new.profile_id), lw = nullif(lw, new.profile_id), rw = nullif(rw, new.profile_id),
      ld = nullif(ld, new.profile_id), rd = nullif(rd, new.profile_id), goalie = nullif(goalie, new.profile_id),
      updated_at = now()
   where new.profile_id in (gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie)
     and exists (select 1 from public.games g where g.id = gl.game_id
                  and g.status::text <> 'final' and coalesce(g.scheduled_at, now()) > now());
  get diagnostics v_games = row_count;
  update public.team_lines tl set
      center = nullif(center, new.profile_id), lw = nullif(lw, new.profile_id), rw = nullif(rw, new.profile_id),
      ld = nullif(ld, new.profile_id), rd = nullif(rd, new.profile_id), goalie = nullif(goalie, new.profile_id),
      updated_at = now()
   where new.profile_id in (tl.center, tl.lw, tl.rw, tl.ld, tl.rd, tl.goalie)
     and tl.season_id = public.current_season_id();
  get diagnostics v_lines = row_count;
  select rs.team_id into v_team from public.roster_spots rs
   where rs.profile_id = new.profile_id and rs.season_id = public.current_season_id() limit 1;
  if v_team is not null then
    perform public.club_notify(v_team, 'flag', v_gt||' is suspended',
      v_gt||' may not be scheduled or play until his suspension is served, and he is locked where he is on '||
      'your roster: he cannot be called up or sent down meanwhile (Rule 7.2).'||
      case when v_games + v_lines > 0
           then ' He was taken off '||v_games||' filed game lineup'||case when v_games=1 then '' else 's' end||
                ' and '||v_lines||' saved line'||case when v_lines=1 then '' else 's' end||'. Refile those games.'
           else '' end,
      null, 'manager', null, null, false);
  end if;
  return null;
end $fn$;
revoke all on function public.pull_suspended_from_lineups() from public, anon, authenticated;
drop trigger if exists trg_pull_suspended_from_lineups on public.suspensions;
create trigger trg_pull_suspended_from_lineups after insert on public.suspensions
  for each row execute function public.pull_suspended_from_lineups();

-- APPLIED 2026-09-28 behind a scenario battery (rolled back after): T1 an official's 4-game suspension
-- refused; T2 staff suspending staff refused; T3 a 6-game suspension pulled the player off every
-- future lineup; T4 a lineup refused him even from a commissioner; T5 an overlapping suspension
-- refused; T6 extension to 12 accepted, past 18 refused; T7 his own club's non-commissioner manager
-- could not move him between roster and camp; T8 twelve served games two days ago: no longer
-- suspended, and the marker served it (but still suspended on the night of his last game); T9 a
-- second suspension in the season became the rest of the season, and keep_length kept 3 games;
-- T10 community: heading required, no date for a rostered player, venue discord; T11 a staff-scope
-- suspension switched off has_department and is_staff but did not bar play; T12 a dated suspension
-- ends at 23:59:59 ET. The battery's first run caught "cannot cast type record to suspensions" in
-- extend_suspension: a PL/pgSQL record cannot be passed where a typed row is required, so every
-- function that hands a suspension to suspension_running_at declares it as public.suspensions.
