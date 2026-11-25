-- Rehearsal for sql/2026-11-24-market-owner-words-v463.sql. The main session runs it on production as ONE execute_sql
-- call: one transaction that ends in an uncaught raise, so everything rolls back (CLAUDE.md, Database change protocol
-- step 2). Agents never run it. It carries the record's text byte for byte between the markers
-- (tools/market-owner-words-v463.test.cjs pins it). Nothing here posts: the seating below fires the usual seat triggers,
-- and pg_net and every row they write roll back with the rest.
--
-- The world, inside the transaction, from real rows (no names are written here): the first club by code gets a Season 2
-- sign-up who holds no seat as its GM (the ordinary teams update), and that club's management policy is set so the GM's
-- Free agents moves need the Owner's approval and its Lineup builder is hidden.
-- Cases:
--   R1 the approving GM meets the market's words (42501, hint owner_approves), never the queue's MGMT_APPROVAL_REQUIRED.
--   R2 a hidden page is still mgmt_gate's own answer ("The Owner has not given your seat access to Lineup builder.").
--   R3 with Free agents set to full, the GM passes the gate (and stops at the draft check, or gets the season back).
--   R4 a commissioner passes the gate the same way.
--   R5 the Owner-approved execution for this club (app.mgmt_approved) passes, as mgmt_gate lets it.
--   R6 the doors still answer first in their own words: market_claim (owner_claims), market_bid (owner_bids),
--      market_pool_request (owner_requests).
--   R7 mgmt_gate is untouched: a queueable move (Roster, approve) still raises MGMT_APPROVAL_REQUIRED, so waivers, trades
--      and lineups still go to the Owner's queue.

begin;

-- >>> record text: sql/2026-11-24-market-owner-words-v463.sql
-- v463 (2026-11-24, drafted by stream b4 of the Season 2 swap; the main session numbers, rehearses and applies it): a
-- Season 2 market move never tells a seat to "send this move to the Owner".
--
-- Why. public._market_ctx, the checks every Season 2 market door makes (market_claim, market_bid, market_pool_request,
-- market_pool_withdraw), calls public.mgmt_gate(p_team, p_page). For a seat whose Owner approves that page's moves the
-- gate raises a message that begins MGMT_APPROVAL_REQUIRED and ends "send this move to the Owner instead." A market move
-- cannot wait in the Owner's approval queue: the first waiver claim wins at once, a live bid cannot wait, and a pool
-- request waits on the player (each door says so in its own words, sql v4.58 and v4.59, and each checks
-- public.mgmt_access(...) = 'approve' before it calls _market_ctx). So the gate's sentence is reached only when a seat's
-- access changes between those two statements, but when it is, it is wrong twice: it tells the seat to send a move the
-- queue has no door for, and its MGMT_APPROVAL_REQUIRED prefix is what the new site's write door (src/s2/js/live.js,
-- viaOwner) reads as "queue this move for the Owner". Stream f's hand-over (2026-11-24): "market claims and bids cannot be
-- queued for the Owner, but _market_ctx raises the same send-to-the-Owner wording (misleading)".
--
-- What changes. _market_ctx, patched by exact anchor (asserted to match once, and the new body proved to differ from the
-- old one by this block only), answers an approving seat itself, in the market's words, with errcode 42501 and the hint
-- owner_approves, and without the queue's prefix. The Owner-approved execution path (app.mgmt_approved for that club)
-- passes first, exactly as mgmt_gate lets it. Every other mode is still mgmt_gate's own answer ('hidden': "The Owner has
-- not given your seat access to ..."; owner, office, full and none pass). Nothing else changes: mgmt_gate keeps its
-- wording for every move the queue does take (waive_player, trades, lineups), and the four market doors keep their own
-- sentences ahead of this one. CREATE OR REPLACE keeps the signature, the definer, the empty search_path and the grants
-- (postgres and service_role only; no client calls _market_ctx).
--
-- Requires: v4.58 and v4.59 live (_market_ctx and its four callers, public.mgmt_access, public.mgmt_page_label).
-- Rehearsal: sql/2026-11-24-market-owner-words-v463.rehearsal.sql (main session). Test: tools/market-owner-words-v463.test.cjs.
-- Posts nothing and writes no row.

-- 0. preconditions
do $pre$
declare f text;
begin
  if to_regprocedure('public._market_ctx(uuid,text)') is null or to_regprocedure('public.mgmt_gate(uuid,text)') is null
     or to_regprocedure('public.mgmt_access(uuid,text)') is null or to_regprocedure('public.mgmt_page_label(text)') is null then
    raise exception 'v463 market owner words: _market_ctx, mgmt_gate, mgmt_access and mgmt_page_label must exist (v4.58 live)';
  end if;
  /* each market door answers an approving seat in its own words BEFORE it calls _market_ctx; this record is the backstop */
  foreach f in array array['public.market_claim(uuid,uuid)', 'public.market_bid(uuid,uuid,bigint)',
                           'public.market_pool_request(uuid,uuid,uuid)', 'public.market_pool_withdraw(uuid)'] loop
    if to_regprocedure(f) is null then raise exception 'v463 market owner words: % is missing (v4.58 and v4.59 live)', f; end if;
    if position('_market_ctx(' in pg_get_functiondef(f::regprocedure)) = 0
       or position('= ''approve'' then' in pg_get_functiondef(f::regprocedure)) = 0
       or position('= ''approve'' then' in pg_get_functiondef(f::regprocedure)) > position('_market_ctx(' in pg_get_functiondef(f::regprocedure)) then
      raise exception 'v463 market owner words: % no longer answers an approving seat before _market_ctx; read it before applying', f;
    end if;
  end loop;
end $pre$;

-- 1. _market_ctx: an approving seat is told in the market's words
do $p$
declare
  v_old text := pg_get_functiondef('public._market_ctx(uuid,text)'::regprocedure);
  a text := $a$  perform public.mgmt_gate(p_team, p_page);
$a$;
  b text := $b$  /* v463 (stream f's hand-over, 2026-11-24): a market move cannot wait in the Owner's approval queue (the first claim
     wins at once, a live bid cannot wait, a request waits on the player), so a seat whose Owner approves this page's moves
     is told to ask the Owner, in the market's words and never with the queue's MGMT_APPROVAL_REQUIRED prefix, which the
     site's write door reads as "queue this move". The Owner-approved execution (app.mgmt_approved) passes as mgmt_gate
     lets it; every other mode is mgmt_gate's own answer */
  if coalesce(current_setting('app.mgmt_approved', true), '') is distinct from coalesce(p_team::text, '')
     and public.mgmt_access(p_team, p_page) = 'approve' then
    raise exception 'Your Owner approves this seat''s % moves, and a market move cannot wait for approval, so ask your Owner to make it.',
      public.mgmt_page_label(p_page) using errcode = '42501', hint = 'owner_approves';
  end if;
  perform public.mgmt_gate(p_team, p_page);
$b$;
  n int; v_new text;
begin
  n := (length(v_old) - length(replace(v_old, a, ''))) / length(a);
  if n <> 1 then raise exception 'v463 market owner words: the _market_ctx anchor matched % times, expected exactly 1', n; end if;
  execute replace(v_old, a, b);
  v_new := pg_get_functiondef('public._market_ctx(uuid,text)'::regprocedure);
  if (length(v_new) - length(replace(v_new, b, ''))) / length(b) <> 1 then
    raise exception 'v463 market owner words: the new block is not in _market_ctx exactly once';
  end if;
  if replace(v_new, b, a) <> v_old then
    raise exception 'v463 market owner words: _market_ctx differs from its old body by more than this block';
  end if;
end $p$;

-- 2. self-checks
do $chk$
declare d text := pg_get_functiondef('public._market_ctx(uuid,text)'::regprocedure); p record;
begin
  select pr.prosecdef, pr.proconfig into p from pg_proc pr where pr.oid = 'public._market_ctx(uuid,text)'::regprocedure;
  if not p.prosecdef or p.proconfig is distinct from array['search_path=""'] then
    raise exception 'v463 market owner words: _market_ctx must stay SECURITY DEFINER with search_path '''' (is %)', p.proconfig;
  end if;
  if has_function_privilege('anon', 'public._market_ctx(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public._market_ctx(uuid,text)', 'execute') then
    raise exception 'v463 market owner words: _market_ctx must stay without a client grant';
  end if;
  if position('hint = ''owner_approves''' in d) = 0 or position('perform public.mgmt_gate(p_team, p_page);' in d) = 0
     or position('hint = ''owner_approves''' in d) > position('perform public.mgmt_gate(p_team, p_page);' in d) then
    raise exception 'v463 market owner words: the market answer must come before the gate';
  end if;
  if position('MGMT_APPROVAL_REQUIRED' in pg_get_functiondef('public.mgmt_gate(uuid,text)'::regprocedure)) = 0 then
    raise exception 'v463 market owner words: mgmt_gate must keep its queue prefix for the moves the queue takes';
  end if;
end $chk$;

-- Rehearsal results (main session): not rehearsed yet.
-- Applied as migration v463g_market_owner_words on 2026-11-25 (re-rehearsed on production that morning, rolled back, then applied after the v4.63 deploy); tools/sql/grant-audit.sql returned zero rows.
-- <<< record text

-- the world
do $w$
declare v_s uuid := public.current_season_id(); v_team uuid; v_gm uuid; v_c uuid;
begin
  if v_s is null or not public.market_on(v_s) then raise exception 'world: the current season is not a market season'; end if;
  select t.id into v_team from public.teams t order by t.code limit 1;
  select r.profile_id into v_gm from public.season_registrations r join public.profiles p on p.id = r.profile_id
   where r.season_id = v_s and r.status <> 'declined' and p.role <> 'commissioner' and not coalesce(p.banned, false)
     and not public.is_suspended(r.profile_id)
     and not exists (select 1 from public.teams t where r.profile_id in (t.owner_profile_id, t.gm_profile_id, t.agm_profile_id))
   order by r.created_at, r.profile_id limit 1;
  select p.id into v_c from public.profiles p where p.role = 'commissioner' order by p.id limit 1;
  if v_team is null or v_gm is null or v_c is null then raise exception 'world: no club, free sign-up or commissioner to rehearse with'; end if;
  update public.teams set gm_profile_id = v_gm where id = v_team;
  insert into public.team_mgmt_policy (team_id, policy) values (v_team, '{"gm": {"freeagents": "approve", "lines": "hidden"}}'::jsonb)
    on conflict (team_id) do update set policy = excluded.policy;
  if public.mgmt_access_for(v_gm, v_team, 'freeagents') <> 'approve' or public.mgmt_access_for(v_gm, v_team, 'lines') <> 'hidden' then
    raise exception 'world: the policy did not take (freeagents %, lines %)', public.mgmt_access_for(v_gm, v_team, 'freeagents'), public.mgmt_access_for(v_gm, v_team, 'lines');
  end if;
  perform set_config('rh.s', v_s::text, true);
  perform set_config('rh.team', v_team::text, true);
  perform set_config('rh.gm', v_gm::text, true);
  perform set_config('rh.c', v_c::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_gm, 'role', 'authenticated')::text, true);
end $w$;

-- R1 and R2
do $r12$
declare v_msg text; v_hint text; v_code text; v_team uuid := current_setting('rh.team')::uuid;
begin
  begin
    perform public._market_ctx(v_team, 'freeagents');
    v_msg := 'let through';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_code = returned_sqlstate;
  end;
  if v_msg <> 'Your Owner approves this seat''s Free agents moves, and a market move cannot wait for approval, so ask your Owner to make it.'
     or v_hint is distinct from 'owner_approves' or v_code <> '42501' then
    raise exception 'R1 failed: %, hint %, code %', v_msg, v_hint, v_code;
  end if;
  v_msg := null; v_hint := null; v_code := null;
  begin
    perform public._market_ctx(v_team, 'lines');
    v_msg := 'let through';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_code = returned_sqlstate;
  end;
  if v_msg <> 'The Owner has not given your seat access to Lineup builder.' or v_code <> '42501' then
    raise exception 'R2 failed: %, code %', v_msg, v_code;
  end if;
end $r12$;

-- R3, R4 and R5: past the gate, the next check (the draft) or the season itself
create or replace function pg_temp.past_gate(p_team uuid) returns text language plpgsql as $f$
declare v_msg text; v_hint text;
begin
  begin
    return 'season ' || public._market_ctx(p_team, 'freeagents')::text;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    return coalesce(v_hint, '') || ': ' || v_msg;
  end;
end $f$;
do $r345$
declare v_team uuid := current_setting('rh.team')::uuid; v_ok text := 'season ' || current_setting('rh.s'); r text;
begin
  update public.team_mgmt_policy set policy = '{"gm": {"freeagents": "full", "lines": "hidden"}}'::jsonb where team_id = v_team;
  r := pg_temp.past_gate(v_team);
  if r <> v_ok and r not like 'draft_not_done:%' then raise exception 'R3 failed: %', r; end if;
  update public.team_mgmt_policy set policy = '{"gm": {"freeagents": "approve", "lines": "hidden"}}'::jsonb where team_id = v_team;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.c'), 'role', 'authenticated')::text, true);
  r := pg_temp.past_gate(v_team);
  if r <> v_ok and r not like 'draft_not_done:%' then raise exception 'R4 failed: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('rh.gm'), 'role', 'authenticated')::text, true);
  perform set_config('app.mgmt_approved', v_team::text, true);
  r := pg_temp.past_gate(v_team);
  if r <> v_ok and r not like 'draft_not_done:%' then raise exception 'R5 failed: %', r; end if;
  perform set_config('app.mgmt_approved', '', true);
end $r345$;

-- R6: the doors' own words come first
create or replace function pg_temp.hint_of(p_sql text) returns text language plpgsql as $f$
declare v_hint text;
begin
  begin
    execute p_sql;
    return 'let through';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return coalesce(v_hint, 'no hint');
  end;
end $f$;
do $r6$
declare v_team uuid := current_setting('rh.team')::uuid; a text; b text; c text;
begin
  update public.team_mgmt_policy set policy = '{"gm": {"freeagents": "approve", "lines": "approve"}}'::jsonb where team_id = v_team;
  a := pg_temp.hint_of(format('select public.market_claim(%L::uuid, %L::uuid)', gen_random_uuid(), v_team));
  b := pg_temp.hint_of(format('select public.market_bid(%L::uuid, %L::uuid, 750000)', gen_random_uuid(), v_team));
  c := pg_temp.hint_of(format('select public.market_pool_request(%L::uuid, %L::uuid, %L::uuid)', gen_random_uuid(), v_team, gen_random_uuid()));
  if a <> 'owner_claims' or b <> 'owner_bids' or c <> 'owner_requests' then raise exception 'R6 failed: claim %, bid %, request %', a, b, c; end if;
end $r6$;

-- R7 and the verdict
do $r7$
declare v_team uuid := current_setting('rh.team')::uuid; v_msg text;
begin
  update public.team_mgmt_policy set policy = '{"gm": {"roster": "approve"}}'::jsonb where team_id = v_team;
  begin
    perform public.mgmt_gate(v_team, 'roster');
    v_msg := 'let through';
  exception when others then
    get stacked diagnostics v_msg = message_text;
  end;
  if v_msg not like 'MGMT_APPROVAL_REQUIRED:%' then raise exception 'R7 failed: %', v_msg; end if;
  raise exception 'REHEARSAL OK: R1 R2 R3 R4 R5 R6 R7';
end $r7$;
