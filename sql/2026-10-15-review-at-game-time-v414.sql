-- v4.14, part 2 (2026-10-15): the records review and the weekly-limit forfeit read the roster as it stood when the game
-- was played, and count a player's week up to that game.
--
-- public.review_game_records runs when a game goes final AND again whenever lines are written to that game later
-- (review_records_on_stats_write: a merged restart, a re-import, a Stats manager repair). Two of its readings were "now":
--   * membership: a roster_spots row for that club AS IT STANDS NOW. A re-review of a game from before a trade or a
--     waiver reported a player who was on the club that night as "on no squad", "rostered by" the new club, to the
--     officiating desk and #casework. It already happened: .-ZaZa's Utah game of Oct 9 was flagged "rostered by DET" after
--     a waiver moved the spot, and Rhegain's Utah game of Oct 2 needed an office ruling (unrostered_cleared). Rehearsed on
--     every final of the season: a full re-review would have raised 196 such flags; it then raised 11, which this comment
--     first called true. They were not: those players were on the roster, in stints the record had missed (ended before
--     the removal archive began, or under the merged Jugg account's earlier account). Part 3
--     (sql/2026-10-15-tenure-fixes-v414.sql) rebuilds them; with them on record a full re-review raises none.
--   * the weekly limit: player_week_games counts the player's WHOLE week as it stands now, so a re-review of an early game
--     counted the games he played after it and reported it "over the game limit" (113 such flags on a full re-review). It
--     now counts his games up to and including this one in schedule order, which is what public._limit_forfeit_check
--     already counted; both now use one helper, public.player_week_games_through.
-- public._limit_forfeit_check (the automatic over-limit forfeit, re-run for the rest of a week by _limit_forfeit_recheck)
-- read the squad for the weekly cap from today's roster too. This season's caps are 3 in training camp and 6 otherwise,
-- so the squad decides a forfeit.
--
-- The one definition is the v4.14 record of the clubs each player has been on (public.roster_tenures, part 1):
--   public._tenures_at_game(profile, game)      the member's stints overlapping the game's window (ten minutes before
--                                               puck drop to three hours after, the import window of Rule 6.2)
--   public._club_evidence(profile, club, game)  on top of it: 'roster' with the stint's position and squad (the stint
--                                               that contains puck drop first), else 'lineup' when the club's own
--                                               lineup named him. Membership, squad and position in both checks come
--                                               from a ROSTER stint only: a lineup naming a player is not membership,
--                                               and dressing someone off the roster is exactly what the flag is for.
-- Squad history: from now on a squad move (to training camp, up to the active roster) ends a stint and starts the next,
-- so a re-check reads the squad the player had at puck drop. Squad moves made before today are not on record (the
-- league kept only a count of them), so for those the squad is read as it stands now, exactly as before; the stints that
-- ended in a trade carry no squad at all (see below). On a full re-review 37 over-limit findings remain, all players in
-- camp today whose early-season games were most likely played on the active roster; they are reported only if a game of
-- theirs is re-reviewed, as before.
-- Rehearsed (rolled back) on production; the counts above are its results.

-- The squad of a stint that ended in a trade is unknown: a trade resets the squad (reset_squad_on_team_change,
-- _place_trade_arrivals), and the part 1 backfill carried each spot's later squad back onto the clubs it was traded away
-- from (pmister3, in camp at Boston now, read as camp at Utah). A guess must not decide a forfeit: recorded as null, which
-- every reader treats exactly as the old lookup treated a player no longer on that club.
update public.roster_tenures set squad = null
 where left_how in ('traded', 'trade reversed') and squad is not null;

-- A squad move ends a stint (same club) from now on; a position change is kept on the open stint.
create or replace function public._roster_tenure_track()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v4.14: one stint per club and squad. A new spot opens a stint, a change of club or of squad closes it and opens the next
   (so the squad at any game time is on record), a removal closes it (with the reason the caller set in app.roster_reason,
   as archive_roster_spot reads it). A change of position is kept on the open stint. Fails loudly: a roster write whose
   history cannot be recorded does not go through. */
declare v_why text := nullif(btrim(coalesce(current_setting('app.roster_reason', true), '')), '');
        v_move text;
begin
  if tg_op = 'INSERT' then
    insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, joined_how)
    values (new.season_id, new.profile_id, new.team_id, new.id, new.position::text, new.squad,
            coalesce(new.created_at, now()), coalesce(nullif(new.origin, ''), 'placed'));
  elsif tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id or new.squad is distinct from old.squad then
      v_move := case when new.team_id is distinct from old.team_id then 'moved to another club'
                     when new.squad = 'tc' then 'moved to training camp'
                     when new.squad = 'pro' then 'moved up to the active roster' else 'squad changed' end;
      update public.roster_tenures set left_at = now(), left_how = v_move
       where season_id = old.season_id and profile_id = old.profile_id and left_at is null;
      insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, joined_how)
      values (new.season_id, new.profile_id, new.team_id, new.id, new.position::text, new.squad, now(),
              case when new.team_id is distinct from old.team_id then 'moved from another club' else v_move end);
    elsif new.position is distinct from old.position then
      update public.roster_tenures set position = new.position::text
       where season_id = new.season_id and profile_id = new.profile_id and left_at is null;
    end if;
  else
    update public.roster_tenures set left_at = now(), left_how = coalesce(v_why, 'removed')
     where season_id = old.season_id and profile_id = old.profile_id and left_at is null;
  end if;
  return null;
end $function$;
revoke all on function public._roster_tenure_track() from public, anon, authenticated;

create or replace function public._tenures_at_game(p_profile uuid, p_game uuid)
 returns setof public.roster_tenures
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v4.14: the one definition of "on a club at the time of a game": the member's stints that overlap the game's window
     (ten minutes before puck drop to three hours after, the import window of Rule 6.2) */
  select rt.* from public.roster_tenures rt join public.games g on g.id = p_game
   where rt.profile_id = p_profile and rt.season_id = g.season_id
     and rt.joined_at <= g.scheduled_at + interval '3 hours'
     and (rt.left_at is null or rt.left_at >= g.scheduled_at - interval '10 minutes')
$function$;
revoke all on function public._tenures_at_game(uuid, uuid) from public, anon, authenticated;

create or replace function public._club_evidence(p_profile uuid, p_team uuid, p_game uuid)
 returns table(how text, pos text, squad text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v4.14: a stint on the club at the time of the game (public._tenures_at_game), the one that contains puck drop first,
     with that stint's position and squad; else the club's own lineup for that game naming the member. No row: no evidence
     that the member played for this club in this game. */
  (select 'roster'::text, t.position, t.squad
     from public._tenures_at_game(p_profile, p_game) t join public.games g on g.id = p_game
    where t.team_id = p_team
    order by (t.joined_at <= g.scheduled_at and (t.left_at is null or t.left_at > g.scheduled_at)) desc, t.joined_at desc
    limit 1)
  union all
  (select 'lineup'::text, null::text, null::text
     from public.game_lineups gl
    where gl.game_id = p_game and gl.team_id = p_team
      and p_profile in (gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie)
      and not exists (select 1 from public._tenures_at_game(p_profile, p_game) t where t.team_id = p_team)
    limit 1)
$function$;
revoke all on function public._club_evidence(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.player_week_games_through(p_game uuid, p_profile uuid)
 returns integer
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v4.14 (Rule 5.2): the player's games of this game's limit week up to and including this one, in schedule order:
     whether THIS game took him over the limit. A held game (box score on file) counts (v3.93); a voided or exempt game
     never does. The one count _limit_forfeit_check and review_game_records both use. */
  select count(*)::int from public.games g join public.games g0 on g0.id = p_game
   where g.season_id = g0.season_id and coalesce(g.stage, 'regular') = coalesce(g0.stage, 'regular')
     and coalesce(g.limit_week, g.week) = coalesce(g0.limit_week, g0.week)
     and (g.status = 'final' or (g.status = 'scheduled' and g.ea_match_id is not null))
     and not coalesce(g.voided, false) and not coalesce(g.limits_exempt, false)
     and (g.scheduled_at < g0.scheduled_at or (g.scheduled_at = g0.scheduled_at and g.id <= g0.id))
     and exists (select 1 from public.game_stats gs where gs.game_id = g.id and gs.profile_id = p_profile)
$function$;
revoke all on function public.player_week_games_through(uuid, uuid) from public, anon, authenticated;

do $p$
declare v_def text := pg_get_functiondef('public.review_game_records(uuid)'::regprocedure);
  a1 text := $a$    select rs.squad, rs.position::text into v_squad, v_pos from public.roster_spots rs
      where rs.season_id = g.season_id and rs.team_id = r.team_id and rs.profile_id = r.profile_id limit 1;
    v_rostered := found;$a$;
  b1 text := $b$    /* v4.14: the roster AS IT STOOD WHEN THE GAME WAS PLAYED (public._club_evidence), not as it stands now: a re-review
       of a game from before a trade or waiver (a merged restart, a re-import, a repair) no longer reports a player who
       was on the club that night. A lineup naming him is not membership, so only a roster stint counts here. */
    select e.squad, e.pos into v_squad, v_pos from public._club_evidence(r.profile_id, r.team_id, p_game) e
     where e.how = 'roster' limit 1;
    v_rostered := found;$b$;
  a2 text := $a$      select string_agg(t2.code, ', ') into v_elsewhere from public.roster_spots rs2
        join public.teams t2 on t2.id = rs2.team_id
       where rs2.season_id = g.season_id and rs2.profile_id = r.profile_id;$a$;
  b2 text := $b$      /* v4.14: the club he was on at the time of the game, if any */
      select string_agg(distinct t2.code, ', ') into v_elsewhere from public._tenures_at_game(r.profile_id, p_game) tg
        join public.teams t2 on t2.id = tg.team_id where tg.team_id <> r.team_id;$b$;
  a3 text := $a$' and is on neither its active roster nor its training camp. ' ||
        case when v_elsewhere is null then 'He is on no CGHL roster this season.'
             else 'He is rostered by ' || v_elsewhere || '.' end || ' (Rule 4.2)');$a$;
  b3 text := $b$' and was on neither its active roster nor its training camp when the game was played. ' ||
        case when v_elsewhere is null then 'The player was on no CGHL roster at the time.'
             else 'At the time the player was on ' || v_elsewhere || '.' end || ' (Rule 4.2)');$b$;
  a4 text := $a$' is on ' || coalesce(v_team,'?') ||$a$;
  b4 text := $b$' was on ' || coalesce(v_team,'?') ||$b$;
  a5 text := $a$'. Only a training camp player fills any position. His squad is read as it stands now. (Rule 2.1)');$a$;
  b5 text := $b$'. Only a training camp player fills any position. The squad is read from the player''s time on that club. (Rule 2.1)');$b$;
  a6 text := $a$    v_n := public.player_week_games(g.season_id, g.stage, coalesce(g.limit_week, g.week), r.profile_id, null);$a$;
  b6 text := $b$    /* v4.14: his games of the week up to and including this one (what _limit_forfeit_check counts), not the whole week
       as it stands now: a re-review of an early game no longer counts the games he played after it */
    v_n := public.player_week_games_through(p_game, r.profile_id);$b$;
  a7 text := $a$') has now played ' || v_n || ' games in week ' || coalesce(g.limit_week, g.week) ||
        '; the limit is ' || v_cap || '. (Rule 5.2)');$a$;
  b7 text := $b$') had played ' || v_n || ' games in week ' || coalesce(g.limit_week, g.week) ||
        ' with this one; the limit is ' || v_cap || '. (Rule 5.2)');$b$;
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then raise exception 'v4.14b: review anchor 1 (roster)'; end if;
  if (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then raise exception 'v4.14b: review anchor 2 (elsewhere)'; end if;
  if (length(v_def) - length(replace(v_def, a3, ''))) / length(a3) <> 1 then raise exception 'v4.14b: review anchor 3 (words)'; end if;
  if (length(v_def) - length(replace(v_def, a4, ''))) / length(a4) <> 1 then raise exception 'v4.14b: review anchor 4 (was on)'; end if;
  if (length(v_def) - length(replace(v_def, a5, ''))) / length(a5) <> 1 then raise exception 'v4.14b: review anchor 5 (squad)'; end if;
  if (length(v_def) - length(replace(v_def, a6, ''))) / length(a6) <> 1 then raise exception 'v4.14b: review anchor 6 (week count)'; end if;
  if (length(v_def) - length(replace(v_def, a7, ''))) / length(a7) <> 1 then raise exception 'v4.14b: review anchor 7 (limit words)'; end if;
  execute replace(replace(replace(replace(replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3), a4, b4), a5, b5), a6, b6), a7, b7);
end $p$;

do $p$
declare v_def text := pg_get_functiondef('public._limit_forfeit_check(uuid)'::regprocedure);
  a1 text := $a$    select rs.squad, rs.position::text into v_squad, v_pos from public.roster_spots rs
     where rs.season_id = g.season_id and rs.team_id = r.team_id and rs.profile_id = r.profile_id limit 1;$a$;
  b1 text := $b$    /* v4.14: the squad and position he held with this club when the game was played (public._club_evidence) */
    select e.squad, e.pos into v_squad, v_pos from public._club_evidence(r.profile_id, r.team_id, g.id) e
     where e.how = 'roster' limit 1;$b$;
  a2 text := $a$    select count(*) into v_n from public.games g2
     where g2.season_id = g.season_id and coalesce(g2.stage, 'regular') = 'regular'
       and coalesce(g2.limit_week, g2.week) = v_week
       and (g2.status = 'final' or (g2.status = 'scheduled' and g2.ea_match_id is not null))
       and not coalesce(g2.voided, false) and not coalesce(g2.limits_exempt, false)
       and (g2.scheduled_at < g.scheduled_at or (g2.scheduled_at = g.scheduled_at and g2.id <= g.id))
       and exists (select 1 from public.game_stats gs where gs.game_id = g2.id and gs.profile_id = r.profile_id);$a$;
  b2 text := $b$    v_n := public.player_week_games_through(g.id, r.profile_id);   /* v4.14: the one count (same rule as before) */$b$;
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then raise exception 'v4.14b: limit anchor (roster)'; end if;
  if (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then raise exception 'v4.14b: limit anchor (count)'; end if;
  execute replace(replace(v_def, a1, b1), a2, b2);
end $p$;

do $chk$
declare v_rev text := pg_get_functiondef('public.review_game_records(uuid)'::regprocedure);
        v_lim text := pg_get_functiondef('public._limit_forfeit_check(uuid)'::regprocedure);
begin
  if position('_club_evidence(r.profile_id, r.team_id, p_game)' in v_rev) = 0 or position('from public.roster_spots rs' in v_rev) > 0
     or position('player_week_games_through(p_game, r.profile_id)' in v_rev) = 0 then
    raise exception 'v4.14b: review_game_records still reads today''s roster or the whole week';
  end if;
  if position('_club_evidence(r.profile_id, r.team_id, g.id)' in v_lim) = 0 or position('player_week_games_through(g.id, r.profile_id)' in v_lim) = 0 then
    raise exception 'v4.14b: _limit_forfeit_check still reads today''s roster or counts on its own';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where grantee in ('anon', 'authenticated', 'PUBLIC') and routine_schema = 'public'
                and routine_name in ('_tenures_at_game', '_club_evidence', 'player_week_games_through', 'review_game_records',
                                     '_limit_forfeit_check', '_roster_tenure_track')) then
    raise exception 'v4.14b: an internal function is executable by members';
  end if;
end $chk$;
