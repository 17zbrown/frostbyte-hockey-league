-- v4.00 (2026-10-13): a prorated playoff floor rounds to the nearest game, a fraction of .4 or less down.
--
-- Commissioner, 2026-10-13, on KwikTripJesus (placed on Detroit with 45 of its 54 games left: 16 x 45 / 54 = 13.33, which
-- v3.94 rounded UP to 14): "Round down at .4". A share whose fraction is .4 or less rounds down; anything above .4 rounds
-- up. Read against Season 1 on the day: 18 late joiners still on a roster need one game fewer (13.33 -> 13, 15.11 -> 15,
-- 14.22 -> 14, 8.30 -> 8; 25 counting players since removed from every roster), and nobody's floor rises (14.81, 11.56, 10.96, 10.67 and 8.89 already rounded up and still do).
-- player_playoff_floor is the one definition: set_game_lineup's playoff branch, award_eligible and playoff_floors (the
-- site's figure) all read it, so nothing else changes.

do $p$
declare v_def text := pg_get_functiondef('public.player_playoff_floor(uuid,uuid)'::regprocedure);
        a text := 'declare v_floor int; v_open timestamptz; v_joined timestamptz; v_club uuid; v_total int; v_left int;';
        b text := 'declare v_floor int; v_open timestamptz; v_joined timestamptz; v_club uuid; v_total int; v_left int; v_x numeric;';
        c text := '  return least(v_floor, ceil(v_floor::numeric * v_left / v_total)::int);';
        d text := '  /* v4.00 (commissioner, 2026-10-13): "Round down at .4". The share rounds to the nearest game, a fraction of .4
     or less down and anything above it up: 16 x 45 / 54 = 13.33 is 13; 16 x 50 / 54 = 14.81 is 15. */
  v_x := v_floor::numeric * v_left / v_total;
  return least(v_floor, (case when v_x - floor(v_x) > 0.4 then ceil(v_x) else floor(v_x) end)::int);';
begin
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1
     or (length(v_def) - length(replace(v_def, c, ''))) / length(c) <> 1 then raise exception 'v4.00: player_playoff_floor anchors'; end if;
  execute replace(replace(v_def, a, b), c, d);
end $p$;

do $chk$
declare v_s uuid := (select id from public.seasons where number = 1);
        v_kw uuid := (select id from public.profiles where gamertag = 'KwikTripJesus');
begin
  if position('v_x - floor(v_x) > 0.4' in pg_get_functiondef('public.player_playoff_floor(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'v4.00: the rounding is not in place';
  end if;
  if v_kw is not null and public.player_playoff_floor(v_s, v_kw) <> 13 then
    raise exception 'v4.00: KwikTripJesus reads % (expected 13)', public.player_playoff_floor(v_s, v_kw);
  end if;
end $chk$;
