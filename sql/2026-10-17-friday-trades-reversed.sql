-- Ruling, 2026-10-17: every trade completed on Friday, October 16 (the day of Season 1's original movement deadline) is
-- reversed. Commissioner: "reverse all trades from the original friday trade deadline, and any trades from that day as
-- well." Ran through the established door, public.reverse_trade (players go back by the trade placement rule, Rule 2.1,
-- so a returning player with no active place joins camp), as the commissioner's own profile (zackbrown17), newest
-- first, in one transaction with a self-check. No schema change; this file is the record.
--
-- The three trades (accepted, ET):
--   b8fef62d  Fri Oct 16 11:57 PM  DET -> NYI  Big6Bad9John, LIL__Dark200 for Tager x 72
--   dbc8a605  Fri Oct 16 11:50 PM  BOS -> PIT  BORZY, KGOD7 for rteddy, pawxs, SlashNoContacts
--   3264cb51  Fri Oct 16 12:09 PM  PIT -> NYI  LB_N8DAWG_73, THERUTKING88 for Fourthgen_trucks_are_on_top, PghReaper
-- Left in place: Thursday's UTA/BOS trade (before Friday) and Saturday's VAN/UTA and UTA/DAL trades, made during the
-- extension after the original deadline. (Rehearsal: VAN/UTA could not be reversed now anyway, Utah's camp holds 10 of 10.)
--
-- REHEARSAL on production, 2026-10-17, all five candidate reversals in ONE do-block ending in an uncaught raise:
--   UTA-DAL reversed; VAN-UTA refused ("this trade would place 1 player in the Mammoth training camp, which already holds
--   10 of its 10. Nothing was traded"); DET-NYI, BOS-PIT, PIT-NYI reversed; afterwards pro/tc BOS 14/9, NYI 15/8,
--   PIT 15/7, DET 15/4 (no limit passed).
-- RESULT: all three 'reversed'; players back with the clubs that traded them (PIT: THERUTKING88, LB_N8DAWG_73 active;
--   rteddy active, pawxs and SlashNoContacts camp. NYI: Fourthgen_trucks_are_on_top, PghReaper, Tager x 72 camp.
--   BOS: KGOD7, BORZY camp. DET: Big6Bad9John active, LIL__Dark200 camp). reverse_trade posted its three lines to
--   #transactions (webhook 204), the club-room notices and the site notices, which is the reversal's own door.

do $x$
declare
  v_comm constant uuid := 'fa5f47dc-5380-4965-9258-82ed954b6fa7';
  v_reason constant text := 'Commissioner ruling: every trade completed on Friday, October 16, the day of the original deadline, is reversed. Clubs may trade again until 11:59 PM ET on Sunday (Rule 2.4).';
  v_ids constant uuid[] := array['b8fef62d-5e57-4604-98bb-7f5b96766bd4','dbc8a605-3e57-44c1-a875-1ffb35ac1774','3264cb51-fca2-4fe3-aead-eae93a353508']::uuid[];
  i int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_comm, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_comm::text, true);
  if not public.is_commissioner() then raise exception 'not acting as the commissioner'; end if;
  for i in 1 .. 3 loop
    perform public.reverse_trade(v_ids[i], v_reason);
  end loop;
  if (select count(*) from public.trades where id = any(v_ids) and status::text = 'reversed') <> 3 then
    raise exception 'self-check: not all three trades reversed';
  end if;
end $x$;
