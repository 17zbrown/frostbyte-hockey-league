-- v3.77: no link previews in anything the database posts to Discord.
-- Commissioner, 2026-10-01: "make sure in the future to always remove the embed when you use a link in any
-- text on the server."
--
-- The same rule as shared/discord-links.cjs (the Netlify functions and the gateway bot), in SQL:
--   * a message with no rich embeds gets the flag SUPPRESS_EMBEDS (1 << 2 = 4), text untouched;
--   * a message WITH rich embeds would lose its card to that flag, so its content links are wrapped in <...>
--     instead (masked links become [text](<url>)); code spans are left alone; if the brackets would push the
--     content past Discord's 2000 characters the original text is kept (delivery beats a refused post).
-- Every database post to Discord now goes through public.discord_http_post, which applies the rule and then
-- calls net.http_post with the same arguments. The seven writers below are patched surgically: their one
-- token `net.http_post(` becomes `public.discord_http_post(` and nothing else changes.
-- tools/sql/grant-audit.sql check 7 returns a row for any function that posts to a Discord webhook without
-- the wrapper, so a future writer cannot quietly skip it.

-- One left-to-right pass, the same scanner as wrapLinks in shared/discord-links.cjs: at each step take the
-- earliest of a fenced block, an inline code span, a link already inside <...>, or a bare link (ties go in that
-- order). The first three are copied as is, so nothing inside them is looked at again (a link carrying another
-- link is wrapped once, whole). Four single-pattern searches rather than one alternation, because Postgres
-- makes an alternation greedy as a whole, which would let one fenced block run to the LAST fence. A bare link
-- loses trailing sentence punctuation, and a ")" it has no "(" for, so [text](https://...) comes out as
-- [text](<https://...>).
create or replace function public.discord_wrap_links(p text) returns text
language plpgsql immutable set search_path = '' as $f$
declare
  v_out text := '';
  v_rest text := p;
  v_pats text[] := array['```.*?```', '`[^`\n]*`', '<https?://[^\s<>]*>', '(?<![<\w/])https?://[^\s<>]+'];
  v_k int; v_best int; v_bestpos int; v_pos int; v_m text; v_url text; v_tail text; v_last text;
begin
  if p is null or p !~* 'https?://\S' then return p; end if;
  loop
    v_best := 0; v_bestpos := 0;
    for v_k in 1..4 loop
      v_pos := regexp_instr(v_rest, v_pats[v_k], 1, 1, 0, 'i');
      if v_pos > 0 and (v_bestpos = 0 or v_pos < v_bestpos) then v_best := v_k; v_bestpos := v_pos; end if;
    end loop;
    exit when v_best = 0;
    v_m := regexp_substr(substr(v_rest, v_bestpos), v_pats[v_best], 1, 1, 'i');
    v_out := v_out || left(v_rest, v_bestpos - 1);
    if v_best < 4 then
      v_out := v_out || v_m;
    else
      v_url := v_m; v_tail := '';
      loop
        v_last := right(v_url, 1);
        exit when v_last = '';
        if v_last ~ '[.,;:!?''"*_~|’”»›…]' then v_tail := v_last || v_tail; v_url := left(v_url, -1); continue; end if;
        if v_last = ')' and length(v_url) - length(replace(v_url, ')', '')) > length(v_url) - length(replace(v_url, '(', '')) then
          v_tail := v_last || v_tail; v_url := left(v_url, -1); continue;
        end if;
        exit;
      end loop;
      v_out := v_out || case when v_url ~* '^https?://\S' then '<' || v_url || '>' || v_tail else v_m end;
    end if;
    v_rest := substr(v_rest, v_bestpos + length(v_m));
  end loop;
  v_out := v_out || v_rest;
  if length(v_out) > 2000 and length(p) <= 2000 then return p; end if;
  return v_out;
end $f$;

create or replace function public.discord_no_previews(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $f$
begin
  if p is null or jsonb_typeof(p) <> 'object' then return p; end if;
  if jsonb_typeof(p->'embeds') = 'array' and jsonb_array_length(p->'embeds') > 0 then
    if jsonb_typeof(p->'content') = 'string' then
      return jsonb_set(p, '{content}', to_jsonb(public.discord_wrap_links(p->>'content')));
    end if;
    return p;
  end if;
  return p || jsonb_build_object('flags', coalesce((p->>'flags')::int, 0) | 4);
end $f$;

-- Same parameter names and defaults as net.http_post (minus params, which no Discord post uses), so a caller
-- switches by changing only the function name.
create or replace function public.discord_http_post(url text, body jsonb default '{}'::jsonb,
    headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql volatile set search_path = '' as $f$
  select net.http_post(url := url, body := public.discord_no_previews(body), headers := headers,
                       timeout_milliseconds := timeout_milliseconds)
$f$;

-- Internal only: discord_http_post would post anything to any URL, so no API role may reach it. Its callers
-- are SECURITY DEFINER functions owned by postgres.
revoke all on function public.discord_wrap_links(text) from public, anon, authenticated;
revoke all on function public.discord_no_previews(jsonb) from public, anon, authenticated;
revoke all on function public.discord_http_post(text, jsonb, jsonb, integer) from public, anon, authenticated;

do $mig$
declare
  r record; d0 text; d text; v_n int;
begin
  for r in select * from (values
      ('_announce_once', 1), ('_mgmt_move_send', 1), ('automation_watchdog', 5), ('notify_discord', 1),
      ('notify_staff_ch', 1), ('notify_trade_block', 1), ('withdraw_registration', 1)) v(fn, expect)
  loop
    select pg_get_functiondef(p.oid) into d0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if d0 is null then raise exception '% not found', r.fn; end if;
    v_n := (length(d0) - length(replace(d0, 'net.http_post(', ''))) / length('net.http_post(');
    if v_n <> r.expect then raise exception '%: expected % net.http_post call(s), found %', r.fn, r.expect, v_n; end if;
    d := replace(d0, 'net.http_post(', 'public.discord_http_post(');
    if d = d0 then raise exception '%: nothing replaced', r.fn; end if;
    execute d;
  end loop;
end $mig$;

/* REHEARSED 2026-10-01 in one rolled-back transaction: "REHEARSAL OK: W(23) W2 N1-6 P1 F1-3 E1 G1".
     W   discord_wrap_links gives shared/discord-links.cjs wrapLinks' answer byte for byte on 23 cases generated
         from the JS (code spans, masked links, a link carrying a link, wiki parens, typographic closers);
     W2  the 2000-character fallback; N1-6 the payload rule (flag, kept bits, rich card wraps, embeds-only
         untouched, empty embeds flag, non-objects pass); P1 discord_http_post queues a body with flags 4;
     F1-3 the seven writers call the wrapper and audit check 7 returns nothing; E1 a real notify_discord call
         queued flags 4 with its link intact (rolled back: pg_net only sends committed rows); G1 no API role
         can execute the helpers.
   APPLIED 2026-10-01 as migration v377_no_link_previews. Afterwards: 7 functions post through
   public.discord_http_post, 0 call net.http_post directly, anon/authenticated cannot execute the wrapper, and
   tools/sql/grant-audit.sql (with check 7) returns zero rows. */
