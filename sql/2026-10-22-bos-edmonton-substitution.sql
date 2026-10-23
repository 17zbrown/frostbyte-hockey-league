-- 2026-10-22, commissioner: "SBHL Edmonton Oilers will be used instead of the Boston Bruins tonight for their 3 games."
-- Rule 4.6 club substitution (the v3.20 door, sql/2026-09-25-club-substitution.sql): Boston played tonight under the
-- outside EASHL club SBHL Edmonton Oilers (EA club 959), the same club it borrowed on Oct 9. Recorded on Boston's two
-- fixtures that were still open at 10:14 PM ET, so the importer files each as Boston inside its own window and nowhere
-- else; Boston's own EA link (19122) is untouched.
--
-- The night's three Boston fixtures, as found:
--   9:00 PM  Bruins at Stars   (adb4733d)  already FINAL: a no-show forfeit by Boston, Stars 1 0, entered by the
--            commissioner at 9:37 PM ("forfeit ruled"). Not touched: a substitution cannot attach to a final game, and
--            the only Edmonton match against Dallas on EA tonight (2790592930067, ended 9:13 PM, Edmonton 3 Dallas 0)
--            lasted 82 seconds, so it is not a played game. The ruling stands.
--   9:35 PM  Kraken at Bruins  (076ed47d)  open: substitution recorded below.
--   10:10 PM Bruins at Mammoth (d3c5800a)  open: substitution recorded below.
--
-- Run once through the Supabase SQL tool as the commissioner (the RPC is gated to stats staff or a commissioner and
-- logs log_admin_action itself). Called as `perform * from`, never `(f()).*`, which runs a composite-returning function
-- once per column (the six-audit-rows trap). Guards: the acting profile is a commissioner, both fixtures are open and
-- Boston's, EA club 959 belongs to no league club, and exactly two substitutions exist at the end; any failure raises
-- and nothing is kept.
do $sub$
declare
  v_bos uuid; v_n int;
  v_commish uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_games uuid[] := array['076ed47d-589c-48e4-9127-5961be1f59c4','d3c5800a-8cdb-464d-9f7a-09df5283c113']::uuid[];
  v_g uuid;
begin
  select id into v_bos from public.teams where code = 'BOS';
  if v_bos is null then raise exception 'no BOS team'; end if;
  if not exists (select 1 from public.profiles where id = v_commish and role = 'commissioner') then raise exception 'acting profile is not a commissioner'; end if;
  if (select count(*) from public.games where id = any(v_games) and status = 'scheduled' and not coalesce(voided,false)
        and (home_team_id = v_bos or away_team_id = v_bos)) <> 2 then raise exception 'the two Boston fixtures are not both open'; end if;
  if exists (select 1 from public.teams where ea_club_id = '959') then raise exception 'EA club 959 belongs to a league club'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_commish, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  foreach v_g in array v_games loop
    perform * from public.set_game_club_substitution(v_g, '959', v_bos,
      'Rule 4.6: Boston plays its Oct 22 games under the outside EASHL club SBHL Edmonton Oilers (EA club 959). Commissioner ruling, Oct 22: treat that club as Boston for tonight''s games.');
  end loop;
  perform set_config('role', 'postgres', true);

  select count(*) into v_n from public.game_club_substitutions where game_id = any(v_games) and ea_club_id = '959' and team_id = v_bos;
  if v_n <> 2 then raise exception 'expected 2 substitutions, found %', v_n; end if;
end
$sub$;
--
-- Result (10:14 PM ET): two rows in game_club_substitutions, EA 959 as BOS, on 076ed47d (9:35) and d3c5800a (10:10).
-- Within seconds the importer filed the 9:35 game from EA match 2790778380147: Kraken 4, Bruins 2, 12 players, 12 of 12
-- linked. The 10:10 game was in progress and files itself when EA records it.
