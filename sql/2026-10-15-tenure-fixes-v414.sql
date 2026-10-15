-- v4.14, part 3 (2026-10-15): the review's fixes to the record of the clubs each player has been on.
--
-- 1. Stints that ended before the removal archive existed. roster_spot_removals began at 2026-09-25 02:21:10, one night
--    after opening night, so a spot deleted before then left no row and part 1's backfill could not see it. The record
--    therefore said Bad News Kells, LogicalSense1 and B Bunny joined Utah on Sep 25 (they were drafted or placed there
--    on Sep 20, waived by Utah at 01:15 on Sep 25 and restored by the office at 01:31), said atlasx27x. never held a spot
--    (Dallas received that player on Sep 20 and waived the same player three times on Sep 24), and missed Rhegain's
--    first Dallas stint and the Sep 23 Detroit and Boston swap of ItzKloudzy and jglehan29. Part 1's comment and part 2's "11, all true" were wrong:
--    a re-review of Utah's opening night would have reported three of its own players as on no roster. Each stint below
--    is rebuilt from a record that names it (a draft pick, a placement, the post-draft placement notice, a waiver or a
--    removal), and the migration refuses to run unless every one of those records is found exactly as cited.
--    Still not on record: Saqoy's and Hav1q's Seattle seats before Sep 23 03:03 (seated before the draft, no game then).
-- 2. Merged accounts. The member who played as Jugg_PRKz now plays as Jugg Backup Acc (merging member accounts, Oct 5):
--    the box-score lines moved to the new account, so the earlier account's Boston stint is carried over to it too.
-- 3. Self-check: every credited line of the season now lies inside a roster stint at its club in its game window.
-- 4. The trigger: also follows a spot passed to another account (profile_id or season_id changed), refuses a close that
--    does not match exactly one open stint on the club being left (the record must never drift silently), never ends a
--    stint before it began (left_at = greatest(now(), joined_at): now() is when the transaction began), and a position
--    change now starts a new stint like a squad move, so position and squad are on record at every game from now on.
-- 5. One definition with Rule 6.3: a line credited on a club's lineup is held to the position group the lineup gave the
--    member (part 1 skipped the group check on lineup evidence, which the rule does not allow).
-- 6. A line whose credit the league office withdrew (Rule 6.3) is no longer picked up by the 15-minute relink sweep (it
--    was put back to null by enforce_stat_credit_withdrawal each time; harmless, but every run rewrote the row).
-- Rehearsed (rolled back) on production, every Season 1 final reviewed before and after: 10 stints added (9 rebuilt, 1
-- carried over); credited lines outside a stint at their club 13 -> 0; "unrostered player" flags on a full re-review
-- 11 -> 0; over-limit readings 37 -> 37 and automatic forfeits none -> none (unchanged); the relink sweep links 0 lines
-- before and after. The trigger, on a scratch copy of roster_spots: a position change, a squad move, a trade and a
-- spot passed to another account each close one stint and open the next, a removal closes with its reason, a stint
-- opened after the writing transaction began ends at its own start (not before it), and a move with no open stint on
-- record is refused. Open stints 169 = rostered players 169; grant audit zero rows.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1 and 2: the stints that left no other record
do $gap$
declare v_s uuid; r record; v_p uuid; v_t uuid; v_pos text; n int := 0; v_ok int;
begin
  select id into v_s from public.seasons where number = 1;
  if v_s is null then raise exception 'v4.14c: Season 1 not found'; end if;
  if exists (select 1 from public.roster_tenures where joined_how like 'rebuilt:%') then
    raise notice 'v4.14c: pre-archive stints already rebuilt'; return;
  end if;
  for r in select * from (values
    ('Bad News Kells', 'UTA', '2026-09-20 01:57:10.059133+00'::timestamptz, '2026-09-25 01:16:07.016848+00'::timestamptz, null::text, null::text, 'draft',  'waived'),
    ('LogicalSense1',  'UTA', '2026-09-20 02:07:53.926557+00', '2026-09-25 01:16:12.436272+00', null,  null, 'draft',  'waived'),
    ('Rhegain',        'DAL', '2026-09-20 02:06:42.428949+00', '2026-09-25 00:46:44.761006+00', null,  null, 'draft',  'removed by the league office'),
    ('B Bunny',        'UTA', '2026-09-20 02:23:27.152809+00', '2026-09-25 01:15:52.268664+00', 'LW',  null, 'notice', 'waived'),
    ('atlasx27x.',     'DAL', '2026-09-20 02:23:27.152809+00', '2026-09-24 02:51:46.536764+00', 'C',   null, 'notice', 'waived'),
    ('atlasx27x.',     'DAL', '2026-09-24 02:52:00.153146+00', '2026-09-24 02:55:34.562048+00', 'C',   null, 'placement', 'waived'),
    ('atlasx27x.',     'DAL', '2026-09-24 02:56:00.102296+00', '2026-09-24 03:06:56.060622+00', 'C',   null, 'placement', 'waived (club notice)'),
    ('ItzKloudzy',     'DET', '2026-09-23 22:34:00.152403+00', '2026-09-23 23:49:37.722104+00', null,  null, 'placement', 'removed by the league office'),
    ('jglehan29',      'BOS', '2026-09-23 22:04:00.140564+00', '2026-09-23 23:50:04.181075+00', null,  null, 'placement', 'removed by the league office')
  ) v(tag, club, joined, left_at, pos, squad, start_src, end_src) loop
    /* position: as the opening record states it (the post-draft notice names it), else the member's next stint of the
       season; squad: never guessed (no record dates a squad before Oct 15), so null, read like "squad not on record" */
    select count(*), min(p.id::text)::uuid into v_ok, v_p from public.profiles p where p.gamertag = r.tag;
    if v_ok <> 1 then raise exception 'v4.14c: % does not name exactly one member (%)', r.tag, v_ok; end if;
    select id into v_t from public.teams where code = r.club;
    /* the record that opens the stint */
    if r.start_src = 'draft' then
      select count(*) into v_ok from public.draft_picks dp
       where dp.player_id = v_p and dp.current_team_id = v_t and dp.picked_at = r.joined and dp.used;
    elsif r.start_src = 'placement' then
      select count(*) into v_ok from public.random_assignments ra
       where ra.profile_id = v_p and ra.team_id = v_t and ra.placed_at = r.joined;
    else
      select count(*) into v_ok from public.club_notices cn
       where cn.team_id = v_t and cn.created_at = r.joined and cn.kind = 'sign'
         and cn.body like 'Placed by the league office after the draft%' and position(r.tag || ' (' in cn.body) > 0;
    end if;
    if v_ok <> 1 then raise exception 'v4.14c: no % record opens % on % at %', r.start_src, r.tag, r.club, r.joined; end if;
    /* the record that closes it */
    if r.end_src = 'waived (club notice)' then
      select count(*) into v_ok from public.club_notices cn
       where cn.team_id = v_t and cn.created_at = r.left_at and cn.kind = 'waive' and position(r.tag || ' (' in cn.body) = 1;
    else
      select count(*) into v_ok from public.transactions tr
       where tr.season_id = v_s and tr.type = 'waive' and tr.occurred_at = r.left_at and position('<b>' || r.tag || '</b>' in tr.description) > 0;
    end if;
    if v_ok <> 1 then raise exception 'v4.14c: no % record closes % on % at %', r.end_src, r.tag, r.club, r.left_at; end if;
    v_pos := coalesce(r.pos, (select rt.position from public.roster_tenures rt
                               where rt.season_id = v_s and rt.profile_id = v_p and rt.joined_at >= r.left_at
                               order by rt.joined_at limit 1));
    if v_pos is null then raise exception 'v4.14c: no position on record for % on %', r.tag, r.club; end if;
    insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, left_at, joined_how, left_how)
    values (v_s, v_p, v_t, null, v_pos, r.squad, r.joined, r.left_at,
            'rebuilt: ' || case r.start_src when 'draft' then 'drafted' else 'placed by the league office after the draft' end,
            case when r.end_src like 'waived%' then 'waived' else r.end_src end);
    n := n + 1;
  end loop;

  /* 2: the merged account carries the earlier account's Boston stint */
  insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, left_at, joined_how, left_how)
  select o.season_id, nw.id, o.team_id, o.spot_id, o.position, o.squad, o.joined_at, o.left_at,
         'rebuilt: carried over from the member''s earlier account Jugg_PRKz (accounts merged Oct 5)', o.left_how
    from public.roster_tenures o join public.profiles old on old.id = o.profile_id and old.gamertag = 'Jugg_PRKz'
    join public.profiles nw on nw.gamertag = 'Jugg Backup Acc'
   where o.season_id = v_s and o.left_at is not null;
  get diagnostics v_ok = row_count;
  if v_ok <> 1 then raise exception 'v4.14c: expected one Jugg_PRKz stint to carry over, found %', v_ok; end if;
  raise notice 'v4.14c: % pre-archive stints and 1 carried-over stint added', n;
end $gap$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4: the trigger
create or replace function public._roster_tenure_track()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
/* v4.14: one stint per club, squad and position. A new spot opens a stint; a change of club, squad or position, or the
   spot passing to another account, closes it and opens the next; a removal closes it (with the reason the caller set in
   app.roster_reason, as archive_roster_spot reads it). So the club, squad and position at any game time are on record.
   Fails loudly: a roster write whose history cannot be recorded, or that finds the record out of step (no single open
   stint on the club being left), does not go through. A stint never ends before it began: now() is when the transaction
   started, which can be earlier than a stint another transaction opened and committed meanwhile. */
declare v_why text := nullif(btrim(coalesce(current_setting('app.roster_reason', true), '')), '');
        v_open public.roster_tenures; v_at timestamptz; v_move text; v_n int; v_owner boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, joined_how)
    values (new.season_id, new.profile_id, new.team_id, new.id, new.position::text, new.squad,
            coalesce(new.created_at, now()), coalesce(nullif(new.origin, ''), 'placed'));
    return null;
  end if;
  if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id and new.squad is not distinct from old.squad
     and new.position is not distinct from old.position and new.profile_id = old.profile_id and new.season_id = old.season_id then
    return null;   /* nothing the record keeps has changed */
  end if;
  select count(*) into v_n from public.roster_tenures where season_id = old.season_id and profile_id = old.profile_id and left_at is null;
  select * into v_open from public.roster_tenures where season_id = old.season_id and profile_id = old.profile_id and left_at is null;
  if v_n <> 1 or v_open.team_id is distinct from old.team_id then
    raise exception 'roster_tenures is out of step with roster_spots for member % in season %: % open stint(s), none on the club being left',
      old.profile_id, old.season_id, v_n using errcode = 'P0001';
  end if;
  v_at := greatest(now(), v_open.joined_at);
  v_owner := tg_op = 'UPDATE' and (new.profile_id <> old.profile_id or new.season_id <> old.season_id);
  v_move := case when tg_op = 'DELETE' then coalesce(v_why, 'removed')
                 when v_owner then 'spot passed to another account'
                 when new.team_id is distinct from old.team_id then 'moved to another club'
                 when new.squad is distinct from old.squad then
                   case new.squad when 'tc' then 'moved to training camp' when 'pro' then 'moved up to the active roster' else 'squad changed' end
                 else 'position changed' end;
  update public.roster_tenures set left_at = v_at, left_how = v_move where id = v_open.id;
  if tg_op = 'UPDATE' then
    insert into public.roster_tenures (season_id, profile_id, team_id, spot_id, position, squad, joined_at, joined_how)
    values (new.season_id, new.profile_id, new.team_id, new.id, new.position::text, new.squad, v_at,
            case when v_owner then 'spot passed from another account'
                 when new.team_id is distinct from old.team_id then 'moved from another club' else v_move end);
  end if;
  return null;
end $function$;
revoke all on function public._roster_tenure_track() from public, anon, authenticated;
drop trigger if exists roster_tenure_track_trg on public.roster_spots;
create trigger roster_tenure_track_trg after insert or delete or update of team_id, position, squad, profile_id, season_id
  on public.roster_spots for each row execute function public._roster_tenure_track();

-- ---------------------------------------------------------------------------------------------------------------------
-- 5: a lineup's evidence carries the position the lineup gave the member
create or replace function public._club_evidence(p_profile uuid, p_team uuid, p_game uuid)
 returns table(how text, pos text, squad text)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  /* v4.14: a stint on the club at the time of the game (public._tenures_at_game), the one that contains puck drop first,
     with that stint's position and squad; else the club's own lineup for that game naming the member, with the position
     the lineup gave the member. No row: no evidence that the member played for this club in this game. */
  (select 'roster'::text, t.position, t.squad
     from public._tenures_at_game(p_profile, p_game) t join public.games g on g.id = p_game
    where t.team_id = p_team
    order by (t.joined_at <= g.scheduled_at and (t.left_at is null or t.left_at > g.scheduled_at)) desc, t.joined_at desc
    limit 1)
  union all
  (select 'lineup'::text,
          case when gl.goalie = p_profile then 'G' when gl.ld = p_profile then 'LD' when gl.rd = p_profile then 'RD'
               when gl.center = p_profile then 'C' when gl.lw = p_profile then 'LW' else 'RW' end,
          null::text
     from public.game_lineups gl
    where gl.game_id = p_game and gl.team_id = p_team
      and p_profile in (gl.center, gl.lw, gl.rw, gl.ld, gl.rd, gl.goalie)
      and not exists (select 1 from public._tenures_at_game(p_profile, p_game) t where t.team_id = p_team)
    limit 1)
$function$;
revoke all on function public._club_evidence(uuid, uuid, uuid) from public, anon, authenticated;

-- 5 and 6 in the relink; 6 in the sweep
do $p$
declare v_def text := pg_get_functiondef('public._relink_member_lines(uuid, text)'::regprocedure);
  a1 text := $a$       in the position group played on that stint (a camp player fills any position; a lineup is the club's own word) */$a$;
  b1 text := $b$       in the position group of that stint, or of the place the lineup gave the member (a camp player fills any position) */$b$;
  a2 text := $a$    continue when v_how = 'roster' and coalesce(v_squad, '') <> 'tc' and v_grp <> v_rowgrp;$a$;
  b2 text := $b$    continue when coalesce(v_squad, '') <> 'tc' and v_grp <> v_rowgrp;$b$;
  a3 text := $a$     where gs.profile_id is null and g.season_id = v_season
       and ((v_eapid is not null and gs.ea_player_id = v_eapid) or lower(coalesce(gs.skater_name, '')) = any(v_names))$a$;
  b3 text := $b$     where gs.profile_id is null and g.season_id = v_season
       and ((v_eapid is not null and gs.ea_player_id = v_eapid) or lower(coalesce(gs.skater_name, '')) = any(v_names))
       /* v4.14: a line whose credit the league office withdrew (Rule 6.3) is never reconsidered */
       and not exists (select 1 from public.stat_credit_withdrawals w where w.game_id = gs.game_id and w.ea_player_id = gs.ea_player_id)$b$;
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then raise exception 'v4.14c: relink anchor 1'; end if;
  if (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then raise exception 'v4.14c: relink anchor 2'; end if;
  if (length(v_def) - length(replace(v_def, a3, ''))) / length(a3) <> 1 then raise exception 'v4.14c: relink anchor 3'; end if;
  execute replace(replace(replace(v_def, a1, b1), a2, b2), a3, b3);
end $p$;

do $p$
declare v_def text := pg_get_functiondef('public._relink_all_unlinked()'::regprocedure);
  a1 text := $a$     where gs.profile_id is null and g.season_id = v_season$a$;
  b1 text := $b$     where gs.profile_id is null and g.season_id = v_season
       and not exists (select 1 from public.stat_credit_withdrawals w where w.game_id = gs.game_id and w.ea_player_id = gs.ea_player_id)$b$;
begin
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 2 then raise exception 'v4.14c: sweep anchor (expected 2)'; end if;
  execute replace(v_def, a1, b1);
end $p$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3 and the record's invariants
do $chk$
declare v_out int; v_list text; v_open int; v_spots int; v_lost int; v_over int;
begin
  select count(*), string_agg(distinct p.gamertag || '@' || t.code, ', ') into v_out, v_list
    from public.game_stats gs join public.games g on g.id = gs.game_id
    join public.profiles p on p.id = gs.profile_id join public.teams t on t.id = gs.team_id
   where gs.profile_id is not null and g.status = 'final' and not coalesce(g.voided, false)
     and not exists (select 1 from public._club_evidence(gs.profile_id, gs.team_id, gs.game_id) e where e.how = 'roster');
  if v_out > 0 then raise exception 'v4.14c: % credited line(s) lie outside every roster stint: %', v_out, v_list; end if;
  select count(*) into v_open from public.roster_tenures where left_at is null;
  select count(*) into v_spots from public.roster_spots;
  select count(*) into v_lost from public.roster_spots rs where not exists (select 1 from public.roster_tenures rt
    where rt.season_id = rs.season_id and rt.profile_id = rs.profile_id and rt.team_id = rs.team_id and rt.left_at is null);
  if v_open <> v_spots or v_lost > 0 then raise exception 'v4.14c: % open stints for % spots (% spots without one)', v_open, v_spots, v_lost; end if;
  select count(*) into v_over from public.roster_tenures a join public.roster_tenures b
    on a.season_id = b.season_id and a.profile_id = b.profile_id and a.id < b.id
   and a.joined_at < coalesce(b.left_at, 'infinity') and b.joined_at < coalesce(a.left_at, 'infinity');
  if v_over > 0 then raise exception 'v4.14c: % overlapping stints', v_over; end if;
  if position('stat_credit_withdrawals' in pg_get_functiondef('public._relink_member_lines(uuid, text)'::regprocedure)) = 0
     or position('stat_credit_withdrawals' in pg_get_functiondef('public._relink_all_unlinked()'::regprocedure)) = 0 then
    raise exception 'v4.14c: the relink still reconsiders withdrawn lines';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where grantee in ('anon', 'authenticated', 'PUBLIC') and routine_schema = 'public'
                and routine_name in ('_club_evidence', '_roster_tenure_track', '_relink_member_lines', '_relink_all_unlinked')) then
    raise exception 'v4.14c: an internal function is executable by members';
  end if;
end $chk$;
