-- v4.41 (2026-11-01): the text the database writes for members and staff no longer says he, his or him.
-- Commissioner, 2026-11-01: "member-facing text written by Postgres functions still uses gendered pronouns." Seen when
-- the Season 1 playoff seeding ended the GM and AGM seats: every "Off the front office: <gamertag>" club notice read
-- "<gamertag> is no longer the General Manager. He keeps his roster spot and his position; his cap hit is now $X
-- (Rule 2.6)." and a served suspension told the club "<gamertag> has served his suspension. He is unlocked and may be
-- moved and scheduled again."
--
-- The sweep (2026-11-01, read only): pg_proc for every public function whose source matches
-- \m(he|his|him|himself|she|her|hers|herself)\M, comments stripped. What remained was 34 functions with 55 sentences
-- in string literals that reach people: club notices (club_notify), member notifications, commissioner and department
-- notifications, staff-channel posts, transaction and news lines, written warnings, refusals the site shows as an
-- error, and one returned confirmation (set_player_position). Every one is rewritten in the neutral register the
-- rulebook uses (they, them, their, or "the player"), and the same line loses its em dash where it had one.
--
-- Two sentences also said something no longer true, and now say what the rulebook says:
--   mark_served_suspensions: "He is unlocked and may be moved" described the squad lock v4.25 lifted (a suspended
--     player may already be called up, sent down and traded). Serving now lifts the two bars Rule 7.2 keeps: the
--     player may be scheduled again and may be waived again.
--   can_move_player: "before he can be waived or traded". Its only caller is waive_player; the trade call sites were
--     removed (the function's own comment), so it now says "before they can be waived".
--
-- One string is kept on purpose: notify_roster_remove matches a roster-reason key, byte for byte, that another
-- function sets. It is a lookup key, never shown in a notice, and changing one side alone would break the match.
-- The self-check below expects exactly that one line there and zero lines in the other 33 functions.
--
-- Method (CLAUDE.md, database change protocol step 3): each function is patched by text replacement on its live
-- definition (pg_get_functiondef), each anchor the full exact string and asserted to match exactly once, then
-- re-created with CREATE OR REPLACE, which keeps owner, grants, SECURITY DEFINER, search_path and trigger bindings.
-- Rows already written (old notices, old warnings) are history and stay as written.

create temp table _v441_patch (ord int primary key, fn text not null, a text not null, b text not null) on commit drop;

insert into _v441_patch (ord, fn, a, b) values
-- club notices
(1, 'public._set_team_seat(uuid,text,uuid,text)',
 $a$'||v_seat||'. He keeps his roster spot and his position; his cap hit is now $'||$a$,
 $b$'||v_seat||'. They keep their roster spot and their position; their cap hit is now $'||$b$),
(2, 'public.mark_served_suspensions()',
 $a$'A player')||' has served his suspension',$a$,
 $b$'A player')||' has served their suspension',$b$),
(3, 'public.mark_served_suspensions()',
 $a$'He is unlocked and may be moved and scheduled again.'$a$,
 $b$'They may be scheduled again, and the bar on waiving them is lifted (Rule 7.2).'$b$),
(4, 'public.check_suspended_appearances(uuid)',
 $a$'''s box score for a game played while he was suspended.$a$,
 $b$'''s box score for a game played while they were suspended.$b$),
(5, 'public.check_suspended_appearances(uuid)',
 $a$Decide whether to extend his '||$a$,
 $b$Decide whether to extend their '||$b$),
(6, 'public.check_suspended_appearances(uuid)',
 $a$'Your club dressed '||v_gt||' while he was suspended.$a$,
 $b$'Your club dressed '||v_gt||' while they were suspended.$b$),
(7, 'public.clear_lineups_on_roster_remove()',
 $a$' is no longer on your roster, so his slot in '$a$,
 $b$' is no longer on your roster, so their slot in '$b$),
(8, 'public.extend_suspension(uuid,integer,integer,text)',
 $a$coalesce(gamertag, display_name, 'He')$a$,
 $b$coalesce(gamertag, display_name, 'A player')$b$),
(9, 'public._place_trade_arrivals(uuid,uuid,uuid[],text[],integer)',
 $a$'Trade placement: a player in this trade is not on the club receiving him. Nothing was traded.'$a$,
 $b$'Trade placement: a player in this trade is not on the club receiving them. Nothing was traded.'$b$),
(10, 'public._place_trade_arrivals(uuid,uuid,uuid[],text[],integer)',
 $a$(Rule 2.1). Call ' || case when v_n = 1 then 'him' else 'them' end$a$,
 $b$(Rule 2.1). Call them'$b$),
(11, 'public.grant_cap_exception(uuid,uuid,text)',
 $a$'Say why this player must play past his limit.$a$,
 $b$'Say why this player must play past their limit.$b$),
(12, 'public.grant_cap_exception(uuid,uuid,text)',
 $a$||' past his limit: '||v_n||$a$,
 $b$||' past their limit: '||v_n||$b$),
(13, 'public.grant_cap_exception(uuid,uuid,text)',
 $a$' although he has used '||v_n||' of his '||v_cap||' games.$a$,
 $b$' although they have used '||v_n||' of their '||v_cap||' games.$b$),
(14, 'public.grant_cap_exception(uuid,uuid,text)',
 $a$' past his limit ('||v_n||$a$,
 $b$' past their limit ('||v_n||$b$),
(15, 'public._post_lock_notices(uuid,uuid,public.game_lineups,uuid[],integer,uuid)',
 $a$'so long as the player is on their roster or in their camp and plays his own position (Rule 5.3). '$a$,
 $b$'so long as the player is on that club''s roster or in its camp and plays their own position (Rule 5.3). '$b$),
(16, 'public.notify_roster_add()',
 $a$'. He is not the club’s asset: no trades, no waivers, and he returns to the draft pool when the pre-season ends (Rule 0.4).'$a$,
 $b$'. They are not the club’s asset: no trades, no waivers, and they return to the draft pool when the pre-season ends (Rule 0.4).'$b$),
(17, 'public.notify_roster_remove()',
 $a$'was waived — his cap hit clears and he returns to the free-agent pool (Rule 2.5).'$a$,
 $b$'was waived: their cap hit clears and they return to the free-agent pool (Rule 2.5).'$b$),
(18, 'public.preseason_random_assign()',
 $a$'Randomly assigned for the pre-season — not the club''s assets (no trades, no waivers), back to the draft pool when it ends (Rule 0.4). A player listed at another position than he registered is filling that seat for the pre-season:'$a$,
 $b$'Randomly assigned for the pre-season and not the club''s assets (no trades, no waivers); they go back to the draft pool when it ends (Rule 0.4). A player listed at a position other than the one they registered at is filling that seat for the pre-season:'$b$),
(19, 'public.notify_action_request()',
 $a$coalesce(v_tn,'his club')$a$,
 $b$coalesce(v_tn,'their club')$b$),
(20, 'public.reinstate_roster_spot(uuid)',
 $a$coalesce(v_club,'his club')$a$,
 $b$coalesce(v_club,'their club')$b$),
-- commissioner notifications and the office's own confirmations
(21, 'public.strip_roles_on_departure()',
 $a$' left the league Discord and his sign-up was withdrawn, so his staff role and departments were removed with it (Rule 1.1). Restore them under Users & roles if he returns.'$a$,
 $b$' left the league Discord and their sign-up was withdrawn, so their staff role and departments were removed with it (Rule 1.1). If the member returns, restore the role and departments under Users & roles.'$b$),
(22, 'public.strip_roles_on_departure()',
 $a$' is a commissioner and his sign-up was withdrawn for leaving the Discord.$a$,
 $b$' is a commissioner and their sign-up was withdrawn for leaving the Discord.$b$),
(23, 'public.trg_autoassign_new_reg()',
 $a$place him from Draft & placement if it cannot.'$a$,
 $b$place them from Draft & placement if it cannot.'$b$),
(24, 'public.set_player_position(uuid,public.hockey_position)',
 $a$coalesce(v_team, 'his club')$a$,
 $b$coalesce(v_team, 'their club')$b$),
(25, 'public.set_player_position(uuid,public.hockey_position)',
 $a$' is not on a roster this season; his sign-up position is now '$a$,
 $b$' is not on a roster this season; their sign-up position is now '$b$),
-- refusals the site shows as an error
(26, 'public.can_move_player(uuid,uuid)',
 $a$'Rule 2.4 — ' || v_name || ' has played ' || v_gp || ' of the ' || v_need || ' regular-season games a player needs this season before he can be waived or traded.'$a$,
 $b$'Rule 2.4: ' || v_name || ' has played ' || v_gp || ' of the ' || v_need || ' regular-season games a player needs this season before they can be waived.'$b$),
(27, 'public._issue_suspension(uuid,text,integer,timestamp with time zone,integer,text,text[],text,boolean,uuid)',
 $a$Extend the suspension he is serving instead$a$,
 $b$Extend the suspension they are serving instead$b$),
(28, 'public._issue_suspension(uuid,text,integer,timestamp with time zone,integer,text,text[],text,boolean,uuid)',
 $a$Suspend him to a date instead$a$,
 $b$Suspend them to a date instead$b$),
(29, 'public.accept_trade(uuid)',
 $a$'This offer is stale — a player in it is no longer on the roster of the club offering him.'$a$,
 $b$'This offer is stale: a player in it is no longer on the roster of the club offering them.'$b$),
(30, 'public.draft_make_pick(uuid,uuid)',
 $a$'That player isn''t draft-eligible — he registered after the sign-up cutoff. He''ll be placed on a club as depth after the draft (Rule 2.8).'$a$,
 $b$'That player isn''t draft-eligible: they registered after the sign-up cutoff. They''ll be placed on a club as depth after the draft (Rule 2.8).'$b$),
(31, 'public.guard_award_ballot()',
 $a$'% is not in his first CGHL season (Rule 9.1).'$a$,
 $b$'% is not in their first CGHL season (Rule 9.1).'$b$),
(32, 'public.guard_mgmt_nominee()',
 $a$which has no room for him in his position group. Make room on the active roster first, then nominate him.'$a$,
 $b$which has no room for them in their position group. Make room on the active roster first, then nominate them.'$b$),
(33, 'public.guard_stats_correction()',
 $a$A player raises it with his front office.'$a$,
 $b$A player raises it with their front office.'$b$),
(34, 'public.guard_tc_weekly_cap()',
 $a$'Rule 2.1 — % is in training camp and is already dressed on the % night.$a$,
 $b$'Rule 2.1: % is in training camp and is already dressed on the % night.$b$),
(35, 'public.guard_tc_weekly_cap()',
 $a$so he can hold a slot on only one night.'$a$,
 $b$so they can hold a slot on only one night.'$b$),
(36, 'public.guard_trade_insert()',
 $a$A traded player''s whole salary moves with him.'$a$,
 $b$A traded player''s whole salary moves with them.'$b$),
(37, 'public.lineup_slot_ok(uuid,text,uuid,uuid,text)',
 $a$'Rule 2.1 — % is a %; he cannot be dressed at %.$a$,
 $b$'Rule 2.1: % is a %; they cannot be dressed at %.$b$),
(38, 'public.offer_extension(uuid,bigint,integer,text)',
 $a$'He is on % now — his rights are theirs.'$a$,
 $b$'That player is on % now, and that club holds their rights.'$b$),
(39, 'public.offer_extension(uuid,bigint,integer,text)',
 $a$'His deal runs past this season — an extension can be offered in its final season.'$a$,
 $b$'That player''s deal runs past this season; an extension can be offered in its final season.'$b$),
(40, 'public.offer_extension(uuid,bigint,integer,text)',
 $a$'Extensions open when the season''s free agency does — his deal is then in its final season (Rule 2.2).'$a$,
 $b$'Extensions open when the season''s free agency does; the deal is then in its final season (Rule 2.2).'$b$),
(41, 'public.offer_extension(uuid,bigint,integer,text)',
 $a$'That player is not under contract with a club that holds his rights.'$a$,
 $b$'That player is not under contract with a club that holds their rights.'$b$),
(42, 'public.offer_extension(uuid,bigint,integer,text)',
 $a$'Only the club that holds his contract can offer an extension (Rule 2.2).'$a$,
 $b$'Only the club that holds the player''s contract can offer an extension (Rule 2.2).'$b$),
(43, 'public.offer_extension(uuid,bigint,integer,text)',
 $a$'He has already signed his next deal.'$a$,
 $b$'That player has already signed their next deal.'$b$),
(44, 'public.offer_extension(uuid,bigint,integer,text)',
 $a$'. He can accept, counter or decline.'$a$,
 $b$'. They can accept, counter or decline.'$b$),
(45, 'public.offer_free_agent(uuid,bigint,integer,text,uuid)',
 $a$'That player is under contract — he returns to his club by registering, not through free agency (Rule 2.5).'$a$,
 $b$'That player is under contract: they return to their club by registering, not through free agency (Rule 2.5).'$b$),
(46, 'public.offer_free_agent(uuid,bigint,integer,text,uuid)',
 $a$'That player is in rookie bidding — he is won on the bidding board, not signed directly.'$a$,
 $b$'That player is in rookie bidding: they are won on the bidding board, not signed directly.'$b$),
(47, 'public.offer_free_agent(uuid,bigint,integer,text,uuid)',
 $a$'. He can accept, counter or decline.'$a$,
 $b$'. They can accept, counter or decline.'$b$),
(48, 'public.office_withdraw_registration(uuid,text)',
 $a$Remove him from the seat first (Rule 2.6).'$a$,
 $b$Remove them from the seat first (Rule 2.6).'$b$),
(49, 'public.place_new_roster_spot()',
 $a$'Rule 2.1: he left this club''s training camp during the roster freeze, so he returns to it, and it is full (% players). Sign him after the freeze lifts at % ET, or make room in camp.'$a$,
 $b$'Rule 2.1: this player left this club''s training camp during the roster freeze, so they return to it, and it is full (% players). Sign them after the freeze lifts at % ET, or make room in camp.'$b$),
(50, 'public.place_new_roster_spot()',
 $a$'Rule 2.1: this club''s active roster has no room for him and its training camp is full$a$,
 $b$'Rule 2.1: this club''s active roster has no room for this player and its training camp is full$b$),
(51, 'public.resend_trade(uuid)',
 $a$the club that offered him, so the offer cannot be resent$a$,
 $b$the club that offered them, so the offer cannot be resent$b$),
(52, 'public.resend_trade(uuid)',
 $a$the club asked for him, so the offer cannot be resent$a$,
 $b$the club asked for them, so the offer cannot be resent$b$),
(53, 'public.respond_offer(uuid,text,bigint,integer)',
 $a$'This offer lapsed — % no longer holds his rights.'$a$,
 $b$'This offer lapsed: % no longer holds their rights.'$b$),
(54, 'public.set_game_lineup(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean)',
 $a$Playing him again would forfeit the game (Rule 5.2).'$a$,
 $b$Playing them again would forfeit the game (Rule 5.2).'$b$),
(55, 'public.sign_free_agent(uuid,bigint,uuid)',
 $a$'That player is in rookie bidding — he is won on the bidding board, not signed directly.'$a$,
 $b$'That player is in rookie bidding: they are won on the bidding board, not signed directly.'$b$);

-- the patch: every anchor must match its live definition exactly once, or nothing is changed
do $patch$
declare f text; r record; v_def text; n int; v_fns int := 0;
begin
  for f in select fn from _v441_patch group by fn order by min(ord) loop
    v_def := pg_get_functiondef(f::regprocedure);
    for r in select * from _v441_patch where fn = f order by ord loop
      n := (length(v_def) - length(replace(v_def, r.a, ''))) / length(r.a);
      if n <> 1 then raise exception 'v4.41: % anchor % found % times', f, r.ord, n; end if;
      v_def := replace(v_def, r.a, r.b);
    end loop;
    execute v_def;
    v_fns := v_fns + 1;
  end loop;
  if v_fns <> 34 then raise exception 'v4.41: patched % functions, expected 34', v_fns; end if;
end $patch$;

-- self-checks: every old sentence gone, every new one in place, and no gendered line left outside comments
do $chk$
declare r record; v_def text; n int; k int;
begin
  for r in select * from _v441_patch order by ord loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.a in v_def) > 0 then raise exception 'v4.41 check: % still holds the old text of row %', r.fn, r.ord; end if;
    if position(r.b in v_def) = 0 then raise exception 'v4.41 check: % lacks the new text of row %', r.fn, r.ord; end if;
  end loop;
  for r in select distinct fn from _v441_patch loop
    select count(*) into n
      from regexp_split_to_table(regexp_replace(regexp_replace(pg_get_functiondef(r.fn::regprocedure),
             '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g'), E'\n') x
     where x ~* '\m(he|his|him|himself|she|her|hers|herself)\M';
    k := case when r.fn = 'public.notify_roster_remove()' then 1 else 0 end;   -- the roster-reason key (header)
    if n <> k then raise exception 'v4.41 check: % has % gendered line(s) outside comments, expected %', r.fn, n, k; end if;
  end loop;
end $chk$;

/* REHEARSAL (2026-11-01, one transaction on the live database, rolled back by a closing raise). Before the migration
   the call snapshotted every public function (source, ACL, SECURITY DEFINER, search_path, owner, trigger count).
   The patch block matched all 55 anchors exactly once and re-created 34 functions; the $chk$ block passed.
   T1 exactly 34 public functions changed source, all of them on the list; no other function changed.
   T2 all 34 kept their owner, grants, SECURITY DEFINER, search_path and trigger bindings.
   T3 the 2026-11-01 incident replayed: _set_team_seat ended the GM seat of cako ('season', as the playoff
      seeding does), and the club notice read "cako is no longer the General Manager. They keep their roster spot and
      their position; their cap hit is now $0.75M (Rule 2.6)." (pass undone with ZZ001).
   T4 a dated suspension for Petri x 20 that ended yesterday; mark_served_suspensions() told the front office
      "Petri x 20 has served their suspension. They may be scheduled again, and the bar on waiving them is lifted
      (Rule 7.2)." as a notification, and nothing reached the club room (pass undone with ZZ001).
   The first run failed T4 only because the probe read club_notices: that notice is sent with p_room false, so it
   goes to the three seats as notifications; the probe was corrected, the migration was not changed.
   Result: REHEARSAL OK: T1 T2 T3 T4.
   Afterward: both old sentences were still in the live definitions, no rehearsal suspension existed and cako was
   still the General Manager, so nothing stuck.
   Applied as migration v441_neutral_pronouns_db; tools/sql/grant-audit.sql returned zero rows. The sweep run again
   afterward found no gendered text outside comments in any of the 34 but the roster-reason key above. */
