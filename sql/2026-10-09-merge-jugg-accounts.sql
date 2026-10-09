-- 2026-10-09, commissioner: "Can you add all of Jugg_PRKz's stats to Jugg Backup Acc to combine them since it is the
-- same person? They just needed to make a new account."
-- Jugg_PRKz (created 2026-07-26) was banned on 2026-10-05 by the commissioner for "Hacked Account"; the same member
-- came back as Jugg Backup Acc (created 2026-10-05, the same EA ID Jugg_PRKz, now Boston's goaltender). The importer
-- matched EA persona 1814817735 on the OLD profile, so all five of his box-score lines sat there, including the three
-- Oct 8 games, which the officials were flagged about as an unrostered player.
-- Moves every game_stats line of the old profile to the new one (trg_recompute_overall refreshes both ratings), moves
-- the EA persona id to the new profile so every future game links there (resolveProfile tries the profile persona
-- first), and clears the old, banned profile's EA ID and persona so no line can ever match two people. Pickup stats:
-- none on either account. Rehearsed rolled back first: 5 lines, 5 games, 77 saves on 98 shots, rating 72.
do $m$
declare v_old uuid; v_new uuid; v_n int; v_persona text;
begin
  select id into v_old from public.profiles where gamertag = 'Jugg_PRKz';
  select id into v_new from public.profiles where gamertag = 'Jugg Backup Acc';
  if v_old is null or v_new is null then raise exception 'profiles not found'; end if;
  if not public.is_banned(v_old) or public.is_banned(v_new) then raise exception 'expected the old account banned and the new one not'; end if;
  select ea_player_id into v_persona from public.profiles where id = v_old;
  update public.game_stats set profile_id = v_new where profile_id = v_old;
  get diagnostics v_n = row_count;
  if v_n <> 5 then raise exception 'expected 5 lines, moved %', v_n; end if;
  update public.profiles set ea_player_id = null, ea_id = null where id = v_old;   -- the unique index needs the old one cleared first
  update public.profiles set ea_player_id = v_persona where id = v_new;
  if (select ea_player_id from public.profiles where id = v_new) is distinct from v_persona then raise exception 'persona did not land on the new profile'; end if;
  if (select ea_id from public.profiles where id = v_old) is not null or (select ea_player_id from public.profiles where id = v_old) is not null then raise exception 'old EA identity not cleared'; end if;
  perform public.log_admin_action('stats_merged', 'profile', v_new::text, jsonb_build_object('from', 'Jugg_PRKz', 'to', 'Jugg Backup Acc', 'lines', v_n, 'ea_player_id', v_persona, 'reason', 'same member; the old account was hacked and banned 2026-10-05'));
end $m$;
