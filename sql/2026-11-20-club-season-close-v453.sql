-- v4.53 (2026-11-20): twenty-four hours after a club's season ends, every front-office seat (the Owner's included) ends
-- and the club's Discord role comes off its roster. Season 1 is closed now.
--
-- Commissioner, 2026-11-20, the morning after the Bruins won the Season 1 final 4-0 over Vancouver:
--   "it is time to remove all team management roles on discord from season 1 and the website."
--   Asked whether the Owner's seat should end every season: "As soon as that specific team's season is over i.e. missed
--   playoffs after the regular season ends, or loses their series in the playoffs, that management and roster should
--   have their team roles removed since they no longer play any games. Give it 24 hours to remove the roles for the
--   future though."
--   Chosen the same morning: end the Season 1 Owner seats quietly (no management-moves posts), and take the club roles
--   off the Season 1 rosters now too ("Rosters too, now").
-- Supersedes v3.69 (Q45, "Just the GM and AGM seats do. The Owner stays for now."), which ended the GM and AGM seats at
-- the moment the club's season ended and kept the Owner.
--
-- The model:
--   * public.club_season_ends: one row per club and season, written at the moment the club's season ends (the same three
--     moments v3.69 watched: the frozen seeds leave it out, a series result names it the loser, the season is marked
--     complete) with ended_at; closed_at is stamped when the club is closed.
--   * public.close_finished_clubs() (pg_cron club-season-close, every 10 minutes) closes every club whose season ended
--     24 hours ago: public._close_club_season ends the AGM, GM and Owner seats through _set_team_seat (p_by 'season'),
--     QUIETLY (app.mgmt_quiet: no management-moves post, no #transactions post, no "Access settings reset" notice;
--     the ending stays in the site's transaction log and each holder gets a site notice), records each ending in the
--     season the seat belonged to (app.seat_season), queues the roster for the bot's role sync, and audits it.
--   * public.discord_links.team_id (the club whose role a member wears; the sweep and the bot both read it) skips a roster
--     spot on a closed club, so the roster loses the club role and the club room on the next pass. The roster spot itself
--     is the season's record and stays.
--   * Season 1: every club's end is recorded at the moment it happened, and every club is closed now (the 24 hours apply
--     from Season 2). The two Bruins management lines written when Season 1 was marked complete landed in Season 2's log
--     (current_season_id() had already moved on); they are moved back to Season 1.
--
-- The DMs to the eight Season 1 owners (approved text) are sent after this migration, part (b) at the end of this file.

-- 1. the record ------------------------------------------------------------------------------------------------------
create table if not exists public.club_season_ends (
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id   uuid not null references public.teams(id) on delete cascade,
  reason    text not null check (reason in ('missed_playoffs', 'eliminated', 'final')),
  ended_at  timestamptz not null default now(),   -- the club's season ended (its last game decided, or the seeds left it out)
  closed_at timestamptz,                          -- its seats ended and its roster lost the club role (Rule 2.6)
  primary key (season_id, team_id));
comment on table public.club_season_ends is
  'v4.53: when each club''s season ended and when the club was closed (24 hours later: seats ended, club role off the roster, Rule 2.6). Written by the three season-end triggers; closed by close_finished_clubs().';
alter table public.club_season_ends enable row level security;
revoke all on table public.club_season_ends from public, anon, authenticated;

-- 2. a club's season is over: record the moment, once --------------------------------------------------------------------
create or replace function public._club_season_over(p_season uuid, p_team uuid, p_reason text)
 returns void language plpgsql security definer set search_path to '' as $fn$
begin
  if p_season is null or p_team is null then raise exception '_club_season_over: a season and a club are required'; end if;
  insert into public.club_season_ends (season_id, team_id, reason) values (p_season, p_team, p_reason)
    on conflict (season_id, team_id) do nothing;   -- the first moment stands: a reseed or a re-run never moves the clock
end $fn$;
revoke all on function public._club_season_over(uuid, uuid, text) from public, anon, authenticated;

-- 3. close one club: every seat ends quietly, the roster loses the club role -----------------------------------------
create or replace function public._close_club_season(p_season uuid, p_team uuid)
 returns int language plpgsql security definer set search_path to '' as $fn$
declare e record; t record; v_n int := 0; v_grant text; v_quiet text; v_seat text;
begin
  select * into e from public.club_season_ends where season_id = p_season and team_id = p_team for update;
  if e.team_id is null then raise exception '_close_club_season: no season end is recorded for that club and season'; end if;
  if e.closed_at is not null then return 0; end if;
  select id, code, name, owner_profile_id, gm_profile_id, agm_profile_id into t from public.teams where id = p_team for update;
  if t.id is null then raise exception '_close_club_season: club not found'; end if;
  v_grant := coalesce(current_setting('app.role_grant', true), '');
  v_quiet := coalesce(current_setting('app.mgmt_quiet', true), '');
  v_seat  := coalesce(current_setting('app.seat_season', true), '');
  perform set_config('app.role_grant', 'on', true);
  /* quiet: a club's season ending is not a management move, so nothing is posted to the management-moves channel or the
     club room; each holder gets the site notice from _set_team_seat (commissioner, 2026-11-20: "End quietly") */
  perform set_config('app.mgmt_quiet', 'on', true);
  /* the ending is recorded in the season the seat belonged to: after the final, current_season_id() is already the next
     season (the two Bruins lines of 2026-11-20 05:30 UTC landed in Season 2 that way) */
  perform set_config('app.seat_season', p_season::text, true);
  if t.agm_profile_id   is not null then perform public._set_team_seat(p_team, 'agm',   null, 'season'); v_n := v_n + 1; end if;
  if t.gm_profile_id    is not null then perform public._set_team_seat(p_team, 'gm',    null, 'season'); v_n := v_n + 1; end if;
  if t.owner_profile_id is not null then perform public._set_team_seat(p_team, 'owner', null, 'season'); v_n := v_n + 1; end if;
  perform set_config('app.role_grant', v_grant, true);
  perform set_config('app.mgmt_quiet', v_quiet, true);
  perform set_config('app.seat_season', v_seat, true);
  update public.club_season_ends set closed_at = now() where season_id = p_season and team_id = p_team;
  /* the club role follows public.discord_links, which stops naming a closed club; the sweep converges within two minutes
     and the queue lets the gateway bot act at once */
  perform public._rsq(rs.profile_id, 'club_closed') from public.roster_spots rs where rs.season_id = p_season and rs.team_id = p_team;
  perform public.log_admin_action('club_season_closed', 'team', p_team::text,
    jsonb_build_object('season', p_season, 'club', t.code, 'reason', e.reason, 'ended_at', e.ended_at, 'seats_ended', v_n,
                       'owner', t.owner_profile_id, 'gm', t.gm_profile_id, 'agm', t.agm_profile_id));
  return v_n;
end $fn$;
revoke all on function public._close_club_season(uuid, uuid) from public, anon, authenticated;

-- 4. the 24-hour clock (pg_cron club-season-close; a failure raises, and automation_watchdog section 3 reports it) -----
create or replace function public.close_finished_clubs()
 returns int language plpgsql security definer set search_path to '' as $fn$
declare r record; v_n int := 0;
begin
  for r in select season_id, team_id from public.club_season_ends
            where closed_at is null and ended_at <= now() - interval '24 hours'
            order by ended_at
  loop
    perform public._close_club_season(r.season_id, r.team_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;
revoke all on function public.close_finished_clubs() from public, anon, authenticated;

-- 5. the three moments a club's season ends now record it (they used to end the GM and AGM seats at once) -----------
create or replace function public.trg_seeds_end_seats()
 returns trigger language plpgsql security definer set search_path to '' as $fn$
declare v_codes text[]; v_season uuid; v_back text;
begin
  if new.key not like 'playoff\_seeds\_%' or jsonb_typeof(new.value) <> 'array' then return new; end if;
  if split_part(new.key, '_', 3) <> public.current_season_num()::text then return new; end if;
  select array_agg(x) into v_codes from jsonb_array_elements_text(new.value) x;
  if coalesce(array_length(v_codes, 1), 0) = 0 then return new; end if;
  select id into v_season from public.seasons where number::text = split_part(new.key, '_', 3);
  if v_season is null then raise exception 'trg_seeds_end_seats: no season %', split_part(new.key, '_', 3); end if;
  /* v4.40c: once per club per season. A reseed (clear round 1, draw it again) used to end the seats of every club out of
     the playoffs a second time, unseating anyone its Owner had named for next season since. app_config seeds_out_<n>
     held the clubs already handled. v4.53: public.club_season_ends holds it now, one row per club and season. */
  perform public._club_season_over(v_season, tm.id, 'missed_playoffs')
     from public.teams tm
    where not (tm.code = any(v_codes))
      and exists (select 1 from public.games g where g.season_id = v_season and tm.id in (g.home_team_id, g.away_team_id));
  /* a reseed that brings a club back in stops its 24-hour clock; a club already closed is the office's to reopen */
  delete from public.club_season_ends e using public.teams tm
   where e.season_id = v_season and e.team_id = tm.id and tm.code = any(v_codes)
     and e.reason = 'missed_playoffs' and e.closed_at is null;
  select string_agg(tm.name, ', ' order by tm.name) into v_back
    from public.club_season_ends e join public.teams tm on tm.id = e.team_id
   where e.season_id = v_season and tm.code = any(v_codes) and e.reason = 'missed_playoffs' and e.closed_at is not null;
  if v_back is not null then
    perform public.notify_commissioners(null, 'flag', 'A club back in the playoffs had already been closed',
      v_back || ' qualified when round 1 was drawn again, but its season had already been closed: its front-office seats ended and its roster lost the club role (Rule 2.6). Reseat its management under Teams, and have its closing undone so its roster wears the club role again.',
      'admin', null);
  end if;
  return new;
end $fn$;
revoke all on function public.trg_seeds_end_seats() from public, anon, authenticated;

create or replace function public.trg_series_ends_seats()
 returns trigger language plpgsql security definer set search_path to '' as $fn$
declare v_parts text[]; v_a uuid; v_b uuid; v_loser uuid; v_season uuid;
begin
  if new.key not like 'series\_%' then return new; end if;
  v_parts := string_to_array(new.key, '_');          -- series, <n>, <week>, <a>, <b>
  if array_length(v_parts, 1) <> 5 then return new; end if;
  begin v_a := v_parts[4]::uuid; v_b := v_parts[5]::uuid; exception when others then return new; end;
  v_loser := case when new.value = v_a::text then v_b when new.value = v_b::text then v_a end;
  if v_loser is null then return new; end if;
  select id into v_season from public.seasons where number::text = v_parts[2];
  if v_season is null then raise exception 'trg_series_ends_seats: no season %', v_parts[2]; end if;
  perform public._club_season_over(v_season, v_loser, 'eliminated');
  return new;
end $fn$;
revoke all on function public.trg_series_ends_seats() from public, anon, authenticated;

create or replace function public.trg_season_complete_ends_seats()
 returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
  if new.status <> 'complete' or old.status = 'complete' then return new; end if;
  /* every club that played the season and is not recorded yet ended it with the final (the champion; the final's loser
     was recorded by its series result a moment earlier) */
  perform public._club_season_over(new.id, tm.id, 'final')
     from public.teams tm
    where exists (select 1 from public.games g where g.season_id = new.id and tm.id in (g.home_team_id, g.away_team_id));
  return new;
end $fn$;
revoke all on function public.trg_season_complete_ends_seats() from public, anon, authenticated;

drop function if exists public.end_season_mgmt_seats(uuid, text);   -- its three callers record the end now

-- 6. quiet: anchored patches (each anchor must match exactly once) ----------------------------------------------------
do $mig$ declare d0 text; d text; a text; b text; n int;
begin
  -- 6a. notify_mgmt_move: no management-moves post while a club is being closed
  d0 := pg_get_functiondef('public.notify_mgmt_move()'::regprocedure);
  a := $a$  v_old_owner := case when v_ins then null else old.owner_profile_id end;$a$;
  n := (length(d0) - length(replace(d0, a, ''))) / length(a);
  if n <> 1 then raise exception 'notify_mgmt_move anchor matched % times', n; end if;
  d := replace(d0, a, $b$  /* v4.53: a club's season ending is not a management move; _close_club_season ends the seats with app.mgmt_quiet on */
  if coalesce(current_setting('app.mgmt_quiet', true), '') = 'on' then return new; end if;
$b$ || a);
  execute d;

  -- 6b. reset_mgmt_on_owner_change: the settings still reset, without the "Access settings reset" notice
  d0 := pg_get_functiondef('public.reset_mgmt_on_owner_change()'::regprocedure);
  a := $a$  if coalesce(v_had, false) or v_n > 0 then$a$;
  n := (length(d0) - length(replace(d0, a, ''))) / length(a);
  if n <> 1 then raise exception 'reset_mgmt_on_owner_change anchor matched % times', n; end if;
  execute replace(d0, a, $b$  if (coalesce(v_had, false) or v_n > 0) and coalesce(current_setting('app.mgmt_quiet', true), '') <> 'on' then$b$);

  -- 6d. notify_discord_transaction: the ending stays in the site's transaction log without a #transactions post
  --     (the first rehearsal caught it: eight "parted ways with Owner" posts pinging each club and owner)
  d0 := pg_get_functiondef('public.notify_discord_transaction()'::regprocedure);
  a := $a$  v_msg := public.strip_html(new.description);$a$;
  n := (length(d0) - length(replace(d0, a, ''))) / length(a);
  if n <> 1 then raise exception 'notify_discord_transaction anchor matched % times', n; end if;
  execute replace(d0, a, $b$  /* v4.53: a club closed at the end of its season is recorded quietly (_close_club_season sets app.mgmt_quiet) */
  if coalesce(current_setting('app.mgmt_quiet', true), '') = 'on' then return new; end if;
$b$ || a);

  -- 6c. _set_team_seat: the season's wording, and the ending recorded in the season the seat belonged to
  d0 := pg_get_functiondef('public._set_team_seat(uuid,text,uuid,text)'::regprocedure);
  d := d0;
  a := $a$values (v_season, 'management', v_club || ' parted ways with ' || v_seat || ' <b>' || coalesce(v_who,'a member') || '</b>');$a$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception '_set_team_seat removal anchor matched % times', n; end if;
  d := replace(d, a, $b$values (coalesce(nullif(current_setting('app.seat_season', true), '')::uuid, v_season), 'management',
        case when p_by = 'season' then v_club || ': <b>' || coalesce(v_who,'a member') || '</b>''s time as ' || v_seat || ' ended with the club''s season'
             else v_club || ' parted ways with ' || v_seat || ' <b>' || coalesce(v_who,'a member') || '</b>' end);$b$);
  a := $a$when p_by = 'season' then 'Your club''s season is over, and the General Manager and Assistant GM seats end with it (Rule 2.6). The Owner may name you again for next season.'$a$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception '_set_team_seat season-notice anchor matched % times', n; end if;
  d := replace(d, a, $b$when p_by = 'season' then 'Your club''s season is over, so its front-office seats have ended (Rule 2.6). Each club''s management is decided again for the next season.'$b$);
  a := $a$' You keep your roster spot with the club; only the seat has ended.'$a$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception '_set_team_seat roster-spot anchor matched % times', n; end if;
  d := replace(d, a, $b$case when p_by = 'season' then '' else ' You keep your roster spot with the club; only the seat has ended.' end$b$);
  execute d;
end $mig$;

-- 7. the club role is worn only while the club's season is in play ---------------------------------------------------
create or replace view public.discord_links as
 select p.id as profile_id,
    p.gamertag,
    p.role,
    coalesce(nullif(p.discord_id, ''::text), u.raw_user_meta_data ->> 'provider_id'::text) as discord_id,
    (select rs.team_id
       from public.roster_spots rs
       join public.seasons s on s.id = rs.season_id
      where rs.profile_id = p.id
        and not exists (select 1 from public.club_season_ends e
                         where e.season_id = rs.season_id and e.team_id = rs.team_id and e.closed_at is not null)
      order by (s.status = 'active'::public.season_status) desc, s.number desc
      limit 1) as team_id,
    p.discord_username
   from public.profiles p
   join auth.users u on u.id = p.id;
comment on view public.discord_links is
  'Each member''s Discord identity and the club whose role they wear: their latest roster spot on a club whose season is still in play (v4.53: a closed club, public.club_season_ends.closed_at, is skipped). Read by discord-sync and the gateway bot through shared/roles.mjs.';

-- 8. the clock ------------------------------------------------------------------------------------------------------
select cron.schedule('club-season-close', '*/10 * * * *', $$select public.close_finished_clubs()$$);

-- 9. Season 1: record when each club's season ended, close every club now --------------------------------------------
do $s1$ declare v_s1 uuid; v_seeds jsonb; v_seeded_at timestamptz; v_final_at timestamptz; r record; n int;
begin
  select id into v_s1 from public.seasons where number = 1 and status = 'complete';
  if v_s1 is null then raise exception 'Season 1 is not complete'; end if;
  select value, updated_at into v_seeds, v_seeded_at from public.site_config where key = 'playoff_seeds_1';
  if v_seeds is null then raise exception 'Season 1 has no frozen seeds'; end if;
  insert into public.club_season_ends (season_id, team_id, reason, ended_at)
    select v_s1, tm.id, 'missed_playoffs', v_seeded_at from public.teams tm
     where not (tm.code in (select jsonb_array_elements_text(v_seeds)))
       and exists (select 1 from public.games g where g.season_id = v_s1 and tm.id in (g.home_team_id, g.away_team_id))
    on conflict (season_id, team_id) do nothing;
  insert into public.club_season_ends (season_id, team_id, reason, ended_at)
    select v_s1, case when c.value = split_part(c.key, '_', 4) then split_part(c.key, '_', 5)::uuid
                      else split_part(c.key, '_', 4)::uuid end, 'eliminated', c.updated_at
      from public.app_config c
     where c.key like 'series\_1\_%' and c.value in (split_part(c.key, '_', 4), split_part(c.key, '_', 5))
    on conflict (season_id, team_id) do nothing;
  select max(updated_at) into v_final_at from public.app_config where key like 'series\_1\_%';
  insert into public.club_season_ends (season_id, team_id, reason, ended_at)
    select v_s1, tm.id, 'final', v_final_at from public.teams tm
     where exists (select 1 from public.games g where g.season_id = v_s1 and tm.id in (g.home_team_id, g.away_team_id))
    on conflict (season_id, team_id) do nothing;
  select count(*) into n from public.club_season_ends where season_id = v_s1;
  if n <> 8 then raise exception 'Season 1: expected 8 clubs recorded, got %', n; end if;
  if (select count(*) from public.club_season_ends where season_id = v_s1 and reason = 'missed_playoffs') <> 2
     or (select count(*) from public.club_season_ends where season_id = v_s1 and reason = 'eliminated') <> 5
     or (select count(*) from public.club_season_ends e join public.teams tm on tm.id = e.team_id
          where e.season_id = v_s1 and e.reason = 'final' and tm.code = 'BOS') <> 1 then
    raise exception 'Season 1: the recorded endings are not 2 missed, 5 eliminated and the Bruins in the final';
  end if;
  for r in select team_id from public.club_season_ends where season_id = v_s1 and closed_at is null order by ended_at loop
    perform public._close_club_season(v_s1, r.team_id);
  end loop;
  -- the two Bruins lines written by trg_season_complete_ends_seats after current_season_id() had moved to Season 2
  update public.transactions set season_id = v_s1
   where id in ('e396553e-3ad3-4142-992c-5d05374ca521', '5649f409-c3eb-4349-8892-c1ddc0a918a0')
     and type = 'management' and description like 'Bruins parted ways with %';
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'Season 1: expected to move 2 Bruins management lines back, moved %', n; end if;
end $s1$;

-- 10. self-checks ---------------------------------------------------------------------------------------------------
do $chk$ declare v_s1 uuid; f text;
begin
  select id into v_s1 from public.seasons where number = 1;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'end_season_mgmt_seats') then
    raise exception 'end_season_mgmt_seats still exists';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%end_season_mgmt_seats%') then
    raise exception 'a function still calls end_season_mgmt_seats';
  end if;
  foreach f in array array['trg_seeds_end_seats()', 'trg_series_ends_seats()', 'trg_season_complete_ends_seats()'] loop
    if position('_club_season_over' in pg_get_functiondef(('public.' || f)::regprocedure)) = 0 then
      raise exception '% does not record the season end', f;
    end if;
  end loop;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('series_ends_seats_trg', 'seeds_end_seats_trg', 'season_complete_ends_seats_trg')) <> 3 then
    raise exception 'a season-end trigger is missing';
  end if;
  if position('app.mgmt_quiet' in pg_get_functiondef('public.notify_mgmt_move()'::regprocedure)) = 0
     or position('app.mgmt_quiet' in pg_get_functiondef('public.reset_mgmt_on_owner_change()'::regprocedure)) = 0
     or position('app.mgmt_quiet' in pg_get_functiondef('public.notify_discord_transaction()'::regprocedure)) = 0
     or position('app.seat_season' in pg_get_functiondef('public._set_team_seat(uuid,text,uuid,text)'::regprocedure)) = 0
     or position('so its front-office seats have ended (Rule 2.6)' in pg_get_functiondef('public._set_team_seat(uuid,text,uuid,text)'::regprocedure)) = 0 then
    raise exception 'a quiet or season-wording patch is missing';
  end if;
  if position('club_season_ends' in pg_get_viewdef('public.discord_links'::regclass)) = 0 then
    raise exception 'discord_links does not skip closed clubs';
  end if;
  if not exists (select 1 from cron.job where jobname = 'club-season-close' and command like '%close_finished_clubs()%') then
    raise exception 'the club-season-close cron job is missing';
  end if;
  if has_function_privilege('anon', 'public.close_finished_clubs()', 'execute')
     or has_function_privilege('authenticated', 'public._close_club_season(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._club_season_over(uuid,uuid,text)', 'execute')
     or has_table_privilege('anon', 'public.club_season_ends', 'select')
     or has_table_privilege('authenticated', 'public.club_season_ends', 'select') then
    raise exception 'a new function or the new table is reachable by anon or authenticated';
  end if;
  if (select count(*) from public.club_season_ends where season_id = v_s1 and closed_at is not null) <> 8 then
    raise exception 'Season 1: not every club is closed';
  end if;
  if exists (select 1 from public.teams where owner_profile_id is not null or gm_profile_id is not null or agm_profile_id is not null) then
    raise exception 'a club seat is still held';
  end if;
  if exists (select 1 from public.discord_links dl join public.roster_spots rs on rs.profile_id = dl.profile_id and rs.team_id = dl.team_id
              where rs.season_id = v_s1) then
    raise exception 'a member still wears a Season 1 club role';
  end if;
end $chk$;

/* REHEARSAL (2026-11-20, one transaction on the live database, rolled back by a closing raise):
   first run   T3 failed: "8 Discord requests queued". A diagnostic run named the writer by its app_config key only:
               notify_discord_transaction posts every transactions row to #transactions, so each Owner ending went out
               as "parted ways with Owner", pinging the club role and the owner. Fixed by 6d (the quiet guard).
   second run  T1  Season 1 recorded at the moments its clubs' seasons ended and closed: PIT and DAL missed the playoffs
                   (seeds frozen Nov 1, 7:56 PM ET), UTA, DET, NYI, SEA and VAN eliminated, BOS in the final (Nov 20,
                   12:30 AM ET).
               T2  eight Owner endings in Season 1's log ("Bruins: <b>ItzPeakz</b>'s time as Owner ended with the club's
                   season"); Season 2's log holds no management line once the two Bruins lines are moved back.
               T3  quiet: 0 requests queued for Discord, 0 DM rows; 8 site notices ("You are no longer the Owner of the
                   Penguins: Your club's season is over, so its front-office seats have ended (Rule 2.6). Each club's
                   management is decided again for the next season.").
               T4  no member wears a club role (discord_links.team_id null for all), 139 Season 1 roster members queued for
                   the bot.
               T5  the clock, on a club seated for Season 2 in the rehearsal: out 25 hours ago is closed, out 23 hours ago
                   waits; nothing posted; the seated Owner loses the club role; the management contract becomes a player
                   deal (Rule 2.6); the line lands in Season 2's log.
               T6  a series result records its loser with closed_at null and leaves the seat held for the 24 hours.
   Afterwards: no club_season_ends table, eight Owner seats still held, no club-season-close job, nothing queued.
   Result: REHEARSAL OK. */
-- Applied as migration v453_club_season_close; tools/sql/grant-audit.sql returned zero rows. Checked after: 8 Season 1
-- clubs closed, no seat held, no member wearing a club role, 139 members queued for the bot, and nothing sent to Discord
-- (net._http_response held only the routine Edge job starts).

-- (b) the DMs to the eight Season 1 owners, run after the migration was verified. Text approved by the commissioner on
--     2026-11-20 ("Send as written"); the owners are read from the club_season_closed audit rows, since their seats are
--     empty now. Sent by the gateway bot from discord_dms (kind season_end), once per owner.
insert into public.discord_dms (profile_id, discord_id, kind, content)
select p.id, dl.discord_id, 'season_end',
  '**Chel Gaming: please stay in your NHL 27 club.** Season 1 is over, so your Owner seat with the ' || trim(coalesce(tm.city,'') || ' ' || tm.name) ||
  ' has ended on the website and in the Discord, along with every other Season 1 front-office seat. One ask: please stay in your NHL 27 club, ' ||
  tm.ea_club_name || ', until further notice, so the league does not lose the club. The league office will tell you when that changes. Thank you for running the ' ||
  tm.name || ' this season.'
from public.admin_audit a
join public.teams tm on tm.id = (a.target_id)::uuid
join public.profiles p on p.id = (a.detail->>'owner')::uuid
join public.discord_links dl on dl.profile_id = p.id and dl.discord_id is not null
where a.action = 'club_season_closed' and (a.detail->>'season')::uuid = (select id from public.seasons where number = 1)
  and not exists (select 1 from public.discord_dms d where d.profile_id = p.id and d.kind = 'season_end');
-- Result: 8 rows (BOS, DAL, DET, NYI, PIT, SEA, UTA, VAN), 2026-11-20 15:14 UTC.
