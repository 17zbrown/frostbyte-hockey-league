-- v4.37 (2026-10-29): a Rule 4.6 substitution cannot be removed from a game that is already filed or held, except by a
-- commissioner.
-- Commissioner, 2026-10-29: "What I would like you to add is the ability to seach a non-league club and match it to a team
-- so we can file the league games by searching the club they used and entering their league game." The Stats manager now
-- records substitutions (set_game_club_substitution) and offers Remove on a game until it is filed. A review of that
-- change found the "until it is filed" rule lived only in the browser: clear_game_club_substitution had no status check,
-- and the guard trigger (trg_guard_gcs) fires on INSERT OR UPDATE, never on DELETE. Removing the substitution from a filed
-- game would leave a box score whose borrowed club no longer stands for anyone, and changing which club a filed box score
-- belonged to is a ruling (Rule 4.6, and the guard trigger's own comment). Commissioners keep the override (standing
-- ruling 2026-10-21: commissioners always hold more power).
-- The function is recreated with search_path '' and every name schema-qualified (CLAUDE.md); CREATE OR REPLACE keeps its
-- grants (authenticated EXECUTE, nothing for anon), checked below.

create or replace function public.clear_game_club_substitution(p_game uuid, p_ea_club_id text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare n int;
begin
  if not (public.is_stats_staff() or public.is_commissioner()) then
    raise exception 'Only the league office or statistics staff can clear a club substitution';
  end if;
  /* v4.37: once a sitting has been filed or held on the game, which club its borrowed club stood for is a ruling */
  if exists (select 1 from public.games g where g.id = p_game and (g.status <> 'scheduled' or g.ea_match_id is not null))
     and not public.is_commissioner() then
    raise exception 'That game is already filed or held, so its substitution stays. Report it to a commissioner if it is wrong.';
  end if;
  delete from public.game_club_substitutions
   where game_id = p_game and ea_club_id = btrim(p_ea_club_id);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'there was no substitution on that game to clear'; end if;
  perform public.log_admin_action('game_club_substitution_cleared','game',p_game::text,
    jsonb_build_object('ea_club_id',btrim(p_ea_club_id)));
end $function$;

do $chk$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.clear_game_club_substitution(uuid, text)'::regprocedure);
  if position('already filed or held' in v_def) = 0 or position('not public.is_commissioner()' in v_def) = 0 then
    raise exception 'v4.37 check: the filed-game guard is missing';
  end if;
  if position('search_path TO ''''' in v_def) = 0 then raise exception 'v4.37 check: search_path is not empty'; end if;
  if not has_function_privilege('authenticated', 'public.clear_game_club_substitution(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.clear_game_club_substitution(uuid, text)', 'EXECUTE') then
    raise exception 'v4.37 check: the grants changed';
  end if;
end $chk$;

/* REHEARSAL (2026-10-29): one transaction on the live database, rolled back by a closing raise. The migration above ran
   first, then a probe:
   P1  statistics staff (17a137e6) clearing the 9552 substitution on Boston v Dallas Oct 28 (8094aa65, final) is refused
       with "already filed or held", and the row stays.
   P2  a commissioner (5a5f118e) clears the same row.
   P3  on a game not filed yet (6e6c6798, scheduled), statistics staff record a substitution and clear it as before.
   Result: REHEARSAL OK: P1 P2 P3
   Applied as migration v437_substitution_clear_guard; tools/sql/grant-audit.sql (check 4 now names both substitution
   RPCs, which the Stats manager calls) returned zero rows. */

-- Part 2 (v4.37b, same day). A second review found the same line could be crossed by CHANGING a substitution instead of
-- removing it: set_game_club_substitution upserts on (game_id, ea_club_id), and the guard trigger let that update through
-- on a filed game whenever the row already existed, and on a held game always. So statistics staff could still re-point
-- which club a borrowed club stood for after a sitting was filed or held on the game. Now changing the club of an
-- existing substitution on a filed or held game is the commissioner's, the same line clear_game_club_substitution holds.
-- Recording the SAME club again (a new reason) stays open, and so does a NEW substitution on a held game: that is how a
-- game held from a sitting under a club's own EA club is completed by a sitting under a borrowed one. A new substitution
-- on a filed game stays refused for everyone, as before. Recreated with search_path '' (every name was already qualified).

create or replace function public.guard_game_club_substitution()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare g public.games; v_owner text;
begin
  select * into g from public.games where id = new.game_id;
  if g.id is null then raise exception 'no such game'; end if;
  /* the substitute stands in for one of THIS fixture's two clubs, never a third party */
  if new.team_id not in (g.home_team_id, g.away_team_id) then
    raise exception 'that club is not in this fixture';
  end if;
  /* an EA club that a league club already owns is a mis-link to be corrected in the Control
     Center, not a substitution: recording it here would let one club file as another */
  select code into v_owner from public.teams where ea_club_id = new.ea_club_id::text;
  if v_owner is not null then
    raise exception 'EA club % already belongs to %, so this is a mis-link and not a substitution', new.ea_club_id, v_owner;
  end if;
  /* record it before the game is filed. Afterwards the score is already published and changing
     which club a box score belonged to is a ruling, not an import setting. */
  if g.status <> 'scheduled' and not exists (select 1 from public.game_club_substitutions s
        where s.game_id = new.game_id and s.ea_club_id = new.ea_club_id) then
    raise exception 'that game is already %, so record the substitution before it is filed', g.status;
  end if;
  /* v4.37: once a sitting is filed or held on the game, CHANGING which club a recorded borrowed club stood for is the
     commissioner's (clear_game_club_substitution holds the same line). Fires on the insert half of the upsert and on
     its update half alike: the existing row still carries the old club in both. */
  if (g.status <> 'scheduled' or g.ea_match_id is not null) and not public.is_commissioner()
     and exists (select 1 from public.game_club_substitutions s
                  where s.game_id = new.game_id and s.ea_club_id = new.ea_club_id and s.team_id is distinct from new.team_id) then
    raise exception 'That game is already filed or held, so its substitution stays. Report it to a commissioner if it is wrong.';
  end if;
  return new;
end $function$;

do $chk$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.guard_game_club_substitution()'::regprocedure);
  if position('s.team_id is distinct from new.team_id' in v_def) = 0 or position('not public.is_commissioner()' in v_def) = 0 then
    raise exception 'v4.37b check: the change guard is missing';
  end if;
  if position('search_path TO ''''' in v_def) = 0 then raise exception 'v4.37b check: search_path is not empty'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_gcs' and tgrelid = 'public.game_club_substitutions'::regclass and tgenabled = 'O') then
    raise exception 'v4.37b check: trg_guard_gcs is not in place';
  end if;
end $chk$;

/* REHEARSAL part 2 (2026-10-29): one transaction on the live database, rolled back by a closing raise. Part 2 above ran
   first, then a probe as statistics staff (17a137e6) unless noted:
   T1  re-pointing 9552 on Boston v Dallas Oct 28 (8094aa65, final, recorded for BOS) to DAL is refused with "already
       filed or held"; the row stays BOS.
   T2  recording 9552 for BOS again, with a new reason, on that filed game goes through.
   T3  a commissioner (5a5f118e) re-points it to DAL.
   T4  on BOS v UTA (6e6c6798, scheduled, nothing held) a substitution is recorded for BOS and re-pointed to UTA.
   T5  with that game marked held inside the probe: re-pointing is refused; a NEW borrowed club for the other side
       (434343 for BOS) is recorded; and removing 424242 is refused by part 1's guard.
   Result: REHEARSAL OK: T1 T2 T3 T4 T5
   Applied as migration v437b_substitution_change_guard; tools/sql/grant-audit.sql returned zero rows. */

-- Part 3 (v4.37c, same day). A third review found a commissioner's removal on a filed game could not be undone: the
-- guard's "record it before the game is filed" check had no commissioner exemption, so once a commissioner removed a
-- filed game's substitution nobody, the commissioner included, could record it again, and the filed box score stayed
-- under a club that stood for no one. A commissioner may now record one on a filed game (a ruling; standing ruling
-- 2026-10-21: commissioners always hold more power). Statistics staff are refused exactly as before. The Stats manager
-- itself offers Remove only while a game is open, for everyone.
-- shortcut: the importer reads substitutions once and does not re-check them before filing, so a Remove in the second or
-- two between that read and its games PATCH is not caught; revisit if a filed game is ever found with its substitution
-- gone or pointing at the other club (the marker sits on that read in netlify/functions/ingest-stats.js).

create or replace function public.guard_game_club_substitution()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare g public.games; v_owner text;
begin
  select * into g from public.games where id = new.game_id;
  if g.id is null then raise exception 'no such game'; end if;
  /* the substitute stands in for one of THIS fixture's two clubs, never a third party */
  if new.team_id not in (g.home_team_id, g.away_team_id) then
    raise exception 'that club is not in this fixture';
  end if;
  /* an EA club that a league club already owns is a mis-link to be corrected in the Control
     Center, not a substitution: recording it here would let one club file as another */
  select code into v_owner from public.teams where ea_club_id = new.ea_club_id::text;
  if v_owner is not null then
    raise exception 'EA club % already belongs to %, so this is a mis-link and not a substitution', new.ea_club_id, v_owner;
  end if;
  /* record it before the game is filed. Afterwards the score is already published and changing
     which club a box score belonged to is a ruling, not an import setting: a commissioner's (v4.37c). */
  if g.status <> 'scheduled' and not public.is_commissioner() and not exists (select 1 from public.game_club_substitutions s
        where s.game_id = new.game_id and s.ea_club_id = new.ea_club_id) then
    raise exception 'that game is already %, so record the substitution before it is filed', g.status;
  end if;
  /* v4.37: once a sitting is filed or held on the game, CHANGING which club a recorded borrowed club stood for is the
     commissioner's (clear_game_club_substitution holds the same line). Fires on the insert half of the upsert and on
     its update half alike: the existing row still carries the old club in both. */
  if (g.status <> 'scheduled' or g.ea_match_id is not null) and not public.is_commissioner()
     and exists (select 1 from public.game_club_substitutions s
                  where s.game_id = new.game_id and s.ea_club_id = new.ea_club_id and s.team_id is distinct from new.team_id) then
    raise exception 'That game is already filed or held, so its substitution stays. Report it to a commissioner if it is wrong.';
  end if;
  return new;
end $function$;

do $chk$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.guard_game_club_substitution()'::regprocedure);
  if position('g.status <> ''scheduled'' and not public.is_commissioner() and not exists' in v_def) = 0 then
    raise exception 'v4.37c check: the commissioner exemption on a filed game is missing';
  end if;
  if position('s.team_id is distinct from new.team_id' in v_def) = 0 then raise exception 'v4.37c check: the change guard is gone'; end if;
  if position('search_path TO ''''' in v_def) = 0 then raise exception 'v4.37c check: search_path is not empty'; end if;
end $chk$;

/* REHEARSAL part 3 (2026-10-29): one transaction on the live database, rolled back by a closing raise. Part 3 above ran
   first, then a probe on Boston v Dallas Oct 28 (8094aa65, final, 9552 recorded for BOS):
   U1  a commissioner (5a5f118e) removes 9552 and records it again for BOS.
   U2  statistics staff (17a137e6) recording a NEW club (525252) on the filed game is refused, as before.
   U3  statistics staff re-pointing 9552 to DAL is still refused (part 2).
   Result: REHEARSAL OK: U1 U2 U3
   Applied as migration v437c_substitution_commissioner_rerecord; tools/sql/grant-audit.sql returned zero rows, and the
   9552 row still reads BOS afterwards. */
