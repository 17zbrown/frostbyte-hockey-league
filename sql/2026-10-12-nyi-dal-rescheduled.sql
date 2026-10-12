-- 2026-10-12: Islanders at Stars (postponed from Fri Oct 9, 9:00 PM) rescheduled to Wed Oct 14 at 8:25 PM ET.
-- Commissioner: "reschedule the Stars vs Islanders game to be played at 8:25 this Wednesday [PM] and notify each
-- team in their team channel." Done through the office door (ops_reschedule_game, as the commissioner), which
-- moved the game into Week 4 (Rule 3.3) and wrote the transaction and admin log. Each club got a club_notify
-- 'schedule' notice (front-office bell plus the club's Discord room, no pings).
-- Side effect, by Rule 4.2: Wednesday's night lock (lobby codes, server picks) follows the night's first game, so it
-- moved from 8:30 PM to 7:55 PM ET for every club. The lineups filed for Oct 9 stayed on the game.
do $resched$
declare v_game uuid := 'd6359d09-9414-4bea-9f67-9a153b01ee49';
        v_at timestamptz := timestamptz '2026-10-14 20:25:00 America/New_York';
        v_dal uuid := (select id from public.teams where code = 'DAL');
        v_nyi uuid := (select id from public.teams where code = 'NYI');
        v_cm uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
begin
  if not exists (select 1 from public.games where id = v_game and status = 'scheduled' and home_team_id = v_dal and away_team_id = v_nyi) then
    raise exception 'Islanders at Stars is not the open fixture expected';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cm, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.ops_reschedule_game(v_game, v_at);
  perform set_config('role', 'postgres', true);
  perform public.club_notify(v_dal, 'schedule', 'Rescheduled: Islanders at Stars, Wed Oct 14 at 8:25 PM ET',
    'Your home game against the Islanders, postponed from Fri Oct 9, will be played this Wednesday, Oct 14, at 8:25 PM ET, right before your 9:00 PM game against Detroit. It counts toward Week 4 for weekly game limits (Rule 3.3). The lineup you filed for Oct 9 carries over, so check it on the Schedule desk: it locks at 7:55 PM ET. Wednesday''s lobby codes and server picks also lock at 7:55 PM ET, 30 minutes before this game.',
    v_cm, 'hub', 'schedule', null, true);
  perform public.club_notify(v_nyi, 'schedule', 'Rescheduled: Islanders at Stars, Wed Oct 14 at 8:25 PM ET',
    'Your game at Dallas, postponed from Fri Oct 9, will be played this Wednesday, Oct 14, at 8:25 PM ET, right before your 9:00 PM game at Pittsburgh. It counts toward Week 4 for weekly game limits (Rule 3.3). The lineup you filed for Oct 9 carries over, so check it on the Schedule desk: it locks at 7:55 PM ET. Wednesday''s lobby codes and server picks also lock at 7:55 PM ET, 30 minutes before this game.',
    v_cm, 'hub', 'schedule', null, true);
end $resched$;
