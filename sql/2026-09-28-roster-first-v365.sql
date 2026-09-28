-- v3.65: roster players come first in a lineup; training-camp availability counts.
-- Commissioner, 2026-09-28 (Q14, asked whether weekly availability applies to camp players): "training camp
-- player availability does matter. They can play up to 3 games a week while roster players can play up to
-- 6. Roster players also must be prioritized in a lineup when available."
-- The limits (camp 3, roster 6) and camp players' availability duty already hold; what is new is the
-- priority. Read as: a camp player takes a lineup spot only when no active-roster player of the same kind
-- (a goaltender for the goaltender's spot, a skater for a skater's) who is available for that game, not
-- suspended and within his limit is left out. Positions are unlocked (v3.40), so any roster skater can
-- fill any skater spot.

/* ---- "available for this game": the player's own per-game answer (v2.44 shape) ---------------------------
   availability.nights = { nK: { games: { "<game id>": "yes"|"no" }, st, note } } under the week key
   w<week> (regular), pre<week> or po<week>. Only an explicit "yes" for this exact game counts: a player who
   answered nothing is not treated as available, so he never blocks a camp player. */
create or replace function public.available_for_game(p_profile uuid, p_game uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select exists (
    select 1 from public.games g
      join public.availability a
        on a.season_id = g.season_id and a.profile_id = p_profile
       and a.week_key = case coalesce(g.stage,'regular') when 'preseason' then 'pre' when 'playoff' then 'po' else 'w' end || g.week
      cross join lateral jsonb_each(coalesce(a.nights, '{}'::jsonb)) n
     where g.id = p_game
       and jsonb_typeof(n.value) = 'object'
       and n.value->'games'->>p_game::text = 'yes');
$fn$;
revoke all on function public.available_for_game(uuid, uuid) from public, anon, authenticated;

/* ---- set_game_lineup: the priority, checked on every filing ------------------------------------------
   Counted against the open spots of the same kind, so a sheet filled in any order is judged fairly: a camp
   player breaks the rule only when more eligible roster players are left out than there are empty spots
   they could still take. On a complete sheet (no empty spot) any one left out is enough. */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)'::regprocedure);
  d := replace(d0,
'  end loop;

  v_lock := v_game.scheduled_at - interval ''30 minutes'';',
'  end loop;

  /* v3.65 (commissioner, 2026-09-28, Q14): "Roster players also must be prioritized in a lineup when
     available." A training-camp player takes a spot only when no active-roster player of the same kind
     (goaltender or skater) who is available for this game, not suspended, playoff-eligible and within
     his limit is left out, counted against the empty spots of that kind still open on the sheet. */
  declare
    v_kind text; v_slots uuid[]; v_camp int; v_empty int; v_left text[];
  begin
    foreach v_kind in array array[''skater'',''goal''] loop
      v_slots := case when v_kind = ''goal'' then array[p_goalie] else array[p_center, p_lw, p_rw, p_ld, p_rd] end;
      select count(*) into v_camp from unnest(v_slots) x
        join public.roster_spots rs on rs.profile_id = x and rs.season_id = v_game.season_id
         and rs.team_id = p_team and rs.status = ''active'' and rs.squad = ''tc'';
      if v_camp = 0 then continue; end if;
      v_empty := (select count(*) from unnest(v_slots) x where x is null);
      select array_agg(coalesce(nullif(p.gamertag,''''), ''a player'') order by lower(coalesce(p.gamertag,''''))) into v_left
        from public.roster_spots rs join public.profiles p on p.id = rs.profile_id
       where rs.season_id = v_game.season_id and rs.team_id = p_team and rs.status = ''active'' and rs.squad = ''pro''
         and case when v_kind = ''goal'' then rs.position::text = ''G'' else rs.position::text <> ''G'' end
         and rs.profile_id <> all(v_players)
         and public.available_for_game(rs.profile_id, p_game)
         and not public.is_suspended(rs.profile_id)
         and (v_game.stage <> ''playoff'' or public.playoff_min_gp(v_game.season_id) = 0
              or public.regular_gp(v_game.season_id, rs.profile_id) >= public.playoff_min_gp(v_game.season_id))
         and (public.player_week_games(v_game.season_id, v_game.stage, v_game.week, rs.profile_id, p_game)
                < case when v_game.stage = ''playoff'' then public.series_cap(v_game.season_id, ''pro'', rs.position::text)
                       else public.weekly_cap(v_game.season_id, ''pro'', rs.position::text, v_game.stage) end
              or public.has_cap_exception(p_game, rs.profile_id));
      if coalesce(array_length(v_left, 1), 0) > v_empty then
        raise exception ''Rule 5.2: roster players come first. % % available for this game and not in the lineup, so a training-camp player cannot take % spot. Dress % first, or have % mark % unavailable.'',
          array_to_string(v_left, '', ''), case when array_length(v_left, 1) = 1 then ''is'' else ''are'' end,
          case when v_kind = ''goal'' then ''the goaltender''''s'' else ''a skater''''s'' end,
          case when array_length(v_left, 1) = 1 then ''him'' else ''them'' end,
          case when array_length(v_left, 1) = 1 then ''him'' else ''them'' end,
          case when array_length(v_left, 1) = 1 then ''himself'' else ''themselves'' end
          using errcode = ''check_violation'';
      end if;
    end loop;
  end;

  v_lock := v_game.scheduled_at - interval ''30 minutes'';');
  if d = d0 then raise exception 'set_game_lineup: the anchor after the cap loop was not found'; end if;
  if (length(d0) - length(replace(d0, 'v_lock := v_game.scheduled_at - interval ''30 minutes'';', ''))) <> length('v_lock := v_game.scheduled_at - interval ''30 minutes'';') then
    raise exception 'set_game_lineup: the anchor is not unique';
  end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-09-28, one transaction on the live database, rolled back by a closing raise; claims set
   to the commissioner). SEA's game of Sep 30, 9:00 PM: nine roster skaters and one roster goaltender had
   said yes; SEA carries six camp skaters and two camp goaltenders.
   1  Four roster skaters, one camp skater and the roster goaltender: refused, "Rule 5.2: roster players come
      first. biz, Kay, magsineh, Pip, XCHELPRO87X [AGM] are available for this game and not in the lineup,
      so a training-camp player cannot take a skater's spot."
   2  Five roster skaters and the roster goaltender: accepted.
   3  The same five with a camp goaltender: refused, "the goaltender's spot".
   4  The roster goaltender's answer for that game turned to no: the camp goaltender was accepted.
   5  A partial sheet (one camp skater, four open skater spots, nine roster skaters out): refused.
   Result: REHEARSAL OK (all five). Applied as migration v365_roster_first.

   AFTER APPLYING: sheets already on file were checked against the rule. Only DAL had any: seven games
   (Sep 30 9:00, 9:35, 10:10; Oct 1 10:10; Oct 2 9:00, 9:35, 10:10 PM ET) dressed camp skaters while
   available roster skaters sat out. DAL's front office was told privately to refile them before each lock
   (notice "Lineups to refile: roster players come first"). Nothing was changed on the sheets themselves. */
