-- v3.76: a commissioner has full control of the club he selects in Team HQ.
-- Commissioner, 2026-10-01: "Allow commissioners full control on the team HQ when we select a team to look at."
--
-- The v2.86 preview already resolved the club and let most writes through (mgmt_access_for returns 'office' for a
-- commissioner, so mgmt_gate never stops him). What still refused him, read from the live definitions:
--   waive_player, sign_free_agent and offer_free_agent found the club from the caller's own seat (a commissioner
--   has none; one who ever held a seat elsewhere would have signed to HIS club); save_draft_board and the
--   draft_boards policy were is_gm_of only; the trades INSERT policy was is_gm_of(from_team_id) only; the
--   management_applications INSERT policy, owner_remove_manager, set_team_mgmt_policy and mgmt_decide_move were
--   the Owner's only; mgmt_withdraw_move was the requester's only.
-- Every change below adds the league office beside the club's own seat. Nothing a club could do is narrowed.

/* ---- waive_player: a commissioner acts for the player's own club ------------------------------------------ */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.waive_player(uuid)'::regprocedure);
  d := replace(d0,
'  select t.* into v_team from public.teams t
    where t.owner_profile_id = auth.uid() or t.gm_profile_id = auth.uid() or t.agm_profile_id = auth.uid()
    limit 1;
  if v_team.id is null then raise exception ''Only club management can waive players.''; end if;',
'  /* v3.76: a commissioner acts for the club the player is on (Team HQ, any club); a manager for his own seat */
  if public.is_commissioner() then
    select t.* into v_team from public.teams t join public.roster_spots rs on rs.team_id = t.id
     where rs.season_id = public.current_season_id() and rs.profile_id = p_profile
     limit 1;
    if v_team.id is null then raise exception ''That player is not on a club''''s roster this season.''; end if;
  else
    select t.* into v_team from public.teams t
      where t.owner_profile_id = auth.uid() or t.gm_profile_id = auth.uid() or t.agm_profile_id = auth.uid()
      limit 1;
    if v_team.id is null then raise exception ''Only club management can waive players.''; end if;
  end if;');
  if d = d0 then raise exception 'waive_player patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- sign_free_agent and offer_free_agent: the club is named --------------------------------------------- */
do $mig$ declare d text; d0 text; v_lookup text; v_new text; begin
  v_lookup :=
'  select t.* into v_team from public.teams t
    where t.owner_profile_id = auth.uid() or t.gm_profile_id = auth.uid() or t.agm_profile_id = auth.uid()
    limit 1;
  if v_team.id is null then raise exception ''Only club management can %s.''; end if;';
  v_new :=
'  /* v3.76: Team HQ names the club. A commissioner may name any club; a manager only his own seat''s. With no club
     named, a manager acts for his seat as before. */
  if p_team is not null then
    select t.* into v_team from public.teams t where t.id = p_team;
    if v_team.id is null then raise exception ''That club does not exist.''; end if;
    if not (public.is_commissioner() or public.is_gm_of(p_team)) then
      raise exception ''Only that club''''s management can %s for it.'';
    end if;
  else
    if public.is_commissioner() then raise exception ''Choose the club to act for.''; end if;
    select t.* into v_team from public.teams t
      where t.owner_profile_id = auth.uid() or t.gm_profile_id = auth.uid() or t.agm_profile_id = auth.uid()
      limit 1;
    if v_team.id is null then raise exception ''Only club management can %s.''; end if;
  end if;';

  d0 := pg_get_functiondef('public.sign_free_agent(uuid,bigint)'::regprocedure);
  d := replace(d0, 'public.sign_free_agent(p_registration uuid, p_salary bigint DEFAULT 750000)',
                   'public.sign_free_agent(p_registration uuid, p_salary bigint DEFAULT 750000, p_team uuid DEFAULT NULL::uuid)');
  if d = d0 then raise exception 'sign_free_agent signature patch matched nothing'; end if;
  d0 := d;
  d := replace(d0, format(v_lookup, 'sign free agents'), format(v_new, 'sign', 'sign free agents'));
  if d = d0 then raise exception 'sign_free_agent club patch matched nothing'; end if;
  drop function public.sign_free_agent(uuid, bigint);
  execute d;

  d0 := pg_get_functiondef('public.offer_free_agent(uuid,bigint,integer,text)'::regprocedure);
  d := replace(d0, 'public.offer_free_agent(p_registration uuid, p_salary bigint, p_years integer DEFAULT 1, p_note text DEFAULT NULL::text)',
                   'public.offer_free_agent(p_registration uuid, p_salary bigint, p_years integer DEFAULT 1, p_note text DEFAULT NULL::text, p_team uuid DEFAULT NULL::uuid)');
  if d = d0 then raise exception 'offer_free_agent signature patch matched nothing'; end if;
  d0 := d;
  d := replace(d0, format(v_lookup, 'offer a contract'), format(v_new, 'offer a contract', 'offer a contract'));
  if d = d0 then raise exception 'offer_free_agent club patch matched nothing'; end if;
  drop function public.offer_free_agent(uuid, bigint, integer, text);
  execute d;
end $mig$;
revoke all on function public.sign_free_agent(uuid, bigint, uuid) from public, anon;
grant execute on function public.sign_free_agent(uuid, bigint, uuid) to authenticated;
revoke all on function public.offer_free_agent(uuid, bigint, integer, text, uuid) from public, anon;
grant execute on function public.offer_free_agent(uuid, bigint, integer, text, uuid) to authenticated;

/* ---- the approval queue passes the club it was queued for ------------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public._mgmt_execute(team_mgmt_moves)'::regprocedure);
  d := replace(d0,
'perform public.offer_free_agent((a->>''p_registration'')::uuid, (a->>''p_salary'')::bigint, coalesce((a->>''p_years'')::int, 1), a->>''p_note'');',
'perform public.offer_free_agent((a->>''p_registration'')::uuid, (a->>''p_salary'')::bigint, coalesce((a->>''p_years'')::int, 1), a->>''p_note'', v.team_id);');
  if d = d0 then raise exception '_mgmt_execute offer patch matched nothing'; end if;
  d0 := d;
  d := replace(d0,
'perform public.sign_free_agent((a->>''p_registration'')::uuid, coalesce((a->>''p_salary'')::bigint, 750000));',
'perform public.sign_free_agent((a->>''p_registration'')::uuid, coalesce((a->>''p_salary'')::bigint, 750000), v.team_id);');
  if d = d0 then raise exception '_mgmt_execute sign patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- the draft board --------------------------------------------------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.save_draft_board(uuid,uuid[])'::regprocedure);
  d := replace(d0,
'  if not public.is_gm_of(p_team) then raise exception ''Only this club''''s management can edit its draft board.''; end if;',
'  if not (public.is_gm_of(p_team) or public.is_commissioner()) then   -- v3.76: the league office too
    raise exception ''Only this club''''s management can edit its draft board.'';
  end if;');
  if d = d0 then raise exception 'save_draft_board patch matched nothing'; end if;
  execute d;
end $mig$;
-- read before write: an office that could save but not read would replace a club's board with one name
drop policy if exists "office reads boards" on public.draft_boards;
create policy "office reads boards" on public.draft_boards for select using (public.is_commissioner());

/* ---- trades: a commissioner may propose for any club, stamped with his own name ------------------------- */
drop policy if exists "gm proposes own-club trade" on public.trades;
create policy "gm proposes own-club trade" on public.trades for insert
  with check ((from_profile_id = (select auth.uid())) and (public.is_gm_of(from_team_id) or public.is_commissioner()));

/* ---- management: nominate, remove, permissions, approvals ------------------------------------------------ */
drop policy if exists "mgmt app owner submits" on public.management_applications;
create policy "mgmt app owner submits" on public.management_applications for insert
  with check ((submitted_by = auth.uid()) and (public.is_commissioner() or exists (select 1 from public.teams t
    where t.id = management_applications.team_id and t.owner_profile_id = auth.uid())));

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.owner_remove_manager(text,text)'::regprocedure);
  d := replace(d0,
'  if v_owner is null or v_owner <> auth.uid() then
    raise exception ''Only the club''''s Owner can remove its management (Rule 2.6).'';
  end if;',
'  if (v_owner is null or v_owner <> auth.uid()) and not public.is_commissioner() then   -- v3.76: or the league office
    raise exception ''Only the club''''s Owner can remove its management (Rule 2.6).'';
  end if;');
  if d = d0 then raise exception 'owner_remove_manager check patch matched nothing'; end if;
  d0 := d;
  d := replace(d0, '  perform public._set_team_seat(v_team, p_role, null, ''owner'');',
                   '  perform public._set_team_seat(v_team, p_role, null, case when v_owner = auth.uid() then ''owner'' else ''office'' end);');
  if d = d0 then raise exception 'owner_remove_manager by patch matched nothing'; end if;
  d0 := d;
  -- the notice names whoever acted: the Owner, or the commissioner acting for the club
  d := replace(d0, 'into v_owner_name from public.profiles where id = v_owner;', 'into v_owner_name from public.profiles where id = auth.uid();');
  if d = d0 then raise exception 'owner_remove_manager actor patch matched nothing'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.set_team_mgmt_policy(text,jsonb)'::regprocedure);
  d := replace(d0,
'  if v_owner is null or v_owner <> auth.uid() then raise exception ''Only the club''''s Owner sets management permissions (Rule 2.6).''; end if;',
'  if (v_owner is null or v_owner <> auth.uid()) and not public.is_commissioner() then   -- v3.76: or the league office
    raise exception ''Only the club''''s Owner sets management permissions (Rule 2.6).'';
  end if;');
  if d = d0 then raise exception 'set_team_mgmt_policy patch matched nothing'; end if;
  d0 := d;
  d := replace(d0, '''The '' || v_club || '' Owner updated what your seat can do',
                   '''The '' || v_club || case when v_owner = auth.uid() then '' Owner'' else '' league office'' end || '' updated what your seat can do');
  if d = d0 then raise exception 'set_team_mgmt_policy notice patch matched nothing'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.mgmt_decide_move(uuid,boolean,text)'::regprocedure);
  d := replace(d0,
'  if v_owner is null or v_owner <> auth.uid() then raise exception ''Only the club''''s Owner decides its managers'''' moves (Rule 2.6).''; end if;',
'  if (v_owner is null or v_owner <> auth.uid()) and not public.is_commissioner() then   -- v3.76: or the league office
    raise exception ''Only the club''''s Owner decides its managers'''' moves (Rule 2.6).'';
  end if;');
  if d = d0 then raise exception 'mgmt_decide_move check patch matched nothing'; end if;
  d0 := d;
  d := replace(d0, '''The Owner did not approve this move''',
                   '''The '' || case when v_owner = auth.uid() then ''Owner'' else ''league office'' end || '' did not approve this move''');
  d := replace(d, '''The Owner approved your move and it has been made.''',
                  '''The '' || case when v_owner = auth.uid() then ''Owner'' else ''league office'' end || '' approved your move and it has been made.''');
  d := replace(d, '''The Owner approved this move, but it failed when it ran: ''',
                  '''The '' || case when v_owner = auth.uid() then ''Owner'' else ''league office'' end || '' approved this move, but it failed when it ran: ''');
  if d = d0 then raise exception 'mgmt_decide_move wording patch matched nothing'; end if;
  execute d;
end $mig$;

do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.mgmt_withdraw_move(uuid)'::regprocedure);
  d := replace(d0,
'  if v.requested_by <> auth.uid() then raise exception ''Only the manager who sent this move can withdraw it.''; end if;',
'  if v.requested_by <> auth.uid() and not public.is_commissioner() then   -- v3.76: or the league office
    raise exception ''Only the manager who sent this move can withdraw it.'';
  end if;');
  if d = d0 then raise exception 'mgmt_withdraw_move patch matched nothing'; end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-10-01, one transaction on the live database, rolled back by a closing raise). The actor was a
   commissioner holding no seat (zackbrown17); RLS cases ran under SET LOCAL ROLE authenticated:
   W1 he waives a BOS camp player for BOS (the club comes from the player's spot) and the waiver is logged.
   S1 he signs a waived player to BOS by naming it; with no club named he is asked for one.
   S2 the BOS Owner may not name DAL; S3 the BOS Owner naming no club still signs for BOS.
   D1 he saves BOS's draft board and reads it back under RLS.
   T1 he proposes a BOS to DAL trade under RLS, stamped with his own name; T2 the BOS Owner still may not propose
      for DAL.
   M1 he removes DAL's GM and sets DAL's permissions. M2 he approves a GM's queued move (it runs) and withdraws
      another. M3 another club's Owner still may not decide DAL's moves.
   G  the new sign/offer signatures are authenticated-only, and no old overload survives.
   The first run stopped at S1 only because the chosen free agent had been signed by a club that morning; the
   rehearsal now picks a current one. Result: REHEARSAL OK: W1 S1 S2 S3 D1 T1 T2 M1 M2 M3 G.
   Applied as migration v376_commissioner_team_hq; tools/sql/grant-audit.sql returned zero rows. */
