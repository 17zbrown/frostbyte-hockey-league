-- v4.48 (2026-11-06): the overall rating moves to an NHL 27 feel, and each position is weighted for its job.
--
-- Commissioner, 2026-11-06: "Can you skew our CGHL player rating to match the NHL 27 NHL player ratings?", then "Not
-- match, but be similar to?", then "Center on 85". And: "Can we favor more offense in the winger overalls, more defense
-- in the defense overalls, a mixture of somewhere around 60:40 for centers of offense to defense?"
--
-- WHY THE SCALE: EA publishes only its top 300 (average 87.13, median 86, lowest 84, one 99). A strict match would put
-- every CGHL player at 84 or better and erase the bottom of the league, so the scale is similar, not equal: the league
-- median is 85. The shape is the old curve scaled toward 99 by 14/29, which is a straight line in the old number, so the
-- scale change on its own moves nobody past anybody:
--     new = 99 - (99 - old) * 14 / 29,   old = 50 + 49 / (1 + exp(-(z - 0.372)))
--     rating = 75.345 + 23.655 / (1 + exp(-(z - 0.372))), z clamped to [-3.5, 4]
--     z 0 is 85 (old 70), z 1.28 is 92 (old 85), z 1.93 is 95 (old 90), z 4 is 98 (old 97.7, 99 still unreachable).
-- The bottom of the scale is 75.345: the old 50. The z clamp keeps anybody from reaching it.
--
-- WHY THE WEIGHTS: counting Shooting, Passing and Hand-eye (faceoffs, deflections, possession) as offense, Defense and
-- Physicality (hits, penalties drawn and taken) as defense, wings and centers both sat at 70:30, and DEFENSEMEN WERE RATED
-- 56:44 TOWARD OFFENSE. Now wing 75:25, center 60:40, defense 30:70. The commissioner set center; wing and defense were
-- "more" with no number, so these are the values chosen, one table to change. Goalies are not touched. Ratings are still
-- scored against the same position, so every position keeps a median of 85: a defenseman's number says how they compare to
-- other defensemen, and a change here reorders players inside a position, not positions against each other.
--
-- ONE DEFINITION: public.cghl_center() replaces the literal 70 in overall_breakdown and refresh_player_overall.
-- The hold is unchanged in substance (the commissioner's six-game ruling, v3.74): the standard score still shrinks toward
-- zero until the sixth game at a position, and zero is now 85. A player with no games at a position shows 85.

create or replace function public.cghl_center()
returns integer language sql immutable set search_path to ''
as $$ select 85 $$;
revoke all on function public.cghl_center() from public, anon, authenticated;

create or replace function public.cghl_curve(p_z numeric)
returns numeric language sql immutable set search_path to 'public'
as $function$
  /* v4.48: was 50 + 49 / (...). See the header of this record for the conversion. */
  select case when p_z is null then null else
    least(99, greatest(75.345,
      75.345 + 23.655 / (1 + exp(-(greatest(-3.5, least(4, p_z)) - 0.372)))))
  end;
$function$;

create or replace function public.cghl_cat_weights()
returns table(grp text, cat text, w numeric) language sql immutable set search_path to 'public'
as $function$
  /* v4.48: wing 75:25, center 60:40 (the commissioner's number), defense 30:70, offense (Shooting, Passing, Hand-eye)
     to defense (Defense, Physicality). Goalies unchanged. */
  select * from (values
    ('W','SHOOTING',0.33),('W','PASSING',0.27),('W','HANDEYE',0.15),('W','DEFENSE',0.17),('W','PHYSICALITY',0.08),
    ('C','PASSING',0.25),('C','SHOOTING',0.23),('C','HANDEYE',0.12),('C','DEFENSE',0.29),('C','PHYSICALITY',0.11),
    ('D','DEFENSE',0.50),('D','PHYSICALITY',0.20),('D','PASSING',0.15),('D','SHOOTING',0.08),('D','HANDEYE',0.07),
    ('G','CONSISTENCY',0.46),('G','REFLEXES',0.34),('G','CLUTCHNESS',0.20)
  ) v(grp,cat,w);
$function$;

-- The literal 70 leaves the two functions that hold it. Anchored on the full string, exactly once each.
do $patch$
declare d text; a text;
begin
  d := pg_get_functiondef('public.overall_breakdown(uuid,text)'::regprocedure);
  a := $a$'overall', 70,$a$;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'overall_breakdown anchor is not unique'; end if;
  execute replace(d, a, $b$'overall', public.cghl_center(),$b$);

  d := pg_get_functiondef('public.refresh_player_overall(uuid)'::regprocedure);
  a := $a$v_ov int := 70;$a$;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'refresh_player_overall default anchor is not unique'; end if;
  d := replace(d, a, $b$v_ov int := public.cghl_center();$b$);
  a := $a$coalesce((v_bd->>'overall')::int, 70)$a$;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'refresh_player_overall coalesce anchor is not unique'; end if;
  execute replace(d, a, $b$coalesce((v_bd->>'overall')::int, public.cghl_center())$b$);
end $patch$;

-- Re-rate everybody now, not at the next final: a final only re-rates players with league games, which would leave every
-- player with no games at a stored 70 under a scale whose middle is 85. Same calls, same flag as trg_game_final_overall.
do $rerate$
declare r record;
begin
  perform set_config('app.role_grant', 'on', true);
  perform public.refresh_rating_norms();
  for r in select distinct profile_id as pid from public.player_position_overalls loop
    perform public.refresh_player_overall(r.pid);
  end loop;
  perform set_config('app.role_grant', '', true);
end $rerate$;

-- Self-checks: anything wrong here raises and the whole migration rolls back.
do $chk$
declare v_n int; v_bad text;
begin
  if round(public.cghl_curve(0)) <> 85 then raise exception 'curve(0) is %, want 85', public.cghl_curve(0); end if;
  if round(public.cghl_curve(4)) >= 99 then raise exception 'curve(4) reached 99'; end if;
  if public.cghl_center() <> 85 then raise exception 'cghl_center is not 85'; end if;
  select string_agg(grp || '=' || t, ',') into v_bad from (select grp, sum(w) t from public.cghl_cat_weights() group by grp) s where t <> 1;
  if v_bad is not null then raise exception 'weights do not sum to 1: %', v_bad; end if;
  select string_agg(grp, ',') into v_bad from (
    select grp, sum(w) filter (where cat in ('SHOOTING','PASSING','HANDEYE')) o from public.cghl_cat_weights() where grp <> 'G' group by grp
  ) s where (grp, o) not in (('W', 0.75), ('C', 0.60), ('D', 0.30));
  if v_bad is not null then raise exception 'offense shares are off for %', v_bad; end if;
  if position(' 70' in pg_get_functiondef('public.overall_breakdown(uuid,text)'::regprocedure)) > 0
     or position(' 70' in pg_get_functiondef('public.refresh_player_overall(uuid)'::regprocedure)) > 0 then
    raise exception 'a literal 70 survives in the rating functions';
  end if;
  select count(*) into v_n from public.player_position_overalls where overall < 75 or overall > 99;
  if v_n > 0 then raise exception '% rating rows are off the new scale', v_n; end if;
  select count(*) into v_n from public.player_position_overalls o join public.profiles p on p.id = o.profile_id
   where o.headline and p.overall is distinct from o.overall;
  if v_n > 0 then raise exception '% profiles do not carry their headline rating', v_n; end if;
  if has_function_privilege('anon', 'public.cghl_center()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cghl_center()', 'EXECUTE') then
    raise exception 'cghl_center is executable by members';
  end if;
end $chk$;

/* REHEARSAL (2026-11-06, one transaction on the live database, rolled back by a closing raise):
   First pass stopped on its own T1: 21 stored rating rows would disappear. Second pass listed them: all 21 were players
   with no games, whose stored row sat at an old sign-up position; refresh_player_overall moved each to the current one
   (21 added, 21 gone, every row gp 0). Nothing with a game was lost; games counted changed on 0 rows; 2 headlines moved.
   No http request queued (nothing leaves for Discord). Self-checks passed: curve(0) rounds to 85, curve(4) under 99,
   weights sum to 1, offense shares 75/60/30, no literal 70 left, every row on the scale, every profile on its headline.
   Settled signed-up ratings: 117 players, average 86.03, median 86, range 79 to 93, 91 at 84 or better, 19 at 90 or
   better, none at 95. By position (6+ games, every position row): C 24 avg 88.46, W 51 avg 86.67, G 24 avg 85.63,
   D 47 avg 85.23. No-game rows: 147 of 147 at 85. Largest move past the plain rescale: C 1.9, D 1.8, W 1.3, G 0.6.
   Names checked at the top of each position (the calibration rule of v3.49): D AdzukiLetan66, Roz, startsucxn, Mr. Plow up
   from tenth; W biz, Scorezov, Lokharov92; C Big6Bad9John, Saqoy; G the16thgunner, unchanged at the top.
   Result: REHEARSAL OK.
   Applied as migration v448_rating_scale_and_position_weights; tools/sql/grant-audit.sql returned zero rows. Live after
   apply: 117 settled signed-up ratings, average 86.03, median 86, range 79 to 93, matching the rehearsal. */
