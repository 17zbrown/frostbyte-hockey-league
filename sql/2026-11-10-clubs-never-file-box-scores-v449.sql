-- v4.49 (2026-11-10): a club no longer brings in its own box scores.
--
-- Commissioner, 2026-11-10: "Do not allow teams to bring in their own box scores. They should be automatic or dealt
-- with by staff."
--
-- WHAT CHANGES HERE: the Team HQ "Game stats" desk (2026-08-04) let a club's Owner, GM or AGM attach a sitting to their
-- own fixture through netlify/functions/ingest-stats.js. That door is closed in the function (authForGame is staff and
-- commissioners only) and the page is gone from Team HQ. Its page key, 'gamestats', leaves the management permission
-- list, so an Owner no longer sees a "Game stats" access row for a GM or AGM, and the two functions that special-cased
-- it stop naming it. Saved Owner policies lose their stale 'gamestats' entry.
--
-- Nothing else moves: box scores still import from EA (the VM poller), and statistics staff and commissioners still
-- work any game from the Stats manager.

create or replace function public.mgmt_pages()
returns text[] language sql immutable
as $function$
  /* v4.49: 'gamestats' left with the club game stats desk (clubs never file box scores) */
  select array['roster','lines','schedule','tradehub','freeagents','draft','management']
$function$;

-- The two functions that kept 'gamestats' beside 'management' as "never approve". Anchored on the full exact string,
-- exactly once each.
do $patch$
declare d text; a text;
begin
  d := pg_get_functiondef('public.mgmt_access_for(uuid,uuid,text)'::regprocedure);
  a := $a$if p_page in ('management','gamestats') and v_mode = 'approve' then v_mode := 'full'; end if;$a$;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'mgmt_access_for anchor is not unique'; end if;
  execute replace(d, a, $b$if p_page = 'management' and v_mode = 'approve' then v_mode := 'full'; end if;$b$);

  d := pg_get_functiondef('public.set_team_mgmt_policy(text,jsonb)'::regprocedure);
  a := $a$if v_page in ('management','gamestats') and v_mode = 'approve' then v_mode := 'full'; end if;$a$;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'set_team_mgmt_policy anchor is not unique'; end if;
  execute replace(d, a, $b$if v_page = 'management' and v_mode = 'approve' then v_mode := 'full'; end if;$b$);
end $patch$;

-- Stale entries in saved policies (a GM or AGM row the Owner set while the desk existed). Qualified WHERE.
update public.team_mgmt_policy
   set policy = policy #- '{gm,gamestats}' #- '{agm,gamestats}'
 where policy #> '{gm,gamestats}' is not null or policy #> '{agm,gamestats}' is not null;

-- Self-checks: anything wrong raises and the whole migration rolls back.
do $chk$
declare v_n int;
begin
  if 'gamestats' = any(public.mgmt_pages()) then raise exception 'gamestats is still a management page'; end if;
  if array_length(public.mgmt_pages(), 1) <> 7 then raise exception 'mgmt_pages has % entries, want 7', array_length(public.mgmt_pages(), 1); end if;
  if position('gamestats' in pg_get_functiondef('public.mgmt_access_for(uuid,uuid,text)'::regprocedure)) > 0
     or position('gamestats' in pg_get_functiondef('public.set_team_mgmt_policy(text,jsonb)'::regprocedure)) > 0 then
    raise exception 'a function still names gamestats';
  end if;
  select count(*) into v_n from public.team_mgmt_policy where policy #> '{gm,gamestats}' is not null or policy #> '{agm,gamestats}' is not null;
  if v_n > 0 then raise exception '% saved policies still carry gamestats', v_n; end if;
end $chk$;

/* REHEARSAL (2026-11-10, one transaction on the live database, rolled back by a closing raise): both anchors matched
   exactly once; 0 of 4 saved Owner policies carried a 'gamestats' entry, so the UPDATE touched nothing; mgmt_pages came
   out {roster,lines,schedule,tradehub,freeagents,draft,management}; self-checks passed; no http request queued (nothing
   leaves for Discord). Afterward, the live mgmt_pages still held 'gamestats' (the rollback held). Result: REHEARSAL OK.
   Applied as migration v449_clubs_never_file_box_scores; its self-checks passed and tools/sql/grant-audit.sql returned zero rows. */
