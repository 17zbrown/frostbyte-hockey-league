-- v4.14 (2026-10-15): the league's record of the clubs each player has been on, and an old-club line credited too.
--
-- public._relink_member_lines (v4.08, amended v4.11) credits a box-score line filed under an EA name the league did not
-- yet have on record, but only when the member is rostered TODAY at the club the line was recorded for. A line a traded
-- or waived player played for his former club therefore stayed credited to nobody, missing from his season line and
-- from that club's line (the per-club split of v4.13). Nothing in the database said which club a player was on at a
-- given time: a trade moves the roster spot in place (move_player), keeping its created_at and origin; only a removal
-- leaves a row (roster_spot_removals), and a reversal overwrites the trade's updated_at.
--
-- Part 1  public.roster_tenures: one row per stint a player spends on a club in a season (joined_at, left_at), kept by
--         a trigger on roster_spots for every insert, every change of club and every removal, whatever path makes it.
-- Part 2  the backfill: every stint so far, from the roster spots and the removal archive (each spot's life), split at
--         each accepted trade (trades.updated_at) and at the one reversed trade's acceptance (only the transactions log
--         still has it: reverse_trade overwrote updated_at) and reversal. Self-checks: every trade move starts on the
--         club the stint was on, every spot ends on its own club, every trade move lies inside a spot's life.
--         Checked on the result: 322 stints, one open stint for each of the 169 rostered players, no two stints of a
--         player overlap, and 1,259 of the season's 1,272 credited lines lie inside a stint at their club. The other 13
--         were read here as office-credited play off the roster. That reading was WRONG (corrected by part 3,
--         sql/2026-10-15-tenure-fixes-v414.sql): those players were on the roster. Their stints ended before the
--         removal archive began (Sep 25 02:21), so this backfill could not see them, or sat under the merged Jugg
--         account's earlier account. Part 3 rebuilds them from the records that name them; all 1,272 now lie inside.
-- Part 3  public._club_evidence(profile, club, game): the one definition of "this member played for this club in this
--         game": a stint on the club inside the game's window (ten minutes before puck drop to three hours after, the
--         import window of Rule 6.2), or the club's own lineup for that game naming the member.
-- Part 4  _relink_member_lines uses it instead of today's roster.
-- Rehearsed (rolled back) on production: Kolosov's first Utah line set to unlinked was refused by the old rule (0 linked)
-- and credited by the new one (1 linked); a second line of his moved to Detroit, a club he never played for, stayed
-- unlinked. His record reads UTA 09-20 to 10-10 (assigned, then traded) and SEA from 10-10.

-- ---------------------------------------------------------------------------------------------------------------------
-- Part 1: the record and its trigger
create table if not exists public.roster_tenures (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null,
  profile_id  uuid not null,
  team_id     uuid not null,
  spot_id     uuid,
  position    text,
  squad       text,
  joined_at   timestamptz not null,
  left_at     timestamptz,
  joined_how  text not null,
  left_how    text,
  constraint roster_tenures_order check (left_at is null or left_at >= joined_at)
);
comment on table public.roster_tenures is
  'v4.14: every stint a player spends on a club in a season. Kept by _roster_tenure_track on roster_spots; backfilled for Season 1 from the spots, the removal archive and the trades. The one definition of the club a member was on at a time is public._club_evidence.';
create unique index if not exists roster_tenures_one_open on public.roster_tenures (season_id, profile_id) where left_at is null;
create index if not exists roster_tenures_lookup on public.roster_tenures (profile_id, team_id, season_id);
alter table public.roster_tenures enable row level security;
revoke all on public.roster_tenures from public, anon, authenticated;

create or replace function public._roster_tenure_track()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v4.14: one stint per club. A new spot opens a stint, a change of club closes it and opens the next, a removal closes
   it (with the reason the caller set in app.roster_reason, as archive_roster_spot reads it). A change of position or
   squad keeps the open stint's snapshot current. Fails loudly: a roster write whose history cannot be recorded does
   not go through. */
declare v_why text := nullif(btrim(coalesce(current_setting('app.roster_reason', true), '')), '');
begin
  if tg_op = 'INSERT' then
    insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, joined_how)
    values (new.season_id, new.profile_id, new.team_id, new.id, new.position::text, new.squad,
            coalesce(new.created_at, now()), coalesce(nullif(new.origin, ''), 'placed'));
  elsif tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id then
      update public.roster_tenures set left_at = now(), left_how = 'moved to another club'
       where season_id = old.season_id and profile_id = old.profile_id and left_at is null;
      insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, joined_how)
      values (new.season_id, new.profile_id, new.team_id, new.id, new.position::text, new.squad, now(), 'moved from another club');
    elsif new.position is distinct from old.position or new.squad is distinct from old.squad then
      update public.roster_tenures set position = new.position::text, squad = new.squad
       where season_id = new.season_id and profile_id = new.profile_id and left_at is null;
    end if;
  else
    update public.roster_tenures set left_at = now(), left_how = coalesce(v_why, 'removed')
     where season_id = old.season_id and profile_id = old.profile_id and left_at is null;
  end if;
  return null;
end $function$;
revoke all on function public._roster_tenure_track() from public, anon, authenticated;
drop trigger if exists roster_tenure_track_trg on public.roster_spots;
create trigger roster_tenure_track_trg after insert or delete or update of team_id, position, squad on public.roster_spots
  for each row execute function public._roster_tenure_track();

-- ---------------------------------------------------------------------------------------------------------------------
-- Part 2: the backfill (every season with roster data; only Season 1 has any)
do $bf$
declare
  l record; m record; v_team uuid; v_start timestamptz; v_how text; v_bad text[] := '{}'; v_acc timestamptz;
  rv record; v_n int;
begin
  if exists (select 1 from public.roster_tenures) then raise notice 'roster_tenures already filled; backfill skipped'; return; end if;

  create temp table _moves (season_id uuid, profile_id uuid, from_team uuid, to_team uuid, at timestamptz, how text) on commit drop;
  insert into _moves
    select t.season_id, x.pid, t.from_team_id, t.to_team_id, t.updated_at, 'traded'
      from public.trades t cross join unnest(coalesce(t.offered_profile_ids, '{}'::uuid[])) x(pid) where t.status = 'accepted'
    union all
    select t.season_id, x.pid, t.to_team_id, t.from_team_id, t.updated_at, 'traded'
      from public.trades t cross join unnest(coalesce(t.requested_profile_ids, '{}'::uuid[])) x(pid) where t.status = 'accepted';
  /* a reversed trade: accepted at the time its transactions row records, sent back at updated_at */
  for rv in select tr.* , ft.name fname, tt.name tname from public.trades tr
             join public.teams ft on ft.id = tr.from_team_id join public.teams tt on tt.id = tr.to_team_id
            where tr.status = 'reversed' loop
    select count(*), min(x.occurred_at) into v_n, v_acc from public.transactions x
     where x.season_id = rv.season_id and x.type = 'trade' and x.occurred_at between rv.created_at and rv.updated_at
       and x.description like rv.fname || ' traded <b>%' and x.description like '% to ' || rv.tname || ' for <b>%';
    if v_n <> 1 then raise exception 'v4.14 backfill: reversed trade % has % acceptance records, expected 1', rv.id, v_n; end if;
    insert into _moves
      select rv.season_id, x.pid, rv.from_team_id, rv.to_team_id, v_acc, 'traded' from unnest(coalesce(rv.offered_profile_ids, '{}'::uuid[])) x(pid)
      union all select rv.season_id, x.pid, rv.to_team_id, rv.from_team_id, v_acc, 'traded' from unnest(coalesce(rv.requested_profile_ids, '{}'::uuid[])) x(pid)
      union all select rv.season_id, x.pid, rv.to_team_id, rv.from_team_id, rv.updated_at, 'trade reversed' from unnest(coalesce(rv.offered_profile_ids, '{}'::uuid[])) x(pid)
      union all select rv.season_id, x.pid, rv.from_team_id, rv.to_team_id, rv.updated_at, 'trade reversed' from unnest(coalesce(rv.requested_profile_ids, '{}'::uuid[])) x(pid);
  end loop;

  /* each spot's life: the spots on rosters now, and the removed ones */
  for l in
    select rs.season_id, rs.profile_id, rs.id spot_id, rs.team_id end_team, rs.created_at start_at, null::timestamptz end_at,
           rs.origin, rs.position::text pos, rs.squad, null::text reason
      from public.roster_spots rs
    union all
    select r.season_id, r.profile_id, r.spot_id, r.team_id, r.spot_created_at, r.removed_at, r.origin, r.position::text, r.squad, r.reason
      from public.roster_spot_removals r
    order by 2, 5
  loop
    v_team := null; v_start := l.start_at; v_how := coalesce(nullif(l.origin, ''), 'placed');
    for m in select * from _moves mv where mv.season_id = l.season_id and mv.profile_id = l.profile_id
               and mv.at > l.start_at and (l.end_at is null or mv.at <= l.end_at) order by mv.at loop
      if v_team is null then v_team := m.from_team; end if;
      if m.from_team <> v_team then v_bad := v_bad || ('move of '||l.profile_id||' at '||m.at||' does not start on the stint''s club'); end if;
      insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, left_at, joined_how, left_how)
        values (l.season_id, l.profile_id, v_team, l.spot_id, l.pos, l.squad, v_start, m.at, v_how, m.how);
      v_team := m.to_team; v_start := m.at; v_how := m.how;
    end loop;
    v_team := coalesce(v_team, l.end_team);
    if v_team <> l.end_team then v_bad := v_bad || ('spot '||l.spot_id||' ends on another club'); end if;
    insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, left_at, joined_how, left_how)
      values (l.season_id, l.profile_id, v_team, l.spot_id, l.pos, l.squad, v_start, l.end_at, v_how,
              case when l.end_at is null then null else coalesce(nullif(l.reason, ''), 'removed') end);
  end loop;

  /* every trade move fell inside a spot's life */
  select count(*) into v_n from _moves mv where not exists (
    select 1 from public.roster_tenures rt where rt.season_id = mv.season_id and rt.profile_id = mv.profile_id
       and (rt.joined_at = mv.at or rt.left_at = mv.at));
  if v_n > 0 then v_bad := v_bad || (v_n||' trade moves outside every spot'); end if;
  if cardinality(v_bad) > 0 then raise exception 'v4.14 backfill is inconsistent: %', array_to_string(v_bad[1:10], '; '); end if;
end $bf$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Part 3: the one definition of "this member played for this club in this game"
create or replace function public._club_evidence(p_profile uuid, p_team uuid, p_game uuid)
 returns table(how text, pos text, squad text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v4.14: a stint on the club that overlaps the game's window (ten minutes before puck drop to three hours after,
     Rule 6.2), with the position and squad of that stint; else the club's own lineup for that game naming the member.
     No row: no evidence that the member played for this club in this game. */
  (select 'roster'::text, rt.position, rt.squad
     from public.roster_tenures rt join public.games g on g.id = p_game
    where rt.profile_id = p_profile and rt.team_id = p_team and rt.season_id = g.season_id
      and rt.joined_at <= g.scheduled_at + interval '3 hours'
      and (rt.left_at is null or rt.left_at >= g.scheduled_at - interval '10 minutes')
    order by rt.joined_at desc limit 1)
  union all
  (select 'lineup'::text, null::text, null::text
     from public.game_lineups gl
    where gl.game_id = p_game and gl.team_id = p_team
      and p_profile in (gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie)
      and not exists (select 1 from public.roster_tenures rt join public.games g on g.id = p_game
                       where rt.profile_id = p_profile and rt.team_id = p_team and rt.season_id = g.season_id
                         and rt.joined_at <= g.scheduled_at + interval '3 hours'
                         and (rt.left_at is null or rt.left_at >= g.scheduled_at - interval '10 minutes'))
    limit 1)
$function$;
revoke all on function public._club_evidence(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Part 4: the relink asks _club_evidence, not today's roster
do $p$
declare v_def text := pg_get_functiondef('public._relink_member_lines(uuid, text)'::regprocedure);
        a text := '    /* on the club the line was recorded for, in the position group played (a camp player fills any position) */
    select rs.position::text, rs.squad into v_pos, v_squad from public.roster_spots rs
     where rs.profile_id = p_profile and rs.season_id = v_season and rs.team_id = r.team_id limit 1;
    continue when not found;
    v_rowgrp := case when r.is_goalie then ''G'' when r.position in (''D'', ''LD'', ''RD'') then ''D'' else ''F'' end;
    v_grp := case when v_pos = ''G'' then ''G'' when v_pos in (''D'', ''LD'', ''RD'') then ''D'' else ''F'' end;
    continue when coalesce(v_squad, '''') <> ''tc'' and v_grp <> v_rowgrp;';
        b text := '    /* on the club the line was recorded for AT THE TIME OF THE GAME (v4.14: a stint on that club in the game''s window,
       or that club''s own lineup for the game naming him; a traded or waived player''s line for his former club counts),
       in the position group played on that stint (a camp player fills any position; a lineup is the club''s own word) */
    select e.how, e.pos, e.squad into v_how, v_pos, v_squad from public._club_evidence(p_profile, r.team_id, r.game_id) e limit 1;
    continue when not found;
    v_rowgrp := case when r.is_goalie then ''G'' when r.position in (''D'', ''LD'', ''RD'') then ''D'' else ''F'' end;
    v_grp := case when v_pos = ''G'' then ''G'' when v_pos in (''D'', ''LD'', ''RD'') then ''D'' else ''F'' end;
    continue when v_how = ''roster'' and coalesce(v_squad, '''') <> ''tc'' and v_grp <> v_rowgrp;';
        a2 text := 'declare v_season uuid; v_names text[]; v_eapid text; r record; n int := 0; v_cands int;
        v_pos text; v_squad text; v_grp text; v_rowgrp text;';
        b2 text := 'declare v_season uuid; v_names text[]; v_eapid text; r record; n int := 0; v_cands int;
        v_pos text; v_squad text; v_grp text; v_rowgrp text; v_how text;';
        a3 text := '''how'', ''automatic four-way check (v4.08)''';
        b3 text := '''how'', ''automatic four-way check (v4.08; club at the time of the game, v4.14)''';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then raise exception 'v4.14: relink anchor (club check)'; end if;
  if (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then raise exception 'v4.14: relink anchor (declare)'; end if;
  if (length(v_def) - length(replace(v_def, a3, ''))) / length(a3) <> 1 then raise exception 'v4.14: relink anchor (audit)'; end if;
  execute replace(replace(replace(v_def, a, b), a2, b2), a3, b3);
end $p$;

do $chk$
begin
  if position('_club_evidence(p_profile, r.team_id, r.game_id)' in pg_get_functiondef('public._relink_member_lines(uuid, text)'::regprocedure)) = 0 then
    raise exception 'v4.14: the relink does not ask _club_evidence';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where grantee in ('anon', 'authenticated', 'PUBLIC') and routine_schema = 'public'
                and routine_name in ('_club_evidence', '_roster_tenure_track', '_relink_member_lines', '_relink_all_unlinked')) then
    raise exception 'v4.14: an internal function is executable by members';
  end if;
  if exists (select 1 from information_schema.table_privileges
              where grantee in ('anon', 'authenticated', 'PUBLIC') and table_schema = 'public' and table_name = 'roster_tenures') then
    raise exception 'v4.14: roster_tenures is readable by members';
  end if;
end $chk$;
