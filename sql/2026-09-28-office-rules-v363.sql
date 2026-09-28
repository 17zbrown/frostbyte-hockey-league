-- v3.63: access settings reset with ownership; no salary retention in basic trades; the full format's
-- playoff figures are fixed.
-- Commissioner, 2026-09-28:
--   Q48 (while a club has no Owner, whose access settings hold?): "when ownership changes hands, access
--        settings reset (every manager same access)."
--   Q53 (is salary retention permitted in a basic-format trade?): "retention unused in basic."
--   Q64 (full-format qualifiers, series length and games floor: fixed figures or season settings?):
--        "full-format playoff figures fixed."
-- Q51 (salaries public), Q54, Q55 and Q57 change the book only; the system already does what they say.

/* ---- Q48: a change of Owner resets the club's access settings ------------------------------------------
   The table the last Owner set is his; it does not bind the next one, and it must not freeze a club whose
   Owner seat is empty (approval mode with no Owner to approve left every such move stuck). Deleting the
   club's policy row returns every seat and page to the default: full access everywhere, the Management
   page the Owner's alone (mgmt_default_mode). A move still queued for the old Owner's approval is
   withdrawn, since the setting that queued it is gone; the club is told. */
create or replace function public.reset_mgmt_on_owner_change()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_had boolean; v_n int;
begin
  delete from public.team_mgmt_policy where team_id = new.id returning true into v_had;
  update public.team_mgmt_moves
     set status = 'withdrawn', decided_at = now(),
         result = 'The club''s Owner changed, so its access settings reset and this move was withdrawn (Rule 2.6). Make it again if it is still wanted.'
   where team_id = new.id and status = 'pending';
  get diagnostics v_n = row_count;
  if coalesce(v_had, false) or v_n > 0 then
    perform public.club_notify(new.id, 'flag', 'Access settings reset',
      'The club''s Owner seat changed hands, so every manager''s access returns to the default: full access to every page, with the Management page the Owner''s alone (Rule 2.6).'||
      case when v_n > 0 then ' '||v_n||' move'||case when v_n = 1 then '' else 's' end||' waiting for the previous Owner''s approval '||
                             case when v_n = 1 then 'was' else 'were' end||' withdrawn; make '||case when v_n = 1 then 'it' else 'them' end||' again if still wanted.'
           else '' end,
      null, 'manager', null, null, false);
  end if;
  return new;
end $fn$;
revoke all on function public.reset_mgmt_on_owner_change() from public, anon, authenticated;
drop trigger if exists reset_mgmt_on_owner_change_trg on public.teams;
create trigger reset_mgmt_on_owner_change_trg after update of owner_profile_id on public.teams
  for each row when (old.owner_profile_id is distinct from new.owner_profile_id)
  execute function public.reset_mgmt_on_owner_change();

/* ---- Q53: no salary retention in a basic-format trade -------------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_trade_insert()'::regprocedure);
  d := replace(d0,
'    raise exception ''Rule 2.3 — draft picks are not traded in the basic season format. Trade players only.'';
  end if;',
'    raise exception ''Rule 2.3 — draft picks are not traded in the basic season format. Trade players only.'';
  end if;
  /* v3.63 (Q53): no salary is retained in a basic-format trade; a traded player''s whole salary moves with
     him. The Trade Hub never offered retention; this closes the API door accept_trade left open. */
  if public.season_is_basic(new.season_id)
     and new.retention is not null and new.retention not in (''{}''::jsonb, ''[]''::jsonb, ''null''::jsonb) then
    raise exception ''Rule 2.3: no salary is retained in a trade. A traded player''''s whole salary moves with him.''
      using errcode = ''check_violation'';
  end if;');
  if d = d0 then raise exception 'guard_trade_insert patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- Q64: the full format's playoff figures are the format's own ---------------------------------------
   Four qualifiers per division, best of seven, no games floor (Appendix A). The Control Center's
   site_config.playoff_format and a season's playoff_min_gp no longer change them in a full season; a
   basic season keeps its published floor (Rule 8.3). */
create or replace function public.playoff_per_div(p_season uuid)
 returns integer language sql stable set search_path to 'public' as $fn$
  /* v3.63 (Q64): fixed by the format in every format (Rule 8.1, Appendix A) */
  select (public.season_rules(p_season)->>'playoff_per_div')::int
$fn$;
create or replace function public.playoff_best_of(p_season uuid)
 returns integer language sql stable set search_path to 'public' as $fn$
  /* v3.63 (Q64): fixed by the format in every format (Rule 8.3, Appendix A) */
  select (public.season_rules(p_season)->>'playoff_best_of')::int
$fn$;
create or replace function public.season_rules(p_season uuid)
 returns jsonb language sql stable set search_path to 'public' as $fn$
  select public.format_rules(public.season_format(p_season))
      || coalesce((select jsonb_strip_nulls(jsonb_build_object(
                     'draft_rounds', s.draft_rounds,
                     /* v3.63 (Q64): a season's playoff floor is a basic-format setting; the full format has none */
                     'playoff_min_gp', case when public.season_format(p_season) = 'basic' then s.playoff_min_gp end))
                   from public.seasons s where s.id = p_season), '{}'::jsonb)
$fn$;

/* REHEARSAL (2026-09-28, one transaction on the live database, rolled back by a closing raise):
   Q48  NYI's policy set so its GM's Trade Hub needs approval, and a move queued. Writing the same Owner
        again changed nothing. Emptying the Owner seat deleted the policy, withdrew the queued move, left
        the GM with full access on the Trade Hub and the Management page at its default (hidden), and sent
        the front office one "Access settings reset" notice.
   Q53  As the commissioner, a PIT to SEA offer retaining 25 percent of a salary: refused, "no salary is
        retained in a trade". The same offer with an empty retention: accepted.
   Q64  Season 1 (basic): 3 per division, best of 7, floor 16, as before. Season 2 switched to full in the
        transaction with playoff_min_gp 5 and site_config perDiv 6 / bestOf 5: 4, 7 and 0.
   Result: REHEARSAL OK: Q48 reset on owner change: policy cleared, queued move withdrawn, GM full, club
   told (1 notices); no-op write ignored; Q53 retention refused, plain trade accepted; Q64 basic keeps
   3/7/16; full is 4/7/0 whatever the Control Center or the season say;
   Applied as migration v363_office_rules. */
