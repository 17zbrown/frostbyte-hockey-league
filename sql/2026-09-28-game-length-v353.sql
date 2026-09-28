-- v3.53: how long a game has to be before it is a result, and what happens when it is split.
--
-- Commissioner, 2026-09-28:
--   Go-ahead #9: "You just need to make sure if a game does not come in as finished the first time, you
--     need to wait for a 2nd game is read so you can link the two. Understand a game with a disconnect
--     happens and the game splits into two sessions, the 2nd game may run long if they need to play an
--     overtime."
--   Q18: "Once it reaches a full game but keep in mind there may be a simulated overtime played so if a
--     game comes back over the 60 minutes had is only a 1 goal game, that probably means it was an
--     overtime win. Flag any games that go over the 60 minutes but is more than a 1 goal game to staff."
--   Q19: "No, the game will be fully restarted and any stats will be removed. If any games are restarted
--     only 10 in game minutes into the first period, the game shall just be restarted from the
--     beginning of the first period."
--   Q20: "An overtime disconnect should result in a penalty for the disconnecting team and the teams
--     should resume their new overtime starting in the first period of the reloaded game session."
-- The importer half is in netlify/functions/ingest-stats.js (sittingsState). This file is the database half.

/* ---- 1. The archive may say what the importer says -------------------------------------------
   v3.18 taught the importer to archive a held first sitting as 'incomplete', but the check constraint
   was never widened, so every hold's archive write failed (the importer reported "its archive row could
   not be marked incomplete") and the row sat at 'unmatched' until the next poll's dedupe rewrote it.
   Found in the v3.53 audit; the unit tests stub the database and could not see it. 'struck' is new: a
   sitting removed from the record because the game was restarted from the beginning (Q19). */
alter table public.ea_ingest_log drop constraint if exists ea_ingest_log_status_check;
alter table public.ea_ingest_log add constraint ea_ingest_log_status_check
  check (status = any (array['ingested','merged','unmatched','skipped','error','ignored','incomplete','struck']));

/* ---- 2. Incident rulings for an overtime drop and an early drop ------------------------------- */
alter table public.game_incidents add column if not exists early_first boolean not null default false;

drop function if exists public.log_game_incident(uuid, uuid, text, integer, integer, text, boolean, text);
create function public.log_game_incident(p_game uuid, p_team uuid, p_kind text, p_minutes_late integer default null,
    p_period integer default null, p_game_clock text default null, p_early_third boolean default false,
    p_notes text default null, p_early_first boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
/* KEEP IN SYNC with ruling() in bot/incidents.mjs, which announces the same text to both clubs. */
declare v_g record; v_n int; v_owed int; v_msg text; v_ot boolean := coalesce(p_period, 0) = 4;
        v_e1 boolean := coalesce(p_early_first, false) and coalesce(p_period, 0) = 1;
        v_e3 boolean := coalesce(p_early_third, false) and coalesce(p_period, 0) = 3;
begin
  if not public._is_stats_staff() then
    raise exception 'Only statistics staff can log a game incident.';
  end if;
  select * into v_g from public.games where id = p_game;
  if v_g is null then raise exception 'No such game.'; end if;
  if p_team not in (v_g.home_team_id, v_g.away_team_id) then
    raise exception 'That club is not in this game.';
  end if;
  if p_kind not in ('late_start','disconnect') then
    raise exception 'Unknown incident kind.';
  end if;

  select count(*) + 1 into v_n from public.game_incidents
    where game_id = p_game and team_id = p_team and kind = p_kind;

  if p_kind = 'late_start' then
    v_owed := case when coalesce(p_minutes_late,0) >= 10 then -1
                   when p_minutes_late >= 8 then 2
                   when p_minutes_late >= 5 then 1
                   else 0 end;
    v_msg := case v_owed
      when -1 then 'Ten minutes past game time: forfeit under Rule 3.2 (1-0, no player statistics). Not waivable.'
      when 2 then 'Two penalties at the start of the game. The club that was ready chooses: both at once (5-on-3) or one after the other (two 5-on-4s).'
      when 1 then 'One penalty at the start of the game.'
      else 'Inside the five-minute grace: nothing owed.' end;
  else
    v_owed := case when v_n >= 3 then -1 when v_n = 2 then 2 else 1 end;
    if v_owed = -1 then
      v_msg := 'Third disconnection: forfeit loss for this club, ALL statistics retained. Merge the sessions first, then rule the forfeit keeping the played result.';
    else
      v_msg := case v_owed when 2 then 'Two penalties on the reload. The other club chooses: both at once (5-on-3) or one after the other (two 5-on-4s).'
                           else 'One penalty on the reload.' end;
      v_msg := v_msg || case
        /* Q20 */
        when v_ot then ' Overtime: the clubs reload and play the first period of the new game as sudden-death overtime, and the penalty is taken as soon as possible after puck drop. The importer adds the overtime to the game.'
        when v_e3 then ' Inside the first five minutes of the third: do not replay a full game. Play the entire first period as if it were the third, penalties as soon as possible after puck drop.'
        when coalesce(p_period,0) = 3 then ' Third period: take it five minutes of game clock EARLIER than the disconnection.'
        /* Q19 */
        when v_e1 then ' Inside the first ten minutes of the first period: restart the game from the beginning of the first period. The stopped sitting is struck and its statistics removed. Take the penalty within one minute of the game-clock time of the disconnection.'
        else ' Take it within one minute of the game-clock time of the disconnection.' end;
    end if;
  end if;

  insert into public.game_incidents(game_id, team_id, kind, occurrence, minutes_late, period,
      game_clock, early_third, early_first, penalties_owed, notes, reported_by)
    values (p_game, p_team, p_kind, v_n, p_minutes_late, p_period, p_game_clock,
      v_e3, v_e1, greatest(v_owed, 0), p_notes, auth.uid());

  return jsonb_build_object('ok', true, 'occurrence', v_n, 'penalties', v_owed,
    'ruling', v_msg, 'forfeit', v_owed = -1);
end $fn$;
revoke all on function public.log_game_incident(uuid,uuid,text,integer,integer,text,boolean,text,boolean) from public, anon;
grant execute on function public.log_game_incident(uuid,uuid,text,integer,integer,text,boolean,text,boolean) to authenticated, service_role;

/* ---- 3. Rule 4.3.9 can fire on a HELD game ----------------------------------------------------
   Since v3.18 an unfinished game is held (scheduled, carrying its sittings) rather than published, but
   the abandonment ruling only accepted a final, so the automatic ruling the commissioner ordered on
   2026-09-23 could never fire. The importer now passes the score it read from the sittings; the
   ruling files the result, the forfeit and the scores in ONE write, so notify_discord_game_final
   announces it once, as "Final (forfeit)". */
drop function if exists public.forfeit_abandoned_game(uuid, uuid, text);
create function public.forfeit_abandoned_game(p_game uuid, p_forfeiting_team uuid, p_reason text,
    p_home_score integer default null, p_away_score integer default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_g record; v_winner uuid; v_hs int; v_as int; v_held boolean;
begin
  if not public.trusted_writer() then
    raise exception 'Only the league''s importer may rule an abandoned game.' using errcode = '42501'; end if;
  select * into v_g from public.games where id = p_game;
  if v_g is null then raise exception 'No such game.' using errcode = 'P0002'; end if;
  if v_g.voided then raise exception 'That game is voided.' using errcode = '22023'; end if;
  if v_g.forfeit_team_id is not null then
    return jsonb_build_object('ok', false, 'already_ruled', true); end if;
  v_held := v_g.status = 'scheduled' and v_g.ea_match_id is not null;
  if v_held then
    if p_home_score is null or p_away_score is null then
      raise exception 'A held game is ruled on the score its sittings add up to; pass it.' using errcode = '22023'; end if;
    v_hs := p_home_score; v_as := p_away_score;
  elsif v_g.status = 'final' and v_g.home_score is not null then
    v_hs := v_g.home_score; v_as := v_g.away_score;
  else
    raise exception 'Only a filed or held game can be ruled abandoned.' using errcode = '22023';
  end if;
  if p_forfeiting_team not in (v_g.home_team_id, v_g.away_team_id) then
    raise exception 'That club is not in this game.' using errcode = '22023'; end if;
  if v_hs = v_as then
    raise exception 'The game is level: no club is ahead, so nobody can be given the win.' using errcode = '22023'; end if;
  v_winner := case when p_forfeiting_team = v_g.home_team_id then v_g.away_team_id else v_g.home_team_id end;
  if (v_winner = v_g.home_team_id and v_hs < v_as) or (v_winner = v_g.away_team_id and v_as < v_hs) then
    raise exception 'The club ahead keeps the win under Rule 4.3; the forfeit is charged to the club behind.' using errcode = '22023'; end if;
  if v_held then
    update public.games set status = 'final', home_score = v_hs, away_score = v_as, went_ot = false,
      forfeit_team_id = p_forfeiting_team where id = p_game;
  else
    update public.games set forfeit_team_id = p_forfeiting_team where id = p_game;
  end if;
  perform public.log_admin_action('abandoned_forfeit', 'game', p_game::text,
    jsonb_build_object('forfeited_by', (select code from public.teams where id = p_forfeiting_team),
                       'winner', (select code from public.teams where id = v_winner),
                       'score', v_hs || '-' || v_as, 'was_held', v_held,
                       'reason', coalesce(p_reason, 'abandoned under Rule 4.3')));
  /* a game that was already final was announced as an ordinary Final; say what changed. A held game
     was never announced, and the write above announces it once, as a forfeit. */
  if not v_held then
    begin
      perform public.notify_discord('discord_scores_webhook',
        format('🏒 **Forfeit (Rule 4.3)**: %s %s–%s %s stands. %s abandoned the game and is charged with the forfeit; every statistic earned in it counts.',
          public.team_mention(v_g.home_team_id), v_hs, v_as,
          public.team_mention(v_g.away_team_id), public.team_mention(p_forfeiting_team)), false);
    exception when others then
      raise warning 'forfeit_abandoned_game scores post failed for game %: %', p_game, sqlerrm;
    end;
  end if;
  return jsonb_build_object('ok', true, 'winner', v_winner, 'kept_result', true,
    'score', v_hs || '-' || v_as, 'was_held', v_held);
end $fn$;
revoke all on function public.forfeit_abandoned_game(uuid,uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.forfeit_abandoned_game(uuid,uuid,text,integer,integer) to service_role;

/* Staff's own door for the same ruling (the "three disconnections / abandoned" kind of the Stats
   manager's forfeit card) now works on a held game too: its score is read from the box score the
   held sittings wrote. Before this it demanded a final, so the held-game notice steered staff to the
   Rule 3.2 no-show forfeit, which deletes every statistic: the opposite of Rule 4.3.9. */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.forfeit_game(uuid,uuid,text,boolean)'::regprocedure);
  d := replace(d0, 'declare v_g record; v_winner uuid;', 'declare v_g record; v_winner uuid; v_hs int; v_as int;');
  if d = d0 then raise exception 'forfeit_game declare patch matched nothing'; end if;
  d0 := d;
  d := replace(d0,
'  if coalesce(p_keep_result, false) then
    if v_g.status <> ''final'' or v_g.home_score is null then',
'  if coalesce(p_keep_result, false) then
    /* v3.53: a HELD game (sittings in, no result yet) is ruled on the score its box score adds up to,
       and the result, the score and the forfeit go in one write. */
    if v_g.status = ''scheduled'' and v_g.ea_match_id is not null
       and exists (select 1 from public.game_stats s where s.game_id = p_game) then
      update public.games set status = ''final'', went_ot = false, forfeit_team_id = p_forfeiting_team,
        home_score = (select coalesce(sum(s.goals),0) from public.game_stats s where s.game_id = p_game and s.team_id = v_g.home_team_id),
        away_score = (select coalesce(sum(s.goals),0) from public.game_stats s where s.game_id = p_game and s.team_id = v_g.away_team_id)
        where id = p_game
        returning home_score, away_score into v_hs, v_as;
      perform public.log_admin_action(''abandoned_forfeit'', ''game'', p_game::text,
        jsonb_build_object(''forfeited_by'', (select code from public.teams where id = p_forfeiting_team),
                           ''score'', v_hs || ''-'' || v_as, ''was_held'', true, ''by'', ''statistics'',
                           ''reason'', coalesce(p_reason, ''abandoned or three disconnections (Rule 4.3)'')));
      return jsonb_build_object(''ok'', true, ''winner'', v_winner, ''kept_result'', true, ''was_held'', true,
        ''score'', v_hs || ''-'' || v_as,
        ''note'', coalesce(p_reason, ''abandoned or three disconnections (Rule 4.3)''));
    end if;
    if v_g.status <> ''final'' or v_g.home_score is null then');
  if d = d0 then raise exception 'forfeit_game patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- 4. The held-game notice names the right door --------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.review_held_games(integer)'::regprocedure);
  d := replace(d0,
$o$    perform public.notify_department('statistics','flag','A held game never finished',
      r.home||' v '||r.away||' on '||to_char(r.scheduled_at at time zone 'America/New_York','Mon DD')||
      ' took a sitting of '||v_min||' minutes and the rest of it never arrived, so no result has been '||
      'published. Either the clubs replayed it somewhere the importer did not see (merge it from the '||
      'club game stats desk, Rule 4.3), or the game was abandoned and somebody forfeited (Rule 3.2). '||
      'It stays unplayed on the schedule until one of you rules.', 'game', r.id::text);$o$,
$n$    /* v3.53: the door is Rule 4.3's, not 3.2's. A no-show forfeit deletes the statistics the clubs
       earned; an abandoned game keeps them. And a game held level at the end of sixty minutes is
       waiting for its overtime, not for the rest of regulation. */
    perform public.notify_department('statistics','flag','A held game never finished',
      r.home||' v '||r.away||' on '||to_char(r.scheduled_at at time zone 'America/New_York','Mon DD')||
      case when v_min >= 60
        then ' was level after '||v_min||' minutes and its overtime never arrived, so no result has been published. '
        else ' has '||v_min||' minutes of play in and the rest of it never arrived, so no result has been published. ' end||
      'If the clubs finished it somewhere the importer did not see, merge the sittings in the Stats manager (Rule 4.3). '||
      'If it was abandoned, rule it in the Stats manager''s Forfeit a game card with the three-disconnections kind: the club ahead '||
      'takes the win and both clubs keep their statistics (Rule 4.3.9). Do not use the no-show forfeit, which deletes them. '||
      'A level game is the league office''s to rule. It stays unplayed on the schedule until one of you acts.', 'game', r.id::text);$n$);
  if d = d0 then raise exception 'review_held_games patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- 5. The one game already on the record that the new rule would have flagged ----------------
   SEA v NYI, Friday September 25: two sittings merged to 3,912 seconds of game clock (65 minutes) and a
   9-5 result. Over sixty minutes by more than one goal is exactly what Q18 says to put in front of
   staff. It was filed as an ordinary regulation result on the old rule; the result is not changed here. */
do $once$ begin
  if not exists (select 1 from public.admin_audit where action = 'overlong_game_flagged' and target_id = '8a4a7577-2e4e-4247-8e1a-7c7f9a5ba8b9') then
    perform public.notify_department('statistics', 'flag', 'A merged game ran past 60 minutes by more than a goal',
      'NYI @ SEA on Friday, September 25 was merged from two sittings totaling 65 minutes of game clock and finished 9-5 as a regulation result. '||
      'A game that runs past sixty minutes should be a one-goal overtime result (Rule 4.3), so the second sitting may have been a full replay rather than the rest of the game. '||
      'Check the sittings in the Stats manager. If the result is wrong, report it to the commissioners from the game.',
      'game', '8a4a7577-2e4e-4247-8e1a-7c7f9a5ba8b9');
    perform public.log_admin_action('overlong_game_flagged', 'game', '8a4a7577-2e4e-4247-8e1a-7c7f9a5ba8b9',
      jsonb_build_object('clock_s', 3912, 'score', '9-5', 'by', 'v3.53 backfill'));
  end if;
end $once$;

/* REHEARSAL (2026-09-28, one transaction, rolled back): every check passed.
   T1  ea_ingest_log accepts 'incomplete' and 'struck'.
   T2  log_game_incident as a statistics staffer: a period-4 drop gets the sudden-death overtime ruling;
       a period-1 drop with the early flag gets the restart-from-the-beginning ruling and stores
       early_first; the early flag on a period-3 drop does NOT become early_first.
   T3  forfeit_abandoned_game on a HELD game: refused without the trusted writer; refused without a
       score; refused when charging the club ahead; refused when level; then files status final,
       1-3, forfeit on the club behind, in one write, and reports was_held.
   T4  forfeit_game(keep_result) by a statistics staffer on a HELD game reads the box score (2-1),
       files it final and charges the named club.
   T5  review_held_games names the three-disconnections door and Rule 4.3.9. */
