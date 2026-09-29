-- v3.75: follow-ups from the adversarial review of v3.72 (the roster freeze and trade placement).
--   1. A club could still call up its own camp player during the freeze by waiving him and signing him back:
--      place_new_roster_spot put him on the active roster when there was room. Now a player re-signed during the
--      freeze by the club that released him in it returns to the squad he left (camp to camp).
--   2. place_new_roster_spot left called-up depth players (origin depth_random) out of the active count that
--      check_roster_structure and the trade placement include, so a signing that belonged in camp was refused
--      at commit. One count everywhere: only pre-season loans are outside it.
--   3. A trade could name the same player twice (the Trade Hub never does; the API could), which counted him as
--      an extra arrival. guard_trade_insert refuses it, and the placement de-duplicates defensively.
--   4. check_roster_structure (v3.72) skipped a deferred event whenever the row had changed since; a later
--      same-group position change is not an entering event, so an entry could go unjudged. It now skips only a
--      row no longer counted where the event put it, and judges the row's CURRENT group.
--   5. The camp notice names the full-group case in plain words.

/* ---- 1 and 2: signing placement ---------------------------------------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.place_new_roster_spot()'::regprocedure);
  d := replace(d0, 'declare cap int; n_pro int; n_tc int; n_all int; v_max int;',
                   'declare cap int; n_pro int; n_tc int; n_all int; v_max int; v_left record;');
  if d = d0 then raise exception 'place_new_roster_spot declare patch matched nothing'; end if;
  d0 := d;
  d := replace(d0,
'  if NEW.squad = ''pro'' and coalesce(current_setting(''app.mgr_sync'', true), '''') = ''1'' then return NEW; end if;',
'  if NEW.squad = ''pro'' and coalesce(current_setting(''app.mgr_sync'', true), '''') = ''1'' then return NEW; end if;
  /* v3.75: the weekly freeze is not stepped around by releasing a club''s own camp player and signing him back.
     A player signed during the freeze by the club that released him in it returns to the squad he left. The
     league office and the league''s own automation pass, as they do the freeze itself. */
  if public.roster_freeze_at() and not (public.is_commissioner() or public.trusted_writer()) then
    select r.team_id, r.squad, r.removed_at into v_left from public.roster_spot_removals r
     where r.season_id = NEW.season_id and r.profile_id = NEW.profile_id and r.reinstated_at is null
     order by r.removed_at desc limit 1;
    if v_left.team_id = NEW.team_id and v_left.squad = ''tc''
       and v_left.removed_at >= public.roster_freeze_ends_at() - interval ''52 hours 30 minutes'' then
      select count(*) into n_tc from roster_spots
        where season_id = NEW.season_id and team_id = NEW.team_id and status = ''active'' and squad = ''tc'';
      if n_tc >= public.camp_max(NEW.season_id) then
        raise exception ''Rule 2.1: he left this club''''s training camp during the roster freeze, so he returns to it, and it is full (% players). Sign him after the freeze lifts at % ET, or make room in camp.'',
          public.camp_max(NEW.season_id),
          to_char(public.roster_freeze_ends_at() at time zone ''America/New_York'', ''Dy Mon DD HH12:MI AM'')
          using errcode = ''check_violation'';
      end if;
      NEW.squad := ''tc'';
      return NEW;
    end if;
  end if;');
  if d = d0 then raise exception 'place_new_roster_spot freeze patch matched nothing'; end if;
  d0 := d;
  d := replace(d0,
'        and squad = ''pro'' and coalesce(origin,'''') not in (''preseason_random'',''latecomer_random'',''depth_random'');',
'        and squad = ''pro'' and coalesce(origin,'''') not in (''preseason_random'',''latecomer_random'');   -- v3.75: a called-up depth player counts, as in check_roster_structure');
  if d = d0 then raise exception 'place_new_roster_spot count patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- 3: a trade names each player once ------------------------------------------------------------------ */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.guard_trade_insert()'::regprocedure);
  d := replace(d0,
'  /* v3.68 (Q63): a season that sets a service minimum applies it to a trade as it does to a waiver',
'  /* v3.75: a trade names each player once, on one side. The Trade Hub never repeats a player; the API could,
     and a repeated arrival was counted as an extra player by the placement rule (Rule 2.1). */
  if new.status in (''proposed'', ''accepted'') and (
       coalesce(cardinality(new.offered_profile_ids), 0) <> (select count(distinct x) from unnest(coalesce(new.offered_profile_ids, ''{}''::uuid[])) x)
    or coalesce(cardinality(new.requested_profile_ids), 0) <> (select count(distinct x) from unnest(coalesce(new.requested_profile_ids, ''{}''::uuid[])) x)
    or exists (select 1 from unnest(coalesce(new.offered_profile_ids, ''{}''::uuid[])) o
               where o = any(coalesce(new.requested_profile_ids, ''{}''::uuid[])))) then
    raise exception ''Rule 2.3: a trade names each player once, on one side. Build the offer again.''
      using errcode = ''check_violation'';
  end if;
  /* v3.68 (Q63): a season that sets a service minimum applies it to a trade as it does to a waiver');
  if d = d0 then raise exception 'guard_trade_insert patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- 3 and 5: the placement de-duplicates, and its notice names the full-group case ------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public._place_trade_arrivals(uuid,uuid,uuid[],text[],integer)'::regprocedure);
  d := replace(d0,
'  if p_team is null or coalesce(cardinality(p_incoming), 0) = 0 then return 0; end if;',
'  if p_team is null or coalesce(cardinality(p_incoming), 0) = 0 then return 0; end if;
  /* v3.75: each player once, in the order the trade first names him */
  select array_agg(u.pid order by u.o) into p_incoming
    from (select x.pid, min(x.o) o from unnest(p_incoming) with ordinality as x(pid, o) group by x.pid) u;');
  if d = d0 then raise exception '_place_trade_arrivals dedupe patch matched nothing'; end if;
  d0 := d;
  d := replace(d0,
'''an active place for an active place and a camp place for a camp place, and an extra player joins the active roster only ''
      || ''where it and his position group have room (Rule 2.1). Call ''',
'''an active place for an active place and a camp place for a camp place. A player whose position group or the ''
      || ''15-man roster is full joins camp instead, and an extra player joins the active roster only where both have room (Rule 2.1). Call ''');
  if d = d0 then raise exception '_place_trade_arrivals notice patch matched nothing'; end if;
  execute d;
end $mig$;

/* ---- 4: the deferred shape check judges the row as it now stands ------------------------------------------- */
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.check_roster_structure()'::regprocedure);
  d := replace(d0, '        v_grp text; v_cnt int; v_cap int;',
                   '        v_grp text; v_cnt int; v_cap int; v_cur public.roster_spots;');
  if d = d0 then raise exception 'check_roster_structure declare patch matched nothing'; end if;
  d0 := d;
  d := replace(d0,
'  if not exists (select 1 from public.roster_spots cur
                  where cur.id = NEW.id and cur.squad = NEW.squad and cur.status = NEW.status
                    and cur.team_id = NEW.team_id and cur.season_id = NEW.season_id
                    and cur.position is not distinct from NEW.position
                    and coalesce(cur.origin, '''') = coalesce(NEW.origin, '''')) then
    return null;
  end if;',
'  /* v3.75: skip only a row no longer counted where this event put it (moved to camp, to another club, out of
     the season, or made a loan); a row still counted there is judged as it now stands, in its CURRENT group,
     because a later same-group change is not an entering event of its own */
  select * into v_cur from public.roster_spots where id = NEW.id;
  if not found or v_cur.squad <> ''pro'' or v_cur.status <> ''active'' or v_cur.team_id <> NEW.team_id
     or v_cur.season_id <> NEW.season_id or coalesce(v_cur.origin, '''') = any(v_loans) then
    return null;
  end if;');
  if d = d0 then raise exception 'check_roster_structure skip patch matched nothing'; end if;
  d0 := d;
  d := replace(d0, '  v_grp := public.pos_group(NEW.position);', '  v_grp := public.pos_group(v_cur.position);');
  if d = d0 then raise exception 'check_roster_structure group patch matched nothing'; end if;
  execute d;
end $mig$;

/* REHEARSAL (2026-09-29, one transaction on the live database, rolled back by a closing raise; every actor a club
   Owner, not a commissioner, except the position change in R3):
   R1 with the freeze faked on (roster_freeze_at true, roster_freeze_ends_at tomorrow): BOS waives its camp forward
      Vante and signs him back: he returns to CAMP.
   R1b the same round trip outside the freeze: he lands on the active roster (BOS forwards 6 of 7).
   R2 a trade offering the same player twice is refused at insert.
   R3 DAL (forwards 7 of 7) calls up its camp center and the office moves him to LW in the same transaction: the
      commit refuses the eighth forward (v3.72's skip let it through).
   R4 NYI (forwards 7 of 7, two of them called-up depth players) signs a waived forward: he joins CAMP (before, he
      was put on the roster and the commit refused the signing).
   R5 the camp notice names the full-group case.
   Result: REHEARSAL OK: R1 ok; R1b ok; R2 ok; R3 ok; R4 ok; R5 ok.
   The first run of R1 failed on the fake alone: faking only roster_freeze_at left roster_freeze_ends_at on the real
   Tuesday clock, so the window's start fell after the waiver. Faking both fixed the test, not the code. */
/* APPLIED 2026-09-29 through execute_sql as one transaction, not apply_migration: the migration endpoint returned a
   gateway 503 on four attempts while plain queries worked, and a check after each attempt showed nothing applied.
   So v3.75 has no row in supabase_migrations.schema_migrations; this file is its record. Afterwards all four
   functions carry their v3.75 text (place_new_roster_spot, guard_trade_insert, _place_trade_arrivals,
   check_roster_structure). */
