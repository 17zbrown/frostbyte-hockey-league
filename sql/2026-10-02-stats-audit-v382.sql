-- v3.82: the season box-score audit's corrections, and the guards that keep each one from coming back.
-- Commissioner, 2026-10-02: "Sift through each game played in the league so far to make sure players' stats are fully
-- up to date and not missing anything using rosters as of right now."
-- Audit (read only, every final game of Season 1): every count column of every line equals the sum of the EA sittings
-- filed to its game, every score equals its players' goals, every played game reaches a full 60 minutes, no sitting was
-- lost. What it found, all fixed here:
--   1. A wrong credit. In the Oct 1 9:35 PM DAL v DET game the Dallas line of EA account vDarkiee___ (persona
--      1004486290545) was credited to LIL__Dark200, whose own persona (1123662793) played for Detroit in the SAME EA
--      match: one member on both sides. The link came from his profile's platform_gamertag, 'vDarkiee___', which his
--      own sign-up gives as 'LIL__Dark200'. The line is unlinked, his platform gamertag is set back to his sign-up's,
--      and the importer now credits a member at most once per game (netlify/functions/ingest-stats.js).
--   2. A Rule 6.3 withdrawal not applied. atlasx27x.'s line in the Sep 23 10:10 PM DAL v VAN game was re-linked 91
--      seconds after the league office withdrew his credit (a refile by the code then deployed). The line is unlinked,
--      and the withdrawal is now enforced by the database itself (enforce_stat_credit_withdrawal), so no writer,
--      present or future, can hand the credit back; restore_stat_credit removes the withdrawal before it re-links.
--   3. Three lines credited to nobody, each matching exactly ONE member on his recorded persona or platform gamertag,
--      on that club's roster in the group he played: wyd_stepsis12 -> Bowman (NYI G, Oct 1), GretzkyIsGod -> The Old
--      Fart (DET, Sep 30; persona stamped), blazealldaylong -> Family man (NYI D, Oct 2).
--   4. Four goalie lines in two-sitting games carried the first sitting's diving saves / shutout periods only (the v3.49
--      backfill read one payload per game). Rebuilt from every sitting, under the same saves / shots against / goals
--      against guard as v3.81.
--   5. Five archive rows kept a stale status (four held sittings whose games were later ruled forfeits, one non-league
--      scrim still 'unmatched'). Settled; and a game becoming final now settles its held sittings itself.
--   6. trg_recompute_overall refreshed only the NEW holder of a line when it changed hands, leaving the old holder's
--      rating stale. It now refreshes both.
-- Left for a ruling (not changed): the three vDarkiee___ lines stay credited to nobody until Dallas or the player says
-- who it is; Rhegain played the whole Oct 1 9:00 PM UTA v DAL game for Utah and was signed 79 seconds before it ended.

-- ---- 2. the withdrawal is the database's to enforce ----
create or replace function public.enforce_stat_credit_withdrawal() returns trigger
language plpgsql security definer set search_path = '' as $f$
begin
  if new.profile_id is not null and new.ea_player_id is not null and exists (
       select 1 from public.stat_credit_withdrawals w where w.game_id = new.game_id and w.ea_player_id = new.ea_player_id) then
    new.profile_id := null;   /* Rule 6.3: the line stays, the personal credit does not */
  end if;
  return new;
end $f$;
revoke all on function public.enforce_stat_credit_withdrawal() from public, anon, authenticated;
drop trigger if exists enforce_stat_credit_withdrawal_trg on public.game_stats;
create trigger enforce_stat_credit_withdrawal_trg before insert or update of profile_id, game_id, ea_player_id on public.game_stats
  for each row execute function public.enforce_stat_credit_withdrawal();

create or replace function public.restore_stat_credit(p_game uuid, p_ea_player_id text)
 returns table(restored_to uuid, lines integer)
 language plpgsql security definer set search_path to 'public' as $function$
declare v_prof uuid; v_n integer;
begin
  if not (public.is_stats_staff() or public.is_commissioner()) then
    raise exception 'Only statistics staff or a commissioner may restore personal credit for a stat line';
  end if;
  select w.profile_id into v_prof from public.stat_credit_withdrawals w
   where w.game_id = p_game and w.ea_player_id = p_ea_player_id;
  if not found then raise exception 'No withdrawal on record for that game and EA account'; end if;
  if v_prof is null then raise exception 'The withdrawal no longer records who held the credit, so link the line by hand'; end if;
  /* v3.82: the withdrawal goes first. enforce_stat_credit_withdrawal would clear a link made while it still stood. */
  delete from public.stat_credit_withdrawals w
   where w.game_id = p_game and w.ea_player_id = p_ea_player_id;
  update public.game_stats gs set profile_id = v_prof
   where gs.game_id = p_game and gs.ea_player_id = p_ea_player_id and gs.profile_id is null;
  get diagnostics v_n = ROW_COUNT;
  return query select v_prof, v_n;
end $function$;

-- ---- 6. a line changing hands refreshes both holders ----
create or replace function public.trg_recompute_overall()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_new uuid; v_old uuid;
begin
  v_new := case when tg_op in ('INSERT', 'UPDATE') then new.profile_id end;
  v_old := case when tg_op in ('UPDATE', 'DELETE') then old.profile_id end;
  if v_new is not null then perform public.refresh_player_overall(v_new); end if;
  /* v3.82: the player the line was taken from is refreshed too */
  if v_old is not null and v_old is distinct from v_new then perform public.refresh_player_overall(v_old); end if;
  return null;
end;$function$;

-- ---- 5. a game that becomes final settles its held sittings ----
create or replace function public.settle_held_sittings() returns trigger
language plpgsql security definer set search_path = '' as $f$
begin
  update public.ea_ingest_log
     set status = 'ingested',
         reason = coalesce(reason, '') || ' | settled: its game became final ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
   where game_id = new.id and status = 'incomplete';
  return null;
end $f$;
revoke all on function public.settle_held_sittings() from public, anon, authenticated;
drop trigger if exists settle_held_sittings_trg on public.games;
create trigger settle_held_sittings_trg after update of status on public.games
  for each row when (new.status = 'final' and old.status is distinct from new.status) execute function public.settle_held_sittings();

do $fix$
declare v_n int;
begin
  /* 1. vDarkiee___ is not LIL__Dark200: both personas played the same EA match, on opposite sides */
  update public.game_stats set profile_id = null
   where id = '5d8d044b-ff41-4146-b96a-43f14e6a856c' and profile_id = '716136ec-98e2-4fd1-8149-599437ad1795' and ea_player_id = '1004486290545';
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception '1: the vDarkiee___ line was not as audited'; end if;
  update public.profiles set platform_gamertag = 'LIL__Dark200'
   where id = '716136ec-98e2-4fd1-8149-599437ad1795' and platform_gamertag = 'vDarkiee___';
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception '1: LIL__Dark200''s platform gamertag was not as audited'; end if;
  perform public.log_admin_action('platform_gamertag_corrected', 'profile', '716136ec-98e2-4fd1-8149-599437ad1795',
    jsonb_build_object('from', 'vDarkiee___', 'to', 'LIL__Dark200', 'why',
      'vDarkiee___ (persona 1004486290545) played for Dallas against LIL__Dark200 (persona 1123662793) in EA match 1782202040362; his sign-up gives LIL__Dark200 as his platform gamertag'));

  /* 2. the withdrawal stands (the new trigger also clears it on any write) */
  update public.game_stats set profile_id = null
   where id = '39ed42ad-a054-48ce-9ad5-c93789ec60f9' and profile_id = 'bce774b1-1017-49df-bfde-30f4044529dc'
     and exists (select 1 from public.stat_credit_withdrawals w where w.game_id = 'c4126ee2-da45-43d8-b48a-e67fa979dbcb' and w.ea_player_id = '1448733393');
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception '2: the withdrawn line was not as audited'; end if;

  /* 3. three unlinked lines, each to the one member it matches */
  update public.game_stats set profile_id = 'b90f2bd4-930e-41ab-9b55-0642a9bf96d0'
   where id = '6d8ddef1-bd37-4e0c-8325-e4165a695138' and profile_id is null and ea_player_id = '1960987555';
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception '3: wyd_stepsis12'; end if;
  update public.game_stats set profile_id = 'f1cc8fb7-46c4-4aae-af5a-cab062da8afc'
   where id = '0145cd2b-5ee5-4044-a35b-2191b71edde3' and profile_id is null and ea_player_id = '169517688';
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception '3: GretzkyIsGod'; end if;
  update public.profiles set ea_player_id = '169517688' where id = 'f1cc8fb7-46c4-4aae-af5a-cab062da8afc' and ea_player_id is null;
  update public.game_stats set profile_id = '5e292cfb-2638-42d5-87a2-79758e5921e1'
   where id = 'dc3eac02-3c19-4208-91b2-51e1cb3c0c0b' and profile_id is null and ea_player_id = '1629500250';
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception '3: blazealldaylong'; end if;

  /* 5. stale archive statuses */
  update public.ea_ingest_log l
     set status = 'ingested', reason = coalesce(l.reason, '') || ' | settled: its game was ruled a forfeit under Rule 4.3 and is final; this sitting is its record'
    from public.games g
   where l.game_id = g.id and l.status = 'incomplete' and g.status = 'final';
  update public.ea_ingest_log
     set status = 'ignored', reason = 'a match against a club outside the league, with no fixture for the known club in this window, not a league game'
   where ea_match_id = '556227760218' and status = 'unmatched';
end $fix$;

-- ---- 4. goalie fields from EVERY sitting (v3.81's rebuild, for lines whose values differ, not only nulls) ----
with tgt as (
  select gs.id, gs.game_id, gs.ea_player_id, gs.saves, gs.shots_against, gs.goals_against,
         gs.diving_saves, gs.shutout_periods, gs.pen_shot_saves, gs.pen_shots_against
  from public.game_stats gs where gs.is_goalie and gs.ea_player_id is not null
),
src as (
  select t.id,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glsaves')::int, 0) else 0 end) sv,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glshots')::int, 0) else 0 end) sa,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glga')::int, 0) else 0 end) ga,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'gldsaves')::int, 0) else 0 end) dsv,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glsoperiods')::int, 0) else 0 end) sop,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glpensaves')::int, 0) else 0 end) pss,
    sum(case when lower(pp.value->>'position') like '%goalie%' then coalesce((pp.value->>'glpenshots')::int, 0) else 0 end) psa
  from tgt t
  join public.ea_ingest_log l on l.game_id = t.game_id and l.status in ('ingested', 'merged', 'incomplete')
  cross join lateral jsonb_each(l.payload->'players') cl
  cross join lateral jsonb_each(cl.value) pp
  where pp.key = t.ea_player_id
  group by t.id
)
update public.game_stats gs
   set diving_saves = s.dsv, shutout_periods = s.sop, pen_shot_saves = s.pss, pen_shots_against = s.psa
  from src s join tgt t on t.id = s.id
 where gs.id = s.id and s.sv = t.saves and s.sa = t.shots_against and s.ga = t.goals_against
   and (t.diving_saves, t.shutout_periods, t.pen_shot_saves, t.pen_shots_against) is distinct from (s.dsv, s.sop, s.pss, s.psa);

do $refresh$
declare r record;
begin
  perform set_config('app.role_grant', 'on', true);
  perform public.refresh_rating_norms();
  for r in select distinct gs.profile_id as pid from public.game_stats gs join public.games gm on gm.id = gs.game_id
            where gm.status = 'final' and gm.stage in ('regular', 'playoff') and gs.profile_id is not null loop
    perform public.refresh_player_overall(r.pid);
  end loop;
end $refresh$;

/* REHEARSED 2026-10-02 in one rolled-back transaction: "REHEARSAL OK: T1 T2 (guard + restore) T3 T5; goalie lines changed
   4: SmokiestTitan34 0/0->1/1, Andrew 2/1->4/1, ItzPeakz 0/0->0/1, SmokiestTitan34 0/0->0/1; members credited twice in
   one game: 0". T2 wrote the withdrawn credit back by hand and the guard cleared it, then restore_stat_credit (as the
   commissioner) restored it, proving the reorder.
   APPLIED 2026-10-02 as migration v382_stats_audit_corrections. Afterwards: 0 members credited twice in a game, 0 stale
   archive rows, 0 goalie lines missing a field, both triggers present; 4 lines credited to nobody this season, all by
   design or awaiting a ruling: ATLASX27X (Rule 6.3 withdrawal) and the three vDarkiee___ lines. */
