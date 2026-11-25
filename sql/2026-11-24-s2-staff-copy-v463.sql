-- v463 (DRAFT, 2026-11-24; apply at the flip, T+15, THIRD, after the staff powers and the all-staff voting records,
-- never before): Season 2 staff copy. After the flip there are no departments and no reviewers (commissioner,
-- 2026-10-19: "we will remove the different departments, and we will allow every staff member to be a part of one big
-- group"; 2026-10-22: no Media role; 2026-11-23: six committees, every staffer and commissioner votes on applications,
-- the Draft and Bidding manager runs the draft and bidding tools). Database text sent to members or staff that names a
-- department, the reviewers, the review board or the Media exemption becomes false at the flip, so this record rewrites
-- it. It changes words only: every pair below swaps a message (or, in staff_vote_cast, removes a Media check that the
-- staff powers record already made unreachable), and nothing a member or staffer may do changes here.
--
-- Apply order at the flip (one owner per function, so the three records compose): 1. the staff powers record
-- (sql/2026-11-24-s2-staff-powers-v463.sql), 2. the all-staff voting record (sql/2026-11-24-s2-all-staff-voting-v463.sql),
-- 3. this record, which refuses to run before the other two. Reverse in the opposite order: this reverse first, then the
-- all-staff voting reverse, then the staff powers reverse (which refuses to run while this record stands).
-- This record owns reverse_trade, resend_trade, guard_trade_status, apply_application_decision, owner_remove_manager,
-- draft_pause, draft_resume, draft_reset_clock, draft_skip_pick, declare_forfeit, ops_exempt_game_limits,
-- ops_reschedule_game, ops_set_limit_week, rankings_set_order, rankings_clear, check_suspended_appearances,
-- strip_roles_on_departure, guard_mgmt_nominee, _mgmt_nominee_seat_block, staff_vote_cast, set_owner_app_club,
-- decide_owner_application, guard_app_insert, override_application_decision and _owner_app_autoplace; no other flip
-- record patches them. extend_suspension's department message belongs to the staff powers record, which owns that
-- function. The last five were found by this record's own sweep (2026-11-24) beside the rulebook stream's list.
--
-- The words: "the league staff" for a power every staffer now holds; "the Draft and Bidding manager" for the draft room
-- (has_department('draft') is the seated manager or a commissioner); "the league office" for a decision the staff vote
-- or a commissioner made (a commissioner may still decide alone, so "the staff vote" would be wrong for an override);
-- "a committee manager or a commissioner" for an extension (only they suspend and extend). No message branches on the
-- season: from the flip the rules these messages describe hold in every season (guard_mgmt_nominee's old path is the
-- non-market path, and the Media exemption it named is gone in every season once is_media_only_staff answers no).
--
-- Left alone, on purpose: the retired waitlist functions (waitlist_admit, waitlist_application, waitlist_remove), which
-- the application waitlist's removal record retires and which hold no row; comments inside function bodies that record
-- history; the routing keys passed to notify_department (it bells the whole staff after the staff powers record);
-- staff_vote_cast's department-scoped ballots and staff_vote_board/staff_vote_create (the staff vote tools are retired,
-- 0 used in Season 1); apply_application_decision's Media-exclusive application check (a staff application carries no
-- department from Season 2, so it cannot fire).
--
-- Each pair anchors on the full exact text read from production with pg_get_functiondef on 2026-11-24 (an em dash in
-- the old text is built with chr(8212), never typed), is asserted to match once, to land once, and to leave the old text
-- nowhere in the function; the self-checks at the end repeat that for every pair.
-- Reverse: sql/2026-11-24-s2-staff-copy-v463.reverse.sql (the same pairs, undone by exact anchor).
-- Rehearsal: sql/2026-11-24-s2-staff-copy-v463.rehearsal.sql (the staff powers and all-staff voting records, then this
-- record, the cases, this reverse). Test: tools/s2-staff-copy-v463.test.cjs.

do $pre$
begin
  if to_regprocedure('public.profile_has_department(uuid,text)') is null
     or to_regprocedure('public.request_suspension(uuid,text,integer,timestamptz,integer,text,text[],text,uuid)') is null then
    raise exception 'v463 staff copy: apply the staff powers record first (the apply order is staff powers, all-staff voting, copy)';
  end if;
  if position('public.is_staff_voter(p_uid)' in pg_get_functiondef('public.is_app_reviewer(uuid)'::regprocedure)) = 0 then
    raise exception 'v463 staff copy: apply the all-staff voting record first (the apply order is staff powers, all-staff voting, copy)';
  end if;
  if position('the Draft and Bidding manager.' in pg_get_functiondef('public.draft_pause(integer)'::regprocedure)) > 0 then
    raise exception 'v463 staff copy: already applied';
  end if;
end $pre$;

do $fwd$
declare r record; v_def text; n int;
begin
  for r in select * from (values
-- >>> patch pairs
    (1, 'public.reverse_trade(uuid,text)', $o$    raise exception 'Only the transactions department or a commissioner can reverse a trade.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can reverse a trade.';
$n$),
    (2, 'public.reverse_trade(uuid,text)', $o$  select coalesce(nullif(gamertag,''),'the transactions department') into v_who
$o$, $n$  select coalesce(nullif(gamertag,''),'the league staff') into v_who
$n$),
    (3, 'public.reverse_trade(uuid,text)', $o$    values (t.season_id, 'trade', 'The transactions department reversed the trade between <b>'||
$o$, $n$    values (t.season_id, 'trade', 'The league office reversed the trade between <b>'||
$n$),
    (4, 'public.reverse_trade(uuid,text)', $o$    'Your trade with '||v_to||' was reversed by the transactions department: '||p_reason, 'transactions', null);
$o$, $n$    'Your trade with '||v_to||' was reversed by the league office: '||p_reason, 'transactions', null);
$n$),
    (5, 'public.reverse_trade(uuid,text)', $o$    'Your trade with '||v_from||' was reversed by the transactions department: '||p_reason, 'transactions', null);
$o$, $n$    'Your trade with '||v_from||' was reversed by the league office: '||p_reason, 'transactions', null);
$n$),
    (6, 'public.resend_trade(uuid)', $o$    raise exception 'Only the transactions department or a commissioner can resend a trade.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can resend a trade.';
$n$),
    (7, 'public.guard_trade_status()', $o$accepted in the Trade Hub, and reversed by the transactions department.',
$o$, $n$accepted in the Trade Hub, and reversed by the league office.',
$n$),
    (8, 'public.apply_application_decision(text,uuid,boolean)', $o$        'The reviewer vote approved your application $o$ || chr(8212) || $o$ you now own the ' || coalesce(v_label, v_placed) ||
$o$, $n$        'The league office approved your application: you now own the ' || coalesce(v_label, v_placed) ||
$n$),
    (9, 'public.apply_application_decision(text,uuid,boolean)', $o$               then 'The reviewer vote approved your application. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
$o$, $n$               then 'The league office approved your application. The ' || public._owner_app_held_club(p_id) || ' would be a new club for the league: '
$n$),
    (10, 'public.apply_application_decision(text,uuid,boolean)', $o$             when p_approve then 'The reviewer vote approved your application to own a club. A commissioner will hand you your club shortly.'
             else 'The reviewer vote did not approve your application to own a club this time. You can reapply any time.' end, null, null);
$o$, $n$             when p_approve then 'The league office approved your application to own a club. A commissioner will hand you your club shortly.'
             else 'The league office did not approve your application to own a club this time. You can reapply any time.' end, null, null);
$n$),
    (11, 'public.apply_application_decision(text,uuid,boolean)', $o$        v_block := 'they own or manage a club, and only Media may be held alongside a club seat';
$o$, $n$        v_block := 'they own or manage a club, and no league staff role may be held alongside a club seat';
$n$),
    (12, 'public.apply_application_decision(text,uuid,boolean)', $o$          v_name || ' was approved by the reviewer vote but the staff role was NOT granted, because '||
          v_block || ' (Rule 2.7). Narrow them to Media alone, or resolve the other side, then grant '||
$o$, $n$          v_name || ' was approved by the league office but the staff role was NOT granted, because '||
          v_block || ' (Rule 2.7). Resolve the other side first, then grant '||
$n$),
    (13, 'public.apply_application_decision(text,uuid,boolean)', $o$          'The reviewer vote approved your application, but it can''t be granted as written: '||v_block||
$o$, $n$          'The league office approved your application, but it can''t be granted as written: '||v_block||
$n$),
    (14, 'public.apply_application_decision(text,uuid,boolean)', $o$        'The reviewer vote did not approve your staff application this time. You can reapply any time.', null, null);
$o$, $n$        'The league office did not approve your staff application this time. You can reapply any time.', null, null);
$n$),
    (15, 'public.apply_application_decision(text,uuid,boolean)', $o$            v_name || ' has the reviewers'' approval as ' || v_rolelabel || ' of ' || coalesce(v_team, 'a club') ||
$o$, $n$            v_name || ' has the league office''s approval as ' || v_rolelabel || ' of ' || coalesce(v_team, 'a club') ||
$n$),
    (16, 'public.apply_application_decision(text,uuid,boolean)', $o$            'The reviewers approved ' || v_name || ', but the appointment could not be applied yet: ' || v_block ||
$o$, $n$            'The league office approved ' || v_name || ', but the appointment could not be applied yet: ' || v_block ||
$n$),
    (17, 'public.apply_application_decision(text,uuid,boolean)', $o$        'The reviewer vote did not approve '||v_name||' as your club''s '||v_rolelabel||' this time.', null, null);
$o$, $n$        'The league office did not approve '||v_name||' as your club''s '||v_rolelabel||' this time.', null, null);
$n$),
    (18, 'public.owner_remove_manager(text,text)', $o$    ' (Rule 2.6). The seat stays vacant until the Owner nominates a successor and the reviewers approve.',
$o$, $n$    ' (Rule 2.6). The seat stays vacant until the Owner nominates a successor and the staff vote approves the nomination.',
$n$),
    (19, 'public.draft_pause(integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (20, 'public.draft_resume(integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (21, 'public.draft_reset_clock(integer,integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (22, 'public.draft_skip_pick(integer)', $o$then raise exception 'The draft room is run by a commissioner or the draft department.'; end if;
$o$, $n$then raise exception 'The draft room is run by a commissioner or the Draft and Bidding manager.'; end if;
$n$),
    (23, 'public.declare_forfeit(uuid,uuid,boolean)', $o$    raise exception 'Only a commissioner or the officiating department can declare a forfeit.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can declare a forfeit.';
$n$),
    (24, 'public.ops_exempt_game_limits(uuid,boolean,text)', $o$    raise exception 'Only a commissioner or the operations department can exempt a game from the weekly game limits.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can exempt a game from the weekly game limits.';
$n$),
    (25, 'public.ops_reschedule_game(uuid,timestamptz)', $o$    raise exception 'Only a commissioner or the operations department can move a game.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can move a game.';
$n$),
    (26, 'public.ops_set_limit_week(uuid,integer,text)', $o$    raise exception 'Only a commissioner or the operations department can rule which week a game counts toward.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can rule which week a game counts toward.';
$n$),
    (27, 'public.rankings_set_order(text[])', $o$    raise exception 'Power rankings are set by a commissioner or the media department.';
$o$, $n$    raise exception 'Power rankings are set by the league staff or a commissioner.';
$n$),
    (28, 'public.rankings_clear()', $o$    raise exception 'Power rankings are set by a commissioner or the media department.';
$o$, $n$    raise exception 'Power rankings are set by the league staff or a commissioner.';
$n$),
    (29, 'public.check_suspended_appearances(uuid)', $o$      'forfeit loss for '||v_code||' and its management has been given a written warning. Decide whether to extend their '||
      'suspension (Rule 7.2): open it on the desk and add games in steps of three.', 'staffdesk', null);
$o$, $n$      'forfeit loss for '||v_code||' and its management has been given a written warning. A committee manager or a '||
      'commissioner decides whether to extend their suspension (Rule 7.2); any other staff member files a suspension request.', 'staffdesk', null);
$n$),
    (30, 'public.check_suspended_appearances(uuid)', $o$      'management warned; the '||v_dept||' department decides an extension.', false);
$o$, $n$      'management warned; a committee manager or a commissioner decides an extension.', false);
$n$),
    (31, 'public.strip_roles_on_departure()', $o$their staff role and departments were removed with it (Rule 1.1). If the member returns, restore the role and departments under Users & roles.',
$o$, $n$their staff role was removed with it (Rule 1.1). If the member returns, restore the role under Users & roles.',
$n$),
    (32, 'public.guard_mgmt_nominee()', $o$  -- office holders can't run a club (Rule 2.7), except staff whose only department is Media
$o$, $n$  -- office holders can't run a club (Rule 2.7); v463: no Media role from Season 2, so no department is exempt
$n$),
    (33, 'public.guard_mgmt_nominee()', $o$    raise exception '% is league % and cannot hold a club management role (Rule 2.7). Media is the only exempt department.', v_name, v_role;
$o$, $n$    raise exception '% is league % and cannot hold a club management role (Rule 2.7).', v_name, v_role;
$n$),
    (34, 'public._mgmt_nominee_seat_block(uuid,text,uuid)', $o$cannot hold a club management role. No league office seat, in any department, may be held together with a club seat.', v_name, v_role),
$o$, $n$cannot hold a club management role. No league office seat may be held together with a club seat.', v_name, v_role),
$n$),
    (35, 'public.staff_vote_cast(uuid,text,text)', $o$  /* checked first, and without reference to the vote's scope $o$ || chr(8212) || $o$ Media has no ballot */
  if public.is_media_staff(me) then
    raise exception 'Media staff don''t hold a ballot on staff votes (Rule 2.7) $o$ || chr(8212) || $o$ the department reports on the league rather than deciding for it.';
  end if;
$o$, $n$  /* v463 (commissioner, 2026-10-22: "we will not have that role next season"): no Media staff from Season 2, so
     every staff member holds a ballot, and the Media check that stood here is gone (is_media_staff answers no for
     everyone since the staff powers record). */
$n$),
    (36, 'public.set_owner_app_club(uuid,text)', $o$    raise exception 'Only the Applications review board can choose the club.';
$o$, $n$    raise exception 'Only the league staff or a commissioner can choose the club.';
$n$),
    (37, 'public.decide_owner_application(uuid,boolean,text)', $o$    raise exception 'Only a commissioner decides an application alone. Reviewers cast their vote on the application instead.';
$o$, $n$    raise exception 'Only a commissioner decides an application alone. League staff cast their vote on the application instead.';
$n$),
    (38, 'public.guard_app_insert()', $o$    raise exception 'APPLICATION: A new application is filed as pending. Only the review board or the league office decides it.'
$o$, $n$    raise exception 'APPLICATION: A new application is filed as pending. Only the staff vote or a commissioner decides it.'
$n$),
    (39, 'public.override_application_decision(text,uuid,boolean)', $o$then raise exception 'Only a commissioner can override the reviewer vote.'; end if;
$o$, $n$then raise exception 'Only a commissioner can override the staff vote.'; end if;
$n$),
    (40, 'public._owner_app_autoplace(uuid)', $o$      v_who || ' was approved before the review board chose one of their three picks, so no club was assigned. ' ||
$o$, $n$      v_who || ' was approved before the league staff chose one of their three picks, so no club was assigned. ' ||
$n$)
-- <<< patch pairs
  ) as x(ord, fn, old_text, new_text) order by x.ord loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    if n <> 1 then raise exception 'v463 staff copy: anchor % in % matched % times', r.ord, r.fn, n; end if;
    execute replace(v_def, r.old_text, r.new_text);
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text) <> 1 or position(r.old_text in v_def) > 0 then
      raise exception 'v463 staff copy: patch % in % did not land once', r.ord, r.fn;
    end if;
  end loop;
end $fwd$;

-- self-checks: the words the flip makes false are gone from every message this record owns, and the functions keep
-- their security attributes (pg_get_functiondef carries them, so CREATE OR REPLACE from it keeps them)
do $chk$
declare v_f text; v_def text; v_bad text;
begin
  foreach v_f in array array['public.reverse_trade(uuid,text)', 'public.resend_trade(uuid)', 'public.guard_trade_status()',
      'public.apply_application_decision(text,uuid,boolean)', 'public.owner_remove_manager(text,text)', 'public.draft_pause(integer)',
      'public.draft_resume(integer)', 'public.draft_reset_clock(integer,integer)', 'public.draft_skip_pick(integer)',
      'public.declare_forfeit(uuid,uuid,boolean)', 'public.ops_exempt_game_limits(uuid,boolean,text)',
      'public.ops_reschedule_game(uuid,timestamptz)', 'public.ops_set_limit_week(uuid,integer,text)',
      'public.rankings_set_order(text[])', 'public.rankings_clear()', 'public.check_suspended_appearances(uuid)',
      'public.strip_roles_on_departure()', 'public.guard_mgmt_nominee()', 'public._mgmt_nominee_seat_block(uuid,text,uuid)',
      'public.staff_vote_cast(uuid,text,text)', 'public.set_owner_app_club(uuid,text)',
      'public.decide_owner_application(uuid,boolean,text)', 'public.guard_app_insert()',
      'public.override_application_decision(text,uuid,boolean)', 'public._owner_app_autoplace(uuid)'] loop
    v_def := lower(pg_get_functiondef(v_f::regprocedure));
    select string_agg(w, ', ') into v_bad
      from unnest(array['the transactions department', 'the draft department', 'the operations department',
                        'the officiating department', 'the media department', 'department decides an extension',
                        'reviewer vote', 'the reviewers approve', 'reviewers'''' approval', 'the reviewers approved',
                        'reviewers cast', 'review board can', 'review board or the league office', 'review board chose',
                        'only media may be held', 'narrow them to media', 'media is the only exempt',
                        'in any department, may be held', 'media staff don''''t hold a ballot',
                        'staff role and departments were removed', 'decide whether to extend their']) w
     where position(w in v_def) > 0;
    if v_bad is not null then raise exception 'v463 staff copy: % still says: %', v_f, v_bad; end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_f::regprocedure) then
      raise exception 'v463 staff copy: % lost SECURITY DEFINER', v_f;
    end if;
  end loop;
end $chk$;
-- Applied as migration v463c_s2_staff_copy on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
