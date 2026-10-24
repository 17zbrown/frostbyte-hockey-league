-- v4.30 (2026-10-24): staying out of the league Discord past the 24-hour window now brings a suspension for the rest of
-- the current season and all of the next one (Rules 1.1 and 7.2).
-- Commissioner, 2026-10-24: "Can you automatically suspend a player for the remainder of the season + through the next
-- season when they are removed from their roster because of being out of the league discord for 24 hours?"
-- Rulings the same day: from now on only (nobody already removed is suspended, and the warning that starts the 24 hours
-- must say a suspension follows); "They can join back freely, but are still suspended and need to appeal to lift their
-- suspension if the appeal is passed."; a pending sign-up withdrawn for leaving the Discord is covered too; Owners, GMs
-- and AGMs stay a manual decision; it is announced through the club's removal notice, the site's public suspension
-- record and the member's own site notice, with no new public Discord post.
--
-- Before: sweep_roster_departures (Rule 1.1, v3.11, v3.50) removed a rostered player when the club's 24-hour window
-- closed, and remove_departed_signups (v2.21, reinstated v2.47) withdrew an unplaced player's sign-up a day after the
-- census saw them go, with no warning at all. Neither suspended anyone, and the member was told to "sign up again any
-- time". Neither function had a full record in sql/: both were text patches, so this file writes both out in full.
-- After:
--   1. public._suspend_for_departure is the one door for the Rule 1.1 suspension: mode 'seasons', until the current
--      season's number + 1 while a season is under way, or the number of the season about to begin between seasons
--      (current_season_id(), the one definition; commissioner, 2026-10-24: "Through Season 2 only"), scope play,
--      grounds 'departure', created_by null.
--      It is not _issue_suspension: that door is a ruling by a person (it refuses a caller with no auth.uid(), refuses a
--      second running suspension, and cuts a second suspension in a season down to the current season unless
--      p_keep_length). This is the enforce_unsigned_contracts (Rule 2.5) pattern: a straight insert, and the triggers on
--      suspensions do the rest. public._departure_suspension_exempt names who is never suspended this way.
--   2. sweep_roster_departures: the club's notice warns of the suspension and marks itself (suspension_warned). When a
--      marked window closes, the removal also suspends. A notice written before v4.30 is not marked and suspends nobody.
--   3. remove_departed_signups: per row and fail loud, like the roster sweep since v3.50. It WARNS first (a site notice
--      with the deadline, recorded in signup_departure_notices), then withdraws and suspends when that notice's window
--      closes. A player on a roster of a season not yet complete is left to the roster sweep. It now returns
--      (action, profile_id, gamertag, detail), so it is DROP + CREATE and its grants are set again; the Edge
--      discord-sync job reads the new rows. Deploy the Edge job BEFORE applying this file.
--   4. notify_suspension words a departure suspension its own way (no DM, since the member has left the server; appeal
--      on the site any time while it runs), lift_suspension's notice fits a member with no club, and suspension_record
--      exposes the grounds so the public record is headed "Left the league Discord (Rule 1.1)".
--   5. Fixed on the way: _remove_for_discipline filtered seasons on status 'completed', a label season_status does not
--      have (upcoming, active, complete), so the filter was always true. Once Season 1 completes, every season-long
--      suspension or ban would also have taken completed-season roster spots and sign-ups. It now reads
--      s.status <> 'complete', with no ::text cast, so a wrong label raises instead of passing.

-- 0) the markers ----------------------------------------------------------------------------------------------------
/* the grounds of an automatic suspension, read by notify_suspension, lift_suspension and (through suspension_record) the
   site's public record. Only 'departure' so far; an abandonment ruling keeps its action_requests link. */
alter table public.suspensions add column grounds text;
alter table public.suspensions add constraint suspensions_grounds_check check (grounds is null or grounds = 'departure');

/* a club notice written with the v4.30 warning. Rows written before v4.30 stay false: those players were warned with the
   old text, so they are removed as before and never suspended (commissioner, 2026-10-24: from now on only). */
alter table public.roster_departure_notices add column suspension_warned boolean not null default false;

/* the warning an UNPLACED member gets on the site when they leave: one row per member, rewritten for each departure. A
   notice belongs to the current departure while notified_at >= the census's last_seen, which is stamped when the member
   is seen to go (discord-sync trackDepartures, bot onMemberRemove) and again whenever they come back. Only SECURITY
   DEFINER sweeps touch it; the member reads the warning in their notifications. */
create table public.signup_departure_notices (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  notified_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  constraint signup_departure_notices_pkey primary key (profile_id)
);
alter table public.signup_departure_notices enable row level security;
revoke all on table public.signup_departure_notices from public, anon, authenticated;

-- 1) the one door -----------------------------------------------------------------------------------------------------
create or replace function public._departure_suspension_exempt(p_profile uuid)
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  /* v4.30: whom Rule 1.1 never suspends automatically (Rules 1.1 and 7.2): a banned member (the ban already removes
     them), a commissioner (referred to the commissioners, Rule 1.1) and the holder of a club seat (Owner, General
     Manager or Assistant General Manager: the league office rules on them directly, commissioner 2026-10-24). True for
     a profile that no longer exists. */
  select coalesce((select coalesce(p.banned, false) or p.role::text = 'commissioner'
                     from public.profiles p where p.id = p_profile), true)
      or exists (select 1 from public.teams t
                  where p_profile in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id));
$function$;
revoke all on function public._departure_suspension_exempt(uuid) from public, anon, authenticated;

create or replace function public._departure_suspension_until()
 returns integer
 language sql
 stable
 set search_path to ''
as $function$
  /* v4.30: the season a Rule 1.1 suspension issued now runs through, the ONE definition the door and both warnings
     read (review 2026-10-24: the warnings said "the rest of this season and all of next season" while the door gave
     the upcoming season only between seasons). While a season is under way (status active): the next one. Between
     seasons, when current_season_id() is the season about to begin: that season only (commissioner, 2026-10-24,
     "Through Season 2 only"). Null when there is no current season, which the door turns into an error. */
  select s.number + case when s.status = 'active' then 1 else 0 end
    from public.seasons s where s.id = public.current_season_id();
$function$;
revoke all on function public._departure_suspension_until() from public, anon, authenticated;

create or replace function public._suspend_for_departure(p_profile uuid, p_reason text)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v4.30 (commissioner, 2026-10-24): "Can you automatically suspend a player for the remainder of the season + through
   the next season when they are removed from their roster because of being out of the league discord for 24 hours?"
   and "They can join back freely, but are still suspended and need to appeal to lift their suspension if the appeal is
   passed."
   The one door for the Rule 1.1 suspension. Called by sweep_roster_departures (a rostered player removed when the
   club's window closed) and remove_departed_signups (a sign-up withdrawn when the site notice's window closed), each
   only for a departure whose warning said a suspension follows. Returns the season the member is now suspended
   through, or null when Rule 1.1 never suspends them.
   - The length: the rest of the current season and all of the next (until = current_season_id()'s number + 1, the
     one definition of the current season). Between seasons current_season_id() is the season about to begin, and the
     member misses that season only (until = its number): commissioner, 2026-10-24, asked how long a suspension is for
     a member who leaves between seasons, chose "Through Season 2 only" over two full seasons.
   - The triggers on suspensions do the rest: notify_suspension (the member's site notice; no DM for grounds
     'departure'), suspension_removes_for_season_trg (_remove_for_discipline: every roster spot, seat, contract and
     sign-up of a season not complete, and the member is told), pull_suspended_from_lineups, the live pulse.
   - created_by stays null: nobody ruled on it, and the site shows "League office".
   - Idempotent: a member already suspended through that season or later (by this rule or any other) is not suspended
     again, so the two sweeps can never stack two of these on one departure. A shorter suspension already running is
     left as it is and this one runs beside it as its own record with its own appeal (the exception in paragraph 4 of
     Rule 7.2): converting the running one would leave nothing to appeal if it was appealed already (link_appeal allows
     one appeal per suspension). */
declare v_season uuid; v_until int; v_have int; v_id uuid;
begin
  if p_profile is null or coalesce(btrim(p_reason), '') = '' then
    raise exception 'Rule 1.1 suspension: the member and the grounds are both required.';
  end if;
  if public._departure_suspension_exempt(p_profile) then return null; end if;
  v_season := public.current_season_id();
  v_until := public._departure_suspension_until();   /* under way: this one and the next; between seasons: the next */
  if v_season is null or v_until is null then
    raise exception 'Rule 1.1 suspension: there is no current season to count from.';
  end if;
  select max(coalesce(x.until_season, 2147483647)) into v_have from public.suspensions x
   where x.profile_id = p_profile and x.status = 'active' and x.mode = 'seasons' and x.scope in ('play', 'both')
     and public.suspension_running_at(x, now());
  if v_have >= v_until then return v_have; end if;
  insert into public.suspensions (profile_id, reason, mode, season_id, status, until_season, scope, grounds)
    values (p_profile, btrim(p_reason), 'seasons', v_season, 'active', v_until, 'play', 'departure')
    returning id into v_id;
  perform public.log_admin_action('suspension_issued', 'suspension', v_id::text,
    jsonb_build_object('profile', p_profile, 'mode', 'seasons', 'until_season', v_until, 'scope', 'play',
                       'reason', btrim(p_reason), 'grounds', 'departure', 'automatic', true));
  return v_until;
end $function$;
revoke all on function public._suspend_for_departure(uuid, text) from public, anon, authenticated;

-- 2) the rostered player (Rule 1.1, paragraph 5) ---------------------------------------------------------------------
create or replace function public.sweep_roster_departures(p_grace_hours integer default 24)
 returns table(action text, gamertag text, club text, detail text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* Rule 1.1 (commissioner, 2026-09-24): "send a reminder to their team's channel and @cghl
   management that they left and they have 24 hours to return or their signup is revoked and they
   are removed from the team so the management can reach out themselves."

   The member himself cannot be told: Discord refuses a bot DM to anyone who shares no server with
   it, proven 5 for 5 on this exact population. So the club is told, and the club reaches him.

   THE NOTICE IS THE CLOCK. The window runs from notified_at, never from when the census happened
   to see him go, so nobody is ever removed who was not warned first and given the full window.

   v3.50 (2026-09-28): the sweep had been dead since 2026-09-25 23:49 ET. A player noticed, back
   inside the window, then gone again met his own closed notice on the (profile_id, season_id) key,
   and the 23505 rolled back the whole sweep for everyone on every tick. Two changes:
   1. A second departure REOPENS the notice with a fresh window (the rule is per departure).
   2. Every row runs in its own savepoint. One bad row is reported as action 'error' (which
      discord-sync counts as a failure) and can never again stop the sweep for the rest.
   And a window that closes on a player who is no longer rostered (waived meanwhile) closes the
   notice instead of raising: Rule 1.1.4 handles an unrostered sign-up.

   v4.30 (commissioner, 2026-10-24): "Can you automatically suspend a player for the remainder of
   the season + through the next season when they are removed from their roster because of being
   out of the league discord for 24 hours?" The notice now says a suspension follows and marks
   itself (suspension_warned). When a marked window closes, the removal also suspends the player
   through public._suspend_for_departure, AFTER the roster spot is gone: the suspension fires
   _remove_for_discipline, which then finds nothing left in this season (no second release, no
   second club notice) and withdraws the later seasons' sign-ups. A notice written before v4.30 is
   not marked, so nobody warned with the old text is suspended ("from now on only"). The notice
   text moves to they/them (Writing rules). Moved to search_path '' with every name qualified. */
declare v_grace integer := greatest(coalesce(p_grace_hours,24),0);
        r record; v_link text; v_n int; v_mgr boolean; v_role text; v_until int; v_exempt boolean;
begin
  if not (public.trusted_writer() or public.is_commissioner() or public.is_staff()) then
    raise exception 'NOT_AUTHORIZED: league office only.' using errcode = 'P0001';
  end if;
  select c.value into v_link from public.app_config c where c.key='discord_invite' and coalesce(c.value,'')<>'';
  select (c.value::jsonb)->>'cghl management' into v_role from public.app_config c where c.key='discord_role_ids';

  /* A. give notice */
  for r in
    select rs.profile_id, rs.season_id, rs.team_id, rs.squad, p.gamertag as gt, t.code as tc,
           (p.id in (t.owner_profile_id,t.gm_profile_id,t.agm_profile_id)) as is_mgr
      from public.roster_spots rs
      join public.profiles p on p.id = rs.profile_id
      join public.teams t on t.id = rs.team_id
      join public.seasons s on s.id = rs.season_id and s.status <> 'complete'
     where p.in_guild = false
       and not exists (select 1 from public.guild_members g where g.profile_id = p.id and g.present)
       and not exists (select 1 from public.roster_departure_notices n
                        where n.profile_id = rs.profile_id and n.season_id = rs.season_id
                          and n.removed_at is null and n.rejoined_at is null)
  loop
    begin
      if r.is_mgr then
        perform public.notify_department('operations','flag','A club manager has left the Discord',
          r.gt||' holds a seat on '||r.tc||' and is no longer in the server. A manager is never removed '||
          'automatically, so the league office has to decide this one.','team',r.tc);
        action:='manager_flagged'; gamertag:=r.gt; club:=r.tc; detail:='seat holder, left to the office';
        return next; continue;
      end if;
      /* v4.30 review: a member Rule 1.1 never suspends (a rostered commissioner) is not warned of a suspension, and the
         length is the one the door will give ("through Season N"), read from the same definition */
      v_exempt := public._departure_suspension_exempt(r.profile_id);
      v_until := case when v_exempt then null else public._departure_suspension_until() end;
      insert into public.roster_departure_notices(profile_id, season_id, team_id, deadline_at, suspension_warned)
        values (r.profile_id, r.season_id, r.team_id, now() + make_interval(hours => v_grace), v_until is not null)
      on conflict (profile_id, season_id) do update
        set team_id = excluded.team_id, notified_at = now(), deadline_at = excluded.deadline_at,
            rejoined_at = null, removed_at = null, suspension_warned = excluded.suspension_warned;
      perform public.club_notify(r.team_id, 'flag',
        r.gt||' has left the league Discord',
        r.gt||' is on your '||case when r.squad='tc' then 'training camp' else 'active roster' end||
        ' and is no longer in the server. They have until '||
        to_char((now()+make_interval(hours=>v_grace)) at time zone 'America/New_York','Mon DD, HH12:MI AM')||
        ' ET to rejoin. If they do not, their sign-up is revoked'||
        case when v_until is not null
             then ', they come off your squad, and they are suspended through Season '||v_until||' (Rules 1.1 and 7.2); '||
                  'rejoining after that does not lift the suspension.'
             else ' and they come off your squad (Rule 1.1).' end||
        ' The league cannot message them once they have left the server, so if you can reach them '||
        'any other way, now is the time.'||
        coalesce(' Invite: '||v_link, ''),
        null, 'manager', null, v_role);
      action:='notified'; gamertag:=r.gt; club:=r.tc; detail:=v_grace||'h to rejoin'; return next;
    exception when others then
      action:='error'; gamertag:=r.gt; club:=r.tc; detail:='notice: '||SQLSTATE||' '||SQLERRM; return next;
    end;
  end loop;

  /* B. came back inside the window */
  for r in
    select n.profile_id, n.season_id, n.team_id, p.gamertag as gt, t.code as tc
      from public.roster_departure_notices n
      join public.profiles p on p.id = n.profile_id
      join public.teams t on t.id = n.team_id
     where n.removed_at is null and n.rejoined_at is null
       /* v4.30 review: in_guild is written later in the same discord-sync tick, so a member who rejoined in the last
          minutes before the deadline reads false here; the census row the bot sets on join is the live truth */
       and (p.in_guild = true or exists (select 1 from public.guild_members g where g.profile_id = n.profile_id and g.present))
  loop
    begin
      update public.roster_departure_notices set rejoined_at = now()
       where profile_id = r.profile_id and season_id = r.season_id;
      perform public.club_notify(r.team_id,'check', r.gt||' is back in the Discord',
        r.gt||' rejoined the server before the deadline. Their spot is safe, no suspension follows, and there is nothing to do.',
        null,'manager',null,null);
      action:='rejoined'; gamertag:=r.gt; club:=r.tc; detail:='inside the window'; return next;
    exception when others then
      action:='error'; gamertag:=r.gt; club:=r.tc; detail:='rejoin: '||SQLSTATE||' '||SQLERRM; return next;
    end;
  end loop;

  /* C. the window closed */
  for r in
    select n.profile_id, n.season_id, n.team_id, p.gamertag as gt, t.code as tc, n.deadline_at,
           n.suspension_warned as warned, (s.status = 'complete') as done
      from public.roster_departure_notices n
      join public.profiles p on p.id = n.profile_id
      join public.teams t on t.id = n.team_id
      join public.seasons s on s.id = n.season_id
     where n.removed_at is null and n.rejoined_at is null
       and p.in_guild = false and now() >= n.deadline_at
       and not exists (select 1 from public.guild_members g where g.profile_id = n.profile_id and g.present)   /* v4.30 review: live presence */
  loop
    begin
      select (r.profile_id in (t.owner_profile_id,t.gm_profile_id,t.agm_profile_id)) into v_mgr
        from public.teams t where t.id = r.team_id;
      if coalesce(v_mgr,false) then
        action:='manager_skipped'; gamertag:=r.gt; club:=r.tc; detail:='took a seat since the notice';
        return next; continue;
      end if;
      /* v4.30 review: the window closed after the season was completed (its final ended inside the 24 hours). The
         completed season's roster, sign-ups and transactions are its record and are never rewritten; the suspension the
         notice warned of still follows */
      if r.done then
        update public.roster_departure_notices set removed_at = now()
         where profile_id = r.profile_id and season_id = r.season_id;
        v_until := null;
        if r.warned then
          v_until := public._suspend_for_departure(r.profile_id,
            'Left the league Discord and did not rejoin by the deadline in '||r.tc||'''s notice (Rule 1.1)');
        end if;
        action:='closed'; gamertag:=r.gt; club:=r.tc;
        detail:='season complete, roster kept; '||case when v_until is not null then 'suspended through Season '||v_until else 'not suspended' end;
        return next; continue;
      end if;
      if not exists (select 1 from public.roster_spots rs
                      where rs.profile_id = r.profile_id and rs.season_id = r.season_id) then
        update public.roster_departure_notices set removed_at = now()
         where profile_id = r.profile_id and season_id = r.season_id;
        action:='closed'; gamertag:=r.gt; club:=r.tc; detail:='no longer rostered; Rule 1.1.4 governs their sign-up';
        return next; continue;
      end if;
      perform set_config('app.office_removal','1',true);
      perform set_config('app.mgmt_approved', r.team_id::text, true);
      perform set_config('app.roster_reason','left the league Discord (Rule 1.1)', true);

      insert into public.season_registration_removals(registration_id, profile_id, season_id, gamertag, reason, registration)
      select sr.id, sr.profile_id, sr.season_id, r.gt, 'left_discord', to_jsonb(sr.*)
        from public.season_registrations sr
       where sr.profile_id = r.profile_id and sr.season_id = r.season_id;
      delete from public.season_registrations sr
       where sr.profile_id = r.profile_id and sr.season_id = r.season_id;

      delete from public.roster_spots rs
       where rs.profile_id = r.profile_id and rs.season_id = r.season_id;
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'Rule 1.1 removal touched no roster spot for % (%)', r.gt, r.tc; end if;

      update public.roster_departure_notices set removed_at = now()
       where profile_id = r.profile_id and season_id = r.season_id;

      insert into public.transactions(season_id, type, description)
        values (r.season_id,'waive','<b>'||replace(replace(r.gt,'<',''),'>','')||'</b> was removed from '||r.tc||
                ' after leaving the league Discord (Rule 1.1)');

      /* v4.30: the suspension the notice warned of, only for a notice that warned of it, and only after the spot is
         gone. In the same savepoint as the removal on purpose: a suspension that fails rolls the removal back and the
         row is reported 'error' on every tick until it is fixed, so nobody is removed without the suspension their
         club was told would follow, and nothing is left half done. */
      v_until := null;
      if r.warned then
        v_until := public._suspend_for_departure(r.profile_id,
          'Left the league Discord and did not rejoin by the deadline in '||r.tc||'''s notice (Rule 1.1)');
      end if;

      perform public.club_notify(r.team_id,'flag', r.gt||' has been removed from your squad',
        'The window closed at '||to_char(r.deadline_at at time zone 'America/New_York','Mon DD, HH12:MI AM')||
        ' ET and '||r.gt||' had not rejoined the Discord. Their sign-up is revoked and the spot is free.'||
        case when v_until is not null
             then ' '||r.gt||' is also suspended through Season '||v_until||
                  ' (Rules 1.1 and 7.2); rejoining the server does not lift it.'
             else '' end,
        null,'manager',null,v_role);
      perform public._grant_replacement(r.season_id, r.team_id, r.profile_id, 'they left the league Discord');   -- v3.70 (Q11)
      perform public.log_admin_action('departure_removal','profile',r.profile_id::text,
        jsonb_build_object('player',r.gt,'club',r.tc,'deadline',r.deadline_at,'suspended_through',v_until));
      action:='removed'; gamertag:=r.gt; club:=r.tc;
      detail:='did not return; '||case when v_until is not null then 'suspended through Season '||v_until
                                     when r.warned then 'not suspended (exempt under Rule 1.1)'
                                     else 'not suspended (warned before v4.30)' end;
      return next;
    exception when others then
      action:='error'; gamertag:=r.gt; club:=r.tc; detail:='removal: '||SQLSTATE||' '||SQLERRM; return next;
    end;
  end loop;
end $function$;

-- 3) the unplaced player (Rule 1.1, paragraph 4) ---------------------------------------------------------------------
drop function public.remove_departed_signups(integer);
create function public.remove_departed_signups(p_grace_hours integer default 24)
 returns table(action text, profile_id uuid, gamertag text, detail text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
#variable_conflict use_column
/* A sign-up does not survive leaving the server (v2.21, reinstated v2.47 at the league's direction): registering
   requires being in the Discord, so the list holds the same way on the way out. Pending sign-ups in seasons whose
   registration is open, archived to season_registration_removals (reason left_discord, which also strips a staff role:
   strip_roles_on_departure) before deletion, after a grace window so a kick-and-rejoin or a bad census read never costs
   anyone their sign-up.

   v4.30 (commissioner, 2026-10-24): "Can you automatically suspend a player for the remainder of the season + through
   the next season when they are removed from their roster because of being out of the league discord for 24 hours?",
   with the ruling that a pending sign-up withdrawn for leaving the Discord is covered too, and that "the warning that
   starts the 24 hours must say a suspension follows". Before v4.30 nobody was warned at all: the only notice came after
   the withdrawal. So:
   A. WARN. A member out of the server with a pending sign-up, and no notice for this departure yet, gets a site notice
      with the deadline and the suspension, recorded in signup_departure_notices. THE NOTICE IS THE CLOCK, as in the
      roster sweep. Not warned (and so never suspended here): a member Rule 1.1 never suspends
      (_departure_suspension_exempt), a player on a roster of a season not yet complete or with an open club notice
      (the roster sweep owns them; it runs right after this one in the same tick and its suspension withdraws their
      later sign-ups), and a player whose club notice for this departure was written before v4.30.
   C. WITHDRAW. A warned member is withdrawn when the notice's window closes, and suspended through
      _suspend_for_departure. A member with no notice for this departure (banned, exempt, an old club notice, or a
      warning that failed) is withdrawn on the old clock, a day after the census saw them go, and not suspended.
   One savepoint per row, as in sweep_roster_departures since v3.50: a bad row is reported as action 'error' (which
   discord-sync counts as a failure) and never stops the sweep for everyone else. Before v4.30 this was one statement,
   so a single failure would have rolled back every withdrawal on every tick.
   Returns (action, profile_id, gamertag, detail) with action warned | removed | skipped | error. discord-sync announces
   only 'removed' rows, which is why this changed from (profile_id, gamertag) by DROP + CREATE. */
declare v_grace integer := greatest(coalesce(p_grace_hours, 24), 0);
        r record; v_reg jsonb; v_until int; v_deadline timestamptz; v_warn_until int;
begin
  if not (public.trusted_writer() or public.is_commissioner() or public.is_staff()) then
    raise exception 'NOT_AUTHORIZED: league office only.' using errcode = 'P0001';
  end if;

  /* Start the clock for candidates the census has never recorded: seed a guild_members row
     (present=false, last_seen=now) so the grace window governs them from THIS moment; there is
     no "remove immediately because we have no data" path. On conflict, adopt an orphaned row
     (profile_id nulled by an account switch) rather than clobber another profile's claim.
     A profile with no usable discord_id is never auto-removed. */
  insert into public.guild_members as gm0 (discord_id, profile_id, present, last_seen, first_seen)
  select distinct on (p.discord_id) p.discord_id, p.id, false, now(), now()
    from public.season_registrations sr
    join public.profiles p on p.id = sr.profile_id
    join public.seasons s on s.id = sr.season_id and s.registration_open
   where sr.status = 'pending'
     and p.in_guild = false
     and coalesce(p.discord_id, '') <> ''
     and not exists (select 1 from public.guild_members g where g.profile_id = p.id)
  on conflict (discord_id) do update
    set profile_id = coalesce(gm0.profile_id, excluded.profile_id);

  /* A. warn. A profile can hold several guild_members rows (one per Discord account it has ever been linked to); any
     present row means they are in the server and untouchable here. No clock (no last_seen anywhere) = no notice. */
  v_deadline := now() + make_interval(hours => v_grace);
  v_warn_until := public._departure_suspension_until();   /* the length the door will give, said in the warning */
  for r in
    select distinct on (p.id) p.id as pid, p.gamertag as gt
      from public.season_registrations sr
      join public.profiles p on p.id = sr.profile_id
      join public.seasons s on s.id = sr.season_id and s.registration_open
      left join lateral (
        select max(g.last_seen) as last_seen, bool_or(g.present) as any_present
          from public.guild_members g where g.profile_id = p.id
      ) gm on true
      left join public.signup_departure_notices w on w.profile_id = p.id
     where sr.status = 'pending'
       and p.in_guild = false
       and coalesce(gm.any_present, false) = false
       and gm.last_seen is not null
       and (w.profile_id is null or w.notified_at < gm.last_seen)
       and not public._departure_suspension_exempt(p.id)
       and not exists (select 1 from public.roster_spots rs join public.seasons s2 on s2.id = rs.season_id
                        where rs.profile_id = p.id and s2.status <> 'complete')
       and not exists (select 1 from public.roster_departure_notices n
                        where n.profile_id = p.id
                          and ((n.removed_at is null and n.rejoined_at is null)
                               or (n.notified_at >= gm.last_seen and not n.suspension_warned)))
     order by p.id
  loop
    begin
      insert into public.signup_departure_notices (profile_id, notified_at, deadline_at)
        values (r.pid, now(), v_deadline)
      on conflict on constraint signup_departure_notices_pkey do update
        set notified_at = excluded.notified_at, deadline_at = excluded.deadline_at;
      perform public.create_notification(r.pid, 'discord', 'Rejoin the Discord to keep your sign-up',
        'You are no longer in the Chel Gaming Discord. Rejoin by '||
        to_char(v_deadline at time zone 'America/New_York', 'Mon DD, HH12:MI AM')||
        ' ET, or your season sign-up is withdrawn and you are suspended through Season '||v_warn_until||
        ' (Rules 1.1 and 7.2). Rejoining after that does not lift the suspension; only a granted appeal does.',
        'discord', null);
      action := 'warned'; profile_id := r.pid; gamertag := r.gt;
      detail := 'until '||to_char(v_deadline at time zone 'America/New_York', 'Mon DD, HH12:MI AM')||' ET';
      return next;
    exception when others then
      action := 'error'; profile_id := r.pid; gamertag := r.gt; detail := 'warning: '||SQLSTATE||' '||SQLERRM;
      return next;
    end;
  end loop;

  /* C. withdraw. Never anyone holding a roster spot in a season not yet complete, whatever their registration status
     says, and never anyone with an open club notice: the roster sweep owns them. */
  for r in
    select sr.id as rid, sr.profile_id as pid, s.number as snum, p.gamertag as gt,
           coalesce(p.banned, false) as was_banned, (w.profile_id is not null) as warned
      from public.season_registrations sr
      join public.profiles p on p.id = sr.profile_id
      join public.seasons s on s.id = sr.season_id and s.registration_open
      left join lateral (
        select max(g.last_seen) as last_seen, bool_or(g.present) as any_present
          from public.guild_members g where g.profile_id = p.id
      ) gm on true
      left join public.signup_departure_notices w on w.profile_id = p.id and w.notified_at >= gm.last_seen
     where sr.status = 'pending'
       and p.in_guild = false
       and coalesce(gm.any_present, false) = false
       and gm.last_seen is not null
       and gm.last_seen < now() - make_interval(hours => v_grace)
       and (w.profile_id is null or now() >= w.deadline_at)
       and not exists (select 1 from public.roster_spots rs join public.seasons s2 on s2.id = rs.season_id
                        where rs.profile_id = p.id and s2.status <> 'complete')
       and not exists (select 1 from public.roster_departure_notices n
                        where n.profile_id = p.id and n.removed_at is null and n.rejoined_at is null)
     order by sr.created_at
  loop
    begin
      v_reg := null;
      select to_jsonb(x.*) into v_reg from public.season_registrations x
       where x.id = r.rid and x.status = 'pending'
         for update skip locked;
      if v_reg is null then
        action := 'skipped'; profile_id := r.pid; gamertag := r.gt; detail := 'sign-up already gone or locked';
        return next; continue;
      end if;
      insert into public.season_registration_removals (registration_id, profile_id, season_id, gamertag, reason, registration)
        values (r.rid, r.pid, (v_reg->>'season_id')::uuid, r.gt, 'left_discord', v_reg);
      delete from public.season_registrations x where x.id = r.rid;
      v_until := null;
      if r.warned and not r.was_banned then
        v_until := public._suspend_for_departure(r.pid,
          'Left the league Discord and did not rejoin by the deadline in the site notice, so the Season '||r.snum||
          ' sign-up was withdrawn (Rule 1.1)');
      end if;
      if not r.was_banned then
        perform public.create_notification(r.pid, 'discord', 'Season sign-up withdrawn',
          case when v_until is not null
               then 'Your Season '||r.snum||' sign-up was withdrawn because you left the Chel Gaming Discord and did '||
                    'not rejoin by the deadline (Rule 1.1). You are also suspended through Season '||v_until||
                    ': rejoining the server does not lift it, and only a granted appeal does (Rule 7.6).'
               else 'Your Season '||r.snum||' sign-up was withdrawn because you left the Chel Gaming Discord server '||
                    '(Rule 1.1). Rejoin the server and sign up again any time; a new sign-up follows the normal '||
                    'draft-eligibility rules.' end,
          'discord', null);
      end if;
      action := 'removed'; profile_id := r.pid; gamertag := r.gt;
      detail := case when v_until is not null then 'suspended through Season '||v_until
                     when r.warned then 'not suspended (exempt under Rule 1.1)'
                     else 'not suspended (no warning for this departure)' end;
      return next;
    exception when others then
      action := 'error'; profile_id := r.pid; gamertag := r.gt; detail := 'withdrawal: '||SQLSTATE||' '||SQLERRM;
      return next;
    end;
  end loop;
end $function$;
/* DROP + CREATE reset the grants to PUBLIC EXECUTE. Before v4.30 authenticated could execute it too; nothing on the site
   calls it (grep src/live), so only the job's role gets it back (CLAUDE.md: grant only what the client calls). */
revoke all on function public.remove_departed_signups(integer) from public, anon, authenticated;
grant execute on function public.remove_departed_signups(integer) to service_role;

-- 4) the notices that read the grounds, and the season filter -------------------------------------------------------
-- Patched by text replacement on the live definitions (pg_get_functiondef), each anchor asserted to match exactly the
-- number of times it must. All three stay CREATE OR REPLACE, so their grants are kept.
do $patch$
declare v_def text; n int; i int; anchors text[]; repl text[];
begin
  /* notify_suspension: the member's notice for a departure suspension */
  v_def := pg_get_functiondef('public.notify_suspension()'::regprocedure);
  anchors := array[
    $a$else case when coalesce(current_setting('app.abandonment_ruling', true), '') = '1'$a$,
    $a$' If you want to appeal, you have 48 hours from now and must state your grounds (Rule 7.6).';$a$,
    $a$from public.profiles p where p.id = new.profile_id and coalesce(p.discord_id,'') <> '';$a$];
  repl := array[
    $a$else case when new.grounds = 'departure'   /* v4.30: Rule 1.1, the member left the league Discord */
                   then 'This is the Rule 1.1 suspension for leaving the league Discord and not rejoining within twenty-four (24) hours. While it runs you may not sign up for a season, be signed by a club, be scheduled or play, and rejoining the server does not lift it.'
                   when coalesce(current_setting('app.abandonment_ruling', true), '') = '1'$a$,
    $a$case when new.grounds = 'departure'
         then ' Only a granted appeal lifts it: you may appeal on the site at any time while it runs, once, and must state your grounds (Rule 7.6).'
         else ' If you want to appeal, you have 48 hours from now and must state your grounds (Rule 7.6).' end;$a$,
    $a$from public.profiles p where p.id = new.profile_id and coalesce(p.discord_id,'') <> ''
          and new.grounds is distinct from 'departure';   /* v4.30: a member who left the server cannot receive a DM */$a$];
  for i in 1 .. array_length(anchors, 1) loop
    n := (length(v_def) - length(replace(v_def, anchors[i], ''))) / length(anchors[i]);
    if n <> 1 then raise exception 'v4.30: notify_suspension anchor % found % times', i, n; end if;
    v_def := replace(v_def, anchors[i], repl[i]);
  end loop;
  execute v_def;

  /* lift_suspension: "dressed again from your club's next game" means nothing to a member with no club */
  v_def := pg_get_functiondef('public.lift_suspension(uuid)'::regprocedure);
  anchors := array[$a$'The league office has lifted it. You may be dressed again from your club''s next game. '||
    'The suspension stays on your record as served (Chapter 7).'$a$];
  repl := array[$a$case when s.grounds = 'departure'   /* v4.30: Rule 1.1; a lifted one is vacated (Rule 7.2), never "served" */
         then 'The league office lifted it. You may sign up for a season again; a roster spot or sign-up you lost is restored only if the league office decides to. It is vacated and no longer appears on the public record (Rule 7.2).'
         else 'The league office has lifted it. You may be dressed again from your club''s next game. '||
              'The suspension stays on your record as served (Chapter 7).' end$a$];
  n := (length(v_def) - length(replace(v_def, anchors[1], ''))) / length(anchors[1]);
  if n <> 1 then raise exception 'v4.30: lift_suspension anchor found % times', n; end if;
  execute replace(v_def, anchors[1], repl[1]);

  /* link_appeal: the site's appeal form sends no suspension id, so an appeal linked to the newest suspension; with the
     Rule 1.1 suspension running beside an older one (Rule 7.2 paragraph 4), the older one could then never be appealed
     (review 2026-10-24). Prefer the newest one not yet appealed; when every one is, fall back to the newest so the
     "already appealed" refusal still answers. */
  v_def := pg_get_functiondef('public.link_appeal()'::regprocedure);
  anchors := array[$a$    select x.* into s from public.suspensions x
     where x.profile_id = new.profile_id and x.status <> 'lifted'
       and (public.suspension_running_at(x, now()) or x.created_at > now() - interval '48 hours')
     order by x.created_at desc limit 1;$a$];
  repl := array[$a$    select x.* into s from public.suspensions x
     where x.profile_id = new.profile_id and x.status <> 'lifted'
       and (public.suspension_running_at(x, now()) or x.created_at > now() - interval '48 hours')
       and not exists (select 1 from public.action_requests a where a.type = 'appeal' and a.suspension_id = x.id)
     order by x.created_at desc limit 1;   /* v4.30: the newest not yet appealed */
    if s.id is null then
      select x.* into s from public.suspensions x
       where x.profile_id = new.profile_id and x.status <> 'lifted'
         and (public.suspension_running_at(x, now()) or x.created_at > now() - interval '48 hours')
       order by x.created_at desc limit 1;
    end if;$a$];
  n := (length(v_def) - length(replace(v_def, anchors[1], ''))) / length(anchors[1]);
  if n <> 1 then raise exception 'v4.30: link_appeal anchor found % times', n; end if;
  execute replace(v_def, anchors[1], repl[1]);

  /* _remove_for_discipline: 'completed' is not a season_status label, so the filter never excluded anything */
  v_def := pg_get_functiondef('public._remove_for_discipline(uuid, text)'::regprocedure);
  n := (length(v_def) - length(replace(v_def, $a$s.status::text <> 'completed'$a$, ''))) / length($a$s.status::text <> 'completed'$a$);
  if n <> 2 then raise exception 'v4.30: _remove_for_discipline season filter found % times, expected 2', n; end if;
  execute replace(v_def, $a$s.status::text <> 'completed'$a$, $a$s.status <> 'complete'$a$);
end $patch$;

-- 5) the public record carries the grounds ---------------------------------------------------------------------------
/* Same columns, same order, same definer rights (security_invoker false, as before; CREATE OR REPLACE keeps the grants:
   anon and authenticated SELECT only, sql/2026-10-02-suspension-record-read-only.sql). grounds is now the row's own
   marker, falling back to the abandonment link it already read. */
create or replace view public.suspension_record with (security_invoker = false) as
 select s.id, s.profile_id, s.mode, s.games_total, s.ends_at, s.until_season, s.status, s.served_at, s.lifted_at,
        s.created_at, s.season_id, s.team_id, s.reason_codes, s.scope, s.venue, s.request_id,
        ((select count(*) from public.suspension_games g where g.suspension_id = s.id))::integer as games_served,
        public.suspension_running_at(s.*, now()) as running,
        case when (public.is_commissioner() or public.is_staff() or s.profile_id = auth.uid()) then s.reason
             else null::text end as reason,
        case when (public.is_commissioner() or public.is_staff()) then s.created_by else null::uuid end as created_by,
        coalesce(s.grounds,
                 (select c.type from public.action_requests c where c.id = s.request_id and c.type = 'abandonment'::text)) as grounds
   from public.suspensions s
  where (public.is_commissioner() or public.is_staff() or s.profile_id = auth.uid()
         or (s.mode <> 'warning'::text and s.status <> 'lifted'::text));

-- 6) self-checks ------------------------------------------------------------------------------------------------------
do $chk$
declare v_def text;
begin
  if (select count(*) from public.roster_departure_notices where suspension_warned) <> 0 then
    raise exception 'v4.30 check: a notice written before v4.30 is marked as warned';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'suspensions_grounds_check' and conrelid = 'public.suspensions'::regclass) then
    raise exception 'v4.30 check: suspensions.grounds has no check';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.signup_departure_notices'::regclass)
     or has_table_privilege('anon', 'public.signup_departure_notices', 'SELECT')
     or has_table_privilege('authenticated', 'public.signup_departure_notices', 'SELECT')
     or has_table_privilege('authenticated', 'public.signup_departure_notices', 'INSERT') then
    raise exception 'v4.30 check: signup_departure_notices is open to an API role';
  end if;
  if has_function_privilege('anon', 'public._suspend_for_departure(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._suspend_for_departure(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public._departure_suspension_exempt(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._departure_suspension_exempt(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.remove_departed_signups(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.remove_departed_signups(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.remove_departed_signups(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.sweep_roster_departures(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sweep_roster_departures(integer)', 'EXECUTE') then
    raise exception 'v4.30 check: a grant is wrong';
  end if;
  if (select count(*) from pg_proc where proname = 'remove_departed_signups' and pronamespace = 'public'::regnamespace) <> 1
     or pg_get_function_result('public.remove_departed_signups(integer)'::regprocedure)
        <> 'TABLE(action text, profile_id uuid, gamertag text, detail text)' then
    raise exception 'v4.30 check: remove_departed_signups shape';
  end if;
  v_def := pg_get_functiondef('public.sweep_roster_departures(integer)'::regprocedure);
  if position('suspension_warned = excluded.suspension_warned' in v_def) = 0 or position('public._suspend_for_departure(r.profile_id' in v_def) = 0
     or position('g.present))' in v_def) = 0 or position('season complete, roster kept' in v_def) = 0
     or position('search_path TO ''''' in v_def) = 0 or position('He has until' in v_def) > 0 then
    raise exception 'v4.30 check: sweep_roster_departures';
  end if;
  v_def := pg_get_functiondef('public.notify_suspension()'::regprocedure);
  if position('case when new.grounds = ''departure''' in v_def) = 0
     or position('This is the Rule 1.1 suspension for leaving the league Discord' in v_def) = 0
     or position('new.grounds is distinct from ''departure''' in v_def) = 0
     or position('at any time while it runs, once' in v_def) = 0 then
    raise exception 'v4.30 check: notify_suspension';
  end if;
  if position('s.grounds = ''departure''' in pg_get_functiondef('public.lift_suspension(uuid)'::regprocedure)) = 0
     or position('It is vacated and no longer appears on the public record' in pg_get_functiondef('public.lift_suspension(uuid)'::regprocedure)) = 0 then
    raise exception 'v4.30 check: lift_suspension';
  end if;
  if position('the newest not yet appealed' in pg_get_functiondef('public.link_appeal()'::regprocedure)) = 0 then
    raise exception 'v4.30 check: link_appeal';
  end if;
  if has_function_privilege('anon', 'public._departure_suspension_until()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._departure_suspension_until()', 'EXECUTE') then
    raise exception 'v4.30 check: _departure_suspension_until is callable from the API';
  end if;
  v_def := pg_get_functiondef('public._remove_for_discipline(uuid, text)'::regprocedure);
  if position('s.status::text <> ''completed''' in v_def) > 0
     or (length(v_def) - length(replace(v_def, 's.status <> ''complete''', ''))) / length('s.status <> ''complete''') <> 2 then
    raise exception 'v4.30 check: _remove_for_discipline season filter';
  end if;
  if not has_table_privilege('anon', 'public.suspension_record', 'SELECT')
     or has_table_privilege('anon', 'public.suspension_record', 'INSERT')
     or has_table_privilege('authenticated', 'public.suspension_record', 'UPDATE')
     /* the view reads suspensions.grounds (pg_get_viewdef prints the column unqualified, so ask the catalog) */
     or not exists (select 1 from information_schema.view_column_usage u where u.view_schema = 'public'
                     and u.view_name = 'suspension_record' and u.table_name = 'suspensions' and u.column_name = 'grounds') then
    raise exception 'v4.30 check: suspension_record';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.suspensions'::regclass and not tgisinternal
        and tgname in ('on_suspension_notify', 'suspension_removes_for_season_trg', 'trg_pull_suspended_from_lineups')) <> 3 then
    raise exception 'v4.30 check: a suspension trigger is missing';
  end if;
end $chk$;

/* REHEARSAL, 2026-10-24 (final run, after the review fixes): one transaction on the live database (this file, then the
   v4.30 probe, run as the Edge job's identity: request.jwt.claims role service_role), rolled back by the probe's closing
   raise. Subjects were picked by the probe at run time from live rows (real members; their names are left out of this
   public record, since nothing happened to them): A, C, D and H rostered Season 1 players with a pending Season 2
   sign-up, K2 a rostered commissioner, B and B2 unplaced Season 2 sign-ups, E a plain member given a running date
   suspension by the probe, F a member already suspended through Season 2, G a club Owner, K a commissioner.
   T0 preconditions held: no old notice marked as warned, no suspension carrying grounds.
   T1 the roster sweep gave A, C and D notice with the new warning, marked each notice, suspended nobody.
   T14 K2 (exempt) got the plain notice: not marked, and no word of a suspension.
   T2 C came back by presence alone (guild_members.present, in_guild still false) after the deadline passed: kept, not
      suspended, the club told "no suspension follows".
   T3 A's window closed: removed and suspended once (seasons, until 2, Season 1, play, active, no creator, the reason
      pattern), the Season 2 sign-up withdrawn by the suspension.
   T4 A told once each: one discipline_removal, departure_removal and automatic suspension_issued audit row; one club
      removal notice naming the suspension and no second club notice; one "You have been suspended" notice with the new
      wording and no 48-hour line; one "Removed from" notice; no DM.
   T5 D (a notice made before v4.30): removed as before, not suspended, Season 2 sign-up kept.
   T6 the sign-up sweep warned B (24-hour site notice), suspended nobody, and did not warn D.
   T7 B withdrawn and suspended once with one archive row and one of each notice, no DM; B2 rejoined and was left alone;
      D withdrawn on the old clock without a suspension.
   T8 asking again for A and B changed nothing. T9 F was not suspended again. T10 E's departure suspension runs beside
   the date suspension. T11 G and K exempt. T12 a commissioner lifting B's suspension sends the "vacated" notice (never
   "as served") and clears the way to sign up.
   T15 E's first appeal linked to the departure suspension (the newer), the second to the date suspension, not both to one.
   T16 H's window closed after Season 1 was marked complete (inside the transaction): the roster was kept, the notice
      closed, and H suspended through Season 2 counted from Season 2; no removal transaction.
   T13 the inlined grant audit returned zero rows.
   pg_net requests queued (never sent): discord.com/api/webhooks x39.
   Result: REHEARSAL OK: T0 T1 T14 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T15 T16 T13 (T14 T15 T16 above).
   Afterward: signup_departure_notices does not exist, remove_departed_signups still returns TABLE(profile_id uuid,
   gamertag text), suspensions has no grounds column, link_appeal is unpatched and Season 1 is still active: nothing stuck.
   Earlier runs stopped and rolled back whole: the view self-check matched 's.grounds' in pg_get_viewdef, which prints the
   column unqualified (now asked of information_schema.view_column_usage); the probe's inlined grant audit aliased a set
   as r, colliding with the probe's own record r (renamed rr); and T15 first tied, since both of E's suspensions carried
   the transaction's now() (the probe's date suspension is now issued an hour earlier). A first full pass (T0 to T13)
   ran before the review fixes.
   Applied as migration v430_departure_suspension; tools/sql/grant-audit.sql returned zero rows. The Edge discord-sync job
   (build f474ac9dce00, commit 1acfa24) was deployed first and ran clean against the old shape. */


-- ================================================================================================================
-- v4.30b (2026-10-24, the same release): notify_suspension worded a suspension issued between seasons, before its
-- season began, as "for the rest of Season 2". A Rule 1.1 suspension issued after Season 1 is complete counts from
-- Season 2 (season_id), so the member would have been told "the rest" of a season not yet started. It now reads "for all
-- of Season 2" (or "for all of Season 2 through Season 3"), the same test the site's CG.suspensionLen uses: issued before
-- the season's starts_at. Applied after v4.30, because the anchor is in the function v4.30 rewrote.
do $patch_b$
declare v_def text; n int;
  a text := $a$when 'seasons' then case when new.until_season > coalesce((select se.number from public.seasons se where se.id = new.season_id), new.until_season)$a$;
  b text := $a$when 'seasons' then case when exists (select 1 from public.seasons se where se.id = new.season_id and new.created_at < se.starts_at)   /* v4.30b: issued between seasons, before its season began */
                             then 'for all of Season '||(select se.number from public.seasons se where se.id = new.season_id)||
                                  case when new.until_season > (select se.number from public.seasons se where se.id = new.season_id)
                                       then ' through Season '||new.until_season else '' end
                             when new.until_season > coalesce((select se.number from public.seasons se where se.id = new.season_id), new.until_season)$a$;
begin
  v_def := pg_get_functiondef('public.notify_suspension()'::regprocedure);
  if position('This is the Rule 1.1 suspension for leaving the league Discord' in v_def) = 0 then
    raise exception 'v4.30b: apply v4.30 first';
  end if;
  n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if n <> 1 then raise exception 'v4.30b: notify_suspension seasons anchor found % times', n; end if;
  execute replace(v_def, a, b);
end $patch_b$;

do $chk_b$
declare v_def text := pg_get_functiondef('public.notify_suspension()'::regprocedure);
begin
  if position('v4.30b: issued between seasons' in v_def) = 0 or position('''for all of Season ''' in v_def) = 0
     or position('This is the Rule 1.1 suspension for leaving the league Discord' in v_def) = 0
     or position('''for the rest of Season ''||(select se.number' in v_def) = 0 then
    raise exception 'v4.30b check: notify_suspension';
  end if;
end $chk_b$;
/* REHEARSAL v4.30b, 2026-10-24, after v4.30 was applied: one transaction on the live database (this part, then a probe as
   service_role), rolled back by the probe's closing raise. Three plain members with no suspension, picked at run time.
   B1 a departure suspension counted from Season 1 (under way) still reads "for the rest of Season 1 and all of Season 2".
   B2 one counted from Season 2 (starts_at in the future) reads "for all of Season 2", with the Rule 1.1 wording.
   B3 an ordinary seasons suspension from Season 2 until 3 reads "for all of Season 2 through Season 3", without it.
   Result (v4.30b): REHEARSAL OK: B1 B2 B3.
   Applied as migration v430b_between_seasons_wording; tools/sql/grant-audit.sql returned zero rows. */
