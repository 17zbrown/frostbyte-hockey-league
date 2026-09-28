-- v3.56: missed availability is escalated. Commissioner, 2026-09-28 (Q15): "flag 1 week of missed
-- availability to the team management, then flag the 2nd week to both management and staff."
--
-- availability_nudge_tick already told each player (bell + DM) and posted one line per club in the
-- club's ROOM when a week's window closed. It never told the front office by bell, and nothing tracked a
-- second week in a row, though the DM has promised league-office review since v2.75. Now, at each close:
--   - the club's three seats get a bell naming every player of theirs with no answer (first week);
--   - a player who had no answer the week before as well is named to the seats as a second week, and
--     the operations desk is flagged (bells, the staff casework room, the audit log), one notice per
--     week-close listing every such player by club.
-- The room line is unchanged. "Who is missing" is still defined once, in availability_missing, and the
-- previous week is read from the availability_nudges ledger, the record of who was told.

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.availability_nudge_tick()'::regprocedure);
  d := replace(d0,
'        v_first timestamptz; v_msg text; v_dm text;',
'        v_first timestamptz; v_msg text; v_dm text; v_second text[] := ''{}''; v_code text; v_list text; v_new uuid[] := ''{}'';');
  /* the players told in THIS run, so the club notices never depend on a clock window (v3.56: a
     two-minute window matched a whole week again whenever two runs shared a transaction clock) */
  d := replace(d,
'    for v_p in
      select am.* from public.availability_missing(v_season.id, v_key) am',
'    v_new := ''{}'';
    for v_p in
      select am.* from public.availability_missing(v_season.id, v_key) am');
  d := replace(d,
'      insert into public.availability_nudges (season_id, week_key, profile_id) values (v_season.id, v_key, v_p.profile_id) on conflict do nothing;',
'      insert into public.availability_nudges (season_id, week_key, profile_id) values (v_season.id, v_key, v_p.profile_id) on conflict do nothing;
      v_new := v_new || v_p.profile_id;');
  d := replace(d,
'            || ''Two weeks in a row without availability puts you under league-office review (Rule 5.1).'';',
'            || ''A second week in a row without availability is referred to the league office as well as your club (Rule 5.1).'';');
  d := replace(d,
'    /* one line per club, listing who is missing, in the club''s room (no bells: management has the grid) */
    for v_p in
      select am.team_id, count(*) as cnt, string_agg(am.gamertag, '', '' order by am.gamertag) as names
        from public.availability_missing(v_season.id, v_key) am
       where exists (select 1 from public.availability_nudges n
                      where n.season_id = v_season.id and n.week_key = v_key and n.profile_id = am.profile_id and n.nudged_at > now() - interval ''2 minutes'')
       group by am.team_id
    loop',
'    /* one line per club, listing who is missing, in the club''s room; v3.56 (Q15): and a bell to the
       club''s three seats, naming a second week in a row where there is one */
    v_second := ''{}'';
    for v_p in
      select am.team_id, count(*) as cnt, string_agg(am.gamertag, '', '' order by am.gamertag) as names,
             string_agg(am.gamertag, '', '' order by am.gamertag) filter (where exists (
               select 1 from public.availability_nudges n2
                where n2.season_id = v_season.id and n2.week_key = ''w'' || (v_wk.week - 1) and n2.profile_id = am.profile_id)) as second
        from public.availability_missing(v_season.id, v_key) am
       where am.profile_id = any(v_new)
       group by am.team_id
    loop
      perform public.club_notify(v_p.team_id, ''availability'',
        ''Availability missing: '' || v_p.cnt || '' player'' || case when v_p.cnt = 1 then '''' else ''s'' end || '' in '' || v_label,
        v_label || '' closed with no availability from '' || v_p.names || ''. Each has been told on the site and by Discord DM.''
          || case when v_p.second is not null
               then '' '' || v_p.second || case when position('','' in v_p.second) > 0 then '' have'' else '' has'' end
                    || '' now missed two weeks in a row, and the league office has been told as well (Rule 5.1).''
               else '' A second week in a row is referred to the league office (Rule 5.1).'' end,
        null, ''availability'', null, null, false);
      if v_p.second is not null then
        select code into v_code from public.teams where id = v_p.team_id;
        v_second := v_second || (coalesce(v_code, ''?'') || '': '' || v_p.second);
      end if;');
  d := replace(d,
'          null, ''availability'', null);
    end loop;
  end loop;',
'          null, ''availability'', null);
    end loop;
    if cardinality(v_second) > 0 then
      v_list := array_to_string(v_second, ''; '');
      perform public.notify_department(''operations'', ''flag'', ''Two weeks without availability: '' || v_label,
        v_label || '' closed and these players have now submitted no availability two weeks in a row: '' || v_list ||
        ''. Their clubs'''' front offices have been told. Review them under Rule 5.1: a warning, or a release from the club.'',
        ''stafftasks'', null);
      perform public.notify_staff_ch(''casework'', ''**Two weeks without availability** ('' || v_label || ''): '' || v_list ||
        ''. Their front offices have been told. Rule 5.1 review. https://chelgamingleague.com/#/hub/staffdesk'', false);
      perform public.log_admin_action(''availability_second_week'', ''season'', v_season.id::text,
        jsonb_build_object(''week'', v_wk.week, ''players'', to_jsonb(v_second)));
    end if;
  end loop;');
  if position('v_new := v_new || v_p.profile_id' in d) = 0 or position('where am.profile_id = any(v_new)' in d) = 0 or position('v_second := v_second ||' in d) = 0 or position('Two weeks without availability: ' in d) = 0
     or position('is referred to the league office as well as your club' in d) = 0 or position('v_code text; v_list text' in d) = 0 then
    raise exception 'availability_nudge_tick: a patch matched nothing';
  end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-09-28, one transaction, rolled back), with Week 2's games moved three days earlier so
   its window had just closed: 68 players told; 20 front-office bells (every seat of every club with a
   missing player); 18 players who had also been told for Week 1 named as a second week, to their seats
   and to the operations desk (4 bells), with an admin_audit row listing them by club; a second run in the
   same transaction told nobody and rang nothing. The battery also caught the old club-notice selector: it
   chose "just told" players by a two-minute clock window, which two runs sharing one transaction clock
   both match, so it now uses the list of players told in the run itself. */
