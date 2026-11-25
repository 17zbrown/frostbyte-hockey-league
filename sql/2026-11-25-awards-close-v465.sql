-- v465 (2026-11-25): the voted awards close, and are decided and announced, at the next season's owner application deadline.
--
-- Ruling this builds (league law, quoted from the commissioner, 2026-11-25):
--   "set the award announcement date to be the same date as the owner application deadline"
-- Read as: a season's four voted awards (Most Valuable Player, Best Goaltender, Best Defenseman, Rookie of the Year; Rules
-- 9.1 and 9.2) close, and the league office decides and announces each one, at the owner application deadline of the season
-- that follows it (Rule S2.1 sets when owner applications close). For Season 1 that is Season 2's
-- seasons.owner_app_deadline, 2026-11-29 04:59 UTC: 11:59 PM Eastern Time on Saturday, November 28, 2026. The vote closes
-- at that moment. Kept, not reopened: the award
-- goes to the playoff-eligible player with the most votes (v3.60, Q37), and a commissioner decides only a tie among the
-- leaders (Q38, Rule 9.2). An award with no vote for an eligible player is not decided automatically either: it waits for
-- a commissioner too.
--
-- Before this, nothing closed the vote: a ballot could be cast or changed until a commissioner pressed Finalize on that
-- award, and nothing decided an award on its own. Season 1's four awards stood undecided on 2026-11-25 with seven ballots
-- each (one, Best Goaltender, tied at the top among eligible players).
-- A later read the same day (2026-11-25, counts only): nine ballots each, every award with exactly one eligible leader, none
-- decided. Unless the votes change before the close, the close decides all four by itself and the news table's trigger
-- posts four stories to the Discord news channel at that minute.
--
-- ONE definition of the time: public.awards_close_at reads the next season's owner_app_deadline, so if the commissioner
-- moves that deadline, the vote's close and the announcement move with it. The ballot guard, the automatic close and the
-- Season 2 site (M.awardsCloseAt, js/model.js, which reads the same seasons row and names this function as the authority)
-- all follow it.
--
-- What changes:
--   1. public.awards_close_at(season) (new, anon and authenticated may call it; the site may show it): the
--      owner_app_deadline of the season numbered one more than this one; null when there is no such season or it has no
--      deadline yet (Season 2's awards wait for Season 3's row). public._awards_close_words(at) (new, internal): that
--      instant as the refusals say it, "11:59 PM ET on Saturday, November 28", written once.
--   2. public.guard_award_ballot() (the BEFORE INSERT OR UPDATE trigger on award_ballots): after awards_close_at has
--      passed, no vote is cast or changed, decided or not: "The Season 1 vote closed at 11:59 PM ET on Saturday,
--      November 28 (Rule 9.2)." (errcode 22023, as its siblings). Before the close, unchanged. Rewritten in
--      full from the production definition (read 2026-11-25 by pg_get_functiondef), now with search_path ''.
--   3. public._award_leaders(season, category) (new, internal): the ONE reading of who leads a voted award: the
--      playoff-eligible players (award_eligible, Rule 9.3) with the most votes; two or more when tied at the top, none
--      when no vote names an eligible player.
--   4. public._award_label(category) (new, internal): the award's name ("Best Goaltender"), written once for the news
--      story and the commissioners' notice.
--   5. public._finalize_season_award(season, category, winner, by) (new, internal, no client grant): the decision, moved
--      out of finalize_season_award unchanged in its rules and its words: the winner (the one leader, or the
--      commissioner's pick among the tied leaders), the awards row (decided_by 'ballot'), the news story (whose insert
--      posts it to the Discord news channel through notify_discord_news) and the admin_audit row, which now records who
--      decided it (by: 'commissioner' or 'close'). No award is decided before its vote closes (Rule 9.2): before the close,
--      and for a season with no next owner deadline yet, it refuses (22023) for both callers, saying when the vote closes.
--      An award is decided once: after a per-award advisory lock, an award already decided is left alone by the close
--      (null) and refused to a commissioner ("That award has been decided.", 22023), so a Finalize pressed after the
--      close's run can never post a second story.
--   6. public.finalize_season_award(season, category, winner) (the commissioner's Finalize; same signature, same grant to
--      authenticated, same check and messages): now the commissioner check, then the internal function.
--   7. public.close_season_awards() (new, internal): for every season whose vote has closed, each voted award not yet
--      decided is decided by the vote when it has one leader; a tie at the top, or no vote for an eligible player, is
--      left for a commissioner, who is told once (a bell to every commissioner, notify_commissioners, the house door for
--      "this needs a commissioner"; ledger app_config awards_wait_<season>_<category> holding the close instant and the
--      reason, so a moved deadline tells them again and a repeat run never does). Idempotent: a decided award is skipped.
--      Returns "<n> decided, <m> waiting for a commissioner". Stamps the heartbeat rl_awards-close.
--   8. The pg_cron job awards-close, every minute, runs close_season_awards(). Every minute, so the awards are decided
--      and posted at the deadline's own minute: 11:59 PM ET on Saturday, November 28 for Season 1, the same date as the
--      owner application deadline (a five-minute job would first run at 12:00 AM on Sunday, a different date).
--      Its own job, not a step of
--      deadline-sweep: _deadline_sweep is the movement deadline's sweep (Rule 2.4), a different instant, and it runs in one
--      transaction with no step isolated, so an awards failure would roll back the deadline's trade cancellations (and a
--      sweep failure would hold the awards). The house pattern for a lifecycle automation is its own job, a heartbeat
--      named after it and a line in the watchdog: playoff-autopilot (v4.40), club-season-close (v4.53), market-tick
--      (v4.58). A failed run fails the job, which automation_watchdog section 3 reports; section 4 now names awards-close,
--      so a job that stops firing is reported too (patched below by an anchored replacement).
-- Discord: only the news stories, through the news table's own trigger (notify_discord_news, then discord_http_post). The
-- commissioners' notice is a site bell, not a post.

/* ---- 1. when a season's vote closes ------------------------------------------------------------------------------ */
create or replace function public.awards_close_at(p_season uuid)
 returns timestamptz
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v465 (commissioner, 2026-11-25: "set the award announcement date to be the same date as the owner application
     deadline"): a season's voted awards (Rule 9.2) close, and are decided and announced, at the owner application deadline
     of the season after it. The ONE definition: the ballot guard, close_season_awards and the site (M.awardsCloseAt) all
     read it, so a moved deadline moves the awards. Null when there is no next season or it has no deadline yet. */
  select n.owner_app_deadline
    from public.seasons s join public.seasons n on n.number = s.number + 1
   where s.id = p_season
$function$;
revoke all on function public.awards_close_at(uuid) from public, anon, authenticated;
grant execute on function public.awards_close_at(uuid) to anon, authenticated;

create or replace function public._awards_close_words(p_at timestamptz)
 returns text
 language sql
 stable
 set search_path to ''
as $function$
  /* v465: the vote's close as the refusals say it, "11:59 PM ET on Saturday, November 28": the ballot guard after the
     close and the decision before it, written once */
  select to_char(p_at at time zone 'America/New_York', 'FMHH12:MI AM') || ' ET on '
      || to_char(p_at at time zone 'America/New_York', 'FMDay, FMMonth FMDD')
$function$;
revoke all on function public._awards_close_words(timestamptz) from public, anon, authenticated;

/* ---- 2. no vote after the close ---------------------------------------------------------------------------------- */
create or replace function public.guard_award_ballot()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_pos text; v_team uuid; v_mine uuid[]; v_name text; v_close timestamptz; v_num int;
begin
  if new.category not in ('mvp','best_goalie','best_defenseman','rookie_of_year') then
    raise exception 'That award is not decided by a vote (Rule 9.2).' using errcode = '22023'; end if;
  /* v465 (commissioner, 2026-11-25: "set the award announcement date to be the same date as the owner application
     deadline"): the vote closes at the next season's owner application deadline (awards_close_at), when the awards are
     decided and announced; after it no vote is cast or changed, decided or not */
  v_close := public.awards_close_at(new.season_id);
  if v_close is not null and now() >= v_close then
    select s.number into v_num from public.seasons s where s.id = new.season_id;
    /* "(Rule 9.2)", not "the awards are decided": a tie, or an award with no eligible vote, still waits for a commissioner */
    raise exception 'The Season % vote closed at % (Rule 9.2).', v_num, public._awards_close_words(v_close)
      using errcode = '22023';
  end if;
  if exists (select 1 from public.awards a where a.season_id = new.season_id and a.week is null and a.category = new.category) then
    raise exception 'That award has been decided; the vote is closed.' using errcode = '22023'; end if;
  if new.profile_id = new.voter_id then
    raise exception 'A vote for yourself is not counted (Rule 9.2).' using errcode = '22023'; end if;
  select rs.position::text, rs.team_id into v_pos, v_team from public.roster_spots rs
   where rs.season_id = new.season_id and rs.profile_id = new.profile_id and rs.status = 'active' limit 1;
  if v_team is null then raise exception 'Only a player on a club this season can be voted for.' using errcode = '22023'; end if;
  select coalesce(gamertag, 'That player') into v_name from public.profiles where id = new.profile_id;
  /* Rule 9.2.1: no vote for a member of your own club, whether you play for it or run it */
  select array_agg(distinct x) into v_mine from (
    select rs.team_id x from public.roster_spots rs where rs.season_id = new.season_id and rs.profile_id = new.voter_id and rs.status = 'active'
    union select t.id from public.teams t where new.voter_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id)) s;
  if v_team = any(coalesce(v_mine, '{}')) then
    raise exception '% plays for your own club; a vote goes to a player on another club (Rule 9.2).', v_name using errcode = '22023'; end if;
  if new.category = 'best_goalie' and v_pos <> 'G' then
    raise exception '% is not rostered as a goaltender.', v_name using errcode = '22023'; end if;
  if new.category = 'best_defenseman' and v_pos not in ('LD','RD') then
    raise exception '% is not rostered as a defenseman.', v_name using errcode = '22023'; end if;
  if new.category = 'rookie_of_year' and exists (select 1 from public.roster_spots rs join public.seasons s on s.id = rs.season_id
       where rs.profile_id = new.profile_id and s.number < (select number from public.seasons where id = new.season_id)) then
    raise exception '% is not in their first CGHL season (Rule 9.1).', v_name using errcode = '22023'; end if;
  new.updated_at := now();
  return new;
end $function$;
revoke all on function public.guard_award_ballot() from public, anon, authenticated;

/* ---- 3. who leads a voted award ---------------------------------------------------------------------------------- */
create or replace function public._award_leaders(p_season uuid, p_category text)
 returns table(profile_id uuid, votes int)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v465: the playoff-eligible players (award_eligible, Rule 9.3; v3.60 Q37: votes for anyone else are not counted) with
     the most votes for one award: more than one when tied at the top, none when no vote names an eligible player. The
     ONE reading: _finalize_season_award decides from it and close_season_awards leaves a tie or an empty vote to a
     commissioner by it. */
  with t as (
    select b.profile_id, count(*)::int n
      from public.award_ballots b
     where b.season_id = p_season and b.category = p_category and public.award_eligible(p_season, b.profile_id)
     group by b.profile_id)
  select t.profile_id, t.n from t where t.n = (select max(t2.n) from t t2)
$function$;
revoke all on function public._award_leaders(uuid, text) from public, anon, authenticated;

create or replace function public._award_label(p_category text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  /* v465: a voted award's name (Rule 9.1), written once for the news story and the commissioners' notice */
  select case p_category when 'mvp' then 'Most Valuable Player' when 'best_goalie' then 'Best Goaltender'
    when 'best_defenseman' then 'Best Defenseman' when 'rookie_of_year' then 'Rookie of the Year' end
$function$;
revoke all on function public._award_label(text) from public, anon, authenticated;

/* ---- 5. the decision, one definition for the commissioner's Finalize and the close -------------------------------- */
create or replace function public._finalize_season_award(p_season uuid, p_category text, p_winner uuid, p_by text)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_winner uuid; v_ties int; v_name text; v_team uuid; v_label text; v_close timestamptz; v_num int;
begin
  /* v465: moved out of finalize_season_award with its rules and its words unchanged, so the commissioner's Finalize
     (p_by 'commissioner') and the vote's close (p_by 'close', close_season_awards) write the same winner, awards row, news
     story and audit row. Returns the winner's name; null when the close finds the award already decided; a commissioner
     is refused a decided award. */
  if p_by is null or p_by not in ('commissioner', 'close') then
    raise exception '_finalize_season_award: p_by is commissioner or close, not %', coalesce(p_by, 'null');
  end if;
  if p_category not in ('mvp','best_goalie','best_defenseman','rookie_of_year') then
    raise exception 'Unknown award category: %', p_category;
  end if;
  /* v465 (Rule 9.2): no award is decided before its vote closes, by the close or by a commissioner. A season with no next
     owner deadline yet has no close, so nothing decides it yet; the refusal says when the vote closes */
  select s.number into v_num from public.seasons s where s.id = p_season;
  if v_num is null then raise exception 'No such season.' using errcode = '22023'; end if;
  v_close := public.awards_close_at(p_season);
  if v_close is null then
    raise exception 'The Season % vote closes when Season % owner applications close, and that deadline is not set yet; no award is decided before then (Rule 9.2).',
      v_num, v_num + 1 using errcode = '22023';
  end if;
  if now() < v_close then
    raise exception 'The Season % vote closes at %; no award is decided before then (Rule 9.2).', v_num, public._awards_close_words(v_close)
      using errcode = '22023';
  end if;
  /* one decision of one award at a time, and once: a commissioner's Finalize and a close run at the same moment queue
     here. Whoever comes second finds the award decided: the close leaves it (null), a commissioner is refused, so a
     Finalize pressed on a page painted before the close's run never posts a second news story */
  perform pg_advisory_xact_lock(hashtext('award ' || p_season::text || ' ' || p_category));
  if exists (select 1 from public.awards a where a.season_id = p_season and a.week is null and a.category = p_category) then
    if p_by = 'close' then return null; end if;
    raise exception 'That award has been decided.' using errcode = '22023';
  end if;
  /* v3.60 (Q37): only a playoff-eligible player can win (award_eligible); votes for anyone else are
     not counted. The commissioner picks only to break a tie among the leaders. */
  select count(*) into v_ties from public._award_leaders(p_season, p_category);
  if v_ties = 0 then raise exception 'No votes for an eligible player in % yet.', p_category; end if;
  if v_ties > 1 then
    if p_winner is null or p_winner not in (select l.profile_id from public._award_leaders(p_season, p_category) l) then
      raise exception 'The % vote is tied at the top; pick one of the tied players to break it.', p_category;
    end if;
    v_winner := p_winner;
  else
    select l.profile_id into v_winner from public._award_leaders(p_season, p_category) l;
    if p_winner is not null and p_winner <> v_winner then
      raise exception 'The winner is the eligible player with the most votes; a commissioner picks only to break a tie.';
    end if;
  end if;
  select coalesce(nullif(p.gamertag,''),'a player') into v_name from public.profiles p where p.id = v_winner;
  select rs.team_id into v_team from public.roster_spots rs
    where rs.season_id = p_season and rs.profile_id = v_winner limit 1;
  insert into public.awards (season_id, week, category, profile_id, team_id, decided_by)
    values (p_season, null, p_category, v_winner, v_team, 'ballot')
    on conflict (season_id, week, category) do update
      set profile_id = excluded.profile_id, team_id = excluded.team_id, decided_by = 'ballot';
  v_label := public._award_label(p_category);
  insert into public.news (season_id, category, title, author, published_at, body)
    values (p_season, 'Awards', v_name || ' named ' || v_label, 'CGHL Wire', now(),
      v_name || ' wins ' || v_label || ', decided by a vote of the league''s players and staff. Season hardware lives on the Awards page.');
  perform public.log_admin_action('award_finalized','award',p_category,
    jsonb_build_object('winner',v_name,'season',p_season,'by',p_by));
  return v_name;
end $function$;
revoke all on function public._finalize_season_award(uuid, text, uuid, text) from public, anon, authenticated;

/* ---- 6. the commissioner's Finalize ------------------------------------------------------------------------------ */
create or replace function public.finalize_season_award(p_season uuid, p_category text, p_winner uuid default null)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not public.is_commissioner() then raise exception 'Only a commissioner can finalize an award.'; end if;
  /* v465: the decision is _finalize_season_award's, the one the vote's close makes too. It refuses before the close, and
     for a season with no next owner deadline yet (Rule 9.2); from the close on, this is how a commissioner breaks a tie
     among the leaders (p_winner). */
  return public._finalize_season_award(p_season, p_category, p_winner, 'commissioner');
end $function$;
revoke all on function public.finalize_season_award(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finalize_season_award(uuid, text, uuid) to authenticated;

/* ---- 7. the close ------------------------------------------------------------------------------------------------- */
create or replace function public.close_season_awards()
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare s record; c text; v_n int; v_done int := 0; v_wait int := 0; v_key text; v_sig text; v_label text; v_who text; v_votes int;
begin
  /* v465 (commissioner, 2026-11-25: "set the award announcement date to be the same date as the owner application
     deadline"): the pg_cron job awards-close runs this every minute. For each season whose vote has closed
     (awards_close_at), each voted award not yet decided is decided by the vote when it has one leader
     (_finalize_season_award: the awards row, the news story the Discord news channel carries, the audit row). A tie at
     the top, or no vote for an eligible player, waits for a commissioner (Rule 9.2): every commissioner gets one bell
     per award and close instant (app_config awards_wait_<season>_<category>), so a repeat run never rings again and a
     moved deadline does. A decided award is skipped, so a second run changes nothing. A failure raises: the job fails
     and automation_watchdog reports it. */
  for s in select x.id, x.number, public.awards_close_at(x.id) as close_at from public.seasons x order by x.number loop
    continue when s.close_at is null or s.close_at > now();
    foreach c in array array['mvp','best_goalie','best_defenseman','rookie_of_year'] loop
      continue when exists (select 1 from public.awards a where a.season_id = s.id and a.week is null and a.category = c);
      select count(*) into v_n from public._award_leaders(s.id, c);
      if v_n = 1 then
        if public._finalize_season_award(s.id, c, null, 'close') is not null then v_done := v_done + 1; end if;
        continue;
      end if;
      v_wait := v_wait + 1;
      v_key := 'awards_wait_' || s.number || '_' || c;
      /* the instant in UTC, so the signature never depends on the session's TimeZone */
      v_sig := to_char(s.close_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || case when v_n = 0 then ' none' else ' tie' end;
      continue when (select k.value from public.app_config k where k.key = v_key) is not distinct from v_sig;
      v_label := public._award_label(c);
      if v_n = 0 then
        perform public.notify_commissioners(null, 'flag', format('Season %s %s needs a commissioner', s.number, v_label),
          format('The Season %s vote closed %s with no vote for a playoff-eligible player for %s, so it was not decided. It waits for a commissioner (Rule 9.2).',
            s.number, public._fmt_et(s.close_at), v_label), 'admin', null);
      else
        select string_agg(coalesce(nullif(p.gamertag, ''), 'a player'), ' and ' order by lower(p.gamertag)), max(l.votes)
          into v_who, v_votes
          from public._award_leaders(s.id, c) l join public.profiles p on p.id = l.profile_id;
        perform public.notify_commissioners(null, 'flag', format('Season %s %s is tied: a commissioner decides', s.number, v_label),
          format('The Season %s vote closed %s with %s tied at the top: %s, %s votes each. A commissioner breaks the tie with Finalize, picking one of them (Rule 9.2).',
            s.number, public._fmt_et(s.close_at), v_label, v_who, v_votes), 'admin', null);
      end if;
      insert into public.app_config (key, value) values (v_key, v_sig) on conflict (key) do update set value = excluded.value;
    end loop;
  end loop;
  insert into public.app_config (key, value)
    values ('rl_awards-close', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    on conflict (key) do update set value = excluded.value;
  return format('%s decided, %s waiting for a commissioner', v_done, v_wait);
end $function$;
revoke all on function public.close_season_awards() from public, anon, authenticated;

/* ---- 8. the schedule, and the watchdog that notices it stop ------------------------------------------------------- */
-- every minute: the tick at the deadline's own minute (04:59:00 UTC for 11:59 PM ET) decides and posts, on the deadline's date
-- shortcut: decided at the first minute tick at or after the deadline (pg_cron's step); a deadline with seconds past 11:59 PM
-- would announce at 12:00 AM the next day. Revisit if owner_app_deadline is ever set to a time with seconds.
select cron.schedule('awards-close', '* * * * *', 'select public.close_season_awards()');

do $patch$
declare v_def text; v_n int;
  v_old text := E'      (''playoff-autopilot'', interval ''1 hour''),   -- v4.40: the playoff draw\n';
  v_new text := E'      (''playoff-autopilot'', interval ''1 hour''),   -- v4.40: the playoff draw\n'
             || E'      (''awards-close'', interval ''1 hour''),   -- v465: the voted awards, decided at the next owner deadline\n';
begin
  v_def := pg_get_functiondef('public.automation_watchdog()'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'v465 awards close: the automation_watchdog anchor matched % times, want 1', v_n; end if;
  execute replace(v_def, v_old, v_new);
end $patch$;

/* ---- self-checks: every part in place, every grant as written, or nothing is kept ---------------------------------- */
do $chk$
declare f text; v_s1 uuid; v_s2 timestamptz;
begin
  foreach f in array array['public.awards_close_at(uuid)', 'public.guard_award_ballot()', 'public._award_leaders(uuid,text)',
      'public._finalize_season_award(uuid,text,uuid,text)', 'public.finalize_season_award(uuid,text,uuid)', 'public.close_season_awards()'] loop
    if not (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) then
      raise exception 'v465 awards close: % must be SECURITY DEFINER', f;
    end if;
    -- is distinct from: a function with no search_path has a null proconfig, which <> would let through
    if (select p.proconfig from pg_proc p where p.oid = f::regprocedure) is distinct from array['search_path=""'] then
      raise exception 'v465 awards close: % must run with search_path ''''', f;
    end if;
  end loop;
  foreach f in array array['public._award_label(text)', 'public._awards_close_words(timestamptz)'] loop
    if (select p.proconfig from pg_proc p where p.oid = f::regprocedure) is distinct from array['search_path=""'] then
      raise exception 'v465 awards close: % must run with search_path ''''', f;
    end if;
  end loop;
  -- the internal functions: no API role may call them
  foreach f in array array['public.guard_award_ballot()', 'public._award_leaders(uuid,text)', 'public._award_label(text)',
      'public._awards_close_words(timestamptz)', 'public._finalize_season_award(uuid,text,uuid,text)', 'public.close_season_awards()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or has_function_privilege('public', f, 'EXECUTE') then
      raise exception 'v465 awards close: % is callable through the API', f;
    end if;
  end loop;
  -- the client doors: the close time for everyone, Finalize for a signed-in member (the commissioner check inside it)
  if not has_function_privilege('anon', 'public.awards_close_at(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.awards_close_at(uuid)', 'EXECUTE') then
    raise exception 'v465 awards close: awards_close_at must be readable by anon and authenticated';
  end if;
  if not has_function_privilege('authenticated', 'public.finalize_season_award(uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finalize_season_award(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'v465 awards close: finalize_season_award must be callable by authenticated and not by anon';
  end if;
  -- the time is the next season's owner deadline: Season 1's, and every season's (null with no next row, Season 2 today)
  select s.id into v_s1 from public.seasons s where s.number = 1;
  select s.owner_app_deadline into v_s2 from public.seasons s where s.number = 2;
  if v_s1 is not null and public.awards_close_at(v_s1) is distinct from v_s2 then
    raise exception 'v465 awards close: Season 1 closes at %, not Season 2''s owner deadline %', public.awards_close_at(v_s1), v_s2;
  end if;
  if exists (select 1 from public.seasons s left join public.seasons n on n.number = s.number + 1
              where public.awards_close_at(s.id) is distinct from n.owner_app_deadline) then
    raise exception 'v465 awards close: a season''s close is not the owner deadline of the season after it';
  end if;
  -- the words, for the real Season 1 close
  if public._awards_close_words('2026-11-29 04:59:00+00'::timestamptz) is distinct from '11:59 PM ET on Saturday, November 28' then
    raise exception 'v465 awards close: the close reads %, not 11:59 PM ET on Saturday, November 28', public._awards_close_words('2026-11-29 04:59:00+00'::timestamptz);
  end if;
  -- the pieces are wired together
  if position('public.awards_close_at(new.season_id)' in pg_get_functiondef('public.guard_award_ballot()'::regprocedure)) = 0 then
    raise exception 'v465 awards close: the ballot guard does not read awards_close_at';
  end if;
  if position('public._finalize_season_award(p_season, p_category, p_winner, ''commissioner'')' in pg_get_functiondef('public.finalize_season_award(uuid,text,uuid)'::regprocedure)) = 0
     or position('public.is_commissioner()' in pg_get_functiondef('public.finalize_season_award(uuid,text,uuid)'::regprocedure)) = 0 then
    raise exception 'v465 awards close: finalize_season_award is not the commissioner check and the internal decision';
  end if;
  if position('v_close := public.awards_close_at(p_season);' in pg_get_functiondef('public._finalize_season_award(uuid,text,uuid,text)'::regprocedure)) = 0
     or position('raise exception ''That award has been decided.''' in pg_get_functiondef('public._finalize_season_award(uuid,text,uuid,text)'::regprocedure)) = 0 then
    raise exception 'v465 awards close: the decision does not wait for the close or decides an award twice';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.award_ballots'::regclass and t.tgname = 'guard_award_ballot_trg'
                   and t.tgfoid = 'public.guard_award_ballot()'::regprocedure and t.tgenabled = 'O') then
    raise exception 'v465 awards close: the ballot guard trigger is not on award_ballots';
  end if;
  if (select count(*) from cron.job j where j.jobname = 'awards-close' and j.active and j.schedule = '* * * * *'
        and j.command = 'select public.close_season_awards()') <> 1 then
    raise exception 'v465 awards close: the awards-close job is not scheduled every minute';
  end if;
  if (select count(*) from regexp_matches(pg_get_functiondef('public.automation_watchdog()'::regprocedure), '\(''awards-close'', interval ''1 hour''\)', 'g')) <> 1 then
    raise exception 'v465 awards close: automation_watchdog does not watch awards-close exactly once';
  end if;
end $chk$;

/* REHEARSAL: sql/2026-11-25-awards-close-v465.rehearsal.sql, to be run by the main session on production as one
   transaction rolled back by a closing raise (cases T1 to T7 are listed in its header).
   Run on production 2026-11-25 by the main session, one transaction rolled back by the closing raise; the queue held 0
   requests before and after; checked after: no close function, no awards_close_at, no awards-close job, Season 1's voted
   awards still undecided, no heartbeat key. (A first run stopped at T7's setup, which picked a statistical title as "an
   award the close decided"; the rehearsal now picks a voted award.)
   Result: REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 */
-- Applied as migration v465_awards_close on 2026-11-25 (rehearsed T1 to T7 first, rolled back); tools/sql/grant-audit.sql returned zero rows.
