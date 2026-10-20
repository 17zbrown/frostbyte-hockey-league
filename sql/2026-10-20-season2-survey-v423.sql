-- v4.23 (2026-10-20): the Season 2 survey goes live, and its answers are saved in the league database.
-- Commissioner, 2026-10-20, approving the mockup (branch survey-s2-mock): "Add the survey to the live site. Only show it
-- on the user's first refresh of the calendar day, and when the click on the signup page for season 2." and "If a
-- player has filled it out at any point, do not show them the survey again no matter what."
--
-- Why a table and three doors:
--   * "No matter what" needs the finished state to live on the server, not in one browser: a member who finished on
--     a phone must never meet the survey on a laptop. One row per member per survey is that state.
--   * public.season_survey_responses is born unreadable and unwritable to the API roles (RLS on, every privilege
--     revoked, no policies). Only the three SECURITY DEFINER functions below touch it.
--   * submit_season_survey stamps auth.uid(), refuses guests, members with no profile and banned members, accepts
--     only the known survey key and source, and keeps only the known answers (text trimmed and capped, pick lists of
--     short strings, the X-Factor None flags as booleans). A second device's submission keeps the first (on conflict
--     do nothing) and still returns true, because the member HAS finished.
--   * season_survey_done is what the site asks before either path opens (the daily pop-up and the Season 2 sign-up
--     gate). The site fails closed: while the answer is unknown, or the call failed, the survey stays shut.
--   * season_survey_results is the commissioner's read. It returns every response's answers, source and time, newest
--     first, WITHOUT profile ids or names: the text answers stay anonymous in the results.
--
-- The answer keys and their limits mirror SV.Q in src/live/part11_survey.js (SV.payload builds what the site sends);
-- tools/season2-survey-v423.test.cjs holds the two lists together.
--
-- Rehearsal (2026-10-20): one transaction on the live database, rolled back by a closing raise. The migration ran in
-- full (self-checks passed), then a probe played a real non-commissioner member and a commissioner through
-- request.jwt.claims:
--   T1 a member with no row reads done = false; T2 their submit returns true; T3 they then read done = true;
--   T4 a second submit from "another device" (source signup, different text) keeps the first row (worked "Good nights",
--      source daily); T5 the saved answers are cleaned (text trimmed, the empty "fix" and null "wish" dropped, the false
--      xfBlueNone dropped, xfRedNone true kept); T6 an unknown key ("hack") is refused with the SURVEY: message;
--   T7 a member calling season_survey_results gets 42501; T8 the commissioner reads count 1 and no profile id appears
--      anywhere in the result; T9 a caller with no sign-in gets 42501 from submit.
--   Result: REHEARSAL OK: T1 not done before, T2 saved, T3 done after, T4 second device kept the first (worked=Good
--   nights, source=daily), T5 cleaned to {"nights": ["Wednesday", "Thursday"], "worked": "Good nights", "xfGold":
--   ["Truculence", "Big Rig"], "perWeek": "3", "positions": "Keep positions open", "xfRedNone": true}, T6 unknown key
--   refused, T7 member refused results, T8 commissioner read 1 response(s) with no profile ids, T9 guest refused
--   Afterward: to_regclass('public.season_survey_responses') was null and none of the three functions existed.
-- Applied as migration v423_season2_survey (2026-10-20); tools/sql/grant-audit.sql returned zero rows.

-- 1) The table: one row per member per survey
create table public.season_survey_responses (
  id bigint generated always as identity primary key,
  survey_key text not null check (survey_key ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  /* the largest honest answer set is about 26 KB of JSON text (4000 typed characters, every one escaped, plus three
     full X-Factor lists); 32 KB refuses anything built to fill the table */
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 32768),
  source text not null check (source in ('daily', 'signup')),
  finished_at timestamptz not null default now(),
  unique (profile_id, survey_key)
);
comment on table public.season_survey_responses is
  'v4.23: member survey answers, one row per member per survey. Written only by submit_season_survey; read by season_survey_done (own row) and season_survey_results (commissioners, anonymous).';
alter table public.season_survey_responses enable row level security;
revoke all on public.season_survey_responses from public, anon, authenticated;
/* the identity sequence inherits the schema's default grants (anon and authenticated rwU) */
do $seq$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated',
                 pg_get_serial_sequence('public.season_survey_responses', 'id'));
end $seq$;

-- 2) The one door a member's answers come in through
create or replace function public.submit_season_survey(p_survey text, p_answers jsonb, p_source text) returns boolean
  language plpgsql security definer set search_path to '' as $f$
/* v4.23 (commissioner, 2026-10-20): "If a player has filled it out at any point, do not show them the survey again
   no matter what." The row this writes is that "filled it out". Every answer is optional, so {} is a finished survey. */
declare
  v_uid uuid := auth.uid();
  v_key text; v_val jsonb; v_t text; v_item jsonb; v_list jsonb;
  v_clean jsonb := '{}'::jsonb;
  /* typed answers and their caps (SV.Q max): trimmed, then cut to the cap */
  c_text constant jsonb := '{"worked": 1000, "fix": 1000, "wish": 2000}';
  /* one choice from a short list: Q3 position locks, Q4's nights a week */
  c_one constant text[] := array['positions', 'perWeek'];
  /* pick lists: Q4 nights, Q5 to Q7 the X-Factor bans per tier */
  c_list constant text[] := array['nights', 'xfGold', 'xfBlue', 'xfRed'];
  /* "None" on an X-Factor tier: an explicit answer, kept apart from no answer */
  c_flag constant text[] := array['xfGoldNone', 'xfBlueNone', 'xfRedNone'];
begin
  if v_uid is null then raise exception 'SURVEY: Sign in to save your answers.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'SURVEY: Your member profile was not found. Refresh the page and try again.' using errcode = '42501';
  end if;
  /* the league's one definition of a ban (is_banned pins its own search_path), so the survey door never drifts from it */
  if public.is_banned(v_uid) then raise exception 'SURVEY: A banned account cannot answer the survey.' using errcode = '42501'; end if;
  if p_survey is distinct from 's2-2026' then raise exception 'SURVEY: That survey is not open.'; end if;
  if p_source is null or p_source not in ('daily', 'signup') then
    raise exception 'SURVEY: Unknown survey source "%".', coalesce(p_source, '(none)');
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'SURVEY: The answers must be a JSON object.';
  end if;

  for v_key, v_val in select e.key, e.value from jsonb_each(p_answers) e loop
    if jsonb_typeof(v_val) = 'null' then
      continue;                                   -- no answer
    elsif c_text ? v_key then
      if jsonb_typeof(v_val) <> 'string' then raise exception 'SURVEY: The answer "%" must be text.', v_key; end if;
      v_t := left(btrim(v_val #>> '{}', E' \t\r\n'), (c_text ->> v_key)::int);
      if v_t <> '' then v_clean := v_clean || jsonb_build_object(v_key, v_t); end if;
    elsif v_key = any(c_one) then
      if jsonb_typeof(v_val) <> 'string' then raise exception 'SURVEY: The answer "%" must be one choice.', v_key; end if;
      v_t := btrim(v_val #>> '{}');
      if char_length(v_t) > 60 then raise exception 'SURVEY: The answer "%" is not one of the choices.', v_key; end if;
      if v_t <> '' then v_clean := v_clean || jsonb_build_object(v_key, v_t); end if;
    elsif v_key = any(c_list) then
      /* 40 is past every list the survey offers (7 nights, 28 X-Factors) and short of anything built to bloat a row */
      if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) > 40 then
        raise exception 'SURVEY: The answer "%" must be a list of at most 40 choices.', v_key;
      end if;
      v_list := '[]'::jsonb;
      for v_item in select el.value from jsonb_array_elements(v_val) el loop
        if jsonb_typeof(v_item) <> 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 60 then
          raise exception 'SURVEY: The answer "%" holds something that is not a choice.', v_key;
        end if;
        v_list := v_list || jsonb_build_array(btrim(v_item #>> '{}'));
      end loop;
      if jsonb_array_length(v_list) > 0 then v_clean := v_clean || jsonb_build_object(v_key, v_list); end if;
    elsif v_key = any(c_flag) then
      if jsonb_typeof(v_val) <> 'boolean' then raise exception 'SURVEY: The answer "%" must be true or false.', v_key; end if;
      if (v_val #>> '{}')::boolean then v_clean := v_clean || jsonb_build_object(v_key, true); end if;
    else
      raise exception 'SURVEY: "%" is not a question on this survey.', v_key;
    end if;
  end loop;

  /* a second device's submission keeps the first answers: the member has finished either way */
  insert into public.season_survey_responses (survey_key, profile_id, answers, source)
  values (p_survey, v_uid, v_clean, p_source)
  on conflict (profile_id, survey_key) do nothing;
  return true;
end $f$;
revoke all on function public.submit_season_survey(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_season_survey(text, jsonb, text) to authenticated;

-- 3) Has the caller finished this survey? (asked before either path opens; the site fails closed)
create or replace function public.season_survey_done(p_survey text) returns boolean
  language plpgsql stable security definer set search_path to '' as $f$
/* v4.23: true when the caller has a row for this survey, false when they do not */
begin
  if auth.uid() is null then raise exception 'SURVEY: Sign in first.' using errcode = '42501'; end if;
  return exists (select 1 from public.season_survey_responses r
                  where r.profile_id = auth.uid() and r.survey_key = p_survey);
end $f$;
revoke all on function public.season_survey_done(text) from public, anon, authenticated;
grant execute on function public.season_survey_done(text) to authenticated;

-- 4) The commissioner's read: every response, newest first, anonymous
create or replace function public.season_survey_results(p_survey text) returns jsonb
  language plpgsql stable security definer set search_path to '' as $f$
/* v4.23: no profile id, name or row id leaves this function, so the typed answers stay anonymous in the results */
begin
  if not public.is_commissioner() then
    raise exception 'SURVEY: Only a commissioner may read the survey results.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'survey', p_survey,
      'count', count(*),
      'responses', coalesce(jsonb_agg(jsonb_build_object('answers', r.answers, 'source', r.source, 'finished_at', r.finished_at)
                                      order by r.finished_at desc, r.id desc), '[]'::jsonb))
      from public.season_survey_responses r
     where r.survey_key = p_survey);
end $f$;
revoke all on function public.season_survey_results(text) from public, anon, authenticated;
grant execute on function public.season_survey_results(text) to authenticated;

-- 5) Self-checks: raise when the result is wrong
do $chk$
declare r record; v_n int := 0;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.season_survey_responses'::regclass) then
    raise exception 'self-check: RLS is off on season_survey_responses';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'season_survey_responses') then
    raise exception 'self-check: season_survey_responses has a policy; only the definer functions may touch it';
  end if;
  if exists (select 1 from unnest(array['anon', 'authenticated']::name[]) g(rol),
                           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
              where has_table_privilege(g.rol, 'public.season_survey_responses', p.priv)) then
    raise exception 'self-check: anon or authenticated holds a privilege on season_survey_responses';
  end if;
  if exists (select 1 from unnest(array['anon', 'authenticated']::name[]) g(rol), unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv)
              where has_sequence_privilege(g.rol, pg_get_serial_sequence('public.season_survey_responses', 'id'), p.priv)) then
    raise exception 'self-check: anon or authenticated holds a privilege on the survey id sequence';
  end if;
  for r in select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('submit_season_survey', 'season_survey_done', 'season_survey_results') loop
    v_n := v_n + 1;
    if not r.prosecdef then raise exception 'self-check: % is not SECURITY DEFINER', r.proname; end if;
    if r.proconfig is distinct from array['search_path=""'] then
      raise exception 'self-check: % does not run with an empty search_path (%)', r.proname, r.proconfig;
    end if;
    if r.proacl is null or exists (select 1 from aclexplode(r.proacl) a where a.grantee = 0) then
      raise exception 'self-check: PUBLIC may execute %', r.proname;
    end if;
    if has_function_privilege('anon', r.oid, 'EXECUTE') then raise exception 'self-check: anon may execute %', r.proname; end if;
    if not has_function_privilege('authenticated', r.oid, 'EXECUTE') then
      raise exception 'self-check: members cannot reach %', r.proname;
    end if;
  end loop;
  if v_n <> 3 then raise exception 'self-check: expected the three survey functions and no other overloads, found %', v_n; end if;
end $chk$;
