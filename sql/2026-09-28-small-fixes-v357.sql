-- v3.57: a bundle of rulings and audit fixes that are each small.
--   #7  (audit, security): either club could rewrite a trade's status directly. Row-level security lets
--       an Owner, GM or AGM of either club update a trade row, and nothing checked the transition, so a
--       seat could mark an offer accepted without a player moving, revive a declined offer, or relabel a
--       completed trade. Now: declined only by the receiving club, cancelled only by the proposing club,
--       accepted only through accept_trade, reversed only through reverse_trade, nothing out of accepted
--       (except that reversal), declined, cancelled or reversed.
--   Q36 (commissioner, 2026-09-28): a trade may be reversed after the deadline by a commissioner AND the
--       transactions department ("yes both"). The deadline guard refused the department.
--   Q25 (commissioner): "Away's preferred." When the Away club vetoes the Home club's only choice, the
--       Away club's preferred server is tried before the standard server.
--   Q35 (commissioner): playoff streaming "is not [required] but recommended in case you need to catch
--       something illegal." The playoffs announcement said it was required.

/* ---- #7 trade status transitions ---------------------------------------------------------------- */
create or replace function public.guard_trade_status()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_op text := coalesce(current_setting('app.trade_op', true), '');
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status = 'proposed' and new.status = 'declined'
     and (public.is_gm_of(old.to_team_id) or public.is_commissioner() or public.trusted_writer()) then return new; end if;
  if old.status = 'proposed' and new.status = 'cancelled'
     and (public.is_gm_of(old.from_team_id) or public.is_commissioner() or public.trusted_writer()) then return new; end if;
  if old.status = 'proposed' and new.status = 'accepted' and v_op = 'accept' then return new; end if;
  if old.status = 'accepted' and new.status = 'reversed' and v_op = 'reverse' then return new; end if;
  raise exception 'Rule 2.3: a trade goes from % to % only through the Trade Hub''s own actions. An offer is declined by the club that received it, withdrawn by the club that made it, accepted in the Trade Hub, and reversed by the transactions department.',
    old.status, new.status using errcode = '42501';
end $fn$;
revoke all on function public.guard_trade_status() from public, anon, authenticated;
drop trigger if exists guard_trade_status_trg on public.trades;
create trigger guard_trade_status_trg before update of status on public.trades
  for each row execute function public.guard_trade_status();

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.accept_trade(uuid)'::regprocedure);
  d := replace(d0,
'  update public.trades set status = ''accepted'', updated_at = now() where id = p_trade;',
'  /* v3.57: the one door into accepted (guard_trade_status) */
  perform set_config(''app.trade_op'', ''accept'', true);
  update public.trades set status = ''accepted'', updated_at = now() where id = p_trade;
  perform set_config(''app.trade_op'', '''', true);');
  if d = d0 then raise exception 'accept_trade patch matched nothing'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.reverse_trade(uuid,text)'::regprocedure);
  d := replace(d0,
'  update public.trades set status = ''reversed'', updated_at = now() where id = p_trade;',
'  /* v3.57: the one door into reversed (guard_trade_status) */
  perform set_config(''app.trade_op'', ''reverse'', true);
  update public.trades set status = ''reversed'', updated_at = now() where id = p_trade;
  perform set_config(''app.trade_op'', '''', true);');
  if d = d0 then raise exception 'reverse_trade patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- Q36 a reversal after the deadline, by the department too ---------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_trade_insert()'::regprocedure);
  d := replace(d0,
'  if public.moves_locked(new.season_id) and not public.is_commissioner() then',
'  /* v3.57 (Q36): the transactions department may reverse a trade after the deadline too; a reversal
     is a ruling on a completed trade, not a new move */
  if public.moves_locked(new.season_id) and not public.is_commissioner()
     and not (tg_op = ''UPDATE'' and new.status = ''reversed'' and coalesce(current_setting(''app.trade_op'', true), '''') = ''reverse''
              and public.has_department(''transactions'')) then');
  if d = d0 then raise exception 'guard_trade_insert patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- Q25 Away's preferred server before the standard one ------------------------------------------ */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.resolve_game_server(uuid)'::regprocedure);
  d := replace(d0,
'  if v_p1 is not null then                                          -- home submitted
    if v_veto is distinct from v_p1 then v_res := v_p1;             -- veto misses -> 1st
    else v_res := v_p2; end if;                                     -- veto hits 1st -> 2nd
  elsif v_apref is not null and v_apref is distinct from v_veto then -- home no-show -> away''s preferred (never their own veto)
    v_res := v_apref;
  end if;',
'  if v_p1 is not null then                                          -- home submitted
    if v_veto is distinct from v_p1 then v_res := v_p1;             -- veto misses -> 1st
    elsif v_p2 is distinct from v_veto then v_res := v_p2; end if;  -- veto hits 1st -> 2nd (null if none)
  end if;
  /* v3.57 (Q25, commissioner: "Away''s preferred"): whenever the Home club''s picks settle nothing, named
     nothing, or had their only choice vetoed, the Away club''s preferred server comes before the
     standard one, never its own veto */
  if v_res is null and v_apref is not null and v_apref is distinct from v_veto then
    v_res := v_apref;
  end if;');
  if d = d0 then raise exception 'resolve_game_server patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- Q35 playoff streaming is recommended, not required ------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.announce_lifecycle()'::regprocedure);
  d := replace(d0,
'Brackets and clinches are live on the standings page — streaming is required for playoff games.',
'Brackets and clinches are live on the standings page. Streaming is not required, but a stream of every playoff game is recommended: it is the best evidence if anything needs checking.');
  if d = d0 then raise exception 'announce_lifecycle patch matched nothing'; end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-09-28, rolled back): every check passed.
   T1  a DET Owner's direct update of his own offer to 'accepted' is refused ("Rule 2.3: a trade goes
       from proposed to accepted only ..."), and so is his declining his own offer.
   T2  he withdraws it ('cancelled').
   T3  UTA's Owner (the receiver) cannot withdraw DET's offer, and declines it.
   T4  a declined offer cannot be revived to 'proposed'.
   T5  accept_trade accepts; DET's Owner cannot relabel the accepted trade.
   T6  with moves locked, a transactions staffer reverses it (Q36).
   T7  Home picks NA West only, Away vetoes NA West and prefers NA Southeast: NA Southeast (Q25).
       With the veto elsewhere, Home's NA West stands. With everything named vetoed, NA Central.
   T8  the playoffs announcement no longer says streaming is required. */
