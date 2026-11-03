-- v4.44 (2026-11-03): leaving the league Discord no longer brings a suspension (Rules 1.1 and 7.2). The 24-hour
-- windows stay exactly as they were: a rostered player who does not rejoin within 24 hours of the club's notice still
-- comes off the squad, and a pending sign-up is still withdrawn when its site notice runs out.
-- Commissioner, 2026-11-03: "can you remove the auto suspension feature for players leaving the league?" Asked about
-- the seven members already serving a departure suspension (issued Oct 27 to Nov 3), the commissioner chose "Keep them
-- running": they run as issued and are lifted only on a granted appeal, so everything that serves a suspension with
-- grounds 'departure' stays (notify_suspension, lift_suspension, suspension_record, the appeal at any time under Rule
-- 7.6, the column and its check). Only the issuing is retired.
--
-- Before (v4.30, sql/2026-10-24-departure-suspension-v430.sql): the club's notice warned that a suspension follows and
-- marked itself (roster_departure_notices.suspension_warned); the unplaced member's site notice said the same; when a
-- window closed, public._suspend_for_departure suspended the member through the next season.
-- After:
--   1. sweep_roster_departures: the notice warns of the removal only and marks nothing (a reopened notice is set back to
--      false); a closed window removes the player and suspends nobody; the rejoin notice drops "no suspension follows";
--      the audit row drops suspended_through.
--   2. remove_departed_signups: the site notice warns of the withdrawal only; the withdrawal suspends nobody and tells the
--      member they may rejoin and sign up again. Every member out of the server with a pending sign-up is now warned
--      before the withdrawal: the v4.30 exemption list (banned, commissioners, front-office seats) existed only because
--      those members were never to be suspended, and a closed club notice for the same departure no longer blocks the
--      warning (it existed so a member warned with the pre-v4.30 club text was not warned of a suspension).
--   3. public._suspend_for_departure, public._departure_suspension_until and public._departure_suspension_exempt are
--      dropped: nothing calls them any more, and a door left standing could be called again by mistake. The v4.30
--      record keeps their text if the league ever wants them back.
-- Both sweeps keep their signatures, so CREATE OR REPLACE keeps their grants (sweep_roster_departures: authenticated
-- and service_role; remove_departed_signups: service_role). The Edge discord-sync job reads the same row shapes, so it
-- needs no change and no redeploy. Nothing here posts to Discord directly.

-- 1) the roster sweep ------------------------------------------------------------------------------------------------
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
   out of the league discord for 24 hours?" The notice said a suspension follows and marked itself
   (suspension_warned), and a closed marked window suspended the player through
   public._suspend_for_departure. The notice text moved to they/them (Writing rules).
   v4.44 (commissioner, 2026-11-03): "can you remove the auto suspension feature for players leaving
   the league?" The removal stays and the suspension goes: the notice warns of the removal only and
   marks nothing (a reopened notice is set back to false, so the column only records the old
   notices), and a closed window suspends nobody. The seven suspensions issued under v4.30 run on
   ("Keep them running"). */
declare v_grace integer := greatest(coalesce(p_grace_hours,24),0);
        r record; v_link text; v_n int; v_mgr boolean; v_role text;
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
      insert into public.roster_departure_notices(profile_id, season_id, team_id, deadline_at)
        values (r.profile_id, r.season_id, r.team_id, now() + make_interval(hours => v_grace))
      on conflict (profile_id, season_id) do update
        set team_id = excluded.team_id, notified_at = now(), deadline_at = excluded.deadline_at,
            rejoined_at = null, removed_at = null, suspension_warned = false;
      perform public.club_notify(r.team_id, 'flag',
        r.gt||' has left the league Discord',
        r.gt||' is on your '||case when r.squad='tc' then 'training camp' else 'active roster' end||
        ' and is no longer in the server. They have until '||
        to_char((now()+make_interval(hours=>v_grace)) at time zone 'America/New_York','Mon DD, HH12:MI AM')||
        ' ET to rejoin. If they do not, their sign-up is revoked and they come off your squad (Rule 1.1).'||
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
        r.gt||' rejoined the server before the deadline. Their spot is safe and there is nothing to do.',
        null,'manager',null,null);
      action:='rejoined'; gamertag:=r.gt; club:=r.tc; detail:='inside the window'; return next;
    exception when others then
      action:='error'; gamertag:=r.gt; club:=r.tc; detail:='rejoin: '||SQLSTATE||' '||SQLERRM; return next;
    end;
  end loop;
  /* C. the window closed */
  for r in
    select n.profile_id, n.season_id, n.team_id, p.gamertag as gt, t.code as tc, n.deadline_at,
           (s.status = 'complete') as done
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
         completed season's roster, sign-ups and transactions are its record and are never rewritten */
      if r.done then
        update public.roster_departure_notices set removed_at = now()
         where profile_id = r.profile_id and season_id = r.season_id;
        action:='closed'; gamertag:=r.gt; club:=r.tc; detail:='season complete, roster kept';
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
      perform public.club_notify(r.team_id,'flag', r.gt||' has been removed from your squad',
        'The window closed at '||to_char(r.deadline_at at time zone 'America/New_York','Mon DD, HH12:MI AM')||
        ' ET and '||r.gt||' had not rejoined the Discord. Their sign-up is revoked and the spot is free.',
        null,'manager',null,v_role);
      perform public._grant_replacement(r.season_id, r.team_id, r.profile_id, 'they left the league Discord');   -- v3.70 (Q11)
      perform public.log_admin_action('departure_removal','profile',r.profile_id::text,
        jsonb_build_object('player',r.gt,'club',r.tc,'deadline',r.deadline_at));
      action:='removed'; gamertag:=r.gt; club:=r.tc; detail:='did not return';
      return next;
    exception when others then
      action:='error'; gamertag:=r.gt; club:=r.tc; detail:='removal: '||SQLSTATE||' '||SQLERRM; return next;
    end;
  end loop;
end $function$;

-- 2) the sign-up sweep -----------------------------------------------------------------------------------------------
create or replace function public.remove_departed_signups(p_grace_hours integer default 24)
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
   v4.30 (commissioner, 2026-10-24) added a warning before the withdrawal (THE NOTICE IS THE CLOCK, as in the roster
   sweep, recorded in signup_departure_notices) and a suspension through the next season after it.
   v4.44 (commissioner, 2026-11-03): "can you remove the auto suspension feature for players leaving the league?" The
   warning stays and the suspension goes:
   A. WARN. A member out of the server with a pending sign-up, and no notice for this departure yet, gets a site notice
      with the deadline. Every such member is warned: the v4.30 exemptions (banned, commissioners, front-office seats)
      only kept them from a suspension. A player on a roster of a season not yet complete, or with an open club notice,
      is left to the roster sweep, which runs right after this one in the same tick.
   C. WITHDRAW. A warned member is withdrawn when the notice's window closes. A member with no notice for this departure
      (a warning that failed) is withdrawn on the old clock, a day after the census saw them go. Nobody is suspended.
   One savepoint per row, as in sweep_roster_departures since v3.50: a bad row is reported as action 'error' (which
   discord-sync counts as a failure) and never stops the sweep for everyone else.
   Returns (action, profile_id, gamertag, detail) with action warned | removed | skipped | error. discord-sync announces
   only 'removed' rows. */
declare v_grace integer := greatest(coalesce(p_grace_hours, 24), 0);
        r record; v_reg jsonb; v_deadline timestamptz;
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
       and not exists (select 1 from public.roster_spots rs join public.seasons s2 on s2.id = rs.season_id
                        where rs.profile_id = p.id and s2.status <> 'complete')
       and not exists (select 1 from public.roster_departure_notices n
                        where n.profile_id = p.id and n.removed_at is null and n.rejoined_at is null)
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
        ' ET, or your season sign-up is withdrawn (Rule 1.1).',
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
      if not r.was_banned then
        perform public.create_notification(r.pid, 'discord', 'Season sign-up withdrawn',
          'Your Season '||r.snum||' sign-up was withdrawn because you left the Chel Gaming Discord server '||
          '(Rule 1.1). Rejoin the server and sign up again any time; a new sign-up follows the normal '||
          'draft-eligibility rules.',
          'discord', null);
      end if;
      action := 'removed'; profile_id := r.pid; gamertag := r.gt;
      detail := case when r.warned then 'after the site notice' else 'no notice for this departure' end;
      return next;
    exception when others then
      action := 'error'; profile_id := r.pid; gamertag := r.gt; detail := 'withdrawal: '||SQLSTATE||' '||SQLERRM;
      return next;
    end;
  end loop;
end $function$;

-- 3) the retired doors -----------------------------------------------------------------------------------------------
drop function public._suspend_for_departure(uuid, text);
drop function public._departure_suspension_until();
drop function public._departure_suspension_exempt(uuid);

-- 4) self-checks -----------------------------------------------------------------------------------------------------
do $chk$
declare f text; src text;
begin
  foreach f in array array['sweep_roster_departures', 'remove_departed_signups'] loop
    select p.prosrc into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f;
    if src is null then raise exception 'v4.44: % is missing', f; end if;
    if src !~ 'v4\.44 \(commissioner, 2026-11-03\)' then raise exception 'v4.44: % lacks its v4.44 note', f; end if;
    /* the code, not the history its comments keep (they name the v4.30 door on purpose) */
    src := regexp_replace(src, '/\*.*?\*/', '', 'g');
    if src ~ '(_suspend_for_departure|_departure_suspension_until|_departure_suspension_exempt|suspended through|suspension follows|lift the suspension)'
      then raise exception 'v4.44: % still issues or promises a departure suspension', f; end if;
  end loop;
  if to_regprocedure('public._suspend_for_departure(uuid, text)') is not null
     or to_regprocedure('public._departure_suspension_until()') is not null
     or to_regprocedure('public._departure_suspension_exempt(uuid)') is not null
    then raise exception 'v4.44: a retired departure suspension door still exists'; end if;
  /* the grants CREATE OR REPLACE keeps: the roster sweep for the site's staff tools and the job, the sign-up sweep for the job only */
  if not has_function_privilege('authenticated', 'public.sweep_roster_departures(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.sweep_roster_departures(integer)', 'execute')
     or has_function_privilege('anon', 'public.sweep_roster_departures(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.remove_departed_signups(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.remove_departed_signups(integer)', 'execute')
     or has_function_privilege('anon', 'public.remove_departed_signups(integer)', 'execute')
    then raise exception 'v4.44: a sweep grant is wrong'; end if;
  /* what still serves the suspensions already running (commissioner: "Keep them running") */
  if to_regprocedure('public.notify_suspension()') is null or to_regprocedure('public.lift_suspension(uuid)') is null
     or to_regclass('public.suspension_record') is null
     or not exists (select 1 from pg_constraint where conname = 'suspensions_grounds_check')
    then raise exception 'v4.44: what serves a running departure suspension is missing'; end if;
end $chk$;

/* REHEARSAL, 2026-11-03: one transaction on the live database (parts 1 to 4 of this file, then a probe run as the Edge
   job's identity: request.jwt.claims role service_role), rolled back by the probe's closing raise. Subjects were picked
   by the probe at run time from live rows (real members; their names are left out of this public record, since nothing
   happened to them): A a rostered player in the server, B an unplaced Season 2 sign-up in the server.
   (A first run stopped at this file's own self-check, which matched the v4.30 door named in the history comment; the
   check now reads the code with its comments stripped, and nothing from that run stuck.)
   T0 the seven departure suspensions issued under v4.30 were running.
   T1 A taken out of the server, the roster sweep with no grace: 'notified' (0h to rejoin), then 'removed' (did not
      return); off the roster, the notice closed and not marked as warned.
   T2 A not suspended; the club's two notices ("has left the league Discord", "has been removed from your squad") say
      the sign-up is revoked and the player comes off the squad, and nothing about a suspension; one departure_removal
      audit row, with no suspended_through.
   T3 B out of the server for 48 hours: the sign-up sweep warned B ("or your season sign-up is withdrawn (Rule 1.1).").
   T4 B's notice run out: withdrawn after the site notice, archived (left_discord), not suspended, told "Rejoin the
      server and sign up again any time".
   T5 the seven running departure suspensions untouched.
   Afterwards both sweeps were byte-identical to their pre-rehearsal source and _suspend_for_departure still existed.
   pg_net requests queued by the club notices (never sent): rolled back with the transaction.
   Result: REHEARSAL OK: T0 T1 T2 T3 T4 T5
   Applied as migration v444_no_departure_suspension; md5(prosrc) of both sweeps equals this file's text;
   tools/sql/grant-audit.sql returned zero rows. */
