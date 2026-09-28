-- v3.62: the draft rules. Every basic-format order is drawn at random; a skipped pick goes empty; a
-- placement never carries a club over the cap.
-- Commissioner, 2026-09-28:
--   Q43 (how is the Season 2 draft order set?): "Season 2 draft: fully random (no keepers between seasons)."
--   Q44 (skipped picks and the draft's end): "a skipped pick goes empty; the club gets one random extra
--        player per missed pick at the end (no make-up picks)."
--   Q49 (a placement that would carry the drawn club over the cap): "redraw."
-- "No keepers between seasons" is already so: start_next_season closes every player deal in the basic
-- format (Rule 2.5). The draft already concludes itself when no pick is left on the clock, which Q44 keeps.

/* ---- Q43: a basic-format order is random, never from standings --------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.generate_draft_board(integer,integer,text,uuid[])'::regprocedure);
  d := replace(d0,
'    raise exception ''Unknown order style: %'', p_style;
  end if;',
'    raise exception ''Unknown order style: %'', p_style;
  end if;
  /* v3.62 (Q43): every basic-format order is drawn at random and bears no relation to the previous
     season (Rule 2.8). The standings styles are refused; a manual order stays for the rare case the
     league office rules one is required. */
  if v_fmt = ''basic'' and p_style in (''reverse_standings'',''lottery'',''nhl_lottery'') then
    raise exception ''Rule 2.8: every draft order is drawn at random, with no reference to standings or to the previous season. Build the board with Pure random.''
      using errcode = ''check_violation'';
  end if;');
  d := replace(d,
'    if v_prev_meta is null or jsonb_typeof(v_prev_meta->''order'') <> ''array'' then
      raise exception ''No drawn order to keep for season % — build the board with a real order style first.'', p_season_number;
    end if;',
'    if v_prev_meta is null or jsonb_typeof(v_prev_meta->''order'') <> ''array'' then
      raise exception ''No drawn order to keep for season % — build the board with a real order style first.'', p_season_number;
    end if;
    /* v3.62 (Q43): keeping an order is keeping a random one */
    if v_fmt = ''basic'' and coalesce(v_prev_meta->>''fallback'', v_prev_meta->>''style'') in (''reverse_standings'',''lottery'',''nhl_lottery'') then
      raise exception ''Rule 2.8: the order drawn for season % came from standings, and every draft order is random. Draw a fresh order with Pure random.'', p_season_number
        using errcode = ''check_violation'';
    end if;');
  if (length(d) - length(d0)) < 600 or position('v3.62 (Q43): keeping' in d) = 0 then
    raise exception 'generate_draft_board patch did not land in full';
  end if;
  execute d;
end $mig$;

/* ---- Q44: a skipped pick goes empty ------------------------------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.draft_make_pick(uuid,uuid)'::regprocedure);
  d := replace(d0,
'  elsif not coalesce(v_pick.skipped,false) then
    raise exception ''That club is not on the clock.'';
  end if;',
'  elsif coalesce(v_pick.skipped,false) then
    /* v3.62 (Q44): no make-up picks. A skipped pick is replaced after the draft by one random player
       (_place_for_unused_picks), and nobody, the office included, makes it later. */
    raise exception ''Rule 2.8: a skipped pick goes empty and cannot be made up. The club receives one player at random for it once the draft is over.''
      using errcode = ''check_violation'';
  else
    raise exception ''That club is not on the clock.'';
  end if;');
  d := replace(d, '(R''||v_pick.round||
      case when v_is_current then '''' else '', make-up pick'' end||'')'')', '(R''||v_pick.round||'')'')');
  if position('v3.62 (Q44)' in d) = 0 or position('else '', make-up pick''' in d) > 0 then
    raise exception 'draft_make_pick patch did not land in full';
  end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.use_draft_pick(uuid,uuid,integer)'::regprocedure);
  d := replace(d0,
'  if not found or v_pick.used then raise exception ''That pick is not available.''; end if;',
'  if not found or v_pick.used then raise exception ''That pick is not available.''; end if;
  /* v3.62 (Q44): the office''s own tool follows the same rule */
  if coalesce(v_pick.skipped,false) then
    raise exception ''Rule 2.8: a skipped pick goes empty and cannot be made up.'' using errcode = ''check_violation'';
  end if;');
  if d = d0 then raise exception 'use_draft_pick patch matched nothing'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public._draft_auto_advance(integer)'::regprocedure);
  d := replace(d0,
'the pick is skipped. If it is still unused when the draft concludes, one player is placed on the club at random (Rule 2.8).',
'the pick goes empty. The club receives one player at random for it once the draft is over (Rule 2.8).');
  d := replace(d,
'     board or best available. The club may still use the pick before the draft concludes; a pick still
     unused at conclusion is replaced by one player placed at random after the draft (Rule 2.8). */',
'     board or best available. v3.62 (Q44): the pick goes empty, with no make-up, and is replaced by one
     player placed at random after the draft (Rule 2.8). */');
  if position('the pick goes empty' in d) = 0 or position('v3.62 (Q44)' in d) = 0 then
    raise exception '_draft_auto_advance patch did not land in full';
  end if;
  execute d;
end $mig$;

/* ---- Q49: a club without cap room is not drawn -------------------------------------------------------- */
create or replace function public.cap_has_room(p_season uuid, p_team uuid, p_salary bigint)
 returns boolean language sql stable security definer set search_path to 'public' as $fn$
  /* the payroll the cap guard counts (team_cap_used), plus the incoming salary, within the season's cap */
  select public.team_cap_used(p_season, p_team) + coalesce(p_salary, 0)
         <= coalesce((select salary_cap from public.seasons where id = p_season), 9223372036854775807);
$fn$;
revoke all on function public.cap_has_room(uuid, uuid, bigint) from public, anon, authenticated;

do $mig$ declare d text; d0 text; v_n int; begin
  d0 := pg_get_functiondef('public._assign_reg_random(uuid,text,boolean,text)'::regprocedure);
  v_n := (length(d0) - length(replace(d0, 'from public.teams t', ''))) / length('from public.teams t');
  if v_n <> 5 then raise exception '_assign_reg_random: expected 5 club draws, found %', v_n; end if;
  /* v3.62 (Q49): every draw is made from the clubs with cap room for the league minimum ($750,000, which
     apply_contract_on_roster gives every placement), so a placement that would breach the cap is redrawn
     onto another club rather than failing. No club with room leaves him unplaced, and the callers
     report that. */
  d := replace(d0, 'from public.teams t',
    'from (select * from public.teams tt where public.cap_has_room(v_reg.season_id, tt.id, 750000)) t');
  d := replace(d, '  v_basic  boolean;
begin', '  v_basic  boolean;
  /* v3.62 (Q49): each club draw below reads only clubs with cap room for the league minimum */
begin');
  if position('v3.62 (Q49)' in d) = 0 then raise exception '_assign_reg_random: note did not land'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public._place_for_unused_picks(uuid,integer)'::regprocedure);
  d := replace(d0,
'declare v_team record; v_owed int; v_have int; v_i int; v_reg record; v_n int := 0; v_jersey int; v_tag text; v_pname text;',
'declare v_team record; v_owed int; v_have int; v_i int; v_reg record; v_n int := 0; v_jersey int; v_tag text; v_pname text;
        v_capped text[] := ''{}''; v_last text;');
  d := replace(d,
'    while v_i < v_owed - v_have loop
',
'    while v_i < v_owed - v_have loop
      /* v3.62 (Q49): a club with no cap room for the league minimum is not given a player it cannot pay;
         the player stays in the pool and the depth pass draws him to a club that can. One such club no
         longer aborts the whole run (before, its over-cap insert failed every sweep). */
      if not public.cap_has_room(p_season, v_team.id, 750000) then
        v_capped := array_append(v_capped, v_team.code);
        exit;
      end if;
');
  d := replace(d,
'  return v_n;
end',
'  select value into v_last from public.app_config where key = ''rl_unused-pick-cap'';
  if coalesce(array_length(v_capped,1),0) > 0 and v_last is distinct from array_to_string(v_capped, '','') then
    perform public.notify_commissioners(null, ''flag'', ''Unused draft picks not replaced: no cap room'',
      array_to_string(v_capped, '', '')||'' could not receive a player for a draft pick it did not use, because a league-minimum salary would carry it over the cap (Rule 2.8). Those players are placed on other clubs instead.'',
      ''preseason'', null);
  end if;
  insert into public.app_config (key, value) values (''rl_unused-pick-cap'', array_to_string(v_capped, '',''))
    on conflict (key) do update set value = excluded.value;
  return v_n;
end');
  if position('v3.62 (Q49)' in d) = 0 or position('rl_unused-pick-cap' in d) = 0 or position('v_capped text[]' in d) = 0 then
    raise exception '_place_for_unused_picks patch did not land in full';
  end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.trg_autoassign_new_reg()'::regprocedure);
  d := replace(d0,
'    perform public._assign_reg_random(new.id, ''latecomer_random'', false, ''fill'');
  end if;',
'    /* v3.62 (Q49): a placement failure never blocks the sign-up itself; the office is told and the
       late-comer sweep draws again */
    begin
      perform public._assign_reg_random(new.id, ''latecomer_random'', false, ''fill'');
    exception when others then
      perform public.notify_commissioners(null, ''flag'', ''Late sign-up not placed'',
        ''A late registrant for Season ''||v_season.number||'' could not be placed on a club: ''||sqlerrm||''. The late-comer sweep will draw again; place him from Draft & placement if it cannot.'',
        ''preseason'', null);
    end;
  end if;');
  if d = d0 then raise exception 'trg_autoassign_new_reg patch matched nothing'; end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-09-28, one transaction on the live database, rolled back by a closing raise; claims set
   to the commissioner):
   Q43  generate_draft_board(2, 12, 'nhl_lottery') and 'reverse_standings': refused, "every draft order is
        drawn at random". 'random': a 96-pick board (8 clubs, 12 rounds). 'as_drawn' on it: kept. With the
        stored style forced to nhl_lottery, 'as_drawn': refused, "came from standings".
   Q44  Season 2 draft live, pick 1 skipped, pick 2 on the clock: draft_make_pick(pick 1) and the office's
        use_draft_pick(pick 1) both refused, "a skipped pick goes empty". With pick 2's clock expired,
        _draft_auto_advance skipped it, logged "the pick goes empty. The club receives one player at random
        for it once the draft is over (Rule 2.8).", and put pick 3 on the clock.
   Q49  Season 1's cap lowered to $29.75M in the transaction, so only NYI ($29.0M payroll) had room for a
        league-minimum salary: a late registrant was drawn to NYI. At $29.5M no club had room: he was left
        unplaced, with no error. One of DET's used picks marked unused with DET over the cap:
        _place_for_unused_picks returned 0 without aborting, recorded DET, and told the commissioners.
   Result: REHEARSAL OK: Q43 standings styles refused; random board + keep order ok; keeping a standings
   order refused; Q44 make-up refused (desk and office tool); expired clock goes empty and moves on; Q49
   redraw: only the club with room (NYI) drawn; no club with room: unplaced, no error; unused pick with no
   cap room: skipped, office told, run not aborted;
   Applied as migration v362_draft_rules. */
