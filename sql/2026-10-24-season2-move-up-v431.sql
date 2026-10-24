-- v4.31 (2026-10-24): Season 2 moves up four weeks; Veterans Day week is played.
-- Commissioner, 2026-10-24: "Lets push the season 2 start up to what we discussed the other day where we play on
-- vetrans day week so we can get season 2 week 1 in before christmas and the new year."
--
-- Why: Remembrance Day / Veterans Day (holiday key remembrance-day, Wednesday, November 11, 2026) was an observed
-- holiday in both seasons, so the playoff generator (CG.generatePlayoffRound, which reads CG.seasonHolidayKeys of the
-- season at the moment each round is generated) would skip its week and, with US Thanksgiving, push Season 1's final
-- to Wed Dec 2 to Fri Dec 4. Rule S2.1 counts the Season 2 off-season from that final, and the Christmas and New
-- Year's weeks then pushed the draft to January 9. Taking remembrance-day off both holiday lists makes Season 1's
-- playoffs three straight weeks (Nov 4 to 6, Nov 11 to 13, final Nov 18 to 20), and Rule S2.1 counted from that final:
--   owner applications close  Sat Nov 28 2026, 11:59 PM ET  (the Saturday of the week after the final; Rule S2.1 moves
--                                                            only a draft or a registration close off a holiday week)
--   owners decided            by Sat Dec 5 2026, 11:59 PM ET (app_config owner_decision_by_2)
--   sign-ups close            Fri Dec 11 2026, 11:59 PM ET  (the day before the draft; both deadline columns)
--   draft                     Sat Dec 12 2026, 9:00 PM ET
--   puck drop                 Wed Dec 16 2026, 9:00 PM ET   (Week 1 Dec 16 to 18; the weeks of Dec 21 and Dec 28 skip)
--   regular season ends       Fri Feb 5 2027, 11:59 PM ET   (Weeks 2 to 6 Jan 6 to Feb 5; deadline end of Week 4, Jan 22)
--   playoffs start            Wed Feb 10 2027, 9:00 PM ET   (Feb 10 to 12, Feb 17 to 19, Feb 24 to 26)
-- Every date was computed with the site's own calendar (CG.gameNights, CG.HOLIDAYS) and is pinned in
-- tools/season2-move-up-v431.test.cjs.
--
-- What does NOT change, on purpose:
--  - Season 1's playoffs_start_at stays 2026-11-05 02:00 UTC (Wed Nov 4, 9 PM ET). No playoff games are written here:
--    the commissioner generates each round in Control Center > Schedule, Round 1 from playoffs_start_at, later rounds
--    two days after the last playoff game, stepping over the season's holiday weeks. With this list Round 2 lands on
--    Nov 11 and the final on Nov 18. This must be applied before Round 2 is generated (about Nov 7).
--  - Season 2's movement deadline columns stay null: movement_deadline_at derives it from the Week 4 games once the
--    Season 2 schedule exists (Fri Jan 22, midnight ET), and _latch_movement_deadlines fixes it when it passes.
--  - ann_text_2_reg_open keeps the text posted to #signups on Oct 17 (old dates): announce_lifecycle never posts it
--    again (the ann_2_reg_open marker is set), so it is the record of what was said. The correction to members is a
--    separate post the commissioner approves.
--  - No schema, function or grant changes; tools/sql/grant-audit.sql is unaffected.
-- Triggers on the seasons UPDATE: season_playoff_floor_trg recomputes playoff_min_gp (stays 16: 30% of 54);
-- guard_season_format_trg does not fire (no format, roster_max, weeks, trade_deadline_week or preseason_starts_at in
-- the SET list); live_mark_seasons_upd repaints open tabs in place. None posts to Discord. No lifecycle post comes due:
-- every new instant is more than 24 hours away (checked below), and owner_decision_watch waits for the new close.
--
-- Rehearsal (2026-10-24, 1:35 PM ET): one transaction on the live database (the pre-check, the migration and the
-- self-checks above, then the probe at the bottom of this file), rolled back by the probe's closing raise. Result:
-- REHEARSAL OK: S1 holidays 9 (playoffs Wed Nov 04 09:00 PM), S2 holidays 9, owner close Sat Nov 28 11:59 PM, decide by
-- 2026-12-05T23:59:00-05:00, cutoff Fri Dec 11 11:59 PM / Fri Dec 11 11:59 PM, draft Sat Dec 12 09:00 PM, puck drop Wed
-- Dec 16 2026 09:00 PM, ends Fri Feb 05 2027 11:59 PM, playoffs Wed Feb 10 2027 09:00 PM, floors 16/16
-- Applied 2026-10-24 with apply_migration v431_season2_move_up; tools/sql/grant-audit.sql returned zero rows. Read-back:
-- Veterans Day played in both seasons (9 holidays each); Season 2 owner applications close Sat Nov 28 11:59 PM, cutoff
-- Fri Dec 11 11:59 PM, draft Sat Dec 12 09:00 PM, first game Wed Dec 16 2026, playoffs Wed Feb 10 2027; decide by
-- 2026-12-05T23:59:00-05:00; Season 1 playoffs still Wed Nov 04 2026.

-- 0. the rows are exactly as mapped on 2026-10-24, or nothing changes ---------------------------------------------------
do $pre$
declare s1 public.seasons; s2 public.seasons;
begin
  select * into s1 from public.seasons where number = 1;
  select * into s2 from public.seasons where number = 2;
  if s1.id is distinct from '0f1198ee-c6e0-451b-b108-2c7b1e7b6bcc'::uuid or s1.status <> 'active'
     or not ('remembrance-day' = any(s1.skip_holidays))
     or s1.playoffs_start_at is distinct from timestamptz '2026-11-05 02:00:00+00' then
    raise exception 'v4.31 pre-check: Season 1 is not as mapped (status %, playoffs_start_at %, holidays %)',
      s1.status, s1.playoffs_start_at, s1.skip_holidays;
  end if;
  if exists (select 1 from public.games g where g.season_id = s1.id and g.stage = 'playoff') then
    raise exception 'v4.31 pre-check: Season 1 playoff games already exist; clear and regenerate the rounds after this change';
  end if;
  if s2.id is distinct from 'a7c6a1ef-13a1-4096-8a4f-43d7007bea4c'::uuid or s2.status <> 'upcoming' or not s2.registration_open
     or s2.weeks <> 6 or s2.trade_deadline_week <> 4 or s2.format <> 'basic' then
    raise exception 'v4.31 pre-check: Season 2 is not as mapped (status %, registration_open %, weeks %, deadline week %, format %)',
      s2.status, s2.registration_open, s2.weeks, s2.trade_deadline_week, s2.format;
  end if;
  if exists (select 1 from public.games g where g.season_id = s2.id)
     or exists (select 1 from public.draft_picks dp where dp.season_number = 2)
     or exists (select 1 from public.draft_state ds where ds.season_number = 2) then
    raise exception 'v4.31 pre-check: Season 2 already has games, picks or a draft room; its dates cannot move under them';
  end if;
  if now() >= timestamptz '2026-11-28 23:59:00 America/New_York' - interval '24 hours' then
    raise exception 'v4.31 pre-check: too late; the new owner-application close (Nov 28) is under 24 hours away or past';
  end if;
end $pre$;

-- 1. Veterans Day week is played (both seasons), and the Season 2 dates, each keyed on the old values --------------------
do $mig$
declare n int;
begin
  update public.seasons
     set skip_holidays = array_remove(skip_holidays, 'remembrance-day')
   where number = 1 and status = 'active' and 'remembrance-day' = any(skip_holidays)
     and playoffs_start_at = timestamptz '2026-11-05 02:00:00+00';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'v4.31: Season 1 holiday list: % rows updated, expected 1', n; end if;

  update public.seasons set
      skip_holidays         = array_remove(skip_holidays, 'remembrance-day'),
      owner_app_deadline    = timestamptz '2026-11-28 23:59:00 America/New_York',
      registration_deadline = timestamptz '2026-12-11 23:59:00 America/New_York',
      signup_deadline_at    = timestamptz '2026-12-11 23:59:00 America/New_York',
      draft_at              = timestamptz '2026-12-12 21:00:00 America/New_York',
      starts_at             = timestamptz '2026-12-16 21:00:00 America/New_York',
      ends_at               = timestamptz '2027-02-05 23:59:00 America/New_York',
      playoffs_start_at     = timestamptz '2027-02-10 21:00:00 America/New_York'
   where number = 2 and status = 'upcoming' and 'remembrance-day' = any(skip_holidays)
     and owner_app_deadline    = timestamptz '2026-12-13 04:59:00+00'
     and registration_deadline = timestamptz '2027-01-09 04:59:00+00'
     and signup_deadline_at    = timestamptz '2027-01-09 04:59:00+00'
     and draft_at              = timestamptz '2027-01-10 02:00:00+00'
     and starts_at             = timestamptz '2027-01-14 02:00:00+00'
     and ends_at               = timestamptz '2027-02-20 04:59:00+00'
     and playoffs_start_at     = timestamptz '2027-02-25 02:00:00+00';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'v4.31: Season 2 row: % rows updated, expected 1 (a date changed since 2026-10-24?)', n; end if;

  -- 2. the owner decision deadline owner_decision_watch reads (two days before it, and at it) ---------------------------
  update public.app_config set value = '2026-12-05T23:59:00-05:00'
   where key = 'owner_decision_by_2' and value = '2026-12-19T23:59:00-05:00';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'v4.31: owner_decision_by_2: % rows updated, expected 1', n; end if;
end $mig$;

-- 3. self-checks --------------------------------------------------------------------------------------------------------
do $chk$
declare s1 public.seasons; s2 public.seasons; v_by timestamptz;
begin
  select * into s1 from public.seasons where number = 1;
  select * into s2 from public.seasons where number = 2;
  v_by := (select value from public.app_config where key = 'owner_decision_by_2')::timestamptz;
  if s1.skip_holidays is distinct from array['us-thanksgiving','new-years-day','easter','canada-day','independence-day',
       'christmas-eve','christmas-day','boxing-day','new-years-eve']::text[] then
    raise exception 'self-check: Season 1 holidays are %', s1.skip_holidays;
  end if;
  if s2.skip_holidays is distinct from s1.skip_holidays then
    raise exception 'self-check: the two seasons'' holiday lists differ: % vs %', s1.skip_holidays, s2.skip_holidays;
  end if;
  if s1.playoffs_start_at <> timestamptz '2026-11-05 02:00:00+00' or s1.status <> 'active' then
    raise exception 'self-check: Season 1 playoffs_start_at or status moved';
  end if;
  if s2.owner_app_deadline    <> timestamptz '2026-11-29 04:59:00+00'
     or s2.registration_deadline <> timestamptz '2026-12-12 04:59:00+00'
     or s2.signup_deadline_at    <> timestamptz '2026-12-12 04:59:00+00'
     or s2.draft_at              <> timestamptz '2026-12-13 02:00:00+00'
     or s2.starts_at             <> timestamptz '2026-12-17 02:00:00+00'
     or s2.ends_at               <> timestamptz '2027-02-06 04:59:00+00'
     or s2.playoffs_start_at     <> timestamptz '2027-02-11 02:00:00+00' then
    raise exception 'self-check: the Season 2 dates are not the v4.31 dates';
  end if;
  -- Rule S2.1 holds between them: the cutoff is 11:59 PM ET the day before the draft, a Saturday
  if (s2.signup_deadline_at at time zone 'America/New_York')::date <> (s2.draft_at at time zone 'America/New_York')::date - 1
     or extract(isodow from s2.draft_at at time zone 'America/New_York') <> 6
     or not (now() < s2.owner_app_deadline and s2.owner_app_deadline < v_by and v_by < s2.registration_deadline) then
    raise exception 'self-check: the Season 2 order is wrong (owner close %, decide by %, cutoff %, draft %)',
      s2.owner_app_deadline, v_by, s2.signup_deadline_at, s2.draft_at;
  end if;
  if s2.status <> 'upcoming' or not s2.registration_open or s2.weeks <> 6 or s2.trade_deadline_week <> 4
     or s2.playoff_min_gp <> 16 or s1.playoff_min_gp <> 16 or s2.movement_deadline_fixed is not null then
    raise exception 'self-check: a Season 2 setting moved (status %, open %, weeks %, deadline week %, floor %/%)',
      s2.status, s2.registration_open, s2.weeks, s2.trade_deadline_week, s1.playoff_min_gp, s2.playoff_min_gp;
  end if;
  -- nothing comes due at change time: the reg_open post already went out, and every new lifecycle instant is a day off
  if not exists (select 1 from public.app_config where key = 'ann_2_reg_open')
     or exists (select 1 from public.app_config where key like 'owner_decision_alert_2_%')
     or s2.registration_deadline <= now() + interval '24 hours' or s2.draft_at <= now() + interval '24 hours'
     or s2.starts_at <= now() + interval '24 hours' then
    raise exception 'self-check: a lifecycle post or decision alert could fire at change time';
  end if;
end $chk$;

/* ---- REHEARSAL PROBE (main session only; never part of the applied migration) ------------------------------------
   Paste everything from "do $pre$" through the end of "$chk$" between the begin and the probe block below, run it as
   ONE execute_sql call, and expect the error text 'REHEARSAL OK: ...'. The final raise is uncaught, so every update
   above rolls back (no exception handler anywhere in the script). Record the line in the header, then re-run
   SELECT number, skip_holidays, owner_app_deadline, signup_deadline_at, draft_at FROM public.seasons ORDER BY number
   to confirm nothing stuck.

begin;
-- ... steps 0 to 3 pasted here ...
do $probe$
declare s1 public.seasons; s2 public.seasons; v_by text;
begin
  select * into s1 from public.seasons where number = 1;
  select * into s2 from public.seasons where number = 2;
  v_by := (select value from public.app_config where key = 'owner_decision_by_2');
  raise exception 'REHEARSAL OK: S1 holidays % (playoffs %), S2 holidays %, owner close %, decide by %, cutoff % / %, draft %, puck drop %, ends %, playoffs %, floors %/%',
    array_length(s1.skip_holidays, 1), to_char(s1.playoffs_start_at at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM'),
    array_length(s2.skip_holidays, 1),
    to_char(s2.owner_app_deadline at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM'), v_by,
    to_char(s2.registration_deadline at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM'),
    to_char(s2.signup_deadline_at at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM'),
    to_char(s2.draft_at at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM'),
    to_char(s2.starts_at at time zone 'America/New_York', 'Dy Mon DD YYYY HH12:MI AM'),
    to_char(s2.ends_at at time zone 'America/New_York', 'Dy Mon DD YYYY HH12:MI AM'),
    to_char(s2.playoffs_start_at at time zone 'America/New_York', 'Dy Mon DD YYYY HH12:MI AM'),
    s1.playoff_min_gp, s2.playoff_min_gp;
end $probe$;
---------------------------------------------------------------------------------------------------------------------- */
