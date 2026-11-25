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
