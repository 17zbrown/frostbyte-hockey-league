-- Commissioner, 2026-10-02: "Promote CerealTiger to owner of the Penguins and disregard the roster size limit as he will
-- solve that upon his entry to the owner seat."
-- CerealTiger (82dee5da, member, registered RD, no roster spot since the league office removed him at 02:47 UTC) takes
-- the vacant Penguins Owner seat. Seating him puts him on the active roster in his group (Rule 2.6), and the Penguins'
-- defense was full (5 of 5, camp 10 of 10), so the appointment would have been refused at commit by
-- check_roster_structure (D 6 > 5). The commissioner set that limit aside for this appointment only: the shape trigger is
-- switched off for the one statement that seats him and switched back on before commit, so it never sees his row. Every
-- other check still runs: _assign_team_role (seat vacant, one person one seat), ensure_manager_rostered (cap, contract,
-- roster spot), and the seat triggers (Discord role, #management-moves, the club's access reset). The Penguins are then
-- 7 F / 6 D / 2 G; check_roster_structure judges only rows that ENTER a group, so every move that brings the defense back
-- to five is open to him, and no further defenseman can be added meanwhile. Rule 2.6 records the power.

do $o$
declare v_pit uuid := '5b29b629-565a-4e7d-b2b8-cdbb267e23c4'; v_ct uuid := '82dee5da-1332-4873-8161-14b82ada3601';
begin
  if (select owner_profile_id from public.teams where id = v_pit) is not null then
    raise exception 'the Penguins'' Owner seat is not vacant'; end if;
  execute 'alter table public.roster_spots disable trigger check_roster_structure_trg';
  perform public._assign_team_role(v_pit, 'owner', v_ct);
  execute 'alter table public.roster_spots enable trigger check_roster_structure_trg';
  perform public.log_admin_action('owner_appointed', 'team', v_pit::text,
    jsonb_build_object('owner', v_ct, 'gamertag', 'CerealTiger', 'roster_limit', 'set aside by the commissioner for this appointment (defense 6 of 5); the Owner brings it back within the limit',
      'ruling', 'commissioner 2026-10-02'));
end $o$;

/* REHEARSED in one rolled-back transaction, with SET CONSTRAINTS ALL IMMEDIATE so every deferred check ran as at commit:
   "owner CerealTiger, spot pro RD $0 #3 active, contract $0 manager t active, PIT active D now 6, shape check enabled=O".
   APPLIED 2026-10-02 as migration cerealtiger_pit_owner. Afterwards: Owner CerealTiger, GM HungryXCIX, AGM AC; the
   Penguins 7 F / 6 D / 2 G with camp 10; check_roster_structure_trg enabled. */
