-- v463 REVERSE (DRAFT, 2026-11-24): undoes sql/2026-11-24-s2-staff-copy-v463.sql if the flip is rolled back (PLAN
-- section 8: restore the deploy, git revert, then the reverse migrations in the opposite order of the apply: this one
-- first, then the all-staff voting reverse, then the staff powers reverse, which refuses to run while this record stands).
-- The words come back exactly as they were on 2026-11-24 (the departments, the reviewers, the review board, the Media
-- exemption), because the powers they describe come back with the other two reverses: the forward record's pairs, byte
-- for byte, undone by exact anchor, last first (each new text asserted to stand once, and the old one to stand once
-- after), so a later change to another part of the same function survives the reverse. Apply as migration
-- v463_s2_staff_copy_reverse. Rehearsed inside sql/2026-11-24-s2-staff-copy-v463.rehearsal.sql.

do $pre$
begin
  if position('the Draft and Bidding manager.' in pg_get_functiondef('public.draft_pause(integer)'::regprocedure)) = 0 then
    raise exception 'v463 staff copy reverse: the staff copy is not applied, so there is nothing to reverse';
  end if;
end $pre$;

do $rev$
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
  ) as x(ord, fn, old_text, new_text) order by x.ord desc loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.new_text, ''))) / length(r.new_text);
    if n <> 1 then raise exception 'v463 staff copy reverse: patch % in % stands % times', r.ord, r.fn, n; end if;
    execute replace(v_def, r.new_text, r.old_text);
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text) <> 1 or position(r.new_text in v_def) > 0 then
      raise exception 'v463 staff copy reverse: anchor % in % did not come back once', r.ord, r.fn;
    end if;
  end loop;
end $rev$;

do $chk$
begin
  if position('the Draft and Bidding manager.' in pg_get_functiondef('public.draft_pause(integer)'::regprocedure)) > 0
     or position('the transactions department or a commissioner can reverse a trade' in pg_get_functiondef('public.reverse_trade(uuid,text)'::regprocedure)) = 0 then
    raise exception 'v463 staff copy reverse: the 2026-11-24 words did not come back';
  end if;
end $chk$;
