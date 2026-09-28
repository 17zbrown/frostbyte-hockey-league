-- v3.58: training camp holds up to ten. Commissioner, 2026-09-28, after v3.55 set eight: "Actually make
-- 10 the training camp max." One token of the basic format's literal (camp_max 8 -> 10); every door into
-- camp already reads camp_max() (guard_squad_move, place_new_roster_spot, sign_free_agent,
-- _assign_reg_random, _overflow_to_camp). PIT carried 10 when the limit came in, so no club is over it.
-- The table in force is recorded in sql/2026-09-15-season-format.sql.
do $mig$ declare d text; d0 text; begin
  d0 := pg_get_functiondef('public.format_rules(text)'::regprocedure);
  d := replace(d0, '"camp_max":8', '"camp_max":10');
  if d = d0 then raise exception 'format_rules: basic camp_max 8 not found'; end if;
  if (length(d0) - length(replace(d0, '"camp_max":8', ''))) / length('"camp_max":8') <> 1 then raise exception 'format_rules: more than one camp_max 8'; end if;
  execute d;
end $mig$;
-- Verified after applying: camp_max(Season 1) = 10.
